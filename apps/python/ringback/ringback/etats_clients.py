"""Les deux états d'un client, ses campagnes en cours, et « non traité ».

Un client porte **deux états à la fois**, qu'il ne faut jamais confondre
(c'est le §3 de CAS_DE_FIGURE_CAMPAGNES.md) :

- son **état d'agenda** — ce que dit le planning : aucun rendez-vous,
  rendez-vous prévu, rendez-vous manqué (absent), rendez-vous annulé,
  déplacement en attente ;
- son **état de conversation** — ce que le dernier appel a produit :
  accepté, confirmé, refusé, le client rappellera, à reprogrammer,
  préférence à confirmer, à recontacter, injoignable (N), à rappeler par un
  humain, mauvais numéro, sans suite, 🚫 ne plus appeler, 💤 épargné.

Chaque état dit **ce qu'il reste à faire** et **quelle campagne le traite**
(table du §3). D'où la définition exacte de « NON TRAITÉ », reprise mot pour
mot du document :

1. son état **appelle une action** ;
2. **aucune campagne en cours** ne le contient pour cet état ;
3. il n'est ni 🚫 exclu, ni sans numéro.

Rien n'est inventé ici : l'état de conversation vient du dernier appel
RÉELLEMENT enregistré (contact de campagne, ou appel direct rattaché à un
rendez-vous). Les états que le produit décrit mais que le moteur ne sait pas
encore produire (« il a cherché à nous joindre », « demande de rendez-vous »,
« mauvais numéro ») sont signalés « à venir » plutôt que simulés.
"""

import logging
import unicodedata

from . import assistant, campagnes

journal = logging.getLogger("ringback.etats_clients")

# Une campagne « en cours » au sens du §3 : elle n'est ni terminée, ni close,
# ni arrêtée — donc elle traite encore ses contacts.
STATUTS_CAMPAGNE_EN_COURS = ("prête", "en cours", "en pause")

# Sentinelles de la colonne « campagne qui traite » du §3.
RELANCE = "relance"        # 🔁 relance automatique, même nature que l'origine
HUMAIN = "humain"          # ⛔ aucune campagne : c'est du travail humain

# --------------------------------------------------------------- états d'agenda
# code : (libellé affiché, classe de pastille)
ETATS_AGENDA = {
    "rendez-vous prévu": ("📅 rendez-vous prévu", "st-prevu"),
    "déplacement en attente": ("📆 déplacement en attente", "st-deplace"),
    "rendez-vous manqué (absent)": ("⚠ absent à son rendez-vous", "st-manque"),
    "rendez-vous annulé": ("✖ rendez-vous annulé", "st-annule"),
    "aucun rendez-vous": ("— aucun rendez-vous", "st-ignore"),
}

# ---------------------------------------------------------- états de conversation
ETATS_CONVERSATION = {
    "accepté": ("✅ accepté", "st-confirme"),
    "confirmé": ("✅ confirmé", "st-confirme"),
    "refusé": ("❌ refusé", "st-annule"),
    # Le client a annulé et n'a pas voulu fixer de date : c'est LUI qui
    # reprendra contact. On ne le relance pas, on ne monte aucune campagne
    # pour lui — mais il reste visible et compté ici (§3, correction du
    # 31/07/2026). À ne pas confondre avec « à reprogrammer », juste dessous.
    "le client rappellera": ("📞 le contact rappellera", "st-ignore"),
    "à reprogrammer": ("🔄 à reprogrammer", "st-manque"),
    "préférence à confirmer": ("🕑 préférence à confirmer", "st-manque"),
    "à recontacter": ("🔁 à recontacter", "st-manque"),
    "injoignable": ("📵 injoignable", "st-ignore"),
    # L'appel EST parti, son résultat n'est pas connu : ni « injoignable »
    # (son téléphone a sonné), ni « à recontacter » (le rappeler ferait
    # sonner deux fois pour rien). Voir assistant.ETAT_RESULTAT_INCONNU.
    assistant.ETAT_RESULTAT_INCONNU: ("⏱ appelé, résultat inconnu",
                                      "st-manque"),
    "à rappeler par un humain": ("🙋 à rappeler par un humain", "st-deplace"),
    "sans suite": ("… sans suite", "st-ignore"),
    "ne plus appeler": ("🚫 ne plus appeler", "st-annule"),
    "épargné": ("💤 épargné", "st-confirme"),
    "jamais appelé": ("— jamais appelé", "st-ignore"),
}

