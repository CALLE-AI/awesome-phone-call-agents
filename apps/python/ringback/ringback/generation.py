"""Génération de la liste de cascade DEPUIS la base + préférences.

Plus besoin de coller une liste à la main : on choisit une SOURCE
(rendez-vous annulés, déplacés en attente, ou tous les clients) et un
ORDRE d'appel. Règle voulue par l'utilisateur (décision du 27/07) :
AUCUN ordre n'est imposé par défaut — le choix de l'ordre est explicite à
chaque génération ; seul le DERNIER choix est mémorisé (petit fichier de
préférences dans donnees/, jamais codé en dur) pour être présélectionné
les fois suivantes.

Les listes générées (zone de collage, export CSV) contiennent les numéros
EN CLAIR : c'est leur raison d'être, à la demande explicite de
l'utilisateur — l'équivalent de ce qu'il collerait lui-même. Les clients
SANS numéro (import ICS pas complété) sont exclus et comptés à part.
"""

import datetime
import json
import logging
import os
import threading
import re
import unicodedata

from .saisie import SaisieInvalide

journal = logging.getLogger("ringback.generation")

SOURCES = {
    "annules": "Rendez-vous annulés",
    "deplaces": "Déplacés en attente (sans rendez-vous à venir)",
    "tous": "Tous les clients",
}

ORDRES = {
    "anciennete": "Ancienneté — le rendez-vous concerné le plus ancien d'abord",
    "proximite": "Proximité du créneau proposé — le plus proche d'abord",
    "alphabetique": "Alphabétique — par nom",
}

# Civilités françaises ignorées pour le tri alphabétique (sinon toutes les
# « Mme » se suivraient) — le nom affiché, lui, reste complet.
_CIVILITE = re.compile(r"^(m\.|mme|mlle|mr|dr)\s+", re.IGNORECASE)


def generer(base, source, ordre, creneau=None):
    """Construit la liste de cascade depuis la base ; rend (personnes, exclus).

    personnes = [{"nom", "telephone"}] dans l'ordre CHOISI (numéros en
    clair — voir l'en-tête du module) ; exclus = nombre de clients sans
    numéro écartés. Lève SaisieInvalide (message français) si la source ou
    l'ordre est invalide, si aucun ordre n'est choisi, ou si l'ordre
    « proximité » est demandé sans créneau.
    """
    if source not in SOURCES:
        raise SaisieInvalide(f"Source inconnue : « {source} ».")
    if not ordre:
        raise SaisieInvalide("Choisissez un ordre d'appel : aucun ordre "
                             "n'est imposé par défaut — la décision vous revient.")
    if ordre not in ORDRES:
        raise SaisieInvalide(f"Ordre d'appel inconnu : « {ordre} ».")
    if ordre == "proximite" and not creneau:
        raise SaisieInvalide("L'ordre « proximité du créneau proposé » demande "
                             "de remplir d'abord le champ « créneau proposé ».")
    candidats, exclus, exclus_stop = base.candidats_cascade(source)
    tries = _trier(candidats, ordre, creneau)
    journal.info("Liste générée : source %s, ordre %s, %d personne(s), "
                 "%d sans numéro exclue(s), %d 🚫 « ne plus appeler » "
                 "exclu(s)", source, ordre, len(tries), exclus, exclus_stop)
    return ([{"nom": c["nom"], "telephone": c["telephone"]} for c in tries],
            exclus)


def _trier(candidats, ordre, creneau):
    if ordre == "anciennete":
        # Référence ISO 8601 : le tri de texte suit l'ordre chronologique ;
        # un candidat sans référence passe en fin de liste.
        return sorted(candidats, key=lambda c: (not c["reference"], c["reference"]))
    if ordre == "proximite":
        creneau_dt = datetime.datetime.fromisoformat(creneau)

        def ecart(candidat):
            if not candidat["reference"]:
                return (True, datetime.timedelta(0))
            reference = datetime.datetime.fromisoformat(candidat["reference"])
            return (False, abs(reference - creneau_dt))
        return sorted(candidats, key=ecart)
    return sorted(candidats, key=lambda c: _cle_alphabetique(c["nom"]))


def _cle_alphabetique(nom):
    """Clé de tri : sans civilité, sans accents, sans casse."""
    sans_civilite = _CIVILITE.sub("", nom.strip())
    decompose = unicodedata.normalize("NFD", sans_civilite.casefold())
    return "".join(c for c in decompose if not unicodedata.combining(c))


def en_liste_collable(personnes):
    """La liste au format de la zone de collage : « Nom;Téléphone », une par ligne."""
    return "\n".join(f"{p['nom']};{p['telephone']}" for p in personnes)


def en_csv(personnes):
    """Le contenu CSV « nom;telephone » (fins de ligne Windows, pour Excel).

    Le fichier est servi à la volée et n'est JAMAIS écrit côté serveur ;
    l'octet d'ordre (BOM) est ajouté à l'encodage (utf-8-sig) par l'appelant.
    """
    lignes = ["nom;telephone"] + [f"{p['nom']};{p['telephone']}" for p in personnes]
    return "\r\n".join(lignes) + "\r\n"


class Preferences:
    """Petit fichier JSON de préférences (ex. donnees/preferences.json).

    chemin=None : préférences en mémoire seulement (tests, base :memory:).
    Un fichier illisible est ignoré et récrit à la prochaine sauvegarde —
    jamais d'écran d'erreur pour un fichier de confort.
    """

    def __init__(self, chemin=None):
        self.chemin = chemin
        self._donnees = {}
        # Le serveur web répond à plusieurs pages en même temps : deux
        # enregistrements de réglages simultanés écriraient le fichier l'un
        # par-dessus l'autre, et le laisseraient à moitié écrit. Le verrou
        # les fait passer un par un.
        self._verrou = threading.Lock()
        if chemin and os.path.exists(chemin):
            try:
                with open(chemin, encoding="utf-8") as fichier:
                    donnees = json.load(fichier)
                if isinstance(donnees, dict):
                    self._donnees = donnees
            except (OSError, json.JSONDecodeError):
                journal.warning("Fichier de préférences illisible (%s) : "
                                "on repart de zéro.", chemin)

    def obtenir(self, cle, defaut=None):
        return self._donnees.get(cle, defaut)

    def definir(self, cle, valeur):
        with self._verrou:
            self._donnees[cle] = valeur
            if self.chemin:
                dossier = os.path.dirname(self.chemin)
                if dossier:
                    os.makedirs(dossier, exist_ok=True)
                with open(self.chemin, "w", encoding="utf-8") as fichier:
                    json.dump(self._donnees, fichier, ensure_ascii=False,
                              indent=2)
