"""Thèmes d'appel : gabarits de mission en français + réglages qui les nourrissent.

Cinq thèmes au lancement d'un rappel (individuel, file ou cascade) :
manqué, confirmation, déplacement, créneau libéré, personnalisé. Chaque
thème fournit un gabarit en français, pré-rempli à l'écran et MODIFIABLE
avant lancement — le texte affiché est exactement celui qui sera lu.

Variables substituées dans les gabarits :
- [entreprise]            nom de l'entreprise (réglage) ;
- [client]                nom de la personne appelée — substitué PAR APPEL
                          (une file contient plusieurs clients) ;
- [date_rdv]              date du rendez-vous concerné — substituée PAR APPEL ;
- [créneaux_disponibles]  créneaux à proposer (réglage, thèmes ② ③ ④) ;
- [plage_rappel]          plage horaire d'appel autorisée (réglage) ;
- [créneau]               créneau libéré — substitué par la cascade au lancement.

Une variable SANS valeur réglée est laissée telle quelle dans le texte :
l'utilisateur la voit, peut la remplacer à la main ou aller la régler dans
« ⚙ Réglages » — jamais de valeur inventée en silence. Convention
inchangée : le texte de mission ne contient JAMAIS de numéro de téléphone.

Le module porte aussi le garde-fou de politesse : hors de la plage horaire
autorisée (réglable, 9h-19h par défaut), tout lancement d'appel est refusé
avec un message clair.
"""

import datetime
import re

# ------------------------------------------------------------ clés de réglage
CLE_ENTREPRISE = "entreprise"
CLE_CRENEAUX = "creneaux_disponibles"   # liste d'horaires ISO 8601
CLE_PLAGE_DEBUT = "plage_debut"         # « HH:MM »
CLE_PLAGE_FIN = "plage_fin"
PLAGE_DEBUT_DEFAUT = "09:00"
PLAGE_FIN_DEFAUT = "19:00"

# ------------------------------------------------------------------- thèmes
# L'ordre du dictionnaire est l'ordre d'affichage du sélecteur.
#
# ⚠ Deux corrections du 03/08/2026, avec le retrait de trois natures :
#  · « ⑤ Personnalisé » est PARTI : son gabarit était vide, et la nature du
#    même nom a été retirée — proposer un thème qui ne dit rien reviendrait
#    à faire écrire le message deux fois, ici et dans la zone de mission ;
#  · « Rappel d'appel manqué » est renommé « Rappel d'un rendez-vous
#    manqué ». Le libellé était le même que celui d'une nature retirée qui,
#    elle, parlait d'un appel TÉLÉPHONIQUE manqué. Deux choses différentes
#    sous un même nom : une confusion qui n'attendait qu'un lecteur.
THEMES = {
    "manque": "① Rappel d'un rendez-vous manqué",
    "confirmation": "② Confirmation de rendez-vous",
    "deplacement": "③ Déplacement de rendez-vous",
    "creneau_libere": "④ Créneau libéré (cascade)",
}

# Gabarits rédigés au masculin neutre (aucun accord de genre) ; [client]
# est le nom de la personne appelée, civilité comprise.
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


# --------------------------------------------------------------- formatage
# ⚠ LES NOMS DE JOURS ET DE MOIS, ICI ET NULLE PART AILLEURS. `horaires.JOURS`
# les reprend (`JOURS = themes.JOURS`) plutôt que d'en tenir une seconde liste :
# deux listes, ce serait deux vérités, et c'est ainsi qu'un jour se met à
# s'appeler autrement d'un écran à l'autre.
JOURS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi",
         "dimanche")
MOIS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet",
        "août", "septembre", "octobre", "novembre", "décembre")

# ⚠ LES NOMS ANGLAIS SONT AJOUTÉS À CÔTÉ, JAMAIS À LA PLACE (01/09/2026).
# `JOURS` et `MOIS` ci-dessus sont lus À L'IMPORT par le fichier d'essais, qui
# en fabrique une expression régulière : les rendre variables — un
# dictionnaire par langue, une fonction — ferait tomber les 1135 essais avant
# même que le premier ne s'exécute. Mesuré, pas supposé. Deux tuples de plus
# ne coûtent rien et ne peuvent rien casser.
JOURS_EN = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
            "Saturday", "Sunday")
