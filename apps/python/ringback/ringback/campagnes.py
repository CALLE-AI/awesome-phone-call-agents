"""Campaigns: WORK THEMES instantiated on a list of the moment.

The product's model: RingBack no longer revolves around the database but around
the EVENT. A campaign = a work theme + a list of contacts imported at that
moment (paste, CSV, ICS or taken from the database) + the parameters of the
moment (editable mission, slot, subject) + the attached calls + a status
(running / finished / closed).

Three work themes — those of the DIRECT paths (the call queue and the cascade), older than the 3-step assistant:
- creneau_libere: the existing `first yes` cascade, ATTACHED to the campaign (the cascade mechanism is not duplicated);
- confirmation  : each contact is called to confirm their appointment (confirmed / moved / cancelled / to follow up);
- manque        : reminders about missed APPOINTMENTS, in batch.

⚠ `contact_unique` and `personnalise` were removed on 03/08/2026, along with
the assistant kinds of the same name: they wrote nothing into the appointment
book. They can no longer be created. Campaigns ALREADY in the database keep
their name on screen — see THEMES_RETIRES: a campaign we can no longer name
would be lost data.

SCHEDULED FOLLOW-UPS — the heart: any call that DOES NOT CONCLUDE (no answer,
technical failure, a move not concluded `to_reschedule`, a refusal to be
requalified on an exhausted cascade) creates a scheduled follow-up that KEEPS
the campaign's theme and parameters. Due date = now + a configurable delay
counted in WORKING HOURS within the permitted calling window; the due date is
editable, attempts are counted (configurable maximum). A follow-up NEVER goes
out on its own: it is a human gesture (`Lancer les relances dues`), and the
SAME locks apply (time window + the planner's three real-call locks, never
duplicated — see Planificateur.verifier_garde_fous).
"""

import datetime
import logging

from . import calle_client, db, horaires, planificateur, saisie, themes
from .saisie import SaisieInvalide

journal = logging.getLogger("ringback.campagnes")

# ------------------------------------------------------- work themes The
# themes that can still be INSTANTIATED (direct paths: queue, cascade).
THEMES_CAMPAGNE = {
    # The cascade is an OPTION of the campaign, not the kind itself: the name
    # stays `Créneau libéré` (the calling policy is displayed separately).
    "creneau_libere": "Créneau libéré",
    "confirmation": "Confirmation de rendez-vous",
    "manque": "Rappel de rendez-vous manqués",
}

# The REMOVED themes, kept in order to NAME the campaigns already in the
# database. They can no longer be created (they are not in _GABARIT_PAR_THEME),
# they can still be read — same rule as assistant.NATURES_RETIREES.
THEMES_RETIRES = {
    "contact_unique": "Contact unique avec sujet (retiré)",
    "personnalise": "Personnalisé (retiré)",
}

# Campaign theme -> mission template (the existing call templates are REUSED,
# not copied).
_GABARIT_PAR_THEME = {
    "creneau_libere": lambda: themes.GABARITS["creneau_libere"],
    "confirmation": lambda: themes.GABARITS["confirmation"],
    "manque": lambda: themes.GABARITS["manque"],
}


def libelle_theme(theme):
    """The readable name of a theme — the removed ones included.

    Everything that DISPLAYS a campaign goes through here. An unknown code
    comes back as it stands: we do not fabricate a label for a value we do not
    recognise.
    """
    return (THEMES_CAMPAGNE.get(theme) or THEMES_RETIRES.get(theme) or theme)

# --------------------------------------------------------------- settings
CLE_RELANCE_DELAI = "relance_delai_heures"  # WORKING hours within the window
CLE_RELANCE_MAX = "relance_max_tentatives"  # maximum follow-ups per contact
RELANCE_DELAI_DEFAUT = 4
# ONE reminder by default (owner's decision, 02/08/2026). Three was the
# original setting; calling someone three times when they have not picked up is
# closer to insistence than to service, and the ceiling can in any case be
# raised campaign by campaign as in the Settings.
RELANCE_MAX_DEFAUT = 1

# Call outcomes classified: what closes the chain, and the follow-up reason.
MOTIFS_RELANCE = {
    "no_answer": "pas de réponse",
    "echec": "échec technique",
    "to_reschedule": "déplacement non conclu",
    "refused": "refus à requalifier",
}

ETIQUETTES_ISSUE = {
    "date_refusee": "Date convenue impossible — à rappeler par un humain",
    "confirmed": "Confirmé",
    "rescheduled": "Déplacé (date convenue)",
    "canceled": "Annulé par le client",
    "to_reschedule": "À reprogrammer (date non conclue)",
    "accepted": "Accepté — créneau attribué",
    "refused": "Refusé",
    "moved": "Autre date convenue",
    "no_answer": "Pas de réponse",
    "echec": "Échec technique",
    # The conversation took place; it is RingBack that could not read what
    # CALL-E made of it. The label NEVER pins that on the contact.
    "reponse_illisible": "Réponse illisible par RingBack — à rappeler par un "
                         "humain",
}


ANCIEN_RELANCE_MAX_DEFAUT = 3


def reprendre_ancien_plafond_de_relances(preferences):
    """Brings a reminder ceiling that equals the OLD default (3) back to 1.

    The owner asked on 02/08/2026 that the ceiling start at 1. Changing the
    constant was not enough: his installation already carried 3, written by the
    old default the first time the Settings were opened — not chosen. He would
    therefore have gone on seeing 3 after asking for 1.

    ONLY the value that exactly equals the old default is touched: a ceiling
    set to 2, 5 or 0 is a choice, and it is respected. The setting stays
    editable in two clicks in ⚙ Réglages → 📞 Appels → Relances.
    """
    if preferences.obtenir(CLE_RELANCE_MAX) == ANCIEN_RELANCE_MAX_DEFAUT:
        preferences.definir(CLE_RELANCE_MAX, RELANCE_MAX_DEFAUT)
        journal.info("Maximum de rappels ramené de %d à %d (ancien défaut, "
                     "jamais choisi) — modifiable dans ⚙ Réglages.",
                     ANCIEN_RELANCE_MAX_DEFAUT, RELANCE_MAX_DEFAUT)
        return True
    return False


# The old MOVE policy, that of §8.2 before its correction of 16/08/2026. See
# `reprendre_ancienne_politique_de_deplacement`.
ANCIENNE_POLITIQUE_DEPLACEMENT = "premier_oui"
CLE_COMPORTEMENT_DEPLACEMENT = "comportement_deplacement"


