"""Essai en conditions RÉELLES : les testeurs, et leur campagne prête.

À QUOI ÇA SERT
--------------
Avant de confier RingBack à de vrais patients, l'opérateur veut l'éprouver
pour de bon : de vrais appels, passés par l'agent CALL-E, sur des téléphones
qu'il connaît — le sien, et ceux des personnes qui acceptent de jouer un
rôle avec lui (un collègue, un ami, le cabinet d'à côté). Chacun joue tour à
tour une issue : j'accepte, je refuse, je demande une autre date, je veux
parler à un humain, je ne décroche pas.

Pour cela il lui faut PLUSIEURS contacts, avec des identités différentes,
sur un petit nombre de numéros connus. Or la règle anti-doublon de la grille
refuse justement deux fois le même numéro — et c'est une bonne règle : elle
existe pour ne jamais appeler deux fois la même personne.

CE MODULE NE SUPPRIME PAS CETTE RÈGLE, IL LA REND DÉLIBÉRÉE
-----------------------------------------------------------
L'opérateur DÉCLARE ses TESTEURS dans ⚙ Réglages : un nom (« moi »,
« Paul », « le cabinet d'à côté ») et un numéro pour chacun. Ces numéros-là,
et eux seuls, échappent au refus de doublon (collage, CSV, validation de la
grille). Tous les autres numéros restent soumis à la règle stricte, sans
exception. Retirer un testeur lui rend aussitôt la règle stricte ; vider la
liste la rétablit pour tout le monde.

UN SEUL NUMÉRO DÉJÀ RÉGLÉ CONTINUE DE FONCTIONNER. Avant les testeurs, un
unique numéro était déclarable (réglage « numero_essai »). Il n'est pas
perdu : s'il est là et qu'aucune liste n'a encore été composée, il devient
le PREMIER testeur, nommé « moi » — voir `testeurs()`. Rien à refaire, rien
à retaper.

Trois garanties tenues ici :
1. RIEN N'EST CACHÉ. Tout contact portant l'un des numéros déclarés est
   marqué 🧪 dans la grille, la fiche de campagne, le planning et
   👥 Contacts, avec la phrase qui dit pourquoi. Aucune confusion possible
   avec de vraies données.
2. LE MASQUAGE RESTE ENTIER. Les numéros des testeurs sont masqués à l'écran
   comme tous les autres (« +33 6 •• •• 51 ») : le drapeau dit « ceci est un
   essai », il ne révèle jamais le numéro. La reconnaissance, elle, porte
   toujours sur les NEUF CHIFFRES significatifs (db.est_numero_essai) et
   jamais sur le texte masqué — c'est ce qui évite de marquer une vraie
   personne dont le numéro se masquerait pareil.
3. AUCUN APPEL NE PART D'ICI. La campagne préparée est créée à l'état
   « prête », zéro appel passé. Les trois verrous du mode réel (la clé
   CALLE_API_KEY, l'option --appels-reels, le mot APPELER tapé au clavier)
   restent entiers et restent les gestes de l'opérateur.

ET UN AUTRE RÉGLAGE, QU'IL NE FAUT PAS CONFONDRE AVEC CELUI-LÀ
--------------------------------------------------------------
Une case « toujours utiliser MON numéro pour les essais en conditions
réelles » (⚙ Réglages → 🧪 Essais → Jeu d'essai) fait remplacer, au tout
dernier moment, le numéro COMPOSÉ par celui de l'opérateur. Les deux
réglages ne font pas du tout la même chose :

    les TESTEURS changent la BASE — des fiches portent leur numéro, sont
    marquées 🧪 partout et échappent au refus de doublon ;
    le RENVOI ne change AUCUNE fiche — les contacts gardent leur numéro,
    et c'est le numéro composé, lui seul, qui est remplacé juste avant
    l'envoi à l'agent. L'identité, le motif, le rendez-vous : rien ne
    bouge. C'est ce qui permet d'éprouver une campagne entière, sur de
    vraies données, sans faire sonner un seul vrai téléphone.

Voir CLE_IMPOSER_NUMERO et numero_impose().

LES CINQ RÔLES, ET LEURS IDENTITÉS
----------------------------------
Cinq rôles à éprouver, un par issue, avec un moyen mnémonique : l'INITIALE
DU PRÉNOM rappelle le rôle à jouer au téléphone.

    Alice   → j'Accepte le rendez-vous
    Rémi    → je Refuse / j'annule
    Diane   → je demande une autre Date
    Hugo    → je demande à parler à un Humain
    Nina    → je Ne décroche pas

On peut demander PLUS de cinq identités (jusqu'à vingt) : les rôles
reviennent alors dans le même ordre, avec d'autres prénoms de même initiale
(Alice, puis Adrien, puis Amélie…). Le rôle reste lisible d'un coup d'œil.

QUI JOUE QUOI
-------------
Les rôles sont distribués sur les testeurs déclarés, EN TOURNANT : le 1ᵉʳ
rôle au 1ᵉʳ testeur, le 2ᵉ au 2ᵉ, et on reboucle. Avec un seul testeur, tout
retombe sur lui — c'est-à-dire exactement le comportement d'avant. L'écran
annonce la répartition (« Alice (j'accepte) → Paul ») parce que, dès qu'on
est plusieurs, il faut pouvoir dire à chacun ce qu'il aura à jouer.

CE QUE CE MODULE NE PEUT PAS VÉRIFIER
-------------------------------------
L'issue d'un appel réel dépend de ce que le testeur DIT vraiment au
téléphone, et de ce que l'agent en comprend. Aucun contrôle automatique ne
peut en juger : ce sont EUX qui constatent, et c'est précisément l'objet de
l'essai. Ce module prépare le terrain ; il ne prétend rien sur le résultat.
"""

