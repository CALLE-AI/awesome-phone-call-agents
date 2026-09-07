"""Opening hours: typical week, closed days, slots and free openings.

The principle, in one sentence: **what can be offered is COMPUTED** — it is
what is open, minus what is already taken, minus the closed days.

The three settings (the donnees/preferences.json file, like the rest):

- `average length of an appointment` (the STEP, 15 minutes by default): it is the unit of division. A day is a run of SLOTS of that length; an appointment occupies one slot by default, more when it is longer (30 minutes = 2 slots of 15);
- the TYPICAL WEEK: for each of the seven days, the open periods, in minutes from midnight ({0: [(540, 720)]} = Monday 9am→12pm). Monday = 0, as in datetime.date.weekday();
- the exceptional CLOSED DAYS: dates where nothing is possible even though the typical week is open (a public holiday, leave, training).

This module also computes the French PUBLIC HOLIDAYS (Easter included, with no
external library) — but it NEVER adds them by itself: it OFFERS them, adding
stays the user's gesture (⚙ Réglages).

Nothing is invented: an offered slot is a genuinely open slot, genuinely free,
on a genuinely open day. Slots added by hand (the special case: `exceptionally,
I can see people on Saturday`) are kept as they stand and flagged as such —
input is never silently lost.
"""

import datetime
import logging

from . import db, themes
from . import langue as mod_langue

journal = logging.getLogger("ringback.horaires")

# ------------------------------------------------------------ setting keys
CLE_PAS = "pas_minutes"  # average length of an appointment, in minutes
CLE_SEMAINE = "semaine_type"  # {day (0=Monday): [[start, end] in minutes]}
CLE_FERMES = "jours_fermes"      # [{"date": "AAAA-MM-JJ", "libelle": "…"}]
CLE_DERNIER_IMPORT = "dernier_import_agenda"  # trace of the last imported file
CLE_SEUIL_REMPLACEMENT = "seuil_remplacement_heures"  # the 12-hour threshold

PAS_DEFAUT = 15
PAS_MINIMUM = 5
PAS_MAXIMUM = 240

# THE REPLACEMENT THRESHOLD, in hours — the owner's value, not an invention:
# `if the appointment is more than 12 h away, we offer the operator in the
# summary to start a freed-slot campaign to make up for the absence; if it is <
# 12 h then we leave it as cancelled and state that under these conditions we
# cannot arrange a replacement`. Configurable in `⚙ Réglages`.
SEUIL_REMPLACEMENT_DEFAUT = 12
SEUIL_REMPLACEMENT_MINIMUM = 0
SEUIL_REMPLACEMENT_MAXIMUM = 168  # one week: beyond that, nothing would remain
                                   # jamais compensable

# Horizon for computing offerable slots (in days): beyond it, nobody books over
# the phone `for the slot that has come free`.
HORIZON_JOURS = 21

# Standard make-up delay (in days): the distance at which the product offers a
# slot when it has NO opening hours to compute one from (it is the agent's
# historic convention — `I can offer you a new slot next week`). It is used
# ONLY in that case; as soon as a typical week is configured, the slots come
# from creneaux_proposables.
RATTRAPAGE_JOURS = 7

# Displayed span of the calendar, widened when the typical week overflows it.
AFFICHAGE_DEBUT = 7 * 60
AFFICHAGE_FIN = 20 * 60

# ⚠ TAKEN FROM `themes`, NOT COPIED (24/08/2026). The day names now live there
# alongside the month names, which the date spoken on the phone needs. Two
# lists would be two truths — and that is how a day ends up being called
# something else from one screen to the next. `horaires.JOURS` stays the name
# the whole product uses: nothing to rewrite elsewhere.
JOURS = themes.JOURS

# Statuses that really OCCUPY a slot. A cancelled, moved, ignored or deleted
# appointment frees its slot: that is the whole point of the computation.
STATUTS_OCCUPANTS = ("prévu", "confirmé")


# ------------------------------------------------- cancelling: the rule, here
def seuil_remplacement(preferences):
    """The configured replacement threshold, in hours (12 by default)."""
    if preferences is None:
        return SEUIL_REMPLACEMENT_DEFAUT
    try:
        seuil = int(preferences.obtenir(CLE_SEUIL_REMPLACEMENT))
    except (TypeError, ValueError):
        return SEUIL_REMPLACEMENT_DEFAUT
    if seuil < SEUIL_REMPLACEMENT_MINIMUM or seuil > SEUIL_REMPLACEMENT_MAXIMUM:
        return SEUIL_REMPLACEMENT_DEFAUT
    return seuil


def valider_seuil_remplacement(brut):
    """Validates the threshold typed in; raises ValueError with the expected
    format in clear.
    """
    texte = (str(brut) if brut is not None else "").strip()
    try:
        seuil = int(texte)
    except ValueError:
        raise ValueError(
            f"Seuil de remplacement refusé : « {texte} » — attendu un nombre "
            f"entier d'heures entre {SEUIL_REMPLACEMENT_MINIMUM} et "
            f"{SEUIL_REMPLACEMENT_MAXIMUM}, par exemple "
            f"{SEUIL_REMPLACEMENT_DEFAUT}.") from None
    if seuil < SEUIL_REMPLACEMENT_MINIMUM or seuil > SEUIL_REMPLACEMENT_MAXIMUM:
        raise ValueError(
            f"Seuil de remplacement refusé : {seuil} h — attendu entre "
            f"{SEUIL_REMPLACEMENT_MINIMUM} et {SEUIL_REMPLACEMENT_MAXIMUM} "
            f"heures (par défaut {SEUIL_REMPLACEMENT_DEFAUT}).")
    return seuil


def decision_annulation(preferences, horaire, maintenant=None):
    """THE owner's cancellation rule, held in ONE SINGLE place.

    Returns a dictionary, never a bare status, because the screen needs to say WHY:
    - `statut`      : what is written on the appointment — db.STATUT_SUPPRIME or `annulé`;
    - `compensable` : can a campaign still be set up to fill the slot? (that is what triggers the offer);
    - `seuil`       : the configured threshold, in hours;
    - `heures`      : how many hours separate us from the appointment (None when the date is unreadable);
    - `pourquoi`    : the sentence to display, in French, as it stands.

    The three cases, word for word from the rule of 31/07/2026:
    1. date in the PAST → `annulé`. It is the HISTORY status: `annulé is for past dates`. Nothing to make up for, it is behind us;
    2. date ahead, MORE than `seuil` hours away → `supprimé`: the appointment no longer exists, its slot becomes free again, and the operator is OFFERED a `créneau libéré` campaign to make up for the absence;
    3. date ahead, LESS than `seuil` hours away → `annulé`, and the screen says a replacement cannot be arranged under these conditions — the operator remains free to do it by hand.
    """
    seuil = seuil_remplacement(preferences)
    if maintenant is None:
        maintenant = datetime.datetime.now()
    maintenant = maintenant.replace(second=0, microsecond=0)
    try:
        quand = datetime.datetime.fromisoformat(horaire)
    except (TypeError, ValueError):
        # Unreadable date: we claim to guess nothing, it is `annulé`.
        return {"statut": "annulé", "compensable": False, "seuil": seuil,
                "heures": None,
                "pourquoi": "la date de ce rendez-vous est illisible : il "
                            "reste marqué « annulé », rien n'a été supprimé."}
    heures = (quand - maintenant).total_seconds() / 3600
    if heures <= 0:
        return {"statut": "annulé", "compensable": False, "seuil": seuil,
                "heures": heures,
                "pourquoi": "ce rendez-vous est déjà passé : « annulé » est "
                            "le statut d'histoire, il garde la trace de ce "
                            "qui n'a pas eu lieu."}
    if heures >= seuil:
        return {"statut": db.STATUT_SUPPRIME, "compensable": True,
                "seuil": seuil, "heures": heures,
                "pourquoi": f"ce rendez-vous était dans plus de {seuil} h : "
                            "il est supprimé, sa place redevient libre et "
                            "peut être proposée à quelqu'un d'autre."}
    return {"statut": "annulé", "compensable": False, "seuil": seuil,
            "heures": heures,
            "pourquoi": f"ce rendez-vous est dans moins de {seuil} h : il "
                        "reste marqué « annulé ». Trop tard pour organiser "
                        "un remplacement automatiquement — vous pouvez "
                        "toujours le faire à la main."}


def genre_de_retrait(statut):
    """The kind of change-log row matching the status ACTUALLY written.

    ⚠ THE WORD FOLLOWS THE STATE — that was defect no. 5 of 18/08/2026. The
    change log wrote `➖ Rendez-vous supprimé` in ALL cancellation cases,
    including when the product had just written `annulé`. Measured over his
    day: the same row carried `supprimé` in the CHANGE column and `it stays
    marked « annulé »` in the WHY column, and the exported CSV said the same.
    Three words for one event, in the very document whose whole purpose is to
    be RETYPED into another program.

    And it is not only a matter of vocabulary: the two states do not call for the same gesture (see `decision_annulation` just above).
    - `supprimé`: the appointment no longer exists, its slot becomes free again — there is a slot to reopen in the establishment's software;
    - `annulé`  : the slot stays blocked, too late to arrange a replacement (or the date is already past).
    Reporting `supprimé` where the product wrote `annulé` means having a slot reopened that is not.

    ⚠ THIS RULE LIVES HERE, beside the one that decides the status: three
    places write a removal row into the change log (an assistant campaign, the
    slot given back by a cascade, the transcription of a direct cascade).
    Written in one of them, it would have been missing from the other two — the
    kind of half-correction that brings the same defect back under another
    name.

    Both kinds have existed since 17/08/2026 (see assistant.GENRES_CHANGEMENT);
    only one path wrote `annulation`.
    """
    return "suppression" if statut == db.STATUT_SUPPRIME else "annulation"


