"""Un agenda ICS d'exemple, FABRIQUÉ À L'INSTANT où on le demande.

Demande du propriétaire du 10/08/2026 : « une bonne centaine de rendez-vous sur
les prochaines semaines… par rapport aux dates du moment, pour que peu importe
le moment où l'on génère le jeu de données ce soit toujours valable ».

⚠ POURQUOI PAS UN FICHIER FIGÉ. Les trois exemples livrés
(`exemple_agenda.ics` et ses deux variantes) portent des dates ÉCRITES : trois
mois plus tard, tout y est passé, l'import ne remplit plus le planning et la
démonstration ne montre rien. Celui-ci part de `datetime.now()` : il est juste
le jour où on l'ouvre, et il le restera.

⚠ TOUS LES NUMÉROS SORTENT DES SIX RACINES QUE L'ARCEP RÉSERVE aux œuvres
audiovisuelles (voir l'entête de `jeu_essai.py`). Elles ne sont attribuées à
personne : aucun de ces numéros ne peut appeler ni être appelé. C'est la même
règle que partout ailleurs dans le produit, et `preparer_publication.py` la
vérifie sur la copie publiée.

⚠ IL SE CALE SUR LES HORAIRES RÉGLÉS (10/08/2026). Les jours ouverts, les
plages de la semaine type, le pas de créneau et les jours fermés viennent des
⚙ Réglages → 🗓 Agenda. Avant, ils étaient ÉCRITS ici : importé dans un cabinet
qui ouvre le samedi, ferme le mercredi ou travaille par quarts d'heure,
l'exemple tombait à côté des heures d'ouverture — le planning montrait des
rendez-vous hors des cases, et les campagnes de créneau libre ne trouvaient pas
les places attendues. Sans aucun horaire réglé, on ne devine pas les heures
ouvrées d'un cabinet : on prend les plages de repli ci-dessous, et l'écran le
DIT.

⚠ UNE PLACE SUR DEUX SEULEMENT EST PRISE, PRÈS. Un agenda plein à craquer ne
laisserait aucune place libre à proposer — et proposer une place libre est
justement ce que le produit sait faire de mieux.

⚠ ET IL COUVRE CENT QUATRE-VINGTS JOURS, DE PLUS EN PLUS CLAIRSEMÉ. Demande du
propriétaire le 11/08/2026 : « puisqu'on a du 90 jours on devrait avoir des
exemples sur 100 jours ». Il visait juste, et le manque était plus large que
prévu : la règle de liste propose « jusqu'à 30 jours après » et « jusqu'à
90 jours après » (`assistant.JOURS_APRES`), et l'exemple s'arrêtait à trois
semaines — ces deux options ne pouvaient donc RIEN donner de différent de
« sans limite ». Mesuré avant : 462 rendez-vous sur 21 jours.

⚠ CENT → CENT QUATRE-VINGTS LE 15/08/2026, ET LA CAUSE EST MESURÉE. Son
constat : « la cascade s'arrête à la deuxième occurrence ; normalement cela
doit continuer jusqu'à la date limite ». Le moteur était juste — c'est
l'EXEMPLE qui manquait de matière. Chaque maillon d'un décalage en cascade
consomme le gain demandé : avec « au moins 30 jours », le deuxième maillon
cherche des rendez-vous à 60 jours, le troisième à 90, le quatrième à 120…
Cent jours d'exemple n'autorisent donc que DEUX maillons, quelle que soit la
date limite réglée. Mesuré dans sa base : rendez-vous jusqu'au 23/11, chaîne
morte sur la place du 06/11 faute de quiconque au 06/12.

Cent quatre-vingts jours laissent cinq à six maillons à 30 jours de gain, et
la densité du dernier palier a été abaissée (une place sur 30) pour que
l'agenda ne double pas en volume : au loin, un vrai agenda est presque vide.

La densité DÉCROÎT avec l'éloignement (voir DENSITE), et ce n'est pas un
artifice : un agenda réel est presque plein la semaine prochaine et presque
vide dans trois mois. Deux bénéfices d'un coup — les fenêtres de 30 et 90 jours
ont enfin de la matière, et les places libres lointaines abondent, ce qui est
exactement ce qu'une campagne de créneau libéré cherche.

⚠ TROIS FAMILLES D'ÉVÉNEMENT, EXPRÈS. Un agenda réel n'est pas homogène, et
l'import doit se montrer sur les trois cas :
 · un numéro dans la DESCRIPTION → le contact arrive avec son téléphone ;
 · aucun numéro → il arrive « sans numéro », à compléter (c'est un vrai cas,
   et l'écran a une page pour lui) ;
 · un nom DÉJÀ dans le carnet, avec SON numéro → il est reconnu sur le couple
   nom + numéro, et rien n'est dupliqué.
"""

