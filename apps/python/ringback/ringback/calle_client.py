"""Interface to the CALL-E phone agent.

Two implementations of ClientAppels:
- AppelSimule: the only one active by default. No network connection; a plausible scripted conversation + a result conforming to the imposed schema (appointment_status: confirmed | rescheduled | canceled).
- AppelReel: the real HTTP wiring (urllib.request), deliberately inert by default. It requires the CALLE_API_KEY environment variable (without it, an immediate and clear refusal) and is only reached after the planner's two other locks (dry_run=False + explicit confirmation). The API address is configured through CALLE_API_URL; every real call leaves an audit row (number ALWAYS masked) in donnees/audit_appels_reels.jsonl.

FOUR FAMILIES OF FAILURE, NEVER CONFUSED:
- what is attributable to the CONTACT (they do not pick up, voicemail, an impossible number): PasDeReponse. An attempt is counted, a follow-up scheduled;
- what is attributable to US BEFORE the call goes out (key refused, service down, credit exhausted, network cut): EchecDeNotreCote. No attempt consumed, nobody marked `injoignable`, campaign paused — otherwise a refused key would have wrongly marked the whole list;
- what fails AFTER the call has gone out: ResultatEnAttente. The call took place, its result is not known — the CALL-E id is kept and the result can be retrieved later, without calling anybody back;
- the answer ARRIVED but RingBack cannot read it: ResultatInvalide. The conversation took place; rereading would give the same unreadable answer, so there is nothing to wait for. The contact goes to `à rappeler par un humain` — never called back automatically — with their transcript and CALL-E's RAW answer preserved, and the campaign pauses.

Two kinds of call, each with its own result schema:
- the classic call-back about a missed appointment (appeler);
- the `first yes` cascade call (appeler_cascade): a freed slot is offered; outcome: accepted | refused | moved (moved = the person wants another date, returned in new_datetime). Someone who does not pick up has no conversation, hence no result: that is the PasDeReponse exception, never an invented result.

Deterministic SIMULATION convention (for the tests and the demo): fictional
numbers whose LAST TWO digits are 51 to 56 force the outcome — 51
accepts/confirms, 52 refuses/cancels, 53 does not pick up, 54 asks for another
date (moved, with a deterministic derived date), 55 wants to move WITHOUT
settling a date (to_reschedule: `call me back`), 56 does not pick up on the
FIRST call then accepts on the following ones (used to demonstrate a follow-up
that concludes). Any other number keeps the random draw (reproducible from the
seed).
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
import urllib.parse
import urllib.request

from . import (consigne as consigne_module,
               langue as mod_langue, themes)
from .db import masquer_telephone

journal = logging.getLogger("ringback.calle")

DOSSIER_APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHEMIN_AUDIT = os.path.join(DOSSIER_APP, "donnees", "audit_appels_reels.jsonl")
# ⚠ THE KEY MAY BE STORED HERE (10/08/2026). It was read only from
# CALLE_API_KEY, and setting an environment variable is a wall for a sole
# trader: the solution was not usable. See `cle_disponible` for what was kept —
# everything, except `never written to a file`.
CHEMIN_CLE = os.path.join(DOSSIER_APP, "donnees", "cle_calle.txt")
SOURCE_VARIABLE = "la variable d'environnement CALLE_API_KEY"
SOURCE_FICHIER = "le fichier donnees/cle_calle.txt"

# to_reschedule: the client wants to move their appointment but NO date is
# agreed during the call (`call me back later`) — a call that does not
# conclude, and which feeds the scheduled follow-ups.
STATUTS_VALIDES = ("confirmed", "rescheduled", "canceled", "to_reschedule")
CHAMPS_OBLIGATOIRES = ("appointment_status", "new_datetime", "notes")

# `to_reschedule` ALSO EXISTS IN CASCADE — it is the fourth outcome, and it was
# missing. Observed on 02/08/2026 on the 8th real test: the person asked for
# the date to be repeated, the agent concluded `moved` with no date, and
# RingBack declared the answer UNREADABLE. Yet `wants something else, nothing
# agreed` is not unreadable at all: it is precisely to_reschedule, which the
# other four kinds have always declared (code_sans_date). The cascade was the
# only one without it.
ISSUES_CASCADE = ("accepted", "refused", "moved", "to_reschedule")
CHAMPS_CASCADE = ("outcome", "new_datetime", "notes")

# ---------------------------------------------------------------------------
# `DO NOT CALL ME AGAIN`, SAID ON THE PHONE
# ---------------------------------------------------------------------------
# Owner's request of 10/08/2026. Before, the 🚫 could only be set from the 👥
# Contacts screen: somebody asking THE AGENT for it was not heard. That is a
# lack of courtesy as much as a lack of compliance.  ⚠ A FIELD, NOT A FOURTH
# OUTCOME. It is not a conclusion: it is a request that may accompany any of
# the three (`no, and do not call me again`; `yes this time, but not after`).
# One more outcome would have forced a choice between the two.  ⚠ NOT IN
# `required`. A result where the agent forgets it must stay valid: otherwise a
# new field would pause whole campaigns. Absent = no.
CHAMP_NE_PLUS_APPELER = "do_not_call"
# What the agent must write. A TEXT enum, never a boolean: three schema
# refusals have already cost this project real tests, and `string + enum` is
# what the reference example uses.
VALEURS_NE_PLUS_APPELER = ("yes", "no")
# What we ACCEPT as input — broader than what we ask for. The bad ending is not
# one 🚫 too many (it is removed in one click from 👥 Contacts), it is ignoring
# somebody's request.
OUI_NE_PLUS_APPELER = ("yes", "true", "oui", "1", "y", "vrai")
DESCRIPTION_NE_PLUS_APPELER = (
    "« yes » UNIQUEMENT si la personne demande explicitement qu'on ne la "
    "rappelle plus ; « no » dans tous les autres cas.")


# `AND IF SOMETHING ELSE COMES FREE, SHALL I CALL YOU?` — asked after a refusal
# ---------------------------------------------------------------------------
# Owner's request of 10/08/2026. Refusing ONE slot has never meant refusing the
# next ones: without this question, RingBack called back indefinitely somebody
# who is not interested, and their only way out was the 🚫 — which cuts
# everything off, including calls about THEIR OWN appointments.  ⚠ ONLY IN
# CASCADE (freed slot). Elsewhere the question makes no sense: we do not call
# to offer a slot, we call about the person's own appointment.  ⚠ ABSENT = THEY
# GO ON RECEIVING. The flag is only set on an explicit NO: that is the previous
# behaviour, and nobody is set aside by the agent's silence.
CHAMP_AUTRES_PLACES = "wants_other_slots"
VALEURS_AUTRES_PLACES = ("yes", "no")
NON_AUTRES_PLACES = ("no", "false", "non", "0", "n", "faux")
DESCRIPTION_AUTRES_PLACES = (
    "Uniquement si la personne DÉCLINE la place : « no » si elle ne veut plus "
    "qu'on lui propose d'autres créneaux, « yes » si elle accepte qu'on la "
    "rappelle quand une autre place se libère. Laisse vide sinon.")


def refuse_les_autres_places(resultat):
    """Did the person say NO to future slot offers?

    ⚠ ONLY AN EXPLICIT NO COUNTS. Absent, empty, `yes`, or unreadable: they go
    on receiving the offers — that is the previous behaviour, and we set nobody
    aside on the agent's silence.
    """
    if not isinstance(resultat, dict):
        return False
    valeur = resultat.get(CHAMP_AUTRES_PLACES)
    if isinstance(valeur, bool):
        return not valeur
    return str(valeur or "").strip().lower() in NON_AUTRES_PLACES


def ne_plus_appeler_demande(resultat):
    """Did the person ask not to be called again?

    ⚠ ONLY AN EXPLICIT YES COUNTS. A field that is absent, empty, `no`, or a
    value we cannot read, all mean NO: we do not guess a 🚫 out of noise — that
    would cut off the phone to somebody who asked for nothing. But we read the
    ways of saying yes broadly (see OUI_NE_PLUS_APPELER).
    """
    if not isinstance(resultat, dict):
        return False
    valeur = resultat.get(CHAMP_NE_PLUS_APPELER)
    if isinstance(valeur, bool):
        return valeur
    return str(valeur or "").strip().lower() in OUI_NE_PLUS_APPELER


# ---------------------------------------------------------------------------
# THE NAMES CALL-E RESERVES FOR ITSELF — forbidden in a result schema
# ---------------------------------------------------------------------------
# CALL-E fills these fields itself and refuses the request (400
# `recipient_result_schema contains reserved field`) when they are asked for.
# Observed on 02/08/2026 on the owner's 7th real test, on `duration_seconds`:
# RingBack demanded it of the agent… and used it nowhere. So it simply
# disappeared — asking somebody to estimate a length the machine measures was
# doubly wrong.  Should a length one day become useful (the cost of a call,
# statistics), it is computed without asking anybody:
# recipients[].attempts[].started_at and completed_at are in the answer, and
# those are measurements, not estimates.  The list comes from the sponsor's API
# reference: `summary, status, transcript, call_id, or timing fields`. The
# timing fields are described there by their nature, not named one by one: so
# any name starting or ending with a time marker is taken too. Better to refuse
# an acceptable name on our side than to make a whole campaign fail at CALL-E.
CHAMPS_RESERVES = ("summary", "status", "transcript", "call_id",
                   "duration", "duration_seconds", "started_at",
                   "completed_at", "created_at", "timing")
_SUFFIXES_RESERVES = ("_seconds", "_at", "_ms", "_duration")


def champs_reserves_dans(schema):
    """The reserved names present in a result schema (empty = fine).

    Called by the tests BEFORE any connection: a refused schema makes ALL of a
    campaign's calls fail, and the refusal arrives remotely, at the 400. Better
    to notice it here.
    """
    fautifs = []
    for nom in (schema or {}).get("properties", {}):
        minuscule = str(nom).lower()
        if (minuscule in CHAMPS_RESERVES
                or minuscule.endswith(_SUFFIXES_RESERVES)):
            fautifs.append(nom)
    return fautifs

# Standard make-up slot: when the reference is an appointment ALREADY taken (a
# reminder, a confirmation, a missed appointment), the agent offers a slot one
# week later. The same convention as horaires.RATTRAPAGE_JOURS — copied here so
# this module stays independent of the schedule computation.
RATTRAPAGE_JOURS = 7

# Simulation convention: a number ending -> a forced outcome. `56` HAS MEMORY:
# no answer on the instance's first call, then accepts — the archetypal
# scenario of a follow-up that concludes.
TERMINAISONS_FORCEES = {"51": "accepte", "52": "refuse",
                        "53": "pas_de_reponse", "54": "deplace",
                        "55": "deplace_non_conclu",
                        "56": "puis_accepte",
                        # `57`: they refuse AND ask not to be called again. It
                        # is the commoner of the two in real life — and the one
                        # you need to be able to demand in a check.
                        "57": "refuse_et_stop",
                        # `58`: they refuse the slot and no longer want to be
                        # offered any — but they keep their appointments. It is
                        # the POLITE refusal, the one that does not cut
                        # everything off.
                        "58": "refuse_sans_proposition",
                        # `59`: the conversation took place, but the agent
                        # returned no readable outcome. The ONLY case a
                        # simulated campaign does not play by itself: it pauses
                        # the campaign, so it must be possible to ask for it
                        # without breaking the other calls.
                        "59": "reponse_illisible"}


# ResultatInvalide is defined FURTHER DOWN, with the other `on our side`
# failures: it is not a fact about the person called, it is RingBack that could
# not read what CALL-E answered. See the class itself.


class CleApiAbsente(RuntimeError):
    """The CALLE_API_KEY key is missing: real calls are impossible."""


class AdresseApiRefusee(CleApiAbsente):
    """CALLE_API_URL designates an address the key must not be handed to.

    It inherits from CleApiAbsente FOR THE SAME REASON AS CleMalFormee:
    everything that already refused to start without a key now also refuses to
    start towards an unapproved address, without any caller having to change.
    The product then falls back to simulation, which is the right behaviour —
    better not to call than to call elsewhere.
    """


class CleMalFormee(CleApiAbsente):
    """The key supplied does not have the SHAPE of a key (a web address, too
    short…).

    It inherits from CleApiAbsente BY DESIGN: everything that already refused
    to start without a key now also refuses to start with a manifestly wrong
    key — no door is left open, and no caller needs modifying for the refusal
    to hold.
    """


class ErreurApi(RuntimeError):
    """The CALL-E API returned no completed call (unexpected answer or failure).
    """


class LectureImpossible(ErreurApi):
    """This call client cannot go and reread a result at CALL-E.

    That is the case of SIMULATION: no call went out there, so there is nothing
    to reread. We say so frankly rather than invent a result.
    """


class PasDeReponse(ErreurApi):
    """Nobody picked up: no conversation, therefore no result."""


# ---------------------------------------------------------------------------
# THE FAILURE THAT IS NOT THE CONTACT'S
# ---------------------------------------------------------------------------
# Two families of failure, and they have NOTHING to do with each other:  - the
# failure ATTRIBUTABLE TO THE CONTACT — they do not pick up, they reach
# voicemail, their number cannot be dialled: it really is THEM we did not
# reach. An attempt is counted, a follow-up is scheduled, and in the end they
# become `injoignable`. That behaviour does not change;  - the failure
# ATTRIBUTABLE TO US — the key is refused, the service is down, the credit is
# exhausted, the network is cut. The person at the other end has nothing to do
# with it: their phone did not even ring. Marking somebody `injoignable` in
# that case is a LIE, and it is exactly what happened in real conditions on
# 01/08/2026 (a wrong key → 401 → the contact `unreachable, ceiling reached`).
# A failure of the second family: NO attempt counted, NO change of the
# contact's state, NOTHING written to the database — and, since it will recur
# identically on the next call, the campaign PAUSES instead of wrongly marking
# the whole list.
RIEN_N_A_EU_LIEU = ("Personne n'a été appelé et aucun crédit CALL-E n'a été "
                    "consommé.")
APPEL_DEJA_LANCE = ("Attention : l'appel avait DÉJÀ été lancé quand la panne "
                    "est survenue — le téléphone a pu sonner et cet appel a "
                    "pu être facturé. Vérifiez avant de rappeler cette "
                    "personne.")
# The third possible answer to `what happened?`, and it was missing: the
# request WENT OUT and the answer never came back. Saying `nobody was called`
# would then be a lie, and so would `the call was launched`. We say we do not
# know, and where to go and check.
APPEL_INCERTAIN = "incertain"
APPEL_PEUT_ETRE_LANCE = (
    "La demande est bel et bien PARTIE vers CALL-E, mais sa réponse n'est "
    "jamais revenue : RingBack ne peut pas dire si le téléphone a sonné, et "
    "il ne l'invente pas. Vérifiez dans le tableau de bord CALL-E "
    "(dashboard.heycall-e.com) avant de rappeler cette personne.")
# Deliberately worded without naming `the campaign`: the same text serves the
# campaign record, the call queue, the cascade and the follow-ups. Each screen
# adds ITS OWN context (`Campaign paused by itself: …`, `No call went out`),
# and the sentence stays true everywhere.
RIEN_N_EST_ECRIT = ("Rien n'a été écrit sur personne : aucune tentative n'a "
                    "été comptée et personne n'a été marqué « injoignable ». "
                    "Ce qui n'a pas été appelé est conservé tel quel et "
                    "reprendra exactement où cela s'est arrêté.")

# Where to find the REAL key. This sentence is the same everywhere (screen,
# audit log, refusal at start-up, configurer_cle.cmd): one single truth.
QUOI_FAIRE_CLE = (
    "Que faire : ouvrez le tableau de bord CALL-E "
    "(dashboard.heycall-e.com), section « API keys », copiez LA CLÉ "
    "elle-même — pas l'adresse du site — dans le fichier call-e-key.txt, "
    "lancez configurer_cle.cmd, puis relancez RingBack.")
# ⚠ THE KEY IS NOT AT FAULT, AND SAYING SO AVOIDS A FALSE TRAIL (03/09/2026).
# Measured outside RingBack, on a read-only request: with no key AND with an
# invented key, CALL-E answers 401 `Invalid or missing API key`; with the real
# key, it answers 403 `This account is not allowed to access CALL-E`. The two
# codes therefore say two different things, and 403 means the key WAS
# RECOGNISED. The previous message pointed towards `API keys, recreate it if
# needed`: the owner re-pasted his key, restarted, got the same error — half an
# hour lost on the one trail that could yield nothing.
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
# THE THIRD CASE: THE CALL WENT OUT, ITS RESULT IS NOT KNOWN
# ---------------------------------------------------------------------------
# Observed on 01/08/2026 at 10:54: the owner's phone rang, he picked up, he
# ACCEPTED the new slot — and RingBack wrote `injoignable`. Reading the answer
# had timed out (`The read operation timed out`), the exception had gone
# through, and the conversation's result was lost.  Once creation (POST
# /v1/calls) has returned an id, the call HAS gone out: everything that fails
# afterwards says NOTHING about the person called, and the result exists (or
# will exist) at CALL-E. It is a state in its own right — neither
# `injoignable`, nor `à recontacter`: `called, result unknown`. We keep the id,
# and we go and fetch the result later.
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
    """The failure comes from US, never from the person called.

    Carries everything needed to write it on screen AND in the audit log:
    - constat    : what happened, in French, with no bare code;
    - quoi_faire : what to do, step by step;
    - code       : the HTTP code when there is one (None otherwise);
    - appel_lance : had the call ALREADY been launched? False as long as the creation request has not succeeded — and only in that case are we allowed to write `nobody was called`. Worth APPEL_INCERTAIN (`uncertain`) when the request went out without the answer coming back: we do not know, and we say so.
    - identifiant : the call's number at CALL-E when it is known.

    `globale` says whether the failure will hit ALL the following calls
    identically (key refused, quota, service down): it is what triggers pausing
    the campaign.
    """

    globale = True
    statut_audit = None  # filled in by the subclasses that change it

    def __init__(self, constat, quoi_faire, code=None, appel_lance=False,
                 identifiant=None, reponse_brute=None):
        self.constat = constat
        self.quoi_faire = quoi_faire
        self.code = code
        self.appel_lance = appel_lance
        self.identifiant = identifiant
        # WHAT THE API ANSWERED, word for word. Without it, `read the answer
        # quoted above` points at nothing — that happened on 02/08/2026: the
        # body was indeed read, but attached to args[0], which this family
        # never displays (it recomposes its message from constat + quoi_faire).
        # It belongs HERE, on the same footing as the rest.
        self.reponse_brute = reponse_brute
        super().__init__(constat)

    def __str__(self):
        return self.message()

    def ce_qui_a_eu_lieu(self):
        """The sentence that says what happened on the PHONE's side.

        Three possible answers, and not one more: nothing went out, the call
        was already launched, or we cannot know.
        """
        if self.appel_lance == APPEL_INCERTAIN:
            return APPEL_PEUT_ETRE_LANCE
        return APPEL_DEJA_LANCE if self.appel_lance else RIEN_N_A_EU_LIEU

    def message(self, citer=True):
        """The COMPLETE message, the one displayed and audited.

        Four beats, always in the same order: what happened, what did NOT
        happen, what becomes of the campaign, what to do.

        `citer`: the API's answer is included in the text, because it is what
        names the failure and the message promises it. The only ones passing
        citer=False are the screens that ALREADY show it separately, in their
        own block — so as not to write it twice.
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
    """The access key was refused (401) or lacks the rights (403)."""


