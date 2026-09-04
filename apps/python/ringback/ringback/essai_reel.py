"""REAL-CONDITIONS testing: the testers, and their ready campaign.

WHAT IT IS FOR
--------------
Before entrusting RingBack to real patients, the operator wants to put it through its paces for real: genuine calls, placed by the CALL-E agent, on phones they know — their own, and those of people willing to play a role with them (a colleague, a friend, the practice next door). Each plays one outcome in turn: I accept, I refuse, I ask for another date, I want to speak to a human, I do not pick up.

For that they need SEVERAL contacts, with different identities, on a small
number of known numbers. Yet the grid's duplicate rule refuses precisely the
same number twice — and it is a good rule: it exists so that the same person is
never called twice.

THIS MODULE DOES NOT REMOVE THAT RULE, IT MAKES IT DELIBERATE
-----------------------------------------------------------
The operator DECLARES their TESTERS in ⚙ Réglages: a name (`me`, `Paul`, `the practice next door`) and a number for each. Those numbers, and those alone, escape the duplicate refusal (pasting, CSV, grid validation). Every other number stays subject to the strict rule, without exception. Removing a tester immediately restores the strict rule for them; emptying the list restores it for everyone.

A SINGLE ALREADY-CONFIGURED NUMBER GOES ON WORKING. Before the testers, one
single number could be declared (the `numero_essai` setting). It is not lost:
if it is there and no list has yet been composed, it becomes the FIRST tester,
named `me` — see `testeurs()`. Nothing to redo, nothing to retype.

Three guarantees held here:
1. NOTHING IS HIDDEN. Every contact carrying one of the declared numbers is marked 🧪 in the grid, the campaign record, the schedule and 👥 Contacts, with the sentence saying why. No possible confusion with real data.
2. MASKING STAYS WHOLE. Testers' numbers are masked on screen like all the others (`+33 6 •• •• 51`): the flag says `this is a test`, it never reveals the number. Recognition, for its part, always works on the NINE significant digits (db.est_numero_essai) and never on the masked text — that is what avoids marking a real person whose number would mask the same way.
3. NO CALL GOES OUT FROM HERE. The prepared campaign is created in the `prête` state, zero calls placed. The three locks of real mode (the CALLE_API_KEY key, the --appels-reels option, the word APPELER typed at the keyboard) stay whole and stay the operator's own gestures.

AND ANOTHER SETTING, NOT TO BE CONFUSED WITH THAT ONE
--------------------------------------------------------------
A `always use MY number for real-condition tests` box (⚙ Réglages → 🧪 Essais → Jeu d'essai) replaces, at the very last moment, the DIALLED number by the operator's. The two settings do not do the same thing at all:

the TESTERS change the DATABASE — records carry their number, are marked 🧪
everywhere and escape the duplicate refusal; the REDIRECT changes NO record —
the contacts keep their number, and it is the dialled number, and it alone,
that is replaced just before sending to the agent. The identity, the reason,
the appointment: nothing moves. That is what allows a whole campaign to be
exercised, on real data, without a single real phone ringing.

See CLE_IMPOSER_NUMERO and numero_impose().

THE FIVE ROLES, AND THEIR IDENTITIES
----------------------------------
Five roles to exercise, one per outcome, with a memory aid: the FIRST NAME'S INITIAL recalls the role to play on the phone.

Alice → I Accept the appointment Rémi → I Refuse / I cancel Diane → I ask for
another Date Hugo → I ask to speak to a Human Nina → I do Not pick up

MORE than five identities can be asked for (up to twenty): the roles then come
round again in the same order, with other first names sharing the initial
(Alice, then Adrien, then Amélie…). The role stays readable at a glance.

WHO PLAYS WHAT
-------------
The roles are dealt out to the declared testers, IN ROTATION: the 1st role to the 1st tester, the 2nd to the 2nd, then round again. With a single tester, everything falls back to them — that is to say, exactly the previous behaviour. The screen announces the distribution (`Alice (I accept) → Paul`) because, as soon as there are several people, each must be told what they will have to play.

WHAT THIS MODULE CANNOT CHECK
-------------------------------------
The outcome of a real call depends on what the tester actually SAYS on the phone, and on what the agent makes of it. No automatic check can judge that: THEY are the ones who observe, and that is precisely the point of the test. This module prepares the ground; it claims nothing about the result.
"""

