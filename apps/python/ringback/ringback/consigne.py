"""La CONSIGNE dictée à l'agent CALL-E — trois parties, jamais un monologue.

CE QUI A MOTIVÉ CE MODULE. Au 5ᵉ essai réel (01/08/2026), l'agent a été
RAIDE : le propriétaire lui a demandé de répéter, l'agent a répondu « ok,
votre rendez-vous a été déplacé » et a conclu. La cause est dans ce que
RingBack lui envoyait — un TEXTE À RÉCITER, variables déjà remplacées.
Or CALL-E se revendique agent conversationnel : son champ « task » attend
un OBJECTIF, pas une réplique. Nous parlions à une IA comme à un automate.

D'où la décision du propriétaire, mot pour mot :

    « Je veux effectivement une première présentation type (par contre
    M. ou Mme il ne comprend pas, faut remplacer par monsieur ou madame).
    Ensuite il faut qu'il discute naturellement en fonction de la réponse,
    par contre fixer sur issues : oui, non, autre selon la raison de
    l'appel. »

La consigne prend donc TROIS PARTIES, et une seule est imposée :

1. LA PRÉSENTATION — le message construit à l'étape 2 (ou récrit à la main
   par l'utilisateur). C'est le SEUL passage dit mot pour mot ;
2. L'OBJECTIF ET LE CONTEXTE — en langage naturel : ce qu'on cherche à
   obtenir, les faits utiles (le rendez-vous actuel, la place proposée, le
   motif, le lieu, la durée, les consignes) et les CONTRAINTES (jamais
   d'information médicale, ne pas insister, s'annoncer comme assistant
   automatique si on le demande, la sortie de secours des fiches). Entre
   l'ouverture et la conclusion, l'agent DISCUTE LIBREMENT : il peut
   répéter, reformuler, répondre à une question imprévue ;
3. LES ISSUES ATTENDUES — fermées : oui / non / autre. Chacune est traduite
   dans le code que le schéma de résultat impose (voir calle_client :
   SCHEMA_RESULTAT et SCHEMA_RESULTAT_CASCADE, tous deux « enum » +
   additionalProperties=False). Le schéma reste donc fermé et vérifiable :
   c'est lui qui garantit qu'on n'invente rien.

Ce module ne dépend d'AUCUN autre module de RingBack (il est importé par
calle_client comme par assistant) et n'écrit nulle part : il fabrique du
texte, et rien d'autre. Aucun numéro de téléphone n'y entre jamais — la
règle est vérifiée par les essais (sans_numero).
"""

import re

# ---------------------------------------------------------- les civilités
# LE CONSTAT DU PROPRIÉTAIRE, à l'oreille : « M. » et « Mme » ne sont pas
# lus correctement par l'agent. On les DÉVELOPPE au moment de construire le
# texte envoyé — et là seulement. Les fiches clients gardent l'écriture de
# leur propriétaire : rien n'est réécrit en base, jamais.
#
# L'ordre compte : les formes LONGUES d'abord (« MM. » avant « M. »,
# « Mmes » avant « Mme »), sinon l'alternation prendrait la courte.
# On ne développe QUE ces abréviations-là : celles des fiches du produit
# (jeu d'essai : « M. », « Mme ») et celles que le tri alphabétique connaît
# déjà (generation._CIVILITE : m., mme, mlle, mr, dr), plus « Pr » demandé
# par le propriétaire. Rien d'autre n'est deviné.
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

# L'abréviation doit être suivie d'une espace PUIS d'une lettre : c'est ce
# qui distingue « M. Dupont » (une civilité) d'un « M. » isolé en fin de
# phrase. Le point final éventuel (« Mme. ») est absorbé.
_MOTIF_CIVILITE = re.compile(
    r"\b(" + "|".join(re.escape(abrege) for abrege, _ in CIVILITES)
    + r")\.?(?=\s+[^\W\d_])")

