"""Data entry and import: input validation + CSV import.

Every error message is written in French and meant for the screen — French is
the source language, and the translation layer turns it into English at the
last moment. The privacy rule is the same as everywhere else: a phone number is
NEVER shown again in clear — only the person typing it sees it.
"""

import csv
import datetime
import io
import re

COLONNES_CSV = ("nom", "telephone", "date_heure", "motif")


class SaisieInvalide(ValueError):
    """A typed or imported entry is invalid (message written in French)."""


# ------------------------------------------------------------------ champs
def valider_nom(texte):
    """Returns the cleaned-up name (runs of spaces folded)."""
    nom = " ".join((texte or "").split())
    if len(nom) < 2:
        raise SaisieInvalide("Le nom du client est obligatoire (deux caractères minimum).")
    return nom


def valider_telephone(texte):
    """Returns the number normalised as `+33 6 39 98 50 42` or `06 39 98 50 42`.

    Plausible formats accepted: a 10-digit French number starting with 0, or
    +33 followed by 9 digits. Spaces, dots and dashes are ignored while
    reading; the number is regrouped so that masking (db.masquer_telephone)
    always works.
    """
    compact = re.sub(r"[ .\-]", "", texte or "")
    if re.fullmatch(r"\+33[1-9]\d{8}", compact):
        chiffres = compact[3:]
        groupes = ["+33", chiffres[0]] + [chiffres[i:i + 2] for i in range(1, 9, 2)]
        return " ".join(groupes)
    if re.fullmatch(r"0[1-9]\d{8}", compact):
        return " ".join(compact[i:i + 2] for i in range(0, 10, 2))
    raise SaisieInvalide(
        "Numéro de téléphone invalide : attendu 10 chiffres commençant par 0, "
        "ou +33 suivi de 9 chiffres (exemple fictif : +33 6 39 98 50 42).")


# ⚠ TWO VALIDATORS, AND THE BORDER BETWEEN THEM IS SHARP (01/09/2026).
# `valider_telephone` above covers the numbers RingBack DIALS: the contacts'.
# It stays French on purpose — a French practice calling French patients, and a
# looser check there would let typos through instead of stopping them.
# `valider_telephone_essai` below covers the numbers calls are REDIRECTED TO:
# the operator's own, and those of declared testers. Those may be anywhere in
# the world — a contest judge trying the product redirects the calls to THEIR
# phone, and they are not necessarily in France. The rule that protects is the
# same on both sides: no call goes out to a number the API could not dial (see
# calle_client.numero_e164 and numero_composable).
_INTERNATIONAL = re.compile(r"\+[1-9]\d{7,14}")


def valider_telephone_essai(texte):
    """A TESTER's or a REDIRECT number — any dialling code.

    Returns `+44 20 79 46 09 58` or, for a French number, exactly what
    `valider_telephone` returns — character for character, so that an already
    stored number does not change shape by passing through here.

    ⚠ THE DIALLING CODE IS NOT GUESSED — IT IS READ FROM WHAT WAS TYPED. It is
    one, two or three digits depending on the country (`+1`, `+33`, `+351`) and
    no rule can recover it from a run of digits with no separator. So it is not
    guessed: if the input separates its dialling code with a space — `+351 21
    234 5678`, the way everyone writes it — it is taken as it stands. Otherwise
    the number falls back to regular grouping, which stays readable even when
    it cuts the dialling code in the wrong place.

    ⚠ AND THE REST IS GROUPED FROM THE END, which is what keeps masking
    working. `db.masquer_telephone` keeps the FIRST and the LAST group:
    grouping from the end guarantees the last group carries the final two
    digits — the ones that let someone recognise their own number without it
    being shown.
    """
    brut = (texte or "").strip()
    try:
        return valider_telephone(brut)
    except SaisieInvalide:
        pass
    compact = re.sub(r"[ .\-]", "", brut)
    if not _INTERNATIONAL.fullmatch(compact):
        raise SaisieInvalide(
            "Numéro de téléphone invalide : attendu un numéro français "
            "(10 chiffres commençant par 0), ou un numéro international avec "
            "son indicatif — « + » suivi de 8 à 15 chiffres "
            "(exemple fictif : +44 20 7946 0958).")
    indicatif, chiffres = _indicatif_lu(brut, compact[1:])
    reste = len(chiffres) % 2
    groupes = ([chiffres[:reste]] if reste else []) + [
        chiffres[i:i + 2] for i in range(reste, len(chiffres), 2)]
    return " ".join(["+" + indicatif] + groupes)


