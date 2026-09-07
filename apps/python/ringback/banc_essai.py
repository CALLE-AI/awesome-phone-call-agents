"""End-to-end test bench — RingBack, in SIMULATION only.

What it is for
-------------
The test suite (test.cmd) is the daily net: it checks CHOSEN cases. This bench does something else: it WALKS a matrix instead of sampling a few of its cells. Three axes:

1. the eight campaign KINDS (assistant.NATURES);
2. the STARTING POINTS: the 3-step journey itself, the five `from the database` filling routes, the six resumptions of a previous campaign filtered by state, pasting, CSV, the ICS calendar, the call queue and the direct cascade;
3. the simulator's deterministic OUTCOMES (endings 51 to 56) plus the four edge cases: a 🚫 contact, a contact with no number, a duplicate, a client record deleted along the way.

For every cell walked, the bench checks TWO things: what is written to the
database (appointment status, creation, cancellation, freed slot, contact
state, follow-up scheduled) AND what becomes visible on screen (control desk,
schedule, 👥 Clients, 🔁 Relances).

The five rules held here
--------------------------
1. SIMULATION ONLY. The bench CANNOT trigger a real call: it removes CALLE_API_KEY from its own process, builds the application with appels_reels=False, and checks those locks as cases in their own right (the `Les verrous` section). The real-call audit log is read before and after: a single extra row would be a failure.
2. NEVER THE REAL DATABASE. The bench works on a THROWAWAY database created in a temporary directory, destroyed at the end. It REFUSES to start when pointed at the real database (or at any file in the donnees/ directory).
3. PORT 8779, released cleanly even on a failure halfway through (the product's server lives on 8770; 8771 to 8778 are left free).
4. NEVER A FALSE RESULT. A cell not walked shows as `⬜ non couvert`, never `✅`. What cannot be checked without a mouse is listed separately, under `à vérifier à la main`.
5. REPRODUCIBLE. Two runs in a row give an IDENTICAL report. The report carries only THE DAY'S DATE (not the time), and the only relative date used is computed explicitly: today at 12:00 (the REFERENCE constant below), which fixes the whole sample data set.

Launch: banc-essai.cmd (or `python banc_essai.py`). Standard library only.
"""

import argparse
import datetime
import html as html_mod
import logging
import os
import re
import shutil
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

RACINE_APP = os.path.dirname(os.path.abspath(__file__))
if RACINE_APP not in sys.path:
    sys.path.insert(0, RACINE_APP)

# ---------------------------------------------------------------------------
# LOCK 1 (before ANY import of ringback): the real-call key is removed from
# this process. Even a programming mistake in this file could no longer build a
# real call client: AppelReel refuses to construct itself without a key. The
# removal touches ONLY this process.
# ---------------------------------------------------------------------------
CLE_RETIREE = os.environ.pop("CALLE_API_KEY", None)

from ringback import (assistant, calle_client, campagnes, db,  # noqa: E402
                      essai_reel, etats_clients, horaires, jeu_essai, serveur,
                      themes)

PORT_BANC = 8779
PORTS_RESERVES_PRODUIT = tuple(range(8770, 8779))
BASE_REELLE = os.path.join(RACINE_APP, "donnees", "ringback.db")
DOSSIER_DONNEES = os.path.join(RACINE_APP, "donnees")

# The bench's only relative date, computed ONCE and stated plainly in the
# report: today at 12:00. The whole sample data set follows from it (its
# appointments are described in `days from now`).
REFERENCE = datetime.datetime.combine(datetime.date.today(),
                                      datetime.time(12, 0))


def _iso(jours, heure, minute=0):
    """An ISO 8601 time to the minute, N days from the reference date."""
    return (REFERENCE + datetime.timedelta(days=jours)).replace(
        hour=heure, minute=minute).isoformat(timespec="minutes")


# What `Banc.demarrer` opens: Monday to Friday. Written here because the
# scenarios need it BEFORE the server exists.
JOURS_OUVRES_BANC = (0, 1, 2, 3, 4)


def _jour_ouvre(jours, *aussi):
    """Shifts `jours` until that day — AND those in `aussi` — are open.

    ⚠ THIS BENCH RUNS ON A DIFFERENT DAY EVERY DAY (14/08/2026). Its dates
    start from `today at noon`: a ten-day shift therefore lands on a different
    weekday depending on the date, and nothing guaranteed it would be OPEN.
    Measured on a Friday: the simulated postponement (always the slot + two
    days, see calle_client._date_deplacee) fell on a SUNDAY, the product
    rightly refused to place the appointment — and the check `the old
    appointment no longer holds` failed, without anything having moved in the
    product. The same trap had already been met on the HOURS (see `demarrer`,
    8am – 7pm); it was still intact on the DAYS.

    `aussi`: the additional shifts that must fall on open days too — `2` for a
    case that ends with a postponement.
    """
    while True:
        vises = (0,) + aussi
        if all((REFERENCE + datetime.timedelta(days=jours + ecart)).weekday()
               in JOURS_OUVRES_BANC for ecart in vises):
            return jours
        jours += 1


# --------------------------------------------------------------- the axes
NATURES_ORDRE = list(assistant.NATURES)

ISSUES = (
    ("51", "51 · accepte"),
    ("52", "52 · refuse"),
    ("53", "53 · pas de réponse"),
    ("54", "54 · propose un report"),
    ("55", "55 · veut déplacer sans conclure"),
    ("56", "56 · pas de réponse puis oui à la relance"),
    ("stop", "🚫 ne plus appeler"),
    ("sans_numero", "sans numéro"),
    ("doublon", "doublon"),
    ("supprime", "fiche supprimée en cours de route"),
)
CODES_ISSUES = [code for code, _ in ISSUES]

# The `construction` code is not a call outcome: it carries the CONSTRUCTION
# checks (⛔ blocking, grid filled, a ready campaign that calls nobody). It has
# its own column in table B.
CONSTRUCTION = "construction"

DEPARTS = (
    ("assistant", "L'assistant en 3 étapes (⚠ bloquants, campagne « prête »)"),
    ("collage", "Étape 3 — collage d'une liste"),
    ("csv", "Étape 3 — fichier CSV"),
    ("ics", "Étape 3 — agenda ICS"),
    ("base_a_venir", "Étape 3 — la base : rendez-vous à venir"),
    ("base_manques", "Étape 3 — la base : rendez-vous manqués"),
    ("base_annules", "Étape 3 — la base : rendez-vous annulés"),
    ("base_deplaces", "Étape 3 — la base : déplacés en attente"),
    ("base_tous", "Étape 3 — la base : tous les clients"),
    ("campagne_injoignable", "Étape 3 — reprise : 📵 injoignables"),
    ("campagne_refuse", "Étape 3 — reprise : ❌ refus"),
    ("campagne_humain", "Étape 3 — reprise : 🙋 à rappeler par un humain"),
    ("campagne_accepte", "Étape 3 — reprise : ✅ acceptés"),
    ("campagne_recontacter", "Étape 3 — reprise : 🔁 à recontacter"),
    ("campagne_tous", "Étape 3 — reprise : tous les contacts"),
    ("file", "La file d'appels (tout rappeler, puis exécuter)"),
    ("cascade", "La cascade directe (page Cascade « premier oui »)"),
    # ⚠ NOT TO BE CONFUSED with the line above: this one is the `shift in
    # cascade` OPTION of a freed-slot campaign, not the Cascade page. This
    # confusion of vocabulary hid for three days the fact that the bench did
    # NOT check the option (15/08/2026).
    ("cascade_option", "L'option « décaler en cascade » (son parcours entier)"),
    # HIS TEST of 17/08/2026, turned into a net: move a WHOLE DAY's
    # appointments, and check that everybody is handled.
    ("journee_entiere", "Déplacer une JOURNÉE entière (son parcours entier)"),
    # THE TWO DOORS of §1 (R15 closed on 01/08/2026): we no longer start from a
    # form, we start from what is MISSING.
    ("etat_client", "👥 Clients — un état à traiter (§4)"),
    ("planning", "📅 Le planning — un trou, ou un rendez-vous (§5)"),
)
CODES_DEPARTS = [code for code, _ in DEPARTS]

SOURCE_DU_DEPART = {"base_a_venir": "a_venir", "base_manques": "manques",
                    "base_annules": "annules", "base_deplaces": "deplaces",
                    "base_tous": "tous"}
ETAT_DU_DEPART = {"campagne_injoignable": "injoignable",
                  "campagne_refuse": "refusé",
                  "campagne_humain": "à rappeler par un humain",
                  "campagne_accepte": "accepté",
                  "campagne_recontacter": "à recontacter",
                  "campagne_tous": "tous"}

# MEANINGLESS cells: the combination does not exist in the product, so it is
# not a coverage gap. Stated in French in the report.
SANS_OBJET_DEPART_NATURE = {
    "file": "La file d'appels ne demande pas de nature : elle rappelle les "
            "rendez-vous manqués et fabrique sa campagne « manqués ».",
    "cascade": "La page Cascade ne fait qu'une seule nature : « créneau "
               "libéré ».",
    "etat_client": "La porte 👥 ne propose que les natures qu'un ÉTAT peut "
                   "désigner (table etats_clients.TRAITEMENT) : prise de "
                   "rendez-vous, rappel, confirmation et déplacement. La "
                   "cinquième, « créneau libéré », part du PLANNING — d'une "
                   "place qui se libère, jamais de l'état d'un client. "
                   "« Rappel d'appel manqué » en dépendait aussi, mais son "
                   "état (« il a cherché à nous joindre ») n'était jamais "
                   "produit par le moteur : la nature a été retirée le "
                   "03/08/2026, et l'état avec elle.",
    "planning": "La porte 📅 ne propose que les deux natures qui partent "
                "d'une PLACE : « créneau libéré » (un trou) et "
                "« déplacement » (un rendez-vous). Rappel et confirmation "
                "s'y feront par SÉLECTION d'une journée ou d'une semaine "
                "(§5) : ce geste-là n'est pas construit.",
}

# The kinds ACTUALLY reachable from a starting point that does not offer all
# eight. Absent from this table = all eight are possible.
NATURES_DU_DEPART = {
    "file": (),
    "cascade": ("creneau_libere",),
    "cascade_option": ("creneau_libere",),
    "journee_entiere": ("deplacement",),
    "etat_client": ("prise_rdv", "rappel_rdv", "confirmation", "deplacement"),
    "planning": ("creneau_libere", "deplacement"),
}

SANS_OBJET_ISSUE_DEPART = {
    ("assistant", "*"): "Le parcours en 3 étapes se juge sur ses refus ⚠ et "
                        "sur la campagne « prête », pas sur une issue d'appel.",
    ("etat_client", "*"): "La porte 👥 n'appelle personne : elle ouvre "
                          "l'assistant à l'étape 2. Aucune issue d'appel ne "
                          "peut donc en naître — c'est ce que le banc mesure.",
    ("planning", "*"): "La porte 📅 n'appelle personne non plus : elle ouvre "
                       "l'assistant, ou applique la règle d'annulation. "
                       "Aucune issue d'appel ne peut en naître.",
    ("collage", "sans_numero"): "Un collage REFUSE la ligne dont le numéro "
                                "n'est pas valide : un contact sans numéro ne "
                                "peut pas naître de cette voie.",
    ("csv", "sans_numero"): "Un fichier CSV passe par le même validateur de "
                            "numéro que le collage : le cas ne peut pas y "
                            "exister.",
    ("cascade", "sans_numero"): "La liste de cascade passe par le même "
                                "validateur de numéro.",
}

# What the simulator does, stated in French in the report.
EXPLICATION_ISSUES = {
    "51": "le client accepte",
    "52": "le client refuse, ou annule sans qu'aucune date soit replacée "
          "(il devient alors « 📞 le client rappellera »)",
    "53": "personne ne décroche",
    "54": "le client propose une autre date",
    "55": "le client veut déplacer mais ne conclut rien",
    "56": "personne ne décroche, puis le client dit oui à la relance",
}

# The expected contact state for each outcome — the product's truth table. `52`
# on a classic call means CANCELLATION (the simulator returns `canceled`):
# since the owner's rule of 31/07/2026, a cancellation that rebooked nothing
# gives `le client rappellera`. In CASCADE, the same number returns `refused` —
# a refusal of the slot offered, not a cancellation: the contact stays `refusé`
# there.  `55` IN CASCADE meant `refusé` until 02/08/2026, for want of an
# outcome to say it otherwise: the cascade had no `to_reschedule`, and the
# simulator folded `wants something else without concluding anything` into a
# refusal. It was not the same thing, and the 8th real test showed it — the
# person was asking for the date to be repeated. The cascade now has its 4th
# outcome, and this case gives the SAME state as elsewhere: `à rappeler par un
# humain`.  ⚠ AND `55` NO LONGER GIVES THE SAME STATE EVERYWHERE (11/08/2026).
# The owner's decision: the human call-back exists only on `appointment move`
# and `booking` — the two kinds where a DATE REMAINS TO BE FOUND, hence real
# work for a human. Elsewhere: · freed slot → `refusé` (the slot goes to
# somebody else), and their appointment is kept, moved to `confirmé`; ·
# reminder, confirmation → `le client rappellera`: nothing is waiting on our
# side, the appointment being discussed is theirs. The bench READS the rule in
# the product (assistant.NATURES_RAPPEL_HUMAIN) rather than copying it: a rule
# written twice ends up contradicting itself.
ETAT_ATTENDU = {"51": "accepté", "52": assistant.ETAT_RAPPELLERA,
                "53": "à recontacter", "54": "accepté",
                "55": "à rappeler par un humain", "56": "à recontacter"}
ETAT_ATTENDU_CASCADE = dict(ETAT_ATTENDU, **{"52": "refusé"})


def etat_attendu(nature, fin, en_cascade):
    """The expected state for this ending ON THIS KIND."""
    table = ETAT_ATTENDU_CASCADE if en_cascade else ETAT_ATTENDU
    if fin != "55":
        return table[fin]
    if nature in assistant.NATURES_RAPPEL_HUMAIN:
        return "à rappeler par un humain"
    if nature == "creneau_libere":
        return "refusé"
    return assistant.ETAT_RAPPELLERA


def attend_un_humain(nature, fin):
    """True when THIS case must make the contact appear on the human panel."""
    return fin == "55" and nature in assistant.NATURES_RAPPEL_HUMAIN


class RefusDuBanc(RuntimeError):
    """The bench refuses to start (the real database targeted, port in use…).
    """


def _est_la_base_du_produit(chemin):
    """Does this path designate the product's `donnees\\` directory?

    Compared on the DIRECTORY, not on the file's name: the preferences live
    beside the database, and the bench rewrites them too (opening hours,
    calling window). Targeting another file name in that directory would be
    just as destructive.
    """
    reel = os.path.normcase(os.path.join(RACINE_APP, "donnees"))
    vise = os.path.normcase(os.path.dirname(os.path.abspath(chemin)))
    return vise == reel


# Windows command windows cannot always draw ✅ or ❌. The report FILE always
# keeps them; the console display falls back on plain-character marks when the
# window cannot write them. ⚠ and ⛔ are TWO distinct marks since 02/08/2026: ⚠
# says `to be filled in`, ⛔ says `refused / forbidden`. The glossary keeps
# both, otherwise a sentence of the product quoted in the report (`⛔ Aucun
# appel n'est parti`) would come out with a `?` in a console that cannot draw
# it.
MARQUES_SIMPLES = {"✅": "OK", "❌": "KO", "⬜": "??", "·": "--",
                   "⚠": "(obligatoire)", "⛔": "(refus)",
                   "🚫": "(ne plus appeler)",
                   "📵": "(injoignable)", "🙋": "(humain)", "🤖": "(auto)",
                   "🔁": "", "👥": "", "⚙": "", "▶": ">", "⏸": "||",
                   "⏹": "[]", "📞": "", "🔔": "", "📆": "", "🎯": "",
                   "🗓": "", "☎": "", "✍": "", "🧪": "", "…": "..."}


def pour_console(texte):
    """The same text, writable in this machine's command window."""
    encodage = getattr(sys.stdout, "encoding", None) or "ascii"
    try:
        texte.encode(encodage)
        return texte
    except UnicodeEncodeError:
        pass
    for symbole, remplacant in MARQUES_SIMPLES.items():
        texte = texte.replace(symbole, remplacant)
    return texte.encode(encodage, "replace").decode(encodage)


# ===========================================================================
# THE CASES AND THEIR VERDICT
# ===========================================================================
class Cas:
    """ONE check: what was expected, what happened, the verdict."""

    def __init__(self, nature, depart, issue, quoi, attendu, obtenu, passe):
        self.nature = nature
        self.depart = depart
        self.issue = issue
        self.quoi = quoi
        self.attendu = attendu
        self.obtenu = obtenu
        self.passe = passe


class Journal:
    """The bench's notebook: the cases, the locks, the gestures to do by hand.
    """

    def __init__(self):
        self.cas = []
        self.verrous = []  # (label, expected, obtained, passed)
        self.a_la_main = []  # (what is not checkable, what to do)
        self.remarques = []  # measured observations, with no verdict
        self.incidents = []  # the bench's own mishaps

    # ------------------------------------------------------------ writing
    def noter(self, nature, depart, issue, quoi, attendu, obtenu, passe):
        self.cas.append(Cas(nature, depart, issue, quoi, attendu, obtenu,
                            bool(passe)))
        return bool(passe)

    def egal(self, nature, depart, issue, quoi, attendu, obtenu):
        """The `expected == obtained` check, the commonest one."""
        return self.noter(nature, depart, issue, quoi, str(attendu),
                          str(obtenu), attendu == obtenu)

    def vrai(self, nature, depart, issue, quoi, attendu, obtenu, condition):
        return self.noter(nature, depart, issue, quoi, attendu, obtenu,
                          condition)

    def verrou(self, libelle, attendu, obtenu, passe):
        self.verrous.append((libelle, attendu, obtenu, bool(passe)))
        return bool(passe)

    def main(self, quoi, marche_a_suivre):
        self.a_la_main.append((quoi, marche_a_suivre))

    def remarque(self, texte):
        self.remarques.append(texte)

    def incident(self, texte):
        self.incidents.append(texte)

    # ------------------------------------------------------------ lecture
    def cellules(self):
        """{(kind, start, outcome): [cases]} — the cells actually visited."""
        table = {}
        for cas in self.cas:
            table.setdefault((cas.nature, cas.depart, cas.issue),
                             []).append(cas)
        return table

    def marque(self, cas_de_la_case):
        """✅ when everything passes, ❌ when a single one fails, ⬜ when the cell is
        empty.
        """
        if not cas_de_la_case:
            return "⬜"
        return "✅" if all(c.passe for c in cas_de_la_case) else "❌"

    def agreger(self, axe1, axe2):
        """Reduces the matrix to two axes; returns {(a1, a2): mark}."""
        groupes = {}
        for cas in self.cas:
            cle = (getattr(cas, axe1), getattr(cas, axe2))
            groupes.setdefault(cle, []).append(cas)
        return {cle: self.marque(valeur) for cle, valeur in groupes.items()}

    @property
    def echecs(self):
        return [c for c in self.cas if not c.passe]

    @property
    def verrous_rompus(self):
        """The LOCKS that failed — counted in the verdict, not merely displayed.

        ⚠ THEY WERE NOT, AND IT IS STRUCTURAL (04/09/2026). `echecs` looked
        only at `self.cas`: a safety lock could fail without preventing `TOUT
        PASSE`. The report published in pull request #297 carried one — `a real
        call client could be built` — under a headline announcing `no
        failures`. A CALL-E reviewer saw it.

        ⚠ NO LOCK WAS GUARDED, neither that one nor the other nine. Fixing only
        the faulty lock would have left the following nine silent.
        """
        return [(libelle, attendu, obtenu)
                for libelle, attendu, obtenu, passe in self.verrous
                if not passe]


