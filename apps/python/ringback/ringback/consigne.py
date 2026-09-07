"""The BRIEFING dictated to the CALL-E agent — three parts, never a monologue.

WHAT MOTIVATED THIS MODULE. On the 5th real test (01/08/2026) the agent was
STIFF: the owner asked it to repeat, the agent answered `ok, your appointment
has been moved` and wrapped up. The cause lies in what RingBack was sending it
— a TEXT TO RECITE, with variables already substituted. Yet CALL-E presents
itself as a conversational agent: its `task` field expects an OBJECTIVE, not a
line to read. We were talking to an AI as if to a machine.

Hence the owner's decision, word for word:

`I do want a standard opening (though M. or Mme it does not understand, they
must be replaced by monsieur or madame). Then it must talk naturally according
to the answer, but be pinned to outcomes: yes, no, other, depending on the
reason for the call.`

The briefing therefore takes THREE PARTS, and only one is imposed:

1. THE OPENING — the message built at step 2 (or rewritten by hand by the user). It is the ONLY passage spoken word for word;
2. THE OBJECTIVE AND THE CONTEXT — in natural language: what we are trying to obtain, the useful facts (the current appointment, the slot offered, the reason, the place, the length, the instructions) and the CONSTRAINTS (never any medical information, do not insist, say you are an automated assistant if asked, the escape hatch of the discussion sheets). Between the opening and the close, the agent TALKS FREELY: it may repeat, rephrase, answer an unforeseen question;
3. THE EXPECTED OUTCOMES — closed: yes / no / other. Each is translated into the code the result schema imposes (see calle_client: SCHEMA_RESULTAT and SCHEMA_RESULTAT_CASCADE, both `enum` + additionalProperties=False). The schema therefore stays closed and checkable: it is what guarantees nothing is invented.

This module depends on NO other RingBack module (it is imported by calle_client
as well as by assistant) and writes nowhere: it produces text, and nothing
else. No phone number ever enters it — the rule is checked by the tests
(sans_numero).
"""

import re

# ---------------------------------------------------------- the honorifics THE
# OWNER'S OBSERVATION, by ear: `M.` and `Mme` are not read correctly by the
# agent. They are EXPANDED when building the text to be sent — and only there.
# Client records keep their owner's spelling: nothing is rewritten in the
# database, ever.  Order matters: the LONG forms first (`MM.` before `M.`,
# `Mmes` before `Mme`), otherwise the alternation would take the short one.
# ONLY those abbreviations are expanded: the ones in the product's records
# (sample data set: `M.`, `Mme`) and the ones alphabetical sorting already
# knows (generation._CIVILITE: m., mme, mlle, mr, dr), plus `Pr` requested by
# the owner. Nothing else is guessed.
CIVILITES = (
    ("MM.", "messieurs"),
    ("M.", "monsieur"),
    ("Mmes", "mesdames"),
    ("Mme", "madame"),
    ("Mlles", "mesdemoiselles"),
    ("Mlle", "mademoiselle"),
    ("Mr", "monsieur"),
    ("Drs", "docteurs"),
    ("Dr", "docteur"),
    ("Pr", "professeur"),
)

_DEVELOPPE = dict(CIVILITES)

# The abbreviation must be followed by a space THEN a letter: that is what
# tells `M. Dupont` (an honorific) from a lone `M.` at the end of a sentence.
# Any trailing dot (`Mme.`) is absorbed.
_MOTIF_CIVILITE = re.compile(
    r"\b(" + "|".join(re.escape(abrege) for abrege, _ in CIVILITES)
    + r")\.?(?=\s+[^\W\d_])")

