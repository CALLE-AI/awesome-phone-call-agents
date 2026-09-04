"""A sample ICS calendar, BUILT AT THE MOMENT it is asked for.

Owner's request of 10/08/2026: `a good hundred appointments over the coming
weeks… relative to today's dates, so that whenever we generate the data set it
is always valid`.

⚠ WHY NOT A FIXED FILE. The three shipped samples (`exemple_agenda.ics` and its
two variants) carry WRITTEN dates: three months later everything in them is
past, the import no longer fills the schedule and the demonstration shows
nothing. This one starts from `datetime.now()`: it is right on the day it is
opened, and it will stay so.

⚠ EVERY NUMBER COMES FROM THE SIX ROOTS ARCEP RESERVES for audiovisual works
(see the header of `jeu_essai.py`). They are assigned to nobody: none of these
numbers can call or be called. It is the same rule as everywhere else in the
product, and `preparer_publication.py` checks it on the published copy.

⚠ IT ALIGNS ITSELF ON THE CONFIGURED HOURS (10/08/2026). The open days, the
typical week's windows, the slot step and the closed days come from ⚙ Réglages
→ 🗓 Agenda. Before, they were WRITTEN here: imported into a practice that opens
on Saturday, closes on Wednesday or works in quarter-hours, the sample fell
outside the opening hours — the schedule showed appointments outside the boxes,
and freed-slot campaigns did not find the expected places. With no hours
configured at all, a practice's working hours cannot be guessed: the fallback
windows below are used, and the screen SAYS so.

⚠ ONLY ONE SLOT IN TWO IS TAKEN, NEARBY. A calendar packed to bursting would
leave no free slot to offer — and offering a free slot is precisely what the
product does best.

⚠ AND IT COVERS ONE HUNDRED AND EIGHTY DAYS, THINNING OUT AS IT GOES. Owner's
request of 11/08/2026: `since we have 90 days we ought to have samples over 100
days`. He was right, and the gap was wider than expected: the list rule offers
`up to 30 days after` and `up to 90 days after` (`assistant.JOURS_APRES`), and
the sample stopped at three weeks — so those two options could give NOTHING
different from `no limit`. Measured before: 462 appointments over 21 days.

⚠ ONE HUNDRED → ONE HUNDRED AND EIGHTY ON 15/08/2026, AND THE CAUSE IS
MEASURED. His observation: `the cascade stops at the second occurrence;
normally it should carry on to the cut-off date`. The engine was right — it was
the SAMPLE that lacked material. Each link of a cascading shift consumes the
requested gain: with `at least 30 days`, the second link looks for appointments
60 days out, the third 90, the fourth 120… A hundred days of sample therefore
allow only TWO links, whatever cut-off date is configured. Measured in his own
database: appointments up to 23/11, chain dead on the 06/11 slot for want of
anyone on 06/12.

One hundred and eighty days leave five or six links at a 30-day gain, and the
density of the last tier was lowered (one slot in 30) so the calendar does not
double in size: far out, a real calendar is nearly empty.

The density DECREASES with distance (see DENSITE), and that is not a trick: a
real calendar is nearly full next week and nearly empty in three months. Two
benefits at once — the 30- and 90-day windows finally have material, and
distant free slots abound, which is exactly what a freed-slot campaign is
looking for.

⚠ THREE FAMILIES OF EVENT, ON PURPOSE. A real calendar is not homogeneous, and
the import must be shown on all three cases: · a number in the DESCRIPTION →
the contact arrives with their phone; · no number → they arrive `without a
number`, to be completed (a real case, and the interface has a page for it); ·
a name ALREADY in the address book, with THEIR number → they are recognised on
the name + number pair, and nothing is duplicated.
"""

import collections
import datetime

from . import horaires, jeu_essai

# ------------------------------------------------------------- THE FALLBACK
# What is used ONLY when no opening hours are configured. It is not a guessed
# value: it is an acknowledged sample, and the screen says it is one (see
# `repli` in the return of `plan`).
PAS_REPLI = 30  # half an hour
PLAGES_REPLI = ((9 * 60, 12 * 60 + 30), (14 * 60, 18 * 60 + 30))
JOURS_REPLI = (0, 1, 2, 3, 4)  # Monday to Friday

