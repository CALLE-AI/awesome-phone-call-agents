"""Interface vers l'agent téléphonique CALL-E.

Deux implémentations de ClientAppels :
- AppelSimule : la seule active par défaut. Aucune connexion réseau ;
  conversation scriptée plausible + résultat conforme au schéma imposé
  (appointment_status : confirmed | rescheduled | canceled).
- AppelReel : le vrai branchement HTTP (urllib.request), volontairement
  inerte par défaut. Il exige la variable d'environnement CALLE_API_KEY
  (sans elle, refus immédiat et clair) et n'est atteint qu'après les deux
  autres verrous du planificateur (dry_run=False + confirmation explicite).
  L'adresse de l'API se règle par CALLE_API_URL ; chaque appel réel laisse
  une ligne d'audit (numéro TOUJOURS masqué) dans
  donnees/audit_appels_reels.jsonl.

QUATRE FAMILLES D'ÉCHEC, JAMAIS CONFONDUES :
- ce qui est imputable au CONTACT (il ne décroche pas, répondeur, numéro
  impossible) : PasDeReponse. Tentative comptée, relance programmée ;
- ce qui est imputable à NOUS AVANT que l'appel parte (clé refusée, service
  en panne, crédit épuisé, réseau coupé) : EchecDeNotreCote. Aucune
  tentative consommée, personne marqué « injoignable », campagne en pause —
  une clé refusée aurait sinon marqué à tort toute la liste ;
- ce qui échoue APRÈS que l'appel soit parti : ResultatEnAttente. L'appel a
  eu lieu, son résultat n'est pas connu — l'identifiant CALL-E est conservé
  et le résultat se récupère plus tard, sans rappeler personne ;
- la réponse est ARRIVÉE mais RingBack ne sait pas la lire :
  ResultatInvalide. La conversation a eu lieu ; relire donnerait la même
  réponse illisible, il n'y a donc rien à attendre. Le contact part
  « à rappeler par un humain » — jamais rappelé automatiquement — avec sa
  transcription et la réponse BRUTE conservées, et la campagne se met en
  pause.

Deux genres d'appels, chacun avec son schéma de résultat :
- le rappel classique d'un rendez-vous manqué (appeler) ;
- l'appel de cascade « premier oui » (appeler_cascade) : on propose un
  créneau libéré ; outcome : accepted | refused | moved (moved = la
  personne veut une autre date, rendue dans new_datetime). Une personne
  qui ne décroche pas n'a pas de conversation, donc pas de résultat :
  c'est l'exception PasDeReponse, jamais un résultat inventé.

Convention de SIMULATION déterministe (pour les tests et la démo) : les
numéros fictifs dont les DEUX DERNIERS chiffres sont 51 à 56 forcent
l'issue — 51 accepte/confirme, 52 refuse/annule, 53 ne décroche pas,
54 demande une autre date (déplacé, date dérivée déterministe),
55 veut déplacer SANS conclure de date (to_reschedule : « rappelez-moi »),
56 ne décroche pas au PREMIER appel puis accepte aux suivants (sert à
démontrer une relance qui aboutit). Tout autre numéro garde le tirage
aléatoire (reproductible par la graine).
"""

import datetime
import http.client
import json
import logging
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request

from . import (consigne as consigne_module,
               langue as mod_langue, themes)
from .db import masquer_telephone

journal = logging.getLogger("ringback.calle")

DOSSIER_APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHEMIN_AUDIT = os.path.join(DOSSIER_APP, "donnees", "audit_appels_reels.jsonl")
# ⚠ LA CLÉ PEUT ÊTRE RANGÉE ICI (10/08/2026). Elle n'était lue que dans
# CALLE_API_KEY, et poser une variable d'environnement est un mur pour un
# indépendant : la solution n'était pas utilisable. Voir `cle_disponible` pour
# ce qui a été gardé — tout, sauf « jamais écrite dans un fichier ».
CHEMIN_CLE = os.path.join(DOSSIER_APP, "donnees", "cle_calle.txt")
SOURCE_VARIABLE = "la variable d'environnement CALLE_API_KEY"
SOURCE_FICHIER = "le fichier donnees/cle_calle.txt"

# to_reschedule : le client veut déplacer son rendez-vous mais AUCUNE date
# n'est convenue pendant l'appel (« rappelez-moi plus tard ») — un appel
# non abouti, qui nourrit les relances programmées.
STATUTS_VALIDES = ("confirmed", "rescheduled", "canceled", "to_reschedule")
CHAMPS_OBLIGATOIRES = ("appointment_status", "new_datetime", "notes")

# « to_reschedule » EXISTE AUSSI EN CASCADE — c'est la quatrième issue, et
# elle manquait. Constaté le 02/08/2026 au 8ᵉ essai réel : la personne a
# demandé qu'on lui répète la date, l'agent a conclu « moved » sans date, et
# RingBack a déclaré la réponse ILLISIBLE. Or « veut autre chose, rien n'est
# convenu » n'a rien d'illisible : c'est très exactement to_reschedule, que
# les quatre autres natures déclarent depuis toujours (code_sans_date). La
# cascade était la seule à ne pas l'avoir.
ISSUES_CASCADE = ("accepted", "refused", "moved", "to_reschedule")
CHAMPS_CASCADE = ("outcome", "new_datetime", "notes")

# ---------------------------------------------------------------------------
# « NE ME RAPPELEZ PLUS », DIT AU TÉLÉPHONE
# ---------------------------------------------------------------------------
# Demande du propriétaire du 10/08/2026. Avant, le 🚫 ne se posait que depuis
# l'écran 👥 Contacts : quelqu'un qui le demandait À L'AGENT n'était pas
# entendu. C'est un manque de courtoisie autant qu'un manque de conformité.
#
# ⚠ UN CHAMP, PAS UNE QUATRIÈME ISSUE. Ce n'est pas une conclusion : c'est une
# demande qui peut accompagner n'importe laquelle des trois (« non, et ne me
# rappelez plus » ; « oui pour cette fois, mais plus ensuite »). Une issue de
# plus aurait forcé à choisir entre les deux.
#
# ⚠ PAS DANS « required ». Un résultat où l'agent l'oublie doit rester valable :
# sinon un champ neuf mettrait des campagnes entières en pause. Absent = non.
CHAMP_NE_PLUS_APPELER = "do_not_call"
# Ce que l'agent doit écrire. Un enum de TEXTE, jamais un booléen : trois refus
# de schéma ont déjà coûté des essais réels à ce projet, et « string + enum »
# est ce que l'exemple de référence emploie.
VALEURS_NE_PLUS_APPELER = ("yes", "no")
# Ce qu'on ACCEPTE en entrée — plus large que ce qu'on demande. Le mauvais
# dénouement n'est pas un 🚫 en trop (il se retire d'un clic depuis
# 👥 Contacts), c'est d'ignorer la demande de quelqu'un.
OUI_NE_PLUS_APPELER = ("yes", "true", "oui", "1", "y", "vrai")
DESCRIPTION_NE_PLUS_APPELER = (
    "« yes » UNIQUEMENT si la personne demande explicitement qu'on ne la "
    "rappelle plus ; « no » dans tous les autres cas.")


# « ET SI AUTRE CHOSE SE LIBÈRE, JE VOUS RAPPELLE ? » — posé après un refus
# ---------------------------------------------------------------------------
# Demande du propriétaire du 10/08/2026. Refuser UNE place n'a jamais voulu
# dire refuser les suivantes : sans cette question, RingBack rappelait
# indéfiniment quelqu'un que ça n'intéresse pas, et la seule échappatoire
# était le 🚫 — qui coupe tout, y compris les appels sur SES rendez-vous.
#
# ⚠ SEULEMENT EN CASCADE (créneau libéré). Ailleurs, la question n'a pas de
# sens : on n'appelle pas pour proposer une place, on appelle à propos du
# rendez-vous de la personne.
#
# ⚠ ABSENT = ELLE CONTINUE DE RECEVOIR. Le drapeau ne se pose que sur un NON
# explicite : c'est le comportement d'avant, et personne n'est écarté par le
# silence de l'agent.
CHAMP_AUTRES_PLACES = "wants_other_slots"
VALEURS_AUTRES_PLACES = ("yes", "no")
NON_AUTRES_PLACES = ("no", "false", "non", "0", "n", "faux")
DESCRIPTION_AUTRES_PLACES = (
    "Uniquement si la personne DÉCLINE la place : « no » si elle ne veut plus "
    "qu'on lui propose d'autres créneaux, « yes » si elle accepte qu'on la "
    "rappelle quand une autre place se libère. Laisse vide sinon.")


def refuse_les_autres_places(resultat):
    """La personne a-t-elle dit NON aux prochaines propositions de place ?

    ⚠ SEUL UN NON EXPLICITE COMPTE. Absent, vide, « yes », ou illisible : elle
    continue de recevoir les propositions — c'est le comportement d'avant, et
    on n'écarte personne sur le silence de l'agent.
    """
    if not isinstance(resultat, dict):
        return False
    valeur = resultat.get(CHAMP_AUTRES_PLACES)
    if isinstance(valeur, bool):
        return not valeur
    return str(valeur or "").strip().lower() in NON_AUTRES_PLACES


def ne_plus_appeler_demande(resultat):
    """La personne a-t-elle demandé qu'on ne la rappelle plus ?

    ⚠ SEUL UN OUI EXPLICITE COMPTE. Un champ absent, vide, « no », ou une
    valeur qu'on ne sait pas lire valent NON : on ne devine pas un 🚫 dans du
    bruit — ce serait couper le téléphone à quelqu'un qui n'a rien demandé.
    Mais on lit large les façons de dire oui (voir OUI_NE_PLUS_APPELER).
    """
    if not isinstance(resultat, dict):
        return False
    valeur = resultat.get(CHAMP_NE_PLUS_APPELER)
    if isinstance(valeur, bool):
        return valeur
    return str(valeur or "").strip().lower() in OUI_NE_PLUS_APPELER


# ---------------------------------------------------------------------------
# LES NOMS QUE CALL-E SE RÉSERVE — interdits dans un schéma de résultat
# ---------------------------------------------------------------------------
# CALL-E remplit lui-même ces champs et refuse la demande (400
# « recipient_result_schema contains reserved field ») si on les lui demande.
# Constaté le 02/08/2026 au 7ᵉ essai réel du propriétaire, sur
# « duration_seconds » : RingBack l'exigeait de l'agent… et ne s'en servait
# nulle part. Il a donc simplement disparu — demander à quelqu'un d'estimer
# une durée que la machine mesure était doublement faux.
#
# Si une durée devient un jour utile (coût d'un appel, statistiques), elle se
# calcule sans rien demander à personne : recipients[].attempts[].started_at
# et completed_at sont dans la réponse, et ce sont des mesures, pas des
# estimations.
#
# La liste vient de la référence d'API du sponsor : « summary, status,
# transcript, call_id, or timing fields ». Les champs de temps y sont décrits
# par leur nature, pas nommés un par un : on prend donc aussi tout nom qui
# commence ou finit par une marque de temps. Mieux vaut refuser chez nous un
# nom acceptable que faire échouer une campagne entière chez CALL-E.
CHAMPS_RESERVES = ("summary", "status", "transcript", "call_id",
                   "duration", "duration_seconds", "started_at",
                   "completed_at", "created_at", "timing")
_SUFFIXES_RESERVES = ("_seconds", "_at", "_ms", "_duration")


def champs_reserves_dans(schema):
    """Les noms réservés présents dans un schéma de résultat (vide = bon).

    Appelée par les essais AVANT toute connexion : un schéma refusé fait
    échouer TOUS les appels d'une campagne, et le refus arrive à distance,
    au 400. Autant s'en apercevoir ici.
    """
    fautifs = []
    for nom in (schema or {}).get("properties", {}):
        minuscule = str(nom).lower()
        if (minuscule in CHAMPS_RESERVES
                or minuscule.endswith(_SUFFIXES_RESERVES)):
            fautifs.append(nom)
    return fautifs

# Créneau de rattrapage standard : quand la référence est un rendez-vous DÉJÀ
# pris (rappel, confirmation, rendez-vous manqué), l'agent propose une place
# une semaine plus tard. Même convention que horaires.RATTRAPAGE_JOURS —
# recopiée ici pour que ce module reste indépendant du calcul des horaires.
RATTRAPAGE_JOURS = 7

# Convention de simulation : terminaison de numéro -> issue forcée.
# « 56 » est à MÉMOIRE : pas de réponse au premier appel de l'instance,
# puis accepte — le scénario type d'une relance qui aboutit.
TERMINAISONS_FORCEES = {"51": "accepte", "52": "refuse",
                        "53": "pas_de_reponse", "54": "deplace",
                        "55": "deplace_non_conclu",
                        "56": "puis_accepte",
                        # « 57 » : elle refuse ET demande qu'on ne la rappelle
                        # plus. C'est le cas réel le plus courant des deux —
                        # et celui qu'il faut pouvoir exiger dans un contrôle.
                        "57": "refuse_et_stop",
                        # « 58 » : elle refuse la place et ne veut plus qu'on
                        # lui en propose — mais elle garde ses rendez-vous.
                        # C'est le refus POLI, celui qui ne coupe pas tout.
                        "58": "refuse_sans_proposition",
                        # « 59 » : la conversation a eu lieu, mais l'agent n'a
                        # rendu aucune issue lisible. Le SEUL cas de figure
                        # qu'une campagne simulée ne joue pas d'elle-même : il
                        # met la campagne en pause, il faut donc pouvoir le
                        # demander sans casser les autres appels.
                        "59": "reponse_illisible"}


# ResultatInvalide est défini PLUS BAS, avec les autres échecs « de notre
# côté » : ce n'est pas un fait sur la personne appelée, c'est RingBack qui
# n'a pas su lire ce que CALL-E a répondu. Voir la classe elle-même.


class CleApiAbsente(RuntimeError):
    """La clé CALLE_API_KEY manque : les appels réels sont impossibles."""


class CleMalFormee(CleApiAbsente):
    """La clé fournie n'a pas la FORME d'une clé (adresse web, trop courte…).

    Elle hérite de CleApiAbsente À DESSEIN : tout ce qui refusait déjà de
    démarrer sans clé refuse désormais aussi de démarrer avec une clé
    manifestement fausse — aucune porte n'est laissée ouverte, et aucun
    appelant n'a besoin d'être modifié pour que le refus soit tenu.
    """


class ErreurApi(RuntimeError):
    """L'API CALL-E n'a pas rendu d'appel abouti (réponse inattendue ou échec)."""


class LectureImpossible(ErreurApi):
    """Ce client d'appels ne sait pas aller relire un résultat chez CALL-E.

    C'est le cas de la SIMULATION : aucun appel n'y est parti, il n'y a donc
    rien à relire. On le dit franchement plutôt que d'inventer un résultat.
    """


class PasDeReponse(ErreurApi):
    """Personne n'a décroché : pas de conversation, donc pas de résultat."""


# ---------------------------------------------------------------------------
# L'ÉCHEC QUI N'EST PAS CELUI DU CONTACT
# ---------------------------------------------------------------------------
# Deux familles d'échec, et elles n'ont RIEN à voir :
#
# - l'échec IMPUTABLE AU CONTACT — il ne décroche pas, il tombe sur le
#   répondeur, son numéro ne se compose pas : c'est bien LUI qu'on n'a pas
#   joint. Une tentative est comptée, une relance est programmée, et au bout
#   du compte il devient « injoignable ». Ce comportement-là ne change pas ;
#
# - l'échec IMPUTABLE À NOUS — la clé est refusée, le service est en panne,
#   le crédit est épuisé, le réseau est coupé. La personne au bout du fil n'y
#   est pour rien : son téléphone n'a même pas sonné. Marquer quelqu'un
#   « injoignable » dans ce cas est un MENSONGE, et c'est exactement ce qui
#   s'est produit en conditions réelles le 01/08/2026 (clé fausse → 401 →
#   contact « injoignable, plafond atteint »).
#
# Un échec de la seconde famille : AUCUNE tentative comptée, AUCUN changement
# d'état du contact, RIEN d'écrit en base — et, comme il se reproduira à
# l'identique sur l'appel suivant, la campagne se met en PAUSE au lieu de
# marquer toute la liste à tort.
RIEN_N_A_EU_LIEU = ("Personne n'a été appelé et aucun crédit CALL-E n'a été "
                    "consommé.")
APPEL_DEJA_LANCE = ("Attention : l'appel avait DÉJÀ été lancé quand la panne "
                    "est survenue — le téléphone a pu sonner et cet appel a "
                    "pu être facturé. Vérifiez avant de rappeler cette "
                    "personne.")
# La troisième réponse possible à « qu'est-ce qui a eu lieu ? », et elle
# manquait : la demande est PARTIE et la réponse n'est jamais revenue. Dire
# « personne n'a été appelé » serait alors un mensonge, dire « l'appel a été
# lancé » aussi. On dit qu'on ne sait pas, et où aller vérifier.
APPEL_INCERTAIN = "incertain"
APPEL_PEUT_ETRE_LANCE = (
    "La demande est bel et bien PARTIE vers CALL-E, mais sa réponse n'est "
    "jamais revenue : RingBack ne peut pas dire si le téléphone a sonné, et "
    "il ne l'invente pas. Vérifiez dans le tableau de bord CALL-E "
    "(dashboard.heycall-e.com) avant de rappeler cette personne.")
# Volontairement formulé sans nommer « la campagne » : le même texte sert la
# fiche de campagne, la file d'appels, la cascade et les relances. Chaque
# écran ajoute SON contexte (« Campagne mise en pause toute seule : … »,
# « Aucun appel n'est parti »), et la phrase reste vraie partout.
RIEN_N_EST_ECRIT = ("Rien n'a été écrit sur personne : aucune tentative n'a "
                    "été comptée et personne n'a été marqué « injoignable ». "
                    "Ce qui n'a pas été appelé est conservé tel quel et "
                    "reprendra exactement où cela s'est arrêté.")

# Où trouver la VRAIE clé. Cette phrase est la même partout (écran, journal
# d'audit, refus au démarrage, configurer_cle.cmd) : une seule vérité.
QUOI_FAIRE_CLE = (
    "Que faire : ouvrez le tableau de bord CALL-E "
    "(dashboard.heycall-e.com), section « API keys », copiez LA CLÉ "
    "elle-même — pas l'adresse du site — dans le fichier call-e-key.txt, "
    "lancez configurer_cle.cmd, puis relancez RingBack.")
