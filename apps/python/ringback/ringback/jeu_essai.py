"""Jeu d'essai — un cabinet de kinésithérapie plausible, entièrement fictif.

À quoi ça sert : essayer RingBack sur de l'information RÉALISTE (noms
français variés, motifs cohérents entre eux, rendez-vous passés ET à venir,
manqués, annulés, déplacés, deux contacts 🚫 « ne plus appeler », deux sans
numéro) plutôt que sur quatre lignes de démonstration.

Trois règles tenues ici :
1. Le chargement est un GESTE EXPLICITE (bouton « Charger un jeu d'essai »
   sur ⚙ Réglages, avec confirmation) — jamais automatique.
2. Il est ADDITIF et RÉVERSIBLE : chaque client créé porte le drapeau
   clients.jeu_essai = 1 ; « Retirer le jeu d'essai » ne supprime QUE
   ceux-là (et leurs rendez-vous). Les données de l'utilisateur ne sont
   jamais touchées.
3. C'est dit à l'écran : tant qu'un jeu d'essai est chargé, le bandeau de
   chaque page l'annonce et la page Clients marque chaque ligne 🧪.

--------------------------------------------------------------------------
LES NUMÉROS : RÉALISTES DE FORME, INCAPABLES DE SONNER CHEZ QUELQU'UN
--------------------------------------------------------------------------
Tous les numéros du jeu d'essai sont pris dans les SIX RACINES que l'Arcep
réserve aux œuvres audiovisuelles (les « numéros de fiction » du cinéma et
de la télévision), soit six blocs de 10 000 numéros :

    01 99 00 xx xx   02 61 91 xx xx   03 53 01 xx xx
    04 65 71 xx xx   05 36 49 xx xx   06 39 98 xx xx

Ces numéros ne sont attribués à personne et, par construction, « ne
pourront ni appeler ou être utilisés comme identifiant d'appelant, ni être
appelés » : composer l'un d'eux ne peut donc PAS sonner chez un inconnu.
C'est exactement la garantie recherchée pour un jeu d'essai.

Sources :
- Arcep, décision n° 2018-0881 du 24 juillet 2018 établissant le plan
  national de numérotation et ses règles de gestion, article 2.5.12
  « Numéros pour œuvres audiovisuelles » —
  https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000037262971
- Arcep, consultation publique sur le plan de numérotation (décembre 2021),
  « Allocation de blocs de numéros pouvant être utilisés dans des œuvres
  audiovisuelles » : six blocs de 10 000 numéros, qui « ne pourront ni
  appeler ou être utilisés comme identifiant d'appelant, ni être appelés » —
  https://www.arcep.fr/uploads/tx_gspublication/consultation-plan-numerotation-regles-gestion_dec2021.pdf
- Liste des six racines reprise et vérifiée sur
  https://www.hteumeuleu.fr/numeros-pour-oeuvres-audiovisuelles/

Terminaisons 51 à 56 : le simulateur d'appels (calle_client) force une
issue déterministe selon les deux derniers chiffres (51 accepte, 52 refuse,
53 ne décroche pas, 54 propose une autre date, 55 demande à être rappelé
par un humain, 56 ne décroche qu'au premier appel). Une poignée de contacts
du jeu d'essai porte donc ces terminaisons : elles sont le moyen d'EXIGER une
issue précise, dans une démonstration ou dans un contrôle.

Et elles y sont pour CHAQUE SOURCE de campagne, pas seulement pour les
manqués : rendez-vous à venir, manqués, annulés et « déplacés en attente »
comportent chacun les six terminaisons. Sans cela, une campagne bâtie sur
les annulés ou sur les déplacés ne rencontrait jamais que des tirages au
hasard, et trois des huit natures de campagne n'étaient jamais éprouvées de
bout en bout (voir banc_essai.py, qui parcourt cette matrice).

⚠ CE N'EST PLUS LE SEUL MOYEN DE VOIR TOUS LES CAS DE FIGURE (11/08/2026).
Une campagne simulée déroule d'elle-même la liste des cas propres à sa nature
— refus, report, injoignable, 🚫 « ne me rappelez plus », 🔇 « ne me proposez
plus de place », et l'issue qui aboutit en dernier. Voir
calle_client.SUITES_PAR_NATURE.

Trois terminaisons existent SANS être portées par un contact d'essai, à
dessein : 57 (refuse + 🚫), 58 (refuse + 🔇) et 59 (réponse illisible)
laissent une trace durable ou mettent la campagne en pause. Les poser sur un
contact du jeu d'essai aurait changé le comportement de toutes les campagnes
d'essai qui le croisent — et le banc, qui parcourt 115 combinaisons, n'aurait
plus rendu deux fois le même rapport. Elles s'obtiennent en tapant un numéro
qui finit par 57, 58 ou 59.
"""

import datetime
import logging
import os

from . import saisie

journal = logging.getLogger("ringback.jeu_essai")

# Les six racines réservées à la fiction (voir l'en-tête pour la source).
RACINES_FICTION = ("0199 00", "0261 91", "0353 01", "0465 71", "0536 49",
                   "0639 98")

NOM_METIER = "Cabinet de kinésithérapie"
CHEMIN_AGENDA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "exemple_agenda_realiste.ics")