def reprendre_ancienne_politique_de_deplacement(preferences):
    """Removes from the MOVE setting a policy that equals the OLD default.

    ⚠ SAME CASE AS THE REMINDER CEILING above, and same remedy. §8.2 said `an
    accepted move STOPS the campaign`; that was an assistant proposal, never
    confirmed, corrected on 16/08/2026: a move calls EVERYBODY.

    Changing the kind's default was not enough. The `Options de comportement`
    screen saves its WHOLE block, whichever field was being edited: while
    setting his call-back window (12-2pm), the owner froze the DISPLAYED policy
    along the way — the old default. Measured in his file: `politique:
    premier_oui` on the move.

    He therefore watched his campaign stop at the first contact AFTER the
    correction — 1 accepted, 10 `not called` — and the fix was invisible to
    him. That is exactly what he feared: `be careful not to fall back into the
    trap of fixes that serve no purpose`.

    ⚠ ONLY THE VALUE THAT EQUALS THE OLD DEFAULT IS TOUCHED. A move
    deliberately set to something else would be a choice, and it is respected.
    The setting stays editable in two clicks in ⚙ Réglages → ⚙ Options de
    comportement → 📆 Déplacement.
    """
    regle = preferences.obtenir(CLE_COMPORTEMENT_DEPLACEMENT)
    if not isinstance(regle, dict):
        return False
    if regle.get("politique") != ANCIENNE_POLITIQUE_DEPLACEMENT:
        return False
    reste = {cle: valeur for cle, valeur in regle.items()
             if cle != "politique"}
    preferences.definir(CLE_COMPORTEMENT_DEPLACEMENT, reste)
    journal.info("Déplacement : la politique « %s » écrite par l'ANCIEN défaut "
                 "a été retirée des réglages — cette nature appelle désormais "
                 "tout le monde. Modifiable dans ⚙ Réglages.",
                 ANCIENNE_POLITIQUE_DEPLACEMENT)
    return True


def parametres_relance(preferences):
    """(delay in working hours, maximum number of follow-ups) from the settings.
    """
    try:
        delai = int(preferences.obtenir(CLE_RELANCE_DELAI, RELANCE_DELAI_DEFAUT))
    except (TypeError, ValueError):
        delai = RELANCE_DELAI_DEFAUT
    try:
        maximum = int(preferences.obtenir(CLE_RELANCE_MAX, RELANCE_MAX_DEFAUT))
    except (TypeError, ValueError):
        maximum = RELANCE_MAX_DEFAUT
    return delai, maximum


def gabarit_mission(theme, preferences, sujet=""):
    """The campaign theme's pre-filled mission — EDITABLE on screen.

    Substitutes the settings ([entreprise], [créneaux_disponibles],
    [plage_rappel]) and [sujet] when it is known; [client], [date_rdv] and
    [créneau] stay substituted PER CALL. Raises ValueError for an unknown
    theme.
    """
    if theme not in _GABARIT_PAR_THEME:
        raise ValueError(f"Thème de campagne inconnu : {theme!r}")
    texte = themes.substituer_reglages(_GABARIT_PAR_THEME[theme](), preferences)
    if sujet:
        texte = texte.replace("[sujet]", sujet)
    return texte


# ------------------------------------------------------------ nom lisible
def _creneau_court(iso):
    """« 2026-08-03T14:00 » devient « 03/08 14h » (« 14h30 » si minutes)."""
    try:
        moment = datetime.datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return iso or ""
    heure = f"{moment.hour}h" + (f"{moment.minute:02d}" if moment.minute else "")
    return f"{moment:%d/%m} {heure}"


def nom_auto(theme, creneau=None, sujet="", nb_contacts=0, quand=None):
    """An automatic, readable campaign name: `Créneau libéré du 03/08 14h —
    28/07`.

    `sujet` is no longer used: it served only the `contact unique` theme,
    removed on 03/08/2026. The parameter stays so as not to break callers.
    """
    if quand is None:
        quand = datetime.date.today()
    jour = f"{quand:%d/%m}"
    if theme == "creneau_libere" and creneau:
        return f"Créneau libéré du {_creneau_court(creneau)} — {jour}"
    if theme == "confirmation":
        return f"Confirmation de rendez-vous ({nb_contacts} contact(s)) — {jour}"
    return (f"{libelle_theme(theme)} ({nb_contacts} contact(s)) — {jour}")


# --------------------------------------------- due date in working hours
# SEARCH LIMIT for an open day. A follow-up can only fall due when somebody is
# working; if EVERYTHING is closed over that span (a typical week empty
# throughout, or a whole year declared closed), we stop looking rather than
# spin forever — and we SAY what we do: the computation then falls back on the
# only rule left, the time window alone, with a warning in the log. No
# follow-up is lost.
JOURS_CHERCHES_ECHEANCE = 366


def _minutes_hhmm(texte):
    """« 09:30 » devient 570 (minutes depuis minuit)."""
    heures, _, minutes = (texte or "").partition(":")
    return int(heures) * 60 + int(minutes)


def jour_travaille(jour, preferences):
    """True when the practice works THAT day (typical week + closed days).

    Two rules, neither duplicated: the declared closed days
    (horaires.est_ferme) and the open days of the typical week
    (horaires.semaine). As long as NO typical week is configured, RingBack does
    not know the open days and does not invent any: every day stays possible,
    exactly as before.
    """
    if horaires.est_ferme(preferences, jour) is not None:
        return False
    if not horaires.semaine_ouverte(preferences):
        return True
    return bool(horaires.semaine(preferences)[jour.weekday()])


def _fenetres_appelables(jour, debut, fin, preferences):
    """The intervals [start, end[ IN MINUTES where a follow-up may fall due.

    The permitted calling window, MINUS the forbidden period (which may cross
    midnight, in which case it cuts the window into two pieces). Returns an
    empty list when the day is closed or when the forbidden period covers the
    whole window: that day counts no working hours.
    """
    ouverture, fermeture = _minutes_hhmm(debut), _minutes_hhmm(fin)
    if fermeture <= ouverture:
        return []
    periode = None
    if preferences is not None:
        if not jour_travaille(jour, preferences):
            return []
        # Local import: assistant imports this module, so the reverse cannot be
        # done at the top of the file.
        from . import assistant
        periode = assistant.periode_interdite(preferences)
    fenetres = [(ouverture, fermeture)]
    if periode:
        interdit_debut, interdit_fin = (_minutes_hhmm(x) for x in periode)
        if interdit_debut <= interdit_fin:
            interdits = [(interdit_debut, interdit_fin)]
        else:                       # traverse minuit (20:00 → 08:00)
            interdits = [(0, interdit_fin), (interdit_debut, 24 * 60)]
        for barre_debut, barre_fin in interdits:
            reste = []
            for f_debut, f_fin in fenetres:
                if f_debut < barre_debut:
                    reste.append((f_debut, min(f_fin, barre_debut)))
                if f_fin > barre_fin:
                    reste.append((max(f_debut, barre_fin), f_fin))
            fenetres = [(a, b) for a, b in reste if b > a]
    return fenetres