class QuotaEpuise(EchecDeNotreCote):
    """Out of credit (402) or too many calls in too little time (429)."""


class ServiceIndisponible(EchecDeNotreCote):
    """The CALL-E service is down (5xx) or unreachable (network)."""


class DemandeRefusee(EchecDeNotreCote):
    """CALL-E refused the REQUEST itself (a malformed request).

    A code unknown to RingBack, but received on the call's creation: nothing
    went out. It is a RingBack defect, never a fact about the contact.
    """


class ResultatEnAttente(EchecDeNotreCote):
    """THE CALL WENT OUT; its result is not known — not yet.

    THE rule, a single one, with no special case: as soon as creation has
    returned an id, the phone may have rung. Everything that fails AFTERWARDS
    (wait expired, a read timing out, connection cut, the service refusing the
    follow-up) says nothing about the person called. No attempt is counted
    against them, they are not marked `injoignable` — we keep the call's id and
    we go and fetch its result later.

    It is a failure ON OUR SIDE (it inherits from EchecDeNotreCote): the
    campaign therefore pauses, as for a refused key. What changes is the
    contact's fate: they do NOT become `à appeler` again (calling them back
    would ring their phone a second time for nothing), they become `called,
    result unknown`.
    """

    statut_audit = "résultat en attente"

    def __init__(self, constat, quoi_faire=QUOI_FAIRE_EN_ATTENTE, code=None,
                 identifiant=None):
        super().__init__(constat, quoi_faire, code=code, appel_lance=True,
                         identifiant=identifiant)

    def message(self):
        """Says what happened, what DID go out, where the call is, what to do.

        The text of RIEN_N_EST_ECRIT has no place here: something IS written
        about this contact — their state `called, result unknown`. Nothing
        false, but something.
        """
        return " ".join(morceau for morceau in (
            self.constat + ".",
            RESULTAT_ATTENDU,
            (IDENTIFIANT_CONSERVE.format(identifiant=self.identifiant)
             if self.identifiant else ""),
            self.quoi_faire) if morceau)


class DelaiDepasse(ResultatEnAttente):
    """The maximum wait expired, the call had not yet concluded.

    It was classified as a `technical failure`: the attempt was counted, and
    the contact ended up `injoignable` although their phone had rung. That is
    the 01/08/2026 case, fixed — see ResultatEnAttente.
    """

    statut_audit = "délai dépassé"


# ---------------------------------------------------------------------------
# THE FOURTH CASE: THE CONVERSATION TOOK PLACE, WE COULD NOT READ IT
# ---------------------------------------------------------------------------
# Observed on 01/08/2026 at 16:49, the fifth real test: the phone rang, the
# owner picked up and TALKED. RingBack wrote {"statut": "échec", "detail": "the
# result must be a JSON object"} and his contact became `unreachable — ceiling
# reached`. We were reading etat["result"] and etat["transcript"], two keys the
# API does not return: ONE recipient's result lives in
# recipients[].structured_result.  It is the FOURTH time the same failing has
# struck (after unknown HTTP codes, read timeouts and the wait being exceeded),
# so the rule is written once and for all: A RESULT WE CANNOT READ IS A
# RINGBACK FAULT, NEVER A FACT ABOUT THE PERSON.  And it is NOT `result
# pending`: rereading the same call would give the same unreadable answer,
# there is nothing to wait for. The contact therefore goes to `à rappeler par
# un humain` — the conversation DID take place, nobody must be called back
# automatically — with their transcript and the RAW answer preserved, and the
# campaign pauses.
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

# The length of raw answer kept: enough to understand in a minute, not enough
# to turn a log into a dump. What exceeds it is truncated WITH A NOTE (never
# cut in silence).
LIMITE_REPONSE_BRUTE = 2000


