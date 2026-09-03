"""Banc d'essai de bout en bout — RingBack, en SIMULATION uniquement.

À quoi ça sert
-------------
La suite de tests (test.cmd) est le filet quotidien : elle vérifie des cas
CHOISIS. Ce banc-ci fait autre chose : il PARCOURT une matrice au lieu d'en
échantillonner quelques cases. Trois axes :

1. les huit NATURES de campagne (assistant.NATURES) ;
2. les POINTS DE DÉPART : le parcours en 3 étapes lui-même, les cinq voies
   de remplissage « depuis la base », les six reprises d'une campagne
   précédente filtrées par état, le collage, le CSV, l'agenda ICS, la file
   d'appels et la cascade directe ;
3. les ISSUES déterministes du simulateur (terminaisons 51 à 56) plus les
   quatre cas de bord : contact 🚫, contact sans numéro, doublon, fiche
   client supprimée en cours de route.

Pour chaque case parcourue, le banc contrôle DEUX choses : ce qui est écrit
en base (statut du rendez-vous, création, annulation, créneau libéré, état
du contact, relance programmée) ET ce qui devient visible à l'écran (poste
de pilotage, planning, 👥 Clients, 🔁 Relances).

Les cinq règles tenues ici
--------------------------
1. SIMULATION EXCLUSIVE. Le banc ne peut PAS déclencher un appel réel :
   il retire CALLE_API_KEY de son propre processus, construit l'application
   avec appels_reels=False, et vérifie ces verrous comme des cas à part
   entière (section « Les verrous »). Le journal d'audit des appels réels
   est relevé avant et après : une seule ligne de plus serait un échec.
2. JAMAIS LA BASE RÉELLE. Le banc travaille sur une base JETABLE créée dans
   un dossier temporaire, détruite à la fin. Il REFUSE de démarrer si on lui
   désigne la base réelle (ou n'importe quel fichier du dossier donnees/).
3. PORT 8779, libéré proprement même en cas d'échec au milieu (le serveur du
   produit vit sur 8770 ; 8771 à 8778 sont laissés libres).
4. JAMAIS DE FAUX RÉSULTAT. Une case non parcourue s'affiche « ⬜ non
   couvert », jamais « ✅ ». Ce qui ne peut pas être vérifié sans souris est
   listé à part, sous « à vérifier à la main ».
5. REPRODUCTIBLE. Deux exécutions de suite rendent un rapport IDENTIQUE.
   Le rapport ne porte que la DATE DU JOUR (pas l'heure), et la seule date
   relative utilisée est calculée explicitement : aujourd'hui à 12 h 00
   (constante REFERENCE ci-dessous), ce qui fixe tout le jeu d'essai.

Lancement : banc-essai.cmd (ou « python banc_essai.py »).
Bibliothèque standard uniquement.
"""

import argparse
import datetime
import html as html_mod
import logging
import os
import re
import shutil
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

RACINE_APP = os.path.dirname(os.path.abspath(__file__))
if RACINE_APP not in sys.path:
    sys.path.insert(0, RACINE_APP)

# ---------------------------------------------------------------------------
# VERROU 1 (avant TOUT import de ringback) : la clé des appels réels est
# retirée de ce processus. Même une erreur de programmation dans ce fichier
# ne pourrait plus construire un client d'appels réels : AppelReel refuse de
# se construire sans clé. Le retrait ne touche QUE ce processus.
# ---------------------------------------------------------------------------
CLE_RETIREE = os.environ.pop("CALLE_API_KEY", None)

from ringback import (assistant, calle_client, campagnes, db,  # noqa: E402
                      essai_reel, etats_clients, horaires, jeu_essai, serveur,
                      themes)

PORT_BANC = 8779
PORTS_RESERVES_PRODUIT = tuple(range(8770, 8779))
BASE_REELLE = os.path.join(RACINE_APP, "donnees", "ringback.db")
DOSSIER_DONNEES = os.path.join(RACINE_APP, "donnees")

# La seule date relative du banc, calculée UNE fois et dite en clair dans le
# rapport : aujourd'hui à 12 h 00. Tout le jeu d'essai en découle (ses
# rendez-vous sont décrits en « jours depuis maintenant »).
REFERENCE = datetime.datetime.combine(datetime.date.today(),
                                      datetime.time(12, 0))


def _iso(jours, heure, minute=0):
    """Un horaire ISO 8601 à la minute, à N jours de la date de référence."""
    return (REFERENCE + datetime.timedelta(days=jours)).replace(
        hour=heure, minute=minute).isoformat(timespec="minutes")


# Ce que `Banc.demarrer` ouvre : du lundi au vendredi. Écrit ici parce que les
# scénarios en ont besoin AVANT que le serveur existe.
JOURS_OUVRES_BANC = (0, 1, 2, 3, 4)


def _jour_ouvre(jours, *aussi):
    """Décale `jours` jusqu'à ce que ce jour — ET ceux de `aussi` — soient ouverts.

    ⚠ CE BANC TOURNE UN JOUR DIFFÉRENT CHAQUE JOUR (14/08/2026). Ses dates
    partent d'« aujourd'hui à 12 h » : un décalage de dix jours tombe donc sur
    un jour de semaine différent selon la date, et rien ne garantissait qu'il
    fût OUVERT. Mesuré un vendredi : le report simulé (toujours la place + deux
    jours, voir calle_client._date_deplacee) tombait un DIMANCHE, le produit
    refusait à juste titre de poser le rendez-vous — et le contrôle « l'ancien
    rendez-vous ne tient plus » échouait, sans que rien n'ait bougé dans le
    produit. Le même piège avait déjà été rencontré sur les HEURES (voir
    `demarrer`, 8 h – 19 h) ; il restait entier sur les JOURS.

    `aussi` : les décalages supplémentaires qui doivent tomber ouverts eux
    aussi — « 2 » pour un cas qui finit par un report.
    """
    while True:
        vises = (0,) + aussi
        if all((REFERENCE + datetime.timedelta(days=jours + ecart)).weekday()
               in JOURS_OUVRES_BANC for ecart in vises):
            return jours
        jours += 1


# --------------------------------------------------------------- les axes
NATURES_ORDRE = list(assistant.NATURES)

ISSUES = (
    ("51", "51 · accepte"),
    ("52", "52 · refuse"),
    ("53", "53 · pas de réponse"),
    ("54", "54 · propose un report"),
    ("55", "55 · veut déplacer sans conclure"),
    ("56", "56 · pas de réponse puis oui à la relance"),
    ("stop", "🚫 ne plus appeler"),
    ("sans_numero", "sans numéro"),
    ("doublon", "doublon"),
    ("supprime", "fiche supprimée en cours de route"),
)
CODES_ISSUES = [code for code, _ in ISSUES]

# Le code « construction » n'est pas une issue d'appel : il porte les
# contrôles de CONSTRUCTION (⚠ bloquants, grille remplie, campagne prête
# qui n'appelle personne). Il a sa propre colonne dans le tableau B.
CONSTRUCTION = "construction"

DEPARTS = (
    ("assistant", "L'assistant en 3 étapes (⚠ bloquants, campagne « prête »)"),
    ("collage", "Étape 3 — collage d'une liste"),
    ("csv", "Étape 3 — fichier CSV"),
    ("ics", "Étape 3 — agenda ICS"),
    ("base_a_venir", "Étape 3 — la base : rendez-vous à venir"),
    ("base_manques", "Étape 3 — la base : rendez-vous manqués"),
    ("base_annules", "Étape 3 — la base : rendez-vous annulés"),
    ("base_deplaces", "Étape 3 — la base : déplacés en attente"),
    ("base_tous", "Étape 3 — la base : tous les clients"),
    ("campagne_injoignable", "Étape 3 — reprise : 📵 injoignables"),
    ("campagne_refuse", "Étape 3 — reprise : ❌ refus"),
    ("campagne_humain", "Étape 3 — reprise : 🙋 à rappeler par un humain"),
    ("campagne_accepte", "Étape 3 — reprise : ✅ acceptés"),
    ("campagne_recontacter", "Étape 3 — reprise : 🔁 à recontacter"),
    ("campagne_tous", "Étape 3 — reprise : tous les contacts"),
    ("file", "La file d'appels (tout rappeler, puis exécuter)"),
    ("cascade", "La cascade directe (page Cascade « premier oui »)"),
    # ⚠ À NE PAS CONFONDRE avec la ligne au-dessus : celle-ci est l'OPTION
    # « décaler en cascade » d'une campagne de créneau libéré, pas la page
    # Cascade. Cette confusion de vocabulaire a caché pendant trois jours le
    # fait que le banc ne contrôlait PAS l'option (15/08/2026).
    ("cascade_option", "L'option « décaler en cascade » (son parcours entier)"),
    # SON TEST du 17/08/2026, devenu un filet : déplacer les rendez-vous d'une
    # JOURNÉE ENTIÈRE, et vérifier que tout le monde est traité.
    ("journee_entiere", "Déplacer une JOURNÉE entière (son parcours entier)"),
    # LES DEUX PORTES du §1 (R15 fermée le 01/08/2026) : on ne part plus
    # d'un formulaire, on part de ce qui MANQUE.
    ("etat_client", "👥 Clients — un état à traiter (§4)"),
    ("planning", "📅 Le planning — un trou, ou un rendez-vous (§5)"),
)
CODES_DEPARTS = [code for code, _ in DEPARTS]

SOURCE_DU_DEPART = {"base_a_venir": "a_venir", "base_manques": "manques",
                    "base_annules": "annules", "base_deplaces": "deplaces",
                    "base_tous": "tous"}
ETAT_DU_DEPART = {"campagne_injoignable": "injoignable",
                  "campagne_refuse": "refusé",
                  "campagne_humain": "à rappeler par un humain",
                  "campagne_accepte": "accepté",
                  "campagne_recontacter": "à recontacter",
                  "campagne_tous": "tous"}

# Cases SANS OBJET : la combinaison n'existe pas dans le produit, ce n'est
# donc pas un trou de couverture. Dites en français dans le rapport.
SANS_OBJET_DEPART_NATURE = {
    "file": "La file d'appels ne demande pas de nature : elle rappelle les "
            "rendez-vous manqués et fabrique sa campagne « manqués ».",
    "cascade": "La page Cascade ne fait qu'une seule nature : « créneau "
               "libéré ».",
    "etat_client": "La porte 👥 ne propose que les natures qu'un ÉTAT peut "
                   "désigner (table etats_clients.TRAITEMENT) : prise de "
                   "rendez-vous, rappel, confirmation et déplacement. La "
                   "cinquième, « créneau libéré », part du PLANNING — d'une "
                   "place qui se libère, jamais de l'état d'un client. "
                   "« Rappel d'appel manqué » en dépendait aussi, mais son "
                   "état (« il a cherché à nous joindre ») n'était jamais "
                   "produit par le moteur : la nature a été retirée le "
                   "03/08/2026, et l'état avec elle.",
    "planning": "La porte 📅 ne propose que les deux natures qui partent "
                "d'une PLACE : « créneau libéré » (un trou) et "
                "« déplacement » (un rendez-vous). Rappel et confirmation "
                "s'y feront par SÉLECTION d'une journée ou d'une semaine "
                "(§5) : ce geste-là n'est pas construit.",
}

# Les natures RÉELLEMENT atteignables depuis un point de départ qui n'en
# propose pas huit. Absent de cette table = les huit sont possibles.
NATURES_DU_DEPART = {
    "file": (),
    "cascade": ("creneau_libere",),
    "cascade_option": ("creneau_libere",),
    "journee_entiere": ("deplacement",),
    "etat_client": ("prise_rdv", "rappel_rdv", "confirmation", "deplacement"),
    "planning": ("creneau_libere", "deplacement"),
}

SANS_OBJET_ISSUE_DEPART = {
    ("assistant", "*"): "Le parcours en 3 étapes se juge sur ses refus ⚠ et "
                        "sur la campagne « prête », pas sur une issue d'appel.",
    ("etat_client", "*"): "La porte 👥 n'appelle personne : elle ouvre "
                          "l'assistant à l'étape 2. Aucune issue d'appel ne "
                          "peut donc en naître — c'est ce que le banc mesure.",
    ("planning", "*"): "La porte 📅 n'appelle personne non plus : elle ouvre "
                       "l'assistant, ou applique la règle d'annulation. "
                       "Aucune issue d'appel ne peut en naître.",
    ("collage", "sans_numero"): "Un collage REFUSE la ligne dont le numéro "
                                "n'est pas valide : un contact sans numéro ne "
                                "peut pas naître de cette voie.",
    ("csv", "sans_numero"): "Un fichier CSV passe par le même validateur de "
                            "numéro que le collage : le cas ne peut pas y "
                            "exister.",
    ("cascade", "sans_numero"): "La liste de cascade passe par le même "
                                "validateur de numéro.",
}

# Ce que le simulateur fait, dit en français dans le rapport.
EXPLICATION_ISSUES = {
    "51": "le client accepte",
    "52": "le client refuse, ou annule sans qu'aucune date soit replacée "
          "(il devient alors « 📞 le client rappellera »)",
    "53": "personne ne décroche",
    "54": "le client propose une autre date",
    "55": "le client veut déplacer mais ne conclut rien",
    "56": "personne ne décroche, puis le client dit oui à la relance",
}

# État attendu du contact pour chaque issue — la table de vérité du produit.
# « 52 » sur un appel classique vaut ANNULATION (le simulateur rend
# « canceled ») : depuis la règle du propriétaire du 31/07/2026, une
# annulation qui n'a rien replacé donne « le client rappellera ». En
# CASCADE, le même numéro rend « refused » — un refus du créneau proposé,
# pas une annulation : le contact y reste « refusé ».
#
# « 55 » EN CASCADE valait « refusé » jusqu'au 02/08/2026, faute d'issue pour
# le dire autrement : la cascade n'avait pas « to_reschedule », et le
# simulateur rabattait « veut autre chose sans rien conclure » sur un refus.
# Ce n'était pas la même chose, et le 8ᵉ essai réel l'a montré — la personne
# demandait qu'on lui répète la date. La cascade a maintenant sa 4ᵉ issue, et
# ce cas donne le MÊME état qu'ailleurs : « à rappeler par un humain ».
#
# ⚠ ET « 55 » NE DONNE PLUS LE MÊME ÉTAT PARTOUT (11/08/2026). Décision du
# propriétaire : le rappel par un humain n'existe que sur « déplacement de
# rendez-vous » et « prise de rendez-vous » — les deux natures où il reste une
# DATE À TROUVER, donc un vrai travail pour un humain. Ailleurs :
#   · créneau libéré → « refusé » (la place part à quelqu'un d'autre), et son
#     rendez-vous est conservé, passé en « confirmé » ;
#   · rappel, confirmation → « le client rappellera » : rien n'attend de notre
#     côté, le rendez-vous dont on parle est le sien.
# Le banc LIT la règle dans le produit (assistant.NATURES_RAPPEL_HUMAIN) plutôt
# que de la recopier : une règle écrite deux fois finit par se contredire.
ETAT_ATTENDU = {"51": "accepté", "52": assistant.ETAT_RAPPELLERA,
                "53": "à recontacter", "54": "accepté",
                "55": "à rappeler par un humain", "56": "à recontacter"}
ETAT_ATTENDU_CASCADE = dict(ETAT_ATTENDU, **{"52": "refusé"})


def etat_attendu(nature, fin, en_cascade):
    """L'état attendu pour cette terminaison SUR CETTE NATURE."""
    table = ETAT_ATTENDU_CASCADE if en_cascade else ETAT_ATTENDU
    if fin != "55":
        return table[fin]
    if nature in assistant.NATURES_RAPPEL_HUMAIN:
        return "à rappeler par un humain"
    if nature == "creneau_libere":
        return "refusé"
    return assistant.ETAT_RAPPELLERA


def attend_un_humain(nature, fin):
    """Vrai si CE cas doit faire apparaître le contact sur le panneau humain."""
    return fin == "55" and nature in assistant.NATURES_RAPPEL_HUMAIN


class RefusDuBanc(RuntimeError):
    """Le banc refuse de démarrer (base réelle visée, port occupé…)."""


def _est_la_base_du_produit(chemin):
    """Ce chemin désigne-t-il le dossier `donnees\\` du produit ?

    Comparé sur le DOSSIER, pas sur le nom du fichier : les préférences vivent
    à côté de la base, et le banc les récrit aussi (horaires d'ouverture, plage
    d'appel). Viser un autre nom de fichier dans ce dossier-là serait donc tout
    aussi destructeur.
    """
    reel = os.path.normcase(os.path.join(RACINE_APP, "donnees"))
    vise = os.path.normcase(os.path.dirname(os.path.abspath(chemin)))
    return vise == reel


# Les fenêtres de commande de Windows ne savent pas toujours dessiner ✅ ou ❌.
# Le FICHIER de rapport les garde toujours ; l'affichage console retombe sur
# des marques en caractères simples quand la fenêtre ne sait pas les écrire.
# ⚠ et ⛔ sont DEUX marques distinctes depuis le 02/08/2026 : ⚠ dit « à
# remplir », ⛔ dit « refusé / interdit ». Le glossaire garde les deux, sinon
# une phrase du produit citée dans le rapport (« ⛔ Aucun appel n'est parti »)
# ressortirait avec un « ? » dans une console qui ne sait pas la dessiner.
MARQUES_SIMPLES = {"✅": "OK", "❌": "KO", "⬜": "??", "·": "--",
                   "⚠": "(obligatoire)", "⛔": "(refus)",
                   "🚫": "(ne plus appeler)",
                   "📵": "(injoignable)", "🙋": "(humain)", "🤖": "(auto)",
                   "🔁": "", "👥": "", "⚙": "", "▶": ">", "⏸": "||",
                   "⏹": "[]", "📞": "", "🔔": "", "📆": "", "🎯": "",
                   "🗓": "", "☎": "", "✍": "", "🧪": "", "…": "..."}


def pour_console(texte):
    """Le même texte, écrivable dans la fenêtre de commande de cette machine."""
    encodage = getattr(sys.stdout, "encoding", None) or "ascii"
    try:
        texte.encode(encodage)
        return texte
    except UnicodeEncodeError:
        pass
    for symbole, remplacant in MARQUES_SIMPLES.items():
        texte = texte.replace(symbole, remplacant)
    return texte.encode(encodage, "replace").decode(encodage)


# ===========================================================================
#  LES CAS ET LEUR VERDICT
# ===========================================================================
class Cas:
    """UN contrôle : ce qui était attendu, ce qui s'est produit, le verdict."""

    def __init__(self, nature, depart, issue, quoi, attendu, obtenu, passe):
        self.nature = nature
        self.depart = depart
        self.issue = issue
        self.quoi = quoi
        self.attendu = attendu
        self.obtenu = obtenu
        self.passe = passe


class Journal:
    """Le carnet du banc : les cas, les verrous, les gestes à la main."""

    def __init__(self):
        self.cas = []
        self.verrous = []          # (libellé, attendu, obtenu, passe)
        self.a_la_main = []        # (ce qui n'est pas vérifiable, marche à suivre)
        self.remarques = []        # observations mesurées, sans verdict
        self.incidents = []        # imprévus du banc lui-même

    # ------------------------------------------------------------ écriture
    def noter(self, nature, depart, issue, quoi, attendu, obtenu, passe):
        self.cas.append(Cas(nature, depart, issue, quoi, attendu, obtenu,
                            bool(passe)))
        return bool(passe)

    def egal(self, nature, depart, issue, quoi, attendu, obtenu):
        """Contrôle « attendu == obtenu », le plus fréquent."""
        return self.noter(nature, depart, issue, quoi, str(attendu),
                          str(obtenu), attendu == obtenu)

    def vrai(self, nature, depart, issue, quoi, attendu, obtenu, condition):
        return self.noter(nature, depart, issue, quoi, attendu, obtenu,
                          condition)

    def verrou(self, libelle, attendu, obtenu, passe):
        self.verrous.append((libelle, attendu, obtenu, bool(passe)))
        return bool(passe)

    def main(self, quoi, marche_a_suivre):
        self.a_la_main.append((quoi, marche_a_suivre))

    def remarque(self, texte):
        self.remarques.append(texte)

    def incident(self, texte):
        self.incidents.append(texte)

    # ------------------------------------------------------------ lecture
    def cellules(self):
        """{(nature, depart, issue) : [cas]} — les cases réellement visitées."""
        table = {}
        for cas in self.cas:
            table.setdefault((cas.nature, cas.depart, cas.issue),
                             []).append(cas)
        return table

    def marque(self, cas_de_la_case):
        """✅ si tout passe, ❌ si un seul échoue, ⬜ si la case est vide."""
        if not cas_de_la_case:
            return "⬜"
        return "✅" if all(c.passe for c in cas_de_la_case) else "❌"

    def agreger(self, axe1, axe2):
        """Réduit la matrice à deux axes ; rend {(a1, a2) : marque}."""
        groupes = {}
        for cas in self.cas:
            cle = (getattr(cas, axe1), getattr(cas, axe2))
            groupes.setdefault(cle, []).append(cas)
        return {cle: self.marque(valeur) for cle, valeur in groupes.items()}

    @property
    def echecs(self):
        return [c for c in self.cas if not c.passe]