import datetime
import logging

from . import db, horaires, saisie
from .saisie import SaisieInvalide

journal = logging.getLogger("ringback.essai_reel")

# --------------------------------------------------------- clés de réglage
CLE_NUMERO_ESSAI = "numero_essai"        # « +33 6 •• •• •• » ; "" = aucun
# La LISTE des testeurs : [{"nom", "telephone"}]. Réglage AJOUTÉ, jamais
# substitué : CLE_NUMERO_ESSAI reste écrit (le numéro du premier testeur),
# si bien qu'un réglage d'avant continue d'être lu et qu'un réglage d'après
# reste lisible par tout ce qui ne connaît que l'ancien.
CLE_TESTEURS = "testeurs_essai"
# Le nom donné à un numéro unique repris de l'ancien réglage. Ce n'est pas
# une donnée devinée : c'est l'étiquette du seul testeur qu'il pouvait
# désigner — l'opérateur lui-même. Il peut la changer (retirer, ré-ajouter).
NOM_PREMIER_TESTEUR = "moi"
TESTEURS_MAXIMUM = 10

# ------------------------------------- LE RENVOI : composer MON numéro
# Demande du propriétaire du 10/08/2026 : « Toujours utiliser mon numéro de
# téléphone pour les essais en condition réel […] on remplace les numéros de
# téléphone transmis à l'agent par ce numéro de téléphone. L'IDENTITÉ RESTE
# INCHANGÉE. »
#
# ⚠ CE N'EST PAS LA MÊME CHOSE QUE LES TESTEURS ci-dessus, et confondre les
# deux mènerait droit à un appel chez un vrai client :
#  · un TESTEUR est déclaré pour qu'un CONTACT PORTE son numéro — la fiche
#    est créée avec ce numéro, marquée 🧪, et elle échappe au refus de
#    doublon. La base est modifiée, et l'écran le montre partout ;
#  · le RENVOI ne touche À AUCUNE FICHE. Les contacts gardent leur propre
#    numéro ; c'est au tout dernier moment — juste avant l'envoi à l'agent —
#    que le numéro COMPOSÉ est remplacé par celui-ci. C'est ce qui permet
#    d'éprouver une campagne entière, sur de vraies données, sans faire
#    sonner un seul vrai téléphone.
CLE_IMPOSER_NUMERO = "imposer_numero"   # la case cochée (vrai / faux)
CLE_NUMERO_IMPOSE = "numero_impose"     # le numéro qui remplace tous les autres

MARQUE = "🧪"
PHRASE_MARQUE = ("Contact d'ESSAI : il porte le numéro d'un testeur déclaré "
                 "dans ⚙ Réglages — c'est VOTRE téléphone, ou celui d'un "
                 "testeur, qui sonnera, pas celui d'un client.")
# Le badge, écrit UNE fois : la grille, la fiche de campagne, le planning et
# 👥 Contacts affichent tous exactement le même, avec la même explication.
# (Aucun guillemet double dans la phrase : elle tient dans l'attribut title.)
BADGE_HTML = (f'<span class="badge-essai" title="{PHRASE_MARQUE}">'
              f"{MARQUE} numéro d'essai</span>")


def badge(ligne, prefixe=" "):
    """Le badge 🧪 d'une ligne qui porte un numéro de testeur — sinon "".

    `ligne` est n'importe quel dictionnaire rendu par db.py avec un numéro
    masqué : client, rendez-vous, contact de campagne, relance. Une ligne
    d'avant ce drapeau (ou d'une base ouverte sans réglage) n'en a pas :
    elle ne porte alors aucun badge, ce qui est la vérité.
    """
    if not (ligne or {}).get("numero_essai"):
        return ""
    return prefixe + BADGE_HTML

