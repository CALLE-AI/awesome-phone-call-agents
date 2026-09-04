"""A client's two states, their running campaigns, and `non traité`.

A client carries **two states at once**, which must never be confused (this is
§3 of CAS_DE_FIGURE_CAMPAGNES.md):

- their **calendar state** — what the schedule says: no appointment, appointment scheduled, appointment missed (no-show), appointment cancelled, reschedule pending;
- their **conversation state** — what the last call produced: accepted, confirmed, refused, the client will call back, to be rescheduled, preference to confirm, to contact again, unreachable (N), to be called back by a human, wrong number, no follow-up, 🚫 do not call again, 💤 spared.

Each state says **what remains to be done** and **which campaign handles it**
(the §3 table). Hence the exact definition of `NON TRAITÉ` (unhandled), taken
word for word from the document:

1. their state **calls for an action**;
2. **no running campaign** contains them for that state;
3. they are neither 🚫 excluded nor without a number.

Nothing is invented here: the conversation state comes from the last call
ACTUALLY recorded (a campaign contact, or a direct call attached to an
appointment). The states the product describes but the engine cannot yet
produce (`he tried to reach us`, `appointment request`, `wrong number`) are
flagged `à venir` rather than simulated.
"""

import logging
import unicodedata

from . import assistant, campagnes

journal = logging.getLogger("ringback.etats_clients")

# A campaign `en cours` in the sense of §3: it is neither finished, nor closed,
# nor stopped — so it is still handling its contacts.
STATUTS_CAMPAGNE_EN_COURS = ("prête", "en cours", "en pause")

# Sentinels for the `handling campaign` column of §3.
RELANCE = "relance"  # 🔁 automatic follow-up, same kind as the origin
HUMAIN = "humain"  # ⛔ no campaign: this is human work

# --------------------------------------------------------------- calendar
# states code: (displayed label, badge class)
ETATS_AGENDA = {
    "rendez-vous prévu": ("📅 rendez-vous prévu", "st-prevu"),
    "déplacement en attente": ("📆 déplacement en attente", "st-deplace"),
    "rendez-vous manqué (absent)": ("⚠ absent à son rendez-vous", "st-manque"),
    "rendez-vous annulé": ("✖ rendez-vous annulé", "st-annule"),
    "aucun rendez-vous": ("— aucun rendez-vous", "st-ignore"),
}

# ---------------------------------------------------------- conversation
# states
ETATS_CONVERSATION = {
    "accepté": ("✅ accepté", "st-confirme"),
    "confirmé": ("✅ confirmé", "st-confirme"),
    "refusé": ("❌ refusé", "st-annule"),
    # The client cancelled and did not want to set a date: it is THEY who will
    # get back in touch. They are not chased, no campaign is built for them —
    # but they stay visible and counted here (§3, correction of 31/07/2026).
    # Not to be confused with `à reprogrammer`, just below.
    "le client rappellera": ("📞 le contact rappellera", "st-ignore"),
    "à reprogrammer": ("🔄 à reprogrammer", "st-manque"),
    "préférence à confirmer": ("🕑 préférence à confirmer", "st-manque"),
    "à recontacter": ("🔁 à recontacter", "st-manque"),
    "injoignable": ("📵 injoignable", "st-ignore"),
    # The call DID go out, its result is not known: neither `injoignable`
    # (their phone rang), nor `à recontacter` (calling back would ring twice
    # for nothing). See assistant.ETAT_RESULTAT_INCONNU.
    assistant.ETAT_RESULTAT_INCONNU: ("⏱ appelé, résultat inconnu",
                                      "st-manque"),
    "à rappeler par un humain": ("🙋 à rappeler par un humain", "st-deplace"),
    "sans suite": ("… sans suite", "st-ignore"),
    "ne plus appeler": ("🚫 ne plus appeler", "st-annule"),
    "épargné": ("💤 épargné", "st-confirme"),
    "jamais appelé": ("— jamais appelé", "st-ignore"),
}

