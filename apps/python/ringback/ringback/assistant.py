"""The 3-step campaign assistant — data and engine (specification v1.1).

Eight campaign KINDS (one per discussion sheet), each described by: its icon,
its usage sentence, its default calling policy, its general information (⛔ =
mandatory, moving on to step 3 is refused server-side as long as it is
missing), its contact fields (the columns of step 3's grid — Identity and Phone
can never be removed) and its mission template in segments (a conditional `si`
segment only enters the text when its information is filled in).

The module also carries:
- building the mission (the same rules as the live on-screen preview: the step-2 variables are substituted, the PER-CONTACT variables ([identite], [rdv_existant]…) remain and are filled at every call);
- parsing the multi-column paste (reusing saisie.py's validators);
- the forbidden period (e.g. 8pm → 8am) and the follow-up due date by delay OR by call-back window;
- the execution engine of a `prête` campaign: one call at a time, pause and stop act BETWEEN two calls, everything goes through the existing deterministic SIMULATION engine (calle_client) and through the same locks (planificateur.verifier_garde_fous — never duplicated);
- the CHANGE LOG (§8.1 of CAS_DE_FIGURE_CAMPAGNES.md): a campaign's real deliverable is not `calls placed`, it is the list of changes to be CARRIED OVER into the establishment's scheduling software — ➕ added, ➖ deleted, ↔ moved, 🙋 for a human to handle. Every row is written AT THE MOMENT of the change (noter_changement), never reconstructed afterwards, and comes out readable, copyable and exportable;
- the CASCADING SHIFT (§8.3): when a contact agrees to shift their appointment, the campaign ends and the slot they FREE becomes the slot of a NEW campaign, prepared in the `prête` state — never launched. It replays the origin campaign's RECIPE (kind, message, options, order, contact source, fields): only the slot changes, and the list is recomputed for that slot. Contacts whose appointment is EARLIER than the new slot are set aside — it is that tightening that makes the chain converge (see CASCADE_PROFONDEUR_MAX).

Nothing here is mimed: every display in the interface comes from the database
or from the real draft; what is not built is marked `à venir` on screen.
"""

import csv
import datetime
import io
import json
import logging
import re
import unicodedata

from . import (calle_client, campagnes, consigne, db, generation, horaires,
               langue as mod_langue,
               planificateur, saisie, themes)
from .saisie import SaisieInvalide

journal = logging.getLogger("ringback.assistant")

# ------------------------------------------------------- setting keys
CLE_INTERDIT_DEBUT = "interdit_debut"  # `HH:MM` — forbidden period
CLE_INTERDIT_FIN = "interdit_fin"                # (vide = aucune)
CLE_RELANCE_MODE = "relance_mode"                # « delai » | « creneau »
CLE_RELANCE_CRENEAU_DEBUT = "relance_creneau_debut"  # « HH:MM »
CLE_RELANCE_CRENEAU_FIN = "relance_creneau_fin"

# ---------------------------------------------------------------------------
# THE TWO INPUT MODES — `simplified` and `advanced`
# ---------------------------------------------------------------------------
# Owner's request (02/08/2026): the campaign forms show too much at once.
# SIMPLIFIED mode shows only what has to be filled in; ADVANCED adds what has a
# decent default and is only touched exceptionally (the message preview, the
# expected columns, the agent's speech specific to this campaign).  ⚠ THE MODE
# ONLY CHANGES WHAT YOU SEE, never what is sent: the advanced-mode fields stay
# in the page and go out with the form, with their value from the Settings.
# Switching from one mode to the other can therefore LOSE NOTHING — which is
# the condition for a reduced mode to be safe.
MODE_SIMPLIFIE = "simplifie"
MODE_AVANCE = "avance"
MODES_FORMULAIRE = {MODE_SIMPLIFIE: "Simplifié", MODE_AVANCE: "Avancé"}


def mode_formulaire(preferences=None):
    """ALWAYS `simplified` when a campaign form opens.

    The choice used to be remembered from one campaign to the next. The owner
    decided on 02/08/2026: `always select the simplified forms by default for
    campaigns`. A screen that opens in advanced mode because you switched to it
    yesterday surprises more than it helps.

    The toggle stays whole WITHIN the page: switching to advanced shows
    everything there, and nothing is lost — the advanced-mode fields are in the
    form whatever the mode. The `preferences` parameter is kept so as not to
    make every caller change over a setting that might come back.
    """
    return MODE_SIMPLIFIE

# --------------------------------------------------------------- kinds The
# dictionary's order is the order of step 1's eight cards. infos: (code, label,
# type, mandatory ⛔) — type `texte`, `date`, `long` (a multi-line box) or
# `oui_non`. champs: (code, label, type, mandatory ⛔, locked) — locked = never
# removable (Identity and Phone, the owner's rule). gabarit: a list of
# segments; a segment is a text, or a dictionary {"texte": …, "si": code}
# included only when the information is filled in.  THE THREE-PART BRIEFING
# (owner's decision, 01/08/2026) — what the template produces is the OPENING,
# the only passage spoken word for word. Two more keys accompany it to the
# agent: objectif: what we are trying to obtain, in one French sentence; issues
# : the only three possible conclusions (yes / no / other) and their
# translation into the code the result schema imposes. `other` always carries
# the nuance in clear in `notes`. genre   : `cascade` when the call goes out
# with the cascade schema (outcome: accepted/refused/moved), `classique`
# otherwise (appointment_status: confirmed/rescheduled/canceled/to_reschedule).
# The complete correspondence, kind by kind, is written in
# FICHES_DISCUSSION.md.

_CHAMPS_SOCLE = (
    {"code": "identite", "libelle": "Identité (civilité + nom)",
     "type": "texte", "obligatoire": True, "verrouille": True},
    {"code": "telephone", "libelle": "Téléphone",
     "type": "texte", "obligatoire": True, "verrouille": True},
)


def _champ(code, libelle, type_champ="texte", obligatoire=False):
    return {"code": code, "libelle": libelle, "type": type_champ,
            "obligatoire": obligatoire, "verrouille": False}


def _info(code, libelle, type_info="texte", obligatoire=False, reglage=None,
          sous_option=None, multiple=False):
    """reglage: the preferences key whose value pre-fills the field.

    sous_option: the code of a behaviour OPTION of which this information is
    the detail. It is then not displayed with the other general information: it
    appears UNDER its checkbox, and only when the box is ticked (cascading
    disclosure — we never show the settings of an option that was not taken).

    multiple: the information can be entered SEVERAL times (a list of slots,
    03/08/2026). The field keeps its type and its name — it is the SAME
    `info_<code>` that goes out, simply repeated. The draft keeps the whole
    list in `creneaux` and its FIRST value in `infos`, so that everything that
    read a single value goes on reading it.
    """
    return {"code": code, "libelle": libelle, "type": type_info,
            "obligatoire": obligatoire, "reglage": reglage,
            "sous_option": sous_option, "multiple": multiple}


# ------------------------------------------- cancellation during the call THE
# OWNER'S RULE, word for word (31/07/2026): `if an appointment is cancelled,
# either it is rebooked directly during the exchange, in which case it is
# simply a move; or no appointment is set yet and we create a status "the
# client calls us back". All that will have to be stated in the prompt so we
# know when the bot may offer appointments in case of a cancellation.`  Hence
# ONE campaign option, and it alone, which decides what the agent is allowed to
# do — and which CHANGES THE TEXT dictated to the agent: - ticked: it offers
# the GENUINELY free slots (recomputed at the instant of the call, never a
# formula date). The client takes one → it is a MOVE (outcome `rescheduled`,
# log ↔). They take none → `le client rappellera`; - unticked: it offers
# nothing and concludes `you call us back whenever you like` → `le client
# rappellera`. In both cases, the `le client rappellera` state triggers NEITHER
# a follow-up NOR a campaign: it is the client who gets back in touch.
CLE_REPLACER_ANNULATION = "replacer_annulation"
INFO_CRENEAUX_ANNULATION = "creneaux_annulation"

# An option's code ↔ the id of its checkbox in step 2. The live preview uses it
# to read the box back without reloading the page: what the screen shows is
# therefore exactly what the server will build.
CASES_OPTIONS = {CLE_REPLACER_ANNULATION: "opt_replacer"}

# The contact of a campaign who cancelled without rebooking: their place in the
# states table (assistant.ETATS) and in the clients' one.
ETAT_RAPPELLERA = "le client rappellera"

# THE STATE THAT WAS MISSING, and that cost a real call on 01/08/2026: his
# phone rang, he picked up, he accepted the new slot — and RingBack wrote
# `injoignable` because CALL-E's answer had not come back in time. It is
# neither `injoignable` (his phone DID ring), nor `à recontacter` (calling back
# would ring twice for nothing): the truth is that the call TOOK PLACE and that
# its result is not known. The contact keeps their call's CALL-E id; the `📥
# Récupérer les résultats en attente` gesture will read it and apply it.
ETAT_RESULTAT_INCONNU = "appelé, résultat inconnu"

# ⚠ THE OPENING NO LONGER RECITES THE DATES (31/08/2026, his request, noted on
# a REAL call): `before I even confirmed whether I would be there, it
# immediately listed the various dates for moving the appointment. It must
# first wait for the client to say no before offering a date.`  WHAT THAT
# PRODUCED, word for word, in his transcript of 31/08: six dates read out in a
# row BEFORE the question `can I count on you being there?`. The person had not
# said anything yet. They ended up answering `none` — to a question they had
# not been asked.  The slots stay INSIDE `what you know` (see
# _INFO_CRENEAUX_ANNULATION): the agent knows them, and the conduct below tells
# it WHEN to bring them out. What is said when no other date will be offered —
# two cases, one text: the box unticked, or the calendar with no free slot. The
# client hears the same thing, and rightly so: from their side, the difference
# does not exist.
SANS_AUTRE_DATE = (" Si vous ne pouvez plus venir, j'annule votre "
                   "rendez-vous, et je ne vous propose pas d'autre date "
                   "aujourd'hui : c'est vous qui nous rappelez quand vous "
                   "voulez — nous ne vous relancerons pas.")

# ⚠ THE FUNNEL — HIS METHOD, AND IT WAS WRITTEN IN ONLY ONE PLACE. His request
# of 16/08, repeated on 31/08: `let it first offer days, then morning or
# afternoon, then let it offer an hour. Depending on the answers, either the
# patient accepts, or they ask to narrow the days and THE FILTER STARTS AGAIN.`
# The move had it since 16/08; the confirmation and the appointment reminder
# did not — they quoted a list and waited. Yet all three do the same thing:
# offer a date to somebody who does not want one yet.  ⚠ THE RESTART WAS
# MISSING FROM ALL THREE. The conduct said what to do when the agent has NO
# matching hour; it said nothing about the commonest case — the person refuses
# the hour offered. The agent then reeled off hours one after another, which is
# exactly the enumeration we are trying to avoid.  ⚠ WRITTEN HERE, AND NOT
# THREE TIMES. A method copied into three kinds diverges at the first touch-up:
# we have measured that often enough in this project not to do it again.
_ENTONNOIR = (
    # ⚠ THE REQUEST FOR A LIST IS THE COMMONEST CASE, and it was missing
    # (04/09/2026). His real test: `Do you have other appointments?` — that is
    # NOT a refusal, so the funnel did not trigger. The agent applied the
    # neighbouring rule (`repeating what you know is never a reason to hand
    # over`) and recited the ten slots, while the field carrying them is called
    # `stock, NOT RECITED`. Two instructions contradicted each other; it
    # decided, and it was not wrong.
    "si elle demande ce que tu as d'autre — « avez-vous d'autres dates ? », "
    "« qu'est-ce qui reste ? » — NE RÉCITE PAS la liste : réponds « oui, j'ai "
    "d'autres disponibilités » et enchaîne tout de suite sur la question "
    "suivante. Une liste récitée n'aide personne à choisir ;",
    "si elle ne convient pas, demande quels JOURS de la semaine "
    "l'arrangeraient ;",
    "demande ensuite si elle préfère le MATIN ou l'APRÈS-MIDI ;",
    "propose alors UNE SEULE heure, prise dans les créneaux disponibles "
    "ci-dessus, qui corresponde à ce jour et à ce moment de la journée ; si "
    "tu n'en as aucune qui corresponde, dis-le simplement ;",
    "⚠ à chaque refus, REPRENDS LE FILTRE au lieu d'enchaîner les heures : "
    "redemande quels jours l'arrangeraient, puis matin ou après-midi, puis "
    "propose une heure. Une heure à la fois, jamais une liste — c'est la "
    "personne qui restreint, pas toi qui énumères ;",
)


_SEGMENTS_ANNULATION = (
    # ⚠ WE ONLY PROMISE ANOTHER DATE WHEN WE HAVE ONE. The box being ticked is
    # not enough: slots must genuinely be free. Without this second guard, the
    # agent announced `I can offer you another date` in front of a full
    # calendar.
    {"texte": " Si vous ne pouvez plus venir, je peux vous proposer une autre "
              "date ; sinon j'annule votre rendez-vous et c'est vous qui nous "
              "rappelez quand vous voulez — nous ne vous relancerons pas.",
     "si_option": CLE_REPLACER_ANNULATION, "si": INFO_CRENEAUX_ANNULATION},
    {"texte": SANS_AUTRE_DATE,
     "si_option": CLE_REPLACER_ANNULATION, "sauf": INFO_CRENEAUX_ANNULATION},
    {"texte": SANS_AUTRE_DATE, "sauf_option": CLE_REPLACER_ANNULATION},
)

# ---------------------------------------------------------------------------
# EVERY OPENING ENDS ON A QUESTION
# ---------------------------------------------------------------------------
# Owner's request (02/08/2026): `the possibility to answer, but oriented
# towards obtaining an answer`. A text ending on an explanation leaves a
# silence; a text ending on a question calls for an answer — and an answer is
# what is needed, since the agent must conclude on one of the three outcomes.
# The question is the LAST segment, after the conditional sentences: whatever
# the options, it is what is heard last.

_INFO_CRENEAUX_ANNULATION = _info(
    INFO_CRENEAUX_ANNULATION,
    "Places libres à proposer en cas d'annulation (calculées ; vide = "
    "l'agent n'annonce aucune date)",
    "long", reglage="creneaux_lisibles",
    sous_option=CLE_REPLACER_ANNULATION)


NATURES = {
    "creneau_libere": {
        "icone": "📞", "nom": "Créneau libéré",
        "phrase": "« Une place s'est libérée, je remplis le trou »",
        "politique": "premier_oui",
        "politique_libelle": "séquentiel, arrêt au premier OUI",
        "politique_modifiable": True,
        # ⚠ THE FURTHEST APPOINTMENT FIRST (owner's decision of 03/08/2026,
        # which REPLACES the opposite rule from before). The reason: it is that
        # person who has the most to gain from moving forward onto the slot
        # that comes free. Somebody whose appointment is already near would
        # gain almost nothing — calling them first means spending a call for a
        # small gain, and taking the slot from somebody it would relieve.
        "ordre_defaut": "eloignement",
        # The only kind that goes out with the CASCADE schema: it offers a slot
        # that has just come free, and the campaign stops at the first yes (see
        # en_cascade in _appeler_contact).
        "genre": consigne.GENRE_CASCADE,
        "objectif": ("savoir si la personne prend la place qui vient de se "
                     "libérer, à la place de son rendez-vous actuel"),
        "issues": {
            "oui": consigne.issue(
                "accepted", "la personne prend la place qui s'est libérée"),
            "non": consigne.issue(
                "refused", "elle décline la proposition et son rendez-vous "
                           "actuel reste inchangé"),
            # ⚠ NO MORE `CALLED BACK BY A HUMAN` HERE (11/08/2026, owner's
            # decision): on a freed slot, the slot goes to somebody else within
            # the minute — promising a call-back would be promising a call that
            # would no longer have a purpose. See NATURES_RAPPEL_HUMAIN.
            "autre": consigne.issue(
                "moved", "tout le reste : elle souhaite une autre date, elle "
                         "ne peut pas se décider maintenant, ou elle pose "
                         "une question à laquelle tu n'as pas la réponse",
                # THE FALLBACK WITH NO DATE, which was missing from this kind —
                # and from it alone. Without it, the agent returned `moved`
                # with no date and RingBack declared the answer unreadable
                # (02/08/2026).
                code_sans_date="to_reschedule", date="facultative"),
        },
        "infos": (
            _info("entreprise", "Nom de l'entreprise", obligatoire=True,
                  reglage=themes.CLE_ENTREPRISE),
            _info("creneau_libere", "Créneau libéré (date et heure)",
                  "date", obligatoire=True, multiple=True),
            _info("lieu", "Lieu (si plusieurs)"),
            _info("duree", "Durée de la prestation"),
            _info("consignes", "Consignes (ex. « venir à jeun »)"),
        ),
        "champs": (
            _champ("rdv_existant", "Rendez-vous existant (date + heure)",
                   "date", obligatoire=True),
            _champ("motif", "Motif", obligatoire=True),
        ),
        "gabarit": (
            "Bonjour [identite], je suis l'assistant de [entreprise]. "
            "Une place s'est libérée le [creneau_libere] pour votre [motif].",
            {"texte": " La séance dure [duree].", "si": "duree"},
            {"texte": " Cela se passe à [lieu].", "si": "lieu"},
            {"texte": " À noter : [consignes].", "si": "consignes"},
            " Souhaitez-vous en profiter pour avancer votre rendez-vous "
            "du [rdv_existant] ?",
        ),
    },
    "rappel_rdv": {
        "icone": "🔔", "nom": "Rappel de rendez-vous",
        "phrase": "« Je rappelle leurs rendez-vous de demain »",
        "politique": "tous",
        "politique_libelle": "tout le monde est appelé",
        "politique_modifiable": False,
        # We call back first those whose appointment is nearest: they are the
        # only ones it is still useful to warn.
        "ordre_defaut": "proximite",
        "genre": consigne.GENRE_CLASSIQUE,
        "objectif": ("t'assurer que la personne a bien son rendez-vous en "
                     "tête, et savoir si elle le maintient"),
        # ⚠ QUOTE NO DATE BEFORE HAVING THE ANSWER (31/08/2026, his request,
        # noted on a REAL call): `before I even confirmed whether I would be
        # there, it immediately listed the various dates […] It must first wait
        # for the client to say no before offering a date.`  The opening no
        # longer recites them (see _SEGMENTS_ANNULATION); the agent still knows
        # them, they are in `what you know`. This conduct tells it WHEN to
        # bring them out — and in small batches: his transcript of 31/08 lined
        # up six in a row, and the person answered `none`.
        "conduite": (
            "pose D'ABORD ta question et attends la réponse : sera-t-elle "
            "présente, oui ou non ? Ne cite AUCUNE date tant qu'elle n'a pas "
            "répondu ;",
            "si elle confirme sa présence, remercie et conclus : il n'y a "
            "rien d'autre à obtenir, et proposer une autre date sèmerait le "
            "doute ;",
            "si elle ne peut pas venir ET que « ce que tu sais » porte des "
            "places libres, propose-lui UNE date pour commencer — la plus "
            "proche, pas la liste ;",
        ) + _ENTONNOIR + (
            "si rien ne lui convient, ou si tu n'as aucune place à proposer, "
            "dis-lui simplement que son rendez-vous est annulé et que c'est "
            "elle qui rappellera quand elle voudra.",
        ),
        "issues": {
            "oui": consigne.issue(
                "confirmed", "elle maintient son rendez-vous et sera présente"),
            "non": consigne.issue(
                "canceled", "elle annule son rendez-vous et n'en fixe pas "
                            "d'autre pendant l'appel"),
            # No `called back by a human`: see NATURES_RAPPEL_HUMAIN. Here the
            # appointment is THEIRS — they can call us back themselves, and
            # that is what the state `le client rappellera` says.
            "autre": consigne.issue(
                "rescheduled",
                "tout le reste : elle veut déplacer son rendez-vous, elle "
                "préfère rappeler elle-même, ou elle pose une question à "
                "laquelle tu n'as pas la réponse",
                code_sans_date="to_reschedule", date="facultative"),
        },
        "infos": (
            _info("entreprise", "Nom de l'entreprise", obligatoire=True,
                  reglage=themes.CLE_ENTREPRISE),
            _info("lieu", "Lieu (si plusieurs)"),
            _info("consignes", "Consigne générale (ex. « venir à jeun »)"),
            _info("proposer_annulation",
                  "Demander en fin d'appel si le rendez-vous doit être annulé",
                  "oui_non"),
            _INFO_CRENEAUX_ANNULATION,
        ),
        "champs": (
            _champ("rdv_existant", "Rendez-vous (date + heure)",
                   "date", obligatoire=True),
            _champ("motif", "Motif", obligatoire=True),
            _champ("consigne", "Consigne propre au contact"),
        ),
        "gabarit": (
            "Bonjour [identite], je suis l'assistant de [entreprise]. "
            "Je vous appelle pour vous rappeler votre rendez-vous "
            "du [rdv_existant] pour [motif].",
            {"texte": " Cela se passe à [lieu].", "si": "lieu"},
            {"texte": " Pensez-y : [consignes].", "si": "consignes"},
            " Pensez à : [consigne].",
            {"texte": " Pour finir : souhaitez-vous maintenir ce rendez-vous, "
                      "ou faut-il l'annuler ? Si vous l'annulez, je libère la "
                      "place pour quelqu'un d'autre.",
             "si": "proposer_annulation"},
        ) + _SEGMENTS_ANNULATION + (
            " Alors, puis-je noter que vous serez bien là ?",
        ),
    },
    "confirmation": {
        "icone": "✅", "nom": "Confirmation de rendez-vous",
        "phrase": "« J'exige une réponse ferme »",
        "politique": "tous",
        "politique_libelle": "tout le monde ; non-réponse → relance",
        "politique_modifiable": False,
        # ⚠ THE LIST'S ORDER, SET BY DEFAULT (20/08/2026, his request — the
        # same one as for the move on 16/08). The screen showed `— to be chosen
        # —`, and an unchosen order is one more mandatory field on every
        # campaign. Here it goes without saying: we are confirming the
        # appointments of a day or a range we have just designated, so they are
        # ALREADY in the order we want to handle them. The other two orders
        # stay available — it is a default, not a constraint.
        "ordre_defaut": "liste",
        "genre": consigne.GENRE_CLASSIQUE,
        "objectif": ("obtenir une réponse FERME : la personne sera-t-elle "
                     "présente à son rendez-vous, oui ou non"),
        # ⚠ QUOTE NO DATE BEFORE HAVING THE ANSWER (31/08/2026, his request,
        # noted on a REAL call): `before I even confirmed whether I would be
        # there, it immediately listed the various dates […] It must first wait
        # for the client to say no before offering a date.`  The opening no
        # longer recites them (see _SEGMENTS_ANNULATION); the agent still knows
        # them, they are in `what you know`. This conduct tells it WHEN to
        # bring them out — and in small batches: his transcript of 31/08 lined
        # up six in a row, and the person answered `none`.
        "conduite": (
            "pose D'ABORD ta question et attends la réponse : sera-t-elle "
            "présente, oui ou non ? Ne cite AUCUNE date tant qu'elle n'a pas "
            "répondu ;",
            "si elle confirme sa présence, remercie et conclus : il n'y a "
            "rien d'autre à obtenir, et proposer une autre date sèmerait le "
            "doute ;",
            "si elle ne peut pas venir ET que « ce que tu sais » porte des "
            "places libres, propose-lui UNE date pour commencer — la plus "
            "proche, pas la liste ;",
        ) + _ENTONNOIR + (
            "si rien ne lui convient, ou si tu n'as aucune place à proposer, "
            "dis-lui simplement que son rendez-vous est annulé et que c'est "
            "elle qui rappellera quand elle voudra.",
        ),
        "issues": {
            "oui": consigne.issue(
                "confirmed", "elle confirme fermement qu'elle sera présente"),
            "non": consigne.issue(
                "canceled", "elle annule son rendez-vous et n'en fixe pas "
                            "d'autre pendant l'appel"),
            # No `called back by a human`: see NATURES_RAPPEL_HUMAIN.
            "autre": consigne.issue(
                "rescheduled",
                "tout le reste : elle veut déplacer son rendez-vous, elle "
                "hésite sans pouvoir se décider, elle préfère rappeler "
                "elle-même, ou elle pose une question à laquelle tu n'as pas "
                "la réponse",
                code_sans_date="to_reschedule", date="facultative"),
        },
        "infos": (
            _info("entreprise", "Nom de l'entreprise", obligatoire=True,
                  reglage=themes.CLE_ENTREPRISE),
            _info("lieu", "Lieu (si plusieurs)"),
            _info("consignes", "Consignes"),
            _INFO_CRENEAUX_ANNULATION,
        ),
        "champs": (
            _champ("rdv_existant", "Rendez-vous (date + heure)",
                   "date", obligatoire=True),
            _champ("motif", "Motif", obligatoire=True),
        ),
        "gabarit": (
            "Bonjour [identite], je suis l'assistant de [entreprise]. "
            "Je vous appelle au sujet de votre rendez-vous du [rdv_existant] "
            "pour [motif] : merci de me confirmer votre présence.",
            {"texte": " Cela se passe à [lieu].", "si": "lieu"},
            {"texte": " À noter : [consignes].", "si": "consignes"},
        ) + _SEGMENTS_ANNULATION + (
            " Puis-je compter sur votre présence, oui ou non ?",
        ),
    },
    "deplacement": {
        "icone": "📆", "nom": "Déplacement de rendez-vous",
        "phrase": "« Je dois déplacer des rendez-vous »",
        # ⚠ EVERYBODY IS CALLED, AND A YES STOPS NOTHING (16/08/2026). It was
        # `stop at the first yes`, based on a §8.2 I had written myself and
        # marked `my proposal, to be confirmed` — never confirmed, and wrong.
        # His sentence reverses it in one line: `we select an afternoon and we
        # say: for that afternoon, we move the appointments. It is obvious that
        # we must not move only the first person who accepts, but ALL the
        # appointments we had selected.`  WHERE THE MISTAKE CAME FROM:
        # confusion with `créneau libéré`. There, there is ONE gap to fill —
        # the first yes is enough, disturbing the following ones brings
        # nothing. Here, there are N appointments to CLEAR out of a range:
        # every person not called is an appointment that stays in place. Two
        # neighbouring kinds, two opposite needs.  WHAT THAT COST: his campaign
        # stopped at the first contact — 1 accepted, 2 `not called`, observed
        # on screen.  Stopping at the first yes stays AVAILABLE
        # (politique_modifiable): it serves the rare case where one person is
        # enough.
        "politique": "tous",
        "politique_libelle": "tout le monde est appelé ; rien n'est supprimé "
                             "avant accord",
        "politique_modifiable": True,
        # ⚠ THE LIST'S ORDER, SET BY DEFAULT (16/08/2026, his request). The
        # screen showed `— to be chosen —`, and an unchosen order is one more
        # mandatory field on every campaign. Here it goes without saying: the
        # appointments to move come from a day or a range we have designated,
        # so they are ALREADY in the order we want to handle them. The other
        # two orders stay available — it is a default, not a constraint.
        "ordre_defaut": "liste",
        "genre": consigne.GENRE_CLASSIQUE,
        "objectif": ("faire accepter à la personne l'un des créneaux de "
                     "remplacement, parce que son rendez-vous actuel ne peut "
                     "pas être tenu"),
        # ⚠ `yes` here means `confirmed` WITH the date chosen: it is that pair
        # which _appliquer_resultat turns into a real MOVE of the appointment
        # (see _deplacer_le_rendezvous). With no date, nothing could be
        # written.
        "issues": {
            "oui": consigne.issue(
                "confirmed", "elle accepte l'un des créneaux de remplacement "
                             "que tu proposes",
                date="obligatoire"),
            "non": consigne.issue(
                "canceled", "aucun créneau ne lui convient et elle préfère "
                            "annuler son rendez-vous"),
            "autre": consigne.issue(
                "rescheduled",
                "tout le reste : elle propose un autre moment que ceux que tu "
                "annonces, elle ne peut rien fixer aujourd'hui, ou elle "
                "demande à être rappelée par un humain",
                code_sans_date="to_reschedule", date="facultative"),
        },
        "infos": (
            _info("entreprise", "Nom de l'entreprise", obligatoire=True,
                  reglage=themes.CLE_ENTREPRISE),
            _info("raison", "Raison simple et honnête "
                            "(ex. « un imprévu dans notre planning »)"),
            # ⚠ TWO FIELDS WHERE THERE WAS ONE (16/08/2026, his request). The
            # opening message named the WHOLE list — `I have several slots:
            # 17/08 at 09:00, 17/08 at 09:20, …`. Nobody listens to an
            # enumeration on the phone, and the six slots followed one another
            # anyway: one `no` swept them all away. Now the opening names ONE
            # date, the nearest; the list becomes the STOCK the agent draws on
            # to negotiate — it stays in `what you know`, never recited.
            _info("creneau_le_plus_proche", "Créneau proposé en premier "
                                            "(le plus proche)",
                  reglage="creneau_le_plus_proche"),
            _info("creneaux_remplacement",
                  "Créneaux disponibles pour négocier (stock, non récité)",
                  "long", obligatoire=True, reglage="creneaux_lisibles"),
        ),
        "champs": (
            _champ("rdv_existant", "Rendez-vous actuel (date + heure)",
                   "date", obligatoire=True),
            _champ("motif", "Motif", obligatoire=True),
        ),
        # ⚠ THE CONDUCT OF THE EXCHANGE, IN FIVE STEPS — his request, word for
        # word: `The agent can then start by offering the nearest date; if
        # refused: which days of the week suit the person; it then asks whether
        # the person prefers morning or afternoon; it then offers a slot
        # matching days + time as expected, and if it has none it asks whether
        # another day would do; after 3 refusals, we politely announce that
        # since we cannot arrange an appointment, somebody from [company] will
        # call them back.`  It is a conduct, not a constraint: it says HOW to
        # lead, where the constraints say what is never done. Hence its own
        # block in the briefing (see consigne.Consigne.texte_contexte).
        "conduite": (
            "commence par proposer LA date la plus proche, celle qui est "
            "écrite en « créneau proposé en premier » — une seule date, pas "
            "la liste ;",
        ) + _ENTONNOIR + (
            # ⚠ THREE, AND WE STOP. Without that bound, the agent chains offers
            # until it becomes irritating: `never insist` is already a
            # constraint of the product, this one gives it a precise count.
            "au bout de TROIS propositions refusées, n'insiste plus : "
            "« Je ne veux pas vous retenir plus longtemps. Puisque nous "
            "n'arrivons pas à trouver un moment qui vous convienne, une "
            "personne de [entreprise] va vous rappeler pour convenir d'une "
            "date avec vous. Merci de votre patience, et bonne journée. » ; "
            "conclus alors sur AUTRE, sans date.",
        ),
        "gabarit": (
            "Bonjour [identite], je suis l'assistant de [entreprise].",
            {"texte": " En raison de [raison], nous", "si": "raison"},
            {"texte": " Nous", "sauf": "raison"},
            " devons déplacer votre rendez-vous du [rdv_existant] pour "
            "[motif].",
            # ⚠ NO ARTICLE BEFORE THE DATE. `horaires._en_toutes_lettres`
            # already returns `le mardi 25 août 2026 à 9 heures`: writing
            # `proposer le [créneau]` would give `proposer le le mardi…`.
            # Observed while reading the briefing actually produced — not while
            # rereading the template. (It was `themes.date_lisible` before
            # 24/08/2026; the article itself has not moved.)
            {"texte": " Je peux vous proposer [creneau_le_plus_proche] — "
                      "est-ce que cela vous conviendrait ?",
             "si": "creneau_le_plus_proche"},
            {"texte": " Quels moments vous conviendraient ?",
             "sauf": "creneau_le_plus_proche"},
        ),
    },
    "prise_rdv": {
        "icone": "🗓", "nom": "Prise de rendez-vous",
        "phrase": "« On m'a demandé un rendez-vous, je le fixe »",
        "politique": "tous",
        "politique_libelle": "tout le monde ; pas joint → relance, "
                             "origine conservée",
        "politique_modifiable": False,
        "genre": consigne.GENRE_CLASSIQUE,
        "objectif": ("fixer un rendez-vous avec la personne, parmi les "
                     "créneaux dont tu disposes"),
        "issues": {
            "oui": consigne.issue(
                "confirmed", "un rendez-vous est fixé",
                date="obligatoire"),
            "non": consigne.issue(
                "canceled", "elle ne veut pas de rendez-vous"),
            # ⚠ THE ONLY KIND, ALONG WITH THE MOVE, WHERE THE SENTENCE REMAINS
            # (11/08/2026) — and it was MISSING there: the contact did go to `à
            # rappeler par un humain`, but the agent was not allowed to offer
            # it. Here a human has real work: finding a date. ⚠ THEY OFFER
            # THEIR OWN TIME, AND IT IS A YES (24/08/2026). The simulation
            # PLAYED this ending — `rescheduled` is in this kind's sequence —
            # and the product knows how to absorb it: measured, it creates the
            # appointment at the date offered, contact `accepté`. But the
            # briefing never ASKED for it: the agent was only allowed to return
            # `to_reschedule`. So a date agreed on the phone went back into a
            # human call-back — to re-fix what had just been fixed.  The same
            # shape as `déplacement`: the date decides. With it, the
            # appointment is placed; without it, a human takes over.
            "autre": consigne.issue(
                "rescheduled",
                "tout le reste : elle préfère un moment qui n'est pas dans "
                "tes créneaux, elle demande à être rappelée par un humain, "
                "elle dit n'avoir rien demandé, ou elle pose une question à "
                "laquelle tu n'as pas la réponse",
                code_sans_date="to_reschedule", date="facultative"),
        },
        "infos": (
            _info("entreprise", "Nom de l'entreprise", obligatoire=True,
                  reglage=themes.CLE_ENTREPRISE),
            _info("origine", "Origine de la demande (ex. « vous avez demandé "
                             "un rendez-vous sur notre site »)",
                  obligatoire=True),
            _info("creneaux_proposes", "Créneaux disponibles à proposer",
                  "long", obligatoire=True, reglage="creneaux_lisibles"),
            _info("duree", "Durée"),
            _info("lieu", "Lieu"),
        ),
        "champs": (
            _champ("motif", "Motif souhaité (si fourni)"),
        ),
        "gabarit": (
            "Bonjour [identite], je suis l'assistant de [entreprise]. "
            "[origine] — je vous appelle pour fixer ce rendez-vous.",
            " Le motif noté : [motif].",
            " J'ai comme disponibilités : [creneaux_proposes]. "
            "Qu'est-ce qui vous arrange ?",
            {"texte": " La séance dure [duree].", "si": "duree"},
            {"texte": " Cela se passe à [lieu].", "si": "lieu"},
        ),
    },
}

# ⚠ THREE KINDS REMOVED on 03/08/2026, at the owner's request, and our own
# measurements proved him right:  · ☎ `Rappel d'appel manqué` — its triggering
# state (`tried to reach us`) was NEVER produced by the engine: the bench
# observed it in black and white. And its speech asked an open question (`What
# can I do for you?`) while its outcomes were an appointment's: the agent could
# not conclude cleanly. · 🎯 `Contact unique avec sujet` and ✍ `Personnalisé` —
# no writing into the appointment book, no fields, and outcomes cut for an
# appointment pasted onto `ask for a quote`. `Personnalisé` did not even have a
# template.  The five that remain form a whole: they ALL act on the appointment
# book and return outcomes it knows how to absorb.  They stay READABLE: an
# existing database may carry campaigns of those kinds, and a campaign you can
# no longer name would be lost data. You simply cannot create any more.
NATURES_RETIREES = {
    "appel_manque": {"icone": "☎", "nom": "Rappel d'appel manqué"},
    "contact_unique": {"icone": "🎯", "nom": "Contact unique avec sujet"},
    "personnalise": {"icone": "✍", "nom": "Personnalisé"},
}


def fiche_nature(nature):
    """A kind's record — including the ones no longer created.

    Everything that DISPLAYS a campaign goes through here: without that, a
    campaign of a removed kind would have neither name nor pictogram. Returns
    None for an unknown kind, for the caller to handle.
    """
    return NATURES.get(nature) or NATURES_RETIREES.get(nature)


def nature_creable(nature):
    """True when a campaign of this kind can still be BUILT."""
    return nature in NATURES

POLITIQUES = {
    "premier_oui": "séquentiel — arrêt au premier oui, les suivants épargnés",
    "tous": "appeler toute la liste",
    "unique": "un seul contact",
}

# ⚠ `ANCIENNETE` SAID THE OPPOSITE OF WHAT IT DID. Its label announced `the
# oldest appointment first` and the sorting took the SMALLEST date — hence the
# NEAREST appointment. For upcoming appointments, the smallest is not the
# oldest: it is the most imminent. The label now says what the code does, and
# the key stays the same so as to break nothing (03/08/2026).
ORDRES_APPEL = {
    "liste": "Ordre de la liste",
    "eloignement": "Le rendez-vous le plus LOINTAIN d'abord",
    "anciennete": "Le rendez-vous le plus PROCHE d'abord",
    "proximite": "Proximité du créneau — le plus proche du créneau d'abord",
    "alphabetique": "Alphabétique — par nom",
}

# The only two orders that talk about the appointment's DATE. They are the ones
# the selector above the grid offers: the others make no sense when choosing
# who benefits from a slot that comes free.
ORDRES_PAR_DATE = ("eloignement", "anciennete")

# The states of an assistant campaign's contacts (badge, CSS class).
ETATS = {
    "à appeler": ("⏳", "st-prevu"),
    "en cours": ("📞", "st-prevu"),
    "accepté": ("✅", "st-confirme"),
    "refusé": ("❌", "st-annule"),
    # They cancelled without rebooking: no call will go out for them any more,
    # it is THEY who will get back in touch (the rule of 31/07/2026). ⚠ AND THE
    # PICTOGRAM FOLLOWS THE WORD (21/08/2026). 📞 suggested a call; what
    # happened was a cancellation.
    ETAT_RAPPELLERA: ("❌", "st-annule"),
    "à recontacter": ("🔁", "st-manque"),
    "injoignable": ("📵", "st-ignore"),
    # The call WENT OUT, its result is not (yet) known — see
    # ETAT_RESULTAT_INCONNU. No attempt has been counted against them.
    ETAT_RESULTAT_INCONNU: ("⏱", "st-manque"),
    "à rappeler par un humain": ("🙋", "st-deplace"),
    "exclu": ("🚫", "st-annule"),
    "épargné": ("💤", "st-confirme"),
}

# Step 3's `from the database` filling sources.
SOURCES_BASE = {
    # `poses`: everything that OCCUPIES a slot — scheduled AND confirmed, as
    # the schedule counts them. That is the source you want for a reminder: a
    # confirmed appointment is worth reminding about too. Added on 02/08/2026
    # after a week showing 13 appointments took none of them back.
    "poses": "Rendez-vous posés — prévus ET confirmés (comme au planning)",
    "a_venir": "Rendez-vous à venir, pas encore confirmés",
    "manques": "Rendez-vous manqués (avec date et motif)",
    # ⚠ THE DEFINITION IS IN THE LABEL, in brackets. `En attente` is not a
    # product status: the word means a MOVED appointment whose client took no
    # further step. Writing it out avoids ticking this source believing it also
    # calls back those who already have an appointment (owner's decision of
    # 03/08/2026).
    "a_recaser": ("Rendez-vous annulés, manqués et en attente "
                  "(déplacés sans nouveau rendez-vous)"),
    "annules": "Rendez-vous annulés",
    "deplaces": "Déplacés en attente",
    "tous": "Tous les clients",
}