# --------------------------------------------------------------------------
# Les clients : (nom, téléphone, ne plus appeler)
# Volontairement variés — civilités, particules, noms composés, accents, un
# nom très long, deux homonymes, deux sans numéro, deux 🚫.
# --------------------------------------------------------------------------
CLIENTS = (
    ("Mme Nadia Lefèvre", "06 39 98 00 51", False),
    ("M. Karim Ben Amar", "06 39 98 00 52", False),
    ("Mme Élise Charpentier", "06 39 98 00 53", False),
    ("M. Paul Guillot", "06 39 98 00 54", False),
    ("Mme Anaïs Rousseau-Vidal", "06 39 98 00 55", False),
    ("M. Hervé Dombasle", "06 39 98 00 56", False),
    ("Mme Marie-Christine de La Tour du Pin", "06 39 98 01 12", False),
    ("M. Jean-Baptiste d'Aubigné", "06 39 98 01 13", False),
    ("Mme Gaëlle Le Goff", "06 39 98 01 14", False),
    ("M. Loïc Kerhervé", "06 39 98 01 15", False),
    ("Mme Noémie Fauconnier", "06 39 98 01 16", False),
    ("M. Étienne Delacroix-Marchand", "06 39 98 01 17", False),
    ("Mme Fatima Zahra El Amrani", "06 39 98 01 18", False),
    ("M. Sébastien Nguyen", "06 39 98 01 19", False),
    ("Mme Camille Aubert", "06 39 98 01 20", False),
    # Homonymes : deux personnes distinctes portant EXACTEMENT le même nom.
    ("M. Jean Martin", "06 39 98 01 21", False),
    ("M. Jean Martin", "06 39 98 01 22", False),
    ("Mme Solange Dupuis-Ferrand", "06 39 98 01 23", False),
    ("M. Abdel Haddad", "06 39 98 01 24", False),
    ("Mme Béatrice Vandenberghe", "06 39 98 01 25", False),
    # Fixes : un cabinet a aussi des patients âgés qui ne donnent qu'un fixe.
    ("Mme Yvonne Lecomte", "01 99 00 02 31", False),
    ("M. Raymond Bouchard", "01 99 00 02 32", False),
    ("Mme Geneviève Marceau", "04 65 71 03 41", False),
    ("M. Gilbert Perrin", "05 36 49 04 51", False),
    ("Mme Chantal Renaudin", "03 53 01 05 52", False),
    ("M. Théo Sanchez", "02 61 91 06 53", False),
    # 🚫 Ne plus appeler : deux personnes qui l'ont demandé.
    ("Mme Sophie Mercier", "06 39 98 01 26", True),
    ("M. Bruno Lacombe", "06 39 98 01 27", True),
    # Sans numéro : importés d'un agenda, à compléter.
    ("Mme Zoé Berthier", "", False),
    ("M. Antoine Villeneuve", "", False),
    # --- Six patients « déplacés en attente », terminaisons 51 à 56 ---------
    # Pourquoi eux : la source « Déplacés en attente » ne retient QUE les
    # clients qui n'ont plus aucun rendez-vous à venir (voir
    # db.candidats_cascade). Les six porteurs de terminaison ci-dessus ont,
    # eux, des rendez-vous futurs : ils ne peuvent donc pas servir cette
    # source. Ces six-là lui sont réservés, pour qu'une campagne bâtie sur
    # « Déplacés en attente » rencontre elle aussi les six issues du
    # simulateur (51 à 56) au lieu de trois tirages au hasard.
    ("Mme Aurélie Pastor", "02 61 91 07 51", False),
    ("M. Damien Rouvière", "02 61 91 07 52", False),
    ("Mme Leïla Bencheikh", "02 61 91 07 53", False),
    ("M. Olivier Tanguy", "02 61 91 07 54", False),
    ("Mme Hélène Sabatier", "02 61 91 07 55", False),
    ("M. Frédéric Aumont", "02 61 91 07 56", False),
    # --- Douze patients EN COURS DE TRAITEMENT sur les trois prochains mois --
    # ⚠ POURQUOI DOUZE DE PLUS (11/08/2026). Demande du propriétaire : « puisqu'
    # on a du 90 jours on devrait avoir des exemples sur 100 jours ». Mesuré
    # avant : le rendez-vous à venir le plus lointain du jeu d'essai était à
    # +9 JOURS. Conséquences, mesurées elles aussi :
    #   · une place libérée au-delà de +9 jours ne trouvait PERSONNE sur les
    #     sources « rendez-vous à venir » et « rendez-vous posés » ;
    #   · les options « jusqu'à 30 jours après » et « jusqu'à 90 jours après »
    #     de la règle de liste ne pouvaient rien donner de différent de
    #     « sans limite » — deux réglages sur quatre sans matière pour les
    #     éprouver.
    # Ces douze-là ont chacun DEUX séances espacées, et quatre rendez-vous du
    # lot passent la barre des 90 jours : sans eux, « jusqu'à 90 jours » et
    # « sans limite » resteraient identiques.
    ("Mme Laurence Thibault", "06 39 98 01 28", False),
    ("M. Serge Pouliquen", "06 39 98 01 29", False),
    ("Mme Nawel Boukhari", "06 39 98 01 30", False),
    ("M. Grégoire Vasseur", "06 39 98 01 31", False),
    ("Mme Émilie Sanchez-Roy", "06 39 98 01 32", False),
    ("M. Lucien Chartier", "06 39 98 01 33", False),
    ("Mme Dominique Lherbier", "06 39 98 01 34", False),
    ("M. Ousmane Traoré", "06 39 98 01 35", False),
    ("Mme Véronique Amiot", "06 39 98 01 36", False),
    ("M. Patrick Ferreira", "06 39 98 01 37", False),
    ("Mme Roselyne Gauthier", "06 39 98 01 38", False),
    ("M. Anselme Kouassi", "06 39 98 01 39", False),
    # --- Deux patients dont le SEUL rendez-vous est au-delà de 90 jours -------
    # ⚠ ILS NE SONT PAS UN DOUBLON DES QUATRE RENDEZ-VOUS LOINTAINS CI-DESSUS,
    # et c'est une correction née d'une mesure. Ces quatre-là appartiennent à des
    # patients qui ont AUSSI une séance plus proche ; or la liste ne retient
    # qu'un rendez-vous par personne, le premier. « Jusqu'à 90 jours après »
    # rendait donc encore exactement la même liste que « sans limite ». Il faut
    # des gens dont le seul rendez-vous soit hors de la fenêtre pour que la
    # fenêtre se voie.
    ("Mme Christiane Lemarié", "06 39 98 01 40", False),
    ("M. Aurélien Pichot", "06 39 98 01 41", False),
    # --- Vingt-cinq patients, UNE séance chacun, répartis sur trois mois ------
    # ⚠ CE QUI MANQUAIT ENCORE (11/08/2026), et c'est une leçon sur les jeux de
    # données. Le renfort précédent avait ajouté des RENDEZ-VOUS au loin, mais
    # peu de PERSONNES : douze patients y tenaient deux ou trois séances chacun.
    # Le propriétaire l'a vu tout de suite — « il y a 100 jours de test et j'ai
    # du mal à me dire qu'il n'y a que 16 personnes qui gagnent au moins
    # 30 jours ». Compté à la main : 27 rendez-vous au-delà du seuil, mais
    # 18 personnes distinctes seulement. Le filtre avait raison ; le jeu
    # d'essai, lui, était mince.
    #
    # ⚠ UNE SEULE SÉANCE CHACUN, ET C'EST TOUT L'INTÉRÊT : une campagne ne
    # retient qu'UNE personne par client, quel que soit son nombre de
    # rendez-vous. Pour qu'une liste soit fournie, il faut des GENS, pas des
    # lignes d'agenda.
    #
    # ⚠ AUCUNE TERMINAISON ENTRE 51 ET 59 : cette plage est réservée aux issues
    # forcées du simulateur (voir l'entête). D'où le saut de 01 50 à 01 60.
    ("Mme Corinne Vasseur", "06 39 98 01 42", False),
    ("M. Alain Bouvier", "06 39 98 01 43", False),
    ("Mme Sandrine Leclerc", "06 39 98 01 44", False),
    ("M. Marc Deschamps", "06 39 98 01 45", False),
    ("Mme Hélène Prévost", "06 39 98 01 46", False),
    ("M. Julien Barbier", "06 39 98 01 47", False),
    ("Mme Amina Cherif", "06 39 98 01 48", False),
    ("M. Pascal Guérin", "06 39 98 01 49", False),
    ("Mme Monique Delattre", "06 39 98 01 50", False),
    ("M. Xavier Morvan", "06 39 98 01 60", False),
    ("Mme Nathalie Ferrand", "06 39 98 01 61", False),
    ("M. Éric Vandamme", "06 39 98 01 62", False),
    ("Mme Sylviane Roche", "06 39 98 01 63", False),
    ("M. Bertrand Nicolas", "06 39 98 01 64", False),
    ("Mme Karine Lemoine", "06 39 98 01 65", False),
    ("M. Samir Belhadj", "06 39 98 01 66", False),
    ("Mme Josette Aubertin", "06 39 98 01 67", False),
    ("M. Didier Fontaine", "06 39 98 01 68", False),
    ("Mme Lucie Bonnet", "06 39 98 01 69", False),
    ("M. Michel Charrier", "06 39 98 01 70", False),
    ("Mme Brigitte Salmon", "06 39 98 01 71", False),
    ("M. Olivier Reynaud", "06 39 98 01 72", False),
    ("Mme Estelle Munoz", "06 39 98 01 73", False),
    ("M. Fabrice Lelièvre", "06 39 98 01 74", False),
    ("Mme Danielle Ollivier", "06 39 98 01 75", False),
)

