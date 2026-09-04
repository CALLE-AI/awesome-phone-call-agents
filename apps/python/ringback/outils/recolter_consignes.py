# -*- coding: utf-8 -*-
"""Harvest the sentences of the PHONE BRIEFING, as they actually go out.

⚠ WHAT GOES OUT IS HARVESTED, NOT WHAT IS WRITTEN IN THE CODE. A briefing is
assembled from a template for its kind, the behaviour options, the step-2
information and the settings: reading the sources would say neither which
combinations really exist, nor how the pieces glue back together. So REAL
briefings are built — the five kinds, every option, both genres (classic and
cascade) — and their lines are recorded.

Same principle as `recolter_phrases.py` for the screens, and for the same
reason: what is not produced cannot be translated blind.

Usage: python outils/recolter_consignes.py # the report python
outils/recolter_consignes.py --json f # the whole harvest
"""

import argparse
import collections
import itertools
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ringback import (assistant, consigne as mod_consigne,  # noqa: E402
                      generation, horaires, themes)

# The behaviour options that CHANGE the text: every combination is crossed.
OPTIONS = ("liberer_creneau", "cascade", "proposer_autre_date",
           "annuler_si_absent", "confirmer_deplacement")


def _preferences():
    prefs = generation.Preferences()
    for jour in range(7):
        horaires.basculer_periode(prefs, jour, 8 * 60, 19 * 60, "ouvrir")
    prefs.definir(themes.CLE_PLAGE_DEBUT, "00:00")
    prefs.definir(themes.CLE_PLAGE_FIN, "23:59")
    prefs.definir(themes.CLE_ENTREPRISE, "Cabinet Essai")
    return prefs


def _infos(nature):
    """A plausible value for each step-2 piece of information of the kind."""
    valeurs = {}
    for info in assistant.NATURES[nature]["infos"]:
        code, genre = info["code"], info.get("type")
        if genre == "date":
            valeurs[code] = "2026-09-15T09:40"
        elif code == "entreprise":
            valeurs[code] = "Cabinet Essai"
        else:
            valeurs[code] = info.get("exemple") or "à préciser"
    return valeurs


def recolter():
    """(lines by origin, counter) — every possible briefing."""
    prefs = _preferences()
    compteur = collections.Counter()
    par_nature = collections.defaultdict(set)
    for nature in assistant.NATURES:
        infos = _infos(nature)
        for combinaison in itertools.product((False, True), repeat=len(OPTIONS)):
            options = dict(zip(OPTIONS, combinaison))
            for genre in (mod_consigne.GENRE_CLASSIQUE,
                          mod_consigne.GENRE_CASCADE):
                try:
                    fiche = assistant.construire_consigne(
                        nature, infos, prefs, options, genre=genre)
                except Exception:                        # noqa: BLE001
                    continue
                lignes = ([fiche.entete, fiche.presentation, fiche.objectif]
                          + list(fiche.faits) + list(fiche.conduite)
                          + list(fiche.contraintes)
                          + [f["quand"] for f in fiche.issues.values()])
                for ligne in lignes:
                    ligne = (ligne or "").strip()
                    if ligne:
                        compteur[ligne] += 1
                        par_nature[nature].add(ligne)
    # ⚠ AND THE RAW TEMPLATES, segment by segment. An assembled briefing shows
    # only the segments whose condition was true: the ones depending on ABSENT
    # information never appear above. So NATURES is walked as well, where they
    # are written.
    def _texte_profond(valeur, nature):
        if isinstance(valeur, str):
            propre = valeur.strip()
            if len(propre) > 3 and any(c.isalpha() for c in propre):
                compteur[propre] += 1
                par_nature[nature].add(propre)
        elif isinstance(valeur, dict):
            for cle, sous in valeur.items():
                if cle in ("code", "type", "genre", "politique", "icone",
                           "ordre_defaut", "reglage", "code_sans_date",
                           "date"):
                    continue
                _texte_profond(sous, nature)
        elif isinstance(valeur, (list, tuple)):
            for sous in valeur:
                _texte_profond(sous, nature)

    for nature, definition in assistant.NATURES.items():
        _texte_profond(definition, nature)

    # The module's own fixed sentences, the ones no kind carries.
    for nom in dir(mod_consigne):
        if not nom.isupper():
            continue
        valeur = getattr(mod_consigne, nom)
        if isinstance(valeur, str) and len(valeur.strip()) > 3:
            compteur[valeur.strip()] += 1
            par_nature["_module"].add(valeur.strip())
        elif isinstance(valeur, tuple):
            for element in valeur:
                if isinstance(element, str) and len(element.strip()) > 3:
                    compteur[element.strip()] += 1
                    par_nature["_module"].add(element.strip())
    return par_nature, compteur


def principal():
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("--json", default=None)
    options = analyseur.parse_args()

    par_nature, compteur = recolter()
    print(f"{sum(compteur.values()):,} lignes produites, "
          f"{len(compteur):,} DISTINCTES")
    print(f"{sum(len(p.split()) for p in compteur):,} mots distincts\n")
    for nature in sorted(par_nature):
        print(f"  {nature:20s} {len(par_nature[nature]):4d} lignes distinctes")

    if options.json:
        with open(options.json, "w", encoding="utf-8") as fichier:
            json.dump({"par_nature": {k: sorted(v)
                                      for k, v in par_nature.items()},
                       "occurrences": dict(compteur)},
                      fichier, ensure_ascii=False, indent=1)
        print(f"\nRécolte écrite dans {options.json}")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
