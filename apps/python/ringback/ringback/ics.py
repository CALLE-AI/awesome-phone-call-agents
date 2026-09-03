"""Import d'agenda au format ICS (iCalendar) — bibliothèque standard.

Lit les événements VEVENT d'un fichier .ics : SUMMARY donne le nom du
client et le motif (séparés par un tiret ou deux-points ; sans séparateur,
tout devient le nom), DTSTART donne la date et l'heure. Particularités du
format gérées ici :
- les lignes PLIÉES (une ligne longue continue sur la suivante, qui
  commence par une espace ou une tabulation) sont recollées — RFC 5545
  § 3.1 impose de plier au-delà de 75 octets, un vrai export le fait
  systématiquement ;
- les caractères échappés de SUMMARY (\\, \\; \\n …) sont rétablis ;
- les dates UTC (suffixe « Z ») sont converties à l'heure LOCALE de la
  machine (datetime.astimezone, aucune base de fuseaux requise) ;
- les dates avec fuseau nommé (DTSTART;TZID=…) sont converties si la
  machine connaît ce fuseau (zoneinfo) ; sinon l'heure murale est gardée
  telle quelle — c'est le repli le plus honnête sans base tzdata ;
- les dates sans fuseau sont prises telles quelles (heure locale) ;
- les événements « journée entière » (VALUE=DATE, sans heure) sont
  REJETÉS avec une erreur française : un rendez-vous a une heure ;
- l'HEURE DE FIN est lue (DTEND, ou DURATION si l'export l'écrit à la
  place — RFC 5545 § 3.6.1 autorise l'une OU l'autre, jamais les deux) et
  convertie en nombre de TRANCHES selon le pas réglé, ARRONDI AU
  SUPÉRIEUR : une consultation d'une heure avec un pas de 15 minutes
  occupe 4 tranches, et 20 minutes en occupent 2 (mieux vaut réserver une
  tranche de trop que vendre une place qui n'existe pas). Sans heure de
  fin lisible, le rendez-vous vaut une tranche, comme avant ;
- STATUS:CANCELLED donne un rendez-vous « annulé » (les autres valeurs,
  CONFIRMED et TENTATIVE, donnent « prévu » : côté agenda elles disent
  seulement que l'organisateur a posé la case, pas que le CLIENT a
  confirmé au téléphone — ce sens-là reste réservé à RingBack).

--------------------------------------------------------------------------
OÙ SE TROUVE UN NUMÉRO DE TÉLÉPHONE DANS UN VRAI FICHIER .ICS
--------------------------------------------------------------------------
Constat après examen de la norme et de ce qu'écrivent réellement Google
Agenda et Outlook / Exchange (voir exemple_agenda_realiste.ics, qui
reproduit les deux structures ligne à ligne) :

1. ATTENDEE et ORGANIZER portent une valeur de type CAL-ADDRESS, c'est-à-dire
   un URI. RFC 5545 § 3.3.3 : pour une adresse de courrier la valeur DOIT
   être un URI « mailto », mais toute autre forme d'URI enregistrée à l'IANA
   est admise — dont « tel: » (RFC 3966). Un agenda de cabinet qui inscrit
   le patient comme participant écrit donc
   ATTENDEE;CN="Mme Untel":tel:+33639980051.
   En pratique, l'immense majorité des ATTENDEE restent des mailto: — c'est
   alors une adresse de courriel, PAS un téléphone : on l'ignore.
2. CONTACT (RFC 5545 § 3.8.4.2) existe exactement pour ça — « contact
   information […] associated with the calendar component ». Les exemples
   de la norme elle-même portent un numéro :
   CONTACT:Jim Dolittle\\, ABC Industries\\, +1-919-555-1234
   CONTACT;CN="John Smith":tel:+1-617-555-1234
   Peu d'agendas grand public l'écrivent, mais les logiciels métier oui.
3. DESCRIPTION est le cas de LOIN le plus fréquent : c'est le champ « notes »
   de l'événement. Un logiciel de prise de rendez-vous (ou le praticien
   lui-même) y écrit « Téléphone : 06 39 98 00 51 ». Outlook double ce champ
   d'un X-ALT-DESC;FMTTYPE=text/html qui contient le MÊME texte en HTML.
4. LOCATION contient parfois le numéro du lieu (rare, et c'est celui du
   cabinet, pas du client) : cherché en dernier.

Ordre de recherche retenu, du plus explicite au plus incertain :
CONTACT, puis ATTENDEE/ORGANIZER en « tel: », puis DESCRIPTION, puis
X-ALT-DESC, puis LOCATION. Dans les champs de texte libre (3 et 4) un
numéro n'est retenu que s'il est ÉTIQUETÉ (« tél », « téléphone »,
« portable », « mobile », « GSM », « n° »…) ou s'il est le SEUL numéro
plausible du texte — sinon on ne devine pas.

Repli inchangé et honnête : quand aucun numéro n'est trouvé, le client est
créé SANS numéro (telephone = ""), et l'écran « à compléter » permet de le
renseigner ensuite. AUCUN numéro n'est jamais inventé ni reconstitué.

Sources : RFC 5545 (§ 3.1 pliage, § 3.3.3 CAL-ADDRESS, § 3.8.4.1 ATTENDEE,
§ 3.8.4.2 CONTACT) — https://www.rfc-editor.org/rfc/rfc5545.html ;
RFC 3966 (URI « tel ») — https://www.rfc-editor.org/rfc/rfc3966 ;
propriétés X-MICROSOFT-CDO-* d'Exchange —
https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/

Tous les messages d'erreur sont en français.
"""

