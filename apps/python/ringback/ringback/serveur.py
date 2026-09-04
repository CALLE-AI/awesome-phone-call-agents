"""Interface web (bibliothèque standard) — port 8770, en français.

Habillage commun : bannière (logo SVG + nom + sous-titre), navigation en
onglets (📣 Campagnes · 🔁 Relances · 📅 Rendez-vous · 👥 Contacts ·
⚙ Réglages), mode clair ET sombre (bascule ☾/☀, détection du système,
choix mémorisé en localStorage), pastilles de statut colorées (prévu bleu,
manqué orange, confirmé vert, annulé rouge, ignoré et supprimé gris,
déplacé violet), badge 🚫 pour les clients « Ne plus appeler ».

Le MODÈLE : des thèmes de travail instanciés en CAMPAGNES (liste importée
à l'instant + paramètres + appels rattachés), et des RELANCES programmées
pour tout appel non abouti — jamais lancées seules, toujours par un geste.

Écrans :
- « / »              : accueil « Campagnes » — gros bouton « ➕ Nouvelle
                       campagne » qui mène au SEUL parcours de création,
                       l'assistant en 3 étapes (« /assistant » : nature →
                       message → personnes, voir assistant_web.py), liste des
                       campagnes avec leur avancement (appelés / aboutis /
                       relances) ; « /campagne/nouvelle » n'est plus qu'une
                       redirection vers l'assistant (anciens marque-pages) ;
- « /campagne »      : fiche d'une campagne (contacts, issues, relances,
                       transcriptions, clôture manuelle) ; pour une campagne
                       de l'assistant, le POSTE DE PILOTAGE — où ▶ Démarrer
                       ouvre d'abord le rappel « les créneaux annoncés
                       sortent de l'agenda de RingBack », avec les chiffres
                       du jour (GET « /campagne/verification-agenda », un
                       fragment : seul ce bloc se remplit) ;
- « /relances »      : les relances programmées — les DUES en évidence,
                       bouton « Lancer les relances dues » (geste humain,
                       mêmes verrous que partout), reporter / annuler ;
- « /suivi »         : le PLANNING de la semaine — même découpage que la
                       semaine type (⚙ Réglages), tranches libres en VERT
                       (la même variable CSS que le calendrier des
                       réglages), rendez-vous posés dessus en TUILES ; un
                       rendez-vous de N tranches consécutives donne UNE
                       tuile de hauteur N (rowspan), jamais N cases.
                       Navigation : sélecteur de semaine + sélecteur
                       d'année + champ date + ◀ / ▶, et « ⏭ Prochain
                       créneau disponible » qui avance de trou en trou (sa
                       position vit dans un champ caché). RÈGLE : tout
                       bouton de navigation AUTRE que le champ date remet
                       ce champ à vide. Un clic sur une tuile ou sur une
                       tranche libre ouvre une MODALE (clic extérieur ou
                       Échap pour fermer) — GET « /suivi/planning » rend la
                       zone du planning, GET « /suivi/detail » le contenu
                       de la modale, tous deux en FRAGMENTS (la page n'est
                       jamais rechargée).
                       LA PORTE 📅 DU §5, les trois gestes : un clic sur une
                       tranche LIBRE propose « ➕ Créer la campagne
                       📞 Créneau libéré sur cette place » (POST
                       « /suivi/creneau/campagne » — la même mécanique que
                       la compensation d'annulation, jamais une seconde) ;
                       un clic sur un RENDEZ-VOUS propose ses deux gestes,
                       « 📆 Déplacer » (POST « /suivi/detail/deplacer » →
                       campagne « Déplacement » sur CE rendez-vous) et
                       « ✖ Annuler » (POST « /suivi/detail/annuler », en
                       DEUX temps : la règle est d'abord ANNONCÉE, puis
                       appliquée — c'est horaires.decision_annulation qui
                       tranche « supprimé » / « annulé », jamais ce
                       fichier). Une place libérée mène en un clic à la
                       campagne qui la remplira. AUCUN APPEL ne part de ces
                       gestes. Dessous, les DEUX listes
                       inchangées : « À rappeler (manqués) » (règle du
                       manqué appliquée au chargement, bouton « Rappeler »
                       individuel, bouton « Vider la liste » qui passe tous
                       les manqués en « ignoré ») et « Rendez-vous à
                       venir » ;
- « /tous »          : TOUS les rendez-vous avec leur statut — un « ignoré »
                       se rétablit ici (POST « /retablir ») ;
- « /rappel?rdv=N »  : préparation du rappel individuel — sélecteur
                       « Thème de l'appel » (① manqué ② confirmation
                       ③ déplacement ④ créneau libéré ⑤ personnalisé),
                       mission pré-remplie MODIFIABLE, variables substituées
                       ([entreprise], [client], [date_rdv],
                       [créneaux_disponibles], [plage_rappel]) ;
- POST « /rappeler » : déclenche l'appel de CE rendez-vous (mission du
                       thème choisi) puis redirige vers sa fiche ; REFUSÉ
                       hors de la plage horaire autorisée ;
- « /clients »       : le POSTE DE TRAVAIL DES ÉTATS — chaque client avec
                       tout ce que la base sait de lui, son nombre de
                       rendez-vous (un rendez-vous long compte pour UN),
                       ses DEUX états (agenda et conversation, voir
                       etats_clients.py), les campagnes EN COURS qui le
                       concernent avec l'état qui l'y a fait entrer, et ce
                       qu'il reste à faire. Trois filtres — recherche par
                       nom (accents et casse ignorés), sélecteur d'état,
                       case « non traité » (§3 de
                       CAS_DE_FIGURE_CAMPAGNES.md) — qui rechargent la
                       SEULE liste (GET « /clients/liste », fragment).
                       LA PORTE 👥 DU §4 : dès que « non traité » est coché
                       et que la sélection n'est pas vide, un bouton coloré
                       « ➕ Créer la campagne « … » — N client(s)
                       concerné(s) » apparaît DANS ce fragment (il naît et
                       meurt avec le filtre, sans rechargement). La nature
                       est DÉDUITE de l'état par etats_clients.TRAITEMENT ;
                       quand la sélection mêle des états traités par des
                       campagnes différentes, il y a UN BOUTON PAR NATURE,
                       chacun avec son compte (décision du propriétaire du
                       31/07/2026) — jamais de bouton grisé. Les états
                       qu'aucune campagne ne traite ne donnent aucun bouton
                       et disent pourquoi. POST « /clients/campagne » ouvre
                       l'assistant À L'ÉTAPE 2, liste déjà remplie, et la
                       RECETTE garde le critère (mode « etat ») : AUCUN
                       APPEL n'en part ;
                       Bouton « Ne plus appeler » (exclu de la file, des
                       cascades et des listes générées, badge 🚫 partout,
                       réversible) et « Supprimer… » (page de confirmation
                       OBLIGATOIRE avant : client + rendez-vous, jamais en
                       un clic) ;
- « /clients/fiche » : la fiche d'un client — son dossier et le FORMULAIRE
                       d'édition (nom, numéro, indicateur 🚫), POST
                       « /clients/modifier » ; le numéro n'y est JAMAIS
                       réaffiché en clair : le champ reste vide, et le
                       laisser vide garde le numéro tel quel ;
- « /reglages »      : nom de l'entreprise, plage horaire d'appel autorisée,
                       HORAIRES D'OUVERTURE (durée moyenne d'un rendez-vous
                       = le pas des tranches, calendrier de la semaine type
                       au glisser-relâché, repli « jour + début + fin » sans
                       JavaScript), JOURS FERMÉS exceptionnels (avec les
                       jours fériés français PROPOSÉS, jamais ajoutés
                       d'office) et les créneaux à proposer, désormais
                       CALCULÉS (ouvert − déjà pris − fermé) avec ajout à la
                       main possible — le tout dans donnees/preferences.json ;
                       POST « /reglages/pas | /reglages/semaine |
                       /reglages/jour-ferme », GET « /reglages/creneaux »
                       (fragments : le calendrier et la liste des créneaux se
                       rechargent SEULS, jamais la page). Porte aussi les
                       🧪 TESTEURS DE L'ESSAI RÉEL (module essai_reel) : un
                       nom et un numéro par personne qui accepte de jouer un
                       rôle (l'opérateur, un collègue, un ami). Seuls CES
                       numéros échappent au refus de doublon ; ils restent
                       masqués à l'écran, et tout contact qui les porte est
                       marqué 🧪 partout. POST « /reglages/testeur »
                       (ajout/retrait), GET « /reglages/testeurs » et
                       « /reglages/campagne-essai » (fragments : la liste et
                       l'aperçu « qui joue quoi » se rechargent SEULS).
                       GET/POST « /reglages/essai-reel » PRÉPARE une
                       campagne d'essai (état « prête », AUCUN appel) dont
                       les rôles sont RÉPARTIS entre les testeurs, en
                       tournant ; sans testeur déclaré, l'écran le dit et ne
                       crée rien ;
- « /rendezvous »    : fiche du rendez-vous, résultat structuré +
                       transcription, DURÉE (en tranches), DÉPLACEMENT (seuls
                       les créneaux assez longs sont proposés ; le refus dit
                       ce qui manque) et ANNULATION (qui libère ses tranches) ;
                       POST « /rendezvous/duree | /rendezvous/deplacer |
                       /rendezvous/annuler » ;
- « /ajouter »       : formulaire d'ajout (client + rendez-vous) + imports
                       CSV (nom;telephone;date_heure;motif) et agenda ICS ;
- POST « /importer | /importer-ics » ;
- « /sans-numero »   : rendez-vous importés sans téléphone, à compléter
                       (POST « /completer-numero ») ;
- « /file »          : file d'appels — « Tout rappeler » met en file tous les
                       manqués (sauf « Ne plus appeler »), chaque appel en
                       attente s'annule d'un bouton, « Vider la file » les
                       annule TOUS d'un coup, « Exécuter la file » les passe
                       (thème + mission modifiable, [client]/[date_rdv]
                       substitués PAR appel) et affiche les issues ;
- POST « /file/tout-rappeler | /file/annuler | /file/annuler-tout |
         /file/executer » ;
- « /cascade »       : cascade « premier oui » — liste collée Nom;Téléphone,
                       mission, créneau libéré ; POST « /cascade/executer »
                       appelle UNE personne à la fois, dans l'ordre, et
                       s'ARRÊTE au premier oui ; « /cascade/resultat »
                       montre qui a été appelé (issue + transcription) et
                       qui a été épargné. POST « /cascade/generer » remplit
                       la zone de collage DEPUIS la base (source + ordre au
                       choix EXPLICITE — aucun ordre imposé par défaut ; le
                       dernier choix est mémorisé dans donnees/preferences.json) ;
                       POST « /cascade/csv » télécharge la liste en CSV
                       (numéros en clair par nature, généré à la volée,
                       JAMAIS écrit côté serveur).

Les anciens parcours directs (« /cascade », « /file ») restent utilisables
mais sont RATTACHÉS au modèle campagne : chaque exécution y crée sa
campagne (thème « créneau libéré » ou « rappel d'appels manqués »), avec
les relances qui en découlent — rien n'est dupliqué.

La base vit sur disque (donnees/ringback.db), créée au premier lancement ;
les données de démonstration ne sont insérées que si elle est vide.
Par défaut tout est SIMULÉ ; le mode réel exige les trois verrous (clé
CALLE_API_KEY + option --appels-reels + confirmation tapée au lancement).
"""

import argparse
import datetime
import email
import email.policy
import html
import json
import logging
import os
import re
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import (agenda_exemple, assistant, assistant_web, calle_client, campagnes, db,
               essai_reel, etats_clients, generation, horaires, ics,
               installation, jeu_essai, langue, planificateur, saisie,
               themes)

journal = logging.getLogger("ringback.serveur")

PORT = 8770
DOSSIER_APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Les SEULS fichiers binaires du produit : deux fonds de page (un par thème)
# et l'icône du site en deux tailles. Voir preparer_images.py, qui les
# fabrique. Ils sont servis par RingBack lui-même — rien n'est chargé depuis
# Internet, la règle « aucune ressource externe » tient toujours.
#
# ⚠ C'est une LISTE BLANCHE, avec son type de contenu : un nom absent d'ici
# n'atteint jamais le disque. Servir « ce que le client demande » depuis un
# dossier, c'est ouvrir la porte à « ../../ ».
DOSSIER_IMAGES = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "images")
IMAGES_SERVIES = {
    "fond-clair.jpg": "image/jpeg",
    "fond-sombre.jpg": "image/jpeg",
    "icone-32.png": "image/png",
    "icone-180.png": "image/png",
}
CHEMIN_BASE = os.path.join(DOSSIER_APP, "donnees", "ringback.db")

ETIQUETTES = {
    "confirmed": "Confirmé",
    "rescheduled": "Déplacé",
    "canceled": "Annulé",
    "to_reschedule": "À reprogrammer",
}

# Pastille colorée par statut de rendez-vous (Lot interface) : prévu bleu,
# manqué orange, confirmé vert, annulé rouge, ignoré ET SUPPRIMÉ gris,
# déplacé violet. « supprimé » n'apparaît que dans les deux archives (🗂 Tous
# les rendez-vous, fiche du contact) : ailleurs, il n'existe plus.
CLASSES_STATUT = {
    "prévu": "st-prevu",
    "manqué": "st-manque",
    "confirmé": "st-confirme",
    "annulé": "st-annule",
    "ignoré": "st-ignore",
    "déplacé": "st-deplace",
    db.STATUT_SUPPRIME: "st-ignore",
}

# Les statuts qu'un humain pose lui-même sur un rendez-vous (édition en
# modale). « déplacé » n'y figure pas : c'est le planificateur qui l'écrit
# quand un appel convient d'une autre date — il reste proposé si le
# rendez-vous le porte déjà, pour ne jamais le changer dans le dos.
STATUTS_MODIFIABLES = ("prévu", "confirmé", "manqué", "annulé", "ignoré",
                       db.STATUT_SUPPRIME)

# LE RETRAIT D'UN RENDEZ-VOUS — deux mots, un seul geste légal à la fois.
# Règle du propriétaire : « annulé c'est pour les dates passées, sinon on
# supprime le rendez-vous ». L'écran ne propose donc que celui des deux qui
# correspond à la DATE du rendez-vous ; l'autre n'apparaît pas, parce qu'il
# n'est pas un choix possible. Le serveur, lui, accepte les deux et les
# ramène à la règle (horaires.decision_annulation) : un formulaire ancien ou
# recopié ne peut pas contourner la règle en douce.
STATUTS_RETRAIT = ("annulé", db.STATUT_SUPPRIME)

# Les statuts qui OCCUPENT une place au planning (les autres l'ont rendue).
STATUTS_OCCUPANTS = ("prévu", "confirmé")

ETIQUETTES_CASCADE = {
    "accepted": "Accepté — créneau attribué",
    "refused": "Refusé",
    "no_answer": "Pas de réponse",
    "moved": "Autre date convenue",
    "echec": "Échec technique",
}

ETIQUETTES_STATUT_CASCADE = {
    "en cours": "en cours",
    "pourvue": "créneau pourvu",
    "épuisée": "liste épuisée, créneau non pourvu",
    # « interrompue » n'est PAS « épuisée » : la liste n'a pas été essayée,
    # elle a été stoppée par une panne de notre côté (clé refusée, service
    # en panne). Confondre les deux ferait croire que personne n'a voulu du
    # créneau alors que personne n'a été appelé.
    "interrompue": "interrompue — panne de notre côté, liste non essayée",
}

# Pastilles des statuts de campagne et des états de contact.
CLASSES_STATUT_CAMPAGNE = {
    "prête": "st-prevu",
    "en cours": "st-manque",
    "en pause": "st-deplace",
    "terminée": "st-confirme",
    "arrêtée": "st-ignore",
    "close": "st-ignore",
}
CLASSES_ETAT_CONTACT = {
    "à appeler": "st-prevu",
    "appelé": "st-manque",
    "abouti": "st-confirme",
    "épargné": "st-confirme",
    "exclu": "st-annule",
    "abandonné": "st-ignore",
}

# Thème clair par défaut + thème sombre via [data-theme="dark"] (bascule ☾/☀,
# détection du système, mémorisée en localStorage) — variables CSS inspirées
# du tableau de bord Takumi.
STYLE = """
:root {
  --fond:#f2f5f9; --carte:#ffffff; --texte:#1c242c; --sourd:#5b6b7a;
  --bord:#dce3ec; --accent:#1d6fd6; --accent-survol:#1758aa; --accent-texte:#ffffff;
  --banniere:#12365e; --banniere-texte:#f4f8fc; --banniere-sourd:#a9c1d9;
  --ombre:0 1px 2px rgba(16,34,56,.07), 0 4px 14px rgba(16,34,56,.06);
  --avert-fond:#fff3cd; --avert-bord:#e0c76a;
  --danger-fond:#fdecea; --danger-bord:#e5a3a3; --danger:#b02a37;
  --danger-survol:#8f202b; --pre-fond:#f2f4f7; --ligne-survol:#f6f9fd;
  --p-prevu-f:#e3edfd;   --p-prevu-t:#174ea6;
  --p-manque-f:#fdebd7;  --p-manque-t:#9a5200;
  --p-confirme-f:#e2f3e6;--p-confirme-t:#1d6f34;
  --p-annule-f:#fbe4e6;  --p-annule-t:#a52833;
  --p-ignore-f:#e9edf1;  --p-ignore-t:#59646f;
  --p-deplace-f:#efe6fb; --p-deplace-t:#6636ad;
  /* LE VERT DES CRÉNEAUX LIBRES — le MÊME dans les deux thèmes (demande du
     propriétaire, 02/08/2026 : « on charge les mêmes couleurs en clair et en
     sombre sauf les traits et les textes »). Il a sa propre variable et
     n'emprunte plus celle des rendez-vous confirmés : celle-là porte du
     TEXTE (--p-confirme-t), et le même vert des deux côtés y rendrait le
     texte illisible dans l'un des deux. Une case libre, elle, est vide.

     Rendu PLUS VERT le 03/08/2026 : l'ancien #173a22 (saturation 43 %) ne
     tranchait presque pas sur le fond sombre — contraste 1,44, autant dire
     rien. Celui-ci monte à 64 % de saturation et 2,55 de contraste sur la
     page sombre, tout en restant lisible sur la page claire (6,52). */
  --creneau-libre:#166534;
  /* LE TRAIT DES CALENDRIERS. Un trait : il change donc d'un thème à l'autre
     (la règle du propriétaire le prévoit). Choisi pour garder EXACTEMENT le
     poids visuel du gris-bleu qu'il remplace — luminance 0,164 contre 0,141
     ici, 0,352 contre 0,358 en sombre — mais en vert, comme demandé. Le
     planning des rendez-vous ET le calendrier de la semaine type (Réglages,
     installeur) l'emploient : c'est ce qui les rend identiques. */
  --trait-calendrier:#4f7a60;
  /* Le fond de page de CE thème. Voir preparer_images.py. */
  --fond-image: url("/image/fond-clair.jpg");
}
[data-theme="dark"] {
  --fond:#12161b; --carte:#1b2229; --texte:#e5e9ed; --sourd:#95a3b1;
  --bord:#2b3540; --accent:#4d9bef; --accent-survol:#77b4f3; --accent-texte:#0b1521;
  --banniere:#0c1420; --banniere-texte:#e8eef5; --banniere-sourd:#7d93aa;
  --ombre:0 1px 3px rgba(0,0,0,.45);
  --avert-fond:#33290f; --avert-bord:#8a6d1d;
  --danger-fond:#3a1a1e; --danger-bord:#a04a52; --danger:#e06c75;
  --danger-survol:#eb8a92; --pre-fond:#151b21; --ligne-survol:#20282f;
  --p-prevu-f:#173252;   --p-prevu-t:#9ec8f8;
  --p-manque-f:#43290e;  --p-manque-t:#f3b877;
  --p-confirme-f:#173a22;--p-confirme-t:#8fd9a4;
  --p-annule-f:#44191e;  --p-annule-t:#f1a3ab;
  --p-ignore-f:#252d35;  --p-ignore-t:#aab6c2;
  --p-deplace-f:#31204d; --p-deplace-t:#cbaef3;
  --trait-calendrier:#63b07e;
  /* Le décalage vers la gauche est CUIT dans l'image (toile 16:9,
     illustration à gauche, bord droit fondu), donc il tient à n'importe
     quelle largeur d'écran — un background-position n'aurait rien changé
     sur un écran plus large que l'image. Le fond clair est composé de la
     même façon : ce thème-ci a servi de référence. */
  --fond-image: url("/image/fond-sombre.jpg");
}
* { box-sizing: border-box; }
/* ⚠ « hidden » DOIT MASQUER, toujours. L'attribut HTML ne vaut qu'un
   « display: none » de navigateur : la moindre règle de ce fichier qui pose
   un display (flex, grid, block…) l'emporte, et l'élément reste à l'écran
   alors que le code le croit caché. C'est ce qui est arrivé au sous-menu des
   Réglages le 02/08/2026 — le menu restait entièrement déplié, et une
   vérification qui lisait la PROPRIÉTÉ « hidden » (vraie) au lieu de ce qui
   s'affiche n'y voyait rien. Cette règle referme le piège pour de bon, pour
   tous les éléments du produit. */
[hidden] { display: none !important; }
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0;
       background: var(--fond); color: var(--texte); line-height: 1.55; }
a { color: var(--accent); }
/* LE BANDEAU EST UNE COULEUR PLEINE. Une version datée du 03/08/2026 y
   posait l'illustration, cadrée à droite : le propriétaire l'a jugée moche à
   l'écran, et il avait raison — une perspective profonde ne survit pas à une
   bande de cent pixels. L'illustration vit maintenant DERRIÈRE LA PAGE, où
   sa composition se lit en entier (voir body::before). */
.banniere-haut { background: var(--banniere); color: var(--banniere-texte); }
.banniere-int { max-width: 64rem; margin: 0 auto; padding: .9rem 1rem .55rem;
                display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; }
/* LE FOND DE PAGE : l'illustration, fixe, une image PAR THÈME.
   ⚠ Chaque fichier est CUIT à sa force définitive et s'affiche à opacité 1 —
   voir preparer_images.py. Régler une opacité en CSS avait produit
   exactement le défaut qu'on croit éviter en faisant « discret » : un bleu
   marine à 9 % sur une page presque blanche ne se voyait PAS DU TOUT.
   Le CADRAGE est le même pour les deux thèmes — « left center », et le
   décalage lui-même est cuit dans l'image. Il n'y a donc plus de variable de
   cadrage : deux thèmes qui se composent pareil ne doivent pas pouvoir
   diverger par une valeur qu'on oublierait de changer des deux côtés. */
body::before { content: ""; position: fixed; inset: 0; z-index: -1;
    pointer-events: none;
    background: var(--fond-image) left center / cover no-repeat; }
@media print { body::before { display: none; } }
.logo { flex: none; color: var(--banniere-texte); display: block; }
.marque { display: flex; align-items: center; gap: .8rem; flex: 1; min-width: 15rem;
          text-decoration: none; color: inherit; }
.nom-produit { font-size: 1.35rem; font-weight: 700; letter-spacing: .02em; }
.sous-titre { display: block; font-size: .8rem; color: var(--banniere-sourd); }
#btn-theme { background: transparent; border: 1px solid var(--banniere-sourd);
             color: var(--banniere-texte); font-size: 1.05rem; line-height: 1;
             border-radius: .55rem; padding: .38rem .6rem; cursor: pointer; }
#btn-theme:hover { border-color: var(--banniere-texte); background: transparent; }
/* La bascule FR/EN vit a cote du theme : meme taille, meme bordure, meme
   creux au survol. Deux gestes de meme nature se ressemblent. */
.gestes-banniere { display: flex; align-items: center; gap: .4rem; }
.geste-langue { margin: 0; }
.geste-langue button { background: transparent;
             border: 1px solid var(--banniere-sourd);
             color: var(--banniere-texte); font-size: .82rem; font-weight: 700;
             letter-spacing: .04em; line-height: 1;
             border-radius: .55rem; padding: .45rem .55rem; cursor: pointer; }
.geste-langue button:hover { border-color: var(--banniere-texte); }
nav.onglets { max-width: 64rem; margin: 0 auto; padding: 0 1rem; display: flex;
              gap: .2rem; flex-wrap: wrap; }
nav.onglets a { color: var(--banniere-sourd); text-decoration: none;
                padding: .5rem .85rem .55rem; border-radius: .6rem .6rem 0 0;
                font-size: .93rem; white-space: nowrap; }
nav.onglets a:hover { color: var(--banniere-texte); }
nav.onglets a.actif { background: var(--fond); color: var(--texte); font-weight: 600; }
main { max-width: 64rem; margin: 0 auto; padding: 1.1rem 1rem 2rem; }
h1 { font-size: 1.45rem; margin: .7rem 0; }
h2 { font-size: 1.12rem; margin: 1.5rem 0 .6rem; }
.bandeau { background: var(--avert-fond); border: 1px solid var(--avert-bord);
           padding: .5rem 1rem; border-radius: .6rem; }
.bandeau.reel { background: var(--danger-fond); border-color: var(--danger-bord);
                font-weight: 600; }
.bandeau.essai { background: var(--p-deplace-f); border-color: var(--p-deplace-t);
                 color: var(--p-deplace-t); margin-top: .45rem; }
.badge-essai { display: inline-block; padding: .12rem .65rem; border-radius: 1rem;
               background: var(--p-deplace-f); color: var(--p-deplace-t);
               font-size: .88rem; white-space: nowrap; }
table { border-collapse: separate; border-spacing: 0; width: 100%;
        background: var(--carte); border-radius: .7rem; box-shadow: var(--ombre);
        overflow: hidden; }
th, td { border-bottom: 1px solid var(--bord); padding: .55rem .75rem;
         text-align: left; vertical-align: middle; }
th { font-size: .85rem; color: var(--sourd); text-transform: uppercase;
     letter-spacing: .04em; }
tr:last-child td { border-bottom: none; }
tbody tr:hover td, table tr:hover td { background: var(--ligne-survol); }
button, .bouton { display: inline-block; background: var(--accent);
         color: var(--accent-texte); border: none; padding: .48rem .95rem;
         border-radius: .55rem; cursor: pointer; font: inherit; font-size: .95rem;
         text-decoration: none; }
button:hover, .bouton:hover { background: var(--accent-survol); }
button.secondaire { background: transparent; color: var(--texte);
                    border: 1px solid var(--bord); }
button.secondaire:hover { background: var(--ligne-survol); }
button.danger { background: var(--danger); color: #fff; }
button.danger:hover { background: var(--danger-survol); }
form { margin: .3rem 0; }
pre { background: var(--pre-fond); border: 1px solid var(--bord);
      padding: .75rem; border-radius: .6rem; overflow-x: auto;
      white-space: pre-wrap; }
.pastille { display: inline-block; padding: .12rem .65rem; border-radius: 1rem;
            background: var(--p-prevu-f); color: var(--p-prevu-t);
            font-size: .88rem; white-space: nowrap; }
.st-prevu    { background: var(--p-prevu-f);    color: var(--p-prevu-t); }
.st-manque   { background: var(--p-manque-f);   color: var(--p-manque-t); }
.st-confirme { background: var(--p-confirme-f); color: var(--p-confirme-t); }
.st-annule   { background: var(--p-annule-f);   color: var(--p-annule-t); }
.st-ignore   { background: var(--p-ignore-f);   color: var(--p-ignore-t); }
.st-deplace  { background: var(--p-deplace-f);  color: var(--p-deplace-t); }
.badge-stop { display: inline-block; padding: .12rem .65rem; border-radius: 1rem;
              background: var(--danger-fond); color: var(--danger);
              border: 1px solid var(--danger-bord); font-size: .88rem;
              white-space: nowrap; }
.erreurs { background: var(--danger-fond); border: 1px solid var(--danger-bord);
           padding: .5rem 1rem; border-radius: .6rem; }
.carte { background: var(--carte); border: 1px solid var(--bord);
         border-radius: .8rem; padding: 1.1rem 1.25rem; max-width: 28rem;
         box-shadow: var(--ombre); }
/* ⚠ « IL FAUT QUE LA ZONE PRENNE TOUTE LA LARGEUR » (21/08/2026, sa demande).
   Le « max-width: 28rem » de .carte est fait pour les FORMULAIRES — un champ
   de saisie large de soixante-quatre rem se lit mal. Une LISTE, elle, a besoin
   de toute la place : même relâchement, et pour la même raison, que
   « .vue-reglages .carte ». */
.campagnes-passees { max-width: none; }
.campagnes-passees summary { cursor: pointer; font-size: 1.02rem; }
.carte label { display: block; margin-bottom: .8rem; }
.carte input, .carte textarea, .carte select { width: 100%; padding: .42rem .55rem;
               border: 1px solid var(--bord); font: inherit; color: var(--texte);
               background: var(--fond); border-radius: .45rem; }
.carte fieldset { border: 1px solid var(--bord); border-radius: .6rem; }
.entete-section { display: flex; align-items: center; justify-content: space-between;
                  gap: .8rem; flex-wrap: wrap; margin: 1.5rem 0 .6rem; }
.entete-section h2 { margin: 0; }
.sourd, small { color: var(--sourd); }
.epargne { color: var(--p-confirme-t); }
/* Formulaires : une case à cocher ou un bouton radio ne prend JAMAIS toute
   la largeur — le libellé se colle au contrôle, placé avant le texte. */
.carte input[type="checkbox"], .carte input[type="radio"] { width: auto; }
.option, .carte label.option { display: inline-flex; align-items: baseline;
              gap: .45rem; font-weight: normal; width: fit-content;
              max-width: 100%; margin-bottom: 0; }
.ligne-option { margin: .45rem 0; }
/* Les options d'une option : révélées seulement quand la parente est active. */
.sous-options { margin: .15rem 0 .8rem 1.5rem; padding-left: .9rem;
                border-left: 2px solid var(--bord); }
.carte select.select-option { width: auto; min-width: 16rem; max-width: 100%; }
.carte input.champ-court { width: auto; max-width: 7rem; }
/* Un champ « date » demande un peu plus de place que 7rem (le sélecteur du
   navigateur y loge son calendrier) — sans jamais prendre toute la largeur. */
.carte input.champ-date { width: auto; max-width: 11rem; }
.champ-option, .carte label.champ-option { display: block; margin-bottom: .55rem;
                font-weight: normal; }
/* Assistant de campagne (3 étapes) et poste de pilotage */
/* Fil d'Ariane : trois ronds reliés par un trait d'avancement ; les noms
   d'étape sont cliquables quand l'étape est atteignable. */
/* ⚠ VALEURS EFFECTIVES, PAS LES VALEURS D'ORIGINE. L'installeur redéfinissait
   « .fil-ariane » plus bas pour son propre fil d'Ariane, et cette
   redéfinition retombait sur CELUI-CI — c'est elle qui donnait à l'assistant
   son écart de .3rem, sa marge et son trait de séparation. L'installeur est
   passé à un menu arborescent (03/08/2026) et sa règle a disparu : on inscrit
   ici ce que l'assistant affichait réellement, pour qu'il ne bouge pas d'un
   pixel (mesuré : gap 4,8 px, marge 0 0 16 px, trait bas 1 px, hauteur 45). */
.fil-ariane { display: flex; align-items: center; gap: .3rem;
              flex-wrap: wrap; margin: 0 0 1rem; padding: 0 0 .8rem;
              border-bottom: 1px solid var(--bord); }
.fa-etape { display: flex; align-items: center; gap: .45rem;
            text-decoration: none; color: var(--sourd); padding: .2rem 0; }
.fa-rond { width: 1.05rem; height: 1.05rem; border-radius: 50%; flex: none;
           border: 2px solid var(--bord); background: var(--carte); }
.fa-trait { flex: 1 1 2rem; min-width: 1.5rem; height: 3px;
            border-radius: 2px; background: var(--bord); }
.fa-trait-fait { background: var(--accent); }
.fa-faite .fa-rond { background: var(--accent); border-color: var(--accent); }
.fa-faite .fa-nom { color: var(--texte); }
.fa-courante .fa-rond { border-color: var(--accent); border-width: 3px; }
.fa-courante .fa-nom { color: var(--texte); font-weight: 700; }
a.fa-etape:hover .fa-nom { color: var(--accent); text-decoration: underline; }
.fa-bloquee { cursor: default; }
.cartes-natures { display: grid; gap: .8rem;
                  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); }
.carte-nature { display: block; width: 100%; text-align: left;
                background: var(--carte); color: var(--texte);
                border: 1px solid var(--bord); border-radius: .8rem;
                padding: .9rem 1rem; cursor: pointer; box-shadow: var(--ombre);
                font: inherit; line-height: 1.45; }
.carte-nature:hover { background: var(--ligne-survol); border-color: var(--accent); }
.apercu-mission { background: var(--pre-fond); border: 1px solid var(--bord);
                  border-radius: .6rem; padding: .75rem; white-space: pre-wrap; }
.var-manquante { color: var(--danger); font-weight: 600; }
.var-contact { color: var(--accent); }
/* Le marqueur d'obligation. Il a changé de glyphe le 02/08/2026 à la demande
   du propriétaire : ⛔ (sens interdit) est devenu ⚠ (avertissement) — un champ
   à remplir n'est pas un interdit. Sa couleur change avec lui, et ce n'est
   pas cosmétique : ⛔ est un emoji COULEUR, qui peignait ses propres teintes
   et ignorait la règle CSS ; ⚠ se dessine en monochrome sous Windows, donc
   la couleur devient enfin visible. Le rouge « danger » se lirait alors comme
   une faute déjà commise — on prend l'ambre que le produit associe déjà à ⚠
   ailleurs (.st-manque). Ne pas toucher à --danger : .var-manquante,
   .erreurs et button.danger en dépendent. */
.obligatoire { color: var(--p-manque-t); }
/* « à venir » : ce que le produit DÉCRIT sans encore le faire. Ces deux
   règles n'habillent plus aucun élément depuis que R15 est refermée
   (01/08/2026) — les deux portes de création sont réelles. Elles restent
   parce que le principe, lui, reste : ce qui n'est pas construit se dit à
   l'écran, en gris, plutôt que de se taire. */
.a-venir { color: var(--sourd); }
.a-venir input, .a-venir a { color: var(--sourd); }
.badge-a-venir { display: inline-block; padding: .05rem .5rem;
                 border-radius: 1rem; background: var(--p-ignore-f);
                 color: var(--p-ignore-t); font-size: .82rem; }
tr.ligne-acceptee td { background: var(--p-confirme-f); }
details > summary { cursor: pointer; }
/* Calendrier de la semaine type : une case = une tranche (durée moyenne
   d'un rendez-vous). On appuie, on glisse, on relâche : la période bascule. */
/* ⚠ LARGEUR FIXE, et c'est voulu. La règle générale « table { width: 100% } »
   faisait épouser au calendrier la largeur de son contenant : 746 px sur la
   page des ⚙ Réglages, 674 px dans la fenêtre de l'installeur — mêmes
   couleurs, mêmes bordures, mais des colonnes plus étroites d'un côté, donc
   deux calendriers qui ne se ressemblaient pas (signalé le 03/08/2026). Une
   tranche mesure maintenant la MÊME chose partout, quel que soit l'écran qui
   l'accueille ; sur un écran étroit, le tableau défile dans sa zone. */
table.calendrier { table-layout: fixed; user-select: none; margin-top: .4rem;
                   width: auto; min-width: 44rem; }
table.calendrier td.tranche { width: 5.6rem; }
/* La zone défile plutôt que de laisser le tableau se faire écraser : mieux
   vaut faire glisser un calendrier à la bonne taille que d'en montrer un
   déformé. Sur les deux écrans du produit, il tient sans défiler. */
.zone-calendrier { overflow-x: auto; }
/* ⚠ LE CADRE DES CALENDRIERS SE FERMAIT MAL. Deux défauts vus sur une capture
   du propriétaire (03/08/2026), tous deux mesurés ensuite :
   · les cases ne portent que « border-bottom » et « border-left », donc la
     DERNIÈRE colonne n'avait aucun trait à droite : la grille restait ouverte
     de ce côté (bordure droite mesurée à 0 px) ;
   · le tableau a bien un arrondi (.7rem) mais « overflow: hidden » ne rogne
     PAS les cellules d'un tableau : leur fond opaque et carré remplissait les
     coins, et l'arrondi ne se voyait nulle part. Ce sont les quatre cases
     d'angle qui doivent le reprendre.
   Les deux calendriers partagent ces règles : le planning des rendez-vous et
   la semaine type des réglages. */
/* ⚠ LE CADRE DES CALENDRIERS SE FERMAIT MAL. Deux défauts vus sur une capture
   du propriétaire (03/08/2026), tous deux mesurés ensuite :
   · les cases ne portent que « border-bottom » et « border-left », donc la
     DERNIÈRE colonne n'avait aucun trait à droite : la grille restait ouverte
     de ce côté (bordure droite mesurée à 0 px) ;
   · le tableau a bien un arrondi (.7rem) mais « overflow: hidden » ne rogne
     PAS les cellules d'un tableau : leur fond opaque et carré remplissait les
     coins, et l'arrondi ne se voyait nulle part. Ce sont les quatre cases
     d'angle qui doivent le reprendre.
   Les deux calendriers partagent ces règles : le planning des rendez-vous et
   la semaine type des réglages.

   ⚠ NE PAS Y TOUCHER SANS DEMANDE EXPRESSE. Cet état a été atteint après
   plusieurs essais, et deux tentatives de « mieux faire » l'ont dégradé le
   03/08/2026 : retirer le trait de droite, puis quadriller l'entête et la
   colonne des heures. Le propriétaire a fait revenir à CETTE version-ci,
   trait de droite compris. */
table.planning th:last-child, table.planning td:last-child,
table.calendrier th:last-child, table.calendrier td.tranche:last-child {
    border-right: 1px solid var(--trait-calendrier); }
table.planning tr:first-child th:first-child,
table.calendrier tr:first-child th:first-child { border-top-left-radius: .65rem; }
table.planning tr:first-child th:last-child,
table.calendrier tr:first-child th:last-child { border-top-right-radius: .65rem; }
table.planning tr:last-child th:first-child,
table.calendrier tr:last-child th:first-child { border-bottom-left-radius: .65rem; }
table.planning tr:last-child td:last-child,
table.calendrier tr:last-child td.tranche:last-child {
    border-bottom-right-radius: .65rem; }
table.calendrier caption { caption-side: bottom; text-align: left;
                           padding: .35rem .1rem; font-size: .85rem; }
table.calendrier th[scope="col"] { text-align: center; }
table.calendrier th[scope="row"] { width: 4.2rem; font-size: .78rem;
                                   color: var(--sourd); text-transform: none;
                                   padding: 0 .5rem; border-bottom: none; }
/* ⚠ LE MÊME FOND ET LE MÊME TRAIT QUE LE PLANNING. Les deux calendriers du
   produit ne se ressemblaient pas : celui-ci séparait ses cases avec --bord
   (luminance 0,034 en sombre, presque invisible) là où le planning employait
   un trait clair. Signalé le 03/08/2026. Ils partagent désormais la même
   variable — c'est la seule façon qu'ils ne divergent plus. */
table.calendrier td.tranche { height: 1.05rem; padding: 0;
                              border-bottom: 1px solid var(--trait-calendrier);
                              border-left: 1px solid var(--trait-calendrier);
                              background: var(--fond); cursor: pointer; }
table.calendrier tr.heure-pleine td.tranche {
                              border-top: 1px solid var(--trait-calendrier); }
table.calendrier td.tranche.ouverte { background: var(--creneau-libre); }
table.calendrier td.tranche.en-cours { background: var(--accent); }
table.calendrier td.tranche:hover { outline: 2px solid var(--accent);
                                    outline-offset: -2px; }
table.calendrier tr:hover td { background: inherit; }
table.calendrier tr:hover td.tranche.ouverte { background: var(--creneau-libre); }
/* La lettre « o »/« f » n'est là que pour les lecteurs d'écran et le
   repli : la couleur seule ne doit jamais porter l'information. */
.lecture-seule { position: absolute; width: 1px; height: 1px; overflow: hidden;
                 clip: rect(0 0 0 0); white-space: nowrap; }
#calendrier.en-attente { opacity: .55; }
/* --------------------------------------------------------------------
   Planning de la semaine (📅 Rendez-vous) : MÊME découpage que la semaine
   type ci-dessus — les tranches libres portent exactement le vert du
   calendrier des réglages (var(--p-confirme-f), clair ET sombre), les
   rendez-vous sont des TUILES posées dessus. Un rendez-vous de N tranches
   consécutives est UNE tuile de hauteur N (rowspan), jamais N cases.
   -------------------------------------------------------------------- */
#planning.en-attente { opacity: .55; }
.barre-planning { display: flex; align-items: flex-end; gap: .6rem;
                  flex-wrap: wrap; margin: .3rem 0 .5rem; }
.barre-planning label { display: block; font-size: .82rem; color: var(--sourd); }
.barre-planning select, .barre-planning input[type="date"] {
    padding: .35rem .5rem; border: 1px solid var(--bord); font: inherit;
    color: var(--texte); background: var(--carte); border-radius: .45rem; }
.barre-planning .groupe { display: flex; align-items: flex-end; gap: .35rem; }
table.planning { table-layout: fixed; margin-top: .4rem; }
table.planning caption { caption-side: bottom; text-align: left;
                         padding: .35rem .1rem; font-size: .85rem; }
table.planning th[scope="col"] { text-align: center; font-size: .78rem;
                                 text-transform: none; letter-spacing: 0;
                                 padding: .3rem .2rem; }
table.planning th[scope="col"] .jour-date { display: block; color: var(--texte);
                                            font-weight: 700; }
table.planning th[scope="col"].jour-ferme .jour-date { color: var(--sourd); }
/* L'en-tête d'un jour CHOISIT la journée entière (son défaut n° 9 du
   18/08/2026 : la colonne fait 830 pixels pour 720 visibles, le glissé ne
   pouvait pas la couvrir). Il doit donc se voir comme cliquable — d'où le
   curseur et le soulignement au survol — sans crier plus fort que la grille. */
table.planning th[scope="col"] .jour-entier { display: block; color: inherit;
                                              text-decoration: none;
                                              border-radius: .25rem; }
table.planning th[scope="col"] .jour-entier:hover,
table.planning th[scope="col"] .jour-entier:focus-visible {
    background: var(--ligne-survol); text-decoration: underline; }
table.planning th[scope="row"] { width: 4.2rem; font-size: .78rem;
                                 color: var(--sourd); text-transform: none;
                                 padding: 0 .5rem; border-bottom: none; }
/* LE QUADRILLAGE SE VOIT SUR LE VERT. Les traits entre demi-heures et entre
   jours employaient --bord, presque invisible sur le vert des créneaux
   libres en thème sombre (constaté par le propriétaire le 02/08/2026). Ils
   prennent le MÊME gris que les traits d'heure (--sourd), comme demandé. La
   hiérarchie ne se perd pas : une ligne d'heure pleine porte EN PLUS son
   trait du haut, donc elle reste deux fois plus épaisse que les autres. */
table.planning td { height: 1.25rem; padding: 0; vertical-align: top;
                    border-bottom: 1px solid var(--trait-calendrier);
                    border-left: 1px solid var(--trait-calendrier);
                    background: var(--fond); }
table.planning tr.heure-pleine td { border-top: 1px solid var(--trait-calendrier); }
table.planning td.libre { background: var(--creneau-libre); cursor: pointer; }
/* ⚠ LE SURVOL DE LIGNE NE DOIT RIEN REPEINDRE — ET « inherit » NE SUFFIT PAS.
   Le tableau générique éclaire la ligne survolée ; sur une grille horaire,
   éclairer douze cases quand la souris en frôle une n'a aucun sens. Le
   « background: inherit » posé pour l'annuler prenait le fond du <tr>, qui
   n'en a aucun : la case devenait TRANSPARENTE et laissait voir la page —
   toute la ligne blanchissait en thème clair, le vert des places libres
   compris (signalé par le propriétaire le 09/08/2026). On RÉTABLIT donc
   chaque état, exactement comme le calendrier des Réglages le fait pour ses
   tranches ouvertes. Toute case neuve devra passer ici aussi. */
table.planning tr:hover td { background: var(--fond); }
table.planning tr:hover td.libre { background: var(--creneau-libre); }
/* ⚠ LE SURVOL NE DOIT RIEN PROMETTRE QU'IL NE TIENT. Il visait toutes les
   cases libres, passées comprises — or une case passée ne porte PAS de
   data-modale (voir _case_libre) : le liseré annonçait un clic qui ne se
   produisait jamais. L'atténuation le masquait ; elle est partie, le défaut
   s'est vu. On s'appuie sur l'attribut lui-même, seul marqueur d'ouvrabilité
   présent dans le HTML. */
table.planning td.libre[data-modale]:hover { outline: 2px solid var(--accent);
                                             outline-offset: -2px; }
/* ⚠ UN SEUL VERT POUR LES TROIS GRILLES : celui des réglages, à pleine force.
   Ce bloc a d'abord atténué les créneaux passés à 40 % d'opacité, puis à
   65 % ; dans les deux cas le vert perdait de la saturation (64 % → 46 %,
   puis 55 %) et « Rendez-vous » ne ressemblait plus au calendrier des
   réglages. Plus aucune atténuation — décision du propriétaire du 03/08/2026 :
   reprendre les couleurs de Réglages > Agenda partout.
   L'information ne se perd pas, parce qu'elle n'a JAMAIS reposé sur la
   couleur seule : la case passée porte son état en mots dans son infobulle
   ET dans son texte de lecture d'écran (« libre, déjà passé »), elle n'a pas
   de data-modale — donc aucun clic — et son curseur reste neutre. */
table.planning td.libre.revolue { cursor: default; }
table.planning td.cible { outline: 3px solid var(--accent);
                          outline-offset: -3px; }
table.planning td.tuile { padding: 1px; cursor: pointer; }
.tuile-int { display: block; height: 100%; overflow: hidden; padding: 0 .25rem;
             border-radius: .3rem; font-size: .72rem; line-height: 1.15;
             text-decoration: none; }
.tuile-int strong { font-weight: 700; }
.tuile-int .tuile-heure { opacity: .8; }
/* La coche des rendez-vous CONFIRMÉS (11/08/2026). Elle vient AVANT le nom,
   pour se retrouver toujours au même endroit d'une tuile à l'autre, et elle
   est un peu plus petite que le texte : elle signale, elle ne domine pas.
   Le mot « confirmé », lui, est dans l'infobulle — la coche ne le remplace
   pas (voir _case_tuile). */
.tuile-int .coche-confirme { font-size: .68em; margin-right: .15rem; }
.pave-legende { display: inline-block; width: .85rem; height: .85rem;
                border-radius: .2rem; vertical-align: -1px;
                border: 1px solid var(--bord); }
.pave-legende.libre { background: var(--creneau-libre); }
.pave-legende.ferme { background: var(--fond); }
/* La modale : détail d'un rendez-vous, d'un créneau libre ou d'un client.
   Elle se ferme au clic à l'extérieur et à la touche Échap.
   L'installeur emprunte le même fond (« .fond-modale ») sans se fermer au
   clic extérieur : on n'en sort pas par mégarde, on répond « plus tard ». */
#fond-modale[hidden], .fond-modale[hidden] { display: none; }
#fond-modale, .fond-modale {
               position: fixed; top: 0; right: 0; bottom: 0; left: 0;
               background: rgba(8,16,26,.55); z-index: 50; display: flex;
               align-items: center; justify-content: center; padding: 1rem; }
/* Un texte réservé aux lecteurs d'écran : la croix et la coche du fil
   d'Ariane sont des SIGNES, il leur faut aussi des mots. */
.sr-seulement { position: absolute; width: 1px; height: 1px; overflow: hidden;
                clip: rect(0 0 0 0); clip-path: inset(50%);
                white-space: nowrap; }
.modale { background: var(--carte); color: var(--texte); width: 100%;
          max-width: 32rem; max-height: 86vh; overflow: auto;
          border: 1px solid var(--bord); border-radius: .9rem;
          box-shadow: var(--ombre); padding: 1rem 1.2rem 1.2rem; }
.modale h2 { margin-top: 0; }
.entete-modale { display: flex; align-items: flex-start; gap: .8rem;
                 justify-content: space-between; }
.modale dl { display: grid; grid-template-columns: auto 1fr; gap: .25rem .8rem;
             margin: .6rem 0; }
.modale dt { color: var(--sourd); font-size: .88rem; }
.modale dd { margin: 0; }
/* ------------------------------------------------------------------------
   LA FENÊTRE DE CHARGEMENT (16/08/2026, sa demande)
   ------------------------------------------------------------------------
   « Remplace carrément la modale par un "chargement…" avec un spinner animé.
   Cette modale ne peut pas être fermée, elle l'est lorsque le chargement est
   finalisé. » Pendant qu'un agenda se lit, la fenêtre d'import laisse donc
   place à celle-ci — sans bouton Fermer, et le clic extérieur comme la touche
   Échap n'y font rien (voir `verrouillee` dans SCRIPT_MODALE).
   ⚠ LA ROUE NE PORTE JAMAIS L'INFORMATION SEULE : le mot « Chargement… » est
   à côté, en toutes lettres. Une animation ne se lit pas. */
.modale-chargement { max-width: 22rem; text-align: center;
                     padding: 2.2rem 1.6rem; }
.rondelle { width: 2.6rem; height: 2.6rem; margin: 0 auto .9rem;
            border: .28rem solid var(--bord);
            border-top-color: var(--accent); border-radius: 50%;
            animation: rb-tourne .8s linear infinite; }
@keyframes rb-tourne { to { transform: rotate(360deg); } }
.titre-chargement { margin: 0 0 .35rem; font-size: 1.15rem; font-weight: 600; }
.modale-chargement p.sourd { margin: 0; color: var(--sourd);
                             font-size: .9rem; }
/* ⚠ CEUX QUI ONT DEMANDÉ MOINS D'ANIMATION SONT ÉCOUTÉS : la roue s'arrête,
   le mot reste. L'information ne dépendait pas d'elle, rien n'est perdu. */
@media (prefers-reduced-motion: reduce) {
  .rondelle { animation: none; border-top-color: var(--accent); }
}
/* ------------------------------------------------------------------------
   LES DEUX MODES DE SAISIE — « simplifié » et « avancé »
   ------------------------------------------------------------------------
   Le mode est écrit sur <main> ; tout ce qui porte « avance » disparaît en
   mode simplifié. Les champs restent DANS la page (ils partent avec le
   formulaire, avec leur valeur venue des Réglages) : basculer ne perd rien,
   et c'est ce qui rend un mode réduit sans danger. */
main[data-mode="simplifie"] .avance { display: none; }
.barre-mode { display: flex; align-items: center; gap: .45rem;
              flex-wrap: wrap; margin: .5rem 0 .9rem; }
.barre-mode .sourd { font-size: .85rem; }
.bascule-mode { background: var(--carte); color: var(--texte);
                border: 1px solid var(--bord); border-radius: .5rem;
                padding: .3rem .75rem; font: inherit; cursor: pointer; }
.bascule-mode:hover { border-color: var(--accent); }
/* ------------------------------------------------------------------------
   LE MENU HORIZONTAL DE L'ÉTAPE 2 (15/08/2026, sa demande)
   ------------------------------------------------------------------------
   En mode avancé, « B. Options de comportement » et « C. Aperçu du message »
   s'empilaient : la page devenait longue, et il fallait faire défiler pour
   voir l'un ou l'autre. Ils deviennent deux entrées d'un menu horizontal, et
   l'on n'en voit qu'une à la fois.
   ⚠ CHAQUE ENTRÉE PORTE SON MOT ENTIER — « B. Options de comportement », pas
   une icône ni une lettre seule. */
.menu-etape2 { display: flex; gap: .35rem; flex-wrap: wrap;
               border-bottom: 1px solid var(--bord); margin: 1.1rem 0 0; }
.onglet-etape2 { background: none; color: var(--sourd); border: 1px solid
                 transparent; border-bottom: none; border-radius: .5rem .5rem 0 0;
                 padding: .45rem .9rem; font: inherit; font-weight: 600;
                 cursor: pointer; margin-bottom: -1px; }
.onglet-etape2:hover { color: var(--texte); }
.onglet-etape2[aria-selected="true"] { background: var(--carte);
                 color: var(--texte); border-color: var(--bord);
                 border-bottom: 1px solid var(--carte); }
.panneau-etape2 { padding-top: .9rem; }
.panneau-etape2 > h2:first-child { margin-top: 0; }
.bascule-mode.actif { background: var(--accent); color: var(--accent-texte);
                      border-color: var(--accent); font-weight: 600; }
/* UNE CASE OBLIGATOIRE VIDE, dans la grille des personnes. Elle se voit sans
   qu'on lise quoi que ce soit — c'est tout l'objet du changement du
   02/08/2026 : une seule phrase d'erreur au-dessus, et la couleur qui dit OÙ.
   Le fond reste très pâle pour que la valeur qu'on tape par-dessus reste
   lisible, y compris en thème sombre. La classe part à la première frappe
   (script de la page), donc cette règle ne survit jamais à la correction. */
input.manque, select.manque, textarea.manque {
    background: var(--danger-fond); border-color: var(--danger);
    outline: 1px solid var(--danger); outline-offset: -1px; }
input.manque:focus { outline-color: var(--accent); }
/* (La liste des trois verrous de CALL-E a quitté l'écran le 10/08/2026 : la
   partie ne porte plus que la clé. Sa règle de style est partie avec elle — un
   style que rien n'emploie finit par tromper le lecteur.) */
/* La pagination de la page Contacts : quatre boutons et un repère, sur une
   ligne. Elle est répétée AU-DESSUS et EN DESSOUS du tableau — sur cent
   lignes, remonter chercher le bouton suivant est une corvée.
   CENTRÉE (demande du propriétaire, 10/08/2026) : le tableau prend toute la
   largeur, une barre collée à gauche paraissait décrochée de lui. Les DEUX
   copies le sont — elles sortent du même HTML, et n'en centrer qu'une aurait
   ressemblé à un défaut plutôt qu'à un choix. */
.pagination { display: flex; align-items: center; justify-content: center;
              gap: .4rem; flex-wrap: wrap; margin: .6rem 0; }
.pagination .page-nav { min-width: 2.4rem; }
.pagination button[disabled] { opacity: .45; cursor: default; }
/* ⚙ Réglages : menu à gauche, la section choisie à droite. Sans JavaScript
   les sections restent toutes visibles et le menu est une table des
   matières — c'est pour cela qu'aucune n'est masquée par la feuille de
   style : c'est le script qui masque, et lui seul. */
.reglages-deux-parts { display: grid; gap: 1.4rem;
                       grid-template-columns: minmax(10rem, 14rem) minmax(0, 1fr);
                       align-items: start; }
.menu-reglages { display: flex; flex-direction: column; gap: .15rem;
                 position: sticky; top: .8rem; }
.menu-reglages-titre { display: block; width: 100%; text-align: left;
                       font: inherit; font-weight: 600; cursor: pointer;
                       padding: .45rem .7rem; border-radius: .5rem;
                       background: none; color: var(--texte);
                       border: 1px solid transparent; }
.menu-reglages-titre:hover { background: var(--ligne-survol); }
.menu-reglages-titre.actif { background: var(--carte); border-color: var(--bord); }
/* Le chevron dit si la partie est dépliée — sans image et sans script : il
   suit l'attribut que le script pose déjà pour les lecteurs d'écran. */
.menu-reglages-titre::before { content: "\\25B8 "; color: var(--sourd); }
.menu-reglages-titre[aria-expanded="true"]::before { content: "\\25BE "; }
.menu-reglages-sous { display: flex; flex-direction: column; gap: .1rem;
                      margin: .1rem 0 .35rem .55rem;
                      border-left: 1px solid var(--bord); padding-left: .5rem; }
.menu-reglages-sous-item { display: block; padding: .35rem .55rem;
                           border-radius: .45rem; text-decoration: none;
                           color: var(--texte); font-size: .93rem; }
.menu-reglages-sous-item:hover { background: var(--ligne-survol); }
.menu-reglages-sous-item.actif { background: var(--carte); font-weight: 600; }
.section-reglages > :first-child { margin-top: 0; }
/* LA VUE PREND TOUTE SA LARGEUR (demande du propriétaire) : c'est la règle
   générale « .carte { max-width: 28rem } » qui la bridait, pas la grille. On
   ne la relâche QUE dans les réglages — ailleurs, une carte étroite reste
   plus lisible. */
.vue-reglages .carte { max-width: none; }
@media (max-width: 40rem) {
  .reglages-deux-parts { grid-template-columns: 1fr; }
  .menu-reglages { position: static; }
}
/* Les voies de remplissage, sur DEUX colonnes : à gauche ce qu'on apporte
   soi-même (collage, fichiers), à droite ce qu'on reprend de RingBack. */
.deux-colonnes { display: grid; gap: .3rem 1.6rem;
                 grid-template-columns: repeat(2, minmax(0, 1fr)); }
.deux-colonnes h3 { margin: .2rem 0 .35rem; font-size: .92rem;
                    color: var(--sourd); font-weight: 600; }
@media (max-width: 34rem) { .deux-colonnes { grid-template-columns: 1fr; } }
/* Le texte entier d'un détail : il vient d'une réponse d'API ou d'un message
   long, il garde donc ses retours à la ligne et ne déborde pas. Sert à la
   demande d'un client, sur 🔁 Relances (« Voir sa demande… »).
   « .detail-tronque » vivait ici : parti le 11/08/2026 avec la colonne
   « Détail » du tableau des contacts, plus rien ne porte cette classe. */
.detail-entier { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
/* 🔁 Relances : un menu des TYPES de rappel, chacun avec son nombre. Le
   paragraphe d'introduction disait la même chose à tout le monde quel que
   soit l'état de la liste ; le menu, lui, dit ce qu'il y a et mène droit
   dessus. Le panneau visible est celui du lien actif — et c'est le SERVEUR
   qui masque les autres (attribut hidden), pas la feuille de style : sans
   JavaScript, le lien recharge la page avec ?vue= et tout fonctionne. */
/* ⚠ LES QUATRE BOUTONS SUR UNE SEULE LIGNE, sur toute la largeur de la zone
   de contenu (21/08/2026, sa demande). Ils passaient à la ligne au gré du
   texte : le menu changeait de hauteur d'un écran à l'autre, et on ne
   retrouvait pas un onglet là où on l'avait laissé.
   `flex: 1` les fait partager la largeur à parts égales ; sur un écran étroit
   (téléphone), on redonne le droit d'aller à la ligne — quatre pastilles
   écrasées ne se liraient plus. */
.menu-familles { display: flex; flex-wrap: nowrap; gap: .4rem;
                 margin: .9rem 0 1.2rem; }
/* ⚠ « CENTRER LE TEXTE VERTICALEMENT DANS LE BOUTON » (21/08/2026, sa
   demande). `baseline` alignait le libellé et son nombre sur la ligne
   d'écriture : dans une pastille haute, le texte se collait au bas. `center`
   le pose au milieu — et les deux morceaux (le mot et le nombre) restent
   alignés entre eux, puisqu'ils partagent la même hauteur de ligne. */
.menu-familles a { display: inline-flex; align-items: center;
                   justify-content: center; gap: .35rem; flex: 1 1 0;
                   min-width: 0;
                   padding: .4rem .8rem; border-radius: 999px;
                   border: 1px solid var(--bord); background: var(--carte);
                   color: var(--texte); text-decoration: none;
                   font-size: .95rem; text-align: center; }
@media (max-width: 46rem) {
  .menu-familles { flex-wrap: wrap; }
  .menu-familles a { flex: 1 1 auto; }
}
.menu-familles a:hover { background: var(--ligne-survol); }
.menu-familles a.actif { background: var(--accent); color: var(--accent-texte);
                         border-color: var(--accent); font-weight: 600; }
.famille-nombre { color: var(--sourd); font-variant-numeric: tabular-nums; }
.menu-familles a.actif .famille-nombre { color: inherit; }
.panneau-relance > :first-child { margin-top: 0; }
/* Le titre et son « ? » sur la même ligne : le rond doit se lire comme
   l'accessoire du titre, pas comme un élément de plus au-dessus de la liste. */
.entete-panneau { display: flex; align-items: center; gap: .5rem;
                  flex-wrap: wrap; }
.entete-panneau h2 { margin: 0; }
.vide-famille { color: var(--sourd); }
/* L'INSTALLEUR DU PREMIER LANCEMENT. Une fenêtre à part : à gauche un MENU
   ARBORESCENT des quatre sections, dont « Comportement de l'agent IA » se
   déplie sur les campagnes ; sous lui, les pages de la section où l'on est ;
   à droite, la page elle-même.
   ⚠ La page d'accueil n'affiche AUCUNE de ces deux navigations : elles
   arrivent quand la configuration démarre (demande du propriétaire du
   03/08/2026) — on ne navigue pas dans quelque chose qu'on n'a pas commencé.
   ⚠ Aucune icône décorative dans ce menu : seules la coche et la croix, qui
   PORTENT une information. Les pictogrammes de section (cotillon, téléphone,
   calendrier) ont été retirés le 03/08/2026. */
/* ⚠ HAUTEUR CONSTANTE. La fenêtre respirait de 349 à 774 pixels selon la
   page ouverte — mesuré le 03/08/2026 — et sautait sous les yeux à chaque
   déplacement. Elle a maintenant une taille fixe, et c'est le CONTENU qui
   défile : les deux colonnes ont leur propre ascenseur. */
.modale.installeur { max-width: 66rem; width: 100%;
                     height: min(80vh, 44rem);
                     display: flex; flex-direction: column; }
/* ⚠ L'ACCUEIL ET LA FIN S'AJUSTENT À LEUR CONTENU. Elles n'ont ni menu de
   pages, ni formulaire : un texte court et un bouton. La hauteur imposée
   leur laissait un tiers d'écran vide (03/08/2026). Les pages de
   configuration, elles, la gardent — c'est entre elles qu'on navigue, et
   c'est là que le saut se voyait. */
.modale.installeur.installeur-libre { height: auto;
                                      max-height: min(80vh, 44rem); }
.modale.installeur > .installeur-deux-parts,
.modale.installeur > .page-installeur { flex: 1; min-height: 0;
                                        overflow-y: auto; }
/* Le titre de ces deux pages-là porte l'écran entier : il doit se détacher
   du texte qui le suit. */
.installeur-libre .page-installeur h2 { font-size: 1.75rem;
                                        line-height: 1.2;
                                        margin-bottom: .9rem; }
/* La croix et la coche : la couleur seule ne dit rien à qui ne la voit pas,
   le SIGNE porte donc l'information et la couleur ne fait que l'appuyer. */
.marque-partie { font-weight: 700; }
.marque-partie.a-faire { color: var(--danger); }
.marque-partie.faite { color: var(--p-confirme-t); }
.installeur-deux-parts { display: grid; gap: 1.4rem;
                         grid-template-columns: minmax(11rem, 15rem) minmax(0, 1fr);
                         align-items: stretch; }
.installeur-deux-parts > * { min-height: 0; overflow-y: auto; }
/* LE BANDEAU DES SECTIONS : horizontal, en haut, aux couleurs du bandeau de
   l'application — donc juste en clair comme en sombre, sans rien inventer.
   « Comportement de l'agent IA » déroule un panneau VERTICAL qui se pose
   par-dessus le contenu : il ne pousse rien, la hauteur ne bouge pas. */
.barre-installeur { display: flex; flex-wrap: wrap; align-items: stretch;
                    background: var(--banniere); color: var(--banniere-texte);
                    border-radius: .55rem; margin-bottom: 1rem;
                    position: relative; z-index: 3; }
.barre-installeur button { font: inherit; cursor: pointer; border: 0;
                           background: none; color: inherit;
                           display: inline-flex; align-items: center;
                           gap: .4rem; padding: .6rem 1rem;
                           border-radius: .55rem; }
.barre-installeur button:hover { background: rgba(255, 255, 255, .10); }
.barre-installeur button.actif { background: rgba(255, 255, 255, .16);
                                 font-weight: 600; }
/* ⚠ LES MARQUES CHANGENT DE TEINTE SUR LE BANDEAU. Le rouge et le vert des
   cartes y sont ILLISIBLES : mesuré à 1,88 et 1,97 de contraste sur le
   bandeau clair — autant dire invisibles. Ces deux teintes-ci tiennent sur
   les DEUX bandeaux (6,06 et 7,36 en clair ; 9,15 et 11,11 en sombre), une
   seule définition suffit donc. */
.barre-installeur .marque-partie.a-faire,
.panneau-deroulant .marque-partie.a-faire { color: #ff9aa2; }
.barre-installeur .marque-partie.faite,
.panneau-deroulant .marque-partie.faite { color: #8fd9a4; }
.entree-deroulante { position: relative; display: inline-flex; }
.panneau-deroulant { position: absolute; top: 100%; left: 0; z-index: 20;
                     display: flex; flex-direction: column; min-width: 100%;
                     white-space: nowrap; background: var(--banniere);
                     color: var(--banniere-texte);
                     border-radius: 0 0 .55rem .55rem;
                     box-shadow: 0 10px 24px rgba(0, 0, 0, .28); }
.panneau-deroulant button { border-radius: 0; padding: .55rem 1rem; }
.panneau-deroulant button:first-child { border-radius: .55rem .55rem 0 0; }
.panneau-deroulant button:last-child { border-radius: 0 0 .55rem .55rem; }
.panneau-deroulant button:hover { background: rgba(255, 255, 255, .12); }
.panneau-deroulant button.actif { background: rgba(255, 255, 255, .18);
                                  font-weight: 600; }
/* LE MENU DES PAGES de la section courante, à gauche du formulaire. */
.menu-installeur { display: flex; flex-direction: column; gap: .1rem;
                   padding-right: .4rem; }
.menu-installeur button { display: flex; align-items: baseline; gap: .4rem;
                          width: 100%; text-align: left; font: inherit;
                          cursor: pointer; padding: .38rem .55rem;
                          border-radius: .45rem;
                          border: 1px solid transparent; background: none;
                          color: var(--texte); }
.menu-installeur button:hover { background: var(--ligne-survol); }
.menu-installeur button.actif { background: var(--carte);
                                border-color: var(--bord); font-weight: 600; }
/* LE FORMULAIRE D'UNE PÉRIODE, en tableau : quatre colonnes (Jour, Début,
   Fin, Période) et deux rangées — les entêtes, puis la saisie avec les deux
   boutons dans la dernière colonne. Demandé par le propriétaire le
   03/08/2026, aux DEUX endroits qui l'affichent (installeur et ⚙ Réglages) —
   c'est le même bloc, il ne peut donc pas y en avoir deux versions.
   ⚠ Il vit DANS une carte : ni fond, ni ombre, ni pleine largeur, sinon il
   ferait carte dans la carte. */
table.tableau-saisie { width: auto; background: none; box-shadow: none;
                       border-radius: 0; margin: .5rem 0 0; }
table.tableau-saisie th, table.tableau-saisie td { border-bottom: 0;
                                                   padding: 0 .7rem .3rem 0;
                                                   vertical-align: bottom; }
table.tableau-saisie th { font-size: .78rem; }
table.tableau-saisie td:last-child, table.tableau-saisie th:last-child {
    padding-right: 0; white-space: nowrap; }
table.tableau-saisie input, table.tableau-saisie select { margin: 0; }
.page-installeur > :first-child { margin-top: 0; }
.page-installeur .carte { max-width: none; }
/* ⚠ LE PIED NE DÉFILE PAS. Il était au bas du contenu : sur une page longue
   il fallait dérouler pour trouver le bouton, et il changeait de place à
   chaque page. « flex: none » le colle en bas de la fenêtre, et c'est la
   zone du milieu qui porte l'ascenseur. */
.pied-installeur { flex: none; display: flex; flex-wrap: wrap; gap: .6rem;
                   align-items: center; margin-top: 1rem;
                   padding-top: .9rem; border-top: 1px solid var(--bord); }
.pied-installeur .sourd { margin-left: auto; }
/* Le sélecteur de campagne et son bouton se lisent ensemble : « prendre
   CELLE-CI ». Ils sont donc côte à côte, alignés sur leur bas. */
.ligne-copie { display: flex; flex-wrap: wrap; gap: .7rem;
               align-items: flex-end; }
.ligne-copie .champ-option { margin: 0; }
.installeur-accueil { text-align: center; padding: 1rem 0 .5rem; }
.installeur-accueil .gros-bouton { font-size: 1.15rem; padding: .7rem 1.6rem; }
/* Les quatre points de configuration de l'accueil, dans le bleu du bouton
   « Démarrer » : ce sont eux qu'on vient régler, ils doivent se repérer. */
.point-config { color: var(--accent); }
/* Le bouton qui referme l'installeur : plus gros et en gras, c'est le seul
   geste de cette page. */
.installeur-accueil .bouton-final { font-size: 1.35rem; font-weight: 700; }
@media (max-width: 44rem) {
  .installeur-deux-parts { grid-template-columns: 1fr; }
  .arbre-branche { margin-left: .3rem; }
}
/* LA SÉLECTION D'UNE PLAGE SUR LE PLANNING (03/08/2026). Le surlignage vit
   dans ses PROPRES règles : rien n'est emprunté au bloc partagé des deux
   calendriers, qui porte « ne pas y toucher sans demande expresse ».
   ⚠ La couleur ne porte pas seule : le menu qui s'ouvre au relâché ÉCRIT la
   plage en mots (« du mercredi 12/08 à 09h00 au … ») et compte ce qu'elle
   contient avant de proposer quoi que ce soit. */
/* ⚠ EXACTEMENT L'APPARENCE DES RÉGLAGES (demande du 09/08/2026). Là-bas
   une tranche choisie est simplement PEINTE en accent
   (« td.tranche.en-cours »), sans liséré, et sans distinguer son état. Ici
   le liséré s'ajoutait au fond, et le fond ne touchait que les cases LIBRES :
   une case fermée ou occupée dans la même plage restait sur son fond, si bien
   qu'une sélection de dix cases n'en montrait que six. Les deux écrans
   parlent maintenant le même langage.
   ⚠ La couleur ne porte pas seule : le menu qui s'ouvre au relâché ÉCRIT la
   plage en mots (« du mercredi 12/08 à 09h00 au … ») et compte ce qu'elle
   contient avant de proposer quoi que ce soit.
   Le « tr:hover » est repris ici parce qu'il vient APRÈS dans la feuille et
   gagnerait sinon sur une case choisie de la ligne survolée. */
table.planning td.choisie,
table.planning tr:hover td.choisie { background: var(--accent); }
#planning td[data-quand] { -webkit-user-select: none; user-select: none; }
/* LE MENU LATÉRAL : c'est la fenêtre commune, posée sur le côté. Elle garde
   donc sa fermeture au clic extérieur, sur la croix et à Échap. */
/* Les marges NEGATIVES mangent la marge interieure du fond (1rem) : sans
   elles le panneau flottait a 16 px du bord — mesure. Il touche maintenant le
   bord, et seuls ses coins gauches sont arrondis. */
.modale-laterale { max-width: 26rem; margin: -1rem -1rem -1rem auto;
                   border-radius: .9rem 0 0 .9rem;
                   max-height: 100vh; overflow-y: auto; }
/* Le « ? » d'aide : un petit rond discret, posé à côté de son titre. Replié,
   il ne coûte AUCUNE place ; ouvert, son contenu s'écarte du bord pour se
   distinguer de ce qui l'entoure. */
.aide { display: inline-block; vertical-align: middle; margin-left: .4rem; }
.aide > summary { list-style: none; cursor: help; width: 1.5rem;
                  height: 1.5rem; line-height: 1.4rem; text-align: center;
                  border: 1px solid var(--bord); border-radius: 50%;
                  background: var(--fond); color: var(--sourd);
                  font-size: .85rem; font-weight: 700; }
.aide > summary::-webkit-details-marker { display: none; }
.aide > summary:hover, .aide > summary:focus { color: var(--accent);
                                              border-color: var(--accent); }
.aide[open] > summary { color: var(--accent); border-color: var(--accent); }
.aide-contenu { display: block; margin: .5rem 0 .8rem; padding: .6rem .8rem;
                border-left: 3px solid var(--accent); background: var(--fond);
                border-radius: 0 6px 6px 0; font-size: .92rem;
                max-width: 44rem; }
.aide-contenu p:first-child { margin-top: 0; }
.aide-contenu p:last-child, .aide-contenu ol:last-child { margin-bottom: 0; }
/* L'aide ouverte doit occuper sa propre ligne : à côté d'un titre, elle
   pousserait le titre. */
.aide[open] { display: block; margin-left: 0; }
.aide[open] > summary { margin-bottom: .2rem; }
/* ⚠ ANCRÉ = FOND TRANSPARENT (09/08/2026). Le panneau est collé aux cases
   choisies ; un voile à 55 % les aurait éteintes, et « collé à quoi ? »
   n'aurait plus eu de réponse visible. Le fond reste PRÉSENT — invisible mais
   cliquable — donc le clic à l'extérieur ferme toujours, et Échap aussi. */
#fond-modale.fond-ancre, .fond-modale.fond-ancre { background: transparent; }
/* (La liste des places d'une plage a été retirée le 10/08/2026 : la fenêtre
   ne garde que le compte et les quatre boutons. La règle de style est partie
   avec elle — un style que rien n'emploie finit par tromper le lecteur.) */
/* Le geste d'import, juste sous la grille du planning : c'est la suite
   naturelle du regard. */
.sous-planning { margin-top: 1rem; }
/* Un geste REPLIÉ derrière son intitulé (« Saisie manuelle des créneaux ») :
   l'intitulé se lit comme un lien, et le <details> se dévoile SANS JavaScript
   — ce qui compte ici, puisque c'est justement l'appareil sans glisser qui en
   a besoin. */
.repli-geste { margin-top: .8rem; }
.repli-geste > summary { display: inline-block; cursor: pointer;
                         color: var(--accent); text-decoration: underline;
                         font-size: .95rem; list-style: none; }
.repli-geste > summary::-webkit-details-marker { display: none; }
.repli-geste > summary::before { content: "▸ "; text-decoration: none;
                                 display: inline-block; }
.repli-geste[open] > summary::before { content: "▾ "; }
.repli-geste > summary:hover, .repli-geste > summary:focus {
    color: var(--accent-survol); }
.repli-contenu { display: block; }
.repli-contenu > .carte { margin-top: .5rem; }
/* La bascule « Automatique / Manuel » de l'étape ③. Elle reprend l'allure de
   la bascule d'affichage — même geste apparent — mais PAS sa mécanique :
   celle-ci change ce qui est envoyé au serveur. */
.rangee-bascule { display: flex; align-items: center; gap: .5rem;
                  flex-wrap: wrap; margin: 1.2rem 0 .4rem; }
/* Les deux boutons de mode restent DANS LEUR FORMULAIRE (ils l'envoient) ; la
   rangée, elle, est un simple alignement. Sans ce groupe, le formulaire aurait
   compté pour UN élément de la rangée et les deux boutons se seraient
   empilés. */
.rangee-bascule .groupe-mode { display: flex; align-items: center; gap: .5rem;
                               flex-wrap: wrap; }
/* « Valider — créer la campagne » vit dans cette rangée depuis le 09/08/2026,
   POUSSÉ À DROITE. La marge automatique le sépare des boutons de mode : ce
   n'est pas un troisième choix de mode, c'est le geste qui conclut l'étape. */
.rangee-bascule .valider-campagne { margin-left: auto; font-size: 1.05rem; }
/* ⚠ PLEINE LARGEUR, comme la grille du mode manuel (09/08/2026). « .carte »
   plafonne à 28 rem — parfait pour un formulaire isolé, faux ici : les deux
   modes du même écran doivent occuper la même place, sinon basculer donne
   l'impression de changer de page. */
.panneau-automatique { margin-top: .4rem; max-width: none; }
/* Ses trois choix tiennent sur une ligne : ce sont trois champs courts, et
   étalés sur toute la largeur ils auraient été trois selects démesurés. */
.panneau-automatique .rangee-regle { display: flex; gap: 1rem;
                                     flex-wrap: wrap; align-items: flex-end; }
/* ⚠ « min-width: 0 » N'EST PAS DÉCORATIF : sans lui un élément de flex refuse
   de descendre sous la largeur de son contenu, et le premier sélecteur — dont
   la plus longue option fait toute une phrase — poussait les deux autres à la
   ligne. Mesuré : 625 px pour lui seul sur 992 disponibles. */
.panneau-automatique .rangee-regle .champ-option { flex: 1 1 15rem;
                                                   min-width: 0;
                                                   margin-bottom: 0; }
.panneau-automatique .rangee-regle select { width: 100%; min-width: 0; }
/* L'ENTÊTE DE LA GRILLE de l'étape ③ : son compte à gauche, « Ajouter des
   contacts » à DROITE (demande du propriétaire du 03/08/2026). Le bouton
   ouvre les voies de remplissage À LA PLACE de la grille — les deux ne se
   regardent plus en même temps. */
.entete-grille { display: flex; align-items: baseline;
                 justify-content: space-between; gap: 1rem;
                 flex-wrap: wrap; margin: 1.4rem 0 .6rem; }
.entete-grille h2 { margin: 0; }
.entete-grille .bouton-ajouter { margin: 0; }
.grille-vide { padding: 1.1rem; border-radius: .7rem;
               border: 1px dashed var(--bord); background: var(--carte);
               color: var(--sourd); }
.vue-ajout { margin-top: .2rem; }
/* LA LISTE DES PLACES à pourvoir d'une campagne « créneau libéré ». Le champ
   de saisie et son « + » sur une ligne, les places dessous, chacune avec sa
   croix. Ordre chronologique croissant — c'est l'ordre de RANGEMENT, il n'y
   en a pas un second pour l'affichage. */
.ligne-creneau { display: inline-flex; align-items: center; gap: .4rem; }
.ligne-creneau .ajouter-creneau { font-size: 1.1rem; line-height: 1;
                                  padding: .3rem .7rem; }
.liste-creneaux { list-style: none; margin: .45rem 0 0; padding: 0;
                  display: flex; flex-direction: column; gap: .25rem;
                  max-width: 26rem; }
.liste-creneaux li { display: flex; align-items: center;
                     justify-content: space-between; gap: .6rem;
                     padding: .3rem .55rem; border-radius: .45rem;
                     border: 1px solid var(--bord); background: var(--carte); }
.liste-creneaux .retirer-creneau { padding: .1rem .45rem; line-height: 1; }
/* Le titre d'une liste de campagnes et son « Effacer la liste », qui se pose
   à DROITE du titre — demandé par le propriétaire le 03/08/2026. */
.entete-liste { display: flex; align-items: baseline;
                justify-content: space-between; gap: 1rem;
                flex-wrap: wrap; margin: 1.6rem 0 .5rem; }
.entete-liste h2 { margin: 0; }
/* Poste de travail 👥 Contacts : filtres, états, campagnes en cours. */
.filtres { display: flex; align-items: flex-end; gap: .7rem; flex-wrap: wrap; }
.filtres label { display: block; font-size: .82rem; color: var(--sourd); }
.filtres input[type="search"], .filtres select { padding: .35rem .5rem;
    border: 1px solid var(--bord); font: inherit; color: var(--texte);
    background: var(--carte); border-radius: .45rem; }
.filtres input[type="search"] { min-width: 13rem; }
.filtres .option { align-self: center; padding-top: .9rem; }
#liste-clients.en-attente { opacity: .55; }
.etats-client { display: flex; flex-direction: column; gap: .2rem;
                align-items: flex-start; }
.mini { font-size: .82rem; }
.compteurs { display: flex; gap: .5rem; flex-wrap: wrap; margin: .4rem 0 .8rem; }
/* §4 — le bouton « ➕ Créer la campagne » : coloré, bien en vue, JAMAIS
   pleine largeur (il fait la largeur de son texte), et un bouton PAR nature
   quand le filtre mêle des états traités par des campagnes différentes. */
.creer-campagne { display: flex; gap: .6rem; flex-wrap: wrap;
                  margin: .3rem 0 .5rem; align-items: center; }
.creer-campagne form { margin: 0; }
button.creation { font-size: 1rem; font-weight: 600; padding: .55rem 1.05rem;
                  box-shadow: var(--ombre); }
.sans-campagne { margin: .2rem 0 .6rem; }
/* Le rappel « l'agenda de RingBack fait foi », montré AU MOMENT de démarrer
   une campagne — jamais en permanence : un avertissement qu'on voit partout
   ne se lit plus nulle part. */
.verif-agenda { background: var(--carte); border: 2px solid var(--avert-bord);
                border-radius: .8rem; padding: .9rem 1.15rem 1rem;
                margin: .5rem 0 1.1rem; box-shadow: var(--ombre); }
.verif-agenda:focus { outline: 2px solid var(--accent); outline-offset: 3px; }
.verif-agenda h2 { margin: 0 0 .5rem; }
.verif-agenda ul { margin: .5rem 0 .7rem; padding-left: 1.25rem; }
.verif-agenda li { margin: .28rem 0; }
.verif-agenda .erreurs { margin: .6rem 0; }
.verif-agenda .erreurs ul { margin: .35rem 0 0; }
#verification-agenda.en-attente { opacity: .55; }
.verif-boutons { display: flex; gap: .6rem; flex-wrap: wrap;
                 align-items: center; margin: .8rem 0 .4rem; }
.verif-boutons form { margin: 0; }
footer { max-width: 64rem; margin: 0 auto; padding: 0 1rem 1.5rem;
         color: var(--sourd); }
@media (max-width: 640px) {
  table { display: block; overflow-x: auto; }
  .banniere-int { padding-bottom: .4rem; }
}
"""

# Logo : combiné téléphonique entouré d'une flèche de rappel (SVG en ligne).
LOGO_SVG = """<svg class="logo" viewBox="0 0 24 24" width="38" height="38" role="img" aria-label="Logo RingBack">
<path d="M21 12a9 9 0 1 1-3.5-7.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
<path d="M22.6 1.9l-.7 5.3-4.6-2.7z" fill="currentColor"/>
<g transform="translate(5.6,5.6) scale(0.54)"><path fill="currentColor" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></g>
</svg>"""

# ---------------------------------------------------------------------------


# Navigation en onglets (code, chemin, libellé) — l'onglet actif est souligné.
# Les campagnes SONT l'accueil : la base n'est plus le centre, l'événement
# l'est. L'ancien suivi des rendez-vous reste accessible (📅 Rendez-vous).
ONGLETS = (
    ("campagnes", "/", "📣 Campagnes"),
    ("relances", "/relances", "🔁 Relances"),
    ("suivi", "/suivi", "📅 Rendez-vous"),
    ("clients", "/clients", "👥 Contacts"),
    ("reglages", "/reglages", "⚙ Réglages"),
)

# Bascule clair/sombre : détection du système au premier chargement, choix
# mémorisé (localStorage « rb-theme ») — le petit script de <head> évite un
# éclair de mauvais thème avant le rendu.
SCRIPT_THEME_TETE = """<script>
(function(){var R=document.documentElement,s=null;
try{s=localStorage.getItem('rb-theme')}catch(e){}
if(s){R.dataset.theme=s}
else if(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches){R.dataset.theme='dark'}
else{R.dataset.theme='light'}})();
</script>"""

# LE CALENDRIER DE LA SEMAINE TYPE, et plus généralement tout élément qui se
# recharge SEUL après un geste.
#
# ⚠ Écrit en DÉLÉGATION AU DOCUMENT, et c'est le point important. L'ancienne
# version cherchait « #calendrier » au chargement de la page : un calendrier
# arrivé PLUS TARD par innerHTML — celui de l'installeur — n'était donc relié
# à rien, et le glisser-relâché ne faisait rien du tout. Constaté le
# 03/08/2026. Une écoute posée une fois sur le document marche pour les deux,
# aujourd'hui et pour tout élément qu'on ajoutera ensuite.
#
# Deux mécaniques, une seule écoute :
#  · le GESTE : on appuie sur une tranche, on glisse, on relâche — toute la
#    période bascule (ouverte si elle ne l'était pas entièrement, fermée
#    sinon). La zone dit elle-même où renvoyer le résultat (data-calendrier) ;
#  · le FORMULAIRE de repli (jour + début + fin, la durée d'un rendez-vous,
#    un jour fermé) : s'il porte « data-fragment-cible », il part en arrière-
#    plan avec « fragment=1 » et sa réponse remplit CET élément. Sans cette
#    interception, le formulaire naviguait vers la page des réglages — ce qui,
#    dans l'installeur, remplaçait la fenêtre par une page entière.
#
# Sans JavaScript, rien de tout cela ne s'applique : les formulaires partent
# normalement et reviennent sur la page des réglages. Le repli tient.
SCRIPT_FRAGMENTS = """<script>
(function(){
if(!window.fetch){return}
function zoneDe(cible){
  while(cible&&cible!==document){
    if(cible.getAttribute&&cible.getAttribute('data-calendrier')!==null){
      return cible}
    cible=cible.parentNode;}
  return null;}
function celluleDe(cible,zone){
  while(cible&&cible!==zone){
    if(cible.tagName==='TD'&&cible.classList.contains('tranche')){return cible}
    cible=cible.parentNode;}
  return null;}
function remplir(cible,texte){
  var element=document.getElementById(cible);
  if(element){element.innerHTML=texte}}
/* Le calendrier remis à jour ENTRAÎNE la liste des créneaux : elle en est
   déduite. On ne la recalcule que si elle est à l'écran. */
function suivreCreneaux(){
  if(!document.getElementById('bloc-creneaux')){return}
  fetch('/reglages/creneaux').then(function(r){return r.text()})
   .then(function(h){remplir('bloc-creneaux',h)}).catch(function(){});}
var zone=null,depart=null,courante=null,jour=null;
function surligner(){
  var cases=zone.querySelectorAll('td.tranche');
  var a=Math.min(+depart.dataset.min,+courante.dataset.min);
  var b=Math.max(+depart.dataset.min,+courante.dataset.min);
  for(var i=0;i<cases.length;i++){
    var c=cases[i],m=+c.dataset.min;
    if(c.dataset.jour===jour&&m>=a&&m<=b){c.classList.add('en-cours')}
    else{c.classList.remove('en-cours')}}}
function envoyer(){
  var a=Math.min(+depart.dataset.min,+courante.dataset.min);
  var b=Math.max(+depart.dataset.min,+courante.dataset.min);
  var pas=+zone.dataset.pas||15;
  var cible=zone.getAttribute('data-calendrier')||zone.id;
  var corps='jour='+encodeURIComponent(jour)+'&debut_min='+a+
            '&fin_min='+(b+pas)+'&geste=basculer&fragment=1';
  zone.classList.add('en-attente');
  var celle=zone;
  fetch('/reglages/semaine',{method:'POST',headers:{
    'Content-Type':'application/x-www-form-urlencoded'},body:corps})
   .then(function(r){return r.text()})
   .then(function(t){remplir(cible,t);celle.classList.remove('en-attente');
     suivreCreneaux();})
   .catch(function(){celle.classList.remove('en-attente');});}
document.addEventListener('mousedown',function(e){
  var z=zoneDe(e.target);if(!z){return}
  var c=celluleDe(e.target,z);if(!c){return}
  e.preventDefault();zone=z;depart=courante=c;jour=c.dataset.jour;
  surligner();});
document.addEventListener('mouseover',function(e){
  if(!zone){return}
  var c=celluleDe(e.target,zone);
  if(c&&c.dataset.jour===jour){courante=c;surligner()}});
document.addEventListener('mouseup',function(){
  if(!zone){return}
  envoyer();zone=depart=courante=null;});
/* LES FORMULAIRES QUI RECHARGENT UN ÉLÉMENT — jamais la page. */
document.addEventListener('submit',function(e){
  var f=e.target;
  if(!f||f.tagName!=='FORM'){return}
  var cible=f.getAttribute('data-fragment-cible');
  if(!cible){return}
  e.preventDefault();
  var couples=['fragment=1'],champs=f.querySelectorAll('input,select,textarea');
  for(var i=0;i<champs.length;i++){var c=champs[i];
    if(!c.name){continue}
    if((c.type==='checkbox'||c.type==='radio')&&!c.checked){continue}
    couples.push(encodeURIComponent(c.name)+'='+encodeURIComponent(c.value));}
  /* Le bouton qui a envoyé porte souvent le geste (« ouvrir » / « fermer ») :
     un name/value de bouton ne fait pas partie des champs ci-dessus. */
  var bouton=e.submitter||f.querySelector('button[name]');
  if(bouton&&bouton.name){
    couples.push(encodeURIComponent(bouton.name)+'='+
                 encodeURIComponent(bouton.value));}
  f.classList.add('en-attente');
  fetch(f.getAttribute('action'),{method:'POST',headers:{
    'Content-Type':'application/x-www-form-urlencoded'},body:couples.join('&')})
   .then(function(r){return r.text()})
   .then(function(t){f.classList.remove('en-attente');remplir(cible,t);
     suivreCreneaux();})
   .catch(function(){f.classList.remove('en-attente')});});
})();
</script>"""

# Les 🧪 TESTEURS de l'essai réel : ajouter ou retirer un testeur recharge le
# SEUL bloc concerné (la liste), puis le SEUL aperçu « qui joue quoi » — la
# page, elle, n'est jamais rechargée. Changer le nombre d'identités demandé
# recharge le même aperçu. Sans JavaScript, les mêmes formulaires partent
# normalement et reviennent sur la page des réglages : rien n'est perdu.
SCRIPT_TESTEURS = """<script>
(function(){
var zone=document.getElementById('bloc-testeurs');
if(!zone||!window.fetch||!window.FormData||!window.URLSearchParams){return}
function apercu(){
  var vue=document.getElementById('bloc-campagne-essai');
  if(!vue){return}
  var champ=document.getElementById('nombre-identites');
  var url='/reglages/campagne-essai';
  if(champ&&champ.value){url+='?nombre='+encodeURIComponent(champ.value)}
  fetch(url).then(function(r){return r.text()})
   .then(function(h){vue.innerHTML=h}).catch(function(){});}
zone.addEventListener('submit',function(e){
  var f=e.target;
  if(!f||f.tagName!=='FORM'){return}
  e.preventDefault();
  var corps=new URLSearchParams(new FormData(f));
  corps.set('fragment','1');
  zone.classList.add('en-attente');
  fetch('/reglages/testeur',{method:'POST',headers:{
    'Content-Type':'application/x-www-form-urlencoded'},body:corps.toString()})
   .then(function(r){return r.text()})
   .then(function(t){zone.innerHTML=t;zone.classList.remove('en-attente');
     apercu();})
   .catch(function(){zone.classList.remove('en-attente');});});
document.addEventListener('change',function(e){
  if(e.target&&e.target.id==='nombre-identites'){apercu()}});
})();
</script>"""


# Le RENVOI d'essai : enregistrer ou retirer recharge le SEUL bloc concerné.
# Sans JavaScript, le même formulaire part normalement et revient sur la page
# des réglages, à l'ancre du bloc — rien n'est perdu.
SCRIPT_RENVOI_ESSAI = """<script>
(function(){
var zone=document.getElementById('bloc-renvoi-essai');
if(!zone||!window.fetch||!window.FormData||!window.URLSearchParams){return}
zone.addEventListener('submit',function(e){
  var f=e.target;
  if(!f||f.tagName!=='FORM'){return}
  e.preventDefault();
  var corps=new URLSearchParams(new FormData(f));
  corps.set('fragment','1');
  zone.classList.add('en-attente');
  fetch('/reglages/renvoi-essai',{method:'POST',headers:{
    'Content-Type':'application/x-www-form-urlencoded'},body:corps.toString()})
   .then(function(r){return r.text()})
   .then(function(t){zone.innerHTML=t;zone.classList.remove('en-attente');})
   .catch(function(){zone.classList.remove('en-attente');});});
})();
</script>"""

# La MODALE, commune à tout le site : on demande son contenu au serveur (il
# vient donc de la base, jamais d'un texte recopié dans la page), et elle se
# ferme au clic à l'extérieur comme à la touche Échap. Sans JavaScript, les
# mêmes liens mènent à la page correspondante : rien n'est perdu.
#
# ON ÉDITE DANS LA MODALE, jamais en changeant de page. Un formulaire marqué
# « data-modale-envoi » part par ce même mécanisme, et le serveur répond
# l'une de deux choses, dites par l'en-tête X-RingBack-Cible :
#   - « modale » : la saisie a été refusée — la modale revient telle quelle,
#     avec l'erreur ET les valeurs tapées (rien n'est perdu) ;
#   - un identifiant d'élément : c'est enregistré — SEUL cet élément se
#     remplit à nouveau (la tuile du planning, la ligne du client), la modale
#     se ferme, et la page n'est JAMAIS rechargée.
#
# Un troisième cas existe : la modale RESTE ouverte (elle propose la suite du
# geste) alors que la page derrière elle a changé. Elle porte alors un
# « data-rafraichir » (l'élément) et un « data-rafraichir-url » (d'où le
# reprendre) : cet élément-là se remplit à nouveau, seul, sans fermer la
# fenêtre ni recharger la page.
SCRIPT_MODALE = """<script>
(function(){
var fond=document.getElementById('fond-modale');
if(!fond||!window.fetch){return}
/* ⚠ LA FENÊTRE PEUT SE VERROUILLER (16/08/2026, sa demande). Pendant qu'un
   agenda se lit, elle devient une fenêtre « Chargement… » qu'on NE PEUT PAS
   fermer : ni par le bouton (il n'y en a plus), ni par le clic extérieur, ni
   par Échap. Elle disparaît quand le chargement aboutit — c'est-à-dire quand
   la page de compte rendu remplace celle-ci.
   Pourquoi l'interdire : la fermer ne stoppe RIEN (l'envoi est parti), mais
   laisse croire que si. On se retrouverait à recliquer « Importer », et le
   fichier passerait deux fois. */
var verrouillee=false;
function fermer(){if(verrouillee){return}
  fond.hidden=true;fond.innerHTML='';
  fond.classList.remove('fond-ancre');
  /* Le geste qui a ouvert la fenêtre peut avoir laissé une marque dans la
     page (la plage surlignée du planning). Il dit ICI comment l'effacer :
     une fenêtre ancrée qui se ferme doit emporter son ancre, sinon la
     sélection reste peinte sans rien à quoi se rattacher. */
  var apres=window.rbApresFermeture;window.rbApresFermeture=null;
  if(apres){apres()}}
function rafraichir(){
  var m=fond.querySelector('[data-rafraichir]');if(!m){return}
  var zone=document.getElementById(m.getAttribute('data-rafraichir'));
  var url=m.getAttribute('data-rafraichir-url');
  if(!zone||!url){return}
  fetch(url).then(function(r){return r.text()})
   .then(function(t){zone.innerHTML=t}).catch(function(){});}
/* ⚠ COLLÉE AUX CELLULES, PAS AU BORD DE L'ÉCRAN (demande du 09/08/2026).
   L'ancre est la boîte RÉELLE de ce qui a été sélectionné, mesurée par
   l'appelant : jamais une position recalculée à partir d'un jour et d'une
   heure, qui se décalerait au premier redimensionnement de la fenêtre. */
var MARGE_ANCRE=8;
function ancrer(ancre){
  var panneau=fond.querySelector('.modale-laterale');
  if(!panneau||!ancre){return}
  fond.classList.add('fond-ancre');
  panneau.style.margin='0';
  panneau.style.borderRadius='.9rem';
  panneau.style.position='fixed';
  panneau.style.maxHeight=(window.innerHeight-2*MARGE_ANCRE)+'px';
  var largeur=panneau.offsetWidth,hauteur=panneau.offsetHeight;
  var gauche=ancre.right+MARGE_ANCRE;
  /* Pas la place à droite (une plage du vendredi, un écran étroit) : on passe
     à GAUCHE de la plage. Elle reste l'ancre — c'est ce qui compte — et le
     panneau ne sort pas de l'écran. */
  if(gauche+largeur>window.innerWidth-MARGE_ANCRE){
    gauche=ancre.left-MARGE_ANCRE-largeur;
    if(gauche<MARGE_ANCRE){
      gauche=Math.max(MARGE_ANCRE,window.innerWidth-MARGE_ANCRE-largeur)}}
  var haut=ancre.top;
  if(haut+hauteur>window.innerHeight-MARGE_ANCRE){
    haut=window.innerHeight-MARGE_ANCRE-hauteur}
  if(haut<MARGE_ANCRE){haut=MARGE_ANCRE}
  panneau.style.left=gauche+'px';panneau.style.top=haut+'px';}
function poser(t,ancre){fond.innerHTML=t;fond.hidden=false;
  var b=fond.querySelector('.modale-fermer');if(b){b.focus()}
  ancrer(ancre);
  rafraichir()}
/* ⚠ L'EN-TÊTE DIT « c'est pour la fenêtre » — et c'est ce qui permet au
   serveur de répondre autre chose quand la demande N'EN VIENT PAS. Les envois
   de formulaire de la fenêtre le posaient déjà (voir plus bas) ; l'ouverture,
   elle, ne le posait pas, si bien qu'une même adresse ne pouvait pas
   distinguer « ouvre-moi la fenêtre » d'une navigation ordinaire.
   CE QUE ÇA A COÛTÉ, le 17/08/2026 : le panneau de plage et ses trois refus
   étaient servis nus, en pleine page — sans menu, sans lien, avec un bouton
   « Fermer ✕ » qui ne fermait rien. Il s'y est retrouvé bloqué. Voir
   `_reponse_plage`, qui lit cet en-tête. */
window.rbModale=function(url,ancre){
  fetch(url,{headers:{'X-RingBack-Fragment':'1'}})
   .then(function(r){return r.text()})
   .then(function(t){poser(t,ancre)}).catch(function(){});};
/* La même fenêtre, mais à partir d'un contenu DÉJÀ écrit par le serveur et
   posé dans la page (un <template>) : rien à aller chercher, et surtout rien
   à reconstruire en JavaScript. Sert au détail abrégé du tableau d'une
   campagne, où le texte entier accompagne déjà sa version courte. */
window.rbModaleHtml=poser;
window.rbFermerModale=fermer;
/* TOUT « data-modale » DE LA PAGE OUVRE SA FENÊTRE — une seule écoute, ici.
   Elle vivait sur la seule liste des contacts : chaque nouvel écran qui
   voulait une fenêtre devait réécrire la même boucle (constaté le
   02/08/2026 en ajoutant « Voir sa demande » aux relances). Elle est
   déléguée au document : un lien posé n'importe où fonctionne, sans une
   ligne de JavaScript de plus. Le lien reste un vrai lien : sans
   JavaScript, il mène à la page de repli. */
document.addEventListener('click',function(e){
  var cible=e.target;
  while(cible&&cible!==document){
    if(cible.getAttribute&&cible.getAttribute('data-modale')!==null){
      e.preventDefault();
      window.rbModale(cible.getAttribute('data-modale'));return}
    cible=cible.parentNode;}});
fond.addEventListener('submit',function(e){
  var f=e.target;
  if(!f||f.tagName!=='FORM'||!f.hasAttribute('data-modale-envoi')){return}
  e.preventDefault();
  var couples=[],champs=f.querySelectorAll('input,select,textarea');
  for(var i=0;i<champs.length;i++){var c=champs[i];
    if(!c.name){continue}
    if((c.type==='checkbox'||c.type==='radio')&&!c.checked){continue}
    couples.push(encodeURIComponent(c.name)+'='+encodeURIComponent(c.value));}
  f.classList.add('en-attente');
  fetch(f.getAttribute('action'),{method:'POST',headers:{
    'Content-Type':'application/x-www-form-urlencoded',
    'X-RingBack-Fragment':'1'},body:couples.join('&')})
   .then(function(r){var cible=r.headers.get('X-RingBack-Cible')||'modale';
     return r.text().then(function(t){return {cible:cible,texte:t}})})
   .then(function(r){
     f.classList.remove('en-attente');
     if(r.cible==='modale'){poser(r.texte);return}
     var zone=document.getElementById(r.cible);
     if(zone){zone.innerHTML=r.texte}
     fermer();})
   .catch(function(){f.classList.remove('en-attente')});});
/* ⏳ L'IMPORT D'UN FICHIER DIT QU'IL TRAVAILLE (15/08/2026, sa demande).
   Un agenda de mille rendez-vous prend plusieurs secondes à lire : sans un
   mot, l'écran reste figé et l'on reclique — ce qui importe deux fois.
   Ce n'est PAS un envoi en arrière-plan : le navigateur part vraiment sur la
   page de compte rendu. On marque donc simplement le bouton pendant que la
   navigation se fait.
   ⚠ SUR LE DOCUMENT, pas sur la fenêtre : le même formulaire est servi à
   DEUX endroits (la page « Ajouter » et la fenêtre « ＋ Importer votre
   agenda »). Une écoute posée sur la seule fenêtre en aurait raté la moitié.
   ⚠ ET UN <script> INJECTÉ PAR innerHTML NE S'EXÉCUTE PAS : c'est pourquoi
   elle vit ici, dans le script commun à toutes les pages. */
var ENVOIS_LENTS=['/importer','/importer-ics','/installation/agenda'];
document.addEventListener('submit',function(e){
  var f=e.target;
  if(!f||f.tagName!=='FORM'||f.hasAttribute('data-modale-envoi')){return}
  if(e.defaultPrevented){return}
  var action=f.getAttribute('action')||'';
  if(ENVOIS_LENTS.indexOf(action)<0){return}
  var champ=f.querySelector('input[type="file"]');
  if(!champ||!champ.files||!champ.files.length){return}
  var bouton=f.querySelector('button');
  if(!bouton||bouton.disabled){return}
  f.classList.add('en-attente');
  /* Le libellé est REMPLACÉ, pas complété : « Importer ⏳ Import en cours… »
     se lirait comme deux boutons. Et il porte un MOT, jamais le seul
     pictogramme — on ne lit pas une icône. */
  bouton.textContent='⏳ Import en cours…';
  /* ⚠ DANS LA FENÊTRE, ON REMPLACE TOUT (16/08/2026, sa demande) : « remplace
     carrément la modale par un "chargement…" avec un spinner animé ». Le
     formulaire disparaît, la roue tourne, et il n'y a plus rien à cliquer —
     donc plus moyen d'envoyer le fichier une seconde fois. Sur la page
     « Ajouter », qui n'a pas de fenêtre, seul le bouton change. */
  var dans_fenetre=!fond.hidden&&fond.contains(f);
  /* ⚠ TOUT ARRIVE APRÈS L'ENVOI, jamais pendant. Un bouton passé `disabled`
     — ou pire, un formulaire RETIRÉ DU DOCUMENT — dans l'écoute du « submit »
     fait que certains navigateurs n'envoient rien du tout : on aurait ajouté
     une fenêtre de chargement en cassant l'import. Le délai zéro laisse la
     navigation partir d'abord. */
  setTimeout(function(){
    bouton.disabled=true;
    if(!dans_fenetre){return}
    verrouillee=true;
    /* `aria-busy` et `aria-live` disent la même chose que la roue, pour qui
       ne la voit pas. Et le mot « Chargement… » est écrit en toutes lettres :
       une animation ne se lit pas. */
    fond.innerHTML='<div class="modale modale-chargement" role="dialog"'
      +' aria-modal="true" aria-live="polite" aria-busy="true"'
      +' aria-label="Chargement en cours">'
      +'<div class="rondelle" aria-hidden="true"></div>'
      +'<p class="titre-chargement">Chargement…</p>'
      +'<p class="sourd">Votre fichier est en cours de lecture.'
      +' Cette fenêtre se ferme d\\'elle-même quand c\\'est terminé.</p>'
      +'</div>';},0);});
/* LE DÉVOILEMENT EN CASCADE DANS UNE MODALE — ici, et pas dans la modale.
   Un <script> injecté par innerHTML NE S'EXÉCUTE PAS : une modale qui
   porterait son propre script aurait des boutons radio qui ne révèlent
   rien. Constaté à l'écran le 02/08/2026 sur la fenêtre « campagne de
   rappel ». L'écoute vit donc au niveau de la page, une fois pour toutes :
   un bouton radio qui porte data-panneau montre l'élément de cet
   identifiant et cache celui de ses frères. */
fond.addEventListener('change',function(e){
  var choisi=e.target;
  if(!choisi||!choisi.name||choisi.type!=='radio'){return}
  var freres=fond.querySelectorAll('input[type="radio"][name="'
                                   +choisi.name+'"][data-panneau]');
  if(!freres.length){return}
  Array.prototype.forEach.call(freres,function(r){
    var panneau=document.getElementById(r.getAttribute('data-panneau'));
    if(panneau){panneau.hidden=!r.checked}});});
fond.addEventListener('click',function(e){
  var cible=e.target;
  if(cible===fond){fermer();return}
  while(cible&&cible!==fond){
    if(cible.classList&&cible.classList.contains('modale-fermer')){
      e.preventDefault();fermer();return}
    if(cible.classList&&cible.classList.contains('modale')){return}
    cible=cible.parentNode;}});
document.addEventListener('keydown',function(e){
  if(!fond.hidden&&(e.key==='Escape'||e.key==='Esc'||e.keyCode===27)){fermer()}});
})();
</script>"""

# Le PLANNING de la semaine : la navigation, la modale et le bouton
# « prochain créneau disponible » rechargent la SEULE zone du planning —
# jamais la page. Règle du propriétaire tenue à la lettre : tout bouton de
# navigation AUTRE que le champ date remet ce champ à vide.
SCRIPT_PLANNING = """<script>
(function(){
var zone=document.getElementById('planning');
if(!zone||!window.fetch){return}
function valeur(nom){var e=zone.querySelector('[name="'+nom+'"]');
  return e?e.value:''}
function porteur(cible,attribut){
  while(cible&&cible!==zone){
    if(cible.getAttribute&&cible.getAttribute(attribut)!==null){return cible}
    cible=cible.parentNode;}
  return null;}
function charger(requete){
  zone.classList.add('en-attente');
  fetch('/suivi/planning?'+requete).then(function(r){return r.text()})
   .then(function(t){zone.innerHTML=t;zone.classList.remove('en-attente')})
   .catch(function(){zone.classList.remove('en-attente')});}
function aller(quoi){
  var q='aller='+encodeURIComponent(quoi)
       +'&annee='+encodeURIComponent(valeur('annee'))
       +'&semaine='+encodeURIComponent(valeur('semaine'))
       +'&rang='+encodeURIComponent(valeur('rang'));
  if(quoi==='date'){q+='&date='+encodeURIComponent(valeur('date'))}
  else{var d=zone.querySelector('[name="date"]');if(d){d.value=''}}
  charger(q);}
zone.addEventListener('click',function(e){
  var bouton=porteur(e.target,'data-aller');
  if(bouton){e.preventDefault();aller(bouton.getAttribute('data-aller'));return}
  var case_=porteur(e.target,'data-modale');
  if(case_){e.preventDefault();
    /* ⚠ On ARRÊTE ici : depuis le 02/08/2026, le document porte lui aussi
       une écoute « data-modale ». Sans cela, un clic sur le planning
       partirait DEUX fois — une avec la semaine, une sans — et la dernière
       réponse arrivée gagnerait, au hasard. */
    e.stopPropagation();
    /* ⚠ CTRL COMPOSE UNE SÉLECTION, il n'ouvre pas de fiche (09/08/2026).
       Sans cette sortie, ajouter une case seule à la sélection ouvrait la
       fiche du créneau par-dessus la grille qu'on est en train de choisir. */
    if(e.ctrlKey){return}
    /* La semaine affichée voyage avec la modale : après enregistrement,
       le planning se remet en place SUR LA MÊME SEMAINE. */
    window.rbModale(case_.getAttribute('data-modale')
      +'&annee='+encodeURIComponent(valeur('annee'))
      +'&semaine='+encodeURIComponent(valeur('semaine')))}});
zone.addEventListener('change',function(e){
  var nom=e.target.getAttribute?e.target.getAttribute('name'):'';
  if(nom==='annee'||nom==='semaine'){aller('semaine')}
  else if(nom==='date'){aller('date')}});
/* ⚠ LE GLISSER DU PLANNING EST ÉCRIT ICI, PAS EMPRUNTÉ AUX RÉGLAGES. Celui
   du calendrier des réglages écoute le DOCUMENT et poste « geste=basculer »
   vers /reglages/semaine : s'il prenait ce geste-ci, il changerait les
   HORAIRES D'OUVERTURE au lieu de sélectionner. Rien de commun, donc.

   ⚠ LA SÉLECTION EST UN RECTANGLE JOURS × HEURES depuis le 09/08/2026 — « du
   lundi au mercredi, de 9h00 à 10h15 ». C'était une PÉRIODE continue, et le
   même geste ramassait alors les après-midi et les nuits entre les deux
   bouts : la demande était impossible à exprimer. Le formulaire de repli et
   la lecture côté serveur ont basculé EN MÊME TEMPS — deux sens pour un même
   geste finissent toujours par se contredire.

   ⚠ CTRL + GLISSÉ CUMULE. Chaque glissé ajoute un rectangle et n'ouvre RIEN ;
   la fenêtre attend le relâchement de Ctrl. Sans cette attente, elle se
   serait rouverte à chaque zone et aurait recouvert la grille sur laquelle on
   est justement en train de choisir la suivante. */
var depart=null,cumul=false,zones=[];
function cases(){return zone.querySelectorAll('td[data-quand]')}
function bornes(a,b){return a<=b?[a,b]:[b,a]}
/* Le jour et l'heure sont LUS DANS « data-quand » (2026-08-10T09:00) : deux
   attributs de plus auraient pu se désaccorder de celui-là. La comparaison de
   chaînes suffit — l'ISO est fait pour ça. */
function jourDe(q){return q.slice(0,10)}
function heureDe(q){return q.slice(11)}
function rectangle(a,b){
  var j=bornes(jourDe(a),jourDe(b)),h=bornes(heureDe(a),heureDe(b));
  return {j1:j[0],j2:j[1],h1:h[0],h2:h[1]};}
function dedans(q,r){
  var j=jourDe(q),h=heureDe(q);
  return j>=r.j1&&j<=r.j2&&h>=r.h1&&h<=r.h2;}
function peindre(courant){
  var tous=zones.slice();
  if(courant){tous.push(courant)}
  Array.prototype.forEach.call(cases(),function(c){
    var q=c.getAttribute('data-quand'),pris=false;
    for(var i=0;i<tous.length;i++){if(dedans(q,tous[i])){pris=true;break}}
    if(pris){c.classList.add('choisie')}else{c.classList.remove('choisie')}});}
function effacer(){zones=[];peindre(null);}
/* LA BOÎTE DES CASES CHOISIES, en coordonnées d'écran. Une sélection couvre
   plusieurs jours — donc plusieurs colonnes — et peut compter plusieurs
   zones : on prend l'enveloppe de toutes les cases, pas celle de la première. */
function boiteChoisie(){
  var cs=zone.querySelectorAll('td.choisie');
  if(!cs.length){return null}
  var b={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity};
  Array.prototype.forEach.call(cs,function(c){
    var r=c.getBoundingClientRect();
    if(r.left<b.left){b.left=r.left}
    if(r.right>b.right){b.right=r.right}
    if(r.top<b.top){b.top=r.top}
    if(r.bottom>b.bottom){b.bottom=r.bottom}});
  return b;}
function ouvrir(){
  if(!zones.length){return}
  var morceaux=[];
  for(var i=0;i<zones.length;i++){var r=zones[i];
    morceaux.push('zone='+encodeURIComponent(r.j1+'|'+r.j2+'|'+r.h1+'|'+r.h2));}
  /* La fenêtre emportera la sélection en se fermant : le surlignage n'a de
     sens qu'avec le panneau qui y est collé. */
  window.rbApresFermeture=effacer;
  window.rbModale('/suivi/plage?'+morceaux.join('&')
                  +'&annee='+encodeURIComponent(valeur('annee'))
                  +'&semaine='+encodeURIComponent(valeur('semaine')),
                  boiteChoisie());}
zone.addEventListener('mousedown',function(e){
  var c=porteur(e.target,'data-quand');
  if(!c){return}
  /* Pas de preventDefault ici : le clic simple doit continuer d'ouvrir la
     fiche de la case. On se contente de retenir d'où l'on part. */
  cumul=!!e.ctrlKey;
  /* Un glissé SANS Ctrl repart de zéro : c'est ce que fait toute sélection
     ailleurs, et garder les zones précédentes sans le dire les aurait
     embarquées dans la campagne suivante. */
  if(!cumul){zones=[]}
  depart=c.getAttribute('data-quand');
  peindre(rectangle(depart,depart));});
zone.addEventListener('mousemove',function(e){
  if(depart===null){return}
  var c=porteur(e.target,'data-quand');
  if(c){peindre(rectangle(depart,c.getAttribute('data-quand')))}});
document.addEventListener('mouseup',function(e){
  if(depart===null){return}
  var c=porteur(e.target,'data-quand');
  var arrivee=c?c.getAttribute('data-quand'):null;
  var d=depart;depart=null;
  if(arrivee===null){if(!cumul){effacer()}else{peindre(null)}cumul=false;return}
  /* ⚠ UNE SEULE CASE SANS CTRL = UN CLIC SIMPLE : on ne fait rien et on laisse
     l'écoute de clic ouvrir la fiche. Sans cette sortie, le même geste
     ouvrait DEUX fenêtres — celle de la case et celle de la plage. AVEC Ctrl,
     au contraire, une case seule est une zone : c'est le seul moyen d'en
     ajouter une d'un quart d'heure. */
  if(arrivee===d&&!cumul){effacer();cumul=false;return}
  zones.push(rectangle(d,arrivee));
  peindre(null);
  /* Ctrl relâché EN COURS DE GLISSÉ : on ouvre. Ctrl encore enfoncé : on
     attend, l'utilisateur est en train de composer sa sélection. */
  var attendre=cumul&&e.ctrlKey;
  cumul=false;
  if(!attendre){ouvrir()}});
document.addEventListener('keyup',function(e){
  if(e.key!=='Control'&&e.keyCode!==17){return}
  /* Un glissé est en cours : c'est le relâché de la souris qui ouvrira, avec
     la zone qu'on est en train de tracer. */
  if(depart!==null){return}
  ouvrir();});
})();
</script>"""

# Les filtres de 👥 Contacts rechargent la SEULE liste (jamais la page), et
# le formulaire reste soumissible sans JavaScript. Un clic sur un client
# ouvre son DOSSIER EN MODALE (édition comprise) ; sans JavaScript, le même
# lien mène à sa fiche pleine page — le repli reste entier.
SCRIPT_CLIENTS = """<script>
(function(){
var formulaire=document.getElementById('filtres-clients');
var liste=document.getElementById('liste-clients');
if(!formulaire||!liste||!window.fetch){return}
var minuteur=null;
/* L'ouverture des fenêtres n'est PLUS ici : elle est déléguée au document
   dans SCRIPT_MODALE, donc valable pour tous les écrans. La garder aussi à
   cet endroit aurait fait partir deux demandes pour un seul clic. */
function recharger(page){
  var champs=formulaire.querySelectorAll('input,select');
  var morceaux=[];
  for(var i=0;i<champs.length;i++){
    var c=champs[i];
    if(!c.name){continue}
    if(c.type==='checkbox'){if(!c.checked){continue}}
    morceaux.push(encodeURIComponent(c.name)+'='+encodeURIComponent(c.value));}
  /* ⚠ LE NUMÉRO DE PAGE VIENT DU BOUTON CLIQUÉ, pas d'un champ : les quatre
     flèches sont de vrais boutons d'envoi, pour marcher sans JavaScript. */
  if(page){morceaux.push('page='+encodeURIComponent(page))}
  liste.classList.add('en-attente');
  fetch('/clients/liste?'+morceaux.join('&')).then(function(r){return r.text()})
   .then(function(t){liste.innerHTML=t;liste.classList.remove('en-attente')})
   .catch(function(){liste.classList.remove('en-attente')});}
formulaire.addEventListener('submit',function(e){
  e.preventDefault();
  var bouton=e.submitter;
  recharger(bouton&&bouton.name==='page'?bouton.value:null);});
/* ⚠ LES FLÈCHES SONT DANS LA LISTE, pas dans le formulaire : la liste est
   remplacée à chaque rechargement, donc on écoute la ZONE, une fois. */
liste.addEventListener('click',function(e){
  var cible=e.target;
  while(cible&&cible!==liste){
    if(cible.tagName==='BUTTON'&&cible.getAttribute('name')==='page'){
      e.preventDefault();
      if(!cible.disabled){recharger(cible.value)}
      return}
    cible=cible.parentNode;}});
/* ⚠ CHANGER UN FILTRE RAMÈNE À LA PAGE 1 : rester sur la page 7 d'un résultat
   qui n'en compte plus que 2 aurait montré une liste vide, comme si le filtre
   ne trouvait personne. */
formulaire.addEventListener('change',function(){recharger(1)});
formulaire.addEventListener('input',function(e){
  if(e.target.type!=='search'){return}
  clearTimeout(minuteur);minuteur=setTimeout(recharger,250)});
})();
</script>"""

SCRIPT_THEME_PIED = """<script>
var R=document.documentElement;
function majTheme(){var b=document.getElementById('btn-theme');if(!b){return}
b.textContent=R.dataset.theme==='dark'?'\\u2600':'\\u263e';
b.title=R.dataset.theme==='dark'?'Passer en mode clair':'Passer en mode sombre';}
var bt=document.getElementById('btn-theme');
if(bt){bt.onclick=function(){var t=R.dataset.theme==='dark'?'light':'dark';
R.dataset.theme=t;try{localStorage.setItem('rb-theme',t)}catch(e){}majTheme()};}
majTheme();
</script>"""


def _analyser_multipart(type_contenu, corps):
    """Champs + premier fichier d'un envoi multipart/form-data (stdlib email).

    Rend (champs, octets_du_fichier) — champs = {nom: texte} pour les
    parties sans nom de fichier ; le fichier vaut None s'il n'y en a pas.
    """
    message = email.message_from_bytes(
        b"Content-Type: " + type_contenu.encode("latin-1") + b"\r\n"
        b"MIME-Version: 1.0\r\n\r\n" + corps,
        policy=email.policy.default)
    champs, fichier = {}, None
    if not message.is_multipart():
        return champs, None
    for partie in message.iter_parts():
        if partie.get_filename():
            if fichier is None:
                fichier = partie.get_payload(decode=True)
            continue
        nom = partie.get_param("name", header="content-disposition")
        if nom:
            contenu = partie.get_payload(decode=True) or b""
            champs[nom] = contenu.decode("utf-8", "replace").strip()
    return champs, fichier


def _extraire_fichier(type_contenu, corps):
    """Premier fichier d'un envoi multipart/form-data, ou None."""
    return _analyser_multipart(type_contenu, corps)[1]


def _fichier_nomme(type_contenu, corps):
    """(nom du fichier, octets) — le NOM importe pour choisir le lecteur.

    L'installeur accepte un agenda `.ics` ou une liste `.csv` par le même
    bouton : sans le nom, impossible de savoir lequel des deux lecteurs
    appeler. Rend ("", None) s'il n'y a pas de fichier.
    """
    message = email.message_from_bytes(
        b"Content-Type: " + type_contenu.encode("latin-1") + b"\r\n"
        b"MIME-Version: 1.0\r\n\r\n" + corps,
        policy=email.policy.default)
    if not message.is_multipart():
        return "", None
    for partie in message.iter_parts():
        nom = partie.get_filename()
        if nom:
            return nom, partie.get_payload(decode=True)
    return "", None


def _version_du_code():
    """La date du fichier de code le plus récent, figée au démarrage.

    Affichée dans le pied de page : un serveur resté ouvert continue de
    servir le code qu'il a chargé, et rien à l'écran ne le disait — d'où des
    « je n'ai pas la dernière version » impossibles à voir. Cette date-là
    répond à la question d'un coup d'œil.
    """
    dossier = os.path.dirname(os.path.abspath(__file__))
    recent = 0.0
    for nom in os.listdir(dossier):
        if nom.endswith(".py"):
            recent = max(recent, os.path.getmtime(os.path.join(dossier, nom)))
    if not recent:
        return "inconnue"
    return datetime.datetime.fromtimestamp(recent).strftime("%d/%m %Hh%M")


VERSION_CODE = _version_du_code()


def _reglages_en_sections(parties):
    """Les Réglages en ACCORDÉON À DEUX NIVEAUX, la vue à droite.

    `parties` : [(code, libellé, [(code_sous, libellé_sous, contenu), …]), …].

    Demande du propriétaire (02/08/2026, second lot) : le menu de gauche ne
    liste plus des pages, il DÉPLIE. On clique un intitulé, ses sous-parties
    apparaissent ; en ouvrir une autre replie la précédente — la convention
    d'un accordéon, et ce que le propriétaire a demandé mot pour mot.

    Trois propriétés qui comptent :
    - les liens d'ancre existants (« /reglages#jeu-essai », « #creneaux »,
      « #numero-essai », « #discours ») MÈNENT toujours au bon endroit : les
      codes de sous-partie SONT ces ancres, et le script ouvre la partie qui
      les contient ;
    - l'enveloppe de partie garde `id="section-<code>"`, comme au premier
      lot : ce qui désignait une section la désigne encore ;
    - sans JavaScript, TOUT reste affiché, l'une sous l'autre. Le menu
      devient une table des matières. Rien n'est perdu — c'est pour cela
      qu'aucun `hidden` n'est écrit ici : seul le script replie.
    """
    menu, panneaux = [], []
    for code, libelle, sous_parties in parties:
        liens = "".join(
            f'<a class="menu-reglages-sous-item" href="#{sous}" '
            f'data-section="{sous}">{html.escape(titre)}</a>'
            for sous, titre, _ in sous_parties)
        menu.append(
            f'<div class="menu-reglages-partie" data-partie="{code}">'
            f'<button type="button" class="menu-reglages-titre" '
            f'data-partie="{code}" aria-expanded="false">'
            f'{html.escape(libelle)}</button>'
            f'<div class="menu-reglages-sous" data-partie="{code}">{liens}</div>'
            "</div>")
        contenus = "".join(
            f'<section class="section-reglages" id="section-{sous}" '
            f'data-section="{sous}" data-partie="{code}">{contenu}</section>'
            for sous, _, contenu in sous_parties)
        panneaux.append(f'<div class="partie-reglages" id="section-{code}" '
                        f'data-section="{code}">{contenus}</div>')
    # L'invite est écrite MASQUÉE : sans JavaScript tout est déjà affiché, et
    # inviter à choisir une rubrique n'aurait aucun sens. C'est le script qui
    # la montre, au moment où il replie tout.
    invite = ('<p class="invite-reglages" hidden>Choisissez une rubrique dans '
              "le menu pour l'ouvrir.</p>")
    return ('<div class="reglages-deux-parts">'
            '<nav class="menu-reglages" aria-label="Sections des réglages">'
            + "".join(menu) + '</nav><div class="vue-reglages">'
            + invite + "".join(panneaux) + "</div></div>")


SCRIPT_REGLAGES = """<script>
(function(){
var titres=document.querySelectorAll('.menu-reglages-titre');
var sousMenus=document.querySelectorAll('.menu-reglages-sous');
var liens=document.querySelectorAll('.menu-reglages-sous-item');
var sections=document.querySelectorAll('.section-reglages');
if(!titres.length||!sections.length){return}
function partieDe(code){
  var trouvee=null;
  Array.prototype.forEach.call(sections,function(s){
    if(s.getAttribute('data-section')===code){
      trouvee=s.getAttribute('data-partie')}});
  return trouvee;}
/* Déplier une partie replie les autres : c'est la convention d'un accordéon,
   et c'est ce qui garde le menu court quel que soit le nombre de réglages. */
function ouvrirPartie(code){
  Array.prototype.forEach.call(sousMenus,function(m){
    m.hidden=m.getAttribute('data-partie')!==code;});
  Array.prototype.forEach.call(titres,function(t){
    var sien=t.getAttribute('data-partie')===code;
    t.classList.toggle('actif',sien);
    t.setAttribute('aria-expanded',sien?'true':'false');});}
function ouvrir(code){
  var partie=partieDe(code);
  if(!partie){return false}
  var invite=document.querySelector('.invite-reglages');
  if(invite){invite.hidden=true}
  ouvrirPartie(partie);
  Array.prototype.forEach.call(sections,function(s){
    s.hidden=s.getAttribute('data-section')!==code;});
  Array.prototype.forEach.call(liens,function(a){
    a.classList.toggle('actif',a.getAttribute('data-section')===code);});
  return true;}
function premiereDe(partie){
  var code=null;
  Array.prototype.forEach.call(sections,function(s){
    if(code===null&&s.getAttribute('data-partie')===partie){
      code=s.getAttribute('data-section')}});
  return code;}
/* Une ancre venue d'ailleurs (#jeu-essai, #creneaux…) : on ouvre la partie ET
   la sous-partie qui la contiennent, puis on va dessus. Sans cela, un lien
   existant tomberait dans une section masquée — un lien qui ne mène nulle
   part. Une ancre PLUS FINE qu'une sous-partie (un titre à l'intérieur) est
   retrouvée par remontée. */
function depuisAncre(){
  var cible=(location.hash||'').replace('#','');
  if(!cible){return false}
  if(ouvrir(cible)){return true}
  /* Une ancre qui vise une PARTIE (« #discours ») et non une sous-partie :
     on ouvre sa première sous-partie, qui est ce qu'on cherchait à voir. */
  var premiere=premiereDe(cible);
  if(premiere){return ouvrir(premiere)}
  var element=document.getElementById(cible);
  if(!element){return false}
  var section=element.closest?element.closest('.section-reglages'):null;
  if(!section){return false}
  ouvrir(section.getAttribute('data-section'));
  element.scrollIntoView();
  return true;}
Array.prototype.forEach.call(titres,function(t){
  t.addEventListener('click',function(){
    var partie=t.getAttribute('data-partie');
    /* Recliquer l'intitulé déjà ouvert ne le referme pas : la vue de droite
       resterait vide, et un écran vide n'apprend rien. */
    ouvrirPartie(partie);
    var premiere=premiereDe(partie);
    if(premiere){ouvrir(premiere)}});});
Array.prototype.forEach.call(liens,function(a){
  a.addEventListener('click',function(){
    ouvrir(a.getAttribute('data-section'));});});
window.addEventListener('hashchange',depuisAncre);
/* À L'ARRIVÉE, ON OUVRE « 📞 Appels > Identité » (21/08/2026, sa demande).
   Le 02/08 il avait demandé l'inverse — tout replié, avec une invite à
   choisir — et l'écran d'accueil des réglages était donc vide. Ouvrir la
   première rubrique montre quelque chose tout de suite, et le menu reste
   entièrement disponible à côté.
   Une ancre (#jeu-essai, un retour après enregistrement…) garde la main :
   elle ouvre ce qu'elle vise, sinon le lien ne mènerait nulle part. */
if(!depuisAncre()&&!ouvrir('identite')){
  Array.prototype.forEach.call(sousMenus,function(m){m.hidden=true});
  Array.prototype.forEach.call(sections,function(s){s.hidden=true});
  var invite=document.querySelector('.invite-reglages');
  if(invite){invite.hidden=false}}
})();
</script>"""


def _bouton_langue(langue_code):
    """La bascule FR/EN de la bannière — un bouton, pas un menu.

    ⚠ VISIBLE SUR TOUTES LES PAGES, ET C'EST L'OBJET. Un testeur anglophone
    qui ouvre le produit tombe sur du français : s'il doit deviner qu'un
    réglage existe et aller le chercher dans ⚙ Réglages, il ne le trouvera
    pas. Le geste est donc à côté du thème, là où l'œil le cherche.

    ⚠ ET IL MARCHE SANS JAVASCRIPT, comme tout le reste du produit : c'est un
    vrai formulaire, qui poste et qui redirige.

    Le bouton porte l'AUTRE langue — ce qu'on obtient en cliquant, jamais ce
    qu'on a déjà. Un bouton qui affiche l'état courant se lit à l'envers une
    fois sur deux.
    """
    autre = (langue.ANGLAIS if langue.langue_valide(langue_code)
             == langue.FRANCAIS else langue.FRANCAIS)
    fiche = langue.LANGUES[autre]
    titre = ("Switch the interface to English" if autre == langue.ANGLAIS
             else "Afficher l'interface en français")
    return ('<form method="post" action="/langue" class="geste-langue">'
            f'<input type="hidden" name="vers" value="{autre}">'
            f'<button type="submit" title="{titre}" aria-label="{titre}">'
            f'{fiche["drapeau"]}</button></form>')


def _gabarit(titre, corps, mode_reel=False, actif=None, mode=None,
             langue_code=langue.LANGUE_PAR_DEFAUT):
    """L'ossature de toute page.

    ⚠ `langue_code` N'EST PAS UNE TRADUCTION, c'est une DÉCLARATION. Le
    corps reste écrit en français ici ; il sera traduit à la sortie, dans
    `_repondre`. Mais l'attribut `lang` de <html>, lui, doit être juste dès
    la fabrication : c'est lui que lisent les lecteurs d'écran et les
    correcteurs orthographiques du navigateur, et il vit dans une balise,
    là où la traduction de sortie ne va délibérément jamais.
    """
    if mode_reel:
        pied = "RingBack — MODE RÉEL : les appels partent vraiment ; numéros toujours masqués à l'écran."
    else:
        pied = "RingBack — mode simulation : aucun appel réel, numéros fictifs et masqués."
    pied += f" · code du {VERSION_CODE}"
    liens = "".join(
        f'<a href="{chemin}"{" class=" + chr(34) + "actif" + chr(34) if code == actif else ""}>'
        f"{libelle}</a>"
        for code, chemin, libelle in ONGLETS)
    return f"""<!DOCTYPE html>
<html lang="{langue_code}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(titre)} — RingBack</title>
<link rel="icon" type="image/png" sizes="32x32" href="/image/icone-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/image/icone-180.png">
<meta name="theme-color" content="#12365e">
{SCRIPT_THEME_TETE}
<style>{STYLE}</style>
</head>
<body>
<header class="banniere-haut">
  <div class="banniere-int">
    <a class="marque" href="/">
      {LOGO_SVG}
      <span><span class="nom-produit">RingBack</span>
      <span class="sous-titre">Campagnes d'appels par thème, relances programmées</span></span>
    </a>
    <div class="gestes-banniere">{_bouton_langue(langue_code)}<button id="btn-theme" type="button" aria-label="Basculer entre mode clair et mode sombre">☾</button></div>
  </div>
  <nav class="onglets">{liens}</nav>
</header>
<main{' data-mode="' + mode + '"' if mode else ""}>
{corps}
</main>
<footer><small>{html.escape(pied)}</small></footer>
<div id="fond-modale" hidden></div>
{SCRIPT_MODALE}
{SCRIPT_FRAGMENTS}
{SCRIPT_THEME_PIED}
</body>
</html>"""


# L'avertissement des deux imports, mot pour mot celui du propriétaire
# (10/08/2026). Écrit UNE fois : les deux formulaires le portent, et la page de
# repli comme la fenêtre montrent le même texte.
AVERTISSEMENT_IMPORT = (
    "Attention notez que les rendez-vous importés remplacent les rendez-vous "
    "de votre agenda s'ils sont sur le même créneau horaire.")

# Le « ? » qui dévoile une aide, replié par défaut (demande du propriétaire,
# 10/08/2026 : « trop d'information perd les utilisateurs »).
#
# ⚠ UN <details>, PAS UNE MODALE NI DU JAVASCRIPT. Il marche sans script, il
# garde l'explication À CÔTÉ de ce qu'elle explique, et il est REPLIÉ : l'écran
# va droit au but, et l'explication attend qu'on la demande.
def _aide(titre, contenu, ouvert=False):
    """Un « ? » cliquable qui dévoile `contenu`. `titre` est son infobulle."""
    return (f'<details class="aide"{" open" if ouvert else ""}>'
            f'<summary title="{html.escape(titre, quote=True)}">'
            f'<span aria-hidden="true">?</span>'
            # Le « ? » seul ne dit pas de quoi il parle : le titre est répété
            # pour les lecteurs d'écran, avec la classe que le produit a déjà.
            f'<span class="sr-seulement">{html.escape(titre)}</span></summary>'
            f'<div class="aide-contenu">{contenu}</div></details>')


# Un intitulé cliquable qui dévoile un GESTE (un formulaire, une liste), là où
# `_aide` dévoile une explication. Même mécanique — un <details> replié, qui
# marche sans JavaScript — mais l'intitulé se lit : « Saisie manuelle des
# créneaux » doit se trouver sans avoir à survoler un rond.
def _replie(libelle, contenu, ouvert=False):
    """Un <details> replié dont le résumé porte `libelle`, en clair."""
    return (f'<details class="repli-geste"{" open" if ouvert else ""}>'
            f"<summary>{html.escape(libelle)}</summary>"
            f'<div class="repli-contenu">{contenu}</div></details>')


def _lien_demande(contact):
    """« Voir sa demande » — le texte s'ouvre en fenêtre, il n'étale plus.

    La demande d'un client fait souvent plusieurs lignes : étalée dans une
    cellule, elle déformait le tableau (même défaut que la colonne « Détail »
    d'une campagne, corrigé le même jour). Sans demande enregistrée, on le
    dit et il n'y a rien à cliquer — un lien vers du vide est un lien mort.
    """
    if not (contact.get("detail") or "").strip():
        return '<span class="sourd">aucune demande enregistrée</span>'
    lien = (f'<a href="/campagne?id={contact["campagne_id"]}" '
            f'data-modale="/relances/demande?contact={contact["id"]}" '
            'title="Ouvrir la demande de cette personne, en clair">'
            "Voir sa demande…</a>")
    # ⚠ CE QUI SE VOIT SANS CLIQUER (20/08/2026). Sa liste en compte plus de
    # neuf cents : ouvrir chaque fenêtre pour savoir à qui l'on a affaire n'est
    # pas un geste tenable. Et ces deux familles ne se traitent pas pareil —
    # « ce que l'agent n'a pas su conclure » se reprend là où la conversation
    # s'est arrêtée ; un refus d'agent, lui, n'a jamais eu de conversation.
    # Le lien reste : le repère dit LEQUEL, la fenêtre dit QUOI.
    if db.refus_de_l_agent(contact.get("detail")):
        return ('<strong>🚫 a refusé l\'agent</strong><br><small>'
                + lien + "</small>")
    return lien


# Les TYPES de rappel, dans l'ordre du menu : code, pictogramme, libellé.
# Le premier de la liste n'est pas l'arrivée par défaut — c'est « humains »
# qui l'est (demande du propriétaire) : ce sont les seuls qui ne partiront
# jamais sans un geste, donc les seuls que personne d'autre ne traitera.
VUES_RELANCES = (
    ("humains", "🙋", "Rappels par un humain"),
    ("dues", "⏰", "Relances dues"),
    ("a_venir", "🕓", "Relances à venir"),
    # ⚠ « PLAFOND ATTEINT » NE DISAIT PAS DE QUOI (21/08/2026, sa
    # remarque) : il a compris « limite de crédit CALL-E ». Le libellé
    # nomme maintenant le réglage exact, celui de l'étape ② — le code
    # « bloques » ne bouge pas, une base existante s'y réfère.
    ("bloques", "📵", "Non joints — maximum de rappels atteint"),
    # ⚠ « DEMANDES DÉJÀ TRAITÉES » A ÉTÉ RETIRÉE (21/08/2026, sa demande).
    # Elle gardait, dans un cinquième onglet, ce qu'il venait justement de
    # sortir de sa liste de travail. Le geste « ✔ C'est fait » reste : il
    # marque le contact et le fait disparaître de 🙋 — c'est tout ce qu'on lui
    # demande. La donnée, elle, n'est pas effacée (`contacts_campagne.traite_le`
    # garde la date), et la fiche de la campagne continue de tout montrer.
)
VUE_RELANCES_DEFAUT = "humains"

# ⚠ LA PHRASE DU FILTRE SANS RÉSULTAT, distincte de celle d'une famille vide
# (21/08/2026). Les deux se ressemblent à l'écran et ne disent pas du tout la
# même chose : l'une parle du travail qui reste, l'autre de ce qu'on vient de
# taper.
SANS_RESULTAT = ('<p class="vide-famille">Aucun résultat pour ce filtre — '
                 "cette liste n'est pas vide pour autant : retirez le filtre "
                 "pour la revoir en entier.</p>")
CODES_VUES_RELANCES = tuple(code for code, _, _ in VUES_RELANCES)


def _vue_relances(demandee):
    """Le type demandé, ou celui d'arrivée si l'adresse dit n'importe quoi."""
    return demandee if demandee in CODES_VUES_RELANCES else VUE_RELANCES_DEFAUT


def _menu_relances(comptes, actif):
    """Le menu des types de rappel — chacun avec SON nombre, zéro compris.

    Il remplace le paragraphe d'introduction, qui disait la même chose à
    tout le monde quel que soit l'état de la liste. Un type à zéro reste
    dans le menu : c'est ainsi qu'on apprend qu'il n'y a rien, et le clic
    mène à une liste vide qui garde son titre et son explication.

    Ce sont de VRAIS liens (`?vue=…`) : sans JavaScript ils rechargent la
    page sur le bon panneau, avec JavaScript le script bascule sur place.
    """
    liens = []
    for code, emoji, libelle in VUES_RELANCES:
        marque = ' class="actif" aria-current="page"' if code == actif else ""
        liens.append(
            f'<a{marque} href="/relances?vue={code}" '
            f'data-vue="panneau-{code}">{emoji} {html.escape(libelle)} '
            f'<span class="famille-nombre">({comptes[code]})</span></a>')
    return ('<nav class="menu-familles" aria-label="Types de rappel">'
            + "".join(liens) + "</nav>")


def _panneau_relance(code, titre, explication, contenu, actif):
    """Un type de rappel : son titre, sa phrase, et sa liste (vide ou non).

    Tous les panneaux sont rendus ; seul celui du lien actif n'est pas
    `hidden`. Le masquage est fait ICI, côté serveur : la page reste juste
    même sans JavaScript, et le script n'a plus qu'à déplacer l'attribut.
    """
    # ⚠ L'EXPLICATION PASSE DERRIÈRE UN « ? » (21/08/2026, sa demande). Elle
    # s'étalait sous chaque titre : deux paragraphes à relire à chaque visite,
    # au-dessus de la liste qu'il vient consulter. Elle reste à un clic — et
    # c'est le « ? » du produit (`_aide`), celui qu'il connaît déjà des autres
    # écrans, pas un nouveau geste à apprendre.
    cache = "" if code == actif else " hidden"
    sans_balise = re.sub(r"<[^>]+>", "", titre)
    return (f'<section class="panneau-relance" id="panneau-{code}"{cache}>'
            f'<div class="entete-panneau"><h2>{titre}</h2>'
            f"{_aide(sans_balise, explication)}</div>\n{contenu}\n</section>")


def _rien_a_rappeler(programmees, bloques, humains):
    """LA phrase quand il n'y a rien — dite une fois, pas cinq.

    Le menu montre déjà cinq zéros ; ce qu'il ne dit pas, c'est que
    l'ensemble est vide et qu'il n'y a donc rien à aller voir ailleurs.
    """
    if programmees or bloques or humains:
        return ""
    return ('<p class="pastille st-confirme">✅ Rien n\'attend de rappel : '
            "aucune relance programmée, personne au maximum de rappels, "
            "aucun rappel par un humain en attente.</p>")


# L'INSTALLEUR : sa propre machinerie, à part de SCRIPT_MODALE.
#
# Pourquoi à part. La fenêtre commune sait envoyer un formulaire en
# « urlencoded » et se fermer ; l'installeur, lui, doit RESTER ouvert d'une
# page à l'autre, garder son fil d'Ariane à jour, et surtout envoyer un
# FICHIER (l'agenda .ics) — ce que la fenêtre commune ne sait pas faire.
# Tordre l'une pour l'autre aurait fragilisé les deux.
#
# Le contrat est simple : chaque envoi rend le fragment de la page SUIVANTE
# (ou la même page avec ses erreurs), et le fragment remplace le contenu de
# la fenêtre. Le serveur décide de tout ; le script ne fait que transporter.
SCRIPT_INSTALLATION = """<script>
(function(){
var fond=document.getElementById('fond-installeur');
if(!fond||!window.fetch){return}
function poser(t){fond.innerHTML=t;fond.hidden=false;
  var p=fond.querySelector('.page-installeur');if(p){p.scrollTop=0}
  var premier=fond.querySelector('input,select,textarea,button');
  if(premier){premier.focus()}}
window.rbInstalleur=function(url){
  fetch(url,{headers:{'X-RingBack-Fragment':'1'}})
   .then(function(r){return r.text()}).then(poser).catch(function(){});};
window.rbInstalleurFermer=function(){fond.hidden=true;fond.innerHTML=''};
/* LE PANNEAU DÉROULANT du bandeau. Il se pose PAR-DESSUS le contenu, il ne
   pousse donc rien : la fenêtre garde sa hauteur. Un clic ailleurs le
   referme, la touche Échap aussi — sans quoi il resterait ouvert en travers
   de la page. */
function fermerDeroulants(){
  Array.prototype.forEach.call(
    fond.querySelectorAll('.panneau-deroulant'),function(p){p.hidden=true});
  Array.prototype.forEach.call(
    fond.querySelectorAll('[data-menu-deroulant]'),function(b){
      b.setAttribute('aria-expanded','false')});}
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){fermerDeroulants()}});
document.addEventListener('click',function(e){
  if(!fond.contains(e.target)){fermerDeroulants()}});
/* Aller à une page : le bandeau, le menu des pages, « Passer cette page ». */
fond.addEventListener('click',function(e){
  /* ⚠ UN CLIC DANS LA PAGE REFERME LE PANNEAU. Sans cette ligne il ne se
     fermait que sur un clic HORS de la fenêtre : il restait ouvert en
     travers du formulaire pendant qu'on le remplissait (constaté à la
     mesure le 03/08/2026). */
  if(!(e.target.closest&&e.target.closest('.entree-deroulante'))){
    fermerDeroulants()}
  var c=e.target;
  while(c&&c!==fond){
    if(c.getAttribute&&c.getAttribute('data-menu-deroulant')!==null){
      e.preventDefault();
      var p=document.getElementById(c.getAttribute('data-menu-deroulant'));
      if(!p){return}
      var ouvrir=p.hidden;
      fermerDeroulants();
      p.hidden=!ouvrir;
      c.setAttribute('aria-expanded',ouvrir?'true':'false');
      return}
    if(c.getAttribute&&c.getAttribute('data-page')!==null){
      e.preventDefault();
      window.rbInstalleur('/installation?page='+
        encodeURIComponent(c.getAttribute('data-page')));return}
    if(c.getAttribute&&c.getAttribute('data-installeur-fermer')!==null){
      e.preventDefault();
      /* « data-apres » : où aller une fois la fenêtre refermée. Sans lui,
         un rechargement sur place rouvrirait l'installeur quand l'adresse
         porte « ?installation=1 » — c'est elle qui l'ouvre. */
      var apres=c.getAttribute('data-apres');
      fetch(c.getAttribute('data-installeur-fermer'),{method:'POST',
        headers:{'X-RingBack-Fragment':'1'}})
       .then(function(){window.rbInstalleurFermer();
         if(apres){location.href=apres}})
       .catch(function(){window.rbInstalleurFermer()});return}
    c=c.parentNode;}});
/* Valider une page. Un formulaire qui porte un fichier part en FormData
   (le navigateur pose lui-même la frontière multipart) ; les autres en
   urlencoded, comme partout ailleurs dans le produit. */
fond.addEventListener('submit',function(e){
  var f=e.target;
  if(!f||f.tagName!=='FORM'){return}
  /* ⚠ SEULS LES FORMULAIRES DE L'INSTALLEUR. Cette écoute prenait TOUT ce
     qui s'envoyait dans la fenêtre et traitait la réponse comme une page
     d'installeur. Or les pages « horaires » et « jours fermés » portent les
     VRAIS formulaires des réglages : ils répondent une page entière, qui
     venait remplacer la fenêtre — l'installeur était cassé net (constaté le
     03/08/2026). Ceux-là sont pris en charge par SCRIPT_FRAGMENTS, qui
     recharge le seul élément concerné. */
  var action=f.getAttribute('action')||'';
  if(action.indexOf('/installation/')!==0){return}
  e.preventDefault();
  var corps,entetes={'X-RingBack-Fragment':'1'};
  if(f.querySelector('input[type="file"]')){
    corps=new FormData(f);
  }else{
    var couples=[],champs=f.querySelectorAll('input,select,textarea');
    for(var i=0;i<champs.length;i++){var c=champs[i];
      if(!c.name){continue}
      if((c.type==='checkbox'||c.type==='radio')&&!c.checked){continue}
      couples.push(encodeURIComponent(c.name)+'='+encodeURIComponent(c.value));}
    corps=couples.join('&');
    entetes['Content-Type']='application/x-www-form-urlencoded';}
  f.classList.add('en-attente');
  fetch(f.getAttribute('action'),{method:'POST',headers:entetes,body:corps})
   .then(function(r){return r.text()})
   .then(function(t){f.classList.remove('en-attente');poser(t)})
   .catch(function(){f.classList.remove('en-attente')});});
/* Le dévoilement en cascade (« Recontacter » et ses sous-options) : la même
   règle que dans la fenêtre commune, et pour la même raison — un <script>
   injecté par innerHTML ne s'exécute pas, l'écoute vit donc ici. */
function cascade(){
  Array.prototype.forEach.call(
    fond.querySelectorAll('[data-revele]'),function(c){
      var bloc=document.getElementById(c.getAttribute('data-revele'));
      if(bloc){bloc.hidden=!c.checked}});}
fond.addEventListener('change',function(e){
  if(e.target&&e.target.getAttribute&&
     e.target.getAttribute('data-revele')!==null){cascade()}
  if(e.target&&e.target.getAttribute&&
     e.target.getAttribute('data-bascule')!==null){
    var paire=e.target.getAttribute('data-bascule').split('|');
    var a=document.getElementById(paire[0]),b=document.getElementById(paire[1]);
    if(a&&b){var k=e.target.value==='creneau';a.hidden=k;b.hidden=!k}}});
var observateur=new MutationObserver(cascade);
observateur.observe(fond,{childList:true,subtree:true});
})();
</script>"""


# La bascule d'un type à l'autre : on déplace l'attribut `hidden` et la
# classe du lien actif, on ne recharge pas la page (règle du propriétaire :
# « recharger un élément, pas la page »). L'adresse suit tout de même, pour
# qu'un rafraîchissement ou un signet retombe sur le même type.
SCRIPT_RELANCES = """<script>
(function(){
var menu=document.querySelector('.menu-familles');
if(!menu){return}
menu.addEventListener('click',function(e){
  var lien=e.target;
  while(lien&&lien!==menu&&!(lien.tagName==='A'&&lien.getAttribute('data-vue'))){
    lien=lien.parentNode;}
  if(!lien||lien===menu){return}
  var cible=document.getElementById(lien.getAttribute('data-vue'));
  if(!cible){return}          /* panneau absent : on laisse le lien agir */
  e.preventDefault();
  Array.prototype.forEach.call(
    document.querySelectorAll('.panneau-relance'),
    function(p){p.hidden=p!==cible});
  Array.prototype.forEach.call(menu.querySelectorAll('a[data-vue]'),
    function(a){
      var choisi=a===lien;
      a.classList.toggle('actif',choisi);
      if(choisi){a.setAttribute('aria-current','page')}
      else{a.removeAttribute('aria-current')}});
  if(window.history&&window.history.replaceState){
    window.history.replaceState(null,'',lien.getAttribute('href'))}});
})();
</script>"""


def _nombre_cliquable(combien, client_id, detail, titre, vide="0"):
    """Un nombre qui ouvre le détail en fenêtre — ou rien à cliquer si zéro.

    Deux colonnes du tableau 👥 Contacts tenaient sur six lignes de haut à
    force d'étaler leur contenu. Elles montrent maintenant un NOMBRE ; le
    reste s'ouvre au clic (demande du propriétaire, 02/08/2026).

    C'est un lien, pas un bouton : sans JavaScript il mène à la fiche pleine
    page, qui porte déjà les deux contenus. Le repli est donc entier sans
    qu'on ait une seule ligne à écrire pour lui.

    Zéro n'est PAS cliquable : un lien qui ouvre une fenêtre vide est un
    lien mort.
    """
    if not combien:
        return f'<span class="sourd">{html.escape(vide)}</span>'
    return (f'<a href="/clients/fiche?id={client_id}" '
            f'data-modale="/clients/{detail}?id={client_id}" '
            f'title="{html.escape(titre, quote=True)}">'
            f"<strong>{combien}</strong></a>")


def _date_lisible(iso):
    try:
        return datetime.datetime.fromisoformat(iso).strftime("%d/%m/%Y à %Hh%M")
    except ValueError:
        return html.escape(iso)


def _entier(valeurs, defaut):
    """Le premier paramètre d'URL lu comme entier, ou `defaut` s'il est
    absent ou illisible — une adresse tapée à la main ne casse jamais l'écran."""
    try:
        return int((valeurs or [""])[0])
    except (TypeError, ValueError, IndexError):
        return defaut


def _nature_conservee(ligne):
    """Le thème LISIBLE d'une campagne, tel qu'il est conservé en base.

    `ligne` est une relance ou un contact rendu par la base : sa colonne
    « campagne_theme » porte le thème historique ou la nature de l'assistant.
    Un code inconnu s'affiche tel quel — jamais un libellé inventé.
    """
    code = (ligne.get("campagne_theme") or ligne.get("campagne_nature") or "")
    # Les thèmes ET les natures RETIRÉS sont reconnus : une campagne déjà en
    # base ne doit jamais s'afficher sous un code brut.
    if code in campagnes.THEMES_CAMPAGNE or code in campagnes.THEMES_RETIRES:
        return campagnes.libelle_theme(code)
    fiche = assistant.fiche_nature(code)
    if fiche:
        return f"{fiche['icone']} {fiche['nom']}"
    return code


def _date_jour_lisible(iso):
    """« 2026-08-15 » devient « samedi 15/08/2026 » (jour fermé, férié…)."""
    try:
        jour = datetime.date.fromisoformat(iso)
    except (TypeError, ValueError):
        return html.escape(str(iso))
    return f"{horaires.JOURS[jour.weekday()]} {jour:%d/%m/%Y}"


class Application:
    """État partagé : base de données + planificateur (simulé par défaut).

    appels_reels=True n'est atteint QUE par principal(), après les trois
    verrous : clé CALLE_API_KEY présente (sinon AppelReel refuse de se
    construire), option --appels-reels (qui lève dry_run), et confirmation
    tapée au clavier (qui autorise confirmer_appels_reels()). Aucun de ces
    verrous n'est contournable depuis l'interface web.
    """

    def __init__(self, chemin_base=":memory:", appels_reels=False):
        self.base = db.Base(chemin_base)
        self.mode_reel = appels_reels
        # Brouillons de l'assistant en 3 étapes (nature + message + grille) :
        # gardés CÔTÉ SERVEUR pour que les numéros collés ne soient JAMAIS
        # ré-émis dans les pages (règle de masquage) — perdus au redémarrage,
        # sans gravité.
        self.brouillons_assistant = {}
        self._brouillon_assistant_suivant = 1
        # Le serveur répond à plusieurs pages en même temps (voir ServeurWeb) :
        # deux ouvertures d'assistant simultanées ne doivent pas se voir
        # attribuer le MÊME numéro de brouillon, ni se marcher dessus pendant
        # le petit ménage des vieux brouillons.
        self._verrou_brouillons = threading.Lock()
        # Bilans du geste 📥 « Récupérer les résultats en attente », gardés
        # CÔTÉ SERVEUR le temps d'une redirection (jeton -> comptes rendus).
        # Ils portent des noms de personnes : ils ne transitent donc pas par
        # l'adresse de la page, comme les brouillons de l'assistant.
        self.bilans_recuperation = {}
        self._jeton_recuperation = 0
        # « Configurer plus tard » : EN MÉMOIRE, jamais sur le disque. Cette
        # réponse vaut pour la session en cours ; l'installeur revient au
        # prochain démarrage tant qu'il n'a pas été mené à son terme. L'écrire
        # sur le disque le ferait disparaître pour de bon sur un simple
        # « pas maintenant » — ce n'est pas ce que ces mots veulent dire.
        self.installation_reportee = False
        # Exécutions de campagne en cours : campagne_id -> {"commande": ...}.
        # La commande (pause / arret) est relue par le fil d'exécution ENTRE
        # deux appels — un appel en cours va toujours à son terme.
        self.executions = {}
        self._verrou_executions = threading.Lock()
        # Préférences (ex. dernier ordre de cascade choisi) : petit fichier
        # JSON à côté de la base ; en mémoire seulement pour les tests.
        self.preferences = generation.Preferences(
            chemin_preferences(chemin_base))
        campagnes.reprendre_ancien_plafond_de_relances(self.preferences)
        campagnes.reprendre_ancienne_politique_de_deplacement(self.preferences)
        # Les 🧪 numéros des testeurs déclarés sont confiés à la base : c'est
        # elle qui masque les numéros, donc elle seule peut dire « cette
        # ligne-là est un essai » sans jamais révéler le numéro (voir
        # db.est_numero_essai). Un réglage d'avant, à numéro unique, est repris
        # comme PREMIER testeur : rien à retaper (voir essai_reel.testeurs).
        self.base.definir_numeros_essai(
            essai_reel.numeros_declares(self.preferences))
        # Les réglages sont confiés au planificateur : ils lui servent à
        # tenir la plage d'appel + la période interdite sur TOUTES les
        # portes, et à refuser une date convenue au téléphone qui ne tient
        # pas dans les horaires d'ouverture.
        if appels_reels:
            # Les délais d'attente viennent des RÉGLAGES (⚙ Réglages) : ce
            # sont ceux d'une vraie conversation, pas ceux d'une simulation.
            client = calle_client.AppelReel(  # verrou 1 : la clé, ou refus net
                # ⚠ UNE FONCTION, PAS UNE VALEUR. Le client est construit une
                # seule fois, ici ; passer le numéro lu maintenant ferait
                # qu'une case cochée en cours de session n'aurait aucun effet,
                # alors que l'écran annoncerait le contraire.
                numero_impose=lambda: essai_reel.numero_impose(self.preferences),
                # ⚠ LA LANGUE AUSSI EST UNE FONCTION, ET POUR LA MÊME RAISON.
                # La consigne suit la langue choisie à l'instant de l'appel :
                # si la voix, elle, restait figée sur celle du démarrage,
                # l'agent lirait de l'anglais avec une prosodie française.
                langue_appel=lambda: langue.de_preferences(self.preferences),
                **calle_client.delais_regles(self.preferences))
            self.planif = planificateur.Planificateur(
                self.base, client, dry_run=False, preferences=self.preferences)
            self.planif.confirmer_appels_reels()
        else:
            client = calle_client.AppelSimule(latence=0.3)
            self.planif = planificateur.Planificateur(
                self.base, client, preferences=self.preferences)

    # ------------------------------------- assistant en 3 étapes (nature…)
    def creer_brouillon_assistant(self, nature, infos_initiales=None):
        """Ouvre un brouillon de l'assistant ; rend son identifiant (texte).

        Les valeurs par défaut viennent des RÉGLAGES (entreprise, créneaux,
        relances) — jamais de valeur inventée : un réglage absent laisse le
        champ vide, visible et à remplir.
        infos_initiales : des valeurs d'étape 2 déjà connues (par exemple le
        créneau qu'une annulation vient de libérer). Elles PRÉ-REMPLISSENT
        les champs, qui restent tous modifiables — l'assistant s'ouvre
        normalement, rien n'est décidé à la place de l'opérateur.
        """
        definition = assistant.NATURES[nature]
        infos, infos_auto = {}, {}
        for info in definition["infos"]:
            valeur = ""
            # CALCULÉES : ouvert − déjà pris − jours fermés, plus les créneaux
            # ajoutés à la main. La valeur reste modifiable ; infos_auto retient
            # qu'elle vient du calcul, pour pouvoir la réadapter à la durée du
            # client au moment de l'appel.
            # ⚠ PAR LE POINT DE PASSAGE UNIQUE, ET PAR RÉGLAGE : le stock d'une
            # nature qui NÉGOCIE n'est pas la date que le message nomme. Les
            # deux se calculaient ici, chacune à sa façon, et le
            # rafraîchissement de l'étape 2 les confondait ensuite — voir
            # assistant.valeur_calculee_info, seul endroit qui décide
            # désormais, pour les trois chemins.
            #
            # ⚠ SANS `a_deplacer` ICI, ET C'EST VOULU : ce pré-remplissage a
            # lieu à l'OUVERTURE du brouillon, avant l'étape 3 — la liste des
            # gens n'existe pas encore, il n'y a donc rien à compter.
            # L'aperçu montre le stock court ; celui de l'APPEL est recalculé
            # à chaque contact, avec le nombre réel de rendez-vous restant à
            # déplacer (voir assistant.creneaux_adaptes_au_contact). Compter
            # ici aurait demandé d'inventer un nombre.
            calculee = assistant.valeur_calculee_info(
                self.base, self.preferences, nature, info["reglage"])
            if calculee is not None:
                valeur = calculee
                infos_auto[info["code"]] = valeur
            elif info["reglage"]:
                valeur = (self.preferences.obtenir(info["reglage"]) or "")
            if (infos_initiales or {}).get(info["code"]):
                valeur = infos_initiales[info["code"]]
                infos_auto.pop(info["code"], None)
            infos[info["code"]] = valeur
        # ⚠ RIEN N'EST ÉCRIT ICI. Les valeurs livrées vivent dans
        # assistant.OPTIONS_LIVREES et les relances générales dans
        # assistant.relances_generales — les deux lues par comportement_regle,
        # que l'écran des Réglages appelle aussi. Une seule vérité, donc les
        # deux écrans montrent la même chose.
        options, politique, ordre = assistant.comportement_regle(
            nature, self.preferences)
        with self._verrou_brouillons:
            identifiant = str(self._brouillon_assistant_suivant)
            self._brouillon_assistant_suivant += 1
            self.brouillons_assistant[identifiant] = {
                "nature": nature, "infos": infos, "infos_auto": infos_auto,
                "options": options,
                "politique": politique,
                # Ordre d'appel : celui de la nature (ancienneté pour un
                # créneau libéré, proximité du rendez-vous pour un rappel),
                # ou celui réglé pour elle, ou l'ordre de la liste — voir
                # assistant.comportement_regle.
                "ordre": ordre,
                "champs": [dict(champ) for champ in definition["champs"]],
                "mission": None, "mission_editee": False,
                # La RECETTE : d'où viennent les personnes de la grille. Elle
                # permet de REJOUER la campagne sur un autre créneau (§8.3).
                "recette": assistant.recette_vide(),
                # La LISTE des créneaux à pourvoir (03/08/2026). Vide ici :
                # elle se remplit à l'étape ② pour « créneau libéré », et
                # d'un coup quand on sélectionne une plage du planning.
                "creneaux": [],
                # ⚠ AUTOMATIQUE PAR DÉFAUT, ET AVEC SA RÈGLE (09/08/2026).
                # Le mode dit ce qui sera ENVOYÉ : une règle rejouée à chaque
                # place, ou la grille. Le défaut ne vaut que pour les natures
                # qui ont une place à proposer — ailleurs il n'y a rien sur
                # quoi rejouer, et prétendre le contraire serait un mensonge
                # d'interface. La règle est posée D'OFFICE : un mode
                # automatique sans règle aurait laissé créer une campagne qui
                # n'appelle personne.
                "mode_liste": ("automatique"
                               if assistant.INFO_CRENEAU_PAR_NATURE.get(nature)
                               else "manuel"),
                "regle_liste": (dict(assistant.REGLE_LISTE_DEFAUT)
                                if assistant.INFO_CRENEAU_PAR_NATURE.get(nature)
                                else {}),
                "contacts": [], "erreurs": [], "message": ""}
            while len(self.brouillons_assistant) > 20:  # petit ménage
                self.brouillons_assistant.pop(
                    next(iter(self.brouillons_assistant)))
        return identifiant

    def obtenir_brouillon_assistant(self, identifiant):
        return self.brouillons_assistant.get(identifiant or "")

    # -------------------------- 📥 bilan de « récupérer les résultats »
    def retenir_bilan_recuperation(self, comptes):
        """Garde un compte rendu de récupération ; rend son jeton d'accès."""
        with self._verrou_brouillons:
            self._jeton_recuperation += 1
            jeton = str(self._jeton_recuperation)
            self.bilans_recuperation[jeton] = comptes
            while len(self.bilans_recuperation) > 20:      # petit ménage
                self.bilans_recuperation.pop(
                    next(iter(self.bilans_recuperation)))
        return jeton

    # ------------------------------ 📥 compte rendu d'un import d'agenda
    def retenir_bilan_import(self, bilan):
        """Garde le compte rendu d'un import ; rend son jeton d'accès.

        ⚠ MÊME CHEMIN QUE LES BILANS DE RÉCUPÉRATION, et pour la même raison :
        ce compte rendu NOMME les personnes dont le rendez-vous a été déplacé.
        Un nom n'a rien à faire dans une adresse de page — elle s'affiche, elle
        se copie, elle reste dans l'historique du navigateur.
        """
        with self._verrou_brouillons:
            self._jeton_recuperation += 1
            jeton = "i" + str(self._jeton_recuperation)
            self.bilans_recuperation[jeton] = bilan
            while len(self.bilans_recuperation) > 20:      # petit ménage
                self.bilans_recuperation.pop(
                    next(iter(self.bilans_recuperation)))
        return jeton

    # --------------------------------------------- exécution d'une campagne
    def demarrer_execution(self, campagne_id):
        """Lance le fil d'exécution d'une campagne « prête » ou « en pause ».

        Rend True si le fil part, False si une exécution est déjà en cours.
        Le statut passe « en cours » AVANT le premier appel, pour que la
        page reflète l'état réel dès la redirection.
        """
        with self._verrou_executions:
            if campagne_id in self.executions:
                return False
            self.executions[campagne_id] = {"commande": None}
        # La raison d'une pause SUBIE (panne de notre côté) est effacée au
        # redémarrage : on reprend pour de bon, l'écran ne garde pas une
        # explication périmée sous les yeux.
        self.base.definir_raison_pause_campagne(campagne_id, None)
        self.base.changer_statut_campagne(campagne_id, "en cours")
        fil = threading.Thread(target=assistant.executer_campagne,
                               args=(self, campagne_id), daemon=True)
        fil.start()
        return True

    def commande_execution(self, campagne_id):
        """La commande demandée (« pause » / « arret ») — relue entre deux appels."""
        entree = self.executions.get(campagne_id)
        return entree["commande"] if entree else None

    def demander_commande(self, campagne_id, commande):
        """Enregistre la demande de pause/arrêt ; rend True si un fil tourne."""
        with self._verrou_executions:
            entree = self.executions.get(campagne_id)
            if entree is None:
                return False
            entree["commande"] = commande
            return True

    def terminer_execution(self, campagne_id):
        with self._verrou_executions:
            self.executions.pop(campagne_id, None)

    def peupler_demo(self):
        """Données de démonstration — numéros 100 % fictifs."""
        if self.base.compter_clients():
            return
        maintenant = datetime.datetime.now().replace(second=0, microsecond=0)
        # ⚠ LA LISTE EST DANS `jeu_essai` DEPUIS LE 13/08/2026, pas ici : trois
        # de ces quatre noms existent aussi dans le jeu d'essai sous un AUTRE
        # numéro, et l'agenda d'exemple doit pouvoir les éviter. Deux listes
        # d'identités dans deux fichiers qui s'ignorent, c'est exactement ce
        # qui a produit la dérive — voir jeu_essai.PREMIERS_CONTACTS.
        # ⚠ DANS LA LANGUE DÉJÀ CHOISIE, s'il y en a une. Les réglages et la
        # base sont deux fichiers distincts : quelqu'un qui a mis l'interface
        # en anglais puis repart d'une base neuve doit retrouver un décor
        # anglais. Sur une première installation, la langue vaut le français
        # et rien ne change.
        _, _, premiers, _ = jeu_essai.decor(
            langue.de_preferences(self.preferences))
        for nom, telephone, jours, heure, minute, motif in premiers:
            client_id = self.base.ajouter_client(nom, telephone)
            horaire = (maintenant - datetime.timedelta(days=jours)).replace(
                hour=heure, minute=minute)
            self.base.ajouter_rendezvous(
                client_id, horaire.isoformat(timespec="minutes"), motif, statut="manqué")

    def rappeler(self, rendezvous_id, mission=None):
        """Programme puis exécute immédiatement le rappel de CE rendez-vous.

        Seul l'appel tout juste programmé part : les appels déjà en file
        d'attente (page « File d'appels ») ne sont pas touchés. mission :
        texte facultatif choisi au lancement (thème d'appel).
        """
        appel_id = self.planif.programmer(rendezvous_id)  # ValueError si inconnu
        self.planif.executer(seulement=appel_id, mission=mission)
        return appel_id


class Gestionnaire(assistant_web.RoutesAssistant, BaseHTTPRequestHandler):
    application = None  # injectée par creer_serveur()

    # ------------------------------------------------------------------ routes
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if self._get_assistant(url):
            return  # route de l'assistant en 3 étapes, déjà traitée
        if url.path == "/":
            return self._repondre(self._page_campagnes(
                urllib.parse.parse_qs(url.query)))
        if url.path.startswith("/image/"):
            return self._servir_image(url.path[len("/image/"):])
        if url.path == "/installation":
            # Fragment : UNE page de l'installeur. C'est aussi l'adresse
            # qu'on ouvre à la main pour reprendre la configuration.
            parametres = urllib.parse.parse_qs(url.query)
            return self._repondre_fragment(
                self._page_installeur(parametres.get("page", [""])[0]))
        if url.path == "/suivi":
            return self._repondre(self._page_suivi(urllib.parse.parse_qs(url.query)))
        if url.path == "/suivi/planning":
            # Fragment : la navigation de semaine, le « prochain créneau » et
            # les filtres rechargent CETTE zone, jamais la page entière.
            return self._repondre_fragment(
                self._zone_planning(urllib.parse.parse_qs(url.query)))
        if url.path == "/suivi/detail":
            # Fragment : le contenu de la modale (rendez-vous ou créneau libre).
            return self._repondre_fragment(
                self._modale_planning(urllib.parse.parse_qs(url.query)))
        if url.path == "/campagne":
            parametres = urllib.parse.parse_qs(url.query)
            try:
                campagne_id = int(parametres.get("id", [""])[0])
            except ValueError:
                return self._erreur(400, "Identifiant de campagne invalide.")
            page = self._page_campagne(campagne_id, parametres)
            if page is None:
                return self._erreur(404, "Campagne introuvable.")
            return self._repondre(page)
        if url.path == "/campagne/nouvelle":
            # Un SEUL parcours de création : l'assistant en 3 étapes. Cette
            # ancienne adresse survit pour les marque-pages, en redirection.
            return self._rediriger("/assistant")
        if url.path == "/suivi/plage":
            # Le MENU d'une plage sélectionnée. Un GET ne crée rien.
            # ⚠ C'EST `_modale_plage` QUI RÉPOND : fenêtre au glissé, PAGE
            # entière quand la demande n'en vient pas (repli « Sans glisser »,
            # navigateur sans JavaScript). Voir `_reponse_plage`.
            return self._modale_plage(urllib.parse.parse_qs(url.query))
        if url.path == "/campagnes/effacer":
            # La CONFIRMATION, jamais la suppression : un GET n'efface rien.
            code = urllib.parse.parse_qs(url.query).get("groupe", [""])[0]
            return self._repondre(self._modale_effacer_liste(code))
        if url.path == "/relances":
            return self._repondre(
                self._page_relances(urllib.parse.parse_qs(url.query)))
        if url.path == "/ajouter":
            return self._repondre(self._page_ajout())
        if url.path == "/clients":
            return self._repondre(
                self._page_clients(urllib.parse.parse_qs(url.query)))
        if url.path == "/clients/liste":
            # Fragment : les filtres rechargent la SEULE liste des contacts.
            return self._repondre_fragment(
                self._liste_clients(urllib.parse.parse_qs(url.query)))
        if url.path == "/clients/detail":
            # Fragment : le DOSSIER d'un client en modale (édition comprise).
            # C'est le chemin normal ; /clients/fiche reste le repli sans
            # JavaScript, et le lien de la liste y mène toujours.
            parametres = urllib.parse.parse_qs(url.query)
            try:
                client_id = int(parametres.get("id", [""])[0])
            except ValueError:
                return self._erreur(400, "Identifiant de client invalide.")
            modale = self._modale_client(client_id)
            if modale is None:
                return self._erreur(404, "Client introuvable.")
            return self._repondre_fragment(modale)
        if url.path in ("/clients/detail-rendezvous",
                        "/clients/detail-campagnes"):
            # Fragments : le DÉTAIL d'une des deux colonnes réduites à un
            # nombre. Même contrôle et même forme que /clients/detail.
            parametres = urllib.parse.parse_qs(url.query)
            try:
                client_id = int(parametres.get("id", [""])[0])
            except ValueError:
                return self._erreur(400, "Identifiant de client invalide.")
            if url.path.endswith("rendezvous"):
                modale = self._modale_rendezvous_client(client_id)
            else:
                modale = self._modale_campagnes_client(client_id)
            if modale is None:
                return self._erreur(404, "Client introuvable.")
            return self._repondre_fragment(modale)
        if url.path == "/relances/demande":
            # Fragment : LA DEMANDE d'un contact « à rappeler par un humain ».
            parametres = urllib.parse.parse_qs(url.query)
            try:
                contact_id = int(parametres.get("contact", [""])[0])
            except ValueError:
                return self._erreur(400, "Identifiant de contact invalide.")
            modale = self._modale_demande(contact_id)
            if modale is None:
                return self._erreur(404, "Contact introuvable.")
            return self._repondre_fragment(modale)
        if url.path == "/clients/ligne":
            # Fragment : la SEULE ligne d'un client (rafraîchie après édition).
            parametres = urllib.parse.parse_qs(url.query)
            try:
                client_id = int(parametres.get("id", [""])[0])
            except ValueError:
                return self._erreur(400, "Identifiant de client invalide.")
            fiches = etats_clients.tableau_clients(self.application.base,
                                                   self.application.preferences)
            fiche = next((f for f in fiches
                          if f["client"]["id"] == client_id), None)
            if fiche is None:
                return self._erreur(404, "Client introuvable.")
            return self._repondre_fragment(self._cellules_client(fiche))
        if url.path == "/clients/fiche":
            parametres = urllib.parse.parse_qs(url.query)
            try:
                client_id = int(parametres.get("id", [""])[0])
            except ValueError:
                return self._erreur(400, "Identifiant de client invalide.")
            page = self._page_fiche_client(client_id)
            if page is None:
                return self._erreur(404, "Client introuvable.")
            return self._repondre(page)
        if url.path == "/clients/supprimer":
            parametres = urllib.parse.parse_qs(url.query)
            try:
                client_id = int(parametres.get("id", [""])[0])
            except ValueError:
                return self._erreur(400, "Identifiant de client invalide.")
            page = self._page_confirmer_suppression(client_id)
            if page is None:
                return self._erreur(404, "Client introuvable.")
            return self._repondre(page)
        if url.path == "/reglages":
            return self._repondre(
                self._page_reglages(urllib.parse.parse_qs(url.query)))
        if url.path == "/suivi/importer":
            return self._repondre(self._modale_import())
        if url.path == "/suivi/ajout":
            return self._repondre(self._modale_ajout(
                urllib.parse.parse_qs(url.query)))
        if url.path == "/reglages/agenda-exemple.ics":
            # ⚠ FABRIQUÉ ICI, À CHAQUE DEMANDE. Rien n'est écrit sur le disque :
            # un fichier rangé vieillirait comme les trois exemples livrés.
            # ⚠ ET AVEC LES RÉGLAGES : les rendez-vous tombent dans les heures
            # d'ouverture réelles, au pas réel, jamais un samedi fermé.
            texte = agenda_exemple.agenda_ics(
                preferences=self.application.preferences)
            journal.info("Agenda d'exemple engendré : %d événement(s) — "
                         "données fictives", texte.count("BEGIN:VEVENT"))
            return self._repondre_fichier(
                texte.encode("utf-8"), "text/calendar; charset=utf-8",
                "agenda-exemple-ringback.ics")
        if url.path == "/reglages/jeu-essai":
            parametres = urllib.parse.parse_qs(url.query)
            return self._repondre(self._page_confirmer_jeu_essai(
                parametres.get("action", [""])[0]))
        if url.path == "/reglages/essai-reel":
            parametres = urllib.parse.parse_qs(url.query)
            return self._repondre(self._page_confirmer_essai_reel(
                nombre_brut=parametres.get("nombre", [""])[0]))
        if url.path == "/reglages/testeurs":
            # Fragment : la liste des testeurs se recharge SEULE après un
            # ajout ou un retrait (jamais la page).
            return self._repondre_fragment(self._bloc_testeurs())
        if url.path == "/reglages/campagne-essai":
            # Fragment : l'aperçu « qui joue quoi » se recharge SEUL quand la
            # liste des testeurs change, ou le nombre d'identités demandé.
            parametres = urllib.parse.parse_qs(url.query)
            return self._repondre_fragment(self._bloc_essai_reel(
                parametres.get("nombre", [""])[0]))
        if url.path == "/reglages/creneaux":
            # Fragment : la liste des créneaux proposables se recharge SEULE
            # après un glisser-relâché sur le calendrier (jamais la page).
            return self._repondre_fragment(self._bloc_creneaux())
        if url.path == "/rappel":
            parametres = urllib.parse.parse_qs(url.query)
            try:
                rdv_id = int(parametres.get("rdv", [""])[0])
            except ValueError:
                return self._erreur(400, "Identifiant invalide.")
            page = self._page_preparer_rappel(rdv_id)
            if page is None:
                return self._erreur(404, "Rendez-vous introuvable.")
            return self._repondre(page)
        if url.path == "/cascade":
            return self._repondre(self._page_cascade())
        if url.path == "/cascade/resultat":
            parametres = urllib.parse.parse_qs(url.query)
            try:
                cascade_id = int(parametres.get("id", [""])[0])
            except ValueError:
                return self._erreur(400, "Identifiant de cascade invalide.")
            page = self._page_resultat_cascade(cascade_id)
            if page is None:
                return self._erreur(404, "Cascade introuvable.")
            return self._repondre(page)
        if url.path == "/sans-numero":
            return self._repondre(self._page_sans_numero())
        if url.path == "/tous":
            return self._repondre(self._page_tous(urllib.parse.parse_qs(url.query)))
        if url.path == "/file":
            return self._repondre(self._page_file(urllib.parse.parse_qs(url.query)))
        if url.path == "/rendezvous":
            parametres = urllib.parse.parse_qs(url.query)
            try:
                rdv_id = int(parametres.get("id", [""])[0])
            except ValueError:
                return self._erreur(400, "Identifiant invalide.")
            page = self._page_fiche(rdv_id, parametres)
            if page is None:
                return self._erreur(404, "Rendez-vous introuvable.")
            return self._repondre(page)
        return self._erreur(404, "Page inconnue.")

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        taille = int(self.headers.get("Content-Length", 0))
        corps = self.rfile.read(taille)
        if self._post_assistant(url, corps):
            return  # route de l'assistant en 3 étapes, déjà traitée
        if url.path == "/langue":
            return self._traiter_langue(corps)
        if url.path == "/campagne/clore":
            return self._traiter_cloture_campagne(corps)
        if url.path == "/suivi/plage/creneau-libere":
            return self._traiter_plage_creneau_libere(corps)
        # Les trois campagnes qu'une plage DE RENDEZ-VOUS ouvre (10/08/2026).
        # Une route par nature, pour que l'adresse dise ce qu'elle fait.
        for nature, _, _ in self.CAMPAGNES_DE_PLAGE:
            if url.path == f"/suivi/plage/{nature.replace('_', '-')}":
                return self._campagne_depuis_plage(corps, nature)
        if url.path == "/campagnes/effacer":
            return self._traiter_effacer_liste(corps)
        if url.path == "/relances/executer":
            return self._traiter_execution_relances()
        if url.path.startswith("/installation/"):
            geste = url.path[len("/installation/"):]
            if geste == "valider":
                return self._traiter_installation_valider(
                    corps, urllib.parse.parse_qs(url.query).get(
                        "page", [""])[0])
            if geste == "marquer":
                return self._traiter_installation_marquer(corps)
            if geste == "copier":
                return self._traiter_installation_copier(corps)
            if geste == "defauts":
                return self._traiter_installation_defauts(corps)
            if geste == "agenda":
                return self._traiter_installation_agenda(corps)
            if geste == "plus-tard":
                return self._traiter_installation_plus_tard()
            if geste == "terminer":
                return self._traiter_installation_terminer()
            if geste == "rouvrir":
                return self._traiter_installation_rouvrir()
            return self._erreur(404, "Geste d'installation inconnu.")
        if url.path == "/relances/reporter":
            return self._traiter_report_relance(corps)
        if url.path == "/relances/annuler":
            return self._traiter_annulation_relance(corps)
        if url.path == "/relances/humain":
            return self._traiter_rappel_humain(corps)
        if url.path == "/suivi/detail/enregistrer":
            return self._traiter_enregistrement_rendezvous(corps)
        if url.path == "/suivi/detail/annuler":
            return self._traiter_annulation_modale(corps)
        if url.path == "/suivi/detail/deplacer":
            return self._traiter_deplacement_campagne(corps)
        if url.path == "/suivi/detail/rappel":
            return self._traiter_rappel_campagne(corps)
        if url.path == "/suivi/rappel/campagne":
            return self._traiter_rappel_semaine(corps)
        if url.path == "/clients/detail/enregistrer":
            return self._traiter_enregistrement_client(corps)
        if url.path == "/rappeler":
            return self._traiter_rappel(corps)
        if url.path == "/ajouter":
            return self._traiter_ajout(corps)
        if url.path == "/importer":
            return self._traiter_import(corps)
        if url.path == "/importer-ics":
            return self._traiter_import_ics(corps)
        if url.path == "/completer-numero":
            return self._traiter_completer_numero(corps)
        if url.path == "/cascade/executer":
            return self._traiter_cascade(corps)
        if url.path == "/cascade/generer":
            return self._traiter_generation(corps)
        if url.path == "/cascade/csv":
            return self._traiter_csv(corps)
        if url.path == "/file/tout-rappeler":
            return self._traiter_tout_rappeler()
        if url.path == "/file/annuler":
            return self._traiter_annulation_file(corps)
        if url.path == "/file/annuler-tout":
            return self._traiter_annulation_totale_file()
        if url.path == "/file/executer":
            return self._traiter_execution_file(corps)
        if url.path == "/ignorer-tout":
            return self._traiter_ignorer_tout()
        if url.path == "/retablir":
            return self._traiter_retablir(corps)
        if url.path == "/clients/campagne":
            return self._traiter_campagne_depuis_etat(corps)
        if url.path == "/clients/propositions":
            return self._traiter_propositions(corps)
        if url.path == "/clients/ne-plus-appeler":
            return self._traiter_ne_plus_appeler(corps)
        if url.path == "/clients/modifier":
            return self._traiter_modification_client(corps)
        if url.path == "/clients/supprimer":
            return self._traiter_suppression_client(corps)
        if url.path == "/reglages/enregistrer":
            return self._traiter_reglages(corps)
        if url.path == "/reglages/calle":
            return self._traiter_cle_calle(corps)
        if url.path == "/reglages/calle-retirer":
            return self._traiter_retrait_cle_calle(corps)
        if url.path == "/reglages/discours":
            return self._traiter_discours(corps)
        if url.path == "/reglages/comportement":
            return self._traiter_comportement(corps)
        if url.path == "/reglages/creneau-ajouter":
            return self._traiter_creneau_ajouter(corps)
        if url.path == "/reglages/creneau-retirer":
            return self._traiter_creneau_retirer(corps)
        if url.path == "/reglages/pas":
            return self._traiter_pas(corps)
        if url.path == "/reglages/semaine":
            return self._traiter_semaine(corps)
        if url.path == "/reglages/jour-ferme":
            return self._traiter_jour_ferme(corps)
        if url.path == "/rendezvous/duree":
            return self._traiter_duree_rendezvous(corps)
        if url.path == "/rendezvous/deplacer":
            return self._traiter_deplacement(corps)
        if url.path == "/rendezvous/annuler":
            return self._traiter_annulation_rendezvous(corps)
        if url.path == "/reglages/jeu-essai":
            return self._traiter_jeu_essai(corps)
        if url.path == "/reglages/essai-reel":
            return self._traiter_essai_reel(corps)
        if url.path == "/reglages/testeur":
            return self._traiter_testeur(corps)
        if url.path == "/reglages/renvoi-essai":
            return self._traiter_renvoi_essai(corps)
        return self._erreur(404, "Page inconnue.")

    # --------------------------------------------------------------- actions
    def _mission_choisie(self, donnees):
        """La mission envoyée par le formulaire (thème d'appel), ou None.

        Priorité au texte de la zone (pré-rempli PUIS éventuellement modifié
        par l'utilisateur) ; à défaut, le gabarit du thème choisi ; à défaut
        (POST direct sans champ), None = consigne standard historique.
        """
        mission = " ".join(donnees.get("mission", [""])[0].split())
        if mission:
            return mission
        theme = donnees.get("theme", [""])[0]
        if theme and theme in themes.GABARITS:
            return themes.preremplir(theme, self.application.preferences,
                                     creneaux=self._creneaux_lisibles()) or None
        return None

    def _creneaux_lisibles(self, tranches=1):
        """Les créneaux à proposer, en français — CALCULÉS puis complétés.

        Ouvert (semaine type) − déjà pris (rendez-vous) − jours fermés, plus
        les créneaux ajoutés à la main. C'est la source unique de
        [créneaux_disponibles] pour les rappels, la file et les cascades.
        """
        return horaires.creneaux_lisibles(self.application.base,
                                          self.application.preferences,
                                          tranches=tranches)

    def _refus_hors_plage(self, forcer=False, rejeu=None):
        """Le garde-fou de politesse, tenu sur les CINQ portes d'appel.

        Deux règles, une seule vérification — c'est ce qui garantit qu'elles
        valent partout : la PLAGE d'appel autorisée, et la PÉRIODE INTERDITE
        (décision du propriétaire : elle vaut pour tout, sans dérogation,
        même pour un geste individuel). Envoie la page 403 en français et
        rend True si l'appel est refusé ; rend False sinon.

        `forcer` : le geste « je force malgré l'heure » a été fait. Il ne lève
        QUE la plage horaire, et SEULEMENT EN SIMULATION — voir
        assistant.CLE_HORAIRE_FORCE. En appels réels il est ignoré, et ce n'est
        pas une politesse de façade : c'est ici que la décision se prend, pas
        dans le formulaire qui l'a demandée.

        `rejeu` : les champs à renvoyer si l'utilisateur veut forcer. Fournis,
        et en simulation, et si l'heure est le SEUL obstacle, la page de refus
        porte alors le bouton qui rejoue le même geste. Absents (les quatre
        autres portes), la page de refus est celle d'avant, à la lettre.
        """
        preferences = self.application.preferences
        simulation = not self.application.mode_reel
        # La période interdite d'abord : elle ne se force jamais, et le dire
        # AVANT évite de proposer un bouton qui ne débloquerait rien.
        message = assistant.dans_periode_interdite(preferences)
        tardif = themes.hors_plage(preferences)
        levable = message is None and tardif is not None and simulation
        if message is None and not (forcer and simulation):
            message = tardif
        if not message:
            return False
        journal.info("Lancement refusé : %s", message)
        if rejeu is not None and levable:
            self._erreur_heure(message, rejeu)
        else:
            self._erreur(403, message)
        return True

    def _erreur_heure(self, message, rejeu):
        """La page de refus « hors plage » AVEC le bouton qui force — simulation.

        ⚠ POURQUOI CE BOUTON EXISTE (13/08/2026). Le propriétaire essaie son
        produit le soir : le garde-fou de politesse lui refusait la campagne
        alors qu'aucun téléphone ne sonne en simulation. Le garde-fou protège
        des gens ; en simulation il n'y a personne à protéger, et il ne faisait
        qu'empêcher d'essayer.

        `rejeu` rejoue le geste refusé À L'IDENTIQUE, avec un champ de plus :
        rien n'est deviné ni reconstruit, et l'écran qui suit est celui qu'il
        aurait eu à l'heure permise.
        """
        champs = "".join(
            f'<input type="hidden" name="{html.escape(str(nom))}" '
            f'value="{html.escape(str(valeur))}">'
            for nom, valeur in rejeu.items() if nom != "action")
        corps = (
            "<h1>Erreur 403</h1>"
            f"<p>{html.escape(message)}</p>"
            '<div class="pastille"><p><strong>Vous êtes en simulation : '
            "aucun téléphone ne sonnera.</strong> Le garde-fou de politesse "
            "sert à ne pas déranger de vraies personnes — en simulation, il "
            "n'y a personne à déranger. Vous pouvez donc passer outre pour "
            "cette campagne.</p>"
            f'<form method="post" action="{html.escape(rejeu["action"])}">'
            f'{champs}'
            '<input type="hidden" name="forcer_horaire" value="1">'
            '<button>Forcer la simulation malgré l\'heure</button>'
            "</form>"
            "<p><small>Ce bouton n'existe qu'en simulation. En appels réels, "
            "l'heure ne se force pas — même en cliquant, même en rejouant "
            "cette adresse.</small></p></div>"
            '<p><a href="/campagnes">← Retour aux campagnes</a></p>')
        self._repondre(self._page("Erreur", corps), 403)

    def _panne_de_notre_cote(self, panne):
        """La page d'une panne DE NOTRE CÔTÉ — celle qui dit ce qui n'a PAS eu lieu.

        Pas un « échec technique » anonyme : le message porte ce qui s'est
        passé, que personne n'a été appelé, qu'aucun crédit n'a été
        consommé, et quoi faire (voir calle_client.EchecDeNotreCote). Le
        code 503 dit la vérité de la situation : le service n'a pas pu
        rendre le service, et ce n'est pas la faute de qui on appelait.
        """
        journal.error("Appel interrompu — %s", panne)
        # LE TITRE DOIT ÊTRE VRAI. « Aucun appel n'est parti » est juste
        # quand la demande a été refusée avant de partir — et FAUX quand le
        # téléphone a sonné. Deux cas où il a sonné : le résultat n'est pas
        # encore connu, ou il est arrivé et RingBack n'a pas su le lire.
        brut = ""
        if isinstance(panne, calle_client.ResultatInvalide):
            titre = "Réponse illisible"
            entete = ("<h1>🙋 L'appel a eu lieu — RingBack n'a pas su lire "
                      "la réponse</h1>")
            if panne.reponse_brute:
                # ③ NE PLUS ÊTRE AVEUGLE : la réponse, sous les yeux, tout
                # de suite. C'est ce qui manquait le 01/08/2026.
                brut = ("<h2>Ce que CALL-E a répondu, mot pour mot</h2>"
                        f"<pre>{html.escape(panne.reponse_brute)}</pre>")
        elif isinstance(panne, calle_client.ResultatEnAttente):
            titre = "Résultat en attente"
            entete = ("<h1>⏱ L'appel est parti — son résultat n'est pas "
                      "encore connu</h1>")
        else:
            titre = "Appel impossible"
            entete = "<h1>⛔ Aucun appel n'est parti</h1>"
        # LA CITATION, DANS SON PROPRE BLOC, quelle que soit la panne. Le
        # 02/08/2026 le message promettait « lisez la réponse citée ci-dessus »
        # et rien n'était cité : la citation est ce qui nomme le champ refusé,
        # elle mérite d'être lisible, pas noyée dans un paragraphe.
        texte = str(panne)
        if not brut and getattr(panne, "reponse_brute", ""):
            texte = panne.message(citer=False)
            brut = ("<h2>Ce que CALL-E a répondu, mot pour mot</h2>"
                    f"<pre>{html.escape(panne.reponse_brute)}</pre>")
        self._repondre(self._page(
            titre,
            entete
            + f'<p class="erreurs">{html.escape(texte)}</p>'
            + brut
            + '<p><a href="/campagnes">← Retour aux campagnes</a></p>'), 503)

    # ---------------------------------------------- campagnes : assistant
    def _rediriger(self, ou):
        self.send_response(303)
        self.send_header("Location", ou)
        self.end_headers()

    def _traiter_langue(self, corps):
        """Change la langue de l'interface, et REVIENT SUR LA PAGE QUITTÉE.

        ⚠ LE RETOUR EST LA MOITIÉ DU GESTE. Basculer en anglais et se
        retrouver sur l'accueil ferait perdre l'écran qu'on était en train de
        lire — un testeur au milieu d'une campagne ne retrouverait pas où il
        en était. On revient donc d'où l'on vient.

        ⚠ MAIS ON NE SUIT PAS N'IMPORTE QUELLE ADRESSE. Le « Referer » est
        envoyé par le navigateur : une page extérieure pourrait y écrire ce
        qu'elle veut. On n'en garde donc que le CHEMIN, et seulement s'il
        commence par « / » sans être « // » (qui désigne un autre site).
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        choisie = langue.langue_valide(donnees.get("vers", [""])[0])
        self.application.preferences.definir(langue.CLE_LANGUE, choisie)
        return self._rediriger(self._retour_sur_place())

    def _retour_sur_place(self, defaut="/"):
        """Le chemin de la page d'où vient la demande, ou `defaut`."""
        venue = self.headers.get("Referer") or ""
        chemin = urllib.parse.urlparse(venue).path
        if not chemin.startswith("/") or chemin.startswith("//"):
            return defaut
        requete = urllib.parse.urlparse(venue).query
        return f"{chemin}?{requete}" if requete else chemin

    def _traiter_cloture_campagne(self, corps):
        """Clôture manuelle d'une campagne : ses relances sont annulées."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            campagne_id = int(donnees.get("campagne", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de campagne invalide.")
        if self.application.base.obtenir_campagne(campagne_id) is None:
            return self._erreur(404, "Campagne introuvable.")
        campagnes.clore_campagne(self.application.base, campagne_id)
        return self._rediriger(f"/campagne?id={campagne_id}&close=1")

    # ----------------------------------------------------------- relances
    def _traiter_execution_relances(self):
        """Le GESTE HUMAIN « Lancer les relances dues » — jamais automatique.

        Les mêmes verrous que partout : plage horaire d'abord, puis les
        trois verrous d'appels réels du planificateur.
        """
        if self._refus_hors_plage():
            return
        try:
            comptes_rendus = campagnes.executer_relances_dues(
                self.application.base, self.application.planif,
                self.application.preferences)
        except planificateur.GardeFou as erreur:
            return self._erreur(403, str(erreur))
        return self._repondre(self._page_resultat_relances(comptes_rendus))

    def _traiter_report_relance(self, corps):
        """Reporte une relance à une nouvelle échéance (modifiable, toujours)."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        vue = _vue_relances(donnees.get("vue", [""])[0])
        try:
            relance_id = int(donnees.get("relance", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de relance invalide.")
        relance = self.application.base.obtenir_relance(relance_id)
        if relance is None or relance["statut"] != "planifiée":
            return self._rediriger(f"/relances?vue={vue}&fait=absente")
        try:
            echeance = saisie.valider_horaire(donnees.get("echeance", [""])[0])
        except saisie.SaisieInvalide as erreur:
            return self._repondre(self._page_relances({"vue": [vue]},
                                                      erreurs=[str(erreur)]))
        self.application.base.changer_relance(relance_id, echeance=echeance)
        return self._rediriger(f"/relances?vue={vue}&fait=reportee")

    def _traiter_annulation_relance(self, corps):
        """Annule une relance planifiée (la chaîne de ce contact s'arrête là)."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        vue = _vue_relances(donnees.get("vue", [""])[0])
        try:
            relance_id = int(donnees.get("relance", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de relance invalide.")
        base = self.application.base
        relance = base.obtenir_relance(relance_id)
        if relance is None or relance["statut"] != "planifiée":
            return self._rediriger(f"/relances?vue={vue}&fait=absente")
        base.changer_relance(relance_id, statut="annulée")
        campagnes.mettre_a_jour_statut_campagne(base, relance["campagne_id"])
        return self._rediriger(f"/relances?vue={vue}&fait=annulee")

    def _traiter_rappel(self, corps):
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            rdv_id = int(donnees.get("rdv", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant invalide.")
        if self._refus_hors_plage():
            return
        try:
            self.application.rappeler(rdv_id, mission=self._mission_choisie(donnees))
        except calle_client.EchecDeNotreCote as panne:
            # L'appel n'a pas eu lieu et il est resté en file : rien n'est
            # écrit sur ce rendez-vous, l'écran dit pourquoi.
            return self._panne_de_notre_cote(panne)
        except planificateur.ClientExclu as erreur:
            return self._erreur(403, str(erreur))
        except planificateur.GardeFou as erreur:
            # Ceinture et bretelles : les mêmes verrous, relus au plus près
            # de l'appel (plage, période interdite, appels réels).
            return self._erreur(403, str(erreur))
        except ValueError:
            return self._erreur(404, "Rendez-vous introuvable.")
        self.send_response(303)
        self.send_header("Location", f"/rendezvous?id={rdv_id}")
        self.end_headers()

    @staticmethod
    def _rappel_souhaite_valide(donnees):
        """Le champ optionnel « rappel souhaité » validé, ou None si vide.

        Lève SaisieInvalide (message français) si la date est illisible.
        """
        brut = donnees.get("rappel_souhaite", [""])[0].strip()
        if not brut:
            return None
        try:
            return saisie.valider_horaire(brut)
        except saisie.SaisieInvalide as erreur:
            raise saisie.SaisieInvalide(f"Rappel souhaité : {erreur}") from None

    def _traiter_ajout(self, corps):
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        base = self.application.base
        if "forcer" in donnees:
            # « Ajouter quand même » après le signal de doublon : le client
            # existe déjà, on repart de son identifiant — le numéro de
            # téléphone ne refait JAMAIS le trajet dans la page.
            try:
                client_id = int(donnees.get("forcer", [""])[0])
            except ValueError:
                return self._erreur(400, "Identifiant de client invalide.")
            if base.telephone_de(client_id) is None:
                return self._erreur(404, "Client introuvable.")
            try:
                horaire = saisie.valider_horaire(donnees.get("date_heure", [""])[0])
                motif = saisie.valider_motif(donnees.get("motif", [""])[0])
                rappel = self._rappel_souhaite_valide(donnees)
            except saisie.SaisieInvalide as erreur:
                return self._erreur(400, str(erreur))
            rdv_id = base.ajouter_rendezvous(client_id, horaire, motif,
                                             rappel_souhaite=rappel)
            base.marquer_manques_echus()
            return self._repondre(self._page_confirmation_ajout(rdv_id))
        champs = {nom: donnees.get(nom, [""])[0]
                  for nom in ("nom", "telephone", "date_heure", "motif",
                              "rappel_souhaite")}
        propres, erreurs = saisie.valider_entree(
            champs["nom"], champs["telephone"], champs["date_heure"], champs["motif"])
        rappel = None
        try:
            rappel = self._rappel_souhaite_valide(donnees)
        except saisie.SaisieInvalide as erreur:
            erreurs.append(str(erreur))
        if erreurs:
            # Le formulaire est ré-affiché avec les messages ; le numéro,
            # lui, n'est jamais renvoyé dans la page (règle de masquage).
            return self._repondre(self._page_ajout(valeurs=champs, erreurs=erreurs))
        # Garde-fou doublon : même client + même horaire déjà en base ->
        # on SIGNALE au lieu de créer un double en silence.
        existant = base.rendezvous_identique(
            propres["nom"], propres["telephone"], propres["date_heure"])
        if existant is not None:
            return self._repondre(self._page_doublon(existant, propres, rappel))
        client_id = base.obtenir_ou_creer_client(propres["nom"], propres["telephone"])
        rdv_id = base.ajouter_rendezvous(client_id, propres["date_heure"],
                                         propres["motif"], rappel_souhaite=rappel)
        base.marquer_manques_echus()  # un horaire déjà passé devient « manqué »
        return self._repondre(self._page_confirmation_ajout(rdv_id))

    def _traiter_import(self, corps):
        type_contenu = self.headers.get("Content-Type", "")
        if not type_contenu.startswith("multipart/form-data"):
            return self._erreur(400, "Envoi invalide : un fichier CSV est attendu.")
        octets = _extraire_fichier(type_contenu, corps)
        if not octets:
            return self._erreur(400, "Aucun fichier reçu — choisissez un fichier CSV.")
        bilan = {}
        try:
            texte = saisie.decoder_csv(octets)
            importes, erreurs = saisie.importer_csv(
                self.application.base, texte,
                self.application.preferences, bilan)
        except saisie.SaisieInvalide as erreur:
            return self._erreur(400, str(erreur))
        self.application.base.marquer_manques_echus()
        # Quand l'agenda a-t-il été alimenté pour la dernière fois ? C'est le
        # fait le plus utile du rappel affiché avant de démarrer une
        # campagne — encore faut-il l'avoir noté au moment où ça arrive.
        horaires.noter_import_agenda(self.application.preferences,
                                     "fichier CSV", importes)
        # ⚠ ON REVIENT SUR L'AGENDA (10/08/2026, demande du propriétaire) : un
        # import se fait POUR remplir le planning, et c'est le planning qu'on
        # veut voir ensuite. Le compte rendu s'affiche en tête, pas ailleurs.
        bilan.update({"quoi": "fichier CSV", "importes": importes,
                      "erreurs": erreurs})
        jeton = self.application.retenir_bilan_import(bilan)
        return self._rediriger(f"/suivi?import={jeton}")

    def _traiter_import_ics(self, corps):
        """Import d'un agenda ICS : rendez-vous créés SANS numéro, à compléter."""
        type_contenu = self.headers.get("Content-Type", "")
        if not type_contenu.startswith("multipart/form-data"):
            return self._erreur(400, "Envoi invalide : un fichier ICS est attendu.")
        champs, octets = _analyser_multipart(type_contenu, corps)
        if not octets:
            return self._erreur(400, "Aucun fichier reçu — choisissez un fichier ICS.")
        remplacer_tout = champs.get("remplacer_tout") == "1"
        bilan = {}
        try:
            texte = saisie.decoder_csv(octets)  # même décodage tolérant que le CSV
            importes, erreurs = ics.importer_ics(
                self.application.base, texte, self.application.preferences,
                remplacer_tout=remplacer_tout, bilan=bilan)
        except saisie.SaisieInvalide as erreur:
            return self._erreur(400, str(erreur))
        self.application.base.marquer_manques_echus()
        horaires.noter_import_agenda(self.application.preferences,
                                     "agenda ICS", importes)
        bilan.update({"quoi": "agenda ICS", "importes": importes,
                      "erreurs": erreurs})
        jeton = self.application.retenir_bilan_import(bilan)
        return self._rediriger(f"/suivi?import={jeton}")

    def _traiter_completer_numero(self, corps):
        """Renseigne le numéro d'un client importé sans téléphone."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            client_id = int(donnees.get("client", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de client invalide.")
        try:
            telephone = saisie.valider_telephone(donnees.get("telephone", [""])[0])
        except saisie.SaisieInvalide as erreur:
            return self._repondre(self._page_sans_numero(erreurs=[str(erreur)]))
        if self.application.base.telephone_de(client_id) is None:
            return self._erreur(404, "Client introuvable.")
        self.application.base.mettre_a_jour_telephone(client_id, telephone)
        self.send_response(303)
        self.send_header("Location", "/sans-numero?fait=1")
        self.end_headers()

    def _traiter_cascade(self, corps):
        """Valide la saisie puis lance la cascade « premier oui » (séquentielle)."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        liste = donnees.get("liste", [""])[0]
        mission = " ".join(donnees.get("mission", [""])[0].split())
        creneau_brut = donnees.get("creneau", [""])[0]
        personnes, erreurs = saisie.analyser_liste_cascade(liste)
        if not mission:
            erreurs.append("La mission est obligatoire : c'est le message "
                           "que l'agent lit au téléphone.")
        creneau = None
        try:
            creneau = saisie.valider_horaire(creneau_brut)
        except saisie.SaisieInvalide as erreur:
            erreurs.append(f"Créneau proposé : {erreur}")
        if erreurs:
            # La liste (qui contient des numéros en clair) n'est jamais
            # renvoyée dans la page — même prudence que le formulaire d'ajout.
            return self._repondre(self._page_cascade(
                erreurs=erreurs, mission=mission, creneau=creneau_brut))
        if self._refus_hors_plage():
            return
        try:
            cascade_id = self.application.planif.executer_cascade(
                personnes, mission, creneau)
        except calle_client.EchecDeNotreCote as panne:
            # Cascade interrompue par une panne de NOTRE côté : aucune
            # campagne n'est créée, donc aucune relance n'est armée pour des
            # gens que personne n'a appelés.
            return self._panne_de_notre_cote(panne)
        except planificateur.GardeFou as erreur:
            return self._erreur(403, str(erreur))
        # Rattachement au modèle campagne : ce parcours direct crée SA
        # campagne (thème « créneau libéré ») — relances comprises si le
        # créneau n'est pas pourvu. Rien n'est dupliqué : la cascade reste
        # la mécanique, la campagne en est le dossier.
        cascade = self.application.base.obtenir_cascade(cascade_id)
        campagnes.campagne_depuis_cascade(
            self.application.base, self.application.preferences, cascade_id,
            personnes, cascade["mission"], creneau)
        self.send_response(303)
        self.send_header("Location", f"/cascade/resultat?id={cascade_id}")
        self.end_headers()

    @staticmethod
    def _champs_cascade(corps):
        """Les champs du formulaire cascade, tels que postés."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        return {"liste": donnees.get("liste", [""])[0],
                "mission": donnees.get("mission", [""])[0],
                "creneau": donnees.get("creneau", [""])[0],
                "source": donnees.get("source", [""])[0],
                "ordre": donnees.get("ordre", [""])[0]}

    def _generer_personnes(self, champs):
        """Valide source/ordre/créneau puis génère ; rend (personnes, exclus).

        Lève SaisieInvalide (messages français) si la saisie est fautive.
        Le dernier choix (source + ordre) est mémorisé après un succès.
        """
        creneau = None
        # Le créneau n'est validé que si l'ordre en a besoin (proximité) ;
        # son absence est signalée en français par generation.generer().
        if champs["ordre"] == "proximite" and champs["creneau"].strip():
            creneau = saisie.valider_horaire(champs["creneau"])
        personnes, exclus = generation.generer(
            self.application.base, champs["source"], champs["ordre"], creneau)
        self.application.preferences.definir("cascade_source", champs["source"])
        self.application.preferences.definir("cascade_ordre", champs["ordre"])
        return personnes, exclus

    def _traiter_generation(self, corps):
        """Remplit la zone de collage depuis la base (source + ordre choisis).

        Contrairement aux erreurs de LANCEMENT (qui effacent la liste par
        prudence), les erreurs de génération conservent la zone de collage :
        son contenu vient de l'utilisateur lui-même ou d'une génération
        précédente qu'il est en train d'affiner.
        """
        champs = self._champs_cascade(corps)
        try:
            personnes, exclus = self._generer_personnes(champs)
        except saisie.SaisieInvalide as erreur:
            return self._repondre(self._page_cascade(
                erreurs=[str(erreur)], mission=champs["mission"],
                creneau=champs["creneau"], liste=champs["liste"],
                source=champs["source"], ordre=champs["ordre"]))
        if personnes:
            message = (f"{len(personnes)} personne(s) dans la liste — ordre : "
                       f"{generation.ORDRES[champs['ordre']]}. Vous pouvez la "
                       "modifier ou la réordonner à la main avant de lancer.")
        else:
            message = ("Aucun candidat trouvé depuis cette source — "
                       "la liste est restée vide.")
        return self._repondre(self._page_cascade(
            mission=champs["mission"], creneau=champs["creneau"],
            liste=generation.en_liste_collable(personnes),
            source=champs["source"], ordre=champs["ordre"],
            message=message, exclus=exclus))

    def _traiter_csv(self, corps):
        """Sert la liste en CSV (nom;telephone) — généré à la volée.

        Si la zone de collage contient une liste, c'est ELLE qui part (y
        compris un réordonnancement fait à la main) ; sinon la liste est
        générée depuis la source et l'ordre choisis. Le fichier contient
        les numéros EN CLAIR par nature (c'est son but, annoncé sur la
        page) et n'est JAMAIS écrit côté serveur.
        """
        champs = self._champs_cascade(corps)
        if champs["liste"].strip():
            personnes, erreurs = saisie.analyser_liste_cascade(champs["liste"])
            if erreurs:
                return self._repondre(self._page_cascade(
                    erreurs=erreurs, mission=champs["mission"],
                    creneau=champs["creneau"], liste=champs["liste"],
                    source=champs["source"], ordre=champs["ordre"]))
        else:
            try:
                personnes, _ = self._generer_personnes(champs)
            except saisie.SaisieInvalide as erreur:
                return self._repondre(self._page_cascade(
                    erreurs=[str(erreur)], mission=champs["mission"],
                    creneau=champs["creneau"], liste=champs["liste"],
                    source=champs["source"], ordre=champs["ordre"]))
        contenu = generation.en_csv(personnes).encode("utf-8-sig")  # BOM pour Excel
        nom_fichier = datetime.date.today().strftime("liste_rappel_%Y%m%d.csv")
        journal.info("Export CSV de la liste de cascade : %d personne(s) "
                     "(fichier %s, servi à la volée)", len(personnes), nom_fichier)
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition",
                         f'attachment; filename="{nom_fichier}"')
        self.send_header("Content-Length", str(len(contenu)))
        self.end_headers()
        self.wfile.write(contenu)

    def _repondre_fichier(self, contenu, type_contenu, nom_fichier):
        """Sert un fichier à télécharger, engendré à la volée.

        ⚠ RIEN N'EST ÉCRIT SUR LE DISQUE. Le produit tient cette règle pour
        l'export CSV des numéros en clair ; l'agenda d'exemple la suit, pour une
        autre raison — un fichier rangé vieillirait, et c'est exactement ce
        qu'on cherche à éviter.
        """
        self.send_response(200)
        self.send_header("Content-Type", type_contenu)
        self.send_header("Content-Disposition",
                         f'attachment; filename="{nom_fichier}"')
        self.send_header("Content-Length", str(len(contenu)))
        self.end_headers()
        self.wfile.write(contenu)

    def _traiter_tout_rappeler(self):
        """Met en file tous les rendez-vous manqués (sans doublon), puis /file."""
        self.application.base.marquer_manques_echus()
        crees = self.application.planif.programmer_tous_les_manques()
        self.send_response(303)
        self.send_header("Location", f"/file?mis={len(crees)}")
        self.end_headers()

    def _traiter_annulation_file(self, corps):
        """Retire un appel de la file AVANT exécution, puis retour à /file."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            appel_id = int(donnees.get("appel", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant d'appel invalide.")
        retire = self.application.planif.annuler(appel_id)
        self.send_response(303)
        self.send_header("Location", f"/file?annule={'ok' if retire else 'absent'}")
        self.end_headers()

    def _traiter_annulation_totale_file(self):
        """« Vider la file » : annule TOUS les appels en attente, puis /file."""
        annules = self.application.planif.annuler_tout()
        self.send_response(303)
        self.send_header("Location", f"/file?vide={annules}")
        self.end_headers()

    def _traiter_execution_file(self, corps):
        """Exécute toute la file puis affiche les issues appel par appel.

        Le formulaire porte le thème d'appel choisi et sa mission (modifiable) ;
        hors de la plage horaire autorisée, le lancement est refusé.
        """
        if self._refus_hors_plage():
            return
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        mission = self._mission_choisie(donnees)
        planif = self.application.planif
        # Identifiants notés AVANT l'exécution : la page de résultats montre
        # aussi les éventuels échecs, que executer() ne renvoie pas.
        a_traiter = [entree["appel_id"] for entree in planif.file]
        try:
            planif.executer(mission=mission)
        except calle_client.EchecDeNotreCote as panne:
            # La file n'est PAS vidée : les appels non passés y sont restés,
            # tels quels. Aucune campagne n'est créée pour des appels qui
            # n'ont pas eu lieu.
            return self._panne_de_notre_cote(panne)
        except planificateur.GardeFou as erreur:
            return self._erreur(403, str(erreur))
        # Rattachement au modèle campagne : cette exécution en lot devient
        # une campagne « rappel d'appels manqués » — les appels non aboutis
        # y reçoivent leur relance programmée.
        campagne_id = campagnes.campagne_depuis_file(
            self.application.base, self.application.preferences, a_traiter,
            mission or "Consigne standard du rappel de rendez-vous manqué")
        return self._repondre(
            self._page_resultat_execution(a_traiter, campagne_id))

    def _traiter_ignorer_tout(self):
        """« Vider la liste » : tous les manqués passent « ignoré » (réversible)."""
        ignores = self.application.base.ignorer_tous_les_manques()
        self.send_response(303)
        self.send_header("Location", f"/suivi?ignores={ignores}")
        self.end_headers()

    def _traiter_retablir(self, corps):
        """Rend un rendez-vous « ignoré » à la liste « À rappeler »."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            rdv_id = int(donnees.get("rdv", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant invalide.")
        retabli = self.application.base.retablir_manque(rdv_id)
        self.send_response(303)
        self.send_header("Location",
                         f"/tous?retabli={'ok' if retabli else 'absent'}")
        self.end_headers()

    # ---------------------------------------------------------------- clients
    def _traiter_propositions(self, corps):
        """Rend (ou retire) à un contact les propositions de créneau libéré.

        Le pendant de `_traiter_ne_plus_appeler` pour le drapeau plus doux.
        « valeur=1 » LÈVE le refus (le bouton s'appelle « Proposer de nouveau
        des créneaux ») : l'écran ne montre ce bouton que quand le refus est
        posé, et il n'y a donc qu'un sens de geste possible.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            client_id = int(donnees.get("client", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de contact invalide.")
        self.application.base.definir_plus_de_proposition(client_id, False)
        journal.info("Contact n°%d : les propositions de créneau libéré lui "
                     "sont rendues", client_id)
        return self._rediriger(f"/clients/fiche?id={client_id}&fait=1")

    def _traiter_ne_plus_appeler(self, corps):
        """Pose ou lève le drapeau « Ne plus appeler » d'un client (réversible)."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            client_id = int(donnees.get("client", [""])[0])
            valeur = int(donnees.get("valeur", [""])[0])
        except ValueError:
            return self._erreur(400, "Demande invalide.")
        base = self.application.base
        if base.obtenir_client(client_id) is None:
            return self._erreur(404, "Client introuvable.")
        base.definir_ne_plus_appeler(client_id, bool(valeur))
        if valeur:
            # Un client qu'on ne doit plus appeler sort aussi de la file
            # d'attente s'il y était déjà (annulation propre, traçée).
            for entree in list(self.application.planif.file):
                rdv = base.obtenir_rendezvous(entree["rendezvous_id"])
                if rdv and rdv["client_id"] == client_id:
                    self.application.planif.annuler(entree["appel_id"])
        self.send_response(303)
        self.send_header("Location",
                         f"/clients?marque={'stop' if valeur else 'ok'}")
        self.end_headers()

    def _lire_modification_client(self, donnees):
        """Lit et VALIDE une modification de client (nom, numéro, 🚫).

        Rend (client, propres, valeurs_tapées, erreurs) — client vaut None
        si l'identifiant est absent ou inconnu. Cette lecture est commune à
        la fiche pleine page et à la modale : une seule règle, un seul
        message d'erreur, quel que soit l'écran.
        """
        try:
            client_id = int(donnees.get("client", [""])[0])
        except ValueError:
            return None, None, None, ["Identifiant de client invalide."]
        client = self.application.base.obtenir_client(client_id)
        if client is None:
            return None, None, None, ["Client introuvable."]
        nom_brut = donnees.get("nom", [""])[0]
        telephone_brut = donnees.get("telephone", [""])[0].strip()
        exclure = donnees.get("ne_plus_appeler", [""])[0] in ("1", "on", "oui")
        erreurs, nom, telephone = [], None, None
        try:
            nom = saisie.valider_nom(nom_brut)
        except saisie.SaisieInvalide as erreur:
            erreurs.append(str(erreur))
        if telephone_brut:
            try:
                telephone = saisie.valider_telephone(telephone_brut)
            except saisie.SaisieInvalide as erreur:
                erreurs.append(str(erreur))
        valeurs = {"nom": nom_brut, "telephone": telephone_brut,
                   "ne_plus_appeler": exclure}
        propres = {"nom": nom, "telephone": telephone, "exclure": exclure}
        return client, propres, valeurs, erreurs

    def _appliquer_modification_client(self, client, propres):
        """Écrit la modification validée d'un client (et purge la file si 🚫)."""
        base = self.application.base
        base.modifier_client(client["id"], nom=propres["nom"],
                             telephone=propres["telephone"])
        if bool(client["ne_plus_appeler"]) != propres["exclure"]:
            base.definir_ne_plus_appeler(client["id"], propres["exclure"])
            if propres["exclure"]:
                # Même règle qu'ailleurs : un client qu'on ne doit plus
                # appeler sort aussi de la file d'attente s'il y était.
                for entree in list(self.application.planif.file):
                    rdv = base.obtenir_rendezvous(entree["rendezvous_id"])
                    if rdv and rdv["client_id"] == client["id"]:
                        self.application.planif.annuler(entree["appel_id"])

    def _traiter_modification_client(self, corps):
        """Enregistre la fiche d'un client depuis la fiche PLEINE PAGE.

        C'est le repli sans JavaScript : le chemin normal passe désormais par
        la modale (/clients/detail/enregistrer). Une saisie refusée n'est
        JAMAIS perdue : elle revient dans son champ avec le message qui dit
        ce qui cloche. Le champ « téléphone » laissé vide garde le numéro
        actuel — il n'est jamais réaffiché en clair.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        client, propres, valeurs, erreurs = self._lire_modification_client(donnees)
        if client is None:
            return self._erreur(400 if "invalide" in erreurs[0] else 404,
                                erreurs[0])
        if erreurs:
            # Même convention que partout : la page revient avec le message
            # et la saisie fautive dans son champ (jamais une page d'erreur).
            return self._repondre(
                self._page_fiche_client(client["id"], valeurs, erreurs))
        self._appliquer_modification_client(client, propres)
        return self._rediriger("/clients?marque=modifie")

    def _traiter_enregistrement_client(self, corps):
        """Enregistre la fiche d'un client DEPUIS LA MODALE.

        Réponse : soit la modale telle quelle avec l'erreur et la saisie
        conservée, soit — c'est enregistré — la SEULE ligne de ce client,
        que la liste remet en place sans se recharger.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        client, propres, valeurs, erreurs = self._lire_modification_client(donnees)
        if client is None:
            return self._erreur(400 if "invalide" in erreurs[0] else 404,
                                erreurs[0])
        if erreurs:
            return self._repondre_cible(
                self._modale_client(client["id"], valeurs, erreurs), "modale")
        self._appliquer_modification_client(client, propres)
        if not self._depuis_modale():
            return self._rediriger("/clients?marque=modifie")
        fiches = etats_clients.tableau_clients(self.application.base,
                                               self.application.preferences)
        fiche = next((f for f in fiches if f["client"]["id"] == client["id"]),
                     None)
        if fiche is None:                      # supprimé entre-temps
            return self._repondre_cible("", f"client-{client['id']}")
        return self._repondre_cible(self._cellules_client(fiche),
                                    f"client-{client['id']}")

    def _traiter_enregistrement_rendezvous(self, corps):
        """Enregistre un rendez-vous MODIFIÉ DANS LA MODALE du planning.

        Motif, date et heure, durée, statut. La règle de place est celle du
        déplacement, à la lettre : un rendez-vous de N tranches ne peut pas
        aller là où il n'y a pas N tranches libres d'affilée — et elle n'est
        vérifiée que si la place CHANGE (modifier le seul motif d'un
        rendez-vous déjà posé ne peut donc pas être refusé). Réponse : soit
        la modale avec l'erreur et la saisie conservée, soit le planning
        seul, remis en place sur la même semaine.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        base = self.application.base
        preferences = self.application.preferences
        pas = horaires.pas_minutes(preferences)
        try:
            rdv_id = int(donnees.get("rdv", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de rendez-vous invalide.")
        rdv = base.obtenir_rendezvous(rdv_id)
        if rdv is None:
            return self._erreur(404, "Rendez-vous introuvable.")
        motif_brut = donnees.get("motif", [""])[0]
        horaire_brut = donnees.get("horaire", [""])[0].strip()
        duree_brut = donnees.get("duree", [""])[0].strip()
        statut = donnees.get("statut", [""])[0].strip()
        erreurs, motif, horaire = [], None, None
        tranches = horaires.duree_tranches(rdv)
        try:
            motif = saisie.valider_motif(motif_brut)
        except saisie.SaisieInvalide as erreur:
            erreurs.append(str(erreur))
        try:
            horaire = saisie.valider_horaire(horaire_brut)
        except saisie.SaisieInvalide as erreur:
            erreurs.append(str(erreur))
        if (not duree_brut.isdigit() or int(duree_brut) < pas
                or int(duree_brut) % pas):
            erreurs.append(f"Durée refusée : « {duree_brut} » — attendu un "
                           f"nombre de minutes multiple de {pas} (la durée "
                           f"moyenne d'un rendez-vous), par exemple {pas}, "
                           f"{2 * pas} ou {3 * pas}.")
        else:
            tranches = int(duree_brut) // pas
        if statut not in STATUTS_MODIFIABLES and statut != rdv["statut"]:
            erreurs.append(f"Statut refusé : « {statut} » — choisissez-en un "
                           "dans la liste ("
                           + ", ".join(STATUTS_MODIFIABLES) + ").")
        if not erreurs and statut in STATUTS_RETRAIT:
            # LA RÈGLE, tenue côté serveur aussi : « annulé » pour une date
            # passée, « supprimé » pour une date à venir. Ce que le
            # formulaire a envoyé ne peut pas la contourner.
            statut = horaires.decision_annulation(
                preferences, horaire or rdv["horaire"])["statut"]
        if not erreurs and statut in STATUTS_OCCUPANTS:
            bouge = (horaire != rdv["horaire"]
                     or tranches != horaires.duree_tranches(rdv)
                     or rdv["statut"] not in STATUTS_OCCUPANTS)
            if bouge:
                refus = horaires.refus_deplacement(
                    base, preferences,
                    {"id": rdv["id"], "duree_tranches": tranches}, horaire)
                if refus:
                    erreurs.append(refus)
        parametres = {"rdv": [str(rdv_id)],
                      "annee": donnees.get("annee", [""]),
                      "semaine": donnees.get("semaine", [""])}
        if erreurs:
            valeurs = {"motif": motif_brut, "horaire": horaire_brut,
                       "duree": duree_brut, "statut": statut}
            return self._repondre_cible(
                self._modale_planning(parametres, valeurs, erreurs), "modale")
        base.mettre_a_jour_rendezvous(rdv_id, statut=statut, horaire=horaire,
                                      duree_tranches=tranches, motif=motif)
        journal.info("Rendez-vous n°%d modifié en modale (statut %s, %s)",
                     rdv_id, statut, horaire)
        if not self._depuis_modale():
            return self._rediriger(f"/rendezvous?id={rdv_id}&enregistre=ok")
        return self._repondre_cible(self._zone_planning(parametres), "planning")

    def _traiter_rappel_humain(self, corps):
        """Marque « c'est fait » (ou le défait) sur un rappel par un humain."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            contact_id = int(donnees.get("contact", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de contact invalide.")
        traite = donnees.get("valeur", ["1"])[0] not in ("0", "non")
        if not self.application.base.marquer_contact_traite(contact_id, traite):
            return self._erreur(404, "Contact introuvable.")
        vue = _vue_relances(donnees.get("vue", [""])[0])
        return self._rediriger(
            f"/relances?vue={vue}&fait={'traite' if traite else 'repris'}")

    def _traiter_suppression_client(self, corps):
        """Supprime le client ET ses rendez-vous — APRÈS la page de confirmation.

        Le POST ne part que du bouton « Supprimer définitivement » de la
        page de confirmation (champ « confirmer » posé par elle) : jamais
        de suppression en un clic.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            client_id = int(donnees.get("client", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de client invalide.")
        if donnees.get("confirmer", [""])[0] != "oui":
            return self._erreur(400, "Suppression non confirmée : passez par "
                                     "la page de confirmation.")
        base = self.application.base
        if base.obtenir_client(client_id) is None:
            return self._erreur(404, "Client introuvable.")
        # La file d'attente est purgée d'abord : plus rien à composer pour lui.
        self.application.planif.purger_rendezvous(base.rendezvous_du_client(client_id))
        # Puis les relances encore armées sont DÉSARMÉES (le compte est
        # affiché) ; les contacts et les appels déjà passés, eux, restent.
        desarmees = base.desarmer_contacts_du_client(client_id)
        supprimes = base.supprimer_client(client_id)
        self.send_response(303)
        self.send_header(
            "Location", f"/clients?supprime={supprimes}&desarmees={desarmees}")
        self.end_headers()

    # --------------------------------------------------------------- réglages
    def _traiter_reglages(self, corps):
        """La page ⚙ Réglages enregistre, puis revient sur elle-même."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"),
                                        keep_blank_values=True)
        erreurs = self._appliquer_reglages(donnees)
        if erreurs:
            return self._repondre(self._page_reglages(erreurs=erreurs))
        self.send_response(303)
        self.send_header("Location", "/reglages?fait=1")
        self.end_headers()

    def _appliquer_reglages(self, donnees):
        """Écrit les réglages reçus ; rend la liste des refus (vide = fait).

        Séparé de la réponse HTTP à dessein : l'installeur du premier
        lancement fait remplir EXACTEMENT ces formulaires, et doit donc
        écrire par le même chemin — sinon les deux écrans finiraient par ne
        plus valider la même chose.

        keep_blank_values, chez l'appelant : un champ VIDÉ à l'écran doit
        pouvoir EFFACER le réglage. Sans cela, la période interdite, une
        fois posée, ne pouvait plus être retirée depuis la page — le
        formulaire disait le contraire de ce qu'il faisait.
        """
        # ⚠ ABSENT ≠ VIDE. Depuis que les réglages sont découpés en
        # sous-parties (02/08/2026), chaque sous-formulaire n'envoie QUE ses
        # champs. Un champ absent laisse donc son réglage intact ; un champ
        # présent et vide, lui, efface — c'est le droit d'effacer, qui doit
        # rester. Sans cette distinction, enregistrer les relances effacerait
        # le nom de l'entreprise et ferait échouer la validation de la plage
        # horaire (« heure de début illisible » sur un formulaire qui ne la
        # contient même pas).
        entreprise = donnees.get("entreprise", [None])[0]
        if entreprise is not None:
            entreprise = " ".join(entreprise.split())
        debut = donnees.get("plage_debut", [None])[0]
        fin = donnees.get("plage_fin", [None])[0]
        relance_delai = donnees.get("relance_delai", [""])[0].strip()
        relance_max = donnees.get("relance_max", [""])[0].strip()
        erreurs = []
        plage_envoyee = debut is not None and fin is not None
        if plage_envoyee:
            debut, fin = debut.strip(), fin.strip()
            for libelle, valeur in (("début", debut), ("fin", fin)):
                if (not re.fullmatch(r"[0-2]\d:[0-5]\d", valeur)
                        or valeur > "23:59"):
                    erreurs.append(f"Plage horaire : heure de {libelle} "
                                   f"illisible (« {valeur} », attendu HH:MM).")
            if not erreurs and debut >= fin:
                erreurs.append("Plage horaire : l'heure de début doit précéder "
                               "l'heure de fin.")
        # Les champs relance sont optionnels (compatibilité) : vides = inchangés.
        delai_valide = maximum_valide = None
        if relance_delai:
            if relance_delai.isdigit() and 0 <= int(relance_delai) <= 168:
                delai_valide = int(relance_delai)
            else:
                erreurs.append("Relances : le délai par défaut doit être un "
                               "nombre d'heures ouvrées entre 0 et 168 "
                               f"(reçu « {relance_delai} »).")
        if relance_max:
            if relance_max.isdigit() and 0 <= int(relance_max) <= 9:
                maximum_valide = int(relance_max)
            else:
                erreurs.append("Relances : le maximum de tentatives doit être "
                               f"entre 0 et 9 (reçu « {relance_max} »).")
        # Période interdite (optionnelle — les deux bornes, ou aucune) et
        # relance par défaut (délai OU créneau de rappel). Un champ absent du
        # formulaire (anciens tests, autres écrans) laisse le réglage intact.
        interdit_debut = donnees.get("interdit_debut", [None])[0]
        interdit_fin = donnees.get("interdit_fin", [None])[0]
        interdit_a_ecrire = None
        if interdit_debut is not None or interdit_fin is not None:
            interdit_debut = (interdit_debut or "").strip()
            interdit_fin = (interdit_fin or "").strip()
            if bool(interdit_debut) != bool(interdit_fin):
                erreurs.append("Période interdite : donnez les DEUX bornes "
                               "(début et fin), ou laissez les deux vides.")
            elif interdit_debut and not all(
                    re.fullmatch(r"[0-2]\d:[0-5]\d", borne)
                    for borne in (interdit_debut, interdit_fin)):
                erreurs.append("Période interdite : heures illisibles "
                               "(attendu HH:MM, ex. 20:00 → 08:00).")
            else:
                interdit_a_ecrire = (interdit_debut, interdit_fin)
        # ⏱ LES DÉLAIS D'UN VRAI APPEL. Absents du formulaire (anciens
        # écrans, essais) : les réglages restent intacts. Ils ne touchent QUE
        # les appels réels — la simulation garde ses délais courts.
        delais_a_ecrire = {}
        for cle in calle_client.BORNES_DELAIS:
            brut = donnees.get(cle, [None])[0]
            if brut is None:
                continue
            try:
                delais_a_ecrire[cle] = calle_client.valider_delai(cle, brut)
            except ValueError as erreur:
                erreurs.append(f"⏱ {erreur}")
        # Le seuil de remplacement (12 h par défaut) : absent du formulaire
        # (anciens écrans, essais), le réglage reste intact.
        seuil_brut = donnees.get("seuil_remplacement", [None])[0]
        seuil_valide = None
        if seuil_brut is not None:
            try:
                seuil_valide = horaires.valider_seuil_remplacement(seuil_brut)
            except ValueError as erreur:
                erreurs.append(str(erreur))
        # Le 🧪 numéro d'essai (optionnel). Absent du formulaire (anciens
        # écrans, essais) : le réglage reste intact. Présent mais VIDE : il
        # est effacé, et la règle stricte du doublon revient pour tout le
        # monde — c'est ce que promet le libellé du champ.
        # Le champ affiche le numéro MASQUÉ (règle de masquage, sans
        # exception) : s'il contient encore des « • », c'est qu'il n'a pas
        # été retouché — on n'y touche pas non plus. Même convention que la
        # colonne Téléphone de la grille (assistant_web).
        numero_brut = donnees.get("numero_essai", [None])[0]
        numero_a_ecrire = None
        if numero_brut is not None and "•" not in numero_brut:
            try:
                numero_a_ecrire = essai_reel.valider_numero(numero_brut)
            except saisie.SaisieInvalide as erreur:
                erreurs.append(f"🧪 Numéro d'essai : {erreur}")
        mode_relance = donnees.get("relance_mode", [None])[0]
        if mode_relance is not None and mode_relance not in ("delai", "creneau"):
            mode_relance = None
        creneau_debut = donnees.get("relance_creneau_debut", [None])[0]
        creneau_fin = donnees.get("relance_creneau_fin", [None])[0]
        creneau_a_ecrire = None
        if creneau_debut is not None or creneau_fin is not None:
            creneau_debut = (creneau_debut or "").strip()
            creneau_fin = (creneau_fin or "").strip()
            if creneau_debut and creneau_fin and creneau_debut >= creneau_fin:
                erreurs.append("Créneau de rappel : l'heure de début doit "
                               "précéder l'heure de fin (ex. 12:00 → 14:00).")
            elif mode_relance == "creneau" and not (creneau_debut
                                                    and creneau_fin):
                erreurs.append("Créneau de rappel : donnez le début ET la fin "
                               "pour choisir le mode « créneau de rappel ».")
            else:
                creneau_a_ecrire = (creneau_debut, creneau_fin)
        if erreurs:
            return erreurs
        preferences = self.application.preferences
        if entreprise is not None:
            preferences.definir(themes.CLE_ENTREPRISE, entreprise)
        if plage_envoyee:
            preferences.definir(themes.CLE_PLAGE_DEBUT, debut)
            preferences.definir(themes.CLE_PLAGE_FIN, fin)
        if delai_valide is not None:
            preferences.definir(campagnes.CLE_RELANCE_DELAI, delai_valide)
        if maximum_valide is not None:
            preferences.definir(campagnes.CLE_RELANCE_MAX, maximum_valide)
        if seuil_valide is not None:
            preferences.definir(horaires.CLE_SEUIL_REMPLACEMENT, seuil_valide)
        if delais_a_ecrire:
            for cle, valeur in delais_a_ecrire.items():
                preferences.definir(cle, valeur)
            # Le client d'appels DÉJÀ construit prend les nouveaux délais tout
            # de suite : sans cela, l'écran afficherait un réglage que le
            # produit n'appliquerait qu'au prochain démarrage.
            client = getattr(self.application.planif, "client_appels", None)
            if hasattr(client, "appliquer_delais"):
                client.appliquer_delais(
                    **calle_client.delais_regles(preferences))
        if interdit_a_ecrire is not None:
            preferences.definir(assistant.CLE_INTERDIT_DEBUT,
                                interdit_a_ecrire[0])
            preferences.definir(assistant.CLE_INTERDIT_FIN,
                                interdit_a_ecrire[1])
        if mode_relance is not None:
            preferences.definir(assistant.CLE_RELANCE_MODE, mode_relance)
        if creneau_a_ecrire is not None:
            preferences.definir(assistant.CLE_RELANCE_CRENEAU_DEBUT,
                                creneau_a_ecrire[0])
            preferences.definir(assistant.CLE_RELANCE_CRENEAU_FIN,
                                creneau_a_ecrire[1])
        if numero_a_ecrire is not None:
            # Le champ à numéro unique désigne le PREMIER testeur : un numéro
            # le remplace (son nom est gardé), un champ vidé le retire. Les
            # autres testeurs, s'il y en a, ne bougent pas — c'est la liste
            # (⚙ Réglages → 🧪 Testeurs) qui les gère un par un.
            liste = essai_reel.testeurs(preferences)
            if numero_a_ecrire:
                if liste:
                    liste[0] = {"nom": liste[0]["nom"],
                                "telephone": numero_a_ecrire}
                else:
                    liste = [{"nom": essai_reel.NOM_PREMIER_TESTEUR,
                              "telephone": numero_a_ecrire}]
            elif liste:
                liste = liste[1:]
            essai_reel.enregistrer_testeurs(preferences, liste)
            # La base marque 🧪 les lignes de ces numéros : elle doit connaître
            # le nouveau réglage TOUT DE SUITE, sans redémarrer le serveur.
            self.application.base.definir_numeros_essai(
                essai_reel.numeros_declares(preferences))
            journal.info("Numéro d'essai %s",
                         "déclaré" if numero_a_ecrire else "retiré "
                         "(règle stricte du doublon rétablie pour tous)")
        return []

    def _traiter_creneau_ajouter(self, corps):
        """Ajoute un créneau disponible (proposé par les thèmes ② ③ ④)."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            creneau = saisie.valider_horaire(donnees.get("creneau", [""])[0])
        except saisie.SaisieInvalide as erreur:
            return self._repondre(self._page_reglages(erreurs=[str(erreur)]))
        preferences = self.application.preferences
        creneaux = list(preferences.obtenir(themes.CLE_CRENEAUX) or [])
        if creneau not in creneaux:
            creneaux.append(creneau)
            creneaux.sort()
            preferences.definir(themes.CLE_CRENEAUX, creneaux)
        self.send_response(303)
        self.send_header("Location", "/reglages?fait=1")
        self.end_headers()

    def _traiter_creneau_retirer(self, corps):
        """Retire un créneau de la liste des disponibilités."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        creneau = donnees.get("creneau", [""])[0]
        preferences = self.application.preferences
        creneaux = [c for c in (preferences.obtenir(themes.CLE_CRENEAUX) or [])
                    if c != creneau]
        preferences.definir(themes.CLE_CRENEAUX, creneaux)
        self.send_response(303)
        self.send_header("Location", "/reglages?fait=1")
        self.end_headers()

    # --------------------------------------------- horaires d'ouverture
    def _traiter_pas(self, corps):
        """Enregistre la durée moyenne d'un rendez-vous (le PAS des tranches).

        Deux chemins, un seul traitement — comme pour la semaine type :
        « fragment=1 » renvoie le BLOC des horaires, redessiné avec le
        nouveau pas (et son refus s'affiche dedans) ; sans lui, on revient
        sur la page des réglages. C'est ce qui permet à l'installeur de
        régler le pas sans que sa fenêtre se fasse remplacer par une page.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        fragment = donnees.get("fragment", [""])[0] == "1"
        try:
            pas = horaires.valider_pas(donnees.get("pas", [""])[0])
        except ValueError as erreur:
            if fragment:
                return self._repondre_fragment(
                    self._bloc_horaires(erreurs=[str(erreur)]))
            return self._repondre(self._page_reglages(erreurs=[str(erreur)]))
        self.application.preferences.definir(horaires.CLE_PAS, pas)
        if fragment:
            return self._repondre_fragment(self._bloc_horaires())
        return self._rediriger("/reglages?fait=1#horaires")

    def _traiter_semaine(self, corps):
        """Ouvre, ferme ou BASCULE une période de la semaine type.

        Deux chemins, un seul traitement :
        - le glisser-relâché envoie « fragment=1 » et reçoit le calendrier
          remis à jour — seul CET élément se recharge, jamais la page ;
        - le repli sans JavaScript (jour + heure de début + heure de fin +
          bouton « Ouvrir » ou « Fermer ») revient sur la page des réglages.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        fragment = donnees.get("fragment", [""])[0] == "1"
        geste = donnees.get("geste", ["basculer"])[0]
        erreurs, jour, bornes = [], None, []
        try:
            jour = int(donnees.get("jour", [""])[0])
            if jour not in range(7):
                raise ValueError
        except ValueError:
            jour = None
            erreurs.append("Jour illisible : choisissez un jour de la semaine "
                           "(lundi à dimanche).")
        for nom in ("debut", "fin"):
            brut_minutes = donnees.get(nom + "_min", [""])[0]
            brut_heure = donnees.get(nom, [""])[0]
            try:
                if brut_minutes:
                    bornes.append(int(brut_minutes))
                else:
                    bornes.append(horaires.minutes_depuis_hhmm(brut_heure))
            except ValueError as erreur:
                erreurs.append(f"Heure de {nom} : {erreur}")
        if not erreurs:
            try:
                horaires.basculer_periode(self.application.preferences, jour,
                                          bornes[0], bornes[1], geste)
            except ValueError as erreur:
                erreurs.append(str(erreur))
        if fragment:
            # Le geste a été fait à la souris : on renvoie l'élément, pas la
            # page — et l'erreur éventuelle s'affiche DANS cet élément.
            return self._repondre_fragment(self._calendrier_semaine(erreurs))
        if erreurs:
            return self._repondre(self._page_reglages(erreurs=erreurs))
        return self._rediriger("/reglages?fait=1#horaires")

    def _traiter_jour_ferme(self, corps):
        """Déclare ou retire un jour fermé exceptionnel (geste de l'utilisateur).

        Les jours fériés proposés à l'écran passent par ICI : RingBack ne
        les ajoute jamais tout seul, c'est toujours un clic humain.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        preferences = self.application.preferences
        fragment = donnees.get("fragment", [""])[0] == "1"
        action = donnees.get("action", ["ajouter"])[0]
        date = donnees.get("date", [""])[0]
        if action == "retirer":
            horaires.retirer_jour_ferme(preferences, date.strip())
            if fragment:
                return self._repondre_fragment(self._bloc_jours_fermes())
            return self._rediriger("/reglages?fait=1#jours-fermes")
        refus = None
        try:
            horaires.ajouter_jour_ferme(preferences, date,
                                        donnees.get("libelle", [""])[0])
        except ValueError as erreur:
            refus = str(erreur)
        if fragment:
            return self._repondre_fragment(
                self._bloc_jours_fermes(erreurs=[refus] if refus else None))
        if refus:
            return self._repondre(self._page_reglages(erreurs=[refus]))
        return self._rediriger("/reglages?fait=1#jours-fermes")

    # ------------------------------------------ durée, déplacement, annulation
    def _traiter_duree_rendezvous(self, corps):
        """Change la durée d'un rendez-vous (en minutes, multiple du pas)."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        base = self.application.base
        preferences = self.application.preferences
        try:
            rdv_id = int(donnees.get("rdv", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de rendez-vous invalide.")
        if base.obtenir_rendezvous(rdv_id) is None:
            return self._erreur(404, "Rendez-vous introuvable.")
        pas = horaires.pas_minutes(preferences)
        brut = donnees.get("duree", [""])[0].strip()
        if not brut.isdigit() or int(brut) < pas or int(brut) % pas:
            return self._repondre(self._page_fiche(
                rdv_id, erreurs=[
                    f"Durée refusée : « {brut} » — attendu un nombre de "
                    f"minutes multiple de {pas} (la durée moyenne d'un "
                    f"rendez-vous), par exemple {pas}, {2 * pas} ou "
                    f"{3 * pas}."],
                duree_saisie=brut))
        base.mettre_a_jour_rendezvous(rdv_id, duree_tranches=int(brut) // pas)
        return self._rediriger(f"/rendezvous?id={rdv_id}&duree=ok")

    def _traiter_deplacement(self, corps):
        """Déplace un rendez-vous — REFUS EXPLICITE s'il n'y tient pas.

        La règle, à la lettre : un rendez-vous de N tranches ne peut pas
        être replacé là où il y a moins de N tranches libres consécutives.
        Le refus dit ce qui manque, et la saisie n'est pas perdue.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        base = self.application.base
        preferences = self.application.preferences
        try:
            rdv_id = int(donnees.get("rdv", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de rendez-vous invalide.")
        rdv = base.obtenir_rendezvous(rdv_id)
        if rdv is None:
            return self._erreur(404, "Rendez-vous introuvable.")
        brut = (donnees.get("cible", [""])[0] or "").strip()
        if not brut:
            return self._repondre(self._page_fiche(
                rdv_id, erreurs=["Choisissez d'abord un créneau d'arrivée "
                                 "(liste déroulante) ou tapez une date et une "
                                 "heure (format 2026-08-03T09:00)."]))
        try:
            cible = saisie.valider_horaire(brut)
        except saisie.SaisieInvalide as erreur:
            return self._repondre(self._page_fiche(rdv_id, erreurs=[str(erreur)],
                                                   cible_saisie=brut))
        refus = horaires.refus_deplacement(base, preferences, rdv, cible)
        if refus:
            journal.info("Déplacement refusé (rendez-vous n°%d) : %s",
                         rdv_id, refus)
            return self._repondre(self._page_fiche(rdv_id, erreurs=[refus],
                                                   cible_saisie=brut))
        base.mettre_a_jour_rendezvous(rdv_id, horaire=cible, statut="prévu")
        journal.info("Rendez-vous n°%d déplacé au %s", rdv_id, cible)
        return self._rediriger(f"/rendezvous?id={rdv_id}&deplace=ok")

    def _traiter_annulation_rendezvous(self, corps):
        """Retire un rendez-vous : ses N tranches redeviennent libres.

        LA RÈGLE DU PROPRIÉTAIRE, ici comme partout : un rendez-vous DÉJÀ
        PASSÉ reste « annulé » (le statut d'histoire) ; un rendez-vous à
        venir est SUPPRIMÉ — il n'apparaît plus nulle part et sa place est
        rendue. C'est horaires.decision_annulation qui tranche, pas ce
        code-ci : une seule règle, un seul endroit.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        base = self.application.base
        try:
            rdv_id = int(donnees.get("rdv", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de rendez-vous invalide.")
        rdv = base.obtenir_rendezvous(rdv_id)
        if rdv is None:
            return self._erreur(404, "Rendez-vous introuvable.")
        decision = horaires.decision_annulation(self.application.preferences,
                                                rdv["horaire"])
        base.mettre_a_jour_rendezvous(rdv_id, statut=decision["statut"])
        pas = horaires.pas_minutes(self.application.preferences)
        journal.info("Rendez-vous n°%d passé « %s » : %s libérée(s) — %s",
                     rdv_id, decision["statut"],
                     horaires.tranches_lisibles(rdv["duree_tranches"], pas),
                     decision["pourquoi"])
        return self._rediriger(f"/rendezvous?id={rdv_id}&annule=ok")

    # ------------------------------------------------------------------- pages
    def _page_campagnes(self, parametres=None):
        """L'accueil : les campagnes en cours et passées, et le gros bouton.

        Une campagne = un thème de travail + la liste de l'instant + les
        appels rattachés. L'avancement montre appelés / aboutis / relances.

        C'est aussi l'écran qui ouvre l'INSTALLEUR au premier lancement (ou
        sur demande, avec « ?installation=1 ») : l'accueil est le seul
        endroit où l'on arrive forcément, et l'installeur doit s'imposer là
        plutôt que sur une page où l'on est venu faire autre chose.
        """
        parametres = parametres or {}
        base = self.application.base
        efface = parametres.get("efface", [""])[0]
        bloc_efface = ""
        if efface.isdigit() and efface != "0":
            contacts = parametres.get("contacts", ["0"])[0]
            contacts = contacts if contacts.isdigit() else "0"
            bloc_efface = (
                f'<p class="pastille">Liste effacée : {efface} campagne(s) et '
                f"{contacts} personne(s) de leurs listes. Vos clients et vos "
                "rendez-vous sont intacts.</p>")
        dues = len(base.relances_dues())
        bandeau_dues = ""
        if dues:
            bandeau_dues = (f'<p class="bandeau">🔁 {dues} relance(s) due(s) — '
                            '<a href="/relances">les lancer depuis la page '
                            "Relances</a> (geste manuel, jamais automatique).</p>")
        def _ligne(campagne):
            classe = CLASSES_STATUT_CAMPAGNE.get(campagne["statut"], "")
            if campagne.get("nature"):
                # Les natures retirées comprises : la liste des campagnes ne
                # doit jamais afficher une ligne anonyme.
                nature = assistant.fiche_nature(campagne["nature"]) or {}
                theme = (f"{nature.get('icone', '')} "
                         f"{nature.get('nom', campagne['nature'])}").strip()
                contacts = base.contacts_de_campagne(campagne["id"])
                acceptes = sum(1 for c in contacts if c["etat"] == "accepté")
                appeles = sum(1 for c in contacts
                              if c["etat"] not in ("à appeler", "en cours",
                                                   "épargné", "exclu"))
                avancement = (f"{appeles}/{len(contacts)} appelé(s) · "
                              f"{acceptes} accepté(s) · "
                              f"{campagne['relances']} relance(s)")
            else:
                theme = campagnes.libelle_theme(campagne["theme"])
                avancement = (f"{campagne['appeles']}/{campagne['contacts']} "
                              f"appelé(s) · {campagne['aboutis']} abouti(s) · "
                              f"{campagne['relances']} relance(s)")
            return f"""<tr>
  <td><a href="/campagne?id={campagne['id']}">{html.escape(campagne['nom'])}</a></td>
  <td>{html.escape(theme)}</td>
  <td><span class="pastille {classe}">{html.escape(campagne['statut'])}</span></td>
  <td>{html.escape(avancement)}</td>
</tr>"""

        sections = []
        # ⚠ SA DEMANDE DU 21/08/2026 : « sur la page d'accueil il faut afficher
        # simplement un texte (N campagnes déjà envoyées) et lorsqu'on clique
        # dessus on affiche la liste, donc c'est caché par défaut ».
        #
        # Mesuré dans sa base : 113 campagnes passées, et RIEN d'autre à
        # l'écran. Ce qu'il vient de préparer ou de lancer — ce sur quoi il
        # travaille — était noyé sous cent treize lignes d'archives.
        #
        # Les deux premiers groupes restent DÉPLIÉS : « en cours » et « prêtes »
        # sont son travail du moment, les replier reviendrait à les cacher.
        ayant_appele = base.campagnes_ayant_appele()
        for code, titre, liste in self._groupes_campagnes():
            if not liste:
                continue
            # ⚠ « Effacer la liste » DÉTRUIT DE L'HISTORIQUE : c'est le seul
            # geste du produit dans ce cas. Il passe donc par une fenêtre de
            # confirmation qui compte d'abord ce qui partirait — et le lien
            # reste un vrai lien, qui mène à la même confirmation en page
            # entière si le JavaScript ne répond pas.
            adresse = f"/campagnes/effacer?groupe={code}"
            effacer = (f'<a class="bouton secondaire" href="{adresse}" '
                       f'data-modale="{adresse}">Effacer la liste</a>')
            tableau = self._tableau_campagnes(_ligne, liste)
            if code == "terminees":
                # ⚠ LES CINQ DERNIÈRES SE LISENT D'EMBLÉE (21/08/2026, sa
                # demande). Tout replier avait un défaut : la page ne montrait
                # plus RIEN de ce qui vient de se passer. Ce qu'il veut voir en
                # arrivant, c'est le travail récent ; ce qu'il veut ranger,
                # c'est l'archive.
                apercu = liste[:self.APERCU_PASSEES]
                entete = (f'<div class="entete-liste">'
                          f'<h2>{html.escape(titre)} ({len(liste)})</h2></div>')
                if len(liste) <= self.APERCU_PASSEES:
                    # ⚠ PAS DE DÉPLIANT QUAND IL N'Y A RIEN À REPLIER : un
                    # bouton qui ouvre ce qu'on voit déjà est un faux geste.
                    sections.append(entete + effacer + tableau)
                    continue
                sections.append(
                    entete
                    + f'<p class="mini">Les {len(apercu)} plus récentes :</p>'
                    + self._tableau_campagnes(_ligne, apercu)
                    + '<details class="carte campagnes-passees">'
                    + f"<summary>{self._resume_campagnes_passees(liste, ayant_appele)}"
                    + "</summary>"
                    + f'<p class="entete-liste">{effacer}</p>{tableau}</details>')
                continue
            sections.append(
                f'<div class="entete-liste"><h2>{html.escape(titre)} '
                f'({len(liste)})</h2>{effacer}</div>{tableau}')
        if sections:
            tableau = "\n".join(sections)
        else:
            tableau = ("<p>Aucune campagne pour l'instant. Une campagne, c'est "
                       "une <strong>nature d'appel</strong> (créneau libéré, "
                       "rappel, confirmation, contact unique…) appliquée à une "
                       "<strong>liste importée à l'instant</strong> "
                       "— créez la première !</p>")
        corps = f"""{self._bandeau()}
{bandeau_dues}
<h1>📣 Campagnes</h1>
{bloc_efface}
<p><a class="bouton" style="font-size:1.15rem;padding:.7rem 1.4rem"
      href="/assistant">➕ Nouvelle campagne</a>
   <small class="sourd">(assistant en 3 étapes : nature → message → personnes)</small></p>
{tableau}
<p><small>Tout appel non abouti (pas de réponse, échec, déplacement non
conclu…) programme une <a href="/relances">🔁 relance</a> qui conserve le
thème et les paramètres de sa campagne. Aucune relance ne part seule :
c'est toujours un geste humain.</small></p>
{self._bloc_installeur(parametres)}"""
        return self._page("Campagnes", corps, actif="campagnes")

    # Les trois listes de la page 📣 Campagnes, avec leur code d'adresse.
    # ⚠ UN SEUL ENDROIT : la page les affiche et « Effacer la liste » les
    # relit. Deux découpages auraient fini par ne plus désigner les mêmes
    # campagnes, et le bouton aurait effacé autre chose que ce qui est écrit
    # au-dessus de lui.
    GROUPES_CAMPAGNES = (
        ("en-cours", "En cours", ("en cours", "en pause")),
        ("pretes", "Prêtes — personne n'est appelé avant ▶ Démarrer",
         ("prête",)),
        ("terminees", "Terminées", None),      # None = tout le reste
    )

    # Combien de campagnes passées se lisent SANS déplier. Cinq : assez pour
    # voir ce qui vient de se passer, assez peu pour que la page reste courte.
    APERCU_PASSEES = 5

    @staticmethod
    def _tableau_campagnes(ligne_de, liste):
        """Le tableau des campagnes — un seul endroit, deux emplois : l'aperçu
        des cinq dernières et la liste complète du dépliant."""
        return ("<table><tr><th>Campagne</th><th>Nature / thème</th>"
                "<th>Statut</th><th>Avancement</th></tr>"
                + "\n".join(ligne_de(campagne) for campagne in liste)
                + "</table>")

    @staticmethod
    def _resume_campagnes_passees(liste, ayant_appele):
        """« N campagnes déjà envoyées » — et ce qui n'a PAS été envoyé.

        ⚠ LE MOT « ENVOYÉE » DOIT RESTER VRAI. Une campagne close sans avoir
        appelé n'a rien envoyé du tout : la compter avec les autres aurait
        gonflé un chiffre qu'il lit comme un travail fait. Sa base en portait
        sept le jour de la demande.
        """
        envoyees = sum(1 for c in liste if c["id"] in ayant_appele)
        muettes = len(liste) - envoyees
        morceaux = []
        if envoyees:
            morceaux.append(f"<strong>{envoyees} campagne(s) déjà "
                            "envoyée(s)</strong>")
        if muettes:
            morceaux.append(f"{muettes} close(s) sans avoir appelé")
        return "📤 " + " — ".join(morceaux) if morceaux else "📤 Campagnes passées"

    def _groupes_campagnes(self):
        """[(code, titre, [campagnes])] — les trois listes, dans l'ordre."""
        toutes = self.application.base.lister_campagnes()
        nommes = {statut for _, _, statuts in self.GROUPES_CAMPAGNES
                  if statuts for statut in statuts}
        groupes = []
        for code, titre, statuts in self.GROUPES_CAMPAGNES:
            if statuts is None:
                liste = [c for c in toutes if c["statut"] not in nommes]
            else:
                liste = [c for c in toutes if c["statut"] in statuts]
            groupes.append((code, titre, liste))
        return groupes

    def _groupe_campagnes(self, code):
        """(titre, [campagnes]) pour ce code, ou (None, []) s'il est inconnu."""
        for existant, titre, liste in self._groupes_campagnes():
            if existant == code:
                return titre, liste
        return None, []

    def _campagnes_qui_tournent(self, liste):
        """Celles dont un fil d'exécution tourne EN CE MOMENT.

        Effacer une campagne pendant qu'elle appelle retirerait les lignes
        sous son propre fil. On refuse, et on dit laquelle.
        """
        with self.application._verrou_executions:
            en_vol = set(self.application.executions)
        return [c for c in liste if c["id"] in en_vol]

    def _modale_effacer_liste(self, code, erreur=""):
        """La confirmation : ce qui partirait, compté avant d'effacer."""
        titre, liste = self._groupe_campagnes(code)
        if titre is None:
            return self._modale("Liste introuvable",
                                "<p>Cette liste de campagnes n'existe pas.</p>")
        if not liste:
            return self._modale(f"Effacer « {html.escape(titre)} »",
                                "<p>Cette liste est déjà vide.</p>")
        releve = self.application.base.compter_avant_suppression_campagnes(
            [c["id"] for c in liste])
        tournent = self._campagnes_qui_tournent(liste)
        bloc_erreur = ""
        if erreur:
            bloc_erreur = ('<div class="erreurs"><strong>Refusé :</strong>'
                           f"<p>{html.escape(erreur)}</p></div>")
        if tournent:
            noms = ", ".join(html.escape(c["nom"]) for c in tournent)
            return self._modale(
                f"Effacer « {html.escape(titre)} »",
                f"{bloc_erreur}<div class=\"erreurs\"><p><strong>Impossible "
                f"pour l'instant.</strong> {len(tournent)} campagne(s) de "
                f"cette liste appellent en ce moment : {noms}. Mettez-les en "
                "pause ou arrêtez-les d'abord — un appel déjà lancé va "
                "toujours à son terme, et effacer une campagne en vol "
                "retirerait les lignes sous son propre fil.</p></div>")
        attente = ""
        if releve["appels_en_attente"]:
            attente = (
                f'<div class="erreurs"><p>⚠ <strong>'
                f'{releve["appels_en_attente"]} appel(s) sont PARTIS chez '
                "CALL-E et leur résultat n'est pas encore lu.</strong> "
                "L'identifiant qui permet de le retrouver ne vit que sur le "
                "contact : l'effacer, c'est perdre le résultat d'une vraie "
                "conversation. Utilisez d'abord « 📥 Récupérer les résultats "
                "en attente » sur la fiche de ces campagnes.</p></div>")
        return self._modale(f"Effacer « {html.escape(titre)} »", f"""{bloc_erreur}
<p>Cela efface <strong>{releve["campagnes"]} campagne(s)</strong> et tout ce
qui n'existe que par elles :</p>
<ul>
  <li>{releve["contacts"]} personne(s) dans leurs listes</li>
  <li>{releve["appels"]} appel(s) enregistré(s), avec leurs transcriptions</li>
  <li>{releve["relances"]} relance(s), dont
      <strong>{releve["relances_planifiees"]} encore programmée(s)</strong></li>
  <li>{releve["changements"]} ligne(s) du cahier de changements</li>
</ul>
{attente}
<p><strong>Vos clients et vos rendez-vous ne sont pas touchés.</strong> Un
rendez-vous déplacé reste déplacé, une place libérée reste libre : c'est la
TRACE du travail qui part, jamais son résultat dans votre agenda.</p>
<p><small>Ce geste ne se défait pas.</small></p>
<form method="post" action="/campagnes/effacer">
  <input type="hidden" name="groupe" value="{html.escape(code)}">
  <button class="danger">Effacer ces {releve["campagnes"]} campagne(s)</button>
  <button type="button" class="secondaire modale-fermer">Annuler</button>
</form>""")

    def _traiter_effacer_liste(self, corps):
        """Efface une liste entière — après la confirmation, jamais avant."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        code = donnees.get("groupe", [""])[0]
        titre, liste = self._groupe_campagnes(code)
        if titre is None:
            return self._erreur(400, "Liste de campagnes inconnue.")
        if not liste:
            return self._rediriger("/")
        if self._campagnes_qui_tournent(liste):
            # La confirmation le disait déjà ; une campagne a pu démarrer
            # entre-temps. On ne touche à rien et on le redit.
            return self._repondre(self._modale_effacer_liste(code), 409)
        releve = self.application.base.supprimer_campagnes(
            [c["id"] for c in liste])
        return self._rediriger(
            f"/?efface={releve['campagnes']}&contacts={releve['contacts']}")

    def _bloc_installeur(self, parametres):
        """La fenêtre de l'installeur, ouverte ou en réserve.

        Elle est TOUJOURS dans la page (avec son script) : sans cela, le
        lien « Reprendre la configuration » des Réglages n'aurait rien à
        ouvrir. Ce qui change, c'est l'attribut `hidden` — posé par le
        serveur, donc juste même sans JavaScript.
        """
        demande = parametres.get("installation", [""])[0] == "1"
        ouvrir = demande or self._installation_a_faire()
        contenu = self._page_installeur() if ouvrir else ""
        cache = "" if ouvrir else " hidden"
        return (f'<div class="fond-modale" id="fond-installeur"{cache}>'
                f"{contenu}</div>{SCRIPT_INSTALLATION}")

    def _page_campagne(self, campagne_id, parametres=None):
        """La fiche d'une campagne : contacts, issues, relances, clôture."""
        base = self.application.base
        campagne = base.obtenir_campagne(campagne_id)
        if campagne is None:
            return None
        if campagne.get("nature"):
            # Campagne de l'assistant en 3 étapes : son poste de pilotage.
            return self._page_pilotage(campagne, parametres)
        contacts = base.contacts_de_campagne(campagne_id)
        relances = base.relances_de_campagne(campagne_id)
        pendantes = {r["contact_id"]: r for r in relances
                     if r["statut"] == "planifiée"}
        theme = campagnes.libelle_theme(campagne["theme"])
        classe = CLASSES_STATUT_CAMPAGNE.get(campagne["statut"], "")
        lignes, transcriptions = [], []
        for contact in contacts:
            appels = base.appels_du_contact_campagne(contact["id"])
            classe_etat = CLASSES_ETAT_CONTACT.get(contact["etat"], "")
            issue = campagnes.ETIQUETTES_ISSUE.get(contact["issue"],
                                                   contact["issue"] or "—")
            relance = pendantes.get(contact["id"])
            suite = (f"🔁 relance n°{relance['tentative']} le "
                     f"{_date_lisible(relance['echeance'])}" if relance else "—")
            lignes.append(f"""<tr>
  <td>{contact['rang']}</td>
  <td>{html.escape(contact['nom'])}{essai_reel.badge(contact, '<br>')}</td>
  <td>{html.escape(contact['telephone_masque'])}</td>
  <td><span class="pastille {classe_etat}">{html.escape(
      assistant.mot_etat(contact['etat']))}</span></td>
  <td>{html.escape(issue)}</td>
  <td>{len(appels)}</td>
  <td>{html.escape(suite)}</td>
</tr>""")
            for appel in appels:
                if not appel["transcription"]:
                    continue
                etiquette = campagnes.ETIQUETTES_ISSUE.get(appel["issue"],
                                                           appel["issue"])
                titre_tentative = ("appel initial" if appel["tentative"] == 0
                                   else f"relance n°{appel['tentative']}")
                transcriptions.append(
                    f"<h3>{html.escape(contact['nom'])} — {titre_tentative} — "
                    f"{html.escape(etiquette)}</h3>"
                    f"<pre>{html.escape(appel['transcription'])}</pre>")
        tableau = ("<table><tr><th>Ordre</th><th>Contact</th><th>Téléphone</th>"
                   "<th>État</th><th>Dernière issue</th><th>Tentatives</th>"
                   "<th>Prochaine relance</th></tr>"
                   + "\n".join(lignes) + "</table>") if lignes else \
            "<p>Aucun contact dans cette campagne.</p>"
        parametres = parametres or {}
        message = ""
        if parametres.get("close", [""])[0] == "1":
            message = ('<p class="pastille">Campagne close : ses relances '
                       "planifiées sont annulées.</p>")
        details = []
        if campagne["creneau"]:
            details.append(f"Créneau / date concernée : "
                           f"<strong>{_date_lisible(campagne['creneau'])}</strong>")
        if campagne["sujet"]:
            details.append(f"Sujet : <strong>{html.escape(campagne['sujet'])}</strong>")
        if campagne["cascade_id"]:
            details.append(f'<a href="/cascade/resultat?id={campagne["cascade_id"]}">'
                           "Voir le déroulé de la cascade rattachée</a>")
        bloc_details = "<br>".join(details)
        # ⚠ ON PEUT AUSSI CLORE UNE CAMPAGNE « PRÊTE » (21/08/2026, sa demande
        # « clos ces campagnes »). Le bouton ne s'affichait que sur une campagne
        # EN COURS : une campagne préparée puis abandonnée ne pouvait donc pas
        # être fermée — il aurait fallu la DÉMARRER pour pouvoir la clore, ce
        # qui aurait fait sonner des téléphones pour rien.
        #
        # CE QUE CELA A COÛTÉ, mesuré dans sa base : 125 contacts dormaient dans
        # sept campagnes « prête » du 15 et 17/08, dont les rendez-vous avaient
        # disparu depuis. Il n'avait aucun geste pour s'en débarrasser.
        bouton_clore = ""
        if campagne["statut"] in ("en cours", "prête"):
            prete = campagne["statut"] == "prête"
            libelle = ("Clore la campagne — je ne la lancerai pas" if prete
                       else "Clore la campagne — annuler ses relances")
            aide = ("Ferme une campagne préparée que vous ne lancerez pas : "
                    "personne n'est appelé, rien n'est effacé" if prete
                    else "Annule les relances restantes de cette campagne")
            bouton_clore = f"""<form method="post" action="/campagne/clore">
  <input type="hidden" name="campagne" value="{campagne_id}">
  <button class="secondaire" title="{aide}">{libelle}</button>
</form>"""
        bloc_transcriptions = ("<h2>Transcriptions</h2>" + "".join(transcriptions)
                               if transcriptions else "")
        corps = f"""{self._bandeau()}
<p><a href="/">← Retour aux campagnes</a></p>
{message}
<h1>{html.escape(campagne['nom'])}</h1>
<p>Thème : <strong>{html.escape(theme)}</strong>
<span class="pastille {classe}">{html.escape(campagne['statut'])}</span><br>
{bloc_details}</p>
<p>Mission de la campagne : « {html.escape(campagne['mission'])} »</p>
{bouton_clore}
<h2>Contacts et avancement</h2>
{tableau}
{bloc_transcriptions}"""
        return self._page(campagne["nom"], corps, actif="campagnes")

    def _page_relances(self, parametres=None, erreurs=None):
        """La page « 🔁 Relances » : un MENU des types de rappel, un panneau.

        Le principe, tel que le propriétaire le dit : si une personne n'a pas
        pu être jointe et qu'il faut la rappeler, elle apparaît ICI. Cinq
        types, qui ne se traitent pas pareil :

        - 🙋 **rappels par un humain** — la sortie de secours des fiches de
          discussion, avec la demande du contact EN CLAIR. Ceux-là ne sont
          JAMAIS appelés automatiquement ; c'est le type d'arrivée, parce
          que personne d'autre que l'utilisateur ne les traitera ;
        - ⏰ **relances dues** et 🕓 **relances à venir** — ce que le système
          a programmé lui-même (pas de réponse, échec technique, déplacement
          non conclu). Chacune conserve le thème de sa campagne ;
        - 📵 **non joints, plafond atteint** — la chaîne s'est arrêtée pour
          eux ; ils n'ont pas été joints, les effacer reviendrait à les
          perdre ;

        Quel que soit le type, la règle ne change pas : aucune relance ne
        part toute seule, c'est toujours un geste humain qui la déclenche.
        """
        parametres = parametres or {}
        base = self.application.base
        message = ""
        fait = parametres.get("fait", [""])[0]
        if fait == "cle":
            message = ("Clé CALL-E enregistrée. Elle n'est jamais réaffichée — "
                       "seule sa description l'est. Les deux autres verrous "
                       "restent à ouvrir au lancement.")
        elif fait == "cle-retiree":
            message = ("Clé CALL-E retirée du fichier. La variable "
                       "d'environnement, si vous en posez une, continue de "
                       "fonctionner.")
        if fait == "reportee":
            message = "Relance reportée à la nouvelle échéance."
        elif fait == "annulee":
            message = "Relance annulée : la chaîne de ce contact s'arrête là."
        elif fait == "absente":
            message = "Relance introuvable (déjà faite ou déjà annulée)."
        elif fait == "traite":
            message = ("Rappel marqué « c'est fait » : il sort de la liste. "
                       "Rien n'est effacé — la demande du contact reste sur la "
                       "fiche de sa campagne.")
        elif fait == "repris":
            message = "Rappel remis dans la liste : il reste à faire."
        bloc_message = f'<p class="pastille">{html.escape(message)}</p>' if message else ""
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = (f'<div class="erreurs"><strong>Refusé :</strong>'
                            f"<ul>{elements}</ul></div>")
        dues = base.relances_dues()
        identifiants_dues = {relance["id"] for relance in dues}
        a_venir = [relance for relance in base.lister_relances("planifiée")
                   if relance["id"] not in identifiants_dues]
        bloques = base.contacts_injoignables()
        humains = base.contacts_rappel_humain()
        delai, maximum = campagnes.parametres_relance(
            self.application.preferences)
        # ⚠ CE CHIFFRE MÉLANGEAIT DEUX CHOSES OPPOSÉES. Il additionnait les
        # relances PROGRAMMÉES et les personnes pour qui plus rien ne partira
        # (plafond atteint). « 6 rappels automatiques » alors qu'aucun rappel
        # n'était programmé — le propriétaire a demandé le 02/08/2026 ce que
        # cela voulait dire, et il avait raison : cela ne voulait rien dire.
        # Deux chiffres, deux réalités.
        programmees = len(dues) + len(a_venir)

        def _tableau(relances_affichees, en_evidence, famille):
            # Chaque geste emporte le type qu'on regardait : reporter une
            # relance due ne doit pas ramener sur un autre panneau, sans quoi
            # on perd sa place à chaque clic.
            lignes = []
            for relance in relances_affichees:
                lignes.append(f"""<tr>
  <td><a href="/campagne?id={relance['campagne_id']}">{html.escape(relance['campagne_nom'])}</a><br>
      <small>{html.escape(_nature_conservee(relance))}</small></td>
  <td>{html.escape(relance['contact_nom'])}<br>
      <small>{html.escape(relance['telephone_masque'])}</small></td>
  <td>{html.escape(relance['motif'])}</td>
  <td>{relance['tentative']}/{maximum}<br>
      <small>dernier appel : {html.escape(_date_lisible(relance['dernier_appel']) if relance['dernier_appel'] else "aucun")}</small></td>
  <td>{'<strong>' if en_evidence else ''}{_date_lisible(relance['echeance'])}{'</strong>' if en_evidence else ''}</td>
  <td><form method="post" action="/relances/reporter" style="display:inline">
    <input type="hidden" name="relance" value="{relance['id']}">
    <input type="hidden" name="vue" value="{famille}">
    <input type="datetime-local" name="echeance">
    <button class="secondaire">Reporter</button>
  </form>
  <form method="post" action="/relances/annuler" style="display:inline">
    <input type="hidden" name="relance" value="{relance['id']}">
    <input type="hidden" name="vue" value="{famille}">
    <button class="secondaire">Annuler</button>
  </form></td>
</tr>""")
            return ("<table><tr><th>Campagne (thème conservé)</th><th>Contact</th>"
                    "<th>Motif</th><th>Tentative</th><th>Échéance</th><th></th></tr>"
                    + "\n".join(lignes) + "</table>")
        # ⚠ LE MENU REMPLACE LE PARAGRAPHE D'INTRODUCTION (demande du
        # propriétaire, 02/08/2026). Chaque type porte SON nombre, zéro
        # compris — c'est ainsi qu'on apprend qu'un type est vide, sans que
        # cinq blocs vides occupent l'écran. On clique, on voit sa liste :
        # soit le tableau, soit une liste vide qui garde titre et explication.
        vue = _vue_relances(parametres.get("vue", [""])[0])
        # ⚠ 905 LIGNES SUR UN ÉCRAN — son défaut n° 13 du 18/08/2026. La liste
        # des rappels par un humain se servait ENTIÈRE : mesuré dans sa base,
        # 905 lignes d'un coup, sans page, sans tri, sans moyen de voir d'où
        # elles viennent. Une liste qu'on ne peut pas parcourir n'est pas une
        # liste de travail, c'est un mur — et elle finit ignorée.
        #
        # Ce sont des DEMANDES DE PERSONNES : on n'en efface aucune et on n'en
        # solde aucune à leur place. On rend la liste parcourable, et on dit
        # d'où vient la masse — c'est ce qui permet de décider.
        def tranche(famille, elements, quoi):
            """(en-tête, ce qu'on affiche) pour une partie.

            ⚠ ON FILTRE D'ABORD, ON PAGINE ENSUITE — jamais l'inverse. Paginer
            puis filtrer aurait cherché dans les vingt-cinq lignes affichées :
            une recherche qui ne fouille que la page en cours ne cherche rien.
            """
            retenus = self._retenir_relances(parametres, elements)
            visibles, page, pages = self._tranche_relances(
                parametres, famille, retenus)
            entete = self._compte_relances(len(retenus), len(elements), quoi,
                                           parametres)
            # ⚠ « AUCUN RÉSULTAT » N'EST PAS « CETTE LISTE EST VIDE ». Sans
            # cette distinction, filtrer sur un nom absent des 📵 non joints
            # affichait « Personne n'a atteint son maximum de rappels » — alors
            # qu'ils sont trente-neuf. Un écran qui ment sur ce qu'il contient
            # est pire qu'un écran qui se tait.
            # L'ORDRE QUI SE LIT : filtrer → ce que ça donne → les pages.
            return (self._formulaire_relances(parametres, famille)
                    + entete
                    + self._navigation_relances(famille, page, pages,
                                                len(visibles), len(retenus),
                                                quoi),
                    visibles, bool(elements) and not retenus)

        nav_humains, humains_visibles, vide_h = tranche("humains", humains,
                                                        "rappel(s)")
        nav_dues, dues_visibles, vide_d = tranche("dues", dues, "relance(s)")
        nav_a_venir, a_venir_visibles, vide_v = tranche("a_venir", a_venir,
                                                        "relance(s)")
        nav_bloques, bloques_visibles, vide_b = tranche("bloques", bloques,
                                                        "personne(s)")

        def contenu(vide_par_le_filtre, tableau):
            """Le tableau, ou la phrase qui dit que c'est le FILTRE qui vide."""
            return SANS_RESULTAT if vide_par_le_filtre else tableau
        reglages = (f"<p><small>Réglages actuels : délai par défaut +{delai} h "
                    f"ouvrée(s) dans la plage d'appel, {maximum} tentative(s) "
                    'maximum — <a href="/reglages">⚙ modifier</a>.</small></p>')
        if dues:
            verbe = "RÉELLEMENT" if self.application.mode_reel else "en simulation"
            # ⚠ LE BOUTON LANCE TOUTES LES DUES, PAS LA PAGE AFFICHÉE — et il le
            # dit avec le total. Une pagination change ce qu'on VOIT, jamais ce
            # qu'un geste fait : croire n'en lancer que vingt-cinq et en lancer
            # cent serait le pire des malentendus.
            contenu_dues = (nav_dues
                            + contenu(vide_d,
                                      _tableau(dues_visibles, True, "dues"))
                            + '<form method="post" action="/relances/executer">'
                            '<p><button style="font-size:1.05rem">▶ Lancer les '
                            f"{len(dues)} relance(s) due(s) — appeler {verbe}"
                            "</button></p></form>")
        else:
            contenu_dues = ('<p class="vide-famille">Aucune relance n\'est due '
                            "pour l'instant : rien n'attend d'être lancé.</p>")
        contenu_a_venir = (nav_a_venir
                           + contenu(vide_v, _tableau(a_venir_visibles, False,
                                                      "a_venir")) if a_venir else
                           '<p class="vide-famille">Aucune relance n\'est '
                           "programmée pour plus tard.</p>")
        panneaux = "".join([
            _panneau_relance(
                "humains", f"🙋 Rappels par un humain ({len(humains)})",
                # ⚠ DEUX ORIGINES DEPUIS LE 20/08/2026, et le texte les dit
                # toutes les deux : une seule phrase laissait croire que les
                # 🚫 étaient arrivés là par erreur.
                "<p>Deux façons d'arriver ici. <strong>Ce que l'agent n'a pas "
                "pu conclure</strong> : le contact demande quelque chose "
                "qu'une machine ne tranche pas. Et <strong>ceux qui ont "
                "refusé d'être appelés par un agent</strong> : ils n'ont pas "
                "refusé le cabinet, c'est à un humain de les rappeler.</p>"
                "<p>Ces contacts ne sont <strong>jamais appelés "
                "automatiquement</strong> — aucune relance n'est programmée "
                "pour eux, et ils ne repartent dans aucune campagne tant "
                "qu'un humain ne les y remet pas.</p>",
                self._origine_des_humains(humains) + nav_humains
                + contenu(vide_h,
                          self._tableau_rappels_humains(humains_visibles)),
                vue),
            _panneau_relance(
                "dues", f"⏰ Relances dues ({len(dues)})",
                "<p>Les relances <strong>programmées par le système</strong> "
                "dont l'échéance est passée. Elles ne partent pas toutes "
                "seules : c'est le bouton ci-dessous qui les lance, et les "
                "mêmes verrous s'appliquent (plage horaire, et les trois "
                "verrous des appels réels).</p>" + reglages,
                contenu_dues, vue),
            _panneau_relance(
                "a_venir", f"🕓 Relances à venir ({len(a_venir)})",
                "<p>Programmées elles aussi, mais leur échéance n'est pas "
                "encore là. Chacune <strong>conserve le thème et les "
                "paramètres</strong> de sa campagne ; l'échéance se reporte "
                "ou s'annule d'un geste.</p>" + reglages,
                contenu_a_venir, vue),
            _panneau_relance(
                "bloques", f"📵 Non joints — maximum de rappels atteint ({len(bloques)})",
                "<p>Ces personnes <strong>n'ont pas été jointes</strong> et la "
                "chaîne automatique s'est arrêtée pour elles : plus rien ne "
                "partira tout seul. Elles restent visibles ici — les faire "
                "disparaître reviendrait à les perdre.</p>",
                nav_bloques + contenu(
                    vide_b, self._tableau_bloques(bloques_visibles, maximum)),
                vue),
        ])
        comptes = {"humains": len(humains), "dues": len(dues),
                   "a_venir": len(a_venir), "bloques": len(bloques)}
        passees = base.lister_relances("faite")
        annulees = base.lister_relances("annulée")
        corps = f"""{self._bandeau()}
{bloc_message}
{bloc_erreurs}
<h1>🔁 Relances</h1>
{_menu_relances(comptes, vue)}
{_rien_a_rappeler(programmees, bloques, humains)}
{panneaux}
<p><small>Historique : {len(passees)} relance(s) faite(s), {len(annulees)}
annulée(s) — le détail de chaque chaîne est sur la fiche de sa campagne.</small></p>
{SCRIPT_RELANCES}"""
        return self._page("Relances", corps, actif="relances")

    def _tableau_bloques(self, bloques, maximum):
        """📵 Les non joints : on a rappelé le maximum de fois réglé.

        ⚠ LE MOT « PLAFOND » EST PARTI D'ICI (21/08/2026). Il désignait le
        « Nombre maximal de rappels » de l'étape ②, mais le produit
        l'employait AUSSI pour « Au maximum, combien de personnes » de
        l'étape ③ — deux réglages sans rapport sous un seul mot. Il a lu
        « limite de crédit CALL-E », qui est encore un troisième sens.
        """
        if not bloques:
            return ('<p class="vide-famille">Personne n\'a atteint son '
                    "maximum de rappels : aucune chaîne ne s'est arrêtée "
                    "faute d'avoir joint la personne.</p>")
        lignes = "".join(f"""<tr>
  <td><a href="/campagne?id={contact['campagne_id']}">{html.escape(contact['campagne_nom'])}</a><br>
      <small>{html.escape(_nature_conservee(contact))}</small></td>
  <td>{html.escape(contact['nom'])}<br>
      <small>{html.escape(contact['telephone_masque'])}</small></td>
  <td>{html.escape(assistant.mot_detail(contact['detail']) or f"état « {contact['etat']} » — maximum de rappels atteint")}</td>
  <td>{contact['tentatives_faites']}/{maximum}<br>
      <small>dernier appel : {html.escape(_date_lisible(contact['dernier_appel']) if contact['dernier_appel'] else "aucun")}</small></td>
  <td><span class="pastille st-ignore">plus de relance programmée</span></td>
</tr>""" for contact in bloques)
        return ("<table><tr><th>Campagne (thème conservé)</th><th>Contact</th>"
                "<th>Pourquoi</th><th>Tentatives</th><th>Suite</th></tr>"
                + lignes + "</table>"
                + "<p><small>Pour les reprendre, une campagne de rattrapage "
                  "se construit depuis les 📵 injoignables d'une campagne "
                  'passée (<a href="/assistant">assistant</a>, étape '
                  "③).</small></p>")

    def _modale_demande(self, contact_id):
        """Ce que la personne a demandé, mot pour mot, en fenêtre.

        Le texte vient de la fin de son appel : il n'est ni reformulé, ni
        résumé. On y ajoute seulement de quoi savoir de qui et de quelle
        campagne il s'agit.
        """
        contacts = (self.application.base.contacts_rappel_humain()
                    + self.application.base.contacts_rappel_humain(traites=True))
        contact = next((c for c in contacts if c["id"] == contact_id), None)
        if contact is None:
            return None
        demande = assistant.mot_detail(contact.get("detail")).strip()
        corps = (f'<p><small>{html.escape(contact["telephone_masque"])} — '
                 f'<a href="/campagne?id={contact["campagne_id"]}">'
                 f'{html.escape(contact["campagne_nom"])}</a></small></p>'
                 f'<pre class="detail-entier">{html.escape(demande)}</pre>'
                 if demande else "<p>Aucune demande n'a été enregistrée.</p>")
        return self._modale(f"Sa demande — {html.escape(contact['nom'])}",
                            corps)

    # ⚠ « ☎ À CONTACTER À LA MAIN » A ÉTÉ RETIRÉ le 10/08/2026, à la demande
    # du propriétaire (il l'avait demandé la veille : c'est son écran, et
    # c'est lui qui juge de ce qu'il y lit). Les deux sources qu'il
    # réunissait restent lisibles : 🔁 Relances (§ humains) porte les contacts
    # qu'une campagne n'a pas pu conclure, et le drapeau 🔔 « rappel
    # souhaité » s'affiche partout où le contact apparaît.

    # ⚠ LA MÊME PAGINATION QUE 👥 CONTACTS (21/08/2026, sa demande : « exactement
    # la même chose que dans la page Contacts. Il y a une pagination pour chaque
    # partie qui contient des contacts »). Mêmes tailles, même défaut, mêmes
    # quatre boutons ≪ ‹ › ≫ désactivés aux extrémités : deux écrans qui font le
    # même geste doivent le faire de la même façon, sans quoi il faut réapprendre
    # à chaque page.
    #
    # ⚠ ET UNE PAGE PAR PARTIE, PAS UNE POUR TOUTES. Les cinq familles vivent
    # dans la même page (une seule est visible, les autres portent `hidden`) :
    # un unique paramètre « page » aurait fait sauter les quatre autres au même
    # numéro dès qu'on tourne une page. Chaque partie a donc le sien —
    # « page_humains », « page_dues »… — et elles ne se marchent pas dessus.
    PAR_PAGE_CHOIX_RELANCES = (10, 25, 50, 100, 0)
    # ⚠ DIX, PAS VINGT-CINQ (21/08/2026, sa demande) — et c'est le seul écart
    # avec 👥 Contacts, voulu : une ligne de rappel porte une demande à LIRE
    # (« sa demande, en clair »), pas une fiche à survoler. Vingt-cinq
    # paragraphes d'un coup ne se lisent pas.
    PAR_PAGE_DEFAUT_RELANCES = 10

    def _filtres_relances(self, parametres):
        """(recherche, interdits demandés) — les mêmes deux filtres qu'ici."""
        return ((parametres.get("recherche", [""])[0] or "").strip(),
                parametres.get("interdit", [""])[0] == "interdits")

    def _retenir_relances(self, parametres, elements):
        """Applique la recherche et le filtre 🚫 — la MÊME règle que 👥 Contacts.

        ⚠ SA REMARQUE DU 21/08/2026 : « tu as oublié toute la partie filtre ».
        Il avait raison : je n'avais porté que « Combien par page ». Retrouver
        quelqu'un parmi 917 rappels étalés sur 37 pages sans recherche, c'est
        exactement le mur que la pagination devait abattre.

        ⚠ LE NUMÉRO N'EST PAS COMPARÉ ICI, et c'est la règle du produit : les
        lignes d'affichage ne portent que le masque. La base rend des
        IDENTIFIANTS (`clients_par_chiffres`) ; on ne fait que les reconnaître.
        """
        recherche, interdit = self._filtres_relances(parametres)
        if not recherche and not interdit:
            return list(elements)
        base = self.application.base
        cherche = etats_clients._sans_accents(recherche)
        ids_numero = base.clients_par_chiffres(recherche) if recherche else set()
        interdits = base.clients_interdits() if interdit else set()
        retenus = []
        for element in elements:
            # Une relance nomme son contact « contact_nom » ; un rappel humain
            # le nomme « nom ». Les deux voyagent dans cette même liste.
            nom = element.get("contact_nom") or element.get("nom") or ""
            client = element.get("client_id")
            if recherche and not (cherche in etats_clients._sans_accents(nom)
                                  or (client and client in ids_numero)):
                continue
            if interdit and client not in interdits:
                continue
            retenus.append(element)
        return retenus

    @staticmethod
    def _compte_relances(retenus, total, quoi, parametres):
        """« N sur M — aucun filtre » — la ligne de 👥 Contacts, mot pour mot."""
        rappel = []
        recherche = (parametres.get("recherche", [""])[0] or "").strip()
        if recherche:
            rappel.append(f"nom ou numéro contenant « {recherche} »")
        if parametres.get("interdit", [""])[0] == "interdits":
            rappel.append("🚫 contact par agent interdit")
        return (f"<p><strong>{retenus}</strong> {quoi} sur {total}"
                + (f" — filtre : {html.escape(', '.join(rappel))}" if rappel
                   else " — aucun filtre")
                + ".</p>")

    def _par_page_relances(self, parametres):
        """Combien de lignes par page — 0 veut dire « toutes »."""
        taille = _entier(parametres.get("par_page"),
                         self.PAR_PAGE_DEFAUT_RELANCES)
        return (taille if taille in self.PAR_PAGE_CHOIX_RELANCES
                else self.PAR_PAGE_DEFAUT_RELANCES)

    def _tranche_relances(self, parametres, famille, elements):
        """(ce qu'on affiche, page, nombre de pages) pour CETTE partie."""
        taille = self._par_page_relances(parametres)
        if not taille:
            return list(elements), 1, 1
        pages = max(1, -(-len(elements) // taille))
        page = min(max(_entier(parametres.get(f"page_{famille}"), 1), 1), pages)
        depuis = (page - 1) * taille
        return list(elements)[depuis:depuis + taille], page, pages

    @staticmethod
    def _navigation_relances(famille, page, pages, combien, total, quoi):
        """« ≪ ‹ page 2 sur 7 › ≫ » — les mêmes quatre boutons que 👥 Contacts.

        ⚠ ILS PORTENT « name=page_<famille> » et appartiennent au formulaire de
        la page : sans JavaScript, cliquer l'envoie en GET avec ce numéro, et la
        liste se recharge — exactement comme sur 👥 Contacts.

        ⚠ ET ILS SONT DÉSACTIVÉS AUX EXTRÉMITÉS, jamais masqués : un bouton qui
        disparaît fait douter de l'endroit où l'on est.
        """
        if pages <= 1:
            return ""

        def bouton(cible, signe, titre, actif):
            desactive = "" if actif else " disabled"
            return (f'<button class="secondaire page-nav" '
                    f'form="filtres-relances-{famille}" '
                    f'name="page_{famille}" value="{cible}" '
                    f'title="{titre}"{desactive}>{signe}</button>')
        return f"""<p class="pagination">
  {bouton(1, "≪", "Première page", page > 1)}
  {bouton(page - 1, "‹", "Page précédente", page > 1)}
  <span class="sourd">page <strong>{page}</strong> sur {pages} —
    {combien} {quoi} affiché(s) sur {total}</span>
  {bouton(page + 1, "›", "Page suivante", page < pages)}
  {bouton(pages, "≫", "Dernière page", page < pages)}
</p>"""

    def _formulaire_relances(self, parametres, famille):
        """La barre de filtres de CETTE partie — juste au-dessus de sa liste.

        ⚠ SA DEMANDE DU 21/08/2026 : « je veux que les filtres soient juste
        au-dessus de la pagination, pas au-dessus d'un texte, sinon c'est trop
        compliqué à comprendre pour l'utilisateur ».

        Elle était posée EN TÊTE DE PAGE, séparée de la liste qu'elle filtre par
        le titre de la famille et deux paragraphes d'explication : rien ne disait
        sur quoi elle agissait. Elle vit maintenant DANS la partie, collée à son
        compte et à sa pagination — on lit « filtrer », puis « N sur M », puis
        les pages, puis la liste.

        ⚠ UN IDENTIFIANT PAR PARTIE, et c'est obligatoire : cinq formulaires
        portant le même `id` seraient du HTML invalide, et les boutons de page
        des quatre dernières parties se rattacheraient tous au premier.
        """
        courant = self._par_page_relances(parametres)
        tailles = "".join(
            f'<option value="{taille}"'
            f'{" selected" if taille == courant else ""}>'
            f'{"tous" if taille == 0 else taille} par page</option>'
            for taille in self.PAR_PAGE_CHOIX_RELANCES)
        # ⚠ LA MÊME CLASSE QUE 👥 CONTACTS (« filtres ») : elle porte déjà la
        # mise en page de cette barre, et en inventer une seconde aurait fait
        # deux barres qui se ressemblent sans être pareilles.
        recherche, interdit = self._filtres_relances(parametres)
        # ⚠ NI « ÉTAT » NI « NON TRAITÉ » ICI, et c'est délibéré. Sur 👥 Contacts
        # ces deux filtres découpent une liste unique ; sur 🔁 Relances, ce
        # découpage EST déjà le menu des cinq familles (🙋 · ⏰ · 🕓 · 📵 · ✅).
        # Les remettre en sélecteur aurait posé deux commandes qui disent la
        # même chose que le menu juste au-dessus — et qui pourraient le
        # contredire.
        return f"""<form method="get" action="/relances"
      id="filtres-relances-{famille}" class="filtres">
  <input type="hidden" name="vue" value="{html.escape(famille)}">
  <label>Rechercher un contact — nom ou numéro<br>
    <input type="search" name="recherche" value="{html.escape(recherche)}"
           placeholder="Lefèvre, ou 0600000042"></label>
  <label>Contact par l'agent<br>
    <select name="interdit">
      <option value=""{" selected" if not interdit else ""}>tous</option>
      <option value="interdits"{" selected" if interdit else ""}>🚫 contact par
        agent interdit</option>
    </select></label>
  <label>Combien par page<br>
    <select name="par_page">{tailles}</select></label>
  <button class="secondaire" type="submit">Filtrer</button>
</form>"""

    @staticmethod
    def _origine_des_humains(humains):
        """D'OÙ VIENT LA MASSE : le compte par campagne, du plus gros au plus petit.

        ⚠ CE N'EST PAS UN ORNEMENT. Sur sa base, 905 rappels en attente
        venaient de quelques campagnes seulement — des campagnes qui avaient
        échoué en bloc pour une raison technique, pas 905 personnes ayant
        chacune demandé quelque chose. Sans ce compte, la liste ressemble à 905
        problèmes distincts ; avec lui, on voit les trois qu'elle contient.
        """
        if len(humains) < 2:
            return ""
        comptes = {}
        for contact in humains:
            cle = (contact["campagne_id"], contact["campagne_nom"])
            comptes[cle] = comptes.get(cle, 0) + 1
        if len(comptes) < 2:
            return ""
        ordre = sorted(comptes.items(), key=lambda e: (-e[1], e[0][1]))
        lignes = "".join(
            f'<li><a href="/campagne?id={identifiant}">{html.escape(nom)}</a>'
            f" — <strong>{combien}</strong></li>"
            for (identifiant, nom), combien in ordre[:8])
        reste = ("" if len(ordre) <= 8 else
                 f"<li>… et {len(ordre) - 8} autre(s) campagne(s)</li>")
        return ("<details><summary>D'où viennent ces rappels "
                f"({len(ordre)} campagne(s))</summary>"
                f"<ul>{lignes}{reste}</ul></details>")

    def _tableau_rappels_humains(self, humains):
        """🙋 Les contacts « à rappeler par un humain » — jamais appelés seuls.

        La demande du contact n'est pas reprise dans la cellule : elle s'ouvre
        en fenêtre (elle fait souvent plusieurs lignes et déformait le
        tableau). Rien n'est reformulé ni inventé, et le geste « c'est fait »
        les sort de la liste sans rien effacer.
        """
        if not humains:
            return ('<p class="vide-famille">Aucun rappel par un humain en '
                    "attente : l'agent a pu conclure tous ses appels.</p>")
        lignes = "".join(f"""<tr>
  <td>{html.escape(contact['nom'])}<br>
      <small>{html.escape(contact['telephone_masque'])}</small></td>
  <td><a href="/campagne?id={contact['campagne_id']}">{html.escape(contact['campagne_nom'])}</a><br>
      <small>{html.escape(_nature_conservee(contact))}</small></td>
  <td>{_lien_demande(contact)}</td>
  <td>{contact['tentatives_faites']}<br>
      <small>dernier appel : {html.escape(_date_lisible(contact['dernier_appel']) if contact['dernier_appel'] else "aucun")}</small></td>
  <td><form method="post" action="/relances/humain">
    <input type="hidden" name="contact" value="{contact['id']}">
    <input type="hidden" name="valeur" value="1">
    <input type="hidden" name="vue" value="humains">
    <button class="secondaire" title="Sort de la liste — rien n'est effacé">✔ C'est fait</button>
  </form></td>
</tr>""" for contact in humains)
        return ("<table><tr><th>Contact</th><th>Campagne (thème "
                "conservé)</th><th>Sa demande, en clair</th>"
                "<th>Tentatives</th><th></th></tr>" + lignes + "</table>")

    def _page_resultat_relances(self, comptes_rendus):
        """Le compte rendu du geste « Lancer les relances dues »."""
        lignes = []
        panne = next((c["panne"] for c in comptes_rendus if c.get("panne")), "")
        for compte_rendu in comptes_rendus:
            issue = campagnes.ETIQUETTES_ISSUE.get(compte_rendu["issue"],
                                                   compte_rendu["issue"] or "—")
            if compte_rendu.get("panne"):
                # Panne DE NOTRE CÔTÉ : cette relance n'a PAS été jouée, elle
                # reste planifiée. On l'écrit, plutôt que de la faire passer
                # pour une tentative.
                suite = ("Relance NON jouée — toujours planifiée, aucune "
                         "tentative comptée")
            else:
                suite = ("Chaîne conclue" if compte_rendu["abouti"] else
                         ("Exclu — jamais composé" if compte_rendu["etat"] == "exclu"
                          else ("Abandon (maximum de tentatives atteint)"
                                if compte_rendu["etat"] == "abandonné"
                                else "Nouvelle relance programmée")))
            lignes.append(f"""<tr>
  <td><a href="/campagne?id={compte_rendu['campagne_id']}">{html.escape(compte_rendu['campagne_nom'])}</a></td>
  <td>{html.escape(compte_rendu['contact'])}</td>
  <td>n°{compte_rendu['tentative']}</td>
  <td><span class="pastille">{html.escape(issue)}</span></td>
  <td>{html.escape(suite)}</td>
</tr>""")
        if lignes:
            tableau = ("<table><tr><th>Campagne</th><th>Contact</th>"
                       "<th>Tentative</th><th>Issue</th><th>Suite</th></tr>"
                       + "\n".join(lignes) + "</table>")
        else:
            tableau = "<p>Aucune relance n'était due : rien n'a été appelé.</p>"
        bandeau_panne = (f'<p class="erreurs">⛔ {html.escape(panne)}</p>'
                         if panne else "")
        corps = f"""{self._bandeau()}
<p><a href="/relances">← Retour aux relances</a></p>
<h1>Relances exécutées</h1>
{bandeau_panne}
<p><strong>{len(lignes)}</strong> relance(s) traitée(s).</p>
{tableau}"""
        return self._page("Relances exécutées", corps, actif="relances")

    def _page_suivi(self, parametres=None):
        # Règle du manqué appliquée au chargement : un rendez-vous « prévu »
        # dont l'horaire est passé bascule en « manqué » avant l'affichage.
        self.application.base.marquer_manques_echus()
        parametres = parametres or {}
        # ⚠ LA SECTION « 📞 À rappeler (manqués) » A ÉTÉ RETIRÉE le 10/08/2026,
        # à la demande du propriétaire. Un rendez-vous manqué reste entièrement
        # lisible dans 🗂 Tous les rendez-vous, avec sa pastille — et les
        # campagnes sont désormais la voie pour rappeler du monde. Le message
        # « n rendez-vous passé(s) en ignoré » partait avec elle : il n'avait
        # plus de bouton pour le déclencher.
        bloc_message = self._compte_rendu_import(
            parametres.get("import", [""])[0])
        # Section « à venir » : chaque saisie est visible IMMÉDIATEMENT ici,
        # et elle y RESTE tant qu'elle TIENT. Les deux règles du
        # propriétaire, qui se complètent :
        # - « ce n'est pas un contact qui disparaît, mais une ligne qui
        #   évolue » : un rendez-vous confirmé au téléphone ne s'escamote
        #   pas — il change de pastille, à sa place, dans la même ligne ;
        # - correction du 31/07/2026 : un rendez-vous ANNULÉ, lui, n'existe
        #   plus — il n'a rien à faire dans « à venir ». Il reste lisible
        #   dans « Tous les rendez-vous » et sur la fiche du contact.
        # ⚠ TROIS BLOCS RETIRÉS LE 10/08/2026, à la demande du propriétaire :
        # « ☎ À contacter à la main », « 📅 Rendez-vous à venir » et le repli
        # « Sans glisser ». La page ne porte plus que le planning et le geste
        # d'import — c'est un planning, pas un tableau de bord.
        #
        # Où ça se retrouve : les personnes à contacter à la main sont dans
        # 🔁 Relances (§ humains), qui les portait déjà ; les rendez-vous à
        # venir sont dans 🗂 Tous les rendez-vous, dont le lien RESTE juste
        # en dessous — sans lui, plus aucune liste de rendez-vous ne serait
        # atteignable depuis cette page.
        sans_numero = self.application.base.rendezvous_sans_numero()
        lien_sans_numero = ""
        if sans_numero:
            lien_sans_numero = (f'<p><a href="/sans-numero">✎ {len(sans_numero)} '
                                "rendez-vous importé(s) sans numéro — à compléter</a></p>")
        corps = f"""{self._bandeau()}
<h1>Rendez-vous</h1>
{bloc_message}
<section id="planning">{self._zone_planning(parametres)}</section>
{SCRIPT_PLANNING}
<p class="sous-planning"><a href="/ajouter" data-modale="/suivi/importer"
   >＋ Importer votre agenda</a>
 · <a href="/tous">🗂 Tous les rendez-vous, quel que soit leur état</a></p>
{lien_sans_numero}"""
        return self._page("Rendez-vous", corps, actif="suivi")

    # ------------------------------------------------------------- planning
    def _zone_planning(self, parametres=None):
        """Le FRAGMENT « planning » : la barre de navigation ET la grille.

        Tout est dans le même morceau, parce que naviguer change les deux :
        la semaine affichée et la position des sélecteurs. C'est CETTE zone
        que la page recharge — jamais la page entière.

        Les règles de navigation, à la lettre :
        - le champ date mène directement à la semaine de cette date ;
        - **tout autre bouton de navigation REMET LE CHAMP DATE À VIDE** ;
        - « ⏭ Prochain créneau disponible » avance de trou en trou (il
          garde sa position dans un champ caché), et cette position repart
          de zéro dès qu'on navigue autrement.
        """
        parametres = parametres or {}
        base = self.application.base
        preferences = self.application.preferences
        aujourd_hui = datetime.date.today()
        aller = parametres.get("aller", [""])[0]
        date_saisie = parametres.get("date", [""])[0].strip()
        rang = _entier(parametres.get("rang"), 0)
        rang = max(rang, 0)
        annee_courante, semaine_courante = horaires.semaine_iso(aujourd_hui)
        annee = _entier(parametres.get("annee"), annee_courante)
        numero = _entier(parametres.get("semaine"), semaine_courante)
        annee = min(max(annee, 1970), 2999)
        lundi = horaires.lundi_de_semaine(annee, numero)
        erreur_date, message, cible = "", "", None
        if aller in ("", "date"):
            if date_saisie:
                try:
                    jour = datetime.date.fromisoformat(
                        horaires.valider_date(date_saisie))
                    lundi = horaires.lundi_de(jour)
                except ValueError as erreur:
                    erreur_date = str(erreur)   # la saisie refusée reste affichée
            rang = 0
        elif aller == "precedent":
            lundi, date_saisie, rang = lundi - datetime.timedelta(days=7), "", 0
        elif aller == "suivant":
            lundi, date_saisie, rang = lundi + datetime.timedelta(days=7), "", 0
        elif aller == "prochain":
            date_saisie = ""
            trous = horaires.suites_libres_datees(base, preferences,
                                                  limite=rang + 1)
            if len(trous) > rang:
                trou = trous[rang]
                cible = trou["debut"]
                lundi = horaires.lundi_de(cible.date())
                message = (f"Prochain créneau disponible n° {rang + 1} : "
                           f"{_date_jour_lisible(cible.date().isoformat())} à "
                           f"{horaires.heure_lisible(cible.hour * 60 + cible.minute)}"
                           " — place libre : " + horaires.tranches_lisibles(
                               trou["tranches"],
                               horaires.pas_minutes(preferences))
                           + " d'affilée. Un clic de plus mène au suivant.")
                rang += 1
            elif rang:
                message = (f"Plus de créneau au-delà du n° {rang} sur les "
                           f"{horaires.HORIZON_JOURS} prochains jours : le "
                           "prochain clic repartira du premier.")
                rang = 0
            else:
                message = ("Aucun créneau libre sur les "
                           f"{horaires.HORIZON_JOURS} prochains jours : tout "
                           "est pris, fermé, ou la semaine type est vide "
                           "(⚙ Réglages).")
        else:               # les sélecteurs « semaine » / « année »
            date_saisie, rang = "", 0
        annee, numero = horaires.semaine_iso(lundi)
        return self._barre_planning(lundi, annee, numero, date_saisie, rang,
                                    erreur_date, message,
                                    annee_courante) + \
            self._grille_planning(lundi, cible) + \
            self._repli_plage(annee, numero)

    def _repli_plage(self, annee, numero):
        """Choisir une plage SANS glisser — REPLIÉ derrière son intitulé.

        ⚠ IL SERT DEUX CAS D'UN COUP. D'abord sans JavaScript, comme partout
        dans le produit. Ensuite AU DOIGT : le glisser n'existe qu'à la souris
        dans tout RingBack (aucun touchstart, aucun pointerdown), donc sur
        téléphone la sélection sur la grille n'existe pas. Ce formulaire, lui,
        marche partout.

        ⚠ RETIRÉ LE 10/08/2026, REMIS LE MÊME JOUR — replié. Il encombrait la
        page ; le supprimer coupait le seul chemin sans souris. Un <details>
        règle les deux : l'écran ne porte qu'un intitulé, et le dévoilement ne
        demande AUCUN script — c'est ce qui compte, puisque l'appareil qui en a
        besoin est justement celui où le glisser manque.

        ⚠ L'ANNÉE ET LA SEMAINE VOYAGENT AVEC. La fenêtre de plage s'en sert
        pour composer ses campagnes : sans elles, le retour au planning
        perdrait la semaine affichée.
        """
        formulaire = f"""<form method="get" action="/suivi/plage" class="carte repli-plage">
  <input type="hidden" name="annee" value="{annee}">
  <input type="hidden" name="semaine" value="{numero}">
  <p><strong>Sans glisser</strong> — choisir une plage en la saisissant :</p>
  <table class="tableau-saisie"><tbody>
    <tr><th scope="col">Du jour</th><th scope="col">Au jour</th>
        <th scope="col">De</th><th scope="col">À</th>
        <th scope="col">Plage</th></tr>
    <tr>
      <td><input type="date" name="jour1" aria-label="Du jour"></td>
      <td><input type="date" name="jour2" aria-label="Au jour"></td>
      <td><input type="time" name="heure1" step="900" aria-label="De"></td>
      <td><input type="time" name="heure2" step="900" aria-label="À"></td>
      <td><button>Voir ce qu'elle contient</button></td>
    </tr>
  </tbody></table>
  <p><small>Un seul jour dans les deux champs : une seule journée. La
  dernière heure est <strong>incluse</strong>, comme au glissé.</small></p>
</form>"""
        return _replie("Saisie manuelle des créneaux", formulaire)

    def _barre_planning(self, lundi, annee, numero, date_saisie, rang,
                        erreur_date, message, annee_courante):
        """La barre de navigation du planning (sélecteurs, date, flèches)."""
        annees = sorted({annee_courante - 2, annee_courante - 1, annee_courante,
                         annee_courante + 1, annee_courante + 2, annee})
        options_annees = "".join(
            f'<option value="{a}"{" selected" if a == annee else ""}>{a}</option>'
            for a in annees)
        options_semaines = []
        for index in range(1, horaires.nombre_de_semaines(annee) + 1):
            premier = horaires.lundi_de_semaine(annee, index)
            dernier = premier + datetime.timedelta(days=6)
            options_semaines.append(
                f'<option value="{index}"'
                f'{" selected" if index == numero else ""}>'
                f"semaine {index} — du {premier:%d/%m} au {dernier:%d/%m}"
                "</option>")
        bloc_erreur = ""
        if erreur_date:
            bloc_erreur = ('<div class="erreurs"><strong>Date refusée :</strong> '
                           f"{html.escape(erreur_date)}</div>")
        bloc_message = (f'<p class="pastille">{html.escape(message)}</p>'
                        if message else "")
        return f"""<form class="barre-planning" method="get" action="/suivi">
  <div class="groupe">
    <button type="submit" class="secondaire" name="aller" value="precedent"
            data-aller="precedent" title="Semaine précédente — remet le champ date à vide">◀ Semaine précédente</button>
    <button type="submit" class="secondaire" name="aller" value="suivant"
            data-aller="suivant" title="Semaine suivante — remet le champ date à vide">Semaine suivante ▶</button>
  </div>
  <label>Semaine de l'année<br>
    <select name="semaine">{''.join(options_semaines)}</select></label>
  <label>Année<br><select name="annee">{options_annees}</select></label>
  <button type="submit" class="secondaire" name="aller" value="semaine"
          data-aller="semaine">Afficher cette semaine</button>
  <label>Aller à une date (AAAA-MM-JJ, par exemple {datetime.date.today():%Y-%m-%d})<br>
    <input type="date" name="date" value="{html.escape(date_saisie)}"></label>
  <button type="submit" class="secondaire" name="aller" value="date"
          data-aller="date">Aller à cette date</button>
  <button type="submit" name="aller" value="prochain" data-aller="prochain"
          title="Le premier clic mène au trou libre le plus proche ; chaque clic suivant au trou d'après">⏭ Prochain créneau disponible</button>
  <input type="hidden" name="rang" value="{rang}">
</form>
{bloc_erreur}
{bloc_message}"""

    def _grille_planning(self, lundi, cible=None):
        """La grille de la semaine : tranches libres en vert, tuiles dessus.

        Le découpage est EXACTEMENT celui de la semaine type des réglages.
        Un rendez-vous de plusieurs tranches consécutives donne UNE tuile
        (rowspan), jamais une case par tranche.
        """
        base = self.application.base
        preferences = self.application.preferences
        grille = horaires.grille_semaine(base, preferences, lundi)
        pas = grille["pas"]
        dimanche = lundi + datetime.timedelta(days=6)
        if not grille["minutes"]:
            return ('<p class="erreurs">Aucune heure à afficher : la semaine '
                    'type est vide. Ouvrez des heures dans <a href="/reglages'
                    '#horaires">⚙ Réglages</a>.</p>')
        # ⚠ CHOISIR UNE JOURNÉE ENTIÈRE D'UN CLIC — son défaut n° 9 du
        # 18/08/2026. Mesuré sur une fenêtre de 1280 × 720 : la colonne d'un
        # jour, de 08h00 à 18h40, fait environ 830 pixels pour 720 visibles. Le
        # glissé ne fait pas défiler la page tout seul : le geste que le
        # produit revendique — « vider une journée entière » — était donc
        # IMPOSSIBLE d'un seul glissé sur son écran.
        #
        # Deux échappatoires existaient, aucune évidente : Ctrl + glissé cumule
        # plusieurs zones (mais Ctrl + molette agrandit la page dans le
        # navigateur), et le repli « Sans glisser » demande de taper quatre
        # valeurs. L'en-tête du jour, lui, est déjà là, et il désigne
        # exactement la journée.
        #
        # ⚠ UN VRAI LIEN, PAS UNE ÉCOUTE : sans JavaScript — donc au doigt, sur
        # téléphone, où le glissé n'existe pas du tout — il mène à la même
        # plage, en page entière (voir `_reponse_plage`). Avec JavaScript,
        # `data-modale` ouvre la fenêtre latérale, comme un clic sur une case.
        # L'année et la semaine sont dans le lien pour le repli ; la fenêtre,
        # elle, les ajoute elle-même depuis la grille affichée.
        annee_iso, semaine_iso, _ = lundi.isocalendar()
        premiere = grille["minutes"][0]
        derniere = grille["minutes"][-1]
        heure1 = f"{premiere // 60:02d}:{premiere % 60:02d}"
        heure2 = f"{derniere // 60:02d}:{derniere % 60:02d}"
        entetes = []
        for jour in grille["jours"]:
            date = jour["date"]
            classe = ' class="jour-ferme"' if jour["ferme"] is not None else ""
            mention = ""
            if jour["ferme"] is not None:
                precision = f" — {html.escape(jour['ferme'])}" if jour["ferme"] else ""
                mention = f'<br><small>📕 fermé{precision}</small>'
            plage = (f"/suivi/plage?jour1={date.isoformat()}"
                     f"&amp;jour2={date.isoformat()}"
                     f"&amp;heure1={urllib.parse.quote(heure1)}"
                     f"&amp;heure2={urllib.parse.quote(heure2)}")
            titre = (f"Choisir toute la journée du {date:%d/%m}, "
                     f"de {heure1.replace(':', 'h')} à {heure2.replace(':', 'h')}")
            entetes.append(
                f'<th scope="col"{classe}>'
                f'<a class="jour-entier" href="{plage}'
                f'&amp;annee={annee_iso}&amp;semaine={semaine_iso}" '
                f'data-modale="{plage}" title="{html.escape(titre)}">'
                f'{horaires.JOURS[date.weekday()]}'
                f'<span class="jour-date">{date:%d/%m}</span></a>{mention}</th>')
        lignes = []
        for index, minute in enumerate(grille["minutes"]):
            cellules = []
            for jour in grille["jours"]:
                cellule = jour["cellules"][index]
                if cellule["type"] == "couverte":
                    continue        # avalée par la tuile qui la surplombe
                if cellule["type"] == "tuile":
                    cellules.append(self._case_tuile(cellule, pas))
                else:
                    cellules.append(self._case_libre(cellule, jour, minute,
                                                     pas, cible))
            etiquette = horaires.heure_hhmm(minute) if minute % 60 == 0 else ""
            classe_ligne = ' class="heure-pleine"' if minute % 60 == 0 else ""
            lignes.append(f'<tr{classe_ligne}><th scope="row">{etiquette}</th>'
                          + "".join(cellules) + "</tr>")
        poses = sum(len(jour["rendezvous"]) for jour in grille["jours"])
        superposes = ""
        if grille["superposes"]:
            elements = "".join(
                f'<li>{html.escape(rdv["nom"])} — {_date_lisible(rdv["horaire"])} '
                f'(<a href="/rendezvous?id={rdv["id"]}">voir la fiche</a>)</li>'
                for rdv in grille["superposes"])
            superposes = ('<div class="erreurs"><strong>Rendez-vous superposés '
                          "(ils ne tiennent pas dans la grille, rien n'est "
                          f"caché) :</strong><ul>{elements}</ul></div>")
        # LE BOUTON DE SEMAINE, aligné à droite du titre (demande du
        # propriétaire, 02/08/2026). Il n'ouvre PAS une campagne : il ouvre
        # une fenêtre qui demande d'abord qui contacter — toute la semaine,
        # ou des jours choisis. Il n'apparaît que s'il y a quelque chose à
        # rappeler : proposer de rappeler une semaine vide serait creux.
        bouton_rappel = ""
        if poses:
            bouton_rappel = (
                '<button type="button" class="creation" '
                f'data-modale="/suivi/detail?rappel=semaine&amp;lundi={lundi:%Y-%m-%d}'
                f'&amp;annee={lundi.isocalendar()[0]}&amp;semaine={lundi.isocalendar()[1]}" '
                'title="Ouvre une fenêtre : toute la semaine, ou des jours '
                'choisis — aucun appel n\'est passé">🔔 Créer une campagne de '
                "rappel</button>")
        return f"""<div class="entete-section">
<h2>Semaine du {lundi:%d/%m/%Y} au {dimanche:%d/%m/%Y}
— {poses} rendez-vous</h2>{bouton_rappel}</div>
<table class="planning"><caption class="sourd">Une case = une tranche de
{pas} minutes, le même découpage que la semaine type des réglages ; les
cases vertes sont libres, les tuiles sont les rendez-vous posés.
Cliquez le NOM D'UN JOUR pour le choisir en entier, sans avoir à le
parcourir au glissé.</caption>
<tr><th scope="col">heure</th>{''.join(entetes)}</tr>
{''.join(lignes)}
</table>
<p class="mini"><span class="pave-legende libre"></span> tranche libre —
<span class="pave-legende ferme"></span> fermé (hors horaires d'ouverture ou
jour fermé) — les tuiles colorées sont les rendez-vous <strong>prévus</strong>
et <strong>confirmés</strong> : ce sont les seuls qui occupent une place.
Un rendez-vous annulé, déplacé, manqué ou ignoré a rendu ses tranches, il
n'apparaît donc pas ici mais dans la liste ci-dessous.</p>
{superposes}
{self._bloc_sorties_du_planning(lundi, dimanche)}"""

    def _bloc_sorties_du_planning(self, lundi, dimanche):
        """CE QUI A QUITTÉ LE PLANNING CETTE SEMAINE — et pourquoi.

        ⚠ SON SIGNALEMENT DU 20/08/2026 : « la troisième a disparu, elle n'est
        plus présente dans le calendrier de la page rendez-vous ». Elle n'avait
        pas disparu : son rendez-vous était ANNULÉ, elle l'avait demandé pendant
        l'appel. Mais la grille ne montre que ce qui OCCUPE une place, et la
        page n'offrait AUCUN autre endroit où le retrouver.

        ⚠ ET LA LÉGENDE LE PROMETTAIT DÉJÀ — « il n'apparaît donc pas ici mais
        dans les listes ci-dessous » — alors qu'il n'y avait aucune liste en
        dessous. Une promesse d'écran non tenue coûte plus cher qu'un silence :
        elle l'a envoyé chercher, et il n'a rien trouvé.

        ⚠ REPLIÉE, ET LE COMPTE DEHORS. Mesuré sur sa base : 312 rendez-vous
        hors planning pour la seule semaine du 17/08 (l'empilement de ses
        essais). Dépliée d'office, elle noierait la grille ; cachée sans
        compte, elle ne dirait pas qu'il y a quelque chose à voir.
        """
        base = self.application.base
        fin = dimanche + datetime.timedelta(days=1)
        sorties = base.sorties_du_planning(lundi.isoformat(), fin.isoformat())
        if not sorties:
            return ""
        lignes = []
        for rdv in sorties:
            raison = rdv.get("raison") or ""
            campagne = ""
            if rdv.get("campagne_id"):
                campagne = (f' — <a href="/campagne?id={rdv["campagne_id"]}">'
                            f'{html.escape(rdv["campagne_nom"] or "sa campagne")}'
                            "</a>")
            lignes.append(
                f"""<tr>
  <td>{_date_lisible(rdv['horaire'])}</td>
  <td><a href="/rendezvous?id={rdv['id']}">{html.escape(rdv['nom'])}</a></td>
  <td><span class="pastille {CLASSES_STATUT.get(rdv['statut'], '')}">
      {html.escape(rdv['statut'])}</span></td>
  <td>{html.escape(raison) or '<span class="sourd">—</span>'}{campagne}</td>
</tr>""")
        return f"""<details class="carte sorties-planning">
<summary>🗂 {len(sorties)} rendez-vous ne sont <strong>plus au planning</strong>
cette semaine — annulés, déplacés, manqués ou ignorés</summary>
<p class="mini">Ils ont rendu leur place, ils ne sont donc pas dans la grille.
Rien n'est perdu : chacun garde sa fiche, et la colonne « pourquoi » dit ce qui
l'a fait sortir.</p>
<table><tr><th>Quand</th><th>Qui</th><th>Statut</th><th>Pourquoi</th></tr>
{''.join(lignes)}</table>
</details>"""

    def _case_tuile(self, cellule, pas):
        """UNE tuile pour UN rendez-vous, même s'il occupe plusieurs tranches."""
        rdv = cellule["rdv"]
        classe = CLASSES_STATUT.get(rdv["statut"], "")
        debut, fin = cellule["debut"], cellule["fin"]
        infobulle = (f'{rdv["nom"]} — {rdv["motif"]} — de {debut:%Hh%M} à '
                     f'{fin:%Hh%M} ({horaires.tranches_lisibles(cellule["tranches"], pas)})')
        alerte = " ⚠" if cellule["tronquee"] else ""
        # ⚠ LA COCHE DES CONFIRMÉS (demande du propriétaire, 11/08/2026). La
        # tuile portait la couleur du statut, et la couleur seule ne dit rien à
        # qui ne la connaît pas — c'est la règle du produit : « la couleur ne
        # porte jamais seule ». La coche se voit ; et le MOT « confirmé » est
        # dans l'infobulle, parce qu'un pictogramme ne remplace pas un mot.
        confirme = ""
        if rdv["statut"] == "confirmé":
            confirme = '<span class="coche-confirme" aria-hidden="true">✅</span>'
            infobulle += " — confirmé"
        # La tuile est minuscule : le badge complet n'y tiendrait pas. Le 🧪
        # est donc collé au nom, et l'infobulle dit en toutes lettres
        # pourquoi (la modale, elle, porte le badge entier).
        if rdv.get("numero_essai"):
            alerte += f" {essai_reel.MARQUE}"
            infobulle += " — " + essai_reel.PHRASE_MARQUE
        # « data-quand » : l'horaire de la case, en ISO. C'est par lui que le
        # glisser calcule la plage sélectionnée — jamais par une position à
        # l'écran, qui changerait au premier retri.
        return (f'<td class="tuile" rowspan="{cellule["hauteur"]}" '
                f'data-quand="{debut.isoformat(timespec="minutes")}" '
                f'data-contenu="rendezvous" '
                f'data-modale="/suivi/detail?rdv={rdv["id"]}" '
                f'title="{html.escape(infobulle)}">'
                f'<a class="tuile-int {classe}" href="/rendezvous?id={rdv["id"]}">'
                f'{confirme}<strong>{html.escape(rdv["nom"])}</strong>{alerte}'
                f'<span class="tuile-heure"> {debut:%Hh%M}</span></a></td>')

    def _case_libre(self, cellule, jour, minute, pas, cible=None):
        """Une case libre (verte) ou fermée — la couleur ne porte jamais seule."""
        debut = cellule["debut"]
        classes = ["libre"] if cellule["type"] == "libre" else ["ferme"]
        if cellule.get("revolue"):
            classes.append("revolue")
        if cible is not None and debut == cible:
            classes.append("cible")
        if cellule["type"] == "libre" and not cellule.get("revolue"):
            etat, ouvrable = "libre", True
        elif cellule["type"] == "libre":
            etat, ouvrable = "libre, déjà passé", False
        elif jour["ferme"] is not None:
            etat, ouvrable = "jour fermé", False
        else:
            etat, ouvrable = "hors horaires d'ouverture", False
        infobulle = (f'{horaires.JOURS[jour["date"].weekday()]} '
                     f'{jour["date"]:%d/%m} {horaires.heure_lisible(minute)} — {etat}')
        ouverture = ""
        if ouvrable:
            ouverture = ('data-modale="/suivi/detail?creneau='
                         f'{urllib.parse.quote(debut.isoformat(timespec="minutes"))}" ')
        # « data-contenu » dit ce que la case porte, en un mot : c'est ce que
        # le menu de plage compte pour proposer une campagne plutôt qu'une
        # autre. « libre » ne vaut que pour une place RÉELLEMENT proposable :
        # une place déjà passée ne se propose pas.
        contenu = "libre" if ouvrable else "rien"
        return (f'<td class="{" ".join(classes)}" {ouverture}'
                f'data-quand="{debut.isoformat(timespec="minutes")}" '
                f'data-contenu="{contenu}" '
                f'title="{html.escape(infobulle)}">'
                f'<span class="lecture-seule">{etat}</span></td>')

    # ============================ SÉLECTIONNER UNE PLAGE DU PLANNING
    # Demande du propriétaire du 03/08/2026 : on glisse sur la grille des
    # rendez-vous, et au relâché un menu propose ce qu'on peut faire de la
    # plage choisie.
    #
    # ⚠ LA PLAGE EST UN RECTANGLE JOURS × HEURES depuis le 09/08/2026 — « du
    # lundi au mercredi, de 9h00 à 10h15 ». C'était une PÉRIODE continue : le
    # même geste ramassait alors les après-midi et les nuits entre les deux
    # bouts, et la demande était impossible à exprimer.
    #
    # ⚠ LES TROIS VOIES DISENT LA MÊME CHOSE, et c'est la condition pour que
    # ce sens tienne : le glissé, le formulaire de repli sans JavaScript et
    # cette lecture-ci. Le commentaire d'origine avertissait déjà que « deux
    # sens pour un même geste finissent toujours par se contredire ».
    #
    # ⚠ LA DERNIÈRE CASE EST COMPRISE. On relâche SUR une case : elle est
    # prise. Le formulaire de repli le dit noir sur blanc, sinon les deux
    # voies donneraient deux plages différentes pour la même saisie.
    #
    # Une zone = (jour de début, jour de fin, heure de début, heure de fin).
    # Plusieurs zones = un Ctrl + glissé répété.
    ZONES_MAX = 20

    @staticmethod
    def _lire_zone(texte):
        """« 2026-08-10|2026-08-12|09:00|10:15 » → (date, date, time, time).

        Rend None si quoi que ce soit est illisible : une zone à moitié
        comprise vaudrait moins que pas de zone du tout.
        """
        morceaux = [part.strip() for part in (texte or "").split("|")]
        if len(morceaux) != 4 or not all(morceaux):
            return None
        try:
            jour1 = datetime.date.fromisoformat(morceaux[0])
            jour2 = datetime.date.fromisoformat(morceaux[1])
            heure1 = datetime.time.fromisoformat(morceaux[2])
            heure2 = datetime.time.fromisoformat(morceaux[3])
        except ValueError:
            return None
        # On glisse dans les quatre sens : le coin d'arrivée peut être avant
        # celui de départ, sur l'un des deux axes ou sur les deux.
        if jour2 < jour1:
            jour1, jour2 = jour2, jour1
        if heure2 < heure1:
            heure1, heure2 = heure2, heure1
        return (jour1, jour2, heure1, heure2)

    def _zones_de_plage(self, parametres):
        """Les rectangles demandés, dans l'ordre, sans doublon.

        Deux écritures, une seule signification : « zone=j1|j2|h1|h2 » répété
        (ce qu'envoie le glissé), ou les quatre champs séparés du formulaire
        de repli — celui-ci n'a pas de JavaScript pour les assembler, et il
        doit marcher sans.
        """
        zones = []
        for brut in parametres.get("zone", [])[:self.ZONES_MAX]:
            zone = self._lire_zone(brut)
            if zone and zone not in zones:
                zones.append(zone)
        if zones:
            return zones
        zone = self._lire_zone("|".join((
            parametres.get("jour1", [""])[0], parametres.get("jour2", [""])[0],
            parametres.get("heure1", [""])[0],
            parametres.get("heure2", [""])[0])))
        return [zone] if zone else []

    def _inventaire_plage(self, zones):
        """Ce que contiennent ces rectangles : (places libres, rendez-vous).

        ⚠ AUCUNE NOUVELLE MÉCANIQUE : les places libres viennent de
        `horaires.tranches_libres_du_jour`, qui est déjà LA source du produit
        (ouvert − déjà pris − jours fermés), et les rendez-vous de
        `base.rendezvous_de_periode`, source du planning. Un second calcul
        aurait fini par ne plus dire la même chose que la grille affichée.

        ⚠ ON DÉDOUBLONNE : deux zones peuvent se chevaucher (rien ne l'interdit
        au Ctrl + glissé), et compter deux fois la même place ferait annoncer
        « 8 places » là où il y en a 5.
        """
        base = self.application.base
        preferences = self.application.preferences
        maintenant = datetime.datetime.now()
        places, rendezvous, vus = set(), [], set()
        for jour1, jour2, heure1, heure2 in zones:
            jour = jour1
            while jour <= jour2:
                for tranche in horaires.tranches_libres_du_jour(
                        base, preferences, jour):
                    # Une place déjà passée ne se propose pas : elle est
                    # visible sur la grille, mais grisée et non cliquable.
                    if (heure1 <= tranche.time() <= heure2
                            and tranche > maintenant):
                        places.add(tranche)
                debut = datetime.datetime.combine(jour, heure1)
                fin = (datetime.datetime.combine(jour, heure2)
                       + datetime.timedelta(minutes=1))
                # ⚠ LES MÊMES STATUTS QUE LA GRILLE, ET C'EST TOUT L'ENJEU
                # (17/08/2026). L'appel était fait SANS filtre : il ramassait
                # donc aussi les « supprimé », « annulé » et « déplacé » — des
                # lignes que le planning ne montre PAS.
                #
                # MESURÉ DANS SA BASE : un rectangle d'une journée (07/09, de
                # 8 h à 19 h) montrait 13 rendez-vous à l'écran et en chargeait
                # 89 dans la campagne, dont 76 « supprimé ». Il sélectionnait
                # une demi-journée et se retrouvait avec « plein de contacts »
                # qu'il n'avait jamais vus. Les fantômes venaient de ses
                # réimports d'agenda : chaque import remplace le rendez-vous du
                # même créneau et laisse l'ancien en « supprimé ».
                #
                # Le pavé au-dessus de cette fonction promettait déjà « la
                # source du planning » — la fonction était bien la bonne, le
                # FILTRE manquait. `horaires.STATUTS_OCCUPANTS` est ce que la
                # grille demande (`horaires.grille_semaine`) : un seul endroit
                # décide, les deux écrans disent la même chose.
                for rdv in base.rendezvous_de_periode(
                        debut.isoformat(timespec="minutes"),
                        fin.isoformat(timespec="minutes"),
                        statuts=horaires.STATUTS_OCCUPANTS):
                    if rdv["id"] not in vus:
                        vus.add(rdv["id"])
                        rendezvous.append(rdv)
                jour += datetime.timedelta(days=1)
        return sorted(places), rendezvous

    @staticmethod
    def _zone_lisible(zone):
        """« du lundi 10/08 au mercredi 12/08, de 09h00 à 10h15 »."""
        jour1, jour2, heure1, heure2 = zone
        # Une zone d'UNE SEULE case — un Ctrl + clic — disait « de 09h00 à
        # 09h00 ». Exact, et illisible.
        heures = (f"à {heure1:%Hh%M}" if heure1 == heure2
                  else f"de {heure1:%Hh%M} à {heure2:%Hh%M}")
        if jour1 == jour2:
            return (f"le {horaires.JOURS[jour1.weekday()]} {jour1:%d/%m}, "
                    f"{heures}")
        return (f"du {horaires.JOURS[jour1.weekday()]} {jour1:%d/%m} "
                f"au {horaires.JOURS[jour2.weekday()]} {jour2:%d/%m}, "
                f"{heures}")

    def _plage_lisible(self, zones):
        """Les zones, en toutes lettres — la couleur ne porte jamais seule."""
        if len(zones) == 1:
            return self._zone_lisible(zones[0])
        return (f"sur {len(zones)} zones — "
                + " ; ".join(self._zone_lisible(zone) for zone in zones))

    @staticmethod
    def _retour_planning(parametres):
        """L'adresse du planning à REVENIR, sur la semaine d'où l'on vient.

        L'année et la semaine voyagent déjà avec chaque plage (voir
        `_repli_plage`) : le retour retombe donc sur la grille qu'il regardait,
        pas sur la semaine courante.
        """
        annee = (parametres.get("annee", [""])[0] or "").strip()
        semaine = (parametres.get("semaine", [""])[0] or "").strip()
        if annee.isdigit() and semaine.isdigit():
            return f"/suivi?annee={annee}&semaine={semaine}"
        return "/suivi"

    def _reponse_plage(self, titre, corps, parametres, code=200):
        """LA réponse d'une plage — fenêtre si on vient de la fenêtre, PAGE sinon.

        ⚠ LA RÈGLE EXISTAIT DÉJÀ AILLEURS, elle manquait ICI. `_erreur` répond
        une page entière avec « ← Retour aux rendez-vous », et
        `_page_sans_numero` fait pareil : dans tout le produit, un refus laisse
        un chemin. Les quatre réponses de plage, elles, renvoyaient une fenêtre
        NUE, quel que soit le demandeur.

        CE QUE ÇA A COÛTÉ, le 17/08/2026 : ses trois formulaires de plage sont
        de vrais envois de formulaire (pas des envois de fenêtre — ils n'ont
        pas `data-modale-envoi`), et le refus « aucun numéro utilisable »
        arrivait donc en pleine page : fond blanc, aucun lien, aucun menu, et
        un bouton « Fermer ✕ » qui ne pouvait rien fermer puisqu'il n'y avait
        plus de page dessous. C'est l'écran sur lequel il est resté bloqué.
        Le même chemin sert le repli « Sans glisser », qui est le SEUL moyen de
        choisir une plage sans souris — donc au doigt, sur téléphone.

        Un seul endroit décide, pour les quatre réponses : le panneau de plage
        et ses trois refus.
        """
        if self._depuis_modale():
            return self._repondre(
                self._modale(titre, corps, classe=" modale-laterale"), code)
        retour = html.escape(self._retour_planning(parametres))
        page = self._page(titre, f"""{self._bandeau()}
<p><a href="{retour}">← Retour au planning</a></p>
<h1>{html.escape(titre)}</h1>
{corps}""", actif="suivi")
        return self._repondre(page, code)

    def _modale_plage(self, parametres):
        """LE MENU LATÉRAL d'une plage sélectionnée.

        ⚠ C'EST LA FENÊTRE QUI EXISTE DÉJÀ, posée sur le côté par le style.
        Elle apporte gratuitement ce qu'un volet neuf aurait fallu réécrire :
        fermeture au clic extérieur, sur la croix et à Échap, role=dialog, et
        le renvoi d'un refus avec les valeurs tapées.

        Sans JavaScript — ou au doigt, par le repli « Sans glisser » — la même
        chose arrive en PAGE entière : voir `_reponse_plage`.
        """
        zones = self._zones_de_plage(parametres)
        if not zones:
            return self._reponse_plage("Plage illisible",
                                       "<p>Cette plage n'a pas pu être lue. "
                                       "Recommencez la sélection sur la "
                                       "grille, ou saisissez les quatre "
                                       "valeurs (du jour, au jour, de telle "
                                       "heure à telle heure).</p>",
                                       parametres)
        places, rendezvous = self._inventaire_plage(zones)
        # Ce que la plage contient, dit en chiffres AVANT de proposer quoi que
        # ce soit : on ne propose pas une campagne sans dire sur quoi.
        #
        # ⚠ ET C'EST TOUT CE QUI RESTE EN TEXTE (demande du propriétaire,
        # 10/08/2026) : plus de liste des places, plus d'explication sous
        # chaque bouton, plus de rappel « personne n'est appelé ». Quatre
        # libellés qui disent où l'on va, et rien de plus — c'est l'assistant
        # qui explique, à l'étape suivante, en contexte.
        compte = (f"<p><strong>{len(places)} place(s) libre(s)</strong> et "
                  f"<strong>{len(rendezvous)} rendez-vous</strong> "
                  f"{html.escape(self._plage_lisible(zones))}.</p>")
        # ⚠ QUI NE SERA PAS APPELÉ, DIT ICI (défaut n° 7 du 18/08/2026). Cette
        # fenêtre annonçait un nombre de rendez-vous et se taisait sur ceux
        # qu'aucune campagne ne pourra joindre : il choisissait sa campagne
        # sans le savoir, et ne l'apprenait qu'à l'écran suivant. Le tri est
        # celui-là même que la campagne appliquera — voir
        # `_trier_les_rendezvous` : les deux écrans ne peuvent pas diverger.
        _, a_completer, stop, doublons = self._trier_les_rendezvous(
            [rdv["id"] for rdv in rendezvous])
        compte += self._ligne_ecartes(a_completer, stop, doublons)
        if places:
            caches = "".join(
                f'<input type="hidden" name="creneau" '
                f'value="{place.isoformat(timespec="minutes")}">'
                for place in places)
            bloc_libre = f"""<form method="post" action="/suivi/plage/creneau-libere">
  {caches}
  <input type="hidden" name="annee"
         value="{html.escape(parametres.get("annee", [""])[0])}">
  <input type="hidden" name="semaine"
         value="{html.escape(parametres.get("semaine", [""])[0])}">
  <button>📞 Campagne pour remplir les créneaux libres</button>
</form>"""
        else:
            # Le bouton ne DISPARAÎT pas en silence : une ligne dit pourquoi.
            bloc_libre = ('<p class="sourd"><small>📞 Aucune place libre à '
                          "venir dans cette plage.</small></p>")
        # ⚠ LES TROIS CAMPAGNES DE RENDEZ-VOUS (10/08/2026). Elles n'existent
        # que si la plage en contient : sans rendez-vous, on le dit au lieu de
        # montrer trois boutons qui refuseraient.
        if rendezvous:
            caches_rdv = "".join(
                f'<input type="hidden" name="rdv" value="{rdv["id"]}">'
                for rdv in rendezvous)
            # ⚠ LA SEMAINE VOYAGE AVEC LES TROIS, comme avec « créneau libéré »
            # juste au-dessus. Sans elle, un refus ne savait pas sur quelle
            # semaine renvoyer et retombait sur la semaine courante — celle
            # qu'il regardait était perdue.
            semaine_cachee = f"""
  <input type="hidden" name="annee"
         value="{html.escape(parametres.get("annee", [""])[0])}">
  <input type="hidden" name="semaine"
         value="{html.escape(parametres.get("semaine", [""])[0])}">"""
            blocs = []
            for nature, signe, titre in self.CAMPAGNES_DE_PLAGE:
                blocs.append(f"""<form method="post"
      action="/suivi/plage/{nature.replace("_", "-")}">
  {caches_rdv}{semaine_cachee}
  <button>{signe} {html.escape(titre)}</button>
</form>""")
            bloc_deplacement = "".join(blocs)
        else:
            bloc_deplacement = ('<p class="sourd"><small>📆 🔔 ✅ Aucun '
                                "rendez-vous dans cette plage.</small></p>")
        return self._reponse_plage(
            "Plage sélectionnée",
            f"{compte}{bloc_libre}{bloc_deplacement}",
            parametres)

    @staticmethod
    def _creneau_lisible_serveur(quand):
        """« mercredi 12/08 à 09h00 » — pour une plage lue à l'écran."""
        return (f"{horaires.JOURS[quand.weekday()]} {quand:%d/%m} "
                f"à {quand:%Hh%M}")

    # Les trois campagnes qu'une plage de rendez-vous peut ouvrir. Le code est
    # la nature de l'assistant ; le reste n'est que ce qui s'affiche.
    #
    # ⚠ PLUS D'EXPLICATION SOUS LES BOUTONS (demande du propriétaire,
    # 10/08/2026) : « D'une manière générale fais attention car tu as tendance
    # à mettre beaucoup d'information. Trop d'information perd les
    # utilisateurs. » Le libellé dit ce que fait le bouton ; ce que fait la
    # campagne, l'assistant le montre à l'étape suivante, en contexte.
    CAMPAGNES_DE_PLAGE = (
        ("deplacement", "📆", "Campagne pour déplacer les rendez-vous"),
        ("rappel_rdv", "🔔", "Campagne pour rappeler les rendez-vous"),
        ("confirmation", "✅", "Campagne pour confirmer les rendez-vous"),
    )

    def _trier_les_rendezvous(self, identifiants):
        """Ce que la plage donne : (retenus, à compléter, 🚫 exclus, doublons).

        - `retenus` : [(rendez-vous, téléphone)] — le téléphone peut être VIDE.
        - `a_completer` : {client: nom} de ceux dont le numéro manque.
        - `stop` : {client: nom} de ceux marqués 🚫 « Ne plus appeler ».
        - `doublons` : combien de rendez-vous ne donnent pas un contact de plus,
          leur numéro étant déjà pris — comptés par LIGNE, eux.

        ⚠ UNE PERSONNE SANS NUMÉRO ENTRE DANS LA LISTE (18/08/2026, sa
        demande). Elle en était ÉCARTÉE avant même la grille : il sélectionnait
        quatre rendez-vous sur son planning et n'en retrouvait que trois à
        l'étape 3, sans pouvoir rien y faire. Or la grille sait justement
        corriger un numéro en tapant, et elle REFUSE de se valider tant qu'une
        case obligatoire est vide : c'est l'endroit prévu pour ça. Écarter en
        amont, c'était lui retirer le seul geste qui règle le problème.

        ⚠ ET LES 🚫 SONT COMPTÉS ICI AUSSI. Ils sont exclus plus loin, à la
        création de la campagne (`creer_campagne_prete`), et personne ne le
        disait avant : sur sa matinée du 20/08, deux personnes sur trois
        étaient 🚫 et la campagne n'appelait qu'un seul contact — il a conclu
        que le déplacement ne marchait pas. Trois raisons d'écarter quelqu'un,
        il n'en voyait aucune.
        """
        base = self.application.base
        retenus, a_completer, stop, doublons, vus = [], {}, {}, 0, set()
        for rdv_id in identifiants:
            rdv = base.obtenir_rendezvous(rdv_id)
            if rdv is None:
                continue
            telephone = base.telephone_de(rdv["client_id"]) or ""
            if rdv.get("ne_plus_appeler"):
                stop[rdv["client_id"]] = rdv["nom"]
            if not telephone:
                # Une personne, une ligne : une plage peut porter DEUX
                # rendez-vous de la même, et deux lignes à compléter pour une
                # seule fiche seraient deux fois le même travail.
                if rdv["client_id"] in a_completer:
                    continue
                a_completer[rdv["client_id"]] = rdv["nom"]
                retenus.append((rdv, ""))
                continue
            if telephone in vus:
                doublons += 1
                continue
            vus.add(telephone)
            retenus.append((rdv, telephone))
        return retenus, a_completer, stop, doublons

    @staticmethod
    def _ligne_ecartes(a_completer, stop, doublons):
        """Ce qui n'ira pas droit aux appels — ou "" s'il n'y a rien à dire.

        ⚠ LES TROIS RAISONS, PAS DEUX. Un rendez-vous de la plage peut ne pas
        donner un appel pour trois motifs, et ils n'appellent pas le même
        geste : le numéro MANQUE (à taper dans la grille), la personne est
        🚫 « Ne plus appeler » (rien à faire, sinon lever le drapeau), ou son
        numéro est déjà dans la liste (une seule personne sera appelée). N'en
        annoncer que deux, c'est laisser le troisième surprendre — c'est ce
        qui lui a fait croire, le 18/08/2026, que le déplacement ne marchait
        pas.
        """
        def _noms(gens):
            noms = sorted(gens.values())
            cites = ", ".join(html.escape(nom) for nom in noms[:3])
            return cites + (f" et {len(noms) - 3} autre(s)"
                            if len(noms) > 3 else "")

        morceaux = []
        if a_completer:
            combien = len(a_completer)
            morceaux.append(
                (f"<strong>{combien} personne sans numéro</strong> : son "
                 "numéro est à compléter dans la grille de l'étape 3"
                 if combien == 1 else
                 f"<strong>{combien} personnes sans numéro</strong> : leurs "
                 "numéros sont à compléter dans la grille de l'étape 3")
                + f" — {_noms(a_completer)}")
        if stop:
            # ⚠ LE TEXTE SUIT L'ÉTAT (20/08/2026). « Elle ne sera pas appelée »
            # était devenu à moitié faux : l'agent ne l'appelle pas, mais elle
            # ne disparaît plus pour autant — elle attend qu'un humain la
            # rappelle. Le laisser tel quel lui aurait fait croire que ces
            # personnes étaient perdues, alors qu'elles l'attendent dans
            # 🔁 Relances.
            combien = len(stop)
            morceaux.append(
                (f"<strong>{combien} personne marquée 🚫 « Ne plus "
                 "appeler »</strong> : l'agent ne l'appellera pas — elle "
                 "partira vers un rappel par un humain"
                 if combien == 1 else
                 f"<strong>{combien} personnes marquées 🚫 « Ne plus "
                 "appeler »</strong> : l'agent ne les appellera pas — elles "
                 "partiront vers un rappel par un humain")
                + f" — {_noms(stop)}")
        if doublons:
            morceaux.append(f"<strong>{doublons} rendez-vous</strong> dont le "
                            "numéro est déjà dans la liste (une seule personne "
                            "sera appelée)")
        if not morceaux:
            return ""
        return ('<p class="sourd"><small>⚠ À savoir avant de choisir — '
                + " ; ".join(morceaux)
                + '. <a href="/sans-numero">✎ Compléter les numéros '
                  "manquants</a> · <a href=\"/clients\">👥 Contacts</a>"
                  "</small></p>")

    def _campagne_depuis_plage(self, corps, nature):
        """PLUSIEURS personnes, celles des rendez-vous de la plage.

        ⚠ MÊMES REFUS QUE PARTOUT AILLEURS : un contact sans numéro ne peut
        pas être appelé, et deux fois le même numéro serait deux appels chez la
        même personne. On les ÉCARTE en les comptant, et l'écran le dit — les
        taire aurait fait croire à une liste complète.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        base = self.application.base
        identifiants = []
        for brut in donnees.get("rdv", []):
            try:
                identifiants.append(int(brut))
            except ValueError:
                continue
        if not identifiants:
            return self._reponse_plage(
                "Aucun rendez-vous",
                "<p>Cette plage ne contient aucun rendez-vous à traiter.</p>",
                donnees, 400)
        identifiant = self.application.creer_brouillon_assistant(nature)
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        codes = {champ["code"]
                 for champ in assistant.champs_campagne(brouillon)}
        # ⚠ LES SANS-NUMÉRO SE COMPTENT PAR PERSONNE (14/08/2026, audit croisé).
        # Une plage du planning peut contenir DEUX rendez-vous de la même
        # personne : le compteur en annonçait deux, et l'écran disait donc
        # « 2 rendez-vous sans numéro » là où une seule fiche était à compléter.
        # Les doublons, eux, se comptent bien par ligne : c'est le nombre de
        # rendez-vous de la plage qui ne donnent pas un contact de plus.
        retenus, a_completer, stop, doublons = self._trier_les_rendezvous(
            identifiants)
        # ⚠ SA DEMANDE DU 20/08/2026 : sur une CONFIRMATION, un rendez-vous
        # déjà confirmé n'entre pas — le rappeler pour confirmer n'apporterait
        # rien. Le filtre est celui du produit (`ecarter_les_deja_confirmes`),
        # appliqué ici sur les rendez-vous de la plage.
        deja_confirmes = 0
        if nature == "confirmation":
            gardes = []
            for rdv, telephone in retenus:
                if rdv["statut"] == "confirmé":
                    deja_confirmes += 1
                    continue
                gardes.append((rdv, telephone))
            retenus = gardes
        contacts = []
        for rdv, telephone in retenus:
            valeurs = {}
            if "rdv_existant" in codes:
                valeurs["rdv_existant"] = rdv["horaire"]
            if "motif" in codes:
                valeurs["motif"] = rdv["motif"]
            contacts.append({"nom": rdv["nom"], "telephone": telephone,
                             "champs": valeurs, "rendezvous_id": rdv["id"]})
        if not contacts:
            # Plus aucun rendez-vous lisible : ceux de la plage ont disparu
            # entre la sélection et le clic (fiche supprimée, réimport).
            return self._reponse_plage(
                "Plus aucun rendez-vous",
                "<p>Les rendez-vous de cette plage n'existent plus. "
                "Recommencez votre sélection sur le planning.</p>",
                donnees, 409)
        brouillon["contacts"] = contacts
        # ⚠ « planning » : la liste vient d'une plage choisie à la main, donc
        # elle n'est pas rejouable sur un autre créneau — la recette le dit au
        # lieu d'inventer une liste au maillon suivant.
        assistant.noter_apport_recette(brouillon, "planning")
        # ⚠ CE QUI RESTE À FAIRE, ET CE QUI EST ÉCARTÉ — dit ici aussi, avec
        # les MÊMES mots que la fenêtre de plage : il traverse les deux écrans
        # à la suite, et deux comptes différents lui feraient chercher l'erreur.
        precisions = []
        if a_completer:
            precisions.append(
                f"{len(a_completer)} numéro(s) à compléter dans la grille")
        if stop:
            precisions.append(f"{len(stop)} personne(s) 🚫 « Ne plus appeler », "
                              "qui partiront vers un rappel par un humain")
        if deja_confirmes:
            precisions.append(assistant.phrase_deja_confirmes(deja_confirmes))
        if doublons:
            precisions.append(f"{doublons} rendez-vous en doublon de numéro "
                              "écarté(s)")
        brouillon["message"] = (
            f"{len(contacts)} personne(s) reprise(s) de la plage choisie sur le "
            "planning"
            + (f" — {', '.join(precisions)}." if precisions else ".")
            + " Personne n'est appelé : vous traversez les trois étapes.")
        journal.info("Planning → assistant : campagne « %s » depuis une plage "
                     "(%d contact(s), dont %d à compléter ; %d 🚫, %d doublon(s) "
                     "écarté(s)) — aucun appel", nature, len(contacts),
                     len(a_completer), len(stop), doublons)
        return self._rediriger(f"/assistant/message?b={identifiant}")

    def _traiter_plage_creneau_libere(self, corps):
        """Ouvre l'assistant sur une campagne « créneau libéré » multi-places.

        ⚠ ON N'APPELLE PERSONNE et on ne crée AUCUNE campagne ici : on ouvre
        un brouillon d'assistant, avec les places déjà posées. L'opérateur
        traverse les trois étapes comme d'habitude — c'est lui qui décide.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        places = assistant.normaliser_creneaux(donnees.get("creneau", []))
        if not places:
            return self._reponse_plage(
                "Aucune place",
                "<p>Cette plage ne contient aucune place libre à proposer.</p>",
                donnees, 400)
        identifiant = self.application.creer_brouillon_assistant(
            "creneau_libere",
            infos_initiales={"creneau_libere": places[0]["horaire"]})
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        brouillon["creneaux"] = places
        journal.info("Planning : plage sélectionnée → brouillon d'assistant "
                     "avec %d place(s) — aucun appel", len(places))
        return self._rediriger(f"/assistant/message?b={identifiant}")

    def _jours_avec_rendezvous(self, lundi):
        """[(date, libellé, nombre)] des jours de la semaine qui ont du monde.

        Même source que le compte affiché dans l'entête (la grille de la
        semaine) : deux sources donneraient deux chiffres qui se
        contrediraient à l'écran.
        """
        grille = horaires.grille_semaine(self.application.base,
                                         self.application.preferences, lundi)
        jours = []
        for jour in grille["jours"]:
            combien = len(jour["rendezvous"])
            if not combien:
                continue
            date = jour["date"]
            jours.append((date, f"{horaires.JOURS[date.weekday()]} "
                                f"{date:%d/%m}", combien))
        return jours

    def _modale_rappel_semaine(self, parametres):
        """« Créer une campagne de rappel pour… » — toute la semaine, ou des jours.

        Demandé par le propriétaire le 02/08/2026. Deux temps, côté serveur :
        on demande d'abord QUI contacter ; la liste des jours n'apparaît
        qu'après avoir choisi « des jours précis » — sans quoi ce serait
        montrer les options d'une option.

        Aucun appel n'est passé ici : le bouton final ouvre l'assistant à
        l'étape ②, la liste déjà remplie.
        """
        brut = parametres.get("lundi", [""])[0]
        try:
            lundi = datetime.date.fromisoformat(brut)
        except ValueError:
            return self._modale("Semaine introuvable",
                                "<p>Cette semaine n'a pas pu être lue.</p>")
        lundi = horaires.lundi_de(lundi)
        jours = self._jours_avec_rendezvous(lundi)
        total = sum(combien for _, _, combien in jours)
        titre = (f"Créer une campagne de rappel pour la semaine du "
                 f"{lundi:%d/%m/%Y}")
        if not jours:
            return self._modale(titre, "<p>Aucun rendez-vous cette "
                                       "semaine-là : il n'y a personne à "
                                       "rappeler.</p>")
        choix_jours = "".join(
            '<div class="ligne-option"><label class="option">'
            f'<input type="checkbox" name="jour" value="{date:%Y-%m-%d}" '
            'checked><span>' + html.escape(libelle)
            + f" — {combien} rendez-vous</span></label></div>"
            for date, libelle, combien in jours)
        return self._modale(titre, f"""
<p>Créer une campagne de rappel pour <strong>la semaine du
{lundi:%d/%m/%Y}</strong> — {total} rendez-vous répartis sur
{len(jours)} jour(s).</p>
<form method="post" action="/suivi/rappel/campagne">
  <input type="hidden" name="lundi" value="{lundi:%Y-%m-%d}">
  <p><strong>Voulez-vous contacter :</strong></p>
  <div class="ligne-option"><label class="option">
    <input type="radio" name="qui" value="semaine" checked
           data-panneau="rappel-toute-la-semaine"><span>les contacts de
    <strong>toute la semaine</strong> ({total} rendez-vous)</span></label></div>
  <div id="rappel-toute-la-semaine"></div>
  <div class="ligne-option"><label class="option">
    <input type="radio" name="qui" value="jours"
           data-panneau="rappel-jours"><span>les contacts de
    <strong>jours choisis</strong></span></label></div>
  <div class="sous-options" id="rappel-jours" hidden>
    {choix_jours}
    <p><small>Seuls les jours qui portent des rendez-vous sont proposés.</small></p>
  </div>
  <p><button class="creation">Monter la campagne — l'assistant s'ouvre à
  l'étape 2, personne n'est appelé</button></p>
</form>""")

    def _traiter_rappel_semaine(self, corps):
        """La campagne 🔔 de rappel bâtie sur une semaine ou des jours choisis.

        La liste est constituée MAINTENANT, sur la période choisie : ce sont
        ces personnes-là qui seront appelées (règle du propriétaire). Les
        clients sans numéro et les 🚫 « ne plus appeler » sont écartés et
        comptés par la même brique que partout ailleurs — aucune règle n'est
        réécrite ici.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            lundi = horaires.lundi_de(
                datetime.date.fromisoformat(donnees.get("lundi", [""])[0]))
        except ValueError:
            return self._erreur(400, "Semaine illisible.")
        if donnees.get("qui", ["semaine"])[0] == "jours":
            jours = []
            for brut in donnees.get("jour", []):
                try:
                    jours.append(datetime.date.fromisoformat(brut))
                except ValueError:
                    continue
            if not jours:
                return self._erreur(
                    409, "Aucun jour coché : choisissez au moins un jour, ou "
                         "revenez à « toute la semaine ».")
            periodes = [(jour, jour + datetime.timedelta(days=1))
                        for jour in sorted(jours)]
            # ⚠ PAS de « %A » : il suit la langue du système et écrivait
            # « Monday 03/08 » sur cette machine. Les noms de jours du
            # produit sont dans horaires.JOURS, en français, une fois.
            quoi = ", ".join(
                f"{horaires.JOURS[jour.weekday()]} {jour:%d/%m}"
                for jour in sorted(jours))
        else:
            periodes = [(lundi, lundi + datetime.timedelta(days=7))]
            quoi = f"la semaine du {lundi:%d/%m/%Y}"
        base = self.application.base
        contacts = []
        vus = set()
        # ⚠ LES ÉCARTÉS SE COMPTENT PAR PERSONNE, PAS PAR JOUR (14/08/2026).
        # Cette boucle appelle la reprise UNE FOIS PAR JOUR coché et
        # additionnait les comptes : quelqu'un qui a un rendez-vous le lundi ET
        # le vendredi était compté deux fois, alors que la liste, elle, le
        # dédoublonnait — l'écran se contredisait tout seul. Les ensembles se
        # réunissent d'un jour à l'autre, et le compte vient de leur taille.
        ecartes = {}
        for debut, fin in periodes:
            bornes = horaires.bornes_de_periode(debut, fin)
            # « poses » : prévus ET confirmés — exactement ce que l'entête du
            # planning compte, et ce que la fenêtre annonce jour par jour.
            # Deux sources différentes donneraient deux chiffres qui se
            # contredisent, et c'est ce qui rendait cette campagne vide.
            lot, _, _ = campagnes.contacts_depuis_rendezvous(
                base, "poses", bornes[0], bornes[1], ecartes=ecartes)
            for contact in lot:
                if contact["telephone"] in vus:
                    continue
                vus.add(contact["telephone"])
                contacts.append(contact)
        sans_numero = len(ecartes.get("sans_numero", ()))
        exclus = len(ecartes.get("stop", ()))
        if not contacts:
            return self._erreur(
                409, "Personne à rappeler sur cette période : les rendez-vous "
                     "trouvés n'ont pas de numéro, ou leurs clients sont "
                     "marqués 🚫 « ne plus appeler ».")
        identifiant = self.application.creer_brouillon_assistant("rappel_rdv")
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        codes = {champ["code"]
                 for champ in assistant.champs_campagne(brouillon)}
        for contact in contacts:
            rdv = base.obtenir_rendezvous(contact["rendezvous_id"])
            valeurs = {}
            if rdv:
                if "rdv_existant" in codes:
                    valeurs["rdv_existant"] = rdv["horaire"]
                if "motif" in codes:
                    valeurs["motif"] = rdv["motif"]
            contact["champs"] = valeurs
        brouillon["contacts"] = contacts
        # Une période DÉSIGNE des dates : rejouer cette liste sur un autre
        # créneau ramènerait les mêmes personnes, pas celles du nouveau.
        # La campagne est donc marquée « choisie à la main ».
        assistant.noter_apport_recette(brouillon, "planning")
        details = [f"{len(contacts)} personne(s) à rappeler pour {quoi}"]
        if sans_numero:
            details.append(f"{sans_numero} sans numéro écarté(s)")
        if exclus:
            details.append(f"{exclus} 🚫 « ne plus appeler » écarté(s)")
        brouillon["message"] = " — ".join(details) + "."
        journal.info("Planning → assistant : campagne « rappel_rdv » sur %s "
                     "(%d contact(s)) — aucun appel", quoi, len(contacts))
        return self._rediriger(f"/assistant/message?b={identifiant}")

    def _modale_planning(self, parametres, valeurs=None, erreurs=None,
                         message=""):
        """Le contenu de la MODALE : détail d'un rendez-vous, ou d'un créneau.

        Rendu en fragment (sans habillage) : la page ne bouge pas, seule la
        modale se remplit. Le numéro y est MASQUÉ comme partout. Le détail
        et l'ÉDITION sont dans la même modale : on ne change jamais d'écran
        pour modifier un rendez-vous. `valeurs`/`erreurs` ramènent une saisie
        refusée dans ses champs, avec ce qui cloche écrit en toutes lettres.
        """
        base = self.application.base
        preferences = self.application.preferences
        pas = horaires.pas_minutes(preferences)
        if parametres.get("rappel", [""])[0] == "semaine":
            return self._modale_rappel_semaine(parametres)
        brut = parametres.get("rdv", [""])[0]
        if brut:
            try:
                rdv = base.obtenir_rendezvous(int(brut))
            except ValueError:
                rdv = None
            if rdv is None:
                return self._modale("Rendez-vous introuvable",
                                    "<p>Ce rendez-vous n'existe plus (supprimé "
                                    "ou base rechargée).</p>")
            debut = datetime.datetime.fromisoformat(rdv["horaire"])
            fin = debut + datetime.timedelta(
                minutes=pas * horaires.duree_tranches(rdv))
            telephone = (html.escape(rdv["telephone_masque"])
                         if rdv["telephone_masque"] else "<em>aucun numéro</em>")
            rappel = ""
            if rdv["rappel_souhaite"]:
                rappel = ("<dt>Rappel souhaité</dt><dd>🔔 "
                          f"{_date_lisible(rdv['rappel_souhaite'])}</dd>")
            corps = f"""<dl>
  <dt>Client</dt><dd>{html.escape(rdv['nom'])}{self._badge_stop(rdv)}{essai_reel.badge(rdv)}</dd>
  <dt>Téléphone</dt><dd>{telephone}</dd>
  <dt>Date</dt><dd>{_date_jour_lisible(debut.date().isoformat())},
    de {debut:%Hh%M} à {fin:%Hh%M}</dd>
  <dt>Durée</dt><dd>{html.escape(horaires.tranches_lisibles(horaires.duree_tranches(rdv), pas))}</dd>
  <dt>Statut</dt><dd>{self._pastille_statut(rdv['statut'])}</dd>
  {self._ligne_origine(rdv['id'])}
  {rappel}
</dl>
{self._gestes_rendezvous(rdv, parametres)}
{self._formulaire_rendezvous(rdv, parametres, valeurs, erreurs, message)}
<p><a class="bouton" href="/rendezvous?id={rdv['id']}">Ouvrir la fiche complète</a>
<a href="/clients/fiche?id={rdv['client_id']}">Voir le client</a></p>"""
            return self._modale("📅 Rendez-vous", corps)
        creneau = parametres.get("creneau", [""])[0]
        try:
            debut = datetime.datetime.fromisoformat(creneau)
        except (TypeError, ValueError):
            return self._modale("Créneau illisible",
                                "<p>Horaire attendu : 2026-09-07T09:00.</p>")
        disponibles = horaires.suite_libre_a_partir_de(base, preferences, debut)
        fin = debut + datetime.timedelta(minutes=pas * max(disponibles, 1))
        corps = f"""<dl>
  <dt>Jour</dt><dd>{_date_jour_lisible(debut.date().isoformat())}</dd>
  <dt>Heure</dt><dd>de {debut:%Hh%M} à {fin:%Hh%M}</dd>
  <dt>Libre d'affilée</dt><dd>{html.escape(horaires.tranches_lisibles(disponibles, pas))}
    à partir de cette tranche</dd>
</dl>
<p>Cette place est <strong>calculée</strong> : ouverte à la semaine type,
libre de tout rendez-vous, un jour qui n'est pas fermé.</p>
{self._bloc_campagne_creneau(debut, disponibles, pas)}
<p><a class="bouton" href="/ajouter"
   data-modale="/suivi/ajout?creneau={urllib.parse.quote(creneau)}"
   >＋ Ajouter un rendez-vous</a></p>"""
        return self._modale("🟩 Créneau libre", corps)

    def _bloc_campagne_creneau(self, debut, disponibles, pas):
        """§5, geste 1 — « j'ai un trou, qui peut le prendre ? ».

        Un clic sur une place libre (ou sur la suite de places libres qui
        commence là) monte une campagne 📞 « Créneau libéré » SUR CETTE
        PLACE. Le bouton ouvre l'assistant, créneau déjà rempli, à l'étape 2 :
        aucun appel ne part d'ici. Si une campagne porte DÉJÀ ce créneau, on
        le dit et on y mène — jamais deux campagnes pour la même place.
        """
        creneau = debut.isoformat(timespec="minutes")
        deja = self._campagne_sur_le_creneau(creneau)
        if deja is not None:
            return (f'<p>📞 Une campagne porte déjà cette place : '
                    f'<a href="/campagne?id={deja["id"]}">n°{deja["id"]} — '
                    f'{html.escape(deja["nom"])}</a> — aucune n\'est préparée '
                    "en double.</p>")
        return f"""<form method="post" action="/suivi/creneau/campagne">
  <input type="hidden" name="creneau" value="{html.escape(creneau)}">
  <input type="hidden" name="depuis" value="planning">
  <button class="creation">➕ Créer la campagne « 📞 Créneau libéré » sur
  cette place</button>
</form>
<p class="mini">La liste se remplira des clients dont le rendez-vous est
<strong>après</strong> cette place — ce sont les seuls qu'elle arrange. Le
bouton ouvre l'assistant à l'étape 2, créneau déjà rempli :
<strong>aucun appel n'est passé</strong>.
{html.escape(horaires.tranches_lisibles(disponibles, pas))} sont libres
d'affilée à partir d'ici.</p>"""

    def _gestes_rendezvous(self, rdv, parametres):
        """§5, gestes 2 et 3 — DÉPLACER et ANNULER, depuis le planning.

        Deux boutons, deux chemins bien distincts :
        - **Déplacer** ouvre une campagne 📆 « Déplacement » sur CE
          rendez-vous — l'assistant, à l'étape 2, contact déjà en liste ;
        - **Annuler** applique LA RÈGLE DU PROPRIÉTAIRE — et rien d'autre :
          `horaires.decision_annulation` tranche entre « supprimé » (à venir,
          au-delà du seuil) et « annulé » (passé, ou en deçà du seuil). Le
          premier clic ne fait qu'ANNONCER ce qui va se passer ; c'est le
          second qui écrit. Aucun appel ne part d'aucun des deux.
        """
        if rdv["statut"] not in STATUTS_OCCUPANTS:
            return ('<p class="mini">Ce rendez-vous ne prend aucune place au '
                    "planning : son statut l'a déjà rendue. Il n'y a donc ni "
                    "à le déplacer, ni à l'annuler.</p>")
        annee = parametres.get("annee", [""])[0]
        semaine = parametres.get("semaine", [""])[0]
        caches = (f'<input type="hidden" name="rdv" value="{rdv["id"]}">'
                  f'<input type="hidden" name="annee" value="{html.escape(annee)}">'
                  f'<input type="hidden" name="semaine" value="{html.escape(semaine)}">')
        return f"""<h3>Les trois gestes</h3>
<div class="creer-campagne">
  <form method="post" action="/suivi/detail/rappel">{caches}
    <button class="creation" title="Ouvre l'assistant à l'étape 2, ce contact déjà en liste — aucun appel n'est passé">🔔 Rappeler — monter la campagne
    « Rappel de rendez-vous »</button>
  </form>
  <form method="post" action="/suivi/detail/deplacer">{caches}
    <button class="creation" title="Ouvre l'assistant à l'étape 2, ce contact déjà en liste — aucun appel n'est passé">📆 Déplacer — monter la campagne
    « Déplacement de rendez-vous »</button>
  </form>
  <form method="post" action="/suivi/detail/annuler" data-modale-envoi>{caches}
    <input type="hidden" name="geste" value="demander">
    <button class="danger" title="Vous verrez d'abord ce que cela va faire ; rien n'est écrit avant votre confirmation">✖ Annuler ce rendez-vous…</button>
  </form>
</div>"""

    def _modale_annulation(self, rdv, parametres):
        """Ce que l'annulation VA faire — annoncé AVANT d'écrire quoi que ce soit.

        Le texte n'est pas rédigé ici : il vient mot pour mot de
        `horaires.decision_annulation`, la règle du propriétaire tenue en un
        seul endroit. On ne fait que la montrer avant de l'appliquer.
        """
        preferences = self.application.preferences
        pas = horaires.pas_minutes(preferences)
        decision = horaires.decision_annulation(preferences, rdv["horaire"])
        tranches = horaires.tranches_lisibles(horaires.duree_tranches(rdv), pas)
        if decision["compensable"]:
            suite = ("<li>sa place (" + html.escape(tranches) + ") "
                     "redeviendra <strong>libre</strong> ;</li>"
                     "<li>RingBack vous <strong>proposera</strong> de monter "
                     "une campagne 📞 « Créneau libéré » sur cette place — "
                     "proposée, jamais lancée.</li>")
        else:
            suite = ("<li>sa place (" + html.escape(tranches) + ") "
                     "redeviendra <strong>libre</strong> ;</li>"
                     f"<li>il reste moins de {decision['seuil']} h : RingBack "
                     "ne proposera <strong>pas</strong> de campagne de "
                     "remplacement — vous restez libre de la monter à la "
                     "main.</li>")
        annee = parametres.get("annee", [""])[0]
        semaine = parametres.get("semaine", [""])[0]
        corps = f"""<p>Contact : <strong>{html.escape(rdv['nom'])}</strong> —
{_date_lisible(rdv['horaire'])}</p>
<p>Ce rendez-vous passera au statut
<strong>« {html.escape(decision['statut'])} »</strong> :
{html.escape(decision['pourquoi'])}</p>
<ul>{suite}</ul>
<form method="post" action="/suivi/detail/annuler" class="carte"
      data-modale-envoi>
  <input type="hidden" name="rdv" value="{rdv['id']}">
  <input type="hidden" name="annee" value="{html.escape(annee)}">
  <input type="hidden" name="semaine" value="{html.escape(semaine)}">
  <input type="hidden" name="geste" value="confirmer">
  <button class="danger">Confirmer — passer ce rendez-vous
  « {html.escape(decision['statut'])} »</button>
</form>
<p class="mini">Rien n'est encore écrit. Fermer cette fenêtre laisse le
rendez-vous exactement comme il est.</p>"""
        return self._modale("✖ Annuler ce rendez-vous", corps)

    def _modale_apres_annulation(self, rdv, decision, parametres):
        """Ce que l'annulation A FAIT — et la campagne qu'elle rend possible.

        C'est le maillon qui manquait à la boucle du §5 : annuler libère,
        et la place libérée mène en UN CLIC à la campagne qui la remplira.
        La règle n'est pas récrite ici, `decision` vient de
        `horaires.decision_annulation`.
        """
        preferences = self.application.preferences
        pas = horaires.pas_minutes(preferences)
        tranches = horaires.tranches_lisibles(horaires.duree_tranches(rdv), pas)
        if decision["compensable"]:
            deja = self._campagne_sur_le_creneau(rdv["horaire"])
            if deja is not None:
                suite = (f'<p>📞 Une campagne porte déjà cette place : '
                         f'<a href="/campagne?id={deja["id"]}">n°{deja["id"]} — '
                         f'{html.escape(deja["nom"])}</a>.</p>')
            else:
                suite = f"""<form method="post" action="/suivi/creneau/campagne">
  <input type="hidden" name="creneau" value="{html.escape(rdv['horaire'])}">
  <input type="hidden" name="depuis" value="annulation">
  <button class="creation">📞 Créer la campagne « Créneau libéré » sur cette
  place</button>
</form>
<p class="mini">Le bouton ouvre l'assistant à l'étape 2, créneau déjà
rempli — <strong>aucun appel n'est passé</strong>.</p>"""
        else:
            suite = f"""<details><summary>Le faire quand même à la main</summary>
<p class="mini">RingBack ne le propose pas parce qu'il reste moins de
{decision['seuil']} h : une campagne a peu de chances d'aboutir à temps. Si
vous voulez essayer malgré tout, c'est votre décision — le bouton ouvre
l'assistant, il n'appelle personne.</p>
<form method="post" action="/suivi/creneau/campagne">
  <input type="hidden" name="creneau" value="{html.escape(rdv['horaire'])}">
  <input type="hidden" name="depuis" value="annulation-tardive">
  <button class="secondaire">📞 Préparer quand même la campagne</button>
</form></details>"""
        # Le planning derrière la fenêtre se remet à jour tout seul : la tuile
        # disparaît, la place repasse en vert. Un ÉLÉMENT est rechargé, jamais
        # la page (et sans JavaScript, l'envoi ordinaire ramène la fiche).
        annee = parametres.get("annee", [""])[0]
        semaine = parametres.get("semaine", [""])[0]
        requete = urllib.parse.urlencode({"annee": annee, "semaine": semaine})
        corps = f"""<p class="pastille st-confirme">C'est fait : ce rendez-vous
est « {html.escape(decision['statut'])} », {html.escape(tranches)} sont de
nouveau libres.</p>
<p>{html.escape(decision['pourquoi'])}</p>
{suite}
<span data-rafraichir="planning"
      data-rafraichir-url="/suivi/planning?{html.escape(requete)}" hidden></span>"""
        return self._modale("✖ Rendez-vous retiré", corps)

    def _traiter_annulation_modale(self, corps):
        """Annuler un rendez-vous DEPUIS LE PLANNING — en deux temps.

        « demander » montre ce que la règle va faire ; « confirmer »
        l'applique. La règle elle-même n'est pas récrite : c'est
        `horaires.decision_annulation` qui tranche, comme partout ailleurs
        dans le produit. Sans JavaScript, on retombe sur la fiche du
        rendez-vous, où le même geste existe déjà.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        base = self.application.base
        try:
            rdv_id = int(donnees.get("rdv", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de rendez-vous invalide.")
        rdv = base.obtenir_rendezvous(rdv_id)
        if rdv is None:
            return self._erreur(404, "Rendez-vous introuvable.")
        parametres = {"annee": donnees.get("annee", [""]),
                      "semaine": donnees.get("semaine", [""])}
        geste = donnees.get("geste", ["demander"])[0]
        if geste != "confirmer":
            if not self._depuis_modale():
                return self._rediriger(f"/rendezvous?id={rdv_id}")
            return self._repondre_cible(
                self._modale_annulation(rdv, parametres), "modale")
        decision = horaires.decision_annulation(self.application.preferences,
                                                rdv["horaire"])
        base.mettre_a_jour_rendezvous(rdv_id, statut=decision["statut"])
        pas = horaires.pas_minutes(self.application.preferences)
        journal.info("Planning : rendez-vous n°%d passé « %s » depuis la "
                     "modale — %s libérée(s) — %s", rdv_id, decision["statut"],
                     horaires.tranches_lisibles(rdv["duree_tranches"], pas),
                     decision["pourquoi"])
        if not self._depuis_modale():
            return self._rediriger(f"/rendezvous?id={rdv_id}&annule=ok")
        return self._repondre_cible(
            self._modale_apres_annulation(rdv, decision, parametres), "modale")

    def _traiter_deplacement_campagne(self, corps):
        """📅 → campagne 📆 « Déplacement » sur CE rendez-vous. AUCUN APPEL."""
        return self._campagne_depuis_rendezvous(
            corps, "deplacement",
            "Le rendez-vous à déplacer : {qui}, {quand} — {motif}. Les "
            "créneaux de remplacement proposés sont ceux qui sont réellement "
            "libres.")

    def _traiter_rappel_campagne(self, corps):
        """📅 → campagne 🔔 « Rappel de rendez-vous » sur CE rendez-vous.

        Demandé par le propriétaire le 02/08/2026 : « depuis le calendrier,
        en cliquant sur un rendez-vous, on doit pouvoir créer une campagne de
        rappel avec ce client spécifiquement ». Même chemin que le
        déplacement, autre nature — et AUCUN appel n'est passé : l'assistant
        s'ouvre à l'étape ②, liste déjà remplie, et il reste trois
        validations avant qu'un téléphone sonne.
        """
        return self._campagne_depuis_rendezvous(
            corps, "rappel_rdv",
            "Le rendez-vous à rappeler : {qui}, {quand} — {motif}.")

    def _campagne_depuis_rendezvous(self, corps, nature, gabarit_message):
        """UNE personne, celle du rendez-vous désigné — le tronc commun.

        Le déplacement et le rappel ne diffèrent que par la nature et la
        phrase affichée : deux copies de cette fonction auraient fini par
        diverger, et c'est justement ici que se trouvent les trois refus qui
        comptent (identifiant illisible, rendez-vous disparu, client sans
        numéro).

        Sa recette n'a aucun critère à rejouer — elle est marquée « choisie à
        la main », et l'écran le dit plutôt que d'inventer une liste au
        maillon suivant.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        base = self.application.base
        try:
            rdv_id = int(donnees.get("rdv", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de rendez-vous invalide.")
        rdv = base.obtenir_rendezvous(rdv_id)
        if rdv is None:
            return self._erreur(404, "Rendez-vous introuvable.")
        telephone = base.telephone_de(rdv["client_id"]) or ""
        if not telephone:
            return self._erreur(
                409, "Ce client n'a pas de numéro : une campagne ne peut pas "
                     "l'appeler. Complétez sa fiche dans 👥 Contacts, puis "
                     "recommencez.")
        identifiant = self.application.creer_brouillon_assistant(nature)
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        codes = {champ["code"]
                 for champ in assistant.champs_campagne(brouillon)}
        valeurs = {}
        if "rdv_existant" in codes:
            valeurs["rdv_existant"] = rdv["horaire"]
        if "motif" in codes:
            valeurs["motif"] = rdv["motif"]
        brouillon["contacts"] = [{"nom": rdv["nom"], "telephone": telephone,
                                  "champs": valeurs, "rendezvous_id": rdv_id}]
        assistant.noter_apport_recette(brouillon, "planning")
        brouillon["message"] = gabarit_message.format(
            qui=rdv["nom"], quand=assistant.date_courte(rdv["horaire"]),
            motif=rdv["motif"])
        journal.info("Planning → assistant : campagne « %s » ouverte à "
                     "l'étape 2 sur le rendez-vous n°%d (1 contact) — aucun "
                     "appel", nature, rdv_id)
        return self._rediriger(f"/assistant/message?b={identifiant}")

    def _formulaire_rendezvous(self, rdv, parametres, valeurs=None,
                               erreurs=None, message=""):
        """Le formulaire d'ÉDITION d'un rendez-vous, DANS la modale.

        Motif, date et heure, durée, statut — les quatre choses qu'on change
        à la main. Chaque valeur existante s'affiche DANS son champ ; une
        saisie refusée y revient telle qu'elle a été tapée, avec l'erreur.
        Le statut est un SÉLECTEUR (aucun choix n'ouvre un autre écran).
        """
        pas = horaires.pas_minutes(self.application.preferences)
        valeurs = valeurs or {}
        motif = valeurs.get("motif", rdv["motif"])
        horaire = valeurs.get("horaire", rdv["horaire"])
        duree = valeurs.get("duree",
                            str(horaires.duree_tranches(rdv) * pas))
        statut = valeurs.get("statut", rdv["statut"])
        # Le geste de RETRAIT dépend de la date : « annulé » derrière nous,
        # « supprimé » devant nous. On ne propose que celui qui a un sens.
        decision = horaires.decision_annulation(self.application.preferences,
                                                horaire)
        choix = [code for code in STATUTS_MODIFIABLES
                 if code not in STATUTS_RETRAIT or code == decision["statut"]]
        if rdv["statut"] not in choix:
            choix.append(rdv["statut"])   # « déplacé » : jamais changé dans le dos
        options = "".join(
            f'<option value="{html.escape(code)}"'
            f'{" selected" if code == statut else ""}>{html.escape(code)}</option>'
            for code in choix)
        explication_retrait = (
            f"<p class=\"mini\">« {html.escape(decision['statut'])} » retire "
            "ce rendez-vous du planning et rend sa place — "
            f"{html.escape(decision['pourquoi'])}</p>")
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = ('<div class="erreurs"><strong>Saisie refusée '
                            "(rien n'a été enregistré) :</strong>"
                            f"<ul>{elements}</ul></div>")
        bloc_message = (f'<p class="pastille st-confirme">{html.escape(message)}</p>'
                        if message else "")
        # La semaine affichée voyage avec le formulaire : après
        # enregistrement, c'est CETTE semaine du planning qui se remet en
        # place — l'écran ne saute pas ailleurs.
        annee = parametres.get("annee", [""])[0]
        semaine = parametres.get("semaine", [""])[0]
        return f"""{bloc_erreurs}{bloc_message}
<form method="post" action="/suivi/detail/enregistrer" class="carte"
      data-modale-envoi>
  <input type="hidden" name="rdv" value="{rdv['id']}">
  <input type="hidden" name="annee" value="{html.escape(annee)}">
  <input type="hidden" name="semaine" value="{html.escape(semaine)}">
  <label>Motif du rendez-vous<br>
    <input name="motif" value="{html.escape(motif)}" required></label>
  <label>Date et heure — format attendu : 2026-08-03 09:00<br>
    <input type="datetime-local" name="horaire"
           value="{html.escape(horaire)}"></label>
  <label>Durée en minutes — multiple de {pas}, par exemple {pas} ou {2 * pas}<br>
    <input class="champ-court" type="number" name="duree" min="{pas}"
           step="{pas}" value="{html.escape(duree)}"></label>
  <label>Statut<br>
    <select class="select-option" name="statut">{options}</select></label>
  {explication_retrait}
  <button>Enregistrer</button>
</form>
<p class="mini">Enregistrer ferme cette fenêtre et remet à jour le
<strong>planning seul</strong> — la page ne se recharge pas.</p>"""

    @staticmethod
    def _modale(titre, corps, classe=""):
        """L'enveloppe commune des modales (fermeture au clic extérieur/Échap).

        `classe` : une classe de PLUS, pour un habillage particulier — le menu
        de plage du planning s'en sert pour se poser sur le côté. La mécanique,
        elle, reste la même partout : une seule fenêtre dans le produit.
        """
        return f"""<div class="modale{classe}" role="dialog" aria-modal="true"
     aria-label="{html.escape(titre)}">
  <div class="entete-modale"><h2>{titre}</h2>
    <button type="button" class="secondaire modale-fermer"
            title="Fermer — le clic à l'extérieur et la touche Échap font pareil">Fermer ✕</button></div>
  {corps}
</div>"""

    def _page_tous(self, parametres=None):
        """TOUS les rendez-vous, du plus récent au plus ancien — rien ne se perd."""
        self.application.base.marquer_manques_echus()
        parametres = parametres or {}
        message = ""
        retabli = parametres.get("retabli", [""])[0]
        if retabli == "ok":
            message = "Rendez-vous rétabli : il est de retour dans « À rappeler »."
        elif retabli == "absent":
            message = "Rien à rétablir : ce rendez-vous n'était pas « ignoré »."
        bloc_message = f'<p class="pastille">{html.escape(message)}</p>' if message else ""
        lignes = []
        for rdv in self.application.base.tous_les_rendezvous():
            telephone = (html.escape(rdv["telephone_masque"])
                         if rdv["telephone_masque"] else "<em>aucun numéro</em>")
            # ⚠ LE LIEN VERS LA CAMPAGNE D'ORIGINE EST ICI depuis le
            # 10/08/2026. Il ne vivait que dans « 📅 Rendez-vous à venir », qui
            # a été retirée : cette page est devenue la SEULE liste des
            # rendez-vous, et « d'où vient celui-là ? » doit pouvoir s'y lire.
            actions = (self._lien_campagne(rdv["id"])
                       + f'<a href="/rendezvous?id={rdv["id"]}">Voir la fiche</a>')
            if rdv["statut"] == "ignoré":
                actions += f"""<form method="post" action="/retablir">
    <input type="hidden" name="rdv" value="{rdv['id']}">
    <button class="secondaire" title="Le rendez-vous redevient « manqué » et réapparaît dans « À rappeler »">Remettre à rappeler</button>
  </form>"""
            lignes.append(f"""<tr>
  <td>{html.escape(rdv['nom'])}{self._badge_stop(rdv)}</td>
  <td>{telephone}</td>
  <td>{self._cellule_horaire(rdv)}</td>
  <td>{html.escape(rdv['motif'])}</td>
  <td>{self._pastille_statut(rdv['statut'])}</td>
  <td>{actions}</td>
</tr>""")
        if lignes:
            tableau = ("<table><tr><th>Contact</th><th>Téléphone</th><th>Horaire</th>"
                       "<th>Motif</th><th>Statut</th><th></th></tr>"
                       + "\n".join(lignes) + "</table>")
        else:
            tableau = "<p>Aucun rendez-vous en base pour l'instant.</p>"
        corps = f"""{self._bandeau()}
{bloc_message}
<h1>Tous les rendez-vous ({len(lignes)})</h1>
<p>Du plus récent au plus ancien, avec leur statut : aucune saisie ne se perd.
Un rendez-vous « ignoré » (liste vidée) se rétablit ici d'un bouton.</p>
{tableau}"""
        return self._page("Tous les rendez-vous", corps, actif="suivi")

    def _selecteur_theme(self, selection, mission=None, nom_client=None,
                         date_rdv=None, note_par_appel=False, note_creneau=False):
        """Le bloc « Thème de l'appel » : sélecteur + mission pré-remplie.

        Les gabarits, nourris par les réglages, sont embarqués dans la page :
        changer de thème remplit la zone SANS appel serveur, et la zone
        reste librement modifiable — c'est CE texte qui sera lu. Sans
        JavaScript, le serveur applique le gabarit du thème choisi quand la
        zone arrive vide.
        """
        preferences = self.application.preferences
        # Les créneaux proposés sont CALCULÉS (ouvert − pris − fermé), plus
        # ceux ajoutés à la main : c'est cette liste qui remplace
        # [créneaux_disponibles] dans les gabarits.
        creneaux_calcules = self._creneaux_lisibles()
        gabarits = {code: themes.preremplir(code, preferences, nom_client,
                                            date_rdv, creneaux_calcules)
                    for code in themes.THEMES}
        options = "".join(
            f'<option value="{code}"{" selected" if code == selection else ""}>'
            f"{html.escape(libelle)}</option>"
            for code, libelle in themes.THEMES.items())
        json_gabarits = json.dumps(gabarits, ensure_ascii=False).replace("</", "<\\/")
        avertissements = []
        if not (preferences.obtenir(themes.CLE_ENTREPRISE) or "").strip():
            avertissements.append("[entreprise] n'est pas réglé")
        if not creneaux_calcules:
            avertissements.append("aucun créneau disponible (ni horaires "
                                  "d'ouverture, ni créneau ajouté à la main)")
        note_reglages = ""
        if avertissements:
            note_reglages = (f"<small>⚠ {' et '.join(avertissements)} — "
                             'à renseigner dans <a href="/reglages">⚙ Réglages</a>, '
                             "ou remplacez la variable à la main.</small>")
        note_substitution = ""
        if note_par_appel:
            note_substitution = ("<small>[client] et [date_rdv] sont remplacés "
                                 "automatiquement pour chaque appel.</small>")
        if note_creneau:
            note_substitution += ("<small>[créneau] est remplacé par la date du "
                                  "créneau libéré, [client] par chaque personne "
                                  "appelée.</small>")
        contenu_zone = mission if mission else gabarits.get(selection, "")
        return f"""<label>Thème de l'appel<br>
    <select name="theme" id="sel-theme">{options}</select></label>
  <label>Mission — le texte que l'agent lit, pré-rempli par le thème et
    <strong>modifiable</strong> avant lancement (jamais de numéro dedans)<br>
    <textarea name="mission" id="zone-mission" rows="5">{html.escape(contenu_zone)}</textarea></label>
  {note_substitution}
  {note_reglages}
  <script>
  (function(){{var G={json_gabarits};
  var s=document.getElementById('sel-theme'),z=document.getElementById('zone-mission');
  if(s&&z){{s.onchange=function(){{if(G[s.value]!==undefined){{z.value=G[s.value]}}}};}}}})();
  </script>"""

    def _page_file(self, parametres):
        """La file d'appels : mise en file groupée, annulation, exécution, bilan."""
        self.application.base.marquer_manques_echus()
        message = ""
        try:
            mis = int(parametres.get("mis", ["-1"])[0])
        except ValueError:
            mis = -1
        if mis == 0:
            message = "Aucun nouvel appel à mettre en file : rien de manqué, ou déjà en file."
        elif mis > 0:
            message = f"{mis} appel(s) mis en file."
        annule = parametres.get("annule", [""])[0]
        if annule == "ok":
            message = "Appel retiré de la file : il ne sera pas passé."
        elif annule == "absent":
            message = "Appel introuvable dans la file (déjà exécuté ou déjà retiré)."
        try:
            vides = int(parametres.get("vide", ["-1"])[0])
        except ValueError:
            vides = -1
        if vides == 0:
            message = "La file était déjà vide : rien à annuler."
        elif vides > 0:
            message = (f"File vidée : {vides} appel(s) annulé(s) avant "
                       "exécution — aucun ne sera passé.")
        bloc_message = f'<p class="pastille">{html.escape(message)}</p>' if message else ""
        file_detail = self.application.planif.file_detaillee()
        lignes = []
        for entree in file_detail:
            rdv = entree["rendezvous"]
            lignes.append(f"""<tr>
  <td>n°{entree['appel_id']}</td>
  <td>{html.escape(rdv['nom'])}{self._badge_stop(rdv)}</td>
  <td>{html.escape(rdv['telephone_masque'])}</td>
  <td>{self._cellule_horaire(rdv)}</td>
  <td>{html.escape(rdv['motif'])}</td>
  <td><form method="post" action="/file/annuler">
    <input type="hidden" name="appel" value="{entree['appel_id']}">
    <button class="secondaire">Annuler</button>
  </form></td>
</tr>""")
        bouton_vider = ""
        if lignes:
            tableau_file = ("<table><tr><th>Appel</th><th>Contact</th><th>Téléphone</th>"
                            "<th>Horaire manqué</th><th>Motif</th><th></th></tr>"
                            + "\n".join(lignes) + "</table>")
            # ⚠ LA PHRASE ENTIÈRE, PAS UN MOT GLISSÉ DEDANS (02/09/2026).
            # Elle s'écrivait « passer {verbe} les N appel(s) », le mot
            # variable inséré APRÈS le verbe. En français ça marche ; en
            # anglais l'ordre des mots est l'inverse, et aucune entrée de
            # dictionnaire ne peut le réparer — on obtenait « place REALLY
            # the 3 calls ». On construit donc les DEUX phrases en entier :
            # chacune se traduit comme une phrase, avec sa propre grammaire.
            if self.application.mode_reel:
                libelle_execution = (
                    f"Exécuter la file — passer RÉELLEMENT "
                    f"les {len(lignes)} appel(s)")
            else:
                libelle_execution = (
                    f"Exécuter la file — passer en simulation "
                    f"les {len(lignes)} appel(s)")
            bouton_vider = """<form method="post" action="/file/annuler-tout">
  <button class="secondaire" title="Annule d'un coup tous les appels en attente, avant exécution">Vider la file — tout annuler</button>
</form>"""
            bloc_execution = f"""<h2>Lancer les appels</h2>
<form method="post" action="/file/executer" class="carte" style="max-width:38rem">
  {self._selecteur_theme("manque", note_par_appel=True)}
  <p><button>{libelle_execution}</button></p>
</form>"""
        else:
            tableau_file = "<p>La file est vide. « Tout rappeler » y met chaque rendez-vous manqué.</p>"
            bloc_execution = ""
        corps = f"""{self._bandeau()}
<h1>File d'appels</h1>
<p><small>Parcours direct conservé — chaque exécution de la file est
enregistrée comme <a href="/">📣 campagne</a> « rappel d'appels manqués »,
avec 🔁 relance programmée pour les appels non aboutis. L'assistant
« <a href="/assistant">➕ Nouvelle campagne</a> » fait la même chose,
guidé.</small></p>
{bloc_message}
<form method="post" action="/file/tout-rappeler">
  <p><button>Tout rappeler — mettre en file tous les manqués</button></p>
</form>
<div class="entete-section"><h2>Appels en attente ({len(lignes)})</h2>{bouton_vider}</div>
{tableau_file}
{bloc_execution}
<h2>Bilan des issues</h2>
{self._tableau_bilan()}"""
        return self._page("File d'appels", corps, actif="campagnes")

    def _page_resultat_execution(self, appels_traites, campagne_id=None):
        """Résultats de l'exécution de la file, appel par appel + bilan."""
        base = self.application.base
        lignes = []
        for appel_id in appels_traites:
            appel = base.obtenir_appel(appel_id)
            rdv = base.obtenir_rendezvous(appel["rendezvous_id"])
            resultat = appel["resultat"]
            if appel["statut"] == "terminé" and resultat:
                issue = ETIQUETTES.get(resultat["appointment_status"],
                                       resultat["appointment_status"])
            elif appel["statut"] == "échec":
                issue = "Échec"
            else:
                issue = appel["statut"].capitalize()
            note = (f'<br><span class="erreurs">⚠ '
                    f'{html.escape(appel["note"])}</span>'
                    if appel.get("note") else "")
            lignes.append(f"""<tr>
  <td>n°{appel_id}</td>
  <td>{html.escape(rdv['nom'])}</td>
  <td>{html.escape(rdv['telephone_masque'])}</td>
  <td><span class="pastille">{html.escape(issue)}</span>{note}</td>
  <td><a href="/rendezvous?id={rdv['id']}">Voir la fiche</a></td>
</tr>""")
        if lignes:
            tableau = ("<table><tr><th>Appel</th><th>Contact</th><th>Téléphone</th>"
                       "<th>Issue</th><th></th></tr>" + "\n".join(lignes) + "</table>")
        else:
            tableau = "<p>La file était vide : aucun appel à passer.</p>"
        lien_campagne = ""
        if campagne_id:
            lien_campagne = (f'<p>📣 Cette exécution est enregistrée comme '
                             f'<a href="/campagne?id={campagne_id}">campagne '
                             "de rappel des manqués</a> — ses appels non "
                             "aboutis y ont leur 🔁 relance programmée.</p>")
        corps = f"""{self._bandeau()}
<p><a href="/file">← Retour à la file d'appels</a></p>
<h1>Exécution terminée</h1>
<p><strong>{len(lignes)}</strong> appel(s) traité(s).</p>
{lien_campagne}
{tableau}
<h2>Bilan des issues</h2>
{self._tableau_bilan()}"""
        return self._page("Exécution terminée", corps, actif="campagnes")

    def _page_preparer_rappel(self, rdv_id):
        """Préparation d'un rappel individuel : thème + mission modifiable.

        Rend None si le rendez-vous n'existe pas. Un client marqué « Ne
        plus appeler » est bloqué ICI aussi (ceinture et bretelles : le
        planificateur refuserait de toute façon).
        """
        rdv = self.application.base.obtenir_rendezvous(rdv_id)
        if rdv is None:
            return None
        if rdv["ne_plus_appeler"]:
            corps = f"""{self._bandeau()}
<h1>Rappel impossible</h1>
<p class="erreurs">{html.escape(rdv['nom'])} est marqué
<strong>🚫 « Ne plus appeler »</strong> : aucun appel ne lui sera passé.
Le drapeau se lève depuis la page <a href="/clients">👥 Contacts</a> si besoin.</p>
<p><a href="/suivi">← Retour aux rendez-vous</a></p>"""
            return self._page("Rappel impossible", corps, actif="suivi")
        verbe = "RÉELLEMENT" if self.application.mode_reel else "en simulation"
        corps = f"""{self._bandeau()}
<p><a href="/suivi">← Retour aux rendez-vous</a></p>
<h1>Préparer le rappel</h1>
<p>Contact : <strong>{html.escape(rdv['nom'])}</strong> —
{html.escape(rdv['telephone_masque'])}<br>
Rendez-vous : {self._cellule_horaire(rdv)} — {html.escape(rdv['motif'])}
{self._pastille_statut(rdv['statut'])}</p>
<form method="post" action="/rappeler" class="carte" style="max-width:38rem">
  <input type="hidden" name="rdv" value="{rdv['id']}">
  {self._selecteur_theme("manque", nom_client=rdv["nom"], date_rdv=rdv["horaire"])}
  <p><button>Lancer l'appel — {verbe}</button></p>
</form>"""
        return self._page("Préparer le rappel", corps, actif="suivi")

    def _page_clients(self, parametres=None):
        """La page « Clients » : le poste de travail des ÉTATS.

        Chaque client y porte ses DEUX états (agenda et conversation), le
        nombre de ses rendez-vous, les campagnes en cours qui le traitent, et
        ce qu'il reste à faire. Les filtres rechargent la SEULE liste.
        """
        parametres = parametres or {}
        message = ""
        marque = parametres.get("marque", [""])[0]
        if marque == "stop":
            message = ("Client marqué « Ne plus appeler » : exclu de la file, "
                       "des cascades et des listes générées (réversible ici).")
        elif marque == "ok":
            message = "Drapeau levé : ce client peut de nouveau être appelé."
        elif marque == "modifie":
            message = "Fiche du client enregistrée."
        try:
            supprimes = int(parametres.get("supprime", ["-1"])[0])
        except ValueError:
            supprimes = -1
        if supprimes >= 0:
            try:
                desarmees = int(parametres.get("desarmees", ["0"])[0])
            except ValueError:
                desarmees = 0
            message = (f"Client supprimé, ainsi que {supprimes} de ses "
                       "rendez-vous.")
            if desarmees:
                message += (f" {desarmees} relance(s) encore programmée(s) "
                            "ont été annulées : plus aucun appel ne partira "
                            "pour lui.")
            message += (" Ses contacts de campagne et les appels déjà passés "
                        "restent lisibles, mais ne seront plus jamais "
                        "composés.")
        bloc_message = f'<p class="pastille">{html.escape(message)}</p>' if message else ""
        fiches = etats_clients.tableau_clients(self.application.base,
                                               self.application.preferences)
        non_traites = sum(1 for fiche in fiches if fiche["non_traite"])
        humains = sum(1 for fiche in fiches if fiche["humain"])
        sans_numero = sum(1 for fiche in fiches if fiche["sans_numero"])
        exclus = sum(1 for fiche in fiches if fiche["exclu"])
        rappel_humain = ""
        if humains:
            rappel_humain = (f'<p class="bandeau">🙋 {humains} client(s) '
                             "attendent un appel HUMAIN ou une correction de "
                             "fiche : aucune campagne ne les traitera.</p>")
        corps = f"""{self._bandeau()}
<h1>Contacts ({len(fiches)})</h1>
{bloc_message}
<p>Chaque contact porte <strong>deux états</strong> qu'il ne faut pas
confondre : son <strong>état d'agenda</strong> (ce que dit le planning) et
son <strong>état de conversation</strong> (ce que le dernier appel a
produit). Un rendez-vous long compte pour <strong>un</strong> rendez-vous,
pas pour le nombre de tranches qu'il occupe.</p>
<div class="compteurs">
  <span class="pastille st-manque">⚠ {non_traites} non traité(s)</span>
  <span class="pastille st-deplace">🙋 {humains} pour un humain</span>
  <span class="pastille st-ignore">☎ {sans_numero} sans numéro</span>
  <span class="pastille st-annule">🚫 {exclus} ne plus appeler</span>
</div>
{rappel_humain}
<form id="filtres-clients" class="filtres" method="get" action="/clients">
  {self._champs_filtres_clients(parametres)}
  <button class="secondaire" type="submit">Filtrer</button>
</form>
<div id="liste-clients">{self._liste_clients(parametres, fiches)}</div>
{SCRIPT_CLIENTS}
<p><small>« Ne plus appeler » exclut le contact de la file d'appels, des
cascades et de la génération de liste — partout signalé par le badge 🚫, et
réversible. « Supprimer… » passe TOUJOURS par une page de
confirmation.</small></p>"""
        return self._page("Contacts", corps, actif="clients")

    # Combien de contacts par page. « 0 » = tous — l'écran l'écrit « tous »,
    # parce qu'un « 0 par page » se lirait comme « aucun ».
    PAR_PAGE_CHOIX = (10, 25, 50, 100, 0)
    PAR_PAGE_DEFAUT = 25

    @staticmethod
    def _navigation_pages(page, pages, combien, total):
        """« ≪ ‹ page 2 sur 7 › ≫ » — quatre vrais boutons d'envoi.

        ⚠ ILS PORTENT « name=page » : sans JavaScript, cliquer envoie le
        formulaire des filtres avec ce numéro, et la liste se recharge comme
        d'habitude. Le script, lui, emporte le bouton cliqué.

        ⚠ ET ILS SONT DÉSACTIVÉS AUX EXTRÉMITÉS, jamais masqués : un bouton qui
        disparaît fait douter de l'endroit où l'on est.
        """
        if pages <= 1:
            return ""
        def bouton(cible, signe, titre, actif):
            desactive = "" if actif else " disabled"
            return (f'<button class="secondaire page-nav" '
                    'form="filtres-clients" name="page" '
                    f'value="{cible}" title="{titre}"{desactive}>{signe}'
                    "</button>")
        return f"""<p class="pagination">
  {bouton(1, "≪", "Première page", page > 1)}
  {bouton(page - 1, "‹", "Page précédente", page > 1)}
  <span class="sourd">page <strong>{page}</strong> sur {pages} —
    {combien} contact(s) affiché(s) sur {total} retenu(s)</span>
  {bouton(page + 1, "›", "Page suivante", page < pages)}
  {bouton(pages, "≫", "Dernière page", page < pages)}
</p>"""

    def _champs_filtres_clients(self, parametres):
        """Les trois filtres : recherche par nom, état, et « non traité ».

        UN SEUL sélecteur pour l'état (agenda et conversation dans deux
        groupes) — pas une pile de boutons radio, puisqu'aucun choix
        n'ouvre un écran différent. La case « non traité » garde son
        contrôle AVANT le texte et ne prend pas toute la largeur.
        """
        recherche = parametres.get("recherche", [""])[0]
        etat = parametres.get("etat", [""])[0]
        non_traite = parametres.get("non_traite", [""])[0] in ("1", "on", "oui")
        interdit = parametres.get("interdit", [""])[0] == "interdits"
        par_page = _entier(parametres.get("par_page"), self.PAR_PAGE_DEFAUT)

        def options(dictionnaire, libelle_de):
            return "".join(
                f'<option value="{html.escape(code)}"'
                f'{" selected" if code == etat else ""}>'
                f"{html.escape(libelle_de(code))}</option>"
                for code in dictionnaire)

        agenda = options(etats_clients.ETATS_AGENDA,
                         etats_clients.libelle_agenda)
        conversation = options(etats_clients.ETATS_CONVERSATION,
                               etats_clients.libelle_conversation)
        a_venir = "".join(
            f'<option value="" disabled>{html.escape(libelle)} — à venir</option>'
            for libelle in etats_clients.ETATS_A_VENIR.values())
        tailles = "".join(
            f'<option value="{taille}"'
            f'{" selected" if taille == par_page else ""}>'
            f'{"tous" if taille == 0 else taille} par page</option>'
            for taille in self.PAR_PAGE_CHOIX)
        return f"""<label>Rechercher un contact — nom ou numéro<br>
    <input type="search" name="recherche" value="{html.escape(recherche)}"
           placeholder="Lefèvre, ou 0600000042"></label>
  <label>Contact par l'agent<br>
    <select name="interdit">
      <option value=""{" selected" if not interdit else ""}>tous</option>
      <option value="interdits"{" selected" if interdit else ""}>🚫 contact par
        agent interdit</option>
    </select></label>
  <label>Combien par page<br>
    <select name="par_page">{tailles}</select></label>
  <label>État<br>
    <select name="etat">
      <option value=""{" selected" if not etat else ""}>Tous les états</option>
      <optgroup label="État d'agenda — ce que dit le planning">{agenda}</optgroup>
      <optgroup label="État de conversation — ce que le dernier appel a produit">{conversation}</optgroup>
      <optgroup label="Décrits par le produit, pas encore produits">{a_venir}</optgroup>
    </select></label>
  <label class="option" title="Son état appelle une action, et aucune campagne en cours ne le traite pour cet état">
    <input type="checkbox" name="non_traite" value="1"
           {"checked" if non_traite else ""}> non traité</label>"""

    def _liste_clients(self, parametres=None, fiches=None):
        """Le FRAGMENT « liste des contacts » — c'est LUI que les filtres rechargent."""
        parametres = parametres or {}
        if fiches is None:
            fiches = etats_clients.tableau_clients(self.application.base,
                                                   self.application.preferences)
        recherche = parametres.get("recherche", [""])[0]
        etat = parametres.get("etat", [""])[0]
        non_traite = parametres.get("non_traite", [""])[0] in ("1", "on", "oui")
        interdit = parametres.get("interdit", [""])[0] == "interdits"
        ids_numero = self.application.base.clients_par_chiffres(recherche)
        retenues = etats_clients.filtrer(fiches, recherche, etat, non_traite,
                                         interdit, ids_numero)
        rappel = []
        if recherche:
            rappel.append(f"nom ou numéro contenant « {recherche} »")
        if interdit:
            rappel.append("🚫 contact par agent interdit")
        if etat:
            rappel.append(f"état « {etats_clients.libelle_agenda(etat) if etat in etats_clients.ETATS_AGENDA else etats_clients.libelle_conversation(etat)} »")
        if non_traite:
            rappel.append("non traité")
        entete = (f"<p><strong>{len(retenues)}</strong> contact(s) sur "
                  f"{len(fiches)}"
                  + (f" — filtre : {html.escape(', '.join(rappel))}" if rappel
                     else " — aucun filtre")
                  + ".</p>")
        creation = self._boutons_creation_campagne(retenues, etat, recherche,
                                                   non_traite)
        # ⚠ LA PAGE EST BORNÉE PAR LE RÉSULTAT, pas par ce qu'on a demandé :
        # un numéro de page hérité d'un filtre plus large aurait montré une
        # liste vide, comme si le filtre ne trouvait personne.
        par_page = _entier(parametres.get("par_page"), self.PAR_PAGE_DEFAUT)
        if par_page not in self.PAR_PAGE_CHOIX:
            par_page = self.PAR_PAGE_DEFAUT
        pages = 1 if not par_page else max(
            1, -(-len(retenues) // par_page))     # division qui arrondit en haut
        page = min(max(_entier(parametres.get("page"), 1), 1), pages)
        if par_page:
            visibles = retenues[(page - 1) * par_page:page * par_page]
        else:
            visibles = retenues
        navigation = self._navigation_pages(page, pages, len(visibles),
                                            len(retenues))
        lignes = [self._ligne_client(fiche) for fiche in visibles]
        if lignes:
            tableau = ("<table><tr><th>Contact</th><th>Téléphone</th>"
                       "<th>Rendez-vous</th><th>Ses deux états</th>"
                       "<th>Campagnes en cours</th><th>Ce qu'il reste à faire</th>"
                       "<th></th><th></th></tr>" + "\n".join(lignes) + "</table>")
        elif fiches:
            tableau = ("<p>Aucun client ne correspond à ce filtre. Videz-le "
                       "pour revoir toute la liste.</p>")
        else:
            tableau = "<p>Aucun contact en base pour l'instant.</p>"
        return creation + entete + navigation + tableau + navigation

    def _boutons_creation_campagne(self, retenues, etat, recherche, non_traite):
        """§4 — « ➕ Créer la campagne … — N clients concernés ».

        Règle d'apparition, mot pour mot : le filtre porte sur un état à
        traiter, l'option « non traité » est cochée, la sélection n'est pas
        vide. La NATURE n'est pas choisie ici : elle est déduite de l'état
        par `etats_clients.TRAITEMENT` (la table du §3, jamais recopiée).

        Décision du propriétaire (31/07/2026) : quand la sélection mêle des
        états traités par des campagnes différentes, on montre UN BOUTON PAR
        NATURE, chacun avec son propre compte — jamais un bouton grisé qui
        laisserait deviner. Les états qu'aucune campagne ne traite ne
        donnent aucun bouton, mais disent pourquoi (§6) : sans cette phrase,
        l'absence de bouton ressemblerait à un oubli.

        Ce bloc fait partie du FRAGMENT de liste : il apparaît et disparaît
        avec le filtre, sans que la page soit rechargée.
        """
        if not non_traite or not retenues:
            return ""
        propositions = etats_clients.natures_a_proposer(retenues, etat)
        boutons = []
        for proposition in propositions:
            nombre = len(proposition["clients"])
            etats = ", ".join(etats_clients.libelle_etat(code)
                              for code in proposition["etats"])
            infobulle = (f"Depuis l'état : {etats}. Ouvre l'assistant à "
                         "l'étape 2, la liste déjà remplie — aucun appel "
                         "n'est passé.")
            # Le libellé du bouton tient sur UNE ligne à dessein : c'est ce
            # que l'écran lit, et ce que les essais cherchent — un retour à
            # la ligne dans le texte du bouton en ferait deux morceaux.
            boutons.append(
                '<form method="post" action="/clients/campagne">'
                '<input type="hidden" name="nature" '
                f'value="{html.escape(proposition["nature"])}">'
                f'<input type="hidden" name="etat" value="{html.escape(etat)}">'
                '<input type="hidden" name="recherche" '
                f'value="{html.escape(recherche)}">'
                f'<button class="creation" title="{html.escape(infobulle)}">'
                f'➕ Créer la campagne « {html.escape(proposition["libelle"])} »'
                f' — {nombre} client(s) concerné(s)</button></form>')
        bloc = ""
        if boutons:
            bloc += f'<div class="creer-campagne">{"".join(boutons)}</div>'
            bloc += ('<p class="mini">Aucun appel ne part de ces boutons : '
                     "ils ouvrent l'assistant à <strong>l'étape 2</strong>, "
                     "la liste des personnes déjà remplie — la nature est "
                     "déjà connue, on ne la redemande pas. C'est vous qui "
                     "validez, puis qui démarrez.</p>")
        for muet in etats_clients.etats_sans_campagne(retenues, etat):
            bloc += (f'<p class="sans-campagne mini">⛔ '
                     f'{muet["clients"]} client(s) en « '
                     f'{html.escape(muet["libelle"])} » — '
                     f'{html.escape(muet["raison"])}.</p>')
        return bloc

    def _traiter_campagne_depuis_etat(self, corps):
        """👥 → l'assistant à l'ÉTAPE 2, liste déjà remplie. AUCUN APPEL.

        Le geste du §4 : la nature vient de l'état filtré, la liste vient du
        même filtre, et la RECETTE garde le critère (mode « etat ») pour que
        la campagne reste rejouable — c'est ce qui fait marcher la cascade.
        Rien n'est créé en base tant que les trois étapes ne sont pas
        validées.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        nature = donnees.get("nature", [""])[0]
        etat = donnees.get("etat", [""])[0]
        recherche = donnees.get("recherche", [""])[0]
        if nature not in assistant.NATURES:
            return self._erreur(400, f"Nature de campagne inconnue : "
                                     f"« {nature} ».")
        identifiant = self.application.creer_brouillon_assistant(nature)
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        champs = assistant.champs_campagne(brouillon)
        try:
            contacts, complements = etats_clients.contacts_depuis_etat(
                self.application.base, etat, nature, champs,
                recherche=recherche,
                preferences=self.application.preferences)
        except saisie.SaisieInvalide as erreur:
            return self._erreur(400, str(erreur))
        if not contacts:
            self.application.brouillons_assistant.pop(identifiant, None)
            return self._erreur(
                409, "Plus personne ne correspond à ce filtre : la liste a "
                     "changé entre l'affichage et le clic (une campagne a pu "
                     "prendre ces clients entre-temps). Revenez à 👥 Contacts, "
                     "le compte y sera à jour.")
        brouillon["contacts"] = contacts
        # La recette retient le CRITÈRE, pas les personnes (§8.3).
        assistant.noter_apport_recette(brouillon, "etat", etat=etat,
                                       nature=nature, recherche=recherche)
        # La phrase « liste déjà remplie » est écrite par l'étape 2 elle-même
        # (une seule fois, à partir de la recette) : ici on ne garde que ce
        # qu'elle ne dit pas — les écartés, comptés.
        if complements:
            brouillon["message"] = " ; ".join(complements) + "."
        journal.info("👥 Contacts → assistant : brouillon ouvert à l'étape 2 "
                     "(nature %s, état %s, %d contact(s)) — aucun appel",
                     nature, etat or "tous", len(contacts))
        return self._rediriger(f"/assistant/message?b={identifiant}")

    def _ligne_client(self, fiche):
        """Une ligne du tableau des clients, avec son identifiant d'élément.

        C'est CETTE ligne — et elle seule — qui se remplit à nouveau après
        une modification dans la modale : jamais la liste, jamais la page.
        """
        return (f'<tr id="client-{fiche["client"]["id"]}">'
                + self._cellules_client(fiche) + "</tr>")

    def _cellules_client(self, fiche):
        """Le CONTENU d'une ligne client : tout ce que la base sait de lui."""
        client = fiche["client"]
        resume = fiche["resume"]
        telephone = (html.escape(client["telephone_masque"])
                     if client["telephone_masque"] else "<em>aucun numéro</em>")
        if client["ne_plus_appeler"]:
            bascule = f"""<form method="post" action="/clients/ne-plus-appeler">
    <input type="hidden" name="client" value="{client['id']}">
    <input type="hidden" name="valeur" value="0">
    <button class="secondaire" title="Le client pourra de nouveau être appelé">Appeler de nouveau</button>
  </form>"""
        else:
            bascule = f"""<form method="post" action="/clients/ne-plus-appeler">
    <input type="hidden" name="client" value="{client['id']}">
    <input type="hidden" name="valeur" value="1">
    <button class="secondaire" title="Exclut ce client de la file, des cascades et des listes (réversible)">Ne plus appeler</button>
  </form>"""
        # ⚠ LE DRAPEAU PLUS DOUX, et il se dit à part du 🚫 : la personne reste
        # appelable pour SES rendez-vous, elle refuse seulement qu'on lui
        # propose des places libérées. Les confondre à l'écran, c'est croire
        # qu'on a coupé le téléphone à quelqu'un qui ne l'a pas demandé.
        if client["plus_de_proposition"]:
            bascule += f"""<p class="pastille st-ignore">🔇 Ne veut plus qu'on lui
  propose de créneau libéré — demandé au téléphone. Elle reste appelable pour
  SES rendez-vous.</p>
<form method="post" action="/clients/propositions">
  <input type="hidden" name="client" value="{client['id']}">
  <input type="hidden" name="valeur" value="1">
  <button class="secondaire" title="Elle recevra de nouveau les propositions de créneau libéré">Proposer de nouveau des créneaux</button>
</form>"""
        marque_essai = ('<br><span class="badge-essai" title="Client du jeu '
                        'd\'essai — donnée fictive, retirable depuis les '
                        'réglages">🧪 jeu d\'essai</span>'
                        if client["jeu_essai"] else "")
        # Le 🧪 numéro d'essai est un AUTRE marquage que le jeu d'essai : une
        # fiche peut porter les deux (une identité d'essai réel), ou l'un
        # sans l'autre (un vrai client à qui on aurait donné ce numéro).
        marque_essai += essai_reel.badge(client, "<br>")
        badge_stop = ('<br><span class="badge-stop">🚫 ne plus appeler</span>'
                      if client["ne_plus_appeler"] else "")
        # ⚠ UN NOMBRE, PAS UN DÉTAIL (demande du propriétaire, 02/08/2026) :
        # ces deux colonnes étalaient prochain/dernier/compteurs et la liste
        # complète des campagnes, ce qui donnait des lignes de six lignes de
        # haut. Le nombre suffit à l'écran ; le détail s'ouvre en fenêtre.
        # Le lien mène TOUJOURS à la fiche pleine page : sans JavaScript, le
        # repli est entier, et cette fiche montre déjà les deux contenus.
        colonne_rdv = _nombre_cliquable(
            client["nb_rendezvous"], client["id"], "detail-rendezvous",
            "Voir tous ses rendez-vous")
        etats = (
            '<div class="etats-client">'
            f'<span class="pastille {etats_clients.classe(fiche["agenda"])}" '
            'title="État d\'agenda — ce que dit le planning">'
            f'{html.escape(etats_clients.libelle_agenda(fiche["agenda"]))}</span>'
            f'<span class="pastille {etats_clients.classe(fiche["conversation"])}" '
            'title="État de conversation — ce que le dernier appel a produit">'
            f'{html.escape(etats_clients.libelle_conversation(fiche["conversation"], fiche["tentatives"]))}'
            "</span></div>")
        campagnes_lisibles = _nombre_cliquable(
            len(fiche["campagnes"]), client["id"], "detail-campagnes",
            "Voir les campagnes qui le contiennent", vide="aucune")
        a_faire = []
        for besoin in fiche["besoins"]:
            if besoin["traite"]:
                marque = ('<span class="pastille st-confirme">pris en '
                          "charge</span>")
            elif fiche["exclu"]:
                marque = ('<span class="pastille st-annule">🚫 exclu de tout '
                          "appel</span>")
            elif fiche["sans_numero"]:
                marque = ('<span class="pastille st-ignore">☎ sans numéro : '
                          "rien n'est possible</span>")
            elif besoin["humain"]:
                marque = ('<span class="pastille st-deplace">🙋 travail '
                          "humain</span>")
            else:
                marque = '<span class="pastille st-manque">⚠ non traité</span>'
            a_faire.append(f"{html.escape(besoin['action'])} {marque}")
        # Un état qui ne débouche sur AUCUNE campagne dit POURQUOI : sans
        # cela, « 📞 le client rappellera » se confondrait avec « 🔄 à
        # reprogrammer », alors que les deux sont exactement inverses.
        if fiche.get("sans_campagne"):
            a_faire.append('<span class="pastille st-ignore">📞 il reprend '
                           "contact lui-même</span><br><small>"
                           + html.escape(fiche["sans_campagne"]) + "</small>")
        if not a_faire:
            a_faire = ['<span class="sourd">rien à faire</span>']
        # Le lien mène TOUJOURS à la fiche pleine page (le repli sans
        # JavaScript reste entier) ; quand JavaScript est là, c'est la
        # MODALE qui s'ouvre et l'écran ne change pas.
        return f"""
  <td><a href="/clients/fiche?id={client['id']}"
        data-modale="/clients/detail?id={client['id']}"
        title="Ouvrir son dossier et modifier son nom, son numéro ou l'indicateur 🚫">{html.escape(client['nom'])}</a>{marque_essai}{badge_stop}</td>
  <td>{telephone}</td>
  <td>{colonne_rdv}</td>
  <td>{etats}</td>
  <td class="mini">{campagnes_lisibles}</td>
  <td class="mini">{"<br>".join(a_faire)}</td>
  <td>{bascule}</td>
  <td><a href="/clients/fiche?id={client['id']}"
        data-modale="/clients/detail?id={client['id']}">Modifier…</a><br>
      <a href="/clients/supprimer?id={client['id']}">Supprimer…</a></td>"""

    def _page_fiche_client(self, client_id, valeurs=None, erreurs=None):
        """La fiche d'un client : son dossier ET le formulaire d'édition.

        Rend None si le client n'existe pas. Le numéro n'est JAMAIS
        réaffiché en clair (même ici) : le champ reste vide, et le laisser
        vide garde le numéro tel quel — c'est dit à l'écran.
        """
        base = self.application.base
        client = base.obtenir_client(client_id)
        if client is None:
            return None
        fiches = etats_clients.tableau_clients(base, self.application.preferences)
        fiche = next((f for f in fiches if f["client"]["id"] == client_id), None)
        valeurs = valeurs or {}
        nom = valeurs.get("nom", client["nom"])
        telephone = valeurs.get("telephone", "")
        coche = valeurs.get("ne_plus_appeler", client["ne_plus_appeler"])
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(erreur)}</li>" for erreur in erreurs)
            bloc_erreurs = ('<div class="erreurs"><strong>Saisie refusée '
                            "(rien n'a été enregistré) :</strong>"
                            f"<ul>{elements}</ul></div>")
        siens = [rdv for rdv in base.tous_les_rendezvous()
                 if rdv["client_id"] == client_id]
        if siens:
            lignes = "".join(f"""<tr>
  <td>{self._cellule_horaire(rdv)}</td>
  <td>{html.escape(rdv['motif'])}</td>
  <td>{self._pastille_statut(rdv['statut'])}</td>
  <td>{html.escape(horaires.tranches_lisibles(rdv['duree_tranches'], horaires.pas_minutes(self.application.preferences)))}</td>
  <td><a href="/rendezvous?id={rdv['id']}">Voir la fiche</a></td>
</tr>""" for rdv in sorted(siens, key=lambda r: r["horaire"], reverse=True))
            tableau = ("<table><tr><th>Horaire</th><th>Motif</th><th>Statut</th>"
                       "<th>Durée</th><th></th></tr>" + lignes + "</table>")
        else:
            tableau = "<p>Aucun rendez-vous pour ce client.</p>"
        corps = f"""{self._bandeau()}
<p><a href="/clients">← Retour aux contacts</a></p>
<h1>{html.escape(client['nom'])}</h1>
{bloc_erreurs}
{self._resume_etats_client(fiche)}
<h2>Modifier sa fiche</h2>
<form method="post" action="/clients/modifier" class="carte">
  <input type="hidden" name="client" value="{client['id']}">
{self._champs_client(client, nom, telephone, coche)}
  <button>Enregistrer la fiche</button>
</form>
<h2>Ses rendez-vous ({len(siens)})</h2>
<p><small>Un rendez-vous qui occupe plusieurs tranches consécutives compte
pour <strong>un</strong> rendez-vous.</small></p>
{tableau}
<p><a href="/clients/supprimer?id={client['id']}">Supprimer ce contact…</a></p>"""
        return self._page(client["nom"], corps, actif="clients")

    @staticmethod
    def _champs_client(client, nom, telephone, coche):
        """Les trois champs modifiables d'un client — la MÊME chose dans la
        modale et dans la fiche pleine page, écrites une seule fois.

        Le numéro fait exception à la règle « la valeur existante s'affiche
        DANS son champ » : le masquage prime, alors le champ reste vide, le
        numéro masqué est rappelé juste à côté, et l'écran dit que le laisser
        vide garde le numéro. La case 🚫 garde son contrôle AVANT le texte et
        ne prend jamais toute la largeur.
        """
        return f"""  <label>Nom du contact (deux caractères minimum)<br>
    <input name="nom" value="{html.escape(nom)}" required></label>
  <label>Numéro de téléphone — format attendu : 10 chiffres commençant par 0,
    ou +33 suivi de 9 chiffres (exemple fictif : +33 6 00 00 00 42)<br>
    <input name="telephone" value="{html.escape(telephone)}"
           placeholder="laisser vide pour garder le numéro actuel"></label>
  <p class="ligne-option"><small>Numéro actuel :
    <strong>{html.escape(client['telephone_masque']) or "aucun"}</strong> —
    il n'est jamais réaffiché en clair, même ici. <strong>Laissez le champ
    vide</strong> pour le garder tel quel.</small></p>
  <p class="ligne-option"><label class="option"
     title="Exclut ce client de la file, des cascades et des listes générées — réversible">
    <input type="checkbox" name="ne_plus_appeler" value="1"
           {"checked" if coche else ""}> 🚫 ne plus appeler</label></p>"""

    def _modale_client(self, client_id, valeurs=None, erreurs=None):
        """Le DOSSIER d'un client en modale : ses états ET son édition.

        C'est le chemin normal depuis 👥 Contacts — on ne quitte pas l'écran
        pour modifier quelqu'un. Rend None si le client n'existe plus. La
        fiche pleine page (/clients/fiche) reste le repli sans JavaScript.
        """
        base = self.application.base
        client = base.obtenir_client(client_id)
        if client is None:
            return None
        fiches = etats_clients.tableau_clients(base, self.application.preferences)
        fiche = next((f for f in fiches if f["client"]["id"] == client_id), None)
        valeurs = valeurs or {}
        nom = valeurs.get("nom", client["nom"])
        telephone = valeurs.get("telephone", "")
        coche = valeurs.get("ne_plus_appeler", client["ne_plus_appeler"])
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = ('<div class="erreurs"><strong>Saisie refusée '
                            "(rien n'a été enregistré) :</strong>"
                            f"<ul>{elements}</ul></div>")
        masque = (html.escape(client["telephone_masque"])
                  if client["telephone_masque"] else "<em>aucun numéro</em>")
        corps = f"""<dl>
  <dt>Téléphone</dt><dd>{masque}{essai_reel.badge(client)}</dd>
  <dt>Rendez-vous</dt><dd>{client['nb_rendezvous']}</dd>
</dl>
{self._resume_etats_client(fiche)}
{bloc_erreurs}
<form method="post" action="/clients/detail/enregistrer" class="carte"
      data-modale-envoi>
  <input type="hidden" name="client" value="{client['id']}">
{self._champs_client(client, nom, telephone, coche)}
  <button>Enregistrer</button>
</form>
<p class="mini">Enregistrer ferme cette fenêtre et remet à jour
<strong>sa seule ligne</strong> dans la liste — la page ne se recharge pas.</p>
<p><a class="bouton" href="/clients/fiche?id={client['id']}">Ouvrir la fiche complète</a>
<a href="/clients/supprimer?id={client['id']}">Supprimer ce contact…</a></p>"""
        return self._modale(f"👥 {html.escape(client['nom'])}", corps)

    def _fiche_de(self, client_id):
        """La fiche calculée d'UN client, ou None s'il n'existe plus."""
        fiches = etats_clients.tableau_clients(self.application.base,
                                               self.application.preferences)
        return next((f for f in fiches if f["client"]["id"] == client_id), None)

    def _modale_campagnes_client(self, client_id):
        """Les campagnes qui contiennent ce client — le détail sorti du tableau.

        Il tenait dans une cellule et faisait six lignes de haut par client.
        Il est ici, entier, au clic sur le nombre.
        """
        fiche = self._fiche_de(client_id)
        if fiche is None:
            return None
        nom = fiche["client"]["nom"]
        if not fiche["campagnes"]:
            corps = "<p>Aucune campagne en cours ne le concerne.</p>"
        else:
            lignes = "".join(
                f'<li><a href="/campagne?id={entree["campagne_id"]}">'
                f'{html.escape(entree["nom"])}</a><br>'
                f'<small>{html.escape(entree["nature_lisible"])} — entré '
                "pour : "
                + (html.escape(entree["etat_entree"]) if entree["etat_entree"]
                   else "ajouté à la main")
                + " — état dans la campagne : "
                + html.escape(entree["etat_contact"] or "—")
                + "</small></li>"
                for entree in fiche["campagnes"])
            corps = (f"<p>{len(fiche['campagnes'])} campagne(s) en cours "
                     f"le concernent :</p><ul>{lignes}</ul>")
        return self._modale(f"Campagnes — {html.escape(nom)}", corps)

    def _modale_rendezvous_client(self, client_id):
        """Tous ses rendez-vous, du plus récent au plus ancien.

        La colonne ne montre plus que leur nombre ; le détail (prochain,
        dernier, statuts) est ici, et il est même plus complet qu'avant :
        c'est la liste elle-même, pas un résumé.
        """
        base = self.application.base
        client = base.obtenir_client(client_id)
        if client is None:
            return None
        rendezvous = sorted(base.rendezvous_du_client(client_id),
                            key=lambda i: (base.obtenir_rendezvous(i) or {})
                            .get("horaire", ""), reverse=True)
        if not rendezvous:
            corps = "<p>Aucun rendez-vous pour cette personne.</p>"
        else:
            lignes = []
            for rdv_id in rendezvous:
                rdv = base.obtenir_rendezvous(rdv_id)
                if rdv is None:
                    continue
                lignes.append(
                    f"<tr><td>{_date_lisible(rdv['horaire'])}</td>"
                    f"<td>{html.escape(rdv['motif'] or '—')}</td>"
                    f"<td>{self._pastille_statut(rdv['statut'])}</td></tr>")
            corps = (f"<p>{len(lignes)} rendez-vous, du plus récent au plus "
                     "ancien :</p><table><tr><th>Quand</th><th>Motif</th>"
                     f"<th>Statut</th></tr>{''.join(lignes)}</table>")
        return self._modale(
            f"Rendez-vous — {html.escape(client['nom'])}", corps)

    def _resume_etats_client(self, fiche):
        """Les deux états d'un client, ses campagnes en cours et ses besoins."""
        if fiche is None:
            return ""
        campagnes_lisibles = "".join(
            f'<li><a href="/campagne?id={entree["campagne_id"]}">'
            f'{html.escape(entree["nom"])}</a> — {html.escape(entree["nature_lisible"])}'
            " — entré pour : "
            + (html.escape(entree["etat_entree"]) if entree["etat_entree"]
               else "ajouté à la main")
            + f' — état dans la campagne : {html.escape(entree["etat_contact"] or "—")}</li>'
            for entree in fiche["campagnes"])
        if campagnes_lisibles:
            bloc_campagnes = ("<p>Campagnes en cours qui le concernent :</p>"
                              f"<ul>{campagnes_lisibles}</ul>")
        else:
            bloc_campagnes = ("<p>Aucune campagne en cours ne le concerne.</p>")
        besoins = "".join(
            f"<li>{html.escape(besoin['action'])} — "
            + ("pris en charge par : " + ", ".join(
                html.escape(entree.get("campagne_nom") or "—")
                for entree in besoin["traite_par"])
               if besoin["traite"]
               else ("🚫 exclu de tout appel" if fiche["exclu"]
                     else "☎ sans numéro : rien n'est possible tant que la "
                          "fiche n'est pas complétée" if fiche["sans_numero"]
                     else "🙋 aucune campagne ne traite cela : c'est du travail "
                          "humain" if besoin["humain"] else "⚠ non traité"))
            + "</li>" for besoin in fiche["besoins"])
        bloc_besoins = (f"<p>Ce qu'il reste à faire :</p><ul>{besoins}</ul>"
                        if besoins else "<p>Rien à faire pour lui.</p>")
        # Pourquoi rien n'est à faire, quand l'état l'explique lui-même.
        if fiche.get("sans_campagne"):
            bloc_besoins += ('<p class="pastille st-ignore">📞 '
                             + html.escape(fiche["sans_campagne"]) + "</p>")
        return f"""<p>
  <span class="pastille {etats_clients.classe(fiche['agenda'])}">
    Agenda : {html.escape(etats_clients.libelle_agenda(fiche['agenda']))}</span>
  <span class="pastille {etats_clients.classe(fiche['conversation'])}">
    Conversation : {html.escape(etats_clients.libelle_conversation(fiche['conversation'], fiche['tentatives']))}</span>
</p>
{bloc_campagnes}
{bloc_besoins}"""

    def _page_confirmer_suppression(self, client_id):
        """La page de confirmation AVANT suppression — jamais en un clic."""
        client = self.application.base.obtenir_client(client_id)
        if client is None:
            return None
        telephone = (html.escape(client["telephone_masque"])
                     if client["telephone_masque"] else "<em>aucun numéro</em>")
        corps = f"""{self._bandeau()}
<p><a href="/clients">← Retour aux contacts</a></p>
<h1>Supprimer ce contact ?</h1>
<div class="erreurs"><p><strong>Action définitive.</strong> La suppression
retire le contact ET tous ses rendez-vous (avec leurs appels enregistrés) —
rien de tout cela ne sera récupérable.</p></div>
<p>Contact : <strong>{html.escape(client['nom'])}</strong> — {telephone}<br>
Rendez-vous qui seront supprimés avec lui :
<strong>{client['nb_rendezvous']}</strong></p>
<form method="post" action="/clients/supprimer">
  <input type="hidden" name="client" value="{client['id']}">
  <input type="hidden" name="confirmer" value="oui">
  <button class="danger">Supprimer définitivement — contact et rendez-vous</button>
</form>
<p><a href="/clients">Annuler — revenir à la liste des contacts</a></p>"""
        return self._page("Supprimer ce contact ?", corps, actif="clients")

    def _formulaires_appels(self, action="/reglages/enregistrer",
                            bouton="Enregistrer", icones=True,
                            id_formulaire=""):
        """Les CINQ formulaires de « 📞 Appels », rendus une seule fois.

        Ils servent à DEUX écrans : la page ⚙ Réglages, et l'installeur du
        premier lancement — qui fait remplir exactement les mêmes réglages.
        Les dupliquer aurait garanti qu'ils divergent ; ils sont donc écrits
        ici, avec leur adresse d'envoi et leur libellé de bouton en
        paramètre.

        `bouton` vide = AUCUN bouton d'envoi : l'installeur n'en a plus, son
        pied fixe soumet le formulaire par son identifiant (03/08/2026).
        `icones` = False retire le pictogramme des titres, pour l'installeur
        seulement. `id_formulaire` nomme le formulaire pour que ce pied puisse
        le viser.

        Rend un dictionnaire {code de sous-partie: HTML}.
        """
        preferences = self.application.preferences
        def picto(signe):
            """Le pictogramme du titre, ou rien du tout."""
            return f"{signe} " if icones else ""
        ouvre = (f'<form method="post" action="{action}" class="carte"'
                 + (f' id="{id_formulaire}"' if id_formulaire else "") + ">")
        envoi = f"<button>{bouton}</button>" if bouton else ""
        entreprise = preferences.obtenir(themes.CLE_ENTREPRISE) or ""
        debut, fin = themes.plage(preferences)
        relance_delai, relance_max = campagnes.parametres_relance(preferences)
        interdit_debut = preferences.obtenir(assistant.CLE_INTERDIT_DEBUT) or ""
        interdit_fin = preferences.obtenir(assistant.CLE_INTERDIT_FIN) or ""
        mode_relance = preferences.obtenir(assistant.CLE_RELANCE_MODE) or "delai"
        coche_delai = "" if mode_relance == "creneau" else " selected"
        coche_creneau = " selected" if mode_relance == "creneau" else ""
        creneau_debut = preferences.obtenir(
            assistant.CLE_RELANCE_CRENEAU_DEBUT) or ""
        creneau_fin = preferences.obtenir(
            assistant.CLE_RELANCE_CRENEAU_FIN) or ""
        seuil_remplacement = horaires.seuil_remplacement(preferences)
        delais = calle_client.delais_regles(preferences)
        # ⚠ CINQ SOUS-PARTIES, CINQ FORMULAIRES. Chacun n'envoie que SES
        # champs, et _traiter_reglages ne touche qu'aux réglages reçus
        # (absent = inchangé). Un formulaire unique de cent lignes forçait à
        # traverser six sujets sans rapport pour en corriger un.
        sous_identite = f"""<h2 id="identite">{picto("🏷")}Identité de l'établissement</h2>
{ouvre}
  <label>Nom de l'entreprise — remplace [entreprise] dans les missions<br>
    <input name="entreprise" value="{html.escape(entreprise)}"
           placeholder="Cabinet Dupont Kinésithérapie"></label>
  <p><small>Il est dit à voix haute au début de chaque appel. Saisi une
  fois, il est repris par toutes les campagnes suivantes.</small></p>
  {envoi}
</form>"""
        sous_plage = f"""<h2 id="appel">{picto("⏰")}Quand RingBack a le droit d'appeler</h2>
{ouvre}
  <label>Plage d'appel autorisée — début<br>
    <input type="time" name="plage_debut" value="{html.escape(debut)}"></label>
  <label>Plage d'appel autorisée — fin<br>
    <input type="time" name="plage_fin" value="{html.escape(fin)}"></label>
  <p><small>Hors de cette plage ({html.escape(themes.plage_lisible(preferences))}),
  tout lancement d'appel est refusé — politesse d'abord.</small></p>
  <label>⛔ Période interdite — début (ex. 12:00 ; laisser les deux champs
    vides pour aucune)<br>
    <input type="time" name="interdit_debut"
           value="{html.escape(interdit_debut)}"></label>
  <label>⛔ Période interdite — fin (ex. 14:00)<br>
    <input type="time" name="interdit_fin"
           value="{html.escape(interdit_fin)}"></label>
  <p><small>La période interdite PRIME sur tout : aucun appel ni relance ne
  s'y déclenche ni ne s'y programme, quelle que soit la campagne — un
  ▶ Démarrer y est réellement refusé.</small></p>
  {envoi}
</form>"""
        sous_relances = f"""<h2 id="relances">{picto("🔁")}Relances par défaut</h2>
{ouvre}
  <label class="champ-option">🔁 Relances — quand rappeler par défaut (chaque
    campagne peut l'ajuster)<br>
    <select class="select-option" name="relance_mode" id="reglage_relance_mode"
            data-bascule="reglage-bloc-creneau|reglage-bloc-delai">
      <option value="delai"{coche_delai}>après un délai (heures ouvrées)</option>
      <option value="creneau"{coche_creneau}>dans un créneau de rappel
      (ex. la pause déjeuner du contact)</option></select></label>
  <div id="reglage-bloc-delai">
    <label>🔁 Délai par défaut, en heures OUVRÉES comptées dans la plage
      d'appel<br>
      <input type="number" name="relance_delai" min="0" max="168"
             value="{relance_delai}"></label>
  </div>
  <div id="reglage-bloc-creneau">
    <label>🔁 Créneau de rappel par défaut — début<br>
      <input type="time" name="relance_creneau_debut"
             value="{html.escape(creneau_debut)}"></label>
    <label>🔁 Créneau de rappel par défaut — fin<br>
      <input type="time" name="relance_creneau_fin"
             value="{html.escape(creneau_fin)}"></label>
  </div>
  <label>🔁 Relances — nombre maximal de rappels par contact<br>
    <input type="number" name="relance_max" min="0" max="9"
           value="{relance_max}"></label>
  <p><small>Tout appel non abouti programme une relance (par délai ou dans
  le créneau de rappel — échéance modifiable ensuite) ; au plafond de
  rappels, le contact passe 📵 injoignable. Une relance ne part JAMAIS
  seule : geste humain obligatoire sur la page 🔁 Relances.</small></p>
  {envoi}
</form>"""
        sous_remplacement = f"""<h2 id="remplacement">{picto("⏱")}Annulation et remplacement</h2>
{ouvre}
  <label>⏱ Annulation pendant un appel — combien d'heures AVANT le
    rendez-vous peut-on encore organiser un remplacement ?<br>
    <input class="champ-court" type="number" name="seuil_remplacement"
           min="{horaires.SEUIL_REMPLACEMENT_MINIMUM}"
           max="{horaires.SEUIL_REMPLACEMENT_MAXIMUM}"
           value="{seuil_remplacement}"></label>
  <p><small>Un contact annule au téléphone : si son rendez-vous est à
  <strong>plus de {seuil_remplacement} h</strong>, il est
  <strong>supprimé</strong> (sa place redevient libre) et le récapitulatif de
  la campagne vous <strong>propose</strong> une campagne 📞 « créneau libéré »
  pour la remplir — rien ne part sans votre clic. À <strong>moins de
  {seuil_remplacement} h</strong>, il reste <strong>« annulé »</strong> et
  l'écran dit qu'il est trop tard pour organiser un remplacement
  automatiquement. Un rendez-vous déjà passé garde toujours
  « annulé » : c'est le statut d'histoire.</small></p>
  {envoi}
</form>"""
        sous_delais = f"""<h2 id="delais">{picto("⏱")}Combien de temps attendre un vrai appel</h2>
{ouvre}
  <p><small>Ces trois durées ne concernent que les <strong>appels
  réels</strong> — la simulation, elle, se conclut en une seconde et n'est pas
  ralentie. Elles ont été réglées pour une <strong>vraie conversation</strong> :
  sonnerie, échange, puis le temps que CALL-E rédige son compte rendu. Trop
  courtes, RingBack abandonne alors que la personne est encore au téléphone —
  c'est ce qui s'est produit le 01/08/2026.</small></p>
  <label>⏱ Attente maximale d'un appel, en secondes — sonnerie + conversation
    + compte rendu (de {calle_client.BORNES_DELAIS[
        calle_client.CLE_DELAI_TOTAL][0]} à {calle_client.BORNES_DELAIS[
        calle_client.CLE_DELAI_TOTAL][1]} ; {int(
        calle_client.DELAI_TOTAL_DEFAUT)} par défaut, soit 10 minutes)<br>
    <input class="champ-court" type="number"
           name="{calle_client.CLE_DELAI_TOTAL}"
           min="{calle_client.BORNES_DELAIS[calle_client.CLE_DELAI_TOTAL][0]}"
           max="{calle_client.BORNES_DELAIS[calle_client.CLE_DELAI_TOTAL][1]}"
           value="{int(delais['delai_total'])}"></label>
  <label>⏱ Intervalle entre deux vérifications, en secondes — au bout de ce
    délai RingBack redemande où en est l'appel (de {calle_client.BORNES_DELAIS[
        calle_client.CLE_DELAI_INTERVALLE][0]} à {calle_client.BORNES_DELAIS[
        calle_client.CLE_DELAI_INTERVALLE][1]} ; {int(
        calle_client.DELAI_INTERVALLE_DEFAUT)} par défaut)<br>
    <input class="champ-court" type="number"
           name="{calle_client.CLE_DELAI_INTERVALLE}"
           min="{calle_client.BORNES_DELAIS[
               calle_client.CLE_DELAI_INTERVALLE][0]}"
           max="{calle_client.BORNES_DELAIS[
               calle_client.CLE_DELAI_INTERVALLE][1]}"
           value="{int(delais['intervalle'])}"></label>
  <label>⏱ Délai d'attente d'UNE demande à CALL-E, en secondes — le temps
    laissé au service pour répondre à une seule question (de
    {calle_client.BORNES_DELAIS[calle_client.CLE_DELAI_REQUETE][0]} à
    {calle_client.BORNES_DELAIS[calle_client.CLE_DELAI_REQUETE][1]} ;
    {int(calle_client.DELAI_REQUETE_DEFAUT)} par défaut)<br>
    <input class="champ-court" type="number"
           name="{calle_client.CLE_DELAI_REQUETE}"
           min="{calle_client.BORNES_DELAIS[calle_client.CLE_DELAI_REQUETE][0]}"
           max="{calle_client.BORNES_DELAIS[calle_client.CLE_DELAI_REQUETE][1]}"
           value="{int(delais['delai_requete'])}"></label>
  <p><small>Si l'attente est quand même dépassée, <strong>l'appel n'est pas
  perdu</strong> : RingBack garde son numéro chez CALL-E, le contact passe
  <strong>« ⏱ appelé, résultat inconnu »</strong> — jamais « injoignable » —
  et le bouton <strong>« 📥 Récupérer les résultats en attente »</strong> de la
  fiche de campagne va lire le résultat plus tard, sans rappeler
  personne.</small></p>
  {envoi}
</form>"""
        return {"identite": sous_identite, "appel": sous_plage,
                "relances": sous_relances, "remplacement": sous_remplacement,
                "delais": sous_delais}

    def _page_reglages(self, parametres=None, erreurs=None):
        """La page « ⚙ Réglages » : entreprise, créneaux, plage d'appel.

        Ces réglages nourrissent les gabarits de mission ([entreprise],
        [créneaux_disponibles], [plage_rappel]) et le garde-fou de plage
        horaire. Stockés dans donnees/preferences.json, comme le dernier
        choix d'ordre de cascade.
        """
        parametres = parametres or {}
        preferences = self.application.preferences
        bloc_message = ""
        if parametres.get("installeur", [""])[0] == "remis":
            bloc_message = (
                '<p class="pastille st-confirme">Installeur réinitialisé. '
                "<strong>Actualisez l'accueil</strong> et la configuration "
                'guidée réapparaîtra — ou <a href="/?installation=1">ouvrez-la '
                "tout de suite</a>. Aucun de vos réglages n'a été touché.</p>")
        elif parametres.get("fait", [""])[0] == "1":
            bloc_message = '<p class="pastille">Réglages enregistrés.</p>'
        elif parametres.get("essai", [""])[0] == "charge":
            bloc_message = (
                f'<p class="pastille st-confirme">Jeu d\'essai chargé : '
                f'{parametres.get("clients", ["0"])[0]} client(s) et '
                f'{parametres.get("rdv", ["0"])[0]} rendez-vous d\'ESSAI '
                "ajoutés à vos données (rien n'a été effacé).</p>")
        elif parametres.get("essai", [""])[0] == "retire":
            desarmees = parametres.get("desarmees", ["0"])[0]
            precision = ""
            if desarmees not in ("0", ""):
                precision = (f" {html.escape(desarmees)} relance(s) encore "
                             "programmée(s) ont été annulées : plus aucun "
                             "appel d'essai ne peut partir.")
            bloc_message = (
                f'<p class="pastille">Jeu d\'essai retiré : '
                f'{parametres.get("clients", ["0"])[0]} client(s) et '
                f'{parametres.get("rdv", ["0"])[0]} rendez-vous d\'essai '
                f"supprimés.{precision} Vos données sont intactes.</p>")
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = (f'<div class="erreurs"><strong>Réglage refusé :</strong>'
                            f"<ul>{elements}</ul></div>")
        formulaires = self._formulaires_appels()
        sous_identite = formulaires["identite"]
        sous_plage = formulaires["appel"]
        sous_relances = formulaires["relances"]
        sous_remplacement = formulaires["remplacement"]
        sous_delais = formulaires["delais"]
        sous_essai_reel = f"""<h2 id="essai-reel">🧪 Essai en conditions réelles — la campagne</h2>
<div id="bloc-campagne-essai">{self._bloc_essai_reel()}</div>"""
        faites_pages, total_pages = installation.progression(
            preferences, self._natures_installeur())
        etat_install = (
            "La variable de premier lancement est <strong>posée</strong> : "
            "l'installeur ne s'ouvre plus tout seul."
            if installation.terminee(preferences) else
            "La variable de premier lancement n'est <strong>pas</strong> "
            "posée : l'installeur s'ouvrira dès la prochaine visite de "
            "l'accueil.")
        sous_installeur = f"""<h2 id="installeur">🚀 Installeur — la configuration guidée</h2>
<p>La fenêtre du premier lancement reprend TOUS les réglages de cette page,
un à la fois, dans un ordre qui a un sens. Elle ne demande rien de plus :
c'est le même produit, présenté autrement.</p>
<p><strong>{faites_pages} page(s) réglée(s) sur {total_pages}.</strong>
{etat_install}</p>
<form method="post" action="/installation/rouvrir" class="carte">
  <p>Ce bouton <strong>réinitialise la variable d'installation</strong> :
  toutes les pages repassent « à configurer », et il suffit ensuite
  d'<strong>actualiser l'accueil</strong> pour que l'installeur
  réapparaisse.</p>
  <p><small>Vos réglages ne sont PAS touchés — ils s'affichent tels que vous
  les avez laissés. C'est le parcours qu'on refait, pas les valeurs.</small></p>
  <button class="secondaire">Réinitialiser l'installeur</button>
</form>
<p><small>Pour l'ouvrir sans attendre :
<a href="/?installation=1">reprendre la configuration maintenant</a>.</small></p>"""
        corps = f"""{self._bandeau()}
<h1>⚙ Réglages</h1>
{bloc_message}
{bloc_erreurs}
{_reglages_en_sections([
    ("appel", "📞 Appels", [
        ("identite", "Identité", sous_identite),
        ("appel", "Plage d'appel", sous_plage),
        ("relances", "Relances", sous_relances),
        ("remplacement", "Annulation", sous_remplacement),
        ("delais", "Délais d'un appel réel", sous_delais)]),
    ("discours", "🗣 Discours de l'agent", self._sous_parties_discours()),
    ("comportement", "⚙ Options de comportement",
     self._sous_parties_comportement()),
    ("agenda", "🗓 Agenda", [
        ("horaires", "Horaires d'ouverture",
         f'<div id="bloc-horaires">{self._bloc_horaires()}</div>'),
        ("jours-fermes", "Jours fermés",
         f'<div id="bloc-jours-fermes">{self._bloc_jours_fermes()}</div>')]),
    ("calle", "🔌 CALL-E", [
        ("calle", "La clé et les verrous", self._bloc_calle())]),
    ("essai", "🧪 Essais", [
        # ⚠ L'AGENDA D'EXEMPLE EST DANS « Jeu d'essai » (15/08/2026, sa
        # demande). Les deux fabriquent la même chose — de quoi essayer sans
        # toucher aux vraies données — et les séparer obligeait à chercher
        # dans deux sous-parties ce qui se fait d'un même geste.
        ("jeu-essai", "Jeu d'essai", self._bloc_jeu_essai()),
        ("renvoi-essai", "Toujours mon numéro", self._section_renvoi_essai()),
        ("numero-essai", "Testeurs", self._section_testeurs()),
        ("essai-reel", "Campagne d'essai réel", sous_essai_reel),
        ("installeur", "Installeur", sous_installeur)]),
])}
<script>
(function(){{
var m=document.getElementById('reglage_relance_mode'),
d=document.getElementById('reglage-bloc-delai'),
c=document.getElementById('reglage-bloc-creneau');
function bascule(){{if(!m||!d||!c){{return}}
var k=m.value==='creneau';d.hidden=k;c.hidden=!k;}}
if(m){{m.addEventListener('change',bascule);}}
bascule();
}})();
</script>
{SCRIPT_TESTEURS}
{SCRIPT_RENVOI_ESSAI}
{self._script_comportement()}
{SCRIPT_REGLAGES}"""
        return self._page("Réglages", corps, actif="reglages")

    def _bloc_calle(self, message="", refus="", retour=""):
        """La partie « 🔌 CALL-E » : l'état de la clé, le champ, et c'est tout.

        ⚠ REFAITE LE 10/08/2026, sur demande du propriétaire : « toute
        l'histoire des trois verrous on supprime, ce qu'on veut ici c'est la clé
        et c'est tout ». La liste des trois verrous, les paragraphes sur le
        stockage, l'adresse de l'API et ses variables d'environnement : tout
        cela a quitté l'écran pour la procédure repliée.

        ⚠ LES VERROUS EUX-MÊMES N'ONT PAS BOUGÉ. C'est leur RÉCIT qui part. Ce
        qu'il faut faire pour que les appels partent vraiment est la DERNIÈRE
        étape de la procédure — là où on en a besoin, et nulle part ailleurs.
        """
        etat = calle_client.etat_de_la_cle()
        # ① L'état, en une ligne. Trois cas, et pas un de plus.
        if not etat["presente"]:
            pastille = ("<p>Aucune clé enregistrée — les appels sont "
                        "<strong>simulés</strong>.</p>")
        elif not etat["valable"]:
            pastille = ('<div class="erreurs"><strong>Cette clé n\'a pas la '
                        "forme d'une clé.</strong> "
                        f'{html.escape(etat["refus"])}</div>')
        else:
            pastille = ('<p class="pastille">✅ Clé enregistrée '
                        f'({html.escape(etat["description"])}), fournie par '
                        f'{html.escape(etat["source"])}.</p>')
        # ⚠ LA CLÉ RANGÉE QUI NE SERT PAS (03/09/2026). La variable
        # d'environnement gagne contre le fichier — c'est voulu — mais rien
        # ne le disait : coller une clé ici pouvait n'avoir AUCUN effet,
        # l'écran affichant tranquillement « clé enregistrée ». Le jour où une
        # campagne s'arrête sur un refus, on recolle sa clé, on relance, et on
        # obtient le même refus sans comprendre.
        if etat.get("ignoree"):
            pastille += (
                '<div class="erreurs"><strong>⚠ La clé enregistrée ici n\'est '
                'PAS celle qui sert.</strong> Une AUTRE clé est posée dans '
                f'{html.escape(calle_client.SOURCE_VARIABLE)}, et elle gagne '
                'contre le fichier. Celle que vous avez enregistrée '
                f'({html.escape(etat["ignoree"])}) est mise de côté. Pour '
                'qu\'elle serve : fermez RingBack, retirez la variable '
                f'<code>{calle_client.AppelReel.VARIABLE_CLE}</code> de votre '
                'session (ou de vos variables Windows), puis relancez.</div>')
        bloc_message = (f'<p class="pastille">{html.escape(message)}</p>'
                        if message else "")
        bloc_refus = (f'<div class="erreurs">{html.escape(refus)}</div>'
                      if refus else "")
        champ_retour = ('<input type="hidden" name="retour" value="'
                        + html.escape(retour, quote=True) + '">'
                        if retour else "")
        retrait = ""
        if calle_client.cle_rangee():
            retrait = f"""<form method="post" action="/reglages/calle-retirer">
  {champ_retour}
  <button class="secondaire">Retirer la clé</button>
</form>"""
        url = (os.environ.get(calle_client.AppelReel.VARIABLE_URL)
               or calle_client.AppelReel.URL_DEFAUT)
        # ② LA PROCÉDURE, repliée. « Lien et démarche de bout en bout », dit la
        # demande : les étapes vont donc jusqu'au lancement en mode réel — sans
        # elle, on aurait une clé et rien qui part.
        procedure = _aide("Comment obtenir une clé CALL-E ?", f"""<ol>
  <li>Créez un compte sur <code>heycall-e.com</code>.</li>
  <li>Ouvrez le tableau de bord <code>dashboard.heycall-e.com</code>,
  section <strong>API keys</strong>.</li>
  <li>Créez une clé, puis copiez-la. <strong>La clé elle-même</strong>, pas
  l'adresse du site — c'est la confusion qui a fait échouer le premier essai
  réel.</li>
  <li>Collez-la dans le champ ci-dessus et enregistrez.</li>
  <li>Pour que les appels partent <strong>vraiment</strong> : relancez avec
  <code>python lancer_serveur.py --appels-reels</code> et retapez
  <code>APPELER</code> quand c'est demandé. Tant que ce n'est pas fait, la clé
  ne déclenche rien.</li>
</ol>
<p><small>La clé est rangée dans <code>donnees/cle_calle.txt</code> et
n'est <strong>jamais réaffichée</strong>. Vous préférez ne rien écrire sur le
disque ? Posez la variable d'environnement
<code>{calle_client.AppelReel.VARIABLE_CLE}</code> : elle gagne contre le
fichier.</small></p>
<p><small>Adresse de l'API : <code>{html.escape(url)}</code>
{"" if os.environ.get(calle_client.AppelReel.VARIABLE_URL)
 else "(par défaut)"} — elle se règle par
<code>{calle_client.AppelReel.VARIABLE_URL}</code>, et on n'y touche que pour
viser un autre serveur que celui de CALL-E.</small></p>""")
        return f"""{bloc_message}{bloc_refus}
{pastille}
<form method="post" action="/reglages/calle" class="carte" style="max-width:34rem">
  {champ_retour}
  <label>Votre clé CALL-E{procedure}<br>
    <input type="password" name="cle" autocomplete="off" spellcheck="false"
           placeholder="collez-la ici"></label>
  <button>Enregistrer la clé</button>
</form>
{retrait}"""

    def _traiter_cle_calle(self, corps):
        """Range la clé collée — après contrôle de forme, jamais avant.

        ⚠ LE REFUS NE CITE JAMAIS LA CLÉ : `valider_forme_cle` la décrit. Une
        clé fausse recopiée dans un message d'erreur finirait dans une capture
        d'écran ou un rapport de bogue.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        brut = donnees.get("cle", [""])[0]
        # ⚠ ON REVIENT OÙ L'ON ÉTAIT. Le même formulaire sert dans ⚙ Réglages
        # et dans l'installeur : renvoyer toujours aux Réglages faisait SORTIR
        # du parcours de configuration, au milieu.
        retour = donnees.get("retour", [""])[0]
        if not brut.strip():
            return self._refus_cle(
                "Aucune clé n'a été collée : le champ était vide.", retour)
        try:
            calle_client.ranger_cle(brut)
        except calle_client.CleApiAbsente as refus:
            return self._refus_cle(str(refus), retour)
        if retour:
            return self._rediriger(f"/installation?page={retour}&fait=cle")
        return self._rediriger("/reglages?fait=cle#calle")

    def _refus_cle(self, raison, retour):
        """Le refus, sur l'écran d'où venait la saisie — jamais sur l'autre.

        Chacun des deux écrans a déjà sa façon d'afficher un refus : on
        emprunte la sienne, au lieu d'en inventer une troisième.
        """
        if retour:
            return self._repondre(
                self._page_installeur(retour, erreurs=[raison]), 400)
        return self._repondre(self._page_reglages(erreurs=[raison]), 400)

    def _traiter_retrait_cle_calle(self, corps):
        """Supprime le fichier de clé. La variable, elle, n'est pas touchée."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        calle_client.retirer_cle()
        retour = donnees.get("retour", [""])[0]
        if retour:
            return self._rediriger(
                f"/installation?page={retour}&fait=cle-retiree")
        return self._rediriger("/reglages?fait=cle-retiree#calle")

    def _traiter_discours(self, corps):
        """La page ⚙ Réglages enregistre les textes d'ouverture."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        erreurs = self._appliquer_discours(donnees)
        if erreurs:
            return self._repondre(self._page_reglages(erreurs=erreurs), 400)
        return self._rediriger("/reglages?fait=1#discours")

    def _appliquer_discours(self, donnees):
        """Écrit les textes d'ouverture reçus ; rend la liste des refus.

        Un texte qui contient un NUMÉRO DE TÉLÉPHONE est refusé : ce texte
        part mot pour mot à l'agent, et un numéro dicté au téléphone est
        exactement ce que le produit s'interdit partout ailleurs. Le refus
        cite la nature en cause, et RIEN n'est enregistré — la saisie
        revient telle qu'elle a été tapée.

        Séparé de la réponse HTTP pour que l'installeur du premier
        lancement écrive par le MÊME chemin que la page ⚙ Réglages.
        """
        fautifs, a_ecrire = [], {}
        for nature, definition in assistant.NATURES.items():
            cle = assistant.cle_discours(nature)
            if cle not in donnees:
                continue
            texte = donnees[cle][0].strip()
            if texte and calle_client.contient_numero(texte):
                fautifs.append(definition["nom"])
            a_ecrire[cle] = texte
        if fautifs:
            return ["Un numéro de téléphone a été trouvé dans le discours de « "
                    + " », « ".join(fautifs)
                    + " ». Ce texte est dicté tel quel à l'agent : aucun "
                      "numéro ne doit y figurer. Rien n'a été enregistré."]
        for cle, texte in a_ecrire.items():
            self.application.preferences.definir(cle, texte)
        journal.info("Discours de l'agent enregistré pour %d nature(s).",
                     len(a_ecrire))
        return []

    # Les options réglables par nature, avec leur libellé d'écran. L'ordre
    # est celui du formulaire de campagne : on retrouve les mêmes mots au
    # même endroit, ce qui évite d'avoir à traduire mentalement.
    LIBELLES_COMPORTEMENT = (
        ("recontacter", "🔁 Recontacter si non joignable"),
        ("liberer_creneau",
         "Un rendez-vous déplacé ou annulé libère son créneau"),
        ("cascade", "Décaler en cascade (la campagne suivante est PRÉPARÉE, "
                    "jamais lancée)"),
        ("repondeur_sans_motif", "Répondeur : message court sans le motif"),
    )

    def _sous_options_relance(self, nature, options):
        """Le détail des relances — montré seulement si « Recontacter » l'est.

        Les mêmes quatre réglages que le formulaire de campagne, aux mêmes
        mots : quand rappeler, le délai OU le créneau, et le plafond. Sans
        eux, cocher « Recontacter » ici ne réglait rien de ce qui compte.

        Les valeurs de départ sont celles des réglages GÉNÉRAUX (⚙ Réglages →
        📞 Appels → Relances) : ce n'est pas une seconde source, c'est la
        même, qu'une nature peut ensuite décaler pour elle seule.
        """
        mode = options.get("relance_mode") or "delai"
        prefixe = f"regl_{nature}"
        return f"""<div class="sous-options" id="{prefixe}_bloc">
  <label class="champ-option">Quand rappeler<br>{assistant_web._selecteur(
      "relance_mode", [("delai", "après un délai"),
                       ("creneau", "dans un créneau horaire")],
      mode, identifiant=f"{prefixe}_mode")}</label>
  <div id="{prefixe}_delai">
    <label class="champ-option">Délai, en heures ouvrées de la plage d'appel
      <input class="champ-court" type="number" name="relance_delai" min="0"
             max="168"
             value="{html.escape(str(options.get('relance_delai', '')))}">
    </label>
  </div>
  <div id="{prefixe}_creneau">
    <label class="champ-option">Rappeler entre
      <input class="champ-court" type="time" name="relance_creneau_debut"
             value="{html.escape(options.get('relance_creneau_debut', ''))}">
      et
      <input class="champ-court" type="time" name="relance_creneau_fin"
             value="{html.escape(options.get('relance_creneau_fin', ''))}">
    </label>
  </div>
  <label class="champ-option">Nombre maximal de rappels
    <input class="champ-court" type="number" name="relance_max" min="0" max="9"
           value="{html.escape(str(options.get('relance_max', '')))}">
  </label>
</div>"""

    def _script_comportement(self):
        """Le dévoilement en cascade des écrans « options par nature ».

        Un écran par nature, donc des identifiants préfixés par la nature :
        sans cela, huit blocs porteraient le même nom et le premier
        répondrait pour tous. Le script travaille par PAIRES (la case et son
        bloc), ce qui le rend indifférent au nombre de natures.

        Sans JavaScript, tout reste visible : on voit le détail des relances
        même décoché — moins agréable, jamais bloquant.
        """
        return """<script>
(function(){
var cases=document.querySelectorAll('[id^="regl_"][id$="_recontacter"]');
if(!cases.length){return}
function nature(element,suffixe){
  return element.id.slice(5,element.id.length-suffixe.length);}
function bascule(){
  Array.prototype.forEach.call(cases,function(c){
    var n=nature(c,'_recontacter');
    var bloc=document.getElementById('regl_'+n+'_bloc');
    if(bloc){bloc.hidden=!c.checked}
    var m=document.getElementById('regl_'+n+'_mode');
    var d=document.getElementById('regl_'+n+'_delai');
    var k=document.getElementById('regl_'+n+'_creneau');
    if(m&&d&&k){var creneau=m.value==='creneau';d.hidden=creneau;
      k.hidden=!creneau}});}
Array.prototype.forEach.call(cases,function(c){
  c.addEventListener('change',bascule);
  var m=document.getElementById('regl_'+nature(c,'_recontacter')+'_mode');
  if(m){m.addEventListener('change',bascule)}});
bascule();
})();
</script>"""

    def _sous_parties_comportement(self):
        """Les valeurs par défaut des options, NATURE PAR NATURE.

        Demandé par le propriétaire le 02/08/2026 : « on aura dans le menu
        vertical Option de comportement, qui déplie les différents types de
        campagne et lorsqu'on clique on a les options par défaut ».

        Deux règles tenues ici :
        - on ne propose QUE les options qui existent pour la nature (la
          politique d'appel seulement si elle est modifiable, la question
          d'annulation seulement pour les natures dont le message en dépend).
          Proposer une option muette serait un mensonge d'interface ;
        - le réglage ne touche QUE les campagnes à venir, et l'écran le dit :
          une campagne créée fige ses options dans sa configuration.
        """
        return [(f"comportement-{nature}", assistant.NATURES[nature]["nom"],
                 self._formulaire_comportement(nature))
                for nature in assistant.NATURES]

    def _formulaire_comportement(self, nature,
                                 action="/reglages/comportement",
                                 bouton="Enregistrer ces options",
                                 extra="", icone=True, id_formulaire=""):
        """Les options par défaut d'UNE nature — le même formulaire partout.

        Il sert à la page ⚙ Réglages et à l'installeur du premier lancement.
        `extra` reçoit ce que l'installeur ajoute au pied du formulaire
        (« Recharger les valeurs par défaut », « Charger la même
        configuration ») : ces gestes n'ont de sens qu'en installation, et
        les faire vivre ici plutôt qu'ailleurs garde le formulaire entier.
        """
        preferences = self.application.preferences
        definition = assistant.NATURES[nature]
        # Dans l'installeur : ni pictogramme au titre, ni bouton d'envoi —
        # c'est son pied fixe qui soumet, par l'identifiant du formulaire.
        signe = f"{definition['icone']} " if icone else ""
        marque = f' id="{id_formulaire}"' if id_formulaire else ""
        envoi = f"<button>{bouton}</button>" if bouton else ""
        if True:
            options, politique, ordre = assistant.comportement_regle(
                nature, preferences)
            cases = []
            for cle, libelle in self.LIBELLES_COMPORTEMENT:
                coche = " checked" if options.get(cle) else ""
                # `data-revele` : dans l'INSTALLEUR, le formulaire arrive par
                # innerHTML — son propre script ne s'exécuterait pas. La case
                # dit donc elle-même quel bloc elle ouvre, et l'écoute posée
                # une fois sur la fenêtre suffit. Sur la page ⚙ Réglages,
                # c'est _script_comportement qui s'en charge, par les
                # identifiants : les deux voies mènent au même endroit.
                revele = (f' data-revele="regl_{nature}_bloc"'
                          if cle == "recontacter" else "")
                cases.append(
                    '<div class="ligne-option"><label class="option">'
                    f'<input type="checkbox" name="{cle}" value="1"{coche} '
                    f'id="regl_{nature}_{cle}"{revele}>'
                    f"<span>{libelle}</span></label></div>")
                # ⚠ LES OPTIONS D'UNE OPTION suivent leur case, et pas
                # ailleurs : « Recontacter » sans son délai ni son plafond
                # était un réglage à moitié réglable — signalé par le
                # propriétaire le 02/08/2026. Elles ne s'affichent que si la
                # case est cochée (règle du dévoilement en cascade).
                if cle == "recontacter":
                    cases.append(self._sous_options_relance(nature, options))
            if assistant.option_annulation_utile(nature):
                coche = (" checked"
                         if options.get(assistant.CLE_REPLACER_ANNULATION)
                         else "")
                cases.append(
                    '<div class="ligne-option"><label class="option">'
                    f'<input type="checkbox" '
                    f'name="{assistant.CLE_REPLACER_ANNULATION}" value="1"'
                    f"{coche}><span>Proposer une autre date si le contact "
                    "annule pendant l'appel</span></label></div>")
            if definition["politique_modifiable"]:
                choix_politique = (
                    '<label class="champ-option"><strong>Politique d\'appel'
                    "</strong><br>" + assistant_web._selecteur(
                        "politique",
                        [(code, assistant.POLITIQUES[code])
                         for code in ("premier_oui", "tous")],
                        politique) + "</label>")
            else:
                choix_politique = (
                    "<p><strong>Politique d'appel</strong> : "
                    f"{html.escape(definition['politique_libelle'])} — "
                    "imposée par la nature, elle ne se règle pas.</p>")
            code_sous = f"comportement-{nature}"
            return f"""
<h2 id="{code_sous}">{signe}{html.escape(definition['nom'])}
  <small class="sourd">— options par défaut</small></h2>
<form method="post" action="{action}" class="carte"{marque}>
  <input type="hidden" name="nature" value="{nature}">
  {''.join(cases)}
  {choix_politique}
  <label class="champ-option"><strong>Ordre d'appel</strong><br>{assistant_web._selecteur(
      "ordre", list(assistant.ORDRES_APPEL.items()), ordre,
      vide="— à choisir à chaque campagne —")}</label>
  <p><small>Ces valeurs pré-remplissent le formulaire de toute
  <strong>nouvelle</strong> campagne de cette nature ; chacune reste
  modifiable au moment de la créer (étape ②, mode avancé). Les campagnes
  déjà créées gardent les options avec lesquelles elles ont été faites — ce
  réglage ne les rejoue pas.</small></p>
  {envoi}
</form>{extra}"""

    def _traiter_comportement(self, corps):
        """La page ⚙ Réglages enregistre les options d'une nature."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        nature = donnees.get("nature", [""])[0]
        if nature not in assistant.NATURES:
            return self._erreur(400, "Nature de campagne inconnue.")
        erreurs = self._appliquer_comportement(nature, donnees)
        if erreurs:
            return self._repondre(self._page_reglages(erreurs=erreurs), 400)
        return self._rediriger(f"/reglages?fait=1#comportement-{nature}")

    def _appliquer_comportement(self, nature, donnees):
        """Écrit les options d'UNE nature ; rend la liste des refus.

        Une seule nature par envoi (le formulaire porte son code) : sans
        cela, une case décochée sur l'écran d'une nature effacerait les
        options de toutes les autres — une case à cocher absente d'un envoi
        veut dire « décochée », et il faut savoir de QUI on parle.

        Séparé de la réponse HTTP pour que l'installeur du premier
        lancement écrive par le MÊME chemin que la page ⚙ Réglages.
        """
        definition = assistant.NATURES[nature]
        regle = {cle: (cle in donnees)
                 for cle, _ in self.LIBELLES_COMPORTEMENT}
        if assistant.option_annulation_utile(nature):
            regle[assistant.CLE_REPLACER_ANNULATION] = (
                assistant.CLE_REPLACER_ANNULATION in donnees)
        # Le détail des relances : refusé s'il est incohérent, plutôt
        # qu'enregistré et découvert plus tard au visage d'un contact.
        erreurs = []
        mode = donnees.get("relance_mode", [""])[0]
        if mode in ("delai", "creneau"):
            regle["relance_mode"] = mode
        delai = donnees.get("relance_delai", [""])[0].strip()
        if delai:
            if delai.isdigit() and 0 <= int(delai) <= 168:
                regle["relance_delai"] = delai
            else:
                erreurs.append("Délai de relance : donnez un nombre d'heures "
                               f"ouvrées entre 0 et 168 (reçu « {delai} »).")
        maximum = donnees.get("relance_max", [""])[0].strip()
        if maximum:
            if maximum.isdigit() and 0 <= int(maximum) <= 9:
                regle["relance_max"] = maximum
            else:
                erreurs.append("Nombre maximal de rappels : entre 0 et 9 "
                               f"(reçu « {maximum} »).")
        debut = donnees.get("relance_creneau_debut", [""])[0].strip()
        fin = donnees.get("relance_creneau_fin", [""])[0].strip()
        if debut and fin and debut >= fin:
            erreurs.append("Créneau de rappel : l'heure de début doit "
                           "précéder l'heure de fin (ex. 12:00 → 14:00).")
        elif mode == "creneau" and not (debut and fin):
            erreurs.append("Créneau de rappel : donnez le début ET la fin "
                           "pour choisir le mode « créneau horaire ».")
        else:
            regle["relance_creneau_debut"] = debut
            regle["relance_creneau_fin"] = fin
        # ⚠ ON N'ENREGISTRE QUE CE QUI S'ÉCARTE DU DÉFAUT DE LA NATURE
        # (16/08/2026). L'écran enregistre TOUT le bloc, quel que soit le champ
        # qu'on venait modifier : régler ses relances figeait donc aussi la
        # politique et l'ordre AFFICHÉS, c'est-à-dire les défauts d'alors.
        #
        # MESURÉ DANS SON FICHIER : le réglage du déplacement portait
        # « politique: premier_oui », écrit en même temps que son créneau de
        # rappel 12h-14h. Le jour où la §8.2 a été corrigée — le déplacement
        # appelle tout le monde — ce réglage a continué d'imposer l'ancienne
        # règle. Il a donc revu sa campagne s'arrêter au premier contact APRÈS
        # la correction, et mon correctif lui était invisible.
        #
        # Une valeur ÉGALE au défaut n'est jamais un choix : c'est le défaut.
        # Ne pas l'écrire laisse le défaut de la nature vivre ; un écart voulu,
        # lui, reste enregistré et respecté.
        politique = donnees.get("politique", [""])[0]
        if definition["politique_modifiable"] and politique in assistant.POLITIQUES:
            if politique == definition["politique"]:
                regle.pop("politique", None)
            else:
                regle["politique"] = politique
        ordre = donnees.get("ordre", [""])[0]
        if ordre in assistant.ORDRES_APPEL:
            if ordre == definition.get("ordre_defaut"):
                regle.pop("ordre", None)
            else:
                regle["ordre"] = ordre
        if erreurs:
            return erreurs
        self.application.preferences.definir(
            assistant.cle_comportement(nature), regle)
        journal.info("Options par défaut enregistrées pour la nature « %s ».",
                     nature)
        return []

    def _sous_parties_discours(self):
        """UNE SOUS-PARTIE PAR NATURE, avec les TROIS parties de la consigne.

        Demandé par le propriétaire le 02/08/2026, puis complété le même
        jour : « on ne retrouve pas tous les éléments de discours de
        l'agent ». Il manquait en effet l'objectif/contexte et les issues —
        seule l'ouverture était montrée, alors que ce sont bien trois parties
        qui partent à l'agent.

        Ce qui se RÈGLE ici : l'ouverture, le seul passage récité mot pour
        mot. Ce qui se LIT : les deux autres, écrites par la nature de la
        campagne et par ses options — elles sont rendues par le MÊME code que
        l'appel réel, donc ce qu'on lit est ce qui partira.

        Zone vidée = on revient au texte livré avec le produit ; il n'y a pas
        d'autre geste à connaître pour annuler.
        """
        return [(f"discours-{nature}", assistant.NATURES[nature]["nom"],
                 self._formulaire_discours(nature))
                for nature in assistant.NATURES]

    def _formulaire_discours(self, nature, action="/reglages/discours",
                             bouton="Enregistrer ce discours", extra="",
                             icone=True, id_formulaire=""):
        """Le discours d'UNE nature — le même formulaire sur les deux écrans.

        `extra` reçoit le pied propre à l'installeur (« Recharger les
        valeurs par défaut »). Voir `_formulaire_comportement` : même raison,
        même forme.
        """
        preferences = self.application.preferences
        definition = assistant.NATURES[nature]
        # Même règle que pour les options : l'installeur n'a plus de bouton
        # dans ses formulaires, son pied fixe s'en charge.
        signe = f"{definition['icone']} " if icone else ""
        marque = f' id="{id_formulaire}"' if id_formulaire else ""
        envoi = f"<button>{bouton}</button>" if bouton else ""
        if True:
            ecrit = (preferences.obtenir(assistant.cle_discours(nature))
                     or "").strip()
            etat = ("<strong>ouverture modifiée</strong>" if ecrit
                    else "ouverture livrée avec le produit")
            # Les colonnes et les options RÉELLES de cette nature : sans
            # elles, l'aperçu montrerait un discours que le produit n'enverra
            # jamais (les phrases conditionnées par une option tomberaient,
            # ou les DEUX branches d'une condition s'afficheraient).
            champs = assistant.champs_campagne(
                {"champs": list(definition["champs"])})
            options, _, _ = assistant.comportement_regle(nature, preferences)
            livre = assistant.gabarit_nature(nature, options)
            contexte, issues = self._apercu_consigne(
                nature, {}, champs, preferences, options)
            code = f"discours-{nature}"
            return f"""
<h2 id="{code}">{signe}{html.escape(definition['nom'])}
  <small class="sourd">— {etat}</small></h2>
<form method="post" action="{action}" class="carte"{marque}>
  <h3>① Ce que l'agent dit en ouvrant, mot pour mot</h3>
  <label>Le texte d'ouverture de toutes les campagnes de cette nature<br>
    <textarea name="{assistant.cle_discours(nature)}" rows="4"
      placeholder="{html.escape(livre, quote=True)}">{html.escape(ecrit)}</textarea>
  </label>
  <p><small>Vide = le texte livré (montré en filigrane) s'applique. Les mots
  entre crochets sont remplis automatiquement : <code>[identite]</code> et
  les colonnes de la liste pour chaque personne, les autres depuis les
  informations de l'étape ②. N'écrivez jamais de numéro de téléphone ici :
  ce texte est dicté tel quel.</small></p>
  {envoi}
</form>{extra}
<details>
  <summary><strong>② Son objectif et son contexte</strong> — là, il discute
  librement</summary>
  <div class="apercu-mission">{contexte}</div>
</details>
<details>
  <summary><strong>③ Les issues</strong> — il doit conclure sur l'une des
  trois</summary>
  <div class="apercu-mission">{issues}</div>
</details>
<p><small>Ces deux dernières parties sont écrites par la nature de la
campagne et par ses ⚙ options de comportement — elles se lisent ici, elles
ne se tapent pas. Une campagne peut encore récrire son ouverture pour elle
seule (étape ②, mode avancé).</small></p>"""

    # ============================================================ INSTALLEUR
    # L'installeur du PREMIER LANCEMENT. Il ne demande rien de nouveau : il
    # fait remplir les MÊMES réglages que ⚙ Réglages, une page à la fois,
    # dans un ordre qui a un sens — et il dit où l'on en est.
    #
    # Deux règles tenues d'un bout à l'autre :
    #  · les formulaires sont les VRAIS (`_formulaires_appels`,
    #    `_formulaire_comportement`, `_formulaire_discours`, le calendrier) —
    #    aucune copie, donc aucune divergence possible ;
    #  · l'écriture passe par les MÊMES fonctions que les Réglages
    #    (`_appliquer_reglages`, `_appliquer_comportement`,
    #    `_appliquer_discours`) : ce qui est refusé ici l'est là-bas, mot
    #    pour mot.

    def _servir_image(self, nom):
        """Sert un des quatre fichiers déclarés — et rien d'autre.

        Le type de contenu vient de la LISTE, pas du nom demandé : c'est ce
        qui garantit qu'un fichier ne peut pas être servi sous une étiquette
        qu'il n'a pas. Tout nom absent de la liste est un 404, sans même
        toucher au disque.

        Le cache est LONG : ces images ne changent pas d'une session à
        l'autre, et le navigateur ne doit pas les redemander à chaque page.
        """
        type_contenu = IMAGES_SERVIES.get(nom)
        if type_contenu is None:
            return self._erreur(404, "Image inconnue.")
        chemin = os.path.join(DOSSIER_IMAGES, nom)
        try:
            with open(chemin, "rb") as fichier:
                octets = fichier.read()
        except OSError:
            return self._erreur(404, "Image absente de l'installation.")
        self.send_response(200)
        self.send_header("Content-Type", type_contenu)
        self.send_header("Content-Length", str(len(octets)))
        self.send_header("Cache-Control", "public, max-age=604800")
        self.end_headers()
        self.wfile.write(octets)

    def _natures_installeur(self):
        """Les natures créables, dans l'ordre, telles que l'installeur les voit."""
        return [(code, fiche["icone"], fiche["nom"])
                for code, fiche in assistant.NATURES.items()]

    def _installation_a_faire(self):
        """Faut-il ouvrir l'installeur en arrivant sur l'accueil ?

        Non si l'installation a été menée à son terme ; non non plus si l'on
        a répondu « configurer plus tard » depuis le démarrage du serveur —
        cette réponse-là ne s'écrit PAS sur le disque, exprès : elle vaut
        pour la session en cours, et l'installeur revient au lancement
        suivant tant qu'il n'a pas été terminé.
        """
        if getattr(self.application, "installation_reportee", False):
            return False
        return not installation.terminee(self.application.preferences)

    def _bouton_arbre(self, code_page, libelle, faite, actif):
        """Un lien du menu : sa marque, puis son libellé.

        La croix et la coche portent le SIGNE, pas seulement la couleur :
        « ✗ » et « ✓ » se lisent aussi quand on distingue mal le rouge du
        vert, et un lecteur d'écran les annonce.
        """
        marque = ("faite", "✓", "terminé") if faite else (
            "a-faire", "✗", "à configurer")
        return (f'<button type="button" class="{"actif" if actif else ""}" '
                f'data-page="{code_page}" title="{marque[2]}">'
                f'<span class="marque-partie {marque[0]}" aria-hidden="true">'
                f'{marque[1]}</span>'
                f'<span class="sr-seulement">{marque[2]} — </span>'
                f"{html.escape(libelle)}</button>")

    def _barre_installeur(self, page):
        """LE BANDEAU DES SECTIONS : horizontal, en haut, comme à l'origine.

        Quatre entrées côte à côte. « Comportement de l'agent IA » n'emmène
        nulle part par elle-même : elle DÉROULE un panneau vertical qui se
        pose PAR-DESSUS le contenu — il ne pousse donc rien, et la fenêtre
        garde sa hauteur.

        ⚠ Ce bandeau a repris la place des puces d'origine (demande du
        propriétaire du 03/08/2026, croquis à l'appui). Il est passé entre
        temps par une colonne de gauche puis par une liste déroulante du
        navigateur : ni l'une ni l'autre n'était ce qu'il voulait.
        """
        preferences = self.application.preferences
        natures = self._natures_installeur()
        noeud_actif, partie_active = installation.noeud_de(page, natures)
        entrees = []
        for code, libelle, enfants in installation.arbre(natures):
            faite = installation.noeud_fait(code, preferences, natures)
            actif = code == noeud_actif
            if not enfants:
                entrees.append(self._bouton_arbre(
                    installation.premiere_page(code, natures) or page,
                    libelle, faite, actif))
                continue
            choix = []
            for code_enfant, nom in enfants:
                choix.append(self._bouton_arbre(
                    installation.premiere_page(code_enfant, natures) or page,
                    nom,
                    installation.partie_faite(code_enfant, preferences,
                                              natures),
                    code_enfant == partie_active))
            marque = ("faite", "✓", "terminé") if faite else (
                "a-faire", "✗", "à configurer")
            entrees.append(
                '<span class="entree-deroulante">'
                f'<button type="button" class="{"actif" if actif else ""}" '
                'data-menu-deroulant="panneau-campagnes" aria-expanded="false" '
                'aria-haspopup="true" aria-controls="panneau-campagnes">'
                f'<span class="marque-partie {marque[0]}" aria-hidden="true">'
                f'{marque[1]}</span>'
                f'<span class="sr-seulement">{marque[2]} — </span>'
                f'{html.escape(libelle)}</button>'
                '<div class="panneau-deroulant" id="panneau-campagnes" hidden>'
                + "".join(choix) + "</div></span>")
        return ('<nav class="barre-installeur" aria-label="Sections de la '
                'configuration">' + "".join(entrees) + "</nav>")

    def _sous_pages_installeur(self, partie, page):
        """Les pages d'une section, en retrait sous elle dans le menu.

        Vide quand la section n'a qu'une page : un retrait qui répète le
        libellé du dessus n'apprend rien.
        """
        preferences = self.application.preferences
        natures = self._natures_installeur()
        deja = installation.faites(preferences)
        for code_partie, _, sous in installation.parties(natures):
            if code_partie != partie or len(sous) <= 1:
                continue
            liens = [self._bouton_arbre(code, nom, code in deja, code == page)
                     for code, nom in sous]
            return ('<nav class="menu-installeur" aria-label="Pages de cette '
                    'section">' + "".join(liens) + "</nav>")
        return ""

    ID_FORMULAIRE_PAGE = "formulaire-page"

    def _page_a_un_formulaire(self, page):
        """Vrai si cette page porte UN formulaire principal à enregistrer.

        Les pages « horaires », « jours fermés », « charger l'agenda » et
        « CALL-E » n'en ont pas : leurs gestes s'enregistrent seuls, au fil de
        l'eau. Pour CALL-E, c'est même essentiel — le pied ne doit pas
        soumettre un champ de clé VIDE et effacer ce qui est déjà rangé.
        """
        if page in ("identite", "appel", "relances", "remplacement", "delais"):
            return True
        return any(page in (f"{code}-comportement", f"{code}-discours")
                   for code, _, _ in self._natures_installeur())

    def _pied_installeur(self, page, libelle="Passer à la suite"):
        """LE PIED FIXE de la fenêtre : les deux gestes et l'avancement.

        ⚠ IL VIT HORS DE LA ZONE QUI DÉFILE (03/08/2026). Il était au bas du
        contenu : sur une page longue il fallait dérouler pour le trouver, et
        il changeait de place à chaque page. Il est désormais collé en bas de
        la fenêtre, et seul le milieu défile.

        ⚠ Les formulaires de l'installeur n'ont PLUS de bouton « Valider et
        continuer » : c'est ce pied qui les soumet, par l'attribut « form »
        qui vise leur identifiant. Une page sans formulaire principal se
        contente de se marquer faite et de passer à la suivante.
        """
        preferences = self.application.preferences
        natures = self._natures_installeur()
        faites, total = installation.progression(preferences, natures)
        suivante = installation.suivante(page, natures)
        passer = ""
        if suivante:
            passer = (f'<button type="button" class="secondaire" '
                      f'data-page="{suivante}">Passer cette page</button>')
        if self._page_a_un_formulaire(page):
            principal = (f'<button form="{self.ID_FORMULAIRE_PAGE}">'
                         f"{libelle}</button>")
        else:
            principal = f"""<form method="post" action="/installation/marquer"
        style="display:inline">
    <input type="hidden" name="page" value="{page}">
    <button>{libelle}</button>
  </form>"""
        return f"""<div class="pied-installeur">
  {principal}
  {passer}
  <span class="sourd"><small>{faites} page(s) réglée(s) sur {total}</small></span>
</div>"""

    def _page_installeur(self, page=None, erreurs=None, message=""):
        """La fenêtre entière de l'installeur, pour la page demandée."""
        natures = self._natures_installeur()
        page = installation.page_valide(page or "", natures)
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = ('<div class="erreurs"><strong>Refusé :</strong>'
                            f"<ul>{elements}</ul></div>")
        bloc_message = f'<p class="pastille">{html.escape(message)}</p>' \
            if message else ""
        corps = self._contenu_installeur(page)
        # ⚠ L'ACCUEIL N'A AUCUNE NAVIGATION. Ni arbre, ni liste de pages :
        # elles apparaissent quand la configuration démarre (demande du
        # propriétaire du 03/08/2026). On ne propose pas de se déplacer dans
        # un parcours qu'on n'a pas encore commencé.
        # ⚠ DEUX PAGES S'AJUSTENT À LEUR CONTENU : l'accueil et la fin. Elles
        # ne portent pas de formulaire, seulement un texte court et un
        # bouton — la hauteur imposée leur laissait un tiers d'écran vide
        # (demande du propriétaire du 03/08/2026). Les pages de configuration,
        # elles, gardent leur hauteur constante : c'est entre elles qu'on
        # navigue, et c'est là que le saut se voyait.
        libre = " installeur-libre" if page in ("bienvenue", "fin") else ""
        pied = "" if page in ("bienvenue", "fin") else self._pied_installeur(page)
        if page == "bienvenue":
            barre = ""
            vue = f'<div class="page-installeur">{corps}</div>'
        else:
            barre = self._barre_installeur(page)
            pages = self._sous_pages_installeur(
                installation.partie_de(page, natures), page)
            # Une section d'une seule page (« Terminer ») n'a pas de menu de
            # pages : la page occupe alors toute la largeur.
            vue = (f'<div class="installeur-deux-parts">{pages}'
                   f'<div class="page-installeur">{corps}</div></div>'
                   if pages else
                   f'<div class="page-installeur">{corps}</div>')
        return f"""<div class="modale installeur{libre}" role="dialog"
     aria-modal="true" aria-label="Configuration de RingBack">
  {barre}
  {bloc_message}
  {bloc_erreurs}
  {vue}
  {pied}
</div>"""

    def _contenu_installeur(self, page):
        """Le contenu d'UNE page — c'est ici que les cas se distinguent."""
        natures = self._natures_installeur()
        if page == "bienvenue":
            return self._installeur_bienvenue()
        if page == "fin":
            return self._installeur_fin()
        # ⚠ LE CODE DE PAGE VOYAGE DANS L'ADRESSE, pas dans un champ caché :
        # les formulaires rendus ici sont ceux des ⚙ Réglages, tels quels, et
        # rien ne peut être glissé DEDANS sans les recopier. L'adresse d'envoi,
        # elle, est déjà un paramètre.
        formulaires = self._formulaires_appels(
            action=f"/installation/valider?page={page}", bouton="",
            icones=False, id_formulaire=self.ID_FORMULAIRE_PAGE)
        if page in formulaires:
            return formulaires[page]
        # ⚠ MÊMES IDENTIFIANTS que dans les ⚙ Réglages (« bloc-horaires »,
        # « bloc-jours-fermes ») : ce sont les VRAIS formulaires, et c'est par
        # ces noms qu'ils désignent l'élément à recharger. Les renommer ici
        # revenait à couper le glisser-relâché et les deux boutons.
        if page == "horaires":
            return f"""<h2>Vos horaires d'ouverture</h2>
<p>Ce sont eux qui décident des places que l'agent peut proposer au
téléphone : RingBack ne propose <strong>jamais</strong> une heure où vous
êtes fermé.</p>
<div id="bloc-horaires">{self._bloc_horaires(avec_duree=False,
                                             icone=False)}</div>"""
        if page == "jours-fermes":
            return f"""<h2>Vos jours fermés</h2>
<p>Congés, jours fériés, une journée bloquée : ajoutez-les ici. Ils
s'enlèvent des places proposées, et une relance ne tombera jamais
dessus.</p>
<div id="bloc-jours-fermes">{self._bloc_jours_fermes()}</div>"""
        if page == "calle":
            return self._installeur_calle()
        if page == "import":
            return self._installeur_import()
        for code, _, _ in natures:
            if page == f"{code}-comportement":
                return self._installeur_comportement(code, page)
            if page == f"{code}-discours":
                return self._installeur_discours(code, page)
        return "<p>Page inconnue.</p>"

    def _installeur_calle(self):
        """La page « Connexion à CALL-E » — le MÊME bloc que les Réglages.

        ⚠ PAS UNE COPIE. Deux écrans qui décriraient la clé chacun à sa façon
        auraient fini par se contredire — et c'est le genre de contradiction
        qu'on ne voit qu'au moment d'appeler pour de vrai.
        """
        return f"""<h2>Connexion à CALL-E</h2>
<p>La clé de CALL-E, et rien d'autre. Sans elle, tout l'écran fonctionne : les
appels sont <strong>simulés</strong>.</p>
{self._bloc_calle(retour="calle")}
<p><small><strong>Passez cette page</strong> si vous n'avez pas encore de clé —
elle vous attendra dans ⚙ Réglages → 🔌 CALL-E.</small></p>"""

    def _installeur_bienvenue(self):
        """La première page : à quoi servent ces réglages, et pourquoi ici."""
        return """<h2>Bienvenue dans RingBack</h2>
<p>Avant la première campagne, quelques réglages. Ce ne sont pas des
formalités : <strong>ce sont eux que chaque campagne reprendra</strong>, à
sa création comme pendant ses appels.</p>
<ul>
  <li><strong class="point-config">Ce que l'agent dit</strong> — le nom de
  votre établissement est prononcé à voix haute au début de chaque appel, et
  le texte d'ouverture de chaque type de campagne se règle une fois pour
  toutes.</li>
  <li><strong class="point-config">Quand il a le droit d'appeler</strong> —
  une plage horaire, une période interdite. Hors de là, RingBack
  <strong>refuse</strong> de lancer quoi que ce soit. C'est un garde-fou, pas
  une préférence.</li>
  <li><strong class="point-config">Les places qu'il peut proposer</strong> —
  elles sortent de VOTRE agenda : horaires d'ouverture, jours fermés,
  rendez-vous déjà pris. Jamais une date inventée.</li>
  <li><strong class="point-config">Ce qu'il fait quand ça n'aboutit
  pas</strong> — recontacter ou non, au bout de combien de temps, combien de
  fois.</li>
</ul>
<div class="installeur-accueil">
  <form method="post" action="/installation/valider" style="display:inline">
    <input type="hidden" name="page" value="bienvenue">
    <button class="gros-bouton">▶ Démarrer la configuration</button>
  </form>
  <button type="button" class="secondaire"
          data-installeur-fermer="/installation/plus-tard">Configurer plus
  tard</button>
</div>"""

    def _installeur_comportement(self, nature, page):
        """Les options d'une nature + les deux gestes propres à l'installeur.

        « Recharger les valeurs par défaut » remet les options livrées avec
        le produit. « Charger la même configuration » recopie celles d'une
        AUTRE campagne — pour les options de comportement seulement : un
        discours se recopie mal d'une situation à l'autre, il parle d'autre
        chose.
        """
        autres = [(code, f"{fiche['icone']} {fiche['nom']}")
                  for code, fiche in assistant.NATURES.items()
                  if code != nature]
        copie = ""
        if autres:
            # ⚠ LE BOUTON EST À CÔTÉ DU SÉLECTEUR, pas dessous (03/08/2026) :
            # le geste est « prendre CELLE-CI », les deux morceaux ne se
            # lisent pas l'un sans l'autre.
            copie = f"""<form method="post" action="/installation/copier" class="carte">
  <input type="hidden" name="page" value="{page}">
  <input type="hidden" name="nature" value="{nature}">
  <div class="ligne-copie">
    <label class="champ-option">Reprendre les options d'une autre
      campagne<br>{assistant_web._selecteur(
          "source", autres, "", vide="— choisir une campagne —")}</label>
    <button class="secondaire">Charger la même configuration</button>
  </div>
  <p><small>Seules les <strong>options de comportement</strong> sont
  recopiées. Le discours, lui, reste propre à chaque situation : il ne dit
  pas la même chose.</small></p>
</form>"""
        defauts = f"""<form method="post" action="/installation/defauts" class="carte">
  <input type="hidden" name="page" value="{page}">
  <input type="hidden" name="nature" value="{nature}">
  <input type="hidden" name="quoi" value="comportement">
  <p><small>Repartir de ce que RingBack propose d'origine pour ce type de
  campagne — vos autres réglages ne bougent pas.</small></p>
  <button class="secondaire">Recharger les valeurs par défaut</button>
</form>"""
        return (self._formulaire_comportement(
                    nature, action=f"/installation/valider?page={page}",
                    bouton="", icone=False,
                    id_formulaire=self.ID_FORMULAIRE_PAGE)
                + copie + defauts)

    def _installeur_discours(self, nature, page):
        """Le discours d'une nature, avec son retour aux valeurs livrées."""
        defauts = f"""<form method="post" action="/installation/defauts" class="carte">
  <input type="hidden" name="page" value="{page}">
  <input type="hidden" name="nature" value="{nature}">
  <input type="hidden" name="quoi" value="discours">
  <p><small>Effacer votre texte et revenir à l'ouverture livrée avec le
  produit (celle qui s'affiche en filigrane).</small></p>
  <button class="secondaire">Recharger les valeurs par défaut</button>
</form>"""
        return (self._formulaire_discours(
                    nature, action=f"/installation/valider?page={page}",
                    bouton="", icone=False,
                    id_formulaire=self.ID_FORMULAIRE_PAGE)
                + defauts)

    def _installeur_import(self):
        """Charger un agenda : les formats acceptés, comment faire, le bouton."""
        return """<h2>Charger votre agenda</h2>
<p>RingBack a besoin de connaître vos rendez-vous : c'est ce qui lui permet
de savoir quelles places sont <strong>libres</strong>, et de ne jamais en
proposer une déjà prise.</p>
<h3>Les formats acceptés</h3>
<ul>
  <li><strong>Un agenda <code>.ics</code></strong> — le format standard,
  exporté par tous les logiciels d'agenda. Le titre de chaque événement donne
  « Nom — Motif », sa date et son heure de fin donnent la place occupée.</li>
  <li><strong>Un fichier <code>.csv</code></strong> — quatre colonnes :
  <code>nom;telephone;date_heure;motif</code>. Les dates sont acceptées sous
  trois formats, les numéros avec points ou espaces.</li>
</ul>
<h3>Comment obtenir le fichier</h3>
<p>Dans votre logiciel d'agenda, cherchez <em>Exporter</em> (souvent dans les
paramètres du calendrier, parfois sous <em>Imprimer / Enregistrer sous</em>)
et choisissez le format <strong>iCalendar</strong> ou <strong>.ics</strong>.
Vous obtenez un fichier ; c'est lui qu'on charge ici.</p>
<p><small>Un agenda ne contient presque jamais les numéros de téléphone : les
rendez-vous importés apparaîtront « sans numéro », avec un écran pour les
compléter. Tant qu'un numéro manque, ce client n'est jamais appelé.</small></p>
<form method="post" action="/installation/agenda" enctype="multipart/form-data"
      class="carte">
  <input type="hidden" name="page" value="import">
  <label>Votre fichier d'agenda ou de rendez-vous<br>
    <input type="file" name="fichier" accept=".ics,.csv,text/calendar,text/csv">
  </label>
  <p><small>Rien n'est envoyé sur Internet : le fichier est lu par RingBack,
  sur cette machine.</small></p>
  <button>Charger ce fichier</button>
</form>
<p><small>Vous n'avez pas de fichier sous la main ? Passez cette page : vos
rendez-vous peuvent aussi se saisir un par un, ou se coller plus tard.</small></p>
"""

    def _installeur_fin(self):
        """La dernière page : ce qui est réglé, et le bouton qui referme."""
        preferences = self.application.preferences
        natures = self._natures_installeur()
        faites, total = installation.progression(preferences, natures)
        reste = ""
        if faites < total:
            reste = (f"<p><small>{total - faites} page(s) n'ont pas été "
                     "validées. Ce n'est pas grave : RingBack fonctionne avec "
                     "ses valeurs d'origine, et tout se règle à tout moment "
                     "dans ⚙ Réglages.</small></p>")
        return f"""<h2>Vous êtes désormais prêt à utiliser RingBack</h2>
<p><strong>La suite tient en trois gestes</strong> : créer une campagne,
charger la liste des personnes, appuyer sur ▶ Démarrer. RingBack appelle,
écoute, et écrit lui-même les résultats dans votre agenda.</p>
{reste}
<div class="installeur-accueil">
  <button type="button" class="gros-bouton bouton-final"
          data-installeur-fermer="/installation/terminer"
          data-apres="/">Démarrer avec RingBack</button>
</div>
<p><small>Cette fenêtre ne se rouvrira plus toute seule. Pour refaire la
configuration : ⚙ Réglages → Refaire la configuration.</small></p>"""

    # -------------------------------------------------- les gestes reçus
    def _installeur_repondre(self, page, erreurs=None, message=""):
        """Renvoie la fenêtre — c'est la SEULE forme de réponse de l'installeur."""
        return self._repondre(
            self._page_installeur(page, erreurs=erreurs, message=message))

    def _installeur_suivante(self, page):
        """La page d'après, ou la page de fin quand il n'y en a plus."""
        return installation.suivante(page, self._natures_installeur()) or "fin"

    def _traiter_installation_valider(self, corps, demande=""):
        """Valide une page : on écrit, on note, on passe à la suivante."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"),
                                        keep_blank_values=True)
        natures = self._natures_installeur()
        page = installation.page_valide(
            demande or donnees.get("page", [""])[0], natures)
        preferences = self.application.preferences
        erreurs = []
        if page in dict(installation.PAGES_APPELS):
            erreurs = self._appliquer_reglages(donnees)
        elif page.endswith("-comportement"):
            nature = page[:-len("-comportement")]
            if nature in assistant.NATURES:
                erreurs = self._appliquer_comportement(nature, donnees)
        elif page.endswith("-discours"):
            erreurs = self._appliquer_discours(donnees)
        if erreurs:
            return self._installeur_repondre(page, erreurs=erreurs)
        installation.marquer_faite(preferences, page)
        return self._installeur_repondre(self._installeur_suivante(page))

    def _traiter_installation_marquer(self, corps):
        """Note la page comme faite SANS rien écrire, et passe à la suivante.

        Sert aux pages dont les formulaires enregistrent déjà par eux-mêmes
        (le calendrier des horaires, les jours fermés) et à « Passer à la
        suite » : la page a été vue et voulue, c'est tout ce que la coche
        prétend dire.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        natures = self._natures_installeur()
        page = installation.page_valide(donnees.get("page", [""])[0], natures)
        installation.marquer_faite(self.application.preferences, page)
        return self._installeur_repondre(self._installeur_suivante(page))

    def _traiter_installation_copier(self, corps):
        """Recopie les options de comportement d'une AUTRE campagne."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        natures = self._natures_installeur()
        page = installation.page_valide(donnees.get("page", [""])[0], natures)
        nature = donnees.get("nature", [""])[0]
        source = donnees.get("source", [""])[0]
        if nature not in assistant.NATURES:
            return self._erreur(400, "Nature de campagne inconnue.")
        if source not in assistant.NATURES:
            return self._installeur_repondre(page, erreurs=[
                "Choisissez la campagne dont vous voulez reprendre les "
                "options."])
        preferences = self.application.preferences
        # On recopie ce qui est RÉELLEMENT en vigueur pour la source (ses
        # réglages, ou les défauts si elle n'a rien de propre) : sinon
        # « charger la même configuration » ne chargerait rien quand la
        # source n'a jamais été enregistrée.
        options, politique, ordre = assistant.comportement_regle(
            source, preferences)
        regle = dict(options)
        # La politique d'appel ne se recopie que si la nature d'arrivée sait
        # la changer — l'imposer à une nature qui n'en veut pas serait un
        # réglage qui ne s'applique jamais.
        if assistant.NATURES[nature]["politique_modifiable"]:
            regle["politique"] = politique
        if ordre:
            regle["ordre"] = ordre
        # Une option qui n'existe pas pour la nature d'arrivée est écartée :
        # la question d'annulation ne veut rien dire hors des natures dont
        # le message en dépend.
        if not assistant.option_annulation_utile(nature):
            regle.pop(assistant.CLE_REPLACER_ANNULATION, None)
        preferences.definir(assistant.cle_comportement(nature), regle)
        nom_source = assistant.NATURES[source]["nom"]
        journal.info("Options recopiées de « %s » vers « %s ».", source, nature)
        return self._installeur_repondre(
            page, message=f"Options reprises de « {nom_source} ». "
                          "Relisez-les avant de valider.")

    def _traiter_installation_defauts(self, corps):
        """Remet les valeurs livrées avec le produit, pour CETTE page."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        natures = self._natures_installeur()
        page = installation.page_valide(donnees.get("page", [""])[0], natures)
        nature = donnees.get("nature", [""])[0]
        quoi = donnees.get("quoi", [""])[0]
        if nature not in assistant.NATURES:
            return self._erreur(400, "Nature de campagne inconnue.")
        preferences = self.application.preferences
        if quoi == "discours":
            # Vide = le texte livré s'applique. C'est déjà la convention du
            # champ ; le bouton ne fait que l'exécuter sans faire chercher.
            preferences.definir(assistant.cle_discours(nature), "")
            message = "Discours revenu au texte livré avec le produit."
        else:
            preferences.definir(assistant.cle_comportement(nature), {})
            message = "Options revenues aux valeurs d'origine."
        return self._installeur_repondre(page, message=message)

    def _traiter_installation_agenda(self, corps_brut):
        """Charge le fichier d'agenda envoyé depuis l'installeur.

        Le même code que les imports de la page 📅 Rendez-vous — c'est
        important : un fichier accepté ici doit l'être là-bas, et le compte
        rendu doit dire la même chose.
        """
        page = "import"
        type_contenu = self.headers.get("Content-Type", "")
        if not type_contenu.startswith("multipart/form-data"):
            return self._installeur_repondre(page, erreurs=[
                "Envoi invalide : un fichier est attendu."])
        nom, octets = _fichier_nomme(type_contenu, corps_brut)
        if not octets:
            return self._installeur_repondre(page, erreurs=[
                "Choisissez un fichier avant de cliquer sur « Charger »."])
        base = self.application.base
        preferences = self.application.preferences
        ics_demande = nom.lower().endswith(".ics")
        try:
            texte = saisie.decoder_csv(octets)   # même décodage pour les deux
            if ics_demande:
                importes, refuses = ics.importer_ics(base, texte, preferences)
            else:
                importes, refuses = saisie.importer_csv(base, texte)
        except saisie.SaisieInvalide as erreur:
            return self._installeur_repondre(page, erreurs=[
                f"Ce fichier n'a pas pu être lu : {erreur}"])
        base.marquer_manques_echus()
        horaires.noter_import_agenda(
            preferences, "agenda ICS" if ics_demande else "fichier CSV",
            importes)
        installation.marquer_faite(preferences, page)
        # ⚠ Les deux importeurs rendent « importés » sous deux formes : un
        # NOMBRE pour l'un, une LISTE pour l'autre. On compte sans supposer —
        # supposer, ici, plantait la page (constaté à l'exercice, 03/08/2026).
        combien = importes if isinstance(importes, int) else len(importes)
        detail = ""
        if refuses:
            detail = (f" {len(refuses)} ligne(s) refusée(s) — elles sont "
                      "détaillées dans 📅 Rendez-vous.")
        return self._installeur_repondre(
            self._installeur_suivante(page),
            message=f"Agenda chargé : {combien} rendez-vous "
                    f"ajouté(s).{detail}")

    def _traiter_installation_plus_tard(self):
        """« Configurer plus tard » : pour cette session seulement."""
        self.application.installation_reportee = True
        journal.info("Installation reportée — elle reviendra au prochain "
                     "démarrage.")
        return self._repondre("")

    def _traiter_installation_terminer(self):
        """« Démarrer avec RingBack » : l'installeur ne s'ouvrira plus seul."""
        installation.marquer_terminee(self.application.preferences)
        journal.info("Installation terminée.")
        return self._repondre("")

    def _traiter_installation_rouvrir(self):
        """« Réinitialiser l'installeur », depuis ⚙ Réglages → 🧪 Essais.

        On revient sur les RÉGLAGES, pas sur l'installeur : le bouton dit
        qu'il réinitialise une variable, il ne dit pas qu'il lance le
        parcours. C'est l'actualisation de l'accueil qui le fera — et
        l'écran l'annonce en une phrase.
        """
        installation.rouvrir(self.application.preferences)
        self.application.installation_reportee = False
        journal.info("Variable d'installation réinitialisée : l'installeur "
                     "s'ouvrira à la prochaine visite de l'accueil.")
        return self._rediriger("/reglages?installeur=remis#installeur")

    # ---------------------------------------------- horaires d'ouverture
    def _bloc_horaires(self, erreurs=None, avec_duree=True, icone=True):
        """La section « Horaires d'ouverture » : le pas + la semaine type.

        Le calendrier vit dans un élément qui se recharge SEUL après chaque
        geste (jamais la page entière) ; le repli sans JavaScript est un
        formulaire jour + début + fin, toujours affiché sous le calendrier.

        `erreurs` : un refus s'affiche DANS le bloc, là où le geste a eu
        lieu — et non sur une page qui remplacerait l'écran.

        `avec_duree` : l'installeur ne montre PAS la durée moyenne d'un
        rendez-vous. Le propriétaire a fait retirer son bouton le
        03/08/2026 ; un champ sans bouton ne pouvant plus s'enregistrer,
        c'est la carte entière qui part. La durée garde sa valeur d'origine
        et se règle dans ⚙ Réglages, où le bouton demeure.

        `icone` : les titres de l'installeur n'en portent pas.
        """
        preferences = self.application.preferences
        pas = horaires.pas_minutes(preferences)
        bloc_refus = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_refus = ('<div class="erreurs"><strong>Refusé :</strong>'
                          f"<ul>{elements}</ul></div>")
        options_jours = "".join(
            f'<option value="{numero}">{libelle}</option>'
            for numero, libelle in enumerate(horaires.JOURS))
        duree = f"""<form method="post" action="/reglages/pas" class="carte"
      data-fragment-cible="bloc-horaires">
  <label>Durée moyenne d'un rendez-vous, en minutes (c'est le pas des
    tranches — de {horaires.PAS_MINIMUM} à {horaires.PAS_MAXIMUM})<br>
    <input class="champ-court" type="number" name="pas"
           min="{horaires.PAS_MINIMUM}" max="{horaires.PAS_MAXIMUM}"
           step="1" value="{pas}"></label>
  <button>Enregistrer la durée</button>
</form>""" if avec_duree else ""
        return f"""<h2 id="horaires">{'🗓 ' if icone else ''}Horaires \
d'ouverture — la semaine type</h2>
{bloc_refus}
<p>Les heures sont découpées en <strong>tranches</strong> de la durée
moyenne d'un rendez-vous. Appuyez sur une tranche, glissez, relâchez :
toute la période s'ouvre — refaites le même geste sur une période déjà
ouverte pour la refermer.</p>
{duree}
<div id="calendrier" class="zone-calendrier" data-calendrier="calendrier"
     data-pas="{pas}">{self._calendrier_semaine()}</div>
<form method="post" action="/reglages/semaine" class="carte"
      data-fragment-cible="calendrier">
  <p><strong>Sans glisser-relâché</strong> — ouvrir ou fermer une période en
  la saisissant (format des heures : HH:MM, par exemple 09:00) :</p>
  <table class="tableau-saisie"><tbody>
    <tr><th scope="col">Jour</th><th scope="col">Début</th>
        <th scope="col">Fin</th><th scope="col">Période</th></tr>
    <tr>
      <td><select class="select-option" name="jour"
                  aria-label="Jour">{options_jours}</select></td>
      <td><input type="time" name="debut" value="09:00"
                 aria-label="Début"></td>
      <td><input type="time" name="fin" value="12:00" aria-label="Fin"></td>
      <td><button name="geste" value="ouvrir">Ouvrir</button>
          <button class="secondaire" name="geste"
                  value="fermer">Fermer</button></td>
    </tr>
  </tbody></table>
</form>"""

    def _calendrier_semaine(self, erreurs=None):
        """Le calendrier de la semaine type — le FRAGMENT rechargé sur place.

        Chaque cellule est une tranche : ouverte (colorée) ou fermée. Aucune
        heure n'est cachée : l'amplitude affichée s'élargit d'elle-même si
        une ouverture déborde de la plage 7h–20h.
        """
        preferences = self.application.preferences
        pas = horaires.pas_minutes(preferences)
        debut, fin = horaires.amplitude_affichee(preferences)
        ouvertures = horaires.semaine(preferences)
        entetes = "".join(f'<th scope="col">{jour}</th>'
                          for jour in horaires.JOURS)
        lignes = []
        minute = debut
        while minute + pas <= fin:
            cellules = []
            for jour in range(7):
                ouverte = horaires.periode_ouverte(ouvertures[jour], minute,
                                                   minute + pas)
                classe = "tranche ouverte" if ouverte else "tranche"
                etat = "ouvert" if ouverte else "fermé"
                cellules.append(
                    f'<td class="{classe}" data-jour="{jour}" '
                    f'data-min="{minute}" title="{horaires.JOURS[jour]} '
                    f'{horaires.heure_lisible(minute)} — {etat}">'
                    f'<span class="lecture-seule">{etat[0]}</span></td>')
            etiquette = (horaires.heure_hhmm(minute) if minute % 60 == 0 else "")
            classe_ligne = ' class="heure-pleine"' if minute % 60 == 0 else ""
            lignes.append(f"<tr{classe_ligne}><th scope=\"row\">{etiquette}</th>"
                          + "".join(cellules) + "</tr>")
            minute += pas
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = ('<div class="erreurs"><strong>Geste refusé :</strong>'
                            f"<ul>{elements}</ul></div>")
        if not horaires.semaine_ouverte(preferences):
            bloc_erreurs += ("<p><small>Aucune heure d'ouverture pour "
                             "l'instant : tant que la semaine type est vide, "
                             "aucun créneau ne peut être calculé.</small></p>")
        return f"""{bloc_erreurs}
<table class="calendrier"><caption class="sourd">Une case = une tranche de
{pas} minutes ; les cases colorées sont ouvertes.</caption>
<tr><th scope="col">heure</th>{entetes}</tr>
{''.join(lignes)}
</table>"""

    def _bloc_jours_fermes(self, erreurs=None):
        """La section « 📕 Jours fermés exceptionnels » + les fériés PROPOSÉS.

        `erreurs` : un refus s'affiche DANS le bloc — voir `_bloc_horaires`.
        """
        preferences = self.application.preferences
        bloc_refus = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_refus = ('<div class="erreurs"><strong>Refusé :</strong>'
                          f"<ul>{elements}</ul></div>")
        fermes = horaires.jours_fermes(preferences)
        lignes = "".join(f"""<tr>
  <td>{_date_jour_lisible(entree['date'])}</td>
  <td>{html.escape(entree['libelle']) or '<span class="sourd">—</span>'}</td>
  <td><form method="post" action="/reglages/jour-ferme"
            data-fragment-cible="bloc-jours-fermes">
    <input type="hidden" name="action" value="retirer">
    <input type="hidden" name="date" value="{html.escape(entree['date'])}">
    <button class="secondaire">Retirer</button>
  </form></td>
</tr>""" for entree in fermes)
        if lignes:
            tableau = ("<table><tr><th>Jour fermé</th><th>Motif</th>"
                       "<th></th></tr>" + lignes + "</table>")
        else:
            tableau = ("<p>Aucun jour fermé déclaré : seule la semaine type "
                       "décide.</p>")
        propositions = [entree for entree
                        in horaires.feries_a_proposer(preferences)
                        if not entree["deja"]]
        if propositions:
            lignes_feries = "".join(f"""<tr>
  <td>{_date_jour_lisible(entree['date'])}</td>
  <td>{html.escape(entree['nom'])}</td>
  <td><form method="post" action="/reglages/jour-ferme"
            data-fragment-cible="bloc-jours-fermes">
    <input type="hidden" name="date" value="{html.escape(entree['date'])}">
    <input type="hidden" name="libelle" value="{html.escape(entree['nom'])}">
    <button class="secondaire">Ajouter aux jours fermés</button>
  </form></td>
</tr>""" for entree in propositions)
            tableau_feries = ("<table><tr><th>Date</th><th>Jour férié</th>"
                              "<th></th></tr>" + lignes_feries + "</table>")
        else:
            tableau_feries = ("<p>Tous les jours fériés des douze prochains "
                              "mois sont déjà déclarés fermés.</p>")
        return f"""<h2 id="jours-fermes">📕 Jours fermés exceptionnels</h2>
{bloc_refus}
<p>Des dates où aucun rendez-vous n'est possible <em>bien que</em> la
semaine type soit ouverte : jours fériés, vacances, formation.</p>
{tableau}
<form method="post" action="/reglages/jour-ferme" class="carte"
      data-fragment-cible="bloc-jours-fermes">
  <label>Date à fermer (format AAAA-MM-JJ, par exemple 2026-08-15)<br>
    <input type="date" name="date"></label>
  <label>Motif, facultatif (« vacances d'été », « formation »)<br>
    <input name="libelle" placeholder="vacances d'été"></label>
  <button>Déclarer ce jour fermé</button>
</form>
<h3>Jours fériés français des douze prochains mois</h3>
<p>Calculés (Pâques comprise) pour la France métropolitaine.
<strong>RingBack ne les ajoute jamais tout seul</strong> : c'est votre
décision, jour par jour — certains cabinets travaillent le 11 novembre.</p>
{tableau_feries}"""

    def _bloc_creneaux(self):
        """Le FRAGMENT « créneaux à proposer » : calculés + ajoutés à la main."""
        base = self.application.base
        preferences = self.application.preferences
        pas = horaires.pas_minutes(preferences)
        # On n'affiche que les 24 premiers créneaux CALCULÉS (la liste peut
        # être longue), mais TOUS ceux ajoutés à la main : une saisie ne doit
        # jamais disparaître de l'écran qui l'a reçue.
        # `avec_les_passes` : cet écran est le SEUL à les demander. Un créneau
        # manuel dont l'heure est passée n'est plus proposé au téléphone, mais
        # il reste ici — visible, marqué, et surtout RETIRABLE. Sans cela, une
        # saisie devenue gênante serait invisible et impossible à effacer.
        retenus, calcules = [], 0
        for entree in horaires.creneaux_proposables(base, preferences,
                                                    avec_les_passes=True):
            if entree["origine"] == "à la main":
                retenus.append(entree)
            elif calcules < 24:
                retenus.append(entree)
                calcules += 1
        lignes = []
        for entree in retenus:
            if entree["origine"] == "calculé":
                origine = '<span class="pastille st-confirme">calculé</span>'
                action = ""
            else:
                origine = '<span class="pastille st-deplace">à la main</span>'
                action = f"""<form method="post" action="/reglages/creneau-retirer">
    <input type="hidden" name="creneau" value="{html.escape(entree['horaire'])}">
    <button class="secondaire">Retirer</button>
  </form>"""
            alerte = ""
            if entree["occupe"]:
                alerte = ('<br><small class="var-manquante">⚠ un rendez-vous '
                          "occupe déjà cette tranche — il reste proposé parce "
                          "que vous l'avez ajouté à la main.</small>")
            if entree.get("passe"):
                # Le mot d'abord, pas seulement le pictogramme : cette ligne
                # doit se comprendre sans lire l'icône.
                alerte += ('<br><small class="var-manquante">⚠ heure passée — '
                           "ce créneau n'est plus proposé au téléphone. Votre "
                           "saisie reste ici : à vous de la retirer.</small>")
            elif entree.get("aujourdhui"):
                # DEUX RAISONS DIFFÉRENTES, DEUX PHRASES : « c'est aujourd'hui »
                # ne se corrige pas comme « l'heure est passée ». Sa règle du
                # 17/08/2026 : rien n'est proposé le jour même.
                alerte += ('<br><small class="var-manquante">⚠ c\'est '
                           "aujourd'hui — RingBack ne propose jamais le jour "
                           "même, seulement à partir de demain. Votre saisie "
                           "reste ici.</small>")
            lignes.append(f"<tr><td>{themes.date_lisible(entree['horaire'])}"
                          f"{alerte}</td><td>{origine}</td>"
                          f"<td>{action}</td></tr>")
        if lignes:
            tableau = ("<table><tr><th>Créneau proposé</th><th>Origine</th>"
                       "<th></th></tr>" + "".join(lignes) + "</table>")
        elif horaires.semaine_ouverte(preferences):
            tableau = ("<p>Aucun créneau libre sur les "
                       f"{horaires.HORIZON_JOURS} prochains jours : tout est "
                       "pris, ou fermé.</p>")
        else:
            tableau = ("<p>Aucun créneau : la semaine type est vide. Ouvrez "
                       'des heures dans <a href="#horaires">🗓 Horaires '
                       "d'ouverture</a>, ou ajoutez un créneau à la main "
                       "ci-dessous.</p>")
        return f"""{tableau}
<p><small>Tranches de {pas} minutes, sur les {horaires.HORIZON_JOURS}
prochains jours : les 24 premiers créneaux calculés, et <strong>tous</strong>
ceux que vous avez ajoutés à la main. Un client dont le rendez-vous dure
plus longtemps ne se voit proposer que des suites de tranches assez
longues.</small></p>
<form method="post" action="/reglages/creneau-ajouter" class="carte">
  <label>Ajouter un créneau à la main — cas particulier (date et heure)<br>
    <input type="datetime-local" name="creneau"></label>
  <button>Ajouter le créneau</button>
</form>"""

    def _bloc_jeu_essai(self):
        """La sous-partie 🧪 « Jeu d'essai » : l'état, le geste, et un « ? ».

        ⚠ TROIS PARTIES LÀ OÙ IL Y EN AVAIT UNE (10/08/2026, demande du
        propriétaire) : le jeu d'essai, l'agenda d'exemple, et le renvoi vers
        son propre numéro. Chacune porte son « ? » — « simple, clair,
        compréhensible, suffisant », et le détail attend qu'on le demande.

        ⚠ AUCUN CHIFFRE DANS LE TEXTE. Les comptes (contacts, rendez-vous,
        passés, à venir…) sont partis dans l'aide : ils décrivaient un contenu
        qu'on découvre de toute façon en le chargeant, et ils faisaient un
        paragraphe là où une phrase suffit.
        """
        info = jeu_essai.resume(
            self._langue())
        base = self.application.base
        aide = _aide("À quoi sert le jeu d'essai ?", f"""<p>Il ajoute des
contacts et des rendez-vous d'un {html.escape(info['metier'].lower())} fictif :
des rendez-vous passés et à venir, des manqués, des annulés, des déplacés, des
contacts 🚫 « ne plus appeler » et des contacts sans numéro. De quoi voir
fonctionner chaque situation sans attendre qu'elle arrive chez vous.</p>
<p>L'ajout est <strong>additif</strong> — vos données ne sont pas touchées — et
<strong>réversible</strong> : le retrait ne supprime que les fiches 🧪.</p>
<p>Les numéros sortent des six racines que l'Arcep réserve aux œuvres
audiovisuelles : ils ne sont attribués à personne, et ne peuvent donc ni appeler
ni être appelés. Un essai ne peut pas sonner chez un inconnu.</p>""")
        if jeu_essai.est_charge(base):
            # ⚠ DIRE QUAND LA DÉMONSTRATION A GRANDI (11/08/2026). Le jeu d'essai
            # est chargé UNE FOIS, à la création de la base ; quand le produit
            # l'enrichit, l'écran continuait d'annoncer « Chargé » et l'ancien
            # contenu restait. Le propriétaire a cherché pendant trois essais
            # pourquoi une campagne ne trouvait que huit personnes : sa base
            # datait d'avant. Le compte attendu est écrit à côté du compte réel.
            en_base = base.compter_clients_jeu_essai()
            manque = ""
            if en_base < len(jeu_essai.CLIENTS):
                manque = (" La démonstration en compte "
                          f"<strong>{len(jeu_essai.CLIENTS)}</strong> "
                          "aujourd'hui : rechargez-la pour ajouter les "
                          f"{len(jeu_essai.CLIENTS) - en_base} qui manquent "
                          "(rien n'est doublé).")
            etat = (f'<p class="pastille st-deplace">🧪 Chargé — '
                    f"{en_base} contact(s) d'essai dans votre base, "
                    f"marqués 🧪.{manque}</p>")
            action = """<form method="get" action="/reglages/jeu-essai">
  <input type="hidden" name="action" value="retirer">
  <button class="secondaire">Retirer le jeu d'essai…</button>
</form>
<form method="get" action="/reglages/jeu-essai">
  <input type="hidden" name="action" value="charger">
  <button class="secondaire">Recharger le jeu d'essai…</button>
</form>"""
        else:
            etat = "<p>Aucun jeu d'essai chargé.</p>"
            action = """<form method="get" action="/reglages/jeu-essai">
  <input type="hidden" name="action" value="charger">
  <button>Charger un jeu d'essai…</button>
</form>"""
        return f"""<h2 id="jeu-essai">🧪 Jeu d'essai{aide}</h2>
<p>Un jeu de données simple qui complète votre agenda et vos contacts, pour
essayer RingBack sans toucher à vos vraies données.</p>
{etat}
{action}
{self._bloc_agenda_exemple()}"""

    def _bloc_agenda_exemple(self):
        """La sous-partie « Agenda d'exemple » : le bouton, et un « ? ».

        ⚠ LES CHIFFRES SONT CALCULÉS, jamais recopiés — et calculés AVEC LES
        RÉGLAGES, les mêmes que le fichier téléchargé. Ils ne paraissent que
        dans l'aide : « ce que cela charge comme données », dit la demande.
        """
        preferences = self.application.preferences
        detail = agenda_exemple.plan(preferences=preferences)
        exemple = agenda_exemple.rendezvous(preferences=preferences)
        nombre = len(exemple)
        jours = len({debut.date() for debut, *_ in exemple})
        # L'ÉTENDUE, calculée elle aussi : c'est ce qui a changé le 11/08/2026,
        # et c'est ce qui permet d'éprouver la fenêtre « jusqu'à 90 jours après »
        # de la règle de liste. L'annoncer sans la mesurer serait la deviner.
        aujourd_hui = datetime.date.today()
        etendue = (max(debut.date() for debut, *_ in exemple)
                   - aujourd_hui).days if exemple else 0
        avec = sum(1 for r in exemple if r[4])
        # Les DEUX langues : une fiche chargée en anglais reste une fiche de
        # démonstration, et le compte ne doit pas changer avec la langue.
        noms_connus = jeu_essai.noms_du_jeu()
        connus = sum(1 for r in exemple if r[2] in noms_connus)
        sans = nombre - avec - connus
        # ⚠ LE REPLI SE DIT. Sans horaires d'ouverture réglés, RingBack ne
        # connaît pas les heures ouvrées du cabinet : il n'en invente pas, il
        # prend des plages d'exemple — et l'écran l'annonce, sinon on croirait
        # que le fichier suit un agenda qu'on n'a pas rempli.
        if detail["repli"]:
            calage = ("""<p class="bandeau">Aucun horaire d'ouverture n'est
réglé : le fichier prend des plages d'exemple (9h-12h30 et 14h-18h30, du lundi
au vendredi). <a href="/reglages#horaires">Réglez vos horaires</a> et il se
calera dessus.</p>""")
        else:
            calage = ""
        aide = _aide("Qu'est-ce qu'un fichier ICS, et que charge celui-ci ?",
                     f"""<p>Un fichier <code>.ics</code> (iCalendar) est le
format d'échange des agendas : c'est ce qu'exportent Google&nbsp;Agenda,
Outlook, Apple Calendrier et la plupart des logiciels de cabinet. RingBack sait
le relire pour remplir votre planning d'un coup.</p>
<p>Celui-ci contient <strong>{nombre} rendez-vous</strong> répartis sur
<strong>{jours} jours ouvrés</strong>, jusqu'à <strong>{etendue} jours d'ici</strong>,
posés dans <strong>vos heures d'ouverture</strong>, au pas de
<strong>{detail["pas"]} minutes</strong>, jours fermés sautés.</p>
<p>Il est <strong>dense les trois prochaines semaines</strong> et de plus en plus
clairsemé ensuite, comme un vrai agenda : il reste donc toujours des créneaux
libres à proposer, <strong>y compris dans trois mois</strong>.</p>
<p>Il mêle les trois cas qu'un vrai agenda contient : {avec} rendez-vous portent
un <strong>téléphone</strong>, {sans} n'en portent <strong>aucun</strong> (ils
arriveront « à compléter »), et {connus} portent le nom de contacts du jeu
d'essai — s'il est chargé, ils seront reconnus et rien ne sera dupliqué.</p>
<p>Ses dates partent <strong>d'aujourd'hui</strong> : il est juste quel que soit
le jour où vous le téléchargez. Trois autres agendas sont livrés en fichier
(<code>exemple_agenda.ics</code>, <code>…_realiste.ics</code>,
<code>…_outlook.ics</code>) pour éprouver des formats d'export ; ceux-là portent
des dates figées.</p>""")
        # ⚠ UN NIVEAU EN DESSOUS : ce bloc vit maintenant DANS « Jeu d'essai »
        # (15/08/2026, sa demande), qui porte déjà le <h2> de la sous-partie.
        # Deux <h2> l'un dans l'autre auraient menti sur la hiérarchie de la
        # page — et le menu des Réglages se construit sur ces niveaux.
        return f"""<h3 id="agenda-exemple">📅 Un agenda d'exemple à importer{aide}</h3>
<p>Un fichier d'agenda fabriqué à l'instant, calé sur vos heures d'ouverture, à
importer pour remplir le planning.</p>
{calage}
<form method="get" action="/reglages/agenda-exemple.ics">
  <button class="secondaire">⬇ Télécharger l'agenda d'exemple</button>
</form>"""

    def _section_renvoi_essai(self):
        """La sous-partie « Toujours composer MON numéro » : la case, et un « ? ».

        ⚠ L'AIDE NE PORTE QUE LE PREMIER PARAGRAPHE (10/08/2026, demande du
        propriétaire : « le reste est superflu »). Ce qui est parti : la
        comparaison avec les testeurs, le rappel que le renvoi n'ouvre aucun
        verrou, et l'avertissement disant que les résultats sont quand même
        écrits sur les fiches. Ce dernier reste écrit dans
        PROCEDURE-ESSAI-REEL.md et dans le README.
        """
        aide = _aide("Que fait ce renvoi ?", """<p>Cochée, cette case fait
<strong>remplacer le numéro de chaque contact</strong> par le vôtre, au tout
dernier moment — juste avant l'envoi à l'agent. <strong>Aucun de vos contacts
n'est appelé</strong> : c'est votre téléphone qui sonne, à chaque appel de la
campagne. Et <strong>l'identité ne change pas d'un mot</strong> : l'agent dit
toujours « Bonjour madame Duval », avec son motif et son rendez-vous. Vous
entendez donc <strong>exactement</strong> la conversation que ce contact aurait
eue.</p>""")
        return f"""<h2 id="renvoi-essai">📵 Toujours composer MON numéro{aide}</h2>
<div id="bloc-renvoi-essai">{self._bloc_renvoi_essai()}</div>"""

    # ------------------------------------------ essai en conditions réelles
    def _section_testeurs(self):
        """La section 🧪 « Testeurs de l'essai réel » : le texte + l'élément.

        La liste elle-même vit dans un élément qui se recharge SEUL à chaque
        ajout ou retrait (jamais la page) — voir _bloc_testeurs.
        """
        return f"""<h2 id="numero-essai">🧪 Testeurs de l'essai réel</h2>
<p><strong>À ne renseigner que pour un essai.</strong> RingBack refuse
normalement deux contacts portant le même numéro : c'est le garde-fou qui
empêche d'appeler deux fois la même personne. Les numéros déclarés ici — et
eux seuls — y échappent, pour que vous puissiez monter une campagne de
plusieurs identités qui sonnent chez des gens que vous connaissez : vous, un
collègue, un ami qui accepte de jouer un rôle. Tous les autres numéros
restent soumis à la règle stricte, et retirer un testeur la lui rend
aussitôt. Chaque contact portant l'un de ces numéros est marqué
{essai_reel.MARQUE} dans la grille, la fiche de campagne, le planning et
👥 Contacts. Comme partout, ces numéros restent <strong>masqués</strong> à
l'écran : les déclarer ne les rend pas lisibles.</p>
<p><small>Cette liste remplace l'ancien champ unique
« {essai_reel.MARQUE} Numéro d'essai ». Un numéro déjà déclaré n'est
<strong>pas perdu</strong> : il est repris ici comme premier testeur, nommé
« {essai_reel.NOM_PREMIER_TESTEUR} » — rien à retaper. Pour le renommer,
retirez-le et ajoutez-le à nouveau.</small></p>
<div id="bloc-testeurs">{self._bloc_testeurs()}</div>"""

    def _bloc_testeurs(self, erreurs=(), nom_saisi="", numero_saisi=""):
        """Le FRAGMENT « testeurs déclarés » : la liste + le formulaire d'ajout.

        Une saisie refusée n'est jamais perdue : le nom et le numéro tapés
        reviennent dans leurs champs. Le numéro revient MASQUÉ dans un seul
        cas — quand il est déjà déclaré, donc déjà connu de RingBack : il n'y
        a alors rien à récupérer, et le masquage prime.
        """
        preferences = self.application.preferences
        liste = essai_reel.testeurs(preferences)
        lignes = "".join(f"""<tr>
  <td>{rang}</td>
  <td>{html.escape(testeur['nom'])}</td>
  <td>{html.escape(db.masquer_telephone(testeur['telephone']))}</td>
  <td><form method="post" action="/reglages/testeur">
    <input type="hidden" name="action" value="retirer">
    <input type="hidden" name="rang" value="{rang}">
    <button class="secondaire">Retirer</button>
  </form></td>
</tr>""" for rang, testeur in enumerate(liste, start=1))
        if lignes:
            tableau = (f'<p class="pastille st-deplace">🧪 {len(liste)} '
                       "testeur(s) déclaré(s) — les contacts qui portent l'un "
                       "de ces numéros sont marqués 🧪 partout.</p>"
                       "<table><tr><th>n°</th><th>Testeur</th>"
                       "<th>Son téléphone</th><th></th></tr>"
                       + lignes + "</table>")
        else:
            # Cette phrase est celle que cherche l'œil de l'utilisateur ET
            # celle que vérifient les essais : rien n'est déclaré, la règle
            # stricte du doublon vaut pour tout le monde.
            tableau = ('<p class="bandeau">Aucun numéro d\'essai déclaré : '
                       "la règle stricte du doublon s'applique à tout le "
                       "monde, sans exception. Ajoutez au moins un testeur "
                       "ci-dessous — le vôtre, pour commencer.</p>")
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = ('<div class="erreurs"><strong>Testeur refusé :'
                            f"</strong><ul>{elements}</ul></div>")
        complet = len(liste) >= essai_reel.TESTEURS_MAXIMUM
        if complet:
            ajout = (f'<p class="bandeau">{essai_reel.TESTEURS_MAXIMUM} '
                     "testeurs déclarés : c'est le maximum. Retirez-en un "
                     "pour pouvoir en ajouter un autre.</p>")
        else:
            ajout = f"""<form method="post" action="/reglages/testeur" class="carte">
  <input type="hidden" name="action" value="ajouter">
  <label>Nom du testeur — qui est-ce ? (« moi », « Paul », « le cabinet
    d'à côté »)<br>
    <input name="nom" value="{html.escape(nom_saisi, quote=True)}"
           placeholder="moi" maxlength="40" autocomplete="off"></label>
  <label>Son téléphone — format attendu : 10 chiffres commençant par 0
    (06 39 98 00 00), ou +33 suivi de 9 chiffres<br>
    <input name="numero" value="{html.escape(numero_saisi, quote=True)}"
           placeholder="06 39 98 00 00" autocomplete="off"></label>
  <button>Ajouter ce testeur</button>
</form>"""
        return f"""{bloc_erreurs}
{tableau}
{ajout}"""

    def _traiter_testeur(self, corps):
        """Ajoute ou retire UN testeur — l'élément se recharge, pas la page.

        Deux chemins, un seul traitement, comme pour la semaine type :
        - avec JavaScript, « fragment=1 » est envoyé et le bloc des testeurs
          revient seul, erreurs comprises ;
        - sans JavaScript, on repart sur la page des réglages, à l'ancre du
          bloc — rien n'est perdu, c'est simplement moins fluide.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        fragment = donnees.get("fragment", [""])[0] == "1"
        action = donnees.get("action", ["ajouter"])[0]
        preferences = self.application.preferences
        erreurs, nom_saisi, numero_saisi = [], "", ""
        if action == "retirer":
            brut = donnees.get("rang", [""])[0]
            rang = int(brut) if brut.isdigit() else 0
            _, retire = essai_reel.retirer_testeur(preferences, rang)
            if retire is None:
                erreurs.append(
                    f"Aucun testeur n°{html.escape(brut) or '?'} à retirer : "
                    "la liste a peut-être changé entre-temps. Rien n'a été "
                    "modifié — voyez la liste ci-dessous.")
        else:
            nom_saisi = donnees.get("nom", [""])[0]
            numero_saisi = donnees.get("numero", [""])[0]
            try:
                essai_reel.ajouter_testeur(preferences, nom_saisi,
                                           numero_saisi)
                nom_saisi, numero_saisi = "", ""
            except saisie.SaisieInvalide as erreur:
                erreurs.append(str(erreur))
                # Le numéro déjà déclaré est déjà connu de RingBack : il
                # revient MASQUÉ, il n'y a rien à récupérer. Un numéro
                # illisible, lui, revient tel quel — sinon la faute de frappe
                # serait invisible et la saisie, perdue.
                try:
                    propre = saisie.valider_telephone(numero_saisi)
                except saisie.SaisieInvalide:
                    propre = ""
                if propre and essai_reel.est_numero_essai(propre, preferences):
                    numero_saisi = db.masquer_telephone(propre)
        # La base marque 🧪 les lignes de ces numéros : elle doit connaître la
        # nouvelle liste TOUT DE SUITE, sans redémarrer le serveur.
        self.application.base.definir_numeros_essai(
            essai_reel.numeros_declares(preferences))
        if fragment:
            return self._repondre_fragment(
                self._bloc_testeurs(erreurs, nom_saisi, numero_saisi))
        if erreurs:
            return self._repondre(self._page_reglages(erreurs=erreurs))
        return self._rediriger("/reglages?fait=1#numero-essai")

    def _bloc_renvoi_essai(self, erreurs=(), numero_saisi="", coche=None):
        """Le FRAGMENT « toujours composer MON numéro » : l'état, puis les gestes.

        ⚠ LE CHAMP EST TOUJOURS VIDE quand un numéro est enregistré, et le
        numéro enregistré est affiché MASQUÉ à côté. C'est la règle du produit,
        tenue ici comme partout : un numéro ne se réaffiche pas en clair, même
        le sien — un écran finit toujours par être photographié. Pour le
        changer, on en tape un autre ; pour l'effacer, il y a un bouton.

        Une saisie REFUSÉE, elle, revient telle quelle : une faute de frappe
        invisible serait impossible à corriger, et « 06 39 98 00 0 » n'est de
        toute façon pas un numéro à protéger.

        ⚠ LE NUMÉRO D'EXEMPLE DU PLACEHOLDER EST À PART (06 39 98 00 00) : il
        vient des racines que l'Arcep réserve à la fiction, comme partout dans
        le produit, et il est choisi pour ne ressembler à AUCUN numéro qu'on
        enregistrerait vraiment. Sinon il s'afficherait à l'endroit même où l'on
        vérifie qu'un numéro enregistré ne se réaffiche jamais.
        """
        preferences = self.application.preferences
        etat = essai_reel.etat_du_renvoi(preferences)
        if coche is None:
            coche = etat["coche"]
        if etat["actif"]:
            pastille = ('<p class="pastille st-deplace">🧪 <strong>Renvoi '
                        "actif</strong> — en mode réel, tous les appels iront "
                        f"vers {html.escape(etat['masque'])}. Aucun contact ne "
                        "sera appelé sur son propre numéro.</p>")
        elif etat["incoherent"]:
            # On n'arrive ici qu'en modifiant donnees/preferences.json à la
            # main : l'enregistrement refuse un numéro illisible. L'écran le
            # dit quand même, parce que le mode réel, lui, refusera d'appeler.
            pastille = ('<div class="erreurs"><strong>La case est cochée, mais '
                        "le numéro enregistré n'est pas un numéro.</strong> "
                        "En mode réel, RingBack REFUSERA tout appel : il "
                        "n'appellera pas vos contacts à la place de votre "
                        "numéro d'essai. Ré-enregistrez un numéro ci-dessous, "
                        "ou décochez la case.</div>")
        elif etat["masque"]:
            pastille = (f"<p>Un numéro d'essai est enregistré "
                        f"({html.escape(etat['masque'])}) et la case est "
                        "<strong>décochée</strong> : en mode réel, vos "
                        "contacts sont appelés sur leur propre numéro.</p>")
        else:
            pastille = ("<p>Aucun numéro d'essai enregistré : en mode réel, "
                        "vos contacts sont appelés <strong>sur leur propre "
                        "numéro</strong>.</p>")
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = ('<div class="erreurs"><strong>Réglage refusé :'
                            f"</strong><ul>{elements}</ul></div>")
        indication = ("laissez vide pour garder celui qui est enregistré"
                      if etat["masque"] else "aucun numéro enregistré")
        retrait = ""
        if etat["masque"] or etat["numero"]:
            retrait = """<form method="post" action="/reglages/renvoi-essai">
  <input type="hidden" name="action" value="retirer">
  <button class="secondaire">Retirer mon numéro d'essai</button>
</form>"""
        return f"""{bloc_erreurs}
{pastille}
<form method="post" action="/reglages/renvoi-essai" class="carte">
  <div class="ligne-option"><label class="option">
    <input type="checkbox" name="imposer" value="1"{" checked" if coche else ""}>
    <span>Toujours utiliser mon numéro de téléphone pour les essais en
    conditions réelles</span></label></div>
  <label>Mon numéro d'essai — un numéro français (10 chiffres commençant
    par 0, comme 06 39 98 00 00) ou un numéro international avec son indicatif
    (+44 20 7946 0958) — {indication}<br>
    <input name="numero" value="{html.escape(numero_saisi, quote=True)}"
           placeholder="06 39 98 00 00" autocomplete="off"></label>
  <button>Enregistrer</button>
</form>
{retrait}"""

    def _traiter_renvoi_essai(self, corps):
        """Enregistre (ou retire) le renvoi — l'élément se recharge, pas la page.

        Deux chemins, un seul traitement, comme pour les testeurs : avec
        JavaScript le bloc revient seul (« fragment=1 »), sans JavaScript on
        repart sur la page des réglages, à l'ancre du bloc.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        fragment = donnees.get("fragment", [""])[0] == "1"
        action = donnees.get("action", ["enregistrer"])[0]
        preferences = self.application.preferences
        erreurs, numero_saisi, coche = [], "", None
        if action == "retirer":
            essai_reel.retirer_renvoi(preferences)
        else:
            coche = donnees.get("imposer", [""])[0] == "1"
            numero_saisi = donnees.get("numero", [""])[0]
            try:
                essai_reel.enregistrer_renvoi(preferences, coche, numero_saisi)
                # Enregistré : le champ repart VIDE, le numéro ne se réaffiche
                # pas (il est décrit, masqué, par le bloc).
                numero_saisi, coche = "", None
            except saisie.SaisieInvalide as erreur:
                erreurs.append(str(erreur))
        if fragment:
            return self._repondre_fragment(
                self._bloc_renvoi_essai(erreurs, numero_saisi, coche))
        if erreurs:
            # 400, comme le refus de la clé CALL-E : le réglage n'a PAS été
            # enregistré, et le code de la réponse doit le dire aussi.
            return self._repondre(self._page_reglages(erreurs=erreurs), 400)
        return self._rediriger("/reglages?fait=1#renvoi-essai")

    def _tableau_repartition(self, repartition):
        """« Qui joue quoi » : une ligne par appel, dans l'ordre des appels."""
        lignes = "".join(f"""<tr>
  <td>{part['rang']}</td>
  <td>{html.escape(part['identite'])}</td>
  <td>{html.escape(part['role'])}</td>
  <td>→ <strong>{html.escape(part['testeur'])}</strong></td>
  <td>{html.escape(db.masquer_telephone(part['telephone']))}</td>
</tr>""" for part in repartition)
        return ("<table><tr><th>Appel n°</th><th>Identité appelée</th>"
                "<th>Rôle à jouer</th><th>Par qui</th>"
                "<th>Son téléphone</th></tr>" + lignes + "</table>")

    def _bloc_essai_reel(self, nombre_brut=""):
        """Le FRAGMENT 🧪 « Essai en conditions réelles » des réglages.

        Il annonce QUI devra jouer QUOI (la répartition des rôles sur les
        testeurs déclarés), ce que ça coûtera, et porte le bouton qui PRÉPARE
        (et rien de plus) la campagne d'essai. Aucun appel n'en part : la
        campagne est créée « prête », c'est l'opérateur qui la démarre, avec
        ses trois verrous. Sans testeur déclaré, le bouton le DIT et ne fait
        rien — jamais un bouton qui échoue en silence.
        """
        preferences = self.application.preferences
        erreurs = []
        try:
            nombre = essai_reel.valider_nombre_identites(nombre_brut)
            valeur_nombre = str(nombre)
        except saisie.SaisieInvalide as erreur:
            # Saisie refusée jamais perdue : le nombre tapé revient dans son
            # champ, et l'aperçu montre en attendant le nombre par défaut.
            erreurs.append(str(erreur))
            nombre = len(essai_reel.IDENTITES)
            valeur_nombre = (nombre_brut or "").strip()
        info = essai_reel.resume(preferences, nombre)
        liste = info["testeurs"]
        # ⚠ CE BLOC RÉPOND À LA QUESTION « QUI VA SONNER ? » à l'endroit où
        # l'on prépare des appels. Les testeurs disent quels NUMÉROS portent
        # les fiches ; le renvoi, lui, peut faire que ce ne soient pas eux qui
        # sonnent. Les deux réglages se lisent donc ensemble, ou pas du tout.
        renvoi = essai_reel.etat_du_renvoi(preferences)
        renvoi_dit = ""
        if renvoi["actif"]:
            renvoi_dit = ('<p class="pastille st-deplace">🧪 <strong>Le renvoi '
                          "d'essai est actif</strong> : quels que soient les "
                          "numéros ci-dessus, tous les appels iront vers "
                          f"{html.escape(renvoi['masque'])}. "
                          '<a href="/reglages#renvoi-essai">Le réglage</a></p>')
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = ('<div class="erreurs"><strong>Nombre refusé :'
                            f"</strong><ul>{elements}</ul></div>")
        if liste:
            resume_qui = " · ".join(
                f"{html.escape(essai_reel.prenom(part['identite']))}"
                f" ({html.escape(part['court'])}) → "
                f"<strong>{html.escape(part['testeur'])}</strong>"
                for part in info["repartition"])
            etat = (f'<p class="pastille st-deplace">🧪 {len(liste)} '
                    f"testeur(s) déclaré(s) — {info['identites']} rôle(s) à "
                    "répartir entre eux.</p>"
                    f"<p>{resume_qui}</p>"
                    + self._tableau_repartition(info["repartition"]))
            bouton = "<button>Préparer une campagne d'essai réel…</button>"
        else:
            etat = ('<p class="bandeau">Aucun testeur déclaré. Ajoutez-en au '
                    'moins un dans <a href="#numero-essai">🧪 Testeurs de '
                    "l'essai réel</a> plus haut : sans lui, RingBack refuse — "
                    "à juste titre — plusieurs contacts portant le même "
                    "numéro, et cette campagne d'essai ne peut pas exister.</p>")
            bouton = ('<button class="secondaire">Préparer une campagne '
                      "d'essai réel…</button>")
        return f"""{bloc_erreurs}
{etat}
<p>Pour éprouver une campagne entière avec de <strong>vrais appels</strong>,
sur des téléphones que vous connaissez : {info['identites']} identités
fictives, chacune avec un rendez-vous à confirmer, réparties sur vos
testeurs <strong>en tournant</strong> (le 1ᵉʳ rôle au 1ᵉʳ testeur, le 2ᵉ au
2ᵉ, et on reboucle). Avec un seul testeur, tout retombe sur lui. L'initiale
du prénom rappelle le rôle à jouer : <strong>A</strong>lice accepte,
<strong>R</strong>émi refuse, <strong>D</strong>iane demande une autre date,
<strong>H</strong>ugo veut un humain, <strong>N</strong>ina ne décroche
pas.</p>
<form method="get" action="/reglages/essai-reel" class="carte">
  <label>Combien d'identités ? — au moins {essai_reel.IDENTITES_MINIMUM}
    (une par rôle à éprouver), au plus {essai_reel.IDENTITES_MAXIMUM}<br>
    <input class="champ-court" type="number" name="nombre"
           id="nombre-identites" min="{essai_reel.IDENTITES_MINIMUM}"
           max="{essai_reel.IDENTITES_MAXIMUM}"
           value="{html.escape(valeur_nombre, quote=True)}"></label>
  <p><small><strong>Coût : {html.escape(info['cout'])}</strong> — un appel
  par identité. Au-delà de {essai_reel.IDENTITES_MINIMUM}, les rôles
  reviennent dans le même ordre, portés par d'autres prénoms de même
  initiale.</small></p>
  {bouton}
</form>
{renvoi_dit}
<p><strong>Aucun appel ne part d'ici.</strong> La campagne est créée à
l'état <strong>« prête »</strong>, zéro appel passé : c'est vous qui la
démarrez, et les trois verrous du mode réel (clé CALL-E, lancement en mode
réel, mot APPELER tapé) restent vos gestes. Les appels partent
<strong>un par un</strong> : un seul téléphone sonne à la fois, vos testeurs
doivent donc être disponibles ensemble. La marche à suivre, ce qu'il faut
dire au téléphone pour produire chaque issue et ce qu'il faut vérifier
ensuite sont écrits dans <code>PROCEDURE-ESSAI-REEL.md</code>, à la racine
du projet.</p>
<p><small>Ces {info['identites']} fiches sont marquées 🧪 « jeu d'essai » :
elles se retirent en bloc avec « Retirer le jeu d'essai » ci-dessus, sans
jamais toucher à vos vraies données.</small></p>"""

    def _page_confirmer_essai_reel(self, erreur="", nombre_brut=""):
        """La page de confirmation AVANT de préparer l'essai en conditions réelles."""
        preferences = self.application.preferences
        liste = essai_reel.testeurs(preferences)
        message = erreur
        nombre = None
        if not message:
            try:
                nombre = essai_reel.valider_nombre_identites(nombre_brut)
            except saisie.SaisieInvalide as refus:
                message = f"{refus} Rien n'a été créé."
        if message or not liste:
            message = message or (
                "Aucun numéro d'essai déclaré : renseignez d'abord au moins "
                "un testeur dans « 🧪 Testeurs de l'essai réel » (⚙ Réglages), "
                "puis revenez ici. Rien n'a été créé.")
            corps = f"""{self._bandeau()}
<p><a href="/reglages">← Retour aux réglages</a></p>
<h1>Essai en conditions réelles — rien n'a été préparé</h1>
<div class="erreurs"><p>{html.escape(message)}</p></div>
<p><a class="bouton" href="/reglages#numero-essai">Aller au réglage
🧪 Testeurs de l'essai réel</a></p>"""
            return self._page("Essai en conditions réelles", corps,
                              actif="reglages")
        info = essai_reel.resume(preferences, nombre)
        testeurs_lignes = "".join(
            f"<li><strong>{html.escape(testeur['nom'])}</strong> — "
            f"{html.escape(db.masquer_telephone(testeur['telephone']))}</li>"
            for testeur in liste)
        corps = f"""{self._bandeau()}
<p><a href="/reglages">← Retour aux réglages</a></p>
<h1>Préparer la campagne d'essai en conditions réelles ?</h1>
<p>Vont être <strong>ajoutés</strong> à votre base (rien n'est effacé) :</p>
<ul>
  <li><strong>{info['identites']} contacts fictifs</strong>, marqués 🧪
      « jeu d'essai », répartis sur vos {len(liste)} testeur(s) :</li>
</ul>
<ul>{testeurs_lignes}</ul>
<ul>
  <li><strong>{info['identites']} rendez-vous</strong> posés sur vos
      premières places libres — ou demain matin s'il n'y en a pas assez
      (horaires d'ouverture non réglés, ou agenda plein) : l'écran vous
      dira lequel des deux cas s'est produit ;</li>
  <li>une campagne <strong>« Confirmation de rendez-vous »</strong> à
      l'état <strong>« prête »</strong>.</li>
</ul>
<h2>Qui devra jouer quoi</h2>
<p>Prévenez chaque testeur de son rôle <strong>avant</strong> de démarrer :
les appels partent un par un, dans cet ordre.</p>
{self._tableau_repartition(info["repartition"])}
<p><strong>Coût : {html.escape(info['cout'])}</strong>.</p>
<div class="erreurs"><p><strong>AUCUN APPEL NE PART DE CE BOUTON.</strong>
La campagne est seulement préparée. Pour qu'un vrai appel sonne, il faut
ensuite VOS trois gestes : la clé CALL-E dans l'environnement, le
lancement en mode réel, et le mot APPELER tapé au clavier. Chaque appel
réel consomme un crédit.</p></div>
<form method="post" action="/reglages/essai-reel">
  <input type="hidden" name="confirmer" value="oui">
  <input type="hidden" name="nombre" value="{info['identites']}">
  <button>Préparer la campagne d'essai (aucun appel)</button>
</form>
<p><a href="/reglages">Annuler — revenir aux réglages</a></p>"""
        return self._page("Préparer l'essai en conditions réelles ?", corps,
                          actif="reglages")

    def _traiter_essai_reel(self, corps):
        """Prépare la campagne d'essai réel — après la page de confirmation."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        if donnees.get("confirmer", [""])[0] != "oui":
            return self._erreur(400, "Action non confirmée.")
        nombre_brut = donnees.get("nombre", [""])[0]
        try:
            nombre = essai_reel.valider_nombre_identites(nombre_brut)
        except saisie.SaisieInvalide as refus:
            return self._repondre(self._page_confirmer_essai_reel(
                f"{refus} Rien n'a été créé."))
        try:
            bilan = essai_reel.preparer(self.application, nombre=nombre)
        except essai_reel.EssaiImpossible as erreur:
            return self._repondre(self._page_confirmer_essai_reel(str(erreur)))
        return self._rediriger(
            f"/campagne?id={bilan['campagne_id']}&essai_reel=prete"
            f"&repli={1 if bilan['repli'] else 0}"
            f"&testeurs={len(bilan['testeurs'])}")

    def _page_confirmer_jeu_essai(self, action):
        """La page de confirmation AVANT de charger ou de retirer le jeu d'essai."""
        base = self.application.base
        info = jeu_essai.resume(
            self._langue())
        if action == "retirer":
            corps = f"""{self._bandeau()}
<p><a href="/reglages">← Retour aux réglages</a></p>
<h1>Retirer le jeu d'essai ?</h1>
<p>Seules les fiches marquées 🧪 partiront :
<strong>{base.compter_clients_jeu_essai()} client(s) d'essai</strong> et
leurs rendez-vous. <strong>Vos propres clients et rendez-vous ne sont pas
touchés.</strong></p>
<p>Les campagnes déjà jouées, elles, restent : leurs résultats sont un
historique, réutilisable pour créer de nouvelles campagnes.</p>
<form method="post" action="/reglages/jeu-essai">
  <input type="hidden" name="action" value="retirer">
  <input type="hidden" name="confirmer" value="oui">
  <button class="danger">Retirer le jeu d'essai</button>
</form>
<p><a href="/reglages">Annuler — revenir aux réglages</a></p>"""
            return self._page("Retirer le jeu d'essai ?", corps,
                              actif="reglages")
        statuts = " ; ".join(f"{nombre} {statut}"
                             for statut, nombre in sorted(info["statuts"].items()))
        corps = f"""{self._bandeau()}
<p><a href="/reglages">← Retour aux réglages</a></p>
<h1>Charger un jeu d'essai ?</h1>
<p>Vont être <strong>ajoutés</strong> à votre base (rien n'est effacé) :</p>
<ul>
  <li><strong>{info['clients']} contacts</strong> d'un
      {html.escape(info['metier'].lower())}, marqués 🧪 « jeu d'essai » ;</li>
  <li><strong>{info['rendezvous']} rendez-vous</strong> —
      {info['passes']} dans le passé, {info['a_venir']} à venir
      ({html.escape(statuts)}) ;</li>
  <li>dont {info['ne_plus_appeler']} contacts 🚫 « ne plus appeler » et
      {info['sans_numero']} sans numéro, à compléter ;</li>
  <li>dont {info['longs']} rendez-vous <strong>plus longs</strong> que la
      durée moyenne (une demi-heure, une heure) : ils occupent plusieurs
      tranches consécutives.</li>
</ul>
<p>Tous les numéros viennent des racines que l'Arcep réserve aux œuvres
audiovisuelles : ils ne peuvent ni appeler ni être appelés. Une poignée se
termine par 51 à 56, les terminaisons que le simulateur reconnaît — une
campagne d'essai produit ainsi tous les cas de figure (accepté, refusé, pas
de réponse, autre date, à rappeler par un humain).</p>
<p>Tant qu'il est chargé, chaque page l'annonce, et le retrait est possible
à tout moment depuis les réglages.</p>
<form method="post" action="/reglages/jeu-essai">
  <input type="hidden" name="action" value="charger">
  <input type="hidden" name="confirmer" value="oui">
  <button>Charger le jeu d'essai</button>
</form>
<p><a href="/reglages">Annuler — revenir aux réglages</a></p>"""
        return self._page("Charger un jeu d'essai ?", corps, actif="reglages")

    def _traiter_jeu_essai(self, corps):
        """Charge ou retire le jeu d'essai — après la page de confirmation."""
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        if donnees.get("confirmer", [""])[0] != "oui":
            return self._erreur(400, "Action non confirmée.")
        action = donnees.get("action", [""])[0]
        base = self.application.base
        if action == "charger":
            # ⚠ DANS LA LANGUE DE L'ÉCRAN. Un testeur anglophone qui charge
            # le jeu d'essai doit recevoir un décor anglais : c'est le geste
            # par lequel il découvre le produit.
            clients, rdv = jeu_essai.charger(
                base, langue_code=self._langue())
            return self._rediriger(f"/reglages?essai=charge&clients={clients}"
                                   f"&rdv={rdv}#jeu-essai")
        if action == "retirer":
            # Désarmé d'abord (pour pouvoir DIRE combien), puis retiré.
            desarmees = base.desarmer_jeu_essai()
            clients, rdv = jeu_essai.retirer(base)
            return self._rediriger(f"/reglages?essai=retire&clients={clients}"
                                   f"&rdv={rdv}&desarmees={desarmees}#jeu-essai")
        return self._erreur(400, "Action inconnue pour le jeu d'essai "
                                 "(attendu « charger » ou « retirer »).")

    def _tableau_bilan(self):
        """Petit tableau récapitulatif des issues de tous les appels passés."""
        bilan = self.application.base.bilan_issues()
        return f"""<table>
<tr><th>Confirmés</th><th>Déplacés (autre date)</th><th>Annulés (par le client)</th><th>À reprogrammer</th><th>Échecs</th></tr>
<tr><td>{bilan['confirmed']}</td><td>{bilan['rescheduled']}</td>
<td>{bilan['canceled']}</td><td>{bilan['to_reschedule']}</td><td>{bilan['echec']}</td></tr>
</table>"""

    def _formulaires_import(self):
        """Les DEUX imports : CSV et agenda ICS. Écrits une fois, servis deux.

        ⚠ LA PAGE « /ajouter » ET LA FENÊTRE MONTRENT LE MÊME TEXTE. Deux
        rédactions du même formulaire finissent toujours par se contredire, et
        c'est au moment d'importer qu'on s'en aperçoit.
        """
        return f"""<p class="bandeau">⚠ {html.escape(AVERTISSEMENT_IMPORT)}</p>
<h2>Importer un fichier CSV</h2>
<p><small>Colonnes séparées par « ; » :
<code>nom;telephone;date_heure;motif</code> — un fichier d'exemple est fourni
(<code>exemple_import.csv</code>).</small></p>
<form method="post" action="/importer" enctype="multipart/form-data" class="carte">
  <label>Fichier CSV<br>
    <input type="file" name="fichier" accept=".csv,text/csv"></label>
  <button>Importer</button>
</form>
<h2>Importer un agenda (fichier ICS)</h2>
<p><small>Le format iCalendar, exporté par la plupart des agendas
(Google&nbsp;Agenda, Outlook, Thunderbird…). Un rendez-vous sans téléphone
arrive « sans numéro », à compléter ensuite — jamais de numéro
inventé.</small></p>
<form method="post" action="/importer-ics" enctype="multipart/form-data" class="carte">
  <label>Fichier ICS<br>
    <input type="file" name="fichier" accept=".ics,text/calendar"></label>
  <div class="ligne-option"><label class="option">
    <input type="checkbox" name="remplacer_tout" value="1">
    <span>Remplacer entièrement l'agenda</span></label></div>
  <p><small>Cochée, elle <strong>vide l'agenda à venir</strong> avant
  d'importer : les rendez-vous qui tenaient encore une place passent
  « supprimé », leur place est rendue, et ils restent lisibles dans
  🗂 Tous les rendez-vous. Le passé n'est pas touché.</small></p>
  <button>Importer l'agenda</button>
</form>"""

    def _modale_import(self):
        """La fenêtre « ＋ Importer votre agenda » : les deux imports, rien d'autre."""
        return self._modale("＋ Importer votre agenda",
                            self._formulaires_import())

    def _formulaire_ajout_main(self, valeurs=None, erreurs=(), cible="/ajouter"):
        """Le formulaire d'ajout à la main. Servi par la page ET par la fenêtre.

        `cible` : où il poste. La page garde « /ajouter » ; la fenêtre poste au
        même endroit — c'est le MÊME traitement, donc les mêmes refus et les
        mêmes règles anti-doublon.
        """
        valeurs = valeurs or {}
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = ('<div class="erreurs"><strong>Saisie refusée :'
                            f"</strong><ul>{elements}</ul>"
                            "<p>Par prudence, le numéro de téléphone est à "
                            "ressaisir.</p></div>")
        return f"""{bloc_erreurs}
<form method="post" action="{cible}" class="carte">
  <label>Nom du contact<br>
    <input name="nom" value="{html.escape(valeurs.get('nom', ''), quote=True)}"
           placeholder="Mme Exemple Dupont"></label>
  <label>Téléphone (fictif : +33 6 00 00 00 XX)<br>
    <input name="telephone" placeholder="+33 6 00 00 00 49"></label>
  <label>Date et heure<br>
    <input type="datetime-local" name="date_heure"
           value="{html.escape(valeurs.get('date_heure', ''), quote=True)}"></label>
  <label>Motif<br>
    <input name="motif" value="{html.escape(valeurs.get('motif', ''), quote=True)}"
           placeholder="Séance de kinésithérapie"></label>
  <label>Date et heure de rappel souhaitée (optionnel)<br>
    <input type="datetime-local" name="rappel_souhaite"
           value="{html.escape(valeurs.get('rappel_souhaite', ''), quote=True)}"></label>
  <button>Enregistrer</button>
</form>"""

    def _modale_ajout(self, parametres):
        """La fenêtre « ＋ Ajouter un rendez-vous », ouverte depuis un créneau libre.

        ⚠ LA DATE ET L'HEURE SONT DÉJÀ REMPLIES avec le créneau cliqué : c'est
        tout l'intérêt d'ouvrir ce formulaire DEPUIS une place libre. Elles
        restent modifiables — rien n'est décidé à la place de l'opérateur.
        """
        creneau = (parametres or {}).get("creneau", [""])[0]
        valeurs = {}
        try:
            valeurs["date_heure"] = datetime.datetime.fromisoformat(
                creneau).strftime("%Y-%m-%dT%H:%M")
        except (TypeError, ValueError):
            pass
        return self._modale("＋ Ajouter un rendez-vous",
                            self._formulaire_ajout_main(valeurs))

    def _page_ajout(self, valeurs=None, erreurs=None):
        """La page de repli : le même formulaire et les mêmes imports.

        ⚠ ELLE RESTE, et c'est voulu. Les deux fenêtres (import, ajout) sont
        de vrais liens vers ici : sans JavaScript — ou sur un téléphone où le
        script n'a pas chargé — tout reste faisable, à la même adresse.
        """
        corps = f"""<p><a href="/suivi">← Retour aux rendez-vous</a></p>
<h1>Ajouter un rendez-vous</h1>
{self._formulaire_ajout_main(valeurs, erreurs or ())}
{self._formulaires_import()}"""
        return self._page("Ajouter un rendez-vous", corps, actif="suivi")

    def _page_confirmation_ajout(self, rdv_id):
        rdv = self.application.base.obtenir_rendezvous(rdv_id)
        if rdv["statut"] == "manqué":
            # ⚠ « À rappeler » N'EXISTE PLUS (10/08/2026) : on renvoie là où ce
            # rendez-vous se voit vraiment. Garder l'ancienne ancre aurait
            # promis un écran qui n'affiche plus rien.
            visibilite = ("Statut : manqué (l'horaire est déjà passé) — visible "
                          "dans 🗂 Tous les rendez-vous, avec sa pastille.")
            lien = ('<p><a href="/tous">Voir dans « Tous les rendez-vous »</a>'
                    "</p>")
        else:
            # ⚠ « Rendez-vous à venir » N'EXISTE PLUS (10/08/2026) : on
            # renvoie là où ce rendez-vous se voit vraiment — le planning, et
            # la liste complète. Promettre une section retirée aurait mené
            # sur un écran sans elle.
            visibilite = ("Statut : prévu — visible dès maintenant sur le "
                          "planning de la page 📅 Rendez-vous.")
            lien = ('<p><a href="/suivi">Voir sur le planning</a> · '
                    '<a href="/tous">Voir dans « Tous les rendez-vous »</a></p>')
        rappel = ""
        if rdv["rappel_souhaite"]:
            rappel = (f"🔔 Rappel souhaité : {_date_lisible(rdv['rappel_souhaite'])}<br>")
        corps = f"""<p><a href="/suivi">← Retour aux rendez-vous</a></p>
<h1>Rendez-vous enregistré</h1>
<p>Contact : <strong>{html.escape(rdv['nom'])}</strong> — {html.escape(rdv['telephone_masque'])}<br>
Horaire : {_date_lisible(rdv['horaire'])}<br>
Motif : {html.escape(rdv['motif'])}<br>
{rappel}<span class="pastille">{html.escape(visibilite)}</span></p>
{lien}
<p><a href="/ajouter">Ajouter un autre rendez-vous</a></p>"""
        return self._page("Rendez-vous enregistré", corps, actif="suivi")

    def _page_doublon(self, existant, propres, rappel_souhaite=None):
        """Le signal anti-doublon : rien n'est créé sans confirmation.

        Le formulaire « Ajouter quand même » repart de l'identifiant du
        client existant : le numéro en clair n'apparaît nulle part.
        """
        champ_rappel = ""
        if rappel_souhaite:
            champ_rappel = ('<input type="hidden" name="rappel_souhaite" '
                            f'value="{html.escape(rappel_souhaite)}">')
        corps = f"""<p><a href="/suivi">← Retour aux rendez-vous</a></p>
<h1>Ce rendez-vous existe déjà</h1>
<p class="erreurs">Un rendez-vous identique (même client, même horaire) est déjà
enregistré — <strong>rien n'a été ajouté</strong>, pour éviter un doublon :</p>
<p>Contact : <strong>{html.escape(existant['nom'])}</strong> —
{html.escape(existant['telephone_masque'])}<br>
Horaire : {_date_lisible(existant['horaire'])}<br>
Motif : {html.escape(existant['motif'])}<br>
Statut : {self._pastille_statut(existant['statut'])}
— <a href="/rendezvous?id={existant['id']}">voir sa fiche</a></p>
<p>Si c'est bien voulu (deux rendez-vous distincts au même horaire pour cette
personne), confirmez explicitement :</p>
<form method="post" action="/ajouter">
  <input type="hidden" name="forcer" value="{existant['client_id']}">
  <input type="hidden" name="date_heure" value="{html.escape(propres['date_heure'])}">
  <input type="hidden" name="motif" value="{html.escape(propres['motif'])}">
  {champ_rappel}
  <button class="secondaire">Ajouter quand même</button>
</form>
<p><a href="/ajouter">Annuler — revenir au formulaire</a></p>"""
        return self._page("Ce rendez-vous existe déjà", corps, actif="suivi")

    def _compte_rendu_import(self, jeton):
        """Ce qu'un import vient de faire — affiché EN TÊTE DE L'AGENDA.

        ⚠ TROIS CHOSES QU'ON NE PEUT PAS TAIRE : ce qui a été rejeté, ce qui a
        été DÉPLACÉ (l'import prend la place qu'il trouve), et ce qui arrive
        sans numéro. Revenir sur l'agenda sans rien dire aurait fait disparaître
        des rendez-vous sous les yeux de l'opérateur, sans un mot.

        Un jeton inconnu (page rechargée bien plus tard, serveur redémarré) ne
        montre RIEN plutôt qu'un compte rendu vide : mieux vaut pas de message
        qu'un message qui ne veut rien dire.
        """
        bilan = self.application.bilans_recuperation.get(jeton or "")
        if not bilan:
            return ""
        erreurs = bilan.get("erreurs") or []
        rejet = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs[:12])
            reste = (f"<li>… et {len(erreurs) - 12} autre(s)</li>"
                     if len(erreurs) > 12 else "")
            rejet = (f'<div class="erreurs"><strong>{len(erreurs)} ligne(s) '
                     f"rejetée(s) :</strong><ul>{elements}{reste}</ul></div>")
        sans_numero = self.application.base.rendezvous_sans_numero()
        complete = ""
        if sans_numero:
            complete = (f'<p><a href="/sans-numero">✎ {len(sans_numero)} '
                        "rendez-vous sans numéro — à compléter</a></p>")
        return (f'<p class="pastille">📥 Import terminé — '
                f'<strong>{bilan.get("importes", 0)}</strong> rendez-vous '
                f'importé(s) depuis le {html.escape(bilan.get("quoi", "fichier"))}.'
                f"</p>{rejet}{self._bloc_remplaces(bilan)}{complete}")

    def _bloc_remplaces(self, bilan):
        """Ce que l'import a DÉPLACÉ — dit, jamais tu.

        ⚠ SANS CE BLOC, UN IMPORT POURRAIT VIDER UNE JOURNÉE EN SILENCE. Les
        rendez-vous dont la place a été prise ne sont pas effacés : ils passent
        « annulé » (date passée) ou « supprimé » (date à venir) et restent
        lisibles dans 🗂 Tous les rendez-vous. Encore faut-il l'apprendre au
        moment où ça arrive.
        """
        bilan = bilan or {}
        vides = bilan.get("vides") or []
        remplaces = bilan.get("remplaces") or []
        if not vides and not remplaces:
            return ("<p>Aucun rendez-vous de votre agenda n'a été déplacé : "
                    "toutes les places importées étaient libres.</p>")
        morceaux = []
        if vides:
            morceaux.append(f"<strong>{len(vides)}</strong> rendez-vous à venir "
                            "retiré(s) par « remplacer entièrement l'agenda »")
        if remplaces:
            morceaux.append(f"<strong>{len(remplaces)}</strong> rendez-vous dont "
                            "la place a été prise par un rendez-vous importé")
        lignes = "".join(
            f"<li>{html.escape(rdv['nom'])} — {_date_lisible(rdv['horaire'])}"
            f" → {html.escape(rdv.get('statut_pose', ''))}</li>"
            for rdv in (vides + remplaces)[:20])
        reste = (f"<li>… et {len(vides) + len(remplaces) - 20} autre(s)</li>"
                 if len(vides) + len(remplaces) > 20 else "")
        return (f'<div class="erreurs"><strong>⚠ {" et ".join(morceaux)}.'
                "</strong>"
                "<p>Rien n'est effacé : leur place est rendue et ils restent "
                'lisibles dans <a href="/tous">🗂 Tous les rendez-vous</a> et '
                "sur la fiche du contact.</p>"
                f"<ul>{lignes}{reste}</ul></div>")

    # ⚠ LES DEUX PAGES DE RÉSULTAT D'IMPORT ONT ÉTÉ RETIRÉES le 10/08/2026 :
    # « une fois l'import effectué, on revient directement sur l'agenda »
    # (propriétaire). Ce qu'elles disaient — lignes rejetées, rendez-vous
    # déplacés, numéros à compléter — s'affiche maintenant EN TÊTE DU PLANNING,
    # voir _compte_rendu_import. Le compte rendu passe par un jeton : il nomme
    # des personnes, et un nom n'a rien à faire dans une adresse de page.

    def _bloc_sans_numero(self):
        """Tableau des rendez-vous sans numéro, avec un champ pour compléter."""
        lignes = []
        for rdv in self.application.base.rendezvous_sans_numero():
            lignes.append(f"""<tr>
  <td>{html.escape(rdv['nom'])}</td>
  <td>{_date_lisible(rdv['horaire'])}</td>
  <td>{html.escape(rdv['motif'])}</td>
  <td><span class="pastille">{html.escape(rdv['statut'])}</span></td>
  <td><form method="post" action="/completer-numero">
    <input type="hidden" name="client" value="{rdv['client_id']}">
    <input name="telephone" placeholder="+33 6 00 00 00 49" size="16">
    <button>Enregistrer le numéro</button>
  </form></td>
</tr>""")
        if not lignes:
            return "<p>Tous les rendez-vous ont un numéro de téléphone.</p>"
        return ("<table><tr><th>Contact</th><th>Horaire</th><th>Motif</th>"
                "<th>Statut</th><th>Téléphone à compléter</th></tr>"
                + "\n".join(lignes) + "</table>")

    def _page_sans_numero(self, erreurs=None):
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = (f'<div class="erreurs"><strong>Numéro refusé :</strong>'
                            f"<ul>{elements}</ul></div>")
        corps = f"""{self._bandeau()}
<p><a href="/suivi">← Retour aux rendez-vous</a></p>
<h1>Rendez-vous sans numéro</h1>
<p>Ces rendez-vous viennent d'un agenda importé (fichier ICS) : le fichier ne
contenait pas de téléphone. Un contact sans numéro ne peut pas être rappelé.</p>
{bloc_erreurs}
{self._bloc_sans_numero()}"""
        return self._page("Rendez-vous sans numéro", corps, actif="suivi")

    # ----------------------------------------------------------------- cascade
    def _bloc_generation(self, source, ordre):
        """Le bloc « Remplir depuis les rendez-vous » du formulaire cascade.

        L'ordre d'appel n'a AUCUNE présélection tant que l'utilisateur n'a
        jamais choisi (décision du 27/07 : aucun ordre imposé par défaut) ;
        ensuite, son DERNIER choix — mémorisé dans les préférences — est
        présélectionné, mais reste modifiable à chaque génération.
        """
        preferences = self.application.preferences
        source = source or preferences.obtenir("cascade_source") or "annules"
        ordre = ordre or preferences.obtenir("cascade_ordre")  # None possible
        radios_source = "".join(
            f'<label style="font-weight:normal"><input type="radio" name="source" '
            f'value="{code}"{" checked" if code == source else ""}> '
            f"{html.escape(libelle)}</label>"
            for code, libelle in generation.SOURCES.items())
        radios_ordre = "".join(
            f'<label style="font-weight:normal"><input type="radio" name="ordre" '
            f'value="{code}"{" checked" if code == ordre else ""}> '
            f"{html.escape(libelle)}</label>"
            for code, libelle in generation.ORDRES.items())
        return f"""<fieldset style="margin-bottom:.75rem">
  <legend><strong>Remplir depuis les rendez-vous</strong> (au lieu de coller)</legend>
  <p>Source :</p>{radios_source}
  <p>Ordre d'appel — <strong>à choisir</strong>, aucun ordre n'est imposé par
  défaut (votre dernier choix est présélectionné) :</p>{radios_ordre}
  <p>
    <button formaction="/cascade/generer" class="secondaire">Remplir la liste</button>
    <button formaction="/cascade/csv" class="secondaire">Télécharger la liste (CSV)</button>
  </p>
  <p><small>⚠ La liste injectée ci-dessous et le fichier CSV
  (liste_rappel_AAAAMMJJ.csv) contiennent les numéros <strong>en clair</strong> :
  c'est leur but, à votre demande. Le CSV est généré à la volée et n'est jamais
  écrit sur le serveur. Les clients sans numéro sont exclus.</small></p>
</fieldset>"""

    def _page_cascade(self, erreurs=None, mission=None, creneau=None,
                      liste="", source=None, ordre=None, message=None, exclus=0):
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            complement = ("" if liste else
                          "<p>Par prudence, la liste (qui contient des numéros de "
                          "téléphone) est à recoller.</p>")
            bloc_erreurs = (f'<div class="erreurs"><strong>Saisie refusée :</strong>'
                            f"<ul>{elements}</ul>{complement}</div>")
        bloc_message = ""
        if message:
            bloc_message = f'<p class="pastille">{html.escape(message)}</p>'
        if exclus:
            bloc_message += (f'<p class="erreurs">{exclus} client(s) sans numéro '
                             'exclu(s) de la liste — <a href="/sans-numero">'
                             "compléter les numéros</a>.</p>")
        mission = mission or themes.preremplir(
            "creneau_libere", self.application.preferences,
            creneaux=self._creneaux_lisibles())
        verbe = "RÉELLEMENT" if self.application.mode_reel else "en simulation"
        historique = ""
        cascades = self.application.base.lister_cascades()
        if cascades:
            lignes = "".join(
                f'<li><a href="/cascade/resultat?id={c["id"]}">Cascade n°{c["id"]}'
                f"</a> — créneau {_date_lisible(c['creneau'])} — "
                f"{html.escape(ETIQUETTES_STATUT_CASCADE.get(c['statut'], c['statut']))}</li>"
                for c in cascades)
            historique = f"<h2>Cascades passées</h2><ul>{lignes}</ul>"
        corps = f"""{self._bandeau()}
<h1>Cascade « premier oui »</h1>
<p>Un créneau vient de se libérer ? Donnez votre liste d'attente : les personnes
sont appelées <strong>une à la fois, dans l'ordre</strong>. Dès qu'une personne
accepte, la cascade <strong>s'arrête</strong> : le créneau lui est attribué et
les personnes suivantes ne sont <strong>jamais appelées</strong>. Une personne
qui refuse ou ne répond pas passe la main à la suivante ; une personne qui
préfère une autre date obtient un rendez-vous à cette date (le créneau reste à
pourvoir et la cascade continue).</p>
<p><small>Parcours direct conservé — chaque cascade lancée ici est
enregistrée comme <a href="/">📣 campagne</a> « créneau libéré » ; si le
créneau n'est pas pourvu, les appels non aboutis reçoivent leur 🔁 relance.
L'assistant « <a href="/assistant">➕ Nouvelle campagne</a> » fait la
même chose, guidé.</small></p>
{bloc_erreurs}
{bloc_message}
<form method="post" action="/cascade/executer" class="carte" style="max-width:38rem">
  {self._bloc_generation(source, ordre)}
  <label>Liste d'attente — une ligne par personne : « Nom;Téléphone »
    (virgule ou tabulation acceptées) ; générée ou collée, elle reste
    modifiable et réordonnable à la main<br>
    <textarea name="liste" rows="6" placeholder="Mme Exemple Un;+33 6 00 00 00 51&#10;M. Exemple Deux, 06 00 00 00 52">{html.escape(liste)}</textarea></label>
  {self._selecteur_theme("creneau_libere", mission=mission, note_creneau=True)}
  <label>Créneau proposé (date et heure du créneau libéré)<br>
    <input type="datetime-local" name="creneau" value="{html.escape(creneau or '')}"></label>
  <button>Lancer la cascade — appeler {verbe}, une personne à la fois</button>
</form>
{historique}"""
        return self._page("Cascade « premier oui »", corps, actif="campagnes")

    def _page_resultat_cascade(self, cascade_id):
        base = self.application.base
        cascade = base.obtenir_cascade(cascade_id)
        if cascade is None:
            return None
        appels = base.appels_de_cascade(cascade_id)
        appeles = [a for a in appels if a["etat"] == "appelé"]
        epargnes = [a for a in appels if a["etat"] == "épargné"]
        exclus = [a for a in appels if a["etat"] == "exclu"]
        if cascade["statut"] == "pourvue":
            gagnant = next((a for a in appeles if a["issue"] == "accepted"), None)
            qui = html.escape(gagnant["nom"]) if gagnant else "?"
            entete = (f'<p class="pastille">Créneau attribué à <strong>{qui}</strong> — '
                      f'<a href="/rendezvous?id={cascade["rendezvous_id"]}">voir le '
                      "rendez-vous créé</a>.</p>")
        elif cascade["statut"] == "interrompue":
            entete = ('<p class="erreurs">⛔ Cascade INTERROMPUE par une panne '
                      "de notre côté : la liste n'a pas été essayée. Les "
                      "personnes qui n'apparaissent pas ci-dessous n'ont "
                      "jamais été appelées — relancez la cascade une fois la "
                      "panne réparée.</p>")
        else:
            entete = ('<p class="erreurs">Liste épuisée : personne n\'a pris le '
                      "créneau. Il reste à pourvoir — élargissez la liste ou "
                      "proposez-le autrement.</p>")
        lignes, transcriptions = [], []
        for appel in appeles:
            etiquette = ETIQUETTES_CASCADE.get(appel["issue"], appel["issue"])
            # CE QUE LE PRODUIT A DÉCIDÉ, écrit au moment du changement :
            # l'ancien rendez-vous libéré, ou la mention « à libérer dans
            # votre agenda » quand RingBack ne savait pas duquel il s'agit
            # (Q7). Jamais une phrase prêtée à l'agent.
            lignes.append(f"""<tr>
  <td>{appel['rang']}</td>
  <td>{html.escape(appel['nom'])}</td>
  <td>{html.escape(appel['telephone_masque'])}</td>
  <td><span class="pastille">{html.escape(etiquette)}</span></td>
  <td>{html.escape(appel['note'] or '—')}</td>
</tr>""")
            if appel["transcription"]:
                transcriptions.append(
                    f"<h3>{appel['rang']}. {html.escape(appel['nom'])} — "
                    f"{html.escape(etiquette)}</h3>"
                    f"<pre>{html.escape(appel['transcription'])}</pre>")
        tableau_appeles = ("<table><tr><th>Ordre</th><th>Personne</th>"
                           "<th>Téléphone</th><th>Issue</th>"
                           "<th>L'ancien rendez-vous</th></tr>"
                           + "\n".join(lignes) + "</table>") if lignes else \
            "<p>Personne n'a été appelé.</p>"
        if epargnes:
            # ⚠ LE MOT AFFICHÉ VIENT DE `mot_etat` (14/08/2026, audit croisé).
            # Cette page écrivait encore « épargné » en clair — le mot dont le
            # propriétaire a dit qu'il ne lui parlait pas, et qui a été traduit
            # partout ailleurs.
            mot = assistant.mot_etat("épargné")
            elements = "".join(
                f"<li>{a['rang']}. {html.escape(a['nom'])} — "
                f"{html.escape(a['telephone_masque'])} : "
                f'<strong class="epargne">{html.escape(mot)} '
                "(créneau pris)</strong> — jamais appelé</li>"
                for a in epargnes)
            bloc_epargnes = (f"<h2>Personnes non appelées ({len(epargnes)})</h2>"
                             f"<ul>{elements}</ul>")
        else:
            bloc_epargnes = ""
        if exclus:
            elements = "".join(
                f"<li>{a['rang']}. {html.escape(a['nom'])} — "
                f"{html.escape(a['telephone_masque'])} : "
                '<span class="badge-stop">🚫 ne plus appeler</span> — '
                "jamais appelé</li>" for a in exclus)
            bloc_exclus = (f"<h2>Personnes exclues ({len(exclus)})</h2>"
                           "<p>Marquées « Ne plus appeler » : jamais composées, "
                           "même présentes dans la liste.</p>"
                           f"<ul>{elements}</ul>")
        else:
            bloc_exclus = ""
        bloc_transcriptions = ("<h2>Transcriptions</h2>" + "".join(transcriptions)
                               if transcriptions else "")
        corps = f"""{self._bandeau()}
<p><a href="/cascade">← Retour à la cascade</a></p>
<h1>Cascade n°{cascade_id} — {html.escape(
            ETIQUETTES_STATUT_CASCADE.get(cascade['statut'], cascade['statut']))}</h1>
<p>Créneau proposé : <strong>{_date_lisible(cascade['creneau'])}</strong><br>
Mission lue par l'agent : « {html.escape(cascade['mission'])} »</p>
{entete}
<h2>Personnes appelées ({len(appeles)})</h2>
{tableau_appeles}
{bloc_epargnes}
{bloc_exclus}
{bloc_transcriptions}"""
        return self._page(f"Cascade n°{cascade_id}", corps, actif="campagnes")

    def _page_fiche(self, rdv_id, parametres=None, erreurs=None,
                    cible_saisie=None, duree_saisie=None):
        base = self.application.base
        rdv = base.obtenir_rendezvous(rdv_id)
        if rdv is None:
            return None
        parametres = parametres or {}
        blocs = []
        for appel in base.appels_du_rendezvous(rdv_id):
            resultat = appel["resultat"]
            if resultat:
                etiquette = ETIQUETTES.get(resultat["appointment_status"],
                                           resultat["appointment_status"])
                bloc_resultat = (
                    f"<p>Issue : <strong>{html.escape(etiquette)}</strong></p>"
                    f"<pre>{html.escape(json.dumps(resultat, indent=2, ensure_ascii=False))}</pre>")
            else:
                bloc_resultat = "<p>Pas encore de résultat.</p>"
            # La NOTE dit ce que le produit a décidé face à ce résultat
            # (appel non composé, date convenue impossible) — jamais un
            # texte prêté à l'agent.
            if appel.get("note"):
                bloc_resultat = (
                    f'<div class="erreurs"><strong>⚠ Ce que RingBack a fait :'
                    f'</strong> {html.escape(appel["note"])}</div>'
                    + bloc_resultat)
            transcription = appel["transcription"] or "—"
            blocs.append(f"""<h2>Appel n°{appel['id']} — statut : {html.escape(appel['statut'])}</h2>
{bloc_resultat}
<h3>Transcription (simulée)</h3>
<pre>{html.escape(transcription)}</pre>""")
        if not blocs:
            blocs.append("<p>Aucun appel passé pour ce rendez-vous.</p>")
        rappel = ""
        if rdv["rappel_souhaite"]:
            rappel = f"<br>🔔 Rappel souhaité : {_date_lisible(rdv['rappel_souhaite'])}"
        pas = horaires.pas_minutes(self.application.preferences)
        bloc_erreurs = ""
        if erreurs:
            elements = "".join(f"<li>{html.escape(e)}</li>" for e in erreurs)
            bloc_erreurs = ('<div class="erreurs"><strong>Action refusée :'
                            f"</strong><ul>{elements}</ul></div>")
        messages = {
            "duree": "Durée enregistrée.",
            "deplace": "Rendez-vous déplacé — les tranches qu'il occupait "
                       "sont de nouveau libres.",
            "annule": "Rendez-vous annulé — ses tranches sont de nouveau "
                      "libres et proposables.",
            "enregistre": "Rendez-vous enregistré.",
        }
        bloc_message = ""
        for cle, texte in messages.items():
            if parametres.get(cle, [""])[0] == "ok":
                bloc_message = f'<p class="pastille st-confirme">{texte}</p>'
        corps = f"""<p><a href="/suivi">← Retour aux rendez-vous</a></p>
<h1>Rendez-vous n°{rdv['id']}</h1>
{bloc_message}
{bloc_erreurs}
<p>{self._pastille_statut(rdv['statut'])}{self._badge_stop(rdv)}</p>
<p>Contact : <strong>{html.escape(rdv['nom'])}</strong> — {html.escape(rdv['telephone_masque'])}<br>
Motif : {html.escape(rdv['motif'])}<br>
Horaire : {_date_lisible(rdv['horaire'])}<br>
Durée : {horaires.tranches_lisibles(rdv['duree_tranches'], pas)}{rappel}</p>
{self._bloc_origine(rdv['id'])}
{self._bloc_duree_et_deplacement(rdv, duree_saisie, cible_saisie)}
{"".join(blocs)}"""
        return self._page(f"Rendez-vous n°{rdv['id']}", corps, actif="suivi")

    def _bloc_duree_et_deplacement(self, rdv, duree_saisie=None,
                                   cible_saisie=None):
        """Durée, déplacement et annulation d'un rendez-vous.

        Le déplacement ne propose QUE des créneaux où ce rendez-vous tient
        (sa durée en tranches consécutives) ; s'il n'en existe aucun, le
        refus est écrit à l'écran, avec ce qui manque — rien n'est mimé.
        """
        base = self.application.base
        preferences = self.application.preferences
        pas = horaires.pas_minutes(preferences)
        tranches = rdv["duree_tranches"]
        # La valeur refusée n'est jamais perdue : elle revient DANS son champ.
        duree_affichee = (duree_saisie if duree_saisie is not None
                          else str(tranches * pas))
        if rdv["statut"] in ("annulé", "ignoré"):
            action_annuler = ("<p><small>Ce rendez-vous ne prend aucune "
                              "tranche : son statut l'a déjà libéré.</small></p>")
        else:
            action_annuler = f"""<form method="post" action="/rendezvous/annuler">
  <input type="hidden" name="rdv" value="{rdv['id']}">
  <button class="danger">Annuler ce rendez-vous — libérer
  {html.escape(horaires.tranches_lisibles(tranches, pas))}</button>
</form>"""
        creneaux = horaires.creneaux_pour_rendezvous(base, preferences, rdv,
                                                     limite=20)
        if creneaux:
            options = "".join(
                f'<option value="{html.escape(creneau)}"'
                f'{" selected" if creneau == cible_saisie else ""}>'
                f"{themes.date_lisible(creneau)}</option>"
                for creneau in creneaux)
            choix = f"""<label class="champ-option">Nouveau créneau — seuls
    ceux où {html.escape(horaires.tranches_lisibles(tranches, pas))} tiennent
    d'affilée sont proposés<br>
    <select class="select-option" name="cible">{options}</select></label>
  <button>Déplacer ce rendez-vous</button>"""
        else:
            choix = ("<p class=\"erreurs\">Déplacement impossible pour "
                     f"l'instant : ce rendez-vous occupe "
                     f"{html.escape(horaires.tranches_lisibles(tranches, pas))} "
                     "consécutives, et aucune suite de tranches libres aussi "
                     f"longue n'existe dans les {horaires.HORIZON_JOURS} "
                     "prochains jours. Ouvrez des heures ou libérez des "
                     'rendez-vous dans <a href="/reglages#horaires">⚙ Réglages'
                     "</a>.</p>")
        return f"""<h2>Durée, déplacement, annulation</h2>
<form method="post" action="/rendezvous/duree" class="carte">
  <input type="hidden" name="rdv" value="{rdv['id']}">
  <label>Durée du rendez-vous, en minutes — multiple de {pas}
    (la durée moyenne d'un rendez-vous), par exemple {pas} ou {2 * pas}<br>
    <input class="champ-court" type="number" name="duree" min="{pas}"
           step="{pas}" value="{html.escape(duree_affichee)}"></label>
  <button>Enregistrer la durée</button>
</form>
<form method="post" action="/rendezvous/deplacer" class="carte">
  <input type="hidden" name="rdv" value="{rdv['id']}">
  {choix}
</form>
{action_annuler}"""

    # --------------------------------------------------------------- plomberie
    def _page(self, titre, corps, actif=None, mode=None):
        """La page complète. `mode` = « simplifie » / « avance » quand
        l'écran a deux niveaux de détail (les formulaires de campagne) ; il
        est écrit sur <main> et c'est la feuille de style qui masque le
        reste. Les autres écrans ne le passent pas et ne changent pas."""
        return _gabarit(titre, corps, self.application.mode_reel, actif,
                        mode, self._langue())

    @staticmethod
    def _pastille_statut(statut):
        """La pastille colorée d'un statut de rendez-vous (bleu/orange/vert…)."""
        classe = CLASSES_STATUT.get(statut, "")
        return f'<span class="pastille {classe}">{html.escape(statut)}</span>'

    def _bloc_origine(self, rdv_id):
        """Le paragraphe « Obtenu par téléphone » d'une fiche, ou "" (jamais vide)."""
        lien = self._lien_campagne(rdv_id, suffixe="")
        if not lien:
            return ""
        return ("<p>📞 Obtenu par téléphone — demande faite par la campagne "
                f"{lien}</p>")

    def _ligne_origine(self, rdv_id):
        """La ligne « Vient de » d'une liste de définitions, ou "" (jamais vide)."""
        lien = self._lien_campagne(rdv_id, suffixe="")
        if not lien:
            return ""
        return f"<dt>Vient de</dt><dd>{lien}</dd>"

    def _lien_campagne(self, rdv_id, prefixe="", suffixe=" "):
        """Le lien vers LA campagne qui a produit ce rendez-vous, ou "".

        La demande du propriétaire : « on doit simplement renvoyer la
        demande de rendez-vous vers la campagne qui l'a faite ». Le lien
        sort du cahier de changements (db.campagne_du_rendezvous), qui relie
        déjà chaque changement à sa campagne et à son rendez-vous — aucune
        colonne n'a été ajoutée pour ça. Un rendez-vous saisi à la main n'a
        pas de campagne : il n'affiche RIEN, jamais un lien mort.
        """
        campagne = self.application.base.campagne_du_rendezvous(rdv_id)
        if not campagne:
            return ""
        return (f'{prefixe}<a href="/campagne?id={campagne["id"]}" '
                f'title="Ce rendez-vous vient de cette campagne d\'appels">'
                f'📣 {html.escape(campagne["nom"])}</a>{suffixe}')

    @staticmethod
    def _badge_stop(rdv_ou_client):
        """Le badge 🚫 d'un client marqué « Ne plus appeler » (sinon rien)."""
        if not rdv_ou_client.get("ne_plus_appeler"):
            return ""
        return (' <span class="badge-stop" title="Client marqué « Ne plus '
                'appeler » : exclu de la file, des cascades et des listes">'
                "🚫 ne plus appeler</span>")

    @staticmethod
    def _cellule_horaire(rdv):
        """L'horaire lisible + la date de rappel souhaitée si elle existe."""
        texte = _date_lisible(rdv["horaire"])
        if rdv.get("rappel_souhaite"):
            texte += ("<br><small>🔔 rappel souhaité : "
                      f"{_date_lisible(rdv['rappel_souhaite'])}</small>")
        return texte

    def _bandeau(self):
        if self.application.mode_reel:
            bandeau = ('<p class="bandeau reel">MODE RÉEL — chaque exécution passe de '
                       "VRAIS appels ; les numéros restent masqués à l'écran.</p>")
        else:
            bandeau = ('<p class="bandeau">Mode simulation — aucun appel réel '
                       "n'est émis.</p>")
        # ⚠ LE RENVOI D'ESSAI SE DIT SUR TOUTES LES PAGES, en mode réel. Sans
        # cela, on relirait une campagne entière en croyant avoir appelé de
        # vrais contacts — ou l'inverse. Il ne se dit qu'en mode réel parce
        # qu'en simulation aucun numéro n'est composé du tout : l'annoncer
        # ailleurs serait du bruit qui finirait par ne plus se lire.
        if self.application.mode_reel:
            renvoi = essai_reel.etat_du_renvoi(self.application.preferences)
            if renvoi["actif"]:
                bandeau += ('<p class="bandeau essai">🧪 <strong>TOUS LES '
                            "APPELS SONT RENVOYÉS</strong> vers votre numéro "
                            f"d'essai {html.escape(renvoi['masque'])} : "
                            "<strong>aucun contact ne sera appelé</strong>, "
                            "seule leur identité part à l'agent, inchangée. "
                            '<a href="/reglages#renvoi-essai">Le réglage</a></p>')
            elif renvoi["incoherent"]:
                bandeau += ('<p class="bandeau reel">⚠ <strong>AUCUN APPEL NE '
                            "PEUT PARTIR</strong> : « toujours utiliser mon "
                            "numéro » est coché, mais le numéro enregistré "
                            "n'est pas composable. RingBack refuse d'appeler "
                            "vos contacts à sa place. "
                            '<a href="/reglages#renvoi-essai">Corriger le '
                            "numéro</a></p>")
        # ⚠ LE BANDEAU « JEU D'ESSAI CHARGÉ » EST PARTI (21/08/2026, sa
        # demande). Il s'affichait sur TOUTES les pages, en tête, et prenait
        # deux lignes à chaque écran pour redire une chose qu'il sait déjà :
        # c'est LUI qui a chargé le jeu d'essai.
        #
        # ⚠ L'INFORMATION N'EST PAS PERDUE POUR AUTANT, et c'est ce qui rend
        # le retrait tenable : chaque client d'essai porte toujours son 🧪
        # partout où il apparaît (voir `essai_reel.badge`), et ⚙ Réglages
        # garde le bouton pour les retirer en bloc. Ce qui disparaît, c'est
        # la répétition — pas le fait.
        return bandeau

    def _libelle_rappel(self):
        return "Rappeler (RÉEL)" if self.application.mode_reel else "Rappeler (simulé)"

    def _langue(self):
        """La langue choisie pour l'interface. Français tant qu'on n'a rien dit.

        ⚠ ELLE NE PEUT PAS ÉCHOUER. Un réglage absent, vide ou abîmé rend le
        français : le pire acceptable est de revoir le produit dans sa langue
        d'origine, jamais un écran qui refuse de s'afficher.
        """
        try:
            choisie = self.application.preferences.obtenir(langue.CLE_LANGUE)
        except Exception:                                    # noqa: BLE001
            return langue.LANGUE_PAR_DEFAUT
        return langue.langue_valide(choisie)

    def _repondre(self, page, code=200):
        # ⚠ ICI, ET NULLE PART AILLEURS. Tout le HTML du produit sort par cette
        # ligne et par celle de `_repondre_cible` : c'est le point de passage
        # unique où la page finie devient des octets, donc le seul endroit où
        # une traduction ne peut oublier aucun écran. En français, `traduire`
        # rend l'objet reçu sans le lire — le produit d'origine ne traverse
        # donc STRICTEMENT rien.
        contenu = langue.traduire(page, self._langue()).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(contenu)))
        self.end_headers()
        self.wfile.write(contenu)

    def _repondre_fragment(self, morceau, code=200):
        """Répond un MORCEAU de page (sans habillage) : un élément se recharge
        sur place, la page entière n'est jamais rechargée."""
        return self._repondre(morceau, code)

    def _depuis_modale(self):
        """Vrai si la demande vient du mécanisme de modale (et non d'un envoi
        de formulaire ordinaire, qui attend une page entière en retour)."""
        return self.headers.get("X-RingBack-Fragment") == "1"

    def _repondre_cible(self, morceau, cible, code=200):
        """Répond un morceau EN DISANT quel élément doit le recevoir.

        « modale » = la modale se remet telle quelle (saisie refusée) ;
        tout autre nom = l'identifiant de l'élément à remplir à nouveau,
        et la modale se ferme. C'est ce qui permet de ne rafraîchir QUE
        l'élément concerné, jamais la page.

        ⚠ ELLE ENCODE ELLE-MÊME, DONC ELLE TRADUIT ELLE-MÊME. Cette méthode ne
        passe pas par `_repondre` (elle ajoute un en-tête de cible) : c'est la
        SECONDE et dernière porte de sortie du HTML. L'oublier laisserait les
        fenêtres et les éléments rechargés en français au milieu d'un écran
        anglais — le défaut le plus visible qu'on puisse livrer.
        """
        contenu = langue.traduire(morceau, self._langue()).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("X-RingBack-Cible", cible)
        self.send_header("Content-Length", str(len(contenu)))
        self.end_headers()
        self.wfile.write(contenu)

    def _erreur(self, code, message):
        self._repondre(self._page("Erreur", f"<h1>Erreur {code}</h1><p>{html.escape(message)}</p>"
                                            '<p><a href="/suivi">← Retour aux rendez-vous</a></p>'), code)

    def log_message(self, gabarit, *arguments):
        # Journal discret ; les pages ne contiennent que des numéros masqués.
        journal.debug("%s — " + gabarit, self.address_string(), *arguments)


class ServeurWeb(ThreadingHTTPServer):
    """Le serveur : UNE connexion = UN fil, et aucune ne bloque les autres.

    Pourquoi ce n'est pas le HTTPServer ordinaire : celui-là ne traite
    qu'une connexion à la fois. Or les navigateurs ouvrent des connexions
    « par anticipation » sur lesquelles ils ne demandent rien — le serveur
    restait planté à attendre une requête qui ne venait jamais, et TOUT le
    reste attendait avec lui (jusqu'à ce que le navigateur referme la
    connexion : deux minutes d'écran figé, mesurées).

    daemon_threads : un fil de connexion n'empêche jamais l'arrêt. Un
    Ctrl+C, ou la fermeture de la fenêtre, arrête le programme tout de
    suite au lieu d'attendre que les navigateurs referment leurs
    connexions dormantes.
    """

    daemon_threads = True
    # Conséquence de daemon_threads : server_close() n'attend pas les fils
    # en cours. C'est déjà la valeur déduite par la bibliothèque standard ;
    # elle est écrite ici pour que la lecture ne laisse pas de doute.
    block_on_close = False


def chemin_preferences(chemin_base):
    """Le fichier de réglages qui va avec cette base (None = en mémoire).

    ⚠ UN SEUL CALCUL, pour deux lecteurs : l'Application, et la console qui
    annonce le renvoi d'essai AVANT la confirmation tapée. Deux calculs qui
    divergeraient feraient annoncer un réglage qui n'est pas celui qui
    s'appliquera — le pire endroit pour une approximation.
    """
    if chemin_base == ":memory:":
        return None
    return os.path.join(os.path.dirname(os.path.abspath(chemin_base)),
                        "preferences.json")


def creer_serveur(port=PORT, chemin_base=None, appels_reels=False):
    """Construit le serveur ; base sur disque par défaut, démo si base vide.

    Le fichier donnees/ringback.db (et son dossier) est créé au premier
    lancement ; s'il contient déjà des données, la démonstration est ignorée.
    Les tests passent chemin_base=":memory:" pour rester sans trace.
    appels_reels=True ne doit être passé qu'après confirmation explicite de
    l'opérateur (voir principal()) ; sans clé CALLE_API_KEY, la construction
    échoue de toute façon (CleApiAbsente).
    """
    application = Application(chemin_base or CHEMIN_BASE, appels_reels=appels_reels)
    application.peupler_demo()

    class GestionnaireLie(Gestionnaire):
        pass

    GestionnaireLie.application = application
    return ServeurWeb(("127.0.0.1", port), GestionnaireLie)



# ⚠ LE 3ᵉ VERROU PARLE LES DEUX LANGUES, CÔTE À CÔTE (04/09/2026). Sa demande :
# « peu importe d'où tu viens, tu comprends ». La console tourne AVANT
# l'application — le réglage de langue n'est pas forcément lu, et un membre du
# jury qui n'a pas encore ouvert l'interface n'a rien réglé du tout. Afficher
# les deux ne dépend de rien.
#
# ⚠ ET LES DEUX MOTS SONT ACCEPTÉS, dans les deux langues : « APPELER » reste
# donc vrai partout où il est écrit — README publié, texte Devpost, proposition
# d'ajout. Aucun document ne devient faux, ce qui était le coût caché de toutes
# les autres solutions envisagées.
#
# ⚠ LA CASSE EST TOLÉRÉE, l'orthographe non. Refuser « call » en minuscules
# n'ajoute aucune sécurité : le geste délibéré, c'est d'écrire le mot ENTIER,
# pas de tenir la touche majuscule. Un refus sur la casse ferait seulement
# croire que le produit est cassé.
MOT_CONFIRMATION = "APPELER"
MOT_CONFIRMATION_EN = "CALL"
MOTS_CONFIRMATION = (MOT_CONFIRMATION, MOT_CONFIRMATION_EN)


def _confirmation_tapee():
    """Verrou 3 : l'opérateur tape « APPELER » à chaque lancement en mode réel.

    ⚠ LE RENVOI D'ESSAI EST ANNONCÉ ICI, AVANT LA QUESTION. C'est le moment
    où l'opérateur décide de laisser partir de vrais appels : s'ils vont tous
    être renvoyés vers son propre téléphone, il doit le savoir AVANT de taper,
    pas le découvrir après. Le réglage est relu dans le fichier (l'Application
    n'existe pas encore), par le MÊME calcul de chemin qu'elle — voir
    chemin_preferences.
    """
    print("ATTENTION : --appels-reels demandé. Les appels partiront VRAIMENT.")
    print("WARNING: --appels-reels requested. Calls will REALLY be placed.")
    etat = essai_reel.etat_du_renvoi(
        generation.Preferences(chemin_preferences(CHEMIN_BASE)))
    if etat["actif"]:
        print(f"🧪 RENVOI D'ESSAI ACTIF : tous les appels iront vers "
              f"{etat['masque']} (votre numéro d'essai). AUCUN contact ne sera "
              "appelé sur son propre numéro ; leur identité, elle, part "
              "inchangée.")
        print(f"🧪 TEST REDIRECT ACTIVE: every call will go to "
              f"{etat['masque']} (your test number). NO contact will be called "
              "on their own number; their identity is sent unchanged.")
    elif etat["incoherent"]:
        print("⚠ « Toujours utiliser mon numéro » est coché, mais le numéro "
              "enregistré n'est pas composable : AUCUN appel ne pourra "
              "partir. Corrigez-le dans ⚙ Réglages → 🧪 Essais → Jeu d'essai.")
        print("⚠ « Always use my number » is ticked, but the saved number "
              "cannot be dialled: NO call will be able to go out. Fix it in "
              "⚙ Settings → 🧪 Trial → Demo data.")
    try:
        reponse = input(
            f"Taper {MOT_CONFIRMATION} pour confirmer "
            f"(autre chose = simulation) / "
            f"Type {MOT_CONFIRMATION_EN} to confirm "
            f"(anything else = simulation) : ")
    except EOFError:  # lancement non interactif : refus par défaut
        reponse = ""
    return reponse.strip().upper() in MOTS_CONFIRMATION


def principal(arguments=None):
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s : %(message)s")
    analyseur = argparse.ArgumentParser(
        description="RingBack — serveur web (simulation par défaut).")
    analyseur.add_argument(
        "--appels-reels", action="store_true",
        help="Autoriser les appels RÉELS : exige la variable CALLE_API_KEY "
             "ET une confirmation tapée au clavier à chaque lancement.")
    options = analyseur.parse_args(arguments)
    appels_reels = bool(options.appels_reels and _confirmation_tapee())
    if options.appels_reels and not appels_reels:
        print("Confirmation refusée — lancement en mode simulation.")
    try:
        serveur_http = creer_serveur(appels_reels=appels_reels)
    except calle_client.CleApiAbsente as erreur:
        print(f"Refus : {erreur}")
        return
    mode = "MODE RÉEL" if appels_reels else "mode simulation"
    print(f"RingBack ({mode}) : http://127.0.0.1:{PORT} — Ctrl+C pour arrêter.")
    print(f"Base de données : {CHEMIN_BASE}")
    if appels_reels:
        print(f"Journal d'audit des appels réels : {calle_client.CHEMIN_AUDIT}")
    try:
        serveur_http.serve_forever()
    except KeyboardInterrupt:
        print("Arrêt demandé.")
    finally:
        serveur_http.server_close()


if __name__ == "__main__":
    principal()
