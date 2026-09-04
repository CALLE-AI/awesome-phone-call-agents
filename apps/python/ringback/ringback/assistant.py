"""Assistant de campagne en 3 étapes — données et moteur (spécification v1.1).

Huit NATURES de campagne (une par fiche de discussion), chacune décrite par :
son icône, sa phrase d'usage, sa politique d'appel par défaut, ses
informations générales (⛔ = obligatoire, le passage à l'étape 3 est refusé
côté serveur tant qu'elle manque), ses champs de contact (les colonnes de la
grille de l'étape 3 — Identité et Téléphone ne sont jamais supprimables) et
son gabarit de mission en segments (un segment conditionnel « si » n'entre
dans le texte que si son information est renseignée).

Le module porte aussi :
- la construction de la mission (mêmes règles que l'aperçu vivant à l'écran :
  les variables d'étape 2 sont substituées, les variables PAR CONTACT
  ([identite], [rdv_existant]…) restent et sont remplies à chaque appel) ;
- l'analyse du collage multi-colonnes (réutilise les validateurs de saisie.py) ;
- la période interdite (ex. 20 h → 8 h) et l'échéance de relance par délai
  OU par créneau de rappel ;
- le moteur d'exécution d'une campagne « prête » : un appel à la fois, la
  pause et l'arrêt agissent ENTRE deux appels, tout passe par le moteur de
  SIMULATION déterministe existant (calle_client) et par les mêmes verrous
  (planificateur.verifier_garde_fous — jamais dupliqués) ;
- le CAHIER DE CHANGEMENTS (§8.1 de CAS_DE_FIGURE_CAMPAGNES.md) : le vrai
  livrable d'une campagne n'est pas « des appels passés », c'est la liste
  des changements à REPORTER dans le logiciel de planification de
  l'établissement — ➕ ajouté, ➖ supprimé, ↔ déplacé, 🙋 à traiter par un
  humain. Chaque ligne est écrite AU MOMENT du changement (noter_changement),
  jamais reconstituée après coup, et ressort lisible, copiable et exportable ;
- le DÉCALAGE EN CASCADE (§8.3) : quand un contact accepte de décaler son
  rendez-vous, la campagne s'achève et la place qu'il LIBÈRE devient le
  créneau d'une NOUVELLE campagne, préparée à l'état « prête » — jamais
  lancée. Elle rejoue la RECETTE de la campagne d'origine (nature, message,
  options, ordre, source de contacts, champs) : seul le créneau change, et
  la liste est recalculée pour ce créneau. Les contacts dont le rendez-vous
  est ANTÉRIEUR au nouveau créneau sont écartés — c'est ce resserrement qui
  fait converger la chaîne (voir CASCADE_PROFONDEUR_MAX).

Rien ici n'est mimé : chaque affichage de l'interface vient de la base ou du
brouillon réel ; ce qui n'est pas construit est marqué « à venir » à l'écran.
"""

import csv
import datetime
import io
import json
import logging
import re
import unicodedata

from . import (calle_client, campagnes, consigne, db, generation, horaires,
               langue as mod_langue,
               planificateur, saisie, themes)
from .saisie import SaisieInvalide

journal = logging.getLogger("ringback.assistant")

# ------------------------------------------------------- clés de réglage
CLE_INTERDIT_DEBUT = "interdit_debut"            # « HH:MM » — période interdite
CLE_INTERDIT_FIN = "interdit_fin"                # (vide = aucune)
CLE_RELANCE_MODE = "relance_mode"                # « delai » | « creneau »
CLE_RELANCE_CRENEAU_DEBUT = "relance_creneau_debut"  # « HH:MM »
CLE_RELANCE_CRENEAU_FIN = "relance_creneau_fin"

# ---------------------------------------------------------------------------
# LES DEUX MODES DE SAISIE — « simplifié » et « avancé »
# ---------------------------------------------------------------------------
# Demande du propriétaire (02/08/2026) : les formulaires de campagne montrent
# trop de choses d'un coup. Le mode SIMPLIFIÉ ne laisse voir que ce qu'il faut
# remplir ; le mode AVANCÉ ajoute ce qui a un réglage par défaut convenable et
# qu'on ne touche qu'exceptionnellement (l'aperçu du message, les colonnes
# attendues, le discours de l'agent propre à cette campagne).
#
# ⚠ LE MODE NE CHANGE QUE CE QU'ON VOIT, jamais ce qui est envoyé : les champs
# du mode avancé restent dans la page et partent avec le formulaire, avec leur
# valeur venue des Réglages. Basculer d'un mode à l'autre ne peut donc RIEN
# perdre — c'est la condition pour qu'un mode réduit soit sans danger.
MODE_SIMPLIFIE = "simplifie"
MODE_AVANCE = "avance"
MODES_FORMULAIRE = {MODE_SIMPLIFIE: "Simplifié", MODE_AVANCE: "Avancé"}


def mode_formulaire(preferences=None):
    """TOUJOURS « simplifié » à l'ouverture d'un formulaire de campagne.

    Le choix était retenu d'une campagne à l'autre. Le propriétaire a tranché
    le 02/08/2026 : « toujours sélectionner par défaut les formulaires
    simplifiés pour les campagnes ». Un écran qui s'ouvre en avancé parce
    qu'on y était passé la veille surprend plus qu'il ne sert.

    La bascule reste entière DANS la page : passer en avancé y montre tout,
    et rien n'est perdu — les champs du mode avancé sont dans le formulaire
    quel que soit le mode. Le paramètre `preferences` est gardé pour ne pas
    faire changer tous les appelants d'un réglage qui pourrait revenir.
    """
    return MODE_SIMPLIFIE

# --------------------------------------------------------------- natures
# L'ordre du dictionnaire est l'ordre des huit cartes de l'étape 1.
# infos : (code, libellé, type, obligatoire ⛔) — type « texte », « date »,
# « long » (zone multiligne) ou « oui_non ».
# champs : (code, libellé, type, obligatoire ⛔, verrouillé) — verrouillé =
# jamais supprimable (Identité et Téléphone, la règle du propriétaire).
# gabarit : liste de segments ; un segment est un texte, ou un dictionnaire
# {"texte": …, "si": code} inclus seulement si l'information est renseignée.
#
# LA CONSIGNE EN TROIS PARTIES (décision du propriétaire, 01/08/2026) — ce
# que le gabarit produit est la PRÉSENTATION, le seul passage dit mot pour
# mot. Deux clés de plus l'accompagnent jusqu'à l'agent :
# objectif : ce qu'on cherche à obtenir, en une phrase de français ;
# issues   : les trois seules conclusions possibles (oui / non / autre) et
#            leur traduction dans le code que le schéma de résultat impose.
#            « autre » porte toujours la nuance en clair dans « notes ».
# genre    : « cascade » quand l'appel part avec le schéma de cascade
#            (outcome : accepted/refused/moved), « classique » sinon
#            (appointment_status : confirmed/rescheduled/canceled/
#            to_reschedule). La correspondance complète, nature par nature,
#            est écrite dans FICHES_DISCUSSION.md.

_CHAMPS_SOCLE = (
    {"code": "identite", "libelle": "Identité (civilité + nom)",
     "type": "texte", "obligatoire": True, "verrouille": True},
    {"code": "telephone", "libelle": "Téléphone",
     "type": "texte", "obligatoire": True, "verrouille": True},
)


def _champ(code, libelle, type_champ="texte", obligatoire=False):
    return {"code": code, "libelle": libelle, "type": type_champ,
            "obligatoire": obligatoire, "verrouille": False}


def _info(code, libelle, type_info="texte", obligatoire=False, reglage=None,
          sous_option=None, multiple=False):
    """reglage : clé de préférences dont la valeur pré-remplit le champ.

    sous_option : code d'une OPTION de comportement dont cette information
    est le détail. Elle n'est alors pas affichée avec les autres
    informations générales : elle apparaît SOUS sa case à cocher, et
    seulement quand la case est cochée (dévoilement en cascade — on ne
    montre jamais les réglages d'une option qu'on n'a pas prise).

    multiple : l'information peut être saisie PLUSIEURS fois (une liste de
    créneaux, 03/08/2026). Le champ garde son type et son nom — c'est le
    MÊME « info_<code> » qui part, simplement répété. Le brouillon garde la
    liste entière dans « creneaux » et sa PREMIÈRE valeur dans « infos », si
    bien que tout ce qui lisait une valeur unique continue de la lire.
    """
    return {"code": code, "libelle": libelle, "type": type_info,
            "obligatoire": obligatoire, "reglage": reglage,
            "sous_option": sous_option, "multiple": multiple}


# ------------------------------------------- l'annulation pendant l'appel
# LA RÈGLE DU PROPRIÉTAIRE, mot pour mot (31/07/2026) : « si un rendez-vous
# est annulé, soit il est directement replacé lors de l'échange, auquel cas
# c'est simplement un déplacement ; soit on ne fixe pas encore de rendez-vous
# et on crée un statut "c'est le client qui nous rappelle". Il faudra
# préciser tout cela dans le prompt pour savoir quand est-ce que le bot peut
# proposer des rendez-vous en cas d'annulation. »
#
# D'où UNE option de campagne, et elle seule, qui décide de ce que l'agent a
# le droit de faire — et qui CHANGE LE TEXTE dicté à l'agent :
#   - cochée : il propose les places RÉELLEMENT libres (recalculées à
#     l'instant de l'appel, jamais une date de formule). Le client en prend
#     une → c'est un DÉPLACEMENT (issue « rescheduled », cahier ↔). Il n'en
#     prend aucune → « le client rappellera » ;
#   - décochée : il ne propose rien et conclut « c'est vous qui nous
#     rappelez quand vous voulez » → « le client rappellera ».
# Dans les deux cas, l'état « le client rappellera » ne déclenche NI relance
# NI campagne : c'est le client qui reprend contact.
CLE_REPLACER_ANNULATION = "replacer_annulation"
INFO_CRENEAUX_ANNULATION = "creneaux_annulation"

# Le code d'une option ↔ l'identifiant de sa case à cocher dans l'étape 2.
# L'aperçu vivant s'en sert pour relire la case sans recharger la page :
# ce que l'écran montre est donc exactement ce que le serveur construira.
CASES_OPTIONS = {CLE_REPLACER_ANNULATION: "opt_replacer"}

# Le contact d'une campagne qui a annulé sans replacer : sa place dans la
# table des états (assistant.ETATS) et dans celle des clients.
ETAT_RAPPELLERA = "le client rappellera"

# L'ÉTAT QUI MANQUAIT, et qui a coûté un appel réel le 01/08/2026 : son
# téléphone a sonné, il a décroché, il a accepté le nouveau créneau — et
# RingBack l'a écrit « injoignable » parce que la réponse de CALL-E n'était
# pas revenue à temps. Ce n'est ni « injoignable » (son téléphone A sonné),
# ni « à recontacter » (le rappeler ferait sonner deux fois pour rien) : la
# vérité est que l'appel a EU LIEU et que son résultat n'est pas connu.
# Le contact garde l'identifiant CALL-E de son appel ; le geste
# « 📥 Récupérer les résultats en attente » va le lire et l'appliquer.
ETAT_RESULTAT_INCONNU = "appelé, résultat inconnu"

# ⚠ L'OUVERTURE NE RÉCITE PLUS LES DATES (31/08/2026, sa demande, relevée sur
# un VRAI appel) : « avant même que je confirme ou non ma présence, il m'a tout
# de suite listé les différentes dates pour décaler le rendez-vous. Il faut
# d'abord attendre que le client dise non avant de proposer une date. »
#
# CE QUE ÇA DONNAIT, mot pour mot, dans sa transcription du 31/08 : six dates
# lues d'affilée AVANT la question « puis-je compter sur votre présence ? ».
# La personne n'avait encore rien dit. Elle a fini par répondre « aucun » — à
# une question qu'on ne lui avait pas posée.
#
# Les places restent DANS « ce que tu sais » (voir _INFO_CRENEAUX_ANNULATION) :
# l'agent les connaît, et la conduite ci-dessous lui dit QUAND les sortir.
# Ce qu'on dit quand aucune autre date ne sera proposée — deux cas, un texte :
# la case décochée, ou l'agenda sans une place libre. Le client entend la même
# chose, et c'est juste : de son côté, la différence n'existe pas.
SANS_AUTRE_DATE = (" Si vous ne pouvez plus venir, j'annule votre "
                   "rendez-vous, et je ne vous propose pas d'autre date "
                   "aujourd'hui : c'est vous qui nous rappelez quand vous "
                   "voulez — nous ne vous relancerons pas.")

# ⚠ L'ENTONNOIR — SA MÉTHODE, ET ELLE N'ÉTAIT ÉCRITE QU'À UN SEUL ENDROIT.
# Sa demande du 16/08, reprise le 31/08 : « qu'il propose d'abord des jours,
# puis matin ou après-midi, puis qu'il propose une heure. En fonction des
# réponses, soit le patient accepte, soit il demande de préciser les jours et
# LE FILTRE REPREND. »
#
# Le déplacement l'avait depuis le 16/08 ; la confirmation et le rappel de
# rendez-vous, non — ils citaient une liste et attendaient. Or les trois font
# la même chose : proposer une date à quelqu'un qui n'en veut pas encore.
#
# ⚠ LA REPRISE MANQUAIT AUX TROIS. La conduite disait quoi faire quand l'agent
# n'a AUCUNE heure qui corresponde ; elle ne disait rien du cas le plus
# fréquent — la personne refuse l'heure proposée. L'agent enchaînait alors les
# heures d'affilée, ce qui est exactement l'énumération qu'on cherche à éviter.
#
# ⚠ ÉCRIT ICI, ET PAS TROIS FOIS. Une méthode recopiée dans trois natures
# diverge à la première retouche : on l'a mesuré assez souvent dans ce projet
# pour ne plus recommencer.
_ENTONNOIR = (
    # ⚠ LA DEMANDE DE LISTE EST LE CAS LE PLUS COURANT, et il manquait
    # (04/09/2026). Son essai réel : « Avez-vous d'autres rendez-vous ? » —
    # ce n'est PAS un refus, donc l'entonnoir ne se déclenchait pas. L'agent a
    # appliqué la règle voisine (« redire ce que tu sais n'est jamais une
    # raison de passer la main ») et a récité les dix créneaux, alors que le
    # champ qui les porte s'appelle « stock, NON RÉCITÉ ». Deux instructions se
    # contredisaient ; il a tranché, et il n'avait pas tort.
    "si elle demande ce que tu as d'autre — « avez-vous d'autres dates ? », "
    "« qu'est-ce qui reste ? » — NE RÉCITE PAS la liste : réponds « oui, j'ai "
    "d'autres disponibilités » et enchaîne tout de suite sur la question "
    "suivante. Une liste récitée n'aide personne à choisir ;",
    "si elle ne convient pas, demande quels JOURS de la semaine "
    "l'arrangeraient ;",
    "demande ensuite si elle préfère le MATIN ou l'APRÈS-MIDI ;",
    "propose alors UNE SEULE heure, prise dans les créneaux disponibles "
    "ci-dessus, qui corresponde à ce jour et à ce moment de la journée ; si "
    "tu n'en as aucune qui corresponde, dis-le simplement ;",
    "⚠ à chaque refus, REPRENDS LE FILTRE au lieu d'enchaîner les heures : "
    "redemande quels jours l'arrangeraient, puis matin ou après-midi, puis "
    "propose une heure. Une heure à la fois, jamais une liste — c'est la "
    "personne qui restreint, pas toi qui énumères ;",
)


_SEGMENTS_ANNULATION = (
    # ⚠ ON NE PROMET UNE AUTRE DATE QUE SI L'ON EN A UNE. La case cochée ne
    # suffit pas : encore faut-il que des places soient réellement libres.
    # Sans ce second garde-fou, l'agent annonçait « je peux vous proposer une
    # autre date » devant un agenda plein.
    {"texte": " Si vous ne pouvez plus venir, je peux vous proposer une autre "
              "date ; sinon j'annule votre rendez-vous et c'est vous qui nous "
              "rappelez quand vous voulez — nous ne vous relancerons pas.",
     "si_option": CLE_REPLACER_ANNULATION, "si": INFO_CRENEAUX_ANNULATION},
    {"texte": SANS_AUTRE_DATE,
     "si_option": CLE_REPLACER_ANNULATION, "sauf": INFO_CRENEAUX_ANNULATION},
    {"texte": SANS_AUTRE_DATE, "sauf_option": CLE_REPLACER_ANNULATION},
)

# ---------------------------------------------------------------------------
# CHAQUE OUVERTURE SE TERMINE SUR UNE QUESTION
# ---------------------------------------------------------------------------
# Demande du propriétaire (02/08/2026) : « possibilité de répondre, mais
# orienté vers l'obtention de réponse ». Un texte qui finit sur une
# explication laisse un silence ; un texte qui finit sur une question appelle
# une réponse — et c'est une réponse qu'il faut, puisque l'agent doit
# conclure sur l'une des trois issues.
#
# La question est le DERNIER segment, après les phrases conditionnelles :
# quelles que soient les options, elle est ce qu'on entend en dernier.

_INFO_CRENEAUX_ANNULATION = _info(
    INFO_CRENEAUX_ANNULATION,
    "Places libres à proposer en cas d'annulation (calculées ; vide = "
    "l'agent n'annonce aucune date)",
    "long", reglage="creneaux_lisibles",
    sous_option=CLE_REPLACER_ANNULATION)


NATURES = {
    "creneau_libere": {
        "icone": "📞", "nom": "Créneau libéré",
        "phrase": "« Une place s'est libérée, je remplis le trou »",
        "politique": "premier_oui",
        "politique_libelle": "séquentiel, arrêt au premier OUI",
        "politique_modifiable": True,
        # ⚠ LE RENDEZ-VOUS LE PLUS LOINTAIN D'ABORD (décision du propriétaire
        # du 03/08/2026, qui REMPLACE la règle inverse d'avant). La raison :
        # c'est lui qui a le plus à gagner à avancer sur la place qui se
        # libère. Celui dont le rendez-vous est déjà proche n'y gagnerait
        # presque rien — l'appeler d'abord, c'est dépenser un appel pour un
        # petit gain, et prendre la place à quelqu'un qu'elle soulagerait.
        "ordre_defaut": "eloignement",
        # La seule nature qui parte avec le schéma de CASCADE : elle propose
        # une place qui vient de se libérer, et la campagne s'arrête au
        # premier oui (voir en_cascade dans _appeler_contact).
        "genre": consigne.GENRE_CASCADE,
        "objectif": ("savoir si la personne prend la place qui vient de se "
                     "libérer, à la place de son rendez-vous actuel"),
        "issues": {
            "oui": consigne.issue(
                "accepted", "la personne prend la place qui s'est libérée"),
            "non": consigne.issue(
                "refused", "elle décline la proposition et son rendez-vous "
                           "actuel reste inchangé"),
            # ⚠ PLUS DE « RAPPELÉE PAR UN HUMAIN » ICI (11/08/2026, décision du
            # propriétaire) : sur un créneau libéré, la place part à quelqu'un
            # d'autre dans la minute — promettre un rappel serait promettre un
            # appel qui n'aurait plus d'objet. Voir NATURES_RAPPEL_HUMAIN.
            "autre": consigne.issue(
                "moved", "tout le reste : elle souhaite une autre date, elle "
                         "ne peut pas se décider maintenant, ou elle pose "
                         "une question à laquelle tu n'as pas la réponse",
                # LE REPLI SANS DATE, qui manquait à cette nature — et à elle
                # seule. Sans lui, l'agent rendait « moved » sans date et
                # RingBack déclarait la réponse illisible (02/08/2026).
                code_sans_date="to_reschedule", date="facultative"),
        },
        "infos": (
            _info("entreprise", "Nom de l'entreprise", obligatoire=True,
                  reglage=themes.CLE_ENTREPRISE),
            _info("creneau_libere", "Créneau libéré (date et heure)",
                  "date", obligatoire=True, multiple=True),
            _info("lieu", "Lieu (si plusieurs)"),
            _info("duree", "Durée de la prestation"),
            _info("consignes", "Consignes (ex. « venir à jeun »)"),
        ),
        "champs": (
            _champ("rdv_existant", "Rendez-vous existant (date + heure)",
                   "date", obligatoire=True),
            _champ("motif", "Motif", obligatoire=True),
        ),
        "gabarit": (
            "Bonjour [identite], je suis l'assistant de [entreprise]. "
            "Une place s'est libérée le [creneau_libere] pour votre [motif].",
            {"texte": " La séance dure [duree].", "si": "duree"},
            {"texte": " Cela se passe à [lieu].", "si": "lieu"},
            {"texte": " À noter : [consignes].", "si": "consignes"},
            " Souhaitez-vous en profiter pour avancer votre rendez-vous "
            "du [rdv_existant] ?",
        ),
    },
    "rappel_rdv": {
        "icone": "🔔", "nom": "Rappel de rendez-vous",
        "phrase": "« Je rappelle leurs rendez-vous de demain »",
        "politique": "tous",
        "politique_libelle": "tout le monde est appelé",
        "politique_modifiable": False,
        # On rappelle d'abord ceux dont le rendez-vous est le plus proche :
        # ce sont les seuls qu'il est encore utile de prévenir.
        "ordre_defaut": "proximite",
        "genre": consigne.GENRE_CLASSIQUE,
        "objectif": ("t'assurer que la personne a bien son rendez-vous en "
                     "tête, et savoir si elle le maintient"),
        # ⚠ NE CITE AUCUNE DATE AVANT D'AVOIR LA RÉPONSE (31/08/2026, sa
        # demande, relevée sur un VRAI appel) : « avant même que je confirme
        # ou non ma présence, il m'a tout de suite listé les différentes dates
        # […] Il faut d'abord attendre que le client dise non avant de
        # proposer une date. »
        #
        # L'ouverture ne les récite plus (voir _SEGMENTS_ANNULATION) ; l'agent
        # les connaît toujours, elles sont dans « ce que tu sais ». Cette
        # conduite lui dit QUAND les sortir — et par petits paquets : sa
        # transcription du 31/08 en alignait six d'affilée, et la personne a
        # répondu « aucun ».
        "conduite": (
            "pose D'ABORD ta question et attends la réponse : sera-t-elle "
            "présente, oui ou non ? Ne cite AUCUNE date tant qu'elle n'a pas "
            "répondu ;",
            "si elle confirme sa présence, remercie et conclus : il n'y a "
            "rien d'autre à obtenir, et proposer une autre date sèmerait le "
            "doute ;",
            "si elle ne peut pas venir ET que « ce que tu sais » porte des "
            "places libres, propose-lui UNE date pour commencer — la plus "
            "proche, pas la liste ;",
        ) + _ENTONNOIR + (
            "si rien ne lui convient, ou si tu n'as aucune place à proposer, "
            "dis-lui simplement que son rendez-vous est annulé et que c'est "
            "elle qui rappellera quand elle voudra.",
        ),
        "issues": {
            "oui": consigne.issue(
                "confirmed", "elle maintient son rendez-vous et sera présente"),
            "non": consigne.issue(
                "canceled", "elle annule son rendez-vous et n'en fixe pas "
                            "d'autre pendant l'appel"),
            # Pas de « rappelée par un humain » : voir NATURES_RAPPEL_HUMAIN.
            # Ici le rendez-vous est LE SIEN — elle peut nous rappeler elle-même,
            # et c'est ce que dit l'état « le client rappellera ».
            "autre": consigne.issue(
                "rescheduled",
                "tout le reste : elle veut déplacer son rendez-vous, elle "
                "préfère rappeler elle-même, ou elle pose une question à "
                "laquelle tu n'as pas la réponse",
                code_sans_date="to_reschedule", date="facultative"),
        },
        "infos": (
            _info("entreprise", "Nom de l'entreprise", obligatoire=True,
                  reglage=themes.CLE_ENTREPRISE),
            _info("lieu", "Lieu (si plusieurs)"),
            _info("consignes", "Consigne générale (ex. « venir à jeun »)"),
            _info("proposer_annulation",
                  "Demander en fin d'appel si le rendez-vous doit être annulé",
                  "oui_non"),
            _INFO_CRENEAUX_ANNULATION,
        ),
        "champs": (
            _champ("rdv_existant", "Rendez-vous (date + heure)",
                   "date", obligatoire=True),
            _champ("motif", "Motif", obligatoire=True),
            _champ("consigne", "Consigne propre au contact"),
        ),
        "gabarit": (
            "Bonjour [identite], je suis l'assistant de [entreprise]. "
            "Je vous appelle pour vous rappeler votre rendez-vous "
            "du [rdv_existant] pour [motif].",
            {"texte": " Cela se passe à [lieu].", "si": "lieu"},
            {"texte": " Pensez-y : [consignes].", "si": "consignes"},
            " Pensez à : [consigne].",
            {"texte": " Pour finir : souhaitez-vous maintenir ce rendez-vous, "
                      "ou faut-il l'annuler ? Si vous l'annulez, je libère la "
                      "place pour quelqu'un d'autre.",
             "si": "proposer_annulation"},
        ) + _SEGMENTS_ANNULATION + (
            " Alors, puis-je noter que vous serez bien là ?",
        ),
    },
    "confirmation": {
        "icone": "✅", "nom": "Confirmation de rendez-vous",
        "phrase": "« J'exige une réponse ferme »",
        "politique": "tous",
        "politique_libelle": "tout le monde ; non-réponse → relance",
        "politique_modifiable": False,
        # ⚠ L'ORDRE DE LA LISTE, POSÉ D'OFFICE (20/08/2026, sa demande — la
        # même que pour le déplacement le 16/08). L'écran affichait
        # « — à choisir — », et un ordre non choisi est un champ obligatoire de
        # plus à chaque campagne. Ici il va de soi : on confirme les
        # rendez-vous d'une journée ou d'une plage qu'on vient de désigner, ils
        # sont donc DÉJÀ dans l'ordre où on veut les traiter. Les deux autres
        # ordres restent offerts — c'est un défaut, pas une contrainte.
        "ordre_defaut": "liste",
        "genre": consigne.GENRE_CLASSIQUE,
        "objectif": ("obtenir une réponse FERME : la personne sera-t-elle "
                     "présente à son rendez-vous, oui ou non"),
        # ⚠ NE CITE AUCUNE DATE AVANT D'AVOIR LA RÉPONSE (31/08/2026, sa
        # demande, relevée sur un VRAI appel) : « avant même que je confirme
        # ou non ma présence, il m'a tout de suite listé les différentes dates
        # […] Il faut d'abord attendre que le client dise non avant de
        # proposer une date. »
        #
        # L'ouverture ne les récite plus (voir _SEGMENTS_ANNULATION) ; l'agent
        # les connaît toujours, elles sont dans « ce que tu sais ». Cette
        # conduite lui dit QUAND les sortir — et par petits paquets : sa
        # transcription du 31/08 en alignait six d'affilée, et la personne a
        # répondu « aucun ».
        "conduite": (
            "pose D'ABORD ta question et attends la réponse : sera-t-elle "
            "présente, oui ou non ? Ne cite AUCUNE date tant qu'elle n'a pas "
            "répondu ;",
            "si elle confirme sa présence, remercie et conclus : il n'y a "
            "rien d'autre à obtenir, et proposer une autre date sèmerait le "
            "doute ;",
            "si elle ne peut pas venir ET que « ce que tu sais » porte des "
            "places libres, propose-lui UNE date pour commencer — la plus "
            "proche, pas la liste ;",
        ) + _ENTONNOIR + (
            "si rien ne lui convient, ou si tu n'as aucune place à proposer, "
            "dis-lui simplement que son rendez-vous est annulé et que c'est "
            "elle qui rappellera quand elle voudra.",
        ),
        "issues": {
            "oui": consigne.issue(
                "confirmed", "elle confirme fermement qu'elle sera présente"),
            "non": consigne.issue(
                "canceled", "elle annule son rendez-vous et n'en fixe pas "
                            "d'autre pendant l'appel"),
            # Pas de « rappelée par un humain » : voir NATURES_RAPPEL_HUMAIN.
            "autre": consigne.issue(
                "rescheduled",
                "tout le reste : elle veut déplacer son rendez-vous, elle "
                "hésite sans pouvoir se décider, elle préfère rappeler "
                "elle-même, ou elle pose une question à laquelle tu n'as pas "
                "la réponse",
                code_sans_date="to_reschedule", date="facultative"),
        },
        "infos": (
            _info("entreprise", "Nom de l'entreprise", obligatoire=True,
                  reglage=themes.CLE_ENTREPRISE),
            _info("lieu", "Lieu (si plusieurs)"),
            _info("consignes", "Consignes"),
            _INFO_CRENEAUX_ANNULATION,
        ),
        "champs": (
            _champ("rdv_existant", "Rendez-vous (date + heure)",
                   "date", obligatoire=True),
            _champ("motif", "Motif", obligatoire=True),
        ),
        "gabarit": (
            "Bonjour [identite], je suis l'assistant de [entreprise]. "
            "Je vous appelle au sujet de votre rendez-vous du [rdv_existant] "
            "pour [motif] : merci de me confirmer votre présence.",
            {"texte": " Cela se passe à [lieu].", "si": "lieu"},
            {"texte": " À noter : [consignes].", "si": "consignes"},
        ) + _SEGMENTS_ANNULATION + (
            " Puis-je compter sur votre présence, oui ou non ?",
        ),
    },
    "deplacement": {
        "icone": "📆", "nom": "Déplacement de rendez-vous",
        "phrase": "« Je dois déplacer des rendez-vous »",
        # ⚠ TOUT LE MONDE EST APPELÉ, ET UN OUI N'ARRÊTE RIEN (16/08/2026).
        # C'était « arrêt au premier oui », d'après une §8.2 que j'avais
        # écrite moi-même et marquée « ma proposition, à confirmer » — jamais
        # confirmée, et fausse. Sa phrase la renverse en une ligne : « on
        # sélectionne une après-midi et l'on dit : pour cette après-midi, on
        # déplace les rendez-vous. C'est évident que l'on ne doit pas seulement
        # déplacer la première personne qui accepte, mais TOUS les rendez-vous
        # que nous avions sélectionnés. »
        #
        # D'OÙ VENAIT L'ERREUR : la confusion avec « créneau libéré ». Là, il y
        # a UN trou à combler — le premier oui suffit, déranger les suivants
        # n'apporte rien. Ici, il y a N rendez-vous à SORTIR d'une plage :
        # chaque personne non appelée est un rendez-vous qui reste en place.
        # Deux natures voisines, deux besoins opposés.
        #
        # CE QUE CELA A COÛTÉ : sa campagne s'arrêtait au premier contact —
        # 1 accepté, 2 « pas appelé », constaté à l'écran.
        #
        # L'arrêt au premier oui reste OFFERT (politique_modifiable) : il sert
        # au cas rare où une seule personne suffit.
        "politique": "tous",
        "politique_libelle": "tout le monde est appelé ; rien n'est supprimé "
                             "avant accord",
        "politique_modifiable": True,
        # ⚠ L'ORDRE DE LA LISTE, POSÉ D'OFFICE (16/08/2026, sa demande).
        # L'écran affichait « — à choisir — », et un ordre non choisi est un
        # champ obligatoire de plus à chaque campagne. Ici il va de soi : les
        # rendez-vous à déplacer viennent d'une journée ou d'une plage qu'on a
        # désignée, ils sont donc DÉJÀ dans l'ordre où on veut les traiter.
        # Les deux autres ordres restent offerts — c'est un défaut, pas une
        # contrainte.
        "ordre_defaut": "liste",
        "genre": consigne.GENRE_CLASSIQUE,
        "objectif": ("faire accepter à la personne l'un des créneaux de "
                     "remplacement, parce que son rendez-vous actuel ne peut "
                     "pas être tenu"),
        # ⚠ « oui » vaut ici « confirmed » AVEC la date choisie : c'est ce
        # couple-là que _appliquer_resultat traduit en DÉPLACEMENT réel du
        # rendez-vous (voir _deplacer_le_rendezvous). Sans date, rien ne
        # pourrait être écrit.
        "issues": {
            "oui": consigne.issue(
                "confirmed", "elle accepte l'un des créneaux de remplacement "
                             "que tu proposes",
                date="obligatoire"),
            "non": consigne.issue(
                "canceled", "aucun créneau ne lui convient et elle préfère "
                            "annuler son rendez-vous"),
            "autre": consigne.issue(
                "rescheduled",
                "tout le reste : elle propose un autre moment que ceux que tu "
                "annonces, elle ne peut rien fixer aujourd'hui, ou elle "
                "demande à être rappelée par un humain",
                code_sans_date="to_reschedule", date="facultative"),
        },
        "infos": (
            _info("entreprise", "Nom de l'entreprise", obligatoire=True,
                  reglage=themes.CLE_ENTREPRISE),
            _info("raison", "Raison simple et honnête "
                            "(ex. « un imprévu dans notre planning »)"),
            # ⚠ DEUX CHAMPS LÀ OÙ IL Y EN AVAIT UN (16/08/2026, sa demande).
            # Le message d'ouverture nommait TOUTE la liste — « j'ai plusieurs
            # créneaux : le 17/08 à 09h00, le 17/08 à 09h20, … ». Personne
            # n'écoute une énumération au téléphone, et les six places se
            # suivaient de toute façon : un « non » les balayait toutes.
            # Désormais l'ouverture nomme UNE date, la plus proche ; la liste
            # devient le STOCK dans lequel l'agent puise pour négocier — elle
            # reste dans « ce que tu sais », jamais récitée.
            _info("creneau_le_plus_proche", "Créneau proposé en premier "
                                            "(le plus proche)",
                  reglage="creneau_le_plus_proche"),
            _info("creneaux_remplacement",
                  "Créneaux disponibles pour négocier (stock, non récité)",
                  "long", obligatoire=True, reglage="creneaux_lisibles"),
        ),
        "champs": (
            _champ("rdv_existant", "Rendez-vous actuel (date + heure)",
                   "date", obligatoire=True),
            _champ("motif", "Motif", obligatoire=True),
        ),
        # ⚠ LA CONDUITE DE L'ÉCHANGE, EN CINQ TEMPS — sa demande, mot pour mot :
        # « L'agent pourra alors commencer par proposer la date la plus proche ;
        # si refus : quels jours de la semaine arrange l'interlocuteur ; il
        # demande ensuite si la personne préfère matin ou après-midi ; il
        # propose alors un créneau qui correspond jours + heure correspondant
        # aux attentes, s'il n'en a pas il demande si un autre jour irait ; au
        # bout de 3 refus, on annonce poliment que puisqu'on n'arrive pas à
        # organiser un rendez-vous, une personne de [société] va la rappeler. »
        #
        # C'est une conduite, pas une contrainte : elle dit COMMENT mener, là
        # où les contraintes disent ce qu'on ne fait jamais. D'où son bloc à
        # elle dans la consigne (voir consigne.Consigne.texte_contexte).
        "conduite": (
            "commence par proposer LA date la plus proche, celle qui est "
            "écrite en « créneau proposé en premier » — une seule date, pas "
            "la liste ;",
        ) + _ENTONNOIR + (
            # ⚠ TROIS, ET ON S'ARRÊTE. Sans cette borne, l'agent enchaîne les
            # propositions jusqu'à l'agacement : « n'insiste jamais » est déjà
            # une contrainte du produit, celle-ci lui donne un compte précis.
            "au bout de TROIS propositions refusées, n'insiste plus : "
            "« Je ne veux pas vous retenir plus longtemps. Puisque nous "
            "n'arrivons pas à trouver un moment qui vous convienne, une "
            "personne de [entreprise] va vous rappeler pour convenir d'une "
            "date avec vous. Merci de votre patience, et bonne journée. » ; "
            "conclus alors sur AUTRE, sans date.",
        ),
        "gabarit": (
            "Bonjour [identite], je suis l'assistant de [entreprise].",
            {"texte": " En raison de [raison], nous", "si": "raison"},
            {"texte": " Nous", "sauf": "raison"},
            " devons déplacer votre rendez-vous du [rdv_existant] pour "
            "[motif].",
            # ⚠ PAS D'ARTICLE DEVANT LA DATE. `horaires._en_toutes_lettres`
            # rend déjà « le mardi 25 août 2026 à 9 heures » : écrire
            # « proposer le [créneau] » donnerait « proposer le le mardi… ».
            # Constaté en lisant la consigne réellement produite — pas en
            # relisant le gabarit. (C'était `themes.date_lisible` avant le
            # 24/08/2026 ; l'article, lui, n'a pas bougé.)
            {"texte": " Je peux vous proposer [creneau_le_plus_proche] — "
                      "est-ce que cela vous conviendrait ?",
             "si": "creneau_le_plus_proche"},
            {"texte": " Quels moments vous conviendraient ?",
             "sauf": "creneau_le_plus_proche"},
        ),
    },
    "prise_rdv": {
        "icone": "🗓", "nom": "Prise de rendez-vous",
        "phrase": "« On m'a demandé un rendez-vous, je le fixe »",
        "politique": "tous",
        "politique_libelle": "tout le monde ; pas joint → relance, "
                             "origine conservée",
        "politique_modifiable": False,
        "genre": consigne.GENRE_CLASSIQUE,
        "objectif": ("fixer un rendez-vous avec la personne, parmi les "
                     "créneaux dont tu disposes"),
        "issues": {
            "oui": consigne.issue(
                "confirmed", "un rendez-vous est fixé",
                date="obligatoire"),
            "non": consigne.issue(
                "canceled", "elle ne veut pas de rendez-vous"),
            # ⚠ LA SEULE NATURE, AVEC LE DÉPLACEMENT, OÙ LA PHRASE RESTE
            # (11/08/2026) — et elle y MANQUAIT : le contact partait bien « à
            # rappeler par un humain », mais l'agent n'avait pas le droit de le
            # proposer. Ici un humain a un vrai travail : trouver une date.
            # ⚠ ELLE PROPOSE SON PROPRE MOMENT, ET C'EST UN OUI (24/08/2026).
            # La simulation JOUAIT cette fin — « rescheduled » est dans la
            # suite de cette nature — et le produit sait l'absorber : mesuré,
            # il crée le rendez-vous à la date proposée, contact « accepté ».
            # Mais la consigne ne la DEMANDAIT jamais : l'agent n'avait le
            # droit que de rendre « to_reschedule ». Une date convenue au
            # téléphone repartait donc en rappel par un humain — pour refixer
            # ce qui venait d'être fixé.
            #
            # Même forme que « déplacement » : la date décide. Avec elle, le
            # rendez-vous est posé ; sans elle, un humain reprend la main.
            "autre": consigne.issue(
                "rescheduled",
                "tout le reste : elle préfère un moment qui n'est pas dans "
                "tes créneaux, elle demande à être rappelée par un humain, "
                "elle dit n'avoir rien demandé, ou elle pose une question à "
                "laquelle tu n'as pas la réponse",
                code_sans_date="to_reschedule", date="facultative"),
        },
        "infos": (
            _info("entreprise", "Nom de l'entreprise", obligatoire=True,
                  reglage=themes.CLE_ENTREPRISE),
            _info("origine", "Origine de la demande (ex. « vous avez demandé "
                             "un rendez-vous sur notre site »)",
                  obligatoire=True),
            _info("creneaux_proposes", "Créneaux disponibles à proposer",
                  "long", obligatoire=True, reglage="creneaux_lisibles"),
            _info("duree", "Durée"),
            _info("lieu", "Lieu"),
        ),
        "champs": (
            _champ("motif", "Motif souhaité (si fourni)"),
        ),
        "gabarit": (
            "Bonjour [identite], je suis l'assistant de [entreprise]. "
            "[origine] — je vous appelle pour fixer ce rendez-vous.",
            " Le motif noté : [motif].",
            " J'ai comme disponibilités : [creneaux_proposes]. "
            "Qu'est-ce qui vous arrange ?",
            {"texte": " La séance dure [duree].", "si": "duree"},
            {"texte": " Cela se passe à [lieu].", "si": "lieu"},
        ),
    },
}

# ⚠ TROIS NATURES RETIRÉES le 03/08/2026, à la demande du propriétaire, et
# nos propres mesures lui donnaient raison :
#
#  · ☎ « Rappel d'appel manqué » — son état déclencheur (« a cherché à nous
#    joindre ») n'était JAMAIS produit par le moteur : le banc d'essai le
#    constatait noir sur blanc. Et son discours posait une question ouverte
#    (« Que puis-je faire pour vous ? ») alors que ses issues étaient celles
#    d'un rendez-vous : l'agent ne pouvait pas conclure proprement.
#  · 🎯 « Contact unique avec sujet » et ✍ « Personnalisé » — aucune écriture
#    dans le carnet de rendez-vous, aucun champ, et des issues taillées pour
#    un rendez-vous plaquées sur « demander un devis ». « Personnalisé »
#    n'avait même pas de gabarit.
#
# Les cinq qui restent forment un tout : elles agissent TOUTES sur le carnet
# de rendez-vous et rendent des issues qu'il sait absorber.
#
# Elles restent LISIBLES : une base existante peut porter des campagnes de
# ces natures, et une campagne qu'on ne sait plus nommer serait une donnée
# perdue. On ne peut simplement plus en créer.
NATURES_RETIREES = {
    "appel_manque": {"icone": "☎", "nom": "Rappel d'appel manqué"},
    "contact_unique": {"icone": "🎯", "nom": "Contact unique avec sujet"},
    "personnalise": {"icone": "✍", "nom": "Personnalisé"},
}


def fiche_nature(nature):
    """La fiche d'une nature — y compris celles qu'on ne crée plus.

    Tout ce qui AFFICHE une campagne passe par ici : sans cela, une
    campagne d'une nature retirée n'aurait plus ni nom ni pictogramme.
    Rend None pour une nature inconnue, à charge de l'appelant.
    """
    return NATURES.get(nature) or NATURES_RETIREES.get(nature)


def nature_creable(nature):
    """Vrai si l'on peut encore BÂTIR une campagne de cette nature."""
    return nature in NATURES

POLITIQUES = {
    "premier_oui": "séquentiel — arrêt au premier oui, les suivants épargnés",
    "tous": "appeler toute la liste",
    "unique": "un seul contact",
}

# ⚠ « ANCIENNETE » DISAIT LE CONTRAIRE DE CE QU'IL FAISAIT. Son libellé
# annonçait « le rendez-vous le plus ancien d'abord » et le tri prenait la date
# la plus PETITE — donc le rendez-vous le plus PROCHE. Pour des rendez-vous à
# venir, le plus petit n'est pas le plus ancien : c'est le plus imminent. Le
# libellé dit maintenant ce que le code fait, et la clé reste la même pour ne
# rien casser (03/08/2026).
ORDRES_APPEL = {
    "liste": "Ordre de la liste",
    "eloignement": "Le rendez-vous le plus LOINTAIN d'abord",
    "anciennete": "Le rendez-vous le plus PROCHE d'abord",
    "proximite": "Proximité du créneau — le plus proche du créneau d'abord",
    "alphabetique": "Alphabétique — par nom",
}

# Les deux seuls ordres qui parlent de la DATE du rendez-vous. Ce sont ceux que
# le sélecteur posé au-dessus de la grille propose : les autres n'ont pas de
# sens quand on choisit qui profite d'une place qui se libère.
ORDRES_PAR_DATE = ("eloignement", "anciennete")

# Les états des contacts d'une campagne de l'assistant (pastille, classe CSS).
ETATS = {
    "à appeler": ("⏳", "st-prevu"),
    "en cours": ("📞", "st-prevu"),
    "accepté": ("✅", "st-confirme"),
    "refusé": ("❌", "st-annule"),
    # Il a annulé sans replacer : plus aucun appel ne partira pour lui,
    # c'est LUI qui reprendra contact (règle du 31/07/2026).
    # ⚠ ET LE PICTOGRAMME SUIT LE MOT (21/08/2026). 📞 évoquait un appel ;
    # ce qui s'est passé, c'est une annulation.
    ETAT_RAPPELLERA: ("❌", "st-annule"),
    "à recontacter": ("🔁", "st-manque"),
    "injoignable": ("📵", "st-ignore"),
    # L'appel EST parti, son résultat n'est pas (encore) connu — voir
    # ETAT_RESULTAT_INCONNU. Aucune tentative ne lui a été comptée.
    ETAT_RESULTAT_INCONNU: ("⏱", "st-manque"),
    "à rappeler par un humain": ("🙋", "st-deplace"),
    "exclu": ("🚫", "st-annule"),
    "épargné": ("💤", "st-confirme"),
}

# Sources de remplissage « depuis la base » de l'étape 3.
SOURCES_BASE = {
    # « poses » : tout ce qui OCCUPE une place — prévus ET confirmés, comme
    # le planning les compte. C'est la source qu'on veut pour un rappel :
    # un rendez-vous confirmé se rappelle aussi. Ajoutée le 02/08/2026 après
    # qu'une semaine affichant 13 rendez-vous n'en ait repris aucun.
    "poses": "Rendez-vous posés — prévus ET confirmés (comme au planning)",
    "a_venir": "Rendez-vous à venir, pas encore confirmés",
    "manques": "Rendez-vous manqués (avec date et motif)",
    # ⚠ LA DÉFINITION EST DANS LE LIBELLÉ, entre parenthèses. « En attente »
    # n'est pas un statut du produit : le mot désigne un rendez-vous DÉPLACÉ
    # dont le client n'a pris aucune suite. L'écrire évite qu'on coche cette
    # source en croyant qu'elle rappelle aussi ceux qui ont déjà un
    # rendez-vous (décision du propriétaire du 03/08/2026).
    "a_recaser": ("Rendez-vous annulés, manqués et en attente "
                  "(déplacés sans nouveau rendez-vous)"),
    "annules": "Rendez-vous annulés",
    "deplaces": "Déplacés en attente",
    "tous": "Tous les clients",
}

# LES MÊMES SOURCES, RANGÉES EN DEUX FAMILLES (demande du propriétaire,
# 02/08/2026). « Reprendre depuis la base » était une seule voie qui mélangeait
# deux questions sans rapport : « quelles DATES de rendez-vous ? » et
# « quels CLIENTS ? ». On ne change ni les codes ni le calcul — seulement la
# façon de poser la question, en trois voies distinctes :
#   ① charger les clients (tous, ou un état particulier) ;
#   ② charger selon les dates de rendez-vous ;
#   ③ charger selon une campagne précédente (inchangée).
# Un code retiré d'ici resterait accepté par contacts_depuis_base : les
# recettes déjà enregistrées continuent donc de se rejouer à l'identique.
SOURCES_RENDEZVOUS = {code: SOURCES_BASE[code]
                      for code in ("poses", "a_venir", "manques", "a_recaser",
                                   "annules", "deplaces")}
# Les sources qui portent une DATE : elles seules acceptent une période.
SOURCES_DATEES = ("poses", "a_venir", "manques", "a_recaser")

# ⚠ CE QUE LA RÈGLE DYNAMIQUE PROPOSE, ET C'EST PLUS ÉTROIT (15/08/2026, sa
# demande). « Rendez-vous posés — prévus ET confirmés » a été retirée d'ICI, et
# d'ici seulement : la source reste offerte au chargement MANUEL, où elle a du
# sens (reprendre une journée entière du planning), et les recettes déjà
# enregistrées continuent de se rejouer — rien n'est cassé en base.
#
# Pourquoi la retirer de la règle : une règle dynamique sert à trouver QUI
# avancer sur une place qui se libère. Un rendez-vous déjà CONFIRMÉ est un
# accord obtenu ; aller le déranger pour le déplacer travaille contre soi. La
# source « à venir, pas encore confirmés » vise exactement les bonnes personnes,
# et c'est elle qui devient le choix par défaut.
SOURCES_REGLE = ("a_venir", "manques", "a_recaser")

# ⚠ UNE TABLE QUI REFUSE CE QU'ELLE NE CONNAÎT PAS. Elle avait « manqué »
# pour valeur par défaut : un code neuf y tombait sans bruit, et l'écran
# annonçait une source pendant que la grille en contenait une autre. Ajouter
# une source, c'est désormais l'ajouter ICI aussi — ou se faire refuser.
STATUT_PAR_SOURCE_DATEE = {
    "poses": "poses",
    "a_venir": "prévu",
    "manques": "manqué",
    "a_recaser": "a_recaser",
}
SOURCE_TOUS_CLIENTS = "tous"

# Reprise d'une CAMPAGNE PRÉCÉDENTE, filtrée par état de son résultat.
# Les résultats de campagne sont déjà en base (contacts_campagne.etat, écrit
# depuis le résultat réel de chaque appel) : c'est ce qui permet de rejouer
# « ceux que je n'ai pas eus », « ceux qui ont refusé »… sans ressaisie.
# C'est un FILTRE : il s'affiche en listes déroulantes, pas en boutons radio.
ETATS_REPRISE = {
    "injoignable": "📵 Injoignables",
    "refusé": "❌ Refus",
    "à rappeler par un humain": "🙋 À rappeler par un humain",
    "accepté": "✅ Acceptés",
    "à recontacter": "🔁 À recontacter",
    "tous": "Tous les contacts de la campagne",
}


def option_annulation_utile(nature):
    """Vrai si le message de CETTE nature change selon l'option d'annulation.

    Elle n'a de sens que là où le client peut annuler un rendez-vous
    existant pendant l'appel : 🔔 rappel et ✅ confirmation (fiches 2 et 3).
    Ailleurs, la case n'est pas affichée — on ne propose pas un réglage
    qui ne changerait rien.
    """
    return any(isinstance(segment, dict)
               and CLE_REPLACER_ANNULATION in (segment.get("si_option"),
                                               segment.get("sauf_option"))
               for segment in NATURES[nature]["gabarit"])


def infos_de_sous_option(nature, option):
    """Les informations d'étape 2 qui sont le DÉTAIL de cette option."""
    return [info for info in NATURES[nature]["infos"]
            if info.get("sous_option") == option]


def champs_campagne(brouillon_ou_config):
    """Les colonnes complètes (socle + nature + personnalisés) d'un brouillon
    ou d'une configuration enregistrée."""
    return list(_CHAMPS_SOCLE) + list(brouillon_ou_config.get("champs", []))


# ---------------------------------------------------------------------------
# CE QUI MANQUE DANS LA GRILLE — une seule phrase, la couleur fait le reste
# ---------------------------------------------------------------------------
# Avant le 02/08/2026, chaque case obligatoire vide produisait SA phrase
# d'erreur. Sur dix contacts et trois colonnes, cela faisait trente phrases
# identiques empilées au-dessus de la grille : illisible, et sans dire OÙ
# taper. Le propriétaire a tranché : une seule phrase, et les cases fautives
# colorées dans la grille elle-même.
#
# La couleur ne s'allume PAS seulement après un refus : elle est calculée à
# chaque affichage, donc dès l'importation des contacts — on voit ce qui
# reste à faire avant même d'essayer de valider.
MESSAGE_CHAMPS_OBLIGATOIRES = (
    "Veuillez compléter les champs obligatoires : ils sont encadrés de rouge "
    "dans la grille.")

# Deux caractères au minimum pour une identité : « M » ou une espace ne
# nomment personne.
LONGUEUR_MINIMALE_IDENTITE = 2


def cellules_manquantes(brouillon):
    """Les cases obligatoires vides : {(n° de ligne, code de colonne)}.

    Le code est celui qui NOMME le champ dans le formulaire : « identite »
    et « telephone » pour les deux colonnes du socle, sinon le code de la
    colonne. C'est ce qui permet à l'écran de colorer exactement la bonne
    case sans refaire la règle de son côté — une seule vérité, ici.

    ⚠ Ne dit RIEN des valeurs orphelines (celles dont la colonne a été
    retirée) : « en trop ce n'est pas grave » est la règle du propriétaire,
    et ces valeurs restent en place pour revenir si la colonne revient.
    """
    obligatoires = [champ for champ in champs_campagne(brouillon)
                    if champ["obligatoire"]
                    and champ["code"] not in ("identite", "telephone")]
    manquantes = set()
    for rang, contact in enumerate(brouillon.get("contacts") or [], start=1):
        if len((contact.get("nom") or "").strip()) < LONGUEUR_MINIMALE_IDENTITE:
            manquantes.add((rang, "identite"))
        if not (contact.get("telephone") or "").strip():
            manquantes.add((rang, "telephone"))
        valeurs = contact.get("champs") or {}
        for champ in obligatoires:
            if not str(valeurs.get(champ["code"], "") or "").strip():
                manquantes.add((rang, champ["code"]))
    return manquantes


def verifier_grille(brouillon):
    """La phrase à afficher quand la grille est incomplète (rien sinon).

    Appelée après un changement de colonnes : en changer quand la grille est
    déjà remplie oblige à la revérifier. Rend une LISTE (vide, ou d'un seul
    élément) pour se brancher sans rien changer sur `brouillon["erreurs"]`,
    qui en attend une.
    """
    return ([MESSAGE_CHAMPS_OBLIGATOIRES] if cellules_manquantes(brouillon)
            else [])


def code_champ(libelle):
    """« Numéro de dossier » devient « numero_de_dossier » (variable [code])."""
    decompose = unicodedata.normalize("NFD", (libelle or "").casefold())
    sans_accents = "".join(c for c in decompose if not unicodedata.combining(c))
    code = re.sub(r"[^a-z0-9]+", "_", sans_accents).strip("_")
    return code or "champ"


# ------------------------------------------------------ période interdite
def periode_interdite(preferences):
    """La période interdite réglée (« HH:MM », « HH:MM ») ou None si aucune."""
    debut = (preferences.obtenir(CLE_INTERDIT_DEBUT) or "").strip()
    fin = (preferences.obtenir(CLE_INTERDIT_FIN) or "").strip()
    if debut and fin:
        return debut, fin
    return None


def dans_periode_interdite(preferences, maintenant=None):
    """Message d'erreur français si l'instant tombe dans la période interdite
    (elle peut traverser minuit : 20:00 → 08:00), sinon None."""
    periode = periode_interdite(preferences)
    if periode is None:
        return None
    debut, fin = periode
    if maintenant is None:
        maintenant = datetime.datetime.now()
    heure = maintenant.strftime("%H:%M")
    if debut <= fin:
        dedans = debut <= heure < fin
    else:  # traverse minuit (ex. 20:00 → 08:00)
        dedans = heure >= debut or heure < fin
    if not dedans:
        return None
    return (f"Appel refusé : il est {maintenant:%Hh%M}, nous sommes dans la "
            f"période interdite réglée ({debut.replace(':', ' h ')} → "
            f"{fin.replace(':', ' h ')}) — aucun appel ni relance ne s'y "
            "déclenche, même déclenché à la main. Elle se règle dans "
            "« ⚙ Réglages ».")


def _hors_interdit(moment, preferences):
    """Repousse un instant hors de la période interdite (à sa fin)."""
    periode = periode_interdite(preferences)
    if periode is None:
        return moment
    debut, fin = periode
    heure = moment.strftime("%H:%M")
    heure_fin, minute_fin = (int(x) for x in fin.split(":"))
    if debut <= fin:
        if debut <= heure < fin:
            return moment.replace(hour=heure_fin, minute=minute_fin)
        return moment
    if heure >= debut:      # soir : la fin est le lendemain matin
        return (moment + datetime.timedelta(days=1)).replace(
            hour=heure_fin, minute=minute_fin)
    if heure < fin:         # petit matin : la fin est le même jour
        return moment.replace(hour=heure_fin, minute=minute_fin)
    return moment


def echeance_relance_campagne(preferences, options, maintenant=None):
    """L'échéance de la prochaine relance : par délai OU par créneau de rappel.

    options : les options de comportement de la campagne (étape 2) — elles
    priment sur les réglages par défaut de la page ⚙.

    L'échéance tombe toujours quand le cabinet TRAVAILLE : dans la plage
    d'appel autorisée, hors période interdite, un jour ouvert de la semaine
    type et pas un jour déclaré fermé. C'est la règle du propriétaire —
    « en cas de demande de rappel, un salarié peut le faire ». Les deux
    modes y passent : le délai en heures ouvrées (campagnes.
    echeance_apres_heures_ouvrees, qui connaît désormais les réglages) et
    le créneau de rappel quotidien, repoussé au prochain jour travaillé.
    Rend un horaire ISO 8601 à la minute.
    """
    if maintenant is None:
        maintenant = datetime.datetime.now()
    maintenant = maintenant.replace(second=0, microsecond=0)
    mode = options.get("relance_mode") or preferences.obtenir(
        CLE_RELANCE_MODE) or "delai"
    if mode == "creneau":
        debut = (options.get("relance_creneau_debut")
                 or preferences.obtenir(CLE_RELANCE_CRENEAU_DEBUT) or "12:00")
        fin = (options.get("relance_creneau_fin")
               or preferences.obtenir(CLE_RELANCE_CRENEAU_FIN) or "14:00")
        heure = maintenant.strftime("%H:%M")
        heure_debut, minute_debut = (int(x) for x in debut.split(":"))
        if heure < debut:
            echeance = maintenant.replace(hour=heure_debut, minute=minute_debut)
        elif heure < fin:
            echeance = maintenant  # déjà dans le créneau : due dès maintenant
        else:
            echeance = (maintenant + datetime.timedelta(days=1)).replace(
                hour=heure_debut, minute=minute_debut)
        echeance = _prochain_jour_travaille(echeance, preferences)
    else:
        try:
            delai = int(options.get("relance_delai"))
        except (TypeError, ValueError):
            delai, _ = campagnes.parametres_relance(preferences)
        debut_plage, fin_plage = themes.plage(preferences)
        echeance = campagnes.echeance_apres_heures_ouvrees(
            maintenant, delai, debut_plage, fin_plage, preferences)
    return _hors_interdit(echeance, preferences).isoformat(timespec="minutes")


def _prochain_jour_travaille(moment, preferences):
    """Repousse un instant au prochain jour où le cabinet TRAVAILLE.

    Sert au mode « créneau de rappel quotidien » : un créneau de 12h-14h ne
    doit pas échoir un dimanche ni un jour déclaré fermé. L'heure du
    créneau, elle, est conservée telle quelle — c'est ce que l'utilisateur
    a réglé. Les règles de jours viennent de campagnes.jour_travaille, qui
    les lit dans horaires : rien n'est dupliqué ici. Au-delà de la butée
    (rien d'ouvert d'une année), l'instant est rendu INCHANGÉ et le journal
    le dit — la relance reste visible plutôt que perdue.
    """
    candidat = moment
    for _ in range(campagnes.JOURS_CHERCHES_ECHEANCE):
        if campagnes.jour_travaille(candidat.date(), preferences):
            return candidat
        candidat += datetime.timedelta(days=1)
    journal.warning(
        "Créneau de rappel : aucun jour ouvert dans les %d prochains jours — "
        "l'échéance reste au jour calculé. Ouvrez des jours dans « ⚙ Réglages ».",
        campagnes.JOURS_CHERCHES_ECHEANCE)
    return moment


def maximum_rappels(preferences, options):
    """Le nombre maximal de rappels : celui de la campagne, sinon celui des
    réglages."""
    try:
        return int(options.get("relance_max"))
    except (TypeError, ValueError):
        _, maximum = campagnes.parametres_relance(preferences)
        return maximum


# ------------------------------------------------------------- la mission
def date_courte(iso):
    """« 2026-08-03T14:00 » devient « 03/08/2026 à 14h00 » (sans « le »)."""
    lisible = themes.date_lisible(iso)
    return lisible[3:] if lisible.startswith("le ") else lisible


def date_chiffree(iso):
    """« 2026-08-03T14:00 » devient « 03/08/2026 14:00 ».

    Le format demandé par le propriétaire le 11/08/2026, jj/mm/aaaa hh:mm, pour
    une colonne de TABLEAU : on y compare des dates d'une ligne à l'autre, et
    « à 14h00 » ajoute deux caractères qui n'aident pas à comparer. Ailleurs —
    dans une phrase, dans un message dit au téléphone — c'est `date_courte` qui
    reste juste : « le 3 août à 14h00 » se lit, « 03/08/2026 14:00 » s'aligne.

    Rend "" pour une valeur vide ou illisible : jamais une date inventée.
    """
    texte = str(iso or "").strip()
    if not texte:
        return ""
    try:
        quand = datetime.datetime.fromisoformat(texte)
    except ValueError:
        return ""
    return quand.strftime("%d/%m/%Y %H:%M")


def _valeur_lisible(valeur, type_champ, langue_code="fr"):
    """La valeur d'un champ telle qu'elle entre DANS LE MESSAGE ET LA CONSIGNE.

    ⚠ CETTE FONCTION NE SERT QU'À CE QUI SE DIT. Ses cinq appelants
    construisent tous du texte destiné à l'agent : le message d'ouverture
    (construire_mission, finaliser_mission), la consigne (construire_consigne,
    finaliser_consigne) et le contrôle « ce message a-t-il perdu une
    information ? » (infos_perdues), qui compare au même texte. D'où le format
    PARLÉ depuis le 24/08/2026 — « lundi 24 août 2026 à 10 heures 20 ».

    ⚠ LES ÉCRANS GARDENT `date_courte` : un tableau se lit en colonne, une
    phrase se dit à voix haute. Changer les deux d'un coup aurait allongé
    chaque ligne de chaque liste du produit sans que personne l'ait demandé.
    """
    if type_champ == "date":
        # ⚠ ET DANS LA LANGUE DE L'APPEL. Une date française au milieu d'une
        # consigne anglaise serait lue telle quelle à voix haute : « mardi 15
        # septembre 2026 à 9 heures 40 », prononcé par une voix anglaise, à un
        # patient anglophone. Mesuré le 01/09/2026 sur la ligne « Créneau
        # libéré », qui était la dernière à rester française.
        return themes.date_parlee(valeur, langue_code)
    return valeur


def cle_discours(nature):
    """La clé de réglage du discours d'ouverture de CETTE nature."""
    return f"discours_{nature}"


def cle_comportement(nature):
    """La clé de réglage des options de comportement de CETTE nature."""
    return f"comportement_{nature}"


# Les options de comportement réglables par nature, et rien d'autre. Une clé
# absente de cette liste est IGNORÉE à la relecture : un réglage écrit par une
# version future, ou un envoi forgé, ne peut pas introduire une option que le
# produit ne sait pas honorer.
OPTIONS_COMPORTEMENT = (
    "recontacter", "liberer_creneau", "repondeur_sans_motif", "cascade",
    CLE_REPLACER_ANNULATION,
)

# Le DÉTAIL des relances, réglable lui aussi par nature : cocher
# « Recontacter » sans pouvoir dire au bout de combien de temps ni combien de
# fois ne réglait rien de ce qui compte (signalé le 02/08/2026). Ce sont des
# textes, pas des cases : ils sont repris tels quels, jamais convertis en
# booléen — d'où deux listes séparées.
DETAILS_RELANCE = ("relance_mode", "relance_delai", "relance_max",
                   "relance_creneau_debut", "relance_creneau_fin")

# CE QUE LE PRODUIT LIVRE, en un seul endroit. Ces valeurs étaient écrites
# dans creer_brouillon_assistant : l'écran des Réglages ne les connaissait
# donc pas et affichait tout décoché, alors que le formulaire de campagne,
# lui, arrivait tout coché. Deux écrans, deux vérités — constaté à l'écran le
# 02/08/2026. Il n'y en a plus qu'une, et les deux la lisent.
OPTIONS_LIVREES = {
    "recontacter": True,
    "liberer_creneau": True,
    "repondeur_sans_motif": True,
    # Une annulation pendant l'appel : l'agent a-t-il le droit de proposer
    # une autre date ? Oui par défaut — c'est ce que décrivent les fiches de
    # discussion. La case n'est montrée que pour les natures dont le message
    # en dépend (voir option_annulation_utile).
    CLE_REPLACER_ANNULATION: True,
    # La cascade, elle, ne s'arme JAMAIS toute seule : elle prépare une
    # campagne de plus, et cela se décide.
    "cascade": False,
    "cascade_jusqu_au": "",
}


def relances_generales(preferences):
    """Le réglage GÉNÉRAL des relances, sous forme d'options de campagne.

    Un seul endroit lit ces quatre valeurs : l'écran des Réglages et la
    création d'un brouillon montrent donc exactement la même chose.
    """
    delai, maximum = campagnes.parametres_relance(preferences)
    return {
        "relance_mode": preferences.obtenir(CLE_RELANCE_MODE) or "delai",
        "relance_delai": str(delai),
        "relance_max": str(maximum),
        "relance_creneau_debut": preferences.obtenir(
            CLE_RELANCE_CRENEAU_DEBUT) or "12:00",
        "relance_creneau_fin": preferences.obtenir(
            CLE_RELANCE_CRENEAU_FIN) or "14:00",
    }


def comportement_regle(nature, preferences, socle=None):
    """(options, politique, ordre) pour une campagne NEUVE de cette nature.

    Trois couches, dans cet ordre : ce que le produit livre, puis les
    réglages généraux (relances), puis le réglage propre à CETTE nature.
    Demandé par le propriétaire le 02/08/2026 : « les options de comportement
    doivent être dans les réglages pour les valeurs par défaut selon le type
    de campagne ».

    `socle` : les options déjà calculées par l'appelant. Il n'est jamais
    modifié — on rend une copie. Quand il manque, les réglages généraux de
    relance sont lus ICI : sans cela, l'écran des Réglages affichait un
    délai et un plafond VIDES tant qu'on n'avait rien enregistré, alors que
    le formulaire de campagne, lui, arrivait rempli. Constaté à l'écran par
    le propriétaire le 02/08/2026 — deux écrans, deux vérités, encore.

    ⚠ Ne vaut que pour les campagnes À VENIR : une campagne créée fige ses
    options dans sa configuration, et changer ce réglage ne les rejoue pas.
    """
    definition = NATURES[nature]
    options = dict(OPTIONS_LIVREES)
    options.update(relances_generales(preferences))
    options.update(socle or {})
    politique = definition["politique"]
    # ⚠ AUCUN ORDRE N'EST INVENTÉ ICI. Deux natures en proposent un parce
    # qu'il va de soi (ancienneté pour un créneau libéré, proximité pour un
    # rappel) ; les six autres laissent la question ouverte, et l'écran
    # affiche « — à choisir — ». C'est une décision du propriétaire
    # (« proposer, pas imposer ») : un réglage de nature peut la trancher,
    # le produit non.
    ordre = definition.get("ordre_defaut")
    regle = preferences.obtenir(cle_comportement(nature))
    if isinstance(regle, dict):
        for cle in OPTIONS_COMPORTEMENT:
            if cle in regle:
                options[cle] = bool(regle[cle])
        for cle in DETAILS_RELANCE:
            # Une chaîne vide vaut « rien de particulier pour cette nature » :
            # le réglage général s'applique alors, et il est déjà dans le socle.
            if str(regle.get(cle, "")).strip():
                options[cle] = regle[cle]
        if (definition["politique_modifiable"]
                and regle.get("politique") in POLITIQUES):
            politique = regle["politique"]
        if regle.get("ordre") in ORDRES_APPEL:
            ordre = regle["ordre"]
    return options, politique, ordre


def gabarit_nature(nature, options=None):
    """Le texte d'ouverture LIVRÉ AVEC LE PRODUIT, variables comprises.

    C'est le gabarit de la nature, le point de départ que les Réglages
    proposent de récrire et celui sur lequel on revient quand on annule sa
    réécriture.

    ⚠ Ses segments conditionnels sont TRANCHÉS (avec `options`, celles de la
    nature) : une mise à plat sans condition affichait les deux branches à
    la fois, donc des phrases qui se contredisent. Ce qu'on lit ici est ce
    qui sera dit.
    """
    return _segments_retenus(NATURES[nature], {}, options or {})


def discours_regle(nature, preferences):
    """Le texte d'ouverture de cette nature : le vôtre, sinon celui livré.

    Réglage ajouté le 02/08/2026 à la demande du propriétaire : « dans ce
    menu nous allons ajouter les éléments de discours de l'IA selon le cas
    de figure ». Une campagne peut encore le récrire pour elle seule
    (étape ② en mode avancé) — ce réglage-ci donne le texte de DÉPART,
    commun à toutes les campagnes de cette nature.

    Un réglage vide vaut « celui livré avec le produit » : effacer la zone
    est donc le moyen de revenir en arrière, et il n'y a rien d'autre à
    savoir pour y arriver.
    """
    ecrit = (preferences.obtenir(cle_discours(nature)) or "").strip()
    return ecrit or gabarit_nature(nature)


def infos_perdues_par_le_texte(nature, infos, preferences, options, mission):
    """Les informations que le message RETAPÉ à la main ne dit PLUS.

    Rend [(libellé, valeur lisible)] — vide quand le texte n'a pas été retapé,
    ou quand il dit toujours tout.

    ⚠ SON DÉFAUT N° 10 DU 18/08/2026, et c'est le plus sournois de la liste :
    il remplit un champ, l'écran le montre rempli, la campagne l'enregistre… et
    l'agent ne le dit jamais. Mesuré : message retapé à l'étape 2, PUIS la
    raison saisie (« un imprévu dans notre planning »). Elle est bien dans la
    campagne, elle n'est pas dans le message — donc pas au téléphone. Rien ne
    le disait.

    ⚠ ON NE RÉÉCRIT PAS SON TEXTE, ET C'EST LA RÈGLE : « un message récrit à la
    main doit partir exactement comme il l'a écrit » (voir
    `construire_consigne`). Y réinjecter la phrase serait pire que le silence —
    ce serait modifier ce qu'un humain a décidé de dire. On le DIT, il tranche.

    LA COMPARAISON EST FAITE AVEC LE TEXTE DE DÉPART, pas avec le gabarit : une
    information est « perdue » si le texte que RingBack aurait écrit la disait
    et que le sien ne la dit plus. C'est exact dans les deux cas qui piègent —
    un discours réglé dans ⚙ Réglages qui prime sur le gabarit livré, et une
    date, qui ne s'écrit pas dans le message comme elle est stockée (les deux
    côtés passent par le même rendu).
    """
    # ⚠ UNE NATURE RETIRÉE RESTE LISIBLE EN BASE (« personnalisé », retirée le
    # 03/08/2026) : une campagne d'alors n'a plus de fiche, et il n'y a donc
    # rien à comparer. On se tait plutôt que de lever une erreur sur un écran
    # qui ne demandait qu'à s'afficher.
    # `nature_creable` et non `fiche_nature` : cette dernière rend AUSSI la
    # fiche des natures retirées, pour que leurs campagnes restent lisibles —
    # mais on ne peut plus BÂTIR leur message, et c'est justement ce qu'on
    # compare ici. Le prédicat existe, il dit exactement cela.
    if not nature_creable(nature):
        return []
    definition = NATURES[nature]
    auto = construire_mission(nature, infos, preferences, options)
    perdues = []
    for info in definition["infos"]:
        valeur = (infos.get(info["code"]) or "").strip()
        if not valeur:
            continue
        lisible = _valeur_lisible(valeur, info["type"])
        if lisible and lisible in auto and lisible not in mission:
            perdues.append((info["libelle"], lisible))
    return perdues


def construire_mission(nature, infos, preferences, options=None):
    """Le texte de mission construit depuis le gabarit, les informations
    de l'étape 2 ET ses options — exactement ce que fait l'aperçu vivant.

    Les variables d'étape 2 renseignées sont substituées (les dates en
    français lisible) ; les variables PAR CONTACT ([identite],
    [rdv_existant]…) restent telles quelles : elles sont remplies à chaque
    appel. [plage_rappel] vient des réglages, comme partout.

    Un segment porte au choix :
    - « si » / « sauf » : la condition est une INFORMATION de l'étape 2 ;
    - « si_option » / « sauf_option » : la condition est une OPTION de
      comportement (une case à cocher). C'est ainsi que l'option
      « proposer une autre date si le contact annule » change réellement ce
      que l'agent a le droit de dire, au lieu de rester un réglage muet.
    """
    definition = NATURES[nature]
    options = options or {}
    types = {info["code"]: info["type"] for info in definition["infos"]}
    # LE DISCOURS RÉGLÉ PRIME sur le gabarit livré. Il est pris tel quel :
    # un texte écrit à la main n'a pas de segments conditionnels, donc pas de
    # phrase à faire tomber ici — celles dont une variable reste vide sont
    # retirées plus tard, au moment de l'appel (_sans_phrases_incompletes).
    regle = (preferences.obtenir(cle_discours(nature)) or "").strip()
    if regle:
        # ⚠ UN DISCOURS RÉGLÉ À LA MAIN N'EST JAMAIS TRADUIT. C'est l'exacte
        # même règle que pour un message de campagne récrit : le texte
        # appartient à celui qui l'a écrit, et le traduire ferait dire au
        # téléphone une phrase que personne n'a relue.
        return _remplir(regle, infos, types, preferences)
    return _remplir(
        _segments_retenus(definition, infos, options,
                          mod_langue.traducteur(
                              mod_langue.de_preferences(preferences))),
        infos, types, preferences)


def _segments_retenus(definition, infos, options, dire=None):
    """Le texte du gabarit, ses segments conditionnels TRANCHÉS.

    Deux segments qui s'excluent (« si raison » / « sauf raison ») ne
    doivent jamais sortir ensemble : mis à plat sans condition, ils
    donnaient « En raison de …, nous Nous devons déplacer », et deux
    phrases contradictoires à la suite dans le rappel de rendez-vous.
    Constaté par le propriétaire le 02/08/2026 dans l'aperçu des Réglages.
    """
    # ⚠ ON TRADUIT SEGMENT PAR SEGMENT, AVANT DE LES COLLER. Traduire la
    # phrase assemblée serait impossible : elle dépend des conditions, donc
    # des informations d'étape 2 et des options — des milliers de
    # combinaisons. Les segments, eux, sont en nombre fini et écrits une fois.
    dire = dire or (lambda texte: texte)
    morceaux = []
    for segment in definition["gabarit"]:
        if isinstance(segment, str):
            morceaux.append(dire(segment))
            continue
        if _segment_retenu(segment, infos, options):
            morceaux.append(dire(segment["texte"]))
    return "".join(morceaux)


def _segment_retenu(segment, infos, options):
    """Ce segment du gabarit entre-t-il dans le message ? (conditions ET)

    ⚠ UN SEGMENT PEUT EN PORTER DEUX DEPUIS LE 31/08/2026, et il le fallait.
    Le moteur en lisait UNE SEULE : si un segment portait « si_option », sa
    condition d'INFORMATION était ignorée. Deux dénouements l'ont montré :

    · 30/08 — sur une confirmation dont les places libres étaient vides, la
      phrase qui les proposait tombait (elle portait la variable) et la
      SUIVANTE restait : « … merci de me confirmer votre présence. Si aucune
      ne vous convient, j'annule votre rendez-vous. » « Aucune » ne renvoyait
      plus à rien ;
    · 31/08 — en retirant la liste de l'ouverture (sa demande), la phrase ne
      portait plus de variable : elle ne pouvait donc plus tomber, et l'agent
      promettait « je peux vous proposer une autre date » avec ZÉRO place en
      magasin.

    Les deux se règlent d'un coup : le segment déclare SES conditions, toutes
    doivent être vraies. C'est déjà la grammaire de `_fait_retenu`, du côté
    des faits — les deux moitiés de la consigne se lisent maintenant pareil.
    """
    if segment.get("si_option") and not options.get(segment["si_option"]):
        return False
    if segment.get("sauf_option") and options.get(segment["sauf_option"]):
        return False
    # « non » d'un choix oui/non compte comme NON rempli (sinon la phrase
    # conditionnelle apparaîtrait justement quand on l'a refusée).
    def rempli(code):
        valeur = (infos.get(code) or "").strip()
        return bool(valeur) and valeur != "non"

    if segment.get("si") and not rempli(segment["si"]):
        return False
    if segment.get("sauf") and rempli(segment["sauf"]):
        return False
    return True


# ⚠ L'ÉLISION — son défaut n° 11 du 18/08/2026. Relevé mot pour mot dans une
# transcription : « **En raison de un imprévu** dans notre planning ». Le
# gabarit écrit « de [raison] » et la valeur commence par une voyelle : la
# substitution posait les deux bout à bout. C'est un texte qu'un agent LIT à
# voix haute — une faute de liaison s'entend.
#
# LES QUATRE MOTS QUI S'ÉLIDENT ICI, et pas un de plus : ce sont ceux qui
# précèdent une variable dans les gabarits livrés ou dans un discours écrit à
# la main. Un mot absent de cette table n'est simplement pas élidé — on ne
# devine pas la grammaire d'une phrase qu'on n'a pas écrite.
_ELIDABLES = {"de": "d'", "que": "qu'", "le": "l'", "la": "l'"}

# ⚠ LE « h » EN EST EXCLU, VOLONTAIREMENT. Le français a deux h : le muet
# (« d'homme ») et l'aspiré (« de haricot »), et rien dans une valeur saisie ne
# dit lequel. Élider au hasard ferait dire « d'haricot » une fois sur deux ;
# ne pas élider laisse « de homme », qui se remarque mais ne choque pas autant.
# Devant l'incertitude, on ne devine pas.
_VOYELLES = "aàâäeéèêëiîïoôöuùûü"


def _elider(texte, code, valeur):
    """Substitue [code] par sa valeur, en élidant le mot qui précède s'il le faut.

    ⚠ SANS EXPRESSION RÉGULIÈRE, ET C'EST PLUS SÛR ICI. Le mot cherché doit
    être un mot ENTIER : « grande [raison] » ne doit pas devenir
    « grand'un imprévu ». La borne à gauche est donc l'espace, ou le début du
    texte — deux cas nommés, qu'on relit sans décoder.
    """
    if valeur and valeur[0].lower() in _VOYELLES:
        for mot, forme in _ELIDABLES.items():
            for source, cible in ((mot, forme),
                                  (mot.capitalize(), forme.capitalize())):
                marque = source + " [" + code + "]"
                texte = texte.replace(" " + marque, " " + cible + valeur)
                if texte.startswith(marque):
                    texte = cible + valeur + texte[len(marque):]
    return texte.replace("[" + code + "]", valeur)


def _remplir(texte, infos, types, preferences):
    """Remplace les [variables] d'étape ② par leur valeur, dates lisibles.

    Les variables PAR CONTACT restent en crochets : elles sont remplies à
    l'appel, contact par contact.
    """
    code_langue = mod_langue.de_preferences(preferences)
    for code, valeur in infos.items():
        valeur = (valeur or "").strip()
        if valeur:
            texte = _elider(texte, code,
                            _valeur_lisible(valeur, types.get(code, "texte"),
                                            code_langue))
    return texte.replace("[plage_rappel]",
                         themes.plage_lisible(preferences, code_langue))


_PHRASES = re.compile(r"[^.!?]*[.!?]\s*|[^.!?]+$")
_VARIABLE = re.compile(r"\[[^\]\n]+\]")


def _sans_phrases_incompletes(texte):
    """Retire les phrases où une variable est restée sans valeur.

    Appliqué au moment de l'appel : l'agent ne lit jamais un [crochet] vide
    (un champ facultatif non rempli fait simplement tomber sa phrase).
    """
    gardees = [phrase for phrase in _PHRASES.findall(texte)
               if not _VARIABLE.search(phrase)]
    resultat = "".join(gardees).strip()
    return resultat or _VARIABLE.sub("", texte).strip()


def finaliser_mission(mission, contact, champs, langue_code="fr"):
    """Substitue [identite] et les champs du contact — appelé PAR APPEL.

    champs : les définitions de colonnes de la campagne (pour connaître le
    type de chaque champ). Jamais de numéro de téléphone dans le texte :
    la colonne « telephone » n'est volontairement PAS substituée.
    """
    texte = mission.replace("[identite]", contact["nom"])
    valeurs = champs_contact(contact)
    for champ in champs:
        if champ["code"] in ("identite", "telephone"):
            continue
        valeur = (valeurs.get(champ["code"]) or "").strip()
        if valeur:
            texte = texte.replace(
                f"[{champ['code']}]",
                _valeur_lisible(valeur, champ["type"], langue_code))
    return _sans_phrases_incompletes(texte)


# ------------------------------------------------- la consigne en 3 parties
# Ce que le gabarit produit est la PRÉSENTATION — le seul passage dit mot
# pour mot. Autour d'elle, la consigne porte l'OBJECTIF, les FAITS UTILES,
# les CONTRAINTES et les TROIS ISSUES fermées : voir le module consigne, et
# la décision du propriétaire citée en tête de ce fichier-là.
#
# Les faits utiles ne sont écrits nulle part deux fois : ils sont dérivés des
# informations de l'étape 2 et des colonnes de contact déjà déclarées dans
# NATURES. Ajouter une information à une nature l'ajoute donc du même coup à
# ce que l'agent sait — impossible de les laisser diverger.
_PARENTHESES = re.compile(r"\s*\([^)]*\)")


def _libelle_court(libelle):
    """« Rendez-vous existant (date + heure) » devient « Rendez-vous existant ».

    Les parenthèses d'un formulaire aident à REMPLIR le champ ; dictées à
    l'agent, elles ne feraient que l'encombrer.
    """
    return " ".join(_PARENTHESES.sub("", libelle or "").split()).strip(" :⛔")


def faits_segments(nature, champs=None):
    """Les lignes de « ce que tu sais », en segments conditionnels.

    Même grammaire que le gabarit : un segment est un texte, ou un
    dictionnaire {"texte", "si" / "si_valeur" / "si_option"}. Les conditions
    se cumulent (ET), exactement comme l'aperçu vivant les évalue.

    - « si »        : l'information est renseignée (« non » compte pour vide) ;
    - « si_valeur » : l'information porte une valeur, « non » compris — c'est
      le cas des choix oui/non, dont le « non » est lui-même un fait ;
    - « si_option » : la case à cocher correspondante est cochée.

    Le TÉLÉPHONE n'entre jamais dans cette liste : c'est la règle du
    produit, et elle est vérifiée par les essais.
    """
    definition = NATURES[nature]
    lignes = [{"texte": "Personne appelée : [identite]."}]
    for info in definition["infos"]:
        segment = {"texte": f"{_libelle_court(info['libelle'])} : "
                            f"[{info['code']}]."}
        if info["type"] == "oui_non":
            segment["si_valeur"] = info["code"]
        elif not info["obligatoire"]:
            # Une information facultative laissée vide ne devient pas une
            # ligne rouge : elle disparaît, comme sa phrase dans le message.
            segment["si"] = info["code"]
        if info.get("sous_option"):
            segment["si_option"] = info["sous_option"]
        lignes.append(segment)
    for champ in (champs if champs is not None
                  else champs_campagne({"champs": definition["champs"]})):
        if champ["code"] in ("identite", "telephone"):
            continue
        lignes.append({"texte": f"{_libelle_court(champ['libelle'])} : "
                                f"[{champ['code']}]."})
    return lignes


def _fait_retenu(segment, infos, options):
    """Ce segment de faits entre-t-il dans la consigne ? (conditions ET)."""
    if segment.get("si_option") and not options.get(segment["si_option"]):
        return False
    brut = (infos.get(segment.get("si_valeur")) or "").strip()
    if segment.get("si_valeur") and not brut:
        return False
    valeur = (infos.get(segment.get("si")) or "").strip()
    if segment.get("si") and (not valeur or valeur == "non"):
        return False
    return True


def _mot_place(preferences):
    """« place » ou « slot », selon la langue — l'énumération des places.

    Une ligne à part parce qu'elle est fabriquée AU MILIEU d'un assemblage :
    « place 1 — lundi… ; place 2 — mardi… ». Le mot seul ne peut pas vivre
    dans le dictionnaire des phrases, il n'en est pas une.
    """
    return mod_langue.traducteur(
        mod_langue.de_preferences(preferences))("place")


def construire_consigne(nature, infos, preferences, options=None, champs=None,
                        presentation=None, genre=None, places=()):
    """LA CONSIGNE de l'étape 2 — les trois parties, telles qu'elles partiront.

    presentation : le message d'ouverture ; par défaut celui du gabarit,
    mais l'appelant passe le texte RÉCRIT À LA MAIN quand il y en a un —
    c'est lui qui part alors, mot pour mot, sans être retouché.

    Les variables PAR CONTACT ([identite], [rdv_existant]…) restent en place :
    c'est ce qui permet à l'aperçu de montrer où elles seront remplies, et à
    finaliser_consigne de les remplir au moment de l'appel.

    places : les places qu'UN MÊME APPEL énumère, quand il y en a plus d'une.
    Elles entrent ici — dans le chemin partagé — et pas chez l'appelant :
    sinon l'aperçu de l'étape 2 tairait la seule ligne qui change, et
    l'opérateur ne verrait pas que son appel en propose trois.
    """
    definition = NATURES[nature]
    options = options or {}
    if champs is None:
        champs = champs_campagne({"champs": definition["champs"]})
    if presentation is None:
        presentation = construire_mission(nature, infos, preferences, options)
    genre_nature = definition.get("genre", consigne.GENRE_CLASSIQUE)
    if genre is None:
        genre = genre_nature
    # Le schéma de résultat décide du champ à renseigner : si l'appel ne
    # part pas avec le schéma de cette nature, on ne peut plus lui dicter ses
    # codes — on retombe sur les issues générales, qui sont valables partout.
    issues = (definition["issues"] if genre == genre_nature
              else (consigne.ISSUES_DEFAUT_CASCADE
                    if genre == consigne.GENRE_CASCADE
                    else consigne.ISSUES_DEFAUT))
    types = {info["code"]: info["type"] for info in definition["infos"]}
    faits = [segment["texte"] for segment in faits_segments(nature, champs)
             if _fait_retenu(segment, infos, options)]

    def substituer(texte):
        for code, valeur in infos.items():
            valeur = (valeur or "").strip()
            if valeur:
                texte = texte.replace(
                    f"[{code}]",
                    _valeur_lisible(valeur, types.get(code, "texte"),
                                    code_langue))
        return texte

    # ⚠ PLUSIEURS PLACES DANS LE MÊME APPEL (03/08/2026). On les NUMÉROTE
    # dans les faits — c'est du texte libre, le contrat de l'API n'y touche
    # pas — et l'on dicte à l'agent d'écrire dans « new_datetime » celle qui
    # a été retenue : c'est le SEUL canal par lequel une date revient.
    #
    # ⚠ CASCADE SEULEMENT. Sur le genre classique, une date sur « confirmed »
    # est encore refusée par le contrôle de la réponse : dicter cela
    # reviendrait à demander à l'agent une réponse que le produit rejette.
    places = [place for place in (places or []) if place]
    if genre == consigne.GENRE_CASCADE and len(places) > 1:
        faits = faits + [
            mod_langue.traducteur(mod_langue.de_preferences(preferences))(
                "Plusieurs places sont libres, propose-les dans cet ordre :")
            + " "
            + " ; ".join(
                f"{_mot_place(preferences)} {rang} — "
                f"{themes.date_parlee(place, mod_langue.de_preferences(preferences))}"
                for rang, place in enumerate(places, start=1))
            + mod_langue.traducteur(mod_langue.de_preferences(preferences))(
                ". Une seule sera retenue.")]
        issues = dict(issues)
        issues["oui"] = dict(issues["oui"],
                             quand="la personne retient UNE des places "
                                   "proposées",
                             date="obligatoire")
    # ⚠ LA LANGUE SE LIT DANS LES RÉGLAGES, ICI. Elle n'est pas passée en
    # paramètre : ce serait la faire traverser toute la chaîne d'appels (le
    # serveur, la file, les relances, la cascade) pour une valeur GLOBALE à
    # l'installation. `preferences` est déjà là, et c'est elle qui la porte.
    code_langue = mod_langue.de_preferences(preferences)
    dire = mod_langue.traducteur(code_langue)
    plage = themes.plage_lisible(preferences, code_langue)
    # ⚠ ET LE REPLI EST TRADUIT ICI AUSSI. Les contraintes et la conduite sont
    # substituées AVANT `Consigne.texte()` : corriger le repli là-bas ne
    # suffisait pas, « l'établissement » était déjà écrit dans les lignes.
    # Deux endroits substituent, les deux doivent connaître la langue.
    entreprise = (infos.get("entreprise")
                  or preferences.obtenir(themes.CLE_ENTREPRISE)
                  or dire(consigne.ENTREPRISE_INCONNUE))
    cadre = [consigne.substituer_cadre(dire(ligne), entreprise, plage)
             for ligne in consigne.CONTRAINTES]
    # ⚠ LA CONDUITE PASSE PAR `substituer_cadre` COMME LES CONTRAINTES : elle
    # nomme [entreprise] dans sa phrase de sortie (« une personne de … va vous
    # rappeler »). Sans cela, le client entendrait le mot « entreprise ».
    conduite = [consigne.substituer_cadre(substituer(dire(ligne)),
                                          entreprise, plage)
                for ligne in definition.get("conduite", ())]
    # Les issues portent une phrase lisible (« quand ») : c'est elle qui est
    # dite, le code à côté ne l'est pas.
    issues = {cle: dict(fixee, quand=dire(fixee["quand"]))
              for cle, fixee in issues.items()}
    return consigne.Consigne(
        substituer(presentation).replace("[plage_rappel]", plage),
        dire(definition["objectif"]),
        [substituer(dire(ligne)) for ligne in faits],
        cadre, issues, genre,
        consigne.substituer_cadre(dire(consigne.ENTETE), entreprise, plage),
        conduite, dire,
        mod_langue.civilites_de(code_langue, consigne._DEVELOPPE))


def finaliser_consigne(cadre, contact, champs, presentation=None,
                       langue_code="fr"):
    """Remplit les variables DE CE CONTACT — appelée par appel, comme la mission.

    Le numéro de téléphone n'est volontairement PAS substitué : il ne figure
    dans aucune ligne, et il ne doit apparaître nulle part dans ce qui est
    dicté à l'agent.
    """
    valeurs = {"identite": contact["nom"]}
    donnees = champs_contact(contact)
    for champ in champs:
        if champ["code"] in ("identite", "telephone"):
            continue
        valeur = (donnees.get(champ["code"]) or "").strip()
        if valeur:
            valeurs[champ["code"]] = _valeur_lisible(
                valeur, champ["type"], langue_code)
    if presentation is None:
        presentation = finaliser_mission(cadre.presentation, contact,
                                         champs, langue_code)
    return cadre.substituer(valeurs, presentation=presentation)


# Combien de places au plus dans un seul appel. Trois : au 8e essai réel, à
# qui lui demandait simplement de RÉPÉTER une date, l'agent a répondu « je
# préfère ne pas vous dire de bêtise » et a raccroché. Énumérer, faire
# choisir, puis reformuler est plus dur que répéter — on ne lui en demande
# pas dix.
PLACES_ANNONCEES_MAX = 3


def places_annoncees(campagne, configuration=None):
    """Les places qu'on fait annoncer dans CET appel — la première d'abord.

    Une campagne à une seule place n'en annonce qu'une : rien ne change pour
    elle, et le contrôle de la réponse reste celui d'avant.
    """
    if configuration is None:
        configuration = configuration_campagne(campagne)
    # ⚠ UNE PLACE PERDUE N'EST PLUS ANNONCÉE, MÊME SANS LISTE (14/08/2026).
    # La campagne à une seule place lisait sa colonne `creneau` sans regarder
    # ce qu'était devenue cette place : une fois prise ailleurs, elle
    # continuait d'être proposée à tout le monde. Voir
    # `_perdre_la_place_si_prise` — vingt-quatre refus d'affilée, mesurés.
    restantes = [f["horaire"] for f in creneaux_de(campagne, configuration)
                 if f.get("statut") == CRENEAU_A_POURVOIR]
    if not configuration.get("liste_de_places"):
        return restantes[:1]
    return restantes[:PLACES_ANNONCEES_MAX]


def places_du_brouillon(brouillon):
    """Les places que l'étape 2 fera annoncer — pour que l'aperçu les montre.

    ⚠ LA CAMPAGNE N'EXISTE PAS ENCORE à l'étape 2 : la liste vit dans le
    brouillon, et `places_annoncees` ne sait lire qu'une campagne. Sans cette
    lecture-ci, l'aperçu aurait tu la seule ligne que le lot 9 ajoute.
    """
    liste = normaliser_creneaux(brouillon.get("creneaux") or [])
    libres = [fiche["horaire"] for fiche in liste
              if fiche.get("statut") == CRENEAU_A_POURVOIR]
    return libres[:PLACES_ANNONCEES_MAX]


def place_retenue(resultat, annoncees, creneau_courant):
    """La place que la personne a prise — ou None si rien n'est exploitable.

    ⚠ UNE DATE RENDUE DOIT FIGURER PARMI CELLES ANNONCÉES. Ce contrôle
    n'existait nulle part : sans lui, une date inventée ou mal comprise au
    téléphone serait réservée telle quelle. Quand la date ne correspond à
    rien, on ne devine pas — l'appelant traitera cela comme un refus de
    date, et un humain rappellera.

    Sans date rendue, c'est la place en cours : c'est le comportement
    d'avant, et il reste juste tant qu'une seule place est annoncée.
    """
    brut = (resultat or {}).get("new_datetime")
    if not brut:
        return creneau_courant
    for place in annoncees:
        if place == brut:
            return place
    return None


def infos_sur_la_place_en_cours(campagne, configuration):
    """Les informations d'étape 2, avec le créneau de la place EN COURS.

    ⚠ LA COLONNE FAIT FOI, PAS LA CONFIGURATION (01/09/2026). Une campagne à
    liste de places avance de place en place : `campagnes.creneau` suit le
    curseur — c'est écrit noir sur blanc dans `db.definir_creneau_campagne` —
    tandis que les informations d'étape 2 sont écrites une fois pour toutes à
    la création. Quand les deux divergent, la consigne annonce DEUX dates pour
    une seule place : la présentation dit l'une, « ce que tu sais » dit
    l'autre.

    CE QUE ÇA A DONNÉ, sur sa campagne n°133 (01/09/2026) : le premier contact
    prend la place, la campagne avance sur la suivante, et CALL-E refuse
    l'appel suivant par un 422 dont le message est une question :

        « Quelle est la bonne date du créneau libéré à proposer à madame
          Émilie Aubry ? »

    ⚠ DEUX VERROUS PLUTÔT QU'UN, ET C'EST VOULU. `avancer_sur_la_place_suivante`
    écrit désormais la configuration recalée — c'est la correction de fond.
    Celui-ci ferme au point de LECTURE : il répare aussi les campagnes DÉJÀ
    enregistrées de travers, sans toucher à leurs données. Une campagne
    interrompue par ce défaut repart donc juste, sans qu'on ait à la refaire.
    """
    infos = dict(configuration.get("infos") or {})
    code = INFO_CRENEAU_PAR_NATURE.get((campagne or {}).get("nature"))
    en_cours = (campagne or {}).get("creneau")
    if code and en_cours:
        infos[code] = en_cours
    return infos


def consigne_de_l_appel(base, preferences, campagne, configuration, contact,
                        mission, en_cascade, adaptee=None):
    """LA CONSIGNE EXACTE qui part pour CE contact — rien de plus, rien de moins.

    Un seul chemin : l'aperçu de l'étape 2, l'appel réel et les essais
    passent tous par construire_consigne. Ce qui est montré est donc ce qui
    part.

    mission : le message d'ouverture DÉJÀ finalisé par l'appelant (variables
    du contact remplacées, créneaux recalculés à l'instant de l'appel) — les
    lignes de faits reçoivent ici le même traitement, pour qu'elles ne
    puissent pas annoncer une place que le message n'annonce plus.
    """
    champs = champs_campagne(configuration)
    genre = (consigne.GENRE_CASCADE if en_cascade
             else consigne.GENRE_CLASSIQUE)
    cadre = construire_consigne(campagne["nature"],
                                infos_sur_la_place_en_cours(campagne,
                                                            configuration),
                                preferences, configuration["options"], champs,
                                presentation=campagne["mission"], genre=genre,
                                places=places_annoncees(campagne,
                                                        configuration))
    finale = finaliser_consigne(
        cadre, contact, champs, presentation=mission,
        langue_code=mod_langue.de_preferences(preferences))
    finale.faits = [creneaux_adaptes_au_contact(base, preferences,
                                                configuration, contact, ligne,
                                                adaptee=adaptee,
                                                campagne=campagne)
                    for ligne in finale.faits]
    return finale


def champs_contact(contact):
    """Les valeurs de champs d'un contact de campagne (colonne JSON)."""
    brut = contact.get("champs")
    if not brut:
        return {}
    if isinstance(brut, dict):
        return brut
    try:
        valeurs = json.loads(brut)
    except (TypeError, ValueError):
        return {}
    return valeurs if isinstance(valeurs, dict) else {}


# --------------------------------------------- remplissage de la grille
def format_collage(champs):
    """Le format attendu d'une ligne collée, colonnes facultatives comprises.

    « Nom;Téléphone;Rendez-vous existant ⛔;Motif ⛔;Numéro de dossier
    (facultatif) » — sert à la fois d'aide à l'écran ET de message d'erreur :
    on dit toujours ce qui était attendu, pas seulement ce qui cloche.
    """
    colonnes = [c for c in champs if c["code"] not in ("identite", "telephone")]
    morceaux = ["Nom", "Téléphone"]
    for colonne in colonnes:
        marque = " ⚠" if colonne["obligatoire"] else " (facultatif)"
        morceaux.append(colonne["libelle"] + marque)
    return ";".join(morceaux)


def exemple_collage(champs):
    """Une ligne d'EXEMPLE au format attendu — repère, jamais une donnée.

    Affichée en filigrane dans la zone de collage (elle n'est pas envoyée :
    un exemple pré-rempli créerait un faux contact au premier clic).
    """
    colonnes = [c for c in champs if c["code"] not in ("identite", "telephone")]
    # Numéro d'exemple pris dans une racine que l'Arcep réserve à la fiction
    # (06 39 98 …) : il ne peut appartenir à personne, et il reste distinct
    # des numéros d'essai du produit. Un numéro « plausible » serait pris pour
    # une vraie fuite par le contrôle de publication — à juste titre.
    morceaux = ["Mme Dupont Martine", "+33 6 39 98 12 34"]
    for colonne in colonnes:
        if colonne["type"] == "date":
            morceaux.append("15/08/2026 09:30")
        else:
            morceaux.append(colonne["libelle"].lower())
    return ";".join(morceaux)


def analyser_collage(texte, champs, telephones_connus=(), numero_essai=""):
    """Analyse un collage multi-colonnes « Nom;Téléphone[;champs…] ».

    champs : les colonnes de la campagne (l'ordre du collage = l'ordre des
    colonnes après Identité et Téléphone). Réutilise les validateurs de
    saisie.py — mêmes erreurs françaises ligne à ligne, mêmes séparateurs
    tolérés (tabulation, point-virgule, virgule), mêmes doublons signalés.
    Rend (contacts, erreurs, refusees) — contacts = [{"nom", "telephone",
    "champs"}] et refusees = les lignes du collage qui n'ont RIEN donné,
    telles quelles : l'écran les réaffiche pour correction, sans réafficher
    celles déjà entrées dans la grille (sinon elles feraient doublon).

    numero_essai : le numéro — ou la LISTE des numéros — déclarés par
    l'opérateur dans ⚙ Réglages comme étant ceux de ses TESTEURS (le sien,
    celui d'un collègue, d'un ami ; module essai_reel), ou "" / []. Ces
    numéros-là — et eux seuls — peuvent revenir plusieurs fois, avec des
    identités différentes : c'est ce qui permet d'éprouver une campagne
    entière sur des téléphones connus. Le garde-fou reste ENTIER pour tous
    les autres numéros ; sans numéro déclaré, personne n'est exempté.
    """
    colonnes = [c for c in champs if c["code"] not in ("identite", "telephone")]
    attendu = format_collage(champs)
    contacts, erreurs, refusees = [], [], []
    deja_vus = {t: "un contact déjà dans la grille" for t in telephones_connus}
    for numero, ligne in enumerate((texte or "").splitlines(), start=1):
        if not ligne.strip():
            continue
        for separateur in ("\t", ";", ","):
            if separateur in ligne:
                break
        else:
            erreurs.append(f"Ligne {numero} : aucun séparateur trouvé "
                           "(point-virgule, virgule ou tabulation) — attendu "
                           f"« {attendu} ».")
            refusees.append(ligne)
            continue
        morceaux = [morceau.strip() for morceau in ligne.split(separateur)]
        if len(morceaux) < 2:
            erreurs.append(f"Ligne {numero} : {len(morceaux)} colonne reçue, "
                           f"2 au minimum — attendu « {attendu} ».")
            refusees.append(ligne)
            continue
        # Colonnes obligatoires absentes : on SIGNALE en disant ce qui était
        # attendu, mais on garde la ligne — elle se complète dans la grille
        # (la validation, elle, refusera tant qu'un ⛔ reste vide).
        manquantes = [c["libelle"] for c in colonnes[len(morceaux) - 2:]
                      if c["obligatoire"]]
        if manquantes:
            erreurs.append(f"Ligne {numero} : il manque "
                           f"{', '.join(manquantes)} — attendu "
                           f"« {attendu} » ; la ligne est ajoutée, à compléter "
                           "dans la grille.")
        if len(morceaux) > 2 + len(colonnes):
            erreurs.append(f"Ligne {numero} : {len(morceaux)} colonnes reçues, "
                           f"{2 + len(colonnes)} au maximum — attendu "
                           f"« {attendu} ».")
            refusees.append(ligne)
            continue
        try:
            nom = saisie.valider_nom(morceaux[0])
            telephone = saisie.valider_telephone(morceaux[1])
        except SaisieInvalide as erreur:
            erreurs.append(f"Ligne {numero} : {erreur}")
            refusees.append(ligne)
            continue
        valeurs, fautive = {}, False
        for colonne, brut in zip(colonnes, morceaux[2:]):
            brut = brut.strip()
            if not brut:
                continue
            if colonne["type"] == "date":
                try:
                    brut = saisie.valider_horaire(brut)
                except SaisieInvalide as erreur:
                    erreurs.append(f"Ligne {numero}, colonne "
                                   f"« {colonne['libelle']} » : {erreur}")
                    fautive = True
                    break
            valeurs[colonne["code"]] = brut
        if fautive:
            refusees.append(ligne)
            continue
        if telephone in deja_vus and not db.est_numero_essai(telephone,
                                                             numero_essai):
            erreurs.append(f"Ligne {numero} : même numéro que "
                           f"{deja_vus[telephone]} — doublon ignoré.")
            continue        # doublon : inutile de le faire recorriger
        deja_vus[telephone] = f"la ligne {numero}"
        contacts.append({"nom": nom, "telephone": telephone, "champs": valeurs})
    if not contacts and not erreurs:
        erreurs.append("Liste vide : collez une ligne par personne — attendu "
                       f"« {attendu} ».")
    return contacts, erreurs, refusees


def analyser_csv(octets, champs, telephones_connus=(), numero_essai=""):
    """Un fichier CSV pour la grille : mêmes colonnes que le collage.

    Réutilise le décodage tolérant de saisie.py (UTF-8 puis cp1252) ; une
    ligne d'en-tête (« nom;telephone… ») est reconnue et sautée. Rend
    (contacts, erreurs) : les lignes refusées ne sont pas réaffichées ici,
    le fichier reste sur le disque de l'utilisateur.

    numero_essai : voir analyser_collage — seul le numéro d'essai déclaré
    échappe au refus de doublon, tous les autres y restent soumis.
    """
    texte = saisie.decoder_csv(octets)
    lignes = texte.splitlines()
    for indice, ligne in enumerate(lignes):
        if ligne.strip():
            premiere = ligne.split(";")[0].split(",")[0].split("\t")[0]
            if premiere.strip().lower() in ("nom", "identite", "identité"):
                lignes = lignes[:indice] + lignes[indice + 1:]
            break
    contacts, erreurs, _ = analyser_collage("\n".join(lignes), champs,
                                            telephones_connus, numero_essai)
    return contacts, erreurs


def contacts_depuis_ics(base, octets, champs, telephones_connus=()):
    """Un agenda ICS pour la grille — réutilise ics.analyser_ics.

    Le titre « Nom — Motif » remplit la colonne motif (si elle existe), la
    date remplit la colonne rendez-vous existant (si elle existe). Le
    numéro est cherché d'abord DANS l'agenda lui-même (CONTACT, ATTENDEE
    en « tel: », DESCRIPTION… — voir l'en-tête de ics.py), puis à défaut
    chez les clients connus ; sinon le contact reste SANS numéro, listé
    « à compléter avant validation » — jamais de numéro inventé. Rend
    (contacts, sans_numero, erreurs).
    """
    from . import ics as module_ics
    evenements, erreurs = module_ics.analyser_ics(saisie.decoder_csv(octets))
    codes = {c["code"] for c in champs}
    contacts, sans_numero = [], 0
    deja_vus = set(telephones_connus)
    for evenement in evenements:
        telephone = (evenement.get("telephone")
                     or base.telephone_par_nom(evenement["nom"]) or "")
        if telephone and telephone in deja_vus:
            continue
        if telephone:
            deja_vus.add(telephone)
        else:
            sans_numero += 1
        valeurs = {}
        if "motif" in codes:
            valeurs["motif"] = evenement["motif"]
        if "rdv_existant" in codes:
            valeurs["rdv_existant"] = evenement["horaire"]
        contacts.append({"nom": evenement["nom"], "telephone": telephone,
                         "champs": valeurs})
    return contacts, sans_numero, erreurs


def libelle_periode(periode):
    """« semaine 33 — du 10/08 au 16/08 » ou « mardi 11/08 », pour l'écran."""
    if not periode or not periode.get("semaine"):
        return "toutes les dates"
    if periode.get("jour"):
        jour = datetime.date.fromisoformat(periode["jour"])
        return f"{horaires.JOURS[jour.weekday()]} {jour:%d/%m/%Y}"
    return horaires.libelle_semaine(periode["annee"], periode["semaine"])


# ------------- un rendez-vous DÉJÀ CONFIRMÉ n'entre pas dans une confirmation
# ⚠ SA DEMANDE DU 20/08/2026 : « n'importer que les contacts dont les
# rendez-vous n'ont pas été confirmés ».
#
# Une campagne de confirmation demande « serez-vous présent ? ». Le poser à
# quelqu'un qui a DÉJÀ répondu, c'est le rappeler pour rien — et cela coûte un
# appel à chaque fois. Mesuré le 20/08 : il sélectionne une matinée, un des
# rendez-vous est confirmé, la campagne l'appelle quand même.
#
# ⚠ CE N'EST PAS UN REFUS, C'EST UN ÉCART DIT EN CLAIR. Le nombre part avec la
# liste jusqu'à l'écran : sans cela, il compterait ses rendez-vous et n'en
# retrouverait pas le compte — exactement le défaut n° 7 du 18/08.
def ecarter_les_deja_confirmes(base, nature, contacts):
    """(gardés, nombre d'écartés) — n'écarte QUE sur une confirmation.

    ⚠ UN SEUL ENDROIT, PARCE QU'IL Y A TROIS VOIES D'IMPORT : la plage du
    planning, le bouton « importer » de l'étape ③ (collage, CSV, agenda, base,
    états, campagne précédente) et la règle automatique rejouée à chaque place.
    Trois filtres séparés auraient fini par diverger.

    Un contact sans rendez-vous connu est GARDÉ : on ne devine pas qu'il est
    confirmé, et l'écarter reviendrait à le perdre en silence.
    """
    if nature != "confirmation":
        return list(contacts), 0
    gardes, ecartes = [], 0
    for contact in contacts:
        rdv = _rendezvous_vise(base, contact, contact.get("telephone", ""))
        if rdv is not None and rdv["statut"] == "confirmé":
            ecartes += 1
            continue
        gardes.append(contact)
    return gardes, ecartes


def phrase_deja_confirmes(ecartes):
    """La phrase à afficher, ou "" s'il n'y a rien à dire."""
    if not ecartes:
        return ""
    return (f"{ecartes} rendez-vous déjà confirmé(s) écarté(s) — les "
            "rappeler pour confirmer n'apporterait rien")


def contacts_depuis_base(base, source, champs, telephones_connus=(),
                         debut=None, fin=None):
    """Remplit la grille depuis la base — réutilise les briques existantes.

    « a_venir » et « manques » passent par campagnes.contacts_depuis_rendezvous
    (le rendez-vous concerné remplit ses colonnes) ; « annules », « deplaces »
    et « tous » passent par base.candidats_cascade (comme la génération de
    liste). Rend (contacts, complements) — complements = messages français.

    `debut` / `fin` (texte ISO) bornent la période des RENDEZ-VOUS. Ils ne
    valent que pour les deux sources qui en ont : « annulés », « déplacés »
    et « tous les clients » n'ont pas de date à filtrer, et le dire vaut
    mieux que de les filtrer sur autre chose (02/08/2026).
    """
    if source not in SOURCES_BASE:
        raise SaisieInvalide(f"Source inconnue : « {source} ».")
    if (debut or fin) and source not in SOURCES_DATEES:
        raise SaisieInvalide(
            "Une période ne s'applique qu'aux rendez-vous à venir ou "
            f"manqués — « {SOURCES_BASE[source]} » n'en a pas.")
    codes = {c["code"] for c in champs}
    complements = []
    contacts = []
    deja_vus = set(telephones_connus)
    if source in SOURCES_DATEES:
        base.marquer_manques_echus()
        statut = STATUT_PAR_SOURCE_DATEE[source]
        bruts, sans_numero, exclus_stop = campagnes.contacts_depuis_rendezvous(
            base, statut, debut, fin)
        if sans_numero:
            complements.append(f"{sans_numero} client(s) sans numéro écarté(s)")
        if exclus_stop:
            complements.append(f"{exclus_stop} client(s) 🚫 « Ne plus appeler » "
                               "écarté(s)")
        deja_dans_la_grille = 0
        for brut in bruts:
            if brut["telephone"] in deja_vus:
                deja_dans_la_grille += 1
                continue
            deja_vus.add(brut["telephone"])
            valeurs = {}
            rdv = base.obtenir_rendezvous(brut["rendezvous_id"])
            if rdv:
                if "rdv_existant" in codes:
                    valeurs["rdv_existant"] = rdv["horaire"]
                if "motif" in codes:
                    valeurs["motif"] = rdv["motif"]
            contacts.append({"nom": brut["nom"], "telephone": brut["telephone"],
                             "champs": valeurs,
                             "rendezvous_id": brut["rendezvous_id"]})
        complements.extend(_note_deja_dans_la_grille(deja_dans_la_grille))
    else:
        candidats, exclus, exclus_stop = base.candidats_cascade(source)
        if exclus:
            complements.append(f"{exclus} client(s) sans numéro écarté(s)")
        # ⚠ LE 🚫 ÉTAIT RETIRÉ EN SILENCE ICI (14/08/2026, audit croisé). La
        # requête l'écarte (« AND c.ne_plus_appeler = 0 ») et personne ne le
        # comptait : l'écran annonçait « 123 contacts ajoutés » quand la base
        # en avait 138, et cinq personnes disparaissaient sans un mot. La
        # branche datée juste au-dessus, elle, le disait depuis le début.
        if exclus_stop:
            complements.append(f"{exclus_stop} client(s) 🚫 « Ne plus appeler » "
                               "écarté(s)")
        deja_dans_la_grille = 0
        for candidat in candidats:
            if candidat["telephone"] in deja_vus:
                deja_dans_la_grille += 1
                continue
            deja_vus.add(candidat["telephone"])
            contacts.append({"nom": candidat["nom"],
                             "telephone": candidat["telephone"], "champs": {}})
        complements.extend(_note_deja_dans_la_grille(deja_dans_la_grille))
    return contacts, complements


def _note_deja_dans_la_grille(combien):
    """La phrase des contacts écartés parce qu'ILS Y ÉTAIENT DÉJÀ.

    ⚠ L'ÉCART TROUVÉ PAR L'AUDIT DU 14/08/2026, et il touche les cinq natures.
    Charger deux fois la même source — ou deux sources qui se recouvrent, comme
    « rendez-vous posés » et « rendez-vous à venir » — écartait les doublons
    SANS un mot. La grille ne bougeait pas, aucun complément n'était rendu, et
    l'écran concluait « Aucun contact trouvé depuis cette source » : c'était
    faux, la source en contenait vingt, tous déjà là. L'opérateur changeait de
    source, ou croyait sa base vide.
    """
    if not combien:
        return []
    return [f"{combien} contact(s) déjà dans la grille — pas ajouté(s) une "
            "seconde fois"]


def campagnes_reprenables(base):
    """Les campagnes dont on peut repartir : [(id, libellé, comptes)].

    Une campagne n'est reprenable que si elle a des contacts — sinon il n'y
    a rien à en tirer et elle n'encombre pas la liste déroulante. Le libellé
    porte déjà son nombre total, pour que le choix se fasse en connaissance
    de cause.
    """
    reprenables = []
    for campagne in base.lister_campagnes():
        comptes = base.compter_contacts_par_etat(campagne["id"])
        if not comptes["tous"]:
            continue
        reprenables.append((campagne["id"],
                            f"n°{campagne['id']} — {campagne['nom']} "
                            f"({comptes['tous']} contact(s))",
                            comptes))
    return reprenables


def contacts_depuis_campagne(base, campagne_id, etat, champs,
                             telephones_connus=()):
    """Reprend les contacts d'une campagne PRÉCÉDENTE, filtrés par état.

    C'est la réutilisation des résultats déjà enregistrés : une campagne
    de rattrapage se construit à partir des 📵 injoignables de la veille,
    des ❌ refus, des 🙋 « à rappeler par un humain »… Les colonnes déjà
    remplies (motif, rendez-vous existant, champs personnalisés) suivent
    quand la nouvelle campagne a les mêmes colonnes. Rend (contacts,
    complements) — complements = messages français comptant les écartés.
    """
    if etat not in ETATS_REPRISE:
        raise SaisieInvalide(f"État de reprise inconnu : « {etat} ».")
    campagne = base.obtenir_campagne(campagne_id)
    if campagne is None:
        raise SaisieInvalide(f"Campagne n°{campagne_id} introuvable.")
    codes = {c["code"] for c in champs}
    contacts, complements = [], []
    deja_vus = set(telephones_connus)
    sans_numero = exclus_stop = doublons = 0
    for brut in base.contacts_campagne_en_clair(campagne_id, etat):
        telephone = brut["telephone"] or ""
        if not telephone:
            sans_numero += 1
            continue
        if base.telephone_exclu(telephone):
            exclus_stop += 1
            continue
        if telephone in deja_vus:
            doublons += 1
            continue
        deja_vus.add(telephone)
        anciens = json.loads(brut["champs"]) if brut["champs"] else {}
        valeurs = {code: valeur for code, valeur in anciens.items()
                   if code in codes}
        if "rdv_existant" in codes and not valeurs.get("rdv_existant"):
            rdv = (base.obtenir_rendezvous(brut["rendezvous_id"])
                   if brut["rendezvous_id"] else None)
            if rdv:
                valeurs["rdv_existant"] = rdv["horaire"]
                if "motif" in codes and not valeurs.get("motif"):
                    valeurs["motif"] = rdv["motif"]
        contacts.append({"nom": brut["nom"], "telephone": telephone,
                         "champs": valeurs,
                         "rendezvous_id": brut["rendezvous_id"]})
    if sans_numero:
        complements.append(f"{sans_numero} contact(s) sans numéro écarté(s)")
    if exclus_stop:
        complements.append(f"{exclus_stop} contact(s) 🚫 « Ne plus appeler » "
                           "écarté(s)")
    if doublons:
        complements.append(f"{doublons} déjà dans la grille, non redoublé(s)")
    return contacts, complements


# ------------------------------------------------ la RECETTE d'une campagne
# De quoi REJOUER une campagne sur un AUTRE créneau (§8.3). Une campagne
# garde donc, en plus de son résultat, les CRITÈRES qui ont rempli sa liste :
# la source de base choisie, la campagne précédente reprise et son filtre.
#
# Une liste tapée ou collée à la main n'a pas de critère : elle n'est PAS
# reproductible, et la cascade s'abstient en le disant plutôt que d'inventer
# une liste. Ajout ADDITIF : une campagne créée avant cette version n'a pas
# de recette du tout — elle vaut « non reproductible », et l'écran le dit.
#
# Le mode « etat » est le CRITÈRE de la porte 👥 Contacts (§4) : « les clients
# dont l'état est X, non traités, que la nature N traite ». Il est
# reproductible comme les deux autres — c'est lui qui fait qu'une campagne
# née d'un filtre d'état peut être rejouée sur un autre créneau.
MODES_RECETTE_REPRODUCTIBLES = ("base", "campagne", "etat")


def recette_vide():
    """La recette d'un brouillon neuf : rien n'a encore rempli la grille."""
    return {"apports": [], "a_la_main": False, "mission_editee": False}


def noter_apport_recette(brouillon, mode, **details):
    """Inscrit d'OÙ vient un lot de personnes ajouté à la grille.

    Les modes reproductibles (base, campagne précédente) sont mémorisés avec
    leurs critères ; tous les autres (collage, CSV, agenda ICS, ligne ajoutée
    à la main) lèvent le drapeau « a_la_main » — la liste ne pourra plus être
    recalculée pour un autre créneau.
    """
    recette = brouillon.setdefault("recette", recette_vide())
    if mode in MODES_RECETTE_REPRODUCTIBLES:
        apport = {"mode": mode}
        apport.update(details)
        if apport not in recette["apports"]:
            recette["apports"].append(apport)
    else:
        recette["a_la_main"] = True
    return recette


def recette_reproductible(recette):
    """Vrai si la liste peut être RECALCULÉE telle quelle sur un autre créneau."""
    recette = recette or {}
    return bool(recette.get("apports")) and not recette.get("a_la_main")


def libelle_recette(recette):
    """La recette en français, pour l'écran — jamais une phrase inventée."""
    recette = recette or {}
    if not recette.get("apports") and not recette.get("a_la_main"):
        return ("inconnue (campagne créée avant que les recettes soient "
                "conservées)")
    morceaux = []
    for apport in recette.get("apports", []):
        if apport["mode"] == "base":
            morceaux.append("depuis la base — « "
                            + SOURCES_BASE.get(apport.get("source", ""),
                                               apport.get("source", "?"))
                            + " »")
        elif apport["mode"] == "campagne":
            morceaux.append(
                f"depuis la campagne n°{apport.get('campagne', '?')} — "
                + ETATS_REPRISE.get(apport.get("etat", "tous"),
                                    apport.get("etat", "?")))
        elif apport["mode"] == "etat":
            # Import DIFFÉRÉ : etats_clients s'appuie sur ce module-ci, on ne
            # peut donc pas le charger en tête de fichier sans boucler.
            from . import etats_clients
            etat = apport.get("etat", "")
            morceau = ("depuis 👥 Contacts — état « "
                       + (etats_clients.libelle_etat(etat) if etat
                          else "tous les états à traiter")
                       + " » non traité, traité par « "
                       + etats_clients.libelle_nature(apport.get("nature", ""))
                       + " »")
            if apport.get("recherche"):
                morceau += f" ; nom contenant « {apport['recherche']} »"
            morceaux.append(morceau)
    if recette.get("a_la_main"):
        morceaux.append("liste choisie à la main (collage, fichier, agenda "
                        "importé, ou rendez-vous désigné dans le planning)")
    return " ; ".join(morceaux) or "aucune source enregistrée"


def contacts_de_recette(base, recette, champs, preferences=None):
    """REJOUE la recette : reconstruit la liste avec les mêmes critères.

    Rend (contacts, complements) — mêmes briques que l'étape 3 de
    l'assistant, jamais une seconde mécanique. Lève SaisieInvalide si un
    critère n'est plus valide (campagne effacée, source inconnue).
    """
    contacts, complements = [], []
    connus = []
    for apport in (recette or {}).get("apports", []):
        if apport.get("mode") == "base":
            lot, notes = contacts_depuis_base(base, apport.get("source", ""),
                                              champs, connus)
        elif apport.get("mode") == "etat":
            # Import DIFFÉRÉ (etats_clients dépend de ce module-ci).
            from . import etats_clients
            lot, notes = etats_clients.contacts_depuis_etat(
                base, apport.get("etat", ""), apport.get("nature", ""),
                champs, connus, recherche=apport.get("recherche", ""),
                preferences=preferences)
        elif apport.get("mode") == "campagne":
            try:
                campagne_id = int(apport.get("campagne"))
            except (TypeError, ValueError):
                raise SaisieInvalide(
                    "la campagne dont la liste était reprise n'est plus "
                    "identifiable.") from None
            lot, notes = contacts_depuis_campagne(
                base, campagne_id, apport.get("etat", "tous"), champs, connus)
        else:
            raise SaisieInvalide(
                f"source de liste inconnue : « {apport.get('mode')} ».")
        contacts.extend(lot)
        complements.extend(notes)
        connus = [c["telephone"] for c in contacts if c["telephone"]]
    return contacts, complements


def resserrer_sur_le_creneau(contacts, creneau, rendezvous_exclus=()):
    """LE POINT QUI FAIT CONVERGER LA CHAÎNE (§8.3).

    « Un créneau n'intéresse que les gens qu'il arrange » : un contact dont
    le rendez-vous est ANTÉRIEUR au créneau proposé n'a rien à y gagner — le
    décaler lui ferait perdre du temps au lieu d'en gagner. Il est donc
    écarté. Un contact dont le rendez-vous est INCONNU l'est aussi : on ne
    peut pas affirmer que ce créneau l'arrange, et rien n'est inventé.
    Enfin le rendez-vous qui vient JUSTE de bouger est écarté : lui proposer
    la place qu'il vient de quitter n'aurait aucun sens.

    Rend (retenus, ecartes) — ecartes compte les trois cas, pour l'écran.
    """
    exclus = {r for r in rendezvous_exclus if r}
    retenus = []
    ecartes = {"anterieurs": 0, "sans_date": 0, "deja_bouge": 0}
    for contact in contacts:
        if contact.get("rendezvous_id") in exclus:
            ecartes["deja_bouge"] += 1
            continue
        date_rdv = (champs_contact(contact).get("rdv_existant") or "").strip()
        if not date_rdv:
            ecartes["sans_date"] += 1
            continue
        if date_rdv < creneau:
            ecartes["anterieurs"] += 1
            continue
        retenus.append(contact)
    return retenus, ecartes


def en_csv(champs, contacts):
    """La grille en CSV (numéros EN CLAIR par nature, généré à la volée,
    jamais écrit côté serveur) — même esprit que generation.en_csv."""
    codes = [c["code"] for c in champs]
    lignes = [";".join(codes)]
    for contact in contacts:
        valeurs = contact.get("champs") or {}
        cellules = [contact["nom"], contact["telephone"]]
        cellules += [valeurs.get(code, "") for code in codes[2:]]
        lignes.append(";".join(cellules))
    return "\r\n".join(lignes) + "\r\n"


# --------------------------------------------------- création « prête »
def nom_campagne(nature, infos, nb_contacts, quand=None, jours=()):
    """Le nom automatique lisible — réutilise le format existant.

    `jours` : les journées SUR LESQUELLES porte la campagne (les dates des
    rendez-vous de ses contacts). Elles entrent dans le nom.

    ⚠ SON DÉFAUT N° 8 DU 18/08/2026 : « Déplacement de rendez-vous (11
    contact(s)) — 17/08 » — le 17/08 est la date de CRÉATION, pas la journée
    traitée. Avec 91 campagnes terminées dans sa liste, rien ne permettait de
    retrouver « celle du 18/08 », celle qui avait vidé sa journée.

    La règle existait déjà, pour un seul thème : « Créneau libéré **du 03/08
    14h** — 28/07 » porte bien sa date concernée. Elle vaut pour toutes les
    campagnes qui partent d'une plage du planning — déplacement, rappel,
    confirmation : ce sont des rendez-vous DATÉS qu'elles traitent. Une seule
    règle, sinon la moitié des campagnes reste introuvable.

    Les natures sans rendez-vous par contact (prise de rendez-vous) n'ont
    aucune journée à nommer : `jours` est vide et le nom ne change pas.
    """
    if nature == "creneau_libere":
        return campagnes.nom_auto("creneau_libere",
                                  creneau=infos.get("creneau_libere"),
                                  quand=quand)
    if quand is None:
        quand = datetime.date.today()
    nom = (fiche_nature(nature) or {}).get("nom", nature)
    if jours:
        premier = date_jour_lisible(jours[0])[:5]      # « 18/08 »
        if len(jours) == 1:
            nom = f"{nom} du {premier}"
        else:
            # Plusieurs journées : on ne dit pas « du X au Y », qui ferait
            # croire à une suite continue — elles peuvent être éparses.
            nom = f"{nom} de {len(jours)} journées, dès le {premier}"
    return f"{nom} ({nb_contacts} contact(s)) — {quand:%d/%m}"


def creer_campagne_prete(base, brouillon, preferences, quand=None):
    """Crée la campagne en état « prête » — elle N'APPELLE PERSONNE.

    Chaque contact reçoit un LIEN vers une fiche client (créée ici s'il
    était simplement collé) : c'est le numéro ACTUEL de cette fiche qui
    sera composé, jamais la copie gelée dans la campagne. Les contacts
    reconnus comme 🚫 « Ne plus appeler » — par leur numéro OU par leur
    nom — sont créés d'office en état « exclu » (jamais composés) ; le
    bandeau de la fiche les compte. Rend l'identifiant de la campagne.
    """
    nature = brouillon["nature"]
    infos = brouillon["infos"]
    # Les listes de créneaux CALCULÉES et laissées telles quelles restent
    # repérées : au moment de l'appel, elles seront réadaptées à la durée du
    # client concerné (30 minutes = 2 tranches). Une liste retapée à la main
    # par l'utilisateur n'est jamais touchée.
    # Le stock est remis au nombre RÉEL de gens avant qu'on ne fige quoi que ce
    # soit — voir `rafraichir_stock_du_brouillon`.
    rafraichir_stock_du_brouillon(base, preferences, brouillon)
    infos_auto = {code: valeur
                  for code, valeur in (brouillon.get("infos_auto") or {}).items()
                  if valeur and infos.get(code) == valeur}
    configuration = {
        "politique": brouillon["politique"],
        "ordre": brouillon["ordre"],
        "options": brouillon["options"],
        "infos": infos,
        "infos_auto": infos_auto,
        "champs": brouillon["champs"],
        # La RECETTE : de quoi rejouer cette campagne sur un autre créneau
        # (§8.3). Ajout additif — une campagne sans recette le dit à l'écran.
        # ⚠ La recette porte « mission_editee » : c'est elle qui dit si le
        # message peut être recalé sur une autre place (voir
        # `mission_sur_la_place`). Sans elle, on recalerait un texte humain.
        "recette": dict(brouillon.get("recette") or recette_vide(),
                        mission_editee=bool(brouillon.get("mission_editee"))),
        # ⚠ « .get » ET PAS « [ ] » : les deux constructeurs de brouillon ne
        # portaient pas cette clé, et un accès direct plantait à CHAQUE
        # création de campagne (défaut relevé à la revue du 03/08/2026).
        # Un brouillon sans liste retombe sur son créneau unique : une
        # campagne d'avant se comporte exactement comme avant.
        "creneaux": normaliser_creneaux(
            brouillon.get("creneaux")
            or [brouillon.get("creneau") or infos.get("creneau_libere")]),
    }
    # Une SEULE place : la campagne se comporte exactement comme avant, y
    # compris son décalage en cascade. Plusieurs : c'est une campagne à liste.
    configuration["liste_de_places"] = len(configuration["creneaux"]) > 1
    # Le mode AUTOMATIQUE enregistre sa règle ; le mode manuel n'en a pas.
    if brouillon.get("mode_liste") == "automatique":
        configuration["regle_liste"] = dict(brouillon.get("regle_liste") or {})
    # LE PLAFOND SUIT LA CAMPAGNE, pas seulement le brouillon : en automatique
    # la règle est rejouée à CHAQUE place, et elle doit le respecter aussi —
    # sinon un plafond réglé à cinq laisserait entrer cinq personnes de plus à
    # chaque changement de place.
    if brouillon.get("plafond"):
        configuration["plafond"] = str(brouillon["plafond"]).strip()
    campagne_id = base.creer_campagne(
        nom_campagne(nature, infos, len(brouillon["contacts"]), quand=quand,
                     jours=jours_des_contacts(brouillon)),
        theme=nature, sujet=infos.get("sujet", ""),
        mission=brouillon["mission"],
        # Le créneau de la campagne : celui de son information quand la nature
        # en porte une (« créneau libéré »), sinon celui que le brouillon
        # impose — c'est le cas d'un maillon de cascade, dont le créneau est
        # la place qu'un client vient de libérer.
        # ⚠ LE PREMIER DE LA LISTE, et la colonne ne sert plus qu'à ça : tout
        # ce qui la lit (parcours direct, fiche, écran Clients, banc d'essai)
        # continue de voir un créneau, sans rien savoir de la liste.
        creneau=(configuration["creneaux"][0]["horaire"]
                 if configuration["creneaux"] else None),
        nature=nature,
        configuration=json.dumps(configuration, ensure_ascii=False),
        statut="prête")
    for rang, contact in enumerate(brouillon["contacts"], start=1):
        client_id = base.client_pour_contact(contact["nom"],
                                             contact["telephone"],
                                             contact.get("rendezvous_id"))
        # ⚠ LE NUMÉRO TAPÉ DANS LA GRILLE VA JUSQU'À LA FICHE (18/08/2026).
        # C'est la FICHE qui est composée, jamais la copie gelée dans la
        # campagne : sans cette ligne, le numéro qu'il venait de saisir restait
        # sur la campagne et le contact partait « exclu — Aucun numéro à
        # composer ». Le geste que l'écran lui demandait ne servait à rien.
        # Une fiche qui a DÉJÀ un numéro n'est pas touchée (voir
        # `db.completer_telephone`) : compléter n'est pas écraser.
        base.completer_telephone(client_id, contact["telephone"])
        if base.telephone_exclu(contact["telephone"]):
            refus = db.REFUS_STOP
        elif base.nom_exclu(contact["nom"]):
            refus = db.REFUS_STOP_NOM
        else:
            refus = None
        # ⚠ L'ÉTAT ET LE TEXTE SORTENT DU MÊME ENDROIT, ensemble. Ma première
        # version ne prenait que l'état : le contact partait bien « à rappeler
        # par un humain », mais avec l'ancien texte « Client marqué 🚫 Ne plus
        # appeler » — qui ne dit à personne qu'il y a un appel à passer.
        etat, detail = (db.suite_du_refus(refus) if refus
                        else ("à appeler", None))
        base.ajouter_contact_campagne(
            campagne_id, rang, contact["nom"], contact["telephone"],
            rendezvous_id=contact.get("rendezvous_id"), etat=etat,
            champs=json.dumps(contact.get("champs") or {}, ensure_ascii=False),
            detail=detail, client_id=client_id)
    # ⚠ LA RÈGLE EST JOUÉE DÈS LA CRÉATION, sur la PREMIÈRE place (09/08/2026).
    # Elle ne l'était qu'au changement de place : une campagne automatique
    # naissait donc VIDE, et le ▶ Démarrer n'appelait personne avant de se
    # déclarer terminée. Le défaut était supportable tant que l'automatique
    # était un choix ; il est devenu le mode par défaut, donc le chemin normal.
    # Elle vient APRÈS les contacts de la grille : le dédoublonnage se fait sur
    # les numéros déjà présents, et une saisie manuelle n'est jamais écrasée.
    if regle_de_liste(configuration):
        ajoutes = regenerer_la_liste(base, preferences,
                                     base.obtenir_campagne(campagne_id),
                                     configuration)
        journal.info("Campagne n°%d : règle jouée à la création — %d "
                     "personne(s)", campagne_id, ajoutes)
    journal.info("Campagne n°%d créée PRÊTE (nature %s, %d contact(s)) — "
                 "aucun appel passé", campagne_id, nature,
                 len(base.contacts_de_campagne(campagne_id)))
    return campagne_id


def configuration_campagne(campagne):
    """La configuration enregistrée d'une campagne de l'assistant (dict)."""
    try:
        configuration = json.loads(campagne.get("configuration") or "{}")
    except (TypeError, ValueError):
        configuration = {}
    configuration.setdefault("politique", "tous")
    configuration.setdefault("ordre", "liste")
    configuration.setdefault("options", {})
    configuration.setdefault("infos", {})
    configuration.setdefault("infos_auto", {})
    configuration.setdefault("champs", [])
    # Une campagne d'avant les recettes n'en a pas : elle vaut « non
    # reproductible » (aucun apport), et la cascade le dit au lieu d'inventer.
    configuration.setdefault("recette", recette_vide())
    # La LISTE des créneaux (03/08/2026) : vide pour une campagne d'avant,
    # qui retombe alors sur sa colonne « creneau ». Voir `creneaux_de`.
    configuration.setdefault("creneaux", [])
    # ⚠ « À LISTE » SE DÉCIDE À LA CRÉATION, pas en comptant les places. Une
    # campagne d'un seul créneau garde son décalage en cascade d'origine ; et
    # une place rendue qui s'ajouterait ne doit pas la transformer en cours
    # de route.
    configuration.setdefault("liste_de_places", False)
    # La règle du mode automatique. Absente : la campagne porte une liste
    # figée, et rien n'est rejoué (c'est le mode manuel).
    configuration.setdefault("regle_liste", {})
    return configuration


# ================================================ LA LISTE DES CRÉNEAUX
# ⚠ UNE CAMPAGNE « CRÉNEAU LIBÉRÉ » PEUT EN PORTER PLUSIEURS (demande du
# propriétaire du 03/08/2026). Avant, elle en portait UN, dans la colonne
# campagnes.creneau.
#
# Cette colonne NE BOUGE PAS : elle garde le premier créneau, et tout ce qui
# la lit continue de marcher sans rien savoir de la liste — le parcours
# direct, la fiche de campagne, l'écran 👥 Contacts, le banc d'essai. La
# liste, elle, vit dans la configuration JSON qui existait déjà : aucune
# table neuve, aucun ALTER TABLE, donc aucune migration à écrire.
#
# ⚠ L'ORDRE DE STOCKAGE EST L'ORDRE D'AFFICHAGE : chronologique croissant,
# les plus anciens en tête. Deux tris — un pour ranger, un pour montrer —
# auraient fini par se contredire.
CRENEAU_A_POURVOIR = "à pourvoir"
CRENEAU_POURVU = "pourvu"
CRENEAU_PERDU = "perdu"

# ------------------------------------------ ce qu'un appel conclut, pour la boucle
# `_appliquer_issue` rend l'une de ces valeurs, ou None quand la campagne
# continue sans rien changer à ses places.
#
# ⚠ POURQUOI « PLACE PERDUE » EXISTE (14/08/2026, second temps). Le premier
# correctif retirait bien la place de la LISTE, mais la boucle d'exécution n'en
# savait rien : elle ne relit la campagne que sur « pourvu ». Sur une campagne à
# UNE SEULE place — le cas le plus courant — elle continuait donc d'appeler tout
# le monde pour une place morte. Mesuré : six contacts, six appels, six départs
# « à rappeler par un humain ». C'était le défaut du 14/08 intact, seulement
# déplacé d'un cran.
CONCLUSION_POURVU = "pourvu"
CONCLUSION_PLACE_PERDUE = "place_perdue"


def normaliser_creneaux(valeurs):
    """Une liste de créneaux propre : triée, sans doublon, sans vide.

    Accepte indifféremment des chaînes (« 2026-08-12T09:00 ») et des fiches
    déjà formées : c'est ce qui permet de recevoir aussi bien une saisie de
    formulaire que la configuration relue en base, sans deux chemins.
    """
    par_horaire = {}
    for valeur in valeurs or ():
        if isinstance(valeur, dict):
            horaire = str(valeur.get("horaire") or "").strip()
            fiche = dict(valeur)
        else:
            horaire = str(valeur or "").strip()
            fiche = {}
        if not horaire:
            continue
        fiche["horaire"] = horaire
        fiche.setdefault("statut", CRENEAU_A_POURVOIR)
        fiche.setdefault("contact_id", None)
        fiche.setdefault("rendezvous_id", None)
        fiche.setdefault("pourquoi", "")
        # Une même heure ne peut pas être deux places : la dernière gagne.
        par_horaire[horaire] = fiche
    return [par_horaire[horaire] for horaire in sorted(par_horaire)]


def creneaux_de(campagne, configuration=None):
    """Les créneaux d'une campagne — la liste, ou son créneau unique.

    Une campagne d'AVANT la liste n'a que sa colonne « creneau » : on la rend
    sous la MÊME forme, pour que le reste du code n'ait qu'un seul chemin à
    connaître. Une campagne d'une autre nature rend une liste vide.
    """
    if configuration is None:
        configuration = configuration_campagne(campagne)
    liste = normaliser_creneaux(configuration.get("creneaux"))
    if liste:
        return liste
    unique = (campagne or {}).get("creneau")
    return normaliser_creneaux([unique]) if unique else []


def creneau_courant(campagne, configuration=None):
    """La prochaine place à pourvoir, ou None quand elles sont toutes réglées."""
    for fiche in creneaux_de(campagne, configuration):
        if fiche.get("statut") == CRENEAU_A_POURVOIR:
            return fiche
    return None


def _ecrire_creneaux(base, campagne_id, configuration, liste):
    """Range la liste dans la configuration et l'enregistre.

    ⚠ ET REMET « liste_de_places » D'APRÈS CE QU'ON ÉCRIT (15/08/2026). Ce
    drapeau était figé à la CRÉATION de la campagne. Depuis que la place
    quittée rejoint la campagne — y compris quand elle n'en avait qu'une —
    une campagne peut en compter deux sans que le drapeau bouge : elle
    continuait alors de se comporter en « place unique », donc sans filtrer
    les contacts sur l'intérêt et sans recharger de liste.

    C'est le point de passage commun de TOUTE écriture de places
    (`ajouter_creneau`, `marquer_creneau`) : le poser ici, et nulle part
    ailleurs, est ce qui garantit qu'aucun chemin ne l'oublie.
    """
    configuration["creneaux"] = normaliser_creneaux(liste)
    configuration["liste_de_places"] = len(configuration["creneaux"]) > 1
    base.definir_configuration_campagne(
        campagne_id, json.dumps(configuration, ensure_ascii=False))
    return configuration["creneaux"]


def marquer_creneau(base, campagne_id, horaire, statut, contact_id=None,
                    rendezvous_id=None, pourquoi=""):
    """Note ce qu'est devenue UNE place, et rend la liste à jour.

    ⚠ RELIT LA CAMPAGNE EN BASE avant d'écrire. Le dictionnaire que la boucle
    d'exécution garde en mémoire date du démarrage : écrire à partir de lui
    écraserait ce qu'un appel précédent vient de noter. Le défaut, relevé à
    la revue du 03/08/2026, mettait DEUX personnes dans la même place.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if not campagne:
        return []
    configuration = configuration_campagne(campagne)
    liste = creneaux_de(campagne, configuration)
    for fiche in liste:
        if fiche["horaire"] == horaire:
            fiche["statut"] = statut
            fiche["contact_id"] = contact_id
            fiche["rendezvous_id"] = rendezvous_id
            fiche["pourquoi"] = pourquoi
    return _ecrire_creneaux(base, campagne_id, configuration, liste)


def ajouter_creneau(base, campagne_id, horaire, pourquoi=""):
    """Ajoute une place à pourvoir à une campagne, et rend la liste à jour.

    Sert quand un contact accepte : la place qu'il QUITTE rejoint la liste de
    la MÊME campagne (décision du propriétaire du 03/08/2026), au lieu
    d'engendrer une campagne « prête » séparée. Même précaution que
    `marquer_creneau` : on relit la base avant d'écrire.

    Une place déjà connue n'est pas remise à « à pourvoir » : elle a peut-être
    déjà été pourvue, et la rouvrir la ferait proposer deux fois.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if not campagne or not (horaire or "").strip():
        return []
    configuration = configuration_campagne(campagne)
    liste = creneaux_de(campagne, configuration)
    if any(fiche["horaire"] == horaire for fiche in liste):
        return liste
    liste.append({"horaire": horaire, "statut": CRENEAU_A_POURVOIR,
                  "contact_id": None, "rendezvous_id": None,
                  "pourquoi": pourquoi})
    return _ecrire_creneaux(base, campagne_id, configuration, liste)


class _decroissant:
    """Une clé de tri qui INVERSE la comparaison d'une chaîne.

    `reverse=True` aurait inversé AUSSI le premier critère (« sans date en
    dernier ») et renvoyé les contacts sans rendez-vous en tête. On n'inverse
    donc que ce qu'il faut.
    """

    __slots__ = ("valeur",)

    def __init__(self, valeur):
        self.valeur = valeur

    def __lt__(self, autre):
        return self.valeur > autre.valeur

    def __eq__(self, autre):
        return self.valeur == autre.valeur


# ============================ LA RÈGLE DE LISTE DU MODE AUTOMATIQUE
# Une campagne « automatique » ne porte pas une liste figée : elle porte la
# RÈGLE qui la fabrique, et cette règle est rejouée à chaque changement de
# place. C'est ce qui permet à la place du 12 août d'intéresser d'autres
# personnes que celle du 30.
# ⚠ CE RÉGLAGE A ÉTÉ RETOURNÉ LE 11/08/2026, ET C'ÉTAIT UNE INVERSION, PAS UN
# LIBELLÉ MALHEUREUX. Il disait « jusqu'à 30 jours après » et gardait les gens
# dont le rendez-vous tombe DANS les 30 jours qui suivent la place — c'est-à-dire
# ceux qui gagnent le MOINS. Mesuré sur le jeu d'essai, place dans 3 jours :
#
#   « jusqu'à 7 jours »  -> 10 personnes, qui gagnaient de 0 à 6 jours
#   « jusqu'à 30 jours » -> 19 personnes, qui gagnaient de 0 à 29 jours
#   « sans limite »      -> 31 personnes, dont certaines gagnaient 0 JOUR
#
# Une place libérée sert à faire GAGNER du temps. Le réglage exprime donc
# maintenant un GAIN MINIMUM : « au moins 30 jours » retient ceux dont le
# rendez-vous est au moins 30 jours après la place — 12 personnes, qui gagnent
# vraiment quelque chose. Mots du propriétaire : « on va demander les personnes à
# partir de la date du rendez-vous + 30 j, et la date de fin est le dernier
# rendez-vous enregistré ».
#
# ⚠ ET LES LIBELLÉS DISENT LE GAIN, PAS LA MÉCANIQUE. « au moins 30 jours »
# répond à la question qu'on se pose vraiment — « à qui cette place sert-elle
# assez pour qu'on décroche le téléphone ? »
JOURS_APRES = (("", "peu importe"), ("7", "au moins 7 jours"),
               ("30", "au moins 30 jours"), ("90", "au moins 90 jours"))

# ============================ JUSQU'OÙ LA CHAÎNE DU DÉCALAGE PEUT ALLER
# Sa demande du 15/08/2026 : « au lieu d'avoir uniquement un sélecteur de date,
# on a également un sélecteur pour définir une période ce qui remplit
# automatiquement le champ date ».
#
# Taper une date à la main pour dire « trois mois » demande d'ouvrir un
# calendrier et de compter — alors que c'est en durées qu'on pense. Le champ
# date reste, et reste modifiable : le sélecteur le REMPLIT, il ne le remplace
# pas. « Date libre » est le premier choix, donc le comportement d'avant.
#
# Les valeurs sont des JOURS, sauf « derniere » qui vise le dernier rendez-vous
# connu de l'agenda — au-delà, la chaîne ne trouverait plus personne, et c'est
# la seule borne qu'on puisse proposer sans l'inventer.
PERIODES_CASCADE = (("", "Date libre"), ("7", "7 jours"), ("14", "14 jours"),
                    ("30", "30 jours"), ("60", "2 mois"), ("90", "3 mois"),
                    ("180", "6 mois"), ("365", "1 an"),
                    ("derniere", "Dernière date de l'agenda"))

# LA RÈGLE POSÉE D'OFFICE quand une campagne s'ouvre en mode automatique
# (09/08/2026). Un mode par défaut SANS règle aurait laissé créer une campagne
# qui n'appelle personne : le défaut porte donc sa valeur, comme le reste des
# réglages du produit.
#
# ⚠ « À VENIR, PAS ENCORE CONFIRMÉS » DEPUIS LE 15/08/2026 (sa demande). C'était
# « à recaser » — ceux qui attendent une place. Mais la nature qui se sert le
# plus de la règle est « créneau libéré », et elle cherche l'inverse : des gens
# qui ONT un rendez-vous, plus tard, qu'on peut avancer. Le défaut vise donc
# maintenant ces gens-là. Voir SOURCES_REGLE, où « posés » a été retirée dans
# le même mouvement.
REGLE_LISTE_DEFAUT = {"source": "a_venir", "jours": ""}

# ============================ LE PLAFOND DE CONTACTS À CHARGER
# Demande du propriétaire du 11/08/2026 : « un champ pour limiter le nombre de
# contact à charger dans l'étape 3 pour limiter le nombre d'appel ». Une source
# peut rendre trente personnes ; on n'a pas toujours envie que trente téléphones
# sonnent.
#
# ⚠ IL PLAFONNE CE QUI ENTRE, IL NE TAILLE JAMAIS CE QUI EST DÉJÀ LÀ. Une ligne
# tapée à la main dans la grille n'est jamais retirée par le plafond : « une
# saisie refusée n'est jamais perdue » vaut aussi pour une saisie acceptée. Le
# plafond compte les présents et ne laisse entrer que la différence.
#
# ⚠ ET IL GARDE LES PLUS PERTINENTS, PAS LES PREMIERS VENUS. L'ordre d'appel
# choisi à cette même étape est appliqué AVANT de couper : sur une campagne de
# créneau libéré, garder « les cinq premiers de la base » au lieu des « cinq
# dont le rendez-vous est le plus lointain » aurait appelé les gens à qui la
# place apporte le moins.
#
# Vide = aucun plafond, et c'est le défaut : un plafond posé d'office aurait
# écarté du monde sans que personne ne l'ait demandé.
PLAFOND_VIDE = ""


def plafond_de(porteur):
    """Le plafond de contacts d'un brouillon ou d'une configuration, ou None.

    None = pas de plafond. Une valeur illisible ou nulle vaut « pas de
    plafond » : mieux vaut charger tout le monde que d'écarter sur un chiffre
    qu'on n'a pas su lire.
    """
    brut = str((porteur or {}).get("plafond") or "").strip()
    if not brut.isdigit():
        return None
    return int(brut) or None


def limiter_au_plafond(contacts, plafond, ordre=None, creneau=None, deja=0):
    """Les contacts qui tiennent sous le plafond. Rend (gardes, ecartes).

    `deja` : combien sont DÉJÀ dans la liste — ils comptent dans le plafond
    sans être touchés (voir le pavé au-dessus de PLAFOND_VIDE).

    Sans plafond, rien n'est écarté et l'ordre n'est pas touché : le chemin
    d'avant reste le chemin d'avant.
    """
    if not plafond:
        return list(contacts), 0
    place = max(0, plafond - deja)
    if len(contacts) <= place:
        return list(contacts), 0
    # L'ordre d'appel décide QUI on garde. Sans ordre connu, on garde les
    # premiers venus — et l'écran dit combien ont été écartés, dans tous les cas.
    retenus = (ordonner_contacts(contacts, ordre, creneau) if ordre
               else list(contacts))
    return retenus[:place], len(contacts) - place


def raison_plafond(plafond, ecartes):
    """Ce que le maximum de personnes a écarté. Vide s'il n'a rien écarté."""
    if not ecartes:
        return ""
    # ⚠ ET ICI AUSSI LE MOT NOMME LE RÉGLAGE (21/08/2026). C'est l'AUTRE
    # sens de « plafond » — celui de l'étape ③, « Au maximum, combien de
    # personnes ». Renommer l'un et laisser l'autre aurait gardé le mot ambigu
    # exactement là où il l'a rencontré.
    return (f"{ecartes} personne(s) écartée(s) : cette campagne est réglée au "
            f"maximum sur {plafond} personne(s)")


def manque_au_plafond(plafond, trouves):
    """La phrase qui dit POURQUOI le plafond n'est pas atteint.

    ⚠ ELLE EXISTE PARCE QUE SON ABSENCE MENTAIT PAR OMISSION (11/08/2026) : un
    plafond réglé à 30 qui rend 8 personnes ressemble à un défaut, alors que la
    source n'en contenait que 8. Un chiffre sans son écart ne se lit pas.
    """
    if not plafond or trouves >= plafond:
        return ""
    return (f"{trouves} personne(s) retenue(s) sur le maximum de {plafond} "
            "demandé(es) : "
            "la règle n'en a pas trouvé plus — changez la source, la fenêtre, "
            "ou ajoutez des personnes à la main")


# ⚠ LA RÈGLE DE L'INTÉRÊT (décision du propriétaire, 09/08/2026), écrite ICI
# une fois pour toutes : une place n'intéresse quelqu'un que si elle lui
# APPORTE quelque chose.
#  · il n'a plus aucun rendez-vous à venir → n'importe quelle place ;
#  · il en a un → seule une place PLUS TÔT que le sien.
# Elle remplace une borne qui comparait l'ANCIENNE date — celle d'un
# rendez-vous annulé, donc passée — à la place proposée : cette comparaison
# écartait précisément les gens qui attendent.
SOURCES_A_VENIR = ("poses", "a_venir")


def place_utile_au_contact(base, contact, places, maintenant=None, gain=0):
    """Vrai si au moins une de ces places apporte quelque chose à ce contact.

    ⚠ ON DEMANDE À LA BASE, pas à la colonne « rendez-vous existant » du
    contact : celle-ci porte la date de l'ANCIEN rendez-vous, y compris quand
    il a été annulé. La question qui compte est « a-t-il encore un rendez-vous
    à venir ? », et seule la base sait y répondre à cet instant.

    ⚠ ET ON RÉUTILISE `rendezvous_a_venir_du_client`, QUI EXISTAIT DÉJÀ. J'en
    avais écrit une seconde, plus simple — et sous le même nom : elle a
    silencieusement remplacé l'autre et cassé quatre essais de cascade. Ses
    statuts (STATUTS_A_VENIR) sont exactement ceux du « NOT EXISTS » qui
    définit « en attente » : deux définitions d'« avoir encore un rendez-vous »
    auraient fini par se contredire.

    `gain` : le nombre de JOURS que la place doit faire gagner, celui de la
    règle de la campagne.

    ⚠ SANS LUI, LE SEUIL NE VALAIT QUE POUR LA PREMIÈRE PLACE (15/08/2026).
    Constat du propriétaire, mot pour mot : « le rendez-vous +30 jours pour le
    15/08 cherche des contacts à partir du 15/09, et le créneau du 15/09
    devrait chercher à partir du 15/10 ». C'était juste, et ce n'était pas fait.
    La règle chargeait la liste au seuil de la PREMIÈRE place ; ensuite, à
    chaque place suivante, ce filtre ne demandait plus que « la place est-elle
    plus tôt que son rendez-vous ». Quelqu'un retenu pour un gain de 35 jours
    sur la place du 15/08 se voyait donc proposer, une fois la campagne
    avancée, une place qui ne lui en faisait plus gagner que deux. Le seuil
    suit maintenant la place en cours.
    """
    if not places:
        return False
    if not contact.get("client_id"):
        # Pas de fiche : on ne devine pas, on appelle. Le taire aurait fait
        # disparaître quelqu'un sans raison affichée.
        return True
    a_venir = base.rendezvous_a_venir_du_client(contact["client_id"],
                                                maintenant)
    if not a_venir:
        # Plus rien en agenda : toute place libre l'intéresse.
        return True
    prochain = a_venir[0]["horaire"]
    if not gain:
        return any(place < prochain for place in places)
    limite = datetime.datetime.fromisoformat(prochain) - datetime.timedelta(
        days=int(gain))
    borne = limite.isoformat(timespec="minutes")
    return any(place <= borne for place in places)


RAISON_PLUS_DE_PROPOSITION = (
    "cette personne a demandé au téléphone qu'on ne lui propose plus de "
    "créneau libéré")


def gain_de_la_regle(configuration):
    """Le gain minimum réglé sur cette campagne, en jours (0 = aucun).

    Une seule lecture pour tout le produit : la règle en porte la valeur, et
    c'est elle qui doit valoir à CHAQUE place, pas seulement à la première.
    """
    regle = (configuration or {}).get("regle_liste") or {}
    brut = str(regle.get("jours") or "").strip()
    return int(brut) if brut.isdigit() else 0


def interesse_par_une_place(base, contact, places, maintenant=None, gain=0):
    """Y a-t-il une raison d'appeler CE contact pour CES places ?

    Deux questions, posées au même endroit parce qu'elles ont la même
    conséquence — ne pas appeler :

    1. **le consentement** : la personne a-t-elle demandé au téléphone qu'on
       ne lui propose plus de place ? (drapeau sur SA FICHE, pas sur la
       campagne — voir db.clients.plus_de_proposition) ;
    2. **l'intérêt** : l'une des places restantes est-elle plus tôt que son
       prochain rendez-vous ? (`place_utile_au_contact`)

    ⚠ LES DEUX SONT REJOUÉES À CHAQUE FOIS, jamais mémorisées sur le contact :
    une place RENDUE par quelqu'un qui accepte peut être plus tôt que la place
    en cours et rendre quelqu'un de nouveau concerné.
    """
    if base.plus_de_proposition(contact.get("client_id")):
        return False
    return place_utile_au_contact(base, contact, places, maintenant, gain)


def regle_de_liste(configuration):
    """La règle enregistrée, ou None si la campagne porte une liste figée."""
    regle = (configuration or {}).get("regle_liste") or {}
    return regle if regle.get("source") in SOURCES_DATEES else None


def contacts_de_la_regle(base, preferences, regle, champs, creneau,
                         telephones_connus=()):
    """Les personnes que CETTE place intéresse, d'après la règle.

    ⚠ LA FENÊTRE NE VAUT QUE POUR LES SOURCES DE RENDEZ-VOUS À VENIR
    (09/08/2026). Elle part de la place : « avant elle, l'avancer n'apporte
    rien ». Vrai de quelqu'un qui A un rendez-vous — faux, et lourd de
    conséquences, pour quelqu'un qui n'en a plus. Les gens « en attente » ont
    une date PASSÉE par construction (on annule, la date est derrière) : la
    borne les écartait tous. Mesuré : une personne retenue sur quatre qui
    attendent toutes une place. Pour ces sources-là, aucune borne — c'est la
    règle de l'intérêt, `place_utile_au_contact`, qui décide au moment
    d'appeler.

    ⚠ « JOURS » EST UN GAIN MINIMUM, PAS UNE LIMITE (retourné le 11/08/2026 —
    voir le pavé au-dessus de JOURS_APRES). « au moins 30 jours » DÉCALE le début
    de la fenêtre de 30 jours après la place, et il n'y a PAS de fin : le dernier
    rendez-vous enregistré ferme la liste tout seul. Avant, il fermait la fenêtre
    à 30 jours et gardait donc ceux qui gagnaient le moins — exactement le
    contraire de ce que sert une place libérée.
    """
    if not creneau:
        return [], []
    debut = ""
    if regle["source"] in SOURCES_A_VENIR:
        debut = creneau
        jours = str(regle.get("jours") or "").strip()
        if jours.isdigit():
            debut = (datetime.datetime.fromisoformat(creneau)
                     + datetime.timedelta(days=int(jours))).isoformat(
                         timespec="minutes")
    contacts, complements = contacts_depuis_base(
        base, regle["source"], champs, list(telephones_connus),
        debut=debut or None, fin=None)
    # ⚠ LA FENÊTRE ÉCARTAIT DU MONDE SANS UN MOT (11/08/2026). Le propriétaire
    # a créé une campagne sur une place libre et n'a vu que cinq personnes « au
    # lieu de beaucoup ». La règle marchait : la source « rendez-vous à venir »
    # en tenait quatorze, et la borne — « une place n'intéresse que ceux dont le
    # rendez-vous est APRÈS elle » — en gardait trois. Onze personnes écartées,
    # et l'écran n'en disait RIEN : un compte sans explication se lit comme un
    # défaut. On rejoue donc la même source SANS bornes, et l'on nomme l'écart.
    # Un second passage sur un fichier local, au moment d'un geste — pas dans
    # une boucle d'appels.
    if debut:
        sans_borne, _ = contacts_depuis_base(
            base, regle["source"], champs, list(telephones_connus))
        hors_fenetre = len(sans_borne) - len(contacts)
        if hors_fenetre > 0:
            gain = str(regle.get("jours") or "").strip()
            complements.append(
                f"{hors_fenetre} personne(s) écartée(s) : cette place ne leur "
                + (f"ferait pas gagner {gain} jours" if gain.isdigit()
                   else "ferait rien gagner — leur rendez-vous n'est pas "
                        "après elle"))
    # ⚠ CEUX QUI ONT DIT « NE ME PROPOSEZ PLUS DE CRÉNEAU » N'ENTRENT PAS DANS
    # LA LISTE (10/08/2026). Le garde-fou de l'appel les arrêterait de toute
    # façon, mais une liste qui les compte annoncerait « 12 personnes » pour en
    # appeler 9 : le compte affiché doit être le vrai.
    #
    # ⚠ ET SEULEMENT ICI, jamais dans `contacts_depuis_base` : ce drapeau ne
    # concerne QUE les propositions de place. Filtrer plus haut aurait écarté
    # ces gens des rappels et des confirmations de LEURS rendez-vous — ce
    # n'est pas ce qu'ils ont demandé.
    gardes, ecartes = [], 0
    for contact in contacts:
        if base.telephone_sans_proposition(contact.get("telephone")):
            ecartes += 1
            continue
        gardes.append(contact)
    if ecartes:
        complements.append(
            f"{ecartes} personne(s) écartée(s) : elles ont demandé qu'on ne "
            "leur propose plus de créneau libéré")
    return gardes, complements


def appels_passes(base, campagne_id):
    """Les appels que cette campagne a DÉJÀ dépensés de son plafond.

    Des personnes composées, pas des tentatives : quelqu'un relancé trois fois
    compte pour un. C'est ce compte-là que borne « 30 appels autorisés ».
    """
    return base.compter_personnes_appelees(campagne_id)


def appels_engages(base, campagne, configuration):
    """Ce que le plafond a déjà engagé : appels PARTIS + appels encore DUS.

    Un appel est « dû » quand quelqu'un attend d'être appelé **et** qu'une des
    places restantes l'intéresse encore. C'est la nuance qui fait tout, et
    elle a coûté deux essais avant d'être juste :

    · compter TOUS les présents (le code d'avant) saturait le plafond dès le
      premier tour — la règle en charge trente, il en reste vingt-neuf en
      attente, et plus personne n'entrait JAMAIS. Six appels passés sur
      trente autorisés, et trois places de cascade sans personne à appeler.
      C'est le défaut qu'il a signalé trois jours de suite ;
    · ne compter que les appels PARTIS gonflait la liste à l'inverse : chaque
      place rechargeait tout le budget restant alors qu'un seul appel allait
      la pourvoir. Mesuré : 465 contacts chargés pour 30 appels, dont 435
      épargnés — juste, mais illisible à l'écran.

    Ce qu'on compte donc : les appels partis, plus les gens encore utiles. Un
    épargné, un exclu, quelqu'un que les places restantes n'avancent plus ne
    retient rien — il ne coûtera jamais d'appel.
    """
    campagne_id = campagne["id"]
    engages = appels_passes(base, campagne_id)
    attente = [contact for contact in base.contacts_de_campagne(campagne_id)
               if contact["etat"] in ("à appeler", "en cours")
               and not base.appels_du_contact_campagne(contact["id"])]
    if not configuration.get("liste_de_places"):
        # Une campagne à UNE place garde son comportement d'avant, à la
        # lettre : sa liste est déjà resserrée à la création et son curseur ne
        # bouge jamais — tout ce qui attend lui est utile par construction.
        return engages + len(attente)
    annoncees = places_annoncees(campagne, configuration)
    gain = gain_de_la_regle(configuration)
    return engages + sum(
        1 for contact in attente
        if interesse_par_une_place(base, contact, annoncees, gain=gain))


def regenerer_la_liste(base, preferences, campagne, configuration):
    """Rejoue la règle sur la place en cours ; rend le nombre d'ajouts.

    ⚠ AJOUTE SEULEMENT. Les contacts déjà présents — appelés, épargnés,
    refusés — sont laissés tels quels : leur retirer leur histoire pour la
    remplacer par une liste fraîche effacerait des appels qui ont eu lieu.
    Le dédoublonnage se fait sur le numéro, comme partout ailleurs.

    ⚠ CE QUE LA RÈGLE A ÉCARTÉ EST ÉCRIT SUR LA CAMPAGNE (clé « regle_jouee »),
    pas seulement au journal. C'est ce qui manquait : la liste s'affichait avec
    trois noms sans dire que onze personnes avaient été écartées, ni pourquoi.
    """
    regle = regle_de_liste(configuration)
    if not regle:
        return 0
    creneau = campagne.get("creneau")
    connus = [base.telephone_contact_campagne(c["id"])
              for c in base.contacts_de_campagne(campagne["id"])]
    connus = [numero for numero in connus if numero]
    champs = champs_campagne(configuration)
    try:
        nouveaux, notes = contacts_de_la_regle(base, preferences, regle, champs,
                                               creneau, connus)
    except (SaisieInvalide, ValueError) as erreur:
        journal.info("Campagne n°%d : la règle de liste n'a pas pu être "
                     "rejouée (%s) — la liste reste telle quelle",
                     campagne["id"], erreur)
        return 0
    # ⚠ LE PLAFOND EST UN BUDGET D'APPELS, PAS UNE TAILLE DE LISTE (15/08/2026).
    #
    # SA DEMANDE, MOT POUR MOT : « 30 appels autorisés, on en consomme 8 pour
    # occuper le créneau […] cela laisse 22 appels, on cherche les 22 contacts
    # sur la base du créneau en cascade et des options automatiques
    # sélectionnées, on ajoute les contacts, on les appelle. »
    #
    # CE QUI SE PASSAIT AVANT, mesuré sur exactement ce scénario : `deja`
    # comptait les contacts PRÉSENTS. La règle en charge trente au départ, donc
    # `deja` valait trente dès le premier tour, et le plafond était atteint à
    # jamais — SIX appels passés, VINGT-QUATRE de budget dormant, et trois
    # places de cascade laissées « à pourvoir » avec cette note à l'écran :
    # « 77 personne(s) écartée(s) : plafond réglé à 30 ». La cascade s'ouvrait
    # bien, mais personne ne pouvait plus entrer pour la servir.
    #
    # La règle de comptage est donc celle des APPELS, et elle a deux parts :
    # ceux qui sont PARTIS, et ceux qui restent DUS — un contact encore « à
    # appeler » a sa place réservée dans le budget. Les autres (épargnés,
    # exclus, écartés faute d'intérêt) ne coûteront plus jamais un appel : les
    # compter, c'est exactement ce qui fermait la porte.
    #
    # ⚠ ET CELA NE ROUVRE PAS LE DÉFAUT QUE CE COMPTE PROTÉGEAIT — « une
    # campagne à six places aurait fini par en appeler trente ». Au contraire :
    # borner les APPELS est plus strict que borner la liste. Le total d'appels
    # d'une campagne ne peut, par construction, jamais dépasser son plafond.
    # ⚠ LA RÈGLE AUTOMATIQUE PASSE PAR LE MÊME FILTRE (20/08/2026) : elle est
    # rejouée à CHAQUE place, et sans lui elle réimporterait à chaque tour les
    # rendez-vous que la campagne vient justement de faire confirmer.
    nouveaux, deja_confirmes = ecarter_les_deja_confirmes(
        base, campagne.get("nature"), nouveaux)
    if deja_confirmes:
        notes = list(notes) + [phrase_deja_confirmes(deja_confirmes)]
    plafond = plafond_de(configuration)
    deja = appels_engages(base, campagne, configuration)
    nouveaux, hors_plafond = limiter_au_plafond(
        nouveaux, plafond, ordre=configuration.get("ordre"), creneau=creneau,
        deja=deja)
    if hors_plafond:
        notes = list(notes) + [raison_plafond(plafond, hors_plafond)]
    # ⚠ ET QUAND LE PLAFOND N'EST PAS ATTEINT, ON LE DIT (11/08/2026). Le
    # propriétaire a réglé 30 et obtenu 8 : « j'ai dit que je voulais 30 contact,
    # je n'en ai que 8 ». La règle avait raison — la source n'en contenait pas
    # plus — mais un plafond réglé à 30 qui rend 8 se lit comme un défaut tant
    # que personne ne dit d'où vient l'écart.
    elif plafond and deja + len(nouveaux) < plafond:
        notes = list(notes) + [manque_au_plafond(plafond,
                                                 deja + len(nouveaux))]
    rang = len(base.contacts_de_campagne(campagne["id"]))
    for contact in nouveaux:
        rang += 1
        base.ajouter_contact_campagne(
            campagne["id"], rang, contact["nom"], contact["telephone"],
            rendezvous_id=contact.get("rendezvous_id"),
            champs=json.dumps(contact.get("champs") or {},
                              ensure_ascii=False),
            client_id=base.client_pour_contact(contact["nom"],
                                               contact["telephone"],
                                               contact.get("rendezvous_id")))
    if nouveaux:
        journal.info("Campagne n°%d : règle rejouée sur la place %s — "
                     "%d personne(s) ajoutée(s)", campagne["id"], creneau,
                     len(nouveaux))
    _noter_regle_jouee(base, campagne["id"], creneau, len(nouveaux), notes)
    return len(nouveaux)


def _noter_regle_jouee(base, campagne_id, creneau, retenus, notes):
    """Écrit sur la campagne ce que la règle a donné, et ce qu'elle a écarté.

    Sur la campagne, pas dans une variable de passage : l'écran de la campagne
    est relu longtemps après le geste, et recalculer à l'affichage donnerait un
    autre chiffre que celui qui a servi.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if campagne is None:
        return
    configuration = configuration_campagne(campagne)
    configuration["regle_jouee"] = {"creneau": creneau, "retenus": retenus,
                                    "notes": list(notes)}
    base.definir_configuration_campagne(
        campagne_id, json.dumps(configuration, ensure_ascii=False))


def mission_sur_la_place(base, preferences, campagne, configuration, horaire):
    """Le message ET LES INFOS de la campagne, recalés sur une AUTRE place.

    Rend le couple (message, informations d'étape 2) — ou (None, None) si le
    recalage est refusé.

    ⚠ REFUSÉ QUAND LE MESSAGE A ÉTÉ RÉCRIT À LA MAIN. Il porte alors la date
    de sa place dans une phrase humaine : la refabriquer inventerait du
    texte, et la laisser telle quelle ferait annoncer au téléphone une heure
    que personne ne tiendra. C'est exactement la règle que la cascade
    applique déjà avant de rejouer une recette — une seule règle, un seul
    endroit de décision.

    ⚠ ELLE RENDAIT LE SEUL MESSAGE, ET C'ÉTAIT LE DÉFAUT (01/09/2026). Les
    informations recalées ci-dessous servaient à fabriquer le message… puis
    étaient jetées. La campagne avançait donc de place avec un message à jour
    et une CONFIGURATION restée sur l'ancienne — or c'est la configuration qui
    nourrit les faits de la consigne (« ce que tu sais »).

    CE QUE ÇA A DONNÉ, mesuré sur sa campagne n°133 : la présentation disait
    « une place s'est libérée le vendredi 2 octobre 2026 à 9 heures 40 » et
    les faits disaient « Créneau libéré : mercredi 2 septembre 2026 à
    9 heures 40 » — la place que le PREMIER contact venait de prendre. CALL-E
    a refusé la tâche (422) avec la question exacte :

        « Quelle est la bonne date du créneau libéré à proposer à madame
          Émilie Aubry ? »

    Il avait raison de demander : les deux dates étaient dans le même envoi.
    """
    recette = configuration.get("recette") or {}
    code = INFO_CRENEAU_PAR_NATURE.get(campagne["nature"])
    if not code or recette.get("mission_editee"):
        return None, None
    infos = dict(configuration.get("infos") or {})
    infos[code] = horaire
    # Les listes de créneaux CALCULÉES sont recalculées : annoncer les places
    # d'hier ferait proposer au téléphone des places déjà prises.
    a_deplacer = rendezvous_a_deplacer(base, campagne)
    jours_ecartes = jours_a_vider(base, campagne)
    for autre in (configuration.get("infos_auto") or {}):
        infos[autre] = creneaux_annonces(base, preferences,
                                         campagne["nature"],
                                         a_deplacer=a_deplacer,
                                         sauf_jours=jours_ecartes,
                                         durees=durees_a_deplacer(base, campagne))
    return construire_mission(campagne["nature"], infos, preferences,
                              configuration.get("options") or {}), infos


def avancer_sur_la_place_suivante(base, preferences, campagne, configuration):
    """Note la place pourvue et passe à la suivante.

    Rend (campagne relue, configuration relue, place suivante ou None,
    raison de l'arrêt quand il n'y a pas de suivante).

    ⚠ ON RELIT LA CAMPAGNE EN BASE. Le dictionnaire que la boucle garde en
    mémoire date du démarrage : continuer avec lui ferait écrire le OUI
    suivant sur la place DÉJÀ POURVUE — deux personnes à la même heure.
    C'est le défaut le plus grave qu'ait trouvé la revue du 03/08/2026.

    ⚠ ON N'AVANCE PAS SI LE MESSAGE NE PEUT PAS SUIVRE. Mieux vaut une
    campagne qui s'arrête en le disant qu'un agent qui annonce une date et
    en réserve une autre.
    """
    # ⚠ ELLE NE REÇOIT PLUS LA PLACE POURVUE. On la lui passait, capturée
    # AVANT l'appel — or avec plusieurs places annoncées, celle qui est prise
    # n'est pas forcément celle-là. C'est la branche « accepted » qui marque,
    # puisqu'elle seule sait laquelle la personne a retenue. Ici on se
    # contente de relire et de chercher la suivante.
    campagne_id = campagne["id"]
    campagne = base.obtenir_campagne(campagne_id)
    configuration = configuration_campagne(campagne)
    suivante = creneau_courant(campagne, configuration)
    if suivante is None:
        return campagne, configuration, None, "toutes les places sont pourvues"
    mission, infos = mission_sur_la_place(base, preferences, campagne,
                                          configuration, suivante["horaire"])
    if mission is None:
        journal.info("Campagne n°%d : il reste des places, mais le message a "
                     "été récrit à la main — on n'avance pas sans recaler la "
                     "date annoncée", campagne_id)
        return (campagne, configuration, None,
                "il reste des places à pourvoir, mais le message de cette "
                "campagne a été récrit à la main et porte la date de sa "
                "place : l'annoncer sur une autre date aurait fait prendre "
                "un rendez-vous à une heure jamais dite au téléphone")
    # ⚠ LA CONFIGURATION SUIT LA PLACE, ELLE AUSSI (01/09/2026). Seules la
    # colonne « creneau » et le message avançaient ; les informations d'étape 2
    # restaient sur la place précédente, et la consigne annonçait donc deux
    # dates pour une seule place. Les infos viennent du MÊME calcul que le
    # message — elles ne peuvent pas diverger de lui.
    a_ecrire = dict(configuration)
    a_ecrire["infos"] = infos
    base.definir_configuration_campagne(
        campagne_id, json.dumps(a_ecrire, ensure_ascii=False))
    base.definir_creneau_campagne(campagne_id, suivante["horaire"], mission)
    campagne = base.obtenir_campagne(campagne_id)
    # ⚠ LA RÈGLE EST REJOUÉE ICI, et nulle part ailleurs : sur la place qui
    # vient d'être choisie, une fois que la campagne la porte vraiment.
    regenerer_la_liste(base, preferences, campagne,
                       configuration_campagne(campagne))
    journal.info("Campagne n°%d : place pourvue, on passe à la suivante (%s)",
                 campagne_id, suivante["horaire"])
    return campagne, configuration_campagne(campagne), suivante, ""


def ordonner_contacts(contacts, ordre, creneau=None):
    """Applique l'ordre d'appel CHOISI à l'étape 2 (jamais imposé)."""
    def date_rdv(contact):
        return champs_contact(contact).get("rdv_existant", "")
    if ordre == "eloignement":
        # ⚠ LE PLUS LOINTAIN D'ABORD, et c'est le défaut de « créneau libéré ».
        # C'est lui qui a le plus à gagner à avancer sur la place qui se
        # libère ; celui dont le rendez-vous est déjà proche n'y gagnerait
        # presque rien. Sans date, on passe en dernier : on ne devine pas.
        return sorted(contacts,
                      key=lambda c: (not date_rdv(c),
                                     _decroissant(date_rdv(c))))
    if ordre == "anciennete":
        return sorted(contacts, key=lambda c: (not date_rdv(c), date_rdv(c)))
    if ordre == "proximite" and creneau:
        creneau_dt = datetime.datetime.fromisoformat(creneau)

        def ecart(contact):
            brut = date_rdv(contact)
            if not brut:
                return (True, datetime.timedelta(0))
            return (False, abs(datetime.datetime.fromisoformat(brut) - creneau_dt))
        return sorted(contacts, key=ecart)
    if ordre == "alphabetique":
        return sorted(contacts,
                      key=lambda c: generation._cle_alphabetique(c["nom"]))
    return list(contacts)  # « liste » : l'ordre des rangs


# ------------------------------------- l'agenda est-il à jour ? (avant ▶)
# Le travail est DOUBLE (§8.1) : déplacer ou prendre un rendez-vous change
# l'agenda LOCAL de RingBack **et** alimente le cahier des changements que
# l'opérateur reporte dans son propre logiciel. Conséquence : TOUT le
# produit s'appuie sur cet agenda — les créneaux annoncés au téléphone en
# sont déduits, et un agenda périmé fait proposer des places déjà prises
# dans la vraie vie. D'où le rappel au moment de démarrer.
#
# Cette fonction ne décide rien et n'estime rien : elle RASSEMBLE LES FAITS
# de la base et des réglages, à l'instant du clic. Ce qui n'existe pas (la
# date du dernier import quand rien n'a jamais été importé) vaut None et
# s'affichera « inconnue » — jamais une valeur inventée.
def _prochaines_annoncees(base, preferences, campagne, maintenant,
                          sauf_places, sauf_jours, combien=3):
    """Les premières places que l'agent annoncera VRAIMENT — écarts compris.

    Le panneau d'avant-démarrage n'a qu'une raison d'exister : lui laisser
    comparer ces dates à son vrai planning. Elles doivent donc sortir du même
    calcul que le message — mêmes journées écartées, mêmes places écartées, et
    la même séparation par durée (une place de 20 minutes ne se propose pas
    pour une séance de 40).
    """
    durees = durees_a_deplacer(base, campagne) or {1: 0}
    pas = horaires.pas_minutes(preferences)
    blocs = []
    for tranches in sorted(durees):
        texte = horaires.places_a_proposer(
            base, preferences, tranches=tranches, depuis=maintenant,
            limite=combien, sauf_places=sauf_places,
            sauf_jours=sauf_jours)[0]
        if not texte:
            continue
        blocs.append(f"pour un rendez-vous de {tranches * pas} minutes : "
                     f"{texte}")
    if not blocs:
        return ""
    if len(blocs) == 1:
        # Une seule durée : pas d'étiquette, c'est le cas courant.
        return blocs[0].split(" : ", 1)[1]
    return " ; ".join(blocs)


def verification_agenda(base, preferences, campagne, contacts=None,
                        maintenant=None):
    """Les faits réels sur l'agenda, juste avant de démarrer CETTE campagne.

    Rend un dictionnaire :
    - « debut », « fin » : la période que touche la campagne (l'horizon des
      créneaux proposables, élargi aux dates propres de la campagne) ;
    - « rendezvous », « occupants » : les rendez-vous connus sur cette
      période, et ceux qui occupent réellement une place ;
    - « places », « places_manuelles », « prochaines » : ce que RingBack
      peut proposer maintenant (calculé + ajouté à la main), et le début de
      la liste telle qu'elle sera annoncée ;
    - « creneaux » : « calcules » (recalculés avant chaque appel),
      « a_la_main » (liste écrite par l'utilisateur, jamais recalculée) ou
      « aucun » ;
    - « import » : la trace du dernier import de fichier, ou None ;
    - « alertes » : les signes OBJECTIFS que l'agenda est douteux.
    """
    maintenant = (maintenant or datetime.datetime.now()).replace(
        second=0, microsecond=0)
    configuration = configuration_campagne(campagne)
    if contacts is None:
        contacts = base.contacts_de_campagne(campagne["id"])
    contacts = list(contacts)
    # 1. La période concernée : l'horizon des créneaux proposables, élargi
    #    aux dates que la campagne touche vraiment (le rendez-vous existant
    #    d'un contact peut tomber bien après cet horizon).
    debut = maintenant
    fin = maintenant + datetime.timedelta(days=horaires.HORIZON_JOURS)
    dates = [campagne.get("creneau")]
    for contact in contacts:
        dates.append(champs_contact(contact).get("rdv_existant"))
        if contact.get("rendezvous_id"):
            rdv = base.obtenir_rendezvous(contact["rendezvous_id"])
            if rdv:
                dates.append(rdv["horaire"])
    for brut in dates:
        try:
            moment = datetime.datetime.fromisoformat(brut)
        except (TypeError, ValueError):
            continue
        debut = min(debut, moment)
        fin = max(fin, moment + datetime.timedelta(minutes=1))
    # 2. Ce que la base connaît sur cette période (aucun chiffre estimé).
    connus = base.rendezvous_de_periode(debut.isoformat(timespec="minutes"),
                                        fin.isoformat(timespec="minutes"))
    occupants = [rdv for rdv in connus
                 if rdv["statut"] in horaires.STATUTS_OCCUPANTS]
    # 3. Ce que RingBack peut proposer à cet instant — les MÊMES écarts que
    #    les créneaux annoncés au téléphone, jamais un autre calcul.
    #
    # ⚠ CE PARAGRAPHE PROMETTAIT DÉJÀ « la MÊME source », et il mentait
    # (mesuré le 17/08/2026). L'appel se faisait sans les journées que la
    # campagne vide, sans les places qu'elle libère et sans les durées : sur sa
    # campagne du 18/08, le panneau annonçait « les premières places qu'il
    # annoncera : le 18/08 à 09h00, 09h40, 10h20 » — trois places du jour même
    # qu'il était en train de vider —, alors que le message de la campagne
    # commençait bien au 19/08. Et c'est le SEUL écran fait pour qu'il
    # vérifie : il lui montrait des dates qui ne seraient jamais dites, en
    # l'invitant à tout arrêter si elles ne lui convenaient pas.
    sauf_places = places_a_vider(base, campagne)
    sauf_jours = jours_a_vider(base, campagne)
    proposables = horaires.creneaux_proposables(base, preferences,
                                                depuis=maintenant)
    places = [entree for entree in proposables
              if not entree["occupe"]
              and entree["horaire"] not in sauf_places
              and entree["horaire"][:10] not in sauf_jours]
    manuelles = [entree for entree in places if entree["origine"] == "à la main"]
    # 4. Cette campagne annonce-t-elle des créneaux, et lesquels ?
    auto = configuration.get("infos_auto") or {}
    mission = campagne.get("mission") or ""
    # Un créneau n'est « annoncé » que s'il figure VRAIMENT dans le message :
    # une liste renseignée dont la phrase n'entre pas dans le texte (segment
    # conditionné par une option décochée) n'annonce rien du tout.
    a_la_main = [configuration["infos"].get(info["code"]) or ""
                 for info in NATURES.get(campagne.get("nature"),
                                         {}).get("infos", ())
                 if info.get("reglage") == "creneaux_lisibles"]
    if any(valeur and valeur in mission for valeur in auto.values()):
        creneaux = "calcules"
    elif any(valeur and valeur in mission for valeur in a_la_main):
        creneaux = "a_la_main"
    else:
        creneaux = "aucun"
    # 5. Les signes OBJECTIFS qu'il y a un problème — dits franchement.
    alertes = []
    semaine_reglee = horaires.semaine_ouverte(preferences)
    if not semaine_reglee:
        alertes.append(
            "Aucune semaine type n'est réglée : RingBack ne sait pas quand "
            "vous êtes ouvert, il ne peut donc calculer AUCUNE place libre.")
    if not connus:
        alertes.append(
            "Aucun rendez-vous n'est connu sur la période concernée : si "
            "votre planning n'est pas vide dans la vraie vie, c'est que "
            "l'agenda de RingBack n'est pas à jour.")
    if semaine_reglee and not places and creneaux == "calcules":
        alertes.append(
            "Aucune place libre n'est calculée : l'agent n'aurait aucun "
            "créneau à annoncer au téléphone.")
    trace = horaires.dernier_import_agenda(preferences)
    return {
        "debut": debut, "fin": fin, "horizon": horaires.HORIZON_JOURS,
        "rendezvous": len(connus), "occupants": len(occupants),
        "places": len(places), "places_manuelles": len(manuelles),
        "prochaines": _prochaines_annoncees(base, preferences, campagne,
                                            maintenant, sauf_places,
                                            sauf_jours),
        "creneaux": creneaux,
        "semaine_reglee": semaine_reglee,
        "a_appeler": sum(1 for c in contacts if c["etat"] == "à appeler"),
        "import": trace,
        "import_jours": ((maintenant - trace["moment"]).days
                         if trace else None),
        "alertes": alertes,
    }


# --------------------------------------------------- cahier de changements
# Le vrai livrable d'une campagne n'est pas « des appels passés » : c'est la
# liste des changements à REPORTER dans le logiciel de planification de
# l'établissement. Quatre genres, et rien d'autre — la table du §8.1.
GENRES_CHANGEMENT = {
    "ajout": ("➕", "Rendez-vous ajouté"),
    "suppression": ("➖", "Rendez-vous supprimé"),
    "deplacement": ("↔", "Rendez-vous déplacé"),
    "humain": ("🙋", "À traiter par un humain"),
    # ⚠ CE CHANGEMENT-LÀ NE TOUCHE PAS AU PLANNING, et il a quand même sa
    # ligne : c'est le seul endroit qui garde QUAND et POURQUOI un contact a
    # cessé d'être appelable. Sans elle, un 🚫 posé au téléphone serait
    # indistinguable d'un 🚫 posé à la main six mois plus tôt.
    "ne_plus_appeler": ("🚫", "Ne plus appeler — demandé au téléphone"),
    # ⚠ PLUS DOUX QUE LE 🚫, et c'est pour cela qu'il a sa propre ligne : la
    # personne reste appelable pour SES rendez-vous, elle refuse seulement
    # qu'on lui propose des places libérées.
    "plus_de_proposition": ("🔇", "Ne plus proposer de créneau — demandé au "
                                  "téléphone"),
    # ⚠ AJOUTÉ LE 11/08/2026 avec la règle du rappel par un humain. Sur une
    # campagne de créneau libéré, une réponse non conclusive fait passer le
    # rendez-vous de la personne en « confirmé » (voir _confirmer_le_rendezvous).
    # C'est un changement de STATUT, pas de date : ni un ajout, ni un
    # déplacement, ni une suppression — d'où sa propre ligne. Et il DOIT en avoir
    # une : l'opérateur a ce statut à reporter dans son propre logiciel.
    "confirmation": ("✅", "Rendez-vous confirmé"),
    # ⚠ AJOUTÉ LE 17/08/2026 avec sa règle : « si la personne doit rappeler, le
    # rendez-vous est simplement annulé ». Ni une suppression (la ligne reste au
    # planning) ni un déplacement (aucune nouvelle date) : sa propre ligne.
    "annulation": ("✖", "Rendez-vous annulé"),
}

# Les deux genres qui RETIRENT un rendez-vous du planning. Ils portent la même
# information — une date qui se libère — et se lisent donc pareil : c'est
# l'ANCIENNE date qu'on montre, jamais une nouvelle (il n'y en a pas).
#
# ⚠ QUI ÉCRIT LEQUEL se décide dans `horaires.genre_de_retrait`, à côté de la
# règle qui décide du statut : le mot du cahier ne peut donc pas diverger de
# l'état du rendez-vous. C'était le défaut n° 5 du 18/08/2026.
GENRES_QUI_RETIRENT = ("suppression", "annulation")


# Les colonnes de l'export, dans l'ordre où on les lit.
COLONNES_CAHIER = ("Changement", "Qui", "Ancienne date", "Nouvelle date",
                   "Motif", "Durée", "Pourquoi / demande")


def duree_lisible_tranches(preferences, tranches):
    """« 30 minutes » depuis un nombre de tranches — la durée SUIT le rendez-vous."""
    try:
        nombre = max(int(tranches or 1), 1)
    except (TypeError, ValueError):
        nombre = 1
    return horaires.duree_lisible(nombre * horaires.pas_minutes(preferences))


def noter_changement(base, campagne, contact, genre, nom=None, **details):
    """Écrit UNE ligne du cahier, à l'instant même où le planning bouge.

    Enregistrer au moment du changement plutôt que de reconstituer après
    coup : c'est la seule façon de garantir qu'aucun changement ne se perd
    (un état de contact écrasé par une relance effacerait la trace).
    """
    contact_id = contact["id"] if contact else None
    return base.ajouter_changement(
        campagne["id"], genre, nom or (contact["nom"] if contact else ""),
        contact_id=contact_id, **details)


def ligne_cahier(changement):
    """UNE ligne du cahier, lisible d'un coup d'œil, rien à déduire.

    Les dates sont en français (« le 03/08/2026 à 09h00 ») parce que
    quelqu'un va les RETAPER dans un autre logiciel.
    """
    icone, libelle = GENRES_CHANGEMENT.get(changement["genre"],
                                           ("•", changement["genre"]))
    morceaux = [f"{icone} {libelle}", changement["nom"]]
    if changement["genre"] == "deplacement":
        morceaux.append(f"du {date_courte(changement['ancienne_date'])} "
                        f"au {date_courte(changement['nouvelle_date'])}")
    elif changement["genre"] in GENRES_QUI_RETIRENT:
        morceaux.append(themes.date_lisible(changement["ancienne_date"]))
    elif changement["nouvelle_date"]:
        morceaux.append(themes.date_lisible(changement["nouvelle_date"]))
    if changement["motif"]:
        morceaux.append(f"motif : {changement['motif']}")
    if changement["duree"]:
        morceaux.append(f"durée : {changement['duree']}")
    if changement["raison"]:
        etiquette = ("demande" if changement["genre"] == "humain"
                     else "pourquoi")
        morceaux.append(f"{etiquette} : {changement['raison']}")
    return " — ".join(morceaux)


def cellules_cahier(changement):
    """Les cellules d'export d'un changement, dans l'ordre de COLONNES_CAHIER."""
    _, libelle = GENRES_CHANGEMENT.get(changement["genre"],
                                       ("•", changement["genre"]))
    return [libelle, changement["nom"],
            themes.date_lisible(changement["ancienne_date"]),
            themes.date_lisible(changement["nouvelle_date"]),
            changement["motif"], changement["duree"], changement["raison"]]


def cahier_texte(changements, titre=""):
    """Le cahier en texte brut — c'est CE texte que le bouton « Copier » copie."""
    lignes = []
    if titre:
        lignes += [titre, "=" * len(titre), ""]
    if not changements:
        lignes.append("Aucun changement à reporter pour l'instant.")
        return "\n".join(lignes) + "\n"
    for changement in changements:
        lignes.append(ligne_cahier(changement))
    lignes += ["", f"{len(changements)} changement(s) à reporter."]
    return "\n".join(lignes) + "\n"


def cahier_csv(changements):
    """Le cahier en CSV (point-virgule), généré à la volée, jamais stocké.

    csv.writer plutôt qu'un « ; ».join : la demande d'un client, notée en
    clair, peut contenir un point-virgule ou un guillemet — elle doit
    ressortir intacte dans le tableur.
    """
    tampon = io.StringIO()
    graveur = csv.writer(tampon, delimiter=";", lineterminator="\r\n")
    graveur.writerow(COLONNES_CAHIER)
    for changement in changements:
        graveur.writerow(cellules_cahier(changement))
    return tampon.getvalue()


def resume_cahier(changements):
    """Le compte par genre, dans l'ordre du §8.1 — pour le bandeau de la fiche."""
    return [(genre, icone, libelle,
             sum(1 for c in changements if c["genre"] == genre))
            for genre, (icone, libelle) in GENRES_CHANGEMENT.items()]


def changement_mis_en_avant(changements):
    """Le déplacement qui a satisfait le besoin (§8.2), ou None.

    « Le résumé met en avant le contact qui a MODIFIÉ son rendez-vous » :
    c'est le dernier ↔ du cahier — celui qui a conclu la campagne.
    """
    deplacements = [c for c in changements if c["genre"] == "deplacement"]
    return deplacements[-1] if deplacements else None


# ------------------------------------------------------------- exécution
def _nombre_tentatives(base, contact_id):
    return len(base.appels_du_contact_campagne(contact_id))


def _rendezvous_manque_par_la_relance(base, contact_id, echeance, maintenant):
    """Le rendez-vous que la relance RATERAIT, sinon None.

    Le rendez-vous se lit là où il est : la colonne liée quand la liste vient
    du planning ou de la base, la date saisie quand elle vient d'un collage.
    Sans rendez-vous — une prise de rendez-vous, par exemple — il n'y a rien à
    devancer, et la relance garde son échéance.

    ⚠ DEUX CONDITIONS, ET LA SECONDE M'AVAIT ÉCHAPPÉ (18/08/2026). Il ne suffit
    pas que l'échéance tombe après le rendez-vous : encore faut-il que ce
    rendez-vous soit ENCORE DEVANT NOUS au moment de l'appel. Ma première
    version n'avait que la première condition, et le banc l'a arrêtée sur onze
    contrôles : une campagne de « rendez-vous MANQUÉS » travaille par
    construction sur des dates passées — la relance n'y est pas trop tard,
    elle EST le suivi. J'aurais envoyé vers un humain tous les rappels de
    manqués du produit.

    On ne protège donc que ce sur quoi on peut encore agir : un rendez-vous à
    venir, qu'une relance trop tardive ferait manquer.
    """
    contact = base.obtenir_contact_campagne(contact_id)
    if contact is None:
        return None
    horaire = None
    if contact.get("rendezvous_id"):
        rdv = base.obtenir_rendezvous(contact["rendezvous_id"])
        if rdv:
            horaire = rdv["horaire"]
    if not horaire:
        horaire = champs_contact(contact).get("rdv_existant")
    if not horaire:
        return None
    instant = maintenant.isoformat(timespec="minutes")
    if horaire > instant and echeance >= horaire:
        return horaire
    return None


def _apres_non_joint(base, preferences, campagne, options, contact_id,
                     issue, maintenant=None):
    """Pas de réponse (ou échec technique) : rappel programmé, ou « injoignable »
    quand le NOMBRE MAXIMAL DE RAPPELS est atteint — jamais d'appel spontané :
    le rappel enregistré attend le geste « Lancer les relances ».

    ⚠ LE MAXIMUM S'APPLIQUE PARTOUT, SIMULATION COMPRISE (21/08/2026, sa
    décision). Il avait demandé le contraire le 18/08 — « en mode simulation, il
    ne faut pas faire la finalité du plafond atteint » —, et c'était pour une
    bonne raison : ses campagnes d'essai s'arrêtaient là sans qu'il voie la
    suite. Deux choses ont changé depuis :

    · CE QUI LE GÊNAIT EST RÉGLÉ AUTREMENT. Au maximum de rappels, une campagne
      de déplacement ANNULE désormais le rendez-vous, libère la place et renvoie
      la personne vers un rappel humain (20/08). Ce n'est plus un cul-de-sac.

    · LA LEVÉE N'AVAIT AUCUNE BORNE, et c'est un essai qui l'a montré : maximum
      réglé à 3, TREIZE rappels armés en douze tours, sans fin — donc aucun
      rendez-vous jamais annulé en simulation. Une simulation qui se comporte
      autrement que le réel ne prédit plus le réel.
    """
    tentatives = _nombre_tentatives(base, contact_id)
    maximum = maximum_rappels(preferences, options)
    if options.get("recontacter", True) and tentatives <= maximum:
        echeance = echeance_relance_campagne(preferences, options, maintenant)
        # ⚠ JAMAIS UNE RELANCE QUI SONNERAIT APRÈS LE RENDEZ-VOUS — son défaut
        # n° 12 du 18/08/2026. L'échéance se calcule à partir de MAINTENANT
        # (délai en heures ouvrées, ou créneau de rappel quotidien) sans jamais
        # regarder la date dont on veut parler à la personne.
        #
        # REPRODUIT : rendez-vous demain à 08h00, appel sans réponse ce soir,
        # créneau de rappel réglé 12h00-14h00 → relance programmée demain à
        # 12h00, QUATRE HEURES après le rendez-vous. On aurait appelé quelqu'un
        # pour déplacer un rendez-vous déjà passé — ou qu'il vient de manquer.
        # C'est le cas courant d'une campagne qui vide le lendemain.
        #
        # On ne programme donc rien, et le contact part vers un humain : il
        # RESTE quelque chose à faire, et seule une personne peut le faire à
        # temps. Même état terminal que les autres impasses (voir
        # `noter_reponse_illisible`) : aucune relance, aucun plafond approché.
        trop_tard = _rendezvous_manque_par_la_relance(
            base, contact_id, echeance,
            maintenant or datetime.datetime.now())
        if trop_tard:
            base.changer_etat_contact_campagne(
                contact_id, "à rappeler par un humain", issue)
            base.definir_detail_contact(
                contact_id,
                f"Pas de réponse. AUCUNE relance programmée : elle serait "
                f"tombée le {date_courte(echeance)}, après son rendez-vous du "
                f"{date_courte(trop_tard)} — trop tard pour lui servir. "
                "Appelez cette personne vous-même.")
            noter_changement(base, campagne,
                             base.obtenir_contact_campagne(contact_id),
                             "humain",
                             ancienne_date=trop_tard,
                             raison="pas de réponse, et une relance serait "
                                    "tombée après son rendez-vous : à appeler "
                                    "par un humain.")
            journal.info("Campagne n°%d, contact n°%d : relance NON programmée "
                         "(%s tomberait après le rendez-vous du %s)",
                         campagne["id"], contact_id, echeance, trop_tard)
            return
        base.creer_relance(campagne["id"], contact_id, echeance,
                           tentative=tentatives,
                           motif=campagnes.MOTIFS_RELANCE.get(issue, issue))
        base.changer_etat_contact_campagne(contact_id, "à recontacter", issue)
        base.definir_detail_contact(contact_id, None)
    else:
        base.changer_etat_contact_campagne(contact_id, "injoignable", issue)
        base.definir_detail_contact(
            contact_id, f"{tentatives} tentative(s) — maximum de rappels "
            "atteint, "
                        "à traiter par un humain")


MOTIF_LIBERATION_CRENEAU = "le client a pris le créneau proposé"
MOTIF_LIBERATION_AUTRE_DATE = "le client a convenu d'une autre date"


def _liberer_ancien_rendezvous(base, preferences, campagne, options, contact,
                               pourquoi=MOTIF_LIBERATION_CRENEAU,
                               maintenant=None, deplace_vers=None,
                               nouveau_rdv_id=None, trace=None):
    """Un OUI libère l'ancien rendez-vous du client (jamais deux rendez-vous
    pour la même personne). Rend une description lisible, ou "".

    Contact repris de la base : SON rendez-vous quitte le planning — avec le
    statut que décide horaires.decision_annulation, la règle du propriétaire
    tenue en un seul endroit (« supprimé » s'il est devant nous, « annulé »
    s'il est déjà passé : le statut d'histoire). Contact collé : si un
    rendez-vous du même client au même horaire existe en base, il subit le
    même sort ; sinon la date saisie est rappelée (l'agenda est ailleurs).
    Si l'option « libérer son créneau » est cochée, l'horaire libéré rejoint
    les créneaux disponibles des réglages (visible dans ⚙ Réglages).
    Dans les deux cas, une ligne ➖ entre au cahier de changements : c'est
    une suppression à reporter dans le logiciel de planification, et elle
    porte QUI, QUAND, le MOTIF et la RAISON — c'est là que vit l'histoire.

    ⚠ `deplace_vers` CHANGE LA NATURE DU GESTE (décision du propriétaire du
    03/08/2026). Avec une date, le client n'a rien annulé : son rendez-vous a
    BOUGÉ. L'ancien prend alors le statut « déplacé » — pas « supprimé », pas
    « annulé » — et le cahier porte UNE ligne ↔ avec ses deux dates, au lieu
    d'un couple suppression + ajout qui raconterait deux gestes pour un seul.
    L'ancienne ligne reste en base : l'heure de départ survit même si la
    campagne est effacée un jour, ce que le cahier seul n'aurait pas permis.
    ⚠ « déplacé » figure déjà dans STATUTS_SANS_PLACE : la place quittée
    redevient donc libre, exactement comme avant.
    """
    ancien = None
    if contact.get("rendezvous_id"):
        ancien = base.obtenir_rendezvous(contact["rendezvous_id"])
    date_saisie = champs_contact(contact).get("rdv_existant", "")
    if ancien is None and date_saisie:
        telephone = base.telephone_contact_campagne(contact["id"])
        ancien = base.rendezvous_identique(contact["nom"], telephone,
                                           date_saisie)
    if ancien is not None and ancien["statut"] in ("prévu", "confirmé",
                                                   "manqué"):
        duree = duree_lisible_tranches(preferences,
                                       horaires.duree_tranches(ancien))
        if deplace_vers:
            # ⚠ UNE SEULE LIGNE, QUI CHANGE DE DATE (décision du propriétaire du
            # 14/08/2026 : « tu déplaces un rendez-vous d'une date à une autre,
            # c'est ultra simple »). AVANT : on créait une SECONDE ligne à la
            # nouvelle date et on marquait l'ancienne « déplacé » — elle restait
            # donc dans l'agenda, et il voyait deux rendez-vous pour un seul
            # déplacement, dont un « déplacé » qui n'était jamais supprimé.
            #
            # L'histoire ne se perd pas pour autant : le cahier des changements
            # porte UNE ligne ↔ avec les deux dates, et c'est LUI le livrable de
            # la campagne. Une ligne fantôme dans l'agenda n'était pas une
            # mémoire, c'était un doublon.
            base.mettre_a_jour_rendezvous(ancien["id"], statut="confirmé",
                                          horaire=deplace_vers)
            # L'appelant DOIT savoir qu'une ligne a bougé : sans cela il en
            # créerait une seconde à la même heure, et l'on retomberait
            # exactement dans le défaut qu'on vient de retirer.
            if trace is not None:
                trace["rendezvous_id"] = ancien["id"]
                trace["ancienne_date"] = ancien["horaire"]
            noter_changement(
                base, campagne, contact, "deplacement",
                client_id=ancien.get("client_id"),
                rendezvous_id=ancien["id"],
                ancienne_date=ancien["horaire"], nouvelle_date=deplace_vers,
                motif=ancien.get("motif") or "", duree=duree,
                raison=f"rendez-vous avancé sur une place libérée : {pourquoi}")
        else:
            decision = horaires.decision_annulation(
                preferences, ancien["horaire"], maintenant)
            base.mettre_a_jour_rendezvous(ancien["id"],
                                          statut=decision["statut"])
            noter_changement(
                base, campagne, contact, horaires.genre_de_retrait(decision["statut"]),
                client_id=ancien.get("client_id"), rendezvous_id=ancien["id"],
                ancienne_date=ancien["horaire"],
                motif=ancien.get("motif") or "", duree=duree,
                raison=f"place libérée : {pourquoi} — {decision['pourquoi']}")
        if options.get("liberer_creneau", True):
            creneaux = list(preferences.obtenir(themes.CLE_CRENEAUX) or [])
            if ancien["horaire"] not in creneaux:
                creneaux.append(ancien["horaire"])
                creneaux.sort()
                preferences.definir(themes.CLE_CRENEAUX, creneaux)
        if deplace_vers:
            return (f"son rendez-vous du "
                    f"{date_courte(ancien['horaire'])} a été DÉPLACÉ ici et "
                    "confirmé — une seule ligne d'agenda, l'ancienne place "
                    "redevient libre")
        return (f"ancien rendez-vous du "
                f"{date_courte(ancien['horaire'])} libéré "
                f"({decision['statut']})")
    if date_saisie:
        # La date est connue (elle vient de la liste), mais le rendez-vous
        # n'est pas dans RingBack : la ligne ➖ garde tout son sens — c'est
        # dans VOTRE logiciel qu'il faut le retirer. Rien n'a été supprimé
        # ici, et la raison le dit.
        noter_changement(
            base, campagne, contact, "suppression",
            ancienne_date=date_saisie,
            motif=champs_contact(contact).get("motif") or "",
            raison=f"ancien rendez-vous à libérer dans votre agenda : "
                   f"{pourquoi}, mais ce rendez-vous n'est pas dans "
                   "RingBack — rien n'a été supprimé ici.")
        return (f"ancien rendez-vous du "
                f"{date_courte(date_saisie)} à libérer dans "
                "votre agenda (introuvable dans la base)")
    return ""


def tranches_du_contact(base, contact):
    """La durée exigée par CE contact, en tranches (1 s'il n'a pas de rendez-vous).

    Un client dont le rendez-vous dure 30 minutes (2 tranches de 15) ne doit
    pas s'entendre proposer un trou de 15 minutes.
    """
    if contact.get("rendezvous_id"):
        rdv = base.obtenir_rendezvous(contact["rendezvous_id"])
        if rdv:
            return horaires.duree_tranches(rdv)
    return 1


# Les natures dont le but est de VIDER des places, pas d'en pourvoir. Sur
# celles-là, les places que la campagne libère ne doivent jamais être
# reproposées : voir `places_a_vider`.
NATURES_QUI_VIDENT = ("deplacement",)

# Les natures où un OUI fait QUITTER une place à quelqu'un. Ce sont les seules
# que l'option « décaler en cascade » concerne : elle ne commande rien d'autre
# que le sort de cette place (voir `_rendre_la_place` et `_suite_de_cascade`).
# Un rappel, une confirmation et une prise de rendez-vous ne déplacent
# personne — la case y était cochable et parfaitement inerte jusqu'au
# 14/08/2026.
NATURES_QUI_LIBERENT_UNE_PLACE = ("creneau_libere", "deplacement")


def nature_porte_un_rendezvous(nature):
    """Les contacts de cette nature ont-ils une colonne « rendez-vous existant » ?

    C'est elle que les deux ordres d'appel par date trient (voir
    `ordonner_contacts`). Sans elle — le cas de la prise de rendez-vous — les
    proposer laissait l'ordre INCHANGÉ, et la fiche annonçait ensuite un ordre
    qui n'avait jamais été appliqué (14/08/2026, audit croisé).
    """
    fiche = fiche_nature(nature) or {}
    return any(champ["code"] == "rdv_existant"
               for champ in fiche.get("champs", ()))


def places_a_vider(base, campagne):
    """Les places que CETTE campagne est en train de vider — jamais reproposées.

    ⚠ L'ÉCART TROUVÉ PAR L'AUDIT DU 14/08/2026, et c'est le plus visible de
    tous. Une campagne « Déplacement de rendez-vous » réglée « appeler toute la
    liste » sert à VIDER une plage — le cas que le produit revendique
    lui-même : « vider une journée entière ». Or les créneaux de remplacement
    sont recalculés avant chaque appel : dès que le premier patient accepte de
    partir, la place qu'il quitte redevient libre… et l'agent la proposait au
    patient suivant. La campagne remplissait le créneau qu'elle devait vider.

    On écarte donc les places des rendez-vous de ses propres contacts — ceux
    qui sont déjà partis comme ceux qui restent à appeler. Sur les autres
    natures, rien à écarter : elles ne vident rien (voir NATURES_QUI_VIDENT).
    """
    if campagne.get("nature") not in NATURES_QUI_VIDENT:
        return ()
    vides = set()
    for contact in base.contacts_de_campagne(campagne["id"]):
        horaire = champs_contact(contact).get("rdv_existant")
        if horaire:
            vides.add(horaire)
        if contact.get("rendezvous_id"):
            rdv = base.obtenir_rendezvous(contact["rendezvous_id"])
            if rdv:
                vides.add(rdv["horaire"])
    return tuple(sorted(vides))


def places_du_contact(base, preferences, contact, sauf_places=(),
                     sauf_jours=()):
    """Ce qu'il y a à proposer À CE CONTACT, à cet instant : (texte, 1re place).

    UN SEUL calcul, à la bonne durée. C'est lui qui alimente à la fois la
    liste annoncée dans le message et la date de référence envoyée à
    l'agent : les deux ne peuvent donc pas diverger, et la place proposée
    au téléphone est toujours la première de celles qui sont annoncées.

    `sauf_places` : les places que la campagne vide et ne doit pas reproposer.
    `sauf_jours` : les JOURNÉES qu'elle vide — écartées en entier, jusqu'aux
    trous qui n'ont jamais porté de rendez-vous (voir `jours_a_vider`).
    """
    return horaires.places_a_proposer(
        base, preferences, tranches=tranches_du_contact(base, contact),
        sauf_places=sauf_places, sauf_jours=sauf_jours)


def stock_du_contact(base, preferences, contact, campagne):
    """Le STOCK de négociation recalculé POUR CE CONTACT, ou "" — sa durée, et
    les places que sa campagne est en train de vider.

    ⚠ POURQUOI IL NE SUFFIT PAS DE REPRENDRE `adaptee` (mesuré le 24/08/2026).
    `adaptee` vient de `places_du_contact`, c'est-à-dire des SIX prochaines
    places libres : de quoi ouvrir la conversation, pas de quoi négocier. Sur
    une campagne de onze déplacements, la campagne enregistrait 77 places et
    l'agent n'en entendait plus que 6 — toutes la même matinée, en 1 h 15.
    C'est exactement le dénouement que sa demande du 16/08/2026 avait fait
    corriger : « les six premières se suivent […] l'agent n'avait donc rien à
    négocier : "non" sur la première valait "non" sur les six. »

    ⚠ ET LE STOCK SUIT CE QUI RESTE À DÉPLACER, comme partout ailleurs : il est
    recalculé à chaque appel, donc il décroît avec la file (sa règle du 17/08 —
    sept places par rendez-vous restant à replacer).

    ⚠ CE N'EST PAS `valeur_calculee_info`, et c'est voulu : celle-ci raisonne au
    niveau de la CAMPAGNE (elle sait faire une liste par durée). Ici, la durée
    est connue — c'est celle de la personne qu'on appelle — et une seule liste
    a un sens. Les exclusions, elles, sont les mêmes qu'ailleurs.
    """
    if campagne is None or campagne.get("nature") not in NATURES_A_STOCK_VARIE:
        return ""
    return horaires.creneaux_negociables(
        base, preferences, tranches=tranches_du_contact(base, contact),
        sauf_places=places_a_vider(base, campagne),
        a_deplacer=rendezvous_a_deplacer(base, campagne),
        sauf_jours=jours_a_vider(base, campagne))


def creneaux_adaptes_au_contact(base, preferences, configuration, contact,
                                mission, adaptee=None, campagne=None):
    """Recalcule la liste de créneaux JUSTE AVANT l'appel — durée comprise.

    Deux raisons, une seule opération :
    1. la liste a été calculée à la CRÉATION de la campagne ; entre-temps
       des places ont pu être prises, des jours déclarés fermés. On ne
       propose au téléphone que ce qui est libre à cet instant précis ;
    2. un client dont le rendez-vous dure 30 minutes (2 tranches de 15) ne
       doit pas s'entendre proposer un trou de 15 minutes.
    N'agit que sur une liste CALCULÉE et laissée telle quelle
    (configuration["infos_auto"]) : une liste retapée à la main n'est jamais
    touchée, et si le texte a été modifié au point que l'ancienne liste n'y
    figure plus, on ne remplace rien — jamais de texte inventé.

    adaptee : la liste déjà calculée par places_du_contact, quand l'appelant
    l'a sous la main (il s'en sert aussi comme date de référence) — on ne
    recalcule alors pas une seconde fois, ce qui garantit que le message et
    la place proposée sortent bien du MÊME calcul.
    """
    auto = configuration.get("infos_auto") or {}
    if not auto:
        return mission
    tranches = tranches_du_contact(base, contact)
    if adaptee is None:
        adaptee = horaires.places_a_proposer(base, preferences,
                                             tranches=tranches)[0]
    if not adaptee:
        return mission
    # ⚠ LA PREMIÈRE PLACE SORT DU MÊME CALCUL, par construction : le texte est
    # bâti par `", ".join(...)` sur la liste dont `places_a_proposer` rend AUSSI
    # le premier élément. Son premier segment EST donc la place de référence
    # envoyée à l'agent — jamais un second calcul qui pourrait diverger.
    premiere = adaptee.split(", ")[0]
    # ⚠ ET LE STOCK, LUI, EST UN STOCK (24/08/2026). Sans campagne sous la
    # main — de vieux appelants, des essais — on retombe sur `adaptee` : c'est
    # le comportement d'avant, jamais pire.
    stock = stock_du_contact(base, preferences, contact, campagne) or adaptee
    remplacements = {}
    for code, valeur in auto.items():
        if not valeur or valeur not in mission:
            continue
        # ⚠ CHACUNE PAR SON PROPRE RÉGLAGE (24/08/2026). Ce maillon-ci écrivait
        # le STOCK dans les deux : le champ « Créneau proposé en premier » —
        # celui que la conduite dictée à l'agent appelle « une seule date, pas
        # la liste » — recevait six dates. Le même défaut avait été corrigé le
        # 17/08 au rafraîchissement du brouillon et à la reprise en cascade ;
        # le troisième maillon, celui de l'instant de l'appel, l'avait gardé.
        neuve = (premiere if reglage_du_code(code) == "creneau_le_plus_proche"
                 else stock)
        if neuve and neuve != valeur:
            remplacements[valeur] = neuve
    if not remplacements:
        return mission
    journal.info("Créneaux recalculés à l'instant de l'appel pour le "
                 "contact n°%d (%d tranche(s) consécutive(s) exigée(s))",
                 contact["id"], tranches)
    return _remplacer_en_une_passe(mission, remplacements)


# ⚠ EN UNE SEULE PASSE, ET C'EST TOUT LE POINT. Les valeurs se contiennent les
# unes les autres : « le mardi 25 août 2026 à 9 heures » est un PRÉFIXE de
# « le mardi 25 août 2026 à 9 heures 15 », et la date seule est un préfixe de
# la liste qui commence par elle. Deux `str.replace` d'affilée font donc mordre
# le second sur ce que le premier vient d'écrire — mesuré le 24/08/2026 : la
# ligne « Créneaux disponibles pour négocier » dictée à l'agent répétait quatre
# fois la même liste et rendait « … à 10 heures 15 15 ».
#
# Une expression, essayée du plus long au plus court : `re.sub` avance sans
# jamais relire ce qu'il a écrit, et l'alternative la plus longue gagne.
def _remplacer_en_une_passe(texte, remplacements):
    """Remplace chaque valeur par la sienne, sans qu'aucune morde sur l'autre."""
    valeurs = sorted((v for v in remplacements if v), key=len, reverse=True)
    if not valeurs:
        return texte
    motif = re.compile("|".join(re.escape(valeur) for valeur in valeurs))
    return motif.sub(lambda trouve: remplacements[trouve.group(0)], texte)


# ⚠ UN CODE, UN RÉGLAGE — quelle que soit la nature qui porte l'information.
# C'est ce qui permet de retrouver le réglage là où l'on n'a pas la nature sous
# la main, sans changer la signature de trois fonctions et de leurs essais. Un
# essai le vérifie sur TOUTES les natures : le jour où deux d'entre elles
# donneraient deux réglages au même code, il le dira avant que ce détour ne
# devienne un mensonge.
def reglage_du_code(code):
    """Le réglage de cette information calculée, ou None si elle n'en a pas."""
    for definition in NATURES.values():
        for info in definition.get("infos", ()):
            if info["code"] == code and info.get("reglage"):
                return info["reglage"]
    return None


def annonce_des_places_calculees(configuration, mission):
    """Ce message annonce-t-il des places CALCULÉES par RingBack ?

    `infos_auto` ne contient que des valeurs calculées à partir de l'agenda —
    et il y en a DEUX SORTES, qu'il ne faut pas confondre (voir
    `valeur_calculee_info`) : le STOCK d'une négociation (« créneaux de
    remplacement », « créneaux proposés », « créneaux d'annulation ») et LA
    date que le message d'ouverture nomme (« créneau le plus proche »). Ici,
    peu importe laquelle : la question est seulement « ce message annonce-t-il
    des places que RingBack a calculées ? ».

    ⚠ CETTE DOCUMENTATION AFFIRMAIT « QUE des listes de places », et c'était
    faux depuis toujours — `creneau_le_plus_proche` y entre lui aussi. Trois
    fonctions ont été écrites sur cette phrase et traitaient donc les deux
    comme du stock. Une documentation qui ment coûte autant qu'un code qui
    ment : elle a coûté sa journée du 17/08/2026.

    Une valeur retapée à la main quitte `infos_auto` — elle appartient alors à
    l'opérateur, et RingBack n'y touche plus.
    """
    auto = configuration.get("infos_auto") or {}
    return any(valeur and valeur in mission for valeur in auto.values())


# ⚠ QUELLE NATURE VEUT UN STOCK VARIÉ (16/08/2026, sa demande). Le déplacement
# NÉGOCIE : il faut de quoi répondre à « plutôt mardi » ou « plutôt l'après-midi
# ». Les autres natures annoncent simplement les prochaines places, et c'est
# très bien ainsi — un rappel de rendez-vous n'a rien à négocier.
NATURES_A_STOCK_VARIE = ("deplacement",)

# ⚠ CELLES QUI PROPOSENT UNE PLACE EN CAS D'ANNULATION (31/08/2026, sa demande).
# Elles ne négocient pas — elles citent quelques dates à voix haute, une par
# une. Elles annonçaient les six prochaines places libres, toutes le même
# matin ; elles annoncent maintenant des jours DIFFÉRENTS, à moins de sept
# jours. Voir horaires.places_de_remplacement.
NATURES_A_PLACES_DE_REMPLACEMENT = ("confirmation", "rappel_rdv")


def durees_a_deplacer(base, campagne):
    """Les durées à replacer et leur nombre : {tranches: combien}.

    ⚠ SA RÈGLE DU 17/08/2026 : « on prévoit des créneaux de durée équivalente
    aux durées de rendez-vous que l'on souhaite annuler. Il faut donc faire
    plusieurs listes de proposition en fonction de la durée des rendez-vous ».

    MESURÉ SUR SA JOURNÉE DU 18/08 : dix rendez-vous de 20 minutes et TROIS de
    40. Les deux listes de places ne sont pas les mêmes — un trou de 20 minutes
    ne peut pas recevoir une séance de 40. Le message n'en portait qu'une, celle
    des 20 minutes : trois personnes s'entendaient donc proposer des heures où
    leur rendez-vous ne tient pas.
    """
    if campagne.get("nature") not in NATURES_A_STOCK_VARIE:
        return {}
    comptes = {}
    for contact in base.contacts_de_campagne(campagne["id"]):
        if contact["etat"] not in ("à appeler", "en cours"):
            continue
        tranches = tranches_du_contact(base, contact)
        comptes[tranches] = comptes.get(tranches, 0) + 1
    return comptes


def durees_du_brouillon(base, brouillon):
    """Les mêmes durées, avant que la campagne existe (étape 2 et « Valider »)."""
    if brouillon.get("nature") not in NATURES_A_STOCK_VARIE:
        return {}
    comptes = {}
    # ⚠ UN CONTACT DE BROUILLON PORTE DÉJÀ « rendezvous_id » — vérifié le
    # 17/08/2026. Ma première version cherchait le rendez-vous par son HORAIRE
    # et n'en trouvait aucun : les onze contacts ressortaient tous à une
    # tranche, et la seconde liste n'existait pas. La même lecture que la
    # campagne fait l'affaire.
    for contact in (brouillon.get("contacts") or []):
        tranches = tranches_du_contact(base, contact)
        comptes[tranches] = comptes.get(tranches, 0) + 1
    return comptes


def etiquette_duree(preferences, tranches):
    """« pour un rendez-vous de 40 minutes » — l'intitulé d'une liste de durée.

    ⚠ UN SEUL ENDROIT L'ÉCRIT. Le stock la pose devant chaque liste
    (`_par_duree`), l'étape 2 la met au-dessus de chaque champ, et le serveur
    la relit pour recoller ce qu'il a saisi. Trois écritures du même intitulé
    auraient fini par se désaccorder d'un mot — et la relecture aurait rendu
    des listes vides sans rien dire.
    """
    return f"pour un rendez-vous de {tranches * horaires.pas_minutes(preferences)} minutes"


def listes_par_duree(preferences, valeur, durees):
    """Le stock DÉCOUPÉ en {tranches: texte} — l'inverse de `_par_duree`.

    Une seule durée : le texte entier lui revient, sans intitulé — c'est ainsi
    qu'il est écrit, et l'étape 2 n'affiche alors qu'un champ.
    """
    ordre = sorted(durees) or [1]
    if len(ordre) == 1:
        return {ordre[0]: valeur}
    listes = {}
    for tranches in ordre:
        marque = etiquette_duree(preferences, tranches) + " : "
        if marque in valeur:
            listes[tranches] = valeur.split(marque, 1)[1].split(" ; ")[0].strip()
        else:
            listes[tranches] = ""
    return listes


def recomposer_par_duree(preferences, valeurs, durees):
    """Recolle les textes saisis — un par durée — dans la forme stockée.

    ⚠ L'ORDRE DES CHAMPS EST CELUI DES DURÉES TRIÉES, des deux côtés : c'est
    la même source (`durees_du_brouillon`) qui décide de l'affichage et de la
    relecture. Deux ordres différents auraient recollé la liste des 40 minutes
    sous l'intitulé des 20.
    """
    ordre = sorted(durees) or [1]
    if len(ordre) == 1:
        return " ".join((valeurs[0] if valeurs else "").split())
    blocs = []
    for tranches, texte in zip(ordre, list(valeurs) + [""] * len(ordre)):
        texte = " ".join((texte or "").split())
        if not texte:
            continue
        blocs.append(f"{etiquette_duree(preferences, tranches)} : {texte}")
    return " ; ".join(blocs)


def _stock_par_duree(base, preferences, nature, depuis, sauf_places,
                     sauf_jours, durees):
    """UNE LISTE PAR DURÉE, chacune annoncée avec la durée qu'elle sert.

    Le nombre de places de chaque liste suit le nombre de rendez-vous DE CETTE
    DURÉE (voir horaires.PAR_RENDEZVOUS_A_DEPLACER) : trois séances de 40
    minutes n'ont pas besoin d'autant de choix que dix de 20.

    La durée est écrite EN MINUTES, en toutes lettres : c'est l'agent qui lit
    ce texte, et « 2 tranches » ne veut rien dire au téléphone.
    """
    pas = horaires.pas_minutes(preferences)
    blocs = []
    for tranches in sorted(durees):
        texte = horaires.creneaux_negociables(
            base, preferences, tranches=tranches, depuis=depuis,
            sauf_places=sauf_places, a_deplacer=durees[tranches],
            sauf_jours=sauf_jours)
        if not texte:
            continue
        blocs.append(f"pour un rendez-vous de {tranches * pas} minutes : "
                     f"{texte}")
    if len(blocs) == 1:
        # Une seule durée : on n'alourdit pas le message d'une étiquette qui
        # n'apporte rien — c'est le cas courant.
        return blocs[0].split(" : ", 1)[1]
    return " ; ".join(blocs)


def creneaux_annonces(base, preferences, nature, depuis=None, sauf_places=(),
                      a_deplacer=0, sauf_jours=(), durees=None):
    """LE texte des créneaux d'une nature — le seul endroit qui décide.

    ⚠ POINT DE PASSAGE UNIQUE, ET C'EST TOUT L'INTÉRÊT. Ce texte se recalcule à
    QUATRE endroits : au pré-remplissage de l'étape 2, quand la campagne change
    de place, quand un maillon de cascade est préparé, et à chaque appel. Poser
    la règle dans trois d'entre eux et l'oublier au quatrième, c'est la
    demi-correction qui a fait tourner en rond le chantier des créneaux
    libérés. Toute nouvelle règle sur les créneaux annoncés s'écrit ICI.

    `a_deplacer` : combien de rendez-vous la campagne doit sortir de leur place.
    Le stock visé suit ce nombre (voir horaires.PAR_RENDEZVOUS_A_DEPLACER) —
    sept personnes à replacer ne se négocient pas avec le stock d'une seule.
    """
    if nature in NATURES_A_STOCK_VARIE:
        if durees:
            return _stock_par_duree(base, preferences, nature, depuis,
                                    sauf_places, sauf_jours, durees)
        return horaires.creneaux_negociables(base, preferences, depuis=depuis,
                                             sauf_places=sauf_places,
                                             a_deplacer=a_deplacer,
                                             sauf_jours=sauf_jours)
    if nature in NATURES_A_PLACES_DE_REMPLACEMENT:
        return horaires.creneaux_de_remplacement(base, preferences,
                                                 depuis=depuis,
                                                 sauf_places=sauf_places,
                                                 sauf_jours=sauf_jours)
    return horaires.creneaux_lisibles(base, preferences, depuis=depuis)


# ⚠ CE QUE VAUT UNE INFORMATION CALCULÉE — UN SEUL ENDROIT, PAR RÉGLAGE.
#
# Les natures déclarent DEUX informations calculées, et elles n'ont rien à voir
# (voir NATURES, `_info(...)`) :
#   - `creneaux_lisibles`      → le STOCK, de quoi négocier. Jamais récité :
#                                l'intitulé du champ le dit en toutes lettres.
#   - `creneau_le_plus_proche` → LA date que le message d'ouverture nomme.
#
# CE QUI N'ALLAIT PAS, mesuré le 17/08/2026 sur sa journée du 18/08 : les trois
# endroits qui rafraîchissent ces valeurs bouclaient sur les CLÉS de
# `infos_auto` sans regarder de quel réglage il s'agissait, et écrivaient le
# stock dans les deux. Résultat à l'écran : le champ « Créneau proposé en
# premier (le plus proche) » portait 1 842 caractères et 77 dates — exactement
# le même texte que le stock d'à côté —, et l'aperçu du message récitait ce
# catalogue. Ce n'est pas ce que l'agent disait (six dates, recalculées par
# contact juste avant l'appel) : l'écran annonçait donc pire que la réalité, et
# c'est sur cet écran qu'il valide.
#
# La règle était pourtant déjà écrite, deux fois : dans l'intitulé du champ, et
# dans `horaires.creneau_le_plus_proche` — « on propose une date, on ne récite
# pas un catalogue ». Ce qui manquait, c'est UN endroit qui la fasse suivre au
# rafraîchissement. Le voici : tout code qui recalcule une information passe
# par ici, et n'a plus à savoir laquelle il tient.
def valeur_calculee_info(base, preferences, nature, reglage, depuis=None,
                         sauf_places=(), a_deplacer=0, sauf_jours=(),
                         durees=None):
    """La valeur d'une information CALCULÉE, selon SON réglage (None sinon).

    Les mêmes écarts s'appliquent aux deux (`sauf_places`, `sauf_jours`) : la
    journée qu'on vide ne se propose pas plus dans la première date que dans le
    stock — sans quoi le message d'ouverture proposerait justement le jour que
    la campagne est en train de libérer.
    """
    if reglage == "creneaux_lisibles":
        return creneaux_annonces(base, preferences, nature, depuis=depuis,
                                 sauf_places=sauf_places,
                                 a_deplacer=a_deplacer, sauf_jours=sauf_jours,
                                 durees=durees)
    if reglage == "creneau_le_plus_proche":
        # La durée retenue est la PLUS LONGUE à replacer : une place qui reçoit
        # une séance de 40 minutes en reçoit une de 20, l'inverse est faux. À
        # l'ouverture du brouillon, aucune durée n'est connue — c'est la durée
        # moyenne, comme avant.
        tranches = max(durees) if durees else 1
        return horaires.creneau_le_plus_proche(
            base, preferences, tranches=tranches, depuis=depuis,
            sauf_places=sauf_places, sauf_jours=sauf_jours)
    return None


def reglage_des_infos(nature):
    """{code de l'information: son réglage} — pour la nature demandée."""
    return {info["code"]: info.get("reglage")
            for info in NATURES.get(nature, {}).get("infos", ())}


def _jours_de(horaires_iso):
    """Les journées (AAAA-MM-JJ) d'une suite d'horaires, sans doublon, triées."""
    return tuple(sorted({horaire[:10] for horaire in horaires_iso if horaire}))


def jours_a_vider(base, campagne):
    """Les JOURNÉES que cette campagne vide — aucune place n'y est proposée.

    ⚠ SA RÈGLE DU 17/08/2026 : « cela a sélectionné des créneaux durant la
    journée que je veux annuler. Il ne faut pas non plus sélectionner des
    créneaux libres sur la ou les journées où l'on a l'annulation ».

    Évident dès qu'on le dit : si le praticien n'est pas là ce jour-là, aucune
    heure de ce jour-là n'est proposable — pas même les trous qui n'ont jamais
    porté de rendez-vous. `places_a_vider` n'écartait QUE les heures des
    rendez-vous à déplacer, et laissait la journée autour.
    """
    return _jours_de(places_a_vider(base, campagne))


def jours_des_contacts(brouillon):
    """Les JOURNÉES sur lesquelles portent les rendez-vous de ses contacts.

    Les contacts d'un brouillon portent la date de leur rendez-vous dans le
    champ « rdv_existant » — c'est cette colonne que l'étape 3 remplit depuis le
    planning ou depuis la base. Vide quand la nature n'en porte pas (prise de
    rendez-vous : il n'y a pas encore de rendez-vous).

    Deux lecteurs, un seul calcul : le NOM de la campagne (voir `nom_campagne`)
    et les journées qu'elle vide (juste en dessous). Deux façons de lister les
    mêmes journées auraient fini par se contredire — un nom qui annonce le
    18/08 pendant que le calcul en écarte un autre.
    """
    return _jours_de(champs_contact(contact).get("rdv_existant")
                     for contact in (brouillon.get("contacts") or []))


def jours_a_vider_du_brouillon(brouillon):
    """La même règle, avant que la campagne existe (étape 2 et « Valider »).

    Seules les natures qui VIDENT écartent leurs journées : un rappel ou une
    confirmation portent aussi sur des journées, mais elles ne les libèrent pas.
    """
    if brouillon.get("nature") not in NATURES_QUI_VIDENT:
        return ()
    return jours_des_contacts(brouillon)


def rafraichir_stock_du_brouillon(base, preferences, brouillon):
    """Remet les listes de places CALCULÉES au nombre réel de gens à déplacer.

    Rend True si quelque chose a changé. Appelée à DEUX endroits, et il en faut
    les deux : à l'affichage de l'étape 2, et à « Valider ».

    ⚠ SON CONSTAT DU 17/08/2026 : « j'ai fait un essai de décalage de 11
    rendez-vous et j'ai seulement 19 créneaux pour négocier », puis, capture à
    l'appui : « est-ce simplement un problème d'affichage ? ». Oui — et non.
    Le champ de l'étape 2 est pré-rempli à l'OUVERTURE du brouillon, avant
    l'étape 3 : la liste des gens n'existe pas encore, le stock est donc calculé
    pour zéro. Ce n'est « que » l'affichage, mais cet affichage est un CHAMP :
    s'il y touche, ses dix-neuf dates deviennent la liste définitive (une valeur
    retapée quitte `infos_auto` et n'est plus jamais recalculée). Un champ qui
    montre faux invite à figer le faux.

    ⚠ ON REMPLACE LA LISTE DANS LE MESSAGE, ON NE LE RECONSTRUIT PAS. Ma
    première version rappelait `construire_mission` : elle rendait un texte SANS
    la phrase des dates, et la campagne se croyait alors autorisée à appeler
    alors qu'il ne restait aucune place — un essai du produit l'a attrapée. Une
    substitution ne peut rien perdre, et un message retapé arrive intact.
    """
    nature = brouillon.get("nature")
    if nature not in NATURES_A_STOCK_VARIE:
        return False
    a_deplacer = len(brouillon.get("contacts") or [])
    if not a_deplacer:
        return False
    infos = brouillon["infos"]
    auto = brouillon.get("infos_auto") or {}
    jours_ecartes = jours_a_vider_du_brouillon(brouillon)
    durees = durees_du_brouillon(base, brouillon)
    reglages = reglage_des_infos(nature)
    change = False
    for code, ancien in list(auto.items()):
        # Une liste retapée à la main appartient à l'opérateur : on n'y touche
        # pas. C'est ce que dit `infos.get(code) != ancien`.
        if not ancien or infos.get(code) != ancien:
            continue
        # ⚠ CHAQUE INFORMATION SE RECALCULE PAR SON PROPRE RÉGLAGE. Cette
        # boucle écrivait le stock dans TOUTES : « le plus proche » recevait
        # donc le catalogue entier. Voir `valeur_calculee_info`.
        frais = valeur_calculee_info(base, preferences, nature,
                                     reglages.get(code),
                                     a_deplacer=a_deplacer,
                                     sauf_jours=jours_ecartes, durees=durees)
        if not frais or frais == ancien:
            continue
        infos[code] = auto[code] = frais
        brouillon["mission"] = (brouillon.get("mission") or "").replace(
            ancien, frais)
        change = True
    return change


def rendezvous_a_deplacer(base, campagne):
    """Combien de rendez-vous cette campagne doit encore sortir de leur place.

    ⚠ CE QUI RESTE À FAIRE, pas la taille de la liste. Un contact déjà appelé a
    consommé sa place ; le stock doit couvrir CEUX QUI ATTENDENT. Sur une
    campagne qui n'est pas un déplacement, rien à déplacer : zéro.
    """
    if campagne.get("nature") not in NATURES_A_STOCK_VARIE:
        return 0
    # Les deux états d'un contact qui attend son appel — les mêmes que la file
    # d'exécution retient (voir `file_utile` dans executer_campagne).
    return sum(1 for contact in base.contacts_de_campagne(campagne["id"])
               if contact["etat"] in ("à appeler", "en cours"))


def _plus_rien_a_annoncer(base, campagne, contact):
    """Le message annonçait des places calculées, il n'en reste AUCUNE.

    ⚠ L'ÉCART TROUVÉ PAR L'AUDIT DU 14/08/2026, et il touche les quatre natures
    « classiques ». La liste des places est calculée à la CRÉATION de la
    campagne et recalculée avant chaque appel — mais le recalcul ne remplace
    rien quand il rend vide (« jamais de texte inventé », voir
    `creneaux_adaptes_au_contact`). L'agenda s'étant rempli entre-temps, l'agent
    partait donc annoncer au téléphone six dates TOUTES OCCUPÉES ; chaque OUI
    revenait ensuite « à rappeler par un humain » puisqu'aucun rendez-vous ne
    pouvait être écrit. Et le repli qui existait — `_sans_place_a_proposer` —
    n'était atteint que si le contact n'avait AUCUN rendez-vous : sur
    « déplacement », il en a toujours un, la nature n'était donc protégée par
    rien.

    C'est le même travail que `_place_perdue` fait pour « créneau libéré » : ne
    pas partir sur une place qui n'existe plus. Ici on ne le fait pas au
    démarrage mais avant CHAQUE appel, parce que la liste est propre à chaque
    contact (sa durée) et qu'elle bouge à mesure que la campagne remplit
    l'agenda.
    """
    note = ("Personne n'a été appelé : le message annonce des créneaux "
            "calculés par RingBack, et il n'en reste plus AUCUN de libre "
            f"dans les {horaires.HORIZON_JOURS} prochains jours. L'agent "
            "aurait proposé des dates déjà prises. Libérez une place, ou "
            "ouvrez des horaires dans « ⚙ Réglages », puis relancez ce "
            "contact — aucune date n'a été inventée.")
    base.changer_etat_contact_campagne(contact["id"],
                                       "à rappeler par un humain", None)
    base.definir_detail_contact(contact["id"], note)
    noter_changement(base, campagne, contact, "humain",
                     motif=champs_contact(contact).get("motif") or "",
                     raison=note)
    journal.info("Campagne n°%d, contact n°%d : le message annonce des "
                 "créneaux calculés et il n'en reste aucun — aucun appel n'est "
                 "parti", campagne["id"], contact["id"])
    return None


def _date_refusee(base, campagne, contact, refus, date_convenue,
                  texte=None, complement="", cible=None, telephone=None,
                  rdv_du_contact=None):
    """Le client a dit oui, mais la date convenue ne tient pas : rien n'est écrit.

    La règle du propriétaire, à la lettre : le rendez-vous n'est PAS créé,
    le contact passe « à rappeler par un humain » avec la date demandée EN
    CLAIR, et l'écran dit pourquoi. Une ligne 🙋 entre au cahier de
    changements : ce qui a été obtenu au téléphone n'est jamais perdu, même
    quand le produit refuse de l'écrire. Rend toujours None (aucune
    politique « premier oui » ne peut être conclue par un accord qu'on n'a
    pas pu honorer).

    ⚠ SAUF SUR UN CRÉNEAU LIBÉRÉ, où il a fait RETIRER cet état (constaté à
    nouveau le 15/08/2026 : huit contacts « 🙋 à rappeler par un humain » dans
    ses quatre campagnes, tous par ce chemin). Sa raison, écrite le 11/08 :
    « le créneau est certainement attribué à quelqu'un d'autre, alors ce sera
    contacter quelqu'un pour lui dire "en fait on voulait vous demander quelque
    chose, mais ce n'est plus d'actualité" » — rappeler serait déranger pour
    rien. Voir NATURES_RAPPEL_HUMAIN et `_rien_de_conclu`, qui tenaient déjà la
    règle sur LEUR chemin ; celui-ci l'ignorait.

    La fin est alors la même que pour une réponse non conclusive : état
    REFUSÉ — vrai de la PLACE, qui part à quelqu'un d'autre, sans rien
    affirmer sur la personne — et son rendez-vous CONSERVÉ, passé en
    « confirmé ». La date qu'elle demandait et la raison du refus restent
    écrites en clair sur sa fiche : rien de ce qui a été dit au téléphone
    n'est perdu, c'est seulement l'agenda qui n'est pas touché (§6.5).
    """
    contact_id = contact["id"]
    sans_rappel = campagne["nature"] == "creneau_libere"
    note = texte or horaires.note_date_refusee(refus, date_convenue,
                                               rappel_humain=not sans_rappel)
    if complement:
        note = f"{note} {complement}"
    if sans_rappel:
        base.changer_etat_contact_campagne(
            contact_id, "refusé", planificateur.ISSUE_DATE_REFUSEE)
        note += " Cette personne conserve son rendez-vous"
        note += (_confirmer_le_rendezvous(base, campagne, contact, cible or {},
                                          telephone, rdv_du_contact,
                                          f"date convenue refusée : {refus}")
                 or ".")
        base.definir_detail_contact(contact_id, note)
        journal.info("Campagne n°%d, contact n°%d : date convenue REFUSÉE "
                     "(%s) — aucun rendez-vous créé, et AUCUN rappel manuel "
                     "(créneau libéré)", campagne["id"], contact_id,
                     date_convenue)
        return None
    base.changer_etat_contact_campagne(contact_id,
                                       "à rappeler par un humain",
                                       planificateur.ISSUE_DATE_REFUSEE)
    base.definir_detail_contact(contact_id, note)
    noter_changement(base, campagne, contact, "humain",
                     nouvelle_date=date_convenue,
                     motif=champs_contact(contact).get("motif") or "",
                     raison=note)
    journal.info("Campagne n°%d, contact n°%d : date convenue REFUSÉE (%s) — "
                 "aucun rendez-vous créé", campagne["id"], contact_id,
                 date_convenue)
    return None


def _place_de_la_campagne(campagne, configuration, horaire):
    """Cet horaire est-il une place de CETTE campagne, encore à pourvoir ?

    Sert à distinguer « le client a convenu d'une date à lui » de « le client a
    pris l'une des places qu'on venait de lui citer » — deux choses que la
    branche « autre date convenue » traitait de la même façon.
    """
    if not horaire:
        return False
    for fiche in creneaux_de(campagne, configuration):
        if fiche["horaire"] == horaire:
            return fiche.get("statut") == CRENEAU_A_POURVOIR
    return False


def _perdre_la_place_si_prise(base, preferences, campagne, configuration,
                              place):
    """Cette place vient d'être refusée : est-elle morte pour TOUT LE MONDE ?

    Si oui, elle passe « perdue » et la campagne cesse de l'annoncer. Rend la
    phrase à ajouter au détail du contact, ou "" si la place tient toujours.

    ⚠ LE DÉFAUT MESURÉ DANS SA BASE (14/08/2026). Une personne avait convenu
    d'une autre date — 15 h 30, hors du quadrillage des créneaux — et ce
    rendez-vous chevauchait la place de 15 h 40 que la campagne proposait
    encore. Les VINGT-QUATRE personnes suivantes ont dit oui à cette place,
    chacune s'est vu refuser le rendez-vous, et chacune est partie « à
    rappeler par un humain » : vingt-quatre appels pour rien, et un état que le
    propriétaire avait justement retiré du créneau libéré.

    ⚠ ON REJUGE AVEC UNE SEULE TRANCHE, et c'est tout le raisonnement. « Il
    n'y a que vingt minutes d'affilée, il en manque une » parle de la DURÉE DE
    CE RENDEZ-VOUS, pas de la place : la déclarer perdue arrêterait la campagne
    pour tous les autres, dont certains tiennent en vingt minutes. Même
    distinction que dans `_place_perdue`, et pour la même raison.
    """
    # ⚠ « POURVU PAR NOUS » N'EST PAS « PRIS AILLEURS », et c'est la première
    # chose à écarter. Sur une campagne réglée « appeler toute la liste », le
    # premier oui pourvoit la place ; le deuxième se la voit refuser — elle est
    # occupée, mais par NOUS. La marquer perdue effacerait le fait qu'elle a
    # servi, et l'écran le dirait de travers. C'est le même piège que celui qui
    # avait fait tomber vingt contrôles du banc le 11/08/2026.
    deja = {f["horaire"]: f.get("statut")
            for f in creneaux_de(campagne, configuration)}
    if deja.get(place) != CRENEAU_A_POURVOIR:
        return ""
    if not horaires.refus_rendezvous_telephone(base, preferences, place,
                                               tranches=1, place_choisie=True):
        return ""
    pourquoi = "place prise entre-temps par un autre rendez-vous"
    liste = marquer_creneau(base, campagne["id"], place, CRENEAU_PERDU,
                            pourquoi=pourquoi)
    # ⚠ ET DANS LA CONFIGURATION QUE LA BOUCLE TIENT EN MAIN, pas seulement en
    # base : c'est elle qui sert à choisir les places annoncées au contact
    # suivant, et elle n'est relue qu'à chaque place pourvue.
    configuration["creneaux"] = liste
    reste = sum(1 for f in liste if f["statut"] == CRENEAU_A_POURVOIR)
    journal.info("Campagne n°%d : la place %s est PERDUE (prise ailleurs) — "
                 "elle ne sera plus proposée (%d place(s) restante(s))",
                 campagne["id"], place, reste)
    return (f"La place du {date_courte(place)} a été prise entre-temps : elle "
            f"est retirée de cette campagne, plus personne ne se la verra "
            f"proposer ({reste} place(s) encore à pourvoir).")


def _rendezvous_vise(base, contact, telephone):
    """LE rendez-vous en base que ce contact concerne, ou None.

    Contact repris de la base : le sien. Contact collé : le rendez-vous du
    même client au même horaire que la colonne « rendez-vous existant »,
    s'il existe — jamais de rendez-vous inventé.
    """
    if contact.get("rendezvous_id"):
        return base.obtenir_rendezvous(contact["rendezvous_id"])
    date_saisie = champs_contact(contact).get("rdv_existant", "")
    if date_saisie:
        return base.rendezvous_identique(contact["nom"], telephone, date_saisie)
    return None


# ------------------------------------------------- décalage en cascade (§8.3)
# LA RÈGLE DU PROPRIÉTAIRE, à la lettre. Un contact accepte de décaler son
# rendez-vous : la campagne s'achève, le changement entre au cahier, l'agenda
# local est modifié — et, SI l'option de cascade est réglée, une NOUVELLE
# campagne est PRÉPARÉE sur **la place que ce contact vient de libérer**.
#
# Cette campagne est la MÊME que celle d'origine, à un détail près : son
# créneau. Nature, message, options, ordre d'appel, source de contacts,
# champs — tout est repris ; seule la LISTE est recalculée, avec les mêmes
# critères appliqués au nouveau créneau.
#
# CE QUI FAIT CONVERGER LA CHAÎNE : un créneau n'intéresse que les gens qu'il
# ARRANGE. Les contacts dont le rendez-vous est ANTÉRIEUR au nouveau créneau
# sont écartés (les décaler leur ferait perdre du temps, pas en gagner). Le
# créneau d'un maillon est donc toujours STRICTEMENT plus tard que celui du
# précédent : la liste se resserre à chaque fois, et la chaîne s'épuise
# d'elle-même au lieu de tourner en rond.
#
# Aucun appel ne part jamais tout seul : chaque maillon naît « prête », et
# c'est l'opérateur qui valide. Les butées, cumulatives :
#   1. l'option doit être cochée ET porter une date limite ;
#   2. le créneau libéré doit tomber AVANT cette date limite ;
#   3. la chaîne ne dépasse jamais CASCADE_PROFONDEUR_MAX maillons ;
#   4. jamais deux campagnes pour le MÊME créneau ;
#   5. sans recette reproductible (liste écrite à la main), on ne prépare
#      RIEN et on dit pourquoi — jamais de liste inventée.
CASCADE_PROFONDEUR_MAX = 5

# L'information d'étape 2 qui porte le créneau de la campagne, par nature.
# Elle seule change quand on rejoue une campagne sur une autre place.
INFO_CRENEAU_PAR_NATURE = {"creneau_libere": "creneau_libere"}


def cascade_reglee(options):
    """La date limite de « décaler en cascade jusqu'au [date] », ou None."""
    if not options.get("cascade"):
        return None
    return (options.get("cascade_jusqu_au") or "").strip() or None


def libelle_cascade(configuration):
    """Ce que fait « décaler en cascade » sur CETTE campagne, en une phrase.

    Écrit ici, et pas dans le gabarit : le comportement dépend de deux choses
    (l'option, et le fait que la campagne porte une liste ou une seule place),
    et une phrase calculée dans une accolade de gabarit finit toujours par
    dire autre chose que ce que le code fait.
    """
    options = configuration.get("options") or {}
    if configuration.get("nature") not in NATURES_QUI_LIBERENT_UNE_PLACE:
        return ("sans objet — cette campagne ne fait quitter sa place à "
                "personne")
    if not options.get("cascade"):
        return ("non — les places quittées restent libres sur votre planning, "
                "et c'est vous qui décidez d'en faire quelque chose")
    limite = cascade_reglee(options)
    borne = (f", jusqu'au {date_jour_lisible(limite)}" if limite
             else ", sans date limite")
    if configuration.get("liste_de_places"):
        return (f"oui{borne} — la place quittée rejoint cette campagne, qui "
                "continue dessus")
    return (f"oui{borne} ({CASCADE_PROFONDEUR_MAX} maillons au maximum) — la "
            "campagne suivante, sur la place libérée, est PRÉPARÉE, jamais "
            "lancée")


def _profondeur_cascade(configuration):
    try:
        return int((configuration.get("cascade") or {}).get("profondeur") or 0)
    except (TypeError, ValueError):
        return 0


def _creneau_deja_prepare(base, creneau):
    """Vrai si une campagne porte DÉJÀ ce créneau — jamais deux fois le même.

    La butée d'anti-doublon de la nouvelle règle. Celle d'hier (« ne jamais
    viser deux fois le même rendez-vous ») n'a plus d'objet : on ne vise plus
    l'occupant d'une place, on repart d'une place libérée.
    """
    return any((campagne["creneau"] or "") == creneau
               for campagne in base.lister_campagnes())


def preparer_cascade_creneau_libere(base, preferences, campagne, configuration,
                                    demandeur, creneau_libere,
                                    rendezvous_bouge=None):
    """§8.3 — rejoue LA MÊME campagne sur la place que le client vient de libérer.

    Rend {"campagne_id", "creneau", "contacts", "ecartes", "profondeur"} si
    une campagne a été préparée (état « prête », aucun appel), sinon
    {"raison": texte} qui dit POURQUOI la chaîne s'arrête là — c'est cette
    phrase qui s'affiche, jamais un silence.
    """
    options = configuration["options"]
    limite = cascade_reglee(options)
    if not limite:
        return {"raison": "l'option « décaler en cascade jusqu'au [date] » "
                          "n'est pas réglée pour cette campagne — aucune "
                          "campagne n'a été préparée."}
    if not creneau_libere:
        return {"raison": "aucune place libérée n'est connue — rien n'a pu "
                          "être préparé."}
    profondeur = _profondeur_cascade(configuration) + 1
    if profondeur > CASCADE_PROFONDEUR_MAX:
        return {"raison": "butée de sécurité : la chaîne de campagnes atteint "
                          f"{CASCADE_PROFONDEUR_MAX} maillons — elle s'arrête "
                          "ici, un humain reprend la main."}
    if creneau_libere[:10] > limite:
        return {"raison": "la chaîne s'arrête à la date limite réglée "
                          f"({date_jour_lisible(limite)}) : la place libérée "
                          f"({date_courte(creneau_libere)}) tombe au-delà."}
    if _creneau_deja_prepare(base, creneau_libere):
        return {"raison": "une campagne porte déjà le créneau du "
                          f"{date_courte(creneau_libere)} — aucune n'a été "
                          "préparée en double."}
    recette = configuration.get("recette") or {}
    # ⚠ DEUX CRITÈRES REJOUABLES, DANS CET ORDRE (15/08/2026).
    #
    # 1. LA RECETTE, quand elle existe. C'est elle qui a réellement rempli la
    #    grille — collage, fichier, agenda importé, source de la base — et c'est
    #    donc elle qui dit ce que l'opérateur voulait.
    # 2. SA RÈGLE, sinon. Une campagne montée EN AUTOMATIQUE ne note aucun
    #    apport : c'est `regenerer_la_liste` qui la remplit. La recette restait
    #    donc vide, et la cascade refusait de préparer la suite en accusant
    #    l'opérateur d'avoir « choisi la liste à la main » — alors que son
    #    critère était là, écrit sur la campagne. Constaté sur sa campagne n°5 :
    #    règle « à venir, au moins 30 jours », recette vide, chaîne arrêtée net.
    #
    # L'ordre compte dans LES DEUX SENS : la règle d'abord cassait la chaîne des
    # campagnes chargées à la main, où elle porte sa source par défaut
    # (« à recaser »), sans rapport avec la liste réellement montée.
    #
    # Rejouer la règle est ce qui répond à sa demande du 15/08 : elle porte le
    # gain minimum, qui se recalcule sur la NOUVELLE place — « le créneau du
    # 15/09 cherche des contacts à partir du 15/10 ».
    regle = None if recette_reproductible(recette) else regle_de_liste(
        configuration)
    if not regle and not recette_reproductible(recette):
        return {"raison": "la liste de cette campagne a été choisie à la main "
                          "(collage, fichier, agenda importé, ou rendez-vous "
                          "désigné dans le planning) : il n'y a "
                          "aucun critère à rejouer sur un autre créneau. "
                          "Rien n'a été préparé — aucune liste n'est "
                          "inventée. Créez la campagne suivante depuis "
                          "« ➕ Nouvelle campagne »."}
    nature = campagne["nature"]
    code_creneau = INFO_CRENEAU_PAR_NATURE.get(nature)
    if recette.get("mission_editee") and code_creneau:
        return {"raison": "le message de cette campagne a été récrit à la "
                          "main et porte la date de son créneau : il ne peut "
                          "pas être rejoué sur une autre date sans inventer "
                          "du texte. Aucune campagne n'a été préparée."}
    champs = champs_campagne(configuration)
    try:
        if regle:
            # La règle se rejoue SUR LA PLACE LIBÉRÉE : le gain minimum repart
            # donc de cette date-là, pas de celle de la campagne d'origine.
            contacts, _ = contacts_de_la_regle(base, preferences, regle,
                                               champs, creneau_libere)
        else:
            contacts, _ = contacts_de_recette(base, recette, champs,
                                              preferences)
    except SaisieInvalide as erreur:
        return {"raison": "la recette de cette campagne n'a pas pu être "
                          f"rejouée : {erreur}"}
    retenus, ecartes = resserrer_sur_le_creneau(contacts, creneau_libere,
                                                [rendezvous_bouge])
    if not retenus:
        details = [f"{ecartes['anterieurs']} contact(s) écarté(s) : leur "
                   "rendez-vous est AVANT cette place, la décaler leur ferait "
                   "perdre du temps"]
        if ecartes["sans_date"]:
            details.append(f"{ecartes['sans_date']} sans rendez-vous connu")
        if ecartes["deja_bouge"]:
            details.append(f"{ecartes['deja_bouge']} qui vient justement de "
                           "quitter cette place")
        return {"raison": "plus personne n'a de rendez-vous APRÈS la place "
                          f"libérée du {date_courte(creneau_libere)} — "
                          + " ; ".join(details)
                          + ". La chaîne s'arrête d'elle-même."}
    # ⚠ ET LE PLAFOND S'APPLIQUE AU MAILLON, pas seulement à la campagne
    # d'origine (14/08/2026, audit croisé). L'écran annonce « avec les mêmes
    # critères » : un plafond réglé à cinq qui laissait entrer quarante
    # personnes dans la campagne préparée démentait cette phrase, et c'est
    # justement le réglage qui protège le crédit d'appels.
    plafond = plafond_de(configuration)
    retenus, hors_plafond = limiter_au_plafond(
        retenus, plafond, ordre=configuration.get("ordre"),
        creneau=creneau_libere)
    if hors_plafond:
        journal.info("Cascade : %d contact(s) écarté(s) par le plafond de %s "
                     "personne(s), repris de la campagne n°%d",
                     hors_plafond, plafond, campagne["id"])
    # Tout est repris de la campagne d'origine ; SEUL le créneau change.
    infos = dict(configuration["infos"])
    if code_creneau:
        infos[code_creneau] = creneau_libere
    # Les listes de créneaux CALCULÉES sont recalculées : annoncer les places
    # d'hier ferait proposer au téléphone des places déjà prises. Une liste
    # récrite à la main (absente d'infos_auto) est reprise telle quelle.
    infos_auto = {}
    a_deplacer = rendezvous_a_deplacer(base, campagne)
    jours_ecartes = jours_a_vider(base, campagne)
    durees = durees_a_deplacer(base, campagne)
    reglages = reglage_des_infos(nature)
    for code in (configuration.get("infos_auto") or {}):
        # ⚠ PAR SON PROPRE RÉGLAGE, comme au rafraîchissement du brouillon :
        # ce maillon écrivait lui aussi le stock dans « le plus proche ».
        valeur = valeur_calculee_info(base, preferences, nature,
                                      reglages.get(code),
                                      a_deplacer=a_deplacer,
                                      sauf_jours=jours_ecartes, durees=durees)
        if not valeur:
            continue
        infos[code] = valeur
        infos_auto[code] = valeur
    mission = (campagne["mission"] if recette.get("mission_editee")
               else construire_mission(nature, infos, preferences, options))
    brouillon = {
        "nature": nature,
        "infos": infos,
        "infos_auto": infos_auto,
        "politique": configuration["politique"],
        "ordre": configuration.get("ordre") or "liste",
        "options": dict(options),
        "champs": [dict(champ) for champ in configuration.get("champs", [])],
        "contacts": retenus,
        "mission": mission,
        # ⚠ LE PLAFOND SUIT LE MAILLON (14/08/2026, audit croisé). L'écran
        # annonce « la campagne n°X a été PRÉPARÉE, avec les mêmes critères » :
        # sans cette ligne, c'était faux sur le point qui compte le plus — un
        # plafond réglé à cinq était perdu, et le maillon chargeait tout le
        # monde. Et il n'était pas seulement ignoré : il n'était pas enregistré,
        # donc l'écran de la campagne préparée ne pouvait même pas le dire.
        "plafond": str(configuration.get("plafond") or ""),
        # ⚠ ET LA RÈGLE AUSSI (15/08/2026) : sans elle, le maillon naissait avec
        # une liste figée et la chaîne s'arrêtait au premier relais. C'est
        # pourtant la règle qui fait tout le travail — elle se rejoue sur la
        # place de CE maillon, avec le gain recalculé depuis cette date.
        "mode_liste": "automatique" if regle else "manuel",
        "regle_liste": dict(regle or {}),
        "recette": dict(recette),
        # ⚠ LE MAILLON PORTE LA PLACE LIBÉRÉE, quelle que soit sa nature — c'est
        # la règle §8.3, et c'est aussi ce qui empêche d'en préparer deux pour la
        # même place (voir `_creneau_deja_prepare`). Sur une nature qui n'annonce
        # pas de place — « déplacement » annonce des créneaux de REMPLACEMENT —
        # cette place est une TRACE, pas une place à pourvoir : c'est la boucle
        # d'exécution qui doit le savoir, et elle le sait depuis le 14/08 (voir
        # `campagne_a_des_places` dans `executer_campagne`).
        "creneau": creneau_libere,
        "creneaux": normaliser_creneaux([creneau_libere]),
    }
    brouillon["options"]["cascade_origine"] = campagne["id"]
    nouvelle_id = creer_campagne_prete(base, brouillon, preferences)
    marquer_cascade(base, nouvelle_id, {
        "origine": campagne["id"], "profondeur": profondeur,
        "jusqu_au": limite, "creneau": creneau_libere, "demandeur": demandeur,
        "profondeur_max": CASCADE_PROFONDEUR_MAX,
        "retenus": len(retenus), "ecartes": ecartes})
    journal.info("Cascade : campagne n°%d PRÉPARÉE (prête, maillon %d/%d) sur "
                 "la place du %s libérée par %s — %d contact(s) retenu(s), "
                 "%d écarté(s) parce qu'antérieur(s), %d sans date ; aucun "
                 "appel n'est parti", nouvelle_id, profondeur,
                 CASCADE_PROFONDEUR_MAX, creneau_libere, demandeur,
                 len(retenus), ecartes["anterieurs"], ecartes["sans_date"])
    return {"campagne_id": nouvelle_id, "creneau": creneau_libere,
            "contacts": [c["nom"] for c in retenus], "ecartes": ecartes,
            "profondeur": profondeur}


def marquer_cascade(base, campagne_id, marque):
    """Inscrit le maillon de cascade dans la configuration de la campagne."""
    campagne = base.obtenir_campagne(campagne_id)
    configuration = configuration_campagne(campagne)
    configuration["cascade"] = marque
    base.definir_configuration_campagne(
        campagne_id, json.dumps(configuration, ensure_ascii=False))


def date_jour_lisible(iso_jour):
    """« 2026-08-15 » devient « 15/08/2026 » (une date seule, sans heure)."""
    try:
        return datetime.date.fromisoformat(iso_jour).strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return iso_jour or ""


def _support_de_l_appel(campagne, contact, nature, place_libre,
                        place_alternative=None):
    """Le rendez-vous de RÉFÉRENCE envoyé à l'agent, ou None s'il n'y en a pas.

    Trois cas, dans cet ordre :

    1. le contact a SON rendez-vous (colonne « rendez-vous existant » des
       natures 🔔 rappel, ✅ confirmation, 📆 déplacement, 📞 créneau
       libéré) : c'est de celui-là qu'on lui parle, rien ne change ;
    2. la campagne porte un créneau choisi par l'utilisateur (📞 créneau
       libéré) : c'est LA place qu'on cherche à pourvoir, elle est FIXE —
       la cascade se charge de la suite ;
    3. les natures SANS rendez-vous par contact (🗓 prise de rendez-vous,
       🎯 contact unique, ☎ rappel d'appel manqué, ✍ personnalisé) : la
       référence est la PROCHAINE PLACE LIBRE, recalculée à l'instant de
       CET appel. Comme une réservation crée un rendez-vous, la place quitte
       d'elle-même les places libres de l'appel suivant : le créneau avance
       tout seul, et deux personnes ne se voient plus proposer la même.

    Rend None quand il n'y a plus aucune place à proposer (cas 3 seulement) :
    l'appelant le dit franchement plutôt que d'inventer une date.
    """
    rdv_du_contact = champs_contact(contact).get("rdv_existant")
    horaire = rdv_du_contact or campagne.get("creneau") or place_libre
    if not horaire:
        return None
    support = {
        "horaire": horaire,
        "motif": champs_contact(contact).get("motif")
                 or campagne.get("sujet")
                 or (fiche_nature(nature) or {}).get("nom", nature),
        # Vrai quand la référence EST la place proposée (cas 3) et non un
        # rendez-vous déjà pris : l'agent propose alors CETTE place — celle
        # que le message annonce en premier — au lieu d'en dériver une autre.
        "place_a_pourvoir": not rdv_du_contact and not campagne.get("creneau"),
    }
    # ⚠ LA PLACE RÉELLE, TRANSMISE (16/08/2026). Elle était CALCULÉE ici — à
    # l'instant de l'appel, sur l'agenda vrai — et pourtant jamais transmise :
    # quand le contact a son propre rendez-vous (📆 déplacement), la simulation
    # retombait sur sa formule de dernier recours, « rendez-vous + 7 jours, même
    # heure ». Elle ne garantit RIEN sur la disponibilité, son propre code le
    # dit (voir calle_client._creneau_propose).
    #
    # CE QUE CELA DONNAIT, dans sa campagne : trois contacts, trois « Confirmé »
    # au téléphone, et trois « Rendez-vous NON créé : cette place est déjà
    # prise, ou hors des horaires d'ouverture » — donc trois « 🙋 à rappeler par
    # un humain ». Son rendez-vous du 22/08 à 10h00 donnait 29/08 à 10h00, une
    # place occupée. Le premier appel POSITIF qu'il venait de demander se
    # retournait en échec au moment d'écrire.
    #
    # `place_libre` est recalculée À CHAQUE APPEL : deux contacts d'affilée ne
    # peuvent donc pas recevoir la même — le rendez-vous du premier occupe la
    # place, elle disparaît des libres du second.
    if place_libre and not support["place_a_pourvoir"]:
        support["place_proposee"] = place_libre
    # ⚠ ET UNE SECONDE PLACE RÉELLE POUR « elle en propose une AUTRE ». Sans
    # elle, ce cas-là gardait sa date tirée au sort (jour + 1 à 10, heure au
    # hasard) : le troisième contact de sa campagne est reparti « à rappeler
    # par un humain » pour cette raison exacte, après un « Déplacé (date
    # convenue) ». Une autre date doit être une autre date LIBRE.
    if place_alternative and place_alternative != place_libre:
        support["place_alternative"] = place_alternative
    return support


def _sans_place_a_proposer(base, campagne, contact):
    """Plus AUCUNE place libre : personne n'est appelé, et l'écran dit pourquoi.

    La règle du propriétaire, à la lettre : jamais de date inventée. Sans
    place à proposer, l'appel n'aurait rien à annoncer — le contact part
    donc « à rappeler par un humain » avec la raison en clair, une ligne 🙋
    entre au cahier de changements (rien ne se perd), et AUCUN appel n'est
    passé. La campagne CONTINUE : une place peut se libérer entre deux
    appels, et chaque contact reste visible avec sa raison plutôt que
    d'être escamoté par un arrêt global.
    """
    note = ("Personne n'a été appelé : plus aucune place libre à proposer "
            f"dans les {horaires.HORIZON_JOURS} prochains jours. Libérez une "
            "place, ou ouvrez des horaires dans « ⚙ Réglages », puis "
            "relancez ce contact — aucune date n'a été inventée.")
    base.changer_etat_contact_campagne(contact["id"],
                                       "à rappeler par un humain", None)
    base.definir_detail_contact(contact["id"], note)
    noter_changement(base, campagne, contact, "humain",
                     motif=champs_contact(contact).get("motif") or "",
                     raison=note)
    journal.info("Campagne n°%d, contact n°%d : AUCUNE place libre à "
                 "proposer — aucun appel n'est parti, aucune date inventée",
                 campagne["id"], contact["id"])
    return None


def _appeler_contact(base, planif, preferences, campagne, configuration,
                     contact, tentative, maintenant=None):
    """UN appel de campagne de l'assistant (simulation ou réel, mêmes verrous).

    Rend « pourvu » si ce OUI conclut une politique « premier oui »,
    sinon None. Tout ce qui s'affiche ensuite (état, détail, information
    clé) est écrit ICI, depuis le résultat réel de l'appel.
    """
    options = configuration["options"]
    contact_id = contact["id"]
    # Le numéro composé est celui de la FICHE CLIENT à cet instant précis
    # (pas la copie gelée dans la campagne), et le 🚫 est relu ici — par le
    # numéro ET par le nom. Une fiche supprimée n'est plus jamais composée.
    cible = base.cible_appel_contact(contact_id)
    if cible["refus"]:
        etat, detail = db.suite_du_refus(cible["refus"])
        base.changer_etat_contact_campagne(contact_id, etat, None)
        base.definir_detail_contact(contact_id, detail)
        journal.info("Campagne n°%d : contact n°%d NON composé — %s (%s)",
                     campagne["id"], contact_id, cible["refus"], etat)
        return None
    telephone = cible["telephone"]
    mission = finaliser_mission(
        campagne["mission"], contact, champs_campagne(configuration),
        mod_langue.de_preferences(preferences))
    # UN SEUL calcul des places libres, fait ICI, à l'instant de l'appel : la
    # liste annoncée dans le message et la date de référence envoyée à
    # l'agent en sortent toutes les deux.
    creneaux, place_libre = places_du_contact(
        base, preferences, contact, sauf_places=places_a_vider(base, campagne),
        sauf_jours=jours_a_vider(base, campagne))
    mission = creneaux_adaptes_au_contact(base, preferences, configuration,
                                          contact, mission, adaptee=creneaux,
                                          campagne=campagne)
    # ⚠ ET SI LE RECALCUL NE REND PLUS RIEN, ON NE COMPOSE PAS. Le message
    # porterait alors la liste de la CRÉATION, dont plus une place n'est libre :
    # l'agent annoncerait des dates déjà prises. Voir `_plus_rien_a_annoncer`.
    if not creneaux and annonce_des_places_calculees(configuration, mission):
        return _plus_rien_a_annoncer(base, campagne, contact)
    nature = campagne["nature"]
    en_cascade = nature == "creneau_libere" and campagne.get("creneau")
    # ⚠ LE CONSENTEMENT EST RELU ICI AUSSI, à l'instant de composer. Les
    # filtres de file ne voient que les campagnes à liste de places ; celui-ci
    # voit TOUS les appels de cascade — y compris ceux d'une liste collée à la
    # main, où l'opérateur ne pouvait pas savoir.
    if en_cascade and base.plus_de_proposition(cible.get("client_id")):
        base.changer_etat_contact_campagne(contact_id, "épargné", None)
        base.definir_detail_contact(
            contact_id, f"Jamais appelée — {RAISON_PLUS_DE_PROPOSITION}")
        journal.info("Campagne n°%d : contact n°%d NON composé — refuse les "
                     "propositions de créneau", campagne["id"], contact_id)
        return None
    rdv_support = None
    if not en_cascade:
        # La SECONDE place libre, pour le cas « elle en propose une autre ».
        # Même source que la première, même instant, mêmes exclusions : deux
        # calculs ne pourraient pas diverger puisqu'ils partent des mêmes
        # arguments.
        # ⚠ LE STOCK SUIT CE QUI RESTE À DÉPLACER (17/08/2026, sa règle). Il est
        # recalculé à CHAQUE appel, donc il décroît avec la file : sept personnes
        # en attente demandent sept fois plus de places qu'une seule.
        suite_libres = horaires.places_negociables(
            base, preferences, tranches=tranches_du_contact(base, contact),
            sauf_places=places_a_vider(base, campagne),
            a_deplacer=rendezvous_a_deplacer(base, campagne),
            sauf_jours=jours_a_vider(base, campagne))
        autres = [place for place in suite_libres if place != place_libre]
        rdv_support = _support_de_l_appel(campagne, contact, nature,
                                          place_libre,
                                          autres[0] if autres else None)
        if rdv_support is None:
            return _sans_place_a_proposer(base, campagne, contact)
    # LA CONSIGNE EN TROIS PARTIES — présentation dite mot pour mot, objectif
    # et contexte discutés librement, issues fermées. C'est elle qui part
    # dans le champ « task » de CALL-E, et c'est elle que l'aperçu de
    # l'étape 2 montre : un seul chemin, donc aucune divergence possible.
    consigne_appel = consigne_de_l_appel(base, preferences, campagne,
                                         configuration, contact, mission,
                                         en_cascade, adaptee=creneaux)
    try:
        # LA NATURE PART AVEC L'APPEL. Elle ne change RIEN au réel — CALL-E ne
        # connaît pas nos natures, et tout ce qu'il faut dire est déjà dans la
        # consigne. Elle dit au SIMULATEUR quels cas de figure jouer pour cette
        # campagne : voir calle_client.SUITES_PAR_NATURE.
        if en_cascade:
            issue_appel = planif.client_appels.appeler_cascade(
                contact["nom"], telephone, mission, campagne["creneau"],
                consigne=consigne_appel, nature=nature)
        else:
            issue_appel = planif.client_appels.appeler(
                contact["nom"], telephone, rdv_support, mission=mission,
                consigne=consigne_appel, nature=nature)
    except calle_client.PasDeReponse:
        base.ajouter_appel_campagne(campagne["id"], contact_id, tentative,
                                    issue="no_answer")
        _apres_non_joint(base, preferences, campagne, options, contact_id,
                         "no_answer", maintenant)
        return None
    except calle_client.ResultatEnAttente as attente:
        # L'APPEL EST PARTI et la conversation a pu avoir lieu : c'est
        # SEULEMENT sa réponse qui manque. On garde l'identifiant CALL-E,
        # on écrit l'état qui dit la vérité — et rien d'autre : aucune
        # tentative, aucun « injoignable », aucun rendez-vous touché.
        # Puis on laisse remonter, pour que la campagne se mette en pause.
        _noter_resultat_en_attente(base, contact_id, tentative, attente)
        journal.error("Campagne n°%d, contact n°%d : appel PARTI, résultat "
                      "pas encore connu (appel CALL-E n° %s)", campagne["id"],
                      contact_id, attente.identifiant)
        raise
    except calle_client.ResultatInvalide as refus:
        # LA CONVERSATION A EU LIEU et nous n'avons pas su la lire. Ce n'est
        # PAS un échec technique : la relancer ferait sonner le téléphone une
        # seconde fois pour un échange qui a déjà abouti. Le contact part
        # vers un humain, réponse brute conservée — puis on laisse remonter,
        # pour que la campagne se mette en pause (le défaut frappera les
        # suivants à l'identique).
        noter_reponse_illisible(base, campagne["id"], contact_id, tentative,
                                refus)
        raise
    except calle_client.EchecDeNotreCote:
        # LA FAUTE EST DE NOTRE CÔTÉ, PAS DE CELUI DU CONTACT (clé refusée,
        # service en panne, crédit épuisé, réseau coupé). Son téléphone n'a
        # même pas sonné : on n'écrit RIEN sur lui — ni tentative, ni état,
        # ni détail — et on laisse remonter, pour que la campagne s'arrête
        # au lieu de marquer toute la liste à tort.
        raise
    except Exception as erreur:  # échec technique : jamais de résultat inventé
        journal.error("Campagne n°%d, contact n°%d : échec (%s)",
                      campagne["id"], contact_id, erreur)
        base.ajouter_appel_campagne(campagne["id"], contact_id, tentative,
                                    issue="echec")
        _apres_non_joint(base, preferences, campagne, options, contact_id,
                         "echec", maintenant)
        return None
    return _appliquer_resultat(base, planif, preferences, campagne,
                               configuration, contact, tentative, issue_appel,
                               en_cascade, cible, telephone, maintenant)


DETAIL_RESULTAT_INCONNU = (
    "⏱ L'appel est PARTI (appel CALL-E n° {identifiant}) — son résultat "
    "n'est pas encore connu. Aucune tentative ne lui est comptée, rien n'a "
    "été décidé, son rendez-vous n'a pas bougé. Utilisez « 📥 Récupérer les "
    "résultats en attente » : ce geste LIT le résultat chez CALL-E, il ne "
    "compose aucun numéro.")


def _noter_resultat_en_attente(base, contact_id, tentative, attente):
    """Écrit l'état « appelé, résultat inconnu » et GARDE l'identifiant.

    Trois écritures, et pas une de plus : l'identifiant de l'appel (sans
    lui, le résultat serait perdu), l'état, le détail affiché. Aucune
    tentative n'est ajoutée — l'appel n'a rien conclu, il ne doit pas
    rapprocher qui que ce soit du plafond de relances.
    """
    base.definir_appel_en_attente(contact_id, attente.identifiant, tentative)
    base.changer_etat_contact_campagne(contact_id, ETAT_RESULTAT_INCONNU, None)
    base.definir_detail_contact(
        contact_id,
        DETAIL_RESULTAT_INCONNU.format(identifiant=attente.identifiant or "?"))


# L'ISSUE d'une réponse que RingBack n'a pas su lire. Ce n'est pas « échec »
# (qui déclencherait une relance et rapprocherait du plafond) : la
# conversation a EU LIEU, elle attend un humain.
ISSUE_REPONSE_ILLISIBLE = "reponse_illisible"

DETAIL_REPONSE_ILLISIBLE = (
    "🙋 La conversation a EU LIEU, mais RingBack n'a pas su lire ce que "
    "CALL-E en a rendu — c'est un défaut de RingBack, pas un fait sur cette "
    "personne. Rien n'a été décidé : aucune tentative comptée, aucun "
    "rendez-vous touché, aucun rappel automatique. À rappeler par un "
    "humain.\nCe que RingBack n'a pas su lire : {constat}\nRéponse brute de "
    "CALL-E : {reponse}")


def noter_reponse_illisible(base, campagne_id, contact_id, tentative, refus):
    """Réponse illisible : le contact part vers un HUMAIN, rien n'est perdu.

    UN SEUL endroit pour cette écriture, partagé par les campagnes de
    l'assistant et par le moteur de campagnes classique — deux versions
    auraient fini par diverger, et c'est justement sur ce chemin-là qu'une
    divergence coûte une conversation.

    Ce qui est écrit :
    - la tentative est TRACÉE avec sa transcription (l'échange existe : le
      jeter serait perdre une seconde fois ce que la personne a dit) ;
    - l'état « à rappeler par un humain », terminal : aucune relance n'est
      programmée, donc aucun rappel automatique et aucun plafond approché ;
    - le détail affiché porte la réponse BRUTE de CALL-E, telle quelle.
    """
    base.ajouter_appel_campagne(campagne_id, contact_id, tentative,
                                issue=ISSUE_REPONSE_ILLISIBLE,
                                transcription=refus.transcription or None)
    base.changer_etat_contact_campagne(contact_id, "à rappeler par un humain",
                                       ISSUE_REPONSE_ILLISIBLE)
    base.definir_detail_contact(
        contact_id,
        DETAIL_REPONSE_ILLISIBLE.format(
            constat=refus.constat,
            reponse=refus.reponse_brute or "(aucune réponse conservée)"))
    journal.error("Campagne n°%s, contact n°%s : réponse ILLISIBLE — %s",
                  campagne_id, contact_id, refus.constat)


RAISON_STOP_TELEPHONE = ("la personne a demandé au téléphone qu'on ne la "
                         "rappelle plus")


def _poser_ne_plus_appeler(base, campagne, contact, cible, telephone):
    """Le 🚫 demandé PENDANT l'appel : posé sur la fiche, et dit partout.

    ⚠ SUR LA FICHE, PAS SUR LA CAMPAGNE. Le drapeau vaut pour TOUS les appels
    à venir, de toutes les campagnes — c'est le sens de la demande. Le mettre
    sur le contact de campagne n'aurait protégé la personne que d'une seule
    liste, et elle aurait été rappelée par la suivante.

    ⚠ ET LES RELANCES DÉJÀ PROGRAMMÉES TOMBENT. Une relance survivante aurait
    rappelé la personne quelques heures après qu'elle a demandé le contraire :
    c'est précisément ce qu'elle voulait éviter.

    Rend le nombre de relances annulées.
    """
    contact_id = contact["id"]
    client_id = (cible.get("client_id")
                 or base.client_pour_contact(contact["nom"], telephone))
    if client_id:
        base.definir_ne_plus_appeler(client_id, True)
    annulees = base.annuler_relances_contact(contact_id)
    noter_changement(base, campagne, contact, "ne_plus_appeler",
                     client_id=client_id, raison=RAISON_STOP_TELEPHONE)
    # Le détail écrit par l'issue est CONSERVÉ : ce qui a été convenu pendant
    # l'appel reste vrai. Le 🚫 se lit devant, parce que c'est lui qui décide
    # de tout ce qui vient après.
    ancien = (base.obtenir_contact_campagne(contact_id) or {}).get("detail")
    prefixe = ("🚫 A demandé à ne plus être appelée — sa fiche est marquée "
               "« ne plus appeler », aucun appel ne partira plus pour elle")
    if annulees:
        prefixe += f" ({annulees} relance(s) programmée(s) annulée(s))"
    base.definir_detail_contact(
        contact_id, f"{prefixe}. {ancien}" if ancien else prefixe + ".")
    journal.info("Campagne n°%d, contact n°%d : 🚫 demandé au téléphone — "
                 "fiche marquée, %d relance(s) annulée(s)",
                 campagne["id"], contact_id, annulees)
    return annulees


def _appliquer_resultat(base, planif, preferences, campagne, configuration,
                        contact, tentative, issue_appel, en_cascade, cible,
                        telephone, maintenant=None):
    """Écrit tout ce qu'un appel ABOUTI produit — et rien d'autre.

    Sortie de _appeler_contact pour une raison précise : le geste
    « 📥 Récupérer les résultats en attente » doit appliquer un résultat
    arrivé en retard EXACTEMENT comme s'il était arrivé à temps
    (rendez-vous déplacé, cahier des changements, cascade, relances). Un
    second chemin d'écriture aurait fini par diverger du premier ; il n'y
    en a donc qu'un seul, et c'est celui-ci.

    ⚠ DEUX TEMPS DEPUIS LE 10/08/2026 : l'issue, puis le 🚫 s'il a été demandé
    au téléphone. Dans cet ordre, et jamais l'inverse — ce qui a été convenu
    pendant l'appel doit être honoré (son rendez-vous est bien déplacé, sa
    place bien attribuée) AVANT que la fiche cesse d'être appelable.
    """
    conclusion = _appliquer_issue(base, planif, preferences, campagne,
                                  configuration, contact, tentative,
                                  issue_appel, en_cascade, cible, telephone,
                                  maintenant)
    if calle_client.ne_plus_appeler_demande(issue_appel.resultat):
        _poser_ne_plus_appeler(base, campagne, contact, cible, telephone)
    return conclusion


def _appliquer_issue(base, planif, preferences, campagne, configuration,
                     contact, tentative, issue_appel, en_cascade, cible,
                     telephone, maintenant=None):
    """L'issue elle-même : une branche par conclusion, et ce qu'elle écrit."""
    options = configuration["options"]
    contact_id = contact["id"]
    nature = campagne["nature"]
    resultat = issue_appel.resultat
    if en_cascade:
        issue = resultat["outcome"]
    else:
        issue = resultat["appointment_status"]
    base.ajouter_appel_campagne(campagne["id"], contact_id, tentative,
                                issue=issue, resultat=resultat,
                                transcription=issue_appel.transcription)
    rdv_du_contact = _rendezvous_vise(base, contact, telephone)
    tranches = horaires.duree_tranches(rdv_du_contact) if rdv_du_contact else 1
    duree = duree_lisible_tranches(preferences, tranches)
    motif_contact = champs_contact(contact).get("motif") or ""
    if issue == "accepted":
        # ⚠ LA PLACE RETENUE, PAS FORCÉMENT CELLE EN COURS. Quand plusieurs
        # places ont été annoncées dans le même appel, l'agent rend celle que
        # la personne a prise. Une date qui ne figure pas parmi celles
        # annoncées n'est PAS réservée : on ne devine pas au téléphone.
        annoncees = places_annoncees(campagne, configuration)
        place = place_retenue(resultat, annoncees, campagne.get("creneau"))
        if place is None:
            return _date_refusee(
                base, campagne, contact,
                "la date rapportée par l'agent (« "
                f"{resultat.get('new_datetime')} ») ne fait partie d'AUCUNE "
                "des places annoncées pendant l'appel : rien n'a été "
                "réservé.",
                resultat.get("new_datetime"), cible=cible,
                telephone=telephone, rdv_du_contact=rdv_du_contact)
        # Le créneau libéré a été CHOISI par l'utilisateur : on ne le juge
        # pas sur les horaires d'ouverture, mais il reste refusé s'il est
        # devenu fermé ou s'il a été pris entre-temps.
        # ⚠ LES DEUX PARAMÈTRES, PAS L'UN À LA PLACE DE L'AUTRE.
        # `place_choisie` exempte la place des horaires d'ouverture — un
        # créneau libéré un samedi est légitime, c'est l'utilisateur qui l'a
        # choisi. `sauf_rdv` fait ignorer le rendez-vous du contact lui-même,
        # qu'on s'apprête à déplacer : sans lui, un créneau qui chevauche son
        # propre rendez-vous serait déclaré « déjà pris », et le OUI obtenu au
        # téléphone serait jeté.
        refus = horaires.refus_rendezvous_telephone(
            base, preferences, place, tranches=tranches,
            place_choisie=True,
            sauf_rdv=(rdv_du_contact["id"] if rdv_du_contact else None))
        if refus:
            # ⚠ ET LA PLACE EST RETIRÉE SI ELLE EST MORTE POUR TOUT LE MONDE.
            # Sans cela, elle restait « à pourvoir » et la campagne continuait
            # de l'annoncer : mesuré dans sa base le 14/08/2026, VINGT-QUATRE
            # personnes ont dit oui à la même place déjà prise, l'une après
            # l'autre, et sont toutes parties « à rappeler par un humain ».
            perdue = _perdre_la_place_si_prise(base, preferences, campagne,
                                               configuration, place)
            _date_refusee(base, campagne, contact, refus, place,
                          complement=perdue, cible=cible, telephone=telephone,
                          rdv_du_contact=rdv_du_contact)
            # ⚠ ET LA BOUCLE DOIT L'APPRENDRE, pas seulement la liste. Retirer
            # la place en base ne suffisait pas : sur une campagne à UNE place,
            # rien ne relisait la campagne et les suivants étaient appelés pour
            # cette place morte (voir CONCLUSION_PLACE_PERDUE).
            return CONCLUSION_PLACE_PERDUE if perdue else None
        client_id = (cible["client_id"]
                     or base.client_pour_contact(contact["nom"], telephone))
        motif = motif_contact or "Créneau libéré attribué"
        # ⚠ ON DÉPLACE SA LIGNE, ON N'EN CRÉE PAS UNE SECONDE (14/08/2026).
        # `_liberer_ancien_rendezvous` change l'heure de SON rendez-vous et le
        # confirme ; il ne reste donc qu'une ligne d'agenda, à la nouvelle
        # date. Ce n'est que pour quelqu'un qui n'avait AUCUN rendez-vous —
        # les gens qui attendent une place — qu'on en crée un.
        #
        # ⚠ ET LE CAHIER PORTE UN SEUL GESTE : la ligne ↔ du déplacement, ou
        # l'« ajout » pour celui qui n'avait rien. Jamais les deux.
        trace = {}
        libere = _liberer_ancien_rendezvous(base, preferences, campagne,
                                            options, contact,
                                            maintenant=maintenant,
                                            deplace_vers=place, trace=trace)
        rdv_id = trace.get("rendezvous_id")
        if rdv_id is None:
            rdv_id = base.ajouter_rendezvous(
                client_id, place, motif,
                statut="confirmé", duree_tranches=tranches)
            if not libere:
                noter_changement(base, campagne, contact, "ajout",
                                 client_id=client_id, rendezvous_id=rdv_id,
                                 nouvelle_date=place, motif=motif,
                                 duree=duree,
                                 raison="créneau libéré accepté au téléphone")
        detail = (f"Créneau du {date_courte(place)} "
                  f"pris (rendez-vous n°{rdv_id})")
        if libere:
            detail += f" — {libere}"
            # Le contact vient d'AVANCER son rendez-vous : la place qu'il
            # quitte est à son tour un créneau à pourvoir.
            place_rendue = (trace.get("ancienne_date")
                            or (rdv_du_contact or {}).get("horaire")
                            or champs_contact(contact).get("rdv_existant"))
            detail += _rendre_la_place(base, preferences, campagne,
                                       configuration, contact, place_rendue,
                                       rdv_id)
        marquer_creneau(base, campagne["id"], place, CRENEAU_POURVU,
                        contact_id=contact_id, rendezvous_id=rdv_id)
        base.changer_etat_contact_campagne(contact_id, "accepté", issue)
        base.definir_detail_contact(contact_id, detail)
        return (CONCLUSION_POURVU if configuration["politique"] == "premier_oui"
            else None)
    if issue == "moved":
        # « Oui, mais une autre date » : le trou Q7, refermé ici. Un nouveau
        # rendez-vous est créé — et l'ANCIEN doit partir, sans quoi le client
        # en aurait deux et une place resterait bloquée pour rien. La même
        # mécanique que « accepted », avec sa propre raison au cahier.
        refus = horaires.refus_rendezvous_telephone(
            base, preferences, resultat.get("new_datetime"), tranches=tranches)
        if refus:
            return _date_refusee(base, campagne, contact, refus,
                                 resultat.get("new_datetime"), cible=cible,
                                 telephone=telephone,
                                 rdv_du_contact=rdv_du_contact)
        client_id = (cible["client_id"]
                     or base.client_pour_contact(contact["nom"], telephone))
        motif = motif_contact or "Rendez-vous convenu par téléphone"
        ancienne_place = ((rdv_du_contact or {}).get("horaire")
                          or champs_contact(contact).get("rdv_existant"))
        ancien_id = (rdv_du_contact or {}).get("id")
        rdv_id = base.ajouter_rendezvous(
            client_id, resultat["new_datetime"], motif,
            duree_tranches=tranches)
        noter_changement(base, campagne, contact, "ajout",
                         client_id=client_id, rendezvous_id=rdv_id,
                         nouvelle_date=resultat["new_datetime"], motif=motif,
                         duree=duree,
                         raison="autre date convenue au téléphone")
        libere = _liberer_ancien_rendezvous(
            base, preferences, campagne, options, contact,
            pourquoi=MOTIF_LIBERATION_AUTRE_DATE, maintenant=maintenant)
        base.changer_etat_contact_campagne(contact_id, "accepté", issue)
        # ⚠ LA DATE CONVENUE PEUT ÊTRE UNE PLACE DE LA CAMPAGNE (14/08/2026).
        # Quand plusieurs places sont annoncées dans le même appel, « une autre
        # date » veut souvent dire « une autre de celles que vous venez de me
        # citer ». Cette branche créait alors le rendez-vous dessus SANS marquer
        # la place : elle restait « à pourvoir », était réannoncée au contact
        # suivant, qui se la voyait refuser — puis elle était déclarée « prise
        # entre-temps » alors que c'est CETTE campagne qui l'avait pourvue.
        # « Pourvu par nous » n'est pas « pris ailleurs » : c'est la raison
        # d'être des deux statuts (voir `_perdre_la_place_si_prise`).
        notre_place = _place_de_la_campagne(campagne, configuration,
                                           resultat["new_datetime"])
        if notre_place:
            marquer_creneau(base, campagne["id"], resultat["new_datetime"],
                            CRENEAU_POURVU, contact_id=contact_id,
                            rendezvous_id=rdv_id)
            detail = (f"Place du {date_courte(resultat['new_datetime'])} prise "
                      f"(rendez-vous n°{rdv_id}) — c'était l'une des places "
                      "annoncées, elle est pourvue")
        else:
            detail = ("Autre date convenue : "
                      f"{date_courte(resultat['new_datetime'])} — "
                      "le créneau libéré reste à pourvoir")
        if libere:
            detail += f" — {libere}"
            # La place que le contact vient de quitter est à son tour un
            # créneau à pourvoir : exactement la règle §8.3, la même que
            # pour « accepted » et pour un déplacement accepté.
            #
            # ⚠ PAR `_rendre_la_place`, ET NON PLUS DIRECTEMENT PAR
            # `_suite_de_cascade` (14/08/2026). Cet appel direct sautait les
            # deux décisions du propriétaire : l'option « décaler en cascade »
            # (il fabriquait une campagne préparée sans qu'on l'ait demandé) et
            # le partage des deux chemins (sur une campagne à liste, la place
            # quittée doit REJOINDRE la liste, jamais fabriquer une campagne à
            # côté — les deux mécaniques ensemble se marchent dessus, voir
            # `_rendre_la_place`). L'écran annonçait donc l'un et faisait
            # l'autre.
            detail += _rendre_la_place(base, preferences, campagne,
                                       configuration, contact,
                                       ancienne_place, ancien_id)
        base.definir_detail_contact(contact_id, detail)
        # Une place de la campagne vient d'être pourvue : la boucle doit avancer
        # son curseur, exactement comme sur « accepted ».
        if notre_place and configuration["politique"] == "premier_oui":
            return CONCLUSION_POURVU
        return None
    if issue == "refused":
        base.changer_etat_contact_campagne(contact_id, "refusé", issue)
        date_rdv = champs_contact(contact).get("rdv_existant")
        detail = ("Rendez-vous existant du "
                  f"{date_courte(date_rdv)} intact" if date_rdv else "")
        # ⚠ « ET SI AUTRE CHOSE SE LIBÈRE ? » — la réponse est écrite SUR LA
        # FICHE, pas sur la campagne : elle vaut pour les campagnes à venir,
        # c'est tout son intérêt. Ce drapeau n'est PAS le 🚫 : la personne
        # reste appelable pour SES rendez-vous.
        if calle_client.refuse_les_autres_places(resultat):
            client_id = (cible["client_id"]
                         or base.client_pour_contact(contact["nom"], telephone))
            if client_id:
                base.definir_plus_de_proposition(client_id, True)
            noter_changement(base, campagne, contact, "plus_de_proposition",
                             client_id=client_id,
                             raison=RAISON_PLUS_DE_PROPOSITION)
            detail = ((detail + " · " if detail else "")
                      + "🔇 ne veut plus qu'on lui propose de créneau libéré "
                        "(elle reste appelable pour ses rendez-vous)")
            journal.info("Campagne n°%d, contact n°%d : refuse les prochaines "
                         "propositions de créneau", campagne["id"], contact_id)
        base.definir_detail_contact(contact_id, detail or None)
        return None
    if issue == "confirmed":
        detail = "Présence confirmée"
        rdv_vise = rdv_du_contact
        if nature == "deplacement" and rdv_vise is not None:
            # DÉPLACEMENT : la campagne a annoncé au client que son
            # rendez-vous DOIT bouger et lui a proposé des créneaux de
            # remplacement. Son accord porte donc sur le créneau convenu —
            # le rendez-vous est réellement DÉPLACÉ, et sa durée le suit
            # (c'est la même ligne d'agenda qui change d'heure).
            return _deplacer_le_rendezvous(
                base, preferences, campagne, configuration, contact, cible,
                rdv_vise, resultat, tranches, duree, issue)
        # ⚠ L'ORDRE DES DEUX BRANCHES EST LE DÉFAUT (03/09/2026). Celle-ci
        # passait la première, sur le seul fait qu'un rendez-vous soit lié au
        # contact. Pour une PRISE de rendez-vous chargée depuis « rendez-vous
        # annulés, manqués et en attente » — son usage le plus évident — le
        # rendez-vous lié est celui qu'on REMPLACE : le confirmer ressuscitait
        # une date annulée et jetait celle convenue au téléphone. La personne
        # se croyait attendue le 13 ; le planning montrait le 24 du mois
        # précédent, marqué « confirmé ».
        if rdv_vise is not None and nature not in ("prise_rdv",
                                                   "contact_unique"):
            # Rappel et confirmation : l'horaire ne bouge PAS — rien à
            # vérifier, la place est déjà la sienne, on ne fait que
            # confirmer sa présence. Aucune ligne au cahier : une présence
            # confirmée ne change rien au planning de l'établissement.
            base.mettre_a_jour_rendezvous(rdv_vise["id"], statut="confirmé")
            detail = (f"Rendez-vous du {date_courte(rdv_vise['horaire'])} "
                      "confirmé")
        # « contact_unique » ne se crée plus (retirée le 03/08/2026), mais une
        # base existante peut porter une campagne de cette nature dont le
        # résultat arrive en retard : la branche doit continuer de l'appliquer.
        elif nature in ("prise_rdv", "contact_unique"):
            refus = horaires.refus_rendezvous_telephone(
                base, preferences, resultat.get("new_datetime"))
            if refus:
                return _date_refusee(base, campagne, contact, refus,
                                     resultat.get("new_datetime"))
            client_id = (cible["client_id"]
                         or base.client_pour_contact(contact["nom"], telephone))
            motif = (campagne.get("sujet") or motif_contact
                     or (fiche_nature(nature) or {}).get("nom", nature))
            rdv_id = base.ajouter_rendezvous(
                client_id, resultat["new_datetime"], motif, statut="confirmé")
            noter_changement(base, campagne, contact, "ajout",
                             client_id=client_id, rendezvous_id=rdv_id,
                             nouvelle_date=resultat["new_datetime"],
                             motif=motif,
                             duree=duree_lisible_tranches(preferences, 1),
                             raison="rendez-vous obtenu au téléphone")
            detail = ("Rendez-vous obtenu le "
                      f"{date_courte(resultat['new_datetime'])} "
                      f"(n°{rdv_id})")
        base.changer_etat_contact_campagne(contact_id, "accepté", issue)
        base.definir_detail_contact(contact_id, detail)
        return (CONCLUSION_POURVU if configuration["politique"] == "premier_oui"
            else None)
    if issue == "rescheduled":
        rdv_vise = rdv_du_contact
        if rdv_vise is not None:
            # ⚠ LE MÊME CHEMIN QUE « confirmed », depuis le 17/08/2026 : une
            # date convenue au téléphone DÉPLACE la ligne existante, elle n'en
            # crée jamais une seconde. Seule la raison portée au cahier dit
            # laquelle des deux façons d'accepter c'était.
            return _deplacer_le_rendezvous(
                base, preferences, campagne, configuration, contact, cible,
                rdv_vise, resultat, tranches, duree, issue,
                raison=RAISON_AUTRE_DATE)
        refus = horaires.refus_rendezvous_telephone(
            base, preferences, resultat.get("new_datetime"),
            tranches=tranches)
        if refus:
            return _date_refusee(base, campagne, contact, refus,
                                 resultat.get("new_datetime"))
        client_id = (cible["client_id"]
                     or base.client_pour_contact(contact["nom"], telephone))
        motif = motif_contact or "Rendez-vous convenu par téléphone"
        # « confirmé » : la personne a dit oui au téléphone. C'est un accord,
        # pas une simple prévision — et c'est ce que l'autre façon d'accepter
        # écrivait déjà (sa décision du 17/08/2026).
        rdv_id = base.ajouter_rendezvous(
            client_id, resultat["new_datetime"], motif,
            duree_tranches=tranches, statut="confirmé")
        noter_changement(base, campagne, contact, "ajout",
                         client_id=client_id, rendezvous_id=rdv_id,
                         nouvelle_date=resultat["new_datetime"],
                         motif=motif, duree=duree,
                         raison="date convenue au téléphone")
        base.changer_etat_contact_campagne(contact_id, "accepté", issue)
        base.definir_detail_contact(
            contact_id, "Nouvelle date convenue : "
            f"{date_courte(resultat['new_datetime'])}")
        return (CONCLUSION_POURVU if configuration["politique"] == "premier_oui"
            else None)
    if issue == "canceled":
        # ANNULATION SANS REPLACEMENT. Quand le client accepte une autre date
        # pendant l'échange, l'agent ne rend pas « canceled » mais
        # « rescheduled » : c'est alors un simple DÉPLACEMENT, traité plus
        # haut, avec sa ligne ↔ au cahier. Ici, rien n'a été replacé — donc
        # c'est LE CLIENT qui reprendra contact. Aucune relance n'est
        # programmée (on n'en programme que pour les non-joints), et son état
        # ne débouche sur aucune campagne : voir etats_clients.SANS_CAMPAGNE.
        pouvait_proposer = bool(options.get(CLE_REPLACER_ANNULATION))
        detail = ("Annulé pendant l'appel — c'est le client qui nous "
                  "rappellera : aucune relance, aucune campagne")
        rdv_vise = rdv_du_contact
        if rdv_vise is not None and rdv_vise["statut"] in ("prévu", "confirmé",
                                                           "manqué"):
            # LE SEUIL DU PROPRIÉTAIRE (12 h par défaut, réglable). Au-delà,
            # le rendez-vous est SUPPRIMÉ : sa place redevient libre et on
            # PROPOSE une campagne pour la remplir. En deçà, il reste
            # « annulé » et l'écran dit pourquoi on ne peut pas remplacer.
            decision = horaires.decision_annulation(
                preferences, rdv_vise["horaire"], maintenant)
            base.mettre_a_jour_rendezvous(rdv_vise["id"],
                                          statut=decision["statut"])
            # ⚠ LE GENRE SUIT LE STATUT ÉCRIT (voir `genre_de_retrait`) : il
            # était « suppression » dans les deux cas, y compris quand le
            # rendez-vous restait « annulé » et sa place bloquée.
            noter_changement(base, campagne, contact,
                             horaires.genre_de_retrait(decision["statut"]),
                             client_id=rdv_vise.get("client_id"),
                             rendezvous_id=rdv_vise["id"],
                             ancienne_date=rdv_vise["horaire"],
                             motif=rdv_vise.get("motif") or motif_contact,
                             duree=duree,
                             raison="annulé par le client pendant l'appel — "
                                    "il reprendra contact lui-même. "
                                    + decision["pourquoi"])
            if decision["compensable"]:
                detail += (f" — le rendez-vous du "
                           f"{date_courte(rdv_vise['horaire'])} est SUPPRIMÉ, "
                           "sa place redevient libre")
                # L'option de cascade PRÉPARE la campagne de compensation
                # (état « prête », aucun appel) ; sans elle, le récapitulatif
                # de la campagne la PROPOSE en un clic. Dans les deux cas,
                # rien ne part sans le geste de l'opérateur.
                detail += _suite_de_cascade(base, preferences, campagne,
                                            configuration, contact["nom"],
                                            rdv_vise["horaire"],
                                            rdv_vise["id"])
            else:
                detail += (f" — le rendez-vous du "
                           f"{date_courte(rdv_vise['horaire'])} reste "
                           f"« annulé » : {decision['pourquoi']}")
        # La CONSIGNE que portait le message, pour que l'écran dise ce que
        # l'agent avait le droit de faire (c'est lisible dans la campagne,
        # ce n'est pas une déduction sur ce qui s'est dit au téléphone).
        detail += (" · consigne de la campagne : proposer une autre date"
                   if pouvait_proposer
                   else " · consigne de la campagne : ne proposer aucune date")
        base.changer_etat_contact_campagne(contact_id, ETAT_RAPPELLERA, issue)
        base.definir_detail_contact(contact_id, detail)
        return None
    # to_reschedule : rien n'a été conclu au téléphone. CE QUI SUIT DÉPEND DE LA
    # NATURE depuis le 11/08/2026 — voir _rien_de_conclu.
    return _rien_de_conclu(base, preferences, campagne, contact, cible,
                           telephone, rdv_du_contact, resultat, issue,
                           motif_contact, maintenant)


# ⚠ LE RAPPEL PAR UN HUMAIN N'EST PLUS OFFERT PARTOUT (décision du propriétaire,
# 11/08/2026) : « nous allons permettre le rappel par un humain uniquement en cas
# de déplacement de rendez-vous ou de prise de rendez-vous ».
#
# POURQUOI CES DEUX-LÀ ET PAS LES AUTRES. Sur un déplacement ou une prise de
# rendez-vous, il RESTE quelque chose à conclure : une date à trouver. Un humain
# a donc un travail réel à faire, et rappeler a du sens.
#
# Sur un créneau libéré, non — et c'est le propriétaire qui l'a dit : « le
# créneau est certainement attribué à quelqu'un d'autre, alors ce sera contacter
# quelqu'un pour lui dire "en fait on voulait vous demander quelque chose, mais
# ce n'est plus d'actualité" ». Rappeler serait déranger pour rien.
NATURES_RAPPEL_HUMAIN = ("deplacement", "prise_rdv")


def _rien_de_conclu(base, preferences, campagne, contact, cible, telephone,
                    rdv_du_contact, resultat, issue, motif_contact,
                    maintenant=None):
    """« Je ne peux pas vous dire là » : trois sorts, selon la nature.

    · déplacement, prise de rendez-vous → À RAPPELER PAR UN HUMAIN. Il reste une
      date à trouver, quelqu'un doit la trouver (voir NATURES_RAPPEL_HUMAIN).

    · créneau libéré → REFUSÉ, et son rendez-vous est CONSERVÉ et passé en
      CONFIRMÉ. Mots du propriétaire : « on n'a pas pu définir si vous êtes
      intéressé, alors il conserve son rendez-vous, et le rendez-vous passe en
      confirmé ». La place, elle, part à quelqu'un d'autre — d'où « refusé »,
      qui dit la vérité sur la PLACE sans rien affirmer sur la personne (c'est
      le détail qui le dit, en clair).

    · rappel, confirmation → LE CLIENT RAPPELLERA. Ici le rendez-vous dont on
      parle est LE SIEN : il peut vraiment nous rappeler à son sujet, et aucun
      travail ne reste en attente de notre côté. Son rendez-vous n'est PAS
      touché — le confirmer d'office sur une campagne de confirmation
      inventerait la confirmation qu'on n'a justement pas obtenue.
    """
    contact_id = contact["id"]
    nature = campagne["nature"]
    demande = resultat.get("notes", "")
    if nature in NATURES_RAPPEL_HUMAIN:
        base.changer_etat_contact_campagne(contact_id,
                                           "à rappeler par un humain", issue)
        base.definir_detail_contact(contact_id,
                                    f"Demande du client : « {demande} »")
        noter_changement(base, campagne, contact, "humain",
                         ancienne_date=(rdv_du_contact or {}).get("horaire")
                         or champs_contact(contact).get("rdv_existant"),
                         motif=motif_contact, raison=demande)
        return None
    if nature == "creneau_libere":
        base.changer_etat_contact_campagne(contact_id, "refusé", issue)
        detail = ("Nous n'avons pas pu déterminer si cette personne était "
                  "intéressée par la place. Elle conserve son rendez-vous")
        confirme = _confirmer_le_rendezvous(base, campagne, contact, cible,
                                            telephone, rdv_du_contact, demande)
        detail += confirme if confirme else "."
        base.definir_detail_contact(contact_id, detail)
        return None
    # Rappel de rendez-vous, confirmation : c'est le client qui reprendra
    # contact — et son rendez-vous est ANNULÉ.
    #
    # ⚠ SA RÈGLE, DU 17/08/2026 : « si la personne doit rappeler, le rendez-vous
    # est simplement annulé ». Avant, le rendez-vous n'était PAS touché : le
    # créneau restait bloqué pour quelqu'un qui vient de dire qu'il ne viendrait
    # pas comme prévu. Le cabinet gardait un trou qu'il ne savait pas avoir.
    #
    # « Annulé », pas « supprimé » : la ligne reste au planning, visible, et sa
    # place redevient libre. C'est la même écriture que pour un refus au
    # téléphone (planificateur._appliquer_issue, statut « canceled »), et c'est
    # ce qui permet à une campagne de créneau libéré de la reprendre.
    base.changer_etat_contact_campagne(contact_id, ETAT_RAPPELLERA, issue)
    detail = ("Rien n'a été conclu au téléphone : c'est cette personne qui "
              f"rappellera. Ce qu'elle a dit : « {demande} »")
    cible_rdv = _annuler_le_rendezvous(base, campagne, contact, rdv_du_contact,
                                       demande)
    detail += cible_rdv if cible_rdv else " Aucun rendez-vous à annuler."
    base.definir_detail_contact(contact_id, detail)
    return None


def _annuler_le_rendezvous(base, campagne, contact, rdv_du_contact, demande,
                           raison=None, journal_dit="le client rappellera"):
    """Passe le rendez-vous du contact en « annulé » ; rend la phrase à afficher.

    Rend "" s'il n'y a aucun rendez-vous à annuler — on ne prétend pas avoir
    touché à quelque chose qui n'existe pas.

    ⚠ UNE LIGNE AU CAHIER, TOUJOURS. L'opérateur a ce changement à reporter
    dans son propre logiciel : une annulation muette lui ferait garder le
    créneau bloqué. Même raison que le genre « confirmation », ajouté le
    11/08/2026 pour le changement de statut inverse.

    ⚠ `raison` EST UN PARAMÈTRE DEPUIS LE 20/08/2026, et sa valeur par défaut
    est le texte d'avant, mot pour mot. Il y a maintenant DEUX façons d'arriver
    ici — « le client rappellera » et « le déplacement n'a pas pu se faire » —
    et le cahier des changements doit dire LAQUELLE : c'est lui qu'il relit
    pour reporter dans son propre logiciel.
    """
    if not rdv_du_contact:
        return ""
    if rdv_du_contact.get("statut") == "annulé":
        return ""          # déjà annulé : ni seconde ligne au cahier, ni bruit
    horaire = rdv_du_contact.get("horaire")
    base.mettre_a_jour_rendezvous(rdv_du_contact["id"], statut="annulé")
    # ⚠ LA LIGNE DU CAHIER PORTE SON RENDEZ-VOUS (21/08/2026, son signalement).
    # Sans `rendezvous_id`, l'annulation entrait au cahier SANS lien vers la
    # place qu'elle venait de libérer — et le panneau « Compenser une absence »
    # l'ignorait : il n'accepte que les changements qui désignent un
    # rendez-vous. Mesuré sur sa campagne n° 119 : trois rendez-vous annulés au
    # cahier, DEUX places proposées à la compensation. La troisième se libérait
    # en silence, et son écran le laissait croire à une incohérence.
    noter_changement(base, campagne, contact, "annulation",
                     rendezvous_id=rdv_du_contact["id"],
                     ancienne_date=horaire,
                     motif=champs_contact(contact).get("motif") or "",
                     raison=raison or ("Rien n'a été conclu au téléphone : "
                                       "c'est le client qui rappellera — "
                                       f"« {demande} »"))
    journal.info("Campagne n°%d : rendez-vous n°%d ANNULÉ — %s",
                 campagne["id"], rdv_du_contact["id"], journal_dit)
    return (f" Son rendez-vous du {date_courte(horaire)} est ANNULÉ : sa place "
            "redevient libre.")


# ------------------------- un déplacement qui n'a pas eu lieu finit ANNULÉ
# ⚠ SA RÈGLE, DU 20/08/2026, mot pour mot : « lorsqu'on demande de déplacer un
# rendez-vous et que, pour une raison ou une autre, nous n'avons pas pu le
# déplacer : celui-ci est alors annulé. C'est après les recontacts, ou alors le
# client qui doit rappeler, pour fixer un rendez-vous. »
#
# La raison est simple : une campagne de déplacement dit « ce créneau doit être
# vidé ». Il ne l'est qu'à moitié si les rendez-vous qu'on n'a pas su déplacer
# y restent — et il croyait sa journée vide. Mesuré sur sa base le 20/08 :
# il vide un jeudi après-midi, 2 rendez-vous sur 6 restent au planning.
#
# ⚠ QUAND — SON CHOIX DU 20/08 : quand RingBack a FINI D'ESSAYER, pas au
# premier appel raté. Tant qu'une relance est armée, on va rappeler pour
# déplacer : annuler d'avance ferait parler d'un rendez-vous qui n'existe plus.
#
# ⚠ QUI — SON CHOIX DU 20/08 : ceux qu'on n'a JAMAIS pu appeler aussi (🚫, sans
# numéro, fiche disparue). Il n'est pas là ce jour-là : leur rendez-vous ne
# tient pas davantage. Ils sont dans sa liste de rappels humains, c'est en les
# appelant qu'il refixera.
#
# ⚠ ET « NOUS N'AVONS PAS PU » N'EST PAS « NOUS N'AVONS PAS VOULU ». Ma première
# version confondait les deux, et le banc l'a arrêtée sur la cascade : une
# campagne « arrêt au premier oui » ÉPARGNE volontairement tous ceux qui
# suivent le premier accord — leur rendez-vous n'a aucune raison de bouger, on
# ne leur a rien demandé. Elle annulait trois rendez-vous par campagne, et la
# chaîne de cascade mourait au premier maillon.
ETATS_ENCORE_A_APPELER = (
    "à appeler",
    "en cours",
    # L'appel EST parti, sa réponse n'est pas revenue : « 📥 Récupérer les
    # résultats en attente » peut encore la ramener, et cette personne a très
    # bien pu accepter. RingBack n'a pas fini d'essayer.
    ETAT_RESULTAT_INCONNU,
)

# Les états où le rendez-vous a bel et bien trouvé une suite — ou n'avait
# aucune raison d'en changer. « accepté » l'a déplacé ; « le client
# rappellera » l'a DÉJÀ annulé par le chemin du 17/08 ; « épargné » (affiché
# « pas appelé ») est une décision de la campagne, pas un échec.
ETATS_DEPLACEMENT_REGLES = ("accepté", ETAT_RAPPELLERA, "épargné")

RAISON_DEPLACEMENT_MANQUE = (
    "Campagne de déplacement : ce rendez-vous n'a pas pu être déplacé, "
    "il est donc annulé — une nouvelle date reste à fixer")


def cloturer_les_deplacements_non_faits(base, campagne, maintenant=None):
    """Annule les rendez-vous d'une campagne de déplacement restés en place.

    ⚠ UN SEUL ENDROIT, ET IL EST REJOUABLE. Un contact peut cesser d'être
    « en cours d'essai » à trois moments : la campagne se termine, une relance
    s'achève sans rien conclure, ou la campagne est close à la main. Trois
    écritures séparées auraient fini par diverger. Celle-ci se rejoue sans
    dommage : un rendez-vous déjà annulé n'est pas retouché, et aucune seconde
    ligne n'entre au cahier.

    Rend le nombre de rendez-vous annulés.
    """
    if (campagne or {}).get("nature") != "deplacement":
        return 0
    # Les contacts pour qui une tentative est ENCORE À VENIR, lus en une fois.
    attendus = {r["contact_id"] for r in base.relances_de_campagne(campagne["id"])
                if r["statut"] == "planifiée"}
    annules = 0
    for contact in base.contacts_de_campagne(campagne["id"]):
        if contact["etat"] in ETATS_ENCORE_A_APPELER:
            continue                       # on va encore l'appeler
        if contact["etat"] in ETATS_DEPLACEMENT_REGLES:
            continue                       # déplacé, ou déjà annulé le 17/08
        if contact["id"] in attendus:
            continue                       # une tentative est encore à venir
        rdv = _rendezvous_vise(base, contact,
                               base.telephone_contact_campagne(contact["id"]))
        # ⚠ SEULEMENT CE QUI OCCUPE ENCORE LA PLACE (« prévu », « confirmé »).
        # Un rendez-vous déjà annulé, supprimé, déplacé ou manqué ne bloque
        # plus le créneau qu'il voulait vider : l'annuler une seconde fois
        # n'apporterait rien et salirait le cahier des changements.
        if rdv is None or rdv["statut"] not in horaires.STATUTS_OCCUPANTS:
            continue
        phrase = _annuler_le_rendezvous(
            base, campagne, contact, rdv, "",
            raison=RAISON_DEPLACEMENT_MANQUE,
            journal_dit="déplacement non fait")
        if not phrase:
            continue
        annules += 1
        ancien = (contact["detail"] or "").rstrip()
        base.definir_detail_contact(
            contact["id"],
            (ancien + " ·" if ancien else "")
            + " Le déplacement n'a pas pu se faire :" + phrase.rstrip()
            + " Une nouvelle date reste à fixer.")
    if annules:
        journal.info("Campagne n°%d : %d rendez-vous ANNULÉ(S) — le "
                     "déplacement n'a pas pu se faire", campagne["id"], annules)
    return annules


def _confirmer_le_rendezvous(base, campagne, contact, cible, telephone,
                             rdv_du_contact, demande):
    """Passe le rendez-vous du contact en « confirmé ». Rend la phrase à afficher.

    ⚠ SEULEMENT SUR UN CRÉNEAU LIBÉRÉ, et seulement quand le rendez-vous existe
    VRAIMENT dans l'agenda. Sans rendez-vous connu il n'y a rien à confirmer, et
    en inventer un serait pire que de ne rien écrire : la phrase le dit alors.

    Pourquoi « confirmé » est juste ici : la personne a DÉCROCHÉ, on lui a parlé,
    et elle n'a pas annulé. Son rendez-vous tient — c'est exactement ce que dit
    ce statut. Rien n'est déduit d'un silence : sans conversation, on ne passe
    jamais par ici (une non-réponse suit le chemin des injoignables).
    """
    if rdv_du_contact is None:
        return (" — aucun rendez-vous connu dans l'agenda de RingBack, "
                "il n'y a donc rien à confirmer.")
    if rdv_du_contact["statut"] == "confirmé":
        return (f" du {date_courte(rdv_du_contact['horaire'])}, déjà confirmé.")
    ancien = rdv_du_contact["statut"]
    base.mettre_a_jour_rendezvous(rdv_du_contact["id"], statut="confirmé")
    noter_changement(base, campagne, contact, "confirmation",
                     client_id=((cible or {}).get("client_id")
                                or base.client_pour_contact(contact["nom"],
                                                            telephone)),
                     rendezvous_id=rdv_du_contact["id"],
                     ancienne_date=rdv_du_contact["horaire"],
                     motif=rdv_du_contact.get("motif") or "",
                     raison="la personne a été joignable et n'a pas annulé "
                            f"(réponse non conclusive : « {demande} »)")
    journal.info("Campagne n°%d, contact n°%d : réponse non conclusive sur une "
                 "place libérée — rendez-vous n°%d passé de « %s » à "
                 "« confirmé »", campagne["id"], contact["id"],
                 rdv_du_contact["id"], ancien)
    return (f" du {date_courte(rdv_du_contact['horaire'])}, qui passe en "
            "« confirmé ».")


RAISON_CRENEAU_PROPOSE = "créneau de remplacement accepté au téléphone"
RAISON_AUTRE_DATE = "autre date convenue au téléphone"


def _deplacer_le_rendezvous(base, preferences, campagne, configuration,
                            contact, cible, rdv_vise, resultat, tranches,
                            duree, issue, raison=RAISON_CRENEAU_PROPOSE):
    """📆 Le client accepte de bouger : son rendez-vous est VRAIMENT déplacé.

    ⚠ LES DEUX FAÇONS D'ACCEPTER PASSENT ICI, et c'est tout l'enjeu (corrigé le
    17/08/2026 au soir). Au téléphone, un client peut accepter de deux manières :
    prendre le créneau qu'on lui propose (l'agent rend « confirmed »), ou
    convenir d'une autre date (« rescheduled »). Pour lui, c'est le MÊME
    événement — l'écran écrit d'ailleurs « ✅ accepté » dans les deux cas. Seule
    `raison` change : elle dit laquelle des deux, dans le cahier.

    CE QUE ÇA COÛTAIT : la seconde façon passait par une autre mécanique, qui
    laissait l'ancienne ligne sur la journée en « déplacé » et en créait une
    SECONDE à la date convenue. Mesuré sur sa journée du 18/08 : sur onze
    personnes, quatre lignes se déplaçaient proprement et deux restaient là,
    plus deux nouvelles nées ailleurs. D'où son constat : « le premier
    rendez-vous n'a pas été annulé, mais on l'a bien ajouté pour le
    lendemain ». Sa journée ne se vidait qu'à moitié.

    ⚠ ET LA DÉCISION ÉTAIT DÉJÀ PRISE, par lui, le 14/08/2026 : « tu déplaces un
    rendez-vous d'une date à une autre, c'est ultra simple ». Elle avait été
    appliquée à la cascade (`_rendre_la_place`) et à l'accord sur créneau
    proposé — pas à celui-ci. Corriger le chemin signalé et laisser les autres,
    c'est la demi-correction qui fait revenir le même défaut sous un autre nom.

    Le créneau convenu passe par les vérifications déjà en place
    (horaires.refus_rendezvous_telephone : jour fermé, hors horaires, place
    prise, durée qui ne tient pas) — celles de la saisie à la main, jamais
    dupliquées. La durée SUIT le rendez-vous : c'est la même ligne d'agenda
    qui change d'heure, `duree_tranches` n'est pas touché.

    En cas de refus, le contact part en « à rappeler par un humain » avec la
    date demandée en clair — rien n'est écrit qu'on n'ait pu honorer.

    Quand le déplacement ABOUTIT, la place qu'il libère devient le créneau
    d'une nouvelle campagne, préparée « prête » si l'option de cascade est
    réglée (§8.3) — jamais lancée. Elle le devient désormais dans les DEUX
    façons d'accepter : une place libérée est une place libérée, quelle que
    soit la phrase qui l'a libérée.
    """
    contact_id = contact["id"]
    nouvelle = resultat.get("new_datetime")
    refus = horaires.refus_rendezvous_telephone(
        base, preferences, nouvelle, tranches=tranches,
        sauf_rdv=rdv_vise["id"])
    if refus:
        return _date_refusee(base, campagne, contact, refus, nouvelle)
    ancienne = rdv_vise["horaire"]
    motif = rdv_vise.get("motif") or champs_contact(contact).get("motif") or ""
    base.mettre_a_jour_rendezvous(rdv_vise["id"], statut="confirmé",
                                  horaire=nouvelle)
    noter_changement(base, campagne, contact, "deplacement",
                     client_id=rdv_vise.get("client_id"),
                     rendezvous_id=rdv_vise["id"], ancienne_date=ancienne,
                     nouvelle_date=nouvelle, motif=motif, duree=duree,
                     raison=raison)
    base.changer_etat_contact_campagne(contact_id, "accepté", issue)
    detail = (f"Rendez-vous DÉPLACÉ du {date_courte(ancienne)} "
              f"au {date_courte(nouvelle)} (durée {duree}, inchangée)")
    detail += _suite_de_cascade(base, preferences, campagne, configuration,
                                contact["nom"], ancienne, rdv_vise["id"])
    base.definir_detail_contact(contact_id, detail)
    journal.info("Campagne n°%d, contact n°%d : rendez-vous n°%d DÉPLACÉ "
                 "%s -> %s", campagne["id"], contact_id, rdv_vise["id"],
                 ancienne, nouvelle)
    return (CONCLUSION_POURVU if configuration["politique"] == "premier_oui"
            else None)


def _rendre_la_place(base, preferences, campagne, configuration, contact,
                     place_rendue, rendezvous_id):
    """Ce que devient la place qu'un contact vient de quitter.

    ⚠ DEUX CHEMINS, ET UN SEUL À LA FOIS (décision du propriétaire du
    03/08/2026) :

    · la campagne porte une LISTE de places → la place rendue REJOINT cette
      liste. La campagne continuera d'elle-même sur ce nouveau trou, avec les
      personnes qui restent. Pas de campagne « prête » séparée.
    · la campagne n'a qu'UN créneau → le décalage en cascade d'origine, qui
      prépare une campagne suivante. Rien n'y change.

    Pourquoi ne pas faire les deux : la convergence de la cascade repose sur
    le fait que chaque maillon est STRICTEMENT plus tard que le précédent
    (voir `resserrer_sur_le_creneau`). Avec une liste, une place rendue peut
    être plus TÔT qu'un créneau encore à pourvoir : le raisonnement tombe, et
    les deux mécaniques ensemble se marcheraient dessus. Ici la campagne ne
    peut pas tourner en rond — un contact n'est appelé qu'une fois, la file
    finit toujours par se vider.

    ⚠ ET LES DEUX CHEMINS SONT SOUS LA MÊME OPTION DEPUIS LE 14/08/2026.
    Décision du propriétaire, mot pour mot : « seulement si l'option du
    traitement en cascade est demandé : c'est une option, pas une obligation ».

    LE DÉFAUT QUI L'A FAIT DÉCIDER, MESURÉ DANS SA BASE : le chemin « liste »
    ajoutait la place rendue SANS RIEN DEMANDER. Il avait choisi CINQ places ;
    sa campagne en a compté TRENTE-SEPT, en a pourvu trente-deux, et lui a
    laissé trente-cinq lignes à reporter dans son logiciel de planification.
    Chaque personne avancée creuse un trou plus loin, qu'on comble en creusant
    encore : cela ne s'arrête pas aux places qu'il a choisies, mais quand plus
    personne n'est intéressé. Décochée, l'option laisse le trou VISIBLE sur le
    planning — et c'est lui qui décide d'en faire une campagne, ou pas.
    """
    if not place_rendue:
        return ""
    # ⚠ L'OPTION COMMANDE LES DEUX CHEMINS. Décochée, rien à dire de plus — la
    # phrase qui précède annonce déjà que sa place redevient libre, et le trou
    # est sur le planning.
    options = configuration["options"]
    if not options.get("cascade"):
        return ""
    # ⚠ UNE PLACE OU PLUSIEURS : LA PLACE QUITTÉE REJOINT LA CAMPAGNE
    # (15/08/2026). C'est SA mécanique, décrite par lui après trois jours de
    # signalements que je n'arrivais pas à traduire :
    #
    #   « 30 appels autorisés, on en consomme 8 pour occuper le créneau, on
    #   ajoute le nouveau créneau libéré à cause du décalage […] puis quand on
    #   est sur un créneau en cascade, alors on recharge la liste des
    #   contacts […] on les appelle. »
    #
    # AVANT, une campagne à UNE place — c'est-à-dire TOUTES les siennes, je l'ai
    # vérifié dans sa base — préparait à côté une campagne « prête » qu'il
    # fallait lancer à la main. Sa n°12 : plafond 30, SEPT personnes appelées,
    # vingt-trois épargnées, campagne terminée, et une n°13 posée à côté. De
    # son poste cela s'appelle « la cascade ne fonctionne pas », et il a raison :
    # la campagne s'arrête alors qu'elle a du budget et une place à pourvoir.
    #
    # La convergence tient toujours — c'était l'objection du 03/08 : sur une
    # place unique, la place rendue est TOUJOURS strictement plus tard (on
    # n'avance quelqu'un que vers plus tôt). S'y ajoutent deux bornes dures :
    # la date limite réglée ci-dessous, et le plafond d'appels tenu par la
    # boucle (voir `executer_campagne`).
    if not configuration.get("liste_de_places"):
        journal.info("Campagne n°%d : place unique — la place quittée du %s "
                     "rejoint la campagne au lieu d'en préparer une autre",
                     campagne["id"], place_rendue)
    # ⚠ ET SA DATE LIMITE, QUAND ELLE EST RÉGLÉE, BORNE AUSSI CE CHEMIN-CI.
    # C'est ce qui empêche une campagne de marcher indéfiniment vers le futur :
    # chaque personne avancée creuse un trou plus loin, et sans butée on comble
    # en creusant encore.
    limite = cascade_reglee(options)
    if limite and place_rendue[:10] > limite:
        return (f" — sa place du {date_courte(place_rendue)} reste libre sur "
                f"votre planning : elle tombe après le "
                f"{date_jour_lisible(limite)}, limite réglée pour le décalage "
                "en cascade")
    liste = ajouter_creneau(base, campagne["id"], place_rendue,
                            pourquoi=f"place quittée par {contact['nom']}")
    reste = sum(1 for f in liste if f["statut"] == CRENEAU_A_POURVOIR)
    return (f" — sa place du {date_courte(place_rendue)} rejoint la liste "
            f"de cette campagne ({reste} place(s) encore à pourvoir)")


def _suite_de_cascade(base, preferences, campagne, configuration, demandeur,
                      creneau_libere, rendezvous_bouge=None):
    """Le maillon suivant, quand l'option est réglée ; rend le texte à afficher.

    N'agit QUE si l'option « décaler en cascade » a été cochée : sans elle,
    rien n'est préparé et rien n'est dit — on ne répond pas à une question
    qui n'a pas été posée. Avec elle, ou bien une campagne est préparée et
    l'écran dit laquelle, ou bien la chaîne s'arrête et l'écran dit pourquoi.
    """
    if not configuration["options"].get("cascade"):
        return ""
    prepare = preparer_cascade_creneau_libere(
        base, preferences, campagne, configuration, demandeur, creneau_libere,
        rendezvous_bouge=rendezvous_bouge)
    if not prepare.get("campagne_id"):
        return f" — 🔗 Décalage en cascade : {prepare.get('raison', '')}"
    ecartes = prepare["ecartes"]
    resserrement = (f"{ecartes['anterieurs']} écarté(s) : leur rendez-vous "
                    "est avant cette place"
                    if ecartes["anterieurs"] else "aucun écarté")
    return (f" — 🔗 La place du {date_courte(creneau_libere)} se libère : la "
            f"campagne n°{prepare['campagne_id']} a été PRÉPARÉE sur ce "
            f"créneau, avec les mêmes critères — "
            f"{len(prepare['contacts'])} contact(s) retenu(s), "
            f"{resserrement}. État « prête » : aucun appel n'est parti, "
            "c'est à vous de la valider.")


def mettre_en_pause_sur_panne(base, campagne_id, panne, contact=None):
    """Panne DE NOTRE CÔTÉ : la campagne s'arrête NET, personne n'est marqué.

    Ce que fait cette fonction, et surtout ce qu'elle NE fait PAS :
    - le contact qu'on s'apprêtait à appeler redevient « à appeler » (il
      était passé « en cours ») : aucune tentative ne lui est comptée,
      aucun détail ne lui est collé — son téléphone n'a pas sonné ;
    - la campagne passe « en pause », JAMAIS « terminée » : elle se reprend
      telle quelle une fois la panne réparée, sans perdre personne ;
    - la RAISON est écrite en français, avec la marche à suivre, pour être
      affichée sur la fiche.
    Avec une liste de vingt personnes et une clé refusée, les vingt seraient
    sinon passées « injoignables » à tort : c'est exactement ce qui a été
    constaté le 01/08/2026, et c'est ce que ces trois lignes empêchent.

    DEUX EXCEPTIONS, et pas une de plus — les deux cas où le TÉLÉPHONE A
    SONNÉ. Remettre ces contacts « à appeler » les ferait sonner une seconde
    fois pour une conversation qui a déjà eu lieu :
    - ResultatEnAttente : l'appel est parti, son résultat manque encore. Son
      état « appelé, résultat inconnu » vient d'être écrit ;
    - ResultatInvalide : la réponse est arrivée et RingBack n'a pas su la
      lire. Son état « à rappeler par un humain » vient d'être écrit, avec
      la réponse brute — c'est un humain qui reprend, jamais la machine.
    """
    APPEL_PARTI = (calle_client.ResultatEnAttente, calle_client.ResultatInvalide)
    if contact is not None and not isinstance(panne, APPEL_PARTI):
        base.changer_etat_contact_campagne(contact["id"], "à appeler", None)
        base.definir_detail_contact(contact["id"], None)
    base.definir_raison_pause_campagne(campagne_id, str(panne))
    base.changer_statut_campagne(campagne_id, "en pause")
    journal.error("Campagne n°%d mise EN PAUSE — %s", campagne_id, panne)


RAISON_SANS_INTERET = ("aucune des places qui restaient n'est plus tôt que "
                       "son rendez-vous — l'avancer ne lui apporterait rien")


def _terminer(base, campagne_id):
    """Termine la campagne — et dit d'abord POURQUOI ses places restent vides.

    ⚠ UN SEUL POINT DE PASSAGE, EXPRÈS. Une campagne se termine à CINQ endroits
    de `executer_campagne` (place pourvue, place perdue, plus personne à
    appeler, plafond atteint, file vide). Écrire l'explication à quatre d'entre
    eux et l'oublier au cinquième, c'est exactement la demi-correction qui a
    fait tourner ce chantier en rond pendant trois jours.
    """
    dire_pourquoi_les_places_restent(base, campagne_id)
    # ⚠ ET LES DÉPLACEMENTS QU'ON N'A PAS SU FAIRE SONT ANNULÉS (20/08/2026).
    # Ici, parce que c'est déjà le seul point de passage de la fin de campagne :
    # une campagne se termine à cinq endroits, et l'oublier à l'un d'eux aurait
    # laissé des rendez-vous au planning d'une journée qu'il croit vide.
    cloturer_les_deplacements_non_faits(base,
                                        base.obtenir_campagne(campagne_id))
    base.changer_statut_campagne(campagne_id, "terminée")


def dire_pourquoi_les_places_restent(base, campagne_id):
    """Écrit sur chaque place encore « à pourvoir » POURQUOI elle l'est restée.

    ⚠ SON SIGNALEMENT DU 15/08/2026 : « la cascade s'arrête à la deuxième
    occurrence ; normalement cela doit continuer jusqu'à la date limite ». La
    mécanique, elle, était juste — mesuré dans sa base : la chaîne s'arrêtait
    sur la place du 06/11 parce qu'il aurait fallu un rendez-vous au 06/12 ou
    après pour y gagner trente jours, et que ses rendez-vous s'arrêtent au
    23/11. Il n'y avait tout simplement PERSONNE à appeler.

    Le défaut n'était donc pas le moteur : c'était le SILENCE. La place restait
    « à pourvoir », sans un mot, et la seule explication vivait dans une note
    interne (« regle_jouee ») qu'aucun écran ne met en avant. Face à un arrêt
    muet, on conclut que le produit est cassé — et on a raison de le croire.

    Trois causes possibles, dites dans cet ordre, parce que c'est l'ordre dans
    lequel elles arrêtent vraiment la chaîne :
      ① le plafond d'appels est atteint ;
      ② la date limite du décalage est dépassée ;
      ③ personne n'a de rendez-vous assez lointain — et on donne alors LA date
        qu'il aurait fallu, plus le rappel que la date limite, elle, n'y est
        pour rien.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if not campagne:
        return
    configuration = configuration_campagne(campagne)
    liste = creneaux_de(campagne, configuration)
    restantes = [f for f in liste if f["statut"] == CRENEAU_A_POURVOIR]
    if not restantes:
        return
    plafond = plafond_de(configuration)
    appels = appels_passes(base, campagne_id)
    limite = cascade_reglee(configuration["options"])
    gain = gain_de_la_regle(configuration)
    for fiche in restantes:
        origine = fiche.get("pourquoi") or ""
        if plafond and appels >= plafond:
            raison = (f"le maximum de {plafond} appel(s) réglé pour cette "
                      "campagne est atteint — relevez-le pour continuer la "
                      "chaîne")
        elif limite and fiche["horaire"][:10] > limite:
            raison = ("elle tombe après le "
                      f"{date_jour_lisible(limite)}, la date limite réglée "
                      "pour le décalage en cascade")
        elif gain:
            borne = (datetime.datetime.fromisoformat(fiche["horaire"])
                     + datetime.timedelta(days=int(gain)))
            raison = ("personne n'a de rendez-vous au "
                      f"{date_courte(borne.isoformat(timespec='minutes'))} "
                      f"ou après — c'est ce qu'il faudrait pour gagner les "
                      f"{gain} jours demandés sur cette place. La chaîne "
                      "s'arrête donc ici")
            if limite and fiche["horaire"][:10] <= limite:
                raison += (f", AVANT votre date limite du "
                           f"{date_jour_lisible(limite)} — ce n'est pas elle "
                           "qui l'arrête")
        else:
            raison = ("plus personne à appeler : aucun rendez-vous connu "
                      "n'est après cette place")
        fiche["pourquoi"] = f"{origine} — {raison}" if origine else raison
    _ecrire_creneaux(base, campagne_id, configuration, liste)
    journal.info("Campagne n°%d : %d place(s) restée(s) à pourvoir — la raison "
                 "est écrite sur chacune", campagne_id, len(restantes))


def campagne_a_des_places(campagne):
    """Cette campagne ANNONCE-t-elle des places à pourvoir au téléphone ?

    ⚠ CE N'EST PAS « PORTE-T-ELLE UN CRÉNEAU EN BASE ». Un maillon de cascade
    de nature « déplacement » porte la place libérée comme TRACE (règle §8.3,
    et l'anti-doublon s'en sert), mais son message annonce des créneaux de
    REMPLACEMENT calculés — jamais cette place. Confondre les deux faisait
    « avancer le curseur » sur une place que personne ne proposait, et
    affichait aux contacts restants une raison qui ne correspondait à rien.

    `INFO_CRENEAU_PAR_NATURE` est le seul endroit qui sache lesquelles ont un
    champ d'étape 2 portant leur place : c'est donc lui qui répond.
    """
    return (campagne or {}).get("nature") in INFO_CRENEAU_PAR_NATURE


def _place_perdue(base, preferences, campagne, configuration):
    """La place que la campagne propose est-elle encore libre ? Rend la raison.

    Rend "" quand tout va bien — donc quand il n'y a rien à empêcher.

    ⚠ NE VAUT QUE POUR LES CAMPAGNES QUI PROPOSENT UNE PLACE. Une campagne de
    rappel ou de confirmation ne réserve rien : elle n'a pas de place à perdre,
    et la lui chercher l'arrêterait sans raison.

    ⚠ LA DURÉE MINIMALE, UNE TRANCHE. On répond ici à « cette place existe-t-elle
    encore », pas à « tient-elle pour telle personne » : un rendez-vous de deux
    tranches peut être refusé sur une place libre d'une seule, et ce refus-là
    concerne UN contact, pas la campagne. Le juger avec la durée du premier
    contact aurait arrêté la campagne pour tous les autres.

    ⚠ ET SEULEMENT LA PLACE ENCORE « À POURVOIR ». Première version : elle
    retombait sur `campagne["creneau"]` quand la liste ne rendait plus rien — donc
    sur la place que la campagne venait ELLE-MÊME de pourvoir. Sur une campagne
    réglée « appeler toute la liste », le premier oui réservait la place, la
    place devenait occupée, et le garde-fou arrêtait tout : vingt contrôles du
    banc sont tombés là-dessus. « Pourvu par nous » et « pris ailleurs » ne sont
    pas la même chose — c'est même la raison d'être des deux statuts.
    """
    if campagne["nature"] not in INFO_CRENEAU_PAR_NATURE:
        return ""
    place = (creneau_courant(campagne, configuration) or {}).get("horaire")
    if not place:
        return ""
    return horaires.refus_rendezvous_telephone(base, preferences, place,
                                               tranches=1) or ""


# ============================ LES ÉTATS DITS EN MOTS CLAIRS
# ⚠ « ÉPARGNÉ » NE VOULAIT RIEN DIRE POUR SON LECTEUR (11/08/2026) : « je ne sais
# pas ce que veut dire l'état "épargné" ». Le mot était juste dans l'intention —
# on lui a épargné un appel inutile — mais il n'est pas dans le vocabulaire de
# quelqu'un qui regarde une liste d'appels.
#
# ⚠ ON CHANGE LE MOT AFFICHÉ, PAS LE CODE ÉCRIT EN BASE. Des milliers de lignes
# portent déjà « épargné » ; les récrire serait une migration de données, alors
# que le produit ne fait que des migrations ADDITIVES. Le code reste, seul son
# libellé change — et il ne change qu'à UN endroit.
#
# ⚠ ET IL S'APPELLE `mot_etat`, PAS `libelle_etat` : `etats_clients.libelle_etat`
# existe déjà et parle d'un TOUT AUTRE vocabulaire (les états d'un client, pas
# ceux d'un contact de campagne). Deux fonctions du même nom pour deux
# vocabulaires, c'est la confusion garantie à la première relecture.
MOTS_ETAT = {
    "épargné": "pas appelé",
    # ⚠ SA DEMANDE DU 21/08/2026 : « renomme l'état en "❌ annulé — le client
    # rappellera" ». « Le client rappellera » était vrai mais taisait le FAIT :
    # le rendez-vous est ANNULÉ. Sur sa campagne n° 119, trois personnes
    # portaient ce mot et il a compté deux annulations là où il y en avait
    # trois. Le mot dit maintenant ce qui est arrivé, puis ce qui suit.
    #
    # ⚠ LE CODE ÉCRIT EN BASE NE BOUGE PAS — même règle que pour « épargné » :
    # des centaines de lignes le portent, les récrire serait une migration de
    # données. Seul le libellé change, et il ne change qu'ICI.
    ETAT_RAPPELLERA: "annulé — le client rappellera",
}


def mot_etat(etat):
    """Le mot à AFFICHER pour cet état de contact. Le code ne bouge pas."""
    return MOTS_ETAT.get(etat, etat)


# ⚠ MÊME PRINCIPE POUR LES DÉTAILS DÉJÀ ÉCRITS EN BASE (21/08/2026).
# « Plafond atteint » est devenu « maximum de rappels atteint » — mais des
# centaines de lignes portent déjà l'ancien texte, gelé au moment de l'appel.
# Mesuré sur sa base : 39 contacts. Les récrire serait une MIGRATION DE
# DONNÉES, alors que le produit n'en fait que des additives ; et ce sont des
# archives, pas des libellés. On les traduit donc À L'AFFICHAGE, au seul
# endroit qui les montre.
ANCIENS_MOTS_DETAIL = (
    ("— plafond atteint", "— maximum de rappels atteint"),
    ("plafond de tentatives atteint", "maximum de rappels atteint"),
)


def mot_detail(detail):
    """Le détail à AFFICHER : l'ancien vocabulaire traduit, rien de plus.

    Le texte en base n'est jamais touché — c'est ce qui a été écrit ce jour-là.
    """
    texte = detail or ""
    for ancien, neuf in ANCIENS_MOTS_DETAIL:
        texte = texte.replace(ancien, neuf)
    return texte


# ================== FORCER L'HEURE — EN SIMULATION, ET NULLE PART AILLEURS
# Demande du propriétaire du 13/08/2026 : « lorsqu'il y a l'erreur qui nous
# indique qu'on est en dehors du créneau autorisé lors de l'exécution d'une
# campagne, il faut afficher un bouton pour forcer la simulation malgré
# l'heure (uniquement pour la version en simulation c'est très important) ».
#
# LA RAISON EST NETTE : en simulation, AUCUN téléphone ne sonne. Le garde-fou
# de politesse protège des gens ; à 22 h, sur une campagne simulée, il ne
# protège personne et il empêche seulement d'essayer le produit. En appels
# RÉELS il protège quelqu'un — il ne se force donc jamais.
#
# ⚠ LE DRAPEAU ENREGISTRÉ NE SUFFIT JAMAIS À LUI SEUL. Il est relu avec le
# mode DU MOMENT (voir `heure_forcee`) : une campagne forcée en simulation,
# puis reprise en appels réels, retrouve le garde-fou intact — sans qu'aucun
# ménage n'ait à passer derrière, et sans qu'on ait à faire confiance à ce
# qui est écrit en base.
CLE_HORAIRE_FORCE = "horaire_force"


def heure_forcee(configuration, mode_reel):
    """Cette campagne tourne-t-elle hors plage d'appel — et en a-t-elle le droit ?

    Deux conditions, jamais une seule : le geste a été fait sur CETTE
    campagne, ET l'on est en simulation. Voir le commentaire ci-dessus.
    """
    return bool(configuration.get(CLE_HORAIRE_FORCE)) and not mode_reel


def noter_heure_forcee(base, campagne_id):
    """Écrit sur la campagne que l'heure a été forcée (geste explicite).

    Sur la campagne, pas dans une variable de passage : le fil d'exécution
    revérifie la plage ENTRE CHAQUE APPEL (une campagne lancée à 18 h 59
    s'arrêterait sinon au premier contact suivant), et l'écran doit pouvoir
    dire, longtemps après, que celle-ci a tourné hors des heures permises.
    """
    campagne = base.obtenir_campagne(campagne_id)
    if campagne is None:
        return
    configuration = configuration_campagne(campagne)
    configuration[CLE_HORAIRE_FORCE] = True
    base.definir_configuration_campagne(
        campagne_id, json.dumps(configuration, ensure_ascii=False))


def executer_campagne(application, campagne_id):
    """Le corps du fil d'exécution lancé par ▶ Démarrer.

    Un contact à la fois, dans l'ordre choisi ; ENTRE deux appels, la
    commande ⏸ Pause / ⏹ Arrêter est relue (un appel en cours va toujours
    à son terme) et la plage horaire + la période interdite sont re-vérifiées.
    Politique « premier oui » : le premier OUI épargne tous les suivants et
    annule les relances de la campagne (l'objectif est atteint).

    UNE PANNE DE NOTRE CÔTÉ (clé refusée, service en panne, crédit épuisé)
    met la campagne EN PAUSE dès le premier appel touché : inutile
    d'infliger la même panne aux dix-neuf personnes suivantes, et surtout
    pas question de les marquer « injoignables » pour une faute qui est la
    nôtre (voir mettre_en_pause_sur_panne).
    """
    base = application.base
    planif = application.planif
    preferences = application.preferences
    # On repart pour de bon : la raison d'une pause SUBIE (panne de notre
    # côté) est effacée ici, quel que soit le chemin par lequel on relance.
    # Une explication périmée ne doit jamais rester sous les yeux.
    base.definir_raison_pause_campagne(campagne_id, None)
    try:
        campagne = base.obtenir_campagne(campagne_id)
        configuration = configuration_campagne(campagne)
        # ⚠ UNE FILE RELUE, PAS UNE LISTE FIGÉE. La boucle « for » d'avant ne
        # pouvait pas se recharger : réaffecter la liste n'affecte pas
        # l'itération en cours, et découper « restants[indice + 1:] » aurait
        # indexé une AUTRE liste — des contacts jamais appelés et jamais
        # marqués, ou marqués « épargné » à tort. Avec une file relue à chaque
        # tour, une place qui s'ajoute ou une liste qui se régénère sont vues
        # tout de suite.
        # `traites` est la ceinture : un contact dont l'état ne bougerait pas
        # ferait tourner la boucle sans fin.
        traites = set()

        def file_a_appeler():
            """Ce qu'il reste à appeler, relu en base, dans l'ordre choisi."""
            attente = [c for c in base.contacts_de_campagne(campagne_id)
                       if c["etat"] in ("à appeler", "en cours")
                       and c["id"] not in traites]
            return ordonner_contacts(attente, configuration["ordre"],
                                     campagne.get("creneau"))

        def file_utile():
            """La file, moins ceux à qui les places restantes n'apportent rien.

            ⚠ ON NE LES MARQUE PAS : le filtre est rejoué à chaque tour. Une
            place RENDUE par quelqu'un qui accepte peut être plus TÔT que la
            place en cours et les rendre de nouveau pertinents — les marquer
            « épargné » les aurait exclus pour de bon.

            ⚠ ET SEULEMENT SUR UNE CAMPAGNE À LISTE. Celle qui n'a qu'une
            place garde son comportement d'avant, à la lettre : sa liste est
            déjà resserrée à la création, et son curseur ne bouge jamais.

            ⚠ LE GAIN MINIMUM SUIT LA PLACE EN COURS (15/08/2026). La règle
            charge la liste au seuil de la PREMIÈRE place ; sans cela, quelqu'un
            retenu pour un gain de 35 jours sur la place du 15/08 se voyait
            proposer, une fois la campagne avancée jusqu'au 15/09, une place qui
            ne lui faisait plus gagner que deux jours. Voir
            `place_utile_au_contact`.
            """
            if not configuration.get("liste_de_places"):
                return file_a_appeler()
            annoncees = places_annoncees(campagne, configuration)
            gain = gain_de_la_regle(configuration)
            return [contact for contact in file_a_appeler()
                    if interesse_par_une_place(base, contact, annoncees,
                                               gain=gain)]

        def epargner_le_reste(obtenu):
            """Les non-appelés sont ÉPARGNÉS, avec la raison en clair."""
            for suivant in file_a_appeler():
                base.changer_etat_contact_campagne(suivant["id"], "épargné",
                                                   None)
                base.definir_detail_contact(
                    suivant["id"], f"Jamais appelé — {obtenu}")

        # ⚠ SIMULATION SEULEMENT : la campagne qui démarre rejoue depuis le
        # début la liste des cas de figure de SA nature. On donne le nombre de
        # personnes à appeler pour que la liste TIENNE dedans : sans ce nombre,
        # une campagne de cinq contacts s'arrêtait avant le dernier cas et la
        # place n'était jamais pourvue. Le client réel ne fait rien de cet
        # appel (voir calle_client.ClientAppels.recommencer_les_cas).
        planif.client_appels.recommencer_les_cas(campagne["nature"],
                                                len(file_utile()))

        # ⚠ LA PLACE EXISTE-T-ELLE ENCORE ? RELUE AU DÉMARRAGE (11/08/2026).
        # LE DÉFAUT, MESURÉ : une campagne dont la place était déjà occupée a
        # passé TRENTE appels pour rien et envoyé QUATORZE personnes « à rappeler
        # par un humain » — chacune s'étant entendu dire au téléphone que la
        # place était pour elle. Le produit ne s'en apercevait qu'APRÈS l'appel,
        # une fois par personne, en refusant d'écrire le rendez-vous.
        #
        # Même doctrine que mettre_en_pause_sur_panne : inutile d'infliger le
        # même échec aux dix-neuf suivants. Et c'est pire qu'une panne — ici on
        # aurait PROMIS une place à quatorze personnes.
        #
        # ⚠ AU DÉMARRAGE, PAS AVANT CHAQUE APPEL. Première version : elle
        # relisait la place à chaque tour de boucle, et arrêtait donc une campagne
        # réglée « appeler toute la liste » dès que quelqu'un avait pris la place
        # — alors que ce cas-là a déjà sa mécanique (la place passe « pourvue »,
        # le curseur avance). Vingt contrôles du banc l'ont dit. Ce qu'il fallait
        # empêcher, c'est de PARTIR sur une place qui n'existe plus ; pendant la
        # campagne, la vérification par appel (`place_retenue`) fait le reste.
        while True:
            perdue = _place_perdue(base, preferences, campagne, configuration)
            if not perdue:
                break
            place = (creneau_courant(campagne, configuration) or {}).get(
                "horaire")
            journal.info("Campagne n°%d : la place du %s n'est plus disponible "
                         "(%s) — aucun appel ne part pour elle",
                         campagne_id, place, perdue)
            marquer_creneau(base, campagne_id, place, CRENEAU_PERDU,
                            pourquoi=perdue)
            campagne, configuration, suivante, _ = (
                avancer_sur_la_place_suivante(base, preferences, campagne,
                                              configuration))
            if suivante is None:
                epargner_le_reste("la place proposée n'est plus disponible : "
                                  f"{perdue}")
                _terminer(base, campagne_id)
                return

        # ⚠ LE PLAFOND EST UN BUDGET D'APPELS, ET C'EST ICI QU'IL SE TIENT
        # (15/08/2026). Avant, il ne bornait que la TAILLE de la liste : comme
        # personne ne s'ajoutait en cours de route, cela suffisait. Depuis que
        # la cascade recharge des contacts sur ses places (voir
        # `regenerer_la_liste`), la liste peut grossir — et c'est la boucle qui
        # doit compter. Sans cette garde, un plafond de trente aurait laissé
        # partir cinquante appels.
        plafond_appels = plafond_de(configuration)

        while True:
            if (plafond_appels
                    and appels_passes(base, campagne_id) >= plafond_appels):
                journal.info("Campagne n°%d : maximum de %d appel(s) atteint — "
                             "la campagne s'arrête, personne d'autre n'est "
                             "composé", campagne_id, plafond_appels)
                if file_a_appeler():
                    epargner_le_reste(
                        f"le maximum de {plafond_appels} appel(s) réglé pour "
                        "cette campagne est atteint : aucun autre numéro n'est "
                        "composé. Relevez-le dans la campagne pour continuer, "
                        "ou reprenez ces personnes dans une nouvelle campagne")
                break
            file = file_utile()
            if not file:
                # ⚠ IL PEUT RESTER DU MONDE : ceux à qui aucune des places
                # restantes n'apporte rien. Les laisser « à appeler » sur une
                # campagne terminée aurait laissé croire à un travail en
                # suspens — ils sont épargnés, avec la raison en clair.
                if file_a_appeler():
                    epargner_le_reste(RAISON_SANS_INTERET)
                break
            contact = file[0]
            traites.add(contact["id"])
            commande = application.commande_execution(campagne_id)
            if commande == "pause":
                base.changer_statut_campagne(campagne_id, "en pause")
                journal.info("Campagne n°%d mise en PAUSE entre deux appels",
                             campagne_id)
                return
            if commande == "arret":
                base.changer_statut_campagne(campagne_id, "arrêtée")
                journal.info("Campagne n°%d ARRÊTÉE entre deux appels",
                             campagne_id)
                return
            # ⚠ LA PÉRIODE INTERDITE, ELLE, NE SE FORCE JAMAIS — dans aucun
            # mode. Décision du propriétaire : elle vaut pour tout, sans
            # dérogation. Seule la plage horaire se lève, et seulement en
            # simulation (voir `heure_forcee`).
            blocage = dans_periode_interdite(preferences)
            if not blocage and not heure_forcee(configuration,
                                                application.mode_reel):
                blocage = themes.hors_plage(preferences)
            if blocage:
                # ⚠ ET LA RAISON EST ÉCRITE (14/08/2026, audit croisé). Une
                # campagne démarrée à 18 h 55 s'arrêtait à 19 h au milieu de sa
                # liste, statut « en pause » et RIEN d'autre : ni sur la fiche,
                # ni ailleurs. L'opérateur ne l'apprenait qu'en recliquant sur
                # ▶ Reprendre, qui lui renvoyait alors le refus. C'est le même
                # devoir que la pause SUBIE d'une panne, qui l'écrit depuis le
                # début (voir mettre_en_pause_sur_panne).
                base.definir_raison_pause_campagne(campagne_id, blocage)
                base.changer_statut_campagne(campagne_id, "en pause")
                journal.info("Campagne n°%d mise en pause : %s",
                             campagne_id, blocage)
                return
            base.changer_etat_contact_campagne(contact["id"], "en cours", None)
            try:
                conclusion = _appeler_contact(base, planif, preferences,
                                              campagne, configuration, contact,
                                              tentative=0)
            except calle_client.EchecDeNotreCote as panne:
                mettre_en_pause_sur_panne(base, campagne_id, panne, contact)
                return
            if conclusion in (CONCLUSION_POURVU, CONCLUSION_PLACE_PERDUE) \
                    and not campagne_a_des_places(campagne):
                # ⚠ CETTE NATURE N'ANNONCE AUCUNE PLACE (14/08/2026, audit
                # croisé). Un maillon de cascade de nature « déplacement » porte
                # bien la place libérée — c'est la trace §8.3, et l'anti-doublon
                # s'en sert — mais son message, lui, annonce des créneaux de
                # REMPLACEMENT. Faire « avancer le curseur » sur cette place
                # recalait le message sur elle et affichait aux contacts
                # restants une raison qui ne correspondait à rien. Ici, un oui
                # conclut : c'est tout.
                epargner_le_reste(
                    "arrêt au premier oui (le rendez-vous a été déplacé)")
                annulees = base.annuler_relances_campagne(campagne_id)
                if annulees:
                    journal.info("Campagne n°%d : objectif atteint, %d "
                                 "relance(s) annulée(s)", campagne_id, annulees)
                _terminer(base, campagne_id)
                return
            if conclusion == CONCLUSION_PLACE_PERDUE:
                # ⚠ LA PLACE VIENT DE MOURIR PENDANT LA CAMPAGNE. Le contrôle
                # du démarrage ne pouvait rien voir : elle était libre quand on
                # a commencé. On fait donc ici exactement ce qu'il fait —
                # avancer sur la place suivante, ou épargner le reste — au lieu
                # de continuer à appeler pour une place qui n'existe plus.
                campagne, configuration, suivante, raison = (
                    avancer_sur_la_place_suivante(
                        base, preferences, campagne, configuration))
                if suivante is not None:
                    continue
                epargner_le_reste(
                    raison if raison and raison != "toutes les places sont "
                                                   "pourvues"
                    else "la place proposée a été prise entre-temps — il ne "
                         "reste aucune place à pourvoir")
                _terminer(base, campagne_id)
                return
            if conclusion == CONCLUSION_POURVU:
                obtenu = ("le rendez-vous a été déplacé"
                          if campagne["nature"] == "deplacement"
                          else "le créneau est pourvu")
                # ⚠ UNE PLACE POURVUE N'ARRÊTE PLUS FORCÉMENT LA CAMPAGNE
                # (03/08/2026) : s'il en reste une à pourvoir, on relit la
                # campagne — donc son NOUVEAU créneau et son message recalé —
                # et l'on continue avec les personnes qui restent.
                campagne, configuration, suivante, raison = (
                    avancer_sur_la_place_suivante(
                        base, preferences, campagne, configuration))
                if suivante is not None:
                    continue
                # ⚠ LA RAISON EXACTE, pas la raison habituelle. Quand il
                # reste des places et que le message ne peut pas suivre,
                # écrire « arrêt au premier oui » serait faux — et c'est
                # justement ce qu'un opérateur relirait pour comprendre.
                epargner_le_reste(
                    f"arrêt au premier oui ({obtenu})"
                    if raison == "toutes les places sont pourvues"
                    else f"campagne arrêtée : {raison}")
                annulees = base.annuler_relances_campagne(campagne_id)
                if annulees:
                    journal.info("Campagne n°%d : objectif atteint, %d "
                                 "relance(s) annulée(s)", campagne_id, annulees)
                _terminer(base, campagne_id)
                return
        _terminer(base, campagne_id)
    except Exception:
        journal.exception("Campagne n°%d : incident d'exécution — mise en "
                          "pause (rien d'inventé)", campagne_id)
        base.changer_statut_campagne(campagne_id, "en pause")
    finally:
        application.terminer_execution(campagne_id)


def executer_relance(base, planif, preferences, campagne, relance, contact,
                     maintenant=None):
    """Une relance due d'une campagne de l'assistant — même moteur, mêmes
    états. Appelée par le GESTE « Lancer les relances dues » (campagnes.
    executer_relances_dues) ; l'exécution AUTOMATIQUE reste « à venir ».

    ⚠ LA RÈGLE DE L'INTÉRÊT EST REJOUÉE ICI (10/08/2026). Elle filtrait la file
    de la campagne, mais pas le départ d'une relance : quelqu'un dont le
    rendez-vous est déjà plus tôt que toutes les places restantes était rappelé
    pour une place qui ne l'avançait plus. Le même contrôle décide aussi du
    consentement — voir `interesse_par_une_place`.

    Le téléphone ne sonne alors PAS, et le contact passe 💤 épargné avec la
    raison en clair : la relance est consommée, elle ne reviendra pas.
    """
    configuration = configuration_campagne(campagne)
    if configuration.get("liste_de_places"):
        annoncees = places_annoncees(campagne, configuration)
        if not interesse_par_une_place(base, contact, annoncees, maintenant,
                                       gain=gain_de_la_regle(configuration)):
            raison = (RAISON_PLUS_DE_PROPOSITION
                      if base.plus_de_proposition(contact.get("client_id"))
                      else RAISON_SANS_INTERET)
            base.changer_etat_contact_campagne(contact["id"], "épargné", None)
            base.definir_detail_contact(contact["id"],
                                        f"Relance abandonnée — {raison}")
            journal.info("Campagne n°%d, contact n°%d : relance ABANDONNÉE, "
                         "aucun appel — %s", campagne["id"], contact["id"],
                         raison)
            return {"contact": contact["nom"], "issue": None, "abouti": False,
                    "etat": "épargné"}
    conclusion = _appeler_contact(base, planif, preferences, campagne,
                                  configuration, contact,
                                  tentative=relance["tentative"],
                                  maintenant=maintenant)
    contact_frais = base.obtenir_contact_campagne(contact["id"])
    abouti = contact_frais["etat"] == "accepté"
    if conclusion == CONCLUSION_POURVU:
        base.annuler_relances_campagne(campagne["id"])
    return {"contact": contact["nom"], "issue": contact_frais["issue"],
            "abouti": abouti, "etat": contact_frais["etat"]}


# ---------------------------------------------------------------------------
# 📥 RÉCUPÉRER LES RÉSULTATS EN ATTENTE — sans rappeler personne
# ---------------------------------------------------------------------------
# Le geste qui répare la perte du 01/08/2026. Il ne compose AUCUN numéro :
# pour chaque appel déjà parti dont le résultat manque, il fait UNE lecture
# (GET /v1/calls/{identifiant}) et applique l'issue par le MÊME chemin que si
# elle était arrivée à temps (_appliquer_resultat) — rendez-vous déplacé,
# cahier des changements, cascade, relances, tout.
#
# Les trois verrous du mode réel ne sont pas concernés : ils gardent la
# CRÉATION d'appels, et il n'y a pas une ligne ici qui puisse en créer un.
GESTE_SANS_APPEL = ("Ce geste ne compose AUCUN numéro : il ne fait que LIRE, "
                    "chez CALL-E, le résultat d'appels déjà passés.")


def _echec_de_lecture(erreur):
    """Le message d'une LECTURE qui a échoué — cadré comme une lecture.

    Le texte d'origine parle de campagne et d'appels facturés (il a été écrit
    pour un appel qui part). Ici rien n'est parti : on le dit d'abord, puis
    on cite le constat tel quel. Sans ce cadrage, l'écran laisserait croire
    qu'un appel vient d'être tenté.
    """
    constat = getattr(erreur, "constat", None) or str(erreur)
    quoi_faire = getattr(erreur, "quoi_faire", "")
    return " ".join(morceau for morceau in (
        "La LECTURE du résultat n'a pas abouti — aucun appel n'a été passé "
        "et rien n'a été écrit. L'identifiant de l'appel est conservé : "
        "réessayez plus tard.",
        constat.rstrip(".") + ".", quoi_faire) if morceau)


def _resume_recuperation(comptes):
    """La phrase de bilan affichée après le geste — jamais un compte inventé."""
    if not comptes:
        return ("Aucun appel en attente de résultat : il n'y avait rien à "
                "récupérer. " + GESTE_SANS_APPEL)
    par_sort = {}
    for compte in comptes:
        par_sort[compte["sort"]] = par_sort.get(compte["sort"], 0) + 1
    morceaux = []
    for sort, libelle in (
            ("applique", "{n} résultat(s) récupéré(s) et appliqué(s)"),
            ("en_cours", "{n} appel(s) encore en cours chez CALL-E — rien "
                         "n'a été écrit, réessayez plus tard"),
            ("sans_reponse", "{n} appel(s) sans réponse — la tentative est "
                             "comptée, comme un non-décroché normal"),
            ("echoue", "{n} appel(s) clos sans succès par CALL-E"),
            ("illisible", "{n} réponse(s) que RingBack n'a pas su lire — la "
                          "conversation a eu lieu, le contact passe « à "
                          "rappeler par un humain » et la réponse brute de "
                          "CALL-E est conservée sur sa fiche"),
            ("panne", "{n} lecture(s) impossible(s) — voir le message "
                      "ci-dessous"),
            ("sans_identifiant", "{n} contact(s) sans identifiant d'appel : "
                                 "leur résultat n'est pas récupérable")):
        if par_sort.get(sort):
            morceaux.append(libelle.format(n=par_sort[sort]))
    return " · ".join(morceaux) + ". " + GESTE_SANS_APPEL


def recuperer_resultats_en_attente(application, campagne_id, maintenant=None):
    """📥 Va LIRE chez CALL-E le résultat des appels déjà passés. AUCUN APPEL.

    Pour chaque contact « appelé, résultat inconnu » de cette campagne :
    - CALL-E dit « terminé » → le résultat est appliqué EXACTEMENT comme
      s'il était arrivé à temps (_appliquer_resultat : rendez-vous, cahier
      des changements, cascade, relances) ;
    - CALL-E dit « encore en cours » → RIEN n'est écrit, on le dit, et on
      réessaiera plus tard ;
    - CALL-E dit « personne n'a décroché » → c'est un fait sur le contact :
      la tentative est comptée et la relance programmée, comme d'habitude ;
    - la lecture elle-même échoue (clé refusée, service muet) → rien n'est
      écrit, l'identifiant est CONSERVÉ, et la fournée s'arrête là (la même
      panne frapperait les suivants).

    Rend la liste des comptes rendus [{"contact", "sort", "message"}].
    """
    base = application.base
    planif = application.planif
    preferences = application.preferences
    campagne = base.obtenir_campagne(campagne_id)
    if campagne is None:
        return []
    configuration = configuration_campagne(campagne)
    en_cascade = bool(campagne["nature"] == "creneau_libere"
                      and campagne.get("creneau"))
    comptes = []
    for contact in base.contacts_de_campagne(campagne_id):
        if contact["etat"] != ETAT_RESULTAT_INCONNU:
            continue
        identifiant = contact.get("appel_externe_id")
        nom = contact["nom"]
        if not identifiant:
            comptes.append({
                "contact": nom, "sort": "sans_identifiant",
                "message": ("Aucun identifiant d'appel n'a été conservé pour "
                            "ce contact : son résultat n'est pas récupérable "
                            "ici. Regardez le tableau de bord CALL-E.")})
            continue
        try:
            lecture = planif.client_appels.lire_resultat(identifiant,
                                                         cascade=en_cascade)
        except calle_client.ResultatInvalide as refus:
            # La réponse est bien arrivée : c'est RingBack qui ne sait pas la
            # lire. Réessayer rendrait la MÊME réponse illisible — laisser ce
            # contact « en attente » le ferait attendre pour toujours. On
            # conclut donc ici : vers un humain, réponse brute conservée, et
            # l'identifiant est effacé (il n'y a plus rien à récupérer).
            tentative = contact.get("appel_externe_tentative")
            if tentative is None:
                tentative = len(base.appels_du_contact_campagne(contact["id"]))
            noter_reponse_illisible(base, campagne_id, contact["id"],
                                    tentative, refus)
            base.effacer_appel_en_attente(contact["id"])
            comptes.append({"contact": nom, "sort": "illisible",
                            "message": str(refus)})
            continue
        except calle_client.EchecDeNotreCote as panne:
            # Rien n'est écrit et l'identifiant reste : on pourra réessayer
            # dès que la panne sera réparée. La fournée s'arrête ici.
            comptes.append({"contact": nom, "sort": "panne",
                            "message": _echec_de_lecture(panne)})
            journal.error("Récupération interrompue pour le contact n°%d — %s",
                          contact["id"], panne)
            break
        except calle_client.ErreurApi as erreur:
            comptes.append({"contact": nom, "sort": "panne",
                            "message": _echec_de_lecture(erreur)})
            journal.error("Récupération impossible pour le contact n°%d — %s",
                          contact["id"], erreur)
            break
        comptes.append(_appliquer_lecture(
            base, planif, preferences, campagne, configuration, contact,
            lecture, en_cascade, identifiant, maintenant))
    # Plus rien en attente : l'explication de la pause est PÉRIMÉE. La même
    # règle qu'au redémarrage d'une campagne — une raison qui ne vaut plus
    # ne doit jamais rester sous les yeux. La campagne, elle, reste en pause :
    # c'est à l'opérateur de décider de la reprendre.
    if comptes and not base.contacts_en_attente_de_resultat(campagne_id):
        base.definir_raison_pause_campagne(campagne_id, None)
    return comptes


def _appliquer_lecture(base, planif, preferences, campagne, configuration,
                       contact, lecture, en_cascade, identifiant,
                       maintenant=None):
    """Applique CE que CALL-E a répondu pour un appel déjà passé."""
    contact_id = contact["id"]
    nom = contact["nom"]
    options = configuration["options"]
    # La tentative de l'appel PARTI, telle qu'elle avait été notée : c'est
    # elle qui doit figurer dans l'historique, pas une valeur recalculée.
    tentative = contact.get("appel_externe_tentative")
    if tentative is None:
        tentative = len(base.appels_du_contact_campagne(contact_id))
    if lecture["etat"] == "en_cours":
        # RIEN n'est écrit : ni tentative, ni état, ni détail. L'appel garde
        # son identifiant et le contact garde son état d'attente.
        return {"contact": nom, "sort": "en_cours",
                "message": (f"L'appel n° {identifiant} est ENCORE EN COURS "
                            f"chez CALL-E (statut « {lecture['statut_api']} ») "
                            ": rien n'a été écrit sur cette personne. "
                            "Réessayez dans un moment.")}
    if lecture["etat"] in ("sans_reponse", "echoue"):
        # L'appel est bien allé au bout, et il n'a produit aucune
        # conversation : c'est le chemin NORMAL d'un non-joint, exactement
        # celui qu'aurait suivi la réponse arrivée à temps.
        issue = "no_answer" if lecture["etat"] == "sans_reponse" else "echec"
        base.ajouter_appel_campagne(campagne["id"], contact_id, tentative,
                                    issue=issue)
        _apres_non_joint(base, preferences, campagne, options, contact_id,
                         issue, maintenant)
        base.effacer_appel_en_attente(contact_id)
        contact_frais = base.obtenir_contact_campagne(contact_id)
        return {"contact": nom, "sort": lecture["etat"],
                "message": (f"CALL-E a répondu « {lecture['statut_api']} » : "
                            f"le contact passe « {contact_frais['etat']} ».")}
    # « terminé » : LE MÊME chemin d'écriture que si la réponse était
    # arrivée à temps — un seul code, donc aucune divergence possible.
    cible = base.cible_appel_contact(contact_id)
    telephone = (cible["telephone"]
                 or base.telephone_contact_campagne(contact_id) or "")
    base.effacer_appel_en_attente(contact_id)
    conclusion = _appliquer_resultat(
        base, planif, preferences, campagne, configuration, contact,
        tentative, lecture["issue"], en_cascade, cible, telephone, maintenant)
    if conclusion == CONCLUSION_POURVU:
        annulees = base.annuler_relances_campagne(campagne["id"])
        if annulees:
            journal.info("Campagne n°%d : objectif atteint par un résultat "
                         "récupéré, %d relance(s) annulée(s)",
                         campagne["id"], annulees)
    contact_frais = base.obtenir_contact_campagne(contact_id)
    return {"contact": nom, "sort": "applique",
            "issue": contact_frais["issue"], "etat": contact_frais["etat"],
            "message": (f"Résultat récupéré et appliqué : "
                        f"{contact_frais['etat']} — "
                        f"{contact_frais['detail'] or ''}").strip(" —")}