# --------------------------------------------------------------------------
# LES QUATRE CONTACTS D'AMORÇAGE : (nom, téléphone, jours, heure, minute, motif)
# Ce que RingBack pose TOUT SEUL dans une base vide, pour qu'un premier écran
# ne soit pas désert. Le serveur les crée (voir Application.peupler_demo) ;
# ils ne sont PAS marqués 🧪, et ce sont des rendez-vous manqués — de quoi
# essayer un rappel dès la première minute.
#
# ⚠ TROIS DE CES QUATRE NOMS EXISTENT AUSSI DANS `CLIENTS`, SOUS UN AUTRE
# NUMÉRO (constaté le 13/08/2026). L'histoire des deux listes explique tout :
# elles ont été écrites à des mois d'intervalle, et la même personne y a reçu
# deux numéros. Conséquence mesurée : charger le jeu d'essai sur une base
# fraîche crée une SECONDE « Mme Nadia Lefèvre ».
#
# On ne renomme personne et on ne récrit aucun numéro — des bases existantes
# portent déjà ces fiches, et les récrire irait contre la règle « on n'écrase
# jamais ce qui est enregistré ». La liste est ici, à côté de l'autre, pour
# que le voisinage soit VISIBLE : `agenda_exemple` s'en sert pour ne jamais
# annoncer un de ces noms avec le numéro de son homonyme.
PREMIERS_CONTACTS = (
    ("Mme Nadia Lefèvre", "+33 6 00 00 00 41", 1, 10, 0,
     "Séance de kinésithérapie"),
    ("M. Karim Osman", "+33 6 00 00 00 42", 1, 14, 30, "Coupe et barbe"),
    ("Mme Élise Charpentier", "+33 6 00 00 00 43", 2, 9, 15,
     "Bilan nutrition"),
    ("M. Paul Guillot", "+33 6 00 00 00 44", 2, 16, 0, "Cours de guitare"),
)

