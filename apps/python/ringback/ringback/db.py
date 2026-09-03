"""RingBack — accès aux données (sqlite3).

Dix tables : clients, rendez-vous, appels, cascades, appels_cascade,
le modèle « campagne » (campagnes, contacts_campagne, appels_campagne,
relances) — une campagne est l'instanciation d'un THÈME DE TRAVAIL sur une
liste de contacts importée à l'instant ; tout appel non abouti y génère une
relance planifiée qui conserve le thème — et le CAHIER DE CHANGEMENTS
(changements) : une ligne écrite AU MOMENT où le planning bouge, pour que
le vrai livrable d'une campagne — la liste des changements à reporter dans
le logiciel de planification de l'établissement — ne se reconstitue jamais
après coup, et ne perde donc rien.
Règle stricte de confidentialité : un numéro de téléphone ne sort JAMAIS
en clair dans les journaux ni dans l'interface — voir masquer_telephone().

QUI EST APPELÉ, ET QUEL NUMÉRO. Un contact de campagne porte un LIEN vers
la fiche client (contacts_campagne.client_id) : c'est le numéro ACTUEL de
cette fiche qui est composé, jamais la copie faite au moment de la
campagne (qui reste comme trace de ce qui avait été importé). Corriger un
numéro corrige donc toutes les campagnes en cours, et le 🚫 « Ne plus
appeler » ne peut plus être contourné par une correction. Un contact
simplement collé reçoit une fiche à son entrée dans la campagne, pour que
le lien existe toujours. Le point de passage obligé avant de composer est
cible_appel_contact() : il tient le lien ET le filet de sécurité (numéro
OU nom d'un client marqué 🚫, fiche supprimée).
Un client importé d'un agenda ICS peut ne pas avoir de numéro : son
telephone vaut alors "" (chaîne vide) tant qu'il n'est pas complété.
Le drapeau clients.jeu_essai marque les fiches du JEU D'ESSAI (module
jeu_essai) : elles s'ajoutent aux données réelles et se retirent en bloc
(supprimer_jeu_essai) sans jamais toucher aux clients de l'utilisateur.

LES NUMÉROS D'ESSAI (module essai_reel). L'opérateur peut déclarer les
numéros de ses TESTEURS dans ⚙ Réglages — le sien, celui d'un collègue,
celui d'un ami qui accepte de jouer un rôle — pour éprouver le produit en
conditions réelles. Ces numéros sont confiés à Base.numeros_essai, et c'est
ICI qu'ils servent : partout où un numéro est masqué pour l'écran, la ligne
rendue porte en plus « numero_essai » (vrai/faux). L'interface s'en sert
pour marquer 🧪 la personne concernée. Un numéro d'essai reste MASQUÉ comme
tous les autres : ce drapeau ne le révèle pas, il dit seulement « ceci est
un essai ».
Migration : uniquement additive (CREATE TABLE IF NOT EXISTS + ALTER TABLE
ADD COLUMN) — une base existante est enrichie à son prochain lancement,
jamais réécrite.

« ANNULÉ » EST UN STATUT D'HISTOIRE, « SUPPRIMÉ » EFFACE LA LIGNE DES VUES.
Règle du propriétaire (31/07/2026) : « annulé c'est pour les dates passées,
sinon on supprime le rendez-vous, cela laisse une place libre. » Un
rendez-vous À VENIR qu'on annule ne porte donc plus « annulé » mais
STATUT_SUPPRIME — voir le commentaire de cette constante pour le POURQUOI du
statut plutôt que d'un DELETE.
"""

import datetime
import functools
import inspect
import json
import logging
import os
import re
import sqlite3
import threading
import unicodedata

journal = logging.getLogger("ringback.db")

# --------------------------------------------------- « supprimé » : le choix
# LA RÈGLE DU PROPRIÉTAIRE, mot pour mot (31/07/2026) : « annulé c'est pour
# les dates passées, sinon on supprime le rendez-vous, cela laisse une place
# libre ».
#
# CE QU'ON A CHOISI, ET POURQUOI. « Supprimer » n'efface PAS la ligne de la
# base : elle prend le statut « supprimé », qui la retire de toutes les vues
# de travail et du calcul des places. Trois raisons, toutes vérifiables dans
# ce fichier :
#   1. le CAHIER DE CHANGEMENTS pointe le rendez-vous (changements.
#      rendezvous_id) — c'est là que vit l'histoire (qui, quand, motif,
#      raison, horodatage). Un DELETE laisserait ce lien dans le vide ;
#   2. les CONTACTS DE CAMPAGNE pointent le rendez-vous
#      (contacts_campagne.rendezvous_id) : l'effacer casserait le lien entre
#      une campagne passée et ce dont elle parlait ;
#   3. les APPELS pointent le rendez-vous (appels.rendezvous_id) : un appel
#      réellement passé ne doit jamais devenir orphelin.
# Un effacement pur et dur romprait ces trois liens SANS rien apporter à
# l'utilisateur : ce qu'il demande, c'est que le rendez-vous disparaisse de
# ses écrans et que la place redevienne libre — les deux sont obtenus.
# Si le propriétaire préfère l'effacement réel, c'est ICI qu'on le corrigera,
# et nulle part ailleurs.
STATUT_SUPPRIME = "supprimé"

# Les statuts qui ne TIENNENT plus : ni place occupée, ni ligne « à venir ».
# « supprimé » y ajoute qu'il quitte AUSSI les listes de travail et les
# comptes — il ne subsiste que dans le cahier des changements, dans
# « Tous les rendez-vous » et sur la fiche du client (les deux archives).
STATUTS_SANS_PLACE = ("annulé", "déplacé", "ignoré", STATUT_SUPPRIME)

SCHEMA = """
CREATE TABLE IF NOT EXISTS clients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nom             TEXT NOT NULL,
    telephone       TEXT NOT NULL,
    ne_plus_appeler INTEGER NOT NULL DEFAULT 0,    -- 1 : exclu de tout appel (réversible)
    jeu_essai       INTEGER NOT NULL DEFAULT 0,    -- 1 : client du JEU D'ESSAI (retirable en bloc)
    -- 1 : ne veut plus qu'on lui PROPOSE de créneau libéré. ⚠ CE N'EST PAS LE
    -- 🚫 : elle reste appelable pour SES rendez-vous (rappel, confirmation,
    -- déplacement) — c'est le démarchage d'une place libre qu'elle refuse.
    -- Demandé au téléphone après un refus (voir assistant), réversible depuis
    -- 👥 Contacts. Par défaut 0 : refuser une place une fois n'a jamais
    -- signifié refuser les suivantes.
    plus_de_proposition INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rendezvous (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER NOT NULL REFERENCES clients(id),
    horaire         TEXT NOT NULL,                 -- ISO 8601
    motif           TEXT NOT NULL,
    statut          TEXT NOT NULL DEFAULT 'prévu', -- prévu | manqué | confirmé | déplacé | annulé | ignoré | supprimé
                                                   -- « annulé » = histoire d'une date PASSÉE ;
                                                   -- « supprimé » = le rendez-vous n'existe plus
                                                   -- (hors de toutes les vues, place rendue libre)
    rappel_souhaite TEXT,                          -- ISO 8601, optionnel : quand le client souhaite être rappelé
    duree_tranches  INTEGER NOT NULL DEFAULT 1     -- durée en TRANCHES (voir horaires.py) ; 1 = la durée moyenne
);
CREATE TABLE IF NOT EXISTS appels (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    rendezvous_id INTEGER NOT NULL REFERENCES rendezvous(id),
    statut        TEXT NOT NULL DEFAULT 'en file', -- en file | terminé | annulé | échec
    resultat      TEXT,                            -- JSON structuré renvoyé par l'agent
    transcription TEXT,
    note          TEXT,                            -- ce que LE PRODUIT a décidé (jamais
                                                   -- du texte d'agent) : refus d'écrire
                                                   -- une date impossible, appel non composé…
    appel_externe_id TEXT,                         -- l'identifiant de CET appel chez CALL-E,
                                                   -- gardé dès que la création aboutit : un
                                                   -- appel parti ne peut plus être perdu
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cascades (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    mission       TEXT NOT NULL,
    creneau       TEXT NOT NULL,                   -- ISO 8601 : le créneau libéré
    statut        TEXT NOT NULL DEFAULT 'en cours',-- en cours | pourvue | épuisée
    rendezvous_id INTEGER REFERENCES rendezvous(id),
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS appels_cascade (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    cascade_id    INTEGER NOT NULL REFERENCES cascades(id),
    rang          INTEGER NOT NULL,                -- position dans la liste collée
    nom           TEXT NOT NULL,
    telephone     TEXT NOT NULL,
    etat          TEXT NOT NULL,                   -- appelé | épargné | exclu
    issue         TEXT,      -- accepted | refused | no_answer | moved | echec |
                             -- date_refusee (nul si épargné)
    resultat      TEXT,                            -- JSON structuré renvoyé par l'agent
    transcription TEXT,
    note          TEXT,                            -- ce que LE PRODUIT a décidé
    rendezvous_libere INTEGER REFERENCES rendezvous(id)  -- l'ancien rendez-vous
                             -- réellement libéré par CET appel (NULL : aucun —
                             -- soit il n'y en avait pas, soit on ne savait pas
                             -- lequel, et la note le dit en clair)
);
CREATE TABLE IF NOT EXISTS campagnes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nom           TEXT NOT NULL,                  -- nom auto lisible (« Créneau libéré du 03/08 14h — 28/07 »)
    theme         TEXT NOT NULL,                  -- creneau_libere | confirmation | manque (+ contact_unique | personnalise : retirés le 03/08/2026, encore LISIBLES en base)
    sujet         TEXT NOT NULL DEFAULT '',      -- sujet libre (servait au « contact unique », retiré)
    mission       TEXT NOT NULL DEFAULT '',      -- la mission validée au lancement (jamais de numéro dedans)
    creneau       TEXT,                          -- ISO 8601 : créneau libéré / date concernée (selon le thème)
    statut        TEXT NOT NULL DEFAULT 'en cours', -- en cours | terminée | close ;
                                                  -- assistant : prête | en cours | en pause | arrêtée | terminée
    cascade_id    INTEGER REFERENCES cascades(id),  -- la cascade rattachée (thème créneau libéré)
    nature        TEXT,                          -- nature de l'assistant (nul : campagne d'avant l'assistant)
    configuration TEXT,                          -- JSON : politique, ordre, options, infos, champs (assistant)
    raison_pause  TEXT,                          -- POURQUOI la campagne s'est mise en pause toute seule
                                                  -- (panne de NOTRE côté : clé refusée, service en panne…).
                                                  -- Effacée au redémarrage. NULL : pause voulue par l'opérateur.
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contacts_campagne (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    campagne_id   INTEGER NOT NULL REFERENCES campagnes(id),
    rang          INTEGER NOT NULL,               -- ordre d'appel dans la liste de l'instant
    nom           TEXT NOT NULL,
    telephone     TEXT NOT NULL,                  -- COPIE d'époque : trace historique,
                                                  -- JAMAIS le numéro composé (voir client_id)
    client_id     INTEGER REFERENCES clients(id), -- LA fiche client : c'est SON numéro
                                                  -- ACTUEL qui est composé. Fiche
                                                  -- disparue -> plus jamais composé.
    rendezvous_id INTEGER REFERENCES rendezvous(id), -- rendez-vous concerné (reprise depuis la base)
    etat          TEXT NOT NULL DEFAULT 'à appeler', -- à appeler | appelé | abouti | épargné | exclu | abandonné ;
                                                  -- assistant : accepté | refusé | à recontacter | injoignable |
                                                  -- à rappeler par un humain | en cours |
                                                  -- appelé, résultat inconnu
    issue         TEXT,                            -- dernière issue (confirmed, no_answer, to_reschedule…)
    champs        TEXT,                            -- JSON : valeurs des colonnes de la campagne (assistant)
    detail        TEXT,                            -- l'information clé affichée (écrite depuis le résultat réel)
    traite_le     TEXT,                            -- horodatage du geste humain « c'est fait » (🙋 rappels manuels)
    appel_externe_id TEXT,                         -- l'identifiant CALL-E de l'appel PARTI dont le
                                                   -- résultat n'est pas encore connu (NULL : aucun)
    appel_externe_tentative INTEGER                -- n° de tentative de cet appel (0 = appel initial)
);
CREATE TABLE IF NOT EXISTS appels_campagne (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    campagne_id   INTEGER NOT NULL REFERENCES campagnes(id),
    contact_id    INTEGER NOT NULL REFERENCES contacts_campagne(id),
    tentative     INTEGER NOT NULL,               -- 0 = appel initial, 1..n = relances
    issue         TEXT,                           -- confirmed | rescheduled | canceled | to_reschedule |
                                                  -- accepted | refused | moved | no_answer | echec
    resultat      TEXT,                           -- JSON structuré renvoyé par l'agent
    transcription TEXT,
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS relances (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    campagne_id   INTEGER NOT NULL REFERENCES campagnes(id),
    contact_id    INTEGER NOT NULL REFERENCES contacts_campagne(id),
    echeance      TEXT NOT NULL,                  -- ISO 8601 : quand la relance devient « due »
    tentative     INTEGER NOT NULL DEFAULT 1,     -- n° de la relance dans la chaîne (1..max)
    statut        TEXT NOT NULL DEFAULT 'planifiée', -- planifiée | faite | annulée
    motif         TEXT NOT NULL DEFAULT '',       -- pourquoi (pas de réponse, déplacement non conclu…)
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS changements (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    campagne_id   INTEGER NOT NULL REFERENCES campagnes(id),
    contact_id    INTEGER REFERENCES contacts_campagne(id),
    client_id     INTEGER REFERENCES clients(id),
    rendezvous_id INTEGER REFERENCES rendezvous(id),
    genre         TEXT NOT NULL,                  -- ajout | suppression | deplacement | humain
    nom           TEXT NOT NULL,                  -- QUI (jamais de numéro ici)
    ancienne_date TEXT,                           -- ISO 8601 : la date d'AVANT
    nouvelle_date TEXT,                           -- ISO 8601 : la date d'APRÈS
    motif         TEXT NOT NULL DEFAULT '',       -- le motif du rendez-vous
    duree         TEXT NOT NULL DEFAULT '',       -- durée lisible (« 30 minutes »)
    raison        TEXT NOT NULL DEFAULT '',       -- POURQUOI, ou la demande en clair
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


# --------------------------------------------------- refus AVANT de composer
# Les quatre raisons pour lesquelles un contact de campagne n'est JAMAIS
# composé. Ces textes s'affichent tels quels dans la colonne « détail » de la
# fiche de campagne : l'écran dit toujours POURQUOI l'appel n'est pas parti.
REFUS_STOP = "Client marqué 🚫 « Ne plus appeler »"
REFUS_STOP_NOM = ("Une fiche au même nom est marquée 🚫 « Ne plus appeler » — "
                  "appel refusé par sécurité")
REFUS_SANS_NUMERO = "Aucun numéro à composer"
REFUS_CLIENT_SUPPRIME = ("Fiche client supprimée — ce contact n'est plus "
                         "jamais composé (son historique reste lisible)")
# ⚠ LE RENDEZ-VOUS A CHANGÉ SOUS NOS PIEDS (21/08/2026, sa demande). Le texte
# se complète avec CE QUI a changé — voir `rendezvous_change_depuis_la_campagne`.
REFUS_RDV_CHANGE = "Le rendez-vous dont cette campagne parle a changé"

# Les statuts qui OCCUPENT une place. Recopiés de `horaires.STATUTS_OCCUPANTS`
# pour que db reste indépendant du calcul des horaires — même convention, même
# raison que `calle_client.RATTRAPAGE_JOURS`.
STATUTS_OCCUPANTS_RDV = ("prévu", "confirmé")

# ------------------------------------------- ce que DEVIENT un contact refusé
# ⚠ SA DEMANDE DU 20/08/2026 : « les personnes qui ont demandé de ne plus être
# appelées par un agent IA doivent être enregistrées comme à rappeler par un
# humain dans toutes les campagnes, et donc subir la logique de cet état ».
#
# Elles ont refusé L'AGENT, pas le cabinet. Les marquer « exclu » les faisait
# disparaître en silence : personne ne les rappelait jamais, et leur affaire
# tombait. « À rappeler par un humain » dit exactement ce qu'il faut faire, et
# sa logique est déjà celle qu'il faut : état TERMINAL, jamais dans les états
# appelables (seuls « à appeler » et « en cours » sont composés), aucune
# relance armée, aucun plafond approché — et la personne apparaît dans
# 🔁 Relances § 🙋, avec le geste « c'est fait » qui l'en sort sans rien effacer.
#
# ⚠ L'HOMONYME AUSSI, choisi par lui le 20/08 : il n'a rien demandé, mais un
# humain est justement le seul à pouvoir dire s'il s'agit de la même personne.
# L'écarter en silence pour une coïncidence de nom faisait tomber son affaire
# sans que personne ne puisse le rattraper.
#
# Les deux autres refus NE CHANGENT PAS : sans numéro, un humain n'a rien à
# composer non plus ; fiche supprimée, il n'y a plus personne à rappeler.
ETAT_RAPPEL_HUMAIN = "à rappeler par un humain"
ETAT_EXCLU = "exclu"

SUITE_DU_REFUS = {
    REFUS_STOP: (
        ETAT_RAPPEL_HUMAIN,
        "🚫 A demandé à ne plus être appelée par un agent — aucun appel "
        "automatique ne partira. À rappeler par un humain."),
    REFUS_STOP_NOM: (
        ETAT_RAPPEL_HUMAIN,
        "Une fiche au même nom est marquée 🚫 « Ne plus appeler » — aucun "
        "appel automatique ne part, par sécurité. À rappeler par un humain, "
        "qui saura s'il s'agit de la même personne."),
}


def refus_du_rendezvous(refus):
    """Ce refus vient-il d'un rendez-vous qui a changé ? (pour les écrans)"""
    return (refus or "").startswith(REFUS_RDV_CHANGE)