# ⚠ « M » TOUT SEUL, SANS POINT. Toutes les autres abréviations s'écrivent
# sans point (Mme, Mlle, Dr, Pr) et le motif ci-dessus les prend déjà ; « M »
# et « MM » sont les seules à n'y figurer QUE pointées, donc « M Ludovic »
# passait à travers — constaté à l'oreille par le propriétaire le 02/08/2026 :
# l'agent a dit « M Ludovic » pendant tout l'appel.
#
# La condition est plus stricte que pour les formes pointées : le mot suivant
# doit commencer par une MAJUSCULE, comme un nom. « M » suivi d'un mot en
# minuscule n'est pas développé — trop de risque d'attraper autre chose.
# Reste un cas que ce motif prend à tort : une initiale (« J M Dupont »
# deviendrait « J monsieur Dupont »). Il est accepté en connaissance de
# cause : une fiche de contact porte une civilité bien plus souvent qu'une
# initiale, et la conséquence se limite à un mot prononcé — jamais à une
# donnée écrite, puisque la fiche n'est pas touchée.
_MAJUSCULES = "A-ZÀ-ÖØ-Þ"
_MOTIF_CIVILITE_SANS_POINT = re.compile(
    r"\b(MM|M)(?=\s+[" + _MAJUSCULES + r"])")

# Après quoi une civilité développée reprend sa majuscule (début de texte ou
# début de phrase) — « Monsieur Dupont a demandé… », pas « monsieur » collé
# derrière un point.
# Le deux-points N'EN FAIT PAS PARTIE : en français, ce qui le suit ne prend
# pas de majuscule (« Personne appelée : monsieur Ludovic »).
_FINS_DE_PHRASE = ".!?\n\r"
_OUVRANTS = " \t «\"'(-–—"


