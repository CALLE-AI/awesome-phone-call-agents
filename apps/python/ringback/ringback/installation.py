"""L'INSTALLEUR DU PREMIER LANCEMENT — sa structure et son avancement.

Ce module ne dessine rien : il dit **quelles parties existent, quelles pages
elles contiennent, et lesquelles sont faites**. Le dessin est dans
`serveur.py`, qui sait rendre les formulaires ; ici on tient la carte.

Le principe, tel que le propriétaire l'a demandé (03/08/2026) : au tout
premier lancement, une variable n'est pas posée — alors l'installeur
s'ouvre. Il ne demande rien de nouveau : **il fait remplir les mêmes
réglages que la page ⚙ Réglages**, dans un ordre qui a un sens, une page à
la fois, avec un fil d'Ariane pour revenir en arrière.

Ce que l'avancement veut dire, exactement : une page est « faite » quand on
l'a **validée**, pas quand une machine a jugé son contenu satisfaisant. Une
partie passe au vert quand TOUTES ses pages sont faites. C'est vérifiable,
c'est réversible (rien n'empêche de revenir), et cela ne prétend jamais
savoir si un réglage est *bon* — seulement s'il a été vu et voulu.
"""

# --------------------------------------------------------------- réglages
CLE_FAITE = "installation_faite"      # posée à la toute fin, par le geste
CLE_PAGES = "installation_pages"      # les codes de page déjà validés


# --------------------------------------------------------------- la carte
# Partie « Appels » : exactement les cinq formulaires de ⚙ Réglages → Appels,
# dans le même ordre. Ce ne sont pas des copies : le même code les produit.
PAGES_APPELS = (
    # ⚠ CALL-E EN TÊTE (10/08/2026). C'est ce qui décide si le produit peut
    # appeler du tout : le régler après l'identité, les relances et les
    # discours aurait fait tout préparer avant de découvrir qu'aucun appel ne
    # peut partir. Elle n'est pas obligatoire pour autant — la clé s'obtient
    # chez CALL-E, et la simulation montre tout sans elle.
    ("calle", "Connexion à CALL-E"),
    ("identite", "Identité de l'établissement"),
    ("appel", "Quand appeler"),
    ("relances", "Relances"),
    ("remplacement", "Annulation"),
    ("delais", "Délais d'un appel réel"),
)

# Partie « Agenda » : la semaine type, les jours fermés, puis le chargement
# d'un agenda. Volontairement SANS « créneaux à proposer » : ils sont
# calculés à partir des trois précédents, il n'y a rien à saisir.
PAGES_AGENDA = (
    ("horaires", "Horaires d'ouverture"),
    ("jours-fermes", "Jours fermés"),
    ("import", "Charger votre agenda"),
)

# Les deux pages de CHAQUE nature de campagne. Contrairement aux Réglages,
# qui groupent par sujet (tous les discours ensemble, toutes les options
# ensemble), l'installeur groupe par CAMPAGNE : on règle une campagne
# entièrement, puis on passe à la suivante.
PAGES_NATURE = (
    ("comportement", "Options de comportement"),
    ("discours", "Discours de l'agent"),
)


# Le nœud qui regroupe les campagnes dans le menu. Ce n'est PAS une partie :
# il n'a aucune page à lui, il ne sert qu'à porter la branche.
GROUPE_AGENT = "agent"
LIBELLE_AGENT = "Comportement de l'agent IA"


