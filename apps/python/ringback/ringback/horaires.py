"""Horaires d'ouverture : semaine type, jours fermés, tranches et créneaux libres.

Le principe, en une phrase : **ce qu'on peut proposer se CALCULE** —
c'est l'ouvert, moins ce qui est déjà pris, moins les jours fermés.

Les trois réglages (fichier donnees/preferences.json, comme le reste) :

- « durée moyenne d'un rendez-vous » (le PAS, 15 minutes par défaut) : c'est
  l'unité de découpage. Une journée est une suite de TRANCHES de cette
  durée ; un rendez-vous occupe une tranche par défaut, davantage s'il est
  plus long (30 minutes = 2 tranches de 15) ;
- la SEMAINE TYPE : pour chacun des sept jours, les périodes ouvertes, en
  minutes depuis minuit ({0 : [(540, 720)]} = lundi 9h→12h). Lundi = 0,
  comme datetime.date.weekday() ;
- les JOURS FERMÉS exceptionnels : des dates où rien n'est possible bien que
  la semaine type soit ouverte (jour férié, vacances, formation).

Ce module calcule aussi les JOURS FÉRIÉS français (Pâques comprise, sans
aucune bibliothèque extérieure) — mais il ne les ajoute JAMAIS tout seul :
il les PROPOSE, l'ajout reste un geste de l'utilisateur (⚙ Réglages).

Rien n'est inventé : un créneau proposé est une tranche réellement ouverte,
réellement libre, un jour réellement ouvert. Les créneaux ajoutés à la main
(le cas particulier : « exceptionnellement, je peux recevoir samedi ») sont
conservés tels quels et signalés comme tels — une saisie n'est jamais
perdue en silence.
"""

import datetime
import logging

from . import db, themes
from . import langue as mod_langue

journal = logging.getLogger("ringback.horaires")

# ------------------------------------------------------------ clés de réglage
CLE_PAS = "pas_minutes"          # durée moyenne d'un rendez-vous, en minutes
CLE_SEMAINE = "semaine_type"     # {jour (0=lundi) : [[début, fin] en minutes]}
CLE_FERMES = "jours_fermes"      # [{"date": "AAAA-MM-JJ", "libelle": "…"}]
CLE_DERNIER_IMPORT = "dernier_import_agenda"  # trace du dernier fichier importé
CLE_SEUIL_REMPLACEMENT = "seuil_remplacement_heures"  # le seuil des 12 h

PAS_DEFAUT = 15
PAS_MINIMUM = 5
PAS_MAXIMUM = 240

# LE SEUIL DE REMPLACEMENT, en heures — la valeur du propriétaire, pas une
# invention : « si le rendez-vous est dans plus de 12 h, on propose dans le
# récapitulatif à l'opérateur de démarrer une campagne de créneau libre pour
# compenser l'absence ; si c'est < 12 h alors on laisse en annulé et on
# indique que l'on ne peut pas dans ces conditions faire un remplacement ».
# Réglable dans « ⚙ Réglages ».
SEUIL_REMPLACEMENT_DEFAUT = 12
SEUIL_REMPLACEMENT_MINIMUM = 0
SEUIL_REMPLACEMENT_MAXIMUM = 168   # une semaine : au-delà, plus rien ne serait
                                   # jamais compensable

# Horizon de calcul des créneaux proposables (en jours) : au-delà, plus
# personne ne prend rendez-vous par téléphone « pour la place qui se libère ».
HORIZON_JOURS = 21

# Délai de rattrapage standard (en jours) : la distance à laquelle le produit
# propose une place quand il n'a AUCUN horaire d'ouverture pour en calculer
# une (c'est la convention historique de l'agent — « je peux vous proposer un
# nouveau créneau la semaine prochaine »). Elle ne sert QUE dans ce cas ; dès
# qu'une semaine type est réglée, les places viennent de creneaux_proposables.
RATTRAPAGE_JOURS = 7

# Amplitude affichée du calendrier, élargie si la semaine type déborde.
AFFICHAGE_DEBUT = 7 * 60
AFFICHAGE_FIN = 20 * 60

# ⚠ REPRIS DE `themes`, PAS RECOPIÉ (24/08/2026). Les noms de jours y vivent
# désormais avec les noms de mois, dont la date dite au téléphone a besoin.
# Deux listes, ce serait deux vérités — et c'est ainsi qu'un jour finit par
# s'appeler autrement d'un écran à l'autre. `horaires.JOURS` reste le nom que
# tout le produit emploie : rien à récrire ailleurs.
JOURS = themes.JOURS

# Statuts qui OCCUPENT réellement une tranche. Un rendez-vous annulé,
# déplacé, ignoré ou supprimé libère sa place : c'est tout l'intérêt du calcul.
STATUTS_OCCUPANTS = ("prévu", "confirmé")


# ------------------------------------------------- annuler : la règle, ici
def seuil_remplacement(preferences):
    """Le seuil de remplacement réglé, en heures (12 par défaut)."""
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
    """Valide le seuil saisi ; lève ValueError avec le format attendu en clair."""
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
    """LA règle d'annulation du propriétaire, tenue en UN SEUL endroit.

    Rend un dictionnaire, jamais un simple statut, parce que l'écran a besoin
    de dire POURQUOI :
      - « statut »      : ce qu'on écrit sur le rendez-vous —
                          db.STATUT_SUPPRIME ou « annulé » ;
      - « compensable » : peut-on encore monter une campagne pour remplir la
                          place ? (c'est ce qui déclenche la proposition) ;
      - « seuil »       : le seuil réglé, en heures ;
      - « heures »      : combien d'heures nous séparent du rendez-vous
                          (None si la date est illisible) ;
      - « pourquoi »    : la phrase à afficher, en français, telle quelle.

    Les trois cas, mot pour mot d'après la règle du 31/07/2026 :
    1. date PASSÉE → « annulé ». C'est le statut d'HISTOIRE : « annulé c'est
       pour les dates passées ». Rien à compenser, c'est derrière nous ;
    2. date à venir, à PLUS de `seuil` heures → « supprimé » : le rendez-vous
       n'existe plus, sa place redevient libre, et on PROPOSE à l'opérateur
       une campagne « créneau libéré » pour compenser l'absence ;
    3. date à venir, à MOINS de `seuil` heures → « annulé », et l'écran dit
       qu'on ne peut pas organiser de remplacement dans ces conditions —
       l'opérateur reste libre de le faire à la main.
    """
    seuil = seuil_remplacement(preferences)
    if maintenant is None:
        maintenant = datetime.datetime.now()
    maintenant = maintenant.replace(second=0, microsecond=0)
    try:
        quand = datetime.datetime.fromisoformat(horaire)
    except (TypeError, ValueError):
        # Date illisible : on ne prétend rien deviner, c'est « annulé ».
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
    """Le genre de ligne du cahier qui correspond au statut RÉELLEMENT écrit.

    ⚠ LE MOT SUIT L'ÉTAT — c'était le défaut n° 5 du 18/08/2026. Le cahier des
    changements écrivait « ➖ Rendez-vous supprimé » dans TOUS les cas
    d'annulation, y compris quand le produit venait d'écrire « annulé ». Mesuré
    sur sa journée : la même ligne portait « supprimé » en colonne CHANGEMENT et
    « il reste marqué « annulé » » en colonne POURQUOI, et le fichier CSV
    exporté disait la même chose. Trois mots pour un seul événement, dans le
    document dont tout l'objet est d'être RETAPÉ dans un autre logiciel.

    Et ce n'est pas qu'une affaire de vocabulaire : les deux états ne demandent
    pas le même geste (voir `decision_annulation` juste au-dessus).
      - « supprimé » : le rendez-vous n'existe plus, sa place redevient libre —
        il y a un créneau à rouvrir dans le logiciel de l'établissement ;
      - « annulé »   : la place reste bloquée, trop tard pour organiser un
        remplacement (ou date déjà passée).
    Reporter « supprimé » là où le produit a écrit « annulé », c'est faire
    rouvrir un créneau qui ne l'est pas.

    ⚠ CETTE RÈGLE VIT ICI, à côté de celle qui décide du statut : trois
    endroits écrivent une ligne de retrait au cahier (une campagne de
    l'assistant, la place rendue d'une cascade, la transcription d'une cascade
    directe). Écrite dans l'un d'eux, elle aurait manqué aux deux autres — le
    genre de demi-correction qui fait revenir le même défaut sous un autre nom.

    Les deux genres existent depuis le 17/08/2026 (voir
    assistant.GENRES_CHANGEMENT) ; un seul chemin écrivait « annulation ».
    """
    return "suppression" if statut == db.STATUT_SUPPRIME else "annulation"