import datetime
import logging

from . import db, horaires, saisie
from .saisie import SaisieInvalide

journal = logging.getLogger("ringback.essai_reel")

# --------------------------------------------------------- setting keys
CLE_NUMERO_ESSAI = "numero_essai"        # « +33 6 •• •• •• » ; "" = aucun
# The LIST of testers: [{"nom", "telephone"}]. A setting ADDED, never
# substituted: CLE_NUMERO_ESSAI stays written (the first tester's number), so
# that an older setting goes on being read and a newer one stays readable by
# anything that only knows the old one.
CLE_TESTEURS = "testeurs_essai"
# The name given to a single number carried over from the old setting. It is
# not a guessed value: it is the label of the only tester it could designate —
# the operator themselves. They can change it (remove, re-add).
NOM_PREMIER_TESTEUR = "moi"
TESTEURS_MAXIMUM = 10

# ------------------------------------- THE REDIRECT: dial MY number Owner's
# request of 10/08/2026: `Always use my phone number for real-condition tests
# […] the phone numbers passed to the agent are replaced by this phone number.
# THE IDENTITY IS UNCHANGED.`  ⚠ THIS IS NOT THE SAME THING AS THE TESTERS
# above, and confusing the two would lead straight to a call at a real
# client's: · a TESTER is declared so that a CONTACT CARRIES their number — the
# record is created with that number, marked 🧪, and it escapes the duplicate
# refusal. The database is modified, and the screen shows it everywhere; · the
# REDIRECT touches NO RECORD. The contacts keep their own number; it is at the
# very last moment — just before sending to the agent — that the DIALLED number
# is replaced by this one. That is what allows a whole campaign to be
# exercised, on real data, without a single real phone ringing.
CLE_IMPOSER_NUMERO = "imposer_numero"  # the box ticked (true / false)
CLE_NUMERO_IMPOSE = "numero_impose"  # the number that replaces all the others

MARQUE = "🧪"
PHRASE_MARQUE = ("Contact d'ESSAI : il porte le numéro d'un testeur déclaré "
                 "dans ⚙ Réglages — c'est VOTRE téléphone, ou celui d'un "
                 "testeur, qui sonnera, pas celui d'un client.")
# The badge, written ONCE: the grid, the campaign record, the schedule and 👥
# Contacts all display exactly the same one, with the same explanation. (No
# double quote in the sentence: it has to fit inside the title attribute.)
BADGE_HTML = (f'<span class="badge-essai" title="{PHRASE_MARQUE}">'
              f"{MARQUE} numéro d'essai</span>")


def badge(ligne, prefixe=" "):
    """The 🧪 badge of a row carrying a tester's number — otherwise "".

    `ligne` is any dictionary returned by db.py with a masked number: client,
    appointment, campaign contact, follow-up. A row from before this flag (or
    from a database opened with no setting) has none: it then carries no badge,
    which is the truth.
    """
    if not (ligne or {}).get("numero_essai"):
        return ""
    return prefixe + BADGE_HTML

# The campaign kind used by the `real conditions` sample data set. `Appointment
# confirmation`: everybody is called (no stop at the first yes), each contact
# has an appointment to confirm, and all five outcomes to be exercised make
# sense there.
NATURE = "confirmation"