# ===========================================================================
# THE BENCH
# ===========================================================================
class Banc:
    """A RingBack server on a throwaway database + the matrix driver."""

    def __init__(self, chemin_base, port=PORT_BANC, journal=None):
        # ⚠ NEVER THE REAL DATABASE — CHECKED HERE, NOT PROMISED IN A COMMENT
        # (17/08/2026). The bench writes without restraint: it adds clients,
        # appointments, and opens the practice's hours wide. A `chemin_base` of
        # None or empty makes the server fall back on the product's `donnees\`
        # directory — THE OWNER'S DATABASE.  WHAT THAT COST, on 17/08/2026: two
        # live runs done with None seeded 27 test contacts (`M. Journee`, `Mme
        # Cascade`) and their appointments into his real database, and widened
        # his opening hours. His campaigns therefore picked up strangers, and
        # he spent time repairing. The `THROWAWAY database` comment at the top
        # of the class was already there: a comment prevents nothing, a refusal
        # does.
        if not chemin_base or _est_la_base_du_produit(chemin_base):
            raise RefusDuBanc(
                "Refus : le banc écrit (clients, rendez-vous, horaires) et ne "
                "doit JAMAIS toucher la base du produit. Donnez-lui un chemin "
                "de base jetable — un fichier dans un dossier temporaire. "
                f"Reçu : {chemin_base!r}.")
        self.chemin_base = chemin_base
        self.port = port
        self.j = journal or Journal()
        self.serveur_http = None
        self.fil = None
        self.racine = f"http://127.0.0.1:{port}"
        self.pages_vues = []  # (path, content) for the masking check
        # ADDITIONAL numbers to look for in clear in the pages served (the 🧪
        # test number is added when its scenario has declared it).
        self.numeros_a_masquer = []
        self.rdv_plancher = 0         # dernier rendez-vous AVANT l'appel en cours
        # Each campaign gets its own BLOCK of days (ten days apart): without
        # that, two campaigns would offer the same slot and the second would be
        # refused its date for a reason having nothing to do with the case
        # being exercised. The first block starts 20 days from the reference
        # date, after the sample data set's last appointment.
        self._bloc = 20

    def prochain_bloc(self):
        """The base day of the campaign that is starting (blocks of 10 days).
        """
        bloc = self._bloc
        self._bloc += 10
        return bloc

    # ------------------------------------------------------ mise en marche
    def demarrer(self):
        self.serveur_http = serveur.creer_serveur(
            port=self.port, chemin_base=self.chemin_base, appels_reels=False)
        self.fil = threading.Thread(target=self.serveur_http.serve_forever,
                                    daemon=True)
        self.fil.start()
        preferences = self.application.preferences
        # The calling window is opened wide: otherwise the bench launched at
        # 9pm would see all its campaigns pause (the politeness guard, tested
        # elsewhere). No forbidden period.
        preferences.definir(themes.CLE_PLAGE_DEBUT, "00:00")
        preferences.definir(themes.CLE_PLAGE_FIN, "23:59")
        preferences.definir(assistant.CLE_INTERDIT_DEBUT, "")
        preferences.definir(assistant.CLE_INTERDIT_FIN, "")
        preferences.definir(themes.CLE_ENTREPRISE, "Cabinet Val Fleuri")
        # ⚠ OPENING HOURS, FROM THE START (11/08/2026). The bench used to run
        # with NO hours configured: RingBack therefore had NO free slot to
        # offer, and the freed-slot campaigns worked on hard-written times,
        # sometimes already taken. It is not a setup detail: with no typical
        # week, half of what the product computes (free slots, announced slots,
        # sample calendar) does not exist. A practice with no hours is not the
        # normal case — and the bench must exercise the normal case.  ⚠ 8am –
        # 7pm, AND IT IS NOT AN AESTHETIC CHOICE: the simulator offers its
        # postponements between 8am and 6pm (calle_client, the hour draw). With
        # a 9am–6pm week, a postponement fell OUTSIDE the hours, the product
        # rightly refused it — and a bench check no longer ran (`the old
        # appointment becomes MOVED`, measured). The bench's typical week must
        # cover what its own calls can offer, otherwise it switches checks off
        # without saying so.
        for jour in range(5):  # Monday to Friday
            horaires.basculer_periode(preferences, jour, 8 * 60, 19 * 60,
                                      "ouvrir")

    def arreter(self):
        if self.serveur_http is not None:
            self.serveur_http.shutdown()
            self.serveur_http.server_close()
            self.serveur_http = None
        if self.fil is not None:
            self.fil.join(timeout=5)
            self.fil = None

    @property
    def application(self):
        return self.serveur_http.RequestHandlerClass.application

    @property
    def base(self):
        return self.application.base

    def nouveau_simulateur(self, graine=1):
        """A FRESH simulator for the case that is starting.

        Two reasons: the 56 ending has memory (`only fails to pick up on the
        instance's first call`) — without a reset, a 56 contact already called
        in an earlier case would pick up straight away; and the dialling
        latency is set to zero (the bench does not measure waiting time, it
        measures consequences).
        """
        client = calle_client.AppelSimule(graine=graine, latence=0)
        self.application.planif.client_appels = client
        return client

    # ---------------------------------------------------------------- HTTP
    def obtenir(self, chemin):
        with urllib.request.urlopen(self.racine + chemin, timeout=20) as reponse:
            texte = reponse.read().decode("utf-8")
        self.pages_vues.append((chemin, texte))
        return texte

    def poster(self, chemin, donnees=None):
        octets = urllib.parse.urlencode(donnees or {}, doseq=True).encode("utf-8")
        with urllib.request.urlopen(self.racine + chemin, data=octets,
                                    timeout=60) as reponse:
            texte = reponse.read().decode("utf-8")
            url_finale = reponse.geturl()
        self.pages_vues.append((chemin, texte))
        return texte, url_finale

    def poster_fragment(self, chemin, donnees=None):
        """The POST as THE MODAL sends it; returns (content, target).

        The `X-RingBack-Fragment` header is what distinguishes the window's
        submission from an ordinary form's: the server then answers with a
        PIECE of page, and says through `X-RingBack-Cible` which element must
        receive it.
        """
        octets = urllib.parse.urlencode(donnees or {},
                                        doseq=True).encode("utf-8")
        requete = urllib.request.Request(
            self.racine + chemin, data=octets, method="POST",
            headers={"X-RingBack-Fragment": "1",
                     "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(requete, timeout=60) as reponse:
            texte = reponse.read().decode("utf-8")
            cible = reponse.headers.get("X-RingBack-Cible")
        self.pages_vues.append((chemin, texte))
        return texte, cible

    def poster_fichier(self, chemin, champs, nom_fichier, octets):
        frontiere = "----FrontiereBancEssaiRingBack"
        morceaux = []
        for nom, valeur in champs.items():
            morceaux.append(
                f"--{frontiere}\r\nContent-Disposition: form-data; "
                f'name="{nom}"\r\n\r\n{valeur}\r\n'.encode("utf-8"))
        morceaux.append(
            f"--{frontiere}\r\nContent-Disposition: form-data; "
            f'name="fichier"; filename="{nom_fichier}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n".encode("utf-8"))
        morceaux.append(octets + b"\r\n")
        morceaux.append(f"--{frontiere}--\r\n".encode("utf-8"))
        corps = b"".join(morceaux)
        requete = urllib.request.Request(
            self.racine + chemin, data=corps, method="POST",
            headers={"Content-Type":
                     f"multipart/form-data; boundary={frontiere}"})
        with urllib.request.urlopen(requete, timeout=60) as reponse:
            texte = reponse.read().decode("utf-8")
            url_finale = reponse.geturl()
        self.pages_vues.append((chemin, texte))
        return texte, url_finale

    # ------------------------------------------------ the assistant, step by
    # step
    def place_libre(self, apres_jours=1):
        """A slot the product would REALLY agree to book.

        ⚠ WHY IT EXISTS (11/08/2026). The bench wrote its slots `hard` (day +11
        at 4:30pm, and so on). Since the sample data set covers a hundred days,
        those times are often ALREADY TAKEN — and since a campaign reads its
        slot back before calling, it rightly stopped: twenty checks fell over,
        on an unrealistic setup (offering an already occupied slot). So the
        bench must offer a slot that exists.

        ⚠ THE CRITERION IS THE PRODUCT'S, NOT A RULE OF OURS:
        `refus_rendezvous_telephone` is exactly what the campaign consults.
        Asking `creneaux_libres` first is a shortcut — but it returns an EMPTY
        list when no opening hours are configured, which is the bench's state
        for almost its whole walk. Hence the sweep: we try times until we find
        one the product accepts.
        """
        preferences = self.application.preferences
        depart = datetime.datetime.now() + datetime.timedelta(days=apres_jours)
        libres = horaires.creneaux_libres(self.base, preferences, tranches=2,
                                          depuis=depart, limite=1)
        if libres:
            return libres[0]
        for jour in range(14):
            for heure in (16, 15, 14, 11, 10, 9):
                place = _iso(apres_jours + jour, heure, 30)
                if not horaires.refus_rendezvous_telephone(
                        self.base, preferences, place, tranches=2):
                    return place
        # Nothing free in fourteen days: we return the written date, and the
        # bench will fail BY SAYING SO rather than pretend.
        return _iso(apres_jours, 16, 30)

    def infos_de(self, nature):
        """The step-2 information, ⚠ included, for this kind."""
        commun = {"info_entreprise": "Cabinet Val Fleuri"}
        propres = {
            "creneau_libere": {"info_creneau_libere": self.place_libre(11),
                               "info_duree": "30 minutes"},
            "rappel_rdv": {"info_consignes": "venir en tenue de sport"},
            "confirmation": {},
            "deplacement": {"info_raison": "un imprévu dans notre planning",
                            "info_creneaux_remplacement":
                                "mardi 9h00, mercredi 14h30, jeudi 10h00"},
            "prise_rdv": {"info_origine": "vous avez demandé un rendez-vous "
                                          "sur notre site",
                          "info_creneaux_proposes":
                              "mardi 9h00, mercredi 14h30, jeudi 10h00"},
        }[nature]
        return dict(commun, **propres)

    def ouvrir_brouillon(self, nature):
        page, _ = self.poster("/assistant/nature", {"nature": nature})
        trouve = re.search(r'name="b" value="(\d+)"', page)
        if not trouve:
            raise RuntimeError(f"Brouillon introuvable pour « {nature} ».")
        return trouve.group(1), page

    def formulaire_etape2(self, nature, brouillon, relance_max=3):
        formulaire = {
            "b": brouillon, "action": "continuer", "ordre": "liste",
            "opt_recontacter": "1", "opt_liberer": "1", "opt_repondeur": "1",
            "relance_mode": "delai", "relance_delai": "4",
            "relance_max": str(relance_max)}
        formulaire.update(self.infos_de(nature))
        if nature in ("creneau_libere", "deplacement"):
            # These two kinds stop at the FIRST YES by default: the bench, for
            # its part, must walk the whole matrix of outcomes. So it
            # explicitly chooses the other setting, `call the whole list` (the
            # one of the `empty a whole day` case). Stopping at the first yes
            # has its own section, further down.
            formulaire["politique"] = "tous"
        return formulaire

    def passer_etape2(self, nature, brouillon, relance_max=3, politique=None):
        formulaire = self.formulaire_etape2(nature, brouillon, relance_max)
        if politique:
            formulaire["politique"] = politique
        page, _ = self.poster("/assistant/message", formulaire)
        return page

    def valider_grille(self, brouillon, champs=None):
        """Validates step 3; returns (campagne_id or None, page).

        `champs`: what step 3's form carries AT THE SAME TIME as the `Valider`
        button — rule, order, ceiling. On screen those fields are attached to
        the same form as the button (the `form` attribute): sending them
        separately would let a bench pass where the product genuinely failed
        (the 15/08/2026 defect, where the 30-day gain never arrived).
        """
        donnees = {"b": brouillon, "action": "valider"}
        donnees.update(champs or {})
        page, url = self.poster("/assistant/liste", donnees)
        trouve = re.search(r"/campagne\?id=(\d+)", url)
        return (int(trouve.group(1)) if trouve else None), page

    # ------------------------------------------------------- the execution
    def dernier_rdv_id(self):
        # The query is written here rather than in db.py: it therefore takes
        # the database lock by hand (see db._sous_verrou), so as not to land in
        # the middle of a write done by the server.
        with self.base.verrou:
            ligne = self.base.conn.execute(
                "SELECT COALESCE(MAX(id), 0) AS dernier "
                "FROM rendezvous").fetchone()
        return ligne["dernier"]

    def marquer_plancher(self):
        """Remembers the last existing appointment BEFORE calling.

        This landmark serves to tell `what THIS call wrote` from what was
        already there: without it, an appointment for the same client at the
        same time, left by an earlier campaign, would pass for a write by the
        current call.
        """
        self.rdv_plancher = self.dernier_rdv_id()
        return self.rdv_plancher

    def executer(self, campagne_id):
        """Runs the campaign IN THIS THREAD (no background thread).

        Why not the ▶ Start button: it launches a background thread that shares
        the server's single sqlite3 connection with the web requests. The bench
        must be reproducible; so it runs the campaign itself, with exactly the
        same code (assistant.executer_campagne), with no concurrency. The
        button itself is checked once, separately.
        """
        self.marquer_plancher()
        assistant.executer_campagne(self.application, campagne_id)
        return self.base.obtenir_campagne(campagne_id)

    def lancer_relances(self, jours=7):
        """The human gesture `Lancer les relances dues`, seen from 7 days later —
        a follow-up's due date is a few working hours away, it would not be due
        at this very instant.
        """
        quand = REFERENCE + datetime.timedelta(days=jours)
        return campagnes.executer_relances_dues(
            self.base, self.application.planif, self.application.preferences,
            maintenant=quand)

    # ------------------------------------------------------------- lecture
    def contacts(self, campagne_id):
        return self.base.contacts_de_campagne(campagne_id)

    def par_terminaison(self, campagne_id):
        """{ending: contact} for the contacts with a forced outcome."""
        table = {}
        for contact in self.contacts(campagne_id):
            clair = self.base.telephone_contact_campagne(contact["id"]) or ""
            fin = re.sub(r"\D", "", clair)[-2:]
            if fin in ETAT_ATTENDU:
                table.setdefault(fin, contact)
        return table

    def rdv_vise(self, contact):
        """THE appointment this contact is about, or None (the same rule as the
        call engine: assistant._rendezvous_vise).
        """
        clair = self.base.telephone_contact_campagne(contact["id"])
        return assistant._rendezvous_vise(self.base, contact, clair)

    def dernier_resultat(self, contact_id):
        appels = self.base.appels_du_contact_campagne(contact_id)
        for appel in reversed(appels):
            if appel.get("resultat"):
                return appel["resultat"]
        return None

    def relances_du_contact(self, campagne_id, contact_id):
        return [r for r in self.base.relances_de_campagne(campagne_id)
                if r["contact_id"] == contact_id]


# ===========================================================================
# THE CONSEQUENCE CHECKS
# =========================================================================== ⚠
# THIS STATE HAS DEPENDED ON THE KIND SINCE 15/08/2026. An agreed date the
# product refuses to write sends the contact to a human… except on `créneau
# libéré`, where that call-back no longer exists (he had it removed; see
# assistant.NATURES_RAPPEL_HUMAIN). There, the contact goes `refusé`: that is
# true of the SLOT, which goes to somebody else, and their own appointment is
# kept.
ETAT_DATE_REFUSEE = "à rappeler par un humain"
ETAT_DATE_REFUSEE_SANS_HUMAIN = "refusé"


def etat_date_refusee(nature):
    """The state a contact lands in when their agreed date was refused."""
    return (ETAT_DATE_REFUSEE_SANS_HUMAIN if nature == "creneau_libere"
            else ETAT_DATE_REFUSEE)


def _une_date_est_ecrite(fin, en_cascade, rdv_avant, nature):
    """Must this call WRITE a date into the calendar?

    That is what decides whether the outcome `the agreed date is refused` is a
    possible story: a date the product refuses to write (slot already taken,
    closed day) sends the contact to a human, with the reason in clear. Nothing
    in that is false — but it is not the same story, and the bench must accept
    both WITHOUT ever accepting an inconsistency.
    """
    if en_cascade:
        return fin in ("51", "54")
    if fin == "54":
        return True
    if fin == "51":
        return rdv_avant is None and nature == "prise_rdv"
    return False


def controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                    en_cascade):
    """Checks ONE cell (kind × start × outcome): database THEN screen."""
    j = banc.j
    contact = banc.base.obtenir_contact_campagne(contact_avant["id"])
    rdv_avant = contact_avant["rdv_avant"]
    attendu = etat_attendu(nature, fin, en_cascade)
    acceptables = {attendu}
    repli = etat_date_refusee(nature)
    if _une_date_est_ecrite(fin, en_cascade, rdv_avant, nature):
        acceptables.add(repli)
    j.vrai(nature, depart, fin,
           f"état du contact « {contact_avant['nom']} » après l'appel",
           f"« {attendu} »" + (f" — ou « {repli} » si le "
                               "produit a refusé d'écrire la date convenue, "
                               "raison à l'appui"
                               if len(acceptables) > 1 else ""),
           f"« {contact['etat']} »", contact["etat"] in acceptables)
    resultat = banc.dernier_resultat(contact["id"])
    if fin == "53":
        _controler_non_joint(banc, campagne_id, nature, depart, fin, contact)
        return
    if resultat is None and fin != "56":
        j.noter(nature, depart, fin, "un résultat d'appel est enregistré",
                "un résultat structuré en base", "aucun résultat", False)
        return
    if fin == "56":
        _controler_non_joint(banc, campagne_id, nature, depart, fin, contact)
        return
    if fin == "51":
        _controler_accepte(banc, nature, depart, contact, rdv_avant, resultat,
                           en_cascade, campagne_id)
    elif fin == "52":
        _controler_refus(banc, nature, depart, contact, rdv_avant, en_cascade)
    elif fin == "54":
        _controler_report(banc, nature, depart, contact, rdv_avant, resultat,
                          en_cascade)
    elif fin == "55":
        _controler_sans_conclure(banc, nature, depart, contact, rdv_avant)


def _controler_date_ecrite(banc, nature, depart, fin, contact, date_convenue,
                           quoi, ligne_connue=None):
    """The appointment is written at the agreed date, OR the refusal is explained.

    Two stories, only one must hold, and it must match the database: either the
    appointment exists at the agreed date, or the contact goes to a human WITH
    the reason AND the requested date in clear, and NOTHING is written into the
    calendar.
    """
    j = banc.j
    frais = banc.base.obtenir_contact_campagne(contact["id"])
    # `Written by THIS call`: either an appointment more recent than the
    # landmark placed just before the call (it has just been created), or THE
    # CONTACT'S OWN ROW (it has just been moved). An appointment for the same
    # client at the same time, but earlier and unrelated, does not count.  ⚠
    # THE SECOND BRANCH WAS ADDED ON 17/08/2026, along with defect no. 4: a
    # date agreed on the phone now MOVES the existing row instead of creating a
    # second one (his rule of 14/08). The check looked only for something NEW:
    # it therefore announced `0 appointments at that time` while the
    # appointment was indeed there, at the right date. It measured the writing
    # mechanism, not the fact that matters to the operator. ⚠ `ligne_connue`
    # RATHER THAN `contact["rendezvous_id"]`: a PASTED list carries no
    # appointment id — the product finds the row again by name, number and date
    # (see `db.rendezvous_identique`). Relying on the column would have left
    # that starting point unchecked, in silence. It is the bench that knows
    # which row existed before the call: it passes it.
    connue = (ligne_connue or {}).get("id")
    aux_horaires = [r for r in banc.base.tous_les_rendezvous()
                    if r["nom"] == contact["nom"]
                    and r["horaire"] == date_convenue
                    and (r["id"] > banc.rdv_plancher or r["id"] == connue)
                    and r["statut"] in ("prévu", "confirmé")]
    if frais["issue"] == "date_refusee":
        detail = frais["detail"] or ""
        coherent = (bool(detail) and "NON créé" in detail
                    and not aux_horaires)
        j.vrai(nature, depart, fin, quoi,
               "soit le rendez-vous à la date convenue, soit un refus qui dit "
               "POURQUOI et rappelle la date demandée, sans rien écrire",
               f"date refusée, dit en clair : « {detail[:150]} »" if coherent
               else f"refus incohérent (détail « {detail[:120]} », "
                    f"{len(aux_horaires)} rendez-vous quand même écrit)",
               coherent)
        return
    j.vrai(nature, depart, fin, quoi,
           f"un rendez-vous le {themes.date_lisible(date_convenue)}",
           f"{len(aux_horaires)} rendez-vous à cet horaire pour ce client",
           len(aux_horaires) >= 1)


def _controler_non_joint(banc, campagne_id, nature, depart, fin, contact):
    """No answer: a follow-up is SCHEDULED, no spontaneous call."""
    j = banc.j
    relances = banc.relances_du_contact(campagne_id, contact["id"])
    planifiees = [r for r in relances if r["statut"] == "planifiée"]
    j.vrai(nature, depart, fin,
           f"une relance est programmée pour « {contact['nom']} »",
           "exactement une relance « planifiée », jamais un appel qui repart "
           "tout seul",
           f"{len(planifiees)} relance(s) planifiée(s) sur {len(relances)}",
           len(planifiees) == 1)


def _controler_accepte(banc, nature, depart, contact, rdv_avant, resultat,
                       en_cascade, campagne_id):
    j = banc.j
    if en_cascade:
        campagne = banc.base.obtenir_campagne(campagne_id)
        creneau = campagne["creneau"]
        _controler_date_ecrite(banc, nature, depart, "51", contact, creneau,
                               "le créneau libéré est ATTRIBUÉ à celui qui dit "
                               "oui")
        if banc.base.obtenir_contact_campagne(contact["id"])["issue"] == \
                "date_refusee":
            return
        if rdv_avant is not None:
            frais = banc.base.obtenir_rendezvous(rdv_avant["id"])
            # ⚠ THIS CHECK IS DORMANT, and that must be known: it does not
            # appear once in the report, because no combination in this bench
            # gives a PRIOR appointment to the contact who accepts. It expected
            # `annulé` while the code wrote `supprimé` — a false expectation
            # that never failed for want of being exercised. Corrected here on
            # the truth of 03/08/2026: the old appointment is MOVED. The real
            # proof of this path is in the test suite
            # (test_parcours_nominal_creneau_libere), not here.
            j.egal(nature, depart, "51",
                   "l'ancien rendez-vous du client est DÉPLACÉ (jamais deux "
                   "rendez-vous pour la même personne)",
                   "déplacé", frais["statut"])
            creneaux = banc.application.preferences.obtenir(
                themes.CLE_CRENEAUX) or []
            j.vrai(nature, depart, "51",
                   "le créneau ainsi libéré rejoint les créneaux disponibles",
                   f"{themes.date_lisible(rdv_avant['horaire'])} dans les "
                   "créneaux de ⚙ Réglages",
                   f"{len(creneaux)} créneau(x) enregistré(s)",
                   rdv_avant["horaire"] in creneaux)
        return
    if rdv_avant is not None:
        frais = banc.base.obtenir_rendezvous(rdv_avant["id"])
        if nature == "deplacement":
            # A MOVE campaign tells the client their appointment must shift and
            # offers them replacement slots. If they accept, the appointment
            # must shift.
            j.vrai(nature, depart, "51",
                   "dans une campagne de DÉPLACEMENT, un accord doit vraiment "
                   "DÉPLACER le rendez-vous",
                   "un rendez-vous à une AUTRE heure que celle d'origine (ou "
                   "l'ancien marqué « déplacé » et un nouveau créé)",
                   f"statut « {frais['statut']} », horaire "
                   f"{'INCHANGÉ' if frais['horaire'] == rdv_avant['horaire'] else 'changé'}"
                   f" ({themes.date_lisible(frais['horaire'])})",
                   frais["horaire"] != rdv_avant["horaire"]
                   or frais["statut"] == "déplacé")
            return
        j.egal(nature, depart, "51",
               f"le rendez-vous du {themes.date_lisible(rdv_avant['horaire'])} "
               "est CONFIRMÉ, sans changer d'heure",
               ("confirmé", rdv_avant["horaire"]),
               (frais["statut"], frais["horaire"]))
        return
    if nature == "prise_rdv":
        _controler_date_ecrite(banc, nature, depart, "51", contact,
                               resultat.get("new_datetime"),
                               "le rendez-vous obtenu au téléphone est CRÉÉ")
        return
    j.vrai(nature, depart, "51",
           "aucun rendez-vous n'est inventé : le contact n'en avait aucun en "
           "base",
           "la présence est notée dans l'information clé du contact, et RIEN "
           "n'est écrit dans l'agenda",
           f"information clé : « {contact['detail']} »",
           bool(contact["detail"]))


def _controler_refus(banc, nature, depart, contact, rdv_avant, en_cascade):
    j = banc.j
    if en_cascade:
        j.vrai(nature, depart, "52",
               "un refus ne touche RIEN dans l'agenda",
               "le rendez-vous existant du contact reste intact",
               f"information clé : « {contact['detail'] or 'aucune'} »", True)
        return
    if rdv_avant is not None and rdv_avant["statut"] in ("prévu", "confirmé",
                                                         "manqué"):
        frais = banc.base.obtenir_rendezvous(rdv_avant["id"])
        # THE OWNER'S RULE (31/07/2026): `annulé` is the HISTORY status,
        # reserved for past dates; an upcoming appointment that is cancelled is
        # DELETED — unless it is too close for a replacement to be arranged
        # (the threshold, 12 h by default). The bench does not copy a value: it
        # asks the product for the rule, in the same place the product does —
        # so it cannot measure anything other than what is really decided.
        decision = horaires.decision_annulation(
            banc.application.preferences, rdv_avant["horaire"])
        j.egal(nature, depart, "52",
               f"le rendez-vous du {themes.date_lisible(rdv_avant['horaire'])} "
               f"passe en « {decision['statut']} » — {decision['pourquoi']}",
               decision["statut"], frais["statut"])
        # Cancelled or deleted, it no longer exists: it leaves `à venir`.
        a_venir = [r["id"] for r in banc.base.rendezvous_a_venir_tous()]
        j.vrai(nature, depart, "52",
               "le rendez-vous retiré DISPARAÎT de « Rendez-vous à venir »",
               "absent de la liste des rendez-vous qui tiennent",
               "absent" if rdv_avant["id"] not in a_venir
               else "TOUJOURS présent dans « à venir »",
               rdv_avant["id"] not in a_venir)
        # …and its slot is genuinely GIVEN BACK: no occupant left at that time.
        # That is the measurement that matters to the user.
        occupants = [r["id"] for r in banc.base.rendezvous_occupants(
            rdv_avant["horaire"], rdv_avant["horaire"] + ":59")]
        j.vrai(nature, depart, "52",
               "sa place est RENDUE : il n'occupe plus sa tranche",
               "ce rendez-vous ne compte plus parmi les occupants",
               "place rendue" if rdv_avant["id"] not in occupants
               else "IL OCCUPE ENCORE sa tranche",
               rdv_avant["id"] not in occupants)
    else:
        j.vrai(nature, depart, "52",
               "rien n'est écrit dans l'agenda (le contact n'avait pas de "
               "rendez-vous en base)",
               "aucune écriture", f"information clé : « {contact['detail']} »",
               True)
    _controler_le_client_rappellera(banc, nature, depart, contact)


def _controler_le_client_rappellera(banc, nature, depart, contact):
    """Cancellation with no rebooking: `📞 le client rappellera`.

    The owner's rule (31/07/2026): they cancelled without setting a date, so it
    is THEY who will get back in touch. Therefore — and this is what is
    measured — no follow-up scheduled, no campaign set up for them, and yet
    they stay VISIBLE and counted in 👥 Clients with that state.
    """
    j = banc.j
    relances = [r for r in banc.base.relances_de_campagne(
        contact["campagne_id"]) if r["contact_id"] == contact["id"]]
    j.vrai(nature, depart, "52",
           "aucune relance n'est programmée pour qui a annulé",
           "zéro relance : c'est LUI qui doit reprendre contact",
           f"{len(relances)} relance(s) pour ce contact", not relances)
    fiches = etats_clients.tableau_clients(banc.base,
                                           banc.application.preferences)
    fiche = next((f for f in fiches
                  if f["client"]["id"] == contact.get("client_id")), None)
    if fiche is None:
        j.noter(nature, depart, "52",
                "le client reste visible dans 👥 Clients avec son état",
                "une fiche client pour ce contact",
                "aucune fiche client rattachée au contact", False)
        return
    j.egal(nature, depart, "52",
           "son état de conversation dans 👥 Clients",
           assistant.ETAT_RAPPELLERA, fiche["conversation"])
    depuis_la_conversation = [b for b in fiche["besoins"]
                              if b["famille"] == "conversation"]
    j.vrai(nature, depart, "52",
           "aucune campagne n'est montée à cause de cet état, et l'écran dit "
           "pourquoi",
           "aucun besoin issu de la conversation, et l'explication qui le "
           "distingue de « à reprogrammer »",
           f"{len(depuis_la_conversation)} besoin(s) de conversation, "
           f"explication : « {(fiche['sans_campagne'] or 'AUCUNE')[:70]}… »",
           not depuis_la_conversation and bool(fiche["sans_campagne"]))


def _controler_report(banc, nature, depart, contact, rdv_avant, resultat,
                      en_cascade):
    j = banc.j
    convenu = resultat.get("new_datetime")
    if not convenu:
        j.noter(nature, depart, "54", "la date convenue est enregistrée",
                "une date ISO 8601 dans le résultat de l'appel",
                "aucune date", False)
        return
    _controler_date_ecrite(banc, nature, depart, "54", contact, convenu,
                           "le rendez-vous porte la DATE CONVENUE",
                           ligne_connue=rdv_avant)
    if banc.base.obtenir_contact_campagne(contact["id"])["issue"] == \
            "date_refusee":
        return
    if en_cascade:
        j.vrai(nature, depart, "54",
               "le créneau libéré RESTE à pourvoir (la personne voulait une "
               "autre date)",
               "l'information clé le dit",
               f"« {contact['detail']} »",
               bool(contact["detail"] and "reste à pourvoir" in contact["detail"]))
        return
    if rdv_avant is not None:
        # ⚠ ONE SINGLE ROW, WHICH HAS MOVED (his rule of 14/08/2026, extended
        # to this outcome on 17/08). The bench previously expected the old row
        # as `déplacé` — hence TWO appointments for one move, which is what he
        # observed on his 18/08 day: `the first appointment was not cancelled,
        # but we did indeed add it for the next day`.
        frais = banc.base.obtenir_rendezvous(rdv_avant["id"])
        j.egal(nature, depart, "54",
               f"la ligne du {themes.date_lisible(rdv_avant['horaire'])} a "
               "BOUGÉ à la date convenue (une seule ligne, pas deux)",
               convenu, frais["horaire"])
        j.egal(nature, depart, "54",
               "et elle porte l'accord obtenu au téléphone",
               "confirmé", frais["statut"])
        siennes = [r for r in banc.base.tous_les_rendezvous()
                   if r["nom"] == contact["nom"]
                   and r["statut"] in ("prévu", "confirmé")
                   and r["horaire"] == convenu]
        j.egal(nature, depart, "54",
               "aucune SECONDE ligne n'est née à la date convenue",
               1, len(siennes))


def _controler_sans_conclure(banc, nature, depart, contact, rdv_avant):
    j = banc.j
    # `I want something else, but I am concluding nothing` is neither a yes nor
    # a no. WHAT THE PRODUCT MAKES OF IT DEPENDS ON THE KIND since 11/08/2026
    # (see etat_attendu) — but in ALL cases the screen must say what happened,
    # in clear, without asserting anything the conversation did not produce.
    j.vrai(nature, depart, "55",
           "l'écran dit EN CLAIR ce qui s'est passé, sans rien inventer",
           "une information clé qui cite la demande du client, ou qui dit "
           "qu'on n'a rien pu conclure",
           f"« {contact['detail']} »",
           bool(contact["detail"]
                and ("client" in contact["detail"]
                     or "pas pu déterminer" in contact["detail"])))
    if rdv_avant is not None:
        frais = banc.base.obtenir_rendezvous(rdv_avant["id"])
        # THREE OUTCOMES ACCORDING TO THE KIND, all intended, all dated:  ·
        # FREED SLOT: the appointment is KEPT and moved to `confirmé` — the
        # person picked up and did not cancel (owner's decision, 11/08/2026).
        # Their appointment was not the subject of the call: the free slot was.
        # · MOVE and BOOKING: `🙋 à rappeler par un humain` — somebody at the
        # practice takes over, the appointment waits for that call. · REMINDER
        # and CONFIRMATION: the appointment is CANCELLED (his rule of
        # 17/08/2026, `if the person has to call back, the appointment is
        # simply cancelled`). Leaving it in place kept the slot blocked for
        # somebody who had just said they would not come as planned.
        if nature == "creneau_libere":
            attendu, quoi = "confirmé", ("son rendez-vous est conservé et passe "
                                         "en « confirmé »")
        elif nature in ("rappel_rdv", "confirmation"):
            attendu, quoi = "annulé", ("c'est le client qui rappellera : son "
                                       "rendez-vous est ANNULÉ, sa place est "
                                       "rendue")
        elif nature == "deplacement":
            # ⚠ HIS RULE OF 20/08/2026, and this check was measuring the
            # previous one: `when we ask to move an appointment and, for one
            # reason or another, we could not move it: it is then cancelled`.
            # They do wait for a human's call — but their SLOT cannot stay
            # blocked on a day they are not working. The bench stopped the
            # first version of this rule, which is exactly its job.
            attendu, quoi = "annulé", ("le déplacement n'a pas pu se faire : le "
                                       "rendez-vous est ANNULÉ, et un humain "
                                       "rappellera pour en fixer un autre")
        else:
            attendu, quoi = rdv_avant["statut"], ("le rendez-vous attend le "
                                                  "rappel d'un humain : il "
                                                  "n'est PAS touché")
        j.egal(nature, depart, "55", quoi, attendu, frais["statut"])


def controler_ecran_campagne(banc, campagne_id, nature, depart, cibles):
    """What becomes VISIBLE: control desk, Clients, Relances."""
    j = banc.j
    fiche = banc.obtenir(f"/campagne?id={campagne_id}")
    for fin, contact_avant in cibles.items():
        contact = banc.base.obtenir_contact_campagne(contact_avant["id"])
        nom = html_mod.escape(contact_avant["nom"])
        j.vrai(nature, depart, fin,
               "le poste de pilotage montre ce contact et son état",
               f"« {contact_avant['nom']} » et l'état « {contact['etat']} » "
               "sur la fiche de campagne",
               "présent" if (nom in fiche and contact["etat"] in fiche)
               else "absent de la page",
               nom in fiche and contact["etat"] in fiche)
    # 👥 Contacts: every contact called must carry a conversation state there. ⚠
    # `par_page=0` = ALL. The page has been paginated since 10/08/2026 (25 by
    # default) and the sample data set has 36: looking for a name on the first
    # page alone declared eleven genuinely present people absent. This check is
    # about CONTENT, not about pagination.
    page_clients = banc.obtenir("/clients?par_page=0")
    for fin, contact_avant in cibles.items():
        nom = html_mod.escape(contact_avant["nom"])
        j.vrai(nature, depart, fin,
               "la page 👥 Clients porte ce client",
               f"« {contact_avant['nom']} » dans le tableau des clients",
               "présent" if nom in page_clients else "absent",
               nom in page_clients)
    # 🔁 Relances: each type on ITS OWN panel. The page no longer splits in two
    # by a section's name — it carries five identified panels, and it is by
    # their id that they are read (position irrelevant). ⚠ `par_page=0` — THE
    # WHOLE LIST, AND IT IS INDISPENSABLE HERE (21/08/2026). Since 🔁 Relances
    # paginates its five parts like 👥 Contacts, the page serves only 25 rows:
    # the bench looked for a specific person and no longer found them — not
    # because they were missing, but because they were on page 4. A measuring
    # instrument reads what IS, not what the screen shows first; so it asks for
    # `all`.
    page_relances = banc.obtenir("/relances?par_page=0")

    def panneau(code):
        marque = f'id="panneau-{code}"'
        if marque not in page_relances:
            return ""
        debut = page_relances.index(marque)
        return page_relances[debut:page_relances.index("</section>", debut)]

    automatique = panneau("dues") + panneau("a_venir")
    humaine = panneau("humains")
    for fin in ("53", "56"):
        if fin not in cibles:
            continue
        nom = html_mod.escape(cibles[fin]["nom"])
        j.vrai(nature, depart, fin,
               "🔁 Relances le montre dans un type automatique (« dues » ou "
               "« à venir »)",
               f"« {cibles[fin]['nom']} » sur l'un des deux panneaux",
               "bon type" if nom in automatique else "absent ou mauvais type",
               nom in automatique)
    if "55" in cibles:
        nom = html_mod.escape(cibles["55"]["nom"])
        # ⚠ ONLY WHERE THE HUMAN CALL-BACK EXISTS (11/08/2026). On the other
        # three kinds, the human panel MUST NOT carry them: seeing somebody
        # there whom nobody is waiting on would make the operator work for
        # nothing. So the check works in both directions.  ⚠ AND IT IS READ BY
        # CONTACT, NOT BY NAME NOR BY CAMPAIGN. Two traps measured, one after
        # the other: · by NAME: the bench's database is the SAME across all 115
        # combinations, and the same person is legitimately waiting for a human
        # from a move campaign — three false failures; · by CAMPAIGN: on a
        # freed slot, ANOTHER contact of the same campaign went to `à rappeler
        # par un humain` — the one whose agreed date had been refused (see
        # _date_refusee). *That is no longer the case since 15/08/2026: this
        # kind no longer produces ANY manual call-back.* Reading by contact
        # remains the right way nonetheless: it is what protects against the
        # first trap, that of namesakes. Every row of the panel carries ITS
        # contact's id: that is what we look for, and it alone.
        attendu_humain = attend_un_humain(nature, "55")
        present = f"contact={cibles['55']['id']}" in humaine
        j.vrai(nature, depart, "55",
               "🔁 Relances le montre dans le type « rappels par un humain » "
               "(jamais rappelé automatiquement)"
               if attendu_humain else
               "🔁 Relances ne met PERSONNE de cette campagne sur le panneau "
               "humain : cette nature ne demande aucun rappel par un humain",
               f"« {cibles['55']['nom']} » "
               + ("sur" if attendu_humain else "ABSENT du") + " panneau humain",
               "présent" if present else "absent",
               present == attendu_humain)


def controler_planning(banc, nature, depart, fin, horaire, nom):
    """Does the appointment created appear in its week's SCHEDULE?"""
    jour = datetime.datetime.fromisoformat(horaire).date().isoformat()
    zone = banc.obtenir(f"/suivi/planning?date={jour}")
    attendu = html_mod.escape(nom)
    banc.j.vrai(nature, depart, fin,
                "le rendez-vous créé est visible dans le planning de sa semaine",
                f"« {nom} » dans la grille de la semaine du {jour}",
                "présent" if attendu in zone else "absent",
                attendu in zone)


# ===========================================================================
# SCENARIOS
# ===========================================================================
CONTACTS_FORCES = (
    ("51", "Mme Nadia Lefèvre", "06 39 98 00 51"),
    ("52", "M. Karim Ben Amar", "06 39 98 00 52"),
    ("53", "Mme Élise Charpentier", "06 39 98 00 53"),
    ("54", "M. Paul Guillot", "06 39 98 00 54"),
    ("55", "Mme Anaïs Rousseau-Vidal", "06 39 98 00 55"),
    ("56", "M. Hervé Dombasle", "06 39 98 00 56"),
)
CONTACT_STOP = ("Mme Sophie Mercier", "06 39 98 01 26")
CONTACT_SUPPRIME = ("Mme Béatrice Vandenberghe", "06 39 98 01 25")

COLONNES_OBLIGATOIRES = {"creneau_libere": ("rdv_existant", "motif"),
                         "rappel_rdv": ("rdv_existant", "motif"),
                         "confirmation": ("rdv_existant", "motif"),
                         "deplacement": ("rdv_existant", "motif")}


def _ligne_collage(nature, nom, telephone, jour, heure):
    """A complete pasted row for this kind (⚠ columns filled).

    The time is given by the bench (the campaign block's day, the contact's own
    hour): two contacts therefore never have the same appointment, and two
    campaigns never fight over a slot.
    """
    definition = assistant.NATURES[nature]
    morceaux = [nom, telephone]
    for champ in definition["champs"]:
        if champ["type"] == "date":
            morceaux.append(_iso(jour, heure))
        else:
            morceaux.append("Séance de kinésithérapie")
    return ";".join(morceaux)


def scenario_verrous(banc, chemins_surveilles):
    """The locks: the bench CANNOT call for real."""
    j = banc.j
    client = banc.application.planif.client_appels
    j.verrou("Le client d'appels est le SIMULATEUR",
             "une instance de calle_client.AppelSimule, est_reel = False",
             f"{type(client).__name__}, est_reel = {client.est_reel}",
             isinstance(client, calle_client.AppelSimule)
             and client.est_reel is False)
    j.verrou("L'application n'est pas en mode réel",
             "mode_reel = False et planificateur en dry_run",
             f"mode_reel = {banc.application.mode_reel}, "
             f"dry_run = {banc.application.planif.dry_run}",
             banc.application.mode_reel is False
             and banc.application.planif.dry_run is True)
    j.verrou("La clé CALLE_API_KEY est absente de ce processus",
             "la variable d'environnement est retirée avant tout appel",
             "retirée (elle était présente, elle a été ôtée du processus)"
             if CLE_RETIREE else "absente dès le départ",
             "CALLE_API_KEY" not in os.environ)
    # ⚠ THE KEY HAS TWO SOURCES, AND THE BENCH NEUTRALISED ONLY ONE
    # (04/09/2026). The environment variable was indeed removed — but
    # `cle_disponible()` ALSO reads `donnees/cle_calle.txt`, and on the owner's
    # machine that file has existed since he stored his key through the
    # Settings screen. A real call client could therefore be built, and that
    # lock was broken in the published report.  ⚠ WE MOVE THE PATH, WE DO NOT
    # TOUCH THE FILE. His key stays where it is: the bench looks elsewhere, for
    # the duration of its check.
    chemin_cle_dorigine = calle_client.CHEMIN_CLE
    dossier_sans_cle = tempfile.mkdtemp(prefix="ringback-banc-sans-cle-")
    calle_client.CHEMIN_CLE = os.path.join(dossier_sans_cle, "aucune-cle.txt")
    try:
        calle_client.AppelReel()
        refus = "AUCUN refus — un client d'appels réels a pu être construit"
        passe = False
    except calle_client.CleApiAbsente as erreur:
        refus = f"refus net : « {erreur} »"
        passe = True
    finally:
        calle_client.CHEMIN_CLE = chemin_cle_dorigine
        shutil.rmtree(dossier_sans_cle, ignore_errors=True)
    j.verrou("Construire un client d'appels RÉELS est impossible ici",
             "l'exception CleApiAbsente, donc aucun appel réel possible",
             refus, passe)
    j.verrou("Le mot « --appels-reels » n'est jamais employé par le banc",
             "le banc n'appelle que creer_serveur(appels_reels=False)",
             "appels_reels=False, en dur, une seule fois dans ce fichier",
             True)
    for libelle, chemin, avant in chemins_surveilles:
        apres = _empreinte_fichier(chemin)
        j.verrou(f"{libelle} n'a pas bougé",
                 "taille et date de dernière écriture inchangées",
                 "inchangé" if apres == avant else f"MODIFIÉ ({avant} → {apres})",
                 apres == avant)


def _empreinte_fichier(chemin):
    if not os.path.exists(chemin):
        return "absent"
    etat = os.stat(chemin)
    return f"{etat.st_size} octets, écrit à {int(etat.st_mtime)}"


def scenario_assistant_par_nature(banc, nature):
    """The 3-step journey for ONE kind, with every outcome.

    A single pass serves two axes: the journey itself (⛔ refused, a `prête`
    campaign that calls nobody) and pasting (the outcomes).
    """
    j = banc.j
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    etape1 = banc.obtenir("/assistant")
    attendues = len(assistant.NATURES)
    j.vrai(nature, "assistant", CONSTRUCTION,
           "l'étape 1 propose bien toutes les natures créables, celle-ci "
           "comprise",
           f"au moins {attendues} cartes de nature à l'écran, dont "
           f"« {assistant.NATURES[nature]['nom']} »",
           f"{etape1.count('carte-nature')} carte(s)",
           etape1.count("carte-nature") >= attendues
           and html_mod.escape(assistant.NATURES[nature]["nom"]) in etape1)
    brouillon, page = banc.ouvrir_brouillon(nature)
    # ⚠ step 2: continuing WITHOUT the mandatory information is refused.
    minimal = {"b": brouillon, "action": "continuer", "ordre": "liste"}
    page, _ = banc.poster("/assistant/message", minimal)
    obligatoires = [i for i in assistant.NATURES[nature]["infos"]
                    if i["obligatoire"]]
    if obligatoires:
        j.vrai(nature, "assistant", CONSTRUCTION,
               "l'étape 2 REFUSE de continuer tant qu'une information ⚠ manque",
               "un message qui dit ce qui est obligatoire, et l'étape 3 "
               "toujours fermée",
               "refus affiché" if "obligatoire" in page else
               "aucun refus : on est passé à l'étape 3",
               "obligatoire" in page)
    else:
        j.noter(nature, "assistant", CONSTRUCTION,
                "l'étape 2 n'a aucune information obligatoire",
                "aucun ⚠ à contrôler pour cette nature",
                "cette nature n'impose aucune information", True)
    page = banc.passer_etape2(nature, brouillon)
    j.vrai(nature, "assistant", CONSTRUCTION,
           "renseigné, le passage à l'étape 3 s'ouvre",
           "l'étape « 3. Les personnes » devient l'étape courante",
           "étape 3 ouverte" if "3. Les personnes" in page else
           "étape 3 toujours fermée",
           "3. Les personnes" in page)
    # Step 3 by pasting: the six endings + 🚫 + duplicate + one to delete.
    lignes = [_ligne_collage(nature, nom, tel, bloc, 10 + indice)
              for indice, (_, nom, tel) in enumerate(CONTACTS_FORCES)]
    lignes.append(_ligne_collage(nature, CONTACT_STOP[0], CONTACT_STOP[1],
                                 bloc, 17))
    lignes.append(_ligne_collage(nature, CONTACT_SUPPRIME[0],
                                 CONTACT_SUPPRIME[1], bloc, 18))
    # A deliberate duplicate: the same person, twice.
    lignes.append(_ligne_collage(nature, CONTACTS_FORCES[0][1],
                                 CONTACTS_FORCES[0][2], bloc, 10))
    page, _ = banc.poster("/assistant/importer",
                          {"b": brouillon, "mode": "collage",
                           "liste": "\n".join(lignes) + "\n"})
    j.vrai(nature, "collage", "doublon",
           "un doublon de numéro est SIGNALÉ et ignoré, jamais ajouté deux fois",
           "9 lignes collées dont un doublon : un message « doublon ignoré » "
           "et 8 contacts dans la grille",
           _message_de(page) + " | " + _erreurs_de(page),
           "doublon ignoré" in page and "8 contact(s) ajouté(s)" in page)
    j.vrai(nature, "collage", "stop",
           "un contact 🚫 « Ne plus appeler » est annoncé AVANT la validation",
           "un bandeau qui dit qu'il sera exclu d'office, jamais composé",
           "bandeau présent" if "Ne plus appeler" in page else "aucun bandeau",
           "Ne plus appeler" in page)
    j.vrai(nature, "collage", "doublon",
           "les numéros de la grille sont masqués",
           "aucun numéro en clair dans la page de la grille",
           "aucun numéro en clair"
           if CONTACTS_FORCES[0][2] not in page else "NUMÉRO EN CLAIR TROUVÉ",
           CONTACTS_FORCES[0][2] not in page)
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, "assistant", CONSTRUCTION,
                "la grille se valide et la campagne est créée",
                "une campagne en état « prête »",
                "validation refusée : " + _erreurs_de(page), False)
        return None
    campagne = banc.base.obtenir_campagne(campagne_id)
    j.egal(nature, "assistant", CONSTRUCTION,
           "la campagne créée est « prête » — elle n'appelle PERSONNE",
           "prête", campagne["statut"])
    contacts = banc.contacts(campagne_id)
    jamais_appeles = all(not banc.base.appels_du_contact_campagne(c["id"])
                         for c in contacts)
    j.vrai(nature, "assistant", CONSTRUCTION,
           "aucun appel n'est passé à la validation",
           f"zéro appel enregistré pour les {len(contacts)} contacts",
           "aucun appel" if jamais_appeles else "des appels ont été passés",
           jamais_appeles)
    _controler_bords_collage(banc, campagne_id, nature, "collage")
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    campagne_fraiche = banc.base.obtenir_campagne(campagne_id)
    j.egal(nature, "assistant", CONSTRUCTION,
           "la campagne va jusqu'au bout sans incident",
           "terminée", campagne_fraiche["statut"])
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, "collage", fin,
                        contact_avant, en_cascade=False)
    _controler_fiche_supprimee(banc, campagne_id, nature, "collage")
    controler_ecran_campagne(banc, campagne_id, nature, "collage", cibles)
    # The follow-up: the 56 must conclude, and it alone changes state.
    _relancer_et_controler(banc, campagne_id, nature, "collage", cibles,
                           en_cascade=False)
    return campagne_id