# ⚠ LA CLÉ N'EST PAS EN CAUSE, ET LE DIRE ÉVITE UNE FAUSSE PISTE (03/09/2026).
# Mesuré hors de RingBack, sur une requête en lecture seule : sans clé ET avec
# une clé inventée, CALL-E répond 401 « Invalid or missing API key » ; avec la
# vraie clé, il répond 403 « This account is not allowed to access CALL-E ».
# Les deux codes disent donc deux choses différentes, et 403 veut dire que la
# clé A ÉTÉ RECONNUE. Le message d'avant renvoyait vers « API keys, recréez-la
# au besoin » : le propriétaire a recollé sa clé, relancé, obtenu la même
# erreur — une demi-heure perdue sur la seule piste qui ne pouvait rien donner.
QUOI_FAIRE_DROITS = (
    "Que faire : ce n'est PAS un problème de clé — elle a été reconnue, sinon "
    "CALL-E aurait répondu « clé invalide » (401). La recoller ou en recréer "
    "une ne changera rien. C'est le COMPTE qui est refusé : ouvrez "
    "dashboard.heycall-e.com et regardez l'état du compte lui-même — crédits "
    "épuisés, période d'essai terminée, compte à activer ou à vérifier, moyen "
    "de paiement manquant. Si le tableau de bord paraît normal, c'est à CALL-E "
    "qu'il faut le demander : citez-leur le message ci-dessus mot pour mot.")
QUOI_FAIRE_CREDIT = (
    "Que faire : rechargez le compte dans le tableau de bord CALL-E "
    "(dashboard.heycall-e.com), puis reprenez la campagne — elle repartira "
    "où elle s'est arrêtée.")
QUOI_FAIRE_CADENCE = (
    "Que faire : attendez quelques minutes, puis reprenez la campagne — "
    "elle repartira où elle s'est arrêtée. Si cela recommence, vérifiez les "
    "limites de votre compte dans le tableau de bord CALL-E.")
QUOI_FAIRE_SERVICE = (
    "Que faire : ce n'est pas RingBack qui est en cause — attendez que le "
    "service CALL-E réponde à nouveau (page d'état ou support CALL-E), puis "
    "reprenez la campagne.")
QUOI_FAIRE_RESEAU = (
    "Que faire : vérifiez la connexion Internet de cet ordinateur, puis "
    "reprenez la campagne — elle repartira où elle s'est arrêtée.")
QUOI_FAIRE_DEMANDE = (
    "Que faire : la demande envoyée à CALL-E a été refusée — c'est un défaut "
    "de RingBack, pas de la personne appelée. Lisez la réponse de l'API citée "
    "ci-dessus : elle nomme le champ en cause. Une fois corrigé, reprenez la "
    "campagne : elle repartira où elle s'est arrêtée, et personne n'aura été "
    "appelé deux fois.")

# ---------------------------------------------------------------------------
# LE TROISIÈME CAS : L'APPEL EST PARTI, SON RÉSULTAT N'EST PAS CONNU
# ---------------------------------------------------------------------------
# Constaté le 01/08/2026 à 10h54 : le téléphone du propriétaire a sonné, il a
# décroché, il a ACCEPTÉ le nouveau créneau — et RingBack a écrit
# « injoignable ». La lecture de la réponse avait expiré (« The read operation
# timed out »), l'exception avait traversé, et le résultat de la conversation
# a été perdu.
#
# Une fois que la création (POST /v1/calls) a rendu un identifiant, l'appel
# EST parti : tout ce qui échoue ensuite ne dit RIEN sur la personne appelée,
# et le résultat existe (ou existera) chez CALL-E. C'est un état à part
# entière — ni « injoignable », ni « à recontacter » : « appelé, résultat
# inconnu ». On garde l'identifiant, et on va chercher le résultat plus tard.
RESULTAT_ATTENDU = (
    "L'appel, lui, EST BIEN PARTI : le téléphone a pu sonner et la "
    "conversation a pu avoir lieu. C'est seulement la RÉPONSE de CALL-E qui "
    "n'est pas arrivée. Rien n'a donc été décidé sur cette personne : aucune "
    "tentative ne lui est comptée, elle n'est PAS marquée « injoignable », "
    "et son rendez-vous n'a pas bougé — son résultat est simplement INCONNU "
    "pour l'instant.")
IDENTIFIANT_CONSERVE = (
    "L'appel est enregistré chez CALL-E sous le numéro « {identifiant} » : "
    "c'est par lui que son résultat sera retrouvé, il n'est pas perdu.")
SUITE_EN_ATTENTE = (
    "laissez à l'appel le temps de se terminer, puis utilisez « 📥 Récupérer "
    "les résultats en attente » sur la fiche de la campagne. Ce bouton va "
    "LIRE chez CALL-E le résultat de l'appel déjà passé et l'appliquer — il "
    "ne compose AUCUN numéro, personne ne sera rappelé.")
QUOI_FAIRE_EN_ATTENTE = "Que faire : " + SUITE_EN_ATTENTE


class EchecDeNotreCote(ErreurApi):
    """L'échec vient de NOUS, jamais de la personne appelée.

    Porte tout ce qu'il faut pour l'écrire à l'écran ET au journal d'audit :
    - constat    : ce qui s'est passé, en français, sans code nu ;
    - quoi_faire : la marche à suivre, pas à pas ;
    - code       : le code HTTP quand il y en a un (None sinon) ;
    - appel_lance : l'appel avait-il DÉJÀ été lancé ? Faux tant que la
      demande de création n'a pas abouti — et c'est seulement dans ce cas
      qu'on a le droit d'écrire « personne n'a été appelé ». Vaut
      APPEL_INCERTAIN (« incertain ») quand la demande est partie sans que
      la réponse revienne : on ne sait pas, et on le dit.
    - identifiant : le numéro de l'appel chez CALL-E quand il est connu.

    `globale` dit si la panne touchera TOUS les appels suivants à
    l'identique (clé refusée, quota, service en panne) : c'est elle qui
    déclenche la mise en pause de la campagne.
    """

    globale = True
    statut_audit = None      # renseigné par les sous-classes qui en changent

    def __init__(self, constat, quoi_faire, code=None, appel_lance=False,
                 identifiant=None, reponse_brute=None):
        self.constat = constat
        self.quoi_faire = quoi_faire
        self.code = code
        self.appel_lance = appel_lance
        self.identifiant = identifiant
        # CE QUE L'API A RÉPONDU, mot pour mot. Sans lui, « lisez la réponse
        # citée ci-dessus » renvoie vers du vide — c'est arrivé le 02/08/2026 :
        # le corps était bien lu, mais accroché à args[0], que cette famille
        # n'affiche jamais (elle recompose son message depuis constat +
        # quoi_faire). Il a sa place ICI, au même rang que le reste.
        self.reponse_brute = reponse_brute
        super().__init__(constat)

    def __str__(self):
        return self.message()

    def ce_qui_a_eu_lieu(self):
        """La phrase qui dit ce qui s'est passé du côté du TÉLÉPHONE.

        Trois réponses possibles, et pas une de plus : rien n'est parti,
        l'appel était déjà lancé, ou on ne peut pas savoir.
        """
        if self.appel_lance == APPEL_INCERTAIN:
            return APPEL_PEUT_ETRE_LANCE
        return APPEL_DEJA_LANCE if self.appel_lance else RIEN_N_A_EU_LIEU

    def message(self, citer=True):
        """Le message COMPLET, celui qui s'affiche et qui s'audite.

        Quatre temps, toujours dans le même ordre : ce qui s'est passé, ce
        qui n'a PAS eu lieu, ce que devient la campagne, quoi faire.

        `citer` : la réponse de l'API est incluse dans le texte, parce que
        c'est elle qui nomme la panne et que le message la promet. Les seuls
        à passer citer=False sont les écrans qui la montrent DÉJÀ à part,
        dans leur propre bloc — pour ne pas l'écrire deux fois.
        """
        citation = ""
        if citer and self.reponse_brute:
            citation = ("Ce que CALL-E a répondu, mot pour mot : "
                        + masquer_numeros_du_texte(str(self.reponse_brute)))
        return " ".join(morceau for morceau in (
            self.constat + ".",
            self.ce_qui_a_eu_lieu(),
            RIEN_N_EST_ECRIT if self.globale else "",
            citation,
            self.quoi_faire) if morceau)


class CleRefusee(EchecDeNotreCote):
    """La clé d'accès a été refusée (401) ou n'a pas les droits (403)."""


class QuotaEpuise(EchecDeNotreCote):
    """Plus de crédit (402) ou trop d'appels en trop peu de temps (429)."""


class ServiceIndisponible(EchecDeNotreCote):
    """Le service CALL-E est en panne (5xx) ou injoignable (réseau)."""


class DemandeRefusee(EchecDeNotreCote):
    """CALL-E a refusé la DEMANDE elle-même (requête mal formée).

    Code inconnu de RingBack, mais reçu sur la création de l'appel : rien
    n'est parti. C'est un défaut de RingBack, jamais un fait sur le contact.
    """


class ResultatEnAttente(EchecDeNotreCote):
    """L'APPEL EST PARTI ; son résultat n'est pas connu — pas encore.

    LA règle, une seule, sans cas particulier : dès que la création a rendu
    un identifiant, le téléphone a pu sonner. Tout ce qui échoue APRÈS
    (attente expirée, lecture qui expire, connexion coupée, service qui
    refuse le suivi) ne dit rien sur la personne appelée. On ne lui compte
    aucune tentative, on ne la marque pas « injoignable » — on garde
    l'identifiant de l'appel et on ira chercher son résultat plus tard.

    C'est une panne DE NOTRE CÔTÉ (elle hérite d'EchecDeNotreCote) : la
    campagne se met donc en pause, comme pour une clé refusée. Ce qui change,
    c'est le sort du contact : il ne redevient PAS « à appeler » (le
    rappeler ferait sonner son téléphone une seconde fois pour rien), il
    passe « appelé, résultat inconnu ».
    """

    statut_audit = "résultat en attente"

    def __init__(self, constat, quoi_faire=QUOI_FAIRE_EN_ATTENTE, code=None,
                 identifiant=None):
        super().__init__(constat, quoi_faire, code=code, appel_lance=True,
                         identifiant=identifiant)

    def message(self):
        """Dit ce qui s'est passé, ce qui EST parti, où est l'appel, quoi faire.

        Le texte de RIEN_N_EST_ECRIT n'a pas sa place ici : quelque chose EST
        écrit sur ce contact — son état « appelé, résultat inconnu ». Rien de
        faux, mais quelque chose.
        """
        return " ".join(morceau for morceau in (
            self.constat + ".",
            RESULTAT_ATTENDU,
            (IDENTIFIANT_CONSERVE.format(identifiant=self.identifiant)
             if self.identifiant else ""),
            self.quoi_faire) if morceau)


class DelaiDepasse(ResultatEnAttente):
    """L'attente maximale a expiré, l'appel n'avait pas encore conclu.

    Elle était classée « échec technique » : la tentative était comptée, et
    le contact finissait « injoignable » alors que son téléphone avait sonné.
    C'est le cas du 01/08/2026, corrigé — voir ResultatEnAttente.
    """

    statut_audit = "délai dépassé"


# ---------------------------------------------------------------------------
# LE QUATRIÈME CAS : LA CONVERSATION A EU LIEU, NOUS N'AVONS PAS SU LA LIRE
# ---------------------------------------------------------------------------
# Constaté le 01/08/2026 à 16h49, cinquième essai réel : le téléphone a
# sonné, le propriétaire a décroché et a CONVERSÉ. RingBack a écrit
# {"statut": "échec", "detail": "le résultat doit être un objet JSON"} et son
# contact est passé « injoignable — plafond atteint ». Nous lisions
# etat["result"] et etat["transcript"], deux clés que l'API ne rend pas : le
# résultat d'UN destinataire vit dans recipients[].structured_result.
#
# C'est la QUATRIÈME fois que le même travers frappe (après les codes HTTP
# inconnus, les expirations de lecture et le dépassement d'attente), alors la
# règle est écrite une bonne fois : UN RÉSULTAT QUE NOUS NE SAVONS PAS LIRE
# EST UNE FAUTE DE RINGBACK, JAMAIS UN FAIT SUR LA PERSONNE.
#
# Et ce n'est PAS « résultat en attente » : relire le même appel rendrait la
# même réponse illisible, il n'y a rien à attendre. Le contact part donc
# « à rappeler par un humain » — la conversation a EU LIEU, personne ne doit
# être rappelé automatiquement — avec sa transcription et la réponse BRUTE
# conservées, et la campagne se met en pause.
CONVERSATION_A_EU_LIEU = (
    "L'appel, lui, A BIEN EU LIEU : le téléphone a sonné et la conversation "
    "s'est tenue. C'est RingBack qui n'a pas su lire ce que CALL-E en a "
    "rendu — ce n'est en rien un fait sur la personne appelée.")
RIEN_D_AUTOMATIQUE = (
    "Aucune tentative ne lui est comptée, elle n'est PAS marquée "
    "« injoignable » et elle ne sera JAMAIS rappelée automatiquement : elle "
    "passe « à rappeler par un humain », avec sa transcription et la réponse "
    "brute de CALL-E conservées telles quelles.")
QUOI_FAIRE_REPONSE_ILLISIBLE = (
    "Que faire : la réponse brute de CALL-E est conservée sur la fiche et "
    "dans le journal d'audit — elle dit exactement ce que RingBack n'a pas "
    "su lire. Rappelez cette personne vous-même pour confirmer ce qui a été "
    "convenu, signalez la réponse brute pour que RingBack apprenne à la "
    "lire, puis reprenez la campagne.")

# Longueur de réponse brute conservée : assez pour comprendre en une minute,
# pas assez pour transformer un journal en décharge. Ce qui dépasse est
# tronqué en le DISANT (jamais coupé en silence).
LIMITE_REPONSE_BRUTE = 2000


class ResultatInvalide(EchecDeNotreCote, ValueError):
    """RingBack n'a pas su lire la réponse de CALL-E. Voir le pavé ci-dessus.

    Elle reste une ValueError (les appelants historiques qui l'attrapaient
    ainsi ne changent pas) et devient un EchecDeNotreCote : la campagne se
    met donc en pause, comme pour une clé refusée.

    Deux pièces de plus, et elles ne sont pas décoratives :
    - reponse_brute : ce que l'API a répondu, mot pour mot (tronqué, numéros
      masqués). C'est ce qui manquait le 01/08/2026 pour comprendre en une
      minute au lieu d'une heure ;
    - transcription : la conversation, quand elle a pu être reconstituée. Le
      résultat structuré est illisible, mais l'échange, lui, existe : le
      jeter serait perdre une seconde fois ce que la personne a dit.
    """

    statut_audit = "réponse illisible"

    def __init__(self, constat, quoi_faire=QUOI_FAIRE_REPONSE_ILLISIBLE,
                 code=None, identifiant=None, reponse_brute="",
                 transcription=""):
        # appel_lance=True, toujours : cette exception ne peut naître qu'en
        # lisant la réponse d'un appel TERMINÉ chez CALL-E.
        super().__init__(constat, quoi_faire, code=code, appel_lance=True,
                         identifiant=identifiant)
        self.reponse_brute = reponse_brute
        self.transcription = transcription

    def message(self):
        """Ce qui s'est passé, ce qui a eu lieu, le sort du contact, quoi faire.

        RIEN_N_EST_ECRIT n'a pas sa place ici : quelque chose EST écrit sur
        ce contact (« à rappeler par un humain »). Rien de faux, mais
        quelque chose — et le message doit le dire.
        """
        return " ".join(morceau for morceau in (
            "RingBack n'a pas su lire la réponse de CALL-E : "
            + self.constat + ".",
            CONVERSATION_A_EU_LIEU,
            RIEN_D_AUTOMATIQUE,
            (IDENTIFIANT_CONSERVE.format(identifiant=self.identifiant)
             if self.identifiant else ""),
            self.quoi_faire) if morceau)


def _en_attente_apres_lancement(erreur, identifiant):
    """Reclasse en « résultat en attente » une panne survenue APRÈS le lancement.

    UNE seule règle, appliquée à toute la FAMILLE plutôt qu'au cas du jour :
    l'identifiant existe, donc l'appel est parti, donc l'échec qui suit ne
    concerne pas la personne appelée. Le constat d'origine est conservé mot
    pour mot (« la clé a été refusée », « la lecture a expiré »…) — seule la
    conclusion change.
    """
    if isinstance(erreur, (ResultatEnAttente, ResultatInvalide)):
        # ResultatInvalide n'est PAS une attente : la réponse est arrivée,
        # c'est nous qui n'avons pas su la lire. La relire rendrait la même
        # réponse illisible — proposer « Récupérer les résultats en attente »
        # ferait tourner l'opérateur en rond. On garde seulement
        # l'identifiant, qui reste le moyen de retrouver l'appel chez CALL-E.
        if not erreur.identifiant:
            erreur.identifiant = identifiant
        return erreur
    # UNE seule marche à suivre, pas deux « Que faire » qui se suivent :
    # celle de la panne d'origine, puis la récupération du résultat.
    origine = (getattr(erreur, "quoi_faire", "") or "").strip()
    if origine:
        quoi_faire = origine.rstrip(".") + ". Ensuite, " + SUITE_EN_ATTENTE
    else:
        quoi_faire = QUOI_FAIRE_EN_ATTENTE
    return ResultatEnAttente(getattr(erreur, "constat", None) or str(erreur),
                             quoi_faire, code=getattr(erreur, "code", None),
                             identifiant=identifiant)


# Les codes de réponse que RingBack SAIT lire : classe d'échec, constat,
# marche à suivre. Un code ABSENT de cette table n'est PAS interprété — voir
# _echec_de_reponse : on dit franchement qu'on ne le connaît pas plutôt que
# d'inventer une explication.
CODES_CONNUS = {
    401: (CleRefusee,
          "La clé d'accès CALL-E a été refusée (code 401 : non authentifié) "
          "— elle est fausse, périmée, ou ce n'est pas une clé",
          QUOI_FAIRE_CLE),
    403: (CleRefusee,
          "Le COMPTE CALL-E n'a pas le droit de passer cet appel (code "
          "403 : accès refusé). La clé, elle, a bien été reconnue",
          QUOI_FAIRE_DROITS),
    402: (QuotaEpuise,
          "Le compte CALL-E n'a plus de crédit (code 402 : paiement requis)",
          QUOI_FAIRE_CREDIT),
    429: (QuotaEpuise,
          "Le service CALL-E a refusé un appel de plus pour l'instant "
          "(code 429 : trop d'appels en trop peu de temps)",
          QUOI_FAIRE_CADENCE),
}