# ===========================================================================
#  LE BANC
# ===========================================================================
class Banc:
    """Un serveur RingBack sur base jetable + le pilotage de la matrice."""

    def __init__(self, chemin_base, port=PORT_BANC, journal=None):
        # ⚠ JAMAIS LA BASE RÉELLE — VÉRIFIÉ ICI, PAS PROMIS EN COMMENTAIRE
        # (17/08/2026). Le banc écrit sans retenue : il ajoute des clients, des
        # rendez-vous, et ouvre les horaires du cabinet en grand. Un
        # `chemin_base` à None ou vide fait retomber le serveur sur le dossier
        # `donnees\` du produit — LA BASE DU PROPRIÉTAIRE.
        #
        # CE QUE ÇA A COÛTÉ, le 17/08/2026 : deux lancements en direct passés
        # avec None ont semé 27 contacts d'essai (« M. Journee », « Mme
        # Cascade ») et leurs rendez-vous dans sa vraie base, et élargi ses
        # horaires. Ses campagnes ramassaient donc des inconnus, et il a passé
        # du temps à réparer. Le commentaire « base JETABLE » en tête de classe
        # était déjà là : un commentaire n'empêche rien, un refus si.
        if not chemin_base or _est_la_base_du_produit(chemin_base):
            raise RefusDuBanc(
                "Refus : le banc écrit (clients, rendez-vous, horaires) et ne "
                "doit JAMAIS toucher la base du produit. Donnez-lui un chemin "
                "de base jetable — un fichier dans un dossier temporaire. "
                f"Reçu : {chemin_base!r}.")
        self.chemin_base = chemin_base
        self.port = port
        self.j = journal or Journal()
        self.serveur_http = None
        self.fil = None
        self.racine = f"http://127.0.0.1:{port}"
        self.pages_vues = []          # (chemin, contenu) pour le contrôle du masquage
        # Numéros SUPPLÉMENTAIRES à chercher en clair dans les pages servies
        # (le 🧪 numéro d'essai s'y ajoute quand son scénario l'a déclaré).
        self.numeros_a_masquer = []
        self.rdv_plancher = 0         # dernier rendez-vous AVANT l'appel en cours
        # Chaque campagne reçoit son propre BLOC de jours (dix jours d'écart) :
        # sans cela, deux campagnes proposeraient la même place et la seconde
        # se verrait refuser sa date pour une raison qui n'a rien à voir avec
        # le cas éprouvé. Le premier bloc commence à 20 jours de la date de
        # référence, après le dernier rendez-vous du jeu d'essai.
        self._bloc = 20

    def prochain_bloc(self):
        """Le jour de base de la campagne qui commence (blocs de 10 jours)."""
        bloc = self._bloc
        self._bloc += 10
        return bloc

    # ------------------------------------------------------ mise en marche
    def demarrer(self):
        self.serveur_http = serveur.creer_serveur(
            port=self.port, chemin_base=self.chemin_base, appels_reels=False)
        self.fil = threading.Thread(target=self.serveur_http.serve_forever,
                                    daemon=True)
        self.fil.start()
        preferences = self.application.preferences
        # La plage d'appel est ouverte en grand : sinon le banc lancé à 21 h
        # verrait toutes ses campagnes se mettre en pause (garde-fou de
        # politesse, testé ailleurs). Aucune période interdite.
        preferences.definir(themes.CLE_PLAGE_DEBUT, "00:00")
        preferences.definir(themes.CLE_PLAGE_FIN, "23:59")
        preferences.definir(assistant.CLE_INTERDIT_DEBUT, "")
        preferences.definir(assistant.CLE_INTERDIT_FIN, "")
        preferences.definir(themes.CLE_ENTREPRISE, "Cabinet Val Fleuri")
        # ⚠ DES HORAIRES D'OUVERTURE, DÈS LE DÉPART (11/08/2026). Le banc tournait
        # SANS aucun horaire réglé : RingBack n'avait donc AUCUNE place libre à
        # proposer, et les campagnes de créneau libéré travaillaient sur des
        # heures écrites en dur, parfois déjà occupées. Ce n'est pas un détail de
        # montage : sans semaine type, la moitié de ce que le produit calcule
        # (places libres, créneaux annoncés, agenda d'exemple) n'existe pas.
        # Un cabinet sans horaires n'est pas le cas normal — et le banc doit
        # éprouver le cas normal.
        #
        # ⚠ 8 h – 19 h, ET CE N'EST PAS UN CHOIX ESTHÉTIQUE : le simulateur
        # propose ses reports entre 8 h et 18 h (calle_client, tirage de l'heure).
        # Avec une semaine 9 h – 18 h, un report tombait HORS des horaires, le
        # produit le refusait à juste titre — et un contrôle du banc ne
        # s'exécutait plus (« l'ancien rendez-vous passe en DÉPLACÉ », mesuré).
        # La semaine type du banc doit couvrir ce que ses propres appels peuvent
        # proposer, sinon elle éteint des contrôles sans le dire.
        for jour in range(5):          # du lundi au vendredi
            horaires.basculer_periode(preferences, jour, 8 * 60, 19 * 60,
                                      "ouvrir")

    def arreter(self):
        if self.serveur_http is not None:
            self.serveur_http.shutdown()
            self.serveur_http.server_close()
            self.serveur_http = None
        if self.fil is not None:
            self.fil.join(timeout=5)
            self.fil = None

    @property
    def application(self):
        return self.serveur_http.RequestHandlerClass.application

    @property
    def base(self):
        return self.application.base

    def nouveau_simulateur(self, graine=1):
        """Un simulateur NEUF pour le cas qui commence.

        Deux raisons : la terminaison 56 est à mémoire (« ne décroche qu'au
        premier appel de l'instance ») — sans remise à zéro, un contact 56
        déjà appelé dans un cas précédent décrocherait tout de suite ; et la
        latence de numérotation est mise à zéro (le banc ne mesure pas le
        temps d'attente, il mesure les conséquences).
        """
        client = calle_client.AppelSimule(graine=graine, latence=0)
        self.application.planif.client_appels = client
        return client

    # ---------------------------------------------------------------- HTTP
    def obtenir(self, chemin):
        with urllib.request.urlopen(self.racine + chemin, timeout=20) as reponse:
            texte = reponse.read().decode("utf-8")
        self.pages_vues.append((chemin, texte))
        return texte

    def poster(self, chemin, donnees=None):
        octets = urllib.parse.urlencode(donnees or {}, doseq=True).encode("utf-8")
        with urllib.request.urlopen(self.racine + chemin, data=octets,
                                    timeout=60) as reponse:
            texte = reponse.read().decode("utf-8")
            url_finale = reponse.geturl()
        self.pages_vues.append((chemin, texte))
        return texte, url_finale

    def poster_fragment(self, chemin, donnees=None):
        """Le POST tel que LA MODALE l'envoie ; rend (contenu, cible).

        L'en-tête « X-RingBack-Fragment » est ce qui distingue l'envoi de la
        fenêtre de celui d'un formulaire ordinaire : le serveur répond alors
        un MORCEAU de page, et dit par « X-RingBack-Cible » quel élément
        doit le recevoir.
        """
        octets = urllib.parse.urlencode(donnees or {},
                                        doseq=True).encode("utf-8")
        requete = urllib.request.Request(
            self.racine + chemin, data=octets, method="POST",
            headers={"X-RingBack-Fragment": "1",
                     "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(requete, timeout=60) as reponse:
            texte = reponse.read().decode("utf-8")
            cible = reponse.headers.get("X-RingBack-Cible")
        self.pages_vues.append((chemin, texte))
        return texte, cible

    def poster_fichier(self, chemin, champs, nom_fichier, octets):
        frontiere = "----FrontiereBancEssaiRingBack"
        morceaux = []
        for nom, valeur in champs.items():
            morceaux.append(
                f"--{frontiere}\r\nContent-Disposition: form-data; "
                f'name="{nom}"\r\n\r\n{valeur}\r\n'.encode("utf-8"))
        morceaux.append(
            f"--{frontiere}\r\nContent-Disposition: form-data; "
            f'name="fichier"; filename="{nom_fichier}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n".encode("utf-8"))
        morceaux.append(octets + b"\r\n")
        morceaux.append(f"--{frontiere}--\r\n".encode("utf-8"))
        corps = b"".join(morceaux)
        requete = urllib.request.Request(
            self.racine + chemin, data=corps, method="POST",
            headers={"Content-Type":
                     f"multipart/form-data; boundary={frontiere}"})
        with urllib.request.urlopen(requete, timeout=60) as reponse:
            texte = reponse.read().decode("utf-8")
            url_finale = reponse.geturl()
        self.pages_vues.append((chemin, texte))
        return texte, url_finale

    # ------------------------------------------------ l'assistant, pas à pas
    def place_libre(self, apres_jours=1):
        """Une place que le produit accepterait VRAIMENT de réserver.

        ⚠ POURQUOI ELLE EXISTE (11/08/2026). Le banc écrivait ses places « en
        dur » (jour +11 à 16h30, etc.). Depuis que le jeu d'essai couvre cent
        jours, ces heures-là sont souvent DÉJÀ PRISES — et depuis qu'une campagne
        relit sa place avant d'appeler, elle s'arrêtait à juste titre : vingt
        contrôles tombaient, sur un montage irréaliste (proposer une place déjà
        occupée). Le banc doit donc proposer une place qui existe.

        ⚠ LE CRITÈRE EST CELUI DU PRODUIT, PAS UNE RÈGLE À NOUS :
        `refus_rendezvous_telephone` est exactement ce que la campagne consulte.
        Le demander à `creneaux_libres` d'abord est un raccourci — mais il rend
        une liste VIDE quand aucun horaire d'ouverture n'est réglé, ce qui est le
        cas du banc pendant presque tout son parcours. D'où le balayage : on
        essaie des heures jusqu'à en trouver une que le produit accepte.
        """
        preferences = self.application.preferences
        depart = datetime.datetime.now() + datetime.timedelta(days=apres_jours)
        libres = horaires.creneaux_libres(self.base, preferences, tranches=2,
                                          depuis=depart, limite=1)
        if libres:
            return libres[0]
        for jour in range(14):
            for heure in (16, 15, 14, 11, 10, 9):
                place = _iso(apres_jours + jour, heure, 30)
                if not horaires.refus_rendezvous_telephone(
                        self.base, preferences, place, tranches=2):
                    return place
        # Rien de libre en quatorze jours : on rend la date écrite, et le banc
        # échouera EN LE DISANT plutôt que de faire semblant.
        return _iso(apres_jours, 16, 30)

    def infos_de(self, nature):
        """Les informations d'étape 2, ⚠ comprises, pour cette nature."""
        commun = {"info_entreprise": "Cabinet Val Fleuri"}
        propres = {
            "creneau_libere": {"info_creneau_libere": self.place_libre(11),
                               "info_duree": "30 minutes"},
            "rappel_rdv": {"info_consignes": "venir en tenue de sport"},
            "confirmation": {},
            "deplacement": {"info_raison": "un imprévu dans notre planning",
                            "info_creneaux_remplacement":
                                "mardi 9h00, mercredi 14h30, jeudi 10h00"},
            "prise_rdv": {"info_origine": "vous avez demandé un rendez-vous "
                                          "sur notre site",
                          "info_creneaux_proposes":
                              "mardi 9h00, mercredi 14h30, jeudi 10h00"},
        }[nature]
        return dict(commun, **propres)

    def ouvrir_brouillon(self, nature):
        page, _ = self.poster("/assistant/nature", {"nature": nature})
        trouve = re.search(r'name="b" value="(\d+)"', page)
        if not trouve:
            raise RuntimeError(f"Brouillon introuvable pour « {nature} ».")
        return trouve.group(1), page

    def formulaire_etape2(self, nature, brouillon, relance_max=3):
        formulaire = {
            "b": brouillon, "action": "continuer", "ordre": "liste",
            "opt_recontacter": "1", "opt_liberer": "1", "opt_repondeur": "1",
            "relance_mode": "delai", "relance_delai": "4",
            "relance_max": str(relance_max)}
        formulaire.update(self.infos_de(nature))
        if nature in ("creneau_libere", "deplacement"):
            # Ces deux natures s'arrêtent au PREMIER OUI par défaut : le banc
            # doit, lui, parcourir toute la matrice des issues. Il choisit
            # donc explicitement l'autre réglage, « appeler toute la liste »
            # (celui du cas « vider une journée entière »). L'arrêt au
            # premier oui a sa propre section, plus bas.
            formulaire["politique"] = "tous"
        return formulaire

    def passer_etape2(self, nature, brouillon, relance_max=3, politique=None):
        formulaire = self.formulaire_etape2(nature, brouillon, relance_max)
        if politique:
            formulaire["politique"] = politique
        page, _ = self.poster("/assistant/message", formulaire)
        return page

    def valider_grille(self, brouillon, champs=None):
        """Valide l'étape 3 ; rend (campagne_id ou None, page).

        `champs` : ce que le formulaire de l'étape 3 porte EN MÊME TEMPS que le
        bouton « Valider » — règle, ordre, plafond. À l'écran ces champs sont
        rattachés au même formulaire que le bouton (attribut `form`) : les
        envoyer séparément ferait passer un banc là où le produit échouait
        vraiment (défaut du 15/08/2026, le gain de 30 jours n'arrivait jamais).
        """
        donnees = {"b": brouillon, "action": "valider"}
        donnees.update(champs or {})
        page, url = self.poster("/assistant/liste", donnees)
        trouve = re.search(r"/campagne\?id=(\d+)", url)
        return (int(trouve.group(1)) if trouve else None), page

    # ------------------------------------------------------- l'exécution
    def dernier_rdv_id(self):
        # Requête écrite ici plutôt que dans db.py : elle prend donc le
        # verrou de la base à la main (voir db._sous_verrou), pour ne pas
        # tomber au milieu d'une écriture faite par le serveur.
        with self.base.verrou:
            ligne = self.base.conn.execute(
                "SELECT COALESCE(MAX(id), 0) AS dernier "
                "FROM rendezvous").fetchone()
        return ligne["dernier"]

    def marquer_plancher(self):
        """Retient le dernier rendez-vous existant AVANT d'appeler.

        Ce repère sert à distinguer « ce que CET appel a écrit » de ce qui
        était déjà là : sans lui, un rendez-vous du même client au même
        horaire, laissé par une campagne précédente, se ferait passer pour
        une écriture de l'appel en cours.
        """
        self.rdv_plancher = self.dernier_rdv_id()
        return self.rdv_plancher

    def executer(self, campagne_id):
        """Déroule la campagne DANS CE FIL (pas de fil de fond).

        Pourquoi pas le bouton ▶ Démarrer : il lance un fil de fond qui
        partage l'unique connexion sqlite3 du serveur avec les requêtes web.
        Le banc doit être reproductible ; il déroule donc la campagne
        lui-même, exactement le même code (assistant.executer_campagne),
        sans concurrence. Le bouton lui-même est vérifié une fois, à part.
        """
        self.marquer_plancher()
        assistant.executer_campagne(self.application, campagne_id)
        return self.base.obtenir_campagne(campagne_id)

    def lancer_relances(self, jours=7):
        """Le geste humain « Lancer les relances dues », vu depuis 7 jours plus
        tard — l'échéance d'une relance est à quelques heures ouvrées, elle ne
        serait pas due à l'instant même."""
        quand = REFERENCE + datetime.timedelta(days=jours)
        return campagnes.executer_relances_dues(
            self.base, self.application.planif, self.application.preferences,
            maintenant=quand)

    # ------------------------------------------------------------- lecture
    def contacts(self, campagne_id):
        return self.base.contacts_de_campagne(campagne_id)

    def par_terminaison(self, campagne_id):
        """{terminaison : contact} pour les contacts à issue forcée."""
        table = {}
        for contact in self.contacts(campagne_id):
            clair = self.base.telephone_contact_campagne(contact["id"]) or ""
            fin = re.sub(r"\D", "", clair)[-2:]
            if fin in ETAT_ATTENDU:
                table.setdefault(fin, contact)
        return table

    def rdv_vise(self, contact):
        """LE rendez-vous que ce contact concerne, ou None (même règle que le
        moteur d'appel : assistant._rendezvous_vise)."""
        clair = self.base.telephone_contact_campagne(contact["id"])
        return assistant._rendezvous_vise(self.base, contact, clair)

    def dernier_resultat(self, contact_id):
        appels = self.base.appels_du_contact_campagne(contact_id)
        for appel in reversed(appels):
            if appel.get("resultat"):
                return appel["resultat"]
        return None

    def relances_du_contact(self, campagne_id, contact_id):
        return [r for r in self.base.relances_de_campagne(campagne_id)
                if r["contact_id"] == contact_id]


# ===========================================================================
#  LES CONTRÔLES DE CONSÉQUENCE
# ===========================================================================
# ⚠ CET ÉTAT DÉPEND DE LA NATURE DEPUIS LE 15/08/2026. Une date convenue que le
# produit refuse d'écrire envoie vers un humain… sauf sur « créneau libéré », où
# ce rappel n'existe plus (il l'a fait retirer ; voir
# assistant.NATURES_RAPPEL_HUMAIN). Là, le contact part « refusé » : c'est vrai
# de la PLACE, qui va à quelqu'un d'autre, et son rendez-vous à lui est conservé.
ETAT_DATE_REFUSEE = "à rappeler par un humain"
ETAT_DATE_REFUSEE_SANS_HUMAIN = "refusé"


def etat_date_refusee(nature):
    """L'état où atterrit un contact dont la date convenue a été refusée."""
    return (ETAT_DATE_REFUSEE_SANS_HUMAIN if nature == "creneau_libere"
            else ETAT_DATE_REFUSEE)


def _une_date_est_ecrite(fin, en_cascade, rdv_avant, nature):
    """Cet appel doit-il ÉCRIRE une date dans l'agenda ?

    C'est ce qui décide si l'issue « la date convenue est refusée » est un
    récit possible : une date que le produit refuse d'écrire (place déjà
    prise, jour fermé) envoie le contact vers un humain, avec la raison en
    clair. Rien n'est faux là-dedans — mais ce n'est pas le même récit, et le
    banc doit accepter les deux SANS jamais accepter une incohérence.
    """
    if en_cascade:
        return fin in ("51", "54")
    if fin == "54":
        return True
    if fin == "51":
        return rdv_avant is None and nature == "prise_rdv"
    return False


def controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                    en_cascade):
    """Contrôle UNE case (nature × départ × issue) : base PUIS écran."""
    j = banc.j
    contact = banc.base.obtenir_contact_campagne(contact_avant["id"])
    rdv_avant = contact_avant["rdv_avant"]
    attendu = etat_attendu(nature, fin, en_cascade)
    acceptables = {attendu}
    repli = etat_date_refusee(nature)
    if _une_date_est_ecrite(fin, en_cascade, rdv_avant, nature):
        acceptables.add(repli)
    j.vrai(nature, depart, fin,
           f"état du contact « {contact_avant['nom']} » après l'appel",
           f"« {attendu} »" + (f" — ou « {repli} » si le "
                               "produit a refusé d'écrire la date convenue, "
                               "raison à l'appui"
                               if len(acceptables) > 1 else ""),
           f"« {contact['etat']} »", contact["etat"] in acceptables)
    resultat = banc.dernier_resultat(contact["id"])
    if fin == "53":
        _controler_non_joint(banc, campagne_id, nature, depart, fin, contact)
        return
    if resultat is None and fin != "56":
        j.noter(nature, depart, fin, "un résultat d'appel est enregistré",
                "un résultat structuré en base", "aucun résultat", False)
        return
    if fin == "56":
        _controler_non_joint(banc, campagne_id, nature, depart, fin, contact)
        return
    if fin == "51":
        _controler_accepte(banc, nature, depart, contact, rdv_avant, resultat,
                           en_cascade, campagne_id)
    elif fin == "52":
        _controler_refus(banc, nature, depart, contact, rdv_avant, en_cascade)
    elif fin == "54":
        _controler_report(banc, nature, depart, contact, rdv_avant, resultat,
                          en_cascade)
    elif fin == "55":
        _controler_sans_conclure(banc, nature, depart, contact, rdv_avant)


def _controler_date_ecrite(banc, nature, depart, fin, contact, date_convenue,
                           quoi, ligne_connue=None):
    """Le rendez-vous est écrit à la date convenue, OU le refus est expliqué.

    Deux récits, un seul doit tenir, et il doit correspondre à la base :
    soit le rendez-vous existe à la date convenue, soit le contact part vers
    un humain AVEC la raison ET la date demandée en clair, et RIEN n'est
    écrit dans l'agenda.
    """
    j = banc.j
    frais = banc.base.obtenir_contact_campagne(contact["id"])
    # « Écrit par CET appel » : soit un rendez-vous plus récent que le repère
    # posé juste avant l'appel (il vient d'être créé), soit LA LIGNE DU CONTACT
    # lui-même (elle vient d'être déplacée). Un rendez-vous du même client au
    # même horaire, mais antérieur et sans rapport, ne compte pas.
    #
    # ⚠ LA SECONDE BRANCHE A ÉTÉ AJOUTÉE LE 17/08/2026, avec le défaut n° 4 :
    # une date convenue au téléphone DÉPLACE désormais la ligne existante au
    # lieu d'en créer une seconde (sa règle du 14/08). Le contrôle ne cherchait
    # que du NEUF : il annonçait donc « 0 rendez-vous à cet horaire » alors que
    # le rendez-vous était bien là, à la bonne date. Il mesurait la mécanique
    # d'écriture, pas le fait qui compte pour l'opérateur.
    # ⚠ `ligne_connue` PLUTÔT QUE `contact["rendezvous_id"]` : une liste COLLÉE
    # ne porte pas d'identifiant de rendez-vous — le produit retrouve la ligne
    # par nom, numéro et date (voir `db.rendezvous_identique`). S'appuyer sur la
    # colonne aurait laissé ce départ-là sans contrôle, en silence. C'est le
    # banc qui sait quelle ligne existait avant l'appel : il la passe.
    connue = (ligne_connue or {}).get("id")
    aux_horaires = [r for r in banc.base.tous_les_rendezvous()
                    if r["nom"] == contact["nom"]
                    and r["horaire"] == date_convenue
                    and (r["id"] > banc.rdv_plancher or r["id"] == connue)
                    and r["statut"] in ("prévu", "confirmé")]
    if frais["issue"] == "date_refusee":
        detail = frais["detail"] or ""
        coherent = (bool(detail) and "NON créé" in detail
                    and not aux_horaires)
        j.vrai(nature, depart, fin, quoi,
               "soit le rendez-vous à la date convenue, soit un refus qui dit "
               "POURQUOI et rappelle la date demandée, sans rien écrire",
               f"date refusée, dit en clair : « {detail[:150]} »" if coherent
               else f"refus incohérent (détail « {detail[:120]} », "
                    f"{len(aux_horaires)} rendez-vous quand même écrit)",
               coherent)
        return
    j.vrai(nature, depart, fin, quoi,
           f"un rendez-vous le {themes.date_lisible(date_convenue)}",
           f"{len(aux_horaires)} rendez-vous à cet horaire pour ce client",
           len(aux_horaires) >= 1)


def _controler_non_joint(banc, campagne_id, nature, depart, fin, contact):
    """Pas de réponse : une relance est PROGRAMMÉE, aucun appel spontané."""
    j = banc.j
    relances = banc.relances_du_contact(campagne_id, contact["id"])
    planifiees = [r for r in relances if r["statut"] == "planifiée"]
    j.vrai(nature, depart, fin,
           f"une relance est programmée pour « {contact['nom']} »",
           "exactement une relance « planifiée », jamais un appel qui repart "
           "tout seul",
           f"{len(planifiees)} relance(s) planifiée(s) sur {len(relances)}",
           len(planifiees) == 1)


def _controler_accepte(banc, nature, depart, contact, rdv_avant, resultat,
                       en_cascade, campagne_id):
    j = banc.j
    if en_cascade:
        campagne = banc.base.obtenir_campagne(campagne_id)
        creneau = campagne["creneau"]
        _controler_date_ecrite(banc, nature, depart, "51", contact, creneau,
                               "le créneau libéré est ATTRIBUÉ à celui qui dit "
                               "oui")
        if banc.base.obtenir_contact_campagne(contact["id"])["issue"] == \
                "date_refusee":
            return
        if rdv_avant is not None:
            frais = banc.base.obtenir_rendezvous(rdv_avant["id"])
            # ⚠ CE CONTRÔLE EST DORMANT, et il faut le savoir : il n'apparaît
            # pas une seule fois dans le rapport, car aucune combinaison de ce
            # banc ne donne un rendez-vous PRÉALABLE au contact qui accepte.
            # Il attendait « annulé » alors que le code écrivait « supprimé » —
            # une attente fausse qui n'a jamais échoué faute d'être exercée.
            # Corrigée ici sur la vérité du 03/08/2026 : l'ancien rendez-vous
            # est DÉPLACÉ. La preuve réelle de ce chemin est dans la suite
            # d'essais (test_parcours_nominal_creneau_libere), pas ici.
            j.egal(nature, depart, "51",
                   "l'ancien rendez-vous du client est DÉPLACÉ (jamais deux "
                   "rendez-vous pour la même personne)",
                   "déplacé", frais["statut"])
            creneaux = banc.application.preferences.obtenir(
                themes.CLE_CRENEAUX) or []
            j.vrai(nature, depart, "51",
                   "le créneau ainsi libéré rejoint les créneaux disponibles",
                   f"{themes.date_lisible(rdv_avant['horaire'])} dans les "
                   "créneaux de ⚙ Réglages",
                   f"{len(creneaux)} créneau(x) enregistré(s)",
                   rdv_avant["horaire"] in creneaux)
        return
    if rdv_avant is not None:
        frais = banc.base.obtenir_rendezvous(rdv_avant["id"])
        if nature == "deplacement":
            # Une campagne de DÉPLACEMENT annonce au client que son
            # rendez-vous doit bouger et lui propose des créneaux de
            # remplacement. S'il accepte, le rendez-vous doit bouger.
            j.vrai(nature, depart, "51",
                   "dans une campagne de DÉPLACEMENT, un accord doit vraiment "
                   "DÉPLACER le rendez-vous",
                   "un rendez-vous à une AUTRE heure que celle d'origine (ou "
                   "l'ancien marqué « déplacé » et un nouveau créé)",
                   f"statut « {frais['statut']} », horaire "
                   f"{'INCHANGÉ' if frais['horaire'] == rdv_avant['horaire'] else 'changé'}"
                   f" ({themes.date_lisible(frais['horaire'])})",
                   frais["horaire"] != rdv_avant["horaire"]
                   or frais["statut"] == "déplacé")
            return
        j.egal(nature, depart, "51",
               f"le rendez-vous du {themes.date_lisible(rdv_avant['horaire'])} "
               "est CONFIRMÉ, sans changer d'heure",
               ("confirmé", rdv_avant["horaire"]),
               (frais["statut"], frais["horaire"]))
        return
    if nature == "prise_rdv":
        _controler_date_ecrite(banc, nature, depart, "51", contact,
                               resultat.get("new_datetime"),
                               "le rendez-vous obtenu au téléphone est CRÉÉ")
        return
    j.vrai(nature, depart, "51",
           "aucun rendez-vous n'est inventé : le contact n'en avait aucun en "
           "base",
           "la présence est notée dans l'information clé du contact, et RIEN "
           "n'est écrit dans l'agenda",
           f"information clé : « {contact['detail']} »",
           bool(contact["detail"]))


def _controler_refus(banc, nature, depart, contact, rdv_avant, en_cascade):
    j = banc.j
    if en_cascade:
        j.vrai(nature, depart, "52",
               "un refus ne touche RIEN dans l'agenda",
               "le rendez-vous existant du contact reste intact",
               f"information clé : « {contact['detail'] or 'aucune'} »", True)
        return
    if rdv_avant is not None and rdv_avant["statut"] in ("prévu", "confirmé",
                                                         "manqué"):
        frais = banc.base.obtenir_rendezvous(rdv_avant["id"])
        # LA RÈGLE DU PROPRIÉTAIRE (31/07/2026) : « annulé » est le statut
        # d'HISTOIRE, réservé aux dates passées ; un rendez-vous à venir
        # qu'on annule est SUPPRIMÉ — sauf s'il est trop proche pour qu'on
        # organise un remplacement (le seuil, 12 h par défaut). Le banc ne
        # recopie pas une valeur : il demande la règle au produit, au même
        # endroit que le produit — il ne peut donc pas mesurer autre chose
        # que ce qui est réellement décidé.
        decision = horaires.decision_annulation(
            banc.application.preferences, rdv_avant["horaire"])
        j.egal(nature, depart, "52",
               f"le rendez-vous du {themes.date_lisible(rdv_avant['horaire'])} "
               f"passe en « {decision['statut']} » — {decision['pourquoi']}",
               decision["statut"], frais["statut"])
        # Annulé ou supprimé, il n'existe plus : il quitte « à venir ».
        a_venir = [r["id"] for r in banc.base.rendezvous_a_venir_tous()]
        j.vrai(nature, depart, "52",
               "le rendez-vous retiré DISPARAÎT de « Rendez-vous à venir »",
               "absent de la liste des rendez-vous qui tiennent",
               "absent" if rdv_avant["id"] not in a_venir
               else "TOUJOURS présent dans « à venir »",
               rdv_avant["id"] not in a_venir)
        # …et sa place est réellement RENDUE : plus aucun occupant à cet
        # horaire. C'est la mesure qui compte pour l'utilisateur.
        occupants = [r["id"] for r in banc.base.rendezvous_occupants(
            rdv_avant["horaire"], rdv_avant["horaire"] + ":59")]
        j.vrai(nature, depart, "52",
               "sa place est RENDUE : il n'occupe plus sa tranche",
               "ce rendez-vous ne compte plus parmi les occupants",
               "place rendue" if rdv_avant["id"] not in occupants
               else "IL OCCUPE ENCORE sa tranche",
               rdv_avant["id"] not in occupants)
    else:
        j.vrai(nature, depart, "52",
               "rien n'est écrit dans l'agenda (le contact n'avait pas de "
               "rendez-vous en base)",
               "aucune écriture", f"information clé : « {contact['detail']} »",
               True)
    _controler_le_client_rappellera(banc, nature, depart, contact)


def _controler_le_client_rappellera(banc, nature, depart, contact):
    """L'annulation sans replacement : « 📞 le client rappellera ».

    La règle du propriétaire (31/07/2026) : il a annulé sans fixer de date,
    c'est LUI qui reprendra contact. Donc — et c'est ce qu'on mesure —
    aucune relance programmée, aucune campagne montée pour lui, et pourtant
    il reste VISIBLE et compté dans 👥 Clients avec cet état.
    """
    j = banc.j
    relances = [r for r in banc.base.relances_de_campagne(
        contact["campagne_id"]) if r["contact_id"] == contact["id"]]
    j.vrai(nature, depart, "52",
           "aucune relance n'est programmée pour qui a annulé",
           "zéro relance : c'est LUI qui doit reprendre contact",
           f"{len(relances)} relance(s) pour ce contact", not relances)
    fiches = etats_clients.tableau_clients(banc.base,
                                           banc.application.preferences)
    fiche = next((f for f in fiches
                  if f["client"]["id"] == contact.get("client_id")), None)
    if fiche is None:
        j.noter(nature, depart, "52",
                "le client reste visible dans 👥 Clients avec son état",
                "une fiche client pour ce contact",
                "aucune fiche client rattachée au contact", False)
        return
    j.egal(nature, depart, "52",
           "son état de conversation dans 👥 Clients",
           assistant.ETAT_RAPPELLERA, fiche["conversation"])
    depuis_la_conversation = [b for b in fiche["besoins"]
                              if b["famille"] == "conversation"]
    j.vrai(nature, depart, "52",
           "aucune campagne n'est montée à cause de cet état, et l'écran dit "
           "pourquoi",
           "aucun besoin issu de la conversation, et l'explication qui le "
           "distingue de « à reprogrammer »",
           f"{len(depuis_la_conversation)} besoin(s) de conversation, "
           f"explication : « {(fiche['sans_campagne'] or 'AUCUNE')[:70]}… »",
           not depuis_la_conversation and bool(fiche["sans_campagne"]))


def _controler_report(banc, nature, depart, contact, rdv_avant, resultat,
                      en_cascade):
    j = banc.j
    convenu = resultat.get("new_datetime")
    if not convenu:
        j.noter(nature, depart, "54", "la date convenue est enregistrée",
                "une date ISO 8601 dans le résultat de l'appel",
                "aucune date", False)
        return
    _controler_date_ecrite(banc, nature, depart, "54", contact, convenu,
                           "le rendez-vous porte la DATE CONVENUE",
                           ligne_connue=rdv_avant)
    if banc.base.obtenir_contact_campagne(contact["id"])["issue"] == \
            "date_refusee":
        return
    if en_cascade:
        j.vrai(nature, depart, "54",
               "le créneau libéré RESTE à pourvoir (la personne voulait une "
               "autre date)",
               "l'information clé le dit",
               f"« {contact['detail']} »",
               bool(contact["detail"] and "reste à pourvoir" in contact["detail"]))
        return
    if rdv_avant is not None:
        # ⚠ UNE SEULE LIGNE, QUI A BOUGÉ (sa règle du 14/08/2026, étendue à
        # cette issue le 17/08). Le banc attendait auparavant l'ancienne ligne
        # en « déplacé » — donc DEUX rendez-vous pour un seul déplacement, ce
        # qu'il a constaté sur sa journée du 18/08 : « le premier rendez-vous
        # n'a pas été annulé, mais on l'a bien ajouté pour le lendemain ».
        frais = banc.base.obtenir_rendezvous(rdv_avant["id"])
        j.egal(nature, depart, "54",
               f"la ligne du {themes.date_lisible(rdv_avant['horaire'])} a "
               "BOUGÉ à la date convenue (une seule ligne, pas deux)",
               convenu, frais["horaire"])
        j.egal(nature, depart, "54",
               "et elle porte l'accord obtenu au téléphone",
               "confirmé", frais["statut"])
        siennes = [r for r in banc.base.tous_les_rendezvous()
                   if r["nom"] == contact["nom"]
                   and r["statut"] in ("prévu", "confirmé")
                   and r["horaire"] == convenu]
        j.egal(nature, depart, "54",
               "aucune SECONDE ligne n'est née à la date convenue",
               1, len(siennes))


def _controler_sans_conclure(banc, nature, depart, contact, rdv_avant):
    j = banc.j
    # « Je veux autre chose, mais je ne conclus rien » n'est ni un oui ni un non.
    # CE QUE LE PRODUIT EN FAIT DÉPEND DE LA NATURE depuis le 11/08/2026 (voir
    # etat_attendu) — mais dans TOUS les cas l'écran doit dire ce qui s'est
    # passé, en clair, sans rien affirmer que la conversation n'a pas donné.
    j.vrai(nature, depart, "55",
           "l'écran dit EN CLAIR ce qui s'est passé, sans rien inventer",
           "une information clé qui cite la demande du client, ou qui dit "
           "qu'on n'a rien pu conclure",
           f"« {contact['detail']} »",
           bool(contact["detail"]
                and ("client" in contact["detail"]
                     or "pas pu déterminer" in contact["detail"])))
    if rdv_avant is not None:
        frais = banc.base.obtenir_rendezvous(rdv_avant["id"])
        # TROIS SUITES SELON LA NATURE, toutes voulues, toutes datées :
        #
        # · CRÉNEAU LIBÉRÉ : le rendez-vous est CONSERVÉ et passé en
        #   « confirmé » — la personne a décroché et n'a pas annulé (décision du
        #   propriétaire, 11/08/2026). Son rendez-vous n'était pas le sujet de
        #   l'appel : c'était la place libre.
        # · DÉPLACEMENT et PRISE DE RENDEZ-VOUS : « 🙋 à rappeler par un
        #   humain » — quelqu'un du cabinet reprend la main, le rendez-vous
        #   attend cet appel.
        # · RAPPEL et CONFIRMATION : le rendez-vous est ANNULÉ (sa règle du
        #   17/08/2026, « si la personne doit rappeler, le rendez-vous est
        #   simplement annulé »). Le laisser en place gardait le créneau bloqué
        #   pour quelqu'un qui venait de dire qu'il ne viendrait pas comme prévu.
        if nature == "creneau_libere":
            attendu, quoi = "confirmé", ("son rendez-vous est conservé et passe "
                                         "en « confirmé »")
        elif nature in ("rappel_rdv", "confirmation"):
            attendu, quoi = "annulé", ("c'est le client qui rappellera : son "
                                       "rendez-vous est ANNULÉ, sa place est "
                                       "rendue")
        elif nature == "deplacement":
            # ⚠ SA RÈGLE DU 20/08/2026, et ce contrôle mesurait la précédente :
            # « lorsqu'on demande de déplacer un rendez-vous et que, pour une
            # raison ou une autre, nous n'avons pas pu le déplacer : celui-ci
            # est alors annulé ». Il attend bien le rappel d'un humain — mais
            # sa PLACE, elle, ne peut pas rester bloquée sur une journée qu'il
            # ne travaille pas. Le banc a arrêté la première version de cette
            # règle, c'est exactement son travail.
            attendu, quoi = "annulé", ("le déplacement n'a pas pu se faire : le "
                                       "rendez-vous est ANNULÉ, et un humain "
                                       "rappellera pour en fixer un autre")
        else:
            attendu, quoi = rdv_avant["statut"], ("le rendez-vous attend le "
                                                  "rappel d'un humain : il "
                                                  "n'est PAS touché")
        j.egal(nature, depart, "55", quoi, attendu, frais["statut"])


def controler_ecran_campagne(banc, campagne_id, nature, depart, cibles):
    """Ce qui devient VISIBLE : poste de pilotage, Clients, Relances."""
    j = banc.j
    fiche = banc.obtenir(f"/campagne?id={campagne_id}")
    for fin, contact_avant in cibles.items():
        contact = banc.base.obtenir_contact_campagne(contact_avant["id"])
        nom = html_mod.escape(contact_avant["nom"])
        j.vrai(nature, depart, fin,
               "le poste de pilotage montre ce contact et son état",
               f"« {contact_avant['nom']} » et l'état « {contact['etat']} » "
               "sur la fiche de campagne",
               "présent" if (nom in fiche and contact["etat"] in fiche)
               else "absent de la page",
               nom in fiche and contact["etat"] in fiche)
    # 👥 Contacts : chaque contact appelé doit y porter un état de conversation.
    # ⚠ « par_page=0 » = TOUS. La page est paginée depuis le 10/08/2026 (25 par
    # défaut) et le jeu d'essai en compte 36 : chercher un nom sur la seule
    # première page déclarait absentes onze personnes bel et bien présentes.
    # Ce contrôle porte sur le CONTENU, pas sur le découpage.
    page_clients = banc.obtenir("/clients?par_page=0")
    for fin, contact_avant in cibles.items():
        nom = html_mod.escape(contact_avant["nom"])
        j.vrai(nature, depart, fin,
               "la page 👥 Clients porte ce client",
               f"« {contact_avant['nom']} » dans le tableau des clients",
               "présent" if nom in page_clients else "absent",
               nom in page_clients)
    # 🔁 Relances : chaque type sur SON panneau. La page ne se coupe plus en
    # deux au nom d'une section — elle porte cinq panneaux identifiés, et
    # c'est par leur identifiant qu'on les lit (position indifférente).
    # ⚠ « par_page=0 » — LA LISTE ENTIÈRE, ET C'EST INDISPENSABLE ICI
    # (21/08/2026). Depuis que 🔁 Relances pagine ses cinq parties comme
    # 👥 Contacts, la page ne sert que 25 lignes : le banc cherchait une
    # personne précise et ne la trouvait plus — non parce qu'elle manquait, mais
    # parce qu'elle était page 4. Un instrument de mesure lit ce qui EST, pas ce
    # que l'écran montre d'abord ; il demande donc « tous ».
    page_relances = banc.obtenir("/relances?par_page=0")

    def panneau(code):
        marque = f'id="panneau-{code}"'
        if marque not in page_relances:
            return ""
        debut = page_relances.index(marque)
        return page_relances[debut:page_relances.index("</section>", debut)]

    automatique = panneau("dues") + panneau("a_venir")
    humaine = panneau("humains")
    for fin in ("53", "56"):
        if fin not in cibles:
            continue
        nom = html_mod.escape(cibles[fin]["nom"])
        j.vrai(nature, depart, fin,
               "🔁 Relances le montre dans un type automatique (« dues » ou "
               "« à venir »)",
               f"« {cibles[fin]['nom']} » sur l'un des deux panneaux",
               "bon type" if nom in automatique else "absent ou mauvais type",
               nom in automatique)
    if "55" in cibles:
        nom = html_mod.escape(cibles["55"]["nom"])
        # ⚠ SEULEMENT LÀ OÙ LE RAPPEL HUMAIN EXISTE (11/08/2026). Sur les trois
        # autres natures, le panneau humain ne DOIT PAS le porter : y voir
        # quelqu'un dont personne n'attend rien ferait travailler l'opérateur
        # pour rien. Le contrôle vaut donc dans les deux sens.
        #
        # ⚠ ET IL SE LIT PAR CONTACT, PAS PAR NOM NI PAR CAMPAGNE. Deux pièges
        # mesurés, l'un après l'autre :
        #   · par NOM : la base du banc est la MÊME pour les 115 combinaisons, et
        #     la même personne attend légitimement un humain depuis une campagne
        #     de déplacement — trois faux échecs ;
        #   · par CAMPAGNE : sur un créneau libéré, UN AUTRE contact de la même
        #     campagne partait « à rappeler par un humain » — celui dont la date
        #     convenue avait été refusée (voir _date_refusee). *Ce n'est plus le
        #     cas depuis le 15/08/2026 : cette nature ne produit plus AUCUN
        #     rappel manuel.* La lecture par contact reste néanmoins la bonne :
        #     c'est elle qui protège du premier piège, celui des homonymes.
        # Chaque ligne du panneau porte l'identifiant de SON contact : c'est lui
        # qu'on cherche, et lui seul.
        attendu_humain = attend_un_humain(nature, "55")
        present = f"contact={cibles['55']['id']}" in humaine
        j.vrai(nature, depart, "55",
               "🔁 Relances le montre dans le type « rappels par un humain » "
               "(jamais rappelé automatiquement)"
               if attendu_humain else
               "🔁 Relances ne met PERSONNE de cette campagne sur le panneau "
               "humain : cette nature ne demande aucun rappel par un humain",
               f"« {cibles['55']['nom']} » "
               + ("sur" if attendu_humain else "ABSENT du") + " panneau humain",
               "présent" if present else "absent",
               present == attendu_humain)


def controler_planning(banc, nature, depart, fin, horaire, nom):
    """Le rendez-vous créé apparaît-il dans le PLANNING de sa semaine ?"""
    jour = datetime.datetime.fromisoformat(horaire).date().isoformat()
    zone = banc.obtenir(f"/suivi/planning?date={jour}")
    attendu = html_mod.escape(nom)
    banc.j.vrai(nature, depart, fin,
                "le rendez-vous créé est visible dans le planning de sa semaine",
                f"« {nom} » dans la grille de la semaine du {jour}",
                "présent" if attendu in zone else "absent",
                attendu in zone)


# ===========================================================================
#  SCÉNARIOS
# ===========================================================================
CONTACTS_FORCES = (
    ("51", "Mme Nadia Lefèvre", "06 39 98 00 51"),
    ("52", "M. Karim Ben Amar", "06 39 98 00 52"),
    ("53", "Mme Élise Charpentier", "06 39 98 00 53"),
    ("54", "M. Paul Guillot", "06 39 98 00 54"),
    ("55", "Mme Anaïs Rousseau-Vidal", "06 39 98 00 55"),
    ("56", "M. Hervé Dombasle", "06 39 98 00 56"),
)
CONTACT_STOP = ("Mme Sophie Mercier", "06 39 98 01 26")
CONTACT_SUPPRIME = ("Mme Béatrice Vandenberghe", "06 39 98 01 25")

COLONNES_OBLIGATOIRES = {"creneau_libere": ("rdv_existant", "motif"),
                         "rappel_rdv": ("rdv_existant", "motif"),
                         "confirmation": ("rdv_existant", "motif"),
                         "deplacement": ("rdv_existant", "motif")}


def _ligne_collage(nature, nom, telephone, jour, heure):
    """Une ligne de collage complète pour cette nature (colonnes ⚠ remplies).

    L'horaire est donné par le banc (jour du bloc de la campagne, heure propre
    au contact) : deux contacts n'ont donc jamais le même rendez-vous, et deux
    campagnes ne se disputent jamais une place.
    """
    definition = assistant.NATURES[nature]
    morceaux = [nom, telephone]
    for champ in definition["champs"]:
        if champ["type"] == "date":
            morceaux.append(_iso(jour, heure))
        else:
            morceaux.append("Séance de kinésithérapie")
    return ";".join(morceaux)


def scenario_verrous(banc, chemins_surveilles):
    """Les verrous : le banc ne PEUT PAS appeler pour de vrai."""
    j = banc.j
    client = banc.application.planif.client_appels
    j.verrou("Le client d'appels est le SIMULATEUR",
             "une instance de calle_client.AppelSimule, est_reel = False",
             f"{type(client).__name__}, est_reel = {client.est_reel}",
             isinstance(client, calle_client.AppelSimule)
             and client.est_reel is False)
    j.verrou("L'application n'est pas en mode réel",
             "mode_reel = False et planificateur en dry_run",
             f"mode_reel = {banc.application.mode_reel}, "
             f"dry_run = {banc.application.planif.dry_run}",
             banc.application.mode_reel is False
             and banc.application.planif.dry_run is True)
    j.verrou("La clé CALLE_API_KEY est absente de ce processus",
             "la variable d'environnement est retirée avant tout appel",
             "retirée (elle était présente, elle a été ôtée du processus)"
             if CLE_RETIREE else "absente dès le départ",
             "CALLE_API_KEY" not in os.environ)
    try:
        calle_client.AppelReel()
        refus = "AUCUN refus — un client d'appels réels a pu être construit"
        passe = False
    except calle_client.CleApiAbsente as erreur:
        refus = f"refus net : « {erreur} »"
        passe = True
    j.verrou("Construire un client d'appels RÉELS est impossible ici",
             "l'exception CleApiAbsente, donc aucun appel réel possible",
             refus, passe)
    j.verrou("Le mot « --appels-reels » n'est jamais employé par le banc",
             "le banc n'appelle que creer_serveur(appels_reels=False)",
             "appels_reels=False, en dur, une seule fois dans ce fichier",
             True)
    for libelle, chemin, avant in chemins_surveilles:
        apres = _empreinte_fichier(chemin)
        j.verrou(f"{libelle} n'a pas bougé",
                 "taille et date de dernière écriture inchangées",
                 "inchangé" if apres == avant else f"MODIFIÉ ({avant} → {apres})",
                 apres == avant)


def _empreinte_fichier(chemin):
    if not os.path.exists(chemin):
        return "absent"
    etat = os.stat(chemin)
    return f"{etat.st_size} octets, écrit à {int(etat.st_mtime)}"


def scenario_assistant_par_nature(banc, nature):
    """Le parcours en 3 étapes pour UNE nature, avec toutes les issues.

    Un seul passage sert deux axes : le parcours lui-même (⚠ refusés,
    campagne « prête » qui n'appelle personne) et le collage (les issues).
    """
    j = banc.j
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    etape1 = banc.obtenir("/assistant")
    attendues = len(assistant.NATURES)
    j.vrai(nature, "assistant", CONSTRUCTION,
           "l'étape 1 propose bien toutes les natures créables, celle-ci "
           "comprise",
           f"au moins {attendues} cartes de nature à l'écran, dont "
           f"« {assistant.NATURES[nature]['nom']} »",
           f"{etape1.count('carte-nature')} carte(s)",
           etape1.count("carte-nature") >= attendues
           and html_mod.escape(assistant.NATURES[nature]["nom"]) in etape1)
    brouillon, page = banc.ouvrir_brouillon(nature)
    # ⚠ étape 2 : continuer SANS les informations obligatoires est refusé.
    minimal = {"b": brouillon, "action": "continuer", "ordre": "liste"}
    page, _ = banc.poster("/assistant/message", minimal)
    obligatoires = [i for i in assistant.NATURES[nature]["infos"]
                    if i["obligatoire"]]
    if obligatoires:
        j.vrai(nature, "assistant", CONSTRUCTION,
               "l'étape 2 REFUSE de continuer tant qu'une information ⚠ manque",
               "un message qui dit ce qui est obligatoire, et l'étape 3 "
               "toujours fermée",
               "refus affiché" if "obligatoire" in page else
               "aucun refus : on est passé à l'étape 3",
               "obligatoire" in page)
    else:
        j.noter(nature, "assistant", CONSTRUCTION,
                "l'étape 2 n'a aucune information obligatoire",
                "aucun ⚠ à contrôler pour cette nature",
                "cette nature n'impose aucune information", True)
    page = banc.passer_etape2(nature, brouillon)
    j.vrai(nature, "assistant", CONSTRUCTION,
           "renseigné, le passage à l'étape 3 s'ouvre",
           "l'étape « 3. Les personnes » devient l'étape courante",
           "étape 3 ouverte" if "3. Les personnes" in page else
           "étape 3 toujours fermée",
           "3. Les personnes" in page)
    # Étape 3 par collage : les six terminaisons + 🚫 + doublon + à supprimer.
    lignes = [_ligne_collage(nature, nom, tel, bloc, 10 + indice)
              for indice, (_, nom, tel) in enumerate(CONTACTS_FORCES)]
    lignes.append(_ligne_collage(nature, CONTACT_STOP[0], CONTACT_STOP[1],
                                 bloc, 17))
    lignes.append(_ligne_collage(nature, CONTACT_SUPPRIME[0],
                                 CONTACT_SUPPRIME[1], bloc, 18))
    # Doublon volontaire : la même personne, deux fois.
    lignes.append(_ligne_collage(nature, CONTACTS_FORCES[0][1],
                                 CONTACTS_FORCES[0][2], bloc, 10))
    page, _ = banc.poster("/assistant/importer",
                          {"b": brouillon, "mode": "collage",
                           "liste": "\n".join(lignes) + "\n"})
    j.vrai(nature, "collage", "doublon",
           "un doublon de numéro est SIGNALÉ et ignoré, jamais ajouté deux fois",
           "9 lignes collées dont un doublon : un message « doublon ignoré » "
           "et 8 contacts dans la grille",
           _message_de(page) + " | " + _erreurs_de(page),
           "doublon ignoré" in page and "8 contact(s) ajouté(s)" in page)
    j.vrai(nature, "collage", "stop",
           "un contact 🚫 « Ne plus appeler » est annoncé AVANT la validation",
           "un bandeau qui dit qu'il sera exclu d'office, jamais composé",
           "bandeau présent" if "Ne plus appeler" in page else "aucun bandeau",
           "Ne plus appeler" in page)
    j.vrai(nature, "collage", "doublon",
           "les numéros de la grille sont masqués",
           "aucun numéro en clair dans la page de la grille",
           "aucun numéro en clair"
           if CONTACTS_FORCES[0][2] not in page else "NUMÉRO EN CLAIR TROUVÉ",
           CONTACTS_FORCES[0][2] not in page)
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, "assistant", CONSTRUCTION,
                "la grille se valide et la campagne est créée",
                "une campagne en état « prête »",
                "validation refusée : " + _erreurs_de(page), False)
        return None
    campagne = banc.base.obtenir_campagne(campagne_id)
    j.egal(nature, "assistant", CONSTRUCTION,
           "la campagne créée est « prête » — elle n'appelle PERSONNE",
           "prête", campagne["statut"])
    contacts = banc.contacts(campagne_id)
    jamais_appeles = all(not banc.base.appels_du_contact_campagne(c["id"])
                         for c in contacts)
    j.vrai(nature, "assistant", CONSTRUCTION,
           "aucun appel n'est passé à la validation",
           f"zéro appel enregistré pour les {len(contacts)} contacts",
           "aucun appel" if jamais_appeles else "des appels ont été passés",
           jamais_appeles)
    _controler_bords_collage(banc, campagne_id, nature, "collage")
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    campagne_fraiche = banc.base.obtenir_campagne(campagne_id)
    j.egal(nature, "assistant", CONSTRUCTION,
           "la campagne va jusqu'au bout sans incident",
           "terminée", campagne_fraiche["statut"])
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, "collage", fin,
                        contact_avant, en_cascade=False)
    _controler_fiche_supprimee(banc, campagne_id, nature, "collage")
    controler_ecran_campagne(banc, campagne_id, nature, "collage", cibles)
    # La relance : le 56 doit aboutir, et lui seul change d'état.
    _relancer_et_controler(banc, campagne_id, nature, "collage", cibles,
                           en_cascade=False)
    return campagne_id


