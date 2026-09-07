"""Sample data set — a plausible physiotherapy practice, entirely fictional.

What it is for: trying RingBack on REALISTIC information (varied French names,
reasons that hang together, past AND future appointments, missed, cancelled,
moved, two 🚫 `do not call again` contacts, two with no number) rather than on
four demonstration rows.

Three rules held here:
1. Loading it is an EXPLICIT GESTURE (the `Charger un jeu d'essai` button on ⚙ Réglages, with confirmation) — never automatic.
2. It is ADDITIVE and REVERSIBLE: every client created carries the flag clients.jeu_essai = 1; `Retirer le jeu d'essai` deletes ONLY those (and their appointments). The user's data is never touched.
3. It is said on screen: as long as a sample data set is loaded, every page's banner announces it and the Clients page marks each row 🧪.

--------------------------------------------------------------------------
THE NUMBERS: REALISTIC IN SHAPE, INCAPABLE OF RINGING AT ANYONE'S
--------------------------------------------------------------------------
Every number in the sample data set is taken from the SIX ROOTS Arcep reserves for audiovisual works (the `fiction numbers` of cinema and television), that is, six blocks of 10,000 numbers:

01 99 00 xx xx 02 61 91 xx xx 03 53 01 xx xx 04 65 71 xx xx 05 36 49 xx xx 06
39 98 xx xx

These numbers are assigned to nobody and, by construction, `may neither call
nor be used as a caller identifier, nor be called`: dialling one therefore
CANNOT ring at a stranger's. That is exactly the guarantee wanted for a sample
data set.

Sources:
- Arcep, decision no. 2018-0881 of 24 July 2018 establishing the national numbering plan and its management rules, article 2.5.12 `Numbers for audiovisual works` — https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000037262971
- Arcep, public consultation on the numbering plan (December 2021), `Allocation of number blocks usable in audiovisual works`: six blocks of 10,000 numbers, which `may neither call nor be used as a caller identifier, nor be called` — https://www.arcep.fr/uploads/tx_gspublication/consultation-plan-numerotation-regles-gestion_dec2021.pdf
- The list of the six roots taken and checked at https://www.hteumeuleu.fr/numeros-pour-oeuvres-audiovisuelles/

Endings 51 to 56: the call simulator (calle_client) forces a deterministic
outcome according to the last two digits (51 accepts, 52 refuses, 53 does not
pick up, 54 offers another date, 55 asks to be called back by a human, 56 picks
up only on the first call). A handful of the sample data set's contacts
therefore carry those endings: they are the means of DEMANDING a precise
outcome, in a demonstration or in a check.

And they are there for EVERY campaign SOURCE, not only for the missed ones:
upcoming, missed, cancelled and `pending move` appointments each carry the six
endings. Without that, a campaign built on cancellations or on pending moves
only ever met random draws, and three of the eight campaign kinds were never
exercised end to end (see banc_essai.py, which walks this matrix).

⚠ THAT IS NO LONGER THE ONLY WAY TO SEE EVERY CASE (11/08/2026). A simulated
campaign now unrolls by itself the list of cases specific to its kind —
refusal, postponement, unreachable, 🚫 `stop calling me`, 🔇 `stop offering me
slots`, and the outcome that concludes last. See
calle_client.SUITES_PAR_NATURE.

Three endings exist WITHOUT being carried by a test contact, by design: 57
(refuses + 🚫), 58 (refuses + 🔇) and 59 (unreadable answer) leave a lasting
trace or pause the campaign. Putting them on a sample contact would have
changed the behaviour of every test campaign that met it — and the bench, which
walks 115 combinations, would no longer have produced the same report twice.
They are obtained by typing a number ending in 57, 58 or 59.
"""

import datetime
import logging
import os

from . import saisie

journal = logging.getLogger("ringback.jeu_essai")

# The six roots reserved for fiction (see the header for the source).
RACINES_FICTION = ("0199 00", "0261 91", "0353 01", "0465 71", "0536 49",
                   "0639 98")