# THE ROLES TO EXERCISE, one per outcome. For each: the role written as it is
# displayed, the appointment's reason (read out by the agent — it stays
# plausible for a practice), and fictional identities SHARING THE INITIAL, in
# the order they are served when more than five identities are asked for.
ROLES = (
    {"role": "j'accepte le rendez-vous proposé", "court": "accepte",
     "motif": "Séance de rééducation",
     "dire": "Oui, c'est noté, je serai là.",
     "noms": ("Mme Alice Dubreuil", "M. Adrien Bonnel",
              "Mme Amélie Rouvier", "M. Antoine Delcourt")},
    {"role": "je refuse — j'annule mon rendez-vous", "court": "refuse",
     "motif": "Bilan articulaire",
     "dire": "Non, je ne pourrai pas venir, annulez mon rendez-vous.",
     "noms": ("M. Rémi Chastain", "Mme Rosalie Merlin",
              "M. Roland Vasseur", "Mme Raphaëlle Ducrocq")},
    {"role": "je demande une autre date", "court": "autre date",
     "motif": "Séance de kinésithérapie",
     "dire": ("Je ne peux plus à cette heure-là — mettez-moi plutôt "
              "[une date que l'agent vient de proposer]."),
     "noms": ("Mme Diane Verrier", "M. Damien Lorcet",
              "Mme Delphine Aubin", "M. David Ferrand")},
    {"role": "je demande à être rappelé par un humain", "court": "humain",
     "motif": "Rééducation de l'épaule",
     "dire": "Je ne veux pas parler à un robot, je veux qu'on me rappelle.",
     "noms": ("M. Hugo Sernin", "Mme Hélène Bardet",
              "M. Hervé Maunier", "Mme Hortense Coquelin")},
    {"role": "je ne décroche pas", "court": "ne décroche pas",
     "motif": "Séance de kinésithérapie",
     "dire": "(rien : laissez sonner jusqu'au bout, ne décrochez pas)",
     "noms": ("Mme Nina Aubert", "M. Noé Vaillant",
              "Mme Nadia Perreau", "M. Norbert Lemoine")},
)

# The FIVE original identities — one per role, in role order. They have not
# moved: this is still what an ordinary test campaign produces (five
# identities).
IDENTITES = tuple((role["noms"][0], role["role"], role["motif"])
                  for role in ROLES)

# How many identities may be asked for: at least as many as there are distinct
# roles (otherwise a role would not be exercised at all), at most what the pool
# of first names allows to name without repeating the same identity twice.
IDENTITES_MINIMUM = len(ROLES)
IDENTITES_MAXIMUM = len(ROLES) * min(len(role["noms"]) for role in ROLES)

# The cost of a real call at CALL-E, as announced everywhere else in the
# project (PROCEDURE-ESSAI-REEL.md, README).
COUT_APPEL_DOLLARS = 0.05

# Fallback time when no opening hours are configured: tomorrow morning. It is
# NOT a guessed preference — the screen says so in plain words and invites the
# user to configure the opening hours.
HEURE_REPLI = 9
JOURS_REPLI = 1


class EssaiImpossible(Exception):
    """The real-conditions test cannot be prepared (French message)."""


# ------------------------------------------------------- the testers
def testeurs(preferences):
    """The list of declared testers: [{"nom", "telephone"}], or [].

    CARRYING OVER THE OLD SETTING HAPPENS HERE, and it is done AT READ TIME: as
    long as no list has been composed, a single already-configured number
    (CLE_NUMERO_ESSAI, from when only one could be declared) is returned as the
    FIRST tester, named `me`. Nothing is rewritten along the way: an old
    setting is therefore never damaged, and the day the list is composed, it is
    the list that counts.
    """
    liste = preferences.obtenir(CLE_TESTEURS)
    propres = []
    for entree in liste or []:
        if not isinstance(entree, dict):
            continue
        telephone = (entree.get("telephone") or "").strip()
        if not telephone:
            continue
        propres.append({"nom": (entree.get("nom") or "").strip() or
                        NOM_PREMIER_TESTEUR, "telephone": telephone})
    if propres:
        return propres
    ancien = (preferences.obtenir(CLE_NUMERO_ESSAI) or "").strip()
    if ancien:
        return [{"nom": NOM_PREMIER_TESTEUR, "telephone": ancien}]
    return []


