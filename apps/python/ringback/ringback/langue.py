# -*- coding: utf-8 -*-
"""Le choix de langue de l'interface — français par défaut, anglais au choix.

⚠ POURQUOI LA TRADUCTION SE FAIT À LA SORTIE, ET NON DANS LE CODE.

Le produit fabrique ses pages à la main, en f-strings, dans 238 fonctions
différentes : mesuré le 01/09/2026, 15 440 lignes d'écrans portent environ
1 757 phrases françaises distinctes, dont 93 à 98 % écrites en dur au milieu du
code. Il n'existe aucun gabarit où l'on pourrait poser un dictionnaire.

Remplacer chaque phrase par un appel de traduction demanderait de toucher ces
238 fonctions. C'est précisément le genre de passe qui casse un produit qui
marche — et celui-ci part en concours dans treize jours.

**On traduit donc la page FINIE, au moment exact où elle quitte le produit.**
Tout le HTML sort par deux lignes (`serveur._repondre` et
`serveur._repondre_cible`) : c'est le point de passage unique, et il existait
déjà. Le code métier continue de fabriquer du français, sans qu'une seule de
ses lignes change ; l'anglais est une couche posée par-dessus.

CE QUE ÇA APPORTE, et ce n'est pas un détail :

1. **En français, RIEN ne se passe.** `traduire(page, "fr")` rend l'objet
   reçu, à l'identité près. Le produit français ne peut donc pas régresser :
   il n'est même pas traversé.
2. **Les phrases composées à l'exécution sont couvertes.** 565 des textes que
   les essais affirment n'existent nulle part tels quels dans le code — ils
   sont assemblés au vol. Un extracteur de chaînes ne les verrait jamais ; la
   page finie, si.
3. **Rien n'est écrit en base.** La traduction est un habillage d'affichage.
   Les états stockés en français (« prévu », « à appeler »…) restent
   exactement ce qu'ils sont : traduire une donnée, ce serait la corrompre.

CE QU'ELLE NE FAIT PAS, ET C'EST VOULU : elle ne traduit QUE ce qui est écrit
dans le dictionnaire. Un texte inconnu reste en français. On n'invente jamais
une traduction au mot à mot — sur un écran qui décide d'appels téléphoniques
réels, une phrase mal traduite est pire qu'une phrase non traduite.

⚠ ET ELLE NE TOUCHE JAMAIS AUX DONNÉES DE L'UTILISATEUR. Le nom d'un client,
le motif d'un rendez-vous, une note écrite à la main ne sont pas dans le
dictionnaire : ils traversent intacts. C'est la conséquence directe du point
précédent — ne traduire que ce qu'on connaît.
"""

import re

from . import traductions

# Le réglage, rangé ici parce que c'est ce module qui en donne le sens.
CLE_LANGUE = "langue_interface"

FRANCAIS = "fr"
ANGLAIS = "en"
LANGUE_PAR_DEFAUT = FRANCAIS

# ⚠ LE FRANÇAIS EST LA LANGUE SOURCE, PAS UNE TRADUCTION. Le produit est écrit
# en français : il n'y a donc rien à traduire pour l'obtenir, et c'est ce qui
# rend le mode français strictement sans risque.
LANGUES = {
    FRANCAIS: {"code": FRANCAIS, "nom": "Français", "nom_anglais": "French",
               "drapeau": "FR"},
    ANGLAIS: {"code": ANGLAIS, "nom": "Anglais", "nom_anglais": "English",
              "drapeau": "EN"},
}


def langue_valide(valeur):
    """La langue demandée, ou le français si elle est inconnue ou absente.

    ⚠ ON NE LÈVE PAS, ET C'EST TESTÉ. Une langue inconnue (réglage abîmé à la
    main, ancienne valeur, adresse bricolée) ne doit pas empêcher l'écran de
    s'afficher : le pire acceptable est de revoir le produit dans sa langue
    d'origine.

    ⚠ Y COMPRIS QUAND CE N'EST PAS DU TEXTE. Un réglage relu d'un fichier JSON
    abîmé peut rendre un nombre, une liste, n'importe quoi — `str()` d'abord,
    questions ensuite. L'essai qui tient cette règle a trouvé la faute : la
    promesse était écrite ici depuis le premier jour, et la fonction levait
    un `AttributeError` sur un entier.
    """
    valeur = str(valeur or "").strip().lower()
    return valeur if valeur in LANGUES else LANGUE_PAR_DEFAUT