# Les états que le produit DÉCRIT mais que le moteur ne produit pas encore :
# ils s'affichent « à venir », jamais remplis d'une valeur inventée.
#
# ⚠ « a cherché à nous joindre » a été RETIRÉ le 03/08/2026 avec la nature
# « rappel d'appel manqué », la seule qui le traitait. Le banc d'essai
# constatait déjà que le moteur ne le produisait jamais : c'était un état
# annoncé que rien ne pouvait remplir et qu'aucune campagne n'aurait servi.
ETATS_A_VENIR = {
    "demande de rendez-vous": "🗓 demande de rendez-vous",
    "mauvais numéro": "📛 mauvais numéro",
}

# Les états qui n'appellent AUCUNE action automatique, et POURQUOI. Le texte
# est écrit tel quel à l'écran : sans lui, « le client rappellera » se
# confondrait avec « à reprogrammer », alors que les deux sont exactement
# inverses (qui doit rappeler qui).
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

# ------------------------------------------- la table de traitement (§3)
# état : (ce qu'il reste à faire, les natures de campagne qui le traitent)
TRAITEMENT = {
    # -- états d'agenda
    "rendez-vous prévu": ("le prévenir, ou obtenir un oui ferme",
                          ("rappel_rdv", "confirmation")),
    "rendez-vous manqué (absent)": ("lui refixer un rendez-vous",
                                    ("prise_rdv",)),
    "déplacement en attente": ("lui trouver la nouvelle date",
                               ("deplacement",)),
    # -- états de conversation
    "à reprogrammer": ("lui trouver une date", ("prise_rdv",)),
    "préférence à confirmer": ("valider sa préférence, ou proposer mieux",
                               ("prise_rdv",)),
    "à recontacter": ("le recontacter", (RELANCE,)),
    "injoignable": ("retenter l'appel", (RELANCE,)),
    "à rappeler par un humain": ("quelqu'un doit l'appeler", (HUMAIN,)),
    "mauvais numéro": ("corriger sa fiche", (HUMAIN,)),
    "demande de rendez-vous": ("fixer la date", ("prise_rdv",)),
}

# Campagnes d'avant l'assistant : leur thème tient lieu de nature. Le thème
# « personnalise » n'y figure plus depuis le 03/08/2026 — sa nature a été
# retirée. Une campagne de ce thème reste LISIBLE (assistant.fiche_nature),
# elle ne sert simplement plus à déduire quoi faire d'un client.
NATURE_DEPUIS_THEME = {
    "manque": "prise_rdv",
    "confirmation": "confirmation",
    "deplacement": "deplacement",
    "creneau_libere": "creneau_libere",
}

# Issue du dernier appel → état de conversation.
ETAT_DEPUIS_ISSUE = {
    "confirmed": "confirmé",
    "accepted": "accepté",
    "rescheduled": "accepté",
    "moved": "accepté",
    "refused": "refusé",
    # Une annulation qui n'a PAS été replacée pendant l'échange : le
    # rendez-vous n'existe plus (son statut d'agenda le dit déjà) et c'est
    # le client qui reprendra contact. Quand elle EST replacée pendant
    # l'échange, l'agent ne rend pas « canceled » mais « rescheduled » :
    # c'est un simple déplacement, et il suit le chemin du déplacement.
    "canceled": "le client rappellera",
    "to_reschedule": "à reprogrammer",
    "no_answer": "injoignable",
    "echec": "à recontacter",
}

# État du contact de campagne → état de conversation (quand aucune issue).
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

# Statuts de rendez-vous qui font l'état d'agenda, par ordre de PRIORITÉ :
# un rendez-vous à venir prime sur un manqué, qui prime sur un annulé.
_PRIORITE_AGENDA = (
    ("prévu", "rendez-vous prévu"),
    ("confirmé", "rendez-vous prévu"),
    ("déplacé", "déplacement en attente"),
    ("manqué", "rendez-vous manqué (absent)"),
    ("annulé", "rendez-vous annulé"),
)


def libelle_agenda(code):
    """Le libellé affiché d'un état d'agenda (le code lui-même à défaut)."""
    return ETATS_AGENDA.get(code, (code, "st-ignore"))[0]