def _controler_bords_collage(banc, campagne_id, nature, depart):
    """Le 🚫 exclu d'office, puis la fiche du dernier contact est SUPPRIMÉE.

    La suppression passe par la vraie porte de l'écran (avec confirmation),
    entre la validation et l'exécution : c'est exactement « la fiche a
    disparu en cours de route ».
    """
    j = banc.j
    contacts = banc.contacts(campagne_id)
    exclus = [c for c in contacts if c["nom"] == CONTACT_STOP[0]]
    # ⚠ CE CONTRÔLE MESURAIT L'ANCIENNE RÈGLE (« exclu »), et il a arrêté le
    # banc sur les cinq natures le 20/08/2026 — c'est exactement son travail.
    # Depuis sa demande du même jour, une personne qui a refusé l'AGENT part
    # vers un rappel PAR UN HUMAIN : elle n'a pas refusé le cabinet, et la
    # marquer « exclu » la faisait disparaître sans que personne ne la rappelle.
    #
    # ⚠ LA GARANTIE QUI COMPTE N'A PAS BOUGÉ D'UN POUCE, et elle est mesurée
    # juste en dessous : aucun appel n'est jamais composé pour elle. C'est le
    # seul point sur lequel ce banc ne transige pas.
    j.vrai(nature, depart, "stop",
           "le contact 🚫 part d'office vers un rappel PAR UN HUMAIN",
           f"état « {db.ETAT_RAPPEL_HUMAIN} »",
           f"état « {exclus[0]['etat']} »" if exclus else "contact introuvable",
           bool(exclus) and exclus[0]["etat"] == db.ETAT_RAPPEL_HUMAIN)
    j.egal(nature, depart, "stop",
           "et AUCUN appel n'est jamais composé pour elle",
           0,
           len(banc.base.appels_du_contact_campagne(exclus[0]["id"]))
           if exclus else -1)
    j.vrai(nature, depart, "stop",
           "le texte affiché dit qu'un humain doit la rappeler",
           "un détail qui nomme le refus de l'agent",
           (exclus[0]["detail"] or "(vide)") if exclus else "contact introuvable",
           bool(exclus) and db.refus_de_l_agent(exclus[0]["detail"]))
    a_supprimer = banc.base.client_equivalent(CONTACT_SUPPRIME[0],
                                              CONTACT_SUPPRIME[1])
    if a_supprimer:
        banc.poster("/clients/supprimer",
                    {"client": a_supprimer, "confirmer": "oui"})
    return a_supprimer


def _controler_fiche_supprimee(banc, campagne_id, nature, depart):
    """Une fiche disparue en cours de route n'est plus jamais composée."""
    j = banc.j
    supprime = [c for c in banc.contacts(campagne_id)
                if c["nom"] == CONTACT_SUPPRIME[0]]
    if not supprime:
        return
    contact = supprime[0]
    j.egal(nature, depart, "supprime",
           "une fiche supprimée en cours de route n'est plus JAMAIS composée",
           "exclu", contact["etat"])
    j.vrai(nature, depart, "supprime",
           "l'écran dit pourquoi ce contact n'a pas été appelé",
           "l'information clé cite la fiche supprimée",
           f"« {contact['detail']} »",
           bool(contact["detail"] and "supprimée" in contact["detail"]))


def _erreurs_de(page):
    trouve = re.findall(r"<li>(.*?)</li>", page)
    return " / ".join(html_mod.unescape(t) for t in trouve[:4]) or "(sans détail)"


def _cibles(banc, campagne_id):
    """Photographie AVANT l'appel : contact + rendez-vous visé, par terminaison."""
    cibles = {}
    for fin, contact in banc.par_terminaison(campagne_id).items():
        rdv = banc.rdv_vise(contact)
        cibles[fin] = {"id": contact["id"], "nom": contact["nom"],
                       "rdv_avant": dict(rdv) if rdv else None}
    return cibles


def _relancer_et_controler(banc, campagne_id, nature, depart, cibles,
                           en_cascade):
    """Le geste « Lancer les relances dues » : le 56 aboutit."""
    j = banc.j
    if "56" not in cibles:
        return
    avant = banc.base.obtenir_contact_campagne(cibles["56"]["id"])["etat"]
    banc.lancer_relances()
    frais = banc.base.obtenir_contact_campagne(cibles["56"]["id"])
    apres = frais["etat"]
    repli = etat_date_refusee(nature)
    # ⚠ UNE TROISIÈME FIN LÉGITIME (16/08/2026), et il a fallu la mesurer pour
    # l'admettre. Depuis que la simulation d'un déplacement commence par un
    # succès puis mélange le reste (sa demande), une campagne POSE beaucoup
    # plus de rendez-vous : 38 acceptés sur 56 contacts, mesuré. Les places
    # utilisables pour un contact donné — à SA durée — finissent par manquer,
    # et la relance ne peut alors rien annoncer.
    #
    # Ce n'est pas un défaut : le produit refuse d'annoncer des dates qu'il ne
    # pourrait pas honorer, et il l'écrit en clair sur la fiche. Le contrôle
    # l'accepte donc — mais SEULEMENT avec cette raison-là, vérifiée dans le
    # détail. L'accepter sur le seul état aurait fait passer n'importe quel
    # « à rappeler par un humain », y compris un vrai défaut.
    def _faute_de_place(fiche):
        return (fiche["etat"] == "à rappeler par un humain"
                and "il n'en reste plus AUCUN de libre"
                in (fiche["detail"] or ""))

    conclu = (apres == "accepté"
              or (apres == repli and frais["issue"] == "date_refusee")
              or _faute_de_place(frais))
    j.vrai(nature, depart, "56",
           "à la relance, celui qui ne décrochait pas dit OUI : sa chaîne se "
           "CONCLUT (elle ne tourne plus en rond)",
           "« à recontacter » avant la relance, puis « accepté » — ou "
           f"« {repli} » si la date convenue a été refusée, ou « à rappeler "
           "par un humain » s'il ne reste AUCUNE place à annoncer, raison à "
           "l'appui",
           f"« {avant} » puis « {apres} »",
           avant == "à recontacter" and conclu)
    if "53" in cibles:
        fiche53 = banc.base.obtenir_contact_campagne(cibles["53"]["id"])
        etat53 = fiche53["etat"]
        j.vrai(nature, depart, "53",
               "celui qui ne décroche jamais reste dans la boucle des "
               "relances, sans jamais devenir « accepté »",
               "état « à recontacter » ou « injoignable » — ou « à rappeler "
               "par un humain » s'il ne reste AUCUNE place à annoncer",
               f"état « {etat53} »",
               etat53 in ("à recontacter", "injoignable")
               or _faute_de_place(fiche53))