# --------------------------------------------------------------------- the
# step
def pas_minutes(preferences):
    """The average length of an appointment, in minutes (15 by default).

    ⚠ `preferences` MAY BE None (10/08/2026), as for `seuil_remplacement`: `no
    settings` means `the default values`. Without that, every caller had to
    write the fallback themselves — and whoever forgot got a `NoneType has no
    attribute obtenir` while importing a file, a long way from the cause.
    """
    if preferences is None:
        return PAS_DEFAUT
    brut = preferences.obtenir(CLE_PAS)
    try:
        pas = int(brut)
    except (TypeError, ValueError):
        return PAS_DEFAUT
    if pas < PAS_MINIMUM or pas > PAS_MAXIMUM:
        return PAS_DEFAUT
    return pas


def valider_pas(texte):
    """Returns the validated step (an integer), or raises ValueError with a French
    message.
    """
    brut = (texte or "").strip()
    if not brut.isdigit():
        raise ValueError(
            "Durée moyenne d'un rendez-vous : attendu un nombre entier de "
            f"minutes entre {PAS_MINIMUM} et {PAS_MAXIMUM} (reçu « {brut} »).")
    pas = int(brut)
    if pas < PAS_MINIMUM or pas > PAS_MAXIMUM:
        raise ValueError(
            f"Durée moyenne d'un rendez-vous : {pas} minutes est hors des "
            f"bornes {PAS_MINIMUM} à {PAS_MAXIMUM} minutes.")
    return pas


def heure_lisible(minutes):
    """540 becomes `9h00` (French time, no leading zero)."""
    return f"{minutes // 60}h{minutes % 60:02d}"


def heure_hhmm(minutes):
    """540 becomes `09:00` — the format of <input type="time"> fields."""
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def minutes_depuis_hhmm(texte):
    """`09:00` becomes 540; raises ValueError (French message) otherwise."""
    brut = (texte or "").strip()
    morceaux = brut.split(":")
    if len(morceaux) != 2 or not all(m.isdigit() for m in morceaux):
        raise ValueError(f"Heure illisible : « {brut} » (attendu HH:MM, "
                         "par exemple 09:00).")
    heures, minutes = int(morceaux[0]), int(morceaux[1])
    if heures > 24 or minutes > 59 or heures * 60 + minutes > 24 * 60:
        raise ValueError(f"Heure hors de la journée : « {brut} » "
                         "(attendu entre 00:00 et 24:00).")
    return heures * 60 + minutes


def duree_lisible(minutes):
    """90 devient « 1 h 30 » ; 30 devient « 30 minutes »."""
    if minutes < 60:
        return f"{minutes} minutes"
    heures, reste = divmod(minutes, 60)
    return f"{heures} h" if reste == 0 else f"{heures} h {reste:02d}"


def tranches_lisibles(nombre, pas):
    """`2 slots of 15 min (30 minutes)` — always says both."""
    unite = "tranche" if nombre <= 1 else "tranches"
    return (f"{nombre} {unite} de {pas} min "
            f"({duree_lisible(nombre * pas)})")


# ------------------------------------------------------------- semaine type
def semaine(preferences):
    """The configured typical week: {day (0=Monday): [(start, end) in minutes]}.

    Always all seven days (an empty list = a closed day), with periods merged
    and sorted. A damaged setting (a file edited by hand) is ignored silently
    rather than breaking the screen.
    """
    brut = preferences.obtenir(CLE_SEMAINE) or {}
    resultat = {jour: [] for jour in range(7)}
    if not isinstance(brut, dict):
        return resultat
    for cle, periodes in brut.items():
        try:
            jour = int(cle)
        except (TypeError, ValueError):
            continue
        if jour not in resultat or not isinstance(periodes, (list, tuple)):
            continue
        propres = []
        for periode in periodes:
            if not isinstance(periode, (list, tuple)) or len(periode) != 2:
                continue
            try:
                debut, fin = int(periode[0]), int(periode[1])
            except (TypeError, ValueError):
                continue
            if 0 <= debut < fin <= 24 * 60:
                propres.append((debut, fin))
        resultat[jour] = _fusionner(propres)
    return resultat


def definir_semaine(preferences, valeur):
    """Saves the typical week (empty days are not stored)."""
    a_ecrire = {str(jour): [[d, f] for d, f in periodes]
                for jour, periodes in sorted(valeur.items()) if periodes}
    preferences.definir(CLE_SEMAINE, a_ecrire)


def _fusionner(periodes):
    """Sorts and merges the periods that touch or overlap."""
    fusionnees = []
    for debut, fin in sorted(periodes):
        if fusionnees and debut <= fusionnees[-1][1]:
            fusionnees[-1] = (fusionnees[-1][0], max(fusionnees[-1][1], fin))
        else:
            fusionnees.append((debut, fin))
    return fusionnees


def _retirer(periodes, debut, fin):
    """Removes [start, end) from the open periods (the hole is really closed).
    """
    restantes = []
    for periode_debut, periode_fin in periodes:
        if periode_fin <= debut or periode_debut >= fin:
            restantes.append((periode_debut, periode_fin))
            continue
        if periode_debut < debut:
            restantes.append((periode_debut, debut))
        if periode_fin > fin:
            restantes.append((fin, periode_fin))
    return restantes


def periode_ouverte(periodes, debut, fin):
    """True when the WHOLE interval [start, end) is already open."""
    for periode_debut, periode_fin in periodes:
        if periode_debut <= debut and periode_fin >= fin:
            return True
    return False


