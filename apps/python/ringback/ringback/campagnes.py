"""Campagnes : des THÈMES DE TRAVAIL instanciés sur une liste de l'instant.

Le modèle du produit : RingBack ne tourne plus autour de la base mais de
l'ÉVÉNEMENT. Une campagne = un thème de travail + une liste de contacts
importée à ce moment (collage, CSV, ICS ou reprise depuis la base) + les
paramètres de l'instant (mission modifiable, créneau, sujet) + les appels
rattachés + un statut (en cours / terminée / close).

Trois thèmes de travail — ceux des parcours DIRECTS (la file d'appels et la
cascade), plus anciens que l'assistant en 3 étapes :
- creneau_libere : la cascade « premier oui » existante, RATTACHÉE à la
  campagne (la mécanique de cascade n'est pas dupliquée) ;
- confirmation  : chaque contact est appelé pour confirmer son rendez-vous
  (confirmé / déplacé / annulé / à relancer) ;
- manque        : rappel de RENDEZ-VOUS manqués, en lot.

⚠ « contact_unique » et « personnalise » ont été retirés le 03/08/2026, avec
les natures d'assistant du même nom : ils n'écrivaient rien dans le carnet de
rendez-vous. On ne peut plus en créer. Les campagnes DÉJÀ en base gardent leur
nom à l'écran — voir THEMES_RETIRES : une campagne qu'on ne sait plus nommer
serait une donnée perdue.

RELANCES PROGRAMMÉES — le cœur : tout appel NON ABOUTI (pas de réponse,
échec technique, déplacement non conclu « to_reschedule », refus à
requalifier en cascade épuisée) crée une relance planifiée qui CONSERVE le
thème et les paramètres de la campagne. Échéance = maintenant + délai
réglable compté en HEURES OUVRÉES dans la plage d'appel autorisée ;
échéance modifiable, tentatives comptées (max réglable). Une relance ne
part JAMAIS seule : c'est un geste humain (« Lancer les relances dues »),
et les MÊMES verrous s'appliquent (plage horaire + les trois verrous
d'appels réels du planificateur, jamais dupliqués — voir
Planificateur.verifier_garde_fous).
"""

import datetime
import logging

from . import calle_client, db, horaires, planificateur, saisie, themes
from .saisie import SaisieInvalide

journal = logging.getLogger("ringback.campagnes")

# ------------------------------------------------------- thèmes de travail
# Les thèmes qu'on peut encore INSTANCIER (parcours directs : file, cascade).
THEMES_CAMPAGNE = {
    # La cascade est une OPTION de la campagne, pas la nature elle-même :
    # le nom reste « Créneau libéré » (politique d'appel affichée à part).
    "creneau_libere": "Créneau libéré",
    "confirmation": "Confirmation de rendez-vous",
    "manque": "Rappel de rendez-vous manqués",
}

# Les thèmes RETIRÉS, gardés pour NOMMER les campagnes déjà en base. On ne
# peut plus en créer (ils ne sont pas dans _GABARIT_PAR_THEME), on peut
# toujours les lire — même règle que assistant.NATURES_RETIREES.
THEMES_RETIRES = {
    "contact_unique": "Contact unique avec sujet (retiré)",
    "personnalise": "Personnalisé (retiré)",
}

# Thème de campagne -> gabarit de mission (les gabarits d'appel existants
# sont RÉUTILISÉS, pas recopiés).
_GABARIT_PAR_THEME = {
    "creneau_libere": lambda: themes.GABARITS["creneau_libere"],
    "confirmation": lambda: themes.GABARITS["confirmation"],
    "manque": lambda: themes.GABARITS["manque"],
}


def libelle_theme(theme):
    """Le nom lisible d'un thème — les retirés compris.

    Tout ce qui AFFICHE une campagne passe par ici. Un code inconnu revient
    tel quel : on ne fabrique pas un libellé pour une valeur qu'on ne
    reconnaît pas.
    """
    return (THEMES_CAMPAGNE.get(theme) or THEMES_RETIRES.get(theme) or theme)

# --------------------------------------------------------------- réglages
CLE_RELANCE_DELAI = "relance_delai_heures"      # heures OUVRÉES dans la plage
CLE_RELANCE_MAX = "relance_max_tentatives"      # relances max par contact
RELANCE_DELAI_DEFAUT = 4
# UN SEUL rappel par défaut (décision du propriétaire, 02/08/2026). Trois
# était le réglage d'origine ; appeler trois fois quelqu'un qui n'a pas
# décroché tient plus de l'insistance que du service, et le plafond est de
# toute façon relevable campagne par campagne comme dans les Réglages.
RELANCE_MAX_DEFAUT = 1

