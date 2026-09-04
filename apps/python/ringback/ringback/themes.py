"""Call themes: French mission templates + the settings that feed them.

Five themes when starting a call-back (single, queue or cascade): missed,
confirmation, reschedule, freed slot, custom. Each theme provides a French
template, pre-filled on screen and EDITABLE before launch — the text displayed
is exactly the text that will be read out.

Variables substituted in the templates:
- [entreprise]            the business name (setting);
- [client]                the name of the person called — substituted PER CALL (a queue contains several clients);
- [date_rdv]              the date of the appointment concerned — substituted PER CALL;
- [créneaux_disponibles]  slots to offer (setting, themes ② ③ ④);
- [plage_rappel]          the permitted calling window (setting);
- [créneau]               the freed slot — substituted by the cascade at launch.

A variable WITHOUT a configured value is left as it stands in the text: the
user sees it, can replace it by hand or go and set it in `⚙ Réglages` — never a
value silently invented. Unchanged convention: the mission text NEVER contains
a phone number.

The module also carries the politeness guard: outside the permitted window
(configurable, 9am-7pm by default), any call launch is refused with a clear
message.
"""

import datetime
import re

# ------------------------------------------------------------ setting keys
CLE_ENTREPRISE = "entreprise"
CLE_CRENEAUX = "creneaux_disponibles"   # liste d'horaires ISO 8601
CLE_PLAGE_DEBUT = "plage_debut"         # « HH:MM »
CLE_PLAGE_FIN = "plage_fin"
PLAGE_DEBUT_DEFAUT = "09:00"
PLAGE_FIN_DEFAUT = "19:00"

# ------------------------------------------------------------------- themes
# The dictionary order is the display order of the selector.  ⚠ Two corrections
# of 03/08/2026, along with the removal of three campaign kinds: · `⑤
# Personnalisé` is GONE: its template was empty, and the kind of the same name
# was removed — offering a theme that says nothing would mean writing the
# message twice, here and in the mission box; · `Rappel d'appel manqué` is
# renamed `Rappel d'un rendez-vous manqué`. The label was identical to that of
# a removed kind which referred to a missed PHONE CALL. Two different things
# under one name: a confusion waiting for a reader.
THEMES = {
    "manque": "① Rappel d'un rendez-vous manqué",
    "confirmation": "② Confirmation de rendez-vous",
    "deplacement": "③ Déplacement de rendez-vous",
    "creneau_libere": "④ Créneau libéré (cascade)",
}

# Templates written in the neutral masculine (no gender agreement); [client] is
# the name of the person called, honorific included.
GABARITS = {
    "manque": (
        "Bonjour [client], je vous appelle de la part de [entreprise]. "
        "Vous aviez rendez-vous [date_rdv] et nous n'avons pas pu vous "
        "accueillir. Je vous propose de convenir d'un nouveau créneau : "
        "nos disponibilités sont [créneaux_disponibles]. Vous pouvez aussi "
        "nous rappeler [plage_rappel]."),
    "confirmation": (
        "Bonjour [client], je vous appelle de la part de [entreprise] pour "
        "confirmer votre rendez-vous [date_rdv]. Merci de me dire si ce "
        "créneau vous convient toujours ; sinon, je peux vous proposer "
        "[créneaux_disponibles]. En cas de besoin, vous pouvez nous "
        "rappeler [plage_rappel]."),
    "deplacement": (
        "Bonjour [client], je vous appelle de la part de [entreprise]. "
        "Nous devons déplacer votre rendez-vous [date_rdv]. Je peux vous "
        "proposer les créneaux suivants : [créneaux_disponibles]. Lequel "
        "vous conviendrait ? Vous pouvez aussi nous rappeler [plage_rappel]."),
    "creneau_libere": (
        "Bonjour [client], j'appelle de la part de [entreprise]. Un créneau "
        "s'est libéré [créneau]. Est-ce que cela vous intéresse ? Si cette "
        "date ne convient pas, nous avons aussi d'autres disponibilités : "
        "[créneaux_disponibles]."),
}