# ⚠ `M` ON ITS OWN, WITH NO DOT. All the other abbreviations are written
# without a dot (Mme, Mlle, Dr, Pr) and the pattern above already takes them;
# `M` and `MM` are the only ones that appear there ONLY with dots, so `M
# Ludovic` slipped through — observed by ear by the owner on 02/08/2026: the
# agent said `M Ludovic` throughout the call.  The condition is stricter than
# for the dotted forms: the following word must start with a CAPITAL, like a
# surname. `M` followed by a lower-case word is not expanded — too much risk of
# catching something else. One case this pattern takes wrongly remains: an
# initial (`J M Dupont` would become `J monsieur Dupont`). It is accepted
# knowingly: a contact record carries an honorific far more often than an
# initial, and the consequence is limited to one spoken word — never to written
# data, since the record is not touched.
_MAJUSCULES = "A-ZÀ-ÖØ-Þ"
_MOTIF_CIVILITE_SANS_POINT = re.compile(
    r"\b(MM|M)(?=\s+[" + _MAJUSCULES + r"])")

# After which an expanded honorific takes its capital back (start of text or
# start of sentence) — `Monsieur Dupont a demandé…`, not `monsieur` stuck after
# a full stop. The colon is NOT part of that: in French, what follows it takes
# no capital (`Personne appelée : monsieur Ludovic`).
_FINS_DE_PHRASE = ".!?\n\r"
_OUVRANTS = " \t «\"'(-–—"


def developper_civilites(texte, developpe=None):
    """`M. Ludovic` becomes `monsieur Ludovic` — in the TEXT SENT OUT.

    Called at the last moment, on the assembled briefing. The client's record
    is never touched: that spelling is theirs.

    ⚠ AN EMPTY `developpe` = NOTHING IS EXPANDED, and that is intended outside
    French. The observation that created this function — `M.` and `Mme` misread
    by the agent — is a FRENCH observation. `Mr Smith` reads perfectly well as
    it stands in English, and `monsieur Smith` would be plainly wrong there.
    """
    if not texte:
        return texte
    if developpe is None:
        developpe = _DEVELOPPE
    if not developpe:
        return texte

    def remplacer(trouve):
        abrege = trouve.group(1)
        mot = developpe.get(abrege) or developpe.get(abrege + ".")
        if not mot:
            return trouve.group(0)
        avant = texte[:trouve.start()].rstrip(_OUVRANTS)
        if not avant or avant[-1] in _FINS_DE_PHRASE:
            return mot[:1].upper() + mot[1:]
        return mot

    # The dotted forms first: `M. Ludovic` is already handled by the time the
    # dotless pass arrives, so `M` finds nothing left to do.
    texte = _MOTIF_CIVILITE.sub(remplacer, texte)
    return _MOTIF_CIVILITE_SANS_POINT.sub(remplacer, texte)


# ------------------------------------------------------- the two genres The
# field the agent must fill differs according to the imposed schema: `outcome`
# for a cascade call (freed slot), `appointment_status` for all the others. See
# calle_client.SCHEMA_RESULTAT(_CASCADE).
GENRE_CLASSIQUE = "classique"
GENRE_CASCADE = "cascade"

CHAMP_ISSUE = {GENRE_CLASSIQUE: "appointment_status",
               GENRE_CASCADE: "outcome"}

# The three outcomes, in the order the agent reads them. ⚠ THE FOUR OUTCOME
# SENTENCE ENDINGS ARE NAMED, and that is not tidying: they were written in the
# middle of `texte_issues`, hence untranslatable without touching the code.
# Named, they translate like the rest — through the dictionary, at the exit.
FIN_DATE_OBLIGATOIRE = (", et écris dans « new_datetime » la date convenue "
                        "au format 2026-08-15T14:30")
FIN_DATE_FACULTATIVE_OU = (" avec la date convenue dans « new_datetime » "
                           "(format 2026-08-15T14:30) SI une date précise a "
                           "été convenue ; sinon rends {champ} = "
                           "« {code_sans_date} » et laisse « new_datetime » "
                           "vide")
FIN_DATE_FACULTATIVE = (", en écrivant dans « new_datetime » la date convenue "
                        "(format 2026-08-15T14:30) si une date précise a été "
                        "convenue, et rien sinon")
FIN_SANS_DATE = " et laisse « new_datetime » vide"
PREFIXE_OBJECTIF = "Ton objectif : "

