"""File d'appels avec garde-fous + cascade « premier oui ».

Trois verrous indépendants avant tout appel RÉEL :
1. le client d'appels doit détenir une clé (sinon il ne se construit pas) ;
2. le drapeau global dry_run (vrai par défaut) doit être levé explicitement ;
3. confirmer_appels_reels() doit avoir été appelé sur CETTE instance.
Les appels simulés, eux, passent toujours. Un appel en file peut être
annulé tant qu'il n'a pas été exécuté. La cascade « premier oui » passe
par les MÊMES verrous que la file classique.

DEUX RÈGLES DE PLUS, tenues ici pour qu'aucune porte n'y échappe :
- le MOMENT : la plage d'appel autorisée et la période interdite sont
  revérifiées dans verifier_garde_fous(), par où passe TOUTE exécution
  d'appels (file, cascade, campagne, relance due) — aucune dérogation,
  même pour un geste déclenché à la main ;
- la DATE CONVENUE AU TÉLÉPHONE : un rendez-vous n'est écrit que si la
  place existe vraiment (jour ouvert, dans les horaires, libre, assez
  longue). Sinon RIEN n'est écrit et la raison — avec la date demandée en
  clair — est rendue à l'appelant, qui la met sous les yeux d'un humain.
Ces deux règles demandent les réglages : ils sont passés au constructeur
(preferences). Sans eux, le planificateur ne prétend rien vérifier.

ET LA DATE PROPOSÉE, symétrique de la précédente : la place offerte en
rattrapage d'un rendez-vous manqué sort de horaires.places_a_proposer() —
les places réellement libres, à la durée du rendez-vous — et non d'une
formule « date manquée + 7 jours » qui pouvait tomber dans le passé. Quand
il n'y a plus aucune place libre, AUCUN appel ne part et l'écran le dit :
on ne propose pas une date qu'on ne peut pas tenir.
"""

import datetime
import logging

from . import calle_client, db, horaires, themes

journal = logging.getLogger("ringback.planificateur")

# Mission proposée par défaut sur la page cascade (le gabarit du thème
# « créneau libéré ») ; [entreprise] vient des réglages, [créneau] est
# remplacé automatiquement par la date choisie au moment de l'appel.
MISSION_EXEMPLE = themes.GABARITS["creneau_libere"]

MOTIF_CRENEAU_ATTRIBUE = "Créneau libéré attribué (cascade « premier oui »)"
MOTIF_AUTRE_DATE = "Rendez-vous convenu par téléphone (cascade « premier oui »)"

# ------------------------------- l'ancien rendez-vous, dans la cascade directe
# LE TROU Q7, REFERMÉ. Une cascade directe part d'une liste « Nom;Téléphone »
# collée à la main : elle ne dit PAS de quel rendez-vous le client parle.
# Quand il prend le créneau libéré (« accepted ») ou convient d'une autre date
# (« moved »), son ancien rendez-vous doit pourtant partir — sinon il en a
# deux et une place reste bloquée pour rien.
# La règle appliquée, et sa limite assumée :
#   - le contact est reconnu comme un client DÉJÀ en fiche (db.client_connu,
#     qui ne crée rien) ET il a EXACTEMENT UN rendez-vous à venir → c'est
#     celui-là, il est libéré selon horaires.decision_annulation ;
#   - il en a PLUSIEURS → on n'invente rien : RingBack ne sait pas duquel il
#     s'agit. La ligne le dit en clair, un humain tranche ;
#   - il n'est pas en fiche, ou il n'a aucun rendez-vous à venir → il n'y a
#     rien à libérer, et on ne dit rien plutôt que d'inquiéter pour rien.
NOTE_ANCIEN_AMBIGU = (
    "Ancien rendez-vous à libérer dans votre agenda : {nom} a {nombre} "
    "rendez-vous à venir dans RingBack ({dates}) — impossible de savoir "
    "duquel il parlait. Rien n'a été supprimé : à vous de choisir.")
NOTE_ANCIEN_LIBERE = (
    "Ancien rendez-vous {date} libéré ({statut}) : {pourquoi}")

# Issue « le client a dit oui, mais la date convenue ne tient pas » : aucun
# rendez-vous n'est écrit, la personne passe à un rappel PAR UN HUMAIN avec
# la date demandée en clair. Ce n'est ni un refus ni un succès : c'est un
# accord que la machine ne sait pas honorer sans casser le planning.
ISSUE_DATE_REFUSEE = "date_refusee"

# Issue « plus aucune place libre à proposer » : l'appel N'EST PAS PASSÉ.
# Décision du propriétaire (Q6) : « On propose toujours des dates selon la
# disponibilité réelle, pas en estimant une date algorithmiquement en
# espérant que cela tombe sur un moment incertain. » Sans place réellement
# libre, il n'y a rien à proposer au téléphone : on se tait plutôt que
# d'inventer une date. La raison est écrite en clair sur l'appel.
NOTE_SANS_PLACE = (
    "Personne n'a été appelé : plus aucune place libre à proposer dans les "
    "{jours} prochains jours. Aucune date n'a été inventée. Libérez une "
    "place, ou ouvrez des horaires dans « ⚙ Réglages », puis rappelez.")