def libelle_conversation(code, tentatives=0):
    """Le libellé d'un état de conversation — « injoignable (3) » compris."""
    libelle = ETATS_CONVERSATION.get(code, (code, "st-ignore"))[0]
    if code == "injoignable" and tentatives:
        libelle += f" ({tentatives})"
    return libelle


def classe(code):
    """La classe de pastille d'un état, d'agenda ou de conversation."""
    if code in ETATS_AGENDA:
        return ETATS_AGENDA[code][1]
    return ETATS_CONVERSATION.get(code, ("", "st-ignore"))[1]


def nature_de(campagne):
    """La nature d'une campagne — son thème en tient lieu pour les anciennes."""
    return (campagne.get("nature")
            or NATURE_DEPUIS_THEME.get(campagne.get("theme"), ""))


def libelle_nature(nature):
    """« 🗓 Prise de rendez-vous » — le nom lisible d'une nature.

    Passe par `fiche_nature` et non par `NATURES` : une campagne d'une
    nature RETIRÉE garde son nom à l'écran. Une campagne qu'on ne sait plus
    nommer serait une donnée perdue.
    """
    fiche = assistant.fiche_nature(nature)
    if fiche:
        return f"{fiche['icone']} {fiche['nom']}"
    return nature or "—"


def etat_agenda(resume):
    """L'état d'agenda déduit des rendez-vous du client (§3, famille A)."""
    if not resume or not resume.get("total"):
        return "aucun rendez-vous"
    statuts = resume.get("statuts", {})
    # « prévu » ne vaut « rendez-vous prévu » que s'il en reste un À VENIR :
    # la règle du manqué a déjà basculé les autres.
    for statut, code in _PRIORITE_AGENDA:
        if statuts.get(statut):
            if code == "rendez-vous prévu" and resume.get("prochain") is None:
                continue
            return code
    return "aucun rendez-vous"


def etat_conversation(client, contacts, appel_direct, resume):
    """L'état de conversation : ce que le DERNIER appel réel a produit.

    Ordre de lecture : le drapeau 🚫 d'abord (il prime sur tout), puis le
    contact de campagne le plus récent, puis l'appel direct rattaché à un
    rendez-vous, puis — à défaut de tout appel — la préférence de rappel
    notée à la saisie. Rend (code, tentatives).
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
        # Le client a dit QUAND il voulait être rappelé : sa préférence
        # attend d'être validée — c'est bien un état, pas une invention.
        return "préférence à confirmer", 0
    return "jamais appelé", 0


def _dernier_contact_appele(contacts):
    """Le contact de campagne le plus récent qui a VRAIMENT été traité."""
    retenu = None
    for contact in contacts or ():
        if contact.get("etat") in ("à appeler", "en cours") and not contact.get("issue"):
            continue
        if retenu is None or contact["id"] > retenu["id"]:
            retenu = contact
    return retenu


def besoins(agenda, conversation, tentatives, plafond):
    """Ce que les deux états du client APPELLENT comme action (§3).

    Rend [{"etat", "famille", "action", "natures"}]. `natures` vide veut
    dire « aucune campagne ne traite cela » : c'est du travail humain, et
    c'est dit tel quel à l'écran (§6). Un injoignable AU PLAFOND de relances
    bascule justement de la relance automatique vers l'humain.
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
    """Le dossier complet d'UN client : ses deux états, ses campagnes, ses besoins.

    `campagnes_ignorees` sert à UN seul cas, et il est précis : rejouer la
    recette d'une campagne née d'un filtre d'état (§8.3). Le critère avait
    été évalué AVANT que cette campagne existe ; si on la comptait, elle
    interdirait à sa propre recette de retrouver qui que ce soit. À l'écran,
    cette liste est toujours vide — rien n'y est jamais caché.
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
    # Quelle campagne en cours traite quel besoin — c'est la condition 2.
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
    # L'état qui a fait ENTRER le client dans chaque campagne en cours.
    # Une campagne n'apparaît qu'UNE fois, même si elle le contient deux
    # fois (deux lignes collées pour la même personne).
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
    # L'explication écrite quand l'état ne débouche sur AUCUNE campagne :
    # « rien à faire » sans raison ressemblerait à un oubli.
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
    """TOUS les clients avec leurs deux états — une seule passe sur la base.

    C'est la source unique de la page 👥 Contacts : liste, filtres, compteurs.
    `campagnes_ignorees` : voir `fiche_client` — vide partout sauf au rejeu
    d'une recette d'état.
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
    """La fiche répond-elle à la recherche libre — par le nom ou le numéro ?

    ⚠ « OU », PAS « ET » : on tape ce dont on se souvient. Exiger les deux
    n'aurait jamais rien trouvé.
    """
    if cherche and cherche in _sans_accents(fiche["client"]["nom"]):
        return True
    return fiche["client"]["id"] in ids_numero


