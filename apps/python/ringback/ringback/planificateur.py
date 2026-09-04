"""Call queue with guards + the `first yes` cascade.

Three independent locks before any REAL call:
1. the call client must hold a key (otherwise it does not construct);
2. the global dry_run flag (true by default) must be lifted explicitly;
3. confirmer_appels_reels() must have been called on THIS instance.
Simulated calls, for their part, always go through. A queued call can be cancelled as long as it has not been executed. The `first yes` cascade goes through the SAME locks as the classic queue.

TWO MORE RULES, held here so that no door escapes them:
- the MOMENT: the permitted calling window and the forbidden period are re-checked in verifier_garde_fous(), through which ALL call execution passes (queue, cascade, campaign, due follow-up) — no exemption, not even for a gesture triggered by hand;
- the DATE AGREED ON THE PHONE: an appointment is only written when the slot really exists (open day, within hours, free, long enough). Otherwise NOTHING is written and the reason — with the requested date in clear — is returned to the caller, who puts it in front of a human.
These two rules need the settings: they are passed to the constructor (preferences). Without them, the planner claims to check nothing.

AND THE OFFERED DATE, the mirror image of the previous: the slot offered to
make up for a missed appointment comes out of horaires.places_a_proposer() —
the genuinely free slots, at the appointment's length — and not from a `missed
date + 7 days` formula that could land in the past. When there is no free slot
left, NO call goes out and the screen says so: a date we cannot honour is not
offered.
"""

import datetime
import logging

from . import calle_client, db, horaires, themes

journal = logging.getLogger("ringback.planificateur")

# The mission offered by default on the cascade page (the `freed slot` theme's
# template); [entreprise] comes from the settings, [créneau] is replaced
# automatically by the date chosen at call time.
MISSION_EXEMPLE = themes.GABARITS["creneau_libere"]

MOTIF_CRENEAU_ATTRIBUE = "Créneau libéré attribué (cascade « premier oui »)"
MOTIF_AUTRE_DATE = "Rendez-vous convenu par téléphone (cascade « premier oui »)"

# ------------------------------- the old appointment, in the direct cascade
# THE Q7 GAP, CLOSED. A direct cascade starts from a `Name;Phone` list pasted
# by hand: it does NOT say which appointment the client is talking about. Yet
# when they take the freed slot (`accepted`) or agree another date (`moved`),
# their old appointment must go — otherwise they have two and a slot stays
# blocked for nothing. The rule applied, and its acknowledged limit: - the
# contact is recognised as a client ALREADY on file (db.client_connu, which
# creates nothing) AND they have EXACTLY ONE upcoming appointment → that is the
# one, and it is released according to horaires.decision_annulation; - they
# have SEVERAL → nothing is invented: RingBack does not know which one it is.
# The row says so plainly, a human decides; - they are not on file, or they
# have no upcoming appointment → there is nothing to release, and nothing is
# said rather than worrying anyone for nothing.
NOTE_ANCIEN_AMBIGU = (
    "Ancien rendez-vous à libérer dans votre agenda : {nom} a {nombre} "
    "rendez-vous à venir dans RingBack ({dates}) — impossible de savoir "
    "duquel il parlait. Rien n'a été supprimé : à vous de choisir.")
NOTE_ANCIEN_LIBERE = (
    "Ancien rendez-vous {date} libéré ({statut}) : {pourquoi}")

# Outcome `the client said yes, but the agreed date does not hold`: no
# appointment is written, the person moves to a call-back BY A HUMAN with the
# requested date in clear. It is neither a refusal nor a success: it is an
# agreement the machine cannot honour without breaking the schedule.
ISSUE_DATE_REFUSEE = "date_refusee"

# Outcome `no free slot left to offer`: the call IS NOT PLACED. Owner's
# decision (Q6): `We always offer dates according to real availability, not by
# estimating a date algorithmically and hoping it lands on an uncertain
# moment.` With no genuinely free slot there is nothing to offer on the phone:
# we stay silent rather than invent a date. The reason is written plainly on
# the call.
NOTE_SANS_PLACE = (
    "Personne n'a été appelé : plus aucune place libre à proposer dans les "
    "{jours} prochains jours. Aucune date n'a été inventée. Libérez une "
    "place, ou ouvrez des horaires dans « ⚙ Réglages », puis rappelez.")