# --------------------------------------------------------------- formatting ⚠
# THE DAY AND MONTH NAMES, HERE AND NOWHERE ELSE. `horaires.JOURS` takes them
# over (`JOURS = themes.JOURS`) rather than keeping a second list: two lists
# would be two truths, and that is how a day starts being called something else
# from one screen to the next.
JOURS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi",
         "dimanche")
MOIS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet",
        "août", "septembre", "octobre", "novembre", "décembre")

# ⚠ THE ENGLISH NAMES ARE ADDED ALONGSIDE, NEVER INSTEAD (01/09/2026). `JOURS`
# and `MOIS` above are read AT IMPORT TIME by the test file, which builds a
# regular expression from them: making them variable — one dictionary per
# language, a function — would bring down all 1135 tests before the first one
# even ran. Measured, not assumed. Two extra tuples cost nothing and can break
# nothing.
JOURS_EN = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
            "Saturday", "Sunday")
MOIS_EN = ("January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December")
MOIS_EN_COURT = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
                 "Sep", "Oct", "Nov", "Dec")


def date_lisible(iso, langue="fr"):
    """`2026-08-01T14:30` becomes `le 01/08/2026 à 14h30`.

    THE SCREEN FORMAT: compact, aligned from one table row to the next. What is
    SPOKEN ON THE PHONE goes through `date_parlee` — see below.

    ⚠ IN ENGLISH THE MONTH IS SPELLED OUT: `on 01 Aug 2026 at 14:30`.
    Translating only the day names while keeping `01/08/2026` would give a
    WRONG date to an English reader — they would read 8 January. Spelling the
    month out removes the ambiguity without lengthening the line.

    ⚠ AND THE TIME STAYS ON THE 24-HOUR CLOCK, in both languages: it is the
    clock of the schedule and the opening-hours grid, which do not change
    language. The `am / pm` format is reserved for what is SPOKEN out loud.

    `langue` defaults to `fr`: every existing call is therefore unchanged, to
    the letter.
    """
    try:
        quand = datetime.datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return iso or ""
    if langue == "en":
        return (f"on {quand.day:02d} {MOIS_EN_COURT[quand.month - 1]} "
                f"{quand.year} at {quand.hour:02d}:{quand.minute:02d}")
    return quand.strftime("le %d/%m/%Y à %Hh%M")


def heure_parlee(quand, langue="fr"):
    """`10 heures 20`, `9 heures` on the hour, `1 heure 05`.

    The French of a reception desk on the phone: `heures` in the plural from
    two o'clock on, and an exact hour is not said as `neuf heures zéro zéro`.

    ⚠ IN ENGLISH IT IS THE 12-HOUR CLOCK. `14:30` is said `half past two`,
    never `fourteen thirty`, from a receptionist's mouth. So `2:30 pm` is
    returned, and `9 am` for an exact hour — the same rule as in French: an
    exact hour is not said with its minutes.
    """
    if langue == "en":
        suffixe = "am" if quand.hour < 12 else "pm"
        douze = quand.hour % 12 or 12
        if quand.minute == 0:
            return f"{douze} {suffixe}"
        return f"{douze}:{quand.minute:02d} {suffixe}"
    mot = "heure" if quand.hour == 1 else "heures"
    if quand.minute == 0:
        return f"{quand.hour} {mot}"
    return f"{quand.hour} {mot} {quand.minute:02d}"