import datetime
import re

from . import horaires, saisie

# Séparateurs acceptés dans SUMMARY pour distinguer « nom » et « motif ».
_SEPARATEURS_SUMMARY = (" — ", " – ", " - ", " : ", ": ")
MOTIF_PAR_DEFAUT = "Rendez-vous importé de l'agenda"

# Propriétés relevées en plus de SUMMARY / DTSTART, dans l'ordre où l'on y
# cherche un numéro (les trois premières sont explicites, les suivantes du
# texte libre où il faut une étiquette).
PROPRIETES_TELEPHONE = ("CONTACT", "ATTENDEE", "ORGANIZER", "DESCRIPTION",
                        "X-ALT-DESC", "LOCATION")
_TEXTE_LIBRE = ("DESCRIPTION", "X-ALT-DESC", "LOCATION")

# Un numéro français plausible dans du texte : +33 / 0033 / 0 puis 9 chiffres,
# séparés au choix par espace, point, tiret ou insécable.
_NUMERO = re.compile(
    r"(?:\+\s?33|0033|0)[\s.\- ]?[1-9](?:[\s.\- ]?\d{2}){4}")
# Étiquettes qui DÉSIGNENT un numéro dans du texte libre (« Tél. : … »).
_ETIQUETTE = re.compile(
    r"\b(?:t[ée]l[ée]phones?|t[ée]l|mobile|portable|gsm|phone|"
    r"joignable(?:\s+au)?|num[ée]ro|n[°o])[\s.:=—–-]*$",
    re.IGNORECASE)
_BALISE_HTML = re.compile(r"<[^>]+>")

# Une DURATION au format RFC 5545 § 3.3.6 : « PT1H », « PT1H30M », « P1DT2H »,
# « P2W ». Les secondes sont lues mais comptent comme du temps, pas comme une
# tranche à part : tout finit en minutes.
_DUREE_ICS = re.compile(
    r"^([+-])?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$",
    re.IGNORECASE)


def _deplier(texte):
    """Recolle les lignes pliées du format ICS (RFC 5545, section 3.1).

    Une ligne qui commence par une espace ou une tabulation est la suite
    de la précédente (le premier caractère blanc est retiré).
    """
    lignes_brutes = texte.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    lignes = []
    for ligne in lignes_brutes:
        if ligne[:1] in (" ", "\t") and lignes:
            lignes[-1] += ligne[1:]
        else:
            lignes.append(ligne)
    return lignes