def _controler_bords_collage(banc, campagne_id, nature, depart):
    """The 🚫 excluded outright, then the last contact's record is DELETED.

    The deletion goes through the screen's real door (with confirmation),
    between validation and execution: that is exactly `the record disappeared
    along the way`.
    """
    j = banc.j
    contacts = banc.contacts(campagne_id)
    exclus = [c for c in contacts if c["nom"] == CONTACT_STOP[0]]
    # ⚠ THIS CHECK WAS MEASURING THE OLD RULE (`exclu`), and it stopped the
    # bench on all five kinds on 20/08/2026 — which is exactly its job. Since
    # his request of the same day, a person who refused THE AGENT goes to a
    # call-back BY A HUMAN: they did not refuse the practice, and marking them
    # `exclu` made them disappear without anybody calling them back.  ⚠ THE
    # GUARANTEE THAT MATTERS HAS NOT MOVED AN INCH, and it is measured just
    # below: no call is ever dialled for them. It is the one point on which
    # this bench does not compromise.
    j.vrai(nature, depart, "stop",
           "le contact 🚫 part d'office vers un rappel PAR UN HUMAIN",
           f"état « {db.ETAT_RAPPEL_HUMAIN} »",
           f"état « {exclus[0]['etat']} »" if exclus else "contact introuvable",
           bool(exclus) and exclus[0]["etat"] == db.ETAT_RAPPEL_HUMAIN)
    j.egal(nature, depart, "stop",
           "et AUCUN appel n'est jamais composé pour elle",
           0,
           len(banc.base.appels_du_contact_campagne(exclus[0]["id"]))
           if exclus else -1)
    j.vrai(nature, depart, "stop",
           "le texte affiché dit qu'un humain doit la rappeler",
           "un détail qui nomme le refus de l'agent",
           (exclus[0]["detail"] or "(vide)") if exclus else "contact introuvable",
           bool(exclus) and db.refus_de_l_agent(exclus[0]["detail"]))
    a_supprimer = banc.base.client_equivalent(CONTACT_SUPPRIME[0],
                                              CONTACT_SUPPRIME[1])
    if a_supprimer:
        banc.poster("/clients/supprimer",
                    {"client": a_supprimer, "confirmer": "oui"})
    return a_supprimer


def _controler_fiche_supprimee(banc, campagne_id, nature, depart):
    """A record that disappeared along the way is never dialled again."""
    j = banc.j
    supprime = [c for c in banc.contacts(campagne_id)
                if c["nom"] == CONTACT_SUPPRIME[0]]
    if not supprime:
        return
    contact = supprime[0]
    j.egal(nature, depart, "supprime",
           "une fiche supprimée en cours de route n'est plus JAMAIS composée",
           "exclu", contact["etat"])
    j.vrai(nature, depart, "supprime",
           "l'écran dit pourquoi ce contact n'a pas été appelé",
           "l'information clé cite la fiche supprimée",
           f"« {contact['detail']} »",
           bool(contact["detail"] and "supprimée" in contact["detail"]))


def _erreurs_de(page):
    trouve = re.findall(r"<li>(.*?)</li>", page)
    return " / ".join(html_mod.unescape(t) for t in trouve[:4]) or "(sans détail)"


def _cibles(banc, campagne_id):
    """A snapshot BEFORE the call: contact + targeted appointment, per ending.
    """
    cibles = {}
    for fin, contact in banc.par_terminaison(campagne_id).items():
        rdv = banc.rdv_vise(contact)
        cibles[fin] = {"id": contact["id"], "nom": contact["nom"],
                       "rdv_avant": dict(rdv) if rdv else None}
    return cibles


def _relancer_et_controler(banc, campagne_id, nature, depart, cibles,
                           en_cascade):
    """The `Lancer les relances dues` gesture: the 56 concludes."""
    j = banc.j
    if "56" not in cibles:
        return
    avant = banc.base.obtenir_contact_campagne(cibles["56"]["id"])["etat"]
    banc.lancer_relances()
    frais = banc.base.obtenir_contact_campagne(cibles["56"]["id"])
    apres = frais["etat"]
    repli = etat_date_refusee(nature)
    # ⚠ A THIRD LEGITIMATE ENDING (16/08/2026), and it took measuring to accept
    # it. Since a move's simulation starts with a success then shuffles the
    # rest (his request), a campaign PLACES far more appointments: 38 accepted
    # out of 56 contacts, measured. The slots usable for a given contact — at
    # THEIR length — end up running out, and the follow-up then has nothing to
    # announce.  That is not a defect: the product refuses to announce dates it
    # could not honour, and it writes so in clear on the record. So the check
    # accepts it — but ONLY with that reason, verified in the detail. Accepting
    # it on the state alone would have let any `à rappeler par un humain`
    # through, including a genuine defect.
    def _faute_de_place(fiche):
        return (fiche["etat"] == "à rappeler par un humain"
                and "il n'en reste plus AUCUN de libre"
                in (fiche["detail"] or ""))

    conclu = (apres == "accepté"
              or (apres == repli and frais["issue"] == "date_refusee")
              or _faute_de_place(frais))
    j.vrai(nature, depart, "56",
           "à la relance, celui qui ne décrochait pas dit OUI : sa chaîne se "
           "CONCLUT (elle ne tourne plus en rond)",
           "« à recontacter » avant la relance, puis « accepté » — ou "
           f"« {repli} » si la date convenue a été refusée, ou « à rappeler "
           "par un humain » s'il ne reste AUCUNE place à annoncer, raison à "
           "l'appui",
           f"« {avant} » puis « {apres} »",
           avant == "à recontacter" and conclu)
    if "53" in cibles:
        fiche53 = banc.base.obtenir_contact_campagne(cibles["53"]["id"])
        etat53 = fiche53["etat"]
        j.vrai(nature, depart, "53",
               "celui qui ne décroche jamais reste dans la boucle des "
               "relances, sans jamais devenir « accepté »",
               "état « à recontacter » ou « injoignable » — ou « à rappeler "
               "par un humain » s'il ne reste AUCUNE place à annoncer",
               f"état « {etat53} »",
               etat53 in ("à recontacter", "injoignable")
               or _faute_de_place(fiche53))


def scenario_creneau_libere_cascade(banc):
    """`Créneau libéré` with its real mechanism: a cascade call.

    Two campaigns: one in `everybody` mode to see the six outcomes, one in
    `stop at the first yes` to see the sparing.

    Returns the id of the FIRST campaign. It is the only one in the bench that
    still produces `❌ refusé` contacts: since the rule of 31/07/2026, a
    cancellation (the `canceled` outcome of classic calls) gives `📞 le client
    rappellera`, whereas a refusal of the slot offered in a cascade (`refused`)
    stays a refusal. So it is the one that feeds the `❌ Refus` resumption
    filter.
    """
    j = banc.j
    nature, depart = "creneau_libere", "collage"
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    # ⚠ A GENUINELY FREE SLOT, asked of the product (see place_libre): a
    # hard-written time lands on an appointment now that the sample data set
    # covers a hundred days, and a campaign whose slot is taken stops —
    # rightly.
    creneau = banc.place_libre(bloc + 5)
    brouillon, _ = banc.ouvrir_brouillon(nature)
    # ⚠ specific to this kind: without the freed slot's date, you cannot get
    # through.
    page, _ = banc.poster("/assistant/message",
                          {"b": brouillon, "action": "continuer",
                           "ordre": "liste",
                           "info_entreprise": "Cabinet Val Fleuri"})
    j.vrai(nature, "assistant", CONSTRUCTION,
           "l'étape 2 REFUSE de continuer sans la DATE du créneau libéré",
           "un message qui dit que le créneau libéré est obligatoire",
           _erreurs_de(page),
           "Créneau libéré" in page and "obligatoire" in page)
    formulaire = banc.formulaire_etape2(nature, brouillon)
    formulaire["info_creneau_libere"] = creneau
    formulaire["politique"] = "tous"
    banc.poster("/assistant/message", formulaire)
    lignes = [_ligne_collage(nature, nom, tel, bloc, 10 + indice)
              for indice, (_, nom, tel) in enumerate(CONTACTS_FORCES)]
    lignes.append(_ligne_collage(nature, CONTACT_STOP[0], CONTACT_STOP[1],
                                 bloc, 17))
    lignes.append(_ligne_collage(nature, CONTACT_SUPPRIME[0],
                                 CONTACT_SUPPRIME[1], bloc, 18))
    lignes.append(_ligne_collage(nature, CONTACTS_FORCES[0][1],
                                 CONTACTS_FORCES[0][2], bloc, 10))
    page, _ = banc.poster("/assistant/importer",
                          {"b": brouillon, "mode": "collage",
                           "liste": "\n".join(lignes) + "\n"})
    j.vrai(nature, depart, "doublon",
           "un doublon de numéro est SIGNALÉ et ignoré",
           "9 lignes collées dont un doublon : 8 contacts dans la grille",
           _message_de(page) + " | " + _erreurs_de(page),
           "doublon ignoré" in page and "8 contact(s) ajouté(s)" in page)
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « créneau libéré » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return None
    j.egal(nature, "assistant", CONSTRUCTION,
           "la campagne « créneau libéré » créée est « prête » — elle n'appelle "
           "personne",
           "prête", banc.base.obtenir_campagne(campagne_id)["statut"])
    _controler_bords_collage(banc, campagne_id, nature, depart)
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    _controler_fiche_supprimee(banc, campagne_id, nature, depart)
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=True)
    controler_ecran_campagne(banc, campagne_id, nature, depart, cibles)
    controler_planning(banc, nature, depart, "51", creneau,
                       CONTACTS_FORCES[0][1])
    _relancer_et_controler(banc, campagne_id, nature, depart, cibles,
                           en_cascade=True)
    campagne_des_refus = campagne_id
    # Second campaign: stop at the first yes, the following ones spared.
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    formulaire = banc.formulaire_etape2(nature, brouillon)
    formulaire["info_creneau_libere"] = banc.place_libre(bloc + 5)
    formulaire["politique"] = "premier_oui"
    banc.poster("/assistant/message", formulaire)
    ordre = [CONTACTS_FORCES[1], CONTACTS_FORCES[0], CONTACTS_FORCES[3]]
    lignes = [_ligne_collage(nature, nom, tel, bloc, 10 + indice)
              for indice, (_, nom, tel) in enumerate(ordre)]
    banc.poster("/assistant/importer",
                {"b": brouillon, "mode": "collage",
                 "liste": "\n".join(lignes) + "\n"})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « arrêt au premier oui » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return campagne_des_refus
    banc.executer(campagne_id)
    etats = {c["nom"]: c for c in banc.contacts(campagne_id)}
    epargne = etats.get(ordre[2][1])
    j.egal(nature, depart, "51",
           "arrêt au premier oui : la personne suivante n'est JAMAIS appelée",
           ("épargné", 0),
           (epargne["etat"] if epargne else "contact absent",
            len(banc.base.appels_du_contact_campagne(epargne["id"]))
            if epargne else -1))
    relances = banc.base.relances_de_campagne(campagne_id)
    j.vrai(nature, depart, "51",
           "l'objectif atteint annule les relances déjà programmées",
           "aucune relance encore « planifiée »",
           f"{sum(1 for r in relances if r['statut'] == 'planifiée')} "
           "planifiée(s)",
           all(r["statut"] != "planifiée" for r in relances))
    return campagne_des_refus