# Issues d'appel classées : ce qui clôt la chaîne, et le motif de relance.
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
    # La conversation a eu lieu ; c'est RingBack qui n'a pas su lire ce que
    # CALL-E en a rendu. Le libellé ne met JAMAIS cela sur le dos du contact.
    "reponse_illisible": "Réponse illisible par RingBack — à rappeler par un "
                         "humain",
}


ANCIEN_RELANCE_MAX_DEFAUT = 3


def reprendre_ancien_plafond_de_relances(preferences):
    """Ramène à 1 un plafond de rappels qui valait l'ANCIEN défaut (3).

    Le propriétaire a demandé le 02/08/2026 que le plafond parte à 1. Changer
    la constante ne suffisait pas : son installation portait déjà 3, écrit
    par l'ancien défaut à la première ouverture des Réglages — pas choisi.
    Il aurait donc continué de voir 3 après avoir demandé 1.

    On ne touche QUE la valeur qui vaut exactement l'ancien défaut : un
    plafond réglé à 2, 5 ou 0 est un choix, et il est respecté. Le réglage
    reste modifiable en deux clics dans ⚙ Réglages → 📞 Appels → Relances.
    """
    if preferences.obtenir(CLE_RELANCE_MAX) == ANCIEN_RELANCE_MAX_DEFAUT:
        preferences.definir(CLE_RELANCE_MAX, RELANCE_MAX_DEFAUT)
        journal.info("Maximum de rappels ramené de %d à %d (ancien défaut, "
                     "jamais choisi) — modifiable dans ⚙ Réglages.",
                     ANCIEN_RELANCE_MAX_DEFAUT, RELANCE_MAX_DEFAUT)
        return True
    return False


# L'ancienne politique du DÉPLACEMENT, celle de la §8.2 avant sa correction du
# 16/08/2026. Voir `reprendre_ancienne_politique_de_deplacement`.
ANCIENNE_POLITIQUE_DEPLACEMENT = "premier_oui"
CLE_COMPORTEMENT_DEPLACEMENT = "comportement_deplacement"


def reprendre_ancienne_politique_de_deplacement(preferences):
    """Retire du réglage du DÉPLACEMENT une politique qui vaut l'ANCIEN défaut.

    ⚠ MÊME CAS QUE LE PLAFOND DE RAPPELS ci-dessus, et même remède. La §8.2
    disait « un déplacement accepté ARRÊTE la campagne » ; c'était une
    proposition de l'assistant, jamais confirmée, corrigée le 16/08/2026 : un
    déplacement appelle TOUT LE MONDE.

    Changer le défaut de la nature ne suffisait pas. L'écran « Options de
    comportement » enregistre TOUT son bloc, quel que soit le champ qu'on
    venait modifier : en réglant son créneau de rappel (12h-14h), le
    propriétaire a figé au passage la politique AFFICHÉE — l'ancien défaut.
    Mesuré dans son fichier : « politique: premier_oui » sur le déplacement.

    Il a donc revu sa campagne s'arrêter au premier contact APRÈS la
    correction — 1 accepté, 10 « pas appelé » — et le correctif lui était
    invisible. C'est très exactement ce qu'il redoutait : « attention de ne pas
    retomber dans le piège de corrections qui ne servent à rien ».

    ⚠ ON NE TOUCHE QUE LA VALEUR QUI VAUT L'ANCIEN DÉFAUT. Un déplacement
    volontairement réglé sur autre chose serait un choix, et il est respecté.
    Le réglage reste modifiable en deux clics dans ⚙ Réglages → ⚙ Options de
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
    """(délai en heures ouvrées, nombre maximal de relances) depuis les réglages."""
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
    """La mission pré-remplie du thème de campagne — MODIFIABLE à l'écran.

    Substitue les réglages ([entreprise], [créneaux_disponibles],
    [plage_rappel]) et [sujet] s'il est connu ; [client], [date_rdv] et
    [créneau] restent substitués PAR APPEL. Lève ValueError pour un thème
    inconnu.
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
    """Un nom de campagne auto, lisible : « Créneau libéré du 03/08 14h — 28/07 ».

    `sujet` n'est plus employé : il ne servait qu'au thème « contact unique »,
    retiré le 03/08/2026. Le paramètre reste pour ne pas casser les appelants.
    """
    if quand is None:
        quand = datetime.date.today()
    jour = f"{quand:%d/%m}"
    if theme == "creneau_libere" and creneau:
        return f"Créneau libéré du {_creneau_court(creneau)} — {jour}"
    if theme == "confirmation":
        return f"Confirmation de rendez-vous ({nb_contacts} contact(s)) — {jour}"
    return (f"{libelle_theme(theme)} ({nb_contacts} contact(s)) — {jour}")