ISSUES = ("oui", "non", "autre")
LIBELLE_ISSUE = {"oui": "OUI", "non": "NON", "autre": "AUTRE"}
# ⚠ THE SKELETON OF AN OUTCOME IS NAMED TOO. It carried the verb `rends`
# hard-written in the middle of an f-string: untranslatable without touching
# the code, and it is the most important line of the briefing — the one telling
# the agent which field to fill.
GABARIT_ISSUE = "- {libelle} — {quand} : rends {champ} = « {code} »"


def issue(code, quand, code_sans_date=None, date="vide"):
    """One of the three closed outcomes.

    code : the value imposed by the schema (enum); quand : at what moment the
    agent must choose this one; code_sans_date : the fallback value when NO
    precise date was agreed (`rescheduled` becomes `to_reschedule`); date :
    `obligatoire` (the outcome only makes sense with a date in new_datetime),
    `facultative` or `vide`.
    """
    return {"code": code, "quand": quand, "code_sans_date": code_sans_date,
            "date": date}


# The fallback outcomes, when the briefing is built WITHOUT a campaign sheet:
# single call-back, call queue, real test. They say the same thing as the
# sheets, only more generally.  ⚠ HERE, `YES` DEMANDS A DATE — and it did not
# (measured on 24/08/2026). Those calls OFFER A PRECISE SLOT: `I can offer you
# a new slot on Tuesday 25 August 2026 at 9 o'clock: would that suit you?`
# Saying yes means taking THAT slot — and the planner must enter it in the
# calendar. Yet the briefing said `leave new_datetime empty`: the agreement
# came back with no date, the check refused it, and NOTHING was written. The
# person had said yes on the phone, and their appointment did not move by a
# minute.  ⚠ THE `✅ Confirmation` AND `🔔 Rappel de rendez-vous` SHEETS ARE THE
# OPPOSITE CASE: they offer nothing, they ask for attendance. Their `yes` keeps
# `date="vide"`, and the product merely moves the appointment to `confirmé`.
# Two opposite needs, two contracts — which is why each kind declares its own
# rather than inheriting a single rule.
ISSUES_DEFAUT = {
    "oui": issue("confirmed", "la personne accepte le créneau que tu proposes",
                 date="obligatoire"),
    "non": issue("canceled", "elle refuse, ou elle annule son rendez-vous"),
    "autre": issue("rescheduled",
                   "tout le reste : elle veut une autre date, elle demande "
                   "à être rappelée par un humain, ou elle pose une question "
                   "à laquelle tu n'as pas la réponse",
                   code_sans_date="to_reschedule", date="facultative"),
}

ISSUES_DEFAUT_CASCADE = {
    "oui": issue("accepted", "la personne prend la place qui s'est libérée"),
    "non": issue("refused",
                 "elle décline : son rendez-vous actuel reste inchangé"),
    "autre": issue("moved",
                   "tout le reste : elle souhaite une autre date, elle "
                   "demande à être rappelée par un humain, ou elle pose une "
                   "question à laquelle tu n'as pas la réponse",
                   code_sans_date="to_reschedule", date="facultative"),
}