# ⚠ LA FRONTIÈRE : ce qui est arrivé À LA PERSONNE, et ce qui nous est arrivé
# à NOUS. Ces deux exceptions-là disent un fait sur l'appelé — elle n'a pas
# décroché, l'agent n'a rien pu tirer de l'échange — et se comptent donc sur
# elle. Toutes les autres, une fois l'appel parti, sont nos pannes à nous et
# ne doivent jamais lui être imputées.
IMPUTABLES_AU_CONTACT = (PasDeReponse, LectureImpossible)


def _echec_de_reponse(code, methode, chemin, creation=False):
    """L'échec correspondant au code rendu par l'API — jamais deviné.

    Ce qui décide, ce n'est PAS de savoir si RingBack reconnaît le code :
    c'est **où** l'échec s'est produit. Tant que la demande de création
    (POST /v1/calls) n'a pas abouti, aucun téléphone n'a sonné — la faute
    est donc forcément de NOTRE côté, connue ou non, et elle frappera
    identiquement le contact suivant. On ne fait pas payer au contact une
    demande que nous avons mal formée.

    Constaté le 01/08/2026 : un 400 « result_schema is not supported » était
    classé « échec ponctuel » faute d'être un code connu — et le contact
    finissait « injoignable, plafond atteint » alors qu'il n'avait jamais été
    appelé. Le message reste honnête sur ce qu'on ignore : on dit qu'on ne
    sait pas ce que le code signifie, mais on sait ce qui n'a PAS eu lieu.
    """
    connu = CODES_CONNUS.get(code)
    if connu:
        classe, constat, quoi_faire = connu
        return classe(constat, quoi_faire, code=code)
    if 500 <= code <= 599:
        return ServiceIndisponible(
            f"Le service CALL-E est en panne : il a répondu {code} sur "
            f"{methode} {chemin}", QUOI_FAIRE_SERVICE, code=code)
    constat = (f"L'API CALL-E a répondu {code} sur {methode} {chemin} : "
               "RingBack ne connaît pas la signification de ce code et ne "
               "l'invente pas.")
    if creation:
        return DemandeRefusee(
            constat + " La demande n'a PAS abouti : personne n'a été appelé, "
            "aucun crédit n'a été consommé, et rien n'a été écrit sur les "
            "contacts.", QUOI_FAIRE_DEMANDE, code=code)
    return ErreurApi(
        constat + " Regardez ce que dit le tableau de bord CALL-E "
        "(dashboard.heycall-e.com) pour cet appel.")


# ---------------------------------------------------------------------------
# LA FORME DE LA CLÉ, CONTRÔLÉE AVANT TOUTE CONNEXION
# ---------------------------------------------------------------------------
# Le 01/08/2026, la variable CALLE_API_KEY contenait « l'adresse du tableau
# de bord » au lieu de la clé. RingBack l'a acceptée sans broncher, a tenté
# deux appels, et a marqué des gens « injoignables ». Un contrôle de bon sens
# aurait tout évité — le voici. Il ne prétend PAS valider une clé (seul
# CALL-E le peut) : il refuse ce qui, manifestement, n'en est pas une.
LONGUEUR_MINIMALE_CLE = 16
GUILLEMETS = "\"'«»“”"
_MARQUEURS_ADRESSE = ("://", "www.")
_EXTENSIONS_ADRESSE = (".com", ".fr", ".net", ".org", ".io", ".eu", ".dev",
                       ".app", ".ai", ".co")


def _ressemble_a_une_adresse(texte):
    """Vrai si ce texte a tout d'une adresse web (c'est l'erreur constatée)."""
    minuscules = texte.lower()
    if any(marqueur in minuscules for marqueur in _MARQUEURS_ADRESSE):
        return True
    avant_chemin = minuscules.split("/")[0]
    return any(avant_chemin.endswith(extension) or extension + "/" in minuscules
               for extension in _EXTENSIONS_ADRESSE)


def _entoure_de_guillemets(texte):
    return len(texte) >= 2 and texte[0] in GUILLEMETS and texte[-1] in GUILLEMETS


def decrire_cle(cle):
    """DÉCRIT la clé sans jamais la montrer : « 23 caractères, ressemble à
    une adresse web ».

    C'est cette description-là — et elle seule — qui s'affiche, s'écrit au
    journal et sort d'un message d'erreur. La clé, jamais.
    """
    brut = cle if isinstance(cle, str) else ""
    traits = [f"{len(brut)} caractère(s)"]
    if not brut.strip():
        traits.append("vide")
        return ", ".join(traits)
    if _ressemble_a_une_adresse(brut):
        traits.append("ressemble à une adresse web")
    if _entoure_de_guillemets(brut.strip()):
        traits.append("entourée de guillemets")
    if brut != brut.strip():
        traits.append("entourée d'espaces")
    if any(blanc in brut.strip() for blanc in (" ", "\t")):
        traits.append("contient une espace")
    if len(brut.strip()) < LONGUEUR_MINIMALE_CLE:
        traits.append("plus courte que "
                      f"{LONGUEUR_MINIMALE_CLE} caractères")
    return ", ".join(traits)


def cle_rangee(chemin=None):
    """La clé écrite dans le fichier, ou "" — sans jamais la journaliser.

    Un fichier absent, vide ou illisible vaut « pas de clé » : on ne veut
    surtout pas qu'un incident de lecture ressemble à une clé fausse.
    """
    try:
        with open(chemin or CHEMIN_CLE, "r", encoding="utf-8") as fichier:
            return fichier.read().strip()
    except OSError:
        return ""


def ranger_cle(cle, chemin=None):
    """Écrit la clé dans le fichier, en accès PROPRIÉTAIRE SEUL.

    ⚠ LA FORME EST CONTRÔLÉE AVANT D'ÉCRIRE. Ranger une clé qui n'en est
    manifestement pas une aurait déplacé le refus au premier appel réel — soit
    le plus mauvais moment.

    ⚠ ET LE FICHIER EST CRÉÉ FERMÉ. `os.open` avec 0o600 pose les droits À LA
    CRÉATION : un `open()` ordinaire suivi d'un `chmod` laisse une fenêtre où
    le fichier est lisible par tout le monde. Sous Windows, les droits POSIX
    sont ignorés — le dossier `donnees/` est de toute façon celui de
    l'utilisateur, et c'est dit à l'écran.
    """
    valider_forme_cle(cle)                      # lève si ce n'en est pas une
    cible = chemin or CHEMIN_CLE
    os.makedirs(os.path.dirname(cible), exist_ok=True)
    descripteur = os.open(cible, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descripteur, "w", encoding="utf-8") as fichier:
        fichier.write(cle.strip())
    journal.info("Clé CALL-E rangée dans le fichier (%s) — jamais journalisée",
                 decrire_cle(cle))
    return True


def retirer_cle(chemin=None):
    """Supprime le fichier de clé ; rend Vrai s'il y en avait un."""
    cible = chemin or CHEMIN_CLE
    try:
        os.remove(cible)
    except OSError:
        return False
    journal.info("Clé CALL-E retirée du fichier")
    return True


def cle_disponible():
    """(clé, source lisible) — la VARIABLE d'abord, le fichier ensuite.

    ⚠ L'ORDRE COMPTE. Quelqu'un qui pose la variable pour un essai ponctuel
    doit gagner contre le fichier, sans avoir à le supprimer. L'écran dit
    toujours d'OÙ vient la clé, pour qu'on ne cherche pas au mauvais endroit.
    """
    depuis_variable = os.environ.get(AppelReel.VARIABLE_CLE) or ""
    if depuis_variable.strip():
        return depuis_variable, SOURCE_VARIABLE
    rangee = cle_rangee()
    if rangee:
        return rangee, SOURCE_FICHIER
    return "", ""


def cle_ignoree():
    """La clé RANGÉE qui ne sert pas, parce qu'une autre gagne. "" sinon.

    ⚠ LE PIÈGE DU 03/09/2026. La variable d'environnement gagne toujours
    contre le fichier — c'est voulu, un essai ponctuel doit primer. Mais rien
    ne le disait : coller une clé dans l'écran des Réglages pouvait n'avoir
    AUCUN effet, l'écran affichant tranquillement « clé enregistrée ». Le jour
    où une campagne s'arrête sur un refus, on recolle sa clé, on relance, on
    obtient le même refus, et on cherche pendant une heure du côté du produit.

    ⚠ ON NE CHANGE PAS QUI GAGNE, ON LE DIT. Inverser l'ordre casserait
    l'essai ponctuel par variable ; se taire coûte une heure à chaque fois.
    """
    depuis_variable = (os.environ.get(AppelReel.VARIABLE_CLE) or "").strip()
    if not depuis_variable:
        return ""
    rangee = cle_rangee().strip()
    if not rangee or rangee == depuis_variable:
        return ""
    return rangee


def etat_de_la_cle():
    """Ce que l'écran a le droit de montrer : jamais la clé, tout le reste.

    Rend un dictionnaire — présente ou non, d'où elle vient, sa DESCRIPTION,
    et si sa forme est valable (avec la raison quand elle ne l'est pas).

    ⚠ Plus « ignoree » : la description de la clé rangée qui ne sert PAS,
    quand la variable d'environnement en impose une autre. Voir `cle_ignoree`.
    """
    cle, source = cle_disponible()
    ignoree = cle_ignoree()
    if not cle:
        return {"presente": False, "source": "", "description": "",
                "valable": False, "refus": "", "ignoree": ""}
    try:
        valider_forme_cle(cle)
    except CleApiAbsente as refus:
        return {"presente": True, "source": source,
                "description": decrire_cle(cle), "valable": False,
                "refus": str(refus), "ignoree": decrire_cle(ignoree)
                if ignoree else ""}
    return {"presente": True, "source": source,
            "description": decrire_cle(cle), "valable": True, "refus": "",
            "ignoree": decrire_cle(ignoree) if ignoree else ""}


def _refus_de_forme(motif, cle, quoi_faire=QUOI_FAIRE_CLE):
    """Le refus type : ce qui a été détecté, la clé DÉCRITE, quoi faire."""
    return CleMalFormee(
        f"Cette clé CALL-E n'a pas la forme d'une clé : {motif}. Ce qui a "
        f"été fourni : {decrire_cle(cle)} — la clé elle-même n'est jamais "
        f"affichée, ni ici ni dans les journaux. {quoi_faire}")


def valider_forme_cle(cle):
    """Contrôle de bon sens sur la FORME de la clé ; rend la clé nettoyée.

    Lève CleApiAbsente si rien n'a été fourni, CleMalFormee si ce qui a été
    fourni n'a manifestement pas la forme d'une clé — en DISANT ce qui a été
    détecté, et sans jamais montrer la clé.

    Ce contrôle ne remplace pas CALL-E : une clé bien formée peut très bien
    être refusée par le service (c'est alors un 401, traité plus haut). Il
    attrape ce qui se voit sans réseau — une adresse web collée à la place
    de la clé, un copier-coller avec les guillemets, un fragment trop court.
    """
    if not isinstance(cle, str) or not cle.strip():
        raise CleApiAbsente(
            "Clé absente — mode simulation actif. Renseignez la variable "
            "d'environnement CALLE_API_KEY pour autoriser les appels réels.")
    propre = cle.strip()
    if _entoure_de_guillemets(propre):
        raise _refus_de_forme(
            "elle a été collée AVEC ses guillemets — recopiez-la sans les "
            "guillemets", cle)
    if _ressemble_a_une_adresse(propre):
        raise _refus_de_forme(
            "c'est une ADRESSE WEB, pas une clé — l'adresse du tableau de "
            "bord CALL-E n'ouvre aucun appel", cle)
    if any(blanc in propre for blanc in (" ", "\t")):
        raise _refus_de_forme(
            "elle contient une espace — une clé n'en contient jamais, le "
            "copier-coller a dû emporter du texte voisin", cle)
    if len(propre) < LONGUEUR_MINIMALE_CLE:
        raise _refus_de_forme(
            f"elle est trop courte ({len(propre)} caractères) : une clé "
            f"d'accès en fait bien plus de {LONGUEUR_MINIMALE_CLE} — le "
            "copier-coller a dû être incomplet", cle)
    return propre


def valider_resultat(resultat):
    """Vérifie la conformité au schéma ; lève ResultatInvalide sinon.

    Schéma : appointment_status (énumération), new_datetime (ISO 8601 requis
    sauf pour « canceled » et « to_reschedule » où il doit être nul — rien
    n'a été conclu), notes (texte). Et RIEN d'autre : voir CHAMPS_RESERVES
    pour la durée, que CALL-E mesure et que RingBack n'a jamais utilisée.
    """
    if not isinstance(resultat, dict):
        raise ResultatInvalide("le résultat doit être un objet JSON")
    for champ in CHAMPS_OBLIGATOIRES:
        if champ not in resultat:
            raise ResultatInvalide(f"champ manquant : {champ}")
    resultat = _sans_date_vide(resultat)
    resultat = _sans_date_c_est_a_reprogrammer(
        resultat, "appointment_status", "rescheduled")
    statut = resultat["appointment_status"]
    if statut not in STATUTS_VALIDES:
        raise ResultatInvalide(f"appointment_status inconnu : {statut!r}")
    nouvelle_date = resultat["new_datetime"]
    if statut in ("canceled", "to_reschedule"):
        if nouvelle_date is not None:
            raise ResultatInvalide("new_datetime doit être nul quand rien "
                                   "n'est conclu (canceled, to_reschedule)")
    elif statut == "confirmed" and nouvelle_date is None:
        # ⚠ « JE SERAI LÀ » — LA FIN LA PLUS COURANTE, ET ELLE ÉTAIT REFUSÉE
        # (mesuré le 24/08/2026). Deux natures dictent cette réponse mot pour
        # mot à l'agent : « ✅ Confirmation » et « 🔔 Rappel de rendez-vous »
        # disent « rends appointment_status = "confirmed" et laisse
        # "new_datetime" vide ». C'est écrit dans le code depuis toujours —
        # `consigne.issue(..., date="vide")` — et ce contrôle-ci ne l'avait
        # jamais appris : il exigeait une date pour tout ce qui n'est pas une
        # annulation.
        #
        # CE QUE ÇA DONNAIT EN RÉEL : la PREMIÈRE personne qui répond « oui,
        # je serai là » faisait déclarer la réponse ILLISIBLE, mettait la
        # campagne EN PAUSE et partait « à rappeler par un humain ». Toute
        # campagne de confirmation s'arrêtait donc au premier succès.
        #
        # POURQUOI LA SIMULATION NE LE MONTRAIT PAS : `AppelSimule` remplissait
        # `new_datetime` sur « confirmed » quoi qu'il arrive. Elle ne jouait
        # donc jamais la réponse qu'elle demande elle-même. C'est corrigé du
        # même coup — le simulateur obéit maintenant à la consigne qu'il reçoit.
        #
        # ⚠ ET CE N'EST PAS UN RELÂCHEMENT : une date est TOUJOURS exigée là où
        # l'issue en réclame une (déplacement, prise de rendez-vous). Le
        # contrôle de forme, lui, ne connaît pas la nature — c'est l'appelant
        # qui la connaît, et qui refuse alors proprement (voir
        # horaires.refus_rendezvous_telephone : « sans la date »).
        pass
    else:
        resultat = _date_du_calendrier(resultat, "quand une date est convenue")
    if not isinstance(resultat["notes"], str):
        raise ResultatInvalide("notes doit être un texte")
    return resultat


# ⚠ LA DATE RENDUE PAR L'AGENT EST RAMENÉE AU FORMAT DU CALENDRIER, ICI ET
# NULLE PART AILLEURS (24/08/2026, sa demande : « lorsqu'il renvoie la réponse
# du choix du créneau, il faut pouvoir avoir le format utilisé dans le
# calendrier »).
#
# CE QUI N'ALLAIT PAS, mesuré : la chaîne rendue partait TELLE QUELLE dans la
# colonne « horaire » du planning. « 2026-08-25T09:00 », « 2026-08-25 09:00 »
# et « 2026-08-25T09:00:00 » sont le MÊME instant — ils entraient en base sous
# trois écritures différentes, et la comparaison de textes qui décide quelle
# place a été retenue (assistant.place_retenue) en refusait deux sur trois : la
# personne partait « à rappeler par un humain » après un appel parfaitement
# réussi.
#
# POURQUOI ICI : `valider_resultat` et `valider_resultat_cascade` sont les DEUX
# seules portes par lesquelles un résultat entre dans RingBack — appel réel
# comme simulation. Corriger chez les appelants, c'était choisir lequel des
# huit endroits qui lisent « new_datetime » on allait oublier.
#
# ⚠ ON LIT, ON NE DEVINE PAS : une forme non reconnue reste un résultat
# ILLISIBLE, comme avant. Le contact part vers un humain avec la réponse brute
# conservée — jamais un rendez-vous posé sur une date supposée.
def _date_du_calendrier(resultat, exigence):
    """Ramène « new_datetime » au format du calendrier ; lève si illisible."""
    brut = resultat["new_datetime"]
    if not isinstance(brut, str):
        raise ResultatInvalide(f"new_datetime doit être une date ISO 8601 "
                               f"{exigence}")
    propre = themes.lire_date(brut)
    if propre is None:
        raise ResultatInvalide(
            f"new_datetime illisible : « {brut} » — attendu une date, par "
            f"exemple 2026-08-15T14:30 ou « samedi 15 août 2026 à 14 heures "
            f"30 »")
    return dict(resultat, new_datetime=propre)


def _sans_date_vide(resultat):
    """Une date VIDE vaut « pas de date » — comme un nul.

    Le schéma envoyé à CALL-E ne peut plus déclarer new_datetime « texte OU
    nul » (l'API refuse les types multiples). L'agent rend donc une chaîne
    vide quand aucune date n'est convenue : on la ramène ici à None, une
    fois pour toutes, pour que tout le reste du produit continue de raisonner
    sur « None = rien de convenu ».
    """
    if isinstance(resultat, dict):
        date = resultat.get("new_datetime")
        if isinstance(date, str) and not date.strip():
            return dict(resultat, new_datetime=None)
    return resultat


def _sans_date_c_est_a_reprogrammer(resultat, champ, code_deplacement):
    """« Veut autre chose » SANS date convenue = « to_reschedule ».

    Ce n'est pas deviner : c'est ce que la consigne demande elle-même à
    l'agent (voir consigne.issue, paramètre code_sans_date — « si une date
    précise a été convenue… sinon rends to_reschedule »). Quand il rend
    quand même le code de déplacement sans date, il dit la même chose avec
    l'autre mot, et RingBack le comprend au lieu de crier à l'illisible.

    Constaté le 02/08/2026 : la personne a demandé qu'on lui répète la date,
    l'agent a conclu « moved » sans date, et la campagne s'est arrêtée sur
    « RingBack n'a pas su lire ». Une réponse parfaitement claire.
    """
    if (isinstance(resultat, dict)
            and resultat.get(champ) == code_deplacement
            and resultat.get("new_datetime") is None):
        return dict(resultat, **{champ: "to_reschedule"})
    return resultat