# ------------------------------------------------------- WHAT WE AIM FOR THE
# SPAN, in days, and it is the SPAN that decides. A hundred, because the list
# rule offers `up to 90 days after the slot`: a sample that stops before makes
# that option indistinguishable from `no limit`. See the header.
JOURS_COUVERTS = 180
# THE FLOOR, in number of appointments. `A good hundred`, says the original
# request. It NEVER lengthens the span — a sample spreading over a year to
# reach its count would no longer look like a calendar. If it is not reached at
# the normal density, ALL the free slots of the hundred days are taken; and if
# that is still not enough, then the practice has a narrow typical week — its
# calendar is small, and saying so is better than stretching it.
CIBLE = 100
# THE DENSITY, BY TIER: (up to D days, one slot in N is taken). Nearly full
# next week, nearly empty in three months — that is what a real calendar does,
# and that is what leaves free slots far out.
DENSITE = ((21, 2), (45, 5), (70, 10), (110, 20), (JOURS_COUVERTS, 30))
# What applies beyond the last tier, when we carry on to reach the floor: the
# lowest density, the one of the far end.
UNE_PLACE_SUR = DENSITE[-1][1]

MOTIFS = (
    "Séance de kinésithérapie", "Bilan initial", "Rééducation du genou",
    "Suivi post-opératoire", "Massage thérapeutique", "Rééducation de l'épaule",
    "Séance de groupe", "Contrôle annuel", "Drainage lymphatique",
    "Rééducation du dos",
)

# Identities that are NOT in the address book: they arrive through the
# calendar, which is the commonest case of a first import.  ⚠ TWO DISJOINT
# GROUPS, AND ONE NUMBER PER PERSON. The first version had the same name appear
# sometimes with a number, sometimes without, and gave them a DIFFERENT number
# at each appointment: the import then created eight records for the same
# person — measured, five names in eight copies. A real calendar does not do
# that, and the product should not have to defend itself against it.  ⚠ AND THE
# NUMBERLESS CASE HAS BECOME RARE (11/08/2026). THE DEFECT, MEASURED IN THE
# OWNER'S REAL DATABASE: the imported calendar had put 32 people there WITHOUT
# a number against 8 with. A contact with no number cannot be called — so his
# freed-slot campaign found only 7 people, whatever the setting. He hunted for
# the cause four times in a row, and it was here.  The `no number` case must
# EXIST — it is a real calendar case, and the product has a screen for it. But
# it must not be the rule: a sample calendar exists to run campaigns, therefore
# to call people. One person in ten, from now on (see `famille` in
# `rendezvous`). ⚠ ONE PERSON = ONE APPOINTMENT (14/08/2026). Owner's request,
# word for word: `it has to be a list of names only, otherwise the tests become
# simply impossible`. He was right, and it was measurable: the thirty names
# below went round in a loop over six hundred and thirty appointments — SIX
# appointments per person on average, seventeen for the busiest. Impossible to
# follow anything: the same person appeared in the call list, in the schedule,
# in the change log, on different dates, and you no longer knew what you were
# looking at.  Six hundred names cannot be written by hand. They are COMPOSED:
# each first name in PRENOMS married to each surname in FAMILLES makes an
# identity, and the walk is deterministic (see `_identite`). Thirty-six first
# names × twenty-one surnames = 756 distinct people, ample to cover a hundred
# days of calendar without ever repeating anyone.
PRENOMS = (
    ("Mme", "Sylvie"), ("M.", "Damien"), ("Mme", "Aïcha"), ("M.", "Hugo"),
    ("Mme", "Patricia"), ("M.", "Étienne"), ("Mme", "Fatou"), ("M.", "Bernard"),
    ("Mme", "Christelle"), ("M.", "Nicolas"), ("Mme", "Farida"),
    ("M.", "Thibault"), ("Mme", "Céline"), ("M.", "Antoine"), ("Mme", "Muriel"),
    ("M.", "Philippe"), ("Mme", "Aurore"), ("M.", "Sylvain"), ("Mme", "Nadège"),
    ("M.", "Kevin"), ("Mme", "Isabelle"), ("M.", "Romain"), ("Mme", "Sophie"),
    ("M.", "Laurent"), ("Mme", "Émilie"), ("M.", "Cédric"), ("Mme", "Valérie"),
    ("M.", "Guillaume"), ("Mme", "Sabrina"), ("M.", "Vincent"),
    ("Mme", "Chloé"), ("M.", "Yann"), ("Mme", "Sabine"), ("M.", "Ousmane"),
    ("Mme", "Roselyne"), ("M.", "Anselme"),
)
FAMILLES = (
    "Marchand", "Roussel", "Belkacem", "Lemoine", "Vasseur", "Cordier",
    "Diallo", "Aubry", "Payet", "Berger", "Amrani", "Rousseau", "Marchetti",
    "Lefranc", "Cazenave", "Dubreuil", "Vidal", "Perrier", "Toussaint",
    "Marchal", "Faure",
)