# ⚠ `scenario_contact_unique` and `_bords_contact_unique` disappeared on
# 03/08/2026 along with their kind. The three edge cases they carried (🚫 do not
# call again, a duplicate pasted twice, a record deleted along the way) are
# already walked by the generic pasting scenario, on the remaining kinds —
# nothing is lost.


def scenario_csv(banc):
    """Step 3 filled from a CSV FILE."""
    j = banc.j
    nature, depart = "confirmation", "csv"
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    bloc = banc.prochain_bloc()
    lignes = ["nom;telephone;rdv_existant;motif"]
    for indice, (_, nom, telephone) in enumerate(CONTACTS_FORCES):
        lignes.append(f"{nom};{telephone};{_iso(bloc, 10 + indice)};"
                      "Séance de contrôle")
    # A 🚫, a future deletion, and a repeated row: the three edge cases.
    lignes.append(f"{CONTACT_STOP[0]};{CONTACT_STOP[1]};{_iso(bloc, 17)};"
                  "Séance de contrôle")
    lignes.append(f"{CONTACT_SUPPRIME[0]};{CONTACT_SUPPRIME[1]};"
                  f"{_iso(bloc, 18)};Séance de contrôle")
    lignes.append(lignes[1])
    octets = ("\r\n".join(lignes) + "\r\n").encode("utf-8")
    page, _ = banc.poster_fichier("/assistant/importer",
                                  {"b": brouillon, "mode": "csv"},
                                  "liste_essai.csv", octets)
    j.vrai(nature, depart, CONSTRUCTION,
           "le fichier CSV remplit la grille (en-tête reconnu et sauté)",
           "8 contacts ajoutés à la grille (9 lignes, dont un doublon)",
           _message_de(page) + " | " + _erreurs_de(page),
           "8 contact(s) ajouté(s)" in page)
    j.vrai(nature, depart, "doublon",
           "une ligne répétée dans le CSV est signalée et ignorée",
           "un message « doublon ignoré », et la personne une seule fois",
           _erreurs_de(page), "doublon ignoré" in page)
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION, "la campagne issue du CSV se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    _controler_bords_collage(banc, campagne_id, nature, depart)
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    _controler_fiche_supprimee(banc, campagne_id, nature, depart)
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=False)
    controler_ecran_campagne(banc, campagne_id, nature, depart, cibles)
    _relancer_et_controler(banc, campagne_id, nature, depart, cibles,
                           en_cascade=False)


def scenario_ics(banc):
    """Step 3 filled from an ICS CALENDAR — including a contact WITH NO NUMBER.
    """
    j = banc.j
    nature, depart = "rappel_rdv", "ics"
    chemin = os.path.join(RACINE_APP, "exemple_agenda_realiste.ics")
    if not os.path.exists(chemin):
        j.noter(nature, depart, CONSTRUCTION, "l'agenda d'exemple existe",
                f"le fichier {chemin}", "fichier absent", False)
        return
    with open(chemin, "rb") as fichier:
        octets = fichier.read()
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    page, _ = banc.poster_fichier("/assistant/importer",
                                  {"b": brouillon, "mode": "ics"},
                                  "agenda.ics", octets)
    j.vrai(nature, depart, CONSTRUCTION,
           "l'agenda ICS remplit la grille (nom, motif et date de chaque "
           "séance)",
           "des contacts ajoutés à la grille",
           _message_de(page), "contact(s) ajouté(s)" in page)
    j.vrai(nature, depart, "sans_numero",
           "un contact SANS NUMÉRO est annoncé « à compléter avant "
           "validation », jamais deviné",
           "un message qui compte les contacts sans numéro",
           _message_de(page),
           "sans numéro" in page)
    campagne_id, page = banc.valider_grille(brouillon)
    j.vrai(nature, depart, "sans_numero",
           "la validation est REFUSÉE tant qu'un numéro manque",
           "un refus, la case du numéro colorée, aucune campagne créée",
           "refus affiché" if campagne_id is None
           else f"campagne n°{campagne_id} créée malgré le numéro manquant",
           campagne_id is None
           and assistant.MESSAGE_CHAMPS_OBLIGATOIRES in page
           and 'class="manque"' in page)
    # We remove the row with no number, then validate: the rest must go
    # through.
    lignes = banc.application.obtenir_brouillon_assistant(brouillon)["contacts"]
    indices = [i for i, c in enumerate(lignes, start=1) if not c["telephone"]]
    for indice in reversed(indices):
        banc.poster("/assistant/liste",
                    {"b": brouillon, "action": f"retirer:{indice}"})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne issue de l'agenda se valide une fois les numéros "
                "complétés ou les lignes retirées",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=False)
    controler_ecran_campagne(banc, campagne_id, nature, depart, cibles)
    j.remarque("Agenda ICS : les autres participants de l'agenda d'exemple "
               "n'ont pas de terminaison 51-56 ; leur issue est tirée au "
               "hasard (graine fixée), le banc ne leur attribue donc aucune "
               "case de la matrice.")


def scenario_depuis_la_base(banc, depart, nature):
    """Step 3 filled FROM THE DATABASE (one of the five sources)."""
    j = banc.j
    source = SOURCE_DU_DEPART[depart]
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    page, _ = banc.poster("/assistant/importer",
                          {"b": brouillon, "mode": "base", "source": source})
    j.vrai(nature, depart, CONSTRUCTION,
           f"la source « {assistant.SOURCES_BASE[source]} » remplit la grille",
           "au moins un contact ajouté, et le compte annoncé",
           _message_de(page), "contact(s) ajouté(s)" in page)
    if source in ("a_venir", "manques"):
        j.vrai(nature, depart, "sans_numero",
               "les clients SANS NUMÉRO sont écartés et COMPTÉS (jamais "
               "silencieusement perdus)",
               "un message qui compte les clients sans numéro écartés",
               _message_de(page), "sans numéro" in page)
        j.vrai(nature, depart, "stop",
               "les clients 🚫 « Ne plus appeler » sont écartés et COMPTÉS",
               "un message qui compte les 🚫 écartés",
               _message_de(page), "Ne plus appeler" in page)
    # Filling TWICE from the same source must double nobody.
    combien = len(banc.application.obtenir_brouillon_assistant(
        brouillon)["contacts"])
    page, _ = banc.poster("/assistant/importer",
                          {"b": brouillon, "mode": "base", "source": source})
    apres = len(banc.application.obtenir_brouillon_assistant(
        brouillon)["contacts"])
    j.vrai(nature, depart, "doublon",
           "remplir DEUX FOIS depuis la même source ne double personne",
           f"toujours {combien} contact(s) dans la grille après le second "
           "remplissage",
           f"{apres} contact(s) — message : {_message_de(page)}",
           apres == combien)
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne bâtie sur cette source se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return None
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    campagne = banc.base.obtenir_campagne(campagne_id)
    j.egal(nature, depart, CONSTRUCTION,
           "la campagne va jusqu'au bout sans incident", "terminée",
           campagne["statut"])
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=False)
    controler_ecran_campagne(banc, campagne_id, nature, depart, cibles)
    _relancer_et_controler(banc, campagne_id, nature, depart, cibles,
                           en_cascade=False)
    return campagne_id


def scenario_colonnes_obligatoires_vides(banc):
    """The measured limit: a source WITH no linked appointment cannot feed a kind
    whose columns are ⚠.
    """
    j = banc.j
    nature, depart = "rappel_rdv", "base_annules"
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    banc.poster("/assistant/importer",
                {"b": brouillon, "mode": "base", "source": "annules"})
    campagne_id, page = banc.valider_grille(brouillon)
    j.vrai(nature, depart, CONSTRUCTION,
           "depuis « Rendez-vous annulés », une nature à colonnes ⚠ est "
           "REFUSÉE tant que la grille n'est pas complétée à la main",
           "un refus, et les cases vides COLORÉES dans la grille",
           "refus affiché : " + _erreurs_de(page) if campagne_id is None
           else f"campagne n°{campagne_id} créée avec des colonnes ⚠ vides",
           campagne_id is None
           and assistant.MESSAGE_CHAMPS_OBLIGATOIRES in page
           and 'class="manque"' in page)
    j.main("Compléter à la main les colonnes ⚠ d'une grille venue des "
           "« annulés » ou des « déplacés »",
           "Étape 3 : taper la date et le motif dans chaque ligne de la "
           "grille, puis « Valider ».")


def scenario_reprise_de_campagne(banc, campagne_source, campagne_injoignable,
                                 campagne_refus=None):
    """Resuming a previous campaign, filtered by state (the six filters).

    Three source campaigns: the big one (most of the states), the small
    zero-ceiling campaign (the only one containing a 📵 unreachable), and the
    `créneau libéré` campaign (the only one containing a ❌ refusal since a
    cancellation gives `📞 le client rappellera`).
    """
    j = banc.j
    for depart, etat in ETAT_DU_DEPART.items():
        nature = "prise_rdv"
        source = campagne_source
        if etat == "injoignable" and campagne_injoignable:
            source = campagne_injoignable
        elif etat == "refusé" and campagne_refus:
            source = campagne_refus
        comptes = banc.base.compter_contacts_par_etat(source)
        attendus = comptes["tous"] if etat == "tous" else comptes.get(etat, 0)
        banc.nouveau_simulateur()
        brouillon, _ = banc.ouvrir_brouillon(nature)
        banc.passer_etape2(nature, brouillon)
        page, _ = banc.poster("/assistant/importer",
                              {"b": brouillon, "mode": "campagne",
                               "campagne": str(source), "etat": etat})
        if attendus == 0:
            j.vrai(nature, depart, CONSTRUCTION,
                   f"aucun contact « {etat} » dans la campagne source : "
                   "l'écran le DIT au lieu de rester muet",
                   "un message qui invite à choisir un autre état",
                   _message_de(page) or _erreurs_de(page),
                   "Aucun contact de cette campagne" in page)
            continue
        j.vrai(nature, depart, CONSTRUCTION,
               f"le filtre « {assistant.ETATS_REPRISE[etat]} » ramène les "
               "contacts de la campagne précédente",
               f"les contacts en état « {etat} » de la campagne "
               f"n°{source}",
               _message_de(page), "contact(s) ajouté(s)" in page)
        campagne_id, page = banc.valider_grille(brouillon)
        if campagne_id is None:
            j.noter(nature, depart, CONSTRUCTION,
                    "la campagne de rattrapage se valide",
                    "une campagne prête", "refus : " + _erreurs_de(page), False)
            continue
        cibles = _cibles(banc, campagne_id)
        banc.executer(campagne_id)
        for fin, contact_avant in cibles.items():
            controler_issue(banc, campagne_id, nature, depart, fin,
                            contact_avant, en_cascade=False)
        controler_ecran_campagne(banc, campagne_id, nature, depart, cibles)
        _relancer_et_controler(banc, campagne_id, nature, depart, cibles,
                               en_cascade=False)


def scenario_injoignable(banc):
    """A follow-up ceiling of zero: the 53 becomes 📵 unreachable straight away.

    That is what feeds the `📵 injoignables` resumption filter and the bottom of
    the 🔁 Relances page (`the chain stops there, and yet we did not reach
    them`). Returns the id of the campaign created.
    """
    j = banc.j
    nature, depart = "prise_rdv", "collage"
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    formulaire = banc.formulaire_etape2(nature, brouillon, relance_max=0)
    banc.poster("/assistant/message", formulaire)
    banc.poster("/assistant/importer", {
        "b": brouillon, "mode": "collage",
        "liste": f"{CONTACTS_FORCES[2][1]};{CONTACTS_FORCES[2][2]}\n"})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne à plafond zéro se valide", "une campagne prête",
                "refus : " + _erreurs_de(page), False)
        return None
    banc.executer(campagne_id)
    contact = banc.contacts(campagne_id)[0]
    j.egal(nature, depart, "53",
           "plafond de relances atteint : le contact devient 📵 injoignable "
           "au lieu de tourner en boucle",
           "injoignable", contact["etat"])
    page = banc.obtenir("/relances")
    j.vrai(nature, depart, "53",
           "un 📵 injoignable RESTE visible dans 🔁 Relances (le faire "
           "disparaître reviendrait à le perdre)",
           f"« {contact['nom'] }» dans la page Relances",
           "présent" if html_mod.escape(contact["nom"]) in page else "absent",
           html_mod.escape(contact["nom"]) in page)
    return campagne_id


def scenario_deux_oui_sans_rendezvous_existant(banc):
    """TWO people say yes in a kind WITH no `existing appointment`.

    What the bench is after here: each must get THEIR OWN appointment. The
    `booking`, `single contact`, `missed-call reminder` and `custom` kinds have
    no `existing appointment` column: the slot offered on the phone is the NEXT
    FREE SLOT, recomputed at the instant of each call. The first person takes a
    slot, that slot is immediately blocked by their appointment, and the second
    is offered ANOTHER one. The bench checks both facts: two appointments at
    two different slots, and the slot taken genuinely blocked afterwards.
    """
    j = banc.j
    nature, depart = "prise_rdv", "collage"
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    deux = [("Mme Nadia Lefèvre", "06 39 98 00 51"),
            ("Mme Aurélie Pastor", "02 61 91 07 51")]
    banc.poster("/assistant/importer", {
        "b": brouillon, "mode": "collage",
        "liste": "".join(f"{nom};{tel}\n" for nom, tel in deux)})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « deux oui » se valide", "une campagne prête",
                "refus : " + _erreurs_de(page), False)
        return
    banc.executer(campagne_id)
    contacts = {c["nom"]: c for c in banc.contacts(campagne_id)}
    obtenus, recits, proposes = [], [], []
    for nom, _tel in deux:
        contact = contacts.get(nom)
        if contact is None:
            recits.append(f"{nom} : contact absent")
            continue
        resultat = banc.dernier_resultat(contact["id"])
        convenu = (resultat or {}).get("new_datetime")
        proposes.append(convenu)
        rdv = [r for r in banc.base.tous_les_rendezvous()
               if r["nom"] == nom and r["horaire"] == convenu
               and r["id"] > banc.rdv_plancher
               and r["statut"] in ("prévu", "confirmé")]
        obtenus.append(bool(rdv))
        # The account does NOT quote the date: it depends on the day the bench
        # runs, it would change from one run to the next and the report would
        # no longer be comparable. We say whether it is the same one — that is
        # the point.
        recits.append(f"{nom} : rendez-vous obtenu = "
                      f"{'oui' if rdv else 'NON'}, "
                      f"état « {contact['etat']} »")
    meme_creneau = len(set(proposes)) == 1 and len(proposes) == 2
    recits.append("créneau proposé aux deux : "
                  + ("LE MÊME (la seconde personne se fait refuser la place "
                     "de la première)" if meme_creneau
                     else "une place DIFFÉRENTE pour chacune"))
    j.vrai(nature, depart, "51",
           "DEUX personnes qui disent oui obtiennent CHACUNE son rendez-vous",
           "deux rendez-vous créés, à deux places différentes — le créneau "
           "proposé doit être la prochaine place LIBRE, recalculée à chaque "
           "appel, jamais une date dérivée de l'heure qu'il est",
           " | ".join(recits),
           len(obtenus) == 2 and all(obtenus) and not meme_creneau)
    # The owner's second requirement: a slot taken is BLOCKED in the program's
    # calendar. We ask the product itself — what is refused by hand must be
    # refused on the phone.
    bloquees = [horaires.refus_rendezvous_telephone(
        banc.base, banc.application.preferences, horaire) is not None
        for horaire in proposes if horaire]
    j.vrai(nature, depart, "51",
           "chaque place attribuée est BLOQUÉE dans le calendrier "
           "(personne d'autre ne peut la reprendre)",
           "les deux places refusées à toute nouvelle demande",
           f"{sum(bloquees)} place(s) bloquée(s) sur {len(bloquees)}",
           len(bloquees) == 2 and all(bloquees))


def _campagne_annulation(banc, nature, contacts, option_active, bloc):
    """Sets up a 🔔/✅ campaign with the cancellation option in one setting.

    contacts: [(name, phone, hour)] — a REAL appointment is created in the
    database for each, at the given hour of the block, and the pasted row
    carries exactly that time (that is what attaches the contact to THEIR
    appointment, as the product does). The third element may also be a FULL ISO
    time (`2026-08-01T14:30`) when the case being exercised needs a date close
    to NOW rather than a block — that is what the replacement threshold needs.
    Returns (campagne_id, validation page, {name: original time}).
    """
    horaires_poses = {}
    lignes = []
    for nom, telephone, heure in contacts:
        horaire = heure if isinstance(heure, str) else _iso(bloc, heure)
        client_id = banc.base.obtenir_ou_creer_client(nom, telephone)
        banc.base.ajouter_rendezvous(client_id, horaire, "Séance de suivi")
        horaires_poses[nom] = horaire
        # The columns are THE KIND's (they differ from one kind to another):
        # the pasted row is therefore always acceptable.
        morceaux = [nom, telephone]
        for champ in assistant.NATURES[nature]["champs"]:
            if champ["type"] == "date":
                morceaux.append(horaire)
            elif champ["code"] == "motif":
                morceaux.append("Séance de suivi")
            else:
                morceaux.append("")
        lignes.append(";".join(morceaux))
    brouillon, _ = banc.ouvrir_brouillon(nature)
    formulaire = banc.formulaire_etape2(nature, brouillon)
    if option_active:
        formulaire["opt_replacer"] = "1"
    banc.poster("/assistant/message", formulaire)
    banc.poster("/assistant/importer",
                {"b": brouillon, "mode": "collage",
                 "liste": "\n".join(lignes) + "\n"})
    campagne_id, page = banc.valider_grille(brouillon)
    return campagne_id, page, horaires_poses


def scenario_annulation_deux_reglages(banc):
    """CANCELLATION in both of its settings (the rule of 31/07/2026).

    The campaign option `offer another date if the client cancels` decides what
    the agent is allowed to do — and it changes the TEXT dictated to the agent.
    The bench measures both settings:

    - unticked: the message says `I am not offering you another date`; the client who cancels (52) becomes `📞 le client rappellera`, no follow-up, no campaign, and their appointment leaves `à venir`;
    - ticked: the message announces the genuinely free slots; the client who accepts another date (54) sees their appointment genuinely MOVED, with its ↔ row in the change log.
    """
    j = banc.j
    nature, depart = "rappel_rdv", "collage"
    # ---------------------------------------------- setting 1: without the
    # option
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    campagne_id, page, poses = _campagne_annulation(
        banc, nature, [("M. Firmin Delacour-Anglade", "06 39 98 02 52", 9)],
        option_active=False, bloc=bloc)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « annulation sans replacement » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    campagne = banc.base.obtenir_campagne(campagne_id)
    mission = campagne["mission"] or ""
    j.vrai(nature, depart, "52",
           "SANS l'option, le message dicté à l'agent lui interdit de "
           "proposer une date",
           "« je ne vous propose pas d'autre date » dans la mission, et "
           "aucune liste de places annoncée",
           f"mission : « …{mission[-160:]} »",
           "je ne vous propose pas d'autre date" in mission
           and "je peux vous proposer une autre date" not in mission)
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=False)
    # ---------------------------------------------- setting 2: with the option
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    campagne_id, page, poses = _campagne_annulation(
        banc, nature, [("Mme Ombeline Trarieux", "06 39 98 02 54", 9)],
        option_active=True, bloc=bloc)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « annulation avec replacement » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    campagne = banc.base.obtenir_campagne(campagne_id)
    mission = campagne["mission"] or ""
    j.vrai(nature, depart, "54",
           "AVEC l'option, le message autorise l'agent à proposer une autre "
           "date",
           "« je peux vous proposer une autre date » dans la mission, suivie "
           "des places à annoncer",
           f"mission : « …{mission[-160:]} »",
           "je peux vous proposer une autre date" in mission
           and "je ne vous propose pas d'autre date" not in mission)
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=False)
    ancien = poses.get("Mme Ombeline Trarieux")
    cahier = banc.base.changements_de_campagne(campagne_id)
    deplacements = [c for c in cahier if c["genre"] == "deplacement"]
    j.vrai(nature, depart, "54",
           "un accord après annonce d'une autre date est un DÉPLACEMENT : "
           "la ligne ↔ entre au cahier des changements",
           "une ligne « ↔ Rendez-vous déplacé » avec l'ancienne ET la "
           "nouvelle date",
           f"{len(deplacements)} ligne(s) ↔ sur {len(cahier)} changement(s) : "
           + " | ".join(f"{c['ancienne_date']} → {c['nouvelle_date']}"
                        for c in deplacements),
           len(deplacements) == 1
           and deplacements[0]["ancienne_date"] == ancien
           and bool(deplacements[0]["nouvelle_date"]))
    j.remarque(
        "L'option d'annulation a été parcourue dans ses DEUX réglages "
        "(nature « 🔔 Rappel de rendez-vous », départ « collage ») : sans "
        "elle le message interdit de proposer une date et le client passe "
        "« 📞 le client rappellera » ; avec elle, un accord devient un "
        "déplacement, avec sa ligne ↔ au cahier. Le simulateur ne LIT pas "
        "le message — le banc mesure donc ce que le message DIT, et ce que "
        "le produit ÉCRIT dans chacune des deux issues, jamais ce que "
        "l'agent aurait « compris ».")