def numeros_declares(preferences):
    """The numbers of every declared tester (a list, possibly empty)."""
    return [testeur["telephone"] for testeur in testeurs(preferences)]


def numero_declare(preferences):
    """The FIRST tester's number, or "" when there is none.

    Kept under its original name: everything that knows only a single test
    number goes on working, and sees the first tester's.
    """
    numeros = numeros_declares(preferences)
    return numeros[0] if numeros else ""


def enregistrer_testeurs(preferences, liste):
    """Writes the list of testers — and keeps the old setting up to date.

    The old single-number setting (CLE_NUMERO_ESSAI) receives the FIRST
    tester's number, or "" when the list is empty. So there are never two
    contradictory truths in the settings file, and a program that knew only the
    old name goes on reading something correct.
    """
    propres = [{"nom": testeur["nom"], "telephone": testeur["telephone"]}
               for testeur in liste]
    preferences.definir(CLE_TESTEURS, propres)
    preferences.definir(CLE_NUMERO_ESSAI,
                        propres[0]["telephone"] if propres else "")
    return propres


def valider_nom_testeur(brut):
    """A tester's name (`me`, `Paul`, `the practice next door`)."""
    nom = " ".join((brut or "").split())
    if len(nom) < 2:
        raise SaisieInvalide(
            "Le nom du testeur est obligatoire (deux caractères minimum) : "
            "il sert à savoir QUI devra jouer quel rôle au téléphone — "
            "par exemple « moi », « Paul », « le cabinet d'à côté ».")
    if len(nom) > 40:
        raise SaisieInvalide(
            f"Le nom du testeur est trop long ({len(nom)} caractères) : "
            "40 au maximum, pour qu'il tienne dans le tableau des rôles.")
    return nom


def ajouter_testeur(preferences, nom_brut, numero_brut):
    """Adds a tester; returns the complete list. Raises SaisieInvalide.

    The two fields are validated SEPARATELY, and the refusal says which is at
    fault: refused input must be fixable where it was typed, without having to
    retype everything.
    """
    liste = testeurs(preferences)
    if len(liste) >= TESTEURS_MAXIMUM:
        raise SaisieInvalide(
            f"{TESTEURS_MAXIMUM} testeurs au maximum sont déclarables "
            f"({len(liste)} déjà déclarés) : retirez-en un avant d'en "
            "ajouter un autre.")
    nom = valider_nom_testeur(nom_brut)
    telephone = saisie.valider_telephone_essai(numero_brut)
    for rang, testeur in enumerate(liste, start=1):
        if db.est_numero_essai(telephone, testeur["telephone"]):
            raise SaisieInvalide(
                f"Ce numéro est déjà déclaré : c'est celui du testeur n°{rang}, "
                f"« {testeur['nom']} ». Un même téléphone ne peut pas jouer "
                "deux testeurs — donnez un autre numéro, ou renommez "
                "celui-là en le retirant puis en l'ajoutant à nouveau.")
    liste.append({"nom": nom, "telephone": telephone})
    enregistrer_testeurs(preferences, liste)
    journal.info("Testeur déclaré : « %s » (%d testeur(s) au total)",
                 nom, len(liste))
    return liste


def retirer_testeur(preferences, rang):
    """Removes the tester at this rank (1 = the first); returns (list, removed).

    `removed` is the tester taken out, or None when the rank designates nobody
    — the screen SAYS so rather than pretending to have acted.
    """
    liste = testeurs(preferences)
    if not isinstance(rang, int) or rang < 1 or rang > len(liste):
        return liste, None
    retire = liste.pop(rang - 1)
    enregistrer_testeurs(preferences, liste)
    journal.info("Testeur retiré : « %s » — la règle stricte du doublon lui "
                 "est rendue (%d testeur(s) restant)", retire["nom"], len(liste))
    return liste, retire