def de_preferences(preferences):
    """La langue choisie, lue dans les réglages. Français en cas de doute.

    ⚠ LE RÉGLAGE EST GLOBAL, ET C'EST CE QUI ÉVITE UNE PLOMBERIE ENTIÈRE.
    RingBack n'a pas de comptes ni de sessions : une installation, un
    utilisateur. La langue est donc un réglage comme un autre, et chaque
    fonction qui reçoit déjà `preferences` — c'est-à-dire presque toutes —
    peut la lire sans qu'on ajoute un paramètre à toute la chaîne d'appels.

    ⚠ ELLE NE LÈVE JAMAIS : un réglage absent ou abîmé rend le français.
    """
    try:
        return langue_valide(preferences.obtenir(CLE_LANGUE))
    except Exception:                                        # noqa: BLE001
        return LANGUE_PAR_DEFAUT


def traducteur(langue_code, table=None):
    """Une fonction `texte -> texte` qui traduit les phrases connues.

    ⚠ ON REND UNE FONCTION, PAS UN DICTIONNAIRE, parce que `consigne.py` ne
    doit dépendre d'AUCUN module de RingBack — c'est écrit en tête de ce
    fichier-là et c'est ce qui lui permet d'être importé par `calle_client`
    comme par `assistant`. On lui injecte donc de quoi traduire, sans lui
    dire d'où ça vient.

    En français, la fonction rendue est l'IDENTITÉ : elle ne consulte rien.
    """
    if langue_valide(langue_code) == FRANCAIS:
        return lambda texte: texte
    if table is None:
        table = traductions.table_consigne(langue_code)

    def dire(texte):
        """La phrase traduite, AVEC SES ESPACES DE BORD.

        ⚠ LES ESPACES SONT PORTES PAR LES SEGMENTS EUX-MEMES, et c'est ce
        qui les recolle. Le gabarit d'un message est fait de morceaux collés
        par `"".join(...)` : chacun porte l'espace qui le sépare du suivant.
        Rendre la valeur du dictionnaire telle quelle — dont la clé a été
        récoltée sans ses bords — collait les phrases entre elles :
        « …que vous serez là.Cela se passe à… ». Mesuré le 01/09/2026 sur la
        consigne de confirmation.
        """
        if not texte:
            return texte
        nu = texte.strip()
        traduit = table.get(nu)
        if traduit is None:
            return texte
        avant = texte[:len(texte) - len(texte.lstrip())]
        apres = texte[len(texte.rstrip()):]
        return avant + traduit + apres
    return dire


def civilites_de(langue_code, civilites_francaises):
    """Les abréviations à développer dans CETTE langue.

    ⚠ VIDE HORS DU FRANÇAIS, et c'est une décision, pas un oubli. Développer
    « M. » en « monsieur » vient d'un constat fait à l'oreille sur des appels
    FRANÇAIS. « Mr Smith » se lit très bien tel quel, et « monsieur Smith »
    serait une faute pure.
    """
    if langue_valide(langue_code) == FRANCAIS:
        return civilites_francaises
    return {}


# ---------------------------------------------------------------------------
# Le découpage d'une page en zones : ce qu'on peut traduire, et le reste.
# ---------------------------------------------------------------------------

# Les éléments dont le CONTENU n'est pas du texte affiché. Traduire à
# l'intérieur casserait la page (un nom de fonction JavaScript, une règle CSS).
ELEMENTS_OPAQUES = ("script", "style")