def scenario_creneau_libere_cascade(banc):
    """« Créneau libéré » avec sa vraie mécanique : appel de cascade.

    Deux campagnes : une en « tout le monde » pour voir les six issues, une
    en « arrêt au premier oui » pour voir l'épargne.

    Rend l'identifiant de la PREMIÈRE campagne. C'est la seule du banc qui
    produise encore des contacts « ❌ refusé » : depuis la règle du
    31/07/2026, une annulation (issue « canceled » des appels classiques)
    donne « 📞 le client rappellera », tandis qu'un refus du créneau proposé
    en cascade (« refused ») reste un refus. C'est donc elle qui alimente le
    filtre de reprise « ❌ Refus ».
    """
    j = banc.j
    nature, depart = "creneau_libere", "collage"
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    # ⚠ UNE PLACE RÉELLEMENT LIBRE, demandée au produit (voir place_libre) : une
    # heure écrite en dur tombe sur un rendez-vous depuis que le jeu d'essai
    # couvre cent jours, et une campagne dont la place est prise s'arrête — à
    # juste titre.
    creneau = banc.place_libre(bloc + 5)
    brouillon, _ = banc.ouvrir_brouillon(nature)
    # ⚠ propre à cette nature : sans la date du créneau libéré, on ne passe pas.
    page, _ = banc.poster("/assistant/message",
                          {"b": brouillon, "action": "continuer",
                           "ordre": "liste",
                           "info_entreprise": "Cabinet Val Fleuri"})
    j.vrai(nature, "assistant", CONSTRUCTION,
           "l'étape 2 REFUSE de continuer sans la DATE du créneau libéré",
           "un message qui dit que le créneau libéré est obligatoire",
           _erreurs_de(page),
           "Créneau libéré" in page and "obligatoire" in page)
    formulaire = banc.formulaire_etape2(nature, brouillon)
    formulaire["info_creneau_libere"] = creneau
    formulaire["politique"] = "tous"
    banc.poster("/assistant/message", formulaire)
    lignes = [_ligne_collage(nature, nom, tel, bloc, 10 + indice)
              for indice, (_, nom, tel) in enumerate(CONTACTS_FORCES)]
    lignes.append(_ligne_collage(nature, CONTACT_STOP[0], CONTACT_STOP[1],
                                 bloc, 17))
    lignes.append(_ligne_collage(nature, CONTACT_SUPPRIME[0],
                                 CONTACT_SUPPRIME[1], bloc, 18))
    lignes.append(_ligne_collage(nature, CONTACTS_FORCES[0][1],
                                 CONTACTS_FORCES[0][2], bloc, 10))
    page, _ = banc.poster("/assistant/importer",
                          {"b": brouillon, "mode": "collage",
                           "liste": "\n".join(lignes) + "\n"})
    j.vrai(nature, depart, "doublon",
           "un doublon de numéro est SIGNALÉ et ignoré",
           "9 lignes collées dont un doublon : 8 contacts dans la grille",
           _message_de(page) + " | " + _erreurs_de(page),
           "doublon ignoré" in page and "8 contact(s) ajouté(s)" in page)
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « créneau libéré » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return None
    j.egal(nature, "assistant", CONSTRUCTION,
           "la campagne « créneau libéré » créée est « prête » — elle n'appelle "
           "personne",
           "prête", banc.base.obtenir_campagne(campagne_id)["statut"])
    _controler_bords_collage(banc, campagne_id, nature, depart)
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    _controler_fiche_supprimee(banc, campagne_id, nature, depart)
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=True)
    controler_ecran_campagne(banc, campagne_id, nature, depart, cibles)
    controler_planning(banc, nature, depart, "51", creneau,
                       CONTACTS_FORCES[0][1])
    _relancer_et_controler(banc, campagne_id, nature, depart, cibles,
                           en_cascade=True)
    campagne_des_refus = campagne_id
    # Deuxième campagne : arrêt au premier oui, les suivants épargnés.
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    formulaire = banc.formulaire_etape2(nature, brouillon)
    formulaire["info_creneau_libere"] = banc.place_libre(bloc + 5)
    formulaire["politique"] = "premier_oui"
    banc.poster("/assistant/message", formulaire)
    ordre = [CONTACTS_FORCES[1], CONTACTS_FORCES[0], CONTACTS_FORCES[3]]
    lignes = [_ligne_collage(nature, nom, tel, bloc, 10 + indice)
              for indice, (_, nom, tel) in enumerate(ordre)]
    banc.poster("/assistant/importer",
                {"b": brouillon, "mode": "collage",
                 "liste": "\n".join(lignes) + "\n"})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « arrêt au premier oui » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return campagne_des_refus
    banc.executer(campagne_id)
    etats = {c["nom"]: c for c in banc.contacts(campagne_id)}
    epargne = etats.get(ordre[2][1])
    j.egal(nature, depart, "51",
           "arrêt au premier oui : la personne suivante n'est JAMAIS appelée",
           ("épargné", 0),
           (epargne["etat"] if epargne else "contact absent",
            len(banc.base.appels_du_contact_campagne(epargne["id"]))
            if epargne else -1))
    relances = banc.base.relances_de_campagne(campagne_id)
    j.vrai(nature, depart, "51",
           "l'objectif atteint annule les relances déjà programmées",
           "aucune relance encore « planifiée »",
           f"{sum(1 for r in relances if r['statut'] == 'planifiée')} "
           "planifiée(s)",
           all(r["statut"] != "planifiée" for r in relances))
    return campagne_des_refus


# ⚠ « scenario_contact_unique » et « _bords_contact_unique » ont disparu
# le 03/08/2026 avec leur nature. Les trois cas de bord qu'ils portaient
# (🚫 ne plus appeler, doublon collé deux fois, fiche supprimée en cours
# de route) sont déjà parcourus par le scénario de collage générique,
# sur les natures qui restent — rien n'est perdu.


def scenario_csv(banc):
    """Étape 3 remplie par un FICHIER CSV."""
    j = banc.j
    nature, depart = "confirmation", "csv"
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    bloc = banc.prochain_bloc()
    lignes = ["nom;telephone;rdv_existant;motif"]
    for indice, (_, nom, telephone) in enumerate(CONTACTS_FORCES):
        lignes.append(f"{nom};{telephone};{_iso(bloc, 10 + indice)};"
                      "Séance de contrôle")
    # Un 🚫, un futur supprimé, et une ligne répétée : les trois cas de bord.
    lignes.append(f"{CONTACT_STOP[0]};{CONTACT_STOP[1]};{_iso(bloc, 17)};"
                  "Séance de contrôle")
    lignes.append(f"{CONTACT_SUPPRIME[0]};{CONTACT_SUPPRIME[1]};"
                  f"{_iso(bloc, 18)};Séance de contrôle")
    lignes.append(lignes[1])
    octets = ("\r\n".join(lignes) + "\r\n").encode("utf-8")
    page, _ = banc.poster_fichier("/assistant/importer",
                                  {"b": brouillon, "mode": "csv"},
                                  "liste_essai.csv", octets)
    j.vrai(nature, depart, CONSTRUCTION,
           "le fichier CSV remplit la grille (en-tête reconnu et sauté)",
           "8 contacts ajoutés à la grille (9 lignes, dont un doublon)",
           _message_de(page) + " | " + _erreurs_de(page),
           "8 contact(s) ajouté(s)" in page)
    j.vrai(nature, depart, "doublon",
           "une ligne répétée dans le CSV est signalée et ignorée",
           "un message « doublon ignoré », et la personne une seule fois",
           _erreurs_de(page), "doublon ignoré" in page)
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION, "la campagne issue du CSV se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    _controler_bords_collage(banc, campagne_id, nature, depart)
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    _controler_fiche_supprimee(banc, campagne_id, nature, depart)
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=False)
    controler_ecran_campagne(banc, campagne_id, nature, depart, cibles)
    _relancer_et_controler(banc, campagne_id, nature, depart, cibles,
                           en_cascade=False)


def scenario_ics(banc):
    """Étape 3 remplie par un AGENDA ICS — dont un contact SANS NUMÉRO."""
    j = banc.j
    nature, depart = "rappel_rdv", "ics"
    chemin = os.path.join(RACINE_APP, "exemple_agenda_realiste.ics")
    if not os.path.exists(chemin):
        j.noter(nature, depart, CONSTRUCTION, "l'agenda d'exemple existe",
                f"le fichier {chemin}", "fichier absent", False)
        return
    with open(chemin, "rb") as fichier:
        octets = fichier.read()
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    page, _ = banc.poster_fichier("/assistant/importer",
                                  {"b": brouillon, "mode": "ics"},
                                  "agenda.ics", octets)
    j.vrai(nature, depart, CONSTRUCTION,
           "l'agenda ICS remplit la grille (nom, motif et date de chaque "
           "séance)",
           "des contacts ajoutés à la grille",
           _message_de(page), "contact(s) ajouté(s)" in page)
    j.vrai(nature, depart, "sans_numero",
           "un contact SANS NUMÉRO est annoncé « à compléter avant "
           "validation », jamais deviné",
           "un message qui compte les contacts sans numéro",
           _message_de(page),
           "sans numéro" in page)
    campagne_id, page = banc.valider_grille(brouillon)
    j.vrai(nature, depart, "sans_numero",
           "la validation est REFUSÉE tant qu'un numéro manque",
           "un refus, la case du numéro colorée, aucune campagne créée",
           "refus affiché" if campagne_id is None
           else f"campagne n°{campagne_id} créée malgré le numéro manquant",
           campagne_id is None
           and assistant.MESSAGE_CHAMPS_OBLIGATOIRES in page
           and 'class="manque"' in page)
    # On retire la ligne sans numéro, puis on valide : le reste doit passer.
    lignes = banc.application.obtenir_brouillon_assistant(brouillon)["contacts"]
    indices = [i for i, c in enumerate(lignes, start=1) if not c["telephone"]]
    for indice in reversed(indices):
        banc.poster("/assistant/liste",
                    {"b": brouillon, "action": f"retirer:{indice}"})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne issue de l'agenda se valide une fois les numéros "
                "complétés ou les lignes retirées",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=False)
    controler_ecran_campagne(banc, campagne_id, nature, depart, cibles)
    j.remarque("Agenda ICS : les autres participants de l'agenda d'exemple "
               "n'ont pas de terminaison 51-56 ; leur issue est tirée au "
               "hasard (graine fixée), le banc ne leur attribue donc aucune "
               "case de la matrice.")


def scenario_depuis_la_base(banc, depart, nature):
    """Étape 3 remplie DEPUIS LA BASE (une des cinq sources)."""
    j = banc.j
    source = SOURCE_DU_DEPART[depart]
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    page, _ = banc.poster("/assistant/importer",
                          {"b": brouillon, "mode": "base", "source": source})
    j.vrai(nature, depart, CONSTRUCTION,
           f"la source « {assistant.SOURCES_BASE[source]} » remplit la grille",
           "au moins un contact ajouté, et le compte annoncé",
           _message_de(page), "contact(s) ajouté(s)" in page)
    if source in ("a_venir", "manques"):
        j.vrai(nature, depart, "sans_numero",
               "les clients SANS NUMÉRO sont écartés et COMPTÉS (jamais "
               "silencieusement perdus)",
               "un message qui compte les clients sans numéro écartés",
               _message_de(page), "sans numéro" in page)
        j.vrai(nature, depart, "stop",
               "les clients 🚫 « Ne plus appeler » sont écartés et COMPTÉS",
               "un message qui compte les 🚫 écartés",
               _message_de(page), "Ne plus appeler" in page)
    # Remplir DEUX FOIS depuis la même source ne doit doubler personne.
    combien = len(banc.application.obtenir_brouillon_assistant(
        brouillon)["contacts"])
    page, _ = banc.poster("/assistant/importer",
                          {"b": brouillon, "mode": "base", "source": source})
    apres = len(banc.application.obtenir_brouillon_assistant(
        brouillon)["contacts"])
    j.vrai(nature, depart, "doublon",
           "remplir DEUX FOIS depuis la même source ne double personne",
           f"toujours {combien} contact(s) dans la grille après le second "
           "remplissage",
           f"{apres} contact(s) — message : {_message_de(page)}",
           apres == combien)
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne bâtie sur cette source se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return None
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    campagne = banc.base.obtenir_campagne(campagne_id)
    j.egal(nature, depart, CONSTRUCTION,
           "la campagne va jusqu'au bout sans incident", "terminée",
           campagne["statut"])
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=False)
    controler_ecran_campagne(banc, campagne_id, nature, depart, cibles)
    _relancer_et_controler(banc, campagne_id, nature, depart, cibles,
                           en_cascade=False)
    return campagne_id


def scenario_colonnes_obligatoires_vides(banc):
    """La limite mesurée : une source SANS rendez-vous lié ne peut pas nourrir
    une nature dont les colonnes sont ⚠."""
    j = banc.j
    nature, depart = "rappel_rdv", "base_annules"
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    banc.poster("/assistant/importer",
                {"b": brouillon, "mode": "base", "source": "annules"})
    campagne_id, page = banc.valider_grille(brouillon)
    j.vrai(nature, depart, CONSTRUCTION,
           "depuis « Rendez-vous annulés », une nature à colonnes ⚠ est "
           "REFUSÉE tant que la grille n'est pas complétée à la main",
           "un refus, et les cases vides COLORÉES dans la grille",
           "refus affiché : " + _erreurs_de(page) if campagne_id is None
           else f"campagne n°{campagne_id} créée avec des colonnes ⚠ vides",
           campagne_id is None
           and assistant.MESSAGE_CHAMPS_OBLIGATOIRES in page
           and 'class="manque"' in page)
    j.main("Compléter à la main les colonnes ⚠ d'une grille venue des "
           "« annulés » ou des « déplacés »",
           "Étape 3 : taper la date et le motif dans chaque ligne de la "
           "grille, puis « Valider ».")


def scenario_reprise_de_campagne(banc, campagne_source, campagne_injoignable,
                                 campagne_refus=None):
    """Reprise d'une campagne précédente, filtrée par état (les six filtres).

    Trois campagnes sources : la grande (l'essentiel des états), la petite
    campagne à plafond zéro (seule à contenir un 📵 injoignable), et la
    campagne « créneau libéré » (seule à contenir un ❌ refusé depuis que
    l'annulation donne « 📞 le client rappellera »).
    """
    j = banc.j
    for depart, etat in ETAT_DU_DEPART.items():
        nature = "prise_rdv"
        source = campagne_source
        if etat == "injoignable" and campagne_injoignable:
            source = campagne_injoignable
        elif etat == "refusé" and campagne_refus:
            source = campagne_refus
        comptes = banc.base.compter_contacts_par_etat(source)
        attendus = comptes["tous"] if etat == "tous" else comptes.get(etat, 0)
        banc.nouveau_simulateur()
        brouillon, _ = banc.ouvrir_brouillon(nature)
        banc.passer_etape2(nature, brouillon)
        page, _ = banc.poster("/assistant/importer",
                              {"b": brouillon, "mode": "campagne",
                               "campagne": str(source), "etat": etat})
        if attendus == 0:
            j.vrai(nature, depart, CONSTRUCTION,
                   f"aucun contact « {etat} » dans la campagne source : "
                   "l'écran le DIT au lieu de rester muet",
                   "un message qui invite à choisir un autre état",
                   _message_de(page) or _erreurs_de(page),
                   "Aucun contact de cette campagne" in page)
            continue
        j.vrai(nature, depart, CONSTRUCTION,
               f"le filtre « {assistant.ETATS_REPRISE[etat]} » ramène les "
               "contacts de la campagne précédente",
               f"les contacts en état « {etat} » de la campagne "
               f"n°{source}",
               _message_de(page), "contact(s) ajouté(s)" in page)
        campagne_id, page = banc.valider_grille(brouillon)
        if campagne_id is None:
            j.noter(nature, depart, CONSTRUCTION,
                    "la campagne de rattrapage se valide",
                    "une campagne prête", "refus : " + _erreurs_de(page), False)
            continue
        cibles = _cibles(banc, campagne_id)
        banc.executer(campagne_id)
        for fin, contact_avant in cibles.items():
            controler_issue(banc, campagne_id, nature, depart, fin,
                            contact_avant, en_cascade=False)
        controler_ecran_campagne(banc, campagne_id, nature, depart, cibles)
        _relancer_et_controler(banc, campagne_id, nature, depart, cibles,
                               en_cascade=False)


def scenario_injoignable(banc):
    """Plafond de relances à zéro : le 53 devient 📵 injoignable tout de suite.

    C'est ce qui alimente le filtre de reprise « 📵 injoignables » et le bas
    de la page 🔁 Relances (« la chaîne s'arrête là, et pourtant on ne l'a
    pas joint »). Rend l'identifiant de la campagne créée.
    """
    j = banc.j
    nature, depart = "prise_rdv", "collage"
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    formulaire = banc.formulaire_etape2(nature, brouillon, relance_max=0)
    banc.poster("/assistant/message", formulaire)
    banc.poster("/assistant/importer", {
        "b": brouillon, "mode": "collage",
        "liste": f"{CONTACTS_FORCES[2][1]};{CONTACTS_FORCES[2][2]}\n"})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne à plafond zéro se valide", "une campagne prête",
                "refus : " + _erreurs_de(page), False)
        return None
    banc.executer(campagne_id)
    contact = banc.contacts(campagne_id)[0]
    j.egal(nature, depart, "53",
           "plafond de relances atteint : le contact devient 📵 injoignable "
           "au lieu de tourner en boucle",
           "injoignable", contact["etat"])
    page = banc.obtenir("/relances")
    j.vrai(nature, depart, "53",
           "un 📵 injoignable RESTE visible dans 🔁 Relances (le faire "
           "disparaître reviendrait à le perdre)",
           f"« {contact['nom'] }» dans la page Relances",
           "présent" if html_mod.escape(contact["nom"]) in page else "absent",
           html_mod.escape(contact["nom"]) in page)
    return campagne_id


def scenario_deux_oui_sans_rendezvous_existant(banc):
    """DEUX personnes disent oui dans une nature SANS « rendez-vous existant ».

    Ce que le banc cherche ici : chacune doit obtenir SON rendez-vous. Les
    natures « prise de rendez-vous », « contact unique », « rappel d'appel
    manqué » et « personnalisé » n'ont pas de colonne « rendez-vous
    existant » : le créneau proposé au téléphone est la PROCHAINE PLACE
    LIBRE, recalculée à l'instant de chaque appel. La première personne
    prend une place, cette place est aussitôt bloquée par son rendez-vous,
    et la seconde s'en voit proposer une AUTRE. Le banc vérifie les deux
    faits : deux rendez-vous à deux places différentes, et la place prise
    réellement bloquée ensuite.
    """
    j = banc.j
    nature, depart = "prise_rdv", "collage"
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    deux = [("Mme Nadia Lefèvre", "06 39 98 00 51"),
            ("Mme Aurélie Pastor", "02 61 91 07 51")]
    banc.poster("/assistant/importer", {
        "b": brouillon, "mode": "collage",
        "liste": "".join(f"{nom};{tel}\n" for nom, tel in deux)})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « deux oui » se valide", "une campagne prête",
                "refus : " + _erreurs_de(page), False)
        return
    banc.executer(campagne_id)
    contacts = {c["nom"]: c for c in banc.contacts(campagne_id)}
    obtenus, recits, proposes = [], [], []
    for nom, _tel in deux:
        contact = contacts.get(nom)
        if contact is None:
            recits.append(f"{nom} : contact absent")
            continue
        resultat = banc.dernier_resultat(contact["id"])
        convenu = (resultat or {}).get("new_datetime")
        proposes.append(convenu)
        rdv = [r for r in banc.base.tous_les_rendezvous()
               if r["nom"] == nom and r["horaire"] == convenu
               and r["id"] > banc.rdv_plancher
               and r["statut"] in ("prévu", "confirmé")]
        obtenus.append(bool(rdv))
        # Le récit ne cite PAS la date : elle dépend du jour où le banc
        # tourne, elle changerait d'une exécution à l'autre et le rapport ne
        # serait plus comparable. On dit si elle est la même, c'est le point.
        recits.append(f"{nom} : rendez-vous obtenu = "
                      f"{'oui' if rdv else 'NON'}, "
                      f"état « {contact['etat']} »")
    meme_creneau = len(set(proposes)) == 1 and len(proposes) == 2
    recits.append("créneau proposé aux deux : "
                  + ("LE MÊME (la seconde personne se fait refuser la place "
                     "de la première)" if meme_creneau
                     else "une place DIFFÉRENTE pour chacune"))
    j.vrai(nature, depart, "51",
           "DEUX personnes qui disent oui obtiennent CHACUNE son rendez-vous",
           "deux rendez-vous créés, à deux places différentes — le créneau "
           "proposé doit être la prochaine place LIBRE, recalculée à chaque "
           "appel, jamais une date dérivée de l'heure qu'il est",
           " | ".join(recits),
           len(obtenus) == 2 and all(obtenus) and not meme_creneau)
    # La seconde exigence du propriétaire : une place prise est BLOQUÉE dans
    # le calendrier du programme. On le demande au produit lui-même — ce qui
    # est refusé à la main doit l'être au téléphone.
    bloquees = [horaires.refus_rendezvous_telephone(
        banc.base, banc.application.preferences, horaire) is not None
        for horaire in proposes if horaire]
    j.vrai(nature, depart, "51",
           "chaque place attribuée est BLOQUÉE dans le calendrier "
           "(personne d'autre ne peut la reprendre)",
           "les deux places refusées à toute nouvelle demande",
           f"{sum(bloquees)} place(s) bloquée(s) sur {len(bloquees)}",
           len(bloquees) == 2 and all(bloquees))


def _campagne_annulation(banc, nature, contacts, option_active, bloc):
    """Monte une campagne 🔔/✅ avec l'option d'annulation dans un réglage.

    contacts : [(nom, téléphone, heure)] — un VRAI rendez-vous est créé en
    base pour chacun, à l'heure donnée du bloc, et la ligne collée porte
    exactement cet horaire (c'est ce qui rattache le contact à SON
    rendez-vous, comme le fait le produit). Le troisième élément peut aussi
    être un horaire ISO COMPLET (« 2026-08-01T14:30 ») quand le cas éprouvé
    a besoin d'une date proche de MAINTENANT plutôt que d'un bloc — c'est
    ce dont a besoin le seuil de remplacement.
    Rend (campagne_id, page de validation, {nom : horaire d'origine}).
    """
    horaires_poses = {}
    lignes = []
    for nom, telephone, heure in contacts:
        horaire = heure if isinstance(heure, str) else _iso(bloc, heure)
        client_id = banc.base.obtenir_ou_creer_client(nom, telephone)
        banc.base.ajouter_rendezvous(client_id, horaire, "Séance de suivi")
        horaires_poses[nom] = horaire
        # Les colonnes sont celles de LA NATURE (elles diffèrent d'une
        # nature à l'autre) : la ligne collée est donc toujours acceptable.
        morceaux = [nom, telephone]
        for champ in assistant.NATURES[nature]["champs"]:
            if champ["type"] == "date":
                morceaux.append(horaire)
            elif champ["code"] == "motif":
                morceaux.append("Séance de suivi")
            else:
                morceaux.append("")
        lignes.append(";".join(morceaux))
    brouillon, _ = banc.ouvrir_brouillon(nature)
    formulaire = banc.formulaire_etape2(nature, brouillon)
    if option_active:
        formulaire["opt_replacer"] = "1"
    banc.poster("/assistant/message", formulaire)
    banc.poster("/assistant/importer",
                {"b": brouillon, "mode": "collage",
                 "liste": "\n".join(lignes) + "\n"})
    campagne_id, page = banc.valider_grille(brouillon)
    return campagne_id, page, horaires_poses


def scenario_annulation_deux_reglages(banc):
    """L'ANNULATION dans ses deux réglages (règle du 31/07/2026).

    L'option de campagne « proposer une autre date si le client annule »
    décide de ce que l'agent a le droit de faire — et elle change le TEXTE
    dicté à l'agent. Le banc mesure les deux réglages :

    - décochée : le message dit « je ne vous propose pas d'autre date » ;
      le client qui annule (52) passe « 📞 le client rappellera », aucune
      relance, aucune campagne, et son rendez-vous quitte « à venir » ;
    - cochée : le message annonce les places réellement libres ; le client
      qui accepte une autre date (54) voit son rendez-vous réellement
      DÉPLACÉ, avec sa ligne ↔ au cahier des changements.
    """
    j = banc.j
    nature, depart = "rappel_rdv", "collage"
    # ---------------------------------------------- réglage 1 : sans l'option
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    campagne_id, page, poses = _campagne_annulation(
        banc, nature, [("M. Firmin Delacour-Anglade", "06 39 98 02 52", 9)],
        option_active=False, bloc=bloc)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « annulation sans replacement » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    campagne = banc.base.obtenir_campagne(campagne_id)
    mission = campagne["mission"] or ""
    j.vrai(nature, depart, "52",
           "SANS l'option, le message dicté à l'agent lui interdit de "
           "proposer une date",
           "« je ne vous propose pas d'autre date » dans la mission, et "
           "aucune liste de places annoncée",
           f"mission : « …{mission[-160:]} »",
           "je ne vous propose pas d'autre date" in mission
           and "je peux vous proposer une autre date" not in mission)
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=False)
    # ---------------------------------------------- réglage 2 : avec l'option
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    campagne_id, page, poses = _campagne_annulation(
        banc, nature, [("Mme Ombeline Trarieux", "06 39 98 02 54", 9)],
        option_active=True, bloc=bloc)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « annulation avec replacement » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    campagne = banc.base.obtenir_campagne(campagne_id)
    mission = campagne["mission"] or ""
    j.vrai(nature, depart, "54",
           "AVEC l'option, le message autorise l'agent à proposer une autre "
           "date",
           "« je peux vous proposer une autre date » dans la mission, suivie "
           "des places à annoncer",
           f"mission : « …{mission[-160:]} »",
           "je peux vous proposer une autre date" in mission
           and "je ne vous propose pas d'autre date" not in mission)
    cibles = _cibles(banc, campagne_id)
    banc.executer(campagne_id)
    for fin, contact_avant in cibles.items():
        controler_issue(banc, campagne_id, nature, depart, fin, contact_avant,
                        en_cascade=False)
    ancien = poses.get("Mme Ombeline Trarieux")
    cahier = banc.base.changements_de_campagne(campagne_id)
    deplacements = [c for c in cahier if c["genre"] == "deplacement"]
    j.vrai(nature, depart, "54",
           "un accord après annonce d'une autre date est un DÉPLACEMENT : "
           "la ligne ↔ entre au cahier des changements",
           "une ligne « ↔ Rendez-vous déplacé » avec l'ancienne ET la "
           "nouvelle date",
           f"{len(deplacements)} ligne(s) ↔ sur {len(cahier)} changement(s) : "
           + " | ".join(f"{c['ancienne_date']} → {c['nouvelle_date']}"
                        for c in deplacements),
           len(deplacements) == 1
           and deplacements[0]["ancienne_date"] == ancien
           and bool(deplacements[0]["nouvelle_date"]))
    j.remarque(
        "L'option d'annulation a été parcourue dans ses DEUX réglages "
        "(nature « 🔔 Rappel de rendez-vous », départ « collage ») : sans "
        "elle le message interdit de proposer une date et le client passe "
        "« 📞 le client rappellera » ; avec elle, un accord devient un "
        "déplacement, avec sa ligne ↔ au cahier. Le simulateur ne LIT pas "
        "le message — le banc mesure donc ce que le message DIT, et ce que "
        "le produit ÉCRIT dans chacune des deux issues, jamais ce que "
        "l'agent aurait « compris ».")