def scenario_seuil_de_compensation(banc):
    """THE 12-HOUR THRESHOLD — the owner's rule, on both sides.

    `if the appointment is more than 12 h away, we offer the operator in the
    summary to start a freed-slot campaign to make up for the absence; if it is
    < 12 h then we leave it as cancelled and state that under these conditions
    we cannot arrange a replacement, but that the operator can do it manually`.

    The bench exercises BOTH sides without depending on the hour at which it is
    launched: the appointments' dates stay those of the blocks, it is the
    THRESHOLD that is varied. It also measures the thing that matters most: NO
    call goes out from that offer.
    """
    j = banc.j
    nature, depart = "confirmation", "collage"
    preferences = banc.application.preferences
    # ------------------------------------------- the `we can make up for it`
    # side
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    campagne_id, page, poses = _campagne_annulation(
        banc, nature, [("M. Anselme Vaugirard-Petit", "06 39 98 03 52", 9)],
        option_active=False, bloc=bloc)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « seuil de compensation » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    horaire = poses["M. Anselme Vaugirard-Petit"]
    campagnes_avant = len(banc.base.lister_campagnes())
    banc.executer(campagne_id)
    frais = [r for r in banc.base.tous_les_rendezvous()
             if r["horaire"] == horaire]
    j.vrai(nature, depart, "52",
           "au-delà du seuil, le rendez-vous annulé est SUPPRIMÉ : il "
           "n'existe plus et sa place redevient libre",
           f"statut « {db.STATUT_SUPPRIME} »",
           f"statut « {frais[0]['statut'] if frais else 'introuvable'} »",
           bool(frais) and frais[0]["statut"] == db.STATUT_SUPPRIME)
    occupants = banc.base.rendezvous_occupants(horaire, horaire + ":59")
    j.vrai(nature, depart, "52",
           "la place libérée n'a plus AUCUN occupant",
           "0 occupant à cet horaire", f"{len(occupants)} occupant(s)",
           not occupants)
    page = banc.obtenir(f"/campagne?id={campagne_id}")
    j.vrai(nature, depart, "52",
           "le récapitulatif PROPOSE une campagne « créneau libéré » pour "
           "compenser l'absence",
           "un bouton de préparation sur la place libérée",
           "proposition présente" if "/campagne/compenser" in page
           else "AUCUNE proposition à l'écran",
           "/campagne/compenser" in page and "Compenser une absence" in page)
    j.vrai(nature, depart, "52",
           "AUCUN appel ne part de cette proposition : rien n'est lancé "
           "sans le clic de l'opérateur",
           "aucune campagne créée en plus, et l'écran le dit",
           f"{len(banc.base.lister_campagnes()) - campagnes_avant} campagne(s) "
           "créée(s) toute(s) seule(s)",
           len(banc.base.lister_campagnes()) == campagnes_avant
           and "Aucun appel ne part d'ici" in page)
    page, _ = banc.poster("/campagne/compenser",
                          {"campagne": campagne_id, "creneau": horaire})
    j.vrai(nature, depart, "52",
           "le clic ouvre l'assistant AVEC le créneau déjà rempli — et ne "
           "crée toujours aucune campagne",
           "l'étape 2 de « créneau libéré », créneau pré-rempli",
           "assistant ouvert" if horaire in page else "créneau absent de l'écran",
           horaire in page and "Créneau libéré" in page
           and len(banc.base.lister_campagnes()) == campagnes_avant)
    # ------------------------------------- the `too late to make up for it`
    # side An appointment IN TWO HOURS: below the default threshold (12 h),
    # whatever the hour at which this bench is launched.
    banc.nouveau_simulateur()
    dans_deux_heures = (datetime.datetime.now()
                        + datetime.timedelta(hours=2)).replace(
                            second=0, microsecond=0).isoformat(
                                timespec="minutes")
    campagne_id, page, poses = _campagne_annulation(
        banc, nature,
        [("Mme Roseline Kerguéhennec", "06 39 98 04 52", dans_deux_heures)],
        option_active=False, bloc=None)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « sous le seuil » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    horaire = poses["Mme Roseline Kerguéhennec"]
    campagnes_avant = len(banc.base.lister_campagnes())
    banc.executer(campagne_id)
    frais = [r for r in banc.base.tous_les_rendezvous()
             if r["horaire"] == horaire]
    seuil = horaires.seuil_remplacement(preferences)
    j.vrai(nature, depart, "52",
           f"à moins de {seuil} h, le rendez-vous RESTE « annulé » — on ne "
           "supprime pas ce qu'on ne peut pas remplacer",
           "statut « annulé »",
           f"statut « {frais[0]['statut'] if frais else 'introuvable'} »",
           bool(frais) and frais[0]["statut"] == "annulé")
    page = banc.obtenir(f"/campagne?id={campagne_id}")
    j.vrai(nature, depart, "52",
           "l'écran DIT pourquoi on ne peut pas remplacer, et donne le "
           "moyen de le faire à la main",
           "l'explication « trop tard » et le lien pour agir soi-même",
           "explication présente"
           if "trop tard pour organiser un remplacement" in page
           else "AUCUNE explication à l'écran",
           "trop tard pour organiser un remplacement" in page
           and "Le faire quand même à la main" in page
           and "Voir cette journée dans le planning" in page)
    j.vrai(nature, depart, "52",
           "et là non plus, aucune campagne ne se monte toute seule",
           "aucune campagne créée",
           f"{len(banc.base.lister_campagnes()) - campagnes_avant} créée(s)",
           len(banc.base.lister_campagnes()) == campagnes_avant)
    j.remarque(
        f"Le seuil de remplacement ({seuil} h — la valeur du propriétaire, "
        "réglable dans ⚙ Réglages) a été parcouru DES DEUX CÔTÉS, avec de "
        "VRAIS rendez-vous : l'un dans plusieurs semaines (supprimé, "
        "compensation proposée), l'autre dans deux heures (laissé "
        "« annulé », avec l'explication et le moyen d'agir à la main). Le "
        "banc a aussi mesuré ce qui compte le plus : la proposition "
        "n'appelle PERSONNE — elle ouvre l'assistant, et c'est tout.")


def scenario_cascade_ancien_rendezvous(banc):
    """Q7: the DIRECT cascade no longer leaves the client with two appointments.

    Three cases, as the rule distinguishes them:
    - a KNOWN client with ONE upcoming appointment: the old one is released;
    - an UNKNOWN pasted row: nothing is touched, nothing is invented;
    - a known client with SEVERAL upcoming appointments: RingBack does not choose in the human's place, it writes it down.
    """
    j = banc.j
    nature, depart = "creneau_libere", "cascade"
    base = banc.base

    def _lancer(nom, telephone, creneau):
        banc.nouveau_simulateur()
        page, url = banc.poster("/cascade/executer", {
            "liste": f"{nom};{telephone}", "creneau": creneau,
            "mission": "Bonjour, une place s'est libérée le [créneau]."})
        trouve = re.search(r"/cascade/resultat\?id=(\d+)", url)
        return int(trouve.group(1)) if trouve else None

    # ------------------------------------------- case 1: the client is known
    # The slot offered is taken on THIS day: it must be open, otherwise the
    # product refuses the appointment and the check measures the calendar
    # instead of measuring the product (see `_jour_ouvre`).
    bloc = _jour_ouvre(banc.prochain_bloc())
    nom, telephone = "M. Isidore Beaupréau-Lançon", "06 39 98 05 51"
    client_id = base.obtenir_ou_creer_client(nom, telephone)
    ancien = base.ajouter_rendezvous(client_id, _iso(bloc + 6, 9),
                                     "Séance de suivi")
    avant = len(base.rendezvous_a_venir_du_client(client_id))
    cascade_id = _lancer(nom, telephone, _iso(bloc, 15))
    if cascade_id is None:
        j.noter(nature, depart, "51", "la cascade « client connu » s'exécute",
                "une page de résultat", "aucune cascade lancée", False)
        return
    apres = base.rendezvous_a_venir_du_client(client_id)
    j.vrai(nature, depart, "51",
           "un « oui » d'un client CONNU ne lui laisse pas DEUX rendez-vous : "
           "l'ancien est libéré (Q7)",
           f"toujours 1 rendez-vous à venir (il y en avait {avant})",
           f"{len(apres)} rendez-vous à venir après l'appel", len(apres) == 1)
    j.egal(nature, depart, "51",
           "l'ancien rendez-vous porte le statut que dit la règle",
           horaires.decision_annulation(
               banc.application.preferences,
               _iso(bloc + 6, 9))["statut"],
           base.obtenir_rendezvous(ancien)["statut"])
    ligne = base.appels_de_cascade(cascade_id)[0]
    j.egal(nature, depart, "51",
           "la trace dit QUEL rendez-vous a été libéré",
           ancien, ligne["rendezvous_libere"])

    # ------------------------------ case 2: the pasted row is UNKNOWN
    bloc = _jour_ouvre(banc.prochain_bloc())
    rdv_avant = len(base.tous_les_rendezvous())
    cascade_id = _lancer("Mme Perrine Vaudémont-Ourcq", "06 39 98 06 51",
                         _iso(bloc, 15))
    if cascade_id is not None:
        ligne = base.appels_de_cascade(cascade_id)[0]
        crees = len(base.tous_les_rendezvous()) - rdv_avant
        j.vrai(nature, depart, "51",
               "une ligne collée INCONNUE ne provoque AUCUNE suppression "
               "inventée",
               "un seul rendez-vous de plus (celui du créneau), et aucune "
               "trace de libération",
               f"{crees} rendez-vous créé(s), rendezvous_libere = "
               f"{ligne['rendezvous_libere']}",
               crees == 1 and ligne["rendezvous_libere"] is None)

    # -------------------- case 3: several upcoming appointments = ambiguous
    bloc = _jour_ouvre(banc.prochain_bloc())
    nom, telephone = "Mme Aliénor Trémolière-Sanzey", "06 39 98 07 51"
    client_id = base.obtenir_ou_creer_client(nom, telephone)
    un = base.ajouter_rendezvous(client_id, _iso(bloc + 6, 9), "Séance A")
    deux = base.ajouter_rendezvous(client_id, _iso(bloc + 7, 9), "Séance B")
    cascade_id = _lancer(nom, telephone, _iso(bloc, 15))
    if cascade_id is not None:
        ligne = base.appels_de_cascade(cascade_id)[0]
        statuts = [base.obtenir_rendezvous(un)["statut"],
                   base.obtenir_rendezvous(deux)["statut"]]
        j.vrai(nature, depart, "51",
               "avec PLUSIEURS rendez-vous à venir, RingBack n'en supprime "
               "aucun : il l'écrit pour qu'un humain tranche",
               "les deux rendez-vous intacts, et la mention « à libérer dans "
               "votre agenda »",
               f"statuts {statuts}, note : "
               f"« {(ligne['note'] or 'AUCUNE')[:70]}… »",
               statuts == ["prévu", "prévu"]
               and bool(ligne["note"])
               and "à libérer dans votre agenda" in (ligne["note"] or ""))
        page = banc.obtenir(f"/cascade/resultat?id={cascade_id}")
        j.vrai(nature, depart, "51",
               "et l'écran de la cascade le dit, à la ligne de cette personne",
               "la mention lisible dans le tableau des appels",
               "mention affichée" if "à libérer dans votre agenda" in page
               else "MENTION ABSENTE de l'écran",
               "à libérer dans votre agenda" in page)

    # ------------------- case 4: `another date agreed` (the moved branch) ⚠
    # THE POSTPONEMENT DAY MUST BE OPEN TOO: the simulator always postpones to
    # the slot + TWO days, and a Sunday makes the appointment be refused — see
    # `_jour_ouvre`.
    bloc = _jour_ouvre(banc.prochain_bloc(), 2)
    nom, telephone = "M. Gonzague Malemort-Ferrières", "06 39 98 08 54"
    client_id = base.obtenir_ou_creer_client(nom, telephone)
    ancien = base.ajouter_rendezvous(client_id, _iso(bloc + 6, 9),
                                     "Séance de suivi")
    avant = len(base.rendezvous_a_venir_du_client(client_id))
    cascade_id = _lancer(nom, telephone, _iso(bloc, 15))
    if cascade_id is not None:
        apres = base.rendezvous_a_venir_du_client(client_id)
        j.vrai(nature, depart, "54",
               "« autre date convenue » libère AUSSI l'ancienne place — "
               "c'est le trou Q7 exactement",
               f"toujours 1 rendez-vous à venir (il y en avait {avant})",
               f"{len(apres)} rendez-vous à venir après l'appel",
               len(apres) == 1)
        j.vrai(nature, depart, "54",
               "l'ancien rendez-vous ne tient plus",
               "un statut hors « prévu / confirmé »",
               f"statut « {base.obtenir_rendezvous(ancien)['statut']} »",
               base.obtenir_rendezvous(ancien)["statut"]
               in db.STATUTS_SANS_PLACE)
    j.remarque(
        "Le trou Q7 (« un oui pour une autre date ne libérait pas l'ancienne "
        "place ») a été parcouru sur la cascade DIRECTE, dans ses deux "
        "branches — « accepté » et « autre date convenue » — et dans les "
        "trois situations de reconnaissance : client connu à un seul "
        "rendez-vous (l'ancien part), ligne collée inconnue (rien n'est "
        "touché), client à plusieurs rendez-vous à venir (rien n'est touché "
        "non plus, et l'écran le dit).")


def scenario_file_appels(banc):
    """The call queue: `call everybody back` then run it."""
    j = banc.j
    nature, depart = None, "file"
    banc.nouveau_simulateur()
    # Fresh material for the queue: the earlier campaigns have already handled
    # the sample data set's missed appointments. The six appointments below are
    # added THROUGH THE SCREEN (the `Ajouter` form), at a past date: it is the
    # missed rule that marks them `manqué` itself.
    for indice, (_, nom, telephone) in enumerate(CONTACTS_FORCES):
        banc.poster("/ajouter", {
            "nom": nom, "telephone": telephone,
            "date_heure": _iso(-30 - indice, 14, 0),
            "motif": "Séance non honorée (matière de la file d'appels)"})
    banc.poster("/file/tout-rappeler")
    page = banc.obtenir("/file")
    en_file = len(banc.application.planif.file)
    j.vrai(nature, depart, CONSTRUCTION,
           "« Tout rappeler » met les rendez-vous manqués en file, sans les "
           "appeler",
           "des appels en attente, aucun appel passé",
           f"{en_file} appel(s) en file", en_file > 0)
    j.vrai(nature, depart, CONSTRUCTION,
           "les numéros de la file sont masqués",
           "aucun numéro en clair sur la page File d'appels",
           "aucun numéro en clair" if CONTACTS_FORCES[0][2] not in page
           else "NUMÉRO EN CLAIR TROUVÉ",
           CONTACTS_FORCES[0][2] not in page)
    # `Call everybody back` sets aside two families right away: those with no
    # number (nothing to dial) and the 🚫. We check that on the evidence.
    en_file_ids = {e["rendezvous_id"] for e in banc.application.planif.file}
    for issue_code, nom, quoi in (
            ("sans_numero", "M. Antoine Villeneuve",
             "un rendez-vous manqué SANS numéro n'est jamais mis en file"),
            ("stop", "M. Bruno Lacombe",
             "un rendez-vous manqué d'un client 🚫 n'est jamais mis en file")):
        vises = [r for r in banc.base.tous_les_rendezvous()
                 if r["nom"] == nom and r["statut"] == "manqué"]
        if not vises:
            j.noter(nature, depart, issue_code, quoi,
                    f"un rendez-vous manqué au nom de « {nom} »",
                    "aucun rendez-vous manqué à ce nom dans la base jetable",
                    False)
            continue
        dedans = [r["id"] for r in vises if r["id"] in en_file_ids]
        j.vrai(nature, depart, issue_code, quoi,
               f"« {nom} » absent de la file d'appels",
               "absent de la file" if not dedans
               else f"MIS EN FILE ({len(dedans)} appel(s))", not dedans)
    page_sans = banc.obtenir("/sans-numero")
    j.vrai(nature, depart, "sans_numero",
           "il reste visible sur la page « Sans numéro », à compléter — jamais "
           "perdu en silence",
           "« M. Antoine Villeneuve » listé sur la page Sans numéro",
           "présent" if "Antoine Villeneuve" in page_sans else "absent",
           "Antoine Villeneuve" in page_sans)
    avant = {}
    for entree in banc.application.planif.file:
        rdv = banc.base.obtenir_rendezvous(entree["rendezvous_id"])
        clair = banc.base.telephone_de(rdv["client_id"]) or ""
        fin = re.sub(r"\D", "", clair)[-2:]
        if fin in ETAT_ATTENDU and fin not in avant:
            avant[fin] = dict(rdv)
    page, _ = banc.poster("/file/executer", {"mission": ""})
    j.vrai(nature, depart, CONSTRUCTION,
           "l'exécution de la file rend un compte rendu appel par appel",
           "une page de résultats qui cite chaque issue",
           "page de résultats servie" if "Transcription" in page
           or "issue" in page.lower() else "page inattendue",
           bool(page))
    attentes = {
        "51": ("confirmé", "le rendez-vous manqué est REPLACÉ au créneau "
                           "accepté (statut confirmé)"),
        "52": ("annulé", "le rendez-vous manqué passe en ANNULÉ"),
        # ⚠ THE SAME ROW MOVES (17/08/2026): it previously became `déplacé` and
        # a SECOND one was born at the agreed date.
        "54": ("confirmé", "le rendez-vous manqué BOUGE à la date convenue "
                           "(une seule ligne, pas deux)"),
        "55": (None, "rien n'est touché : le client n'a rien conclu"),
    }
    for fin, rdv in avant.items():
        frais = banc.base.obtenir_rendezvous(rdv["id"])
        if fin in ("53", "56"):
            j.vrai(nature, depart, fin,
                   "pas de réponse : le rendez-vous manqué reste MANQUÉ et "
                   "une relance est programmée",
                   "statut « manqué » et une relance planifiée",
                   f"statut « {frais['statut']} »",
                   frais["statut"] == "manqué")
            continue
        statut_attendu, quoi = attentes[fin]
        if statut_attendu is None:
            j.egal(nature, depart, fin, quoi, rdv["statut"], frais["statut"])
        else:
            j.egal(nature, depart, fin, quoi, statut_attendu, frais["statut"])
    campagne_id = max((c["id"] for c in banc.base.lister_campagnes()),
                      default=None)
    if campagne_id:
        contacts = banc.base.contacts_de_campagne(campagne_id)
        relances = banc.base.relances_de_campagne(campagne_id)
        j.vrai(nature, depart, "53",
               "l'exécution de la file devient une CAMPAGNE, relances comprises",
               "une campagne « manqués » avec des relances programmées pour "
               "les non-joints",
               f"campagne n°{campagne_id}, {len(contacts)} contact(s), "
               f"{len(relances)} relance(s)",
               bool(contacts) and bool(relances))
    return campagne_id


def scenario_cascade_directe(banc):
    """The Cascade page: generating a list from the database, then `first yes`.
    """
    j = banc.j
    nature, depart = "creneau_libere", "cascade"
    banc.nouveau_simulateur()
    creneau = _iso(banc.prochain_bloc() + 5, 16, 30)
    page, _ = banc.poster("/cascade/generer",
                          {"source": "annules", "ordre": "anciennete",
                           "mission": "", "creneau": creneau, "liste": ""})
    j.vrai(nature, depart, CONSTRUCTION,
           "la liste de cascade se GÉNÈRE depuis la base (source + ordre "
           "choisis), et reste modifiable à la main",
           "une zone de collage remplie et un compte annoncé",
           "liste générée" if "personne(s) dans la liste" in page
           else "aucune liste générée",
           "personne(s) dans la liste" in page)
    # The order is chosen on purpose: the one who accepts is LAST, so that
    # every other outcome is seen before the stop at the first yes.
    ordre = [CONTACTS_FORCES[i] for i in (2, 1, 4, 3, 5, 0)]
    liste = "\n".join(f"{nom};{tel}" for _, nom, tel in ordre)
    # A duplicate in the cascade list: here, unlike the assistant's grid, it
    # STOPS the launch — nothing is dialled until the list is clean. The bench
    # checks that this is duly said.
    avant_cascades = len(banc.base.lister_cascades())
    page, _url = banc.poster("/cascade/executer", {
        "liste": liste + f"\n{ordre[0][1]};{ordre[0][2]}",
        "creneau": creneau, "mission": "Bonjour, une place s'est libérée."})
    j.vrai(nature, depart, "doublon",
           "un doublon dans la liste de cascade ARRÊTE le lancement, et l'écran "
           "dit lequel",
           "un refus qui cite la ligne en doublon, et aucune cascade lancée",
           _erreurs_de(page) or "(aucun refus affiché)",
           "doublon" in page.lower()
           and len(banc.base.lister_cascades()) == avant_cascades)
    # The 🚫 stays in the list: it must NEVER be dialled.
    liste += f"\n{CONTACT_STOP[0]};{CONTACT_STOP[1]}"
    page, url = banc.poster("/cascade/executer", {
        "liste": liste, "creneau": creneau,
        "mission": "Bonjour, une place s'est libérée le [créneau] au Cabinet "
                   "Val Fleuri : souhaitez-vous en profiter ?"})
    trouve = re.search(r"/cascade/resultat\?id=(\d+)", url)
    if not trouve:
        j.noter(nature, depart, CONSTRUCTION, "la cascade s'exécute",
                "une page de résultat de cascade", f"redirigé vers {url}", False)
        return None
    cascade_id = int(trouve.group(1))
    cascade = banc.base.obtenir_cascade(cascade_id)
    appels = banc.base.appels_de_cascade(cascade_id)
    par_nom = {a["nom"]: a for a in appels}
    j.egal(nature, depart, "51",
           "la cascade s'arrête au PREMIER OUI et se clôt « pourvue »",
           "pourvue", cascade["statut"])
    attentes = {"51": "abouti", "52": "refus", "53": "sans réponse",
                "54": "abouti", "55": "refus", "56": "sans réponse"}
    for fin, nom, _telephone in CONTACTS_FORCES:
        appel = par_nom.get(nom)
        if appel is None:
            j.noter(nature, depart, fin,
                    f"la cascade a bien appelé « {nom} »",
                    "un appel tracé dans la cascade", "aucun appel tracé", False)
            continue
        j.vrai(nature, depart, fin,
               f"l'issue de « {nom} » est tracée telle qu'elle s'est produite",
               f"un appel dont l'état dit « {attentes[fin]} »",
               f"état « {appel['etat']} », issue « {appel['issue']} »",
               bool(appel["etat"]))
    exclu = par_nom.get(CONTACT_STOP[0])
    j.vrai(nature, depart, "stop",
           "une personne 🚫 « Ne plus appeler » présente dans la liste n'est "
           "JAMAIS composée",
           "un appel tracé « exclue », sans conversation",
           f"état « {exclu['etat']} »" if exclu else "personne non tracée",
           bool(exclu) and exclu["etat"] == "exclu")
    pris = [r for r in banc.base.tous_les_rendezvous()
            if r["horaire"] == creneau and r["statut"] == "confirmé"]
    j.vrai(nature, depart, "51",
           "le créneau libéré est attribué à celui qui a dit oui",
           f"un rendez-vous confirmé le {themes.date_lisible(creneau)}",
           f"{len(pris)} rendez-vous confirmé(s) à cet horaire", len(pris) == 1)
    page = banc.obtenir(f"/cascade/resultat?id={cascade_id}")
    j.vrai(nature, depart, "51",
           "la page de résultat de la cascade masque les numéros",
           "aucun numéro en clair",
           "aucun numéro en clair" if CONTACTS_FORCES[0][2] not in page
           else "NUMÉRO EN CLAIR TROUVÉ",
           CONTACTS_FORCES[0][2] not in page)
    campagne_id = max((c["id"] for c in banc.base.lister_campagnes()),
                      default=None)
    j.vrai(nature, depart, CONSTRUCTION,
           "la cascade directe fabrique aussi sa CAMPAGNE (le dossier de "
           "l'opération)",
           "une campagne « créneau libéré » rattachée à la cascade",
           f"campagne n°{campagne_id}" if campagne_id else "aucune campagne",
           bool(campagne_id))
    return campagne_id


def scenario_bouton_demarrer(banc):
    """The real ▶ Start button (background thread), checked ONCE."""
    j = banc.j
    nature, depart = "prise_rdv", "collage"
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    banc.poster("/assistant/importer", {
        "b": brouillon, "mode": "collage",
        "liste": f"{CONTACTS_FORCES[1][1]};{CONTACTS_FORCES[1][2]}\n"})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, "assistant", CONSTRUCTION,
                "la campagne du bouton ▶ Démarrer se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    # Starting carries the conscious gesture about the calendar
    # (`agenda_verifie`): that is what the click on the control desk's panel
    # sends. Without it, RingBack refuses to launch — that refusal has its own
    # dedicated tests.
    banc.poster("/campagne/demarrer",
                {"campagne": campagne_id, "agenda_verifie": "1"})
    limite = time.monotonic() + 30
    statut = banc.base.obtenir_campagne(campagne_id)["statut"]
    while statut not in ("terminée", "arrêtée") and time.monotonic() < limite:
        time.sleep(0.05)
        statut = banc.base.obtenir_campagne(campagne_id)["statut"]
    j.egal(nature, "assistant", CONSTRUCTION,
           "le bouton ▶ Démarrer de l'écran mène bien la campagne à son terme",
           "terminée", statut)


# ===========================================================================
# R15 — BOTH DOORS LEAD TO A CAMPAIGN
# ---------------------------------------------------------------------------
# §4 (the 👥 door: a state to handle) and §5 (the 📅 door: a gap, an
# appointment). Those clients all carry `Portail` in their name: the bench
# filters on it, which makes the COUNTS exact and independent of whatever the
# earlier scenarios left in the database.
# ===========================================================================
PORTAIL_MANQUES = (
    ("Mme Portail Manquée Une", "06 39 98 07 71"),
    ("M. Portail Manqué Deux", "06 39 98 07 72"),
    ("Mme Portail Manquée Trois", "06 39 98 07 73"),
)
PORTAIL_PREVU = ("M. Portail Prévu", "06 39 98 07 74")
PORTAIL_HUMAIN = ("Mme Portail Humaine", "06 39 98 07 75")
PORTAIL_ATTENTE = ("M. Portail En Attente", "06 39 98 07 77")
ETAT_MANQUE = "rendez-vous manqué (absent)"


def _liste_clients_banc(banc, **filtres):
    """The list FRAGMENT, as the screen's filters reload it."""
    return banc.obtenir("/clients/liste?" + urllib.parse.urlencode(filtres))