def _indicatif_lu(brut, chiffres):
    """(dialling code, the rest) — the dialling code as the input separates it.

    Returns a fallback split when nothing separates it: the first two digits.
    That is arbitrary, and deliberately so — an approximate display beats an
    invented dialling code.
    """
    tete = re.match(r"\+\s*(\d{1,3})[\s.\-]", (brut or "").strip())
    if tete and len(tete.group(1)) < len(chiffres):
        indicatif = tete.group(1)
        return indicatif, chiffres[len(indicatif):]
    return chiffres[:2], chiffres[2:]


def valider_horaire(texte):
    """Returns the time as ISO 8601 to the minute (`2026-08-01T14:30`).

    Accepts ISO 8601 (with a `T` or a space) and the French format `DD/MM/YYYY
    HH:MM`.
    """
    brut = (texte or "").strip()
    if not brut:
        raise SaisieInvalide("La date et l'heure du rendez-vous sont obligatoires.")
    try:
        horaire = datetime.datetime.fromisoformat(brut)
    except ValueError:
        try:
            horaire = datetime.datetime.strptime(brut, "%d/%m/%Y %H:%M")
        except ValueError:
            raise SaisieInvalide(
                f"Date illisible : « {brut} ». Formats acceptés : "
                "2026-08-01T14:30 ou 01/08/2026 14:30.") from None
    return horaire.isoformat(timespec="minutes")


def valider_motif(texte):
    """Returns the cleaned-up reason."""
    motif = " ".join((texte or "").split())
    if not motif:
        raise SaisieInvalide("Le motif du rendez-vous est obligatoire.")
    return motif


VALIDATEURS = (("nom", valider_nom), ("telephone", valider_telephone),
               ("date_heure", valider_horaire), ("motif", valider_motif))


def valider_entree(nom, telephone, date_heure, motif):
    """Validates the four fields; returns (clean values, list of errors).

    Every error is collected in one pass so the screen can show them together,
    rather than letting the user discover them one at a time.
    """
    brut = {"nom": nom, "telephone": telephone,
            "date_heure": date_heure, "motif": motif}
    propres, erreurs = {}, []
    for champ, valider in VALIDATEURS:
        try:
            propres[champ] = valider(brut[champ])
        except SaisieInvalide as erreur:
            erreurs.append(str(erreur))
    return propres, erreurs


def enregistrer_rendezvous(base, nom, telephone, date_heure, motif):
    """Validates then records client + appointment; returns (client_id, rdv_id).

    The appointment is created as `prévu` (scheduled): the missed-appointment
    rule (db.marquer_manques_echus) will switch it over if it is already in the
    past.
    """
    propres, erreurs = valider_entree(nom, telephone, date_heure, motif)
    if erreurs:
        raise SaisieInvalide(" ".join(erreurs))
    client_id = base.obtenir_ou_creer_client(propres["nom"], propres["telephone"])
    rdv_id = base.ajouter_rendezvous(client_id, propres["date_heure"], propres["motif"])
    return client_id, rdv_id


