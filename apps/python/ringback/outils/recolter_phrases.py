# -*- coding: utf-8 -*-
"""Récolter les phrases de l'interface, sur les VRAIES pages du produit.

⚠ CE N'EST PAS UN EXTRACTEUR DE CHAÎNES, ET C'EST TOUT L'INTÉRÊT. Un outil qui
lirait le code source manquerait les phrases assemblées à l'exécution — mesuré
sur ce produit : 565 des textes que les essais affirment n'existent nulle part
tels quels dans les sources. On explore donc le produit comme un visiteur : on
part de l'accueil, on suit tous les liens internes, et on relève ce qui
s'affiche vraiment.

CE QU'IL FAIT, exactement :

1. démarre un serveur RingBack sur un port libre, base EN MÉMOIRE, jeu d'essai
   chargé — jamais la base réelle, jamais le port du produit ;
2. explore en suivant les liens, en page entière ET en fenêtre (l'en-tête
   « X-RingBack-Fragment », car le produit répond différemment aux deux) ;
3. relève les phrases par `langue.phrases_de` ;
4. dit lesquelles le dictionnaire connaît déjà, et lesquelles manquent.

⚠ IL NE PASSE AUCUN APPEL et n'envoie aucun formulaire : il ne fait que des
GET, et le produit réserve aux POST tout ce qui change quelque chose.

⚠ ET C'EST AUSSI SA LIMITE — ELLE A COÛTÉ CHER (01/09/2026). Explorer en GET
depuis une base VIDE ne montre jamais : un tableau rempli, une fiche de
campagne, une modale, un message d'erreur (il faut une saisie fautive), un
avertissement (il faut un état particulier). L'outil annonçait « 96,6 % du
texte » — c'était vrai de ce qu'il atteignait, et faux du produit : il restait
1 625 phrases jamais vues, et l'utilisateur les a vues, lui, en s'en servant.

**Il compte donc maintenant les DEUX** : ce qu'il atteint, et ce que les
sources contiennent. Un chiffre qui ne peut plus flatter.

Usage :
    python outils/recolter_phrases.py                 # le compte rendu
    python outils/recolter_phrases.py --manquantes    # ce qui reste à traduire
    python outils/recolter_phrases.py --json fichier  # la récolte entière
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
# Les adresses qui ne rendent pas du texte d'interface : images, exports.
SANS_INTERET = re.compile(r"^/(image/|.*\.(png|ico|csv|ics|json)$)")
PLAFOND = 400


def _adresses_du_code():
    """Les adresses écrites dans le code — les semences de l'exploration.

    ⚠ SUIVRE LES LIENS NE SUFFIT PAS. Un écran qu'aucun lien ne désigne (page
    d'erreur, adresse qu'on tape à la main, fenêtre appelée par un script)
    resterait invisible, et donc jamais traduit. On sème donc l'exploration
    avec toutes les adresses que le code déclare, en plus de l'accueil.
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
    """Toutes les pages atteignables depuis `depart`, en suivant les liens."""
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
    """(pages, compteur de phrases) — le produit exploré pour de bon."""
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
    # ⚠ ET LE CHIFFRE QUI COMPTE VRAIMENT : sur ce qui est DU TEXTE. Les
    # marqueurs d'une lettre et les pastilles chiffrées ne se traduisent pas,
    # et les compter fait mentir la mesure — voir `langue.est_du_texte`.
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

    # ⚠ ET LE CHIFFRE QUI NE FLATTE PAS : tout ce que les sources écrivent,
    # y compris ce qu'aucune exploration ne peut atteindre.
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
# La seconde mesure : les sources
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
# Les fichiers de DONNÉES : leur texte n'est pas de l'interface, il suit la
# langue par un autre chemin (jeu_essai.decor) ou n'est pas affiché.
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
    """(combien écrites, celles qui manquent) — la mesure qui ne flatte pas."""
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
            # ⚠ ON DÉCOUPE AVEC L'OUTIL DU PRODUIT. Une chaîne du code n'est
            # pas une phrase : c'est souvent un morceau de HTML qui en
            # contient plusieurs, ou aucune. `langue.phrases_de` rend
            # exactement les tranches que le traducteur cherchera à
            # l'exécution — mesurer autre chose, c'est compter des clés qui
            # n'existeront jamais.
            morceaux = list(langue.phrases_de(noeud.value) or [])
            if "<" not in noeud.value:
                morceaux.append(noeud.value)
            for morceau in morceaux:
                nu = morceau.strip()
                # ⚠ ET ON ÉCARTE LES PHRASES À TROUS : « {compte} », «
                # [identite] » ne paraissent jamais telles quelles à l'écran,
                # le trou est rempli avant l'affichage. C'est le rôle des
                # RÈGLES, pas d'une entrée de dictionnaire.
                if _TROU.search(nu) or not _est_du_texte_visible(nu):
                    continue
                ecrites += 1
                if (langue.phrase_traduite(nu, table, motifs) is None
                        and nu not in consignes):
                    absentes.add(nu)
    return ecrites, absentes


if __name__ == "__main__":
    sys.exit(principal())