# --------------------------------------------------------------------------
# Les rendez-vous : (client, jours depuis aujourd'hui, heure, minute, motif,
#                    statut, jours de rappel souhaité ou None, durée)
# Un décalage NÉGATIF est dans le passé, POSITIF dans le futur.
# Statuts : prévu | manqué | confirmé | déplacé | annulé.
# La DURÉE est un nombre de TRANCHES (voir horaires.py) : 1 = la durée
# moyenne d'un rendez-vous (15 minutes par défaut), 2 = une demi-heure,
# 4 = une heure. Un cabinet réel mélange les durées : le jeu d'essai aussi,
# sinon la règle « on ne replace pas un client là où il ne tient pas » ne
# rencontrerait jamais de cas concret.
# --------------------------------------------------------------------------
RENDEZVOUS = (
    # --- passé : manqués (le cœur du produit, « je rappelle les manqués »)
    ("Mme Nadia Lefèvre", -9, 10, 0,
     "Rééducation du genou — séance 4/10", "manqué", None, 2),
    ("M. Karim Ben Amar", -8, 14, 30,
     "Rééducation de l'épaule après luxation", "manqué", None),
    ("Mme Élise Charpentier", -7, 9, 15,
     "Kinésithérapie respiratoire", "manqué", None),
    ("M. Paul Guillot", -6, 16, 0,
     "Lombalgie chronique — séance d'entretien", "manqué", None),
    ("Mme Anaïs Rousseau-Vidal", -5, 11, 30,
     "Rééducation post-entorse de la cheville", "manqué", 2),
    ("M. Hervé Dombasle", -4, 8, 45,
     "Drainage lymphatique du bras droit", "manqué", None),
    ("Mme Marie-Christine de La Tour du Pin", -3, 15, 15,
     "Rééducation de la hanche après prothèse", "manqué", None),
    ("M. Jean Martin", -3, 17, 0,
     "Massage décontracturant du dos", "manqué", None),
    # --- passé : honorés / confirmés
    ("Mme Gaëlle Le Goff", -14, 9, 0,
     "Bilan de posture initial", "confirmé", None),
    ("M. Loïc Kerhervé", -12, 10, 30,
     "Rééducation du poignet après fracture", "confirmé", None),
    ("Mme Noémie Fauconnier", -11, 14, 0,
     "Rééducation périnéale — séance 2/8", "confirmé", None),
    ("M. Étienne Delacroix-Marchand", -10, 18, 0,
     "Kinésithérapie du sport — reprise de course", "confirmé", None),
    ("Mme Yvonne Lecomte", -21, 9, 30,
     "Rééducation de l'équilibre (prévention des chutes)", "confirmé", None),
    # --- passé : annulés (source « annulés » des campagnes)
    ("M. Sébastien Nguyen", -6, 13, 30,
     "Rééducation cervicale après coup du lapin", "annulé", None),
    ("Mme Camille Aubert", -4, 11, 0,
     "Séance de kinésithérapie du dos", "annulé", None),
    ("M. Raymond Bouchard", -2, 15, 45,
     "Rééducation respiratoire (BPCO)", "annulé", None),
    # --- passé : déplacés SANS nouvelle date (source « déplacés en attente »)
    ("Mme Fatima Zahra El Amrani", -5, 16, 30,
     "Rééducation de l'épaule — séance 3/12", "déplacé", None),
    ("M. Abdel Haddad", -2, 8, 30,
     "Kinésithérapie maxillo-faciale", "déplacé", 1),
    ("Mme Béatrice Vandenberghe", -1, 12, 0,
     "Rééducation vestibulaire (vertiges)", "déplacé", None),
    # --- à venir : la semaine qui arrive (source « rendez-vous à venir »)
    ("Mme Solange Dupuis-Ferrand", 1, 9, 0,
     "Rééducation du genou — séance 6/10", "prévu", None, 2),
    ("M. Jean Martin", 1, 10, 30,
     "Lombalgie aiguë — première séance", "prévu", None),
    ("Mme Gaëlle Le Goff", 2, 14, 0,
     "Bilan de posture — contrôle", "prévu", None),
    ("M. Loïc Kerhervé", 2, 15, 30,
     "Rééducation du poignet — séance 5/15", "prévu", None, 2),
    ("Mme Noémie Fauconnier", 3, 11, 0,
     "Rééducation périnéale — séance 3/8", "prévu", None),
    ("M. Théo Sanchez", 3, 17, 30,
     "Kinésithérapie du sport — renforcement", "prévu", None),
    ("Mme Geneviève Marceau", 4, 10, 0,
     "Rééducation de la marche après AVC", "prévu", None, 2),
    ("M. Gilbert Perrin", 4, 16, 15,
     "Massage décontracturant des trapèzes", "prévu", None),
    ("Mme Chantal Renaudin", 6, 9, 45,
     "Rééducation de l'épaule — bilan de fin", "prévu", None),
    ("M. Étienne Delacroix-Marchand", 7, 18, 30,
     "Kinésithérapie du sport — test d'appui", "prévu", None, 2),
    ("Mme Camille Aubert", 9, 13, 0,
     "Séance de kinésithérapie du dos (reprise)", "prévu", None),
    # --- à venir : les deux contacts 🚫 en ont aussi (ils doivent être écartés)
    ("Mme Sophie Mercier", 5, 14, 30,
     "Rééducation du genou — séance 2/10", "prévu", None),
    ("M. Bruno Lacombe", -7, 9, 30,
     "Rééducation cervicale", "manqué", None),
    # --- les deux sans numéro : venus d'un agenda, à compléter
    ("Mme Zoé Berthier", 2, 8, 30,
     "Première consultation — bilan complet", "prévu", None, 4),
    ("M. Antoine Villeneuve", -1, 17, 45,
     "Rééducation du dos — séance 1/6", "manqué", None),
    # --------------------------------------------------------------------
    # DE LA MATIÈRE POUR CHAQUE SOURCE DE CAMPAGNE
    # --------------------------------------------------------------------
    # Les six terminaisons 51 à 56 n'étaient présentes que parmi les
    # MANQUÉS : une campagne bâtie sur « Rendez-vous annulés », sur
    # « Déplacés en attente » ou sur « Rendez-vous à venir » ne rencontrait
    # donc jamais les six issues du simulateur. Les lignes ci-dessous
    # comblent ce manque — mêmes patients, mêmes numéros de fiction, un
    # rendez-vous de plus dans le statut qui manquait.
    #
    # --- annulés : les six terminaisons (source « Rendez-vous annulés »)
    ("Mme Nadia Lefèvre", -16, 11, 0,
     "Rééducation du genou — séance 3/10", "annulé", None, 2),
    ("M. Karim Ben Amar", -15, 15, 0,
     "Rééducation de l'épaule — bilan intermédiaire", "annulé", None),
    ("Mme Élise Charpentier", -15, 8, 30,
     "Kinésithérapie respiratoire — séance 2/6", "annulé", None),
    ("M. Paul Guillot", -13, 17, 0,
     "Lombalgie chronique — séance reportée", "annulé", None),
    ("Mme Anaïs Rousseau-Vidal", -13, 9, 45,
     "Rééducation de la cheville — séance 2/8", "annulé", None),
    ("M. Hervé Dombasle", -12, 14, 15,
     "Drainage lymphatique — séance 4/10", "annulé", None),
    # --- déplacés SANS nouvelle date : les six terminaisons
    #     (source « Déplacés en attente » — ces six patients n'ont AUCUN
    #      rendez-vous à venir, sinon la source les écarterait)
    ("Mme Aurélie Pastor", -8, 10, 15,
     "Rééducation du dos — séance 2/10", "déplacé", None, 2),
    ("M. Damien Rouvière", -7, 14, 45,
     "Rééducation du genou — séance 5/12", "déplacé", None),
    ("Mme Leïla Bencheikh", -6, 9, 0,
     "Kinésithérapie respiratoire — séance 3/6", "déplacé", None),
    ("M. Olivier Tanguy", -5, 16, 45,
     "Rééducation de l'épaule — séance 7/12", "déplacé", 1),
    ("Mme Hélène Sabatier", -4, 11, 15,
     "Rééducation vestibulaire — séance 2/6", "déplacé", None),
    ("M. Frédéric Aumont", -3, 8, 15,
     "Rééducation du poignet — séance 4/8", "déplacé", None),
    # --- à venir : les terminaisons 54, 55 et 56 manquaient
    #     (51, 52 et 53 y sont déjà : MM. Perrin, Mmes Renaudin, M. Sanchez)
    ("M. Paul Guillot", 5, 11, 45,
     "Lombalgie chronique — nouvelle séance", "prévu", None),
    ("Mme Anaïs Rousseau-Vidal", 6, 15, 0,
     "Rééducation de la cheville — reprise", "prévu", None),
    ("M. Hervé Dombasle", 8, 10, 45,
     "Drainage lymphatique — séance 5/10", "prévu", None),
    # --------------------------------------------------------------------
    # LES TROIS PROCHAINS MOIS (11/08/2026)
    # --------------------------------------------------------------------
    # Voir le pavé des douze nouveaux patients, plus haut : sans ces lignes,
    # rien n'existait au-delà de +9 jours, et la moitié des fenêtres de la
    # règle de liste était impossible à éprouver.
    #
    # ⚠ AUCUN DES SIX « DÉPLACÉS EN ATTENTE » N'EN REÇOIT (les 02 61 91 07 5x,
    # plus Mmes El Amrani et Vandenberghe et M. Haddad). Leur source ne retient
    # que les clients SANS aucun rendez-vous à venir : leur en donner un les en
    # ferait sortir, et une nature de campagne entière n'aurait plus de matière.
    #
    # --- les terminaisons forcées portent aussi loin : une campagne montée sur
    #     une place dans trois semaines doit pouvoir exiger son issue
    ("Mme Nadia Lefèvre", 12, 10, 30,
     "Rééducation du genou — séance 5/10", "prévu", None, 2),
    ("M. Karim Ben Amar", 16, 15, 15,
     "Rééducation de l'épaule — séance 6/12", "prévu", None),
    ("Mme Élise Charpentier", 19, 8, 45,
     "Kinésithérapie respiratoire — séance 4/6", "prévu", None),
    # --- de la matière entre trois semaines et deux mois
    ("Mme Marie-Christine de La Tour du Pin", 23, 11, 15,
     "Rééducation de la hanche — séance 8/15", "confirmé", None, 2),
    ("M. Jean-Baptiste d'Aubigné", 26, 16, 30,
     "Bilan de posture — contrôle", "prévu", None),
    ("M. Sébastien Nguyen", 31, 14, 0,
     "Rééducation cervicale — reprise", "prévu", None),
    ("Mme Yvonne Lecomte", 35, 9, 30,
     "Prévention des chutes — séance 3/10", "prévu", None, 2),
    ("M. Raymond Bouchard", 40, 10, 45,
     "Kinésithérapie respiratoire — suivi", "prévu", None),
    # --- deux cas particuliers, AU LOIN eux aussi : le 🚫 doit être écarté même
    #     à trois mois, et le « sans numéro » doit rester à compléter
    ("M. Bruno Lacombe", 44, 15, 45,
     "Rééducation cervicale — séance 3/8", "prévu", None),
    ("M. Antoine Villeneuve", 48, 17, 15,
     "Rééducation du dos — séance 2/6", "prévu", None),
    # --- les douze traitements en cours : deux séances espacées chacun
    ("Mme Laurence Thibault", 13, 9, 15,
     "Rééducation du genou — séance 2/12", "prévu", None),
    ("Mme Laurence Thibault", 52, 9, 15,
     "Rééducation du genou — séance 8/12", "prévu", None),
    ("M. Serge Pouliquen", 18, 14, 30,
     "Lombalgie chronique — séance 3/10", "prévu", None, 2),
    ("M. Serge Pouliquen", 56, 14, 30,
     "Lombalgie chronique — séance 9/10", "prévu", None),
    ("Mme Nawel Boukhari", 21, 10, 0,
     "Rééducation post-fracture — séance 4/15", "confirmé", None),
    ("Mme Nawel Boukhari", 60, 10, 0,
     "Rééducation post-fracture — séance 12/15", "prévu", None),
    ("M. Grégoire Vasseur", 28, 16, 0,
     "Rééducation de l'épaule — séance 5/12", "prévu", None),
    ("M. Grégoire Vasseur", 63, 16, 0,
     "Rééducation de l'épaule — bilan de fin", "prévu", None),
    ("Mme Émilie Sanchez-Roy", 33, 8, 30,
     "Kinésithérapie du sport — reprise de course", "prévu", None, 2),
    ("Mme Émilie Sanchez-Roy", 67, 8, 30,
     "Kinésithérapie du sport — test d'effort", "prévu", None),
    ("M. Lucien Chartier", 38, 11, 30,
     "Rééducation de la marche — séance 6/20", "prévu", None),
    ("M. Lucien Chartier", 71, 11, 30,
     "Rééducation de la marche — séance 14/20", "prévu", None),
    ("Mme Dominique Lherbier", 42, 15, 30,
     "Drainage lymphatique — séance 7/15", "prévu", None),
    ("Mme Dominique Lherbier", 75, 15, 30,
     "Drainage lymphatique — séance 13/15", "confirmé", None),
    ("M. Ousmane Traoré", 46, 9, 0,
     "Rééducation du poignet — séance 3/8", "prévu", None),
    ("M. Ousmane Traoré", 79, 9, 0,
     "Rééducation du poignet — bilan de fin", "prévu", None),
    ("Mme Véronique Amiot", 50, 17, 0,
     "Rééducation périnéale — séance 4/8", "prévu", None),
    ("Mme Véronique Amiot", 83, 17, 0,
     "Rééducation périnéale — séance 8/8", "prévu", None),
    ("M. Patrick Ferreira", 54, 13, 30,
     "Suivi post-opératoire du genou", "prévu", None, 2),
    ("M. Patrick Ferreira", 87, 13, 30,
     "Suivi post-opératoire — contrôle", "prévu", None),
    ("Mme Roselyne Gauthier", 58, 10, 15,
     "Rééducation vestibulaire — séance 3/6", "prévu", None),
    ("M. Anselme Kouassi", 65, 16, 45,
     "Massage thérapeutique — séance 2/6", "prévu", None),
    # --- ⚠ AU-DELÀ DE 90 JOURS, ET C'EST LEUR SEULE RAISON D'ÊTRE : sans eux,
    #     « jusqu'à 90 jours après » rendrait exactement la même liste que
    #     « sans limite », et le réglage serait indémontrable.
    ("Mme Roselyne Gauthier", 91, 10, 15,
     "Rééducation vestibulaire — bilan de fin", "prévu", None),
    ("M. Anselme Kouassi", 95, 16, 45,
     "Contrôle annuel", "prévu", None),
    ("Mme Laurence Thibault", 99, 9, 45,
     "Contrôle à trois mois", "prévu", None),
    ("M. Serge Pouliquen", 100, 15, 0,
     "Contrôle à trois mois", "prévu", None),
    # --- Et les deux qui n'ont QUE cela : eux seuls font que « jusqu'à 90 jours
    #     après » rend une liste différente de « sans limite » (voir leur pavé
    #     dans CLIENTS).
    ("Mme Christiane Lemarié", 94, 11, 0,
     "Première consultation — bilan complet", "prévu", None, 4),
    ("M. Aurélien Pichot", 97, 14, 15,
     "Bilan de posture initial", "prévu", None, 2),
    # --------------------------------------------------------------------
    # VINGT-CINQ PERSONNES DE PLUS, UNE SÉANCE CHACUNE (11/08/2026)
    # --------------------------------------------------------------------
    # Voir leur pavé dans CLIENTS : ce qui manquait n'était pas des rendez-vous
    # mais des PERSONNES. Réparties de +11 à +99 jours, une par ligne, pour
    # qu'une place libérée trouve du monde à toutes les distances.
    #
    # Quelques-unes sont « confirmé » : la source « à venir, pas encore
    # confirmés » doit pouvoir en écarter, sinon elle ne se distingue jamais de
    # « rendez-vous posés ».
    ("Mme Corinne Vasseur", 11, 9, 0,
     "Rééducation du genou — séance 3/10", "prévu", None),
    ("M. Alain Bouvier", 15, 10, 30,
     "Lombalgie — séance 2/8", "prévu", None, 2),
    ("Mme Sandrine Leclerc", 18, 14, 0,
     "Rééducation de l'épaule — séance 4/12", "confirmé", None),
    ("M. Marc Deschamps", 22, 16, 15,
     "Kinésithérapie respiratoire — séance 3/6", "prévu", None),
    ("Mme Hélène Prévost", 25, 8, 45,
     "Rééducation périnéale — séance 2/8", "prévu", None),
    ("M. Julien Barbier", 29, 11, 15,
     "Kinésithérapie du sport — reprise", "prévu", None, 2),
    ("Mme Amina Cherif", 32, 15, 45,
     "Drainage lymphatique — séance 5/15", "prévu", None),
    ("M. Pascal Guérin", 36, 9, 30,
     "Rééducation du poignet — séance 2/8", "confirmé", None),
    ("Mme Monique Delattre", 39, 17, 0,
     "Prévention des chutes — séance 4/10", "prévu", None),
    ("M. Xavier Morvan", 43, 10, 0,
     "Suivi post-opératoire de la hanche", "prévu", None, 2),
    ("Mme Nathalie Ferrand", 47, 13, 30,
     "Rééducation cervicale — séance 3/8", "prévu", None),
    ("M. Éric Vandamme", 51, 16, 30,
     "Massage décontracturant du dos", "prévu", None),
    ("Mme Sylviane Roche", 55, 8, 30,
     "Rééducation vestibulaire — séance 2/6", "prévu", None),
    ("M. Bertrand Nicolas", 59, 11, 45,
     "Rééducation de la marche — séance 5/20", "confirmé", None),
    ("Mme Karine Lemoine", 62, 15, 0,
     "Bilan de posture — contrôle annuel", "prévu", None),
    ("M. Samir Belhadj", 66, 9, 45,
     "Rééducation du genou — séance 6/10", "prévu", None, 2),
    ("Mme Josette Aubertin", 70, 14, 30,
     "Kinésithérapie respiratoire — suivi", "prévu", None),
    ("M. Didier Fontaine", 73, 17, 15,
     "Lombalgie chronique — entretien", "prévu", None),
    ("Mme Lucie Bonnet", 77, 10, 15,
     "Rééducation post-fracture — séance 7/15", "prévu", None),
    ("M. Michel Charrier", 81, 13, 0,
     "Drainage lymphatique — séance 9/15", "confirmé", None),
    ("Mme Brigitte Salmon", 84, 16, 0,
     "Rééducation de l'épaule — bilan", "prévu", None),
    ("M. Olivier Reynaud", 88, 8, 15,
     "Kinésithérapie du sport — test d'appui", "prévu", None, 2),
    ("Mme Estelle Munoz", 91, 11, 30,
     "Rééducation du dos — séance 4/10", "prévu", None),
    ("M. Fabrice Lelièvre", 95, 15, 30,
     "Suivi post-opératoire — contrôle", "prévu", None),
    ("Mme Danielle Ollivier", 99, 9, 15,
     "Première consultation — bilan complet", "prévu", None, 4),
)


