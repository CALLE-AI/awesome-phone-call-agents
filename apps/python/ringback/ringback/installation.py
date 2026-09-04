"""THE FIRST-RUN INSTALLER — its structure and its progress.

This module draws nothing: it states **which parts exist, which pages they
contain, and which are done**. The drawing lives in `serveur.py`, which knows
how to render the forms; here we hold the map.

The principle, as the owner asked for it (03/08/2026): on the very first launch
a setting is missing — so the installer opens. It asks for nothing new: **it
has you fill in the same settings as the ⚙ Settings page**, in an order that
makes sense, one page at a time, with a breadcrumb trail to go back.

What progress means, exactly: a page is `done` when it has been **confirmed**,
not when a machine judged its content satisfactory. A part turns green when ALL
its pages are done. That is verifiable, it is reversible (nothing stops you
going back), and it never claims to know whether a setting is *right* — only
whether it was seen and wanted.
"""

# --------------------------------------------------------------- settings
CLE_FAITE = "installation_faite"  # set at the very end, by the gesture
CLE_PAGES = "installation_pages"  # the page codes already confirmed


# --------------------------------------------------------------- the map The
# `Calls` part: exactly the five forms of ⚙ Settings → Calls, in the same
# order. They are not copies: the same code produces them.
PAGES_APPELS = (
    # ⚠ CALL-E COMES FIRST (10/08/2026). It decides whether the product can
    # call at all: setting it after the identity, the follow-ups and the
    # briefings would have meant preparing everything before discovering that
    # no call can go out. It is not compulsory for all that — the key is
    # obtained from CALL-E, and simulation shows everything without one.
    ("calle", "Connexion à CALL-E"),
    ("identite", "Identité de l'établissement"),
    ("appel", "Quand appeler"),
    ("relances", "Relances"),
    ("remplacement", "Annulation"),
    ("delais", "Délais d'un appel réel"),
)

# The `Calendar` part: the typical week, the closed days, then loading a
# calendar. Deliberately WITHOUT `slots to offer`: they are computed from the
# previous three, there is nothing to type in.
PAGES_AGENDA = (
    ("horaires", "Horaires d'ouverture"),
    ("jours-fermes", "Jours fermés"),
    ("import", "Charger votre agenda"),
)

# The two pages of EACH campaign kind. Unlike the Settings, which group by
# subject (all the briefings together, all the options together), the installer
# groups by CAMPAIGN: you set one campaign completely, then move to the next.
PAGES_NATURE = (
    ("comportement", "Options de comportement"),
    ("discours", "Discours de l'agent"),
)


# The node that gathers the campaigns in the menu. It is NOT a part: it has no
# page of its own, it only exists to carry the branch.
GROUPE_AGENT = "agent"
LIBELLE_AGENT = "Comportement de l'agent IA"


def parties(natures):
    """The complete map: [(code, label, [(page_code, label), …]), …].

    `natures`: [(code, icon, name), …] — the campaign kinds that can still be
    created. The installer therefore follows the product: removing a kind
    removes its part, without touching this module. The icon is received but
    deliberately IGNORED in the labels: see `arbre`.

    ⚠ THE ORDER IS THE ORDER OF THE JOURNEY, and it changed on 03/08/2026: the
    calendar comes BEFORE the campaigns. That is the owner's request, and it
    holds up — the slots a campaign can offer come out of the calendar, so it
    is better to have filled it in before setting up what uses it.
    """
    carte = [
        ("bienvenue", "Bienvenue", [("bienvenue", "Ce que vous allez régler")]),
        ("appel", "Appeler", list(PAGES_APPELS)),
        ("agenda", "Agenda", list(PAGES_AGENDA)),
    ]
    for code, _, nom in natures:
        carte.append((f"nature-{code}", nom,
                      [(f"{code}-{page}", libelle)
                       for page, libelle in PAGES_NATURE]))
    carte.append(("fin", "Terminer", [("fin", "C'est prêt")]))
    return carte