# ------------------------------------------- the redirect to MY number
def numero_impose(preferences):
    """The number that REPLACES each contact's, or "" — no redirect.

    This is THE function the real-call client reads, on every call. It returns
    "" as soon as the box is unticked: no redirect can therefore happen by
    accident.

    ⚠ IT DOES NOT VALIDATE THE NUMBER, on purpose. The check happens at save
    time (see valider_renvoi); here, an unreadable number is returned as it
    stands, and calle_client then REFUSES the call. Falling back on the
    contact's number would ring a real phone at the very moment the screen
    promises none will ring — the one unacceptable ending.
    """
    if not preferences.obtenir(CLE_IMPOSER_NUMERO):
        return ""
    return (preferences.obtenir(CLE_NUMERO_IMPOSE) or "").strip()


def numero_range(preferences):
    """The saved test number, ticked or not ("" when there is none).

    Unticking the box does not erase it: it must be possible to stop the
    redirect, then resume it, without retyping one's own number.
    """
    return (preferences.obtenir(CLE_NUMERO_IMPOSE) or "").strip()


def etat_du_renvoi(preferences):
    """What the screen must say about the redirect, in five facts.

    {"coche", "numero", "masque", "actif", "incoherent"}:
    - actif      : the redirect WILL happen (box ticked, number dialable);
    - incoherent : the box is ticked and the number is NOT dialable. No real call will go out, and the screen must say so instead of letting the user believe all is well. This can only be reached by editing the settings file by hand: saving refuses it.
    The number is returned MASKED as everywhere else: declaring it does not make it readable on screen.
    """
    coche = bool(preferences.obtenir(CLE_IMPOSER_NUMERO))
    numero = numero_range(preferences)
    try:
        propre = saisie.valider_telephone_essai(numero) if numero else ""
    except SaisieInvalide:
        propre = ""
    return {"coche": coche, "numero": numero,
            "masque": db.masquer_telephone(propre) if propre else "",
            "actif": bool(coche and propre),
            "incoherent": bool(coche and not propre)}


def valider_renvoi(coche, numero_brut, numero_actuel=""):
    """Checks the box and the number; returns (ticked?, number). Raises
    SaisieInvalide.

    Three rules, each born of an ending to be avoided:
    - an EMPTY field keeps the number already saved. Without that, unticking then re-ticking would force the user to retype their own number — and the field is always empty, since a saved number is never redisplayed;
    - ticking WITHOUT any number (neither typed nor saved) is REFUSED: RingBack would not know where to redirect, and would therefore call the real contacts — exactly what the box promises to prevent;
    - an unreadable number is refused even with the box unticked, so that the typo shows up straight away and not on the day the box is ticked.
    """
    tape = (numero_brut or "").strip()
    numero = saisie.valider_telephone_essai(tape) if tape else (numero_actuel or "")
    if coche and not numero:
        raise SaisieInvalide(
            "Cochez la case ET donnez un numéro : sans numéro, RingBack ne "
            "saurait pas où renvoyer les appels — il appellerait vos vrais "
            "contacts, ce que cette case promet justement d'empêcher.")
    return bool(coche), numero


def enregistrer_renvoi(preferences, coche, numero_brut):
    """Writes the redirect setting; returns (ticked?, number). Raises
    SaisieInvalide.

    The log says what changes WITHOUT ever writing the number in clear: a log
    file is shared more easily than one thinks.
    """
    coche, numero = valider_renvoi(coche, numero_brut,
                                   numero_range(preferences))
    preferences.definir(CLE_IMPOSER_NUMERO, coche)
    preferences.definir(CLE_NUMERO_IMPOSE, numero)
    journal.info("Renvoi d'essai %s (numéro %s)",
                 "ACTIVÉ — aucun contact ne sera appelé en mode réel"
                 if coche else "désactivé : les contacts seront appelés sur "
                 "leur propre numéro",
                 db.masquer_telephone(numero) if numero else "aucun")
    return coche, numero


def retirer_renvoi(preferences):
    """Erases the test number and stops the redirect; returns the number removed.
    """
    retire = numero_range(preferences)
    preferences.definir(CLE_IMPOSER_NUMERO, False)
    preferences.definir(CLE_NUMERO_IMPOSE, "")
    journal.info("Numéro d'essai retiré (%s) : le renvoi est arrêté",
                 db.masquer_telephone(retire) if retire else "aucun")
    return retire