# ---------------------------------------------------------------------------
# LE DÉCOR ANGLOPHONE — le même jeu d'essai, joué par une autre distribution
# ---------------------------------------------------------------------------
#
# ⚠ CE N'EST PAS UNE TRADUCTION, C'EST UN CASTING. On ne traduit pas un nom
# propre. Mais un testeur anglophone qui découvre le produit sur « Mme Marie-
# Christine de La Tour du Pin » bute sur le décor avant d'avoir vu le logiciel.
#
# ⚠ ET LES PARTICULARITÉS DU DÉCOR SONT VOULUES, DONC REPRODUITES. Ce jeu
# d'essai n'est pas une liste de noms : c'est un banc. Il porte exprès des
# civilités variées, des particules, des noms composés, des accents, un nom
# très long, DEUX HOMONYMES, deux fiches sans numéro, deux 🚫. Chacune de ces
# propriétés éprouve une règle du produit — l'homonymie éprouve la clé
# (nom, téléphone), le nom très long éprouve la mise en page. Une distribution
# anglophone qui les perdrait ne serait plus un banc, juste une liste.
#
# ⚠ SANS ÉQUIVALENT, ON GARDE LE FRANÇAIS. C'est la même règle que partout
# ailleurs dans ce produit : on ne traduit que ce qu'on connaît. Un nom absent
# du tableau traverse intact.