# The states the product DESCRIBES but the engine does not yet produce: they
# display as `à venir`, never filled with an invented value.  ⚠ `a cherché à
# nous joindre` was REMOVED on 03/08/2026 along with the `rappel d'appel
# manqué` kind, the only one that handled it. The bench already showed the
# engine never produced it: an announced state nothing could fill and no
# campaign would have served.
ETATS_A_VENIR = {
    "demande de rendez-vous": "🗓 demande de rendez-vous",
    "mauvais numéro": "📛 mauvais numéro",
}

# The states that call for NO automatic action, and WHY. The text is written on
# screen as it stands: without it, `le client rappellera` would be confused
# with `à reprogrammer`, when the two are exactly opposite (who must call
# whom).
SANS_CAMPAGNE = {
    "le client rappellera":
        "rien à faire de notre côté : il a annulé sans fixer de date, "
        "c'est LUI qui reprendra contact. Aucune relance, aucune campagne — "
        "à ne pas confondre avec « à reprogrammer », où c'est NOUS qui "
        "devons le rappeler pour fixer une date.",
    assistant.ETAT_RESULTAT_INCONNU:
        "surtout pas de nouvelle campagne : son téléphone a DÉJÀ sonné et la "
        "conversation a pu avoir lieu — c'est le RÉSULTAT qui manque, pas "
        "l'appel. Allez le chercher avec « 📥 Récupérer les résultats en "
        "attente », sur la fiche de sa campagne : ce geste lit le résultat "
        "chez CALL-E sans composer aucun numéro.",
}

# ------------------------------------------- the handling table (§3) state:
# (what remains to be done, the campaign kinds that handle it)
TRAITEMENT = {
    # -- calendar states
    "rendez-vous prévu": ("le prévenir, ou obtenir un oui ferme",
                          ("rappel_rdv", "confirmation")),
    "rendez-vous manqué (absent)": ("lui refixer un rendez-vous",
                                    ("prise_rdv",)),
    "déplacement en attente": ("lui trouver la nouvelle date",
                               ("deplacement",)),
    # -- conversation states
    "à reprogrammer": ("lui trouver une date", ("prise_rdv",)),
    "préférence à confirmer": ("valider sa préférence, ou proposer mieux",
                               ("prise_rdv",)),
    "à recontacter": ("le recontacter", (RELANCE,)),
    "injoignable": ("retenter l'appel", (RELANCE,)),
    "à rappeler par un humain": ("quelqu'un doit l'appeler", (HUMAIN,)),
    "mauvais numéro": ("corriger sa fiche", (HUMAIN,)),
    "demande de rendez-vous": ("fixer la date", ("prise_rdv",)),
}

# Campaigns from before the assistant: their theme stands in for a kind. The
# `personnalise` theme is no longer listed since 03/08/2026 — its kind was
# removed. A campaign of that theme stays READABLE (assistant.fiche_nature), it
# simply no longer serves to deduce what to do with a client.
NATURE_DEPUIS_THEME = {
    "manque": "prise_rdv",
    "confirmation": "confirmation",
    "deplacement": "deplacement",
    "creneau_libere": "creneau_libere",
}

# Outcome of the last call → conversation state.
ETAT_DEPUIS_ISSUE = {
    "confirmed": "confirmé",
    "accepted": "accepté",
    "rescheduled": "accepté",
    "moved": "accepté",
    "refused": "refusé",
    # A cancellation that was NOT rebooked during the exchange: the appointment
    # no longer exists (its calendar status already says so) and it is the
    # client who will get back in touch. When it IS rebooked during the
    # exchange, the agent returns not `canceled` but `rescheduled`: that is a
    # plain move, and it follows the reschedule path.
    "canceled": "le client rappellera",
    "to_reschedule": "à reprogrammer",
    "no_answer": "injoignable",
    "echec": "à recontacter",
}

# Campaign contact state → conversation state (when there is no outcome).
ETAT_DEPUIS_CONTACT = {
    "accepté": "accepté",
    "abouti": "accepté",
    "refusé": "refusé",
    "à recontacter": "à recontacter",
    "injoignable": "injoignable",
    assistant.ETAT_RESULTAT_INCONNU: assistant.ETAT_RESULTAT_INCONNU,
    "à rappeler par un humain": "à rappeler par un humain",
    "le client rappellera": "le client rappellera",
    "épargné": "épargné",
    "exclu": "ne plus appeler",
    "abandonné": "sans suite",
}