# ------------------------------------------------------ the declared number
def valider_numero(brut):
    """Validates the test number typed in; "" (an emptied field) is ACCEPTED.

    An emptied field must be able to erase the setting: without that, a number
    declared once could no longer be removed from the page, and the screen
    would say the opposite of what it does. A non-empty number goes through the
    common validator (saisie.valider_telephone): it is stored exactly like any
    other input.
    """
    brut = (brut or "").strip()
    if not brut:
        return ""
    return saisie.valider_telephone_essai(brut)


def est_numero_essai(telephone, preferences):
    """Is this number a declared tester's? (compared by digits)"""
    return db.est_numero_essai(telephone, numeros_declares(preferences))


def exempte_de_doublon(telephone, numeros_essai):
    """Is this number ALLOWED to appear several times in a list?

    Only the numbers the operator has themselves declared in ⚙ Réglages (their
    testers) have that right. No number declared: nobody is exempt.
    `numeros_essai` accepts a single number or the complete list.
    """
    return db.est_numero_essai(telephone, numeros_essai)


# ------------------------------------------------------ identities and roles
def valider_nombre_identites(brut):
    """The number of identities requested, bounded and explained. Raises
    SaisieInvalide.

    The floor is not arbitrary: below the number of distinct roles, one role
    would not be exercised at all — the test would lose what it came for.
    """
    texte = (brut or "").strip()
    if not texte:
        return len(IDENTITES)
    if not texte.isdigit():
        raise SaisieInvalide(
            f"Nombre d'identités illisible : « {texte} » — attendu un nombre "
            f"entier entre {IDENTITES_MINIMUM} et {IDENTITES_MAXIMUM}.")
    nombre = int(texte)
    if nombre < IDENTITES_MINIMUM:
        raise SaisieInvalide(
            f"{nombre} identité(s), c'est trop peu : il en faut au moins "
            f"{IDENTITES_MINIMUM}, une par rôle à éprouver, sinon un rôle "
            "ne serait pas joué du tout.")
    if nombre > IDENTITES_MAXIMUM:
        raise SaisieInvalide(
            f"{nombre} identités, c'est plus que ce que RingBack sait nommer "
            f"sans répéter : {IDENTITES_MAXIMUM} au maximum "
            f"({IDENTITES_MAXIMUM} appels, soit environ "
            f"{cout_lisible(IDENTITES_MAXIMUM)}).")
    return nombre


def identites_detaillees(nombre=None):
    """The identities to create, all we know of them, in role order.

    [{"identite", "role", "court", "dire", "motif"}]. The roles come round in
    rotation; on the second round it is another first name with the SAME
    INITIAL that carries the role (Alice, then Adrien…) so the memory aid holds
    whatever number is asked for.
    """
    if nombre is None:
        nombre = len(IDENTITES)
    choisies = []
    for rang in range(nombre):
        role = ROLES[rang % len(ROLES)]
        tour = rang // len(ROLES)
        choisies.append({"identite": role["noms"][tour % len(role["noms"])],
                         "role": role["role"], "court": role["court"],
                         "dire": role["dire"], "motif": role["motif"]})
    return choisies


def identites(nombre=None):
    """The identities to create: [(name, role, reason)], in role order.

    The original form, kept as it stands for everything that needs only those
    three (see identites_detaillees for the rest).
    """
    return [(entree["identite"], entree["role"], entree["motif"])
            for entree in identites_detaillees(nombre)]