NOM_METIER = "Cabinet de kinésithérapie"
CHEMIN_AGENDA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "exemple_agenda_realiste.ics")

# --------------------------------------------------------------------------
# The clients: (name, phone, do-not-call) Deliberately varied — honorifics,
# nobiliary particles, compound names, accents, one very long name, two
# namesakes, two with no number, two 🚫.
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
    # Namesakes: two distinct people bearing EXACTLY the same name.
    ("M. Jean Martin", "06 39 98 01 21", False),
    ("M. Jean Martin", "06 39 98 01 22", False),
    ("Mme Solange Dupuis-Ferrand", "06 39 98 01 23", False),
    ("M. Abdel Haddad", "06 39 98 01 24", False),
    ("Mme Béatrice Vandenberghe", "06 39 98 01 25", False),
    # Landlines: a practice also has elderly patients who give only a landline.
    ("Mme Yvonne Lecomte", "01 99 00 02 31", False),
    ("M. Raymond Bouchard", "01 99 00 02 32", False),
    ("Mme Geneviève Marceau", "04 65 71 03 41", False),
    ("M. Gilbert Perrin", "05 36 49 04 51", False),
    ("Mme Chantal Renaudin", "03 53 01 05 52", False),
    ("M. Théo Sanchez", "02 61 91 06 53", False),
    # 🚫 Do not call again: two people who asked for it.
    ("Mme Sophie Mercier", "06 39 98 01 26", True),
    ("M. Bruno Lacombe", "06 39 98 01 27", True),
    # No number: imported from a calendar, to be completed.
    ("Mme Zoé Berthier", "", False),
    ("M. Antoine Villeneuve", "", False),
    # --- Six `pending move` patients, endings 51 to 56 --------- Why them: the
    # `Déplacés en attente` source keeps ONLY the clients who no longer have
    # any upcoming appointment (see db.candidats_cascade). The six
    # ending-carriers above do have future appointments: they therefore cannot
    # serve that source. These six are reserved for it, so that a campaign
    # built on `Déplacés en attente` also meets the simulator's six outcomes
    # (51 to 56) instead of three random draws.
    ("Mme Aurélie Pastor", "02 61 91 07 51", False),
    ("M. Damien Rouvière", "02 61 91 07 52", False),
    ("Mme Leïla Bencheikh", "02 61 91 07 53", False),
    ("M. Olivier Tanguy", "02 61 91 07 54", False),
    ("Mme Hélène Sabatier", "02 61 91 07 55", False),
    ("M. Frédéric Aumont", "02 61 91 07 56", False),
    # --- Twelve patients UNDER TREATMENT over the next three months -- ⚠ WHY
    # TWELVE MORE (11/08/2026). Owner's request: `since we have 90 days we
    # ought to have samples over 100 days`. Measured before: the sample data
    # set's furthest upcoming appointment was at +9 DAYS. Consequences, also
    # measured: · a slot freed beyond +9 days found NOBODY on the `upcoming
    # appointments` and `booked appointments` sources; · the list rule's `up to
    # 30 days after` and `up to 90 days after` options could give nothing
    # different from `no limit` — two settings out of four with no material to
    # exercise them. These twelve each have TWO spaced sessions, and four
    # appointments of the batch cross the 90-day mark: without them, `up to 90
    # days` and `no limit` would stay identical.
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
    # --- Two patients whose ONLY appointment is beyond 90 days ------- ⚠ THEY
    # ARE NOT A DUPLICATE OF THE FOUR DISTANT APPOINTMENTS ABOVE, and this is a
    # correction born of a measurement. Those four belong to patients who ALSO
    # have a nearer session; yet the list keeps only one appointment per
    # person, the first. `Up to 90 days after` therefore still returned exactly
    # the same list as `no limit`. People whose only appointment falls outside
    # the window are needed for the window to be visible.
    ("Mme Christiane Lemarié", "06 39 98 01 40", False),
    ("M. Aurélien Pichot", "06 39 98 01 41", False),
    # --- Twenty-five patients, ONE session each, spread over three months
    # ------ ⚠ WHAT WAS STILL MISSING (11/08/2026), and it is a lesson about
    # data sets. The previous reinforcement had added APPOINTMENTS far out, but
    # few PEOPLE: twelve patients held two or three sessions each. The owner
    # saw it at once — `there are 100 days of test and I find it hard to
    # believe only 16 people gain at least 30 days`. Counted by hand: 27
    # appointments beyond the threshold, but only 18 distinct people. The
    # filter was right; the sample data set was thin.  ⚠ ONE SESSION EACH, AND
    # THAT IS THE WHOLE POINT: a campaign keeps only ONE person per client,
    # whatever their number of appointments. For a list to be well supplied,
    # you need PEOPLE, not calendar rows.  ⚠ NO ENDING BETWEEN 51 AND 59: that
    # range is reserved for the simulator's forced outcomes (see the header).
    # Hence the jump from 01 50 to 01 60.
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
# THE FOUR SEED CONTACTS: (name, phone, days, hour, minute, reason) What
# RingBack puts down BY ITSELF into an empty database, so a first screen is not
# deserted. The server creates them (see Application.peupler_demo); they are
# NOT marked 🧪, and they are missed appointments — enough to try a call-back
# from the very first minute.  ⚠ THREE OF THESE FOUR NAMES ALSO EXIST IN
# `CLIENTS`, UNDER A DIFFERENT NUMBER (observed on 13/08/2026). The history of
# the two lists explains everything: they were written months apart, and the
# same person received two numbers there. Measured consequence: loading the
# sample data set into a fresh database creates a SECOND `Mme Nadia Lefèvre`.
# Nobody is renamed and no number is rewritten — existing databases already
# carry these records, and rewriting them would go against the rule `we never
# overwrite what has been saved`. The list is here, beside the other, so the
# neighbouring is VISIBLE: `agenda_exemple` uses it never to announce one of
# these names with its namesake's number.
PREMIERS_CONTACTS = (
    ("Mme Nadia Lefèvre", "+33 6 39 98 50 41", 1, 10, 0,
     "Séance de kinésithérapie"),
    ("M. Karim Osman", "+33 6 39 98 50 42", 1, 14, 30, "Coupe et barbe"),
    ("Mme Élise Charpentier", "+33 6 39 98 50 43", 2, 9, 15,
     "Bilan nutrition"),
    ("M. Paul Guillot", "+33 6 39 98 50 44", 2, 16, 0, "Cours de guitare"),
)

