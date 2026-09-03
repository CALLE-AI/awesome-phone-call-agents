"""Saisie et import : validation des entrées + import CSV.

Tous les messages d'erreur sont en français et destinés à l'écran.
La règle de confidentialité reste la même que partout : un numéro n'est
JAMAIS ré-affiché en clair — seule la personne qui le tape le voit.
"""

import csv
import datetime
import io
import re

COLONNES_CSV = ("nom", "telephone", "date_heure", "motif")


class SaisieInvalide(ValueError):
    """Une entrée saisie ou importée est invalide (message en français)."""


# ------------------------------------------------------------------ champs
def valider_nom(texte):
    """Rend le nom nettoyé (espaces multiples repliés)."""
    nom = " ".join((texte or "").split())
    if len(nom) < 2:
        raise SaisieInvalide("Le nom du client est obligatoire (deux caractères minimum).")
    return nom


def valider_telephone(texte):
    """Rend le numéro normalisé « +33 6 00 00 00 42 » ou « 06 00 00 00 42 ».

    Formats plausibles acceptés : numéro français à 10 chiffres commençant
    par 0, ou +33 suivi de 9 chiffres. Espaces, points et tirets sont
    ignorés à la lecture ; le numéro est reformaté par groupes pour que le
    masquage (db.masquer_telephone) fonctionne toujours.
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
        "ou +33 suivi de 9 chiffres (exemple fictif : +33 6 00 00 00 42).")


# ⚠ DEUX VALIDATEURS, ET LA FRONTIÈRE EST NETTE (01/09/2026).
#
# `valider_telephone` ci-dessus vaut pour les numéros que RingBack APPELLE :
# ceux des contacts. Il reste volontairement français — c'est un cabinet
# français qui appelle des patients français, et une saisie trop large y
# laisserait passer des fautes de frappe au lieu de les arrêter.
#
# `valider_telephone_essai` ci-dessous vaut pour les numéros VERS LESQUELS on
# renvoie : celui de l'opérateur, ceux des testeurs déclarés. Ceux-là peuvent
# être n'importe où dans le monde — un juré de concours qui essaie le produit
# renvoie les appels vers SON téléphone, et il n'est pas forcément en France.
#
# La règle qui protège reste la même des deux côtés : aucun appel ne part vers
# un numéro que l'API ne saurait pas composer (voir calle_client.numero_e164 et
# numero_composable).
_INTERNATIONAL = re.compile(r"\+[1-9]\d{7,14}")


def valider_telephone_essai(texte):
    """Le numéro d'un TESTEUR ou d'un RENVOI — n'importe quel indicatif.

    Rend « +44 20 79 46 09 58 » ou, pour un numéro français, exactement ce que
    rend `valider_telephone` — au caractère près, pour qu'un numéro déjà
    enregistré ne change pas de forme en repassant par ici.

    ⚠ L'INDICATIF NE SE DEVINE PAS — ON LE LIT DANS CE QUI A ÉTÉ TAPÉ. Il fait
    un, deux ou trois chiffres selon le pays (« +1 », « +33 », « +351 ») et
    aucune règle ne permet de le retrouver dans une suite de chiffres collés.
    Alors on ne le devine pas : si la saisie sépare son indicatif d'une espace
    — « +351 21 234 5678 », comme tout le monde l'écrit — on le prend tel
    quel. Sinon on retombe sur un groupement régulier, qui reste lisible même
    s'il coupe l'indicatif au mauvais endroit.

    ⚠ ET LE RESTE EST GROUPÉ DEPUIS LA FIN, ce qui fait tenir le masquage.
    `db.masquer_telephone` garde le PREMIER et le DERNIER groupe : grouper
    depuis la fin garantit que le dernier groupe porte les deux derniers
    chiffres — ceux qui permettent de reconnaître son propre numéro sans le
    montrer.
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
    """(indicatif, le reste) — l'indicatif tel que la saisie le sépare.

    Rend un découpage de repli quand rien ne le sépare : les deux premiers
    chiffres. C'est arbitraire, et c'est assumé — mieux vaut un affichage
    approximatif qu'un indicatif inventé.
    """
    tete = re.match(r"\+\s*(\d{1,3})[\s.\-]", (brut or "").strip())
    if tete and len(tete.group(1)) < len(chiffres):
        indicatif = tete.group(1)
        return indicatif, chiffres[len(indicatif):]
    return chiffres[:2], chiffres[2:]