def _mission_effective(mission, creneau):
    """Replaces the [créneau] placeholder with the offered date, readable in
    French.
    """
    creneau_dt = datetime.datetime.fromisoformat(creneau)
    return mission.replace("[créneau]", creneau_dt.strftime("le %d/%m/%Y à %Hh%M"))


class GardeFou(RuntimeError):
    """A guard blocked the execution of a real call."""


class ClientExclu(RuntimeError):
    """The client is marked `Ne plus appeler`: call refused (reversible)."""


class Planificateur:
    """preferences: the settings (opening hours, closed days).

    Without them, a date agreed on the phone cannot be checked: the planner
    then writes what the agent returned, as before. The server always supplies
    them; only isolated tests do without.
    """

    def __init__(self, base, client_appels, dry_run=True, preferences=None):
        self.base = base
        self.client_appels = client_appels
        self.dry_run = dry_run
        self.preferences = preferences
        self._appels_reels_confirmes = False
        self.file = []  # entries: {"appel_id": int, "rendezvous_id": int}

    def confirmer_appels_reels(self):
        """Explicit confirmation, to be given each session (never persisted).
        """
        self._appels_reels_confirmes = True

    def programmer(self, rendezvous_id):
        """Queues a call for this appointment; returns the call id.

        Refuses (ClientExclu) when the client is marked `Ne plus appeler`: that
        exclusion applies to EVERY call path, single ones included.
        """
        rdv = self.base.obtenir_rendezvous(rendezvous_id)
        if rdv is None:
            raise ValueError(f"Rendez-vous inconnu : {rendezvous_id}")
        if rdv["ne_plus_appeler"]:
            raise ClientExclu(
                f"{rdv['nom']} est marqué « Ne plus appeler » : aucun appel "
                "ne lui sera passé. Le drapeau se lève depuis la page "
                "« Clients » si besoin.")
        appel_id = self.base.creer_appel(rendezvous_id)
        self.file.append({"appel_id": appel_id, "rendezvous_id": rendezvous_id})
        journal.info("Appel n°%d mis en file pour %s (%s)",
                     appel_id, rdv["nom"], rdv["telephone_masque"])
        return appel_id

    def programmer_tous_les_manques(self):
        """Queues every missed appointment not already queued.

        Returns the list of created call ids (empty when there is nothing new);
        an appointment already queued is never doubled, an appointment WITH no
        number (an ICS import not completed) is not queued (nothing to dial),
        and a client marked `Ne plus appeler` is always skipped.
        """
        deja_en_file = {entree["rendezvous_id"] for entree in self.file}
        crees = []
        for rdv in self.base.rendezvous_manques():
            if not rdv["telephone_masque"]:
                journal.info("Rendez-vous n°%d sans numéro : non mis en file "
                             "(à compléter d'abord)", rdv["id"])
                continue
            if rdv["ne_plus_appeler"]:
                journal.info("Rendez-vous n°%d : client « Ne plus appeler », "
                             "jamais mis en file", rdv["id"])
                continue
            if rdv["id"] not in deja_en_file:
                crees.append(self.programmer(rdv["id"]))
        return crees

    def file_detaillee(self):
        """The queue, enriched with displayable information (numbers masked).
        """
        detail = []
        for entree in self.file:
            rdv = self.base.obtenir_rendezvous(entree["rendezvous_id"])
            detail.append({"appel_id": entree["appel_id"], "rendezvous": rdv})
        return detail

    def annuler(self, appel_id):
        """Removes a call from the queue before execution. Returns True when
        found.
        """
        for entree in self.file:
            if entree["appel_id"] == appel_id:
                self.file.remove(entree)
                self.base.changer_statut_appel(appel_id, "annulé")
                journal.info("Appel n°%d annulé avant exécution", appel_id)
                return True
        return False

    def annuler_tout(self):
        """`Empty the queue`: cancels ALL pending calls at once.

        Returns the number of calls cancelled. Like the single cancellation, it
        touches only calls NOT YET EXECUTED.
        """
        annules = 0
        for entree in list(self.file):
            if self.annuler(entree["appel_id"]):
                annules += 1
        return annules

    def purger_rendezvous(self, rendezvous_ids):
        """Removes from the queue the calls tied to these appointments (client
        deletion).

        No status is written: the calls are about to be deleted from the
        database along with the client. Returns the number of entries removed.
        """
        vises = set(rendezvous_ids)
        avant = len(self.file)
        self.file = [entree for entree in self.file
                     if entree["rendezvous_id"] not in vises]
        return avant - len(self.file)

    def _verifier_moment(self, hors_plage_permis=False):
        """The permitted calling window AND the forbidden period — for EVERYTHING.

        Owner's decision (R2): the forbidden period applies to all five doors,
        without exemption, even for a manual gesture. Since all call execution
        goes through verifier_garde_fous, the rule is held here once and for
        all rather than copied door by door. With no settings supplied
        (isolated tests), there is nothing to check.

        `hors_plage_permis`: the `force it despite the hour` gesture was made
        (see assistant.CLE_HORAIRE_FORCE). It lifts ONLY the time window —
        never the forbidden period — and it is honoured only when the call
        client is SIMULATED. That is the underlying guarantee: it does not rest
        on the caller's good faith, but on the object that dials the numbers. A
        real client refuses to lift anything at all, even when every layer
        above asks it to.
        """
        if self.preferences is None:
            return
        # Local import: themes is already imported, assistant is not (it
        # imports campagnes, which imports this module).
        from . import assistant
        simulation = not getattr(self.client_appels, "est_reel", False)
        message = assistant.dans_periode_interdite(self.preferences)
        if message is None and not (hors_plage_permis and simulation):
            message = themes.hors_plage(self.preferences)
        if message:
            raise GardeFou(message)

    def _verifier_garde_fous(self, hors_plage_permis=False):
        self._verifier_moment(hors_plage_permis)
        if not getattr(self.client_appels, "est_reel", False):
            return  # simulation : toujours permise
        if self.dry_run:
            raise GardeFou(
                "dry_run actif : aucun appel réel ne peut partir. Passer "
                "dry_run=False EN PLUS de la confirmation explicite.")
        if not self._appels_reels_confirmes:
            raise GardeFou(
                "Confirmation explicite manquante : appeler "
                "confirmer_appels_reels() avant tout appel réel.")

    def verifier_garde_fous(self, hors_plage_permis=False):
        """The SAME three locks, exposed to campaigns and follow-ups.

        Every call execution — queue, cascade, campaign, due follow-up — goes
        through THIS check: the locks are never duplicated nor bypassed. Raises
        GardeFou when a real call is not permitted.

        `hors_plage_permis`: see `_verifier_moment`. Only the campaign uses it,
        and only in simulation.
        """
        self._verifier_garde_fous(hors_plage_permis)

    def executer(self, seulement=None, mission=None):
        """Works the queue; returns the list of ids of the calls placed.

        With seulement=<appel_id>, only that call is handled: the others stay
        queued (used by the single `Rappeler` button). mission: optional text
        chosen at launch (call theme) — [client] and [date_rdv] are substituted
        PER CALL; with no mission, each call client keeps its standard
        briefing.
        """
        self._verifier_garde_fous()
        if seulement is None:
            a_traiter = list(self.file)
        else:
            a_traiter = [e for e in self.file if e["appel_id"] == seulement]
        traites = []
        for entree in a_traiter:
            self.file.remove(entree)
            appel_id = entree["appel_id"]
            rdv = self.base.obtenir_rendezvous(entree["rendezvous_id"])
            if rdv is None:  # client deleted between queueing and here
                self.base.terminer_appel(
                    appel_id, "annulé", note=db.REFUS_CLIENT_SUPPRIME)
                journal.info("Appel n°%d abandonné : le rendez-vous n'existe "
                             "plus", appel_id)
                continue
            refus = self._refus_avant_composition(rdv)
            if refus:  # SAFETY NET: the 🚫 read back at the moment of dialling
                self.base.terminer_appel(appel_id, "annulé", note=refus)
                journal.info("Appel n°%d NON composé : %s", appel_id, refus)
                continue
            telephone = self.base.telephone_de(rdv["client_id"])
            if not telephone:  # ICS import not yet completed: nothing to dial
                self.base.terminer_appel(appel_id, "échec",
                                         note=db.REFUS_SANS_NUMERO)
                journal.error("Appel n°%d en échec : aucun numéro pour %s "
                              "(à compléter avant de rappeler)", appel_id, rdv["nom"])
                continue
            # THE OFFERED SLOT: a genuinely free slot in the calendar, at the
            # length of THIS appointment, computed at the moment of the call.
            # When there is none left, we do not call — and we say so.
            support, sans_place = self._support_de_l_appel(rdv)
            if sans_place:
                self.base.terminer_appel(appel_id, "annulé", note=sans_place)
                journal.info("Appel n°%d NON composé : %s", appel_id, sans_place)
                continue
            mission_appel = (themes.finaliser(mission, rdv["nom"], rdv["horaire"])
                             if mission else None)
            try:
                issue = self.client_appels.appeler(rdv["nom"], telephone, support,
                                                   mission=mission_appel)
            except calle_client.ResultatEnAttente as attente:
                # THE CALL WENT OUT: it must above all NOT go back into the
                # queue (the phone would ring a second time for a conversation
                # that has already taken place). The CALL-E id is kept and what
                # is true is written: the result is missing.
                self.base.terminer_appel(appel_id, "en attente",
                                         note=str(attente))
                self.base.definir_appel_externe(appel_id, attente.identifiant)
                journal.error("File d'appels : l'appel n°%d EST PARTI, son "
                              "résultat n'est pas connu (appel CALL-E n° %s)",
                              appel_id, attente.identifiant)
                raise
            except calle_client.ResultatInvalide as refus:
                # THE CONVERSATION TOOK PLACE and RingBack could not read it.
                # The call does NOT go back into the queue (the phone would
                # ring a second time for nothing) and `échec` is not written:
                # its record carries CALL-E's RAW ANSWER and the transcript, so
                # a human can pick it up in a minute.
                self.base.terminer_appel(
                    appel_id, "réponse illisible",
                    transcription=refus.transcription or None,
                    note=str(refus) + (
                        f"\nRéponse brute de CALL-E : {refus.reponse_brute}"
                        if refus.reponse_brute else ""))
                if refus.identifiant:
                    self.base.definir_appel_externe(appel_id,
                                                    refus.identifiant)
                journal.error("File d'appels : l'appel n°%d a ABOUTI mais sa "
                              "réponse est illisible — %s", appel_id,
                              refus.constat)
                raise
            except calle_client.EchecDeNotreCote as panne:
                # A failure ON OUR SIDE (key refused, service down…): the call
                # did not take place, it GOES BACK INTO THE QUEUE as it was —
                # no `échec` is pinned on it, no client is blamed — and the
                # batch stops there: the following ones would all fail the same
                # way.
                self.file.insert(0, entree)
                journal.error("File d'appels interrompue au n°%d — %s",
                              appel_id, panne)
                raise
            except Exception as erreur:
                self.base.terminer_appel(appel_id, "échec")
                journal.error("Appel n°%d en échec : %s", appel_id, erreur)
                continue
            self.base.terminer_appel(appel_id, "terminé", issue.resultat,
                                     issue.transcription)
            self._honorer_ne_plus_appeler(issue.resultat, rdv.get("client_id"),
                                          rdv["nom"], telephone)
            note = self._appliquer_issue(rdv, issue.resultat)
            if note:
                self.base.noter_appel(appel_id, note)
            traites.append(appel_id)
        return traites

    def _honorer_ne_plus_appeler(self, resultat, client_id, nom, telephone):
        """The 🚫 requested DURING the call — on the record, straight away.

        ⚠ THE PROMISE IS SPOKEN ON EVERY PATH, NOT ONLY IN CAMPAIGNS
        (03/09/2026). The briefing dictated to the agent always contains
        `noted, you will not be called again`; the `do_not_call` field is
        always requested in the schema. But only the assistant read it: from
        the call queue or the direct cascade, the person heard the promise that
        they would not be called again, and nothing was written. They were
        called again the next day. Promising without keeping is worse than
        promising nothing — and it is not only a question of courtesy.

        ⚠ ON THE CLIENT'S RECORD, as the assistant does: the flag applies to
        ALL future calls, not only to that queue.

        Returns True when the flag was set.
        """
        if not calle_client.ne_plus_appeler_demande(resultat):
            return False
        cible = client_id or self.base.client_pour_contact(nom, telephone)
        if not cible:
            journal.warning("🚫 demandé au téléphone mais aucune fiche "
                            "trouvée pour « %s » — rien n'a pu être marqué",
                            nom)
            return False
        self.base.definir_ne_plus_appeler(cible, True)
        journal.info("🚫 demandé au téléphone : fiche n°%d marquée "
                     "« ne plus appeler »", cible)
        return True

    def _refus_avant_composition(self, rdv):
        """The SAFETY NET, read back at the very moment of dialling.

        The 🚫 `Ne plus appeler` may have been set AFTER queueing: it is
        therefore re-checked here, on the number AND on the name (a record
        whose number has just been corrected stays recognised by its name).
        Returns the refusal message, or None.
        """
        if rdv["ne_plus_appeler"]:
            return db.REFUS_STOP
        if self.base.nom_exclu(rdv["nom"]):
            return db.REFUS_STOP_NOM
        return None

    def _support_de_l_appel(self, rdv):
        """The appointment sent to the agent, enriched with a GENUINELY free slot.

        Returns (support, refusal). The support is the missed appointment
        itself — it is THAT one we talk to the client about — augmented with
        the slot offered to make up for it. That slot comes from
        horaires.places_a_proposer(), the SAME source as the slots announced in
        campaigns: it is free, at the right length, on an open day, and ahead
        of us. Never again `the missed date + 7 days`, which could land in the
        past.

        ⚠ AND A SECOND SLOT, for the case `the person offers ANOTHER one`
        (18/08/2026). Campaigns have supplied it since 16/08/2026 — see
        `assistant._support_de_l_appel` — and `calle_client`'s comment says
        what it costs when it is missing: `without it […] we fall back on a
        randomly drawn date, which has no chance of being free`. The call queue
        did not supply it.

        WHAT THAT PRODUCED, measured on 18/08/2026: on an appointment missed on
        19/07, the other agreed date fell on 21/07 — a month in the past. The
        appointment was not moved, it was lost. Two paths to the same phone,
        only one offering real dates.

        Three cases where nothing is claimed:
        - with no settings (isolated tests), the support goes out as it is and the old make-up convention applies;
        - NO free slot left: explicit refusal, no call;
        - only one free slot: no second one to offer, and that is honest — none is invented.
        """
        if self.preferences is None:
            return rdv, None
        tranches = horaires.duree_tranches(rdv)
        # ⚠ THE FIRST SLOT KEEPS ITS OWN COMPUTATION, AND THAT IS DELIBERATE.
        # `places_a_proposer` carries its own fallbacks — notably the `no
        # opening hours configured` case, where there is no typical week to
        # walk and the slot is found another way. My first version replaced it
        # with the free-slot computation: eight tests fell at once, all on
        # databases with no typical week — no call went out any more. The
        # second slot is ADDED, the first one is not redone.
        _, place = horaires.places_a_proposer(
            self.base, self.preferences, tranches=tranches)
        if not place:
            return None, NOTE_SANS_PLACE.format(jours=horaires.HORIZON_JOURS)
        support = dict(rdv)
        support["place_proposee"] = place
        autres = [libre for libre in horaires.places_libres_elargies(
            self.base, self.preferences, tranches=tranches, limite=3,
            depuis=horaires.plancher_de_proposition()) if libre != place]
        if autres:
            support["place_alternative"] = autres[0]
        return support, None

    def _refus_date_convenue(self, horaire, tranches=1, sauf_rdv=None,
                             place_choisie=False):
        """The refusal to write a date agreed on the phone, or None.

        With no settings supplied to the planner, no check is possible: nothing
        is then refused (and no check is claimed).
        """
        if self.preferences is None:
            return None
        return horaires.refus_rendezvous_telephone(
            self.base, self.preferences, horaire, tranches=tranches,
            sauf_rdv=sauf_rdv, place_choisie=place_choisie)

    def _appliquer_issue(self, rdv, resultat):
        """Applies the call's outcome to the appointment; returns a NOTE or None.

        ⚠ A DATE AGREED ON THE PHONE MOVES THE ROW; it NEVER creates a second
        one. That is true of both ways of accepting — taking the offered slot
        (`confirmed`) or agreeing another date (`rescheduled`): for the person
        called it is the same event, and the screen writes `✅ accepté` in both
        cases.

        ⚠ THAT WAS NOT THE CASE, AND IT IS HIS OBSERVATION OF 17/08/2026: `the
        first appointment was not cancelled, but we did indeed add it for the
        next day`. `rescheduled` marked the old row `déplacé` and created a
        SECOND one at the agreed date. Measured over his 18/08 day: four rows
        moved cleanly, two stayed on the day — it only half emptied in his
        archives and on his clients' records.

        The decision had in fact already been taken, by him, on 14/08/2026:
        `you move an appointment from one date to another, it's dead simple`.
        It had been written into `assistant._rendre_la_place` and into
        `assistant._deplacer_le_rendezvous` — not here. Three paths for one
        rule, two that applied it.

        ⚠ AND `déplacé` ALREADY MEANT SOMETHING ELSE EVERYWHERE ELSE: a person
        whose appointment has moved WITHOUT a new date, and who is therefore
        WAITING (see `db.STATUTS_A_RECASER`, `jeu_essai` — `moved WITH no new
        date` — and `etats_clients`, which deduces `pending move: find them the
        new date`). Writing `déplacé` on somebody who has JUST obtained a date
        meant filing them among those who need one found. Only one guard
        stopped them being called again — the `NOT EXISTS` of
        `rendezvous_a_recaser` — and a guard is not a rule.

        The history is not lost: the change log carries ONE ↔ row with both
        dates, and IT is the campaign's deliverable. A ghost row in the
        calendar was not a memory, it was a duplicate.

        `to_reschedule` (a move wanted but NOT concluded) changes NOTHING about
        the appointment: nothing was agreed — concluding is a follow-up's job.
        That is now the only case where the person really is waiting.

        Every date agreed ON THE PHONE is checked like typed input: closed day,
        opening hours, slot already taken, length that does not fit. When it
        does not fit, NOTHING is written and the reason is returned in clear
        (it becomes the call's note) — the schedule never becomes wrong, and
        the agreement obtained is not lost for all that.
        """
        statut = resultat["appointment_status"]
        tranches = horaires.duree_tranches(rdv)
        if statut == "canceled":
            self.base.mettre_a_jour_rendezvous(rdv["id"], statut="annulé")
        elif statut == "to_reschedule":
            journal.info("Rendez-vous n°%d : déplacement voulu mais non conclu "
                         "— rendez-vous inchangé, à relancer", rdv["id"])
        else:
            # confirmed | rescheduled: a date HAS been agreed. The SAME row
            # changes time and becomes `confirmé` — the person said yes.
            refus = self._refus_date_convenue(resultat["new_datetime"],
                                              tranches, sauf_rdv=rdv["id"])
            if refus:
                return self._note_date_refusee(rdv, resultat, refus)
            ancienne = rdv["horaire"]
            self.base.mettre_a_jour_rendezvous(
                rdv["id"], statut="confirmé", horaire=resultat["new_datetime"])
            if resultat["new_datetime"] != ancienne:
                journal.info("Rendez-vous n°%d déplacé : %s -> %s", rdv["id"],
                             ancienne, resultat["new_datetime"])
        return None

    @staticmethod
    def _note_date_refusee(rdv, resultat, refus):
        """The note of an appointment NOT written: the reason + the requested date
        IN CLEAR (nothing obtained on the phone is lost).
        """
        journal.info("Rendez-vous n°%d : date convenue refusée (%s)",
                     rdv["id"], resultat.get("new_datetime"))
        return horaires.note_date_refusee(refus, resultat.get("new_datetime"))

    def appliquer_issue(self, rdv, resultat):
        """The outcome application, exposed to campaigns (same logic, a single
        piece of code). Returns the NOTE when the agreed date was refused,
        otherwise None.
        """
        return self._appliquer_issue(rdv, resultat)

    def _liberer_ancien_de_cascade(self, nom, telephone, pourquoi,
                                   maintenant=None):
        """The contact's old appointment, released when we know which one it is.

        Returns (rendezvous_libere_id, note). The note is the readable text to
        put on the cascade row: either what was released, or why RingBack
        touched nothing. (None, None) when there is simply nothing to say. See
        the comment on NOTE_ANCIEN_AMBIGU for the rule and its limit.
        """
        client_id = self.base.client_connu(nom, telephone)
        if client_id is None:
            return None, None
        a_venir = self.base.rendezvous_a_venir_du_client(client_id)
        if not a_venir:
            return None, None
        if len(a_venir) > 1:
            dates = ", ".join(themes.date_lisible(r["horaire"])
                              for r in a_venir)
            return None, NOTE_ANCIEN_AMBIGU.format(
                nom=nom, nombre=len(a_venir), dates=dates)
        ancien = a_venir[0]
        decision = horaires.decision_annulation(self.preferences,
                                                ancien["horaire"], maintenant)
        self.base.mettre_a_jour_rendezvous(ancien["id"],
                                           statut=decision["statut"])
        journal.info("Cascade : ancien rendez-vous n°%d de %s passé « %s » "
                     "(%s)", ancien["id"], nom, decision["statut"], pourquoi)
        return ancien["id"], NOTE_ANCIEN_LIBERE.format(
            date=themes.date_lisible(ancien["horaire"]),
            statut=decision["statut"], pourquoi=decision["pourquoi"])

    # ----------------------------------------------------------------- cascade
    def executer_cascade(self, personnes, mission, creneau):
        """`First yes` cascade: one call at a time, IN ORDER.

        personnes: a list [{"nom", "telephone"}] already validated (saisie.analyser_liste_cascade); mission: text read by the agent ([créneau] is replaced in it by the date); creneau: ISO 8601. Sequence:
        - `accepted` -> STOP: appointment created (confirmed) at the slot for that person, the following ones are SPARED (never called);
        - `moved`    -> appointment created (scheduled) at the requested date, but the slot stays free: the cascade CONTINUES;
        - `refused`, no answer, technical failure -> next person;
        - list exhausted with no yes -> cascade closed as `épuisée`, honest report.
        A person whose number belongs to a client marked `Ne plus appeler` is NEVER dialled: they are recorded as `exclue`, even when pasted by hand. The SAME guards as the classic queue apply BEFORE any real call. Returns the cascade's id (everything is in the database).
        """
        self._verifier_garde_fous()
        mission_lue = _mission_effective(mission, creneau)
        cascade_id = self.base.creer_cascade(mission_lue, creneau)
        rendezvous_attribue = None
        for rang, personne in enumerate(personnes, start=1):
            nom, telephone = personne["nom"], personne["telephone"]
            # SAFETY NET: the number OR the name of a 🚫 client is enough to set
            # the row aside, even one pasted by hand.
            if self.base.telephone_exclu(telephone) or self.base.nom_exclu(nom):
                journal.info("Cascade n°%d, rang %d : client « Ne plus "
                             "appeler », jamais composé", cascade_id, rang)
                # ⚠ THE REASON IS WRITTEN, not only the state. The cascade is
                # later replayed as a campaign
                # (`campagnes._rejouer_la_cascade`), and it is this note that
                # tells it the person must go to a HUMAN rather than disappear
                # (see db.suite_du_refus).
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="exclu",
                    note=(db.REFUS_STOP
                          if self.base.telephone_exclu(telephone)
                          else db.REFUS_STOP_NOM))
                continue
            if rendezvous_attribue is not None:  # slot already taken: we spare them
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="épargné")
                continue
            try:
                issue = self.client_appels.appeler_cascade(
                    nom, telephone, themes.finaliser(mission_lue, nom), creneau)
            except calle_client.PasDeReponse:
                journal.info("Cascade n°%d, rang %d : pas de réponse", cascade_id, rang)
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="appelé", issue="no_answer")
                continue
            except calle_client.ResultatEnAttente as attente:
                # The call WENT OUT: its row is written (with the CALL-E id in
                # the note, so it is not lost) and the cascade stops. Nobody is
                # declared `no answer` when their phone rang.
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="appelé",
                    issue="en_attente", note=str(attente))
                self.base.cloturer_cascade(cascade_id, "interrompue")
                journal.error("Cascade n°%d : l'appel du rang %d EST PARTI, "
                              "son résultat n'est pas connu (appel CALL-E "
                              "n° %s)", cascade_id, rang, attente.identifiant)
                raise
            except calle_client.ResultatInvalide as refus:
                # The conversation took place; we cannot read it. The row is
                # written with the transcript and the RAW answer — never `no
                # answer`, which would blame the person — and the cascade stops
                # there.
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="appelé",
                    issue="reponse_illisible",
                    transcription=refus.transcription or None,
                    note=str(refus) + (
                        f"\nRéponse brute de CALL-E : {refus.reponse_brute}"
                        if refus.reponse_brute else ""))
                self.base.cloturer_cascade(cascade_id, "interrompue")
                journal.error("Cascade n°%d : l'appel du rang %d a ABOUTI "
                              "mais sa réponse est illisible — %s",
                              cascade_id, rang, refus.constat)
                raise
            except calle_client.EchecDeNotreCote as panne:
                # A failure ON OUR SIDE: the cascade stops DEAD. No row is
                # written for that person (their phone did not ring), the
                # cascade is closed as `interrompue` — never `épuisée`, which
                # would suggest the list had been tried — and the caller
                # receives the message to display.
                self.base.cloturer_cascade(cascade_id, "interrompue")
                journal.error("Cascade n°%d interrompue au rang %d — %s",
                              cascade_id, rang, panne)
                raise
            except Exception as erreur:
                journal.error("Cascade n°%d, rang %d : échec (%s)",
                              cascade_id, rang, erreur)
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="appelé", issue="echec")
                continue
            outcome = issue.resultat["outcome"]
            self._honorer_ne_plus_appeler(issue.resultat, None, nom, telephone)
            libere_id, note_libere = None, None
            if outcome == "accepted":
                # Slot CHOSEN by the user: judged on the closed day and on
                # double booking, not on the opening hours.
                refus = self._refus_date_convenue(creneau, place_choisie=True)
                if refus:
                    # The offered slot no longer holds (taken in the meantime,
                    # day now closed): nothing is written, the cascade
                    # continues and the reason stays readable on the row.
                    journal.info("Cascade n°%d, rang %d : créneau refusé (%s)",
                                 cascade_id, rang, refus)
                    self.base.ajouter_appel_cascade(
                        cascade_id, rang, nom, telephone, etat="appelé",
                        issue=ISSUE_DATE_REFUSEE, resultat=issue.resultat,
                        transcription=issue.transcription, note=refus)
                    continue
                # The old appointment is looked for BEFORE the new one is
                # written: otherwise the new one would count itself among the
                # client's `upcoming appointments`.
                libere_id, note_libere = self._liberer_ancien_de_cascade(
                    nom, telephone, "le client a pris le créneau libéré")
                client_id = self.base.client_pour_contact(nom, telephone)
                rendezvous_attribue = self.base.ajouter_rendezvous(
                    client_id, creneau, MOTIF_CRENEAU_ATTRIBUE, statut="confirmé")
                journal.info("Cascade n°%d : créneau attribué au rang %d "
                             "(rendez-vous n°%d)", cascade_id, rang, rendezvous_attribue)
            elif outcome == "moved":
                refus = self._refus_date_convenue(
                    issue.resultat.get("new_datetime"))
                if refus:
                    journal.info("Cascade n°%d, rang %d : autre date refusée "
                                 "(%s)", cascade_id, rang, refus)
                    self.base.ajouter_appel_cascade(
                        cascade_id, rang, nom, telephone, etat="appelé",
                        issue=ISSUE_DATE_REFUSEE, resultat=issue.resultat,
                        transcription=issue.transcription, note=refus)
                    continue
                # SAME RULE AS `accepted` (Q7): another agreed date must give
                # the old slot back, without which the client would have two
                # appointments. Looked for BEFORE the new one is written.
                libere_id, note_libere = self._liberer_ancien_de_cascade(
                    nom, telephone, "le client a convenu d'une autre date")
                client_id = self.base.client_pour_contact(nom, telephone)
                # ⚠ `confirmé`, LIKE `accepted` JUST ABOVE (17/08/2026). The
                # two ways of saying yes wrote two states: `confirmé` when the
                # person took the offered slot, `prévu` when they agreed
                # another date. The same yes, two differently coloured badges
                # on the schedule, and two different sentences on their record.
                autre = self.base.ajouter_rendezvous(
                    client_id, issue.resultat["new_datetime"], MOTIF_AUTRE_DATE,
                    statut="confirmé")
                journal.info("Cascade n°%d, rang %d : autre date convenue "
                             "(rendez-vous n°%d)", cascade_id, rang, autre)
            self.base.ajouter_appel_cascade(
                cascade_id, rang, nom, telephone, etat="appelé", issue=outcome,
                resultat=issue.resultat, transcription=issue.transcription,
                note=note_libere, rendezvous_libere=libere_id)
        statut_final = "pourvue" if rendezvous_attribue else "épuisée"
        self.base.cloturer_cascade(cascade_id, statut_final, rendezvous_attribue)
        journal.info("Cascade n°%d close : %s", cascade_id, statut_final)
        return cascade_id