# ------------------------------------------------------- the constraints These
# are the `Rules common to all calls` of the discussion sheets
# (FICHES_DISCUSSION.md), written to be read by the agent. [entreprise] and
# [plage_rappel] are substituted at build time: a constraint must NEVER fall
# over for want of an empty variable.
CONTRAINTES = (
    "ne donne aucune information médicale, et aucun détail qui ne soit pas "
    "écrit dans « ce que tu sais » ci-dessus ;",
    "n'invente rien : ni date, ni horaire, ni tarif, ni nom ;",
    "ne communique aucun numéro de téléphone ;",
    "n'insiste jamais : un refus se respecte dès la première fois ;",
    "si on te demande si tu es un robot, dis-le : « Je suis un assistant "
    "automatique, mais je peux tout à fait vous aider — et le secrétariat "
    "peut vous rappeler si vous préférez. » ;",
    "si tu n'as pas la bonne personne : « Toutes mes excuses pour le "
    "dérangement, bonne journée. », et conclus sur AUTRE ;",
    # ⚠ THIS RULE COMES BEFORE THE ESCAPE HATCH, and with reason: on 02/08/2026
    # the person asked `could you remind me of the date?` — the date was
    # written in `what you know`, the agent had just said it — and it answered
    # `I'd rather not tell you something wrong` and hung up. The escape hatch
    # triggered on `an unforeseen question`: which is to say, on all of them.
    # Repeating is not improvising.
    "redire ce que tu sais n'est JAMAIS une raison de passer la main : si on "
    "te demande de répéter la date, l'heure, le lieu, la durée ou le motif, "
    "redis-les simplement, aussi souvent qu'il le faut — ils sont écrits "
    "dans « ce que tu sais » ci-dessus ;",
    "sortie de secours — UNIQUEMENT si la réponse ne se trouve nulle part "
    "dans « ce que tu sais », ou devant une personne agacée : « Je préfère "
    "ne pas vous dire de bêtise : je transmets votre demande à [entreprise], "
    "qui vous rappellera [plage_rappel]. Merci de votre patience, et bonne "
    "journée. » ; conclus alors sur AUTRE, en écrivant sa demande en clair ;",
    # ⚠ SAY SO RATHER THAN GUESS (10/08/2026). Without this line, an agent that
    # does not understand an answer decides anyway: it picks an outcome at
    # random, and RingBack writes it down. The person, meanwhile, believes they
    # were understood — and finds out otherwise when turning up for an
    # appointment that no longer exists. Two requests to repeat, then hand
    # over: that is what a human does on the phone.
    "si tu ne comprends pas ce qu'on te répond, demande de reformuler UNE "
    "fois ; si tu ne comprends toujours pas, dis-le : « Je n'ai "
    "malheureusement pas bien compris votre réponse. Je préfère qu'un "
    "collègue de [entreprise] vous rappelle — rien n'est changé de votre "
    "côté. » ; conclus alors sur AUTRE, sans date, en écrivant dans « notes » "
    "ce que tu as cru comprendre. Ne devine JAMAIS une issue : une réponse "
    "mal comprise et tranchée quand même est bien pire qu'un rappel ;",
    "sur un répondeur, laisse un message court et SANS le motif de l'appel.",
)

# The establishment when its name is not (yet) configured: the constraint stays
# speakable, and it does not claim to know a name we do not have.
ENTREPRISE_INCONNUE = "l'établissement"
PLAGE_INCONNUE = "pendant nos heures d'ouverture"

ENTETE = ("Tu es un assistant téléphonique français, et tu appelles une "
          "personne pour le compte de [entreprise]. Cet appel se déroule "
          "en trois temps.")

TITRE_PRESENTATION = ("1) TA PRÉSENTATION — dis-la telle quelle en ouvrant, "
                      "mot pour mot :")
TITRE_CONTEXTE = ("2) TON OBJECTIF ET TON CONTEXTE — ensuite, tu discutes "
                  "librement, en français.")
TITRE_ISSUES = ("3) LES ISSUES — tu dois conclure sur l'une de ces trois-là, "
                "et sur aucune autre :")

TITRE_FAITS = "Ce que tu sais, et que tu peux redire ou reformuler :"
# The title said `What you are not allowed to do` while the list has always
# mixed prohibitions and obligations (`if you are asked whether you are a
# robot, say so`). Under that title, the escape hatch read as a duty: at the
# slightest surprise, hand over. The title now says what the list really is.
TITRE_CONTRAINTES = ("Tes règles — ce que tu dois faire, et ce que tu n'as "
                     "pas le droit de faire :")

# ⚠ CONDUCT IS NOT A CONSTRAINT (16/08/2026). A constraint says what is NEVER
# done; conduct says in what ORDER to carry the exchange — `offer the nearest
# date, then ask which days suit…`. Mixing them drowned the procedure in the
# middle of the prohibitions, and the agent read a list of rules where it
# expected a sequence. Not every kind has one: the block disappears when it is
# empty.
TITRE_CONDUITE = "Comment mener l'échange, dans cet ordre :"