# --------------------------------------------------------------------------
# The appointments: (client, days from today, hour, minute, reason, status,
# desired call-back days or None, length) A NEGATIVE offset is in the past, a
# POSITIVE one in the future. Statuses: prévu | manqué | confirmé | déplacé |
# annulé. The LENGTH is a number of SLOTS (see horaires.py): 1 = the average
# length of an appointment (15 minutes by default), 2 = half an hour, 4 = an
# hour. A real practice mixes lengths: so does the sample data set, otherwise
# the rule `a client is never rebooked where they do not fit` would never meet
# a concrete case.
# --------------------------------------------------------------------------
RENDEZVOUS = (
    # --- past: missed (the heart of the product, `I call the missed ones
    # back`)
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
    # --- past: honoured / confirmed
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
    # --- past: cancelled (the campaigns' `cancelled` source)
    ("M. Sébastien Nguyen", -6, 13, 30,
     "Rééducation cervicale après coup du lapin", "annulé", None),
    ("Mme Camille Aubert", -4, 11, 0,
     "Séance de kinésithérapie du dos", "annulé", None),
    ("M. Raymond Bouchard", -2, 15, 45,
     "Rééducation respiratoire (BPCO)", "annulé", None),
    # --- past: moved WITH no new date (the `pending moves` source)
    ("Mme Fatima Zahra El Amrani", -5, 16, 30,
     "Rééducation de l'épaule — séance 3/12", "déplacé", None),
    ("M. Abdel Haddad", -2, 8, 30,
     "Kinésithérapie maxillo-faciale", "déplacé", 1),
    ("Mme Béatrice Vandenberghe", -1, 12, 0,
     "Rééducation vestibulaire (vertiges)", "déplacé", None),
    # --- upcoming: the week ahead (the `upcoming appointments` source)
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
    # --- upcoming: the two 🚫 contacts have some too (they must be set aside)
    ("Mme Sophie Mercier", 5, 14, 30,
     "Rééducation du genou — séance 2/10", "prévu", None),
    ("M. Bruno Lacombe", -7, 9, 30,
     "Rééducation cervicale", "manqué", None),
    # --- the two with no number: from a calendar, to be completed
    ("Mme Zoé Berthier", 2, 8, 30,
     "Première consultation — bilan complet", "prévu", None, 4),
    ("M. Antoine Villeneuve", -1, 17, 45,
     "Rééducation du dos — séance 1/6", "manqué", None),
    # --------------------------------------------------------------------
    # MATERIAL FOR EVERY CAMPAIGN SOURCE
    # -------------------------------------------------------------------- The
    # six endings 51 to 56 were present only among the MISSED ones: a campaign
    # built on `Rendez-vous annulés`, on `Déplacés en attente` or on
    # `Rendez-vous à venir` therefore never met the simulator's six outcomes.
    # The rows below fill that gap — same patients, same fiction numbers, one
    # more appointment in the missing status.  --- cancelled: the six endings
    # (`Rendez-vous annulés` source)
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
    # --- moved WITH no new date: the six endings (`Déplacés en attente` source
    # — these six patients have NO upcoming appointment, otherwise the source
    # would set them aside)
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
    # --- upcoming: endings 54, 55 and 56 were missing (51, 52 and 53 are
    # already there: MM. Perrin, Mmes Renaudin, M. Sanchez)
    ("M. Paul Guillot", 5, 11, 45,
     "Lombalgie chronique — nouvelle séance", "prévu", None),
    ("Mme Anaïs Rousseau-Vidal", 6, 15, 0,
     "Rééducation de la cheville — reprise", "prévu", None),
    ("M. Hervé Dombasle", 8, 10, 45,
     "Drainage lymphatique — séance 5/10", "prévu", None),
    # -------------------------------------------------------------------- THE
    # NEXT THREE MONTHS (11/08/2026)
    # -------------------------------------------------------------------- See
    # the block about the twelve new patients, above: without these rows,
    # nothing existed beyond +9 days, and half the list rule's windows were
    # impossible to exercise.  ⚠ NONE OF THE SIX `PENDING MOVES` GETS ONE (the
    # 02 61 91 07 5x, plus Mmes El Amrani and Vandenberghe and M. Haddad).
    # Their source keeps only clients WITH no upcoming appointment: giving them
    # one would push them out of it, and a whole campaign kind would have no
    # material left.  --- the forced endings reach far out too: a campaign set
    # up on a slot three weeks away must be able to demand its outcome
    ("Mme Nadia Lefèvre", 12, 10, 30,
     "Rééducation du genou — séance 5/10", "prévu", None, 2),
    ("M. Karim Ben Amar", 16, 15, 15,
     "Rééducation de l'épaule — séance 6/12", "prévu", None),
    ("Mme Élise Charpentier", 19, 8, 45,
     "Kinésithérapie respiratoire — séance 4/6", "prévu", None),
    # --- material between three weeks and two months
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
    # --- two special cases, FAR OUT as well: the 🚫 must be set aside even at
    # three months, and the `no number` one must stay to be completed
    ("M. Bruno Lacombe", 44, 15, 45,
     "Rééducation cervicale — séance 3/8", "prévu", None),
    ("M. Antoine Villeneuve", 48, 17, 15,
     "Rééducation du dos — séance 2/6", "prévu", None),
    # --- the twelve treatments under way: two spaced sessions each
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
    # --- ⚠ BEYOND 90 DAYS, AND THAT IS THEIR ONLY REASON TO EXIST: without
    # them, `up to 90 days after` would return exactly the same list as `no
    # limit`, and the setting would be undemonstrable.
    ("Mme Roselyne Gauthier", 91, 10, 15,
     "Rééducation vestibulaire — bilan de fin", "prévu", None),
    ("M. Anselme Kouassi", 95, 16, 45,
     "Contrôle annuel", "prévu", None),
    ("Mme Laurence Thibault", 99, 9, 45,
     "Contrôle à trois mois", "prévu", None),
    ("M. Serge Pouliquen", 100, 15, 0,
     "Contrôle à trois mois", "prévu", None),
    # --- And the two who have ONLY that: they alone make `up to 90 days after`
    # return a different list from `no limit` (see their block in CLIENTS).
    ("Mme Christiane Lemarié", 94, 11, 0,
     "Première consultation — bilan complet", "prévu", None, 4),
    ("M. Aurélien Pichot", 97, 14, 15,
     "Bilan de posture initial", "prévu", None, 2),
    # --------------------------------------------------------------------
    # TWENTY-FIVE MORE PEOPLE, ONE SESSION EACH (11/08/2026)
    # -------------------------------------------------------------------- See
    # their block in CLIENTS: what was missing was not appointments but PEOPLE.
    # Spread from +11 to +99 days, one per row, so that a freed slot finds
    # somebody at every distance.  A few are `confirmé`: the `upcoming, not yet
    # confirmed` source must be able to set some aside, otherwise it is never
    # distinguishable from `booked appointments`.
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
# THE ENGLISH-SPEAKING SETTING — the same sample data set, played by another
# cast
# ---------------------------------------------------------------------------
# ⚠ THIS IS NOT A TRANSLATION, IT IS A CASTING. A proper noun is not
# translated. But an English-speaking tester discovering the product on `Mme
# Marie-Christine de La Tour du Pin` trips over the scenery before having seen
# the software.  ⚠ AND THE SETTING'S PECULIARITIES ARE DELIBERATE, HENCE
# REPRODUCED. This sample data set is not a list of names: it is a test bench.
# It deliberately carries varied honorifics, nobiliary particles, compound
# names, accents, one very long name, TWO NAMESAKES, two records with no
# number, two 🚫. Each of those properties exercises a rule of the product — the
# namesakes exercise the (name, phone) key, the very long name exercises the
# layout. An English-speaking cast that lost them would no longer be a bench,
# just a list.  ⚠ WITH NO EQUIVALENT, FRENCH IS KEPT. It is the same rule as
# everywhere else in this product: only what we know is translated. A name
# absent from the table passes through intact.

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
    """The translated value if we know it, otherwise the value as it stands."""
    return table.get(valeur, valeur)


def decor(langue_code="fr"):
    """(clients, appointments, seed contacts, trade name) in THIS language.

    The English setting is BUILT from the French, by substituting names and
    reasons only: the structure — the order, the fictional phone numbers, the
    statuses, the lengths, the namesakes — is therefore preserved by
    construction, and not by copying. There is nothing to keep up to date
    twice.
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
    """EVERY name in the sample data set, in both languages.

    ⚠ BOTH, AND THAT IS NECESSARY. A screen that recognises a demonstration
    record by its name must recognise it even when it was loaded in the other
    language — otherwise the displayed count changes when the language changes,
    while the database has not moved.
    """
    noms = {nom for nom, _, _ in CLIENTS}
    noms |= set(NOMS_EN.values())
    return noms


def est_charge(base):
    """True when a sample data set is currently in the database."""
    return base.compter_clients_jeu_essai() > 0


def resume(langue_code="fr"):
    """What the sample data set contains — announced BEFORE loading it.

    ⚠ THE COUNTS DO NOT CHANGE WITH THE LANGUAGE: it is the same setting,
    played by another cast. Only the trade name changes.
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
        # Appointments longer than the average length (2 slots or more): they
        # are the ones that bring the consecutive-slots rule to life.
        "longs": sum(1 for entree in RENDEZVOUS_L
                     if len(entree) > 7 and entree[7] > 1),
        "passes": sum(1 for entree in RENDEZVOUS_L if entree[1] < 0),
        "a_venir": sum(1 for entree in RENDEZVOUS_L if entree[1] >= 0),
        "metier": metier,
    }