MOIS_EN = ("January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December")
MOIS_EN_COURT = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
                 "Sep", "Oct", "Nov", "Dec")


def date_lisible(iso, langue="fr"):
    """« 2026-08-01T14:30 » devient « le 01/08/2026 à 14h30 ».

    LE FORMAT DES ÉCRANS : compact, aligné d'une ligne de tableau à l'autre.
    Ce qui est DIT AU TÉLÉPHONE passe par `date_parlee` — voir plus bas.

    ⚠ EN ANGLAIS, LE MOIS S'ÉCRIT EN LETTRES : « on 01 Aug 2026 at 14:30 ».
    Traduire les seuls noms de jours en gardant « 01/08/2026 » donnerait une
    date FAUSSE pour un lecteur anglophone — il lirait le 8 janvier. Le mois
    en lettres retire l'ambiguïté sans allonger la ligne.

    ⚠ ET L'HEURE RESTE SUR 24 HEURES, dans les deux langues : c'est celle du
    planning et de la grille horaire, qui ne changent pas de langue. Le format
    « am / pm » est réservé à ce qui est DIT à voix haute.

    `langue` vaut « fr » par défaut : tous les appels existants sont donc
    inchangés, à la lettre près.
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
    """« 10 heures 20 », « 9 heures » pile, « 1 heure 05 ».

    Le français d'un secrétariat au téléphone : « heures » au pluriel dès deux
    heures, et une heure pile ne se dit pas « neuf heures zéro zéro ».

    ⚠ EN ANGLAIS, C'EST L'HORLOGE DE 12 HEURES. « 14:30 » se dit « half past
    two », jamais « fourteen thirty », dans la bouche d'un secrétariat. On
    rend donc « 2:30 pm », et « 9 am » pour une heure pile — la même règle
    qu'en français : une heure pile ne se dit pas avec ses minutes.
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
    """« 2026-08-24T10:20 » devient « lundi 24 août 2026 à 10 heures 20 ».

    ⚠ LE FORMAT DE CE QUI EST DIT À VOIX HAUTE (sa demande du 24/08/2026).
    Ce qui partait vers l'agent était « le 24/08/2026 à 10h20 » — des chiffres
    et des barres obliques. Un agent vocal n'a rien pour deviner qu'il faut
    lire « vingt-quatre août » plutôt que « vingt-quatre barre zéro huit ». La
    date écrite en toutes lettres ne laisse plus le choix.

    ⚠ LE JOUR EN MINUSCULE : la date s'emploie DANS une phrase — « votre
    rendez-vous du lundi 24 août 2026 ». Une majuscule au milieu d'une phrase
    serait une faute, et c'est un texte lu par une machine à une personne.

    ⚠ L'ANNÉE EST TOUJOURS DITE (son choix du 24/08/2026) : aucune ambiguïté
    possible sur un rendez-vous de janvier appelé en décembre.

    Rend la valeur telle quelle si elle n'est pas une date : jamais une date
    inventée, jamais du vide silencieux.
    """
    try:
        quand = datetime.datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return iso or ""
    if langue == "en":
        # ⚠ LE JOUR PREND UNE MAJUSCULE EN ANGLAIS, contrairement au français :
        # « Monday 24 August », jamais « monday ». C'est une règle de la langue,
        # pas un choix de style, et un agent vocal lit ce qui est écrit.
        return (f"{JOURS_EN[quand.weekday()]} {quand.day} "
                f"{MOIS_EN[quand.month - 1]} {quand.year} at "
                f"{heure_parlee(quand, langue)}")
    return (f"{JOURS[quand.weekday()]} {quand.day} {MOIS[quand.month - 1]} "
            f"{quand.year} à {heure_parlee(quand)}")