def date_parlee(iso, langue="fr"):
    """`2026-08-24T10:20` becomes `lundi 24 août 2026 à 10 heures 20`.

    ⚠ THE FORMAT OF WHAT IS SPOKEN OUT LOUD (his request of 24/08/2026). What
    went out to the agent was `le 24/08/2026 à 10h20` — digits and slashes. A
    voice agent has nothing to guess with that it should read `vingt-quatre
    août` rather than `vingt-quatre barre zéro huit`. The date spelled out
    leaves no choice.

    ⚠ THE DAY IN LOWER CASE: the date is used INSIDE a sentence — `votre
    rendez-vous du lundi 24 août 2026`. A capital in mid-sentence would be a
    mistake, and this is text read by a machine to a person.

    ⚠ THE YEAR IS ALWAYS SPOKEN (his choice of 24/08/2026): no possible
    ambiguity about a January appointment called about in December.

    Returns the value as it stands when it is not a date: never an invented
    date, never silent emptiness.
    """
    try:
        quand = datetime.datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return iso or ""
    if langue == "en":
        # ⚠ THE DAY TAKES A CAPITAL IN ENGLISH, unlike French: `Monday 24
        # August`, never `monday`. That is a rule of the language, not a style
        # choice, and a voice agent reads what is written.
        return (f"{JOURS_EN[quand.weekday()]} {quand.day} "
                f"{MOIS_EN[quand.month - 1]} {quand.year} at "
                f"{heure_parlee(quand, langue)}")
    return (f"{JOURS[quand.weekday()]} {quand.day} {MOIS[quand.month - 1]} "
            f"{quand.year} à {heure_parlee(quand)}")


# ⚠ WHAT THE CALENDAR CAN READ — THE SINGLE READER (his request of 24/08/2026:
# `when it returns the answer about the chosen slot, we need the format used in
# the calendar`).  WHAT WAS WRONG, measured: the date returned by the agent was
# written INTO the schedule as it stood. `2026-08-25T09:00`, `2026-08-25 09:00`
# and `2026-08-25T09:00:00` are the SAME instant — they entered the database
# under three different spellings, and the text comparison that decides which
# slot was taken refused two out of three. A date in French, for its part,
# tipped the person into `à rappeler par un humain`.  ⚠ AND THAT RISK RISES
# with dates spoken out in full: someone hearing `mardi 25 août 2026 à 9
# heures` may well write it back just like that.  ⚠ WE READ, WE DO NOT GUESS.
# An unrecognised form returns None — the caller then treats the answer as
# unreadable, which it is. Inventing a date would book an appointment nobody
# made.
_MOIS_LUS = {nom: rang for rang, nom in enumerate(MOIS, start=1)}
# The abbreviations one runs into (`25 aout`, without the accent, happens).
_SANS_ACCENT = str.maketrans("àâäéèêëîïôöùûüç", "aaaeeeeiioouuuc")
for _nom, _rang in list(_MOIS_LUS.items()):
    _MOIS_LUS[_nom.translate(_SANS_ACCENT)] = _rang
# ⚠ AND THE ENGLISH MONTHS, FULL AND ABBREVIATED (01/09/2026). An agent that
# held the conversation in English returns a date in English: without those
# names, `lire_date` returned None and EVERY appointment agreed on the phone
# went to `à rappeler par un humain`. Measured on six common English forms: six
# times None.
for _rang, _nom in enumerate(MOIS_EN, start=1):
    _MOIS_LUS[_nom.lower()] = _rang
for _rang, _nom in enumerate(MOIS_EN_COURT, start=1):
    _MOIS_LUS[_nom.lower()] = _rang

# ⚠ THE ARTICLE AND THE DAY ARE STRIPPED TOGETHER. The product WRITES `le mardi
# 25 août 2026 à 9 heures`: the article is part of what it writes (see
# `_en_toutes_lettres`). A reader that does not accept it cannot read back what
# its own product has just written — measured on 24/08/2026: `lire_date`
# returned None on every date produced by `date_parlee`. A round-trip test now
# holds this rule in both directions.
_ARTICLE_ET_JOUR = re.compile(
    r"^(?:l[ea]\s+|l'|du\s+|au\s+|on\s+|the\s+)?"
    r"(?:(?:" + "|".join(JOURS + JOURS_EN) + r"),?\s+)?",
    re.IGNORECASE)