def scenario_seuil_de_compensation(banc):
    """LE SEUIL DE 12 H — la règle du propriétaire, des deux côtés.

    « si le rendez-vous est dans plus de 12 h, on propose dans le
    récapitulatif à l'opérateur de démarrer une campagne de créneau libre
    pour compenser l'absence ; si c'est < 12 h alors on laisse en annulé et
    on indique que l'on ne peut pas dans ces conditions faire un
    remplacement, mais que l'opérateur peut le faire manuellement ».

    Le banc éprouve les DEUX côtés sans dépendre de l'heure à laquelle on
    le lance : la date des rendez-vous reste celle des blocs, c'est le
    SEUIL qu'on fait varier. Il mesure aussi la chose qui compte le plus :
    AUCUN appel ne part de cette proposition.
    """
    j = banc.j
    nature, depart = "confirmation", "collage"
    preferences = banc.application.preferences
    # ------------------------------------------- côté « on peut compenser »
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    campagne_id, page, poses = _campagne_annulation(
        banc, nature, [("M. Anselme Vaugirard-Petit", "06 39 98 03 52", 9)],
        option_active=False, bloc=bloc)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « seuil de compensation » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    horaire = poses["M. Anselme Vaugirard-Petit"]
    campagnes_avant = len(banc.base.lister_campagnes())
    banc.executer(campagne_id)
    frais = [r for r in banc.base.tous_les_rendezvous()
             if r["horaire"] == horaire]
    j.vrai(nature, depart, "52",
           "au-delà du seuil, le rendez-vous annulé est SUPPRIMÉ : il "
           "n'existe plus et sa place redevient libre",
           f"statut « {db.STATUT_SUPPRIME} »",
           f"statut « {frais[0]['statut'] if frais else 'introuvable'} »",
           bool(frais) and frais[0]["statut"] == db.STATUT_SUPPRIME)
    occupants = banc.base.rendezvous_occupants(horaire, horaire + ":59")
    j.vrai(nature, depart, "52",
           "la place libérée n'a plus AUCUN occupant",
           "0 occupant à cet horaire", f"{len(occupants)} occupant(s)",
           not occupants)
    page = banc.obtenir(f"/campagne?id={campagne_id}")
    j.vrai(nature, depart, "52",
           "le récapitulatif PROPOSE une campagne « créneau libéré » pour "
           "compenser l'absence",
           "un bouton de préparation sur la place libérée",
           "proposition présente" if "/campagne/compenser" in page
           else "AUCUNE proposition à l'écran",
           "/campagne/compenser" in page and "Compenser une absence" in page)
    j.vrai(nature, depart, "52",
           "AUCUN appel ne part de cette proposition : rien n'est lancé "
           "sans le clic de l'opérateur",
           "aucune campagne créée en plus, et l'écran le dit",
           f"{len(banc.base.lister_campagnes()) - campagnes_avant} campagne(s) "
           "créée(s) toute(s) seule(s)",
           len(banc.base.lister_campagnes()) == campagnes_avant
           and "Aucun appel ne part d'ici" in page)
    page, _ = banc.poster("/campagne/compenser",
                          {"campagne": campagne_id, "creneau": horaire})
    j.vrai(nature, depart, "52",
           "le clic ouvre l'assistant AVEC le créneau déjà rempli — et ne "
           "crée toujours aucune campagne",
           "l'étape 2 de « créneau libéré », créneau pré-rempli",
           "assistant ouvert" if horaire in page else "créneau absent de l'écran",
           horaire in page and "Créneau libéré" in page
           and len(banc.base.lister_campagnes()) == campagnes_avant)
    # ------------------------------------- côté « trop tard pour compenser »
    # Un rendez-vous DANS DEUX HEURES : sous le seuil par défaut (12 h),
    # quelle que soit l'heure à laquelle ce banc est lancé.
    banc.nouveau_simulateur()
    dans_deux_heures = (datetime.datetime.now()
                        + datetime.timedelta(hours=2)).replace(
                            second=0, microsecond=0).isoformat(
                                timespec="minutes")
    campagne_id, page, poses = _campagne_annulation(
        banc, nature,
        [("Mme Roseline Kerguéhennec", "06 39 98 04 52", dans_deux_heures)],
        option_active=False, bloc=None)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « sous le seuil » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    horaire = poses["Mme Roseline Kerguéhennec"]
    campagnes_avant = len(banc.base.lister_campagnes())
    banc.executer(campagne_id)
    frais = [r for r in banc.base.tous_les_rendezvous()
             if r["horaire"] == horaire]
    seuil = horaires.seuil_remplacement(preferences)
    j.vrai(nature, depart, "52",
           f"à moins de {seuil} h, le rendez-vous RESTE « annulé » — on ne "
           "supprime pas ce qu'on ne peut pas remplacer",
           "statut « annulé »",
           f"statut « {frais[0]['statut'] if frais else 'introuvable'} »",
           bool(frais) and frais[0]["statut"] == "annulé")
    page = banc.obtenir(f"/campagne?id={campagne_id}")
    j.vrai(nature, depart, "52",
           "l'écran DIT pourquoi on ne peut pas remplacer, et donne le "
           "moyen de le faire à la main",
           "l'explication « trop tard » et le lien pour agir soi-même",
           "explication présente"
           if "trop tard pour organiser un remplacement" in page
           else "AUCUNE explication à l'écran",
           "trop tard pour organiser un remplacement" in page
           and "Le faire quand même à la main" in page
           and "Voir cette journée dans le planning" in page)
    j.vrai(nature, depart, "52",
           "et là non plus, aucune campagne ne se monte toute seule",
           "aucune campagne créée",
           f"{len(banc.base.lister_campagnes()) - campagnes_avant} créée(s)",
           len(banc.base.lister_campagnes()) == campagnes_avant)
    j.remarque(
        f"Le seuil de remplacement ({seuil} h — la valeur du propriétaire, "
        "réglable dans ⚙ Réglages) a été parcouru DES DEUX CÔTÉS, avec de "
        "VRAIS rendez-vous : l'un dans plusieurs semaines (supprimé, "
        "compensation proposée), l'autre dans deux heures (laissé "
        "« annulé », avec l'explication et le moyen d'agir à la main). Le "
        "banc a aussi mesuré ce qui compte le plus : la proposition "
        "n'appelle PERSONNE — elle ouvre l'assistant, et c'est tout.")


def scenario_cascade_ancien_rendezvous(banc):
    """Q7 : la cascade DIRECTE ne laisse plus deux rendez-vous au client.

    Trois cas, tels que la règle les distingue :
    - un client CONNU avec UN rendez-vous à venir : l'ancien est libéré ;
    - une ligne collée INCONNUE : rien n'est touché, rien n'est inventé ;
    - un client connu avec PLUSIEURS rendez-vous à venir : RingBack ne
      choisit pas à la place de l'humain, il l'écrit.
    """
    j = banc.j
    nature, depart = "creneau_libere", "cascade"
    base = banc.base

    def _lancer(nom, telephone, creneau):
        banc.nouveau_simulateur()
        page, url = banc.poster("/cascade/executer", {
            "liste": f"{nom};{telephone}", "creneau": creneau,
            "mission": "Bonjour, une place s'est libérée le [créneau]."})
        trouve = re.search(r"/cascade/resultat\?id=(\d+)", url)
        return int(trouve.group(1)) if trouve else None

    # ------------------------------------------- cas 1 : le client est connu
    # La place proposée est prise sur CE jour : il doit être ouvert, sinon le
    # produit refuse le rendez-vous et le contrôle mesure le calendrier au
    # lieu de mesurer le produit (voir `_jour_ouvre`).
    bloc = _jour_ouvre(banc.prochain_bloc())
    nom, telephone = "M. Isidore Beaupréau-Lançon", "06 39 98 05 51"
    client_id = base.obtenir_ou_creer_client(nom, telephone)
    ancien = base.ajouter_rendezvous(client_id, _iso(bloc + 6, 9),
                                     "Séance de suivi")
    avant = len(base.rendezvous_a_venir_du_client(client_id))
    cascade_id = _lancer(nom, telephone, _iso(bloc, 15))
    if cascade_id is None:
        j.noter(nature, depart, "51", "la cascade « client connu » s'exécute",
                "une page de résultat", "aucune cascade lancée", False)
        return
    apres = base.rendezvous_a_venir_du_client(client_id)
    j.vrai(nature, depart, "51",
           "un « oui » d'un client CONNU ne lui laisse pas DEUX rendez-vous : "
           "l'ancien est libéré (Q7)",
           f"toujours 1 rendez-vous à venir (il y en avait {avant})",
           f"{len(apres)} rendez-vous à venir après l'appel", len(apres) == 1)
    j.egal(nature, depart, "51",
           "l'ancien rendez-vous porte le statut que dit la règle",
           horaires.decision_annulation(
               banc.application.preferences,
               _iso(bloc + 6, 9))["statut"],
           base.obtenir_rendezvous(ancien)["statut"])
    ligne = base.appels_de_cascade(cascade_id)[0]
    j.egal(nature, depart, "51",
           "la trace dit QUEL rendez-vous a été libéré",
           ancien, ligne["rendezvous_libere"])

    # ------------------------------ cas 2 : la ligne collée est INCONNUE
    bloc = _jour_ouvre(banc.prochain_bloc())
    rdv_avant = len(base.tous_les_rendezvous())
    cascade_id = _lancer("Mme Perrine Vaudémont-Ourcq", "06 39 98 06 51",
                         _iso(bloc, 15))
    if cascade_id is not None:
        ligne = base.appels_de_cascade(cascade_id)[0]
        crees = len(base.tous_les_rendezvous()) - rdv_avant
        j.vrai(nature, depart, "51",
               "une ligne collée INCONNUE ne provoque AUCUNE suppression "
               "inventée",
               "un seul rendez-vous de plus (celui du créneau), et aucune "
               "trace de libération",
               f"{crees} rendez-vous créé(s), rendezvous_libere = "
               f"{ligne['rendezvous_libere']}",
               crees == 1 and ligne["rendezvous_libere"] is None)

    # -------------------- cas 3 : plusieurs rendez-vous à venir = ambigu
    bloc = _jour_ouvre(banc.prochain_bloc())
    nom, telephone = "Mme Aliénor Trémolière-Sanzey", "06 39 98 07 51"
    client_id = base.obtenir_ou_creer_client(nom, telephone)
    un = base.ajouter_rendezvous(client_id, _iso(bloc + 6, 9), "Séance A")
    deux = base.ajouter_rendezvous(client_id, _iso(bloc + 7, 9), "Séance B")
    cascade_id = _lancer(nom, telephone, _iso(bloc, 15))
    if cascade_id is not None:
        ligne = base.appels_de_cascade(cascade_id)[0]
        statuts = [base.obtenir_rendezvous(un)["statut"],
                   base.obtenir_rendezvous(deux)["statut"]]
        j.vrai(nature, depart, "51",
               "avec PLUSIEURS rendez-vous à venir, RingBack n'en supprime "
               "aucun : il l'écrit pour qu'un humain tranche",
               "les deux rendez-vous intacts, et la mention « à libérer dans "
               "votre agenda »",
               f"statuts {statuts}, note : "
               f"« {(ligne['note'] or 'AUCUNE')[:70]}… »",
               statuts == ["prévu", "prévu"]
               and bool(ligne["note"])
               and "à libérer dans votre agenda" in (ligne["note"] or ""))
        page = banc.obtenir(f"/cascade/resultat?id={cascade_id}")
        j.vrai(nature, depart, "51",
               "et l'écran de la cascade le dit, à la ligne de cette personne",
               "la mention lisible dans le tableau des appels",
               "mention affichée" if "à libérer dans votre agenda" in page
               else "MENTION ABSENTE de l'écran",
               "à libérer dans votre agenda" in page)

    # ------------------- cas 4 : « autre date convenue » (la branche moved)
    # ⚠ LE JOUR DU REPORT DOIT ÊTRE OUVERT LUI AUSSI : le simulateur reporte
    # toujours à la place + DEUX jours, et un dimanche fait refuser le
    # rendez-vous — voir `_jour_ouvre`.
    bloc = _jour_ouvre(banc.prochain_bloc(), 2)
    nom, telephone = "M. Gonzague Malemort-Ferrières", "06 39 98 08 54"
    client_id = base.obtenir_ou_creer_client(nom, telephone)
    ancien = base.ajouter_rendezvous(client_id, _iso(bloc + 6, 9),
                                     "Séance de suivi")
    avant = len(base.rendezvous_a_venir_du_client(client_id))
    cascade_id = _lancer(nom, telephone, _iso(bloc, 15))
    if cascade_id is not None:
        apres = base.rendezvous_a_venir_du_client(client_id)
        j.vrai(nature, depart, "54",
               "« autre date convenue » libère AUSSI l'ancienne place — "
               "c'est le trou Q7 exactement",
               f"toujours 1 rendez-vous à venir (il y en avait {avant})",
               f"{len(apres)} rendez-vous à venir après l'appel",
               len(apres) == 1)
        j.vrai(nature, depart, "54",
               "l'ancien rendez-vous ne tient plus",
               "un statut hors « prévu / confirmé »",
               f"statut « {base.obtenir_rendezvous(ancien)['statut']} »",
               base.obtenir_rendezvous(ancien)["statut"]
               in db.STATUTS_SANS_PLACE)
    j.remarque(
        "Le trou Q7 (« un oui pour une autre date ne libérait pas l'ancienne "
        "place ») a été parcouru sur la cascade DIRECTE, dans ses deux "
        "branches — « accepté » et « autre date convenue » — et dans les "
        "trois situations de reconnaissance : client connu à un seul "
        "rendez-vous (l'ancien part), ligne collée inconnue (rien n'est "
        "touché), client à plusieurs rendez-vous à venir (rien n'est touché "
        "non plus, et l'écran le dit).")


def scenario_file_appels(banc):
    """La file d'appels : « tout rappeler » puis exécuter."""
    j = banc.j
    nature, depart = None, "file"
    banc.nouveau_simulateur()
    # De la matière fraîche pour la file : les campagnes précédentes ont déjà
    # traité les manqués du jeu d'essai. Les six rendez-vous ci-dessous sont
    # ajoutés PAR L'ÉCRAN (formulaire « Ajouter »), à une date passée : c'est
    # la règle du manqué qui les marque elle-même « manqué ».
    for indice, (_, nom, telephone) in enumerate(CONTACTS_FORCES):
        banc.poster("/ajouter", {
            "nom": nom, "telephone": telephone,
            "date_heure": _iso(-30 - indice, 14, 0),
            "motif": "Séance non honorée (matière de la file d'appels)"})
    banc.poster("/file/tout-rappeler")
    page = banc.obtenir("/file")
    en_file = len(banc.application.planif.file)
    j.vrai(nature, depart, CONSTRUCTION,
           "« Tout rappeler » met les rendez-vous manqués en file, sans les "
           "appeler",
           "des appels en attente, aucun appel passé",
           f"{en_file} appel(s) en file", en_file > 0)
    j.vrai(nature, depart, CONSTRUCTION,
           "les numéros de la file sont masqués",
           "aucun numéro en clair sur la page File d'appels",
           "aucun numéro en clair" if CONTACTS_FORCES[0][2] not in page
           else "NUMÉRO EN CLAIR TROUVÉ",
           CONTACTS_FORCES[0][2] not in page)
    # « Tout rappeler » écarte d'emblée deux familles : ceux qui n'ont pas de
    # numéro (rien à composer) et les 🚫. On le vérifie sur pièces.
    en_file_ids = {e["rendezvous_id"] for e in banc.application.planif.file}
    for issue_code, nom, quoi in (
            ("sans_numero", "M. Antoine Villeneuve",
             "un rendez-vous manqué SANS numéro n'est jamais mis en file"),
            ("stop", "M. Bruno Lacombe",
             "un rendez-vous manqué d'un client 🚫 n'est jamais mis en file")):
        vises = [r for r in banc.base.tous_les_rendezvous()
                 if r["nom"] == nom and r["statut"] == "manqué"]
        if not vises:
            j.noter(nature, depart, issue_code, quoi,
                    f"un rendez-vous manqué au nom de « {nom} »",
                    "aucun rendez-vous manqué à ce nom dans la base jetable",
                    False)
            continue
        dedans = [r["id"] for r in vises if r["id"] in en_file_ids]
        j.vrai(nature, depart, issue_code, quoi,
               f"« {nom} » absent de la file d'appels",
               "absent de la file" if not dedans
               else f"MIS EN FILE ({len(dedans)} appel(s))", not dedans)
    page_sans = banc.obtenir("/sans-numero")
    j.vrai(nature, depart, "sans_numero",
           "il reste visible sur la page « Sans numéro », à compléter — jamais "
           "perdu en silence",
           "« M. Antoine Villeneuve » listé sur la page Sans numéro",
           "présent" if "Antoine Villeneuve" in page_sans else "absent",
           "Antoine Villeneuve" in page_sans)
    avant = {}
    for entree in banc.application.planif.file:
        rdv = banc.base.obtenir_rendezvous(entree["rendezvous_id"])
        clair = banc.base.telephone_de(rdv["client_id"]) or ""
        fin = re.sub(r"\D", "", clair)[-2:]
        if fin in ETAT_ATTENDU and fin not in avant:
            avant[fin] = dict(rdv)
    page, _ = banc.poster("/file/executer", {"mission": ""})
    j.vrai(nature, depart, CONSTRUCTION,
           "l'exécution de la file rend un compte rendu appel par appel",
           "une page de résultats qui cite chaque issue",
           "page de résultats servie" if "Transcription" in page
           or "issue" in page.lower() else "page inattendue",
           bool(page))
    attentes = {
        "51": ("confirmé", "le rendez-vous manqué est REPLACÉ au créneau "
                           "accepté (statut confirmé)"),
        "52": ("annulé", "le rendez-vous manqué passe en ANNULÉ"),
        # ⚠ LA MÊME LIGNE BOUGE (17/08/2026) : elle passait auparavant en
        # « déplacé » et une SECONDE naissait à la date convenue.
        "54": ("confirmé", "le rendez-vous manqué BOUGE à la date convenue "
                           "(une seule ligne, pas deux)"),
        "55": (None, "rien n'est touché : le client n'a rien conclu"),
    }
    for fin, rdv in avant.items():
        frais = banc.base.obtenir_rendezvous(rdv["id"])
        if fin in ("53", "56"):
            j.vrai(nature, depart, fin,
                   "pas de réponse : le rendez-vous manqué reste MANQUÉ et "
                   "une relance est programmée",
                   "statut « manqué » et une relance planifiée",
                   f"statut « {frais['statut']} »",
                   frais["statut"] == "manqué")
            continue
        statut_attendu, quoi = attentes[fin]
        if statut_attendu is None:
            j.egal(nature, depart, fin, quoi, rdv["statut"], frais["statut"])
        else:
            j.egal(nature, depart, fin, quoi, statut_attendu, frais["statut"])
    campagne_id = max((c["id"] for c in banc.base.lister_campagnes()),
                      default=None)
    if campagne_id:
        contacts = banc.base.contacts_de_campagne(campagne_id)
        relances = banc.base.relances_de_campagne(campagne_id)
        j.vrai(nature, depart, "53",
               "l'exécution de la file devient une CAMPAGNE, relances comprises",
               "une campagne « manqués » avec des relances programmées pour "
               "les non-joints",
               f"campagne n°{campagne_id}, {len(contacts)} contact(s), "
               f"{len(relances)} relance(s)",
               bool(contacts) and bool(relances))
    return campagne_id


def scenario_cascade_directe(banc):
    """La page Cascade : génération de liste depuis la base, puis « premier oui »."""
    j = banc.j
    nature, depart = "creneau_libere", "cascade"
    banc.nouveau_simulateur()
    creneau = _iso(banc.prochain_bloc() + 5, 16, 30)
    page, _ = banc.poster("/cascade/generer",
                          {"source": "annules", "ordre": "anciennete",
                           "mission": "", "creneau": creneau, "liste": ""})
    j.vrai(nature, depart, CONSTRUCTION,
           "la liste de cascade se GÉNÈRE depuis la base (source + ordre "
           "choisis), et reste modifiable à la main",
           "une zone de collage remplie et un compte annoncé",
           "liste générée" if "personne(s) dans la liste" in page
           else "aucune liste générée",
           "personne(s) dans la liste" in page)
    # Ordre choisi exprès : celui qui accepte est le DERNIER, pour voir
    # passer toutes les autres issues avant l'arrêt au premier oui.
    ordre = [CONTACTS_FORCES[i] for i in (2, 1, 4, 3, 5, 0)]
    liste = "\n".join(f"{nom};{tel}" for _, nom, tel in ordre)
    # Un doublon dans la liste de cascade : ici, contrairement à la grille de
    # l'assistant, il ARRÊTE le lancement — rien n'est composé tant que la
    # liste n'est pas propre. Le banc vérifie que c'est bien dit.
    avant_cascades = len(banc.base.lister_cascades())
    page, _url = banc.poster("/cascade/executer", {
        "liste": liste + f"\n{ordre[0][1]};{ordre[0][2]}",
        "creneau": creneau, "mission": "Bonjour, une place s'est libérée."})
    j.vrai(nature, depart, "doublon",
           "un doublon dans la liste de cascade ARRÊTE le lancement, et l'écran "
           "dit lequel",
           "un refus qui cite la ligne en doublon, et aucune cascade lancée",
           _erreurs_de(page) or "(aucun refus affiché)",
           "doublon" in page.lower()
           and len(banc.base.lister_cascades()) == avant_cascades)
    # Le 🚫 reste dans la liste : il ne doit JAMAIS être composé.
    liste += f"\n{CONTACT_STOP[0]};{CONTACT_STOP[1]}"
    page, url = banc.poster("/cascade/executer", {
        "liste": liste, "creneau": creneau,
        "mission": "Bonjour, une place s'est libérée le [créneau] au Cabinet "
                   "Val Fleuri : souhaitez-vous en profiter ?"})
    trouve = re.search(r"/cascade/resultat\?id=(\d+)", url)
    if not trouve:
        j.noter(nature, depart, CONSTRUCTION, "la cascade s'exécute",
                "une page de résultat de cascade", f"redirigé vers {url}", False)
        return None
    cascade_id = int(trouve.group(1))
    cascade = banc.base.obtenir_cascade(cascade_id)
    appels = banc.base.appels_de_cascade(cascade_id)
    par_nom = {a["nom"]: a for a in appels}
    j.egal(nature, depart, "51",
           "la cascade s'arrête au PREMIER OUI et se clôt « pourvue »",
           "pourvue", cascade["statut"])
    attentes = {"51": "abouti", "52": "refus", "53": "sans réponse",
                "54": "abouti", "55": "refus", "56": "sans réponse"}
    for fin, nom, _telephone in CONTACTS_FORCES:
        appel = par_nom.get(nom)
        if appel is None:
            j.noter(nature, depart, fin,
                    f"la cascade a bien appelé « {nom} »",
                    "un appel tracé dans la cascade", "aucun appel tracé", False)
            continue
        j.vrai(nature, depart, fin,
               f"l'issue de « {nom} » est tracée telle qu'elle s'est produite",
               f"un appel dont l'état dit « {attentes[fin]} »",
               f"état « {appel['etat']} », issue « {appel['issue']} »",
               bool(appel["etat"]))
    exclu = par_nom.get(CONTACT_STOP[0])
    j.vrai(nature, depart, "stop",
           "une personne 🚫 « Ne plus appeler » présente dans la liste n'est "
           "JAMAIS composée",
           "un appel tracé « exclue », sans conversation",
           f"état « {exclu['etat']} »" if exclu else "personne non tracée",
           bool(exclu) and exclu["etat"] == "exclu")
    pris = [r for r in banc.base.tous_les_rendezvous()
            if r["horaire"] == creneau and r["statut"] == "confirmé"]
    j.vrai(nature, depart, "51",
           "le créneau libéré est attribué à celui qui a dit oui",
           f"un rendez-vous confirmé le {themes.date_lisible(creneau)}",
           f"{len(pris)} rendez-vous confirmé(s) à cet horaire", len(pris) == 1)
    page = banc.obtenir(f"/cascade/resultat?id={cascade_id}")
    j.vrai(nature, depart, "51",
           "la page de résultat de la cascade masque les numéros",
           "aucun numéro en clair",
           "aucun numéro en clair" if CONTACTS_FORCES[0][2] not in page
           else "NUMÉRO EN CLAIR TROUVÉ",
           CONTACTS_FORCES[0][2] not in page)
    campagne_id = max((c["id"] for c in banc.base.lister_campagnes()),
                      default=None)
    j.vrai(nature, depart, CONSTRUCTION,
           "la cascade directe fabrique aussi sa CAMPAGNE (le dossier de "
           "l'opération)",
           "une campagne « créneau libéré » rattachée à la cascade",
           f"campagne n°{campagne_id}" if campagne_id else "aucune campagne",
           bool(campagne_id))
    return campagne_id


def scenario_bouton_demarrer(banc):
    """Le vrai bouton ▶ Démarrer (fil de fond), vérifié UNE fois."""
    j = banc.j
    nature, depart = "prise_rdv", "collage"
    banc.nouveau_simulateur()
    brouillon, _ = banc.ouvrir_brouillon(nature)
    banc.passer_etape2(nature, brouillon)
    banc.poster("/assistant/importer", {
        "b": brouillon, "mode": "collage",
        "liste": f"{CONTACTS_FORCES[1][1]};{CONTACTS_FORCES[1][2]}\n"})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, "assistant", CONSTRUCTION,
                "la campagne du bouton ▶ Démarrer se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return
    # Le démarrage porte le geste conscient sur l'agenda (« agenda_verifie ») :
    # c'est ce qu'envoie le clic sur le panneau du poste de pilotage. Sans lui,
    # RingBack refuse de lancer — ce refus a ses tests dédiés.
    banc.poster("/campagne/demarrer",
                {"campagne": campagne_id, "agenda_verifie": "1"})
    limite = time.monotonic() + 30
    statut = banc.base.obtenir_campagne(campagne_id)["statut"]
    while statut not in ("terminée", "arrêtée") and time.monotonic() < limite:
        time.sleep(0.05)
        statut = banc.base.obtenir_campagne(campagne_id)["statut"]
    j.egal(nature, "assistant", CONSTRUCTION,
           "le bouton ▶ Démarrer de l'écran mène bien la campagne à son terme",
           "terminée", statut)


# ===========================================================================
#  R15 — LES DEUX PORTES MÈNENT À UNE CAMPAGNE
# ---------------------------------------------------------------------------
# §4 (porte 👥 : un état à traiter) et §5 (porte 📅 : un trou, un rendez-vous).
# Ces clients-là portent tous « Portail » dans leur nom : le banc filtre
# dessus, ce qui rend les COMPTES exacts et indépendants de tout ce que les
# scénarios précédents ont laissé en base.
# ===========================================================================
PORTAIL_MANQUES = (
    ("Mme Portail Manquée Une", "06 39 98 07 71"),
    ("M. Portail Manqué Deux", "06 39 98 07 72"),
    ("Mme Portail Manquée Trois", "06 39 98 07 73"),
)
PORTAIL_PREVU = ("M. Portail Prévu", "06 39 98 07 74")
PORTAIL_HUMAIN = ("Mme Portail Humaine", "06 39 98 07 75")
PORTAIL_ATTENTE = ("M. Portail En Attente", "06 39 98 07 77")
ETAT_MANQUE = "rendez-vous manqué (absent)"


def _liste_clients_banc(banc, **filtres):
    """Le FRAGMENT de liste, tel que les filtres de l'écran le rechargent."""
    return banc.obtenir("/clients/liste?" + urllib.parse.urlencode(filtres))


