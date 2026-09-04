"""Calendar import in ICS (iCalendar) format — standard library only.

Reads the VEVENT entries of a .ics file: SUMMARY gives the client's name and the reason (separated by a dash or a colon; with no separator, all of it becomes the name), DTSTART gives the date and time. Quirks of the format handled here:
- FOLDED lines (a long line continuing on the next, which begins with a space or a tab) are glued back together — RFC 5545 § 3.1 requires folding beyond 75 bytes, and a real export does it systematically;
- the escaped characters of SUMMARY (\\, \\; \\n …) are restored;
- UTC dates (`Z` suffix) are converted to the machine's LOCAL time (datetime.astimezone, no timezone database required);
- dates with a named timezone (DTSTART;TZID=…) are converted when the machine knows that zone (zoneinfo); otherwise the wall-clock time is kept as it stands — the most honest fallback without a tzdata database;
- dates with no timezone are taken as they stand (local time);
- `all day` events (VALUE=DATE, no time) are REJECTED with a French error: an appointment has a time;
- the END TIME is read (DTEND, or DURATION when the export writes that instead — RFC 5545 § 3.6.1 allows one OR the other, never both) and converted into a number of SLOTS according to the configured step, ROUNDED UP: a one-hour consultation with a 15-minute step occupies 4 slots, and 20 minutes occupy 2 (better to reserve one slot too many than to sell a slot that does not exist). With no readable end time, the appointment is worth one slot, as before;
- STATUS:CANCELLED yields an `annulé` appointment (the other values, CONFIRMED and TENTATIVE, yield `prévu`: on the calendar side they only say the organiser ticked the box, not that the CLIENT confirmed on the phone — that meaning stays reserved to RingBack).

--------------------------------------------------------------------------
WHERE A PHONE NUMBER LIVES IN A REAL .ICS FILE
--------------------------------------------------------------------------
Findings after examining the standard and what Google Calendar and Outlook / Exchange actually write (see exemple_agenda_realiste.ics, which reproduces both structures line by line):

1. ATTENDEE and ORGANIZER carry a CAL-ADDRESS value, that is, a URI. RFC 5545 § 3.3.3: for a mail address the value MUST be a `mailto` URI, but any other URI form registered with IANA is allowed — including `tel:` (RFC 3966). A practice calendar that records the patient as an attendee therefore writes ATTENDEE;CN="Mme Untel":tel:+33639980051. In practice the vast majority of ATTENDEEs stay mailto: — that is an email address, NOT a phone: it is ignored.
2. CONTACT (RFC 5545 § 3.8.4.2) exists exactly for this — `contact information […] associated with the calendar component`. The standard's own examples carry a number: CONTACT:Jim Dolittle\\, ABC Industries\\, +1-919-555-1234 CONTACT;CN="John Smith":tel:+1-617-555-1234 Few consumer calendars write it, but professional software does.
3. DESCRIPTION is BY FAR the most frequent case: it is the event's `notes` field. Booking software (or the practitioner) writes `Téléphone : 06 39 98 00 51` in it. Outlook doubles this field with an X-ALT-DESC;FMTTYPE=text/html carrying the SAME text as HTML.
4. LOCATION sometimes carries the venue's number (rare, and it is the practice's, not the client's): searched last.

Search order chosen, from the most explicit to the least certain: CONTACT, then
ATTENDEE/ORGANIZER as `tel:`, then DESCRIPTION, then X-ALT-DESC, then LOCATION.
In the free-text fields (3 and 4) a number is only kept if it is LABELLED
(`tél`, `téléphone`, `portable`, `mobile`, `GSM`, `n°`…) or if it is the ONLY
plausible number in the text — otherwise nothing is guessed.

The fallback is unchanged and honest: when no number is found, the client is
created WITHOUT one (telephone = ""), and the `à compléter` screen lets it be
filled in afterwards. NO number is ever invented or reconstructed.

Sources: RFC 5545 (§ 3.1 folding, § 3.3.3 CAL-ADDRESS, § 3.8.4.1 ATTENDEE, §
3.8.4.2 CONTACT) — https://www.rfc-editor.org/rfc/rfc5545.html ; RFC 3966 (the
`tel` URI) — https://www.rfc-editor.org/rfc/rfc3966 ; Exchange
X-MICROSOFT-CDO-* properties —
https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/

Every error message is written in French.
"""