def _sans_accents(texte):
    """« Lefèvre » devient « lefevre » : chercher un nom ne doit pas exiger
    de taper les accents (ni la bonne casse)."""
    decompose = unicodedata.normalize("NFD", (texte or "").casefold())
    return "".join(c for c in decompose if not unicodedata.combining(c))


# ------------------------------------------- §4 : de l'état vers LA CAMPAGNE
# « Une campagne se crée toujours à partir de ce qui manque » (§1). Ici, ce
# qui manque est UN TEMPS pour une personne qui attend : la porte est 👥. La
# nature n'est donc jamais choisie à la main, elle est DÉDUITE de l'état
# filtré, par la table TRAITEMENT ci-dessus — jamais par une seconde table.


def besoins_non_traites(fiche, etat=""):
    """Les besoins de CE client qu'aucune campagne en cours ne prend (§3).

    C'est la définition exacte de « non traité », vue client par client :
    son état appelle une action, aucune campagne en cours ne le contient
    pour cet état, il n'est ni 🚫 exclu ni sans numéro. `etat` restreint au
    seul état filtré à l'écran — sinon c'est un autre besoin qu'on
    compterait.
    """
    if fiche["exclu"] or fiche["sans_numero"]:
        return []
    return [besoin for besoin in fiche["besoins"]
            if not besoin["traite"] and (not etat or besoin["etat"] == etat)]