# La nature de campagne utilisée par le jeu d'essai « conditions réelles ».
# « Confirmation de rendez-vous » : tout le monde est appelé (aucun arrêt au
# premier oui), chaque contact a un rendez-vous à confirmer, et les cinq
# issues à éprouver y ont toutes un sens.
NATURE = "confirmation"

# LES RÔLES À ÉPROUVER, un par issue. Pour chacun : le rôle écrit tel qu'il
# s'affiche, le motif du rendez-vous (lu par l'agent — il reste plausible
# pour un cabinet), et des identités fictives DE MÊME INITIALE, dans l'ordre
# où elles sont servies quand on demande plus de cinq identités.
ROLES = (
    {"role": "j'accepte le rendez-vous proposé", "court": "accepte",
     "motif": "Séance de rééducation",
     "dire": "Oui, c'est noté, je serai là.",
     "noms": ("Mme Alice Dubreuil", "M. Adrien Bonnel",
              "Mme Amélie Rouvier", "M. Antoine Delcourt")},
    {"role": "je refuse — j'annule mon rendez-vous", "court": "refuse",
     "motif": "Bilan articulaire",
     "dire": "Non, je ne pourrai pas venir, annulez mon rendez-vous.",
     "noms": ("M. Rémi Chastain", "Mme Rosalie Merlin",
              "M. Roland Vasseur", "Mme Raphaëlle Ducrocq")},
    {"role": "je demande une autre date", "court": "autre date",
     "motif": "Séance de kinésithérapie",
     "dire": ("Je ne peux plus à cette heure-là — mettez-moi plutôt "
              "[une date que l'agent vient de proposer]."),
     "noms": ("Mme Diane Verrier", "M. Damien Lorcet",
              "Mme Delphine Aubin", "M. David Ferrand")},
    {"role": "je demande à être rappelé par un humain", "court": "humain",
     "motif": "Rééducation de l'épaule",
     "dire": "Je ne veux pas parler à un robot, je veux qu'on me rappelle.",
     "noms": ("M. Hugo Sernin", "Mme Hélène Bardet",
              "M. Hervé Maunier", "Mme Hortense Coquelin")},
    {"role": "je ne décroche pas", "court": "ne décroche pas",
     "motif": "Séance de kinésithérapie",
     "dire": "(rien : laissez sonner jusqu'au bout, ne décrochez pas)",
     "noms": ("Mme Nina Aubert", "M. Noé Vaillant",
              "Mme Nadia Perreau", "M. Norbert Lemoine")},
)

# Les CINQ identités d'origine — une par rôle, dans l'ordre des rôles. Elles
# n'ont pas bougé : c'est ce que produit toujours une campagne d'essai
# ordinaire (cinq identités).
IDENTITES = tuple((role["noms"][0], role["role"], role["motif"])
                  for role in ROLES)

# Combien d'identités on peut demander : au moins autant que de rôles
# distincts (sinon un rôle ne serait pas éprouvé du tout), au plus ce que le
# vivier de prénoms permet de nommer sans répéter deux fois la même identité.
IDENTITES_MINIMUM = len(ROLES)
IDENTITES_MAXIMUM = len(ROLES) * min(len(role["noms"]) for role in ROLES)

# Le coût d'un appel réel chez CALL-E, tel qu'il est annoncé partout
# ailleurs dans le projet (PROCEDURE-ESSAI-REEL.md, README).
COUT_APPEL_DOLLARS = 0.05

# Heure de repli quand aucun horaire d'ouverture n'est réglé : le lendemain
# matin. Ce n'est PAS une préférence devinée — l'écran le dit en toutes
# lettres et invite à régler les horaires d'ouverture.
HEURE_REPLI = 9
JOURS_REPLI = 1


class EssaiImpossible(Exception):
    """L'essai en conditions réelles ne peut pas être préparé (message français)."""


# ------------------------------------------------------- les testeurs
def testeurs(preferences):
    """La liste des testeurs déclarés : [{"nom", "telephone"}], ou [].

    LA REPRISE DE L'ANCIEN RÉGLAGE EST ICI, et elle est faite à la LECTURE :
    tant qu'aucune liste n'a été composée, un numéro unique déjà réglé
    (CLE_NUMERO_ESSAI, du temps où l'on ne pouvait en déclarer qu'un) est
    rendu comme PREMIER testeur, nommé « moi ». Rien n'est réécrit au
    passage : un réglage ancien n'est donc jamais abîmé, et le jour où la
    liste est composée, c'est elle qui fait foi.
    """
    liste = preferences.obtenir(CLE_TESTEURS)
    propres = []
    for entree in liste or []:
        if not isinstance(entree, dict):
            continue
        telephone = (entree.get("telephone") or "").strip()
        if not telephone:
            continue
        propres.append({"nom": (entree.get("nom") or "").strip() or
                        NOM_PREMIER_TESTEUR, "telephone": telephone})
    if propres:
        return propres
    ancien = (preferences.obtenir(CLE_NUMERO_ESSAI) or "").strip()
    if ancien:
        return [{"nom": NOM_PREMIER_TESTEUR, "telephone": ancien}]
    return []


