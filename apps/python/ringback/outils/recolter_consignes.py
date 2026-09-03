# -*- coding: utf-8 -*-
"""Récolter les phrases de la CONSIGNE téléphonique, telles qu'elles partent.

⚠ ON RÉCOLTE CE QUI PART, PAS CE QUI EST ÉCRIT DANS LE CODE. Une consigne est
assemblée à partir d'un gabarit de nature, des options de comportement, des
informations d'étape 2 et des réglages : lire les sources ne dirait ni quelles
combinaisons existent réellement, ni comment les morceaux se recollent. On
construit donc de VRAIES consignes — les cinq natures, toutes les options, les
deux genres (classique et cascade) — et l'on relève leurs lignes.

C'est le même principe que `recolter_phrases.py` pour les écrans, et pour la
même raison : ce qui n'est pas produit ne peut pas être traduit à l'aveugle.

Usage :
    python outils/recolter_consignes.py            # le compte rendu
    python outils/recolter_consignes.py --json f   # la récolte entière
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

# Les options de comportement qui CHANGENT le texte : on les croise toutes.
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
    """Une valeur plausible pour chaque information d'étape 2 de la nature."""
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
    """(lignes par origine, compteur) — toutes les consignes possibles."""
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
    # ⚠ ET LES GABARITS BRUTS, segment par segment. Une consigne assemblee
    # ne montre que les segments dont la condition etait vraie : ceux qui
    # dependent d'une information ABSENTE ne paraissent jamais ci-dessus. On
    # descend donc aussi dans NATURES, ou ils sont ecrits.
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

    # Les phrases fixes du module lui-même, celles qu'aucune nature ne porte.
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