import collections
import datetime

from . import horaires, jeu_essai

# ------------------------------------------------------------- LE REPLI
# Ce qui sert UNIQUEMENT quand aucun horaire d'ouverture n'est réglé. Ce n'est
# pas une valeur devinée : c'est un exemple assumé, et l'écran dit qu'il en est
# un (voir `repli` dans le retour de `plan`).
PAS_REPLI = 30                                    # une demi-heure
PLAGES_REPLI = ((9 * 60, 12 * 60 + 30), (14 * 60, 18 * 60 + 30))
JOURS_REPLI = (0, 1, 2, 3, 4)                     # lundi au vendredi

# ------------------------------------------------------- CE QU'ON VISE
# L'ÉTENDUE, en jours, et c'est ELLE qui décide. Cent, parce que la règle de
# liste propose « jusqu'à 90 jours après la place » : un exemple qui s'arrête
# avant rend cette option indiscernable de « sans limite ». Voir l'entête.
JOURS_COUVERTS = 180
# LE PLANCHER, en nombre de rendez-vous. « Une bonne centaine », dit la demande
# d'origine. Il n'allonge JAMAIS l'étendue — un exemple qui s'étalerait sur un
# an pour atteindre son compte ne ressemblerait plus à un agenda. S'il n'est pas
# atteint avec la densité normale, on prend TOUTES les places libres des cent
# jours ; et si cela ne suffit toujours pas, c'est que le cabinet a une semaine
# type étroite — son agenda est petit, et le dire vaut mieux que de l'étirer.
CIBLE = 100
# LA DENSITÉ, PAR PALIER : (jusqu'à J jours, une place sur N est prise).
# Presque plein la semaine prochaine, presque vide dans trois mois — c'est ce
# que fait un agenda réel, et c'est ce qui laisse des places libres au loin.
DENSITE = ((21, 2), (45, 5), (70, 10), (110, 20), (JOURS_COUVERTS, 30))
# Ce qui s'applique au-delà du dernier palier, quand on continue pour atteindre
# le plancher : la densité la plus faible, celle du loin.
UNE_PLACE_SUR = DENSITE[-1][1]

MOTIFS = (
    "Séance de kinésithérapie", "Bilan initial", "Rééducation du genou",
    "Suivi post-opératoire", "Massage thérapeutique", "Rééducation de l'épaule",
    "Séance de groupe", "Contrôle annuel", "Drainage lymphatique",
    "Rééducation du dos",
)

# Des identités qui ne sont PAS dans le carnet : elles arrivent par l'agenda,
# et c'est le cas le plus courant d'un premier import.
#
# ⚠ DEUX GROUPES DISJOINTS, ET UN NUMÉRO PAR PERSONNE. La première version
# faisait paraître le même nom tantôt avec un numéro, tantôt sans, et lui
# donnait un numéro DIFFÉRENT à chaque rendez-vous : l'import créait alors huit
# fiches pour la même personne — mesuré, cinq noms en huit exemplaires. Un vrai
# agenda ne fait pas ça, et le produit n'a pas à s'en défendre.
#
# ⚠ ET LE SANS-NUMÉRO EST DEVENU RARE (11/08/2026). LE DÉFAUT, MESURÉ DANS LA
# BASE RÉELLE DU PROPRIÉTAIRE : l'agenda importé y avait posé 32 personnes SANS
# numéro contre 8 avec. Un contact sans numéro ne peut pas être appelé — sa
# campagne de créneau libéré ne trouvait donc que 7 personnes, quel que soit le
# réglage. Il a cherché la cause quatre fois de suite, et elle était là.
#
# Le cas « sans numéro » doit EXISTER — c'est un vrai cas d'agenda, et le
# produit a un écran pour lui. Mais il ne doit pas être la règle : un agenda
# d'exemple sert à faire tourner des campagnes, donc à appeler du monde. Une
# personne sur dix, désormais (voir `famille` dans `rendezvous`).
# ⚠ UNE PERSONNE = UN RENDEZ-VOUS (14/08/2026). Demande du propriétaire, mot
# pour mot : « il faut que ce soit une liste de noms uniquement, sinon les tests
# deviennent juste impossibles ». Il avait raison, et c'était mesurable : les
# trente noms ci-dessous tournaient en boucle sur six cent trente rendez-vous —
# SIX rendez-vous par personne en moyenne, dix-sept pour la plus servie. Impossible
# de suivre quoi que ce soit : la même personne apparaissait dans la liste d'appel,
# dans le planning, dans le cahier, à des dates différentes, et l'on ne savait plus
# ce qu'on regardait.
#
# On ne peut pas écrire six cents noms à la main. On les COMPOSE : chaque prénom
# de PRENOMS marié à chaque nom de FAMILLES fait une identité, et le parcours est
# déterministe (voir `_identite`). Trente-six prénoms × vingt et un noms = 756
# personnes distinctes, largement de quoi couvrir cent jours d'agenda sans jamais
# répéter quelqu'un.
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