def suite_du_refus(refus):
    """(état, détail) d'un contact que l'on ne compose pas — UN SEUL endroit.

    Six chemins refusent de composer : la création de la campagne, l'appel de
    l'assistant, le moteur classique, la relance de cascade, la reprise d'une
    cascade et la file d'appels. Six décisions séparées auraient fini par
    diverger, et la divergence se paierait ici en personnes oubliées.

    Un refus inconnu retombe sur « exclu » avec son texte tel quel : c'est le
    comportement d'avant, et il reste juste pour tout ce qui n'est pas un 🚫.
    """
    return SUITE_DU_REFUS.get(refus, (ETAT_EXCLU, refus))


# ⚠ DÉRIVÉ DE LA TABLE, JAMAIS RECOPIÉ. Les écrans ont besoin de distinguer,
# parmi les 🙋, ceux qui ont refusé l'agent de ceux que l'agent n'a pas su
# conclure. Ma première version lisait « le détail commence-t-il par 🚫 » : elle
# ratait l'homonyme, dont le texte commence par « Une fiche au même nom ». Un
# critère recopié à la main se désaccorde toujours de la table qu'il imite.
DETAILS_REFUS_AGENT = frozenset(
    detail for etat, detail in SUITE_DU_REFUS.values()
    if etat == ETAT_RAPPEL_HUMAIN)


def refus_de_l_agent(detail):
    """Ce 🙋 vient-il d'un 🚫 (appel automatique écarté), et non d'un appel ?"""
    return (detail or "") in DETAILS_REFUS_AGENT


def chiffres_significatifs(numero):
    """Les 9 chiffres qui identifient un numéro français, quelle que soit
    son écriture (« 06 39 98 00 56 » et « +33 6 39 98 00 56 » rendent tous
    deux « 639980056 »). Rend "" si le texte n'est pas un numéro plausible."""
    chiffres = re.sub(r"\D", "", numero or "")
    return chiffres[-9:] if len(chiffres) >= 9 else ""


def cle_nom(nom):
    """La clé de comparaison d'un nom : sans casse, sans accents, espaces
    resserrés (« Mme Nadia Lefèvre » et « mme  nadia lefevre » se répondent).

    Sert au FILET DE SÉCURITÉ du 🚫 : une fiche marquée « Ne plus appeler »
    doit être reconnue même si son numéro a changé depuis la campagne.
    """
    decompose = unicodedata.normalize("NFD", (nom or "").casefold())
    sans_accents = "".join(c for c in decompose if not unicodedata.combining(c))
    return " ".join(sans_accents.split())


def heure_locale(horodatage):
    """« 2026-07-29 12:15:31 » (UTC, écrit par sqlite) → ISO local à la minute.

    Les colonnes `cree_le` portent la valeur de `datetime('now')`, qui est en
    temps UNIVERSEL ; toutes les autres dates de l'application sont en heure
    locale. Afficher la valeur brute donnerait une heure d'appel fausse (celle
    d'un autre fuseau) : cette conversion rétablit l'heure réellement vécue.
    Rend "" si l'horodatage est absent ou illisible — jamais d'heure inventée.
    """
    if not horodatage:
        return ""
    try:
        moment = datetime.datetime.fromisoformat(str(horodatage))
    except (TypeError, ValueError):
        return str(horodatage)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    return moment.astimezone().replace(tzinfo=None).isoformat(timespec="minutes")


def masquer_telephone(numero):
    """« +33 6 00 00 00 42 » devient « +33 6 •• •• •• 42 ».

    Seuls l'indicatif (deux premiers groupes) et le dernier groupe restent
    lisibles. Un numéro sans espaces est masqué chiffre à chiffre, sauf les
    deux derniers.
    """
    if not numero:
        return ""
    groupes = numero.split(" ")
    if len(groupes) >= 4:
        return " ".join(groupes[:2] + ["••"] * (len(groupes) - 3) + [groupes[-1]])
    return "•" * max(len(numero) - 2, 0) + numero[-2:]


def references_essai(numeros):
    """L'ensemble des chiffres significatifs des numéros d'essai déclarés.

    `numeros` accepte les DEUX formes, et c'est voulu : un seul numéro
    (texte, ou "" / None quand rien n'est déclaré) — l'écriture d'origine,
    du temps où l'opérateur ne pouvait déclarer QUE son propre téléphone —
    ou une liste de numéros, depuis qu'il peut déclarer plusieurs testeurs
    (lui, un collègue, un ami). Un numéro illisible est simplement ignoré :
    il n'exempte personne.
    """
    if numeros is None:
        candidats = ()
    elif isinstance(numeros, str):
        candidats = (numeros,)
    else:
        candidats = tuple(numeros)
    return {chiffres for chiffres in
            (chiffres_significatifs(numero or "") for numero in candidats)
            if chiffres}


def est_numero_essai(telephone, numero_essai):
    """Ce numéro est-il UN des numéros d'essai déclarés dans ⚙ Réglages ?

    La comparaison porte sur les neuf chiffres significatifs, jamais sur le
    texte : « 06 39 98 00 51 » et « +33 6 39 98 00 51 » sont le même numéro.
    Aucun numéro déclaré (chaîne vide, liste vide) : la réponse est toujours
    FAUX — la règle stricte s'applique alors à tout le monde, sans exception.

    `numero_essai` est soit UN numéro, soit la LISTE des numéros des
    testeurs déclarés (voir references_essai) : dans les deux cas, seuls les
    numéros réellement déclarés sont reconnus, et eux seuls.

    Pourquoi pas une comparaison de numéros masqués : le masquage est
    volontairement destructeur, et deux numéros différents peuvent se
    masquer pareil (06 39 98 00 51 et 06 39 12 34 51 donnent tous deux
    « 06 39 •• •• 51 »). Les confondre marquerait une VRAIE personne comme
    donnée d'essai : exactement ce qu'il ne faut jamais faire.
    """
    references = references_essai(numero_essai)
    if not references:
        return False
    chiffres = chiffres_significatifs(telephone or "")
    return bool(chiffres) and chiffres in references


def _sous_verrou(methode):
    """Enveloppe une méthode de Base : UN SEUL fil à la fois dans la base.

    Le verrou est pris à l'entrée de la méthode et rendu à sa sortie. Il
    couvre donc les trois moments, et pas seulement le premier :
      1. l'envoi de la requête ;
      2. la LECTURE de ses lignes — un curseur sqlite3 se lit paresseusement,
         les lignes ne sortent qu'au fur et à mesure de la boucle ;
      3. le commit.
    C'est exactement là que la panne se produisait : le commit d'un fil
    remettait à zéro la requête que l'autre fil était en train de lire, ce
    qui donnait « bad parameter or other API misuse » ou « cannot commit -
    no transaction is active », et mettait la campagne en pause sans raison
    visible.

    Ce que le verrou n'entoure JAMAIS : l'attente d'un appel téléphonique.
    Un appel se joue dans planificateur.py / calle_client.py, hors de cette
    classe ; aucune méthode de Base n'attend le téléphone. Une campagne qui
    passe trente secondes en ligne ne gèle donc pas l'interface.
    """
    @functools.wraps(methode)
    def enveloppe(self, *arguments, **nommes):
        with self.verrou:
            return methode(self, *arguments, **nommes)
    return enveloppe


def _serialiser_les_acces(classe):
    """Pose le verrou sur TOUTES les méthodes de la classe, d'un coup.

    Écrit à la main, ce serait « with self.verrou: » recopié dans quatre-
    vingts méthodes — une occasion d'oubli à chaque nouvelle méthode. Ici
    l'enveloppe est posée une fois pour toutes : une méthode ajoutée demain
    est protégée sans que personne ait à y penser.

    Deux exceptions volontaires : __init__ (il CRÉE le verrou) et les
    fonctions déclarées @staticmethod, qui n'ont pas de « self » et ne
    touchent donc jamais la connexion (ce sont des metteurs en forme de
    lignes déjà lues).
    """
    for nom, valeur in list(vars(classe).items()):
        if nom == "__init__" or not inspect.isfunction(valeur):
            continue
        setattr(classe, nom, _sous_verrou(valeur))
    return classe