# Appointment statuses that make the calendar state, by order of PRIORITY: an
# upcoming appointment beats a missed one, which beats a cancelled one.
_PRIORITE_AGENDA = (
    ("prévu", "rendez-vous prévu"),
    ("confirmé", "rendez-vous prévu"),
    ("déplacé", "déplacement en attente"),
    ("manqué", "rendez-vous manqué (absent)"),
    ("annulé", "rendez-vous annulé"),
)


def libelle_agenda(code):
    """The displayed label of a calendar state (the code itself failing that).
    """
    return ETATS_AGENDA.get(code, (code, "st-ignore"))[0]


def libelle_conversation(code, tentatives=0):
    """The label of a conversation state — `injoignable (3)` included."""
    libelle = ETATS_CONVERSATION.get(code, (code, "st-ignore"))[0]
    if code == "injoignable" and tentatives:
        libelle += f" ({tentatives})"
    return libelle


def classe(code):
    """The badge class of a state, calendar or conversation."""
    if code in ETATS_AGENDA:
        return ETATS_AGENDA[code][1]
    return ETATS_CONVERSATION.get(code, ("", "st-ignore"))[1]


def nature_de(campagne):
    """A campaign's kind — its theme stands in for it on the older ones."""
    return (campagne.get("nature")
            or NATURE_DEPUIS_THEME.get(campagne.get("theme"), ""))


def libelle_nature(nature):
    """`🗓 Prise de rendez-vous` — the readable name of a kind.

    Goes through `fiche_nature` and not through `NATURES`: a campaign of a
    REMOVED kind keeps its name on screen. A campaign that can no longer be
    named would be lost data.
    """
    fiche = assistant.fiche_nature(nature)
    if fiche:
        return f"{fiche['icone']} {fiche['nom']}"
    return nature or "—"


def etat_agenda(resume):
    """The calendar state deduced from the client's appointments (§3, family A).
    """
    if not resume or not resume.get("total"):
        return "aucun rendez-vous"
    statuts = resume.get("statuts", {})
    # `prévu` only means `rendez-vous prévu` when one is still UPCOMING: the
    # missed-appointment rule has already switched the others over.
    for statut, code in _PRIORITE_AGENDA:
        if statuts.get(statut):
            if code == "rendez-vous prévu" and resume.get("prochain") is None:
                continue
            return code
    return "aucun rendez-vous"


def etat_conversation(client, contacts, appel_direct, resume):
    """The conversation state: what the LAST real call produced.

    Reading order: the 🚫 flag first (it overrides everything), then the most
    recent campaign contact, then the direct call attached to an appointment,
    then — failing any call at all — the call-back preference noted at data
    entry. Returns (code, attempts).
    """
    if client.get("ne_plus_appeler"):
        return "ne plus appeler", 0
    contact = _dernier_contact_appele(contacts)
    if contact is not None:
        tentatives = contact.get("tentatives") or 0
        code = ETAT_DEPUIS_ISSUE.get(contact.get("issue"))
        if code is None:
            code = ETAT_DEPUIS_CONTACT.get(contact.get("etat"))
        if code is not None:
            return code, tentatives
    if appel_direct:
        code = ETAT_DEPUIS_ISSUE.get(appel_direct.get("issue"))
        if code is None and appel_direct.get("statut") == "échec":
            code = "à recontacter"
        if code is not None:
            return code, 1
    if resume and resume.get("rappel_souhaite"):
        # The client said WHEN they wanted to be called back: their preference
        # is waiting to be confirmed — that really is a state, not an
        # invention.
        return "préférence à confirmer", 0
    return "jamais appelé", 0


def _dernier_contact_appele(contacts):
    """The most recent campaign contact that was ACTUALLY handled."""
    retenu = None
    for contact in contacts or ():
        if contact.get("etat") in ("à appeler", "en cours") and not contact.get("issue"):
            continue
        if retenu is None or contact["id"] > retenu["id"]:
            retenu = contact
    return retenu


