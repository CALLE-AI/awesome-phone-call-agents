# -*- coding: utf-8 -*-
"""Le français qui reste sur les pages RENDUES EN ANGLAIS.

⚠ C'EST LA SEULE MESURE QUI VOIT LES PHRASES ASSEMBLÉES, et elle a été écrite
le 02/09/2026 parce que les deux autres ne les voyaient pas.

Une phrase collée en Python — « Ses rendez-vous (3) », « N personne(s)
écartée(s) : cette place ne leur » + « ferait pas gagner G jours » — est UN
SEUL nœud de page. Ses morceaux peuvent être au dictionnaire sans que la
phrase entière le soit : elle reste alors française, et :

· lire les SOURCES ne le dit pas — elle n'y existe qu'en morceaux ;
· explorer une base VIDE ne le dit pas — rien à compter, aucun tableau rempli.

Cet outil rend donc les pages EN ANGLAIS, jeu d'essai chargé, et cherche ce
qui est resté français. Il a trouvé 255 phrases que les deux autres mesures
annonçaient traduites.

⚠ IL SIGNALE DES FAUX POSITIFS, ET C'EST VOULU. « place » est un mot des deux
langues ; « [client] » et « [créneau] » sont des codes de gabarit, pas du
texte. Mieux vaut relire six lignes que d'en manquer une.

Usage :
    python outils/francais_restant.py            # le compte rendu
    python outils/francais_restant.py fichier    # + le détail en JSON
"""
import collections
import datetime
import io
import json
import os
import re
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RACINE)

from ringback import (assistant, campagnes, generation,  # noqa: E402
                      horaires, jeu_essai, langue, serveur, themes)

# Des mots que l'anglais n'a pas : leur presence signe du francais reste.
FRANCAIS = re.compile(
    r"\b(?:vous|votre|vos|nous|notre|elle|elles|ils|est|sont|était|"
    r"dans|pour|avec|sans|sous|chez|aucun|aucune|jamais|toujours|"
    r"une|des|les|aux|leur|leurs|cette|ces|qui|que|quoi|dont|"
    r"rendez-vous|créneau|créneaux|appel|appels|campagne|campagnes|"
    r"numéro|numéros|téléphone|personne|personnes|client|clients|"
    r"place|places|liste|listes|jour|jours|heure|heures)\b",
    re.IGNORECASE)
# ⚠ LES MARQUES SE GARDENT EN ANGLAIS, ET CE N'EST PAS UN OUBLI. « [créneau] »,
# « [client] » sont ce que le MOTEUR DE SUBSTITUTION cherche dans le texte de
# l'utilisateur. Les traduire à l'écran ferait écrire « [slot] » à un juré
# anglophone — et rien ne serait remplacé, puisque le moteur, lui, cherche
# toujours « [créneau] ». L'écran anglais explique la marque au lieu de la
# changer. L'instrument les met donc de côté avant de chercher du français.
MARQUEUR = re.compile(r"\[[a-zé_]+\]")
LIEN = re.compile(r'href="(/[^"#]*)"')
SANS_INTERET = re.compile(r"^/(image/|.*\.(png|ico|csv|ics|json)$)")


def adresses():
    trouvees = {"/"}
    for nom in ("serveur.py", "assistant_web.py"):
        texte = io.open(os.path.join(RACINE, "ringback", nom),
                        encoding="utf-8").read()
        trouvees |= set(re.findall(r'url\.path == "([^"]+)"', texte))
        trouvees |= set(re.findall(r'chemin == "([^"]+)"', texte))
    return sorted(trouvees)


