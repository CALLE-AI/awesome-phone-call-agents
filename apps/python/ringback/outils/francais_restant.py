# -*- coding: utf-8 -*-
"""The French left over on the pages RENDERED IN ENGLISH.

⚠ THIS IS THE ONLY MEASURE THAT SEES ASSEMBLED SENTENCES, and it was written on
02/09/2026 because the other two did not see them.

A sentence glued together in Python — `Ses rendez-vous (3)`, `N personne(s)
écartée(s) : cette place ne leur` + `ferait pas gagner G jours` — is ONE SINGLE
page node. Its pieces can be in the dictionary without the whole sentence being
there: it then stays French, and:

· reading the SOURCES does not say so — it only exists there in pieces; ·
exploring an EMPTY database does not say so — nothing to count, no table
filled.

So this tool renders the pages IN ENGLISH, with the sample data set loaded, and
looks for what stayed French. It found 255 sentences that the other two
measures reported as translated.

⚠ IT REPORTS FALSE POSITIVES, AND THAT IS DELIBERATE. `place` is a word in both
languages; `[client]` and `[créneau]` are template codes, not text. Better to
reread six lines than to miss one.

Usage: python outils/francais_restant.py # the report python
outils/francais_restant.py fichier # + the detail as JSON
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

# Words English does not have: their presence is the signature of leftover
# French.
FRANCAIS = re.compile(
    r"\b(?:vous|votre|vos|nous|notre|elle|elles|ils|est|sont|était|"
    r"dans|pour|avec|sans|sous|chez|aucun|aucune|jamais|toujours|"
    r"une|des|les|aux|leur|leurs|cette|ces|qui|que|quoi|dont|"
    r"rendez-vous|créneau|créneaux|appel|appels|campagne|campagnes|"
    r"numéro|numéros|téléphone|personne|personnes|client|clients|"
    r"place|places|liste|listes|jour|jours|heure|heures)\b",
    re.IGNORECASE)
# ⚠ THE MARKERS STAY FRENCH IN ENGLISH, AND THAT IS NOT AN OVERSIGHT.
# `[créneau]`, `[client]` are what the SUBSTITUTION ENGINE looks for in the
# user's text. Translating them on screen would have an English-speaking judge
# write `[slot]` — and nothing would be substituted, since the engine still
# looks for `[créneau]`. The English screen explains the marker instead of
# changing it. So the instrument sets them aside before looking for French.
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
    """Creates campaigns of EVERY kind, in EVERY useful state.

    ⚠ WITHOUT THIS, WHOLE SCREENS DO NOT EXIST. A database with no campaign has
    no section title (`En cours (3)`), no `Effacer la liste` button, no state
    label, no progress table. They appeared in no measure until 03/09 — and the
    user saw them at first glance, simply by using the product.

    The product's API is used rather than its forms: what is measured here is
    the SCREENS, not the path that created the campaign.
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

    # ⚠ AND IN SEVERAL STATES: `prête`, `en cours`, `en pause`, `terminée`.
    # Each state has its label, its section and its table.
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

# ⚠ WITH THE SAMPLE DATA SET LOADED: without it no table is filled, and the
# sentences that count rows never appear.
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
