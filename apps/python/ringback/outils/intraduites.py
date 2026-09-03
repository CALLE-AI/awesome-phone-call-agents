# -*- coding: utf-8 -*-
"""Les phrases que la traduction NE CHANGE PAS.

⚠ POURQUOI UN QUATRIEME INSTRUMENT. Le troisieme (`francais_restant.py`)
cherche des MOTS francais dans les pages anglaises. C'est une liste de mots,
donc une passoire : « Parcourir », « Enregistrer », « Ajouter » n'y sont pas,
et une page pleine de ces boutons-la passait pour traduite.

Celui-ci ne devine rien. Il parcourt le produit EN FRANCAIS, exactement comme
l'utilisateur le voit, et demande pour chaque phrase : est-ce que la traduction
la change ? Si non, elle est intraduite — quel que soit le mot.

Reste le bruit legitime : un nom propre, un nombre, une adresse ne changent
pas. La sortie les separe pour qu'on puisse les lire.
"""
import collections
import datetime
import io
import os
import re
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RACINE)

from ringback import (assistant, horaires, jeu_essai,  # noqa: E402
                      langue, serveur, themes, traductions)

LIEN = re.compile(r'href="(/[^"#]*)"')
SANS_INTERET = re.compile(r"^/(image/|.*\.(png|ico|csv|ics|json)$)")
# Ce qui ne CHANGE pas d'une langue à l'autre, et n'a pas à changer.
NEUTRE = re.compile(
    r"^[\W\d\s]*$"                      # chiffres, ponctuation, espaces
    r"|^[+]?\d[\d\s.()-]{4,}$"          # numéros de téléphone
    r"|^\d{1,2}[/:h]\d{2}"              # heures et dates
    r"|^[A-Za-zÀ-ÿ' -]+@"               # adresses de courriel
    r"|^(RingBack|CALL-E|SQLite|Python|JSON|CSV|ICS|HTML|API)\b")


def _peupler(app):
    """Le même peuplement que `francais_restant.py` : sans lui, pas d'écran."""
    base, prefs = app.base, app.preferences
    for jour in range(7):
        horaires.basculer_periode(prefs, jour, 8 * 60, 19 * 60, "ouvrir")
    prefs.definir(themes.CLE_PLAGE_DEBUT, "00:00")
    prefs.definir(themes.CLE_PLAGE_FIN, "23:59")
    prefs.definir(themes.CLE_ENTREPRISE, "Cabinet Val Fleuri")
    rendezvous = [r for r in base.tous_les_rendezvous()
                  if r.get("statut") in ("prévu", "manqué")]
    if not rendezvous:
        return
    demain = (datetime.datetime.now() + datetime.timedelta(days=1)).replace(
        hour=9, minute=0, second=0, microsecond=0).isoformat(
            timespec="minutes")
    crees = []
    for rang, nature in enumerate(assistant.NATURES):
        definition = assistant.NATURES[nature]
        infos = {}
        for info in definition["infos"]:
            if info.get("type") == "date":
                infos[info["code"]] = demain
            elif info["code"] == "entreprise":
                infos[info["code"]] = "Cabinet Val Fleuri"
            else:
                infos[info["code"]] = info.get("exemple") or ""
        lot = rendezvous[rang * 2:rang * 2 + 2] or rendezvous[:2]
        contacts = []
        for fiche in lot:
            client = base.obtenir_client(fiche["client_id"])
            if not client:
                continue
            contacts.append({
                "nom": client["nom"],
                "telephone": client.get("telephone") or "",
                "rendezvous_id": fiche["id"],
                "champs": {"rdv_existant": fiche["horaire"],
                           "motif": fiche.get("motif") or ""}})
        if not contacts:
            continue
        try:
            crees.append(assistant.creer_campagne_prete(base, {
                "nature": nature, "infos": infos, "infos_auto": {},
                "politique": definition.get("politique") or "tous",
                "ordre": definition.get("ordre_defaut") or "liste",
                "options": {},
                "champs": [dict(c) for c in definition["champs"]],
                "mission": assistant.construire_mission(nature, infos, prefs,
                                                        {}),
                "recette": {"apports": [{"mode": "base", "source": "a_venir"}], "a_la_main": True},
                "contacts": contacts}, prefs))
        except Exception:                                    # noqa: BLE001
            continue
    for rang, identifiant in enumerate(crees):
        try:
            if rang % 4 == 1:
                base.changer_statut_campagne(identifiant, "en cours")
            elif rang % 4 == 2:
                base.changer_statut_campagne(identifiant, "en pause")
            elif rang % 4 == 3:
                base.changer_statut_campagne(identifiant, "terminée")
        except Exception:                                    # noqa: BLE001
            continue


def principal():
    http = serveur.creer_serveur(port=0, chemin_base=":memory:",
                                 appels_reels=False)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    app = http.RequestHandlerClass.application
    racine_web = f"http://127.0.0.1:{http.server_address[1]}"
    # ⚠ EN FRANÇAIS : c'est le produit tel qu'il sort, avant toute traduction.
    app.preferences.definir(langue.CLE_LANGUE, "fr")
    jeu_essai.charger(app.base, langue_code="fr")
    _peupler(app)

    a_voir, vues, pages = ["/"], set(), {}
    while a_voir and len(vues) < 400:
        chemin = a_voir.pop(0)
        if chemin in vues or SANS_INTERET.match(chemin):
            continue
        vues.add(chemin)
        for fenetre in (False, True):
            entetes = {"X-RingBack-Fragment": "1"} if fenetre else {}
            try:
                demande = urllib.request.Request(racine_web + chemin,
                                                 headers=entetes)
                with urllib.request.urlopen(demande, timeout=20) as reponse:
                    if "text/html" not in reponse.headers.get("Content-Type",
                                                              ""):
                        break
                    page = reponse.read().decode("utf-8")
            except (urllib.error.HTTPError, urllib.error.URLError, OSError):
                continue
            pages[chemin + ("#f" if fenetre else "")] = page
            if not fenetre:
                for trouve in LIEN.findall(page):
                    lien = urllib.parse.urljoin(chemin, trouve)
                    if lien not in vues:
                        a_voir.append(lien)
    http.shutdown()
    http.server_close()

    table, motifs = traductions.table("en"), traductions.motifs("en")
    inchangees, neutres, ou = collections.Counter(), 0, {}
    total = 0
    for chemin, page in pages.items():
        for phrase in langue.phrases_de(page):
            if len(phrase.strip()) < 3:
                continue
            total += 1
            if langue.phrase_traduite(phrase, table, motifs) != phrase:
                continue
            if NEUTRE.match(phrase.strip()):
                neutres += 1
                continue
            inchangees[phrase] += 1
            ou.setdefault(phrase, chemin)

    print(f"{len(pages)} pages parcourues EN FRANÇAIS, {total} phrases lues")
    print(f"{neutres} inchangées mais NEUTRES (nombres, numéros, noms propres)")
    print(f"{len(inchangees)} phrase(s) que la traduction NE CHANGE PAS\n")
    for phrase, combien in inchangees.most_common(60):
        print(f"  {combien:4d}x [{ou[phrase]}]")
        print(f"        {phrase[:120]!r}")
    if len(sys.argv) > 1:
        io.open(sys.argv[1], "w", encoding="utf-8").write(
            "\n".join(f"{n}\t{ou[p]}\t{p!r}"
                      for p, n in inchangees.most_common()))
        print(f"\nDétail dans {sys.argv[1]}")


principal()