def _peupler(app):
    """Crée des campagnes de CHAQUE nature, dans CHAQUE état utile.

    ⚠ SANS ÇA, DES ÉCRANS ENTIERS N'EXISTENT PAS. Une base sans campagne n'a
    ni titre de section (« En cours (3) »), ni bouton « Effacer la liste », ni
    étiquette d'état, ni tableau d'avancement. Ils ne sont apparus dans aucune
    mesure jusqu'au 03/09 — et l'utilisateur, lui, les a vus du premier coup
    en se servant du produit.

    On passe par l'API du produit et non par ses formulaires : ce qu'on mesure
    ici, ce sont les ÉCRANS, pas le chemin qui a créé la campagne.
    """
    base, prefs = app.base, app.preferences
    for jour in range(7):
        horaires.basculer_periode(prefs, jour, 8 * 60, 19 * 60, "ouvrir")
    prefs.definir(themes.CLE_PLAGE_DEBUT, "00:00")
    prefs.definir(themes.CLE_PLAGE_FIN, "23:59")
    prefs.definir(themes.CLE_ENTREPRISE, "Val Fleuri Physiotherapy")

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
                infos[info["code"]] = "Val Fleuri Physiotherapy"
            else:
                infos[info["code"]] = info.get("exemple") or ""
        lot = rendezvous[rang * 2:rang * 2 + 2] or rendezvous[:2]
        contacts = []
        for fiche in lot:
            client = base.obtenir_client(fiche["client_id"])
            if not client:
                continue
            contacts.append({
                "nom": client["nom"], "telephone": client.get("telephone") or "",
                "rendezvous_id": fiche["id"],
                "champs": {"rdv_existant": fiche["horaire"],
                           "motif": fiche.get("motif") or ""}})
        if not contacts:
            continue
        brouillon = {
            "nature": nature, "infos": infos, "infos_auto": {},
            "politique": definition.get("politique") or "tous",
            "ordre": definition.get("ordre_defaut") or "liste",
            "options": {}, "champs": [dict(c) for c in definition["champs"]],
            "mission": assistant.construire_mission(nature, infos, prefs, {}),
            "recette": {"apports": [{"mode": "base",
                                    "source": "a_venir"}],
                        "a_la_main": False},
            "contacts": contacts}
        try:
            crees.append(assistant.creer_campagne_prete(base, brouillon, prefs))
        except Exception:                                    # noqa: BLE001
            continue

    # ⚠ ET DANS PLUSIEURS ÉTATS : « prête », « en cours », « en pause »,
    # « terminée ». Chaque état a son étiquette, sa section et son tableau.
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


http = serveur.creer_serveur(port=0, chemin_base=":memory:",
                             appels_reels=False)
threading.Thread(target=http.serve_forever, daemon=True).start()
app = http.RequestHandlerClass.application
base_url = f"http://127.0.0.1:{http.server_address[1]}"

# ⚠ AVEC LE JEU D'ESSAI CHARGE : sans lui, aucun tableau n'est rempli, et les
# phrases qui comptent des lignes ne paraissent jamais.
app.preferences.definir(langue.CLE_LANGUE, "en")
jeu_essai.charger(app.base, langue_code="en")
_peupler(app)

a_voir, vues, pages = adresses(), set(), {}
while a_voir and len(vues) < 400:
    chemin = a_voir.pop(0)
    if chemin in vues or SANS_INTERET.match(chemin):
        continue
    vues.add(chemin)
    for fenetre in (False, True):
        entetes = {"X-RingBack-Fragment": "1"} if fenetre else {}
        try:
            demande = urllib.request.Request(base_url + chemin,
                                             headers=entetes)
            with urllib.request.urlopen(demande, timeout=20) as reponse:
                if "text/html" not in reponse.headers.get("Content-Type", ""):
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

restes = collections.Counter()
ou = {}
for chemin, page in pages.items():
    for phrase in langue.phrases_de(page):
        vu = FRANCAIS.search(MARQUEUR.sub(" ", phrase))
        if len(phrase) > 3 and vu:
            restes[phrase] += 1
            ou.setdefault(phrase, (chemin, vu.group(0)))

print(f"{len(pages)} pages rendues EN ANGLAIS, jeu d'essai chargé")
print(f"{len(restes)} phrase(s) portent encore un mot français\n")
for phrase, combien in restes.most_common(30):
    chemin, mot = ou[phrase]
    print(f"  {combien:4d}x [{chemin}] — mot vu : « {mot} »")
    print(f"        {phrase[:150]!r}")

if len(sys.argv) > 1:
    io.open(sys.argv[1], "w", encoding="utf-8").write(
        json.dumps({p: {"combien": n, "ou": ou[p][0], "mot": ou[p][1]}
                    for p, n in restes.most_common()},
                   ensure_ascii=False, indent=1))
    print(f"\nDétail écrit dans {sys.argv[1]}")