# ⚠ LES TERMINAISONS QUE L'EXEMPLE S'INTERDIT (14/08/2026). Le simulateur
# RÉSERVE les fins 51 à 59 : un numéro qui finit par là EXIGE son issue (voir
# calle_client.TERMINAISONS_FORCEES), et « 59 » exige la pire — l'agent ne rend
# rien de lisible, et la campagne se met EN PAUSE, à dessein.
#
# LE DÉFAUT, MESURÉ DANS LA BASE DU PROPRIÉTAIRE : en portant AVEC_NUMERO de 8
# à 30 noms, la formule « 40 + rang » s'est mise à produire 40 … 69 — donc
# 51 à 59 au passage. Sa campagne de 30 contacts a reçu, dans ses cinq premiers
# appels, un « 57 » (refuse et 🚫), un « 58 » (refus poli), un « 52 » (refuse)
# et un « 59 » : cinq appels, une place pourvue, puis PAUSE. Il attendait
# trente appels — il n'avait pas tort, et rien ne le lui disait.
#
# Ces fins-là doivent rester à la MAIN de celui qui essaie : il tape un numéro
# en 59 quand il VEUT voir ce cas. L'exemple, lui, ne les tire jamais.
FINS_RESERVEES = tuple(f"{n:02d}" for n in range(51, 60))
# Les 81 terminaisons qui restent — celles que l'exemple peut employer.
FINS_SURES = tuple(n for n in range(10, 100) if not 51 <= n <= 59)


