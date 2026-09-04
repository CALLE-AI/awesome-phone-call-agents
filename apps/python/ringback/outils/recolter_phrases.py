# -*- coding: utf-8 -*-
"""Harvest the interface sentences, from the REAL pages of the product.

⚠ THIS IS NOT A STRING EXTRACTOR, AND THAT IS THE WHOLE POINT. A tool reading
the source would miss the sentences assembled at run time — measured on this
product: 565 of the texts the tests assert exist nowhere in the sources as
such. So the product is explored like a visitor: start at the home page, follow
every internal link, and record what is actually displayed.

WHAT IT DOES, exactly:

1. starts a RingBack server on a free port, IN-MEMORY database, sample data set loaded — never the real database, never the product's port;
2. explores by following links, both as a full page AND as a window (the `X-RingBack-Fragment` header, because the product answers the two differently);
3. records the sentences through `langue.phrases_de`;
4. says which ones the dictionary already knows, and which are missing.

⚠ IT PLACES NO CALL and submits no form: it only issues GETs, and the product
reserves POST for everything that changes anything.

⚠ AND THAT IS ALSO ITS LIMIT — ONE THAT COST DEARLY (01/09/2026). Exploring by
GET from an EMPTY database never shows: a filled table, a campaign record, a
modal, an error message (that needs a faulty input), a warning (that needs a
particular state). The tool announced `96.6 % of the text` — true of what it
reached, and false of the product: 1,625 sentences had never been seen, and the
user saw them himself, by using it.

**So it now counts BOTH**: what it reaches, and what the sources contain. A figure that can no longer flatter.

Usage: python outils/recolter_phrases.py # the report python
outils/recolter_phrases.py --manquantes # what is left to translate python
outils/recolter_phrases.py --json fichier # the whole harvest
"""

import argparse
import collections
import json
import os
import re
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ringback import langue, serveur, traductions  # noqa: E402

LIEN = re.compile(r'href="(/[^"#]*)"')
# The URLs that return no interface text: images, exports.
SANS_INTERET = re.compile(r"^/(image/|.*\.(png|ico|csv|ics|json)$)")
PLAFOND = 400


def _adresses_du_code():
    """The URLs written in the code — the seeds of the exploration.

    ⚠ FOLLOWING LINKS IS NOT ENOUGH. A screen no link points to (an error page,
    a URL typed by hand, a window opened by a script) would stay invisible, and
    therefore never translated. So the exploration is seeded with every URL the
    code declares, on top of the home page.
    """
    trouvees = {"/"}
    dossier = os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "ringback")
    for nom in ("serveur.py", "assistant_web.py"):
        with open(os.path.join(dossier, nom), encoding="utf-8") as fichier:
            texte = fichier.read()
        trouvees |= set(re.findall(r'url\.path == "([^"]+)"', texte))
        trouvees |= set(re.findall(r'chemin == "([^"]+)"', texte))
    return sorted(trouvees)


def _explorer(base_url, depart=None):
    """Every page reachable from `depart`, by following the links."""
    a_voir, vues, pages = list(depart or _adresses_du_code()), set(), {}
    while a_voir and len(vues) < PLAFOND:
        chemin = a_voir.pop(0)
        if chemin in vues or SANS_INTERET.match(chemin):
            continue
        vues.add(chemin)
        for fenetre in (False, True):
            entetes = {"X-RingBack-Fragment": "1"} if fenetre else {}
            demande = urllib.request.Request(base_url + chemin,
                                             headers=entetes)
            try:
                with urllib.request.urlopen(demande, timeout=15) as reponse:
                    if "text/html" not in reponse.headers.get(
                            "Content-Type", ""):
                        break
                    page = reponse.read().decode("utf-8")
            except (urllib.error.HTTPError, urllib.error.URLError, OSError):
                continue
            pages[chemin + ("#fenetre" if fenetre else "")] = page
            if not fenetre:
                for trouve in LIEN.findall(page):
                    lien = urllib.parse.urljoin(chemin, trouve)
                    if lien not in vues:
                        a_voir.append(lien)
    return pages