def basculer_periode(preferences, jour, debut, fin, geste="basculer"):
    """Opens, closes or TOGGLES a period of the typical week.

    geste: `ouvrir`, `fermer`, or `basculer` (the drag-and-release — a period
    already entirely open closes again). The bounds are aligned on the slot
    grid: you press on one slot, release on another, and the period runs from
    the start of the first to the end of the last. Returns True when the period
    is open at the end. Raises ValueError (French message) when the day or the
    times are out of bounds — faulty input is never saved silently.
    """
    if jour not in range(7):
        raise ValueError(f"Jour inconnu : « {jour} » (attendu 0 = lundi à "
                         "6 = dimanche).")
    pas = pas_minutes(preferences)
    debut, fin = min(debut, fin), max(debut, fin)
    debut = (debut // pas) * pas
    fin = -(-fin // pas) * pas  # rounded up to the next slot
    fin = min(fin, 24 * 60)
    if fin <= debut:
        raise ValueError("Période vide : l'heure de fin doit venir après "
                         f"l'heure de début (reçu {heure_hhmm(debut)} → "
                         f"{heure_hhmm(fin)}).")
    courante = semaine(preferences)
    periodes = courante[jour]
    if geste == "basculer":
        geste = "fermer" if periode_ouverte(periodes, debut, fin) else "ouvrir"
    if geste == "ouvrir":
        courante[jour] = _fusionner(periodes + [(debut, fin)])
        ouverte = True
    elif geste == "fermer":
        courante[jour] = _retirer(periodes, debut, fin)
        ouverte = False
    else:
        raise ValueError(f"Geste inconnu : « {geste} » (attendu « ouvrir », "
                         "« fermer » ou « basculer »).")
    definir_semaine(preferences, courante)
    journal.info("Semaine type : %s %s de %s à %s", JOURS[jour],
                 "ouvert" if ouverte else "fermé",
                 heure_hhmm(debut), heure_hhmm(fin))
    return ouverte


def semaine_ouverte(preferences):
    """True when at least one period is open in the typical week."""
    return any(periodes for periodes in semaine(preferences).values())


def amplitude_affichee(preferences):
    """(start, end) in minutes of the displayed calendar — nothing is hidden.

    The default span (7am→8pm) widens when the typical week overflows it: an
    opening at 6:30am or until 10pm stays visible and editable.
    """
    pas = pas_minutes(preferences)
    debut, fin = AFFICHAGE_DEBUT, AFFICHAGE_FIN
    for periodes in semaine(preferences).values():
        for periode_debut, periode_fin in periodes:
            debut = min(debut, periode_debut)
            fin = max(fin, periode_fin)
    debut = (debut // pas) * pas
    fin = min(-(-fin // pas) * pas, 24 * 60)
    return debut, fin


# ------------------------------------------------------ closed days (dates)
def jours_fermes(preferences):
    """The exceptional closed days: [{"date", "libelle"}], sorted."""
    brut = preferences.obtenir(CLE_FERMES) or []
    fermes = {}
    if not isinstance(brut, (list, tuple)):
        return []
    for entree in brut:
        if isinstance(entree, str):
            date, libelle = entree, ""
        elif isinstance(entree, dict):
            date, libelle = entree.get("date", ""), entree.get("libelle", "")
        else:
            continue
        try:
            datetime.date.fromisoformat(date)
        except (TypeError, ValueError):
            continue
        fermes[date] = libelle or fermes.get(date, "")
    return [{"date": date, "libelle": fermes[date]} for date in sorted(fermes)]


def valider_date(texte):
    """Returns the date as `YYYY-MM-DD`; also accepts `DD/MM/YYYY`."""
    brut = (texte or "").strip()
    if not brut:
        raise ValueError("Date obligatoire : attendu AAAA-MM-JJ "
                         "(par exemple 2026-08-15) ou JJ/MM/AAAA.")
    try:
        return datetime.date.fromisoformat(brut).isoformat()
    except ValueError:
        pass
    try:
        return datetime.datetime.strptime(brut, "%d/%m/%Y").date().isoformat()
    except ValueError:
        raise ValueError(f"Date illisible : « {brut} ». Formats acceptés : "
                         "2026-08-15 ou 15/08/2026.") from None


def ajouter_jour_ferme(preferences, date, libelle=""):
    """Declares a closed day (the user's gesture); returns the date written."""
    date = valider_date(date)
    libelle = " ".join((libelle or "").split())
    fermes = {entree["date"]: entree["libelle"] for entree in
              jours_fermes(preferences)}
    fermes[date] = libelle or fermes.get(date, "")
    preferences.definir(CLE_FERMES,
                        [{"date": jour, "libelle": fermes[jour]}
                         for jour in sorted(fermes)])
    journal.info("Jour fermé déclaré : %s%s", date,
                 f" ({libelle})" if libelle else "")
    return date


def retirer_jour_ferme(preferences, date):
    """Removes a closed day; returns True when it was there."""
    restants = [entree for entree in jours_fermes(preferences)
                if entree["date"] != date]
    retire = len(restants) != len(jours_fermes(preferences))
    preferences.definir(CLE_FERMES, restants)
    return retire


def est_ferme(preferences, jour):
    """The closed day's label when THIS date is closed, otherwise None.

    Returns "" (an empty string, which still means `closed`) when no label was
    given: the calling code tests `is not None`.
    """
    cible = jour.isoformat() if isinstance(jour, (datetime.date,)) else str(jour)
    for entree in jours_fermes(preferences):
        if entree["date"] == cible:
            return entree["libelle"]
    return None


# ------------------------------------------ trace of the last calendar import
# What it is for: before starting a campaign, RingBack points out that the
# slots offered on the phone come out of ITS calendar. `How long since this
# calendar was last fed?` is the most useful fact of that reminder — provided
# it was recorded. ONLY inputs by FILE are recorded (ICS calendar, CSV file):
# they are the only ones we can call `the calendar was reloaded`. Typing by
# hand does not count here, and until something has been imported the date
# stays frankly UNKNOWN — never replaced by an invented value.
def noter_import_agenda(preferences, quoi, rendezvous, quand=None):
    """Records that a file has just fed the calendar; returns the trace written.
    """
    moment = (quand or datetime.datetime.now()).replace(second=0, microsecond=0)
    trace = {"quand": moment.isoformat(timespec="minutes"),
             "quoi": str(quoi),
             "rendezvous": int(rendezvous or 0)}
    preferences.definir(CLE_DERNIER_IMPORT, trace)
    journal.info("Import d'agenda noté : %s, %d rendez-vous, le %s",
                 trace["quoi"], trace["rendezvous"], trace["quand"])
    return trace


def dernier_import_agenda(preferences):
    """The trace of the last import, or None when NONE was ever recorded.

    Returns {"quand" (ISO), "quoi", "rendezvous", "moment" (datetime)}. A
    damaged trace (a settings file edited by hand) is treated as absent: better
    `unknown` than a wrong date.
    """
    brut = preferences.obtenir(CLE_DERNIER_IMPORT)
    if not isinstance(brut, dict):
        return None
    try:
        moment = datetime.datetime.fromisoformat(brut.get("quand") or "")
    except (TypeError, ValueError):
        return None
    return {"quand": brut["quand"], "quoi": str(brut.get("quoi") or ""),
            "rendezvous": brut.get("rendezvous"), "moment": moment}


# ------------------------------------------------- public holidays (offer)
def paques(annee):
    """Easter Sunday of THIS year (Gregorian calendar).

    The so-called `Butcher / Meeus` algorithm: pure arithmetic, hence no
    external library — the project's constraint is held.
    """
    a = annee % 19
    b, c = divmod(annee, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mois, jour = divmod(h + l - 7 * m + 114, 31)
    return datetime.date(annee, mois, jour + 1)


def feries(annee):
    """The eleven French public holidays of a year: [(date, name)], sorted.

    These are the holidays of metropolitan France (Alsace-Moselle and the
    overseas territories have more). RingBack NEVER adds them by itself: it
    offers them, one by one, in ⚙ Réglages.
    """
    dimanche = paques(annee)
    liste = [
        (datetime.date(annee, 1, 1), "Jour de l'an"),
        (dimanche + datetime.timedelta(days=1), "Lundi de Pâques"),
        (datetime.date(annee, 5, 1), "Fête du Travail"),
        (datetime.date(annee, 5, 8), "Victoire 1945"),
        (dimanche + datetime.timedelta(days=39), "Ascension"),
        (dimanche + datetime.timedelta(days=50), "Lundi de Pentecôte"),
        (datetime.date(annee, 7, 14), "Fête nationale"),
        (datetime.date(annee, 8, 15), "Assomption"),
        (datetime.date(annee, 11, 1), "Toussaint"),
        (datetime.date(annee, 11, 11), "Armistice 1918"),
        (datetime.date(annee, 12, 25), "Noël"),
    ]
    return sorted(liste)


def feries_a_proposer(preferences, depuis=None, jusqu_a_mois=12):
    """The public holidays still AHEAD and not declared: [{"date", "nom",
    "deja"}].

    Covers the coming twelve months (two calendar years when needed). `deja`
    says it is already declared closed — the screen shows it greyed out rather
    than offering it a second time.
    """
    if depuis is None:
        depuis = datetime.date.today()
    fin = depuis + datetime.timedelta(days=31 * jusqu_a_mois)
    declares = {entree["date"] for entree in jours_fermes(preferences)}
    proposition = []
    for annee in range(depuis.year, fin.year + 1):
        for date, nom in feries(annee):
            if depuis <= date <= fin:
                proposition.append({"date": date.isoformat(), "nom": nom,
                                    "deja": date.isoformat() in declares})
    return proposition


# ----------------------------------------------------- slots of a day
def tranches_du_jour(preferences, jour):
    """The starts of this date's OPEN slots: [datetime], sorted.

    A slot counts as open only when it is ENTIRELY covered by a period of the
    typical week (a 15-minute opening does not make a 30-minute slot
    available). A closed day returns [].
    """
    if est_ferme(preferences, jour) is not None:
        return []
    pas = pas_minutes(preferences)
    debuts = []
    for debut, fin in semaine(preferences)[jour.weekday()]:
        premiere = -(-debut // pas) * pas
        while premiere + pas <= fin:
            debuts.append(datetime.datetime.combine(jour, datetime.time())
                          + datetime.timedelta(minutes=premiere))
            premiere += pas
    return sorted(debuts)


def tranches_occupees(base, preferences, jour, sauf_rdv=None):
    """The starts of the slots already taken that day (a set of datetime).

    An appointment of N slots occupies N; an appointment whose time does not
    fall exactly on the grid occupies every slot it OVERLAPS (nothing is
    offered `half way`). sauf_rdv: the appointment being moved, which does not
    get in its own way.
    """
    pas = pas_minutes(preferences)
    minuit = datetime.datetime.combine(jour, datetime.time())
    lendemain = minuit + datetime.timedelta(days=1)
    occupees = set()
    for rdv in base.rendezvous_occupants(minuit.isoformat(timespec="minutes"),
                                         lendemain.isoformat(timespec="minutes")):
        if sauf_rdv is not None and rdv["id"] == sauf_rdv:
            continue
        try:
            debut = datetime.datetime.fromisoformat(rdv["horaire"])
        except (TypeError, ValueError):
            continue
        fin = debut + datetime.timedelta(minutes=pas * max(rdv["duree_tranches"], 1))
        # Every slot of the grid this appointment overlaps.
        depart = minuit + datetime.timedelta(
            minutes=(int((debut - minuit).total_seconds() // 60) // pas) * pas)
        while depart < fin:
            occupees.add(depart)
            depart += datetime.timedelta(minutes=pas)
    return occupees


def tranches_libres_du_jour(base, preferences, jour, sauf_rdv=None,
                            depuis=None):
    """The slots of this date that are open AND free: [datetime], sorted."""
    occupees = tranches_occupees(base, preferences, jour, sauf_rdv=sauf_rdv)
    libres = [tranche for tranche in tranches_du_jour(preferences, jour)
              if tranche not in occupees]
    if depuis is not None:
        libres = [tranche for tranche in libres if tranche >= depuis]
    return libres


def suites_libres(tranches, pas):
    """Cuts a list of slots into CONSECUTIVE runs: [[datetime]]."""
    suites, courante = [], []
    for tranche in tranches:
        if courante and tranche - courante[-1] != datetime.timedelta(minutes=pas):
            suites.append(courante)
            courante = []
        courante.append(tranche)
    if courante:
        suites.append(courante)
    return suites


# -------------------------------------------------------- slots to offer
def creneaux_libres(base, preferences, tranches=1, depuis=None,
                    jours=HORIZON_JOURS, limite=None, sauf_rdv=None):
    """The genuinely free slots: open − already taken − closed days.

    tranches: the required length, in CONSECUTIVE slots (a 30-minute
    appointment with a 15-minute step needs 2). The returned slots do not
    overlap each other: within a free run, we advance by the requested length.
    Returns a list of ISO 8601 times to the minute.
    """
    if depuis is None:
        depuis = datetime.datetime.now()
    depuis = depuis.replace(second=0, microsecond=0)
    tranches = max(int(tranches or 1), 1)
    pas = pas_minutes(preferences)
    resultat = []
    for decalage in range(jours + 1):
        jour = (depuis + datetime.timedelta(days=decalage)).date()
        libres = tranches_libres_du_jour(base, preferences, jour,
                                         sauf_rdv=sauf_rdv, depuis=depuis)
        for suite in suites_libres(libres, pas):
            for debut in range(0, len(suite) - tranches + 1, tranches):
                resultat.append(suite[debut].isoformat(timespec="minutes"))
                if limite and len(resultat) >= limite:
                    return resultat
    return resultat


def suites_libres_datees(base, preferences, depuis=None, jours=HORIZON_JOURS,
                         limite=None):
    """The free GAPS in the schedule, one after another.

    An `available slot` in the sense of the `⏭ Prochain créneau disponible`
    button is not an isolated slot but a RUN of free slots in a row: that is
    what you look for when you look for room. Returns [{"debut": datetime,
    "fin": datetime, "tranches": n}], from nearest to furthest.
    """
    if depuis is None:
        depuis = datetime.datetime.now()
    depuis = depuis.replace(second=0, microsecond=0)
    pas = pas_minutes(preferences)
    trous = []
    for decalage in range(jours + 1):
        jour = (depuis + datetime.timedelta(days=decalage)).date()
        libres = tranches_libres_du_jour(base, preferences, jour, depuis=depuis)
        for suite in suites_libres(libres, pas):
            trous.append({
                "debut": suite[0],
                "fin": suite[-1] + datetime.timedelta(minutes=pas),
                "tranches": len(suite)})
            if limite and len(trous) >= limite:
                return trous
    return trous


def creneaux_manuels(preferences):
    """The slots added BY HAND (the special case), sorted.

    They live in the same setting as before opening hours existed
    (themes.CLE_CRENEAUX): a typed list stays valid, it is never erased by the
    computation — it is ADDED to it.
    """
    return sorted(preferences.obtenir(themes.CLE_CRENEAUX) or [])


def plancher_de_proposition(depuis=None):
    """The nearest date we are allowed to offer: TOMORROW, at midnight.

    ⚠ HIS RULE, OF 17/08/2026, word for word: `we must not offer a date on the
    same day (today) but only from tomorrow`. A 5pm slot announced on the phone
    at 4:30pm is not an offer: nobody can organise themselves, and it is the
    practice that will pay for the absence.

    ONE PLACE decides this floor, and everything leading to the phone inherits
    it — including a path written tomorrow. A `depuis` already further out is
    respected: we never bring a search backwards (the cascade asks `from such a
    slot`, and it must stay that way).
    """
    demain = (datetime.date.today() + datetime.timedelta(days=1))
    minuit = datetime.datetime.combine(demain, datetime.time())
    if depuis is None:
        return minuit
    return max(depuis.replace(second=0, microsecond=0), minuit)


def creneaux_proposables(base, preferences, tranches=1, depuis=None,
                         jours=HORIZON_JOURS, limite=None, sauf_rdv=None,
                         avec_les_passes=False):
    """The slots to offer: the computed ones PLUS those added by hand.

    Returns [{"horaire", "origine", "occupe", "passe"}] sorted by time —
    origine is `calculé` or `à la main`. A manual slot already taken by an
    appointment is kept but FLAGGED (occupe = True): the user sees their input
    and what is wrong with it, rather than a silent disappearance.

    ⚠ NEVER A PAST DATE ON THE PHONE (16/08/2026). The COMPUTED slots start
    from `depuis` — so they are ahead by construction. Those added BY HAND,
    though, went in as they stood: a slot typed three weeks ago stayed in the
    list, and since sorting is by time it came FIRST. So that is the one the
    product offered on the phone.

    MEASURED IN HIS DATABASE on 16/08/2026: five manual slots earlier than that
    day, and `creneau_le_plus_proche` returned `le 28/07/2026 à 09h30` — twenty
    days in the past. His appointment was therefore `moved` to that date, where
    it immediately became MISSED. An appointment moved to yesterday is not a
    moved appointment: it is a lost appointment.

    Hence `avec_les_passes`, and its default: NO. Every path leading to the
    phone inherits the safe behaviour without having to think about it —
    including a path written tomorrow. Only the SCREEN that received the input
    asks to see them (Réglages > Agenda), because input must never disappear
    from the screen that received it: it is displayed there marked `passe`, and
    stays deletable. My first fix filtered here without that door, and two of
    the product's tests refused it — they were right.

    ⚠ AND NEVER THE SAME DAY (his request of 17/08/2026): `we must not offer a
    date on the same day but only from tomorrow`. The floor is therefore
    TOMORROW AT MIDNIGHT, not `now`. A 5pm slot offered at 4:30pm by phone
    leaves nobody the time to organise themselves — and it is the practice that
    pays for the absence. See `plancher_de_proposition`, the only place that
    decides this floor.
    """
    plancher_dt = plancher_de_proposition(depuis)
    calcules = creneaux_libres(base, preferences, tranches=tranches,
                               depuis=plancher_dt, jours=jours,
                               sauf_rdv=sauf_rdv)
    proposes = {horaire: {"horaire": horaire, "origine": "calculé",
                          "occupe": False, "passe": False,
                          "aujourdhui": False}
                for horaire in calcules}
    plancher = plancher_dt.isoformat(timespec="minutes")
    maintenant = datetime.datetime.now().isoformat(timespec="minutes")
    for horaire in creneaux_manuels(preferences):
        if horaire in proposes:
            proposes[horaire]["origine"] = "à la main"
            continue
        # TWO DISTINCT REASONS not to offer, and the screen must be able to say
        # WHICH: `the time has passed` and `it is today` are not fixed the same
        # way.
        trop_tot = horaire < plancher
        if trop_tot and not avec_les_passes:
            continue
        proposes[horaire] = {"horaire": horaire, "origine": "à la main",
                             "occupe": _occupe(base, preferences, horaire,
                                               tranches, sauf_rdv),
                             "passe": horaire < maintenant,
                             "aujourdhui": trop_tot and horaire >= maintenant}
    liste = [proposes[horaire] for horaire in sorted(proposes)]
    return liste[:limite] if limite else liste


def _occupe(base, preferences, horaire, tranches, sauf_rdv=None):
    """True when THIS manual slot falls on an appointment already in place."""
    try:
        debut = datetime.datetime.fromisoformat(horaire)
    except (TypeError, ValueError):
        return False
    occupees = tranches_occupees(base, preferences, debut.date(),
                                 sauf_rdv=sauf_rdv)
    pas = pas_minutes(preferences)
    minuit = datetime.datetime.combine(debut.date(), datetime.time())
    depart = minuit + datetime.timedelta(
        minutes=(int((debut - minuit).total_seconds() // 60) // pas) * pas)
    for _ in range(max(int(tranches or 1), 1)):
        if depart in occupees:
            return True
        depart += datetime.timedelta(minutes=pas)
    return False


# Note: `occupants_du_creneau` (who already occupies a given slot) was removed
# on 31/07/2026 along with the first, mistaken reading of §8.3: the cascade no
# longer targets the occupant of a coveted slot, it starts again from the slot
# a client has just FREED. No caller left — hence no dead code.


# ---------------------------------------------------------------------------
# WHAT AN IMPORT REPLACES — `no overlapping possible`
# ---------------------------------------------------------------------------
def remplacer_sur_le_creneau(base, preferences, rendezvous_id, maintenant=None):
    """Removes whatever occupied THIS appointment's slot; returns those removed.

    Owner's rule (10/08/2026): `in every case, the import's new slots replace
    the old ones (no overlapping of appointments possible)`.

    ⚠ NOTHING IS ERASED, and the rule is not rewritten here: every displaced
    appointment goes through `decision_annulation`, the one for removal by hand
    — `annulé` when it is past, `supprimé` when it is ahead. Both give the slot
    back; neither loses the trace.

    ⚠ AND IT IS THE NEW ONE THAT WINS, never the reverse. The import is the
    operator's most recent intention: refusing the imported event would have
    left the calendar in disagreement with the file just loaded, with no screen
    able to say which of the two was right.

    Returns the list of removed appointments, as they were BEFORE the change —
    it is that list which lets the screen say what moved.
    """
    nouveau = base.obtenir_rendezvous(rendezvous_id)
    if nouveau is None:
        return []
    pas = pas_minutes(preferences)
    try:
        debut = datetime.datetime.fromisoformat(nouveau["horaire"])
    except (TypeError, ValueError):
        return []
    fin = debut + datetime.timedelta(
        minutes=pas * max(nouveau["duree_tranches"] or 1, 1))
    retires = []
    # `rendezvous_occupants` returns only `prévu` and `confirmé` — the only
    # ones that occupy — and also looks at the previous day, to catch an
    # appointment started before the window that spills into it.
    for autre in base.rendezvous_occupants(debut.isoformat(timespec="minutes"),
                                           fin.isoformat(timespec="minutes")):
        if autre["id"] == rendezvous_id:
            continue
        try:
            sien = datetime.datetime.fromisoformat(autre["horaire"])
        except (TypeError, ValueError):
            continue
        sa_fin = sien + datetime.timedelta(
            minutes=pas * max(autre["duree_tranches"] or 1, 1))
        if sa_fin <= debut or sien >= fin:
            continue  # they do not overlap
        decision = decision_annulation(preferences, autre["horaire"],
                                       maintenant)
        # ⚠ THE COMPLETE ROW, READ BEFORE THE CHANGE. `rendezvous_occupants`
        # returns only what the slot computation needs — not the contact's name
        # — and the screen must be able to say WHO was moved.
        retires.append(dict(base.obtenir_rendezvous(autre["id"]) or autre,
                            statut_pose=decision["statut"]))
        base.mettre_a_jour_rendezvous(autre["id"], statut=decision["statut"])
        journal.info("Import : rendez-vous n°%d passé « %s » — sa place est "
                     "prise par le n°%d qui vient d'être importé",
                     autre["id"], decision["statut"], rendezvous_id)
    return retires


def vider_l_agenda_a_venir(base, preferences, maintenant=None):
    """`Replace the calendar entirely`: whatever still holds a slot goes.

    ⚠ THE PAST IS NOT TOUCHED. A calendar you replace is what is AHEAD of us;
    what has taken place is history, and an import has no business rewriting
    it. Upcoming appointments that still held a slot become `supprimé` (their
    slot is given back, they stay readable in the archives) — again it is
    `decision_annulation` that writes it.

    Returns the list of removed appointments.
    """
    if maintenant is None:
        maintenant = datetime.datetime.now()
    depart = maintenant.replace(second=0, microsecond=0)
    retires = []
    for rdv in base.rendezvous_occupants(depart.isoformat(timespec="minutes"),
                                         "9999-12-31T23:59"):
        if rdv["horaire"] < depart.isoformat(timespec="minutes"):
            continue  # started before: it is taking place, we do not touch it
        decision = decision_annulation(preferences, rdv["horaire"], maintenant)
        # ⚠ THE COMPLETE ROW, READ BEFORE THE CHANGE. `rendezvous_occupants`
        # returns only what the slot computation needs — not the contact's name
        # — and the screen must be able to say WHO was moved.
        retires.append(dict(base.obtenir_rendezvous(rdv["id"]) or rdv,
                            statut_pose=decision["statut"]))
        base.mettre_a_jour_rendezvous(rdv["id"], statut=decision["statut"])
    if retires:
        journal.info("« Remplacer entièrement l'agenda » : %d rendez-vous à "
                     "venir retirés — rien n'est effacé, tout reste lisible "
                     "dans « Tous les rendez-vous »", len(retires))
    return retires


def creneaux_lisibles(base, preferences, tranches=1, depuis=None, limite=6):
    """The slots to offer, in French: `le 03/08/2026 à 09h00, …`.

    This is the text that fills [créneaux_disponibles] in the missions and
    pre-fills the campaigns. Returns "" when nothing is offerable — the
    variable then stays visible in the text, never replaced by misleading
    emptiness.
    """
    return places_a_proposer(base, preferences, tranches=tranches,
                             depuis=depuis, limite=limite)[0]


# ============================ A STOCK TO NEGOTIATE WITH, NOT A LIST TO RECITE
# His request of 16/08/2026: `automatically choose dates with free slots as
# close as possible, then fill out with dates on every working day + morning
# and afternoon, several of each`.  WHAT `creneaux_lisibles` DID: the SIX first
# free slots. But the first six follow one another — the same morning, often
# the same hour give or take twenty minutes. So the agent had nothing to
# negotiate: `no` on the first meant `no` on all six.  The stock is built in
# two stages, and that is what counts: ① the NEAREST slots, as they stand —
# that is what is offered first, because an appointment moved as early as
# possible causes the least disruption; ② then a SPREAD: a few working days in
# a row, and within each of them slots in the morning AND the afternoon. Enough
# to answer `Tuesday rather` or `the afternoon rather` without calling back.  ⚠
# THIS IS NOT A TEXT TO READ ON THE PHONE. Nobody listens to twenty dates: the
# stock lives in `what you know`, and the opening message names only ONE (see
# `creneau_le_plus_proche` and the kind's conduct).

# ⚠ THESE THREE FIGURES WERE REVISED TOGETHER ON 04/09/2026, at his request and
# on HIS database. The defect he saw: a move campaign with ONE appointment to
# clear offered seven slots, five of them on the same Saturday. `Everything is
# on Saturday when there need to be plenty of different days and morning and
# afternoon.`  Measured on his database before changing anything:  factor  per
# half-day  nearest first │  1 appt     3 appts 7           2                 3
# │  2 days     6 days 10           2                 3        │  3 days     8
# days 10           1                 1        │  5 days    15 days   ← chosen
# ⚠ AND IT IS `PER HALF-DAY` THAT SPREADS, not the factor. Going from 7 to 10
# gained only one day: a working day still gave four slots (two in the morning,
# two in the afternoon), so ten slots still fitted into three days. At one slot
# per half-day, a day gives only two — and ten slots cover five days.  ⚠
# `NEAREST FIRST` NEEDS ONLY ONE SLOT. Three slots taken as they stood fell in
# the same morning (three consecutive twenty-minute slots) and unbalanced
# morning against afternoon. The rule meant `offer the earliest thing first`: a
# single slot is enough to hold it.

PROCHES_DABORD = 1  # THE nearest slot, taken as it stands
JOURS_COUVERTS_NEGO = 5  # distinct working days to cover next
PAR_DEMI_JOURNEE = 1  # ONE slot per half-day: that is what spreads
HEURE_BASCULE_MIDI = 13  # before 1pm = morning, from 1pm = afternoon

# ⚠ THE CHOICE OFFERED FOLLOWS THE NUMBER OF APPOINTMENTS TO MOVE (his request
# of 17/08/2026): `there must be far more possible appointments to move onto
# than appointments to move […] The number must be proportional to the number
# of appointments to move (7 appointments to move, then there are 7 times more
# possibilities)`.  WHY THIS IS NOT A WHIM ABOUT A FIGURE: every yes CONSUMES a
# slot. Over an afternoon of seven people, a stock of twenty slots saw the
# first agreements take the best ones, and the last people called hear a
# distant date offered — or nothing. The stock must last until the last one.
# READING CHOSEN: `proportional` in the strict sense, a CONSTANT factor of
# seven slots per appointment to move. His example gives the same answer under
# both possible readings (7 × 7 = 49); the other — a factor equal to the number
# — would be quadratic, i.e. 900 slots for thirty appointments. A named
# constant: a single figure to change should he want it otherwise.
PAR_RENDEZVOUS_A_DEPLACER = 10

# ⚠ HOW FAR TO LOOK FOR A SLOT — MEASURED IN HIS DATABASE ON 17/08/2026. His
# calendar is FULL over the horizon's 21 days: zero free slots. On the 30th day
# there are 250, on the 45th 662. A move campaign therefore had NOTHING to
# offer — `creneau_le_plus_proche` returned "" — and five of his nine contacts
# ended with no date, `to be called back by a human` or `the client will call
# back`. The message that names a date named none.  Yet a move MUST conclude:
# the practitioner is not there that day, the appointment has to go somewhere.
# Refusing to look beyond three weeks means refusing to move it.  So the near
# ones are kept FIRST — it is better for the client — and we only widen when we
# find nothing. The common case does not cost one extra computation; the case
# of a full calendar stops being a dead end.
HORIZONS_NEGO = (HORIZON_JOURS, 45, 90, 180)


def places_libres_elargies(base, preferences, tranches=1, depuis=None,
                           sauf_places=(), limite=None, sauf_jours=()):
    """The free times, widening the horizon as long as nothing is found.

    ⚠ ONE PLACE ONLY FOR THIS RULE, and that is the whole point of this
    function. My first fix widened it only in the negotiation stock; the
    pre-call check still used the old horizon. Result measured on his database:
    the message duly announced `le 08/09/2026 à 08h40`… and the campaign
    refused to dial, `there is not a single free one left`, for all NINE of his
    contacts. Two computations, two truths — the family of defect that comes
    back most often here.

    ⚠ AND `limite` COUNTS FREE SLOTS, NOT ROWS OF THE LIST (17/08/2026). It was
    the other way round, and it is the costliest defect measured on his
    database: he has 106 slots added by hand, 99 of them ALREADY TAKEN. Since
    sorting is by time, those 99 filled the first six rows; the list announced
    in the message therefore came out EMPTY, while 662 slots were free behind
    them. And it is that empty text the campaign reads back before dialling: it
    concluded `there is not one left` and called nobody. So the taken ones are
    set aside FIRST, and the cut is made SECOND.

    ⚠ `sauf_jours`: THE DAYS BEING EMPTIED, set aside IN FULL (his rule of
    17/08/2026): `it selected slots during the day I want to cancel. It must
    also not select free slots on the day or days where we have the
    cancellation.` It is obvious as soon as it is said: if the practitioner is
    not there that day, no hour of that day is offerable — even ones that never
    carried an appointment. Setting slots aside one by one (`sauf_places`) was
    not enough: it only removed the times of the appointments being moved, and
    left all the gaps of the day around them.
    """
    ecartees = set(sauf_places or ())
    jours_exclus = {jour for jour in (sauf_jours or ()) if jour}
    for jours in HORIZONS_NEGO:
        proposes = creneaux_proposables(base, preferences, tranches=tranches,
                                        depuis=depuis, jours=jours)
        libres = [entree["horaire"] for entree in proposes
                  if not entree["occupe"] and entree["horaire"] not in ecartees
                  and entree["horaire"][:10] not in jours_exclus]
        if libres:
            return libres[:limite] if limite else libres
    return []


# ⚠ A FEW SLOTS TO REPLACE A CANCELLED APPOINTMENT (31/08/2026, his request,
# noted on a REAL call). What went out was the next six free slots — and his
# transcript of 31/08 shows it in plain words:  `Tuesday 1 September 2026 at
# 8:20, Tuesday 1 September 2026 at 9:20, Tuesday 1 September 2026 at 9:40,
# Tuesday 1 September 2026 at 10:20, Tuesday 1 September 2026 at 11, Tuesday 1
# September 2026 at 11:40.`  SIX TIMES THE SAME DAY — and worse, the very day
# of the appointment she had just said she could not attend. `None`, she
# answered.  His rule: `dates on different days, but not too far off (max 7
# days); the morning and the afternoon of the same day suits me too`.  ⚠ THIS
# IS NOT `places_negociables`, and that is deliberate. That one builds the
# STOCK of a move negotiation: it aims at several dozen slots and spreads over
# weeks. Here dates are quoted OUT LOUD, one by one: beyond a handful, nobody
# listens.  ⚠ THEY ARE FREE BY CONSTRUCTION: `places_libres_elargies` sets the
# taken ones aside BEFORE cutting (that is the 17/08 defect, fixed over there),
# and the recomputation at call time takes them again just before dialling.
JOURS_REMPLACEMENT_MAX = 7  # `not too far off` — his bound, in days
PLACES_REMPLACEMENT = 6  # what can be quoted on the phone without wearying anyone


def places_de_remplacement(base, preferences, tranches=1, depuis=None,
                           sauf_places=(), sauf_jours=()):
    """A few free slots to replace an appointment — SPREAD OUT.

    DIFFERENT days first, morning and afternoon of the same day next, and
    nothing beyond seven days. Returns a list of ISO times, sorted; empty when
    nothing is offerable — no date is invented.
    """
    libres = places_libres_elargies(base, preferences, tranches=tranches,
                                    depuis=depuis, sauf_places=sauf_places,
                                    sauf_jours=sauf_jours)
    if not libres:
        return []
    # ⚠ THE BOUND IS COUNTED FROM THE FIRST FREE SLOT, not from today. A
    # calendar full for eight days would otherwise return an EMPTY list — and
    # an empty list means a call that offers nothing while there were slots to
    # quote.
    try:
        origine = datetime.datetime.fromisoformat(libres[0]).date()
    except (TypeError, ValueError):
        return libres[:PLACES_REMPLACEMENT]
    limite = origine + datetime.timedelta(days=JOURS_REMPLACEMENT_MAX)
    retenues, par_demi_journee = [], {}
    for horaire in libres:
        if len(retenues) >= PLACES_REMPLACEMENT:
            break
        try:
            quand = datetime.datetime.fromisoformat(horaire)
        except (TypeError, ValueError):
            continue
        if quand.date() > limite:
            break
        # ⚠ ONE SLOT PER HALF-DAY on the first pass: that is what rules out six
        # slots in a row from the same morning. The second pass (below) fills
        # out, morning AND afternoon, when there is room left.
        demi = (quand.date().isoformat(),
                quand.hour < HEURE_BASCULE_MIDI)
        if demi in par_demi_journee:
            continue
        par_demi_journee[demi] = horaire
        retenues.append(horaire)
    # Not enough open days to fill up: we fill out with what is left, in order
    # — two hours of the same morning is better than nothing.
    if len(retenues) < PLACES_REMPLACEMENT:
        for horaire in libres:
            if len(retenues) >= PLACES_REMPLACEMENT:
                break
            try:
                quand = datetime.datetime.fromisoformat(horaire)
            except (TypeError, ValueError):
                continue
            if quand.date() > limite or horaire in retenues:
                continue
            retenues.append(horaire)
    return sorted(retenues)


def places_negociables(base, preferences, tranches=1, depuis=None,
                       sauf_places=(), a_deplacer=0, sauf_jours=()):
    """The stock of slots for a negotiation: nearest first, then varied.

    Returns a list of ISO 8601 times, sorted. Empty when nothing is offerable —
    no date is invented, as everywhere else.

    The search widens as long as it finds nothing (see HORIZONS_NEGO).

    `a_deplacer`: the number of appointments the campaign must clear out of
    their slots. The stock aimed at is then `a_deplacer ×
    PAR_RENDEZVOUS_A_DEPLACER`, and the spread extends over as many days and
    weeks as it takes to reach it. At zero (the default), the short stock of an
    isolated call is kept — a single call-back has nobody else to serve.
    """
    libres = places_libres_elargies(base, preferences, tranches=tranches,
                                    depuis=depuis, sauf_places=sauf_places,
                                    sauf_jours=sauf_jours)
    if not libres:
        return []
    cible = max(0, int(a_deplacer or 0)) * PAR_RENDEZVOUS_A_DEPLACER
    retenues = list(libres[:PROCHES_DABORD])
    deja = set(retenues)
    # ⚠ THE NEAREST ONES CONSUME THEIR QUOTA (04/09/2026). They are taken as
    # they stand — that is intended, we offer the earliest thing first — but
    # they were entered NEITHER into the per-half-day count NOR into the days
    # already seen. The first half-day could therefore receive
    # `PAR_DEMI_JOURNEE` MORE: the first day gathered 3 + 2 + 2 = seven slots
    # instead of four, and with a target of seven — a single appointment to
    # move — the loop stopped before it had even seen the second day.  ⚠
    # OBSERVED ON HIS REAL DATABASE: `instead of drawing plenty of dates, it
    # selected only one`. Seven times the same Saturday is not seven offers —
    # the agent had nothing to negotiate, which is exactly the defect this
    # spreading exists to avoid.
    comptes, jours_vus = {}, []
    for horaire in retenues:
        try:
            quand = datetime.datetime.fromisoformat(horaire)
        except (TypeError, ValueError):
            continue
        jour = quand.date().isoformat()
        if jour not in jours_vus:
            jours_vus.append(jour)
        demi = "matin" if quand.hour < HEURE_BASCULE_MIDI else "apres"
        comptes[(jour, demi)] = comptes.get((jour, demi), 0) + 1
    # ⚠ WE COUNT DAYS, NOT SLOTS. Counting slots brought the whole stock back
    # onto the first two open days — exactly the defect being fixed.  ⚠ AND THE
    # SPREAD EXTENDS UNTIL THE TARGET (17/08/2026). Five days and two slots per
    # half-day capped the stock at twenty-three slots, whatever the number of
    # people to move. So the SAME two rules are kept — several days, morning
    # AND afternoon — but we go on advancing through the calendar as long as
    # the target is not reached: the stock spreads over several weeks instead
    # of piling up on the first.
    jours_vises = max(JOURS_COUVERTS_NEGO,
                      -(-cible // (PAR_DEMI_JOURNEE * 2)) if cible else 0)
    for horaire in libres[PROCHES_DABORD:]:
        if cible and len(retenues) >= cible:
            break
        try:
            quand = datetime.datetime.fromisoformat(horaire)
        except (TypeError, ValueError):
            continue
        jour = quand.date().isoformat()
        if jour not in jours_vus:
            if len(jours_vus) >= jours_vises:
                break
            jours_vus.append(jour)
        demi = "matin" if quand.hour < HEURE_BASCULE_MIDI else "apres"
        cle = (jour, demi)
        if comptes.get(cle, 0) >= PAR_DEMI_JOURNEE:
            continue
        comptes[cle] = comptes.get(cle, 0) + 1
        if horaire not in deja:
            deja.add(horaire)
            retenues.append(horaire)
    # ⚠ A SECOND PASS, AND IT IS NECESSARY: when the practice opens only half a
    # day, or when the days walked do not offer enough slots, the first pass
    # stops below the target. We then fill out in date order, lifting the
    # per-half-day cap — two more slots on the same morning is better than
    # seven people with no date. The spread is already secured: it was done
    # FIRST.
    if cible and len(retenues) < cible:
        for horaire in libres:
            if len(retenues) >= cible:
                break
            if horaire not in deja:
                deja.add(horaire)
                retenues.append(horaire)
    return sorted(retenues)


# ⚠ WHAT COMES OUT OF HERE WILL BE SPOKEN OUT LOUD (24/08/2026, his request).
# These three functions do not produce screen text: they fill the step-2
# `slots` fields, and those fields go out WORD FOR WORD in the briefing
# dictated to the agent. `le 25/08/2026 à 09h00` has nothing telling a machine
# to read `twenty-fifth of August` rather than `twenty-five slash zero eight`.
# Spelled out in full, the question no longer arises.  ⚠ THE SCREENS DO NOT
# CHANGE: the tables keep `date_lisible`, compact and alignable from one row to
# the next. These are two different needs, which is why they are two functions.
def _en_toutes_lettres(horaire, langue_code="fr"):
    """`le mardi 25 août 2026 à 9 heures` — the form SPOKEN on the phone.

    ⚠ IT FOLLOWS THE LANGUAGE, AND IT IS SPOKEN ON THE PHONE (03/09/2026).
    These slot lists go into the briefing — `available slots to offer`,
    `replacement slots` — and an English briefing announced its dates in
    French, pronounced by an English voice to an English-speaking patient.

    ⚠ AND THE ARTICLE DISAPPEARS IN ENGLISH: one says `on Monday 24 August`,
    not `the Monday 24 August`.
    """
    if langue_code == "en":
        return f"on {themes.date_parlee(horaire, 'en')}"
    return f"le {themes.date_parlee(horaire)}"


def creneaux_negociables(base, preferences, tranches=1, depuis=None,
                         sauf_places=(), a_deplacer=0, sauf_jours=()):
    """The stock above, in French. "" when nothing is offerable."""
    return ", ".join(
        _en_toutes_lettres(
            horaire, mod_langue.de_preferences(preferences))
        for horaire in
                     places_negociables(base, preferences, tranches=tranches,
                                        depuis=depuis,
                                        sauf_places=sauf_places,
                                        a_deplacer=a_deplacer,
                                        sauf_jours=sauf_jours))


def creneaux_de_remplacement(base, preferences, tranches=1, depuis=None,
                             sauf_places=(), sauf_jours=()):
    """The replacement slots, in French. "" when nothing is offerable."""
    return ", ".join(
        _en_toutes_lettres(
            horaire, mod_langue.de_preferences(preferences))
        for horaire in
                     places_de_remplacement(base, preferences,
                                            tranches=tranches, depuis=depuis,
                                            sauf_places=sauf_places,
                                            sauf_jours=sauf_jours))


def creneau_le_plus_proche(base, preferences, tranches=1, depuis=None,
                           sauf_places=(), sauf_jours=()):
    """The FIRST free slot, in French. "" when there is none.

    It is that one, and it alone, that the opening message names: we offer a
    date, we do not recite a catalogue.
    """
    places = places_negociables(base, preferences, tranches=tranches,
                                depuis=depuis, sauf_places=sauf_places,
                                sauf_jours=sauf_jours)
    return (_en_toutes_lettres(
        places[0], mod_langue.de_preferences(preferences))
        if places else "")


def places_a_proposer(base, preferences, tranches=1, depuis=None, limite=6,
                      sauf_places=(), sauf_jours=()):
    """What there is TO OFFER on the phone at this precise moment.

    `sauf_places`: times NOT to offer, even free ones. A move campaign uses it
    never to re-offer the very slots it is emptying — see
    assistant.places_a_vider.

    Returns a pair (readable text, the FIRST free slot in ISO 8601 — or None).
    Both come out of the SAME computation: the slot sent to the agent as the
    reference date is therefore exactly the first of the ones the message
    announces, never a second computation that could diverge.

    Two situations, two honest answers:

    - the opening hours are known (typical week configured, or slots added by hand in ⚙ Réglages): the slot is the first offerable, genuinely free one. When there is NONE left, the slot is None — the calendar is full, and that must be said rather than offering a date that does not exist;

    - no opening hours are configured: RingBack does not KNOW the working hours and does not guess them — the readable text stays empty. It then applies the only rule left to it in that situation, exactly the one in refus_rendezvous_telephone: never put two people in the same slot. The slot starts from the standard make-up delay (RATTRAPAGE_JOURS after the call) and MOVES FORWARD slot by slot until it finds one that is not already taken.
    """
    libres = places_libres_elargies(base, preferences, tranches=tranches,
                                    depuis=depuis, sauf_places=sauf_places,
                                    limite=limite, sauf_jours=sauf_jours)
    texte = ", ".join(
        _en_toutes_lettres(
            horaire, mod_langue.de_preferences(preferences))
        for horaire in libres)
    if libres:
        return texte, libres[0]
    if semaine_ouverte(preferences) or creneaux_manuels(preferences):
        # ⚠ THERE WAS A SECOND WALK HERE, without the limit, catching a free
        # slot that the displayed rows hid. It no longer has a purpose:
        # `places_libres_elargies` sets the taken ones aside BEFORE cutting, so
        # an empty list now means `nothing free`, not `nothing in the first six
        # rows`. That catch-up treated the symptom on the SLOT while leaving
        # the TEXT empty — and it is the text the campaign reads back before
        # dialling.
        return texte, None  # the calendar really is full
    return texte, _place_sans_horaires(base, preferences, tranches, depuis)


def _place_sans_horaires(base, preferences, tranches=1, depuis=None):
    """The next slot NOT TAKEN when no opening hours are configured.

    With no typical week there are no working hours to enumerate: the only
    thing RingBack still knows is which slots are ALREADY TAKEN. So we start
    from the standard make-up delay and advance slot by slot (declared closed
    days are skipped) to the first free one. Returns None when the whole
    horizon is taken.
    """
    if depuis is None:
        depuis = datetime.datetime.now()
    pas = pas_minutes(preferences)
    exigees = max(int(tranches or 1), 1)
    depart = (depuis + datetime.timedelta(days=RATTRAPAGE_JOURS)).replace(
        second=0, microsecond=0)
    par_jour = (24 * 60) // pas
    for decalage in range(HORIZON_JOURS + 1):
        jour = depart.date() + datetime.timedelta(days=decalage)
        if est_ferme(preferences, jour) is not None:
            continue
        occupees = tranches_occupees(base, preferences, jour)
        minuit = datetime.datetime.combine(jour, datetime.time())
        premiere = 0
        if decalage == 0:
            premiere = int((depart - minuit).total_seconds() // 60) // pas
        # The required run must fit WITHIN the day: the next day's slots are
        # not loaded here, so they are never lightly declared free.
        for rang in range(premiere, par_jour - exigees + 1):
            place = minuit + datetime.timedelta(minutes=rang * pas)
            suite = [place + datetime.timedelta(minutes=i * pas)
                     for i in range(exigees)]
            if all(tranche not in occupees for tranche in suite):
                return place.isoformat(timespec="minutes")
    return None


# ------------------------------------------------------- schedule week
def lundi_de(jour):
    """The Monday of THIS date's week."""
    return jour - datetime.timedelta(days=jour.weekday())


def semaine_iso(jour):
    """(ISO year, ISO week number) of this date — the French standard."""
    annee, numero, _ = jour.isocalendar()
    return annee, numero


def nombre_de_semaines(annee):
    """52 or 53: the number of ISO weeks in this year.

    28 December ALWAYS belongs to the last ISO week of its year: that is the
    shortest way to know this number.
    """
    return datetime.date(annee, 12, 28).isocalendar()[1]


def lundi_de_semaine(annee, numero):
    """The Monday of ISO week no. `numero` of `annee` (bounds corrected)."""
    numero = max(1, min(int(numero), nombre_de_semaines(int(annee))))
    return datetime.date.fromisocalendar(int(annee), numero, 1)


def libelle_semaine(annee, numero):
    """`semaine 33 — du 10/08 au 16/08`: the landmark that makes things findable.

    A week number on its own says nothing to anyone; the two dates do. This
    form was written inline in the schedule's bar; it lives here so that the
    assistant's step ③ can reuse it identically rather than inventing a second
    one (02/08/2026).
    """
    lundi = lundi_de_semaine(annee, numero)
    dimanche = lundi + datetime.timedelta(days=6)
    return f"semaine {numero} — du {lundi:%d/%m} au {dimanche:%d/%m}"


def options_semaines(annee, depuis=None):
    """[(number as text, label), …] of this year's weeks.

    `depuis`: a date from which to offer. For the current year, we start from
    the CURRENT WEEK and go to the end of the year — scrolling through January
    in August to find next week helps nobody (owner's request, 02/08/2026).
    Weeks already past stay reachable by changing year.
    """
    annee = int(annee)
    premiere = 1
    if depuis is not None:
        courante_annee, courante = semaine_iso(depuis)
        if annee == courante_annee:
            premiere = courante
        elif annee < courante_annee:
            # A past year: it is all behind us, we show everything.
            premiere = 1
    return [(str(numero), libelle_semaine(annee, numero))
            for numero in range(premiere, nombre_de_semaines(annee) + 1)]


def jours_ouverts_de_semaine(preferences, lundi):
    """The OPEN days of this week: [(date, label), …].

    A closed day (typical week or exceptional closure) has no appointment to
    call back about: offering it would be offering emptiness. When the typical
    week has never been configured, no day is open — and that is the truth, not
    an oversight.

    ⚠ `est_ferme` returns an EMPTY string when the closure has no reason: so we
    test `is not None`, never the truthiness of the value.
    """
    # ⚠ `semaine_ouverte` returns a BOOLEAN (`at least one open day`), not the
    # week: it is `semaine` that gives the periods per day.
    type_de_semaine = semaine(preferences)
    ouverts = []
    for decalage in range(7):
        jour = lundi + datetime.timedelta(days=decalage)
        if est_ferme(preferences, jour) is not None:
            continue
        if not type_de_semaine.get(jour.weekday()):
            continue
        ouverts.append((jour, f"{JOURS[jour.weekday()]} {jour:%d/%m}"))
    return ouverts


def bornes_de_periode(debut, fin):
    """(start, end) as ISO text — a HALF-OPEN interval [start, end[.

    The last day counts in FULL: we bound at the next day at 00:00, not at the
    day itself. Without that, a Sunday 11am appointment would fall outside a
    week running `to Sunday`.
    """
    return (datetime.datetime.combine(debut, datetime.time())
            .isoformat(timespec="minutes"),
            datetime.datetime.combine(fin, datetime.time())
            .isoformat(timespec="minutes"))


def grille_semaine(base, preferences, lundi, maintenant=None):
    """The SCHEDULE of a week: seven columns of slots, tiles included.

    The division is EXACTLY that of the settings' typical week (the step), so
    the two screens read the same way. Each cell is worth:

    - `libre`    : the slot is open and nobody occupies it (green);
    - `ferme`    : outside the opening hours, or a closed day;
    - `tuile`    : the START of an appointment, with its height in slots;
    - `couverte` : a slot swallowed by the tile above.

    The rule that counts: **an appointment occupying several consecutive slots
    gives ONE single tile** of height N (a `rowspan` on display), never N cells
    side by side. When two appointments overlap (old input, an import), the
    second does not overwrite the first: it goes into `superposes` and the
    screen says so.

    Returns {"lundi", "pas", "minutes", "jours", "superposes"}.
    """
    if maintenant is None:
        maintenant = datetime.datetime.now()
    maintenant = maintenant.replace(second=0, microsecond=0)
    pas = pas_minutes(preferences)
    dimanche = lundi + datetime.timedelta(days=7)
    poses = base.rendezvous_de_periode(
        datetime.datetime.combine(lundi, datetime.time()).isoformat(timespec="minutes"),
        datetime.datetime.combine(dimanche, datetime.time()).isoformat(timespec="minutes"),
        statuts=STATUTS_OCCUPANTS)
    # 1. The span: the settings', WIDENED when an appointment overflows it.
    # Nothing is hidden — an appointment outside the hours stays visible.
    debut, fin = amplitude_affichee(preferences)
    par_jour = {lundi + datetime.timedelta(days=i): [] for i in range(7)}
    for rdv in poses:
        try:
            depart = datetime.datetime.fromisoformat(rdv["horaire"])
        except (TypeError, ValueError):
            continue
        if depart.date() not in par_jour:
            continue
        par_jour[depart.date()].append((depart, rdv))
        minute = ((depart.hour * 60 + depart.minute) // pas) * pas
        debut = min(debut, minute)
        fin = max(fin, min(minute + pas * duree_tranches(rdv), 24 * 60))
    debut = (debut // pas) * pas
    fin = min(-(-fin // pas) * pas, 24 * 60)
    minutes = list(range(debut, fin - pas + 1, pas))
    rang = {minute: index for index, minute in enumerate(minutes)}
    # 2. The seven columns.
    jours, superposes = [], []
    for decalage in range(7):
        jour = lundi + datetime.timedelta(days=decalage)
        libelle_ferme = est_ferme(preferences, jour)
        ouvertes = {tranche.hour * 60 + tranche.minute
                    for tranche in tranches_du_jour(preferences, jour)}
        cellules = [None] * len(minutes)
        occupant = [None] * len(minutes)
        for depart, rdv in sorted(par_jour[jour], key=lambda e: (e[0], e[1]["id"])):
            minute = ((depart.hour * 60 + depart.minute) // pas) * pas
            index = rang.get(minute)
            if index is None or occupant[index] is not None:
                superposes.append(rdv)  # never overwritten, never hidden
                continue
            voulue = duree_tranches(rdv)
            hauteur = 0
            while (hauteur < voulue and index + hauteur < len(minutes)
                   and occupant[index + hauteur] is None):
                occupant[index + hauteur] = rdv["id"]
                hauteur += 1
            cellules[index] = {"type": "tuile", "rdv": rdv, "hauteur": hauteur,
                               "tranches": voulue, "debut": depart,
                               "fin": depart + datetime.timedelta(
                                   minutes=pas * voulue),
                               "tronquee": hauteur < voulue}
            for suivant in range(1, hauteur):
                cellules[index + suivant] = {"type": "couverte"}
        for index, minute in enumerate(minutes):
            if cellules[index] is not None:
                continue
            heure = datetime.datetime.combine(jour, datetime.time()) + \
                datetime.timedelta(minutes=minute)
            libre = libelle_ferme is None and minute in ouvertes
            cellules[index] = {"type": "libre" if libre else "ferme",
                               "minute": minute, "debut": heure,
                               "revolue": heure < maintenant}
        jours.append({"date": jour, "ferme": libelle_ferme, "cellules": cellules,
                      "rendezvous": [rdv for _, rdv in par_jour[jour]]})
    return {"lundi": lundi, "pas": pas, "minutes": minutes, "jours": jours,
            "superposes": superposes}


# --------------------------------------------------- moving a client
def duree_tranches(rdv):
    """The length of an appointment, in slots (1 when the data is absent)."""
    try:
        return max(int(rdv.get("duree_tranches") or 1), 1)
    except (TypeError, ValueError):
        return 1


def suite_libre_a_partir_de(base, preferences, cible, sauf_rdv=None):
    """How many CONSECUTIVE free slots there are from this moment.

    The moment is brought back to the start of its slot. Returns 0 when the
    slot itself is closed or already taken.
    """
    pas = pas_minutes(preferences)
    minuit = datetime.datetime.combine(cible.date(), datetime.time())
    depart = minuit + datetime.timedelta(
        minutes=(int((cible - minuit).total_seconds() // 60) // pas) * pas)
    libres = set(tranches_libres_du_jour(base, preferences, cible.date(),
                                         sauf_rdv=sauf_rdv))
    compte = 0
    while depart in libres:
        compte += 1
        depart += datetime.timedelta(minutes=pas)
    return compte


def refus_deplacement(base, preferences, rdv, cible, sauf_lui_meme=True):
    """The REFUSAL message when this appointment does not fit there, else None.

    The owner's rule, to the letter: a client whose appointment occupies more
    consecutive slots than there are consecutive free slots cannot be rebooked.
    The message says what is missing.
    """
    pas = pas_minutes(preferences)
    exigees = duree_tranches(rdv)
    sauf = rdv.get("id") if sauf_lui_meme else None
    try:
        debut = datetime.datetime.fromisoformat(cible)
    except (TypeError, ValueError):
        return (f"Horaire illisible : « {cible} » — attendu par exemple "
                "2026-08-03T09:00 ou 03/08/2026 09:00.")
    jour = debut.date()
    libelle_ferme = est_ferme(preferences, jour)
    if libelle_ferme is not None:
        precision = f" ({libelle_ferme})" if libelle_ferme else ""
        return (f"Déplacement refusé : le {jour:%d/%m/%Y} est déclaré FERMÉ"
                f"{precision} — aucun rendez-vous n'y est possible. "
                "Les jours fermés se retirent dans « ⚙ Réglages ».")
    disponibles = suite_libre_a_partir_de(base, preferences, debut, sauf_rdv=sauf)
    if disponibles >= exigees:
        return None
    if disponibles == 0:
        raison = ("cette tranche est déjà prise, ou elle est hors des horaires "
                  "d'ouverture")
    else:
        raison = (f"il n'y a que {tranches_lisibles(disponibles, pas)} "
                  f"d'affilée — il en manque {exigees - disponibles}")
    return (f"Déplacement refusé : ce rendez-vous occupe "
            f"{tranches_lisibles(exigees, pas)}, et à partir du "
            f"{debut:%d/%m/%Y} à {debut:%Hh%M}, {raison}. "
            "Choisissez un créneau assez long, ou élargissez les horaires "
            "d'ouverture dans « ⚙ Réglages ».")


def creneaux_pour_rendezvous(base, preferences, rdv, depuis=None, limite=12):
    """The slots where THIS appointment fits (its length), so it can be moved.
    """
    return creneaux_libres(base, preferences, tranches=duree_tranches(rdv),
                           depuis=depuis, limite=limite, sauf_rdv=rdv.get("id"))


# ------------------------------------- appointment decided ON THE PHONE (R3)
def refus_rendezvous_telephone(base, preferences, horaire, tranches=1,
                               sauf_rdv=None, place_choisie=False,
                               maintenant=None):
    """The REFUSAL message when a date agreed ON THE PHONE does not fit.

    The owner's rule: what the interface refuses by hand, the phone must refuse
    too — a date already past, a closed day, outside the opening hours, a slot
    already taken, a length that does not fit. Returns the French message, or
    None when the slot really is free.

    ⚠ A PAST DATE HAS BEEN REFUSED HERE SINCE 18/08/2026, and it was missing.
    The rule was in fact written twice in this file — see
    `creneaux_proposables`: `An appointment moved to yesterday is not a moved
    appointment: it is a lost appointment.` It was only held on the side of the
    dates OFFERED; on the side of what we AGREE to write, nothing looked at the
    calendar.

    WHAT THAT PRODUCED, measured: an appointment missed on 19/07, the agent
    returns `other date agreed: 21/07 at 09h30` — a month in the past —, and
    the product wrote it without a word, status `confirmé`. The
    missed-appointment rule turned it straight back to `manqué` at the next
    load: the appointment had vanished and nobody could say why. The bench
    caught it on 18/08/2026, when the row stopped being marked `déplacé` — the
    old wording masked the loss.

    ⚠ THE PAST IS REFUSED, NOT `TODAY`. Never OFFERING the same day is a rule
    about offering (`plancher_de_proposition`): it protects the client, who
    cannot organise themselves in two hours. Refusing to WRITE a date this
    afternoon that has just been agreed with them on the phone would be
    something else — it would be losing a real agreement.

    Three honest qualifications:
    - a DECLARED closed day is always refused, even when the typical week has never been filled in (it is an explicit decision by the user);
    - as long as NO typical week is configured, RingBack does not know the opening hours: it then checks only DOUBLE booking (two people in the same slot), and claims nothing more;
    - a slot the USER chose themselves (a campaign's freed slot, or a slot added by hand in ⚙ Réglages — `exceptionally, I can see people on Saturday`) is not judged on the opening hours: it is already a human decision. It stays refused when it is CLOSED or ALREADY TAKEN.
    """
    if horaire is None or not str(horaire).strip():
        # ⚠ AN AGREEMENT WITH NO DATE, WHERE A DATE IS INDISPENSABLE
        # (24/08/2026). `Agreed date unreadable: « None »` said nothing to
        # anyone. On a move or a booking, the agent concluded an agreement
        # without saying WHEN: there is nothing to write, and the sentence must
        # say that rather than talk about a format.
        return ("Rendez-vous NON créé : l'agent a conclu à un accord mais n'a "
                "donné AUCUNE date. Il n'y a rien à inscrire au planning. "
                "Rappelez cette personne pour convenir d'une date — ce qui a "
                "été dit au téléphone est conservé dans la transcription.")
    try:
        debut = datetime.datetime.fromisoformat(horaire)
    except (TypeError, ValueError):
        return (f"Date convenue illisible : « {horaire} » — attendu par "
                "exemple 2026-08-03T09:00.")
    if maintenant is None:
        maintenant = datetime.datetime.now()
    if debut < maintenant.replace(second=0, microsecond=0):
        return (f"Rendez-vous NON créé : le {debut:%d/%m/%Y} à {debut:%Hh%M} "
                "est DÉJÀ PASSÉ. Un rendez-vous déplacé vers une date passée "
                "n'est pas déplacé, il est perdu : il redeviendrait « manqué » "
                "aussitôt. Rappelez cette personne pour convenir d'une vraie "
                "date.")
    libelle_ferme = est_ferme(preferences, debut.date())
    if libelle_ferme is not None:
        precision = f" ({libelle_ferme})" if libelle_ferme else ""
        return (f"Rendez-vous NON créé : le {debut:%d/%m/%Y} est déclaré "
                f"FERMÉ{precision} — aucun rendez-vous n'y est possible. "
                "Les jours fermés se retirent dans « ⚙ Réglages ».")
    exigees = max(int(tranches or 1), 1)
    pas = pas_minutes(preferences)
    choisie = (place_choisie
               or horaire in creneaux_manuels(preferences)
               or not semaine_ouverte(preferences))
    if choisie:
        if _occupe(base, preferences, horaire, exigees, sauf_rdv):
            return (f"Rendez-vous NON créé : la place du {debut:%d/%m/%Y} à "
                    f"{debut:%Hh%M} est DÉJÀ PRISE par un autre rendez-vous "
                    f"(celui-ci demande {tranches_lisibles(exigees, pas)}).")
        return None
    disponibles = suite_libre_a_partir_de(base, preferences, debut,
                                          sauf_rdv=sauf_rdv)
    if disponibles >= exigees:
        return None
    if disponibles == 0:
        raison = ("cette place est déjà prise, ou elle est hors des horaires "
                  "d'ouverture")
    else:
        raison = (f"il n'y a que {tranches_lisibles(disponibles, pas)} "
                  f"d'affilée — il en manque {exigees - disponibles}")
    return (f"Rendez-vous NON créé : le {debut:%d/%m/%Y} à {debut:%Hh%M}, "
            f"{raison}. Ce rendez-vous demande "
            f"{tranches_lisibles(exigees, pas)}.")


def note_date_refusee(refus, date_convenue, rappel_humain=True):
    """The text displayed when a date agreed on the phone is refused.

    It says the two things that matter: WHY the appointment was not created,
    and WHICH date the client had asked for — in clear, so a human can pick up
    exactly where the agent stopped. Nothing obtained on the phone is lost.

    ⚠ `rappel_humain=False` ON A FREED SLOT (15/08/2026): that kind no longer
    produces a manual call-back, he had it removed. The closing sentence must
    follow the contact's real state, otherwise the screen promises a call-back
    nobody will make — the kind of half-correction that wears away trust in the
    whole rest of the page.
    """
    fin = ("un humain doit rappeler pour convenir d'une autre date."
           if rappel_humain else
           "aucun rendez-vous n'a été écrit, et la place libérée est proposée "
           "à quelqu'un d'autre.")
    # ⚠ WITH NO READABLE DATE, WE DO NOT PRETEND TO QUOTE ONE. The agent may
    # return an unreadable date (the refusal then says so itself): the sentence
    # `the requested date was  — …`, with its hole, must not be displayed.
    lisible = themes.date_lisible(date_convenue)
    if not lisible:
        return f"{refus} Aucune date exploitable n'a été rendue — {fin}"
    return f"{refus} La date demandée au téléphone était {lisible} — {fin}"
