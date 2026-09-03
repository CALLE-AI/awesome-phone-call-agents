# -*- coding: utf-8 -*-
"""Le dictionnaire des phrases de l'interface, français vers anglais.

⚠ UN DICTIONNAIRE, PAS UN TRADUCTEUR. Chaque entrée est une phrase du produit,
écrite telle qu'elle paraît à l'écran. Ce qui n'y est pas reste en français —
voir `langue.traduire`. Sur un écran qui décide d'appels téléphoniques réels,
une phrase mal traduite est pire qu'une phrase non traduite.

COMMENT ON L'ALIMENTE, et c'est une procédure, pas un coup de main :
`outils/recolter_phrases.py` parcourt les vraies pages du produit, en relève
les phrases par `langue.phrases_de`, et dit lesquelles manquent ici. La
couverture est donc un CHIFFRE mesuré sur des écrans réels, jamais une
impression.

⚠ LES CLÉS SONT SENSIBLES À L'ESPACE ET À LA CASSE. La clé est la phrase
DÉBARRASSÉE de ses espaces de bord (le code d'origine l'indente), mais rien
d'autre n'est normalisé : « Enregistrer » et « enregistrer » sont deux
entrées. C'est voulu — deviner l'un depuis l'autre finirait par traduire un
nom propre.
"""

import functools
import html
import re

from . import themes

# ---------------------------------------------------------------------------
# Français -> anglais
# ---------------------------------------------------------------------------

FR_VERS_EN = {
    '"\n           placeholder="Cabinet Dupont Kinésithérapie">':
        '"\n           placeholder="Dupont Physiotherapy Practice">',
    '"\n           placeholder="Lefèvre, ou 0600000042">':
        '"\n           placeholder="Lefèvre, or 0600000042">',
    '"\n           placeholder="Séance de kinésithérapie">':
        '"\n           placeholder="Physiotherapy session">',
    '"\n           placeholder="laisser vide pour garder le numéro actuel">':
        '"\n           placeholder="leave blank to keep the current number">',
    '"\n        title="Ouvrir son dossier et modifier son nom, son numéro ou l\'indicateur 🚫">':
        '"\n        title="Open their record and change their name, their number or the indicator 🚫">',
    '"\n   >＋ Ajouter un rendez-vous':
        '"\n   >＋ Add an appointment',
    '" placeholder="toutes"\n  title="Laissez vide pour n\'écarter personne">':
        '" placeholder="all"\n  title="Leave blank to set no one aside">',
    '" role="dialog"\n     aria-modal="true" aria-label="Configuration de RingBack">':
        '" role="dialog"\n     aria-modal="true" aria-label="RingBack configuration">',
    '" title="Ce rendez-vous vient de cette campagne d\'appels">📣':
        '" title="This appointment comes from this call campaign">📣',
    '" title="Ouvre une fenêtre : toute la semaine, ou des jours choisis — aucun appel n\'est passé">🔔 Créer une campagne de rappel':
        '" title="Opens a window: the whole week, or chosen days — no call is made">🔔 Create a callback campaign',
    '" title="Ouvrir la demande de cette personne, en clair">Voir sa demande…':
        '" title="Open this person\'s request, in plain words">See their request…',
    '" title="Retirer cette place de la liste" aria-label="Retirer':
        '" title="Remove this slot from the list" aria-label="Remove',
    '" title="État d\'agenda — ce que dit le planning">':
        '" title="Calendar status — what the schedule says">',
    '" title="État de conversation — ce que le dernier appel a produit">':
        '" title="Conversation status — what the last call produced">',
    '">\n      et':
        '">\n      and',
    '">\nVoir cette journée dans le planning':
        '">\nSee this day in the schedule',
    '"> et':
        '"> and',
    '">Effacer la liste':
        '">Clear the list',
    '">Ouvrir la fiche complète':
        '">Open the full record',
    '">Passer cette page':
        '">Skip this page',
    '">Supprimer ce contact…':
        '">Delete this contact…',
    '">Voir la campagne n°':
        '">View campaign #',
    '">Voir la fiche':
        '">View the record',
    '">Voir le client':
        '">See the contact',
    '">Voir le déroulé de la cascade rattachée':
        '">See the linked cascade step by step',
    '">campagne de rappel des manqués':
        '">callback campaign for missed appointments',
    '">voir la fiche':
        '">see the record',
    '">voir le rendez-vous créé':
        '">see the appointment created',
    '">voir sa fiche':
        '">see their record',
    '">← Retour au planning':
        '">← Back to the schedule',
    '">⚙ Réglages → Discours de l\'agent':
        '">⚙ Settings → Agent\'s speech',
    '">⚙ Réglages → Options de\n  comportement':
        '">⚙ Settings → Behaviour\n  options',
    '">➕ Créer la campagne «':
        '">➕ Create the campaign «',
    '%d rendez-vous manqué(s) passé(s) en « ignoré »':
        '%d missed appointment(s) switched to « ignored »',
    '%d rendez-vous passé(s) marqué(s) manqué(s)':
        '%d past appointment(s) marked missed',
    '%d/%m/%Y à %Hh%M':
        '%d/%m/%Y at %H:%M',
    '(assistant en 3 étapes : nature → message → personnes)':
        '(3-step wizard: nature → script → people)',
    '(au lieu de coller)':
        '(instead of pasting)',
    '(aucune réponse conservée)':
        '(no answer kept)',
    '(ce que dit le planning) et\nson':
        '(what the schedule says) and\nits',
    '(ce que le dernier appel a\nproduit). Un rendez-vous long compte pour':
        '(what the last call\nproduced). A long appointment counts as',
    "(choisi à l'étape ②)":
        '(chosen at step ②)',
    '(créneau libéré, rappel, confirmation, contact unique…) appliquée à une':
        '(freed slot, reminder, confirmation, single contact…) applied to a',
    '(créneau pris)':
        '(slot taken)',
    '(discrétion)':
        '(discretion)',
    '(durée':
        '(duration',
    '(geste manuel, jamais automatique).':
        '(manual action, never automatic).',
    "(iCalendar) est le\nformat d'échange des agendas : c'est ce qu'exportent Google&nbsp;Agenda,\nOutlook, Apple Calendrier et la plupart des logiciels de cabinet. RingBack sait\nle relire pour remplir votre planning d'un coup.":
        '(iCalendar) is the\ncalendar exchange format: it is what Google&nbsp;Calendar,\nOutlook, Apple Calendar and most practice software export. RingBack can\nread it to fill your schedule in one go.',
    '(ils\narriveront « à compléter »), et':
        '(they\nwill arrive « to complete »), and',
    "(ils\narriveront « à compléter »), et 38 portent le nom de contacts du jeu\nd'essai — s'il est chargé, ils seront reconnus et rien ne sera dupliqué.":
        '(they\nwill come in as « to complete »), and 38 carry the names of test data\ncontacts — if it is loaded, they will be recognised and nothing will be duplicated.',
    "(la durée moyenne d'un rendez-vous), par exemple":
        '(the average appointment length), for example',
    "(le 1ᵉʳ rôle au 1ᵉʳ testeur, le 2ᵉ au\n2ᵉ, et on reboucle). Avec un seul testeur, tout retombe sur lui. L'initiale\ndu prénom rappelle le rôle à jouer :":
        '(the 1st role to the 1st tester, the 2nd to the\n2nd, then round again). With a single tester, everything falls to them. The first\nletter of the given name is a reminder of the role to play:',
    "(ligne ↔ au cahier des changements). S'il n'en veut aucune — ou si cette case reste décochée — le rendez-vous est annulé et le client passe « 📞 le contact rappellera » : plus aucun appel ne part pour lui, c'est LUI qui reprend contact":
        '(line ↔ in the log of changes). If they want none of them — or if this box stays unticked — the appointment is cancelled and the contact moves to « 📞 the contact will call back »: no call goes out for them any more, THEY are the one who gets back in touch',
    '(numéro compris)':
        '(number included)',
    '(ouvert − déjà pris −\n  jours fermés) et':
        '(open − already taken −\n  closing days) and',
    '(par défaut)':
        '(default)',
    '(par défaut) — elle se règle par':
        '(default) — it is set via',
    '(reçu «':
        '(received «',
    "(rien : laissez sonner jusqu'au bout, ne décrochez pas)":
        '(nothing: let it ring to the end, do not pick up)',
    "(s), jamais dérangé(s) — la campagne s'est arrêtée avant eux. La raison est écrite sur chaque ligne : ouvrez « 🔁 Relances » pour la lire.":
        '(s), never disturbed — the campaign stopped before them. The reason is written on each line: open « 🔁 Follow-ups » to read it.',
    '(s), jamais dérangé(s).':
        '(s), never disturbed.',
    '(sa place redevient libre) et le récapitulatif de\n  la campagne vous':
        '(their slot becomes free again) and the campaign\n  summary',
    '(souvent dans les\nparamètres du calendrier, parfois sous':
        '(often in the\ncalendar settings, sometimes under',
    '(séparées par un\n      point-virgule, une virgule ou une tabulation)':
        '(separated by a\n      semicolon, a comma or a tab)',
    '(une par rôle à éprouver), au plus':
        '(one per role to test), at most',
    "(votre numéro d'essai). AUCUN contact ne sera appelé sur son propre numéro ; leur identité, elle, part inchangée.":
        '(your test number). NO contact will be called on their own number; their identity, though, goes out unchanged.',
    ')\n  — toujours appliquée, réglable dans':
        ')\n  — always applied, adjustable in',
    ')\net choisissez le format':
        ')\nand choose the format',
    ') : la place libérée (':
        '): the freed slot (',
    ") ;\n  une ligne d'en-tête est acceptée. Encodage UTF-8 ou Excel (cp1252) — les\n  lignes fautives sont citées une par une.":
        ');\n  a header line is accepted. UTF-8 or Excel (cp1252) encoding — the\n  faulty lines are listed one by one.',
    ') est déjà passée — aucune campagne ne pourrait être préparée. Choisissez une date à venir.':
        ') is already past — no campaign could be prepared. Choose a future date.',
    ') et la case est':
        ') and the box is',
    ") ne partiront\n  qu'au ▶ Démarrer, depuis la fiche de la campagne.":
        ') will only go out\n  at ▶ Start, from the campaign record.',
    ") pour éprouver des formats d'export ; ceux-là portent\ndes dates figées.":
        ') to test export formats; those carry\nfixed dates.',
    ') tombe au-delà.':
        ') falls beyond.',
    ") — aucun appel ni relance ne s'y déclenche, même déclenché à la main. Elle se règle dans « ⚙ Réglages ».":
        ') — no call or follow-up fires then, even started by hand. It is set in « ⚙ Settings ».',
    ") — c'était l'une des places annoncées, elle est pourvue":
        ') — it was one of the announced slots, it is filled',
    ') — corrigez-le dans ⚙ Réglages : retirez ce testeur, puis ajoutez-le à nouveau.':
        ') — fix it in ⚙ Settings: remove this tester, then add them again.',
    "),\n  tout lancement d'appel est refusé — politesse d'abord.":
        '),\n  any call launch is refused — courtesy first.',
    '), fournie par':
        '), supplied by',
    "). C'est le garde-fou de politesse — la plage se règle dans « ⚙ Réglages ».":
        '). This is the courtesy safeguard — the calling window is set in « ⚙ Settings ».',
    "). C'est possible parce qu'elle est":
        '). This is possible because it is',
    ',\n    de':
        ',\n    from',
    ",\n    sur la période choisie : ce sont ces personnes-là qui seront appelées.\n    Une période ne vaut que pour les rendez-vous à venir ou manqués — les\n    autres sources n'ont pas de date.":
        ',\n    over the chosen period: those are the people who will be called.\n    A period only applies to upcoming or missed appointments — the\n    other sources have no date.',
    ',\n  que cette campagne est justement en train de vider.':
        ',\n  which this campaign is in the middle of emptying.',
    ',\n  section':
        ',\n  section',
    ',\nposés dans':
        ',\nplaced in',
    ',\nsur des téléphones que vous connaissez :':
        ',\non phones that you know:',
    ',\nsur des téléphones que vous connaissez : 5 identités\nfictives, chacune avec un rendez-vous à confirmer, réparties sur vos\ntesteurs':
        ',\non phones you know: 5 fictitious\nidentities, each with an appointment to confirm, spread across your\ntesters',
    ", -7 n'en portent":
        ', -7 have',
    ', AVANT votre date limite du':
        ', BEFORE your deadline of',
    ', après son rendez-vous du':
        ', after their appointment of',
    ', au pas de':
        ', in steps of',
    ", aucun ordre n'est imposé par\n  défaut (votre dernier choix est présélectionné) :":
        ', no order is imposed by\n  default (your last choice is preselected):',
    ", c'est parfait.":
        ", that's perfect.",
    ', ce serait possible ?':
        ', would that be possible?',
    ', comme au glissé.':
        ', as when dragging.',
    ', de':
        ', from',
    ', déjà confirmé.':
        ', already confirmed.',
    ', en écrivant dans « new_datetime » la date convenue (format 2026-08-15T14:30) si une date précise a été convenue, et rien sinon':
        ', writing in « new_datetime » the agreed date (format 2026-08-15T14:30) if a precise date was agreed, and nothing otherwise',
    ', et de ne jamais en\nproposer une déjà prise.':
        ', and never to\noffer one already taken.',
    ", et on n'y touche que pour\nviser un autre serveur que celui de CALL-E.":
        ', and you only change it to\npoint at a server other than the CALL-E one.',
    ', et à partir du':
        ', and from',
    ', et écris dans « new_datetime » la date convenue au format 2026-08-15T14:30':
        ', and write in « new_datetime » the agreed date in the format 2026-08-15T14:30',
    ", hors de la plage d'appel autorisée (":
        ', outside the allowed calling window (',
    ", ici l'assistant automatique du cabinet. Nous ne vous avons pas vu pour «":
        ", this is the practice's automated assistant. We haven't seen you for «",
    ', il est':
        ', it is',
    ', il reste':
        ', it remains',
    ', inchangée)':
        ', unchanged)',
    ", je suis l'assistant téléphonique du cabinet. Vous aviez rendez-vous":
        ", I'm the practice's phone assistant. You had an appointment",
    ', je vous appelle au sujet de votre rendez-vous.':
        ", I'm calling about your appointment.",
    ', jours fermés sautés.':
        ', closing days skipped.',
    ", jusqu'au":
        ', until',
    ", jusqu'à":
        ', up to',
    ', la date limite réglée pour le décalage en cascade':
        ', the deadline set for the cascade shift',
    ", la liste des personnes déjà remplie — la nature est déjà connue, on ne la redemande pas. C'est vous qui validez, puis qui démarrez.":
        ', the list of people already filled in — the type is already known, it is not asked again. You are the one who confirms, then starts.',
    ", les rôles\n  reviennent dans le même ordre, portés par d'autres prénoms de même\n  initiale.":
        ', the roles\n  come back in the same order, carried by other first names with the same\n  initial.',
    ', limite réglée pour le décalage en cascade':
        ', limit set for the cascade shift',
    ", mais ce rendez-vous n'est pas dans RingBack — rien n'a été supprimé ici.":
        ', but this appointment is not in RingBack — nothing was deleted here.',
    ", marqués 🧪\n      « jeu d'essai », répartis sur vos":
        ', marked 🧪\n      « test data », spread over your',
    ", marqués 🧪 « jeu d'essai » ;":
        ', marked 🧪 « test data »;',
    ', mot\npour mot':
        ', word\nfor word',
    ', nous sommes dans la période interdite réglée (':
        ', we are in the forbidden period that is set (',
    ', ou ajoutez un créneau à la main ci-dessous.':
        ', or add a slot manually below.',
    ', ou remplacez la variable à la main.':
        ', or replace the variable manually.',
    ', par exemple':
        ', for example',
    ", pas\n  l'adresse du site — c'est la confusion qui a fait échouer le premier essai\n  réel.":
        ', not\n  the website address — that confusion is what made the first real test\n  fail.',
    ", pas de votre logiciel de planification. Si\ncet agenda n'est pas à jour, il proposera des places":
        ', not from your scheduling software. If\nthis calendar is not up to date, it will offer slots',
    ', pour éviter un doublon :':
        ', to avoid a duplicate:',
    ', qui passe en « confirmé ».':
        ', which switches to « confirmed ».',
    ', réglable dans':
        ', adjustable in',
    ", seule leur identité part à l'agent, inchangée.":
        ', only their identity is sent to the agent, unchanged.',
    ', une par rôle à éprouver, sinon un rôle ne serait pas joué du tout.':
        ', one per role to test, otherwise a role would not be played at all.',
    ', une personne à la fois':
        ', one person at a time',
    ', une place vient de se libérer':
        ', a slot has just come free',
    ", zéro appel passé : c'est vous qui la\ndémarrez, et les trois verrous du mode réel (clé CALL-E, lancement en mode\nréel, mot APPELER tapé) restent vos gestes. Les appels partent":
        ', zero calls made: you are the one who\nstarts it, and the three locks of real mode (CALL-E key, launch in real\nmode, the word APPELER typed) remain your actions. The calls go out',
    ', à\nsa création comme pendant ses appels.':
        ', both\nwhen it is created and while it is calling.',
    ', à la racine\ndu projet.':
        ', at the root\nof the project.',
    ', étape ③).':
        ', step ③).',
    '.\n- Consigne propre au contact :':
        '.\n- Briefing specific to the contact:',
    '.\n- Créneau libéré :':
        '.\n- Freed slot:',
    '.\n- Créneaux disponibles pour négocier :':
        '.\n- Slots available to negotiate:',
    '.\n- Créneaux disponibles à proposer :':
        '.\n- Slots available to offer:',
    '.\n- Motif :':
        '.\n- Reason:',
    '.\n- Motif souhaité :':
        '.\n- Requested reason:',
    '.\n- Nom de l&#x27;entreprise :':
        '.\n- Practice name:',
    '.\n- Origine de la demande :':
        '.\n- Source of the request:',
    '.\n- Rendez-vous :':
        '.\n- Appointment:',
    '.\n- Rendez-vous actuel :':
        '.\n- Current appointment:',
    '.\n- Rendez-vous existant :':
        '.\n- Existing appointment:',
    ".\nAucun appel ne part tant que vous n'avez pas cliqué.":
        '.\nNo call goes out until you have clicked.',
    '.\nComment mener l&#x27;échange, dans cet ordre :\n1. commence par proposer LA date la plus proche, celle qui est écrite en « créneau proposé en premier » — une seule date, pas la liste ;\n2. si elle ne convient pas, demande quels JOURS de la semaine l&#x27;arrangeraient ;\n3. demande ensuite si elle préfère le MATIN ou l&#x27;APRÈS-MIDI ;\n4. propose alors UNE SEULE heure, prise dans les créneaux disponibles ci-dessus, qui corresponde à ce jour et à ce moment de la journée ; si tu n&#x27;en as aucune qui corresponde, dis-le simplement ;\n5. ⚠ à chaque refus, REPRENDS LE FILTRE au lieu d&#x27;enchaîner les heures : redemande quels jours l&#x27;arrangeraient, puis matin ou après-midi, puis propose une heure. Une heure à la fois, jamais une liste — c&#x27;est la personne qui restreint, pas toi qui énumères ;\n6. au bout de TROIS propositions refusées, n&#x27;insiste plus : « Je ne veux pas vous retenir plus longtemps. Puisque nous n&#x27;arrivons pas à trouver un moment qui vous convienne, une personne de l&#x27;établissement va vous rappeler pour convenir d&#x27;une date avec vous. Merci de votre patience, et bonne journée. » ; conclus alors sur AUTRE, sans date.\nTes règles — ce que tu dois faire, et ce que tu n&#x27;as pas le droit de faire :\n- ne donne aucune information médicale, et aucun détail qui ne soit pas écrit dans « ce que tu sais » ci-dessus ;\n- n&#x27;invente rien : ni date, ni horaire, ni tarif, ni nom ;\n- ne communique aucun numéro de téléphone ;\n- n&#x27;insiste jamais : un refus se respecte dès la première fois ;\n- si on te demande si tu es un robot, dis-le : « Je suis un assistant automatique, mais je peux tout à fait vous aider — et le secrétariat peut vous rappeler si vous préférez. » ;\n- si tu n&#x27;as pas la bonne personne : « Toutes mes excuses pour le dérangement, bonne journée. », et conclus sur AUTRE ;\n- redire ce que tu sais n&#x27;est JAMAIS une raison de passer la main : si on te demande de répéter la date, l&#x27;heure, le lieu, la durée ou le motif, redis-les simplement, aussi souvent qu&#x27;il le faut — ils sont écrits dans « ce que tu sais » ci-dessus ;\n- sortie de secours — UNIQUEMENT si la réponse ne se trouve nulle part dans « ce que tu sais », ou devant une personne agacée : « Je préfère ne pas vous dire de bêtise : je transmets votre demande à l&#x27;établissement, qui vous rappellera entre 9h00 et 19h00. Merci de votre patience, et bonne journée. » ; conclus alors sur AUTRE, en écrivant sa demande en clair ;\n- si tu ne comprends pas ce qu&#x27;on te répond, demande de reformuler UNE fois ; si tu ne comprends toujours pas, dis-le : « Je n&#x27;ai malheureusement pas bien compris votre réponse. Je préfère qu&#x27;un collègue de l&#x27;établissement vous rappelle — rien n&#x27;est changé de votre côté. » ; conclus alors sur AUTRE, sans date, en écrivant dans « notes » ce que tu as cru comprendre. Ne devine JAMAIS une issue : une réponse mal comprise et tranchée quand même est bien pire qu&#x27;un rappel ;\n- sur un répondeur, laisse un message court et SANS le motif de l&#x27;appel.\nEntre ton ouverture et ta conclusion, discute NATURELLEMENT, en t&#x27;adaptant à ce qu&#x27;on te répond : tu peux répéter, reformuler, laisser la personne t&#x27;interrompre, répondre à une question imprévue. Ne récite pas, ne conclus pas avant d&#x27;avoir une réponse claire. Avant de raccrocher, récapitule en une phrase ce qui a été convenu.':
        '.\nHow to run the conversation, in this order:\n1. start by offering THE nearest date, the one written under « first slot offered » — one date only, not the list;\n2. if it does not suit, ask which DAYS of the week would suit them;\n3. then ask whether they prefer the MORNING or the AFTERNOON;\n4. then offer ONE SINGLE time, taken from the slots available above, matching that day and that part of the day; if you have none that matches, simply say so;\n5. ⚠ on every refusal, GO BACK TO THE FILTER instead of reeling off times: ask again which days would suit them, then morning or afternoon, then offer a time. One time at a time, never a list — the person narrows it down, you do not list;\n6. after THREE refused offers, do not insist: "I do not want to keep you any longer. Since we cannot find a time that suits you, someone from the practice will call you back to agree a date with you. Thank you for your patience, and have a good day."; then conclude on OTHER, with no date.\nYour rules — what you must do, and what you are not allowed to do:\n- give no medical information, and no detail that is not written in « what you know » above;\n- invent nothing: no date, no time, no price, no name;\n- give out no telephone number;\n- never insist: a refusal is respected the first time;\n- if you are asked whether you are a robot, say so: "I am an automated assistant, but I can help you perfectly well — and reception can call you back if you prefer.";\n- if you do not have the right person: "My apologies for the disturbance, have a good day.", and conclude on OTHER;\n- repeating what you know is NEVER a reason to hand over: if you are asked to repeat the date, the time, the place, the duration or the reason, simply say them again, as often as needed — they are written in « what you know » above;\n- emergency exit — ONLY if the answer is nowhere in « what you know », or faced with an irritated person: "I would rather not tell you anything wrong: I am passing your request on to the practice, who will call you back between 9am and 7pm. Thank you for your patience, and have a good day."; then conclude on OTHER, writing their request out in plain words;\n- if you do not understand what you are told, ask for it to be rephrased ONCE; if you still do not understand, say so: "I am afraid I did not properly understand your answer. I would rather a colleague from the practice called you back — nothing has changed on your side."; then conclude on OTHER, with no date, writing in « notes » what you thought you understood. NEVER guess an outcome: an answer misunderstood and settled anyway is far worse than a call back;\n- on an answering machine, leave a short message, WITHOUT the reason for the call.\nBetween your opening and your conclusion, talk NATURALLY, adapting to what you are told: you may repeat, rephrase, let the person interrupt you, answer an unexpected question. Do not recite, do not conclude before you have a clear answer. Before hanging up, sum up in one sentence what has been agreed.',
    '.\nComment mener l&#x27;échange, dans cet ordre :\n1. pose D&#x27;ABORD ta question et attends la réponse : sera-t-elle présente, oui ou non ? Ne cite AUCUNE date tant qu&#x27;elle n&#x27;a pas répondu ;\n2. si elle confirme sa présence, remercie et conclus : il n&#x27;y a rien d&#x27;autre à obtenir, et proposer une autre date sèmerait le doute ;\n3. si elle ne peut pas venir ET que « ce que tu sais » porte des places libres, propose-lui UNE date pour commencer — la plus proche, pas la liste ;\n4. si elle ne convient pas, demande quels JOURS de la semaine l&#x27;arrangeraient ;\n5. demande ensuite si elle préfère le MATIN ou l&#x27;APRÈS-MIDI ;\n6. propose alors UNE SEULE heure, prise dans les créneaux disponibles ci-dessus, qui corresponde à ce jour et à ce moment de la journée ; si tu n&#x27;en as aucune qui corresponde, dis-le simplement ;\n7. ⚠ à chaque refus, REPRENDS LE FILTRE au lieu d&#x27;enchaîner les heures : redemande quels jours l&#x27;arrangeraient, puis matin ou après-midi, puis propose une heure. Une heure à la fois, jamais une liste — c&#x27;est la personne qui restreint, pas toi qui énumères ;\n8. si rien ne lui convient, ou si tu n&#x27;as aucune place à proposer, dis-lui simplement que son rendez-vous est annulé et que c&#x27;est elle qui rappellera quand elle voudra.\nTes règles — ce que tu dois faire, et ce que tu n&#x27;as pas le droit de faire :\n- ne donne aucune information médicale, et aucun détail qui ne soit pas écrit dans « ce que tu sais » ci-dessus ;\n- n&#x27;invente rien : ni date, ni horaire, ni tarif, ni nom ;\n- ne communique aucun numéro de téléphone ;\n- n&#x27;insiste jamais : un refus se respecte dès la première fois ;\n- si on te demande si tu es un robot, dis-le : « Je suis un assistant automatique, mais je peux tout à fait vous aider — et le secrétariat peut vous rappeler si vous préférez. » ;\n- si tu n&#x27;as pas la bonne personne : « Toutes mes excuses pour le dérangement, bonne journée. », et conclus sur AUTRE ;\n- redire ce que tu sais n&#x27;est JAMAIS une raison de passer la main : si on te demande de répéter la date, l&#x27;heure, le lieu, la durée ou le motif, redis-les simplement, aussi souvent qu&#x27;il le faut — ils sont écrits dans « ce que tu sais » ci-dessus ;\n- sortie de secours — UNIQUEMENT si la réponse ne se trouve nulle part dans « ce que tu sais », ou devant une personne agacée : « Je préfère ne pas vous dire de bêtise : je transmets votre demande à l&#x27;établissement, qui vous rappellera entre 9h00 et 19h00. Merci de votre patience, et bonne journée. » ; conclus alors sur AUTRE, en écrivant sa demande en clair ;\n- si tu ne comprends pas ce qu&#x27;on te répond, demande de reformuler UNE fois ; si tu ne comprends toujours pas, dis-le : « Je n&#x27;ai malheureusement pas bien compris votre réponse. Je préfère qu&#x27;un collègue de l&#x27;établissement vous rappelle — rien n&#x27;est changé de votre côté. » ; conclus alors sur AUTRE, sans date, en écrivant dans « notes » ce que tu as cru comprendre. Ne devine JAMAIS une issue : une réponse mal comprise et tranchée quand même est bien pire qu&#x27;un rappel ;\n- sur un répondeur, laisse un message court et SANS le motif de l&#x27;appel.\nEntre ton ouverture et ta conclusion, discute NATURELLEMENT, en t&#x27;adaptant à ce qu&#x27;on te répond : tu peux répéter, reformuler, laisser la personne t&#x27;interrompre, répondre à une question imprévue. Ne récite pas, ne conclus pas avant d&#x27;avoir une réponse claire. Avant de raccrocher, récapitule en une phrase ce qui a été convenu.':
        '.\nHow to run the exchange, in this order:\n1. FIRST ask your question and wait for the answer: will they be there, yes or no? Do not mention ANY date until they have answered;\n2. if they confirm they will be there, thank them and conclude: there is nothing else to obtain, and offering another date would sow doubt;\n3. if they cannot come AND « what you know » lists free slots, offer them ONE date to start with — the nearest one, not the list;\n4. if it does not suit them, ask which DAYS of the week would suit them;\n5. then ask whether they prefer the MORNING or the AFTERNOON;\n6. then offer A SINGLE time, taken from the available slots above, matching that day and that part of the day; if you have none that matches, simply say so;\n7. ⚠ at each refusal, START THE FILTER AGAIN instead of reeling off times: ask again which days would suit them, then morning or afternoon, then offer one time. One time at a time, never a list — the person narrows it down, you do not list;\n8. if nothing suits them, or if you have no slot to offer, simply tell them that their appointment is cancelled and that they will call back whenever they want.\nYour rules — what you must do, and what you are not allowed to do:\n- give no medical information, and no detail that is not written in « what you know » above;\n- invent nothing: no date, no time, no price, no name;\n- give out no phone number;\n- never insist: a refusal is respected the first time;\n- if you are asked whether you are a robot, say so: « I am an automated assistant, but I can certainly help you — and the office can call you back if you prefer. » ;\n- if you do not have the right person: « My apologies for the disturbance, have a good day. », and conclude with AUTRE;\n- repeating what you know is NEVER a reason to hand over: if you are asked to repeat the date, the time, the place, the length or the reason, simply say them again, as often as needed — they are written in « what you know » above;\n- emergency exit — ONLY if the answer is nowhere in « what you know », or faced with an annoyed person: « I would rather not tell you something wrong: I am passing your request to the practice, who will call you back between 9h00 and 19h00. Thank you for your patience, and have a good day. » ; then conclude with AUTRE, writing their request out in plain words;\n- if you do not understand what you are told, ask for it to be rephrased ONCE; if you still do not understand, say so: « I am afraid I did not understand your answer properly. I would rather a colleague from the practice called you back — nothing has changed on your side. » ; then conclude with AUTRE, with no date, writing in « notes » what you thought you understood. NEVER guess an outcome: an answer misunderstood and settled anyway is far worse than a callback;\n- on an answering machine, leave a short message and WITHOUT the reason for the call.\nBetween your opening and your conclusion, talk NATURALLY, adapting to what you are told: you may repeat, rephrase, let the person interrupt you, answer an unexpected question. Do not recite, and do not conclude before you have a clear answer. Before hanging up, sum up in one sentence what has been agreed.',
    '.\nTes règles — ce que tu dois faire, et ce que tu n&#x27;as pas le droit de faire :\n- ne donne aucune information médicale, et aucun détail qui ne soit pas écrit dans « ce que tu sais » ci-dessus ;\n- n&#x27;invente rien : ni date, ni horaire, ni tarif, ni nom ;\n- ne communique aucun numéro de téléphone ;\n- n&#x27;insiste jamais : un refus se respecte dès la première fois ;\n- si on te demande si tu es un robot, dis-le : « Je suis un assistant automatique, mais je peux tout à fait vous aider — et le secrétariat peut vous rappeler si vous préférez. » ;\n- si tu n&#x27;as pas la bonne personne : « Toutes mes excuses pour le dérangement, bonne journée. », et conclus sur AUTRE ;\n- redire ce que tu sais n&#x27;est JAMAIS une raison de passer la main : si on te demande de répéter la date, l&#x27;heure, le lieu, la durée ou le motif, redis-les simplement, aussi souvent qu&#x27;il le faut — ils sont écrits dans « ce que tu sais » ci-dessus ;\n- sortie de secours — UNIQUEMENT si la réponse ne se trouve nulle part dans « ce que tu sais », ou devant une personne agacée : « Je préfère ne pas vous dire de bêtise : je transmets votre demande à l&#x27;établissement, qui vous rappellera entre 9h00 et 19h00. Merci de votre patience, et bonne journée. » ; conclus alors sur AUTRE, en écrivant sa demande en clair ;\n- si tu ne comprends pas ce qu&#x27;on te répond, demande de reformuler UNE fois ; si tu ne comprends toujours pas, dis-le : « Je n&#x27;ai malheureusement pas bien compris votre réponse. Je préfère qu&#x27;un collègue de l&#x27;établissement vous rappelle — rien n&#x27;est changé de votre côté. » ; conclus alors sur AUTRE, sans date, en écrivant dans « notes » ce que tu as cru comprendre. Ne devine JAMAIS une issue : une réponse mal comprise et tranchée quand même est bien pire qu&#x27;un rappel ;\n- sur un répondeur, laisse un message court et SANS le motif de l&#x27;appel.\nEntre ton ouverture et ta conclusion, discute NATURELLEMENT, en t&#x27;adaptant à ce qu&#x27;on te répond : tu peux répéter, reformuler, laisser la personne t&#x27;interrompre, répondre à une question imprévue. Ne récite pas, ne conclus pas avant d&#x27;avoir une réponse claire. Avant de raccrocher, récapitule en une phrase ce qui a été convenu.':
        '.\nYour rules — what you must do, and what you are not allowed to do:\n- give no medical information, and no detail that is not written in « what you know » above;\n- invent nothing: no date, no time, no price, no name;\n- give out no phone number;\n- never insist: a refusal is respected the first time;\n- if you are asked whether you are a robot, say so: « I am an automated assistant, but I can certainly help you — and the office can call you back if you prefer. » ;\n- if you do not have the right person: « My apologies for the disturbance, have a good day. », and conclude with AUTRE;\n- repeating what you know is NEVER a reason to hand over: if you are asked to repeat the date, the time, the place, the length or the reason, simply say them again, as often as needed — they are written in « what you know » above;\n- emergency exit — ONLY if the answer is nowhere in « what you know », or faced with an annoyed person: « I would rather not tell you something wrong: I am passing your request to the practice, who will call you back between 9h00 and 19h00. Thank you for your patience, and have a good day. » ; then conclude with AUTRE, writing their request out in plain words;\n- if you do not understand what you are told, ask for it to be rephrased ONCE; if you still do not understand, say so: « I am afraid I did not understand your answer properly. I would rather a colleague from the practice called you back — nothing has changed on your side. » ; then conclude with AUTRE, with no date, writing in « notes » what you thought you understood. NEVER guess an outcome: an answer misunderstood and settled anyway is far worse than a callback;\n- on an answering machine, leave a short message and WITHOUT the reason for the call.\nBetween your opening and your conclusion, talk NATURALLY, adapting to what you are told: you may repeat, rephrase, let the person interrupt you, answer an unexpected question. Do not recite, and do not conclude before you have a clear answer. Before hanging up, sum up in one sentence what has been agreed.',
    ".\nVous obtenez un fichier ; c'est lui qu'on charge ici.":
        '.\nYou get a file; that is what you load here.',
    ". (C'est CALL-E qui dira si elle est valable ; ce contrôle ne juge que la forme.)":
        '. (CALL-E will say whether it is valid; this check only judges the form.)',
    '. Aucun contact ne sera appelé sur son propre numéro.':
        '. No contact will be called on their own number.',
    ". Aucun de vos réglages n'a été touché.":
        '. None of your settings were touched.',
    ". C'est enregistré, merci !":
        ". It's noted, thank you!",
    '. Ce qui a été fourni :':
        '. What was supplied:',
    '. Ce rendez-vous demande':
        '. This appointment needs',
    '. Cela vous intéresse-t-il ?':
        '. Would you be interested?',
    ". Choisissez un créneau assez long, ou élargissez les horaires d'ouverture dans « ⚙ Réglages ».":
        '. Choose a long enough slot, or widen the opening hours in « ⚙ Settings ».',
    ". Dès qu'une personne\naccepte, la cascade":
        '. As soon as someone\naccepts, the cascade',
    '. En mode simplifié elles restent celles-là — elles ne\n  sont pas perdues, seulement pas montrées.':
        '. In simplified mode they stay the same — they are not\n  lost, only hidden.',
    ". La campagne s'est arrêtée là :":
        '. The campaign stopped there:',
    ". La chaîne s'arrête d'elle-même.":
        '. The chain stops on its own.',
    '. Les dates sont acceptées sous\n  trois formats, les numéros avec points ou espaces.':
        '. Dates are accepted in\n  three formats, numbers with dots or spaces.',
    ". Mettez-les en pause ou arrêtez-les d'abord — un appel déjà lancé va toujours à son terme, et effacer une campagne en vol retirerait les lignes sous son propre fil.":
        '. Pause or stop them first — a call already started always runs to its end, and deleting a campaign in flight would pull the rows out from under its own thread.',
    ". Ouvre l'assistant à l'étape 2, la liste déjà remplie — aucun appel n'est passé.":
        '. Opens the wizard at step 2, with the list already filled in — no call is made.',
    ". Si ces dates ne sont plus libres dans votre vrai planning, n'allez pas plus loin.":
        '. If these dates are no longer free in your real schedule, go no further.',
    '. Une personne\nqui refuse ou ne répond pas passe la main à la suivante ; une personne qui\npréfère une autre date obtient un rendez-vous à cette date (le créneau reste à\npourvoir et la cascade continue).':
        '. Someone\nwho declines or does not answer hands over to the next one; someone who\nprefers another date gets an appointment on that date (the slot stays to\nfill and the cascade continues).',
    '. Une seule sera retenue.':
        '. Only one will be kept.',
    ". Vous la verrez et pourrez la corriger à l'étape 3. Aucun appel n'a été passé.":
        '. You will see it and can correct it at step 3. No call has been made.',
    '. Vous pouvez la modifier ou la réordonner à la main avant de lancer.':
        '. You can edit it or reorder it by hand before launching.',
    ". Vous préférez ne rien écrire sur le\ndisque ? Posez la variable d'environnement":
        '. Would you rather write nothing to\ndisk? Set the environment variable',
    ". État « prête » : aucun appel n'est parti, c'est à vous de la valider.":
        '. Status « ready »: no call has gone out, it is up to you to validate it.',
    '0 page(s) réglée(s) sur 21.':
        '0 of 21 pages set.',
    '1 tranche de 15 min (15 minutes)':
        '1 block of 15 min (15 minutes)',
    '1) TA PRÉSENTATION — dis-la telle quelle en ouvrant, mot pour mot :':
        '1) YOUR INTRODUCTION — say it as is when you open, word for word:',
    '1. La nature':
        '1. The nature',
    '10 par page':
        '10 per page',
    '100 par page':
        '100 per page',
    '112 rendez-vous':
        '112 appointments',
    '128 jours ouvrés':
        '128 working days',
    "178 jours d'ici":
        '178 days from now',
    '2) TON OBJECTIF ET TON CONTEXTE — ensuite, tu discutes librement, en français.':
        '2) YOUR GOAL AND YOUR CONTEXT — then, you talk freely, in French.',
    '2. Le message':
        '2. The script',
    '25 par page':
        '25 per page',
    "3) LES ISSUES — tu dois conclure sur l'une de ces trois-là, et sur aucune autre :":
        '3) THE OUTCOMES — you must conclude on one of these three, and on no other:',
    '3. Les personnes':
        '3. The people',
    '30 minutes':
        '30 minutes',
    '304 rendez-vous':
        '304 appointments',
    '50 par page':
        '50 per page',
    '75 contacts':
        '75 contacts',
    ":\n  c'est leur but, à votre demande. Le CSV est généré à la volée et n'est jamais\n  écrit sur le serveur. Les clients sans numéro sont exclus.":
        ':\n  that is their purpose, at your request. The CSV is generated on the fly and is never\n  written to the server. Contacts without a number are excluded.',
    ":\n  l'agent n'annonce jamais une place déjà prise, et jamais une date obtenue\n  par formule. Vide, la phrase qui l'annonce tombe d'elle-même — rien n'est\n  inventé. Le texte du message change selon cette case : regardez l'aperçu\n  en haut de page.":
        ':\n  the agent never announces a slot already taken, and never a date obtained\n  by formula. Left empty, the sentence announcing it drops on its own — nothing is\n  invented. The script text changes with this box: look at the preview\n  at the top of the page.',
    ":\n  sonnerie, échange, puis le temps que CALL-E rédige son compte rendu. Trop\n  courtes, RingBack abandonne alors que la personne est encore au téléphone —\n  c'est ce qui s'est produit le 01/08/2026.":
        ':\n  ringing, conversation, then the time CALL-E needs to write its report. Too\n  short, and RingBack gives up while the person is still on the phone —\n  that is what happened on 01/08/2026.',
    ":\n  toutes les pages repassent « à configurer », et il suffit ensuite\n  d'":
        ':\n  every page goes back to « to configure », and you then only need\n  to',
    ': 2 colonnes attendues (Nom;Téléphone),':
        ': 2 columns expected (Nom;Téléphone),',
    ': RingBack garde son numéro chez CALL-E, le contact passe':
        ': RingBack keeps their number at CALL-E, the contact switches to',
    ": RingBack ne connaît pas la signification de ce code et ne l'invente pas.":
        ': RingBack does not know what this code means and does not invent it.',
    ': aucun appel ne lui sera passé.\nLe drapeau se lève depuis la page':
        ': no call will be made to them.\nThe flag is raised from the page',
    ': aucun séparateur trouvé (point-virgule, virgule ou tabulation) — attendu «':
        ': no separator found (semicolon, comma or tab) — expected «',
    ": c'est votre\ndécision, jour par jour — certains cabinets travaillent le 11 novembre.":
        ': that is your\ndecision, day by day — some practices work on 11 November.',
    ": c'est votre téléphone qui sonne, à chaque appel de la\ncampagne. Et":
        ': it is your phone that rings, on every call in the\ncampaign. And',
    ": ce sont les seuls qui occupent une place.\nUn rendez-vous annulé, déplacé, manqué ou ignoré a rendu ses tranches, il\nn'apparaît donc pas ici mais dans la liste ci-dessous.":
        ': these are the only ones taking up a slot.\nAn appointment that is cancelled, moved, missed or ignored has given its blocks back, so it\ndoes not appear here but in the list below.',
    ': créer une campagne,\ncharger la liste des personnes, appuyer sur ▶ Démarrer. RingBack appelle,\nécoute, et écrit lui-même les résultats dans votre agenda.':
        ': create a campaign,\nload the list of people, press ▶ Start. RingBack calls,\nlistens, and writes the results into your calendar itself.',
    ': donnez un nombre de secondes entier (reçu «':
        ': give a whole number of seconds (received «',
    ": elle est\n  rejouée chaque fois que la campagne passe à la place suivante, si bien que\n  chaque place s'adresse à ceux qu'elle intéresse vraiment.":
        ': it is\n  replayed each time the campaign moves to the next slot, so that\n  each slot goes to those it really suits.',
    ': elle gagne contre le\nfichier.':
        ': it takes precedence over the\nfile.',
    ": elles n'ont rien à gagner ni à\n    perdre, n'importe quelle place les arrange. Le temps gagné ne se calcule\n    donc pas ici.":
        ': they have nothing to gain or\n    lose, any slot suits them. So the time saved is not\n    computed here.',
    ': en mode réel, vos contacts sont appelés sur leur propre numéro.':
        ': in real mode, your contacts are called on their own number.',
    ': est-ce que cela vous convient ?':
        ': does that work for you?',
    ': il est juste quel que soit\nle jour où vous le téléchargez. Trois autres agendas sont livrés en fichier\n(':
        ': it is correct whatever\nday you download it. Three other calendars are supplied as files\n(',
    ': il est repris ici comme premier testeur, nommé\n«':
        ': it is reused here as the first tester, named\n«',
    ': il est repris ici comme premier testeur, nommé\n« moi » — rien à retaper. Pour le renommer,\nretirez-le et ajoutez-le à nouveau.':
        ': it is carried over here as the first tester, named\n« me » — nothing to retype. To rename it,\nremove it and add it again.',
    ': il manque':
        ': missing',
    ": il ne fait que\nLIRE, chez CALL-E, le résultat d'appels déjà passés, puis l'applique comme si\nla réponse était arrivée à temps. Si un appel est encore en cours, il vous le\ndira et n'écrira rien.":
        ': all it does is\nREAD, from CALL-E, the outcome of calls already made, then apply it as if\nthe answer had arrived in time. If a call is still running, it will tell you\nand write nothing.',
    ": ils n'ont pas refusé le cabinet, c'est à un humain de les rappeler.":
        ': they have not refused the practice, it is up to a human to call them back.',
    ": information\nmanquante — un ⚠ bloque le passage à l'étape 3.":
        ': missing\ninformation — a ⚠ blocks the move to step 3.',
    ": l'agent dit\ntoujours « Bonjour madame Duval », avec son motif et son rendez-vous. Vous\nentendez donc":
        ': the agent always\nsays « Hello Mrs Duval », with their reason and their appointment. So you\nhear',
    ": l'agent ne l'appellera pas — elle partira vers un rappel par un humain":
        ': the agent will not call them — they will go to a human callback',
    ": l'agent ne les appellera pas — elles partiront vers un rappel par un humain":
        ': the agent will not call them — they will go to a human callback',
    ": l'installeur ne s'ouvre plus tout seul.":
        ': the installer no longer opens by itself.',
    ': la colonne Identité ci-dessous dit qui joue quoi (le prénom rappelle le rôle), et ⚙ Réglages dit quel testeur porte quel numéro. Les appels restent':
        ': the Identity column below says who plays what (the first name recalls the role), and ⚙ Settings says which tester carries which number. Calls remain',
    ": la suivante peut très bien intéresser quelqu'un. Pour choisir les personnes vous-même, créez une campagne en mode":
        ': the next one may well suit someone. To pick the people yourself, create a campaign in',
    ': la valeur doit être comprise entre':
        ': the value must be between',
    ": le contact demande quelque chose qu'une machine ne tranche pas. Et":
        ': the contact asks for something a machine cannot settle. And',
    ': le créneau lui est attribué et\nles personnes suivantes ne sont':
        ': the slot is assigned to them and\nthe following contacts are',
    ': le geste reste le bouton de la page':
        ': the action is still the button on the page',
    ': le retrait ne supprime que les fiches 🧪.':
        ': removal deletes only the 🧪 records.',
    ": les créneaux annoncés sortent de l'agenda de RingBack":
        ": the slots announced come from RingBack's calendar",
    ": leurs numéros sont à compléter dans la grille de l'étape 3":
        ': their numbers must be filled in on the step 3 grid',
    ': même numéro que':
        ': same number as',
    ': même numéro que la ligne':
        ': same number as line',
    ": ouverte à la semaine type,\nlibre de tout rendez-vous, un jour qui n'est pas fermé.":
        ': open in the standard week,\nfree of any appointment, on a day that is not closed.',
    ': quels que soient les numéros ci-dessus, tous les appels iront vers':
        ': whatever the numbers above, every call will go to',
    ': relancez avec':
        ': relaunch with',
    ": rempli pour chaque contact à\nl'étape 3, au moment de l'appel (une phrase dont le champ facultatif reste\nvide est simplement omise). Les civilités sont développées ici comme elles\nle seront au téléphone (« M. » se dit « monsieur ») ; vos fiches, elles, ne\nchangent pas.":
        ': filled in for each contact at\nstep 3, at call time (a sentence whose optional field stays\nempty is simply dropped). Titles are spelled out here as they\nwill be on the phone (« M. » is read out as « monsieur »); your records\ndo not change.',
    ": son numéro est à compléter dans la grille de l'étape 3":
        ': their number must be filled in on the step 3 grid',
    ': séparateur introuvable — attendu « Nom;Téléphone » (ou virgule, ou tabulation).':
        ': separator not found — expected « Nom;Téléphone » (or comma, or tab).',
    ': tout le monde ; non-réponse → relance — imposée par la nature, elle ne se règle pas.':
        ': everyone; no answer → follow-up — imposed by its nature, not adjustable.',
    ': tout le monde ; pas joint → relance, origine conservée — imposée par la nature, elle ne se règle pas.':
        ': everyone; not reached → follow-up, source kept — imposed by its nature, not adjustable.',
    ': tout le monde est appelé — imposée par la nature, elle ne se règle pas.':
        ': everyone is called — imposed by its nature, not adjustable.',
    ': un seul téléphone sonne à la fois, ils doivent donc être disponibles ensemble.':
        ': only one phone rings at a time, so they must be available together.',
    ": un seul téléphone sonne à la fois, vos testeurs\ndoivent donc être disponibles ensemble. La marche à suivre, ce qu'il faut\ndire au téléphone pour produire chaque issue et ce qu'il faut vérifier\nensuite sont écrits dans":
        ': only one phone rings at a time, so your testers\nmust be available together. The steps to follow, what to\nsay on the phone to produce each outcome and what to check\nafterwards are written in',
    ": « toujours utiliser mon numéro » est coché, mais le numéro enregistré n'est pas composable. RingBack refuse d'appeler vos contacts à sa place.":
        ': « always use my number » is ticked, but the saved number cannot be dialled. RingBack refuses to call your contacts instead.',
    '> non traité':
        '> not handled',
    '> 🚫 ne plus appeler':
        '> 🚫 do not call again',
    '>Tous les états':
        '>All statuses',
    '>après un délai (heures ouvrées)':
        '>after a delay (business hours)',
    '>dans un créneau de rappel\n      (ex. la pause déjeuner du contact)':
        ">in a callback slot\n      (e.g. the contact's lunch break)",
    '>🚫 contact par\n        agent interdit':
        '>🚫 agent contact\n        not allowed',
    '? Oui, ça tombe bien, je le prends !':
        "? Yes, good timing, I'll take it!",
    'A. Informations générales':
        'A. General information',
    'ACTIVÉ — aucun contact ne sera appelé en mode réel':
        'ENABLED — no contact will be called in real mode',
    'API keys':
        'API keys',
    'APPELER':
        'CALL',
    'ATTENTION : --appels-reels demandé. Les appels partiront VRAIMENT.':
        'WARNING: --appels-reels requested. Calls will REALLY go out.',
    'AUCUN APPEL NE PART DE CE BOUTON.':
        'NO CALL GOES OUT FROM THIS BUTTON.',
    'AUCUN APPEL NE PEUT PARTIR':
        'NO CALL CAN GO OUT',
    'Abandon (maximum de tentatives atteint)':
        'Given up (maximum attempts reached)',
    'Accepté — créneau attribué':
        'Accepted — slot assigned',
    'Action définitive.':
        'Permanent action.',
    "Action inconnue pour le jeu d'essai (attendu « charger » ou « retirer »).":
        'Unknown action for the test data (expected « charger » or « retirer »).',
    'Action non confirmée.':
        'Action not confirmed.',
    'Action refusée :':
        'Action refused:',
    "Actualisez l'accueil":
        'Refresh the home page',
    "Adresse de l'API :":
        'API address:',
    'Afficher cette semaine':
        'Show this week',
    "Afficher l'interface en français":
        'Show the interface in French',
    'Agenda':
        'Schedule',
    'Agenda : ⚠ absent à son rendez-vous':
        'Schedule: ⚠ missed their appointment',
    'Agenda chargé :':
        'Calendar loaded:',
    "Agenda d'exemple engendré : %d événement(s) — données fictives":
        'Sample calendar generated: %d event(s) — fictitious data',
    'Agent':
        'Agent',
    'Agent :':
        'Agent:',
    'Agent : Bien sûr, je note':
        "Agent: Of course, I'll note",
    'Agent : Bien sûr, je transmets votre demande. Bonne journée !':
        "Agent: Of course, I'll pass on your request. Have a good day!",
    'Agent : Bien sûr, nous vous rappellerons. Bonne journée !':
        "Agent: Of course, we'll call you back. Have a good day!",
    'Agent : Bonjour':
        'Agent: Hello',
    "Agent : C'est noté, votre rendez-vous est confirmé. À bientôt !":
        'Agent: Noted, your appointment is confirmed. See you soon!',
    "Agent : Je n'ai malheureusement pas bien compris votre réponse. Je préfère qu'un collègue vous rappelle — rien n'est changé de votre côté.":
        "Agent: Unfortunately I didn't quite understand your answer. I'd rather a colleague call you back — nothing is changed on your side.",
    'Agent : Parfait, le créneau est pour vous. À bientôt !':
        'Agent: Perfect, the slot is yours. See you soon!',
    "Agent : Très bien, c'est noté. Bonne journée !":
        'Agent: Very well, noted. Have a good day!',
    'Agent : Très bien, merci pour votre réponse. Bonne journée !':
        'Agent: Very well, thank you for your answer. Have a good day!',
    'Ajouter aux jours fermés':
        'Add to closing days',
    'Ajouter ce testeur':
        'Add this tester',
    'Ajouter ces personnes à la grille':
        'Add these people to the grid',
    'Ajouter cette place à la liste':
        'Add this slot to the list',
    'Ajouter le créneau':
        'Add the slot',
    'Ajouter quand même':
        'Add anyway',
    'Ajouter un autre rendez-vous':
        'Add another appointment',
    'Ajouter un créneau à la main — cas particulier (date et heure)':
        'Add a slot manually — special case (date and time)',
    'Ajouter un rendez-vous':
        'Add an appointment',
    'Ajouter un rendez-vous — RingBack':
        'Add an appointment — RingBack',
    "Aller au réglage\n🧪 Testeurs de l'essai réel":
        'Go to the setting\n🧪 Testers for the real test',
    'Aller à cette date':
        'Go to this date',
    'Aller à une date (AAAA-MM-JJ, par exemple':
        'Go to a date (YYYY-MM-DD, for example',
    'Aller à une date (AAAA-MM-JJ, par exemple 2026-09-01)':
        'Go to a date (YYYY-MM-DD, for example 2026-09-01)',
    'Alors, puis-je noter que vous serez bien là ?':
        'So, can I note that you will be there?',
    'Alphabétique — par nom':
        'Alphabetical — by name',
    'Ancienne date':
        'Previous date',
    'Ancienneté — le rendez-vous concerné le plus ancien d&#x27;abord':
        'Age — the oldest affected appointment first',
    'Anglais':
        'English',
    'Annulation':
        'Cancellation',
    'Annulation et remplacement':
        'Cancellation and replacement',
    "Annule d'un coup tous les appels en attente, avant exécution":
        'Cancels all pending calls at once, before they run',
    'Annule les relances restantes de cette campagne':
        'Cancels the remaining follow-ups of this campaign',
    'Annuler':
        'Cancel',
    'Annuler ce rendez-vous — libérer':
        'Cancel this appointment — free up',
    'Annuler ce rendez-vous — libérer\n  1 tranche de 15 min (15 minutes)':
        'Cancel this appointment — free up\n  1 block of 15 min (15 minutes)',
    'Annuler — revenir au formulaire':
        'Cancel — back to the form',
    'Annuler — revenir aux réglages':
        'Cancel — back to settings',
    'Annuler — revenir à la liste des contacts':
        'Cancel — back to the contact list',
    'Annulé':
        'Cancelled',
    'Annulé par le client':
        'Cancelled by the contact',
    "Annulé pendant l'appel — c'est le client qui nous rappellera : aucune relance, aucune campagne":
        'Cancelled during the call — the contact will call us back: no follow-up, no campaign',
    'Annulés (par le client)':
        'Cancelled (by the contact)',
    'Année':
        'Year',
    'Appel':
        'Call',
    'Appel RÉEL vers %s (%s)':
        'REAL call to %s (%s)',
    'Appel SIMULÉ vers %s (%s)':
        'SIMULATED call to %s (%s)',
    'Appel cascade RÉEL vers %s (%s)':
        'REAL cascade call to %s (%s)',
    'Appel cascade SIMULÉ vers %s (%s)':
        'SIMULATED cascade call to %s (%s)',
    'Appel impossible':
        'Call not possible',
    'Appel interrompu — %s':
        'Call interrupted — %s',
    'Appel introuvable dans la file (déjà exécuté ou déjà retiré).':
        'Call not found in the queue (already run or already removed).',
    'Appel n°':
        'Call no.',
    'Appel n°%d NON composé : %s':
        'Call #%d NOT dialled: %s',
    "Appel n°%d abandonné : le rendez-vous n'existe plus":
        'Call no.%d dropped: the appointment no longer exists',
    'Appel n°%d annulé avant exécution':
        'Call no.%d cancelled before it ran',
    'Appel n°%d en échec : %s':
        'Call no.%d failed: %s',
    'Appel n°%d en échec : aucun numéro pour %s (à compléter avant de rappeler)':
        'Call no.%d failed: no number for %s (fill it in before calling back)',
    'Appel n°%d mis en file pour %s (%s)':
        'Call no.%d queued for %s (%s)',
    'Appel refusé : il est':
        'Call refused: it is',
    'Appel retiré de la file : il ne sera pas passé.':
        'Call removed from the queue: it will not be placed.',
    'Appeler':
        'Call',
    'Appeler de nouveau':
        'Call again',
    'Appels en attente (':
        'Pending calls (',
    'Appels en attente (0)':
        'Calls waiting (0)',
    'Apr':
        'Apr',
    'April':
        'April',
    'Armistice 1918':
        'Armistice Day',
    'Arrêt demandé.':
        'Stop requested.',
    'Ascension':
        'Ascension Day',
    "Assistant : passage à l'étape ③ REFUSÉ (%d ⛔/erreur)":
        'Assistant\\: move to step ③ REFUSED (%d ⛔/error)',
    'Assistant : validation de la grille REFUSÉE (%d erreur(s))':
        'Assistant\\: grid validation REFUSED (%d error(s))',
    'Assomption':
        'Assumption',
    "Attente maximale d'un appel":
        'Maximum wait for a call',
    "Attention : l'appel avait DÉJÀ été lancé quand la panne est survenue — le téléphone a pu sonner et cet appel a pu être facturé. Vérifiez avant de rappeler cette personne.":
        'Warning: the call had ALREADY been started when the failure occurred — the phone may have rung and this call may have been billed. Check before calling this person back.',
    "Attention notez que les rendez-vous importés remplacent les rendez-vous de votre agenda s'ils sont sur le même créneau horaire.":
        'Warning: imported appointments replace the appointments in your calendar when they fall on the same time slot.',
    'Au jour':
        'To',
    'Au maximum, combien de personnes':
        'At most, how many people',
    "Au téléphone, l'agent proposera les places libres":
        'On the phone, the agent will offer the free slots',
    'Aucun':
        'None',
    "Aucun appel en attente de résultat : il n'y avait rien à récupérer.":
        'No call awaiting a result: there was nothing to fetch.',
    "Aucun appel n'est parti : c'est ▶ Démarrer qui décide.":
        'No call has gone out: ▶ Start decides that.',
    "Aucun appel ne part d'ici : le bouton ouvre l'assistant avec\nle créneau déjà rempli, à l'étape 2. C'est vous qui validez, puis qui\ndémarrez.":
        'No call goes out from here: the button opens the wizard with\nthe slot already filled in, at step 2. You confirm, then you\nstart.',
    "Aucun appel ne part d'ici.":
        'No call goes out from here.',
    "Aucun appel ne part de ces boutons : ils ouvrent l'assistant à":
        'No call goes out from these buttons: they open the wizard at',
    'Aucun appel passé pour ce rendez-vous.':
        'No call made for this appointment.',
    'Aucun candidat trouvé depuis cette source — la liste est restée vide.':
        'No candidate found from this source — the list stayed empty.',
    "Aucun changement à reporter pour l'instant — rien n'a encore bougé dans\nle planning à cause de cette campagne.":
        'No change to carry over for now — nothing has moved in\nthe schedule because of this campaign yet.',
    "Aucun changement à reporter pour l'instant.":
        'No change to report for now.',
    'Aucun client ne correspond à ce filtre. Videz-le pour revoir toute la liste.':
        'No contact matches this filter. Clear it to see the whole list again.',
    'Aucun contact dans cette campagne.':
        'No contact in this campaign.',
    "Aucun contact de cette campagne n'est dans cet état — choisissez un autre état, ou une autre campagne.":
        'No contact in this campaign is in that state — choose another state, or another campaign.',
    "Aucun contact en base pour l'instant.":
        'No contact in the database for now.',
    'Aucun contact trouvé depuis cette source.':
        'No contact found from this source.',
    'Aucun créneau : la semaine type est vide. Ouvrez des heures dans':
        'No slot: the standard week is empty. Open some hours in',
    'Aucun créneau libre sur les':
        'No free slot in the',
    "Aucun de vos contacts\nn'est appelé":
        'None of your contacts\nis called',
    'Aucun fichier reçu — choisissez un fichier CSV.':
        'No file received — choose a CSV file.',
    'Aucun fichier reçu — choisissez un fichier ICS.':
        'No file received — choose an ICS file.',
    "Aucun horaire d'ouverture n'est\nréglé : le fichier prend des plages d'exemple (9h-12h30 et 14h-18h30, du lundi\nau vendredi).":
        'No opening hours are\nset: the file uses example ranges (9h-12h30 and 14h-18h30, Monday\nto Friday).',
    "Aucun identifiant d'appel n'a été conservé pour ce contact : son résultat n'est pas récupérable ici. Regardez le tableau de bord CALL-E.":
        'No call id was kept for this contact: its result cannot be fetched here. Look at the CALL-E dashboard.',
    "Aucun jeu d'essai chargé.":
        'No test data loaded.',
    'Aucun jour coché : choisissez au moins un jour, ou revenez à « toute la semaine ».':
        'No day ticked: choose at least one day, or go back to « the whole week ».',
    'Aucun jour fermé déclaré : seule la semaine type décide.':
        'No closing day declared: only the standard week decides.',
    "Aucun jour ouvert trouvé dans les %d prochains jours (semaine type et jours fermés) : l'échéance de relance est calculée sur la seule plage d'appel %s-%s. Ouvrez des jours dans « ⚙ Réglages » pour qu'elle retombe sur un jour travaillé.":
        'No open day found in the next %d days (typical week and closing days): the follow-up due date is computed from the calling window %s-%s alone. Open days in « ⚙ Settings » so it lands on a working day.',
    'Aucun nouvel appel à mettre en file : rien de manqué, ou déjà en file.':
        'No new call to queue: nothing missed, or already queued.',
    'Aucun numéro d&#x27;essai déclaré : renseignez d&#x27;abord au moins un testeur dans « 🧪 Testeurs de l&#x27;essai réel » (⚙ Réglages), puis revenez ici. Rien n&#x27;a été créé.':
        'No test number declared: first enter at least one tester in « 🧪 Testers for the real test » (⚙ Settings), then come back here. Nothing has been created.',
    "Aucun numéro d'essai déclaré : la règle stricte du doublon s'applique à tout le monde, sans exception. Ajoutez au moins un testeur ci-dessous — le vôtre, pour commencer.":
        'No test number declared: the strict duplicate rule applies to everyone, without exception. Add at least one tester below — your own, to start with.',
    "Aucun numéro d'essai déclaré : renseignez d'abord au moins un testeur dans « 🧪 Testeurs de l'essai réel » (⚙ Réglages), puis revenez ici. Rien n'a été créé.":
        'No test number declared: first fill in at least one tester in « 🧪 Real test testers » (⚙ Settings), then come back here. Nothing was created.',
    "Aucun numéro d'essai enregistré : en mode réel, vos contacts sont appelés":
        'No test number saved: in real mode, your contacts are called',
    'Aucun numéro à composer':
        'No number to dial',
    "Aucun rappel par un humain en attente : l'agent a pu conclure tous ses appels.":
        'No callback by a human pending: the agent was able to conclude all its calls.',
    'Aucun rendez-vous':
        'No appointment',
    "Aucun rendez-vous cette semaine-là : il n'y a personne à rappeler.":
        'No appointment that week: there is no one to call back.',
    "Aucun rendez-vous de votre agenda n'a été déplacé : toutes les places importées étaient libres.":
        'No appointment in your calendar was moved: every imported slot was free.',
    "Aucun rendez-vous en base pour l'instant.":
        'No appointment in the database for now.',
    "Aucun rendez-vous n'est connu sur la période concernée : si votre planning n'est pas vide dans la vraie vie, c'est que l'agenda de RingBack n'est pas à jour.":
        "No appointment is known for that period: if your schedule is not empty in real life, then RingBack's calendar is out of date.",
    'Aucun rendez-vous pour ce client.':
        'No appointment for this contact.',
    'Aucun rendez-vous pour cette personne.':
        'No appointment for this person.',
    'Aucun rendez-vous à annuler.':
        'No appointment to cancel.',
    "Aucun résultat pour ce filtre — cette liste n'est pas vide pour autant : retirez le filtre pour la revoir en entier.":
        'No result for this filter — that does not mean the list is empty: remove the filter to see it in full.',
    "Aucun résultat à relire : ce mode ne passe pas de vrais appels (simulation). Rien n'est parti chez CALL-E, il n'y a donc rien à aller y chercher — et RingBack n'invente aucun résultat.":
        'No result to read back: this mode places no real calls (simulation). Nothing went out to CALL-E, so there is nothing to fetch there — and RingBack invents no result.',
    "Aucun testeur déclaré : renseignez d'abord « 🧪 Testeurs de l'essai réel » dans ⚙ Réglages (un nom et un numéro, le vôtre pour commencer), puis revenez ici. Sans au moins un numéro déclaré, RingBack refuse — à juste titre — plusieurs contacts portant le même numéro.":
        'No tester declared: first fill in « 🧪 Real test testers » in ⚙ Settings (a name and a number, yours to start with), then come back here. Without at least one declared number, RingBack refuses — rightly — several contacts sharing the same number.',
    'Aucun testeur déclaré. Ajoutez-en au moins un dans':
        'No tester declared. Add at least one in',
    'Aucun testeur n°':
        'No tester no.',
    'Aucune campagne en cours ne le concerne.':
        'No campaign in progress involves them.',
    "Aucune campagne pour l'instant. Une campagne, c'est une":
        'No campaign yet. A campaign is a',
    "Aucune campagne précédente n'a encore de contacts : ce filtre s'activera dès la première campagne créée.":
        'No earlier campaign has contacts yet: this filter switches on as soon as the first campaign is created.',
    'Aucune clé enregistrée — les appels sont':
        'No key saved — calls are',
    "Aucune clé n'a été collée : le champ était vide.":
        'No key was pasted: the field was empty.',
    "Aucune date exploitable n'a été rendue —":
        'No usable date was returned —',
    "Aucune demande n'a été enregistrée.":
        'No request was saved.',
    "Aucune heure d'ouverture pour l'instant : tant que la semaine type est vide, aucun créneau ne peut être calculé.":
        'No opening hours yet: while the standard week is empty, no slot can be calculated.',
    'Aucune heure à afficher : la semaine type est vide. Ouvrez des heures dans':
        'No hours to show: the standard week is empty. Open hours in',
    'Aucune personne dans la grille. Le bouton':
        'No one in the grid. The button',
    'Aucune place':
        'No slot',
    "Aucune place libre n'est calculée : l'agent n'aurait aucun créneau à annoncer au téléphone.":
        'No free slot is computed: the agent would have no slot to announce on the phone.',
    "Aucune place pour l'instant. Saisissez une date et appuyez sur « + » : la campagne proposera les places l'une après l'autre, de la plus ancienne à la plus récente.":
        'No slot for now. Enter a date and press « + »: the campaign will offer the slots one after another, from the earliest to the latest.',
    "Aucune relance n'est due pour l'instant : rien n'attend d'être lancé.":
        'No follow-up is due for now: nothing is waiting to be started.',
    "Aucune relance n'est programmée pour plus tard.":
        'No follow-up is scheduled for later.',
    "Aucune relance n'était due : rien n'a été appelé.":
        'No follow-up was due: nothing was called.',
    "Aucune semaine type n'est réglée : RingBack ne sait pas quand vous êtes ouvert, il ne peut donc calculer AUCUNE place libre.":
        'No typical week is set: RingBack does not know when you are open, so it can compute NO free slot.',
    "Aucune tentative ne lui est comptée, elle n'est PAS marquée « injoignable » et elle ne sera JAMAIS rappelée automatiquement : elle passe « à rappeler par un humain », avec sa transcription et la réponse brute de CALL-E conservées telles quelles.":
        "No attempt is counted for them, they are NOT marked « unreachable » and they will NEVER be called back automatically: they move to « to be called back by a human », with their transcript and CALL-E's raw answer kept as they are.",
    'Aug':
        'Aug',
    'August':
        'August',
    'Automatique':
        'Automatic',
    'Autoriser les appels RÉELS : exige la variable CALLE_API_KEY ET une confirmation tapée au clavier à chaque lancement.':
        'Allow REAL calls: requires the CALLE_API_KEY variable AND a typed confirmation at every launch.',
    'Autre date convenue':
        'Another date agreed',
    'Autre date convenue :':
        'Other date agreed:',
    'Autre date souhaitée en ISO 8601 quand outcome vaut « moved » ; nul sinon.':
        'Other requested date in ISO 8601 when outcome is « moved »; null otherwise.',
    'Avancement':
        'Progress',
    'Avancé':
        'Advanced',
    'Avant de démarrer':
        'Before starting',
    'Avant de reprendre':
        'Before resuming',
    'Avant la première campagne, quelques réglages. Ce ne sont pas des\nformalités :':
        'Before the first campaign, a few settings. These are not\nformalities:',
    'B. Options de comportement':
        'B. Behaviour options',
    'Basculer entre mode clair et mode sombre':
        'Switch between light and dark mode',
    'Base de données :':
        'Database:',
    'Bienvenue':
        'Welcome',
    'Bienvenue dans RingBack':
        'Welcome to RingBack',
    'Bilan des issues':
        'Outcome summary',
    'Bonjour':
        'Hello',
    'Bonjour [client], j&#x27;appelle de la part de [entreprise]. Un créneau s&#x27;est libéré [créneau]. Est-ce que cela vous intéresse ? Si cette date ne convient pas, nous avons aussi d&#x27;autres disponibilités : [créneaux_disponibles].':
        'Hello [client], I am calling on behalf of [entreprise]. A slot has become free [créneau]. Would that be of interest to you? If that date does not suit, we also have other openings: [créneaux_disponibles].',
    'Bonjour [client], je vous appelle de la part de [entreprise] pour confirmer votre rendez-vous [date_rdv]. Merci de me dire si ce créneau vous convient toujours ; sinon, je peux vous proposer [créneaux_disponibles]. En cas de besoin, vous pouvez nous rappeler [plage_rappel].':
        'Hello [client], I am calling on behalf of [entreprise] to confirm your appointment [date_rdv]. Please tell me whether that slot still suits you; if not, I can offer you [créneaux_disponibles]. If need be, you can call us back [plage_rappel].',
    'Bonjour [client], je vous appelle de la part de [entreprise]. Nous devons déplacer votre rendez-vous [date_rdv]. Je peux vous proposer les créneaux suivants : [créneaux_disponibles]. Lequel vous conviendrait ? Vous pouvez aussi nous rappeler [plage_rappel].':
        'Hello [client], I am calling on behalf of [entreprise]. We need to move your appointment [date_rdv]. I can offer you the following slots: [créneaux_disponibles]. Which one would suit you? You can also call us back [plage_rappel].',
    'Bonjour [client], je vous appelle de la part de [entreprise]. Vous aviez rendez-vous [date_rdv] et nous n&#x27;avons pas pu vous accueillir. Je vous propose de convenir d&#x27;un nouveau créneau : nos disponibilités sont [créneaux_disponibles]. Vous pouvez aussi nous rappeler [plage_rappel].':
        'Hello [client], I am calling on behalf of [entreprise]. You had an appointment [date_rdv] and we were not able to see you. I would like to arrange a new slot with you: our openings are [créneaux_disponibles]. You can also call us back [plage_rappel].',
    'Bonjour [identite], je suis l&#x27;assistant de [entreprise]. Je vous appelle au sujet de votre rendez-vous du [rdv_existant] pour [motif] : merci de me confirmer votre présence. Si vous ne pouvez plus venir, j&#x27;annule votre rendez-vous, et je ne vous propose pas d&#x27;autre date aujourd&#x27;hui : c&#x27;est vous qui nous rappelez quand vous voulez — nous ne vous relancerons pas. Puis-je compter sur votre présence, oui ou non ?':
        'Hello [identite], I am the assistant for [entreprise]. I am calling about your appointment on [rdv_existant] for [motif]: please confirm that you will be there. If you can no longer come, I will cancel your appointment, and I will not offer you another date today: you call us back whenever you want — we will not follow up. Can I count on you being there, yes or no?',
    'Bonjour [identite], je suis l&#x27;assistant de [entreprise]. Je vous appelle pour vous rappeler votre rendez-vous du [rdv_existant] pour [motif]. Pensez à : [consigne]. Si vous ne pouvez plus venir, j&#x27;annule votre rendez-vous, et je ne vous propose pas d&#x27;autre date aujourd&#x27;hui : c&#x27;est vous qui nous rappelez quand vous voulez — nous ne vous relancerons pas. Alors, puis-je noter que vous serez bien là ?':
        'Hello [identite], I am the assistant for [entreprise]. I am calling to remind you of your appointment on [rdv_existant] for [motif]. Remember to: [consigne]. If you can no longer come, I will cancel your appointment, and I will not offer you another date today: you call us back whenever you want — we will not follow up. So, can I note that you will be there?',
    'Bonjour [identite], je suis l&#x27;assistant de [entreprise]. Nous devons déplacer votre rendez-vous du [rdv_existant] pour [motif]. Quels moments vous conviendraient ?':
        'Hello [identite], I am the assistant for [entreprise]. We need to move your appointment on [rdv_existant] for [motif]. What times would suit you?',
    'Bonjour [identite], je suis l&#x27;assistant de [entreprise]. Une place s&#x27;est libérée le [creneau_libere] pour votre [motif]. Souhaitez-vous en profiter pour avancer votre rendez-vous du [rdv_existant] ?':
        'Hello [identite], I am the assistant for [entreprise]. A slot has become free on [creneau_libere] for your [motif]. Would you like to take it and bring forward your appointment on [rdv_existant]?',
    'Bonjour [identite], je suis l&#x27;assistant de [entreprise]. [origine] — je vous appelle pour fixer ce rendez-vous. Le motif noté : [motif]. J&#x27;ai comme disponibilités : [creneaux_proposes]. Qu&#x27;est-ce qui vous arrange ?':
        'Hello [identite], I am the assistant for [entreprise]. [origine] — I am calling to set up this appointment. The reason noted: [motif]. I have these openings: [creneaux_proposes]. What suits you?',
    'Brouillon introuvable.':
        'Draft not found.',
    'Brouillons':
        'Drafts',
    "C'est fait : ce rendez-vous\nest «":
        'Done: this appointment\nis «',
    "C'est prêt":
        'Ready',
    'C. Aperçu du message':
        'C. Script preview',
    'C. Aperçu du message (il se met à jour en tapant)':
        'C. Script preview (it updates as you type)',
    'CALL-E a répondu «':
        'CALL-E replied «',
    'Cahier de changements — campagne n°%s : %s pour %s (%s -> %s)':
        'Change log — campaign no.%s: %s for %s (%s -> %s)',
    'Cahier des changements —':
        'Change log —',
    'Calculés (Pâques comprise) pour la France métropolitaine.':
        'Calculated (including Easter) for mainland France.',
    'Campagne':
        'Campaign',
    'Campagne (thème conservé)':
        'Campaign (theme kept)',
    'Campagne :':
        'Campaign:',
    'Campagne arrêtée.':
        'Campaign stopped.',
    'Campagne close : ses relances planifiées sont annulées.':
        'Campaign closed: its scheduled follow-ups are cancelled.',
    "Campagne créée en état « prête » — personne n'est appelé tant que vous ne cliquez pas ▶ Démarrer.":
        'Campaign created in state « ready » — nobody is called until you click ▶ Start.',
    'Campagne d&#x27;essai réel':
        'Real test campaign',
    "Campagne d'essai réel":
        'Real test campaign',
    "Campagne de déplacement : ce rendez-vous n'a pas pu être déplacé, il est donc annulé — une nouvelle date reste à fixer":
        'Move campaign: this appointment could not be moved, so it is cancelled — a new date still has to be set',
    "Campagne démarrée : un appel à la fois, dans l'ordre choisi.":
        'Campaign started: one call at a time, in the chosen order.',
    'Campagne introuvable.':
        'Campaign not found.',
    'Campagne n°':
        'Campaign no.',
    'Campagne n°%d : %d place(s) restée(s) à pourvoir — la raison est écrite sur chacune':
        'Campaign no.%d: %d slot(s) left to fill — the reason is written on each one',
    "Campagne n°%d : %d rendez-vous ANNULÉ(S) — le déplacement n'a pas pu se faire":
        'Campaign no.%d: %d appointment(s) CancellED — the move could not be done',
    'Campagne n°%d : contact n°%d NON composé — %s (%s)':
        'Campaign #%d: contact #%d NOT dialled — %s (%s)',
    'Campagne n°%d : contact n°%d NON composé — refuse les propositions de créneau':
        'Campaign no.%d: contact no.%d NOT dialled — refuses slot offers',
    "Campagne n°%d : il reste des places, mais le message a été récrit à la main — on n'avance pas sans recaler la date annoncée":
        'Campaign no.%d: slots remain, but the script was rewritten by hand — we do not go on without realigning the announced date',
    "Campagne n°%d : incident d'exécution — mise en pause (rien d'inventé)":
        'Campaign no.%d: run failure — paused (nothing invented)',
    'Campagne n°%d : la place %s est PERDUE (prise ailleurs) — elle ne sera plus proposée (%d place(s) restante(s))':
        'Campaign no.%d: slot %s is LOST (taken elsewhere) — it will no longer be offered (%d slot(s) left)',
    "Campagne n°%d : la place du %s n'est plus disponible (%s) — aucun appel ne part pour elle":
        'Campaign no.%d: the slot of %s is no longer available (%s) — no call goes out for it',
    "Campagne n°%d : la règle de liste n'a pas pu être rejouée (%s) — la liste reste telle quelle":
        'Campaign no.%d: the list rule could not be replayed (%s) — the list stays as it is',
    "Campagne n°%d : maximum de %d appel(s) atteint — la campagne s'arrête, personne d'autre n'est composé":
        'Campaign no.%d: maximum of %d call(s) reached — the campaign stops, nobody else is dialled',
    'Campagne n°%d : objectif atteint par un résultat récupéré, %d relance(s) annulée(s)':
        'Campaign no.%d: goal reached by a fetched result, %d follow-up(s) cancelled',
    'Campagne n°%d : objectif atteint, %d relance(s) annulée(s)':
        'Campaign #%d: target reached, %d follow-up(s) cancelled',
    'Campagne n°%d : place pourvue, on passe à la suivante (%s)':
        'Campaign no.%d: slot filled, moving on to the next one (%s)',
    "Campagne n°%d : place unique — la place quittée du %s rejoint la campagne au lieu d'en préparer une autre":
        'Campaign no.%d: single slot — the slot left free on %s joins this campaign instead of starting another one',
    'Campagne n°%d : rendez-vous n°%d ANNULÉ — %s':
        'Campaign no.%d: appointment no.%d CancellED — %s',
    'Campagne n°%d : règle jouée à la création — %d personne(s)':
        'Campaign no.%d: rule run at creation — %d person(s)',
    'Campagne n°%d : règle rejouée sur la place %s — %d personne(s) ajoutée(s)':
        'Campaign no.%d: rule replayed on slot %s — %d person(s) added',
    'Campagne n°%d : récupération des résultats en attente — %d appel(s) relu(s), AUCUN appel passé':
        'Campaign no.%d: fetching pending results — %d call(s) read back, NO call placed',
    'Campagne n°%d ARRÊTÉE entre deux appels':
        'Campaign no.%d STOPPED between two calls',
    'Campagne n°%d arrêtée (aucune exécution en cours)':
        'Campaign no.%d stopped (no run in progress)',
    'Campagne n°%d close à la main (%d relance(s) annulée(s))':
        'Campaign no.%d closed by hand (%d follow-up(s) cancelled)',
    'Campagne n°%d créée : %s':
        'Campaign no.%d created: %s',
    'Campagne n°%d créée PRÊTE (nature %s, %d contact(s)) — aucun appel passé':
        'Campaign no.%d created READY (kind %s, %d contact(s)) — no call placed',
    "Campagne n°%d, contact n°%d : AUCUNE place libre à proposer — aucun appel n'est parti, aucune date inventée":
        'Campaign no.%d, contact no.%d: NO free slot to offer — no call went out, no date invented',
    'Campagne n°%d, contact n°%d : appel PARTI, résultat pas encore connu (appel CALL-E n° %s)':
        'Campaign no.%d, contact no.%d: call WENT OUT, result not known yet (CALL-E call no. %s)',
    'Campagne n°%d, contact n°%d : date convenue REFUSÉE (%s) — aucun rendez-vous créé':
        'Campaign no.%d, contact no.%d: agreed date REFUSED (%s) — no appointment created',
    'Campagne n°%d, contact n°%d : date convenue REFUSÉE (%s) — aucun rendez-vous créé, et AUCUN rappel manuel (créneau libéré)':
        'Campaign no.%d, contact no.%d: agreed date REFUSED (%s) — no appointment created, and NO manual callback (freed slot)',
    'Campagne n°%d, contact n°%d : date convenue refusée (%s)':
        'Campaign no.%d, contact no.%d: agreed date refused (%s)',
    "Campagne n°%d, contact n°%d : le message annonce des créneaux calculés et il n'en reste aucun — aucun appel n'est parti":
        'Campaign no.%d, contact no.%d: the script announces computed slots and none is left — no call went out',
    'Campagne n°%d, contact n°%d : maximum de tentatives atteint — chaîne abandonnée':
        'Campaign no.%d, contact no.%d: maximum attempts reached — chain dropped',
    'Campagne n°%d, contact n°%d : refuse les prochaines propositions de créneau':
        'Campaign no.%d, contact no.%d: refuses further slot offers',
    'Campagne n°%d, contact n°%d : relance ABANDONNÉE, aucun appel — %s':
        'Campaign no.%d, contact no.%d: follow-up DROPPED, no call — %s',
    'Campagne n°%d, contact n°%d : relance NON programmée (%s tomberait après le rendez-vous du %s)':
        'Campaign no.%d, contact no.%d: follow-up NOT scheduled (%s would fall after the appointment of %s)',
    'Campagne n°%d, contact n°%d : rendez-vous n°%d DÉPLACÉ %s -> %s':
        'Campaign no.%d, contact no.%d: appointment no.%d MOVED %s -> %s',
    'Campagne n°%d, contact n°%d : réponse non conclusive sur une place libérée — rendez-vous n°%d passé de « %s » à « confirmé »':
        'Campaign no.%d, contact no.%d: inconclusive answer on a freed slot — appointment no.%d moved from « %s » to « confirmed »',
    'Campagne n°%d, contact n°%d : échec (%s)':
        'Campaign #%d, contact #%d: failed (%s)',
    'Campagne n°%d, contact n°%d : 🚫 demandé au téléphone — fiche marquée, %d relance(s) annulée(s)':
        'Campaign no.%d, contact no.%d: 🚫 asked for on the phone — record marked, %d follow-up(s) cancelled',
    'Campagne n°%s, contact n°%s : réponse ILLISIBLE — %s':
        'Campaign no.%s, contact no.%s: UNREADABLE answer — %s',
    'Campagne pour confirmer les rendez-vous':
        'Campaign to confirm appointments',
    'Campagne pour déplacer les rendez-vous':
        'Campaign to move appointments',
    'Campagne pour rappeler les rendez-vous':
        'Campaign to remind about appointments',
    "Campagne « créneau libéré » (origine : %s) : brouillon d'assistant ouvert sur la place du %s (aucun appel)":
        '« Freed slot » campaign (origin: %s): assistant draft opened on the slot of %s (no call)',
    'Campagnes':
        'Campaigns',
    "Campagnes d'appels par thème, relances programmées":
        'Call campaigns by theme, scheduled follow-ups',
    'Campagnes effacées : %d campagne(s), %d contact(s), %d appel(s), %d relance(s), %d ligne(s) de changements, %d cascade(s)':
        'Campaigns erased: %d campaign(s), %d contact(s), %d call(s), %d follow-up(s), %d change line(s), %d cascade(s)',
    'Campagnes en cours':
        'Campaigns in progress',
    'Campagnes en cours qui le concernent :':
        'Running campaigns involving them:',
    'Campagnes —':
        'Campaigns —',
    'Campagnes — RingBack':
        'Campaigns — RingBack',
    'Cascade : %d contact(s) écarté(s) par le plafond de %s personne(s), repris de la campagne n°%d':
        'Cascade: %d contact(s) set aside by the cap of %s person(s), taken from campaign no.%d',
    'Cascade : ancien rendez-vous n°%d de %s passé « %s » (%s)':
        'Cascade: former appointment no.%d of %s moved to « %s » (%s)',
    "Cascade : campagne n°%d PRÉPARÉE (prête, maillon %d/%d) sur la place du %s libérée par %s — %d contact(s) retenu(s), %d écarté(s) parce qu'antérieur(s), %d sans date ; aucun appel n'est parti":
        'Cascade: campaign no.%d PREPARED (ready, link %d/%d) on the slot of %s freed by %s — %d contact(s) kept, %d set aside as earlier, %d with no date; no call went out',
    'Cascade introuvable.':
        'Cascade not found.',
    'Cascade n°':
        'Cascade #',
    'Cascade n°%d : créneau attribué au rang %d (rendez-vous n°%d)':
        'Cascade no.%d: slot given to rank %d (appointment no.%d)',
    "Cascade n°%d : l'appel du rang %d EST PARTI, son résultat n'est pas connu (appel CALL-E n° %s)":
        'Cascade no.%d: the call at rank %d WENT OUT, its result is not known (CALL-E call no. %s)',
    "Cascade n°%d : l'appel du rang %d a ABOUTI mais sa réponse est illisible — %s":
        'Cascade no.%d: the call at rank %d WENT THROUGH but its answer is unreadable — %s',
    'Cascade n°%d interrompue au rang %d — %s':
        'Cascade no.%d interrupted at rank %d — %s',
    'Cascade n°%d, rang %d : autre date convenue (rendez-vous n°%d)':
        'Cascade no.%d, rank %d: other date agreed (appointment no.%d)',
    'Cascade n°%d, rang %d : autre date refusée (%s)':
        'Cascade no.%d, rank %d: other date refused (%s)',
    'Cascade n°%d, rang %d : client « Ne plus appeler », jamais composé':
        'Cascade no.%d, rank %d: contact « Do not call again », never dialled',
    'Cascade n°%d, rang %d : créneau refusé (%s)':
        'Cascade no.%d, rank %d: slot refused (%s)',
    'Cascade n°%d, rang %d : pas de réponse':
        'Cascade no.%d, rank %d: no answer',
    'Cascade n°%d, rang %d : échec (%s)':
        'Cascade no.%d, rank %d: failure (%s)',
    'Cascade « premier oui »':
        '« First yes » cascade',
    'Cascade « premier oui » — RingBack':
        '« First yes » cascade — RingBack',
    'Cascades passées':
        'Past cascades',
    'Ce bouton':
        'This button',
    "Ce bouton n'existe qu'en simulation. En appels réels, l'heure ne se force pas — même en cliquant, même en rejouant cette adresse.":
        'This button only exists in simulation. In real calls, the time cannot be forced — not by clicking, not by replaying this address.',
    'Ce bouton ne compose AUCUN numéro':
        'This button dials NO number',
    "Ce client n'a pas de numéro : une campagne ne peut pas l'appeler. Complétez sa fiche dans 👥 Contacts, puis recommencez.":
        'This contact has no number: a campaign cannot call them. Fill in their record in 👥 Contacts, then start again.',
    "Ce fichier n'a pas pu être lu :":
        'This file could not be read:',
    "Ce geste ne compose AUCUN numéro : il ne fait que LIRE, chez CALL-E, le résultat d'appels déjà passés.":
        'This action dials NO number: it only READS, at CALL-E, the result of calls already placed.',
    'Ce geste ne se défait pas.':
        'This action cannot be undone.',
    "Ce numéro est déjà déclaré : c'est celui du testeur n°":
        'This number is already declared: it belongs to tester no.',
    "Ce qu'elle est\ndevenue":
        'What it\nbecame',
    "Ce qu'il fait quand ça n'aboutit\n  pas":
        'What it does when a call does not\n  get through',
    "Ce qu'il reste à faire":
        'Still to do',
    "Ce qu'il reste à faire :":
        'Still to do:',
    'Ce que CALL-E a répondu, mot pour mot':
        'What CALL-E replied, word for word',
    'Ce que CALL-E a répondu, mot pour mot :':
        'What CALL-E replied, word for word:',
    'Ce que RingBack a déjà':
        'What RingBack already has',
    "Ce que l'agent dit":
        'What the agent says',
    "Ce que l'agent n'a pas pu conclure":
        'What the agent could not conclude',
    'Ce que tu sais, et que tu peux redire ou reformuler :':
        'What you know, and may repeat or rephrase:',
    'Ce que vous allez régler':
        'What you are going to set',
    'Ce que vous pouvez faire':
        'What you can do',
    'Ce rendez-vous existe déjà':
        'This appointment already exists',
    "Ce rendez-vous n'existe plus (supprimé ou base rechargée).":
        'This appointment no longer exists (deleted or database reloaded).',
    "Ce rendez-vous ne prend aucune place au planning : son statut l'a déjà rendue. Il n'y a donc ni à le déplacer, ni à l'annuler.":
        'This appointment takes no slot in the schedule: its status has already released it. So there is nothing to move and nothing to cancel.',
    "Ce rendez-vous ne prend aucune tranche : son statut l'a déjà libéré.":
        'This appointment takes no time band: its status has already freed it.',
    'Ce rendez-vous passera au statut':
        'This appointment will move to status',
    "Ce sont eux qui décident des places que l'agent peut proposer au\ntéléphone : RingBack ne propose":
        'They decide which slots the agent may offer on the\nphone: RingBack offers only',
    'Ce texte ne vaut que pour CETTE campagne. Le texte de départ, celui\nque toutes les campagnes de cette nature reprennent, se règle dans':
        'This text applies to THIS campaign only. The starting text, the one\nevery campaign of this kind picks up, is set in',
    'Cela efface':
        'This erases',
    'Celle qui a perdu sa place le plus RÉCEMMENT':
        'The one who lost their slot most RECENTLY',
    'Celle qui attend depuis le plus LONGTEMPS':
        'The one who has been waiting the LONGEST',
    'Celle qui gagne le MOINS (rendez-vous le plus proche de la place)':
        'The one who gains the LEAST (appointment closest to the slot)',
    'Celle qui gagne le PLUS de temps (rendez-vous le plus lointain)':
        'The one who gains the MOST time (furthest appointment)',
    'Celui-ci contient':
        'This one contains',
    'Ces':
        'These',
    "Ces 5 fiches sont marquées 🧪 « jeu d'essai » :\nelles se retirent en bloc avec « Retirer le jeu d'essai » ci-dessus, sans\njamais toucher à vos vraies données.":
        'These 5 records are marked 🧪 « test data »:\nthey are removed together with « Remove the test data » above, without\never touching your real data.',
    'Ces contacts ne sont':
        'These contacts are',
    'Ces deux dernières parties sont écrites par la nature de la\ncampagne et par ses ⚙ options de comportement — elles se lisent ici, elles\nne se tapent pas. Une campagne peut encore récrire son ouverture pour elle\nseule (étape ②, mode avancé).':
        'These last two parts are written by the nature of the\ncampaign and by its ⚙ behaviour options — they are read here, they\nare not typed. A campaign can still rewrite its opening for itself\nalone (step ②, advanced mode).',
    'Ces options partent des valeurs réglées pour cette nature dans':
        'These options start from the values set for this kind in',
    'Ces personnes':
        'These contacts',
    'Ces personnes attendent une place.':
        'These people are waiting for a slot.',
    "Ces personnes n'ont":
        'These people have',
    'Ces personnes ont encore un\n    rendez-vous : elles ne sont appelées que pour une place':
        'These people still have an\n    appointment: they are only called for a slot',
    "Ces rendez-vous viennent d'un agenda importé (fichier ICS) : le fichier ne\ncontenait pas de téléphone. Un contact sans numéro ne peut pas être rappelé.":
        'These appointments come from an imported calendar (ICS file): the file did\nnot contain a phone number. A contact without a number cannot be called back.',
    'Ces trois durées ne concernent que les':
        'These three durations only concern',
    "Ces trois parties sont exactement ce qui sera envoyé à l'agent\ntéléphonique. Seule la première est dite mot pour mot : entre elle et sa\nconclusion, l'agent répond à ce qu'on lui dit, peut répéter et reformuler.\nLes trois issues, elles, sont fermées — il ne peut en rendre aucune\nautre.":
        'These three parts are exactly what will be sent to the phone\nagent. Only the first is said word for word: between it and its\nclose, the agent answers what it is told, may repeat and rephrase.\nThe three outcomes are closed — it can return no\nother.',
    'Ces valeurs pré-remplissent le formulaire de toute':
        'These values pre-fill the form of any',
    "Cette campagne annonce des créneaux : ils sont recalculés depuis l'agenda de RingBack juste avant chaque appel.":
        "This campaign announces slots: they are recomputed from RingBack's calendar just before each call.",
    'Cette campagne annonce une liste de créneaux ÉCRITE À LA MAIN : RingBack ne la recalcule pas, elle sera dite telle quelle.':
        'This campaign announces a HAND-WRITTEN slot list: RingBack does not recompute it, it will be spoken as is.',
    "Cette campagne n'annonce aucune liste de créneaux ; l'agenda sert quand même à écrire ce qui se décide pendant l'appel.":
        'This campaign announces no slot list; the schedule is still used to record what is decided during the call.',
    "Cette clé CALL-E n'a pas la forme d'une clé :":
        'This CALL-E key is not shaped like a key:',
    "Cette clé n'a pas la forme d'une clé.":
        'This key does not have the shape of a key.',
    'Cette colonne vient de la nature de la campagne : elle ne peut pas être retirée.':
        'This column comes from the campaign type: it cannot be removed.',
    'Cette fenêtre ne se rouvrira plus toute seule. Pour refaire la\nconfiguration : ⚙ Réglages → Refaire la configuration.':
        'This window will not reopen by itself. To run setup\nagain: ⚙ Settings → Run setup again.',
    "Cette liste de campagnes n'existe pas.":
        'This campaign list does not exist.',
    'Cette liste est':
        'This list is',
    'Cette liste est déjà vide.':
        'This list is already empty.',
    "Cette liste remplace l'ancien champ unique\n«":
        'This list replaces the old single field\n«',
    "Cette liste remplace l'ancien champ unique\n« 🧪 Numéro d'essai ». Un numéro déjà déclaré n'est":
        'This list replaces the old single field\n« 🧪 Test number ». A number already declared is',
    'Cette nature appelle UN SEUL contact : gardez une seule ligne (':
        'This type calls ONLY ONE contact: keep a single row (',
    'Cette personne conserve son rendez-vous':
        'This person keeps their appointment',
    'Cette place est':
        'This slot is',
    "Cette plage n'a pas pu être lue. Recommencez la sélection sur la grille, ou saisissez les quatre valeurs (du jour, au jour, de telle heure à telle heure).":
        'This range could not be read. Start the selection again on the grid, or enter the four values (start day, end day, start time, end time).',
    'Cette plage ne contient aucun rendez-vous à traiter.':
        'This range contains no appointment to handle.',
    'Cette plage ne contient aucune place libre à proposer.':
        'This range contains no free slot to offer.',
    "Cette semaine n'a pas pu être lue.":
        'This week could not be read.',
    'Changement':
        'Change',
    "Chaque appel est horodaté ; la fiche du contact affiche l'heure\n  du dernier appel et le compteur de tentatives. Au plafond, le contact passe\n  📵 injoignable (N). La relance conserve la nature et le contexte.":
        'Every call is timestamped; the contact record shows the time\n  of the last call and the attempt counter. Once the cap is reached, the contact becomes\n  📵 unreachable (N). The follow-up keeps the kind and the context.',
    'Chaque contact porte':
        'Each contact carries',
    'Charger ce fichier':
        'Load this file',
    'Charger la même configuration':
        'Load the same configuration',
    "Charger le jeu d'essai":
        'Load the test data',
    'Charger un jeu d&#x27;essai ? — RingBack':
        'Load test data? — RingBack',
    "Charger un jeu d'essai ?":
        'Load test data?',
    "Charger un jeu d'essai…":
        'Load test data…',
    'Charger votre agenda':
        'Load your calendar',
    'Chaîne conclue':
        'Chain concluded',
    'Choisir toute la journée du':
        'Select the whole day of',
    "Choisir une année ou une semaine recharge les listes suivantes\n  sans rien envoyer : aucun contact n'est ajouté avant le bouton.":
        'Choosing a year or a week reloads the lists below\n  without sending anything: no contact is added before the button.',
    "Choisissez d'abord un créneau d'arrivée (liste déroulante) ou tapez une date et une heure (format 2026-08-03T09:00).":
        'First choose a destination slot (drop-down list) or type a date and a time (format 2026-08-03T09:00).',
    "Choisissez d'abord une nature de campagne.":
        'First choose a campaign type.',
    "Choisissez l'ordre d'appel — aucun ordre n'est imposé par défaut, la décision vous revient.":
        'Choose the calling order — no order is imposed by default, the decision is yours.',
    'Choisissez la':
        'Choose the',
    'Choisissez la campagne dont vous repartez.':
        'Choose the campaign you are starting from.',
    'Choisissez la campagne dont vous voulez reprendre les options.':
        'Choose the campaign whose options you want to reuse.',
    'Choisissez la règle qui fabrique la liste, puis « Enregistrer la règle ».':
        'Choose the rule that builds the list, then « Save the rule ».',
    'Choisissez les rendez-vous que la règle reprend.':
        'Choose the appointments the rule picks up.',
    'Choisissez un fichier avant de cliquer sur « Charger ».':
        'Choose a file before clicking « Load ».',
    "Choisissez une rubrique dans le menu pour l'ouvrir.":
        'Choose a section from the menu to open it.',
    'Client':
        'Contact',
    'Client ajouté : %s (%s)%s':
        'Contact added: %s (%s)%s',
    "Client du jeu d'essai — donnée fictive, retirable depuis les réglages":
        'Test data contact — fictional data, removable from the settings',
    'Client introuvable.':
        'Contact not found.',
    'Client marqué « Ne plus appeler » : exclu de la file, des cascades et des listes':
        'Contact marked « Do not call again »: excluded from the queue, the cascades and the lists',
    'Client marqué « Ne plus appeler » : exclu de la file, des cascades et des listes générées (réversible ici).':
        'Contact marked « Do not call again »: excluded from the queue, from cascades and from generated lists (reversible here).',
    'Client marqué 🚫 « Ne plus appeler »':
        'Contact marked 🚫 « Do not call again »',
    'Client n°%d : %d relance(s) planifiée(s) annulée(s) — plus aucun appel ne partira pour lui':
        'Contact no. %d: %d scheduled follow-up(s) cancelled — no call will go out for them any more',
    'Client n°%d : « Ne plus appeler » %s':
        'Contact no. %d: « Do not call again » %s',
    "Client n°%d supprimé avec %d rendez-vous (confirmé à l'écran)":
        'Contact no. %d deleted with %d appointment(s) (confirmed on screen)',
    'Client supprimé, ainsi que':
        'Contact deleted, along with',
    'Clore la campagne — annuler ses relances':
        'Close the campaign — cancel its follow-ups',
    'Clore la campagne — je ne la lancerai pas':
        'Close the campaign — I will not launch it',
    'Clore — je ne la lancerai pas':
        'Close — I will not run it',
    "Clé CALL-E enregistrée. Elle n'est jamais réaffichée — seule sa description l'est. Les deux autres verrous restent à ouvrir au lancement.":
        'CALL-E key saved. It is never shown again — only its description is. The two other locks still have to be opened at launch.',
    'Clé CALL-E rangée dans le fichier (%s) — jamais journalisée':
        'CALL-E key stored in the file (%s) — never logged',
    'Clé CALL-E retirée du fichier':
        'CALL-E key removed from the file',
    "Clé CALL-E retirée du fichier. La variable d'environnement, si vous en posez une, continue de fonctionner.":
        'CALL-E key removed from the file. The environment variable, if you set one, still works.',
    "Clé absente — mode simulation actif. Renseignez la variable d'environnement CALLE_API_KEY pour autoriser les appels réels.":
        'Key missing — simulation mode active. Set the CALLE_API_KEY environment variable to allow real calls.',
    "Cochez la case ET donnez un numéro : sans numéro, RingBack ne saurait pas où renvoyer les appels — il appellerait vos vrais contacts, ce que cette case promet justement d'empêcher.":
        'Tick the box AND give a number: without a number, RingBack would not know where to redirect the calls — it would call your real contacts, which is exactly what this box promises to prevent.',
    'Cochée, cette case fait':
        'When ticked, this box makes',
    'Cochée, elle':
        'When ticked, it',
    'Collez-la dans le champ ci-dessus et enregistrez.':
        'Paste it into the field above and save.',
    'Colonne retirée. Les valeurs déjà saisies dans cette colonne sont conservées : elles reviendront si vous la remettez.':
        'Column removed. The values already entered in this column are kept: they will come back if you add it again.',
    'Colonne «':
        'Column «',
    'Colonnes séparées par « ; » :':
        'Columns separated by « ; »:',
    "Combien d'identités ? — au moins":
        'How many identities? — at least',
    "Combien d'identités ? — au moins 5\n    (une par rôle à éprouver), au plus 20":
        'How many identities? — at least 5\n    (one per role to test), at most 20',
    'Combien de temps attendre un vrai appel':
        'How long to wait for a real call',
    'Combien de temps elle leur\n  fait gagner, au minimum':
        'How much time it saves\n  them, at least',
    'Combien par page':
        'How many per page',
    'Comment la liste se fabrique :':
        'How the list is built:',
    "Comment mener l'échange, dans cet ordre :":
        'How to conduct the exchange, in this order:',
    'Comment obtenir le fichier':
        'How to get the file',
    'Comment obtenir une clé CALL-E ?':
        'How to get a CALL-E key?',
    'Comment voulez-vous remplir la grille ?':
        'How do you want to fill the grid?',
    "Comportement de l'agent IA":
        'AI agent behaviour',
    'Configuration de RingBack':
        'RingBack setup',
    'Configurer plus\n  tard':
        'Set up\n  later',
    'Confirmation de rendez-vous':
        'Appointment confirmation',
    'Confirmation de rendez-vous (':
        'Appointment confirmation (',
    'Confirmation explicite manquante : appeler confirmer_appels_reels() avant tout appel réel.':
        'Explicit confirmation missing: call confirmer_appels_reels() before any real call.',
    'Confirmation refusée — lancement en mode simulation.':
        'Confirmation declined — launching in simulation mode.',
    'Confirmer — passer ce rendez-vous\n  «':
        'Confirm — set this appointment\n  to «',
    'Confirmé':
        'Confirmed',
    'Confirmés':
        'Confirmed',
    "Congés, jours fériés, une journée bloquée : ajoutez-les ici. Ils\ns'enlèvent des places proposées, et une relance ne tombera jamais\ndessus.":
        'Leave, public holidays, a blocked day: add them here. They\nare removed from the slots offered, and a follow-up will never land\non them.',
    'Connexion à CALL-E':
        'Connection to CALL-E',
    'Consigne générale (ex. « venir à jeun »)':
        'General briefing (e.g. « come on an empty stomach »)',
    'Consigne propre au contact':
        'Contact-specific briefing',
    'Consigne standard du rappel de rendez-vous manqué':
        'Standard briefing for the missed-appointment reminder',
    'Consignes':
        'Briefings',
    'Consignes (ex. « venir à jeun »)':
        'Briefings (e.g. « come on an empty stomach »)',
    'Contact':
        'Contact',
    'Contact :':
        'Contact:',
    "Contact : Ah oui, désolé, j'ai eu un empêchement.":
        'Contact: Oh yes, sorry, something came up.',
    'Contact : Attendez, je ne peux pas vous dire là, il faut que je regarde. Vous pouvez me rappeler ?':
        "Contact: Wait, I can't tell you right now, I need to check. Can you call me back?",
    "Contact : Ce créneau ne m'arrange pas… plutôt":
        "Contact: That slot doesn't suit me… rather",
    'Contact : En fait, je préfère annuler pour le moment. Je rappellerai moi-même.':
        "Contact: Actually, I'd rather cancel for now. I'll call back myself.",
    "Contact : Il faudra déplacer, mais je n'ai pas mon agenda sous les yeux… Vous pouvez me rappeler plus tard ?":
        "Contact: We'll have to move it, but I don't have my calendar in front of me… Can you call me back later?",
    "Contact : Merci d'avoir pensé à moi, mais ça ne m'arrange pas. Bonne journée !":
        "Contact: Thanks for thinking of me, but it doesn't suit me. Have a good day!",
    'Contact : Oh,':
        'Contact: Oh,',
    'Contact : Pas':
        'Contact: Not',
    "Contact : … (bruit de fond, la personne parle à quelqu'un d'autre)":
        'Contact: … (background noise, the person is talking to someone else)',
    "Contact d'ESSAI : il porte le numéro d'un testeur déclaré dans ⚙ Réglages — c'est VOTRE téléphone, ou celui d'un testeur, qui sonnera, pas celui d'un client.":
        "TEST contact: it carries the number of a tester declared in ⚙ Settings — it is YOUR phone, or a tester's, that will ring, not a contact's.",
    'Contact introuvable.':
        'Contact not found.',
    'Contact n°%d : les propositions de créneau libéré lui sont rendues':
        'Contact no. %d: freed-slot offers are given back to them',
    'Contact n°%d : rappel humain marqué %s':
        'Contact no. %d: human callback marked %s',
    "Contact par l'agent":
        'Agent contact',
    'Contact unique avec sujet':
        'Single contact with subject',
    'Contact unique avec sujet (retiré)':
        'Single contact with subject (removed)',
    'Contacts':
        'Contacts',
    'Contacts (':
        'Contacts (',
    'Contacts (4)':
        'Contacts (4)',
    'Contacts et avancement':
        'Contacts and progress',
    'Contacts — RingBack':
        'Contacts — RingBack',
    'Continuer → étape 3 (refusé si un ⚠ manque)':
        'Continue → step 3 (refused if a ⚠ is missing)',
    'Conversation : — jamais appelé':
        'Conversation: — never called',
    'Corriger le numéro':
        'Fix the number',
    'Coût :':
        'Cost:',
    'Coût : 5 appel(s), soit environ 0,25 $ (0,05 $ l&#x27;appel)':
        'Cost: 5 calls, about 0,25 $ (0,05 $ per call)',
    'Créer une campagne de rappel pour':
        'Create a callback campaign for',
    'Créer une campagne de rappel pour la semaine du':
        'Create a reminder campaign for the week of',
    'Créez un compte sur':
        'Create an account on',
    'Créez une clé, puis copiez-la.':
        'Create a key, then copy it.',
    'Créneau / date concernée :':
        'Slot / date concerned:',
    'Créneau attribué à':
        'Slot assigned to',
    'Créneau de la campagne :':
        'Campaign slot:',
    "Créneau de rappel : aucun jour ouvert dans les %d prochains jours — l'échéance reste au jour calculé. Ouvrez des jours dans « ⚙ Réglages ».":
        'Callback slot: no open day in the next %d days — the deadline stays on the computed day. Open some days in « ⚙ Settings ».',
    'Créneau de rappel : donnez le début ET la fin pour choisir le mode « créneau de rappel ».':
        'Callback slot: give the start AND the end to choose « callback slot » mode.',
    'Créneau de rappel : donnez le début ET la fin pour choisir le mode « créneau horaire ».':
        'Callback slot: give the start AND the end to choose « time slot » mode.',
    "Créneau de rappel : l'heure de début doit précéder l'heure de fin (ex. 12:00 → 14:00).":
        'Callback slot: the start time must come before the end time (e.g. 12:00 → 14:00).',
    'Créneau du':
        'Slot of',
    'Créneau illisible':
        'Unreadable slot',
    'Créneau libéré':
        'Freed slot',
    'Créneau libéré (date et heure)':
        'Freed slot (date and time)',
    'Créneau libéré attribué':
        'Freed slot assigned',
    'Créneau libéré attribué (cascade « premier oui »)':
        'Freed slot assigned (« first yes » cascade)',
    'Créneau libéré attribué (relance de campagne)':
        'Freed slot assigned (campaign follow-up)',
    'Créneau libéré du':
        'Freed slot of',
    'Créneau proposé':
        'Slot offered',
    'Créneau proposé (date et heure du créneau libéré)':
        'Slot offered (date and time of the freed slot)',
    'Créneau proposé :':
        'Slot offered:',
    'Créneau proposé en premier (le plus proche)':
        'Slot offered first (the nearest)',
    'Créneaux disponibles pour négocier (stock, non récité)':
        'Slots available for negotiating (stock, not recited)',
    'Créneaux disponibles à proposer':
        'Slots available to offer',
    "Créneaux recalculés à l'instant de l'appel pour le contact n°%d (%d tranche(s) consécutive(s) exigée(s))":
        'Slots recomputed at call time for contact no. %d (%d consecutive block(s) required)',
    "D'où viennent ces rappels (":
        'Where these callbacks come from (',
    "Dans votre logiciel d'agenda, cherchez":
        'In your calendar software, look for',
    'Date':
        'Date',
    'Date convenue impossible — à rappeler par un humain':
        'Agreed date impossible — to be called back by a human',
    'Date et heure':
        'Date and time',
    'Date et heure de rappel souhaitée (optionnel)':
        'Preferred callback date and time (optional)',
    'Date et heure — format attendu : 2026-08-03 09:00':
        'Date and time — expected format: 2026-08-03 09:00',
    'Date illisible : «':
        'Unreadable date: «',
    'Date libre':
        'Free date',
    'Date limite de la chaîne':
        'Chain deadline',
    'Date obligatoire : attendu AAAA-MM-JJ (par exemple 2026-08-15) ou JJ/MM/AAAA.':
        'Date required: expected YYYY-MM-DD (for example 2026-08-15) or DD/MM/YYYY.',
    'Date refusée :':
        'Date refused:',
    'Date à fermer (format AAAA-MM-JJ, par exemple 2026-08-15)':
        'Date to close (format YYYY-MM-DD, for example 2026-08-15)',
    'De':
        'From',
    'Dec':
        'Dec',
    'December':
        'December',
    "Demande d'arrêt enregistrée — l'appel en cours va à son terme.":
        'Stop request recorded — the call in progress runs to its end.',
    "Demande de pause enregistrée — l'appel en cours va à son terme, la pause agit entre deux appels.":
        'Pause request recorded — the call in progress runs to its end, the pause takes effect between two calls.',
    'Demande du client : «':
        'Contact request: «',
    'Demande invalide.':
        'Invalid request.',
    "Demander en fin d'appel si le rendez-vous doit être annulé":
        'Ask at the end of the call whether the appointment should be cancelled',
    "Depuis l'état :":
        'From status:',
    'Dernier import de rendez-vous par fichier :':
        'Last appointment import from file:',
    "Dernière date de l'agenda":
        'Last date in the schedule',
    'Dernière issue':
        'Last outcome',
    'Dernière page':
        'Last page',
    "Des dates où aucun rendez-vous n'est possible":
        'Dates when no appointment is possible',
    "Deux façons d'arriver ici.":
        'Two ways of ending up here.',
    "Discours de l'agent":
        'Agent wording',
    "Discours de l'agent enregistré pour %d nature(s).":
        'Agent wording saved for %d type(s).',
    'Discours revenu au texte livré avec le produit.':
        'Wording restored to the text shipped with the product.',
    "Donnez un nom à la colonne avant de l'ajouter.":
        'Give the column a name before adding it.',
    'Drapeau levé : ce client peut de nouveau être appelé.':
        'Flag lifted: this contact can be called again.',
    'Du jour':
        'From',
    "Du plus récent au plus ancien, avec leur statut : aucune saisie ne se perd.\nUn rendez-vous « ignoré » (liste vidée) se rétablit ici d'un bouton.":
        'Newest to oldest, with their status: no entry is lost.\nAn « ignored » appointment (list cleared) is restored here with one button.',
    'Durée':
        'Duration',
    'Durée :':
        'Duration:',
    'Durée : 1 tranche de 15 min (15 minutes)':
        'Duration: 1 block of 15 min (15 minutes)',
    'Durée de la prestation':
        'Session duration',
    'Durée du rendez-vous, en minutes — multiple de':
        'Appointment duration, in minutes — multiple of',
    "Durée du rendez-vous, en minutes — multiple de 15\n    (la durée moyenne d'un rendez-vous), par exemple 15 ou 30":
        'Appointment length, in minutes — a multiple of 15\n    (the average appointment length), for example 15 or 30',
    'Durée en minutes — multiple de':
        'Duration in minutes — multiple of',
    'Durée enregistrée.':
        'Duration saved.',
    "Durée moyenne d'un rendez-vous :":
        'Average appointment duration:',
    "Durée moyenne d'un rendez-vous : attendu un nombre entier de minutes entre":
        'Average appointment duration: expected a whole number of minutes between',
    "Durée moyenne d'un rendez-vous, en minutes (c'est le pas des\n    tranches — de":
        'Average appointment duration, in minutes (this is the step of the\n    time bands — from',
    "Durée moyenne d'un rendez-vous, en minutes (c'est le pas des\n    tranches — de 5 à 240)":
        'Average appointment length, in minutes (this is the step of the\n    bands — from 5 to 240)',
    'Durée refusée : «':
        'Duration refused: «',
    'Durée, déplacement, annulation':
        'Duration, rescheduling, cancellation',
    'Début':
        'Start',
    'Décalage en cascade : la date limite (':
        'Cascade shift: the deadline (',
    'Décalage en cascade : la date limite est illisible (reçu «':
        'Cascade shift: the deadline is unreadable (received «',
    'Décaler en cascade':
        'Shift in cascade',
    'Décaler en cascade (la campagne suivante est PRÉPARÉE, jamais lancée)':
        'Shift in cascade (the next campaign is PREPARED, never started)',
    'Décaler en cascade :':
        'Shift in cascade:',
    'Déclarer ce jour fermé':
        'Declare this day closed',
    "Délai d'attente d'une requête":
        'Request timeout',
    "Délai de relance : donnez un nombre d'heures ouvrées entre 0 et 168 (reçu «":
        'Follow-up delay: give a number of working hours between 0 and 168 (received «',
    "Délai, en heures ouvrées de la plage d'appel":
        'Delay, in working hours of the calling window',
    'Délais d&#x27;un appel réel':
        'Real call timings',
    "Délais d'un appel réel":
        'Real call delays',
    "Démarrage de la campagne n°%d suspendu : l'état de l'agenda n'a pas encore été confirmé":
        'Start of campaign no. %d held back: the state of the schedule has not been confirmed yet',
    'Démarrer':
        'Start',
    'Démarrer avec RingBack':
        'Getting started with RingBack',
    "Déplacement : la politique « %s » écrite par l'ANCIEN défaut a été retirée des réglages — cette nature appelle désormais tout le monde. Modifiable dans ⚙ Réglages.":
        'Move: the « %s » policy written by the OLD default has been removed from the settings — this type now calls everyone. Editable in ⚙ Settings.',
    'Déplacement de rendez-vous':
        'Appointment rescheduling',
    "Déplacement impossible pour l'instant : ce rendez-vous occupe":
        'Cannot be moved for now: this appointment occupies',
    "Déplacement impossible pour l'instant : ce rendez-vous occupe 1 tranche de 15 min (15 minutes) consécutives, et aucune suite de tranches libres aussi longue n'existe dans les 21 prochains jours. Ouvrez des heures ou libérez des rendez-vous dans":
        'Rescheduling is not possible for now: this appointment takes up 1 block of 15 min (15 minutes) in a row, and no run of free blocks that long exists in the next 21 days. Open up hours or free up appointments in',
    'Déplacement refusé (rendez-vous n°%d) : %s':
        'Move refused (appointment no. %d): %s',
    'Déplacement refusé : ce rendez-vous occupe':
        'Move refused: this appointment occupies',
    'Déplacement refusé : le':
        'Move refused: the',
    'Déplacer ce rendez-vous':
        'Move this appointment',
    'Déplacé':
        'Moved',
    'Déplacé (date convenue)':
        'Moved (agreed date)',
    'Déplacés (autre date)':
        'Moved (another date)',
    'Déplacés en attente':
        'Moved, pending',
    'Déplacés en attente (sans rendez-vous à venir)':
        'Moved, pending (no upcoming appointment)',
    'Effacer ces':
        'Delete these',
    'Effacer la liste':
        'Clear the list',
    "Effacer votre texte et revenir à l'ouverture livrée avec le\n  produit (celle qui s'affiche en filigrane).":
        'Erase your text and go back to the opening shipped with the\n  product (the one shown as a watermark).',
    'Effacer «':
        'Delete «',
    'Elle demande à ne plus être appelée.':
        'She asks not to be called again.',
    'Elle recevra de nouveau les propositions de créneau libéré':
        'They will receive freed-slot offers again',
    "Elles n'ont plus de rendez-vous du tout : n'importe quelle place les\n    intéresse, et la colonne « Prochain rdv » de la campagne restera donc vide\n    jusqu'à ce qu'un appel leur en donne un. Personne n'est appelé avant le\n    ▶ Démarrer.":
        "They have no appointment left at all: any slot suits\n    them, so the campaign's « Next appt. » column will stay empty\n    until a call gives them one. No one is called before\n    ▶ Start.",
    'En cours':
        'In progress',
    "En mode réel, RingBack REFUSERA tout appel : il n'appellera pas vos contacts à la place de votre numéro d'essai. Ré-enregistrez un numéro ci-dessous, ou décochez la case.":
        'In real mode, RingBack will REFUSE every call: it will not call your contacts instead of your test number. Save a number again below, or clear the box.',
    'En-tête invalide : attendu « nom;telephone » (les colonnes supplémentaires sont ignorées), reçu «':
        'Invalid header: expected « nom;telephone » (extra columns are ignored), received «',
    'En-tête invalide : attendu « nom;telephone;date_heure;motif », reçu «':
        'Invalid header: expected « nom;telephone;date_heure;motif », received «',
    'English':
        'English',
    'Enregistrer':
        'Save',
    'Enregistrer ce discours':
        'Save this script',
    'Enregistrer ces options':
        'Save these options',
    'Enregistrer ferme cette fenêtre et remet à jour':
        'Saving closes this window and refreshes',
    'Enregistrer ferme cette fenêtre et remet à jour le':
        'Saving closes this window and refreshes the',
    'Enregistrer la\n    règle':
        'Save the\n    rule',
    'Enregistrer la clé':
        'Save the key',
    'Enregistrer la durée':
        'Save the duration',
    'Enregistrer la fiche':
        'Save the record',
    'Enregistrer la grille':
        'Save the grid',
    'Enregistrer le numéro':
        'Save the number',
    "Entre ton ouverture et ta conclusion, discute NATURELLEMENT, en t'adaptant à ce qu'on te répond : tu peux répéter, reformuler, laisser la personne t'interrompre, répondre à une question imprévue. Ne récite pas, ne conclus pas avant d'avoir une réponse claire. Avant de raccrocher, récapitule en une phrase ce qui a été convenu.":
        'Between your opening and your closing, talk NATURALLY, adapting to what you are told: you may repeat, rephrase, let the person interrupt you, answer an unexpected question. Do not recite, do not close before you have a clear answer. Before hanging up, sum up in one sentence what has been agreed.',
    'Envoi invalide : un fichier CSV est attendu.':
        'Invalid upload: a CSV file is expected.',
    'Envoi invalide : un fichier ICS est attendu.':
        'Invalid upload: an ICS file is expected.',
    'Envoi invalide : un fichier est attendu.':
        'Invalid upload: a file is expected.',
    'Erreur':
        'Error',
    'Erreur 403':
        'Error 403',
    'Essai en conditions réelles':
        'Real-conditions test',
    'Essai en conditions réelles préparé : campagne n°%d PRÊTE, %d contact(s) répartis sur %d testeur(s) — aucun appel passé':
        'Real-conditions test prepared: campaign no. %d READY, %d contact(s) spread over %d tester(s) — no call placed',
    'Essai en conditions réelles — RingBack':
        'Real-conditions test — RingBack',
    "Essai en conditions réelles — rien n'a été préparé":
        'Real-conditions test — nothing has been prepared',
    'Exclu — jamais composé':
        'Excluded — never dialled',
    'Exclut ce client de la file, des cascades et des listes (réversible)':
        'Excludes this contact from the queue, the cascades and the lists (reversible)',
    'Exclut ce client de la file, des cascades et des listes générées — réversible':
        'Excludes this contact from the queue, the cascades and the generated lists — reversible',
    "Export CSV de la grille de l'assistant : %d personne(s) (servi à la volée)":
        'CSV export of the wizard grid: %d person(s) (served on the fly)',
    'Export CSV de la liste de cascade : %d personne(s) (fichier %s, servi à la volée)':
        'CSV export of the cascade list: %d person(s) (file %s, served on the fly)',
    'Export CSV du cahier de changements de la campagne n°%d : %d ligne(s) (servi à la volée)':
        'CSV export of the change log of campaign no. %d: %d line(s) (served on the fly)',
    'Exporter':
        'Export',
    'Exécuter la file — passer':
        'Run the queue — place',
    'Exécution terminée':
        'Run finished',
    "Faute d'assez de places libres (horaires d'ouverture non réglés, ou agenda déjà plein), les rendez-vous ont été posés DEMAIN MATIN, d'heure en heure : réglez vos horaires dans ⚙ Réglages si vous voulez de vraies places.":
        'For lack of enough free slots (opening hours not set, or schedule already full), the appointments were placed TOMORROW MORNING, hour by hour: set your hours in ⚙ Settings if you want real slots.',
    'Feb':
        'Feb',
    'February':
        'February',
    "Ferme une campagne préparée que vous ne\n lancerez pas : personne n'est appelé, aucun rendez-vous n'est touché, et rien\n n'est effacé":
        'Closes a prepared campaign you will not\n run: nobody is called, no appointment is touched, and nothing\n is deleted',
    "Ferme une campagne préparée que vous ne lancerez pas : personne n'est appelé, rien n'est effacé":
        'Closes a prepared campaign you will not launch: no one is called, nothing is deleted',
    'Fermer':
        'Close',
    "Fermer — le clic à l'extérieur et la touche Échap font pareil":
        'Close — clicking outside and the Esc key do the same',
    'Fermer ✕':
        'Close ✕',
    'Fiche client n°%d complétée : numéro saisi dans une grille de campagne':
        'Contact record no. %d completed: number entered in a campaign grid',
    "Fiche client supprimée — ce contact n'est plus jamais composé (son historique reste lisible)":
        'Contact record deleted — this contact is never dialled again (their history stays readable)',
    'Fiche du client enregistrée.':
        'Contact record saved.',
    'Fiche du client n°%d corrigée%s':
        'Contact record no. %d corrected%s',
    'Fichier CSV':
        'CSV file',
    'Fichier ICS':
        'ICS file',
    'Fichier illisible :':
        'Unreadable file:',
    'Fichier vide : aucune ligne à importer.':
        'Empty file: no lines to import.',
    'File d&#x27;appels — RingBack':
        'Call queue — RingBack',
    "File d'appels":
        'Call queue',
    "File d'appels : l'appel n°%d EST PARTI, son résultat n'est pas connu (appel CALL-E n° %s)":
        'Call queue: call no. %d WENT OUT, its outcome is not known (CALL-E call no. %s)',
    "File d'appels : l'appel n°%d a ABOUTI mais sa réponse est illisible — %s":
        'Call queue: call no. %d SUCCEEDED but its response is unreadable — %s',
    "File d'appels interrompue au n°%d — %s":
        'Call queue interrupted at no. %d — %s',
    'File vidée :':
        'Queue emptied:',
    'Filtrer':
        'Filter',
    'Fin':
        'End',
    "Forcer la simulation malgré l'heure":
        'Force simulation despite the time',
    'Forme de la clé acceptée :':
        'Accepted key format:',
    'Formulaire :':
        'Form:',
    'Français':
        'French',
    'French':
        'French',
    'Friday':
        'Friday',
    'Fête du Travail':
        'Labour Day',
    'Fête nationale':
        'Bastille Day',
    "Gain minimum — n'appeler que\n      ceux que la place ferait avancer d'au moins":
        'Minimum gain — only call\n      those the slot would move up by at least',
    "Geste d'installation inconnu.":
        'Unknown setup action.',
    'Geste inconnu : «':
        'Unknown action: «',
    'Geste refusé :':
        'Action refused:',
    'Grille enregistrée.':
        'Grid saved.',
    'Heure':
        'Time',
    'Heure de':
        'Time of',
    "Heure forcée : cette campagne a le droit de tourner hors de la plage d'appel autorisée (":
        'Time forced: this campaign is allowed to run outside the permitted calling window (',
    'Heure hors de la journée : «':
        'Time outside the day: «',
    'Heure illisible : «':
        'Unreadable time: «',
    'Historique :':
        'History:',
    'Historique : 0 relance(s) faite(s), 0\nannulée(s) — le détail de chaque chaîne est sur la fiche de sa campagne.':
        'History: 0 follow-ups made, 0\ncancelled — the detail of each chain is on its campaign record.',
    'Horaire':
        'Time',
    'Horaire :':
        'Time:',
    'Horaire attendu : 2026-09-07T09:00.':
        'Expected time: 2026-09-07T09:00.',
    'Horaire illisible : «':
        'Unreadable hours: «',
    'Horaire manqué':
        'Missed time',
    'Horaires d&#x27;ouverture':
        'Opening hours',
    "Horaires d'ouverture":
        'Opening hours',
    "Horaires d'ouverture — la semaine type":
        'Opening hours — the typical week',
    'Hors de cette plage (':
        'Outside this window (',
    "Hors de cette plage (entre 9h00 et 19h00),\n  tout lancement d'appel est refusé — politesse d'abord.":
        'Outside this window (between 09:00 and 19:00),\n  every call launch is refused — courtesy first.',
    "Identifiant d'appel invalide.":
        'Invalid call id.',
    'Identifiant de campagne invalide.':
        'Invalid campaign ID.',
    'Identifiant de cascade invalide.':
        'Invalid cascade ID.',
    'Identifiant de client invalide.':
        'Invalid contact ID.',
    'Identifiant de contact invalide.':
        'Invalid contact ID.',
    'Identifiant de relance invalide.':
        'Invalid follow-up ID.',
    'Identifiant de rendez-vous invalide.':
        'Invalid appointment ID.',
    'Identifiant invalide.':
        'Invalid ID.',
    'Identité':
        'Identity',
    'Identité (civilité + nom)':
        'Identity (title + name)',
    'Identité appelée':
        'Identity called',
    "Identité de l'établissement":
        'Practice identity',
    "Il ajoute des\ncontacts et des rendez-vous d'un":
        'It adds\ncontacts and appointments from a',
    "Il ajoute des\ncontacts et des rendez-vous d'un cabinet de kinésithérapie fictif :\ndes rendez-vous passés et à venir, des manqués, des annulés, des déplacés, des\ncontacts 🚫 « ne plus appeler » et des contacts sans numéro. De quoi voir\nfonctionner chaque situation sans attendre qu'elle arrive chez vous.":
        'It adds\ncontacts and appointments from a fictional physiotherapy practice:\npast and upcoming appointments, missed, cancelled and moved ones,\n🚫 « do not call » contacts and contacts with no number. Enough to see\nevery situation working without waiting for it to happen to you.',
    'Il est':
        'It is',
    'Il est dit à voix haute au début de chaque appel. Saisi une\n  fois, il est repris par toutes les campagnes suivantes.':
        'It is spoken aloud at the start of every call. Entered\n  once, it is reused by all later campaigns.',
    "Il mêle les trois cas qu'un vrai agenda contient :":
        'It mixes the three cases a real schedule contains:',
    "Il mêle les trois cas qu'un vrai agenda contient : 273 rendez-vous portent\nun":
        'It mixes the three cases a real calendar holds: 273 appointments carry\na',
    "Ils ont rendu leur place, ils ne sont donc pas dans la grille.\nRien n'est perdu : chacun garde sa fiche, et la colonne « pourquoi » dit ce qui\nl'a fait sortir.":
        'They gave their slot back, so they are not in the grid.\nNothing is lost: each keeps their record, and the « why » column says what\ntook them out.',
    "Image absente de l'installation.":
        'Image missing from the installation.',
    'Image inconnue.':
        'Unknown image.',
    "Import : rendez-vous n°%d passé « %s » — sa place est prise par le n°%d qui vient d'être importé":
        'Import: appointment no. %d set to « %s » — its slot is taken by no. %d, just imported',
    "Import d'agenda noté : %s, %d rendez-vous, le %s":
        'Schedule import logged: %s, %d appointments, on %s',
    'Importer':
        'Import',
    "Importer l'agenda":
        'Import the calendar',
    'Importer le CSV':
        'Import the CSV',
    'Importer un agenda (fichier ICS)':
        'Import a calendar (ICS file)',
    'Importer un fichier CSV':
        'Import a CSV file',
    "Impossible pour l'instant.":
        'Not possible right now.',
    'Imprimer / Enregistrer sous':
        'Print / Save as',
    'Installation reportée — elle reviendra au prochain démarrage.':
        'Installation postponed — it will come back at the next start-up.',
    'Installation terminée.':
        'Installation complete.',
    'Installeur':
        'Installer',
    'Installeur réinitialisé.':
        'Installer reset.',
    'Intervalle entre deux vérifications':
        'Interval between two checks',
    'Issue':
        'Outcome',
    'Issue :':
        'Outcome:',
    'Jamais appelé —':
        'Never called —',
    'Jamais appelée —':
        'Never called —',
    'Jan':
        'Jan',
    'January':
        'January',
    "Je ne peux plus à cette heure-là — mettez-moi plutôt [une date que l'agent vient de proposer].":
        'That time no longer works for me — put me down for [a date the agent has just offered] instead.',
    "Je ne veux pas parler à un robot, je veux qu'on me rappelle.":
        "I don't want to talk to a robot, I want someone to call me back.",
    'Jeu d&#x27;essai':
        'Test data',
    "Jeu d'essai":
        'Test data',
    "Jeu d'essai chargé :":
        'Test data loaded:',
    "Jeu d'essai retiré :":
        'Test data removed:',
    "Jeu d'essai retiré : %d client(s), %d rendez-vous":
        'Test data removed: %d contact(s), %d appointments',
    'Jour':
        'Day',
    'Jour de l&#x27;an':
        'New Year&#x27;s Day',
    "Jour de l'an":
        "New Year's Day",
    'Jour fermé':
        'Closing day',
    'Jour fermé déclaré : %s%s':
        'Closing day recorded: %s%s',
    'Jour férié':
        'Public holiday',
    'Jour illisible : choisissez un jour de la semaine (lundi à dimanche).':
        'Unreadable day: pick a day of the week (Monday to Sunday).',
    'Jour inconnu : «':
        'Unknown day: «',
    "Journal d'audit des appels réels :":
        'Real call audit log:',
    'Jours fermés':
        'Closing days',
    'Jours fériés français des douze prochains mois':
        'French public holidays for the next twelve months',
    'Jul':
        'Jul',
    'July':
        'July',
    'Jun':
        'Jun',
    'June':
        'June',
    "Jusqu'à quand":
        'Until when',
    "L'API CALL-E a répondu":
        'The CALL-E API replied',
    "L'ajout est":
        'The addition is',
    "L'ancien rendez-vous":
        'The previous appointment',
    "L'appel a bien été lancé, mais CALL-E n'a pas rendu son résultat dans les":
        'The call was indeed started, but CALL-E did not return its outcome within the',
    "L'appel n°":
        'Call no.',
    "L'appel, lui, A BIEN EU LIEU : le téléphone a sonné et la conversation s'est tenue. C'est RingBack qui n'a pas su lire ce que CALL-E en a rendu — ce n'est en rien un fait sur la personne appelée.":
        'The call itself DID TAKE PLACE: the phone rang and the conversation was held. It is RingBack that could not read what CALL-E returned — this says nothing at all about the person called.',
    "L'appel, lui, EST BIEN PARTI : le téléphone a pu sonner et la conversation a pu avoir lieu. C'est seulement la RÉPONSE de CALL-E qui n'est pas arrivée. Rien n'a donc été décidé sur cette personne : aucune tentative ne lui est comptée, elle n'est PAS marquée « injoignable », et son rendez-vous n'a pas bougé — son résultat est simplement INCONNU pour l'instant.":
        "The call itself DID GO OUT: the phone may have rung and the conversation may have been held. It is only CALL-E's REPLY that never arrived. So nothing has been decided about this person: no attempt is counted against them, they are NOT marked « unreachable », and their appointment has not moved — their outcome is simply UNKNOWN for now.",
    "L'identifiant qui permet de le retrouver ne vit que sur le contact : l'effacer, c'est perdre le résultat d'une vraie conversation. Utilisez d'abord « 📥 Récupérer les résultats en attente » sur la fiche de ces campagnes.":
        'The identifier that lets it be found again lives only on the contact: deleting it means losing the result of a real conversation. First use « 📥 Retrieve pending results » on the record of those campaigns.',
    "L'état «":
        'The status «',
    "La LECTURE du résultat n'a pas abouti — aucun appel n'a été passé et rien n'a été écrit. L'identifiant de l'appel est conservé : réessayez plus tard.":
        'READING the outcome failed — no call was placed and nothing was written. The call ID is kept: try again later.',
    'La campagne dont on repart':
        'The campaign to start from',
    "La campagne est créée à\nl'état":
        'The campaign is created in\nthe state',
    "La campagne est seulement préparée. Pour qu'un vrai appel sonne, il faut\nensuite VOS trois gestes : la clé CALL-E dans l'environnement, le\nlancement en mode réel, et le mot APPELER tapé au clavier. Chaque appel\nréel consomme un crédit.":
        'The campaign is only prepared. For a real call to ring, YOUR three\nactions are then needed: the CALL-E key in the environment, the\nlaunch in real mode, and the word APPELER typed on the keyboard. Each real\ncall uses one credit.',
    "La case est cochée, mais le numéro enregistré n'est pas un numéro.":
        'The box is checked, but the saved number is not a number.',
    "La clé d'accès CALL-E a été refusée (code 401 : non authentifié) — elle est fausse, périmée, ou ce n'est pas une clé":
        'The CALL-E access key was rejected (code 401: not authenticated) — it is wrong, expired, or not a key at all',
    "La clé de CALL-E, et rien d'autre. Sans elle, tout l'écran fonctionne : les\nappels sont":
        'The CALL-E key, and nothing else. Without it, the whole screen works: the\ncalls are',
    'La clé elle-même':
        'The key itself',
    'La clé est rangée dans':
        'The key is stored in',
    'La clé et les verrous':
        'The key and the locks',
    'La colonne «':
        'The column «',
    'La date demandée au téléphone était':
        'The date requested on the phone was',
    "La date et l'heure du rendez-vous sont obligatoires.":
        'The appointment date and time are required.',
    'La date et le motif du rendez-vous remplissent les colonnes\n    correspondantes. Les clients sans numéro et les 🚫 « Ne plus appeler »\n    sont écartés et comptés. La liste est bâtie':
        'The appointment date and reason fill the matching\n    columns. Contacts without a number and the 🚫 « Do not call again »\n    are set aside and counted. The list is built',
    "La demande est bel et bien PARTIE vers CALL-E, mais sa réponse n'est jamais revenue : RingBack ne peut pas dire si le téléphone a sonné, et il ne l'invente pas. Vérifiez dans le tableau de bord CALL-E (dashboard.heycall-e.com) avant de rappeler cette personne.":
        'The request DID go out to CALL-E, but its reply never came back: RingBack cannot say whether the phone rang, and it does not make it up. Check the CALL-E dashboard (dashboard.heycall-e.com) before calling this person again.',
    "La demande n'a PAS abouti : personne n'a été appelé, aucun crédit n'a été consommé, et rien n'a été écrit sur les contacts.":
        'The request did NOT go through: nobody was called, no credit was used, and nothing was written to the contacts.',
    'La démonstration en compte':
        'The demonstration contains',
    "La fenêtre du premier lancement reprend TOUS les réglages de cette page,\nun à la fois, dans un ordre qui a un sens. Elle ne demande rien de plus :\nc'est le même produit, présenté autrement.":
        'The first-run window goes through ALL the settings on this page,\none at a time, in an order that makes sense. It asks nothing more:\nit is the same product, shown differently.',
    'La file est vide. « Tout rappeler » y met chaque rendez-vous manqué.':
        'The queue is empty. « Call all back » puts every missed appointment in it.',
    'La file était déjà vide : rien à annuler.':
        'The queue was already empty: nothing to cancel.',
    'La file était vide : aucun appel à passer.':
        'The queue was empty: no call to place.',
    'La grille est vide : ajoutez au moins une personne.':
        'The grid is empty: add at least one person.',
    "La grille se remet dans cet ordre dès que\nvous l'enregistrez : c'est l'ordre réel des appels. Le maximum, lui, ne retire\njamais une ligne déjà là : il limite ce que les prochains chargements\najoutent.":
        'The grid goes back into this order as soon as\nyou save it: it is the real call order. The maximum never removes\na row already there: it limits what the next loads\nadd.',
    'La liste de cette campagne est faite par une':
        "This campaign's list is built by a",
    'La liste se refait à chaque place.':
        'The list is rebuilt for each slot.',
    'La liste se remplira des clients dont le rendez-vous est':
        'The list will fill with contacts whose appointment is',
    'La marche à suivre, les phrases à dire pour chaque issue et les vérifications à faire sont dans':
        'The steps to follow, the sentences to say for each outcome and the checks to make are in',
    "La mission est obligatoire : c'est le message que l'agent lit au téléphone.":
        'The script is required: it is what the agent reads out on the phone.',
    'La nature':
        'The type',
    "La pause et l'arrêt agissent ENTRE deux appels : un\nappel en cours va à son terme — on ne raccroche pas au nez d'un client.":
        'Pause and stop act BETWEEN two calls: a\ncall in progress runs to its end — we do not hang up on a contact.',
    'La personne accepte le créneau libéré : il lui est attribué.':
        'The person accepts the freed slot: it is assigned to them.',
    'La personne décline la proposition.':
        'The person declines the offer.',
    'La personne est intéressée mais demande une autre date ; date convenue.':
        'The person is interested but asks for another date; date agreed.',
    "La personne veut autre chose mais rien n'est convenu : un humain doit la rappeler.":
        'The person wants something else but nothing is agreed: a human must call them back.',
    'La place':
        'The slot',
    'La place du':
        'The slot on',
    "La période interdite PRIME sur tout : aucun appel ni relance ne\n  s'y déclenche ni ne s'y programme, quelle que soit la campagne — un\n  ▶ Démarrer y est réellement refusé.":
        'The blocked period OVERRIDES everything: no call and no follow-up\n  starts or is scheduled during it, whatever the campaign — a\n  ▶ Start there is genuinely refused.',
    "La réponse de CALL-E n'est jamais revenue sur":
        "CALL-E's reply never came back for",
    'La suite tient en trois gestes':
        'The rest takes three actions',
    'La suppression\nretire le contact ET tous ses rendez-vous (avec leurs appels enregistrés) —\nrien de tout cela ne sera récupérable.':
        'Deleting\nremoves the contact AND all their appointments (with their recorded calls) —\nnone of it can be recovered.',
    'La variable de premier lancement est':
        'The first-launch variable is',
    "La variable de premier lancement n'est":
        'The first-run variable is',
    'Laissez le champ\n    vide':
        'Leave the field\n    empty',
    'Lancement refusé : %s':
        'Launch refused: %s',
    "Lancer l'appel —":
        'Start the call —',
    'Lancer la cascade — appeler':
        'Start the cascade — call',
    'Lancer la cascade — appeler en simulation, une personne à la fois':
        'Start the cascade — call in simulation mode, one contact at a time',
    'Lancer les appels':
        'Start the calls',
    'Le COMPTE CALL-E n&#x27;a pas le droit de passer cet appel (code 403 : accès refusé). La clé, elle, a bien été reconnue':
        'The CALL-E ACCOUNT is not allowed to place this call (code 403: access denied). The key itself was recognised',
    "Le COMPTE CALL-E n'a pas le droit de passer cet appel (code 403 : accès refusé). La clé, elle, a bien été reconnue":
        'The CALL-E ACCOUNT is not allowed to place this call (code 403: access denied). The key itself was recognised',
    "Le bouton ouvre l'assistant à l'étape 2, créneau déjà\nrempli —":
        'The button opens the wizard at step 2, slot already\nfilled in —',
    'Le client accepte le créneau de remplacement proposé.':
        'The contact accepts the replacement slot offered.',
    'Le client demande un autre créneau ; nouvelle date convenue.':
        'The contact asks for another slot; new date agreed.',
    'Le client pourra de nouveau être appelé':
        'The contact can be called again',
    'Le client préfère annuler et rappellera lui-même.':
        'The contact prefers to cancel and will call back themselves.',
    "Le client veut déplacer mais ne peut pas fixer de date aujourd'hui : à relancer.":
        'The contact wants to move it but cannot set a date today: to follow up.',
    "Le compte CALL-E n'a plus de crédit (code 402 : paiement requis)":
        'The CALL-E account is out of credit (code 402: payment required)',
    "Le déplacement n'a pas pu se faire :":
        'The move could not be done:',
    'Le faire quand même à la main':
        'Do it by hand anyway',
    'Le format iCalendar, exporté par la plupart des agendas\n(Google&nbsp;Agenda, Outlook, Thunderbird…). Un rendez-vous sans téléphone\narrive « sans numéro », à compléter ensuite — jamais de numéro\ninventé.':
        'The iCalendar format, exported by most calendars\n(Google&nbsp;Calendar, Outlook, Thunderbird…). An appointment with no phone\narrives as « no number », to be filled in later — never an invented\nnumber.',
    "Le garde-fou de politesse sert à ne pas déranger de vraies personnes — en simulation, il n'y a personne à déranger. Vous pouvez donc passer outre pour cette campagne.":
        'The courtesy safeguard is there to avoid disturbing real people — in simulation, there is nobody to disturb. So you can override it for this campaign.',
    'Le message':
        'The script',
    'Le message de cette campagne':
        "This campaign's script",
    "Le message à dire au téléphone est vide : revenez à l'étape ② pour l'écrire.":
        'The script to read on the phone is empty: go back to step ② to write it.',
    'Le motif du rendez-vous est obligatoire.':
        'The appointment reason is required.',
    "Le nom de l'entreprise n'est pas encore réglé : saisissez-le ici une fois, il sera repris automatiquement par toutes les campagnes suivantes (modifiable dans":
        'The practice name is not set yet: enter it here once, and every later campaign will reuse it automatically (editable in',
    'Le nom du client est obligatoire (deux caractères minimum).':
        'The contact name is required (two characters minimum).',
    "Le nom du testeur est obligatoire (deux caractères minimum) : il sert à savoir QUI devra jouer quel rôle au téléphone — par exemple « moi », « Paul », « le cabinet d'à côté ».":
        'The tester name is required (two characters minimum): it tells WHO will play which role on the phone — for example « me », « Paul », « the practice next door ».',
    'Le nom du testeur est trop long (':
        'The tester name is too long (',
    'Le numéro du testeur n°':
        'The number of tester no.',
    'Le premier choix remplit la date pour vous ; « date libre » la\n  laisse à votre main, et vous pouvez de toute façon la corriger après coup.':
        'The first choice fills the date for you; « free date » leaves\n  it to you, and you can correct it afterwards anyway.',
    "Le premier clic mène au trou libre le plus proche ; chaque clic suivant au trou d'après":
        'The first click goes to the nearest free gap; each further click to the next one',
    'Le rendez-vous dont cette campagne parle a changé':
        'The appointment this campaign is about has changed',
    'Le rendez-vous le plus LOINTAIN d&#x27;abord':
        'The FURTHEST appointment first',
    "Le rendez-vous le plus LOINTAIN d'abord":
        'The FURTHEST appointment first',
    'Le rendez-vous le plus PROCHE d&#x27;abord':
        'The NEAREST appointment first',
    "Le rendez-vous le plus PROCHE d'abord":
        'The NEAREST appointment first',
    'Le rendez-vous le plus lointain a le plus à gagner à avancer sur la place qui se libère.':
        'The furthest appointment has the most to gain from moving up to the slot that frees up.',
    "Le rendez-vous le plus proche est le plus urgent à traiter ; le plus lointain laisse le temps de s'organiser.":
        'The nearest appointment is the most urgent to handle; the furthest leaves time to get organised.',
    'Le rendez-vous redevient « manqué » et réapparaît dans « À rappeler »':
        'The appointment becomes « missed » again and reappears in « To call back »',
    "Le renvoi d'essai est actif":
        'Test forwarding is active',
    "Le renvoi d'essai est actif (⚙ Réglages → 🧪 Essais → Jeu d'essai), mais le numéro enregistré n'a pas la forme d'un numéro composable":
        'Test forwarding is on (⚙ Settings → 🧪 Tests → Test data), but the saved number is not shaped like a dialable number',
    'Le réglage':
        'The setting',
    "Le service CALL-E a refusé un appel de plus pour l'instant (code 429 : trop d'appels en trop peu de temps)":
        'The CALL-E service refused one more call for now (code 429: too many calls in too little time)',
    'Le service CALL-E est en panne : il a répondu':
        'The CALL-E service is down: it replied',
    'Le service CALL-E est injoignable depuis cet ordinateur (':
        'The CALL-E service is unreachable from this computer (',
    "Le texte d'ouverture de toutes les campagnes de cette nature":
        'The opening text of every campaign of this nature',
    'Le texte exact qui sera copié':
        'The exact text that will be copied',
    "Le texte que l'agent lira (jamais de numéro dedans)":
        'The text the agent will read (never a number in it)',
    'Le titre « Nom — Motif » remplit la colonne motif, la date remplit\n  le rendez-vous existant ; le numéro est cherché chez les clients connus,\n  sinon le contact arrive « sans numéro », à compléter avant validation —\n  jamais de numéro inventé.':
        'The title « Name — Reason » fills the reason column, the date fills\n  the existing appointment; the number is looked up among known contacts,\n  otherwise the contact arrives « without a number », to complete before validation —\n  never an invented number.',
    "Le vrai livrable de cette campagne : ce qu'il reste à saisir dans votre\nlogiciel de planification. Une ligne par changement, rien à déduire.":
        'The real deliverable of this campaign: what is left to enter in your\nscheduling software. One row per change, nothing to work out.',
    'Lefèvre, ou 0600000042':
        'Lefèvre, or 0600000042',
    'Les':
        'The',
    'Les 5 plus récentes :':
        'The 5 most recent:',
    'Les campagnes déjà jouées, elles, restent : leurs résultats sont un\nhistorique, réutilisable pour créer de nouvelles campagnes.':
        'Campaigns already run do stay: their results are a\nhistory, reusable to create new campaigns.',
    'Les contacts sans numéro et ceux marqués 🚫 « Ne plus appeler »\n  sont écartés et comptés ; ceux déjà dans la grille ne sont pas\n  redoublés.':
        'Contacts without a number and those marked 🚫 « Do not call again »\n  are set aside and counted; those already in the grid are not\n  duplicated.',
    'Les formats acceptés':
        'Accepted formats',
    'Les heures sont découpées en':
        'Hours are split into',
    "Les numéros restent masqués à l'écran ; la colonne Téléphone se\n  corrige en tapant un nouveau numéro. Les appels (":
        'Numbers stay hidden on screen; the Phone column is\n  corrected by typing a new number. The calls (',
    "Les numéros sortent des six racines que l'Arcep réserve aux œuvres\naudiovisuelles : ils ne sont attribués à personne, et ne peuvent donc ni appeler\nni être appelés. Un essai ne peut pas sonner chez un inconnu.":
        'The numbers come from the six ranges Arcep reserves for audiovisual\nworks: they are assigned to no one, and so can neither call\nnor be called. A test can never ring a stranger.',
    'Les personnes':
        'The people',
    'Les personnes à appeler (':
        'The people to call (',
    'Les personnes, une par une':
        'The people, one by one',
    "Les places qu'il peut proposer":
        'The slots it can offer',
    "Les premières places libres de l'agenda, dans l'ordre :":
        'The first free slots in the schedule, in order:',
    "Les premières places qu'il annoncera :":
        'The first slots it will announce:',
    'Les relances':
        'The follow-ups',
    "Les rendez-vous de cette plage n'existent plus. Recommencez votre sélection sur le planning.":
        'The appointments in this range no longer exist. Start your selection again on the schedule.',
    'Les rendez-vous ont été posés sur vos premières places réellement libres.':
        'The appointments have been placed on your first genuinely free slots.',
    'Les rôles sont répartis sur':
        'The roles are spread over',
    'Les trois gestes':
        'The three actions',
    "Leur téléphone a sonné et la conversation a pu avoir lieu : c'est\nseulement la réponse de CALL-E qui n'est pas arrivée à temps. Personne n'est\nmarqué « injoignable », aucune tentative ne leur a été comptée, et aucun\nrendez-vous n'a bougé. Le numéro de chaque appel chez CALL-E a été conservé.":
        "Their phone rang and the conversation may well have taken place: only\nCALL-E's reply did not arrive in time. Nobody is\nmarked « unreachable », no attempt has been counted against them, and no\nappointment has moved. The CALL-E reference of each call has been kept.",
    "Libre d'affilée":
        'Free in a row',
    'Lieu':
        'Location',
    'Lieu (si plusieurs)':
        'Location (if several)',
    'Ligne':
        'Line',
    'Ligne vide ajoutée — remplissez-la puis « Enregistrer la grille ».':
        'Empty row added — fill it in, then « Save the grid ».',
    'Ligne à retirer introuvable.':
        'Row to remove not found.',
    "Liste d'attente — une ligne par personne : « Nom;Téléphone »\n    (virgule ou tabulation acceptées) ; générée ou collée, elle reste\n    modifiable et réordonnable à la main":
        'Waiting list — one line per contact: « Name;Phone »\n    (comma or tab also accepted); generated or pasted, it stays\n    editable and reorderable by hand',
    'Liste de campagnes inconnue.':
        'Unknown campaign list.',
    'Liste des personnes':
        'List of people',
    'Liste des personnes :':
        'List of people:',
    'Liste effacée :':
        'List cleared:',
    'Liste introuvable':
        'List not found',
    'Liste vide : collez une ligne par personne (« Nom;Téléphone »).':
        'Empty list: paste one line per person (« Name;Phone »).',
    'Liste vide : collez une ligne par personne — attendu «':
        'Empty list: paste one line per person — expected «',
    "Liste épuisée : personne n'a pris le créneau. Il reste à pourvoir — élargissez la liste ou proposez-le autrement.":
        'List exhausted: nobody took the slot. It is still to fill — widen the list or offer it another way.',
    'Logo RingBack':
        'RingBack logo',
    'Lundi de Pentecôte':
        'Whit Monday',
    'Lundi de Pâques':
        'Easter Monday',
    'MM.':
        'Messrs.',
    'MODE RÉEL':
        'REAL MODE',
    "MODE RÉEL — chaque exécution passe de VRAIS appels ; les numéros restent masqués à l'écran.":
        'REAL MODE — every run places REAL calls; numbers stay hidden on screen.',
    'Manuel':
        'Manual',
    'Mar':
        'Mar',
    'March':
        'March',
    'Marquées « Ne plus appeler » : jamais composées, même présentes dans la liste.':
        'Marked « Do not call again »: never dialled, even when present in the list.',
    'Maximum de rappels ramené de %d à %d (ancien défaut, jamais choisi) — modifiable dans ⚙ Réglages.':
        'Maximum callbacks brought down from %d to %d (old default, never chosen) — can be changed in ⚙ Settings.',
    'Migration : colonne %s.note ajoutée':
        'Migration: column %s.note added',
    "Migration : colonne appels.appel_externe_id ajoutée (l'identifiant de l'appel chez CALL-E)":
        "Migration: column appels.appel_externe_id added (the call's ID at CALL-E)",
    "Migration : colonne appels_cascade.rendezvous_libere ajoutée (l'ancien rendez-vous rendu par cet appel)":
        'Migration: column appels_cascade.rendezvous_libere added (the old appointment given back by this call)',
    'Migration : colonne campagnes.%s ajoutée':
        'Migration: column campagnes.%s added',
    'Migration : colonne clients.jeu_essai ajoutée':
        'Migration: column clients.jeu_essai added',
    'Migration : colonne clients.ne_plus_appeler ajoutée':
        'Migration: column clients.ne_plus_appeler added',
    'Migration : colonne clients.plus_de_proposition ajoutée (0 = reçoit les propositions, comme avant)':
        'Migration: column clients.plus_de_proposition added (0 = receives offers, as before)',
    'Migration : colonne contacts_campagne.%s ajoutée':
        'Migration: column contacts_campagne.%s added',
    "Migration : colonne contacts_campagne.appel_externe_id ajoutée (l'appel parti dont le résultat reste à récupérer)":
        'Migration: column contacts_campagne.appel_externe_id added (the call sent out whose outcome is still to be fetched)',
    'Migration : colonne contacts_campagne.appel_externe_tentative ajoutée':
        'Migration: column contacts_campagne.appel_externe_tentative added',
    'Migration : colonne contacts_campagne.client_id ajoutée (lien vers la fiche client)':
        'Migration: column contacts_campagne.client_id added (link to the contact record)',
    'Migration : colonne rendezvous.duree_tranches ajoutée (les rendez-vous existants valent une tranche)':
        'Migration: column rendezvous.duree_tranches added (existing appointments count as one block)',
    'Migration : colonne rendezvous.rappel_souhaite ajoutée':
        'Migration: column rendezvous.rappel_souhaite added',
    'Mission de la campagne : «':
        'Campaign script: «',
    "Mission lue par l'agent (dépliable)":
        'Script read by the agent (expandable)',
    "Mission lue par l'agent : «":
        'Script read by the agent: «',
    "Mission — le texte que l'agent lit, pré-rempli par le thème et":
        'Script — the text the agent reads, pre-filled from the theme and',
    'Mlle':
        'Miss',
    'Mlles':
        'Misses',
    'Mme':
        'Mrs',
    'Mme Exemple Un;+33 6 00 00 00 51&#10;M. Exemple Deux, 06 00 00 00 52':
        'Ms Example One;+33 6 00 00 00 51&#10;Mr Example Two, 06 00 00 00 52',
    'Mmes':
        'Mmes',
    'Mode de saisie':
        'Entry mode',
    "Mode simulation — aucun appel réel n'est émis.":
        'Simulation mode — no real call is made.',
    'Modifier ou retirer un testeur':
        'Edit or remove a tester',
    'Modifier sa fiche':
        'Edit their record',
    'Modifier…':
        'Edit…',
    "Mon numéro d'essai — 10 chiffres commençant par 0 (06 39 98 00 00),\n    ou +33 suivi de 9 chiffres — aucun numéro enregistré":
        'My test number — 10 digits starting with 0 (06 39 98 00 00),\n    or +33 followed by 9 digits — no number saved',
    "Mon numéro d'essai — un numéro français (10 chiffres commençant\n    par 0, comme 06 39 98 00 00) ou un numéro international avec son indicatif\n    (+44 20 7946 0958) —":
        'My test number — a French number (10 digits starting\n    with 0, like 06 39 98 00 00) or an international number with its country code\n    (+44 20 7946 0958) —',
    'Monday':
        'Monday',
    "Monter la campagne — l'assistant s'ouvre à\n  l'étape 2, personne n'est appelé":
        'Build the campaign — the wizard opens at\n  step 2, nobody is called',
    'Motif':
        'Reason',
    'Motif :':
        'Reason:',
    'Motif : Bilan nutrition':
        'Reason: Bilan nutrition',
    'Motif : Coupe et barbe':
        'Reason: Coupe et barbe',
    'Motif : Cours de guitare':
        'Reason: Cours de guitare',
    'Motif : Séance de kinésithérapie':
        'Reason: Séance de kinésithérapie',
    'Motif du rendez-vous':
        'Appointment reason',
    'Motif souhaité (si fourni)':
        'Requested reason (if given)',
    "Motif, facultatif (« vacances d'été », « formation »)":
        'Reason, optional (« summer holidays », « training »)',
    'Mêmes colonnes que le collage (':
        'Same columns as the paste (',
    'Nature / thème':
        'Nature / theme',
    'Nature :':
        'Nature:',
    'Nature de campagne inconnue : «':
        'Unknown campaign type: «',
    'Nature de campagne inconnue.':
        'Unknown campaign type.',
    'Ne garder que':
        'Keep only',
    'Ne plus appeler':
        'Do not call again',
    'Ne plus appeler — demandé au téléphone':
        'Do not call again — requested on the phone',
    'Ne plus proposer de créneau — demandé au téléphone':
        'No more slot offers — requested on the phone',
    'Nom':
        'Name',
    "Nom de l'entreprise":
        'Practice name',
    "Nom de l'entreprise mémorisé dans les réglages.":
        'Practice name saved in the settings.',
    "Nom de l'entreprise — remplace [entreprise] dans les missions":
        'Practice name — replaces [entreprise] in scripts',
    'Nom du contact':
        'Contact name',
    'Nom du contact (deux caractères minimum)':
        'Contact name (two characters minimum)',
    "Nom du testeur — qui est-ce ? (« moi », « Paul », « le cabinet\n    d'à côté »)":
        'Tester name — who is it? (« me », « Paul », « the practice\n    next door »)',
    "Nombre d'identités illisible : «":
        'Unreadable number of identities: «',
    'Nombre de personnes réellement jointes (0 ou 1).':
        'Number of people actually reached (0 or 1).',
    'Nombre maximal de rappels':
        'Maximum number of callbacks',
    'Nombre maximal de rappels : entre 0 et 9 (reçu «':
        'Maximum callbacks: between 0 and 9 (received «',
    'Nombre refusé :':
        'Value refused:',
    'Non joints — maximum de rappels atteint':
        'Not reached — maximum callbacks reached',
    'Non, je ne pourrai pas venir, annulez mon rendez-vous.':
        "No, I won't be able to come, cancel my appointment.",
    'Nous':
        'We',
    "Nous n'avons pas pu déterminer si cette personne était intéressée par la place. Elle conserve son rendez-vous":
        'We could not determine whether this person was interested in the slot. They keep their appointment',
    'Nouveau créneau en ISO 8601 ; nul si le client annule ou ne conclut pas de date (to_reschedule).':
        'New slot in ISO 8601; null if the contact cancels or no date is agreed (to_reschedule).',
    'Nouveau créneau — seuls\n    ceux où':
        'New slot — only\n    those where',
    'Nouvelle campagne':
        'New campaign',
    'Nouvelle campagne — message':
        'New campaign — script',
    'Nouvelle campagne — nature':
        'New campaign — type',
    'Nouvelle campagne — nature — RingBack':
        'New campaign — type — RingBack',
    'Nouvelle campagne — personnes':
        'New campaign — people',
    'Nouvelle date':
        'New date',
    'Nouvelle date convenue :':
        'New date agreed:',
    'Nouvelle relance programmée':
        'New follow-up scheduled',
    'Nov':
        'Nov',
    'November':
        'November',
    'Noël':
        'Christmas Day',
    'Numéro actuel :':
        'Current number:',
    'Numéro complété pour le client n°%d : %s':
        'Number completed for contact no. %d: %s',
    "Numéro d'essai %s":
        'Test number %s',
    "Numéro d'essai retiré (%s) : le renvoi est arrêté":
        'Test number removed (%s): forwarding stopped',
    "Numéro d'essai ». Un numéro déjà déclaré n'est":
        'Test number ». A number already declared is not',
    'Numéro de téléphone invalide : attendu 10 chiffres commençant par 0, ou +33 suivi de 9 chiffres (exemple fictif : +33 6 00 00 00 42).':
        'Invalid phone number: expected 10 digits starting with 0, or +33 followed by 9 digits (fictional example: +33 6 00 00 00 42).',
    'Numéro de téléphone invalide : attendu un numéro français (10 chiffres commençant par 0), ou un numéro international avec son indicatif — « + » suivi de 8 à 15 chiffres (exemple fictif : +44 20 7946 0958).':
        'Invalid phone number: expected a French number (10 digits starting with 0), or an international number with its country code — « + » followed by 8 to 15 digits (fictional example: +44 20 7946 0958).',
    'Numéro de téléphone — format attendu : 10 chiffres commençant par 0,\n    ou +33 suivi de 9 chiffres (exemple fictif : +33 6 00 00 00 42)':
        'Phone number — expected format: 10 digits starting with 0,\n    or +33 followed by 9 digits (fictitious example: +33 6 00 00 00 42)',
    'Numéro refusé :':
        'Number refused:',
    'Oct':
        'Oct',
    'October':
        'October',
    'Options de comportement':
        'Behaviour options',
    'Options par défaut enregistrées pour la nature « %s ».':
        'Default options saved for the « %s » type.',
    'Options recopiées de « %s » vers « %s ».':
        'Options copied from « %s » to « %s ».',
    'Options reprises de «':
        'Options taken from «',
    "Options revenues aux valeurs d'origine.":
        'Options reset to their original values.',
    'Ordre':
        'Order',
    "Ordre d'appel":
        'Call order',
    "Ordre d'appel :":
        'Call order:',
    "Ordre d'appel —":
        'Call order —',
    "Ordre d'appel —\n  qui est appelé en premier":
        'Call order —\n  who is called first',
    'Ordre de la liste':
        'List order',
    'Origine':
        'Origin',
    'Origine de la demande (ex. « vous avez demandé un rendez-vous sur notre site »)':
        'Where the request came from (e.g. « you requested an appointment on our website »)',
    "Oui, c'est noté, je serai là.":
        "Yes, noted, I'll be there.",
    "Ouvre l'assistant à l'étape 2, ce contact déjà en liste — aucun appel n'est passé":
        'Opens the wizard at step 2 with this contact already listed — no call is placed',
    "Ouvre une fenêtre : toute la semaine, ou des jours choisis — aucun appel n'est passé":
        'Opens a window: the whole week, or chosen days — no call is placed',
    'Ouvrez le tableau de bord':
        'Open the dashboard',
    'Ouvrir':
        'Open',
    "Ouvrir son dossier et modifier son nom, son numéro ou l'indicateur 🚫":
        'Open their record and change their name, their number or the 🚫 flag',
    'Page inconnue.':
        'Unknown page.',
    'Page précédente':
        'Previous page',
    'Page suivante':
        'Next page',
    'Pages de cette section':
        'Pages in this section',
    'Par prudence, la liste (qui contient des numéros de téléphone) est à recoller.':
        'As a precaution, the list (which contains phone numbers) must be pasted again.',
    'Par prudence, le numéro de téléphone est à ressaisir.':
        'As a precaution, the phone number must be entered again.',
    'Par qui':
        'By whom',
    'Paramètres de la campagne':
        'Campaign settings',
    'Parcours direct conservé — chaque cascade lancée ici est\nenregistrée comme':
        'Direct path kept — every cascade started here is\nrecorded as',
    'Parcours direct conservé — chaque exécution de la file est\nenregistrée comme':
        'Direct path kept — every run of the queue is\nrecorded as',
    'Pas de réponse':
        'No answer',
    'Pas de réponse. AUCUNE relance programmée : elle serait tombée le':
        'No answer. NO follow-up scheduled: it would have fallen on',
    'Pas encore de résultat.':
        'No result yet.',
    "Pas encore — je vais vérifier l'agenda":
        'Not yet — I will check the schedule',
    'Passer à la suite':
        'Move on',
    'Passez cette page':
        'Skip this page',
    'Personnalisé':
        'Custom',
    'Personnalisé (retiré)':
        'Custom (removed)',
    'Personne':
        'Person',
    'Personne appelée :':
        'Person called:',
    "Personne n'a atteint son maximum de rappels : aucune chaîne ne s'est arrêtée faute d'avoir joint la personne.":
        'No one has reached their maximum callbacks: no chain has stopped for failure to reach the contact.',
    "Personne n'a été appelé : le message annonce des créneaux calculés par RingBack, et il n'en reste plus AUCUN de libre dans les":
        'Nobody was called: the script announces slots computed by RingBack, and there is NOT ONE free left in the',
    "Personne n'a été appelé : plus aucune place libre à proposer dans les":
        'Nobody was called: no free slot left to offer in the',
    "Personne n'a été appelé et aucun crédit CALL-E n'a été consommé.":
        'Nobody was called and no CALL-E credit was used.',
    "Personne n'a été appelé.":
        'Nobody was called.',
    "Personne n'est appelé : vous traversez les trois étapes.":
        'Nobody is called: you go through the three steps.',
    "Personne à rappeler sur cette période : les rendez-vous trouvés n'ont pas de numéro, ou leurs clients sont marqués 🚫 « ne plus appeler ».":
        'Nobody to call back in this period: the appointments found have no number, or their contacts are marked 🚫 « do not call again ».',
    'Personnes appelées (':
        'People called (',
    'Personnes exclues (':
        'People excluded (',
    'Personnes non appelées (':
        'People not called (',
    'Place du':
        'Slot on',
    'Place proposée :':
        'Slot offered:',
    'Place qui vient de se libérer :':
        'Slot that has just opened up:',
    "Places libres à proposer en cas d'annulation (calculées ; vide = l'agent n'annonce aucune date)":
        'Free slots to offer if there is a cancellation (computed; empty = the agent announces no date)',
    'Plage':
        'Range',
    'Plage d&#x27;appel':
        'Calling window',
    "Plage d'appel":
        'Calling window',
    "Plage d'appel :":
        'Calling window:',
    "Plage d'appel autorisée — début":
        'Permitted calling window — start',
    "Plage d'appel autorisée — fin":
        'Permitted calling window — end',
    'Plage horaire : heure de':
        'Time range: time of',
    "Plage horaire : l'heure de début doit précéder l'heure de fin.":
        'Time range: the start time must come before the end time.',
    'Plage horaire respectée\n  (':
        'Calling window respected\n  (',
    'Plage illisible':
        'Unreadable range',
    'Plage illisible — RingBack':
        'Unreadable range — RingBack',
    'Plage sélectionnée':
        'Selected range',
    "Planning : plage sélectionnée → brouillon d'assistant avec %d place(s) — aucun appel":
        'Schedule: range selected → wizard draft with %d slot(s) — no call',
    'Planning : rendez-vous n°%d passé « %s » depuis la modale — %s libérée(s) — %s':
        'Schedule: appointment #%d set to « %s » from the dialog — %s freed — %s',
    'Planning → assistant : campagne « %s » depuis une plage (%d contact(s), dont %d à compléter ; %d 🚫, %d doublon(s) écarté(s)) — aucun appel':
        'Schedule → wizard: campaign « %s » from a range (%d contact(s), %d of them to complete; %d 🚫, %d duplicate(s) set aside) — no call',
    "Planning → assistant : campagne « %s » ouverte à l'étape 2 sur le rendez-vous n°%d (1 contact) — aucun appel":
        'Schedule → wizard: campaign « %s » opened at step 2 on appointment #%d (1 contact) — no call',
    'Planning → assistant : campagne « rappel_rdv » sur %s (%d contact(s)) — aucun appel':
        'Schedule → wizard: campaign « rappel_rdv » on %s (%d contact(s)) — no call',
    'Plus aucun rendez-vous':
        'No appointment left',
    'Plus de créneau au-delà du n°':
        'No slot beyond #',
    "Plus personne ne correspond à ce filtre : la liste a changé entre l'affichage et le clic (une campagne a pu prendre ces clients entre-temps). Revenez à 👥 Contacts, le compte y sera à jour.":
        'Nobody matches this filter any more: the list changed between display and click (a campaign may have taken these contacts in the meantime). Go back to 👥 Contacts, the count there will be up to date.',
    'Plusieurs places sont libres, propose-les dans cet ordre :':
        'Several slots are free, offer them in this order:',
    "Politique d'appel":
        'Call policy',
    "Politique d'appel :":
        'Call policy:',
    "Politique d'appel par défaut :":
        'Default call policy:',
    "Politique d'appel par défaut :\n    séquentiel, arrêt au premier OUI":
        'Default calling policy:\n    sequential, stop at the first YES',
    "Politique d'appel par défaut :\n    tout le monde ; non-réponse → relance":
        'Default calling policy:\n    everyone; no answer → follow-up',
    "Politique d'appel par défaut :\n    tout le monde ; pas joint → relance, origine conservée":
        'Default calling policy:\n    everyone; not reached → follow-up, origin kept',
    "Politique d'appel par défaut :\n    tout le monde est appelé":
        'Default calling policy:\n    everyone is called',
    "Politique d'appel par défaut :\n    tout le monde est appelé ; rien n&#x27;est supprimé avant accord":
        'Default calling policy:\n    everyone is called; nothing is deleted without agreement',
    "Pour corriger d'abord :":
        'To fix first:',
    "Pour finir : souhaitez-vous maintenir ce rendez-vous, ou faut-il l'annuler ? Si vous l'annulez, je libère la place pour quelqu'un d'autre.":
        "One last thing: do you want to keep this appointment, or should I cancel it? If you cancel it, I'll free the slot for someone else.",
    "Pour l'ouvrir sans attendre :":
        'To open it right away:',
    "Pour les reprendre, une campagne de rattrapage se construit depuis les 📵 injoignables d'une campagne passée (":
        'To take them up again, a catch-up campaign is built from the 📵 unreachable contacts of a past campaign (',
    'Pour que les appels partent':
        'For calls to go out',
    'Pour éprouver une campagne entière avec de':
        'To test a whole campaign with',
    'Pourquoi':
        'Why',
    'Pourquoi / demande':
        'Why / request',
    'Première page':
        'First page',
    'Prise de rendez-vous':
        'Appointment booking',
    'Prochain créneau disponible n°':
        'Next available slot #',
    'Prochaine relance':
        'Next follow-up',
    "Programmées elles aussi, mais leur échéance n'est pas encore là. Chacune":
        'Scheduled as well, but their due time has not come yet. Each one',
    "Proposer ces heures à quelqu'un d'autre reviendrait à donner un\n  rendez-vous un jour où personne n'est là.":
        'Offering these hours to someone else would mean giving an\n  appointment on a day when nobody is there.',
    'Proposer de nouveau des créneaux':
        'Offer slots again',
    'Proposer une autre date si le contact annule':
        'Offer another date if the contact cancels',
    "Proposer une autre date si le contact annule pendant l'appel":
        'Offer another date if the contact cancels during the call',
    'Proximité du créneau proposé — le plus proche d&#x27;abord':
        'Closeness of the offered slot — nearest first',
    'Proximité du créneau — le plus proche du créneau d&#x27;abord':
        'Slot proximity — closest to the slot first',
    "Proximité du créneau — le plus proche du créneau d'abord":
        'Slot proximity — closest to the slot first',
    "Préparer l'essai en conditions réelles ?":
        'Prepare the real-conditions test?',
    "Préparer la campagne d'essai (aucun appel)":
        'Prepare the test campaign (no call)',
    "Préparer la campagne d'essai en conditions réelles ?":
        'Prepare the test campaign under real conditions?',
    'Préparer le rappel':
        'Prepare the callback',
    "Préparer une campagne d'essai réel…":
        'Prepare a real-call test campaign…',
    'Présence confirmée':
        'Attendance confirmed',
    'Prévenez chaque testeur de son rôle':
        'Tell each tester their role',
    'Prêtes':
        'Ready',
    "Prêtes — personne n'est appelé avant ▶ Démarrer":
        'Ready — nobody is called before ▶ Start',
    'Puis-je compter sur votre présence, oui ou non ?':
        'Can I count on you being there, yes or no?',
    'Période':
        'Period',
    'Période interdite : donnez les DEUX bornes (début et fin), ou laissez les deux vides.':
        'Forbidden period: give BOTH bounds (start and end), or leave both empty.',
    'Période interdite : heures illisibles (attendu HH:MM, ex. 20:00 → 08:00).':
        'Forbidden period: unreadable times (expected HH:MM, e.g. 20:00 → 08:00).',
    "Période vide : l'heure de fin doit venir après l'heure de début (reçu":
        'Empty period: the end time must come after the start time (received',
    'Qu&#x27;est-ce qu&#x27;un fichier ICS, et que charge celui-ci ?':
        'What is an ICS file, and what does this one load?',
    "Qu'est-ce qu'un fichier ICS, et que charge celui-ci ?":
        'What is an ICS file, and what does this one load?',
    'Quand':
        'When',
    "Quand RingBack a le droit d'appeler":
        'When RingBack is allowed to call',
    'Quand appeler':
        'When to call',
    "Quand il a le droit d'appeler":
        'When it is allowed to call',
    'Quand rappeler':
        'When to call back',
    'Que faire :':
        'What to do:',
    "Que faire : attendez quelques minutes, puis reprenez la campagne — elle repartira où elle s'est arrêtée. Si cela recommence, vérifiez les limites de votre compte dans le tableau de bord CALL-E.":
        'What to do: wait a few minutes, then resume the campaign — it will start again where it stopped. If it happens again, check your account limits in the CALL-E dashboard.',
    'Que faire : ce n&#x27;est PAS un problème de clé — elle a été reconnue, sinon CALL-E aurait répondu « clé invalide » (401). La recoller ou en recréer une ne changera rien. C&#x27;est le COMPTE qui est refusé : ouvrez dashboard.heycall-e.com et regardez l&#x27;état du compte lui-même — crédits épuisés, période d&#x27;essai terminée, compte à activer ou à vérifier, moyen de paiement manquant. Si le tableau de bord paraît normal, c&#x27;est à CALL-E qu&#x27;il faut le demander : citez-leur le message ci-dessus mot pour mot.':
        'What to do: this is NOT a key problem — the key was recognised, otherwise CALL-E would have answered « invalid key » (401). Pasting it again or creating a new one will change nothing. It is the ACCOUNT that is refused: open dashboard.heycall-e.com and look at the state of the account itself — credits used up, trial period over, account to activate or verify, missing payment method. If the dashboard looks normal, it is CALL-E you must ask: quote them the message above word for word.',
    "Que faire : ce n'est PAS un problème de clé — elle a été reconnue, sinon CALL-E aurait répondu « clé invalide » (401). La recoller ou en recréer une ne changera rien. C'est le COMPTE qui est refusé : ouvrez dashboard.heycall-e.com et regardez l'état du compte lui-même — crédits épuisés, période d'essai terminée, compte à activer ou à vérifier, moyen de paiement manquant. Si le tableau de bord paraît normal, c'est à CALL-E qu'il faut le demander : citez-leur le message ci-dessus mot pour mot.":
        'What to do: this is NOT a key problem — the key was recognised, otherwise CALL-E would have answered « invalid key » (401). Pasting it again or creating a new one will change nothing. It is the ACCOUNT that is refused: open dashboard.heycall-e.com and look at the state of the account itself — credits used up, trial period over, account to activate or verify, missing payment method. If the dashboard looks normal, it is CALL-E you must ask: quote them the message above word for word.',
    "Que faire : ce n'est pas RingBack qui est en cause — attendez que le service CALL-E réponde à nouveau (page d'état ou support CALL-E), puis reprenez la campagne.":
        'What to do: RingBack is not at fault — wait until the CALL-E service responds again (CALL-E status page or support), then resume the campaign.',
    "Que faire : la demande envoyée à CALL-E a été refusée — c'est un défaut de RingBack, pas de la personne appelée. Lisez la réponse de l'API citée ci-dessus : elle nomme le champ en cause. Une fois corrigé, reprenez la campagne : elle repartira où elle s'est arrêtée, et personne n'aura été appelé deux fois.":
        'What to do: the request sent to CALL-E was rejected — this is a RingBack defect, not a problem with the person called. Read the API response quoted above: it names the field at fault. Once fixed, resume the campaign: it will start again where it stopped, and nobody will have been called twice.',
    "Que faire : la réponse brute de CALL-E est conservée sur la fiche et dans le journal d'audit — elle dit exactement ce que RingBack n'a pas su lire. Rappelez cette personne vous-même pour confirmer ce qui a été convenu, signalez la réponse brute pour que RingBack apprenne à la lire, puis reprenez la campagne.":
        "What to do: CALL-E's raw response is kept on the record and in the audit log — it says exactly what RingBack could not read. Call this person back yourself to confirm what was agreed, report the raw response so RingBack learns to read it, then resume the campaign.",
    "Que faire : ouvrez le tableau de bord CALL-E (dashboard.heycall-e.com), section « API keys », copiez LA CLÉ elle-même — pas l'adresse du site — dans le fichier call-e-key.txt, lancez configurer_cle.cmd, puis relancez RingBack.":
        'What to do: open the CALL-E dashboard (dashboard.heycall-e.com), « API keys » section, copy THE KEY itself — not the site address — into the call-e-key.txt file, run configurer_cle.cmd, then restart RingBack.',
    "Que faire : rechargez le compte dans le tableau de bord CALL-E (dashboard.heycall-e.com), puis reprenez la campagne — elle repartira où elle s'est arrêtée.":
        'What to do: top up the account in the CALL-E dashboard (dashboard.heycall-e.com), then resume the campaign — it will start again where it stopped.',
    "Que faire : vérifiez la connexion Internet de cet ordinateur, puis reprenez la campagne — elle repartira où elle s'est arrêtée.":
        "What to do: check this computer's Internet connection, then resume the campaign — it will start again where it stopped.",
    'Que fait ce renvoi ?':
        'What does this redirection do?',
    'Quels clients':
        'Which contacts',
    'Quels moments vous conviendraient ?':
        'What times would suit you?',
    'Quels rendez-vous':
        'Which appointments',
    'Qui':
        'Who',
    'Qui devra jouer quoi':
        'Who will play what',
    'Qui est appelé en premier':
        'Who is called first',
    "Qui l'occupait":
        'Who held it',
    'Raison simple et honnête (ex. « un imprévu dans notre planning »)':
        'Simple, honest reason (e.g. « something unexpected in our schedule »)',
    "Rappel d'appel manqué":
        'Missed call reminder',
    'Rappel de rendez-vous':
        'Appointment reminder',
    'Rappel de rendez-vous manqués':
        'Missed appointment reminder',
    'Rappel impossible':
        'Callback not possible',
    "Rappel marqué « c'est fait » : il sort de la liste. Rien n'est effacé — la demande du contact reste sur la fiche de sa campagne.":
        "Callback marked « done »: it leaves the list. Nothing is deleted — the contact's request stays on their campaign record.",
    'Rappel remis dans la liste : il reste à faire.':
        'Callback put back in the list: it is still to do.',
    'Rappel souhaité':
        'Callback requested',
    'Rappel souhaité :':
        'Callback requested:',
    'Rappeler (RÉEL)':
        'Call back (REAL)',
    'Rappeler (simulé)':
        'Call back (simulated)',
    'Rappeler entre':
        'Call back between',
    'Rappels par un humain':
        'Callbacks by a human',
    "Recharger le jeu d'essai…":
        'Reload the test data…',
    'Recharger les valeurs par défaut':
        'Reload the default values',
    'Rechercher un contact — nom ou numéro':
        'Search for a contact — name or number',
    'Recontacter si non joignable':
        'Call back if unreachable',
    'Recontacter si non joignable :':
        'Call back if unreachable:',
    'Refus :':
        'Refusal:',
    'Refusé':
        'Declined',
    'Refusé :':
        'Declined:',
    'Regardez ce que dit le tableau de bord CALL-E (dashboard.heycall-e.com) pour cet appel.':
        'See what the CALL-E dashboard (dashboard.heycall-e.com) says about this call.',
    'Relance : le créneau de rappel demande une heure de début PUIS une heure de fin (ex. 12:00 → 14:00).':
        'Follow-up: the callback slot needs a start time THEN an end time (e.g. 12:00 → 14:00).',
    "Relance : le délai doit être un nombre d'heures entre 0 et 168 (reçu «":
        'Follow-up: the delay must be a number of hours between 0 and 168 (received «',
    'Relance : le nombre maximal de rappels doit être entre 0 et 9 (reçu «':
        'Follow-up: the maximum number of callbacks must be between 0 and 9 (received «',
    'Relance NON jouée — toujours planifiée, aucune tentative comptée':
        'Follow-up NOT played — still scheduled, no attempt counted',
    'Relance abandonnée —':
        'Follow-up abandoned —',
    'Relance aboutie : créneau de la campagne n°%d attribué (rendez-vous n°%d), autres relances annulées':
        'Follow-up succeeded: campaign #%d slot assigned (appointment #%d), other follow-ups cancelled',
    "Relance annulée : la chaîne de ce contact s'arrête là.":
        "Follow-up cancelled: this contact's chain stops here.",
    'Relance introuvable (déjà faite ou déjà annulée).':
        'Follow-up not found (already done or already cancelled).',
    'Relance n°%d : échec (%s)':
        'Follow-up #%d: failed (%s)',
    'Relance n°%d NON composée — %s (%s)':
        'Follow-up #%d NOT dialled — %s (%s)',
    'Relance n°%d planifiée (campagne n°%d, tentative %d, échéance %s)':
        'Follow-up #%d scheduled (campaign #%d, attempt %d, due %s)',
    'Relance reportée à la nouvelle échéance.':
        'Follow-up moved to the new due date.',
    'Relances':
        'Follow-ups',
    "Relances : le délai par défaut doit être un nombre d'heures ouvrées entre 0 et 168 (reçu «":
        'Follow-ups: the default delay must be a number of working hours between 0 and 168 (received «',
    'Relances : le maximum de tentatives doit être entre 0 et 9 (reçu «':
        'Follow-ups: the maximum number of attempts must be between 0 and 9 (received «',
    'Relances dues':
        'Follow-ups due',
    'Relances exécutées':
        'Follow-ups run',
    'Relances par défaut':
        'Default follow-ups',
    'Relances à venir':
        'Upcoming follow-ups',
    'Relances — RingBack':
        'Follow-ups — RingBack',
    'Remettre à rappeler':
        'Put back in « To call back »',
    "Remplacer entièrement l'agenda":
        'Replace the calendar entirely',
    'Remplir depuis les rendez-vous':
        'Fill from appointments',
    'Remplir la liste':
        'Fill the list',
    'Rendez-vous':
        'Appointment',
    'Rendez-vous (date + heure)':
        'Appointment (date + time)',
    'Rendez-vous :':
        'Appointment:',
    'Rendez-vous DÉPLACÉ du':
        'Appointment MOVED from',
    "Rendez-vous NON créé : l'agent a conclu à un accord mais n'a donné AUCUNE date. Il n'y a rien à inscrire au planning. Rappelez cette personne pour convenir d'une date — ce qui a été dit au téléphone est conservé dans la transcription.":
        'Appointment NOT created: the agent concluded there was an agreement but gave NO date. There is nothing to enter in the schedule. Call this person back to agree on a date — what was said on the phone is kept in the transcript.',
    'Rendez-vous NON créé : la place du':
        'Appointment NOT created: the slot on',
    'Rendez-vous NON créé : le':
        'Appointment NOT created:',
    'Rendez-vous actuel (date + heure)':
        'Current appointment (date + time)',
    'Rendez-vous ajouté':
        'Appointment added',
    'Rendez-vous annulé':
        'Appointment cancelled',
    'Rendez-vous annulé — ses tranches sont de nouveau libres et proposables.':
        'Appointment cancelled — its time blocks are free again and can be offered.',
    'Rendez-vous annulés':
        'Cancelled appointments',
    'Rendez-vous annulés, manqués et en attente (déplacés sans nouveau rendez-vous)':
        'Cancelled, missed and pending appointments (moved without a new appointment)',
    'Rendez-vous concerné :':
        'Appointment concerned:',
    'Rendez-vous confirmé':
        'Appointment confirmed',
    'Rendez-vous convenu par téléphone':
        'Appointment agreed by phone',
    'Rendez-vous convenu par téléphone (cascade « premier oui »)':
        'Appointment agreed by phone (« first yes » cascade)',
    'Rendez-vous convenu par téléphone (relance de campagne)':
        'Appointment agreed by phone (campaign follow-up)',
    'Rendez-vous du':
        'Appointment on',
    'Rendez-vous déplacé':
        'Appointment moved',
    "Rendez-vous déplacé — les tranches qu'il occupait sont de nouveau libres.":
        'Appointment moved — the time blocks it occupied are free again.',
    'Rendez-vous enregistré':
        'Appointment saved',
    'Rendez-vous enregistré.':
        'Appointment saved.',
    'Rendez-vous existant (date + heure)':
        'Existing appointment (date + time)',
    'Rendez-vous existant du':
        'Existing appointment on',
    'Rendez-vous inconnu :':
        'Unknown appointment:',
    'Rendez-vous introuvable':
        'Appointment not found',
    'Rendez-vous introuvable.':
        'Appointment not found.',
    'Rendez-vous manqués (avec date et motif)':
        'Missed appointments (with date and reason)',
    'Rendez-vous n°':
        'Appointment #',
    'Rendez-vous n°%d : client « Ne plus appeler », jamais mis en file':
        'Appointment #%d: contact marked « Do not call again », never queued',
    'Rendez-vous n°%d : date convenue refusée (%s)':
        'Appointment #%d: agreed date refused (%s)',
    'Rendez-vous n°%d : déplacement voulu mais non conclu — rendez-vous inchangé, à relancer':
        'Appointment #%d: move wanted but not settled — appointment unchanged, to follow up',
    'Rendez-vous n°%d déplacé : %s -> %s':
        'Appointment #%d moved: %s -> %s',
    'Rendez-vous n°%d déplacé au %s':
        'Appointment #%d moved to %s',
    'Rendez-vous n°%d modifié en modale (statut %s, %s)':
        'Appointment #%d edited in the dialog (status %s, %s)',
    'Rendez-vous n°%d passé « %s » : %s libérée(s) — %s':
        'Appointment #%d set to « %s »: %s freed — %s',
    "Rendez-vous n°%d sans numéro : non mis en file (à compléter d'abord)":
        'Appointment #%d with no number: not queued (complete it first)',
    'Rendez-vous n°1':
        'Appointment 1',
    'Rendez-vous n°1 — RingBack':
        'Appointment 1 — RingBack',
    'Rendez-vous n°2':
        'Appointment 2',
    'Rendez-vous n°2 — RingBack':
        'Appointment 2 — RingBack',
    'Rendez-vous n°3':
        'Appointment 3',
    'Rendez-vous n°3 — RingBack':
        'Appointment 3 — RingBack',
    'Rendez-vous n°4':
        'Appointment 4',
    'Rendez-vous n°4 — RingBack':
        'Appointment 4 — RingBack',
    'Rendez-vous obtenu le':
        'Appointment obtained on',
    'Rendez-vous posés — prévus ET confirmés (comme au planning)':
        'Booked appointments — scheduled AND confirmed (as in the schedule)',
    'Rendez-vous qui seront supprimés avec lui :':
        'Appointments that will be deleted with them:',
    'Rendez-vous rétabli : il est de retour dans « À rappeler ».':
        'Appointment restored: it is back in « To call back ».',
    'Rendez-vous sans numéro':
        'Appointment with no number',
    'Rendez-vous sans numéro — RingBack':
        'Appointment with no number — RingBack',
    "Rendez-vous superposés (ils ne tiennent pas dans la grille, rien n'est caché) :":
        'Overlapping appointments (they do not fit in the grid, nothing is hidden):',
    'Rendez-vous supprimé':
        'Appointment deleted',
    'Rendez-vous à venir, pas encore confirmés':
        'Upcoming appointments, not yet confirmed',
    'Rendez-vous —':
        'Appointment —',
    'Rendez-vous — RingBack':
        'Appointments — RingBack',
    "Rends aussi « notes » : une ou deux phrases qui résument l'échange, et la demande de la personne en clair si tu conclus sur AUTRE. N'ajoute aucun autre champ : le résultat n'accepte que ceux-là.":
        "Also return « notes »: one or two sentences summing up the exchange, and the person's request in plain words if you conclude with AUTRE. Add no other field: the result accepts only those.",
    'Renvoi actif':
        'Forwarding active',
    "Renvoi d'essai %s (numéro %s)":
        'Test forwarding %s (number %s)',
    "Repartir de ce que RingBack propose d'origine pour ce type de\n  campagne — vos autres réglages ne bougent pas.":
        'Go back to what RingBack offers by default for this type of\n  campaign — your other settings do not change.',
    'Reporter':
        'Postpone',
    'Reprendre':
        'Resume',
    "Reprendre les options d'une autre\n      campagne":
        'Reuse the options of another\n      campaign',
    'Retirer':
        'Remove',
    'Retirer la clé':
        'Remove the key',
    "Retirer le jeu d'essai":
        'Remove the test data',
    "Retirer le jeu d'essai ?":
        'Remove the test data?',
    "Retirer le jeu d'essai…":
        'Remove the test data…',
    "Retirer mon numéro d'essai":
        'Remove my test number',
    "Revenir au\ntexte de la fiche (annule l'édition manuelle)":
        'Go back to the\nrecord text (cancels manual editing)',
    "Rien n'a été conclu au téléphone : c'est cette personne qui rappellera. Ce qu'elle a dit : «":
        'Nothing was settled on the phone: this person will call back. What they said: «',
    "Rien n'a été conclu au téléphone : c'est le client qui rappellera — «":
        'Nothing was settled on the phone: the contact will call back — «',
    "Rien n'a été créé.":
        'Nothing was created.',
    "Rien n'a été écrit sur personne : aucune tentative n'a été comptée et personne n'a été marqué « injoignable ». Ce qui n'a pas été appelé est conservé tel quel et reprendra exactement où cela s'est arrêté.":
        'Nothing was written about anyone: no attempt was counted and nobody was marked « unreachable ». What was not called is kept as it is and will resume exactly where it stopped.',
    "Rien n'est effacé : leur place est rendue et ils restent lisibles dans":
        'Nothing is deleted: their slot is released and they stay readable in',
    "Rien n'est encore écrit. Fermer cette fenêtre laisse le\nrendez-vous exactement comme il est.":
        'Nothing has been written yet. Closing this window leaves the\nappointment exactly as it is.',
    "Rien n'est envoyé sur Internet : le fichier est lu par RingBack,\n  sur cette machine.":
        'Nothing is sent to the Internet: the file is read by RingBack,\n  on this machine.',
    "Rien n'est parti : les créneaux annoncés au téléphone sortent de l'agenda de RingBack — lisez ce qu'il en dit, puis confirmez ci-dessous.":
        "Nothing went out: the slots announced on the phone come from RingBack's calendar — read what it says about them, then confirm below.",
    "Rien à faire : la campagne n'est pas en cours d'exécution.":
        'Nothing to do: the campaign is not running.',
    'Rien à faire pour lui.':
        'Nothing to do for them.',
    "Rien à rétablir : ce rendez-vous n'était pas « ignoré ».":
        'Nothing to restore: this appointment was not « ignored ».',
    'RingBack':
        'RingBack',
    'RingBack (':
        'RingBack (',
    "RingBack a besoin de connaître vos rendez-vous : c'est ce qui lui permet\nde savoir quelles places sont":
        'RingBack needs to know your appointments: that is what lets it\nknow which slots are',
    "RingBack n'a pas su lire la réponse de CALL-E :":
        "RingBack could not read CALL-E's response:",
    "RingBack ne le propose pas parce qu'il reste moins de":
        'RingBack does not offer it because there is less than',
    'RingBack ne les ajoute jamais tout seul':
        'RingBack never adds them on its own',
    "RingBack refuse\nnormalement deux contacts portant le même numéro : c'est le garde-fou qui\nempêche d'appeler deux fois la même personne. Les numéros déclarés ici — et\neux seuls — y échappent, pour que vous puissiez monter une campagne de\nplusieurs identités qui sonnent chez des gens que vous connaissez : vous, un\ncollègue, un ami qui accepte de jouer un rôle. Tous les autres numéros\nrestent soumis à la règle stricte, et retirer un testeur la lui rend\naussitôt. Chaque contact portant l'un de ces numéros est marqué":
        'RingBack normally\nrefuses two contacts with the same number: that is the safeguard that\nprevents calling the same person twice. The numbers declared here — and\nthey alone — escape it, so that you can build a campaign of\nseveral identities ringing people you know: yourself, a\ncolleague, a friend willing to play a part. All other numbers\nstay under the strict rule, and removing a tester puts it back\nat once. Every contact carrying one of these numbers is marked',
    "RingBack refuse\nnormalement deux contacts portant le même numéro : c'est le garde-fou qui\nempêche d'appeler deux fois la même personne. Les numéros déclarés ici — et\neux seuls — y échappent, pour que vous puissiez monter une campagne de\nplusieurs identités qui sonnent chez des gens que vous connaissez : vous, un\ncollègue, un ami qui accepte de jouer un rôle. Tous les autres numéros\nrestent soumis à la règle stricte, et retirer un testeur la lui rend\naussitôt. Chaque contact portant l'un de ces numéros est marqué\n🧪 dans la grille, la fiche de campagne, le planning et\n👥 Contacts. Comme partout, ces numéros restent":
        'RingBack normally refuses\ntwo contacts carrying the same number: that is the safeguard that stops\nthe same person being called twice. The numbers declared here — and\nonly these — are exempt, so you can build a campaign of\nseveral identities ringing people you know: yourself, a\ncolleague, a friend willing to play a part. All other numbers\nstay under the strict rule, and removing a tester restores it\nat once. Every contact carrying one of these numbers is marked\n🧪 in the grid, the campaign record, the schedule and\n👥 Contacts. As everywhere, these numbers stay',
    'RingBack vous':
        'RingBack',
    "RingBack — MODE RÉEL : les appels partent vraiment ; numéros toujours masqués à l'écran.":
        'RingBack — REAL MODE: calls really go out; numbers always masked on screen.',
    'RingBack — mode simulation : aucun appel réel, numéros fictifs et masqués.':
        'RingBack — simulation mode: no real calls, fictitious and masked numbers.',
    'RingBack — serveur web (simulation par défaut).':
        'RingBack — web server (simulation by default).',
    'RÉELLEMENT':
        'REALLY',
    'RÉELS':
        'REAL',
    'Règle enregistrée. Elle sera rejouée à chaque place.':
        'Rule saved. It will be replayed for every slot.',
    "Ré-enregistrez votre numéro d'essai, ou décochez la case. RingBack n'appellera pas vos contacts à sa place : ce serait le contraire de ce que cette case promet.":
        'Save your test number again, or clear the checkbox. RingBack will not call your contacts instead: that would be the opposite of what this checkbox promises.',
    'Récupération impossible pour le contact n°%d — %s':
        'Retrieval failed for contact #%d — %s',
    'Récupération interrompue pour le contact n°%d — %s':
        'Retrieval interrupted for contact #%d — %s',
    'Réglage refusé :':
        'Setting rejected:',
    'Réglages':
        'Settings',
    'Réglages actuels : délai par défaut +':
        'Current settings: default delay +',
    "Réglages actuels : délai par défaut +4 h ouvrée(s) dans la plage d'appel, 1 tentative(s) maximum —":
        'Current settings: default delay +4 working hours in the calling window, 1 attempt maximum —',
    'Réglages enregistrés.':
        'Settings saved.',
    'Réglages — RingBack':
        'Settings — RingBack',
    'Réglez vos horaires':
        'Set your hours',
    "Réinitialiser l'installeur":
        'Reset the installer',
    'Répondeur : message court':
        'Voicemail: short message',
    'Répondeur : message court sans le motif':
        'Voicemail: short message without the reason',
    'Répondeur sans le motif':
        'Voicemail without the reason',
    'Répondeur sans le motif :':
        'Voicemail without the reason:',
    'Réponse brute de CALL-E :':
        'Raw response from CALL-E:',
    'Réponse illisible':
        'Unreadable response',
    'Réponse illisible par RingBack — à rappeler par un humain':
        'Response unreadable by RingBack — to be called back by a human',
    'Résultat en attente':
        'Outcome pending',
    'Résultat récupéré et appliqué :':
        'Outcome retrieved and applied:',
    "Résumé de l'échange en une ou deux phrases.":
        'Summary of the exchange in one or two sentences.',
    'Rôle à jouer':
        'Role to play',
    'Sa demande —':
        'Their request —',
    'Sa demande, en clair':
        'Their request, in plain words',
    'Sa liste a été recalculée pour cette date :':
        'Its list was recalculated for this date:',
    'Saisie manuelle des créneaux':
        'Manual slot entry',
    "Saisie refusée (rien n'a été enregistré) :":
        'Entry refused (nothing was saved):',
    'Saisie refusée :':
        'Input rejected:',
    'Sans glisser':
        'Without dragging',
    'Sans glisser-relâché':
        'Without drag and drop',
    'Saturday':
        'Saturday',
    'Sections de la configuration':
        'Configuration sections',
    'Sections des réglages':
        'Settings sections',
    'Semaine':
        'Week',
    "Semaine de l'année":
        'Week of the year',
    'Semaine du':
        'Week of',
    'Semaine illisible.':
        'Week unreadable.',
    'Semaine introuvable':
        'Week not found',
    'Semaine précédente — remet le champ date à vide':
        'Previous week — clears the date field',
    'Semaine suivante — remet le champ date à vide':
        'Next week — clears the date field',
    'Semaine suivante ▶':
        'Next week ▶',
    'Semaine type : %s %s de %s à %s':
        'Standard week: %s %s from %s to %s',
    'Sep':
        'Sep',
    'September':
        'September',
    'Ses contacts de campagne et les appels déjà passés restent lisibles, mais ne seront plus jamais composés.':
        'Its campaign contacts and the calls already made stay readable, but will never be dialled again.',
    'Ses dates partent':
        'Its dates start',
    'Ses deux états':
        'Their two states',
    'Ses rendez-vous (':
        'Their appointments (',
    'Ses rendez-vous (1)':
        'Their appointments (1)',
    'Seuil de remplacement refusé :':
        'Replacement threshold rejected:',
    'Seuil de remplacement refusé : «':
        'Replacement threshold rejected: «',
    'Seules les':
        'Only the',
    'Seules les fiches marquées 🧪 partiront :':
        'Only records marked 🧪 will go out:',
    "Seuls les contacts dont le rendez-vous tombe APRÈS la place\n  libérée sont retenus : les autres n'y gagneraient rien. La liste se\n  resserre donc à chaque maillon. La chaîne s'arrête à cette date, quand\n  plus personne n'est concerné, ou quand le nombre maximal de PERSONNES\n  réglé pour la campagne est atteint.":
        'Only contacts whose appointment falls AFTER the freed\n  slot are kept: the others would gain nothing. The list therefore\n  narrows at each link. The chain stops at this date, when\n  no one is concerned any more, or when the maximum number of PEOPLE\n  set for the campaign is reached.',
    'Seuls les jours qui portent des rendez-vous sont proposés.':
        'Only days that carry appointments are offered.',
    "Si c'est bien voulu (deux rendez-vous distincts au même horaire pour cette\npersonne), confirmez explicitement :":
        'If this is intended (two separate appointments at the same time for this\nperson), confirm explicitly:',
    "Si l'attente est quand même dépassée,":
        'If the wait is exceeded anyway,',
    "Si la personne DÉCLINE la place, demande-lui avant de conclure : « Voulez-vous que je vous rappelle si un autre créneau se libère ? » — rends « wants_other_slots » = « yes » si elle accepte, « no » si elle ne veut plus qu'on lui en propose. N'insiste pas, et ne pose cette question QUE sur un refus.":
        'If the person DECLINES the slot, ask before wrapping up: « Would you like me to call you back if another slot opens up? » — return « wants_other_slots » = « yes » if they accept, « no » if they no longer want any offered. Do not insist, and ask this question ONLY on a refusal.',
    "Si la personne demande qu'on ne la rappelle plus — quels que soient ses mots (« ne me rappelez plus », « retirez-moi de vos listes », « je ne veux plus être contacté ») — réponds « C'est noté, vous ne serez plus appelé. Bonne journée. », rends « do_not_call » = « yes », et conclus quand même sur l'une des trois issues ci-dessus. Sinon, rends « do_not_call » = « no ».":
        'If the person asks not to be called again — whatever their words (« stop calling me », « take me off your lists », « I do not want to be contacted any more ») — reply « Noted, you will not be called again. Have a good day. », return « do_not_call » = « yes », and still close on one of the three outcomes above. Otherwise, return « do_not_call » = « no ».',
    "Si vous ne pouvez plus venir, j'annule votre rendez-vous, et je ne vous propose pas d'autre date aujourd'hui : c'est vous qui nous rappelez quand vous voulez — nous ne vous relancerons pas.":
        "If you can no longer come, I'll cancel your appointment, and I won't offer you another date today: you call us back whenever you want — we will not follow up.",
    "Si vous ne pouvez plus venir, je peux vous proposer une autre date ; sinon j'annule votre rendez-vous et c'est vous qui nous rappelez quand vous voulez — nous ne vous relancerons pas.":
        "If you can no longer come, I can offer you another date; otherwise I'll cancel your appointment and you call us back whenever you want — we will not follow up.",
    'Simplifié':
        'Simplified',
    'Son rendez-vous':
        'Their appointment',
    'Son rendez-vous du':
        'Their appointment on',
    'Son téléphone':
        'Their phone',
    'Son téléphone — format attendu : 10 chiffres commençant par 0\n    (06 39 98 00 00), ou +33 suivi de 9 chiffres':
        'Their phone — expected format: 10 digits starting with 0\n    (06 39 98 00 00), or +33 followed by 9 digits',
    'Son état appelle une action, et aucune campagne en cours ne le traite pour cet état':
        'Its status calls for action, and no running campaign handles it for that status',
    "Sort de la liste — rien n'est effacé":
        'Leaves the list — nothing is deleted',
    'Source :':
        'Source:',
    'Source de candidats inconnue :':
        'Unknown candidate source:',
    'Source de remplissage inconnue.':
        'Unknown fill source.',
    'Source inconnue : «':
        'Unknown source: «',
    'Statut':
        'Status',
    'Statut :':
        'Status:',
    "Statut : manqué (l'horaire est déjà passé) — visible dans 🗂 Tous les rendez-vous, avec sa pastille.":
        'Status: missed (the time has already passed) — visible in 🗂 All appointments, with its badge.',
    'Statut : prévu — visible dès maintenant sur le planning de la page 📅 Rendez-vous.':
        'Status: scheduled — visible right now on the schedule of the 📅 Appointments page.',
    'Statut de reprise inconnu :':
        'Unknown resume status:',
    'Statut refusé : «':
        'Status rejected: «',
    'Suite':
        'Next',
    'Sujet :':
        'Subject:',
    'Sunday':
        'Sunday',
    'Suppression non confirmée : passez par la page de confirmation.':
        'Deletion not confirmed: go through the confirmation page.',
    'Supprimer ce contact ?':
        'Delete this contact?',
    'Supprimer ce contact ? — RingBack':
        'Delete this contact? — RingBack',
    'Supprimer ce contact…':
        'Delete this contact…',
    'Supprimer définitivement — contact et rendez-vous':
        'Delete permanently — contact and appointments',
    'Supprimer…':
        'Delete…',
    'Switch the interface to English':
        'Switch the interface to English',
    'TOUS LES APPELS SONT RENVOYÉS':
        'ALL CALLS ARE FORWARDED',
    "Tant qu'il est chargé, chaque page l'annonce, et le retrait est possible\nà tout moment depuis les réglages.":
        'While it is loaded, every page says so, and it can be removed\nat any time from the settings.',
    'Taper exactement APPELER pour confirmer (autre chose = simulation) :':
        'Type exactly APPELER to confirm (anything else = simulation):',
    'Tentative':
        'Attempt',
    'Tentatives':
        'Attempts',
    'Terminer':
        'Finish',
    'Terminées':
        'Completed',
    "Tes règles — ce que tu dois faire, et ce que tu n'as pas le droit de faire :":
        'Your rules — what you must do, and what you are not allowed to do:',
    'Testeur':
        'Tester',
    'Testeur déclaré : « %s » (%d testeur(s) au total)':
        'Tester declared: « %s » (%d tester(s) in total)',
    'Testeur refusé :':
        'Tester rejected:',
    'Testeur retiré : « %s » — la règle stricte du doublon lui est rendue (%d testeur(s) restant)':
        'Tester removed: « %s » — the strict duplicate rule applies to them again (%d tester(s) left)',
    'Testeurs':
        'Testers',
    'Thursday':
        'Thursday',
    'Thème :':
        'Theme:',
    "Thème d'appel inconnu :":
        'Unknown call theme:',
    'Thème de campagne inconnu :':
        'Unknown campaign theme:',
    "Thème de l'appel":
        'Call theme',
    'Ton objectif :':
        'Your goal:',
    'Ton objectif : faire accepter à la personne l&#x27;un des créneaux de remplacement, parce que son rendez-vous actuel ne peut pas être tenu\nCe que tu sais, et que tu peux redire ou reformuler :\n- Personne appelée :':
        'Your goal: get the contact to accept one of the replacement slots, because their current appointment cannot be kept\nWhat you know, and may repeat or rephrase:\n- Contact called:',
    'Ton objectif : fixer un rendez-vous avec la personne, parmi les créneaux dont tu disposes\nCe que tu sais, et que tu peux redire ou reformuler :\n- Personne appelée :':
        'Your goal: book an appointment with the contact, from the slots you have\nWhat you know, and may repeat or rephrase:\n- Contact called:',
    'Ton objectif : obtenir une réponse FERME : la personne sera-t-elle présente à son rendez-vous, oui ou non\nCe que tu sais, et que tu peux redire ou reformuler :\n- Personne appelée :':
        'Your goal: get a FIRM answer: will the contact attend their appointment, yes or no\nWhat you know, and may repeat or rephrase:\n- Contact called:',
    'Ton objectif : savoir si la personne prend la place qui vient de se libérer, à la place de son rendez-vous actuel\nCe que tu sais, et que tu peux redire ou reformuler :\n- Personne appelée :':
        'Your goal: find out whether the contact takes the slot that has just come free, instead of their current appointment\nWhat you know, and may repeat or rephrase:\n- Contact called:',
    'Ton objectif : t&#x27;assurer que la personne a bien son rendez-vous en tête, et savoir si elle le maintient\nCe que tu sais, et que tu peux redire ou reformuler :\n- Personne appelée :':
        'Your goal: make sure the contact has their appointment in mind, and find out whether they are keeping it\nWhat you know, and may repeat or rephrase:\n- Contact called:',
    'Toujours mon numéro':
        'Always my number',
    'Toujours utiliser mon numéro de téléphone pour les essais en\n    conditions réelles':
        'Always use my phone number for tests in\n    real conditions',
    "Tous ces contacts portent le numéro de votre unique testeur (marqué 🧪) — c'est ce téléphone-là qui sonnera.":
        'All these contacts carry the number of your only tester (marked 🧪) — that is the phone that will ring.',
    'Tous les clients':
        'All contacts',
    'Tous les contacts de la campagne':
        'All the campaign contacts',
    'Tous les jours fériés des douze prochains mois sont déjà déclarés fermés.':
        'All public holidays for the next twelve months are already set as closing days.',
    "Tous les numéros viennent des racines que l'Arcep réserve aux œuvres\naudiovisuelles : ils ne peuvent ni appeler ni être appelés. Une poignée se\ntermine par 51 à 56, les terminaisons que le simulateur reconnaît — une\ncampagne d'essai produit ainsi tous les cas de figure (accepté, refusé, pas\nde réponse, autre date, à rappeler par un humain).":
        'All the numbers come from the ranges Arcep reserves for audiovisual\nworks: they can neither call nor be called. A handful end\nin 51 to 56, the endings the simulator recognises — so a test\ncampaign produces every case (accepted, refused, no\nanswer, another date, to be called back by a human).',
    'Tous les rendez-vous':
        'All appointments',
    'Tous les rendez-vous (':
        'All appointments (',
    'Tous les rendez-vous (4)':
        'All appointments (4)',
    'Tous les rendez-vous ont un numéro de téléphone.':
        'Every appointment has a phone number.',
    'Tous les rendez-vous — RingBack':
        'All appointments — RingBack',
    'Tous les états':
        'All statuses',
    'Toussaint':
        "All Saints' Day",
    'Tout appel non abouti (pas de réponse, échec, déplacement non\nconclu…) programme une':
        'Any call that does not go through (no answer, failure, move not\nagreed…) schedules a',
    'Tout appel non abouti programme une relance (par délai ou dans\n  le créneau de rappel — échéance modifiable ensuite) ; au plafond de\n  rappels, le contact passe 📵 injoignable. Une relance ne part JAMAIS\n  seule : geste humain obligatoire sur la page 🔁 Relances.':
        'Any call that does not get through schedules a follow-up (after a delay or in\n  the callback slot — due time editable afterwards); at the callback\n  ceiling, the contact becomes 📵 unreachable. A follow-up NEVER goes out\n  alone: a human action is required on the 🔁 Follow-ups page.',
    'Tout rappeler — mettre en file tous les manqués':
        'Call all back — queue every missed appointment',
    'Tranches de':
        'Blocks of',
    'Tranches de 15 minutes, sur les 21\nprochains jours : les 24 premiers créneaux calculés, et':
        'Blocks of 15 minutes, over the next 21\ndays: the first 24 slots calculated, and',
    'Transcription':
        'Transcript',
    'Transcription (simulée)':
        'Transcript (simulated)',
    'Transcriptions':
        'Transcripts',
    'Tuesday':
        'Tuesday',
    'Types de rappel':
        'Callback types',
    'Télécharger la liste (CSV)':
        'Download the list (CSV)',
    'Télécharger la liste (CSV, numéros en clair —\n  généré à la volée, jamais stocké)':
        'Download the list (CSV, numbers in plain text —\n  generated on the fly, never stored)',
    'Téléphone':
        'Phone',
    'Téléphone (fictif : +33 6 00 00 00 XX)':
        'Phone (fictional: +33 6 00 00 00 XX)',
    'Téléphone à compléter':
        'Phone to complete',
    "Un\nrendez-vous déplacé reste déplacé, une place libérée reste libre : c'est la\nTRACE du travail qui part, jamais son résultat dans votre agenda.":
        'A\nmoved appointment stays moved, a freed slot stays free: it is the\nTRACE of the work that goes, never its result in your calendar.',
    'Un agenda':
        'A calendar',
    "Un agenda ne contient presque jamais les numéros de téléphone : les\nrendez-vous importés apparaîtront « sans numéro », avec un écran pour les\ncompléter. Tant qu'un numéro manque, ce client n'est jamais appelé.":
        'A calendar almost never contains phone numbers: imported\nappointments will appear « without a number », with a screen to fill\nthem in. As long as a number is missing, that contact is never called.',
    "Un client a annulé pendant l'appel. Ce que RingBack en fait dépend du\ndélai qui restait avant son rendez-vous — le seuil est de":
        'A contact cancelled during the call. What RingBack does with it depends on the\ntime left before their appointment — the threshold is',
    'Un contact annule au téléphone : si son rendez-vous est à':
        'A contact cancels by phone: if their appointment is',
    "Un créneau vient de se libérer ? Donnez votre liste d'attente : les personnes\nsont appelées":
        'A slot has just come free? Give your waiting list: the contacts\nare called',
    'Un fichier':
        'A file',
    "Un fichier d'agenda fabriqué à l'instant, calé sur vos heures d'ouverture, à\nimporter pour remplir le planning.":
        'A calendar file built just now, matched to your opening hours, to\nimport to fill the schedule.',
    'Un jeu de données simple qui complète votre agenda et vos contacts, pour\nessayer RingBack sans toucher à vos vraies données.':
        'A simple data set that adds to your calendar and your contacts, so you can\ntry RingBack without touching your real data.',
    "Un numéro d'essai est enregistré (":
        'A test number is registered (',
    'Un numéro de téléphone a été trouvé dans le discours de «':
        'A phone number was found in the speech for «',
    'Un rendez-vous déplacé ou annulé libère son créneau':
        'An appointment moved or cancelled frees its slot',
    'Un rendez-vous déplacé/annulé libère son créneau':
        'A moved or cancelled appointment frees its slot',
    'Un rendez-vous déplacé/annulé libère son créneau :':
        'A moved/cancelled appointment frees its slot:',
    'Un rendez-vous identique (même client, même horaire) est déjà\nenregistré —':
        'An identical appointment (same contact, same time) is already\nrecorded —',
    'Un rendez-vous qui occupe plusieurs tranches consécutives compte\npour':
        'An appointment taking up several consecutive blocks counts\nas',
    'Un seul jour dans les deux champs : une seule journée. La\n  dernière heure est':
        'The same day in both fields: a single day. The\n  last hour is',
    'Une case = une tranche de':
        'One cell = a block of',
    'Une case = une tranche de\n15 minutes ; les cases colorées sont ouvertes.':
        'One box = one block of\n15 minutes; the coloured boxes are open.',
    "Une case = une tranche de\n15 minutes, le même découpage que la semaine type des réglages ; les\ncases vertes sont libres, les tuiles sont les rendez-vous posés.\nCliquez le NOM D'UN JOUR pour le choisir en entier, sans avoir à le\nparcourir au glissé.":
        'One cell = a\n15-minute slice, the same grid as the standard week in settings; green\ncells are free, tiles are the appointments already placed.\nClick a DAY NAME to pick the whole day, without dragging\nacross it.',
    'Une fiche au même nom est marquée 🚫 « Ne plus appeler » — appel refusé par sécurité':
        'A record with the same name is marked 🚫 « Do not call again » — call refused as a precaution',
    "Une fiche au même nom est marquée 🚫 « Ne plus appeler » — aucun appel automatique ne part, par sécurité. À rappeler par un humain, qui saura s'il s'agit de la même personne.":
        'A record with the same name is marked 🚫 « Do not call again » — no automatic call goes out, as a precaution. To be called back by a human, who will know whether it is the same person.',
    "Une ligne par personne, colonnes dans l'ordre :":
        'One row per person, columns in order:',
    'Une liste que vous apportez':
        'A list you bring',
    'Une nouvelle date reste à fixer.':
        'A new date is still to be set.',
    "Une place n'intéresse quelqu'un que si\n    elle lui apporte quelque chose.":
        'A slot only interests someone if\n    it brings them something.',
    "Une période ne s'applique qu'aux rendez-vous à venir ou manqués — «":
        'A period only applies to upcoming or missed appointments — «',
    "Uniquement si la personne DÉCLINE la place : « no » si elle ne veut plus qu'on lui propose d'autres créneaux, « yes » si elle accepte qu'on la rappelle quand une autre place se libère. Laisse vide sinon.":
        'Only if the person DECLINES the slot: « no » if they no longer want other slots offered, « yes » if they agree to be called back when another slot opens up. Leave empty otherwise.',
    "Valider — créer la campagne (état « prête », personne n'est appelé)":
        'Confirm — create the campaign (status « ready », no one is called)',
    "Variable d'installation réinitialisée : l'installeur s'ouvrira à la prochaine visite de l'accueil.":
        'Setup variable reset: the installer will open on the next visit to the home page.',
    'Veuillez compléter les champs obligatoires : ils sont encadrés de rouge dans la grille.':
        'Please fill in the required fields: they are outlined in red in the grid.',
    'Victoire 1945':
        'Victory in Europe Day',
    "Vide = le texte livré (montré en filigrane) s'applique. Les mots\n  entre crochets sont remplis automatiquement :":
        'Empty = the delivered text (shown as a watermark) applies. The words\n  in brackets are filled in automatically:',
    'Vider la file — tout annuler':
        'Empty the queue — cancel everything',
    'Vient de':
        'Comes from',
    "Voir ce qu'elle contient":
        'See what it contains',
    'Voir dans « Tous les rendez-vous »':
        'See in « All appointments »',
    'Voir la fiche':
        'View record',
    'Voir les campagnes qui le contiennent':
        'See the campaigns containing it',
    'Voir les détails':
        'See details',
    'Voir sur le planning':
        'See on the schedule',
    'Voir tous ses rendez-vous':
        'View all their appointments',
    'Vont être':
        'Will be',
    'Vos clients et vos rendez-vous ne sont pas touchés.':
        'Your contacts and appointments are not touched.',
    'Vos données sont intactes.':
        'Your data is intact.',
    "Vos horaires d'ouverture":
        'Your opening hours',
    'Vos jours fermés':
        'Your closing days',
    'Vos propres clients et rendez-vous ne sont pas\ntouchés.':
        'Your own contacts and appointments are not\ntouched.',
    "Vos réglages ne sont PAS touchés — ils s'affichent tels que vous\n  les avez laissés. C'est le parcours qu'on refait, pas les valeurs.":
        'Your settings are NOT touched — they show just as you\n  left them. It is the walkthrough that is redone, not the values.',
    'Votre clé CALL-E':
        'Your CALL-E key',
    "Votre fichier d'agenda ou de rendez-vous":
        'Your calendar or appointment file',
    'Votre texte':
        'Your text',
    "Votre texte part mot pour mot — RingBack n'y ajoute rien. Ajoutez ce qui manque vous-même, ou revenez au texte de la fiche.":
        "Your text goes out word for word — RingBack adds nothing to it. Add what is missing yourself, or go back to the record's text.",
    'Voulez-vous contacter :':
        'Do you want to contact:',
    "Vous n'avez pas de fichier sous la main ? Passez cette page : vos\nrendez-vous peuvent aussi se saisir un par un, ou se coller plus tard.":
        'No file at hand? Skip this page: your\nappointments can also be entered one by one, or pasted later.',
    'Vous ne choisissez\n  pas des personnes, vous choisissez une':
        'You do not choose\n  people, you choose a',
    "Vous verrez d'abord ce que cela va faire ; rien n'est écrit avant votre confirmation":
        'You will first see what this will do; nothing is written before you confirm',
    'Vous êtes désormais prêt à utiliser RingBack':
        'You are now ready to use RingBack',
    'Vous êtes en simulation : aucun téléphone ne sonnera.':
        'You are in simulation mode: no phone will ring.',
    'Wednesday':
        'Wednesday',
    '[Consigne propre au contact]':
        '[Contact-specific briefing]',
    '[Créneau libéré (date et heure)]':
        '[Freed slot (date and time)]',
    '[Créneaux disponibles pour négocier (stock, non récité)]':
        '[Slots available to negotiate with (stock, not read aloud)]',
    '[Créneaux disponibles à proposer]':
        '[Slots available to offer]',
    '[Identité (civilité + nom)]':
        '[Identity (title + name)]',
    '[Motif souhaité (si fourni)]':
        '[Reason requested (if given)]',
    '[Motif]':
        '[Reason]',
    '[Nom de l&#x27;entreprise]':
        '[Practice name]',
    '[Origine de la demande (ex. « vous avez demandé un rendez-vous sur notre site »)]':
        '[Origin of the request (e.g. « you asked for an appointment on our website »)]',
    '[Rendez-vous (date + heure)]':
        '[Appointment (date + time)]',
    '[Rendez-vous actuel (date + heure)]':
        '[Current appointment (date + time)]',
    '[Rendez-vous existant (date + heure)]':
        '[Existing appointment (date + time)]',
    '[créneau] est remplacé par la date du créneau libéré, [client] par chaque personne appelée.':
        '[créneau] is replaced by the date of the freed slot, [client] by each contact called.',
    '] utilisable dans le message.':
        '] usable in the script.',
    'a déplacé son rendez-vous du':
        'moved their appointment from',
    "a été DÉPLACÉ ici et confirmé — une seule ligne d'agenda, l'ancienne place redevient libre":
        'has been MOVED here and confirmed — a single calendar entry, the old slot becomes free again',
    'a été PRÉPARÉE sur ce créneau, avec les mêmes critères —':
        'has been PREPARED on this slot, with the same criteria —',
    'a été prise entre-temps : elle est retirée de cette campagne, plus personne ne se la verra proposer (':
        'has been taken in the meantime: it is removed from this campaign, nobody will be offered it any more (',
    'abandonné':
        'abandoned',
    'accepté':
        'accepted',
    'accepté(s) ·':
        'accepted ·',
    "actualiser l'accueil":
        'refresh the home page',
    'additif':
        'additive',
    'affiché(s) sur':
        'shown out of',
    'ajouté à la main':
        'added manually',
    'ajoutée(s) à la main dans les réglages)':
        'added by hand in the settings)',
    'ajoutés':
        'added',
    'ancien rendez-vous du':
        'previous appointment on',
    'ancien rendez-vous à libérer dans votre agenda :':
        'old appointment to free up in your calendar:',
    'annulé':
        'cancelled',
    "annulé par le client pendant l'appel — il reprendra contact lui-même.":
        'cancelled by the contact during the call — they will get back in touch themselves.',
    'annulé — le client rappellera':
        'cancelled — the contact will call back',
    'annulée':
        'cancelled',
    'annulée(s) — le détail de chaque chaîne est sur la fiche de sa campagne.':
        'cancelled — the detail of each chain is on its campaign record.',
    'août':
        'August',
    "appel renvoyé vers le numéro d'essai imposé : ce contact n'a PAS été appelé":
        'call redirected to the enforced test number: this contact was NOT called',
    'appel terminé sans succès : statut «':
        'call ended without success: status «',
    'appel(s) annulé(s) avant exécution — aucun ne sera passé.':
        'call(s) cancelled before execution — none will be made.',
    'appel(s) enregistré(s), avec leurs transcriptions':
        'call(s) recorded, with their transcripts',
    "appel(s) réglé pour cette campagne est atteint : aucun autre numéro n'est composé. Relevez-le dans la campagne pour continuer, ou reprenez ces personnes dans une nouvelle campagne":
        'call(s) set for this campaign is reached: no other number is dialled. Raise it in the campaign to continue, or pick these people up in a new campaign',
    'appel(s) réglé pour cette campagne est atteint — relevez-le pour continuer la chaîne':
        'call(s) set for this campaign is reached — raise it to continue the chain',
    "appel(s) sont PARTIS chez CALL-E et leur résultat n'est pas encore lu.":
        'call(s) have GONE OUT to CALL-E and their outcome has not been read yet.',
    "appel(s) sont bien PARTIS, mais leur résultat\nn'est pas encore connu":
        'call(s) have indeed GONE OUT, but their outcome\nis not yet known',
    'appel(s) traité(s).':
        'call(s) processed.',
    'appeler toute la liste':
        'call the whole list',
    'appels\n  réels':
        'real\n  calls',
    'appelé':
        'called',
    'appelé(s) ·':
        'called ·',
    'appelé, résultat inconnu':
        'called, outcome unknown',
    'après':
        'after',
    'après un délai':
        'after a delay',
    'après un délai (heures ouvrées)':
        'after a delay (working hours)',
    'après un délai de':
        'after a delay of',
    'arrêt au premier oui (':
        'stop at the first yes (',
    'arrêt au premier oui (le rendez-vous a été déplacé)':
        'stop at the first yes (the appointment has been moved)',
    'arrêtée':
        'stopped',
    'au maximum (':
        'at most (',
    'au maximum — attendu «':
        'at most — expected «',
    'au maximum, chaîne bornée au':
        'at most, chain capped at',
    'au moins 30 jours':
        'at least 30 days',
    'au moins 7 jours':
        'at least 7 days',
    'au moins 90 jours':
        'at least 90 days',
    'au téléphone,':
        'on the phone,',
    'aucun':
        'none',
    'aucun appel lancé':
        'no call started',
    "aucun appel n'est parti":
        'no call has gone out',
    "aucun appel n'est passé":
        'no call is made',
    "aucun client n'est dans l'état «":
        'no contact is in the status «',
    'aucun client «':
        'no contact «',
    'aucun contact ne sera appelé':
        'no contact will be called',
    "aucun créneau disponible (ni horaires d'ouverture, ni créneau ajouté à la main)":
        'no slot available (neither opening hours, nor slot added by hand)',
    'aucun créneau ne lui convient et elle préfère annuler son rendez-vous':
        'no slot suits them and they prefer to cancel their appointment',
    'aucun numéro':
        'no number',
    'aucun numéro enregistré':
        'no number recorded',
    'aucun rendez-vous':
        'no appointment',
    "aucun rendez-vous n'a été écrit, et la place libérée est proposée à quelqu'un d'autre.":
        'no appointment was written, and the freed slot is offered to someone else.',
    'aucun écarté':
        'none set aside',
    'aucune':
        'none',
    "aucune campagne ne traite cela : quelqu'un doit s'en charger — c'est la corbeille d'entrée de l'humain":
        "no campaign handles this: someone must take care of it — this is the human's inbox",
    'aucune demande enregistrée':
        'no request recorded',
    "aucune des places qui restaient n'est plus tôt que son rendez-vous — l'avancer ne lui apporterait rien":
        'none of the remaining slots is earlier than their appointment — moving it up would gain them nothing',
    "aucune place libérée n'est connue — rien n'a pu être préparé.":
        'no freed slot is known — nothing could be prepared.',
    'aucune période interdite réglée':
        'no forbidden period set',
    'aucune réponse après plusieurs sonneries (simulation)':
        'no answer after several rings (simulation)',
    'aucune source enregistrée':
        'no source recorded',
    "aujourd'hui : rechargez-la pour ajouter les":
        'today: reload it to add the',
    'autre date convenue au téléphone':
        'another date agreed by phone',
    "avant\n  d'importer : les rendez-vous qui tenaient encore une place passent\n  « supprimé », leur place est rendue, et ils restent lisibles dans\n  🗂 Tous les rendez-vous. Le passé n'est pas touché.":
        'before\n  importing: appointments still holding a slot become\n  « deleted », their slot is released, and they stay readable in\n  🗂 All appointments. The past is untouched.',
    'avant lancement (jamais de numéro dedans)':
        'before launch (never a number in it)',
    "bien qu'elle soit enregistrée":
        'although it is recorded',
    "bien qu'elles soient enregistrées":
        'although they are recorded',
    'bien que':
        'although',
    'butée de sécurité : la chaîne de campagnes atteint':
        'safety stop: the campaign chain reaches',
    "c'est là-dedans que RingBack puisera si un rendez-vous se décide pendant l'appel":
        'this is what RingBack will draw from if an appointment is decided during the call',
    "c'est là-dedans que l'agent puisera":
        'this is what the agent will draw from',
    "c'est une ADRESSE WEB, pas une clé — l'adresse du tableau de bord CALL-E n'ouvre aucun appel":
        'this is a WEB ADDRESS, not a key — the CALL-E dashboard address opens no call',
    'calculé':
        'calculated',
    'calculée':
        'computed',
    'campagne arrêtée :':
        'campaign stopped:',
    'campagne de cette nature ; chacune reste\n  modifiable au moment de la créer (étape ②, mode avancé). Les campagnes\n  déjà créées gardent les options avec lesquelles elles ont été faites — ce\n  réglage ne les rejoue pas.':
        'campaign of this nature; each one stays\n  editable at the moment you create it (step ②, advanced mode). Campaigns\n  already created keep the options they were made with — this\n  setting does not replay them.',
    'campagne(s) de cette liste appellent en ce moment :':
        'campaign(s) from this list are calling right now:',
    'campagne(s) déjà envoyée(s)':
        'campaign(s) already sent',
    'campagne(s) en cours le concernent :':
        'campaign(s) in progress concern them:',
    'campagne(s) et':
        'campaign(s) and',
    'caractère(s)':
        'character(s)',
    'caractères':
        'characters',
    'caractères en tout]':
        'characters in total]',
    "caractères) : 40 au maximum, pour qu'il tienne dans le tableau des rôles.":
        'characters): 40 at most, so it fits in the roles table.',
    "caractères) : une clé d'accès en fait bien plus de":
        'characters): an access key has far more than',
    'ce rendez-vous est dans moins de':
        'this appointment is in less than',
    "ce rendez-vous est déjà passé : « annulé » est le statut d'histoire, il garde la trace de ce qui n'a pas eu lieu.":
        'this appointment has already passed: « cancelled » is the history status, it keeps the trace of what did not happen.',
    'ce rendez-vous était dans plus de':
        'this appointment was in more than',
    'ce sont eux que chaque campagne reprendra':
        'these are what every campaign will reuse',
    'ces informations':
        'these details',
    'cette information':
        'this detail',
    "cette personne a demandé au téléphone qu'on ne lui propose plus de créneau libéré":
        'this person asked on the phone not to be offered freed slots any more',
    "cette place est déjà prise, ou elle est hors des horaires d'ouverture":
        'this slot is already taken, or it is outside the opening hours',
    "cette place — ce sont les seuls qu'elle arrange. Le\nbouton ouvre l'assistant à l'étape 2, créneau déjà rempli :":
        'this slot — they are the only ones it suits. The\nbutton opens the wizard at step 2, slot already filled in:',
    'cette semaine — annulés, déplacés, manqués ou ignorés':
        'this week — cancelled, moved, missed or ignored',
    "cette tranche est déjà prise, ou elle est hors des horaires d'ouverture":
        'this block is already taken, or it is outside the opening hours',
    'ceux que vous avez ajoutés à la main. Un client dont le rendez-vous dure\nplus longtemps ne se voit proposer que des suites de tranches assez\nlongues.':
        'those you added by hand. A contact whose appointment lasts\nlonger is only offered runs of blocks that are\nlong enough.',
    "ceux qui ont refusé d'être appelés par un agent":
        'those who have refused to be called by an agent',
    'changement(s) à reporter.':
        'change(s) to carry over.',
    'changer de nature':
        'change its nature',
    'client(s) attendent un appel HUMAIN ou une correction de fiche : aucune campagne ne les traitera.':
        'contact(s) are waiting for a HUMAN call or a record fix: no campaign will handle them.',
    'client(s) concerné(s)':
        'contact(s) concerned',
    'client(s) et':
        'contact(s) and',
    'client(s) sans numéro exclu(s) de la liste —':
        'contact(s) without a number excluded from the list —',
    'client(s) sans numéro écarté(s)':
        'contact(s) without a number set aside',
    "client(s) sont dans l'état «":
        'contact(s) are in the status «',
    'client(s) 🚫 « Ne plus appeler » écarté(s)':
        'contact(s) 🚫 « Do not call » set aside',
    'close(s) sans avoir appelé':
        'closed without having called',
    'collez-la ici':
        'paste it here',
    'colonne reçue, 2 au minimum — attendu «':
        'column received, 2 at minimum — expected «',
    'colonne(s) au lieu de 4.':
        'column(s) instead of 4.',
    'colonnes reçues,':
        'columns received,',
    'commence par proposer LA date la plus proche, celle qui est écrite en « créneau proposé en premier » — une seule date, pas la liste ;':
        'start by offering THE closest date, the one written in « slot offered first » — a single date, not the list;',
    'compléter les numéros':
        'fill in the numbers',
    'confirmé':
        'confirmed',
    'confirmés':
        'confirmed',
    'conserve le thème et les paramètres':
        'keeps the theme and the settings',
    "consécutives, et aucune suite de tranches libres aussi longue n'existe dans les":
        'consecutive, and no run of free blocks that long exists in the',
    'contact(s) affiché(s) sur':
        'contact(s) shown out of',
    'contact(s) ajouté(s) à la grille.':
        'contact(s) added to the grid.',
    "contact(s) d'essai dans votre base, marqués 🧪.":
        'test contact(s) in your database, marked 🧪.',
    'contact(s) déjà dans la grille — pas ajouté(s) une seconde fois':
        'contact(s) already in the grid — not added a second time',
    'contact(s) exclu(s) — jamais composé(s) —':
        'contact(s) excluded — never dialled —',
    "contact(s) marqué(s) « Ne plus appeler » : ils seront exclus d'office à la validation, jamais composés —":
        'contact(s) marked « Do not call again »: they will be excluded automatically on confirmation, never dialled —',
    'contact(s) sans numéro (agenda importé) — à compléter dans la colonne Téléphone avant de valider.':
        'contact(s) without a number (imported calendar) — to be filled in the Phone column before confirming.',
    'contact(s) sans numéro écarté(s)':
        'contact(s) without a number set aside',
    'contact(s) sans numéro — à compléter avant validation':
        'contact(s) without a number — to complete before validation',
    'contact(s) sur':
        'contact(s) out of',
    'contact(s) sur 4 — aucun filtre.':
        'contacts out of 4 — no filter.',
    'contact(s) écarté(s) : leur rendez-vous est AVANT cette place, la décaler leur ferait perdre du temps':
        'contact(s) set aside: their appointment is BEFORE this slot, moving it would cost them time',
    'contact(s) 🚫 « Ne plus appeler » écarté(s)':
        'contact(s) 🚫 « Do not call again » set aside',
    'contacts 🚫 « ne plus appeler » et':
        'contacts 🚫 « do not call again » and',
    'contient une espace':
        'contains a space',
    'corriger sa fiche':
        'correct their record',
    "création d'appel sans identifiant dans la réponse":
        'call created with no id in the response',
    'créneau de remplacement accepté au téléphone':
        'replacement slot accepted on the phone',
    'créneau libéré accepté au téléphone':
        'freed slot accepted on the phone',
    'créneau pourvu':
        'slot filled',
    "d'affilée — il en manque":
        'in a row — missing',
    "d'affilée. Un clic de plus mène au suivant.":
        'in a row. One more click leads to the next.',
    "d'aujourd'hui":
        'from today',
    "d'un":
        'of a',
    "d'un\n      cabinet de kinésithérapie, marqués 🧪 « jeu d'essai » ;":
        'from a\n      physiotherapy practice, marked 🧪 « test data »;',
    'dans cette campagne.':
        'in this campaign.',
    'dans la grille, la fiche de campagne, le planning et\n👥 Contacts. Comme partout, ces numéros restent':
        'in the grid, the campaign record, the schedule and\n👥 Contacts. As everywhere, these numbers stay',
    'dans la liste — la page ne se recharge pas.':
        'in the list — the page does not reload.',
    'dans le créneau':
        'in the slot',
    'dans le passé,':
        'in the past,',
    'dans un créneau de rappel\n      (ex. la pause déjeuner du contact)':
        "in a callback slot\n      (e.g. the contact's lunch break)",
    'dans un créneau horaire':
        'in a time slot',
    'date convenue au téléphone':
        'date agreed on the phone',
    'date convenue refusée :':
        'agreed date refused:',
    'de campagne de remplacement — vous restez libre de la monter à la main.':
        'of a replacement campaign — you remain free to build it by hand.',
    'de démarrer :\nles appels partent un par un, dans cet ordre.':
        'starting:\nthe calls go out one by one, in this order.',
    'de la\n  fiche de campagne va lire le résultat plus tard, sans rappeler\n  personne.':
        'of the\n  campaign record will read the result later, without calling\n  anyone back.',
    "de la campagne : elle détermine le\nmessage pré-rempli, les informations demandées et les colonnes de la liste\ndes personnes. La politique d'appel affichée est celle par défaut — elle\nreste modifiable à l'étape 2.":
        'of the campaign: it determines the\npre-filled script, the information asked for and the columns of the contact\nlist. The calling policy shown is the default one — it\ncan still be changed at step 2.',
    "de la durée\nmoyenne d'un rendez-vous. Appuyez sur une tranche, glissez, relâchez :\ntoute la période s'ouvre — refaites le même geste sur une période déjà\nouverte pour la refermer.":
        'of the average\nappointment length. Press a band, drag, release:\nthe whole period opens — repeat the same gesture on a period already\nopen to close it again.',
    "de lancer quoi que ce soit. C'est un garde-fou, pas\n  une préférence.":
        'to launch anything. It is a safeguard, not\n  a preference.',
    'de monter une campagne 📞 « Créneau libéré » sur cette place — proposée, jamais lancée.':
        'to build a 📞 « Slot freed » campaign on this slot — proposed, never launched.',
    "de sa campagne ; l'échéance se reporte ou s'annule d'un geste.":
        'of its campaign; the due time is postponed or cancelled in one action.',
    'de ses rendez-vous.':
        'of their appointments.',
    'de votre session (ou de vos variables Windows), puis relancez.':
        'from your session (or from your Windows variables), then restart.',
    'demande de rendez-vous':
        'appointment request',
    "demande ensuite si elle préfère le MATIN ou l'APRÈS-MIDI ;":
        'then ask whether they prefer the MORNING or the AFTERNOON;',
    "demandé(es) : la règle n'en a pas trouvé plus — changez la source, la fenêtre, ou ajoutez des personnes à la main":
        'requested: the rule found no more — change the source, the window, or add people by hand',
    'dense les trois prochaines semaines':
        'dense for the next three weeks',
    'depuis la base — «':
        'from the database — «',
    'depuis la campagne n°':
        'from campaign no.',
    'depuis 👥 Contacts — état «':
        'from 👥 Contacts — status «',
    'dernier appel':
        'last call',
    'deux états':
        'two states',
    'dimanche':
        'Sunday',
    'dont 2 contacts 🚫 « ne plus appeler » et\n      2 sans numéro, à compléter ;':
        'including 2 contacts 🚫 « do not call » and\n      2 with no number, to be completed;',
    'dont 22 rendez-vous':
        'including 22 appointments',
    "dont l'échéance est passée. Elles ne partent pas toutes seules : c'est le bouton ci-dessous qui les lance, et les mêmes verrous s'appliquent (plage horaire, et les trois verrous des appels réels).":
        'whose due time has passed. They do not go out on their own: it is the button below that starts them, and the same locks apply (calling window, and the three locks on real calls).',
    'dont le numéro est déjà dans la liste (une seule personne sera appelée)':
        'whose number is already in the list (only one person will be called)',
    'dry_run actif : aucun appel réel ne peut partir. Passer dry_run=False EN PLUS de la confirmation explicite.':
        'dry_run on: no real call can go out. Set dry_run=False IN ADDITION to the explicit confirmation.',
    'durée :':
        'duration:',
    'début':
        'start',
    'décembre':
        'December',
    'déclaré':
        'declared',
    'décochée':
        'unchecked',
    "déduites de\nl'agenda de RingBack":
        "deduced from\nRingBack's calendar",
    'déjà dans la grille, non redoublé(s)':
        'already in the grid, not duplicated',
    "déjà déclarés) : retirez-en un avant d'en ajouter un autre.":
        'already declared): remove one before adding another.',
    'déjà prises\ndans la vraie vie':
        'already taken\nin real life',
    'déjà préparée sur cette place':
        'already prepared on this slot',
    'déjà suivi(s) par une autre campagne, repris quand même':
        'already tracked by another campaign, taken anyway',
    'délai dépassé':
        'timed out',
    'démarrer':
        'start',
    'déplacement':
        'move',
    'déplacement en attente':
        'move pending',
    'déplacement non conclu':
        'move not concluded',
    'déplacement non fait':
        'move not done',
    'déplacé':
        'moved',
    'désactivé : les contacts seront appelés sur leur propre numéro':
        'off: contacts will be called on their own number',
    'elle a été collée AVEC ses guillemets — recopiez-la sans les guillemets':
        'it was pasted WITH its quotes — copy it again without the quotes',
    "elle accepte l'un des créneaux de remplacement que tu proposes":
        'they accept one of the replacement slots you offer',
    "elle annule son rendez-vous et n'en fixe pas d'autre pendant l'appel":
        'she cancels her appointment and does not set another one during the call',
    "elle confirme fermement qu'elle sera présente":
        'they firmly confirm they will attend',
    "elle contient une espace — une clé n'en contient jamais, le copier-coller a dû emporter du texte voisin":
        'it contains a space — a key never does, the copy-paste must have picked up neighbouring text',
    'elle décline : son rendez-vous actuel reste inchangé':
        'they decline: their current appointment stays unchanged',
    'elle décline la proposition et son rendez-vous actuel reste inchangé':
        'they decline the offer and their current appointment stays unchanged',
    'elle est trop courte (':
        'it is too short (',
    'elle maintient son rendez-vous et sera présente':
        'they keep their appointment and will attend',
    'elle ne sera':
        'they will not be',
    'elle ne veut pas de rendez-vous':
        'they do not want an appointment',
    'elle refuse, ou elle annule son rendez-vous':
        'they refuse, or they cancel their appointment',
    'elle tombe après le':
        'it falls after',
    'en clair':
        'in plain text',
    'en tournant':
        'in rotation',
    'encore programmée(s)':
        'still scheduled',
    "entourée d'espaces":
        'surrounded by spaces',
    'entourée de guillemets':
        'surrounded by quotes',
    'entre 0h00 et 23h59':
        'between 00:00 and 23:59',
    'est ANNULÉ : sa place redevient libre.':
        'is CANCELLED: its slot becomes free again.',
    "est DÉJÀ PASSÉ. Un rendez-vous déplacé vers une date passée n'est pas déplacé, il est perdu : il redeviendrait « manqué » aussitôt. Rappelez cette personne pour convenir d'une vraie date.":
        'is ALREADY PAST. An appointment moved to a past date is not moved, it is lost: it would go straight back to « missed ». Call this person back to agree on a real date.',
    'est DÉJÀ PRISE par un autre rendez-vous (celui-ci demande':
        'is ALREADY TAKEN by another appointment (this one needs',
    'est ENCORE EN COURS chez CALL-E (statut «':
        'is STILL IN PROGRESS at CALL-E (status «',
    'est SUPPRIMÉ, sa place redevient libre':
        'is DELETED, its slot becomes free again',
    'est déclaré FERMÉ':
        'is declared CLOSED',
    'est marqué':
        'is marked',
    'est marqué « Ne plus appeler » : aucun appel ne lui sera passé. Le drapeau se lève depuis la page « Clients » si besoin.':
        'is flagged « Do not call again »: no call will be placed to them. The flag can be lifted from the « Contacts » page if needed.',
    'et':
        'and',
    "et\n  l'écran dit qu'il est trop tard pour organiser un remplacement\n  automatiquement. Un rendez-vous déjà passé garde toujours\n  « annulé » : c'est le statut d'histoire.":
        'and\n  the screen says it is too late to arrange a replacement\n  automatically. An appointment already past always keeps\n  « cancelled »: that is the historical status.',
    "et\n  les colonnes de la liste pour chaque personne, les autres depuis les\n  informations de l'étape ②. N'écrivez jamais de numéro de téléphone ici :\n  ce texte est dicté tel quel.":
        'and\n  the list columns for each contact, the others from the\n  information in step ②. Never write a telephone number here:\n  this text is dictated as it is.',
    'et\nleurs rendez-vous.':
        'and\ntheir appointments.',
    "et\nn'est":
        'and\nis',
    'et appeler':
        'and call',
    'et de plus en plus\nclairsemé ensuite, comme un vrai agenda : il reste donc toujours des créneaux\nlibres à proposer,':
        'and increasingly\nsparse after that, like a real schedule: so there are always free slots\nleft to offer,',
    'et il se\ncalera dessus.':
        'and it will\nfollow them.',
    "et la chaîne automatique s'est arrêtée pour elles : plus rien ne partira tout seul. Elles restent visibles ici — les faire disparaître reviendrait à les perdre.":
        'and the automatic chain has stopped for them: nothing more will go out on its own. They stay visible here — making them disappear would mean losing them.',
    'et la configuration guidée réapparaîtra — ou':
        'and the guided setup will reappear — or',
    'et laisse « new_datetime » vide':
        'and leave « new_datetime » empty',
    "et qu'aucune\n    campagne ne traite déjà":
        'and that no\n    campaign already handles',
    'et retapez':
        'and re-type',
    'et sur la fiche du contact.':
        "and on the contact's record.",
    "et tout ce\nqui n'existe que par elles :":
        'and everything\nthat exists only through them:',
    'exactement':
        'exactly',
    "faire accepter à la personne l'un des créneaux de remplacement, parce que son rendez-vous actuel ne peut pas être tenu":
        'get the person to accept one of the replacement slots, because their current appointment cannot be kept',
    'fermé':
        'closed',
    "fermé (hors horaires d'ouverture ou\njour fermé) — les tuiles colorées sont les rendez-vous":
        'closed (outside opening hours or\nclosing day) — the coloured tiles are the appointments',
    "fiches sont marquées 🧪 « jeu d'essai » :\nelles se retirent en bloc avec « Retirer le jeu d'essai » ci-dessus, sans\njamais toucher à vos vraies données.":
        'records are marked 🧪 « test data »:\nthey are removed all at once with « Remove the test data » above, without\never touching your real data.',
    "fictif :\ndes rendez-vous passés et à venir, des manqués, des annulés, des déplacés, des\ncontacts 🚫 « ne plus appeler » et des contacts sans numéro. De quoi voir\nfonctionner chaque situation sans attendre qu'elle arrive chez vous.":
        'fictional:\npast and upcoming appointments, missed ones, cancelled ones, moved ones,\n🚫 « do not call again » contacts and contacts without a number. Enough to see\neach situation work without waiting for it to happen at your practice.',
    'fixer la date':
        'set the date',
    'fixer un rendez-vous avec la personne, parmi les créneaux dont tu disposes':
        'book an appointment with the person, from the slots you have',
    'février':
        'February',
    'gérer depuis 👥 Contacts':
        'manage from 👥 Contacts',
    "h : il est supprimé, sa place redevient libre et peut être proposée à quelqu'un d'autre.":
        'h: it is deleted, its slot becomes free again and can be offered to someone else.',
    'h : il reste marqué « annulé ». Trop tard pour organiser un remplacement automatiquement — vous pouvez toujours le faire à la main.':
        'h: it stays flagged « cancelled ». Too late to arrange a replacement automatically — you can still do it by hand.',
    "h : une campagne a peu de chances d'aboutir à temps. Si\nvous voulez essayer malgré tout, c'est votre décision — le bouton ouvre\nl'assistant, il n'appelle personne.":
        'h: a campaign has little chance of succeeding in time. If\nyou want to try anyway, it is your decision — the button opens\nthe wizard, it calls no one.',
    "h : une campagne a peu de chances d'aboutir à temps. Si vous voulez\nessayer malgré tout, c'est votre décision — le bouton ouvre l'assistant, il\nn'appelle personne.":
        'h: a campaign has little chance of succeeding in time. If you want\nto try anyway, it is your decision — the button opens the wizard, it\ncalls no one.',
    'h ouvrée(s)':
        'working hour(s)',
    "h ouvrée(s) dans la plage d'appel,":
        'working hour(s) in the calling window,',
    'heure':
        'time',
    'heures (par défaut':
        'hours (default',
    "hors horaires d'ouverture":
        'outside opening hours',
    'iane demande une autre date,':
        'iane asks for another date,',
    'identité':
        'identity',
    "identité(s), c'est trop peu : il en faut au moins":
        'identity(ies), that is too few: at least',
    'identités\nfictives, chacune avec un rendez-vous à confirmer, réparties sur vos\ntesteurs':
        'fictional\nidentities, each with an appointment to confirm, spread across your\ntesters',
    "identités, c'est plus que ce que RingBack sait nommer sans répéter :":
        'identities, more than RingBack can name without repeating:',
    'ignoré':
        'ignored',
    "il a été déplacé depuis — la campagne parlerait d'une date qui n'est plus la sienne":
        'it has been moved since — the campaign would quote a date that is no longer theirs',
    "il a été supprimé de l'agenda":
        'it has been deleted from the schedule',
    'il est passé «':
        'it went to «',
    "il n'est plus à la date que la campagne avait retenue — déplacé, annulé ou supprimé depuis":
        'it is no longer on the date the campaign had picked — moved, cancelled or deleted since',
    "il n'y a que":
        'there are only',
    "il reste des places à pourvoir, mais le message de cette campagne a été récrit à la main et porte la date de sa place : l'annoncer sur une autre date aurait fait prendre un rendez-vous à une heure jamais dite au téléphone":
        "there are still slots to fill, but this campaign's script was rewritten by hand and carries its slot's date: announcing it on another date would have booked an appointment at a time never said on the phone",
    'il reste moins de':
        'there is less than',
    'il y a':
        'there are',
    'ina ne décroche\npas.':
        'ina does not\nanswer.',
    'incluse':
        'included',
    'inconnue (campagne créée avant que les recettes soient conservées)':
        'unknown (campaign created before recipes were kept)',
    'interrompue — panne de notre côté, liste non essayée':
        'interrupted — failure on our side, list not tried',
    "j'accepte le rendez-vous proposé":
        'I accept the appointment offered',
    'jamais appelé':
        'never called',
    'jamais appelées':
        'never called',
    'jamais appelés automatiquement':
        'never called automatically',
    'jamais réaffichée':
        'never shown again',
    'je demande une autre date':
        'I ask for another date',
    'je demande à être rappelé par un humain':
        'I ask to be called back by a human',
    'je ne décroche pas':
        'I do not pick up',
    "je refuse — j'annule mon rendez-vous":
        'I refuse — I cancel my appointment',
    'jeudi':
        'Thursday',
    'jour fermé':
        'closing day',
    'journées, dès le':
        'days, from',
    "jours demandés sur cette place. La chaîne s'arrête donc ici":
        'days requested on this slot. The chain therefore stops here',
    'jours ouvrés':
        'working days',
    'jours — seuls ceux que cette place ferait vraiment avancer':
        'days — only those this slot would really move forward',
    "l'agent n'a rendu aucune issue (champ vide)":
        'the agent returned no outcome (empty field)',
    "l'appel n'est pas\n  perdu":
        'the call is not\n  lost',
    "l'identité ne change pas d'un mot":
        'the identity does not change by a single word',
    "l'établissement":
        'the practice',
    "l'étape 2":
        'step 2',
    'la\nsemaine type soit ouverte : jours fériés, vacances, formation.':
        'the\nstandard week is open: public holidays, leave, training.',
    "la campagne dont la liste était reprise n'est plus identifiable.":
        'the campaign whose list was reused can no longer be identified.',
    "la chaîne s'arrête à la date limite réglée (":
        'the chain stops at the deadline set (',
    'la conversation que ce contact aurait\neue.':
        'the conversation this contact would\nhave had.',
    "la date de ce rendez-vous est illisible : il reste marqué « annulé », rien n'a été supprimé.":
        "this appointment's date is unreadable: it stays flagged « cancelled », nothing was deleted.",
    "la date rapportée par l'agent («":
        'the date reported by the agent («',
    'la ligne':
        'the row',
    "la liste de cette campagne a été choisie à la main (collage, fichier, agenda importé, ou rendez-vous désigné dans le planning) : il n'y a aucun critère à rejouer sur un autre créneau. Rien n'a été préparé — aucune liste n'est inventée. Créez la campagne suivante depuis « ➕ Nouvelle campagne ».":
        "this campaign's list was chosen by hand (paste, file, imported calendar, or appointment picked in the schedule): there is no criterion to replay on another slot. Nothing was prepared — no list is invented. Create the next campaign from « ➕ New campaign ».",
    "la personne a demandé au téléphone qu'on ne la rappelle plus":
        'the person asked on the phone not to be called again',
    "la personne a été joignable et n'a pas annulé (réponse non conclusive : «":
        'the person was reachable and did not cancel (inconclusive answer: «',
    'la personne accepte le créneau que tu proposes':
        'the person accepts the slot you offer',
    "la personne prend la place qui s'est libérée":
        'the person takes the slot that has opened up',
    'la personne retient UNE des places proposées':
        'the person picks ONE of the slots offered',
    'la place proposée a été prise entre-temps — il ne reste aucune place à pourvoir':
        'the slot offered was taken in the meantime — no slot is left to fill',
    "la place proposée n'est plus disponible :":
        'the slot offered is no longer available:',
    "la recette de cette campagne n'a pas pu être rejouée :":
        "this campaign's recipe could not be replayed:",
    'la réponse ne contient aucun destinataire (« recipients ») — RingBack ne sait pas où lire le résultat de la conversation, et il ne le devine pas':
        "the response contains no recipient (« recipients ») — RingBack does not know where to read the conversation's result, and it does not guess",
    'la semaine du':
        'the week of',
    "la variable d'environnement CALLE_API_KEY":
        'the CALLE_API_KEY environment variable',
    'laisser vide pour garder le numéro actuel':
        'leave empty to keep the current number',
    'laissez vide pour garder celui qui est enregistré':
        'leave empty to keep the one saved',
    "laissez à l'appel le temps de se terminer, puis utilisez « 📥 Récupérer les résultats en attente » sur la fiche de la campagne. Ce bouton va LIRE chez CALL-E le résultat de l'appel déjà passé et l'appliquer — il ne compose AUCUN numéro, personne ne sera rappelé.":
        'give the call time to finish, then use « 📥 Fetch pending results » on the campaign record. This button will READ from CALL-E the result of the call already placed and apply it — it dials NO number, nobody will be called back.',
    'le %d/%m/%Y à %Hh%M':
        'on %d/%m/%Y at %H:%M',
    "le client a convenu d'une autre date":
        'the contact agreed on another date',
    'le client a pris le créneau libéré':
        'the contact took the freed slot',
    'le client a pris le créneau proposé':
        'the contact took the slot offered',
    'le client rappellera':
        'the contact will call back',
    'le créneau est pourvu':
        'the slot is filled',
    'le fichier donnees/cle_calle.txt':
        'the file donnees/cle_calle.txt',
    'le maximum de':
        'the maximum of',
    "le message de cette campagne a été récrit à la main et porte la date de son créneau : il ne peut pas être rejoué sur une autre date sans inventer du texte. Aucune campagne n'a été préparée.":
        "this campaign's script was rewritten by hand and carries its slot's date: it cannot be replayed on another date without inventing text. No campaign was prepared.",
    "le premier destinataire de la réponse n'est pas un objet JSON":
        'the first recipient in the response is not a JSON object',
    'le prévenir, ou obtenir un oui ferme':
        'let them know, or get a firm yes',
    'le recontacter':
        'contact them again',
    'le rendez-vous a été déplacé':
        'the appointment was moved',
    'le résultat doit être un objet JSON':
        'the result must be a JSON object',
    'les contacts de':
        'the contacts of',
    'les lancer depuis la page Relances':
        'launch them from the Follow-ups page',
    'les rappelle :':
        'calls them back:',
    'levé':
        'lifted',
    'libre, déjà passé':
        'free, already past',
    "libres. S'il en prend une, ce n'est plus une annulation mais un":
        'free. If they take one, it is no longer a cancellation but a',
    'libéré (':
        'freed (',
    'libérée par':
        'freed by',
    'lice accepte,':
        'lice accepts,',
    'ligne(s) du cahier de changements':
        'line(s) in the change log',
    'ligne(s) portent le':
        'line(s) carry the',
    'ligne(s) refusée(s) — elles sont détaillées dans 📅 Rendez-vous.':
        'row(s) refused — they are detailed in 📅 Appointments.',
    'ligne(s) rejetée(s) :':
        'line(s) rejected:',
    'liste choisie à la main (collage, fichier, agenda importé, ou rendez-vous désigné dans le planning)':
        'list chosen by hand (paste, file, imported calendar, or appointment picked in the schedule)',
    "liste importée à l'instant":
        'list imported just now',
    'liste épuisée, créneau non pourvu':
        'list exhausted, slot not filled',
    'lui refixer un rendez-vous':
        'book them a new appointment',
    'lui refixer un rendez-vous — ⚠ non traité':
        'give them a new appointment — ⚠ not handled',
    'lui trouver la nouvelle date':
        'find them the new date',
    'lui trouver une date':
        'find them a date',
    'lundi':
        'Monday',
    'maillons au maximum) — la campagne suivante, sur la place libérée, est PRÉPARÉE, jamais lancée':
        'links at most) — the next campaign, on the freed slot, is PREPARED, never launched',
    "maillons — elle s'arrête ici, un humain reprend la main.":
        'links — it stops here, a human takes over.',
    'manqué':
        'missed',
    'mardi':
        'Tuesday',
    'masqués':
        'hidden',
    'mauvais numéro':
        'wrong number',
    'maximum de rappels atteint':
        'maximum callbacks reached',
    'mercredi':
        'Wednesday',
    'minutes ; les cases colorées sont ouvertes.':
        'minutes; the coloured cells are open.',
    'minutes est hors des bornes':
        'minutes is out of bounds',
    "minutes, le même découpage que la semaine type des réglages ; les\ncases vertes sont libres, les tuiles sont les rendez-vous posés.\nCliquez le NOM D'UN JOUR pour le choisir en entier, sans avoir à le\nparcourir au glissé.":
        'minutes, the same division as the typical week in the settings; the\ngreen cells are free, the tiles are the appointments placed.\nClick the NAME OF A DAY to select it whole, without having to\ndrag across it.',
    'minutes, sur les':
        'minutes, out of',
    'modifiable':
        'editable',
    'moi':
        'me',
    'moins de':
        'less than',
    'moins de\n  12 h':
        'less than\n  12 h',
    "n'insiste jamais : un refus se respecte dès la première fois ;":
        'never insist: a refusal is respected the first time;',
    "n'ont pas été jointes":
        'were not reached',
    'nature':
        'type',
    "nature d'appel":
        'call type',
    'ne communique aucun numéro de téléphone ;':
        'never give out a phone number;',
    'ne dit pas':
        'does not say',
    'ne donne aucune information médicale, et aucun détail qui ne soit pas écrit dans « ce que tu sais » ci-dessus ;':
        'give no medical information, and no detail that is not written in « what you know » above;',
    'ne décroche pas':
        'does not pick up',
    'ne plus appeler':
        'do not call',
    "new_datetime doit être nul quand rien n'est conclu (canceled, to_reschedule)":
        'new_datetime must be null when nothing is concluded (canceled, to_reschedule)',
    "new_datetime doit être nul sauf pour « moved » (rien n'a été convenu)":
        'new_datetime must be null except for « moved » (nothing was agreed)',
    'new_datetime doit être une date ISO 8601':
        'new_datetime must be an ISO 8601 date',
    'nom ou numéro contenant «':
        'name or number containing «',
    'non':
        'no',
    'non traité':
        'not processed',
    'non traité(s)':
        'unprocessed',
    'non — les places quittées restent libres sur votre planning, et c&#x27;est vous qui décidez d&#x27;en faire quelque chose':
        'no — vacated slots stay free on your schedule, and it is up to you to decide what to do with them',
    "non — les places quittées restent libres sur votre planning, et c'est vous qui décidez d'en faire quelque chose":
        'no — vacated slots stay free on your schedule, and it is up to you to do something with them',
    'notes doit être un texte':
        'notes must be text',
    'nouvelle':
        'new',
    "numéro d'essai":
        'test number',
    "numéro d'essai illisible":
        'test number unreadable',
    "numéro d'un testeur":
        "a tester's number",
    'numéro(s) à compléter dans la grille':
        'number(s) to complete in the grid',
    'obtenir une réponse FERME : la personne sera-t-elle présente à son rendez-vous, oui ou non':
        'get a FIRM answer: will the person attend their appointment, yes or no',
    'obtenir une réponse claire sur le rendez-vous dont parle ta présentation ci-dessus':
        'get a clear answer about the appointment your introduction above mentions',
    'options de comportement':
        'behaviour options',
    "ou après — c'est ce qu'il faudrait pour gagner les":
        'or later — that is what it would take to gain the',
    'oui':
        'yes',
    'ouvert':
        'open',
    'ouverture livrée avec le produit':
        'opening shipped with the product',
    'ouverture modifiée':
        'opening changed',
    'ouvre les façons de la remplir : coller une liste, importer un fichier, reprendre des clients ou des rendez-vous.':
        'opens the ways to fill it: paste a list, import a file, reuse contacts or appointments.',
    'ouvrez-la tout de suite':
        'open it right away',
    "page(s) n'ont pas été validées. Ce n'est pas grave : RingBack fonctionne avec ses valeurs d'origine, et tout se règle à tout moment dans ⚙ Réglages.":
        'page(s) were not confirmed. That is fine: RingBack runs with its original values, and everything can be set at any time in ⚙ Settings.',
    'page(s) réglée(s) sur':
        'page(s) set to',
    'par défaut)':
        'default)',
    'par défaut, soit 10 minutes)':
        'by default, i.e. 10 minutes)',
    "par le vôtre, au tout\ndernier moment — juste avant l'envoi à l'agent.":
        'with yours, at the very\nlast moment — just before it is sent to the agent.',
    'par page':
        'per page',
    'pas':
        'not',
    'pas appelé':
        'not called',
    'pas de réponse':
        'no answer',
    'pas de réponse ou échec technique':
        'no answer or technical failure',
    'pas de réponse, et une relance serait tombée après son rendez-vous : à appeler par un humain.':
        'no answer, and a follow-up would have fallen after their appointment: to be called by a human.',
    'pas perdu':
        'not lost',
    'personne marquée 🚫 « Ne plus appeler »':
        'person marked 🚫 « Do not call again »',
    "personne n'a de rendez-vous au":
        'nobody has an appointment on',
    'personne sans numéro':
        'person without a number',
    'personne(s) dans la liste — ordre :':
        'person(s) in the list — order:',
    'personne(s) dans leurs listes':
        'person(s) in their lists',
    'personne(s) de leurs listes. Vos clients et vos rendez-vous sont intacts.':
        'person(s) from their lists. Your contacts and appointments are intact.',
    "personne(s) ont refusé d'être appelées par un agent — elles ne l'ont pas été, et elles attendent qu'un":
        'person(s) refused to be called by an agent — they were not called, and they are waiting for a',
    'personne(s) reprise(s) de la plage choisie sur le planning':
        'person(s) taken from the range selected on the schedule',
    'personne(s) retenue(s) sur le maximum de':
        'person(s) kept out of a maximum of',
    'personne(s) sur 0 — aucun filtre.':
        'contacts out of 0 — no filter.',
    'personne(s) trouvée(s) avec ce filtre.':
        'person(s) found with this filter.',
    'personne(s) à rappeler pour':
        'person(s) to call back for',
    'personne(s) écartée(s) : cette campagne est réglée au maximum sur':
        'person(s) set aside: this campaign is set to a maximum of',
    "personne(s) écartée(s) : elles ont demandé qu'on ne leur propose plus de créneau libéré":
        'person(s) set aside: they asked not to be offered freed slots any more',
    'personne(s) 🚫 « Ne plus appeler », qui partiront vers un rappel par un humain':
        'person(s) 🚫 « Do not call again », who will go to a callback by a human',
    'personnes marquées 🚫 « Ne plus appeler »':
        'people marked 🚫 « Do not call again »',
    'personnes sans numéro':
        'people without a number',
    'place libérée :':
        'freed slot:',
    'place prise entre-temps par un autre rendez-vous':
        'slot taken in the meantime by another appointment',
    'place quittée par':
        'slot left by',
    'place(s) encore à pourvoir)':
        'slot(s) still to fill)',
    'place(s) encore à pourvoir).':
        'slot(s) still to fill).',
    'place(s) libre(s) calculée(s) à cet instant, sur les':
        'free slot(s) computed at this moment, out of the',
    'plafond de tentatives atteint':
        'attempt limit reached',
    'planifiée':
        'planned',
    'plus\n    tôt':
        'earlier',
    'plus au planning':
        'no longer in the schedule',
    'plus courte que':
        'shorter than',
    'plus de':
        'more than',
    'plus de 12 h':
        'more than 12 h',
    'plus de relance programmée':
        'no follow-up scheduled',
    'plus de rendez-vous':
        'no more appointments',
    "plus haut : sans lui, RingBack refuse — à juste titre — plusieurs contacts portant le même numéro, et cette campagne d'essai ne peut pas exister.":
        'above: without it, RingBack rejects — rightly so — several contacts sharing the same number, and this test campaign cannot exist.',
    'plus longs':
        'longer',
    "plus personne n'a de rendez-vous APRÈS la place libérée du":
        'nobody else has an appointment AFTER the slot freed on',
    "plus personne à appeler : aucun rendez-vous connu n'est après cette place":
        'nobody left to call: no known appointment is after this slot',
    'plus récentes :':
        'most recent:',
    "portent le nom de contacts du jeu\nd'essai — s'il est chargé, ils seront reconnus et rien ne sera dupliqué.":
        'carry names of contacts from the test\ndata — if it is loaded, they will be recognised and nothing will be duplicated.',
    "pose D'ABORD ta question et attends la réponse : sera-t-elle présente, oui ou non ? Ne cite AUCUNE date tant qu'elle n'a pas répondu ;":
        'ask your question FIRST and wait for the answer: will she be there, yes or no? Mention NO date until she has answered;',
    'posé':
        'set',
    'posée':
        'placed',
    "posée : l'installeur s'ouvrira dès la prochaine visite de l'accueil.":
        'set: the installer will open on the next visit to the home page.',
    "posés sur vos\n      premières places libres — ou demain matin s'il n'y en a pas assez\n      (horaires d'ouverture non réglés, ou agenda plein) : l'écran vous\n      dira lequel des deux cas s'est produit ;":
        'placed on your\n      first free slots — or tomorrow morning if there are not enough\n      (opening hours not set, or calendar full): the screen will\n      tell you which of the two happened;',
    'pour le garder tel quel.':
        'to keep it as it is.',
    "pour que l'installeur\n  réapparaisse.":
        'so that the installer\n  reappears.',
    'pour un humain':
        'for a human',
    'pour un rendez-vous de':
        'for an appointment of',
    'pour «':
        'for «',
    'pris (rendez-vous n°':
        'taken (appointment no.',
    'pris en charge par :':
        'handled by:',
    'prise (rendez-vous n°':
        'taken (appointment no.',
    'prochains jours : le prochain clic repartira du premier.':
        'coming days: the next click will start again from the first.',
    'prochains jours : les 24 premiers créneaux calculés, et':
        'days ahead: the first 24 slots computed, and',
    'prochains jours : tout est pris, fermé, ou la semaine type est vide (⚙ Réglages).':
        'coming days: everything is taken, closed, or the standard week is empty (⚙ Settings).',
    'prochains jours : tout est pris, ou fermé.':
        'days ahead: everything is taken, or closed.',
    "prochains jours. L'agent aurait proposé des dates déjà prises. Libérez une place, ou ouvrez des horaires dans « ⚙ Réglages », puis relancez ce contact — aucune date n'a été inventée.":
        'coming days. The agent would have offered dates already taken. Free up a slot, or open hours in « ⚙ Settings », then run this contact again — no date was invented.',
    "prochains jours. Libérez une place, ou ouvrez des horaires dans « ⚙ Réglages », puis relancez ce contact — aucune date n'a été inventée.":
        'coming days. Free up a slot, or open hours in « ⚙ Settings », then run this contact again — no date was invented.',
    'prochains jours. Ouvrez des heures ou libérez des rendez-vous dans':
        'days ahead. Open hours or free up appointments in',
    'programmées par le système':
        'scheduled by the system',
    'propose':
        'offers',
    "propose alors UNE SEULE heure, prise dans les créneaux disponibles ci-dessus, qui corresponde à ce jour et à ce moment de la journée ; si tu n'en as aucune qui corresponde, dis-le simplement ;":
        'then offer ONE SINGLE time, taken from the available slots above, matching that day and that time of day; if you have none that matches, just say so;',
    'préférence à confirmer':
        'preference to confirm',
    'prévu':
        'scheduled',
    'prévus':
        'planned',
    'prête':
        'ready',
    'période :':
        'period:',
    'période interdite':
        'forbidden period',
    "qu'il ne faut pas\nconfondre : son":
        'which must not be\nconfused: its',
    "quand c'est demandé. Tant que ce n'est pas fait, la clé\n  ne déclenche rien.":
        'when prompted. Until that is done, the key\n  triggers nothing.',
    'quand la personne demande une autre date':
        'when the person asks for another date',
    'quand la personne retient une des places annoncées':
        'when the person takes one of the slots offered',
    'quand même — appeler':
        'anyway — call',
    'quand une date est convenue':
        'when a date is agreed',
    'que la\n      durée moyenne (une demi-heure, une heure) : ils occupent plusieurs\n      tranches consécutives.':
        'than the\n      average length (half an hour, an hour): they take up several\n      consecutive blocks.',
    "que le leur — proposer plus tard serait proposer un retard. Le\n    temps gagné, c'est l'écart entre leur rendez-vous et cette place ; le réglage\n    ci-dessus dit à partir de combien de jours gagnés cela vaut un appel.\n    Personne n'est appelé avant le ▶ Démarrer.":
        'than theirs — offering later would be offering a delay. The\n    time gained is the gap between their appointment and this slot; the setting\n    above says from how many days gained it is worth a call.\n    Nobody is called before ▶ Start.',
    "que vous avez déclaré : c'est VOTRE téléphone qui sonnera, ou celui d'un testeur, pas celui d'un client. Elles peuvent donc porter le même numéro plusieurs fois — le refus de doublon reste entier pour tous les autres numéros.":
        "that you declared: it is YOUR phone that will ring, or a tester's, not a contact's. They can therefore carry the same number several times — the refusal of duplicates stays intact for every other number.",
    "quelqu'un doit l'appeler":
        'someone must call them',
    "qui conserve le\nthème et les paramètres de sa campagne. Aucune relance ne part seule :\nc'est toujours un geste humain.":
        'which keeps the\ntheme and settings of its campaign. No follow-up goes out on its own:\nit is always a human action.',
    "qui manquent (rien n'est doublé).":
        'that are missing (nothing is duplicated).',
    'qui occupe(nt) réellement une place.':
        'that actually take up a slot.',
    'qui vient justement de quitter cette place':
        'who has just left this slot',
    'rappel(s) est atteint':
        'callback(s) has been reached',
    'rappel(s) sur 0 — aucun filtre.':
        'callbacks out of 0 — no filter.',
    "recalculée à l'instant de l'appel":
        'recomputed at the moment of the call',
    "redire ce que tu sais n'est JAMAIS une raison de passer la main : si on te demande de répéter la date, l'heure, le lieu, la durée ou le motif, redis-les simplement, aussi souvent qu'il le faut — ils sont écrits dans « ce que tu sais » ci-dessus ;":
        'repeating what you know is NEVER a reason to hand over: if you are asked to repeat the date, the time, the place, the duration or the reason, just say them again, as often as needed — they are written in « what you know » above;',
    'refus à requalifier':
        'refusal to reclassify',
    'refuse':
        'refuses',
    'refusé':
        'declined',
    'rejoint la liste de cette campagne (':
        "joins this campaign's list (",
    'rejouée à chaque place':
        'replayed for each slot',
    "relance(s) encore programmée(s) ont été annulées : plus aucun appel d'essai ne peut partir.":
        'follow-up(s) still scheduled have been cancelled: no test call can go out any more.',
    'relance(s) encore programmée(s) ont été annulées : plus aucun appel ne partira pour lui.':
        'follow-up(s) still scheduled have been cancelled: no call will go out for them.',
    'relance(s) programmée(s) annulée(s))':
        'scheduled follow-up(s) cancelled)',
    'relance(s) traitée(s).':
        'follow-up(s) processed.',
    'remplacer le numéro de chaque contact':
        "replace each contact's number",
    'rendez-vous ajouté(s).':
        'appointment(s) added.',
    'rendez-vous annulé':
        'appointment cancelled',
    'rendez-vous avancé sur une place libérée :':
        'appointment moved up to a freed slot:',
    "rendez-vous connu dans l'agenda de RingBack sur la période concernée (":
        "appointment known in RingBack's calendar over the period concerned (",
    "rendez-vous connu(s) dans l'agenda de RingBack sur la période concernée (":
        "appointment(s) known in RingBack's calendar over the period concerned (",
    "rendez-vous d'ESSAI ajoutés à vos données (rien n'a été effacé).":
        'TEST appointments added to your data (nothing was erased).',
    "rendez-vous d'essai supprimés.":
        'test appointments deleted.',
    'rendez-vous de cette durée à replacer.':
        'appointments of this length to place again.',
    'rendez-vous dont la place a été prise par un rendez-vous importé':
        'appointment(s) whose slot was taken by an imported appointment',
    "rendez-vous déjà confirmé(s) écarté(s) — les rappeler pour confirmer n'apporterait rien":
        'already confirmed appointment(s) set aside — calling them back to confirm would add nothing',
    'rendez-vous en doublon de numéro écarté(s)':
        'appointment(s) with a duplicate number set aside',
    'rendez-vous importé(s) depuis le':
        'appointment(s) imported since',
    'rendez-vous importé(s) sans numéro — à compléter':
        'imported appointment(s) with no number — to complete',
    'rendez-vous manqué (absent)':
        'missed appointment (no-show)',
    'rendez-vous ne sont':
        'appointments are not',
    'rendez-vous obtenu au téléphone':
        'appointment obtained on the phone',
    'rendez-vous portent\nun':
        'appointments carry\na',
    'rendez-vous prévu':
        'appointment scheduled',
    'rendez-vous répartis sur':
        'appointments spread over',
    'rendez-vous sans numéro — à compléter':
        'appointment(s) with no number — to complete',
    "rendez-vous à venir retiré(s) par « remplacer entièrement l'agenda »":
        'upcoming appointment(s) removed by « replace the calendar entirely »',
    'rendez-vous)':
        'appointments)',
    'rendez-vous).':
        'appointments).',
    "rendez-vous,\npas pour le nombre de tranches qu'il occupe.":
        'appointment,\nnot for the number of blocks it takes up.',
    'rendez-vous, du plus récent au plus ancien :':
        'appointments, from newest to oldest:',
    'rendez-vous.':
        'appointment.',
    'reprendre la configuration maintenant':
        'resume setup now',
    'ressemble à une adresse web':
        'looks like a web address',
    'restant à appeler':
        'left to call',
    'reste libre sur votre planning : elle tombe après le':
        'stays free on your schedule: it falls after',
    'reste « annulé » :':
        'stays « cancelled »:',
    'retiré (règle stricte du doublon rétablie pour tous)':
        'removed (strict duplicate rule restored for everyone)',
    'reçue(s).':
        'received.',
    "rien n'a été ajouté":
        'nothing was added',
    "rien à créer : la relance reprend la nature de la campagne d'origine, et se lance depuis 🔁 Relances":
        'nothing to create: the follow-up takes the kind of the original campaign, and is launched from 🔁 Follow-ups',
    'rien à faire':
        'nothing to do',
    "rien à faire de notre côté : il a annulé sans fixer de date, c'est LUI qui reprendra contact. Aucune relance, aucune campagne — à ne pas confondre avec « à reprogrammer », où c'est NOUS qui devons le rappeler pour fixer une date.":
        'nothing to do on our side: they cancelled without setting a date, THEY will get back in touch. No follow-up, no campaign — not to be confused with « to reschedule », where WE are the ones who must call them back to set a date.',
    'règle':
        'rule',
    'réellement':
        'actually',
    "réinitialise la variable d'installation":
        'resets the install variable',
    'répartis sur':
        'spread over',
    'réponse illisible':
        'unreadable answer',
    'réponse illisible (JSON attendu)':
        'unreadable response (JSON expected)',
    'résultat en attente':
        'result pending',
    'réversible':
        'reversible',
    'rôle(s) à répartir entre eux.':
        'role(s) to share among them.',
    "s'arrête":
        'stops',
    'sa campagne':
        'their campaign',
    'sa place (':
        'their slot (',
    'sa seule ligne':
        'its only line',
    'samedi':
        'Saturday',
    'sans le motif':
        'without the reason',
    'sans numéro':
        'with no number',
    'sans numéro écarté(s)':
        'without a number set aside',
    'sans numéro, à compléter ;':
        'with no number, to complete;',
    'sans objet — cette campagne ne fait quitter sa place à personne':
        'not applicable — this campaign makes nobody leave their slot',
    'sans rendez-vous connu':
        'with no known appointment',
    'savoir si la personne accepte le nouveau créneau que tu proposes, à la place du rendez-vous manqué':
        'find out whether the person accepts the new slot you offer, instead of the missed appointment',
    'savoir si la personne prend la place qui vient de se libérer':
        'find out whether the person takes the slot that has just been freed',
    'savoir si la personne prend la place qui vient de se libérer, à la place de son rendez-vous actuel':
        'find out whether the person takes the slot that has just been freed, instead of their current appointment',
    'se libère : la campagne n°':
        'is freed: campaign no.',
    "se sont libérées pendant les\n  appels, et il n'y a rien à y remplir : elles tombent sur":
        'were freed up during the\n  calls, and there is nothing to fill in them: they fall on',
    'secondes (reçu «':
        'seconds (received «',
    "secondes d'attente réglées (dernier statut connu :":
        'seconds of waiting set (last known status:',
    'seuls les champs à remplir sont montrés ; le reste garde la valeur des ⚙ Réglages':
        'only the fields to fill in are shown; the rest keeps the value from ⚙ Settings',
    'si besoin.':
        'if needed.',
    "si elle confirme sa présence, remercie et conclus : il n'y a rien d'autre à obtenir, et proposer une autre date sèmerait le doute ;":
        'if she confirms she will be there, thank her and close: there is nothing else to get, and offering another date would sow doubt;',
    "si elle ne convient pas, demande quels JOURS de la semaine l'arrangeraient ;":
        'if it does not suit, ask which DAYS of the week would work for them;',
    'si elle ne peut pas venir ET que « ce que tu sais » porte des places libres, propose-lui UNE date pour commencer — la plus proche, pas la liste ;':
        'if she cannot come AND « what you know » lists free slots, offer her ONE date to start with — the closest one, not the list;',
    'si on te demande si tu es un robot, dis-le : « Je suis un assistant automatique, mais je peux tout à fait vous aider — et le secrétariat peut vous rappeler si vous préférez. » ;':
        'if you are asked whether you are a robot, say so: « I am an automated assistant, but I can absolutely help you — and the front desk can call you back if you prefer. »;',
    "si rien ne lui convient, ou si tu n'as aucune place à proposer, dis-lui simplement que son rendez-vous est annulé et que c'est elle qui rappellera quand elle voudra.":
        'if nothing suits her, or if you have no slot to offer, simply tell her that her appointment is cancelled and that she will call back whenever she wants.',
    "si tu n'as pas la bonne personne : « Toutes mes excuses pour le dérangement, bonne journée. », et conclus sur AUTRE ;":
        'if you do not have the right person: « Sorry to have bothered you, have a good day. », and close on OTHER;',
    "si vous n'avez pas encore de clé —\nelle vous attendra dans ⚙ Réglages → 🔌 CALL-E.":
        'if you do not have a key yet —\nit will be waiting in ⚙ Settings → 🔌 CALL-E.',
    'simulée':
        'simulated',
    'simulés':
        'simulated',
    'son rendez-vous du':
        'their appointment on',
    'sont\n  recopiées. Le discours, lui, reste propre à chaque situation : il ne dit\n  pas la même chose.':
        'are\n  copied over. The wording itself stays specific to each situation: it does\n  not say the same thing.',
    'sont de\nnouveau libres.':
        'are free\nagain.',
    "sont libres\nd'affilée à partir d'ici.":
        'are free\nin a row from here on.',
    'source de liste inconnue : «':
        'unknown list source: «',
    'structured_result du destinataire :':
        "recipient's structured_result:",
    'supprimé':
        'deleted',
    'sur les':
        'out of',
    'sur leur propre numéro':
        'on their own number',
    "sur un répondeur, laisse un message court et SANS le motif de l'appel.":
        'on an answering machine, leave a short message and WITHOUT the reason for the call.',
    "surtout pas de nouvelle campagne : son téléphone a DÉJÀ sonné et la conversation a pu avoir lieu — c'est le RÉSULTAT qui manque, pas l'appel. Allez le chercher avec « 📥 Récupérer les résultats en attente », sur la fiche de sa campagne : ce geste lit le résultat chez CALL-E sans composer aucun numéro.":
        'definitely no new campaign: their phone has ALREADY rung and the conversation may have taken place — it is the RESULT that is missing, not the call. Go and fetch it with « 📥 Retrieve pending results », on their campaign record: this action reads the result at CALL-E without dialling any number.',
    'séquentiel — arrêt au premier oui, les suivants épargnés':
        'sequential — stops at the first yes, the rest skipped',
    'séquentiel, arrêt au premier OUI':
        'sequential, stops at the first YES',
    'séquentiels':
        'sequential',
    "t'assurer que la personne a bien son rendez-vous en tête, et savoir si elle le maintient":
        'make sure the person has their appointment in mind, and find out whether they are keeping it',
    'taper un numéro pour le corriger':
        'type a number to correct it',
    'tentative(s) — maximum de rappels atteint, à traiter par un humain':
        'attempt(s) — maximum callbacks reached, to be handled by a human',
    'terminé':
        'completed',
    'terminée':
        'completed',
    'testeur(s) déclaré(s) —':
        'tester(s) declared —',
    "testeur(s) déclaré(s) — les contacts qui portent l'un de ces numéros sont marqués 🧪 partout.":
        'tester(s) declared — contacts carrying one of these numbers are marked 🧪 everywhere.',
    'testeurs au maximum sont déclarables (':
        'testers at most can be declared (',
    "testeurs déclarés : c'est le maximum. Retirez-en un pour pouvoir en ajouter un autre.":
        'testers declared: that is the maximum. Remove one to be able to add another.',
    "tiennent\n    d'affilée sont proposés":
        'fit\n    in a row are offered',
    'tous':
        'all',
    'tous les jours de la semaine':
        'every day of the week',
    'tous les états à traiter':
        'all statuses to handle',
    'tous par page':
        'all per page',
    'tout est montré, y compris ce qui a déjà une valeur par défaut':
        'everything is shown, including what already has a default value',
    'tout le monde ; non-réponse → relance':
        'everyone; no answer → follow-up',
    'tout le monde ; pas joint → relance, origine conservée':
        'everyone; not reached → follow-up, origin kept',
    'tout le monde est appelé':
        'everyone is called',
    "tout le monde est appelé ; rien n'est supprimé avant accord":
        'everyone is called; nothing is deleted before agreement',
    "tout le reste : elle propose un autre moment que ceux que tu annonces, elle ne peut rien fixer aujourd'hui, ou elle demande à être rappelée par un humain":
        'everything else: they suggest a time other than the ones you announce, they cannot set anything today, or they ask to be called back by a human',
    "tout le reste : elle préfère un moment qui n'est pas dans tes créneaux, elle demande à être rappelée par un humain, elle dit n'avoir rien demandé, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they prefer a time that is not among your slots, they ask to be called back by a human, they say they asked for nothing, or they ask a question you do not have the answer to',
    "tout le reste : elle souhaite une autre date, elle demande à être rappelée par un humain, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they would like another date, they ask to be called back by a human, or they ask a question you do not have the answer to',
    "tout le reste : elle souhaite une autre date, elle ne peut pas se décider maintenant, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they would like another date, they cannot make up their mind now, or they ask a question you do not have the answer to',
    "tout le reste : elle veut déplacer son rendez-vous, elle hésite sans pouvoir se décider, elle préfère rappeler elle-même, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they want to move their appointment, they hesitate without being able to decide, they prefer to call back themselves, or they ask a question you do not have the answer to',
    "tout le reste : elle veut déplacer son rendez-vous, elle préfère rappeler elle-même, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they want to move their appointment, they prefer to call back themselves, or they ask a question you do not have the answer to',
    "tout le reste : elle veut une autre date, elle demande à être rappelée par un humain, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they want another date, they ask to be called back by a human, or they ask a question you do not have the answer to',
    'toute la semaine':
        'all week',
    'toutes les dates':
        'all dates',
    'toutes les places sont pourvues':
        'all slots are filled',
    'toutes les semaines':
        'every week',
    'traité':
        'handled',
    'tranche libre —':
        'free period —',
    'tranches':
        'time blocks',
    'trop tard pour organiser un remplacement\n      automatiquement':
        'too late to arrange a replacement\n      automatically',
    'téléphone':
        'phone',
    'ugo veut un humain,':
        'ugo wants a human,',
    'un':
        'a',
    'un autre moyen, ou un appel humain — le maximum de':
        'another means, or a human call — the maximum of',
    'un contact déjà dans la grille':
        'a contact already in the grid',
    "un humain doit rappeler pour convenir d'une autre date.":
        'a human must call back to agree on another date.',
    'un par un':
        'one by one',
    'un rendez-vous est fixé':
        'an appointment is set',
    'un seul contact':
        'a single contact',
    'une campagne':
        'a campaign',
    'une campagne porte déjà le créneau du':
        'a campaign already covers the slot of',
    'une campagne 📞 « créneau libéré »\n  pour la remplir — rien ne part sans votre clic. À':
        'a 📞 « slot freed » campaign\n  to fill it — nothing goes out without your click. At',
    'une heure où vous\nêtes fermé.':
        'a time when you\nare closed.',
    "une à la fois, dans l'ordre":
        'one at a time, in order',
    'valider sa préférence, ou proposer mieux':
        'confirm their preference, or offer something better',
    'vendredi':
        'Friday',
    'vendredi 25/12/2026':
        'Friday 25/12/2026',
    "vers votre numéro d'essai":
        'to your test number',
    "vide l'agenda à venir":
        'clears the upcoming schedule',
    "vos heures d'ouverture":
        'your opening hours',
    'vraie conversation':
        'real conversation',
    'vraiment':
        'really',
    'vrais appels':
        'real calls',
    'y compris dans trois mois':
        'including three months from now',
    '« Ajouter des contacts »':
        '« Add contacts »',
    '« Confirmation de rendez-vous »':
        '« Appointment confirmation »',
    "« Dernière date » n'a rien à viser : votre agenda est vide.":
        '« Last date » has nothing to aim at: your calendar is empty.',
    "« Dernière date » va jusqu'au dernier rendez-vous de votre agenda — au-delà, la chaîne ne trouverait plus personne.":
        '« Last date » goes up to the last appointment in your calendar — beyond that, the chain would find nobody.',
    '« J&#x27;exige une réponse ferme »':
        '"I require a firm answer"',
    "« J'exige une réponse ferme »":
        '« I require a firm answer »',
    '« Je dois déplacer des rendez-vous »':
        '"I need to reschedule appointments"',
    '« Je rappelle leurs rendez-vous de demain »':
        '"I am reminding them of their appointments for tomorrow"',
    "« Ne plus appeler » exclut le contact de la file d'appels, des\ncascades et de la génération de liste — partout signalé par le badge 🚫, et\nréversible. « Supprimer… » passe TOUJOURS par une page de\nconfirmation.":
        '« Do not call » excludes the contact from the call queue, from\ncascades and from list generation — flagged everywhere by the 🚫 badge, and\nreversible. « Delete… » ALWAYS goes through a\nconfirmation page.',
    '« On m&#x27;a demandé un rendez-vous, je le fixe »':
        '"Someone asked for an appointment, I am booking it"',
    "« On m'a demandé un rendez-vous, je le fixe »":
        '« I have been asked for an appointment, I set it »',
    "« Remplacer entièrement l'agenda » : %d rendez-vous à venir retirés — rien n'est effacé, tout reste lisible dans « Tous les rendez-vous »":
        '« Replace the calendar entirely »: %d upcoming appointments removed — nothing is erased, everything stays readable in « All appointments »',
    '« Tous les clients » prend toute la base. Un état particulier\n    ne prend que les clients qui sont dans cet état':
        '« All contacts » takes the whole database. A particular status\n    only takes the contacts in that status',
    '« Une place s&#x27;est libérée, je remplis le trou »':
        '"A slot has opened up, I am filling the gap"',
    "« Une place s'est libérée, je remplis le trou »":
        '« A slot has been freed, I fill the gap »',
    '« annulé »':
        '« cancelled »',
    "« créneau libéré » ; si le\ncréneau n'est pas pourvu, les appels non aboutis reçoivent leur 🔁 relance.\nL'assistant «":
        '« slot freed »; if the\nslot is not filled, unanswered calls get their 🔁 follow-up.\nThe assistant «',
    '« prête »':
        '« ready »',
    "« rappel d'appels manqués »,\navec 🔁 relance programmée pour les appels non aboutis. L'assistant\n«":
        '« missed-call reminder »,\nwith a 🔁 follow-up scheduled for unanswered calls. The assistant\n«',
    "« yes » UNIQUEMENT si la personne demande explicitement qu'on ne la rappelle plus ; « no » dans tous les autres cas.":
        '« yes » ONLY if the person explicitly asks not to be called again; « no » in all other cases.',
    '« ⏱ appelé, résultat inconnu »':
        '« ⏱ called, result unknown »',
    '« 📥 Récupérer les résultats en attente »':
        '« 📥 Retrieve pending results »',
    '· code du':
        '· code of',
    '· consigne de la campagne : ne proposer aucune date':
        '· campaign briefing: offer no date',
    '· consigne de la campagne : proposer une autre date':
        '· campaign briefing: offer another date',
    '· période interdite :':
        '· forbidden period:',
    '» (attendu 0 = lundi à 6 = dimanche).':
        '» (expected 0 = Monday to 6 = Sunday).',
    '» (attendu HH:MM, par exemple 09:00).':
        '» (expected HH:MM, for example 09:00).',
    '» (attendu entre 00:00 et 24:00).':
        '» (expected between 00:00 and 24:00).',
    '» (attendu « ouvrir », « fermer » ou « basculer »).':
        '» (expected « ouvrir », « fermer » or « basculer »).',
    '» : le contact passe «':
        '»: the contact moves to «',
    '» ; la ligne est ajoutée, à compléter dans la grille.':
        '»; the row is added, to be completed in the grid.',
    '» ajoutée — variable [':
        '» added — variable [',
    "» depuis — la campagne l'avait pris «":
        '» since — the campaign had taken it «',
    '» est obligatoire pour cette nature de campagne : ajoutez au moins une place avec le « + ».':
        '» is required for this kind of campaign: add at least one slot with the « + ».',
    '» est obligatoire pour cette nature de campagne.':
        '» is required for this kind of campaign.',
    "» et nous n'avons pas pu vous accueillir. Je vous propose un nouveau créneau":
        '» and we were unable to see you. I can offer you a new slot',
    '» existe déjà.':
        '» already exists.',
    '» fait la\nmême chose, guidé.':
        '» does the\nsame thing, guided.',
    '» fait la même chose,\nguidé.':
        '» does the same thing,\nguided.',
    '» mais cet état ne se traite pas par «':
        '» but this state is not handled by «',
    "» n'appelle aucune campagne.":
        '» triggers no campaign.',
    "» n'en a pas.":
        '» has none.',
    '» ne reste à traiter':
        '» remains to be handled',
    '» non traité, traité par «':
        '» not handled, handled by «',
    '» retire ce rendez-vous du planning et rend sa place —':
        '» removes this appointment from the schedule and gives back its slot —',
    '» retiré de la grille.':
        '» removed from the grid.',
    '» sont déjà pris en charge par une campagne en cours, et ne sont donc pas repris ici':
        '» are already handled by a campaign under way, and so are not included here',
    '» — attendu par exemple 2026-08-03T09:00 ou 03/08/2026 09:00.':
        '» — expected for example 2026-08-03T09:00 or 03/08/2026 09:00.',
    '» — attendu par exemple 2026-08-03T09:00.':
        '» — expected for example 2026-08-03T09:00.',
    '» — attendu un nombre de minutes multiple de':
        '» — expected a number of minutes, a multiple of',
    "» — attendu un nombre entier d'heures entre":
        '» — expected a whole number of hours between',
    '» — attendu un nombre entier entre':
        '» — expected a whole number between',
    '» — attendu une date, par exemple 2026-08-15T14:30 ou « samedi 15 août 2026 à 14 heures 30 »':
        '» — expected a date, for example 2026-08-15T14:30 or « Saturday 15 August 2026 at 2:30 pm »',
    "» — changez de nature à l'étape 1":
        '» — change the type at step 1',
    '» — choisissez-en un dans la liste (':
        '» — pick one from the list (',
    "» — et elle n'a trouvé personne pour la place en cours. Elle sera":
        '» — and it found nobody for the current slot. It will be',
    '» — maximum de rappels atteint':
        '» — maximum callbacks reached',
    '» — rien à retaper. Pour le renommer,\nretirez-le et ajoutez-le à nouveau.':
        '» — nothing to retype. To rename it,\nremove it and add it again.',
    "») : rien n'a été écrit sur cette personne. Réessayez dans un moment.":
        '»): nothing was written for this person. Try again in a moment.',
    '») est illisible (':
        '») cannot be read (',
    "») ne fait partie d'AUCUNE des places annoncées pendant l'appel : rien n'a été réservé.":
        '») matches NONE of the slots announced during the call: nothing was booked.',
    '») — attendu une date du calendrier, par exemple 31/12/2026.':
        '») — expected a calendar date, for example 31/12/2026.',
    "». Ce texte est dicté tel quel à l'agent : aucun numéro ne doit y figurer. Rien n'a été enregistré.":
        '». This text is read out to the agent as is: no number must appear in it. Nothing was saved.',
    '». Formats acceptés : 2026-08-01T14:30 ou 01/08/2026 14:30.':
        '». Accepted formats: 2026-08-01T14:30 or 01/08/2026 14:30.',
    '». Formats acceptés : 2026-08-15 ou 15/08/2026.':
        '». Accepted formats: 2026-08-15 or 15/08/2026.',
    '». Je peux vous proposer un nouveau créneau':
        '». I can offer you a new slot',
    '». Relisez-les avant de valider.':
        '». Read them over before confirming.',
    "». Un même téléphone ne peut pas jouer deux testeurs — donnez un autre numéro, ou renommez celui-là en le retirant puis en l'ajoutant à nouveau.":
        '». One phone cannot play two testers — give another number, or rename this one by removing it then adding it again.',
    'À corriger :':
        'To fix:',
    'À ne renseigner que pour un essai.':
        'Only fill this in for a test.',
    'À quoi sert le jeu d&#x27;essai ?':
        'What is the test data for?',
    "À quoi sert le jeu d'essai ?":
        'What is the test data for?',
    'À reprogrammer':
        'To reschedule',
    'À reprogrammer (date non conclue)':
        'To reschedule (no date agreed)',
    'À traiter par un humain':
        'For a human to handle',
    'Échec':
        'Failed',
    'Échec technique':
        'Technical failure',
    'Échecs':
        'Failures',
    'Échéance':
        'Due date',
    'Échéance de relance introuvable : plage horaire invalide.':
        'Follow-up due date not found: invalid time range.',
    'Étapes de la création':
        'Creation steps',
    'État':
        'Status',
    "État d'agenda — ce que dit le planning":
        'Diary status — what the schedule says',
    'État de conversation — ce que le dernier appel a produit':
        'Conversation status — what the last call produced',
    'État de reprise inconnu : «':
        'Unknown resume state: «',
    "à\n      l'état":
        'to\n      status',
    "à\nl'écran : les déclarer ne les rend pas lisibles.":
        'on\nscreen: declaring them does not make them readable.',
    'à appeler':
        'to call',
    'à choisir':
        'to choose',
    'à configurer':
        'to set up',
    'à faire':
        'to do',
    'à la main':
        'manually',
    'à libérer dans votre agenda (introuvable dans la base)':
        'to free up in your calendar (not found in the database)',
    'à partir de cette tranche':
        'from this block on',
    'à pourvoir':
        'to fill',
    'à rappeler par un humain':
        'to be called back by a human',
    'à recontacter':
        'to contact again',
    'à reprogrammer':
        'to reschedule',
    "à retirer : la liste a peut-être changé entre-temps. Rien n'a été modifié — voyez la liste ci-dessous.":
        'to remove: the list may have changed in the meantime. Nothing was modified — see the list below.',
    'à traiter':
        'to process',
    'à venir':
        'upcoming',
    'à venir\n      (':
        'upcoming\n      (',
    "à votre base (rien n'est effacé) :":
        'to your database (nothing is erased):',
    'écarté(s) : leur rendez-vous est avant cette place':
        'set aside: their appointment is before this slot',
    'écarté(s) parce que leur rendez-vous est AVANT cette place — la décaler leur ferait perdre du temps.':
        'set aside because their appointment is BEFORE this slot — moving it would cost them time.',
    'échec':
        'failed',
    'échec de notre côté':
        'failure on our side',
    'échec technique':
        'technical failure',
    'émi refuse,':
        'émi refuses,',
    'épargné':
        'skipped',
    'épuisée':
        'exhausted',
    "état d'agenda":
        'calendar status',
    'état de conversation':
        'conversation status',
    'état «':
        'status «',
    '—\n      33 dans le passé, 79 à venir\n      (9 annulé ; 12 confirmé ; 9 déplacé ; 10 manqué ; 72 prévu) ;':
        '—\n      33 in the past, 79 upcoming\n      (9 cancelled; 12 confirmed; 9 moved; 10 missed; 72 scheduled);',
    "—\n    il n'est jamais réaffiché en clair, même ici.":
        '—\n    it is never shown in plain text again, even here.',
    "—\n  elles sortent de VOTRE agenda : horaires d'ouverture, jours fermés,\n  rendez-vous déjà pris. Jamais une date inventée.":
        '—\n  they come from YOUR schedule: opening hours, closing days,\n  appointments already booked. Never an invented date.',
    '—\n  une plage horaire, une période interdite. Hors de là, RingBack':
        '—\n  a calling window, a forbidden period. Outside that, RingBack',
    '— Ctrl+C pour arrêter.':
        '— Ctrl+C to stop.',
    '— aucun filtre':
        '— no filter',
    "— aucun import n'a jamais été enregistré (les rendez-vous saisis à la main ne comptent pas ici).":
        '— no import has ever been recorded (appointments entered by hand do not count here).',
    "— aucun ordre n'est\nimposé, la décision vous revient":
        '— no order is\nimposed, the decision is yours',
    '— aucun rendez-vous':
        '— no appointment',
    "— aucun rendez-vous connu dans l'agenda de RingBack, il n'y a donc rien à confirmer.":
        "— no appointment known in RingBack's calendar, so there is nothing to confirm.",
    "— aucun rendez-vous n'y est possible. Les jours fermés se retirent dans « ⚙ Réglages ».":
        '— no appointment is possible then. Closing days are removed in « ⚙ Settings ».',
    "— aucun téléphone ne sonne. En appels réels, le garde-fou de politesse s'appliquerait de nouveau.":
        '— no phone rings. In real calls, the courtesy safeguard would apply again.',
    "— aucune n'a été préparée en double.":
        '— none was prepared twice.',
    "— aucune n'est préparée en double.":
        '— none is prepared twice.',
    "— aucune relance n'est programmée pour eux, et ils ne repartent dans aucune campagne tant qu'un humain ne les y remet pas.":
        '— no follow-up is scheduled for them, and they do not go back into any campaign until a human puts them back in.',
    "— ce n'est PAS ce que l'agent dira, la liste de cette campagne étant écrite à la main.":
        "— this is NOT what the agent will say, this campaign's list being written by hand.",
    "— ce n'est pas elle qui l'arrête":
        '— the deadline is not what stops it',
    '— cela vous convient-il ?':
        '— does that suit you?',
    "— chaque voie ouvre son propre écran ; on peut les\nenchaîner (les contacts s'ajoutent aux précédents).":
        '— each route opens its own screen; you can chain\nthem (contacts add to the previous ones).',
    '— choisir une campagne —':
        '— choose a campaign —',
    '— choisir une plage en la saisissant :':
        '— choose a time range by typing it:',
    '— confirmé':
        '— confirmed',
    '— créez la première !':
        '— create the first one!',
    '— créneau':
        '— slot',
    '— de':
        '— from',
    '— doublon ignoré.':
        '— duplicate ignored.',
    '— du':
        '— from',
    '— elle se règle par':
        '— it is set through',
    '— en mode réel, tous les appels iront vers':
        '— in real mode, every call will go to',
    '— entré pour :':
        '— entered for:',
    "— et le rendez-vous obtenu tombera sur quelqu'un\nd'autre. Reportez d'abord ce qui a changé, puis lancez.":
        '— and the appointment obtained will land on someone\nelse. Enter what has changed first, then start.',
    "— il doit conclure sur l'une\ndes trois":
        '— it must end on one\nof the three',
    "— il doit conclure sur l'une des\n  trois":
        '— it must conclude on one of the\n  three',
    '— imposée par la nature, elle ne se règle pas.':
        '— imposed by its nature, not adjustable.',
    '— jamais appelé':
        '— never called',
    '— jamais « injoignable » —\n  et le bouton':
        '— never « unreachable » —\n  and the button',
    "— l'agent annonce alors les places":
        '— the agent then announces the slots',
    "— la clé elle-même n'est jamais affichée, ni ici ni dans les journaux.":
        '— the key itself is never shown, neither here nor in the logs.',
    "— la liste se recalcule, elle n'est\n    jamais recopiée.":
        '— the list is recomputed, it is\n    never copied over.',
    '— la page ne se recharge pas.':
        '— the page does not reload.',
    '— la place est\n      libre':
        '— the slot is\n      free',
    '— la place quittée rejoint cette campagne, qui continue dessus':
        '— the vacated slot joins this campaign, which carries on with it',
    "— la simulation, elle, se conclut en une seconde et n'est pas\n  ralentie. Elles ont été réglées pour une":
        '— simulation, by contrast, finishes in one second and is not\n  slowed down. They have been set for a',
    '— le copier-coller a dû être incomplet':
        '— the copy-paste must have been incomplete',
    '— le créneau libéré reste à pourvoir':
        '— the freed slot is still to fill',
    "— le format standard,\n  exporté par tous les logiciels d'agenda. Le titre de chaque événement donne\n  « Nom — Motif », sa date et son heure de fin donnent la place occupée.":
        "— the standard format,\n  exported by every calendar program. Each event's title gives\n  « Name — Reason », its date and end time give the slot taken.",
    "— le nom de\n  votre établissement est prononcé à voix haute au début de chaque appel, et\n  le texte d'ouverture de chaque type de campagne se règle une fois pour\n  toutes.":
        '— the name of\n  your practice is spoken aloud at the start of every call, and\n  the opening text of each campaign type is set once and for\n  all.',
    '— le rendez-vous du':
        '— the appointment of',
    '— là, il discute\n  librement':
        '— there, it talks\n  freely',
    '— là, il discute librement':
        '— there, it talks freely',
    '— maximum de rappels atteint':
        '— maximum callbacks reached',
    '— moins de':
        '— less than',
    '— non rejouable sur un autre créneau':
        '— cannot be replayed on another slot',
    '— options par défaut':
        '— default options',
    '— ouverture livrée avec le produit':
        '— opening delivered with the product',
    '— ouvrir ou fermer une période en\n  la saisissant (format des heures : HH:MM, par exemple 09:00) :':
        '— open or close a period by\n  entering it (time format: HH:MM, for example 09:00):',
    "— quand quelqu'un accepte de décaler son rendez-vous, la place qu'il vient de quitter REJOINT cette campagne, qui continue dessus avec le budget d'appels qui lui reste. De proche en proche, un seul trou peut ainsi en combler plusieurs. Décochée, le trou reste simplement visible sur votre planning, et vous en faites ce que vous voulez":
        '— when someone agrees to move their appointment, the slot they have just left JOINS this campaign, which carries on with the call budget it has left. Step by step, a single gap can thus fill several. Unchecked, the gap simply stays visible on your schedule, and you do what you want with it',
    '— recontacter ou non, au bout de combien de temps, combien de\n  fois.':
        '— whether to call back or not, after how long, how many\n  times.',
    '— rejouable sur un autre créneau':
        '— can be replayed on another slot',
    '— retirez le doublon.':
        '— remove the duplicate.',
    "— réponse de l'API :":
        '— API response:',
    '— réponse entière :':
        '— full response:',
    '— sa place du':
        '— their slot of',
    '— ses appels non aboutis y ont leur 🔁 relance programmée.':
        '— its unsuccessful calls have their 🔁 follow-up scheduled there.',
    '— trop tard pour lui servir. Appelez cette personne vous-même.':
        '— too late to be of use to them. Call this person yourself.',
    "— un OUI annule l'ancien rendez-vous du client (jamais deux rendez-vous pour la même personne)":
        "— a YES cancels the contact's old appointment (never two appointments for the same person)",
    '— un appel\n  par identité. Au-delà de':
        '— one call\n  per identity. Beyond',
    "— un appel\n  par identité. Au-delà de 5, les rôles\n  reviennent dans le même ordre, portés par d'autres prénoms de même\n  initiale.":
        '— one call\n  per identity. Beyond 5, the roles\n  come back in the same order, carried by other first names with the same\n  initial.',
    "— un fichier d'exemple est fourni\n(":
        '— a sample file is provided\n(',
    '— vos données ne sont pas touchées — et':
        '— your data is not touched — and',
    '— à choisir à chaque campagne —':
        '— to be chosen for each campaign —',
    '— à choisir —':
        '— choose —',
    '— à renseigner dans':
        '— to enter in',
    '— à venir':
        '— upcoming',
    '— état dans la campagne :':
        '— status in the campaign:',
    '— 🔗 Décalage en cascade :':
        '— 🔗 Cascade shift:',
    '— 🔗 La place du':
        '— 🔗 The slot on',
    '… [tronqué :':
        '… [truncated:',
    '… et':
        '… and',
    '… mais':
        '… but',
    '… sans suite':
        '… no further action',
    '← Retour au planning':
        '← Back to the schedule',
    '← Retour aux campagnes':
        '← Back to campaigns',
    '← Retour aux contacts':
        '← Back to contacts',
    '← Retour aux relances':
        '← Back to follow-ups',
    '← Retour aux rendez-vous':
        '← Back to appointments',
    '← Retour aux réglages':
        '← Back to settings',
    '← Retour à la cascade':
        '← Back to the cascade',
    "← Retour à la file d'appels":
        '← Back to the call queue',
    '↩ Revenir à la grille':
        '↩ Back to the grid',
    '⏭ Prochain créneau disponible':
        '⏭ Next available slot',
    "⏰ Quand RingBack a le droit d'appeler":
        '⏰ When RingBack is allowed to call',
    '⏰ Relances dues':
        '⏰ Follow-ups due',
    '⏰ Relances dues (0)':
        '⏰ Follow-ups due (0)',
    '⏱ Annulation et remplacement':
        '⏱ Cancellation and replacement',
    "⏱ Annulation pendant un appel — combien d'heures AVANT le\n    rendez-vous peut-on encore organiser un remplacement ?":
        '⏱ Cancellation during a call — how many hours BEFORE the\n    appointment can a replacement still be arranged?',
    "⏱ Attente maximale d'un appel, en secondes — sonnerie + conversation\n    + compte rendu (de":
        '⏱ Maximum wait for a call, in seconds — ringing + conversation\n    + report (from',
    "⏱ Attente maximale d'un appel, en secondes — sonnerie + conversation\n    + compte rendu (de 60 à 3600 ; 600 par défaut, soit 10 minutes)":
        '⏱ Maximum wait for a call, in seconds — ringing + conversation\n    + report (from 60 to 3600; 600 by default, i.e. 10 minutes)',
    '⏱ Combien de temps attendre un vrai appel':
        '⏱ How long to wait for a real call',
    "⏱ Délai d'attente d'UNE demande à CALL-E, en secondes — le temps\n    laissé au service pour répondre à une seule question (de":
        '⏱ Timeout for ONE request to CALL-E, in seconds — the time\n    given to the service to answer a single question (from',
    "⏱ Délai d'attente d'UNE demande à CALL-E, en secondes — le temps\n    laissé au service pour répondre à une seule question (de\n    5 à\n    120 ;\n    30 par défaut)":
        '⏱ Timeout for ONE request to CALL-E, in seconds — the time\n    allowed for the service to answer a single question (from\n    5 to\n    120;\n    30 by default)',
    "⏱ Intervalle entre deux vérifications, en secondes — au bout de ce\n    délai RingBack redemande où en est l'appel (de":
        '⏱ Interval between two checks, in seconds — after this\n    delay RingBack asks again where the call stands (from',
    "⏱ Intervalle entre deux vérifications, en secondes — au bout de ce\n    délai RingBack redemande où en est l'appel (de 1 à 60 ; 5 par défaut)":
        '⏱ Interval between two checks, in seconds — after this\n    delay RingBack asks again where the call stands (from 1 to 60; 5 by default)',
    "⏱ L'appel est parti — son résultat n'est pas encore connu":
        '⏱ The call has gone out — its outcome is not known yet',
    '⏱ appelé, résultat inconnu':
        '⏱ called, result unknown',
    '⏹ Arrêter':
        '⏹ Stop',
    "① Ce que l'agent dit en ouvrant":
        '① What the agent says when opening',
    "① Ce que l'agent dit en ouvrant, mot pour mot":
        '① What the agent says when opening, word for word',
    '① Rappel d&#x27;un rendez-vous manqué':
        '① Missed appointment reminder',
    "① Rappel d'un rendez-vous manqué":
        '① Callback about a missed appointment',
    '② Confirmation de rendez-vous':
        '② Appointment confirmation',
    '② Son objectif et son contexte':
        '② Its objective and its context',
    '③ Déplacement de rendez-vous':
        '③ Appointment move',
    '③ Les issues':
        '③ The outcomes',
    '④ Créneau libéré (cascade)':
        '④ Slot freed (cascade)',
    '▶ Démarrer la configuration':
        '▶ Start setup',
    '▶ Démarrer — appeler':
        '▶ Start — call',
    '▶ Lancer les':
        '▶ Run the',
    "▶ Oui, l'agenda est à jour —":
        '▶ Yes, the calendar is up to date —',
    '▶ Reprendre — continuer où on en était':
        '▶ Resume — pick up where it left off',
    '◀ Semaine précédente':
        '◀ Previous week',
    '☎ 0 sans numéro':
        '☎ 0 no number',
    "☎ sans numéro : rien n'est possible":
        '☎ no number: nothing is possible',
    "☎ sans numéro : rien n'est possible tant que la fiche n'est pas complétée":
        '☎ no number: nothing is possible until the record is completed',
    '⚙ Options de comportement':
        '⚙ Behaviour options',
    '⚙ Paramètres':
        '⚙ Settings',
    '⚙ Réglages':
        '⚙ Settings',
    "⚙ les horaires d'ouverture":
        '⚙ opening hours',
    '⚙ modifier':
        '⚙ change',
    '⚠ 4 non traité(s)':
        '⚠ 4 not handled',
    "⚠ = colonne obligatoire ; une colonne facultative peut rester\n    vide. L'exemple en filigrane n'est pas envoyé — il montre seulement la\n    forme attendue.":
        '⚠ = required column; an optional column can stay\n    empty. The faded example is not sent — it only shows the\n    expected form.',
    "⚠ Appel RENVOYÉ vers le numéro d'essai %s au lieu de %s : ce contact n'est PAS appelé (son identité, elle, part inchangée)":
        '⚠ Call REDIRECTED to test number %s instead of %s: this contact is NOT called (their identity is sent unchanged)',
    '⚠ Attention notez que les rendez-vous importés remplacent les rendez-vous de votre agenda s&#x27;ils sont sur le même créneau horaire.':
        '⚠ Note that imported appointments replace the appointments in your schedule when they fall on the same slot.',
    '⚠ Ce que RingBack a fait :':
        '⚠ What RingBack did:',
    '⚠ Ce que RingBack constate lui-même :':
        '⚠ What RingBack sees for itself:',
    "⚠ La clé enregistrée ici n'est PAS celle qui sert.":
        '⚠ The key saved here is NOT the one being used.',
    '⚠ La liste injectée ci-dessous et le fichier CSV\n  (liste_rappel_AAAAMMJJ.csv) contiennent les numéros':
        '⚠ The list injected below and the CSV file\n  (liste_rappel_AAAAMMJJ.csv) contain the numbers',
    "⚠ [entreprise] n'est pas réglé et aucun créneau disponible (ni horaires d'ouverture, ni créneau ajouté à la main) — à renseigner dans":
        '⚠ [entreprise] is not set and no slot available (neither opening hours nor a manually added slot) — to be set in',
    '⚠ absent à son rendez-vous':
        '⚠ missed their appointment',
    "⚠ c'est aujourd'hui — RingBack ne propose jamais le jour même, seulement à partir de demain. Votre saisie reste ici.":
        '⚠ that is today — RingBack never offers the same day, only from tomorrow on. Your entry stays here.',
    "⚠ heure passée — ce créneau n'est plus proposé au téléphone. Votre saisie reste ici : à vous de la retirer.":
        '⚠ time already past — this slot is no longer offered on the phone. Your entry stays here: it is up to you to remove it.',
    '⚠ non traité':
        '⚠ not handled',
    '⚠ numéro à compléter':
        '⚠ number to complete',
    "⚠ un rendez-vous occupe déjà cette tranche — il reste proposé parce que vous l'avez ajouté à la main.":
        '⚠ an appointment already occupies this block — it is still offered because you added it by hand.',
    "⚠ « Toujours utiliser mon numéro » est coché, mais le numéro enregistré n'est pas composable : AUCUN appel ne pourra partir. Corrigez-le dans ⚙ Réglages → 🧪 Essais → Jeu d'essai.":
        '⚠ « Always use my number » is ticked, but the saved number cannot be dialled: NO call will be able to go out. Fix it in ⚙ Settings → 🧪 Tests → Test data.',
    '⚠ À savoir avant de choisir —':
        '⚠ Worth knowing before choosing —',
    "⚠ à chaque refus, REPRENDS LE FILTRE au lieu d'enchaîner les heures : redemande quels jours l'arrangeraient, puis matin ou après-midi, puis propose une heure. Une heure à la fois, jamais une liste — c'est la personne qui restreint, pas toi qui énumères ;":
        '⚠ on each refusal, GO BACK TO THE FILTER instead of reeling off times: ask again which days would suit them, then morning or afternoon, then offer one time. One time at a time, never a list — the person narrows it down, you do not list;',
    "⛔ Aucun appel n'est parti":
        '⛔ No call went out',
    "⛔ Cascade INTERROMPUE par une panne de notre côté : la liste n'a pas été essayée. Les personnes qui n'apparaissent pas ci-dessous n'ont jamais été appelées — relancez la cascade une fois la panne réparée.":
        '⛔ Cascade INTERRUPTED by a failure on our side: the list was not tried. The people who do not appear below were never called — run the cascade again once the failure is fixed.',
    "⛔ Décalage en cascade : indiquez la date jusqu'à laquelle la chaîne peut décaler des rendez-vous (format attendu : jj/mm/aaaa). Sans cette limite, la chaîne n'aurait pas de fin.":
        '⛔ Cascade shift: give the date up to which the chain may move appointments (expected format: dd/mm/yyyy). Without this limit, the chain would have no end.',
    '⛔ Période interdite — début (ex. 12:00 ; laisser les deux champs\n    vides pour aucune)':
        '⛔ Blocked period — start (e.g. 12:00; leave both fields\n    empty for none)',
    '⛔ Période interdite — fin (ex. 14:00)':
        '⛔ Blocked period — end (e.g. 14:00)',
    '✅ Acceptés':
        '✅ Accepted',
    '✅ Clé enregistrée (':
        '✅ Key saved (',
    '✅ Clé enregistrée (95 caractère(s)), fournie par la variable d&#x27;environnement CALLE_API_KEY.':
        '✅ Key saved (95 characters), supplied by the CALLE_API_KEY environment variable.',
    '✅ Confirmation de rendez-vous':
        '✅ Appointment confirmation',
    "✅ Rien n'attend de rappel : aucune relance programmée, personne au maximum de rappels, aucun rappel par un humain en attente.":
        '✅ Nothing is waiting for a callback: no follow-up scheduled, no one at maximum callbacks, no callback by a human pending.',
    '✅ accepté':
        '✅ accepted',
    '✅ confirmé':
        '✅ confirmed',
    '✎ Coller une liste':
        '✎ Paste a list',
    '✎ Compléter les numéros manquants':
        '✎ Fill in the missing numbers',
    '✎ Modifier le texte à la main':
        '✎ Edit the text by hand',
    "✔ C'est fait":
        '✔ Done',
    '✖ Annuler ce rendez-vous':
        '✖ Cancel this appointment',
    '✖ Annuler ce rendez-vous…':
        '✖ Cancel this appointment…',
    '✖ Rendez-vous retiré':
        '✖ Appointment removed',
    '✖ annulé':
        '✖ cancelled',
    '✖ rendez-vous annulé':
        '✖ appointment cancelled',
    '❌ refusé':
        '❌ declined',
    '➕ Créer la campagne « 📞 Créneau libéré » sur\n  cette place':
        '➕ Create the « 📞 Slot freed » campaign on\n  this slot',
    '➕ Nouvelle campagne':
        '➕ New campaign',
    '➖ supprimé':
        '➖ deleted',
    "⬇ Télécharger l'agenda d'exemple":
        '⬇ Download the sample calendar',
    '＋ Ajouter des contacts':
        '＋ Add contacts',
    '＋ Ajouter un rendez-vous':
        '＋ Add an appointment',
    '＋ Ajouter une ligne':
        '＋ Add a line',
    '＋ Importer votre agenda':
        '＋ Import your schedule',
    '＋ importer un agenda (ICS) ou un fichier\nCSV':
        '＋ import a calendar (ICS) or a CSV\nfile',
    "🏷 Identité de l'établissement":
        '🏷 Practice identity',
    '👥 Charger des clients':
        '👥 Load contacts',
    '👥 Contacts':
        '👥 Contacts',
    "👥 Contacts → assistant : brouillon ouvert à l'étape 2 (nature %s, état %s, %d contact(s)) — aucun appel":
        '👥 Contacts → wizard: draft opened at step 2 (type %s, state %s, %d contact(s)) — no call',
    '👥 Liste déjà remplie :':
        '👥 List already filled in:',
    '👥 Liste établie par la règle :':
        '👥 List built by the rule:',
    '💤 épargné':
        '💤 skipped',
    '📄 Importer un fichier CSV':
        '📄 Import a CSV file',
    '📅 Charger selon les dates de rendez-vous':
        '📅 Load by appointment date',
    '📅 Importer un agenda (ICS)':
        '📅 Import a calendar (ICS)',
    '📅 Rendez-vous':
        '📅 Appointments',
    "📅 Un agenda d'exemple à importer":
        '📅 A sample calendar to import',
    '📅 le planning de la\nsemaine':
        "📅 the week's\nschedule",
    '📅 rendez-vous prévu':
        '📅 appointment scheduled',
    '📆 Déplacement de rendez-vous':
        '📆 Appointment rescheduling',
    '📆 Déplacer — monter la campagne\n    « Déplacement de rendez-vous »':
        '📆 Move — set up the campaign\n    « Appointment rescheduling »',
    '📆 déplacement en attente':
        '📆 move pending',
    '📆 🔔 ✅ Aucun rendez-vous dans cette plage.':
        '📆 🔔 ✅ No appointment in this range.',
    '📋 Copier le cahier':
        '📋 Copy the log',
    '📋 Le cahier des changements à reporter':
        '📋 The log of changes to carry over',
    '📕 Jours fermés exceptionnels':
        '📕 Exceptional closing days',
    '📕 fermé':
        '📕 closed',
    '📛 mauvais numéro':
        '📛 wrong number',
    '📛 mauvais numéro — à venir':
        '📛 wrong number — coming soon',
    '📞 Appels':
        '📞 Calls',
    '📞 Aucune place libre à venir dans cette plage.':
        '📞 No free slot ahead in this range.',
    '📞 Campagne pour remplir les créneaux libres':
        '📞 Campaign to fill the free slots',
    '📞 Compenser une absence':
        '📞 Make up for an absence',
    "📞 Compenser une absence — les places qu'une annulation a libérées":
        '📞 Make up for an absence — the slots a cancellation has freed',
    '📞 Créer la campagne « Créneau libéré » sur cette\n  place':
        '📞 Create the « Slot freed » campaign on this\n  slot',
    '📞 Créneau libéré':
        '📞 Slot freed up',
    '📞 Obtenu par téléphone — demande faite par la campagne':
        '📞 Obtained by phone — request made by the campaign',
    '📞 Préparer la campagne « créneau libéré »':
        '📞 Prepare the « slot freed » campaign',
    '📞 Préparer quand même la campagne':
        '📞 Prepare the campaign anyway',
    '📞 Une campagne porte déjà cette place :':
        '📞 A campaign already covers this slot:',
    '📞 il reprend contact lui-même':
        '📞 they get back in touch themselves',
    '📞 le contact rappellera':
        '📞 the contact will call back',
    '📣 Campagnes':
        '📣 Campaigns',
    '📣 Cette exécution est enregistrée comme':
        '📣 This run is recorded as',
    '📣 Charger selon une campagne':
        '📣 Load by campaign',
    '📣 campagne':
        '📣 campaign',
    '📤 Campagnes passées':
        '📤 Past campaigns',
    '📥 Import terminé —':
        '📥 Import finished —',
    '📥 Récupérer les résultats en attente':
        '📥 Retrieve pending results',
    '📵 Non joints — maximum de rappels atteint':
        '📵 Not reached — callback limit reached',
    '📵 Non joints — maximum de rappels atteint (':
        '📵 Not reached — maximum callbacks reached (',
    '📵 Non joints — maximum de rappels atteint (0)':
        '📵 Not reached — maximum callbacks reached (0)',
    '📵 Toujours composer MON numéro':
        '📵 Always dial MY number',
    '📵 injoignable':
        '📵 unreachable',
    '🔁 Créneau de rappel par défaut — début':
        '🔁 Default follow-up slot — start',
    '🔁 Créneau de rappel par défaut — fin':
        '🔁 Default follow-up slot — end',
    "🔁 Des relances sont programmées. Leurs échéances se lisent sur la page des relances. L'exécution automatique est":
        '🔁 Follow-ups are scheduled. Their due dates are shown on the follow-ups page. Automatic execution is',
    "🔁 Délai par défaut, en heures OUVRÉES comptées dans la plage\n      d'appel":
        '🔁 Default delay, in WORKING hours counted within the calling\n      window',
    '🔁 Recontacter si non joignable':
        '🔁 Call back if unreachable',
    '🔁 Relances':
        '🔁 Follow-ups',
    '🔁 Relances par défaut':
        '🔁 Default follow-ups',
    '🔁 Relances — nombre maximal de rappels par contact':
        '🔁 Follow-ups — maximum number of callbacks per contact',
    "🔁 Relances — quand rappeler par défaut (chaque\n    campagne peut l'ajuster)":
        '🔁 Follow-ups — when to call back by default (each\n    campaign can adjust it)',
    '🔁 relance':
        '🔁 follow-up',
    '🔁 relance programmée':
        '🔁 follow-up scheduled',
    '🔁 À recontacter':
        '🔁 To contact again',
    '🔁 à recontacter':
        '🔁 to contact again',
    '🔄 à reprogrammer':
        '🔄 to reschedule',
    "🔇 Ne veut plus qu'on lui\n  propose de créneau libéré — demandé au téléphone. Elle reste appelable pour\n  SES rendez-vous.":
        '🔇 No longer wants to be\n  offered a freed slot — asked on the phone. They can still be called about\n  THEIR appointments.',
    "🔇 ne veut plus qu'on lui propose de créneau libéré (elle reste appelable pour ses rendez-vous)":
        '🔇 no longer wants to be offered a freed slot (still callable about their appointments)',
    '🔔 Créer une campagne de rappel':
        '🔔 Create a reminder campaign',
    '🔔 Rappel de rendez-vous':
        '🔔 Appointment reminder',
    '🔔 Rappel souhaité :':
        '🔔 Callback requested:',
    '🔔 Rappeler — monter la campagne\n    « Rappel de rendez-vous »':
        '🔔 Remind — set up the campaign\n    « Appointment reminder »',
    '🔔 rappel souhaité :':
        '🔔 reminder wanted:',
    '🔗 Campagne préparée automatiquement (décalage en cascade) : son créneau est la place du':
        '🔗 Campaign prepared automatically (cascade move): its slot is the slot of',
    '🕑 préférence à confirmer':
        '🕑 preference to confirm',
    '🕓 Relances à venir':
        '🕓 Upcoming follow-ups',
    '🕓 Relances à venir (':
        '🕓 Upcoming follow-ups (',
    '🕓 Relances à venir (0)':
        '🕓 Upcoming follow-ups (0)',
    '🗂 2 rendez-vous ne sont':
        '🗂 2 appointments are',
    '🗂 Tous les rendez-vous':
        '🗂 All appointments',
    '🗂 Tous les rendez-vous, quel que soit leur état':
        '🗂 All appointments, whatever their status',
    '🗓 Agenda':
        '🗓 Calendar',
    "🗓 Horaires d'ouverture":
        '🗓 Opening hours',
    "🗓 Horaires d'ouverture — la semaine type":
        '🗓 Opening hours — the typical week',
    '🗓 Prise de rendez-vous':
        '🗓 Appointment booking',
    '🗓 demande de rendez-vous':
        '🗓 appointment request',
    '🗓 demande de rendez-vous — à venir':
        '🗓 appointment request — coming soon',
    '🗣 Discours de l&#x27;agent':
        '🗣 Agent&#x27;s speech',
    "🗣 Discours de l'agent":
        "🗣 Agent's speech",
    '🙋 0 pour un humain':
        '🙋 0 for a human',
    "🙋 L'appel a eu lieu — RingBack n'a pas su lire la réponse":
        '🙋 The call took place — RingBack could not read the answer',
    '🙋 Rappels par un humain':
        '🙋 Callbacks by a human',
    '🙋 Rappels par un humain (':
        '🙋 Callbacks by a human (',
    '🙋 Rappels par un humain (0)':
        '🙋 Callbacks by a human (0)',
    "🙋 aucune campagne ne traite cela : c'est du travail humain":
        '🙋 no campaign handles this: it is human work',
    '🙋 À rappeler par un humain':
        '🙋 To be called back by a human',
    '🙋 à rappeler par un humain':
        '🙋 to be called back by a human',
    '🚀 Installeur — la configuration guidée':
        '🚀 Installer — guided setup',
    '🚫 0 ne plus appeler':
        '🚫 0 do not call',
    '🚫 A demandé à ne plus être appelée par un agent — aucun appel automatique ne partira. À rappeler par un humain.':
        '🚫 Asked not to be called by an agent any more — no automatic call will go out. To be called back by a human.',
    '🚫 A demandé à ne plus être appelée — sa fiche est marquée « ne plus appeler », aucun appel ne partira plus pour elle':
        '🚫 Asked not to be called any more — their record is marked « do not call again », no call will go out for them any more',
    "🚫 a refusé l'agent":
        '🚫 refused the agent',
    '🚫 contact par\n        agent interdit':
        '🚫 agent contact\n        forbidden',
    '🚫 contact par agent interdit':
        '🚫 agent contact not allowed',
    '🚫 exclu de tout appel':
        '🚫 excluded from all calls',
    '🚫 ne plus appeler':
        '🚫 do not call again',
    '🚫 « Ne plus appeler »':
        '🚫 « Do not call again »',
    '🚫 « ne plus appeler » écarté(s)':
        '🚫 « do not call again » set aside',
    '🟩 Créneau libre':
        '🟩 Free slot',
    "🧪 Campagne d'ESSAI EN CONDITIONS RÉELLES préparée, à l'état « prête » :":
        '🧪 REAL-CONDITIONS TEST campaign prepared, in status « ready »:',
    '🧪 Chargé —':
        '🧪 Loaded —',
    '🧪 Essai en conditions réelles — la campagne':
        '🧪 Real-conditions test — the campaign',
    '🧪 Essais':
        '🧪 Tests',
    "🧪 Jeu d'essai":
        '🧪 Test data',
    "🧪 Numéro d'essai :":
        '🧪 Test number:',
    "🧪 RENVOI D'ESSAI ACTIF : tous les appels iront vers":
        '🧪 TEST REDIRECT ACTIVE: all calls will go to',
    "🧪 Testeurs de l'essai réel":
        '🧪 Real call testers',
}

# ---------------------------------------------------------------------------
# Les RÈGLES — pour tout ce qui porte une date, une heure ou un nombre
# ---------------------------------------------------------------------------
#
# ⚠ POURQUOI DES RÈGLES ET PAS DES PHRASES. Mesuré le 01/09/2026 : sur les
# 1 527 phrases traduites de la première passe, 804 — plus de la moitié —
# portaient une date ou une heure de la semaine en cours, du genre
# « dimanche 06/09 10h00 — hors horaires d'ouverture ». Écrites en toutes
# lettres, elles auraient cessé de correspondre DÈS LE LENDEMAIN, et la
# traduction se serait effritée d'elle-même, sans que rien ne le signale.
#
# Les deux premières règles ci-dessous remplacent à elles seules 728 de ces
# entrées, et elles tiendront tant que la grille des horaires existera.
#
# Chaque règle est un couple (motif, fabrique). La fabrique reçoit le résultat
# de la recherche et le dictionnaire — elle peut donc traduire les mots autour
# de la donnée sans jamais toucher à la donnée elle-même. Elle rend None quand
# elle ne sait pas conclure : la phrase reste alors en français, ce qui est
# toujours préférable à une phrase à moitié juste.

_JOURS_FR_VERS_EN = dict(zip(themes.JOURS, themes.JOURS_EN))


def _jour_traduit(nom):
    """« dimanche » -> « Sunday ». None si ce n'est pas un jour connu."""
    return _JOURS_FR_VERS_EN.get(nom.lower())


def _fin_traduite(reste, table):
    """La fin de phrase, par le dictionnaire. None si elle est inconnue.

    ⚠ LE MÊME TEXTE S'ÉCRIT DE DEUX FAÇONS SELON L'ENDROIT. Dans un attribut
    `title`, le produit échappe l'apostrophe : « hors horaires
    d&#x27;ouverture ». Dans le corps de la page, il l'écrit telle quelle. Le
    dictionnaire ne connaît qu'une des deux formes — celle qui a été récoltée.
    On essaie donc les deux, et l'on rend le résultat dans l'écriture d'où
    l'on vient : reposer une apostrophe nue dans un attribut casserait la
    balise.
    """
    brut = reste.strip()
    traduit = table.get(brut)
    if traduit is not None:
        return traduit
    nu = html.unescape(brut)
    if nu == brut:
        return None
    traduit = table.get(nu)
    if traduit is None:
        return None
    return traduit.replace("&", "&amp;").replace("'", "&#x27;")


# « dimanche 06/09 10h00 — hors horaires d'ouverture » (grille des rendez-vous)
# « dimanche 10h00 — fermé »                          (grille des horaires)
# ⚠ LES NOMBRES SONT BORNES, ET CE N'EST PAS DU ZELE. Une regle qui accepte
# « 32/13/2026 99h99 » accepte aussi, un jour, le texte qu'un utilisateur aura
# tape dans un motif de rendez-vous — et le traduira. Une regle ne doit se
# reconnaitre que dans ce que le produit ECRIT vraiment.
_JOUR_DU_MOIS = r"(?:0?[1-9]|[12]\d|3[01])"
_MOIS_DU_AN = r"(?:0?[1-9]|1[0-2])"
_GRILLE = re.compile(
    r"^(" + "|".join(themes.JOURS) + r")"
    r"(?:\s+(" + _JOUR_DU_MOIS + r"/" + _MOIS_DU_AN + r"(?:/\d{2,4})?))?"
    r"\s+([01]?\d|2[0-3])h([0-5]\d)\s+\u2014\s+(.+)$",
    re.IGNORECASE | re.DOTALL)


def _grille(trouve, table):
    jour = _jour_traduit(trouve.group(1))
    fin = _fin_traduite(trouve.group(5), table)
    if jour is None or fin is None:
        return None
    date = f" {trouve.group(2)}" if trouve.group(2) else ""
    return (f"{jour}{date} {int(trouve.group(3)):02d}:{trouve.group(4)}"
            f" \u2014 {fin}")


# « semaine 12 — du 16/03 au 22/03 »
_SEMAINE_N = re.compile(
    r"^semaine (\d{1,2}) \u2014 du (\S+) au (\S+)$", re.IGNORECASE)


def _semaine_n(trouve, _table):
    return (f"week {trouve.group(1)} \u2014 {trouve.group(2)} to "
            f"{trouve.group(3)}")


# « Semaine du 31/08/2026 au 06/09/2026\n— 3 rendez-vous »
_SEMAINE_DU = re.compile(
    r"^Semaine du (\S+) au (\S+)(\s*)\u2014 (\d+) rendez-vous$",
    re.IGNORECASE)


def _semaine_du(trouve, _table):
    nombre = int(trouve.group(4))
    mot = "appointment" if nombre == 1 else "appointments"
    return (f"Week of {trouve.group(1)} to {trouve.group(2)}"
            f"{trouve.group(3)}\u2014 {nombre} {mot}")


# « Horaire : 30/08/2026 à 09h15 »
_HORAIRE = re.compile(r"^Horaire : (\S+) \u00e0 (\d{1,2})h(\d{2})$")


def _horaire(trouve, _table):
    return (f"Time: {trouve.group(1)} at {int(trouve.group(2)):02d}:"
            f"{trouve.group(3)}")


# « Choisir toute la journée du 01/09, de 07h00 à 19h45 »
_JOURNEE = re.compile(
    r"^Choisir toute la journ\u00e9e du (\S+?),? de (\d{1,2})h(\d{2}) "
    r"\u00e0 (\d{1,2})h(\d{2})$")


def _journee(trouve, _table):
    return (f"Select the whole day of {trouve.group(1)}, from "
            f"{int(trouve.group(2)):02d}:{trouve.group(3)} to "
            f"{int(trouve.group(4)):02d}:{trouve.group(5)}")


# Le pied de page porte la date du code : « … · code du 01/09 19h05 ».
# ⚠ ELLE CHANGE À CHAQUE VERSION : sans cette règle, le pied redeviendrait
# français au premier changement de code, sur TOUTES les pages à la fois.
_PIED = re.compile(r"^(.*?) \u00b7 code du (.+)$", re.DOTALL)


def _pied(trouve, table):
    debut = table.get(trouve.group(1).strip())
    if debut is None:
        return None
    return f"{debut} \u00b7 code from {trouve.group(2)}"


# « dimanche 01/11/2026 » : un jour de la liste des jours fermés. Pas d'heure,
# donc la règle de la grille ne s'applique pas — et sans celle-ci, la liste
# des jours fériés resterait en français au milieu d'un écran anglais.
_JOUR_ET_DATE = re.compile(
    r"^(" + "|".join(themes.JOURS) + r")\s+("
    + _JOUR_DU_MOIS + r"/" + _MOIS_DU_AN + r"(?:/\d{2,4})?)$",
    re.IGNORECASE)


def _jour_et_date(trouve, _table):
    jour = _jour_traduit(trouve.group(1))
    return None if jour is None else f"{jour} {trouve.group(2)}"


# ---------------------------------------------------------------------------
# Les phrases des ECRANS DE CAMPAGNE — vues seulement en PEUPLANT le produit
# ---------------------------------------------------------------------------
#
# ⚠ ELLES N'EXISTAIENT DANS AUCUNE MESURE jusqu'au 03/09/2026, parce qu'aucune
# mesure n'avait créé de campagne. Une base sans campagne n'a ni titre de
# section, ni bouton « Effacer la liste », ni nom de campagne, ni ligne de
# récapitulatif. C'est l'utilisateur qui les a vues, du premier coup, en se
# servant du produit — et c'est `outils/francais_restant.py`, une fois qu'il
# peuple, qui les a toutes sorties.

# --- LA RÈGLE GÉNÉRALE : « Libellé : valeur » -----------------------------
#
# ⚠ UNE RÈGLE PLUTÔT QUE TRENTE ENTRÉES. Le récapitulatif d'une campagne est
# fait de lignes « Politique d'appel : appeler toute la liste », « Ordre
# d'appel : Ordre de la liste »… Le libellé et la valeur sont DÉJÀ traduits
# chacun de son côté ; c'est leur assemblage qui n'a pas d'entrée.
#
# ⚠ ET ELLE NE REND RIEN SI L'UNE DES DEUX MOITIÉS EST INCONNUE. C'est ce qui
# la rend sûre : une donnée de l'utilisateur qui contiendrait « : » ne peut
# pas être à moitié traduite, puisqu'elle n'est pas au dictionnaire.
_LIBELLE_VALEUR = re.compile(r"^([^:\n]{3,70}) : (.+)$", re.DOTALL)


def _libelle_valeur(trouve, table):
    libelle = table.get(trouve.group(1).strip())
    valeur = table.get(trouve.group(2).strip())
    if libelle is None or valeur is None:
        return None
    return f"{libelle}: {valeur}"


# --- LES NOMS DE CAMPAGNE, engendrés par le produit ------------------------
#
# ⚠ CE SONT DES DONNÉES, ET POURTANT ELLES SE TRADUISENT. Le nom est écrit en
# base — mais c'est LE PRODUIT qui l'a écrit, pas l'utilisateur. Le traduire à
# l'affichage ne touche pas la base : c'est la même règle que pour les états
# (« prévu », « à appeler »), stockés en français et montrés en anglais.
_NOM_DATE = r"(\d{1,2}/\d{1,2}(?:/\d{2,4})?)"
_NOM_CONFIRMATION = re.compile(
    r"^Confirmation de rendez-vous du " + _NOM_DATE +
    r" \((\d+) contact\(s\)\) — " + _NOM_DATE + r"(.*)$")
_NOM_JOURNEES = re.compile(
    r"^(Rappel de rendez-vous|Prise de rendez-vous|Déplacement de rendez-vous)"
    r" de (\d+) journées, dès le " + _NOM_DATE +
    r" \((\d+) contact\(s\)\) — " + _NOM_DATE + r"(.*)$")
_NOM_CRENEAU = re.compile(
    r"^Créneau libéré du " + _NOM_DATE + r" (\S+) — " + _NOM_DATE + r"(.*)$")

_NATURE_EN = {
    "Rappel de rendez-vous": "Appointment reminder",
    "Prise de rendez-vous": "Appointment booking",
    "Déplacement de rendez-vous": "Appointment rescheduling",
}


def _nom_confirmation(trouve, _table):
    return (f"Appointment confirmation for {trouve.group(1)} "
            f"({trouve.group(2)} contact(s)) — {trouve.group(3)}"
            f"{trouve.group(4)}")


def _nom_journees(trouve, _table):
    jours = int(trouve.group(2))
    return (f"{_NATURE_EN[trouve.group(1)]} over {jours} "
            f"{'day' if jours == 1 else 'days'}, from {trouve.group(3)} "
            f"({trouve.group(4)} contact(s)) — {trouve.group(5)}"
            f"{trouve.group(6)}")


def _nom_creneau(trouve, _table):
    return (f"Slot freed up on {trouve.group(1)} {trouve.group(2)} — "
            f"{trouve.group(3)}{trouve.group(4)}")


# --- LES COMPTES DES ÉCRANS DE CAMPAGNE ------------------------------------
_PRETES_N = re.compile(
    r"^Prêtes — personne n(?:&#x27;|')est appelé avant ▶ Démarrer \((\d+)\)$")
_SECTION_N = re.compile(r"^(En cours|Terminées|Prêtes|Brouillons) \((\d+)\)$")
_N_CAMPAGNES = re.compile(r"^(\d+) campagne\(s\)$")
_EFFACER_N = re.compile(r"^Effacer ces (\d+) campagne\(s\)$")
_N_PERSONNES_LISTES = re.compile(
    r"^(\d+) personne\(s\) dans leurs listes$")
_N_APPELS_ENREGISTRES = re.compile(
    r"^(\d+) appel\(s\) enregistré\(s\), avec leurs transcriptions$")
_N_RELANCES_DONT = re.compile(r"^(\d+) relance\(s\), dont$")
_N_JOURS_OUVRES = re.compile(r"^(\d+) jours ouvrés$")
_EFFACER_GROUPE = re.compile(r"^Effacer « (.+) »$", re.DOTALL)
_NOUVEAU_CRENEAU = re.compile(
    r"^Nouveau créneau — seuls\n(\s+)ceux où (\d+) tranche[s]? de 15 min "
    r"\(([^)]+)\) tiennent\n(\s+)d'affilée sont proposés$")
_HORS_PLAGE = re.compile(
    r"^Hors de cette plage \(entre ([^)]+)\),\n(\s+)tout lancement d'appel "
    r"est refusé — politesse d'abord\.$")
_FICHE_CAMPAGNE = re.compile(
    r"^— (.+?) — entré pour : (.+?) — état dans la campagne : (.+)$",
    re.DOTALL)
_PRIS_EN_CHARGE = re.compile(
    r"^le prévenir, ou obtenir un oui ferme — pris en charge par : (.+)$",
    re.DOTALL)
_CRENEAU_DATE_HEURE = re.compile(
    r"^Créneau libéré \(date et heure\) : (.+)$")


def _prise_en_charge(trouve, table):
    """« ... — pris en charge par : <nom de campagne> ».

    Le nom de campagne vient lui-meme d'une regle : on les essaie ici, sinon
    la phrase resterait francaise a cause de sa fin.
    """
    nom = trouve.group(1).strip()
    rendu = table.get(nom)
    if rendu is None:
        for motif, fabrique in ((_NOM_CONFIRMATION, _nom_confirmation),
                                (_NOM_JOURNEES, _nom_journees),
                                (_NOM_CRENEAU, _nom_creneau)):
            vu = motif.match(nom)
            if vu:
                rendu = fabrique(vu, table)
                break
    return None if rendu is None else (
        f"warn them, or get a firm yes — handled by: {rendu}")


def _fiche_campagne(trouve, table):
    nature = table.get(trouve.group(1).strip())
    entre = table.get(trouve.group(2).strip())
    etat = table.get(trouve.group(3).strip())
    if None in (nature, entre, etat):
        return None
    return (f"— {nature} — entered for: {entre} — status in the campaign: "
            f"{etat}")


def _effacer_groupe(trouve, table):
    dedans = table.get(trouve.group(1).strip())
    return None if dedans is None else f"Clear « {dedans} »"


# ---------------------------------------------------------------------------
# Les MESSAGES D'OUVERTURE, une fois leurs marques remplacées
# ---------------------------------------------------------------------------
#
# ⚠ LE DICTIONNAIRE LES CONNAÎT, ET POURTANT ILS RESTAIENT FRANÇAIS. Il connaît
# le gabarit BRUT — « ... de la part de [entreprise] ... » — mais l'écran, lui,
# montre le gabarit REMPLI : le nom du cabinet à la place de [entreprise], la
# liste des créneaux à la place de [créneaux_disponibles]. Deux textes
# différents ; le second n'a aucune entrée, et n'en aura jamais, puisqu'il
# change avec les données.
#
# ⚠ ET LA RÈGLE NE TIENT PAS UNE SECONDE TRADUCTION : elle relit l'entrée du
# gabarit au dictionnaire et y replante les valeurs vues. Une correction de la
# phrase anglaise se fait donc à UN seul endroit. Si l'entrée manque, la règle
# ne rend rien plutôt que d'inventer.
_APOSTROPHE = r"(?:&(?:amp;)?#x27;|\')"
_MARQUE = re.compile(r"\[[a-zé_]+\]")


def _motif_de_gabarit(gabarit):
    """Le gabarit français, avec un trou à la place de chacune de ses marques.

    Le trou accepte AUSSI la marque elle-même : selon l'écran, elle est tantôt
    remplacée, tantôt montrée telle quelle. Un seul motif couvre les deux.
    """
    morceaux, noms, fin = [], [], 0
    for vu in _MARQUE.finditer(gabarit):
        morceaux.append(re.escape(gabarit[fin:vu.start()]))
        morceaux.append(f"(?P<t{len(noms)}>.+?)")
        noms.append(vu.group(0))
        fin = vu.end()
    morceaux.append(re.escape(gabarit[fin:]))
    brut = "".join(morceaux).replace("'", _APOSTROPHE)
    return re.compile("^" + brut + "$", re.DOTALL), tuple(noms)


def _remplir(modele, valeurs):
    """Le modèle anglais, avec les valeurs vues remises à LEURS marques.

    ⚠ PAR LE NOM, JAMAIS PAR LE RANG : l'anglais réordonne. « nos
    disponibilités sont [créneaux_disponibles] » peut fort bien devenir « we
    have [créneaux_disponibles] free », et un remplissage par rang mettrait
    alors le nom du cabinet dans la liste des créneaux.
    """
    morceaux, fin = [], 0
    for vu in _MARQUE.finditer(modele):
        if vu.group(0) not in valeurs:
            return None
        morceaux.append(modele[fin:vu.start()])
        morceaux.append(valeurs[vu.group(0)])
        fin = vu.end()
    morceaux.append(modele[fin:])
    return "".join(morceaux)


def _gabarit_rempli(trouve, table, cle, noms):
    modele = table.get(cle)
    if modele is None:
        return None
    return _remplir(modele, {nom: trouve.group(f"t{rang}")
                             for rang, nom in enumerate(noms)})


def _regles_des_gabarits():
    regles = []
    for gabarit in themes.GABARITS.values():
        cle = html.escape(gabarit, quote=True)
        motif, noms = _motif_de_gabarit(gabarit)
        regles.append((motif, functools.partial(_gabarit_rempli, cle=cle,
                                                noms=noms)))
    return tuple(regles)


MOTIFS_GABARITS = _regles_des_gabarits()


# --- L'AVERTISSEMENT DE CLÉ, qui porte la taille de la clé mise de côté ----
#
# ⚠ UNE RÈGLE, PARCE QU'ELLE PORTE UN NOMBRE. « (41 caractère(s)) » change avec
# la clé : écrite en toutes lettres, l'entrée serait juste pour une clé et
# morte pour la suivante.
_CLE_IGNOREE = re.compile(
    r"^Une AUTRE clé est posée dans la variable d(?:&#x27;|')environnement "
    r"CALLE_API_KEY, et elle gagne contre le fichier\. Celle que vous avez "
    r"enregistrée \((\d+) caractère\(s\)\) est mise de côté\. "
    r"Pour qu(?:&#x27;|')elle serve : fermez RingBack, retirez la variable$")

MOTIFS_CLE = (
    (_CLE_IGNOREE, lambda t, _:
     f"Another key is set in the CALLE_API_KEY environment variable, and it "
     f"wins over the file. The one you saved here ({t.group(1)} characters) "
     f"is set aside. For it to be used: close RingBack, remove the variable"),
)


# --- LES HUIT DERNIERES, chacune assemblee a sa facon ----------------------
_LISTE_PERSONNES = re.compile(
    r"^Liste des personnes : depuis la base — « (.+?) » — "
    r"(rejouable|non rejouable) sur un autre créneau$", re.DOTALL)
_PLAGE_PERIODE = re.compile(
    r"^Plage d'appel : (.+?) · période interdite : (.+)$", re.DOTALL)
_CASCADE_VALEUR = re.compile(r"^Décaler en cascade : (.+)$", re.DOTALL)
_EFFACER_PRETES = re.compile(
    r"^Effacer « Prêtes — personne n(?:&amp;#x27;|&#x27;|')est appelé avant "
    r"▶ Démarrer »$")
_ICS_NOMS = re.compile(
    r"^\(ils\narriveront « à compléter »\), et (\d+) portent le nom de "
    r"contacts du jeu\nd'essai — s'il est chargé, ils seront reconnus et rien "
    r"ne sera dupliqué\.$")


def _liste_personnes(trouve, table):
    """« Liste des personnes : depuis la base — « X » — rejouable… »

    ⚠ TROIS MORCEAUX, TROIS ORIGINES : le libellé, le nom de la source (une
    entrée du dictionnaire), et la mention de rejouabilité. La règle générale
    « Libellé : valeur » ne suffit pas — la valeur est elle-même assemblée.
    """
    source = table.get(trouve.group(1).strip())
    if source is None:
        return None
    rejouable = ("replayable" if trouve.group(2) == "rejouable"
                 else "not replayable")
    return (f"List of people: from the database — « {source} » — "
            f"{rejouable} on another slot")


def _plage_periode(trouve, table):
    plage = table.get(trouve.group(1).strip()) or trouve.group(1).strip()
    interdite = table.get(trouve.group(2).strip())
    if interdite is None:
        return None
    return f"Calling window: {plage} · forbidden period: {interdite}"


def _cascade_valeur(trouve, table):
    valeur = table.get(trouve.group(1).strip())
    return None if valeur is None else f"Shift in cascade: {valeur}"


MOTIFS_DERNIERS = (
    (_LISTE_PERSONNES, _liste_personnes),
    (_PLAGE_PERIODE, _plage_periode),
    (_CASCADE_VALEUR, _cascade_valeur),
    (_EFFACER_PRETES, lambda t, _:
     "Clear « Ready — nobody is called before ▶ Start »"),
    (_ICS_NOMS, lambda t, _:
     f"(they\nwill arrive « to complete »), and {t.group(1)} carry the name "
     f"of test-data\ncontacts — if it is loaded, they will be recognised and "
     f"nothing will be duplicated."),
)


MOTIFS_CAMPAGNE = (
    (_NOM_CONFIRMATION, _nom_confirmation),
    (_NOM_JOURNEES, _nom_journees),
    (_NOM_CRENEAU, _nom_creneau),
    (_PRETES_N, lambda t, _:
     f"Ready — nobody is called before ▶ Start ({t.group(1)})"),
    (_SECTION_N, lambda t, table:
     (lambda tete: None if tete is None else f"{tete} ({t.group(2)})")(
         table.get(t.group(1)))),
    (_N_CAMPAGNES, lambda t, _: f"{t.group(1)} campaign(s)"),
    (_EFFACER_N, lambda t, _: f"Clear these {t.group(1)} campaign(s)"),
    (_N_PERSONNES_LISTES, lambda t, _:
     f"{t.group(1)} contact(s) in their lists"),
    (_N_APPELS_ENREGISTRES, lambda t, _:
     f"{t.group(1)} recorded call(s), with their transcripts"),
    (_N_RELANCES_DONT, lambda t, _: f"{t.group(1)} follow-up(s), of which"),
    (_N_JOURS_OUVRES, lambda t, _: f"{t.group(1)} working days"),
    (_EFFACER_GROUPE, _effacer_groupe),
    (_NOUVEAU_CRENEAU, lambda t, _:
     f"New slot — only those where {t.group(2)} 15-min "
     f"{'slice' if t.group(2) == '1' else 'slices'} ({t.group(3)}) fit\n"
     f"{t.group(4)}in a row are offered"),
    (_HORS_PLAGE, lambda t, _:
     f"Outside this window ({t.group(1)}),\n{t.group(2)}every call launch is "
     f"refused — courtesy first."),
    (_FICHE_CAMPAGNE, _fiche_campagne),
    (_PRIS_EN_CHARGE, _prise_en_charge),
    (_CRENEAU_DATE_HEURE, lambda t, _:
     f"Freed slot (date and time): {t.group(1)}"),
    (_LIBELLE_VALEUR, _libelle_valeur),
)


# ---------------------------------------------------------------------------
# Les phrases ASSEMBLEES — celles qui portent un nombre
# ---------------------------------------------------------------------------
#
# ⚠ ON NE LES VOIT QU'EN RENDANT LES PAGES. Une phrase collée en Python —
# « Ses rendez-vous (3) » — est UN SEUL nœud de page. Ni la lecture des
# sources ni l'exploration d'une base vide ne la montrent : la première ne
# voit que les morceaux, la seconde n'a rien à compter. C'est
# `outils/francais_restant.py` qui les a sorties, toutes les 255 d'un coup.

def _n(trouve, rang=1):
    return int(trouve.group(rang))


def _pluriel(combien, singulier, pluriel):
    return singulier if combien == 1 else pluriel


_RDV_TITRE = re.compile(r"^Rendez-vous n°(\d+)$")
_RDV_TITRE_PAGE = re.compile(r"^Rendez-vous n°(\d+) — RingBack$")
_SES_RDV = re.compile(r"^Ses rendez-vous \((\d+)\)$")
_TOUS_RDV = re.compile(r"^Tous les rendez-vous \((\d+)\)$")
_N_RDV = re.compile(r"^(\d+) rendez-vous$")
_N_JOURS = re.compile(r"^(\d+) jours d'ici$")
_SANS_NUMERO = re.compile(r"^☎ (\d+) sans numéro$")
_SUR_TOTAL = re.compile(r"^contact\(s\) sur (\d+) — aucun filtre\.$")
_JEU_CHARGE = re.compile(
    r"^🧪 Chargé — (\d+) contact\(s\) d'essai dans votre base, marqués 🧪\.$")
_IMPORTES = re.compile(
    r"^✎ (\d+) rendez-vous importé\(s\) sans numéro — à compléter$")
_CLASSEUR = re.compile(r"^🗂 (\d+) rendez-vous ne sont$")
_ALLER_DATE = re.compile(
    r"^Aller à une date \(AAAA-MM-JJ, par exemple (\d{4}-\d{2}-\d{2})\)$")
_ANNULER_LIBERER = re.compile(
    r"^Annuler ce rendez-vous — libérer(\s+)(\d+) tranches de 15 min "
    r"\(([^)]+)\)$")
_DEPLACEMENT_IMPOSSIBLE = re.compile(
    r"^Déplacement impossible pour l'instant : ce rendez-vous occupe (\d+) "
    r"tranches de 15 min \(([^)]+)\) consécutives, et aucune suite de "
    r"tranches libres aussi longue n'existe dans les (\d+) prochains jours\. "
    r"Ouvrez des heures ou libérez des rendez-vous dans$")
_AGENDA = re.compile(r"^Agenda : (.*)$", re.DOTALL)
_PREVENIR = re.compile(r"^le prévenir, ou obtenir un oui ferme — (.*)$",
                       re.DOTALL)
_JEU_AJOUTE = re.compile(
    r"^Il ajoute des\ncontacts et des rendez-vous d'un (.+?) fictif :\n"
    r"(.*)$", re.DOTALL)
_MELE = re.compile(
    r"^Il mêle les trois cas qu'un vrai agenda contient : (\d+) rendez-vous "
    r"portent\nun$")
_NUMERO_ESSAI = re.compile(
    r"^Mon numéro d'essai — un numéro français \(10 chiffres commençant\n"
    r"\s+par 0, comme ([^)]+)\) ou un numéro international avec son "
    r"indicatif\n\s+\(([^)]+)\) — (.*)$", re.DOTALL)

MOTIFS_ASSEMBLES = (
    (_RDV_TITRE_PAGE, lambda t, _: f"Appointment #{_n(t)} — RingBack"),
    (_RDV_TITRE, lambda t, _: f"Appointment #{_n(t)}"),
    (_SES_RDV, lambda t, _: f"Their appointments ({_n(t)})"),
    (_TOUS_RDV, lambda t, _: f"All appointments ({_n(t)})"),
    (_N_RDV, lambda t, _: f"{_n(t)} "
     + _pluriel(_n(t), "appointment", "appointments")),
    (_N_JOURS, lambda t, _: f"{_n(t)} days from now"),
    (_SANS_NUMERO, lambda t, _: f"☎ {_n(t)} without a number"),
    (_SUR_TOTAL, lambda t, _: f"contact(s) out of {_n(t)} — no filter."),
    (_JEU_CHARGE, lambda t, _:
     f"🧪 Loaded — {_n(t)} test contact(s) in your database, flagged 🧪."),
    (_IMPORTES, lambda t, _:
     f"✎ {_n(t)} imported appointment(s) with no number — to complete"),
    (_CLASSEUR, lambda t, _: f"🗂 {_n(t)} appointments are not"),
    (_ALLER_DATE, lambda t, _:
     f"Go to a date (YYYY-MM-DD, for example {t.group(1)})"),
    (_ANNULER_LIBERER, lambda t, _:
     f"Cancel this appointment — free up{t.group(1)}{t.group(2)} "
     f"15-min slices ({t.group(3)})"),
    (_DEPLACEMENT_IMPOSSIBLE, lambda t, _:
     f"Cannot be moved for now: this appointment takes {t.group(1)} "
     f"consecutive 15-min slices ({t.group(2)}), and no run of free slices "
     f"that long exists in the next {t.group(3)} days. Open up hours or free "
     f"appointments in"),
    (_MELE, lambda t, _:
     f"It mixes the three cases a real diary holds: {_n(t)} appointments "
     f"carry\na"),
)


def _agenda(trouve, table):
    """« Agenda : <état> » — l'état est traduit à part, le libellé ici."""
    fin = table.get(trouve.group(1).strip())
    return None if fin is None else f"Diary: {fin}"


def _prevenir(trouve, table):
    fin = table.get(trouve.group(1).strip())
    return None if fin is None else (
        f"warn them, or get a firm yes — {fin}")


def _jeu_ajoute(trouve, _table):
    """La phrase du jeu d'essai — le nom du métier passe, le reste est rendu.

    ⚠ ELLE ALLAIT CHERCHER SA FIN DANS LA TABLE, ET NE LA TROUVAIT PAS. La
    fin existe bien au dictionnaire, mais sous une AUTRE découpe : la phrase
    est écrite d'un bloc dans le code, coupée seulement par le nom du métier,
    et la clé récoltée ne correspondait donc pas exactement à ce que la règle
    capturait. Une règle qui dépend d'une entrée dépend de deux découpages qui
    s'accordent — ici ils ne s'accordaient pas. Elle rend donc la phrase
    entière elle-même.
    """
    return (f"It adds\ncontacts and appointments from a fictional "
            f"{trouve.group(1)}:\npast and upcoming appointments, missed "
            f"ones, cancelled ones, moved ones,\n🚫 « do not call again » "
            f"contacts and contacts with no number. Enough to see\nevery "
            f"situation work without waiting for it to happen to you.")


def _numero_essai(trouve, table):
    fin = table.get(trouve.group(3).strip())
    if fin is None:
        return None
    return (f"My test number — a French number (10 digits starting\n"
            f"    with 0, such as {trouve.group(1)}) or an international "
            f"number with its dialling code\n    ({trouve.group(2)}) — {fin}")


MOTIFS_ASSEMBLES = MOTIFS_ASSEMBLES + (
    (_AGENDA, _agenda),
    (_PREVENIR, _prevenir),
    (_JEU_AJOUTE, _jeu_ajoute),
    (_NUMERO_ESSAI, _numero_essai),
)


# ⚠ UNE PHRASE ASSEMBLÉE EN PYTHON RESTE UNE SEULE PHRASE À L'ÉCRAN.
# `assistant.py` écrit « N personne(s) écartée(s) : cette place ne leur » puis
# lui colle « ferait pas gagner G jours ». Les deux moitiés sont devenues deux
# entrées du dictionnaire — et AUCUNE ne correspond, puisque le nœud de page
# porte la phrase ENTIÈRE. Résultat : elle restait en français au milieu d'un
# écran anglais. Une règle sur la phrase complète les remplace toutes les deux.
_ECARTES_GAIN = re.compile(
    r"^(\d+) personne\(s\) écartée\(s\) : cette place ne leur ferait pas "
    r"gagner (\d+) jours$")
_ECARTES_RIEN = re.compile(
    r"^(\d+) personne\(s\) écartée\(s\) : cette place ne leur ferait rien "
    r"gagner — leur rendez-vous n'est pas après elle$")


def _ecartes_gain(trouve, _table):
    combien, jours = int(trouve.group(1)), int(trouve.group(2))
    return (f"{combien} {'contact' if combien == 1 else 'contacts'} set "
            f"aside: this slot would not gain them {jours} days")


def _ecartes_rien(trouve, _table):
    combien = int(trouve.group(1))
    return (f"{combien} {'contact' if combien == 1 else 'contacts'} set "
            f"aside: this slot would gain them nothing — their appointment "
            f"is not after it")


# Le bouton d'exécution de la file : la phrase entière, le nombre laissé
# passer. Deux règles parce que le produit écrit deux phrases — c'est ce qui
# permet à chacune d'avoir sa grammaire anglaise.
_FILE_REELLE = re.compile(
    r"^Exécuter la file — passer RÉELLEMENT les (\d+) appel\(s\)$")
_FILE_SIMULEE = re.compile(
    r"^Exécuter la file — passer en simulation les (\d+) appel\(s\)$")


def _file_reelle(trouve, _table):
    combien = int(trouve.group(1))
    return (f"Run the queue — REALLY place the {combien} "
            f"{'call' if combien == 1 else 'calls'}")


def _file_simulee(trouve, _table):
    combien = int(trouve.group(1))
    return (f"Run the queue — place the {combien} "
            f"{'call' if combien == 1 else 'calls'} in simulation")


MOTIFS_EN = MOTIFS_CLE + MOTIFS_GABARITS + MOTIFS_DERNIERS + MOTIFS_CAMPAGNE + MOTIFS_ASSEMBLES + (
    (_ECARTES_GAIN, _ecartes_gain),
    (_ECARTES_RIEN, _ecartes_rien),
    (_FILE_REELLE, _file_reelle),
    (_FILE_SIMULEE, _file_simulee),
    (_JOUR_ET_DATE, _jour_et_date),
    (_GRILLE, _grille),
    (_SEMAINE_N, _semaine_n),
    (_SEMAINE_DU, _semaine_du),
    (_HORAIRE, _horaire),
    (_JOURNEE, _journee),
    (_PIED, _pied),
)

MOTIFS = {
    "en": MOTIFS_EN,
}


def motifs(langue):
    """Les règles de cette langue, ou aucune."""
    return MOTIFS.get(langue) or ()


# ---------------------------------------------------------------------------
# La CONSIGNE téléphonique — un dictionnaire à part, et pour une raison
# ---------------------------------------------------------------------------
#
# ⚠ CE N'EST PAS DU TEXTE D'ÉCRAN. Ces phrases sont DITES AU TÉLÉPHONE par une
# machine, à de vraies personnes, ou dictées à l'agent comme des ordres. Elles
# ne se relisent pas, ne se survolent pas, ne se corrigent pas d'un clic. Les
# mêler au dictionnaire des écrans ferait qu'une retouche d'interface pourrait
# changer, sans qu'on y pense, ce qu'un patient entend au bout du fil.
#
# Elles portent aussi des [crochets] que le produit remplit ensuite : un
# crochet traduit est un trou qui ne sera jamais rempli, et l'agent dirait
# « identite » à voix haute. Un essai tient cette règle sur le dictionnaire.
CONSIGNE_FR_VERS_EN = {
    ', en écrivant dans « new_datetime » la date convenue (format 2026-08-15T14:30) si une date précise a été convenue, et rien sinon':
        ', writing the agreed date in « new_datetime » (format 2026-08-15T14:30) if a precise date was agreed, and nothing otherwise',
    ', et écris dans « new_datetime » la date convenue au format 2026-08-15T14:30':
        ', and write the agreed date in « new_datetime » in the format 2026-08-15T14:30',
    '- {libelle} — {quand} : rends {champ} = « {code} »':
        '- {libelle} — {quand}: return {champ} = « {code} »',
    '1) TA PRÉSENTATION — dis-la telle quelle en ouvrant, mot pour mot :':
        '1) YOUR INTRODUCTION — say it exactly as written when you open the call, word for word:',
    '2) TON OBJECTIF ET TON CONTEXTE — ensuite, tu discutes librement, en français.':
        '2) YOUR OBJECTIVE AND YOUR CONTEXT — then you talk freely, in English.',
    "3) LES ISSUES — tu dois conclure sur l'une de ces trois-là, et sur aucune autre :":
        '3) THE OUTCOMES — you must conclude on one of these three, and on no other:',
    'A-ZÀ-ÖØ-Þ':
        'A-ZÀ-ÖØ-Þ',
    'AUTRE':
        'OTHER',
    'Alors, puis-je noter que vous serez bien là ?':
        'So, can I put you down as coming?',
    "Bonjour [identite], je suis l'assistant de Cabinet Essai. En raison d'à préciser, nous devons déplacer votre rendez-vous du [rdv_existant] pour [motif]. Je peux vous proposer à préciser — est-ce que cela vous conviendrait ?":
        "Hello [identite], I'm the assistant from Cabinet Essai. Because of to be specified, we have to move your appointment on [rdv_existant] for [motif]. I can offer you to be specified — would that suit you?",
    "Bonjour [identite], je suis l'assistant de Cabinet Essai. Je vous appelle au sujet de votre rendez-vous du [rdv_existant] pour [motif] : merci de me confirmer votre présence. Cela se passe à à préciser. À noter : à préciser. Si vous ne pouvez plus venir, j'annule votre rendez-vous, et je ne vous propose pas d'autre date aujourd'hui : c'est vous qui nous rappelez quand vous voulez — nous ne vous relancerons pas. Puis-je compter sur votre présence, oui ou non ?":
        "Hello [identite], I'm the assistant from Cabinet Essai. I'm calling about your appointment on [rdv_existant] for [motif]: please confirm that you will be there. It takes place at to be specified. Please note: to be specified. If you can no longer come, I'll cancel your appointment, and I won't offer you another date today: it's up to you to call us back whenever you like — we won't follow up. Can I count on you being there, yes or no?",
    "Bonjour [identite], je suis l'assistant de Cabinet Essai. Je vous appelle pour vous rappeler votre rendez-vous du [rdv_existant] pour [motif]. Cela se passe à à préciser. Pensez-y : à préciser. Pensez à : [consigne]. Pour finir : souhaitez-vous maintenir ce rendez-vous, ou faut-il l'annuler ? Si vous l'annulez, je libère la place pour quelqu'un d'autre. Si vous ne pouvez plus venir, j'annule votre rendez-vous, et je ne vous propose pas d'autre date aujourd'hui : c'est vous qui nous rappelez quand vous voulez — nous ne vous relancerons pas. Alors, puis-je noter que vous serez bien là ?":
        "Hello [identite], I'm the assistant from Cabinet Essai. I'm calling to remind you of your appointment on [rdv_existant] for [motif]. It takes place at to be specified. Bear in mind: to be specified. Please remember: [consigne]. Lastly: would you like to keep this appointment, or should it be cancelled? If you cancel it, I'll free up the slot for someone else. If you can no longer come, I'll cancel your appointment, and I won't offer you another date today: it's up to you to call us back whenever you like — we won't follow up. So, may I make a note that you'll be there?",
    "Bonjour [identite], je suis l'assistant de Cabinet Essai. Une place s'est libérée le mardi 15 septembre 2026 à 9 heures 40 pour votre [motif]. La séance dure à préciser. Cela se passe à à préciser. À noter : à préciser. Souhaitez-vous en profiter pour avancer votre rendez-vous du [rdv_existant] ?":
        "Hello [identite], I'm the assistant from Cabinet Essai. A slot has become free on Tuesday 15 September 2026 at 9:40 am for your [motif]. The session lasts to be specified. It takes place at to be specified. Please note: to be specified. Would you like to take it and bring forward your appointment on [rdv_existant]?",
    "Bonjour [identite], je suis l'assistant de Cabinet Essai. à préciser — je vous appelle pour fixer ce rendez-vous. Le motif noté : [motif]. J'ai comme disponibilités : à préciser. Qu'est-ce qui vous arrange ? La séance dure à préciser. Cela se passe à à préciser.":
        "Hello [identite], I'm the assistant from Cabinet Essai. to be specified — I'm calling to set up this appointment. The reason on record: [motif]. Here is what I have available: to be specified. What suits you best? The session lasts to be specified. It takes place at to be specified.",
    "Bonjour [identite], je suis l'assistant de [entreprise].":
        'Hello [identite], I am the assistant at [entreprise].',
    "Bonjour [identite], je suis l'assistant de [entreprise]. Je vous appelle au sujet de votre rendez-vous du [rdv_existant] pour [motif] : merci de me confirmer votre présence.":
        "Hello [identite], I'm the assistant from [entreprise]. I'm calling about your appointment on [rdv_existant] for [motif]: please confirm that you will be there.",
    "Bonjour [identite], je suis l'assistant de [entreprise]. Je vous appelle pour vous rappeler votre rendez-vous du [rdv_existant] pour [motif].":
        "Hello [identite], I'm the assistant from [entreprise]. I'm calling to remind you of your appointment on [rdv_existant] for [motif].",
    "Bonjour [identite], je suis l'assistant de [entreprise]. Une place s'est libérée le [creneau_libere] pour votre [motif].":
        "Hello [identite], I'm the assistant from [entreprise]. A slot has become free on [creneau_libere] for your [motif].",
    "Bonjour [identite], je suis l'assistant de [entreprise]. [origine] — je vous appelle pour fixer ce rendez-vous.":
        "Hello [identite], I'm the assistant from [entreprise]. [origine] — I'm calling to set up this appointment.",
    'Ce que tu sais, et que tu peux redire ou reformuler :':
        'What you know, and may repeat or rephrase:',
    'Cela se passe à [lieu].':
        'It takes place at [lieu].',
    "Comment mener l'échange, dans cet ordre :":
        'How to run the conversation, in this order:',
    'Confirmation de rendez-vous':
        'Appointment confirmation',
    'Consigne générale (ex. « venir à jeun »)':
        'General briefing (e.g. « come on an empty stomach »)',
    'Consigne générale : [consignes].':
        'General instructions: [consignes].',
    'Consigne générale : à préciser.':
        'General briefing: to be specified.',
    'Consigne propre au contact':
        'Contact-specific briefing',
    'Consigne propre au contact : [consigne].':
        'Briefing specific to the contact: [consigne].',
    'Consignes':
        'Briefing',
    'Consignes (ex. « venir à jeun »)':
        'Briefings (e.g. « come on an empty stomach »)',
    'Consignes : [consignes].':
        'Instructions: [consignes].',
    'Consignes : à préciser.':
        'Briefing: to be specified.',
    'Créneau libéré':
        'Freed-up slot',
    'Créneau libéré (date et heure)':
        'Freed-up slot (date and time)',
    'Créneau libéré : [creneau_libere].':
        'Slot that came free: [creneau_libere].',
    'Créneau libéré : mardi 15 septembre 2026 à 9 heures 40.':
        'Freed-up slot: Tuesday 15 September 2026 at 9:40 a.m.',
    'Créneau proposé en premier (le plus proche)':
        'Slot offered first (the soonest)',
    'Créneau proposé en premier : [creneau_le_plus_proche].':
        'Slot to offer first: [creneau_le_plus_proche].',
    'Créneau proposé en premier : à préciser.':
        'Slot offered first: to be specified.',
    'Créneaux disponibles pour négocier (stock, non récité)':
        'Slots available to negotiate with (pool, not read out)',
    'Créneaux disponibles pour négocier : [creneaux_remplacement].':
        'Slots available to negotiate with: [creneaux_remplacement].',
    'Créneaux disponibles pour négocier : à préciser.':
        'Slots available to negotiate with: to be specified.',
    'Créneaux disponibles à proposer':
        'Available slots to offer',
    'Créneaux disponibles à proposer : [creneaux_proposes].':
        'Slots available to offer: [creneaux_proposes].',
    'Créneaux disponibles à proposer : à préciser.':
        'Slots available to offer: to be specified.',
    "Demander en fin d'appel si le rendez-vous doit être annulé":
        'Ask at the end of the call whether the appointment should be cancelled',
    "Demander en fin d'appel si le rendez-vous doit être annulé : [proposer_annulation].":
        'Ask at the end of the call whether the appointment should be cancelled: [proposer_annulation].',
    "Demander en fin d'appel si le rendez-vous doit être annulé : à préciser.":
        'Ask at the end of the call whether the appointment should be cancelled: to be specified.',
    'Durée':
        'Duration',
    'Durée : [duree].':
        'Duration: [duree].',
    'Durée : à préciser.':
        'Duration: to be specified.',
    'Durée de la prestation':
        'Service duration',
    'Durée de la prestation : [duree].':
        'Duration of the session: [duree].',
    'Durée de la prestation : à préciser.':
        'Duration of the service: to be specified.',
    'Déplacement de rendez-vous':
        'Appointment rescheduling',
    'En raison de [raison], nous':
        'Due to [raison], we',
    "Entre ton ouverture et ta conclusion, discute NATURELLEMENT, en t'adaptant à ce qu'on te répond : tu peux répéter, reformuler, laisser la personne t'interrompre, répondre à une question imprévue. Ne récite pas, ne conclus pas avant d'avoir une réponse claire. Avant de raccrocher, récapitule en une phrase ce qui a été convenu.":
        'Between your opening and your conclusion, talk NATURALLY, adapting to the answers you are given: you may repeat yourself, rephrase, let the person interrupt you, answer an unexpected question. Do not recite, and do not conclude before you have a clear answer. Before hanging up, sum up in one sentence what has been agreed.',
    "J'ai comme disponibilités : [creneaux_proposes]. Qu'est-ce qui vous arrange ?":
        'Here is what I have available: [creneaux_proposes]. What suits you best?',
    'Je peux vous proposer [creneau_le_plus_proche] — est-ce que cela vous conviendrait ?':
        'I can offer you [creneau_le_plus_proche] — would that suit you?',
    'La séance dure [duree].':
        'The session lasts [duree].',
    'Le motif noté : [motif].':
        'The reason on record: [motif].',
    'Lieu':
        'Location',
    'Lieu (si plusieurs)':
        'Location (if more than one)',
    'Lieu : [lieu].':
        'Place: [lieu].',
    'Lieu : à préciser.':
        'Location: to be specified.',
    'Motif':
        'Reason',
    'Motif : [motif].':
        'Reason: [motif].',
    'Motif souhaité (si fourni)':
        'Requested reason (if provided)',
    'Motif souhaité : [motif].':
        'Requested reason: [motif].',
    'NON':
        'NO',
    "Nom de l'entreprise":
        'Practice name',
    "Nom de l'entreprise : Cabinet Essai.":
        'Practice name: Cabinet Essai.',
    "Nom de l'entreprise : [entreprise].":
        'Practice name: [entreprise].',
    'Nous':
        'We',
    'OUI':
        'YES',
    'Origine de la demande (ex. « vous avez demandé un rendez-vous sur notre site »)':
        'Origin of the request (e.g. « you requested an appointment on our website »)',
    'Origine de la demande : [origine].':
        'Where the request came from: [origine].',
    'Origine de la demande : à préciser.':
        'Origin of the request: to be specified.',
    'Pensez à : [consigne].':
        'Please remember: [consigne].',
    'Pensez-y : [consignes].':
        'Keep in mind: [consignes].',
    'Personne appelée : [identite].':
        'Person called: [identite].',
    "Places libres à proposer en cas d'annulation (calculées ; vide = l'agent n'annonce aucune date)":
        'Free slots to offer in case of a cancellation (calculated; empty = the agent announces no date)',
    "Places libres à proposer en cas d'annulation : [creneaux_annulation].":
        'Free slots to offer if they cancel: [creneaux_annulation].',
    "Pour finir : souhaitez-vous maintenir ce rendez-vous, ou faut-il l'annuler ? Si vous l'annulez, je libère la place pour quelqu'un d'autre.":
        "Lastly: would you like to keep this appointment, or should it be cancelled? If you cancel it, I'll free up the slot for someone else.",
    'Prise de rendez-vous':
        'Appointment booking',
    'Puis-je compter sur votre présence, oui ou non ?':
        'Can I count on you being there, yes or no?',
    'Quels moments vous conviendraient ?':
        'What times would suit you?',
    'Raison simple et honnête (ex. « un imprévu dans notre planning »)':
        'Simple and honest reason (e.g. « something unexpected in our schedule »)',
    'Raison simple et honnête : [raison].':
        'Simple, honest reason: [raison].',
    'Raison simple et honnête : à préciser.':
        'Simple and honest reason: to be specified.',
    'Rappel de rendez-vous':
        'Appointment reminder',
    'Rendez-vous (date + heure)':
        'Appointment (date + time)',
    'Rendez-vous : [rdv_existant].':
        'Appointment: [rdv_existant].',
    'Rendez-vous actuel (date + heure)':
        'Current appointment (date + time)',
    'Rendez-vous actuel : [rdv_existant].':
        'Current appointment: [rdv_existant].',
    'Rendez-vous existant (date + heure)':
        'Existing appointment (date + time)',
    'Rendez-vous existant : [rdv_existant].':
        'Existing appointment: [rdv_existant].',
    "Rends aussi « notes » : une ou deux phrases qui résument l'échange, et la demande de la personne en clair si tu conclus sur AUTRE. N'ajoute aucun autre champ : le résultat n'accepte que ceux-là.":
        "Also return « notes »: one or two sentences summing up the exchange, and the person's request in plain words if you conclude on OTHER. Do not add any other field: the result accepts only these.",
    "Si la personne DÉCLINE la place, demande-lui avant de conclure : « Voulez-vous que je vous rappelle si un autre créneau se libère ? » — rends « wants_other_slots » = « yes » si elle accepte, « no » si elle ne veut plus qu'on lui en propose. N'insiste pas, et ne pose cette question QUE sur un refus.":
        'If the person DECLINES the slot, ask them before concluding: « Would you like me to call you back if another slot becomes free? » — return « wants_other_slots » = « yes » if they accept, « no » if they no longer want any to be offered to them. Do not insist, and ask this question ONLY on a refusal.',
    "Si la personne demande qu'on ne la rappelle plus — quels que soient ses mots (« ne me rappelez plus », « retirez-moi de vos listes », « je ne veux plus être contacté ») — réponds « C'est noté, vous ne serez plus appelé. Bonne journée. », rends « do_not_call » = « yes », et conclus quand même sur l'une des trois issues ci-dessus. Sinon, rends « do_not_call » = « no ».":
        "If the person asks not to be called again — whatever words they use (« stop calling me », « take me off your lists », « I don't want to be contacted any more ») — reply « That's noted, you will not be called again. Have a good day. », return « do_not_call » = « yes », and still conclude on one of the three outcomes above. Otherwise, return « do_not_call » = « no ».",
    "Si vous ne pouvez plus venir, j'annule votre rendez-vous, et je ne vous propose pas d'autre date aujourd'hui : c'est vous qui nous rappelez quand vous voulez — nous ne vous relancerons pas.":
        "If you can no longer come, I'll cancel your appointment, and I won't offer you another date today: it's up to you to call us back whenever you like — we won't follow up.",
    "Si vous ne pouvez plus venir, je peux vous proposer une autre date ; sinon j'annule votre rendez-vous et c'est vous qui nous rappelez quand vous voulez — nous ne vous relancerons pas.":
        "If you can no longer come, I can offer you another date; otherwise I'll cancel your appointment and it's up to you to call us back whenever you like — we won't follow up.",
    'Souhaitez-vous en profiter pour avancer votre rendez-vous du [rdv_existant] ?':
        'Would you like to take it and bring forward your appointment on [rdv_existant]?',
    "Tes règles — ce que tu dois faire, et ce que tu n'as pas le droit de faire :":
        'Your rules — what you must do, and what you are not allowed to do:',
    'Ton objectif :':
        'Your objective:',
    'Tu es un assistant téléphonique français, et tu appelles une personne pour le compte de Cabinet Essai. Cet appel se déroule en trois temps.':
        'You are an English-speaking phone assistant, and you are calling a person on behalf of Cabinet Essai. This call takes place in three stages.',
    'Tu es un assistant téléphonique français, et tu appelles une personne pour le compte de [entreprise]. Cet appel se déroule en trois temps.':
        'You are an English-speaking phone assistant, and you are calling a person on behalf of [entreprise]. This call takes place in three stages.',
    "au bout de TROIS propositions refusées, n'insiste plus : « Je ne veux pas vous retenir plus longtemps. Puisque nous n'arrivons pas à trouver un moment qui vous convienne, une personne de Cabinet Essai va vous rappeler pour convenir d'une date avec vous. Merci de votre patience, et bonne journée. » ; conclus alors sur AUTRE, sans date.":
        "after THREE refused suggestions, stop insisting: « I don't want to keep you any longer. Since we can't find a time that suits you, someone from Cabinet Essai will call you back to agree on a date with you. Thank you for your patience, and have a good day. » ; then conclude on OTHER, with no date.",
    "au bout de TROIS propositions refusées, n'insiste plus : « Je ne veux pas vous retenir plus longtemps. Puisque nous n'arrivons pas à trouver un moment qui vous convienne, une personne de [entreprise] va vous rappeler pour convenir d'une date avec vous. Merci de votre patience, et bonne journée. » ; conclus alors sur AUTRE, sans date.":
        "after THREE refused suggestions, stop insisting: « I don't want to keep you any longer. Since we can't find a time that suits you, someone from [entreprise] will call you back to agree on a date with you. Thank you for your patience, and have a good day. » ; then conclude on OTHER, with no date.",
    'aucun créneau ne lui convient et elle préfère annuler son rendez-vous':
        'no slot suits them and they prefer to cancel their appointment',
    'autre':
        'autre',
    'avec la date convenue dans « new_datetime » (format 2026-08-15T14:30) SI une date précise a été convenue ; sinon rends {champ} = « {code_sans_date} » et laisse « new_datetime » vide':
        'with the agreed date in « new_datetime » (format 2026-08-15T14:30) IF a precise date was agreed; otherwise return {champ} = « {code_sans_date} » and leave « new_datetime » empty',
    'cascade':
        'cascade',
    'classique':
        'classique',
    'commence par proposer LA date la plus proche, celle qui est écrite en « créneau proposé en premier » — une seule date, pas la liste ;':
        'start by offering THE nearest date, the one written under « slot offered first » — a single date, not the list;',
    'consignes':
        'consignes',
    'creneau_le_plus_proche':
        'creneau_le_plus_proche',
    'creneaux_annulation':
        'creneaux_annulation',
    "demande ensuite si elle préfère le MATIN ou l'APRÈS-MIDI ;":
        'then ask whether they prefer MORNING or AFTERNOON;',
    'devons déplacer votre rendez-vous du [rdv_existant] pour [motif].':
        'have to move your appointment on [rdv_existant] because of [motif].',
    'duree':
        'duree',
    "elle accepte l'un des créneaux de remplacement que tu proposes":
        'they accept one of the replacement slots you offer',
    "elle annule son rendez-vous et n'en fixe pas d'autre pendant l'appel":
        'they cancel their appointment and do not book another one during the call',
    "elle confirme fermement qu'elle sera présente":
        'they firmly confirm that they will be there',
    'elle décline : son rendez-vous actuel reste inchangé':
        'they decline: their current appointment remains unchanged',
    'elle décline la proposition et son rendez-vous actuel reste inchangé':
        'they decline the offer and their current appointment remains unchanged',
    'elle maintient son rendez-vous et sera présente':
        'they keep their appointment and will be there',
    'elle ne veut pas de rendez-vous':
        'they do not want an appointment',
    'elle refuse, ou elle annule son rendez-vous':
        'they refuse, or they cancel their appointment',
    'et laisse « new_datetime » vide':
        'and leave « new_datetime » empty',
    "faire accepter à la personne l'un des créneaux de remplacement, parce que son rendez-vous actuel ne peut pas être tenu":
        'get the person to accept one of the replacement slots, because their current appointment cannot be kept',
    'fixer un rendez-vous avec la personne, parmi les créneaux dont tu disposes':
        'book an appointment with the person, from the slots available to you',
    "l'établissement":
        'the practice',
    'la personne accepte le créneau que tu proposes':
        'the person accepts the slot you offer',
    "la personne prend la place qui s'est libérée":
        'the person takes the slot that has opened up',
    'lieu':
        'lieu',
    "n'insiste jamais : un refus se respecte dès la première fois ;":
        'never insist: a refusal must be respected the first time;',
    "n'invente rien : ni date, ni horaire, ni tarif, ni nom ;":
        'never make anything up: no date, no time, no price, no name;',
    'ne communique aucun numéro de téléphone ;':
        'do not give out any phone number;',
    'ne donne aucune information médicale, et aucun détail qui ne soit pas écrit dans « ce que tu sais » ci-dessus ;':
        'give no medical information, and no detail that is not written in « what you know » above;',
    'obtenir une réponse FERME : la personne sera-t-elle présente à son rendez-vous, oui ou non':
        'obtain a FIRM answer: will the person be there for their appointment, yes or no',
    "pendant nos heures d'ouverture":
        'during our opening hours',
    "pose D'ABORD ta question et attends la réponse : sera-t-elle présente, oui ou non ? Ne cite AUCUNE date tant qu'elle n'a pas répondu ;":
        'ask your question FIRST and wait for the answer: will they be there, yes or no? Mention NO date until they have answered;',
    "propose alors UNE SEULE heure, prise dans les créneaux disponibles ci-dessus, qui corresponde à ce jour et à ce moment de la journée ; si tu n'en as aucune qui corresponde, dis-le simplement ;":
        'then offer ONE SINGLE time, taken from the available slots above, matching that day and that part of the day; if you have none that matches, simply say so;',
    'proposer_annulation':
        'proposer_annulation',
    'raison':
        'raison',
    "redire ce que tu sais n'est JAMAIS une raison de passer la main : si on te demande de répéter la date, l'heure, le lieu, la durée ou le motif, redis-les simplement, aussi souvent qu'il le faut — ils sont écrits dans « ce que tu sais » ci-dessus ;":
        'repeating what you know is NEVER a reason to hand over: if you are asked to repeat the date, the time, the place, the duration or the reason, simply say them again, as often as needed — they are written in « what you know » above;',
    'replacer_annulation':
        'replacer_annulation',
    'savoir si la personne prend la place qui vient de se libérer, à la place de son rendez-vous actuel':
        'find out whether the person takes the slot that has just become free, instead of their current appointment',
    "si elle confirme sa présence, remercie et conclus : il n'y a rien d'autre à obtenir, et proposer une autre date sèmerait le doute ;":
        'if they confirm they will be there, thank them and conclude: there is nothing else to obtain, and offering another date would sow doubt;',
    "si elle ne convient pas, demande quels JOURS de la semaine l'arrangeraient ;":
        'if it does not suit them, ask which DAYS of the week would work for them;',
    'si elle ne peut pas venir ET que « ce que tu sais » porte des places libres, propose-lui UNE date pour commencer — la plus proche, pas la liste ;':
        'if they cannot come AND « what you know » carries free slots, offer them ONE date to start with — the nearest one, not the list;',
    'si on te demande si tu es un robot, dis-le : « Je suis un assistant automatique, mais je peux tout à fait vous aider — et le secrétariat peut vous rappeler si vous préférez. » ;':
        "if you are asked whether you are a robot, say so: « I'm an automated assistant, but I can absolutely help you — and the front desk can call you back if you prefer. » ;",
    "si rien ne lui convient, ou si tu n'as aucune place à proposer, dis-lui simplement que son rendez-vous est annulé et que c'est elle qui rappellera quand elle voudra.":
        'if nothing suits them, or if you have no slot to offer, simply tell them that their appointment is cancelled and that it is up to them to call back whenever they like.',
    "si tu n'as pas la bonne personne : « Toutes mes excuses pour le dérangement, bonne journée. », et conclus sur AUTRE ;":
        'if you do not have the right person: « My apologies for disturbing you, have a good day. », and conclude on OTHER;',
    "si tu ne comprends pas ce qu'on te répond, demande de reformuler UNE fois ; si tu ne comprends toujours pas, dis-le : « Je n'ai malheureusement pas bien compris votre réponse. Je préfère qu'un collègue de Cabinet Essai vous rappelle — rien n'est changé de votre côté. » ; conclus alors sur AUTRE, sans date, en écrivant dans « notes » ce que tu as cru comprendre. Ne devine JAMAIS une issue : une réponse mal comprise et tranchée quand même est bien pire qu'un rappel ;":
        "if you do not understand the answer you are given, ask for it to be rephrased ONCE; if you still do not understand, say so: « I'm afraid I didn't quite catch your answer. I'd rather have a colleague from Cabinet Essai call you back — nothing has changed on your side. » ; then conclude on OTHER, with no date, writing in « notes » what you thought you understood. NEVER guess an outcome: an answer that is misunderstood and settled anyway is far worse than a call back;",
    "si tu ne comprends pas ce qu'on te répond, demande de reformuler UNE fois ; si tu ne comprends toujours pas, dis-le : « Je n'ai malheureusement pas bien compris votre réponse. Je préfère qu'un collègue de [entreprise] vous rappelle — rien n'est changé de votre côté. » ; conclus alors sur AUTRE, sans date, en écrivant dans « notes » ce que tu as cru comprendre. Ne devine JAMAIS une issue : une réponse mal comprise et tranchée quand même est bien pire qu'un rappel ;":
        "if you do not understand the answer you are given, ask for it to be rephrased ONCE; if you still do not understand, say so: « I'm afraid I didn't quite catch your answer. I'd rather have a colleague from [entreprise] call you back — nothing has changed on your side. » ; then conclude on OTHER, with no date, writing in « notes » what you thought you understood. NEVER guess an outcome: an answer that is misunderstood and settled anyway is far worse than a call back;",
    'sortie de secours — UNIQUEMENT si la réponse ne se trouve nulle part dans « ce que tu sais », ou devant une personne agacée : « Je préfère ne pas vous dire de bêtise : je transmets votre demande à Cabinet Essai, qui vous rappellera entre 0h00 et 23h59. Merci de votre patience, et bonne journée. » ; conclus alors sur AUTRE, en écrivant sa demande en clair ;':
        "emergency exit — ONLY if the answer is nowhere to be found in « what you know », or when faced with an irritated person: « I'd rather not tell you anything wrong: I'm passing your request on to Cabinet Essai, who will call you back between 12:00 am and 11:59 pm. Thank you for your patience, and have a good day. » ; then conclude on OTHER, writing out their request in plain words;",
    'sortie de secours — UNIQUEMENT si la réponse ne se trouve nulle part dans « ce que tu sais », ou devant une personne agacée : « Je préfère ne pas vous dire de bêtise : je transmets votre demande à [entreprise], qui vous rappellera [plage_rappel]. Merci de votre patience, et bonne journée. » ; conclus alors sur AUTRE, en écrivant sa demande en clair ;':
        "emergency exit — ONLY if the answer is nowhere to be found in « what you know », or when faced with an irritated person: « I'd rather not tell you anything wrong: I'm passing your request on to [entreprise], who will call you back [plage_rappel]. Thank you for your patience, and have a good day. » ; then conclude on OTHER, writing out their request in plain words;",
    "sur un répondeur, laisse un message court et SANS le motif de l'appel.":
        'on voicemail, leave a short message, WITHOUT the reason for the call.',
    'séquentiel, arrêt au premier OUI':
        'sequential, stop at the first YES',
    "t'assurer que la personne a bien son rendez-vous en tête, et savoir si elle le maintient":
        'make sure the person does have their appointment in mind, and find out whether they are keeping it',
    'tout le monde ; non-réponse → relance':
        'everyone; no answer → follow-up',
    'tout le monde ; pas joint → relance, origine conservée':
        'everyone; not reached → follow-up, origin kept',
    'tout le monde est appelé':
        'everyone is called',
    "tout le monde est appelé ; rien n'est supprimé avant accord":
        'everyone is called; nothing is deleted before agreement',
    "tout le reste : elle propose un autre moment que ceux que tu annonces, elle ne peut rien fixer aujourd'hui, ou elle demande à être rappelée par un humain":
        'everything else: they suggest a time other than the ones you announce, they cannot settle anything today, or they ask to be called back by a human',
    "tout le reste : elle préfère un moment qui n'est pas dans tes créneaux, elle demande à être rappelée par un humain, elle dit n'avoir rien demandé, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they would rather have a time that is not among your slots, they ask to be called back by a human, they say they never asked for anything, or they ask a question you do not have the answer to',
    "tout le reste : elle souhaite une autre date, elle demande à être rappelée par un humain, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they would like another date, they ask to be called back by a human, or they ask a question you do not have the answer to',
    "tout le reste : elle souhaite une autre date, elle ne peut pas se décider maintenant, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they would like another date, they cannot make up their mind right now, or they ask a question you do not have the answer to',
    "tout le reste : elle veut déplacer son rendez-vous, elle hésite sans pouvoir se décider, elle préfère rappeler elle-même, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they want to move their appointment, they waver without being able to decide, they would rather call back themselves, or they ask a question you do not have the answer to',
    "tout le reste : elle veut déplacer son rendez-vous, elle préfère rappeler elle-même, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they want to move their appointment, they would rather call back themselves, or they ask a question you do not have the answer to',
    "tout le reste : elle veut une autre date, elle demande à être rappelée par un humain, ou elle pose une question à laquelle tu n'as pas la réponse":
        'everything else: they want another date, they ask to be called back by a human, or they ask a question you do not have the answer to',
    'un rendez-vous est fixé':
        'an appointment is scheduled',
    "« J'exige une réponse ferme »":
        '« I require a firm answer »',
    '« Je dois déplacer des rendez-vous »':
        '« I have to move some appointments »',
    '« Je rappelle leurs rendez-vous de demain »':
        "« I remind them of tomorrow's appointments »",
    "« On m'a demandé un rendez-vous, je le fixe »":
        '« Someone asked for an appointment, I book it »',
    "« Une place s'est libérée, je remplis le trou »":
        '« A slot has opened up, I fill the gap »',
    '«"\'(-–—':
        '«"\'(-–—',
    'À noter : [consignes].':
        'Please note: [consignes].',
    "⚠ à chaque refus, REPRENDS LE FILTRE au lieu d'enchaîner les heures : redemande quels jours l'arrangeraient, puis matin ou après-midi, puis propose une heure. Une heure à la fois, jamais une liste — c'est la personne qui restreint, pas toi qui énumères ;":
        '⚠ on every refusal, GO BACK TO THE FILTER instead of reeling off times: ask again which days would suit them, then morning or afternoon, then offer a time. One time at a time, never a list — it is the person who narrows things down, not you who lists them;',
}


TABLES_CONSIGNE = {
    "en": CONSIGNE_FR_VERS_EN,
}


def table_consigne(langue):
    """Le dictionnaire de la consigne pour cette langue, ou un vide."""
    return TABLES_CONSIGNE.get(langue) or {}


TABLES = {
    "en": FR_VERS_EN,
}


def table(langue):
    """Le dictionnaire de cette langue, ou un dictionnaire vide."""
    return TABLES.get(langue) or {}


def compte(langue):
    """Combien de phrases cette langue connaît — pour le mesurer, pas l'estimer.

    ⚠ CE N'EST PAS LA COUVERTURE. Les règles (`MOTIFS`) traduisent, à elles
    seules, plus de phrases que ce compte n'en contient : la couverture se
    mesure sur des écrans réels, avec `outils/recolter_phrases.py`.
    """
    return len(table(langue))


def compte_regles(langue):
    """Combien de règles cette langue applique."""
    return len(motifs(langue))