def arbre(natures):
    """The MENU, as it is displayed: [(code, label, [(code, label), …])].

    Four entries, only one of which unfolds — the campaigns one. So there is a
    single level of indentation: a section's pages are not in the tree, they
    have their own list beside the form.

    ⚠ `Bienvenue` (Welcome) is NOT in it. The home screen shows no navigation,
    and once configuration has started you do not go back to it: showing it in
    the menu would offer a way back that makes no sense.

    ⚠ No icons: no party popper, no telephone, no calendar. Only the tick and
    the cross belong here, because they say something.
    """
    branche = [(f"nature-{code}", nom) for code, _, nom in natures]
    return [
        ("appel", "Appeler", []),
        ("agenda", "Agenda", []),
        (GROUPE_AGENT, LIBELLE_AGENT, branche),
        ("fin", "Terminer", []),
    ]


def noeud_de(page, natures):
    """(top-level node code, part code) for this page.

    The node is GROUPE_AGENT when the page belongs to a campaign: that is the
    one that must show unfolded and active.
    """
    partie = partie_de(page, natures)
    if partie and partie.startswith("nature-"):
        return GROUPE_AGENT, partie
    return partie, partie


def noeud_fait(noeud, preferences, natures):
    """True when this menu node is entirely configured.

    For the campaigns group, that means: ALL the campaigns are. A green tick on
    the group while one campaign is still outstanding would be a lie.
    """
    if noeud == GROUPE_AGENT:
        codes = [code for code, _ in arbre(natures)[2][2]]
        return bool(codes) and all(
            partie_faite(code, preferences, natures) for code in codes)
    return partie_faite(noeud, preferences, natures)


def premiere_page(noeud, natures):
    """The page a click on this menu node leads to."""
    if noeud == GROUPE_AGENT:
        # The group has no page: open the first campaign.
        premiere = arbre(natures)[2][2]
        return premiere_page(premiere[0][0], natures) if premiere else None
    for code_partie, _, liste in parties(natures):
        if code_partie == noeud and liste:
            return liste[0][0]
    return None


def pages(natures):
    """Every page code, in the order of the journey."""
    return [code for _, _, liste in parties(natures) for code, _ in liste]


def partie_de(page, natures):
    """The code of the part containing this page (None if unknown)."""
    for code_partie, _, liste in parties(natures):
        if any(code == page for code, _ in liste):
            return code_partie
    return None


def page_valide(page, natures):
    """The requested page, or the first of the journey if it does not exist."""
    toutes = pages(natures)
    return page if page in toutes else toutes[0]


def suivante(page, natures):
    """The next page, or None if this is already the last one."""
    toutes = pages(natures)
    if page not in toutes:
        return toutes[0]
    rang = toutes.index(page) + 1
    return toutes[rang] if rang < len(toutes) else None


# ------------------------------------------------------------ l'avancement
def faites(preferences):
    """The set of page codes already confirmed."""
    return set(preferences.obtenir(CLE_PAGES) or [])


def marquer_faite(preferences, page):
    """Marks this page as confirmed. Twice changes nothing."""
    deja = faites(preferences)
    if page in deja:
        return
    deja.add(page)
    # Sorted: the preferences file stays comparable from one run to the next.
    preferences.definir(CLE_PAGES, sorted(deja))


def partie_faite(partie, preferences, natures):
    """True when ALL the pages of this part are confirmed."""
    deja = faites(preferences)
    for code_partie, _, liste in parties(natures):
        if code_partie == partie:
            return bool(liste) and all(code in deja for code, _ in liste)
    return False


def progression(preferences, natures):
    """(pages confirmed, pages in total) — enough to write `7 of 20`."""
    toutes = pages(natures)
    deja = faites(preferences)
    return sum(1 for code in toutes if code in deja), len(toutes)


def terminee(preferences):
    """True if the installation was carried through to the end, at least once.
    """
    return bool(preferences.obtenir(CLE_FAITE))


def marquer_terminee(preferences):
    """The final gesture: the installer will no longer open by itself."""
    preferences.definir(CLE_FAITE, True)


def rouvrir(preferences):
    """Start again from scratch: the installer will reopen at the next launch.

    Used by the `Redo the configuration` button in the Settings. Both the end
    marker AND the confirmed pages are erased: resuming a half-ticked
    installation would show green ticks on the very pages you want to review.
    """
    preferences.definir(CLE_FAITE, False)
    preferences.definir(CLE_PAGES, [])