# ------------------------------------------------------- liste de cascade
def analyser_liste_cascade(texte):
    """Parses the pasted list for the cascade: one line per person.

    Format `Name;Phone` — commas and tabs are accepted as separators too
    (priority: tab, then semicolon, then comma, so that a comma inside a name
    is tolerated). Blank lines are ignored; each faulty line produces a French
    error quoting its line number; a number already seen above is reported as a
    duplicate. Returns (people, errors) where people = [{"nom", "telephone"}]
    in the ORDER of the list — that order is what the cascade follows.
    """
    personnes, erreurs = [], []
    deja_vus = {}  # normalised phone -> line number
    for numero, ligne in enumerate((texte or "").splitlines(), start=1):
        if not ligne.strip():
            continue
        for separateur in ("\t", ";", ","):
            if separateur in ligne:
                break
        else:
            erreurs.append(f"Ligne {numero} : séparateur introuvable — "
                           "attendu « Nom;Téléphone » (ou virgule, ou tabulation).")
            continue
        morceaux = [morceau.strip() for morceau in ligne.split(separateur)]
        if len(morceaux) != 2:
            erreurs.append(f"Ligne {numero} : 2 colonnes attendues "
                           f"(Nom;Téléphone), {len(morceaux)} reçue(s).")
            continue
        try:
            nom = valider_nom(morceaux[0])
            telephone = valider_telephone(morceaux[1])
        except SaisieInvalide as erreur:
            erreurs.append(f"Ligne {numero} : {erreur}")
            continue
        if telephone in deja_vus:
            erreurs.append(f"Ligne {numero} : même numéro que la ligne "
                           f"{deja_vus[telephone]} — doublon ignoré.")
            continue
        deja_vus[telephone] = numero
        personnes.append({"nom": nom, "telephone": telephone})
    if not personnes and not erreurs:
        erreurs.append("Liste vide : collez une ligne par personne (« Nom;Téléphone »).")
    return personnes, erreurs


# -------------------------------------------------------------------- CSV
def decoder_csv(octets):
    """Decodes an imported file: UTF-8 (BOM accepted), otherwise cp1252 (Excel).
    """
    try:
        return octets.decode("utf-8-sig")
    except UnicodeDecodeError:
        return octets.decode("cp1252")


def importer_csv(base, texte_csv, preferences=None, bilan=None):
    """Imports a CSV `nom;telephone;date_heure;motif`; returns (imported, errors).

    The first line must be the exact header. Every valid line is recorded;
    every faulty line is rejected with a message quoting its line number — a
    half-good file still imports its good lines.

    ⚠ AN IMPORTED LINE TAKES THE PLACE OF WHATEVER OCCUPIED THE SLOT
    (10/08/2026): the same rule as the ICS calendar, and the same code — see
    horaires.remplacer_sur_le_creneau. `bilan` receives the list of displaced
    appointments, under the key `remplaces`, when the caller asks for it.
    """
    from . import horaires  # late: horaires imports db, not saisie
    lignes = [(numero, cellules)
              for numero, cellules in enumerate(csv.reader(io.StringIO(texte_csv),
                                                           delimiter=";"), start=1)
              if any(cellule.strip() for cellule in cellules)]
    if not lignes:
        raise SaisieInvalide("Fichier vide : aucune ligne à importer.")
    entete = [cellule.strip().lower() for cellule in lignes[0][1]]
    if entete != list(COLONNES_CSV):
        raise SaisieInvalide(
            "En-tête invalide : attendu « nom;telephone;date_heure;motif », "
            f"reçu « {';'.join(entete)} ».")
    importes, erreurs, remplaces = 0, [], []
    for numero, cellules in lignes[1:]:
        if len(cellules) != len(COLONNES_CSV):
            erreurs.append(f"Ligne {numero} : {len(cellules)} colonne(s) au lieu de 4.")
            continue
        try:
            _, rdv_id = enregistrer_rendezvous(base, *cellules)
        except SaisieInvalide as erreur:
            erreurs.append(f"Ligne {numero} : {erreur}")
            continue
        remplaces.extend(
            horaires.remplacer_sur_le_creneau(base, preferences, rdv_id))
        importes += 1
    if bilan is not None:
        bilan["remplaces"] = remplaces
    return importes, erreurs