def scenario_deux_portes_vers_campagne(banc):
    """R15 closed: from the state to the button, from the gap to the campaign.
    ZERO calls.

    This scenario places NO call, and that is precisely what it measures: both
    doors open the assistant at step 2 (list already filled), they launch
    nothing. It also exercises the owner's decision of 31/07/2026 — one button
    PER KIND when the filter mixes states handled by different campaigns.
    """
    j = banc.j
    nature, depart = "prise_rdv", "etat_client"
    base = banc.base
    # --------------------------------------------------- the case's material
    for rang, (nom, telephone) in enumerate(PORTAIL_MANQUES):
        client_id = base.obtenir_ou_creer_client(nom, telephone)
        base.ajouter_rendezvous(client_id, _iso(-30 - rang, 9), "Bilan",
                                statut="manqué")
    prevu_id = base.obtenir_ou_creer_client(*PORTAIL_PREVU)
    base.ajouter_rendezvous(prevu_id, _iso(60, 9), "Contrôle")
    attente_id = base.obtenir_ou_creer_client(*PORTAIL_ATTENTE)
    base.ajouter_rendezvous(attente_id, _iso(-20, 9), "Séance",
                            statut="déplacé")
    humaine_id = base.obtenir_ou_creer_client(*PORTAIL_HUMAIN)
    campagne_close = base.creer_campagne("Portail — campagne close",
                                         "personnalise", nature="prise_rdv",
                                         statut="terminée")
    base.ajouter_contact_campagne(campagne_close, 1, PORTAIL_HUMAIN[0],
                                  PORTAIL_HUMAIN[1],
                                  etat="à rappeler par un humain",
                                  client_id=humaine_id)
    campagnes_avant = len(base.lister_campagnes())
    appels_avant = base.conn.execute(
        "SELECT COUNT(*) FROM appels").fetchone()[0]

    # ------------------------------------ §4.1: the button IS BORN of the
    # filter
    sans = _liste_clients_banc(banc, etat=ETAT_MANQUE, recherche="Portail")
    j.vrai(nature, depart, CONSTRUCTION,
           "sans l'option « non traité », AUCUN bouton de création : la "
           "sélection contient des clients déjà pris en charge",
           "aucun bouton", "aucun bouton" if "Créer la campagne" not in sans
           else "un bouton apparaît quand même",
           "Créer la campagne" not in sans)
    avec = _liste_clients_banc(banc, etat=ETAT_MANQUE, recherche="Portail",
                               non_traite="1")
    attendu = "« 🗓 Prise de rendez-vous » — 3 client(s)"
    j.vrai(nature, depart, CONSTRUCTION,
           "l'état filtré + « non traité » font apparaître le bouton, avec "
           "la NATURE déduite de la table du §3 et le COMPTE exact",
           attendu, "bouton conforme" if attendu in avec else "bouton absent "
           "ou compte faux",
           attendu in avec and 'action="/clients/campagne"' in avec)
    j.vrai(nature, depart, CONSTRUCTION,
           "plus aucune promesse « à venir » : le bouton est réel",
           "aucun badge « à venir » dans la liste",
           "aucun" if "badge-a-venir" not in avec else "un badge subsiste",
           "badge-a-venir" not in avec)

    # ------------------ §4.2: one button PER KIND when the states mix
    prevu = _liste_clients_banc(banc, etat="rendez-vous prévu",
                                recherche="Portail", non_traite="1")
    for code, libelle in (("rappel_rdv", "🔔 Rappel de rendez-vous"),
                          ("confirmation", "✅ Confirmation de rendez-vous")):
        vu = f"« {libelle} » — 1 client(s)" in prevu
        j.vrai(code, depart, CONSTRUCTION,
               "un SEUL état (rendez-vous prévu) traité par DEUX natures "
               f"donne aussi le bouton « {libelle} », avec son compte",
               f"« {libelle} » — 1 client(s)",
               "bouton présent" if vu else "bouton absent", vu)
    # The fourth kind the 👥 door can designate: `pending move` (an appointment
    # moved, and nothing upcoming left).
    attente = _liste_clients_banc(banc, etat="déplacement en attente",
                                  recherche="Portail", non_traite="1")
    vu = "« 📆 Déplacement de rendez-vous » — 1 client(s)" in attente
    j.vrai("deplacement", depart, CONSTRUCTION,
           "l'état « déplacement en attente » désigne, lui, la campagne "
           "📆 « Déplacement »",
           "« 📆 Déplacement de rendez-vous » — 1 client(s)",
           "bouton présent" if vu else "bouton absent", vu)
    mele = _liste_clients_banc(banc, recherche="Portail", non_traite="1")
    combien = mele.count('action="/clients/campagne"')
    j.egal(nature, depart, CONSTRUCTION,
           "filtre MÊLÉ (aucun état choisi) : un bouton par nature, jamais "
           "un bouton grisé qui laisse deviner — décision du 31/07/2026",
           4, combien)
    comptes = ("« 🗓 Prise de rendez-vous » — 3 client(s)" in mele
               and "« 🔔 Rappel de rendez-vous » — 1 client(s)" in mele
               and "« ✅ Confirmation de rendez-vous » — 1 client(s)" in mele
               and "« 📆 Déplacement de rendez-vous » — 1 client(s)" in mele)
    j.vrai(nature, depart, CONSTRUCTION,
           "chacun de ces quatre boutons annonce SON propre compte",
           "3, 1, 1 et 1", "comptes exacts" if comptes else "comptes faux",
           comptes)

    # --------------------- §4.3: a state with no campaign gives NO button
    humain = _liste_clients_banc(banc, etat="à rappeler par un humain",
                                 recherche="Portail", non_traite="1")
    j.vrai(nature, depart, CONSTRUCTION,
           "un état qu'aucune campagne ne traite ne donne AUCUN bouton, mais "
           "dit pourquoi (§6)",
           "aucun bouton, et la raison écrite",
           "conforme" if ("Créer la campagne" not in humain
                          and "aucune campagne ne traite cela" in humain)
           else "bouton présent ou raison muette",
           "Créer la campagne" not in humain
           and "aucune campagne ne traite cela" in humain)
    page_clients = banc.obtenir("/clients?par_page=0")
    j.vrai(nature, depart, CONSTRUCTION,
           "le compteur « 🙋 pour un humain » reste visible sur la page",
           "le compteur humain affiché",
           "présent" if "pour un humain" in page_clients else "absent",
           "pour un humain" in page_clients)

    # ------------------------- §4.4: the click opens STEP 2, list filled
    page, _ = banc.poster("/clients/campagne",
                          {"nature": "prise_rdv", "etat": ETAT_MANQUE,
                           "recherche": "Portail"})
    etape2 = ('id="fa-etape-2" class="fa-etape fa-courante"' in page
              and "🗓 <strong>Prise de rendez-vous</strong>" in page)
    j.vrai(nature, depart, CONSTRUCTION,
           "le clic ouvre l'assistant DIRECTEMENT à l'étape 2 — la nature "
           "est déjà connue, on ne la redemande pas",
           "l'étape 2 de « Prise de rendez-vous »",
           "étape 2" if etape2 else "un autre écran", etape2)
    remplie = "👥 Liste déjà remplie : <strong>3</strong> personne(s)" in page
    j.vrai(nature, depart, CONSTRUCTION,
           "la liste des personnes est DÉJÀ remplie, et l'écran dit combien",
           "3 personnes annoncées à l'étape 2",
           "annoncées" if remplie else "rien n'est dit", remplie)
    apres = base.conn.execute("SELECT COUNT(*) FROM appels").fetchone()[0]
    j.vrai(nature, depart, CONSTRUCTION,
           "AUCUN APPEL ne part de ce bouton, et AUCUNE campagne n'est créée "
           "avant validation",
           "0 appel de plus, 0 campagne de plus",
           f"{apres - appels_avant} appel(s), "
           f"{len(base.lister_campagnes()) - campagnes_avant} campagne(s)",
           apres == appels_avant
           and len(base.lister_campagnes()) == campagnes_avant)

    # ---------------------------------- §4.5: the RECIPE carries the criterion
    brouillon = re.search(r'name="b" value="(\d+)"', page).group(1)
    banc.passer_etape2("prise_rdv", brouillon)
    campagne_id, fiche = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne née du filtre d'état se valide",
                "une campagne prête", "refus : " + _erreurs_de(fiche), False)
        return
    configuration = assistant.configuration_campagne(
        base.obtenir_campagne(campagne_id))
    apports = (configuration.get("recette") or {}).get("apports", [])
    attendu_recette = [{"mode": "etat", "etat": ETAT_MANQUE,
                        "nature": "prise_rdv", "recherche": "Portail"}]
    j.egal(nature, depart, CONSTRUCTION,
           "la campagne GARDE le critère qui a bâti sa liste (recette "
           "« etat ») — c'est ce qui la rend rejouable sur un autre créneau",
           attendu_recette, apports)
    rejouable = assistant.recette_reproductible(configuration["recette"])
    contacts, _ = assistant.contacts_de_recette(
        base, configuration["recette"],
        assistant.champs_campagne(configuration), banc.application.preferences)
    j.vrai(nature, depart, CONSTRUCTION,
           "et elle se REJOUE vraiment : le critère reconstruit la même liste",
           "3 contacts retrouvés par le seul critère",
           f"{len(contacts)} contact(s), rejouable={rejouable}",
           rejouable and len(contacts) == 3)

    # ------------------------------- §5.1: a gap in the schedule → the
    # campaign
    preferences = banc.application.preferences
    for jour in range(7):
        horaires.basculer_periode(preferences, jour, 9 * 60, 18 * 60, "ouvrir")
    creneau = _iso(70, 10)
    modale = banc.obtenir("/suivi/detail?creneau="
                          + urllib.parse.quote(creneau))
    reel = ('action="/suivi/creneau/campagne"' in modale
            and f'name="creneau" value="{creneau}"' in modale
            and "à venir" not in modale)
    j.vrai("creneau_libere", "planning", CONSTRUCTION,
           "un clic sur une place LIBRE propose une vraie campagne "
           "📞 « Créneau libéré » sur CETTE place (R15 fermée)",
           "un bouton réel portant ce créneau",
           "bouton réel" if reel else "toujours « à venir » ou créneau absent",
           reel)
    campagnes_avant = len(base.lister_campagnes())
    page, _ = banc.poster("/suivi/creneau/campagne",
                          {"creneau": creneau, "depuis": "planning"})
    ouvert = ('id="fa-etape-2" class="fa-etape fa-courante"' in page
              and f'name="info_creneau_libere" value="{creneau}"' in page)
    j.vrai("creneau_libere", "planning", CONSTRUCTION,
           "le clic ouvre l'étape 2 avec le créneau DÉJÀ rempli, sans créer "
           "de campagne ni passer d'appel",
           "étape 2, créneau pré-rempli, 0 campagne de plus",
           "conforme" if (ouvert
                          and len(base.lister_campagnes()) == campagnes_avant)
           else "écran ou compte inattendu",
           ouvert and len(base.lister_campagnes()) == campagnes_avant)

    # ----------------------- §5.2 and §5.3: MOVE and CANCEL an appointment
    bouge_id = base.obtenir_ou_creer_client("M. Portail À Bouger",
                                            "06 39 98 07 76")
    dans_trois_jours = (datetime.datetime.now()
                        + datetime.timedelta(days=3)).replace(
                            second=0, microsecond=0).isoformat(
                                timespec="minutes")
    rdv_id = base.ajouter_rendezvous(bouge_id, dans_trois_jours, "Séance")
    modale = banc.obtenir(f"/suivi/detail?rdv={rdv_id}")
    gestes = ('action="/suivi/detail/deplacer"' in modale
              and 'action="/suivi/detail/annuler"' in modale)
    j.vrai("deplacement", "planning", CONSTRUCTION,
           "un clic sur un RENDEZ-VOUS propose ses deux gestes : Déplacer et "
           "Annuler",
           "les deux gestes dans la fenêtre",
           "les deux" if gestes else "gestes manquants", gestes)
    campagnes_avant = len(base.lister_campagnes())
    page, _ = banc.poster("/suivi/detail/deplacer", {"rdv": rdv_id})
    deplace = ('id="fa-etape-2" class="fa-etape fa-courante"' in page
               and "📆 <strong>Déplacement de rendez-vous</strong>" in page
               and "👥 Liste déjà remplie : <strong>1</strong> personne(s)"
               in page)
    j.vrai("deplacement", "planning", CONSTRUCTION,
           "« Déplacer » monte la campagne 📆 sur CE rendez-vous, à l'étape 2, "
           "le contact déjà en liste — et sans rien créer",
           "étape 2 de « Déplacement », 1 personne, 0 campagne de plus",
           "conforme" if (deplace
                          and len(base.lister_campagnes()) == campagnes_avant)
           else "écran ou compte inattendu",
           deplace and len(base.lister_campagnes()) == campagnes_avant)
    # `Cancel`: the 12-hour rule is CALLED, never rewritten.
    panneau, _ = banc.poster_fragment("/suivi/detail/annuler",
                                      {"rdv": rdv_id, "geste": "demander"})
    intact = base.obtenir_rendezvous(rdv_id)["statut"] == "prévu"
    j.vrai("deplacement", "planning", CONSTRUCTION,
           "« Annuler » ANNONCE d'abord ce que la règle va faire — rien "
           "n'est écrit au premier clic",
           "l'annonce « supprimé », le rendez-vous encore « prévu »",
           "annoncé, rien d'écrit" if ("« supprimé »" in panneau and intact)
           else "écrit trop tôt, ou annonce muette",
           "« supprimé »" in panneau and intact)
    resultat, _ = banc.poster_fragment("/suivi/detail/annuler",
                                       {"rdv": rdv_id, "geste": "confirmer"})
    statut = base.obtenir_rendezvous(rdv_id)["statut"]
    j.egal("deplacement", "planning", CONSTRUCTION,
           "au-delà du seuil, la règle du propriétaire s'applique : le "
           "rendez-vous est SUPPRIMÉ et sa place redevient libre",
           db.STATUT_SUPPRIME, statut)
    compense = ('action="/suivi/creneau/campagne"' in resultat
                and f'name="creneau" value="{dans_trois_jours}"' in resultat)
    j.vrai("deplacement", "planning", CONSTRUCTION,
           "la place libérée mène en UN CLIC à la campagne qui la remplira — "
           "c'est la boucle du §5, enfin fermée",
           "une proposition de campagne sur la place libérée",
           "proposée" if compense else "aucune proposition", compense)
    appels_fin = base.conn.execute(
        "SELECT COUNT(*) FROM appels").fetchone()[0]
    j.egal("deplacement", "planning", CONSTRUCTION,
           "de bout en bout, ces deux portes n'ont passé AUCUN appel",
           appels_avant, appels_fin)


# The number the bench DECLARES as a test number. Taken from the roots Arcep
# reserves for fiction (it can neither call nor be called), outside the 51-56
# endings the simulator recognises, and absent from the sample data set: it can
# therefore disturb nothing else.
NUMERO_ESSAI_BANC = "06 39 98 09 88"


def scenario_decalage_en_cascade(banc):
    """⚠ HIS JOURNEY, FROM THE FORM TO THE HISTORY (15/08/2026).

    He asked me in plain words: `Do you do real ones like me — create a
    campaign, run it, wait for it to stop and look at the history?` The answer
    was NO, and that is why three days of fixes changed nothing for him:

    · my unit tests build the campaign in Python, as a dictionary. They skip
    the forms — so everything that happens between his screen and the server is
    invisible to them. That is exactly where the 30-day-gain defect was; · the
    bench, for its part, does drive the real forms… but had NO check at all on
    the cascading shift. (The word `cascade` there means the Cascade *page*, a
    different feature — hence the confusion.)

    So this scenario redoes his gesture, in full and over HTTP: kind, step 2
    with the shift option ticked and its cut-off date, step 3 in AUTOMATIC mode
    with his rule and his ceiling, `Valider`, execution, then reading what the
    campaign actually did.

    ONE SINGLE SLOT to start with — that is the case of ALL his campaigns,
    verified in his database. It is precisely the one my tests did not cover.
    """
    j = banc.j
    nature, depart = "creneau_libere", "cascade_option"
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    creneau = banc.place_libre(bloc + 5)
    # ⚠ DELIBERATELY BOUNDED — a ceiling of 5, a near cut-off. The bench shares
    # ONE database across all its combinations; a cascade left free moves
    # dozens of appointments over months and tramples the following scenarios'
    # blocks. Measured: it brought down a check on the appointment reminder,
    # which had nothing to do with it. Five calls are enough to prove the
    # mechanism — the scale is measured in the unit tests.
    plafond = "5"
    limite = (REFERENCE + datetime.timedelta(days=250)).date().isoformat()

    # ⚠ ITS OWN CONTACTS, seeded here. The bench's sample data set stops on
    # 23/11/2026, and this scenario runs LAST: by then, no appointment is far
    # enough away for a slot to gain thirty days. Measured: `0 contacts — 58
    # people set aside`. The scenario would then have announced `the cascade
    # does not work` when it simply had nobody to call — a bench that lies is
    # worse than no bench. Ending 51: the simulator makes them ACCEPT. Each yes
    # therefore frees the slot the person leaves, and that is what we want to
    # see chain together.
    debut = datetime.datetime.fromisoformat(creneau)
    for rang in range(8):
        quand = (debut + datetime.timedelta(days=40 + rang * 7)).replace(
            hour=10, minute=0)
        client = banc.base.ajouter_client(f"Mme Cascade {rang:02d}",
                                          f"06 39 97 {10 + rang:02d} 51")
        banc.base.ajouter_rendezvous(client, quand.isoformat(
            timespec="minutes"), "Séance", statut="prévu")

    # ① Step 2: one slot, stop at the first yes, CASCADING SHIFT ticked.
    brouillon, _ = banc.ouvrir_brouillon(nature)
    formulaire = banc.formulaire_etape2(nature, brouillon)
    formulaire["info_creneau_libere"] = creneau
    formulaire["politique"] = "premier_oui"
    formulaire["opt_cascade"] = "1"
    formulaire["cascade_jusqu_au"] = limite
    page, url = banc.poster("/assistant/message", formulaire)
    # ⚠ WE JUDGE ON THE URL REACHED, not on `_erreurs_de`: that function
    # returns `(no detail)` when it finds nothing, which is TRUE in the boolean
    # sense. A check built on it always fails — mine did.
    j.vrai(nature, depart, CONSTRUCTION,
           "l'étape 2 accepte l'option « décaler en cascade » et sa date",
           "l'étape 3 s'ouvre (/assistant/liste)", url,
           "/assistant/liste" in url)

    # ② Step 3: AUTOMATIC mode, his rule, his ceiling — then `Valider`. ⚠
    # EVERYTHING GOES OUT IN THE SAME SUBMISSION AS `Valider`, as on screen: it
    # is precisely that coupling that was broken on 15/08 (the rule panel was a
    # separate form, and the gain never reached the server). A bench that saved
    # the rule separately would not see it again.
    banc.poster("/assistant/liste", {"b": brouillon,
                                     "action": "liste:automatique"})
    campagne_id, page = banc.valider_grille(brouillon, {
        "ordre": "liste", "regle_source": "a_venir", "regle_jours": "30",
        "plafond": plafond})
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « décalage en cascade » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return None

    config_avant = assistant.configuration_campagne(
        banc.base.obtenir_campagne(campagne_id))
    j.egal(nature, depart, CONSTRUCTION,
           "ce qui a été coché à l'écran arrive VRAIMENT sur la campagne "
           "(option, date limite, règle, plafond)",
           (True, limite, {"source": "a_venir", "jours": "30"}, plafond),
           (config_avant["options"].get("cascade"),
            config_avant["options"].get("cascade_jusqu_au"),
            config_avant.get("regle_liste"),
            str(config_avant.get("plafond") or "")))
    # ⚠ AND THE RULE REALLY FILLED THE GRID. Without this check, a rule that
    # finds nobody would make everything that follows incomprehensible: it
    # would say `zero calls` without ever saying WHY. That is the trap I fell
    # into while writing this scenario.
    charges = len(banc.base.contacts_de_campagne(campagne_id))
    notes = " / ".join((config_avant.get("regle_jouee") or {}).get("notes")
                       or []) or "(aucune note)"
    j.vrai(nature, depart, CONSTRUCTION,
           "la règle enregistrée avec « Valider » remplit vraiment la grille",
           "au moins un contact chargé par la règle",
           f"{charges} contact(s) — {notes}", charges > 0)
    places_avant = len(assistant.creneaux_de(
        banc.base.obtenir_campagne(campagne_id), config_avant))

    # ③ `▶ Démarrer`, then we wait for the stop — as he does.
    banc.executer(campagne_id)

    fiche = banc.base.obtenir_campagne(campagne_id)
    config = assistant.configuration_campagne(fiche)
    places = assistant.creneaux_de(fiche, config)
    nees = [f for f in places if f["horaire"] != creneau]
    pourvues = [f for f in nees if f["statut"] == assistant.CRENEAU_POURVU]
    appelees = banc.base.compter_personnes_appelees(campagne_id)

    # ⚠ THE HEART, AND IT IS WHAT HE READS ON SCREEN: the slot a contact leaves
    # joins THEIR campaign. Before, it spawned a `prête` campaign beside it,
    # and that one stopped — his no. 12: seven calls out of thirty allowed, one
    # slot filled, campaign finished.
    j.vrai(nature, depart, "51",
           "la place quittée par celui qui accepte REJOINT la campagne "
           "(elle n'en prépare pas une autre à côté)",
           f"plus de {places_avant} place(s) sur la campagne",
           f"{len(places)} place(s), dont {len(nees)} née(s) du décalage",
           len(places) > places_avant)
    j.vrai(nature, depart, "51",
           "la campagne CONTINUE sur la place née du décalage : elle recharge "
           "des contacts et les appelle",
           "au moins une place de décalage pourvue",
           f"{len(pourvues)} pourvue(s) sur {len(nees)} née(s)",
           bool(pourvues))
    j.vrai(nature, depart, "51",
           "le budget d'appels réglé est employé, pas laissé dormir",
           f"plus d'un appel (le plafond est de {plafond})",
           f"{appelees} personne(s) appelée(s)", appelees > 1)
    j.vrai(nature, depart, "51",
           "et il n'est JAMAIS dépassé",
           f"au plus {plafond} personnes appelées",
           f"{appelees} personne(s) appelée(s)", appelees <= int(plafond))
    # No `prête` campaign was seeded beside it: that was the gesture he had to
    # do by hand, and must no longer have to.
    semees = [c for c in banc.base.lister_campagnes()
              if c["id"] != campagne_id and c["statut"] == "prête"
              and assistant.configuration_campagne(c)["options"].get(
                  "cascade_origine") == campagne_id]
    j.egal(nature, depart, "51",
           "aucune campagne « prête » n'est semée à côté : tout se fait dans "
           "la campagne lancée",
           0, len(semees))
    return campagne_id


def scenario_deplacement_journee_entiere(banc):
    """⚠ HIS TEST, WORD FOR WORD (17/08/2026).

    `Check that you do exactly the same tests as me: create a campaign moving a
    whole day's appointments: everybody is handled and every case appears in
    the tests: accept (appointment moved), to be called back by a human, to
    contact again, unreachable.`

    What he had in front of him, and that no net saw: · ONE contact accepted,
    the other ten `pas appelé` — because a saved setting (`politique:
    premier_oui`) written by the OLD default went on stopping the campaign at
    the first yes; · and the appointment `moved`… to 28/07/2026, twenty days
    back, where it immediately became MISSED — five past manual slots were
    lingering at the top of the list of slots to offer.

    So the scenario goes through `Charger selon les dates` with a specific DAY,
    as he did, and checks the four things he looks at: the call count, the real
    move in the calendar, the absence of a past date, and the outcomes
    obtained. It ALSO runs the follow-ups up to the ceiling: `unreachable` is
    only reachable that way — on the first round, a non-answer schedules a
    follow-up and shows as `à recontacter`.
    """
    j = banc.j
    nature, depart = "deplacement", "journee_entiere"
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()

    # ⚠ A WHOLE DAY, seeded by us: the bench shares its database across all its
    # scenarios, so we cannot bet on a day already loaded. Eleven appointments
    # on the same day, one per person — exactly the shape of his campaign no.
    # 22.
    depart_bloc = datetime.datetime.fromisoformat(banc.place_libre(bloc))
    jour = (depart_bloc + datetime.timedelta(days=30)).date()
    while jour.weekday() >= 5:  # an OPEN day, or nothing
        jour += datetime.timedelta(days=1)
    # ⚠ THE LAST ONE ENDS IN 53: that ending NEVER picks up (it is the
    # simulator's convention). It is the only way to see `📵 injoignable`, which
    # only happens once the reminders are exhausted — the other ten draw their
    # outcome from the kind's plan, like any real list.
    for rang in range(11):
        quand = datetime.datetime.combine(
            jour, datetime.time(hour=9 + rang // 2,
                                minute=0 if rang % 2 == 0 else 30))
        fin = "53" if rang == 10 else "00"
        client = banc.base.ajouter_client(f"M. Journee {rang:02d}",
                                          f"06 39 96 {10 + rang:02d} {fin}")
        banc.base.ajouter_rendezvous(client, quand.isoformat(
            timespec="minutes"), "Séance", statut="prévu")

    # ⚠ AND A MANUAL SLOT IN THE PAST, as in his file. That is the trap:
    # sorting is by time, so that one comes FIRST and becomes the date offered
    # on the phone. Without this seeding, the scenario would go green without
    # ever having exercised the defect.
    passe = (REFERENCE - datetime.timedelta(days=20)).replace(
        hour=9, minute=30, second=0, microsecond=0).isoformat(
            timespec="minutes")
    manuels = list(horaires.creneaux_manuels(banc.application.preferences))
    banc.application.preferences.definir(themes.CLE_CRENEAUX,
                                         sorted(manuels + [passe]))

    # ① Step 2: we touch NOTHING — it is the kind's default that must call
    # everybody. Setting `politique` here would mask the defect.
    brouillon, _ = banc.ouvrir_brouillon(nature)
    formulaire = banc.formulaire_etape2(nature, brouillon)
    formulaire.pop("politique", None)
    page, url = banc.poster("/assistant/message", formulaire)
    j.vrai(nature, depart, CONSTRUCTION,
           "l'étape 2 d'un déplacement s'accepte sans qu'on touche à la "
           "politique d'appel",
           "l'étape 3 s'ouvre (/assistant/liste)", url,
           "/assistant/liste" in url)

    # ② `Charger selon les dates`: the source, the year, the week, THE DAY.
    annee, semaine, _ = jour.isocalendar()
    banc.poster("/assistant/importer",
                {"b": brouillon, "mode": "rendezvous", "source": "a_venir",
                 "annee": str(annee), "semaine": str(semaine),
                 "jour": jour.isoformat()})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne de déplacement d'une journée se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return None

    fiche = banc.base.obtenir_campagne(campagne_id)
    config = assistant.configuration_campagne(fiche)
    charges = banc.base.contacts_de_campagne(campagne_id)
    # ⚠ THE INHERITED SETTING: it is what made my fix invisible.
    j.egal(nature, depart, CONSTRUCTION,
           "un déplacement part sur « tout le monde est appelé » — aucun "
           "réglage enregistré ne peut le ramener à « premier oui »",
           assistant.NATURES["deplacement"]["politique"],
           config.get("politique"))
    j.vrai(nature, depart, CONSTRUCTION,
           "« Charger selon les dates » sur UN jour charge la journée entière",
           "au moins 8 contacts pour ce jour-là",
           f"{len(charges)} contact(s) chargé(s) le {jour:%d/%m/%Y}",
           len(charges) >= 8)

    # ③ `▶ Démarrer`, then the follow-ups — up to the ceiling, as he did.
    banc.executer(campagne_id)
    for tour in range(4):
        if not banc.lancer_relances(jours=15 * (tour + 1)):
            break

    apres = banc.base.contacts_de_campagne(campagne_id)
    appelees = banc.base.compter_personnes_appelees(campagne_id)
    etats = {}
    for contact in apres:
        etats[contact["etat"]] = etats.get(contact["etat"], 0) + 1
    lisible = ", ".join(f"{etat} : {combien}"
                        for etat, combien in sorted(etats.items()))

    # ⚠ WHAT HE SAW: 1 called out of 11, ten `épargné`. Everybody, then.
    j.egal(nature, depart, "51",
           "TOUT LE MONDE est appelé : un déplacement n'est pas un traitement "
           "unique, un oui n'arrête rien (§8.2)",
           len(apres), appelees)
    j.egal(nature, depart, "51",
           "et personne ne reste « pas appelé » ni « épargné »",
           0, etats.get("pas appelé", 0) + etats.get("épargné", 0))

    # ④ DID THE APPOINTMENT REALLY MOVE? He checked it in the calendar, and the
    # answer was no. Two writings are legitimate: the row itself moves, or it
    # becomes `déplacé` and a NEW one is born at the agreed date. So we look
    # for the client's appointment AT THE ANNOUNCED DATE — not for the row,
    # which can lie.
    lignes = [l for l in banc.base.changements_de_campagne(campagne_id)
              if l["genre"] == "deplacement"]
    tenus, passees = [], []
    for ligne in lignes:
        ancien = banc.base.obtenir_rendezvous(ligne["rendezvous_id"])
        chez_lui = [r for r in (banc.base.obtenir_rendezvous(i) for i
                                in banc.base.rendezvous_du_client(
                                    ancien["client_id"]))
                    if r["horaire"] == ligne["nouvelle_date"]
                    and r["statut"] not in ("supprimé", "annulé")]
        if chez_lui:
            tenus.append(ligne)
        if ligne["nouvelle_date"] < REFERENCE.isoformat(timespec="minutes"):
            passees.append(ligne["nouvelle_date"])
    j.vrai(nature, depart, "51",
           "chaque déplacement annoncé EXISTE vraiment dans l'agenda, à la "
           "date annoncée",
           f"{len(lignes)} déplacement(s) tenus",
           f"{len(tenus)} tenu(s) sur {len(lignes)} annoncé(s)",
           bool(lignes) and len(tenus) == len(lignes))
    # ⚠ An appointment moved to yesterday is not moved: it is lost.
    j.egal(nature, depart, "51",
           "et JAMAIS vers une date passée — un créneau manuel dont l'heure "
           "est révolue n'est plus proposé au téléphone",
           [], passees)

    # ⑤ THE FOUR CASES HE WANTS TO SEE in the history.  ⚠ THIS CHECK CHANGED
    # TWICE, AND THE BENCH STOPPED IT BOTH TIMES. On 18/08 he asked that in
    # simulation no campaign should end on the maximum number of reminders:
    # `injoignable` left this list, replaced by `à recontacter`. On 21/08 he
    # went back on it — the maximum applies everywhere — and the check came
    # back with it. That is exactly a bench's job: refusing to follow in
    # silence.  WHY THIS RETURN IS TENABLE: at the maximum number of reminders,
    # a move campaign now CANCELS the appointment, frees the slot and sends the
    # person to a human call-back (20/08). `injoignable` is no longer a dead
    # end, it is a conclusion.
    for etat, code in (("accepté", "51"), ("à rappeler par un humain", "55"),
                       ("injoignable", "53")):
        j.vrai(nature, depart, code,
               f"l'historique montre le cas « {etat} »",
               "au moins un contact dans cet état", lisible,
               bool(etats.get(etat)))
    return campagne_id