# --------------------------------------------------------------------- le pas
def pas_minutes(preferences):
    """La durée moyenne d'un rendez-vous, en minutes (15 par défaut).

    ⚠ `preferences` PEUT ÊTRE None (10/08/2026), comme pour
    `seuil_remplacement` : « aucun réglage » vaut « les valeurs par défaut ».
    Sans cela, chaque appelant devait écrire lui-même le repli — et celui qui
    l'oubliait obtenait un « NoneType n'a pas d'attribut obtenir » au moment
    d'importer un fichier, très loin de la cause.
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
    """Rend le pas validé (entier), ou lève ValueError avec un message français."""
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
    """540 devient « 9h00 » (heure française, sans zéro de tête)."""
    return f"{minutes // 60}h{minutes % 60:02d}"


def heure_hhmm(minutes):
    """540 devient « 09:00 » — le format des champs <input type="time">."""
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def minutes_depuis_hhmm(texte):
    """« 09:00 » devient 540 ; lève ValueError (message français) sinon."""
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
    """« 2 tranches de 15 min (30 minutes) » — dit toujours les deux."""
    unite = "tranche" if nombre <= 1 else "tranches"
    return (f"{nombre} {unite} de {pas} min "
            f"({duree_lisible(nombre * pas)})")


# ------------------------------------------------------------- semaine type
def semaine(preferences):
    """La semaine type réglée : {jour (0=lundi) : [(début, fin) en minutes]}.

    Toujours les sept jours (une liste vide = jour fermé), périodes
    fusionnées et triées. Un réglage abîmé (fichier édité à la main) est
    ignoré silencieusement plutôt que de casser l'écran.
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
    """Enregistre la semaine type (les jours vides ne sont pas stockés)."""
    a_ecrire = {str(jour): [[d, f] for d, f in periodes]
                for jour, periodes in sorted(valeur.items()) if periodes}
    preferences.definir(CLE_SEMAINE, a_ecrire)


def _fusionner(periodes):
    """Trie et fusionne les périodes qui se touchent ou se chevauchent."""
    fusionnees = []
    for debut, fin in sorted(periodes):
        if fusionnees and debut <= fusionnees[-1][1]:
            fusionnees[-1] = (fusionnees[-1][0], max(fusionnees[-1][1], fin))
        else:
            fusionnees.append((debut, fin))
    return fusionnees


def _retirer(periodes, debut, fin):
    """Retire [début, fin) des périodes ouvertes (le trou est vraiment fermé)."""
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
    """Vrai si TOUT l'intervalle [début, fin) est déjà ouvert."""
    for periode_debut, periode_fin in periodes:
        if periode_debut <= debut and periode_fin >= fin:
            return True
    return False