def besoins(agenda, conversation, tentatives, plafond):
    """What the client's two states CALL FOR as an action (§3).

    Returns [{"etat", "famille", "action", "natures"}]. An empty `natures`
    means `no campaign handles this`: it is human work, and it is said as such
    on screen (§6). An unreachable contact AT THE CEILING of follow-ups tips
    precisely from automatic follow-up to human.
    """
    liste = []
    for code, famille in ((agenda, "agenda"), (conversation, "conversation")):
        if code not in TRAITEMENT:
            continue
        action, natures = TRAITEMENT[code]
        if code == "injoignable" and plafond and tentatives >= plafond:
            action = ("un autre moyen, ou un appel humain — le maximum de "
                      f"{plafond} rappel(s) est atteint")
            natures = (HUMAIN,)
        liste.append({"etat": code, "famille": famille, "action": action,
                      "natures": tuple(natures)})
    return liste


def fiche_client(client, resume, contacts, appel_direct, plafond,
                 campagnes_ignorees=()):
    """The complete file of ONE client: both states, their campaigns, their needs.

    `campagnes_ignorees` serves ONE case only, and a precise one: replaying the
    recipe of a campaign born from a state filter (§8.3). The criterion had
    been evaluated BEFORE that campaign existed; counting it would forbid its
    own recipe from finding anyone at all. On screen this list is always empty
    — nothing is ever hidden in it.
    """
    agenda = etat_agenda(resume)
    conversation, tentatives = etat_conversation(client, contacts, appel_direct,
                                                 resume)
    ignorees = set(campagnes_ignorees or ())
    en_cours = [contact for contact in contacts or ()
                if contact.get("campagne_statut") in STATUTS_CAMPAGNE_EN_COURS
                and contact.get("campagne_id") not in ignorees]
    relance_prevue = any((contact.get("relances_planifiees") or 0) > 0
                         for contact in contacts or ())
    attendus = besoins(agenda, conversation, tentatives, plafond)
    # Which running campaign handles which need — that is condition 2.
    for besoin in attendus:
        traite_par, vues = [], set()
        for contact in en_cours:
            if (nature_de(contact) in besoin["natures"]
                    and contact["campagne_id"] not in vues):
                vues.add(contact["campagne_id"])
                traite_par.append(contact)
        if RELANCE in besoin["natures"] and relance_prevue:
            traite_par.append({"campagne_nom": "🔁 relance programmée",
                               "campagne_id": None})
        besoin["traite_par"] = traite_par
        besoin["traite"] = bool(traite_par)
        besoin["humain"] = besoin["natures"] == (HUMAIN,)
    # The state that made the client ENTER each running campaign. A campaign
    # appears only ONCE, even when it contains them twice (two pasted lines for
    # the same person).
    campagnes_lisibles, deja_vues = [], set()
    for contact in en_cours:
        if contact["campagne_id"] in deja_vues:
            continue
        deja_vues.add(contact["campagne_id"])
        nature = nature_de(contact)
        entree = [besoin["etat"] for besoin in attendus
                  if nature in besoin["natures"]]
        campagnes_lisibles.append({
            "campagne_id": contact["campagne_id"],
            "nom": contact["campagne_nom"],
            "statut": contact["campagne_statut"],
            "nature": nature,
            "nature_lisible": libelle_nature(nature),
            "etat_contact": contact.get("etat"),
            "etat_entree": entree[0] if entree else None,
        })
    sans_numero = not (client.get("telephone_masque") or "").strip()
    exclu = bool(client.get("ne_plus_appeler"))
    non_traite = (not exclu and not sans_numero
                  and any(not besoin["traite"] for besoin in attendus))
    # The written explanation when a state leads to NO campaign: `nothing to
    # do` with no reason would look like an oversight.
    sans_campagne = SANS_CAMPAGNE.get(conversation) or SANS_CAMPAGNE.get(agenda)
    return {
        "client": client,
        "agenda": agenda,
        "conversation": conversation,
        "tentatives": tentatives,
        "resume": resume or {"total": 0, "statuts": {}, "prochain": None,
                             "dernier": None, "rappel_souhaite": None},
        "campagnes": campagnes_lisibles,
        "besoins": attendus,
        "non_traite": non_traite,
        "sans_campagne": sans_campagne,
        "sans_numero": sans_numero,
        "exclu": exclu,
        "humain": any(besoin["humain"] for besoin in attendus),
    }