LIBERTE = ("Entre ton ouverture et ta conclusion, discute NATURELLEMENT, en "
           "t'adaptant à ce qu'on te répond : tu peux répéter, reformuler, "
           "laisser la personne t'interrompre, répondre à une question "
           "imprévue. Ne récite pas, ne conclus pas avant d'avoir une "
           "réponse claire. Avant de raccrocher, récapitule en une phrase "
           "ce qui a été convenu.")

# The call's length is NO LONGER asked for: CALL-E measures it itself and
# refuses to be asked (reserved field — see calle_client.CHAMPS_RESERVES).
# Asking someone to estimate what a clock measures would never have been worth
# a measurement anyway.
RAPPEL_CHAMPS = ("Rends aussi « notes » : une ou deux phrases qui résument "
                 "l'échange, et la demande de la personne en clair si tu "
                 "conclus sur AUTRE. N'ajoute aucun autre "
                 "champ : le résultat n'accepte que ceux-là.")

# ⚠ THE 🚫 IS SPOKEN ON THE PHONE (10/08/2026). Before, someone asking not to be
# called again was not heard: nothing recorded it, and they were called again
# in the next campaign. That is a lack of courtesy as much as a lack of
# compliance.  ⚠ IT IS NOT AN OUTCOME, and the briefing says so: the person may
# refuse AND ask not to be called again, or accept this time and ask not to be
# called again afterwards. So the agent ALWAYS closes on one of the three
# outcomes, and ticks that field IN ADDITION. ⚠ THE QUESTION THAT WAS MISSING
# (10/08/2026), and only in cascade: refusing ONE slot does not mean refusing
# the next ones. Without asking it, RingBack called back indefinitely someone
# who was not interested — and their only way out was the 🚫, which also cuts
# off calls about THEIR OWN appointments.
RAPPEL_AUTRES_PLACES = (
    "Si la personne DÉCLINE la place, demande-lui avant de conclure : « Voulez-"
    "vous que je vous rappelle si un autre créneau se libère ? » — rends "
    "« wants_other_slots » = « yes » si elle accepte, « no » si elle ne veut "
    "plus qu'on lui en propose. N'insiste pas, et ne pose cette question QUE "
    "sur un refus.")

RAPPEL_NE_PLUS_APPELER = (
    "Si la personne demande qu'on ne la rappelle plus — quels que soient ses "
    "mots (« ne me rappelez plus », « retirez-moi de vos listes », "
    "« je ne veux plus être contacté ») — réponds « C'est noté, vous ne serez "
    "plus appelé. Bonne journée. », rends « do_not_call » = « yes », et conclus "
    "quand même sur l'une des trois issues ci-dessus. Sinon, rends "
    "« do_not_call » = « no ».")

_VARIABLE = re.compile(r"\[[^\]\n]+\]")