def developper_civilites(texte, developpe=None):
    """« M. Ludovic » devient « monsieur Ludovic » — dans le TEXTE ENVOYÉ.

    Appelée au dernier moment, sur la consigne assemblée. La fiche du
    client, elle, n'est jamais touchée : c'est son écriture à lui.

    ⚠ `developpe` VIDE = ON NE DÉVELOPPE RIEN, et c'est voulu hors du
    français. Le constat qui a créé cette fonction — « M. » et « Mme » mal
    lus par l'agent — est un constat FRANÇAIS. « Mr Smith » se lit très bien
    tel quel en anglais, et « monsieur Smith » y serait une faute pure.
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

    # Les formes pointées d'abord : « M. Ludovic » est déjà traité quand la
    # passe sans point arrive, et « M » n'y trouve donc plus rien à faire.
    texte = _MOTIF_CIVILITE.sub(remplacer, texte)
    return _MOTIF_CIVILITE_SANS_POINT.sub(remplacer, texte)


# ------------------------------------------------------- les deux genres
# Le champ que l'agent doit renseigner diffère selon le schéma imposé :
# « outcome » pour un appel de cascade (créneau libéré), « appointment_status »
# pour tous les autres. Voir calle_client.SCHEMA_RESULTAT(_CASCADE).
GENRE_CLASSIQUE = "classique"
GENRE_CASCADE = "cascade"

CHAMP_ISSUE = {GENRE_CLASSIQUE: "appointment_status",
               GENRE_CASCADE: "outcome"}

# Les trois issues, dans l'ordre où l'agent les lit.
# ⚠ LES QUATRE FINS DE PHRASE D'ISSUE SONT NOMMÉES, et ce n'est pas un
# rangement : elles étaient écrites au milieu de `texte_issues`, donc
# intraduisibles sans toucher au code. Nommées, elles se traduisent comme le
# reste — par le dictionnaire, à la sortie.
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
# ⚠ LE SQUELETTE D'UNE ISSUE EST NOMMÉ, LUI AUSSI. Il portait le verbe
# « rends » écrit en dur au milieu d'une f-string : intraduisible sans toucher
# au code, et c'est la ligne la plus importante de la consigne — celle qui dit
# à l'agent quel champ renseigner.
GABARIT_ISSUE = "- {libelle} — {quand} : rends {champ} = « {code} »"


def issue(code, quand, code_sans_date=None, date="vide"):
    """Une des trois issues fermées.

    code            : la valeur imposée par le schéma (enum) ;
    quand           : à quel moment l'agent doit choisir celle-là ;
    code_sans_date  : la valeur de repli quand AUCUNE date précise n'a été
                      convenue (« rescheduled » devient « to_reschedule ») ;
    date            : « obligatoire » (l'issue n'a de sens qu'avec une date
                      dans new_datetime), « facultative » ou « vide ».
    """
    return {"code": code, "quand": quand, "code_sans_date": code_sans_date,
            "date": date}


# Les issues de repli, quand la consigne est construite SANS fiche de
# campagne : rappel individuel, file d'appels, essai réel. Elles disent la
# même chose que les fiches, en plus général.
#
# ⚠ ICI, « OUI » RÉCLAME UNE DATE — et il n'en réclamait pas (mesuré le
# 24/08/2026). Ces appels-là PROPOSENT UN CRÉNEAU précis : « Je vous propose
# un nouveau créneau le mardi 25 août 2026 à 9 heures : est-ce que cela vous
# convient ? » Dire oui, c'est prendre CE créneau — et le planificateur doit
# l'inscrire à l'agenda. Or la consigne disait « laisse new_datetime vide » :
# l'accord revenait sans date, la vérification la refusait, et RIEN n'était
# écrit. La personne avait dit oui au téléphone, son rendez-vous ne bougeait
# pas d'une minute.
#
# ⚠ LES FICHES « ✅ Confirmation » ET « 🔔 Rappel de rendez-vous » SONT LE CAS
# INVERSE : elles ne proposent rien, elles demandent une présence. Leur « oui »
# garde `date="vide"`, et le produit se contente de passer le rendez-vous
# « confirmé ». Deux besoins opposés, deux contrats — c'est pourquoi chaque
# nature déclare le sien plutôt que d'hériter d'une règle unique.
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


# ------------------------------------------------------- les contraintes
# Ce sont les « Règles communes à tous les appels » des fiches de discussion
# (FICHES_DISCUSSION.md), écrites pour être lues par l'agent. [entreprise]
# et [plage_rappel] sont remplacés à la construction : une contrainte ne
# doit JAMAIS tomber faute d'une variable vide.
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
    # ⚠ CETTE RÈGLE PASSE AVANT LA SORTIE DE SECOURS, et pour cause : le
    # 02/08/2026, la personne a demandé « pouvez-vous me rappeler la date ? »
    # — la date était écrite dans « ce que tu sais », l'agent venait de la
    # dire — et il a répondu « je préfère ne pas vous dire de bêtise » puis
    # raccroché. La sortie de secours se déclenchait sur « une question
    # imprévue » : autant dire sur toutes. Répéter n'est pas improviser.
    "redire ce que tu sais n'est JAMAIS une raison de passer la main : si on "
    "te demande de répéter la date, l'heure, le lieu, la durée ou le motif, "
    "redis-les simplement, aussi souvent qu'il le faut — ils sont écrits "
    "dans « ce que tu sais » ci-dessus ;",
    "sortie de secours — UNIQUEMENT si la réponse ne se trouve nulle part "
    "dans « ce que tu sais », ou devant une personne agacée : « Je préfère "
    "ne pas vous dire de bêtise : je transmets votre demande à [entreprise], "
    "qui vous rappellera [plage_rappel]. Merci de votre patience, et bonne "
    "journée. » ; conclus alors sur AUTRE, en écrivant sa demande en clair ;",
    # ⚠ DIS-LE PLUTÔT QUE DE DEVINER (10/08/2026). Sans cette ligne, l'agent
    # qui ne comprend pas une réponse tranche quand même : il choisit une issue
    # au hasard, et RingBack l'écrit. La personne, elle, croit avoir été
    # comprise — et découvre le contraire en se présentant à un rendez-vous qui
    # n'existe plus. Deux demandes de répétition, puis on passe la main : c'est
    # ce que fait un humain au téléphone.
    "si tu ne comprends pas ce qu'on te répond, demande de reformuler UNE "
    "fois ; si tu ne comprends toujours pas, dis-le : « Je n'ai "
    "malheureusement pas bien compris votre réponse. Je préfère qu'un "
    "collègue de [entreprise] vous rappelle — rien n'est changé de votre "
    "côté. » ; conclus alors sur AUTRE, sans date, en écrivant dans « notes » "
    "ce que tu as cru comprendre. Ne devine JAMAIS une issue : une réponse "
    "mal comprise et tranchée quand même est bien pire qu'un rappel ;",
    "sur un répondeur, laisse un message court et SANS le motif de l'appel.",
)

# L'établissement quand son nom n'est pas (encore) réglé : la contrainte
# reste dicible, et elle ne prétend pas connaître un nom qu'on n'a pas.
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
# Le titre disait « Ce que tu n'as pas le droit de faire » alors que la liste
# a toujours mélangé des interdits et des obligations (« si on te demande si
# tu es un robot, dis-le »). Sous ce titre, la sortie de secours se lisait
# comme un devoir : au moindre imprévu, passer la main. Le titre dit
# maintenant ce que la liste est vraiment.
TITRE_CONTRAINTES = ("Tes règles — ce que tu dois faire, et ce que tu n'as "
                     "pas le droit de faire :")

# ⚠ LA CONDUITE N'EST PAS UNE CONTRAINTE (16/08/2026). Une contrainte dit ce
# qu'on ne fait JAMAIS ; une conduite dit dans quel ORDRE mener l'échange —
# « propose la date la plus proche, puis demande quels jours arrangent… ».
# Les mélanger noyait la marche à suivre au milieu des interdits, et l'agent
# lisait une liste de règles là où il attendait un déroulé. Toutes les natures
# n'en ont pas : le bloc disparaît quand elle est vide.
TITRE_CONDUITE = "Comment mener l'échange, dans cet ordre :"

LIBERTE = ("Entre ton ouverture et ta conclusion, discute NATURELLEMENT, en "
           "t'adaptant à ce qu'on te répond : tu peux répéter, reformuler, "
           "laisser la personne t'interrompre, répondre à une question "
           "imprévue. Ne récite pas, ne conclus pas avant d'avoir une "
           "réponse claire. Avant de raccrocher, récapitule en une phrase "
           "ce qui a été convenu.")

# On ne demande PLUS la durée de l'appel : CALL-E la mesure lui-même et
# refuse qu'on la lui demande (champ réservé — voir calle_client.
# CHAMPS_RESERVES). Demander à quelqu'un d'estimer ce qu'une horloge mesure
# n'aurait de toute façon jamais valu une mesure.
RAPPEL_CHAMPS = ("Rends aussi « notes » : une ou deux phrases qui résument "
                 "l'échange, et la demande de la personne en clair si tu "
                 "conclus sur AUTRE. N'ajoute aucun autre "
                 "champ : le résultat n'accepte que ceux-là.")

# ⚠ LE 🚫 SE DIT AU TÉLÉPHONE (10/08/2026). Avant, quelqu'un qui demandait à ne
# plus être appelé n'était pas entendu : rien ne le notait, et il était rappelé
# à la campagne suivante. C'est un manque de courtoisie autant qu'un manque de
# conformité.
#
# ⚠ CE N'EST PAS UNE ISSUE, et la consigne le dit ainsi : la personne peut
# refuser ET demander qu'on ne la rappelle plus, ou accepter cette fois et
# demander qu'on ne la rappelle plus ensuite. L'agent conclut donc TOUJOURS sur
# l'une des trois issues, et coche ce champ EN PLUS.
# ⚠ LA QUESTION QUI MANQUAIT (10/08/2026), et seulement en cascade : refuser
# UNE place ne veut pas dire refuser les suivantes. Sans la poser, RingBack
# rappelait indéfiniment quelqu'un que ça n'intéresse pas — et sa seule
# échappatoire était le 🚫, qui coupe aussi les appels sur SES rendez-vous.
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
    """Les trois parties de ce qui part dans le champ « task » de CALL-E.

    Les textes portent encore leurs [variables] par contact ([identite],
    [rdv_existant]…) tant que substituer() n'a pas été appelée : c'est ce
    qui permet à l'aperçu de l'étape 2 de montrer EXACTEMENT ce qui partira,
    avec les variables encore visibles là où elles seront remplies.
    """

    def __init__(self, presentation, objectif, faits=(), contraintes=None,
                 issues=None, genre=GENRE_CLASSIQUE, entete=ENTETE,
                 conduite=(), dire=None, civilites=None):
        """`dire` TRADUIT LES PHRASES FIXES DE CE MODULE, et rien d'autre.

        ⚠ ON INJECTE LE TRADUCTEUR, ON NE L'IMPORTE PAS. Ce module ne dépend
        d'AUCUN autre module de RingBack — c'est écrit en tête de fichier et
        c'est ce qui permet à `calle_client` comme à `assistant` de s'en
        servir sans se croiser. Aller chercher un dictionnaire ici romprait
        cette règle pour une commodité. L'appelant, lui, sait déjà quelle
        langue est choisie : il passe la fonction.

        `dire` vaut l'identité par défaut : sans elle, ce module rend
        exactement ce qu'il rendait avant, à la lettre.

        `civilites` : le tableau des abréviations à développer (« M. » ->
        « monsieur »). Vide = on ne développe rien — c'est le bon
        comportement hors du français, où « Mr Smith » se lit très bien tel
        quel et où « monsieur Smith » serait une faute.
        """
        self.presentation = presentation or ""
        self.objectif = objectif or ""
        self.faits = list(faits)
        self.contraintes = list(CONTRAINTES if contraintes is None
                                else contraintes)
        self.issues = dict(issues or ISSUES_DEFAUT)
        self.genre = genre
        self.entete = entete
        # Propre à la nature, et souvent vide : voir TITRE_CONDUITE.
        self.conduite = list(conduite or ())
        self.dire = dire or (lambda texte: texte)
        self.civilites = _DEVELOPPE if civilites is None else civilites

    # ------------------------------------------------------- substitution
    def substituer(self, valeurs, presentation=None):
        """Rend une NOUVELLE consigne, valeurs remplacées, lignes vides ôtées.

        valeurs : {code: texte lisible}. Une ligne de faits dont la variable
        reste sans valeur DISPARAÎT (on ne dicte jamais un [crochet] vide) ;
        les contraintes, elles, n'en portent plus aucune.

        presentation : le texte d'ouverture déjà finalisé par l'appelant
        (assistant.finaliser_mission fait ce travail depuis toujours et
        connaît les types des colonnes) ; à défaut, la substitution simple
        est appliquée ici aussi.
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
            # ⚠ LA CONDUITE GARDE SES LIGNES, MÊME SANS VALEUR. Contrairement
            # aux faits, on ne la filtre PAS sur les [variables] restantes :
            # « propose le [creneau_le_plus_proche] » doit rester une étape du
            # déroulé même quand l'agenda n'a rien à proposer — c'est la ligne
            # suivante qui dit alors quoi faire. Un déroulé amputé serait pire
            # qu'un crochet vide.
            [remplacer(ligne) for ligne in self.conduite],
            self.dire, self.civilites)
        return copie

    # ------------------------------------------------------------ rendus
    def texte_presentation(self):
        """La partie ① : le seul passage imposé mot pour mot.

        Le texte est repris TEL QUEL (simplement débarrassé de ses espaces
        de bord) : un message récrit à la main par l'utilisateur — sauts de
        ligne compris — doit partir exactement comme il l'a écrit.
        """
        return "« " + self.presentation.strip() + " »"

    def texte_contexte(self):
        """La partie ② : objectif, faits utiles, contraintes, liberté."""
        lignes = [f"{self.dire(PREFIXE_OBJECTIF)}{self.objectif}"]
        if self.faits:
            lignes.append(self.dire(TITRE_FAITS))
            lignes += [f"- {ligne}" for ligne in self.faits]
        # ⚠ AVANT LES RÈGLES, et numérotée : c'est un déroulé, l'ordre EST
        # l'information. Sous les règles, elle se serait lue comme un interdit
        # de plus.
        if self.conduite:
            lignes.append(self.dire(TITRE_CONDUITE))
            lignes += [f"{rang}. {ligne}"
                       for rang, ligne in enumerate(self.conduite, start=1)]
        lignes.append(self.dire(TITRE_CONTRAINTES))
        lignes += [f"- {ligne}" for ligne in self.contraintes]
        lignes.append(self.dire(LIBERTE))
        return "\n".join(lignes)

    def texte_issues(self):
        """La partie ③ : oui / non / autre, et rien d'autre."""
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
        """LA CONSIGNE COMPLÈTE — exactement ce qui part dans « task ».

        Les civilités sont développées ICI, au dernier moment : c'est le
        seul endroit où « M. Dupont » devient « monsieur Dupont ».
        """
        blocs = [self.dire(self.entete),
                 self.dire(TITRE_PRESENTATION) + "\n"
                 + self.texte_presentation(),
                 self.dire(TITRE_CONTEXTE) + "\n" + self.texte_contexte(),
                 self.dire(TITRE_ISSUES) + "\n" + self.texte_issues()]
        # Dernier filet : ni [entreprise] ni [plage_rappel] ne doivent sortir
        # en crochets. Un appelant qui ne les a pas substitués (essai réel,
        # file d'appels) obtient une phrase vraie plutôt qu'un gabarit.
        # ⚠ LE REPLI DU NOM D'ENTREPRISE SUIT LA LANGUE, LUI AUSSI. Sans nom
        # réglé, la consigne dit « l'établissement » — et ce mot partait en
        # français au milieu d'une consigne anglaise, dans la SORTIE DE
        # SECOURS, celle qui est dite au téléphone à une personne agacée.
        # Trouvé le 02/09/2026 en cherchant le français restant sur les pages
        # RENDUES en anglais : aucune mesure sur les sources ne pouvait le
        # voir, puisque le mot est substitué à l'affichage.
        entier = substituer_cadre("\n\n".join(blocs),
                                  self.dire(ENTREPRISE_INCONNUE),
                                  self.dire(PLAGE_INCONNUE))
        return developper_civilites(entier, self.civilites)

    # --------------------------------------------------------- contrôles
    def codes_attendus(self):
        """Tous les codes de résultat que CETTE consigne autorise.

        Sert aux essais : ils vérifient que chacun appartient bien à l'enum
        du schéma imposé — la boucle est ainsi fermée des deux côtés.
        """
        codes = []
        for cle in ISSUES:
            fixee = self.issues[cle]
            codes.append(fixee["code"])
            if fixee["code_sans_date"]:
                codes.append(fixee["code_sans_date"])
        return codes


def entreprise_lisible(nom):
    """Le nom de l'entreprise, ou de quoi rester dicible sans le connaître."""
    return (nom or "").strip() or ENTREPRISE_INCONNUE


def substituer_cadre(texte, entreprise, plage_rappel):
    """Remplace [entreprise] et [plage_rappel] — jamais laissés en crochets.

    Une contrainte de sécurité (la sortie de secours) ne doit pas tomber
    parce qu'un réglage manque : sans nom d'entreprise, on dit
    « l'établissement », ce qui est vrai.
    """
    return (texte.replace("[entreprise]", entreprise_lisible(entreprise))
            .replace("[plage_rappel]", plage_rappel or ""))