def tableau_clients(base, preferences=None, maintenant=None,
                    campagnes_ignorees=()):
    """EVERY client with both their states — a single pass over the database.

    This is the single source of the 👥 Contacts page: list, filters, counters.
    `campagnes_ignorees`: see `fiche_client` — empty everywhere except when
    replaying a state recipe.
    """
    plafond = 0
    if preferences is not None:
        plafond = campagnes.parametres_relance(preferences)[1]
    resumes = base.etat_rendezvous_par_client(maintenant=maintenant)
    contacts = base.contacts_campagne_par_client()
    directs = base.dernier_appel_direct_par_client()
    return [fiche_client(client, resumes.get(client["id"]),
                         contacts.get(client["id"], []),
                         directs.get(client["id"]), plafond,
                         campagnes_ignorees)
            for client in base.lister_clients()]


def _correspond(fiche, cherche, ids_numero):
    """Does the record answer the free-text search — by name or by number?

    ⚠ `OR`, NOT `AND`: you type what you remember. Requiring both would never
    have found anything.
    """
    if cherche and cherche in _sans_accents(fiche["client"]["nom"]):
        return True
    return fiche["client"]["id"] in ids_numero


def _sans_accents(texte):
    """`Lefèvre` becomes `lefevre`: searching for a name must not require typing
    the accents (nor the right case).
    """
    decompose = unicodedata.normalize("NFD", (texte or "").casefold())
    return "".join(c for c in decompose if not unicodedata.combining(c))


# ------------------------------------------- §4: from the state towards THE
# CAMPAIGN `A campaign is always created from what is missing` (§1). Here, what
# is missing is A TIME for a person who is waiting: the door is 👥. The kind is
# therefore never chosen by hand, it is DEDUCED from the filtered state,
# through the TRAITEMENT table above — never through a second table.


def besoins_non_traites(fiche, etat=""):
    """THIS client's needs that no running campaign takes on (§3).

    This is the exact definition of `non traité`, seen client by client: their
    state calls for an action, no running campaign contains them for that
    state, they are neither 🚫 excluded nor without a number. `etat` restricts
    to the single state filtered on screen — otherwise it would be a different
    need being counted.
    """
    if fiche["exclu"] or fiche["sans_numero"]:
        return []
    return [besoin for besoin in fiche["besoins"]
            if not besoin["traite"] and (not etat or besoin["etat"] == etat)]


def natures_a_proposer(fiches, etat=""):
    """THE creation BUTTONS of §4: one entry per campaign kind.

    Owner's decision (31/07/2026): when the selection mixes states handled by
    DIFFERENT campaigns, **one button per kind** is shown, each with its own
    count — never a greyed-out button leaving the user to guess. One state can
    in fact call for two kinds on its own (`rendez-vous prévu` → 🔔 reminder OR
    ✅ confirmation).

    The RELANCE and HUMAIN sentinels are not campaign kinds: they give no
    button (see `etats_sans_campagne`, which says why on screen rather than
    leaving a blank).

    Returns [{"nature", "libelle", "etats", "clients"}], the largest count
    first — on a tie, the order of the kind catalogue, so that two successive
    displays never contradict each other.
    """
    par_nature = {}
    for fiche in fiches:
        deja = set()
        for besoin in besoins_non_traites(fiche, etat):
            for nature in besoin["natures"]:
                if nature not in assistant.NATURES:
                    continue        # 🔁 relance ou 🙋 humain : aucun bouton
                entree = par_nature.setdefault(nature, {
                    "nature": nature, "libelle": libelle_nature(nature),
                    "etats": [], "clients": []})
                if besoin["etat"] not in entree["etats"]:
                    entree["etats"].append(besoin["etat"])
                if nature not in deja:
                    deja.add(nature)
                    entree["clients"].append(fiche)
    rang = list(assistant.NATURES)
    return sorted(par_nature.values(),
                  key=lambda e: (-len(e["clients"]), rang.index(e["nature"])))