# --------------------------------------------- échéance en heures ouvrées
# BUTÉE de recherche d'un jour ouvert. Une relance ne peut échoir que quand
# quelqu'un travaille ; si TOUT est fermé sur cette durée (semaine type vide
# de partout, ou une année entière déclarée fermée), on cesse de chercher
# plutôt que de tourner sans fin — et on DIT ce qu'on fait : le calcul
# retombe alors sur la seule règle qui reste, la plage horaire seule, avec
# un avertissement au journal. Aucune relance n'est perdue.
JOURS_CHERCHES_ECHEANCE = 366


def _minutes_hhmm(texte):
    """« 09:30 » devient 570 (minutes depuis minuit)."""
    heures, _, minutes = (texte or "").partition(":")
    return int(heures) * 60 + int(minutes)


def jour_travaille(jour, preferences):
    """Vrai si le cabinet travaille CE jour-là (semaine type + jours fermés).

    Deux règles, aucune dupliquée : les jours fermés déclarés
    (horaires.est_ferme) et les jours ouverts de la semaine type
    (horaires.semaine). Tant qu'AUCUNE semaine type n'est réglée, RingBack
    ne connaît pas les jours ouverts et n'en invente pas : tous les jours
    restent possibles, exactement comme avant.
    """
    if horaires.est_ferme(preferences, jour) is not None:
        return False
    if not horaires.semaine_ouverte(preferences):
        return True
    return bool(horaires.semaine(preferences)[jour.weekday()])


def _fenetres_appelables(jour, debut, fin, preferences):
    """Les intervalles [début, fin[ EN MINUTES où une relance peut échoir.

    La plage d'appel autorisée, PRIVÉE de la période interdite (qui peut
    traverser minuit, elle découpe alors la plage en deux morceaux). Rend
    une liste vide quand le jour est fermé ou quand l'interdit recouvre
    toute la plage : ce jour-là ne compte aucune heure ouvrée.
    """
    ouverture, fermeture = _minutes_hhmm(debut), _minutes_hhmm(fin)
    if fermeture <= ouverture:
        return []
    periode = None
    if preferences is not None:
        if not jour_travaille(jour, preferences):
            return []
        # Import local : assistant importe ce module, l'inverse ne peut pas
        # se faire en tête de fichier.
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
    """L'échéance après « heures » comptées quand le cabinet TRAVAILLE.

    debut/fin : « HH:MM » (la plage des réglages). Le temps hors plage ne
    compte pas : « +4 h ouvrées » demandées à 18 h avec une plage 9h-19h
    donnent 12 h le lendemain. Un départ hors plage est d'abord ramené à la
    prochaine ouverture ; heures=0 rend cette prochaine ouverture (ou
    l'instant même s'il est déjà dans la plage).

    preferences : les réglages. Avec eux, l'échéance respecte EN PLUS la
    période interdite, les jours ouverts de la semaine type et les jours
    fermés déclarés — une relance ne tombe donc jamais un jour où personne
    ne travaille, et « en cas de demande de rappel, un salarié peut le
    faire ». Sans eux (essais isolés, appels historiques), seule la plage
    horaire est connue : le calcul est exactement celui d'avant.
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
            # Le compte tombe PILE au bout de la fenêtre : acceptable si
            # c'est la fin de la plage d'appel (19h00 y est encore permis),
            # mais pas si c'est la période interdite qui a coupé là — on
            # n'échoit pas à l'instant même où les appels redeviennent
            # interdits. Le reste passe alors à zéro et l'échéance devient
            # le début de la fenêtre suivante, où quelqu'un peut appeler.
            if disponible > restant or (disponible == restant
                                        and f_fin == fin_de_plage):
                return moment + restant
            restant -= disponible
        jour += datetime.timedelta(days=1)
    if preferences is None:
        raise ValueError(
            "Échéance de relance introuvable : plage horaire invalide.")
    # Butée atteinte : rien d'ouvert sur une année entière. On le DIT, et on
    # retombe sur la plage horaire seule plutôt que de perdre la relance.
    journal.warning(
        "Aucun jour ouvert trouvé dans les %d prochains jours (semaine type "
        "et jours fermés) : l'échéance de relance est calculée sur la seule "
        "plage d'appel %s-%s. Ouvrez des jours dans « ⚙ Réglages » pour "
        "qu'elle retombe sur un jour travaillé.",
        JOURS_CHERCHES_ECHEANCE, debut, fin)
    return echeance_apres_heures_ouvrees(maintenant, heures, debut, fin)


def echeance_relance(preferences, maintenant=None):
    """L'échéance de la prochaine relance selon les réglages, en ISO 8601."""
    if maintenant is None:
        maintenant = datetime.datetime.now()
    delai, _ = parametres_relance(preferences)
    debut, fin = themes.plage(preferences)
    echeance = echeance_apres_heures_ouvrees(maintenant, delai, debut, fin,
                                             preferences)
    return echeance.isoformat(timespec="minutes")


