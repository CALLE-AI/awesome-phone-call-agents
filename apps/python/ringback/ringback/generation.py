"""Building the cascade list FROM the database + preferences.

No more pasting a list by hand: you pick a SOURCE (cancelled appointments,
pending moves, or every client) and a CALLING ORDER. Rule requested by the user
(decision of 27/07): NO order is imposed by default — the choice of order is
explicit at every generation; only the LAST choice is remembered (a small
preferences file in donnees/, never hard-coded) so it can be pre-selected next
time.

The generated lists (paste area, CSV export) carry the numbers IN CLEAR: that
is their whole purpose, at the user's explicit request — the equivalent of what
they would paste themselves. Clients WITHOUT a number (an ICS import never
completed) are excluded and counted separately.
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

# French honorifics are ignored for alphabetical sorting (otherwise every `Mme`
# would sort together) — the displayed name itself stays complete.
_CIVILITE = re.compile(r"^(m\.|mme|mlle|mr|dr)\s+", re.IGNORECASE)


def generer(base, source, ordre, creneau=None):
    """Builds the cascade list from the database; returns (people, excluded).

    people = [{"nom", "telephone"}] in the CHOSEN order (numbers in clear — see
    the module header); excluded = how many clients were set aside for having
    no number. Raises SaisieInvalide (French message) if the source or the
    order is invalid, if no order was chosen, or if the `proximité` order is
    asked for without a slot.
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
        # ISO 8601 reference: sorting the text follows chronological order; a
        # candidate with no reference goes to the end of the list.
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
    """Sort key: no honorific, no accents, no case."""
    sans_civilite = _CIVILITE.sub("", nom.strip())
    decompose = unicodedata.normalize("NFD", sans_civilite.casefold())
    return "".join(c for c in decompose if not unicodedata.combining(c))


def en_liste_collable(personnes):
    """The list in paste-area format: `Name;Phone`, one per line."""
    return "\n".join(f"{p['nom']};{p['telephone']}" for p in personnes)


def en_csv(personnes):
    """The CSV content `nom;telephone` (Windows line endings, for Excel).

    The file is served on the fly and is NEVER written server-side; the byte
    order mark (BOM) is added by the caller through the encoding (utf-8-sig).
    """
    lignes = ["nom;telephone"] + [f"{p['nom']};{p['telephone']}" for p in personnes]
    return "\r\n".join(lignes) + "\r\n"


class Preferences:
    """A small JSON preferences file (e.g. donnees/preferences.json).

    chemin=None: preferences held in memory only (tests, :memory: database). An
    unreadable file is ignored and rewritten at the next save — never an error
    screen for a convenience file.
    """

    def __init__(self, chemin=None):
        self.chemin = chemin
        self._donnees = {}
        # The web server answers several pages at once: two simultaneous
        # settings saves would write the file over each other, and leave it
        # half-written. The lock makes them go through one at a time.
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