NOMS_EN = {
    'M. Abdel Haddad':
        'Mr Abdul Rahman',
    'M. Alain Bouvier':
        'Mr Alan Bowyer',
    'M. Anselme Kouassi':
        'Mr Ambrose Boateng',
    'M. Antoine Villeneuve':
        'Mr Anthony Newton',
    'M. Aurélien Pichot':
        'Mr Julian Pickett',
    'M. Bertrand Nicolas':
        'Mr Bertram Nicholas',
    'M. Bruno Lacombe':
        'Mr Bruno Coombes',
    'M. Damien Rouvière':
        'Mr Damian Oakley',
    'M. Didier Fontaine':
        'Mr Derek Fountain',
    'M. Fabrice Lelièvre':
        "Mr Fabian O'Hare",
    'M. Frédéric Aumont':
        'Mr Frederick Almond',
    'M. Gilbert Perrin':
        'Mr Gilbert Perryman',
    'M. Grégoire Vasseur':
        'Mr Gregory Whitaker',
    'M. Hervé Dombasle':
        'Mr Hugh Dunsmore',
    'M. Jean Martin':
        'Mr John Smith',
    "M. Jean-Baptiste d'Aubigné":
        "Mr John-Paul d'Arcy",
    'M. Julien Barbier':
        'Mr Justin Barber',
    'M. Karim Ben Amar':
        'Mr Karim Al Hassan',
    'M. Karim Osman':
        'Mr Karim Osman',
    'M. Loïc Kerhervé':
        'Mr Seán Kilbride',
    'M. Lucien Chartier':
        'Mr Lucian Carter',
    'M. Marc Deschamps':
        'Mr Mark Fielding',
    'M. Michel Charrier':
        'Mr Michael Cartwright',
    'M. Olivier Reynaud':
        'Mr Oliver Rayner',
    'M. Olivier Tanguy':
        'Mr Oliver Trelawny',
    'M. Ousmane Traoré':
        'Mr Emeka Okonkwo',
    'M. Pascal Guérin':
        'Mr Pascal Warren',
    'M. Patrick Ferreira':
        'Mr Patrick Ferreira',
    'M. Paul Guillot':
        'Mr Paul Willett',
    'M. Raymond Bouchard':
        'Mr Raymond Butcher',
    'M. Samir Belhadj':
        'Mr Samir Iqbal',
    'M. Serge Pouliquen':
        'Mr Cyril Fitzgerald',
    'M. Sébastien Nguyen':
        'Mr Sebastian Wong',
    'M. Théo Sanchez':
        'Mr Theo Costa',
    'M. Xavier Morvan':
        'Mr Xavier MacGregor',
    'M. Éric Vandamme':
        'Mr Eric Vandeleur',
    'M. Étienne Delacroix-Marchand':
        'Mr Stephen Crosby-Marchant',
    'Mme Amina Cherif':
        'Ms Amina Sharif',
    'Mme Anaïs Rousseau-Vidal':
        'Ms Chloë Rowley-Vaughan',
    'Mme Aurélie Pastor':
        'Ms Julia Shepherd',
    'Mme Brigitte Salmon':
        'Ms Bridget Salmon',
    'Mme Béatrice Vandenberghe':
        'Ms Beatrice Vandenberg',
    'Mme Camille Aubert':
        'Ms Camilla Ashby',
    'Mme Chantal Renaudin':
        'Ms Sheila Rennison',
    'Mme Christiane Lemarié':
        'Ms Christine Lockwood',
    'Mme Corinne Vasseur':
        'Ms Corinne Whitaker',
    'Mme Danielle Ollivier':
        'Ms Danielle Oliphant',
    'Mme Dominique Lherbier':
        "Ms Jo L'Estrange",
    'Mme Estelle Munoz':
        'Ms Estelle Delgado',
    'Mme Fatima Zahra El Amrani':
        'Ms Fatima Zahra El Masri',
    'Mme Gaëlle Le Goff':
        'Ms Siân ap Rhys',
    'Mme Geneviève Marceau':
        'Ms Genevieve Marsden',
    'Mme Hélène Prévost':
        'Ms Helen Prescott',
    'Mme Hélène Sabatier':
        'Ms Helen Sadler',
    'Mme Josette Aubertin':
        'Ms Joyce Ashbourne',
    'Mme Karine Lemoine':
        'Ms Karen Lyndon',
    'Mme Laurence Thibault':
        'Ms Lorraine Tibbetts',
    'Mme Leïla Bencheikh':
        'Ms Leila Choudhury',
    'Mme Lucie Bonnet':
        'Ms Lucy Bennett',
    'Mme Marie-Christine de La Tour du Pin':
        'Ms Mary-Christine de la Poer Beresford',
    'Mme Monique Delattre':
        'Ms Maureen Brathwaite',
    'Mme Nadia Lefèvre':
        'Ms Nadia Fletcher',
    'Mme Nathalie Ferrand':
        'Ms Natalie Boyce',
    'Mme Nawel Boukhari':
        'Ms Nawal Bukhari',
    'Mme Noémie Fauconnier':
        'Ms Naomi Faulkner',
    'Mme Roselyne Gauthier':
        'Ms Rosalyn Walters',
    'Mme Sandrine Leclerc':
        'Ms Sandra Ledger',
    'Mme Solange Dupuis-Ferrand':
        'Ms Rosamund Hartwell-Boyce',
    'Mme Sophie Mercier':
        'Ms Sophie Mercer',
    'Mme Sylviane Roche':
        'Ms Sylvia Roche',
    'Mme Véronique Amiot':
        'Ms Veronika Adamczyk',
    'Mme Yvonne Lecomte':
        "Ms Yvonne O'Sullivan",
    'Mme Zoé Berthier':
        'Ms Zoë Bartlett',
    'Mme Élise Charpentier':
        'Ms Elise Carpenter',
    'Mme Émilie Sanchez-Roy':
        'Ms Renée Costa-Rowe',
}
MOTIFS_EN = {
    'Bilan de posture initial':
        'Initial posture assessment',
    'Bilan de posture — contrôle':
        'Posture assessment — check-up',
    'Bilan de posture — contrôle annuel':
        'Posture assessment — annual check-up',
    'Bilan nutrition':
        'Nutrition assessment',
    'Contrôle annuel':
        'Annual check-up',
    'Contrôle à trois mois':
        'Three-month check-up',
    'Coupe et barbe':
        'Haircut and beard trim',
    'Cours de guitare':
        'Guitar lesson',
    'Drainage lymphatique du bras droit':
        'Lymphatic drainage, right arm',
    'Drainage lymphatique — séance 13/15':
        'Lymphatic drainage — session 13/15',
    'Drainage lymphatique — séance 4/10':
        'Lymphatic drainage — session 4/10',
    'Drainage lymphatique — séance 5/10':
        'Lymphatic drainage — session 5/10',
    'Drainage lymphatique — séance 5/15':
        'Lymphatic drainage — session 5/15',
    'Drainage lymphatique — séance 7/15':
        'Lymphatic drainage — session 7/15',
    'Drainage lymphatique — séance 9/15':
        'Lymphatic drainage — session 9/15',
    'Kinésithérapie du sport — renforcement':
        'Sports physiotherapy — strengthening',
    'Kinésithérapie du sport — reprise':
        'Sports physiotherapy — return to sport',
    'Kinésithérapie du sport — reprise de course':
        'Sports physiotherapy — return to running',
    "Kinésithérapie du sport — test d'appui":
        'Sports physiotherapy — weight-bearing test',
    "Kinésithérapie du sport — test d'effort":
        'Sports physiotherapy — exercise test',
    'Kinésithérapie maxillo-faciale':
        'Maxillofacial physiotherapy',
    'Kinésithérapie respiratoire':
        'Respiratory physiotherapy',
    'Kinésithérapie respiratoire — suivi':
        'Respiratory physiotherapy — review',
    'Kinésithérapie respiratoire — séance 2/6':
        'Respiratory physiotherapy — session 2/6',
    'Kinésithérapie respiratoire — séance 3/6':
        'Respiratory physiotherapy — session 3/6',
    'Kinésithérapie respiratoire — séance 4/6':
        'Respiratory physiotherapy — session 4/6',
    'Lombalgie aiguë — première séance':
        'Acute low back pain — first session',
    'Lombalgie chronique — entretien':
        'Chronic low back pain — maintenance',
    'Lombalgie chronique — nouvelle séance':
        'Chronic low back pain — new session',
    'Lombalgie chronique — séance 3/10':
        'Chronic low back pain — session 3/10',
    'Lombalgie chronique — séance 9/10':
        'Chronic low back pain — session 9/10',
    "Lombalgie chronique — séance d'entretien":
        'Chronic low back pain — maintenance session',
    'Lombalgie chronique — séance reportée':
        'Chronic low back pain — rescheduled session',
    'Lombalgie — séance 2/8':
        'Low back pain — session 2/8',
    'Massage décontracturant des trapèzes':
        'Muscle-release massage, trapezius',
    'Massage décontracturant du dos':
        'Muscle-release massage, back',
    'Massage thérapeutique — séance 2/6':
        'Therapeutic massage — session 2/6',
    'Première consultation — bilan complet':
        'First consultation — full assessment',
    'Prévention des chutes — séance 3/10':
        'Falls prevention — session 3/10',
    'Prévention des chutes — séance 4/10':
        'Falls prevention — session 4/10',
    'Rééducation cervicale':
        'Neck rehabilitation',
    'Rééducation cervicale après coup du lapin':
        'Neck rehabilitation after whiplash',
    'Rééducation cervicale — reprise':
        'Neck rehabilitation — resuming treatment',
    'Rééducation cervicale — séance 3/8':
        'Neck rehabilitation — session 3/8',
    "Rééducation de l'épaule après luxation":
        'Shoulder rehabilitation after dislocation',
    "Rééducation de l'épaule — bilan":
        'Shoulder rehabilitation — assessment',
    "Rééducation de l'épaule — bilan de fin":
        'Shoulder rehabilitation — final assessment',
    "Rééducation de l'épaule — bilan intermédiaire":
        'Shoulder rehabilitation — interim assessment',
    "Rééducation de l'épaule — séance 3/12":
        'Shoulder rehabilitation — session 3/12',
    "Rééducation de l'épaule — séance 4/12":
        'Shoulder rehabilitation — session 4/12',
    "Rééducation de l'épaule — séance 5/12":
        'Shoulder rehabilitation — session 5/12',
    "Rééducation de l'épaule — séance 6/12":
        'Shoulder rehabilitation — session 6/12',
    "Rééducation de l'épaule — séance 7/12":
        'Shoulder rehabilitation — session 7/12',
    "Rééducation de l'équilibre (prévention des chutes)":
        'Balance rehabilitation (falls prevention)',
    'Rééducation de la cheville — reprise':
        'Ankle rehabilitation — resuming treatment',
    'Rééducation de la cheville — séance 2/8':
        'Ankle rehabilitation — session 2/8',
    'Rééducation de la hanche après prothèse':
        'Hip rehabilitation after joint replacement',
    'Rééducation de la hanche — séance 8/15':
        'Hip rehabilitation — session 8/15',
    'Rééducation de la marche après AVC':
        'Walking rehabilitation after stroke',
    'Rééducation de la marche — séance 14/20':
        'Walking rehabilitation — session 14/20',
    'Rééducation de la marche — séance 5/20':
        'Walking rehabilitation — session 5/20',
    'Rééducation de la marche — séance 6/20':
        'Walking rehabilitation — session 6/20',
    'Rééducation du dos — séance 1/6':
        'Back rehabilitation — session 1/6',
    'Rééducation du dos — séance 2/10':
        'Back rehabilitation — session 2/10',
    'Rééducation du dos — séance 2/6':
        'Back rehabilitation — session 2/6',
    'Rééducation du dos — séance 4/10':
        'Back rehabilitation — session 4/10',
    'Rééducation du genou — séance 2/10':
        'Knee rehabilitation — session 2/10',
    'Rééducation du genou — séance 2/12':
        'Knee rehabilitation — session 2/12',
    'Rééducation du genou — séance 3/10':
        'Knee rehabilitation — session 3/10',
    'Rééducation du genou — séance 4/10':
        'Knee rehabilitation — session 4/10',
    'Rééducation du genou — séance 5/10':
        'Knee rehabilitation — session 5/10',
    'Rééducation du genou — séance 5/12':
        'Knee rehabilitation — session 5/12',
    'Rééducation du genou — séance 6/10':
        'Knee rehabilitation — session 6/10',
    'Rééducation du genou — séance 8/12':
        'Knee rehabilitation — session 8/12',
    'Rééducation du poignet après fracture':
        'Wrist rehabilitation after fracture',
    'Rééducation du poignet — bilan de fin':
        'Wrist rehabilitation — final assessment',
    'Rééducation du poignet — séance 2/8':
        'Wrist rehabilitation — session 2/8',
    'Rééducation du poignet — séance 3/8':
        'Wrist rehabilitation — session 3/8',
    'Rééducation du poignet — séance 4/8':
        'Wrist rehabilitation — session 4/8',
    'Rééducation du poignet — séance 5/15':
        'Wrist rehabilitation — session 5/15',
    'Rééducation post-entorse de la cheville':
        'Rehabilitation after ankle sprain',
    'Rééducation post-fracture — séance 12/15':
        'Post-fracture rehabilitation — session 12/15',
    'Rééducation post-fracture — séance 4/15':
        'Post-fracture rehabilitation — session 4/15',
    'Rééducation post-fracture — séance 7/15':
        'Post-fracture rehabilitation — session 7/15',
    'Rééducation périnéale — séance 2/8':
        'Pelvic floor rehabilitation — session 2/8',
    'Rééducation périnéale — séance 3/8':
        'Pelvic floor rehabilitation — session 3/8',
    'Rééducation périnéale — séance 4/8':
        'Pelvic floor rehabilitation — session 4/8',
    'Rééducation périnéale — séance 8/8':
        'Pelvic floor rehabilitation — session 8/8',
    'Rééducation respiratoire (BPCO)':
        'Pulmonary rehabilitation (COPD)',
    'Rééducation vestibulaire (vertiges)':
        'Vestibular rehabilitation (vertigo)',
    'Rééducation vestibulaire — bilan de fin':
        'Vestibular rehabilitation — final assessment',
    'Rééducation vestibulaire — séance 2/6':
        'Vestibular rehabilitation — session 2/6',
    'Rééducation vestibulaire — séance 3/6':
        'Vestibular rehabilitation — session 3/6',
    'Suivi post-opératoire de la hanche':
        'Post-operative hip review',
    'Suivi post-opératoire du genou':
        'Post-operative knee review',
    'Suivi post-opératoire — contrôle':
        'Post-operative review — check-up',
    'Séance de kinésithérapie':
        'Physiotherapy session',
    'Séance de kinésithérapie du dos':
        'Back physiotherapy session',
    'Séance de kinésithérapie du dos (reprise)':
        'Back physiotherapy session (resuming treatment)',
}
NOM_METIER_EN = 'Physiotherapy practice'


