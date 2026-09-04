"""RingBack — data access (sqlite3).

Ten tables: clients, appointments, calls, cascades, cascade calls, the
`campaign` model (campagnes, contacts_campagne, appels_campagne, relances) — a
campaign is the instantiation of a WORK THEME on a list of contacts imported at
that moment; every call that does not conclude generates a scheduled follow-up
there that keeps the theme — and the CHANGE LOG (changements): a row written AT
THE MOMENT the schedule moves, so that a campaign's real deliverable — the list
of changes to be carried over into the establishment's scheduling software — is
never reconstructed after the fact, and therefore loses nothing. Strict privacy
rule: a phone number NEVER comes out in clear in the logs or in the interface —
see masquer_telephone().

WHO IS CALLED, AND ON WHICH NUMBER. A campaign contact carries a LINK to the
client record (contacts_campagne.client_id): it is that record's CURRENT number
that is dialled, never the copy made at campaign time (which stays as a trace
of what was imported). Correcting a number therefore corrects every running
campaign, and the 🚫 `Ne plus appeler` can no longer be bypassed by a
correction. A merely pasted contact receives a record when it enters the
campaign, so the link always exists. The compulsory checkpoint before dialling
is cible_appel_contact(): it holds the link AND the safety net (the number OR
the name of a client marked 🚫, a deleted record). A client imported from an ICS
calendar may have no number: their telephone is then "" (an empty string) until
it is completed. The clients.jeu_essai flag marks the SAMPLE DATA SET's records
(module jeu_essai): they are added to the real data and are removed in one go
(supprimer_jeu_essai) without ever touching the user's clients.

THE TEST NUMBERS (module essai_reel). The operator may declare their TESTERS'
numbers in ⚙ Réglages — their own, a colleague's, a friend's who agrees to play
a role — to exercise the product in real conditions. Those numbers are handed
to Base.numeros_essai, and it is HERE that they are used: everywhere a number
is masked for the screen, the returned row also carries `numero_essai`
(true/false). The interface uses it to mark the person concerned 🧪. A test
number stays MASKED like all the others: this flag does not reveal it, it only
says `this is a test`. Migration: additive only (CREATE TABLE IF NOT EXISTS +
ALTER TABLE ADD COLUMN) — an existing database is enriched at its next launch,
never rewritten.

`ANNULÉ` IS A HISTORY STATUS, `SUPPRIMÉ` REMOVES THE ROW FROM THE VIEWS.
Owner's rule (31/07/2026): `annulé is for past dates, otherwise we delete the
appointment, that leaves a free slot.` An UPCOMING appointment that is
cancelled therefore no longer carries `annulé` but STATUT_SUPPRIME — see that
constant's comment for WHY a status rather than a DELETE.
"""

import datetime
import functools
import inspect
import json
import logging
import os
import re
import sqlite3
import threading
import unicodedata

journal = logging.getLogger("ringback.db")

# --------------------------------------------------- `supprimé`: the choice
# THE OWNER'S RULE, word for word (31/07/2026): `annulé is for past dates,
# otherwise we delete the appointment, that leaves a free slot`.  WHAT WAS
# CHOSEN, AND WHY. `Deleting` does NOT erase the row from the database: it
# takes the `supprimé` status, which removes it from every working view and
# from the slot computation. Three reasons, all verifiable in this file: 1. the
# CHANGE LOG points at the appointment (changements.rendezvous_id) — that is
# where the history lives (who, when, reason, why, timestamp). A DELETE would
# leave that link dangling; 2. the CAMPAIGN CONTACTS point at the appointment
# (contacts_campagne.rendezvous_id): erasing it would break the link between a
# past campaign and what it was about; 3. the CALLS point at the appointment
# (appels.rendezvous_id): a call that really took place must never become
# orphaned. A hard erase would break those three links WITHOUT bringing the
# user anything: what they ask is that the appointment disappear from their
# screens and that the slot become free again — both are obtained. Should the
# owner prefer a real erase, it is HERE that it will be fixed, and nowhere
# else.
STATUT_SUPPRIME = "supprimé"

# The statuses that no longer HOLD: neither an occupied slot, nor an `upcoming`
# row. `supprimé` adds that it ALSO leaves the working lists and the counts —
# it survives only in the change log, in `Tous les rendez-vous` and on the
# client's record (the two archives).
STATUTS_SANS_PLACE = ("annulé", "déplacé", "ignoré", STATUT_SUPPRIME)