def _mission_effective(mission, creneau):
    """Remplace le gabarit [créneau] par la date proposée, lisible en français."""
    creneau_dt = datetime.datetime.fromisoformat(creneau)
    return mission.replace("[créneau]", creneau_dt.strftime("le %d/%m/%Y à %Hh%M"))


class GardeFou(RuntimeError):
    """Un garde-fou a bloqué l'exécution d'un appel réel."""


class ClientExclu(RuntimeError):
    """Le client est marqué « Ne plus appeler » : appel refusé (réversible)."""


class Planificateur:
    """preferences : les réglages (horaires d'ouverture, jours fermés).

    Sans eux, une date convenue au téléphone ne peut pas être vérifiée : le
    planificateur écrit alors ce que l'agent a rendu, comme avant. Le
    serveur les fournit toujours ; seuls des essais isolés s'en passent.
    """

    def __init__(self, base, client_appels, dry_run=True, preferences=None):
        self.base = base
        self.client_appels = client_appels
        self.dry_run = dry_run
        self.preferences = preferences
        self._appels_reels_confirmes = False
        self.file = []  # entrées : {"appel_id": int, "rendezvous_id": int}

    def confirmer_appels_reels(self):
        """Confirmation explicite, à donner à chaque session (jamais persistée)."""
        self._appels_reels_confirmes = True

    def programmer(self, rendezvous_id):
        """Met un appel en file pour ce rendez-vous ; rend l'identifiant d'appel.

        Refuse (ClientExclu) si le client est marqué « Ne plus appeler » :
        cette exclusion vaut pour TOUT chemin d'appel, individuel compris.
        """
        rdv = self.base.obtenir_rendezvous(rendezvous_id)
        if rdv is None:
            raise ValueError(f"Rendez-vous inconnu : {rendezvous_id}")
        if rdv["ne_plus_appeler"]:
            raise ClientExclu(
                f"{rdv['nom']} est marqué « Ne plus appeler » : aucun appel "
                "ne lui sera passé. Le drapeau se lève depuis la page "
                "« Clients » si besoin.")
        appel_id = self.base.creer_appel(rendezvous_id)
        self.file.append({"appel_id": appel_id, "rendezvous_id": rendezvous_id})
        journal.info("Appel n°%d mis en file pour %s (%s)",
                     appel_id, rdv["nom"], rdv["telephone_masque"])
        return appel_id

    def programmer_tous_les_manques(self):
        """Met en file tous les rendez-vous manqués pas encore en file.

        Rend la liste des identifiants d'appels créés (vide si rien de
        nouveau) ; un rendez-vous déjà en file n'est jamais doublé, un
        rendez-vous SANS numéro (import ICS pas complété) n'est pas mis en
        file (rien à composer), et un client marqué « Ne plus appeler »
        est toujours sauté.
        """
        deja_en_file = {entree["rendezvous_id"] for entree in self.file}
        crees = []
        for rdv in self.base.rendezvous_manques():
            if not rdv["telephone_masque"]:
                journal.info("Rendez-vous n°%d sans numéro : non mis en file "
                             "(à compléter d'abord)", rdv["id"])
                continue
            if rdv["ne_plus_appeler"]:
                journal.info("Rendez-vous n°%d : client « Ne plus appeler », "
                             "jamais mis en file", rdv["id"])
                continue
            if rdv["id"] not in deja_en_file:
                crees.append(self.programmer(rdv["id"]))
        return crees

    def file_detaillee(self):
        """La file, enrichie des informations affichables (numéros masqués)."""
        detail = []
        for entree in self.file:
            rdv = self.base.obtenir_rendezvous(entree["rendezvous_id"])
            detail.append({"appel_id": entree["appel_id"], "rendezvous": rdv})
        return detail

    def annuler(self, appel_id):
        """Retire un appel de la file avant exécution. Rend True si trouvé."""
        for entree in self.file:
            if entree["appel_id"] == appel_id:
                self.file.remove(entree)
                self.base.changer_statut_appel(appel_id, "annulé")
                journal.info("Appel n°%d annulé avant exécution", appel_id)
                return True
        return False

    def annuler_tout(self):
        """« Vider la file » : annule TOUS les appels en attente d'un coup.

        Rend le nombre d'appels annulés. Comme l'annulation unitaire, ne
        touche que les appels PAS ENCORE exécutés.
        """
        annules = 0
        for entree in list(self.file):
            if self.annuler(entree["appel_id"]):
                annules += 1
        return annules

    def purger_rendezvous(self, rendezvous_ids):
        """Retire de la file les appels liés à ces rendez-vous (suppression client).

        Aucun statut n'est écrit : les appels vont être supprimés de la
        base avec le client. Rend le nombre d'entrées retirées.
        """
        vises = set(rendezvous_ids)
        avant = len(self.file)
        self.file = [entree for entree in self.file
                     if entree["rendezvous_id"] not in vises]
        return avant - len(self.file)

    def _verifier_moment(self, hors_plage_permis=False):
        """La plage d'appel autorisée ET la période interdite — pour TOUT.

        Décision du propriétaire (R2) : la période interdite vaut sur les
        cinq portes, sans dérogation, même pour un geste manuel. Comme
        toute exécution d'appels passe par verifier_garde_fous, la règle est
        tenue ici une fois pour toutes plutôt que recopiée porte par porte.
        Sans réglages fournis (essais isolés), il n'y a rien à vérifier.

        `hors_plage_permis` : le geste « forcer malgré l'heure » a été fait
        (voir assistant.CLE_HORAIRE_FORCE). Il ne lève QUE la plage horaire —
        jamais la période interdite — et il n'est honoré que si le client
        d'appels est SIMULÉ. C'est la garantie de fond : elle ne repose pas
        sur la bonne foi de l'appelant, mais sur l'objet qui compose les
        numéros. Un client réel refuse de lever quoi que ce soit, même si
        toutes les couches au-dessus le lui demandent.
        """
        if self.preferences is None:
            return
        # Import local : themes est déjà importé, assistant ne l'est pas
        # (il importe campagnes, qui importe ce module).
        from . import assistant
        simulation = not getattr(self.client_appels, "est_reel", False)
        message = assistant.dans_periode_interdite(self.preferences)
        if message is None and not (hors_plage_permis and simulation):
            message = themes.hors_plage(self.preferences)
        if message:
            raise GardeFou(message)

    def _verifier_garde_fous(self, hors_plage_permis=False):
        self._verifier_moment(hors_plage_permis)
        if not getattr(self.client_appels, "est_reel", False):
            return  # simulation : toujours permise
        if self.dry_run:
            raise GardeFou(
                "dry_run actif : aucun appel réel ne peut partir. Passer "
                "dry_run=False EN PLUS de la confirmation explicite.")
        if not self._appels_reels_confirmes:
            raise GardeFou(
                "Confirmation explicite manquante : appeler "
                "confirmer_appels_reels() avant tout appel réel.")

    def verifier_garde_fous(self, hors_plage_permis=False):
        """Les MÊMES trois verrous, exposés aux campagnes et aux relances.

        Toute exécution d'appels — file, cascade, campagne, relance due —
        passe par CETTE vérification : les verrous ne sont jamais dupliqués
        ni contournés. Lève GardeFou si un appel réel n'est pas permis.

        `hors_plage_permis` : voir `_verifier_moment`. Seule la campagne s'en
        sert, et seulement en simulation.
        """
        self._verifier_garde_fous(hors_plage_permis)

    def executer(self, seulement=None, mission=None):
        """Traite la file ; rend la liste des identifiants d'appels passés.

        Avec seulement=<appel_id>, seul cet appel est traité : les autres
        restent en file (utilisé par le bouton « Rappeler » individuel).
        mission : texte facultatif choisi au lancement (thème d'appel) —
        [client] et [date_rdv] y sont substitués PAR APPEL ; sans mission,
        chaque client d'appels garde sa consigne standard.
        """
        self._verifier_garde_fous()
        if seulement is None:
            a_traiter = list(self.file)
        else:
            a_traiter = [e for e in self.file if e["appel_id"] == seulement]
        traites = []
        for entree in a_traiter:
            self.file.remove(entree)
            appel_id = entree["appel_id"]
            rdv = self.base.obtenir_rendezvous(entree["rendezvous_id"])
            if rdv is None:  # client supprimé entre la mise en file et ici
                self.base.terminer_appel(
                    appel_id, "annulé", note=db.REFUS_CLIENT_SUPPRIME)
                journal.info("Appel n°%d abandonné : le rendez-vous n'existe "
                             "plus", appel_id)
                continue
            refus = self._refus_avant_composition(rdv)
            if refus:  # FILET DE SÉCURITÉ : le 🚫 relu à l'instant de composer
                self.base.terminer_appel(appel_id, "annulé", note=refus)
                journal.info("Appel n°%d NON composé : %s", appel_id, refus)
                continue
            telephone = self.base.telephone_de(rdv["client_id"])
            if not telephone:  # import ICS pas encore complété : rien à composer
                self.base.terminer_appel(appel_id, "échec",
                                         note=db.REFUS_SANS_NUMERO)
                journal.error("Appel n°%d en échec : aucun numéro pour %s "
                              "(à compléter avant de rappeler)", appel_id, rdv["nom"])
                continue
            # LA PLACE PROPOSÉE : une place réellement libre de l'agenda, à
            # la durée de CE rendez-vous, calculée à l'instant de l'appel.
            # S'il n'y en a plus aucune, on n'appelle pas — et on le dit.
            support, sans_place = self._support_de_l_appel(rdv)
            if sans_place:
                self.base.terminer_appel(appel_id, "annulé", note=sans_place)
                journal.info("Appel n°%d NON composé : %s", appel_id, sans_place)
                continue
            mission_appel = (themes.finaliser(mission, rdv["nom"], rdv["horaire"])
                             if mission else None)
            try:
                issue = self.client_appels.appeler(rdv["nom"], telephone, support,
                                                   mission=mission_appel)
            except calle_client.ResultatEnAttente as attente:
                # L'APPEL EST PARTI : il ne doit surtout PAS repartir en file
                # (le téléphone sonnerait une seconde fois pour une
                # conversation qui a déjà eu lieu). On garde l'identifiant
                # CALL-E et on écrit ce qui est vrai : le résultat manque.
                self.base.terminer_appel(appel_id, "en attente",
                                         note=str(attente))
                self.base.definir_appel_externe(appel_id, attente.identifiant)
                journal.error("File d'appels : l'appel n°%d EST PARTI, son "
                              "résultat n'est pas connu (appel CALL-E n° %s)",
                              appel_id, attente.identifiant)
                raise
            except calle_client.ResultatInvalide as refus:
                # LA CONVERSATION A EU LIEU et RingBack n'a pas su la lire.
                # L'appel ne repart PAS en file (le téléphone sonnerait une
                # seconde fois pour rien) et il n'est pas écrit « échec » :
                # sa fiche porte la RÉPONSE BRUTE de CALL-E et la
                # transcription, pour qu'un humain reprenne en une minute.
                self.base.terminer_appel(
                    appel_id, "réponse illisible",
                    transcription=refus.transcription or None,
                    note=str(refus) + (
                        f"\nRéponse brute de CALL-E : {refus.reponse_brute}"
                        if refus.reponse_brute else ""))
                if refus.identifiant:
                    self.base.definir_appel_externe(appel_id,
                                                    refus.identifiant)
                journal.error("File d'appels : l'appel n°%d a ABOUTI mais sa "
                              "réponse est illisible — %s", appel_id,
                              refus.constat)
                raise
            except calle_client.EchecDeNotreCote as panne:
                # Panne DE NOTRE CÔTÉ (clé refusée, service en panne…) :
                # l'appel n'a pas eu lieu, il REPART EN FILE tel qu'il était
                # — aucun « échec » ne lui est collé, aucun client n'est mis
                # en cause — et la fournée s'arrête là : les suivants
                # échoueraient tous de la même façon.
                self.file.insert(0, entree)
                journal.error("File d'appels interrompue au n°%d — %s",
                              appel_id, panne)
                raise
            except Exception as erreur:
                self.base.terminer_appel(appel_id, "échec")
                journal.error("Appel n°%d en échec : %s", appel_id, erreur)
                continue
            self.base.terminer_appel(appel_id, "terminé", issue.resultat,
                                     issue.transcription)
            self._honorer_ne_plus_appeler(issue.resultat, rdv.get("client_id"),
                                          rdv["nom"], telephone)
            note = self._appliquer_issue(rdv, issue.resultat)
            if note:
                self.base.noter_appel(appel_id, note)
            traites.append(appel_id)
        return traites

    def _honorer_ne_plus_appeler(self, resultat, client_id, nom, telephone):
        """Le 🚫 demandé PENDANT l'appel — sur la fiche, tout de suite.

        ⚠ LA PROMESSE EST DITE SUR TOUS LES CHEMINS, PAS SEULEMENT EN
        CAMPAGNE (03/09/2026). La consigne dictée à l'agent contient toujours
        « c'est noté, vous ne serez plus appelé » ; le champ `do_not_call`
        est toujours demandé dans le schéma. Mais seul l'assistant le lisait :
        depuis la file d'appels ou la cascade directe, la personne s'entendait
        promettre qu'on ne la rappellerait plus, et rien n'était écrit. Elle
        était rappelée le lendemain. Promettre sans tenir est pire que ne rien
        promettre — et ce n'est pas qu'une question de courtoisie.

        ⚠ SUR LA FICHE DU CLIENT, comme le fait l'assistant : le drapeau vaut
        pour TOUS les appels à venir, pas seulement pour cette file-là.

        Rend Vrai si le drapeau a été posé.
        """
        if not calle_client.ne_plus_appeler_demande(resultat):
            return False
        cible = client_id or self.base.client_pour_contact(nom, telephone)
        if not cible:
            journal.warning("🚫 demandé au téléphone mais aucune fiche "
                            "trouvée pour « %s » — rien n'a pu être marqué",
                            nom)
            return False
        self.base.definir_ne_plus_appeler(cible, True)
        journal.info("🚫 demandé au téléphone : fiche n°%d marquée "
                     "« ne plus appeler »", cible)
        return True

    def _refus_avant_composition(self, rdv):
        """Le FILET DE SÉCURITÉ, relu à l'instant même de composer.

        Le 🚫 « Ne plus appeler » peut avoir été posé APRÈS la mise en file :
        il est donc revérifié ici, sur le numéro ET sur le nom (une fiche
        dont le numéro vient d'être corrigé reste reconnue par son nom).
        Rend le message de refus, ou None.
        """
        if rdv["ne_plus_appeler"]:
            return db.REFUS_STOP
        if self.base.nom_exclu(rdv["nom"]):
            return db.REFUS_STOP_NOM
        return None

    def _support_de_l_appel(self, rdv):
        """Le rendez-vous envoyé à l'agent, enrichi d'une place RÉELLEMENT libre.

        Rend (support, refus). Le support est le rendez-vous manqué lui-même
        — c'est de CELUI-LÀ qu'on parle au client — augmenté de la place
        qu'on lui propose en rattrapage. Cette place vient de
        horaires.places_a_proposer(), la MÊME source que les créneaux
        annoncés dans les campagnes : elle est libre, à la bonne durée, un
        jour ouvert, et devant nous. Plus jamais « la date manquée + 7
        jours », qui pouvait tomber dans le passé.

        ⚠ ET UNE SECONDE PLACE, pour le cas « la personne en propose une
        AUTRE » (18/08/2026). Les campagnes la fournissent depuis le
        16/08/2026 — voir `assistant._support_de_l_appel` — et le commentaire
        de `calle_client` dit ce qu'elle coûte quand elle manque : « sans elle
        […] on retombe sur la date tirée au sort, qui n'a aucune chance d'être
        libre ». La file d'appels, elle, ne la fournissait pas.

        CE QUE ÇA DONNAIT, mesuré le 18/08/2026 : sur un rendez-vous manqué le
        19/07, l'autre date convenue tombait le 21/07 — un mois dans le passé.
        Le rendez-vous n'était pas déplacé, il était perdu. Deux chemins vers
        le même téléphone, un seul qui proposait des dates réelles.

        Trois cas où l'on ne prétend rien :
        - sans réglages (essais isolés), le support part tel quel et
          l'ancienne convention de rattrapage s'applique ;
        - plus AUCUNE place libre : refus explicite, aucun appel ;
        - une seule place libre : pas de seconde à offrir, et c'est honnête —
          on n'en invente pas.
        """
        if self.preferences is None:
            return rdv, None
        tranches = horaires.duree_tranches(rdv)
        # ⚠ LA PREMIÈRE PLACE GARDE SON CALCUL, ET C'EST VOLONTAIRE.
        # `places_a_proposer` porte ses propres replis — notamment le cas « aucun
        # horaire d'ouverture réglé », où il n'y a pas de semaine type à
        # parcourir et où la place se cherche autrement. Ma première version
        # l'avait remplacé par le calcul des places libres : huit essais sont
        # tombés d'un coup, tous sur des bases sans semaine type — plus aucun
        # appel ne partait. On AJOUTE la seconde place, on ne refait pas la
        # première.
        _, place = horaires.places_a_proposer(
            self.base, self.preferences, tranches=tranches)
        if not place:
            return None, NOTE_SANS_PLACE.format(jours=horaires.HORIZON_JOURS)
        support = dict(rdv)
        support["place_proposee"] = place
        autres = [libre for libre in horaires.places_libres_elargies(
            self.base, self.preferences, tranches=tranches, limite=3,
            depuis=horaires.plancher_de_proposition()) if libre != place]
        if autres:
            support["place_alternative"] = autres[0]
        return support, None

    def _refus_date_convenue(self, horaire, tranches=1, sauf_rdv=None,
                             place_choisie=False):
        """Le refus d'écrire une date convenue au téléphone, ou None.

        Sans réglages fournis au planificateur, aucune vérification n'est
        possible : on ne refuse alors rien (et on ne prétend pas vérifier).
        """
        if self.preferences is None:
            return None
        return horaires.refus_rendezvous_telephone(
            self.base, self.preferences, horaire, tranches=tranches,
            sauf_rdv=sauf_rdv, place_choisie=place_choisie)

    def _appliquer_issue(self, rdv, resultat):
        """Répercute l'issue de l'appel sur le rendez-vous ; rend une NOTE ou None.

        ⚠ UNE DATE CONVENUE AU TÉLÉPHONE DÉPLACE LA LIGNE ; elle n'en crée
        JAMAIS une seconde. C'est vrai des deux façons d'accepter — prendre le
        créneau proposé (« confirmed ») ou convenir d'une autre date
        (« rescheduled ») : pour la personne appelée c'est le même événement,
        et l'écran écrit « ✅ accepté » dans les deux cas.

        ⚠ CE N'ÉTAIT PAS LE CAS, ET C'EST SON CONSTAT DU 17/08/2026 : « le
        premier rendez-vous n'a pas été annulé, mais on l'a bien ajouté pour le
        lendemain ». « rescheduled » marquait l'ancienne ligne « déplacé » et
        en créait une SECONDE à la date convenue. Mesuré sur sa journée du
        18/08 : quatre lignes se déplaçaient proprement, deux restaient sur la
        journée — elle ne se vidait qu'à moitié dans ses archives et sur les
        fiches de ses clients.

        La décision était pourtant déjà prise, par lui, le 14/08/2026 : « tu
        déplaces un rendez-vous d'une date à une autre, c'est ultra simple ».
        Elle avait été écrite dans `assistant._rendre_la_place` et dans
        `assistant._deplacer_le_rendezvous` — pas ici. Trois chemins pour une
        règle, deux qui l'appliquaient.

        ⚠ ET « déplacé » VOULAIT DÉJÀ DIRE AUTRE CHOSE PARTOUT AILLEURS : une
        personne dont le rendez-vous a bougé SANS nouvelle date, donc qui
        ATTEND (voir `db.STATUTS_A_RECASER`, `jeu_essai` — « déplacés SANS
        nouvelle date » — et `etats_clients`, qui en déduit « déplacement en
        attente : lui trouver la nouvelle date »). Écrire « déplacé » sur
        quelqu'un qui VIENT d'obtenir une date, c'était le ranger parmi ceux à
        qui il faut en trouver une. Un seul garde-fou l'empêchait d'être
        rappelé — le `NOT EXISTS` de `rendezvous_a_recaser` —, et un garde-fou
        n'est pas une règle.

        L'histoire ne se perd pas : le cahier des changements porte UNE ligne ↔
        avec les deux dates, et c'est LUI le livrable de la campagne. Une ligne
        fantôme dans l'agenda n'était pas une mémoire, c'était un doublon.

        « to_reschedule » (déplacement voulu mais NON conclu) ne change RIEN au
        rendez-vous : rien n'a été convenu — c'est le rôle d'une relance de
        conclure. C'est désormais le seul cas où la personne attend vraiment.

        Toute date convenue AU TÉLÉPHONE est vérifiée comme une saisie à la
        main : jour fermé, horaires d'ouverture, place déjà prise, durée qui
        ne tient pas. Si elle ne tient pas, RIEN n'est écrit et la raison est
        rendue en clair (elle devient la note de l'appel) — le planning ne
        devient jamais faux, et l'accord obtenu n'est pas perdu pour autant.
        """
        statut = resultat["appointment_status"]
        tranches = horaires.duree_tranches(rdv)
        if statut == "canceled":
            self.base.mettre_a_jour_rendezvous(rdv["id"], statut="annulé")
        elif statut == "to_reschedule":
            journal.info("Rendez-vous n°%d : déplacement voulu mais non conclu "
                         "— rendez-vous inchangé, à relancer", rdv["id"])
        else:
            # confirmed | rescheduled : une date A ÉTÉ convenue. La MÊME ligne
            # change d'heure et passe « confirmé » — la personne a dit oui.
            refus = self._refus_date_convenue(resultat["new_datetime"],
                                              tranches, sauf_rdv=rdv["id"])
            if refus:
                return self._note_date_refusee(rdv, resultat, refus)
            ancienne = rdv["horaire"]
            self.base.mettre_a_jour_rendezvous(
                rdv["id"], statut="confirmé", horaire=resultat["new_datetime"])
            if resultat["new_datetime"] != ancienne:
                journal.info("Rendez-vous n°%d déplacé : %s -> %s", rdv["id"],
                             ancienne, resultat["new_datetime"])
        return None

    @staticmethod
    def _note_date_refusee(rdv, resultat, refus):
        """La note d'un rendez-vous NON écrit : la raison + la date demandée
        EN CLAIR (rien de ce qui a été obtenu au téléphone n'est perdu)."""
        journal.info("Rendez-vous n°%d : date convenue refusée (%s)",
                     rdv["id"], resultat.get("new_datetime"))
        return horaires.note_date_refusee(refus, resultat.get("new_datetime"))

    def appliquer_issue(self, rdv, resultat):
        """L'application d'issue, exposée aux campagnes (même logique, un seul
        code). Rend la NOTE si la date convenue a été refusée, sinon None."""
        return self._appliquer_issue(rdv, resultat)

    def _liberer_ancien_de_cascade(self, nom, telephone, pourquoi,
                                   maintenant=None):
        """L'ancien rendez-vous du contact, libéré si on sait lequel.

        Rend (rendezvous_libere_id, note). La note est le texte lisible à
        poser sur la ligne de cascade : soit ce qui a été libéré, soit
        pourquoi RingBack n'a rien touché. (None, None) quand il n'y a
        simplement rien à dire. Voir le commentaire de NOTE_ANCIEN_AMBIGU
        pour la règle et sa limite.
        """
        client_id = self.base.client_connu(nom, telephone)
        if client_id is None:
            return None, None
        a_venir = self.base.rendezvous_a_venir_du_client(client_id)
        if not a_venir:
            return None, None
        if len(a_venir) > 1:
            dates = ", ".join(themes.date_lisible(r["horaire"])
                              for r in a_venir)
            return None, NOTE_ANCIEN_AMBIGU.format(
                nom=nom, nombre=len(a_venir), dates=dates)
        ancien = a_venir[0]
        decision = horaires.decision_annulation(self.preferences,
                                                ancien["horaire"], maintenant)
        self.base.mettre_a_jour_rendezvous(ancien["id"],
                                           statut=decision["statut"])
        journal.info("Cascade : ancien rendez-vous n°%d de %s passé « %s » "
                     "(%s)", ancien["id"], nom, decision["statut"], pourquoi)
        return ancien["id"], NOTE_ANCIEN_LIBERE.format(
            date=themes.date_lisible(ancien["horaire"]),
            statut=decision["statut"], pourquoi=decision["pourquoi"])

    # ----------------------------------------------------------------- cascade
    def executer_cascade(self, personnes, mission, creneau):
        """Cascade « premier oui » : un appel à la fois, DANS L'ORDRE.

        personnes : liste [{"nom", "telephone"}] déjà validée (saisie.
        analyser_liste_cascade) ; mission : texte lu par l'agent ([créneau]
        y est remplacé par la date) ; creneau : ISO 8601. Déroulé :
        - « accepted » -> ARRÊT : rendez-vous créé (confirmé) au créneau
          pour cette personne, les suivantes sont ÉPARGNÉES (jamais appelées) ;
        - « moved »    -> rendez-vous créé (prévu) à la date demandée, mais
          le créneau reste libre : la cascade CONTINUE ;
        - « refused », pas de réponse, échec technique -> personne suivante ;
        - liste épuisée sans oui -> cascade close « épuisée », bilan honnête.
        Une personne dont le numéro appartient à un client marqué « Ne plus
        appeler » n'est JAMAIS composée : elle est tracée « exclue », même
        collée à la main. Les MÊMES garde-fous que la file classique
        s'appliquent AVANT tout appel réel. Rend l'identifiant de la
        cascade (tout est en base).
        """
        self._verifier_garde_fous()
        mission_lue = _mission_effective(mission, creneau)
        cascade_id = self.base.creer_cascade(mission_lue, creneau)
        rendezvous_attribue = None
        for rang, personne in enumerate(personnes, start=1):
            nom, telephone = personne["nom"], personne["telephone"]
            # FILET DE SÉCURITÉ : le numéro OU le nom d'un client 🚫 suffit
            # à écarter la ligne, même collée à la main.
            if self.base.telephone_exclu(telephone) or self.base.nom_exclu(nom):
                journal.info("Cascade n°%d, rang %d : client « Ne plus "
                             "appeler », jamais composé", cascade_id, rang)
                # ⚠ LA RAISON EST ÉCRITE, pas seulement l'état. La cascade se
                # rejoue ensuite en campagne (`campagnes._rejouer_la_cascade`),
                # et c'est cette note qui lui dit que la personne doit partir
                # vers un HUMAIN plutôt que disparaître (voir db.suite_du_refus).
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="exclu",
                    note=(db.REFUS_STOP
                          if self.base.telephone_exclu(telephone)
                          else db.REFUS_STOP_NOM))
                continue
            if rendezvous_attribue is not None:  # créneau déjà pris : on épargne
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="épargné")
                continue
            try:
                issue = self.client_appels.appeler_cascade(
                    nom, telephone, themes.finaliser(mission_lue, nom), creneau)
            except calle_client.PasDeReponse:
                journal.info("Cascade n°%d, rang %d : pas de réponse", cascade_id, rang)
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="appelé", issue="no_answer")
                continue
            except calle_client.ResultatEnAttente as attente:
                # L'appel EST parti : sa ligne est écrite (avec l'identifiant
                # CALL-E dans la note, pour qu'il ne soit pas perdu) et la
                # cascade s'arrête. Personne n'est déclaré « pas de réponse »
                # alors que son téléphone a sonné.
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="appelé",
                    issue="en_attente", note=str(attente))
                self.base.cloturer_cascade(cascade_id, "interrompue")
                journal.error("Cascade n°%d : l'appel du rang %d EST PARTI, "
                              "son résultat n'est pas connu (appel CALL-E "
                              "n° %s)", cascade_id, rang, attente.identifiant)
                raise
            except calle_client.ResultatInvalide as refus:
                # La conversation a eu lieu ; nous ne savons pas la lire. La
                # ligne est écrite avec la transcription et la réponse BRUTE
                # — jamais « pas de réponse », qui accuserait la personne —
                # et la cascade s'arrête là.
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="appelé",
                    issue="reponse_illisible",
                    transcription=refus.transcription or None,
                    note=str(refus) + (
                        f"\nRéponse brute de CALL-E : {refus.reponse_brute}"
                        if refus.reponse_brute else ""))
                self.base.cloturer_cascade(cascade_id, "interrompue")
                journal.error("Cascade n°%d : l'appel du rang %d a ABOUTI "
                              "mais sa réponse est illisible — %s",
                              cascade_id, rang, refus.constat)
                raise
            except calle_client.EchecDeNotreCote as panne:
                # Panne DE NOTRE CÔTÉ : la cascade s'arrête NET. Aucune ligne
                # n'est écrite pour cette personne (son téléphone n'a pas
                # sonné), la cascade est close « interrompue » — jamais
                # « épuisée », qui ferait croire que la liste a été essayée —
                # et l'appelant reçoit le message pour l'afficher.
                self.base.cloturer_cascade(cascade_id, "interrompue")
                journal.error("Cascade n°%d interrompue au rang %d — %s",
                              cascade_id, rang, panne)
                raise
            except Exception as erreur:
                journal.error("Cascade n°%d, rang %d : échec (%s)",
                              cascade_id, rang, erreur)
                self.base.ajouter_appel_cascade(
                    cascade_id, rang, nom, telephone, etat="appelé", issue="echec")
                continue
            outcome = issue.resultat["outcome"]
            self._honorer_ne_plus_appeler(issue.resultat, None, nom, telephone)
            libere_id, note_libere = None, None
            if outcome == "accepted":
                # Créneau CHOISI par l'utilisateur : jugé sur le jour fermé
                # et sur le double emploi, pas sur les horaires d'ouverture.
                refus = self._refus_date_convenue(creneau, place_choisie=True)
                if refus:
                    # Le créneau proposé n'est plus tenable (pris entre-temps,
                    # jour devenu fermé) : rien n'est écrit, la cascade
                    # continue et la raison reste lisible sur la ligne.
                    journal.info("Cascade n°%d, rang %d : créneau refusé (%s)",
                                 cascade_id, rang, refus)
                    self.base.ajouter_appel_cascade(
                        cascade_id, rang, nom, telephone, etat="appelé",
                        issue=ISSUE_DATE_REFUSEE, resultat=issue.resultat,
                        transcription=issue.transcription, note=refus)
                    continue
                # L'ancien rendez-vous est cherché AVANT d'écrire le nouveau :
                # sinon le nouveau se compterait lui-même parmi les
                # « rendez-vous à venir » du client.
                libere_id, note_libere = self._liberer_ancien_de_cascade(
                    nom, telephone, "le client a pris le créneau libéré")
                client_id = self.base.client_pour_contact(nom, telephone)
                rendezvous_attribue = self.base.ajouter_rendezvous(
                    client_id, creneau, MOTIF_CRENEAU_ATTRIBUE, statut="confirmé")
                journal.info("Cascade n°%d : créneau attribué au rang %d "
                             "(rendez-vous n°%d)", cascade_id, rang, rendezvous_attribue)
            elif outcome == "moved":
                refus = self._refus_date_convenue(
                    issue.resultat.get("new_datetime"))
                if refus:
                    journal.info("Cascade n°%d, rang %d : autre date refusée "
                                 "(%s)", cascade_id, rang, refus)
                    self.base.ajouter_appel_cascade(
                        cascade_id, rang, nom, telephone, etat="appelé",
                        issue=ISSUE_DATE_REFUSEE, resultat=issue.resultat,
                        transcription=issue.transcription, note=refus)
                    continue
                # MÊME RÈGLE QUE « accepted » (Q7) : une autre date convenue
                # doit rendre l'ancienne place, sans quoi le client aurait
                # deux rendez-vous. Cherché AVANT d'écrire le nouveau.
                libere_id, note_libere = self._liberer_ancien_de_cascade(
                    nom, telephone, "le client a convenu d'une autre date")
                client_id = self.base.client_pour_contact(nom, telephone)
                # ⚠ « confirmé », COMME « accepted » JUSTE AU-DESSUS
                # (17/08/2026). Les deux façons de dire oui écrivaient deux
                # états : « confirmé » quand la personne prenait le créneau
                # offert, « prévu » quand elle convenait d'une autre date. Même
                # oui, deux pastilles de couleurs différentes au planning, et
                # deux phrases différentes sur sa fiche.
                autre = self.base.ajouter_rendezvous(
                    client_id, issue.resultat["new_datetime"], MOTIF_AUTRE_DATE,
                    statut="confirmé")
                journal.info("Cascade n°%d, rang %d : autre date convenue "
                             "(rendez-vous n°%d)", cascade_id, rang, autre)
            self.base.ajouter_appel_cascade(
                cascade_id, rang, nom, telephone, etat="appelé", issue=outcome,
                resultat=issue.resultat, transcription=issue.transcription,
                note=note_libere, rendezvous_libere=libere_id)
        statut_final = "pourvue" if rendezvous_attribue else "épuisée"
        self.base.cloturer_cascade(cascade_id, statut_final, rendezvous_attribue)
        journal.info("Cascade n°%d close : %s", cascade_id, statut_final)
        return cascade_id