def parties(natures):
    """La carte complète : [(code, libellé, [(code_page, libellé), …]), …].

    `natures` : [(code, icône, nom), …] — les natures de campagne encore
    créables. L'installeur suit donc le produit : retirer une nature retire
    sa partie, sans toucher à ce module. L'icône est reçue mais volontairement
    IGNORÉE dans les libellés : voir `arbre`.

    ⚠ L'ORDRE EST CELUI DU PARCOURS, et il a changé le 03/08/2026 : l'agenda
    passe AVANT les campagnes. C'est la demande du propriétaire, et elle se
    tient — les places qu'une campagne peut proposer sortent de l'agenda, il
    vaut donc mieux l'avoir renseigné avant de régler ce qui s'en sert.
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
    """Le MENU, tel qu'il s'affiche : [(code, libellé, [(code, libellé), …])].

    Quatre entrées, dont une seule se déplie — celle des campagnes. Un seul
    niveau de retrait, donc : les pages d'une section ne sont pas dans l'arbre,
    elles ont leur propre liste à côté du formulaire.

    ⚠ « Bienvenue » n'y figure PAS. L'accueil n'affiche aucune navigation, et
    une fois la configuration démarrée on n'y revient pas : la faire
    apparaître dans le menu proposerait un retour qui n'a aucun sens.

    ⚠ Aucune icône : ni cotillon, ni téléphone, ni calendrier. Seules la coche
    et la croix ont leur place ici, parce qu'elles disent quelque chose.
    """
    branche = [(f"nature-{code}", nom) for code, _, nom in natures]
    return [
        ("appel", "Appeler", []),
        ("agenda", "Agenda", []),
        (GROUPE_AGENT, LIBELLE_AGENT, branche),
        ("fin", "Terminer", []),
    ]


def noeud_de(page, natures):
    """(code du nœud de premier niveau, code de la partie) pour cette page.

    Le nœud vaut GROUPE_AGENT quand la page appartient à une campagne : c'est
    lui qui doit s'afficher déplié et actif.
    """
    partie = partie_de(page, natures)
    if partie and partie.startswith("nature-"):
        return GROUPE_AGENT, partie
    return partie, partie


def noeud_fait(noeud, preferences, natures):
    """Vrai quand ce nœud du menu est entièrement réglé.

    Pour le groupe des campagnes, cela veut dire : TOUTES les campagnes le
    sont. Une coche verte sur le groupe alors qu'une campagne reste à faire
    serait un mensonge.
    """
    if noeud == GROUPE_AGENT:
        codes = [code for code, _ in arbre(natures)[2][2]]
        return bool(codes) and all(
            partie_faite(code, preferences, natures) for code in codes)
    return partie_faite(noeud, preferences, natures)


def premiere_page(noeud, natures):
    """La page où mène un clic sur ce nœud du menu."""
    if noeud == GROUPE_AGENT:
        # Le groupe n'a pas de page : on ouvre la première campagne.
        premiere = arbre(natures)[2][2]
        return premiere_page(premiere[0][0], natures) if premiere else None
    for code_partie, _, liste in parties(natures):
        if code_partie == noeud and liste:
            return liste[0][0]
    return None


def pages(natures):
    """Tous les codes de page, dans l'ordre du parcours."""
    return [code for _, _, liste in parties(natures) for code, _ in liste]


def partie_de(page, natures):
    """Le code de la partie qui contient cette page (None si inconnue)."""
    for code_partie, _, liste in parties(natures):
        if any(code == page for code, _ in liste):
            return code_partie
    return None


def page_valide(page, natures):
    """La page demandée, ou la première du parcours si elle n'existe pas."""
    toutes = pages(natures)
    return page if page in toutes else toutes[0]


def suivante(page, natures):
    """La page d'après, ou None si c'est déjà la dernière."""
    toutes = pages(natures)
    if page not in toutes:
        return toutes[0]
    rang = toutes.index(page) + 1
    return toutes[rang] if rang < len(toutes) else None


# ------------------------------------------------------------ l'avancement
def faites(preferences):
    """L'ensemble des codes de page déjà validés."""
    return set(preferences.obtenir(CLE_PAGES) or [])


def marquer_faite(preferences, page):
    """Note cette page comme validée. Deux fois ne change rien."""
    deja = faites(preferences)
    if page in deja:
        return
    deja.add(page)
    # Trié : le fichier de préférences reste comparable d'une fois à l'autre.
    preferences.definir(CLE_PAGES, sorted(deja))


def partie_faite(partie, preferences, natures):
    """Vrai quand TOUTES les pages de cette partie sont validées."""
    deja = faites(preferences)
    for code_partie, _, liste in parties(natures):
        if code_partie == partie:
            return bool(liste) and all(code in deja for code, _ in liste)
    return False


def progression(preferences, natures):
    """(pages validées, pages en tout) — de quoi écrire « 7 sur 20 »."""
    toutes = pages(natures)
    deja = faites(preferences)
    return sum(1 for code in toutes if code in deja), len(toutes)


def terminee(preferences):
    """Vrai si l'installation a été menée à son terme, au moins une fois."""
    return bool(preferences.obtenir(CLE_FAITE))


def marquer_terminee(preferences):
    """Le geste final : l'installeur ne s'ouvrira plus tout seul."""
    preferences.definir(CLE_FAITE, True)


def rouvrir(preferences):
    """Repartir de zéro : l'installeur se rouvrira au prochain lancement.

    Sert au bouton « Refaire la configuration » des Réglages. On efface la
    marque de fin ET les pages validées : reprendre une installation à
    moitié cochée montrerait des coches vertes sur des pages qu'on veut
    justement revoir.
    """
    preferences.definir(CLE_FAITE, False)
    preferences.definir(CLE_PAGES, [])
