# -*- coding: utf-8 -*-
"""The interface language choice — French by default, English on request.

⚠ WHY TRANSLATION HAPPENS AT THE EXIT, AND NOT IN THE CODE.

The product builds its pages by hand, in f-strings, across 238 different
functions: measured on 01/09/2026, 15,440 lines of screens carry about 1,757
distinct French sentences, 93 to 98 % of them written inline in the middle of
the code. There is no template anywhere to hang a dictionary on.

Replacing every sentence with a translation call would mean touching those 238
functions. That is exactly the kind of sweep that breaks a working product —
and this one enters a contest in thirteen days.

**So the FINISHED page is translated, at the exact moment it leaves the product.** All the HTML goes out through two lines (`serveur._repondre` and `serveur._repondre_cible`): that is the single exit point, and it already existed. The business code goes on producing French, without a single one of its lines changing; English is a layer laid on top.

WHAT THIS BUYS, and it is not a detail:

1. **In French, NOTHING happens.** `traduire(page, "fr")` returns the object it received, identity included. The French product therefore cannot regress: it is not even traversed.
2. **Sentences composed at run time are covered.** 565 of the texts the tests assert exist nowhere in the code as such — they are assembled on the fly. A string extractor would never see them; the finished page does.
3. **Nothing is written to the database.** Translation is display dressing. States stored in French (`prévu`, `à appeler`…) stay exactly what they are: translating data would corrupt it.

WHAT IT DOES NOT DO, AND THAT IS DELIBERATE: it translates ONLY what is written
in the dictionary. An unknown text stays French. A word-for-word translation is
never invented — on a screen that decides real phone calls, a badly translated
sentence is worse than an untranslated one.

⚠ AND IT NEVER TOUCHES THE USER'S DATA. A client's name, an appointment's
reason, a hand-written note are not in the dictionary: they pass through
intact. That is the direct consequence of the previous point — translate only
what you know.
"""

import re

from . import traductions

# The setting lives here because this is the module that gives it meaning.
CLE_LANGUE = "langue_interface"

FRANCAIS = "fr"
ANGLAIS = "en"
LANGUE_PAR_DEFAUT = FRANCAIS

# ⚠ FRENCH IS THE SOURCE LANGUAGE, NOT A TRANSLATION. The product is written in
# French: there is therefore nothing to translate to obtain it, and that is
# what makes French mode strictly risk-free.
LANGUES = {
    FRANCAIS: {"code": FRANCAIS, "nom": "Français", "nom_anglais": "French",
               "drapeau": "FR"},
    ANGLAIS: {"code": ANGLAIS, "nom": "Anglais", "nom_anglais": "English",
              "drapeau": "EN"},
}


def langue_valide(valeur):
    """The requested language, or French when it is unknown or absent.

    ⚠ IT DOES NOT RAISE, AND THAT IS TESTED. An unknown language (a setting
    edited by hand, an old value, a hand-made URL) must not stop the screen
    from displaying: the worst acceptable outcome is seeing the product in its
    original language again.

    ⚠ INCLUDING WHEN IT IS NOT TEXT. A setting read back from a damaged JSON
    file may return a number, a list, anything — `str()` first, questions
    afterwards. The test that holds this rule found the fault: the promise had
    been written here since day one, and the function raised an
    `AttributeError` on an integer.
    """
    valeur = str(valeur or "").strip().lower()
    return valeur if valeur in LANGUES else LANGUE_PAR_DEFAUT


def de_preferences(preferences):
    """The chosen language, read from the settings. French when in doubt.

    ⚠ THE SETTING IS GLOBAL, AND THAT IS WHAT AVOIDS A WHOLE LAYER OF PLUMBING.
    RingBack has no accounts and no sessions: one installation, one user. The
    language is therefore a setting like any other, and every function that
    already receives `preferences` — which is nearly all of them — can read it
    without a parameter being added along the whole call chain.

    ⚠ IT NEVER RAISES: an absent or damaged setting yields French.
    """
    try:
        return langue_valide(preferences.obtenir(CLE_LANGUE))
    except Exception:                                        # noqa: BLE001
        return LANGUE_PAR_DEFAUT