def repartir(liste_identites, liste_testeurs):
    """Deals the roles out to the testers, IN ROTATION.

    The 1st role to the 1st tester, the 2nd to the 2nd, then round again. With
    a single tester, everything comes back to them: that is the previous
    behaviour, identically. `liste_identites` comes from identites_detaillees
    (or from identites: the triples are accepted too). Returns [{"rang",
    "identite", "role", "court", "dire", "motif", "testeur", "telephone"}].
    """
    if not liste_testeurs:
        return []
    repartition = []
    for rang, entree in enumerate(liste_identites):
        if not isinstance(entree, dict):
            nom, role, motif = entree
            entree = {"identite": nom, "role": role, "court": role,
                      "dire": "", "motif": motif}
        testeur = liste_testeurs[rang % len(liste_testeurs)]
        part = dict(entree)
        part.update({"rang": rang + 1, "testeur": testeur["nom"],
                     "telephone": testeur["telephone"]})
        repartition.append(part)
    return repartition


def prenom(identite):
    """`Mme Alice Dubreuil` → `Alice`: the first name carries the memory aid.

    It is the one written in the short summaries (`Alice (accepts) → Paul`)
    because it is its initial that recalls the role.
    """
    morceaux = (identite or "").split()
    if len(morceaux) > 1:
        return morceaux[1]
    return morceaux[0] if morceaux else ""


def cout_lisible(nombre):
    """`5 calls, about $0.25` — the announced cost, never guessed."""
    total = f"{nombre * COUT_APPEL_DOLLARS:.2f}".replace(".", ",")
    unite = f"{COUT_APPEL_DOLLARS:.2f}".replace(".", ",")
    return (f"{nombre} appel(s), soit environ {total} $ "
            f"({unite} $ l'appel)")


def resume(preferences=None, nombre=None):
    """Enough to describe the test campaign BEFORE creating it.

    Without preferences, only the identities and roles are described (that is
    what a screen needs when it does not yet know who the testers are). With
    them, the declared testers and the announced distribution are added.
    """
    choisies = identites_detaillees(nombre)
    info = {"identites": len(choisies), "nature": NATURE,
            "roles": [(entree["identite"], entree["role"])
                      for entree in choisies],
            "details": choisies, "cout": cout_lisible(len(choisies)),
            "testeurs": [], "repartition": []}
    if preferences is not None:
        info["testeurs"] = testeurs(preferences)
        info["repartition"] = repartir(choisies, info["testeurs"])
    return info


# ------------------------------------------------- preparing the test
def _places(base, preferences, maintenant, besoin):
    """One time slot per identity — genuinely free ones when we know them.

    Two situations, two honest answers (same spirit as horaires.places_a_proposer):
    - there are enough genuinely free slots (open − already taken − closed days): they are used, in order;
    - there are not enough — either because no opening hours are configured (RingBack then does not know the working hours and does not invent them), or because the calendar is full: the appointments are placed tomorrow morning, hour by hour, and the screen SAYS it is a fallback, naming both possible causes.
    Returns (list of ISO times, fallback?).
    """
    libres = horaires.creneaux_libres(base, preferences, tranches=1,
                                      depuis=maintenant, limite=besoin)
    if len(libres) >= besoin:
        return libres[:besoin], False
    depart = (maintenant + datetime.timedelta(days=JOURS_REPLI)).replace(
        hour=HEURE_REPLI, minute=0, second=0, microsecond=0)
    repli = [(depart + datetime.timedelta(hours=rang)).isoformat(
        timespec="minutes") for rang in range(besoin)]
    return repli, True