def recolter():
    """(pages, sentence counter) — the product explored for real."""
    http = serveur.creer_serveur(port=0, chemin_base=":memory:",
                                 appels_reels=False)
    fil = threading.Thread(target=http.serve_forever, daemon=True)
    fil.start()
    try:
        base_url = f"http://127.0.0.1:{http.server_address[1]}"
        pages = _explorer(base_url)
    finally:
        http.shutdown()
        http.server_close()
    compteur = collections.Counter()
    for page in pages.values():
        compteur.update(langue.phrases_de(page))
    return pages, compteur


def principal():
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("--manquantes", action="store_true",
                           help="n'écrire que les phrases non traduites")
    analyseur.add_argument("--langue", default=langue.ANGLAIS)
    analyseur.add_argument("--json", default=None,
                           help="écrire la récolte entière dans ce fichier")
    options = analyseur.parse_args()

    pages, compteur = recolter()
    table = traductions.table(options.langue)
    connues = [p for p in compteur if langue.phrase_traduite(p, table, traductions.motifs(options.langue)) is not None]
    manquantes = [p for p in compteur if langue.phrase_traduite(p, table, traductions.motifs(options.langue)) is None]

    if options.manquantes:
        for phrase in sorted(manquantes, key=lambda p: -compteur[p]):
            print(json.dumps(phrase, ensure_ascii=False))
        return 0

    if options.json:
        with open(options.json, "w", encoding="utf-8") as fichier:
            json.dump({"pages": {c: langue.phrases_de(p)
                                 for c, p in pages.items()},
                       "occurrences": dict(compteur),
                       "manquantes": sorted(manquantes)},
                      fichier, ensure_ascii=False, indent=1)

    total = len(compteur)
    couvert = 100 * len(connues) / total if total else 0
    vues = sum(compteur.values())
    vues_couvertes = sum(compteur[p] for p in connues)
    print(f"{len(pages)} pages explorées, "
          f"{sum(len(p) for p in pages.values()):,} caractères")
    print(f"{vues:,} phrases affichées, {total:,} distinctes")
    print()
    print(f"  dictionnaire {options.langue} : "
          f"{traductions.compte(options.langue):,} entrées")
    print(f"  couverture (phrases distinctes) : {len(connues):,}/{total:,} "
          f"= {couvert:.1f} %")
    print(f"  couverture (ce qu'on VOIT à l'écran) : "
          f"{vues_couvertes:,}/{vues:,} = "
          f"{100 * vues_couvertes / vues if vues else 0:.1f} %")
    # ⚠ AND THE FIGURE THAT REALLY COUNTS: over what is TEXT. One-letter
    # markers and numeric badges are not translated, and counting them makes
    # the measure lie — see `langue.est_du_texte`.
    texte_connu = sum(compteur[p] for p in connues if langue.est_du_texte(p))
    texte_total = sum(compteur[p] for p in compteur if langue.est_du_texte(p))
    print(f"  couverture DU TEXTE (hors symboles et chiffres) : "
          f"{texte_connu:,}/{texte_total:,} = "
          f"{100 * texte_connu / texte_total if texte_total else 0:.1f} %")
    if manquantes:
        print(f"\nLes 15 manques les plus visibles :")
        for phrase in sorted(manquantes,
                             key=lambda p: -compteur[p])[:15]:
            court = phrase if len(phrase) <= 66 else phrase[:63] + "…"
            print(f"   {compteur[phrase]:4d}x  {court!r}")

    # ⚠ AND THE FIGURE THAT DOES NOT FLATTER: everything the sources write,
    # including what no exploration can reach.
    ecrites, absentes = _dans_les_sources(options.langue)
    print()
    print(f"  DANS LES SOURCES (y compris ce qu'on n'atteint pas en "
          f"explorant) :")
    print(f"    {ecrites:,} phrases françaises écrites, "
          f"{len(absentes):,} NON traduites")
    if absentes:
        print(f"    exemples : "
              f"{[p[:44] for p in sorted(absentes)[:3]]}")
    return 0