def _identite(rang, famille_debut=0):
    """LA personne de rang `rang` — jamais la même deux fois.

    Composition déterministe : le prénom avance d'un cran à chaque personne, le
    nom de famille avance quand on a fait le tour des prénoms. Comme les deux
    listes n'ont pas la même longueur, on parcourt les 756 combinaisons avant
    d'en revoir une — bien au-delà des six cents rendez-vous d'un agenda de
    cent jours. Voir le pavé au-dessus de PRENOMS.

    `famille_debut` RÉSERVE une plage de noms de famille à une famille de
    rendez-vous. Les sans-numéro partent des dernières : sans cela, un simple
    décalage finissait par recouper les autres, et la même personne se
    retrouvait avec un numéro ici et sans numéro là (mesuré).
    """
    civilite, prenom = PRENOMS[rang % len(PRENOMS)]
    famille = FAMILLES[(famille_debut + rang // len(PRENOMS)) % len(FAMILLES)]
    return f"{civilite} {prenom} {famille}"


def _numero(rang):
    """LE numéro de la personne de rang `rang` — toujours le même pour elle.

    ⚠ JAMAIS UN NUMÉRO INVENTÉ AU HASARD : les six racines sont réservées par
    l'Arcep aux œuvres audiovisuelles, donc sûres. Un « 06 12 34 56 78 » aurait
    pu sonner chez quelqu'un.

    ⚠ ET IL DÉPEND DE LA PERSONNE, PAS DU RENDEZ-VOUS. Un numéro qui changeait
    d'un rendez-vous à l'autre faisait créer une fiche par rendez-vous.

    ⚠ ET IL SAUTE LES TERMINAISONS RÉSERVÉES (voir FINS_RESERVEES) : le
    simulateur les garde pour exiger une issue précise, et « 59 » met la
    campagne en pause.

    ⚠ ET IL TIENT JUSQU'À HUIT MILLE PERSONNES (14/08/2026). L'ancienne formule
    (« 40 + rang ») débordait dès le centième : elle écrivait trois chiffres là
    où il en faut deux, et retombait dans les terminaisons réservées. Le couple
    (milieu, fin) est ici une bijection du rang — deux personnes ne peuvent donc
    pas partager un numéro.
    """
    racine = jeu_essai.RACINES_FICTION[rang % len(jeu_essai.RACINES_FICTION)]
    fin = FINS_SURES[rang % len(FINS_SURES)]
    milieu = 10 + (rang // len(FINS_SURES))
    return f"{racine} {milieu:02d} {fin:02d}"


def _deja_au_carnet():
    """Les gens du carnet que l'exemple peut annoncer : [(nom, téléphone)].

    ⚠ AVEC LEUR NUMÉRO (11/08/2026). Cette famille sort du carnet, et l'agenda
    ne portait que leur NOM : quand le jeu d'essai n'est pas chargé — le cas de
    la base réelle du propriétaire — l'import créait donc des fiches SANS
    numéro, injoignables. Un export d'agenda porte le téléphone quand il l'a ;
    celui-ci aussi. Le nom RESTE reconnu, sur le couple nom + numéro.

    ⚠ ET DEUX SORTES DE NOMS SONT ÉCARTÉES (13/08/2026), parce qu'elles ne
    désignent pas UNE personne et UN numéro :
     · les homonymes du jeu d'essai — deux « M. Jean Martin » distincts, mis là
       exprès pour que l'écran sache les montrer ;
     · les quatre contacts d'amorçage (`jeu_essai.PREMIERS_CONTACTS`), qui
       portent trois de ces noms sous un AUTRE numéro.
    Sans cet écart, l'import de l'exemple créait une seconde fiche au même nom
    — précisément ce que cette famille est censée démontrer qu'on évite.
    """
    comptes = collections.Counter(nom for nom, _, _ in jeu_essai.CLIENTS)
    amorce = {nom for nom, _, _, _, _, _ in jeu_essai.PREMIERS_CONTACTS}
    return [(nom, telephone) for nom, telephone, _ in jeu_essai.CLIENTS
            if telephone and comptes[nom] == 1 and nom not in amorce]


def _tranches_reglees(preferences):
    """(semaine type, pas) tels qu'ils sont RÉGLÉS, ou le repli. Rend aussi
    le drapeau « c'est un repli ».

    La semaine type est {jour (0=lundi) : [(début, fin) en minutes]}, telle
    que la rend `horaires.semaine` — donc déjà fusionnée et triée.
    """
    if preferences is not None and horaires.semaine_ouverte(preferences):
        return (horaires.semaine(preferences),
                horaires.pas_minutes(preferences), False)
    repli = {jour: (list(PLAGES_REPLI) if jour in JOURS_REPLI else [])
             for jour in range(7)}
    return repli, PAS_REPLI, True


def _creneaux(periodes, pas):
    """Les minutes de début possibles dans ces périodes, de `pas` en `pas`."""
    minutes = []
    for debut, fin in periodes:
        minutes.extend(range(debut, fin, pas))
    return minutes


def une_place_sur(jours_apres_aujourd_hui):
    """La densité à cette distance : une place sur N est prise. Voir DENSITE.

    Ouverte parce que l'écran s'en sert pour DIRE ce qu'il a fabriqué : un
    exemple dont la densité change avec l'éloignement doit s'expliquer, sinon
    « 250 rendez-vous » ne dit pas où ils sont.
    """
    for limite, sur in DENSITE:
        if jours_apres_aujourd_hui <= limite:
            return sur
    return UNE_PLACE_SUR


def plan(maintenant=None, preferences=None, cible=CIBLE):
    """Les jours à remplir : {"jours": [(jour, [minutes]), …], "pas", "repli"}.

    ⚠ C'EST ICI, ET NULLE PART AILLEURS, QUE LES RÉGLAGES SONT LUS. Les jours
    fermés (fériés, congés) sont sautés ; les jours sans période ouverte le sont
    aussi. On avance jour par jour à partir de DEMAIN, et l'on s'arrête au
    centième — l'étendue décide, jamais le compte (voir CIBLE).

    La densité décroît avec l'éloignement : voir DENSITE et `une_place_sur`.
    Quand elle ne suffit pas à atteindre le plancher, on refait le même parcours
    en prenant TOUTES les places libres — sans jamais sortir des cent jours.
    """
    maintenant = maintenant or datetime.datetime.now()
    depart = maintenant.replace(hour=0, minute=0, second=0, microsecond=0)
    semaine, pas, repli = _tranches_reglees(preferences)

    def parcourir(serre):
        """Les cent jours, à la densité normale ou en prenant tout."""
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
    """L'échappement iCalendar : virgule, point-virgule, barre et retour."""
    return (texte.replace("\\", "\\\\").replace(";", "\\;")
            .replace(",", "\\,").replace("\n", "\\n"))


def rendezvous(maintenant=None, preferences=None, cible=CIBLE):
    """La liste des rendez-vous de l'exemple : [(début, durée, nom, motif, tél)].

    Déterministe à partir de `maintenant` ET des réglages : deux appels le même
    jour, sur les mêmes horaires, donnent le même agenda. Rien n'est tiré au
    hasard — un exemple qui change à chaque ouverture serait impossible à
    décrire dans une documentation.

    `preferences` : les réglages du cabinet. Sans eux (ou sans aucun horaire
    d'ouverture réglé), on prend les plages de repli — voir `plan`.
    """
    detail = plan(maintenant, preferences, cible)
    pas = detail["pas"]
    connus = _deja_au_carnet()
    # ⚠ UN COMPTEUR PAR FAMILLE, PAS LE RANG (13/08/2026). L'index était
    # `rang % len(…)` : comme une famille ne prend qu'un rang sur deux, les
    # rangs PAIRS pris modulo une liste de taille PAIRE ne tombent que sur les
    # index pairs — la moitié des identités n'était jamais utilisée. Mesuré :
    # 55 personnes distinctes là où la liste en offrait 88. Un compteur propre
    # à chaque famille les parcourt toutes, dans l'ordre.
    tirage = {"sans": 0, "avec": 0, "connu": 0}
    # ⚠ ET LES GENS DU CARNET NE REVIENNENT PAS NON PLUS. Ils sont peu nombreux
    # (le jeu d'essai en compte quelques dizaines) : une fois la liste épuisée,
    # on continue avec des identités composées, plutôt que de recommencer au
    # premier et de lui donner un huitième rendez-vous.
    liste, rang = [], 0
    for jour, creneaux in detail["jours"]:
        for indice, minute in enumerate(creneaux):
            debut = jour + datetime.timedelta(minutes=minute)
            # Un rendez-vous sur cinq est DEUX FOIS PLUS LONG : un agenda réel
            # n'est pas homogène. Il mange la place laissée libre après lui —
            # jamais celle d'un autre rendez-vous, et jamais au-delà du
            # dernier créneau du jour.
            double = rang % 5 == 0 and indice + 1 < len(creneaux)
            duree = pas * (2 if double else 1)
            # ⚠ TROIS FAMILLES, ET UNE IDENTITÉ N'APPARTIENT QU'À UNE SEULE.
            # Mélanger les deux premières faisait créer huit fiches pour la
            # même personne.
            #
            # ⚠ LES PROPORTIONS ONT CHANGÉ LE 11/08/2026 : le sans-numéro était
            # UN SUR TROIS, et un contact sans numéro ne peut pas être appelé.
            # Dans la base réelle du propriétaire, l'agenda importé avait ainsi
            # posé 32 personnes injoignables contre 8 joignables — et sa campagne
            # ne trouvait que 7 personnes. Le cas reste présent, à sa juste
            # place : un sur dix.
            if rang % 10 == 0:
                # Sans numéro : il arrivera « à compléter », et c'est voulu.
                # Ses noms de famille sont RÉSERVÉS (les trois derniers) : une
                # même personne ne peut donc pas être ici sans numéro et
                # ailleurs avec.
                nom = _identite(tirage["sans"],
                                famille_debut=len(FAMILLES) - 3)
                telephone = ""
                tirage["sans"] += 1
            elif tirage["connu"] < len(connus) and rang % 7 == 3:
                # Déjà dans le carnet : reconnu, rien n'est dupliqué. Chacun
                # une seule fois — la liste est courte, on ne la reboucle pas.
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
    """Le fichier ICS complet, en texte — prêt à être téléchargé.

    La forme suit celle d'un export Google Agenda, parce que c'est celle que
    les gens ont sous la main : VTIMEZONE Europe/Paris, DTSTART avec TZID,
    DTEND explicite, DESCRIPTION portant le téléphone quand il y en a un.
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
            # ⚠ L'ÉTIQUETTE COMPTE : le lecteur d'ICS ne prend un numéro que
            # s'il est annoncé (voir ics._numero_dans_texte). Un numéro nu dans
            # une description ressemble trop à une référence de dossier.
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
    # Les fins de ligne d'iCalendar sont des CRLF, et le fichier en finit par un.
    return "\r\n".join(lignes) + "\r\n"