def natures_a_proposer(fiches, etat=""):
    """LES BOUTONS de création du §4 : une entrée par nature de campagne.

    Décision du propriétaire (31/07/2026) : quand la sélection mêle des
    états traités par des campagnes DIFFÉRENTES, on affiche **un bouton par
    nature**, chacun avec son propre compte — jamais un bouton grisé qui
    laisserait deviner. Un même état peut d'ailleurs appeler deux natures à
    lui seul (`rendez-vous prévu` → 🔔 rappel OU ✅ confirmation).

    Les sentinelles RELANCE et HUMAIN ne sont pas des natures de campagne :
    elles ne donnent aucun bouton (voir `etats_sans_campagne`, qui dit
    pourquoi à l'écran plutôt que de laisser un vide).

    Rend [{"nature", "libelle", "etats", "clients"}], le plus gros compte
    d'abord — à égalité, l'ordre du catalogue des natures, pour que deux
    affichages successifs ne se contredisent jamais.
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
    """Les états de la sélection qu'AUCUNE campagne ne traite, et POURQUOI (§6).

    « À dire clairement à l'écran plutôt que de laisser croire que le robot
    s'en charge » : un état qui ne donne aucun bouton doit dire pourquoi,
    sinon l'absence de bouton ressemble à un oubli.
    Rend [{"etat", "libelle", "raison", "clients"}].
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
    """Les campagnes DÉJÀ nées de CE critère — elles ne se bloquent pas entre elles.

    Sans cela, une campagne née d'un filtre d'état interdirait à sa propre
    recette d'être rejouée : les clients qu'elle tient ne seraient plus
    « non traités », et la cascade s'arrêterait au premier maillon. Or le
    critère avait été évalué AVANT que cette campagne existe — le rejouer,
    c'est se replacer dans les mêmes conditions (§8.3).

    Une campagne née d'un AUTRE critère, elle, compte normalement : on ne
    va pas remettre dans une liste quelqu'un qu'une autre campagne appelle
    déjà.
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
    """TOUS les clients dans cet état — sans autre condition. Rend
    (contacts, complements).

    ⚠ CE N'EST PAS `contacts_depuis_etat`, et c'est voulu. Cette dernière
    sert la page 👥 Contacts, où l'état a fait CHOISIR la nature : elle
    n'garde donc que les clients qu'aucune campagne ne couvre déjà, et que
    la nature choisie sait traiter. Deux conditions parfaitement justes
    là-bas, et incompréhensibles ici : quand on demande « charge-moi les
    clients qui ont un rendez-vous prévu », on veut ces clients-là.

    Constaté par le propriétaire le 02/08/2026 : « 0 contact ajouté… cet
    état ne se traite pas par Créneau libéré » — un refus qui n'avait aucune
    raison d'être, puisqu'une campagne de créneau libéré s'adresse
    justement à des gens qui ont déjà un rendez-vous.

    Ce qui reste écarté, et compté : les sans-numéro et les doublons. Ce
    qui est SIGNALÉ sans être écarté : les clients qu'une autre campagne
    traite déjà — l'information est utile, la décision revient à l'opérateur.
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
    """LA RECETTE « etat » : rejoue le filtre de 👥 Contacts qui a bâti la liste.

    Même mécanique que `assistant.contacts_depuis_base` : rend
    (contacts, complements). La liste n'est jamais recopiée — elle est
    RECALCULÉE à partir du critère (état filtré + « non traité » + la
    nature qui le traite, plus la recherche par nom si elle a servi). C'est
    ce qui permet à une campagne née d'un filtre d'état d'être rejouée sur
    un autre créneau (§8.3, la cascade).

    Le numéro est lu EN CLAIR ici — comme toutes les constitutions de liste
    demandées explicitement par l'utilisateur — et n'est jamais affiché.
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
        # Le rendez-vous qui porte le contexte : celui qui vient (s'il en a
        # un), sinon le dernier passé. Rien n'est inventé — quand il n'y en
        # a aucun, les colonnes restent vides, visibles et à remplir.
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
    # ⚠ DIRE POURQUOI QUAND IL N'Y A PERSONNE. Trois causes très différentes
    # produisaient exactement le même écran vide, et le propriétaire l'a
    # constaté le 02/08/2026 : son contact avait bien un rendez-vous prévu,
    # mais une campagne le prenait déjà en charge — rien ne le disait.
    if not contacts:
        complements.extend(_pourquoi_personne(toutes, fiches, etat, nature,
                                              recherche, hors_nature))
    return contacts, complements


def _pourquoi_personne(toutes, retenues, etat, nature, recherche, hors_nature):
    """Les raisons du zéro, en français, chiffres tirés de la base.

    Un « 0 contact » muet laisse croire à une panne. Ici on distingue :
    ① personne n'est dans cet état ;
    ② des gens y sont, mais des campagnes les prennent DÉJÀ en charge — on
       les compte et on nomme les campagnes qui bloquent ;
    ③ des gens y sont et sont libres, mais la nature choisie à l'étape 1 ne
       traite pas cet état.
    """
    libelle = libelle_etat(etat) if etat else "à traiter"
    # Sans le filtre « non traité » : combien sont réellement dans cet état.
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
    """Les noms des campagnes qui couvrent déjà cet état (trois au plus).

    Nommer la campagne évite la question suivante (« laquelle ? ») et permet
    d'aller la clore ou de la reprendre. Au-delà de trois, on abrège : la
    liste complète est sur la page 👥 Contacts, colonne « Campagnes en cours ».
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
    """Le libellé d'un état, quelle que soit sa famille (agenda ou conversation)."""
    if code in ETATS_AGENDA:
        return libelle_agenda(code)
    return libelle_conversation(code)


def filtrer(fiches, recherche="", etat="", non_traite=False,
            interdit=False, ids_numero=None):
    """Les filtres de la page Contacts, appliqués dans cet ordre.

    recherche : sur le nom, sans tenir compte de la casse ni des accents ;
    ids_numero: les identifiants que la BASE a reconnus au numéro (voir
                `db.clients_par_chiffres`). La recherche vaut « nom OU
                numéro » ;
    etat      : un code d'état, d'agenda OU de conversation ;
    non_traite: la définition exacte du §3 — et, si un état est filtré, c'est
                CET état qui doit rester sans campagne (pas un autre) ;
    interdit  : ne garder que les contacts 🚫 « ne plus appeler ».

    ⚠ LE NUMÉRO N'EST PAS COMPARÉ ICI. Les fiches ne portent que le masque :
    la couche d'affichage n'a jamais vu le vrai numéro, et ce n'est pas une
    recherche qui va l'y faire entrer. La base rend des IDENTIFIANTS ; on ne
    fait que les reconnaître.
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