# THE SAME SOURCES, ARRANGED IN TWO FAMILIES (owner's request, 02/08/2026).
# `Reprendre depuis la base` was a single route mixing two unrelated questions:
# `which appointment DATES?` and `which CLIENTS?`. We change neither the codes
# nor the computation — only the way the question is asked, in three distinct
# routes: ① load the clients (all, or a particular state); ② load by
# appointment dates; ③ load from a previous campaign (unchanged). A code
# removed from here would still be accepted by contacts_depuis_base: the
# recipes already saved therefore go on replaying identically.
SOURCES_RENDEZVOUS = {code: SOURCES_BASE[code]
                      for code in ("poses", "a_venir", "manques", "a_recaser",
                                   "annules", "deplaces")}
# The sources that carry a DATE: they alone accept a period.
SOURCES_DATEES = ("poses", "a_venir", "manques", "a_recaser")

# ⚠ WHAT THE DYNAMIC RULE OFFERS, AND IT IS NARROWER (15/08/2026, his request).
# `Rendez-vous posés — prévus ET confirmés` was removed from HERE, and from
# here only: the source stays available for MANUAL loading, where it makes
# sense (taking a whole day of the schedule), and the recipes already saved go
# on replaying — nothing is broken in the database.  Why remove it from the
# rule: a dynamic rule serves to find WHO to move forward onto a slot that
# comes free. An appointment already CONFIRMED is an agreement obtained; going
# and disturbing it to move it works against yourself. The source `upcoming,
# not yet confirmed` targets exactly the right people, and it becomes the
# default choice.
SOURCES_REGLE = ("a_venir", "manques", "a_recaser")

# ⚠ A TABLE THAT REFUSES WHAT IT DOES NOT KNOW. It had `manqué` as its default
# value: a new code fell into it silently, and the screen announced one source
# while the grid contained another. Adding a source now means adding it HERE
# too — or being refused.
STATUT_PAR_SOURCE_DATEE = {
    "poses": "poses",
    "a_venir": "prévu",
    "manques": "manqué",
    "a_recaser": "a_recaser",
}
SOURCE_TOUS_CLIENTS = "tous"

# Resuming a PREVIOUS CAMPAIGN, filtered by its result's state. Campaign
# results are already in the database (contacts_campagne.etat, written from
# each call's real result): that is what makes it possible to replay `those I
# did not reach`, `those who refused`… with no retyping. It is a FILTER: it is
# shown as drop-down lists, not as radio buttons.
ETATS_REPRISE = {
    "injoignable": "📵 Injoignables",
    "refusé": "❌ Refus",
    "à rappeler par un humain": "🙋 À rappeler par un humain",
    "accepté": "✅ Acceptés",
    "à recontacter": "🔁 À recontacter",
    "tous": "Tous les contacts de la campagne",
}


def option_annulation_utile(nature):
    """True when THIS kind's message changes according to the cancellation option.

    It only makes sense where the client can cancel an existing appointment
    during the call: 🔔 reminder and ✅ confirmation (sheets 2 and 3). Elsewhere
    the box is not shown — we do not offer a setting that would change nothing.
    """
    return any(isinstance(segment, dict)
               and CLE_REPLACER_ANNULATION in (segment.get("si_option"),
                                               segment.get("sauf_option"))
               for segment in NATURES[nature]["gabarit"])


def infos_de_sous_option(nature, option):
    """The step-2 information that is the DETAIL of this option."""
    return [info for info in NATURES[nature]["infos"]
            if info.get("sous_option") == option]


def champs_campagne(brouillon_ou_config):
    """The complete columns (base + kind + custom) of a draft or of a saved
    configuration.
    """
    return list(_CHAMPS_SOCLE) + list(brouillon_ou_config.get("champs", []))


# ---------------------------------------------------------------------------
# WHAT IS MISSING IN THE GRID — one sentence, the colour does the rest
# ---------------------------------------------------------------------------
# Before 02/08/2026, every empty mandatory box produced ITS own error sentence.
# Over ten contacts and three columns, that made thirty identical sentences
# stacked above the grid: unreadable, and without saying WHERE to type. The
# owner decided: one sentence, and the faulty boxes coloured in the grid
# itself.  The colour does NOT light up only after a refusal: it is computed on
# every display, hence from the moment the contacts are imported — you see what
# remains to be done before even trying to validate.
MESSAGE_CHAMPS_OBLIGATOIRES = (
    "Veuillez compléter les champs obligatoires : ils sont encadrés de rouge "
    "dans la grille.")

# Two characters minimum for an identity: `M` or a space names nobody.
LONGUEUR_MINIMALE_IDENTITE = 2


def cellules_manquantes(brouillon):
    """The empty mandatory boxes: {(row number, column code)}.

    The code is the one that NAMES the field in the form: `identite` and
    `telephone` for the two base columns, otherwise the column's code. That is
    what lets the screen colour exactly the right box without redoing the rule
    on its side — one truth, here.

    ⚠ It says NOTHING about orphaned values (those whose column was removed):
    `extra is not a problem` is the owner's rule, and those values stay in
    place to come back should the column come back.
    """
    obligatoires = [champ for champ in champs_campagne(brouillon)
                    if champ["obligatoire"]
                    and champ["code"] not in ("identite", "telephone")]
    manquantes = set()
    for rang, contact in enumerate(brouillon.get("contacts") or [], start=1):
        if len((contact.get("nom") or "").strip()) < LONGUEUR_MINIMALE_IDENTITE:
            manquantes.add((rang, "identite"))
        if not (contact.get("telephone") or "").strip():
            manquantes.add((rang, "telephone"))
        valeurs = contact.get("champs") or {}
        for champ in obligatoires:
            if not str(valeurs.get(champ["code"], "") or "").strip():
                manquantes.add((rang, champ["code"]))
    return manquantes


def verifier_grille(brouillon):
    """The sentence to display when the grid is incomplete (nothing otherwise).

    Called after a column change: changing them while the grid is already
    filled forces a recheck. Returns a LIST (empty, or of a single element) so
    it plugs in without changing anything on `brouillon["erreurs"]`, which
    expects one.
    """
    return ([MESSAGE_CHAMPS_OBLIGATOIRES] if cellules_manquantes(brouillon)
            else [])


def code_champ(libelle):
    """`Numéro de dossier` becomes `numero_de_dossier` (the [code] variable).
    """
    decompose = unicodedata.normalize("NFD", (libelle or "").casefold())
    sans_accents = "".join(c for c in decompose if not unicodedata.combining(c))
    code = re.sub(r"[^a-z0-9]+", "_", sans_accents).strip("_")
    return code or "champ"


# ------------------------------------------------------ forbidden period
def periode_interdite(preferences):
    """The configured forbidden period (`HH:MM`, `HH:MM`) or None when there is
    none.
    """
    debut = (preferences.obtenir(CLE_INTERDIT_DEBUT) or "").strip()
    fin = (preferences.obtenir(CLE_INTERDIT_FIN) or "").strip()
    if debut and fin:
        return debut, fin
    return None


def dans_periode_interdite(preferences, maintenant=None):
    """A French error message when the instant falls within the forbidden period
    (it may cross midnight: 20:00 → 08:00), otherwise None.
    """
    periode = periode_interdite(preferences)
    if periode is None:
        return None
    debut, fin = periode
    if maintenant is None:
        maintenant = datetime.datetime.now()
    heure = maintenant.strftime("%H:%M")
    if debut <= fin:
        dedans = debut <= heure < fin
    else:  # traverse minuit (ex. 20:00 → 08:00)
        dedans = heure >= debut or heure < fin
    if not dedans:
        return None
    return (f"Appel refusé : il est {maintenant:%Hh%M}, nous sommes dans la "
            f"période interdite réglée ({debut.replace(':', ' h ')} → "
            f"{fin.replace(':', ' h ')}) — aucun appel ni relance ne s'y "
            "déclenche, même déclenché à la main. Elle se règle dans "
            "« ⚙ Réglages ».")


def _hors_interdit(moment, preferences):
    """Pushes an instant out of the forbidden period (to its end)."""
    periode = periode_interdite(preferences)
    if periode is None:
        return moment
    debut, fin = periode
    heure = moment.strftime("%H:%M")
    heure_fin, minute_fin = (int(x) for x in fin.split(":"))
    if debut <= fin:
        if debut <= heure < fin:
            return moment.replace(hour=heure_fin, minute=minute_fin)
        return moment
    if heure >= debut:  # evening: the end is the next morning
        return (moment + datetime.timedelta(days=1)).replace(
            hour=heure_fin, minute=minute_fin)
    if heure < fin:  # early morning: the end is the same day
        return moment.replace(hour=heure_fin, minute=minute_fin)
    return moment


def echeance_relance_campagne(preferences, options, maintenant=None):
    """The next follow-up's due date: by delay OR by call-back window.

    options: the campaign's behaviour options (step 2) — they take precedence
    over the ⚙ page's default settings.

    The due date always falls when the practice is WORKING: within the
    permitted calling window, outside the forbidden period, on an open day of
    the typical week and not on a declared closed day. That is the owner's rule
    — `should somebody ask to be called back, an employee can do it`. Both
    modes go through it: the delay in working hours
    (campagnes.echeance_apres_heures_ouvrees, which now knows the settings) and
    the daily call-back window, pushed to the next working day. Returns an ISO
    8601 time to the minute.
    """
    if maintenant is None:
        maintenant = datetime.datetime.now()
    maintenant = maintenant.replace(second=0, microsecond=0)
    mode = options.get("relance_mode") or preferences.obtenir(
        CLE_RELANCE_MODE) or "delai"
    if mode == "creneau":
        debut = (options.get("relance_creneau_debut")
                 or preferences.obtenir(CLE_RELANCE_CRENEAU_DEBUT) or "12:00")
        fin = (options.get("relance_creneau_fin")
               or preferences.obtenir(CLE_RELANCE_CRENEAU_FIN) or "14:00")
        heure = maintenant.strftime("%H:%M")
        heure_debut, minute_debut = (int(x) for x in debut.split(":"))
        if heure < debut:
            echeance = maintenant.replace(hour=heure_debut, minute=minute_debut)
        elif heure < fin:
            echeance = maintenant  # already within the window: due right now
        else:
            echeance = (maintenant + datetime.timedelta(days=1)).replace(
                hour=heure_debut, minute=minute_debut)
        echeance = _prochain_jour_travaille(echeance, preferences)
    else:
        try:
            delai = int(options.get("relance_delai"))
        except (TypeError, ValueError):
            delai, _ = campagnes.parametres_relance(preferences)
        debut_plage, fin_plage = themes.plage(preferences)
        echeance = campagnes.echeance_apres_heures_ouvrees(
            maintenant, delai, debut_plage, fin_plage, preferences)
    return _hors_interdit(echeance, preferences).isoformat(timespec="minutes")


def _prochain_jour_travaille(moment, preferences):
    """Pushes an instant to the next day the practice is WORKING.

    Used by the `daily call-back window` mode: a 12-2pm window must not fall
    due on a Sunday nor on a declared closed day. The window's hour, though, is
    kept as it stands — it is what the user configured. The day rules come from
    campagnes.jour_travaille, which reads them in horaires: nothing is
    duplicated here. Beyond the limit (nothing open for a year), the instant is
    returned UNCHANGED and the log says so — the follow-up stays visible rather
    than lost.
    """
    candidat = moment
    for _ in range(campagnes.JOURS_CHERCHES_ECHEANCE):
        if campagnes.jour_travaille(candidat.date(), preferences):
            return candidat
        candidat += datetime.timedelta(days=1)
    journal.warning(
        "Créneau de rappel : aucun jour ouvert dans les %d prochains jours — "
        "l'échéance reste au jour calculé. Ouvrez des jours dans « ⚙ Réglages ».",
        campagnes.JOURS_CHERCHES_ECHEANCE)
    return moment


def maximum_rappels(preferences, options):
    """The maximum number of reminders: the campaign's, otherwise the settings'.
    """
    try:
        return int(options.get("relance_max"))
    except (TypeError, ValueError):
        _, maximum = campagnes.parametres_relance(preferences)
        return maximum


# ------------------------------------------------------------- the mission
def date_courte(iso):
    """`2026-08-03T14:00` becomes `03/08/2026 à 14h00` (with no `le`)."""
    lisible = themes.date_lisible(iso)
    return lisible[3:] if lisible.startswith("le ") else lisible


def date_chiffree(iso):
    """`2026-08-03T14:00` becomes `03/08/2026 14:00`.

    The format the owner asked for on 11/08/2026, dd/mm/yyyy hh:mm, for a TABLE
    column: dates are compared there from one row to the next, and `à 14h00`
    adds two characters that do not help comparison. Elsewhere — in a sentence,
    in a message spoken on the phone — it is `date_courte` that stays right:
    `le 3 août à 14h00` reads, `03/08/2026 14:00` aligns.

    Returns "" for an empty or unreadable value: never an invented date.
    """
    texte = str(iso or "").strip()
    if not texte:
        return ""
    try:
        quand = datetime.datetime.fromisoformat(texte)
    except ValueError:
        return ""
    return quand.strftime("%d/%m/%Y %H:%M")


def _valeur_lisible(valeur, type_champ, langue_code="fr"):
    """A field's value as it enters THE MESSAGE AND THE BRIEFING.

    ⚠ THIS FUNCTION ONLY SERVES WHAT IS SPOKEN. Its five callers all build text
    meant for the agent: the opening message (construire_mission,
    finaliser_mission), the briefing (construire_consigne, finaliser_consigne)
    and the check `has this message lost a piece of information?`
    (infos_perdues), which compares against the same text. Hence the SPOKEN
    format since 24/08/2026 — `lundi 24 août 2026 à 10 heures 20`.

    ⚠ THE SCREENS KEEP `date_courte`: a table is read in columns, a sentence is
    said out loud. Changing both at once would have lengthened every row of
    every list in the product without anybody asking.
    """
    if type_champ == "date":
        # ⚠ AND IN THE CALL'S LANGUAGE. A French date in the middle of an
        # English briefing would be read out as it stands: `mardi 15 septembre
        # 2026 à 9 heures 40`, pronounced by an English voice, to an
        # English-speaking patient. Measured on 01/09/2026 on the `Créneau
        # libéré` line, which was the last one still French.
        return themes.date_parlee(valeur, langue_code)
    return valeur


def cle_discours(nature):
    """The settings key of THIS kind's opening speech."""
    return f"discours_{nature}"


def cle_comportement(nature):
    """The settings key of THIS kind's behaviour options."""
    return f"comportement_{nature}"


# The behaviour options configurable per kind, and nothing else. A key absent
# from this list is IGNORED on read-back: a setting written by a future
# version, or a forged submission, cannot introduce an option the product does
# not know how to honour.
OPTIONS_COMPORTEMENT = (
    "recontacter", "liberer_creneau", "repondeur_sans_motif", "cascade",
    CLE_REPLACER_ANNULATION,
)

# The DETAIL of the follow-ups, configurable per kind too: ticking
# `Recontacter` without being able to say after how long or how many times
# settled none of what matters (reported on 02/08/2026). These are texts, not
# boxes: they are taken as they stand, never converted into a boolean — hence
# two separate lists.
DETAILS_RELANCE = ("relance_mode", "relance_delai", "relance_max",
                   "relance_creneau_debut", "relance_creneau_fin")

# WHAT THE PRODUCT SHIPS, in one single place. These values were written in
# creer_brouillon_assistant: the Settings screen therefore did not know them
# and showed everything unticked, while the campaign form arrived fully ticked.
# Two screens, two truths — observed on screen on 02/08/2026. There is only one
# now, and both read it.
OPTIONS_LIVREES = {
    "recontacter": True,
    "liberer_creneau": True,
    "repondeur_sans_motif": True,
    # A cancellation during the call: is the agent allowed to offer another
    # date? Yes by default — that is what the discussion sheets describe. The
    # box is only shown for the kinds whose message depends on it (see
    # option_annulation_utile).
    CLE_REPLACER_ANNULATION: True,
    # The cascade, for its part, NEVER arms itself: it prepares one more
    # campaign, and that is a decision.
    "cascade": False,
    "cascade_jusqu_au": "",
}


def relances_generales(preferences):
    """The GENERAL follow-up setting, as campaign options.

    Only one place reads these four values: the Settings screen and the
    creation of a draft therefore show exactly the same thing.
    """
    delai, maximum = campagnes.parametres_relance(preferences)
    return {
        "relance_mode": preferences.obtenir(CLE_RELANCE_MODE) or "delai",
        "relance_delai": str(delai),
        "relance_max": str(maximum),
        "relance_creneau_debut": preferences.obtenir(
            CLE_RELANCE_CRENEAU_DEBUT) or "12:00",
        "relance_creneau_fin": preferences.obtenir(
            CLE_RELANCE_CRENEAU_FIN) or "14:00",
    }


def comportement_regle(nature, preferences, socle=None):
    """(options, policy, order) for a NEW campaign of this kind.

    Three layers, in this order: what the product ships, then the general
    settings (follow-ups), then the setting specific to THIS kind. Requested by
    the owner on 02/08/2026: `the behaviour options must be in the settings for
    the default values according to the campaign type`.

    `socle`: the options already computed by the caller. It is never modified —
    a copy is returned. When it is missing, the general follow-up settings are
    read HERE: without that, the Settings screen showed an EMPTY delay and
    ceiling as long as nothing had been saved, while the campaign form arrived
    filled in. Observed on screen by the owner on 02/08/2026 — two screens, two
    truths, again.

    ⚠ It only applies to FUTURE campaigns: a campaign once created freezes its
    options in its configuration, and changing this setting does not replay
    them.
    """
    definition = NATURES[nature]
    options = dict(OPTIONS_LIVREES)
    options.update(relances_generales(preferences))
    options.update(socle or {})
    politique = definition["politique"]
    # ⚠ NO ORDER IS INVENTED HERE. Two kinds offer one because it goes without
    # saying (oldest for a freed slot, nearest for a reminder); the other six
    # leave the question open, and the screen shows `— to be chosen —`. It is
    # an owner's decision (`offer, do not impose`): a kind's setting may decide
    # it, the product may not.
    ordre = definition.get("ordre_defaut")
    regle = preferences.obtenir(cle_comportement(nature))
    if isinstance(regle, dict):
        for cle in OPTIONS_COMPORTEMENT:
            if cle in regle:
                options[cle] = bool(regle[cle])
        for cle in DETAILS_RELANCE:
            # An empty string means `nothing particular for this kind`: the
            # general setting then applies, and it is already in the base
            # layer.
            if str(regle.get(cle, "")).strip():
                options[cle] = regle[cle]
        if (definition["politique_modifiable"]
                and regle.get("politique") in POLITIQUES):
            politique = regle["politique"]
        if regle.get("ordre") in ORDRES_APPEL:
            ordre = regle["ordre"]
    return options, politique, ordre


def gabarit_nature(nature, options=None):
    """The opening text SHIPPED WITH THE PRODUCT, variables included.

    It is the kind's template, the starting point the Settings offer to rewrite
    and the one you come back to when you cancel your rewrite.

    ⚠ Its conditional segments are RESOLVED (with `options`, the kind's): a
    flattening with no condition showed both branches at once, hence sentences
    contradicting each other. What is read here is what will be said.
    """
    return _segments_retenus(NATURES[nature], {}, options or {})


def discours_regle(nature, preferences):
    """This kind's opening text: yours, otherwise the shipped one.

    A setting added on 02/08/2026 at the owner's request: `in this menu we are
    going to add the AI's speech elements according to the case`. A campaign
    can still rewrite it for itself alone (step ② in advanced mode) — this
    setting gives the STARTING text, common to every campaign of that kind.

    An empty setting means `the one shipped with the product`: clearing the box
    is therefore the way to go back, and there is nothing else to know to get
    there.
    """
    ecrit = (preferences.obtenir(cle_discours(nature)) or "").strip()
    return ecrit or gabarit_nature(nature)


def infos_perdues_par_le_texte(nature, infos, preferences, options, mission):
    """The information the RETYPED message no longer says.

    Returns [(label, readable value)] — empty when the text was not retyped, or
    when it still says everything.

    ⚠ HIS DEFECT NO. 10 OF 18/08/2026, and it is the most insidious in the
    list: he fills in a field, the screen shows it filled in, the campaign
    saves it… and the agent never says it. Measured: message retyped at step 2,
    THEN the reason typed in (`an unforeseen event in our schedule`). It is
    indeed in the campaign, it is not in the message — hence not on the phone.
    Nothing said so.

    ⚠ WE DO NOT REWRITE HIS TEXT, AND THAT IS THE RULE: `a message rewritten by
    hand must go out exactly as he wrote it` (see `construire_consigne`).
    Reinjecting the sentence into it would be worse than silence — it would be
    modifying what a human decided to say. We SAY it, he decides.

    THE COMPARISON IS MADE WITH THE STARTING TEXT, not with the template: a
    piece of information is `lost` when the text RingBack would have written
    said it and his no longer does. That is accurate in both trap cases — a
    speech configured in ⚙ Réglages that takes precedence over the shipped
    template, and a date, which is not written into the message the way it is
    stored (both sides go through the same rendering).
    """
    # ⚠ A REMOVED KIND STAYS READABLE IN THE DATABASE (`personnalisé`, removed
    # on 03/08/2026): a campaign from then has no record any more, so there is
    # nothing to compare. We stay silent rather than raise an error on a screen
    # that only asked to be displayed. `nature_creable` and not `fiche_nature`:
    # the latter ALSO returns the record of removed kinds, so their campaigns
    # stay readable — but their message can no longer be BUILT, and that is
    # precisely what is compared here. The predicate exists, and it says
    # exactly that.
    if not nature_creable(nature):
        return []
    definition = NATURES[nature]
    auto = construire_mission(nature, infos, preferences, options)
    perdues = []
    for info in definition["infos"]:
        valeur = (infos.get(info["code"]) or "").strip()
        if not valeur:
            continue
        lisible = _valeur_lisible(valeur, info["type"])
        if lisible and lisible in auto and lisible not in mission:
            perdues.append((info["libelle"], lisible))
    return perdues


def construire_mission(nature, infos, preferences, options=None):
    """The mission text built from the template, the step-2 information AND its
    options — exactly what the live preview does.

    The step-2 variables that are filled in are substituted (dates in readable
    French); the PER-CONTACT variables ([identite], [rdv_existant]…) stay as
    they are: they are filled at every call. [plage_rappel] comes from the
    settings, as everywhere.

    A segment carries either:
    - `si` / `sauf`: the condition is a step-2 INFORMATION;
    - `si_option` / `sauf_option`: the condition is a behaviour OPTION (a checkbox). That is how the option `offer another date if the contact cancels` really changes what the agent is allowed to say, instead of staying a mute setting.
    """
    definition = NATURES[nature]
    options = options or {}
    types = {info["code"]: info["type"] for info in definition["infos"]}
    # THE CONFIGURED SPEECH TAKES PRECEDENCE over the shipped template. It is
    # taken as it stands: a text written by hand has no conditional segments,
    # hence no sentence to drop here — those whose variable stays empty are
    # removed later, at call time (_sans_phrases_incompletes).
    regle = (preferences.obtenir(cle_discours(nature)) or "").strip()
    if regle:
        # ⚠ A SPEECH CONFIGURED BY HAND IS NEVER TRANSLATED. It is the exact
        # same rule as for a rewritten campaign message: the text belongs to
        # whoever wrote it, and translating it would have a sentence nobody
        # proof-read spoken on the phone.
        return _remplir(regle, infos, types, preferences)
    return _remplir(
        _segments_retenus(definition, infos, options,
                          mod_langue.traducteur(
                              mod_langue.de_preferences(preferences))),
        infos, types, preferences)


def _segments_retenus(definition, infos, options, dire=None):
    """The template's text, with its conditional segments RESOLVED.

    Two segments that exclude each other (`si raison` / `sauf raison`) must
    never come out together: flattened with no condition, they gave `En raison
    de …, nous Nous devons déplacer`, and two contradictory sentences in a row
    in the appointment reminder. Observed by the owner on 02/08/2026 in the
    Settings preview.
    """
    # ⚠ WE TRANSLATE SEGMENT BY SEGMENT, BEFORE GLUING THEM. Translating the
    # assembled sentence would be impossible: it depends on the conditions,
    # hence on the step-2 information and the options — thousands of
    # combinations. The segments, on the other hand, are finite in number and
    # written once.
    dire = dire or (lambda texte: texte)
    morceaux = []
    for segment in definition["gabarit"]:
        if isinstance(segment, str):
            morceaux.append(dire(segment))
            continue
        if _segment_retenu(segment, infos, options):
            morceaux.append(dire(segment["texte"]))
    return "".join(morceaux)


def _segment_retenu(segment, infos, options):
    """Does this template segment enter the message? (AND conditions)

    ⚠ A SEGMENT MAY CARRY TWO SINCE 31/08/2026, and it had to. The engine read
    only ONE: if a segment carried `si_option`, its INFORMATION condition was
    ignored. Two endings showed it:

    · 30/08 — on a confirmation whose free slots were empty, the sentence
    offering them dropped out (it carried the variable) and the NEXT one
    stayed: `… please confirm your attendance. If none suits you, I will cancel
    your appointment.` `None` no longer referred to anything; · 31/08 — on
    removing the list from the opening (his request), the sentence no longer
    carried a variable: it could therefore no longer drop out, and the agent
    promised `I can offer you another date` with ZERO slots in stock.

    Both are settled at once: the segment declares ITS conditions, and all must
    be true. That is already `_fait_retenu`'s grammar, on the facts side — the
    two halves of the briefing now read the same way.
    """
    if segment.get("si_option") and not options.get(segment["si_option"]):
        return False
    if segment.get("sauf_option") and options.get(segment["sauf_option"]):
        return False
    # A `no` in a yes/no choice counts as NOT filled in (otherwise the
    # conditional sentence would appear precisely when it had been refused).
    def rempli(code):
        valeur = (infos.get(code) or "").strip()
        return bool(valeur) and valeur != "non"

    if segment.get("si") and not rempli(segment["si"]):
        return False
    if segment.get("sauf") and rempli(segment["sauf"]):
        return False
    return True


# ⚠ ELISION — his defect no. 11 of 18/08/2026. Noted word for word in a
# transcript: `**En raison de un imprévu** dans notre planning`. The template
# writes `de [raison]` and the value starts with a vowel: the substitution put
# the two end to end. It is a text an agent READS out loud — a liaison mistake
# is heard.  THE FOUR WORDS THAT ELIDE HERE, and not one more: they are the
# ones preceding a variable in the shipped templates or in a speech written by
# hand. A word absent from this table is simply not elided — we do not guess
# the grammar of a sentence we did not write.
_ELIDABLES = {"de": "d'", "que": "qu'", "le": "l'", "la": "l'"}

# ⚠ `h` IS DELIBERATELY EXCLUDED. French has two h: the mute one (`d'homme`)
# and the aspirated one (`de haricot`), and nothing in a typed value says
# which. Eliding at random would say `d'haricot` half the time; not eliding
# leaves `de homme`, which is noticeable but not as jarring. Faced with
# uncertainty, we do not guess.
_VOYELLES = "aàâäeéèêëiîïoôöuùûü"


def _elider(texte, code, valeur):
    """Substitutes [code] with its value, eliding the preceding word when needed.

    ⚠ WITHOUT A REGULAR EXPRESSION, AND THAT IS SAFER HERE. The word sought
    must be a WHOLE word: `grande [raison]` must not become `grand'un imprévu`.
    The left boundary is therefore a space, or the start of the text — two
    named cases, readable without decoding.
    """
    if valeur and valeur[0].lower() in _VOYELLES:
        for mot, forme in _ELIDABLES.items():
            for source, cible in ((mot, forme),
                                  (mot.capitalize(), forme.capitalize())):
                marque = source + " [" + code + "]"
                texte = texte.replace(" " + marque, " " + cible + valeur)
                if texte.startswith(marque):
                    texte = cible + valeur + texte[len(marque):]
    return texte.replace("[" + code + "]", valeur)


def _remplir(texte, infos, types, preferences):
    """Replaces the step-② [variables] with their value, dates readable.

    The PER-CONTACT variables stay in brackets: they are filled at call time,
    contact by contact.
    """
    code_langue = mod_langue.de_preferences(preferences)
    for code, valeur in infos.items():
        valeur = (valeur or "").strip()
        if valeur:
            texte = _elider(texte, code,
                            _valeur_lisible(valeur, types.get(code, "texte"),
                                            code_langue))
    return texte.replace("[plage_rappel]",
                         themes.plage_lisible(preferences, code_langue))


_PHRASES = re.compile(r"[^.!?]*[.!?]\s*|[^.!?]+$")
_VARIABLE = re.compile(r"\[[^\]\n]+\]")


def _sans_phrases_incompletes(texte):
    """Removes the sentences where a variable was left with no value.

    Applied at call time: the agent never reads an empty [bracket] (an optional
    field left unfilled simply drops its sentence).
    """
    gardees = [phrase for phrase in _PHRASES.findall(texte)
               if not _VARIABLE.search(phrase)]
    resultat = "".join(gardees).strip()
    return resultat or _VARIABLE.sub("", texte).strip()


def finaliser_mission(mission, contact, champs, langue_code="fr"):
    """Substitutes [identite] and the contact's fields — called PER CALL.

    champs: the campaign's column definitions (so each field's type is known).
    Never a phone number in the text: the `telephone` column is deliberately
    NOT substituted.
    """
    texte = mission.replace("[identite]", contact["nom"])
    valeurs = champs_contact(contact)
    for champ in champs:
        if champ["code"] in ("identite", "telephone"):
            continue
        valeur = (valeurs.get(champ["code"]) or "").strip()
        if valeur:
            texte = texte.replace(
                f"[{champ['code']}]",
                _valeur_lisible(valeur, champ["type"], langue_code))
    return _sans_phrases_incompletes(texte)


# ------------------------------------------------- the three-part briefing
# What the template produces is the OPENING — the only passage spoken word for
# word. Around it, the briefing carries the OBJECTIVE, the USEFUL FACTS, the
# CONSTRAINTS and the THREE closed OUTCOMES: see the consigne module, and the
# owner's decision quoted at the top of that file.  The useful facts are
# written nowhere twice: they are derived from the step-2 information and the
# contact columns already declared in NATURES. Adding a piece of information to
# a kind therefore adds it at the same time to what the agent knows — they
# cannot be left to diverge.
_PARENTHESES = re.compile(r"\s*\([^)]*\)")


def _libelle_court(libelle):
    """`Rendez-vous existant (date + heure)` becomes `Rendez-vous existant`.

    A form's brackets help to FILL IN the field; dictated to the agent, they
    would only clutter it.
    """
    return " ".join(_PARENTHESES.sub("", libelle or "").split()).strip(" :⛔")


def faits_segments(nature, champs=None):
    """The lines of `what you know`, as conditional segments.

    The same grammar as the template: a segment is a text, or a dictionary
    {"texte", "si" / "si_valeur" / "si_option"}. The conditions accumulate
    (AND), exactly as the live preview evaluates them.

    - `si`        : the information is filled in (`no` counts as empty);
    - `si_valeur` : the information carries a value, `no` included — that is the case of yes/no choices, whose `no` is itself a fact;
    - `si_option` : the corresponding checkbox is ticked.

    The PHONE never enters this list: that is the product's rule, and it is
    checked by the tests.
    """
    definition = NATURES[nature]
    lignes = [{"texte": "Personne appelée : [identite]."}]
    for info in definition["infos"]:
        segment = {"texte": f"{_libelle_court(info['libelle'])} : "
                            f"[{info['code']}]."}
        if info["type"] == "oui_non":
            segment["si_valeur"] = info["code"]
        elif not info["obligatoire"]:
            # An optional piece of information left empty does not become a red
            # line: it disappears, like its sentence in the message.
            segment["si"] = info["code"]
        if info.get("sous_option"):
            segment["si_option"] = info["sous_option"]
        lignes.append(segment)
    for champ in (champs if champs is not None
                  else champs_campagne({"champs": definition["champs"]})):
        if champ["code"] in ("identite", "telephone"):
            continue
        lignes.append({"texte": f"{_libelle_court(champ['libelle'])} : "
                                f"[{champ['code']}]."})
    return lignes


def _fait_retenu(segment, infos, options):
    """Does this fact segment enter the briefing? (AND conditions)."""
    if segment.get("si_option") and not options.get(segment["si_option"]):
        return False
    brut = (infos.get(segment.get("si_valeur")) or "").strip()
    if segment.get("si_valeur") and not brut:
        return False
    valeur = (infos.get(segment.get("si")) or "").strip()
    if segment.get("si") and (not valeur or valeur == "non"):
        return False
    return True


def _mot_place(preferences):
    """`place` or `slot`, according to the language — the slot enumeration.

    A line of its own because it is built IN THE MIDDLE of an assembly: `slot 1
    — Monday…; slot 2 — Tuesday…`. The word alone cannot live in the sentence
    dictionary, it is not one.
    """
    return mod_langue.traducteur(
        mod_langue.de_preferences(preferences))("place")


def construire_consigne(nature, infos, preferences, options=None, champs=None,
                        presentation=None, genre=None, places=()):
    """THE step-2 BRIEFING — the three parts, as they will go out.

    presentation: the opening message; by default the template's, but the
    caller passes the text REWRITTEN BY HAND when there is one — it is that one
    which then goes out, word for word, untouched.

    The PER-CONTACT variables ([identite], [rdv_existant]…) stay in place: that
    is what lets the preview show where they will be filled, and
    finaliser_consigne fill them at call time.

    places: the slots ONE SINGLE CALL enumerates, when there is more than one.
    They enter here — in the shared path — and not at the caller's: otherwise
    step 2's preview would keep quiet about the one line that changes, and the
    operator would not see that their call offers three.
    """
    definition = NATURES[nature]
    options = options or {}
    if champs is None:
        champs = champs_campagne({"champs": definition["champs"]})
    if presentation is None:
        presentation = construire_mission(nature, infos, preferences, options)
    genre_nature = definition.get("genre", consigne.GENRE_CLASSIQUE)
    if genre is None:
        genre = genre_nature
    # The result schema decides which field to fill: when the call does not go
    # out with this kind's schema, its codes can no longer be dictated to it —
    # we fall back on the general outcomes, which are valid everywhere.
    issues = (definition["issues"] if genre == genre_nature
              else (consigne.ISSUES_DEFAUT_CASCADE
                    if genre == consigne.GENRE_CASCADE
                    else consigne.ISSUES_DEFAUT))
    types = {info["code"]: info["type"] for info in definition["infos"]}
    faits = [segment["texte"] for segment in faits_segments(nature, champs)
             if _fait_retenu(segment, infos, options)]

    def substituer(texte):
        for code, valeur in infos.items():
            valeur = (valeur or "").strip()
            if valeur:
                texte = texte.replace(
                    f"[{code}]",
                    _valeur_lisible(valeur, types.get(code, "texte"),
                                    code_langue))
        return texte

    # ⚠ SEVERAL SLOTS IN THE SAME CALL (03/08/2026). We NUMBER them in the
    # facts — it is free text, the API's contract does not touch it — and we
    # dictate to the agent to write into `new_datetime` the one that was
    # chosen: it is the ONLY channel through which a date comes back.  ⚠
    # CASCADE ONLY. On the classic genre, a date on `confirmed` is still
    # refused by the answer check: dictating that would mean asking the agent
    # for an answer the product rejects.
    places = [place for place in (places or []) if place]
    if genre == consigne.GENRE_CASCADE and len(places) > 1:
        faits = faits + [
            mod_langue.traducteur(mod_langue.de_preferences(preferences))(
                "Plusieurs places sont libres, propose-les dans cet ordre :")
            + " "
            + " ; ".join(
                f"{_mot_place(preferences)} {rang} — "
                f"{themes.date_parlee(place, mod_langue.de_preferences(preferences))}"
                for rang, place in enumerate(places, start=1))
            + mod_langue.traducteur(mod_langue.de_preferences(preferences))(
                ". Une seule sera retenue.")]
        issues = dict(issues)
        issues["oui"] = dict(issues["oui"],
                             quand="la personne retient UNE des places "
                                   "proposées",
                             date="obligatoire")
    # ⚠ THE LANGUAGE IS READ FROM THE SETTINGS, HERE. It is not passed as a
    # parameter: that would mean carrying it through the whole call chain (the
    # server, the queue, the follow-ups, the cascade) for a value that is
    # GLOBAL to the installation. `preferences` is already there, and it is
    # what carries it.
    code_langue = mod_langue.de_preferences(preferences)
    dire = mod_langue.traducteur(code_langue)
    plage = themes.plage_lisible(preferences, code_langue)
    # ⚠ AND THE FALLBACK IS TRANSLATED HERE TOO. The constraints and the
    # conduct are substituted BEFORE `Consigne.texte()`: fixing the fallback
    # over there was not enough, `l'établissement` was already written into the
    # lines. Two places substitute, and both must know the language.
    entreprise = (infos.get("entreprise")
                  or preferences.obtenir(themes.CLE_ENTREPRISE)
                  or dire(consigne.ENTREPRISE_INCONNUE))
    cadre = [consigne.substituer_cadre(dire(ligne), entreprise, plage)
             for ligne in consigne.CONTRAINTES]
    # ⚠ THE CONDUCT GOES THROUGH `substituer_cadre` LIKE THE CONSTRAINTS: it
    # names [entreprise] in its closing sentence (`somebody from … will call
    # you back`). Without that, the client would hear the word `entreprise`.
    conduite = [consigne.substituer_cadre(substituer(dire(ligne)),
                                          entreprise, plage)
                for ligne in definition.get("conduite", ())]
    # The outcomes carry a readable sentence (`quand`): it is that which is
    # spoken, the code beside it is not.
    issues = {cle: dict(fixee, quand=dire(fixee["quand"]))
              for cle, fixee in issues.items()}
    return consigne.Consigne(
        substituer(presentation).replace("[plage_rappel]", plage),
        dire(definition["objectif"]),
        [substituer(dire(ligne)) for ligne in faits],
        cadre, issues, genre,
        consigne.substituer_cadre(dire(consigne.ENTETE), entreprise, plage),
        conduite, dire,
        mod_langue.civilites_de(code_langue, consigne._DEVELOPPE))


def finaliser_consigne(cadre, contact, champs, presentation=None,
                       langue_code="fr"):
    """Fills in THIS CONTACT's variables — called per call, like the mission.

    The phone number is deliberately NOT substituted: it appears in no line,
    and it must appear nowhere in what is dictated to the agent.
    """
    valeurs = {"identite": contact["nom"]}
    donnees = champs_contact(contact)
    for champ in champs:
        if champ["code"] in ("identite", "telephone"):
            continue
        valeur = (donnees.get(champ["code"]) or "").strip()
        if valeur:
            valeurs[champ["code"]] = _valeur_lisible(
                valeur, champ["type"], langue_code)
    if presentation is None:
        presentation = finaliser_mission(cadre.presentation, contact,
                                         champs, langue_code)
    return cadre.substituer(valeurs, presentation=presentation)


# How many slots at most in one single call. Three: on the 8th real test, to
# somebody simply asking it to REPEAT a date, the agent answered `I'd rather
# not tell you something wrong` and hung up. Enumerating, having somebody
# choose, then rephrasing is harder than repeating — we do not ask it for ten.
PLACES_ANNONCEES_MAX = 3


def places_annoncees(campagne, configuration=None):
    """The slots we have announced in THIS call — the first one first.

    A campaign with a single slot only announces one: nothing changes for it,
    and the answer check stays the one from before.
    """
    if configuration is None:
        configuration = configuration_campagne(campagne)
    # ⚠ A LOST SLOT IS NO LONGER ANNOUNCED, EVEN WITH NO LIST (14/08/2026). The
    # single-slot campaign read its `creneau` column without looking at what
    # had become of that slot: once taken elsewhere, it went on being offered
    # to everybody. See `_perdre_la_place_si_prise` — twenty-four refusals in a
    # row, measured.
    restantes = [f["horaire"] for f in creneaux_de(campagne, configuration)
                 if f.get("statut") == CRENEAU_A_POURVOIR]
    if not configuration.get("liste_de_places"):
        return restantes[:1]
    return restantes[:PLACES_ANNONCEES_MAX]