def etats_sans_campagne(fiches, etat=""):
    """The states in the selection that NO campaign handles, and WHY (§6).

    `To be said plainly on screen rather than letting people believe the robot
    is taking care of it`: a state that gives no button must say why, otherwise
    the absence of a button looks like an oversight. Returns [{"etat",
    "libelle", "raison", "clients"}].
    """
    RAISONS = {
        HUMAIN: "aucune campagne ne traite cela : quelqu'un doit s'en "
                "charger — c'est la corbeille d'entrée de l'humain",
        RELANCE: "rien à créer : la relance reprend la nature de la "
                 "campagne d'origine, et se lance depuis 🔁 Relances",
    }
    par_etat = {}
    for fiche in fiches:
        for besoin in besoins_non_traites(fiche, etat):
            if any(nature in assistant.NATURES for nature in besoin["natures"]):
                continue
            raison = next((RAISONS[nature] for nature in besoin["natures"]
                           if nature in RAISONS), None)
            if raison is None:
                continue
            entree = par_etat.setdefault(besoin["etat"], {
                "etat": besoin["etat"],
                "libelle": (libelle_agenda(besoin["etat"])
                            if besoin["famille"] == "agenda"
                            else libelle_conversation(besoin["etat"])),
                "raison": raison, "clients": 0})
            entree["clients"] += 1
    return sorted(par_etat.values(), key=lambda e: (-e["clients"], e["etat"]))


def _campagnes_du_meme_critere(base, critere):
    """The campaigns ALREADY born of THIS criterion — they do not block each
    other.

    Without this, a campaign born of a state filter would forbid its own recipe
    from being replayed: the clients it holds would no longer be `non traités`,
    and the cascade would stop at the first link. Yet the criterion had been
    evaluated BEFORE that campaign existed — replaying it means placing
    yourself back in the same conditions (§8.3).

    A campaign born of ANOTHER criterion counts normally: someone another
    campaign is already calling is not put back into a list.
    """
    ignorees = set()
    for campagne in base.lister_campagnes():
        configuration = assistant.configuration_campagne(campagne)
        for apport in (configuration.get("recette") or {}).get("apports", []):
            if apport.get("mode") != "etat":
                continue
            if (apport.get("etat", ""), apport.get("nature", ""),
                    apport.get("recherche", "")) == critere:
                ignorees.add(campagne["id"])
    return ignorees


def contacts_par_etat(base, etat, champs, telephones_connus=(),
                      preferences=None):
    """EVERY client in this state — with no further condition. Returns (contacts,
    extras).

    ⚠ THIS IS NOT `contacts_depuis_etat`, and that is deliberate. The latter
    serves the 👥 Contacts page, where the state made the kind be CHOSEN: it
    therefore keeps only the clients no campaign already covers, and that the
    chosen kind knows how to handle. Two conditions that are perfectly right
    over there, and incomprehensible here: when you ask `load me the clients
    who have an appointment scheduled`, you want those clients.

    Observed by the owner on 02/08/2026: `0 contacts added… this state is not
    handled by Freed slot` — a refusal with no reason to exist, since a
    freed-slot campaign is aimed precisely at people who already have an
    appointment.

    What stays excluded, and counted: those without a number, and duplicates.
    What is FLAGGED without being excluded: the clients another campaign
    already handles — the information is useful, the decision belongs to the
    operator.
    """
    if etat and etat not in TRAITEMENT:
        raise assistant.SaisieInvalide(
            f"L'état « {etat} » n'appelle aucune campagne.")
    codes = {champ["code"] for champ in champs}
    fiches = filtrer(tableau_clients(base, preferences), "", etat)
    contacts, complements = [], []
    deja_vus = set(telephones_connus)
    sans_numero = doublons = deja_traites = 0
    for fiche in fiches:
        telephone = base.telephone_de(fiche["client"]["id"]) or ""
        if not telephone:
            sans_numero += 1
            continue
        if telephone in deja_vus:
            doublons += 1
            continue
        deja_vus.add(telephone)
        if any(besoin.get("traite") for besoin in fiche.get("besoins", ())):
            deja_traites += 1
        rdv = (fiche["resume"].get("prochain")
               or fiche["resume"].get("dernier"))
        valeurs = {}
        if rdv:
            if "rdv_existant" in codes:
                valeurs["rdv_existant"] = rdv["horaire"]
            if "motif" in codes:
                valeurs["motif"] = rdv["motif"]
        contacts.append({"nom": fiche["client"]["nom"], "telephone": telephone,
                         "champs": valeurs,
                         "rendezvous_id": rdv["id"] if rdv else None})
    if sans_numero:
        complements.append(f"{sans_numero} client(s) sans numéro écarté(s)")
    if doublons:
        complements.append(f"{doublons} déjà dans la grille, non redoublé(s)")
    if deja_traites:
        complements.append(f"{deja_traites} déjà suivi(s) par une autre "
                           "campagne, repris quand même")
    if not contacts and not fiches:
        libelle = libelle_etat(etat) if etat else "à traiter"
        complements.append(f"aucun client n'est dans l'état « {libelle} »")
    return contacts, complements