def valider_resultat_cascade(resultat):
    """Vérifie un résultat d'appel de cascade ; lève ResultatInvalide sinon.

    Schéma : outcome (accepted | refused | moved | to_reschedule),
    new_datetime (ISO 8601 requis pour « moved » ; ADMIS pour « accepted »
    quand plusieurs places ont été annoncées — c'est alors celle que la
    personne a retenue ; nul dans les autres cas), notes (texte). Voir
    CHAMPS_RESERVES pour la durée.

    ⚠ « ACCEPTED » A LE DROIT DE PORTER UNE DATE DEPUIS LE 03/08/2026. Il
    n'en avait pas, parce qu'une campagne ne proposait qu'UNE place : le
    créneau était donc déjà connu. Avec une liste de places annoncées dans
    le même appel, la date rendue est la SEULE façon de savoir laquelle a
    été prise — la refuser mettait la campagne en pause sur une réponse
    parfaitement sensée. Le contrôle « cette date faisait-elle partie de
    celles annoncées ? » n'est pas ici : il appartient à l'appelant, qui
    seul sait ce qu'il a fait annoncer.
    """
    if not isinstance(resultat, dict):
        raise ResultatInvalide("le résultat doit être un objet JSON")
    for champ in CHAMPS_CASCADE:
        if champ not in resultat:
            raise ResultatInvalide(f"champ manquant : {champ}")
    resultat = _sans_date_vide(resultat)
    resultat = _sans_date_c_est_a_reprogrammer(resultat, "outcome", "moved")
    issue = resultat["outcome"]
    if issue not in ISSUES_CASCADE:
        raise ResultatInvalide(f"outcome inconnu : {issue!r}")
    nouvelle_date = resultat["new_datetime"]
    if issue == "moved":
        resultat = _date_du_calendrier(
            resultat, "quand la personne demande une autre date")
    elif issue == "accepted" and nouvelle_date is not None:
        # La place retenue parmi celles annoncées. Elle doit être LISIBLE ;
        # savoir si elle faisait partie des places proposées est le travail
        # de l'appelant, pas du contrôle de forme.
        resultat = _date_du_calendrier(
            resultat, "quand la personne retient une des places annoncées")
    elif nouvelle_date is not None:
        raise ResultatInvalide("new_datetime doit être nul sauf pour « moved »"
                               " (rien n'a été convenu)")
    if not isinstance(resultat["notes"], str):
        raise ResultatInvalide("notes doit être un texte")
    return resultat


# ---------------------------------------------------------------------------
# LIRE LA RÉPONSE DE CALL-E — À L'ENDROIT OÙ ELLE SE TROUVE VRAIMENT
# ---------------------------------------------------------------------------
# La réponse terminale de GET /v1/calls/{id}, telle que la documente le
# sponsor (github.com/CALLE-AI/call-e-integrations) :
#
#   {"status": "completed", "task_completed": true,
#    "structured_result": {...},              <- bilan GLOBAL de la campagne
#    "recipients": [
#      {"structured_result": {...},           <- LE RÉSULTAT D'UN DESTINATAIRE
#       "attempts": [{"transcript_turns": [
#           {"offset_seconds": 0, "speaker": "bot",  "text": "Hi..."},
#           {"offset_seconds": 4, "speaker": "user", "text": "Yes."}]}]}]}
#
# Nous lisions etat["result"] et etat["transcript"] : deux clés qui n'existent
# pas. D'où « le résultat doit être un objet JSON » sur une conversation
# réussie, le 01/08/2026 à 16h49.
#
# « bot » et « user » deviennent « Agent » et « Client » — les MÊMES libellés
# que produit la simulation, pour que l'écran reste homogène qu'un appel soit
# simulé ou réel.
ROLES_TRANSCRIPTION = {"bot": "Agent", "user": "Client"}

# Un numéro dans un texte, sous les trois formes qui circulent réellement :
# international compact ou espacé (+33639980024, +33 6 39 98 00 24), suite
# nue de huit chiffres ou plus, forme nationale française espacée. Les dates
# ISO (2026-08-02T09:30) ne sont volontairement PAS prises : ce sont
# justement elles qu'on a besoin de relire dans une réponse brute.
_MOTIFS_NUMERO = (re.compile(r"\+\d[\d \.]{6,}\d"),
                  re.compile(r"(?<!\d)\d{8,}(?!\d)"),
                  re.compile(r"(?<!\d)0\d(?:[ .]\d\d){4}(?!\d)"))


def contient_numero(texte):
    """Vrai si ce texte porte quelque chose qui ressemble à un numéro.

    Même famille de motifs que le masquage — un seul endroit décide de ce
    qui « ressemble à un numéro », sinon les deux réponses finiraient par
    diverger. Sert à REFUSER un texte destiné à être dicté à l'agent : le
    produit n'énonce jamais un numéro au téléphone.
    """
    return any(motif.search(texte or "") for motif in _MOTIFS_NUMERO)


def masquer_numeros_du_texte(texte):
    """Masque tout ce qui ressemble à un numéro de téléphone dans ce texte.

    La réponse de CALL-E rappelle le numéro composé. La conserver telle
    quelle la ferait entrer EN CLAIR dans le journal d'audit et sur l'écran,
    là où RingBack masque partout ailleurs. Le doute profite au masquage.
    """
    def _remplacer(trouve):
        brut = trouve.group(0)
        chiffres = re.sub(r"\D", "", brut)
        return (("+" if brut.startswith("+") else "")
                + "•" * max(len(chiffres) - 2, 0) + chiffres[-2:])

    for motif in _MOTIFS_NUMERO:
        texte = motif.sub(_remplacer, texte)
    return texte


def reponse_brute_lisible(reponse, limite=LIMITE_REPONSE_BRUTE):
    """La réponse de l'API, en texte, numéros masqués et longueur bornée.

    Elle n'est ni interprétée ni reformulée : c'est une CITATION. C'est ce
    qui manquait le 01/08/2026 — le journal disait « le résultat doit être
    un objet JSON » sans jamais montrer ce que l'API avait répondu.
    """
    try:
        texte = json.dumps(reponse, ensure_ascii=False, sort_keys=True)
    except (TypeError, ValueError):
        texte = repr(reponse)
    texte = masquer_numeros_du_texte(texte)
    if len(texte) > limite:
        texte = (texte[:limite]
                 + f"… [tronqué : {len(texte)} caractères en tout]")
    return texte


def _citation_resultat_d_abord(etat, destinataire):
    """La réponse citée en commençant par le résultat qu'on n'a pas su lire.

    Une citation tronquée doit garder l'essentiel, pas le début de
    l'alphabet. Le résultat structuré vient donc en tête, tel quel ; la
    réponse entière suit, et c'est ELLE qui sera rognée s'il faut rogner.
    """
    resultat = (destinataire or {}).get("structured_result")
    tete = ("structured_result du destinataire : "
            + reponse_brute_lisible(resultat))
    return tete + " — réponse entière : " + reponse_brute_lisible(etat)


def tours_du_destinataire(destinataire):
    """Les tours de parole de la DERNIÈRE tentative de ce destinataire.

    Pourquoi la dernière : « attempts » liste les tentatives d'appel dans
    l'ordre, et une conversation n'a lieu qu'à celle qui a abouti — les
    précédentes sont des sonneries dans le vide. La dernière est donc celle
    qui porte l'échange, et c'est aussi celle dont structured_result rend
    compte. Prendre la première ferait afficher un silence à la place d'une
    conversation ; toutes les concaténer inventerait un échange qui n'a
    jamais eu lieu d'un seul tenant.
    """
    tentatives = (destinataire or {}).get("attempts")
    if not isinstance(tentatives, list) or not tentatives:
        return []
    derniere = tentatives[-1]
    tours = (derniere or {}).get("transcript_turns")
    return tours if isinstance(tours, list) else []


def transcription_depuis_tours(tours):
    """« Agent : … / Contact : … », dans l'ordre où l'API les a rendus.

    Aucun tri : l'API rend les tours dans l'ordre de la conversation, et
    réordonner sur un champ qui peut manquer (offset_seconds) serait
    deviner. Un interlocuteur inconnu de la table garde SON étiquette telle
    quelle plutôt que d'être rangé d'office du côté de l'agent.
    """
    lignes = []
    for tour in tours or ():
        if not isinstance(tour, dict):
            continue
        texte = tour.get("text")
        if not isinstance(texte, str) or not texte.strip():
            continue
        qui = str(tour.get("speaker") or "").strip()
        lignes.append(f"{ROLES_TRANSCRIPTION.get(qui.lower(), qui or '?')} : "
                      f"{texte.strip()}")
    return "\n".join(lignes)


def lire_appel_termine(etat, validateur):
    """(résultat validé, transcription) depuis une réponse TERMINALE de CALL-E.

    Lève ResultatInvalide — en conservant la réponse brute et la
    transcription — dès que la réponse ne se lit pas : c'est une faute de
    RingBack, jamais un fait sur la personne appelée.

    RingBack ne compose qu'un destinataire par appel (voir _appel_complet) :
    c'est donc recipients[0] qu'on lit. S'il n'y en a aucun, on le DIT au
    lieu d'aller chercher ailleurs un résultat qui ressemblerait au bon.
    """
    destinataires = etat.get("recipients") if isinstance(etat, dict) else None
    if not isinstance(destinataires, list) or not destinataires:
        raise ResultatInvalide(
            "la réponse ne contient aucun destinataire (« recipients ») — "
            "RingBack ne sait pas où lire le résultat de la conversation, et "
            "il ne le devine pas",
            reponse_brute=reponse_brute_lisible(etat))
    destinataire = destinataires[0]
    if not isinstance(destinataire, dict):
        raise ResultatInvalide(
            "le premier destinataire de la réponse n'est pas un objet JSON",
            reponse_brute=reponse_brute_lisible(etat))
    transcription = transcription_depuis_tours(
        tours_du_destinataire(destinataire))
    try:
        resultat = validateur(destinataire.get("structured_result"))
    except ResultatInvalide as refus:
        # La conversation, elle, est là : on la garde. Et on cite la réponse
        # EN COMMENÇANT PAR CE QUI A ÉCHOUÉ. Le 02/08/2026, la citation
        # partait de la réponse entière, triée par nom de clé :
        # structured_result arrivait en dernier, et la troncature à 2000
        # caractères l'emportait — le seul morceau qui disait pourquoi.
        refus.reponse_brute = _citation_resultat_d_abord(etat, destinataire)
        refus.transcription = transcription
        raise
    return resultat, transcription


class IssueAppel:
    """Ce que rend un appel : résultat structuré + transcription."""

    def __init__(self, resultat, transcription):
        self.resultat = resultat
        self.transcription = transcription


class ClientAppels:
    """Interface commune : rappel classique et appel de cascade.

    mission (rappel classique) : texte facultatif choisi au lancement
    (thème d'appel, pré-rempli puis modifiable) ; None = mission standard
    historique. Le texte de mission ne contient JAMAIS de numéro.

    consigne : la consigne en TROIS PARTIES déjà construite par l'appelant
    (module consigne) — présentation dite mot pour mot, objectif et contexte
    discutés librement, issues fermées. C'est ce qui part réellement dans le
    champ « task » de CALL-E. Absente, le client réel en construit une
    générique à partir de la mission : aucun appel ne part jamais avec un
    simple monologue.

    nature : la nature de la campagne qui appelle, ou None hors campagne
    (rappel individuel, file d'appels, essai en conditions réelles). Le client
    RÉEL n'en fait rien — CALL-E ne connaît pas nos natures, et la consigne
    porte déjà tout ce qu'il faut dire. Elle ne sert qu'au SIMULATEUR, pour
    jouer les cas de figure propres à cette nature.
    """

    est_reel = False

    def appeler(self, nom_client, telephone, rendezvous, mission=None,
                consigne=None, nature=None):
        raise NotImplementedError

    def appeler_cascade(self, nom_client, telephone, mission, creneau,
                        consigne=None, nature=None):
        raise NotImplementedError

    def recommencer_les_cas(self, nature, nombre_de_contacts=None):
        """Une campagne démarre : rejoue la liste des cas de figure au début.

        Ne fait RIEN par défaut, et c'est voulu : seul le simulateur a des cas
        de figure à dérouler. Le client réel, lui, n'a rien à remettre à zéro —
        ce sont de vraies personnes qui répondent.
        """

    def lire_resultat(self, identifiant, cascade=False):
        """LIT le résultat d'un appel DÉJÀ PASSÉ. NE COMPOSE AUCUN NUMÉRO.

        Aucune création d'appel n'a lieu ici, jamais : une seule LECTURE de
        ce que CALL-E a enregistré pour cet identifiant. Les trois verrous du
        mode réel ne sont pas concernés — ce geste ne peut faire sonner aucun
        téléphone.

        Rend {"etat": …, "statut_api": …} avec, pour « termine », la clé
        « issue » (un IssueAppel). Quatre états possibles :
        - « termine »     : la conversation a eu lieu, le résultat est là ;
        - « en_cours »    : l'appel n'est pas fini, il n'y a rien à écrire ;
        - « sans_reponse »: personne n'a décroché (fait sur le contact) ;
        - « echoue »      : CALL-E a clos l'appel sans succès.

        Le client de SIMULATION lève LectureImpossible : aucun appel n'y est
        parti, il n'y a donc rien à relire — et on ne l'invente pas.
        """
        raise LectureImpossible(
            "Aucun résultat à relire : ce mode ne passe pas de vrais appels "
            "(simulation). Rien n'est parti chez CALL-E, il n'y a donc rien "
            "à aller y chercher — et RingBack n'invente aucun résultat.")


def _date_attendue(consigne, cle):
    """Cette issue de la consigne réclame-t-elle une date ? (défaut : oui)

    ⚠ SANS CONSIGNE, ON GARDE L'ANCIEN COMPORTEMENT. Un rappel individuel, une
    file d'appels, un essai isolé : ils appellent le simulateur sans consigne
    de campagne, et leurs issues de repli (`ISSUES_DEFAUT`) attendent bien une
    date sur « oui ». Changer cela aurait débordé de la demande.
    """
    issues = getattr(consigne, "issues", None) or {}
    return (issues.get(cle) or {}).get("date", "obligatoire") != "vide"


def _formater(horaire, langue_code="fr"):
    """« le mardi 25 août 2026 à 9 heures » — la forme DITE au téléphone.

    ⚠ DEUX EMPLOIS, ET LES DEUX VEULENT CETTE FORME (24/08/2026) : la consigne
    de repli (un rappel hors campagne, où aucune campagne n'a construit de
    consigne) et les transcriptions de la SIMULATION. La simulation doit
    ressembler au réel jusque dans la façon de dire une date : sinon l'écran
    d'une campagne simulée ne montre pas ce qu'un vrai appel produirait.

    ⚠ L'ANNÉE Y EST, alors qu'elle n'y était pas (« le 24/08 à 10h20 »). Une
    date sans année dite au téléphone en décembre pour un rendez-vous de
    janvier est ambiguë — et personne ne s'en aperçoit avant que quelqu'un se
    présente onze mois trop tôt.
    """
    iso = horaire.isoformat(timespec="minutes")
    # ⚠ ET L'ARTICLE CHANGE AVEC LA LANGUE : « on Monday 24 August », jamais
    # « le Monday ». Même règle que `horaires._en_toutes_lettres`.
    if langue_code == "en":
        return f"on {themes.date_parlee(iso, 'en')}"
    return f"le {themes.date_parlee(iso)}"


def _issue_forcee(telephone):
    """Issue déterministe dérivée des deux derniers chiffres du numéro.

    Rend le nom de l'issue exigée — ou None si le numéro n'est pas dans la
    plage réservée (51 à 59) : dans ce cas la simulation suit la liste de cas
    de figure de la campagne (voir SUITES_PAR_NATURE).
    """
    chiffres = re.sub(r"\D", "", telephone or "")
    return TERMINAISONS_FORCEES.get(chiffres[-2:])


def _date_deplacee(reference):
    """Date de report déterministe : deux jours plus tard, à 9 h 30."""
    return (reference + datetime.timedelta(days=2)).replace(hour=9, minute=30)


def _creneau_propose(rendezvous):
    """La place que l'agent PROPOSE, et le rendez-vous dont on lui parle.

    Rend (horaire de référence, place proposée). Trois cas, dans cet ordre :

    - « place_proposee » : l'appelant a DÉJÀ choisi la place, prise dans les
      places réellement libres de l'agenda (horaires.places_a_proposer).
      C'est le cas du rappel d'un rendez-vous MANQUÉ : on parle au client du
      rendez-vous qu'il a manqué (l'horaire de référence), et on lui propose
      une place qui existe vraiment — jamais une date obtenue par formule ;
    - « place_a_pourvoir » : la référence EST elle-même une place libre de
      l'agenda (la première de celles que le message annonce) — l'agent
      propose CETTE place, telle quelle. C'est le cas des natures de
      campagne sans rendez-vous par contact ;
    - sinon (essais isolés, planificateur sans réglages) : le créneau de
      rattrapage standard, une semaine après la référence. Ce dernier
      chemin ne garantit RIEN sur la disponibilité — il ne subsiste que là
      où le produit n'a aucun réglage pour calculer mieux.
    """
    horaire = datetime.datetime.fromisoformat(rendezvous["horaire"])
    place = _valeur(rendezvous, "place_proposee")
    if place:
        return horaire, datetime.datetime.fromisoformat(place)
    if _valeur(rendezvous, "place_a_pourvoir"):
        return horaire, horaire
    return horaire, horaire + datetime.timedelta(days=RATTRAPAGE_JOURS)


def _valeur(rendezvous, clef):
    """La valeur de cette clé si le rendez-vous en porte une, sinon None.

    Un rendez-vous venu de la base (dict) comme un support d'appel construit
    par une campagne passent tous les deux par ici sans lever.
    """
    try:
        return rendezvous[clef] or None
    except (KeyError, IndexError, TypeError):
        return None


_NOTES = {
    "confirmed": "Le client accepte le créneau de remplacement proposé.",
    "rescheduled": "Le client demande un autre créneau ; nouvelle date convenue.",
    "canceled": "Le client préfère annuler et rappellera lui-même.",
    "to_reschedule": "Le client veut déplacer mais ne peut pas fixer de date "
                     "aujourd'hui : à relancer.",
}