def basculer_periode(preferences, jour, debut, fin, geste="basculer"):
    """Ouvre, ferme ou BASCULE une période de la semaine type.

    geste : « ouvrir », « fermer », ou « basculer » (le glisser-relâché —
    une période déjà entièrement ouverte se referme). Les bornes sont
    alignées sur la grille des tranches : on appuie sur une tranche, on
    relâche sur une autre, la période va du début de la première à la fin
    de la dernière. Rend True si la période est ouverte à l'arrivée.
    Lève ValueError (message français) si le jour ou les heures sont hors
    bornes — la saisie fautive n'est jamais enregistrée en silence.
    """
    if jour not in range(7):
        raise ValueError(f"Jour inconnu : « {jour} » (attendu 0 = lundi à "
                         "6 = dimanche).")
    pas = pas_minutes(preferences)
    debut, fin = min(debut, fin), max(debut, fin)
    debut = (debut // pas) * pas
    fin = -(-fin // pas) * pas          # arrondi à la tranche supérieure
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
    """Vrai si au moins une période est ouverte dans la semaine type."""
    return any(periodes for periodes in semaine(preferences).values())


def amplitude_affichee(preferences):
    """(début, fin) en minutes du calendrier affiché — rien n'est caché.

    L'amplitude par défaut (7h→20h) s'élargit si la semaine type déborde :
    une ouverture à 6h30 ou jusqu'à 22h reste visible et modifiable.
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


# ------------------------------------------------------ jours fermés (dates)
def jours_fermes(preferences):
    """Les jours fermés exceptionnels : [{"date", "libelle"}], triés."""
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
    """Rend la date en « AAAA-MM-JJ » ; accepte aussi « JJ/MM/AAAA »."""
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
    """Déclare un jour fermé (geste de l'utilisateur) ; rend la date écrite."""
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
    """Retire un jour fermé ; rend True s'il y était."""
    restants = [entree for entree in jours_fermes(preferences)
                if entree["date"] != date]
    retire = len(restants) != len(jours_fermes(preferences))
    preferences.definir(CLE_FERMES, restants)
    return retire


def est_ferme(preferences, jour):
    """Le libellé du jour fermé si CETTE date est fermée, sinon None.

    Rend "" (chaîne vide, qui reste « fermé ») quand aucun libellé n'a été
    donné : le code appelant teste `is not None`.
    """
    cible = jour.isoformat() if isinstance(jour, (datetime.date,)) else str(jour)
    for entree in jours_fermes(preferences):
        if entree["date"] == cible:
            return entree["libelle"]
    return None


# ------------------------------------------ trace du dernier import d'agenda
# À quoi ça sert : avant de démarrer une campagne, RingBack rappelle que les
# créneaux proposés au téléphone sortent de SON agenda. « Depuis quand cet
# agenda n'a-t-il pas été alimenté ? » est le fait le plus utile de ce
# rappel — encore faut-il l'avoir noté. On ne note QUE les apports par
# FICHIER (agenda ICS, fichier CSV) : ce sont les seuls dont on puisse dire
# « l'agenda a été rechargé ». Une saisie à la main ne compte pas ici, et
# tant que rien n'a été importé la date reste franchement INCONNUE — jamais
# remplacée par une valeur inventée.
def noter_import_agenda(preferences, quoi, rendezvous, quand=None):
    """Retient qu'un fichier vient d'alimenter l'agenda ; rend la trace écrite."""
    moment = (quand or datetime.datetime.now()).replace(second=0, microsecond=0)
    trace = {"quand": moment.isoformat(timespec="minutes"),
             "quoi": str(quoi),
             "rendezvous": int(rendezvous or 0)}
    preferences.definir(CLE_DERNIER_IMPORT, trace)
    journal.info("Import d'agenda noté : %s, %d rendez-vous, le %s",
                 trace["quoi"], trace["rendezvous"], trace["quand"])
    return trace


def dernier_import_agenda(preferences):
    """La trace du dernier import, ou None si AUCUN n'a jamais été noté.

    Rend {"quand" (ISO), "quoi", "rendezvous", "moment" (datetime)}. Une
    trace abîmée (fichier de réglages édité à la main) est traitée comme
    absente : mieux vaut « inconnu » qu'une date fausse.
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


# ------------------------------------------------- jours fériés (proposition)
def paques(annee):
    """Le dimanche de Pâques de CETTE année (calendrier grégorien).

    Algorithme dit « de Butcher / Meeus » : arithmétique pure, donc aucune
    bibliothèque extérieure — la contrainte du projet est tenue.
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
    """Les onze jours fériés français d'une année : [(date, nom)], triés.

    Ce sont les fériés de la France métropolitaine (l'Alsace-Moselle et les
    outre-mer en comptent d'autres). RingBack ne les ajoute JAMAIS tout
    seul : il les propose, un par un, dans ⚙ Réglages.
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
    """Les fériés encore À VENIR non déclarés : [{"date", "nom", "deja"}].

    Couvre les douze mois qui viennent (deux années civiles au besoin).
    « deja » dit qu'il est déjà déclaré fermé — l'écran le montre grisé
    plutôt que de le proposer une seconde fois.
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


# ----------------------------------------------------- tranches d'une journée
def tranches_du_jour(preferences, jour):
    """Les débuts de tranches OUVERTES de cette date : [datetime], triés.

    Une tranche compte comme ouverte seulement si elle est ENTIÈREMENT
    couverte par une période de la semaine type (une ouverture de 15 min ne
    rend pas disponible une tranche de 30). Un jour fermé rend [].
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
    """Les débuts de tranches déjà prises ce jour-là (set de datetime).

    Un rendez-vous de N tranches en occupe N ; un rendez-vous dont
    l'horaire ne tombe pas pile sur la grille occupe toutes les tranches
    qu'il CHEVAUCHE (rien n'est proposé « à moitié »). sauf_rdv : le
    rendez-vous qu'on est en train de déplacer, qui ne se gêne pas lui-même.
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
        # Toutes les tranches de la grille que ce rendez-vous chevauche.
        depart = minuit + datetime.timedelta(
            minutes=(int((debut - minuit).total_seconds() // 60) // pas) * pas)
        while depart < fin:
            occupees.add(depart)
            depart += datetime.timedelta(minutes=pas)
    return occupees


def tranches_libres_du_jour(base, preferences, jour, sauf_rdv=None,
                            depuis=None):
    """Les tranches ouvertes ET libres de cette date : [datetime], triées."""
    occupees = tranches_occupees(base, preferences, jour, sauf_rdv=sauf_rdv)
    libres = [tranche for tranche in tranches_du_jour(preferences, jour)
              if tranche not in occupees]
    if depuis is not None:
        libres = [tranche for tranche in libres if tranche >= depuis]
    return libres


def suites_libres(tranches, pas):
    """Découpe une liste de tranches en SUITES consécutives : [[datetime]]."""
    suites, courante = [], []
    for tranche in tranches:
        if courante and tranche - courante[-1] != datetime.timedelta(minutes=pas):
            suites.append(courante)
            courante = []
        courante.append(tranche)
    if courante:
        suites.append(courante)
    return suites


# -------------------------------------------------------- créneaux à proposer
def creneaux_libres(base, preferences, tranches=1, depuis=None,
                    jours=HORIZON_JOURS, limite=None, sauf_rdv=None):
    """Les créneaux réellement libres : ouvert − déjà pris − jours fermés.

    tranches : la longueur exigée, en tranches CONSÉCUTIVES (un rendez-vous
    de 30 minutes avec un pas de 15 en demande 2). Les créneaux rendus ne se
    chevauchent pas entre eux : dans une suite libre, on avance de la
    longueur demandée. Rend une liste d'horaires ISO 8601 à la minute.
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
    """Les TROUS libres du planning, l'un après l'autre.

    Un « créneau disponible » au sens du bouton « ⏭ Prochain créneau
    disponible » n'est pas une tranche isolée mais une SUITE de tranches
    libres d'affilée : c'est ce qu'on cherche quand on cherche de la place.
    Rend [{"debut": datetime, "fin": datetime, "tranches": n}], du plus
    proche au plus lointain.
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
    """Les créneaux ajoutés À LA MAIN (le cas particulier), triés.

    Ils vivent dans le même réglage qu'avant l'existence des horaires
    d'ouverture (themes.CLE_CRENEAUX) : une liste tapée reste valable, elle
    n'est jamais effacée par le calcul — elle s'y AJOUTE.
    """
    return sorted(preferences.obtenir(themes.CLE_CRENEAUX) or [])


def plancher_de_proposition(depuis=None):
    """La plus proche date qu'on ait le droit de proposer : DEMAIN, à minuit.

    ⚠ SA RÈGLE, DU 17/08/2026, mot pour mot : « il ne faut pas proposer de date
    du jour même (aujourd'hui) mais seulement à partir de demain ». Une place à
    17 h annoncée au téléphone à 16 h 30 n'est pas une proposition : personne ne
    peut s'organiser, et c'est le cabinet qui paiera l'absence.

    UN SEUL ENDROIT décide de ce plancher, et tout ce qui mène au téléphone en
    hérite — y compris un chemin écrit demain. `depuis` déjà plus lointain est
    respecté : on ne ramène jamais une recherche en arrière (la cascade demande
    « à partir de telle place », et elle doit le rester).
    """
    demain = (datetime.date.today() + datetime.timedelta(days=1))
    minuit = datetime.datetime.combine(demain, datetime.time())
    if depuis is None:
        return minuit
    return max(depuis.replace(second=0, microsecond=0), minuit)


def creneaux_proposables(base, preferences, tranches=1, depuis=None,
                         jours=HORIZON_JOURS, limite=None, sauf_rdv=None,
                         avec_les_passes=False):
    """Les créneaux à proposer : les calculés PLUS ceux ajoutés à la main.

    Rend [{"horaire", "origine", "occupe", "passe"}] trié par horaire —
    origine vaut « calculé » ou « à la main ». Un créneau manuel déjà occupé
    par un rendez-vous est conservé mais SIGNALÉ (occupe = True) :
    l'utilisateur voit sa saisie et ce qui cloche, plutôt qu'une disparition
    silencieuse.

    ⚠ JAMAIS UNE DATE PASSÉE AU TÉLÉPHONE (16/08/2026). Les créneaux CALCULÉS
    partent de `depuis` — ils sont donc à venir par construction. Ceux ajoutés
    À LA MAIN, eux, entraient tels quels : un créneau saisi il y a trois
    semaines restait dans la liste, et comme le tri se fait par horaire il
    arrivait EN PREMIER. C'est donc lui que le produit proposait au téléphone.
    +
    MESURÉ DANS SA BASE le 16/08/2026 : cinq créneaux manuels antérieurs à ce
    jour, et `creneau_le_plus_proche` rendait « le 28/07/2026 à 09h30 » — vingt
    jours dans le passé. Son rendez-vous a donc été « déplacé » vers cette
    date, où il est aussitôt devenu MANQUÉ. Un rendez-vous déplacé vers hier
    n'est pas un rendez-vous déplacé : c'est un rendez-vous perdu.

    D'où `avec_les_passes`, et son défaut : NON. Tout chemin qui mène au
    téléphone hérite du comportement sûr sans avoir à y penser — y compris un
    chemin écrit demain. Seul l'ÉCRAN qui a reçu la saisie demande à les voir
    (Réglages > Agenda), parce qu'une saisie ne doit jamais disparaître de
    l'écran qui l'a reçue : elle s'y affiche marquée `passe`, et reste
    supprimable. Ma première correction filtrait ici sans cette porte, et deux
    essais du produit l'ont refusée — ils avaient raison.

    ⚠ ET JAMAIS LE JOUR MÊME (sa demande du 17/08/2026) : « il ne faut pas
    proposer de date du jour même mais seulement à partir de demain ». Le
    plancher est donc DEMAIN À MINUIT, pas « maintenant ». Une place à 17 h
    proposée à 16 h 30 par téléphone ne laisse à personne le temps de
    s'organiser — et c'est le cabinet qui en paie l'absence.
    Voir `plancher_de_proposition`, seul endroit qui décide de ce plancher.
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
        # DEUX RAISONS DISTINCTES de ne pas proposer, et l'écran doit pouvoir
        # dire LAQUELLE : « l'heure est passée » et « c'est aujourd'hui » ne se
        # corrigent pas de la même façon.
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
    """Vrai si CE créneau manuel tombe sur un rendez-vous déjà en place."""
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


# Note : « occupants_du_creneau » (qui occupe déjà telle place) a été retiré
# le 31/07/2026 avec la première lecture, erronée, du §8.3 : la cascade ne
# vise plus l'occupant d'une place convoitée, elle repart de la place qu'un
# client vient de LIBÉRER. Plus aucun appelant — donc plus de code mort.


# ---------------------------------------------------------------------------
# CE QU'UN IMPORT REMPLACE — « pas de superposition possible »
# ---------------------------------------------------------------------------
def remplacer_sur_le_creneau(base, preferences, rendezvous_id, maintenant=None):
    """Retire ce qui occupait la place de CE rendez-vous ; rend les retirés.

    Règle du propriétaire (10/08/2026) : « dans tous les cas, les nouveaux
    créneaux de l'import remplacent les anciens (pas de superposition de
    rendez-vous possible) ».

    ⚠ RIEN N'EST EFFACÉ, et la règle n'est pas récrite ici : chaque rendez-vous
    déplacé passe par `decision_annulation`, celle du retrait à la main —
    « annulé » s'il est passé, « supprimé » s'il est à venir. Les deux rendent
    la place ; aucun des deux ne perd la trace.

    ⚠ ET C'EST LE NOUVEAU QUI GAGNE, jamais l'inverse. L'import est la volonté
    la plus récente de l'opérateur : refuser l'événement importé aurait laissé
    l'agenda en désaccord avec le fichier qu'il vient de charger, sans qu'aucun
    écran ne puisse dire lequel des deux a raison.

    Rend la liste des rendez-vous retirés, telle qu'elle était AVANT le
    changement — c'est elle qui permet de dire à l'écran ce qui a bougé.
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
    # `rendezvous_occupants` ne rend que « prévu » et « confirmé » — les seuls
    # qui occupent — et regarde la veille en plus, pour attraper un rendez-vous
    # commencé avant la fenêtre et qui déborde dedans.
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
            continue                      # ils ne se chevauchent pas
        decision = decision_annulation(preferences, autre["horaire"],
                                       maintenant)
        # ⚠ LA LIGNE COMPLÈTE, LUE AVANT LE CHANGEMENT. « rendezvous_occupants »
        # ne rend que ce qu'il faut au calcul des places — pas le nom du
        # contact — et l'écran, lui, doit pouvoir dire QUI a été déplacé.
        retires.append(dict(base.obtenir_rendezvous(autre["id"]) or autre,
                            statut_pose=decision["statut"]))
        base.mettre_a_jour_rendezvous(autre["id"], statut=decision["statut"])
        journal.info("Import : rendez-vous n°%d passé « %s » — sa place est "
                     "prise par le n°%d qui vient d'être importé",
                     autre["id"], decision["statut"], rendezvous_id)
    return retires


def vider_l_agenda_a_venir(base, preferences, maintenant=None):
    """« Remplacer entièrement l'agenda » : ce qui tient encore une place part.

    ⚠ LE PASSÉ N'EST PAS TOUCHÉ. Un agenda qu'on remplace, c'est ce qui est
    DEVANT nous ; ce qui a eu lieu est de l'histoire, et un import n'a pas à la
    récrire. Les rendez-vous à venir qui tenaient encore une place passent
    « supprimé » (leur place est rendue, ils restent lisibles dans les
    archives) — c'est encore `decision_annulation` qui l'écrit.

    Rend la liste des rendez-vous retirés.
    """
    if maintenant is None:
        maintenant = datetime.datetime.now()
    depart = maintenant.replace(second=0, microsecond=0)
    retires = []
    for rdv in base.rendezvous_occupants(depart.isoformat(timespec="minutes"),
                                         "9999-12-31T23:59"):
        if rdv["horaire"] < depart.isoformat(timespec="minutes"):
            continue                      # commencé avant : il a lieu, on n'y touche pas
        decision = decision_annulation(preferences, rdv["horaire"], maintenant)
        # ⚠ LA LIGNE COMPLÈTE, LUE AVANT LE CHANGEMENT. « rendezvous_occupants »
        # ne rend que ce qu'il faut au calcul des places — pas le nom du
        # contact — et l'écran, lui, doit pouvoir dire QUI a été déplacé.
        retires.append(dict(base.obtenir_rendezvous(rdv["id"]) or rdv,
                            statut_pose=decision["statut"]))
        base.mettre_a_jour_rendezvous(rdv["id"], statut=decision["statut"])
    if retires:
        journal.info("« Remplacer entièrement l'agenda » : %d rendez-vous à "
                     "venir retirés — rien n'est effacé, tout reste lisible "
                     "dans « Tous les rendez-vous »", len(retires))
    return retires


def creneaux_lisibles(base, preferences, tranches=1, depuis=None, limite=6):
    """Les créneaux à proposer, en français : « le 03/08/2026 à 09h00, … ».

    C'est ce texte qui remplit [créneaux_disponibles] dans les missions et
    pré-remplit les campagnes. Rend "" si rien n'est proposable — la
    variable reste alors visible dans le texte, jamais remplacée par du vide
    trompeur.
    """
    return places_a_proposer(base, preferences, tranches=tranches,
                             depuis=depuis, limite=limite)[0]


# ============================ UN STOCK POUR NÉGOCIER, PAS UNE LISTE À RÉCITER
# Sa demande du 16/08/2026 : « choisir automatiquement des dates avec des
# créneaux libres le plus proche possible, puis compléter avec des dates tous
# les jours ouvrés + matin et après-midi, plusieurs de chaque ».
#
# CE QUE FAISAIT `creneaux_lisibles` : les SIX premières places libres. Or les
# six premières se suivent — même matinée, souvent la même heure à vingt
# minutes près. L'agent n'avait donc rien à négocier : « non » sur la première
# valait « non » sur les six.
#
# Le stock est bâti en deux temps, et c'est ce qui compte :
#   ① les places les plus PROCHES, telles quelles — c'est ce qu'on propose en
#     premier, parce qu'un rendez-vous déplacé au plus tôt dérange le moins ;
#   ② puis une COUVERTURE : quelques jours ouvrés d'affilée, et dans chacun
#     des créneaux le matin ET l'après-midi. De quoi répondre à « plutôt le
#     mardi » ou « plutôt l'après-midi » sans rappeler.
#
# ⚠ CE N'EST PAS UN TEXTE À LIRE AU TÉLÉPHONE. Personne n'écoute vingt dates :
# le stock vit dans « ce que tu sais », et le message d'ouverture n'en nomme
# qu'UNE (voir `creneau_le_plus_proche` et la conduite de la nature).
PROCHES_DABORD = 3          # les places les plus proches, prises telles quelles
JOURS_COUVERTS_NEGO = 5     # jours ouvrés distincts à couvrir ensuite
PAR_DEMI_JOURNEE = 2        # créneaux gardés le matin, et autant l'après-midi
HEURE_BASCULE_MIDI = 13     # avant 13 h = matin, à partir de 13 h = après-midi

# ⚠ LE CHOIX OFFERT SUIT LE NOMBRE DE RENDEZ-VOUS À DÉPLACER (sa demande du
# 17/08/2026) : « il faut qu'il y ait beaucoup plus de possibilités de
# rendez-vous sur lesquels déplacer que de rendez-vous à déplacer […] Le nombre
# doit être proportionnel au nombre de rendez-vous à déplacer (7 rendez-vous à
# déplacer, il y a alors 7 fois plus de possibilités) ».
#
# POURQUOI CE N'EST PAS UN CAPRICE DE CHIFFRE : chaque oui CONSOMME une place.
# Sur une après-midi de sept personnes, un stock de vingt places voyait les
# premiers accords prendre les meilleures, et les derniers appelés s'entendre
# proposer une date lointaine — ou rien. Le stock doit tenir jusqu'au dernier.
#
# LECTURE RETENUE : « proportionnel » au sens strict, facteur CONSTANT de sept
# places par rendez-vous à déplacer. Son exemple donne la même réponse dans les
# deux lectures possibles (7 × 7 = 49) ; l'autre — un facteur égal au nombre —
# serait quadratique, soit 900 places pour trente rendez-vous. Une constante
# nommée : un seul chiffre à changer s'il la veut autrement.
PAR_RENDEZVOUS_A_DEPLACER = 7

# ⚠ JUSQU'OÙ CHERCHER UNE PLACE — MESURÉ DANS SA BASE LE 17/08/2026.
# Son agenda est COMPLET sur les 21 jours de l'horizon : zéro créneau libre. Au
# 30ᵉ jour il y en a 250, au 45ᵉ 662. Une campagne de déplacement n'avait donc
# RIEN à proposer — `creneau_le_plus_proche` rendait "" — et cinq de ses neuf
# contacts finissaient sans date, « à rappeler par un humain » ou « le client
# rappellera ». Le message qui nomme une date n'en nommait aucune.
#
# Or un déplacement DOIT aboutir : le praticien n'est pas là ce jour-là, le
# rendez-vous doit aller quelque part. Refuser de regarder au-delà de trois
# semaines, c'est refuser de le déplacer.
#
# On garde donc le proche EN PREMIER — c'est mieux pour le client — et on
# n'élargit que si l'on ne trouve rien. Le cas courant ne coûte pas un calcul de
# plus ; le cas d'un agenda plein, lui, cesse d'être une impasse.
HORIZONS_NEGO = (HORIZON_JOURS, 45, 90, 180)


def places_libres_elargies(base, preferences, tranches=1, depuis=None,
                           sauf_places=(), limite=None, sauf_jours=()):
    """Les horaires libres, en élargissant l'horizon tant qu'on ne trouve rien.

    ⚠ UN SEUL ENDROIT POUR CETTE RÈGLE, et c'est tout l'objet de cette
    fonction. Ma première correction ne l'a élargie que dans le stock de la
    négociation ; la vérification d'avant-appel, elle, employait l'ancien
    horizon. Résultat mesuré sur sa base : le message annonçait bien « le
    08/09/2026 à 08h40 »… et la campagne refusait de composer, « il n'en reste
    plus AUCUN de libre », pour ses NEUF contacts. Deux calculs, deux vérités —
    la famille de défaut qui revient le plus souvent ici.

    ⚠ ET `limite` COMPTE LES PLACES LIBRES, PAS LES LIGNES DE LA LISTE
    (17/08/2026). C'était l'inverse, et c'est le défaut le plus coûteux mesuré
    sur sa base : il a 106 créneaux ajoutés à la main, dont 99 DÉJÀ PRIS. Comme
    le tri se fait par horaire, ces 99-là remplissaient les six premières
    lignes ; la liste annoncée dans le message sortait donc VIDE, alors que 662
    places étaient libres derrière. Or c'est ce texte vide que la campagne
    relit avant de composer : elle concluait « il n'en reste plus aucun » et
    n'appelait personne. On écarte donc l'occupé D'ABORD, on coupe ENSUITE.

    ⚠ `sauf_jours` : LES JOURNÉES QU'ON VIDE, écartées EN ENTIER (sa règle du
    17/08/2026) : « cela a sélectionné des créneaux durant la journée que je
    veux annuler. Il ne faut pas non plus sélectionner des créneaux libres sur
    la ou les journées où l'on a l'annulation ».
    +
    C'est évident dès qu'on le dit : si le praticien n'est pas là ce jour-là,
    aucune heure de ce jour-là n'est proposable — même celles qui n'ont jamais
    porté de rendez-vous. Écarter les places une par une (`sauf_places`) ne
    suffisait pas : elle n'enlevait QUE les heures des rendez-vous à déplacer,
    et laissait tous les trous de la journée autour.
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


# ⚠ QUELQUES PLACES POUR REMPLACER UN RENDEZ-VOUS ANNULÉ (31/08/2026, sa
# demande, relevée sur un VRAI appel). Ce qui partait était les six prochaines
# places libres — et sa transcription du 31/08 le montre en toutes lettres :
#
#   « le mardi 1 septembre 2026 à 8 heures 20, le mardi 1 septembre 2026 à
#     9 heures 20, le mardi 1 septembre 2026 à 9 heures 40, le mardi
#     1 septembre 2026 à 10 heures 20, le mardi 1 septembre 2026 à 11 heures,
#     le mardi 1 septembre 2026 à 11 heures 40. »
#
# SIX FOIS LE MÊME JOUR — et pire, le jour même du rendez-vous auquel elle
# venait de dire qu'elle ne pourrait pas venir. « Aucun », a-t-elle répondu.
#
# Sa règle : « des dates à des jours différents, mais pas trop lointain (max
# 7 jours) ; le matin et l'après-midi d'une même journée cela me convient
# aussi ».
#
# ⚠ CE N'EST PAS `places_negociables`, et c'est voulu. Celle-là bâtit le STOCK
# d'une négociation de déplacement : elle vise plusieurs dizaines de places et
# s'étale sur des semaines. Ici on cite des dates À VOIX HAUTE, une par une :
# au-delà d'une poignée, personne n'écoute.
#
# ⚠ ELLES SONT LIBRES PAR CONSTRUCTION : `places_libres_elargies` écarte
# l'occupé AVANT de couper (c'est le défaut du 17/08, corrigé là-bas), et le
# recalcul de l'instant de l'appel les reprend juste avant de composer.
JOURS_REMPLACEMENT_MAX = 7   # « pas trop lointain » — sa borne, en jours
PLACES_REMPLACEMENT = 6      # ce qu'on peut citer au téléphone sans lasser


def places_de_remplacement(base, preferences, tranches=1, depuis=None,
                           sauf_places=(), sauf_jours=()):
    """Quelques places libres pour remplacer un rendez-vous — ÉTALÉES.

    Des jours DIFFÉRENTS d'abord, matin et après-midi d'une même journée
    ensuite, et rien au-delà de sept jours. Rend une liste d'horaires ISO,
    triée ; vide si rien n'est proposable — on n'invente aucune date.
    """
    libres = places_libres_elargies(base, preferences, tranches=tranches,
                                    depuis=depuis, sauf_places=sauf_places,
                                    sauf_jours=sauf_jours)
    if not libres:
        return []
    # ⚠ LA BORNE SE COMPTE DEPUIS LA PREMIÈRE PLACE LIBRE, pas depuis
    # aujourd'hui. Un agenda plein huit jours durant rendrait sinon une liste
    # VIDE — et une liste vide, c'est un appel qui ne propose rien alors qu'il
    # y avait des places à citer.
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
        # ⚠ UNE SEULE PLACE PAR DEMI-JOURNÉE au premier tour : c'est ce qui
        # écarte les six créneaux d'affilée d'une même matinée. Le second tour
        # (plus bas) complète, matin ET après-midi, s'il reste de la place.
        demi = (quand.date().isoformat(),
                quand.hour < HEURE_BASCULE_MIDI)
        if demi in par_demi_journee:
            continue
        par_demi_journee[demi] = horaire
        retenues.append(horaire)
    # Pas assez de journées ouvertes pour remplir : on complète avec ce qui
    # reste, dans l'ordre — mieux vaut deux heures d'un même matin que rien.
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
    """Le stock de places d'une négociation : proches d'abord, puis variées.

    Rend une liste d'horaires ISO 8601, triée. Vide si rien n'est proposable —
    on n'invente aucune date, comme partout ailleurs.

    La recherche s'élargit tant qu'elle ne trouve rien (voir HORIZONS_NEGO).

    `a_deplacer` : le nombre de rendez-vous que la campagne doit sortir de leur
    place. Le stock visé vaut alors `a_deplacer × PAR_RENDEZVOUS_A_DEPLACER`, et
    la couverture s'étend sur autant de jours et de semaines qu'il en faut pour
    l'atteindre. À zéro (le défaut), on garde le stock court d'un appel
    isolé — un rappel individuel n'a personne d'autre à servir.
    """
    libres = places_libres_elargies(base, preferences, tranches=tranches,
                                    depuis=depuis, sauf_places=sauf_places,
                                    sauf_jours=sauf_jours)
    if not libres:
        return []
    cible = max(0, int(a_deplacer or 0)) * PAR_RENDEZVOUS_A_DEPLACER
    retenues = list(libres[:PROCHES_DABORD])
    deja = set(retenues)
    # ⚠ ON COMPTE LES JOURS, PAS LES CRÉNEAUX. Compter les créneaux ramenait
    # tout le stock sur les deux premières journées ouvertes — exactement le
    # défaut qu'on corrige.
    #
    # ⚠ ET LA COUVERTURE S'ÉTEND JUSQU'À LA CIBLE (17/08/2026). Cinq jours et
    # deux créneaux par demi-journée plafonnaient le stock à vingt-trois places,
    # quel que soit le nombre de gens à déplacer. On garde donc les MÊMES deux
    # règles — plusieurs jours, matin ET après-midi — mais on continue d'avancer
    # dans le calendrier tant que la cible n'est pas atteinte : le stock s'étale
    # sur plusieurs semaines au lieu de s'entasser sur la première.
    jours_vises = max(JOURS_COUVERTS_NEGO,
                      -(-cible // (PAR_DEMI_JOURNEE * 2)) if cible else 0)
    comptes, jours_vus = {}, []
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
    # ⚠ SECOND PASSAGE, ET IL EST NÉCESSAIRE : quand le cabinet n'ouvre qu'une
    # demi-journée, ou que les jours parcourus n'offrent pas assez de places, le
    # premier tour s'arrête sous la cible. On complète alors dans l'ordre des
    # dates, en levant le plafond par demi-journée — mieux vaut deux places de
    # plus le même matin que sept personnes sans date. L'étalement reste acquis :
    # il a été fait EN PREMIER.
    if cible and len(retenues) < cible:
        for horaire in libres:
            if len(retenues) >= cible:
                break
            if horaire not in deja:
                deja.add(horaire)
                retenues.append(horaire)
    return sorted(retenues)


# ⚠ CE QUI SORT D'ICI SERA DIT À VOIX HAUTE (24/08/2026, sa demande). Ces
# trois fonctions ne fabriquent pas du texte d'écran : elles remplissent les
# champs « créneaux » de l'étape 2, et ces champs partent MOT POUR MOT dans la
# consigne dictée à l'agent. « le 25/08/2026 à 09h00 » n'a rien qui dise à une
# machine qu'il faut lire « vingt-cinq août » plutôt que « vingt-cinq barre
# zéro huit ». En toutes lettres, la question ne se pose plus.
#
# ⚠ LES ÉCRANS, EUX, NE CHANGENT PAS : les tableaux gardent `date_lisible`,
# compact et alignable d'une ligne à l'autre. Ce sont deux besoins différents,
# et c'est pourquoi ce sont deux fonctions.
def _en_toutes_lettres(horaire, langue_code="fr"):
    """« le mardi 25 août 2026 à 9 heures » — la forme DITE au téléphone.

    ⚠ ELLE SUIT LA LANGUE, ET C'EST DIT AU TÉLÉPHONE (03/09/2026). Ces listes
    de créneaux entrent dans la consigne — « créneaux disponibles à proposer »,
    « créneaux de remplacement » — et une consigne anglaise annonçait ses dates
    en français, prononcées par une voix anglaise à un patient anglophone.

    ⚠ ET L'ARTICLE DISPARAÎT EN ANGLAIS : on dit « on Monday 24 August », pas
    « the Monday 24 August ».
    """
    if langue_code == "en":
        return f"on {themes.date_parlee(horaire, 'en')}"
    return f"le {themes.date_parlee(horaire)}"


def creneaux_negociables(base, preferences, tranches=1, depuis=None,
                         sauf_places=(), a_deplacer=0, sauf_jours=()):
    """Le stock ci-dessus, en français. "" si rien n'est proposable."""
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
    """Les places de remplacement, en français. "" si rien n'est proposable."""
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
    """La PREMIÈRE place libre, en français. "" s'il n'y en a aucune.

    C'est elle, et elle seule, que le message d'ouverture nomme : on propose
    une date, on ne récite pas un catalogue.
    """
    places = places_negociables(base, preferences, tranches=tranches,
                                depuis=depuis, sauf_places=sauf_places,
                                sauf_jours=sauf_jours)
    return (_en_toutes_lettres(
        places[0], mod_langue.de_preferences(preferences))
        if places else "")


def places_a_proposer(base, preferences, tranches=1, depuis=None, limite=6,
                      sauf_places=(), sauf_jours=()):
    """Ce qu'il y a À PROPOSER au téléphone à cet instant précis.

    `sauf_places` : des horaires à NE PAS proposer, même libres. Une campagne
    de déplacement s'en sert pour ne jamais reproposer les places qu'elle est
    justement en train de vider — voir assistant.places_a_vider.

    Rend un couple (texte lisible, PREMIÈRE place libre en ISO 8601 — ou
    None). Les deux sortent du MÊME calcul : la place envoyée à l'agent
    comme date de référence est donc exactement la première de celles que
    le message annonce, jamais un second calcul qui pourrait diverger.

    Deux situations, deux réponses honnêtes :

    - les horaires d'ouverture sont connus (semaine type réglée, ou
      créneaux ajoutés à la main dans ⚙ Réglages) : la place est le premier
      créneau proposable réellement libre. S'il n'y en a plus AUCUN, la
      place vaut None — l'agenda est plein, et il faut le dire plutôt que
      de proposer une date qui n'existe pas ;

    - aucun horaire d'ouverture n'est réglé : RingBack ne CONNAÎT pas les
      heures ouvrées et ne les devine pas — le texte lisible reste vide.
      Il applique alors la seule règle qui lui reste dans cette situation,
      exactement celle de refus_rendezvous_telephone : ne jamais mettre
      deux personnes à la même place. La place part du délai de rattrapage
      standard (RATTRAPAGE_JOURS après l'appel) et AVANCE de tranche en
      tranche jusqu'à en trouver une qui n'est pas déjà prise.
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
        # ⚠ IL Y AVAIT ICI UN SECOND PARCOURS, sans la limite, qui rattrapait
        # une place libre que les lignes affichées masquaient. Il n'a plus
        # d'objet : `places_libres_elargies` écarte l'occupé AVANT de couper, si
        # bien qu'une liste vide veut désormais dire « rien de libre », pas
        # « rien dans les six premières lignes ». Ce rattrapage soignait le
        # symptôme sur la PLACE en laissant le TEXTE vide — et c'est le texte
        # que la campagne relit avant de composer.
        return texte, None          # l'agenda est réellement complet
    return texte, _place_sans_horaires(base, preferences, tranches, depuis)


def _place_sans_horaires(base, preferences, tranches=1, depuis=None):
    """La prochaine place NON PRISE quand aucun horaire d'ouverture n'est réglé.

    Sans semaine type, il n'y a pas d'heures ouvrées à énumérer : la seule
    chose que RingBack sache encore, c'est quelles places sont DÉJÀ PRISES.
    On part donc du délai de rattrapage standard et on avance de tranche en
    tranche (les jours déclarés fermés sont sautés) jusqu'à la première
    place libre. Rend None si tout l'horizon est pris.
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
        # La suite exigée doit tenir DANS la journée : les tranches du
        # lendemain ne sont pas chargées ici, on ne les déclare donc jamais
        # libres à la légère.
        for rang in range(premiere, par_jour - exigees + 1):
            place = minuit + datetime.timedelta(minutes=rang * pas)
            suite = [place + datetime.timedelta(minutes=i * pas)
                     for i in range(exigees)]
            if all(tranche not in occupees for tranche in suite):
                return place.isoformat(timespec="minutes")
    return None


# ------------------------------------------------------- semaine du planning
def lundi_de(jour):
    """Le lundi de la semaine de CETTE date."""
    return jour - datetime.timedelta(days=jour.weekday())


def semaine_iso(jour):
    """(année ISO, numéro de semaine ISO) de cette date — la norme française."""
    annee, numero, _ = jour.isocalendar()
    return annee, numero


def nombre_de_semaines(annee):
    """52 ou 53 : le nombre de semaines ISO de cette année.

    Le 28 décembre appartient TOUJOURS à la dernière semaine ISO de son
    année : c'est la façon la plus courte de connaître ce nombre.
    """
    return datetime.date(annee, 12, 28).isocalendar()[1]


def lundi_de_semaine(annee, numero):
    """Le lundi de la semaine ISO n° `numero` de `annee` (bornes corrigées)."""
    numero = max(1, min(int(numero), nombre_de_semaines(int(annee))))
    return datetime.date.fromisocalendar(int(annee), numero, 1)


def libelle_semaine(annee, numero):
    """« semaine 33 — du 10/08 au 16/08 » : le repère qui fait retrouver.

    Un numéro de semaine seul ne dit rien à personne ; les deux dates, si.
    Cette forme était écrite en clair dans la barre du planning ; elle vit
    ici pour que l'étape ③ de l'assistant la reprenne à l'identique plutôt
    que d'en inventer une seconde (02/08/2026).
    """
    lundi = lundi_de_semaine(annee, numero)
    dimanche = lundi + datetime.timedelta(days=6)
    return f"semaine {numero} — du {lundi:%d/%m} au {dimanche:%d/%m}"


def options_semaines(annee, depuis=None):
    """[(numéro en texte, libellé), …] des semaines de cette année.

    `depuis` : une date à partir de laquelle proposer. Pour l'année en
    cours, on part de la SEMAINE COURANTE et on va jusqu'à la fin de
    l'année — faire défiler janvier en août pour trouver la semaine
    prochaine n'aide personne (demande du propriétaire, 02/08/2026). Les
    semaines déjà passées restent atteignables en changeant d'année.
    """
    annee = int(annee)
    premiere = 1
    if depuis is not None:
        courante_annee, courante = semaine_iso(depuis)
        if annee == courante_annee:
            premiere = courante
        elif annee < courante_annee:
            # Une année passée : tout est derrière nous, on montre tout.
            premiere = 1
    return [(str(numero), libelle_semaine(annee, numero))
            for numero in range(premiere, nombre_de_semaines(annee) + 1)]


def jours_ouverts_de_semaine(preferences, lundi):
    """Les jours OUVERTS de cette semaine : [(date, libellé), …].

    Un jour fermé (semaine type ou fermeture exceptionnelle) n'a aucun
    rendez-vous à rappeler : le proposer serait proposer du vide. Quand la
    semaine type n'a jamais été réglée, aucun jour n'est ouvert — et c'est
    la vérité, pas un oubli.

    ⚠ `est_ferme` rend une chaîne VIDE quand la fermeture n'a pas de motif :
    on teste donc « is not None », jamais la vérité de la valeur.
    """
    # ⚠ « semaine_ouverte » rend un BOOLÉEN (« au moins un jour ouvert »),
    # pas la semaine : c'est « semaine » qui donne les périodes par jour.
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
    """(début, fin) en texte ISO — intervalle SEMI-OUVERT [début, fin[.

    Le dernier jour compte pour ENTIER : on borne au lendemain à 00:00, pas
    au jour même. Sans cela, un rendez-vous du dimanche à 11 h tomberait
    hors d'une semaine qui va « jusqu'au dimanche ».
    """
    return (datetime.datetime.combine(debut, datetime.time())
            .isoformat(timespec="minutes"),
            datetime.datetime.combine(fin, datetime.time())
            .isoformat(timespec="minutes"))


def grille_semaine(base, preferences, lundi, maintenant=None):
    """Le PLANNING d'une semaine : sept colonnes de tranches, tuiles comprises.

    Le découpage est EXACTEMENT celui de la semaine type des réglages (le
    pas), pour que les deux écrans se lisent de la même façon. Chaque
    cellule vaut :

    - « libre »   : la tranche est ouverte et personne ne l'occupe (vert) ;
    - « ferme »   : hors des horaires d'ouverture, ou jour fermé ;
    - « tuile »   : le DÉBUT d'un rendez-vous, avec sa hauteur en tranches ;
    - « couverte » : une tranche avalée par la tuile du dessus.

    La règle qui compte : **un rendez-vous qui occupe plusieurs tranches
    consécutives donne UNE seule tuile** de hauteur N (un `rowspan` à
    l'affichage), jamais N cases côte à côte. Si deux rendez-vous se
    superposent (saisie ancienne, import), le second n'écrase pas le
    premier : il part dans « superposes » et l'écran le dit.

    Rend {"lundi", "pas", "minutes", "jours", "superposes"}.
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
    # 1. L'amplitude : celle des réglages, ÉLARGIE si un rendez-vous déborde.
    #    Rien n'est caché — un rendez-vous hors horaires reste visible.
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
    # 2. Les sept colonnes.
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
                superposes.append(rdv)      # jamais écrasé, jamais caché
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


# --------------------------------------------------- déplacement d'un client
def duree_tranches(rdv):
    """La durée d'un rendez-vous, en tranches (1 si la donnée est absente)."""
    try:
        return max(int(rdv.get("duree_tranches") or 1), 1)
    except (TypeError, ValueError):
        return 1


def suite_libre_a_partir_de(base, preferences, cible, sauf_rdv=None):
    """Combien de tranches libres CONSÉCUTIVES à partir de cet instant.

    L'instant est ramené au début de sa tranche. Rend 0 si la tranche
    elle-même est fermée ou déjà prise.
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
    """Le message de REFUS si ce rendez-vous ne tient pas là, sinon None.

    La règle du propriétaire, à la lettre : on ne peut pas replacer un
    client dont le rendez-vous occupe plus de tranches consécutives qu'il
    n'y a de tranches libres consécutives. Le message dit ce qui manque.
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
    """Les créneaux où CE rendez-vous tient (sa durée), pour le déplacer."""
    return creneaux_libres(base, preferences, tranches=duree_tranches(rdv),
                           depuis=depuis, limite=limite, sauf_rdv=rdv.get("id"))


# ------------------------------------- rendez-vous décidé AU TÉLÉPHONE (R3)
def refus_rendezvous_telephone(base, preferences, horaire, tranches=1,
                               sauf_rdv=None, place_choisie=False,
                               maintenant=None):
    """Le message de REFUS si une date convenue AU TÉLÉPHONE ne tient pas.

    La règle du propriétaire : ce que l'interface refuse à la main, le
    téléphone doit le refuser aussi — date déjà passée, jour fermé, hors des
    horaires d'ouverture, place déjà prise, durée qui ne tient pas. Rend le
    message français, ou None si la place est réellement libre.

    ⚠ LA DATE PASSÉE EST REFUSÉE ICI DEPUIS LE 18/08/2026, et il manquait à
    l'appel. La règle était pourtant écrite deux fois dans ce fichier — voir
    `creneaux_proposables` : « Un rendez-vous déplacé vers hier n'est pas un
    rendez-vous déplacé : c'est un rendez-vous perdu. » Elle n'était tenue que
    du côté des dates PROPOSÉES ; du côté de ce qu'on ACCEPTE d'écrire, rien
    ne regardait le calendrier.

    CE QUE ÇA DONNAIT, mesuré : un rendez-vous manqué le 19/07, l'agent rend
    « autre date convenue : le 21/07 à 09h30 » — un mois dans le passé —, et le
    produit l'écrivait sans un mot, statut « confirmé ». La règle du manqué le
    repassait aussitôt « manqué » au chargement suivant : le rendez-vous avait
    disparu et personne ne pouvait dire pourquoi. Le banc l'a attrapé le
    18/08/2026, quand la ligne a cessé d'être marquée « déplacé » — l'ancienne
    écriture masquait la perte.

    ⚠ ON REFUSE LE PASSÉ, PAS « AUJOURD'HUI ». Ne jamais PROPOSER le jour même
    est une règle de proposition (`plancher_de_proposition`) : elle protège le
    client, qui ne peut pas s'organiser en deux heures. Refuser d'ÉCRIRE une
    date de cet après-midi dont on vient de convenir avec lui au téléphone
    serait autre chose — ce serait perdre un accord réel.

    Trois précisions honnêtes :
    - un jour DÉCLARÉ fermé est toujours refusé, même si la semaine type
      n'a jamais été remplie (c'est une décision explicite de l'utilisateur) ;
    - tant qu'AUCUNE semaine type n'est réglée, RingBack ne connaît pas les
      horaires d'ouverture : il ne vérifie alors que le DOUBLE emploi (deux
      personnes à la même place), et ne prétend rien de plus ;
    - une place que l'UTILISATEUR a choisie lui-même (le créneau libéré
      d'une campagne, ou un créneau ajouté à la main dans ⚙ Réglages —
      « exceptionnellement, je peux recevoir samedi ») n'est pas jugée sur
      les horaires d'ouverture : elle est déjà une décision humaine. Elle
      reste refusée si elle est FERMÉE ou DÉJÀ PRISE.
    """
    if horaire is None or not str(horaire).strip():
        # ⚠ ACCORD SANS DATE, LÀ OÙ UNE DATE EST INDISPENSABLE (24/08/2026).
        # « Date convenue illisible : « None » » ne disait rien à personne. Sur
        # un déplacement ou une prise de rendez-vous, l'agent a conclu à un
        # accord sans dire QUAND : il n'y a rien à écrire, et la phrase doit
        # dire cela plutôt que de parler d'un format.
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
    """Le texte affiché quand une date convenue au téléphone est refusée.

    Il dit les deux choses qui comptent : POURQUOI le rendez-vous n'a pas
    été créé, et QUELLE date le client avait demandée — en clair, pour
    qu'un humain puisse reprendre exactement là où l'agent s'est arrêté.
    Rien de ce qui a été obtenu au téléphone n'est perdu.

    ⚠ `rappel_humain=False` SUR UN CRÉNEAU LIBÉRÉ (15/08/2026) : cette nature
    ne produit plus de rappel manuel, il l'a fait retirer. La phrase de fin
    doit suivre l'état réel du contact, sinon l'écran promet un rappel que
    personne ne fera — c'est le genre de demi-correction qui use la confiance
    dans tout le reste de la page.
    """
    fin = ("un humain doit rappeler pour convenir d'une autre date."
           if rappel_humain else
           "aucun rendez-vous n'a été écrit, et la place libérée est proposée "
           "à quelqu'un d'autre.")
    # ⚠ SANS DATE LISIBLE, ON NE FAIT PAS SEMBLANT D'EN CITER UNE. L'agent peut
    # rendre une date illisible (le refus le dit alors lui-même) : la phrase
    # « la date demandée était  — … », avec son trou, ne doit pas s'afficher.
    lisible = themes.date_lisible(date_convenue)
    if not lisible:
        return f"{refus} Aucune date exploitable n'a été rendue — {fin}"
    return f"{refus} La date demandée au téléphone était {lisible} — {fin}"