def numeros_declares(preferences):
    """Les numéros de tous les testeurs déclarés (liste, éventuellement vide)."""
    return [testeur["telephone"] for testeur in testeurs(preferences)]


def numero_declare(preferences):
    """Le numéro du PREMIER testeur, ou "" s'il n'y en a aucun.

    Gardé sous son nom d'origine : tout ce qui ne connaît qu'un seul numéro
    d'essai continue de fonctionner, et voit celui du premier testeur.
    """
    numeros = numeros_declares(preferences)
    return numeros[0] if numeros else ""


def enregistrer_testeurs(preferences, liste):
    """Écrit la liste des testeurs — et tient l'ancien réglage à jour.

    L'ancien réglage à numéro unique (CLE_NUMERO_ESSAI) reçoit le numéro du
    PREMIER testeur, ou "" si la liste est vide. Il n'y a donc jamais deux
    vérités contradictoires dans le fichier de réglages, et un programme qui
    ne connaîtrait que l'ancien nom continue de lire quelque chose de juste.
    """
    propres = [{"nom": testeur["nom"], "telephone": testeur["telephone"]}
               for testeur in liste]
    preferences.definir(CLE_TESTEURS, propres)
    preferences.definir(CLE_NUMERO_ESSAI,
                        propres[0]["telephone"] if propres else "")
    return propres


def valider_nom_testeur(brut):
    """Le nom d'un testeur (« moi », « Paul », « le cabinet d'à côté »)."""
    nom = " ".join((brut or "").split())
    if len(nom) < 2:
        raise SaisieInvalide(
            "Le nom du testeur est obligatoire (deux caractères minimum) : "
            "il sert à savoir QUI devra jouer quel rôle au téléphone — "
            "par exemple « moi », « Paul », « le cabinet d'à côté ».")
    if len(nom) > 40:
        raise SaisieInvalide(
            f"Le nom du testeur est trop long ({len(nom)} caractères) : "
            "40 au maximum, pour qu'il tienne dans le tableau des rôles.")
    return nom


def ajouter_testeur(preferences, nom_brut, numero_brut):
    """Ajoute un testeur ; rend la liste complète. Lève SaisieInvalide.

    Les deux champs sont validés SÉPARÉMENT, et le refus dit lequel est en
    cause : une saisie refusée doit pouvoir être corrigée là où elle a été
    faite, sans avoir à tout retaper.
    """
    liste = testeurs(preferences)
    if len(liste) >= TESTEURS_MAXIMUM:
        raise SaisieInvalide(
            f"{TESTEURS_MAXIMUM} testeurs au maximum sont déclarables "
            f"({len(liste)} déjà déclarés) : retirez-en un avant d'en "
            "ajouter un autre.")
    nom = valider_nom_testeur(nom_brut)
    telephone = saisie.valider_telephone_essai(numero_brut)
    for rang, testeur in enumerate(liste, start=1):
        if db.est_numero_essai(telephone, testeur["telephone"]):
            raise SaisieInvalide(
                f"Ce numéro est déjà déclaré : c'est celui du testeur n°{rang}, "
                f"« {testeur['nom']} ». Un même téléphone ne peut pas jouer "
                "deux testeurs — donnez un autre numéro, ou renommez "
                "celui-là en le retirant puis en l'ajoutant à nouveau.")
    liste.append({"nom": nom, "telephone": telephone})
    enregistrer_testeurs(preferences, liste)
    journal.info("Testeur déclaré : « %s » (%d testeur(s) au total)",
                 nom, len(liste))
    return liste


def retirer_testeur(preferences, rang):
    """Retire le testeur de ce rang (1 = le premier) ; rend (liste, retiré).

    « retiré » est le testeur ôté, ou None si le rang ne désigne personne —
    l'écran le DIT plutôt que de faire semblant d'avoir agi.
    """
    liste = testeurs(preferences)
    if not isinstance(rang, int) or rang < 1 or rang > len(liste):
        return liste, None
    retire = liste.pop(rang - 1)
    enregistrer_testeurs(preferences, liste)
    journal.info("Testeur retiré : « %s » — la règle stricte du doublon lui "
                 "est rendue (%d testeur(s) restant)", retire["nom"], len(liste))
    return liste, retire