def _traduit(table, valeur):
    """La valeur traduite si on la connaît, sinon la valeur telle quelle."""
    return table.get(valeur, valeur)


def decor(langue_code="fr"):
    """(clients, rendez-vous, premiers contacts, nom du métier) dans CETTE langue.

    Le décor anglais est FABRIQUÉ à partir du français, par substitution des
    seuls noms et motifs : la structure — l'ordre, les numéros de téléphone
    fictifs, les statuts, les durées, les homonymes — est donc conservée par
    construction, et non par recopie. Il n'y a rien à tenir à jour en double.
    """
    if (langue_code or "fr") != "en" or not NOMS_EN:
        return CLIENTS, RENDEZVOUS, PREMIERS_CONTACTS, NOM_METIER
    clients = tuple((_traduit(NOMS_EN, nom), telephone, marque)
                    for nom, telephone, marque in CLIENTS)
    rendezvous = tuple(
        (_traduit(NOMS_EN, entree[0]),) + entree[1:4]
        + (_traduit(MOTIFS_EN, entree[4]),) + entree[5:]
        for entree in RENDEZVOUS)
    premiers = tuple(
        (_traduit(NOMS_EN, entree[0]),) + entree[1:5]
        + (_traduit(MOTIFS_EN, entree[5]),)
        for entree in PREMIERS_CONTACTS)
    return clients, rendezvous, premiers, (NOM_METIER_EN or NOM_METIER)