import datetime
import re

from . import horaires, saisie

# Separators accepted inside SUMMARY to tell `name` from `reason`.
_SEPARATEURS_SUMMARY = (" — ", " – ", " - ", " : ", ": ")
MOTIF_PAR_DEFAUT = "Rendez-vous importé de l'agenda"

# Properties recorded on top of SUMMARY / DTSTART, in the order a number is
# looked for in them (the first three are explicit, the rest are free text
# where a label is required).
PROPRIETES_TELEPHONE = ("CONTACT", "ATTENDEE", "ORGANIZER", "DESCRIPTION",
                        "X-ALT-DESC", "LOCATION")
_TEXTE_LIBRE = ("DESCRIPTION", "X-ALT-DESC", "LOCATION")

# A plausible French number inside text: +33 / 0033 / 0 then 9 digits,
# separated by a space, dot, dash or non-breaking space, as you like.
_NUMERO = re.compile(
    r"(?:\+\s?33|0033|0)[\s.\- ]?[1-9](?:[\s.\- ]?\d{2}){4}")
# Labels that DESIGNATE a number in free text (`Tél. : …`).
_ETIQUETTE = re.compile(
    r"\b(?:t[ée]l[ée]phones?|t[ée]l|mobile|portable|gsm|phone|"
    r"joignable(?:\s+au)?|num[ée]ro|n[°o])[\s.:=—–-]*$",
    re.IGNORECASE)
_BALISE_HTML = re.compile(r"<[^>]+>")

# A DURATION in RFC 5545 § 3.3.6 format: `PT1H`, `PT1H30M`, `P1DT2H`, `P2W`.
# Seconds are read but count as time, not as a slot of their own: everything
# ends up in minutes.
_DUREE_ICS = re.compile(
    r"^([+-])?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$",
    re.IGNORECASE)


def _deplier(texte):
    """Glues back the folded lines of the ICS format (RFC 5545, section 3.1).

    A line beginning with a space or a tab is the continuation of the previous
    one (the first whitespace character is dropped).
    """
    lignes_brutes = texte.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    lignes = []
    for ligne in lignes_brutes:
        if ligne[:1] in (" ", "\t") and lignes:
            lignes[-1] += ligne[1:]
        else:
            lignes.append(ligne)
    return lignes


def _desechapper(texte):
    """Restores the escaped characters of an ICS value (\\, \\; \\n …)."""
    return re.sub(r"\\([\\;,nN])",
                  lambda m: " " if m.group(1) in "nN" else m.group(1), texte)


def _heure_locale(valeur, parametres):
    """Converts a DTSTART value into local ISO 8601 to the minute.

    Raises ValueError (French message) when the value is unusable.
    """
    parametres = {clef.upper(): val
                  for clef, _, val in (p.partition("=") for p in parametres)}
    if parametres.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", valeur):
        raise ValueError("événement « journée entière » sans heure : un "
                         "rendez-vous doit avoir une heure précise.")
    brut = valeur.rstrip("Zz")
    for gabarit in ("%Y%m%dT%H%M%S", "%Y%m%dT%H%M"):
        try:
            moment = datetime.datetime.strptime(brut, gabarit)
            break
        except ValueError:
            continue
    else:
        raise ValueError(f"date illisible : « {valeur} » (attendu "
                         "AAAAMMJJTHHMMSS, avec « Z » final pour l'UTC).")
    if valeur[-1:] in "Zz":
        # UTC -> the machine's local time (no timezone database required).
        moment = (moment.replace(tzinfo=datetime.timezone.utc)
                  .astimezone().replace(tzinfo=None))
    elif "TZID" in parametres:
        # Named timezone: converted when the machine knows it, otherwise the
        # wall-clock time of the original zone is kept as it stands (honest
        # fallback).
        try:
            import zoneinfo
            fuseau = zoneinfo.ZoneInfo(parametres["TZID"])
            moment = (moment.replace(tzinfo=fuseau)
                      .astimezone().replace(tzinfo=None))
        except Exception:
            pass
    return moment.isoformat(timespec="minutes")