def contacts_depuis_etat(base, etat, nature, champs, telephones_connus=(),
                         recherche="", preferences=None):
    """THE `etat` RECIPE: replays the 👥 Contacts filter that built the list.

    Same mechanism as `assistant.contacts_depuis_base`: returns (contacts,
    extras). The list is never copied — it is RECOMPUTED from the criterion
    (filtered state + `non traité` + the kind that handles it, plus the name
    search if one was used). That is what lets a campaign born of a state
    filter be replayed on another slot (§8.3, the cascade).

    The number is read IN CLEAR here — as in every list build explicitly
    requested by the user — and is never displayed.
    """
    if nature not in assistant.NATURES:
        raise assistant.SaisieInvalide(
            f"Nature de campagne inconnue : « {nature} ».")
    if etat and etat not in TRAITEMENT:
        raise assistant.SaisieInvalide(
            f"L'état « {etat} » n'appelle aucune campagne.")
    codes = {champ["code"] for champ in champs}
    critere = (etat, nature, recherche)
    toutes = tableau_clients(base, preferences,
                             campagnes_ignorees=_campagnes_du_meme_critere(
                                 base, critere))
    fiches = filtrer(toutes, recherche, etat, non_traite=True)
    contacts, complements = [], []
    deja_vus = set(telephones_connus)
    sans_numero = doublons = hors_nature = 0
    for fiche in fiches:
        if not any(nature in besoin["natures"]
                   for besoin in besoins_non_traites(fiche, etat)):
            hors_nature += 1
            continue
        telephone = base.telephone_de(fiche["client"]["id"]) or ""
        if not telephone:
            sans_numero += 1
            continue
        if telephone in deja_vus:
            doublons += 1
            continue
        deja_vus.add(telephone)
        # The appointment that carries the context: the upcoming one (if there
        # is one), otherwise the last past one. Nothing is invented — when
        # there is none, the columns stay empty, visible and to be filled in.
        rdv = (fiche["resume"].get("prochain")
               or fiche["resume"].get("dernier"))
        valeurs = {}
        if rdv:
            if "rdv_existant" in codes:
                valeurs["rdv_existant"] = rdv["horaire"]
            if "motif" in codes:
                valeurs["motif"] = rdv["motif"]
        contacts.append({"nom": fiche["client"]["nom"], "telephone": telephone,
                         "champs": valeurs,
                         "rendezvous_id": rdv["id"] if rdv else None})
    if sans_numero:
        complements.append(f"{sans_numero} client(s) sans numéro écarté(s)")
    if doublons:
        complements.append(f"{doublons} déjà dans la grille, non redoublé(s)")
    # ⚠ SAY WHY WHEN THERE IS NOBODY. Three very different causes produced
    # exactly the same empty screen, and the owner saw it on 02/08/2026: his
    # contact did have an appointment scheduled, but a campaign was already
    # handling them — nothing said so.
    if not contacts:
        complements.extend(_pourquoi_personne(toutes, fiches, etat, nature,
                                              recherche, hors_nature))
    return contacts, complements