_NOTES_CASCADE = {
    "accepted": "La personne accepte le créneau libéré : il lui est attribué.",
    "refused": "La personne décline la proposition.",
    "moved": "La personne est intéressée mais demande une autre date ; date convenue.",
    "to_reschedule": "La personne veut autre chose mais rien n'est convenu : "
                     "un humain doit la rappeler.",
}


# ---------------------------------------------------------------------------
# CE QUE LA SIMULATION FAIT SORTIR — la suite des issues
# ---------------------------------------------------------------------------
# Demande du propriétaire (10/08/2026) : « en mode simulation, lorsqu'on
# exécute les campagnes, on a surtout des réponses attendues selon les
# campagnes, mais aussi un peu de chaque autre réponse que l'on peut produire.
# C'est important pour les tests. »
#
# ⚠ CE QUI MANQUAIT. Le tirage ne portait que sur TROIS issues sur quatre, à
# poids voisins : « veut autre chose, rien de convenu » (to_reschedule) ne
# sortait JAMAIS, et « ne décroche pas » non plus — les deux ne s'obtenaient
# qu'en composant un numéro terminé par 55 ou 53. Une campagne simulée ne
# montrait donc pas deux des chemins que le produit sait traiter, et c'est
# justement sur ceux-là qu'un défaut se cache.
#
# ⚠ UNE SUITE ÉCRITE, PAS UN TIRAGE AU SORT. C'est LE point de la demande —
# « c'est important pour les tests ». Un tirage, même à poids réglés, donne un
# nombre d'échecs qui change d'une exécution à l'autre : un contrôle qui compte
# les injoignables devient alors instable sans que rien n'ait bougé dans le
# produit. La suite ci-dessous rend le mélange EXACT et REPRODUCTIBLE : vingt
# appels donnent toujours les mêmes vingt issues, dans le même ordre.
#
# ⚠ L'ATTENDUE DOMINE, ET LES AUTRES ARRIVENT TÔT. L'issue attendue occupe
# treize places sur vingt : une campagne dont la moitié des appels échouerait
# ne ressemblerait pas au réel. Mais la première issue « autre » tombe au
# 3ᵉ appel, pas au 15ᵉ : une petite campagne de cinq personnes doit déjà
# montrer autre chose qu'une rangée de oui.
#
# ⚠ LES TERMINAISONS FORCÉES PRIMENT TOUJOURS (51 à 56). Elles sont le seul
# moyen d'exiger UNE issue précise dans une démonstration ou un contrôle, et le
# banc d'essai ne tient que par elles.
PAS_DE_REPONSE = "pas_de_reponse"   # pas un statut de résultat : une exception
# Le suffixe qui marque, DANS la suite écrite, l'appel où la personne demande
# aussi qu'on ne la rappelle plus. Un suffixe plutôt qu'une seconde suite : le
# 🚫 accompagne une issue, il ne la remplace pas — c'est exactement ce que dit
# CHAMP_NE_PLUS_APPELER.
SUFFIXE_STOP = "+stop"
# Même principe pour le 🔇 : « je refuse, et ne me proposez plus de place ».
# Il n'existe QUE sur le chemin de la cascade — CHAMP_AUTRES_PLACES n'est
# déclaré que dans SCHEMA_RESULTAT_CASCADE, et n'est rempli qu'après un refus.
SUFFIXE_SANS_PROPOSITION = "+sansproposition"

# Le rappel classique : l'attendu est « la personne accepte le créneau ».
SUITE_RAPPEL = (
    "confirmed", "confirmed", "canceled", "confirmed", "rescheduled",
    "confirmed", "confirmed", "to_reschedule", "confirmed", "canceled",
    "confirmed", "confirmed", PAS_DE_REPONSE, "confirmed", "rescheduled",
    "confirmed", "confirmed", "canceled" + SUFFIXE_STOP, "confirmed",
    "confirmed",
)
# La cascade : l'attendu est « la personne prend la place libérée ».
SUITE_CASCADE = (
    "accepted", "accepted", "refused", "accepted", "moved",
    "accepted", "accepted", "to_reschedule", "accepted", "refused",
    "accepted", "accepted", PAS_DE_REPONSE, "accepted", "moved",
    "accepted", "accepted", "refused" + SUFFIXE_STOP, "accepted",
    "accepted",
)

# ─────────────────────────────────────────────────────────────────────────────
# TOUS LES CAS DE FIGURE, SELON LA NATURE DE LA CAMPAGNE (11/08/2026)
#
# Demande du propriétaire : « en mode simulation, selon le type de campagne, on
# génère tout les cas de figure possible pour que je puisse tester en théorie le
# comportement de tout ces résultats ». Les deux suites ci-dessus ne le
# faisaient pas : l'attendu y occupe treize places sur vingt, et une campagne de
# cinq personnes n'en montrait donc que deux ou trois.
#
# ⚠ POURQUOI CE N'ÉTAIT PAS QU'UNE QUESTION DE PROPORTIONS. Sur une campagne
# « premier oui » (créneau libéré, déplacement), l'issue qui ABOUTIT arrête la
# campagne : SUITE_CASCADE commence par « accepted », donc le premier appel
# pourvoyait la place et les dix-neuf autres cas ne partaient jamais. Aucun
# réglage de poids n'aurait pu régler cela — c'est l'ORDRE qui compte.
#
# D'où trois parties par nature :
#   · « tour »      : un exemplaire de chaque cas qui n'arrête PAS la campagne ;
#   · « concluants » : ceux qui la concluent (un OUI sur « premier oui ») —
#                      toujours joués EN DERNIER, sinon ils coupent le tour ;
#   · « ensuite »   : au-delà du tour, l'attendu domine — une campagne de
#                      cinquante personnes ne doit pas ressembler à un
#                      catalogue de pannes.
#
# ⚠ LE TOUR EST TAILLÉ À LA CAMPAGNE (voir AppelSimule.recommencer_les_cas).
# Cinq contacts et sept cas : on ne joue que quatre cas du tour, puis le
# concluant — la place est pourvue, comme il faut — et la campagne SUIVANTE
# reprend le tour là où celle-ci l'a laissé. En deux campagnes de cinq, les sept
# cas sont passés.
#
# ⚠ « RÉPONSE ILLISIBLE » N'EST PAS DANS CES LISTES, EXPRÈS. Elle ne produit
# pas un résultat mais une exception (ResultatInvalide), et executer_campagne
# met alors la campagne EN PAUSE : la placer dans le tour arrêterait toute
# campagne simulée au même appel. Elle s'obtient à la demande, par un numéro
# terminé par 59 (voir TERMINAISONS_FORCEES).
#
# ⚠ LES TERMINAISONS FORCÉES PRIMENT TOUJOURS SUR CES LISTES. Un numéro en 51 à
# 59 exige SON issue, quelle que soit la nature de la campagne.
_STOP = SUFFIXE_STOP
_MUET = SUFFIXE_SANS_PROPOSITION
SUITES_PAR_NATURE = {
    # Une place s'est libérée, on cherche un preneur. Seul « accepted » pourvoit
    # la place ; « moved » crée un rendez-vous à une AUTRE date et la place
    # reste donc à pourvoir (voir assistant, branche « moved »).
    "creneau_libere": {
        "chemin": "cascade",
        "tour": ("refused", "to_reschedule", "moved", PAS_DE_REPONSE,
                 "refused" + _STOP, "refused" + _MUET),
        "concluants": ("accepted",),
        "ensuite": ("accepted", "accepted", "refused", "accepted", "accepted",
                    "moved", "accepted", "accepted", "to_reschedule",
                    "accepted"),
    },
    # Je dois déplacer des rendez-vous. DEUX issues concluent : « confirmed »
    # (la personne prend le créneau proposé) et « rescheduled » (elle en veut un
    # autre, mais elle bouge). Sur « premier oui » une seule des deux peut
    # partir par campagne — d'où la rotation, qui montre l'autre à la campagne
    # suivante.
    "deplacement": {
        "chemin": "rappel",
        # ⚠ LE PREMIER APPEL ABOUTIT (16/08/2026, sa demande) : « pour les
        # campagnes de déplacement de rendez-vous et de prise de rendez-vous,
        # j'aimerais que le premier élément en simulation uniquement soit
        # positif (rendez-vous accepté) ».
        #
        # Le tour commence par les cas qui n'aboutissent PAS — c'est ce qui
        # permet de tous les voir. Mais quand on montre le produit, le premier
        # appel donnait « annulé » : on découvrait la mécanique par un échec,
        # et il fallait attendre le cinquième appel pour voir un rendez-vous se
        # poser. Ces deux natures-là POSENT une date : c'est leur but, et c'est
        # ce que le premier appel doit montrer.
        #
        # Rien n'est perdu : le tour reprend juste après, et le curseur de la
        # campagne suivante repart où celle-ci l'a laissé.
        "premier": ("confirmed",),
        "tour": ("canceled", "to_reschedule", PAS_DE_REPONSE,
                 "canceled" + _STOP),
        "concluants": ("confirmed", "rescheduled"),
        "ensuite": ("confirmed", "confirmed", "rescheduled", "confirmed",
                    "canceled", "confirmed", "confirmed", "to_reschedule",
                    "confirmed", "confirmed"),
    },
    # Rappel d'un rendez-vous à venir : toute la liste est appelée, rien
    # n'arrête la campagne — le tour passe donc en entier dès la première.
    "rappel_rdv": {
        "chemin": "rappel",
        "tour": ("canceled", "rescheduled", "to_reschedule", PAS_DE_REPONSE,
                 "canceled" + _STOP),
        "concluants": ("confirmed",),
        "ensuite": ("confirmed", "confirmed", "canceled", "confirmed",
                    "confirmed", "rescheduled", "confirmed", "confirmed",
                    "to_reschedule", "confirmed"),
    },
    # Confirmation de présence : mêmes issues que le rappel, même politique.
    "confirmation": {
        "chemin": "rappel",
        "tour": ("canceled", "rescheduled", "to_reschedule", PAS_DE_REPONSE,
                 "canceled" + _STOP),
        "concluants": ("confirmed",),
        "ensuite": ("confirmed", "confirmed", "canceled", "confirmed",
                    "confirmed", "to_reschedule", "confirmed", "confirmed",
                    "rescheduled", "confirmed"),
    },
    # Prise de rendez-vous : il n'y a pas de rendez-vous au départ.
    # « confirmed » et « rescheduled » en créent un, « canceled » est un
    # « non merci », « to_reschedule » un « rappelez-moi ».
    "prise_rdv": {
        "chemin": "rappel",
        # ⚠ MÊME RÈGLE QUE LE DÉPLACEMENT (16/08/2026, sa demande) : le premier
        # appel POSE un rendez-vous. Voir le pavé de « deplacement ».
        "premier": ("confirmed",),
        "tour": ("canceled", "rescheduled", "to_reschedule", PAS_DE_REPONSE,
                 "canceled" + _STOP),
        "concluants": ("confirmed",),
        "ensuite": ("confirmed", "confirmed", "canceled", "confirmed",
                    "rescheduled", "confirmed", "confirmed", "canceled",
                    "confirmed", "to_reschedule"),
    },
}


def cas_de_la_nature(nature):
    """Les cas de figure simulés d'une nature de campagne (None si inconnue).

    Ouverte pour les contrôles et pour l'écran : c'est la SEULE liste de ce que
    la simulation sait produire pour une nature donnée.
    """
    return SUITES_PAR_NATURE.get(nature)


def issues_simulees(nature):
    """Toutes les issues distinctes qu'une campagne de cette nature peut voir.

    Rend la liste des marqueurs bruts (suffixes compris), tour puis concluants,
    dans l'ordre où ils partent. Sert au contrôle de cliquet : si une issue est
    ajoutée au schéma sans être jouée nulle part, il le dit.
    """
    cas = SUITES_PAR_NATURE.get(nature)
    if not cas:
        return []
    return list(cas["tour"]) + list(cas["concluants"])