# ------------------------------------------- le renvoi vers MON numéro
def numero_impose(preferences):
    """Le numéro qui REMPLACE celui de chaque contact, ou "" — aucun renvoi.

    C'est LA fonction que lit le client d'appels réels, à chaque appel. Elle
    rend "" dès que la case n'est pas cochée : aucun renvoi ne peut donc avoir
    lieu par accident.

    ⚠ ELLE NE VALIDE PAS LE NUMÉRO, exprès. Le contrôle a lieu à
    l'enregistrement (voir valider_renvoi) ; ici, un numéro illisible est rendu
    tel quel, et calle_client REFUSE alors l'appel. Se rabattre sur le numéro
    du contact ferait sonner un vrai téléphone au moment précis où l'écran
    promet qu'aucun ne sonnera — c'est le seul dénouement inacceptable.
    """
    if not preferences.obtenir(CLE_IMPOSER_NUMERO):
        return ""
    return (preferences.obtenir(CLE_NUMERO_IMPOSE) or "").strip()


def numero_range(preferences):
    """Le numéro d'essai enregistré, coché ou non ("" s'il n'y en a pas).

    Décocher la case ne l'efface pas : on doit pouvoir arrêter le renvoi, puis
    le reprendre, sans retaper son propre numéro.
    """
    return (preferences.obtenir(CLE_NUMERO_IMPOSE) or "").strip()


def etat_du_renvoi(preferences):
    """Ce que l'écran doit dire du renvoi, en cinq faits.

    {"coche", "numero", "masque", "actif", "incoherent"} :
    - actif      : le renvoi AURA lieu (case cochée, numéro composable) ;
    - incoherent : la case est cochée et le numéro n'est PAS composable. Aucun
      appel réel ne partira, et l'écran doit le dire au lieu de laisser croire
      que tout va bien. On n'y arrive qu'en modifiant le fichier de réglages à
      la main : l'enregistrement, lui, refuse.
    Le numéro est rendu MASQUÉ comme partout ailleurs : le déclarer ne le rend
    pas lisible à l'écran.
    """
    coche = bool(preferences.obtenir(CLE_IMPOSER_NUMERO))
    numero = numero_range(preferences)
    try:
        propre = saisie.valider_telephone_essai(numero) if numero else ""
    except SaisieInvalide:
        propre = ""
    return {"coche": coche, "numero": numero,
            "masque": db.masquer_telephone(propre) if propre else "",
            "actif": bool(coche and propre),
            "incoherent": bool(coche and not propre)}


def valider_renvoi(coche, numero_brut, numero_actuel=""):
    """Contrôle la case et le numéro ; rend (coché ?, numéro). Lève SaisieInvalide.

    Trois règles, et chacune vient d'un dénouement à éviter :
    - un champ VIDE garde le numéro déjà enregistré. Sans cela, décocher puis
      recocher obligerait à retaper son propre numéro — et le champ est
      toujours vide, puisqu'un numéro enregistré n'est jamais réaffiché ;
    - cocher SANS aucun numéro (ni tapé, ni enregistré) est REFUSÉ : RingBack
      ne saurait pas où renvoyer, et appellerait donc les vrais contacts —
      exactement ce que la case promet d'empêcher ;
    - un numéro illisible est refusé même case décochée, pour que la faute de
      frappe se voie tout de suite et non le jour où l'on cochera.
    """
    tape = (numero_brut or "").strip()
    numero = saisie.valider_telephone_essai(tape) if tape else (numero_actuel or "")
    if coche and not numero:
        raise SaisieInvalide(
            "Cochez la case ET donnez un numéro : sans numéro, RingBack ne "
            "saurait pas où renvoyer les appels — il appellerait vos vrais "
            "contacts, ce que cette case promet justement d'empêcher.")
    return bool(coche), numero


def enregistrer_renvoi(preferences, coche, numero_brut):
    """Écrit le réglage du renvoi ; rend (coché ?, numéro). Lève SaisieInvalide.

    Le journal dit ce qui change SANS jamais écrire le numéro en clair : un
    fichier de journal se partage plus facilement qu'on ne le croit.
    """
    coche, numero = valider_renvoi(coche, numero_brut,
                                   numero_range(preferences))
    preferences.definir(CLE_IMPOSER_NUMERO, coche)
    preferences.definir(CLE_NUMERO_IMPOSE, numero)
    journal.info("Renvoi d'essai %s (numéro %s)",
                 "ACTIVÉ — aucun contact ne sera appelé en mode réel"
                 if coche else "désactivé : les contacts seront appelés sur "
                 "leur propre numéro",
                 db.masquer_telephone(numero) if numero else "aucun")
    return coche, numero