# ------------------------------------------------- listes de l'instant
def analyser_csv_contacts(texte):
    """Analyse un CSV de contacts pour une campagne ; rend (personnes, erreurs).

    En-tête attendu : « nom;telephone » — les colonnes supplémentaires de
    l'ancien format (date_heure;motif) sont tolérées et ignorées : seule la
    liste de l'instant compte, la base n'est pas modifiée. Doublons signalés.
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
    """Contacts liés aux rendez-vous « prévu » (à venir) ou « manqué ».

    Rend (contacts, sans_numero, exclus_stop) — contacts =
    [{"nom", "telephone", "rendezvous_id"}] avec le numéro EN CLAIR (usage
    interne : composition d'une liste d'appel demandée explicitement).
    Les contacts 🚫 « Ne plus appeler » et les sans-numéro sont écartés et
    comptés ; un même client n'apparaît qu'une fois (premier rendez-vous).

    `ecartes` : dictionnaire À REMPLIR quand l'appelant fait PLUSIEURS appels
    et doit compter les écartés une seule fois par personne. Il reçoit deux
    ensembles d'identifiants de client, « sans_numero » et « stop », que
    l'appelant réunit d'un appel à l'autre. Les deux comptes rendus restent là
    pour les vingt appelants qui n'en ont pas besoin.

    ⚠ POURQUOI CE DICTIONNAIRE EXISTE (14/08/2026, audit croisé). Le rappel
    « jours choisis » appelle cette fonction UNE FOIS PAR JOUR et additionnait
    les comptes : une personne ayant un rendez-vous le lundi ET le vendredi
    était comptée deux fois parmi les écartés, alors que la liste, elle, la
    dédoublonnait. L'écran annonçait donc « 2 sans numéro écarté(s) » là où il
    n'y avait qu'une personne — le défaut même que le propriétaire avait
    signalé la veille sur un autre écran.

    `debut` / `fin` (texte ISO, intervalle SEMI-OUVERT) bornent la période :
    c'est ce qui permet de bâtir une campagne « la semaine 48 » ou « le
    mardi » (02/08/2026). Sans bornes, le comportement ne change pas d'un
    caractère — et surtout, les règles d'exclusion ci-dessous restent les
    mêmes dans les deux cas : elles ne sont écrites qu'une fois.
    """
    if statut not in ("prévu", "manqué", "poses", "a_recaser"):
        raise ValueError(f"Statut de reprise inconnu : {statut!r}")
    # ⚠ « poses » = ce que le PLANNING montre : prévus ET confirmés. Un
    # rendez-vous confirmé occupe une place et mérite un rappel — le laisser
    # de côté faisait qu'une semaine affichant 13 rendez-vous n'en reprenait
    # que quelques-uns, et parfois aucun (constaté par le propriétaire le
    # 02/08/2026 : « erreur 409 alors qu'il y a bien un rendez-vous »).
    statuts = horaires.STATUTS_OCCUPANTS if statut == "poses" else (statut,)
    # « a_recaser » : annulés + manqués + déplacés SANS rendez-vous à
    # venir. Ce « sans rendez-vous à venir » ne s'exprime pas par un
    # filtre de statut : il a sa requête. La suite est commune —
    # écarter les « ne plus appeler », les sans-numéro, les doublons
    # ne doit exister qu'à un seul endroit.
    if statut == "a_recaser":
        lignes = base.rendezvous_a_recaser(debut, fin)
    elif debut or fin:
        # ⚠ « OU », PAS « ET » (09/08/2026). Une seule borne est un cas
        # légitime — « depuis la place, sans limite » — et l'exiger par paire
        # la faisait tomber ENTIÈREMENT : la règle reprenait alors tous les
        # rendez-vous à venir, y compris ceux d'AVANT la place, à qui
        # l'avancer n'apporte rien. Le même piège avait déjà été corrigé dans
        # `rendezvous_a_recaser` le 03/08 ; il restait ici.
        lignes = base.rendezvous_de_periode(debut, fin, statuts=statuts)
    elif statut == "poses":
        lignes = base.rendezvous_a_venir_tous()
    elif statut == "prévu":
        lignes = base.rendezvous_a_venir()
    else:
        lignes = base.rendezvous_manques()
    # ⚠ ON COMPTE DES PERSONNES, PAS DES RENDEZ-VOUS (13/08/2026). L'écran
    # écrit « 63 client(s) sans numéro écarté(s) » : il comptait les LIGNES
    # d'agenda, et une même personne sans numéro en a dix. Le propriétaire a
    # lu « 101 client(s) sans numéro » dans sa base — le vrai nombre de gens
    # était bien plus petit, et ce chiffre gonflé l'a envoyé chercher au
    # mauvais endroit. Un compte de personnes est ce que la phrase promet.
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


# ------------------------------------------------------ création + appels
def creer_campagne(base, theme, contacts, mission, creneau=None, sujet="",
                   cascade_id=None, quand=None):
    """Crée la campagne et ses contacts (etat « à appeler ») ; rend son id."""
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
    """Statut « en cours » tant qu'une relance est planifiée, sinon « terminée ».

    Une campagne close à la main le reste. Rend le statut retenu.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if campagne is None or campagne["statut"] in ("close", "en pause"):
        # « en pause » se respecte comme « close » : une campagne arrêtée par
        # une panne DE NOTRE CÔTÉ ne doit pas être déclarée « terminée » au
        # premier recalcul — elle attend d'être reprise, telle quelle.
        return campagne["statut"] if campagne else None
    if campagne.get("nature"):
        # Campagne de l'assistant : son statut (prête, en cours, en pause,
        # arrêtée, terminée) est piloté par son moteur — on n'y touche pas.
        return campagne["statut"]
    pendantes = [r for r in base.relances_de_campagne(campagne_id)
                 if r["statut"] == "planifiée"]
    statut = "en cours" if pendantes else "terminée"
    if statut != campagne["statut"]:
        base.changer_statut_campagne(campagne_id, statut)
    return statut