SCHEMA = """
CREATE TABLE IF NOT EXISTS clients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nom             TEXT NOT NULL,
    telephone       TEXT NOT NULL,
    ne_plus_appeler INTEGER NOT NULL DEFAULT 0,    -- 1 : exclu de tout appel (réversible)
    jeu_essai       INTEGER NOT NULL DEFAULT 0,    -- 1 : client du JEU D'ESSAI (retirable en bloc)
    -- 1 : ne veut plus qu'on lui PROPOSE de créneau libéré. ⚠ CE N'EST PAS LE
    -- 🚫 : elle reste appelable pour SES rendez-vous (rappel, confirmation,
    -- déplacement) — c'est le démarchage d'une place libre qu'elle refuse.
    -- Demandé au téléphone après un refus (voir assistant), réversible depuis
    -- 👥 Contacts. Par défaut 0 : refuser une place une fois n'a jamais
    -- signifié refuser les suivantes.
    plus_de_proposition INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rendezvous (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER NOT NULL REFERENCES clients(id),
    horaire         TEXT NOT NULL,                 -- ISO 8601
    motif           TEXT NOT NULL,
    statut          TEXT NOT NULL DEFAULT 'prévu', -- prévu | manqué | confirmé | déplacé | annulé | ignoré | supprimé
                                                   -- « annulé » = histoire d'une date PASSÉE ;
                                                   -- « supprimé » = le rendez-vous n'existe plus
                                                   -- (hors de toutes les vues, place rendue libre)
    rappel_souhaite TEXT,                          -- ISO 8601, optionnel : quand le client souhaite être rappelé
    duree_tranches  INTEGER NOT NULL DEFAULT 1     -- durée en TRANCHES (voir horaires.py) ; 1 = la durée moyenne
);
CREATE TABLE IF NOT EXISTS appels (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    rendezvous_id INTEGER NOT NULL REFERENCES rendezvous(id),
    statut        TEXT NOT NULL DEFAULT 'en file', -- en file | terminé | annulé | échec
    resultat      TEXT,                            -- JSON structuré renvoyé par l'agent
    transcription TEXT,
    note          TEXT,                            -- ce que LE PRODUIT a décidé (jamais
                                                   -- du texte d'agent) : refus d'écrire
                                                   -- une date impossible, appel non composé…
    appel_externe_id TEXT,                         -- l'identifiant de CET appel chez CALL-E,
                                                   -- gardé dès que la création aboutit : un
                                                   -- appel parti ne peut plus être perdu
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cascades (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    mission       TEXT NOT NULL,
    creneau       TEXT NOT NULL,                   -- ISO 8601 : le créneau libéré
    statut        TEXT NOT NULL DEFAULT 'en cours',-- en cours | pourvue | épuisée
    rendezvous_id INTEGER REFERENCES rendezvous(id),
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS appels_cascade (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    cascade_id    INTEGER NOT NULL REFERENCES cascades(id),
    rang          INTEGER NOT NULL,                -- position dans la liste collée
    nom           TEXT NOT NULL,
    telephone     TEXT NOT NULL,
    etat          TEXT NOT NULL,                   -- appelé | épargné | exclu
    issue         TEXT,      -- accepted | refused | no_answer | moved | echec |
                             -- date_refusee (nul si épargné)
    resultat      TEXT,                            -- JSON structuré renvoyé par l'agent
    transcription TEXT,
    note          TEXT,                            -- ce que LE PRODUIT a décidé
    rendezvous_libere INTEGER REFERENCES rendezvous(id)  -- l'ancien rendez-vous
                             -- réellement libéré par CET appel (NULL : aucun —
                             -- soit il n'y en avait pas, soit on ne savait pas
                             -- lequel, et la note le dit en clair)
);
CREATE TABLE IF NOT EXISTS campagnes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nom           TEXT NOT NULL,                  -- nom auto lisible (« Créneau libéré du 03/08 14h — 28/07 »)
    theme         TEXT NOT NULL,                  -- creneau_libere | confirmation | manque (+ contact_unique | personnalise : retirés le 03/08/2026, encore LISIBLES en base)
    sujet         TEXT NOT NULL DEFAULT '',      -- sujet libre (servait au « contact unique », retiré)
    mission       TEXT NOT NULL DEFAULT '',      -- la mission validée au lancement (jamais de numéro dedans)
    creneau       TEXT,                          -- ISO 8601 : créneau libéré / date concernée (selon le thème)
    statut        TEXT NOT NULL DEFAULT 'en cours', -- en cours | terminée | close ;
                                                  -- assistant : prête | en cours | en pause | arrêtée | terminée
    cascade_id    INTEGER REFERENCES cascades(id),  -- la cascade rattachée (thème créneau libéré)
    nature        TEXT,                          -- nature de l'assistant (nul : campagne d'avant l'assistant)
    configuration TEXT,                          -- JSON : politique, ordre, options, infos, champs (assistant)
    raison_pause  TEXT,                          -- POURQUOI la campagne s'est mise en pause toute seule
                                                  -- (panne de NOTRE côté : clé refusée, service en panne…).
                                                  -- Effacée au redémarrage. NULL : pause voulue par l'opérateur.
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contacts_campagne (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    campagne_id   INTEGER NOT NULL REFERENCES campagnes(id),
    rang          INTEGER NOT NULL,               -- ordre d'appel dans la liste de l'instant
    nom           TEXT NOT NULL,
    telephone     TEXT NOT NULL,                  -- COPIE d'époque : trace historique,
                                                  -- JAMAIS le numéro composé (voir client_id)
    client_id     INTEGER REFERENCES clients(id), -- LA fiche client : c'est SON numéro
                                                  -- ACTUEL qui est composé. Fiche
                                                  -- disparue -> plus jamais composé.
    rendezvous_id INTEGER REFERENCES rendezvous(id), -- rendez-vous concerné (reprise depuis la base)
    etat          TEXT NOT NULL DEFAULT 'à appeler', -- à appeler | appelé | abouti | épargné | exclu | abandonné ;
                                                  -- assistant : accepté | refusé | à recontacter | injoignable |
                                                  -- à rappeler par un humain | en cours |
                                                  -- appelé, résultat inconnu
    issue         TEXT,                            -- dernière issue (confirmed, no_answer, to_reschedule…)
    champs        TEXT,                            -- JSON : valeurs des colonnes de la campagne (assistant)
    detail        TEXT,                            -- l'information clé affichée (écrite depuis le résultat réel)
    traite_le     TEXT,                            -- horodatage du geste humain « c'est fait » (🙋 rappels manuels)
    appel_externe_id TEXT,                         -- l'identifiant CALL-E de l'appel PARTI dont le
                                                   -- résultat n'est pas encore connu (NULL : aucun)
    appel_externe_tentative INTEGER                -- n° de tentative de cet appel (0 = appel initial)
);
CREATE TABLE IF NOT EXISTS appels_campagne (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    campagne_id   INTEGER NOT NULL REFERENCES campagnes(id),
    contact_id    INTEGER NOT NULL REFERENCES contacts_campagne(id),
    tentative     INTEGER NOT NULL,               -- 0 = appel initial, 1..n = relances
    issue         TEXT,                           -- confirmed | rescheduled | canceled | to_reschedule |
                                                  -- accepted | refused | moved | no_answer | echec
    resultat      TEXT,                           -- JSON structuré renvoyé par l'agent
    transcription TEXT,
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS relances (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    campagne_id   INTEGER NOT NULL REFERENCES campagnes(id),
    contact_id    INTEGER NOT NULL REFERENCES contacts_campagne(id),
    echeance      TEXT NOT NULL,                  -- ISO 8601 : quand la relance devient « due »
    tentative     INTEGER NOT NULL DEFAULT 1,     -- n° de la relance dans la chaîne (1..max)
    statut        TEXT NOT NULL DEFAULT 'planifiée', -- planifiée | faite | annulée
    motif         TEXT NOT NULL DEFAULT '',       -- pourquoi (pas de réponse, déplacement non conclu…)
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS changements (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    campagne_id   INTEGER NOT NULL REFERENCES campagnes(id),
    contact_id    INTEGER REFERENCES contacts_campagne(id),
    client_id     INTEGER REFERENCES clients(id),
    rendezvous_id INTEGER REFERENCES rendezvous(id),
    genre         TEXT NOT NULL,                  -- ajout | suppression | deplacement | humain
    nom           TEXT NOT NULL,                  -- QUI (jamais de numéro ici)
    ancienne_date TEXT,                           -- ISO 8601 : la date d'AVANT
    nouvelle_date TEXT,                           -- ISO 8601 : la date d'APRÈS
    motif         TEXT NOT NULL DEFAULT '',       -- le motif du rendez-vous
    duree         TEXT NOT NULL DEFAULT '',       -- durée lisible (« 30 minutes »)
    raison        TEXT NOT NULL DEFAULT '',       -- POURQUOI, ou la demande en clair
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


# --------------------------------------------------- refusal BEFORE dialling
# The four reasons a campaign contact is NEVER dialled. These texts are
# displayed as they stand in the campaign record's `détail` column: the screen
# always says WHY the call did not go out.
REFUS_STOP = "Client marqué 🚫 « Ne plus appeler »"
REFUS_STOP_NOM = ("Une fiche au même nom est marquée 🚫 « Ne plus appeler » — "
                  "appel refusé par sécurité")
REFUS_SANS_NUMERO = "Aucun numéro à composer"
REFUS_CLIENT_SUPPRIME = ("Fiche client supprimée — ce contact n'est plus "
                         "jamais composé (son historique reste lisible)")
# ⚠ THE APPOINTMENT CHANGED UNDER OUR FEET (21/08/2026, his request). The text
# is completed with WHAT changed — see `rendezvous_change_depuis_la_campagne`.
REFUS_RDV_CHANGE = "Le rendez-vous dont cette campagne parle a changé"

# The statuses that OCCUPY a slot. Copied from `horaires.STATUTS_OCCUPANTS` so
# that db stays independent of the schedule computation — same convention, same
# reason as `calle_client.RATTRAPAGE_JOURS`.
STATUTS_OCCUPANTS_RDV = ("prévu", "confirmé")

# ------------------------------------------- what a refused contact BECOMES ⚠
# HIS REQUEST OF 20/08/2026: `people who have asked not to be called by an AI
# agent any more must be recorded as to be called back by a human in every
# campaign, and therefore undergo the logic of that state`.  They refused THE
# AGENT, not the practice. Marking them `exclu` made them disappear in silence:
# nobody ever called them back, and their matter dropped. `À rappeler par un
# humain` says exactly what must be done, and its logic is already the right
# one: a TERMINAL state, never among the callable states (only `à appeler` and
# `en cours` are dialled), no follow-up armed, no ceiling approached — and the
# person appears in 🔁 Relances § 🙋, with the `done` gesture that takes them out
# of it without erasing anything.  ⚠ THE NAMESAKE TOO, chosen by him on 20/08:
# they asked for nothing, but a human is precisely the only one who can say
# whether it is the same person. Setting them aside in silence over a
# coincidence of name dropped their matter with nobody able to catch it.  The
# other two refusals DO NOT CHANGE: with no number, a human has nothing to dial
# either; with a deleted record, there is nobody left to call back.
ETAT_RAPPEL_HUMAIN = "à rappeler par un humain"
ETAT_EXCLU = "exclu"

SUITE_DU_REFUS = {
    REFUS_STOP: (
        ETAT_RAPPEL_HUMAIN,
        "🚫 A demandé à ne plus être appelée par un agent — aucun appel "
        "automatique ne partira. À rappeler par un humain."),
    REFUS_STOP_NOM: (
        ETAT_RAPPEL_HUMAIN,
        "Une fiche au même nom est marquée 🚫 « Ne plus appeler » — aucun "
        "appel automatique ne part, par sécurité. À rappeler par un humain, "
        "qui saura s'il s'agit de la même personne."),
}


def refus_du_rendezvous(refus):
    """Does this refusal come from an appointment that changed? (for the screens)
    """
    return (refus or "").startswith(REFUS_RDV_CHANGE)


def suite_du_refus(refus):
    """(state, detail) of a contact we do not dial — ONE SINGLE place.

    Six paths refuse to dial: campaign creation, the assistant's call, the
    classic engine, the cascade follow-up, resuming a cascade and the call
    queue. Six separate decisions would have ended up diverging, and the
    divergence would be paid for here in forgotten people.

    An unknown refusal falls back on `exclu` with its text as it stands: that
    is the previous behaviour, and it stays right for everything that is not a
    🚫.
    """
    return SUITE_DU_REFUS.get(refus, (ETAT_EXCLU, refus))


# ⚠ DERIVED FROM THE TABLE, NEVER COPIED. The screens need to tell apart, among
# the 🙋, those who refused the agent from those the agent could not conclude
# with. My first version read `does the detail start with 🚫`: it missed the
# namesake, whose text starts with `Une fiche au même nom`. A criterion copied
# by hand always drifts away from the table it imitates.
DETAILS_REFUS_AGENT = frozenset(
    detail for etat, detail in SUITE_DU_REFUS.values()
    if etat == ETAT_RAPPEL_HUMAIN)


def refus_de_l_agent(detail):
    """Does this 🙋 come from a 🚫 (automatic call set aside), and not from a call?
    """
    return (detail or "") in DETAILS_REFUS_AGENT


def chiffres_significatifs(numero):
    """The 9 digits that identify a French number, whatever its spelling (`06 39
    98 00 56` and `+33 6 39 98 00 56` both return `639980056`). Returns "" when
    the text is not a plausible number.
    """
    chiffres = re.sub(r"\D", "", numero or "")
    return chiffres[-9:] if len(chiffres) >= 9 else ""


def cle_nom(nom):
    """The comparison key of a name: case-insensitive, accent-insensitive, spaces
    tightened (`Mme Nadia Lefèvre` and `mme nadia lefevre` match).

    Used by the 🚫 SAFETY NET: a record marked `Ne plus appeler` must be
    recognised even when its number has changed since the campaign.
    """
    decompose = unicodedata.normalize("NFD", (nom or "").casefold())
    sans_accents = "".join(c for c in decompose if not unicodedata.combining(c))
    return " ".join(sans_accents.split())


def heure_locale(horodatage):
    """`2026-07-29 12:15:31` (UTC, written by sqlite) → local ISO to the minute.

    The `cree_le` columns carry the value of `datetime('now')`, which is in
    UNIVERSAL time; every other date in the application is in local time.
    Displaying the raw value would give a wrong call time (that of another
    timezone): this conversion restores the time actually lived. Returns ""
    when the timestamp is absent or unreadable — never an invented time.
    """
    if not horodatage:
        return ""
    try:
        moment = datetime.datetime.fromisoformat(str(horodatage))
    except (TypeError, ValueError):
        return str(horodatage)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    return moment.astimezone().replace(tzinfo=None).isoformat(timespec="minutes")


def masquer_telephone(numero):
    """`+33 6 39 98 50 42` becomes `+33 6 •• •• •• 42`.

    Only the dialling code (the first two groups) and the last group stay
    readable. A number with no spaces is masked digit by digit, except the last
    two.
    """
    if not numero:
        return ""
    groupes = numero.split(" ")
    if len(groupes) >= 4:
        return " ".join(groupes[:2] + ["••"] * (len(groupes) - 3) + [groupes[-1]])
    return "•" * max(len(numero) - 2, 0) + numero[-2:]


def references_essai(numeros):
    """The set of significant digits of the declared test numbers.

    `numeros` accepts BOTH forms, and that is intended: a single number (text,
    or "" / None when nothing is declared) — the original form, from when the
    operator could declare ONLY their own phone — or a list of numbers, since
    they can declare several testers (themselves, a colleague, a friend). An
    unreadable number is simply ignored: it exempts nobody.
    """
    if numeros is None:
        candidats = ()
    elif isinstance(numeros, str):
        candidats = (numeros,)
    else:
        candidats = tuple(numeros)
    return {chiffres for chiffres in
            (chiffres_significatifs(numero or "") for numero in candidats)
            if chiffres}


def est_numero_essai(telephone, numero_essai):
    """Is this number ONE of the test numbers declared in ⚙ Réglages?

    The comparison is on the nine significant digits, never on the text: `06 39
    98 00 51` and `+33 6 39 98 00 51` are the same number. No number declared
    (empty string, empty list): the answer is always FALSE — the strict rule
    then applies to everybody, without exception.

    `numero_essai` is either ONE number, or the LIST of the declared testers'
    numbers (see references_essai): in both cases only the numbers actually
    declared are recognised, and they alone.

    Why not a comparison of masked numbers: masking is deliberately
    destructive, and two different numbers can mask the same way (06 39 98 00
    51 and 06 39 98 12 51 both give `06 39 •• •• 51`). Confusing them would
    mark a REAL person as test data: exactly what must never be done.
    """
    references = references_essai(numero_essai)
    if not references:
        return False
    chiffres = chiffres_significatifs(telephone or "")
    return bool(chiffres) and chiffres in references


def _sous_verrou(methode):
    """Wraps a Base method: ONE SINGLE thread at a time in the database.

    The lock is taken on entering the method and released on leaving it. It therefore covers all three moments, and not only the first:
    1. sending the query;
    2. READING its rows — a sqlite3 cursor is read lazily, the rows come out only as the loop advances;
    3. the commit.
    That is exactly where the failure occurred: one thread's commit reset the query the other thread was reading, which gave `bad parameter or other API misuse` or `cannot commit - no transaction is active`, and paused the campaign for no visible reason.

    What the lock NEVER surrounds: waiting for a phone call. A call happens in
    planificateur.py / calle_client.py, outside this class; no Base method
    waits for the phone. A campaign spending thirty seconds on the line
    therefore does not freeze the interface.
    """
    @functools.wraps(methode)
    def enveloppe(self, *arguments, **nommes):
        with self.verrou:
            return methode(self, *arguments, **nommes)
    return enveloppe


def _serialiser_les_acces(classe):
    """Puts the lock on ALL the class's methods, in one go.

    Written by hand, it would be `with self.verrou:` copied into eighty methods
    — one chance to forget with every new method. Here the wrapper is put in
    place once and for all: a method added tomorrow is protected without anyone
    having to think about it.

    Two deliberate exceptions: __init__ (it CREATES the lock) and the functions
    declared @staticmethod, which have no `self` and therefore never touch the
    connection (they are formatters of rows already read).
    """
    for nom, valeur in list(vars(classe).items()):
        if nom == "__init__" or not inspect.isfunction(valeur):
            continue
        setattr(classe, nom, _sous_verrou(valeur))
    return classe


@_serialiser_les_acces
class Base:
    """A small access layer over the sqlite3 database.

    ONE single connection, shared by every thread (the background thread
    running a campaign and the threads answering the web pages), and a lock
    that makes them pass one at a time — see _sous_verrou above. Why a shared
    connection rather than one per thread: the tests' database is `:memory:`,
    and an in-memory database exists ONLY within its connection — one
    connection per thread would give each thread a different, empty database,
    without the slightest error message.
    """

    def __init__(self, chemin=":memory:"):
        if chemin != ":memory:":
            # Database on disk: the directory (e.g. donnees/) is created as
            # needed.
            dossier = os.path.dirname(os.path.abspath(chemin))
            os.makedirs(dossier, exist_ok=True)
        # The lock first: every other method takes it on entering. Re-entrant,
        # because a Base method often calls another — the same thread must be
        # able to pass the door again.
        self.verrou = threading.RLock()
        # The TEST numbers declared by the operator (⚙ Réglages): one per
        # TESTER (themselves, a colleague, a friend playing a role). An empty
        # list = nobody is declared. They change NOTHING about what is stored
        # or what is dialled: they serve only to put the `numero_essai` flag on
        # the rows returned to the screen, so they can be marked 🧪. Set by
        # serveur.Application at start-up and whenever the settings are saved;
        # empty everywhere else (tests, bench) — so no row is marked as long as
        # nothing is declared.
        self.numeros_essai = []
        # The FIRST of those numbers, kept under its old name: from when only
        # one number could be declared, it was THE test number. Everything that
        # read it goes on working.
        self.numero_essai = ""
        # check_same_thread=False: the web server answers from another thread.
        self.conn = sqlite3.connect(chemin, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        # A net for the case where ANOTHER program opens the same file (the
        # bench, a backup copy…): instead of giving up straight away on
        # `database is locked`, sqlite waits up to 5 s.
        self.conn.execute("PRAGMA busy_timeout = 5000")
        # ⚠ WHY THESE TWO SETTINGS: IMPORTING A CALENDAR TOOK A MINUTE
        # (observed by the owner on 17/08/2026, `extremely long`).  MEASURED,
        # on a copy of his database, a calendar of 471 appointments: by default
        # ................ 4.36 s WAL alone ................. 1.31 s WAL +
        # synchronous NORMAL .. 0.78 s   (5.6 times faster)  THE CAUSE: an
        # import writes appointment by appointment, so it commits 937 times. By
        # default, every commit forces a physical write to disk (fsync) — 2.6
        # of the 4.4 seconds went there. In WAL mode the writes go into a
        # journal appended at the end of the file, and `synchronous = NORMAL`
        # no longer demands the fsync every time.  WHAT IS KEPT: the database
        # stays consistent, a transaction stays all-or-nothing, and two
        # programs can read it while a third writes (it is even safer than
        # before on that point). WHAT IS ACCEPTED: a BRUTAL power cut could
        # lose the very last transactions — not corrupt the database. For a
        # local tool running on a practice's workstation, that is the right
        # trade; the opposite meant waiting a minute for every imported
        # calendar.  A side effect worth knowing: SQLite creates two
        # neighbouring files, `ringback.db-wal` and `ringback.db-shm`. They are
        # excluded from the copy to be published, like the database itself.
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA synchronous = NORMAL")
        self.conn.executescript(SCHEMA)
        self._migrer()
        self.conn.commit()

    def _migrer(self):
        """Adds the recent columns to a database created before they existed.

        A gentle, lossless migration: only ALTER TABLE ADD COLUMN, never a
        deletion nor a rewrite of data.
        """
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(clients)")}
        if "ne_plus_appeler" not in colonnes:
            self.conn.execute("ALTER TABLE clients ADD COLUMN "
                              "ne_plus_appeler INTEGER NOT NULL DEFAULT 0")
            journal.info("Migration : colonne clients.ne_plus_appeler ajoutée")
        if "jeu_essai" not in colonnes:
            self.conn.execute("ALTER TABLE clients ADD COLUMN "
                              "jeu_essai INTEGER NOT NULL DEFAULT 0")
            journal.info("Migration : colonne clients.jeu_essai ajoutée")
        if "plus_de_proposition" not in colonnes:
            # Additive, and the default value is the PREVIOUS behaviour:
            # everybody receives freed-slot offers. An existing database
            # therefore does not change conduct.
            self.conn.execute("ALTER TABLE clients ADD COLUMN "
                              "plus_de_proposition INTEGER NOT NULL DEFAULT 0")
            journal.info("Migration : colonne clients.plus_de_proposition "
                         "ajoutée (0 = reçoit les propositions, comme avant)")
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(rendezvous)")}
        if "rappel_souhaite" not in colonnes:
            self.conn.execute("ALTER TABLE rendezvous ADD COLUMN "
                              "rappel_souhaite TEXT")
            journal.info("Migration : colonne rendezvous.rappel_souhaite ajoutée")
        if "duree_tranches" not in colonnes:
            # Additive: the appointments already in the database are worth ONE
            # slot (the average length of an appointment) — no data is
            # rewritten.
            self.conn.execute("ALTER TABLE rendezvous ADD COLUMN "
                              "duree_tranches INTEGER NOT NULL DEFAULT 1")
            journal.info("Migration : colonne rendezvous.duree_tranches "
                         "ajoutée (les rendez-vous existants valent "
                         "une tranche)")
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(campagnes)")}
        for colonne in ("nature", "configuration", "raison_pause"):
            if colonne not in colonnes:
                self.conn.execute(f"ALTER TABLE campagnes ADD COLUMN "
                                  f"{colonne} TEXT")
                journal.info("Migration : colonne campagnes.%s ajoutée", colonne)
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(contacts_campagne)")}
        for colonne in ("champs", "detail", "traite_le"):
            if colonne not in colonnes:
                self.conn.execute(f"ALTER TABLE contacts_campagne ADD COLUMN "
                                  f"{colonne} TEXT")
                journal.info("Migration : colonne contacts_campagne.%s ajoutée",
                             colonne)
        if "client_id" not in colonnes:
            # Additive: the contacts already in the database have NO link
            # (NULL); they go on being dialled on their period copy, but the
            # safety net (the number OR the name of a 🚫 client) covers them.
            self.conn.execute("ALTER TABLE contacts_campagne ADD COLUMN "
                              "client_id INTEGER")
            journal.info("Migration : colonne contacts_campagne.client_id "
                         "ajoutée (lien vers la fiche client)")
        # The CALL-E id of the call that WENT OUT and whose result is awaited.
        # Additive: the contacts already in the database have none (NULL) — no
        # old call is reinvented, nothing is rewritten.
        if "appel_externe_id" not in colonnes:
            self.conn.execute("ALTER TABLE contacts_campagne ADD COLUMN "
                              "appel_externe_id TEXT")
            journal.info("Migration : colonne contacts_campagne."
                         "appel_externe_id ajoutée (l'appel parti dont le "
                         "résultat reste à récupérer)")
        if "appel_externe_tentative" not in colonnes:
            self.conn.execute("ALTER TABLE contacts_campagne ADD COLUMN "
                              "appel_externe_tentative INTEGER")
            journal.info("Migration : colonne contacts_campagne."
                         "appel_externe_tentative ajoutée")
        for table in ("appels", "appels_cascade"):
            colonnes = {ligne["name"] for ligne in
                        self.conn.execute(f"PRAGMA table_info({table})")}
            if "note" not in colonnes:
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN note TEXT")
                journal.info("Migration : colonne %s.note ajoutée", table)
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(appels)")}
        if "appel_externe_id" not in colonnes:
            self.conn.execute("ALTER TABLE appels ADD COLUMN "
                              "appel_externe_id TEXT")
            journal.info("Migration : colonne appels.appel_externe_id ajoutée "
                         "(l'identifiant de l'appel chez CALL-E)")
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(appels_cascade)")}
        if "rendezvous_libere" not in colonnes:
            # Additive: the cascades already played released no old appointment
            # (NULL) — nothing is rewritten, nothing is guessed.
            self.conn.execute("ALTER TABLE appels_cascade ADD COLUMN "
                              "rendezvous_libere INTEGER")
            journal.info("Migration : colonne appels_cascade.rendezvous_libere "
                         "ajoutée (l'ancien rendez-vous rendu par cet appel)")

    def fermer(self):
        self.conn.close()

    # -------------------------------------------------------- test number
    def definir_numero_essai(self, numero):
        """Declares (or clears, with "") ONE SINGLE TEST number.

        The original path, kept as it stands: it declares a single tester. To
        declare several, see definir_numeros_essai.
        """
        self.definir_numeros_essai([numero] if numero else [])

    def definir_numeros_essai(self, numeros):
        """Declares (or clears, with []) the TESTERS' TEST numbers.

        No database write: it is a display setting, kept for the session and
        read back from the settings file at start-up.
        """
        self.numeros_essai = [numero for numero in (numeros or []) if numero]
        self.numero_essai = self.numeros_essai[0] if self.numeros_essai else ""

    def _est_essai(self, telephone):
        """True when this number is a declared tester's (real-conditions test).
        """
        return est_numero_essai(telephone, self.numeros_essai)

    # ------------------------------------------------------------------ clients
    def ajouter_client(self, nom, telephone, jeu_essai=False):
        """Creates a client; jeu_essai=True marks them as TEST data.

        The flag changes nothing about how things work: it serves only to say
        `this is a sample data set` on screen and to be able to REMOVE it in
        one go without touching real data (supprimer_jeu_essai).
        """
        curseur = self.conn.execute(
            "INSERT INTO clients (nom, telephone, jeu_essai) VALUES (?, ?, ?)",
            (nom, telephone, 1 if jeu_essai else 0))
        self.conn.commit()
        journal.info("Client ajouté : %s (%s)%s", nom, masquer_telephone(telephone),
                     " [jeu d'essai]" if jeu_essai else "")
        return curseur.lastrowid

    def compter_clients(self):
        return self.conn.execute("SELECT COUNT(*) FROM clients").fetchone()[0]

    def compter_clients_jeu_essai(self):
        """How many clients come from the sample data set (0 = none loaded)."""
        return self.conn.execute(
            "SELECT COUNT(*) FROM clients WHERE jeu_essai = 1").fetchone()[0]

    def supprimer_jeu_essai(self):
        """Removes ONLY the test data; returns (clients, appointments).

        The mirror of loading: only the clients marked jeu_essai = 1 (and their
        appointments, and those appointments' calls) go. The user's clients are
        NEVER touched, and campaigns already played stay in the database —
        their results are history, not test data attached to a client. As with
        deleting a client, those records' still-SCHEDULED follow-ups are
        cancelled: removing the sample data set never leaves an armed call
        behind it.
        """
        self.desarmer_jeu_essai()
        self.conn.execute(
            "DELETE FROM appels WHERE rendezvous_id IN "
            "(SELECT r.id FROM rendezvous r JOIN clients c ON c.id = r.client_id "
            " WHERE c.jeu_essai = 1)")
        curseur = self.conn.execute(
            "DELETE FROM rendezvous WHERE client_id IN "
            "(SELECT id FROM clients WHERE jeu_essai = 1)")
        rendezvous = curseur.rowcount
        curseur = self.conn.execute("DELETE FROM clients WHERE jeu_essai = 1")
        clients = curseur.rowcount
        self.conn.commit()
        journal.info("Jeu d'essai retiré : %d client(s), %d rendez-vous",
                     clients, rendezvous)
        return clients, rendezvous

    def desarmer_jeu_essai(self):
        """Cancels the still-armed follow-ups of ALL the test records.

        Returns the number of follow-ups cancelled. Called just before the
        sample data set is removed (and by it): removing test data must never
        leave a scheduled call behind.
        """
        annulees = 0
        for ligne in self.conn.execute(
                "SELECT id FROM clients WHERE jeu_essai = 1").fetchall():
            annulees += self.desarmer_contacts_du_client(ligne["id"])
        return annulees

    def obtenir_ou_creer_client(self, nom, telephone):
        """Reuses the client when the (name, phone) pair already exists.

        Avoids duplicates when the same CSV file is imported twice.
        """
        ligne = self.conn.execute(
            "SELECT id FROM clients WHERE nom = ? AND telephone = ?",
            (nom, telephone)).fetchone()
        if ligne:
            return ligne["id"]
        return self.ajouter_client(nom, telephone)

    def telephone_de(self, client_id):
        """Number IN CLEAR — reserved for placing a call, never for display."""
        ligne = self.conn.execute(
            "SELECT telephone FROM clients WHERE id = ?", (client_id,)).fetchone()
        return ligne["telephone"] if ligne else None

    def client_equivalent(self, nom, telephone):
        """The client of THIS name carrying the SAME number, whatever its spelling
        (`06 39 98 00 56` and `+33 6 39 98 00 56`), otherwise None.

        Used by the calendar import: tools write the number sometimes in
        national form, sometimes in international form (a `tel:` URI); without
        this equivalence, the same patient would make two records.
        """
        cible = chiffres_significatifs(telephone)
        if not cible:
            return None
        for ligne in self.conn.execute(
                "SELECT id, telephone FROM clients WHERE nom = ? ORDER BY id",
                (nom,)):
            if chiffres_significatifs(ligne["telephone"]) == cible:
                return ligne["id"]
        return None

    def client_sans_numero_par_nom(self, nom):
        """The id of the client of THIS name still WITHOUT a number, otherwise
        None.

        Used by the calendar import: when the ICS finally carries the phone of
        a client imported `to be completed`, we complete their record instead
        of creating a second one.
        """
        ligne = self.conn.execute(
            "SELECT id FROM clients WHERE nom = ? AND telephone = '' "
            "ORDER BY id LIMIT 1", (nom,)).fetchone()
        return ligne["id"] if ligne else None

    def telephone_par_nom(self, nom):
        """The number IN CLEAR of the client bearing THIS name (when they have
        one), otherwise None.

        Reserved for composing a call list EXPLICITLY requested (matching an
        ICS calendar against known clients) — never for display, which stays
        masked.
        """
        ligne = self.conn.execute(
            "SELECT telephone FROM clients WHERE nom = ? AND telephone != '' "
            "ORDER BY id LIMIT 1", (nom,)).fetchone()
        return ligne["telephone"] if ligne else None

    def mettre_a_jour_telephone(self, client_id, telephone):
        """Completes (or corrects) a client's number — an ICS import with no
        number.
        """
        self.conn.execute(
            "UPDATE clients SET telephone = ? WHERE id = ?", (telephone, client_id))
        self.conn.commit()
        journal.info("Numéro complété pour le client n°%d : %s",
                     client_id, masquer_telephone(telephone))

    def lister_clients(self):
        """Every client (numbers masked), with their number of appointments."""
        lignes = self.conn.execute(
            "SELECT c.id, c.nom, c.telephone, c.ne_plus_appeler, c.jeu_essai, "
            "c.plus_de_proposition, "
            "COUNT(r.id) AS nb_rendezvous "
            "FROM clients c LEFT JOIN rendezvous r ON r.client_id = c.id "
            "GROUP BY c.id ORDER BY c.nom COLLATE NOCASE").fetchall()
        return [{"id": ligne["id"], "nom": ligne["nom"],
                 "telephone_masque": masquer_telephone(ligne["telephone"]),
                 "numero_essai": self._est_essai(ligne["telephone"]),
                 "ne_plus_appeler": bool(ligne["ne_plus_appeler"]),
                 # ⚠ THE GENTLER FLAG travels with the record: the screen must
                 # be able to tell it from the 🚫, and the two are read
                 # together.
                 "plus_de_proposition": bool(ligne["plus_de_proposition"]),
                 "jeu_essai": bool(ligne["jeu_essai"]),
                 "nb_rendezvous": ligne["nb_rendezvous"]} for ligne in lignes]

    def obtenir_client(self, client_id):
        """A client's record (number masked), or None."""
        ligne = self.conn.execute(
            "SELECT c.id, c.nom, c.telephone, c.ne_plus_appeler, c.jeu_essai, "
            "c.plus_de_proposition, "
            "(SELECT COUNT(*) FROM rendezvous r WHERE r.client_id = c.id) "
            "AS nb_rendezvous FROM clients c WHERE c.id = ?",
            (client_id,)).fetchone()
        if ligne is None:
            return None
        return {"id": ligne["id"], "nom": ligne["nom"],
                "telephone_masque": masquer_telephone(ligne["telephone"]),
                "numero_essai": self._est_essai(ligne["telephone"]),
                "ne_plus_appeler": bool(ligne["ne_plus_appeler"]),
                # ⚠ THE GENTLER FLAG travels with the record: the screen must
                # be able to tell it from the 🚫, and the two are read together.
                "plus_de_proposition": bool(ligne["plus_de_proposition"]),
                "jeu_essai": bool(ligne["jeu_essai"]),
                "nb_rendezvous": ligne["nb_rendezvous"]}

    def plus_de_proposition(self, client_id):
        """Does this client refuse to be OFFERED freed slots?

        ⚠ TOLERANT ON INPUT: a contact with no record (None) receives the
        offers — we do not guess a refusal we have not heard.
        """
        if not client_id:
            return False
        ligne = self.conn.execute(
            "SELECT plus_de_proposition FROM clients WHERE id = ?",
            (client_id,)).fetchone()
        return bool(ligne and ligne["plus_de_proposition"])

    def definir_plus_de_proposition(self, client_id, valeur):
        """Sets or lifts the refusal of slot offers (reversible).

        ⚠ THIS IS NOT THE 🚫: see the column's comment. This flag prevents NO
        call about the person's own appointments.
        """
        self.conn.execute(
            "UPDATE clients SET plus_de_proposition = ? WHERE id = ?",
            (1 if valeur else 0, client_id))
        self.conn.commit()

    def definir_ne_plus_appeler(self, client_id, valeur):
        """Sets or lifts the `Ne plus appeler` flag (reversible)."""
        self.conn.execute("UPDATE clients SET ne_plus_appeler = ? WHERE id = ?",
                          (1 if valeur else 0, client_id))
        self.conn.commit()
        journal.info("Client n°%d : « Ne plus appeler » %s",
                     client_id, "posé" if valeur else "levé")

    def telephone_exclu(self, telephone):
        """True when THIS number belongs to a client marked `Ne plus appeler`.

        Used by the cascade: even a list pasted by hand must never cause
        someone to be called who has asked not to be. The comparison is on the
        significant DIGITS, not on the text: `06 39 98 00 56` and `+33 6 39 98
        00 56` are the same number, and a calendar that writes the
        international form must not blow past the guard.
        """
        cible = chiffres_significatifs(telephone)
        if not cible:
            return False
        for ligne in self.conn.execute(
                "SELECT telephone FROM clients WHERE ne_plus_appeler = 1"):
            if chiffres_significatifs(ligne["telephone"]) == cible:
                return True
        return False

    def telephone_sans_proposition(self, telephone):
        """True when THIS number refuses freed-slot offers.

        The counterpart of `telephone_exclu` for the gentler flag: the same
        comparison on the significant DIGITS, so that a list pasted by hand
        honours it too — `06 39 98 00 56` and `+33 6 39 98 00 56` are the same
        number.
        """
        cible = chiffres_significatifs(telephone)
        if not cible:
            return False
        for ligne in self.conn.execute(
                "SELECT telephone FROM clients WHERE plus_de_proposition = 1"):
            if chiffres_significatifs(ligne["telephone"]) == cible:
                return True
        return False

    def nom_exclu(self, nom):
        """True when THIS name is that of a client marked `Ne plus appeler`.

        The second strand of the SAFETY NET: a number corrected after the fact
        no longer recognises the person by their number — the name still does.
        The comparison ignores case and accents (cle_nom). A consequence
        accepted by the owner: an unrelated namesake may be set aside wrongly —
        better one call fewer than a call to somebody who asked us to stop.
        """
        cible = cle_nom(nom)
        if not cible:
            return False
        for ligne in self.conn.execute(
                "SELECT nom FROM clients WHERE ne_plus_appeler = 1"):
            if cle_nom(ligne["nom"]) == cible:
                return True
        return False

    def client_connu(self, nom, telephone):
        """The id of the client ALREADY on file for this contact, or None.

        The SAME recognition as client_pour_contact, minus its last step: here,
        nothing is created. That is what makes it possible to tell `we know who
        we are talking about` from `it is a pasted row we are discovering` —
        the exact difference the owner's rule requires before touching
        somebody's appointment.
        """
        if telephone:
            ligne = self.conn.execute(
                "SELECT id FROM clients WHERE nom = ? AND telephone = ? "
                "ORDER BY id LIMIT 1", (nom, telephone)).fetchone()
            if ligne:
                return ligne["id"]
            equivalent = self.client_equivalent(nom, telephone)
            if equivalent is not None:
                return equivalent
        return self.client_sans_numero_par_nom(nom)

    def rendezvous_a_venir_du_client(self, client_id, maintenant=None):
        """THIS client's appointments still ahead of us that HOLD.

        The same statuses as `Rendez-vous à venir` (STATUTS_A_VENIR): a
        cancelled, a moved, a deleted one are not among them — they no longer
        hold. Returned from nearest to furthest.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        lignes = self.conn.execute(
            self._REQUETE_RDV + " WHERE r.client_id = ? AND r.horaire >= ? "
            "AND r.statut IN ("
            + ",".join("?" * len(self.STATUTS_A_VENIR)) + ") "
            "ORDER BY r.horaire",
            (client_id, maintenant) + self.STATUTS_A_VENIR).fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def client_pour_contact(self, nom, telephone, rendezvous_id=None):
        """THE client record of a campaign contact — created when missing.

        A campaign no longer copies a number `for ever`: it carries a LINK to the record, and it is the record's CURRENT number that is dialled. A merely pasted contact has no record: it receives one HERE, on entering the campaign, so the link always exists. Recognition order:
        1. the appointment taken from the database designates its client;
        2. the (exact name, exact number) pair;
        3. the same name with the SAME number written differently (`06 39 98 00 56` / `+33 6 39 98 00 56`);
        4. the same name still with no number (a calendar import to be completed);
        5. otherwise a record is created.
        Returns the client's id (never None).
        """
        if rendezvous_id:
            ligne = self.conn.execute(
                "SELECT client_id FROM rendezvous WHERE id = ?",
                (rendezvous_id,)).fetchone()
            if ligne:
                return ligne["client_id"]
        if telephone:
            ligne = self.conn.execute(
                "SELECT id FROM clients WHERE nom = ? AND telephone = ? "
                "ORDER BY id LIMIT 1", (nom, telephone)).fetchone()
            if ligne:
                return ligne["id"]
            equivalent = self.client_equivalent(nom, telephone)
            if equivalent is not None:
                return equivalent
            sans_numero = self.client_sans_numero_par_nom(nom)
            if sans_numero is not None:
                self.mettre_a_jour_telephone(sans_numero, telephone)
                return sans_numero
        else:
            sans_numero = self.client_sans_numero_par_nom(nom)
            if sans_numero is not None:
                return sans_numero
        return self.ajouter_client(nom, telephone or "")

    def rendezvous_du_client(self, client_id):
        """The ids of a client's appointments (for purging the queue)."""
        return [ligne["id"] for ligne in self.conn.execute(
            "SELECT id FROM rendezvous WHERE client_id = ?", (client_id,))]

    def completer_telephone(self, client_id, telephone):
        """Writes this number on the record IF it has none; returns True when
        written.

        ⚠ ONLY AN EMPTY RECORD, AND THAT IS THE WHOLE DIFFERENCE FROM
        `modifier_client`. Completing what is missing is the gesture the screen
        asks for (`their number is to be completed in the step-3 grid`);
        OVERWRITING a number already on file would be modifying their client
        data without asking them — a campaign has no business doing that.

        WHAT THIS FIXES, measured in his database on 18/08/2026: he completes a
        person's number in the grid, the campaign saves it… on the CAMPAIGN.
        Yet it is the RECORD's number that is dialled (see
        `client_pour_contact`): the record stayed empty, and the contact went
        out `exclu — no number to dial`. The gesture the screen asked of him
        did not go all the way.
        """
        # ⚠ `obtenir_client` RETURNS A MASKED VIEW (`telephone_masque`): the
        # number in clear comes out only through `telephone_de`, and that is
        # the product's rule. My first version read `client["telephone"]` and
        # crashed the server on every grid validation — 180 tests down at once,
        # which is the right way to learn it.
        if self.obtenir_client(client_id) is None:
            return False
        if (self.telephone_de(client_id) or "").strip():
            return False
        if not (telephone or "").strip():
            return False
        self.conn.execute("UPDATE clients SET telephone = ? WHERE id = ?",
                          (telephone, client_id))
        self.conn.commit()
        journal.info("Fiche client n°%d complétée : numéro saisi dans une "
                     "grille de campagne", client_id)
        return True

    def modifier_client(self, client_id, nom=None, telephone=None):
        """Corrects a client's record (name, number); returns True when it exists.

        The number arrives ALREADY validated by saisie.valider_telephone; it is
        stored in clear like everywhere else and comes back out only masked. No
        deletion, no side effect: it is a record correction, not an action on
        the appointments.
        """
        if self.obtenir_client(client_id) is None:
            return False
        if nom is not None:
            self.conn.execute("UPDATE clients SET nom = ? WHERE id = ?",
                              (nom, client_id))
        if telephone is not None:
            self.conn.execute("UPDATE clients SET telephone = ? WHERE id = ?",
                              (telephone, client_id))
        self.conn.commit()
        journal.info("Fiche du client n°%d corrigée%s", client_id,
                     " (numéro compris)" if telephone is not None else "")
        return True

    def etat_rendezvous_par_client(self, maintenant=None):
        """{client_id: a summary of their calendar} — a single pass over the
        database.

        The summary carries the count of appointments BY STATUS, the next
        upcoming appointment, the last past one, and whether a call-back
        preference was noted. A long appointment (several consecutive slots) is
        still ONE appointment: it is one row of the table, never N.

        `Next` keeps only appointments that HOLD (the STATUTS_A_VENIR):
        announcing `next: 6 August` for a cancelled appointment would be a
        false display, and the client's record would wrongly conclude they have
        an appointment scheduled. The count by status, for its part, keeps
        EVERYTHING — nothing is lost.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        resume = {}
        for ligne in self.conn.execute(
                "SELECT client_id, id, horaire, motif, statut, rappel_souhaite, "
                "duree_tranches FROM rendezvous ORDER BY horaire"):
            fiche = resume.setdefault(ligne["client_id"], {
                "total": 0, "statuts": {}, "prochain": None, "dernier": None,
                "rappel_souhaite": None})
            fiche["total"] += 1
            fiche["statuts"][ligne["statut"]] = (
                fiche["statuts"].get(ligne["statut"], 0) + 1)
            entree = {"id": ligne["id"], "horaire": ligne["horaire"],
                      "motif": ligne["motif"], "statut": ligne["statut"],
                      "duree_tranches": max(ligne["duree_tranches"] or 1, 1)}
            if ligne["horaire"] >= maintenant:
                if (fiche["prochain"] is None
                        and ligne["statut"] in self.STATUTS_A_VENIR):
                    fiche["prochain"] = entree
            else:
                fiche["dernier"] = entree
            if ligne["rappel_souhaite"] and not fiche["rappel_souhaite"]:
                fiche["rappel_souhaite"] = ligne["rappel_souhaite"]
        return resume

    def contacts_campagne_par_client(self):
        """{client_id: [campaign contacts]} — the matching is done HERE.

        A campaign contact designates a client by their appointment, by the
        digits of their number (`06 39 98 00 56` and `+33 6 39 98 00 56` are
        the same number) or, failing that, by their exact name. No number in
        clear leaves this method: the matching is done here, and the returned
        records carry none.
        """
        clients = self.conn.execute(
            "SELECT id, nom, telephone FROM clients").fetchall()
        par_chiffres, par_nom = {}, {}
        par_id = {ligne["id"] for ligne in clients}
        for ligne in clients:
            cible = chiffres_significatifs(ligne["telephone"])
            if cible:
                par_chiffres.setdefault(cible, ligne["id"])
            par_nom.setdefault(ligne["nom"], ligne["id"])
        par_rendezvous = {ligne["id"]: ligne["client_id"] for ligne in
                          self.conn.execute("SELECT id, client_id FROM rendezvous")}
        resultat = {}
        for ligne in self.conn.execute("""
                SELECT c.id, c.campagne_id, c.rang, c.nom, c.telephone,
                       c.rendezvous_id, c.etat, c.issue, c.detail, c.client_id,
                       k.nom AS campagne_nom, k.nature, k.theme,
                       k.statut AS campagne_statut, k.creneau AS campagne_creneau,
                  (SELECT COUNT(*) FROM appels_campagne a
                   WHERE a.contact_id = c.id) AS tentatives,
                  (SELECT COUNT(*) FROM relances r
                   WHERE r.contact_id = c.id AND r.statut = 'planifiée')
                   AS relances_planifiees
                FROM contacts_campagne c
                JOIN campagnes k ON k.id = c.campagne_id
                ORDER BY c.id"""):
            # The LINK to the record beats any deduction: it is what says who
            # this is, even when the number has changed since.
            client_id = ligne["client_id"]
            if client_id is None:
                client_id = par_rendezvous.get(ligne["rendezvous_id"])
            if client_id is None:
                client_id = par_chiffres.get(
                    chiffres_significatifs(ligne["telephone"]))
            if client_id is None:
                client_id = par_nom.get(ligne["nom"])
            if client_id is None or client_id not in par_id:
                continue
            contact = {cle: ligne[cle] for cle in (
                "id", "campagne_id", "rang", "nom", "rendezvous_id", "etat",
                "issue", "detail", "client_id", "campagne_nom", "nature", "theme",
                "campagne_statut", "campagne_creneau", "tentatives",
                "relances_planifiees")}
            resultat.setdefault(client_id, []).append(contact)
        return resultat

    def dernier_appel_direct_par_client(self):
        """{client_id: last DIRECT call finished} (queue, single call-back).

        Campaigns have their own trace; this one covers calls attached to an
        appointment. The structured result is decoded, the transcript is not
        brought up (it lives on the record).
        """
        dernier = {}
        for ligne in self.conn.execute("""
                SELECT a.id, a.statut, a.resultat, r.client_id
                FROM appels a JOIN rendezvous r ON r.id = a.rendezvous_id
                ORDER BY a.id"""):
            resultat = None
            if ligne["resultat"]:
                try:
                    resultat = json.loads(ligne["resultat"])
                except (TypeError, ValueError):
                    resultat = None
            dernier[ligne["client_id"]] = {
                "appel_id": ligne["id"], "statut": ligne["statut"],
                "issue": (resultat or {}).get("appointment_status"),
                "resultat": resultat}
        return dernier

    def rendezvous_de_periode(self, debut, fin, statuts=None):
        """The appointments in a time window, client included (number masked).

        statuts: the list of statuses kept (ALL by default). This is the
        SCHEDULE's source: an appointment is one row there, with its length in
        slots — never one row per slot.
        """
        # ⚠ THE TWO BOUNDS ARE INDEPENDENT (09/08/2026). Requiring them
        # together meant a `from the slot, no limit` window ALSO lost its start
        # bound: the rule then took back people whose appointment is BEFORE the
        # slot, for whom bringing it forward gains nothing. Exactly the defect
        # fixed on 03/08 in `rendezvous_a_recaser` — the same mistake, in
        # another place.
        requete = self._REQUETE_RDV + " WHERE 1 = 1"
        parametres = []
        if debut:
            requete += " AND r.horaire >= ?"
            parametres.append(debut)
        if fin:
            requete += " AND r.horaire < ?"
            parametres.append(fin)
        if statuts:
            requete += (" AND r.statut IN (" + ",".join("?" * len(statuts)) + ")")
            parametres.extend(statuts)
        lignes = self.conn.execute(requete + " ORDER BY r.horaire, r.id",
                                   parametres).fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def contacts_campagne_du_client(self, client_id):
        """The ids of the campaign contacts that designate this client.

        Three ways of recognising them, from the surest to the broadest: the
        LINK to the record, the appointment taken from the database, and the
        DIGITS of the frozen number (contacts from before the `client_id`
        column). The name alone is NOT used here: disarming a namesake's
        follow-up would lose real work.
        """
        fiche = self.conn.execute(
            "SELECT telephone FROM clients WHERE id = ?",
            (client_id,)).fetchone()
        chiffres = chiffres_significatifs(fiche["telephone"]) if fiche else ""
        rendezvous = set(self.rendezvous_du_client(client_id))
        vises = []
        for ligne in self.conn.execute(
                "SELECT id, telephone, client_id, rendezvous_id "
                "FROM contacts_campagne"):
            if (ligne["client_id"] == client_id
                    or (ligne["rendezvous_id"] in rendezvous
                        and ligne["rendezvous_id"] is not None)
                    or (chiffres
                        and chiffres_significatifs(ligne["telephone"]) == chiffres)):
                vises.append(ligne["id"])
        return vises

    def desarmer_contacts_du_client(self, client_id):
        """Disarms whatever could still RING for this client; returns the number
        of follow-ups cancelled.

        The owner's decision: we keep the history, we disarm. The contacts and
        the calls already placed stay readable; only the still-`planifiée`
        follow-ups are cancelled, and each contact receives the LINK to the
        record so that its disappearance can be observed at dialling time
        (cible_appel_contact then refuses the call).
        """
        contacts = self.contacts_campagne_du_client(client_id)
        if not contacts:
            return 0
        marques = ",".join("?" * len(contacts))
        curseur = self.conn.execute(
            f"UPDATE relances SET statut = 'annulée' WHERE statut = 'planifiée' "
            f"AND contact_id IN ({marques})", contacts)
        annulees = curseur.rowcount
        self.conn.execute(
            f"UPDATE contacts_campagne SET client_id = ? "
            f"WHERE id IN ({marques})", [client_id] + contacts)
        self.conn.commit()
        if annulees:
            journal.info("Client n°%d : %d relance(s) planifiée(s) annulée(s) "
                         "— plus aucun appel ne partira pour lui", client_id,
                         annulees)
        return annulees

    def supprimer_client(self, client_id):
        """Deletes the client, THEIR appointments and those appointments' calls;
        returns the number of appointments deleted.

        Their still-scheduled follow-ups are CANCELLED along the way: deleting
        a record must never leave a call armed for them. Their campaign
        contacts and the calls already placed, for their part, stay readable —
        that is history, not client data. A permanent action — the server only
        reaches it after an explicit confirmation page, never in one click.
        """
        self.desarmer_contacts_du_client(client_id)
        curseur = self.conn.execute(
            "DELETE FROM appels WHERE rendezvous_id IN "
            "(SELECT id FROM rendezvous WHERE client_id = ?)", (client_id,))
        curseur = self.conn.execute(
            "DELETE FROM rendezvous WHERE client_id = ?", (client_id,))
        supprimes = curseur.rowcount
        self.conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
        self.conn.commit()
        journal.info("Client n°%d supprimé avec %d rendez-vous (confirmé à l'écran)",
                     client_id, supprimes)
        return supprimes

    # -------------------------------------------------------------- rendez-vous
    def ajouter_rendezvous(self, client_id, horaire, motif, statut="prévu",
                           rappel_souhaite=None, duree_tranches=1):
        """Creates an appointment; duree_tranches = its length in SLOTS.

        1 = the average length of an appointment (the `pas` setting, 15 minutes
        by default); 2 = two consecutive slots (30 minutes), and so on.
        """
        curseur = self.conn.execute(
            "INSERT INTO rendezvous (client_id, horaire, motif, statut, "
            "rappel_souhaite, duree_tranches) VALUES (?, ?, ?, ?, ?, ?)",
            (client_id, horaire, motif, statut, rappel_souhaite,
             max(int(duree_tranches or 1), 1)))
        self.conn.commit()
        return curseur.lastrowid

    def mettre_a_jour_rendezvous(self, rendezvous_id, statut=None, horaire=None,
                                 duree_tranches=None, motif=None):
        if statut is not None:
            self.conn.execute(
                "UPDATE rendezvous SET statut = ? WHERE id = ?", (statut, rendezvous_id))
        if horaire is not None:
            self.conn.execute(
                "UPDATE rendezvous SET horaire = ? WHERE id = ?", (horaire, rendezvous_id))
        if motif is not None:
            self.conn.execute(
                "UPDATE rendezvous SET motif = ? WHERE id = ?", (motif, rendezvous_id))
        if duree_tranches is not None:
            self.conn.execute(
                "UPDATE rendezvous SET duree_tranches = ? WHERE id = ?",
                (max(int(duree_tranches), 1), rendezvous_id))
        self.conn.commit()

    def rendezvous_occupants(self, debut, fin):
        """The appointments that OCCUPY the schedule between these two times.

        Occupy: `prévu` and `confirmé` — a cancelled, moved or ignored
        appointment frees its slot, which is what makes it possible to
        recompute the offerable slots. An appointment starting BEFORE the
        window but spilling into it is returned too (a margin of one day is
        enough: no length exceeds 24 h).
        """
        veille = debut
        try:
            veille = (datetime.datetime.fromisoformat(debut)
                      - datetime.timedelta(days=1)).isoformat(timespec="minutes")
        except (TypeError, ValueError):
            pass
        lignes = self.conn.execute(
            "SELECT id, client_id, horaire, motif, statut, duree_tranches "
            "FROM rendezvous WHERE statut IN ('prévu', 'confirmé') "
            "AND horaire >= ? AND horaire < ? ORDER BY horaire",
            (veille, fin)).fetchall()
        return [{"id": ligne["id"], "client_id": ligne["client_id"],
                 "horaire": ligne["horaire"], "motif": ligne["motif"],
                 "statut": ligne["statut"],
                 "duree_tranches": max(ligne["duree_tranches"] or 1, 1)}
                for ligne in lignes]

    # The statuses that switch to `manqué` when their time has passed. Owner's
    # decision: `If they are dates in the past then we can mark them missed` —
    # a CONFIRMED appointment whose time has passed switches too, just like a
    # `prévu`. Otherwise the confirmed ones vanished: neither in `à venir` (it
    # is past), nor in `à rappeler` (they were not missed). Nobody disappears
    # any more. The price, accepted and written on screen: we will see in the
    # list people who really did turn up, for want of knowing who did —
    # `ignoré` serves exactly to set them aside, reversibly.
    STATUTS_QUI_MANQUENT = ("prévu", "confirmé")

    def marquer_manques_echus(self, maintenant=None):
        """The missed rule: a past `prévu` or `confirmé` → `manqué`.

        Returns the number of appointments modified. The times are all stored
        in ISO 8601 to the minute (`2026-07-27T14:30`): a text comparison is
        enough.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        curseur = self.conn.execute(
            "UPDATE rendezvous SET statut = 'manqué' "
            "WHERE statut IN ('prévu', 'confirmé') AND horaire < ?",
            (maintenant,))
        self.conn.commit()
        if curseur.rowcount:
            journal.info("%d rendez-vous passé(s) marqué(s) manqué(s)", curseur.rowcount)
        return curseur.rowcount

    def ignorer_tous_les_manques(self):
        """`Empty the list`: every missed one becomes `ignoré` (reversible).

        Returns the number of appointments switched. The `ignoré` status is
        restored from `Tous les rendez-vous` (retablir_manque): nothing is
        lost, the `À rappeler` list is simply emptied.
        """
        curseur = self.conn.execute(
            "UPDATE rendezvous SET statut = 'ignoré' WHERE statut = 'manqué'")
        self.conn.commit()
        if curseur.rowcount:
            journal.info("%d rendez-vous manqué(s) passé(s) en « ignoré »",
                         curseur.rowcount)
        return curseur.rowcount

    def retablir_manque(self, rendezvous_id):
        """The opposite of `ignoré`: the appointment becomes `manqué` again.

        Returns True when the appointment really was `ignoré` (otherwise
        nothing moves).
        """
        curseur = self.conn.execute(
            "UPDATE rendezvous SET statut = 'manqué' "
            "WHERE id = ? AND statut = 'ignoré'", (rendezvous_id,))
        self.conn.commit()
        return curseur.rowcount > 0

    _REQUETE_RDV = """
        SELECT r.id, r.horaire, r.motif, r.statut, r.rappel_souhaite,
               r.duree_tranches,
               c.id AS client_id, c.nom, c.telephone, c.ne_plus_appeler
        FROM rendezvous r JOIN clients c ON c.id = r.client_id
    """

    def sorties_du_planning(self, debut, fin):
        """The period's appointments that NO LONGER occupy a slot, and why.

        ⚠ HIS REPORT OF 20/08/2026: `the third one has disappeared, it is no
        longer in the calendar on the appointments page`. She had not
        disappeared: her appointment was CANCELLED — she had asked for it
        during the call. But the grid only shows what OCCUPIES a slot
        (horaires.STATUTS_OCCUPANTS), and the page offered it nowhere else:
        from its slot, the appointment really had evaporated.

        ⚠ AND THE PAGE'S CAPTION ALREADY PROMISED IT — `it therefore does not
        appear here but in the lists below` — when there was NO list below.
        That is what sent him looking for nothing.

        The REASON comes from the change log, its LAST row for that
        appointment: it is what explains the current status. An appointment
        cancelled by hand has none, and we do not invent one for it.

        Returns a list of dicts: the appointment, plus `raison`, `campagne_id`
        and `campagne_nom` when a campaign wrote it.
        """
        lignes = self.conn.execute(
            self._REQUETE_RDV + """
             WHERE r.horaire >= ? AND r.horaire < ?
               AND r.statut NOT IN ('prévu', 'confirmé', 'supprimé')
             ORDER BY r.horaire, r.id""", (debut, fin)).fetchall()
        sorties = []
        for ligne in lignes:
            rdv = self._ligne_rdv(ligne)
            dernier = self.conn.execute(
                "SELECT ch.raison, ch.campagne_id, ca.nom AS campagne_nom "
                "FROM changements ch LEFT JOIN campagnes ca "
                "  ON ca.id = ch.campagne_id "
                "WHERE ch.rendezvous_id = ? ORDER BY ch.id DESC LIMIT 1",
                (rdv["id"],)).fetchone()
            rdv["raison"] = dernier["raison"] if dernier else None
            rdv["campagne_id"] = dernier["campagne_id"] if dernier else None
            rdv["campagne_nom"] = dernier["campagne_nom"] if dernier else None
            sorties.append(rdv)
        return sorties

    def rendezvous_manques(self):
        """Missed appointments, numbers already masked (the raw form does not
        leave here).
        """
        lignes = self.conn.execute(
            self._REQUETE_RDV + " WHERE r.statut = 'manqué' ORDER BY r.horaire").fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def rendezvous_sans_numero(self):
        """Appointments whose client has no number (an ICS import to be
        completed).
        """
        lignes = self.conn.execute(
            self._REQUETE_RDV + " WHERE c.telephone = '' ORDER BY r.horaire").fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def rendezvous_a_venir(self):
        """`prévu` appointments, from nearest to furthest.

        After marquer_manques_echus(), every `prévu` is upcoming. This
        particular list serves to COMPOSE a call list (a campaign resumed on
        the `prévu` filter): it therefore keeps only what is not yet confirmed.
        For DISPLAY, rendezvous_a_venir_tous() is the one needed — a confirmed
        row does not disappear from the screen.
        """
        lignes = self.conn.execute(
            self._REQUETE_RDV + " WHERE r.statut = 'prévu' ORDER BY r.horaire").fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    # The statuses of an `upcoming` appointment: those that still HOLD. They
    # are exactly the statuses that occupy a slot in the schedule
    # (horaires.STATUTS_OCCUPANTS) — the list and the grid therefore say the
    # same thing.
    STATUTS_A_VENIR = ("prévu", "confirmé")

    def rendezvous_a_venir_tous(self, maintenant=None):
        """The appointments still ahead of us that HOLD (scheduled, confirmed).

        Two owner's rules, which complement each other:

        - `it is not a contact that disappears, but a row that evolves`: a CONFIRMED appointment stays visible here, with its badge — it does not vanish because we have just obtained it;
        - correction of 31/07/2026: a CANCELLED appointment, on the other hand, no longer exists. It has no business in `à venir`. Either it was rebooked during the exchange (it is then a MOVE, and it is the new row that shows), or no date was set and the client becomes `le client rappellera`. A MOVED appointment (the old row) and an IGNORED appointment are set aside for the same reason: they no longer hold. Nothing is lost for all that — `Tous les rendez-vous` and the client's record keep them.

        The filter is therefore the TIME **and** the status: the times are all
        stored in ISO 8601 to the minute, a text comparison is enough.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        lignes = self.conn.execute(
            self._REQUETE_RDV + " WHERE r.horaire >= ? AND r.statut IN "
            "(" + ",".join("?" * len(self.STATUTS_A_VENIR)) + ") "
            "ORDER BY r.horaire",
            (maintenant,) + self.STATUTS_A_VENIR).fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def tous_les_rendezvous(self):
        """ALL the appointments, most recent first — no input lost."""
        lignes = self.conn.execute(
            self._REQUETE_RDV + " ORDER BY r.horaire DESC, r.id DESC").fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def rendezvous_identique(self, nom, telephone, horaire):
        """An appointment already in the database for THIS client at THIS exact
        time, or None.

        The add form's duplicate guard: the same input made twice is flagged on
        screen instead of being silently doubled.
        """
        ligne = self.conn.execute(
            self._REQUETE_RDV + " WHERE c.nom = ? AND c.telephone = ? "
            "AND r.horaire = ? ORDER BY r.id",
            (nom, telephone, horaire)).fetchone()
        return self._ligne_rdv(ligne) if ligne else None

    def obtenir_rendezvous(self, rendezvous_id):
        ligne = self.conn.execute(
            self._REQUETE_RDV + " WHERE r.id = ?", (rendezvous_id,)).fetchone()
        return self._ligne_rdv(ligne) if ligne else None

    def _ligne_rdv(self, ligne):
        # An instance method (and not a @staticmethod like _ligne_appel): it
        # needs the declared test number to set the 🧪 flag. The lock is
        # re-entrant, taking it again here costs nothing.
        return {
            "id": ligne["id"],
            "horaire": ligne["horaire"],
            "motif": ligne["motif"],
            "statut": ligne["statut"],
            "rappel_souhaite": ligne["rappel_souhaite"],
            # Length in slots: 1 for every appointment from before the column
            # (additive migration) — never 0, never None.
            "duree_tranches": max(ligne["duree_tranches"] or 1, 1),
            "client_id": ligne["client_id"],
            "nom": ligne["nom"],
            "telephone_masque": masquer_telephone(ligne["telephone"]),
            "numero_essai": self._est_essai(ligne["telephone"]),
            "ne_plus_appeler": bool(ligne["ne_plus_appeler"]),
        }

    # ------------------------------------------------------------------- appels
    def creer_appel(self, rendezvous_id):
        curseur = self.conn.execute(
            "INSERT INTO appels (rendezvous_id, statut) VALUES (?, 'en file')",
            (rendezvous_id,))
        self.conn.commit()
        return curseur.lastrowid

    def changer_statut_appel(self, appel_id, statut):
        self.conn.execute(
            "UPDATE appels SET statut = ? WHERE id = ?", (statut, appel_id))
        self.conn.commit()

    def terminer_appel(self, appel_id, statut, resultat=None, transcription=None,
                       note=None):
        """Closes a call. `note` = what THE PRODUCT decided in the face of the
        result (for instance: the agreed date does not hold, so the appointment
        was not created) — never text invented for the agent.
        """
        self.conn.execute(
            "UPDATE appels SET statut = ?, resultat = ?, transcription = ?, "
            "note = ? WHERE id = ?",
            (statut,
             json.dumps(resultat, ensure_ascii=False) if resultat is not None else None,
             transcription, note, appel_id))
        self.conn.commit()

    def noter_appel(self, appel_id, note):
        """Writes (or replaces) the product's note on this call."""
        self.conn.execute("UPDATE appels SET note = ? WHERE id = ?",
                          (note, appel_id))
        self.conn.commit()

    def obtenir_appel(self, appel_id):
        ligne = self.conn.execute(
            "SELECT * FROM appels WHERE id = ?", (appel_id,)).fetchone()
        return self._ligne_appel(ligne) if ligne else None

    def appels_du_rendezvous(self, rendezvous_id):
        lignes = self.conn.execute(
            "SELECT * FROM appels WHERE rendezvous_id = ? ORDER BY id",
            (rendezvous_id,)).fetchall()
        return [self._ligne_appel(ligne) for ligne in lignes]

    @staticmethod
    def _ligne_appel(ligne):
        appel = dict(ligne)
        appel["resultat"] = json.loads(appel["resultat"]) if appel["resultat"] else None
        return appel

    # ----------------------------------------------------------------- cascades
    STATUTS_A_RECASER = ("annulé", "manqué", "déplacé")

    def rendezvous_a_recaser(self, debut=None, fin=None, maintenant=None):
        """The period's appointments whose client is STILL waiting.

        Cancelled, missed, or moved — and, in all three cases, only when that
        client has NO upcoming appointment. It is the definition of `waiting`
        already used by `candidats_cascade`, but returned here APPOINTMENT BY
        APPOINTMENT: a dated source must give the date and the id of the
        appointment concerned, otherwise the mandatory `existing appointment`
        column would stay empty and the grid would refuse them.

        ⚠ THE `NOT EXISTS` IS THE HEART. Without it, we would call back people
        who have already rebooked in order to offer them another appointment.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        trous = ",".join("?" * len(self.STATUTS_A_RECASER))
        requete = (self._REQUETE_RDV + f" WHERE r.statut IN ({trous})"
                   " AND NOT EXISTS (SELECT 1 FROM rendezvous futur"
                   "  WHERE futur.client_id = r.client_id"
                   "  AND futur.statut IN ('prévu', 'confirmé')"
                   "  AND futur.horaire >= ?)")
        parametres = list(self.STATUTS_A_RECASER) + [maintenant]
        # ⚠ THE TWO BOUNDS ARE INDEPENDENT: requiring them together meant a
        # `from such a date, no limit` window ALSO lost its start bound. Found
        # by the relative-window test, on 03/08/2026.  ⚠ BUT THE CALLER NO
        # LONGER SETS THEM ON THIS SOURCE (09/08/2026). The reasoning at the
        # time — `their appointment is before the slot, and bringing it forward
        # gains them nothing` — was WRONG here: the people in this source no
        # longer have ANY appointment, that is its very definition. Their old
        # date says nothing about what they want now, and it is almost always
        # in the past — so the bound set them all aside. Measured: one person
        # kept out of four who were waiting. Both parameters stay, they serve
        # the screens that ask for an explicit period.
        if debut:
            requete += " AND r.horaire >= ?"
            parametres.append(debut)
        if fin:
            requete += " AND r.horaire < ?"
            parametres.append(fin)
        lignes = self.conn.execute(requete + " ORDER BY r.horaire, r.id",
                                   parametres).fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def candidats_cascade(self, source, maintenant=None):
        """Candidates for a cascade; returns (candidates, no number, 🚫 set aside).

        candidates = [{"nom", "telephone", "reference"}] — the number is IN CLEAR here: this method is reserved for generating a list EXPLICITLY requested by the user (filling the paste area, CSV export), the equivalent of what they would paste themselves. It NEVER serves the ordinary display, which stays masked. `reference` is the ISO time of the oldest appointment concerned (for sorting); clients WITHOUT a number are excluded and counted; clients marked `Ne plus appeler` are always set aside (whatever the source) — and COUNTED too since 14/08/2026, because a silent exclusion reads like a defect: the screen announced `123 contacts added` where the database held 138.
        Sources:
        - `annules`  : clients with a cancelled appointment;
        - `deplaces` : clients with a moved appointment and NO upcoming appointment (scheduled or confirmed) — the `waiting` ones;
        - `tous`     : every client.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        # ⚠ THE 🚫 IS NO LONGER SET ASIDE BY THE QUERY, it is READ then set
        # aside here: that is the only way to COUNT it. The SQL filter made it
        # vanish without leaving a trace to display.
        if source == "annules":
            requete = ("SELECT c.nom, c.telephone, c.ne_plus_appeler, "
                       "MIN(r.horaire) AS reference "
                       "FROM clients c JOIN rendezvous r ON r.client_id = c.id "
                       "WHERE r.statut = 'annulé' GROUP BY c.id")
            parametres = ()
        elif source == "deplaces":
            requete = ("SELECT c.nom, c.telephone, c.ne_plus_appeler, "
                       "MIN(r.horaire) AS reference "
                       "FROM clients c JOIN rendezvous r ON r.client_id = c.id "
                       "WHERE r.statut = 'déplacé' "
                       "AND NOT EXISTS "
                       "(SELECT 1 FROM rendezvous r2 WHERE r2.client_id = c.id "
                       " AND r2.statut IN ('prévu', 'confirmé') AND r2.horaire >= ?) "
                       "GROUP BY c.id")
            parametres = (maintenant,)
        elif source == "tous":
            requete = ("SELECT c.nom, c.telephone, c.ne_plus_appeler, "
                       "MIN(r.horaire) AS reference "
                       "FROM clients c LEFT JOIN rendezvous r ON r.client_id = c.id "
                       "GROUP BY c.id")
            parametres = ()
        else:
            raise ValueError(f"Source de candidats inconnue : {source!r}")
        candidats, exclus, exclus_stop = [], 0, 0
        for ligne in self.conn.execute(requete, parametres).fetchall():
            if ligne["ne_plus_appeler"]:
                exclus_stop += 1  # 🚫: never called, and the screen SAYS so
                continue
            if not ligne["telephone"]:
                exclus += 1  # no number: nothing to dial, flagged on screen
                continue
            candidats.append({"nom": ligne["nom"], "telephone": ligne["telephone"],
                              "reference": ligne["reference"] or ""})
        return candidats, exclus, exclus_stop

    def creer_cascade(self, mission, creneau):
        """Opens a `first yes` cascade; returns its id."""
        curseur = self.conn.execute(
            "INSERT INTO cascades (mission, creneau) VALUES (?, ?)", (mission, creneau))
        self.conn.commit()
        return curseur.lastrowid

    def cloturer_cascade(self, cascade_id, statut, rendezvous_id=None):
        """Closes the cascade: `pourvue` (with the appointment created) or
        `épuisée`.
        """
        self.conn.execute(
            "UPDATE cascades SET statut = ?, rendezvous_id = ? WHERE id = ?",
            (statut, rendezvous_id, cascade_id))
        self.conn.commit()

    def obtenir_cascade(self, cascade_id):
        ligne = self.conn.execute(
            "SELECT * FROM cascades WHERE id = ?", (cascade_id,)).fetchone()
        return dict(ligne) if ligne else None

    def lister_cascades(self):
        """Every cascade, most recent first (for the history)."""
        lignes = self.conn.execute(
            "SELECT * FROM cascades ORDER BY id DESC").fetchall()
        return [dict(ligne) for ligne in lignes]

    def ajouter_appel_cascade(self, cascade_id, rang, nom, telephone, etat,
                              issue=None, resultat=None, transcription=None,
                              note=None, rendezvous_libere=None):
        """Records a person in the cascade: called (with an outcome) or spared.

        `note` = what THE PRODUCT decided (for instance: the agreed date did
        not hold, so no appointment was created) — never text put in the
        agent's mouth. `rendezvous_libere` = the id of the OLD appointment this
        call really gave back (the client took another slot). NULL when nothing
        was released: either there was nothing to release, or RingBack did not
        know which appointment it was — and the note then says so plainly, so a
        human can take care of it.
        """
        curseur = self.conn.execute(
            "INSERT INTO appels_cascade (cascade_id, rang, nom, telephone, etat, "
            "issue, resultat, transcription, note, rendezvous_libere) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (cascade_id, rang, nom, telephone, etat, issue,
             json.dumps(resultat, ensure_ascii=False) if resultat is not None else None,
             transcription, note, rendezvous_libere))
        self.conn.commit()
        return curseur.lastrowid

    def appels_de_cascade(self, cascade_id):
        """The cascade's rows, numbers already masked (the raw form does not come
        out).
        """
        lignes = self.conn.execute(
            "SELECT * FROM appels_cascade WHERE cascade_id = ? ORDER BY rang",
            (cascade_id,)).fetchall()
        detail = []
        for ligne in lignes:
            entree = dict(ligne)
            entree["numero_essai"] = self._est_essai(entree["telephone"])
            entree["telephone_masque"] = masquer_telephone(entree.pop("telephone"))
            entree["resultat"] = (json.loads(entree["resultat"])
                                  if entree["resultat"] else None)
            detail.append(entree)
        return detail

    def bilan_issues(self):
        """Counts the outcomes of the calls placed, for the on-screen table.

        confirmed / rescheduled / canceled = the outcome returned by the agent;
        to_reschedule = the client wants to move without settling a date; echec
        = a call placed but with no usable result. Calls cancelled BEFORE
        execution do not count: they had no outcome.
        """
        bilan = {"confirmed": 0, "rescheduled": 0, "canceled": 0,
                 "to_reschedule": 0, "echec": 0}
        for ligne in self.conn.execute("SELECT statut, resultat FROM appels").fetchall():
            if ligne["statut"] == "échec":
                bilan["echec"] += 1
            elif ligne["statut"] == "terminé" and ligne["resultat"]:
                statut = json.loads(ligne["resultat"]).get("appointment_status")
                if statut in bilan:
                    bilan[statut] += 1
        return bilan

    # ---------------------------------------------------------------- campagnes
    def creer_campagne(self, nom, theme, sujet="", mission="", creneau=None,
                       cascade_id=None, nature=None, configuration=None,
                       statut=None):
        """Opens a campaign (the instantiation of a work theme).

        nature + configuration: the 3-step assistant's model; statut: `prête`
        for an assistant campaign (it calls nobody before ▶ Démarrer),
        otherwise the historic default `en cours`.
        """
        curseur = self.conn.execute(
            "INSERT INTO campagnes (nom, theme, sujet, mission, creneau, "
            "cascade_id, nature, configuration, statut) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (nom, theme, sujet, mission, creneau, cascade_id, nature,
             configuration, statut or "en cours"))
        self.conn.commit()
        journal.info("Campagne n°%d créée : %s", curseur.lastrowid, nom)
        return curseur.lastrowid

    def changer_statut_campagne(self, campagne_id, statut):
        self.conn.execute("UPDATE campagnes SET statut = ? WHERE id = ?",
                          (statut, campagne_id))
        self.conn.commit()

    def definir_raison_pause_campagne(self, campagne_id, raison):
        """WHY the campaign paused itself (or None).

        Written when a failure ON OUR SIDE stops the campaign (key refused,
        service down, credit exhausted): it is that text the record displays,
        in French, with what to do next. Reset to None on restart — a stale
        reason must never stay on screen.
        """
        self.conn.execute("UPDATE campagnes SET raison_pause = ? WHERE id = ?",
                          (raison, campagne_id))
        self.conn.commit()

    def definir_configuration_campagne(self, campagne_id, configuration):
        """Rewrites an assistant campaign's configuration (JSON).

        Used by the cascade link: the prepared campaign notes where it comes
        from and how deep in the chain it sits.
        """
        self.conn.execute(
            "UPDATE campagnes SET configuration = ? WHERE id = ?",
            (configuration, campagne_id))
        self.conn.commit()

    def definir_creneau_campagne(self, campagne_id, creneau, mission=None):
        """Advances a campaign to the NEXT slot in its list.

        ⚠ THE COLUMN FOLLOWS THE CURSOR. Everything that reads
        `campagnes.creneau` — and that includes the call path itself — must see
        the CURRENT slot, otherwise a YES would be written on a slot already
        filled. `mission` moves with it: the message announces a date, it
        cannot stay on the old one.
        """
        if mission is None:
            self.conn.execute(
                "UPDATE campagnes SET creneau = ? WHERE id = ?",
                (creneau, campagne_id))
        else:
            self.conn.execute(
                "UPDATE campagnes SET creneau = ?, mission = ? WHERE id = ?",
                (creneau, mission, campagne_id))
        self.conn.commit()

    def obtenir_campagne(self, campagne_id):
        ligne = self.conn.execute(
            "SELECT * FROM campagnes WHERE id = ?", (campagne_id,)).fetchone()
        return dict(ligne) if ligne else None

    def lister_campagnes(self):
        """Every campaign, most recent first, with its progress.

        appeles = contacts having had at least one attempt; aboutis = contacts
        whose chain concluded positively; relances = follow-ups still
        scheduled.
        """
        lignes = self.conn.execute("""
            SELECT k.*,
              (SELECT COUNT(*) FROM contacts_campagne c
               WHERE c.campagne_id = k.id) AS contacts,
              (SELECT COUNT(*) FROM contacts_campagne c
               WHERE c.campagne_id = k.id
               AND c.etat IN ('appelé', 'abouti', 'abandonné')) AS appeles,
              (SELECT COUNT(*) FROM contacts_campagne c
               WHERE c.campagne_id = k.id AND c.etat = 'abouti') AS aboutis,
              (SELECT COUNT(*) FROM relances r
               WHERE r.campagne_id = k.id AND r.statut = 'planifiée') AS relances
            FROM campagnes k ORDER BY k.id DESC""").fetchall()
        return [dict(ligne) for ligne in lignes]

    def campagnes_ayant_appele(self):
        """The ids of the campaigns that placed AT LEAST ONE call.

        ⚠ WHY NOT THE STATUS (21/08/2026). `Terminée` is not enough, and
        `close` even less: a campaign prepared then closed has never made a
        phone ring. Measured in his database that day: of 113 past campaigns,
        SEVEN were closed without having called anybody — announcing them as
        `already sent` would have been false, exactly the kind of discrepancy
        he had just reported.

        The only fact that does not lie is the call trace itself.
        """
        return {ligne["campagne_id"] for ligne in self.conn.execute(
            "SELECT DISTINCT campagne_id FROM appels_campagne")}

    # ------------------------------------------- erasing campaigns ⚠ THIS IS
    # THE ONLY PLACE IN THE PRODUCT THAT DESTROYS HISTORY. Everything else only
    # adds or changes a status. Two functions, on purpose: we COUNT first, we
    # show the numbers, and only then do we erase.
    def compter_avant_suppression_campagnes(self, ids):
        """What erasing these campaigns would take with it — without touching
        anything.

        Used by the confirmation screen. The count of PENDING calls is the most
        important: those are calls that really WENT OUT to CALL-E whose result
        has not yet been read, and the id that makes it findable lives only on
        the contact. Erasing it means losing the result of a real conversation,
        not a table row.
        """
        if not ids:
            return {"campagnes": 0, "contacts": 0, "appels": 0,
                    "relances_planifiees": 0, "relances": 0, "changements": 0,
                    "appels_en_attente": 0, "cascades": 0}
        trous = ",".join("?" for _ in ids)
        valeurs = list(ids)

        def compte(requete):
            return self.conn.execute(requete, valeurs).fetchone()[0]

        return {
            "campagnes": compte(
                f"SELECT COUNT(*) FROM campagnes WHERE id IN ({trous})"),
            "contacts": compte(
                "SELECT COUNT(*) FROM contacts_campagne "
                f"WHERE campagne_id IN ({trous})"),
            "appels": compte(
                "SELECT COUNT(*) FROM appels_campagne "
                f"WHERE campagne_id IN ({trous})"),
            "relances_planifiees": compte(
                "SELECT COUNT(*) FROM relances "
                f"WHERE campagne_id IN ({trous}) AND statut = 'planifiée'"),
            "relances": compte(
                f"SELECT COUNT(*) FROM relances WHERE campagne_id IN ({trous})"),
            "changements": compte(
                "SELECT COUNT(*) FROM changements "
                f"WHERE campagne_id IN ({trous})"),
            "appels_en_attente": compte(
                "SELECT COUNT(*) FROM contacts_campagne "
                f"WHERE campagne_id IN ({trous}) "
                "AND appel_externe_id IS NOT NULL AND appel_externe_id <> ''"),
            "cascades": compte(
                "SELECT COUNT(*) FROM cascades WHERE id IN "
                f"(SELECT cascade_id FROM campagnes WHERE id IN ({trous}) "
                " AND cascade_id IS NOT NULL)"),
        }

    def supprimer_campagnes(self, ids):
        """Erases these campaigns and everything that exists only through them.

        In dependency order, in a single transaction: the change log, the
        follow-ups, the calls, the contacts, the cascade if any, then the
        campaign. Returns the same set of counts as
        `compter_avant_suppression_campagnes`.

        ⚠ WHAT IS NOT TOUCHED, and that is deliberate: the CLIENTS and the
        APPOINTMENTS. A campaign may have modified them — the moved appointment
        stays moved, the freed slot stays free. Erasing the campaign erases the
        TRACE of the work, never its result in the calendar. That is also why
        the change log goes with it: it recounts what IT did.
        """
        ids = [int(x) for x in ids]
        if not ids:
            return self.compter_avant_suppression_campagnes([])
        releve = self.compter_avant_suppression_campagnes(ids)
        trous = ",".join("?" for _ in ids)
        with self.verrou:
            cascades = [ligne[0] for ligne in self.conn.execute(
                f"SELECT cascade_id FROM campagnes WHERE id IN ({trous}) "
                "AND cascade_id IS NOT NULL", ids).fetchall()]
            for table in ("changements", "relances", "appels_campagne",
                          "contacts_campagne"):
                self.conn.execute(
                    f"DELETE FROM {table} WHERE campagne_id IN ({trous})", ids)
            self.conn.execute(
                f"DELETE FROM campagnes WHERE id IN ({trous})", ids)
            if cascades:
                creux = ",".join("?" for _ in cascades)
                self.conn.execute(
                    f"DELETE FROM appels_cascade WHERE cascade_id IN ({creux})",
                    cascades)
                self.conn.execute(
                    f"DELETE FROM cascades WHERE id IN ({creux})", cascades)
            self.conn.commit()
        journal.info(
            "Campagnes effacées : %d campagne(s), %d contact(s), %d appel(s), "
            "%d relance(s), %d ligne(s) de changements, %d cascade(s)",
            releve["campagnes"], releve["contacts"], releve["appels"],
            releve["relances"], releve["changements"], releve["cascades"])
        return releve

    def ajouter_contact_campagne(self, campagne_id, rang, nom, telephone,
                                 rendezvous_id=None, etat="à appeler",
                                 issue=None, champs=None, detail=None,
                                 client_id=None):
        """Adds a contact; client_id=None makes their record be CREATED (or
        found).

        The contact therefore always carries a link to a client record: it is
        that record's CURRENT number that will be dialled, never the copy
        frozen here (which stays as a trace of what was imported).
        """
        if client_id is None:
            client_id = self.client_pour_contact(nom, telephone, rendezvous_id)
        # ⚠ THE APPOINTMENT'S STATE AT THE MOMENT THE CAMPAIGN TAKES IT
        # (21/08/2026). Without it, there is no way of knowing later whether it
        # changed UNDER OUR FEET: a campaign reminding about MISSED
        # appointments takes `manqué` appointments, a resumption of the
        # CANCELLED ones takes `annulé` ones — refusing on the current status
        # alone would have broken them all. It is the DIFFERENCE that counts,
        # not the state. An ADDITIVE addition: campaigns already in the
        # database have none, and `cible_appel_contact` knows how to do
        # without.
        champs = self._avec_statut_du_rendezvous(champs, rendezvous_id,
                                                nom, telephone)
        curseur = self.conn.execute(
            "INSERT INTO contacts_campagne (campagne_id, rang, nom, telephone, "
            "rendezvous_id, etat, issue, champs, detail, client_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (campagne_id, rang, nom, telephone, rendezvous_id, etat, issue,
             champs, detail, client_id))
        self.conn.commit()
        return curseur.lastrowid

    def _avec_statut_du_rendezvous(self, champs, rendezvous_id, nom="",
                                   telephone=""):
        """Adds `rdv_statut` to the contact's fields, when there is an
        appointment.

        ⚠ TWO WAYS OF BEING TIED TO AN APPOINTMENT, and both are needed: by ID
        when the list comes from the schedule or the database, by DATE when it
        is pasted or imported from a CSV (see `_rendezvous_vise`, which does
        exactly the same reading at call time).

        Returns the JSON as it stands when RingBack knows no appointment for
        this contact: that is what tells `it changed` from `we never knew the
        first thing about it`, and we do not guess the difference.
        """
        try:
            valeurs = json.loads(champs) if champs else {}
        except (TypeError, ValueError):
            return champs
        if not isinstance(valeurs, dict):
            return champs
        rdv = self._rendezvous_du_contact(rendezvous_id, valeurs, nom, telephone)
        if rdv is None:
            return champs
        valeurs["rdv_statut"] = rdv["statut"]
        return json.dumps(valeurs, ensure_ascii=False)

    def _rendezvous_du_contact(self, rendezvous_id, champs, nom, telephone):
        """THE appointment this contact is about, by id or by date."""
        if rendezvous_id:
            return self.conn.execute(
                "SELECT id, horaire, statut FROM rendezvous WHERE id = ?",
                (rendezvous_id,)).fetchone()
        date = (champs.get("rdv_existant") or "").strip()
        if not date:
            return None
        trouve = self.rendezvous_identique(nom, telephone, date)
        if trouve is None:
            return None
        return self.conn.execute(
            "SELECT id, horaire, statut FROM rendezvous WHERE id = ?",
            (trouve["id"] if isinstance(trouve, dict) else trouve,)).fetchone()

    def rendezvous_change_depuis_la_campagne(self, contact_id):
        """Has the appointment changed since the campaign took it?

        ⚠ HIS REQUEST OF 21/08/2026, and the defect it fixes. Exercised: I
        cancel an appointment between the campaign's creation and the call, the
        phone rings anyway — and the `yes` PUTS the appointment BACK on the
        schedule. Measured in his database: 131 contacts could still ring about
        a deleted or cancelled appointment.

        Returns the sentence saying WHAT changed, or "" when nothing moved.

        ⚠ IT IS THE DIFFERENCE THAT DECIDES, NOT THE CURRENT STATE. A campaign
        reminding about missed appointments takes `manqué` appointments: they
        are normal for it. What is not normal is an appointment having left the
        state where the campaign found it.

        ⚠ AND WITH NO CAPTURED STATE, WE DO NOT GUESS: campaigns from before
        21/08/2026 carry none. We then stick to what is certain — the row has
        disappeared, or the time is no longer the one announced.
        """
        ligne = self.conn.execute(
            "SELECT rendezvous_id, champs, nom, telephone "
            "FROM contacts_campagne WHERE id = ?", (contact_id,)).fetchone()
        if ligne is None:
            return ""
        try:
            champs = json.loads(ligne["champs"] or "{}")
        except (TypeError, ValueError):
            champs = {}
        if not isinstance(champs, dict):
            champs = {}
        capture_statut = champs.get("rdv_statut")
        if not capture_statut:
            # ⚠ NOTHING WAS CAPTURED: either the campaign predates 21/08/2026,
            # or RingBack never knew this appointment (a pasted row with a
            # hand-typed date). In both cases we do not guess — refusing here
            # would set people aside for no reason.
            return ""
        rdv = self._rendezvous_du_contact(ligne["rendezvous_id"], champs,
                                          ligne["nom"], ligne["telephone"])
        if rdv is None:
            # ⚠ THE TEXT SAYS WHAT WE KNOW, NO MORE. When the contact is tied
            # by ID (schedule, database), an absence is a deletion,
            # unambiguously. When it is tied by DATE (pasted list, CSV), an
            # appointment that cannot be found may have been moved, cancelled
            # or deleted — the three look alike, and claiming to choose would
            # be inventing.
            if ligne["rendezvous_id"]:
                return "il a été supprimé de l'agenda"
            return ("il n'est plus à la date que la campagne avait retenue — "
                    "déplacé, annulé ou supprimé depuis")
        capture_date = (champs.get("rdv_existant") or "").strip()
        if capture_date and rdv["horaire"] != capture_date:
            return ("il a été déplacé depuis — la campagne parlerait d'une "
                    "date qui n'est plus la sienne")
        if (rdv["statut"] != capture_statut
                and rdv["statut"] not in STATUTS_OCCUPANTS_RDV):
            return (f"il est passé « {rdv['statut']} » depuis — la campagne "
                    "l'avait pris « " + capture_statut + " »")
        return ""

    def definir_detail_contact(self, contact_id, detail):
        """Writes the key information displayed for this contact (assistant) —
        always from the call's real result, never invented.
        """
        self.conn.execute(
            "UPDATE contacts_campagne SET detail = ? WHERE id = ?",
            (detail, contact_id))
        self.conn.commit()

    def contacts_de_campagne(self, campagne_id):
        """The campaign's contacts, numbers already masked (the raw form does not
        come out).
        """
        lignes = self.conn.execute(
            "SELECT * FROM contacts_campagne WHERE campagne_id = ? ORDER BY rang",
            (campagne_id,)).fetchall()
        contacts = []
        for ligne in lignes:
            contact = dict(ligne)
            contact["numero_essai"] = self._est_essai(contact["telephone"])
            contact["telephone_masque"] = masquer_telephone(contact.pop("telephone"))
            contacts.append(contact)
        return contacts

    def obtenir_contact_campagne(self, contact_id):
        """A campaign contact's record (number masked), or None."""
        ligne = self.conn.execute(
            "SELECT * FROM contacts_campagne WHERE id = ?", (contact_id,)).fetchone()
        if ligne is None:
            return None
        contact = dict(ligne)
        contact["numero_essai"] = self._est_essai(contact["telephone"])
        contact["telephone_masque"] = masquer_telephone(contact.pop("telephone"))
        return contact

    def telephone_contact_campagne(self, contact_id):
        """This contact's CURRENT number, IN CLEAR — never for display.

        It is their CLIENT RECORD's number that counts, not the copy frozen
        when the campaign was created: correcting a number corrects every
        running campaign. Returns None when the record has been deleted
        (nothing left to dial); contacts from before the `client_id` column (an
        old database) fall back on their period copy.
        """
        ligne = self.conn.execute(
            "SELECT telephone, client_id FROM contacts_campagne WHERE id = ?",
            (contact_id,)).fetchone()
        if ligne is None:
            return None
        if ligne["client_id"] is None:
            return ligne["telephone"]
        return self.telephone_de(ligne["client_id"])

    def cible_appel_contact(self, contact_id):
        """What must be dialled for this contact — and the REFUSAL when there is
        one.

        Returns {"telephone": str|None, "refus": str|None, "client_id":
        int|None}. This is the COMPULSORY checkpoint of every campaign call
        path: it holds the link to the record (the current number) AND the 🚫
        safety net (the number OR the name of a client marked `Ne plus
        appeler`). When `refus` is filled in, no call goes out and the text is
        the one displayed on screen.
        """
        ligne = self.conn.execute(
            "SELECT nom, telephone, client_id FROM contacts_campagne "
            "WHERE id = ?", (contact_id,)).fetchone()
        if ligne is None:
            return {"telephone": None, "refus": REFUS_CLIENT_SUPPRIME,
                    "client_id": None}
        client_id, telephone = ligne["client_id"], ligne["telephone"]
        if client_id is not None:
            fiche = self.conn.execute(
                "SELECT telephone, ne_plus_appeler FROM clients WHERE id = ?",
                (client_id,)).fetchone()
            if fiche is None:  # record deleted: the contact stays readable…
                return {"telephone": None, "refus": REFUS_CLIENT_SUPPRIME,
                        "client_id": client_id}
            if fiche["ne_plus_appeler"]:
                return {"telephone": None, "refus": REFUS_STOP,
                        "client_id": client_id}
            telephone = fiche["telephone"]  # …and it is the CURRENT number
        if telephone and self.telephone_exclu(telephone):
            return {"telephone": None, "refus": REFUS_STOP,
                    "client_id": client_id}
        if self.nom_exclu(ligne["nom"]):
            return {"telephone": None, "refus": REFUS_STOP_NOM,
                    "client_id": client_id}
        if not telephone:
            return {"telephone": None, "refus": REFUS_SANS_NUMERO,
                    "client_id": client_id}
        # ⚠ THE APPOINTMENT IS READ BACK HERE, at the moment of dialling
        # (21/08/2026). It is the same net as the 🚫 just above, and for the
        # same reason: what was true when the campaign was created may have
        # stopped being so. Exercised: an appointment cancelled in the meantime
        # was called anyway, and the `yes` put it back on the schedule.
        change = self.rendezvous_change_depuis_la_campagne(contact_id)
        if change:
            return {"telephone": None,
                    "refus": f"{REFUS_RDV_CHANGE} : {change}",
                    "client_id": client_id}
        return {"telephone": telephone, "refus": None, "client_id": client_id}

    def client_du_contact(self, contact_id):
        """The id of the client record tied to this contact (None when there is
        none).
        """
        ligne = self.conn.execute(
            "SELECT client_id FROM contacts_campagne WHERE id = ?",
            (contact_id,)).fetchone()
        return ligne["client_id"] if ligne else None

    def compter_contacts_par_etat(self, campagne_id):
        """{state: count} for THIS campaign — used by the resumption filter.

        The total is given under the key `tous`: that is how the screen
        announces the number of people found BEFORE adding them to the grid.
        """
        comptes = {"tous": 0}
        for ligne in self.conn.execute(
                "SELECT etat, COUNT(*) AS nombre FROM contacts_campagne "
                "WHERE campagne_id = ? GROUP BY etat", (campagne_id,)):
            comptes[ligne["etat"]] = ligne["nombre"]
            comptes["tous"] += ligne["nombre"]
        return comptes

    def contacts_campagne_en_clair(self, campagne_id, etat=None):
        """The contacts of a past campaign, number IN CLEAR, filtered by state.

        etat=None (or `tous`) returns the whole list. Number in clear: the same
        use as candidats_cascade / contacts_depuis_rendezvous — composing a
        call list EXPLICITLY requested by the user, never the display (which
        stays masked).
        """
        requete = ("SELECT nom, telephone, champs, rendezvous_id, etat, detail "
                   "FROM contacts_campagne WHERE campagne_id = ?")
        parametres = [campagne_id]
        if etat and etat != "tous":
            requete += " AND etat = ?"
            parametres.append(etat)
        lignes = self.conn.execute(requete + " ORDER BY rang",
                                   parametres).fetchall()
        return [dict(ligne) for ligne in lignes]

    def changer_etat_contact_campagne(self, contact_id, etat, issue=None):
        self.conn.execute(
            "UPDATE contacts_campagne SET etat = ?, issue = ? WHERE id = ?",
            (etat, issue, contact_id))
        self.conn.commit()

    # ------------------------------- the call that WENT OUT with no result
    def definir_appel_en_attente(self, contact_id, identifiant, tentative=None):
        """Keeps the CALL-E id of a call that WENT OUT whose result is missing.

        It is the only thing that stops a call already placed from being lost:
        without it, an expiring wait erased every trace of the conversation
        (observed on 01/08/2026). No call is created here, no attempt is
        counted: we only note where to find the result.
        """
        self.conn.execute(
            "UPDATE contacts_campagne SET appel_externe_id = ?, "
            "appel_externe_tentative = ? WHERE id = ?",
            (identifiant, tentative, contact_id))
        self.conn.commit()

    def effacer_appel_en_attente(self, contact_id):
        """The pending call has returned its result: nothing left to retrieve.
        """
        self.definir_appel_en_attente(contact_id, None, None)

    def contacts_en_attente_de_resultat(self, campagne_id=None):
        """The contacts whose call WENT OUT and has not yet returned its result.

        Numbers masked, as everywhere on display. campagne_id=None sweeps every
        campaign (the banner's counter).
        """
        requete = ("SELECT * FROM contacts_campagne "
                   "WHERE appel_externe_id IS NOT NULL")
        parametres = []
        if campagne_id is not None:
            requete += " AND campagne_id = ?"
            parametres.append(campagne_id)
        contacts = []
        for ligne in self.conn.execute(requete + " ORDER BY rang", parametres):
            contact = dict(ligne)
            contact["numero_essai"] = self._est_essai(contact["telephone"])
            contact["telephone_masque"] = masquer_telephone(
                contact.pop("telephone"))
            contacts.append(contact)
        return contacts

    def definir_appel_externe(self, appel_id, identifiant):
        """The CALL-E id of a QUEUE call (single call-back)."""
        self.conn.execute(
            "UPDATE appels SET appel_externe_id = ? WHERE id = ?",
            (identifiant, appel_id))
        self.conn.commit()

    def ajouter_appel_campagne(self, campagne_id, contact_id, tentative,
                               issue=None, resultat=None, transcription=None):
        """Records a campaign call attempt (0 = the initial one, 1..n =
        follow-ups).
        """
        curseur = self.conn.execute(
            "INSERT INTO appels_campagne (campagne_id, contact_id, tentative, "
            "issue, resultat, transcription) VALUES (?, ?, ?, ?, ?, ?)",
            (campagne_id, contact_id, tentative, issue,
             json.dumps(resultat, ensure_ascii=False) if resultat is not None else None,
             transcription))
        self.conn.commit()
        return curseur.lastrowid

    def appels_du_contact_campagne(self, contact_id):
        """A contact's attempt history (no number in it)."""
        lignes = self.conn.execute(
            "SELECT * FROM appels_campagne WHERE contact_id = ? ORDER BY id",
            (contact_id,)).fetchall()
        appels = []
        for ligne in lignes:
            appel = dict(ligne)
            appel["resultat"] = (json.loads(appel["resultat"])
                                 if appel["resultat"] else None)
            appels.append(appel)
        return appels

    def dernier_rendezvous_connu(self):
        """The date of the FURTHEST appointment in the calendar, or "" when there
        is none.

        Used by the `last date` choice of the cascading shift: beyond it, the
        chain can no longer find anybody — so it is the only bound that makes
        sense without inventing one. Deleted and cancelled appointments are set
        aside: they no longer occupy anything and can serve nobody.
        """
        ligne = self.conn.execute(
            "SELECT MAX(horaire) AS fin FROM rendezvous "
            "WHERE statut NOT IN ('supprimé', 'annulé')").fetchone()
        return (ligne["fin"] or "")[:10] if ligne else ""

    def compter_personnes_appelees(self, campagne_id):
        """How many PEOPLE has this campaign dialled?

        People, not attempts: somebody followed up three times counts as one.
        It is that count the configured ceiling bounds — `30 calls allowed`
        means thirty people dialled.

        A single query: this count is read back at EVERY turn of the execution
        loop, and one read per contact would be costly.
        """
        return self.conn.execute(
            "SELECT COUNT(DISTINCT a.contact_id) FROM appels_campagne a "
            "JOIN contacts_campagne c ON c.id = a.contact_id "
            "WHERE c.campagne_id = ?", (campagne_id,)).fetchone()[0]

    # ----------------------------------------------------------------- relances
    def creer_relance(self, campagne_id, contact_id, echeance, tentative=1,
                      motif=""):
        curseur = self.conn.execute(
            "INSERT INTO relances (campagne_id, contact_id, echeance, tentative, "
            "motif) VALUES (?, ?, ?, ?, ?)",
            (campagne_id, contact_id, echeance, tentative, motif))
        self.conn.commit()
        journal.info("Relance n°%d planifiée (campagne n°%d, tentative %d, "
                     "échéance %s)", curseur.lastrowid, campagne_id, tentative,
                     echeance)
        return curseur.lastrowid

    _REQUETE_RELANCE = """
        SELECT r.*, c.nom AS contact_nom, c.telephone AS contact_telephone,
               c.etat AS contact_etat, c.detail AS contact_detail,
               c.client_id AS client_id,
               k.nom AS campagne_nom, k.theme AS campagne_theme,
               k.nature AS campagne_nature, k.statut AS campagne_statut,
               (SELECT COUNT(*) FROM appels_campagne a
                 WHERE a.contact_id = r.contact_id) AS tentatives_faites,
               (SELECT MAX(a.cree_le) FROM appels_campagne a
                 WHERE a.contact_id = r.contact_id) AS dernier_appel
        FROM relances r
        JOIN contacts_campagne c ON c.id = r.contact_id
        JOIN campagnes k ON k.id = r.campagne_id
    """

    def _ligne_relance(self, ligne):
        relance = dict(ligne)
        relance["numero_essai"] = self._est_essai(relance["contact_telephone"])
        relance["telephone_masque"] = masquer_telephone(
            relance.pop("contact_telephone"))
        relance["dernier_appel"] = heure_locale(relance.get("dernier_appel"))
        return relance

    def obtenir_relance(self, relance_id):
        ligne = self.conn.execute(
            self._REQUETE_RELANCE + " WHERE r.id = ?", (relance_id,)).fetchone()
        return self._ligne_relance(ligne) if ligne else None

    def lister_relances(self, statut="planifiée"):
        """The follow-ups with THIS status, nearest due date first (masked)."""
        lignes = self.conn.execute(
            self._REQUETE_RELANCE + " WHERE r.statut = ? "
            "ORDER BY r.echeance, r.id", (statut,)).fetchall()
        return [self._ligne_relance(ligne) for ligne in lignes]

    def relances_dues(self, maintenant=None):
        """The scheduled follow-ups whose due date has been reached (masked).
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        lignes = self.conn.execute(
            self._REQUETE_RELANCE + " WHERE r.statut = 'planifiée' "
            "AND r.echeance <= ? ORDER BY r.echeance, r.id",
            (maintenant,)).fetchall()
        return [self._ligne_relance(ligne) for ligne in lignes]

    def relances_de_campagne(self, campagne_id):
        """Every follow-up of a campaign (masked), by due date."""
        lignes = self.conn.execute(
            self._REQUETE_RELANCE + " WHERE r.campagne_id = ? "
            "ORDER BY r.echeance, r.id", (campagne_id,)).fetchall()
        return [self._ligne_relance(ligne) for ligne in lignes]

    def changer_relance(self, relance_id, statut=None, echeance=None):
        if statut is not None:
            self.conn.execute("UPDATE relances SET statut = ? WHERE id = ?",
                              (statut, relance_id))
        if echeance is not None:
            self.conn.execute("UPDATE relances SET echeance = ? WHERE id = ?",
                              (echeance, relance_id))
        self.conn.commit()

    # ------------------------------------- contacts waiting for a call-back A
    # person we could NOT reach stays visible even when no follow-up is
    # scheduled for them any more: without that they would disappear from the
    # screen while they still need calling back.
    _REQUETE_CONTACT_RAPPEL = """
        SELECT c.id, c.campagne_id, c.rang, c.nom, c.telephone, c.etat,
               c.issue, c.detail, c.traite_le, c.client_id,
               k.nom AS campagne_nom, k.theme AS campagne_theme,
               k.nature AS campagne_nature, k.statut AS campagne_statut,
               (SELECT COUNT(*) FROM appels_campagne a
                 WHERE a.contact_id = c.id) AS tentatives_faites,
               (SELECT MAX(a.cree_le) FROM appels_campagne a
                 WHERE a.contact_id = c.id) AS dernier_appel
        FROM contacts_campagne c
        JOIN campagnes k ON k.id = c.campagne_id
    """

    def _ligne_contact_rappel(self, ligne):
        contact = dict(ligne)
        contact["numero_essai"] = self._est_essai(contact["telephone"])
        contact["telephone_masque"] = masquer_telephone(contact.pop("telephone"))
        # `dernier_appel` comes from sqlite (universal time); `traite_le` is
        # written by the application in local time — only the first is
        # converted.
        contact["dernier_appel"] = heure_locale(contact.get("dernier_appel"))
        return contact

    def contacts_injoignables(self):
        """The contacts not reached for whom NO follow-up is scheduled any more.

        Two states say the same thing — `we did not manage to reach them, and
        the automatic chain has stopped`: `injoignable` (assistant campaigns)
        and `abandonné` (classic follow-up chains).

        The attempt ceiling took them out of the automatic chain: nothing will
        go out by itself for them any more, and yet they still need calling
        back. They therefore belong to the family of automatic call-backs (it
        is the system that put them there), with the explicit mention that no
        new follow-up is scheduled.
        """
        lignes = self.conn.execute(
            self._REQUETE_CONTACT_RAPPEL + """
            WHERE c.etat IN ('injoignable', 'abandonné')
              AND NOT EXISTS (SELECT 1 FROM relances r
                              WHERE r.contact_id = c.id
                                AND r.statut = 'planifiée')
            ORDER BY c.id""").fetchall()
        return [self._ligne_contact_rappel(ligne) for ligne in lignes]

    def clients_interdits(self):
        """The ids of the records marked 🚫 `ne plus appeler`.

        ⚠ IN ONE GO, and that is this method's reason to exist: the `contact by
        the agent` filter of 🔁 Relances applies it to hundreds of rows — one
        read per row would have meant hundreds of queries to display one page.
        """
        return {ligne["id"] for ligne in self.conn.execute(
            "SELECT id FROM clients WHERE ne_plus_appeler = 1")}

    def clients_par_chiffres(self, chiffres):
        """The ids of the contacts whose number contains these digits.

        ⚠ THE COMPARISON HAPPENS HERE, AND THE NUMBER IN CLEAR DOES NOT LEAVE.
        The display records carry only the mask (`telephone_masque`) — that is
        deliberate: the layer that renders the screen has never seen the real
        number. A `0639985042` search must not break that rule, so it returns
        IDENTIFIERS, not numbers.

        The significant digits are compared (no dialling code, no spaces):
        people rarely remember the `+33`, and often type the ending.
        """
        brut = "".join(c for c in (chiffres or "") if c.isdigit())
        if not brut:
            return set()
        # ⚠ TWO FORMS, NOT ONE. The stored number is reduced to its SIGNIFICANT
        # digits (`+33 6 39 98 50 42` → `639985042`): a `0639985042` typed in
        # full was therefore not found in it, while a `42` was. We compare the
        # input as it stands AND reduced the same way —
        # `chiffres_significatifs("42")` returns "", hence the OR.
        formes = {brut}
        reduite = chiffres_significatifs(brut)
        if reduite:
            formes.add(reduite)
        trouves = set()
        for ligne in self.conn.execute("SELECT id, telephone FROM clients"):
            numero = chiffres_significatifs(ligne["telephone"] or "")
            if numero and any(forme in numero for forme in formes):
                trouves.add(ligne["id"])
        return trouves

    # ⚠ `rendezvous_avec_rappel_souhaite` WAS REMOVED on 10/08/2026 along with
    # the `☎ À contacter à la main` table, its only caller (see serveur.py).
    # The `rappel_souhaite` field OUTLIVES it: it is still typed in, and the 🔔
    # flag is shown wherever the contact appears. A query nobody calls ends up
    # lying about what the product can do.

    def contacts_rappel_humain(self, traites=False):
        """The 🙋 `à rappeler par un humain` contacts, handled or not.

        It is the discussion sheets' escape hatch: the client wants something
        the agent could not conclude. NO automatic call EVER goes out for them
        (their state is no longer among the callable states); only a human
        handles them, and the `done` gesture takes them out of the list without
        erasing anything.
        """
        condition = "IS NOT NULL" if traites else "IS NULL"
        lignes = self.conn.execute(
            self._REQUETE_CONTACT_RAPPEL
            + f" WHERE c.etat = 'à rappeler par un humain' "
              f"AND c.traite_le {condition} ORDER BY c.id").fetchall()
        return [self._ligne_contact_rappel(ligne) for ligne in lignes]

    def marquer_contact_traite(self, contact_id, traite=True):
        """Sets (or removes) the `handled` mark of a human call-back.

        Returns True when the contact existed. Nothing is erased: the client's
        request, the campaign and the call history stay in the database.
        """
        if self.conn.execute("SELECT 1 FROM contacts_campagne WHERE id = ?",
                             (contact_id,)).fetchone() is None:
            return False
        quand = (datetime.datetime.now().isoformat(timespec="seconds")
                 if traite else None)
        self.conn.execute(
            "UPDATE contacts_campagne SET traite_le = ? WHERE id = ?",
            (quand, contact_id))
        self.conn.commit()
        journal.info("Contact n°%d : rappel humain marqué %s", contact_id,
                     "traité" if traite else "à faire")
        return True

    def annuler_relances_campagne(self, campagne_id):
        """Cancels ALL of a campaign's scheduled follow-ups; returns the number.

        Used by manual closure and by a slot filled during a follow-up: nothing
        left to follow up once the objective is met or abandoned.
        """
        curseur = self.conn.execute(
            "UPDATE relances SET statut = 'annulée' "
            "WHERE campagne_id = ? AND statut = 'planifiée'", (campagne_id,))
        self.conn.commit()
        return curseur.rowcount

    def annuler_relances_contact(self, contact_id):
        """Cancels ONE contact's scheduled follow-ups; returns the number.

        ⚠ THAT CONTACT'S ONLY — not the campaign's. The only caller is the 🚫
        requested on the phone (see assistant._poser_ne_plus_appeler): it is
        that person who asked not to be called back, not the others on the
        list.
        """
        curseur = self.conn.execute(
            "UPDATE relances SET statut = 'annulée' "
            "WHERE contact_id = ? AND statut = 'planifiée'", (contact_id,))
        self.conn.commit()
        return curseur.rowcount

    # ------------------------------------------------ cahier de changements
    def ajouter_changement(self, campagne_id, genre, nom, contact_id=None,
                           client_id=None, rendezvous_id=None,
                           ancienne_date=None, nouvelle_date=None, motif="",
                           duree="", raison=""):
        """Writes ONE row of the change log, at the moment of the change.

        It is a TRACE, not a computation: it is placed where the schedule
        really moves (assistant._appeler_contact), never reconstructed after
        the fact — that is what guarantees no change is lost. genre: `ajout`
        (➕), `suppression` (➖), `deplacement` (↔) or `humain` (🙋, a request a
        human must handle).
        """
        curseur = self.conn.execute(
            "INSERT INTO changements (campagne_id, contact_id, client_id, "
            "rendezvous_id, genre, nom, ancienne_date, nouvelle_date, motif, "
            "duree, raison) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (campagne_id, contact_id, client_id, rendezvous_id, genre, nom,
             ancienne_date, nouvelle_date, motif or "", duree or "",
             raison or ""))
        self.conn.commit()
        journal.info("Cahier de changements — campagne n°%s : %s pour %s "
                     "(%s -> %s)", campagne_id, genre, nom,
                     ancienne_date or "—", nouvelle_date or "—")
        return curseur.lastrowid

    def changements_de_campagne(self, campagne_id):
        """A campaign's change log, in writing order."""
        lignes = self.conn.execute(
            "SELECT * FROM changements WHERE campagne_id = ? ORDER BY id",
            (campagne_id,)).fetchall()
        return [dict(ligne) for ligne in lignes]

    def changements_du_contact(self, contact_id):
        """The changes written for THIS campaign contact."""
        lignes = self.conn.execute(
            "SELECT * FROM changements WHERE contact_id = ? ORDER BY id",
            (contact_id,)).fetchall()
        return [dict(ligne) for ligne in lignes]

    def campagne_du_rendezvous(self, rendezvous_id):
        """THE campaign that produced this appointment, or None. Nothing is added.

        The owner's rule: `we must simply point the appointment request back to
        the campaign that made it`. The link ALREADY exists — the change log
        ties every row to its campaign AND to its appointment. We read it
        backwards rather than copy one more column: an appointment born of a
        call therefore finds its campaign again, and an appointment typed by
        hand simply has none (None), without one being invented for it.

        Returns {"id", "nom", "genre"} — the genre says what the campaign did
        with this appointment (`ajout`, `deplacement`…). The FIRST row of the
        log counts: it is the one that created it.
        """
        ligne = self.conn.execute(
            "SELECT ch.campagne_id AS id, ca.nom AS nom, ch.genre AS genre "
            "FROM changements ch JOIN campagnes ca ON ca.id = ch.campagne_id "
            "WHERE ch.rendezvous_id = ? ORDER BY ch.id LIMIT 1",
            (rendezvous_id,)).fetchone()
        return dict(ligne) if ligne else None