class AppelSimule(ClientAppels):
    """Génère une conversation plausible sans jamais toucher au réseau."""

    def __init__(self, graine=None, latence=0.4):
        self.alea = random.Random(graine)
        self.latence = latence  # secondes, imite la numérotation
        self._deja_appeles = {}  # chiffres du numéro -> nb d'appels (pour « 56 »)
        # Où l'on en est dans chaque suite d'issues. Deux compteurs, un par
        # chemin : une campagne de cascade doit commencer par son attendu à
        # elle, pas reprendre là où un rappel s'était arrêté.
        self._rangs = {"rappel": 0, "cascade": 0}
        # Le plan de la campagne EN COURS, par nature : la liste des cas de
        # figure taillée à sa taille par recommencer_les_cas. Une entrée par
        # nature, pas une seule : deux campagnes de natures différentes lancées
        # en même temps ne doivent pas se marcher dessus.
        self._plans = {}          # nature -> liste des cas de cette campagne
        self._rangs_plan = {}     # nature -> où l'on en est dans ce plan
        # Où reprendre le tour à la campagne SUIVANTE de cette nature. C'est ce
        # curseur qui fait qu'une campagne de cinq personnes finit par montrer
        # les sept cas, en deux passages au lieu d'un.
        self._curseurs = {}       # nature -> rang du prochain cas du tour
        self._tours_faits = {}    # nature -> nb de campagnes déjà jouées

    def recommencer_les_cas(self, nature, nombre_de_contacts=None):
        """Prépare la liste des cas de figure de la campagne qui démarre.

        Appelée UNE FOIS par lancement de campagne (executer_campagne). Elle
        taille la liste à la campagne :

        · les cas qui ne concluent pas d'abord, pris à partir du curseur laissé
          par la campagne précédente de cette nature ;
        · le ou les cas concluants EN DERNIER — sur une campagne « premier oui »
          ils l'arrêtent, ils ne peuvent donc pas passer avant les autres ;
        · quand il y a plus de contacts que de cas, l'attendu prend le relais.

        `nombre_de_contacts` inconnu (None) = on suppose que tout tient.

        Sans nature connue, rien n'est préparé : les appels retombent sur les
        suites génériques SUITE_RAPPEL / SUITE_CASCADE (file d'appels, rappel
        individuel, essai en conditions réelles).
        """
        cas = SUITES_PAR_NATURE.get(nature)
        if not cas:
            return
        # Le cas IMPOSÉ AU PREMIER APPEL, quand la nature en déclare un : il
        # passe avant tout le reste, et il consomme donc une place.
        premier = list(cas.get("premier", ()))
        tour = list(cas["tour"])
        concluants = list(cas["concluants"])
        # Les concluants tournent d'un cran par campagne. Sur « déplacement »,
        # DEUX issues concluent et une seule peut partir : sans cette rotation,
        # « rescheduled » ne serait jamais joué.
        fait = self._tours_faits.get(nature, 0)
        self._tours_faits[nature] = fait + 1
        if concluants:
            decalage = fait % len(concluants)
            concluants = concluants[decalage:] + concluants[:decalage]
        # Combien de cas du tour tiennent avant les concluants.
        if nombre_de_contacts is None:
            place = len(tour)
        else:
            # ⚠ LE PREMIER IMPOSÉ COMPTE DANS LE BUDGET. Sans ce terme, une
            # campagne de cinq contacts préparait un plan de six : le dernier
            # cas concluant tombait hors liste et la place n'était jamais
            # pourvue — exactement le défaut que « place » existe pour éviter.
            place = max(0, min(len(tour), nombre_de_contacts - len(concluants)
                               - len(premier)))
        depart = self._curseurs.get(nature, 0) % len(tour) if tour else 0
        retenus = [tour[(depart + i) % len(tour)] for i in range(place)]
        self._curseurs[nature] = depart + place
        suite = retenus + concluants
        if premier:
            # ⚠ APRÈS LE SUCCÈS IMPOSÉ, TOUT LE RESTE EST MÉLANGÉ (16/08/2026,
            # sa précision) : « je veux que tu commences avec un succès et les
            # autres cas de figure après, dans un ordre aléatoire et en
            # intégrant également d'autres succès potentiels ».
            #
            # POURQUOI. Le but d'une simulation, dit par lui : « générer
            # différentes réponses possibles pour que je puisse vérifier les
            # impacts dans RingBack ». Un ordre figé donnait toujours la même
            # séquence — on finissait par la connaître par cœur au lieu de
            # l'éprouver. Le mélange emporte AUSSI la queue « ensuite », riche
            # en réussites : d'autres succès se glissent donc parmi les refus,
            # ce qu'un plan en trois blocs ne pouvait pas produire.
            #
            # ⚠ ET IL RESTE REPRODUCTIBLE : `self.alea` est semé (voir
            # `graine`). Deux exécutions du banc avec la même graine rendent le
            # même ordre — c'est ce qui garde son rapport identique à l'octet.
            #
            # ⚠ MAIS LE MÉLANGE NE DOIT PAS ENTERRER LES CAS (17/08/2026).
            # MESURÉ : sur une campagne de onze contacts, le plan mélangé
            # faisait dix-sept entrées ; les quatre cas qui n'aboutissent pas
            # sont tombés au-delà du onzième et n'ont JAMAIS été joués. Onze
            # appels, deux issues seulement — alors qu'il demande de voir
            # « accepté, à rappeler par un humain, à recontacter, injoignable ».
            #
            # On mélange donc DANS LA FENÊTRE réellement appelée : les cas qui
            # doivent apparaître, complétés par la queue « ensuite » jusqu'à
            # remplir cette fenêtre. Le surplus reste derrière, pour une
            # campagne qui irait plus loin que prévu. L'ordre est aléatoire et
            # d'autres succès s'y glissent — ce qu'il a demandé — mais aucun cas
            # ne se perd hors du champ.
            reste = list(cas["ensuite"])
            if nombre_de_contacts is None:
                fenetre = suite + reste
                surplus = []
            else:
                large = max(len(suite), nombre_de_contacts - len(premier))
                fenetre = suite + reste[:max(0, large - len(suite))]
                surplus = reste[max(0, large - len(suite)):]
            self.alea.shuffle(fenetre)
            self._plans[nature] = premier + fenetre + surplus
        else:
            # Les autres natures ne changent pas : les cas qui n'aboutissent
            # PAS d'abord, les concluants ensuite. Sur « créneau libéré », un
            # oui pourvoit la place et arrête tout — les mélanger masquerait
            # tous les autres cas dès le premier appel.
            self._plans[nature] = suite + list(cas["ensuite"])
        self._rangs_plan[nature] = 0

    def _suivante(self, chemin, suite):
        """L'issue suivante de la suite — voir le pavé au-dessus de SUITE_RAPPEL.

        Le compteur vit sur l'INSTANCE : deux campagnes lancées de suite ne
        rejouent donc pas la même série d'issues, mais une instance neuve
        repart toujours du début. C'est ce qui rend un contrôle reproductible.
        """
        rang = self._rangs[chemin]
        self._rangs[chemin] = rang + 1
        return suite[rang % len(suite)]

    def _cas_du_plan(self, nature):
        """Le cas suivant du plan de cette nature, ou None s'il n'y en a pas.

        Le plan s'épuise en bouclant sur son dernier tiers (« ensuite ») :
        une campagne plus longue que prévu continue de sonner juste au lieu de
        rejouer la panne de son premier appel.
        """
        plan = self._plans.get(nature)
        if not plan:
            return None
        rang = self._rangs_plan.get(nature, 0)
        self._rangs_plan[nature] = rang + 1
        if rang < len(plan):
            return plan[rang]
        ensuite = SUITES_PAR_NATURE[nature]["ensuite"]
        return ensuite[(rang - len(plan)) % len(ensuite)]

    def _resoudre_force(self, telephone):
        """L'issue forcée du numéro, en résolvant les terminaisons à mémoire.

        « 56 » : la PREMIÈRE tentative de cette instance ne décroche pas,
        les suivantes acceptent — le déroulé exact d'une relance qui aboutit.

        « 57 » : elle refuse ET demande qu'on ne la rappelle plus. Rendu comme
        « refuse » ; le 🚫 voyage à part (voir _stop_force), parce qu'il
        accompagne une issue au lieu de la remplacer.
        """
        force = _issue_forcee(telephone)
        if force == "puis_accepte":
            chiffres = re.sub(r"\D", "", telephone or "")
            vues = self._deja_appeles.get(chiffres, 0)
            self._deja_appeles[chiffres] = vues + 1
            return "pas_de_reponse" if vues == 0 else "accepte"
        if force in ("refuse_et_stop", "refuse_sans_proposition"):
            return "refuse"
        return force

    @staticmethod
    def _sans_proposition_force(telephone):
        """Cette terminaison refuse-t-elle aussi les prochaines places ? (« 58 »)"""
        return _issue_forcee(telephone) == "refuse_sans_proposition"

    @staticmethod
    def _stop_force(telephone):
        """Cette terminaison demande-t-elle aussi le 🚫 ? (« 57 »)"""
        return _issue_forcee(telephone) == "refuse_et_stop"

    def _cas_suivant(self, chemin, suite, nature=None):
        """Le cas suivant : (issue, 🚫 demandé, 🔇 demandé).

        Le plan de la nature passe d'abord ; sans nature connue, la suite
        générique. Les suffixes « +stop » et « +sansproposition » marquent, DANS
        la liste écrite, l'appel où la personne demande en plus qu'on ne la
        rappelle plus (SUFFIXE_STOP) ou qu'on ne lui propose plus de place
        (SUFFIXE_SANS_PROPOSITION). Un suffixe accompagne une issue, il ne la
        remplace pas — exactement comme les champs qu'il représente.
        """
        brute = self._cas_du_plan(nature)
        if brute is None:
            brute = self._suivante(chemin, suite)
        return (brute.split("+")[0],
                SUFFIXE_STOP in brute,
                SUFFIXE_SANS_PROPOSITION in brute)

    @staticmethod
    def _repondre_illisible(nom_client):
        """La terminaison « 59 » : la conversation a eu lieu, la réponse non.

        Le SEUL cas de figure que la simulation ne joue pas d'elle-même dans une
        campagne (voir le pavé au-dessus de SUITES_PAR_NATURE) : il ne rend pas
        un résultat mais une exception, et executer_campagne met alors la
        campagne en pause. Il s'obtient donc à la demande, sur un numéro — de
        quoi vérifier le chemin « 🙋 à rappeler par un humain » sans casser une
        campagne entière.

        La réponse brute imite ce que CALL-E rend quand l'agent n'a pas su
        conclure : le champ d'issue vide. Le texte de la conversation, lui,
        existe — et c'est justement ce qu'il ne faut pas jeter.
        """
        raise ResultatInvalide(
            "l'agent n'a rendu aucune issue (champ vide)",
            reponse_brute='{"outcome": "", "notes": "unclear"}',
            transcription="\n".join((
                f"Agent : Bonjour {nom_client}, je vous appelle au sujet de "
                "votre rendez-vous.",
                "Contact : … (bruit de fond, la personne parle à quelqu'un "
                "d'autre)",
                "Agent : Je n'ai malheureusement pas bien compris votre "
                "réponse. Je préfère qu'un collègue vous rappelle — rien "
                "n'est changé de votre côté.",
            )))

    def appeler(self, nom_client, telephone, rendezvous, mission=None,
                consigne=None, nature=None):
        # La consigne en trois parties n'a de destinataire que chez CALL-E :
        # la simulation ne parle à personne, elle rejoue une conversation
        # scriptée. On l'accepte donc sans s'en servir — plutôt que de mimer
        # un agent qui l'aurait lue.
        journal.info("Appel SIMULÉ vers %s (%s)", masquer_telephone(telephone), nom_client)
        if self.latence:
            time.sleep(self.latence)
        horaire, propose = _creneau_propose(rendezvous)
        force = self._resoudre_force(telephone)
        # UNE SEULE DÉCISION, ICI : la terminaison forcée si le numéro en porte
        # une, sinon le plan de la nature — à défaut la suite générique (voir le
        # pavé au-dessus de SUITES_PAR_NATURE).
        # Le 🚫 voyage À CÔTÉ de l'issue, jamais à sa place.
        if force == "reponse_illisible":
            self._repondre_illisible(nom_client)
        if force is None:
            statut, stop, _muet = self._cas_suivant("rappel", SUITE_RAPPEL,
                                                    nature)
        else:
            statut = {"accepte": "confirmed", "refuse": "canceled",
                      "deplace": "rescheduled",
                      "deplace_non_conclu": "to_reschedule",
                      "pas_de_reponse": PAS_DE_REPONSE}[force]
            stop = self._stop_force(telephone)
        if statut == PAS_DE_REPONSE:
            raise PasDeReponse("aucune réponse après plusieurs sonneries (simulation)")
        if statut == "confirmed":
            # ⚠ LE SIMULATEUR RÉPOND COMME L'AGENT RÉEL RÉPONDRAIT (24/08/2026).
            # Il posait une date sur « confirmed » quoi qu'il arrive. Or deux
            # natures dictent l'inverse — « rends confirmed et laisse
            # new_datetime VIDE » — et la simulation ne jouait donc jamais la
            # réponse qu'elle demande. C'est ainsi qu'un défaut bloquant a
            # traversé des centaines de campagnes simulées sans se voir.
            #
            # La consigne reçue porte le contrat, écrit noir sur blanc :
            # `issues["oui"]["date"]` vaut « vide », « facultative » ou
            # « obligatoire ». On le lit, plutôt que de deviner par la nature.
            convenu = propose if _date_attendue(consigne, "oui") else None
        elif statut == "rescheduled":
            # ⚠ UNE AUTRE DATE, MAIS UNE VRAIE (16/08/2026). L'appelant fournit
            # une SECONDE place réellement libre quand il en connaît une : on la
            # prend. Sans elle seulement, on retombe sur la date tirée au sort —
            # qui n'a aucune chance d'être libre, et faisait repartir le contact
            # « 🙋 à rappeler par un humain » après un « Déplacé (date convenue) ».
            autre = _valeur(rendezvous, "place_alternative")
            if autre:
                convenu = datetime.datetime.fromisoformat(autre)
            elif force == "deplace":  # date déterministe pour les tests
                convenu = _date_deplacee(horaire)
            else:
                convenu = (horaire + datetime.timedelta(days=self.alea.randint(1, 10))).replace(
                    hour=self.alea.randint(8, 18), minute=self.alea.choice((0, 15, 30, 45)))
        else:
            convenu = None
        resultat = {
            "appointment_status": statut,
            "new_datetime": convenu.isoformat(timespec="minutes") if convenu else None,
            "notes": _NOTES[statut],
            CHAMP_NE_PLUS_APPELER: "yes" if stop else "no",
        }
        if stop:
            resultat["notes"] += " Elle demande à ne plus être appelée."
        valider_resultat(resultat)  # garantie interne : jamais de résultat hors schéma
        transcription = self._transcription(statut, nom_client, rendezvous["motif"],
                                            propose, convenu, mission)
        return IssueAppel(resultat, transcription)

    def appeler_cascade(self, nom_client, telephone, mission, creneau,
                        consigne=None, nature=None):
        """Appel de cascade simulé : propose le créneau, note la réponse.

        Même convention déterministe que le rappel classique : la
        terminaison du numéro (51 à 59) force l'issue ; sinon, le plan de cas
        de figure de la nature, à défaut la suite générique.
        """
        journal.info("Appel cascade SIMULÉ vers %s (%s)",
                     masquer_telephone(telephone), nom_client)
        if self.latence:
            time.sleep(self.latence)
        force = self._resoudre_force(telephone)
        creneau_dt = datetime.datetime.fromisoformat(creneau)
        # Même règle que le rappel classique : la terminaison forcée, sinon la
        # liste écrite. « Veut déplacer sans conclure » (55) rend
        # « to_reschedule » ICI AUSSI : avant le 02/08/2026 la cascade n'avait
        # pas cette issue et le simulateur rabattait le cas sur un refus — elle
        # racontait donc un refus là où le réel rend « rien n'est convenu ».
        if force == "reponse_illisible":
            self._repondre_illisible(nom_client)
        if force is None:
            issue, stop, muet = self._cas_suivant("cascade", SUITE_CASCADE,
                                                  nature)
        else:
            issue = {"accepte": "accepted", "refuse": "refused",
                     "deplace": "moved",
                     "deplace_non_conclu": "to_reschedule",
                     "pas_de_reponse": PAS_DE_REPONSE}[force]
            stop = self._stop_force(telephone)
            muet = self._sans_proposition_force(telephone)
        if issue == PAS_DE_REPONSE:
            raise PasDeReponse("aucune réponse après plusieurs sonneries (simulation)")
        if issue == "moved":
            convenu = (_date_deplacee(creneau_dt) if force
                       else (creneau_dt + datetime.timedelta(
                           days=self.alea.randint(1, 10))).replace(
                           hour=self.alea.randint(8, 18),
                           minute=self.alea.choice((0, 15, 30, 45))))
        else:
            convenu = None
        resultat = {
            "outcome": issue,
            "new_datetime": convenu.isoformat(timespec="minutes") if convenu else None,
            "notes": _NOTES_CASCADE[issue],
            CHAMP_NE_PLUS_APPELER: "yes" if stop else "no",
        }
        # La question ne se pose qu'après un refus : ailleurs, le champ reste
        # absent — comme le demande sa description. Le 🔇 vient soit de la
        # terminaison 58, soit du marqueur « +sansproposition » de la liste.
        if issue == "refused":
            resultat[CHAMP_AUTRES_PLACES] = "no" if muet else "yes"
        if stop:
            resultat["notes"] += " Elle demande à ne plus être appelée."
        valider_resultat_cascade(resultat)  # jamais de résultat hors schéma
        transcription = self._transcription_cascade(issue, mission, creneau_dt, convenu)
        return IssueAppel(resultat, transcription)

    @staticmethod
    def _transcription_cascade(issue, mission, creneau_dt, convenu):
        lignes = [f"Agent : {mission}"]
        if issue == "accepted":
            lignes += [
                f"Contact : Oh, {_formater(creneau_dt)} ? Oui, ça tombe bien, je le prends !",
                "Agent : Parfait, le créneau est pour vous. À bientôt !",
            ]
        elif issue == "moved":
            lignes += [
                f"Contact : Pas {_formater(creneau_dt)}… mais {_formater(convenu)}, ce serait possible ?",
                f"Agent : Bien sûr, je note {_formater(convenu)}. C'est enregistré, merci !",
            ]
        elif issue == "to_reschedule":
            lignes += [
                "Contact : Attendez, je ne peux pas vous dire là, il faut que "
                "je regarde. Vous pouvez me rappeler ?",
                "Agent : Bien sûr, je transmets votre demande. Bonne journée !",
            ]
        else:
            lignes += [
                "Contact : Merci d'avoir pensé à moi, mais ça ne m'arrange pas. Bonne journée !",
                "Agent : Très bien, merci pour votre réponse. Bonne journée !",
            ]
        return "\n".join(lignes)

    @staticmethod
    def _transcription(statut, nom, motif, propose, convenu, mission=None):
        if mission:
            # Mission choisie au lancement (thème d'appel) : l'agent la lit
            # telle quelle — c'est bien le texte validé à l'écran.
            lignes = [f"Agent : {mission}"]
        else:
            lignes = [
                f"Agent : Bonjour {nom}, ici l'assistant automatique du cabinet. "
                f"Nous ne vous avons pas vu pour « {motif} ». "
                f"Je peux vous proposer un nouveau créneau {_formater(propose)} — cela vous convient-il ?"
            ]
        if statut == "confirmed":
            lignes += [
                f"Contact : Ah oui, désolé, j'ai eu un empêchement. {_formater(propose).capitalize()}, c'est parfait.",
                "Agent : C'est noté, votre rendez-vous est confirmé. À bientôt !",
            ]
        elif statut == "rescheduled":
            lignes += [
                f"Contact : Ce créneau ne m'arrange pas… plutôt {_formater(convenu)}, ce serait possible ?",
                f"Agent : Bien sûr, je note {_formater(convenu)}. C'est enregistré, merci !",
            ]
        elif statut == "to_reschedule":
            lignes += [
                "Contact : Il faudra déplacer, mais je n'ai pas mon agenda sous "
                "les yeux… Vous pouvez me rappeler plus tard ?",
                "Agent : Bien sûr, nous vous rappellerons. Bonne journée !",
            ]
        else:
            lignes += [
                "Contact : En fait, je préfère annuler pour le moment. Je rappellerai moi-même.",
                "Agent : Très bien, c'est noté. Bonne journée !",
            ]
        return "\n".join(lignes)


def numero_e164(telephone):
    """« 06 39 98 00 24 » ou « +33 6 39 98 00 24 » → « +33639980024 ».

    L'API CALL-E attend la forme internationale COMPACTE (norme E.164) :
    un « + », l'indicatif du pays, puis les chiffres, sans espace. RingBack,
    lui, enregistre les numéros en groupes lisibles pour que le masquage à
    l'écran fonctionne — les deux besoins sont légitimes, la conversion se
    fait donc ici, au dernier moment, juste avant l'envoi.

    Constaté le 01/08/2026 : envoyer le numéro espacé faisait répondre 422
    à l'API, sans qu'aucun téléphone ne sonne.
    """
    compact = re.sub(r"[^\d+]", "", telephone or "")
    if compact.startswith("+"):
        return compact
    if compact.startswith("0") and len(compact) == 10:
        return "+33" + compact[1:]          # forme nationale française
    return compact


def numero_composable(telephone):
    """Ce numéro a-t-il la forme d'un numéro que l'API saurait composer ?

    Volontairement LARGE : un « + », un indicatif, et au moins dix chiffres.
    Elle ne vérifie pas qu'un numéro EXISTE — personne ne peut le faire sans
    appeler. Elle écarte ce qui n'est manifestement pas un numéro (une adresse
    collée, un nom, un champ à moitié tapé), et c'est tout ce qu'on lui demande.
    """
    compact = numero_e164(telephone)
    return (compact.startswith("+") and compact[1:].isdigit()
            and len(compact) >= 11)


# ---------------------------------------------------------------------------
# LE SCHÉMA PART DANS « recipient_result_schema », PAS DANS « result_schema »
# ---------------------------------------------------------------------------
# Les deux existent chez CALL-E et ne décrivent PAS la même chose :
# - result_schema           : le bilan GLOBAL de la campagne d'appels
#                             (« combien de personnes ont répondu oui ») ;
# - recipient_result_schema : le résultat D'UN destinataire, extrait
#                             indépendamment pour chacun.
# Ce que RingBack décrit (appointment_status / outcome, new_datetime, notes)
# est le résultat d'UNE personne : il part donc dans
# recipient_result_schema, et se relit dans recipients[].structured_result.
#
# LES DEUX SONT ENVOYÉS, comme dans l'exemple de la référence d'API du
# sponsor (« Create call ») qui les montre côte à côte. Le 02/08/2026,
# n'envoyer QUE recipient_result_schema a valu un 400 à la création : je
# l'avais retiré par raisonnement (« facultatif, personne ne lit le bilan
# global »), pas sur une observation. On revient donc à la forme documentée,
# littéralement. Le bilan global reste volontairement minuscule : RingBack ne
# le lit pas, il n'est là que parce que l'exemple de référence le porte.
#
# MOTS-CLÉS DE SCHÉMA ADMIS, d'après cette même référence : type, properties,
# required, enum, objets imbriqués, array.items simple, description,
# additionalProperties: false. Et RIEN d'autre — « minimum » n'y figure pas.
#
# NOMS DE CHAMPS INTERDITS : voir CHAMPS_RESERVES en tête de module. C'est
# ce qui a fait échouer le 7ᵉ essai réel du propriétaire, le 02/08/2026 :
# « recipient_result_schema contains reserved field: duration_seconds ».
#
# Le schéma décrit ici : l'agent DOIT rendre exactement ces champs — les
# mêmes que ceux vérifiés localement par valider_resultat().
SCHEMA_RESULTAT = {
    "type": "object",
    "properties": {
        "appointment_status": {"type": "string", "enum": list(STATUTS_VALIDES)},
        # ⚠ UN SEUL type, jamais une liste : CALL-E a refusé le schéma le
        # 01/08/2026 — « unsupported JSON Schema type at $.properties.
        # new_datetime: ['string', 'null'] ». Pas de date convenue = chaîne
        # VIDE (valider_resultat la traite comme une absence de date).
        "new_datetime": {
            "type": "string",
            "description": "Nouveau créneau en ISO 8601 ; nul si le client "
                           "annule ou ne conclut pas de date (to_reschedule)."},
        "notes": {"type": "string",
                  "description": "Résumé de l'échange en une ou deux phrases."},
        # ⚠ HORS DE « required » (voir CHAMP_NE_PLUS_APPELER) : un résultat où
        # l'agent l'oublie reste valable, et vaut « no ».
        CHAMP_NE_PLUS_APPELER: {
            "type": "string", "enum": list(VALEURS_NE_PLUS_APPELER),
            "description": DESCRIPTION_NE_PLUS_APPELER},
    },
    "required": list(CHAMPS_OBLIGATOIRES),
    "additionalProperties": False,
}