def preparer(application, maintenant=None, nombre=None):
    """Prepares the real-conditions test campaign; returns a report.

    What is done, in this order:
    1. the declared TESTERS are read back — without them, nothing is created and we SAY so (EssaiImpossible);
    2. one fictional identity per role is created, marked `jeu d'essai` — hence removable in one go from ⚙ Réglages, like the ordinary sample data set, without ever touching real data. Each identity carries the number of the tester their role falls to (rotating distribution, see repartir);
    3. one appointment per identity, on a genuinely free slot;
    4. an `Appointment confirmation` campaign is created in the READY state, with those contacts. NO CALL IS PLACED: the operator starts it, with their three locks.

    The draft goes through the SAME path as the 3-step assistant
    (application.creer_brouillon_assistant then
    assistant.creer_campagne_prete): the resulting campaign is in every respect
    the one the screen would have produced.

    Returns {"campagne_id", "clients", "rendezvous", "repli", "repartition",
    "testeurs"}.
    """
    from . import assistant           # import tardif : assistant importe db
    base = application.base
    preferences = application.preferences
    liste_testeurs = testeurs(preferences)
    if not liste_testeurs:
        raise EssaiImpossible(
            "Aucun testeur déclaré : renseignez d'abord « 🧪 Testeurs de "
            "l'essai réel » dans ⚙ Réglages (un nom et un numéro, le vôtre "
            "pour commencer), puis revenez ici. Sans au moins un numéro "
            "déclaré, RingBack refuse — à juste titre — plusieurs contacts "
            "portant le même numéro.")
    valides = []
    for rang, testeur in enumerate(liste_testeurs, start=1):
        try:
            valides.append({"nom": testeur["nom"],
                            "telephone": saisie.valider_telephone(
                                testeur["telephone"])})
        except SaisieInvalide as erreur:
            raise EssaiImpossible(
                f"Le numéro du testeur n°{rang} (« {testeur['nom']} ») est "
                f"illisible ({erreur}) — corrigez-le dans ⚙ Réglages : "
                "retirez ce testeur, puis ajoutez-le à nouveau.") from None
    choisies = identites_detaillees(nombre)
    repartition = repartir(choisies, valides)
    if maintenant is None:
        maintenant = datetime.datetime.now()
    maintenant = maintenant.replace(second=0, microsecond=0)
    horaires_choisis, repli = _places(base, preferences, maintenant,
                                      len(choisies))

    clients, rendezvous = 0, 0
    contacts = []
    for part, horaire in zip(repartition, horaires_choisis):
        client_id, cree = _client_essai(base, part["identite"],
                                        part["telephone"])
        clients += 1 if cree else 0
        rdv_id = base.ajouter_rendezvous(client_id, horaire, part["motif"],
                                         statut="prévu")
        rendezvous += 1
        part["horaire"] = horaire
        contacts.append({"nom": part["identite"], "telephone": part["telephone"],
                         "champs": {"rdv_existant": horaire,
                                    "motif": part["motif"]},
                         "rendezvous_id": rdv_id})

    identifiant = application.creer_brouillon_assistant(NATURE)
    brouillon = application.obtenir_brouillon_assistant(identifiant)
    try:
        brouillon["contacts"] = contacts
        # The list is written here, not drawn from a database criterion: it is
        # therefore not reproducible on another slot, and the recipe says so
        # (§8.3) rather than letting the user believe otherwise.
        assistant.noter_apport_recette(brouillon, "essai_reel")
        brouillon["mission"] = assistant.construire_mission(
            NATURE, brouillon["infos"], preferences, brouillon["options"])
        campagne_id = assistant.creer_campagne_prete(base, brouillon,
                                                     preferences)
    finally:
        application.brouillons_assistant.pop(identifiant, None)
    journal.info("Essai en conditions réelles préparé : campagne n°%d PRÊTE, "
                 "%d contact(s) répartis sur %d testeur(s) — aucun appel passé",
                 campagne_id, len(contacts), len(valides))
    return {"campagne_id": campagne_id, "clients": clients,
            "rendezvous": rendezvous, "repli": repli,
            "repartition": repartition, "testeurs": valides}


def _client_essai(base, nom, telephone):
    """The test contact's record (name, number); returns (id, created?).

    Same caution as jeu_essai._obtenir_ou_creer_essai: ONLY records already
    marked `jeu d'essai` are reused. A real client with the same name can
    therefore never be swept up in the removal of the sample data set.
    """
    with base.verrou:
        ligne = base.conn.execute(
            "SELECT id FROM clients WHERE nom = ? AND telephone = ? "
            "AND jeu_essai = 1 ORDER BY id LIMIT 1", (nom, telephone)).fetchone()
    if ligne:
        return ligne["id"], False
    return base.ajouter_client(nom, telephone, jeu_essai=True), True