class ResultatInvalide(EchecDeNotreCote, ValueError):
    """RingBack could not read CALL-E's answer. See the block above.

    It stays a ValueError (the historic callers that caught it that way do not
    change) and becomes an EchecDeNotreCote: the campaign therefore pauses, as
    for a refused key.

    Two more pieces, and they are not decorative:
    - reponse_brute: what the API answered, word for word (truncated, numbers masked). That is what was missing on 01/08/2026 to understand in a minute instead of an hour;
    - transcription: the conversation, when it could be reconstructed. The structured result is unreadable, but the exchange exists: throwing it away would lose a second time what the person said.
    """

    statut_audit = "réponse illisible"

    def __init__(self, constat, quoi_faire=QUOI_FAIRE_REPONSE_ILLISIBLE,
                 code=None, identifiant=None, reponse_brute="",
                 transcription=""):
        # appel_lance=True, always: this exception can only be born while
        # reading the answer of a call ALREADY FINISHED at CALL-E.
        super().__init__(constat, quoi_faire, code=code, appel_lance=True,
                         identifiant=identifiant)
        self.reponse_brute = reponse_brute
        self.transcription = transcription

    def message(self):
        """What happened, what took place, the contact's fate, what to do.

        RIEN_N_EST_ECRIT has no place here: something IS written about this
        contact (`à rappeler par un humain`). Nothing false, but something —
        and the message must say so.
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
    """Reclassifies as `result pending` a failure occurring AFTER launch.

    ONE single rule, applied to the whole FAMILY rather than to the case of the
    day: the id exists, therefore the call went out, therefore the failure that
    follows does not concern the person called. The original observation is
    kept word for word (`the key was refused`, `the read timed out`…) — only
    the conclusion changes.
    """
    if isinstance(erreur, (ResultatEnAttente, ResultatInvalide)):
        # ResultatInvalide is NOT a wait: the answer arrived, it is we who
        # could not read it. Rereading would give the same unreadable answer —
        # offering `Retrieve pending results` would send the operator round in
        # circles. We keep only the id, which remains the way to find the call
        # at CALL-E.
        if not erreur.identifiant:
            erreur.identifiant = identifiant
        return erreur
    # ONE single course of action, not two `What to do` in a row: that of the
    # original failure, then retrieving the result.
    origine = (getattr(erreur, "quoi_faire", "") or "").strip()
    if origine:
        quoi_faire = origine.rstrip(".") + ". Ensuite, " + SUITE_EN_ATTENTE
    else:
        quoi_faire = QUOI_FAIRE_EN_ATTENTE
    return ResultatEnAttente(getattr(erreur, "constat", None) or str(erreur),
                             quoi_faire, code=getattr(erreur, "code", None),
                             identifiant=identifiant)


# The response codes RingBack CAN read: failure class, observation, what to do.
# A code ABSENT from this table is NOT interpreted — see _echec_de_reponse: we
# say frankly that we do not know it rather than invent an explanation.
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



# ⚠ THE BORDER: what happened TO THE PERSON, and what happened to US. Those two
# exceptions state a fact about the person called — they did not pick up, the
# agent could get nothing out of the exchange — and are therefore counted
# against them. All the others, once the call has gone out, are our own
# failures and must never be attributed to them.
IMPUTABLES_AU_CONTACT = (PasDeReponse, LectureImpossible)


def _echec_de_reponse(code, methode, chemin, creation=False):
    """The failure matching the code returned by the API — never guessed.

    What decides is NOT whether RingBack recognises the code: it is **where**
    the failure occurred. As long as the creation request (POST /v1/calls) has
    not succeeded, no phone has rung — the fault is therefore necessarily on
    OUR side, known or not, and it will strike the next contact identically. We
    do not make the contact pay for a request we formed badly.

    Observed on 01/08/2026: a 400 `result_schema is not supported` was
    classified as a `one-off failure` for want of being a known code — and the
    contact ended up `unreachable, ceiling reached` although they had never
    been called. The message stays honest about what we do not know: we say we
    do not know what the code means, but we do know what did NOT happen.
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
# THE KEY'S SHAPE, CHECKED BEFORE ANY CONNECTION
# ---------------------------------------------------------------------------
# On 01/08/2026 the CALLE_API_KEY variable contained `the dashboard address`
# instead of the key. RingBack accepted it without flinching, attempted two
# calls, and marked people `unreachable`. A common-sense check would have
# avoided all of it — here it is. It does NOT claim to validate a key (only
# CALL-E can): it refuses what manifestly is not one.
LONGUEUR_MINIMALE_CLE = 16
GUILLEMETS = "\"'«»“”"
_MARQUEURS_ADRESSE = ("://", "www.")
_EXTENSIONS_ADRESSE = (".com", ".fr", ".net", ".org", ".io", ".eu", ".dev",
                       ".app", ".ai", ".co")


def _ressemble_a_une_adresse(texte):
    """True when this text looks every bit like a web address (the observed
    mistake).
    """
    minuscules = texte.lower()
    if any(marqueur in minuscules for marqueur in _MARQUEURS_ADRESSE):
        return True
    avant_chemin = minuscules.split("/")[0]
    return any(avant_chemin.endswith(extension) or extension + "/" in minuscules
               for extension in _EXTENSIONS_ADRESSE)


def _entoure_de_guillemets(texte):
    return len(texte) >= 2 and texte[0] in GUILLEMETS and texte[-1] in GUILLEMETS


def decrire_cle(cle):
    """DESCRIBES the key without ever showing it: `23 characters, looks like a web
    address`.

    It is that description — and it alone — that is displayed, written to the
    log and comes out of an error message. Never the key.
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
    """The key written in the file, or "" — without ever logging it.

    An absent, empty or unreadable file counts as `no key`: we particularly do
    not want a read incident to look like a wrong key.
    """
    try:
        with open(chemin or CHEMIN_CLE, "r", encoding="utf-8") as fichier:
            return fichier.read().strip()
    except OSError:
        return ""


def ranger_cle(cle, chemin=None):
    """Writes the key to the file, with OWNER-ONLY access.

    ⚠ THE SHAPE IS CHECKED BEFORE WRITING. Storing a key that manifestly is not
    one would have moved the refusal to the first real call — that is, the
    worst possible moment.

    ⚠ AND THE FILE IS CREATED CLOSED. `os.open` with 0o600 sets the permissions
    AT CREATION: an ordinary `open()` followed by a `chmod` leaves a window in
    which the file is readable by everyone. On Windows the POSIX permissions
    are ignored — the `donnees/` directory is the user's own anyway, and that
    is said on screen.
    """
    valider_forme_cle(cle)  # raises when it is not one
    cible = chemin or CHEMIN_CLE
    os.makedirs(os.path.dirname(cible), exist_ok=True)
    descripteur = os.open(cible, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descripteur, "w", encoding="utf-8") as fichier:
        fichier.write(cle.strip())
    journal.info("Clé CALL-E rangée dans le fichier (%s) — jamais journalisée",
                 decrire_cle(cle))
    return True


def retirer_cle(chemin=None):
    """Deletes the key file; returns True when there was one."""
    cible = chemin or CHEMIN_CLE
    try:
        os.remove(cible)
    except OSError:
        return False
    journal.info("Clé CALL-E retirée du fichier")
    return True


def cle_disponible():
    """(key, readable source) — the VARIABLE first, the file second.

    ⚠ THE ORDER MATTERS. Somebody setting the variable for a one-off test must
    beat the file, without having to delete it. The screen always says WHERE
    the key comes from, so nobody looks in the wrong place.
    """
    depuis_variable = os.environ.get(AppelReel.VARIABLE_CLE) or ""
    if depuis_variable.strip():
        return depuis_variable, SOURCE_VARIABLE
    rangee = cle_rangee()
    if rangee:
        return rangee, SOURCE_FICHIER
    return "", ""


def cle_ignoree():
    """The STORED key that is not used, because another one wins. "" otherwise.

    ⚠ THE 03/09/2026 TRAP. The environment variable always beats the file —
    that is intended, a one-off test must take precedence. But nothing said so:
    pasting a key into the Settings screen could have NO effect at all, while
    the screen calmly displayed `key saved`. The day a campaign stops on a
    refusal, you re-paste your key, restart, get the same refusal, and hunt for
    an hour on the product's side.

    ⚠ WE DO NOT CHANGE WHO WINS, WE SAY IT. Reversing the order would break the
    one-off test by variable; staying silent costs an hour every time.
    """
    depuis_variable = (os.environ.get(AppelReel.VARIABLE_CLE) or "").strip()
    if not depuis_variable:
        return ""
    rangee = cle_rangee().strip()
    if not rangee or rangee == depuis_variable:
        return ""
    return rangee


def etat_de_la_cle():
    """What the screen is allowed to show: never the key, everything else.

    Returns a dictionary — present or not, where it comes from, its
    DESCRIPTION, and whether its shape is valid (with the reason when it is
    not).

    ⚠ Plus `ignoree`: the description of the stored key that is NOT used, when
    the environment variable imposes another. See `cle_ignoree`.
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
    """The standard refusal: what was detected, the key DESCRIBED, what to do.
    """
    return CleMalFormee(
        f"Cette clé CALL-E n'a pas la forme d'une clé : {motif}. Ce qui a "
        f"été fourni : {decrire_cle(cle)} — la clé elle-même n'est jamais "
        f"affichée, ni ici ni dans les journaux. {quoi_faire}")


def valider_forme_cle(cle):
    """A common-sense check on the key's SHAPE; returns the cleaned key.

    Raises CleApiAbsente when nothing was supplied, CleMalFormee when what was
    supplied manifestly does not have the shape of a key — SAYING what was
    detected, and without ever showing the key.

    This check does not replace CALL-E: a well-formed key may perfectly well be
    refused by the service (that is then a 401, handled above). It catches what
    can be seen without a network — a web address pasted in place of the key, a
    copy-paste with the quotation marks, too short a fragment.
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


DOMAINE_CALLE = "heycall-e.com"
HOTES_LOCAUX = ("127.0.0.1", "::1", "localhost")


def valider_adresse_api(url):
    """Checks the service's address; returns the cleaned address.

    ⚠ THERE WAS NONE UNTIL 04/09/2026, and it was a CALL-E reviewer who saw it
    on pull request #297: `CALLE_API_URL` was read from the environment and
    used as it stood. Any address — including over `http://` on a third-party
    machine — therefore received the access key in its `Authorization` header,
    and the patients' numbers in the request body. A misconfigured environment
    variable, a shared workstation, a copied tutorial: no more than that was
    needed.

    WHAT IS ACCEPTED, and nothing else:

    - `https://` on `heycall-e.com` or one of its subdomains — the real service, encrypted;
    - a LOOPBACK address (127.0.0.1, ::1, localhost), over http as over https: that is the fake API of the tests and the bench, and nothing sent to it leaves the machine.

    ⚠ WE REFUSE, WE DO NOT FALL BACK ON THE DEFAULT ADDRESS. Silently
    correcting an address set by hand would send calls somewhere other than
    where the user believes they are going. The refusal is clean, and it SAYS
    what it saw.
    """
    if not isinstance(url, str) or not url.strip():
        raise AdresseApiRefusee(
            "Adresse du service vide. Laissez CALLE_API_URL non renseignée "
            "pour utiliser l'adresse officielle de CALL-E.")
    propre = url.strip().rstrip("/")
    decoupe = urllib.parse.urlsplit(propre)
    hote = (decoupe.hostname or "").lower()
    if not decoupe.scheme or not hote:
        raise AdresseApiRefusee(
            f"« {propre} » n'est pas une adresse complète : il y manque le "
            f"protocole ou le nom du serveur. Attendu : https://{DOMAINE_CALLE}")
    local = hote in HOTES_LOCAUX
    if decoupe.scheme not in ("http", "https") or (
            decoupe.scheme == "http" and not local):
        raise AdresseApiRefusee(
            f"« {propre} » n'est pas en https. La clé d'accès et les numéros "
            "de vos patients partiraient en clair : RingBack refuse.")
    if not local and hote != DOMAINE_CALLE and not hote.endswith(
            "." + DOMAINE_CALLE):
        raise AdresseApiRefusee(
            f"« {propre} » n'est pas une adresse de CALL-E. RingBack n'envoie "
            f"sa clé d'accès qu'à {DOMAINE_CALLE} (ou à une API factice sur "
            "cette machine). Corrigez CALLE_API_URL, ou supprimez-la pour "
            "revenir à l'adresse officielle.")
    return propre


def valider_resultat(resultat):
    """Checks conformity with the schema; raises ResultatInvalide otherwise.

    Schema: appointment_status (an enumeration), new_datetime (ISO 8601
    required except for `canceled` and `to_reschedule` where it must be null —
    nothing was concluded), notes (text). And NOTHING else: see CHAMPS_RESERVES
    for the length, which CALL-E measures and RingBack has never used.
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
        # ⚠ `I WILL BE THERE` — THE COMMONEST ENDING, AND IT WAS REFUSED
        # (measured on 24/08/2026). Two kinds dictate this answer word for word
        # to the agent: `✅ Confirmation` and `🔔 Rappel de rendez-vous` say
        # `return appointment_status = "confirmed" and leave "new_datetime"
        # empty`. It has been written in the code from the start —
        # `consigne.issue(..., date="vide")` — and this check had never learned
        # it: it demanded a date for anything that is not a cancellation.  WHAT
        # THAT PRODUCED IN REAL LIFE: the FIRST person answering `yes, I will
        # be there` made the answer be declared UNREADABLE, PAUSED the campaign
        # and went to `à rappeler par un humain`. Every confirmation campaign
        # therefore stopped at its first success.  WHY SIMULATION DID NOT SHOW
        # IT: `AppelSimule` filled `new_datetime` on `confirmed` whatever
        # happened. So it never played the answer it asks for itself. That is
        # fixed at the same time — the simulator now obeys the briefing it
        # receives.  ⚠ AND IT IS NOT A RELAXATION: a date is ALWAYS demanded
        # where the outcome calls for one (a move, a booking). The shape check
        # does not know the kind — the caller knows it, and refuses cleanly
        # then (see horaires.refus_rendezvous_telephone: `with no date`).
        pass
    else:
        resultat = _date_du_calendrier(resultat, "quand une date est convenue")
    if not isinstance(resultat["notes"], str):
        raise ResultatInvalide("notes doit être un texte")
    return resultat