def valider_horaire(texte):
    """Rend l'horaire en ISO 8601 à la minute (« 2026-08-01T14:30 »).

    Accepte l'ISO 8601 (avec « T » ou une espace) et le format français
    « JJ/MM/AAAA HH:MM ».
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
    """Rend le motif nettoyé."""
    motif = " ".join((texte or "").split())
    if not motif:
        raise SaisieInvalide("Le motif du rendez-vous est obligatoire.")
    return motif


VALIDATEURS = (("nom", valider_nom), ("telephone", valider_telephone),
               ("date_heure", valider_horaire), ("motif", valider_motif))


def valider_entree(nom, telephone, date_heure, motif):
    """Valide les quatre champs ; rend (valeurs propres, liste d'erreurs).

    Toutes les erreurs sont collectées d'un coup pour que l'écran puisse
    les afficher ensemble, plutôt que de les découvrir une par une.
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
    """Valide puis enregistre client + rendez-vous ; rend (client_id, rdv_id).

    Le rendez-vous est créé « prévu » : la règle du manqué
    (db.marquer_manques_echus) le basculera s'il est déjà passé.
    """
    propres, erreurs = valider_entree(nom, telephone, date_heure, motif)
    if erreurs:
        raise SaisieInvalide(" ".join(erreurs))
    client_id = base.obtenir_ou_creer_client(propres["nom"], propres["telephone"])
    rdv_id = base.ajouter_rendezvous(client_id, propres["date_heure"], propres["motif"])
    return client_id, rdv_id


# ------------------------------------------------------- liste de cascade
def analyser_liste_cascade(texte):
    """Analyse la liste collée pour la cascade : une ligne par personne.

    Format « Nom;Téléphone » — la virgule et la tabulation sont aussi
    acceptées comme séparateurs (priorité : tabulation, puis point-virgule,
    puis virgule, pour tolérer une virgule dans le nom). Les lignes vides
    sont ignorées ; chaque ligne fautive produit une erreur française qui
    cite son numéro ; un numéro déjà vu plus haut est signalé comme doublon.
    Rend (personnes, erreurs) où personnes = [{"nom", "telephone"}] dans
    l'ORDRE de la liste — c'est cet ordre que la cascade respecte.
    """
    personnes, erreurs = [], []
    deja_vus = {}  # téléphone normalisé -> numéro de ligne
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
    """Décode un fichier importé : UTF-8 (BOM accepté), sinon cp1252 (Excel)."""
    try:
        return octets.decode("utf-8-sig")
    except UnicodeDecodeError:
        return octets.decode("cp1252")


def importer_csv(base, texte_csv, preferences=None, bilan=None):
    """Importe un CSV « nom;telephone;date_heure;motif » ; rend (importés, erreurs).

    La première ligne doit être l'en-tête exact. Chaque ligne valide est
    enregistrée ; chaque ligne fautive est rejetée avec un message qui cite
    son numéro — un fichier à moitié bon importe quand même ses bonnes lignes.

    ⚠ UNE LIGNE IMPORTÉE PREND LA PLACE DE CE QUI L'OCCUPAIT (10/08/2026) :
    même règle que l'agenda ICS, et le même code — voir
    horaires.remplacer_sur_le_creneau. `bilan` reçoit la liste des rendez-vous
    déplacés, sous la clé « remplaces », quand l'appelant la demande.
    """
    from . import horaires        # tardif : horaires importe db, pas saisie
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