def _minutes_de_duration(valeur):
    """The minutes of an ICS DURATION (`PT1H30M` → 90), or None if unreadable.

    A negative or zero duration returns None: it says nothing usable about how
    long a slot is occupied, and nothing is invented in its place.
    """
    trouve = _DUREE_ICS.match((valeur or "").strip())
    if not trouve:
        return None
    signe, semaines, jours, heures, minutes, secondes = trouve.groups()
    total = 0
    if semaines:
        total += int(semaines) * 7 * 24 * 60
    if jours:
        total += int(jours) * 24 * 60
    if heures:
        total += int(heures) * 60
    if minutes:
        total += int(minutes)
    if secondes:
        total += int(secondes) / 60
    if signe == "-" or total <= 0:
        return None
    return total


def _minutes_occupees(evenement, debut_iso):
    """The event's REAL duration in minutes, or None when it is absent.

    Two possible sources, in the order of the standard (RFC 5545 § 3.6.1: DTEND and DURATION are mutually exclusive, but a damaged export may carry both — DTEND, being more explicit, then wins):
    1. DTEND, read exactly like DTSTART (UTC, named timezone, local time);
    2. DURATION, when the export writes the length rather than the end.
    An end EARLIER than or EQUAL to the start returns nothing: nothing is guessed.
    """
    fin = evenement.pop("dtend", None)
    if fin is not None:
        valeur, parametres = fin
        try:
            fin_iso = _heure_locale(valeur, parametres)
        except ValueError:
            fin_iso = None  # unreadable end: nothing is invented
        if fin_iso:
            ecart = (datetime.datetime.fromisoformat(fin_iso)
                     - datetime.datetime.fromisoformat(debut_iso))
            minutes = ecart.total_seconds() / 60
            if minutes > 0:
                return minutes
    duree = evenement.pop("duration", None)
    if duree is not None:
        return _minutes_de_duration(duree)
    return None