# ⚠ CE QUE LE CALENDRIER SAIT LIRE — LE LECTEUR UNIQUE (sa demande du
# 24/08/2026 : « lorsqu'il renvoie la réponse du choix du créneau, il faut
# pouvoir avoir le format utilisé dans le calendrier »).
#
# CE QUI N'ALLAIT PAS, mesuré : la date rendue par l'agent était écrite TELLE
# QUELLE dans le planning. « 2026-08-25T09:00 », « 2026-08-25 09:00 » et
# « 2026-08-25T09:00:00 » sont le MÊME instant — ils entraient en base sous
# trois écritures différentes, et la comparaison de textes qui décide quelle
# place a été retenue en refusait deux sur trois. Une date en français, elle,
# faisait basculer la personne en « à rappeler par un humain ».
#
# ⚠ ET CE RISQUE MONTE avec les dates dites en toutes lettres : à qui entend
# « mardi 25 août 2026 à 9 heures », il arrive de le récrire tel quel.
#
# ⚠ ON LIT, ON NE DEVINE PAS. Une forme non reconnue rend None — l'appelant
# traite alors la réponse comme illisible, ce qu'elle est. Inventer une date
# poserait un rendez-vous que personne n'a pris.
_MOIS_LUS = {nom: rang for rang, nom in enumerate(MOIS, start=1)}
# Les abréviations que l'on rencontre (« 25 aout », sans accent, arrive).
_SANS_ACCENT = str.maketrans("àâäéèêëîïôöùûüç", "aaaeeeeiioouuuc")
for _nom, _rang in list(_MOIS_LUS.items()):
    _MOIS_LUS[_nom.translate(_SANS_ACCENT)] = _rang
# ⚠ ET LES MOIS ANGLAIS, ENTIERS ET ABRÉGÉS (01/09/2026). Un agent qui a mené
# la conversation en anglais rend une date en anglais : sans ces noms-là,
# `lire_date` rendait None et CHAQUE rendez-vous convenu au téléphone partait
# « à rappeler par un humain ». Mesuré sur six formes anglaises courantes :
# six fois None.
for _rang, _nom in enumerate(MOIS_EN, start=1):
    _MOIS_LUS[_nom.lower()] = _rang
for _rang, _nom in enumerate(MOIS_EN_COURT, start=1):
    _MOIS_LUS[_nom.lower()] = _rang

# ⚠ L'ARTICLE ET LE JOUR SE RETIRENT ENSEMBLE. Le produit ÉCRIT « le mardi 25
# août 2026 à 9 heures » : l'article fait partie de ce qu'il écrit (voir
# `_en_toutes_lettres`). Un lecteur qui ne l'accepte pas ne sait pas relire ce
# que son propre produit vient d'écrire — mesuré le 24/08/2026 : `lire_date`
# rendait None sur toute date sortie de `date_parlee`. Un essai d'aller-retour
# tient maintenant cette règle sur les deux sens.
_ARTICLE_ET_JOUR = re.compile(
    r"^(?:l[ea]\s+|l'|du\s+|au\s+|on\s+|the\s+)?"
    r"(?:(?:" + "|".join(JOURS + JOURS_EN) + r"),?\s+)?",
    re.IGNORECASE)
_DATE_FRANCAISE = re.compile(
    r"^(\d{1,2})\s+([a-zà-ÿ]+)\.?\s+(\d{4})$", re.IGNORECASE)
# « August 25, 2026 » et « Aug 25 2026 » : le mois D'ABORD, la virgule permise.
_DATE_ANGLAISE = re.compile(
    r"^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$", re.IGNORECASE)