def echeance_apres_heures_ouvrees(maintenant, heures, debut, fin,
                                  preferences=None):
    """The due date after `heures` counted while the practice IS WORKING.

    debut/fin: `HH:MM` (the window from the settings). Time outside the window
    does not count: `+4 working hours` asked for at 6pm with a 9am-7pm window
    give 12pm the next day. A start outside the window is first brought back to
    the next opening; heures=0 returns that next opening (or the very moment
    when it is already within the window).

    preferences: the settings. With them, the due date ALSO respects the
    forbidden period, the open days of the typical week and the declared closed
    days — so a follow-up never falls on a day when nobody works, and `should
    someone ask to be called back, an employee can do it`. Without them
    (isolated tests, historic calls), only the time window is known: the
    computation is exactly the one from before.
    """
    restant = datetime.timedelta(hours=heures)
    depart = maintenant.replace(second=0, microsecond=0)
    jour = depart.date()
    fin_de_plage = _minutes_hhmm(fin)
    for _ in range(JOURS_CHERCHES_ECHEANCE):
        minuit = datetime.datetime.combine(jour, datetime.time())
        for f_debut, f_fin in _fenetres_appelables(jour, debut, fin, preferences):
            ouverture = minuit + datetime.timedelta(minutes=f_debut)
            fermeture = minuit + datetime.timedelta(minutes=f_fin)
            moment = max(ouverture, depart)
            if moment >= fermeture:
                continue
            disponible = fermeture - moment
            # The count falls EXACTLY at the end of the window: acceptable when
            # that is the end of the calling window (7pm is still permitted
            # there), but not when it is the forbidden period that cut it off —
            # we do not fall due at the very instant calls become forbidden
            # again. The remainder then goes to zero and the due date becomes
            # the start of the next window, where somebody can call.
            if disponible > restant or (disponible == restant
                                        and f_fin == fin_de_plage):
                return moment + restant
            restant -= disponible
        jour += datetime.timedelta(days=1)
    if preferences is None:
        raise ValueError(
            "Échéance de relance introuvable : plage horaire invalide.")
    # Limit reached: nothing open over a whole year. We SAY so, and fall back
    # on the time window alone rather than lose the follow-up.
    journal.warning(
        "Aucun jour ouvert trouvé dans les %d prochains jours (semaine type "
        "et jours fermés) : l'échéance de relance est calculée sur la seule "
        "plage d'appel %s-%s. Ouvrez des jours dans « ⚙ Réglages » pour "
        "qu'elle retombe sur un jour travaillé.",
        JOURS_CHERCHES_ECHEANCE, debut, fin)
    return echeance_apres_heures_ouvrees(maintenant, heures, debut, fin)


def echeance_relance(preferences, maintenant=None):
    """The due date of the next follow-up according to the settings, in ISO 8601.
    """
    if maintenant is None:
        maintenant = datetime.datetime.now()
    delai, _ = parametres_relance(preferences)
    debut, fin = themes.plage(preferences)
    echeance = echeance_apres_heures_ouvrees(maintenant, delai, debut, fin,
                                             preferences)
    return echeance.isoformat(timespec="minutes")


# ------------------------------------------------- listes de l'instant
def analyser_csv_contacts(texte):
    """Parses a contacts CSV for a campaign; returns (people, errors).

    Expected header: `nom;telephone` — the extra columns of the old format
    (date_heure;motif) are tolerated and ignored: only the list of the moment
    counts, the database is not modified. Duplicates reported.
    """
    lignes = [ligne for ligne in (texte or "").splitlines()]
    non_vides = [(numero, ligne) for numero, ligne in enumerate(lignes, start=1)
                 if ligne.strip()]
    if not non_vides:
        raise SaisieInvalide("Fichier vide : aucune ligne à importer.")
    entete = [cellule.strip().lower()
              for cellule in non_vides[0][1].split(";")]
    if entete[:2] != ["nom", "telephone"]:
        raise SaisieInvalide(
            "En-tête invalide : attendu « nom;telephone » (les colonnes "
            f"supplémentaires sont ignorées), reçu « {';'.join(entete)} ».")
    personnes, erreurs = [], []
    deja_vus = {}
    for numero, ligne in non_vides[1:]:
        cellules = [cellule.strip() for cellule in ligne.split(";")]
        if len(cellules) < 2:
            erreurs.append(f"Ligne {numero} : 2 colonnes minimum attendues "
                           "(nom;telephone).")
            continue
        try:
            nom = saisie.valider_nom(cellules[0])
            telephone = saisie.valider_telephone(cellules[1])
        except SaisieInvalide as erreur:
            erreurs.append(f"Ligne {numero} : {erreur}")
            continue
        if telephone in deja_vus:
            erreurs.append(f"Ligne {numero} : même numéro que la ligne "
                           f"{deja_vus[telephone]} — doublon ignoré.")
            continue
        deja_vus[telephone] = numero
        personnes.append({"nom": nom, "telephone": telephone})
    return personnes, erreurs