def tranches_de_minutes(minutes, pas):
    """How many SLOTS these minutes occupy, ROUNDED UP.

    Rounding up rather than to the nearest is a deliberate choice:
    under-estimating an occupancy would sell a slot on the phone that is
    already taken, whereas over-estimating costs at worst one slot reserved for
    nothing. 60 minutes at a 15-minute step give 4 slots; 20 minutes give 2.
    Always at least 1.
    """
    if not minutes or minutes <= 0:
        return 1
    pas = max(int(pas or 1), 1)
    return max(1, -(-int(round(minutes)) // pas))


def _numeros_plausibles(texte):
    """The French numbers readable in THIS text: [(number, position)].

    Normalised, without duplicates, in order of appearance. Every candidate
    goes through saisie.valider_telephone: whatever is not a genuine French
    number is discarded, nothing is `repaired` by guesswork.
    """
    trouves, deja_vus = [], set()
    for occurrence in _NUMERO.finditer(texte or ""):
        brut = occurrence.group(0).replace(" ", " ")
        if brut.startswith("0033"):
            brut = "+33" + brut[4:]
        try:
            numero = saisie.valider_telephone(brut)
        except saisie.SaisieInvalide:
            continue
        if numero in deja_vus:
            continue
        deja_vus.add(numero)
        trouves.append((numero, occurrence.start()))
    return trouves


def _numero_dans_texte(texte, exiger_etiquette=True):
    """The number from a text field, or "" when nothing is certain.

    exiger_etiquette=True (notes, location): `Téléphone : 06 39 98 00 51` is
    kept; a text carrying several ten-digit numbers with no label is not —
    there is no guessing which one would be right. exiger_etiquette=False (the
    CONTACT property): the property IS contact information, so its first number
    is the right one.
    """
    texte = _BALISE_HTML.sub(" ", texte or "")
    candidats = _numeros_plausibles(texte)
    if not candidats:
        return ""
    for numero, position in candidats:
        if _ETIQUETTE.search(texte[max(0, position - 40):position]):
            return numero
    if not exiger_etiquette or len(candidats) == 1:
        return candidats[0][0]
    return ""


def _telephone_de_lurl(valeur):
    """The number from a `tel:` CAL-ADDRESS value (RFC 3966), otherwise "".

    A `mailto:` value is an email address: it returns nothing.
    """
    valeur = (valeur or "").strip()
    if not valeur.lower().startswith("tel:"):
        return ""
    candidats = _numeros_plausibles(valeur[4:])
    return candidats[0][0] if candidats else ""


def _telephone_evenement(brut):
    """The client's number found in THIS event, or "" (never invented).

    Order: CONTACT (tel: URI, then text — the property the standard provides
    for this), ATTENDEE / ORGANIZER as `tel:`, then the free-text fields
    (DESCRIPTION, Outlook's X-ALT-DESC, LOCATION).
    """
    for propriete in PROPRIETES_TELEPHONE:
        for valeur in brut.get(propriete, ()):
            if propriete == "CONTACT":
                numero = (_telephone_de_lurl(valeur)
                          or _numero_dans_texte(valeur, exiger_etiquette=False))
            elif propriete in _TEXTE_LIBRE:
                numero = _numero_dans_texte(valeur)
            else:  # ATTENDEE / ORGANIZER: only a `tel:` URI is a number
                numero = _telephone_de_lurl(valeur)
            if numero:
                return numero
    return ""


def _nom_et_motif(summary):
    """Splits `Name — Reason`; with no separator, all of it is the name."""
    for separateur in _SEPARATEURS_SUMMARY:
        if separateur in summary:
            nom, motif = summary.split(separateur, 1)
            return nom.strip(), motif.strip()
    return summary.strip(), MOTIF_PAR_DEFAUT


def analyser_ics(texte):
    """Parses an ICS file; returns (events, errors).

    events = [{"nom", "motif", "horaire", "telephone", "statut", "minutes"}]
    (horaire in local ISO 8601; telephone = "" when the calendar carries none —
    never an invented number; minutes = the duration read from DTEND or
    DURATION, or None when the calendar gives none); errors = French messages,
    one per rejected event. Raises saisie.SaisieInvalide when the file contains
    NO event at all.
    """
    evenements, erreurs = [], []
    courant, numero = None, 0
    for ligne in _deplier(texte):
        entete, _, valeur = ligne.partition(":")
        morceaux = entete.split(";")
        propriete = morceaux[0].strip().upper()
        parametres = morceaux[1:]
        if propriete == "BEGIN" and valeur.strip().upper() == "VEVENT":
            numero += 1
            courant = {"brut": {}}
        elif propriete == "END" and valeur.strip().upper() == "VEVENT":
            if courant is not None:
                erreur = _valider_evenement(courant, numero)
                if erreur:
                    erreurs.append(erreur)
                else:
                    evenements.append(courant)
            courant = None
        elif courant is not None:
            if propriete == "SUMMARY":
                courant["summary"] = _desechapper(valeur.strip())
            elif propriete == "DTSTART":
                courant["dtstart"] = (valeur.strip(), parametres)
            elif propriete == "DTEND":
                courant["dtend"] = (valeur.strip(), parametres)
            elif propriete == "DURATION":
                courant["duration"] = valeur.strip()
            elif propriete == "STATUS":
                courant["status"] = valeur.strip().upper()
            elif propriete in PROPRIETES_TELEPHONE:
                # The same property may occur several times (several
                # ATTENDEEs): they are all kept, in file order.
                courant["brut"].setdefault(propriete, []).append(
                    _desechapper(valeur.strip()))
    if numero == 0:
        raise saisie.SaisieInvalide(
            "Aucun événement (VEVENT) trouvé : est-ce bien un fichier "
            "d'agenda au format ICS ?")
    return evenements, erreurs


def _valider_evenement(evenement, numero):
    """Fills in the event (name, reason, time, phone, status); returns a French
    error or None.
    """
    titre = evenement.pop("summary", "").strip()
    brut = evenement.pop("brut", {})
    statut_ics = evenement.pop("status", "")
    reference = f"Événement n°{numero}" + (f" (« {titre} »)" if titre else "")
    if not titre:
        return f"{reference} : pas de titre (SUMMARY) — impossible d'en tirer un nom."
    if "dtstart" not in evenement:
        return f"{reference} : pas de date (DTSTART)."
    valeur, parametres = evenement.pop("dtstart")
    try:
        evenement["horaire"] = _heure_locale(valeur, parametres)
    except ValueError as erreur:
        return f"{reference} : {erreur}"
    evenement["minutes"] = _minutes_occupees(evenement, evenement["horaire"])
    nom, motif = _nom_et_motif(titre)
    try:
        evenement["nom"] = saisie.valider_nom(nom)
        evenement["motif"] = saisie.valider_motif(motif)
    except saisie.SaisieInvalide as erreur:
        return f"{reference} : {erreur}"
    evenement["telephone"] = _telephone_evenement(brut)
    evenement["statut"] = "annulé" if statut_ics == "CANCELLED" else "prévu"
    return None


def importer_ics(base, texte, preferences=None, remplacer_tout=False,
                 bilan=None):
    """Imports the events of an ICS; returns (imported, errors).

    Every valid event becomes a `prévu` appointment (the missed-appointment
    rule will switch it over if it is already past; STATUS:CANCELLED yields
    `annulé`) attached to a client whose number is the one READ in the calendar
    when it is there — otherwise a client WITHOUT a number, which the `à
    compléter` screen then serves to fill in. As with the CSV: the good events
    import even when others are rejected, each with its own message.

    preferences: the settings, so the STEP (a slot's length) is known. With
    them, the end time read from the calendar becomes a number of slots — a
    one-hour appointment really occupies an hour of the schedule instead of a
    single slot. Without them (isolated tests), the default step applies: the
    duration is still read, never invented.

    remplacer_tout: empties the UPCOMING calendar before importing (the
    `Remplacer entièrement l'agenda` box). The past is not touched.

    bilan: a dictionary TO BE FILLED, when the caller wants to know what the
    import displaced — `remplaces` (appointments whose slot was taken) and
    `vides` (removed by `replace entirely`). A dictionary rather than a third
    return value: twenty callers already unpack that pair, and breaking their
    legs for one count would have been a bad trade.
    """
    # ⚠ `preferences=None` has been accepted by pas_minutes since 10/08/2026:
    # no settings means the default values. The fallback no longer has to be
    # rewritten here.
    pas = horaires.pas_minutes(preferences)
    evenements, erreurs = analyser_ics(texte)
    # ⚠ EMPTY FIRST, IMPORT SECOND. The other way round would have removed the
    # appointments just laid down.
    vides = (horaires.vider_l_agenda_a_venir(base, preferences)
             if remplacer_tout else [])
    importes, remplaces = 0, []
    for evenement in evenements:
        nom = evenement["nom"]
        telephone = evenement.get("telephone") or ""
        client_id = None
        if telephone:
            # Already known under this number (written differently, `+33 …`
            # against `0…`): THEIR record is reused rather than a second one
            # created.
            client_id = base.client_equivalent(nom, telephone)
            if client_id is None:
                # This name is already in the database as `à compléter`: the
                # calendar finally brings its number, so the existing record is
                # completed.
                client_id = base.client_sans_numero_par_nom(nom)
                if client_id is not None:
                    base.mettre_a_jour_telephone(client_id, telephone)
        else:
            # The calendar carries no number: if this name is already known
            # WITH one, the appointment joins that record — nothing is
            # invented, it is only linked to what already exists.
            telephone = base.telephone_par_nom(nom) or ""
        if client_id is None:
            client_id = base.obtenir_ou_creer_client(nom, telephone)
        rdv_id = base.ajouter_rendezvous(
            client_id, evenement["horaire"], evenement["motif"],
            statut=evenement.get("statut", "prévu"),
            duree_tranches=tranches_de_minutes(evenement.get("minutes"), pas))
        # ⚠ AFTER THE INSERT, never before: the time and the duration are read
        # back as they were WRITTEN, and the new one does not get in its own
        # way.
        remplaces.extend(
            horaires.remplacer_sur_le_creneau(base, preferences, rdv_id))
        importes += 1
    if bilan is not None:
        bilan["remplaces"] = remplaces
        bilan["vides"] = vides
    return importes, erreurs