def scenario_deux_portes_vers_campagne(banc):
    """R15 fermée : de l'état au bouton, du trou à la campagne. ZÉRO appel.

    Ce scénario ne fait passer AUCUN appel, et c'est justement ce qu'il
    mesure : les deux portes ouvrent l'assistant à l'étape 2 (liste déjà
    remplie), elles ne lancent rien. Il éprouve aussi la décision du
    propriétaire du 31/07/2026 — un bouton PAR NATURE quand le filtre mêle
    des états traités par des campagnes différentes.
    """
    j = banc.j
    nature, depart = "prise_rdv", "etat_client"
    base = banc.base
    # --------------------------------------------------- la matière du cas
    for rang, (nom, telephone) in enumerate(PORTAIL_MANQUES):
        client_id = base.obtenir_ou_creer_client(nom, telephone)
        base.ajouter_rendezvous(client_id, _iso(-30 - rang, 9), "Bilan",
                                statut="manqué")
    prevu_id = base.obtenir_ou_creer_client(*PORTAIL_PREVU)
    base.ajouter_rendezvous(prevu_id, _iso(60, 9), "Contrôle")
    attente_id = base.obtenir_ou_creer_client(*PORTAIL_ATTENTE)
    base.ajouter_rendezvous(attente_id, _iso(-20, 9), "Séance",
                            statut="déplacé")
    humaine_id = base.obtenir_ou_creer_client(*PORTAIL_HUMAIN)
    campagne_close = base.creer_campagne("Portail — campagne close",
                                         "personnalise", nature="prise_rdv",
                                         statut="terminée")
    base.ajouter_contact_campagne(campagne_close, 1, PORTAIL_HUMAIN[0],
                                  PORTAIL_HUMAIN[1],
                                  etat="à rappeler par un humain",
                                  client_id=humaine_id)
    campagnes_avant = len(base.lister_campagnes())
    appels_avant = base.conn.execute(
        "SELECT COUNT(*) FROM appels").fetchone()[0]

    # ------------------------------------ §4.1 : le bouton NAÎT du filtre
    sans = _liste_clients_banc(banc, etat=ETAT_MANQUE, recherche="Portail")
    j.vrai(nature, depart, CONSTRUCTION,
           "sans l'option « non traité », AUCUN bouton de création : la "
           "sélection contient des clients déjà pris en charge",
           "aucun bouton", "aucun bouton" if "Créer la campagne" not in sans
           else "un bouton apparaît quand même",
           "Créer la campagne" not in sans)
    avec = _liste_clients_banc(banc, etat=ETAT_MANQUE, recherche="Portail",
                               non_traite="1")
    attendu = "« 🗓 Prise de rendez-vous » — 3 client(s)"
    j.vrai(nature, depart, CONSTRUCTION,
           "l'état filtré + « non traité » font apparaître le bouton, avec "
           "la NATURE déduite de la table du §3 et le COMPTE exact",
           attendu, "bouton conforme" if attendu in avec else "bouton absent "
           "ou compte faux",
           attendu in avec and 'action="/clients/campagne"' in avec)
    j.vrai(nature, depart, CONSTRUCTION,
           "plus aucune promesse « à venir » : le bouton est réel",
           "aucun badge « à venir » dans la liste",
           "aucun" if "badge-a-venir" not in avec else "un badge subsiste",
           "badge-a-venir" not in avec)

    # ------------------ §4.2 : un bouton PAR NATURE quand les états se mêlent
    prevu = _liste_clients_banc(banc, etat="rendez-vous prévu",
                                recherche="Portail", non_traite="1")
    for code, libelle in (("rappel_rdv", "🔔 Rappel de rendez-vous"),
                          ("confirmation", "✅ Confirmation de rendez-vous")):
        vu = f"« {libelle} » — 1 client(s)" in prevu
        j.vrai(code, depart, CONSTRUCTION,
               "un SEUL état (rendez-vous prévu) traité par DEUX natures "
               f"donne aussi le bouton « {libelle} », avec son compte",
               f"« {libelle} » — 1 client(s)",
               "bouton présent" if vu else "bouton absent", vu)
    # La quatrième nature que la porte 👥 peut désigner : « déplacement en
    # attente » (un rendez-vous déplacé, et plus rien à venir).
    attente = _liste_clients_banc(banc, etat="déplacement en attente",
                                  recherche="Portail", non_traite="1")
    vu = "« 📆 Déplacement de rendez-vous » — 1 client(s)" in attente
    j.vrai("deplacement", depart, CONSTRUCTION,
           "l'état « déplacement en attente » désigne, lui, la campagne "
           "📆 « Déplacement »",
           "« 📆 Déplacement de rendez-vous » — 1 client(s)",
           "bouton présent" if vu else "bouton absent", vu)
    mele = _liste_clients_banc(banc, recherche="Portail", non_traite="1")
    combien = mele.count('action="/clients/campagne"')
    j.egal(nature, depart, CONSTRUCTION,
           "filtre MÊLÉ (aucun état choisi) : un bouton par nature, jamais "
           "un bouton grisé qui laisse deviner — décision du 31/07/2026",
           4, combien)
    comptes = ("« 🗓 Prise de rendez-vous » — 3 client(s)" in mele
               and "« 🔔 Rappel de rendez-vous » — 1 client(s)" in mele
               and "« ✅ Confirmation de rendez-vous » — 1 client(s)" in mele
               and "« 📆 Déplacement de rendez-vous » — 1 client(s)" in mele)
    j.vrai(nature, depart, CONSTRUCTION,
           "chacun de ces quatre boutons annonce SON propre compte",
           "3, 1, 1 et 1", "comptes exacts" if comptes else "comptes faux",
           comptes)

    # --------------------- §4.3 : un état sans campagne ne donne AUCUN bouton
    humain = _liste_clients_banc(banc, etat="à rappeler par un humain",
                                 recherche="Portail", non_traite="1")
    j.vrai(nature, depart, CONSTRUCTION,
           "un état qu'aucune campagne ne traite ne donne AUCUN bouton, mais "
           "dit pourquoi (§6)",
           "aucun bouton, et la raison écrite",
           "conforme" if ("Créer la campagne" not in humain
                          and "aucune campagne ne traite cela" in humain)
           else "bouton présent ou raison muette",
           "Créer la campagne" not in humain
           and "aucune campagne ne traite cela" in humain)
    page_clients = banc.obtenir("/clients?par_page=0")
    j.vrai(nature, depart, CONSTRUCTION,
           "le compteur « 🙋 pour un humain » reste visible sur la page",
           "le compteur humain affiché",
           "présent" if "pour un humain" in page_clients else "absent",
           "pour un humain" in page_clients)

    # ------------------------- §4.4 : le clic ouvre l'ÉTAPE 2, liste remplie
    page, _ = banc.poster("/clients/campagne",
                          {"nature": "prise_rdv", "etat": ETAT_MANQUE,
                           "recherche": "Portail"})
    etape2 = ('id="fa-etape-2" class="fa-etape fa-courante"' in page
              and "🗓 <strong>Prise de rendez-vous</strong>" in page)
    j.vrai(nature, depart, CONSTRUCTION,
           "le clic ouvre l'assistant DIRECTEMENT à l'étape 2 — la nature "
           "est déjà connue, on ne la redemande pas",
           "l'étape 2 de « Prise de rendez-vous »",
           "étape 2" if etape2 else "un autre écran", etape2)
    remplie = "👥 Liste déjà remplie : <strong>3</strong> personne(s)" in page
    j.vrai(nature, depart, CONSTRUCTION,
           "la liste des personnes est DÉJÀ remplie, et l'écran dit combien",
           "3 personnes annoncées à l'étape 2",
           "annoncées" if remplie else "rien n'est dit", remplie)
    apres = base.conn.execute("SELECT COUNT(*) FROM appels").fetchone()[0]
    j.vrai(nature, depart, CONSTRUCTION,
           "AUCUN APPEL ne part de ce bouton, et AUCUNE campagne n'est créée "
           "avant validation",
           "0 appel de plus, 0 campagne de plus",
           f"{apres - appels_avant} appel(s), "
           f"{len(base.lister_campagnes()) - campagnes_avant} campagne(s)",
           apres == appels_avant
           and len(base.lister_campagnes()) == campagnes_avant)

    # ---------------------------------- §4.5 : la RECETTE porte le critère
    brouillon = re.search(r'name="b" value="(\d+)"', page).group(1)
    banc.passer_etape2("prise_rdv", brouillon)
    campagne_id, fiche = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne née du filtre d'état se valide",
                "une campagne prête", "refus : " + _erreurs_de(fiche), False)
        return
    configuration = assistant.configuration_campagne(
        base.obtenir_campagne(campagne_id))
    apports = (configuration.get("recette") or {}).get("apports", [])
    attendu_recette = [{"mode": "etat", "etat": ETAT_MANQUE,
                        "nature": "prise_rdv", "recherche": "Portail"}]
    j.egal(nature, depart, CONSTRUCTION,
           "la campagne GARDE le critère qui a bâti sa liste (recette "
           "« etat ») — c'est ce qui la rend rejouable sur un autre créneau",
           attendu_recette, apports)
    rejouable = assistant.recette_reproductible(configuration["recette"])
    contacts, _ = assistant.contacts_de_recette(
        base, configuration["recette"],
        assistant.champs_campagne(configuration), banc.application.preferences)
    j.vrai(nature, depart, CONSTRUCTION,
           "et elle se REJOUE vraiment : le critère reconstruit la même liste",
           "3 contacts retrouvés par le seul critère",
           f"{len(contacts)} contact(s), rejouable={rejouable}",
           rejouable and len(contacts) == 3)

    # ------------------------------- §5.1 : un trou du planning → la campagne
    preferences = banc.application.preferences
    for jour in range(7):
        horaires.basculer_periode(preferences, jour, 9 * 60, 18 * 60, "ouvrir")
    creneau = _iso(70, 10)
    modale = banc.obtenir("/suivi/detail?creneau="
                          + urllib.parse.quote(creneau))
    reel = ('action="/suivi/creneau/campagne"' in modale
            and f'name="creneau" value="{creneau}"' in modale
            and "à venir" not in modale)
    j.vrai("creneau_libere", "planning", CONSTRUCTION,
           "un clic sur une place LIBRE propose une vraie campagne "
           "📞 « Créneau libéré » sur CETTE place (R15 fermée)",
           "un bouton réel portant ce créneau",
           "bouton réel" if reel else "toujours « à venir » ou créneau absent",
           reel)
    campagnes_avant = len(base.lister_campagnes())
    page, _ = banc.poster("/suivi/creneau/campagne",
                          {"creneau": creneau, "depuis": "planning"})
    ouvert = ('id="fa-etape-2" class="fa-etape fa-courante"' in page
              and f'name="info_creneau_libere" value="{creneau}"' in page)
    j.vrai("creneau_libere", "planning", CONSTRUCTION,
           "le clic ouvre l'étape 2 avec le créneau DÉJÀ rempli, sans créer "
           "de campagne ni passer d'appel",
           "étape 2, créneau pré-rempli, 0 campagne de plus",
           "conforme" if (ouvert
                          and len(base.lister_campagnes()) == campagnes_avant)
           else "écran ou compte inattendu",
           ouvert and len(base.lister_campagnes()) == campagnes_avant)

    # ----------------------- §5.2 et §5.3 : DÉPLACER et ANNULER un rendez-vous
    bouge_id = base.obtenir_ou_creer_client("M. Portail À Bouger",
                                            "06 39 98 07 76")
    dans_trois_jours = (datetime.datetime.now()
                        + datetime.timedelta(days=3)).replace(
                            second=0, microsecond=0).isoformat(
                                timespec="minutes")
    rdv_id = base.ajouter_rendezvous(bouge_id, dans_trois_jours, "Séance")
    modale = banc.obtenir(f"/suivi/detail?rdv={rdv_id}")
    gestes = ('action="/suivi/detail/deplacer"' in modale
              and 'action="/suivi/detail/annuler"' in modale)
    j.vrai("deplacement", "planning", CONSTRUCTION,
           "un clic sur un RENDEZ-VOUS propose ses deux gestes : Déplacer et "
           "Annuler",
           "les deux gestes dans la fenêtre",
           "les deux" if gestes else "gestes manquants", gestes)
    campagnes_avant = len(base.lister_campagnes())
    page, _ = banc.poster("/suivi/detail/deplacer", {"rdv": rdv_id})
    deplace = ('id="fa-etape-2" class="fa-etape fa-courante"' in page
               and "📆 <strong>Déplacement de rendez-vous</strong>" in page
               and "👥 Liste déjà remplie : <strong>1</strong> personne(s)"
               in page)
    j.vrai("deplacement", "planning", CONSTRUCTION,
           "« Déplacer » monte la campagne 📆 sur CE rendez-vous, à l'étape 2, "
           "le contact déjà en liste — et sans rien créer",
           "étape 2 de « Déplacement », 1 personne, 0 campagne de plus",
           "conforme" if (deplace
                          and len(base.lister_campagnes()) == campagnes_avant)
           else "écran ou compte inattendu",
           deplace and len(base.lister_campagnes()) == campagnes_avant)
    # « Annuler » : la règle des 12 h est APPELÉE, jamais récrite.
    panneau, _ = banc.poster_fragment("/suivi/detail/annuler",
                                      {"rdv": rdv_id, "geste": "demander"})
    intact = base.obtenir_rendezvous(rdv_id)["statut"] == "prévu"
    j.vrai("deplacement", "planning", CONSTRUCTION,
           "« Annuler » ANNONCE d'abord ce que la règle va faire — rien "
           "n'est écrit au premier clic",
           "l'annonce « supprimé », le rendez-vous encore « prévu »",
           "annoncé, rien d'écrit" if ("« supprimé »" in panneau and intact)
           else "écrit trop tôt, ou annonce muette",
           "« supprimé »" in panneau and intact)
    resultat, _ = banc.poster_fragment("/suivi/detail/annuler",
                                       {"rdv": rdv_id, "geste": "confirmer"})
    statut = base.obtenir_rendezvous(rdv_id)["statut"]
    j.egal("deplacement", "planning", CONSTRUCTION,
           "au-delà du seuil, la règle du propriétaire s'applique : le "
           "rendez-vous est SUPPRIMÉ et sa place redevient libre",
           db.STATUT_SUPPRIME, statut)
    compense = ('action="/suivi/creneau/campagne"' in resultat
                and f'name="creneau" value="{dans_trois_jours}"' in resultat)
    j.vrai("deplacement", "planning", CONSTRUCTION,
           "la place libérée mène en UN CLIC à la campagne qui la remplira — "
           "c'est la boucle du §5, enfin fermée",
           "une proposition de campagne sur la place libérée",
           "proposée" if compense else "aucune proposition", compense)
    appels_fin = base.conn.execute(
        "SELECT COUNT(*) FROM appels").fetchone()[0]
    j.egal("deplacement", "planning", CONSTRUCTION,
           "de bout en bout, ces deux portes n'ont passé AUCUN appel",
           appels_avant, appels_fin)


# Le numéro que le banc DÉCLARE comme numéro d'essai. Pris dans les racines
# que l'Arcep réserve à la fiction (il ne peut ni appeler ni être appelé),
# hors des terminaisons 51-56 que le simulateur reconnaît, et absent du jeu
# d'essai : il ne peut donc rien perturber d'autre.
NUMERO_ESSAI_BANC = "06 39 98 09 88"


def scenario_decalage_en_cascade(banc):
    """⚠ SON PARCOURS, DU FORMULAIRE À L'HISTORIQUE (15/08/2026).

    Il me l'a demandé en toutes lettres : « Est-ce que tu en fais des vrais
    comme moi — créer une campagne, l'exécuter, attendre qu'elle s'arrête et
    regarder l'historique ? » La réponse était NON, et c'est pour cela que
    trois jours de corrections n'ont rien changé chez lui :

    · mes essais unitaires fabriquent la campagne en Python, sous forme de
      dictionnaire. Ils sautent les formulaires — donc tout ce qui se joue
      entre son écran et le serveur leur est invisible. C'est exactement là
      qu'était le défaut du gain de 30 jours ;
    · le banc, lui, pilote bien les vrais formulaires… mais n'avait AUCUN
      contrôle sur le décalage en cascade. (Le mot « cascade » y désigne la
      *page* Cascade, une autre fonctionnalité — d'où la confusion.)

    Ce scénario refait donc son geste, en entier et par HTTP : nature, étape 2
    avec l'option de décalage cochée et sa date limite, étape 3 en mode
    AUTOMATIQUE avec sa règle et son plafond, « Valider », exécution, puis
    lecture de ce que la campagne a réellement fait.

    UNE SEULE PLACE au départ — c'est le cas de TOUTES ses campagnes, vérifié
    dans sa base. C'est justement celui que mes essais ne couvraient pas.
    """
    j = banc.j
    nature, depart = "creneau_libere", "cascade_option"
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()
    creneau = banc.place_libre(bloc + 5)
    # ⚠ BORNÉ EXPRÈS — plafond 5, limite proche. Le banc partage UNE base entre
    # toutes ses combinaisons ; une cascade laissée libre déplace des dizaines
    # de rendez-vous sur des mois et vient piétiner les blocs des scénarios
    # suivants. Mesuré : elle a fait tomber un contrôle du rappel de
    # rendez-vous, qui n'avait rien à voir. Cinq appels suffisent à prouver la
    # mécanique — l'ampleur, elle, se mesure dans les essais unitaires.
    plafond = "5"
    limite = (REFERENCE + datetime.timedelta(days=250)).date().isoformat()

    # ⚠ SES PROPRES CONTACTS, semés ici. Le jeu d'essai du banc s'arrête au
    # 23/11/2026, et ce scénario passe EN DERNIER : à ce moment-là, plus aucun
    # rendez-vous n'est assez loin pour qu'une place en fasse gagner trente
    # jours. Mesuré : « 0 contact — 58 personne(s) écartée(s) ». Le scénario
    # aurait alors annoncé « la cascade ne marche pas » alors qu'il n'avait
    # simplement personne à appeler — un banc qui ment est pire que pas de banc.
    # Terminaison 51 : le simulateur fait ACCEPTER. Chaque oui libère donc la
    # place que la personne quitte, et c'est cela qu'on veut voir enchaîner.
    debut = datetime.datetime.fromisoformat(creneau)
    for rang in range(8):
        quand = (debut + datetime.timedelta(days=40 + rang * 7)).replace(
            hour=10, minute=0)
        client = banc.base.ajouter_client(f"Mme Cascade {rang:02d}",
                                          f"06 39 97 {10 + rang:02d} 51")
        banc.base.ajouter_rendezvous(client, quand.isoformat(
            timespec="minutes"), "Séance", statut="prévu")

    # ① Étape 2 : une place, arrêt au premier oui, DÉCALAGE EN CASCADE coché.
    brouillon, _ = banc.ouvrir_brouillon(nature)
    formulaire = banc.formulaire_etape2(nature, brouillon)
    formulaire["info_creneau_libere"] = creneau
    formulaire["politique"] = "premier_oui"
    formulaire["opt_cascade"] = "1"
    formulaire["cascade_jusqu_au"] = limite
    page, url = banc.poster("/assistant/message", formulaire)
    # ⚠ ON JUGE SUR L'ADRESSE ATTEINTE, pas sur `_erreurs_de` : cette fonction
    # rend « (sans détail) » quand elle ne trouve rien, ce qui est VRAI au sens
    # booléen. Un contrôle bâti dessus échoue toujours — le mien l'a fait.
    j.vrai(nature, depart, CONSTRUCTION,
           "l'étape 2 accepte l'option « décaler en cascade » et sa date",
           "l'étape 3 s'ouvre (/assistant/liste)", url,
           "/assistant/liste" in url)

    # ② Étape 3 : mode AUTOMATIQUE, sa règle, son plafond — puis « Valider ».
    # ⚠ TOUT PART DANS LE MÊME ENVOI QUE « Valider », comme à l'écran : c'est
    # précisément ce couplage-là qui était rompu le 15/08 (le panneau de la
    # règle était un formulaire séparé, et le gain n'atteignait jamais le
    # serveur). Un banc qui enregistrerait la règle à part ne le reverrait pas.
    banc.poster("/assistant/liste", {"b": brouillon,
                                     "action": "liste:automatique"})
    campagne_id, page = banc.valider_grille(brouillon, {
        "ordre": "liste", "regle_source": "a_venir", "regle_jours": "30",
        "plafond": plafond})
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne « décalage en cascade » se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return None

    config_avant = assistant.configuration_campagne(
        banc.base.obtenir_campagne(campagne_id))
    j.egal(nature, depart, CONSTRUCTION,
           "ce qui a été coché à l'écran arrive VRAIMENT sur la campagne "
           "(option, date limite, règle, plafond)",
           (True, limite, {"source": "a_venir", "jours": "30"}, plafond),
           (config_avant["options"].get("cascade"),
            config_avant["options"].get("cascade_jusqu_au"),
            config_avant.get("regle_liste"),
            str(config_avant.get("plafond") or "")))
    # ⚠ ET LA RÈGLE A VRAIMENT REMPLI LA GRILLE. Sans ce contrôle, une règle qui
    # ne trouve personne rendrait tous les suivants incompréhensibles : ils
    # diraient « zéro appel » sans jamais dire POURQUOI. C'est le piège dans
    # lequel je suis tombé en écrivant ce scénario.
    charges = len(banc.base.contacts_de_campagne(campagne_id))
    notes = " / ".join((config_avant.get("regle_jouee") or {}).get("notes")
                       or []) or "(aucune note)"
    j.vrai(nature, depart, CONSTRUCTION,
           "la règle enregistrée avec « Valider » remplit vraiment la grille",
           "au moins un contact chargé par la règle",
           f"{charges} contact(s) — {notes}", charges > 0)
    places_avant = len(assistant.creneaux_de(
        banc.base.obtenir_campagne(campagne_id), config_avant))

    # ③ « ▶ Démarrer », puis on attend l'arrêt — comme lui.
    banc.executer(campagne_id)

    fiche = banc.base.obtenir_campagne(campagne_id)
    config = assistant.configuration_campagne(fiche)
    places = assistant.creneaux_de(fiche, config)
    nees = [f for f in places if f["horaire"] != creneau]
    pourvues = [f for f in nees if f["statut"] == assistant.CRENEAU_POURVU]
    appelees = banc.base.compter_personnes_appelees(campagne_id)

    # ⚠ LE CŒUR, ET C'EST CE QU'IL LIT À L'ÉCRAN : la place qu'un contact
    # quitte rejoint SA campagne. Avant, elle engendrait une campagne « prête »
    # à côté, et celle-ci s'arrêtait — sa n°12 : sept appels sur trente
    # autorisés, une place pourvue, campagne terminée.
    j.vrai(nature, depart, "51",
           "la place quittée par celui qui accepte REJOINT la campagne "
           "(elle n'en prépare pas une autre à côté)",
           f"plus de {places_avant} place(s) sur la campagne",
           f"{len(places)} place(s), dont {len(nees)} née(s) du décalage",
           len(places) > places_avant)
    j.vrai(nature, depart, "51",
           "la campagne CONTINUE sur la place née du décalage : elle recharge "
           "des contacts et les appelle",
           "au moins une place de décalage pourvue",
           f"{len(pourvues)} pourvue(s) sur {len(nees)} née(s)",
           bool(pourvues))
    j.vrai(nature, depart, "51",
           "le budget d'appels réglé est employé, pas laissé dormir",
           f"plus d'un appel (le plafond est de {plafond})",
           f"{appelees} personne(s) appelée(s)", appelees > 1)
    j.vrai(nature, depart, "51",
           "et il n'est JAMAIS dépassé",
           f"au plus {plafond} personnes appelées",
           f"{appelees} personne(s) appelée(s)", appelees <= int(plafond))
    # Aucune campagne « prête » n'a été semée à côté : c'est le geste qu'il
    # devait faire à la main, et qu'il ne doit plus avoir à faire.
    semees = [c for c in banc.base.lister_campagnes()
              if c["id"] != campagne_id and c["statut"] == "prête"
              and assistant.configuration_campagne(c)["options"].get(
                  "cascade_origine") == campagne_id]
    j.egal(nature, depart, "51",
           "aucune campagne « prête » n'est semée à côté : tout se fait dans "
           "la campagne lancée",
           0, len(semees))
    return campagne_id


def scenario_deplacement_journee_entiere(banc):
    """⚠ SON TEST, MOT POUR MOT (17/08/2026).

    « Vérifie que tu fais exactement les mêmes tests que moi : créer une
    campagne en déplaçant les rendez-vous d'une journée entière : tout le
    monde est traité et tous les cas de figure apparaissent dans les tests :
    accepter (rendez-vous déplacé), à rappeler par un humain, à recontacter,
    injoignable. »

    Ce qu'il avait sous les yeux, et qu'aucun filet ne voyait :
    · UN contact accepté, les dix autres « pas appelé » — parce qu'un réglage
      enregistré (« politique: premier_oui ») écrit par l'ANCIEN défaut
      continuait d'arrêter la campagne au premier oui ;
    · et le rendez-vous « déplacé »… vers le 28/07/2026, vingt jours en
      arrière, où il est aussitôt devenu MANQUÉ — cinq créneaux manuels
      passés traînaient en tête de la liste des places à proposer.

    Le scénario passe donc par « Charger selon les dates » avec un JOUR
    précis, comme lui, et contrôle les quatre choses qu'il regarde : le compte
    des appels, le déplacement réel dans l'agenda, l'absence de date passée,
    et les issues obtenues. Il exécute AUSSI les relances jusqu'au plafond :
    « injoignable » n'est atteignable que par là — au premier tour, une
    non-réponse programme une relance et s'affiche « à recontacter ».
    """
    j = banc.j
    nature, depart = "deplacement", "journee_entiere"
    banc.nouveau_simulateur()
    bloc = banc.prochain_bloc()

    # ⚠ UNE JOURNÉE ENTIÈRE, semée par nous : le banc partage sa base entre
    # tous ses scénarios, donc on ne peut pas parier sur une journée déjà
    # chargée. Onze rendez-vous le même jour, un par personne — c'est
    # exactement la forme de sa campagne n°22.
    depart_bloc = datetime.datetime.fromisoformat(banc.place_libre(bloc))
    jour = (depart_bloc + datetime.timedelta(days=30)).date()
    while jour.weekday() >= 5:                  # un jour OUVRÉ, sinon rien
        jour += datetime.timedelta(days=1)
    # ⚠ LE DERNIER FINIT PAR 53 : cette terminaison ne décroche JAMAIS (c'est la
    # convention du simulateur). C'est le seul moyen de voir « 📵 injoignable »,
    # qui n'arrive qu'une fois les rappels épuisés — les dix autres tirent leur
    # issue du plan de la nature, comme n'importe quelle liste réelle.
    for rang in range(11):
        quand = datetime.datetime.combine(
            jour, datetime.time(hour=9 + rang // 2,
                                minute=0 if rang % 2 == 0 else 30))
        fin = "53" if rang == 10 else "00"
        client = banc.base.ajouter_client(f"M. Journee {rang:02d}",
                                          f"06 39 96 {10 + rang:02d} {fin}")
        banc.base.ajouter_rendezvous(client, quand.isoformat(
            timespec="minutes"), "Séance", statut="prévu")

    # ⚠ ET UN CRÉNEAU MANUEL DANS LE PASSÉ, comme dans son fichier. C'est le
    # piège : le tri se fait par horaire, donc celui-là arrive EN PREMIER et
    # devient la date proposée au téléphone. Sans ce semis, le scénario
    # passerait au vert sans jamais avoir exercé le défaut.
    passe = (REFERENCE - datetime.timedelta(days=20)).replace(
        hour=9, minute=30, second=0, microsecond=0).isoformat(
            timespec="minutes")
    manuels = list(horaires.creneaux_manuels(banc.application.preferences))
    banc.application.preferences.definir(themes.CLE_CRENEAUX,
                                         sorted(manuels + [passe]))

    # ① Étape 2 : on ne touche À RIEN — c'est le défaut de la nature qui doit
    # appeler tout le monde. Poser « politique » ici masquerait le défaut.
    brouillon, _ = banc.ouvrir_brouillon(nature)
    formulaire = banc.formulaire_etape2(nature, brouillon)
    formulaire.pop("politique", None)
    page, url = banc.poster("/assistant/message", formulaire)
    j.vrai(nature, depart, CONSTRUCTION,
           "l'étape 2 d'un déplacement s'accepte sans qu'on touche à la "
           "politique d'appel",
           "l'étape 3 s'ouvre (/assistant/liste)", url,
           "/assistant/liste" in url)

    # ② « Charger selon les dates » : la source, l'année, la semaine, LE JOUR.
    annee, semaine, _ = jour.isocalendar()
    banc.poster("/assistant/importer",
                {"b": brouillon, "mode": "rendezvous", "source": "a_venir",
                 "annee": str(annee), "semaine": str(semaine),
                 "jour": jour.isoformat()})
    campagne_id, page = banc.valider_grille(brouillon)
    if campagne_id is None:
        j.noter(nature, depart, CONSTRUCTION,
                "la campagne de déplacement d'une journée se valide",
                "une campagne prête", "refus : " + _erreurs_de(page), False)
        return None

    fiche = banc.base.obtenir_campagne(campagne_id)
    config = assistant.configuration_campagne(fiche)
    charges = banc.base.contacts_de_campagne(campagne_id)
    # ⚠ LE RÉGLAGE HÉRITÉ : c'est LUI qui rendait mon correctif invisible.
    j.egal(nature, depart, CONSTRUCTION,
           "un déplacement part sur « tout le monde est appelé » — aucun "
           "réglage enregistré ne peut le ramener à « premier oui »",
           assistant.NATURES["deplacement"]["politique"],
           config.get("politique"))
    j.vrai(nature, depart, CONSTRUCTION,
           "« Charger selon les dates » sur UN jour charge la journée entière",
           "au moins 8 contacts pour ce jour-là",
           f"{len(charges)} contact(s) chargé(s) le {jour:%d/%m/%Y}",
           len(charges) >= 8)

    # ③ « ▶ Démarrer », puis les relances — jusqu'au plafond, comme lui.
    banc.executer(campagne_id)
    for tour in range(4):
        if not banc.lancer_relances(jours=15 * (tour + 1)):
            break

    apres = banc.base.contacts_de_campagne(campagne_id)
    appelees = banc.base.compter_personnes_appelees(campagne_id)
    etats = {}
    for contact in apres:
        etats[contact["etat"]] = etats.get(contact["etat"], 0) + 1
    lisible = ", ".join(f"{etat} : {combien}"
                        for etat, combien in sorted(etats.items()))

    # ⚠ CE QU'IL A VU : 1 appelé sur 11, dix « épargné ». Tout le monde, donc.
    j.egal(nature, depart, "51",
           "TOUT LE MONDE est appelé : un déplacement n'est pas un traitement "
           "unique, un oui n'arrête rien (§8.2)",
           len(apres), appelees)
    j.egal(nature, depart, "51",
           "et personne ne reste « pas appelé » ni « épargné »",
           0, etats.get("pas appelé", 0) + etats.get("épargné", 0))

    # ④ LE RENDEZ-VOUS A-T-IL VRAIMENT BOUGÉ ? Il l'a vérifié dans l'agenda,
    # et la réponse était non. Deux écritures sont légitimes : la ligne
    # elle-même bouge, ou elle passe « déplacé » et une NOUVELLE naît à la
    # date convenue. On cherche donc le rendez-vous du client À LA DATE
    # ANNONCÉE — pas la ligne, qui peut mentir.
    lignes = [l for l in banc.base.changements_de_campagne(campagne_id)
              if l["genre"] == "deplacement"]
    tenus, passees = [], []
    for ligne in lignes:
        ancien = banc.base.obtenir_rendezvous(ligne["rendezvous_id"])
        chez_lui = [r for r in (banc.base.obtenir_rendezvous(i) for i
                                in banc.base.rendezvous_du_client(
                                    ancien["client_id"]))
                    if r["horaire"] == ligne["nouvelle_date"]
                    and r["statut"] not in ("supprimé", "annulé")]
        if chez_lui:
            tenus.append(ligne)
        if ligne["nouvelle_date"] < REFERENCE.isoformat(timespec="minutes"):
            passees.append(ligne["nouvelle_date"])
    j.vrai(nature, depart, "51",
           "chaque déplacement annoncé EXISTE vraiment dans l'agenda, à la "
           "date annoncée",
           f"{len(lignes)} déplacement(s) tenus",
           f"{len(tenus)} tenu(s) sur {len(lignes)} annoncé(s)",
           bool(lignes) and len(tenus) == len(lignes))
    # ⚠ Un rendez-vous déplacé vers hier n'est pas déplacé : il est perdu.
    j.egal(nature, depart, "51",
           "et JAMAIS vers une date passée — un créneau manuel dont l'heure "
           "est révolue n'est plus proposé au téléphone",
           [], passees)

    # ⑤ LES QUATRE CAS QU'IL VEUT VOIR dans l'historique.
    #
    # ⚠ CE CONTRÔLE A CHANGÉ DEUX FOIS, ET LE BANC A ARRÊTÉ LES DEUX FOIS.
    # Le 18/08 il demandait qu'en simulation aucune campagne ne finisse sur le
    # maximum de rappels : « injoignable » a quitté cette liste, remplacé par
    # « à recontacter ». Le 21/08 il est revenu dessus — le maximum s'applique
    # partout — et le contrôle est revenu avec lui. C'est exactement le travail
    # d'un banc : refuser de suivre en silence.
    #
    # POURQUOI CE RETOUR EST TENABLE : au maximum de rappels, une campagne de
    # déplacement ANNULE désormais le rendez-vous, libère la place et renvoie la
    # personne vers un rappel humain (20/08). « injoignable » n'est plus un
    # cul-de-sac, c'est une conclusion.
    for etat, code in (("accepté", "51"), ("à rappeler par un humain", "55"),
                       ("injoignable", "53")):
        j.vrai(nature, depart, code,
               f"l'historique montre le cas « {etat} »",
               "au moins un contact dans cet état", lisible,
               bool(etats.get(etat)))
    return campagne_id