# ---------------------------------------------------------------------------
# The second measure: the sources
# ---------------------------------------------------------------------------
_ACCENTS = "éèêëàâäîïôöûùüÿçœÉÈÊËÀÂÄÎÏÔÖÛÙÜÇŒ"
_MOTS_FR = re.compile(
    r"\b(?:le|la|les|un|une|des|du|de|au|aux|ce|cette|ces|il|elle|vous|nous|"
    r"est|sont|pas|plus|que|qui|pour|dans|avec|sur|par|son|sa|ses|leur|"
    r"aucun|aucune|jamais|toujours|donc|mais|ou|et|si|quand|comme)\b",
    re.IGNORECASE)
_TECHNIQUE = re.compile(
    r"^(?:[a-z0-9_.\-/:%]+|https?://.*|SELECT .*|INSERT .*|UPDATE .*|"
    r"DELETE .*|CREATE .*|PRAGMA .*|[A-Z_]+)$")
_BALISE = re.compile(r"^</?[a-z]+[^>]*>$", re.IGNORECASE)
_TROU = re.compile(r"\{[^}]*\}|\[[a-z_]+\]")
# The DATA files: their text is not interface text, it follows the language by
# another path (jeu_essai.decor) or is not displayed at all.
_HORS_INTERFACE = ("traductions.py", "jeu_essai.py", "agenda_exemple.py",
                   "generation.py", "ics.py")


def _est_du_texte_visible(valeur):
    nu = valeur.strip()
    if len(nu) < 4 or _TECHNIQUE.match(nu) or _BALISE.match(nu):
        return False
    sans = re.sub(r"\{[^}]*\}", " ", re.sub(r"<[^>]+>", " ", nu))
    if not re.search(r"[^\W\d_]{2,}", sans):
        return False
    return bool(any(c in _ACCENTS for c in sans)
                or len(_MOTS_FR.findall(sans)) >= 2)


def _dans_les_sources(langue_code):
    """(how many written, the ones missing) — the measure that does not flatter.
    """
    import ast
    table = traductions.table(langue_code)
    motifs = traductions.motifs(langue_code)
    consignes = traductions.table_consigne(langue_code)
    dossier = os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "ringback")
    ecrites, absentes = 0, set()
    for nom in sorted(os.listdir(dossier)):
        if not nom.endswith(".py") or nom in _HORS_INTERFACE:
            continue
        with open(os.path.join(dossier, nom), encoding="utf-8") as fichier:
            arbre = ast.parse(fichier.read())
        docs = set()
        for noeud in ast.walk(arbre):
            corps = getattr(noeud, "body", None)
            if (isinstance(noeud, (ast.Module, ast.ClassDef, ast.FunctionDef,
                                   ast.AsyncFunctionDef))
                    and corps and isinstance(corps[0], ast.Expr)
                    and isinstance(corps[0].value, ast.Constant)
                    and isinstance(corps[0].value.value, str)):
                docs.add(id(corps[0].value))
        for noeud in ast.walk(arbre):
            if (not isinstance(noeud, ast.Constant)
                    or not isinstance(noeud.value, str)
                    or id(noeud) in docs):
                continue
            # ⚠ THE PRODUCT'S OWN TOOL DOES THE SPLITTING. A string in the code
            # is not a sentence: it is often a piece of HTML containing
            # several, or none. `langue.phrases_de` returns exactly the slices
            # the translator will look for at run time — measuring anything
            # else means counting keys that will never exist.
            morceaux = list(langue.phrases_de(noeud.value) or [])
            if "<" not in noeud.value:
                morceaux.append(noeud.value)
            for morceau in morceaux:
                nu = morceau.strip()
                # ⚠ AND SENTENCES WITH HOLES ARE SET ASIDE: `{compte}`,
                # `[identite]` never appear on screen as such, the hole is
                # filled before display. That is the job of the RULES, not of a
                # dictionary entry.
                if _TROU.search(nu) or not _est_du_texte_visible(nu):
                    continue
                ecrites += 1
                if (langue.phrase_traduite(nu, table, motifs) is None
                        and nu not in consignes):
                    absentes.add(nu)
    return ecrites, absentes


if __name__ == "__main__":
    sys.exit(principal())