def retirer_renvoi(preferences):
    """Efface le numéro d'essai et arrête le renvoi ; rend le numéro retiré."""
    retire = numero_range(preferences)
    preferences.definir(CLE_IMPOSER_NUMERO, False)
    preferences.definir(CLE_NUMERO_IMPOSE, "")
    journal.info("Numéro d'essai retiré (%s) : le renvoi est arrêté",
                 db.masquer_telephone(retire) if retire else "aucun")
    return retire


# ------------------------------------------------------ le numéro déclaré
def valider_numero(brut):
    """Valide le numéro d'essai saisi ; "" (champ vidé) est ACCEPTÉ.

    Un champ vidé doit pouvoir effacer le réglage : sans cela, un numéro
    déclaré une fois ne pourrait plus être retiré depuis la page, et
    l'écran dirait le contraire de ce qu'il fait. Un numéro non vide passe
    par le validateur commun (saisie.valider_telephone) : il est stocké
    exactement comme n'importe quelle autre saisie.
    """
    brut = (brut or "").strip()
    if not brut:
        return ""
    return saisie.valider_telephone_essai(brut)


def est_numero_essai(telephone, preferences):
    """Ce numéro est-il celui d'un testeur déclaré ? (comparaison par chiffres)"""
    return db.est_numero_essai(telephone, numeros_declares(preferences))


def exempte_de_doublon(telephone, numeros_essai):
    """Ce numéro a-t-il le DROIT d'apparaître plusieurs fois dans une liste ?

    Seuls les numéros que l'opérateur a lui-même déclarés dans ⚙ Réglages
    (ses testeurs) en ont le droit. Aucun numéro déclaré : personne n'est
    exempté. `numeros_essai` accepte un numéro seul ou la liste complète.
    """
    return db.est_numero_essai(telephone, numeros_essai)


# ------------------------------------------------------ identités et rôles
def valider_nombre_identites(brut):
    """Le nombre d'identités demandé, borné et expliqué. Lève SaisieInvalide.

    Le plancher n'est pas arbitraire : en dessous du nombre de rôles
    distincts, un rôle ne serait pas éprouvé du tout — l'essai perdrait ce
    qu'il vient chercher.
    """
    texte = (brut or "").strip()
    if not texte:
        return len(IDENTITES)
    if not texte.isdigit():
        raise SaisieInvalide(
            f"Nombre d'identités illisible : « {texte} » — attendu un nombre "
            f"entier entre {IDENTITES_MINIMUM} et {IDENTITES_MAXIMUM}.")
    nombre = int(texte)
    if nombre < IDENTITES_MINIMUM:
        raise SaisieInvalide(
            f"{nombre} identité(s), c'est trop peu : il en faut au moins "
            f"{IDENTITES_MINIMUM}, une par rôle à éprouver, sinon un rôle "
            "ne serait pas joué du tout.")
    if nombre > IDENTITES_MAXIMUM:
        raise SaisieInvalide(
            f"{nombre} identités, c'est plus que ce que RingBack sait nommer "
            f"sans répéter : {IDENTITES_MAXIMUM} au maximum "
            f"({IDENTITES_MAXIMUM} appels, soit environ "
            f"{cout_lisible(IDENTITES_MAXIMUM)}).")
    return nombre


def identites_detaillees(nombre=None):
    """Les identités à créer, tout ce qu'on en sait, dans l'ordre des rôles.

    [{"identite", "role", "court", "dire", "motif"}]. Les rôles reviennent en
    tournant ; au deuxième tour, c'est un autre prénom de MÊME INITIALE qui
    porte le rôle (Alice, puis Adrien…) pour que le moyen mnémonique tienne
    quel que soit le nombre demandé.
    """
    if nombre is None:
        nombre = len(IDENTITES)
    choisies = []
    for rang in range(nombre):
        role = ROLES[rang % len(ROLES)]
        tour = rang // len(ROLES)
        choisies.append({"identite": role["noms"][tour % len(role["noms"])],
                         "role": role["role"], "court": role["court"],
                         "dire": role["dire"], "motif": role["motif"]})
    return choisies


def identites(nombre=None):
    """Les identités à créer : [(nom, rôle, motif)], dans l'ordre des rôles.

    L'écriture d'origine, gardée telle quelle pour tout ce qui n'a besoin
    que de ces trois-là (voir identites_detaillees pour le reste).
    """
    return [(entree["identite"], entree["role"], entree["motif"])
            for entree in identites_detaillees(nombre)]