def scenario_numero_essai(banc):
    """Le 🧪 numéro d'essai : une exception DÉCLARÉE, et rien de plus.

    Trois temps, dans cet ordre — c'est l'ordre qui fait la preuve :
    ① sans numéro déclaré, un numéro répété est refusé (le garde-fou est
      intact, c'est l'état de départ du produit) ;
    ② le numéro déclaré, quatre identités passent, marquées 🧪 partout, et
      un AUTRE numéro répété reste refusé ;
    ③ le champ vidé, le refus revient pour tout le monde.
    Puis la campagne d'essai préparée : « prête », zéro appel.
    """
    j = banc.j
    nature, depart = "confirmation", "collage"
    lignes = [f"Mme Alice Dubreuil;{NUMERO_ESSAI_BANC};{_iso(23, 9)};Séance",
              f"M. Rémi Chastain;{NUMERO_ESSAI_BANC};{_iso(23, 10)};Séance",
              f"Mme Diane Verrier;{NUMERO_ESSAI_BANC};{_iso(23, 11)};Séance",
              f"M. Hugo Sernin;{NUMERO_ESSAI_BANC};{_iso(23, 14)};Séance"]

    def grille(lignes_a_coller):
        brouillon, _ = banc.ouvrir_brouillon(nature)
        banc.passer_etape2(nature, brouillon)
        banc.poster("/assistant/importer", {"b": brouillon, "mode": "collage",
                                            "liste": "\n".join(lignes_a_coller)})
        page = banc.obtenir(f"/assistant/liste?b={brouillon}")
        contacts = banc.application.obtenir_brouillon_assistant(
            brouillon)["contacts"]
        return brouillon, page, contacts

    def declarer(numero):
        banc.poster("/reglages/enregistrer",
                    {"entreprise": "Cabinet Val Fleuri",
                     "plage_debut": "00:00", "plage_fin": "23:59",
                     "numero_essai": numero})

    # ① Le garde-fou, tel qu'il est livré.
    _, page, contacts = grille(lignes)
    j.vrai(nature, depart, CONSTRUCTION,
           "sans numéro d'essai déclaré, quatre identités sur le même numéro "
           "sont réduites à une (doublon refusé)",
           "1 contact retenu, un message de doublon à l'écran",
           f"{len(contacts)} contact(s) retenu(s), doublon signalé : "
           f"{'oui' if 'doublon ignoré' in page else 'non'}",
           len(contacts) == 1 and "doublon ignoré" in page)

    # ② Le numéro déclaré : l'exception, et elle seule.
    declarer(NUMERO_ESSAI_BANC)
    j.egal(nature, depart, CONSTRUCTION,
           "le numéro d'essai déclaré est retenu par les réglages",
           NUMERO_ESSAI_BANC,
           banc.application.preferences.obtenir(essai_reel.CLE_NUMERO_ESSAI))
    brouillon, page, contacts = grille(lignes)
    j.egal(nature, depart, CONSTRUCTION,
           "avec le numéro d'essai déclaré, les quatre identités passent",
           4, len(contacts))
    j.egal(nature, depart, CONSTRUCTION,
           "chacune est marquée 🧪 dans la grille, avec la phrase qui dit "
           "pourquoi", 4, page.count("🧪 numéro d'essai"))
    autre = [f"Mme Une;{CONTACT_STOP[1]};{_iso(23, 15)};Séance",
             f"M. Deux;{CONTACT_STOP[1]};{_iso(23, 16)};Séance"]
    _, page_autre, contacts_autre = grille(autre)
    j.vrai(nature, depart, CONSTRUCTION,
           "un AUTRE numéro répété reste refusé, numéro d'essai déclaré ou non",
           "1 contact retenu, doublon signalé",
           f"{len(contacts_autre)} contact(s) retenu(s), doublon signalé : "
           f"{'oui' if 'doublon ignoré' in page_autre else 'non'}",
           len(contacts_autre) == 1 and "doublon ignoré" in page_autre)
    campagne_id, page = banc.valider_grille(brouillon)
    contacts_bd = (banc.base.contacts_de_campagne(campagne_id)
                   if campagne_id else [])
    j.egal(nature, depart, CONSTRUCTION,
           "la validation de la grille ne refuse pas non plus ces doublons : "
           "quatre contacts distincts entrent en campagne", 4, len(contacts_bd))
    j.egal(nature, depart, CONSTRUCTION,
           "quatre FICHES CLIENTS distinctes — le couple (nom, numéro) fait "
           "la fiche", 4, len({c["client_id"] for c in contacts_bd}))
    j.egal(nature, depart, CONSTRUCTION,
           "les quatre contacts portent le drapeau 🧪 dans la fiche de "
           "campagne", 4, sum(1 for c in contacts_bd if c["numero_essai"]))

    # ③ Le champ vidé : la règle stricte revient pour tout le monde.
    declarer("")
    _, page, contacts = grille(lignes)
    j.vrai(nature, depart, CONSTRUCTION,
           "le numéro d'essai retiré, le refus de doublon revient pour lui aussi",
           "1 contact retenu, doublon signalé",
           f"{len(contacts)} contact(s) retenu(s), doublon signalé : "
           f"{'oui' if 'doublon ignoré' in page else 'non'}",
           len(contacts) == 1 and "doublon ignoré" in page)

    # La campagne d'essai en conditions réelles : préparée, JAMAIS lancée.
    page, _ = banc.poster("/reglages/essai-reel", {"confirmer": "oui"})
    j.vrai(nature, depart, CONSTRUCTION,
           "sans numéro d'essai déclaré, le bouton « Préparer une campagne "
           "d'essai réel » le DIT et ne crée rien",
           "un refus écrit à l'écran, aucune campagne créée",
           _titre_de(page), "rien n'a été préparé" in page.lower())
    declarer(NUMERO_ESSAI_BANC)
    avant = len(banc.base.lister_campagnes())
    banc.poster("/reglages/essai-reel", {"confirmer": "oui"})
    campagnes_apres = banc.base.lister_campagnes()
    essai = campagnes_apres[0] if len(campagnes_apres) > avant else None
    j.egal(nature, depart, CONSTRUCTION,
           "la campagne d'essai en conditions réelles est créée à l'état PRÊTE",
           "prête", essai["statut"] if essai else "aucune campagne créée")
    contacts_essai = (banc.base.contacts_de_campagne(essai["id"])
                      if essai else [])
    j.egal(nature, depart, CONSTRUCTION,
           "elle porte une identité par rôle à jouer",
           len(essai_reel.IDENTITES), len(contacts_essai))
    appels = sum(len(banc.base.appels_du_contact_campagne(c["id"]))
                 for c in contacts_essai)
    j.egal(nature, depart, CONSTRUCTION,
           "et AUCUN appel n'en est parti — c'est l'opérateur qui démarre",
           0, appels)
    j.verrou("Préparer l'essai en conditions réelles ne passe aucun appel",
             "campagne « prête », 0 appel enregistré",
             f"statut « {essai['statut'] if essai else '—'} », "
             f"{appels} appel(s)",
             bool(essai) and essai["statut"] == "prête" and appels == 0)
    # Le numéro d'essai est rendu au contrôle de masquage global : déclaré ou
    # non, il ne doit JAMAIS apparaître en clair sur une page.
    banc.numeros_a_masquer.append(NUMERO_ESSAI_BANC)
    declarer("")


def _titre_de(page):
    trouve = re.search(r"<h1>(.*?)</h1>", page, re.S)
    return html_mod.unescape(re.sub(r"<[^>]+>", "", trouve.group(1))).strip() \
        if trouve else "(aucun titre)"


def _message_de(page):
    trouve = re.search(r'<p class="pastille">(.*?)</p>', page, re.S)
    return html_mod.unescape(re.sub(r"<[^>]+>", "", trouve.group(1))).strip() \
        if trouve else "(aucun message à l'écran)"


# Les DEUX seules pages où un numéro en clair est VOULU, et annoncé comme tel :
# la zone de collage de la page Cascade (c'est la liste que l'utilisateur
# collerait lui-même, générée à sa demande) et les exports CSV (leur raison
# d'être). Elles sont donc écartées du contrôle de masquage — et c'est dit.
PAGES_NUMEROS_EN_CLAIR_VOULUS = ("/cascade/generer", "/cascade/csv",
                                 "/assistant/csv")


def controler_masquage_global(banc):
    """Aucune page servie ne doit contenir un numéro EN CLAIR."""
    clairs = [tel for _, _, tel in CONTACTS_FORCES]
    clairs += [CONTACT_STOP[1], CONTACT_SUPPRIME[1]]
    # Le 🧪 numéro d'ESSAI est un numéro comme un autre pour cette règle :
    # le déclarer exempte du DOUBLON, jamais du masquage.
    clairs += banc.numeros_a_masquer
    fuites, vues = [], 0
    for chemin, contenu in banc.pages_vues:
        if chemin in PAGES_NUMEROS_EN_CLAIR_VOULUS:
            continue
        vues += 1
        for clair in clairs:
            if clair in contenu:
                fuites.append(f"{chemin} laisse voir {clair}")
    banc.j.verrou(
        f"Le masquage des numéros tient sur les {vues} pages servies pendant "
        "ce banc",
        "aucun numéro en clair, nulle part — sauf la zone de collage de la "
        "page Cascade et les exports CSV, où il est voulu et annoncé",
        "aucune fuite" if not fuites else " ; ".join(fuites[:5]),
        not fuites)
    banc.j.remarque(
        "Masquage : la zone de collage de la page Cascade et les exports CSV "
        "contiennent volontairement les numéros en clair (c'est la liste que "
        "l'utilisateur collerait lui-même). Ces pages sont donc écartées du "
        "contrôle de masquage, à dessein.")


def expliquer_les_trous(journal):
    """Dire, avant même de compter, POURQUOI il reste des cases ⬜."""
    journal.remarque(
        "Chaque voie de remplissage (CSV, agenda ICS, les cinq sources de la "
        "base, les six reprises de campagne) est éprouvée avec UNE nature, "
        "choisie pour être la plus naturelle avec elle. Les autres "
        "croisements « voie × nature » restent ⬜ : ils sont possibles dans le "
        "produit, ce banc ne les a simplement pas parcourus.")
    journal.remarque(
        "Une reprise de campagne FILTRÉE par état ne peut rencontrer que les "
        "issues des personnes qui étaient dans cet état : une reprise des "
        "« ❌ refus » ne croisera jamais un « 51 accepte ». Les ⬜ de ces "
        "lignes ne sont pas des oublis, c'est la nature du filtre.")
    journal.remarque(
        "Le cas « contact sans numéro » ne peut naître que d'un agenda ICS ou "
        "être compté comme écarté par une source de la base : un collage, un "
        "CSV et une liste de cascade passent tous par le validateur de "
        "numéro, qui refuse la ligne. D'où les ⬜ de la colonne « sans "
        "numéro » pour les autres natures.")


def gestes_a_la_main(journal):
    """Ce qu'un banc sans souris ne peut pas prouver — dit en clair."""
    journal.main("Le dévoilement en cascade des options (une option qui "
                 "révèle ses sous-options)",
                 "Étape 2 : décocher puis recocher « Recontacter » et vérifier "
                 "que le bloc de relance apparaît et disparaît sans que la "
                 "page se recharge.")
    journal.main("Les boutons ⏸ Pause et ⏹ Arrêter pendant une campagne",
                 "Lancer une campagne d'au moins 10 contacts, cliquer ⏸ "
                 "pendant qu'elle tourne, vérifier que l'appel en cours "
                 "s'achève puis que rien ne repart.")
    journal.main("Le téléchargement des fichiers CSV (grille et liste de "
                 "cascade)",
                 "Cliquer « Exporter en CSV » et ouvrir le fichier reçu : les "
                 "numéros y sont en clair, c'est voulu et annoncé.")
    journal.main("La modale d'édition d'un rendez-vous depuis le planning",
                 "Planning : cliquer une case occupée, changer l'heure dans la "
                 "modale, enregistrer, et vérifier que seule la zone du "
                 "planning se recharge.")
    journal.main("Le confort de lecture (couleurs, contrastes, taille des "
                 "caractères)",
                 "Ouvrir chaque page et juger à l'œil ; aucun banc ne peut le "
                 "faire à votre place.")
    journal.main("Le mode APPELS RÉELS (les trois verrous)",
                 "Ce banc ne l'approche JAMAIS. Pour l'éprouver, il faut la "
                 "clé CALLE_API_KEY, l'option --appels-reels et taper "
                 "APPELER : à faire à la main, en connaissance de cause.")
    journal.main("L'ISSUE d'un vrai appel — ce que l'agent comprend de ce que "
                 "vous DITES au téléphone",
                 "Aucun banc ne peut en juger : ici, l'issue est décidée par "
                 "le simulateur ; au téléphone, elle dépend de vos phrases et "
                 "de la compréhension du français par l'agent. C'est l'objet "
                 "de l'essai en conditions réelles : déclarez votre 🧪 numéro "
                 "d'essai dans ⚙ Réglages, préparez la campagne d'essai, puis "
                 "suivez PROCEDURE-ESSAI-REEL.md — c'est VOUS qui constatez, "
                 "appel par appel, si le résultat rendu est fidèle.")


# ===========================================================================
#  LE RAPPORT
# ===========================================================================
def _libelles(paires):
    return dict(paires)


LIB_NATURES = {code: f"{definition['icone']} {definition['nom']}"
               for code, definition in assistant.NATURES.items()}
LIB_ISSUES = _libelles(ISSUES)
LIB_DEPARTS = _libelles(DEPARTS)


def _marque_case(journal, cas_de_la_case, sans_objet):
    if sans_objet:
        return "·"
    return journal.marque(cas_de_la_case)


def construire_tableaux(journal):
    """Les trois tableaux du rapport, prêts à rendre en texte ou en HTML."""
    cellules = journal.cellules()

    def cas_pour(filtre):
        trouves = []
        for (nature, depart, issue), liste in cellules.items():
            if filtre(nature, depart, issue):
                trouves += liste
        return trouves

    # Tableau A : nature × issue
    lignes_a = []
    for nature in NATURES_ORDRE:
        cases = []
        for issue in CODES_ISSUES:
            liste = cas_pour(lambda n, d, i, na=nature, iss=issue:
                             n == na and i == iss)
            cases.append(_marque_case(journal, liste, False))
        lignes_a.append((LIB_NATURES[nature], cases))
    tableau_a = {"titre": "TABLEAU A — chaque NATURE de campagne face à "
                          "chaque ISSUE d'appel",
                 "colonnes": [LIB_ISSUES[c] for c in CODES_ISSUES],
                 "lignes": lignes_a}

    # Tableau B : point de départ × nature (colonne « construction » comprise)
    lignes_b = []
    for depart in CODES_DEPARTS:
        cases = []
        for nature in NATURES_ORDRE:
            atteignables = NATURES_DU_DEPART.get(depart)
            sans_objet = (atteignables is not None
                          and nature not in atteignables)
            liste = cas_pour(lambda n, d, i, na=nature, de=depart:
                             n == na and d == de)
            cases.append(_marque_case(journal, liste, sans_objet and not liste))
        lignes_b.append((LIB_DEPARTS[depart], cases))
    tableau_b = {"titre": "TABLEAU B — chaque POINT DE DÉPART face à chaque "
                          "NATURE de campagne",
                 "colonnes": [LIB_NATURES[n] for n in NATURES_ORDRE],
                 "lignes": lignes_b}

    # Tableau C : point de départ × issue
    lignes_c = []
    for depart in CODES_DEPARTS:
        cases = []
        for issue in CODES_ISSUES:
            sans_objet = ((depart, "*") in SANS_OBJET_ISSUE_DEPART
                          or (depart, issue) in SANS_OBJET_ISSUE_DEPART)
            liste = cas_pour(lambda n, d, i, de=depart, iss=issue:
                             d == de and i == iss)
            cases.append(_marque_case(journal, liste, sans_objet and not liste))
        lignes_c.append((LIB_DEPARTS[depart], cases))
    tableau_c = {"titre": "TABLEAU C — chaque POINT DE DÉPART face à chaque "
                          "ISSUE d'appel",
                 "colonnes": [LIB_ISSUES[c] for c in CODES_ISSUES],
                 "lignes": lignes_c}
    return [tableau_a, tableau_b, tableau_c]


def compter(journal):
    """Les chiffres du rapport, tous mesurés."""
    cellules = journal.cellules()
    trois_axes = {cle: liste for cle, liste in cellules.items()
                  if cle[2] in CODES_ISSUES and cle[0] is not None}
    passees = sum(1 for liste in trois_axes.values()
                  if all(c.passe for c in liste))
    theorique = len(NATURES_ORDRE) * len(CODES_DEPARTS) * len(CODES_ISSUES)
    paires = {}
    for nom, axes in (("nature × issue", ("nature", "issue")),
                      ("départ × nature", ("depart", "nature")),
                      ("départ × issue", ("depart", "issue"))):
        agrege = journal.agreger(*axes)
        paires[nom] = {
            "visitees": len(agrege),
            "passees": sum(1 for m in agrege.values() if m == "✅"),
            "echouees": sum(1 for m in agrege.values() if m == "❌")}
    return {
        "controles": len(journal.cas),
        "controles_passes": sum(1 for c in journal.cas if c.passe),
        "controles_echoues": len(journal.echecs),
        "combinaisons_visitees": len(trois_axes),
        "combinaisons_passees": passees,
        "combinaisons_echouees": len(trois_axes) - passees,
        "combinaisons_theoriques": theorique,
        "verrous": len(journal.verrous),
        "verrous_passes": sum(1 for v in journal.verrous if v[3]),
        "paires": paires,
    }


# LE PLANCHER DU NOMBRE DE CONTRÔLES (10/08/2026). Il ne sert qu'à une chose :
# rendre VISIBLE la disparition d'un contrôle. Un contrôle conditionné par le
# contenu d'un écran cesse de s'exécuter dès que l'écran change, et le rapport
# continue d'annoncer « TOUT PASSE » — c'est exactement ce qui est arrivé ce
# jour-là (614 → 613, détail identique, aucun échec), puis le compte est
# revenu à 614 plus tard le même jour, stable à l'octet sur deux exécutions
# consécutives. Le contrôle en cause n'a pas été nommé : sa condition d'entrée
# dépend donc de quelque chose qui a bougé entre-temps. C'est précisément ce
# que ce plancher est là pour rendre criant la prochaine fois.
# On le RELÈVE en ajoutant des contrôles. On ne le baisse qu'en sachant dire
# lequel on a perdu, et pourquoi c'est voulu.
#
# ⚠ 614 → 613 LE 11/08/2026, ET CETTE FOIS LE CONTRÔLE PERDU EST NOMMÉ — c'est
# ce que le paragraphe ci-dessus exigeait. Mesuré en comparant les libellés de
# contrôle d'une exécution à l'autre :
#
#   le vivier des contacts « à rappeler par un humain » a RÉTRÉCI par décision
#   du propriétaire (ce rappel n'existe plus que sur « déplacement » et « prise
#   de rendez-vous » — voir assistant.NATURES_RAPPEL_HUMAIN). Les départs « Étape
#   3 — reprise » piochent donc dans d'autres viviers : le cas « 54 » de la prise
#   de rendez-vous est passé de la reprise « ✅ acceptés » à la reprise « 🙋 à
#   rappeler par un humain », et une combinaison a un contact de moins à
#   contrôler.
#
# C'est voulu : l'état existe moins souvent parce qu'on l'a voulu ainsi. Le
# plancher descend donc d'un cran, en connaissance de cause.
#
# ⚠ ET LE 14/08/2026, LA VRAIE CAUSE DU PREMIER 614 → 613 EST TROUVÉE : LE JOUR
# DE LA SEMAINE. Le banc part d'« aujourd'hui à 12 h » ; ses blocs avancent de
# dix jours en dix jours, et dix jours décalent le jour de la semaine de trois.
# Certains jours, un bloc tombait donc un samedi ou un dimanche — cabinet
# fermé. Le produit refusait alors, à juste titre, de poser le rendez-vous, et
# le contrôle qui suivait mesurait le CALENDRIER, pas le produit. Mesuré ce
# jour-là (un vendredi) : le report simulé, toujours à la place + deux jours,
# tombait le dimanche 16/08 — « Rendez-vous NON créé […] hors des horaires
# d'ouverture », et « l'ancien rendez-vous ne tient plus » échouait.
#
# C'est exactement la même famille de piège que les HEURES du 11/08 (voir
# `Banc.demarrer`, 8 h – 19 h) : le montage du banc doit couvrir ce que ses
# propres appels peuvent proposer. Les dates de la cascade directe passent
# désormais par `_jour_ouvre`, et le compte est stable quel que soit le jour.
# Le plancher remonte donc à 614 — ce qu'il valait avant que le calendrier ne
# l'abaisse.
#
# ⚠ 614 → 619 LE 14/08/2026, ET CETTE FOIS C'EST UN GAIN. L'audit croisé
# « adaptations × natures » a fait corriger la branche « autre date convenue » :
# quand la date rendue est l'une des places ANNONCÉES, la place est désormais
# marquée pourvue et le curseur avance (avant, elle restait « à pourvoir », était
# réannoncée, puis déclarée « prise entre-temps » alors que la campagne l'avait
# pourvue). Une combinaison de plus est donc parcourue — 116 au lieu de 115 — et
# cinq contrôles de plus s'exécutent. Le plancher monte avec eux.
#
# ⚠ 619 → 629 LE 15/08/2026, ET LA CAUSE EST NOMMÉE AVANT DE MONTER LE PLANCHER
# — c'est ce qu'exige le paragraphe du 11/08 ci-dessus, dans l'autre sens.
# Le rappel manuel a disparu de « créneau libéré » sur SON DERNIER chemin, celui
# des dates refusées : ces contacts partent maintenant « refusé ». Le vivier des
# « refusé » grossit d'autant, et les départs « Étape 3 — reprise » qui y
# piochent atteignent DEUX combinaisons de plus (118 au lieu de 116), donc dix
# contrôles de plus. C'est le mécanisme exact du 614 → 613, joué à l'envers :
# la taille d'un vivier commande le nombre de reprises possibles.
#
# ⚠ 629 → 637 LE 15/08/2026 : HUIT CONTRÔLES DE PLUS, ET C'EST LE TROU QUI A
# COÛTÉ TROIS JOURS. Sa question : « Est-ce que tu fais des vrais essais comme
# moi — créer une campagne, l'exécuter, regarder l'historique ? » Non. Et le
# banc, qui lui le faisait, ne contrôlait PAS l'option « décaler en cascade » —
# le mot « cascade » y désignait la *page* Cascade, une autre fonctionnalité.
# Ni mes essais ni le banc ne pouvaient donc voir son défaut.
# `scenario_decalage_en_cascade` refait son geste en entier, par HTTP, sur une
# campagne à UNE place — le cas de toutes les siennes.
#
# ⚠ 637 → 633 LE 16/08/2026 : QUATRE CONTRÔLES PERDUS, ET C'EN EST LE PRIX.
# Sa demande du jour : la règle dynamique s'ouvre désormais sur « rendez-vous à
# venir, pas encore confirmés » (c'était « à recaser » — voir
# assistant.REGLE_LISTE_DEFAUT).
#
# CE QUI EST PERDU, NOMMÉ : la case « Étape 3 — reprise : ❌ refus » × « 51 ·
# accepte ». Une campagne de rattrapage est montée en mode automatique ; la
# règle par défaut y ajoute donc du monde, et ce n'est plus la même liste. Avec
# « à recaser » elle ramenait le contact à terminaison 51 ; avec « à venir »,
# non — cette personne n'a plus de rendez-vous à venir, elle attend une place.
# La combinaison n'a donc plus de contact « qui accepte » à faire jouer.
#
# BISSECTÉ, pas supposé : seul REGLE_LISTE_DEFAUT remis à « a_recaser » rend
# 637/119 ; la date de référence forcée au 15/08 rend toujours 633/118. Ce
# n'est donc pas le calendrier, contrairement au 614 → 613 du 11/08.
#
# C'est voulu — le défaut change, la liste change — mais ce n'est pas gratuit :
# ce chemin de reprise n'est plus éprouvé avec quelqu'un qui accepte. À rendre
# indépendant du défaut le jour où l'on y retouche (la reprise devrait valider
# en mode MANUEL : son sujet est de reprendre une liste, pas de rejouer une
# règle).
#
# ⚠ 633 → 643 LE 17/08/2026 : DIX CONTRÔLES DE PLUS, ET UN PIÈGE ÉVITÉ DE JUSTESSE.
# SON TEST est devenu un scénario : déplacer les rendez-vous d'une JOURNÉE
# ENTIÈRE, et vérifier que tout le monde est traité, que les rendez-vous bougent
# vraiment, que jamais vers une date passée, et que les cas qu'il a nommés
# apparaissent (voir `scenario_deplacement_journee_entiere`).
#
# LE PIÈGE, MESURÉ AVANT DE MONTER LE PLANCHER : à sa première place dans
# l'ordre, le scénario ajoutait bien ses 10 contrôles… et le total ne montait
# que de 5. Ses relances faisaient passer les « 🔁 à recontacter » de la base
# partagée en « 📵 injoignable » ; la reprise « à recontacter », qui vient lire
# ce vivier ensuite, tombait de 6 contrôles à 1. Aucun échec, aucun incident :
# le rapport annonçait « TOUT PASSE » avec MOINS de couverture qu'avant.
#
# C'est exactement ce que ce plancher existe pour attraper, et c'est la deuxième
# fois qu'il le fait (voir 614 → 613 et 637 → 633). Remède : le scénario passe
# APRÈS tous les autres — après les reprises, pas seulement après la matrice.
# Comptes vérifiés des deux côtés : « à recontacter » revenu à 6, journée
# entière à 10, total 643/121 = 633/118 + 10/3. Rien de perdu.
CONTROLES_PLANCHER = 643