def places_du_brouillon(brouillon):
    """The slots step 2 will have announced — so the preview shows them.

    ⚠ THE CAMPAIGN DOES NOT EXIST YET at step 2: the list lives in the draft,
    and `places_annoncees` can only read a campaign. Without this reading, the
    preview would have kept quiet about the one line batch 9 adds.
    """
    liste = normaliser_creneaux(brouillon.get("creneaux") or [])
    libres = [fiche["horaire"] for fiche in liste
              if fiche.get("statut") == CRENEAU_A_POURVOIR]
    return libres[:PLACES_ANNONCEES_MAX]


def place_retenue(resultat, annoncees, creneau_courant):
    """The slot the person took — or None when nothing is usable.

    ⚠ A DATE RETURNED MUST BE AMONG THOSE ANNOUNCED. That check existed
    nowhere: without it, a date invented or misheard on the phone would be
    booked as it stands. When the date matches nothing, we do not guess — the
    caller will treat it as a date refusal, and a human will call back.

    With no date returned, it is the current slot: that is the previous
    behaviour, and it stays right as long as only one slot is announced.
    """
    brut = (resultat or {}).get("new_datetime")
    if not brut:
        return creneau_courant
    for place in annoncees:
        if place == brut:
            return place
    return None


def infos_sur_la_place_en_cours(campagne, configuration):
    """The step-2 information, with the CURRENT slot's time.

    ⚠ THE COLUMN IS THE REFERENCE, NOT THE CONFIGURATION (01/09/2026). A
    campaign with a list of slots advances slot by slot: `campagnes.creneau`
    follows the cursor — it is written in black and white in
    `db.definir_creneau_campagne` — while the step-2 information is written
    once and for all at creation. When the two diverge, the briefing announces
    TWO dates for one slot: the opening says one, `what you know` says the
    other.

    WHAT THAT PRODUCED, on his campaign no. 133 (01/09/2026): the first contact
    takes the slot, the campaign moves on to the next, and CALL-E refuses the
    following call with a 422 whose message is a question:

    `What is the correct date of the freed slot to offer Mrs Émilie Aubry?`

    ⚠ TWO LOCKS RATHER THAN ONE, AND THAT IS INTENDED.
    `avancer_sur_la_place_suivante` now writes the realigned configuration —
    that is the underlying fix. This one closes at the READING point: it also
    repairs the campaigns ALREADY saved wrongly, without touching their data. A
    campaign interrupted by that defect therefore starts again correctly,
    without having to be redone.
    """
    infos = dict(configuration.get("infos") or {})
    code = INFO_CRENEAU_PAR_NATURE.get((campagne or {}).get("nature"))
    en_cours = (campagne or {}).get("creneau")
    if code and en_cours:
        infos[code] = en_cours
    return infos


def consigne_de_l_appel(base, preferences, campagne, configuration, contact,
                        mission, en_cascade, adaptee=None):
    """THE EXACT BRIEFING that goes out for THIS contact — no more, no less.

    One single path: step 2's preview, the real call and the tests all go
    through construire_consigne. What is shown is therefore what goes out.

    mission: the opening message ALREADY finalised by the caller (contact
    variables replaced, slots recomputed at the instant of the call) — the fact
    lines receive the same treatment here, so they cannot announce a slot the
    message no longer announces.
    """
    champs = champs_campagne(configuration)
    genre = (consigne.GENRE_CASCADE if en_cascade
             else consigne.GENRE_CLASSIQUE)
    cadre = construire_consigne(campagne["nature"],
                                infos_sur_la_place_en_cours(campagne,
                                                            configuration),
                                preferences, configuration["options"], champs,
                                presentation=campagne["mission"], genre=genre,
                                places=places_annoncees(campagne,
                                                        configuration))
    finale = finaliser_consigne(
        cadre, contact, champs, presentation=mission,
        langue_code=mod_langue.de_preferences(preferences))
    finale.faits = [creneaux_adaptes_au_contact(base, preferences,
                                                configuration, contact, ligne,
                                                adaptee=adaptee,
                                                campagne=campagne)
                    for ligne in finale.faits]
    return finale


def champs_contact(contact):
    """The field values of a campaign contact (a JSON column)."""
    brut = contact.get("champs")
    if not brut:
        return {}
    if isinstance(brut, dict):
        return brut
    try:
        valeurs = json.loads(brut)
    except (TypeError, ValueError):
        return {}
    return valeurs if isinstance(valeurs, dict) else {}


# --------------------------------------------- filling the grid
def format_collage(champs):
    """The expected format of a pasted row, optional columns included.

    `Nom;Téléphone;Rendez-vous existant ⛔;Motif ⛔;Numéro de dossier
    (facultatif)` — it serves both as on-screen help AND as an error message:
    we always say what was expected, not only what is wrong.
    """
    colonnes = [c for c in champs if c["code"] not in ("identite", "telephone")]
    morceaux = ["Nom", "Téléphone"]
    for colonne in colonnes:
        marque = " ⚠" if colonne["obligatoire"] else " (facultatif)"
        morceaux.append(colonne["libelle"] + marque)
    return ";".join(morceaux)


def exemple_collage(champs):
    """An EXAMPLE row in the expected format — a landmark, never data.

    Shown as a watermark in the paste area (it is not submitted: a pre-filled
    example would create a fake contact at the first click).
    """
    colonnes = [c for c in champs if c["code"] not in ("identite", "telephone")]
    # An example number taken from a root Arcep reserves for fiction (06 39 98
    # …): it can belong to nobody, and it stays distinct from the product's
    # test numbers. A `plausible` number would be taken for a genuine leak by
    # the publication check — rightly so.
    morceaux = ["Mme Dupont Martine", "+33 6 39 98 12 34"]
    for colonne in colonnes:
        if colonne["type"] == "date":
            morceaux.append("15/08/2026 09:30")
        else:
            morceaux.append(colonne["libelle"].lower())
    return ";".join(morceaux)


def analyser_collage(texte, champs, telephones_connus=(), numero_essai=""):
    """Parses a multi-column paste `Nom;Téléphone[;fields…]`.

    champs: the campaign's columns (the paste's order = the columns' order
    after Identity and Phone). Reuses saisie.py's validators — the same French
    errors line by line, the same tolerated separators (tab, semicolon, comma),
    the same duplicates flagged. Returns (contacts, errors, refused) — contacts
    = [{"nom", "telephone", "champs"}] and refused = the pasted rows that
    produced NOTHING, as they stand: the screen redisplays them for correction,
    without redisplaying those already entered into the grid (otherwise they
    would duplicate).

    numero_essai: the number — or the LIST of numbers — the operator declared
    in ⚙ Réglages as their TESTERS' (their own, a colleague's, a friend's;
    module essai_reel), or "" / []. Those numbers — and they alone — may come
    back several times, with different identities: that is what makes it
    possible to exercise a whole campaign on known phones. The guard stays
    WHOLE for every other number; with no number declared, nobody is exempt.
    """
    colonnes = [c for c in champs if c["code"] not in ("identite", "telephone")]
    attendu = format_collage(champs)
    contacts, erreurs, refusees = [], [], []
    deja_vus = {t: "un contact déjà dans la grille" for t in telephones_connus}
    for numero, ligne in enumerate((texte or "").splitlines(), start=1):
        if not ligne.strip():
            continue
        for separateur in ("\t", ";", ","):
            if separateur in ligne:
                break
        else:
            erreurs.append(f"Ligne {numero} : aucun séparateur trouvé "
                           "(point-virgule, virgule ou tabulation) — attendu "
                           f"« {attendu} ».")
            refusees.append(ligne)
            continue
        morceaux = [morceau.strip() for morceau in ligne.split(separateur)]
        if len(morceaux) < 2:
            erreurs.append(f"Ligne {numero} : {len(morceaux)} colonne reçue, "
                           f"2 au minimum — attendu « {attendu} ».")
            refusees.append(ligne)
            continue
        # Mandatory columns absent: we FLAG it while saying what was expected,
        # but we keep the row — it is completed in the grid (validation, for
        # its part, will refuse as long as a ⛔ stays empty).
        manquantes = [c["libelle"] for c in colonnes[len(morceaux) - 2:]
                      if c["obligatoire"]]
        if manquantes:
            erreurs.append(f"Ligne {numero} : il manque "
                           f"{', '.join(manquantes)} — attendu "
                           f"« {attendu} » ; la ligne est ajoutée, à compléter "
                           "dans la grille.")
        if len(morceaux) > 2 + len(colonnes):
            erreurs.append(f"Ligne {numero} : {len(morceaux)} colonnes reçues, "
                           f"{2 + len(colonnes)} au maximum — attendu "
                           f"« {attendu} ».")
            refusees.append(ligne)
            continue
        try:
            nom = saisie.valider_nom(morceaux[0])
            telephone = saisie.valider_telephone(morceaux[1])
        except SaisieInvalide as erreur:
            erreurs.append(f"Ligne {numero} : {erreur}")
            refusees.append(ligne)
            continue
        valeurs, fautive = {}, False
        for colonne, brut in zip(colonnes, morceaux[2:]):
            brut = brut.strip()
            if not brut:
                continue
            if colonne["type"] == "date":
                try:
                    brut = saisie.valider_horaire(brut)
                except SaisieInvalide as erreur:
                    erreurs.append(f"Ligne {numero}, colonne "
                                   f"« {colonne['libelle']} » : {erreur}")
                    fautive = True
                    break
            valeurs[colonne["code"]] = brut
        if fautive:
            refusees.append(ligne)
            continue
        if telephone in deja_vus and not db.est_numero_essai(telephone,
                                                             numero_essai):
            erreurs.append(f"Ligne {numero} : même numéro que "
                           f"{deja_vus[telephone]} — doublon ignoré.")
            continue  # a duplicate: no point having it corrected again
        deja_vus[telephone] = f"la ligne {numero}"
        contacts.append({"nom": nom, "telephone": telephone, "champs": valeurs})
    if not contacts and not erreurs:
        erreurs.append("Liste vide : collez une ligne par personne — attendu "
                       f"« {attendu} ».")
    return contacts, erreurs, refusees


def analyser_csv(octets, champs, telephones_connus=(), numero_essai=""):
    """A CSV file for the grid: the same columns as the paste.

    Reuses saisie.py's tolerant decoding (UTF-8 then cp1252); a header row
    (`nom;telephone…`) is recognised and skipped. Returns (contacts, errors):
    refused rows are not redisplayed here, the file stays on the user's disk.

    numero_essai: see analyser_collage — only the declared test number escapes
    the duplicate refusal, all the others stay subject to it.
    """
    texte = saisie.decoder_csv(octets)
    lignes = texte.splitlines()
    for indice, ligne in enumerate(lignes):
        if ligne.strip():
            premiere = ligne.split(";")[0].split(",")[0].split("\t")[0]
            if premiere.strip().lower() in ("nom", "identite", "identité"):
                lignes = lignes[:indice] + lignes[indice + 1:]
            break
    contacts, erreurs, _ = analyser_collage("\n".join(lignes), champs,
                                            telephones_connus, numero_essai)
    return contacts, erreurs


def contacts_depuis_ics(base, octets, champs, telephones_connus=()):
    """An ICS calendar for the grid — reuses ics.analyser_ics.

    The title `Nom — Motif` fills the reason column (when it exists), the date
    fills the existing-appointment column (when it exists). The number is
    looked for first IN the calendar itself (CONTACT, ATTENDEE as `tel:`,
    DESCRIPTION… — see the header of ics.py), then failing that among the known
    clients; otherwise the contact stays WITHOUT a number, listed `to be
    completed before validation` — never an invented number. Returns (contacts,
    sans_numero, errors).
    """
    from . import ics as module_ics
    evenements, erreurs = module_ics.analyser_ics(saisie.decoder_csv(octets))
    codes = {c["code"] for c in champs}
    contacts, sans_numero = [], 0
    deja_vus = set(telephones_connus)
    for evenement in evenements:
        telephone = (evenement.get("telephone")
                     or base.telephone_par_nom(evenement["nom"]) or "")
        if telephone and telephone in deja_vus:
            continue
        if telephone:
            deja_vus.add(telephone)
        else:
            sans_numero += 1
        valeurs = {}
        if "motif" in codes:
            valeurs["motif"] = evenement["motif"]
        if "rdv_existant" in codes:
            valeurs["rdv_existant"] = evenement["horaire"]
        contacts.append({"nom": evenement["nom"], "telephone": telephone,
                         "champs": valeurs})
    return contacts, sans_numero, erreurs


def libelle_periode(periode):
    """`semaine 33 — du 10/08 au 16/08` or `mardi 11/08`, for the screen."""
    if not periode or not periode.get("semaine"):
        return "toutes les dates"
    if periode.get("jour"):
        jour = datetime.date.fromisoformat(periode["jour"])
        return f"{horaires.JOURS[jour.weekday()]} {jour:%d/%m/%Y}"
    return horaires.libelle_semaine(periode["annee"], periode["semaine"])


# ------------- an ALREADY CONFIRMED appointment does not enter a confirmation
# ⚠ HIS REQUEST OF 20/08/2026: `only import the contacts whose appointments
# have not been confirmed`.  A confirmation campaign asks `will you be there?`.
# Asking it of somebody who has ALREADY answered means calling them back for
# nothing — and it costs a call each time. Measured on 20/08: he selects a
# morning, one of the appointments is confirmed, the campaign calls them
# anyway.  ⚠ IT IS NOT A REFUSAL, IT IS AN EXCLUSION STATED IN CLEAR. The
# number travels with the list all the way to the screen: without that, he
# would count his appointments and not find the total — exactly defect no. 7 of
# 18/08.
def ecarter_les_deja_confirmes(base, nature, contacts):
    """(kept, number set aside) — only sets aside on a confirmation.

    ⚠ ONE SINGLE PLACE, BECAUSE THERE ARE THREE IMPORT ROUTES: the schedule
    range, step ③'s `import` button (paste, CSV, calendar, database, states,
    previous campaign) and the automatic rule replayed at every slot. Three
    separate filters would have ended up diverging.

    A contact with no known appointment is KEPT: we do not guess that they are
    confirmed, and setting them aside would amount to losing them in silence.
    """
    if nature != "confirmation":
        return list(contacts), 0
    gardes, ecartes = [], 0
    for contact in contacts:
        rdv = _rendezvous_vise(base, contact, contact.get("telephone", ""))
        if rdv is not None and rdv["statut"] == "confirmé":
            ecartes += 1
            continue
        gardes.append(contact)
    return gardes, ecartes


def phrase_deja_confirmes(ecartes):
    """The sentence to display, or "" when there is nothing to say."""
    if not ecartes:
        return ""
    return (f"{ecartes} rendez-vous déjà confirmé(s) écarté(s) — les "
            "rappeler pour confirmer n'apporterait rien")


def contacts_depuis_base(base, source, champs, telephones_connus=(),
                         debut=None, fin=None):
    """Fills the grid from the database — reuses the existing building blocks.

    `a_venir` and `manques` go through campagnes.contacts_depuis_rendezvous
    (the appointment concerned fills its columns); `annules`, `deplaces` and
    `tous` go through base.candidats_cascade (like the list generation).
    Returns (contacts, complements) — complements = French messages.

    `debut` / `fin` (ISO text) bound the APPOINTMENTS' period. They only apply
    to the two sources that have one: `annulés`, `déplacés` and `tous les
    clients` have no date to filter, and saying so is better than filtering
    them on something else (02/08/2026).
    """
    if source not in SOURCES_BASE:
        raise SaisieInvalide(f"Source inconnue : « {source} ».")
    if (debut or fin) and source not in SOURCES_DATEES:
        raise SaisieInvalide(
            "Une période ne s'applique qu'aux rendez-vous à venir ou "
            f"manqués — « {SOURCES_BASE[source]} » n'en a pas.")
    codes = {c["code"] for c in champs}
    complements = []
    contacts = []
    deja_vus = set(telephones_connus)
    if source in SOURCES_DATEES:
        base.marquer_manques_echus()
        statut = STATUT_PAR_SOURCE_DATEE[source]
        bruts, sans_numero, exclus_stop = campagnes.contacts_depuis_rendezvous(
            base, statut, debut, fin)
        if sans_numero:
            complements.append(f"{sans_numero} client(s) sans numéro écarté(s)")
        if exclus_stop:
            complements.append(f"{exclus_stop} client(s) 🚫 « Ne plus appeler » "
                               "écarté(s)")
        deja_dans_la_grille = 0
        for brut in bruts:
            if brut["telephone"] in deja_vus:
                deja_dans_la_grille += 1
                continue
            deja_vus.add(brut["telephone"])
            valeurs = {}
            rdv = base.obtenir_rendezvous(brut["rendezvous_id"])
            if rdv:
                if "rdv_existant" in codes:
                    valeurs["rdv_existant"] = rdv["horaire"]
                if "motif" in codes:
                    valeurs["motif"] = rdv["motif"]
            contacts.append({"nom": brut["nom"], "telephone": brut["telephone"],
                             "champs": valeurs,
                             "rendezvous_id": brut["rendezvous_id"]})
        complements.extend(_note_deja_dans_la_grille(deja_dans_la_grille))
    else:
        candidats, exclus, exclus_stop = base.candidats_cascade(source)
        if exclus:
            complements.append(f"{exclus} client(s) sans numéro écarté(s)")
        # ⚠ THE 🚫 WAS REMOVED IN SILENCE HERE (14/08/2026, cross audit). The
        # query excludes it (`AND c.ne_plus_appeler = 0`) and nobody counted
        # it: the screen announced `123 contacts added` when the database had
        # 138, and five people disappeared without a word. The dated branch
        # just above had been saying it from the start.
        if exclus_stop:
            complements.append(f"{exclus_stop} client(s) 🚫 « Ne plus appeler » "
                               "écarté(s)")
        deja_dans_la_grille = 0
        for candidat in candidats:
            if candidat["telephone"] in deja_vus:
                deja_dans_la_grille += 1
                continue
            deja_vus.add(candidat["telephone"])
            contacts.append({"nom": candidat["nom"],
                             "telephone": candidat["telephone"], "champs": {}})
        complements.extend(_note_deja_dans_la_grille(deja_dans_la_grille))
    return contacts, complements


def _note_deja_dans_la_grille(combien):
    """The sentence for the contacts set aside because THEY WERE ALREADY THERE.

    ⚠ THE GAP FOUND BY THE 14/08/2026 AUDIT, and it affects all five kinds.
    Loading the same source twice — or two overlapping sources, like
    `rendez-vous posés` and `rendez-vous à venir` — set the duplicates aside
    WITHOUT a word. The grid did not move, no extra message was returned, and
    the screen concluded `Aucun contact trouvé depuis cette source`: that was
    false, the source contained twenty, all already there. The operator changed
    source, or believed their database was empty.
    """
    if not combien:
        return []
    return [f"{combien} contact(s) déjà dans la grille — pas ajouté(s) une "
            "seconde fois"]


def campagnes_reprenables(base):
    """The campaigns you can start again from: [(id, label, counts)].

    A campaign can only be resumed when it has contacts — otherwise there is
    nothing to draw from it and it does not clutter the drop-down. The label
    already carries its total count, so the choice is made knowingly.
    """
    reprenables = []
    for campagne in base.lister_campagnes():
        comptes = base.compter_contacts_par_etat(campagne["id"])
        if not comptes["tous"]:
            continue
        reprenables.append((campagne["id"],
                            f"n°{campagne['id']} — {campagne['nom']} "
                            f"({comptes['tous']} contact(s))",
                            comptes))
    return reprenables


def contacts_depuis_campagne(base, campagne_id, etat, champs,
                             telephones_connus=()):
    """Takes back the contacts of a PREVIOUS campaign, filtered by state.

    This is the reuse of results already recorded: a catch-up campaign is built
    from yesterday's 📵 unreachable ones, the ❌ refusals, the 🙋 `à rappeler par
    un humain`… The columns already filled (reason, existing appointment,
    custom fields) follow when the new campaign has the same columns. Returns
    (contacts, complements) — complements = French messages counting those set
    aside.
    """
    if etat not in ETATS_REPRISE:
        raise SaisieInvalide(f"État de reprise inconnu : « {etat} ».")
    campagne = base.obtenir_campagne(campagne_id)
    if campagne is None:
        raise SaisieInvalide(f"Campagne n°{campagne_id} introuvable.")
    codes = {c["code"] for c in champs}
    contacts, complements = [], []
    deja_vus = set(telephones_connus)
    sans_numero = exclus_stop = doublons = 0
    for brut in base.contacts_campagne_en_clair(campagne_id, etat):
        telephone = brut["telephone"] or ""
        if not telephone:
            sans_numero += 1
            continue
        if base.telephone_exclu(telephone):
            exclus_stop += 1
            continue
        if telephone in deja_vus:
            doublons += 1
            continue
        deja_vus.add(telephone)
        anciens = json.loads(brut["champs"]) if brut["champs"] else {}
        valeurs = {code: valeur for code, valeur in anciens.items()
                   if code in codes}
        if "rdv_existant" in codes and not valeurs.get("rdv_existant"):
            rdv = (base.obtenir_rendezvous(brut["rendezvous_id"])
                   if brut["rendezvous_id"] else None)
            if rdv:
                valeurs["rdv_existant"] = rdv["horaire"]
                if "motif" in codes and not valeurs.get("motif"):
                    valeurs["motif"] = rdv["motif"]
        contacts.append({"nom": brut["nom"], "telephone": telephone,
                         "champs": valeurs,
                         "rendezvous_id": brut["rendezvous_id"]})
    if sans_numero:
        complements.append(f"{sans_numero} contact(s) sans numéro écarté(s)")
    if exclus_stop:
        complements.append(f"{exclus_stop} contact(s) 🚫 « Ne plus appeler » "
                           "écarté(s)")
    if doublons:
        complements.append(f"{doublons} déjà dans la grille, non redoublé(s)")
    return contacts, complements


# ------------------------------------------------ a campaign's RECIPE Enough
# to REPLAY a campaign on ANOTHER slot (§8.3). A campaign therefore keeps, on
# top of its result, the CRITERIA that filled its list: the database source
# chosen, the previous campaign resumed and its filter.  A list typed or pasted
# by hand has no criterion: it is NOT reproducible, and the cascade abstains
# while saying so rather than inventing a list. An ADDITIVE addition: a
# campaign created before this version has no recipe at all — it counts as `not
# reproducible`, and the screen says so.  The `etat` mode is the CRITERION of
# the 👥 Contacts door (§4): `the clients whose state is X, unhandled, that kind
# N handles`. It is reproducible like the other two — it is what lets a
# campaign born of a state filter be replayed on another slot.
MODES_RECETTE_REPRODUCTIBLES = ("base", "campagne", "etat")


def recette_vide():
    """A new draft's recipe: nothing has filled the grid yet."""
    return {"apports": [], "a_la_main": False, "mission_editee": False}


def noter_apport_recette(brouillon, mode, **details):
    """Records WHERE a batch of people added to the grid comes from.

    The reproducible modes (database, previous campaign) are remembered with
    their criteria; all the others (paste, CSV, ICS calendar, a row added by
    hand) raise the `a_la_main` flag — the list can no longer be recomputed for
    another slot.
    """
    recette = brouillon.setdefault("recette", recette_vide())
    if mode in MODES_RECETTE_REPRODUCTIBLES:
        apport = {"mode": mode}
        apport.update(details)
        if apport not in recette["apports"]:
            recette["apports"].append(apport)
    else:
        recette["a_la_main"] = True
    return recette


def recette_reproductible(recette):
    """True when the list can be RECOMPUTED as it stands on another slot."""
    recette = recette or {}
    return bool(recette.get("apports")) and not recette.get("a_la_main")


def libelle_recette(recette):
    """The recipe in French, for the screen — never an invented sentence."""
    recette = recette or {}
    if not recette.get("apports") and not recette.get("a_la_main"):
        return ("inconnue (campagne créée avant que les recettes soient "
                "conservées)")
    morceaux = []
    for apport in recette.get("apports", []):
        if apport["mode"] == "base":
            morceaux.append("depuis la base — « "
                            + SOURCES_BASE.get(apport.get("source", ""),
                                               apport.get("source", "?"))
                            + " »")
        elif apport["mode"] == "campagne":
            morceaux.append(
                f"depuis la campagne n°{apport.get('campagne', '?')} — "
                + ETATS_REPRISE.get(apport.get("etat", "tous"),
                                    apport.get("etat", "?")))
        elif apport["mode"] == "etat":
            # DEFERRED import: etats_clients rests on this module, so it cannot
            # be loaded at the top of the file without a loop.
            from . import etats_clients
            etat = apport.get("etat", "")
            morceau = ("depuis 👥 Contacts — état « "
                       + (etats_clients.libelle_etat(etat) if etat
                          else "tous les états à traiter")
                       + " » non traité, traité par « "
                       + etats_clients.libelle_nature(apport.get("nature", ""))
                       + " »")
            if apport.get("recherche"):
                morceau += f" ; nom contenant « {apport['recherche']} »"
            morceaux.append(morceau)
    if recette.get("a_la_main"):
        morceaux.append("liste choisie à la main (collage, fichier, agenda "
                        "importé, ou rendez-vous désigné dans le planning)")
    return " ; ".join(morceaux) or "aucune source enregistrée"


def contacts_de_recette(base, recette, champs, preferences=None):
    """REPLAYS the recipe: rebuilds the list with the same criteria.

    Returns (contacts, complements) — the same building blocks as the
    assistant's step 3, never a second mechanism. Raises SaisieInvalide when a
    criterion is no longer valid (campaign erased, unknown source).
    """
    contacts, complements = [], []
    connus = []
    for apport in (recette or {}).get("apports", []):
        if apport.get("mode") == "base":
            lot, notes = contacts_depuis_base(base, apport.get("source", ""),
                                              champs, connus)
        elif apport.get("mode") == "etat":
            # DEFERRED import (etats_clients depends on this module).
            from . import etats_clients
            lot, notes = etats_clients.contacts_depuis_etat(
                base, apport.get("etat", ""), apport.get("nature", ""),
                champs, connus, recherche=apport.get("recherche", ""),
                preferences=preferences)
        elif apport.get("mode") == "campagne":
            try:
                campagne_id = int(apport.get("campagne"))
            except (TypeError, ValueError):
                raise SaisieInvalide(
                    "la campagne dont la liste était reprise n'est plus "
                    "identifiable.") from None
            lot, notes = contacts_depuis_campagne(
                base, campagne_id, apport.get("etat", "tous"), champs, connus)
        else:
            raise SaisieInvalide(
                f"source de liste inconnue : « {apport.get('mode')} ».")
        contacts.extend(lot)
        complements.extend(notes)
        connus = [c["telephone"] for c in contacts if c["telephone"]]
    return contacts, complements


def resserrer_sur_le_creneau(contacts, creneau, rendezvous_exclus=()):
    """THE POINT THAT MAKES THE CHAIN CONVERGE (§8.3).

    `A slot only interests the people it suits`: a contact whose appointment is
    EARLIER than the slot offered has nothing to gain from it — shifting them
    would lose them time instead of gaining it. So they are set aside. A
    contact whose appointment is UNKNOWN is set aside too: we cannot claim that
    slot suits them, and nothing is invented. Finally the appointment that has
    JUST moved is set aside: offering them the slot they have just left would
    make no sense.

    Returns (kept, set aside) — `ecartes` counts all three cases, for the
    screen.
    """
    exclus = {r for r in rendezvous_exclus if r}
    retenus = []
    ecartes = {"anterieurs": 0, "sans_date": 0, "deja_bouge": 0}
    for contact in contacts:
        if contact.get("rendezvous_id") in exclus:
            ecartes["deja_bouge"] += 1
            continue
        date_rdv = (champs_contact(contact).get("rdv_existant") or "").strip()
        if not date_rdv:
            ecartes["sans_date"] += 1
            continue
        if date_rdv < creneau:
            ecartes["anterieurs"] += 1
            continue
        retenus.append(contact)
    return retenus, ecartes


def en_csv(champs, contacts):
    """The grid as CSV (numbers IN CLEAR by nature, generated on the fly, never
    written server-side) — the same spirit as generation.en_csv.
    """
    codes = [c["code"] for c in champs]
    lignes = [";".join(codes)]
    for contact in contacts:
        valeurs = contact.get("champs") or {}
        cellules = [contact["nom"], contact["telephone"]]
        cellules += [valeurs.get(code, "") for code in codes[2:]]
        lignes.append(";".join(cellules))
    return "\r\n".join(lignes) + "\r\n"


# --------------------------------------------------- `prête` creation
def nom_campagne(nature, infos, nb_contacts, quand=None, jours=()):
    """The automatic, readable name — reuses the existing format.

    `jours`: the days the campaign is ABOUT (the dates of its contacts'
    appointments). They enter the name.

    ⚠ HIS DEFECT NO. 8 OF 18/08/2026: `Déplacement de rendez-vous (11
    contact(s)) — 17/08` — 17/08 is the CREATION date, not the day being
    handled. With 91 finished campaigns in his list, nothing made it possible
    to find `the one from 18/08`, the one that emptied his day.

    The rule already existed, for a single theme: `Créneau libéré **du 03/08
    14h** — 28/07` does carry the date concerned. It applies to every campaign
    starting from a schedule range — move, reminder, confirmation: it is DATED
    appointments they handle. One rule, otherwise half the campaigns stay
    unfindable.

    The kinds with no per-contact appointment (booking) have no day to name:
    `jours` is empty and the name does not change.
    """
    if nature == "creneau_libere":
        return campagnes.nom_auto("creneau_libere",
                                  creneau=infos.get("creneau_libere"),
                                  quand=quand)
    if quand is None:
        quand = datetime.date.today()
    nom = (fiche_nature(nature) or {}).get("nom", nature)
    if jours:
        premier = date_jour_lisible(jours[0])[:5]      # « 18/08 »
        if len(jours) == 1:
            nom = f"{nom} du {premier}"
        else:
            # Several days: we do not say `from X to Y`, which would suggest a
            # continuous run — they may be scattered.
            nom = f"{nom} de {len(jours)} journées, dès le {premier}"
    return f"{nom} ({nb_contacts} contact(s)) — {quand:%d/%m}"


def creer_campagne_prete(base, brouillon, preferences, quand=None):
    """Creates the campaign in the `prête` state — it CALLS NOBODY.

    Every contact receives a LINK to a client record (created here when they
    were merely pasted): it is that record's CURRENT number that will be
    dialled, never the copy frozen in the campaign. Contacts recognised as 🚫
    `Ne plus appeler` — by their number OR by their name — are created outright
    in the `exclu` state (never dialled); the record's banner counts them.
    Returns the campaign's id.
    """
    nature = brouillon["nature"]
    infos = brouillon["infos"]
    # The COMPUTED slot lists left as they stand stay marked: at call time,
    # they will be readapted to the length of the client concerned (30 minutes
    # = 2 slots). A list retyped by hand by the user is never touched. The
    # stock is reset to the REAL number of people before anything is frozen —
    # see `rafraichir_stock_du_brouillon`.
    rafraichir_stock_du_brouillon(base, preferences, brouillon)
    infos_auto = {code: valeur
                  for code, valeur in (brouillon.get("infos_auto") or {}).items()
                  if valeur and infos.get(code) == valeur}
    configuration = {
        "politique": brouillon["politique"],
        "ordre": brouillon["ordre"],
        "options": brouillon["options"],
        "infos": infos,
        "infos_auto": infos_auto,
        "champs": brouillon["champs"],
        # The RECIPE: enough to replay this campaign on another slot (§8.3). An
        # additive addition — a campaign with no recipe says so on screen. ⚠
        # The recipe carries `mission_editee`: it is what says whether the
        # message can be realigned onto another slot (see
        # `mission_sur_la_place`). Without it, we would realign a human text.
        "recette": dict(brouillon.get("recette") or recette_vide(),
                        mission_editee=bool(brouillon.get("mission_editee"))),
        # ⚠ `.get` AND NOT `[ ]`: the two draft constructors did not carry that
        # key, and a direct access crashed at EVERY campaign creation (defect
        # found at the review of 03/08/2026). A draft with no list falls back
        # on its single slot: an older campaign behaves exactly as before.
        "creneaux": normaliser_creneaux(
            brouillon.get("creneaux")
            or [brouillon.get("creneau") or infos.get("creneau_libere")]),
    }
    # ONE single slot: the campaign behaves exactly as before, including its
    # cascading shift. Several: it is a list campaign.
    configuration["liste_de_places"] = len(configuration["creneaux"]) > 1
    # AUTOMATIC mode saves its rule; manual mode has none.
    if brouillon.get("mode_liste") == "automatique":
        configuration["regle_liste"] = dict(brouillon.get("regle_liste") or {})
    # THE CEILING FOLLOWS THE CAMPAIGN, not only the draft: in automatic mode
    # the rule is replayed at EVERY slot, and it must respect it too —
    # otherwise a ceiling set to five would let five more people in at every
    # change of slot.
    if brouillon.get("plafond"):
        configuration["plafond"] = str(brouillon["plafond"]).strip()
    campagne_id = base.creer_campagne(
        nom_campagne(nature, infos, len(brouillon["contacts"]), quand=quand,
                     jours=jours_des_contacts(brouillon)),
        theme=nature, sujet=infos.get("sujet", ""),
        mission=brouillon["mission"],
        # The campaign's slot: that of its information when the kind carries
        # one (`créneau libéré`), otherwise the one the draft imposes — that is
        # the case of a cascade link, whose slot is the one a client has just
        # freed. ⚠ THE FIRST OF THE LIST, and the column now serves only that:
        # everything that reads it (direct journey, record, Clients screen,
        # bench) goes on seeing one slot, knowing nothing of the list.
        creneau=(configuration["creneaux"][0]["horaire"]
                 if configuration["creneaux"] else None),
        nature=nature,
        configuration=json.dumps(configuration, ensure_ascii=False),
        statut="prête")
    for rang, contact in enumerate(brouillon["contacts"], start=1):
        client_id = base.client_pour_contact(contact["nom"],
                                             contact["telephone"],
                                             contact.get("rendezvous_id"))
        # ⚠ THE NUMBER TYPED INTO THE GRID GOES ALL THE WAY TO THE RECORD
        # (18/08/2026). It is the RECORD that is dialled, never the copy frozen
        # in the campaign: without this line, the number he had just typed
        # stayed on the campaign and the contact went out `exclu — no number to
        # dial`. The gesture the screen asked of him served no purpose. A
        # record that ALREADY has a number is not touched (see
        # `db.completer_telephone`): completing is not overwriting.
        base.completer_telephone(client_id, contact["telephone"])
        if base.telephone_exclu(contact["telephone"]):
            refus = db.REFUS_STOP
        elif base.nom_exclu(contact["nom"]):
            refus = db.REFUS_STOP_NOM
        else:
            refus = None
        # ⚠ THE STATE AND THE TEXT COME OUT OF THE SAME PLACE, together. My
        # first version took only the state: the contact did go to `à rappeler
        # par un humain`, but with the old text `Client marqué 🚫 Ne plus
        # appeler` — which tells nobody there is a call to make.
        etat, detail = (db.suite_du_refus(refus) if refus
                        else ("à appeler", None))
        base.ajouter_contact_campagne(
            campagne_id, rang, contact["nom"], contact["telephone"],
            rendezvous_id=contact.get("rendezvous_id"), etat=etat,
            champs=json.dumps(contact.get("champs") or {}, ensure_ascii=False),
            detail=detail, client_id=client_id)
    # ⚠ THE RULE IS PLAYED FROM CREATION, on the FIRST slot (09/08/2026). It
    # was only played at a change of slot: an automatic campaign was therefore
    # born EMPTY, and ▶ Start called nobody before declaring itself finished.
    # The defect was bearable while automatic was a choice; it became the
    # default mode, hence the normal path. It comes AFTER the grid's contacts:
    # de-duplication is done on the numbers already present, and manual input
    # is never overwritten.
    if regle_de_liste(configuration):
        ajoutes = regenerer_la_liste(base, preferences,
                                     base.obtenir_campagne(campagne_id),
                                     configuration)
        journal.info("Campagne n°%d : règle jouée à la création — %d "
                     "personne(s)", campagne_id, ajoutes)
    journal.info("Campagne n°%d créée PRÊTE (nature %s, %d contact(s)) — "
                 "aucun appel passé", campagne_id, nature,
                 len(base.contacts_de_campagne(campagne_id)))
    return campagne_id


def configuration_campagne(campagne):
    """The saved configuration of an assistant campaign (a dict)."""
    try:
        configuration = json.loads(campagne.get("configuration") or "{}")
    except (TypeError, ValueError):
        configuration = {}
    configuration.setdefault("politique", "tous")
    configuration.setdefault("ordre", "liste")
    configuration.setdefault("options", {})
    configuration.setdefault("infos", {})
    configuration.setdefault("infos_auto", {})
    configuration.setdefault("champs", [])
    # A campaign from before the recipes has none: it counts as `not
    # reproducible` (no contribution), and the cascade says so instead of
    # inventing.
    configuration.setdefault("recette", recette_vide())
    # The LIST of slots (03/08/2026): empty for an older campaign, which then
    # falls back on its `creneau` column. See `creneaux_de`.
    configuration.setdefault("creneaux", [])
    # ⚠ `LIST-BASED` IS DECIDED AT CREATION, not by counting slots. A
    # single-slot campaign keeps its original cascading shift; and a slot given
    # back that would be added must not turn it into one along the way.
    configuration.setdefault("liste_de_places", False)
    # The automatic mode's rule. Absent: the campaign carries a frozen list,
    # and nothing is replayed (that is manual mode).
    configuration.setdefault("regle_liste", {})
    return configuration


# ================================================ THE LIST OF SLOTS ⚠ A
# `CRÉNEAU LIBÉRÉ` CAMPAIGN MAY CARRY SEVERAL (owner's request of 03/08/2026).
# Before, it carried ONE, in the campagnes.creneau column.  That column DOES
# NOT MOVE: it keeps the first slot, and everything reading it goes on working
# knowing nothing of the list — the direct journey, the campaign record, the 👥
# Contacts screen, the bench. The list, for its part, lives in the JSON
# configuration that already existed: no new table, no ALTER TABLE, hence no
# migration to write.  ⚠ THE STORAGE ORDER IS THE DISPLAY ORDER: chronological
# ascending, the oldest first. Two sortings — one to store, one to show — would
# have ended up contradicting each other.
CRENEAU_A_POURVOIR = "à pourvoir"
CRENEAU_POURVU = "pourvu"
CRENEAU_PERDU = "perdu"

# ------------------------------------------ what a call concludes, for the
# loop `_appliquer_issue` returns one of these values, or None when the
# campaign continues without changing anything about its slots.  ⚠ WHY `SLOT
# LOST` EXISTS (14/08/2026, second stage). The first fix did remove the slot
# from the LIST, but the execution loop knew nothing of it: it only reads the
# campaign back on `pourvu`. On a campaign with ONE SINGLE slot — the commonest
# case — it therefore went on calling everybody for a dead slot. Measured: six
# contacts, six calls, six departures to `à rappeler par un humain`. It was the
# 14/08 defect intact, only moved one notch.
CONCLUSION_POURVU = "pourvu"
CONCLUSION_PLACE_PERDUE = "place_perdue"