def repartir(liste_identites, liste_testeurs):
    """Distribue les rôles sur les testeurs, EN TOURNANT.

    Le 1ᵉʳ rôle au 1ᵉʳ testeur, le 2ᵉ au 2ᵉ, et on reboucle. Avec un seul
    testeur, tout lui revient : c'est le comportement d'avant, à l'identique.
    `liste_identites` vient de identites_detaillees (ou de identites : les
    triplets sont acceptés aussi). Rend [{"rang", "identite", "role",
    "court", "dire", "motif", "testeur", "telephone"}].
    """
    if not liste_testeurs:
        return []
    repartition = []
    for rang, entree in enumerate(liste_identites):
        if not isinstance(entree, dict):
            nom, role, motif = entree
            entree = {"identite": nom, "role": role, "court": role,
                      "dire": "", "motif": motif}
        testeur = liste_testeurs[rang % len(liste_testeurs)]
        part = dict(entree)
        part.update({"rang": rang + 1, "testeur": testeur["nom"],
                     "telephone": testeur["telephone"]})
        repartition.append(part)
    return repartition


def prenom(identite):
    """« Mme Alice Dubreuil » → « Alice » : le prénom porte le mnémonique.

    C'est lui qu'on écrit dans les récapitulatifs courts (« Alice (accepte)
    → Paul ») parce que c'est son initiale qui rappelle le rôle.
    """
    morceaux = (identite or "").split()
    if len(morceaux) > 1:
        return morceaux[1]
    return morceaux[0] if morceaux else ""


def cout_lisible(nombre):
    """« 5 appels, soit environ 0,25 $ » — le coût annoncé, jamais deviné."""
    total = f"{nombre * COUT_APPEL_DOLLARS:.2f}".replace(".", ",")
    unite = f"{COUT_APPEL_DOLLARS:.2f}".replace(".", ",")
    return (f"{nombre} appel(s), soit environ {total} $ "
            f"({unite} $ l'appel)")


def resume(preferences=None, nombre=None):
    """De quoi décrire la campagne d'essai AVANT de la créer.

    Sans préférences, on décrit seulement les identités et les rôles (c'est
    ce dont a besoin un écran qui ne sait pas encore qui sont les testeurs).
    Avec, on ajoute les testeurs déclarés et la répartition annoncée.
    """
    choisies = identites_detaillees(nombre)
    info = {"identites": len(choisies), "nature": NATURE,
            "roles": [(entree["identite"], entree["role"])
                      for entree in choisies],
            "details": choisies, "cout": cout_lisible(len(choisies)),
            "testeurs": [], "repartition": []}
    if preferences is not None:
        info["testeurs"] = testeurs(preferences)
        info["repartition"] = repartir(choisies, info["testeurs"])
    return info


# ------------------------------------------------- préparation de l'essai
def _places(base, preferences, maintenant, besoin):
    """Un horaire par identité — de vraies places libres si on les connaît.

    Deux situations, deux réponses honnêtes (même esprit que
    horaires.places_a_proposer) :
    - il y a assez de places réellement libres (ouvert − déjà pris − jours
      fermés) : on les prend, dans l'ordre ;
    - il n'y en a pas assez — soit qu'aucun horaire d'ouverture ne soit
      réglé (RingBack ne connaît alors pas les heures ouvrées et ne les
      invente pas), soit que l'agenda soit plein : les rendez-vous sont
      posés demain matin, d'heure en heure, et l'écran DIT que c'est un
      repli, en nommant les deux causes possibles.
    Rend (liste d'horaires ISO, repli ?).
    """
    libres = horaires.creneaux_libres(base, preferences, tranches=1,
                                      depuis=maintenant, limite=besoin)
    if len(libres) >= besoin:
        return libres[:besoin], False
    depart = (maintenant + datetime.timedelta(days=JOURS_REPLI)).replace(
        hour=HEURE_REPLI, minute=0, second=0, microsecond=0)
    repli = [(depart + datetime.timedelta(hours=rang)).isoformat(
        timespec="minutes") for rang in range(besoin)]
    return repli, True