# Schéma imposé aux appels de cascade « premier oui ».
SCHEMA_RESULTAT_CASCADE = {
    "type": "object",
    "properties": {
        "outcome": {"type": "string", "enum": list(ISSUES_CASCADE)},
        # ⚠ UN SEUL type, jamais une liste : CALL-E a refusé le schéma le
        # 01/08/2026 — « unsupported JSON Schema type at $.properties.
        # new_datetime: ['string', 'null'] ». Pas de date convenue = chaîne
        # VIDE (valider_resultat la traite comme une absence de date).
        "new_datetime": {
            "type": "string",
            "description": "Autre date souhaitée en ISO 8601 quand outcome vaut "
                           "« moved » ; nul sinon."},
        # ⚠ CASCADE SEULEMENT, et hors de « required » : la question ne se pose
        # qu'après un refus, et un résultat sans elle reste valable.
        CHAMP_AUTRES_PLACES: {
            "type": "string", "enum": list(VALEURS_AUTRES_PLACES),
            "description": DESCRIPTION_AUTRES_PLACES},
        "notes": {"type": "string",
                  "description": "Résumé de l'échange en une ou deux phrases."},
        # ⚠ HORS DE « required » (voir CHAMP_NE_PLUS_APPELER) : un résultat où
        # l'agent l'oublie reste valable, et vaut « no ».
        CHAMP_NE_PLUS_APPELER: {
            "type": "string", "enum": list(VALEURS_NE_PLUS_APPELER),
            "description": DESCRIPTION_NE_PLUS_APPELER},
    },
    "required": list(CHAMPS_CASCADE),
    "additionalProperties": False,
}