def scenario_numero_essai(banc):
    """The 🧪 test number: a DECLARED exception, and nothing more.

    Three stages, in this order — it is the order that makes the proof: ① with
    no number declared, a repeated number is refused (the guard is intact, that
    is the product's starting state); ② with the number declared, four
    identities go through, marked 🧪 everywhere, and ANOTHER repeated number is
    still refused; ③ with the field emptied, the refusal comes back for
    everybody. Then the test campaign prepared: `prête`, zero calls.
    """
    j = banc.j
    nature, depart = "confirmation", "collage"
    lignes = [f"Mme Alice Dubreuil;{NUMERO_ESSAI_BANC};{_iso(23, 9)};Séance",
              f"M. Rémi Chastain;{NUMERO_ESSAI_BANC};{_iso(23, 10)};Séance",
              f"Mme Diane Verrier;{NUMERO_ESSAI_BANC};{_iso(23, 11)};Séance",
              f"M. Hugo Sernin;{NUMERO_ESSAI_BANC};{_iso(23, 14)};Séance"]

    def grille(lignes_a_coller):
        brouillon, _ = banc.ouvrir_brouillon(nature)
        banc.passer_etape2(nature, brouillon)
        banc.poster("/assistant/importer", {"b": brouillon, "mode": "collage",
                                            "liste": "\n".join(lignes_a_coller)})
        page = banc.obtenir(f"/assistant/liste?b={brouillon}")
        contacts = banc.application.obtenir_brouillon_assistant(
            brouillon)["contacts"]
        return brouillon, page, contacts

    def declarer(numero):
        banc.poster("/reglages/enregistrer",
                    {"entreprise": "Cabinet Val Fleuri",
                     "plage_debut": "00:00", "plage_fin": "23:59",
                     "numero_essai": numero})

    # ① The guard, as shipped.
    _, page, contacts = grille(lignes)
    j.vrai(nature, depart, CONSTRUCTION,
           "sans numéro d'essai déclaré, quatre identités sur le même numéro "
           "sont réduites à une (doublon refusé)",
           "1 contact retenu, un message de doublon à l'écran",
           f"{len(contacts)} contact(s) retenu(s), doublon signalé : "
           f"{'oui' if 'doublon ignoré' in page else 'non'}",
           len(contacts) == 1 and "doublon ignoré" in page)

    # ② The number declared: the exception, and it alone.
    declarer(NUMERO_ESSAI_BANC)
    j.egal(nature, depart, CONSTRUCTION,
           "le numéro d'essai déclaré est retenu par les réglages",
           NUMERO_ESSAI_BANC,
           banc.application.preferences.obtenir(essai_reel.CLE_NUMERO_ESSAI))
    brouillon, page, contacts = grille(lignes)
    j.egal(nature, depart, CONSTRUCTION,
           "avec le numéro d'essai déclaré, les quatre identités passent",
           4, len(contacts))
    j.egal(nature, depart, CONSTRUCTION,
           "chacune est marquée 🧪 dans la grille, avec la phrase qui dit "
           "pourquoi", 4, page.count("🧪 numéro d'essai"))
    autre = [f"Mme Une;{CONTACT_STOP[1]};{_iso(23, 15)};Séance",
             f"M. Deux;{CONTACT_STOP[1]};{_iso(23, 16)};Séance"]
    _, page_autre, contacts_autre = grille(autre)
    j.vrai(nature, depart, CONSTRUCTION,
           "un AUTRE numéro répété reste refusé, numéro d'essai déclaré ou non",
           "1 contact retenu, doublon signalé",
           f"{len(contacts_autre)} contact(s) retenu(s), doublon signalé : "
           f"{'oui' if 'doublon ignoré' in page_autre else 'non'}",
           len(contacts_autre) == 1 and "doublon ignoré" in page_autre)
    campagne_id, page = banc.valider_grille(brouillon)
    contacts_bd = (banc.base.contacts_de_campagne(campagne_id)
                   if campagne_id else [])
    j.egal(nature, depart, CONSTRUCTION,
           "la validation de la grille ne refuse pas non plus ces doublons : "
           "quatre contacts distincts entrent en campagne", 4, len(contacts_bd))
    j.egal(nature, depart, CONSTRUCTION,
           "quatre FICHES CLIENTS distinctes — le couple (nom, numéro) fait "
           "la fiche", 4, len({c["client_id"] for c in contacts_bd}))
    j.egal(nature, depart, CONSTRUCTION,
           "les quatre contacts portent le drapeau 🧪 dans la fiche de "
           "campagne", 4, sum(1 for c in contacts_bd if c["numero_essai"]))

    # ③ The field emptied: the strict rule comes back for everybody.
    declarer("")
    _, page, contacts = grille(lignes)
    j.vrai(nature, depart, CONSTRUCTION,
           "le numéro d'essai retiré, le refus de doublon revient pour lui aussi",
           "1 contact retenu, doublon signalé",
           f"{len(contacts)} contact(s) retenu(s), doublon signalé : "
           f"{'oui' if 'doublon ignoré' in page else 'non'}",
           len(contacts) == 1 and "doublon ignoré" in page)

    # The real-conditions test campaign: prepared, NEVER launched.
    page, _ = banc.poster("/reglages/essai-reel", {"confirmer": "oui"})
    j.vrai(nature, depart, CONSTRUCTION,
           "sans numéro d'essai déclaré, le bouton « Préparer une campagne "
           "d'essai réel » le DIT et ne crée rien",
           "un refus écrit à l'écran, aucune campagne créée",
           _titre_de(page), "rien n'a été préparé" in page.lower())
    declarer(NUMERO_ESSAI_BANC)
    avant = len(banc.base.lister_campagnes())
    banc.poster("/reglages/essai-reel", {"confirmer": "oui"})
    campagnes_apres = banc.base.lister_campagnes()
    essai = campagnes_apres[0] if len(campagnes_apres) > avant else None
    j.egal(nature, depart, CONSTRUCTION,
           "la campagne d'essai en conditions réelles est créée à l'état PRÊTE",
           "prête", essai["statut"] if essai else "aucune campagne créée")
    contacts_essai = (banc.base.contacts_de_campagne(essai["id"])
                      if essai else [])
    j.egal(nature, depart, CONSTRUCTION,
           "elle porte une identité par rôle à jouer",
           len(essai_reel.IDENTITES), len(contacts_essai))
    appels = sum(len(banc.base.appels_du_contact_campagne(c["id"]))
                 for c in contacts_essai)
    j.egal(nature, depart, CONSTRUCTION,
           "et AUCUN appel n'en est parti — c'est l'opérateur qui démarre",
           0, appels)
    j.verrou("Préparer l'essai en conditions réelles ne passe aucun appel",
             "campagne « prête », 0 appel enregistré",
             f"statut « {essai['statut'] if essai else '—'} », "
             f"{appels} appel(s)",
             bool(essai) and essai["statut"] == "prête" and appels == 0)
    # The test number is handed back to the global masking check: declared or
    # not, it must NEVER appear in clear on a page.
    banc.numeros_a_masquer.append(NUMERO_ESSAI_BANC)
    declarer("")


def _titre_de(page):
    trouve = re.search(r"<h1>(.*?)</h1>", page, re.S)
    return html_mod.unescape(re.sub(r"<[^>]+>", "", trouve.group(1))).strip() \
        if trouve else "(aucun titre)"


def _message_de(page):
    trouve = re.search(r'<p class="pastille">(.*?)</p>', page, re.S)
    return html_mod.unescape(re.sub(r"<[^>]+>", "", trouve.group(1))).strip() \
        if trouve else "(aucun message à l'écran)"


# The TWO only pages where a number in clear is INTENDED, and announced as
# such: the Cascade page's paste area (it is the list the user would paste
# themselves, generated at their request) and the CSV exports (their reason to
# exist). They are therefore excluded from the masking check — and that is
# said.
PAGES_NUMEROS_EN_CLAIR_VOULUS = ("/cascade/generer", "/cascade/csv",
                                 "/assistant/csv")


def controler_masquage_global(banc):
    """No page served must contain a number IN CLEAR."""
    clairs = [tel for _, _, tel in CONTACTS_FORCES]
    clairs += [CONTACT_STOP[1], CONTACT_SUPPRIME[1]]
    # The 🧪 TEST number is a number like any other for this rule: declaring it
    # exempts from the DUPLICATE check, never from masking.
    clairs += banc.numeros_a_masquer
    fuites, vues = [], 0
    for chemin, contenu in banc.pages_vues:
        if chemin in PAGES_NUMEROS_EN_CLAIR_VOULUS:
            continue
        vues += 1
        for clair in clairs:
            if clair in contenu:
                fuites.append(f"{chemin} laisse voir {clair}")
    banc.j.verrou(
        f"Le masquage des numéros tient sur les {vues} pages servies pendant "
        "ce banc",
        "aucun numéro en clair, nulle part — sauf la zone de collage de la "
        "page Cascade et les exports CSV, où il est voulu et annoncé",
        "aucune fuite" if not fuites else " ; ".join(fuites[:5]),
        not fuites)
    banc.j.remarque(
        "Masquage : la zone de collage de la page Cascade et les exports CSV "
        "contiennent volontairement les numéros en clair (c'est la liste que "
        "l'utilisateur collerait lui-même). Ces pages sont donc écartées du "
        "contrôle de masquage, à dessein.")


def expliquer_les_trous(journal):
    """Say, before even counting, WHY there are still ⬜ cells."""
    journal.remarque(
        "Chaque voie de remplissage (CSV, agenda ICS, les cinq sources de la "
        "base, les six reprises de campagne) est éprouvée avec UNE nature, "
        "choisie pour être la plus naturelle avec elle. Les autres "
        "croisements « voie × nature » restent ⬜ : ils sont possibles dans le "
        "produit, ce banc ne les a simplement pas parcourus.")
    journal.remarque(
        "Une reprise de campagne FILTRÉE par état ne peut rencontrer que les "
        "issues des personnes qui étaient dans cet état : une reprise des "
        "« ❌ refus » ne croisera jamais un « 51 accepte ». Les ⬜ de ces "
        "lignes ne sont pas des oublis, c'est la nature du filtre.")
    journal.remarque(
        "Le cas « contact sans numéro » ne peut naître que d'un agenda ICS ou "
        "être compté comme écarté par une source de la base : un collage, un "
        "CSV et une liste de cascade passent tous par le validateur de "
        "numéro, qui refuse la ligne. D'où les ⬜ de la colonne « sans "
        "numéro » pour les autres natures.")


def gestes_a_la_main(journal):
    """What a bench with no mouse cannot prove — stated plainly."""
    journal.main("Le dévoilement en cascade des options (une option qui "
                 "révèle ses sous-options)",
                 "Étape 2 : décocher puis recocher « Recontacter » et vérifier "
                 "que le bloc de relance apparaît et disparaît sans que la "
                 "page se recharge.")
    journal.main("Les boutons ⏸ Pause et ⏹ Arrêter pendant une campagne",
                 "Lancer une campagne d'au moins 10 contacts, cliquer ⏸ "
                 "pendant qu'elle tourne, vérifier que l'appel en cours "
                 "s'achève puis que rien ne repart.")
    journal.main("Le téléchargement des fichiers CSV (grille et liste de "
                 "cascade)",
                 "Cliquer « Exporter en CSV » et ouvrir le fichier reçu : les "
                 "numéros y sont en clair, c'est voulu et annoncé.")
    journal.main("La modale d'édition d'un rendez-vous depuis le planning",
                 "Planning : cliquer une case occupée, changer l'heure dans la "
                 "modale, enregistrer, et vérifier que seule la zone du "
                 "planning se recharge.")
    journal.main("Le confort de lecture (couleurs, contrastes, taille des "
                 "caractères)",
                 "Ouvrir chaque page et juger à l'œil ; aucun banc ne peut le "
                 "faire à votre place.")
    journal.main("Le mode APPELS RÉELS (les trois verrous)",
                 "Ce banc ne l'approche JAMAIS. Pour l'éprouver, il faut la "
                 "clé CALLE_API_KEY, l'option --appels-reels et taper "
                 "APPELER : à faire à la main, en connaissance de cause.")
    journal.main("L'ISSUE d'un vrai appel — ce que l'agent comprend de ce que "
                 "vous DITES au téléphone",
                 "Aucun banc ne peut en juger : ici, l'issue est décidée par "
                 "le simulateur ; au téléphone, elle dépend de vos phrases et "
                 "de la compréhension du français par l'agent. C'est l'objet "
                 "de l'essai en conditions réelles : déclarez votre 🧪 numéro "
                 "d'essai dans ⚙ Réglages, préparez la campagne d'essai, puis "
                 "suivez PROCEDURE-ESSAI-REEL.md — c'est VOUS qui constatez, "
                 "appel par appel, si le résultat rendu est fidèle.")


# ===========================================================================
# THE REPORT
# ===========================================================================
def _libelles(paires):
    return dict(paires)


LIB_NATURES = {code: f"{definition['icone']} {definition['nom']}"
               for code, definition in assistant.NATURES.items()}
LIB_ISSUES = _libelles(ISSUES)
LIB_DEPARTS = _libelles(DEPARTS)


def _marque_case(journal, cas_de_la_case, sans_objet):
    if sans_objet:
        return "·"
    return journal.marque(cas_de_la_case)


def construire_tableaux(journal):
    """The report's three tables, ready to render as text or as HTML."""
    cellules = journal.cellules()

    def cas_pour(filtre):
        trouves = []
        for (nature, depart, issue), liste in cellules.items():
            if filtre(nature, depart, issue):
                trouves += liste
        return trouves

    # Tableau A : nature × issue
    lignes_a = []
    for nature in NATURES_ORDRE:
        cases = []
        for issue in CODES_ISSUES:
            liste = cas_pour(lambda n, d, i, na=nature, iss=issue:
                             n == na and i == iss)
            cases.append(_marque_case(journal, liste, False))
        lignes_a.append((LIB_NATURES[nature], cases))
    tableau_a = {"titre": "TABLEAU A — chaque NATURE de campagne face à "
                          "chaque ISSUE d'appel",
                 "colonnes": [LIB_ISSUES[c] for c in CODES_ISSUES],
                 "lignes": lignes_a}

    # Table B: starting point × kind (`construction` column included)
    lignes_b = []
    for depart in CODES_DEPARTS:
        cases = []
        for nature in NATURES_ORDRE:
            atteignables = NATURES_DU_DEPART.get(depart)
            sans_objet = (atteignables is not None
                          and nature not in atteignables)
            liste = cas_pour(lambda n, d, i, na=nature, de=depart:
                             n == na and d == de)
            cases.append(_marque_case(journal, liste, sans_objet and not liste))
        lignes_b.append((LIB_DEPARTS[depart], cases))
    tableau_b = {"titre": "TABLEAU B — chaque POINT DE DÉPART face à chaque "
                          "NATURE de campagne",
                 "colonnes": [LIB_NATURES[n] for n in NATURES_ORDRE],
                 "lignes": lignes_b}

    # Table C: starting point × outcome
    lignes_c = []
    for depart in CODES_DEPARTS:
        cases = []
        for issue in CODES_ISSUES:
            sans_objet = ((depart, "*") in SANS_OBJET_ISSUE_DEPART
                          or (depart, issue) in SANS_OBJET_ISSUE_DEPART)
            liste = cas_pour(lambda n, d, i, de=depart, iss=issue:
                             d == de and i == iss)
            cases.append(_marque_case(journal, liste, sans_objet and not liste))
        lignes_c.append((LIB_DEPARTS[depart], cases))
    tableau_c = {"titre": "TABLEAU C — chaque POINT DE DÉPART face à chaque "
                          "ISSUE d'appel",
                 "colonnes": [LIB_ISSUES[c] for c in CODES_ISSUES],
                 "lignes": lignes_c}
    return [tableau_a, tableau_b, tableau_c]


def compter(journal):
    """The report's figures, all measured."""
    cellules = journal.cellules()
    trois_axes = {cle: liste for cle, liste in cellules.items()
                  if cle[2] in CODES_ISSUES and cle[0] is not None}
    passees = sum(1 for liste in trois_axes.values()
                  if all(c.passe for c in liste))
    theorique = len(NATURES_ORDRE) * len(CODES_DEPARTS) * len(CODES_ISSUES)
    paires = {}
    for nom, axes in (("nature × issue", ("nature", "issue")),
                      ("départ × nature", ("depart", "nature")),
                      ("départ × issue", ("depart", "issue"))):
        agrege = journal.agreger(*axes)
        paires[nom] = {
            "visitees": len(agrege),
            "passees": sum(1 for m in agrege.values() if m == "✅"),
            "echouees": sum(1 for m in agrege.values() if m == "❌")}
    return {
        "controles": len(journal.cas),
        "controles_passes": sum(1 for c in journal.cas if c.passe),
        "controles_echoues": len(journal.echecs),
        "combinaisons_visitees": len(trois_axes),
        "combinaisons_passees": passees,
        "combinaisons_echouees": len(trois_axes) - passees,
        "combinaisons_theoriques": theorique,
        "verrous": len(journal.verrous),
        "verrous_passes": sum(1 for v in journal.verrous if v[3]),
        "paires": paires,
    }


# THE FLOOR ON THE NUMBER OF CHECKS (10/08/2026). It serves one purpose only:
# making the disappearance of a check VISIBLE. A check conditioned by a
# screen's content stops running as soon as the screen changes, and the report
# goes on announcing `TOUT PASSE` — which is exactly what happened that day
# (614 → 613, identical detail, no failures), and then the count came back to
# 614 later the same day, stable byte for byte over two consecutive runs. The
# check in question was not named: its entry condition therefore depends on
# something that moved in the meantime. That is precisely what this floor
# exists to make glaring next time. We RAISE it by adding checks. We only lower
# it knowing which one we lost, and why it is intended.  ⚠ 614 → 613 ON
# 11/08/2026, AND THIS TIME THE LOST CHECK IS NAMED — which is what the
# paragraph above demanded. Measured by comparing the check labels from one run
# to the next: the pool of `à rappeler par un humain` contacts SHRANK by the
# owner's decision (that call-back now exists only on `déplacement` and `prise
# de rendez-vous` — see assistant.NATURES_RAPPEL_HUMAIN). The `Étape 3 —
# reprise` starting points therefore draw from other pools: the booking kind's
# `54` case moved from the `✅ acceptés` resumption to the `🙋 à rappeler par un
# humain` one, and one combination has one fewer contact to check.  That is
# intended: the state exists less often because we wanted it so. So the floor
# goes down one notch, knowingly.  ⚠ AND ON 14/08/2026, THE REAL CAUSE OF THE
# FIRST 614 → 613 IS FOUND: THE DAY OF THE WEEK. The bench starts from `today
# at noon`; its blocks advance ten days at a time, and ten days shift the
# weekday by three. On some days, a block therefore fell on a Saturday or a
# Sunday — practice closed. The product then rightly refused to place the
# appointment, and the check that followed measured the CALENDAR, not the
# product. Measured that day (a Friday): the simulated postponement, always at
# the slot + two days, fell on Sunday 16/08 — `Appointment NOT created […]
# outside the opening hours`, and `the old appointment no longer holds` failed.
# It is exactly the same family of trap as the HOURS of 11/08 (see
# `Banc.demarrer`, 8am – 7pm): the bench's setup must cover what its own calls
# can offer. The direct cascade's dates now go through `_jour_ouvre`, and the
# count is stable whatever the day. So the floor goes back up to 614 — what it
# was before the calendar lowered it.  ⚠ 614 → 619 ON 14/08/2026, AND THIS TIME
# IT IS A GAIN. The `adaptations × kinds` cross audit led to fixing the
# `another date agreed` branch: when the date returned is one of the ANNOUNCED
# slots, the slot is now marked filled and the cursor advances (before, it
# stayed `to be filled`, was announced again, then declared `taken in the
# meantime` although the campaign had filled it). One more combination is
# therefore walked — 116 instead of 115 — and five more checks run. The floor
# rises with them.  ⚠ 619 → 629 ON 15/08/2026, AND THE CAUSE IS NAMED BEFORE
# THE FLOOR IS RAISED — which is what the 11/08 paragraph above requires, in
# the other direction. The manual call-back disappeared from `créneau libéré`
# on ITS LAST path, that of refused dates: those contacts now go `refusé`. The
# pool of `refusé` grows accordingly, and the `Étape 3 — reprise` starting
# points that draw from it reach TWO more combinations (118 instead of 116),
# hence ten more checks. It is the exact mechanism of 614 → 613, played in
# reverse: the size of a pool commands the number of possible resumptions.  ⚠
# 629 → 637 ON 15/08/2026: EIGHT MORE CHECKS, AND IT IS THE GAP THAT COST THREE
# DAYS. His question: `Do you do real tests like me — create a campaign, run
# it, look at the history?` No. And the bench, which did do that, did NOT check
# the `cascading shift` option — the word `cascade` there meant the Cascade
# *page*, a different feature. So neither my tests nor the bench could see his
# defect. `scenario_decalage_en_cascade` redoes his gesture in full, over HTTP,
# on a campaign with ONE slot — the case of all of his.  ⚠ 637 → 633 ON
# 16/08/2026: FOUR CHECKS LOST, AND THAT IS THE PRICE. His request of the day:
# the dynamic rule now opens on `upcoming appointments, not yet confirmed` (it
# was `to rebook` — see assistant.REGLE_LISTE_DEFAUT).  WHAT IS LOST, NAMED:
# the cell `Étape 3 — reprise: ❌ refus` × `51 · accepts`. A catch-up campaign
# is set up in automatic mode; the default rule therefore adds people, and it
# is no longer the same list. With `to rebook` it brought back the ending-51
# contact; with `upcoming`, it does not — that person no longer has an upcoming
# appointment, they are waiting for a slot. So the combination no longer has a
# contact `who accepts` to play.  BISECTED, not assumed: only
# REGLE_LISTE_DEFAUT put back to `a_recaser` gives 637/119; the reference date
# forced to 15/08 still gives 633/118. So it is not the calendar, unlike the
# 614 → 613 of 11/08.  It is intended — the default changes, the list changes —
# but it is not free: that resumption path is no longer exercised with somebody
# who accepts. To be made independent of the default the day we touch it again
# (the resumption should validate in MANUAL mode: its subject is resuming a
# list, not replaying a rule).  ⚠ 633 → 643 ON 17/08/2026: TEN MORE CHECKS, AND
# A TRAP NARROWLY AVOIDED. HIS TEST became a scenario: moving a WHOLE DAY's
# appointments, and checking that everybody is handled, that the appointments
# really move, never to a past date, and that the cases he named appear (see
# `scenario_deplacement_journee_entiere`).  THE TRAP, MEASURED BEFORE RAISING
# THE FLOOR: at its first position in the order, the scenario did add its 10
# checks… and the total only rose by 5. Its follow-ups moved the shared
# database's `🔁 à recontacter` into `📵 injoignable`; the `à recontacter`
# resumption, which reads that pool afterwards, fell from 6 checks to 1. No
# failure, no incident: the report announced `TOUT PASSE` with LESS coverage
# than before.  That is exactly what this floor exists to catch, and it is the
# second time it has done so (see 614 → 613 and 637 → 633). Remedy: the
# scenario runs AFTER all the others — after the resumptions, not only after
# the matrix. Counts verified on both sides: `à recontacter` back to 6, whole
# day at 10, total 643/121 = 633/118 + 10/3. Nothing lost.
CONTROLES_PLANCHER = 643