def normaliser_creneaux(valeurs):
    """A clean list of slots: sorted, without duplicates, without blanks.

    Accepts strings (`2026-08-12T09:00`) and already-formed records alike: that
    is what makes it possible to receive both a form input and the
    configuration read back from the database, without two paths.
    """
    par_horaire = {}
    for valeur in valeurs or ():
        if isinstance(valeur, dict):
            horaire = str(valeur.get("horaire") or "").strip()
            fiche = dict(valeur)
        else:
            horaire = str(valeur or "").strip()
            fiche = {}
        if not horaire:
            continue
        fiche["horaire"] = horaire
        fiche.setdefault("statut", CRENEAU_A_POURVOIR)
        fiche.setdefault("contact_id", None)
        fiche.setdefault("rendezvous_id", None)
        fiche.setdefault("pourquoi", "")
        # The same hour cannot be two slots: the last one wins.
        par_horaire[horaire] = fiche
    return [par_horaire[horaire] for horaire in sorted(par_horaire)]


def creneaux_de(campagne, configuration=None):
    """A campaign's slots — the list, or its single slot.

    A campaign from BEFORE the list has only its `creneau` column: we return it
    in the SAME shape, so the rest of the code has only one path to know. A
    campaign of another kind returns an empty list.
    """
    if configuration is None:
        configuration = configuration_campagne(campagne)
    liste = normaliser_creneaux(configuration.get("creneaux"))
    if liste:
        return liste
    unique = (campagne or {}).get("creneau")
    return normaliser_creneaux([unique]) if unique else []


def creneau_courant(campagne, configuration=None):
    """The next slot to fill, or None when they are all settled."""
    for fiche in creneaux_de(campagne, configuration):
        if fiche.get("statut") == CRENEAU_A_POURVOIR:
            return fiche
    return None


def _ecrire_creneaux(base, campagne_id, configuration, liste):
    """Stores the list in the configuration and saves it.

    ⚠ AND RESETS `liste_de_places` FROM WHAT IS WRITTEN (15/08/2026). That flag
    was frozen at the campaign's CREATION. Since the slot left behind joins the
    campaign — including when it only had one — a campaign may end up with two
    without the flag moving: it then went on behaving as a `single slot`, hence
    without filtering the contacts on interest and without reloading a list.

    It is the common checkpoint of ALL slot writing (`ajouter_creneau`,
    `marquer_creneau`): putting it here, and nowhere else, is what guarantees
    no path forgets it.
    """
    configuration["creneaux"] = normaliser_creneaux(liste)
    configuration["liste_de_places"] = len(configuration["creneaux"]) > 1
    base.definir_configuration_campagne(
        campagne_id, json.dumps(configuration, ensure_ascii=False))
    return configuration["creneaux"]