def clore_campagne(base, campagne_id):
    """Clôture manuelle : les relances planifiées sont annulées ; rend leur nombre."""
    annulees = base.annuler_relances_campagne(campagne_id)
    # ⚠ LE TROISIÈME MOMENT. Clore à la main annule les relances : plus aucune
    # tentative ne viendra, et les déplacements restés en suspens sont donc
    # tranchés ici aussi. L'ordre compte — les relances tombent D'ABORD, sans
    # quoi la clôture croirait qu'on va encore rappeler.
    from . import assistant as _assistant
    _assistant.cloturer_les_deplacements_non_faits(
        base, base.obtenir_campagne(campagne_id))
    base.changer_statut_campagne(campagne_id, "close")
    journal.info("Campagne n°%d close à la main (%d relance(s) annulée(s))",
                 campagne_id, annulees)
    return annulees


def _planifier_relance(base, preferences, campagne_id, contact_id, motif,
                       tentative, maintenant=None):
    """Programme la relance « tentative » si le maximum le permet.

    Rend l'identifiant de la relance, ou None si le maximum de tentatives
    est atteint (le contact passe alors « abandonné » chez l'appelant).
    """
    _, maximum = parametres_relance(preferences)
    if tentative > maximum:
        return None
    echeance = echeance_relance(preferences, maintenant)
    return base.creer_relance(campagne_id, contact_id, echeance,
                              tentative=tentative, motif=motif)