def contacts_depuis_rendezvous(base, statut, debut=None, fin=None,
                               ecartes=None):
    """Contacts tied to `prévu` (upcoming) or `manqué` appointments.

    Returns (contacts, sans_numero, exclus_stop) — contacts = [{"nom",
    "telephone", "rendezvous_id"}] with the number IN CLEAR (internal use:
    composing a call list explicitly requested). The 🚫 `Ne plus appeler`
    contacts and those with no number are set aside and counted; the same
    client appears only once (first appointment).

    `ecartes`: a dictionary TO BE FILLED when the caller makes SEVERAL calls
    and must count those set aside only once per person. It receives two sets
    of client ids, `sans_numero` and `stop`, which the caller merges from one
    call to the next. Both report values stay there for the twenty callers that
    do not need this.

    ⚠ WHY THIS DICTIONARY EXISTS (14/08/2026, cross audit). The `chosen days`
    reminder calls this function ONCE PER DAY and added the counts up: a person
    with an appointment on Monday AND on Friday was counted twice among those
    set aside, while the list itself de-duplicated them. The screen therefore
    announced `2 with no number set aside` where there was only one person —
    the very defect the owner had reported the day before on another screen.

    `debut` / `fin` (ISO text, a HALF-OPEN interval) bound the period: that is
    what makes it possible to build a `week 48` or a `Tuesday` campaign
    (02/08/2026). Without bounds, the behaviour does not change by a character
    — and above all, the exclusion rules below stay the same in both cases:
    they are written only once.
    """
    if statut not in ("prévu", "manqué", "poses", "a_recaser"):
        raise ValueError(f"Statut de reprise inconnu : {statut!r}")
    # ⚠ `poses` = what the SCHEDULE shows: scheduled AND confirmed. A confirmed
    # appointment occupies a slot and deserves a reminder — leaving it out
    # meant a week showing 13 appointments only took a few of them back, and
    # sometimes none (observed by the owner on 02/08/2026: `error 409 when
    # there is indeed an appointment`).
    statuts = horaires.STATUTS_OCCUPANTS if statut == "poses" else (statut,)
    # `a_recaser`: cancelled + missed + moved WITHOUT any upcoming appointment.
    # That `with no upcoming appointment` is not expressed by a status filter:
    # it has its own query. What follows is common — setting aside the `do not
    # call again`, those with no number and the duplicates must exist in only
    # one place.
    if statut == "a_recaser":
        lignes = base.rendezvous_a_recaser(debut, fin)
    elif debut or fin:
        # ⚠ `OR`, NOT `AND` (09/08/2026). A single bound is a legitimate case —
        # `from the slot, with no limit` — and requiring them in pairs made it
        # fall over ENTIRELY: the rule then took back every upcoming
        # appointment, including those BEFORE the slot, for whom bringing it
        # forward gains nothing. The same trap had already been fixed in
        # `rendezvous_a_recaser` on 03/08; it was still here.
        lignes = base.rendezvous_de_periode(debut, fin, statuts=statuts)
    elif statut == "poses":
        lignes = base.rendezvous_a_venir_tous()
    elif statut == "prévu":
        lignes = base.rendezvous_a_venir()
    else:
        lignes = base.rendezvous_manques()
    # ⚠ WE COUNT PEOPLE, NOT APPOINTMENTS (13/08/2026). The screen writes `63
    # client(s) with no number set aside`: it was counting calendar ROWS, and
    # the same person with no number has ten of them. The owner read `101
    # clients with no number` in his database — the real number of people was
    # far smaller, and that inflated figure sent him looking in the wrong
    # place. A count of people is what the sentence promises.
    contacts, sans_numero, exclus_stop = [], set(), set()
    deja_vus = set()
    for rdv in lignes:
        if rdv["ne_plus_appeler"]:
            exclus_stop.add(rdv["client_id"])
            continue
        telephone = base.telephone_de(rdv["client_id"])
        if not telephone:
            sans_numero.add(rdv["client_id"])
            continue
        if telephone in deja_vus:
            continue
        deja_vus.add(telephone)
        contacts.append({"nom": rdv["nom"], "telephone": telephone,
                         "rendezvous_id": rdv["id"]})
    if ecartes is not None:
        ecartes.setdefault("sans_numero", set()).update(sans_numero)
        ecartes.setdefault("stop", set()).update(exclus_stop)
    return contacts, len(sans_numero), len(exclus_stop)


# ------------------------------------------------------ creation + calls
def creer_campagne(base, theme, contacts, mission, creneau=None, sujet="",
                   cascade_id=None, quand=None):
    """Creates the campaign and its contacts (state `à appeler`); returns its id.
    """
    nom = nom_auto(theme, creneau=creneau, sujet=sujet,
                   nb_contacts=len(contacts), quand=quand)
    campagne_id = base.creer_campagne(nom, theme, sujet=sujet, mission=mission,
                                      creneau=creneau, cascade_id=cascade_id)
    for rang, contact in enumerate(contacts, start=1):
        base.ajouter_contact_campagne(
            campagne_id, rang, contact["nom"], contact["telephone"],
            rendezvous_id=contact.get("rendezvous_id"))
    return campagne_id