@_serialiser_les_acces
class Base:
    """Petite couche d'accès à la base sqlite3.

    UNE seule connexion, partagée par tous les fils (le fil de fond qui
    déroule une campagne et les fils qui répondent aux pages web), et un
    verrou qui les fait passer un par un — voir _sous_verrou ci-dessus.
    Pourquoi une connexion partagée plutôt qu'une connexion par fil : la
    base des tests est « :memory: », et une base en mémoire n'existe QUE
    dans sa connexion — une connexion par fil donnerait à chaque fil une
    base vide et différente, sans le moindre message d'erreur.
    """

    def __init__(self, chemin=":memory:"):
        if chemin != ":memory:":
            # Base sur disque : le dossier (ex. donnees/) est créé au besoin.
            dossier = os.path.dirname(os.path.abspath(chemin))
            os.makedirs(dossier, exist_ok=True)
        # Verrou d'abord : toutes les autres méthodes le prennent en entrant.
        # Ré-entrant, parce qu'une méthode de Base en appelle souvent une
        # autre — le même fil doit pouvoir repasser la porte.
        self.verrou = threading.RLock()
        # Les numéros d'ESSAI déclarés par l'opérateur (⚙ Réglages) : un par
        # TESTEUR (lui, un collègue, un ami qui joue un rôle). Liste vide =
        # personne n'est déclaré. Ils ne changent RIEN à ce qui est stocké ni
        # à ce qui est composé : ils servent uniquement à poser le drapeau
        # « numero_essai » sur les lignes rendues à l'écran, pour qu'elles
        # soient marquées 🧪. Posés par serveur.Application au démarrage et à
        # chaque enregistrement des réglages ; vides partout ailleurs (tests,
        # banc d'essai) — donc aucune ligne marquée tant que rien n'est
        # déclaré.
        self.numeros_essai = []
        # Le PREMIER de ces numéros, gardé sous son ancien nom : du temps où
        # un seul numéro était déclarable, c'était LE numéro d'essai. Tout ce
        # qui le lisait continue de fonctionner.
        self.numero_essai = ""
        # check_same_thread=False : le serveur web répond depuis un autre fil.
        self.conn = sqlite3.connect(chemin, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        # Filet pour le cas où un AUTRE programme ouvre le même fichier (le
        # banc d'essai, une copie de secours…) : au lieu d'abandonner tout de
        # suite sur « database is locked », sqlite patiente jusqu'à 5 s.
        self.conn.execute("PRAGMA busy_timeout = 5000")
        # ⚠ POURQUOI CES DEUX RÉGLAGES : L'IMPORT D'UN AGENDA DURAIT UNE MINUTE
        # (constaté par le propriétaire le 17/08/2026, « extrêmement long »).
        #
        # MESURÉ, sur une copie de sa base, un agenda de 471 rendez-vous :
        #   par défaut ................ 4,36 s
        #   WAL seul .................. 1,31 s
        #   WAL + synchronous NORMAL .. 0,78 s   (5,6 fois plus rapide)
        #
        # LA CAUSE : un import écrit rendez-vous par rendez-vous, donc il
        # enregistre 937 fois. Par défaut, chaque enregistrement force une
        # écriture physique sur le disque (fsync) — 2,6 des 4,4 secondes y
        # passaient. En mode WAL les écritures vont dans un journal ajouté en
        # bout de fichier, et « synchronous = NORMAL » n'exige plus le fsync à
        # chaque fois.
        #
        # CE QU'ON GARDE : la base reste cohérente, une transaction reste tout
        # ou rien, et deux programmes peuvent la lire pendant qu'un troisième
        # écrit (c'est même plus sûr qu'avant sur ce point). CE QU'ON ACCEPTE :
        # une coupure de courant BRUTALE pourrait perdre les toutes dernières
        # transactions — pas corrompre la base. Pour un outil local qui tourne
        # sur le poste d'un cabinet, c'est le bon échange ; le contraire faisait
        # attendre une minute à chaque agenda importé.
        #
        # Effet de bord à connaître : SQLite crée deux fichiers voisins,
        # `ringback.db-wal` et `ringback.db-shm`. Ils sont écartés de la copie
        # à publier, comme la base elle-même.
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA synchronous = NORMAL")
        self.conn.executescript(SCHEMA)
        self._migrer()
        self.conn.commit()

    def _migrer(self):
        """Ajoute les colonnes récentes à une base créée avant leur existence.

        Migration douce et sans perte : uniquement des ALTER TABLE ADD
        COLUMN, jamais de suppression ni de réécriture de données.
        """
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(clients)")}
        if "ne_plus_appeler" not in colonnes:
            self.conn.execute("ALTER TABLE clients ADD COLUMN "
                              "ne_plus_appeler INTEGER NOT NULL DEFAULT 0")
            journal.info("Migration : colonne clients.ne_plus_appeler ajoutée")
        if "jeu_essai" not in colonnes:
            self.conn.execute("ALTER TABLE clients ADD COLUMN "
                              "jeu_essai INTEGER NOT NULL DEFAULT 0")
            journal.info("Migration : colonne clients.jeu_essai ajoutée")
        if "plus_de_proposition" not in colonnes:
            # Additive, et la valeur par défaut est le comportement d'AVANT :
            # tout le monde reçoit les propositions de créneau libéré. Une
            # base existante ne change donc pas de conduite.
            self.conn.execute("ALTER TABLE clients ADD COLUMN "
                              "plus_de_proposition INTEGER NOT NULL DEFAULT 0")
            journal.info("Migration : colonne clients.plus_de_proposition "
                         "ajoutée (0 = reçoit les propositions, comme avant)")
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(rendezvous)")}
        if "rappel_souhaite" not in colonnes:
            self.conn.execute("ALTER TABLE rendezvous ADD COLUMN "
                              "rappel_souhaite TEXT")
            journal.info("Migration : colonne rendezvous.rappel_souhaite ajoutée")
        if "duree_tranches" not in colonnes:
            # Additive : les rendez-vous déjà en base valent UNE tranche (la
            # durée moyenne d'un rendez-vous) — aucune donnée n'est réécrite.
            self.conn.execute("ALTER TABLE rendezvous ADD COLUMN "
                              "duree_tranches INTEGER NOT NULL DEFAULT 1")
            journal.info("Migration : colonne rendezvous.duree_tranches "
                         "ajoutée (les rendez-vous existants valent "
                         "une tranche)")
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(campagnes)")}
        for colonne in ("nature", "configuration", "raison_pause"):
            if colonne not in colonnes:
                self.conn.execute(f"ALTER TABLE campagnes ADD COLUMN "
                                  f"{colonne} TEXT")
                journal.info("Migration : colonne campagnes.%s ajoutée", colonne)
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(contacts_campagne)")}
        for colonne in ("champs", "detail", "traite_le"):
            if colonne not in colonnes:
                self.conn.execute(f"ALTER TABLE contacts_campagne ADD COLUMN "
                                  f"{colonne} TEXT")
                journal.info("Migration : colonne contacts_campagne.%s ajoutée",
                             colonne)
        if "client_id" not in colonnes:
            # Additive : les contacts déjà en base n'ont PAS de lien (NULL) ;
            # ils continuent d'être composés sur leur copie d'époque, mais le
            # filet de sécurité (numéro OU nom d'un client 🚫) les couvre.
            self.conn.execute("ALTER TABLE contacts_campagne ADD COLUMN "
                              "client_id INTEGER")
            journal.info("Migration : colonne contacts_campagne.client_id "
                         "ajoutée (lien vers la fiche client)")
        # L'identifiant CALL-E de l'appel PARTI dont le résultat se fait
        # attendre. Additive : les contacts déjà en base n'en ont pas (NULL)
        # — aucun appel ancien n'est réinventé, rien n'est réécrit.
        if "appel_externe_id" not in colonnes:
            self.conn.execute("ALTER TABLE contacts_campagne ADD COLUMN "
                              "appel_externe_id TEXT")
            journal.info("Migration : colonne contacts_campagne."
                         "appel_externe_id ajoutée (l'appel parti dont le "
                         "résultat reste à récupérer)")
        if "appel_externe_tentative" not in colonnes:
            self.conn.execute("ALTER TABLE contacts_campagne ADD COLUMN "
                              "appel_externe_tentative INTEGER")
            journal.info("Migration : colonne contacts_campagne."
                         "appel_externe_tentative ajoutée")
        for table in ("appels", "appels_cascade"):
            colonnes = {ligne["name"] for ligne in
                        self.conn.execute(f"PRAGMA table_info({table})")}
            if "note" not in colonnes:
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN note TEXT")
                journal.info("Migration : colonne %s.note ajoutée", table)
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(appels)")}
        if "appel_externe_id" not in colonnes:
            self.conn.execute("ALTER TABLE appels ADD COLUMN "
                              "appel_externe_id TEXT")
            journal.info("Migration : colonne appels.appel_externe_id ajoutée "
                         "(l'identifiant de l'appel chez CALL-E)")
        colonnes = {ligne["name"] for ligne in
                    self.conn.execute("PRAGMA table_info(appels_cascade)")}
        if "rendezvous_libere" not in colonnes:
            # Additive : les cascades déjà jouées n'ont libéré aucun ancien
            # rendez-vous (NULL) — rien n'est réécrit, rien n'est deviné.
            self.conn.execute("ALTER TABLE appels_cascade ADD COLUMN "
                              "rendezvous_libere INTEGER")
            journal.info("Migration : colonne appels_cascade.rendezvous_libere "
                         "ajoutée (l'ancien rendez-vous rendu par cet appel)")

    def fermer(self):
        self.conn.close()

    # -------------------------------------------------------- numéro d'essai
    def definir_numero_essai(self, numero):
        """Déclare (ou efface, avec "") UN SEUL numéro d'ESSAI.

        Le chemin d'origine, gardé tel quel : il déclare un unique testeur.
        Pour en déclarer plusieurs, voir definir_numeros_essai.
        """
        self.definir_numeros_essai([numero] if numero else [])

    def definir_numeros_essai(self, numeros):
        """Déclare (ou efface, avec []) les numéros d'ESSAI des TESTEURS.

        Aucune écriture en base : c'est un réglage d'affichage, gardé le
        temps de la session et relu du fichier de réglages au démarrage.
        """
        self.numeros_essai = [numero for numero in (numeros or []) if numero]
        self.numero_essai = self.numeros_essai[0] if self.numeros_essai else ""

    def _est_essai(self, telephone):
        """Vrai si ce numéro est celui d'un testeur déclaré (essai réel)."""
        return est_numero_essai(telephone, self.numeros_essai)

    # ------------------------------------------------------------------ clients
    def ajouter_client(self, nom, telephone, jeu_essai=False):
        """Crée un client ; jeu_essai=True le marque comme donnée d'ESSAI.

        Le drapeau ne change rien au fonctionnement : il sert uniquement à
        dire « ceci est un jeu d'essai » à l'écran et à pouvoir le RETIRER
        en bloc sans toucher aux vraies données (supprimer_jeu_essai).
        """
        curseur = self.conn.execute(
            "INSERT INTO clients (nom, telephone, jeu_essai) VALUES (?, ?, ?)",
            (nom, telephone, 1 if jeu_essai else 0))
        self.conn.commit()
        journal.info("Client ajouté : %s (%s)%s", nom, masquer_telephone(telephone),
                     " [jeu d'essai]" if jeu_essai else "")
        return curseur.lastrowid

    def compter_clients(self):
        return self.conn.execute("SELECT COUNT(*) FROM clients").fetchone()[0]

    def compter_clients_jeu_essai(self):
        """Combien de clients viennent du jeu d'essai (0 = aucun chargé)."""
        return self.conn.execute(
            "SELECT COUNT(*) FROM clients WHERE jeu_essai = 1").fetchone()[0]

    def supprimer_jeu_essai(self):
        """Retire UNIQUEMENT les données d'essai ; rend (clients, rendez-vous).

        Symétrique du chargement : seuls les clients marqués jeu_essai = 1
        (et leurs rendez-vous, et les appels de ces rendez-vous) partent.
        Les clients de l'utilisateur ne sont JAMAIS touchés, et les
        campagnes déjà jouées restent en base — leurs résultats sont un
        historique, pas une donnée d'essai rattachée à un client. Comme pour
        la suppression d'un client, les relances encore PLANIFIÉES de ces
        fiches sont annulées : retirer le jeu d'essai ne laisse jamais un
        appel armé derrière lui.
        """
        self.desarmer_jeu_essai()
        self.conn.execute(
            "DELETE FROM appels WHERE rendezvous_id IN "
            "(SELECT r.id FROM rendezvous r JOIN clients c ON c.id = r.client_id "
            " WHERE c.jeu_essai = 1)")
        curseur = self.conn.execute(
            "DELETE FROM rendezvous WHERE client_id IN "
            "(SELECT id FROM clients WHERE jeu_essai = 1)")
        rendezvous = curseur.rowcount
        curseur = self.conn.execute("DELETE FROM clients WHERE jeu_essai = 1")
        clients = curseur.rowcount
        self.conn.commit()
        journal.info("Jeu d'essai retiré : %d client(s), %d rendez-vous",
                     clients, rendezvous)
        return clients, rendezvous

    def desarmer_jeu_essai(self):
        """Annule les relances encore armées de TOUTES les fiches d'essai.

        Rend le nombre de relances annulées. Appelée juste avant le retrait
        du jeu d'essai (et par lui) : retirer des données d'essai ne doit
        jamais laisser un appel programmé derrière lui.
        """
        annulees = 0
        for ligne in self.conn.execute(
                "SELECT id FROM clients WHERE jeu_essai = 1").fetchall():
            annulees += self.desarmer_contacts_du_client(ligne["id"])
        return annulees

    def obtenir_ou_creer_client(self, nom, telephone):
        """Réutilise le client si le couple (nom, téléphone) existe déjà.

        Évite les doublons quand un même fichier CSV est importé deux fois.
        """
        ligne = self.conn.execute(
            "SELECT id FROM clients WHERE nom = ? AND telephone = ?",
            (nom, telephone)).fetchone()
        if ligne:
            return ligne["id"]
        return self.ajouter_client(nom, telephone)

    def telephone_de(self, client_id):
        """Numéro EN CLAIR — réservé au passage d'appel, jamais à l'affichage."""
        ligne = self.conn.execute(
            "SELECT telephone FROM clients WHERE id = ?", (client_id,)).fetchone()
        return ligne["telephone"] if ligne else None

    def client_equivalent(self, nom, telephone):
        """Le client de CE nom portant le MÊME numéro, quelle que soit son
        écriture (« 06 39 98 00 56 » et « +33 6 39 98 00 56 »), sinon None.

        Sert à l'import d'agenda : les outils écrivent le numéro tantôt en
        forme nationale, tantôt en forme internationale (URI « tel: ») ;
        sans cette équivalence, le même patient ferait deux fiches.
        """
        cible = chiffres_significatifs(telephone)
        if not cible:
            return None
        for ligne in self.conn.execute(
                "SELECT id, telephone FROM clients WHERE nom = ? ORDER BY id",
                (nom,)):
            if chiffres_significatifs(ligne["telephone"]) == cible:
                return ligne["id"]
        return None

    def client_sans_numero_par_nom(self, nom):
        """L'identifiant du client de CE nom encore SANS numéro, sinon None.

        Sert à l'import d'agenda : quand l'ICS porte enfin le téléphone
        d'un client importé « à compléter », on complète sa fiche au lieu
        d'en créer une seconde.
        """
        ligne = self.conn.execute(
            "SELECT id FROM clients WHERE nom = ? AND telephone = '' "
            "ORDER BY id LIMIT 1", (nom,)).fetchone()
        return ligne["id"] if ligne else None

    def telephone_par_nom(self, nom):
        """Le numéro EN CLAIR du client portant CE nom (s'il en a un), sinon None.

        Réservé à la constitution d'une liste d'appel demandée EXPLICITEMENT
        (rapprochement d'un agenda ICS avec les clients connus) — jamais à
        l'affichage, qui reste masqué.
        """
        ligne = self.conn.execute(
            "SELECT telephone FROM clients WHERE nom = ? AND telephone != '' "
            "ORDER BY id LIMIT 1", (nom,)).fetchone()
        return ligne["telephone"] if ligne else None

    def mettre_a_jour_telephone(self, client_id, telephone):
        """Complète (ou corrige) le numéro d'un client — import ICS sans numéro."""
        self.conn.execute(
            "UPDATE clients SET telephone = ? WHERE id = ?", (telephone, client_id))
        self.conn.commit()
        journal.info("Numéro complété pour le client n°%d : %s",
                     client_id, masquer_telephone(telephone))

    def lister_clients(self):
        """Tous les clients (numéros masqués), avec leur nombre de rendez-vous."""
        lignes = self.conn.execute(
            "SELECT c.id, c.nom, c.telephone, c.ne_plus_appeler, c.jeu_essai, "
            "c.plus_de_proposition, "
            "COUNT(r.id) AS nb_rendezvous "
            "FROM clients c LEFT JOIN rendezvous r ON r.client_id = c.id "
            "GROUP BY c.id ORDER BY c.nom COLLATE NOCASE").fetchall()
        return [{"id": ligne["id"], "nom": ligne["nom"],
                 "telephone_masque": masquer_telephone(ligne["telephone"]),
                 "numero_essai": self._est_essai(ligne["telephone"]),
                 "ne_plus_appeler": bool(ligne["ne_plus_appeler"]),
                 # ⚠ LE DRAPEAU PLUS DOUX voyage avec la fiche : l'écran doit
                 # pouvoir le distinguer du 🚫, et les deux se lisent ensemble.
                 "plus_de_proposition": bool(ligne["plus_de_proposition"]),
                 "jeu_essai": bool(ligne["jeu_essai"]),
                 "nb_rendezvous": ligne["nb_rendezvous"]} for ligne in lignes]

    def obtenir_client(self, client_id):
        """La fiche d'un client (numéro masqué), ou None."""
        ligne = self.conn.execute(
            "SELECT c.id, c.nom, c.telephone, c.ne_plus_appeler, c.jeu_essai, "
            "c.plus_de_proposition, "
            "(SELECT COUNT(*) FROM rendezvous r WHERE r.client_id = c.id) "
            "AS nb_rendezvous FROM clients c WHERE c.id = ?",
            (client_id,)).fetchone()
        if ligne is None:
            return None
        return {"id": ligne["id"], "nom": ligne["nom"],
                "telephone_masque": masquer_telephone(ligne["telephone"]),
                "numero_essai": self._est_essai(ligne["telephone"]),
                "ne_plus_appeler": bool(ligne["ne_plus_appeler"]),
                # ⚠ LE DRAPEAU PLUS DOUX voyage avec la fiche : l'écran doit
                # pouvoir le distinguer du 🚫, et les deux se lisent ensemble.
                "plus_de_proposition": bool(ligne["plus_de_proposition"]),
                "jeu_essai": bool(ligne["jeu_essai"]),
                "nb_rendezvous": ligne["nb_rendezvous"]}

    def plus_de_proposition(self, client_id):
        """Ce client refuse-t-il qu'on lui PROPOSE des créneaux libérés ?

        ⚠ TOLÉRANT SUR L'ENTRÉE : un contact sans fiche (None) reçoit les
        propositions — on ne devine pas un refus qu'on n'a pas entendu.
        """
        if not client_id:
            return False
        ligne = self.conn.execute(
            "SELECT plus_de_proposition FROM clients WHERE id = ?",
            (client_id,)).fetchone()
        return bool(ligne and ligne["plus_de_proposition"])

    def definir_plus_de_proposition(self, client_id, valeur):
        """Pose ou lève le refus des propositions de créneau (réversible).

        ⚠ CE N'EST PAS LE 🚫 : voir le commentaire de la colonne. Ce drapeau
        n'empêche AUCUN appel sur les rendez-vous de la personne.
        """
        self.conn.execute(
            "UPDATE clients SET plus_de_proposition = ? WHERE id = ?",
            (1 if valeur else 0, client_id))
        self.conn.commit()

    def definir_ne_plus_appeler(self, client_id, valeur):
        """Pose ou lève le drapeau « Ne plus appeler » (réversible)."""
        self.conn.execute("UPDATE clients SET ne_plus_appeler = ? WHERE id = ?",
                          (1 if valeur else 0, client_id))
        self.conn.commit()
        journal.info("Client n°%d : « Ne plus appeler » %s",
                     client_id, "posé" if valeur else "levé")

    def telephone_exclu(self, telephone):
        """Vrai si CE numéro appartient à un client marqué « Ne plus appeler ».

        Sert à la cascade : même une liste collée à la main ne doit jamais
        faire appeler quelqu'un qui a demandé à ne plus l'être. La
        comparaison porte sur les CHIFFRES significatifs, pas sur le texte :
        « 06 39 98 00 56 » et « +33 6 39 98 00 56 » sont le même numéro, et
        un agenda qui écrit la forme internationale ne doit pas faire sauter
        le garde-fou.
        """
        cible = chiffres_significatifs(telephone)
        if not cible:
            return False
        for ligne in self.conn.execute(
                "SELECT telephone FROM clients WHERE ne_plus_appeler = 1"):
            if chiffres_significatifs(ligne["telephone"]) == cible:
                return True
        return False

    def telephone_sans_proposition(self, telephone):
        """Vrai si CE numéro refuse les propositions de créneau libéré.

        Le pendant de `telephone_exclu` pour le drapeau plus doux : même
        comparaison sur les CHIFFRES significatifs, pour qu'une liste collée à
        la main l'honore aussi — « 06 39 98 00 56 » et « +33 6 39 98 00 56 »
        sont le même numéro.
        """
        cible = chiffres_significatifs(telephone)
        if not cible:
            return False
        for ligne in self.conn.execute(
                "SELECT telephone FROM clients WHERE plus_de_proposition = 1"):
            if chiffres_significatifs(ligne["telephone"]) == cible:
                return True
        return False

    def nom_exclu(self, nom):
        """Vrai si CE nom est celui d'un client marqué « Ne plus appeler ».

        Le second brin du FILET DE SÉCURITÉ : un numéro corrigé après coup
        ne reconnaît plus la personne par son numéro — le nom, lui, la
        reconnaît encore. La comparaison ignore la casse et les accents
        (cle_nom). Conséquence assumée par le propriétaire : un homonyme
        non concerné peut être écarté à tort — mieux vaut un appel de moins
        qu'un appel à quelqu'un qui a demandé qu'on cesse.
        """
        cible = cle_nom(nom)
        if not cible:
            return False
        for ligne in self.conn.execute(
                "SELECT nom FROM clients WHERE ne_plus_appeler = 1"):
            if cle_nom(ligne["nom"]) == cible:
                return True
        return False

    def client_connu(self, nom, telephone):
        """L'identifiant du client DÉJÀ en fiche pour ce contact, ou None.

        La MÊME reconnaissance que client_pour_contact, amputée de sa
        dernière étape : ici, rien n'est créé. C'est ce qui permet de
        distinguer « on sait de qui on parle » de « c'est une ligne collée
        qu'on découvre » — la différence exacte que demande la règle du
        propriétaire avant de toucher au rendez-vous de quelqu'un.
        """
        if telephone:
            ligne = self.conn.execute(
                "SELECT id FROM clients WHERE nom = ? AND telephone = ? "
                "ORDER BY id LIMIT 1", (nom, telephone)).fetchone()
            if ligne:
                return ligne["id"]
            equivalent = self.client_equivalent(nom, telephone)
            if equivalent is not None:
                return equivalent
        return self.client_sans_numero_par_nom(nom)

    def rendezvous_a_venir_du_client(self, client_id, maintenant=None):
        """Les rendez-vous de CE client encore devant nous qui TIENNENT.

        Mêmes statuts que « Rendez-vous à venir » (STATUTS_A_VENIR) : un
        annulé, un déplacé, un supprimé n'en font pas partie — ils ne
        tiennent plus. Rendus du plus proche au plus lointain.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        lignes = self.conn.execute(
            self._REQUETE_RDV + " WHERE r.client_id = ? AND r.horaire >= ? "
            "AND r.statut IN ("
            + ",".join("?" * len(self.STATUTS_A_VENIR)) + ") "
            "ORDER BY r.horaire",
            (client_id, maintenant) + self.STATUTS_A_VENIR).fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def client_pour_contact(self, nom, telephone, rendezvous_id=None):
        """LA fiche client d'un contact de campagne — créée si elle manque.

        Une campagne ne recopie plus un numéro « pour toujours » : elle
        porte un LIEN vers la fiche, et c'est le numéro ACTUEL de la fiche
        qui est composé. Un contact simplement collé n'a pas de fiche : il
        en reçoit une ICI, à son entrée dans la campagne, pour que le lien
        existe toujours. Ordre de reconnaissance :
        1. le rendez-vous repris de la base désigne son client ;
        2. le couple (nom exact, numéro exact) ;
        3. le même nom avec le MÊME numéro écrit autrement
           (« 06 39 98 00 56 » / « +33 6 39 98 00 56 ») ;
        4. le même nom encore sans numéro (import d'agenda à compléter) ;
        5. sinon une fiche est créée.
        Rend l'identifiant du client (jamais None).
        """
        if rendezvous_id:
            ligne = self.conn.execute(
                "SELECT client_id FROM rendezvous WHERE id = ?",
                (rendezvous_id,)).fetchone()
            if ligne:
                return ligne["client_id"]
        if telephone:
            ligne = self.conn.execute(
                "SELECT id FROM clients WHERE nom = ? AND telephone = ? "
                "ORDER BY id LIMIT 1", (nom, telephone)).fetchone()
            if ligne:
                return ligne["id"]
            equivalent = self.client_equivalent(nom, telephone)
            if equivalent is not None:
                return equivalent
            sans_numero = self.client_sans_numero_par_nom(nom)
            if sans_numero is not None:
                self.mettre_a_jour_telephone(sans_numero, telephone)
                return sans_numero
        else:
            sans_numero = self.client_sans_numero_par_nom(nom)
            if sans_numero is not None:
                return sans_numero
        return self.ajouter_client(nom, telephone or "")

    def rendezvous_du_client(self, client_id):
        """Les identifiants des rendez-vous d'un client (pour purger la file)."""
        return [ligne["id"] for ligne in self.conn.execute(
            "SELECT id FROM rendezvous WHERE client_id = ?", (client_id,))]

    def completer_telephone(self, client_id, telephone):
        """Écrit ce numéro sur la fiche SI elle n'en a pas ; rend True si écrit.

        ⚠ SEULEMENT UNE FICHE VIDE, ET C'EST TOUT L'ÉCART AVEC
        `modifier_client`. Compléter ce qui manque est le geste que l'écran
        demande (« son numéro est à compléter dans la grille de l'étape 3 ») ;
        ÉCRASER un numéro déjà en fiche serait modifier ses données clients
        sans le lui demander — une campagne n'a pas à faire cela.

        CE QUE ÇA CORRIGE, mesuré dans sa base le 18/08/2026 : il complète le
        numéro d'une personne dans la grille, la campagne l'enregistre… sur la
        CAMPAGNE. Or c'est le numéro de la FICHE qui est composé (voir
        `client_pour_contact`) : la fiche restait vide, et le contact partait
        « exclu — Aucun numéro à composer ». Le geste que l'écran lui demandait
        n'allait pas jusqu'au bout.
        """
        # ⚠ `obtenir_client` REND UNE VUE MASQUÉE (« telephone_masque ») : le
        # numéro en clair ne sort que par `telephone_de`, et c'est la règle du
        # produit. Ma première version lisait « client["telephone"] » et
        # plantait le serveur à chaque validation de grille — 180 essais
        # tombés d'un coup, ce qui est la bonne façon de l'apprendre.
        if self.obtenir_client(client_id) is None:
            return False
        if (self.telephone_de(client_id) or "").strip():
            return False
        if not (telephone or "").strip():
            return False
        self.conn.execute("UPDATE clients SET telephone = ? WHERE id = ?",
                          (telephone, client_id))
        self.conn.commit()
        journal.info("Fiche client n°%d complétée : numéro saisi dans une "
                     "grille de campagne", client_id)
        return True

    def modifier_client(self, client_id, nom=None, telephone=None):
        """Corrige la fiche d'un client (nom, numéro) ; rend True s'il existe.

        Le numéro arrive DÉJÀ validé par saisie.valider_telephone ; il est
        stocké en clair comme partout ailleurs et ne ressort qu'masqué.
        Aucune suppression, aucun effet de bord : c'est une correction de
        fiche, pas un geste sur les rendez-vous.
        """
        if self.obtenir_client(client_id) is None:
            return False
        if nom is not None:
            self.conn.execute("UPDATE clients SET nom = ? WHERE id = ?",
                              (nom, client_id))
        if telephone is not None:
            self.conn.execute("UPDATE clients SET telephone = ? WHERE id = ?",
                              (telephone, client_id))
        self.conn.commit()
        journal.info("Fiche du client n°%d corrigée%s", client_id,
                     " (numéro compris)" if telephone is not None else "")
        return True

    def etat_rendezvous_par_client(self, maintenant=None):
        """{client_id : résumé de son agenda} — une seule passe sur la base.

        Le résumé porte le compte de rendez-vous PAR STATUT, le prochain
        rendez-vous à venir, le dernier passé, et si une préférence de
        rappel a été notée. Un rendez-vous long (plusieurs tranches
        consécutives) reste UN rendez-vous : c'est une ligne de la table,
        jamais N.

        « Prochain » ne retient que les rendez-vous qui TIENNENT (les
        STATUTS_A_VENIR) : annoncer « prochain : le 6 août » pour un
        rendez-vous annulé serait un faux affichage, et la fiche du client
        en déduirait à tort qu'il a un rendez-vous prévu. Le compte par
        statut, lui, garde TOUT — rien ne se perd.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        resume = {}
        for ligne in self.conn.execute(
                "SELECT client_id, id, horaire, motif, statut, rappel_souhaite, "
                "duree_tranches FROM rendezvous ORDER BY horaire"):
            fiche = resume.setdefault(ligne["client_id"], {
                "total": 0, "statuts": {}, "prochain": None, "dernier": None,
                "rappel_souhaite": None})
            fiche["total"] += 1
            fiche["statuts"][ligne["statut"]] = (
                fiche["statuts"].get(ligne["statut"], 0) + 1)
            entree = {"id": ligne["id"], "horaire": ligne["horaire"],
                      "motif": ligne["motif"], "statut": ligne["statut"],
                      "duree_tranches": max(ligne["duree_tranches"] or 1, 1)}
            if ligne["horaire"] >= maintenant:
                if (fiche["prochain"] is None
                        and ligne["statut"] in self.STATUTS_A_VENIR):
                    fiche["prochain"] = entree
            else:
                fiche["dernier"] = entree
            if ligne["rappel_souhaite"] and not fiche["rappel_souhaite"]:
                fiche["rappel_souhaite"] = ligne["rappel_souhaite"]
        return resume

    def contacts_campagne_par_client(self):
        """{client_id : [contacts de campagne]} — l'appariement se fait ICI.

        Un contact de campagne désigne un client par son rendez-vous, par
        les chiffres de son numéro (« 06 39 98 00 56 » et
        « +33 6 39 98 00 56 » sont le même numéro) ou, à défaut, par son
        nom exact. Aucun numéro en clair ne sort de cette méthode : le
        rapprochement est fait ici, les fiches rendues n'en portent pas.
        """
        clients = self.conn.execute(
            "SELECT id, nom, telephone FROM clients").fetchall()
        par_chiffres, par_nom = {}, {}
        par_id = {ligne["id"] for ligne in clients}
        for ligne in clients:
            cible = chiffres_significatifs(ligne["telephone"])
            if cible:
                par_chiffres.setdefault(cible, ligne["id"])
            par_nom.setdefault(ligne["nom"], ligne["id"])
        par_rendezvous = {ligne["id"]: ligne["client_id"] for ligne in
                          self.conn.execute("SELECT id, client_id FROM rendezvous")}
        resultat = {}
        for ligne in self.conn.execute("""
                SELECT c.id, c.campagne_id, c.rang, c.nom, c.telephone,
                       c.rendezvous_id, c.etat, c.issue, c.detail, c.client_id,
                       k.nom AS campagne_nom, k.nature, k.theme,
                       k.statut AS campagne_statut, k.creneau AS campagne_creneau,
                  (SELECT COUNT(*) FROM appels_campagne a
                   WHERE a.contact_id = c.id) AS tentatives,
                  (SELECT COUNT(*) FROM relances r
                   WHERE r.contact_id = c.id AND r.statut = 'planifiée')
                   AS relances_planifiees
                FROM contacts_campagne c
                JOIN campagnes k ON k.id = c.campagne_id
                ORDER BY c.id"""):
            # Le LIEN vers la fiche prime sur toute déduction : c'est lui
            # qui dit de qui il s'agit, même si le numéro a changé depuis.
            client_id = ligne["client_id"]
            if client_id is None:
                client_id = par_rendezvous.get(ligne["rendezvous_id"])
            if client_id is None:
                client_id = par_chiffres.get(
                    chiffres_significatifs(ligne["telephone"]))
            if client_id is None:
                client_id = par_nom.get(ligne["nom"])
            if client_id is None or client_id not in par_id:
                continue
            contact = {cle: ligne[cle] for cle in (
                "id", "campagne_id", "rang", "nom", "rendezvous_id", "etat",
                "issue", "detail", "client_id", "campagne_nom", "nature", "theme",
                "campagne_statut", "campagne_creneau", "tentatives",
                "relances_planifiees")}
            resultat.setdefault(client_id, []).append(contact)
        return resultat

    def dernier_appel_direct_par_client(self):
        """{client_id : dernier appel DIRECT terminé} (file, rappel individuel).

        Les campagnes ont leur propre trace ; celle-ci couvre les appels
        rattachés à un rendez-vous. Le résultat structuré est décodé, la
        transcription n'est pas remontée (elle vit sur la fiche).
        """
        dernier = {}
        for ligne in self.conn.execute("""
                SELECT a.id, a.statut, a.resultat, r.client_id
                FROM appels a JOIN rendezvous r ON r.id = a.rendezvous_id
                ORDER BY a.id"""):
            resultat = None
            if ligne["resultat"]:
                try:
                    resultat = json.loads(ligne["resultat"])
                except (TypeError, ValueError):
                    resultat = None
            dernier[ligne["client_id"]] = {
                "appel_id": ligne["id"], "statut": ligne["statut"],
                "issue": (resultat or {}).get("appointment_status"),
                "resultat": resultat}
        return dernier

    def rendezvous_de_periode(self, debut, fin, statuts=None):
        """Les rendez-vous d'une fenêtre de temps, client compris (numéro masqué).

        statuts : la liste des statuts retenus (par défaut TOUS). C'est la
        source du PLANNING : un rendez-vous y est une ligne, avec sa durée
        en tranches — jamais une ligne par tranche.
        """
        # ⚠ LES DEUX BORNES SONT INDÉPENDANTES (09/08/2026). Les exiger
        # ensemble faisait qu'une fenêtre « depuis la place, sans limite »
        # perdait AUSSI sa borne de début : la règle reprenait alors des gens
        # dont le rendez-vous est AVANT la place, à qui l'avancer n'apporte
        # rien. Exactement le défaut corrigé le 03/08 dans
        # `rendezvous_a_recaser` — la même faute, à un autre endroit.
        requete = self._REQUETE_RDV + " WHERE 1 = 1"
        parametres = []
        if debut:
            requete += " AND r.horaire >= ?"
            parametres.append(debut)
        if fin:
            requete += " AND r.horaire < ?"
            parametres.append(fin)
        if statuts:
            requete += (" AND r.statut IN (" + ",".join("?" * len(statuts)) + ")")
            parametres.extend(statuts)
        lignes = self.conn.execute(requete + " ORDER BY r.horaire, r.id",
                                   parametres).fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def contacts_campagne_du_client(self, client_id):
        """Les identifiants des contacts de campagne qui désignent ce client.

        Trois façons de le reconnaître, de la plus sûre à la plus large :
        le LIEN vers la fiche, le rendez-vous repris de la base, et les
        CHIFFRES du numéro gelé (contacts d'avant la colonne `client_id`).
        Le nom seul n'est PAS retenu ici : désarmer la relance d'un homonyme
        ferait perdre un travail réel.
        """
        fiche = self.conn.execute(
            "SELECT telephone FROM clients WHERE id = ?",
            (client_id,)).fetchone()
        chiffres = chiffres_significatifs(fiche["telephone"]) if fiche else ""
        rendezvous = set(self.rendezvous_du_client(client_id))
        vises = []
        for ligne in self.conn.execute(
                "SELECT id, telephone, client_id, rendezvous_id "
                "FROM contacts_campagne"):
            if (ligne["client_id"] == client_id
                    or (ligne["rendezvous_id"] in rendezvous
                        and ligne["rendezvous_id"] is not None)
                    or (chiffres
                        and chiffres_significatifs(ligne["telephone"]) == chiffres)):
                vises.append(ligne["id"])
        return vises

    def desarmer_contacts_du_client(self, client_id):
        """Désarme ce qui pourrait encore SONNER pour ce client ; rend le nombre
        de relances annulées.

        La décision du propriétaire : on garde l'historique, on désarme.
        Les contacts et les appels déjà passés restent lisibles ; seules les
        relances encore « planifiée » sont annulées, et chaque contact reçoit
        le LIEN vers la fiche pour que sa disparition soit constatable au
        moment de composer (cible_appel_contact refuse alors l'appel).
        """
        contacts = self.contacts_campagne_du_client(client_id)
        if not contacts:
            return 0
        marques = ",".join("?" * len(contacts))
        curseur = self.conn.execute(
            f"UPDATE relances SET statut = 'annulée' WHERE statut = 'planifiée' "
            f"AND contact_id IN ({marques})", contacts)
        annulees = curseur.rowcount
        self.conn.execute(
            f"UPDATE contacts_campagne SET client_id = ? "
            f"WHERE id IN ({marques})", [client_id] + contacts)
        self.conn.commit()
        if annulees:
            journal.info("Client n°%d : %d relance(s) planifiée(s) annulée(s) "
                         "— plus aucun appel ne partira pour lui", client_id,
                         annulees)
        return annulees

    def supprimer_client(self, client_id):
        """Supprime le client, SES rendez-vous et leurs appels ; rend le nombre
        de rendez-vous supprimés.

        Ses relances encore planifiées sont ANNULÉES au passage : supprimer
        une fiche ne doit jamais laisser un appel armé pour elle. Ses
        contacts de campagne et les appels déjà passés, eux, restent
        lisibles — c'est de l'histoire, pas une donnée du client.
        Action définitive — le serveur ne l'atteint qu'après une page de
        confirmation explicite, jamais en un clic.
        """
        self.desarmer_contacts_du_client(client_id)
        curseur = self.conn.execute(
            "DELETE FROM appels WHERE rendezvous_id IN "
            "(SELECT id FROM rendezvous WHERE client_id = ?)", (client_id,))
        curseur = self.conn.execute(
            "DELETE FROM rendezvous WHERE client_id = ?", (client_id,))
        supprimes = curseur.rowcount
        self.conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
        self.conn.commit()
        journal.info("Client n°%d supprimé avec %d rendez-vous (confirmé à l'écran)",
                     client_id, supprimes)
        return supprimes

    # -------------------------------------------------------------- rendez-vous
    def ajouter_rendezvous(self, client_id, horaire, motif, statut="prévu",
                           rappel_souhaite=None, duree_tranches=1):
        """Crée un rendez-vous ; duree_tranches = sa longueur en TRANCHES.

        1 = la durée moyenne d'un rendez-vous (réglage « pas », 15 minutes
        par défaut) ; 2 = deux tranches consécutives (30 minutes), etc.
        """
        curseur = self.conn.execute(
            "INSERT INTO rendezvous (client_id, horaire, motif, statut, "
            "rappel_souhaite, duree_tranches) VALUES (?, ?, ?, ?, ?, ?)",
            (client_id, horaire, motif, statut, rappel_souhaite,
             max(int(duree_tranches or 1), 1)))
        self.conn.commit()
        return curseur.lastrowid

    def mettre_a_jour_rendezvous(self, rendezvous_id, statut=None, horaire=None,
                                 duree_tranches=None, motif=None):
        if statut is not None:
            self.conn.execute(
                "UPDATE rendezvous SET statut = ? WHERE id = ?", (statut, rendezvous_id))
        if horaire is not None:
            self.conn.execute(
                "UPDATE rendezvous SET horaire = ? WHERE id = ?", (horaire, rendezvous_id))
        if motif is not None:
            self.conn.execute(
                "UPDATE rendezvous SET motif = ? WHERE id = ?", (motif, rendezvous_id))
        if duree_tranches is not None:
            self.conn.execute(
                "UPDATE rendezvous SET duree_tranches = ? WHERE id = ?",
                (max(int(duree_tranches), 1), rendezvous_id))
        self.conn.commit()

    def rendezvous_occupants(self, debut, fin):
        """Les rendez-vous qui OCCUPENT le planning entre ces deux horaires.

        Occupent : « prévu » et « confirmé » — un rendez-vous annulé,
        déplacé ou ignoré libère sa place, c'est ce qui permet de recalculer
        les créneaux proposables. Un rendez-vous qui commence AVANT la
        fenêtre mais déborde dedans est renvoyé aussi (la marge d'une
        journée suffit : aucune durée ne dépasse 24 h).
        """
        veille = debut
        try:
            veille = (datetime.datetime.fromisoformat(debut)
                      - datetime.timedelta(days=1)).isoformat(timespec="minutes")
        except (TypeError, ValueError):
            pass
        lignes = self.conn.execute(
            "SELECT id, client_id, horaire, motif, statut, duree_tranches "
            "FROM rendezvous WHERE statut IN ('prévu', 'confirmé') "
            "AND horaire >= ? AND horaire < ? ORDER BY horaire",
            (veille, fin)).fetchall()
        return [{"id": ligne["id"], "client_id": ligne["client_id"],
                 "horaire": ligne["horaire"], "motif": ligne["motif"],
                 "statut": ligne["statut"],
                 "duree_tranches": max(ligne["duree_tranches"] or 1, 1)}
                for ligne in lignes]

    # Les statuts qui basculent en « manqué » quand leur heure est passée.
    # Décision du propriétaire : « Si c'est des dates dans le passé on peut
    # donc marquer manqué » — un rendez-vous CONFIRMÉ dont l'heure est
    # passée bascule lui aussi, au même titre qu'un « prévu ». Sans quoi
    # les confirmés se volatilisaient : ni dans « à venir » (c'est passé),
    # ni dans « à rappeler » (ils n'étaient pas manqués). Plus personne ne
    # disparaît. Le prix, assumé et écrit à l'écran : on reverra dans la
    # liste des gens qui sont bel et bien venus, faute de savoir qui s'est
    # présenté — « ignoré » sert exactement à les écarter, réversiblement.
    STATUTS_QUI_MANQUENT = ("prévu", "confirmé")

    def marquer_manques_echus(self, maintenant=None):
        """Règle du manqué : « prévu » ou « confirmé » passé → « manqué ».

        Rend le nombre de rendez-vous modifiés. Les horaires sont tous
        stockés en ISO 8601 à la minute (« 2026-07-27T14:30 ») : la
        comparaison de texte suffit.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        curseur = self.conn.execute(
            "UPDATE rendezvous SET statut = 'manqué' "
            "WHERE statut IN ('prévu', 'confirmé') AND horaire < ?",
            (maintenant,))
        self.conn.commit()
        if curseur.rowcount:
            journal.info("%d rendez-vous passé(s) marqué(s) manqué(s)", curseur.rowcount)
        return curseur.rowcount

    def ignorer_tous_les_manques(self):
        """« Vider la liste » : tous les manqués passent « ignoré » (réversible).

        Rend le nombre de rendez-vous basculés. Le statut « ignoré » se
        rétablit depuis « Tous les rendez-vous » (retablir_manque) : rien
        n'est perdu, la liste « À rappeler » est simplement vidée.
        """
        curseur = self.conn.execute(
            "UPDATE rendezvous SET statut = 'ignoré' WHERE statut = 'manqué'")
        self.conn.commit()
        if curseur.rowcount:
            journal.info("%d rendez-vous manqué(s) passé(s) en « ignoré »",
                         curseur.rowcount)
        return curseur.rowcount

    def retablir_manque(self, rendezvous_id):
        """L'inverse d'« ignoré » : le rendez-vous redevient « manqué ».

        Rend True si le rendez-vous était bien « ignoré » (sinon rien ne bouge).
        """
        curseur = self.conn.execute(
            "UPDATE rendezvous SET statut = 'manqué' "
            "WHERE id = ? AND statut = 'ignoré'", (rendezvous_id,))
        self.conn.commit()
        return curseur.rowcount > 0

    _REQUETE_RDV = """
        SELECT r.id, r.horaire, r.motif, r.statut, r.rappel_souhaite,
               r.duree_tranches,
               c.id AS client_id, c.nom, c.telephone, c.ne_plus_appeler
        FROM rendezvous r JOIN clients c ON c.id = r.client_id
    """

    def sorties_du_planning(self, debut, fin):
        """Les rendez-vous de la période qui n'occupent PLUS de place, et pourquoi.

        ⚠ SON SIGNALEMENT DU 20/08/2026 : « la troisième a disparu, elle n'est
        plus présente dans le calendrier de la page rendez-vous ». Elle n'avait
        pas disparu : son rendez-vous était ANNULÉ — elle l'avait demandé
        pendant l'appel. Mais la grille ne montre que ce qui OCCUPE une place
        (horaires.STATUTS_OCCUPANTS), et la page ne l'offrait nulle part
        ailleurs : de sa place, le rendez-vous s'était bel et bien évaporé.

        ⚠ ET LA LÉGENDE DE LA PAGE LE PROMETTAIT DÉJÀ — « il n'apparaît donc
        pas ici mais dans les listes ci-dessous » — alors qu'il n'y avait
        AUCUNE liste en dessous. C'est ce qui l'a envoyé chercher pour rien.

        La RAISON vient du cahier des changements, sa DERNIÈRE ligne pour ce
        rendez-vous : c'est elle qui explique le statut actuel. Un rendez-vous
        annulé à la main n'en a pas, et on ne lui en invente pas.

        Rend une liste de dicts : le rendez-vous, plus « raison », « campagne_id »
        et « campagne_nom » quand une campagne l'a écrit.
        """
        lignes = self.conn.execute(
            self._REQUETE_RDV + """
             WHERE r.horaire >= ? AND r.horaire < ?
               AND r.statut NOT IN ('prévu', 'confirmé', 'supprimé')
             ORDER BY r.horaire, r.id""", (debut, fin)).fetchall()
        sorties = []
        for ligne in lignes:
            rdv = self._ligne_rdv(ligne)
            dernier = self.conn.execute(
                "SELECT ch.raison, ch.campagne_id, ca.nom AS campagne_nom "
                "FROM changements ch LEFT JOIN campagnes ca "
                "  ON ca.id = ch.campagne_id "
                "WHERE ch.rendezvous_id = ? ORDER BY ch.id DESC LIMIT 1",
                (rdv["id"],)).fetchone()
            rdv["raison"] = dernier["raison"] if dernier else None
            rdv["campagne_id"] = dernier["campagne_id"] if dernier else None
            rdv["campagne_nom"] = dernier["campagne_nom"] if dernier else None
            sorties.append(rdv)
        return sorties

    def rendezvous_manques(self):
        """Rendez-vous manqués, numéros déjà masqués (le brut ne sort pas d'ici)."""
        lignes = self.conn.execute(
            self._REQUETE_RDV + " WHERE r.statut = 'manqué' ORDER BY r.horaire").fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def rendezvous_sans_numero(self):
        """Rendez-vous dont le client n'a pas de numéro (import ICS à compléter)."""
        lignes = self.conn.execute(
            self._REQUETE_RDV + " WHERE c.telephone = '' ORDER BY r.horaire").fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def rendezvous_a_venir(self):
        """Rendez-vous « prévu », du plus proche au plus lointain.

        Après marquer_manques_echus(), tout « prévu » est à venir. Cette
        liste-ci sert à COMPOSER une liste d'appel (reprise de campagne sur
        le filtre « prévu ») : elle ne retient donc que ce qui n'est pas
        encore confirmé. Pour l'AFFICHAGE, c'est rendezvous_a_venir_tous()
        qu'il faut — une ligne confirmée ne disparaît pas de l'écran.
        """
        lignes = self.conn.execute(
            self._REQUETE_RDV + " WHERE r.statut = 'prévu' ORDER BY r.horaire").fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    # Les statuts d'un rendez-vous « à venir » : ceux qui TIENNENT encore.
    # Ce sont exactement les statuts qui occupent une place au planning
    # (horaires.STATUTS_OCCUPANTS) — la liste et la grille disent donc la
    # même chose.
    STATUTS_A_VENIR = ("prévu", "confirmé")

    def rendezvous_a_venir_tous(self, maintenant=None):
        """Les rendez-vous encore devant nous qui TIENNENT (prévu, confirmé).

        Deux règles du propriétaire, qui se complètent :

        - « ce n'est pas un contact qui disparaît, mais une ligne qui
          évolue » : un rendez-vous CONFIRMÉ reste visible ici, avec sa
          pastille — il ne s'escamote pas parce qu'on vient de l'obtenir ;
        - correction du 31/07/2026 : un rendez-vous ANNULÉ, lui, n'existe
          plus. Il n'a rien à faire dans « à venir ». Soit il a été replacé
          pendant l'échange (c'est alors un DÉPLACEMENT, et c'est la
          nouvelle ligne qui s'affiche), soit aucune date n'est fixée et le
          client passe « le client rappellera ». Un rendez-vous DÉPLACÉ
          (l'ancienne ligne) et un rendez-vous IGNORÉ sont écartés pour la
          même raison : ils ne tiennent plus. Rien n'est perdu pour autant —
          « Tous les rendez-vous » et la fiche du client les gardent.

        Le filtre est donc l'HEURE **et** le statut : les horaires sont tous
        stockés en ISO 8601 à la minute, la comparaison de texte suffit.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        lignes = self.conn.execute(
            self._REQUETE_RDV + " WHERE r.horaire >= ? AND r.statut IN "
            "(" + ",".join("?" * len(self.STATUTS_A_VENIR)) + ") "
            "ORDER BY r.horaire",
            (maintenant,) + self.STATUTS_A_VENIR).fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def tous_les_rendezvous(self):
        """TOUS les rendez-vous, le plus récent d'abord — aucune saisie perdue."""
        lignes = self.conn.execute(
            self._REQUETE_RDV + " ORDER BY r.horaire DESC, r.id DESC").fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def rendezvous_identique(self, nom, telephone, horaire):
        """Rendez-vous déjà en base pour CE client à CET horaire exact, ou None.

        Garde-fou anti-doublon du formulaire d'ajout : la même saisie faite
        deux fois est signalée à l'écran au lieu d'être doublée en silence.
        """
        ligne = self.conn.execute(
            self._REQUETE_RDV + " WHERE c.nom = ? AND c.telephone = ? "
            "AND r.horaire = ? ORDER BY r.id",
            (nom, telephone, horaire)).fetchone()
        return self._ligne_rdv(ligne) if ligne else None

    def obtenir_rendezvous(self, rendezvous_id):
        ligne = self.conn.execute(
            self._REQUETE_RDV + " WHERE r.id = ?", (rendezvous_id,)).fetchone()
        return self._ligne_rdv(ligne) if ligne else None

    def _ligne_rdv(self, ligne):
        # Méthode d'instance (et non @staticmethod comme _ligne_appel) : elle
        # a besoin du numéro d'essai déclaré pour poser le drapeau 🧪. Le
        # verrou est ré-entrant, la reprendre ici ne coûte rien.
        return {
            "id": ligne["id"],
            "horaire": ligne["horaire"],
            "motif": ligne["motif"],
            "statut": ligne["statut"],
            "rappel_souhaite": ligne["rappel_souhaite"],
            # Durée en tranches : 1 pour tous les rendez-vous d'avant la
            # colonne (migration additive) — jamais 0, jamais None.
            "duree_tranches": max(ligne["duree_tranches"] or 1, 1),
            "client_id": ligne["client_id"],
            "nom": ligne["nom"],
            "telephone_masque": masquer_telephone(ligne["telephone"]),
            "numero_essai": self._est_essai(ligne["telephone"]),
            "ne_plus_appeler": bool(ligne["ne_plus_appeler"]),
        }

    # ------------------------------------------------------------------- appels
    def creer_appel(self, rendezvous_id):
        curseur = self.conn.execute(
            "INSERT INTO appels (rendezvous_id, statut) VALUES (?, 'en file')",
            (rendezvous_id,))
        self.conn.commit()
        return curseur.lastrowid

    def changer_statut_appel(self, appel_id, statut):
        self.conn.execute(
            "UPDATE appels SET statut = ? WHERE id = ?", (statut, appel_id))
        self.conn.commit()

    def terminer_appel(self, appel_id, statut, resultat=None, transcription=None,
                       note=None):
        """Clôt un appel. `note` = ce que LE PRODUIT a décidé face au résultat
        (par exemple : la date convenue ne tient pas, le rendez-vous n'a donc
        pas été créé) — jamais du texte inventé pour l'agent."""
        self.conn.execute(
            "UPDATE appels SET statut = ?, resultat = ?, transcription = ?, "
            "note = ? WHERE id = ?",
            (statut,
             json.dumps(resultat, ensure_ascii=False) if resultat is not None else None,
             transcription, note, appel_id))
        self.conn.commit()

    def noter_appel(self, appel_id, note):
        """Écrit (ou remplace) la note du produit sur cet appel."""
        self.conn.execute("UPDATE appels SET note = ? WHERE id = ?",
                          (note, appel_id))
        self.conn.commit()

    def obtenir_appel(self, appel_id):
        ligne = self.conn.execute(
            "SELECT * FROM appels WHERE id = ?", (appel_id,)).fetchone()
        return self._ligne_appel(ligne) if ligne else None

    def appels_du_rendezvous(self, rendezvous_id):
        lignes = self.conn.execute(
            "SELECT * FROM appels WHERE rendezvous_id = ? ORDER BY id",
            (rendezvous_id,)).fetchall()
        return [self._ligne_appel(ligne) for ligne in lignes]

    @staticmethod
    def _ligne_appel(ligne):
        appel = dict(ligne)
        appel["resultat"] = json.loads(appel["resultat"]) if appel["resultat"] else None
        return appel

    # ----------------------------------------------------------------- cascades
    STATUTS_A_RECASER = ("annulé", "manqué", "déplacé")

    def rendezvous_a_recaser(self, debut=None, fin=None, maintenant=None):
        """Les rendez-vous d'une période dont le client attend TOUJOURS.

        Annulés, manqués, ou déplacés — et, dans les trois cas, seulement si
        ce client n'a AUCUN rendez-vous à venir. C'est la définition d'« en
        attente » déjà retenue par `candidats_cascade`, mais rendue ici
        RENDEZ-VOUS PAR RENDEZ-VOUS : une source datée doit donner la date et
        l'identifiant du rendez-vous concerné, sans quoi la colonne
        obligatoire « rendez-vous existant » resterait vide et la grille les
        refuserait.

        ⚠ LE « NOT EXISTS » EST LE CŒUR. Sans lui, on rappellerait des gens
        qui ont déjà repris rendez-vous pour leur en proposer un autre.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        trous = ",".join("?" * len(self.STATUTS_A_RECASER))
        requete = (self._REQUETE_RDV + f" WHERE r.statut IN ({trous})"
                   " AND NOT EXISTS (SELECT 1 FROM rendezvous futur"
                   "  WHERE futur.client_id = r.client_id"
                   "  AND futur.statut IN ('prévu', 'confirmé')"
                   "  AND futur.horaire >= ?)")
        parametres = list(self.STATUTS_A_RECASER) + [maintenant]
        # ⚠ LES DEUX BORNES SONT INDÉPENDANTES : les exiger ensemble faisait
        # qu'une fenêtre « depuis telle date, sans limite » perdait AUSSI sa
        # borne de début. Trouvé par l'essai de la fenêtre relative, le
        # 03/08/2026.
        #
        # ⚠ MAIS L'APPELANT NE LES POSE PLUS SUR CETTE SOURCE-CI (09/08/2026).
        # Le raisonnement d'alors — « leur rendez-vous est avant la place, à
        # qui l'avancer n'apporte rien » — était FAUX ici : les gens de cette
        # source n'ont plus AUCUN rendez-vous, c'est sa définition même. Leur
        # ancienne date ne dit rien de ce qu'ils veulent maintenant, et elle
        # est presque toujours passée — la borne les écartait donc tous.
        # Mesuré : une personne retenue sur quatre qui attendent. Les deux
        # paramètres restent, ils servent aux écrans qui demandent une période
        # explicite.
        if debut:
            requete += " AND r.horaire >= ?"
            parametres.append(debut)
        if fin:
            requete += " AND r.horaire < ?"
            parametres.append(fin)
        lignes = self.conn.execute(requete + " ORDER BY r.horaire, r.id",
                                   parametres).fetchall()
        return [self._ligne_rdv(ligne) for ligne in lignes]

    def candidats_cascade(self, source, maintenant=None):
        """Candidats à une cascade ; rend (candidats, sans numéro, 🚫 écartés).

        candidats = [{"nom", "telephone", "reference"}] — le numéro est EN
        CLAIR ici : cette méthode est réservée à la génération de liste
        demandée EXPLICITEMENT par l'utilisateur (remplissage de la zone de
        collage, export CSV), l'équivalent de ce qu'il collerait lui-même.
        Elle ne sert JAMAIS à l'affichage courant, qui reste masqué.
        « reference » est l'horaire ISO du rendez-vous concerné le plus
        ancien (pour les tris) ; les clients SANS numéro sont exclus et
        comptés ; les clients marqués « Ne plus appeler » sont toujours
        écartés (quelle que soit la source) — et COMPTÉS eux aussi depuis le
        14/08/2026, parce qu'un écart muet se lit comme un défaut : l'écran
        annonçait « 123 contacts ajoutés » là où la base en portait 138.
        Sources :
        - « annules »  : clients ayant un rendez-vous annulé ;
        - « deplaces » : clients ayant un rendez-vous déplacé et AUCUN
          rendez-vous à venir (prévu ou confirmé) — les « en attente » ;
        - « tous »     : tous les clients.
        """
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        # ⚠ LE 🚫 N'EST PLUS ÉCARTÉ PAR LA REQUÊTE, il est LU puis écarté ici :
        # c'est la seule façon de le COMPTER. Le filtre en SQL le faisait
        # disparaître sans laisser de trace à afficher.
        if source == "annules":
            requete = ("SELECT c.nom, c.telephone, c.ne_plus_appeler, "
                       "MIN(r.horaire) AS reference "
                       "FROM clients c JOIN rendezvous r ON r.client_id = c.id "
                       "WHERE r.statut = 'annulé' GROUP BY c.id")
            parametres = ()
        elif source == "deplaces":
            requete = ("SELECT c.nom, c.telephone, c.ne_plus_appeler, "
                       "MIN(r.horaire) AS reference "
                       "FROM clients c JOIN rendezvous r ON r.client_id = c.id "
                       "WHERE r.statut = 'déplacé' "
                       "AND NOT EXISTS "
                       "(SELECT 1 FROM rendezvous r2 WHERE r2.client_id = c.id "
                       " AND r2.statut IN ('prévu', 'confirmé') AND r2.horaire >= ?) "
                       "GROUP BY c.id")
            parametres = (maintenant,)
        elif source == "tous":
            requete = ("SELECT c.nom, c.telephone, c.ne_plus_appeler, "
                       "MIN(r.horaire) AS reference "
                       "FROM clients c LEFT JOIN rendezvous r ON r.client_id = c.id "
                       "GROUP BY c.id")
            parametres = ()
        else:
            raise ValueError(f"Source de candidats inconnue : {source!r}")
        candidats, exclus, exclus_stop = [], 0, 0
        for ligne in self.conn.execute(requete, parametres).fetchall():
            if ligne["ne_plus_appeler"]:
                exclus_stop += 1     # 🚫 : jamais appelé, et l'écran le DIT
                continue
            if not ligne["telephone"]:
                exclus += 1  # sans numéro : rien à composer, signalé à l'écran
                continue
            candidats.append({"nom": ligne["nom"], "telephone": ligne["telephone"],
                              "reference": ligne["reference"] or ""})
        return candidats, exclus, exclus_stop

    def creer_cascade(self, mission, creneau):
        """Ouvre une cascade « premier oui » ; rend son identifiant."""
        curseur = self.conn.execute(
            "INSERT INTO cascades (mission, creneau) VALUES (?, ?)", (mission, creneau))
        self.conn.commit()
        return curseur.lastrowid

    def cloturer_cascade(self, cascade_id, statut, rendezvous_id=None):
        """Clôt la cascade : « pourvue » (avec le rendez-vous créé) ou « épuisée »."""
        self.conn.execute(
            "UPDATE cascades SET statut = ?, rendezvous_id = ? WHERE id = ?",
            (statut, rendezvous_id, cascade_id))
        self.conn.commit()

    def obtenir_cascade(self, cascade_id):
        ligne = self.conn.execute(
            "SELECT * FROM cascades WHERE id = ?", (cascade_id,)).fetchone()
        return dict(ligne) if ligne else None

    def lister_cascades(self):
        """Toutes les cascades, la plus récente en premier (pour l'historique)."""
        lignes = self.conn.execute(
            "SELECT * FROM cascades ORDER BY id DESC").fetchall()
        return [dict(ligne) for ligne in lignes]

    def ajouter_appel_cascade(self, cascade_id, rang, nom, telephone, etat,
                              issue=None, resultat=None, transcription=None,
                              note=None, rendezvous_libere=None):
        """Trace une personne de la cascade : appelée (avec issue) ou épargnée.

        `note` = ce que LE PRODUIT a décidé (par exemple : la date convenue
        ne tenait pas, aucun rendez-vous n'a été créé) — jamais du texte
        prêté à l'agent.
        `rendezvous_libere` = l'identifiant de l'ANCIEN rendez-vous que cet
        appel a réellement rendu (le client a pris une autre place). NULL
        quand rien n'a été libéré : soit il n'y avait rien à libérer, soit
        RingBack ne savait pas de quel rendez-vous il s'agissait — et la
        note le dit alors en clair, pour qu'un humain s'en charge."""
        curseur = self.conn.execute(
            "INSERT INTO appels_cascade (cascade_id, rang, nom, telephone, etat, "
            "issue, resultat, transcription, note, rendezvous_libere) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (cascade_id, rang, nom, telephone, etat, issue,
             json.dumps(resultat, ensure_ascii=False) if resultat is not None else None,
             transcription, note, rendezvous_libere))
        self.conn.commit()
        return curseur.lastrowid

    def appels_de_cascade(self, cascade_id):
        """Les lignes de la cascade, numéros déjà masqués (le brut ne sort pas)."""
        lignes = self.conn.execute(
            "SELECT * FROM appels_cascade WHERE cascade_id = ? ORDER BY rang",
            (cascade_id,)).fetchall()
        detail = []
        for ligne in lignes:
            entree = dict(ligne)
            entree["numero_essai"] = self._est_essai(entree["telephone"])
            entree["telephone_masque"] = masquer_telephone(entree.pop("telephone"))
            entree["resultat"] = (json.loads(entree["resultat"])
                                  if entree["resultat"] else None)
            detail.append(entree)
        return detail

    def bilan_issues(self):
        """Compte les issues des appels exécutés, pour le tableau à l'écran.

        confirmed / rescheduled / canceled = issue rendue par l'agent ;
        to_reschedule = le client veut déplacer sans conclure de date ;
        echec = appel passé mais sans résultat exploitable. Les appels
        annulés AVANT exécution ne comptent pas : ils n'ont pas eu d'issue.
        """
        bilan = {"confirmed": 0, "rescheduled": 0, "canceled": 0,
                 "to_reschedule": 0, "echec": 0}
        for ligne in self.conn.execute("SELECT statut, resultat FROM appels").fetchall():
            if ligne["statut"] == "échec":
                bilan["echec"] += 1
            elif ligne["statut"] == "terminé" and ligne["resultat"]:
                statut = json.loads(ligne["resultat"]).get("appointment_status")
                if statut in bilan:
                    bilan[statut] += 1
        return bilan

    # ---------------------------------------------------------------- campagnes
    def creer_campagne(self, nom, theme, sujet="", mission="", creneau=None,
                       cascade_id=None, nature=None, configuration=None,
                       statut=None):
        """Ouvre une campagne (l'instanciation d'un thème de travail).

        nature + configuration : le modèle de l'assistant en 3 étapes ;
        statut : « prête » pour une campagne de l'assistant (elle n'appelle
        personne avant ▶ Démarrer), sinon le défaut historique « en cours ».
        """
        curseur = self.conn.execute(
            "INSERT INTO campagnes (nom, theme, sujet, mission, creneau, "
            "cascade_id, nature, configuration, statut) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (nom, theme, sujet, mission, creneau, cascade_id, nature,
             configuration, statut or "en cours"))
        self.conn.commit()
        journal.info("Campagne n°%d créée : %s", curseur.lastrowid, nom)
        return curseur.lastrowid

    def changer_statut_campagne(self, campagne_id, statut):
        self.conn.execute("UPDATE campagnes SET statut = ? WHERE id = ?",
                          (statut, campagne_id))
        self.conn.commit()

    def definir_raison_pause_campagne(self, campagne_id, raison):
        """POURQUOI la campagne s'est mise en pause toute seule (ou None).

        Écrite quand une panne DE NOTRE CÔTÉ arrête la campagne (clé
        refusée, service en panne, crédit épuisé) : c'est ce texte que la
        fiche affiche, en français, avec la marche à suivre. Remise à None
        au redémarrage — une raison périmée ne doit jamais rester à l'écran.
        """
        self.conn.execute("UPDATE campagnes SET raison_pause = ? WHERE id = ?",
                          (raison, campagne_id))
        self.conn.commit()

    def definir_configuration_campagne(self, campagne_id, configuration):
        """Réécrit la configuration (JSON) d'une campagne de l'assistant.

        Sert au maillon de cascade : la campagne préparée note d'où elle
        vient et à quelle profondeur de chaîne elle se trouve.
        """
        self.conn.execute(
            "UPDATE campagnes SET configuration = ? WHERE id = ?",
            (configuration, campagne_id))
        self.conn.commit()

    def definir_creneau_campagne(self, campagne_id, creneau, mission=None):
        """Fait avancer une campagne sur la place SUIVANTE de sa liste.

        ⚠ LA COLONNE SUIT LE CURSEUR. Tout ce qui lit `campagnes.creneau` —
        et c'est le cas du chemin d'appel lui-même — doit voir la place EN
        COURS, sinon un OUI serait écrit sur une place déjà pourvue.
        `mission` accompagne le mouvement : le message annonce une date, il
        ne peut pas rester sur l'ancienne.
        """
        if mission is None:
            self.conn.execute(
                "UPDATE campagnes SET creneau = ? WHERE id = ?",
                (creneau, campagne_id))
        else:
            self.conn.execute(
                "UPDATE campagnes SET creneau = ?, mission = ? WHERE id = ?",
                (creneau, mission, campagne_id))
        self.conn.commit()

    def obtenir_campagne(self, campagne_id):
        ligne = self.conn.execute(
            "SELECT * FROM campagnes WHERE id = ?", (campagne_id,)).fetchone()
        return dict(ligne) if ligne else None

    def lister_campagnes(self):
        """Toutes les campagnes, la plus récente d'abord, avec leur avancement.

        appeles = contacts ayant eu au moins une tentative ; aboutis =
        contacts dont la chaîne s'est conclue positivement ; relances =
        relances encore planifiées.
        """
        lignes = self.conn.execute("""
            SELECT k.*,
              (SELECT COUNT(*) FROM contacts_campagne c
               WHERE c.campagne_id = k.id) AS contacts,
              (SELECT COUNT(*) FROM contacts_campagne c
               WHERE c.campagne_id = k.id
               AND c.etat IN ('appelé', 'abouti', 'abandonné')) AS appeles,
              (SELECT COUNT(*) FROM contacts_campagne c
               WHERE c.campagne_id = k.id AND c.etat = 'abouti') AS aboutis,
              (SELECT COUNT(*) FROM relances r
               WHERE r.campagne_id = k.id AND r.statut = 'planifiée') AS relances
            FROM campagnes k ORDER BY k.id DESC""").fetchall()
        return [dict(ligne) for ligne in lignes]

    def campagnes_ayant_appele(self):
        """Les identifiants des campagnes qui ont passé AU MOINS UN appel.

        ⚠ POURQUOI PAS LE STATUT (21/08/2026). « Terminée » ne suffit pas, et
        « close » encore moins : une campagne préparée puis close n'a jamais
        fait sonner un téléphone. Mesuré dans sa base ce jour-là : sur 113
        campagnes passées, SEPT étaient closes sans avoir appelé personne — les
        annoncer « déjà envoyées » aurait été faux, exactement le genre d'écart
        qu'il venait de signaler.

        Le seul fait qui ne ment pas est la trace d'appel elle-même.
        """
        return {ligne["campagne_id"] for ligne in self.conn.execute(
            "SELECT DISTINCT campagne_id FROM appels_campagne")}

    # ------------------------------------------- effacer des campagnes
    # ⚠ C'EST LE SEUL ENDROIT DU PRODUIT QUI DÉTRUIT DE L'HISTORIQUE. Tout le
    # reste ne fait qu'ajouter ou changer un statut. Deux fonctions, exprès :
    # on COMPTE d'abord, on montre les nombres, et on n'efface qu'ensuite.
    def compter_avant_suppression_campagnes(self, ids):
        """Ce qu'effacer ces campagnes emporterait — sans rien toucher.

        Sert à l'écran de confirmation. Le compte des appels EN ATTENTE est
        le plus important : ce sont des appels réellement PARTIS chez CALL-E
        dont le résultat n'est pas encore lu, et l'identifiant qui permet de
        le retrouver ne vit que sur le contact. L'effacer, c'est perdre le
        résultat d'une vraie conversation, pas une ligne de tableau.
        """
        if not ids:
            return {"campagnes": 0, "contacts": 0, "appels": 0,
                    "relances_planifiees": 0, "relances": 0, "changements": 0,
                    "appels_en_attente": 0, "cascades": 0}
        trous = ",".join("?" for _ in ids)
        valeurs = list(ids)

        def compte(requete):
            return self.conn.execute(requete, valeurs).fetchone()[0]

        return {
            "campagnes": compte(
                f"SELECT COUNT(*) FROM campagnes WHERE id IN ({trous})"),
            "contacts": compte(
                "SELECT COUNT(*) FROM contacts_campagne "
                f"WHERE campagne_id IN ({trous})"),
            "appels": compte(
                "SELECT COUNT(*) FROM appels_campagne "
                f"WHERE campagne_id IN ({trous})"),
            "relances_planifiees": compte(
                "SELECT COUNT(*) FROM relances "
                f"WHERE campagne_id IN ({trous}) AND statut = 'planifiée'"),
            "relances": compte(
                f"SELECT COUNT(*) FROM relances WHERE campagne_id IN ({trous})"),
            "changements": compte(
                "SELECT COUNT(*) FROM changements "
                f"WHERE campagne_id IN ({trous})"),
            "appels_en_attente": compte(
                "SELECT COUNT(*) FROM contacts_campagne "
                f"WHERE campagne_id IN ({trous}) "
                "AND appel_externe_id IS NOT NULL AND appel_externe_id <> ''"),
            "cascades": compte(
                "SELECT COUNT(*) FROM cascades WHERE id IN "
                f"(SELECT cascade_id FROM campagnes WHERE id IN ({trous}) "
                " AND cascade_id IS NOT NULL)"),
        }

    def supprimer_campagnes(self, ids):
        """Efface ces campagnes et tout ce qui n'existe que par elles.

        Dans l'ordre des dépendances, en une seule transaction : le cahier de
        changements, les relances, les appels, les contacts, la cascade
        éventuelle, puis la campagne. Rend le même relevé de comptes que
        `compter_avant_suppression_campagnes`.

        ⚠ CE QUI N'EST PAS TOUCHÉ, et c'est voulu : les CLIENTS et les
        RENDEZ-VOUS. Une campagne les a peut-être modifiés — le rendez-vous
        déplacé reste déplacé, la place libérée reste libre. Effacer la
        campagne efface la TRACE du travail, jamais son résultat dans
        l'agenda. C'est aussi pour cela que le cahier de changements s'en va
        avec elle : il raconte ce qu'ELLE a fait.
        """
        ids = [int(x) for x in ids]
        if not ids:
            return self.compter_avant_suppression_campagnes([])
        releve = self.compter_avant_suppression_campagnes(ids)
        trous = ",".join("?" for _ in ids)
        with self.verrou:
            cascades = [ligne[0] for ligne in self.conn.execute(
                f"SELECT cascade_id FROM campagnes WHERE id IN ({trous}) "
                "AND cascade_id IS NOT NULL", ids).fetchall()]
            for table in ("changements", "relances", "appels_campagne",
                          "contacts_campagne"):
                self.conn.execute(
                    f"DELETE FROM {table} WHERE campagne_id IN ({trous})", ids)
            self.conn.execute(
                f"DELETE FROM campagnes WHERE id IN ({trous})", ids)
            if cascades:
                creux = ",".join("?" for _ in cascades)
                self.conn.execute(
                    f"DELETE FROM appels_cascade WHERE cascade_id IN ({creux})",
                    cascades)
                self.conn.execute(
                    f"DELETE FROM cascades WHERE id IN ({creux})", cascades)
            self.conn.commit()
        journal.info(
            "Campagnes effacées : %d campagne(s), %d contact(s), %d appel(s), "
            "%d relance(s), %d ligne(s) de changements, %d cascade(s)",
            releve["campagnes"], releve["contacts"], releve["appels"],
            releve["relances"], releve["changements"], releve["cascades"])
        return releve

    def ajouter_contact_campagne(self, campagne_id, rang, nom, telephone,
                                 rendezvous_id=None, etat="à appeler",
                                 issue=None, champs=None, detail=None,
                                 client_id=None):
        """Ajoute un contact ; client_id=None fait CRÉER (ou retrouver) sa fiche.

        Le contact porte donc toujours un lien vers une fiche client : c'est
        le numéro ACTUEL de cette fiche qui sera composé, jamais la copie
        gelée ici (qui reste comme trace de ce qui avait été importé).
        """
        if client_id is None:
            client_id = self.client_pour_contact(nom, telephone, rendezvous_id)
        # ⚠ L'ÉTAT DU RENDEZ-VOUS AU MOMENT OÙ LA CAMPAGNE LE PREND (21/08/2026).
        # Sans lui, impossible de savoir plus tard s'il a changé SOUS NOS PIEDS :
        # une campagne de rappel des MANQUÉS prend des rendez-vous « manqué »,
        # une reprise des ANNULÉS en prend des « annulé » — refuser sur le seul
        # statut courant les aurait toutes cassées. C'est l'ÉCART qui compte,
        # pas l'état. Ajout ADDITIF : les campagnes déjà en base n'en ont pas,
        # et `cible_appel_contact` sait s'en passer.
        champs = self._avec_statut_du_rendezvous(champs, rendezvous_id,
                                                nom, telephone)
        curseur = self.conn.execute(
            "INSERT INTO contacts_campagne (campagne_id, rang, nom, telephone, "
            "rendezvous_id, etat, issue, champs, detail, client_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (campagne_id, rang, nom, telephone, rendezvous_id, etat, issue,
             champs, detail, client_id))
        self.conn.commit()
        return curseur.lastrowid

    def _avec_statut_du_rendezvous(self, champs, rendezvous_id, nom="",
                                   telephone=""):
        """Ajoute « rdv_statut » aux champs du contact, s'il y a un rendez-vous.

        ⚠ DEUX FAÇONS D'ÊTRE LIÉ À UN RENDEZ-VOUS, et il faut les deux : par
        IDENTIFIANT quand la liste vient du planning ou de la base, par DATE
        quand elle est collée ou importée d'un CSV (voir `_rendezvous_vise`,
        qui fait exactement la même lecture au moment d'appeler).

        Rend le JSON tel quel quand RingBack ne connaît aucun rendez-vous pour
        ce contact : c'est ce qui distingue « il a changé » de « on n'en a
        jamais su le premier mot », et on ne devine pas la différence.
        """
        try:
            valeurs = json.loads(champs) if champs else {}
        except (TypeError, ValueError):
            return champs
        if not isinstance(valeurs, dict):
            return champs
        rdv = self._rendezvous_du_contact(rendezvous_id, valeurs, nom, telephone)
        if rdv is None:
            return champs
        valeurs["rdv_statut"] = rdv["statut"]
        return json.dumps(valeurs, ensure_ascii=False)

    def _rendezvous_du_contact(self, rendezvous_id, champs, nom, telephone):
        """LE rendez-vous dont parle ce contact, par identifiant ou par date."""
        if rendezvous_id:
            return self.conn.execute(
                "SELECT id, horaire, statut FROM rendezvous WHERE id = ?",
                (rendezvous_id,)).fetchone()
        date = (champs.get("rdv_existant") or "").strip()
        if not date:
            return None
        trouve = self.rendezvous_identique(nom, telephone, date)
        if trouve is None:
            return None
        return self.conn.execute(
            "SELECT id, horaire, statut FROM rendezvous WHERE id = ?",
            (trouve["id"] if isinstance(trouve, dict) else trouve,)).fetchone()

    def rendezvous_change_depuis_la_campagne(self, contact_id):
        """Le rendez-vous a-t-il changé depuis que la campagne l'a pris ?

        ⚠ SA DEMANDE DU 21/08/2026, et le défaut qu'elle corrige. Éprouvé :
        j'annule un rendez-vous entre la création de la campagne et l'appel, le
        téléphone sonne quand même — et le « oui » REMET le rendez-vous au
        planning. Mesuré dans sa base : 131 contacts pouvaient encore sonner
        pour un rendez-vous supprimé ou annulé.

        Rend la phrase qui dit CE QUI a changé, ou "" si rien n'a bougé.

        ⚠ C'EST L'ÉCART QUI DÉCIDE, PAS L'ÉTAT COURANT. Une campagne de rappel
        des manqués prend des rendez-vous « manqué » : ils sont normaux pour
        elle. Ce qui n'est pas normal, c'est qu'un rendez-vous ait quitté
        l'état où la campagne l'avait trouvé.

        ⚠ ET SANS ÉTAT DE CAPTURE, ON NE DEVINE PAS : les campagnes d'avant le
        21/08/2026 n'en portent pas. On s'en tient alors à ce qui est certain —
        la ligne a disparu, ou l'horaire n'est plus celui annoncé.
        """
        ligne = self.conn.execute(
            "SELECT rendezvous_id, champs, nom, telephone "
            "FROM contacts_campagne WHERE id = ?", (contact_id,)).fetchone()
        if ligne is None:
            return ""
        try:
            champs = json.loads(ligne["champs"] or "{}")
        except (TypeError, ValueError):
            champs = {}
        if not isinstance(champs, dict):
            champs = {}
        capture_statut = champs.get("rdv_statut")
        if not capture_statut:
            # ⚠ RIEN N'A ÉTÉ CAPTURÉ : soit la campagne est antérieure au
            # 21/08/2026, soit RingBack n'a jamais connu ce rendez-vous (une
            # ligne collée avec une date tapée à la main). Dans les deux cas on
            # ne devine pas — refuser ici écarterait des gens sans raison.
            return ""
        rdv = self._rendezvous_du_contact(ligne["rendezvous_id"], champs,
                                          ligne["nom"], ligne["telephone"])
        if rdv is None:
            # ⚠ LE TEXTE DIT CE QU'ON SAIT, PAS PLUS. Quand le contact est lié
            # par IDENTIFIANT (planning, base), une absence est une suppression,
            # sans ambiguïté. Quand il l'est par DATE (liste collée, CSV), un
            # rendez-vous introuvable a pu être déplacé, annulé ou supprimé —
            # les trois se ressemblent, et prétendre choisir serait inventer.
            if ligne["rendezvous_id"]:
                return "il a été supprimé de l'agenda"
            return ("il n'est plus à la date que la campagne avait retenue — "
                    "déplacé, annulé ou supprimé depuis")
        capture_date = (champs.get("rdv_existant") or "").strip()
        if capture_date and rdv["horaire"] != capture_date:
            return ("il a été déplacé depuis — la campagne parlerait d'une "
                    "date qui n'est plus la sienne")
        if (rdv["statut"] != capture_statut
                and rdv["statut"] not in STATUTS_OCCUPANTS_RDV):
            return (f"il est passé « {rdv['statut']} » depuis — la campagne "
                    "l'avait pris « " + capture_statut + " »")
        return ""

    def definir_detail_contact(self, contact_id, detail):
        """Écrit l'information clé affichée pour ce contact (assistant) —
        toujours depuis le résultat réel de l'appel, jamais inventée."""
        self.conn.execute(
            "UPDATE contacts_campagne SET detail = ? WHERE id = ?",
            (detail, contact_id))
        self.conn.commit()

    def contacts_de_campagne(self, campagne_id):
        """Les contacts de la campagne, numéros déjà masqués (le brut ne sort pas)."""
        lignes = self.conn.execute(
            "SELECT * FROM contacts_campagne WHERE campagne_id = ? ORDER BY rang",
            (campagne_id,)).fetchall()
        contacts = []
        for ligne in lignes:
            contact = dict(ligne)
            contact["numero_essai"] = self._est_essai(contact["telephone"])
            contact["telephone_masque"] = masquer_telephone(contact.pop("telephone"))
            contacts.append(contact)
        return contacts

    def obtenir_contact_campagne(self, contact_id):
        """La fiche d'un contact de campagne (numéro masqué), ou None."""
        ligne = self.conn.execute(
            "SELECT * FROM contacts_campagne WHERE id = ?", (contact_id,)).fetchone()
        if ligne is None:
            return None
        contact = dict(ligne)
        contact["numero_essai"] = self._est_essai(contact["telephone"])
        contact["telephone_masque"] = masquer_telephone(contact.pop("telephone"))
        return contact

    def telephone_contact_campagne(self, contact_id):
        """Le numéro ACTUEL de ce contact, EN CLAIR — jamais à l'affichage.

        C'est le numéro de sa FICHE CLIENT qui fait foi, pas la copie gelée
        à la création de la campagne : corriger un numéro corrige toutes les
        campagnes en cours. Rend None si la fiche a été supprimée (plus rien
        à composer) ; les contacts d'avant la colonne `client_id` (base
        ancienne) retombent sur leur copie d'époque.
        """
        ligne = self.conn.execute(
            "SELECT telephone, client_id FROM contacts_campagne WHERE id = ?",
            (contact_id,)).fetchone()
        if ligne is None:
            return None
        if ligne["client_id"] is None:
            return ligne["telephone"]
        return self.telephone_de(ligne["client_id"])

    def cible_appel_contact(self, contact_id):
        """Ce qu'il faut composer pour ce contact — et le REFUS s'il y en a un.

        Rend {"telephone": str|None, "refus": str|None, "client_id": int|None}.
        C'est le point de passage OBLIGÉ de tous les chemins d'appel de
        campagne : il tient le lien vers la fiche (numéro actuel) ET le
        filet de sécurité du 🚫 (numéro OU nom d'un client marqué « Ne plus
        appeler »). Quand « refus » est rempli, aucun appel ne part et le
        texte est celui qui s'affiche à l'écran.
        """
        ligne = self.conn.execute(
            "SELECT nom, telephone, client_id FROM contacts_campagne "
            "WHERE id = ?", (contact_id,)).fetchone()
        if ligne is None:
            return {"telephone": None, "refus": REFUS_CLIENT_SUPPRIME,
                    "client_id": None}
        client_id, telephone = ligne["client_id"], ligne["telephone"]
        if client_id is not None:
            fiche = self.conn.execute(
                "SELECT telephone, ne_plus_appeler FROM clients WHERE id = ?",
                (client_id,)).fetchone()
            if fiche is None:  # fiche supprimée : le contact reste lisible…
                return {"telephone": None, "refus": REFUS_CLIENT_SUPPRIME,
                        "client_id": client_id}
            if fiche["ne_plus_appeler"]:
                return {"telephone": None, "refus": REFUS_STOP,
                        "client_id": client_id}
            telephone = fiche["telephone"]  # …et c'est le numéro ACTUEL
        if telephone and self.telephone_exclu(telephone):
            return {"telephone": None, "refus": REFUS_STOP,
                    "client_id": client_id}
        if self.nom_exclu(ligne["nom"]):
            return {"telephone": None, "refus": REFUS_STOP_NOM,
                    "client_id": client_id}
        if not telephone:
            return {"telephone": None, "refus": REFUS_SANS_NUMERO,
                    "client_id": client_id}
        # ⚠ LE RENDEZ-VOUS EST RELU ICI, à l'instant de composer (21/08/2026).
        # C'est le même filet que le 🚫 juste au-dessus, et pour la même
        # raison : ce qui était vrai à la création de la campagne a pu cesser
        # de l'être. Éprouvé : un rendez-vous annulé entre-temps était appelé
        # quand même, et le « oui » le remettait au planning.
        change = self.rendezvous_change_depuis_la_campagne(contact_id)
        if change:
            return {"telephone": None,
                    "refus": f"{REFUS_RDV_CHANGE} : {change}",
                    "client_id": client_id}
        return {"telephone": telephone, "refus": None, "client_id": client_id}

    def client_du_contact(self, contact_id):
        """L'identifiant de la fiche client liée à ce contact (None si aucune)."""
        ligne = self.conn.execute(
            "SELECT client_id FROM contacts_campagne WHERE id = ?",
            (contact_id,)).fetchone()
        return ligne["client_id"] if ligne else None

    def compter_contacts_par_etat(self, campagne_id):
        """{état : nombre} pour CETTE campagne — sert au filtre de reprise.

        Le total est donné sous la clé « tous » : l'écran annonce ainsi le
        nombre de personnes trouvées AVANT de les ajouter à la grille.
        """
        comptes = {"tous": 0}
        for ligne in self.conn.execute(
                "SELECT etat, COUNT(*) AS nombre FROM contacts_campagne "
                "WHERE campagne_id = ? GROUP BY etat", (campagne_id,)):
            comptes[ligne["etat"]] = ligne["nombre"]
            comptes["tous"] += ligne["nombre"]
        return comptes

    def contacts_campagne_en_clair(self, campagne_id, etat=None):
        """Contacts d'une campagne passée, numéro EN CLAIR, filtrés par état.

        etat=None (ou « tous ») rend toute la liste. Numéro en clair :
        même usage que candidats_cascade / contacts_depuis_rendezvous —
        la constitution d'une liste d'appel demandée EXPLICITEMENT par
        l'utilisateur, jamais l'affichage (qui reste masqué).
        """
        requete = ("SELECT nom, telephone, champs, rendezvous_id, etat, detail "
                   "FROM contacts_campagne WHERE campagne_id = ?")
        parametres = [campagne_id]
        if etat and etat != "tous":
            requete += " AND etat = ?"
            parametres.append(etat)
        lignes = self.conn.execute(requete + " ORDER BY rang",
                                   parametres).fetchall()
        return [dict(ligne) for ligne in lignes]

    def changer_etat_contact_campagne(self, contact_id, etat, issue=None):
        self.conn.execute(
            "UPDATE contacts_campagne SET etat = ?, issue = ? WHERE id = ?",
            (etat, issue, contact_id))
        self.conn.commit()

    # ------------------------------- l'appel PARTI dont le résultat manque
    def definir_appel_en_attente(self, contact_id, identifiant, tentative=None):
        """Garde l'identifiant CALL-E d'un appel PARTI dont le résultat manque.

        C'est la seule chose qui empêche un appel déjà passé d'être perdu :
        sans elle, une attente qui expire effaçait toute trace de la
        conversation (constaté le 01/08/2026). Aucun appel n'est créé ici,
        aucune tentative n'est comptée : on note seulement où retrouver le
        résultat.
        """
        self.conn.execute(
            "UPDATE contacts_campagne SET appel_externe_id = ?, "
            "appel_externe_tentative = ? WHERE id = ?",
            (identifiant, tentative, contact_id))
        self.conn.commit()

    def effacer_appel_en_attente(self, contact_id):
        """L'appel en attente a rendu son résultat : plus rien à récupérer."""
        self.definir_appel_en_attente(contact_id, None, None)

    def contacts_en_attente_de_resultat(self, campagne_id=None):
        """Les contacts dont un appel PARTI n'a pas encore rendu son résultat.

        Numéros masqués, comme partout à l'affichage. campagne_id=None
        balaie toutes les campagnes (le compteur du bandeau).
        """
        requete = ("SELECT * FROM contacts_campagne "
                   "WHERE appel_externe_id IS NOT NULL")
        parametres = []
        if campagne_id is not None:
            requete += " AND campagne_id = ?"
            parametres.append(campagne_id)
        contacts = []
        for ligne in self.conn.execute(requete + " ORDER BY rang", parametres):
            contact = dict(ligne)
            contact["numero_essai"] = self._est_essai(contact["telephone"])
            contact["telephone_masque"] = masquer_telephone(
                contact.pop("telephone"))
            contacts.append(contact)
        return contacts

    def definir_appel_externe(self, appel_id, identifiant):
        """L'identifiant CALL-E d'un appel de la FILE (rappel individuel)."""
        self.conn.execute(
            "UPDATE appels SET appel_externe_id = ? WHERE id = ?",
            (identifiant, appel_id))
        self.conn.commit()

    def ajouter_appel_campagne(self, campagne_id, contact_id, tentative,
                               issue=None, resultat=None, transcription=None):
        """Trace une tentative d'appel de campagne (0 = initiale, 1..n = relances)."""
        curseur = self.conn.execute(
            "INSERT INTO appels_campagne (campagne_id, contact_id, tentative, "
            "issue, resultat, transcription) VALUES (?, ?, ?, ?, ?, ?)",
            (campagne_id, contact_id, tentative, issue,
             json.dumps(resultat, ensure_ascii=False) if resultat is not None else None,
             transcription))
        self.conn.commit()
        return curseur.lastrowid

    def appels_du_contact_campagne(self, contact_id):
        """L'historique des tentatives d'un contact (aucun numéro dedans)."""
        lignes = self.conn.execute(
            "SELECT * FROM appels_campagne WHERE contact_id = ? ORDER BY id",
            (contact_id,)).fetchall()
        appels = []
        for ligne in lignes:
            appel = dict(ligne)
            appel["resultat"] = (json.loads(appel["resultat"])
                                 if appel["resultat"] else None)
            appels.append(appel)
        return appels

    def dernier_rendezvous_connu(self):
        """La date du rendez-vous le PLUS LOIN de l'agenda, ou "" s'il n'y en a.

        Sert au choix « dernière date » du décalage en cascade : au-delà, la
        chaîne ne peut plus trouver personne — c'est donc la seule borne qui
        ait un sens sans en inventer une. Les rendez-vous supprimés et annulés
        sont écartés : ils n'occupent plus rien et ne peuvent servir personne.
        """
        ligne = self.conn.execute(
            "SELECT MAX(horaire) AS fin FROM rendezvous "
            "WHERE statut NOT IN ('supprimé', 'annulé')").fetchone()
        return (ligne["fin"] or "")[:10] if ligne else ""

    def compter_personnes_appelees(self, campagne_id):
        """Combien de PERSONNES cette campagne a-t-elle composées ?

        Des personnes, pas des tentatives : quelqu'un qu'on a relancé trois
        fois compte pour un. C'est ce compte-là que borne le plafond réglé —
        « 30 appels autorisés » veut dire trente personnes composées.

        Une seule requête : ce compte est relu à CHAQUE tour de la boucle
        d'exécution, une lecture par contact y coûterait cher.
        """
        return self.conn.execute(
            "SELECT COUNT(DISTINCT a.contact_id) FROM appels_campagne a "
            "JOIN contacts_campagne c ON c.id = a.contact_id "
            "WHERE c.campagne_id = ?", (campagne_id,)).fetchone()[0]

    # ----------------------------------------------------------------- relances
    def creer_relance(self, campagne_id, contact_id, echeance, tentative=1,
                      motif=""):
        curseur = self.conn.execute(
            "INSERT INTO relances (campagne_id, contact_id, echeance, tentative, "
            "motif) VALUES (?, ?, ?, ?, ?)",
            (campagne_id, contact_id, echeance, tentative, motif))
        self.conn.commit()
        journal.info("Relance n°%d planifiée (campagne n°%d, tentative %d, "
                     "échéance %s)", curseur.lastrowid, campagne_id, tentative,
                     echeance)
        return curseur.lastrowid

    _REQUETE_RELANCE = """
        SELECT r.*, c.nom AS contact_nom, c.telephone AS contact_telephone,
               c.etat AS contact_etat, c.detail AS contact_detail,
               c.client_id AS client_id,
               k.nom AS campagne_nom, k.theme AS campagne_theme,
               k.nature AS campagne_nature, k.statut AS campagne_statut,
               (SELECT COUNT(*) FROM appels_campagne a
                 WHERE a.contact_id = r.contact_id) AS tentatives_faites,
               (SELECT MAX(a.cree_le) FROM appels_campagne a
                 WHERE a.contact_id = r.contact_id) AS dernier_appel
        FROM relances r
        JOIN contacts_campagne c ON c.id = r.contact_id
        JOIN campagnes k ON k.id = r.campagne_id
    """

    def _ligne_relance(self, ligne):
        relance = dict(ligne)
        relance["numero_essai"] = self._est_essai(relance["contact_telephone"])
        relance["telephone_masque"] = masquer_telephone(
            relance.pop("contact_telephone"))
        relance["dernier_appel"] = heure_locale(relance.get("dernier_appel"))
        return relance

    def obtenir_relance(self, relance_id):
        ligne = self.conn.execute(
            self._REQUETE_RELANCE + " WHERE r.id = ?", (relance_id,)).fetchone()
        return self._ligne_relance(ligne) if ligne else None

    def lister_relances(self, statut="planifiée"):
        """Les relances de CE statut, échéance la plus proche d'abord (masquées)."""
        lignes = self.conn.execute(
            self._REQUETE_RELANCE + " WHERE r.statut = ? "
            "ORDER BY r.echeance, r.id", (statut,)).fetchall()
        return [self._ligne_relance(ligne) for ligne in lignes]

    def relances_dues(self, maintenant=None):
        """Les relances planifiées dont l'échéance est atteinte (masquées)."""
        if maintenant is None:
            maintenant = datetime.datetime.now().isoformat(timespec="minutes")
        lignes = self.conn.execute(
            self._REQUETE_RELANCE + " WHERE r.statut = 'planifiée' "
            "AND r.echeance <= ? ORDER BY r.echeance, r.id",
            (maintenant,)).fetchall()
        return [self._ligne_relance(ligne) for ligne in lignes]

    def relances_de_campagne(self, campagne_id):
        """Toutes les relances d'une campagne (masquées), par échéance."""
        lignes = self.conn.execute(
            self._REQUETE_RELANCE + " WHERE r.campagne_id = ? "
            "ORDER BY r.echeance, r.id", (campagne_id,)).fetchall()
        return [self._ligne_relance(ligne) for ligne in lignes]

    def changer_relance(self, relance_id, statut=None, echeance=None):
        if statut is not None:
            self.conn.execute("UPDATE relances SET statut = ? WHERE id = ?",
                              (statut, relance_id))
        if echeance is not None:
            self.conn.execute("UPDATE relances SET echeance = ? WHERE id = ?",
                              (echeance, relance_id))
        self.conn.commit()

    # ------------------------------------- contacts qui attendent un rappel
    # Une personne qu'on n'a PAS pu joindre reste visible même quand plus
    # aucune relance n'est programmée pour elle : sans cela elle disparaîtrait
    # de l'écran alors qu'il faut toujours la rappeler.
    _REQUETE_CONTACT_RAPPEL = """
        SELECT c.id, c.campagne_id, c.rang, c.nom, c.telephone, c.etat,
               c.issue, c.detail, c.traite_le, c.client_id,
               k.nom AS campagne_nom, k.theme AS campagne_theme,
               k.nature AS campagne_nature, k.statut AS campagne_statut,
               (SELECT COUNT(*) FROM appels_campagne a
                 WHERE a.contact_id = c.id) AS tentatives_faites,
               (SELECT MAX(a.cree_le) FROM appels_campagne a
                 WHERE a.contact_id = c.id) AS dernier_appel
        FROM contacts_campagne c
        JOIN campagnes k ON k.id = c.campagne_id
    """

    def _ligne_contact_rappel(self, ligne):
        contact = dict(ligne)
        contact["numero_essai"] = self._est_essai(contact["telephone"])
        contact["telephone_masque"] = masquer_telephone(contact.pop("telephone"))
        # `dernier_appel` vient de sqlite (temps universel) ; `traite_le` est
        # écrit par l'application en heure locale — seul le premier se convertit.
        contact["dernier_appel"] = heure_locale(contact.get("dernier_appel"))
        return contact

    def contacts_injoignables(self):
        """Les contacts non joints dont plus AUCUNE relance n'est programmée.

        Deux états disent la même chose — « on n'a pas réussi à le joindre,
        et la chaîne automatique s'est arrêtée » : « injoignable » (campagnes
        de l'assistant) et « abandonné » (chaînes de relance classiques).

        Le plafond de tentatives les a fait sortir de la chaîne automatique :
        plus rien ne partira tout seul pour eux, et pourtant il faut toujours
        les rappeler. Ils appartiennent donc à la famille des rappels
        automatiques (c'est le système qui les y a mis), avec la mention
        explicite qu'aucune nouvelle relance n'est programmée.
        """
        lignes = self.conn.execute(
            self._REQUETE_CONTACT_RAPPEL + """
            WHERE c.etat IN ('injoignable', 'abandonné')
              AND NOT EXISTS (SELECT 1 FROM relances r
                              WHERE r.contact_id = c.id
                                AND r.statut = 'planifiée')
            ORDER BY c.id""").fetchall()
        return [self._ligne_contact_rappel(ligne) for ligne in lignes]

    def clients_interdits(self):
        """Les identifiants des fiches marquées 🚫 « ne plus appeler ».

        ⚠ EN UN SEUL COUP, et c'est la raison d'être de cette méthode : le
        filtre « contact par l'agent » de 🔁 Relances la pose sur des centaines
        de lignes — une lecture par ligne aurait fait des centaines de requêtes
        pour afficher une page.
        """
        return {ligne["id"] for ligne in self.conn.execute(
            "SELECT id FROM clients WHERE ne_plus_appeler = 1")}

    def clients_par_chiffres(self, chiffres):
        """Les identifiants des contacts dont le numéro contient ces chiffres.

        ⚠ LA COMPARAISON A LIEU ICI, ET LE NUMÉRO EN CLAIR N'EN SORT PAS. Les
        fiches d'affichage ne portent que le masque (`telephone_masque`) —
        c'est voulu : la couche qui rend l'écran n'a jamais vu le vrai numéro.
        Une recherche « 0600000042 » ne doit pas casser cette règle, donc elle
        rend des IDENTIFIANTS, pas des numéros.

        On compare les chiffres significatifs (sans indicatif, sans espaces) :
        on retient rarement le « +33 », et on tape souvent la fin.
        """
        brut = "".join(c for c in (chiffres or "") if c.isdigit())
        if not brut:
            return set()
        # ⚠ DEUX FORMES, PAS UNE. Le numéro rangé est réduit à ses chiffres
        # SIGNIFICATIFS (« +33 6 00 00 00 42 » → « 600000042 ») : un
        # « 0600000042 » tapé en entier ne s'y trouvait donc pas, alors qu'un
        # « 42 » y était. On compare la saisie telle quelle ET réduite de la
        # même façon — « chiffres_significatifs("42") » rend "", d'où le OU.
        formes = {brut}
        reduite = chiffres_significatifs(brut)
        if reduite:
            formes.add(reduite)
        trouves = set()
        for ligne in self.conn.execute("SELECT id, telephone FROM clients"):
            numero = chiffres_significatifs(ligne["telephone"] or "")
            if numero and any(forme in numero for forme in formes):
                trouves.add(ligne["id"])
        return trouves

    # ⚠ « rendezvous_avec_rappel_souhaite » A ÉTÉ RETIRÉE le 10/08/2026 avec
    # le tableau « ☎ À contacter à la main », son unique appelant (voir
    # serveur.py). Le champ `rappel_souhaite` lui SURVIT : il se saisit
    # toujours, et le drapeau 🔔 s'affiche partout où le contact apparaît. Une
    # requête que personne n'appelle finit par mentir sur ce que le produit
    # sait faire.

    def contacts_rappel_humain(self, traites=False):
        """Les contacts 🙋 « à rappeler par un humain », traités ou non.

        C'est la sortie de secours des fiches de discussion : le client veut
        quelque chose que l'agent n'a pas pu conclure. Aucun appel automatique
        ne part JAMAIS pour eux (leur état ne fait plus partie des états
        appelables) ; seul un humain les traite, et le geste « c'est fait »
        les sort de la liste sans rien effacer.
        """
        condition = "IS NOT NULL" if traites else "IS NULL"
        lignes = self.conn.execute(
            self._REQUETE_CONTACT_RAPPEL
            + f" WHERE c.etat = 'à rappeler par un humain' "
              f"AND c.traite_le {condition} ORDER BY c.id").fetchall()
        return [self._ligne_contact_rappel(ligne) for ligne in lignes]

    def marquer_contact_traite(self, contact_id, traite=True):
        """Pose (ou retire) la marque « traité » d'un rappel par un humain.

        Rend True si le contact existait. Rien n'est effacé : la demande du
        client, la campagne et l'historique d'appels restent en base.
        """
        if self.conn.execute("SELECT 1 FROM contacts_campagne WHERE id = ?",
                             (contact_id,)).fetchone() is None:
            return False
        quand = (datetime.datetime.now().isoformat(timespec="seconds")
                 if traite else None)
        self.conn.execute(
            "UPDATE contacts_campagne SET traite_le = ? WHERE id = ?",
            (quand, contact_id))
        self.conn.commit()
        journal.info("Contact n°%d : rappel humain marqué %s", contact_id,
                     "traité" if traite else "à faire")
        return True

    def annuler_relances_campagne(self, campagne_id):
        """Annule TOUTES les relances planifiées d'une campagne ; rend le nombre.

        Sert à la clôture manuelle et au créneau pourvu pendant une relance :
        plus rien à relancer quand l'objectif est atteint ou abandonné.
        """
        curseur = self.conn.execute(
            "UPDATE relances SET statut = 'annulée' "
            "WHERE campagne_id = ? AND statut = 'planifiée'", (campagne_id,))
        self.conn.commit()
        return curseur.rowcount

    def annuler_relances_contact(self, contact_id):
        """Annule les relances planifiées d'UN contact ; rend le nombre.

        ⚠ CELLES DE CE CONTACT SEULEMENT — pas celles de la campagne. Le seul
        appelant est le 🚫 demandé au téléphone (voir
        assistant._poser_ne_plus_appeler) : c'est cette personne-là qui a
        demandé qu'on ne la rappelle plus, pas les autres de la liste.
        """
        curseur = self.conn.execute(
            "UPDATE relances SET statut = 'annulée' "
            "WHERE contact_id = ? AND statut = 'planifiée'", (contact_id,))
        self.conn.commit()
        return curseur.rowcount

    # ------------------------------------------------ cahier de changements
    def ajouter_changement(self, campagne_id, genre, nom, contact_id=None,
                           client_id=None, rendezvous_id=None,
                           ancienne_date=None, nouvelle_date=None, motif="",
                           duree="", raison=""):
        """Écrit UNE ligne du cahier de changements, à l'instant du changement.

        C'est une TRACE, pas un calcul : elle est posée là où le planning
        bouge réellement (assistant._appeler_contact), jamais reconstituée
        après coup — c'est ce qui garantit qu'aucun changement ne se perd.
        genre : « ajout » (➕), « suppression » (➖), « deplacement » (↔) ou
        « humain » (🙋, une demande qu'un humain doit traiter).
        """
        curseur = self.conn.execute(
            "INSERT INTO changements (campagne_id, contact_id, client_id, "
            "rendezvous_id, genre, nom, ancienne_date, nouvelle_date, motif, "
            "duree, raison) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (campagne_id, contact_id, client_id, rendezvous_id, genre, nom,
             ancienne_date, nouvelle_date, motif or "", duree or "",
             raison or ""))
        self.conn.commit()
        journal.info("Cahier de changements — campagne n°%s : %s pour %s "
                     "(%s -> %s)", campagne_id, genre, nom,
                     ancienne_date or "—", nouvelle_date or "—")
        return curseur.lastrowid

    def changements_de_campagne(self, campagne_id):
        """Le cahier de changements d'une campagne, dans l'ordre d'écriture."""
        lignes = self.conn.execute(
            "SELECT * FROM changements WHERE campagne_id = ? ORDER BY id",
            (campagne_id,)).fetchall()
        return [dict(ligne) for ligne in lignes]

    def changements_du_contact(self, contact_id):
        """Les changements écrits pour CE contact de campagne."""
        lignes = self.conn.execute(
            "SELECT * FROM changements WHERE contact_id = ? ORDER BY id",
            (contact_id,)).fetchall()
        return [dict(ligne) for ligne in lignes]

    def campagne_du_rendezvous(self, rendezvous_id):
        """LA campagne qui a produit ce rendez-vous, ou None. Rien n'est ajouté.

        La règle du propriétaire : « on doit simplement renvoyer la demande
        de rendez-vous vers la campagne qui l'a faite ». Le lien existe
        DÉJÀ — le cahier de changements relie chaque ligne à sa campagne ET
        à son rendez-vous. On le relit à l'envers plutôt que de recopier une
        colonne de plus : un rendez-vous né d'un appel retrouve donc sa
        campagne, et un rendez-vous saisi à la main n'en a simplement pas
        (None), sans qu'on lui en invente une.

        Rend {"id", "nom", "genre"} — le genre dit ce que la campagne a fait
        de ce rendez-vous (« ajout », « deplacement »…). La PREMIÈRE ligne
        du cahier fait foi : c'est celle qui l'a créé.
        """
        ligne = self.conn.execute(
            "SELECT ch.campagne_id AS id, ca.nom AS nom, ch.genre AS genre "
            "FROM changements ch JOIN campagnes ca ON ca.id = ch.campagne_id "
            "WHERE ch.rendezvous_id = ? ORDER BY ch.id LIMIT 1",
            (rendezvous_id,)).fetchone()
        return dict(ligne) if ligne else None