def _issue_apres_echec(base, preferences, campagne, contact_id, issue, motif,
                       tentative_suivante, maintenant=None):
    """Trace un appel non abouti : relance programmée ou chaîne abandonnée."""
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
    """Le rendez-vous « support » de l'appel classique + la date pour [date_rdv].

    Contact repris de la base : SON rendez-vous. Contact collé : un support
    synthétique construit sur le créneau de la campagne (ou l'instant) —
    il n'est PAS écrit en base, il sert seulement au client d'appels.
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
    """Répercute une issue ABOUTIE d'appel de campagne sur la base.

    Contact lié à un rendez-vous : la logique existante du planificateur
    est réutilisée (confirmé / décalage intelligent / annulé). Contact sans
    rendez-vous : l'issue crée ce qui manque (un rendez-vous confirmé ou
    prévu à la date convenue) — un « canceled » ne crée rien.

    Rend le message de REFUS si la date convenue ne tient pas (jour fermé,
    hors horaires, place prise, durée trop courte) : rien n'est alors écrit.
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
        # ⚠ « confirmé » DANS LES DEUX CAS (17/08/2026). Les deux façons
        # d'accepter au téléphone donnaient ici deux états différents —
        # « confirmé » pour le créneau proposé, « prévu » pour une autre date
        # convenue —, donc deux pastilles de couleurs différentes au planning
        # pour le même oui, et deux phrases différentes sur la fiche du client.
        # La personne a dit oui : c'est un accord, pas une prévision.
        base.ajouter_rendezvous(
            client_id, resultat["new_datetime"],
            campagne.get("sujet") or f"Campagne : {campagne['nom']}",
            statut="confirmé")
    return None


def _appeler_contact_classique(base, planif, preferences, campagne, contact,
                               tentative, maintenant=None):
    """Passe UN appel de campagne (thèmes hors cascade) et applique la suite.

    Rend un dictionnaire de compte rendu {contact, issue, abouti}.
    Les verrous ont déjà été vérifiés par l'appelant (verifier_garde_fous).
    Le numéro composé est celui de la FICHE CLIENT à l'instant de l'appel,
    et le filet de sécurité du 🚫 (numéro OU nom) est relu ici.
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
        # L'appel EST parti : on garde son identifiant et on écrit l'état
        # qui dit la vérité. Aucune tentative, aucun « injoignable ».
        from . import assistant
        assistant._noter_resultat_en_attente(base, contact_id, tentative,
                                             attente)
        raise
    except calle_client.ResultatInvalide as refus:
        # LA CONVERSATION A EU LIEU et RingBack n'a pas su la lire : le
        # contact part vers un HUMAIN avec la réponse brute, jamais vers une
        # relance automatique. Même écriture que les campagnes de
        # l'assistant — un seul endroit, donc aucune divergence.
        from . import assistant
        assistant.noter_reponse_illisible(base, campagne["id"], contact_id,
                                          tentative, refus)
        raise
    except calle_client.EchecDeNotreCote:
        # Panne DE NOTRE CÔTÉ : rien n'est écrit sur ce contact (son
        # téléphone n'a pas sonné), et l'appelant arrête la campagne.
        raise
    except Exception as erreur:  # échec technique : jamais de résultat inventé
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
        # La date convenue au téléphone ne tient pas : RIEN n'est écrit au
        # planning, et un humain reprend la main avec la date en clair.
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
    """Les appels INITIAUX d'une campagne hors cascade, un contact à la fois.

    Vérifie d'abord les trois verrous du planificateur (les mêmes que
    partout). Rend la liste des comptes rendus. Le statut de la campagne
    est recalculé à la fin (en cours si des relances existent).
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
            # Panne DE NOTRE CÔTÉ : la campagne s'arrête ICI, en pause. Les
            # contacts pas encore appelés restent « à appeler » — la reprise
            # les retrouvera intacts (voir assistant.mettre_en_pause_sur_panne,
            # même règle, un seul écrit).
            from . import assistant
            assistant.mettre_en_pause_sur_panne(base, campagne_id, panne)
            # L'état RELU en base, jamais supposé : quand la conversation a eu
            # lieu et que sa réponse était illisible, ce contact n'est PAS
            # resté « à appeler » — il attend un humain, et le compte rendu
            # doit le dire.
            frais = base.obtenir_contact_campagne(contact["id"]) or contact
            comptes_rendus.append({"contact": contact["nom"],
                                   "issue": frais["issue"], "abouti": False,
                                   "etat": frais["etat"], "panne": str(panne)})
            return comptes_rendus
    mettre_a_jour_statut_campagne(base, campagne_id)
    return comptes_rendus