# ⚠ THE DATE RETURNED BY THE AGENT IS BROUGHT BACK TO THE CALENDAR'S FORMAT,
# HERE AND NOWHERE ELSE (24/08/2026, his request: `when it returns the answer
# about the chosen slot, we need the format used in the calendar`).  WHAT WAS
# WRONG, measured: the string returned went out AS IT STOOD in the schedule's
# `horaire` column. `2026-08-25T09:00`, `2026-08-25 09:00` and
# `2026-08-25T09:00:00` are the SAME instant — they entered the database under
# three different spellings, and the text comparison that decides which slot
# was taken (assistant.place_retenue) refused two out of three: the person went
# to `à rappeler par un humain` after a perfectly successful call.  WHY HERE:
# `valider_resultat` and `valider_resultat_cascade` are the ONLY two doors
# through which a result enters RingBack — real call as well as simulation.
# Fixing it in the callers meant choosing which of the eight places that read
# `new_datetime` we were going to forget.  ⚠ WE READ, WE DO NOT GUESS: an
# unrecognised form stays an UNREADABLE result, as before. The contact goes to
# a human with the raw answer preserved — never an appointment placed on an
# assumed date.
def _date_du_calendrier(resultat, exigence):
    """Brings `new_datetime` back to the calendar's format; raises when
    unreadable.
    """
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
    """An EMPTY date counts as `no date` — like a null.

    The schema sent to CALL-E can no longer declare new_datetime as `text OR
    null` (the API refuses multiple types). So the agent returns an empty
    string when no date is agreed: we bring it back to None here, once and for
    all, so the whole rest of the product goes on reasoning about `None =
    nothing agreed`.
    """
    if isinstance(resultat, dict):
        date = resultat.get("new_datetime")
        if isinstance(date, str) and not date.strip():
            return dict(resultat, new_datetime=None)
    return resultat


def _sans_date_c_est_a_reprogrammer(resultat, champ, code_deplacement):
    """`Wants something else` WITH no agreed date = `to_reschedule`.

    This is not guessing: it is what the briefing itself asks of the agent (see
    consigne.issue, parameter code_sans_date — `if a precise date has been
    agreed… otherwise return to_reschedule`). When it returns the move code
    anyway with no date, it says the same thing with the other word, and
    RingBack understands it instead of crying `unreadable`.

    Observed on 02/08/2026: the person asked for the date to be repeated, the
    agent concluded `moved` with no date, and the campaign stopped on `RingBack
    could not read it`. A perfectly clear answer.
    """
    if (isinstance(resultat, dict)
            and resultat.get(champ) == code_deplacement
            and resultat.get("new_datetime") is None):
        return dict(resultat, **{champ: "to_reschedule"})
    return resultat


def valider_resultat_cascade(resultat):
    """Checks a cascade call result; raises ResultatInvalide otherwise.

    Schema: outcome (accepted | refused | moved | to_reschedule), new_datetime
    (ISO 8601 required for `moved`; ALLOWED for `accepted` when several slots
    were announced — it is then the one the person chose; null in the other
    cases), notes (text). See CHAMPS_RESERVES for the length.

    ⚠ `ACCEPTED` HAS BEEN ALLOWED TO CARRY A DATE SINCE 03/08/2026. It could
    not, because a campaign offered only ONE slot: the slot was therefore
    already known. With a list of slots announced in the same call, the date
    returned is the ONLY way to know which was taken — refusing it paused the
    campaign on a perfectly sensible answer. The check `was that date among the
    ones announced?` is not here: it belongs to the caller, which alone knows
    what it had announced.
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
        # The slot chosen among those announced. It must be READABLE; whether
        # it was among the slots offered is the caller's job, not the shape
        # check's.
        resultat = _date_du_calendrier(
            resultat, "quand la personne retient une des places annoncées")
    elif nouvelle_date is not None:
        raise ResultatInvalide("new_datetime doit être nul sauf pour « moved »"
                               " (rien n'a été convenu)")
    if not isinstance(resultat["notes"], str):
        raise ResultatInvalide("notes doit être un texte")
    return resultat


# ---------------------------------------------------------------------------
# READING CALL-E'S ANSWER — WHERE IT ACTUALLY IS
# ---------------------------------------------------------------------------
# The terminal answer of GET /v1/calls/{id}, as the sponsor documents it
# (github.com/CALLE-AI/call-e-integrations):  {"status": "completed",
# "task_completed": true, "structured_result": {...},              <- the
# campaign's GLOBAL summary "recipients": [ {"structured_result": {...},
# <- ONE RECIPIENT'S RESULT "attempts": [{"transcript_turns": [
# {"offset_seconds": 0, "speaker": "bot",  "text": "Hi..."}, {"offset_seconds":
# 4, "speaker": "user", "text": "Yes."}]}]}]}  We were reading etat["result"]
# and etat["transcript"]: two keys that do not exist. Hence `the result must be
# a JSON object` on a successful conversation, on 01/08/2026 at 16:49.  `bot`
# and `user` become `Agent` and `Client` — the SAME labels the simulation
# produces, so the screen stays consistent whether a call is simulated or real.
ROLES_TRANSCRIPTION = {"bot": "Agent", "user": "Client"}

# A number inside a text, in the three forms that actually circulate:
# international compact or spaced (+33639980024, +33 6 39 98 00 24), a bare run
# of eight digits or more, and the spaced French national form. ISO dates
# (2026-08-02T09:30) are deliberately NOT taken: they are precisely what we
# need to read back in a raw answer.
_MOTIFS_NUMERO = (re.compile(r"\+\d[\d \.]{6,}\d"),
                  re.compile(r"(?<!\d)\d{8,}(?!\d)"),
                  re.compile(r"(?<!\d)0\d(?:[ .]\d\d){4}(?!\d)"))


def contient_numero(texte):
    """True when this text carries something that looks like a number.

    The same family of patterns as the masking — one single place decides what
    `looks like a number`, otherwise the two answers would end up diverging.
    Used to REFUSE a text meant to be dictated to the agent: the product never
    speaks a number on the phone.
    """
    return any(motif.search(texte or "") for motif in _MOTIFS_NUMERO)


def masquer_numeros_du_texte(texte):
    """Masks anything that looks like a phone number in this text.

    CALL-E's answer echoes back the number dialled. Keeping it as it stands
    would make it enter IN CLEAR into the audit log and onto the screen, where
    RingBack masks everywhere else. Doubt favours masking.
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
    """The API's answer, as text, numbers masked and length bounded.

    It is neither interpreted nor rephrased: it is a QUOTATION. That is what
    was missing on 01/08/2026 — the log said `the result must be a JSON object`
    without ever showing what the API had answered.
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
    """The answer quoted starting with the result we could not read.

    A truncated quotation must keep the essential, not the start of the
    alphabet. The structured result therefore comes first, as it stands; the
    whole answer follows, and it is THAT which will be trimmed if trimming is
    needed.
    """
    resultat = (destinataire or {}).get("structured_result")
    tete = ("structured_result du destinataire : "
            + reponse_brute_lisible(resultat))
    return tete + " — réponse entière : " + reponse_brute_lisible(etat)


def tours_du_destinataire(destinataire):
    """The turns of speech of this recipient's LAST attempt.

    Why the last: `attempts` lists the call attempts in order, and a
    conversation only takes place on the one that connected — the earlier ones
    are rings into the void. The last is therefore the one carrying the
    exchange, and it is also the one structured_result reports on. Taking the
    first would display a silence in place of a conversation; concatenating
    them all would invent an exchange that never took place in one piece.
    """
    tentatives = (destinataire or {}).get("attempts")
    if not isinstance(tentatives, list) or not tentatives:
        return []
    derniere = tentatives[-1]
    tours = (derniere or {}).get("transcript_turns")
    return tours if isinstance(tours, list) else []


def transcription_depuis_tours(tours):
    """`Agent: … / Contact: …`, in the order the API returned them.

    No sorting: the API returns the turns in conversation order, and reordering
    on a field that may be missing (offset_seconds) would be guessing. A
    speaker unknown to the table keeps THEIR label as it stands rather than
    being filed by default on the agent's side.
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
    """(validated result, transcript) from a TERMINAL CALL-E answer.

    Raises ResultatInvalide — preserving the raw answer and the transcript — as
    soon as the answer cannot be read: it is a RingBack fault, never a fact
    about the person called.

    RingBack dials only one recipient per call (see _appel_complet): so it is
    recipients[0] that is read. When there is none, we SAY so instead of going
    and looking elsewhere for a result that would resemble the right one.
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
        # The conversation itself is there: we keep it. And we quote the answer
        # STARTING WITH WHAT FAILED. On 02/08/2026 the quotation started from
        # the whole answer, sorted by key name: structured_result came last,
        # and the truncation at 2000 characters carried it off — the only piece
        # that said why.
        refus.reponse_brute = _citation_resultat_d_abord(etat, destinataire)
        refus.transcription = transcription
        raise
    return resultat, transcription


class IssueAppel:
    """What a call returns: a structured result + a transcript."""

    def __init__(self, resultat, transcription):
        self.resultat = resultat
        self.transcription = transcription


class ClientAppels:
    """The common interface: classic call-back and cascade call.

    mission (classic call-back): optional text chosen at launch (a call theme,
    pre-filled then editable); None = the historic standard mission. The
    mission text NEVER contains a number.

    consigne: the THREE-PART briefing already built by the caller (module
    consigne) — an opening spoken word for word, an objective and context
    discussed freely, closed outcomes. That is what actually goes into CALL-E's
    `task` field. Absent, the real client builds a generic one from the
    mission: no call ever goes out as a mere monologue.

    nature: the kind of campaign that is calling, or None outside a campaign
    (single call-back, call queue, real-conditions test). The REAL client does
    nothing with it — CALL-E does not know our kinds, and the briefing already
    carries everything that must be said. It serves only the SIMULATOR, to play
    the cases specific to that kind.
    """

    est_reel = False

    def appeler(self, nom_client, telephone, rendezvous, mission=None,
                consigne=None, nature=None):
        raise NotImplementedError

    def appeler_cascade(self, nom_client, telephone, mission, creneau,
                        consigne=None, nature=None):
        raise NotImplementedError

    def recommencer_les_cas(self, nature, nombre_de_contacts=None):
        """A campaign starts: replays the list of cases from the beginning.

        Does NOTHING by default, and that is intended: only the simulator has
        cases to run through. The real client has nothing to reset — real
        people are answering.
        """

    def lire_resultat(self, identifiant, cascade=False):
        """READS the result of a call ALREADY PLACED. DIALS NO NUMBER.

        No call is created here, ever: a single READ of what CALL-E recorded
        for that id. The three real-mode locks are not concerned — this gesture
        cannot make any phone ring.

        Returns {"etat": …, "statut_api": …} with, for `termine`, the key `issue` (an IssueAppel). Four possible states:
        - `termine`     : the conversation took place, the result is there;
        - `en_cours`    : the call is not finished, there is nothing to write;
        - `sans_reponse`: nobody picked up (a fact about the contact);
        - `echoue`      : CALL-E closed the call without success.

        The SIMULATION client raises LectureImpossible: no call went out there,
        so there is nothing to reread — and we do not invent it.
        """
        raise LectureImpossible(
            "Aucun résultat à relire : ce mode ne passe pas de vrais appels "
            "(simulation). Rien n'est parti chez CALL-E, il n'y a donc rien "
            "à aller y chercher — et RingBack n'invente aucun résultat.")


def _date_attendue(consigne, cle):
    """Does this briefing outcome call for a date? (default: yes)

    ⚠ WITH NO BRIEFING, THE PREVIOUS BEHAVIOUR IS KEPT. A single call-back, a
    call queue, an isolated test: they call the simulator with no campaign
    briefing, and their fallback outcomes (`ISSUES_DEFAUT`) do expect a date on
    `yes`. Changing that would have gone beyond the request.
    """
    issues = getattr(consigne, "issues", None) or {}
    return (issues.get(cle) or {}).get("date", "obligatoire") != "vide"


def _formater(horaire, langue_code="fr"):
    """`le mardi 25 août 2026 à 9 heures` — the form SPOKEN on the phone.

    ⚠ TWO USES, AND BOTH WANT THIS FORM (24/08/2026): the fallback briefing (a
    call-back outside a campaign, where no campaign has built a briefing) and
    the SIMULATION's transcripts. The simulation must resemble the real thing
    right down to the way a date is said: otherwise a simulated campaign's
    screen does not show what a real call would produce.

    ⚠ THE YEAR IS THERE, when it was not (`le 24/08 à 10h20`). A date with no
    year, spoken on the phone in December about a January appointment, is
    ambiguous — and nobody notices before somebody turns up eleven months
    early.
    """
    iso = horaire.isoformat(timespec="minutes")
    # ⚠ AND THE ARTICLE CHANGES WITH THE LANGUAGE: `on Monday 24 August`, never
    # `the Monday`. The same rule as `horaires._en_toutes_lettres`.
    if langue_code == "en":
        return f"on {themes.date_parlee(iso, 'en')}"
    return f"le {themes.date_parlee(iso)}"


def _issue_forcee(telephone):
    """A deterministic outcome derived from the number's last two digits.

    Returns the name of the demanded outcome — or None when the number is not
    in the reserved range (51 to 59): in that case the simulation follows the
    campaign's list of cases (see SUITES_PAR_NATURE).
    """
    chiffres = re.sub(r"\D", "", telephone or "")
    return TERMINAISONS_FORCEES.get(chiffres[-2:])


def _date_deplacee(reference):
    """A deterministic postponement date: two days later, at 9:30."""
    return (reference + datetime.timedelta(days=2)).replace(hour=9, minute=30)


def _creneau_propose(rendezvous):
    """The slot the agent OFFERS, and the appointment being talked about.

    Returns (reference time, slot offered). Three cases, in this order:

    - `place_proposee`: the caller has ALREADY chosen the slot, taken from the calendar's genuinely free slots (horaires.places_a_proposer). That is the case of a MISSED appointment reminder: we talk to the client about the appointment they missed (the reference time), and we offer them a slot that really exists — never a date obtained by formula;
    - `place_a_pourvoir`: the reference IS itself a free slot in the calendar (the first of those the message announces) — the agent offers THAT slot, as it stands. That is the case of the campaign kinds with no per-contact appointment;
    - otherwise (isolated tests, a planner with no settings): the standard make-up slot, one week after the reference. This last path guarantees NOTHING about availability — it survives only where the product has no settings to compute anything better.
    """
    horaire = datetime.datetime.fromisoformat(rendezvous["horaire"])
    place = _valeur(rendezvous, "place_proposee")
    if place:
        return horaire, datetime.datetime.fromisoformat(place)
    if _valeur(rendezvous, "place_a_pourvoir"):
        return horaire, horaire
    return horaire, horaire + datetime.timedelta(days=RATTRAPAGE_JOURS)


def _valeur(rendezvous, clef):
    """The value of this key when the appointment carries one, otherwise None.

    An appointment coming from the database (a dict) and a call support built
    by a campaign both pass through here without raising.
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
# WHAT THE SIMULATION PRODUCES — the sequence of outcomes
# ---------------------------------------------------------------------------
# Owner's request (10/08/2026): `in simulation mode, when campaigns are run, we
# mostly get the answers expected for each campaign, but also a little of every
# other answer we can produce. That matters for the tests.`  ⚠ WHAT WAS
# MISSING. The draw covered only THREE outcomes out of four, at similar
# weights: `wants something else, nothing agreed` (to_reschedule) NEVER came
# out, and neither did `does not pick up` — both could only be obtained by
# dialling a number ending in 55 or 53. A simulated campaign therefore did not
# show two of the paths the product knows how to handle, and it is precisely
# there that a defect hides.  ⚠ A WRITTEN SEQUENCE, NOT A RANDOM DRAW. That is
# THE point of the request — `it matters for the tests`. A draw, even with
# tuned weights, gives a number of failures that changes from one run to the
# next: a check counting the unreachable ones then becomes unstable without
# anything having moved in the product. The sequence below makes the mix EXACT
# and REPRODUCIBLE: twenty calls always give the same twenty outcomes, in the
# same order.  ⚠ THE EXPECTED ONE DOMINATES, AND THE OTHERS ARRIVE EARLY. The
# expected outcome takes thirteen places out of twenty: a campaign where half
# the calls failed would not resemble the real thing. But the first `other`
# outcome falls on the 3rd call, not the 15th: a small five-person campaign
# must already show something other than a row of yeses.  ⚠ THE FORCED ENDINGS
# ALWAYS WIN (51 to 56). They are the only way to demand ONE precise outcome in
# a demonstration or a check, and the bench holds together only through them.
PAS_DE_REPONSE = "pas_de_reponse"  # not a result status: an exception
# The suffix marking, WITHIN the written sequence, the call where the person
# also asks not to be called again. A suffix rather than a second sequence: the
# 🚫 accompanies an outcome, it does not replace it — exactly what
# CHAMP_NE_PLUS_APPELER says.
SUFFIXE_STOP = "+stop"
# The same principle for the 🔇: `I refuse, and stop offering me slots`. It
# exists ONLY on the cascade path — CHAMP_AUTRES_PLACES is declared only in
# SCHEMA_RESULTAT_CASCADE, and is only filled after a refusal.
SUFFIXE_SANS_PROPOSITION = "+sansproposition"