def noms_du_jeu():
    """TOUS les noms du jeu d'essai, dans les deux langues.

    ⚠ LES DEUX, ET C'EST NÉCESSAIRE. Un écran qui reconnaît une fiche de
    démonstration à son nom doit la reconnaître même si elle a été chargée
    dans l'autre langue — sinon le compte affiché change en changeant de
    langue, alors que la base n'a pas bougé.
    """
    noms = {nom for nom, _, _ in CLIENTS}
    noms |= set(NOMS_EN.values())
    return noms


def est_charge(base):
    """Vrai si un jeu d'essai est actuellement en base."""
    return base.compter_clients_jeu_essai() > 0


def resume(langue_code="fr"):
    """Ce que le jeu d'essai contient — annoncé AVANT de le charger.

    ⚠ LES COMPTES NE CHANGENT PAS AVEC LA LANGUE : c'est le même décor,
    joué par une autre distribution. Seul le nom du métier change.
    """
    CLIENTS_L, RENDEZVOUS_L, _, metier = decor(langue_code)
    sans_numero = sum(1 for _, telephone, _ in CLIENTS_L if not telephone)
    stop = sum(1 for _, _, marque in CLIENTS_L if marque)
    statuts = {}
    for entree in RENDEZVOUS_L:
        statuts[entree[5]] = statuts.get(entree[5], 0) + 1
    return {
        "clients": len(CLIENTS_L),
        "rendezvous": len(RENDEZVOUS_L),
        "sans_numero": sans_numero,
        "ne_plus_appeler": stop,
        "statuts": statuts,
        # Rendez-vous plus longs que la durée moyenne (2 tranches ou plus) :
        # ce sont eux qui font vivre la règle des tranches consécutives.
        "longs": sum(1 for entree in RENDEZVOUS_L
                     if len(entree) > 7 and entree[7] > 1),
        "passes": sum(1 for entree in RENDEZVOUS_L if entree[1] < 0),
        "a_venir": sum(1 for entree in RENDEZVOUS_L if entree[1] >= 0),
        "metier": metier,
    }


def charger(base, maintenant=None, langue_code="fr"):
    """Ajoute le jeu d'essai à la base ; rend (clients créés, rendez-vous créés).

    ADDITIF : rien n'est effacé, les clients existants ne sont pas touchés.
    Un second chargement ne double rien. Chaque client créé porte
    clients.jeu_essai = 1, ce qui rend le retrait possible sans risque pour les
    vraies données.

    ⚠ « NE DOUBLE RIEN » ÉTAIT FAUX POUR LES RENDEZ-VOUS (corrigé le
    11/08/2026). Les CLIENTS étaient bien réutilisés ; les rendez-vous, eux,
    étaient recréés à chaque fois. Mesuré : 112 rendez-vous au premier
    chargement, 224 au deuxième, 336 au troisième. Le défaut ne se voyait pas
    parce que l'essai qui gardait cette promesse ne regardait que le compte de
    CLIENTS.

    C'est un défaut qui MORD : pour obtenir des données de démonstration
    enrichies, il faut recharger — et recharger doublait l'agenda.

    ⚠ L'IDENTITÉ D'UN RENDEZ-VOUS DE DÉMONSTRATION EST (patient, motif), PAS
    (patient, horaire). Les horaires sont calculés à partir de « maintenant » :
    un rechargement le lendemain donnerait d'autres horaires, et la comparaison
    par horaire n'aurait donc rien reconnu. Le couple (patient, motif) est
    unique dans RENDEZVOUS — un essai le garde.
    """
    if maintenant is None:
        maintenant = datetime.datetime.now()
    maintenant = maintenant.replace(second=0, microsecond=0)
    CLIENTS_L, RENDEZVOUS_L, _, _ = decor(langue_code)
    # Les homonymes ont le même nom : la clé est (nom, téléphone), et les
    # deux « sans numéro » sont distingués par leur nom.
    identifiants, clients_crees = {}, 0
    for nom, telephone, ne_plus_appeler in CLIENTS_L:
        client_id, cree = _obtenir_ou_creer_essai(base, nom, telephone)
        clients_crees += 1 if cree else 0
        identifiants.setdefault(nom, []).append(client_id)
        if ne_plus_appeler:
            base.definir_ne_plus_appeler(client_id, True)
    # CE QUI EST DÉJÀ LÀ, lu EN UNE SEULE PASSE : (client, motif). Voir la
    # docstring — c'est cette identité-là qui reconnaît un rendez-vous de
    # démonstration déjà chargé, y compris un autre jour.
    deja = {(r["client_id"], r["motif"]) for r in base.tous_les_rendezvous()}
    # Les rendez-vous des homonymes vont au premier des deux, sauf le second
    # « M. Jean Martin » qui n'en a pas : c'est justement ce qui rend
    # l'homonymie visible à l'écran (deux fiches, un seul dossier chargé).
    rendezvous_crees = 0
    for entree in RENDEZVOUS_L:
        nom, jours, heure, minute, motif, statut, rappel = entree[:7]
        # Durée facultative en fin de ligne : 1 tranche par défaut.
        tranches = entree[7] if len(entree) > 7 else 1
        client_id = identifiants[nom][0]
        if (client_id, motif) in deja:
            continue
        horaire = (maintenant + datetime.timedelta(days=jours)).replace(
            hour=heure, minute=minute)
        rappel_souhaite = None
        if rappel is not None:
            rappel_souhaite = (maintenant + datetime.timedelta(days=rappel)
                               ).replace(hour=12, minute=30).isoformat(
                                   timespec="minutes")
        base.ajouter_rendezvous(client_id, horaire.isoformat(timespec="minutes"),
                                motif, statut=statut,
                                rappel_souhaite=rappel_souhaite,
                                duree_tranches=tranches)
        rendezvous_crees += 1
    journal.info("Jeu d'essai chargé : %d client(s), %d rendez-vous "
                 "(geste explicite de l'utilisateur)",
                 clients_crees, rendezvous_crees)
    return clients_crees, rendezvous_crees


def _obtenir_ou_creer_essai(base, nom, telephone):
    """Le client d'essai (nom, téléphone) ; rend (identifiant, créé ?).

    Ne réutilise QUE des clients déjà marqués « jeu d'essai » : un vrai
    client homonyme de l'utilisateur ne se retrouverait jamais embarqué
    dans le retrait du jeu d'essai. Le numéro passe par le validateur
    commun — le jeu d'essai est stocké exactement comme une saisie.
    """
    if telephone:
        telephone = saisie.valider_telephone(telephone)
    # Requête écrite ici plutôt que dans db.py : elle passe donc par le
    # verrou de la base à la main (voir db._sous_verrou), sans quoi elle
    # pourrait tomber au milieu d'une écriture du fil de campagne.
    with base.verrou:
        ligne = base.conn.execute(
            "SELECT id FROM clients WHERE nom = ? AND telephone = ? "
            "AND jeu_essai = 1 ORDER BY id LIMIT 1", (nom, telephone)).fetchone()
    if ligne:
        return ligne["id"], False
    return base.ajouter_client(nom, telephone, jeu_essai=True), True


def retirer(base):
    """Retire le jeu d'essai ; rend (clients retirés, rendez-vous retirés)."""
    return base.supprimer_jeu_essai()