# ------------------------------------------------- rattachement cascade
def _cahier_de_cascade(base, preferences, campagne_id, contact, appel):
    """Transcrit au CAHIER ce que la cascade a décidé sur l'ancien rendez-vous.

    La cascade directe s'exécute AVANT que sa campagne n'existe : la
    décision est donc prise et écrite au moment du changement, sur la ligne
    de cascade (note + rendezvous_libere), puis transcrite ici, à
    l'identique. Rien n'est recalculé, rien n'est deviné.
    - un ancien rendez-vous a VRAIMENT été libéré → ligne ➖, avec sa date,
      son motif, sa durée et la raison ;
    - RingBack ne savait pas duquel il s'agissait → ligne 🙋 : c'est un
      humain qui doit aller le libérer dans l'agenda de l'établissement.
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
    if ancien is None:      # fiche supprimée entre-temps : on ne prétend rien
        base.ajouter_changement(campagne_id, "humain", contact["nom"],
                                contact_id=contact["id"], raison=note)
        return
    # ⚠ LE GENRE SUIT LE STATUT RÉELLEMENT ÉCRIT sur le rendez-vous (relu
    # ci-dessus, jamais deviné) : « ➖ supprimé » quand la place se rouvre,
    # « ✖ annulé » quand elle reste bloquée. Voir horaires.genre_de_retrait.
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
    """Enveloppe une cascade « premier oui » DÉJÀ exécutée dans une campagne.

    personnes : la liste (numéros en clair) passée à la cascade, dans le
    même ordre que ses rangs. Les issues de la cascade deviennent l'état
    des contacts ; si le créneau n'est PAS pourvu, les non-aboutis
    (pas de réponse, échec, refus à requalifier) reçoivent une relance qui
    conserve le thème. Rend l'identifiant de la campagne.
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
            # Un 🚫 : la personne part vers un humain, avec la raison en clair
            # (voir db.suite_du_refus). Les cascades d'avant le 20/08/2026 n'ont
            # pas de note — elles retombent sur « exclu », comme avant.
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
            # Oui obtenu, date impossible : un HUMAIN reprend la main, avec
            # la raison en clair. Aucune relance automatique n'est armée.
            base.changer_etat_contact_campagne(
                contact["id"], "à rappeler par un humain", issue)
            base.definir_detail_contact(contact["id"], appel.get("note"))
        elif issue in ("accepted", "moved"):
            base.changer_etat_contact_campagne(contact["id"], "abouti", issue)
            _cahier_de_cascade(base, preferences, campagne_id, contact, appel)
        elif pourvue:
            # Créneau pourvu : l'objectif est atteint, personne n'est relancé.
            base.changer_etat_contact_campagne(contact["id"], "appelé", issue)
        else:
            _issue_apres_echec(base, preferences, campagne, contact["id"],
                               issue, MOTIFS_RELANCE.get(issue, issue),
                               tentative_suivante=1, maintenant=maintenant)
    mettre_a_jour_statut_campagne(base, campagne_id)
    return campagne_id