def preparer(application, maintenant=None, nombre=None):
    """Prépare la campagne d'essai en conditions réelles ; rend un compte rendu.

    Ce qui est fait, dans cet ordre :
    1. les TESTEURS déclarés sont relus — sans eux, rien n'est créé et on le
       DIT (EssaiImpossible) ;
    2. une identité fictive par rôle est créée, marquée « jeu d'essai » —
       donc retirable en bloc depuis ⚙ Réglages, comme le jeu d'essai
       ordinaire, sans jamais toucher aux vraies données. Chaque identité
       porte le numéro du testeur à qui son rôle échoit (répartition en
       tournant, voir repartir) ;
    3. un rendez-vous par identité, sur une place réellement libre ;
    4. une campagne « Confirmation de rendez-vous » est créée à l'état
       PRÊTE, avec ces contacts. AUCUN APPEL N'EST PASSÉ : c'est l'opérateur
       qui démarre, avec ses trois verrous.

    Le brouillon passe par le MÊME chemin que l'assistant en 3 étapes
    (application.creer_brouillon_assistant puis assistant.creer_campagne_prete) :
    la campagne obtenue est en tout point celle qu'aurait produite l'écran.

    Rend {"campagne_id", "clients", "rendezvous", "repli", "repartition",
    "testeurs"}.
    """
    from . import assistant           # import tardif : assistant importe db
    base = application.base
    preferences = application.preferences
    liste_testeurs = testeurs(preferences)
    if not liste_testeurs:
        raise EssaiImpossible(
            "Aucun testeur déclaré : renseignez d'abord « 🧪 Testeurs de "
            "l'essai réel » dans ⚙ Réglages (un nom et un numéro, le vôtre "
            "pour commencer), puis revenez ici. Sans au moins un numéro "
            "déclaré, RingBack refuse — à juste titre — plusieurs contacts "
            "portant le même numéro.")
    valides = []
    for rang, testeur in enumerate(liste_testeurs, start=1):
        try:
            valides.append({"nom": testeur["nom"],
                            "telephone": saisie.valider_telephone(
                                testeur["telephone"])})
        except SaisieInvalide as erreur:
            raise EssaiImpossible(
                f"Le numéro du testeur n°{rang} (« {testeur['nom']} ») est "
                f"illisible ({erreur}) — corrigez-le dans ⚙ Réglages : "
                "retirez ce testeur, puis ajoutez-le à nouveau.") from None
    choisies = identites_detaillees(nombre)
    repartition = repartir(choisies, valides)
    if maintenant is None:
        maintenant = datetime.datetime.now()
    maintenant = maintenant.replace(second=0, microsecond=0)
    horaires_choisis, repli = _places(base, preferences, maintenant,
                                      len(choisies))

    clients, rendezvous = 0, 0
    contacts = []
    for part, horaire in zip(repartition, horaires_choisis):
        client_id, cree = _client_essai(base, part["identite"],
                                        part["telephone"])
        clients += 1 if cree else 0
        rdv_id = base.ajouter_rendezvous(client_id, horaire, part["motif"],
                                         statut="prévu")
        rendezvous += 1
        part["horaire"] = horaire
        contacts.append({"nom": part["identite"], "telephone": part["telephone"],
                         "champs": {"rdv_existant": horaire,
                                    "motif": part["motif"]},
                         "rendezvous_id": rdv_id})

    identifiant = application.creer_brouillon_assistant(NATURE)
    brouillon = application.obtenir_brouillon_assistant(identifiant)
    try:
        brouillon["contacts"] = contacts
        # La liste est écrite ici, pas tirée d'un critère de base : elle
        # n'est donc pas reproductible sur un autre créneau, et la recette
        # le dit (§8.3) plutôt que de laisser croire le contraire.
        assistant.noter_apport_recette(brouillon, "essai_reel")
        brouillon["mission"] = assistant.construire_mission(
            NATURE, brouillon["infos"], preferences, brouillon["options"])
        campagne_id = assistant.creer_campagne_prete(base, brouillon,
                                                     preferences)
    finally:
        application.brouillons_assistant.pop(identifiant, None)
    journal.info("Essai en conditions réelles préparé : campagne n°%d PRÊTE, "
                 "%d contact(s) répartis sur %d testeur(s) — aucun appel passé",
                 campagne_id, len(contacts), len(valides))
    return {"campagne_id": campagne_id, "clients": clients,
            "rendezvous": rendezvous, "repli": repli,
            "repartition": repartition, "testeurs": valides}


def _client_essai(base, nom, telephone):
    """La fiche du contact d'essai (nom, numéro) ; rend (identifiant, créé ?).

    Même prudence que jeu_essai._obtenir_ou_creer_essai : on ne réutilise
    QUE des fiches déjà marquées « jeu d'essai ». Un vrai client homonyme
    ne peut donc jamais être embarqué dans le retrait du jeu d'essai.
    """
    with base.verrou:
        ligne = base.conn.execute(
            "SELECT id FROM clients WHERE nom = ? AND telephone = ? "
            "AND jeu_essai = 1 ORDER BY id LIMIT 1", (nom, telephone)).fetchone()
    if ligne:
        return ligne["id"], False
    return base.ajouter_client(nom, telephone, jeu_essai=True), True