def marquer_creneau(base, campagne_id, horaire, statut, contact_id=None,
                    rendezvous_id=None, pourquoi=""):
    """Records what became of ONE slot, and returns the updated list.

    ⚠ READS THE CAMPAIGN BACK FROM THE DATABASE before writing. The dictionary
    the execution loop holds in memory dates from start-up: writing from it
    would overwrite what a previous call has just recorded. The defect, found
    at the review of 03/08/2026, put TWO people in the same slot.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if not campagne:
        return []
    configuration = configuration_campagne(campagne)
    liste = creneaux_de(campagne, configuration)
    for fiche in liste:
        if fiche["horaire"] == horaire:
            fiche["statut"] = statut
            fiche["contact_id"] = contact_id
            fiche["rendezvous_id"] = rendezvous_id
            fiche["pourquoi"] = pourquoi
    return _ecrire_creneaux(base, campagne_id, configuration, liste)


def ajouter_creneau(base, campagne_id, horaire, pourquoi=""):
    """Adds a slot to be filled to a campaign, and returns the updated list.

    Used when a contact accepts: the slot they LEAVE joins the SAME campaign's
    list (owner's decision of 03/08/2026), instead of spawning a separate
    `prête` campaign. The same precaution as `marquer_creneau`: we read the
    database back before writing.

    A slot already known is not reset to `to be filled`: it may already have
    been filled, and reopening it would have it offered twice.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if not campagne or not (horaire or "").strip():
        return []
    configuration = configuration_campagne(campagne)
    liste = creneaux_de(campagne, configuration)
    if any(fiche["horaire"] == horaire for fiche in liste):
        return liste
    liste.append({"horaire": horaire, "statut": CRENEAU_A_POURVOIR,
                  "contact_id": None, "rendezvous_id": None,
                  "pourquoi": pourquoi})
    return _ecrire_creneaux(base, campagne_id, configuration, liste)


class _decroissant:
    """A sort key that REVERSES a string's comparison.

    `reverse=True` would have reversed the first criterion TOO (`no date last`)
    and sent the contacts with no appointment to the top. So we only reverse
    what needs reversing.
    """

    __slots__ = ("valeur",)

    def __init__(self, valeur):
        self.valeur = valeur

    def __lt__(self, autre):
        return self.valeur > autre.valeur

    def __eq__(self, autre):
        return self.valeur == autre.valeur


# ============================ AUTOMATIC MODE'S LIST RULE An `automatic`
# campaign does not carry a frozen list: it carries the RULE that builds it,
# and that rule is replayed at every change of slot. That is what lets the 12
# August slot interest people other than the 30th's. ⚠ THIS SETTING WAS TURNED
# AROUND ON 11/08/2026, AND IT WAS AN INVERSION, NOT AN UNFORTUNATE LABEL. It
# said `up to 30 days after` and kept the people whose appointment falls WITHIN
# the 30 days following the slot — that is, those who gain the LEAST. Measured
# on the sample data set, slot in 3 days:  `up to 7 days`  -> 10 people,
# gaining 0 to 6 days `up to 30 days` -> 19 people, gaining 0 to 29 days `no
# limit`      -> 31 people, some gaining 0 DAYS  A freed slot exists to make
# people GAIN time. So the setting now expresses a MINIMUM GAIN: `at least 30
# days` keeps those whose appointment is at least 30 days after the slot — 12
# people, who really gain something. The owner's words: `we are going to ask
# for the people from the appointment date + 30 d, and the end date is the last
# appointment recorded`.  ⚠ AND THE LABELS STATE THE GAIN, NOT THE MECHANISM.
# `at least 30 days` answers the question you really ask — `who does this slot
# serve enough to be worth picking up the phone for?`
JOURS_APRES = (("", "peu importe"), ("7", "au moins 7 jours"),
               ("30", "au moins 30 jours"), ("90", "au moins 90 jours"))

# ============================ HOW FAR THE SHIFT CHAIN MAY GO His request of
# 15/08/2026: `instead of having only a date selector, we also have a selector
# to define a period which automatically fills the date field`.  Typing a date
# by hand to say `three months` means opening a calendar and counting — while
# you think in durations. The date field stays, and stays editable: the
# selector FILLS it, it does not replace it. `Free date` is the first choice,
# hence the previous behaviour.  The values are DAYS, except `derniere` which
# targets the last appointment known in the calendar — beyond it, the chain
# would find nobody, and it is the only bound we can offer without inventing
# it.
PERIODES_CASCADE = (("", "Date libre"), ("7", "7 jours"), ("14", "14 jours"),
                    ("30", "30 jours"), ("60", "2 mois"), ("90", "3 mois"),
                    ("180", "6 mois"), ("365", "1 an"),
                    ("derniere", "Dernière date de l'agenda"))

# THE RULE SET BY DEFAULT when a campaign opens in automatic mode (09/08/2026).
# A default mode with NO rule would have allowed a campaign to be created that
# calls nobody: the default therefore carries its value, like the rest of the
# product's settings.  ⚠ `UPCOMING, NOT YET CONFIRMED` SINCE 15/08/2026 (his
# request). It was `to rebook` — those waiting for a slot. But the kind that
# uses the rule most is `créneau libéré`, and it looks for the opposite: people
# who HAVE an appointment, later, that can be brought forward. So the default
# now targets those people. See SOURCES_REGLE, where `posés` was removed in the
# same move.
REGLE_LISTE_DEFAUT = {"source": "a_venir", "jours": ""}

# ============================ THE CEILING OF CONTACTS TO LOAD Owner's request
# of 11/08/2026: `a field to limit the number of contacts to load at step 3, to
# limit the number of calls`. A source can return thirty people; you do not
# always want thirty phones to ring.  ⚠ IT CAPS WHAT COMES IN, IT NEVER TRIMS
# WHAT IS ALREADY THERE. A row typed by hand into the grid is never removed by
# the ceiling: `refused input is never lost` applies to accepted input too. The
# ceiling counts those present and only lets the difference in.  ⚠ AND IT KEEPS
# THE MOST RELEVANT, NOT THE FIRST COMERS. The calling order chosen at that
# same step is applied BEFORE cutting: on a freed-slot campaign, keeping `the
# first five in the database` instead of `the five whose appointment is
# furthest away` would have called the people the slot helps least.  Empty = no
# ceiling, and that is the default: a ceiling set by default would have set
# people aside without anybody asking.
PLAFOND_VIDE = ""


def plafond_de(porteur):
    """A draft's or a configuration's contact ceiling, or None.

    None = no ceiling. An unreadable or zero value counts as `no ceiling`:
    better to load everybody than to set people aside on a figure we could not
    read.
    """
    brut = str((porteur or {}).get("plafond") or "").strip()
    if not brut.isdigit():
        return None
    return int(brut) or None


def limiter_au_plafond(contacts, plafond, ordre=None, creneau=None, deja=0):
    """The contacts that fit under the ceiling. Returns (kept, set aside).

    `deja`: how many are ALREADY in the list — they count towards the ceiling
    without being touched (see the block above PLAFOND_VIDE).
    """
    if not plafond:
        return list(contacts), 0
    place = max(0, plafond - deja)
    if len(contacts) <= place:
        return list(contacts), 0
    # The calling order decides WHO we keep. With no known order, we keep the
    # first comers — and the screen says how many were set aside, in every
    # case.
    retenus = (ordonner_contacts(contacts, ordre, creneau) if ordre
               else list(contacts))
    return retenus[:place], len(contacts) - place


def raison_plafond(plafond, ecartes):
    """What the maximum number of people set aside. Empty when it set none aside.
    """
    if not ecartes:
        return ""
    # ⚠ AND HERE TOO THE WORD NAMES THE SETTING (21/08/2026). This is the OTHER
    # sense of `plafond` — step ③'s, `At most, how many people`. Renaming one
    # and leaving the other would have kept the word ambiguous in exactly the
    # place where he met it.
    return (f"{ecartes} personne(s) écartée(s) : cette campagne est réglée au "
            f"maximum sur {plafond} personne(s)")


def manque_au_plafond(plafond, trouves):
    """The sentence saying WHY the ceiling is not reached.

    ⚠ IT EXISTS BECAUSE ITS ABSENCE LIED BY OMISSION (11/08/2026): a ceiling
    set to 30 that returns 8 people looks like a defect, when the source only
    contained 8. A figure without its shortfall cannot be read.
    """
    if not plafond or trouves >= plafond:
        return ""
    return (f"{trouves} personne(s) retenue(s) sur le maximum de {plafond} "
            "demandé(es) : "
            "la règle n'en a pas trouvé plus — changez la source, la fenêtre, "
            "ou ajoutez des personnes à la main")


# ⚠ THE RULE OF INTEREST (owner's decision, 09/08/2026), written HERE once and
# for all: a slot only interests somebody when it BRINGS them something. · they
# have no upcoming appointment left → any slot; · they have one → only a slot
# EARLIER than theirs. It replaces a bound that compared the OLD date — that of
# a cancelled appointment, hence in the past — with the slot offered: that
# comparison set aside precisely the people who are waiting.
SOURCES_A_VENIR = ("poses", "a_venir")


def place_utile_au_contact(base, contact, places, maintenant=None, gain=0):
    """True when at least one of these slots brings this contact something.

    ⚠ WE ASK THE DATABASE, not the contact's `existing appointment` column:
    that one carries the date of the OLD appointment, including when it was
    cancelled. The question that counts is `do they still have an upcoming
    appointment?`, and only the database can answer it at that instant.

    ⚠ AND WE REUSE `rendezvous_a_venir_du_client`, WHICH ALREADY EXISTED. I had
    written a second one, simpler — and under the same name: it silently
    replaced the other and broke four cascade tests. Its statuses
    (STATUTS_A_VENIR) are exactly those of the `NOT EXISTS` that defines
    `waiting`: two definitions of `still having an appointment` would have
    ended up contradicting each other.

    `gain`: the number of DAYS the slot must save, that of the campaign's rule.

    ⚠ WITHOUT IT, THE THRESHOLD ONLY APPLIED TO THE FIRST SLOT (15/08/2026).
    The owner's observation, word for word: `the +30 days appointment for 15/08
    looks for contacts from 15/09, and the 15/09 slot should look from 15/10`.
    He was right, and it was not being done. The rule loaded the list at the
    FIRST slot's threshold; then, at every following slot, this filter only
    asked `is the slot earlier than their appointment`. Somebody kept for a
    35-day gain on the 15/08 slot was therefore offered, once the campaign had
    advanced, a slot that only gained them two. The threshold now follows the
    current slot.
    """
    if not places:
        return False
    if not contact.get("client_id"):
        # No record: we do not guess, we call. Keeping quiet would have made
        # somebody disappear with no displayed reason.
        return True
    a_venir = base.rendezvous_a_venir_du_client(contact["client_id"],
                                                maintenant)
    if not a_venir:
        # Nothing left in the calendar: any free slot interests them.
        return True
    prochain = a_venir[0]["horaire"]
    if not gain:
        return any(place < prochain for place in places)
    limite = datetime.datetime.fromisoformat(prochain) - datetime.timedelta(
        days=int(gain))
    borne = limite.isoformat(timespec="minutes")
    return any(place <= borne for place in places)


RAISON_PLUS_DE_PROPOSITION = (
    "cette personne a demandé au téléphone qu'on ne lui propose plus de "
    "créneau libéré")


def gain_de_la_regle(configuration):
    """The minimum gain configured on this campaign, in days (0 = none).

    One single reading for the whole product: the rule carries the value, and
    it must apply at EVERY slot, not only at the first.
    """
    regle = (configuration or {}).get("regle_liste") or {}
    brut = str(regle.get("jours") or "").strip()
    return int(brut) if brut.isdigit() else 0


def interesse_par_une_place(base, contact, places, maintenant=None, gain=0):
    """Is there a reason to call THIS contact about THESE slots?

    Two questions, asked in the same place because they have the same
    consequence — not calling:

    1. **consent**: did the person ask on the phone not to be offered slots any more? (a flag on THEIR RECORD, not on the campaign — see db.clients.plus_de_proposition);
    2. **interest**: is one of the remaining slots earlier than their next appointment? (`place_utile_au_contact`)

    ⚠ BOTH ARE REPLAYED EVERY TIME, never memorised on the contact: a slot
    GIVEN BACK by somebody who accepts may be earlier than the current slot and
    make somebody relevant again.
    """
    if base.plus_de_proposition(contact.get("client_id")):
        return False
    return place_utile_au_contact(base, contact, places, maintenant, gain)


def regle_de_liste(configuration):
    """The saved rule, or None when the campaign carries a frozen list."""
    regle = (configuration or {}).get("regle_liste") or {}
    return regle if regle.get("source") in SOURCES_DATEES else None


def contacts_de_la_regle(base, preferences, regle, champs, creneau,
                         telephones_connus=()):
    """The people THIS slot interests, according to the rule.

    ⚠ THE WINDOW ONLY APPLIES TO UPCOMING-APPOINTMENT SOURCES (09/08/2026). It
    starts from the slot: `before it, bringing them forward brings nothing`.
    True of somebody who HAS an appointment — false, and heavy with
    consequences, for somebody who no longer has one. The `waiting` people have
    a PAST date by construction (you cancel, the date is behind you): the bound
    set them all aside. Measured: one person kept out of four all waiting for a
    slot. For those sources, no bound at all — it is the rule of interest,
    `place_utile_au_contact`, that decides at call time.

    ⚠ `JOURS` IS A MINIMUM GAIN, NOT A LIMIT (turned around on 11/08/2026 — see
    the block above JOURS_APRES). `at least 30 days` SHIFTS the window's start
    to 30 days after the slot, and there is NO end: the last appointment
    recorded closes the list by itself. Before, it closed the window at 30 days
    and therefore kept those who gained the least — exactly the opposite of
    what a freed slot is for.
    """
    if not creneau:
        return [], []
    debut = ""
    if regle["source"] in SOURCES_A_VENIR:
        debut = creneau
        jours = str(regle.get("jours") or "").strip()
        if jours.isdigit():
            debut = (datetime.datetime.fromisoformat(creneau)
                     + datetime.timedelta(days=int(jours))).isoformat(
                         timespec="minutes")
    contacts, complements = contacts_depuis_base(
        base, regle["source"], champs, list(telephones_connus),
        debut=debut or None, fin=None)
    # ⚠ THE WINDOW SET PEOPLE ASIDE WITHOUT A WORD (11/08/2026). The owner
    # created a campaign on a free slot and saw only five people `instead of a
    # lot`. The rule worked: the `rendez-vous à venir` source held fourteen,
    # and the bound — `a slot only interests those whose appointment is AFTER
    # it` — kept three. Eleven people set aside, and the screen said NOTHING: a
    # count with no explanation reads as a defect. So the same source is
    # replayed WITHOUT bounds, and the gap is named. A second pass over a local
    # file, at the moment of a gesture — not inside a call loop.
    if debut:
        sans_borne, _ = contacts_depuis_base(
            base, regle["source"], champs, list(telephones_connus))
        hors_fenetre = len(sans_borne) - len(contacts)
        if hors_fenetre > 0:
            gain = str(regle.get("jours") or "").strip()
            complements.append(
                f"{hors_fenetre} personne(s) écartée(s) : cette place ne leur "
                + (f"ferait pas gagner {gain} jours" if gain.isdigit()
                   else "ferait rien gagner — leur rendez-vous n'est pas "
                        "après elle"))
    # ⚠ THOSE WHO SAID `STOP OFFERING ME SLOTS` DO NOT ENTER THE LIST
    # (10/08/2026). The call guard would stop them anyway, but a list counting
    # them would announce `12 people` and call 9: the count displayed must be
    # the real one.  ⚠ AND ONLY HERE, never in `contacts_depuis_base`: that
    # flag concerns ONLY slot offers. Filtering higher up would have set those
    # people aside from reminders and confirmations about THEIR OWN
    # appointments — which is not what they asked for.
    gardes, ecartes = [], 0
    for contact in contacts:
        if base.telephone_sans_proposition(contact.get("telephone")):
            ecartes += 1
            continue
        gardes.append(contact)
    if ecartes:
        complements.append(
            f"{ecartes} personne(s) écartée(s) : elles ont demandé qu'on ne "
            "leur propose plus de créneau libéré")
    return gardes, complements


def appels_passes(base, campagne_id):
    """The calls this campaign has ALREADY spent from its ceiling.

    People dialled, not attempts: somebody followed up three times counts as
    one. It is that count `30 calls allowed` bounds.
    """
    return base.compter_personnes_appelees(campagne_id)


def appels_engages(base, campagne, configuration):
    """What the ceiling has already committed: calls GONE OUT + calls still DUE.

    A call is `due` when somebody is waiting to be called **and** one of the
    remaining slots still interests them. That is the nuance that makes all the
    difference, and it cost two attempts before being right:

    · counting ALL those present (the previous code) saturated the ceiling from
    the first round — the rule loads thirty, twenty-nine are left waiting, and
    nobody EVER entered again. Six calls placed out of thirty allowed, and
    three cascade slots with nobody to call. That is the defect he reported
    three days running; · counting only the calls GONE OUT inflated the list
    the other way: every slot reloaded the whole remaining budget when a single
    call was going to fill it. Measured: 465 contacts loaded for 30 calls, 435
    of them spared — accurate, but unreadable on screen.

    So what is counted: the calls gone out, plus the people still useful. A
    spared one, an excluded one, somebody the remaining slots no longer help
    hold nothing back — they will never cost a call.
    """
    campagne_id = campagne["id"]
    engages = appels_passes(base, campagne_id)
    attente = [contact for contact in base.contacts_de_campagne(campagne_id)
               if contact["etat"] in ("à appeler", "en cours")
               and not base.appels_du_contact_campagne(contact["id"])]
    if not configuration.get("liste_de_places"):
        # A campaign with ONE slot keeps its previous behaviour, to the letter:
        # its list is already narrowed at creation and its cursor never moves —
        # everything waiting is useful to it by construction.
        return engages + len(attente)
    annoncees = places_annoncees(campagne, configuration)
    gain = gain_de_la_regle(configuration)
    return engages + sum(
        1 for contact in attente
        if interesse_par_une_place(base, contact, annoncees, gain=gain))


def regenerer_la_liste(base, preferences, campagne, configuration):
    """Replays the rule on the current slot; returns the number of additions.

    ⚠ IT ONLY ADDS. The contacts already present — called, spared, refused —
    are left as they are: taking away their history to replace it with a fresh
    list would erase calls that took place. De-duplication is done on the
    number, as everywhere else.

    ⚠ WHAT THE RULE SET ASIDE IS WRITTEN ON THE CAMPAIGN (the `regle_jouee`
    key), not only in the log. That is what was missing: the list showed three
    names without saying that eleven people had been set aside, nor why.
    """
    regle = regle_de_liste(configuration)
    if not regle:
        return 0
    creneau = campagne.get("creneau")
    connus = [base.telephone_contact_campagne(c["id"])
              for c in base.contacts_de_campagne(campagne["id"])]
    connus = [numero for numero in connus if numero]
    champs = champs_campagne(configuration)
    try:
        nouveaux, notes = contacts_de_la_regle(base, preferences, regle, champs,
                                               creneau, connus)
    except (SaisieInvalide, ValueError) as erreur:
        journal.info("Campagne n°%d : la règle de liste n'a pas pu être "
                     "rejouée (%s) — la liste reste telle quelle",
                     campagne["id"], erreur)
        return 0
    # ⚠ THE CEILING IS A BUDGET OF CALLS, NOT A LIST SIZE (15/08/2026).  HIS
    # REQUEST, WORD FOR WORD: `30 calls allowed, we use 8 to fill the slot […]
    # that leaves 22 calls, we look for the 22 contacts on the basis of the
    # cascading slot and the automatic options selected, we add the contacts,
    # we call them.`  WHAT HAPPENED BEFORE, measured on exactly that scenario:
    # `deja` counted the contacts PRESENT. The rule loads thirty at the start,
    # so `deja` was thirty from the first round, and the ceiling was reached
    # for ever — SIX calls placed, TWENTY-FOUR of budget dormant, and three
    # cascade slots left `to be filled` with this note on screen: `77 people
    # set aside: ceiling set to 30`. The cascade did open, but nobody could
    # enter to serve it.  So the counting rule is that of CALLS, and it has two
    # parts: those that have GONE OUT, and those still DUE — a contact still `à
    # appeler` has their place reserved in the budget. The others (spared,
    # excluded, set aside for lack of interest) will never cost a call again:
    # counting them is exactly what closed the door.  ⚠ AND IT DOES NOT REOPEN
    # THE DEFECT THIS COUNT PROTECTED AGAINST — `a six-slot campaign would have
    # ended up calling thirty`. On the contrary: bounding the CALLS is stricter
    # than bounding the list. A campaign's total calls can, by construction,
    # never exceed its ceiling. ⚠ THE AUTOMATIC RULE GOES THROUGH THE SAME
    # FILTER (20/08/2026): it is replayed at EVERY slot, and without it it
    # would reimport at each round the appointments the campaign has just had
    # confirmed.
    nouveaux, deja_confirmes = ecarter_les_deja_confirmes(
        base, campagne.get("nature"), nouveaux)
    if deja_confirmes:
        notes = list(notes) + [phrase_deja_confirmes(deja_confirmes)]
    plafond = plafond_de(configuration)
    deja = appels_engages(base, campagne, configuration)
    nouveaux, hors_plafond = limiter_au_plafond(
        nouveaux, plafond, ordre=configuration.get("ordre"), creneau=creneau,
        deja=deja)
    if hors_plafond:
        notes = list(notes) + [raison_plafond(plafond, hors_plafond)]
    # ⚠ AND WHEN THE CEILING IS NOT REACHED, WE SAY SO (11/08/2026). The owner
    # set 30 and got 8: `I said I wanted 30 contacts, I only have 8`. The rule
    # was right — the source held no more — but a ceiling set to 30 returning 8
    # reads as a defect as long as nobody says where the gap comes from.
    elif plafond and deja + len(nouveaux) < plafond:
        notes = list(notes) + [manque_au_plafond(plafond,
                                                 deja + len(nouveaux))]
    rang = len(base.contacts_de_campagne(campagne["id"]))
    for contact in nouveaux:
        rang += 1
        base.ajouter_contact_campagne(
            campagne["id"], rang, contact["nom"], contact["telephone"],
            rendezvous_id=contact.get("rendezvous_id"),
            champs=json.dumps(contact.get("champs") or {},
                              ensure_ascii=False),
            client_id=base.client_pour_contact(contact["nom"],
                                               contact["telephone"],
                                               contact.get("rendezvous_id")))
    if nouveaux:
        journal.info("Campagne n°%d : règle rejouée sur la place %s — "
                     "%d personne(s) ajoutée(s)", campagne["id"], creneau,
                     len(nouveaux))
    _noter_regle_jouee(base, campagne["id"], creneau, len(nouveaux), notes)
    return len(nouveaux)


def _noter_regle_jouee(base, campagne_id, creneau, retenus, notes):
    """Writes on the campaign what the rule gave, and what it set aside.

    On the campaign, not in a passing variable: the campaign's screen is read
    back long after the gesture, and recomputing at display time would give a
    different figure from the one that was used.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if campagne is None:
        return
    configuration = configuration_campagne(campagne)
    configuration["regle_jouee"] = {"creneau": creneau, "retenus": retenus,
                                    "notes": list(notes)}
    base.definir_configuration_campagne(
        campagne_id, json.dumps(configuration, ensure_ascii=False))


def mission_sur_la_place(base, preferences, campagne, configuration, horaire):
    """The campaign's message AND INFORMATION, realigned onto ANOTHER slot.

    Returns the pair (message, step-2 information) — or (None, None) when the
    realignment is refused.

    ⚠ REFUSED WHEN THE MESSAGE WAS REWRITTEN BY HAND. It then carries its
    slot's date inside a human sentence: rebuilding it would invent text, and
    leaving it as it stands would have an hour nobody will keep announced on
    the phone. That is exactly the rule the cascade already applies before
    replaying a recipe — one rule, one place of decision.

    ⚠ IT RETURNED THE MESSAGE ALONE, AND THAT WAS THE DEFECT (01/09/2026). The
    information realigned below served to build the message… then was thrown
    away. So the campaign moved to the next slot with an up-to-date message and
    a CONFIGURATION still on the old one — yet it is the configuration that
    feeds the briefing's facts (`what you know`).

    WHAT THAT PRODUCED, measured on his campaign no. 133: the opening said `a
    slot has come free on Friday 2 October 2026 at 9:40` and the facts said
    `Freed slot: Wednesday 2 September 2026 at 9:40` — the slot the FIRST
    contact had just taken. CALL-E refused the task (422) with the exact
    question:

    `What is the correct date of the freed slot to offer Mrs Émilie Aubry?`

    It was right to ask: both dates were in the same submission.
    """
    recette = configuration.get("recette") or {}
    code = INFO_CRENEAU_PAR_NATURE.get(campagne["nature"])
    if not code or recette.get("mission_editee"):
        return None, None
    infos = dict(configuration.get("infos") or {})
    infos[code] = horaire
    # The COMPUTED slot lists are recomputed: announcing yesterday's slots
    # would have already-taken slots offered on the phone.
    a_deplacer = rendezvous_a_deplacer(base, campagne)
    jours_ecartes = jours_a_vider(base, campagne)
    for autre in (configuration.get("infos_auto") or {}):
        infos[autre] = creneaux_annonces(base, preferences,
                                         campagne["nature"],
                                         a_deplacer=a_deplacer,
                                         sauf_jours=jours_ecartes,
                                         durees=durees_a_deplacer(base, campagne))
    return construire_mission(campagne["nature"], infos, preferences,
                              configuration.get("options") or {}), infos


def avancer_sur_la_place_suivante(base, preferences, campagne, configuration):
    """Records the slot as filled and moves to the next.

    Returns (campaign read back, configuration read back, next slot or None,
    the reason for stopping when there is no next one).

    ⚠ WE READ THE CAMPAIGN BACK FROM THE DATABASE. The dictionary the loop
    holds in memory dates from start-up: carrying on with it would write the
    next YES onto the slot ALREADY FILLED — two people at the same hour. It is
    the most serious defect the review of 03/08/2026 found.

    ⚠ WE DO NOT ADVANCE WHEN THE MESSAGE CANNOT FOLLOW. Better a campaign that
    stops while saying so than an agent that announces one date and books
    another.
    """
    # ⚠ IT NO LONGER RECEIVES THE FILLED SLOT. We used to pass it, captured
    # BEFORE the call — yet with several slots announced, the one taken is not
    # necessarily that one. It is the `accepted` branch that marks it, since it
    # alone knows which one the person chose. Here we simply read back and look
    # for the next.
    campagne_id = campagne["id"]
    campagne = base.obtenir_campagne(campagne_id)
    configuration = configuration_campagne(campagne)
    suivante = creneau_courant(campagne, configuration)
    if suivante is None:
        return campagne, configuration, None, "toutes les places sont pourvues"
    mission, infos = mission_sur_la_place(base, preferences, campagne,
                                          configuration, suivante["horaire"])
    if mission is None:
        journal.info("Campagne n°%d : il reste des places, mais le message a "
                     "été récrit à la main — on n'avance pas sans recaler la "
                     "date annoncée", campagne_id)
        return (campagne, configuration, None,
                "il reste des places à pourvoir, mais le message de cette "
                "campagne a été récrit à la main et porte la date de sa "
                "place : l'annoncer sur une autre date aurait fait prendre "
                "un rendez-vous à une heure jamais dite au téléphone")
    # ⚠ THE CONFIGURATION FOLLOWS THE SLOT TOO (01/09/2026). Only the `creneau`
    # column and the message advanced; the step-2 information stayed on the
    # previous slot, and the briefing therefore announced two dates for one
    # slot. The information comes from the SAME computation as the message — it
    # cannot diverge from it.
    a_ecrire = dict(configuration)
    a_ecrire["infos"] = infos
    base.definir_configuration_campagne(
        campagne_id, json.dumps(a_ecrire, ensure_ascii=False))
    base.definir_creneau_campagne(campagne_id, suivante["horaire"], mission)
    campagne = base.obtenir_campagne(campagne_id)
    # ⚠ THE RULE IS REPLAYED HERE, and nowhere else: on the slot that has just
    # been chosen, once the campaign really carries it.
    regenerer_la_liste(base, preferences, campagne,
                       configuration_campagne(campagne))
    journal.info("Campagne n°%d : place pourvue, on passe à la suivante (%s)",
                 campagne_id, suivante["horaire"])
    return campagne, configuration_campagne(campagne), suivante, ""


def ordonner_contacts(contacts, ordre, creneau=None):
    """Applies the calling order CHOSEN at step 2 (never imposed)."""
    def date_rdv(contact):
        return champs_contact(contact).get("rdv_existant", "")
    if ordre == "eloignement":
        # ⚠ THE FURTHEST FIRST, and it is `créneau libéré`'s default. That
        # person has the most to gain from moving forward onto the slot that
        # comes free; somebody whose appointment is already near would gain
        # almost nothing. With no date, they go last: we do not guess.
        return sorted(contacts,
                      key=lambda c: (not date_rdv(c),
                                     _decroissant(date_rdv(c))))
    if ordre == "anciennete":
        return sorted(contacts, key=lambda c: (not date_rdv(c), date_rdv(c)))
    if ordre == "proximite" and creneau:
        creneau_dt = datetime.datetime.fromisoformat(creneau)

        def ecart(contact):
            brut = date_rdv(contact)
            if not brut:
                return (True, datetime.timedelta(0))
            return (False, abs(datetime.datetime.fromisoformat(brut) - creneau_dt))
        return sorted(contacts, key=ecart)
    if ordre == "alphabetique":
        return sorted(contacts,
                      key=lambda c: generation._cle_alphabetique(c["nom"]))
    return list(contacts)  # `liste`: the order of the ranks


# ------------------------------------- is the calendar up to date? (before ▶)
# The work is TWOFOLD (§8.1): moving or booking an appointment changes
# RingBack's LOCAL calendar **and** feeds the change log the operator carries
# over into their own software. Consequence: THE WHOLE product rests on that
# calendar — the slots announced on the phone are deduced from it, and a stale
# calendar leads to offering slots already taken in real life. Hence the
# reminder at the moment of starting.  This function decides nothing and
# estimates nothing: it GATHERS THE FACTS from the database and the settings,
# at the instant of the click. What does not exist (the date of the last import
# when nothing was ever imported) is None and will show as `unknown` — never an
# invented value.
def _prochaines_annoncees(base, preferences, campagne, maintenant,
                          sauf_places, sauf_jours, combien=3):
    """The first slots the agent will REALLY announce — exclusions included.

    The pre-start panel has one reason to exist: letting him compare those
    dates with his real schedule. So they must come out of the same computation
    as the message — the same days set aside, the same slots set aside, and the
    same separation by length (a 20-minute slot is not offered for a 40-minute
    session).
    """
    durees = durees_a_deplacer(base, campagne) or {1: 0}
    pas = horaires.pas_minutes(preferences)
    blocs = []
    for tranches in sorted(durees):
        texte = horaires.places_a_proposer(
            base, preferences, tranches=tranches, depuis=maintenant,
            limite=combien, sauf_places=sauf_places,
            sauf_jours=sauf_jours)[0]
        if not texte:
            continue
        blocs.append(f"pour un rendez-vous de {tranches * pas} minutes : "
                     f"{texte}")
    if not blocs:
        return ""
    if len(blocs) == 1:
        # A single length: no label, it is the common case.
        return blocs[0].split(" : ", 1)[1]
    return " ; ".join(blocs)


def verification_agenda(base, preferences, campagne, contacts=None,
                        maintenant=None):
    """The real facts about the calendar, just before starting THIS campaign.

    Returns a dictionary:
    - `debut`, `fin`: the period the campaign touches (the horizon of offerable slots, widened to the campaign's own dates);
    - `rendezvous`, `occupants`: the appointments known over that period, and those really occupying a slot;
    - `places`, `places_manuelles`, `prochaines`: what RingBack can offer now (computed + added by hand), and the start of the list as it will be announced;
    - `creneaux`: `calcules` (recomputed before every call), `a_la_main` (a list written by the user, never recomputed) or `aucun`;
    - `import`: the trace of the last file import, or None;
    - `alertes`: the OBJECTIVE signs that the calendar is doubtful.
    """
    maintenant = (maintenant or datetime.datetime.now()).replace(
        second=0, microsecond=0)
    configuration = configuration_campagne(campagne)
    if contacts is None:
        contacts = base.contacts_de_campagne(campagne["id"])
    contacts = list(contacts)
    # 1. The period concerned: the horizon of offerable slots, widened to the
    # dates the campaign really touches (a contact's existing appointment may
    # fall well beyond that horizon).
    debut = maintenant
    fin = maintenant + datetime.timedelta(days=horaires.HORIZON_JOURS)
    dates = [campagne.get("creneau")]
    for contact in contacts:
        dates.append(champs_contact(contact).get("rdv_existant"))
        if contact.get("rendezvous_id"):
            rdv = base.obtenir_rendezvous(contact["rendezvous_id"])
            if rdv:
                dates.append(rdv["horaire"])
    for brut in dates:
        try:
            moment = datetime.datetime.fromisoformat(brut)
        except (TypeError, ValueError):
            continue
        debut = min(debut, moment)
        fin = max(fin, moment + datetime.timedelta(minutes=1))
    # 2. What the database knows over that period (no estimated figure).
    connus = base.rendezvous_de_periode(debut.isoformat(timespec="minutes"),
                                        fin.isoformat(timespec="minutes"))
    occupants = [rdv for rdv in connus
                 if rdv["statut"] in horaires.STATUTS_OCCUPANTS]
    # 3. What RingBack can offer at that instant — the SAME exclusions as the
    # slots announced on the phone, never another computation.  ⚠ THIS
    # PARAGRAPH ALREADY PROMISED `the SAME source`, and it was lying (measured
    # on 17/08/2026). The call was made without the days the campaign is
    # emptying, without the slots it frees and without the lengths: on his
    # campaign of 18/08, the panel announced `the first slots it will announce:
    # 18/08 at 09:00, 09:40, 10:20` — three slots from the very day he was
    # emptying —, while the campaign's message did start on 19/08. And it is
    # the ONLY screen made for him to check: it showed him dates that would
    # never be spoken, while inviting him to stop everything should they not
    # suit him.
    sauf_places = places_a_vider(base, campagne)
    sauf_jours = jours_a_vider(base, campagne)
    proposables = horaires.creneaux_proposables(base, preferences,
                                                depuis=maintenant)
    places = [entree for entree in proposables
              if not entree["occupe"]
              and entree["horaire"] not in sauf_places
              and entree["horaire"][:10] not in sauf_jours]
    manuelles = [entree for entree in places if entree["origine"] == "à la main"]
    # 4. Does this campaign announce slots, and which ones?
    auto = configuration.get("infos_auto") or {}
    mission = campagne.get("mission") or ""
    # A slot is only `announced` when it really appears IN the message: a
    # filled-in list whose sentence does not enter the text (a segment
    # conditioned by an unticked option) announces nothing at all.
    a_la_main = [configuration["infos"].get(info["code"]) or ""
                 for info in NATURES.get(campagne.get("nature"),
                                         {}).get("infos", ())
                 if info.get("reglage") == "creneaux_lisibles"]
    if any(valeur and valeur in mission for valeur in auto.values()):
        creneaux = "calcules"
    elif any(valeur and valeur in mission for valeur in a_la_main):
        creneaux = "a_la_main"
    else:
        creneaux = "aucun"
    # 5. The OBJECTIVE signs that there is a problem — stated frankly.
    alertes = []
    semaine_reglee = horaires.semaine_ouverte(preferences)
    if not semaine_reglee:
        alertes.append(
            "Aucune semaine type n'est réglée : RingBack ne sait pas quand "
            "vous êtes ouvert, il ne peut donc calculer AUCUNE place libre.")
    if not connus:
        alertes.append(
            "Aucun rendez-vous n'est connu sur la période concernée : si "
            "votre planning n'est pas vide dans la vraie vie, c'est que "
            "l'agenda de RingBack n'est pas à jour.")
    if semaine_reglee and not places and creneaux == "calcules":
        alertes.append(
            "Aucune place libre n'est calculée : l'agent n'aurait aucun "
            "créneau à annoncer au téléphone.")
    trace = horaires.dernier_import_agenda(preferences)
    return {
        "debut": debut, "fin": fin, "horizon": horaires.HORIZON_JOURS,
        "rendezvous": len(connus), "occupants": len(occupants),
        "places": len(places), "places_manuelles": len(manuelles),
        "prochaines": _prochaines_annoncees(base, preferences, campagne,
                                            maintenant, sauf_places,
                                            sauf_jours),
        "creneaux": creneaux,
        "semaine_reglee": semaine_reglee,
        "a_appeler": sum(1 for c in contacts if c["etat"] == "à appeler"),
        "import": trace,
        "import_jours": ((maintenant - trace["moment"]).days
                         if trace else None),
        "alertes": alertes,
    }


# --------------------------------------------------- change log A campaign's
# real deliverable is not `calls placed`: it is the list of changes to be
# CARRIED OVER into the establishment's scheduling software. Four kinds, and
# nothing else — the §8.1 table.
GENRES_CHANGEMENT = {
    "ajout": ("➕", "Rendez-vous ajouté"),
    "suppression": ("➖", "Rendez-vous supprimé"),
    "deplacement": ("↔", "Rendez-vous déplacé"),
    "humain": ("🙋", "À traiter par un humain"),
    # ⚠ THAT CHANGE DOES NOT TOUCH THE SCHEDULE, and it still has its row: it
    # is the only place that keeps WHEN and WHY a contact stopped being
    # callable. Without it, a 🚫 set on the phone would be indistinguishable
    # from a 🚫 set by hand six months earlier.
    "ne_plus_appeler": ("🚫", "Ne plus appeler — demandé au téléphone"),
    # ⚠ GENTLER THAN THE 🚫, and that is why it has its own row: the person
    # stays callable about THEIR OWN appointments, they only refuse to be
    # offered freed slots.
    "plus_de_proposition": ("🔇", "Ne plus proposer de créneau — demandé au "
                                  "téléphone"),
    # ⚠ ADDED ON 11/08/2026 along with the human call-back rule. On a
    # freed-slot campaign, a non-conclusive answer moves the person's
    # appointment to `confirmé` (see _confirmer_le_rendezvous). It is a change
    # of STATUS, not of date: neither an addition, nor a move, nor a deletion —
    # hence its own row. And it MUST have one: the operator has that status to
    # carry over into their own software.
    "confirmation": ("✅", "Rendez-vous confirmé"),
    # ⚠ ADDED ON 17/08/2026 along with his rule: `if the person has to call
    # back, the appointment is simply cancelled`. Neither a deletion (the row
    # stays on the schedule) nor a move (no new date): its own row.
    "annulation": ("✖", "Rendez-vous annulé"),
}

# The two kinds that REMOVE an appointment from the schedule. They carry the
# same information — a date coming free — and are therefore read the same way:
# it is the OLD date that is shown, never a new one (there is none).  ⚠ WHICH
# ONE IS WRITTEN is decided in `horaires.genre_de_retrait`, beside the rule
# that decides the status: the log's word therefore cannot diverge from the
# appointment's state. That was defect no. 5 of 18/08/2026.
GENRES_QUI_RETIRENT = ("suppression", "annulation")


# The export's columns, in the order they are read.
COLONNES_CAHIER = ("Changement", "Qui", "Ancienne date", "Nouvelle date",
                   "Motif", "Durée", "Pourquoi / demande")


def duree_lisible_tranches(preferences, tranches):
    """`30 minutes` from a number of slots — the length FOLLOWS the appointment.
    """
    try:
        nombre = max(int(tranches or 1), 1)
    except (TypeError, ValueError):
        nombre = 1
    return horaires.duree_lisible(nombre * horaires.pas_minutes(preferences))


def noter_changement(base, campagne, contact, genre, nom=None, **details):
    """Writes ONE row of the log, at the very moment the schedule moves.

    Recording at the moment of the change rather than reconstructing
    afterwards: it is the only way to guarantee no change is lost (a contact
    state overwritten by a follow-up would erase the trace).
    """
    contact_id = contact["id"] if contact else None
    return base.ajouter_changement(
        campagne["id"], genre, nom or (contact["nom"] if contact else ""),
        contact_id=contact_id, **details)


def ligne_cahier(changement):
    """ONE row of the log, readable at a glance, nothing to deduce.

    The dates are in French (`le 03/08/2026 à 09h00`) because somebody is going
    to RETYPE them into another program.
    """
    icone, libelle = GENRES_CHANGEMENT.get(changement["genre"],
                                           ("•", changement["genre"]))
    morceaux = [f"{icone} {libelle}", changement["nom"]]
    if changement["genre"] == "deplacement":
        morceaux.append(f"du {date_courte(changement['ancienne_date'])} "
                        f"au {date_courte(changement['nouvelle_date'])}")
    elif changement["genre"] in GENRES_QUI_RETIRENT:
        morceaux.append(themes.date_lisible(changement["ancienne_date"]))
    elif changement["nouvelle_date"]:
        morceaux.append(themes.date_lisible(changement["nouvelle_date"]))
    if changement["motif"]:
        morceaux.append(f"motif : {changement['motif']}")
    if changement["duree"]:
        morceaux.append(f"durée : {changement['duree']}")
    if changement["raison"]:
        etiquette = ("demande" if changement["genre"] == "humain"
                     else "pourquoi")
        morceaux.append(f"{etiquette} : {changement['raison']}")
    return " — ".join(morceaux)


def cellules_cahier(changement):
    """A change's export cells, in the order of COLONNES_CAHIER."""
    _, libelle = GENRES_CHANGEMENT.get(changement["genre"],
                                       ("•", changement["genre"]))
    return [libelle, changement["nom"],
            themes.date_lisible(changement["ancienne_date"]),
            themes.date_lisible(changement["nouvelle_date"]),
            changement["motif"], changement["duree"], changement["raison"]]


def cahier_texte(changements, titre=""):
    """The log as plain text — it is THAT text the `Copier` button copies."""
    lignes = []
    if titre:
        lignes += [titre, "=" * len(titre), ""]
    if not changements:
        lignes.append("Aucun changement à reporter pour l'instant.")
        return "\n".join(lignes) + "\n"
    for changement in changements:
        lignes.append(ligne_cahier(changement))
    lignes += ["", f"{len(changements)} changement(s) à reporter."]
    return "\n".join(lignes) + "\n"


def cahier_csv(changements):
    """The log as CSV (semicolon), generated on the fly, never stored.

    csv.writer rather than a `;`.join: a client's request, noted in clear, may
    contain a semicolon or a quotation mark — it must come out intact in the
    spreadsheet.
    """
    tampon = io.StringIO()
    graveur = csv.writer(tampon, delimiter=";", lineterminator="\r\n")
    graveur.writerow(COLONNES_CAHIER)
    for changement in changements:
        graveur.writerow(cellules_cahier(changement))
    return tampon.getvalue()


def resume_cahier(changements):
    """The count by kind, in §8.1's order — for the record's banner."""
    return [(genre, icone, libelle,
             sum(1 for c in changements if c["genre"] == genre))
            for genre, (icone, libelle) in GENRES_CHANGEMENT.items()]


def changement_mis_en_avant(changements):
    """The move that met the need (§8.2), or None.

    `The summary highlights the contact who MODIFIED their appointment`: it is
    the log's last ↔ — the one that concluded the campaign.
    """
    deplacements = [c for c in changements if c["genre"] == "deplacement"]
    return deplacements[-1] if deplacements else None


# ------------------------------------------------------------- execution
def _nombre_tentatives(base, contact_id):
    return len(base.appels_du_contact_campagne(contact_id))


def _rendezvous_manque_par_la_relance(base, contact_id, echeance, maintenant):
    """The appointment the follow-up would MISS, otherwise None.

    The appointment is read where it is: the linked column when the list comes
    from the schedule or the database, the date typed in when it comes from a
    paste. With no appointment — a booking, for instance — there is nothing to
    get ahead of, and the follow-up keeps its due date.
    """
    contact = base.obtenir_contact_campagne(contact_id)
    if contact is None:
        return None
    horaire = None
    if contact.get("rendezvous_id"):
        rdv = base.obtenir_rendezvous(contact["rendezvous_id"])
        if rdv:
            horaire = rdv["horaire"]
    if not horaire:
        horaire = champs_contact(contact).get("rdv_existant")
    if not horaire:
        return None
    instant = maintenant.isoformat(timespec="minutes")
    if horaire > instant and echeance >= horaire:
        return horaire
    return None


def _apres_non_joint(base, preferences, campagne, options, contact_id,
                     issue, maintenant=None):
    """No answer (or a technical failure): a reminder scheduled, or `injoignable`
    when the MAXIMUM NUMBER OF REMINDERS is reached — never a spontaneous call:
    the recorded reminder waits for the `Lancer les relances` gesture.

    ⚠ THE MAXIMUM APPLIES EVERYWHERE, SIMULATION INCLUDED (21/08/2026, his
    decision). He had asked for the opposite on 18/08 — `in simulation mode, we
    must not do the ceiling-reached ending` —, and it was for a good reason:
    his test campaigns stopped there without him seeing what followed. Two
    things have changed since:

    · WHAT BOTHERED HIM IS SETTLED ANOTHER WAY. At the maximum number of
    reminders, a move campaign now CANCELS the appointment, frees the slot and
    sends the person to a human call-back (20/08). It is no longer a dead end.

    · LIFTING IT HAD NO BOUND, and a test showed it: maximum set to 3, THIRTEEN
    reminders armed in twelve rounds, endlessly — hence no appointment ever
    cancelled in simulation. A simulation that behaves differently from the
    real thing no longer predicts the real thing.
    """
    tentatives = _nombre_tentatives(base, contact_id)
    maximum = maximum_rappels(preferences, options)
    if options.get("recontacter", True) and tentatives <= maximum:
        echeance = echeance_relance_campagne(preferences, options, maintenant)
        # ⚠ NEVER A FOLLOW-UP THAT WOULD RING AFTER THE APPOINTMENT — his
        # defect no. 12 of 18/08/2026. The due date is computed from NOW (a
        # delay in working hours, or a daily call-back window) without ever
        # looking at the date we want to talk to the person about.  REPRODUCED:
        # appointment tomorrow at 08:00, unanswered call this evening,
        # call-back window set 12:00-14:00 → follow-up scheduled tomorrow at
        # 12:00, FOUR HOURS after the appointment. We would have called
        # somebody to move an appointment already past — or that they had just
        # missed. It is the common case of a campaign emptying the next day.
        # So nothing is scheduled, and the contact goes to a human: something
        # REMAINS to be done, and only a person can do it in time. The same
        # terminal state as the other dead ends (see
        # `noter_reponse_illisible`): no follow-up, no ceiling approached.
        trop_tard = _rendezvous_manque_par_la_relance(
            base, contact_id, echeance,
            maintenant or datetime.datetime.now())
        if trop_tard:
            base.changer_etat_contact_campagne(
                contact_id, "à rappeler par un humain", issue)
            base.definir_detail_contact(
                contact_id,
                f"Pas de réponse. AUCUNE relance programmée : elle serait "
                f"tombée le {date_courte(echeance)}, après son rendez-vous du "
                f"{date_courte(trop_tard)} — trop tard pour lui servir. "
                "Appelez cette personne vous-même.")
            noter_changement(base, campagne,
                             base.obtenir_contact_campagne(contact_id),
                             "humain",
                             ancienne_date=trop_tard,
                             raison="pas de réponse, et une relance serait "
                                    "tombée après son rendez-vous : à appeler "
                                    "par un humain.")
            journal.info("Campagne n°%d, contact n°%d : relance NON programmée "
                         "(%s tomberait après le rendez-vous du %s)",
                         campagne["id"], contact_id, echeance, trop_tard)
            return
        base.creer_relance(campagne["id"], contact_id, echeance,
                           tentative=tentatives,
                           motif=campagnes.MOTIFS_RELANCE.get(issue, issue))
        base.changer_etat_contact_campagne(contact_id, "à recontacter", issue)
        base.definir_detail_contact(contact_id, None)
    else:
        base.changer_etat_contact_campagne(contact_id, "injoignable", issue)
        base.definir_detail_contact(
            contact_id, f"{tentatives} tentative(s) — maximum de rappels "
            "atteint, "
                        "à traiter par un humain")


MOTIF_LIBERATION_CRENEAU = "le client a pris le créneau proposé"
MOTIF_LIBERATION_AUTRE_DATE = "le client a convenu d'une autre date"


def _liberer_ancien_rendezvous(base, preferences, campagne, options, contact,
                               pourquoi=MOTIF_LIBERATION_CRENEAU,
                               maintenant=None, deplace_vers=None,
                               nouveau_rdv_id=None, trace=None):
    """A YES frees the client's old appointment (never two appointments for the
    same person). Returns a readable description, or "".

    A contact taken from the database: THEIR appointment leaves the schedule —
    with the status horaires.decision_annulation decides, the owner's rule held
    in one place (`supprimé` when it is ahead of us, `annulé` when it is
    already past: the history status). A pasted contact: when an appointment
    for the same client at the same time exists in the database, it meets the
    same fate; otherwise the date typed in is recalled (the calendar is
    elsewhere). When the `free their slot` option is ticked, the freed time
    joins the settings' available slots (visible in ⚙ Réglages). In both cases,
    a ➖ row enters the change log: it is a deletion to be carried over into the
    scheduling software, and it carries WHO, WHEN, the REASON and the WHY —
    that is where the history lives.

    ⚠ `deplace_vers` CHANGES THE NATURE OF THE GESTURE (owner's decision of
    03/08/2026). With a date, the client cancelled nothing: their appointment
    MOVED. The old one then takes the status `déplacé` — not `supprimé`, not
    `annulé` — and the log carries ONE ↔ row with both its dates, instead of a
    deletion + addition pair that would tell of two gestures for one. The old
    row stays in the database: the departure time survives even should the
    campaign be erased one day, which the log alone would not have allowed. ⚠
    `déplacé` is already in STATUTS_SANS_PLACE: the slot left behind therefore
    becomes free again, exactly as before.
    """
    ancien = None
    if contact.get("rendezvous_id"):
        ancien = base.obtenir_rendezvous(contact["rendezvous_id"])
    date_saisie = champs_contact(contact).get("rdv_existant", "")
    if ancien is None and date_saisie:
        telephone = base.telephone_contact_campagne(contact["id"])
        ancien = base.rendezvous_identique(contact["nom"], telephone,
                                           date_saisie)
    if ancien is not None and ancien["statut"] in ("prévu", "confirmé",
                                                   "manqué"):
        duree = duree_lisible_tranches(preferences,
                                       horaires.duree_tranches(ancien))
        if deplace_vers:
            # ⚠ ONE SINGLE ROW, WHICH CHANGES DATE (owner's decision of
            # 14/08/2026: `you move an appointment from one date to another,
            # it's dead simple`). BEFORE: a SECOND row was created at the new
            # date and the old one was marked `déplacé` — so it stayed in the
            # calendar, and he saw two appointments for one move, one of them a
            # `déplacé` that was never deleted.  The history is not lost for
            # all that: the change log carries ONE ↔ row with both dates, and
            # IT is the campaign's deliverable. A ghost row in the calendar was
            # not a memory, it was a duplicate.
            base.mettre_a_jour_rendezvous(ancien["id"], statut="confirmé",
                                          horaire=deplace_vers)
            # The caller MUST know a row has moved: without that it would
            # create a second one at the same hour, and we would fall straight
            # back into the defect we have just removed.
            if trace is not None:
                trace["rendezvous_id"] = ancien["id"]
                trace["ancienne_date"] = ancien["horaire"]
            noter_changement(
                base, campagne, contact, "deplacement",
                client_id=ancien.get("client_id"),
                rendezvous_id=ancien["id"],
                ancienne_date=ancien["horaire"], nouvelle_date=deplace_vers,
                motif=ancien.get("motif") or "", duree=duree,
                raison=f"rendez-vous avancé sur une place libérée : {pourquoi}")
        else:
            decision = horaires.decision_annulation(
                preferences, ancien["horaire"], maintenant)
            base.mettre_a_jour_rendezvous(ancien["id"],
                                          statut=decision["statut"])
            noter_changement(
                base, campagne, contact, horaires.genre_de_retrait(decision["statut"]),
                client_id=ancien.get("client_id"), rendezvous_id=ancien["id"],
                ancienne_date=ancien["horaire"],
                motif=ancien.get("motif") or "", duree=duree,
                raison=f"place libérée : {pourquoi} — {decision['pourquoi']}")
        if options.get("liberer_creneau", True):
            creneaux = list(preferences.obtenir(themes.CLE_CRENEAUX) or [])
            if ancien["horaire"] not in creneaux:
                creneaux.append(ancien["horaire"])
                creneaux.sort()
                preferences.definir(themes.CLE_CRENEAUX, creneaux)
        if deplace_vers:
            return (f"son rendez-vous du "
                    f"{date_courte(ancien['horaire'])} a été DÉPLACÉ ici et "
                    "confirmé — une seule ligne d'agenda, l'ancienne place "
                    "redevient libre")
        return (f"ancien rendez-vous du "
                f"{date_courte(ancien['horaire'])} libéré "
                f"({decision['statut']})")
    if date_saisie:
        # The date is known (it comes from the list), but the appointment is
        # not in RingBack: the ➖ row keeps its full meaning — it is in YOUR
        # software that it must be removed. Nothing was deleted here, and the
        # reason says so.
        noter_changement(
            base, campagne, contact, "suppression",
            ancienne_date=date_saisie,
            motif=champs_contact(contact).get("motif") or "",
            raison=f"ancien rendez-vous à libérer dans votre agenda : "
                   f"{pourquoi}, mais ce rendez-vous n'est pas dans "
                   "RingBack — rien n'a été supprimé ici.")
        return (f"ancien rendez-vous du "
                f"{date_courte(date_saisie)} à libérer dans "
                "votre agenda (introuvable dans la base)")
    return ""


def tranches_du_contact(base, contact):
    """The length THIS contact requires, in slots (1 when they have no
    appointment).

    A client whose appointment lasts 30 minutes (2 slots of 15) must not be
    offered a 15-minute gap.
    """
    if contact.get("rendezvous_id"):
        rdv = base.obtenir_rendezvous(contact["rendezvous_id"])
        if rdv:
            return horaires.duree_tranches(rdv)
    return 1


# The kinds whose purpose is to EMPTY slots, not to fill them. On those, the
# slots the campaign frees must never be re-offered: see `places_a_vider`.
NATURES_QUI_VIDENT = ("deplacement",)

# The kinds where a YES makes somebody LEAVE a slot. They are the only ones the
# `shift in cascade` option concerns: it commands nothing but the fate of that
# slot (see `_rendre_la_place` and `_suite_de_cascade`). A reminder, a
# confirmation and a booking move nobody — the box was tickable there and
# perfectly inert until 14/08/2026.
NATURES_QUI_LIBERENT_UNE_PLACE = ("creneau_libere", "deplacement")


def nature_porte_un_rendezvous(nature):
    """Do this kind's contacts have an `existing appointment` column?

    It is that column the two date-based calling orders sort on (see
    `ordonner_contacts`). Without it — the booking case — offering them left
    the order UNCHANGED, and the record then announced an order that had never
    been applied (14/08/2026, cross audit).
    """
    fiche = fiche_nature(nature) or {}
    return any(champ["code"] == "rdv_existant"
               for champ in fiche.get("champs", ()))


def places_a_vider(base, campagne):
    """The slots THIS campaign is emptying — never re-offered.

    ⚠ THE GAP FOUND BY THE 14/08/2026 AUDIT, and it is the most visible of all.
    A `Déplacement de rendez-vous` campaign set to `call the whole list` serves
    to EMPTY a range — the case the product itself claims: `empty a whole day`.
    Yet the replacement slots are recomputed before every call: as soon as the
    first patient agrees to leave, the slot they vacate becomes free again… and
    the agent offered it to the next patient. The campaign was filling the slot
    it was meant to empty.

    So we set aside the slots of its own contacts' appointments — those already
    gone as well as those still to be called. On the other kinds, nothing to
    set aside: they empty nothing (see NATURES_QUI_VIDENT).
    """
    if campagne.get("nature") not in NATURES_QUI_VIDENT:
        return ()
    vides = set()
    for contact in base.contacts_de_campagne(campagne["id"]):
        horaire = champs_contact(contact).get("rdv_existant")
        if horaire:
            vides.add(horaire)
        if contact.get("rendezvous_id"):
            rdv = base.obtenir_rendezvous(contact["rendezvous_id"])
            if rdv:
                vides.add(rdv["horaire"])
    return tuple(sorted(vides))


def places_du_contact(base, preferences, contact, sauf_places=(),
                     sauf_jours=()):
    """What there is to offer TO THIS CONTACT, at this instant: (text, 1st slot).

    ONE SINGLE computation, at the right length. It is what feeds both the list
    announced in the message and the reference date sent to the agent: so the
    two cannot diverge, and the slot offered on the phone is always the first
    of those announced.

    `sauf_places`: the slots the campaign empties and must not re-offer.
    `sauf_jours`: the DAYS it empties — set aside entirely, down to the gaps
    that never carried an appointment (see `jours_a_vider`).
    """
    return horaires.places_a_proposer(
        base, preferences, tranches=tranches_du_contact(base, contact),
        sauf_places=sauf_places, sauf_jours=sauf_jours)


def stock_du_contact(base, preferences, contact, campagne):
    """The negotiation STOCK recomputed FOR THIS CONTACT, or "" — their length,
    and the slots their campaign is emptying.

    ⚠ WHY TAKING `adaptee` BACK IS NOT ENOUGH (measured on 24/08/2026).
    `adaptee` comes from `places_du_contact`, that is, the SIX next free slots:
    enough to open the conversation, not enough to negotiate. On a campaign of
    eleven moves, the campaign recorded 77 slots and the agent only heard 6 —
    all in the same morning, within 1 h 15. That is exactly the ending his
    request of 16/08/2026 had had fixed: `the first six follow one another […]
    so the agent had nothing to negotiate: "no" on the first meant "no" on all
    six.`

    ⚠ AND THE STOCK FOLLOWS WHAT REMAINS TO BE MOVED, as everywhere else: it is
    recomputed at every call, so it shrinks with the queue (his rule of 17/08 —
    seven slots per appointment left to rebook).

    ⚠ IT IS NOT `valeur_calculee_info`, and that is intended: that one reasons
    at CAMPAIGN level (it knows how to make one list per length). Here the
    length is known — it is that of the person being called — and only one list
    makes sense. The exclusions, though, are the same as elsewhere.
    """
    if campagne is None or campagne.get("nature") not in NATURES_A_STOCK_VARIE:
        return ""
    return horaires.creneaux_negociables(
        base, preferences, tranches=tranches_du_contact(base, contact),
        sauf_places=places_a_vider(base, campagne),
        a_deplacer=rendezvous_a_deplacer(base, campagne),
        sauf_jours=jours_a_vider(base, campagne))


def creneaux_adaptes_au_contact(base, preferences, configuration, contact,
                                mission, adaptee=None, campagne=None):
    """Recomputes the slot list JUST BEFORE the call — length included.

    Two reasons, one operation:
    1. the list was computed when the campaign was CREATED; in the meantime slots may have been taken, days declared closed. We only offer on the phone what is free at that precise instant;
    2. a client whose appointment lasts 30 minutes (2 slots of 15) must not be offered a 15-minute gap.
    It only acts on a COMPUTED list left as it stands (configuration["infos_auto"]): a list retyped by hand is never touched, and if the text was modified to the point that the old list no longer appears in it, we replace nothing — never invented text.

    adaptee: the list already computed by places_du_contact, when the caller
    has it to hand (it also uses it as the reference date) — we then do not
    recompute a second time, which guarantees that the message and the slot
    offered do come out of the SAME computation.
    """
    auto = configuration.get("infos_auto") or {}
    if not auto:
        return mission
    tranches = tranches_du_contact(base, contact)
    if adaptee is None:
        adaptee = horaires.places_a_proposer(base, preferences,
                                             tranches=tranches)[0]
    if not adaptee:
        return mission
    # ⚠ THE FIRST SLOT COMES OUT OF THE SAME COMPUTATION, by construction: the
    # text is built by `", ".join(...)` over the list of which
    # `places_a_proposer` ALSO returns the first element. Its first segment IS
    # therefore the reference slot sent to the agent — never a second
    # computation that could diverge.
    premiere = adaptee.split(", ")[0]
    # ⚠ AND THE STOCK IS A STOCK (24/08/2026). With no campaign to hand — old
    # callers, tests — we fall back on `adaptee`: that is the previous
    # behaviour, never worse.
    stock = stock_du_contact(base, preferences, contact, campagne) or adaptee
    remplacements = {}
    for code, valeur in auto.items():
        if not valeur or valeur not in mission:
            continue
        # ⚠ EACH BY ITS OWN SETTING (24/08/2026). This link wrote the STOCK
        # into both: the field `Créneau proposé en premier` — the one the
        # conduct dictated to the agent calls `a single date, not the list` —
        # received six dates. The same defect had been fixed on 17/08 at the
        # draft refresh and at the cascade resumption; the third link, the one
        # at call time, had kept it.
        neuve = (premiere if reglage_du_code(code) == "creneau_le_plus_proche"
                 else stock)
        if neuve and neuve != valeur:
            remplacements[valeur] = neuve
    if not remplacements:
        return mission
    journal.info("Créneaux recalculés à l'instant de l'appel pour le "
                 "contact n°%d (%d tranche(s) consécutive(s) exigée(s))",
                 contact["id"], tranches)
    return _remplacer_en_une_passe(mission, remplacements)


# ⚠ IN A SINGLE PASS, AND THAT IS THE WHOLE POINT. The values contain one
# another: `le mardi 25 août 2026 à 9 heures` is a PREFIX of `le mardi 25 août
# 2026 à 9 heures 15`, and the date alone is a prefix of the list starting with
# it. Two `str.replace` in a row therefore have the second bite into what the
# first has just written — measured on 24/08/2026: the line `Créneaux
# disponibles pour négocier` dictated to the agent repeated the same list four
# times and ended `… à 10 heures 15 15`.  One expression, tried from longest to
# shortest: `re.sub` advances without ever rereading what it has written, and
# the longest alternative wins.
def _remplacer_en_une_passe(texte, remplacements):
    """Replaces each value with its own, without any biting into another."""
    valeurs = sorted((v for v in remplacements if v), key=len, reverse=True)
    if not valeurs:
        return texte
    motif = re.compile("|".join(re.escape(valeur) for valeur in valeurs))
    return motif.sub(lambda trouve: remplacements[trouve.group(0)], texte)


# ⚠ ONE CODE, ONE SETTING — whatever the kind carrying the information. That is
# what makes it possible to find the setting where the kind is not to hand,
# without changing the signature of three functions and their tests. A test
# checks it on EVERY kind: the day two of them gave two settings to the same
# code, it will say so before this shortcut becomes a lie.
def reglage_du_code(code):
    """The setting of this computed information, or None when it has none."""
    for definition in NATURES.values():
        for info in definition.get("infos", ()):
            if info["code"] == code and info.get("reglage"):
                return info["reglage"]
    return None


def annonce_des_places_calculees(configuration, mission):
    """Does this message announce slots COMPUTED by RingBack?

    `infos_auto` only contains values computed from the calendar — and there
    are TWO SORTS, not to be confused (see `valeur_calculee_info`): the
    negotiation STOCK (`créneaux de remplacement`, `créneaux proposés`,
    `créneaux d'annulation`) and THE date the opening message names (`créneau
    le plus proche`). Here it does not matter which: the question is only `does
    this message announce slots RingBack computed?`.

    ⚠ THIS DOCUMENTATION CLAIMED `ONLY lists of slots`, and it had always been
    false — `creneau_le_plus_proche` enters it too. Three functions were
    written on that sentence and therefore treated both as stock. Documentation
    that lies costs as much as code that lies: it cost him his day of
    17/08/2026.

    A value retyped by hand leaves `infos_auto` — it then belongs to the
    operator, and RingBack no longer touches it.
    """
    auto = configuration.get("infos_auto") or {}
    return any(valeur and valeur in mission for valeur in auto.values())


# ⚠ WHICH KIND WANTS A VARIED STOCK (16/08/2026, his request). The move
# NEGOTIATES: you need enough to answer `Tuesday rather` or `the afternoon
# rather`. The other kinds simply announce the next slots, and that is quite
# right — an appointment reminder has nothing to negotiate.
NATURES_A_STOCK_VARIE = ("deplacement",)

# ⚠ THOSE THAT OFFER A SLOT ON A CANCELLATION (31/08/2026, his request). They
# do not negotiate — they quote a few dates out loud, one by one. They used to
# announce the next six free slots, all on the same morning; they now announce
# DIFFERENT days, less than seven days out. See
# horaires.places_de_remplacement.
NATURES_A_PLACES_DE_REMPLACEMENT = ("confirmation", "rappel_rdv")


def durees_a_deplacer(base, campagne):
    """The lengths to rebook and their count: {slots: how many}.

    ⚠ HIS RULE OF 17/08/2026: `we provide slots of a length equivalent to the
    lengths of the appointments we want to cancel. So we must make several
    lists of offers according to the appointments' length`.

    MEASURED ON HIS DAY OF 18/08: ten 20-minute appointments and THREE
    40-minute ones. The two slot lists are not the same — a 20-minute gap
    cannot take a 40-minute session. The message carried only one, the
    20-minute one: three people were therefore offered times where their
    appointment does not fit.
    """
    if campagne.get("nature") not in NATURES_A_STOCK_VARIE:
        return {}
    comptes = {}
    for contact in base.contacts_de_campagne(campagne["id"]):
        if contact["etat"] not in ("à appeler", "en cours"):
            continue
        tranches = tranches_du_contact(base, contact)
        comptes[tranches] = comptes.get(tranches, 0) + 1
    return comptes


def durees_du_brouillon(base, brouillon):
    """The same lengths, before the campaign exists (step 2 and `Valider`)."""
    if brouillon.get("nature") not in NATURES_A_STOCK_VARIE:
        return {}
    comptes = {}
    # ⚠ A DRAFT CONTACT ALREADY CARRIES `rendezvous_id` — verified on
    # 17/08/2026. My first version looked for the appointment by its TIME and
    # found none: the eleven contacts all came out at one slot, and the second
    # list did not exist. The same reading as the campaign does the job.
    for contact in (brouillon.get("contacts") or []):
        tranches = tranches_du_contact(base, contact)
        comptes[tranches] = comptes.get(tranches, 0) + 1
    return comptes


def etiquette_duree(preferences, tranches):
    """`for a 40-minute appointment` — a length list's heading.

    ⚠ ONE PLACE WRITES IT. The stock puts it before each list (`_par_duree`),
    step 2 puts it above each field, and the server reads it back to reassemble
    what was typed. Three writings of the same heading would have ended up
    disagreeing by a word — and the read-back would have returned empty lists
    without saying anything.
    """
    return f"pour un rendez-vous de {tranches * horaires.pas_minutes(preferences)} minutes"


def listes_par_duree(preferences, valeur, durees):
    """The stock SPLIT into {slots: text} — the inverse of `_par_duree`.

    A single length: the whole text goes to it, with no heading — that is how
    it is written, and step 2 then shows only one field.
    """
    ordre = sorted(durees) or [1]
    if len(ordre) == 1:
        return {ordre[0]: valeur}
    listes = {}
    for tranches in ordre:
        marque = etiquette_duree(preferences, tranches) + " : "
        if marque in valeur:
            listes[tranches] = valeur.split(marque, 1)[1].split(" ; ")[0].strip()
        else:
            listes[tranches] = ""
    return listes


def recomposer_par_duree(preferences, valeurs, durees):
    """Reassembles the texts typed in — one per length — into the stored form.

    ⚠ THE FIELDS' ORDER IS THAT OF THE SORTED LENGTHS, on both sides: it is the
    same source (`durees_du_brouillon`) that decides the display and the
    read-back. Two different orders would have reassembled the 40-minute list
    under the 20-minute heading.
    """
    ordre = sorted(durees) or [1]
    if len(ordre) == 1:
        return " ".join((valeurs[0] if valeurs else "").split())
    blocs = []
    for tranches, texte in zip(ordre, list(valeurs) + [""] * len(ordre)):
        texte = " ".join((texte or "").split())
        if not texte:
            continue
        blocs.append(f"{etiquette_duree(preferences, tranches)} : {texte}")
    return " ; ".join(blocs)


def _stock_par_duree(base, preferences, nature, depuis, sauf_places,
                     sauf_jours, durees):
    """ONE LIST PER LENGTH, each announced with the length it serves.

    The number of slots in each list follows the number of appointments OF THAT
    LENGTH (see horaires.PAR_RENDEZVOUS_A_DEPLACER): three 40-minute sessions
    do not need as much choice as ten 20-minute ones.

    The length is written IN MINUTES, spelled out: it is the agent that reads
    this text, and `2 slots` means nothing on the phone.
    """
    pas = horaires.pas_minutes(preferences)
    blocs = []
    for tranches in sorted(durees):
        texte = horaires.creneaux_negociables(
            base, preferences, tranches=tranches, depuis=depuis,
            sauf_places=sauf_places, a_deplacer=durees[tranches],
            sauf_jours=sauf_jours)
        if not texte:
            continue
        blocs.append(f"pour un rendez-vous de {tranches * pas} minutes : "
                     f"{texte}")
    if len(blocs) == 1:
        # A single length: we do not weigh the message down with a heading that
        # adds nothing — that is the common case.
        return blocs[0].split(" : ", 1)[1]
    return " ; ".join(blocs)


def creneaux_annonces(base, preferences, nature, depuis=None, sauf_places=(),
                      a_deplacer=0, sauf_jours=(), durees=None):
    """THE slot text of a kind — the only place that decides.

    ⚠ A SINGLE CHECKPOINT, AND THAT IS THE WHOLE POINT. This text is recomputed
    in FOUR places: at step 2's pre-filling, when the campaign changes slot,
    when a cascade link is prepared, and at every call. Putting the rule in
    three of them and forgetting the fourth is the half-correction that had the
    freed-slots project going round in circles. Any new rule about the slots
    announced is written HERE.

    `a_deplacer`: how many appointments the campaign must clear out of their
    slots. The stock aimed at follows that number (see
    horaires.PAR_RENDEZVOUS_A_DEPLACER) — seven people to rebook are not
    negotiated with the stock of one.
    """
    if nature in NATURES_A_STOCK_VARIE:
        if durees:
            return _stock_par_duree(base, preferences, nature, depuis,
                                    sauf_places, sauf_jours, durees)
        return horaires.creneaux_negociables(base, preferences, depuis=depuis,
                                             sauf_places=sauf_places,
                                             a_deplacer=a_deplacer,
                                             sauf_jours=sauf_jours)
    if nature in NATURES_A_PLACES_DE_REMPLACEMENT:
        return horaires.creneaux_de_remplacement(base, preferences,
                                                 depuis=depuis,
                                                 sauf_places=sauf_places,
                                                 sauf_jours=sauf_jours)
    return horaires.creneaux_lisibles(base, preferences, depuis=depuis)


# ⚠ WHAT A COMPUTED PIECE OF INFORMATION IS WORTH — ONE PLACE, PER SETTING.
# The kinds declare TWO computed pieces of information, and they have nothing
# to do with each other (see NATURES, `_info(...)`): - `creneaux_lisibles`
# → the STOCK, enough to negotiate. Never recited: the field's heading says so
# in plain words. - `creneau_le_plus_proche` → THE date the opening message
# names.  WHAT WAS WRONG, measured on 17/08/2026 on his day of 18/08: the three
# places refreshing these values looped over `infos_auto`'s KEYS without
# looking at which setting was involved, and wrote the stock into both. Result
# on screen: the field `Créneau proposé en premier (le plus proche)` carried
# 1,842 characters and 77 dates — exactly the same text as the stock next to it
# —, and the message preview recited that catalogue. That is not what the agent
# said (six dates, recomputed per contact just before the call): so the screen
# announced worse than reality, and it is on that screen that he validates.
# The rule was in fact already written, twice: in the field's heading, and in
# `horaires.creneau_le_plus_proche` — `we offer a date, we do not recite a
# catalogue`. What was missing was ONE place making it follow through at
# refresh time. Here it is: any code recomputing a piece of information goes
# through here, and no longer has to know which one it holds.
def valeur_calculee_info(base, preferences, nature, reglage, depuis=None,
                         sauf_places=(), a_deplacer=0, sauf_jours=(),
                         durees=None):
    """The value of a COMPUTED piece of information, per ITS setting (None
    otherwise).

    The same exclusions apply to both (`sauf_places`, `sauf_jours`): the day
    being emptied is no more offered in the first date than in the stock —
    otherwise the opening message would offer precisely the day the campaign is
    freeing.
    """
    if reglage == "creneaux_lisibles":
        return creneaux_annonces(base, preferences, nature, depuis=depuis,
                                 sauf_places=sauf_places,
                                 a_deplacer=a_deplacer, sauf_jours=sauf_jours,
                                 durees=durees)
    if reglage == "creneau_le_plus_proche":
        # The length used is the LONGEST to be rebooked: a slot that takes a
        # 40-minute session takes a 20-minute one, the reverse is false. When
        # the draft is opened, no length is known — it is the average length,
        # as before.
        tranches = max(durees) if durees else 1
        return horaires.creneau_le_plus_proche(
            base, preferences, tranches=tranches, depuis=depuis,
            sauf_places=sauf_places, sauf_jours=sauf_jours)
    return None


def reglage_des_infos(nature):
    """{information code: its setting} — for the kind requested."""
    return {info["code"]: info.get("reglage")
            for info in NATURES.get(nature, {}).get("infos", ())}


def _jours_de(horaires_iso):
    """The days (YYYY-MM-DD) of a run of times, without duplicates, sorted."""
    return tuple(sorted({horaire[:10] for horaire in horaires_iso if horaire}))


def jours_a_vider(base, campagne):
    """The DAYS this campaign is emptying — no slot is offered on them.

    ⚠ HIS RULE OF 17/08/2026: `it selected slots during the day I want to
    cancel. It must also not select free slots on the day or days where we have
    the cancellation`.

    Obvious as soon as it is said: if the practitioner is not there that day,
    no hour of that day is offerable — not even the gaps that never carried an
    appointment. `places_a_vider` set aside ONLY the times of the appointments
    to be moved, and left the day around them.
    """
    return _jours_de(places_a_vider(base, campagne))


def jours_des_contacts(brouillon):
    """The DAYS its contacts' appointments fall on.

    A draft's contacts carry their appointment's date in the `rdv_existant`
    field — it is that column step 3 fills from the schedule or from the
    database. Empty when the kind does not carry one (booking: there is no
    appointment yet).

    Two readers, one computation: the campaign's NAME (see `nom_campagne`) and
    the days it empties (just below). Two ways of listing the same days would
    have ended up contradicting each other — a name announcing 18/08 while the
    computation sets aside another day.
    """
    return _jours_de(champs_contact(contact).get("rdv_existant")
                     for contact in (brouillon.get("contacts") or []))


def jours_a_vider_du_brouillon(brouillon):
    """The same rule, before the campaign exists (step 2 and `Valider`).

    Only the kinds that EMPTY set their days aside: a reminder or a
    confirmation are also about days, but they do not free them.
    """
    if brouillon.get("nature") not in NATURES_QUI_VIDENT:
        return ()
    return jours_des_contacts(brouillon)


def rafraichir_stock_du_brouillon(base, preferences, brouillon):
    """Resets the COMPUTED slot lists to the real number of people to move.

    Returns True when something changed. Called in TWO places, and both are
    needed: when step 2 is displayed, and at `Valider`.

    ⚠ HIS OBSERVATION OF 17/08/2026: `I ran a test shifting 11 appointments and
    I only have 19 slots to negotiate with`, then, with a screenshot: `is it
    simply a display problem?`. Yes — and no. Step 2's field is pre-filled when
    the draft is OPENED, before step 3: the list of people does not exist yet,
    so the stock is computed for zero. It is `only` the display, but that
    display is a FIELD: if he touches it, his nineteen dates become the
    definitive list (a retyped value leaves `infos_auto` and is never
    recomputed again). A field that shows something false invites the false to
    be frozen.

    ⚠ WE REPLACE THE LIST IN THE MESSAGE, WE DO NOT REBUILD IT. My first
    version called `construire_mission` again: it returned a text WITHOUT the
    dates sentence, and the campaign then believed itself allowed to call when
    no slot was left — one of the product's tests caught it. A substitution can
    lose nothing, and a retyped message arrives intact.
    """
    nature = brouillon.get("nature")
    if nature not in NATURES_A_STOCK_VARIE:
        return False
    a_deplacer = len(brouillon.get("contacts") or [])
    if not a_deplacer:
        return False
    infos = brouillon["infos"]
    auto = brouillon.get("infos_auto") or {}
    jours_ecartes = jours_a_vider_du_brouillon(brouillon)
    durees = durees_du_brouillon(base, brouillon)
    reglages = reglage_des_infos(nature)
    change = False
    for code, ancien in list(auto.items()):
        # A list retyped by hand belongs to the operator: we do not touch it.
        # That is what `infos.get(code) != ancien` says.
        if not ancien or infos.get(code) != ancien:
            continue
        # ⚠ EACH PIECE OF INFORMATION IS RECOMPUTED BY ITS OWN SETTING. This
        # loop wrote the stock into ALL of them: `the nearest` therefore
        # received the whole catalogue. See `valeur_calculee_info`.
        frais = valeur_calculee_info(base, preferences, nature,
                                     reglages.get(code),
                                     a_deplacer=a_deplacer,
                                     sauf_jours=jours_ecartes, durees=durees)
        if not frais or frais == ancien:
            continue
        infos[code] = auto[code] = frais
        brouillon["mission"] = (brouillon.get("mission") or "").replace(
            ancien, frais)
        change = True
    return change


def rendezvous_a_deplacer(base, campagne):
    """How many appointments this campaign must still clear out of their slots.

    ⚠ WHAT REMAINS TO BE DONE, not the size of the list. A contact already
    called has used their slot; the stock must cover THOSE WAITING. On a
    campaign that is not a move, nothing to move: zero.
    """
    if campagne.get("nature") not in NATURES_A_STOCK_VARIE:
        return 0
    # The two states of a contact waiting for their call — the same ones the
    # execution queue keeps (see `file_utile` in executer_campagne).
    return sum(1 for contact in base.contacts_de_campagne(campagne["id"])
               if contact["etat"] in ("à appeler", "en cours"))


def _plus_rien_a_annoncer(base, campagne, contact):
    """The message announced computed slots, and NONE is left.

    ⚠ THE GAP FOUND BY THE 14/08/2026 AUDIT, and it affects the four `classic`
    kinds. The slot list is computed when the campaign is CREATED and
    recomputed before every call — but the recomputation replaces nothing when
    it comes back empty (`never invented text`, see
    `creneaux_adaptes_au_contact`). The calendar having filled in the meantime,
    the agent therefore went off to announce six dates ALL TAKEN on the phone;
    every YES then came back as `à rappeler par un humain` since no appointment
    could be written. And the fallback that existed — `_sans_place_a_proposer`
    — was only reached when the contact had NO appointment: on `déplacement`
    they always have one, so the kind was protected by nothing.

    It is the same work `_place_perdue` does for `créneau libéré`: not setting
    off on a slot that no longer exists. Here we do it not at start-up but
    before EVERY call, because the list is specific to each contact (their
    length) and it moves as the campaign fills the calendar.
    """
    note = ("Personne n'a été appelé : le message annonce des créneaux "
            "calculés par RingBack, et il n'en reste plus AUCUN de libre "
            f"dans les {horaires.HORIZON_JOURS} prochains jours. L'agent "
            "aurait proposé des dates déjà prises. Libérez une place, ou "
            "ouvrez des horaires dans « ⚙ Réglages », puis relancez ce "
            "contact — aucune date n'a été inventée.")
    base.changer_etat_contact_campagne(contact["id"],
                                       "à rappeler par un humain", None)
    base.definir_detail_contact(contact["id"], note)
    noter_changement(base, campagne, contact, "humain",
                     motif=champs_contact(contact).get("motif") or "",
                     raison=note)
    journal.info("Campagne n°%d, contact n°%d : le message annonce des "
                 "créneaux calculés et il n'en reste aucun — aucun appel n'est "
                 "parti", campagne["id"], contact["id"])
    return None


def _date_refusee(base, campagne, contact, refus, date_convenue,
                  texte=None, complement="", cible=None, telephone=None,
                  rdv_du_contact=None):
    """The client said yes, but the agreed date does not hold: nothing is written.

    The owner's rule, to the letter: the appointment is NOT created, the
    contact becomes `à rappeler par un humain` with the requested date IN
    CLEAR, and the screen says why. A 🙋 row enters the change log: what was
    obtained on the phone is never lost, even when the product refuses to write
    it. Always returns None (no `first yes` policy can be concluded by an
    agreement we could not honour).

    ⚠ EXCEPT ON A FREED SLOT, where he had that state REMOVED (observed again
    on 15/08/2026: eight `🙋 à rappeler par un humain` contacts across his four
    campaigns, all by this path). His reason, written on 11/08: `the slot has
    certainly been given to somebody else, so it would mean contacting somebody
    to tell them "actually we wanted to ask you something, but it no longer
    applies"` — calling back would be disturbing them for nothing. See
    NATURES_RAPPEL_HUMAIN and `_rien_de_conclu`, which already held the rule on
    THEIR path; this one ignored it.

    The ending is then the same as for a non-conclusive answer: state REFUSED —
    true of the SLOT, which goes to somebody else, without asserting anything
    about the person — and their appointment KEPT, moved to `confirmé`. The
    date they asked for and the reason for the refusal stay written in clear on
    their record: nothing said on the phone is lost, it is only the calendar
    that is not touched (§6.5).
    """
    contact_id = contact["id"]
    sans_rappel = campagne["nature"] == "creneau_libere"
    note = texte or horaires.note_date_refusee(refus, date_convenue,
                                               rappel_humain=not sans_rappel)
    if complement:
        note = f"{note} {complement}"
    if sans_rappel:
        base.changer_etat_contact_campagne(
            contact_id, "refusé", planificateur.ISSUE_DATE_REFUSEE)
        note += " Cette personne conserve son rendez-vous"
        note += (_confirmer_le_rendezvous(base, campagne, contact, cible or {},
                                          telephone, rdv_du_contact,
                                          f"date convenue refusée : {refus}")
                 or ".")
        base.definir_detail_contact(contact_id, note)
        journal.info("Campagne n°%d, contact n°%d : date convenue REFUSÉE "
                     "(%s) — aucun rendez-vous créé, et AUCUN rappel manuel "
                     "(créneau libéré)", campagne["id"], contact_id,
                     date_convenue)
        return None
    base.changer_etat_contact_campagne(contact_id,
                                       "à rappeler par un humain",
                                       planificateur.ISSUE_DATE_REFUSEE)
    base.definir_detail_contact(contact_id, note)
    noter_changement(base, campagne, contact, "humain",
                     nouvelle_date=date_convenue,
                     motif=champs_contact(contact).get("motif") or "",
                     raison=note)
    journal.info("Campagne n°%d, contact n°%d : date convenue REFUSÉE (%s) — "
                 "aucun rendez-vous créé", campagne["id"], contact_id,
                 date_convenue)
    return None


def _place_de_la_campagne(campagne, configuration, horaire):
    """Is this time a slot of THIS campaign, still to be filled?

    Used to tell `the client agreed a date of their own` from `the client took
    one of the slots we had just quoted them` — two things the `another date
    agreed` branch handled the same way.
    """
    if not horaire:
        return False
    for fiche in creneaux_de(campagne, configuration):
        if fiche["horaire"] == horaire:
            return fiche.get("statut") == CRENEAU_A_POURVOIR
    return False


def _perdre_la_place_si_prise(base, preferences, campagne, configuration,
                              place):
    """This slot has just been refused: is it dead for EVERYBODY?

    If so, it becomes `perdue` and the campaign stops announcing it. Returns
    the sentence to add to the contact's detail, or "" when the slot still
    holds.

    ⚠ THE DEFECT MEASURED IN HIS DATABASE (14/08/2026). One person had agreed
    another date — 3:30pm, off the slot grid — and that appointment overlapped
    the 3:40pm slot the campaign was still offering. The TWENTY-FOUR following
    people said yes to that slot, each was refused the appointment, and each
    went out `à rappeler par un humain`: twenty-four calls for nothing, and a
    state the owner had precisely removed from the freed slot.

    ⚠ WE REJUDGE WITH A SINGLE SLOT, and that is the whole reasoning. `There
    are only twenty consecutive minutes, one is missing` is about THAT
    APPOINTMENT'S LENGTH, not about the slot: declaring it lost would stop the
    campaign for everybody else, some of whom fit into twenty minutes. The same
    distinction as in `_place_perdue`, and for the same reason.
    """
    # ⚠ `FILLED BY US` IS NOT `TAKEN ELSEWHERE`, and it is the first thing to
    # rule out. On a campaign set to `call the whole list`, the first yes fills
    # the slot; the second is refused it — it is occupied, but by US. Marking
    # it lost would erase the fact that it served, and the screen would say it
    # wrongly. It is the same trap that brought down twenty bench checks on
    # 11/08/2026.
    deja = {f["horaire"]: f.get("statut")
            for f in creneaux_de(campagne, configuration)}
    if deja.get(place) != CRENEAU_A_POURVOIR:
        return ""
    if not horaires.refus_rendezvous_telephone(base, preferences, place,
                                               tranches=1, place_choisie=True):
        return ""
    pourquoi = "place prise entre-temps par un autre rendez-vous"
    liste = marquer_creneau(base, campagne["id"], place, CRENEAU_PERDU,
                            pourquoi=pourquoi)
    # ⚠ AND IN THE CONFIGURATION THE LOOP HOLDS IN HAND, not only in the
    # database: it is what serves to choose the slots announced to the next
    # contact, and it is only read back at every slot filled.
    configuration["creneaux"] = liste
    reste = sum(1 for f in liste if f["statut"] == CRENEAU_A_POURVOIR)
    journal.info("Campagne n°%d : la place %s est PERDUE (prise ailleurs) — "
                 "elle ne sera plus proposée (%d place(s) restante(s))",
                 campagne["id"], place, reste)
    return (f"La place du {date_courte(place)} a été prise entre-temps : elle "
            f"est retirée de cette campagne, plus personne ne se la verra "
            f"proposer ({reste} place(s) encore à pourvoir).")


def _rendezvous_vise(base, contact, telephone):
    """THE appointment in the database this contact is about, or None.

    A contact taken from the database: theirs. A pasted contact: the
    appointment of the same client at the same time as the `existing
    appointment` column, when it exists — never an invented appointment.
    """
    if contact.get("rendezvous_id"):
        return base.obtenir_rendezvous(contact["rendezvous_id"])
    date_saisie = champs_contact(contact).get("rdv_existant", "")
    if date_saisie:
        return base.rendezvous_identique(contact["nom"], telephone, date_saisie)
    return None


# ------------------------------------------------- cascading shift (§8.3) THE
# OWNER'S RULE, to the letter. A contact agrees to shift their appointment: the
# campaign ends, the change enters the log, the local calendar is modified —
# and, IF the cascade option is set, a NEW campaign is PREPARED on **the slot
# that contact has just freed**.  That campaign is the SAME as the original,
# with one detail changed: its slot. Kind, message, options, calling order,
# contact source, fields — everything is taken over; only the LIST is
# recomputed, with the same criteria applied to the new slot.  WHAT MAKES THE
# CHAIN CONVERGE: a slot only interests the people it SUITS. Contacts whose
# appointment is EARLIER than the new slot are set aside (shifting them would
# lose them time, not gain it). A link's slot is therefore always STRICTLY
# later than the previous one's: the list narrows every time, and the chain
# exhausts itself instead of going round in circles.  No call ever goes out on
# its own: every link is born `prête`, and it is the operator who validates.
# The bounds, cumulative: 1. the option must be ticked AND carry a cut-off
# date; 2. the freed slot must fall BEFORE that cut-off; 3. the chain never
# exceeds CASCADE_PROFONDEUR_MAX links; 4. never two campaigns for the SAME
# slot; 5. with no reproducible recipe (a list written by hand), we prepare
# NOTHING and we say why — never an invented list.
CASCADE_PROFONDEUR_MAX = 5

# The step-2 information carrying the campaign's slot, per kind. It alone
# changes when a campaign is replayed on another slot.
INFO_CRENEAU_PAR_NATURE = {"creneau_libere": "creneau_libere"}


def cascade_reglee(options):
    """The cut-off date of `shift in cascade until [date]`, or None."""
    if not options.get("cascade"):
        return None
    return (options.get("cascade_jusqu_au") or "").strip() or None


def libelle_cascade(configuration):
    """What `shift in cascade` does on THIS campaign, in one sentence.

    Written here, and not in the template: the behaviour depends on two things
    (the option, and whether the campaign carries a list or a single slot), and
    a sentence computed inside a template brace always ends up saying something
    other than what the code does.
    """
    options = configuration.get("options") or {}
    if configuration.get("nature") not in NATURES_QUI_LIBERENT_UNE_PLACE:
        return ("sans objet — cette campagne ne fait quitter sa place à "
                "personne")
    if not options.get("cascade"):
        return ("non — les places quittées restent libres sur votre planning, "
                "et c'est vous qui décidez d'en faire quelque chose")
    limite = cascade_reglee(options)
    borne = (f", jusqu'au {date_jour_lisible(limite)}" if limite
             else ", sans date limite")
    if configuration.get("liste_de_places"):
        return (f"oui{borne} — la place quittée rejoint cette campagne, qui "
                "continue dessus")
    return (f"oui{borne} ({CASCADE_PROFONDEUR_MAX} maillons au maximum) — la "
            "campagne suivante, sur la place libérée, est PRÉPARÉE, jamais "
            "lancée")


def _profondeur_cascade(configuration):
    try:
        return int((configuration.get("cascade") or {}).get("profondeur") or 0)
    except (TypeError, ValueError):
        return 0


def _creneau_deja_prepare(base, creneau):
    """True when a campaign ALREADY carries this slot — never the same one twice.

    The new rule's anti-duplicate bound. Yesterday's (`never target the same
    appointment twice`) no longer applies: we no longer target the occupant of
    a slot, we start again from a freed slot.
    """
    return any((campagne["creneau"] or "") == creneau
               for campagne in base.lister_campagnes())


def preparer_cascade_creneau_libere(base, preferences, campagne, configuration,
                                    demandeur, creneau_libere,
                                    rendezvous_bouge=None):
    """§8.3 — replays THE SAME campaign on the slot the client has just freed.

    Returns {"campagne_id", "creneau", "contacts", "ecartes", "profondeur"}
    when a campaign has been prepared (state `prête`, no calls), otherwise
    {"raison": text} saying WHY the chain stops there — it is that sentence
    which is displayed, never a silence.
    """
    options = configuration["options"]
    limite = cascade_reglee(options)
    if not limite:
        return {"raison": "l'option « décaler en cascade jusqu'au [date] » "
                          "n'est pas réglée pour cette campagne — aucune "
                          "campagne n'a été préparée."}
    if not creneau_libere:
        return {"raison": "aucune place libérée n'est connue — rien n'a pu "
                          "être préparé."}
    profondeur = _profondeur_cascade(configuration) + 1
    if profondeur > CASCADE_PROFONDEUR_MAX:
        return {"raison": "butée de sécurité : la chaîne de campagnes atteint "
                          f"{CASCADE_PROFONDEUR_MAX} maillons — elle s'arrête "
                          "ici, un humain reprend la main."}
    if creneau_libere[:10] > limite:
        return {"raison": "la chaîne s'arrête à la date limite réglée "
                          f"({date_jour_lisible(limite)}) : la place libérée "
                          f"({date_courte(creneau_libere)}) tombe au-delà."}
    if _creneau_deja_prepare(base, creneau_libere):
        return {"raison": "une campagne porte déjà le créneau du "
                          f"{date_courte(creneau_libere)} — aucune n'a été "
                          "préparée en double."}
    recette = configuration.get("recette") or {}
    # ⚠ TWO REPLAYABLE CRITERIA, IN THIS ORDER (15/08/2026).  1. THE RECIPE,
    # when it exists. It is what actually filled the grid — paste, file,
    # imported calendar, database source — and therefore what says what the
    # operator wanted. 2. ITS RULE, otherwise. A campaign set up in AUTOMATIC
    # mode records no contribution: it is `regenerer_la_liste` that fills it.
    # The recipe therefore stayed empty, and the cascade refused to prepare
    # what came next, accusing the operator of having `chosen the list by hand`
    # — while their criterion was right there, written on the campaign.
    # Observed on his campaign no. 5: rule `upcoming, at least 30 days`, empty
    # recipe, chain stopped dead.  The order matters IN BOTH DIRECTIONS: the
    # rule first broke the chain of campaigns loaded by hand, where it carries
    # its default source (`to rebook`), unrelated to the list actually built.
    # Replaying the rule is what answers his request of 15/08: it carries the
    # minimum gain, which is recomputed on the NEW slot — `the 15/09 slot looks
    # for contacts from 15/10`.
    regle = None if recette_reproductible(recette) else regle_de_liste(
        configuration)
    if not regle and not recette_reproductible(recette):
        return {"raison": "la liste de cette campagne a été choisie à la main "
                          "(collage, fichier, agenda importé, ou rendez-vous "
                          "désigné dans le planning) : il n'y a "
                          "aucun critère à rejouer sur un autre créneau. "
                          "Rien n'a été préparé — aucune liste n'est "
                          "inventée. Créez la campagne suivante depuis "
                          "« ➕ Nouvelle campagne »."}
    nature = campagne["nature"]
    code_creneau = INFO_CRENEAU_PAR_NATURE.get(nature)
    if recette.get("mission_editee") and code_creneau:
        return {"raison": "le message de cette campagne a été récrit à la "
                          "main et porte la date de son créneau : il ne peut "
                          "pas être rejoué sur une autre date sans inventer "
                          "du texte. Aucune campagne n'a été préparée."}
    champs = champs_campagne(configuration)
    try:
        if regle:
            # The rule is replayed ON THE FREED SLOT: the minimum gain
            # therefore starts again from that date, not from the original
            # campaign's.
            contacts, _ = contacts_de_la_regle(base, preferences, regle,
                                               champs, creneau_libere)
        else:
            contacts, _ = contacts_de_recette(base, recette, champs,
                                              preferences)
    except SaisieInvalide as erreur:
        return {"raison": "la recette de cette campagne n'a pas pu être "
                          f"rejouée : {erreur}"}
    retenus, ecartes = resserrer_sur_le_creneau(contacts, creneau_libere,
                                                [rendezvous_bouge])
    if not retenus:
        details = [f"{ecartes['anterieurs']} contact(s) écarté(s) : leur "
                   "rendez-vous est AVANT cette place, la décaler leur ferait "
                   "perdre du temps"]
        if ecartes["sans_date"]:
            details.append(f"{ecartes['sans_date']} sans rendez-vous connu")
        if ecartes["deja_bouge"]:
            details.append(f"{ecartes['deja_bouge']} qui vient justement de "
                           "quitter cette place")
        return {"raison": "plus personne n'a de rendez-vous APRÈS la place "
                          f"libérée du {date_courte(creneau_libere)} — "
                          + " ; ".join(details)
                          + ". La chaîne s'arrête d'elle-même."}
    # ⚠ AND THE CEILING APPLIES TO THE LINK, not only to the original campaign
    # (14/08/2026, cross audit). The screen announces `with the same criteria`:
    # a ceiling set to five letting forty people into the prepared campaign
    # contradicted that sentence, and it is precisely the setting that protects
    # the call credit.
    plafond = plafond_de(configuration)
    retenus, hors_plafond = limiter_au_plafond(
        retenus, plafond, ordre=configuration.get("ordre"),
        creneau=creneau_libere)
    if hors_plafond:
        journal.info("Cascade : %d contact(s) écarté(s) par le plafond de %s "
                     "personne(s), repris de la campagne n°%d",
                     hors_plafond, plafond, campagne["id"])
    # Everything is taken over from the original campaign; ONLY the slot
    # changes.
    infos = dict(configuration["infos"])
    if code_creneau:
        infos[code_creneau] = creneau_libere
    # The COMPUTED slot lists are recomputed: announcing yesterday's slots
    # would have already-taken slots offered on the phone. A list rewritten by
    # hand (absent from infos_auto) is taken over as it stands.
    infos_auto = {}
    a_deplacer = rendezvous_a_deplacer(base, campagne)
    jours_ecartes = jours_a_vider(base, campagne)
    durees = durees_a_deplacer(base, campagne)
    reglages = reglage_des_infos(nature)
    for code in (configuration.get("infos_auto") or {}):
        # ⚠ BY ITS OWN SETTING, as at the draft's refresh: this link too wrote
        # the stock into `the nearest`.
        valeur = valeur_calculee_info(base, preferences, nature,
                                      reglages.get(code),
                                      a_deplacer=a_deplacer,
                                      sauf_jours=jours_ecartes, durees=durees)
        if not valeur:
            continue
        infos[code] = valeur
        infos_auto[code] = valeur
    mission = (campagne["mission"] if recette.get("mission_editee")
               else construire_mission(nature, infos, preferences, options))
    brouillon = {
        "nature": nature,
        "infos": infos,
        "infos_auto": infos_auto,
        "politique": configuration["politique"],
        "ordre": configuration.get("ordre") or "liste",
        "options": dict(options),
        "champs": [dict(champ) for champ in configuration.get("champs", [])],
        "contacts": retenus,
        "mission": mission,
        # ⚠ THE CEILING FOLLOWS THE LINK (14/08/2026, cross audit). The screen
        # announces `campaign no. X has been PREPARED, with the same criteria`:
        # without this line, that was false on the point that matters most — a
        # ceiling set to five was lost, and the link loaded everybody. And it
        # was not merely ignored: it was not saved either, so the prepared
        # campaign's screen could not even say it.
        "plafond": str(configuration.get("plafond") or ""),
        # ⚠ AND THE RULE TOO (15/08/2026): without it, the link was born with a
        # frozen list and the chain stopped at the first relay. Yet it is the
        # rule that does all the work — it is replayed on THIS link's slot,
        # with the gain recomputed from that date.
        "mode_liste": "automatique" if regle else "manuel",
        "regle_liste": dict(regle or {}),
        "recette": dict(recette),
        # ⚠ THE LINK CARRIES THE FREED SLOT, whatever its kind — that is the
        # §8.3 rule, and it is also what prevents two being prepared for the
        # same slot (see `_creneau_deja_prepare`). On a kind that does not
        # announce a slot — `déplacement` announces REPLACEMENT slots — that
        # slot is a TRACE, not a slot to be filled: it is the execution loop
        # that must know it, and it has known since 14/08 (see
        # `campagne_a_des_places` in `executer_campagne`).
        "creneau": creneau_libere,
        "creneaux": normaliser_creneaux([creneau_libere]),
    }
    brouillon["options"]["cascade_origine"] = campagne["id"]
    nouvelle_id = creer_campagne_prete(base, brouillon, preferences)
    marquer_cascade(base, nouvelle_id, {
        "origine": campagne["id"], "profondeur": profondeur,
        "jusqu_au": limite, "creneau": creneau_libere, "demandeur": demandeur,
        "profondeur_max": CASCADE_PROFONDEUR_MAX,
        "retenus": len(retenus), "ecartes": ecartes})
    journal.info("Cascade : campagne n°%d PRÉPARÉE (prête, maillon %d/%d) sur "
                 "la place du %s libérée par %s — %d contact(s) retenu(s), "
                 "%d écarté(s) parce qu'antérieur(s), %d sans date ; aucun "
                 "appel n'est parti", nouvelle_id, profondeur,
                 CASCADE_PROFONDEUR_MAX, creneau_libere, demandeur,
                 len(retenus), ecartes["anterieurs"], ecartes["sans_date"])
    return {"campagne_id": nouvelle_id, "creneau": creneau_libere,
            "contacts": [c["nom"] for c in retenus], "ecartes": ecartes,
            "profondeur": profondeur}


def marquer_cascade(base, campagne_id, marque):
    """Records the cascade link in the campaign's configuration."""
    campagne = base.obtenir_campagne(campagne_id)
    configuration = configuration_campagne(campagne)
    configuration["cascade"] = marque
    base.definir_configuration_campagne(
        campagne_id, json.dumps(configuration, ensure_ascii=False))


def date_jour_lisible(iso_jour):
    """« 2026-08-15 » devient « 15/08/2026 » (une date seule, sans heure)."""
    try:
        return datetime.date.fromisoformat(iso_jour).strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return iso_jour or ""


def _support_de_l_appel(campagne, contact, nature, place_libre,
                        place_alternative=None):
    """The REFERENCE appointment sent to the agent, or None when there is none.

    Three cases, in this order:

    1. the contact has THEIR appointment (the `existing appointment` column of the 🔔 reminder, ✅ confirmation, 📆 move, 📞 freed-slot kinds): it is that one we talk to them about, nothing changes;
    2. the campaign carries a slot chosen by the user (📞 freed slot): it is THE slot we are trying to fill, and it is FIXED — the cascade handles what follows;
    3. the kinds WITH no per-contact appointment (🗓 booking, 🎯 single contact, ☎ missed-call reminder, ✍ custom): the reference is the NEXT FREE SLOT, recomputed at the instant of THIS call. Since a booking creates an appointment, the slot leaves the free slots of the next call by itself: the slot advances on its own, and two people are no longer offered the same one.

    Returns None when there is no slot left to offer (case 3 only): the caller
    says so frankly rather than invent a date.
    """
    rdv_du_contact = champs_contact(contact).get("rdv_existant")
    horaire = rdv_du_contact or campagne.get("creneau") or place_libre
    if not horaire:
        return None
    support = {
        "horaire": horaire,
        "motif": champs_contact(contact).get("motif")
                 or campagne.get("sujet")
                 or (fiche_nature(nature) or {}).get("nom", nature),
        # True when the reference IS the slot offered (case 3) and not an
        # appointment already taken: the agent then offers THAT slot — the one
        # the message announces first — instead of deriving another from it.
        "place_a_pourvoir": not rdv_du_contact and not campagne.get("creneau"),
    }
    # ⚠ THE REAL SLOT, PASSED ON (16/08/2026). It was COMPUTED here — at the
    # instant of the call, on the real calendar — and yet never passed on: when
    # the contact has their own appointment (📆 move), the simulation fell back
    # on its last-resort formula, `appointment + 7 days, same hour`. It
    # guarantees NOTHING about availability, its own code says so (see
    # calle_client._creneau_propose).  WHAT THAT PRODUCED, in his campaign:
    # three contacts, three `Confirmé` on the phone, and three `Appointment NOT
    # created: this slot is already taken, or outside the opening hours` —
    # hence three `🙋 à rappeler par un humain`. His appointment of 22/08 at
    # 10:00 gave 29/08 at 10:00, an occupied slot. The first POSITIVE call he
    # had just asked for turned into a failure at writing time.  `place_libre`
    # is recomputed AT EVERY CALL: two contacts in a row therefore cannot
    # receive the same one — the first's appointment occupies the slot, and it
    # disappears from the second's free ones.
    if place_libre and not support["place_a_pourvoir"]:
        support["place_proposee"] = place_libre
    # ⚠ AND A SECOND REAL SLOT FOR `they offer ANOTHER one`. Without it, that
    # case kept its randomly drawn date (day + 1 to 10, random hour): the third
    # contact of his campaign went out `à rappeler par un humain` for exactly
    # that reason, after a `Déplacé (date convenue)`. Another date must be
    # another FREE date.
    if place_alternative and place_alternative != place_libre:
        support["place_alternative"] = place_alternative
    return support


def _sans_place_a_proposer(base, campagne, contact):
    """NO free slot left: nobody is called, and the screen says why.

    The owner's rule, to the letter: never an invented date. With no slot to
    offer, the call would have nothing to announce — so the contact goes to `à
    rappeler par un humain` with the reason in clear, a 🙋 row enters the change
    log (nothing is lost), and NO call is placed. The campaign CONTINUES: a
    slot may come free between two calls, and each contact stays visible with
    their reason rather than being spirited away by a global stop.
    """
    note = ("Personne n'a été appelé : plus aucune place libre à proposer "
            f"dans les {horaires.HORIZON_JOURS} prochains jours. Libérez une "
            "place, ou ouvrez des horaires dans « ⚙ Réglages », puis "
            "relancez ce contact — aucune date n'a été inventée.")
    base.changer_etat_contact_campagne(contact["id"],
                                       "à rappeler par un humain", None)
    base.definir_detail_contact(contact["id"], note)
    noter_changement(base, campagne, contact, "humain",
                     motif=champs_contact(contact).get("motif") or "",
                     raison=note)
    journal.info("Campagne n°%d, contact n°%d : AUCUNE place libre à "
                 "proposer — aucun appel n'est parti, aucune date inventée",
                 campagne["id"], contact["id"])
    return None


def _appeler_contact(base, planif, preferences, campagne, configuration,
                     contact, tentative, maintenant=None):
    """ONE assistant campaign call (simulation or real, the same locks).

    Returns `pourvu` when this YES concludes a `first yes` policy, otherwise
    None. Everything displayed afterwards (state, detail, key information) is
    written HERE, from the call's real result.
    """
    options = configuration["options"]
    contact_id = contact["id"]
    # The number dialled is the CLIENT RECORD's at that precise instant (not
    # the copy frozen in the campaign), and the 🚫 is read back here — by the
    # number AND by the name. A deleted record is never dialled again.
    cible = base.cible_appel_contact(contact_id)
    if cible["refus"]:
        etat, detail = db.suite_du_refus(cible["refus"])
        base.changer_etat_contact_campagne(contact_id, etat, None)
        base.definir_detail_contact(contact_id, detail)
        journal.info("Campagne n°%d : contact n°%d NON composé — %s (%s)",
                     campagne["id"], contact_id, cible["refus"], etat)
        return None
    telephone = cible["telephone"]
    mission = finaliser_mission(
        campagne["mission"], contact, champs_campagne(configuration),
        mod_langue.de_preferences(preferences))
    # ONE SINGLE computation of the free slots, done HERE, at the instant of
    # the call: both the list announced in the message and the reference date
    # sent to the agent come out of it.
    creneaux, place_libre = places_du_contact(
        base, preferences, contact, sauf_places=places_a_vider(base, campagne),
        sauf_jours=jours_a_vider(base, campagne))
    mission = creneaux_adaptes_au_contact(base, preferences, configuration,
                                          contact, mission, adaptee=creneaux,
                                          campagne=campagne)
    # ⚠ AND WHEN THE RECOMPUTATION RETURNS NOTHING, WE DO NOT DIAL. The message
    # would then carry the list from CREATION, of which not one slot is free:
    # the agent would announce dates already taken. See
    # `_plus_rien_a_annoncer`.
    if not creneaux and annonce_des_places_calculees(configuration, mission):
        return _plus_rien_a_annoncer(base, campagne, contact)
    nature = campagne["nature"]
    en_cascade = nature == "creneau_libere" and campagne.get("creneau")
    # ⚠ CONSENT IS READ BACK HERE TOO, at the instant of dialling. The queue
    # filters only see the list-based campaigns; this one sees ALL cascade
    # calls — including those from a list pasted by hand, where the operator
    # could not know.
    if en_cascade and base.plus_de_proposition(cible.get("client_id")):
        base.changer_etat_contact_campagne(contact_id, "épargné", None)
        base.definir_detail_contact(
            contact_id, f"Jamais appelée — {RAISON_PLUS_DE_PROPOSITION}")
        journal.info("Campagne n°%d : contact n°%d NON composé — refuse les "
                     "propositions de créneau", campagne["id"], contact_id)
        return None
    rdv_support = None
    if not en_cascade:
        # The SECOND free slot, for the `they offer another one` case. Same
        # source, same instant, same exclusions: two computations could not
        # diverge since they start from the same arguments. ⚠ THE STOCK FOLLOWS
        # WHAT REMAINS TO BE MOVED (17/08/2026, his rule). It is recomputed at
        # EVERY call, so it shrinks with the queue: seven people waiting need
        # seven times more slots than one.
        suite_libres = horaires.places_negociables(
            base, preferences, tranches=tranches_du_contact(base, contact),
            sauf_places=places_a_vider(base, campagne),
            a_deplacer=rendezvous_a_deplacer(base, campagne),
            sauf_jours=jours_a_vider(base, campagne))
        autres = [place for place in suite_libres if place != place_libre]
        rdv_support = _support_de_l_appel(campagne, contact, nature,
                                          place_libre,
                                          autres[0] if autres else None)
        if rdv_support is None:
            return _sans_place_a_proposer(base, campagne, contact)
    # THE THREE-PART BRIEFING — an opening spoken word for word, an objective
    # and context discussed freely, closed outcomes. It is what goes into
    # CALL-E's `task` field, and it is what step 2's preview shows: one path,
    # hence no possible divergence.
    consigne_appel = consigne_de_l_appel(base, preferences, campagne,
                                         configuration, contact, mission,
                                         en_cascade, adaptee=creneaux)
    try:
        # THE KIND GOES OUT WITH THE CALL. It changes NOTHING in the real thing
        # — CALL-E does not know our kinds, and everything that must be said is
        # already in the briefing. It tells the SIMULATOR which cases to play
        # for this campaign: see calle_client.SUITES_PAR_NATURE.
        if en_cascade:
            issue_appel = planif.client_appels.appeler_cascade(
                contact["nom"], telephone, mission, campagne["creneau"],
                consigne=consigne_appel, nature=nature)
        else:
            issue_appel = planif.client_appels.appeler(
                contact["nom"], telephone, rdv_support, mission=mission,
                consigne=consigne_appel, nature=nature)
    except calle_client.PasDeReponse:
        base.ajouter_appel_campagne(campagne["id"], contact_id, tentative,
                                    issue="no_answer")
        _apres_non_joint(base, preferences, campagne, options, contact_id,
                         "no_answer", maintenant)
        return None
    except calle_client.ResultatEnAttente as attente:
        # THE CALL HAS GONE OUT and the conversation may have taken place: it
        # is ONLY its answer that is missing. We keep the CALL-E id, we write
        # the state that tells the truth — and nothing else: no attempt, no
        # `injoignable`, no appointment touched. Then we let it propagate, so
        # the campaign pauses.
        _noter_resultat_en_attente(base, contact_id, tentative, attente)
        journal.error("Campagne n°%d, contact n°%d : appel PARTI, résultat "
                      "pas encore connu (appel CALL-E n° %s)", campagne["id"],
                      contact_id, attente.identifiant)
        raise
    except calle_client.ResultatInvalide as refus:
        # THE CONVERSATION TOOK PLACE and we could not read it. It is NOT a
        # technical failure: retrying would ring the phone a second time for an
        # exchange that has already concluded. The contact goes to a human, raw
        # answer preserved — then we let it propagate, so the campaign pauses
        # (the defect will hit the following ones identically).
        noter_reponse_illisible(base, campagne["id"], contact_id, tentative,
                                refus)
        raise
    except calle_client.EchecDeNotreCote:
        # THE FAULT IS ON OUR SIDE, NOT THE CONTACT'S (key refused, service
        # down, credit exhausted, network cut). Their phone did not even ring:
        # we write NOTHING about them — no attempt, no state, no detail — and
        # we let it propagate, so the campaign stops instead of wrongly marking
        # the whole list.
        raise
    except Exception as erreur:  # technical failure: never an invented result
        journal.error("Campagne n°%d, contact n°%d : échec (%s)",
                      campagne["id"], contact_id, erreur)
        base.ajouter_appel_campagne(campagne["id"], contact_id, tentative,
                                    issue="echec")
        _apres_non_joint(base, preferences, campagne, options, contact_id,
                         "echec", maintenant)
        return None
    return _appliquer_resultat(base, planif, preferences, campagne,
                               configuration, contact, tentative, issue_appel,
                               en_cascade, cible, telephone, maintenant)


DETAIL_RESULTAT_INCONNU = (
    "⏱ L'appel est PARTI (appel CALL-E n° {identifiant}) — son résultat "
    "n'est pas encore connu. Aucune tentative ne lui est comptée, rien n'a "
    "été décidé, son rendez-vous n'a pas bougé. Utilisez « 📥 Récupérer les "
    "résultats en attente » : ce geste LIT le résultat chez CALL-E, il ne "
    "compose aucun numéro.")


def _noter_resultat_en_attente(base, contact_id, tentative, attente):
    """Writes the state `called, result unknown` and KEEPS the id.

    Three writes, and not one more: the call's id (without it, the result would
    be lost), the state, the detail displayed. No attempt is added — the call
    concluded nothing, it must not bring anybody closer to the follow-up
    ceiling.
    """
    base.definir_appel_en_attente(contact_id, attente.identifiant, tentative)
    base.changer_etat_contact_campagne(contact_id, ETAT_RESULTAT_INCONNU, None)
    base.definir_detail_contact(
        contact_id,
        DETAIL_RESULTAT_INCONNU.format(identifiant=attente.identifiant or "?"))


# THE OUTCOME of an answer RingBack could not read. It is not `échec` (which
# would trigger a follow-up and move closer to the ceiling): the conversation
# TOOK PLACE, it is waiting for a human.
ISSUE_REPONSE_ILLISIBLE = "reponse_illisible"

DETAIL_REPONSE_ILLISIBLE = (
    "🙋 La conversation a EU LIEU, mais RingBack n'a pas su lire ce que "
    "CALL-E en a rendu — c'est un défaut de RingBack, pas un fait sur cette "
    "personne. Rien n'a été décidé : aucune tentative comptée, aucun "
    "rendez-vous touché, aucun rappel automatique. À rappeler par un "
    "humain.\nCe que RingBack n'a pas su lire : {constat}\nRéponse brute de "
    "CALL-E : {reponse}")


def noter_reponse_illisible(base, campagne_id, contact_id, tentative, refus):
    """Unreadable answer: the contact goes to a HUMAN, nothing is lost.

    ONE SINGLE place for this writing, shared by the assistant's campaigns and
    by the classic campaign engine — two versions would have ended up
    diverging, and it is precisely on that path that a divergence costs a
    conversation.

    What is written:
    - the attempt is RECORDED with its transcript (the exchange exists: throwing it away would lose a second time what the person said);
    - the state `à rappeler par un humain`, terminal: no follow-up is scheduled, hence no automatic call-back and no ceiling approached;
    - the detail displayed carries CALL-E's RAW answer, as it stands.
    """
    base.ajouter_appel_campagne(campagne_id, contact_id, tentative,
                                issue=ISSUE_REPONSE_ILLISIBLE,
                                transcription=refus.transcription or None)
    base.changer_etat_contact_campagne(contact_id, "à rappeler par un humain",
                                       ISSUE_REPONSE_ILLISIBLE)
    base.definir_detail_contact(
        contact_id,
        DETAIL_REPONSE_ILLISIBLE.format(
            constat=refus.constat,
            reponse=refus.reponse_brute or "(aucune réponse conservée)"))
    journal.error("Campagne n°%s, contact n°%s : réponse ILLISIBLE — %s",
                  campagne_id, contact_id, refus.constat)


RAISON_STOP_TELEPHONE = ("la personne a demandé au téléphone qu'on ne la "
                         "rappelle plus")


def _poser_ne_plus_appeler(base, campagne, contact, cible, telephone):
    """The 🚫 requested DURING the call: set on the record, and said everywhere.

    ⚠ ON THE RECORD, NOT ON THE CAMPAIGN. The flag applies to ALL future calls,
    of every campaign — that is the meaning of the request. Putting it on the
    campaign contact would have protected the person from one list only, and
    they would have been called back by the next.

    ⚠ AND THE FOLLOW-UPS ALREADY SCHEDULED FALL. A surviving follow-up would
    have called the person back a few hours after they asked for the opposite:
    precisely what they wanted to avoid.

    Returns the number of follow-ups cancelled.
    """
    contact_id = contact["id"]
    client_id = (cible.get("client_id")
                 or base.client_pour_contact(contact["nom"], telephone))
    if client_id:
        base.definir_ne_plus_appeler(client_id, True)
    annulees = base.annuler_relances_contact(contact_id)
    noter_changement(base, campagne, contact, "ne_plus_appeler",
                     client_id=client_id, raison=RAISON_STOP_TELEPHONE)
    # The detail written by the outcome is KEPT: what was agreed during the
    # call stays true. The 🚫 is read first, because it is what decides
    # everything that follows.
    ancien = (base.obtenir_contact_campagne(contact_id) or {}).get("detail")
    prefixe = ("🚫 A demandé à ne plus être appelée — sa fiche est marquée "
               "« ne plus appeler », aucun appel ne partira plus pour elle")
    if annulees:
        prefixe += f" ({annulees} relance(s) programmée(s) annulée(s))"
    base.definir_detail_contact(
        contact_id, f"{prefixe}. {ancien}" if ancien else prefixe + ".")
    journal.info("Campagne n°%d, contact n°%d : 🚫 demandé au téléphone — "
                 "fiche marquée, %d relance(s) annulée(s)",
                 campagne["id"], contact_id, annulees)
    return annulees


def _appliquer_resultat(base, planif, preferences, campagne, configuration,
                        contact, tentative, issue_appel, en_cascade, cible,
                        telephone, maintenant=None):
    """Writes everything a CONCLUDED call produces — and nothing else.

    Separated from _appeler_contact for a precise reason: the `📥 Récupérer les
    résultats en attente` gesture must apply a result that arrived late EXACTLY
    as if it had arrived on time (appointment moved, change log, cascade,
    follow-ups). A second writing path would have ended up diverging from the
    first; so there is only one, and this is it.

    ⚠ TWO STAGES SINCE 10/08/2026: the outcome, then the 🚫 when it was
    requested on the phone. In that order, and never the reverse — what was
    agreed during the call must be honoured (their appointment really moved,
    their slot really allocated) BEFORE the record stops being callable.
    """
    conclusion = _appliquer_issue(base, planif, preferences, campagne,
                                  configuration, contact, tentative,
                                  issue_appel, en_cascade, cible, telephone,
                                  maintenant)
    if calle_client.ne_plus_appeler_demande(issue_appel.resultat):
        _poser_ne_plus_appeler(base, campagne, contact, cible, telephone)
    return conclusion


def _appliquer_issue(base, planif, preferences, campagne, configuration,
                     contact, tentative, issue_appel, en_cascade, cible,
                     telephone, maintenant=None):
    """The outcome itself: one branch per conclusion, and what it writes."""
    options = configuration["options"]
    contact_id = contact["id"]
    nature = campagne["nature"]
    resultat = issue_appel.resultat
    if en_cascade:
        issue = resultat["outcome"]
    else:
        issue = resultat["appointment_status"]
    base.ajouter_appel_campagne(campagne["id"], contact_id, tentative,
                                issue=issue, resultat=resultat,
                                transcription=issue_appel.transcription)
    rdv_du_contact = _rendezvous_vise(base, contact, telephone)
    tranches = horaires.duree_tranches(rdv_du_contact) if rdv_du_contact else 1
    duree = duree_lisible_tranches(preferences, tranches)
    motif_contact = champs_contact(contact).get("motif") or ""
    if issue == "accepted":
        # ⚠ THE SLOT CHOSEN, NOT NECESSARILY THE CURRENT ONE. When several
        # slots were announced in the same call, the agent returns the one the
        # person took. A date that is not among those announced is NOT booked:
        # we do not guess on the phone.
        annoncees = places_annoncees(campagne, configuration)
        place = place_retenue(resultat, annoncees, campagne.get("creneau"))
        if place is None:
            return _date_refusee(
                base, campagne, contact,
                "la date rapportée par l'agent (« "
                f"{resultat.get('new_datetime')} ») ne fait partie d'AUCUNE "
                "des places annoncées pendant l'appel : rien n'a été "
                "réservé.",
                resultat.get("new_datetime"), cible=cible,
                telephone=telephone, rdv_du_contact=rdv_du_contact)
        # The freed slot was CHOSEN by the user: we do not judge it on the
        # opening hours, but it stays refused when it has become closed or has
        # been taken in the meantime. ⚠ BOTH PARAMETERS, NOT ONE INSTEAD OF THE
        # OTHER. `place_choisie` exempts the slot from the opening hours — a
        # slot freed on a Saturday is legitimate, the user chose it. `sauf_rdv`
        # makes the contact's own appointment be ignored, the one we are about
        # to move: without it, a slot overlapping their own appointment would
        # be declared `already taken`, and the YES obtained on the phone would
        # be thrown away.
        refus = horaires.refus_rendezvous_telephone(
            base, preferences, place, tranches=tranches,
            place_choisie=True,
            sauf_rdv=(rdv_du_contact["id"] if rdv_du_contact else None))
        if refus:
            # ⚠ AND THE SLOT IS REMOVED WHEN IT IS DEAD FOR EVERYBODY. Without
            # that, it stayed `to be filled` and the campaign went on
            # announcing it: measured in his database on 14/08/2026,
            # TWENTY-FOUR people said yes to the same already-taken slot, one
            # after another, and all went out `à rappeler par un humain`.
            perdue = _perdre_la_place_si_prise(base, preferences, campagne,
                                               configuration, place)
            _date_refusee(base, campagne, contact, refus, place,
                          complement=perdue, cible=cible, telephone=telephone,
                          rdv_du_contact=rdv_du_contact)
            # ⚠ AND THE LOOP MUST LEARN IT, not only the list. Removing the
            # slot from the database was not enough: on a campaign with ONE
            # slot, nothing read the campaign back and the following ones were
            # called about that dead slot (see CONCLUSION_PLACE_PERDUE).
            return CONCLUSION_PLACE_PERDUE if perdue else None
        client_id = (cible["client_id"]
                     or base.client_pour_contact(contact["nom"], telephone))
        motif = motif_contact or "Créneau libéré attribué"
        # ⚠ WE MOVE THEIR ROW, WE DO NOT CREATE A SECOND ONE (14/08/2026).
        # `_liberer_ancien_rendezvous` changes the time of THEIR appointment
        # and confirms it; so only one calendar row remains, at the new date.
        # It is only for somebody who had NO appointment — the people waiting
        # for a slot — that one is created.  ⚠ AND THE LOG CARRIES ONE GESTURE:
        # the move's ↔ row, or the `ajout` for the person who had nothing.
        # Never both.
        trace = {}
        libere = _liberer_ancien_rendezvous(base, preferences, campagne,
                                            options, contact,
                                            maintenant=maintenant,
                                            deplace_vers=place, trace=trace)
        rdv_id = trace.get("rendezvous_id")
        if rdv_id is None:
            rdv_id = base.ajouter_rendezvous(
                client_id, place, motif,
                statut="confirmé", duree_tranches=tranches)
            if not libere:
                noter_changement(base, campagne, contact, "ajout",
                                 client_id=client_id, rendezvous_id=rdv_id,
                                 nouvelle_date=place, motif=motif,
                                 duree=duree,
                                 raison="créneau libéré accepté au téléphone")
        detail = (f"Créneau du {date_courte(place)} "
                  f"pris (rendez-vous n°{rdv_id})")
        if libere:
            detail += f" — {libere}"
            # The contact has just BROUGHT FORWARD their appointment: the slot
            # they leave becomes in turn a slot to be filled.
            place_rendue = (trace.get("ancienne_date")
                            or (rdv_du_contact or {}).get("horaire")
                            or champs_contact(contact).get("rdv_existant"))
            detail += _rendre_la_place(base, preferences, campagne,
                                       configuration, contact, place_rendue,
                                       rdv_id)
        marquer_creneau(base, campagne["id"], place, CRENEAU_POURVU,
                        contact_id=contact_id, rendezvous_id=rdv_id)
        base.changer_etat_contact_campagne(contact_id, "accepté", issue)
        base.definir_detail_contact(contact_id, detail)
        return (CONCLUSION_POURVU if configuration["politique"] == "premier_oui"
            else None)
    if issue == "moved":
        # `Yes, but another date`: the Q7 gap, closed here. A new appointment
        # is created — and the OLD one must go, otherwise the client would have
        # two and a slot would stay blocked for nothing. The same mechanism as
        # `accepted`, with its own reason in the log.
        refus = horaires.refus_rendezvous_telephone(
            base, preferences, resultat.get("new_datetime"), tranches=tranches)
        if refus:
            return _date_refusee(base, campagne, contact, refus,
                                 resultat.get("new_datetime"), cible=cible,
                                 telephone=telephone,
                                 rdv_du_contact=rdv_du_contact)
        client_id = (cible["client_id"]
                     or base.client_pour_contact(contact["nom"], telephone))
        motif = motif_contact or "Rendez-vous convenu par téléphone"
        ancienne_place = ((rdv_du_contact or {}).get("horaire")
                          or champs_contact(contact).get("rdv_existant"))
        ancien_id = (rdv_du_contact or {}).get("id")
        rdv_id = base.ajouter_rendezvous(
            client_id, resultat["new_datetime"], motif,
            duree_tranches=tranches)
        noter_changement(base, campagne, contact, "ajout",
                         client_id=client_id, rendezvous_id=rdv_id,
                         nouvelle_date=resultat["new_datetime"], motif=motif,
                         duree=duree,
                         raison="autre date convenue au téléphone")
        libere = _liberer_ancien_rendezvous(
            base, preferences, campagne, options, contact,
            pourquoi=MOTIF_LIBERATION_AUTRE_DATE, maintenant=maintenant)
        base.changer_etat_contact_campagne(contact_id, "accepté", issue)
        # ⚠ THE AGREED DATE MAY BE ONE OF THE CAMPAIGN'S SLOTS (14/08/2026).
        # When several slots are announced in the same call, `another date`
        # often means `another of the ones you have just quoted me`. This
        # branch then created the appointment on it WITHOUT marking the slot:
        # it stayed `to be filled`, was re-announced to the next contact, who
        # was refused it — and it was then declared `taken in the meantime`
        # when it was THIS campaign that had filled it. `Filled by us` is not
        # `taken elsewhere`: that is the reason both statuses exist (see
        # `_perdre_la_place_si_prise`).
        notre_place = _place_de_la_campagne(campagne, configuration,
                                           resultat["new_datetime"])
        if notre_place:
            marquer_creneau(base, campagne["id"], resultat["new_datetime"],
                            CRENEAU_POURVU, contact_id=contact_id,
                            rendezvous_id=rdv_id)
            detail = (f"Place du {date_courte(resultat['new_datetime'])} prise "
                      f"(rendez-vous n°{rdv_id}) — c'était l'une des places "
                      "annoncées, elle est pourvue")
        else:
            detail = ("Autre date convenue : "
                      f"{date_courte(resultat['new_datetime'])} — "
                      "le créneau libéré reste à pourvoir")
        if libere:
            detail += f" — {libere}"
            # The slot the contact has just left becomes in turn a slot to be
            # filled: exactly the §8.3 rule, the same as for `accepted` and for
            # an accepted move.  ⚠ THROUGH `_rendre_la_place`, AND NO LONGER
            # DIRECTLY THROUGH `_suite_de_cascade` (14/08/2026). That direct
            # call skipped the owner's two decisions: the `shift in cascade`
            # option (it built a prepared campaign without anybody asking) and
            # the sharing of the two paths (on a list-based campaign, the slot
            # left behind must JOIN the list, never build a campaign alongside
            # — the two mechanisms together tread on each other, see
            # `_rendre_la_place`). So the screen announced one thing and did
            # the other.
            detail += _rendre_la_place(base, preferences, campagne,
                                       configuration, contact,
                                       ancienne_place, ancien_id)
        base.definir_detail_contact(contact_id, detail)
        # One of the campaign's slots has just been filled: the loop must
        # advance its cursor, exactly as on `accepted`.
        if notre_place and configuration["politique"] == "premier_oui":
            return CONCLUSION_POURVU
        return None
    if issue == "refused":
        base.changer_etat_contact_campagne(contact_id, "refusé", issue)
        date_rdv = champs_contact(contact).get("rdv_existant")
        detail = ("Rendez-vous existant du "
                  f"{date_courte(date_rdv)} intact" if date_rdv else "")
        # ⚠ `AND IF SOMETHING ELSE COMES FREE?` — the answer is written ON THE
        # RECORD, not on the campaign: it applies to future campaigns, which is
        # its whole point. That flag is NOT the 🚫: the person stays callable
        # about THEIR OWN appointments.
        if calle_client.refuse_les_autres_places(resultat):
            client_id = (cible["client_id"]
                         or base.client_pour_contact(contact["nom"], telephone))
            if client_id:
                base.definir_plus_de_proposition(client_id, True)
            noter_changement(base, campagne, contact, "plus_de_proposition",
                             client_id=client_id,
                             raison=RAISON_PLUS_DE_PROPOSITION)
            detail = ((detail + " · " if detail else "")
                      + "🔇 ne veut plus qu'on lui propose de créneau libéré "
                        "(elle reste appelable pour ses rendez-vous)")
            journal.info("Campagne n°%d, contact n°%d : refuse les prochaines "
                         "propositions de créneau", campagne["id"], contact_id)
        base.definir_detail_contact(contact_id, detail or None)
        return None
    if issue == "confirmed":
        detail = "Présence confirmée"
        rdv_vise = rdv_du_contact
        if nature == "deplacement" and rdv_vise is not None:
            # MOVE: the campaign told the client their appointment MUST shift
            # and offered them replacement slots. Their agreement therefore
            # concerns the agreed slot — the appointment is genuinely MOVED,
            # and its length follows (it is the same calendar row changing
            # time).
            return _deplacer_le_rendezvous(
                base, preferences, campagne, configuration, contact, cible,
                rdv_vise, resultat, tranches, duree, issue)
        # ⚠ THE ORDER OF THE TWO BRANCHES IS THE DEFECT (03/09/2026). This one
        # came first, on the sole fact that an appointment was linked to the
        # contact. For a BOOKING loaded from `cancelled, missed and waiting
        # appointments` — its most obvious use — the linked appointment is the
        # one being REPLACED: confirming it resurrected a cancelled date and
        # threw away the one agreed on the phone. The person believed they were
        # expected on the 13th; the schedule showed the 24th of the previous
        # month, marked `confirmé`.
        if rdv_vise is not None and nature not in ("prise_rdv",
                                                   "contact_unique"):
            # Reminder and confirmation: the time does NOT move — nothing to
            # check, the slot is already theirs, we only confirm their
            # attendance. No row in the log: a confirmed attendance changes
            # nothing in the establishment's schedule.
            base.mettre_a_jour_rendezvous(rdv_vise["id"], statut="confirmé")
            detail = (f"Rendez-vous du {date_courte(rdv_vise['horaire'])} "
                      "confirmé")
        # `contact_unique` is no longer created (removed on 03/08/2026), but an
        # existing database may carry a campaign of that kind whose result
        # arrives late: the branch must go on applying it.
        elif nature in ("prise_rdv", "contact_unique"):
            refus = horaires.refus_rendezvous_telephone(
                base, preferences, resultat.get("new_datetime"))
            if refus:
                return _date_refusee(base, campagne, contact, refus,
                                     resultat.get("new_datetime"))
            client_id = (cible["client_id"]
                         or base.client_pour_contact(contact["nom"], telephone))
            motif = (campagne.get("sujet") or motif_contact
                     or (fiche_nature(nature) or {}).get("nom", nature))
            rdv_id = base.ajouter_rendezvous(
                client_id, resultat["new_datetime"], motif, statut="confirmé")
            noter_changement(base, campagne, contact, "ajout",
                             client_id=client_id, rendezvous_id=rdv_id,
                             nouvelle_date=resultat["new_datetime"],
                             motif=motif,
                             duree=duree_lisible_tranches(preferences, 1),
                             raison="rendez-vous obtenu au téléphone")
            detail = ("Rendez-vous obtenu le "
                      f"{date_courte(resultat['new_datetime'])} "
                      f"(n°{rdv_id})")
        base.changer_etat_contact_campagne(contact_id, "accepté", issue)
        base.definir_detail_contact(contact_id, detail)
        return (CONCLUSION_POURVU if configuration["politique"] == "premier_oui"
            else None)
    if issue == "rescheduled":
        rdv_vise = rdv_du_contact
        if rdv_vise is not None:
            # ⚠ THE SAME PATH AS `confirmed`, since 17/08/2026: a date agreed
            # on the phone MOVES the existing row, it never creates a second
            # one. Only the reason carried into the log says which of the two
            # ways of accepting it was.
            return _deplacer_le_rendezvous(
                base, preferences, campagne, configuration, contact, cible,
                rdv_vise, resultat, tranches, duree, issue,
                raison=RAISON_AUTRE_DATE)
        refus = horaires.refus_rendezvous_telephone(
            base, preferences, resultat.get("new_datetime"),
            tranches=tranches)
        if refus:
            return _date_refusee(base, campagne, contact, refus,
                                 resultat.get("new_datetime"))
        client_id = (cible["client_id"]
                     or base.client_pour_contact(contact["nom"], telephone))
        motif = motif_contact or "Rendez-vous convenu par téléphone"
        # `confirmé`: the person said yes on the phone. It is an agreement, not
        # a mere forecast — and that is what the other way of accepting already
        # wrote (his decision of 17/08/2026).
        rdv_id = base.ajouter_rendezvous(
            client_id, resultat["new_datetime"], motif,
            duree_tranches=tranches, statut="confirmé")
        noter_changement(base, campagne, contact, "ajout",
                         client_id=client_id, rendezvous_id=rdv_id,
                         nouvelle_date=resultat["new_datetime"],
                         motif=motif, duree=duree,
                         raison="date convenue au téléphone")
        base.changer_etat_contact_campagne(contact_id, "accepté", issue)
        base.definir_detail_contact(
            contact_id, "Nouvelle date convenue : "
            f"{date_courte(resultat['new_datetime'])}")
        return (CONCLUSION_POURVU if configuration["politique"] == "premier_oui"
            else None)
    if issue == "canceled":
        # CANCELLATION WITH NO REBOOKING. When the client accepts another date
        # during the exchange, the agent returns not `canceled` but
        # `rescheduled`: it is then a plain MOVE, handled above, with its ↔ row
        # in the log. Here nothing was rebooked — so it is THE CLIENT who will
        # get back in touch. No follow-up is scheduled (we only schedule them
        # for those not reached), and their state leads to no campaign: see
        # etats_clients.SANS_CAMPAGNE.
        pouvait_proposer = bool(options.get(CLE_REPLACER_ANNULATION))
        detail = ("Annulé pendant l'appel — c'est le client qui nous "
                  "rappellera : aucune relance, aucune campagne")
        rdv_vise = rdv_du_contact
        if rdv_vise is not None and rdv_vise["statut"] in ("prévu", "confirmé",
                                                           "manqué"):
            # THE OWNER'S THRESHOLD (12 h by default, configurable). Beyond it,
            # the appointment is DELETED: its slot becomes free again and we
            # OFFER a campaign to fill it. Within it, it stays `annulé` and the
            # screen says why we cannot replace it.
            decision = horaires.decision_annulation(
                preferences, rdv_vise["horaire"], maintenant)
            base.mettre_a_jour_rendezvous(rdv_vise["id"],
                                          statut=decision["statut"])
            # ⚠ THE KIND FOLLOWS THE STATUS WRITTEN (see `genre_de_retrait`):
            # it was `suppression` in both cases, including when the
            # appointment stayed `annulé` and its slot blocked.
            noter_changement(base, campagne, contact,
                             horaires.genre_de_retrait(decision["statut"]),
                             client_id=rdv_vise.get("client_id"),
                             rendezvous_id=rdv_vise["id"],
                             ancienne_date=rdv_vise["horaire"],
                             motif=rdv_vise.get("motif") or motif_contact,
                             duree=duree,
                             raison="annulé par le client pendant l'appel — "
                                    "il reprendra contact lui-même. "
                                    + decision["pourquoi"])
            if decision["compensable"]:
                detail += (f" — le rendez-vous du "
                           f"{date_courte(rdv_vise['horaire'])} est SUPPRIMÉ, "
                           "sa place redevient libre")
                # The cascade option PREPARES the compensating campaign (state
                # `prête`, no calls); without it, the campaign's summary OFFERS
                # it in one click. In both cases, nothing goes out without the
                # operator's gesture.
                detail += _suite_de_cascade(base, preferences, campagne,
                                            configuration, contact["nom"],
                                            rdv_vise["horaire"],
                                            rdv_vise["id"])
            else:
                detail += (f" — le rendez-vous du "
                           f"{date_courte(rdv_vise['horaire'])} reste "
                           f"« annulé » : {decision['pourquoi']}")
        # The BRIEFING the message carried, so the screen can say what the
        # agent was allowed to do (it is readable in the campaign, it is not a
        # deduction about what was said on the phone).
        detail += (" · consigne de la campagne : proposer une autre date"
                   if pouvait_proposer
                   else " · consigne de la campagne : ne proposer aucune date")
        base.changer_etat_contact_campagne(contact_id, ETAT_RAPPELLERA, issue)
        base.definir_detail_contact(contact_id, detail)
        return None
    # to_reschedule: nothing was concluded on the phone. WHAT FOLLOWS DEPENDS
    # ON THE KIND since 11/08/2026 — see _rien_de_conclu.
    return _rien_de_conclu(base, preferences, campagne, contact, cible,
                           telephone, rdv_du_contact, resultat, issue,
                           motif_contact, maintenant)


# ⚠ THE HUMAN CALL-BACK IS NO LONGER OFFERED EVERYWHERE (owner's decision,
# 11/08/2026): `we are going to allow the human call-back only in the case of
# an appointment move or a booking`.  WHY THOSE TWO AND NOT THE OTHERS. On a
# move or a booking, something REMAINS to be concluded: a date to be found. So
# a human has real work to do, and calling back makes sense.  On a freed slot,
# no — and it is the owner who said it: `the slot has certainly been given to
# somebody else, so it would mean contacting somebody to tell them "actually we
# wanted to ask you something, but it no longer applies"`. Calling back would
# be disturbing them for nothing.
NATURES_RAPPEL_HUMAIN = ("deplacement", "prise_rdv")


def _rien_de_conclu(base, preferences, campagne, contact, cible, telephone,
                    rdv_du_contact, resultat, issue, motif_contact,
                    maintenant=None):
    """`I cannot tell you right now`: three fates, according to the kind.

    · move, booking → TO BE CALLED BACK BY A HUMAN. A date remains to be found,
    somebody must find it (see NATURES_RAPPEL_HUMAIN).

    · freed slot → REFUSED, and their appointment is KEPT and moved to
    CONFIRMED. The owner's words: `we could not establish whether you are
    interested, so they keep their appointment, and the appointment moves to
    confirmed`. The slot, for its part, goes to somebody else — hence `refusé`,
    which tells the truth about the SLOT without asserting anything about the
    person (it is the detail that says so, in clear).

    · reminder, confirmation → THE CLIENT WILL CALL BACK. Here the appointment
    being discussed is THEIRS: they really can call us back about it, and no
    work is left pending on our side. Their appointment is NOT touched —
    confirming it outright on a confirmation campaign would invent the very
    confirmation we did not obtain.
    """
    contact_id = contact["id"]
    nature = campagne["nature"]
    demande = resultat.get("notes", "")
    if nature in NATURES_RAPPEL_HUMAIN:
        base.changer_etat_contact_campagne(contact_id,
                                           "à rappeler par un humain", issue)
        base.definir_detail_contact(contact_id,
                                    f"Demande du client : « {demande} »")
        noter_changement(base, campagne, contact, "humain",
                         ancienne_date=(rdv_du_contact or {}).get("horaire")
                         or champs_contact(contact).get("rdv_existant"),
                         motif=motif_contact, raison=demande)
        return None
    if nature == "creneau_libere":
        base.changer_etat_contact_campagne(contact_id, "refusé", issue)
        detail = ("Nous n'avons pas pu déterminer si cette personne était "
                  "intéressée par la place. Elle conserve son rendez-vous")
        confirme = _confirmer_le_rendezvous(base, campagne, contact, cible,
                                            telephone, rdv_du_contact, demande)
        detail += confirme if confirme else "."
        base.definir_detail_contact(contact_id, detail)
        return None
    # Appointment reminder, confirmation: it is the client who will get back in
    # touch — and their appointment is CANCELLED.  ⚠ HIS RULE, OF 17/08/2026:
    # `if the person has to call back, the appointment is simply cancelled`.
    # Before, the appointment was NOT touched: the slot stayed blocked for
    # somebody who had just said they would not come as planned. The practice
    # kept a gap it did not know it had.  `Annulé`, not `supprimé`: the row
    # stays on the schedule, visible, and its slot becomes free again. It is
    # the same writing as for a refusal on the phone
    # (planificateur._appliquer_issue, status `canceled`), and it is what lets
    # a freed-slot campaign take it up.
    base.changer_etat_contact_campagne(contact_id, ETAT_RAPPELLERA, issue)
    detail = ("Rien n'a été conclu au téléphone : c'est cette personne qui "
              f"rappellera. Ce qu'elle a dit : « {demande} »")
    cible_rdv = _annuler_le_rendezvous(base, campagne, contact, rdv_du_contact,
                                       demande)
    detail += cible_rdv if cible_rdv else " Aucun rendez-vous à annuler."
    base.definir_detail_contact(contact_id, detail)
    return None


def _annuler_le_rendezvous(base, campagne, contact, rdv_du_contact, demande,
                           raison=None, journal_dit="le client rappellera"):
    """Moves the contact's appointment to `annulé`; returns the sentence to
    display.

    Returns "" when there is no appointment to cancel — we do not claim to have
    touched something that does not exist.

    ⚠ ONE ROW IN THE LOG, ALWAYS. The operator has that change to carry over
    into their own software: a silent cancellation would leave them with the
    slot blocked. The same reason as the `confirmation` kind, added on
    11/08/2026 for the reverse status change.

    ⚠ `raison` HAS BEEN A PARAMETER SINCE 20/08/2026, and its default value is
    the previous text, word for word. There are now TWO ways of arriving here —
    `the client will call back` and `the move could not be done` — and the
    change log must say WHICH: it is what he rereads to carry things over into
    his own software.
    """
    if not rdv_du_contact:
        return ""
    if rdv_du_contact.get("statut") == "annulé":
        return ""  # already cancelled: neither a second log row, nor noise
    horaire = rdv_du_contact.get("horaire")
    base.mettre_a_jour_rendezvous(rdv_du_contact["id"], statut="annulé")
    # ⚠ THE LOG ROW CARRIES THEIR APPOINTMENT (21/08/2026, his report). Without
    # `rendezvous_id`, the cancellation entered the log WITH no link to the
    # slot it had just freed — and the `Compenser une absence` panel ignored
    # it: it only accepts changes that designate an appointment. Measured on
    # his campaign no. 119: three appointments cancelled in the log, TWO slots
    # offered for compensation. The third came free in silence, and his screen
    # let him believe it was an inconsistency.
    noter_changement(base, campagne, contact, "annulation",
                     rendezvous_id=rdv_du_contact["id"],
                     ancienne_date=horaire,
                     motif=champs_contact(contact).get("motif") or "",
                     raison=raison or ("Rien n'a été conclu au téléphone : "
                                       "c'est le client qui rappellera — "
                                       f"« {demande} »"))
    journal.info("Campagne n°%d : rendez-vous n°%d ANNULÉ — %s",
                 campagne["id"], rdv_du_contact["id"], journal_dit)
    return (f" Son rendez-vous du {date_courte(horaire)} est ANNULÉ : sa place "
            "redevient libre.")


# ------------------------- a move that did not happen ends up CANCELLED ⚠ HIS
# RULE, OF 20/08/2026, word for word: `when we ask to move an appointment and,
# for one reason or another, we could not move it: it is then cancelled. It is
# after the re-contacts, or else the client who has to call back, to set an
# appointment.`  The reason is simple: a move campaign says `this slot must be
# emptied`. It is only half emptied if the appointments we could not move stay
# in it — and he believed his day was empty. Measured in his database on 20/08:
# he empties a Thursday afternoon, 2 appointments out of 6 stay on the
# schedule.  ⚠ WHEN — HIS CHOICE OF 20/08: when RingBack has FINISHED TRYING,
# not at the first failed call. As long as a follow-up is armed, we are going
# to call back to move it: cancelling in advance would mean talking about an
# appointment that no longer exists.  ⚠ WHO — HIS CHOICE OF 20/08: those we
# could NEVER call too (🚫, no number, record gone). He is not there that day:
# their appointment holds no better. They are in his list of human call-backs,
# and it is by calling them that he will rebook.  ⚠ AND `WE COULD NOT` IS NOT
# `WE DID NOT WANT TO`. My first version confused the two, and the bench
# stopped it on the cascade: a `stop at the first yes` campaign deliberately
# SPARES everybody after the first agreement — their appointment has no reason
# to move, we asked them nothing. It cancelled three appointments per campaign,
# and the cascade chain died at the first link.
ETATS_ENCORE_A_APPELER = (
    "à appeler",
    "en cours",
    # The call HAS gone out, its answer has not come back: `📥 Récupérer les
    # résultats en attente` can still bring it, and that person may very well
    # have accepted. RingBack has not finished trying.
    ETAT_RESULTAT_INCONNU,
)

# The states where the appointment did find a resolution — or had no reason to
# change. `accepté` moved it; `le client rappellera` has ALREADY cancelled it
# through the 17/08 path; `épargné` (shown as `pas appelé`) is a decision of
# the campaign, not a failure.
ETATS_DEPLACEMENT_REGLES = ("accepté", ETAT_RAPPELLERA, "épargné")

RAISON_DEPLACEMENT_MANQUE = (
    "Campagne de déplacement : ce rendez-vous n'a pas pu être déplacé, "
    "il est donc annulé — une nouvelle date reste à fixer")


def cloturer_les_deplacements_non_faits(base, campagne, maintenant=None):
    """Cancels the appointments of a move campaign that stayed in place.

    ⚠ ONE SINGLE PLACE, AND IT IS REPLAYABLE. A contact may stop being `being
    tried` at three moments: the campaign finishes, a follow-up ends without
    concluding anything, or the campaign is closed by hand. Three separate
    writings would have ended up diverging. This one replays harmlessly: an
    appointment already cancelled is not touched again, and no second row
    enters the log.

    Returns the number of appointments cancelled.
    """
    if (campagne or {}).get("nature") != "deplacement":
        return 0
    # The contacts for whom an attempt is STILL TO COME, read in one pass.
    attendus = {r["contact_id"] for r in base.relances_de_campagne(campagne["id"])
                if r["statut"] == "planifiée"}
    annules = 0
    for contact in base.contacts_de_campagne(campagne["id"]):
        if contact["etat"] in ETATS_ENCORE_A_APPELER:
            continue                       # on va encore l'appeler
        if contact["etat"] in ETATS_DEPLACEMENT_REGLES:
            continue  # moved, or already cancelled on 17/08
        if contact["id"] in attendus:
            continue  # an attempt is still to come
        rdv = _rendezvous_vise(base, contact,
                               base.telephone_contact_campagne(contact["id"]))
        # ⚠ ONLY WHAT STILL OCCUPIES THE SLOT (`prévu`, `confirmé`). An
        # appointment already cancelled, deleted, moved or missed no longer
        # blocks the slot it was meant to empty: cancelling it a second time
        # would bring nothing and would dirty the change log.
        if rdv is None or rdv["statut"] not in horaires.STATUTS_OCCUPANTS:
            continue
        phrase = _annuler_le_rendezvous(
            base, campagne, contact, rdv, "",
            raison=RAISON_DEPLACEMENT_MANQUE,
            journal_dit="déplacement non fait")
        if not phrase:
            continue
        annules += 1
        ancien = (contact["detail"] or "").rstrip()
        base.definir_detail_contact(
            contact["id"],
            (ancien + " ·" if ancien else "")
            + " Le déplacement n'a pas pu se faire :" + phrase.rstrip()
            + " Une nouvelle date reste à fixer.")
    if annules:
        journal.info("Campagne n°%d : %d rendez-vous ANNULÉ(S) — le "
                     "déplacement n'a pas pu se faire", campagne["id"], annules)
    return annules


def _confirmer_le_rendezvous(base, campagne, contact, cible, telephone,
                             rdv_du_contact, demande):
    """Moves the contact's appointment to `confirmé`. Returns the sentence to
    display.

    ⚠ ONLY ON A FREED SLOT, and only when the appointment REALLY exists in the
    calendar. With no known appointment there is nothing to confirm, and
    inventing one would be worse than writing nothing: the sentence then says
    so.

    Why `confirmé` is right here: the person PICKED UP, we spoke to them, and
    they did not cancel. Their appointment holds — which is exactly what that
    status says. Nothing is inferred from silence: with no conversation, we
    never come through here (a non-answer follows the unreachable path).
    """
    if rdv_du_contact is None:
        return (" — aucun rendez-vous connu dans l'agenda de RingBack, "
                "il n'y a donc rien à confirmer.")
    if rdv_du_contact["statut"] == "confirmé":
        return (f" du {date_courte(rdv_du_contact['horaire'])}, déjà confirmé.")
    ancien = rdv_du_contact["statut"]
    base.mettre_a_jour_rendezvous(rdv_du_contact["id"], statut="confirmé")
    noter_changement(base, campagne, contact, "confirmation",
                     client_id=((cible or {}).get("client_id")
                                or base.client_pour_contact(contact["nom"],
                                                            telephone)),
                     rendezvous_id=rdv_du_contact["id"],
                     ancienne_date=rdv_du_contact["horaire"],
                     motif=rdv_du_contact.get("motif") or "",
                     raison="la personne a été joignable et n'a pas annulé "
                            f"(réponse non conclusive : « {demande} »)")
    journal.info("Campagne n°%d, contact n°%d : réponse non conclusive sur une "
                 "place libérée — rendez-vous n°%d passé de « %s » à "
                 "« confirmé »", campagne["id"], contact["id"],
                 rdv_du_contact["id"], ancien)
    return (f" du {date_courte(rdv_du_contact['horaire'])}, qui passe en "
            "« confirmé ».")


RAISON_CRENEAU_PROPOSE = "créneau de remplacement accepté au téléphone"
RAISON_AUTRE_DATE = "autre date convenue au téléphone"


def _deplacer_le_rendezvous(base, preferences, campagne, configuration,
                            contact, cible, rdv_vise, resultat, tranches,
                            duree, issue, raison=RAISON_CRENEAU_PROPOSE):
    """📆 The client agrees to move: their appointment is GENUINELY moved.

    ⚠ BOTH WAYS OF ACCEPTING COME THROUGH HERE, and that is the whole point
    (fixed on the evening of 17/08/2026). On the phone, a client can accept in
    two ways: taking the slot offered (the agent returns `confirmed`), or
    agreeing another date (`rescheduled`). For them it is the SAME event — the
    screen writes `✅ accepté` in both cases, in fact. Only `raison` changes: it
    says which of the two, in the log.

    WHAT THAT COST: the second way went through another mechanism, which left
    the old row on the day as `déplacé` and created a SECOND one at the agreed
    date. Measured on his day of 18/08: out of eleven people, four rows moved
    cleanly and two stayed, plus two new ones born elsewhere. Hence his
    observation: `the first appointment was not cancelled, but we did indeed
    add it for the next day`. His day only half emptied.

    ⚠ AND THE DECISION HAD ALREADY BEEN TAKEN, by him, on 14/08/2026: `you move
    an appointment from one date to another, it's dead simple`. It had been
    applied to the cascade (`_rendre_la_place`) and to agreement on an offered
    slot — not to this one. Fixing the path reported and leaving the others is
    the half-correction that brings the same defect back under another name.

    The agreed slot goes through the checks already in place
    (horaires.refus_rendezvous_telephone: closed day, outside hours, slot
    taken, length that does not fit) — those of manual input, never duplicated.
    The length FOLLOWS the appointment: it is the same calendar row changing
    time, `duree_tranches` is not touched.

    On a refusal, the contact goes to `à rappeler par un humain` with the
    requested date in clear — nothing is written that we could not honour.

    When the move CONCLUDES, the slot it frees becomes the slot of a new
    campaign, prepared `prête` when the cascade option is set (§8.3) — never
    launched. It now does so in BOTH ways of accepting: a freed slot is a freed
    slot, whatever the sentence that freed it.
    """
    contact_id = contact["id"]
    nouvelle = resultat.get("new_datetime")
    refus = horaires.refus_rendezvous_telephone(
        base, preferences, nouvelle, tranches=tranches,
        sauf_rdv=rdv_vise["id"])
    if refus:
        return _date_refusee(base, campagne, contact, refus, nouvelle)
    ancienne = rdv_vise["horaire"]
    motif = rdv_vise.get("motif") or champs_contact(contact).get("motif") or ""
    base.mettre_a_jour_rendezvous(rdv_vise["id"], statut="confirmé",
                                  horaire=nouvelle)
    noter_changement(base, campagne, contact, "deplacement",
                     client_id=rdv_vise.get("client_id"),
                     rendezvous_id=rdv_vise["id"], ancienne_date=ancienne,
                     nouvelle_date=nouvelle, motif=motif, duree=duree,
                     raison=raison)
    base.changer_etat_contact_campagne(contact_id, "accepté", issue)
    detail = (f"Rendez-vous DÉPLACÉ du {date_courte(ancienne)} "
              f"au {date_courte(nouvelle)} (durée {duree}, inchangée)")
    detail += _suite_de_cascade(base, preferences, campagne, configuration,
                                contact["nom"], ancienne, rdv_vise["id"])
    base.definir_detail_contact(contact_id, detail)
    journal.info("Campagne n°%d, contact n°%d : rendez-vous n°%d DÉPLACÉ "
                 "%s -> %s", campagne["id"], contact_id, rdv_vise["id"],
                 ancienne, nouvelle)
    return (CONCLUSION_POURVU if configuration["politique"] == "premier_oui"
            else None)


def _rendre_la_place(base, preferences, campagne, configuration, contact,
                     place_rendue, rendezvous_id):
    """What becomes of the slot a contact has just left.

    ⚠ TWO PATHS, AND ONLY ONE AT A TIME (owner's decision of 03/08/2026):

    · the campaign carries a LIST of slots → the slot given back JOINS that
    list. The campaign will carry on by itself on that new gap, with the people
    who remain. No separate `prête` campaign. · the campaign has only ONE slot
    → the original cascading shift, which prepares a following campaign.
    Nothing changes there.

    Why not both: the cascade's convergence rests on each link being STRICTLY
    later than the previous one (see `resserrer_sur_le_creneau`). With a list,
    a slot given back may be EARLIER than a slot still to be filled: the
    reasoning falls, and the two mechanisms together would tread on each other.
    Here the campaign cannot go round in circles — a contact is called only
    once, and the queue always ends up emptying.

    ⚠ AND BOTH PATHS ARE UNDER THE SAME OPTION SINCE 14/08/2026. Owner's
    decision, word for word: `only if the cascade handling option is requested:
    it is an option, not an obligation`.

    THE DEFECT THAT MADE HIM DECIDE, MEASURED IN HIS DATABASE: the `list` path
    added the slot given back WITHOUT ASKING ANYTHING. He had chosen FIVE
    slots; his campaign counted THIRTY-SEVEN, filled thirty-two of them, and
    left him thirty-five rows to carry over into his scheduling software. Every
    person brought forward digs a gap further out, which is filled by digging
    again: it does not stop at the slots he chose, but when nobody is
    interested any more. Unticked, the option leaves the gap VISIBLE on the
    schedule — and it is he who decides whether to make a campaign of it, or
    not.
    """
    if not place_rendue:
        return ""
    # ⚠ THE OPTION COMMANDS BOTH PATHS. Unticked, nothing more to say — the
    # preceding sentence already announces that their slot becomes free again,
    # and the gap is on the schedule.
    options = configuration["options"]
    if not options.get("cascade"):
        return ""
    # ⚠ ONE SLOT OR SEVERAL: THE SLOT LEFT BEHIND JOINS THE CAMPAIGN
    # (15/08/2026). It is HIS mechanism, described by him after three days of
    # reports I could not translate:  `30 calls allowed, we use 8 to fill the
    # slot, we add the new slot freed by the shift […] then when we are on a
    # cascading slot, we reload the contact list […] we call them.`  BEFORE, a
    # campaign with ONE slot — that is, ALL of his, I checked in his database —
    # prepared a `prête` campaign alongside that had to be launched by hand.
    # His no. 12: ceiling 30, SEVEN people called, twenty-three spared,
    # campaign finished, and a no. 13 sitting beside it. From where he sits
    # that is called `the cascade does not work`, and he is right: the campaign
    # stops while it has budget and a slot to fill.  Convergence still holds —
    # that was the objection of 03/08: on a single slot, the slot given back is
    # ALWAYS strictly later (you only bring somebody forward, towards earlier).
    # Two hard bounds are added to it: the cut-off date configured below, and
    # the call ceiling held by the loop (see `executer_campagne`).
    if not configuration.get("liste_de_places"):
        journal.info("Campagne n°%d : place unique — la place quittée du %s "
                     "rejoint la campagne au lieu d'en préparer une autre",
                     campagne["id"], place_rendue)
    # ⚠ AND ITS CUT-OFF DATE, WHEN CONFIGURED, BOUNDS THIS PATH TOO. That is
    # what stops a campaign walking indefinitely into the future: every person
    # brought forward digs a gap further out, and with no stop we fill it by
    # digging again.
    limite = cascade_reglee(options)
    if limite and place_rendue[:10] > limite:
        return (f" — sa place du {date_courte(place_rendue)} reste libre sur "
                f"votre planning : elle tombe après le "
                f"{date_jour_lisible(limite)}, limite réglée pour le décalage "
                "en cascade")
    liste = ajouter_creneau(base, campagne["id"], place_rendue,
                            pourquoi=f"place quittée par {contact['nom']}")
    reste = sum(1 for f in liste if f["statut"] == CRENEAU_A_POURVOIR)
    return (f" — sa place du {date_courte(place_rendue)} rejoint la liste "
            f"de cette campagne ({reste} place(s) encore à pourvoir)")


def _suite_de_cascade(base, preferences, campagne, configuration, demandeur,
                      creneau_libere, rendezvous_bouge=None):
    """The next link, when the option is set; returns the text to display.

    It ONLY acts when the `shift in cascade` option was ticked: without it,
    nothing is prepared and nothing is said — we do not answer a question that
    was not asked. With it, either a campaign is prepared and the screen says
    which, or the chain stops and the screen says why.
    """
    if not configuration["options"].get("cascade"):
        return ""
    prepare = preparer_cascade_creneau_libere(
        base, preferences, campagne, configuration, demandeur, creneau_libere,
        rendezvous_bouge=rendezvous_bouge)
    if not prepare.get("campagne_id"):
        return f" — 🔗 Décalage en cascade : {prepare.get('raison', '')}"
    ecartes = prepare["ecartes"]
    resserrement = (f"{ecartes['anterieurs']} écarté(s) : leur rendez-vous "
                    "est avant cette place"
                    if ecartes["anterieurs"] else "aucun écarté")
    return (f" — 🔗 La place du {date_courte(creneau_libere)} se libère : la "
            f"campagne n°{prepare['campagne_id']} a été PRÉPARÉE sur ce "
            f"créneau, avec les mêmes critères — "
            f"{len(prepare['contacts'])} contact(s) retenu(s), "
            f"{resserrement}. État « prête » : aucun appel n'est parti, "
            "c'est à vous de la valider.")


def mettre_en_pause_sur_panne(base, campagne_id, panne, contact=None):
    """A failure ON OUR SIDE: the campaign stops DEAD, nobody is marked.

    What this function does, and above all what it does NOT do:
    - the contact we were about to call becomes `à appeler` again (they had moved to `en cours`): no attempt is counted against them, no detail is pinned on them — their phone did not ring;
    - the campaign becomes `en pause`, NEVER `terminée`: it is resumed as it stands once the failure is fixed, without losing anybody;
    - the REASON is written in French, with what to do, to be displayed on the record.
    With a list of twenty people and a refused key, all twenty would otherwise have wrongly become `injoignables`: that is exactly what was observed on 01/08/2026, and it is what these three lines prevent.

    TWO EXCEPTIONS, and not one more — the two cases where the PHONE RANG. Putting those contacts back to `à appeler` would ring them a second time for a conversation that has already taken place:
    - ResultatEnAttente: the call went out, its result is still missing. Their state `called, result unknown` has just been written;
    - ResultatInvalide: the answer arrived and RingBack could not read it. Their state `à rappeler par un humain` has just been written, with the raw answer — it is a human who takes over, never the machine.
    """
    APPEL_PARTI = (calle_client.ResultatEnAttente, calle_client.ResultatInvalide)
    if contact is not None and not isinstance(panne, APPEL_PARTI):
        base.changer_etat_contact_campagne(contact["id"], "à appeler", None)
        base.definir_detail_contact(contact["id"], None)
    base.definir_raison_pause_campagne(campagne_id, str(panne))
    base.changer_statut_campagne(campagne_id, "en pause")
    journal.error("Campagne n°%d mise EN PAUSE — %s", campagne_id, panne)


RAISON_SANS_INTERET = ("aucune des places qui restaient n'est plus tôt que "
                       "son rendez-vous — l'avancer ne lui apporterait rien")


def _terminer(base, campagne_id):
    """Ends the campaign — and first says WHY its slots stay empty.

    ⚠ ONE SINGLE CHECKPOINT, ON PURPOSE. A campaign ends in FIVE places in
    `executer_campagne` (slot filled, slot lost, nobody left to call, ceiling
    reached, queue empty). Writing the explanation in four of them and
    forgetting the fifth is exactly the half-correction that had this project
    going round in circles for three days.
    """
    dire_pourquoi_les_places_restent(base, campagne_id)
    # ⚠ AND THE MOVES WE COULD NOT MAKE ARE CANCELLED (20/08/2026). Here,
    # because it is already the single checkpoint at the end of a campaign: a
    # campaign ends in five places, and forgetting it at one of them would have
    # left appointments on the schedule of a day he believes empty.
    cloturer_les_deplacements_non_faits(base,
                                        base.obtenir_campagne(campagne_id))
    base.changer_statut_campagne(campagne_id, "terminée")


def dire_pourquoi_les_places_restent(base, campagne_id):
    """Writes on every slot still `to be filled` WHY it stayed that way.

    ⚠ HIS REPORT OF 15/08/2026: `the cascade stops at the second occurrence;
    normally it should carry on to the cut-off date`. The mechanism itself was
    right — measured in his database: the chain stopped on the 06/11 slot
    because an appointment on 06/12 or later would have been needed to gain
    thirty days from it, and his appointments stop on 23/11. There was simply
    NOBODY to call.

    The defect was therefore not the engine: it was the SILENCE. The slot
    stayed `to be filled`, without a word, and the only explanation lived in an
    internal note (`regle_jouee`) that no screen brings forward. Faced with a
    silent stop, you conclude the product is broken — and you are right to
    think so.

    Three possible causes, stated in this order, because it is the order in
    which they really stop the chain: ① the call ceiling is reached; ② the
    shift's cut-off date is passed; ③ nobody has an appointment far enough out
    — and we then give THE date that would have been needed, plus the reminder
    that the cut-off date has nothing to do with it.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if not campagne:
        return
    configuration = configuration_campagne(campagne)
    liste = creneaux_de(campagne, configuration)
    restantes = [f for f in liste if f["statut"] == CRENEAU_A_POURVOIR]
    if not restantes:
        return
    plafond = plafond_de(configuration)
    appels = appels_passes(base, campagne_id)
    limite = cascade_reglee(configuration["options"])
    gain = gain_de_la_regle(configuration)
    for fiche in restantes:
        origine = fiche.get("pourquoi") or ""
        if plafond and appels >= plafond:
            raison = (f"le maximum de {plafond} appel(s) réglé pour cette "
                      "campagne est atteint — relevez-le pour continuer la "
                      "chaîne")
        elif limite and fiche["horaire"][:10] > limite:
            raison = ("elle tombe après le "
                      f"{date_jour_lisible(limite)}, la date limite réglée "
                      "pour le décalage en cascade")
        elif gain:
            borne = (datetime.datetime.fromisoformat(fiche["horaire"])
                     + datetime.timedelta(days=int(gain)))
            raison = ("personne n'a de rendez-vous au "
                      f"{date_courte(borne.isoformat(timespec='minutes'))} "
                      f"ou après — c'est ce qu'il faudrait pour gagner les "
                      f"{gain} jours demandés sur cette place. La chaîne "
                      "s'arrête donc ici")
            if limite and fiche["horaire"][:10] <= limite:
                raison += (f", AVANT votre date limite du "
                           f"{date_jour_lisible(limite)} — ce n'est pas elle "
                           "qui l'arrête")
        else:
            raison = ("plus personne à appeler : aucun rendez-vous connu "
                      "n'est après cette place")
        fiche["pourquoi"] = f"{origine} — {raison}" if origine else raison
    _ecrire_creneaux(base, campagne_id, configuration, liste)
    journal.info("Campagne n°%d : %d place(s) restée(s) à pourvoir — la raison "
                 "est écrite sur chacune", campagne_id, len(restantes))


def campagne_a_des_places(campagne):
    """Does this campaign ANNOUNCE slots to be filled on the phone?

    ⚠ IT IS NOT `DOES IT CARRY A SLOT IN THE DATABASE`. A cascade link of the
    `déplacement` kind carries the freed slot as a TRACE (the §8.3 rule, and
    the anti-duplicate check uses it), but its message announces COMPUTED
    REPLACEMENT slots — never that slot. Confusing the two made the cursor
    `advance` on a slot nobody was offering, and showed the remaining contacts
    a reason that matched nothing.

    `INFO_CRENEAU_PAR_NATURE` is the only place that knows which kinds have a
    step-2 field carrying their slot: so it is the one that answers.
    """
    return (campagne or {}).get("nature") in INFO_CRENEAU_PAR_NATURE


def _place_perdue(base, preferences, campagne, configuration):
    """Is the slot the campaign offers still free? Returns the reason.

    Returns "" when all is well — hence when there is nothing to prevent.

    ⚠ IT ONLY APPLIES TO CAMPAIGNS THAT OFFER A SLOT. A reminder or a
    confirmation campaign books nothing: it has no slot to lose, and looking
    for one would stop it for no reason.

    ⚠ THE MINIMUM LENGTH, ONE SLOT. What is answered here is `does this slot
    still exist`, not `does it fit for such and such a person`: an appointment
    of two slots may be refused on a free slot of one, and that refusal
    concerns ONE contact, not the campaign. Judging it with the first contact's
    length would have stopped the campaign for everybody else.

    ⚠ AND ONLY THE SLOT STILL `TO BE FILLED`. First version: it fell back on
    `campagne["creneau"]` when the list returned nothing — hence on the slot
    the campaign had JUST filled itself. On a campaign set to `call the whole
    list`, the first yes booked the slot, the slot became occupied, and the
    guard stopped everything: twenty bench checks fell on that. `Filled by us`
    and `taken elsewhere` are not the same thing — that is in fact why both
    statuses exist.
    """
    if campagne["nature"] not in INFO_CRENEAU_PAR_NATURE:
        return ""
    place = (creneau_courant(campagne, configuration) or {}).get("horaire")
    if not place:
        return ""
    return horaires.refus_rendezvous_telephone(base, preferences, place,
                                               tranches=1) or ""


# ============================ THE STATES SAID IN PLAIN WORDS ⚠ `ÉPARGNÉ` MEANT
# NOTHING TO ITS READER (11/08/2026): `I do not know what the state "épargné"
# means`. The word was right in intent — they were spared a useless call — but
# it is not in the vocabulary of somebody looking at a call list.  ⚠ WE CHANGE
# THE DISPLAYED WORD, NOT THE CODE WRITTEN IN THE DATABASE. Thousands of rows
# already carry `épargné`; rewriting them would be a data migration, while the
# product only does ADDITIVE migrations. The code stays, only its label changes
# — and it changes in ONE place.  ⚠ AND IT IS CALLED `mot_etat`, NOT
# `libelle_etat`: `etats_clients.libelle_etat` already exists and speaks a
# COMPLETELY DIFFERENT vocabulary (a client's states, not a campaign
# contact's). Two functions with the same name for two vocabularies is
# guaranteed confusion at the first rereading.
MOTS_ETAT = {
    "épargné": "pas appelé",
    # ⚠ HIS REQUEST OF 21/08/2026: `rename the state to "❌ annulé — le client
    # rappellera"`. `The client will call back` was true but kept quiet about
    # the FACT: the appointment is CANCELLED. On his campaign no. 119, three
    # people carried that word and he counted two cancellations where there
    # were three. The word now says what happened, then what follows.  ⚠ THE
    # CODE WRITTEN IN THE DATABASE DOES NOT MOVE — the same rule as for
    # `épargné`: hundreds of rows carry it, rewriting them would be a data
    # migration. Only the label changes, and it changes only HERE.
    ETAT_RAPPELLERA: "annulé — le client rappellera",
}


def mot_etat(etat):
    """The word to DISPLAY for this contact state. The code does not move."""
    return MOTS_ETAT.get(etat, etat)


# ⚠ THE SAME PRINCIPLE FOR THE DETAILS ALREADY WRITTEN IN THE DATABASE
# (21/08/2026). `Plafond atteint` has become `maximum de rappels atteint` — but
# hundreds of rows already carry the old text, frozen at call time. Measured in
# his database: 39 contacts. Rewriting them would be a DATA MIGRATION, while
# the product only does additive ones; and they are archives, not labels. So we
# translate them AT DISPLAY TIME, in the only place that shows them.
ANCIENS_MOTS_DETAIL = (
    ("— plafond atteint", "— maximum de rappels atteint"),
    ("plafond de tentatives atteint", "maximum de rappels atteint"),
)


def mot_detail(detail):
    """The detail to DISPLAY: the old vocabulary translated, nothing more.

    The text in the database is never touched — it is what was written that
    day.
    """
    texte = detail or ""
    for ancien, neuf in ANCIENS_MOTS_DETAIL:
        texte = texte.replace(ancien, neuf)
    return texte


# ================== FORCING THE HOUR — IN SIMULATION, AND NOWHERE ELSE Owner's
# request of 13/08/2026: `when there is the error telling us we are outside the
# permitted window while running a campaign, we must show a button to force the
# simulation despite the hour (only for the simulation version, that is very
# important)`.  THE REASON IS CLEAR: in simulation, NO phone rings. The
# politeness guard protects people; at 10pm, on a simulated campaign, it
# protects nobody and only prevents the product from being tried. In REAL calls
# it protects somebody — so it is never forced.  ⚠ THE SAVED FLAG IS NEVER
# ENOUGH ON ITS OWN. It is read back with the CURRENT mode (see
# `heure_forcee`): a campaign forced in simulation, then resumed in real calls,
# finds the guard intact — with no clean-up needed behind it, and without
# having to trust what is written in the database.
CLE_HORAIRE_FORCE = "horaire_force"


def heure_forcee(configuration, mode_reel):
    """Is this campaign running outside the calling window — and is it allowed to?

    Two conditions, never one: the gesture was made on THIS campaign, AND we
    are in simulation. See the comment above.
    """
    return bool(configuration.get(CLE_HORAIRE_FORCE)) and not mode_reel


def noter_heure_forcee(base, campagne_id):
    """Writes on the campaign that the hour was forced (an explicit gesture).

    On the campaign, not in a passing variable: the execution thread rechecks
    the window BETWEEN EVERY CALL (a campaign launched at 18:59 would otherwise
    stop at the next contact), and the screen must be able to say, long
    afterwards, that this one ran outside the permitted hours.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if campagne is None:
        return
    configuration = configuration_campagne(campagne)
    configuration[CLE_HORAIRE_FORCE] = True
    base.definir_configuration_campagne(
        campagne_id, json.dumps(configuration, ensure_ascii=False))


def executer_campagne(application, campagne_id):
    """The body of the execution thread launched by ▶ Start.

    One contact at a time, in the chosen order; BETWEEN two calls, the ⏸ Pause
    / ⏹ Stop command is read back (a call in progress always runs to its end)
    and the time window + the forbidden period are re-checked. `First yes`
    policy: the first YES spares everybody after it and cancels the campaign's
    follow-ups (the objective is met).

    A FAILURE ON OUR SIDE (key refused, service down, credit exhausted) PAUSES
    the campaign at the first call affected: no point inflicting the same
    failure on the following nineteen people, and above all no question of
    marking them `injoignables` for a fault that is ours (see
    mettre_en_pause_sur_panne).
    """
    base = application.base
    planif = application.planif
    preferences = application.preferences
    # We are starting again for real: the reason for an ENDURED pause (a
    # failure on our side) is erased here, whatever the path used to restart. A
    # stale explanation must never stay in front of the user.
    base.definir_raison_pause_campagne(campagne_id, None)
    try:
        campagne = base.obtenir_campagne(campagne_id)
        configuration = configuration_campagne(campagne)
        # ⚠ A QUEUE READ BACK, NOT A FROZEN LIST. The previous `for` loop could
        # not reload itself: reassigning the list does not affect the iteration
        # in progress, and slicing `restants[indice + 1:]` would have indexed
        # ANOTHER list — contacts never called and never marked, or wrongly
        # marked `épargné`. With a queue read back at every turn, a slot being
        # added or a list being regenerated are seen at once. `traites` is the
        # belt: a contact whose state did not move would make the loop spin for
        # ever.
        traites = set()

        def file_a_appeler():
            """What is left to call, read back from the database, in the chosen
            order.
            """
            attente = [c for c in base.contacts_de_campagne(campagne_id)
                       if c["etat"] in ("à appeler", "en cours")
                       and c["id"] not in traites]
            return ordonner_contacts(attente, configuration["ordre"],
                                     campagne.get("creneau"))

        def file_utile():
            """The queue, minus those the remaining slots bring nothing to.

            ⚠ WE DO NOT MARK THEM: the filter is replayed at every turn. A slot
            GIVEN BACK by somebody who accepts may be EARLIER than the current
            slot and make them relevant again — marking them `épargné` would
            have excluded them for good.

            ⚠ AND ONLY ON A LIST-BASED CAMPAIGN. The one with a single slot
            keeps its previous behaviour, to the letter: its list is already
            narrowed at creation, and its cursor never moves.

            ⚠ THE MINIMUM GAIN FOLLOWS THE CURRENT SLOT (15/08/2026). The rule
            loads the list at the FIRST slot's threshold; without this,
            somebody kept for a 35-day gain on the 15/08 slot was offered, once
            the campaign had advanced to 15/09, a slot that only gained them
            two days. See `place_utile_au_contact`.
            """
            if not configuration.get("liste_de_places"):
                return file_a_appeler()
            annoncees = places_annoncees(campagne, configuration)
            gain = gain_de_la_regle(configuration)
            return [contact for contact in file_a_appeler()
                    if interesse_par_une_place(base, contact, annoncees,
                                               gain=gain)]

        def epargner_le_reste(obtenu):
            """Those not called are SPARED, with the reason in clear."""
            for suivant in file_a_appeler():
                base.changer_etat_contact_campagne(suivant["id"], "épargné",
                                                   None)
                base.definir_detail_contact(
                    suivant["id"], f"Jamais appelé — {obtenu}")

        # ⚠ SIMULATION ONLY: the campaign starting replays its kind's list of
        # cases from the beginning. We give the number of people to call so the
        # list FITS inside it: without that number, a five-contact campaign
        # stopped before the last case and the slot was never filled. The real
        # client does nothing with this call (see
        # calle_client.ClientAppels.recommencer_les_cas).
        planif.client_appels.recommencer_les_cas(campagne["nature"],
                                                len(file_utile()))

        # ⚠ DOES THE SLOT STILL EXIST? READ BACK AT START-UP (11/08/2026). THE
        # DEFECT, MEASURED: a campaign whose slot was already occupied placed
        # THIRTY calls for nothing and sent FOURTEEN people to `à rappeler par
        # un humain` — each having been told on the phone that the slot was
        # theirs. The product only noticed AFTER the call, once per person, by
        # refusing to write the appointment.  The same doctrine as
        # mettre_en_pause_sur_panne: no point inflicting the same failure on
        # the following nineteen. And it is worse than a failure — here we
        # would have PROMISED a slot to fourteen people.  ⚠ AT START-UP, NOT
        # BEFORE EVERY CALL. First version: it read the slot back at every turn
        # of the loop, and therefore stopped a campaign set to `call the whole
        # list` as soon as somebody had taken the slot — whereas that case
        # already has its own mechanism (the slot becomes `pourvue`, the cursor
        # advances). Twenty bench checks said so. What had to be prevented was
        # SETTING OFF on a slot that no longer exists; during the campaign, the
        # per-call check (`place_retenue`) does the rest.
        while True:
            perdue = _place_perdue(base, preferences, campagne, configuration)
            if not perdue:
                break
            place = (creneau_courant(campagne, configuration) or {}).get(
                "horaire")
            journal.info("Campagne n°%d : la place du %s n'est plus disponible "
                         "(%s) — aucun appel ne part pour elle",
                         campagne_id, place, perdue)
            marquer_creneau(base, campagne_id, place, CRENEAU_PERDU,
                            pourquoi=perdue)
            campagne, configuration, suivante, _ = (
                avancer_sur_la_place_suivante(base, preferences, campagne,
                                              configuration))
            if suivante is None:
                epargner_le_reste("la place proposée n'est plus disponible : "
                                  f"{perdue}")
                _terminer(base, campagne_id)
                return

        # ⚠ THE CEILING IS A BUDGET OF CALLS, AND IT IS HERE THAT IT IS HELD
        # (15/08/2026). Before, it only bounded the SIZE of the list: since
        # nobody was added along the way, that was enough. Since the cascade
        # reloads contacts onto its slots (see `regenerer_la_liste`), the list
        # can grow — and it is the loop that must count. Without this guard, a
        # ceiling of thirty would have let fifty calls go out.
        plafond_appels = plafond_de(configuration)

        while True:
            if (plafond_appels
                    and appels_passes(base, campagne_id) >= plafond_appels):
                journal.info("Campagne n°%d : maximum de %d appel(s) atteint — "
                             "la campagne s'arrête, personne d'autre n'est "
                             "composé", campagne_id, plafond_appels)
                if file_a_appeler():
                    epargner_le_reste(
                        f"le maximum de {plafond_appels} appel(s) réglé pour "
                        "cette campagne est atteint : aucun autre numéro n'est "
                        "composé. Relevez-le dans la campagne pour continuer, "
                        "ou reprenez ces personnes dans une nouvelle campagne")
                break
            file = file_utile()
            if not file:
                # ⚠ PEOPLE MAY BE LEFT: those none of the remaining slots
                # brings anything to. Leaving them `à appeler` on a finished
                # campaign would have suggested pending work — they are spared,
                # with the reason in clear.
                if file_a_appeler():
                    epargner_le_reste(RAISON_SANS_INTERET)
                break
            contact = file[0]
            traites.add(contact["id"])
            commande = application.commande_execution(campagne_id)
            if commande == "pause":
                base.changer_statut_campagne(campagne_id, "en pause")
                journal.info("Campagne n°%d mise en PAUSE entre deux appels",
                             campagne_id)
                return
            if commande == "arret":
                base.changer_statut_campagne(campagne_id, "arrêtée")
                journal.info("Campagne n°%d ARRÊTÉE entre deux appels",
                             campagne_id)
                return
            # ⚠ THE FORBIDDEN PERIOD, THOUGH, IS NEVER FORCED — in any mode.
            # Owner's decision: it applies to everything, without exemption.
            # Only the time window is lifted, and only in simulation (see
            # `heure_forcee`).
            blocage = dans_periode_interdite(preferences)
            if not blocage and not heure_forcee(configuration,
                                                application.mode_reel):
                blocage = themes.hors_plage(preferences)
            if blocage:
                # ⚠ AND THE REASON IS WRITTEN (14/08/2026, cross audit). A
                # campaign started at 18:55 stopped at 19:00 in the middle of
                # its list, status `en pause` and NOTHING else: neither on the
                # record nor anywhere. The operator only learned it by clicking
                # ▶ Reprendre again, which then returned the refusal. It is the
                # same duty as the ENDURED pause of a failure, which writes it
                # from the start (see mettre_en_pause_sur_panne).
                base.definir_raison_pause_campagne(campagne_id, blocage)
                base.changer_statut_campagne(campagne_id, "en pause")
                journal.info("Campagne n°%d mise en pause : %s",
                             campagne_id, blocage)
                return
            base.changer_etat_contact_campagne(contact["id"], "en cours", None)
            try:
                conclusion = _appeler_contact(base, planif, preferences,
                                              campagne, configuration, contact,
                                              tentative=0)
            except calle_client.EchecDeNotreCote as panne:
                mettre_en_pause_sur_panne(base, campagne_id, panne, contact)
                return
            if conclusion in (CONCLUSION_POURVU, CONCLUSION_PLACE_PERDUE) \
                    and not campagne_a_des_places(campagne):
                # ⚠ THIS KIND ANNOUNCES NO SLOT (14/08/2026, cross audit). A
                # cascade link of the `déplacement` kind does carry the freed
                # slot — it is the §8.3 trace, and the anti-duplicate check
                # uses it — but its message announces REPLACEMENT slots. Making
                # the cursor `advance` on that slot realigned the message onto
                # it and showed the remaining contacts a reason that matched
                # nothing. Here a yes concludes: that is all.
                epargner_le_reste(
                    "arrêt au premier oui (le rendez-vous a été déplacé)")
                annulees = base.annuler_relances_campagne(campagne_id)
                if annulees:
                    journal.info("Campagne n°%d : objectif atteint, %d "
                                 "relance(s) annulée(s)", campagne_id, annulees)
                _terminer(base, campagne_id)
                return
            if conclusion == CONCLUSION_PLACE_PERDUE:
                # ⚠ THE SLOT HAS JUST DIED DURING THE CAMPAIGN. The start-up
                # check could see nothing: it was free when we began. So here
                # we do exactly what it does — advance to the next slot, or
                # spare the rest — instead of going on calling about a slot
                # that no longer exists.
                campagne, configuration, suivante, raison = (
                    avancer_sur_la_place_suivante(
                        base, preferences, campagne, configuration))
                if suivante is not None:
                    continue
                epargner_le_reste(
                    raison if raison and raison != "toutes les places sont "
                                                   "pourvues"
                    else "la place proposée a été prise entre-temps — il ne "
                         "reste aucune place à pourvoir")
                _terminer(base, campagne_id)
                return
            if conclusion == CONCLUSION_POURVU:
                obtenu = ("le rendez-vous a été déplacé"
                          if campagne["nature"] == "deplacement"
                          else "le créneau est pourvu")
                # ⚠ A FILLED SLOT NO LONGER NECESSARILY STOPS THE CAMPAIGN
                # (03/08/2026): when one is left to fill, we read the campaign
                # back — hence its NEW slot and its realigned message — and
                # carry on with the people who remain.
                campagne, configuration, suivante, raison = (
                    avancer_sur_la_place_suivante(
                        base, preferences, campagne, configuration))
                if suivante is not None:
                    continue
                # ⚠ THE EXACT REASON, not the usual one. When slots are left
                # and the message cannot follow, writing `stop at the first
                # yes` would be false — and it is precisely what an operator
                # would reread to understand.
                epargner_le_reste(
                    f"arrêt au premier oui ({obtenu})"
                    if raison == "toutes les places sont pourvues"
                    else f"campagne arrêtée : {raison}")
                annulees = base.annuler_relances_campagne(campagne_id)
                if annulees:
                    journal.info("Campagne n°%d : objectif atteint, %d "
                                 "relance(s) annulée(s)", campagne_id, annulees)
                _terminer(base, campagne_id)
                return
        _terminer(base, campagne_id)
    except Exception:
        journal.exception("Campagne n°%d : incident d'exécution — mise en "
                          "pause (rien d'inventé)", campagne_id)
        base.changer_statut_campagne(campagne_id, "en pause")
    finally:
        application.terminer_execution(campagne_id)


def executer_relance(base, planif, preferences, campagne, relance, contact,
                     maintenant=None):
    """One due follow-up of an assistant campaign — the same engine, the same
    states. Called by the GESTURE `Lancer les relances dues`
    (campagnes.executer_relances_dues); AUTOMATIC execution remains `à venir`.

    ⚠ THE RULE OF INTEREST IS REPLAYED HERE (10/08/2026). It filtered the
    campaign's queue, but not the departure of a follow-up: somebody whose
    appointment is already earlier than every remaining slot was called back
    about a slot that no longer brought them forward. The same check also
    decides consent — see `interesse_par_une_place`.

    The phone then does NOT ring, and the contact becomes 💤 spared with the
    reason in clear: the follow-up is used up, it will not come back.
    """
    configuration = configuration_campagne(campagne)
    if configuration.get("liste_de_places"):
        annoncees = places_annoncees(campagne, configuration)
        if not interesse_par_une_place(base, contact, annoncees, maintenant,
                                       gain=gain_de_la_regle(configuration)):
            raison = (RAISON_PLUS_DE_PROPOSITION
                      if base.plus_de_proposition(contact.get("client_id"))
                      else RAISON_SANS_INTERET)
            base.changer_etat_contact_campagne(contact["id"], "épargné", None)
            base.definir_detail_contact(contact["id"],
                                        f"Relance abandonnée — {raison}")
            journal.info("Campagne n°%d, contact n°%d : relance ABANDONNÉE, "
                         "aucun appel — %s", campagne["id"], contact["id"],
                         raison)
            return {"contact": contact["nom"], "issue": None, "abouti": False,
                    "etat": "épargné"}
    conclusion = _appeler_contact(base, planif, preferences, campagne,
                                  configuration, contact,
                                  tentative=relance["tentative"],
                                  maintenant=maintenant)
    contact_frais = base.obtenir_contact_campagne(contact["id"])
    abouti = contact_frais["etat"] == "accepté"
    if conclusion == CONCLUSION_POURVU:
        base.annuler_relances_campagne(campagne["id"])
    return {"contact": contact["nom"], "issue": contact_frais["issue"],
            "abouti": abouti, "etat": contact_frais["etat"]}


# --------------------------------------------------------------------------- 📥
# RETRIEVE THE PENDING RESULTS — without calling anybody back
# ---------------------------------------------------------------------------
# The gesture that repairs the loss of 01/08/2026. It dials NO number: for
# every call already gone out whose result is missing, it makes ONE read (GET
# /v1/calls/{identifiant}) and applies the outcome through the SAME path as if
# it had arrived on time (_appliquer_resultat) — appointment moved, change log,
# cascade, follow-ups, everything.  The three real-mode locks are not
# concerned: they guard the CREATION of calls, and there is not a line here
# that could create one.
GESTE_SANS_APPEL = ("Ce geste ne compose AUCUN numéro : il ne fait que LIRE, "
                    "chez CALL-E, le résultat d'appels déjà passés.")


def _echec_de_lecture(erreur):
    """The message of a READ that failed — framed as a read.

    The original text talks about a campaign and billed calls (it was written
    for a call that goes out). Here nothing went out: we say so first, then
    quote the observation as it stands. Without that framing, the screen would
    suggest a call had just been attempted.
    """
    constat = getattr(erreur, "constat", None) or str(erreur)
    quoi_faire = getattr(erreur, "quoi_faire", "")
    return " ".join(morceau for morceau in (
        "La LECTURE du résultat n'a pas abouti — aucun appel n'a été passé "
        "et rien n'a été écrit. L'identifiant de l'appel est conservé : "
        "réessayez plus tard.",
        constat.rstrip(".") + ".", quoi_faire) if morceau)


def _resume_recuperation(comptes):
    """The summary sentence displayed after the gesture — never an invented count.
    """
    if not comptes:
        return ("Aucun appel en attente de résultat : il n'y avait rien à "
                "récupérer. " + GESTE_SANS_APPEL)
    par_sort = {}
    for compte in comptes:
        par_sort[compte["sort"]] = par_sort.get(compte["sort"], 0) + 1
    morceaux = []
    for sort, libelle in (
            ("applique", "{n} résultat(s) récupéré(s) et appliqué(s)"),
            ("en_cours", "{n} appel(s) encore en cours chez CALL-E — rien "
                         "n'a été écrit, réessayez plus tard"),
            ("sans_reponse", "{n} appel(s) sans réponse — la tentative est "
                             "comptée, comme un non-décroché normal"),
            ("echoue", "{n} appel(s) clos sans succès par CALL-E"),
            ("illisible", "{n} réponse(s) que RingBack n'a pas su lire — la "
                          "conversation a eu lieu, le contact passe « à "
                          "rappeler par un humain » et la réponse brute de "
                          "CALL-E est conservée sur sa fiche"),
            ("panne", "{n} lecture(s) impossible(s) — voir le message "
                      "ci-dessous"),
            ("sans_identifiant", "{n} contact(s) sans identifiant d'appel : "
                                 "leur résultat n'est pas récupérable")):
        if par_sort.get(sort):
            morceaux.append(libelle.format(n=par_sort[sort]))
    return " · ".join(morceaux) + ". " + GESTE_SANS_APPEL


def recuperer_resultats_en_attente(application, campagne_id, maintenant=None):
    """📥 Goes and READS at CALL-E the result of calls already placed. NO CALLS.

    For every `called, result unknown` contact of this campaign:
    - CALL-E says `finished` → the result is applied EXACTLY as if it had arrived on time (_appliquer_resultat: appointment, change log, cascade, follow-ups);
    - CALL-E says `still in progress` → NOTHING is written, we say so, and we will try again later;
    - CALL-E says `nobody picked up` → it is a fact about the contact: the attempt is counted and the follow-up scheduled, as usual;
    - the read itself fails (key refused, service silent) → nothing is written, the id is KEPT, and the batch stops there (the same failure would hit the following ones).

    Returns the list of reports [{"contact", "sort", "message"}].
    """
    base = application.base
    planif = application.planif
    preferences = application.preferences
    campagne = base.obtenir_campagne(campagne_id)
    if campagne is None:
        return []
    configuration = configuration_campagne(campagne)
    en_cascade = bool(campagne["nature"] == "creneau_libere"
                      and campagne.get("creneau"))
    comptes = []
    for contact in base.contacts_de_campagne(campagne_id):
        if contact["etat"] != ETAT_RESULTAT_INCONNU:
            continue
        identifiant = contact.get("appel_externe_id")
        nom = contact["nom"]
        if not identifiant:
            comptes.append({
                "contact": nom, "sort": "sans_identifiant",
                "message": ("Aucun identifiant d'appel n'a été conservé pour "
                            "ce contact : son résultat n'est pas récupérable "
                            "ici. Regardez le tableau de bord CALL-E.")})
            continue
        try:
            lecture = planif.client_appels.lire_resultat(identifiant,
                                                         cascade=en_cascade)
        except calle_client.ResultatInvalide as refus:
            # The answer did arrive: it is RingBack that cannot read it.
            # Retrying would give the SAME unreadable answer — leaving that
            # contact `pending` would make them wait for ever. So we conclude
            # here: to a human, raw answer preserved, and the id is erased
            # (there is nothing left to retrieve).
            tentative = contact.get("appel_externe_tentative")
            if tentative is None:
                tentative = len(base.appels_du_contact_campagne(contact["id"]))
            noter_reponse_illisible(base, campagne_id, contact["id"],
                                    tentative, refus)
            base.effacer_appel_en_attente(contact["id"])
            comptes.append({"contact": nom, "sort": "illisible",
                            "message": str(refus)})
            continue
        except calle_client.EchecDeNotreCote as panne:
            # Nothing is written and the id stays: we will be able to try again
            # as soon as the failure is fixed. The batch stops here.
            comptes.append({"contact": nom, "sort": "panne",
                            "message": _echec_de_lecture(panne)})
            journal.error("Récupération interrompue pour le contact n°%d — %s",
                          contact["id"], panne)
            break
        except calle_client.ErreurApi as erreur:
            comptes.append({"contact": nom, "sort": "panne",
                            "message": _echec_de_lecture(erreur)})
            journal.error("Récupération impossible pour le contact n°%d — %s",
                          contact["id"], erreur)
            break
        comptes.append(_appliquer_lecture(
            base, planif, preferences, campagne, configuration, contact,
            lecture, en_cascade, identifiant, maintenant))
    # Nothing pending any more: the pause's explanation is STALE. The same rule
    # as at a campaign's restart — a reason that no longer holds must never
    # stay in front of the user. The campaign, though, stays paused: it is for
    # the operator to decide to resume it.
    if comptes and not base.contacts_en_attente_de_resultat(campagne_id):
        base.definir_raison_pause_campagne(campagne_id, None)
    return comptes


def _appliquer_lecture(base, planif, preferences, campagne, configuration,
                       contact, lecture, en_cascade, identifiant,
                       maintenant=None):
    """Applies WHAT CALL-E answered for a call already placed."""
    contact_id = contact["id"]
    nom = contact["nom"]
    options = configuration["options"]
    # The attempt of the call that WENT OUT, as it had been recorded: it is
    # that which must appear in the history, not a recomputed value.
    tentative = contact.get("appel_externe_tentative")
    if tentative is None:
        tentative = len(base.appels_du_contact_campagne(contact_id))
    if lecture["etat"] == "en_cours":
        # NOTHING is written: no attempt, no state, no detail. The call keeps
        # its id and the contact keeps its waiting state.
        return {"contact": nom, "sort": "en_cours",
                "message": (f"L'appel n° {identifiant} est ENCORE EN COURS "
                            f"chez CALL-E (statut « {lecture['statut_api']} ») "
                            ": rien n'a été écrit sur cette personne. "
                            "Réessayez dans un moment.")}
    if lecture["etat"] in ("sans_reponse", "echoue"):
        # The call did run to its end, and it produced no conversation: it is
        # the NORMAL path of somebody not reached, exactly the one the answer
        # would have followed had it arrived on time.
        issue = "no_answer" if lecture["etat"] == "sans_reponse" else "echec"
        base.ajouter_appel_campagne(campagne["id"], contact_id, tentative,
                                    issue=issue)
        _apres_non_joint(base, preferences, campagne, options, contact_id,
                         issue, maintenant)
        base.effacer_appel_en_attente(contact_id)
        contact_frais = base.obtenir_contact_campagne(contact_id)
        return {"contact": nom, "sort": lecture["etat"],
                "message": (f"CALL-E a répondu « {lecture['statut_api']} » : "
                            f"le contact passe « {contact_frais['etat']} ».")}
    # `terminé`: THE SAME writing path as if the answer had arrived on time —
    # one piece of code, hence no possible divergence.
    cible = base.cible_appel_contact(contact_id)
    telephone = (cible["telephone"]
                 or base.telephone_contact_campagne(contact_id) or "")
    base.effacer_appel_en_attente(contact_id)
    conclusion = _appliquer_resultat(
        base, planif, preferences, campagne, configuration, contact,
        tentative, lecture["issue"], en_cascade, cible, telephone, maintenant)
    if conclusion == CONCLUSION_POURVU:
        annulees = base.annuler_relances_campagne(campagne["id"])
        if annulees:
            journal.info("Campagne n°%d : objectif atteint par un résultat "
                         "récupéré, %d relance(s) annulée(s)",
                         campagne["id"], annulees)
    contact_frais = base.obtenir_contact_campagne(contact_id)
    return {"contact": nom, "sort": "applique",
            "issue": contact_frais["issue"], "etat": contact_frais["etat"],
            "message": (f"Résultat récupéré et appliqué : "
                        f"{contact_frais['etat']} — "
                        f"{contact_frais['detail'] or ''}").strip(" —")}