class Consigne:
    """The three parts of what goes into CALL-E's `task` field.

    The texts still carry their per-contact [variables] ([identite],
    [rdv_existant]…) until substituer() has been called: that is what lets the
    step-2 preview show EXACTLY what will go out, with the variables still
    visible where they will be filled in.
    """

    def __init__(self, presentation, objectif, faits=(), contraintes=None,
                 issues=None, genre=GENRE_CLASSIQUE, entete=ENTETE,
                 conduite=(), dire=None, civilites=None):
        """`dire` TRANSLATES THIS MODULE'S FIXED SENTENCES, and nothing else.

        ⚠ THE TRANSLATOR IS INJECTED, NOT IMPORTED. This module depends on NO
        other RingBack module — that is written at the top of the file and it
        is what lets both `calle_client` and `assistant` use it without getting
        in each other's way. Fetching a dictionary here would break that rule
        for a convenience. The caller already knows which language is chosen:
        it passes the function.

        `dire` defaults to the identity: without it, this module returns
        exactly what it returned before, to the letter.

        `civilites`: the table of abbreviations to expand (`M.` -> `monsieur`).
        Empty = nothing is expanded — the right behaviour outside French, where
        `Mr Smith` reads perfectly well as it stands and `monsieur Smith` would
        be a mistake.
        """
        self.presentation = presentation or ""
        self.objectif = objectif or ""
        self.faits = list(faits)
        self.dire = dire or (lambda texte: texte)
        # ⚠ THE DEFAULT CONSTRAINTS ARE TRANSLATED HERE (03/09/2026). The
        # assistant used to translate them itself before passing them; the
        # fallback path — call queue, the `Rappeler` button, direct cascade —
        # passes nothing, and therefore kept the ten rules in French while the
        # voice spoke English. Translate at the point of PASSAGE, not in each
        # caller: the next caller will not fall into it.
        self.contraintes = ([self.dire(ligne) for ligne in CONTRAINTES]
                            if contraintes is None else list(contraintes))
        # ⚠ THE DEFAULT OUTCOMES TOO (03/09/2026), same reason as the
        # constraints just above: the assistant translates its own before
        # passing them, the fallback path passes none. Without this, the three
        # lines that tell the agent WHEN to choose which outcome — the only
        # ones that decide the result — stayed in French. ⚠ WHATEVER THEIR
        # ORIGIN, and that is intended: the cascade passes its own explicitly,
        # the assistant passes its own already translated. Translating here
        # covers all three cases — and on text that is already English the
        # operation does nothing, since it is not in the French dictionary.
        self.issues = {cle: dict(fixee, quand=self.dire(fixee["quand"]))
                       for cle, fixee in (issues or ISSUES_DEFAUT).items()}
        self.genre = genre
        self.entete = entete
        # Specific to the kind, and often empty: see TITRE_CONDUITE.
        self.conduite = list(conduite or ())
        self.civilites = _DEVELOPPE if civilites is None else civilites

    # ------------------------------------------------------- substitution
    def substituer(self, valeurs, presentation=None):
        """Returns a NEW briefing, values substituted, empty lines removed.

        valeurs: {code: readable text}. A fact line whose variable stays
        without a value DISAPPEARS (an empty [bracket] is never dictated); the
        constraints, for their part, no longer carry any.

        presentation: the opening text already finalised by the caller
        (assistant.finaliser_mission has always done that work and knows the
        column types); failing that, the simple substitution is applied here
        too.
        """
        def remplacer(texte):
            for code, valeur in valeurs.items():
                valeur = (valeur or "").strip()
                if valeur:
                    texte = texte.replace(f"[{code}]", valeur)
            return texte

        faits = [remplacer(ligne) for ligne in self.faits]
        faits = [ligne for ligne in faits if not _VARIABLE.search(ligne)]
        copie = Consigne(
            presentation if presentation is not None
            else remplacer(self.presentation),
            remplacer(self.objectif), faits,
            [remplacer(ligne) for ligne in self.contraintes],
            self.issues, self.genre, remplacer(self.entete),
            # ⚠ CONDUCT KEEPS ITS LINES, EVEN WITH NO VALUE. Unlike the facts,
            # it is NOT filtered on remaining [variables]: `offer the
            # [creneau_le_plus_proche]` must stay a step of the sequence even
            # when the calendar has nothing to offer — it is the next line that
            # then says what to do. A truncated sequence would be worse than an
            # empty bracket.
            [remplacer(ligne) for ligne in self.conduite],
            self.dire, self.civilites)
        return copie

    # ------------------------------------------------------------ rendus
    def texte_presentation(self):
        """Part ①: the only passage imposed word for word.

        The text is taken AS IT STANDS (simply stripped of its edge spaces): a
        message rewritten by hand by the user — line breaks included — must go
        out exactly as they wrote it.
        """
        return "« " + self.presentation.strip() + " »"

    def texte_contexte(self):
        """Part ②: objective, useful facts, constraints, freedom."""
        lignes = [f"{self.dire(PREFIXE_OBJECTIF)}{self.objectif}"]
        if self.faits:
            lignes.append(self.dire(TITRE_FAITS))
            lignes += [f"- {ligne}" for ligne in self.faits]
        # ⚠ BEFORE THE RULES, and numbered: it is a sequence, the ORDER IS the
        # information. Under the rules it would have read as one more
        # prohibition.
        if self.conduite:
            lignes.append(self.dire(TITRE_CONDUITE))
            lignes += [f"{rang}. {ligne}"
                       for rang, ligne in enumerate(self.conduite, start=1)]
        lignes.append(self.dire(TITRE_CONTRAINTES))
        lignes += [f"- {ligne}" for ligne in self.contraintes]
        lignes.append(self.dire(LIBERTE))
        return "\n".join(lignes)

    def texte_issues(self):
        """Part ③: yes / no / other, and nothing else."""
        champ = CHAMP_ISSUE[self.genre]
        lignes = []
        for cle in ISSUES:
            fixee = self.issues[cle]
            phrase = self.dire(GABARIT_ISSUE).format(
                libelle=self.dire(LIBELLE_ISSUE[cle]),
                quand=fixee["quand"], champ=champ, code=fixee["code"])
            if fixee["date"] == "obligatoire":
                phrase += self.dire(FIN_DATE_OBLIGATOIRE)
            elif fixee["date"] == "facultative" and fixee["code_sans_date"]:
                phrase += self.dire(FIN_DATE_FACULTATIVE_OU).format(
                    champ=champ, code_sans_date=fixee["code_sans_date"])
            elif fixee["date"] == "facultative":
                phrase += self.dire(FIN_DATE_FACULTATIVE)
            else:
                phrase += self.dire(FIN_SANS_DATE)
            lignes.append(phrase + ".")
        lignes.append(self.dire(RAPPEL_CHAMPS))
        lignes.append(self.dire(RAPPEL_NE_PLUS_APPELER))
        if self.genre == GENRE_CASCADE:
            lignes.append(self.dire(RAPPEL_AUTRES_PLACES))
        return "\n".join(lignes)

    def texte(self):
        """THE COMPLETE BRIEFING — exactly what goes into `task`.

        The honorifics are expanded HERE, at the last moment: it is the only
        place where `M. Dupont` becomes `monsieur Dupont`.
        """
        blocs = [self.dire(self.entete),
                 self.dire(TITRE_PRESENTATION) + "\n"
                 + self.texte_presentation(),
                 self.dire(TITRE_CONTEXTE) + "\n" + self.texte_contexte(),
                 self.dire(TITRE_ISSUES) + "\n" + self.texte_issues()]
        # Last net: neither [entreprise] nor [plage_rappel] may come out in
        # brackets. A caller that has not substituted them (real test, call
        # queue) gets a true sentence rather than a template. ⚠ THE
        # BUSINESS-NAME FALLBACK FOLLOWS THE LANGUAGE TOO. With no name
        # configured, the briefing says `l'établissement` — and that word went
        # out in French in the middle of an English briefing, in the ESCAPE
        # HATCH, the one spoken on the phone to an irritated person. Found on
        # 02/09/2026 while hunting for leftover French on pages RENDERED in
        # English: no measure over the sources could have seen it, since the
        # word is substituted at display time.
        entier = substituer_cadre("\n\n".join(blocs),
                                  self.dire(ENTREPRISE_INCONNUE),
                                  self.dire(PLAGE_INCONNUE))
        return developper_civilites(entier, self.civilites)

    # --------------------------------------------------------- checks
    def codes_attendus(self):
        """Every result code THIS briefing permits.

        Used by the tests: they check that each one really belongs to the
        imposed schema's enum — the loop is thus closed on both sides.
        """
        codes = []
        for cle in ISSUES:
            fixee = self.issues[cle]
            codes.append(fixee["code"])
            if fixee["code_sans_date"]:
                codes.append(fixee["code_sans_date"])
        return codes


def entreprise_lisible(nom):
    """The business name, or enough to stay speakable without knowing it."""
    return (nom or "").strip() or ENTREPRISE_INCONNUE


def substituer_cadre(texte, entreprise, plage_rappel):
    """Substitutes [entreprise] and [plage_rappel] — never left in brackets.

    A safety constraint (the escape hatch) must not fall over because a setting
    is missing: with no business name, we say `l'établissement`, which is true.
    """
    return (texte.replace("[entreprise]", entreprise_lisible(entreprise))
            .replace("[plage_rappel]", plage_rappel or ""))