# Les attributs qui portent du texte lu par un humain. Tous les autres
# (name, value, id, class, action, href…) sont des identifiants : les toucher
# casserait les formulaires, donc on n'y touche pas.
ATTRIBUTS_TRADUISIBLES = ("title", "placeholder", "aria-label", "alt")

_ATTRIBUT = re.compile(
    r'\b(' + "|".join(ATTRIBUTS_TRADUISIBLES) + r')="([^"]*)"')

_OUVERTURE_OPAQUE = re.compile(
    r"<(" + "|".join(ELEMENTS_OPAQUES) + r")\b", re.IGNORECASE)


def _zones(page):
    """Découpe la page en (genre, texte) : « texte », « balise », « opaque ».

    ⚠ UN DÉCOUPAGE, PAS UNE ANALYSE. On ne reconstruit jamais le document : on
    le coupe en tranches et on ne remplace QUE des tranches entières de genre
    « texte ». Tout le reste — balises, scripts, styles, espaces — est recopié
    caractère pour caractère. C'est ce qui garantit qu'une page sans aucune
    traduction ressort identique à l'octet près, et cette garantie est le
    fondement de tout le reste : sans elle, on ne pourrait pas affirmer que le
    mode français ne régresse pas.
    """
    zones = []
    position = 0
    taille = len(page)
    while position < taille:
        debut = page.find("<", position)
        if debut == -1:
            zones.append(("texte", page[position:]))
            break
        if debut > position:
            zones.append(("texte", page[position:debut]))
        opaque = _OUVERTURE_OPAQUE.match(page, debut)
        if opaque:
            # On saute d'un bloc jusqu'à la fermeture : son contenu n'est ni
            # du texte ni des balises, c'est du code.
            fin_balise = page.find(">", debut)
            fermeture = page.lower().find(f"</{opaque.group(1).lower()}",
                                          debut)
            if fin_balise == -1 or fermeture == -1:
                # Page tronquée ou balise non fermée : on recopie le reste tel
                # quel plutôt que de deviner.
                zones.append(("opaque", page[debut:]))
                break
            fin = page.find(">", fermeture)
            fin = taille if fin == -1 else fin + 1
            zones.append(("opaque", page[debut:fin]))
            position = fin
            continue
        fin = page.find(">", debut)
        if fin == -1:
            zones.append(("opaque", page[debut:]))
            break
        zones.append(("balise", page[debut:fin + 1]))
        position = fin + 1
    return zones


def phrase_traduite(phrase, table, motifs=()):
    """La traduction d'une phrase : le dictionnaire d'abord, les motifs ensuite.

    ⚠ LES MOTIFS EXISTENT PARCE QUE LA MOITIÉ DES PHRASES SONT PÉRISSABLES.
    Mesuré le 01/09/2026 : 804 des 1 527 phrases traduites portaient une date
    ou une heure de la semaine en cours — « dimanche 06/09 10h00 — hors
    horaires d'ouverture ». Écrites en dur, elles auraient cessé de
    correspondre DÈS LE LENDEMAIN, et la traduction se serait effritée toute
    seule, sans que rien ne le signale.

    Un motif, lui, laisse passer la donnée et ne traduit que les mots autour :
    il tient indéfiniment. Deux règles remplacent ici 728 entrées mortes.

    ⚠ LE DICTIONNAIRE PASSE EN PREMIER, toujours : une phrase écrite en toutes
    lettres l'emporte sur une règle générale. C'est ce qui permet de corriger
    un cas particulier sans toucher à la règle.
    """
    traduit = table.get(phrase)
    if traduit is not None:
        return traduit
    for motif, fabrique in motifs:
        trouve = motif.match(phrase)
        if trouve:
            rendu = fabrique(trouve, table)
            if rendu is not None:
                return rendu
    return None