def charger(base, maintenant=None, langue_code="fr"):
    """Adds the sample data set to the database; returns (clients created,
    appointments created).

    ADDITIVE: nothing is erased, existing clients are not touched. A second
    load doubles nothing. Every client created carries clients.jeu_essai = 1,
    which makes removal possible without risk to real data.

    ⚠ `DOUBLES NOTHING` WAS FALSE FOR THE APPOINTMENTS (fixed on 11/08/2026).
    The CLIENTS were indeed reused; the appointments, though, were recreated
    every time. Measured: 112 appointments on the first load, 224 on the
    second, 336 on the third. The defect did not show because the test guarding
    this promise looked only at the CLIENT count.

    It is a defect that BITES: to get richer demonstration data you have to
    reload — and reloading doubled the calendar.

    ⚠ A DEMONSTRATION APPOINTMENT'S IDENTITY IS (patient, reason), NOT
    (patient, time). The times are computed from `now`: a reload the next day
    would give different times, so comparing by time would have recognised
    nothing. The (patient, reason) pair is unique within RENDEZVOUS — a test
    guards that.
    """
    if maintenant is None:
        maintenant = datetime.datetime.now()
    maintenant = maintenant.replace(second=0, microsecond=0)
    CLIENTS_L, RENDEZVOUS_L, _, _ = decor(langue_code)
    # The namesakes share the same name: the key is (name, phone), and the two
    # `no number` records are told apart by their name.
    identifiants, clients_crees = {}, 0
    for nom, telephone, ne_plus_appeler in CLIENTS_L:
        client_id, cree = _obtenir_ou_creer_essai(base, nom, telephone)
        clients_crees += 1 if cree else 0
        identifiants.setdefault(nom, []).append(client_id)
        if ne_plus_appeler:
            base.definir_ne_plus_appeler(client_id, True)
    # WHAT IS ALREADY THERE, read IN A SINGLE PASS: (client, reason). See the
    # docstring — it is that identity which recognises a demonstration
    # appointment already loaded, including on another day.
    deja = {(r["client_id"], r["motif"]) for r in base.tous_les_rendezvous()}
    # The namesakes' appointments go to the first of the two, except the second
    # `M. Jean Martin` who has none: that is precisely what makes the namesake
    # case visible on screen (two records, only one file loaded).
    rendezvous_crees = 0
    for entree in RENDEZVOUS_L:
        nom, jours, heure, minute, motif, statut, rappel = entree[:7]
        # Optional length at the end of the row: 1 slot by default.
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
    """The test client (name, phone); returns (id, created?).

    ONLY reuses clients already marked `jeu d'essai`: a real client with the
    user's namesake would never be swept up in the removal of the sample data
    set. The number goes through the common validator — the sample data set is
    stored exactly like typed input.
    """
    if telephone:
        telephone = saisie.valider_telephone(telephone)
    # The query is written here rather than in db.py: it therefore goes through
    # the database lock by hand (see db._sous_verrou), without which it could
    # land in the middle of a write by the campaign thread.
    with base.verrou:
        ligne = base.conn.execute(
            "SELECT id FROM clients WHERE nom = ? AND telephone = ? "
            "AND jeu_essai = 1 ORDER BY id LIMIT 1", (nom, telephone)).fetchone()
    if ligne:
        return ligne["id"], False
    return base.ajouter_client(nom, telephone, jeu_essai=True), True


def retirer(base):
    """Removes the sample data set; returns (clients removed, appointments
    removed).
    """
    return base.supprimer_jeu_essai()