def _pourquoi_personne(toutes, retenues, etat, nature, recherche, hors_nature):
    """The reasons for the zero, in French, figures drawn from the database.

    A silent `0 contacts` makes people think something is broken. Here a
    distinction is made: ① nobody is in that state; ② people are, but campaigns
    are ALREADY handling them — they are counted and the blocking campaigns are
    named; ③ people are there and free, but the kind chosen at step 1 does not
    handle that state.
    """
    libelle = libelle_etat(etat) if etat else "à traiter"
    # Without the `non traité` filter: how many really are in that state.
    dans_l_etat = filtrer(toutes, recherche, etat, non_traite=False)
    if not dans_l_etat:
        return [f"aucun client n'est dans l'état « {libelle} »"]
    if hors_nature:
        return [f"{hors_nature} client(s) sont dans l'état « {libelle} » mais "
                f"cet état ne se traite pas par « {libelle_nature(nature)} » — "
                "changez de nature à l'étape 1"]
    pris = len(dans_l_etat) - len(retenues)
    if pris <= 0:
        return [f"aucun client « {libelle} » ne reste à traiter"]
    noms = _campagnes_qui_bloquent(dans_l_etat, etat)
    phrase = (f"{pris} client(s) « {libelle} » sont déjà pris en charge par "
              "une campagne en cours, et ne sont donc pas repris ici")
    if noms:
        phrase += " (" + ", ".join(noms) + ")"
    return [phrase]


def _campagnes_qui_bloquent(fiches, etat, combien=3):
    """The names of the campaigns already covering this state (three at most).

    Naming the campaign heads off the next question (`which one?`) and lets the
    user go and close it or resume it. Beyond three it is abbreviated: the
    complete list is on the 👥 Contacts page, column `Campagnes en cours`.
    """
    noms = []
    for fiche in fiches:
        for besoin in fiche.get("besoins", ()):
            if etat and besoin.get("etat") != etat:
                continue
            for entree in besoin.get("traite_par", ()):
                nom = entree.get("campagne_nom") or entree.get("nom")
                if nom and nom not in noms:
                    noms.append(nom)
    if len(noms) > combien:
        return noms[:combien] + ["…"]
    return noms


def libelle_etat(code):
    """The label of a state, whatever its family (calendar or conversation)."""
    if code in ETATS_AGENDA:
        return libelle_agenda(code)
    return libelle_conversation(code)


def filtrer(fiches, recherche="", etat="", non_traite=False,
            interdit=False, ids_numero=None):
    """The Contacts page filters, applied in this order.

    recherche : on the name, ignoring case and accents; ids_numero: the
    identifiers the DATABASE recognised from the number (see
    `db.clients_par_chiffres`). The search means `name OR number`; etat : a
    state code, calendar OR conversation; non_traite: the exact definition of
    §3 — and, when a state is filtered, it is THAT state which must be left
    without a campaign (not another); interdit : keep only the 🚫 `ne plus
    appeler` contacts.

    ⚠ THE NUMBER IS NOT COMPARED HERE. The records carry only the mask: the
    display layer has never seen the real number, and a search is not going to
    let it in. The database returns IDENTIFIERS; all we do is recognise them.
    """
    brut = (recherche or "").strip()
    cherche = _sans_accents(brut)
    ids_numero = ids_numero or set()
    resultat = []
    for fiche in fiches:
        if interdit and not fiche["client"]["ne_plus_appeler"]:
            continue
        if brut and not _correspond(fiche, cherche, ids_numero):
            continue
        if etat and etat not in (fiche["agenda"], fiche["conversation"]):
            continue
        if non_traite:
            if fiche["exclu"] or fiche["sans_numero"]:
                continue
            concernes = [besoin for besoin in fiche["besoins"]
                         if not etat or besoin["etat"] == etat]
            if not concernes or all(besoin["traite"] for besoin in concernes):
                continue
        resultat.append(fiche)
    return resultat