def _traduire_texte(brut, table, motifs=()):
    """Traduit UNE tranche de texte, en gardant ses espaces d'origine.

    Le texte d'une page porte l'indentation du code qui l'a écrite. La clé du
    dictionnaire, elle, est la phrase seule. On isole donc la phrase, on la
    cherche, et on la repose entre les mêmes espaces — sinon la mise en page
    changerait de langue en langue.
    """
    phrase = brut.strip()
    if not phrase:
        return brut
    traduit = phrase_traduite(phrase, table, motifs)
    if traduit is None:
        return brut
    avant = brut[:len(brut) - len(brut.lstrip())]
    apres = brut[len(brut.rstrip()):]
    return avant + traduit + apres


def _traduire_balise(balise, table, motifs=()):
    """Traduit les attributs lisibles d'une balise, et eux seuls."""
    def remplacer(trouve):
        attribut, valeur = trouve.group(1), trouve.group(2)
        traduit = phrase_traduite(valeur.strip(), table, motifs)
        if traduit is None:
            return trouve.group(0)
        return f'{attribut}="{traduit}"'
    return _ATTRIBUT.sub(remplacer, balise)


def traduire(page, langue):
    """La page, dans la langue demandée. Le français ressort tel quel.

    ⚠ LE RETOUR EN FRANÇAIS EST L'OBJET REÇU, PAS UNE COPIE. C'est délibéré :
    on veut pouvoir écrire dans un essai `traduire(page, "fr") is page` et
    prouver ainsi, sans discussion possible, que le mode français ne traverse
    aucun traitement.
    """
    if langue_valide(langue) == FRANCAIS:
        return page
    table = traductions.table(langue)
    motifs = traductions.motifs(langue)
    if not table and not motifs:
        return page
    morceaux = []
    for genre, morceau in _zones(page):
        if genre == "texte":
            morceaux.append(_traduire_texte(morceau, table, motifs))
        elif genre == "balise":
            morceaux.append(_traduire_balise(morceau, table, motifs))
        else:
            morceaux.append(morceau)
    return "".join(morceaux)


_DEUX_LETTRES = re.compile(r"[^\W\d_]{2,}", re.UNICODE)


def est_du_texte(phrase):
    """Vrai si cette phrase est du TEXTE, et non un symbole ou un chiffre.

    ⚠ SANS CE TRI, LA COUVERTURE MENT DANS LES DEUX SENS. L'écran des réglages
    porte 728 marqueurs d'une lettre (« f » pour fermé), invisibles à l'œil et
    doublés d'une infobulle complète, elle traduite. Les compter fait tomber
    la couverture de 97 % à 69 % sans qu'une seule phrase manque vraiment.

    On garde donc ce qui contient au moins deux lettres à la suite. Les
    pastilles « (0) », les « ☾ », les « 1 », les « . » ne sont pas du texte à
    traduire — et le produit ne serait pas plus anglais si on les traduisait.
    """
    return bool(_DEUX_LETTRES.search(phrase))


def phrases_connues(page, langue_code=ANGLAIS):
    """(connues, inconnues) — ce que la traduction couvre VRAIMENT d'une page.

    Sert à chiffrer la couverture sur des écrans réels, motifs compris. Sans
    elle, « c'est traduit » resterait une impression.
    """
    table = traductions.table(langue_code)
    motifs = traductions.motifs(langue_code)
    connues, inconnues = [], []
    for phrase in phrases_de(page):
        cible = connues if phrase_traduite(
            phrase, table, motifs) is not None else inconnues
        cible.append(phrase)
    return connues, inconnues


def phrases_de(page):
    """Toutes les phrases traduisibles d'une page — l'outil de mesure.

    Sert à récolter ce qu'il reste à traduire, et à CHIFFRER la couverture :
    « combien de phrases de cet écran le dictionnaire connaît-il ? ». Sans
    cela, on ne saurait dire ce qui est traduit autrement qu'à l'œil.
    """
    trouvees = []
    for genre, morceau in _zones(page):
        if genre == "texte":
            phrase = morceau.strip()
            if phrase:
                trouvees.append(phrase)
        elif genre == "balise":
            for attribut in _ATTRIBUT.finditer(morceau):
                valeur = attribut.group(2).strip()
                if valeur:
                    trouvees.append(valeur)
    return trouvees