def mettre_a_jour_statut_campagne(base, campagne_id):
    """Status `en cours` as long as a follow-up is scheduled, otherwise
    `terminée`.

    A campaign closed by hand stays closed. Returns the status chosen.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if campagne is None or campagne["statut"] in ("close", "en pause"):
        # `en pause` is respected like `close`: a campaign stopped by a failure
        # ON OUR SIDE must not be declared `terminée` at the first
        # recomputation — it is waiting to be resumed, as it stands.
        return campagne["statut"] if campagne else None
    if campagne.get("nature"):
        # An assistant campaign: its status (ready, running, paused, stopped,
        # finished) is driven by its own engine — we do not touch it.
        return campagne["statut"]
    pendantes = [r for r in base.relances_de_campagne(campagne_id)
                 if r["statut"] == "planifiée"]
    statut = "en cours" if pendantes else "terminée"
    if statut != campagne["statut"]:
        base.changer_statut_campagne(campagne_id, statut)
    return statut


def clore_campagne(base, campagne_id):
    """Manual closure: the scheduled follow-ups are cancelled; returns their
    number.
    """
    annulees = base.annuler_relances_campagne(campagne_id)
    # ⚠ THE THIRD MOMENT. Closing by hand cancels the follow-ups: no further
    # attempt will come, so the moves left in suspense are settled here too.
    # The order matters — the follow-ups fall FIRST, otherwise the closure
    # would believe we were still going to call back.
    from . import assistant as _assistant
    _assistant.cloturer_les_deplacements_non_faits(
        base, base.obtenir_campagne(campagne_id))
    base.changer_statut_campagne(campagne_id, "close")
    journal.info("Campagne n°%d close à la main (%d relance(s) annulée(s))",
                 campagne_id, annulees)
    return annulees


def _planifier_relance(base, preferences, campagne_id, contact_id, motif,
                       tentative, maintenant=None):
    """Schedules the `tentative` follow-up when the maximum allows it.

    Returns the follow-up's id, or None when the maximum number of attempts is
    reached (the contact then becomes `abandonné` at the caller's end).
    """
    _, maximum = parametres_relance(preferences)
    if tentative > maximum:
        return None
    echeance = echeance_relance(preferences, maintenant)
    return base.creer_relance(campagne_id, contact_id, echeance,
                              tentative=tentative, motif=motif)


def _issue_apres_echec(base, preferences, campagne, contact_id, issue, motif,
                       tentative_suivante, maintenant=None):
    """Records a call that did not conclude: follow-up scheduled or chain
    abandoned.
    """
    relance_id = _planifier_relance(base, preferences, campagne["id"],
                                    contact_id, motif, tentative_suivante,
                                    maintenant)
    if relance_id is None:
        base.changer_etat_contact_campagne(contact_id, "abandonné", issue)
        journal.info("Campagne n°%d, contact n°%d : maximum de tentatives "
                     "atteint — chaîne abandonnée", campagne["id"], contact_id)
    else:
        base.changer_etat_contact_campagne(contact_id, "appelé", issue)
    return relance_id


def _rendezvous_reference(base, campagne, contact):
    """The `support` appointment of the classic call + the date for [date_rdv].

    Contact taken from the database: THEIR appointment. Pasted contact: a
    synthetic support built on the campaign's slot (or the current moment) — it
    is NOT written to the database, it serves only the call client.
    """
    if contact.get("rendezvous_id"):
        rdv = base.obtenir_rendezvous(contact["rendezvous_id"])
        if rdv is not None:
            return rdv, rdv["horaire"]
    horaire = campagne.get("creneau") or datetime.datetime.now().isoformat(
        timespec="minutes")
    motif = campagne.get("sujet") or THEMES_CAMPAGNE.get(campagne["theme"],
                                                         campagne["theme"])
    return {"horaire": horaire, "motif": motif}, campagne.get("creneau")


def _appliquer_issue_classique(base, planif, preferences, campagne, contact,
                               resultat):
    """Applies a CONCLUDED campaign-call outcome to the database.

    Contact tied to an appointment: the planner's existing logic is reused
    (confirmed / smart shift / cancelled). Contact with no appointment: the
    outcome creates what is missing (a confirmed or scheduled appointment at
    the agreed date) — a `canceled` creates nothing.

    Returns the REFUSAL message when the agreed date does not hold (closed day,
    outside hours, slot taken, length too short): nothing is written then.
    """
    statut = resultat["appointment_status"]
    if contact.get("rendezvous_id"):
        rdv = base.obtenir_rendezvous(contact["rendezvous_id"])
        if rdv is not None:
            return planif.appliquer_issue(rdv, resultat)
    if statut in ("confirmed", "rescheduled") and resultat.get("new_datetime"):
        refus = horaires.refus_rendezvous_telephone(
            base, preferences, resultat["new_datetime"])
        if refus:
            return horaires.note_date_refusee(refus, resultat["new_datetime"])
        client_id = (base.client_du_contact(contact["id"])
                     or base.client_pour_contact(
                         contact["nom"],
                         base.telephone_contact_campagne(contact["id"])))
        # ⚠ `confirmé` IN BOTH CASES (17/08/2026). The two ways of accepting on
        # the phone gave two different states here — `confirmé` for the offered
        # slot, `prévu` for another agreed date — hence two differently
        # coloured badges on the schedule for the same yes, and two different
        # sentences on the client's record. The person said yes: that is an
        # agreement, not a forecast.
        base.ajouter_rendezvous(
            client_id, resultat["new_datetime"],
            campagne.get("sujet") or f"Campagne : {campagne['nom']}",
            statut="confirmé")
    return None


def _appeler_contact_classique(base, planif, preferences, campagne, contact,
                               tentative, maintenant=None):
    """Places ONE campaign call (non-cascade themes) and applies what follows.

    Returns a report dictionary {contact, issue, abouti}. The locks have
    already been checked by the caller (verifier_garde_fous). The number
    dialled is the one on the CLIENT RECORD at the moment of the call, and the
    🚫 safety net (number OR name) is read back here.
    """
    contact_id = contact["id"]
    cible = base.cible_appel_contact(contact_id)
    if cible["refus"]:
        etat, detail = db.suite_du_refus(cible["refus"])
        base.changer_etat_contact_campagne(contact_id, etat, None)
        base.definir_detail_contact(contact_id, detail)
        journal.info("Campagne n°%d : contact n°%d NON composé — %s (%s)",
                     campagne["id"], contact_id, cible["refus"], etat)
        return {"contact": contact["nom"], "issue": None, "abouti": False,
                "etat": etat, "refus": cible["refus"]}
    telephone = cible["telephone"]
    rdv_support, date_rdv = _rendezvous_reference(base, campagne, contact)
    mission = themes.finaliser(campagne["mission"], contact["nom"], date_rdv)
    try:
        issue_appel = planif.client_appels.appeler(
            contact["nom"], telephone, rdv_support, mission=mission or None)
    except calle_client.PasDeReponse:
        code = "no_answer"
        base.ajouter_appel_campagne(campagne["id"], contact_id, tentative,
                                    issue=code)
        _issue_apres_echec(base, preferences, campagne, contact_id, code,
                           MOTIFS_RELANCE[code], tentative + 1, maintenant)
        return {"contact": contact["nom"], "issue": code, "abouti": False,
                "etat": "appelé"}
    except calle_client.ResultatEnAttente as attente:
        # The call WENT OUT: its id is kept and the state that tells the truth
        # is written. No attempt, no `injoignable`.
        from . import assistant
        assistant._noter_resultat_en_attente(base, contact_id, tentative,
                                             attente)
        raise
    except calle_client.ResultatInvalide as refus:
        # THE CONVERSATION TOOK PLACE and RingBack could not read it: the
        # contact goes to a HUMAN with the raw answer, never to an automatic
        # follow-up. Same writing as the assistant's campaigns — one place
        # only, so no divergence.
        from . import assistant
        assistant.noter_reponse_illisible(base, campagne["id"], contact_id,
                                          tentative, refus)
        raise
    except calle_client.EchecDeNotreCote:
        # A failure ON OUR SIDE: nothing is written about this contact (their
        # phone did not ring), and the caller stops the campaign.
        raise
    except Exception as erreur:  # technical failure: never an invented result
        journal.error("Campagne n°%d, contact n°%d : échec (%s)",
                      campagne["id"], contact_id, erreur)
        code = "echec"
        base.ajouter_appel_campagne(campagne["id"], contact_id, tentative,
                                    issue=code)
        _issue_apres_echec(base, preferences, campagne, contact_id, code,
                           MOTIFS_RELANCE[code], tentative + 1, maintenant)
        return {"contact": contact["nom"], "issue": code, "abouti": False,
                "etat": "appelé"}
    statut = issue_appel.resultat["appointment_status"]
    base.ajouter_appel_campagne(campagne["id"], contact_id, tentative,
                                issue=statut, resultat=issue_appel.resultat,
                                transcription=issue_appel.transcription)
    if statut == "to_reschedule":
        _issue_apres_echec(base, preferences, campagne, contact_id, statut,
                           MOTIFS_RELANCE[statut], tentative + 1, maintenant)
        return {"contact": contact["nom"], "issue": statut, "abouti": False,
                "etat": "appelé"}
    refus = _appliquer_issue_classique(base, planif, preferences, campagne,
                                       contact, issue_appel.resultat)
    if refus:
        # The date agreed on the phone does not hold: NOTHING is written to the
        # schedule, and a human takes over with the date in clear.
        base.changer_etat_contact_campagne(contact_id,
                                           "à rappeler par un humain",
                                           planificateur.ISSUE_DATE_REFUSEE)
        base.definir_detail_contact(contact_id, refus)
        return {"contact": contact["nom"],
                "issue": planificateur.ISSUE_DATE_REFUSEE, "abouti": False,
                "etat": "à rappeler par un humain", "refus": refus}
    base.changer_etat_contact_campagne(contact_id, "abouti", statut)
    return {"contact": contact["nom"], "issue": statut, "abouti": True,
            "etat": "abouti"}


def executer_campagne_initiale(base, planif, preferences, campagne_id,
                               maintenant=None):
    """The INITIAL calls of a non-cascade campaign, one contact at a time.

    Checks the planner's three locks first (the same ones as everywhere).
    Returns the list of reports. The campaign's status is recomputed at the end
    (running when follow-ups exist).
    """
    planif.verifier_garde_fous()
    campagne = base.obtenir_campagne(campagne_id)
    comptes_rendus = []
    for contact in base.contacts_de_campagne(campagne_id):
        if contact["etat"] != "à appeler":
            continue
        try:
            comptes_rendus.append(_appeler_contact_classique(
                base, planif, preferences, campagne, contact, tentative=0,
                maintenant=maintenant))
        except calle_client.EchecDeNotreCote as panne:
            # A failure ON OUR SIDE: the campaign stops HERE, paused. Contacts
            # not yet called stay `à appeler` — resuming will find them intact
            # (see assistant.mettre_en_pause_sur_panne, same rule, written
            # once).
            from . import assistant
            assistant.mettre_en_pause_sur_panne(base, campagne_id, panne)
            # The state READ BACK from the database, never assumed: when the
            # conversation took place and its answer was unreadable, that
            # contact did NOT stay `à appeler` — they are waiting for a human,
            # and the report must say so.
            frais = base.obtenir_contact_campagne(contact["id"]) or contact
            comptes_rendus.append({"contact": contact["nom"],
                                   "issue": frais["issue"], "abouti": False,
                                   "etat": frais["etat"], "panne": str(panne)})
            return comptes_rendus
    mettre_a_jour_statut_campagne(base, campagne_id)
    return comptes_rendus


# ------------------------------------------------- rattachement cascade
def _cahier_de_cascade(base, preferences, campagne_id, contact, appel):
    """Transcribes into the CHANGE LOG what the cascade decided about the old
    appointment.

    The direct cascade runs BEFORE its campaign exists: the decision is therefore taken and written at the moment of the change, on the cascade row (note + rendezvous_libere), then transcribed here, identically. Nothing is recomputed, nothing is guessed.
    - an old appointment really WAS released → a ➖ row, with its date, its reason, its length and the reason why;
    - RingBack did not know which one it was → a 🙋 row: a human must go and release it in the establishment's own calendar.
    """
    note = appel.get("note")
    if not note:
        return
    base.definir_detail_contact(contact["id"], note)
    ancien_id = appel.get("rendezvous_libere")
    if not ancien_id:
        base.ajouter_changement(campagne_id, "humain", contact["nom"],
                                contact_id=contact["id"], raison=note)
        return
    ancien = base.obtenir_rendezvous(ancien_id)
    if ancien is None:  # record deleted in the meantime: we claim nothing
        base.ajouter_changement(campagne_id, "humain", contact["nom"],
                                contact_id=contact["id"], raison=note)
        return
    # ⚠ THE KIND FOLLOWS THE STATUS ACTUALLY WRITTEN on the appointment (read
    # back above, never guessed): `➖ supprimé` when the slot reopens, `✖
    # annulé` when it stays blocked. See horaires.genre_de_retrait.
    base.ajouter_changement(
        campagne_id, horaires.genre_de_retrait(ancien["statut"]),
        contact["nom"], contact_id=contact["id"],
        client_id=ancien.get("client_id"), rendezvous_id=ancien_id,
        ancienne_date=ancien["horaire"], motif=ancien.get("motif") or "",
        duree=horaires.tranches_lisibles(
            horaires.duree_tranches(ancien), horaires.pas_minutes(preferences)),
        raison=note)


def campagne_depuis_cascade(base, preferences, cascade_id, personnes,
                            mission, creneau, maintenant=None):
    """Wraps an ALREADY EXECUTED `first yes` cascade inside a campaign.

    personnes: the list (numbers in clear) passed to the cascade, in the same
    order as its ranks. The cascade's outcomes become the contacts' states;
    when the slot is NOT filled, those that did not conclude (no answer,
    failure, refusal to be requalified) receive a follow-up that keeps the
    theme. Returns the campaign's id.
    """
    cascade = base.obtenir_cascade(cascade_id)
    campagne_id = creer_campagne(
        base, "creneau_libere", personnes, mission, creneau=creneau,
        cascade_id=cascade_id, quand=maintenant.date() if maintenant else None)
    contacts = base.contacts_de_campagne(campagne_id)
    pourvue = cascade and cascade["statut"] == "pourvue"
    campagne = base.obtenir_campagne(campagne_id)
    for appel in base.appels_de_cascade(cascade_id):
        contact = contacts[appel["rang"] - 1]
        if appel["etat"] == "épargné":
            base.changer_etat_contact_campagne(contact["id"], "épargné", None)
            continue
        if appel["etat"] == "exclu":
            # A 🚫: the person goes to a human, with the reason in clear (see
            # db.suite_du_refus). Cascades from before 20/08/2026 have no note
            # — they fall back on `exclu`, as before.
            etat, detail = db.suite_du_refus(appel["note"])
            base.changer_etat_contact_campagne(contact["id"], etat, None)
            if detail:
                base.definir_detail_contact(contact["id"], detail)
            continue
        issue = appel["issue"]
        base.ajouter_appel_campagne(
            campagne_id, contact["id"], tentative=0, issue=issue,
            resultat=appel["resultat"], transcription=appel["transcription"])
        if issue == planificateur.ISSUE_DATE_REFUSEE:
            # Yes obtained, impossible date: a HUMAN takes over, with the
            # reason in clear. No automatic follow-up is armed.
            base.changer_etat_contact_campagne(
                contact["id"], "à rappeler par un humain", issue)
            base.definir_detail_contact(contact["id"], appel.get("note"))
        elif issue in ("accepted", "moved"):
            base.changer_etat_contact_campagne(contact["id"], "abouti", issue)
            _cahier_de_cascade(base, preferences, campagne_id, contact, appel)
        elif pourvue:
            # Slot filled: the objective is met, nobody is followed up.
            base.changer_etat_contact_campagne(contact["id"], "appelé", issue)
        else:
            _issue_apres_echec(base, preferences, campagne, contact["id"],
                               issue, MOTIFS_RELANCE.get(issue, issue),
                               tentative_suivante=1, maintenant=maintenant)
    mettre_a_jour_statut_campagne(base, campagne_id)
    return campagne_id


def campagne_depuis_file(base, preferences, appels, mission, maintenant=None):
    """Wraps a run of the call queue inside a `manque` campaign.

    appels: the list of (appel_id) handled — their outcomes are read back from
    the database. Failures (no answer or incident) and the `to_reschedule` ones
    receive a follow-up that keeps the theme. Returns the campaign's id, or
    None when the list is empty.
    """
    if not appels:
        return None
    contacts = []
    detail = []
    for appel_id in appels:
        appel = base.obtenir_appel(appel_id)
        if appel is None:
            continue
        rdv = base.obtenir_rendezvous(appel["rendezvous_id"])
        if rdv is None:
            continue
        telephone = base.telephone_de(rdv["client_id"]) or ""
        contacts.append({"nom": rdv["nom"], "telephone": telephone,
                         "rendezvous_id": rdv["id"]})
        detail.append(appel)
    campagne_id = creer_campagne(
        base, "manque", contacts, mission,
        quand=maintenant.date() if maintenant else None)
    campagne = base.obtenir_campagne(campagne_id)
    lignes = base.contacts_de_campagne(campagne_id)
    for contact, appel in zip(lignes, detail):
        resultat = appel["resultat"]
        if appel["statut"] == "terminé" and resultat:
            issue = resultat["appointment_status"]
            base.ajouter_appel_campagne(
                campagne_id, contact["id"], tentative=0, issue=issue,
                resultat=resultat, transcription=appel["transcription"])
            if appel.get("note"):
                # The planner REFUSED to write the agreed date: the contact
                # goes to a call-back by a human, reason included.
                base.changer_etat_contact_campagne(
                    contact["id"], "à rappeler par un humain",
                    planificateur.ISSUE_DATE_REFUSEE)
                base.definir_detail_contact(contact["id"], appel["note"])
            elif issue == "to_reschedule":
                _issue_apres_echec(base, preferences, campagne, contact["id"],
                                   issue, MOTIFS_RELANCE[issue],
                                   tentative_suivante=1, maintenant=maintenant)
            else:
                base.changer_etat_contact_campagne(contact["id"], "abouti", issue)
        elif appel["statut"] == "annulé" and appel.get("note"):
            # A call never dialled (🚫 read back at the last moment, record
            # deleted): it is said, and no follow-up is armed.
            base.ajouter_appel_campagne(campagne_id, contact["id"],
                                        tentative=0, issue=None)
            etat, detail = db.suite_du_refus(appel["note"])
            base.changer_etat_contact_campagne(contact["id"], etat, None)
            base.definir_detail_contact(contact["id"], detail)
        else:
            # The planner's `échec`: no answer or incident — the classic queue
            # does not tell the two apart.
            issue = "echec"
            base.ajouter_appel_campagne(campagne_id, contact["id"],
                                        tentative=0, issue=issue)
            _issue_apres_echec(base, preferences, campagne, contact["id"],
                               issue, "pas de réponse ou échec technique",
                               tentative_suivante=1, maintenant=maintenant)
    mettre_a_jour_statut_campagne(base, campagne_id)
    return campagne_id


def _date_refusee(base, campagne, contact, issue, refus, date_convenue):
    """The client said yes, but the date does not hold: NOTHING is written.

    The contact becomes `à rappeler par un humain` with the reason AND the
    requested date in clear — nothing obtained on the phone is lost, but the
    schedule never becomes wrong. Returns the report.
    """
    detail = horaires.note_date_refusee(refus, date_convenue)
    base.changer_etat_contact_campagne(contact["id"],
                                       "à rappeler par un humain",
                                       planificateur.ISSUE_DATE_REFUSEE)
    base.definir_detail_contact(contact["id"], detail)
    journal.info("Campagne n°%d, contact n°%d : date convenue refusée (%s)",
                 campagne["id"], contact["id"], date_convenue)
    return {"contact": contact["nom"],
            "issue": planificateur.ISSUE_DATE_REFUSEE, "abouti": False,
            "etat": "à rappeler par un humain", "refus": detail,
            "issue_agent": issue}


# --------------------------------------------------------------- relances
def _executer_relance_cascade(base, planif, preferences, campagne, relance,
                              contact, maintenant=None):
    """A `freed slot` campaign follow-up: re-offer THE slot."""
    cible = base.cible_appel_contact(contact["id"])
    if cible["refus"]:
        etat, detail = db.suite_du_refus(cible["refus"])
        base.changer_etat_contact_campagne(contact["id"], etat, None)
        base.definir_detail_contact(contact["id"], detail)
        journal.info("Relance n°%d NON composée — %s (%s)", relance["id"],
                     cible["refus"], etat)
        return {"contact": contact["nom"], "issue": None, "abouti": False,
                "etat": etat, "refus": cible["refus"]}
    telephone = cible["telephone"]
    mission = themes.finaliser(campagne["mission"], contact["nom"])
    try:
        issue_appel = planif.client_appels.appeler_cascade(
            contact["nom"], telephone, mission, campagne["creneau"])
    except calle_client.PasDeReponse:
        code = "no_answer"
        base.ajouter_appel_campagne(campagne["id"], contact["id"],
                                    relance["tentative"], issue=code)
        _issue_apres_echec(base, preferences, campagne, contact["id"], code,
                           MOTIFS_RELANCE[code], relance["tentative"] + 1,
                           maintenant)
        return {"contact": contact["nom"], "issue": code, "abouti": False,
                "etat": "appelé"}
    except calle_client.ResultatEnAttente as attente:
        # The call WENT OUT: id kept, honest state, no attempt counted (same
        # rule as everywhere else).
        from . import assistant
        assistant._noter_resultat_en_attente(base, contact["id"],
                                             relance["tentative"], attente)
        raise
    except calle_client.ResultatInvalide as refus:
        # The conversation took place; we cannot read it. To a human, raw
        # answer kept, no further follow-up.
        from . import assistant
        assistant.noter_reponse_illisible(base, campagne["id"], contact["id"],
                                          relance["tentative"], refus)
        raise
    except calle_client.EchecDeNotreCote:
        raise  # a failure on our side: nothing is written, the batch stops
    except Exception as erreur:
        journal.error("Relance n°%d : échec (%s)", relance["id"], erreur)
        code = "echec"
        base.ajouter_appel_campagne(campagne["id"], contact["id"],
                                    relance["tentative"], issue=code)
        _issue_apres_echec(base, preferences, campagne, contact["id"], code,
                           MOTIFS_RELANCE[code], relance["tentative"] + 1,
                           maintenant)
        return {"contact": contact["nom"], "issue": code, "abouti": False,
                "etat": "appelé"}
    outcome = issue_appel.resultat["outcome"]
    base.ajouter_appel_campagne(
        campagne["id"], contact["id"], relance["tentative"], issue=outcome,
        resultat=issue_appel.resultat, transcription=issue_appel.transcription)
    if outcome == "accepted":
        # Slot CHOSEN by the user (see refus_rendezvous_telephone).
        refus = horaires.refus_rendezvous_telephone(
            base, preferences, campagne["creneau"], place_choisie=True)
        if refus:
            return _date_refusee(base, campagne, contact, outcome, refus,
                                 campagne["creneau"])
        client_id = (base.client_du_contact(contact["id"])
                     or base.client_pour_contact(contact["nom"], telephone))
        rdv_id = base.ajouter_rendezvous(
            client_id, campagne["creneau"],
            "Créneau libéré attribué (relance de campagne)", statut="confirmé")
        base.changer_etat_contact_campagne(contact["id"], "abouti", outcome)
        if campagne["cascade_id"]:
            base.cloturer_cascade(campagne["cascade_id"], "pourvue", rdv_id)
        # Slot filled DURING a follow-up: nothing left to follow up here.
        base.annuler_relances_campagne(campagne["id"])
        journal.info("Relance aboutie : créneau de la campagne n°%d attribué "
                     "(rendez-vous n°%d), autres relances annulées",
                     campagne["id"], rdv_id)
        return {"contact": contact["nom"], "issue": outcome, "abouti": True,
                "etat": "abouti"}
    if outcome == "moved":
        date_convenue = issue_appel.resultat.get("new_datetime")
        refus = horaires.refus_rendezvous_telephone(base, preferences,
                                                    date_convenue)
        if refus:
            return _date_refusee(base, campagne, contact, outcome, refus,
                                 date_convenue)
        client_id = (base.client_du_contact(contact["id"])
                     or base.client_pour_contact(contact["nom"], telephone))
        base.ajouter_rendezvous(
            client_id, date_convenue,
            "Rendez-vous convenu par téléphone (relance de campagne)")
        base.changer_etat_contact_campagne(contact["id"], "abouti", outcome)
        return {"contact": contact["nom"], "issue": outcome, "abouti": True,
                "etat": "abouti"}
    _issue_apres_echec(base, preferences, campagne, contact["id"], outcome,
                       MOTIFS_RELANCE.get(outcome, outcome),
                       relance["tentative"] + 1, maintenant)
    return {"contact": contact["nom"], "issue": outcome, "abouti": False,
            "etat": "appelé"}


def executer_relances_dues(base, planif, preferences, maintenant=None):
    """The HUMAN GESTURE `Lancer les relances dues`: runs each due follow-up.

    Never a spontaneous call: this function is only called by a button. The
    planner's three locks are checked BEFORE the slightest call (simulation or
    real), and each follow-up keeps its campaign's theme and parameters.
    Returns the list of reports.
    """
    planif.verifier_garde_fous()
    comptes_rendus = []
    for relance in base.relances_dues(
            maintenant.isoformat(timespec="minutes") if maintenant else None):
        # The follow-up may have been cancelled by an earlier run in the same
        # batch (slot filled): its real state is read back.
        etat_reel = base.obtenir_relance(relance["id"])
        if etat_reel is None or etat_reel["statut"] != "planifiée":
            continue
        campagne = base.obtenir_campagne(relance["campagne_id"])
        contact = base.obtenir_contact_campagne(relance["contact_id"])
        if (campagne is None or contact is None
                or campagne["statut"] in ("close", "arrêtée")):
            base.changer_relance(relance["id"], statut="annulée")
            continue
        base.changer_relance(relance["id"], statut="faite")
        try:
            if campagne.get("nature"):
                # An assistant campaign: same engine and same states as its
                # initial run (local import: the assistant module already
                # imports this one).
                from . import assistant
                compte_rendu = assistant.executer_relance(
                    base, planif, preferences, campagne, relance, contact,
                    maintenant)
            elif campagne["theme"] == "creneau_libere":
                compte_rendu = _executer_relance_cascade(
                    base, planif, preferences, campagne, relance, contact,
                    maintenant)
            else:
                contact_frais = dict(contact)
                compte_rendu = _appeler_contact_classique(
                    base, planif, preferences, campagne, contact_frais,
                    tentative=relance["tentative"], maintenant=maintenant)
        except calle_client.EchecDeNotreCote as panne:
            # A failure ON OUR SIDE. The follow-up has just been marked
            # `faite`: it is PUT BACK to `planifiée`, otherwise it would be
            # lost while nobody was called. The batch stops there — the
            # following follow-ups would all fail the same way.  EXCEPT when
            # the answer did arrive and RingBack could not read it
            # (ResultatInvalide): there, the phone DID RING and the
            # conversation took place. Putting the follow-up back to
            # `planifiée` would call that person again automatically — exactly
            # what must not happen. The follow-up stays `faite` and the contact
            # waits for a human.
            from . import assistant
            if not isinstance(panne, calle_client.ResultatInvalide):
                base.changer_relance(relance["id"], statut="planifiée")
            assistant.mettre_en_pause_sur_panne(base, campagne["id"], panne)
            # The state READ BACK from the database: after an unreadable
            # answer, the contact is waiting for a human — the report must not
            # still call them `à recontacter`.
            frais = base.obtenir_contact_campagne(contact["id"]) or contact
            comptes_rendus.append(
                {"contact": contact["nom"], "issue": frais["issue"],
                 "abouti": False, "etat": frais["etat"], "panne": str(panne),
                 "relance_id": relance["id"], "campagne_id": campagne["id"],
                 "campagne_nom": campagne["nom"],
                 "tentative": relance["tentative"]})
            return comptes_rendus
        compte_rendu["relance_id"] = relance["id"]
        compte_rendu["campagne_id"] = campagne["id"]
        compte_rendu["campagne_nom"] = campagne["nom"]
        compte_rendu["tentative"] = relance["tentative"]
        comptes_rendus.append(compte_rendu)
        # ⚠ THE FOLLOW-UP HAS JUST ENDED: this contact may have no attempts
        # left ahead of them. It is the second of the three moments where
        # RingBack stops trying — and without it, a failed move on the LAST
        # reminder left its appointment on the schedule (20/08/2026).
        from . import assistant as _assistant
        _assistant.cloturer_les_deplacements_non_faits(
            base, base.obtenir_campagne(campagne["id"]), maintenant)
        mettre_a_jour_statut_campagne(base, campagne["id"])
    return comptes_rendus