def campagne_depuis_file(base, preferences, appels, mission, maintenant=None):
    """Enveloppe une exécution de la file d'appels dans une campagne « manque ».

    appels : liste de (appel_id) traités — leurs issues sont relues en base.
    Les échecs (pas de réponse ou incident) et les « to_reschedule »
    reçoivent une relance qui conserve le thème. Rend l'identifiant de la
    campagne, ou None si la liste est vide.
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
                # Le planificateur a REFUSÉ d'écrire la date convenue : le
                # contact part vers un rappel par un humain, raison comprise.
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
            # Appel jamais composé (🚫 relu au dernier moment, fiche
            # supprimée) : c'est dit, et aucune relance n'est armée.
            base.ajouter_appel_campagne(campagne_id, contact["id"],
                                        tentative=0, issue=None)
            etat, detail = db.suite_du_refus(appel["note"])
            base.changer_etat_contact_campagne(contact["id"], etat, None)
            base.definir_detail_contact(contact["id"], detail)
        else:
            # « échec » du planificateur : pas de réponse ou incident — le
            # détail n'est pas distingué par la file classique.
            issue = "echec"
            base.ajouter_appel_campagne(campagne_id, contact["id"],
                                        tentative=0, issue=issue)
            _issue_apres_echec(base, preferences, campagne, contact["id"],
                               issue, "pas de réponse ou échec technique",
                               tentative_suivante=1, maintenant=maintenant)
    mettre_a_jour_statut_campagne(base, campagne_id)
    return campagne_id


def _date_refusee(base, campagne, contact, issue, refus, date_convenue):
    """Le client a dit oui, mais la date ne tient pas : RIEN n'est écrit.

    Le contact passe « à rappeler par un humain » avec la raison ET la date
    demandée en clair — rien de ce qui a été obtenu au téléphone n'est
    perdu, mais le planning ne devient jamais faux. Rend le compte rendu.
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
    """Une relance de campagne « créneau libéré » : re-proposer LE créneau."""
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
        # L'appel EST parti : identifiant conservé, état honnête, aucune
        # tentative comptée (même règle que partout ailleurs).
        from . import assistant
        assistant._noter_resultat_en_attente(base, contact["id"],
                                             relance["tentative"], attente)
        raise
    except calle_client.ResultatInvalide as refus:
        # La conversation a eu lieu ; nous ne savons pas la lire. Vers un
        # humain, réponse brute conservée, aucune relance de plus.
        from . import assistant
        assistant.noter_reponse_illisible(base, campagne["id"], contact["id"],
                                          relance["tentative"], refus)
        raise
    except calle_client.EchecDeNotreCote:
        raise  # panne de notre côté : rien n'est écrit, la fournée s'arrête
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
        # Créneau CHOISI par l'utilisateur (voir refus_rendezvous_telephone).
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
        # Créneau pourvu PENDANT une relance : plus rien à relancer ici.
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
    """Le GESTE HUMAIN « Lancer les relances dues » : exécute chaque relance due.

    Jamais d'appel spontané : cette fonction n'est appelée que par un
    bouton. Les trois verrous du planificateur sont vérifiés AVANT le
    moindre appel (simulation ou réel), et chaque relance conserve le thème
    et les paramètres de sa campagne. Rend la liste des comptes rendus.
    """
    planif.verifier_garde_fous()
    comptes_rendus = []
    for relance in base.relances_dues(
            maintenant.isoformat(timespec="minutes") if maintenant else None):
        # La relance peut avoir été annulée par une exécution précédente de
        # la même fournée (créneau pourvu) : on relit son état réel.
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
                # Campagne de l'assistant : même moteur et mêmes états que son
                # exécution initiale (import local : le module assistant importe
                # déjà celui-ci).
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
            # Panne DE NOTRE CÔTÉ. La relance vient d'être marquée « faite » :
            # elle est REMISE « planifiée », sinon elle serait perdue alors
            # que personne n'a été appelé. La fournée s'arrête là — les
            # relances suivantes échoueraient toutes pareil.
            #
            # SAUF si la réponse est arrivée et que RingBack n'a pas su la
            # lire (ResultatInvalide) : là, le téléphone A SONNÉ et la
            # conversation a eu lieu. Remettre la relance « planifiée »
            # ferait rappeler cette personne automatiquement — exactement ce
            # qu'il ne faut pas. La relance reste « faite » et le contact
            # attend un humain.
            from . import assistant
            if not isinstance(panne, calle_client.ResultatInvalide):
                base.changer_relance(relance["id"], statut="planifiée")
            assistant.mettre_en_pause_sur_panne(base, campagne["id"], panne)
            # L'état RELU en base : après une réponse illisible, le contact
            # attend un humain — le compte rendu ne doit pas le dire encore
            # « à recontacter ».
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
        # ⚠ LA RELANCE VIENT DE S'ACHEVER : ce contact peut n'avoir plus aucune
        # tentative devant lui. C'est le second des trois moments où RingBack
        # cesse d'essayer — et sans lui, un déplacement raté au DERNIER rappel
        # laissait son rendez-vous au planning (20/08/2026).
        from . import assistant as _assistant
        _assistant.cloturer_les_deplacements_non_faits(
            base, base.obtenir_campagne(campagne["id"]), maintenant)
        mettre_a_jour_statut_campagne(base, campagne["id"])
    return comptes_rendus