def _desechapper(texte):
    """Rétablit les caractères échappés d'une valeur ICS (\\, \\; \\n …)."""
    return re.sub(r"\\([\\;,nN])",
                  lambda m: " " if m.group(1) in "nN" else m.group(1), texte)


def _heure_locale(valeur, parametres):
    """Convertit une valeur DTSTART en ISO 8601 local à la minute.

    Lève ValueError (message français) si la valeur est inutilisable.
    """
    parametres = {clef.upper(): val
                  for clef, _, val in (p.partition("=") for p in parametres)}
    if parametres.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", valeur):
        raise ValueError("événement « journée entière » sans heure : un "
                         "rendez-vous doit avoir une heure précise.")
    brut = valeur.rstrip("Zz")
    for gabarit in ("%Y%m%dT%H%M%S", "%Y%m%dT%H%M"):
        try:
            moment = datetime.datetime.strptime(brut, gabarit)
            break
        except ValueError:
            continue
    else:
        raise ValueError(f"date illisible : « {valeur} » (attendu "
                         "AAAAMMJJTHHMMSS, avec « Z » final pour l'UTC).")
    if valeur[-1:] in "Zz":
        # UTC -> heure locale de la machine (aucune base de fuseaux requise).
        moment = (moment.replace(tzinfo=datetime.timezone.utc)
                  .astimezone().replace(tzinfo=None))
    elif "TZID" in parametres:
        # Fuseau nommé : converti si la machine le connaît, sinon l'heure
        # murale du fuseau d'origine est gardée telle quelle (repli honnête).
        try:
            import zoneinfo
            fuseau = zoneinfo.ZoneInfo(parametres["TZID"])
            moment = (moment.replace(tzinfo=fuseau)
                      .astimezone().replace(tzinfo=None))
        except Exception:
            pass
    return moment.isoformat(timespec="minutes")


def _minutes_de_duration(valeur):
    """Les minutes d'une DURATION ICS (« PT1H30M » → 90), ou None si illisible.

    Une durée négative ou nulle rend None : elle ne dit rien d'utilisable
    sur l'occupation d'une place, et on n'invente pas à sa place.
    """
    trouve = _DUREE_ICS.match((valeur or "").strip())
    if not trouve:
        return None
    signe, semaines, jours, heures, minutes, secondes = trouve.groups()
    total = 0
    if semaines:
        total += int(semaines) * 7 * 24 * 60
    if jours:
        total += int(jours) * 24 * 60
    if heures:
        total += int(heures) * 60
    if minutes:
        total += int(minutes)
    if secondes:
        total += int(secondes) / 60
    if signe == "-" or total <= 0:
        return None
    return total


def _minutes_occupees(evenement, debut_iso):
    """La durée RÉELLE de l'événement en minutes, ou None si elle est absente.

    Deux sources possibles, dans l'ordre de la norme (RFC 5545 § 3.6.1 :
    DTEND et DURATION s'excluent, mais un export abîmé peut porter les
    deux — DTEND, plus explicite, gagne alors) :
    1. DTEND, lu exactement comme DTSTART (UTC, fuseau nommé, heure locale) ;
    2. DURATION, quand l'export écrit la durée plutôt que la fin.
    Une fin ANTÉRIEURE ou ÉGALE au début ne rend rien : on ne devine pas.
    """
    fin = evenement.pop("dtend", None)
    if fin is not None:
        valeur, parametres = fin
        try:
            fin_iso = _heure_locale(valeur, parametres)
        except ValueError:
            fin_iso = None          # fin illisible : on n'invente pas
        if fin_iso:
            ecart = (datetime.datetime.fromisoformat(fin_iso)
                     - datetime.datetime.fromisoformat(debut_iso))
            minutes = ecart.total_seconds() / 60
            if minutes > 0:
                return minutes
    duree = evenement.pop("duration", None)
    if duree is not None:
        return _minutes_de_duration(duree)
    return None