# The classic call-back: the expected outcome is `the person accepts the slot`.
SUITE_RAPPEL = (
    "confirmed", "confirmed", "canceled", "confirmed", "rescheduled",
    "confirmed", "confirmed", "to_reschedule", "confirmed", "canceled",
    "confirmed", "confirmed", PAS_DE_REPONSE, "confirmed", "rescheduled",
    "confirmed", "confirmed", "canceled" + SUFFIXE_STOP, "confirmed",
    "confirmed",
)
# The cascade: the expected outcome is `the person takes the freed slot`.
SUITE_CASCADE = (
    "accepted", "accepted", "refused", "accepted", "moved",
    "accepted", "accepted", "to_reschedule", "accepted", "refused",
    "accepted", "accepted", PAS_DE_REPONSE, "accepted", "moved",
    "accepted", "accepted", "refused" + SUFFIXE_STOP, "accepted",
    "accepted",
)

# ─────────────────────────────────────────────────────────────────────────────
# EVERY CASE, ACCORDING TO THE CAMPAIGN'S KIND (11/08/2026)  Owner's request:
# `in simulation mode, depending on the campaign type, we generate every
# possible case so that I can test in theory the behaviour of all those
# results`. The two sequences above did not do that: the expected outcome takes
# thirteen places out of twenty there, so a five-person campaign showed only
# two or three.  ⚠ WHY IT WAS NOT JUST A MATTER OF PROPORTIONS. On a `first
# yes` campaign (freed slot, move), the outcome that CONCLUDES stops the
# campaign: SUITE_CASCADE begins with `accepted`, so the first call filled the
# slot and the other nineteen cases never went out. No weight setting could
# have fixed that — it is the ORDER that counts.  Hence three parts per kind: ·
# `tour`        : one instance of each case that does NOT stop the campaign; ·
# `concluants`  : those that conclude it (a YES on `first yes`) — always played
# LAST, otherwise they cut the round short; · `ensuite`     : beyond the round,
# the expected outcome dominates — a fifty-person campaign must not look like a
# catalogue of failures.  ⚠ THE ROUND IS CUT TO THE CAMPAIGN (see
# AppelSimule.recommencer_les_cas). Five contacts and seven cases: only four
# cases of the round are played, then the concluding one — the slot is filled,
# as it should be — and the NEXT campaign picks the round up where this one
# left it. In two campaigns of five, all seven cases have gone by.  ⚠
# `UNREADABLE ANSWER` IS NOT IN THESE LISTS, ON PURPOSE. It produces not a
# result but an exception (ResultatInvalide), and executer_campagne then PAUSES
# the campaign: putting it in the round would stop every simulated campaign at
# the same call. It is obtained on demand, through a number ending in 59 (see
# TERMINAISONS_FORCEES).  ⚠ THE FORCED ENDINGS ALWAYS BEAT THESE LISTS. A
# number ending 51 to 59 demands ITS outcome, whatever the campaign's kind.
_STOP = SUFFIXE_STOP
_MUET = SUFFIXE_SANS_PROPOSITION
SUITES_PAR_NATURE = {
    # A slot has come free, we are looking for a taker. Only `accepted` fills
    # the slot; `moved` creates an appointment at ANOTHER date and the slot
    # therefore still needs filling (see assistant, the `moved` branch).
    "creneau_libere": {
        "chemin": "cascade",
        "tour": ("refused", "to_reschedule", "moved", PAS_DE_REPONSE,
                 "refused" + _STOP, "refused" + _MUET),
        "concluants": ("accepted",),
        "ensuite": ("accepted", "accepted", "refused", "accepted", "accepted",
                    "moved", "accepted", "accepted", "to_reschedule",
                    "accepted"),
    },
    # I have appointments to move. TWO outcomes conclude: `confirmed` (the
    # person takes the offered slot) and `rescheduled` (they want another one,
    # but they move). On `first yes` only one of the two can go out per
    # campaign — hence the rotation, which shows the other one to the next
    # campaign.
    "deplacement": {
        "chemin": "rappel",
        # ⚠ THE FIRST CALL CONCLUDES (16/08/2026, his request): `for
        # appointment-move and booking campaigns, I would like the first item
        # in simulation only to be positive (appointment accepted)`.  The round
        # starts with the cases that do NOT conclude — that is what makes it
        # possible to see them all. But when showing the product, the first
        # call gave `cancelled`: you discovered the mechanism through a
        # failure, and you had to wait for the fifth call to see an appointment
        # being placed. Those two kinds PLACE a date: that is their purpose,
        # and that is what the first call must show.  Nothing is lost: the
        # round resumes right afterwards, and the next campaign's cursor picks
        # up where this one left it.
        "premier": ("confirmed",),
        "tour": ("canceled", "to_reschedule", PAS_DE_REPONSE,
                 "canceled" + _STOP),
        "concluants": ("confirmed", "rescheduled"),
        "ensuite": ("confirmed", "confirmed", "rescheduled", "confirmed",
                    "canceled", "confirmed", "confirmed", "to_reschedule",
                    "confirmed", "confirmed"),
    },
    # A reminder about an upcoming appointment: the whole list is called,
    # nothing stops the campaign — so the round goes through in full on the
    # very first one.
    "rappel_rdv": {
        "chemin": "rappel",
        "tour": ("canceled", "rescheduled", "to_reschedule", PAS_DE_REPONSE,
                 "canceled" + _STOP),
        "concluants": ("confirmed",),
        "ensuite": ("confirmed", "confirmed", "canceled", "confirmed",
                    "confirmed", "rescheduled", "confirmed", "confirmed",
                    "to_reschedule", "confirmed"),
    },
    # Confirming attendance: the same outcomes as the reminder, the same
    # policy.
    "confirmation": {
        "chemin": "rappel",
        "tour": ("canceled", "rescheduled", "to_reschedule", PAS_DE_REPONSE,
                 "canceled" + _STOP),
        "concluants": ("confirmed",),
        "ensuite": ("confirmed", "confirmed", "canceled", "confirmed",
                    "confirmed", "to_reschedule", "confirmed", "confirmed",
                    "rescheduled", "confirmed"),
    },
    # Booking an appointment: there is no appointment to begin with.
    # `confirmed` and `rescheduled` create one, `canceled` is a `no thank you`,
    # `to_reschedule` a `call me back`.
    "prise_rdv": {
        "chemin": "rappel",
        # ⚠ THE SAME RULE AS THE MOVE (16/08/2026, his request): the first call
        # PLACES an appointment. See the block on `deplacement`.
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
    """The simulated cases of a campaign kind (None when unknown).

    Public for the checks and for the screen: it is the ONLY list of what the
    simulation can produce for a given kind.
    """
    return SUITES_PAR_NATURE.get(nature)


def issues_simulees(nature):
    """Every distinct outcome a campaign of this kind can see.

    Returns the list of raw markers (suffixes included), the round then the
    concluding ones, in the order they go out. Used by the ratchet check: if an
    outcome is added to the schema without being played anywhere, it says so.
    """
    cas = SUITES_PAR_NATURE.get(nature)
    if not cas:
        return []
    return list(cas["tour"]) + list(cas["concluants"])


class AppelSimule(ClientAppels):
    """Generates a plausible conversation without ever touching the network."""

    def __init__(self, graine=None, latence=0.4):
        self.alea = random.Random(graine)
        self.latence = latence  # seconds, imitates the dialling
        self._deja_appeles = {}  # the number's digits -> the count of calls (for `56`)
        # Where we are in each sequence of outcomes. Two counters, one per
        # path: a cascade campaign must start with its own expected outcome,
        # not pick up where a reminder left off.
        self._rangs = {"rappel": 0, "cascade": 0}
        # The CURRENT campaign's plan, per kind: the list of cases cut to its
        # size by recommencer_les_cas. One entry per kind, not a single one:
        # two campaigns of different kinds launched at the same time must not
        # tread on each other.
        self._plans = {}  # kind -> the list of that campaign's cases
        self._rangs_plan = {}  # kind -> where we are in that plan
        # Where to resume the round on the NEXT campaign of this kind. It is
        # that cursor which makes a five-person campaign eventually show all
        # seven cases, in two passes instead of one.
        self._curseurs = {}  # kind -> the rank of the next case in the round
        self._tours_faits = {}  # kind -> the number of campaigns already played

    def recommencer_les_cas(self, nature, nombre_de_contacts=None):
        """Prepares the list of cases for the campaign that is starting.

        Called ONCE per campaign launch (executer_campagne). It cuts the list
        to the campaign:

        · the cases that do not conclude first, taken from the cursor left by
        the previous campaign of this kind; · the concluding case or cases LAST
        — on a `first yes` campaign they stop it, so they cannot come before
        the others; · when there are more contacts than cases, the expected
        outcome takes over.

        An unknown `nombre_de_contacts` (None) = we assume everything fits.

        With no known kind, nothing is prepared: the calls fall back on the
        generic sequences SUITE_RAPPEL / SUITE_CASCADE (call queue, single
        call-back, real-conditions test).
        """
        cas = SUITES_PAR_NATURE.get(nature)
        if not cas:
            return
        # The case IMPOSED ON THE FIRST CALL, when the kind declares one: it
        # comes before everything else, and therefore consumes a place.
        premier = list(cas.get("premier", ()))
        tour = list(cas["tour"])
        concluants = list(cas["concluants"])
        # The concluding ones rotate by one per campaign. On `déplacement`, TWO
        # outcomes conclude and only one can go out: without this rotation,
        # `rescheduled` would never be played.
        fait = self._tours_faits.get(nature, 0)
        self._tours_faits[nature] = fait + 1
        if concluants:
            decalage = fait % len(concluants)
            concluants = concluants[decalage:] + concluants[:decalage]
        # How many cases of the round fit before the concluding ones.
        if nombre_de_contacts is None:
            place = len(tour)
        else:
            # ⚠ THE IMPOSED FIRST ONE COUNTS IN THE BUDGET. Without that term,
            # a five-contact campaign prepared a plan of six: the last
            # concluding case fell outside the list and the slot was never
            # filled — exactly the defect `place` exists to avoid.
            place = max(0, min(len(tour), nombre_de_contacts - len(concluants)
                               - len(premier)))
        depart = self._curseurs.get(nature, 0) % len(tour) if tour else 0
        retenus = [tour[(depart + i) % len(tour)] for i in range(place)]
        self._curseurs[nature] = depart + place
        suite = retenus + concluants
        if premier:
            # ⚠ AFTER THE IMPOSED SUCCESS, ALL THE REST IS SHUFFLED
            # (16/08/2026, his clarification): `I want you to start with a
            # success and the other cases afterwards, in a random order and
            # also including other potential successes`.  WHY. The purpose of a
            # simulation, in his words: `generate different possible answers so
            # I can check the impacts in RingBack`. A fixed order always gave
            # the same sequence — you ended up knowing it by heart instead of
            # exercising it. The shuffle ALSO carries the `ensuite` tail, rich
            # in successes: other successes therefore slip in among the
            # refusals, which a three-block plan could not produce.  ⚠ AND IT
            # STAYS REPRODUCIBLE: `self.alea` is seeded (see `graine`). Two
            # runs of the bench with the same seed give the same order — that
            # is what keeps his report identical byte for byte.  ⚠ BUT THE
            # SHUFFLE MUST NOT BURY THE CASES (17/08/2026). MEASURED: on an
            # eleven-contact campaign, the shuffled plan made seventeen
            # entries; the four cases that do not conclude fell beyond the
            # eleventh and were NEVER played. Eleven calls, only two outcomes —
            # when he asks to see `accepted, to be called back by a human, to
            # contact again, unreachable`.  So we shuffle WITHIN THE WINDOW
            # actually called: the cases that must appear, filled out with the
            # `ensuite` tail until that window is full. The surplus stays
            # behind, for a campaign that goes further than planned. The order
            # is random and other successes slip in — what he asked for — but
            # no case is lost outside the field.
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
            # The other kinds do not change: the cases that do NOT conclude
            # first, the concluding ones afterwards. On `créneau libéré`, a yes
            # fills the slot and stops everything — shuffling them would hide
            # every other case from the first call on.
            self._plans[nature] = suite + list(cas["ensuite"])
        self._rangs_plan[nature] = 0

    def _suivante(self, chemin, suite):
        """The next outcome in the sequence — see the block above SUITE_RAPPEL.

        The counter lives on the INSTANCE: two campaigns launched one after the
        other therefore do not replay the same series of outcomes, but a fresh
        instance always starts from the beginning. That is what makes a check
        reproducible.
        """
        rang = self._rangs[chemin]
        self._rangs[chemin] = rang + 1
        return suite[rang % len(suite)]

    def _cas_du_plan(self, nature):
        """The next case of this kind's plan, or None when there is none.

        The plan exhausts itself by looping on its last third (`ensuite`): a
        campaign longer than planned goes on ringing true instead of replaying
        the failure of its first call.
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
        """The number's forced outcome, resolving the endings that have memory.

        `56`: this instance's FIRST attempt does not pick up, the following
        ones accept — the exact sequence of a follow-up that concludes.

        `57`: they refuse AND ask not to be called again. Returned as `refuse`;
        the 🚫 travels separately (see _stop_force), because it accompanies an
        outcome instead of replacing it.
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
        """Does this ending also refuse future slots? (`58`)"""
        return _issue_forcee(telephone) == "refuse_sans_proposition"

    @staticmethod
    def _stop_force(telephone):
        """Does this ending also ask for the 🚫? (`57`)"""
        return _issue_forcee(telephone) == "refuse_et_stop"

    def _cas_suivant(self, chemin, suite, nature=None):
        """The next case: (outcome, 🚫 requested, 🔇 requested).

        The kind's plan comes first; with no known kind, the generic sequence.
        The suffixes `+stop` and `+sansproposition` mark, WITHIN the written
        list, the call where the person also asks not to be called again
        (SUFFIXE_STOP) or not to be offered slots any more
        (SUFFIXE_SANS_PROPOSITION). A suffix accompanies an outcome, it does
        not replace it — exactly like the fields it represents.
        """
        brute = self._cas_du_plan(nature)
        if brute is None:
            brute = self._suivante(chemin, suite)
        return (brute.split("+")[0],
                SUFFIXE_STOP in brute,
                SUFFIXE_SANS_PROPOSITION in brute)

    @staticmethod
    def _repondre_illisible(nom_client):
        """The `59` ending: the conversation took place, the answer did not.

        The ONLY case the simulation does not play by itself within a campaign
        (see the block above SUITES_PAR_NATURE): it returns not a result but an
        exception, and executer_campagne then pauses the campaign. So it is
        obtained on demand, through a number — enough to check the `🙋 à
        rappeler par un humain` path without breaking a whole campaign.

        The raw answer imitates what CALL-E returns when the agent could not
        conclude: an empty outcome field. The text of the conversation, though,
        exists — and that is precisely what must not be thrown away.
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
        # The three-part briefing only has a recipient at CALL-E: the
        # simulation talks to nobody, it replays a scripted conversation. So we
        # accept it without using it — rather than mimicking an agent that
        # would have read it.
        journal.info("Appel SIMULÉ vers %s (%s)", masquer_telephone(telephone), nom_client)
        if self.latence:
            time.sleep(self.latence)
        horaire, propose = _creneau_propose(rendezvous)
        force = self._resoudre_force(telephone)
        # ONE SINGLE DECISION, HERE: the forced ending when the number carries
        # one, otherwise the kind's plan — failing that the generic sequence
        # (see the block above SUITES_PAR_NATURE). The 🚫 travels BESIDE the
        # outcome, never in its place.
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
            # ⚠ THE SIMULATOR ANSWERS AS THE REAL AGENT WOULD (24/08/2026). It
            # placed a date on `confirmed` whatever happened. Yet two kinds
            # dictate the opposite — `return confirmed and leave new_datetime
            # EMPTY` — so the simulation never played the answer it asks for.
            # That is how a blocking defect passed through hundreds of
            # simulated campaigns without being seen.  The briefing received
            # carries the contract, in black and white: `issues["oui"]["date"]`
            # is `vide`, `facultative` or `obligatoire`. We read it, rather
            # than guess from the kind.
            convenu = propose if _date_attendue(consigne, "oui") else None
        elif statut == "rescheduled":
            # ⚠ ANOTHER DATE, BUT A REAL ONE (16/08/2026). The caller supplies
            # a SECOND genuinely free slot when it knows one: we take it. Only
            # without it do we fall back on the randomly drawn date — which has
            # no chance of being free, and sent the contact back to `🙋 à
            # rappeler par un humain` after a `Moved (date agreed)`.
            autre = _valeur(rendezvous, "place_alternative")
            if autre:
                convenu = datetime.datetime.fromisoformat(autre)
            elif force == "deplace":  # a deterministic date for the tests
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
        valider_resultat(resultat)  # an internal guarantee: never a result outside the schema
        transcription = self._transcription(statut, nom_client, rendezvous["motif"],
                                            propose, convenu, mission)
        return IssueAppel(resultat, transcription)

    def appeler_cascade(self, nom_client, telephone, mission, creneau,
                        consigne=None, nature=None):
        """A simulated cascade call: offers the slot, records the answer.

        The same deterministic convention as the classic call-back: the
        number's ending (51 to 59) forces the outcome; otherwise the kind's
        plan of cases, failing that the generic sequence.
        """
        journal.info("Appel cascade SIMULÉ vers %s (%s)",
                     masquer_telephone(telephone), nom_client)
        if self.latence:
            time.sleep(self.latence)
        force = self._resoudre_force(telephone)
        creneau_dt = datetime.datetime.fromisoformat(creneau)
        # The same rule as the classic call-back: the forced ending, otherwise
        # the written list. `Wants to move without concluding` (55) returns
        # `to_reschedule` HERE TOO: before 02/08/2026 the cascade did not have
        # that outcome and the simulator folded the case into a refusal — so it
        # told of a refusal where the real thing returns `nothing agreed`.
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
        # The question only arises after a refusal: elsewhere the field stays
        # absent — as its description requires. The 🔇 comes either from the 58
        # ending or from the list's `+sansproposition` marker.
        if issue == "refused":
            resultat[CHAMP_AUTRES_PLACES] = "no" if muet else "yes"
        if stop:
            resultat["notes"] += " Elle demande à ne plus être appelée."
        valider_resultat_cascade(resultat)  # never a result outside the schema
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
            # The mission chosen at launch (a call theme): the agent reads it
            # as it stands — it really is the text validated on screen.
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
    """`06 39 98 00 24` or `+33 6 39 98 00 24` → `+33639980024`.

    The CALL-E API expects the COMPACT international form (the E.164 standard):
    a `+`, the country code, then the digits, with no spaces. RingBack, for its
    part, stores numbers in readable groups so that on-screen masking works —
    both needs are legitimate, so the conversion happens here, at the last
    moment, just before sending.

    Observed on 01/08/2026: sending the spaced number made the API answer 422,
    without any phone ringing.
    """
    compact = re.sub(r"[^\d+]", "", telephone or "")
    if compact.startswith("+"):
        return compact
    if compact.startswith("0") and len(compact) == 10:
        return "+33" + compact[1:]  # French national form
    return compact


def numero_composable(telephone):
    """Does this number have the shape of one the API could dial?

    Deliberately BROAD: a `+`, a country code, and at least ten digits. It does
    not check that a number EXISTS — nobody can do that without calling. It
    sets aside what manifestly is not a number (a pasted address, a name, a
    half-typed field), and that is all it is asked to do.
    """
    compact = numero_e164(telephone)
    return (compact.startswith("+") and compact[1:].isdigit()
            and len(compact) >= 11)


# ---------------------------------------------------------------------------
# THE SCHEMA GOES INTO `recipient_result_schema`, NOT INTO `result_schema`
# ---------------------------------------------------------------------------
# Both exist at CALL-E and do NOT describe the same thing: - result_schema
# : the GLOBAL summary of the call campaign (`how many people answered yes`); -
# recipient_result_schema : ONE recipient's result, extracted independently for
# each. What RingBack describes (appointment_status / outcome, new_datetime,
# notes) is ONE person's result: it therefore goes into
# recipient_result_schema, and is read back from
# recipients[].structured_result.  BOTH ARE SENT, as in the example of the
# sponsor's API reference (`Create call`) which shows them side by side. On
# 02/08/2026, sending ONLY recipient_result_schema earned a 400 on creation: I
# had removed it by reasoning (`optional, nobody reads the global summary`),
# not on an observation. So we go back to the documented form, literally. The
# global summary stays deliberately tiny: RingBack does not read it, it is only
# there because the reference example carries it.  SCHEMA KEYWORDS ALLOWED,
# from that same reference: type, properties, required, enum, nested objects,
# simple array.items, description, additionalProperties: false. And NOTHING
# else — `minimum` is not among them.  FORBIDDEN FIELD NAMES: see
# CHAMPS_RESERVES at the top of the module. That is what made the owner's 7th
# real test fail, on 02/08/2026: `recipient_result_schema contains reserved
# field: duration_seconds`.  The schema described here: the agent MUST return
# exactly these fields — the same ones checked locally by valider_resultat().
SCHEMA_RESULTAT = {
    "type": "object",
    "properties": {
        "appointment_status": {"type": "string", "enum": list(STATUTS_VALIDES)},
        # ⚠ ONE type only, never a list: CALL-E refused the schema on
        # 01/08/2026 — `unsupported JSON Schema type at $.properties.
        # new_datetime: ['string', 'null']`. No date agreed = an EMPTY string
        # (valider_resultat treats it as an absence of date).
        "new_datetime": {
            "type": "string",
            "description": "Nouveau créneau en ISO 8601 ; nul si le client "
                           "annule ou ne conclut pas de date (to_reschedule)."},
        "notes": {"type": "string",
                  "description": "Résumé de l'échange en une ou deux phrases."},
        # ⚠ OUTSIDE `required` (see CHAMP_NE_PLUS_APPELER): a result where the
        # agent forgets it stays valid, and counts as `no`.
        CHAMP_NE_PLUS_APPELER: {
            "type": "string", "enum": list(VALEURS_NE_PLUS_APPELER),
            "description": DESCRIPTION_NE_PLUS_APPELER},
    },
    "required": list(CHAMPS_OBLIGATOIRES),
    "additionalProperties": False,
}

# The schema imposed on `first yes` cascade calls.
SCHEMA_RESULTAT_CASCADE = {
    "type": "object",
    "properties": {
        "outcome": {"type": "string", "enum": list(ISSUES_CASCADE)},
        # ⚠ ONE type only, never a list: CALL-E refused the schema on
        # 01/08/2026 — `unsupported JSON Schema type at $.properties.
        # new_datetime: ['string', 'null']`. No date agreed = an EMPTY string
        # (valider_resultat treats it as an absence of date).
        "new_datetime": {
            "type": "string",
            "description": "Autre date souhaitée en ISO 8601 quand outcome vaut "
                           "« moved » ; nul sinon."},
        # ⚠ CASCADE ONLY, and outside `required`: the question only arises
        # after a refusal, and a result without it stays valid.
        CHAMP_AUTRES_PLACES: {
            "type": "string", "enum": list(VALEURS_AUTRES_PLACES),
            "description": DESCRIPTION_AUTRES_PLACES},
        "notes": {"type": "string",
                  "description": "Résumé de l'échange en une ou deux phrases."},
        # ⚠ OUTSIDE `required` (see CHAMP_NE_PLUS_APPELER): a result where the
        # agent forgets it stays valid, and counts as `no`.
        CHAMP_NE_PLUS_APPELER: {
            "type": "string", "enum": list(VALEURS_NE_PLUS_APPELER),
            "description": DESCRIPTION_NE_PLUS_APPELER},
    },
    "required": list(CHAMPS_CASCADE),
    "additionalProperties": False,
}

# THE GLOBAL SUMMARY — sent because the reference example sends it, not because
# RingBack needs it. A RingBack call NEVER carries more than one recipient: the
# global summary therefore boils down to `was this person reached`. Nothing
# reads it on RingBack's side, and that is written here so nobody goes looking
# later for where this field is used: nowhere.
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
# THE TIMINGS OF A REAL CALL — configurable in ⚙ Réglages
# ---------------------------------------------------------------------------
# The original values (120 s of waiting, 15 s per request) were those of a
# SIMULATION, where everything concludes in a second. A real phone conversation
# does not fit inside them, and that is what lost the call of 01/08/2026. The
# default values below are sized for a real call, and each is configurable in
# `⚙ Réglages`.  - total wait, 10 minutes: ringing (up to ~1 min before
# voicemail) + the exchange (2 to 5 min when another date must be agreed, a
# diary consulted, hesitation) + the time for CALL-E to write the transcript
# and the structured result. Ten minutes leave margin without ever blocking the
# campaign indefinitely; - interval between two polls, 5 seconds: at 2 s the
# API was polled 300 times for a single call; at 5 s, 120 times — and the
# result is known at most 5 seconds after the conversation ends; - the timeout
# of ONE request, 30 seconds: that is the one that gave way (`The read
# operation timed out` at 15 s). An API under load can take several seconds to
# answer; 30 s lets a hiccup through without freezing the screen.
CLE_DELAI_TOTAL = "appel_delai_total"          # secondes
CLE_DELAI_INTERVALLE = "appel_delai_intervalle"
CLE_DELAI_REQUETE = "appel_delai_requete"

DELAI_TOTAL_DEFAUT = 600.0
DELAI_INTERVALLE_DEFAUT = 5.0
DELAI_REQUETE_DEFAUT = 30.0

# Input bounds: beyond them, it is no longer a setting, it is a fault.
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
    """The three configured real-call timings, or their default values.

    Returns {"delai_total", "intervalle", "delai_requete"} — the names of
    AppelReel's parameters, so they can be passed as they stand.
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
    """Checks ONE timing typed in; returns the integer, raises ValueError in
    French.
    """
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
    """The real CALL-E wiring — inert as long as the 3 locks hold.

    Constructing itself with no key is impossible: no real client can exist by accident. A call's sequence:
    1. POST {base}/v1/calls: the mission in French + the recipient + the two schemas from the documented example — `recipient_result_schema` (ONE person's result, the only one RingBack reads back) and `result_schema` (the global summary, sent to match the example);
    2. GET {base}/v1/calls/{id} in a loop until the status is `completed` (or failure / wait exceeded → a clean exception, hence NO result written to the database by the planner);
    3. lire_appel_termine(): the result is read from recipients[0].structured_result and the conversation is reconstructed from recipients[0].attempts[].transcript_turns[]; an unreadable answer is rejected BEFORE any writing, preserving the raw answer (ResultatInvalide);
    4. an audit row (timestamp, MASKED number, status) is appended to donnees/audit_appels_reels.jsonl, on success as on failure.
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
        # THE SHAPE CHECK, here and nowhere else: no real client can exist with
        # a key that manifestly is not one. It raises before any connection,
        # and its message describes the key without ever showing it (see
        # valider_forme_cle). ⚠ TWO SOURCES SINCE 10/08/2026: the variable,
        # then the file (see `cle_disponible`). The shape check itself has not
        # moved — it is here, and nowhere else.
        self.cle_api = valider_forme_cle(cle_api or cle_disponible()[0]
                                         or None)
        # ⚠ THE ADDRESS IS CHECKED LIKE THE KEY (04/09/2026). It was not: the
        # environment variable was used as it stood, so the access key and the
        # patients' numbers could go out to any server, possibly in clear. See
        # valider_adresse_api for what is accepted, and why.
        self.url_base = valider_adresse_api(
            url_base or os.environ.get(self.VARIABLE_URL) or self.URL_DEFAUT)
        self.delai_total = delai_total      # attente maximale d'un appel complet (s)
        self.intervalle = intervalle        # pause entre deux interrogations (s)
        self.delai_requete = delai_requete  # network timeout of ONE HTTP request (s)
        self.chemin_audit = chemin_audit or CHEMIN_AUDIT
        # The last call ACTUALLY created at CALL-E: kept as soon as the POST
        # succeeds, so that a call that went out can no longer be lost.
        self.dernier_identifiant = None
        # THE TEST REDIRECT: a written number, or — better — a FUNCTION that
        # reads it from the settings. See _numero_impose: it is read back at
        # every call, never retained.
        self.numero_impose = numero_impose
        # ⚠ THE CALL'S LANGUAGE IS READ BACK, LIKE THE IMPOSED NUMBER. The
        # client is built ONCE at start-up: retaining the language here would
        # send out a call in French when the screen has just switched to
        # English — and the briefing, for its part, would have followed. The
        # two MUST move together: an English briefing with an agent set to
        # French is worse than anything, the agent would read English with a
        # French voice and prosody.
        self.langue_appel = langue_appel

    def appliquer_delais(self, delai_total=None, intervalle=None,
                         delai_requete=None):
        """Changes the timings of an ALREADY BUILT client (⚙ Réglages saved).

        Without this, a modified setting would only take effect at restart —
        the screen would say one thing and the product do another.
        """
        if delai_total:
            self.delai_total = float(delai_total)
        if intervalle:
            self.intervalle = float(intervalle)
        if delai_requete:
            self.delai_requete = float(delai_requete)

    LOCALES = {"fr": ("FR", "fr-FR"), "en": ("GB", "en-GB")}

    def _region_et_locale(self):
        """(region, locale) for THIS call's departure — read back each time.

        ⚠ THIS PAIR TELLS CALL-E WHICH VOICE TO USE, not only which words. That
        is why it follows the briefing instead of being hard-written: both are
        decided in the same place, the language setting.
        """
        return self.LOCALES.get(self._code_langue(), self.LOCALES["fr"])

    def _code_langue(self):
        """`fr` or `en` for THIS call's departure — read back each time.

        ⚠ ONE SINGLE COMPUTATION FOR THE VOICE AND FOR THE WORDS (03/09/2026).
        There was one for the voice, and nothing for the briefing: the same
        POST ordered an English voice and gave it French instructions. Two
        computations that diverge make an agent that contradicts itself; a
        single one cannot.
        """
        valeur = self.langue_appel
        if callable(valeur):
            try:
                valeur = valeur()
            except Exception:                            # noqa: BLE001
                valeur = None
        # ⚠ `str()` FIRST: a setting read back from a damaged JSON file may
        # return a number, a list, anything. A call must not fail on the TYPE
        # of a language setting.
        code = str(valeur or "").strip().lower() or "fr"
        return code if code in self.LOCALES else "fr"

    def _numero_impose(self):
        """The number that REPLACES the contact's, or "" — READ BACK AT EVERY
        CALL.

        ⚠ READ BACK, NEVER RETAINED, and that is the important point. The real
        client is built ONCE, at server start-up: a setting changed along the
        way would never take effect, and the screen would say the opposite of
        what goes out. `numero_impose` therefore accepts a FUNCTION (the server
        passes it the settings read) just as well as a written number (the
        tests). It is the same reason that gave birth to appliquer_delais;
        here, there is not even a setting to reapply — so nothing to forget.
        """
        valeur = self.numero_impose
        if callable(valeur):
            valeur = valeur()
        return (valeur or "").strip()

    def _numero_a_composer(self, telephone):
        """THE ONLY place where the number actually dialled is decided.

        Here, and nowhere else: every real call goes through `_appel_complet`,
        which calls this method on its first line. No caller can therefore
        forget the redirect, and there is only one place to read to know which
        phone is going to ring.

        THE IDENTITY DOES NOT MOVE BY A WORD: the name, the reason, the
        appointment and the mission are already written into the task, and this
        method does not touch them. That is the request, word for word — `the
        identity is unchanged` — and it is what gives the test its value: the
        conversation is EXACTLY the one the contact would have had.

        ⚠ AN UNREADABLE IMPOSED NUMBER REFUSES THE CALL, it NEVER falls back on
        the contact's. Falling back would ring a real phone at the very moment
        the screen promises none will ring: the one ending that cannot be
        recovered from. A refusal, by contrast, can be read and fixed.
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
        # `nature` is received and IGNORED, on purpose: it serves only to run
        # through the simulator's cases. Here, a real person answers — nothing
        # to script. See ClientAppels.
        masque = masquer_telephone(telephone)
        journal.info("Appel RÉEL vers %s (%s)", masque, nom_client)
        try:
            resultat, transcription = self._appel_complet(
                self._tache(nom_client, rendezvous, mission, consigne),
                telephone, SCHEMA_RESULTAT, valider_resultat)
        except PasDeReponse as erreur:
            # A failure ATTRIBUTABLE TO THE CONTACT: the log says so as it
            # stands, as it already does for the cascade. Writing `échec` here
            # mixed `they did not pick up` and `our software is down` into one
            # word — the two log rows read the same.
            self._auditer(masque, "pas de réponse", str(erreur))
            raise
        except ResultatInvalide as refus:
            # THE CONVERSATION TOOK PLACE and we could not read it: the log
            # keeps the RAW ANSWER, to understand in a minute instead of an
            # hour (see the ResultatInvalide class).
            self._auditer(masque, refus.statut_audit, str(refus),
                          reponse_brute=refus.reponse_brute)
            raise
        except EchecDeNotreCote as erreur:
            # A failure ON OUR SIDE: the audit log must say that no call went
            # out, not `échec` (which would suggest the person did not answer).
            # ResultatEnAttente and DelaiDepasse belong here and carry their
            # own audit status. The API's answer goes into its own column:
            # rereading one audit row must be enough to know which field CALL-E
            # refused.
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
        """A REAL cascade call: the same sequence, the cascade result schema.

        Somebody who does not pick up raises PasDeReponse (audited `pas de
        réponse`): the cascade will move on to the next person — no result is
        invented.

        `nature` is received and ignored, as for the classic call-back.
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
        """The status written to the audit log for a failure on our side.

        `no call launched` as long as the creation request has not succeeded:
        that is the verifiable truth, and it avoids rereading an `échec` row
        later believing the client did not answer. A failure occurring AFTER
        the launch carries its own status (`result pending`, `timeout
        exceeded`): those rows say that a call DID go out and that its result
        remains to be retrieved.
        """
        if erreur.statut_audit:
            return erreur.statut_audit
        if erreur.appel_lance == APPEL_INCERTAIN:
            return "appel incertain"
        return "échec de notre côté" if erreur.appel_lance else "aucun appel lancé"

    # ----------------------------------------------------------------- interne
    def _appel_complet(self, tache, telephone, schema, validateur):
        # THE TEST REDIRECT HAPPENS HERE, ON THE FIRST LINE: see
        # _numero_a_composer. Both callers (appeler, appeler_cascade) have
        # already masked THE CONTACT's number for their log — that is intended:
        # the log says who we wanted to reach, and the audit row says, beside
        # it, that the call was redirected.
        telephone = self._numero_a_composer(telephone)
        # THE BORDER: as long as this POST has not succeeded, NOTHING has gone
        # out — no phone has rung, no credit has been consumed. That is what
        # allows (or not) the message to write it in black and white.
        region, locale = self._region_et_locale()
        creation = self._requete("POST", "/v1/calls", {
            "task": tache,
            "recipients": [{"phones": [numero_e164(telephone)],
                            "region": region, "locale": locale}],
            # ONE recipient per call, therefore ONE result per recipient: see
            # the block above SCHEMA_RESULTAT. Both schemas go out together, as
            # in the documented example.
            "result_schema": SCHEMA_BILAN_GLOBAL,
            "recipient_result_schema": schema,
        })
        identifiant = creation.get("id") or creation.get("call_id")
        if not identifiant:
            raise ErreurApi("création d'appel sans identifiant dans la réponse")
        # HERE THE CALL HAS GONE OUT. Everything that fails from this line on
        # will be reclassified as `result pending` and will keep THIS id: it is
        # the only thing that will make it possible to find out what the
        # conversation produced (see _en_attente_apres_lancement).
        self.dernier_identifiant = identifiant
        try:
            return self._attendre_le_resultat(identifiant, validateur)
        except IMPUTABLES_AU_CONTACT:
            # ⚠ THOSE TWO ARE FACTS ABOUT THE PERSON, not failures: they did
            # not pick up, or the agent could get nothing out of the exchange.
            # Reclassifying them as `result pending` would erase a real fact
            # and leave the contact waiting for a result that will never come.
            # They are raised as they are.
            raise
        # ⚠ AND EVERYTHING ELSE IS RECLASSIFIED (03/09/2026). The comment above
        # already announced the rule — `everything that fails from this line
        # on` — but the catch-up covered only `EchecDeNotreCote`. A follow-up
        # answer that is not JSON (a gateway's error page, a truncated body) or
        # an unknown HTTP code raise a BARE `ErreurApi`: neither a fact about
        # the person, nor a recognised failure. It slipped through — the
        # attempt was counted against them, a follow-up armed (the phone rang a
        # SECOND time for an exchange already concluded), and the CALL-E id
        # lost, so the result irretrievable.
        except ErreurApi as panne:
            raise _en_attente_apres_lancement(panne, identifiant) from panne

    def _attendre_le_resultat(self, identifiant, validateur):
        """Polls the call until it concludes; returns (result, transcript)."""
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
        # A consistency lock: an unreadable answer raises ResultatInvalide
        # HERE, hence before the planner writes anything — and it carries the
        # raw answer and the transcript with it.
        return lire_appel_termine(etat, validateur)

    # ------------------------------------------------- relire, sans appeler
    def lire_resultat(self, identifiant, cascade=False):
        """READS the result of a call ALREADY PLACED. DIALS NO NUMBER.

        A single GET /v1/calls/{identifiant}, never a POST: this path CANNOT
        create a call — there is not a line here that would allow it. That is
        what makes the `📥 Récupérer les résultats en attente` gesture harmless:
        at worst it finds nothing.

        See ClientAppels.lire_resultat for the shape of what is returned.
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
        """One HTTP request; turns every failure into a SPEAKING exception.

        appel_lance: had the phone call already been requested when this
        request goes out? False for the creation, true for the follow-up. It is
        that value which decides whether the message is allowed to state that
        nobody was called.
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
            # WHAT THE API SAYS, word for word: without that, a refusal boils
            # down to a code number and you have to guess. Observed on
            # 01/08/2026: a silent 422 cost two hours when the answer named the
            # offending field. We truncate (an answer can be long) and we look
            # for no meaning in it: it is a quotation, not an analysis.
            try:
                dit = erreur.read().decode("utf-8", "replace").strip()
            except Exception:                        # noqa: BLE001
                dit = ""
            if dit:
                # A JSON body: we quote it as it stands rather than doubly
                # escaped ({\"error\": …} is unreadable for somebody who has to
                # find the field).
                try:
                    dit = reponse_brute_lisible(json.loads(dit))
                except (TypeError, ValueError):
                    dit = reponse_brute_lisible(dit)
            echec = _echec_de_reponse(erreur.code, methode, chemin,
                                      creation=not appel_lance)
            if isinstance(echec, EchecDeNotreCote):
                echec.appel_lance = appel_lance
                # The quotation lives in reponse_brute, NOT in args[0]: this
                # family recomposes its message and has never read args[0].
                if dit:
                    echec.reponse_brute = dit
            elif dit:
                echec.args = (f"{echec.args[0]} — réponse de l'API : "
                              f"{dit}",) + echec.args[1:]
            raise echec from erreur
        except urllib.error.URLError as erreur:
            # Network cut, DNS silent, connection refused: the request could
            # not even GO OUT (urllib only wraps sending failures in URLError).
            # It is never the contact's fault, and the same failure will hit
            # the next call.
            raise ServiceIndisponible(
                "Le service CALL-E est injoignable depuis cet ordinateur "
                f"({erreur.reason})", QUOI_FAIRE_RESEAU,
                appel_lance=appel_lance) from erreur
        except (json.JSONDecodeError, UnicodeDecodeError) as erreur:
            raise ErreurApi("réponse illisible (JSON attendu)") from erreur
        except (TimeoutError, http.client.HTTPException, OSError) as erreur:
            # THE FAMILY THAT WENT THROUGH — and that cost the call of
            # 01/08/2026. urllib only wraps in URLError what fails at SENDING;
            # everything that fails afterwards (getresponse(), read()) comes up
            # as it is: - TimeoutError (an alias of socket.timeout): `The read
            # operation timed out` — the observed case, which is NOT a subclass
            # of URLError; - http.client.HTTPException: RemoteDisconnected,
            # IncompleteRead, BadStatusLine — the server hangs up; - the other
            # OSErrors: connection reset, SSL error. They all fell into the
            # campaign engine's `except Exception`, became `echec`, consumed an
            # attempt and tipped the contact into `injoignable`. So they are
            # handled as a FAMILY, not one by one.  And the request had GONE
            # OUT: saying `nobody was called` would be false. Hence `uncertain`
            # when it is the creation that failed that way.
            raise ServiceIndisponible(
                "La réponse de CALL-E n'est jamais revenue sur "
                f"{methode} {chemin} ({type(erreur).__name__} : {erreur})",
                QUOI_FAIRE_RESEAU,
                appel_lance=(True if appel_lance else APPEL_INCERTAIN)
                ) from erreur

    def _tache(self, nom_client, rendezvous, mission=None, consigne=None):
        """THE BRIEFING dictated to the agent — without EVER writing the number in
        it.

        consigne: the three parts already built by an assistant campaign
        (assistant.consigne_de_l_appel) — that is the normal case, and it is
        exactly what the step-2 preview showed.

        Without it (single call-back, call queue, real test), the same
        three-part briefing is built here, from what we know: the opening
        message, the appointment concerned and the slot offered. Never a
        monologue — that is what made the agent STIFF on the owner's 5th real
        test (see the consigne module).
        """
        if consigne is not None:
            return consigne.texte()
        # The slot offered comes out of the SAME computation as the simulation
        # (_creneau_propose): when the caller has chosen a genuinely free slot,
        # it is THAT one that is dictated to the agent — never a date obtained
        # by formula that could fall in the past.
        code = self._code_langue()
        dire = mod_langue.traducteur(code)
        # ⚠ `:` IS FLUSH IN ENGLISH, the non-breaking space is a French rule.
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
        """The cascade briefing — without EVER putting the number in it."""
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
        """One JSON row per real call attempted — number ALWAYS masked.

        reponse_brute: what the API answered, word for word, when RingBack
        could not read it. That is exactly what was missing on 01/08/2026 — the
        log said `the result must be a JSON object` without ever showing on
        what. The numbers in it are masked as everywhere else.
        """
        ligne = {"horodatage": datetime.datetime.now().isoformat(timespec="seconds"),
                 "telephone": telephone_masque, "statut": statut}
        # ⚠ THE REDIRECT IS WRITTEN INTO THE ROW. The masked number above is
        # THE CONTACT's — that is who we wanted to reach, and that is what must
        # be readable afterwards. But without mentioning the redirect, the same
        # row would suggest that this contact was called. These two keys appear
        # ONLY when the redirect is active: an ordinary call log does not
        # change shape.
        impose = self._numero_impose()
        if impose:
            ligne["renvoi_essai"] = ("appel renvoyé vers le numéro d'essai "
                                     "imposé : ce contact n'a PAS été appelé")
            # An unreadable imposed number made the call be REFUSED (see
            # _numero_a_composer): masking it would give a row of dots with no
            # meaning at all. The row says what really happened.
            ligne["numero_appele"] = (masquer_telephone(impose)
                                      if numero_composable(impose)
                                      else "numéro d'essai illisible")
        if genre:
            ligne["genre"] = genre
        if detail:
            ligne["detail"] = detail
        if reponse_brute:
            # ⚠ MASKED HERE, AT THE POINT OF WRITING (04/09/2026). It was not:
            # every caller today masks upstream, through
            # `reponse_brute_lisible`, but the GUARANTEE was nowhere — it
            # rested on each caller's discipline. A CALL-E reviewer raised it
            # on pull request #297: `the documented masked-only audit can
            # persist raw provider content`.  ⚠ AND TWO TEXTS ALREADY PROMISED
            # THE OPPOSITE: the docstring above (`number ALWAYS masked`) and
            # the published README (`one line per real call: timestamp, masked
            # number, status`). A promise kept by habit is not kept: CALL-E's
            # answer ECHOES the number dialled, and this file is the one whose
            # reason to exist is to contain none. Masking is idempotent —
            # putting it back here costs nothing to those who already masked.
            ligne["reponse_brute"] = masquer_numeros_du_texte(
                str(reponse_brute))
        dossier = os.path.dirname(self.chemin_audit)
        if dossier:
            os.makedirs(dossier, exist_ok=True)
        with open(self.chemin_audit, "a", encoding="utf-8") as fichier:
            fichier.write(json.dumps(ligne, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# THE SAME CHECK, ON THE COMMAND LINE — for configurer_cle.cmd
# ---------------------------------------------------------------------------
# The shape check must ALSO apply when the key is saved, not only when real
# mode starts. Rather than rewriting it in batch-file language (two versions =
# two truths), the script calls THIS code. It receives the file's PATH, never
# the key as an argument: a key passed as an argument would be readable in the
# process list.
def controle_fichier_cle(chemin):
    """Checks the key written in this file; returns (accepted?, message).

    The message NEVER contains the key — it describes it (see decrire_cle).
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
    """Entry point `python -m ringback.calle_client --fichier <path>`.

    Returns 0 when the shape is acceptable, 1 otherwise — it is that exit code
    configurer_cle.cmd reads back to stop before saving a key that is not one.
    """
    try:  # Windows console: never crash on an accent
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