# LE BILAN GLOBAL — envoyé parce que l'exemple de référence l'envoie, pas
# parce que RingBack en a besoin. Un appel RingBack ne porte JAMAIS qu'un seul
# destinataire : le bilan global se réduit donc à « cette personne a-t-elle
# été jointe ». Rien ne le lit côté RingBack, et c'est écrit ici pour que
# personne n'aille chercher plus tard où ce champ est utilisé : nulle part.
SCHEMA_BILAN_GLOBAL = {
    "type": "object",
    "properties": {
        "reached_count": {
            "type": "integer",
            "description": "Nombre de personnes réellement jointes (0 ou 1)."},
    },
    "required": ["reached_count"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------------------
# LES DÉLAIS D'UN VRAI APPEL — réglables dans ⚙ Réglages
# ---------------------------------------------------------------------------
# Les valeurs d'origine (120 s d'attente, 15 s par requête) étaient celles
# d'une SIMULATION, où tout se conclut en une seconde. Une vraie conversation
# téléphonique ne tient pas dedans, et c'est ce qui a fait perdre l'appel du
# 01/08/2026. Les valeurs par défaut ci-dessous sont dimensionnées sur un vrai
# appel, et chacune se règle dans « ⚙ Réglages ».
#
# - attente totale, 10 minutes : sonnerie (jusqu'à ~1 min avant le répondeur)
#   + échange (2 à 5 min quand il faut convenir d'une autre date, chercher
#   son agenda, hésiter) + le temps que CALL-E rédige la transcription et le
#   résultat structuré. Dix minutes laissent de la marge sans jamais bloquer
#   la campagne indéfiniment ;
# - intervalle entre deux interrogations, 5 secondes : à 2 s on interrogeait
#   l'API 300 fois pour un seul appel ; à 5 s, 120 fois — et le résultat est
#   connu au plus tard 5 secondes après la fin de la conversation ;
# - délai d'UNE requête, 30 secondes : c'est CELUI qui a lâché (« The read
#   operation timed out » à 15 s). Une API sous charge peut mettre plusieurs
#   secondes à répondre ; 30 s laisse passer un hoquet sans figer l'écran.
CLE_DELAI_TOTAL = "appel_delai_total"          # secondes
CLE_DELAI_INTERVALLE = "appel_delai_intervalle"
CLE_DELAI_REQUETE = "appel_delai_requete"

DELAI_TOTAL_DEFAUT = 600.0
DELAI_INTERVALLE_DEFAUT = 5.0
DELAI_REQUETE_DEFAUT = 30.0

# Bornes de saisie : au-delà, ce n'est plus un réglage, c'est une panne.
BORNES_DELAIS = {
    CLE_DELAI_TOTAL: (60, 3600, "Attente maximale d'un appel"),
    CLE_DELAI_INTERVALLE: (1, 60, "Intervalle entre deux vérifications"),
    CLE_DELAI_REQUETE: (5, 120, "Délai d'attente d'une requête"),
}
DELAIS_DEFAUT = {
    CLE_DELAI_TOTAL: DELAI_TOTAL_DEFAUT,
    CLE_DELAI_INTERVALLE: DELAI_INTERVALLE_DEFAUT,
    CLE_DELAI_REQUETE: DELAI_REQUETE_DEFAUT,
}


def delais_regles(preferences):
    """Les trois délais d'appel réel réglés, ou leurs valeurs par défaut.

    Rend {"delai_total", "intervalle", "delai_requete"} — les noms des
    paramètres d'AppelReel, pour être passés tels quels.
    """
    lu = {}
    for cle, defaut in DELAIS_DEFAUT.items():
        valeur = preferences.obtenir(cle) if preferences is not None else None
        try:
            valeur = float(valeur)
        except (TypeError, ValueError):
            valeur = defaut
        lu[cle] = valeur if valeur > 0 else defaut
    return {"delai_total": lu[CLE_DELAI_TOTAL],
            "intervalle": lu[CLE_DELAI_INTERVALLE],
            "delai_requete": lu[CLE_DELAI_REQUETE]}


def valider_delai(cle, valeur):
    """Contrôle UN délai saisi ; rend l'entier, lève ValueError en français."""
    minimum, maximum, libelle = BORNES_DELAIS[cle]
    texte = str(valeur).strip()
    if not texte.isdigit():
        raise ValueError(f"{libelle} : donnez un nombre de secondes entier "
                         f"(reçu « {texte} »).")
    nombre = int(texte)
    if not minimum <= nombre <= maximum:
        raise ValueError(f"{libelle} : la valeur doit être comprise entre "
                         f"{minimum} et {maximum} secondes "
                         f"(reçu « {nombre} »).")
    return nombre


class AppelReel(ClientAppels):
    """Le vrai branchement CALL-E — inerte tant que les 3 verrous tiennent.

    Se construire sans clé est impossible : aucun client réel ne peut
    exister par accident. Le déroulé d'un appel :
    1. POST {base}/v1/calls : mission en français + destinataire + les deux
       schémas de l'exemple documenté — « recipient_result_schema » (le
       résultat d'UNE personne, le seul que RingBack relit) et
       « result_schema » (le bilan global, envoyé pour coller à l'exemple) ;
    2. GET {base}/v1/calls/{id} en boucle jusqu'au statut « completed »
       (ou échec / délai d'attente dépassé → exception propre, donc
       AUCUNE écriture de résultat en base par le planificateur) ;
    3. lire_appel_termine() : le résultat se lit dans
       recipients[0].structured_result et la conversation se reconstitue
       depuis recipients[0].attempts[].transcript_turns[] ; une réponse
       illisible est rejetée AVANT toute écriture, en conservant la
       réponse brute (ResultatInvalide) ;
    4. une ligne d'audit (horodatage, numéro MASQUÉ, statut) est ajoutée à
       donnees/audit_appels_reels.jsonl, succès comme échec.
    """

    est_reel = True
    VARIABLE_CLE = "CALLE_API_KEY"
    VARIABLE_URL = "CALLE_API_URL"
    URL_DEFAUT = "https://api.heycall-e.com"
    STATUTS_API_SANS_REPONSE = ("no_answer", "busy")   # -> PasDeReponse
    STATUTS_API_EN_ECHEC = ("failed", "canceled")      # -> ErreurApi

    def __init__(self, cle_api=None, url_base=None,
                 delai_total=DELAI_TOTAL_DEFAUT,
                 intervalle=DELAI_INTERVALLE_DEFAUT,
                 delai_requete=DELAI_REQUETE_DEFAUT, chemin_audit=None,
                 numero_impose=None, langue_appel=None):
        # LE CONTRÔLE DE FORME, ici et nulle part ailleurs : aucun client
        # réel ne peut exister avec une clé qui n'en est manifestement pas
        # une. Il lève avant toute connexion, et son message décrit la clé
        # sans jamais la montrer (voir valider_forme_cle).
        # ⚠ DEUX SOURCES DEPUIS LE 10/08/2026 : la variable, puis le fichier
        # (voir `cle_disponible`). Le contrôle de forme, lui, n'a pas changé de
        # place — il est ici, et nulle part ailleurs.
        self.cle_api = valider_forme_cle(cle_api or cle_disponible()[0]
                                         or None)
        self.url_base = (url_base or os.environ.get(self.VARIABLE_URL)
                         or self.URL_DEFAUT).rstrip("/")
        self.delai_total = delai_total      # attente maximale d'un appel complet (s)
        self.intervalle = intervalle        # pause entre deux interrogations (s)
        self.delai_requete = delai_requete  # délai réseau d'UNE requête HTTP (s)
        self.chemin_audit = chemin_audit or CHEMIN_AUDIT
        # Le dernier appel RÉELLEMENT créé chez CALL-E : gardé dès que le
        # POST aboutit, pour qu'un appel parti ne puisse plus être perdu.
        self.dernier_identifiant = None
        # LE RENVOI D'ESSAI : un numéro écrit, ou — mieux — une FONCTION qui
        # le lit dans les réglages. Voir _numero_impose : c'est relu à chaque
        # appel, jamais retenu.
        self.numero_impose = numero_impose
        # ⚠ LA LANGUE DE L'APPEL SE RELIT, COMME LE NUMÉRO IMPOSÉ. Le client
        # est construit UNE fois au démarrage : retenir la langue ici ferait
        # partir un appel en français alors que l'écran vient de passer en
        # anglais — et la consigne, elle, aurait suivi. Les deux DOIVENT
        # bouger ensemble : une consigne anglaise avec un agent réglé en
        # français est pire que tout, l'agent lirait de l'anglais avec une
        # voix et une prosodie françaises.
        self.langue_appel = langue_appel

    def appliquer_delais(self, delai_total=None, intervalle=None,
                         delai_requete=None):
        """Change les délais d'un client DÉJÀ construit (⚙ Réglages enregistrés).

        Sans cela, un réglage modifié n'aurait d'effet qu'au redémarrage —
        l'écran dirait une chose et le produit en ferait une autre.
        """
        if delai_total:
            self.delai_total = float(delai_total)
        if intervalle:
            self.intervalle = float(intervalle)
        if delai_requete:
            self.delai_requete = float(delai_requete)

    LOCALES = {"fr": ("FR", "fr-FR"), "en": ("GB", "en-GB")}

    def _region_et_locale(self):
        """(région, locale) pour CE départ d'appel — relu à chaque fois.

        ⚠ CE COUPLE DIT À CALL-E QUELLE VOIX PRENDRE, pas seulement quels
        mots. C'est pourquoi il suit la consigne au lieu d'être écrit en dur :
        les deux se décident au même endroit, le réglage de langue.
        """
        return self.LOCALES.get(self._code_langue(), self.LOCALES["fr"])

    def _code_langue(self):
        """« fr » ou « en » pour CE départ d'appel — relu à chaque fois.

        ⚠ UN SEUL CALCUL POUR LA VOIX ET POUR LES MOTS (03/09/2026). Il y en
        avait un pour la voix, et rien pour la consigne : le même POST
        commandait une voix anglaise et lui donnait un mode d'emploi français.
        Deux calculs qui divergent, c'est un agent qui se contredit ; un seul
        ne le peut pas.
        """
        valeur = self.langue_appel
        if callable(valeur):
            try:
                valeur = valeur()
            except Exception:                            # noqa: BLE001
                valeur = None
        # ⚠ `str()` D'ABORD : un reglage relu d'un fichier JSON abime peut
        # rendre un nombre, une liste, n'importe quoi. Un appel ne doit pas
        # echouer sur le TYPE d'un reglage de langue.
        code = str(valeur or "").strip().lower() or "fr"
        return code if code in self.LOCALES else "fr"

    def _numero_impose(self):
        """Le numéro qui REMPLACE celui du contact, ou "" — RELU À CHAQUE APPEL.

        ⚠ RELU, JAMAIS RETENU, et c'est le point important. Le client réel est
        construit UNE fois, au démarrage du serveur : un réglage changé en
        cours de route n'aurait jamais d'effet, et l'écran dirait le contraire
        de ce qui part. `numero_impose` accepte donc une FONCTION (le serveur y
        passe la lecture des réglages) aussi bien qu'un numéro écrit (les
        essais). C'est la même raison qui a fait naître appliquer_delais ; ici,
        il n'y a même pas de réglage à réappliquer — donc rien à oublier.
        """
        valeur = self.numero_impose
        if callable(valeur):
            valeur = valeur()
        return (valeur or "").strip()

    def _numero_a_composer(self, telephone):
        """LE SEUL endroit où se décide le numéro réellement composé.

        Ici, et nulle part ailleurs : tout appel réel passe par
        `_appel_complet`, qui appelle cette méthode en première ligne. Aucun
        appelant ne peut donc oublier le renvoi, et il n'y a qu'un endroit à
        relire pour savoir quel téléphone va sonner.

        L'IDENTITÉ NE BOUGE PAS D'UN MOT : le nom, le motif, le rendez-vous et
        la mission sont déjà écrits dans la tâche, et cette méthode ne les
        touche pas. C'est la demande, mot pour mot — « l'identité reste
        inchangée » — et c'est ce qui donne sa valeur à l'essai : la
        conversation est EXACTEMENT celle que le contact aurait eue.

        ⚠ UN NUMÉRO IMPOSÉ ILLISIBLE REFUSE L'APPEL, il ne se rabat JAMAIS sur
        celui du contact. Se rabattre ferait sonner un vrai téléphone au moment
        précis où l'écran promet qu'aucun ne sonnera : c'est le seul dénouement
        qu'on ne puisse pas rattraper. Le refus, lui, se lit et se corrige.
        """
        impose = self._numero_impose()
        if not impose:
            return telephone
        if not numero_composable(impose):
            raise DemandeRefusee(
                "Le renvoi d'essai est actif (⚙ Réglages → 🧪 Essais → Jeu "
                "d'essai), mais le numéro enregistré n'a pas la forme d'un "
                "numéro composable",
                "Ré-enregistrez votre numéro d'essai, ou décochez la case. "
                "RingBack n'appellera pas vos contacts à sa place : ce serait "
                "le contraire de ce que cette case promet.")
        journal.warning("⚠ Appel RENVOYÉ vers le numéro d'essai %s au lieu de "
                        "%s : ce contact n'est PAS appelé (son identité, elle, "
                        "part inchangée)", masquer_telephone(impose),
                        masquer_telephone(telephone))
        return impose

    # ------------------------------------------------------------------ public
    def appeler(self, nom_client, telephone, rendezvous, mission=None,
                consigne=None, nature=None):
        # `nature` est reçue et IGNORÉE, exprès : elle ne sert qu'à dérouler
        # les cas de figure du simulateur. Ici, c'est une vraie personne qui
        # répond — rien à scénariser. Voir ClientAppels.
        masque = masquer_telephone(telephone)
        journal.info("Appel RÉEL vers %s (%s)", masque, nom_client)
        try:
            resultat, transcription = self._appel_complet(
                self._tache(nom_client, rendezvous, mission, consigne),
                telephone, SCHEMA_RESULTAT, valider_resultat)
        except PasDeReponse as erreur:
            # Échec IMPUTABLE AU CONTACT : le journal le dit tel quel, comme
            # il le fait déjà pour la cascade. Écrire « échec » ici mêlait
            # dans un même mot « il n'a pas décroché » et « notre logiciel
            # est en panne » — les deux lignes du journal se lisaient pareil.
            self._auditer(masque, "pas de réponse", str(erreur))
            raise
        except ResultatInvalide as refus:
            # LA CONVERSATION A EU LIEU et nous n'avons pas su la lire : le
            # journal garde la RÉPONSE BRUTE, pour comprendre en une minute
            # au lieu d'une heure (voir la classe ResultatInvalide).
            self._auditer(masque, refus.statut_audit, str(refus),
                          reponse_brute=refus.reponse_brute)
            raise
        except EchecDeNotreCote as erreur:
            # Panne DE NOTRE CÔTÉ : le journal d'audit doit dire qu'aucun
            # appel n'est parti, pas « échec » (qui laisserait croire que la
            # personne n'a pas répondu). ResultatEnAttente et DelaiDepasse
            # en font partie et portent leur propre statut d'audit. La réponse
            # de l'API part dans sa colonne : relire une ligne d'audit doit
            # suffire à savoir quel champ CALL-E a refusé.
            self._auditer(masque, self._statut_audit(erreur), str(erreur),
                          reponse_brute=erreur.reponse_brute)
            raise
        except Exception as erreur:
            self._auditer(masque, "échec", str(erreur))
            raise
        self._auditer(masque, "terminé")
        return IssueAppel(resultat, transcription)

    def appeler_cascade(self, nom_client, telephone, mission, creneau,
                        consigne=None, nature=None):
        """Appel de cascade RÉEL : même déroulé, schéma de résultat cascade.

        Une personne qui ne décroche pas lève PasDeReponse (audité « pas de
        réponse ») : la cascade passera à la personne suivante — aucun
        résultat n'est inventé.

        `nature` est reçue et ignorée, comme pour le rappel classique.
        """
        masque = masquer_telephone(telephone)
        journal.info("Appel cascade RÉEL vers %s (%s)", masque, nom_client)
        try:
            resultat, transcription = self._appel_complet(
                self._tache_cascade(nom_client, mission, creneau, consigne),
                telephone, SCHEMA_RESULTAT_CASCADE, valider_resultat_cascade)
        except PasDeReponse as erreur:
            self._auditer(masque, "pas de réponse", str(erreur), genre="cascade")
            raise
        except ResultatInvalide as refus:
            self._auditer(masque, refus.statut_audit, str(refus),
                          genre="cascade", reponse_brute=refus.reponse_brute)
            raise
        except EchecDeNotreCote as erreur:
            self._auditer(masque, self._statut_audit(erreur), str(erreur),
                          genre="cascade", reponse_brute=erreur.reponse_brute)
            raise
        except Exception as erreur:
            self._auditer(masque, "échec", str(erreur), genre="cascade")
            raise
        self._auditer(masque, "terminé", genre="cascade")
        return IssueAppel(resultat, transcription)

    @staticmethod
    def _statut_audit(erreur):
        """Le statut écrit au journal d'audit pour une panne de notre côté.

        « aucun appel lancé » tant que la demande de création n'a pas
        abouti : c'est la vérité vérifiable, et elle évite de relire plus
        tard une ligne « échec » en croyant que le client n'a pas répondu.
        Une panne survenue APRÈS le lancement porte son propre statut
        (« résultat en attente », « délai dépassé ») : ces lignes-là disent
        qu'un appel EST parti et que son résultat reste à récupérer.
        """
        if erreur.statut_audit:
            return erreur.statut_audit
        if erreur.appel_lance == APPEL_INCERTAIN:
            return "appel incertain"
        return "échec de notre côté" if erreur.appel_lance else "aucun appel lancé"

    # ----------------------------------------------------------------- interne
    def _appel_complet(self, tache, telephone, schema, validateur):
        # LE RENVOI D'ESSAI SE JOUE ICI, EN PREMIÈRE LIGNE : voir
        # _numero_a_composer. Les deux appelants (appeler, appeler_cascade)
        # ont déjà masqué le numéro DU CONTACT pour leur journal — c'est
        # voulu : le journal dit qui l'on voulait joindre, et la ligne
        # d'audit dit, à côté, que l'appel a été renvoyé.
        telephone = self._numero_a_composer(telephone)
        # LA FRONTIÈRE : tant que ce POST n'a pas abouti, RIEN n'est parti —
        # aucun téléphone n'a sonné, aucun crédit n'a été consommé. C'est ce
        # qui autorise (ou non) le message à l'écrire noir sur blanc.
        region, locale = self._region_et_locale()
        creation = self._requete("POST", "/v1/calls", {
            "task": tache,
            "recipients": [{"phones": [numero_e164(telephone)],
                            "region": region, "locale": locale}],
            # UN destinataire par appel, donc UN résultat par destinataire :
            # voir le pavé au-dessus de SCHEMA_RESULTAT. Les deux schémas
            # partent ensemble, comme dans l'exemple documenté.
            "result_schema": SCHEMA_BILAN_GLOBAL,
            "recipient_result_schema": schema,
        })
        identifiant = creation.get("id") or creation.get("call_id")
        if not identifiant:
            raise ErreurApi("création d'appel sans identifiant dans la réponse")
        # ICI L'APPEL EST PARTI. Tout ce qui échoue à partir de cette ligne
        # sera reclassé « résultat en attente » et gardera CET identifiant :
        # c'est la seule chose qui permettra de retrouver ce que la
        # conversation a donné (voir _en_attente_apres_lancement).
        self.dernier_identifiant = identifiant
        try:
            return self._attendre_le_resultat(identifiant, validateur)
        except IMPUTABLES_AU_CONTACT:
            # ⚠ CES DEUX-LÀ SONT DES FAITS SUR LA PERSONNE, pas des pannes :
            # elle n'a pas décroché, ou l'agent n'a rien pu tirer de
            # l'échange. Les reclasser « résultat en attente » effacerait un
            # fait réel et laisserait le contact attendre un résultat qui
            # n'arrivera jamais. Elles remontent telles quelles.
            raise
        # ⚠ ET TOUT LE RESTE EST RECLASSÉ (03/09/2026). Le commentaire
        # ci-dessus annonçait déjà la règle — « tout ce qui échoue à partir de
        # cette ligne » — mais le rattrapage ne couvrait que `EchecDeNotreCote`.
        # Une réponse de suivi qui n'est pas du JSON (page d'erreur d'une
        # passerelle, corps tronqué) ou un code HTTP inconnu lèvent un
        # `ErreurApi` NU : ni un fait sur la personne, ni une panne reconnue.
        # Il passait au travers — la tentative était comptée sur elle, une
        # relance armée (le téléphone sonnait une SECONDE fois pour un échange
        # déjà conclu), et l'identifiant CALL-E perdu, donc le résultat
        # irrécupérable.
        except ErreurApi as panne:
            raise _en_attente_apres_lancement(panne, identifiant) from panne

    def _attendre_le_resultat(self, identifiant, validateur):
        """Interroge l'appel jusqu'à sa conclusion ; rend (résultat, transcription)."""
        echeance = time.monotonic() + self.delai_total
        while True:
            etat = self._requete("GET", f"/v1/calls/{identifiant}",
                                 appel_lance=True)
            statut = etat.get("status")
            if statut == "completed":
                break
            if statut in self.STATUTS_API_SANS_REPONSE:
                raise PasDeReponse(f"appel sans conversation : statut « {statut} »")
            if statut in self.STATUTS_API_EN_ECHEC:
                raise ErreurApi(f"appel terminé sans succès : statut « {statut} »")
            if time.monotonic() >= echeance:
                raise DelaiDepasse(
                    "L'appel a bien été lancé, mais CALL-E n'a pas rendu son "
                    f"résultat dans les {self.delai_total:.0f} secondes "
                    "d'attente réglées (dernier statut connu : "
                    f"{statut!r})", identifiant=identifiant)
            time.sleep(self.intervalle)
        # Verrou de cohérence : une réponse illisible lève ResultatInvalide
        # ICI, donc avant que le planificateur n'écrive quoi que ce soit — et
        # elle emporte avec elle la réponse brute et la transcription.
        return lire_appel_termine(etat, validateur)

    # ------------------------------------------------- relire, sans appeler
    def lire_resultat(self, identifiant, cascade=False):
        """LIT le résultat d'un appel DÉJÀ PASSÉ. NE COMPOSE AUCUN NUMÉRO.

        Un seul GET /v1/calls/{identifiant}, jamais de POST : ce chemin ne
        peut PAS créer d'appel — il n'y a pas une ligne ici qui le
        permette. C'est ce qui rend le geste « 📥 Récupérer les résultats en
        attente » inoffensif : au pire il ne trouve rien.

        Voir ClientAppels.lire_resultat pour la forme de ce qui est rendu.
        """
        etat = self._requete("GET", f"/v1/calls/{identifiant}",
                             appel_lance=True)
        statut = etat.get("status")
        if statut in self.STATUTS_API_SANS_REPONSE:
            return {"etat": "sans_reponse", "statut_api": statut}
        if statut in self.STATUTS_API_EN_ECHEC:
            return {"etat": "echoue", "statut_api": statut}
        if statut != "completed":
            return {"etat": "en_cours", "statut_api": statut}
        validateur = valider_resultat_cascade if cascade else valider_resultat
        resultat, transcription = lire_appel_termine(etat, validateur)
        return {"etat": "termine", "statut_api": statut,
                "issue": IssueAppel(resultat, transcription)}

    def _requete(self, methode, chemin, donnees=None, appel_lance=False):
        """Une requête HTTP ; traduit tout échec en exception PARLANTE.

        appel_lance : l'appel téléphonique a-t-il déjà été demandé quand
        cette requête part ? Faux pour la création, vrai pour le suivi.
        C'est cette valeur qui décide si le message a le droit d'affirmer
        que personne n'a été appelé.
        """
        requete = urllib.request.Request(
            self.url_base + chemin,
            data=(json.dumps(donnees, ensure_ascii=False).encode("utf-8")
                  if donnees is not None else None),
            headers={"Authorization": "Bearer " + self.cle_api,
                     "Content-Type": "application/json",
                     "Accept": "application/json"},
            method=methode)
        try:
            with urllib.request.urlopen(requete, timeout=self.delai_requete) as reponse:
                return json.loads(reponse.read().decode("utf-8"))
        except urllib.error.HTTPError as erreur:
            # CE QUE DIT L'API, mot pour mot : sans cela, un refus se résume à
            # un numéro de code et il faut deviner. Constaté le 01/08/2026 :
            # un 422 muet a coûté deux heures alors que la réponse nommait le
            # champ fautif. On tronque (une réponse peut être longue) et on
            # n'y cherche aucun sens : c'est une citation, pas une analyse.
            try:
                dit = erreur.read().decode("utf-8", "replace").strip()
            except Exception:                        # noqa: BLE001
                dit = ""
            if dit:
                # Corps JSON : on le cite tel quel plutôt qu'échappé deux fois
                # ({\"error\": …} est illisible pour qui doit trouver le champ).
                try:
                    dit = reponse_brute_lisible(json.loads(dit))
                except (TypeError, ValueError):
                    dit = reponse_brute_lisible(dit)
            echec = _echec_de_reponse(erreur.code, methode, chemin,
                                      creation=not appel_lance)
            if isinstance(echec, EchecDeNotreCote):
                echec.appel_lance = appel_lance
                # La citation vit dans reponse_brute, PAS dans args[0] : cette
                # famille recompose son message et n'a jamais lu args[0].
                if dit:
                    echec.reponse_brute = dit
            elif dit:
                echec.args = (f"{echec.args[0]} — réponse de l'API : "
                              f"{dit}",) + echec.args[1:]
            raise echec from erreur
        except urllib.error.URLError as erreur:
            # Réseau coupé, DNS muet, connexion refusée : la demande n'a même
            # pas pu PARTIR (urllib n'emballe dans URLError que les échecs
            # d'envoi). Ce n'est jamais la faute du contact, et la même panne
            # frappera l'appel suivant.
            raise ServiceIndisponible(
                "Le service CALL-E est injoignable depuis cet ordinateur "
                f"({erreur.reason})", QUOI_FAIRE_RESEAU,
                appel_lance=appel_lance) from erreur
        except (json.JSONDecodeError, UnicodeDecodeError) as erreur:
            raise ErreurApi("réponse illisible (JSON attendu)") from erreur
        except (TimeoutError, http.client.HTTPException, OSError) as erreur:
            # LA FAMILLE QUI TRAVERSAIT — et qui a coûté l'appel du
            # 01/08/2026. urllib n'emballe dans URLError que ce qui rate à
            # l'ENVOI ; tout ce qui rate ensuite (getresponse(), read())
            # remonte tel quel :
            #   - TimeoutError (alias de socket.timeout) : « The read
            #     operation timed out » — le cas constaté, qui n'est PAS une
            #     sous-classe d'URLError ;
            #   - http.client.HTTPException : RemoteDisconnected,
            #     IncompleteRead, BadStatusLine — le serveur raccroche ;
            #   - les autres OSError : connexion réinitialisée, erreur SSL.
            # Elles tombaient toutes dans l'« except Exception » du moteur de
            # campagne, devenaient « echec », consommaient une tentative et
            # faisaient basculer le contact en « injoignable ». On les traite
            # donc en FAMILLE, pas une par une.
            #
            # Et la demande, elle, était PARTIE : dire « personne n'a été
            # appelé » serait faux. D'où « incertain » quand c'est la
            # création qui a échoué ainsi.
            raise ServiceIndisponible(
                "La réponse de CALL-E n'est jamais revenue sur "
                f"{methode} {chemin} ({type(erreur).__name__} : {erreur})",
                QUOI_FAIRE_RESEAU,
                appel_lance=(True if appel_lance else APPEL_INCERTAIN)
                ) from erreur

    def _tache(self, nom_client, rendezvous, mission=None, consigne=None):
        """LA CONSIGNE dictée à l'agent — sans JAMAIS y inscrire le numéro.

        consigne : les trois parties déjà construites par une campagne de
        l'assistant (assistant.consigne_de_l_appel) — c'est le cas normal,
        et c'est exactement ce que l'aperçu de l'étape 2 a montré.

        Sans elle (rappel individuel, file d'appels, essai réel), la même
        consigne en trois parties est construite ici, avec ce qu'on sait :
        le message d'ouverture, le rendez-vous concerné et la place proposée.
        Jamais un monologue — c'est ce qui avait rendu l'agent RAIDE au 5ᵉ
        essai réel du propriétaire (voir le module consigne).
        """
        if consigne is not None:
            return consigne.texte()
        # La place proposée sort du MÊME calcul que la simulation
        # (_creneau_propose) : quand l'appelant a choisi une place réellement
        # libre, c'est ELLE qui est dictée à l'agent — jamais une date
        # obtenue par formule qui pourrait tomber dans le passé.
        code = self._code_langue()
        dire = mod_langue.traducteur(code)
        # ⚠ « : » COLLE EN ANGLAIS, l'espace insécable est une règle française.
        sep = ": " if code == "en" else " : "
        horaire, propose = _creneau_propose(rendezvous)
        faits = [f"{dire('Personne appelée')}{sep}{nom_client}.",
                 f"{dire('Motif')}{sep}{rendezvous['motif']}.",
                 f"{dire('Rendez-vous concerné')}{sep}"
                 f"{_formater(horaire, code)}.",
                 f"{dire('Place proposée')}{sep}{_formater(propose, code)}."]
        if mission:
            presentation = mission
            objectif = dire("obtenir une réponse claire sur le "
                            "rendez-vous dont parle ta présentation "
                            "ci-dessus")
        else:
            presentation = (
                f"Bonjour {nom_client}, je suis l'assistant téléphonique du "
                f"cabinet. Vous aviez rendez-vous "
                f"{_formater(horaire, code)} pour "
                f"« {rendezvous['motif']} » et nous n'avons pas pu vous "
                f"accueillir. Je vous propose un nouveau créneau "
                f"{_formater(propose, code)} : est-ce que cela vous convient ?")
            objectif = dire("savoir si la personne accepte le nouveau "
                            "créneau que tu proposes, à la place du "
                            "rendez-vous manqué")
        return consigne_module.Consigne(
            presentation, objectif, faits,
            dire=mod_langue.traducteur(code),
            civilites=mod_langue.civilites_de(
                code, consigne_module._DEVELOPPE)).texte()

    def _tache_cascade(self, nom_client, mission, creneau, consigne=None):
        """La consigne de cascade — sans JAMAIS y mettre le numéro."""
        if consigne is not None:
            return consigne.texte()
        creneau_dt = datetime.datetime.fromisoformat(creneau)
        code = self._code_langue()
        dire = mod_langue.traducteur(code)
        sep = ": " if code == "en" else " : "
        dit = _formater(creneau_dt, code)
        ouverture = (f"Bonjour {nom_client}, une place vient de se libérer "
                     f"{dit}. Cela vous intéresse-t-il ?")
        if code == "en":
            ouverture = (f"Hello {nom_client}, a slot has just become free "
                         f"{dit}. Would that be of interest to you?")
        return consigne_module.Consigne(
            mission or ouverture,
            dire("savoir si la personne prend la place qui vient de "
                 "se libérer"),
            [f"{dire('Personne appelée')}{sep}{nom_client}.",
             f"{dire('Place qui vient de se libérer')}{sep}{dit}."],
            issues=consigne_module.ISSUES_DEFAUT_CASCADE,
            genre=consigne_module.GENRE_CASCADE,
            dire=mod_langue.traducteur(code),
            civilites=mod_langue.civilites_de(
                code, consigne_module._DEVELOPPE)).texte()

    def _auditer(self, telephone_masque, statut, detail="", genre=None,
                 reponse_brute=""):
        """Une ligne JSON par appel réel tenté — numéro TOUJOURS masqué.

        reponse_brute : ce que l'API a répondu, mot pour mot, quand RingBack
        n'a pas su le lire. C'est exactement ce qui manquait le 01/08/2026 —
        le journal disait « le résultat doit être un objet JSON » sans jamais
        montrer sur quoi. Les numéros y sont masqués comme partout ailleurs.
        """
        ligne = {"horodatage": datetime.datetime.now().isoformat(timespec="seconds"),
                 "telephone": telephone_masque, "statut": statut}
        # ⚠ LE RENVOI EST ÉCRIT DANS LA LIGNE. Le numéro masqué ci-dessus est
        # celui DU CONTACT — c'est qui l'on voulait joindre, et c'est ce qu'il
        # faut pouvoir relire. Mais sans la mention du renvoi, la même ligne
        # laisserait croire que ce contact a été appelé. Ces deux clés ne
        # paraissent QUE lorsque le renvoi est actif : un journal d'appels
        # ordinaires ne change pas de forme.
        impose = self._numero_impose()
        if impose:
            ligne["renvoi_essai"] = ("appel renvoyé vers le numéro d'essai "
                                     "imposé : ce contact n'a PAS été appelé")
            # Un numéro imposé illisible a fait REFUSER l'appel (voir
            # _numero_a_composer) : le masquer donnerait une rangée de points
            # sans aucun sens. La ligne dit ce qui s'est vraiment passé.
            ligne["numero_appele"] = (masquer_telephone(impose)
                                      if numero_composable(impose)
                                      else "numéro d'essai illisible")
        if genre:
            ligne["genre"] = genre
        if detail:
            ligne["detail"] = detail
        if reponse_brute:
            ligne["reponse_brute"] = reponse_brute
        dossier = os.path.dirname(self.chemin_audit)
        if dossier:
            os.makedirs(dossier, exist_ok=True)
        with open(self.chemin_audit, "a", encoding="utf-8") as fichier:
            fichier.write(json.dumps(ligne, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# LE MÊME CONTRÔLE, EN LIGNE DE COMMANDE — pour configurer_cle.cmd
# ---------------------------------------------------------------------------
# Le contrôle de forme doit valoir AUSSI au moment où l'on enregistre la clé,
# pas seulement au démarrage du mode réel. Plutôt que de le récrire en
# langage de fichier de commandes (deux versions = deux vérités), le script
# appelle CE code-ci. Il reçoit le CHEMIN du fichier, jamais la clé en
# argument : une clé passée en argument se lirait dans la liste des
# processus.
def controle_fichier_cle(chemin):
    """Contrôle la clé écrite dans ce fichier ; rend (accepté ?, message).

    Le message ne contient JAMAIS la clé — il la décrit (voir decrire_cle).
    """
    try:
        with open(chemin, encoding="utf-8-sig") as fichier:
            lignes = [ligne.strip() for ligne in fichier.read().splitlines()]
    except OSError as erreur:
        return False, f"Fichier illisible : {erreur.strerror}."
    premiere = next((ligne for ligne in lignes if ligne), "")
    try:
        propre = valider_forme_cle(premiere)
    except CleApiAbsente as refus:
        return False, str(refus)
    return True, ("Forme de la clé acceptée : " + decrire_cle(propre)
                  + ". (C'est CALL-E qui dira si elle est valable ; ce "
                    "contrôle ne juge que la forme.)")


def _principal_controle_cle(arguments=None):
    """Point d'entrée « python -m ringback.calle_client --fichier <chemin> ».

    Rend 0 si la forme est acceptable, 1 sinon — c'est ce code de sortie que
    configurer_cle.cmd relit pour s'arrêter avant d'enregistrer une clé qui
    n'en est pas une.
    """
    try:            # console Windows : ne jamais planter sur un accent
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass
    arguments = list(sys.argv[1:] if arguments is None else arguments)
    if len(arguments) != 2 or arguments[0] != "--fichier":
        print("Usage : python -m ringback.calle_client --fichier <chemin>")
        return 2
    accepte, message = controle_fichier_cle(arguments[1])
    print(message)
    return 0 if accepte else 1


if __name__ == "__main__":
    sys.exit(_principal_controle_cle())