def traducteur(langue_code, table=None):
    """A `text -> text` function that translates the sentences it knows.

    ⚠ A FUNCTION IS RETURNED, NOT A DICTIONARY, because `consigne.py` must
    depend on NO RingBack module — that is written at the top of that file and
    it is what lets it be imported by `calle_client` as well as by `assistant`.
    So it is handed the means to translate, without being told where they come
    from.

    In French, the returned function is the IDENTITY: it consults nothing.
    """
    if langue_valide(langue_code) == FRANCAIS:
        return lambda texte: texte
    if table is None:
        table = traductions.table_consigne(langue_code)

    def dire(texte):
        """The translated sentence, WITH ITS EDGE SPACES.

        ⚠ THE SPACES ARE CARRIED BY THE SEGMENTS THEMSELVES, and that is what
        glues them back together. A message template is made of pieces joined
        by `"".join(...)`: each carries the space that separates it from the
        next. Returning the dictionary value as it stands — whose key was
        harvested without its edges — glued the sentences together: `…que vous
        serez là.Cela se passe à…`. Measured on 01/09/2026 on the confirmation
        briefing.
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
    """The abbreviations to expand in THIS language.

    ⚠ EMPTY OUTSIDE FRENCH, and that is a decision, not an oversight. Expanding
    `M.` into `monsieur` came from listening to FRENCH calls. `Mr Smith` reads
    perfectly well as it stands, and `monsieur Smith` would be plainly wrong.
    """
    if langue_valide(langue_code) == FRANCAIS:
        return civilites_francaises
    return {}


# ---------------------------------------------------------------------------
# Splitting a page into zones: what can be translated, and the rest.
# ---------------------------------------------------------------------------

# The elements whose CONTENT is not displayed text. Translating inside them
# would break the page (a JavaScript function name, a CSS rule).
ELEMENTS_OPAQUES = ("script", "style")

# The attributes that carry text a human reads. All the others (name, value,
# id, class, action, href…) are identifiers: touching them would break the
# forms, so they are left alone.
ATTRIBUTS_TRADUISIBLES = ("title", "placeholder", "aria-label", "alt")

_ATTRIBUT = re.compile(
    r'\b(' + "|".join(ATTRIBUTS_TRADUISIBLES) + r')="([^"]*)"')

_OUVERTURE_OPAQUE = re.compile(
    r"<(" + "|".join(ELEMENTS_OPAQUES) + r")\b", re.IGNORECASE)


def _zones(page):
    """Splits the page into (kind, text): `texte`, `balise`, `opaque`.

    ⚠ A SPLIT, NOT A PARSE. The document is never rebuilt: it is cut into
    slices and ONLY whole slices of kind `texte` are replaced. Everything else
    — tags, scripts, styles, whitespace — is copied character for character.
    That is what guarantees a page with no translation at all comes out
    identical byte for byte, and that guarantee is the foundation of all the
    rest: without it, there would be no way to claim French mode does not
    regress.
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
            # Skip from one block to its closing tag: its content is neither
            # text nor tags, it is code.
            fin_balise = page.find(">", debut)
            fermeture = page.lower().find(f"</{opaque.group(1).lower()}",
                                          debut)
            if fin_balise == -1 or fermeture == -1:
                # Truncated page or unclosed tag: copy the rest as it stands
                # rather than guess.
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
    """The translation of a sentence: the dictionary first, the patterns second.

    ⚠ THE PATTERNS EXIST BECAUSE HALF THE SENTENCES ARE PERISHABLE. Measured on
    01/09/2026: 804 of the 1,527 translated sentences carried a date or a time
    from the current week — `dimanche 06/09 10h00 — hors horaires d'ouverture`.
    Written out in full, they would have stopped matching THE VERY NEXT DAY,
    and the translation would have crumbled on its own with nothing to signal
    it.

    A pattern, by contrast, lets the data through and translates only the words
    around it: it holds indefinitely. Two rules replace 728 dead entries here.

    ⚠ THE DICTIONARY ALWAYS COMES FIRST: a sentence written out in full beats a
    general rule. That is what makes it possible to fix one special case
    without touching the rule.
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
    """Translates ONE slice of text, keeping its original whitespace.

    A page's text carries the indentation of the code that wrote it. The
    dictionary key, on the other hand, is the sentence alone. So the sentence
    is isolated, looked up, and put back between the same spaces — otherwise
    the layout would change from one language to the next.
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
    """Translates a tag's human-readable attributes, and those alone."""
    def remplacer(trouve):
        attribut, valeur = trouve.group(1), trouve.group(2)
        traduit = phrase_traduite(valeur.strip(), table, motifs)
        if traduit is None:
            return trouve.group(0)
        return f'{attribut}="{traduit}"'
    return _ATTRIBUT.sub(remplacer, balise)


def traduire(page, langue):
    """The page, in the requested language. French comes back untouched.

    ⚠ THE FRENCH RETURN IS THE OBJECT RECEIVED, NOT A COPY. That is deliberate:
    it makes it possible to write `traduire(page, "fr") is page` in a test and
    prove, beyond argument, that French mode goes through no processing at all.
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
    """True if this sentence is TEXT, and not a symbol or a figure.

    ⚠ WITHOUT THIS FILTER, COVERAGE LIES IN BOTH DIRECTIONS. The settings
    screen carries 728 one-letter markers (`f` for closed), invisible to the
    eye and doubled by a full tooltip, which is translated. Counting them drops
    coverage from 97 % to 69 % without a single sentence actually being
    missing.

    So what is kept is whatever contains at least two letters in a row. The
    `(0)` badges, the `☾`, the `1`, the `.` are not text to translate — and the
    product would be no more English if they were.
    """
    return bool(_DEUX_LETTRES.search(phrase))


def phrases_connues(page, langue_code=ANGLAIS):
    """(known, unknown) — what translation REALLY covers on a page.

    Used to put a figure on coverage over real screens, patterns included.
    Without it, `it's translated` would remain an impression.
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
    """Every translatable sentence of a page — the measuring instrument.

    Used to harvest what is left to translate, and to PUT A FIGURE on coverage:
    `how many sentences of this screen does the dictionary know?`. Without
    that, there would be no way to say what is translated other than by eye.
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