_DATE_FRANCAISE = re.compile(
    r"^(\d{1,2})\s+([a-zà-ÿ]+)\.?\s+(\d{4})$", re.IGNORECASE)
# `August 25, 2026` and `Aug 25 2026`: the month FIRST, the comma allowed.
_DATE_ANGLAISE = re.compile(
    r"^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$", re.IGNORECASE)
_DATE_CHIFFREE = re.compile(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$")
_HEURE = re.compile(
    r"^(\d{1,2})\s*(?:h(?:eures?)?|:|\.)?\s*(\d{1,2})?\s*"
    r"(am|pm|a\.m\.|p\.m\.)?$", re.IGNORECASE)
_AM_PM_COLLE = re.compile(r"(\d)\s+(am|pm|a\.m\.|p\.m\.)", re.IGNORECASE)


def _heure_lue(texte):
    """`9 heures 20`, `9h20`, `9h`, `09:20`, `2:30 pm` → (h, m) or None.

    ⚠ `pm` MOVES THE HOUR, it does not decorate it. `2:30 pm` is 14:30: reading
    it as 2:30 would book an appointment TWELVE HOURS too early, and nobody on
    screen would see the mistake — the time would stay plausible.
    """
    trouve = _HEURE.match(texte.strip())
    if not trouve:
        return None
    heure = int(trouve.group(1))
    minute = int(trouve.group(2) or 0)
    moitie = (trouve.group(3) or "").replace(".", "").lower()
    if moitie:
        if not 1 <= heure <= 12:
            return None
        if moitie == "pm" and heure != 12:
            heure += 12
        elif moitie == "am" and heure == 12:
            heure = 0
    if heure > 23 or minute > 59:
        return None
    return heure, minute


def lire_date(texte):
    """Brings a date back to the calendar format (`2026-08-25T09:00`), or None.

    Accepted forms — all the ones a phone agent may return:
    - `2026-08-25T09:00`, with seconds, with a space instead of the `T`, with a UTC offset;
    - `25/08/2026 09:00`, `25/08/2026 à 09h00`;
    - `lundi 25 août 2026 à 9 heures 20`, `25 aout 2026 9h`.

    ⚠ A UTC OFFSET IS STRIPPED, the clock time is kept as it stands. The
    calendar is in local time with no timezone; the agent speaks of French
    times to a French person, and it is that time — the one spoken on the phone
    — that must be found in the schedule.
    """
    brut = " ".join(str(texte or "").split())
    if not brut:
        return None
    # ⚠ `9:00 AM` CARRIES A SPACE, AND THE SPLIT IS MADE AT SPACES. The text is
    # separated into date and time at the LAST space: `August 25, 2026 9:00 AM`
    # was therefore cut between `9:00` and `AM`, and the time became
    # unreadable. am/pm is glued back to its hour before splitting — that is
    # the only normalisation done here, and it changes nothing in French.
    brut = _AM_PM_COLLE.sub(r"\1\2", brut)
    # ① ISO, in all its spellings.
    try:
        quand = datetime.datetime.fromisoformat(brut)
    except ValueError:
        quand = None
    if quand is not None:
        return quand.replace(tzinfo=None).isoformat(timespec="minutes")
    # ② French. Date is separated from time, then each half is read.
    sans_jour = _ARTICLE_ET_JOUR.sub("", brut, count=1).strip()
    # `at` for English, under the same conditions as `à`.
    for separateur in (" à ", " at ", " a ", " "):
        date_dite, _, heure_dite = sans_jour.rpartition(separateur)
        if not date_dite:
            continue
        heure = _heure_lue(heure_dite)
        if heure is None:
            continue
        jour = _date_lue(date_dite.strip())
        if jour is None:
            continue
        # `_date_lue` has already discarded impossible dates: the construction
        # can no longer raise. The net stays, because an exception here would
        # make a real call fail over a typo by the agent.
        try:
            return datetime.datetime(jour[0], jour[1], jour[2],
                                     heure[0], heure[1]).isoformat(
                                         timespec="minutes")
        except ValueError:
            return None
    return None


def _date_lue(texte):
    """`25 août 2026`, `August 25, 2026`, `25/08/2026` → (y, m, d) or None.

    ⚠ IT NEVER RETURNS AN IMPOSSIBLE DATE (01/09/2026). It used to return the
    three numbers as they stood, and it was the caller that built the date — so
    it was the caller that RAISED. Measured: `lire_date("08/25/2026 09:00")`
    raised `ValueError: month must be in 1..12`, uncaught, and the whole call
    was audited as `échec` over a badly formed date. The check belongs here, in
    the only place that knows what the three numbers mean.

    ⚠ AND THE ORDER OF THE NUMBERS IS DEDUCED WHEN IT CAN BE. `25/08/2026` can
    only be read day/month; `08/25/2026` can only be read month/day (an English
    speaker writes it that way). So the matter is settled as soon as one of the
    two numbers exceeds 12. When both are ≤ 12 — `01/02/2026` — NO deduction is
    possible: the French order is kept, the one of this product's calendar.
    That is why the briefing asks for the format `2026-08-15T14:30`, which
    reads only one way.
    """
    trouve = _DATE_FRANCAISE.match(texte)
    if trouve:
        mois = _MOIS_LUS.get(trouve.group(2).lower())
        if mois is None:
            return None
        return _valide(int(trouve.group(3)), mois, int(trouve.group(1)))
    trouve = _DATE_ANGLAISE.match(texte)
    if trouve:
        mois = _MOIS_LUS.get(trouve.group(1).lower())
        if mois is None:
            return None
        return _valide(int(trouve.group(3)), mois, int(trouve.group(2)))
    trouve = _DATE_CHIFFREE.match(texte)
    if trouve:
        premier, second = int(trouve.group(1)), int(trouve.group(2))
        annee = int(trouve.group(3))
        if premier > 12 >= second:
            return _valide(annee, second, premier)       # jour/mois
        if second > 12 >= premier:
            return _valide(annee, premier, second)       # mois/jour (anglais)
        return _valide(annee, second, premier)  # French order
    return None


def _valide(annee, mois, jour):
    """(year, month, day) if that date EXISTS, otherwise None. Never an exception.
    """
    try:
        datetime.date(annee, mois, jour)
    except ValueError:
        return None
    return annee, mois, jour


def _heure_lisible(hhmm):
    """`09:00` becomes `9h00` (French time, no leading zero)."""
    heures, _, minutes = (hhmm or "").partition(":")
    return f"{int(heures)}h{minutes}" if heures.isdigit() else hhmm


def creneaux_lisibles(preferences):
    """The slots ADDED BY HAND, readable: `le 01/08/2026 à 14h00`.

    From the opening hours, the offered slots are COMPUTED (open − already
    taken − closed days): it is horaires.creneaux_lisibles() that returns the
    complete list, and the server passes it here under the name `creneaux`.
    This function stays the hand-typed list, the special case — and the
    fallback when no opening hours are configured.
    """
    # ⚠ SPELLED OUT IN FULL: these slots fill [créneaux_disponibles] in the
    # templates above, and those templates are SPOKEN on the phone.
    creneaux = preferences.obtenir(CLE_CRENEAUX) or []
    return ", ".join(f"le {date_parlee(c)}" for c in creneaux)


def plage(preferences):
    """The configured permitted window, as (`HH:MM`, `HH:MM`)."""
    return (preferences.obtenir(CLE_PLAGE_DEBUT) or PLAGE_DEBUT_DEFAUT,
            preferences.obtenir(CLE_PLAGE_FIN) or PLAGE_FIN_DEFAUT)


def plage_lisible(preferences, langue="fr"):
    """`entre 9h00 et 19h00` — for the templates and the error messages.

    ⚠ IT GOES OUT ON THE PHONE, SO IT FOLLOWS THE LANGUAGE. This sentence is
    inserted into the fallback line dictated to the agent (`qui vous rappellera
    entre…`): left in French in the middle of an English briefing, it would be
    read out as such to an English-speaking patient.
    """
    debut, fin = plage(preferences)
    if langue == "en":
        # `09:00` as it stands: the 24-hour clock is the schedule's, and an
        # opening window does not need am/pm to be read.
        return f"between {debut} and {fin}"
    return f"entre {_heure_lisible(debut)} et {_heure_lisible(fin)}"


# ----------------------------------------------------------- substitutions
def substituer_reglages(texte, preferences, creneaux=None):
    """Substitutes [entreprise], [créneaux_disponibles] and [plage_rappel].

    creneaux: the readable list of slots to offer, COMPUTED from the opening
    hours by the server (horaires.creneaux_lisibles); failing that, the slots
    typed by hand in the settings. A variable with no configured value stays as
    it is, visible and editable — never an invented value. Used by the call
    templates AND the campaign templates (module campagnes).
    """
    entreprise = (preferences.obtenir(CLE_ENTREPRISE) or "").strip()
    if entreprise:
        texte = texte.replace("[entreprise]", entreprise)
    if creneaux is None:
        creneaux = creneaux_lisibles(preferences)
    if creneaux:
        texte = texte.replace("[créneaux_disponibles]", creneaux)
    return texte.replace("[plage_rappel]", plage_lisible(preferences))


def preremplir(code, preferences, nom_client=None, date_rdv=None,
               creneaux=None):
    """The theme's template, pre-filled with the available settings.

    Substitutes [entreprise], [créneaux_disponibles] and [plage_rappel] from
    the settings, and [client] / [date_rdv] when the target appointment is
    already known (single call-back). A variable with no value stays as it is,
    visible and editable — never an invented value. Returns "" for the
    `personnalisé` theme and raises ValueError for an unknown code.
    """
    if code not in GABARITS:
        raise ValueError(f"Thème d'appel inconnu : {code!r}")
    texte = substituer_reglages(GABARITS[code], preferences, creneaux)
    return finaliser(texte, nom_client, date_rdv)


def finaliser(texte, nom_client=None, date_rdv=None):
    """Substitutes [client] and [date_rdv] — called PER CALL by the planner.

    The returned text is what the agent reads: it never contains the phone
    number (no template carries one, and the number is never part of the
    substitutions).
    """
    if nom_client:
        texte = texte.replace("[client]", nom_client)
    if date_rdv:
        # ⚠ SPELLED OUT IN FULL, for the same reason: this text is what the
        # agent reads. `le 01/08/2026 à 14h30` cannot be pronounced.
        texte = texte.replace("[date_rdv]", f"le {date_parlee(date_rdv)}")
    return texte


# ---------------------------------------------------- garde-fou de politesse
def hors_plage(preferences, maintenant=None):
    """Returns a French error message when OUTSIDE the calling window, else None.

    Politeness guard: people are not called outside the configured window
    (9am-7pm by default). Checked at call LAUNCH (single call-back, running the
    queue, cascade) — queueing stays permitted at any hour.
    """
    debut, fin = plage(preferences)
    if maintenant is None:
        maintenant = datetime.datetime.now()
    heure = maintenant.strftime("%H:%M")
    if debut <= heure <= fin:
        return None
    return (f"Appel refusé : il est {_heure_lisible(heure)}, hors de la plage "
            f"d'appel autorisée ({plage_lisible(preferences)}). C'est le "
            "garde-fou de politesse — la plage se règle dans « ⚙ Réglages ».")