def tranches_de_minutes(minutes, pas):
    """Le nombre de TRANCHES qu'occupent ces minutes, ARRONDI AU SUPÉRIEUR.

    Arrondir au supérieur plutôt qu'au plus proche est un choix assumé :
    sous-estimer une occupation ferait vendre au téléphone une place déjà
    prise, alors que sur-estimer coûte au pire une tranche réservée pour
    rien. 60 minutes au pas de 15 donnent 4 tranches ; 20 minutes en
    donnent 2. Toujours au moins 1.
    """
    if not minutes or minutes <= 0:
        return 1
    pas = max(int(pas or 1), 1)
    return max(1, -(-int(round(minutes)) // pas))


def _numeros_plausibles(texte):
    """Les numéros français lisibles dans CE texte : [(numéro, position)].

    Normalisés, sans doublon, dans l'ordre d'apparition. Chaque candidat
    passe par saisie.valider_telephone : ce qui n'est pas un vrai numéro
    français est écarté, rien n'est « réparé » au jugé.
    """
    trouves, deja_vus = [], set()
    for occurrence in _NUMERO.finditer(texte or ""):
        brut = occurrence.group(0).replace(" ", " ")
        if brut.startswith("0033"):
            brut = "+33" + brut[4:]
        try:
            numero = saisie.valider_telephone(brut)
        except saisie.SaisieInvalide:
            continue
        if numero in deja_vus:
            continue
        deja_vus.add(numero)
        trouves.append((numero, occurrence.start()))
    return trouves


def _numero_dans_texte(texte, exiger_etiquette=True):
    """Le numéro d'un champ de texte, ou "" si rien de sûr.

    exiger_etiquette=True (notes, lieu) : « Téléphone : 06 39 98 00 51 » est
    retenu ; un texte qui porte plusieurs nombres de dix chiffres sans
    étiquette ne l'est pas — on ne devine pas lequel serait le bon.
    exiger_etiquette=False (propriété CONTACT) : la propriété EST une
    information de contact, son premier numéro est donc le bon.
    """
    texte = _BALISE_HTML.sub(" ", texte or "")
    candidats = _numeros_plausibles(texte)
    if not candidats:
        return ""
    for numero, position in candidats:
        if _ETIQUETTE.search(texte[max(0, position - 40):position]):
            return numero
    if not exiger_etiquette or len(candidats) == 1:
        return candidats[0][0]
    return ""


def _telephone_de_lurl(valeur):
    """Le numéro d'une valeur CAL-ADDRESS « tel: » (RFC 3966), sinon "".

    Une valeur « mailto: » est une adresse de courriel : elle ne rend rien.
    """
    valeur = (valeur or "").strip()
    if not valeur.lower().startswith("tel:"):
        return ""
    candidats = _numeros_plausibles(valeur[4:])
    return candidats[0][0] if candidats else ""


def _telephone_evenement(brut):
    """Le numéro du client trouvé dans CET événement, ou "" (jamais inventé).

    Ordre : CONTACT (URI tel:, puis texte — la propriété prévue par la
    norme pour ça), ATTENDEE / ORGANIZER en « tel: », puis les champs de
    texte libre (DESCRIPTION, X-ALT-DESC d'Outlook, LOCATION).
    """
    for propriete in PROPRIETES_TELEPHONE:
        for valeur in brut.get(propriete, ()):
            if propriete == "CONTACT":
                numero = (_telephone_de_lurl(valeur)
                          or _numero_dans_texte(valeur, exiger_etiquette=False))
            elif propriete in _TEXTE_LIBRE:
                numero = _numero_dans_texte(valeur)
            else:  # ATTENDEE / ORGANIZER : seul un URI « tel: » est un numéro
                numero = _telephone_de_lurl(valeur)
            if numero:
                return numero
    return ""


def _nom_et_motif(summary):
    """Découpe « Nom — Motif » ; sans séparateur, tout est le nom."""
    for separateur in _SEPARATEURS_SUMMARY:
        if separateur in summary:
            nom, motif = summary.split(separateur, 1)
            return nom.strip(), motif.strip()
    return summary.strip(), MOTIF_PAR_DEFAUT


def analyser_ics(texte):
    """Analyse un fichier ICS ; rend (evenements, erreurs).

    evenements = [{"nom", "motif", "horaire", "telephone", "statut",
    "minutes"}] (horaire en ISO 8601 local ; telephone = "" si l'agenda
    n'en porte aucun — jamais de numéro inventé ; minutes = la durée lue
    dans DTEND ou DURATION, ou None quand l'agenda n'en donne pas) ;
    erreurs = messages français, un par événement rejeté. Lève
    saisie.SaisieInvalide si le fichier ne contient AUCUN événement.
    """
    evenements, erreurs = [], []
    courant, numero = None, 0
    for ligne in _deplier(texte):
        entete, _, valeur = ligne.partition(":")
        morceaux = entete.split(";")
        propriete = morceaux[0].strip().upper()
        parametres = morceaux[1:]
        if propriete == "BEGIN" and valeur.strip().upper() == "VEVENT":
            numero += 1
            courant = {"brut": {}}
        elif propriete == "END" and valeur.strip().upper() == "VEVENT":
            if courant is not None:
                erreur = _valider_evenement(courant, numero)
                if erreur:
                    erreurs.append(erreur)
                else:
                    evenements.append(courant)
            courant = None
        elif courant is not None:
            if propriete == "SUMMARY":
                courant["summary"] = _desechapper(valeur.strip())
            elif propriete == "DTSTART":
                courant["dtstart"] = (valeur.strip(), parametres)
            elif propriete == "DTEND":
                courant["dtend"] = (valeur.strip(), parametres)
            elif propriete == "DURATION":
                courant["duration"] = valeur.strip()
            elif propriete == "STATUS":
                courant["status"] = valeur.strip().upper()
            elif propriete in PROPRIETES_TELEPHONE:
                # Une même propriété peut revenir (plusieurs ATTENDEE) : on
                # les garde toutes, dans l'ordre du fichier.
                courant["brut"].setdefault(propriete, []).append(
                    _desechapper(valeur.strip()))
    if numero == 0:
        raise saisie.SaisieInvalide(
            "Aucun événement (VEVENT) trouvé : est-ce bien un fichier "
            "d'agenda au format ICS ?")
    return evenements, erreurs


def _valider_evenement(evenement, numero):
    """Complète l'événement (nom, motif, horaire, téléphone, statut) ;
    rend une erreur française ou None."""
    titre = evenement.pop("summary", "").strip()
    brut = evenement.pop("brut", {})
    statut_ics = evenement.pop("status", "")
    reference = f"Événement n°{numero}" + (f" (« {titre} »)" if titre else "")
    if not titre:
        return f"{reference} : pas de titre (SUMMARY) — impossible d'en tirer un nom."
    if "dtstart" not in evenement:
        return f"{reference} : pas de date (DTSTART)."
    valeur, parametres = evenement.pop("dtstart")
    try:
        evenement["horaire"] = _heure_locale(valeur, parametres)
    except ValueError as erreur:
        return f"{reference} : {erreur}"
    evenement["minutes"] = _minutes_occupees(evenement, evenement["horaire"])
    nom, motif = _nom_et_motif(titre)
    try:
        evenement["nom"] = saisie.valider_nom(nom)
        evenement["motif"] = saisie.valider_motif(motif)
    except saisie.SaisieInvalide as erreur:
        return f"{reference} : {erreur}"
    evenement["telephone"] = _telephone_evenement(brut)
    evenement["statut"] = "annulé" if statut_ics == "CANCELLED" else "prévu"
    return None


def importer_ics(base, texte, preferences=None, remplacer_tout=False,
                 bilan=None):
    """Importe les événements d'un ICS ; rend (importés, erreurs).

    Chaque événement valide devient un rendez-vous « prévu » (la règle du
    manqué le basculera s'il est déjà passé ; STATUS:CANCELLED donne
    « annulé ») rattaché à un client dont le numéro est celui LU dans
    l'agenda quand il s'y trouve — sinon un client SANS numéro, que
    l'écran « à compléter » sert ensuite à renseigner. Comme pour le CSV :
    les bons événements s'importent même si d'autres sont rejetés, chacun
    avec son message.

    preferences : les réglages, pour connaître le PAS (durée d'une
    tranche). Avec eux, l'heure de fin lue dans l'agenda devient un nombre
    de tranches — un rendez-vous d'une heure occupe réellement une heure de
    planning au lieu d'une seule tranche. Sans eux (essais isolés), le pas
    par défaut s'applique : la durée reste lue, jamais inventée.

    remplacer_tout : vide l'agenda À VENIR avant d'importer (case « Remplacer
    entièrement l'agenda »). Le passé n'est pas touché.

    bilan : dictionnaire À REMPLIR, quand l'appelant veut savoir ce que
    l'import a déplacé — « remplaces » (rendez-vous dont la place a été prise)
    et « vides » (retirés par « remplacer entièrement »). Un dictionnaire
    plutôt qu'une troisième valeur de retour : vingt appelants dépaquettent
    déjà ce couple, et leur casser les jambes pour un compte aurait été un
    mauvais échange.
    """
    # ⚠ « preferences=None » est admis par pas_minutes depuis le 10/08/2026 :
    # aucun réglage vaut les valeurs par défaut. Le repli n'a plus à être
    # récrit ici.
    pas = horaires.pas_minutes(preferences)
    evenements, erreurs = analyser_ics(texte)
    # ⚠ VIDER D'ABORD, IMPORTER ENSUITE. L'inverse aurait retiré les
    # rendez-vous qu'on venait de poser.
    vides = (horaires.vider_l_agenda_a_venir(base, preferences)
             if remplacer_tout else [])
    importes, remplaces = 0, []
    for evenement in evenements:
        nom = evenement["nom"]
        telephone = evenement.get("telephone") or ""
        client_id = None
        if telephone:
            # Déjà connu avec ce numéro (écrit autrement, « +33 … » contre
            # « 0… ») : on reprend SA fiche plutôt que d'en faire une seconde.
            client_id = base.client_equivalent(nom, telephone)
            if client_id is None:
                # Ce nom est déjà en base « à compléter » : l'agenda apporte
                # enfin son numéro, on complète la fiche existante.
                client_id = base.client_sans_numero_par_nom(nom)
                if client_id is not None:
                    base.mettre_a_jour_telephone(client_id, telephone)
        else:
            # L'agenda ne porte aucun numéro : si ce nom est déjà connu AVEC
            # un numéro, le rendez-vous rejoint cette fiche — rien n'est
            # inventé, on relie seulement à ce qui existe déjà.
            telephone = base.telephone_par_nom(nom) or ""
        if client_id is None:
            client_id = base.obtenir_ou_creer_client(nom, telephone)
        rdv_id = base.ajouter_rendezvous(
            client_id, evenement["horaire"], evenement["motif"],
            statut=evenement.get("statut", "prévu"),
            duree_tranches=tranches_de_minutes(evenement.get("minutes"), pas))
        # ⚠ APRÈS L'INSERTION, jamais avant : on relit l'horaire et la durée
        # tels qu'ils ont été ÉCRITS, et le nouveau ne se gêne pas lui-même.
        remplaces.extend(
            horaires.remplacer_sur_le_creneau(base, preferences, rdv_id))
        importes += 1
    if bilan is not None:
        bilan["remplaces"] = remplaces
        bilan["vides"] = vides
    return importes, erreurs