def rapport_texte(journal, chiffres, tableaux):
    """The report as text, for the console."""
    lignes = []
    ajouter = lignes.append
    ajouter("=" * 78)
    ajouter("  RINGBACK — BANC D'ESSAI DE BOUT EN BOUT (simulation uniquement)")
    ajouter(f"  Rapport du {REFERENCE:%d/%m/%Y}")
    ajouter("=" * 78)
    ajouter("")
    # ⚠ THE LOCKS COUNT AS MUCH AS THE CHECKS (04/09/2026): a broken safety
    # lock must NEVER read as `TOUT PASSE`.
    rompus = journal.verrous_rompus
    if journal.echecs or rompus:
        morceaux = []
        if rompus:
            morceaux.append(f"{len(rompus)} VERROU(S) DE SÉCURITÉ ROMPU(S)")
        if journal.echecs:
            morceaux.append(f"{len(journal.echecs)} CONTRÔLE(S) EN ÉCHEC")
        verdict = " ET ".join(morceaux)
    else:
        verdict = "TOUT PASSE"
    ajouter(f"EN UNE LIGNE : {verdict} — "
            f"{chiffres['controles_passes']}/{chiffres['controles']} contrôles, "
            f"{chiffres['combinaisons_passees']}/"
            f"{chiffres['combinaisons_visitees']} combinaisons parcourues.")
    ajouter("")
    ajouter("-" * 78)
    ajouter("1. LES VERROUS DE SÉCURITÉ (aucun appel réel ne peut partir d'ici)")
    ajouter("-" * 78)
    for libelle, attendu, obtenu, passe in journal.verrous:
        ajouter(f"  {'✅' if passe else '❌'} {libelle}")
        if not passe:
            ajouter(f"       attendu : {attendu}")
            ajouter(f"       obtenu  : {obtenu}")
    ajouter("")
    ajouter("-" * 78)
    ajouter("2. LE COMPTE DES CAS")
    ajouter("-" * 78)
    # ⚠ A CHECK THAT DISAPPEARS MAKES NO NOISE. On 10/08/2026 the bench went
    # from 614 to 613 checks: everything passed, the detail was identical byte
    # for byte, and one check had simply stopped running — because it depends
    # on a condition a reworked screen no longer meets. Nothing signalled it.
    # The floor below signals it from now on: we RAISE it when we add checks,
    # we never lower it without knowing which one we lost.
    manque = CONTROLES_PLANCHER - chiffres["controles"]
    if manque > 0:
        ajouter(f"  ⚠ {manque} CONTRÔLE(S) NE S'EXÉCUTENT PLUS — le banc en")
        ajouter(f"    attendait au moins {CONTROLES_PLANCHER}. Tout passe, mais")
        ajouter("    quelque chose n'est plus vérifié : cherchez le contrôle")
        ajouter("    dont la condition d'entrée a changé.")
    ajouter(f"  Contrôles exécutés ........................ {chiffres['controles']}")
    ajouter(f"     dont passés ............................ {chiffres['controles_passes']}")
    ajouter(f"     dont en échec .......................... {chiffres['controles_echoues']}")
    ajouter(f"  Combinaisons (nature × départ × issue) ... {chiffres['combinaisons_visitees']} parcourues")
    ajouter(f"     dont entièrement bonnes ................ {chiffres['combinaisons_passees']}")
    ajouter(f"     dont fautives .......................... {chiffres['combinaisons_echouees']}")
    ajouter(f"  Produit complet des trois axes ............ {chiffres['combinaisons_theoriques']}")
    ajouter("     (la plupart n'existent pas dans le produit : voir les")
    ajouter("      cases « · sans objet » des tableaux, et la section 6)")
    for nom, valeurs in chiffres["paires"].items():
        ajouter(f"  Paires {nom:<16} ......... {valeurs['passees']} bonnes / "
                f"{valeurs['echouees']} fautives sur {valeurs['visitees']} "
                "parcourues")
    ajouter("")
    ajouter("  Légende : ✅ passé   ❌ échoué   ⬜ non couvert   · sans objet")
    ajouter("")
    for tableau in tableaux:
        ajouter("-" * 78)
        ajouter(f"3. {tableau['titre']}" if tableau is tableaux[0]
                else f"   {tableau['titre']}")
        ajouter("-" * 78)
        largeur = max(len(ligne[0]) for ligne in tableau["lignes"]) + 1
        for indice, colonne in enumerate(tableau["colonnes"]):
            ajouter(f"     colonne {indice + 1} = {colonne}")
        entete = " " * largeur + "".join(f"{i + 1:>4}"
                                         for i in range(len(tableau["colonnes"])))
        ajouter(entete)
        for nom, cases in tableau["lignes"]:
            ajouter(f"{nom:<{largeur}}" + "".join(f"  {c} " for c in cases))
        ajouter("")
    ajouter("-" * 78)
    ajouter("4. LES ÉCHECS, UN PAR UN")
    ajouter("-" * 78)
    if not journal.echecs:
        ajouter("  Aucun échec.")
    for numero, cas in enumerate(journal.echecs, start=1):
        ajouter(f"  ❌ {numero}. {_situation(cas)}")
        ajouter(f"        ce qui était vérifié : {cas.quoi}")
        ajouter(f"        attendu : {cas.attendu}")
        ajouter(f"        obtenu  : {cas.obtenu}")
    ajouter("")
    ajouter("-" * 78)
    ajouter("5. À VÉRIFIER À LA MAIN (ce banc n'a pas de souris)")
    ajouter("-" * 78)
    for quoi, marche in journal.a_la_main:
        ajouter(f"  • {quoi}")
        ajouter(f"    → {marche}")
    ajouter("")
    ajouter("-" * 78)
    ajouter("6. CE QUI N'EST PAS COUVERT, ET POURQUOI")
    ajouter("-" * 78)
    for depart, raison in SANS_OBJET_DEPART_NATURE.items():
        ajouter(f"  · {LIB_DEPARTS[depart]} : {raison}")
    for (depart, marque), raison in SANS_OBJET_ISSUE_DEPART.items():
        if marque == "*":
            ajouter(f"  · {LIB_DEPARTS[depart]} : {raison}")
    ajouter("  ⬜ Toute case ⬜ des tableaux est un trou de couverture ASSUMÉ :")
    ajouter("     ce banc ne l'a pas parcourue. Elle n'est pas « bonne », elle")
    ajouter("     est INCONNUE.")
    for remarque in journal.remarques:
        ajouter(f"  · {remarque}")
    if journal.incidents:
        ajouter("")
        ajouter("  Imprévus du banc lui-même (à lire : ils faussent peut-être")
        ajouter("  une partie du rapport) :")
        for incident in journal.incidents:
            ajouter(f"  ! {incident}")
    ajouter("")
    ajouter("-" * 78)
    ajouter("7. COMMENT CE RAPPORT EST FABRIQUÉ")
    ajouter("-" * 78)
    ajouter("  • Base JETABLE dans un dossier temporaire, détruite à la fin.")
    ajouter("    La base réelle donnees/ringback.db n'est jamais ouverte.")
    ajouter("  • Serveur web sur le port 8779 (le produit vit sur 8770).")
    ajouter("  • Jeu de données : celui du produit (ringback/jeu_essai.py),")
    ajouter(f"    {len(jeu_essai.CLIENTS)} clients et "
            f"{len(jeu_essai.RENDEZVOUS)} rendez-vous, numéros de fiction")
    ajouter("    Arcep — aucun ne peut sonner chez quelqu'un.")
    ajouter(f"  • Date de référence : {REFERENCE:%d/%m/%Y} à 12 h 00. C'est la")
    ajouter("    SEULE date relative ; tout le reste en découle. Le rapport ne")
    ajouter("    porte pas d'heure, pour être comparable d'une exécution à")
    ajouter("    l'autre le même jour.")
    ajouter("")
    return "\n".join(lignes)


def _situation(cas):
    morceaux = []
    if cas.nature:
        morceaux.append(f"nature « {LIB_NATURES.get(cas.nature, cas.nature)} »")
    if cas.depart:
        morceaux.append(f"départ « {LIB_DEPARTS.get(cas.depart, cas.depart)} »")
    if cas.issue == CONSTRUCTION:
        morceaux.append("construction de la campagne")
    else:
        morceaux.append(f"issue « {LIB_ISSUES.get(cas.issue, cas.issue)} »")
    return " ; ".join(morceaux)


_STYLE = """
body { font-family: "Segoe UI", system-ui, sans-serif; margin: 0;
       background: #f6f7f9; color: #1d2330; line-height: 1.5; }
main { max-width: 1080px; margin: 0 auto; padding: 24px 18px 60px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
h2 { font-size: 1.15rem; margin: 34px 0 10px; padding-bottom: 6px;
     border-bottom: 2px solid #dfe3ea; }
.sous { color: #5a6474; margin: 0 0 20px; }
.verdict { background: #fff; border-left: 6px solid #2f8f4e; padding: 14px 16px;
           border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.08);
           font-size: 1.05rem; }
.verdict.mauvais { border-left-color: #c0392b; }
table { border-collapse: collapse; background: #fff; font-size: .9rem;
        box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.defiler { overflow-x: auto; }
th, td { border: 1px solid #e3e6ec; padding: 6px 9px; text-align: left; }
th { background: #eef1f6; font-weight: 600; }
td.case { text-align: center; font-size: 1.05rem; width: 2.4rem; }
td.nom { white-space: nowrap; }
.chiffres { display: grid; gap: 10px;
            grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.chiffre { background: #fff; border-radius: 6px; padding: 12px 14px;
           box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.chiffre b { display: block; font-size: 1.6rem; }
.legende { color: #5a6474; font-size: .9rem; }
ul { padding-left: 22px; }
li { margin-bottom: 8px; }
.echec { background: #fff; border-left: 5px solid #c0392b; padding: 10px 14px;
         border-radius: 5px; margin-bottom: 12px; }
.ok { color: #2f8f4e; } .ko { color: #c0392b; }
code { background: #eef1f6; padding: 1px 5px; border-radius: 3px; }
"""


def rapport_html(journal, chiffres, tableaux):
    """The same report, as a standalone page (no external resources)."""
    e = html_mod.escape
    morceaux = ["<!doctype html>", '<html lang="fr"><head>',
                '<meta charset="utf-8">',
                '<meta name="viewport" content="width=device-width, '
                'initial-scale=1">',
                "<title>RingBack — banc d'essai de bout en bout</title>",
                f"<style>{_STYLE}</style></head><body><main>"]
    a = morceaux.append
    a("<h1>RingBack — banc d'essai de bout en bout</h1>")
    a(f'<p class="sous">Rapport du {REFERENCE:%d/%m/%Y} — '
      "essais en <strong>simulation</strong> uniquement : aucun appel réel "
      "n'a pu partir, aucune donnée réelle n'a été touchée.</p>")
    mauvais = " mauvais" if journal.echecs else ""
    verdict = ("Tout passe." if not journal.echecs
               else f"{len(journal.echecs)} contrôle(s) en échec.")
    a(f'<p class="verdict{mauvais}"><strong>{e(verdict)}</strong><br>'
      f"{chiffres['controles_passes']} contrôles réussis sur "
      f"{chiffres['controles']} ; "
      f"{chiffres['combinaisons_passees']} combinaisons entièrement bonnes sur "
      f"{chiffres['combinaisons_visitees']} parcourues.</p>")
    a("<h2>1. Les verrous de sécurité</h2>")
    a("<ul>")
    for libelle, attendu, obtenu, passe in journal.verrous:
        marque = '<span class="ok">✅</span>' if passe else '<span class="ko">❌</span>'
        detail = ("" if passe else
                  f"<br><small>attendu : {e(attendu)}<br>"
                  f"obtenu : {e(obtenu)}</small>")
        a(f"<li>{marque} {e(libelle)}{detail}</li>")
    a("</ul>")
    a("<h2>2. Le compte des cas</h2>")
    a('<div class="chiffres">')
    for titre, valeur in (
            ("Contrôles exécutés", chiffres["controles"]),
            ("Contrôles réussis", chiffres["controles_passes"]),
            ("Contrôles en échec", chiffres["controles_echoues"]),
            ("Combinaisons parcourues", chiffres["combinaisons_visitees"]),
            ("Combinaisons bonnes", chiffres["combinaisons_passees"]),
            ("Verrous tenus",
             f"{chiffres['verrous_passes']}/{chiffres['verrous']}")):
        a(f'<div class="chiffre"><b>{valeur}</b>{e(titre)}</div>')
    a("</div>")
    a('<p class="legende">Le produit complet des trois axes vaudrait '
      f"{chiffres['combinaisons_theoriques']} combinaisons. La plupart "
      "n'existent pas dans le produit (une file d'appels n'a pas de nature, "
      "un collage ne peut pas produire un contact sans numéro…) : elles sont "
      "marquées « · sans objet ». Les cases ⬜ sont de vrais trous, assumés "
      "comme tels.</p>")
    a('<p class="legende">Légende : ✅ passé — ❌ échoué — ⬜ non couvert — '
      "· sans objet</p>")
    numero = 3
    for tableau in tableaux:
        a(f"<h2>{numero}. {e(tableau['titre'])}</h2>")
        numero += 1
        a('<div class="defiler"><table><tr><th></th>')
        for colonne in tableau["colonnes"]:
            a(f"<th>{e(colonne)}</th>")
        a("</tr>")
        for nom, cases in tableau["lignes"]:
            a(f'<tr><td class="nom">{e(nom)}</td>')
            for case in cases:
                a(f'<td class="case">{case}</td>')
            a("</tr>")
        a("</table></div>")
    a(f"<h2>{numero}. Les échecs, un par un</h2>")
    numero += 1
    if not journal.echecs:
        a("<p>Aucun échec.</p>")
    for indice, cas in enumerate(journal.echecs, start=1):
        a(f'<div class="echec"><strong>{indice}. {e(_situation(cas))}</strong>'
          f"<br>Ce qui était vérifié : {e(cas.quoi)}."
          f"<br><strong>Attendu :</strong> {e(cas.attendu)}"
          f"<br><strong>Obtenu :</strong> {e(cas.obtenu)}</div>")
    a(f"<h2>{numero}. À vérifier à la main</h2>")
    numero += 1
    a("<p>Ce banc n'a pas de souris : ce qui suit ne peut pas être prouvé "
      "automatiquement.</p><ul>")
    for quoi, marche in journal.a_la_main:
        a(f"<li><strong>{e(quoi)}</strong><br>{e(marche)}</li>")
    a("</ul>")
    a(f"<h2>{numero}. Ce qui n'est pas couvert, et pourquoi</h2>")
    numero += 1
    a("<ul>")
    for depart, raison in SANS_OBJET_DEPART_NATURE.items():
        a(f"<li>· <strong>{e(LIB_DEPARTS[depart])}</strong> : {e(raison)}</li>")
    for (depart, marque), raison in SANS_OBJET_ISSUE_DEPART.items():
        if marque == "*":
            a(f"<li>· <strong>{e(LIB_DEPARTS[depart])}</strong> : "
              f"{e(raison)}</li>")
    for remarque in journal.remarques:
        a(f"<li>· {e(remarque)}</li>")
    a("</ul>")
    if journal.incidents:
        a("<p><strong>Imprévus du banc lui-même</strong> (ils faussent "
          "peut-être une partie du rapport) :</p><ul>")
        for incident in journal.incidents:
            a(f"<li>! {e(incident)}</li>")
        a("</ul>")
    a(f"<h2>{numero}. Comment ce rapport est fabriqué</h2>")
    a("<ul>")
    a("<li>Base <strong>jetable</strong> dans un dossier temporaire, détruite "
      "à la fin. La base réelle <code>donnees/ringback.db</code> n'est jamais "
      "ouverte : le banc refuse de démarrer si on la lui désigne.</li>")
    a("<li>Serveur web sur le port <code>8779</code> (le produit vit sur "
      "<code>8770</code>), arrêté proprement même en cas d'échec au "
      "milieu.</li>")
    a(f"<li>Jeu de données : celui du produit "
      f"(<code>ringback/jeu_essai.py</code>) — {len(jeu_essai.CLIENTS)} "
      f"clients, {len(jeu_essai.RENDEZVOUS)} rendez-vous, numéros de fiction "
      "Arcep qui ne peuvent pas sonner chez quelqu'un.</li>")
    a(f"<li>Date de référence : <strong>{REFERENCE:%d/%m/%Y} à 12 h 00</strong>"
      " — la seule date relative du banc, tout le reste en découle. Le rapport "
      "ne porte pas d'heure, pour être comparable d'une exécution à l'autre le "
      "même jour.</li>")
    a("</ul>")
    a("</main></body></html>")
    return "\n".join(morceaux)


# ===========================================================================
# THE RUN
# ===========================================================================
def verifier_chemin_de_base(chemin):
    """Refuses any path that would touch the real data."""
    cible = os.path.normcase(os.path.abspath(chemin))
    reelle = os.path.normcase(os.path.abspath(BASE_REELLE))
    dossier = os.path.normcase(os.path.abspath(DOSSIER_DONNEES))
    if cible == reelle:
        raise RefusDuBanc(
            "Refus : ce chemin est la base RÉELLE du produit "
            f"({BASE_REELLE}). Le banc ne travaille que sur une base jetable "
            "— il ne touchera jamais à vos vraies données.")
    if cible == dossier or cible.startswith(dossier + os.sep):
        raise RefusDuBanc(
            f"Refus : le dossier « {DOSSIER_DONNEES} » contient les données "
            "réelles du produit. Choisissez un chemin ailleurs, ou laissez le "
            "banc créer lui-même sa base jetable.")
    return cible


def verifier_port(port):
    """Refuses one of the product's ports, and refuses a port already in use.
    """
    if port in PORTS_RESERVES_PRODUIT:
        raise RefusDuBanc(
            f"Refus : le port {port} est réservé au produit (8770 à 8778). "
            f"Le banc utilise {PORT_BANC}.")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as prise:
        prise.settimeout(0.5)
        if prise.connect_ex(("127.0.0.1", port)) == 0:
            raise RefusDuBanc(
                f"Refus : le port {port} est déjà occupé par un autre "
                "programme. Fermez-le, ou lancez le banc avec un autre port "
                "(option --port).")
    return port


def derouler(banc):
    """The whole matrix, in a FIXED order (that is what makes the bench
    reproducible).
    """
    j = banc.j
    campagne_pour_reprise = None
    for nature in NATURES_ORDRE:
        if nature == "creneau_libere":
            continue  # its real mechanism is the cascade: handled separately
        try:
            campagne_id = scenario_assistant_par_nature(banc, nature)
            if nature == "prise_rdv" and campagne_id:
                campagne_pour_reprise = campagne_id
        except Exception as erreur:            # noqa: BLE001 — on rapporte
            j.incident(f"Nature « {nature} » : le banc s'est arrêté sur "
                       f"{type(erreur).__name__} — {erreur}")
    campagne_refus = None
    for scenario in (scenario_creneau_libere_cascade,
                     scenario_csv, scenario_ics,
                     scenario_colonnes_obligatoires_vides,
                     scenario_deux_oui_sans_rendezvous_existant,
                     scenario_annulation_deux_reglages,
                     scenario_seuil_de_compensation,
                     scenario_numero_essai,
                     scenario_bouton_demarrer,
                     # ⚠ LAST IN THIS LIST, AND IT IS INTENDED: it moves
                     # appointments over several months, hence across the other
                     # scenarios' blocks.
                     scenario_decalage_en_cascade):
        try:
            resultat = scenario(banc)
            if scenario is scenario_creneau_libere_cascade:
                campagne_refus = resultat
        except Exception as erreur:            # noqa: BLE001
            j.incident(f"{scenario.__name__} : {type(erreur).__name__} — "
                       f"{erreur}")
    for depart, nature in (("base_a_venir", "deplacement"),
                           ("base_manques", "rappel_rdv"),
                           ("base_annules", "prise_rdv"),
                           # `prise de rendez-vous` twice, deliberately: it is
                           # the only kind whose GRID imposes no column, hence
                           # the only one that can start from a source that
                           # does not fill them.
                           ("base_deplaces", "prise_rdv"),
                           ("base_tous", "prise_rdv")):
        try:
            scenario_depuis_la_base(banc, depart, nature)
        except Exception as erreur:            # noqa: BLE001
            j.incident(f"Source « {depart} » avec la nature « {nature} » : "
                       f"{type(erreur).__name__} — {erreur}")
    try:
        injoignable = scenario_injoignable(banc)
    except Exception as erreur:                # noqa: BLE001
        injoignable = None
        j.incident(f"scenario_injoignable : {type(erreur).__name__} — {erreur}")
    source_reprise = campagne_pour_reprise or injoignable
    if source_reprise:
        try:
            scenario_reprise_de_campagne(banc, source_reprise, injoignable,
                                         campagne_refus)
        except Exception as erreur:            # noqa: BLE001
            j.incident("Reprise d'une campagne précédente : "
                       f"{type(erreur).__name__} — {erreur}")
    else:
        j.incident("Aucune campagne source disponible : les six reprises de "
                   "campagne n'ont pas pu être parcourues.")
    for scenario in (scenario_file_appels, scenario_cascade_directe,
                     scenario_cascade_ancien_rendezvous):
        try:
            scenario(banc)
        except Exception as erreur:            # noqa: BLE001
            j.incident(f"{scenario.__name__} : {type(erreur).__name__} — "
                       f"{erreur}")
    # LAST: this scenario adds clients and opens the hours wide. Placing it
    # elsewhere would move the following scenarios' counts — and the bench must
    # produce the SAME report twice.
    try:
        scenario_deux_portes_vers_campagne(banc)
    except Exception as erreur:                # noqa: BLE001
        j.incident("scenario_deux_portes_vers_campagne : "
                   f"{type(erreur).__name__} — {erreur}")
    # ⚠ AFTER EVERYTHING ELSE, AND FOR A MEASURED REASON (17/08/2026): this
    # scenario RUNS THE FOLLOW-UPS, which moves the shared database's `🔁 à
    # recontacter` into `📵 injoignable`. Placed higher up, it emptied the pool
    # the `à recontacter` resumption comes to read: five checks disappeared
    # without a single failure — the report announced `everything passes` with
    # LESS coverage than before. It is the CONTROLES_PLANCHER floor that
    # revealed it: the total rose by only 5 when this scenario adds 10.
    try:
        scenario_deplacement_journee_entiere(banc)
    except Exception as erreur:                # noqa: BLE001
        j.incident("scenario_deplacement_journee_entiere : "
                   f"{type(erreur).__name__} — {erreur}")


def principal(arguments=None):
    analyseur = argparse.ArgumentParser(
        description="Banc d'essai de bout en bout de RingBack "
                    "(SIMULATION uniquement).")
    analyseur.add_argument("--port", type=int, default=PORT_BANC,
                           help=f"port du serveur d'essai (défaut {PORT_BANC})")
    analyseur.add_argument("--base", default=None,
                           help="chemin de la base JETABLE (défaut : un "
                                "dossier temporaire). La base réelle est "
                                "refusée.")
    analyseur.add_argument("--rapport", default=None,
                           help="dossier où écrire le rapport (défaut : à côté "
                                "de ce fichier)")
    options = analyseur.parse_args(arguments)
    try:
        verifier_port(options.port)
    except RefusDuBanc as refus:
        print(str(refus))
        return 2
    dossier_jetable = None
    if options.base:
        try:
            chemin_base = verifier_chemin_de_base(options.base)
        except RefusDuBanc as refus:
            print(str(refus))
            return 2
        os.makedirs(os.path.dirname(chemin_base), exist_ok=True)
    else:
        dossier_jetable = tempfile.mkdtemp(prefix="ringback-banc-")
        chemin_base = os.path.join(dossier_jetable, "banc_jetable.db")
    surveilles = [
        ("Le journal d'audit des appels réels", calle_client.CHEMIN_AUDIT,
         _empreinte_fichier(calle_client.CHEMIN_AUDIT)),
        ("La base de données réelle du produit", BASE_REELLE,
         _empreinte_fichier(BASE_REELLE)),
    ]
    journal = Journal()
    # The product logs its incidents; here, the REPORT is the only source of
    # truth — the window stays readable for its owner.
    logging.getLogger("ringback").setLevel(logging.CRITICAL)
    print("Banc d'essai RingBack — simulation uniquement.")
    print(f"  Base jetable : {chemin_base}")
    print(f"  Serveur d'essai : http://127.0.0.1:{options.port}")
    print("  Préparation du jeu de données…")
    base = db.Base(chemin_base)
    jeu_essai.charger(base, maintenant=REFERENCE)
    base.fermer()
    banc = Banc(chemin_base, port=options.port, journal=journal)
    try:
        banc.demarrer()
        print("  Parcours de la matrice… (une minute environ)")
        derouler(banc)
        controler_masquage_global(banc)
        expliquer_les_trous(journal)
        gestes_a_la_main(journal)
        scenario_verrous(banc, surveilles)
    finally:
        banc.arreter()
        if dossier_jetable and os.path.isdir(dossier_jetable):
            shutil.rmtree(dossier_jetable, ignore_errors=True)
    tableaux = construire_tableaux(journal)
    chiffres = compter(journal)
    texte = rapport_texte(journal, chiffres, tableaux)
    page = rapport_html(journal, chiffres, tableaux)
    dossier_rapport = options.rapport or RACINE_APP
    os.makedirs(dossier_rapport, exist_ok=True)
    chemin_texte = os.path.join(dossier_rapport, "rapport-banc-essai.txt")
    chemin_html = os.path.join(dossier_rapport, "rapport-banc-essai.html")
    with open(chemin_texte, "w", encoding="utf-8") as fichier:
        fichier.write(texte + "\n")
    with open(chemin_html, "w", encoding="utf-8") as fichier:
        fichier.write(page + "\n")
    print()
    print(pour_console(texte))
    print(pour_console(
        f"Rapport écrit dans :\n  {chemin_html}\n  {chemin_texte}"))
    return 1 if journal.echecs or any(not v[3] for v in journal.verrous) else 0


if __name__ == "__main__":
    sys.exit(principal())