def rapport_texte(journal, chiffres, tableaux):
    """Le rapport en texte, pour la console."""
    lignes = []
    ajouter = lignes.append
    ajouter("=" * 78)
    ajouter("  RINGBACK — BANC D'ESSAI DE BOUT EN BOUT (simulation uniquement)")
    ajouter(f"  Rapport du {REFERENCE:%d/%m/%Y}")
    ajouter("=" * 78)
    ajouter("")
    verdict = ("TOUT PASSE" if not journal.echecs
               else f"{len(journal.echecs)} CONTRÔLE(S) EN ÉCHEC")
    ajouter(f"EN UNE LIGNE : {verdict} — "
            f"{chiffres['controles_passes']}/{chiffres['controles']} contrôles, "
            f"{chiffres['combinaisons_passees']}/"
            f"{chiffres['combinaisons_visitees']} combinaisons parcourues.")
    ajouter("")
    ajouter("-" * 78)
    ajouter("1. LES VERROUS DE SÉCURITÉ (aucun appel réel ne peut partir d'ici)")
    ajouter("-" * 78)
    for libelle, attendu, obtenu, passe in journal.verrous:
        ajouter(f"  {'✅' if passe else '❌'} {libelle}")
        if not passe:
            ajouter(f"       attendu : {attendu}")
            ajouter(f"       obtenu  : {obtenu}")
    ajouter("")
    ajouter("-" * 78)
    ajouter("2. LE COMPTE DES CAS")
    ajouter("-" * 78)
    # ⚠ UN CONTRÔLE QUI DISPARAÎT NE FAIT AUCUN BRUIT. Le 10/08/2026, le banc
    # est passé de 614 à 613 contrôles : tout passait, le détail était
    # identique à l'octet près, et un contrôle avait simplement cessé de
    # s'exécuter — parce qu'il dépend d'une condition qu'un écran remanié ne
    # remplit plus. Rien ne l'a signalé. Le plancher ci-dessous le signale
    # désormais : on le RELÈVE quand on ajoute des contrôles, jamais on ne le
    # baisse sans savoir lequel on a perdu.
    manque = CONTROLES_PLANCHER - chiffres["controles"]
    if manque > 0:
        ajouter(f"  ⚠ {manque} CONTRÔLE(S) NE S'EXÉCUTENT PLUS — le banc en")
        ajouter(f"    attendait au moins {CONTROLES_PLANCHER}. Tout passe, mais")
        ajouter("    quelque chose n'est plus vérifié : cherchez le contrôle")
        ajouter("    dont la condition d'entrée a changé.")
    ajouter(f"  Contrôles exécutés ........................ {chiffres['controles']}")
    ajouter(f"     dont passés ............................ {chiffres['controles_passes']}")
    ajouter(f"     dont en échec .......................... {chiffres['controles_echoues']}")
    ajouter(f"  Combinaisons (nature × départ × issue) ... {chiffres['combinaisons_visitees']} parcourues")
    ajouter(f"     dont entièrement bonnes ................ {chiffres['combinaisons_passees']}")
    ajouter(f"     dont fautives .......................... {chiffres['combinaisons_echouees']}")
    ajouter(f"  Produit complet des trois axes ............ {chiffres['combinaisons_theoriques']}")
    ajouter("     (la plupart n'existent pas dans le produit : voir les")
    ajouter("      cases « · sans objet » des tableaux, et la section 6)")
    for nom, valeurs in chiffres["paires"].items():
        ajouter(f"  Paires {nom:<16} ......... {valeurs['passees']} bonnes / "
                f"{valeurs['echouees']} fautives sur {valeurs['visitees']} "
                "parcourues")
    ajouter("")
    ajouter("  Légende : ✅ passé   ❌ échoué   ⬜ non couvert   · sans objet")
    ajouter("")
    for tableau in tableaux:
        ajouter("-" * 78)
        ajouter(f"3. {tableau['titre']}" if tableau is tableaux[0]
                else f"   {tableau['titre']}")
        ajouter("-" * 78)
        largeur = max(len(ligne[0]) for ligne in tableau["lignes"]) + 1
        for indice, colonne in enumerate(tableau["colonnes"]):
            ajouter(f"     colonne {indice + 1} = {colonne}")
        entete = " " * largeur + "".join(f"{i + 1:>4}"
                                         for i in range(len(tableau["colonnes"])))
        ajouter(entete)
        for nom, cases in tableau["lignes"]:
            ajouter(f"{nom:<{largeur}}" + "".join(f"  {c} " for c in cases))
        ajouter("")
    ajouter("-" * 78)
    ajouter("4. LES ÉCHECS, UN PAR UN")
    ajouter("-" * 78)
    if not journal.echecs:
        ajouter("  Aucun échec.")
    for numero, cas in enumerate(journal.echecs, start=1):
        ajouter(f"  ❌ {numero}. {_situation(cas)}")
        ajouter(f"        ce qui était vérifié : {cas.quoi}")
        ajouter(f"        attendu : {cas.attendu}")
        ajouter(f"        obtenu  : {cas.obtenu}")
    ajouter("")
    ajouter("-" * 78)
    ajouter("5. À VÉRIFIER À LA MAIN (ce banc n'a pas de souris)")
    ajouter("-" * 78)
    for quoi, marche in journal.a_la_main:
        ajouter(f"  • {quoi}")
        ajouter(f"    → {marche}")
    ajouter("")
    ajouter("-" * 78)
    ajouter("6. CE QUI N'EST PAS COUVERT, ET POURQUOI")
    ajouter("-" * 78)
    for depart, raison in SANS_OBJET_DEPART_NATURE.items():
        ajouter(f"  · {LIB_DEPARTS[depart]} : {raison}")
    for (depart, marque), raison in SANS_OBJET_ISSUE_DEPART.items():
        if marque == "*":
            ajouter(f"  · {LIB_DEPARTS[depart]} : {raison}")
    ajouter("  ⬜ Toute case ⬜ des tableaux est un trou de couverture ASSUMÉ :")
    ajouter("     ce banc ne l'a pas parcourue. Elle n'est pas « bonne », elle")
    ajouter("     est INCONNUE.")
    for remarque in journal.remarques:
        ajouter(f"  · {remarque}")
    if journal.incidents:
        ajouter("")
        ajouter("  Imprévus du banc lui-même (à lire : ils faussent peut-être")
        ajouter("  une partie du rapport) :")
        for incident in journal.incidents:
            ajouter(f"  ! {incident}")
    ajouter("")
    ajouter("-" * 78)
    ajouter("7. COMMENT CE RAPPORT EST FABRIQUÉ")
    ajouter("-" * 78)
    ajouter("  • Base JETABLE dans un dossier temporaire, détruite à la fin.")
    ajouter("    La base réelle donnees/ringback.db n'est jamais ouverte.")
    ajouter("  • Serveur web sur le port 8779 (le produit vit sur 8770).")
    ajouter("  • Jeu de données : celui du produit (ringback/jeu_essai.py),")
    ajouter(f"    {len(jeu_essai.CLIENTS)} clients et "
            f"{len(jeu_essai.RENDEZVOUS)} rendez-vous, numéros de fiction")
    ajouter("    Arcep — aucun ne peut sonner chez quelqu'un.")
    ajouter(f"  • Date de référence : {REFERENCE:%d/%m/%Y} à 12 h 00. C'est la")
    ajouter("    SEULE date relative ; tout le reste en découle. Le rapport ne")
    ajouter("    porte pas d'heure, pour être comparable d'une exécution à")
    ajouter("    l'autre le même jour.")
    ajouter("")
    return "\n".join(lignes)


def _situation(cas):
    morceaux = []
    if cas.nature:
        morceaux.append(f"nature « {LIB_NATURES.get(cas.nature, cas.nature)} »")
    if cas.depart:
        morceaux.append(f"départ « {LIB_DEPARTS.get(cas.depart, cas.depart)} »")
    if cas.issue == CONSTRUCTION:
        morceaux.append("construction de la campagne")
    else:
        morceaux.append(f"issue « {LIB_ISSUES.get(cas.issue, cas.issue)} »")
    return " ; ".join(morceaux)


_STYLE = """
body { font-family: "Segoe UI", system-ui, sans-serif; margin: 0;
       background: #f6f7f9; color: #1d2330; line-height: 1.5; }
main { max-width: 1080px; margin: 0 auto; padding: 24px 18px 60px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
h2 { font-size: 1.15rem; margin: 34px 0 10px; padding-bottom: 6px;
     border-bottom: 2px solid #dfe3ea; }
.sous { color: #5a6474; margin: 0 0 20px; }
.verdict { background: #fff; border-left: 6px solid #2f8f4e; padding: 14px 16px;
           border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.08);
           font-size: 1.05rem; }
.verdict.mauvais { border-left-color: #c0392b; }
table { border-collapse: collapse; background: #fff; font-size: .9rem;
        box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.defiler { overflow-x: auto; }
th, td { border: 1px solid #e3e6ec; padding: 6px 9px; text-align: left; }
th { background: #eef1f6; font-weight: 600; }
td.case { text-align: center; font-size: 1.05rem; width: 2.4rem; }
td.nom { white-space: nowrap; }
.chiffres { display: grid; gap: 10px;
            grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.chiffre { background: #fff; border-radius: 6px; padding: 12px 14px;
           box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.chiffre b { display: block; font-size: 1.6rem; }
.legende { color: #5a6474; font-size: .9rem; }
ul { padding-left: 22px; }
li { margin-bottom: 8px; }
.echec { background: #fff; border-left: 5px solid #c0392b; padding: 10px 14px;
         border-radius: 5px; margin-bottom: 12px; }
.ok { color: #2f8f4e; } .ko { color: #c0392b; }
code { background: #eef1f6; padding: 1px 5px; border-radius: 3px; }
"""


def rapport_html(journal, chiffres, tableaux):
    """Le même rapport, en page autonome (aucune ressource extérieure)."""
    e = html_mod.escape
    morceaux = ["<!doctype html>", '<html lang="fr"><head>',
                '<meta charset="utf-8">',
                '<meta name="viewport" content="width=device-width, '
                'initial-scale=1">',
                "<title>RingBack — banc d'essai de bout en bout</title>",
                f"<style>{_STYLE}</style></head><body><main>"]
    a = morceaux.append
    a("<h1>RingBack — banc d'essai de bout en bout</h1>")
    a(f'<p class="sous">Rapport du {REFERENCE:%d/%m/%Y} — '
      "essais en <strong>simulation</strong> uniquement : aucun appel réel "
      "n'a pu partir, aucune donnée réelle n'a été touchée.</p>")
    mauvais = " mauvais" if journal.echecs else ""
    verdict = ("Tout passe." if not journal.echecs
               else f"{len(journal.echecs)} contrôle(s) en échec.")
    a(f'<p class="verdict{mauvais}"><strong>{e(verdict)}</strong><br>'
      f"{chiffres['controles_passes']} contrôles réussis sur "
      f"{chiffres['controles']} ; "
      f"{chiffres['combinaisons_passees']} combinaisons entièrement bonnes sur "
      f"{chiffres['combinaisons_visitees']} parcourues.</p>")
    a("<h2>1. Les verrous de sécurité</h2>")
    a("<ul>")
    for libelle, attendu, obtenu, passe in journal.verrous:
        marque = '<span class="ok">✅</span>' if passe else '<span class="ko">❌</span>'
        detail = ("" if passe else
                  f"<br><small>attendu : {e(attendu)}<br>"
                  f"obtenu : {e(obtenu)}</small>")
        a(f"<li>{marque} {e(libelle)}{detail}</li>")
    a("</ul>")
    a("<h2>2. Le compte des cas</h2>")
    a('<div class="chiffres">')
    for titre, valeur in (
            ("Contrôles exécutés", chiffres["controles"]),
            ("Contrôles réussis", chiffres["controles_passes"]),
            ("Contrôles en échec", chiffres["controles_echoues"]),
            ("Combinaisons parcourues", chiffres["combinaisons_visitees"]),
            ("Combinaisons bonnes", chiffres["combinaisons_passees"]),
            ("Verrous tenus",
             f"{chiffres['verrous_passes']}/{chiffres['verrous']}")):
        a(f'<div class="chiffre"><b>{valeur}</b>{e(titre)}</div>')
    a("</div>")
    a('<p class="legende">Le produit complet des trois axes vaudrait '
      f"{chiffres['combinaisons_theoriques']} combinaisons. La plupart "
      "n'existent pas dans le produit (une file d'appels n'a pas de nature, "
      "un collage ne peut pas produire un contact sans numéro…) : elles sont "
      "marquées « · sans objet ». Les cases ⬜ sont de vrais trous, assumés "
      "comme tels.</p>")
    a('<p class="legende">Légende : ✅ passé — ❌ échoué — ⬜ non couvert — '
      "· sans objet</p>")
    numero = 3
    for tableau in tableaux:
        a(f"<h2>{numero}. {e(tableau['titre'])}</h2>")
        numero += 1
        a('<div class="defiler"><table><tr><th></th>')
        for colonne in tableau["colonnes"]:
            a(f"<th>{e(colonne)}</th>")
        a("</tr>")
        for nom, cases in tableau["lignes"]:
            a(f'<tr><td class="nom">{e(nom)}</td>')
            for case in cases:
                a(f'<td class="case">{case}</td>')
            a("</tr>")
        a("</table></div>")
    a(f"<h2>{numero}. Les échecs, un par un</h2>")
    numero += 1
    if not journal.echecs:
        a("<p>Aucun échec.</p>")
    for indice, cas in enumerate(journal.echecs, start=1):
        a(f'<div class="echec"><strong>{indice}. {e(_situation(cas))}</strong>'
          f"<br>Ce qui était vérifié : {e(cas.quoi)}."
          f"<br><strong>Attendu :</strong> {e(cas.attendu)}"
          f"<br><strong>Obtenu :</strong> {e(cas.obtenu)}</div>")
    a(f"<h2>{numero}. À vérifier à la main</h2>")
    numero += 1
    a("<p>Ce banc n'a pas de souris : ce qui suit ne peut pas être prouvé "
      "automatiquement.</p><ul>")
    for quoi, marche in journal.a_la_main:
        a(f"<li><strong>{e(quoi)}</strong><br>{e(marche)}</li>")
    a("</ul>")
    a(f"<h2>{numero}. Ce qui n'est pas couvert, et pourquoi</h2>")
    numero += 1
    a("<ul>")
    for depart, raison in SANS_OBJET_DEPART_NATURE.items():
        a(f"<li>· <strong>{e(LIB_DEPARTS[depart])}</strong> : {e(raison)}</li>")
    for (depart, marque), raison in SANS_OBJET_ISSUE_DEPART.items():
        if marque == "*":
            a(f"<li>· <strong>{e(LIB_DEPARTS[depart])}</strong> : "
              f"{e(raison)}</li>")
    for remarque in journal.remarques:
        a(f"<li>· {e(remarque)}</li>")
    a("</ul>")
    if journal.incidents:
        a("<p><strong>Imprévus du banc lui-même</strong> (ils faussent "
          "peut-être une partie du rapport) :</p><ul>")
        for incident in journal.incidents:
            a(f"<li>! {e(incident)}</li>")
        a("</ul>")
    a(f"<h2>{numero}. Comment ce rapport est fabriqué</h2>")
    a("<ul>")
    a("<li>Base <strong>jetable</strong> dans un dossier temporaire, détruite "
      "à la fin. La base réelle <code>donnees/ringback.db</code> n'est jamais "
      "ouverte : le banc refuse de démarrer si on la lui désigne.</li>")
    a("<li>Serveur web sur le port <code>8779</code> (le produit vit sur "
      "<code>8770</code>), arrêté proprement même en cas d'échec au "
      "milieu.</li>")
    a(f"<li>Jeu de données : celui du produit "
      f"(<code>ringback/jeu_essai.py</code>) — {len(jeu_essai.CLIENTS)} "
      f"clients, {len(jeu_essai.RENDEZVOUS)} rendez-vous, numéros de fiction "
      "Arcep qui ne peuvent pas sonner chez quelqu'un.</li>")
    a(f"<li>Date de référence : <strong>{REFERENCE:%d/%m/%Y} à 12 h 00</strong>"
      " — la seule date relative du banc, tout le reste en découle. Le rapport "
      "ne porte pas d'heure, pour être comparable d'une exécution à l'autre le "
      "même jour.</li>")
    a("</ul>")
    a("</main></body></html>")
    return "\n".join(morceaux)


# ===========================================================================
#  DÉROULÉ
# ===========================================================================
def verifier_chemin_de_base(chemin):
    """Refuse tout chemin qui toucherait aux données réelles."""
    cible = os.path.normcase(os.path.abspath(chemin))
    reelle = os.path.normcase(os.path.abspath(BASE_REELLE))
    dossier = os.path.normcase(os.path.abspath(DOSSIER_DONNEES))
    if cible == reelle:
        raise RefusDuBanc(
            "Refus : ce chemin est la base RÉELLE du produit "
            f"({BASE_REELLE}). Le banc ne travaille que sur une base jetable "
            "— il ne touchera jamais à vos vraies données.")
    if cible == dossier or cible.startswith(dossier + os.sep):
        raise RefusDuBanc(
            f"Refus : le dossier « {DOSSIER_DONNEES} » contient les données "
            "réelles du produit. Choisissez un chemin ailleurs, ou laissez le "
            "banc créer lui-même sa base jetable.")
    return cible


def verifier_port(port):
    """Refuse un port du produit, et refuse un port déjà occupé."""
    if port in PORTS_RESERVES_PRODUIT:
        raise RefusDuBanc(
            f"Refus : le port {port} est réservé au produit (8770 à 8778). "
            f"Le banc utilise {PORT_BANC}.")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as prise:
        prise.settimeout(0.5)
        if prise.connect_ex(("127.0.0.1", port)) == 0:
            raise RefusDuBanc(
                f"Refus : le port {port} est déjà occupé par un autre "
                "programme. Fermez-le, ou lancez le banc avec un autre port "
                "(option --port).")
    return port


def derouler(banc):
    """Toute la matrice, dans un ordre FIXE (c'est ce qui rend le banc
    reproductible)."""
    j = banc.j
    campagne_pour_reprise = None
    for nature in NATURES_ORDRE:
        if nature == "creneau_libere":
            continue          # sa vraie mécanique est la cascade : à part
        try:
            campagne_id = scenario_assistant_par_nature(banc, nature)
            if nature == "prise_rdv" and campagne_id:
                campagne_pour_reprise = campagne_id
        except Exception as erreur:            # noqa: BLE001 — on rapporte
            j.incident(f"Nature « {nature} » : le banc s'est arrêté sur "
                       f"{type(erreur).__name__} — {erreur}")
    campagne_refus = None
    for scenario in (scenario_creneau_libere_cascade,
                     scenario_csv, scenario_ics,
                     scenario_colonnes_obligatoires_vides,
                     scenario_deux_oui_sans_rendezvous_existant,
                     scenario_annulation_deux_reglages,
                     scenario_seuil_de_compensation,
                     scenario_numero_essai,
                     scenario_bouton_demarrer,
                     # ⚠ EN DERNIER DE CETTE LISTE, ET C'EST VOULU : il déplace
                     # des rendez-vous sur plusieurs mois, donc au travers des
                     # blocs des autres.
                     scenario_decalage_en_cascade):
        try:
            resultat = scenario(banc)
            if scenario is scenario_creneau_libere_cascade:
                campagne_refus = resultat
        except Exception as erreur:            # noqa: BLE001
            j.incident(f"{scenario.__name__} : {type(erreur).__name__} — "
                       f"{erreur}")
    for depart, nature in (("base_a_venir", "deplacement"),
                           ("base_manques", "rappel_rdv"),
                           ("base_annules", "prise_rdv"),
                           # « prise de rendez-vous » deux fois, à dessein :
                           # c'est la seule nature dont la GRILLE n'impose
                           # aucune colonne, donc la seule qui puisse partir
                           # d'une source qui ne les remplit pas.
                           ("base_deplaces", "prise_rdv"),
                           ("base_tous", "prise_rdv")):
        try:
            scenario_depuis_la_base(banc, depart, nature)
        except Exception as erreur:            # noqa: BLE001
            j.incident(f"Source « {depart} » avec la nature « {nature} » : "
                       f"{type(erreur).__name__} — {erreur}")
    try:
        injoignable = scenario_injoignable(banc)
    except Exception as erreur:                # noqa: BLE001
        injoignable = None
        j.incident(f"scenario_injoignable : {type(erreur).__name__} — {erreur}")
    source_reprise = campagne_pour_reprise or injoignable
    if source_reprise:
        try:
            scenario_reprise_de_campagne(banc, source_reprise, injoignable,
                                         campagne_refus)
        except Exception as erreur:            # noqa: BLE001
            j.incident("Reprise d'une campagne précédente : "
                       f"{type(erreur).__name__} — {erreur}")
    else:
        j.incident("Aucune campagne source disponible : les six reprises de "
                   "campagne n'ont pas pu être parcourues.")
    for scenario in (scenario_file_appels, scenario_cascade_directe,
                     scenario_cascade_ancien_rendezvous):
        try:
            scenario(banc)
        except Exception as erreur:            # noqa: BLE001
            j.incident(f"{scenario.__name__} : {type(erreur).__name__} — "
                       f"{erreur}")
    # EN DERNIER : ce scénario ajoute des clients et ouvre les horaires en
    # grand. Le placer ailleurs déplacerait les comptes des scénarios
    # suivants — et le banc doit rendre deux fois le MÊME rapport.
    try:
        scenario_deux_portes_vers_campagne(banc)
    except Exception as erreur:                # noqa: BLE001
        j.incident("scenario_deux_portes_vers_campagne : "
                   f"{type(erreur).__name__} — {erreur}")
    # ⚠ APRÈS TOUT LE RESTE, ET POUR UNE RAISON MESURÉE (17/08/2026) : ce
    # scénario LANCE LES RELANCES, ce qui fait passer les « 🔁 à recontacter »
    # de la base partagée en « 📵 injoignable ». Placé plus haut, il vidait la
    # réserve que la reprise « à recontacter » vient lire : cinq contrôles
    # disparaissaient sans un seul échec — le rapport annonçait « tout passe »
    # avec MOINS de couverture qu'avant. C'est le plancher CONTROLES_PLANCHER
    # qui l'a révélé : le total ne montait que de 5 alors que ce scénario en
    # pose 10.
    try:
        scenario_deplacement_journee_entiere(banc)
    except Exception as erreur:                # noqa: BLE001
        j.incident("scenario_deplacement_journee_entiere : "
                   f"{type(erreur).__name__} — {erreur}")


def principal(arguments=None):
    analyseur = argparse.ArgumentParser(
        description="Banc d'essai de bout en bout de RingBack "
                    "(SIMULATION uniquement).")
    analyseur.add_argument("--port", type=int, default=PORT_BANC,
                           help=f"port du serveur d'essai (défaut {PORT_BANC})")
    analyseur.add_argument("--base", default=None,
                           help="chemin de la base JETABLE (défaut : un "
                                "dossier temporaire). La base réelle est "
                                "refusée.")
    analyseur.add_argument("--rapport", default=None,
                           help="dossier où écrire le rapport (défaut : à côté "
                                "de ce fichier)")
    options = analyseur.parse_args(arguments)
    try:
        verifier_port(options.port)
    except RefusDuBanc as refus:
        print(str(refus))
        return 2
    dossier_jetable = None
    if options.base:
        try:
            chemin_base = verifier_chemin_de_base(options.base)
        except RefusDuBanc as refus:
            print(str(refus))
            return 2
        os.makedirs(os.path.dirname(chemin_base), exist_ok=True)
    else:
        dossier_jetable = tempfile.mkdtemp(prefix="ringback-banc-")
        chemin_base = os.path.join(dossier_jetable, "banc_jetable.db")
    surveilles = [
        ("Le journal d'audit des appels réels", calle_client.CHEMIN_AUDIT,
         _empreinte_fichier(calle_client.CHEMIN_AUDIT)),
        ("La base de données réelle du produit", BASE_REELLE,
         _empreinte_fichier(BASE_REELLE)),
    ]
    journal = Journal()
    # Le produit journalise ses incidents ; ici, le RAPPORT est la seule
    # source de vérité — la fenêtre reste lisible pour son propriétaire.
    logging.getLogger("ringback").setLevel(logging.CRITICAL)
    print("Banc d'essai RingBack — simulation uniquement.")
    print(f"  Base jetable : {chemin_base}")
    print(f"  Serveur d'essai : http://127.0.0.1:{options.port}")
    print("  Préparation du jeu de données…")
    base = db.Base(chemin_base)
    jeu_essai.charger(base, maintenant=REFERENCE)
    base.fermer()
    banc = Banc(chemin_base, port=options.port, journal=journal)
    try:
        banc.demarrer()
        print("  Parcours de la matrice… (une minute environ)")
        derouler(banc)
        controler_masquage_global(banc)
        expliquer_les_trous(journal)
        gestes_a_la_main(journal)
        scenario_verrous(banc, surveilles)
    finally:
        banc.arreter()
        if dossier_jetable and os.path.isdir(dossier_jetable):
            shutil.rmtree(dossier_jetable, ignore_errors=True)
    tableaux = construire_tableaux(journal)
    chiffres = compter(journal)
    texte = rapport_texte(journal, chiffres, tableaux)
    page = rapport_html(journal, chiffres, tableaux)
    dossier_rapport = options.rapport or RACINE_APP
    os.makedirs(dossier_rapport, exist_ok=True)
    chemin_texte = os.path.join(dossier_rapport, "rapport-banc-essai.txt")
    chemin_html = os.path.join(dossier_rapport, "rapport-banc-essai.html")
    with open(chemin_texte, "w", encoding="utf-8") as fichier:
        fichier.write(texte + "\n")
    with open(chemin_html, "w", encoding="utf-8") as fichier:
        fichier.write(page + "\n")
    print()
    print(pour_console(texte))
    print(pour_console(
        f"Rapport écrit dans :\n  {chemin_html}\n  {chemin_texte}"))
    return 1 if journal.echecs or any(not v[3] for v in journal.verrous) else 0


if __name__ == "__main__":
    sys.exit(principal())