# ⚠ THE ENDINGS THE SAMPLE FORBIDS ITSELF (14/08/2026). The simulator RESERVES
# endings 51 to 59: a number ending there DEMANDS its outcome (see
# calle_client.TERMINAISONS_FORCEES), and `59` demands the worst — the agent
# returns nothing readable, and the campaign is PAUSED, by design.  THE DEFECT,
# MEASURED IN THE OWNER'S DATABASE: raising AVEC_NUMERO from 8 to 30 names made
# the formula `40 + rank` produce 40 … 69 — hence 51 to 59 along the way. His
# 30-contact campaign received, in its first five calls, a `57` (refuses and
# 🚫), a `58` (polite refusal), a `52` (refuses) and a `59`: five calls, one
# slot filled, then PAUSE. He was expecting thirty calls — he was not wrong,
# and nothing told him.  Those endings must stay in the HANDS of whoever is
# testing: they type a number ending in 59 when they WANT to see that case. The
# sample never draws them.
FINS_RESERVEES = tuple(f"{n:02d}" for n in range(51, 60))
# The 81 remaining endings — the ones the sample may use.
FINS_SURES = tuple(n for n in range(10, 100) if not 51 <= n <= 59)


def _identite(rang, famille_debut=0):
    """THE person of rank `rang` — never the same one twice.

    Deterministic composition: the first name advances one step per person, the
    surname advances when the first names have been gone through. Since the two
    lists are not the same length, all 756 combinations are walked before one
    is seen again — far beyond the six hundred appointments of a hundred-day
    calendar. See the block above PRENOMS.

    `famille_debut` RESERVES a range of surnames for a family of appointments.
    The numberless ones start from the last: without that, a simple offset
    ended up overlapping the others, and the same person was found with a
    number here and without one there (measured).
    """
    civilite, prenom = PRENOMS[rang % len(PRENOMS)]
    famille = FAMILLES[(famille_debut + rang // len(PRENOMS)) % len(FAMILLES)]
    return f"{civilite} {prenom} {famille}"


def _numero(rang):
    """THE number of the person of rank `rang` — always the same one for them.

    ⚠ NEVER A NUMBER INVENTED AT RANDOM: the six roots are reserved by Arcep
    for audiovisual works, hence safe. An `06 12 34 56 78` could have rung at
    someone's home.

    ⚠ AND IT DEPENDS ON THE PERSON, NOT ON THE APPOINTMENT. A number that
    changed from one appointment to the next caused one record per appointment
    to be created.

    ⚠ AND IT SKIPS THE RESERVED ENDINGS (see FINS_RESERVEES): the simulator
    keeps them to demand a precise outcome, and `59` pauses the campaign.

    ⚠ AND IT HOLDS UP TO EIGHT THOUSAND PEOPLE (14/08/2026). The old formula
    (`40 + rank`) overflowed at the hundredth: it wrote three digits where two
    are needed, and fell back into the reserved endings. The (middle, ending)
    pair is here a bijection of the rank — so two people cannot share a number.
    """
    racine = jeu_essai.RACINES_FICTION[rang % len(jeu_essai.RACINES_FICTION)]
    fin = FINS_SURES[rang % len(FINS_SURES)]
    milieu = 10 + (rang // len(FINS_SURES))
    return f"{racine} {milieu:02d} {fin:02d}"


def _deja_au_carnet():
    """The address-book people the sample may announce: [(name, phone)].

    ⚠ WITH THEIR NUMBER (11/08/2026). This family comes from the address book,
    and the calendar carried only their NAME: when the sample data set is not
    loaded — the case of the owner's real database — the import therefore
    created records WITHOUT a number, unreachable. A calendar export carries
    the phone when it has it; so does this one. The name STAYS recognised, on
    the name + number pair.

    ⚠ AND TWO SORTS OF NAME ARE SET ASIDE (13/08/2026), because they do not
    designate ONE person and ONE number: · the sample data set's namesakes —
    two distinct `M. Jean Martin`, put there on purpose so the screen knows how
    to show them; · the four seed contacts (`jeu_essai.PREMIERS_CONTACTS`),
    which carry three of those names under a DIFFERENT number. Without this
    exclusion, importing the sample created a second record under the same name
    — precisely what this family is supposed to demonstrate we avoid.
    """
    comptes = collections.Counter(nom for nom, _, _ in jeu_essai.CLIENTS)
    amorce = {nom for nom, _, _, _, _, _ in jeu_essai.PREMIERS_CONTACTS}
    return [(nom, telephone) for nom, telephone, _ in jeu_essai.CLIENTS
            if telephone and comptes[nom] == 1 and nom not in amorce]


def _tranches_reglees(preferences):
    """(typical week, step) as they are CONFIGURED, or the fallback. Also returns
    the `this is a fallback` flag.

    The typical week is {day (0=Monday): [(start, end) in minutes]}, as
    `horaires.semaine` returns it — hence already merged and sorted.
    """
    if preferences is not None and horaires.semaine_ouverte(preferences):
        return (horaires.semaine(preferences),
                horaires.pas_minutes(preferences), False)
    repli = {jour: (list(PLAGES_REPLI) if jour in JOURS_REPLI else [])
             for jour in range(7)}
    return repli, PAS_REPLI, True


def _creneaux(periodes, pas):
    """The possible start minutes within those periods, `pas` by `pas`."""
    minutes = []
    for debut, fin in periodes:
        minutes.extend(range(debut, fin, pas))
    return minutes


def une_place_sur(jours_apres_aujourd_hui):
    """The density at this distance: one slot in N is taken. See DENSITE.

    Public because the screen uses it to SAY what it built: a sample whose
    density changes with distance must explain itself, otherwise `250
    appointments` does not say where they are.
    """
    for limite, sur in DENSITE:
        if jours_apres_aujourd_hui <= limite:
            return sur
    return UNE_PLACE_SUR


def plan(maintenant=None, preferences=None, cible=CIBLE):
    """The days to fill: {"jours": [(day, [minutes]), …], "pas", "repli"}.

    ⚠ IT IS HERE, AND NOWHERE ELSE, THAT THE SETTINGS ARE READ. Closed days
    (public holidays, leave) are skipped; days with no open period are skipped
    too. We advance day by day from TOMORROW, and stop at the hundredth — the
    span decides, never the count (see CIBLE).

    The density decreases with distance: see DENSITE and `une_place_sur`. When
    it is not enough to reach the floor, the same walk is done again taking ALL
    the free slots — without ever leaving the hundred days.
    """
    maintenant = maintenant or datetime.datetime.now()
    depart = maintenant.replace(hour=0, minute=0, second=0, microsecond=0)
    semaine, pas, repli = _tranches_reglees(preferences)

    def parcourir(serre):
        """The hundred days, at normal density or taking everything."""
        jours, poses, jour = [], 0, depart + datetime.timedelta(days=1)
        while (jour - depart).days <= JOURS_COUVERTS:
            distance = (jour - depart).days
            periodes = semaine.get(jour.weekday()) or []
            ferme = (preferences is not None and not repli
                     and horaires.est_ferme(preferences, jour.date()))
            if periodes and not ferme:
                pris = 1 if serre else une_place_sur(distance)
                creneaux = _creneaux(periodes, pas)[::pris]
                if creneaux:
                    jours.append((jour, creneaux))
                    poses += len(creneaux)
            jour += datetime.timedelta(days=1)
        return jours, poses

    jours, poses = parcourir(serre=False)
    if poses < cible:
        jours, _ = parcourir(serre=True)
    return {"jours": jours, "pas": pas, "repli": repli}


def _echapper(texte):
    """The iCalendar escaping: comma, semicolon, backslash and newline."""
    return (texte.replace("\\", "\\\\").replace(";", "\\;")
            .replace(",", "\\,").replace("\n", "\\n"))


def rendezvous(maintenant=None, preferences=None, cible=CIBLE):
    """The list of the sample's appointments: [(start, length, name, reason,
    phone)].

    Deterministic from `maintenant` AND the settings: two calls on the same
    day, on the same hours, give the same calendar. Nothing is drawn at random
    — a sample that changed at every opening would be impossible to describe in
    documentation.

    `preferences`: the practice's settings. Without them (or with no opening
    hours configured), the fallback windows are used — see `plan`.
    """
    detail = plan(maintenant, preferences, cible)
    pas = detail["pas"]
    connus = _deja_au_carnet()
    # ⚠ ONE COUNTER PER FAMILY, NOT THE RANK (13/08/2026). The index was `rang
    # % len(…)`: since a family only takes every other rank, EVEN ranks taken
    # modulo an EVEN-sized list only land on even indices — half the identities
    # were never used. Measured: 55 distinct people where the list offered 88.
    # A counter of its own for each family walks them all, in order.
    tirage = {"sans": 0, "avec": 0, "connu": 0}
    # ⚠ AND THE ADDRESS-BOOK PEOPLE DO NOT COME BACK EITHER. There are few of
    # them (the sample data set has a few dozen): once the list is exhausted,
    # we carry on with composed identities rather than starting again at the
    # first and giving them an eighth appointment.
    liste, rang = [], 0
    for jour, creneaux in detail["jours"]:
        for indice, minute in enumerate(creneaux):
            debut = jour + datetime.timedelta(minutes=minute)
            # One appointment in five is TWICE AS LONG: a real calendar is not
            # homogeneous. It eats the space left free after it — never another
            # appointment's, and never beyond the day's last slot.
            double = rang % 5 == 0 and indice + 1 < len(creneaux)
            duree = pas * (2 if double else 1)
            # ⚠ THREE FAMILIES, AND AN IDENTITY BELONGS TO ONLY ONE. Mixing the
            # first two caused eight records to be created for the same person.
            # ⚠ THE PROPORTIONS CHANGED ON 11/08/2026: the numberless case was
            # ONE IN THREE, and a contact with no number cannot be called. In
            # the owner's real database, the imported calendar had thus put 32
            # unreachable people against 8 reachable — and his campaign found
            # only 7 people. The case remains, in its rightful place: one in
            # ten.
            if rang % 10 == 0:
                # Without a number: they will arrive `à compléter`, and that is
                # intended. Their surnames are RESERVED (the last three): the
                # same person therefore cannot be here without a number and
                # elsewhere with one.
                nom = _identite(tirage["sans"],
                                famille_debut=len(FAMILLES) - 3)
                telephone = ""
                tirage["sans"] += 1
            elif tirage["connu"] < len(connus) and rang % 7 == 3:
                # Already in the address book: recognised, nothing duplicated.
                # Each one only once — the list is short, it is not looped
                # over.
                nom, telephone = connus[tirage["connu"]]
                tirage["connu"] += 1
            else:
                nom, telephone = (_identite(tirage["avec"]),
                                  _numero(tirage["avec"]))
                tirage["avec"] += 1
            liste.append((debut, duree, nom,
                          MOTIFS[rang % len(MOTIFS)], telephone))
            rang += 1
    return liste


def agenda_ics(maintenant=None, preferences=None, cible=CIBLE):
    """The complete ICS file, as text — ready to be downloaded.

    The shape follows that of a Google Calendar export, because that is the one
    people have to hand: VTIMEZONE Europe/Paris, DTSTART with TZID, explicit
    DTEND, DESCRIPTION carrying the phone when there is one.
    """
    maintenant = maintenant or datetime.datetime.now()
    lignes = [
        "BEGIN:VCALENDAR",
        "PRODID:-//RingBack//Agenda d'exemple//FR",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_echapper(jeu_essai.NOM_METIER)} — exemple RingBack",
        "X-WR-TIMEZONE:Europe/Paris",
        "X-WR-CALDESC:Agenda d'exemple engendré par RingBack — données "
        "ENTIÈREMENT FICTIVES\\, numéros réservés à la fiction (Arcep).",
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Paris",
        "X-LIC-LOCATION:Europe/Paris",
        "BEGIN:DAYLIGHT",
        "TZOFFSETFROM:+0100",
        "TZOFFSETTO:+0200",
        "TZNAME:CEST",
        "DTSTART:19700329T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:+0200",
        "TZOFFSETTO:+0100",
        "TZNAME:CET",
        "DTSTART:19701025T030000",
        "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]
    horodatage = maintenant.strftime("%Y%m%dT%H%M%SZ")
    for rang, (debut, duree, nom, motif, telephone) in enumerate(
            rendezvous(maintenant, preferences, cible), start=1):
        fin = debut + datetime.timedelta(minutes=duree)
        description = ("Rendez-vous d'exemple (fiction).")
        if telephone:
            # ⚠ THE LABEL MATTERS: the ICS reader only takes a number when it
            # is announced (see ics._numero_dans_texte). A bare number in a
            # description looks too much like a file reference.
            description = f"Tél : {telephone}\\n" + description
        lignes.extend([
            "BEGIN:VEVENT",
            f"UID:ringback-exemple-{rang}-{debut:%Y%m%d%H%M}@ringback.local",
            f"DTSTAMP:{horodatage}",
            f"DTSTART;TZID=Europe/Paris:{debut:%Y%m%dT%H%M%S}",
            f"DTEND;TZID=Europe/Paris:{fin:%Y%m%dT%H%M%S}",
            f"SUMMARY:{_echapper(nom)} — {_echapper(motif)}",
            f"DESCRIPTION:{description}",
            "STATUS:CONFIRMED",
            "END:VEVENT",
        ])
    lignes.append("END:VCALENDAR")
    # iCalendar line endings are CRLF, and the file ends with one.
    return "\r\n".join(lignes) + "\r\n"