_DATE_CHIFFREE = re.compile(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$")
_HEURE = re.compile(
    r"^(\d{1,2})\s*(?:h(?:eures?)?|:|\.)?\s*(\d{1,2})?\s*"
    r"(am|pm|a\.m\.|p\.m\.)?$", re.IGNORECASE)
_AM_PM_COLLE = re.compile(r"(\d)\s+(am|pm|a\.m\.|p\.m\.)", re.IGNORECASE)


def _heure_lue(texte):
    """« 9 heures 20 », « 9h20 », « 9h », « 09:20 », « 2:30 pm » → (h, m) ou None.

    ⚠ « pm » DÉPLACE L'HEURE, il ne la décore pas. « 2:30 pm » vaut 14:30 : le
    lire 2:30 poserait un rendez-vous DOUZE HEURES trop tôt, et personne à
    l'écran ne verrait la faute — l'heure resterait plausible.
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
    """Ramène une date au format du calendrier (« 2026-08-25T09:00 »), ou None.

    Formes acceptées — toutes celles qu'un agent téléphonique peut rendre :
    - « 2026-08-25T09:00 », avec les secondes, avec une espace au lieu du
      « T », avec un décalage horaire ;
    - « 25/08/2026 09:00 », « 25/08/2026 à 09h00 » ;
    - « lundi 25 août 2026 à 9 heures 20 », « 25 aout 2026 9h ».

    ⚠ UN DÉCALAGE HORAIRE EST RETIRÉ, l'heure de l'horloge est gardée telle
    quelle. Le calendrier est en heure locale sans fuseau ; l'agent parle
    d'heures françaises à une personne française, et c'est cette heure-là —
    celle qui a été dite au téléphone — qui doit se retrouver dans le planning.
    """
    brut = " ".join(str(texte or "").split())
    if not brut:
        return None
    # ⚠ « 9:00 AM » PORTE UNE ESPACE, ET LA COUPURE SE FAIT AUX ESPACES.
    # Le texte est séparé en date et heure au DERNIER espace : « August 25,
    # 2026 9:00 AM » se coupait donc entre « 9:00 » et « AM », et l'heure
    # devenait illisible. On recolle am/pm à son heure avant de couper — c'est
    # la seule normalisation faite ici, et elle ne change rien au français.
    brut = _AM_PM_COLLE.sub(r"\1\2", brut)
    # ① l'ISO, sous toutes ses écritures.
    try:
        quand = datetime.datetime.fromisoformat(brut)
    except ValueError:
        quand = None
    if quand is not None:
        return quand.replace(tzinfo=None).isoformat(timespec="minutes")
    # ② le français. On sépare la date de l'heure, puis on lit chaque moitié.
    sans_jour = _ARTICLE_ET_JOUR.sub("", brut, count=1).strip()
    # « at » pour l'anglais, aux mêmes conditions que « à ».
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
        # `_date_lue` a déjà écarté les dates impossibles : la construction ne
        # peut plus lever. Le filet reste, parce qu'une exception ici ferait
        # échouer un appel réel pour une faute de frappe de l'agent.
        try:
            return datetime.datetime(jour[0], jour[1], jour[2],
                                     heure[0], heure[1]).isoformat(
                                         timespec="minutes")
        except ValueError:
            return None
    return None


def _date_lue(texte):
    """« 25 août 2026 », « August 25, 2026 », « 25/08/2026 » → (a, m, j) ou None.

    ⚠ ELLE NE REND JAMAIS UNE DATE IMPOSSIBLE (01/09/2026). Elle rendait
    auparavant les trois nombres tels quels, et c'est l'appelant qui
    construisait la date — donc c'est lui qui LEVAIT. Mesuré :
    `lire_date("08/25/2026 09:00")` levait `ValueError: month must be in
    1..12`, non rattrapée, et l'appel entier était audité « échec » sur une
    date mal formée. Le contrôle appartient ici, au seul endroit qui sait ce
    que les trois nombres veulent dire.

    ⚠ ET L'ORDRE DES NOMBRES SE DÉDUIT QUAND IL LE PEUT. « 25/08/2026 » n'est
    lisible que jour/mois ; « 08/25/2026 » n'est lisible que mois/jour (un
    anglophone l'écrit ainsi). On tranche donc dès qu'un des deux nombres
    dépasse 12. Quand les deux sont ≤ 12 — « 01/02/2026 » — AUCUNE déduction
    n'est possible : on garde l'ordre français, celui du calendrier de ce
    produit. C'est pourquoi la consigne réclame le format « 2026-08-15T14:30 »,
    qui ne se lit que d'une façon.
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
        return _valide(annee, second, premier)           # ordre français
    return None


def _valide(annee, mois, jour):
    """(année, mois, jour) si cette date EXISTE, sinon None. Jamais d'exception."""
    try:
        datetime.date(annee, mois, jour)
    except ValueError:
        return None
    return annee, mois, jour


def _heure_lisible(hhmm):
    """« 09:00 » devient « 9h00 » (heure française, sans zéro de tête)."""
    heures, _, minutes = (hhmm or "").partition(":")
    return f"{int(heures)}h{minutes}" if heures.isdigit() else hhmm


def creneaux_lisibles(preferences):
    """Les créneaux AJOUTÉS À LA MAIN, lisibles : « le 01/08/2026 à 14h00 ».

    Depuis les horaires d'ouverture, les créneaux proposés sont CALCULÉS
    (ouvert − déjà pris − jours fermés) : c'est horaires.creneaux_lisibles()
    qui rend la liste complète, et le serveur la passe ici sous le nom
    « creneaux ». Cette fonction reste la liste tapée à la main, le cas
    particulier — et le repli quand aucun horaire d'ouverture n'est réglé.
    """
    # ⚠ EN TOUTES LETTRES : ces créneaux remplissent [créneaux_disponibles]
    # dans les gabarits ci-dessus, et ces gabarits sont DITS au téléphone.
    creneaux = preferences.obtenir(CLE_CRENEAUX) or []
    return ", ".join(f"le {date_parlee(c)}" for c in creneaux)


def plage(preferences):
    """La plage autorisée réglée, sous la forme (« HH:MM », « HH:MM »)."""
    return (preferences.obtenir(CLE_PLAGE_DEBUT) or PLAGE_DEBUT_DEFAUT,
            preferences.obtenir(CLE_PLAGE_FIN) or PLAGE_FIN_DEFAUT)


def plage_lisible(preferences, langue="fr"):
    """« entre 9h00 et 19h00 » — pour les gabarits et les messages d'erreur.

    ⚠ ELLE PART AU TÉLÉPHONE, DONC ELLE SUIT LA LANGUE. Cette phrase est
    insérée dans la sortie de secours dictée à l'agent (« qui vous rappellera
    entre… ») : laissée en français au milieu d'une consigne anglaise, elle
    serait lue telle quelle à un patient anglophone.
    """
    debut, fin = plage(preferences)
    if langue == "en":
        # « 09:00 » tel quel : l'horloge de 24 heures est celle du planning,
        # et une plage d'ouverture n'a pas besoin d'am/pm pour se lire.
        return f"between {debut} and {fin}"
    return f"entre {_heure_lisible(debut)} et {_heure_lisible(fin)}"


# ----------------------------------------------------------- substitutions
def substituer_reglages(texte, preferences, creneaux=None):
    """Substitue [entreprise], [créneaux_disponibles] et [plage_rappel].

    creneaux : la liste lisible des créneaux à proposer, CALCULÉE depuis les
    horaires d'ouverture par le serveur (horaires.creneaux_lisibles) ; à
    défaut, les créneaux tapés à la main dans les réglages.
    Une variable sans valeur réglée reste telle quelle, visible et
    modifiable — jamais de valeur inventée. Sert aux gabarits d'appel ET
    aux gabarits de campagne (module campagnes).
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
    """Le gabarit du thème, pré-rempli avec les réglages disponibles.

    Substitue [entreprise], [créneaux_disponibles] et [plage_rappel] depuis
    les réglages, et [client] / [date_rdv] si le rendez-vous visé est déjà
    connu (rappel individuel). Une variable sans valeur reste telle quelle,
    visible et modifiable — jamais de valeur inventée. Rend "" pour le
    thème « personnalisé » et lève ValueError pour un code inconnu.
    """
    if code not in GABARITS:
        raise ValueError(f"Thème d'appel inconnu : {code!r}")
    texte = substituer_reglages(GABARITS[code], preferences, creneaux)
    return finaliser(texte, nom_client, date_rdv)


def finaliser(texte, nom_client=None, date_rdv=None):
    """Substitue [client] et [date_rdv] — appelée PAR APPEL par le planificateur.

    Le texte rendu est celui que l'agent lit : il ne contient jamais le
    numéro de téléphone (aucun gabarit n'en porte, et le numéro ne fait
    jamais partie des substitutions).
    """
    if nom_client:
        texte = texte.replace("[client]", nom_client)
    if date_rdv:
        # ⚠ EN TOUTES LETTRES, pour la même raison : ce texte est celui que
        # l'agent lit. « le 01/08/2026 à 14h30 » ne se prononce pas.
        texte = texte.replace("[date_rdv]", f"le {date_parlee(date_rdv)}")
    return texte


# ---------------------------------------------------- garde-fou de politesse
def hors_plage(preferences, maintenant=None):
    """Rend un message d'erreur français si on est HORS plage d'appel, sinon None.

    Garde-fou de politesse : on n'appelle pas les gens en dehors de la
    plage réglée (9h-19h par défaut). Vérifié au LANCEMENT des appels
    (rappel individuel, exécution de la file, cascade) — mettre en file
    reste permis à toute heure.
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
