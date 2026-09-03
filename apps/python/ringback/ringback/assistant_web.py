"""Assistant de campagne — pages web et poste de pilotage (mixin du serveur).

Trois étapes (spécification v1.1) :
① « /assistant »          : les huit cartes de nature, politique d'appel
                            par défaut affichée sur chaque carte ;
② « /assistant/message »  : aperçu du prompt VIVANT (JavaScript de la page :
                            il se met à jour en tapant, sans appel serveur),
                            informations générales de la nature (⛔ =
                            obligatoire), options de comportement, champs de
                            contact (Identité et Téléphone non supprimables,
                            champs personnalisés ajoutables). Le passage à
                            l'étape ③ est REFUSÉ côté serveur tant qu'un ⛔
                            manque — l'aperçu n'est qu'un confort ;
③ « /assistant/liste »    : la grille dont les colonnes sont les champs de
                            l'étape ② — remplie par saisie directe, collage,
                            CSV, agenda ICS ou depuis la base (les briques
                            saisie.py / ics.py / generation.py sont
                            RÉUTILISÉES) ; « Valider » crée la campagne en
                            état « prête » SANS appeler personne.

Le poste de pilotage (« /campagne?id=N » pour une campagne de l'assistant) :
états de la spécification (accepté mis en valeur avec l'information clé,
refusé, à recontacter avec échéance, injoignable (N), à rappeler par un
humain avec la demande en clair, exclu, épargné), compteurs, et les
commandes ▶ Démarrer → ⏸ Pause / ⏹ Arrêter qui agissent ENTRE deux appels
(un appel en cours va à son terme), reprise possible.

Ce qui est reporté est affiché « à venir », grisé — jamais simulé :
l'exécution automatique des relances (elles s'enregistrent et s'affichent ;
le geste reste le bouton de la page 🔁 Relances).

▶ Démarrer passe par un GESTE CONSCIENT (§8.1) : le travail est double —
un rendez-vous pris ou déplacé au téléphone change l'agenda LOCAL de
RingBack **et** entre au cahier des changements à reporter ailleurs. Les
créneaux annoncés étant déduits de cet agenda, un agenda périmé fait
proposer des places déjà prises dans la vraie vie. Le clic sur ▶ ouvre donc
un panneau — au moment de démarrer, et nulle part ailleurs — qui porte les
CHIFFRES DU JOUR (rendez-vous connus sur la période, places libres
calculées, premières places qui seront annoncées, date du dernier import) et
dit franchement les signes objectifs d'un agenda douteux. Sans le clic de
confirmation, aucun appel ne part.

Le poste de pilotage porte aussi le CAHIER DES CHANGEMENTS (§8.1) : la
liste de ce qu'il reste à reporter dans le logiciel de planification de
l'établissement — lisible à l'écran, copiable d'un geste, exportable en CSV
généré à la volée (jamais stocké).

Règle de confidentialité inchangée : les numéros restent côté serveur
(brouillon) et ne sortent que MASQUÉS dans les pages.
"""

import datetime
import html
import json
import logging
import urllib.parse

from . import (assistant, campagnes, consigne, db, essai_reel,
               etats_clients, langue,
               horaires, planificateur, saisie, themes)

journal = logging.getLogger("ringback.assistant_web")


def _selecteur(nom, choix, retenu, identifiant=None, vide=None, forme=None):
    """Une liste déroulante — préférée à une pile de boutons radio.

    `vide` ajoute une entrée « à choisir » en tête : elle sert quand aucun
    défaut ne doit être imposé (l'ordre d'appel, par exemple).

    `forme` rattache le champ à un formulaire par son identifiant, même s'il
    est écrit AILLEURS dans la page (attribut « form » de HTML). C'est ce qui
    permet au panneau de la règle de vivre à côté de la grille tout en partant
    avec elle, quel que soit le bouton cliqué — voir `_corps_regle`.
    """
    lignes = []
    if vide is not None:
        marque = " selected" if not retenu else ""
        lignes.append(f'<option value=""{marque}>{html.escape(vide)}</option>')
    for code, libelle in choix:
        marque = " selected" if code == retenu else ""
        lignes.append(f'<option value="{html.escape(code)}"{marque}>'
                      f"{html.escape(libelle)}</option>")
    ident = f' id="{identifiant}"' if identifiant else ""
    attache = f' form="{forme}"' if forme else ""
    return (f'<select class="select-option" name="{nom}"{ident}{attache}>'
            f'{"".join(lignes)}</select>')


ETAPES = (("La nature", "/assistant"),
          ("Le message", "/assistant/message"),
          ("Les personnes", "/assistant/liste"))


def _fil_ariane(courante, identifiant=None, etape3_ouverte=False):
    """Le fil d'Ariane : trois ronds, un trait d'avancement, noms cliquables.

    `courante` vaut 1, 2 ou 3. Une étape n'est cliquable que si elle est
    réellement atteignable : l'étape ② demande un brouillon, l'étape ③
    demande en plus que les contrôles ⛔ de l'étape ② soient passés une
    fois (etape3_ouverte) — jamais de lien qui mène à un refus.
    """
    elements = []
    for rang, (nom, chemin) in enumerate(ETAPES, start=1):
        if rang == courante:
            lien = None                      # on y est déjà
        elif rang == 1:
            lien = chemin                    # changer de nature : toujours
        elif identifiant and (rang == 2 or etape3_ouverte):
            lien = f"{chemin}?b={urllib.parse.quote(identifiant)}"
        else:
            lien = None                      # étape pas encore atteignable
        classe = "fa-etape"
        if rang < courante:
            classe += " fa-faite"
        elif rang == courante:
            classe += " fa-courante"
        if lien is None and rang != courante:
            classe += " fa-bloquee"
        interieur = ('<span class="fa-rond"></span>'
                     f'<span class="fa-nom">{rang}. {html.escape(nom)}</span>')
        # Un identifiant stable par étape (fa-etape-1/2/3) : c'est par lui que
        # l'écran est désigné sans dépendre de la position dans la page.
        ident = f' id="fa-etape-{rang}"'
        if lien:
            elements.append(
                f'<a{ident} class="{classe}" href="{lien}">{interieur}</a>')
        else:
            marque = ' aria-current="step"' if rang == courante else ""
            elements.append(
                f'<span{ident} class="{classe}"{marque}>{interieur}</span>')
        if rang < len(ETAPES):
            fait = " fa-trait-fait" if rang < courante else ""
            elements.append(f'<span class="fa-trait{fait}"></span>')
    return ('<nav class="fil-ariane" aria-label="Étapes de la création">'
            f'{"".join(elements)}</nav>')


def _bascule_mode(mode):
    """Les deux modes de saisie, côte à côte, en haut du formulaire.

    Deux boutons plutôt qu'un sélecteur : chaque choix ouvre une interface
    différente (c'est l'exception établie du 28/07/2026), et l'utilisateur
    voit d'un coup d'œil dans lequel il se trouve.

    ⚠ La bascule ne recharge RIEN : le mode avancé est déjà dans la page,
    simplement masqué. Basculer est donc instantané et ne peut rien perdre —
    y compris une saisie en cours dans un champ du mode avancé.
    """
    boutons = []
    for code, libelle in assistant.MODES_FORMULAIRE.items():
        actif = " actif" if code == mode else ""
        presse = "true" if code == mode else "false"
        boutons.append(
            f'<button type="button" class="bascule-mode{actif}" '
            f'data-mode="{code}" aria-pressed="{presse}">'
            f"{html.escape(libelle)}</button>")
    return ('<div class="barre-mode" role="group" aria-label="Mode de saisie">'
            '<span class="sourd">Formulaire :</span>'
            + "".join(boutons)
            + '<span class="sourd mode-explication" data-simplifie="'
              "seuls les champs à remplir sont montrés ; le reste garde la "
              'valeur des ⚙ Réglages" data-avance="tout est montré, y compris '
              'ce qui a déjà une valeur par défaut">'
            + html.escape(_EXPLICATION_MODE[mode]) + "</span></div>")


_EXPLICATION_MODE = {
    assistant.MODE_SIMPLIFIE: ("seuls les champs à remplir sont montrés ; le "
                               "reste garde la valeur des ⚙ Réglages"),
    assistant.MODE_AVANCE: ("tout est montré, y compris ce qui a déjà une "
                            "valeur par défaut"),
}


def _script_mode(mode):
    """La bascule : elle change ce qu'on VOIT, et retient le choix.

    Le mode est écrit sur <main> ; la feuille de style fait le reste. Le
    choix part au serveur en arrière-plan pour être retrouvé à la campagne
    suivante — mais l'affichage, lui, a déjà basculé : on n'attend pas le
    réseau pour montrer ce qui est déjà là.

    Sans JavaScript, le mode reste celui des Réglages et TOUT est visible en
    avancé : aucune fonction n'est perdue, seule la bascule immédiate l'est.
    """
    return """<script>
(function(){
var boutons=document.querySelectorAll('.bascule-mode');
var zone=document.querySelector('main');
if(!boutons.length||!zone){return}
function poser(mode){
  zone.setAttribute('data-mode',mode);
  Array.prototype.forEach.call(boutons,function(b){
    var sien=b.getAttribute('data-mode')===mode;
    b.classList.toggle('actif',sien);
    b.setAttribute('aria-pressed',sien?'true':'false');});
  var dit=document.querySelector('.mode-explication');
  if(dit){dit.textContent=dit.getAttribute('data-'+mode)||''}}
/* Le choix N'EST PLUS RETENU d'une campagne à l'autre : chaque formulaire
   s'ouvre en simplifié (décision du propriétaire, 02/08/2026). La bascule
   reste entière dans la page — et comme les champs du mode avancé sont là
   quel que soit le mode, en changer ne peut rien perdre. */
Array.prototype.forEach.call(boutons,function(b){
  b.addEventListener('click',function(){poser(b.getAttribute('data-mode'))});});
})();
</script>"""


ONGLETS_ETAPE2 = (("options", "B. Options de comportement"),
                  ("apercu", "C. Aperçu du message"))


def _menu_etape2():
    """Le menu horizontal du mode avancé : B et C, une seule à la fois.

    ⚠ SA DEMANDE DU 15/08/2026 : « le mode avancé fait apparaître un menu
    horizontal avec l'option B. Options de comportement et l'option C. Aperçu
    du message. Cliquer fait apparaître l'un ou l'autre des formulaires. »

    Les deux blocs s'empilaient : la page devenait longue et il fallait la
    faire défiler pour atteindre l'aperçu.

    ⚠ CE SONT DES <button type="button">, jamais des liens ni des boutons de
    soumission : ce formulaire est celui de l'étape 2, et un bouton sans type
    l'aurait envoyé au premier clic sur un onglet.

    ⚠ ET LES DEUX PANNEAUX RESTENT DANS LA PAGE, seulement masqués. Ils
    portent des champs qui doivent partir avec le formulaire même si on ne les
    a jamais ouverts — c'est la même règle que la bascule simplifié/avancé :
    « basculer ne perd rien ».
    """
    entrees = "".join(
        f'<button type="button" class="onglet-etape2" id="onglet-{code}" '
        f'role="tab" data-panneau="panneau-{code}" '
        f'aria-controls="panneau-{code}" '
        f'aria-selected="{"true" if rang == 0 else "false"}">{libelle}</button>'
        for rang, (code, libelle) in enumerate(ONGLETS_ETAPE2))
    return f'<div class="menu-etape2" role="tablist">{entrees}</div>'


def _script_onglets_etape2():
    """Le clic qui change de panneau. Sans JavaScript, tout reste visible.

    ⚠ LE REPLI EST « TOUT MONTRER », pas « tout cacher » : les panneaux sont
    masqués par ce script, jamais par le HTML servi. Un navigateur sans
    JavaScript affiche donc les deux à la suite — c'est exactement l'écran
    d'avant, et aucun réglage n'est hors d'atteinte.
    """
    return """<script>
(function(){
var menu=document.querySelector('.menu-etape2');
if(!menu){return}
var onglets=menu.querySelectorAll('.onglet-etape2');
function montrer(code){
  Array.prototype.forEach.call(onglets,function(o){
    var sien=o.getAttribute('data-panneau')===code;
    o.setAttribute('aria-selected',sien?'true':'false');
    var p=document.getElementById(o.getAttribute('data-panneau'));
    if(p){p.hidden=!sien}});}
Array.prototype.forEach.call(onglets,function(o){
  o.addEventListener('click',function(){
    montrer(o.getAttribute('data-panneau'));});});
montrer(onglets[0].getAttribute('data-panneau'));
})();
</script>"""


def _choix_panneaux(nom, choix, retenu):
    """Des boutons radio quand chaque choix OUVRE UNE INTERFACE différente.

    C'est l'exception à la règle « un sélecteur plutôt qu'une pile de radios » :
    ici les voies possibles se voient d'un coup d'œil avant d'en ouvrir une.
    Pour un simple filtre, on garde le sélecteur.
    """
    boutons = []
    for code, libelle in choix:
        marque = " checked" if code == retenu else ""
        boutons.append(
            f'<div class="ligne-option"><label class="option">'
            f'<input type="radio" name="{nom}" value="{code}"{marque} '
            f'data-panneau="panneau-{code}"><span>{html.escape(libelle)}</span>'
            f"</label></div>")
    return f'<div class="choix-panneaux">{"".join(boutons)}</div>'


def _script_periode(identifiant):
    """Changer d'année ou de semaine recharge le SEUL panneau des dates.

    Les semaines dépendent de l'année (52 ou 53), les jours dépendent de la
    semaine ET des horaires d'ouverture : c'est le serveur qui sait, pas le
    navigateur. On va donc lui demander — mais on ne recharge que ce
    panneau-ci, jamais la page (règle du propriétaire).

    Sans JavaScript, les listes restent celles du chargement : on choisit
    quand même sa semaine dans l'année affichée, et le bouton fonctionne.
    """
    return """<script>
(function(){
var panneau=document.getElementById('panneau-rendezvous');
if(!panneau||!window.fetch){return}
function recharger(){
  var champs=panneau.querySelectorAll('select');
  var morceaux=['b=%s'];
  Array.prototype.forEach.call(champs,function(c){
    if(c.name){morceaux.push(
      encodeURIComponent(c.name)+'='+encodeURIComponent(c.value))}});
  panneau.classList.add('en-attente');
  fetch('/assistant/periode?'+morceaux.join('&'))
   .then(function(r){return r.ok?r.text():null})
   .then(function(t){
     panneau.classList.remove('en-attente');
     if(t){panneau.innerHTML=t}})
   .catch(function(){panneau.classList.remove('en-attente')});}
panneau.addEventListener('change',function(e){
  if(e.target&&(e.target.name==='annee'||e.target.name==='semaine')){
    recharger()}});
})();
</script>""" % urllib.parse.quote(identifiant)


def _script_regle(identifiant):
    """Changer la source recharge le SEUL panneau de la règle.

    Pourquoi le serveur et pas le navigateur : c'est lui qui sait quels réglages
    ont un sens pour la source choisie — la fenêtre « jusqu'où après la place »
    n'agit que sur les rendez-vous à venir, et les libellés d'ordre changent de
    sens avec la source. Le navigateur ne peut pas le deviner sans recopier la
    règle, et deux copies d'une règle finissent toujours par diverger.

    Sans JavaScript, rien n'est perdu : le panneau se recale au clic sur
    « Enregistrer la règle », qui repasse par le serveur de toute façon.
    """
    return """<script>
(function(){
var panneau=document.getElementById('panneau-regle');
if(!panneau||!window.fetch){return}
panneau.addEventListener('change',function(e){
  if(!e.target||e.target.name!=='regle_source'){return}
  var morceaux=['b=%s'];
  Array.prototype.forEach.call(
    panneau.querySelectorAll('select,input[name]'),function(c){
      if(c.name){morceaux.push(
        encodeURIComponent(c.name)+'='+encodeURIComponent(c.value))}});
  panneau.classList.add('en-attente');
  fetch('/assistant/regle?'+morceaux.join('&'))
   .then(function(r){return r.ok?r.text():null})
   .then(function(t){
     panneau.classList.remove('en-attente');
     if(t){panneau.innerHTML=t}})
   .catch(function(){panneau.classList.remove('en-attente')});});
})();
</script>""" % urllib.parse.quote(identifiant)


def _script_grille():
    """La couleur d'une case obligatoire s'éteint dès qu'on la remplit.

    Deux événements, pas un : « input » couvre la frappe au clavier, et
    « change » couvre le sélecteur de date d'un champ datetime-local, qui se
    remplit à la souris sans qu'aucune touche soit pressée. N'écouter que
    « input » laisserait une date choisie à la souris en rouge.

    Un champ vidé à nouveau se rallume : la couleur dit l'état RÉEL du champ,
    pas « on y a touché une fois ».

    Sans JavaScript, la couleur reste jusqu'au prochain aller-retour avec le
    serveur, qui la recalcule. Rien n'est perdu, c'est juste moins vivant.
    """
    return """<script>
(function(){
var table=document.querySelector('form[action="/assistant/liste"] table');
if(!table){return}
function juger(champ){
  if(!champ||!champ.classList){return}
  if(champ.value&&champ.value.trim()){champ.classList.remove('manque')}
  else if(champ.dataset.obligatoire==='1'){champ.classList.add('manque')}}
Array.prototype.forEach.call(table.querySelectorAll('input.manque'),
  function(c){c.dataset.obligatoire='1'});
['input','change'].forEach(function(evenement){
  table.addEventListener(evenement,function(e){juger(e.target)});});
})();
</script>"""


def _choix_panneaux_colonnes(nom, gauche, droite, retenu):
    """Les voies de remplissage rangées en DEUX COLONNES, avec un intertitre.

    Demande du propriétaire (02/08/2026) : six voies en une seule pile, cela
    ne se lit plus. Les deux colonnes répondent à deux questions différentes —
    « qu'est-ce que j'apporte ? » à gauche, « qu'est-ce que RingBack a
    déjà ? » à droite. Ce sont toujours des boutons radio (chaque voie ouvre
    un écran différent : l'exception établie à la règle du sélecteur).
    """
    colonnes = []
    for titre, choix in (gauche, droite):
        colonnes.append(f"<div><h3>{html.escape(titre)}</h3>"
                        + _choix_panneaux(nom, choix, retenu) + "</div>")
    return f'<div class="deux-colonnes">{"".join(colonnes)}</div>'


def _script_panneaux():
    """N'affiche que le panneau de la voie choisie (sans JavaScript : tout)."""
    return """<script>
(function(){
var radios=document.querySelectorAll('.choix-panneaux input[type=radio]');
if(!radios.length){return;}
function bascule(){
Array.prototype.forEach.call(radios,function(r){
var p=document.getElementById(r.getAttribute('data-panneau'));
if(p){p.hidden=!r.checked;}});}
Array.prototype.forEach.call(radios,function(r){
r.addEventListener('change',bascule);});
bascule();
})();
</script>"""


def _case(nom, libelle, cochee, identifiant=None, complement=""):
    """Une case à cocher : le contrôle AVANT le texte, largeur du contenu."""
    ident = f' id="{identifiant}"' if identifiant else ""
    return (f'<div class="ligne-option"><label class="option">'
            f'<input type="checkbox" name="{nom}" value="1"{ident}'
            f'{" checked" if cochee else ""}>'
            f"<span>{libelle} {complement}</span></label></div>")


class RoutesAssistant:
    """Mixin de Gestionnaire : les routes de l'assistant et du pilotage."""

    # ------------------------------------------------------------- routage
    def _get_assistant(self, url):
        """Traite la requête GET si elle vise l'assistant ; rend True alors."""
        if url.path == "/assistant":
            self._repondre(self._page_natures())
            return True
        parametres = urllib.parse.parse_qs(url.query)
        if url.path == "/assistant/message":
            page = self._page_message(parametres.get("b", [""])[0])
            if page is None:
                self._erreur(404, "Brouillon introuvable — recommencez depuis "
                                  "« Nouvelle campagne ».")
            else:
                self._repondre(page)
            return True
        if url.path == "/assistant/liste":
            page = self._page_liste(parametres.get("b", [""])[0])
            if page is None:
                self._erreur(404, "Brouillon introuvable — recommencez depuis "
                                  "« Nouvelle campagne ».")
            else:
                self._repondre(page)
            return True
        if url.path == "/campagne/changements.csv":
            self._servir_cahier_csv(parametres)
            return True
        if url.path == "/campagne/verification-agenda":
            # Le panneau « l'agenda de RingBack fait foi », demandé par le
            # clic sur ▶ Démarrer : un MORCEAU de page, calculé à l'instant.
            self._servir_verification_agenda(parametres)
            return True
        if url.path == "/assistant/periode":
            # Fragment : le SEUL panneau « dates de rendez-vous », recalculé
            # après un changement d'année ou de semaine.
            self._servir_periode(parametres)
            return True
        if url.path == "/assistant/regle":
            # Fragment : le SEUL panneau de la règle, recalculé après un
            # changement de SOURCE — c'est elle qui décide quels réglages ont un
            # sens (voir _champ_fenetre).
            self._servir_regle(parametres)
            return True
        if url.path == "/campagne/vivant":
            # Les deux zones qui bougent pendant une campagne, et rien
            # d'autre : c'est ce que la page vient chercher toutes les 1,5 s
            # au lieu de se recharger entière.
            self._servir_zones_vivantes(parametres)
            return True
        return False

    def _post_assistant(self, url, corps):
        """Traite la requête POST si elle vise l'assistant ; rend True alors."""
        if url.path == "/assistant/nature":
            self._traiter_nature(corps)
            return True
        if url.path == "/assistant/message":
            self._traiter_message(corps)
            return True
        if url.path == "/assistant/importer":
            self._traiter_import_grille(corps)
            return True
        if url.path == "/assistant/liste":
            self._traiter_grille(corps)
            return True
        if url.path == "/assistant/csv":
            self._traiter_csv_grille(corps)
            return True
        if url.path == "/assistant/champs":
            self._traiter_champs_attendus(corps)
            return True
        if url.path == "/campagne/demarrer":
            self._traiter_demarrage(corps)
            return True
        if url.path == "/campagne/pause":
            self._traiter_commande(corps, "pause")
            return True
        if url.path == "/campagne/arreter":
            self._traiter_commande(corps, "arret")
            return True
        if url.path == "/campagne/recuperer":
            # 📥 LIRE le résultat d'appels déjà passés. Ce chemin ne peut
            # créer aucun appel : il n'appelle que lire_resultat(), qui ne
            # fait qu'un GET. Les 3 verrous du mode réel gardent la CRÉATION
            # d'appels, ils ne sont donc pas concernés.
            self._traiter_recuperation(corps)
            return True
        if url.path == "/campagne/compenser":
            self._traiter_compensation(corps)
            return True
        if url.path == "/suivi/creneau/campagne":
            # Le MÊME geste, depuis le planning : un trou → la campagne qui
            # le remplit. Une seule mécanique, deux portes d'entrée (§5).
            self._traiter_compensation(corps)
            return True
        return False

    # ------------------------------------------------------ étape ① natures
    def _page_natures(self, erreur=None):
        bloc_erreur = (f'<div class="erreurs">{html.escape(erreur)}</div>'
                       if erreur else "")
        cartes = []
        for code, nature in assistant.NATURES.items():
            cartes.append(f"""<form method="post" action="/assistant/nature" style="margin:0">
  <button class="carte-nature" name="nature" value="{code}">
    <span style="font-size:1.6rem">{nature['icone']}</span>
    <strong>{html.escape(nature['nom'])}</strong><br>
    <small>{html.escape(nature['phrase'])}</small><br>
    <small class="sourd">Politique d'appel par défaut :
    {html.escape(nature['politique_libelle'])}</small>
  </button>
</form>""")
        corps = f"""{self._bandeau()}
<p><a href="/">← Retour aux campagnes</a></p>
<h1>Nouvelle campagne</h1>
{_fil_ariane(1)}
<p>Choisissez la <strong>nature</strong> de la campagne : elle détermine le
message pré-rempli, les informations demandées et les colonnes de la liste
des personnes. La politique d'appel affichée est celle par défaut — elle
reste modifiable à l'étape 2.</p>
{bloc_erreur}
<div class="cartes-natures">{''.join(cartes)}</div>"""
        return self._page("Nouvelle campagne — nature", corps, actif="campagnes")

    def _traiter_nature(self, corps):
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        nature = donnees.get("nature", [""])[0]
        if nature not in assistant.NATURES:
            return self._repondre(self._page_natures(
                erreur="Choisissez d'abord une nature de campagne."))
        identifiant = self.application.creer_brouillon_assistant(nature)
        return self._rediriger(f"/assistant/message?b={identifiant}")

    def _traiter_champs_attendus(self, corps):
        """Ajoute ou retire une COLONNE, puis revérifie la grille déjà remplie.

        C'est la règle du propriétaire (02/08/2026) : changer les colonnes
        quand des lignes existent oblige à revérifier ce qui est rempli. On
        ne jette JAMAIS une valeur : ce qui ne correspond plus à aucune
        colonne dort dans la fiche du contact et revient si la colonne
        revient. Seul le manque est signalé.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        identifiant = donnees.get("b", [""])[0]
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        if brouillon is None:
            return self._erreur(404, "Brouillon introuvable — recommencez "
                                     "depuis « Nouvelle campagne ».")
        action = donnees.get("action", [""])[0]
        brouillon["message"] = ""
        brouillon["erreurs"] = []
        brouillon["erreurs_ecran"] = "liste"
        if action == "ajouter_champ":
            libelle = " ".join(donnees.get("champ_libelle", [""])[0].split())
            if not libelle:
                brouillon["erreurs"] = ["Donnez un nom à la colonne avant "
                                        "de l'ajouter."]
            else:
                code = assistant.code_champ(libelle)
                existants = {c["code"]
                             for c in assistant.champs_campagne(brouillon)}
                if code in existants:
                    brouillon["erreurs"] = [f"La colonne « {libelle} » existe "
                                            "déjà."]
                else:
                    brouillon["champs"].append({
                        "code": code, "libelle": libelle,
                        "type": ("date" if donnees.get("champ_type", [""])[0]
                                 == "date" else "texte"),
                        "obligatoire": "champ_obligatoire" in donnees,
                        "verrouille": False})
                    brouillon["message"] = (
                        f"Colonne « {libelle} » ajoutée — variable [{code}] "
                        "utilisable dans le message.")
        elif action.startswith("retirer_champ:"):
            code = action.split(":", 1)[1]
            # ⚠ CE QUI PROTÈGE UNE COLONNE, C'EST SA PROVENANCE, pas le fait
            # qu'elle soit obligatoire. L'ancien code refusait de retirer
            # TOUTE colonne obligatoire — y compris une colonne ajoutée à la
            # main et cochée ⛔ : le bouton « Retirer » s'affichait et ne
            # faisait rien. Constaté à l'écran le 02/08/2026. Les colonnes de
            # la nature, elles, n'ont pas de bouton, et ce contrôle-ci le
            # confirme côté serveur (un envoi forgé ne passerait pas non plus).
            protegees = {champ["code"] for champ
                         in assistant.NATURES[brouillon["nature"]]["champs"]}
            if code in protegees:
                brouillon["erreurs"] = [
                    "Cette colonne vient de la nature de la campagne : elle "
                    "ne peut pas être retirée."]
            else:
                restants = [c for c in brouillon["champs"]
                            if c["code"] != code]
                if len(restants) != len(brouillon["champs"]):
                    brouillon["message"] = (
                        "Colonne retirée. Les valeurs déjà saisies dans cette "
                        "colonne sont conservées : elles reviendront si vous "
                        "la remettez.")
                brouillon["champs"] = restants
        # LA REVÉRIFICATION, dans les deux cas — y compris quand le
        # changement a échoué : elle dit l'état RÉEL de la grille.
        manques = assistant.verifier_grille(brouillon)
        if manques:
            brouillon["erreurs"] = brouillon["erreurs"] + manques
        return self._rediriger(f"/assistant/liste?b={identifiant}")

    # ------------------------------------------------------ étape ② message
    def _blocs_messages(self, brouillon, ecran=None):
        """Le message et les erreurs du brouillon — CEUX DE CET ÉCRAN.

        `ecran` vaut « message » (étape ②) ou « liste » (étape ③). Les
        erreurs portent l'écran qui les a produites : une plainte sur les
        informations de l'étape ② n'a rien à faire au-dessus de la grille de
        l'étape ③, et inversement.

        Constaté par le propriétaire le 02/08/2026 : le refus de l'étape ②
        le suivait quand il naviguait par le fil d'Ariane, longtemps après
        l'avoir corrigé. Une erreur sans écran (une ancienne, ou une écrite
        par un code qui n'a pas dit d'où elle venait) reste affichée
        partout : on préfère un message de trop à un refus muet.
        """
        blocs = ""
        if brouillon.get("message"):
            blocs += f'<p class="pastille">{html.escape(brouillon["message"])}</p>'
        origine = brouillon.get("erreurs_ecran")
        if brouillon.get("erreurs") and (not ecran or not origine
                                         or origine == ecran):
            elements = "".join(f"<li>{html.escape(e)}</li>"
                               for e in brouillon["erreurs"])
            blocs += (f'<div class="erreurs"><strong>À corriger :</strong>'
                      f"<ul>{elements}</ul></div>")
        return blocs

    def _apercu_html(self, nature, infos, champs, preferences, options=None):
        """L'aperçu initial rendu côté serveur (le JavaScript prend le relais).

        Variables d'étape ② non renseignées : en rouge (⛔ bloquant si
        obligatoires) ; variables PAR CONTACT : en bleu, remplies à l'appel.
        Les options de comportement entrent dans le calcul : un segment
        conditionné par une case à cocher n'apparaît que si elle l'est.
        """
        texte = assistant.construire_mission(nature, infos, preferences,
                                             options)
        return self._colorer(texte, nature, champs)

    def _colorer(self, texte, nature, champs):
        """Le texte, échappé, avec ses variables encore vides mises en couleur.

        Les civilités sont DÉVELOPPÉES ici, comme elles le seront dans la
        consigne envoyée : l'aperçu montre ce qui sera dit, pas ce qui est
        écrit dans les fiches (elles, ne changent jamais).
        """
        # ⚠ L'APERÇU DOIT MENTIR MOINS QUE LE PRODUIT, PAS PLUS (02/09/2026).
        # Il développait « M. » en « monsieur » quelle que soit la langue,
        # alors que l'appel ne le fait QU'EN FRANÇAIS — le développement vient
        # d'un constat fait à l'oreille sur des appels français, et
        # « monsieur Smith » serait une faute en anglais. L'aperçu annonçait
        # donc une chose et l'appel en faisait une autre. Il suit maintenant
        # la même règle que ce qui part.
        rendu = html.escape(consigne.developper_civilites(
            texte, langue.civilites_de(self._langue(), consigne._DEVELOPPE)))
        libelles = {info["code"]: info["libelle"]
                    for info in assistant.NATURES[nature]["infos"]}
        for code, libelle in libelles.items():
            rendu = rendu.replace(
                f"[{code}]",
                f'<span class="var-manquante">[{html.escape(libelle)}]</span>')
        codes_contact = {"identite": "Identité"}
        codes_contact.update({c["code"]: c["libelle"] for c in champs
                              if c["code"] != "telephone"})
        for code, libelle in codes_contact.items():
            rendu = rendu.replace(
                f"[{code}]",
                f'<span class="var-contact">[{html.escape(libelle)}]</span>')
        return rendu

    def _apercu_consigne(self, nature, infos, champs, preferences,
                         options=None, presentation=None, places=()):
        """LES DEUX AUTRES PARTIES de la consigne, telles qu'elles partiront.

        L'aperçu de l'étape 2 a été conçu pour SAVOIR CE QUI SERA DIT. Depuis
        que la consigne compte trois parties (présentation dite mot pour mot,
        objectif et contexte discutés librement, issues fermées), n'en
        montrer qu'une reviendrait à cacher les deux autres. La partie ① a
        son propre bloc (#apercu, celui qu'on modifie à la main) ; celles-ci
        sont construites par le MÊME code que l'appel réel
        (assistant.construire_consigne) — ce qui est montré est ce qui part.

        Rend (contexte, issues) en HTML.
        """
        cadre = assistant.construire_consigne(nature, infos, preferences,
                                              options, champs,
                                              presentation=presentation,
                                              places=places)
        return (self._colorer(cadre.texte_contexte(), nature, champs),
                self._colorer(cadre.texte_issues(), nature, champs))

    def _bloc_consigne(self, nature, infos, champs, preferences, options=None,
                       presentation=None, places=()):
        """Les parties ② et ③ affichées sous la présentation."""
        contexte, issues = self._apercu_consigne(nature, infos, champs,
                                                 preferences, options,
                                                 presentation, places)
        # REPLIÉS PAR DÉFAUT (demande du propriétaire, 02/08/2026) : ces deux
        # parties sont écrites par la nature de la campagne et ne se touchent
        # qu'exceptionnellement. Dépliées d'office, elles noyaient les deux
        # champs qu'il faut vraiment remplir. Le titre reste cliquable.
        return f"""<details><summary><strong>② Son objectif et son contexte</strong>
— là, il discute librement</summary>
<div id="apercu-contexte" class="apercu-mission">{contexte}</div></details>
<details><summary><strong>③ Les issues</strong> — il doit conclure sur l'une
des trois</summary>
<div id="apercu-issues" class="apercu-mission">{issues}</div></details>
<p><small>Ces trois parties sont exactement ce qui sera envoyé à l'agent
téléphonique. Seule la première est dite mot pour mot : entre elle et sa
conclusion, l'agent répond à ce qu'on lui dit, peut répéter et reformuler.
Les trois issues, elles, sont fermées — il ne peut en rendre aucune
autre.</small></p>"""

    def _script_apercu(self, nature, infos, champs, preferences):
        """Le JavaScript de l'aperçu vivant — même règle que le serveur."""
        definition = assistant.NATURES[nature]
        plage = themes.plage_lisible(preferences)
        segments = []
        for segment in definition["gabarit"]:
            if isinstance(segment, str):
                segments.append({"t": segment.replace("[plage_rappel]", plage)})
            else:
                entree = {"t": segment["texte"].replace("[plage_rappel]", plage)}
                if segment.get("si"):
                    entree["si"] = segment["si"]
                if segment.get("sauf"):
                    entree["sauf"] = segment["sauf"]
                # Segment conditionné par une OPTION : l'aperçu relit la case
                # à cocher elle-même, pour dire la vérité sans recharger.
                for clef, cible in (("si_option", "si_case"),
                                    ("sauf_option", "sauf_case")):
                    if segment.get(clef):
                        entree[cible] = assistant.CASES_OPTIONS.get(
                            segment[clef], "")
                segments.append(entree)
        types_infos = {info["code"]: info["type"]
                       for info in definition["infos"]}
        libelles = {info["code"]: info["libelle"]
                    for info in definition["infos"]}
        libelles["identite"] = "Identité"
        codes_contact = ["identite"] + [c["code"] for c in champs
                                        if c["code"] != "telephone"]
        for champ in champs:
            libelles.setdefault(champ["code"], champ["libelle"])
        # LA PARTIE ② VIT ELLE AUSSI. Ses lignes de faits sont les mêmes
        # segments conditionnels que le message (assistant.faits_segments) :
        # remplir « Lieu » les fait apparaître, décocher une option les fait
        # disparaître — sans recharger, et sans qu'un second code puisse
        # diverger de celui du serveur.
        faits = []
        for segment in assistant.faits_segments(nature, champs):
            entree = {"t": segment["texte"]}
            for clef in ("si", "si_valeur"):
                if segment.get(clef):
                    entree[clef] = segment[clef]
            if segment.get("si_option"):
                entree["si_case"] = assistant.CASES_OPTIONS.get(
                    segment["si_option"], "")
            faits.append(entree)
        contraintes = [ligne.replace("[plage_rappel]", plage)
                       for ligne in consigne.CONTRAINTES]
        donnees = json.dumps(
            {"seg": segments, "infos": types_infos, "contact": codes_contact,
             "lib": libelles, "faits": faits, "contraintes": contraintes,
             "objectif": definition["objectif"],
             "tfaits": consigne.TITRE_FAITS,
             "tcontraintes": consigne.TITRE_CONTRAINTES,
             "liberte": consigne.LIBERTE,
             "entreprise_defaut": consigne.ENTREPRISE_INCONNUE,
             "civ": [[abrege, developpe] for abrege, developpe
                     in consigne.CIVILITES]},
            ensure_ascii=False).replace("</", "<\\/")
        return """<script>
(function(){
var D=%s;
function val(c){var e=document.getElementById('info_'+c);
if(!e){return '';}
var v=e.value.trim();return v==='non'?'':v;}
function valBrut(c){var e=document.getElementById('info_'+c);
return e?e.value.trim():'';}
function coche(i){var e=document.getElementById(i);return !!(e&&e.checked);}
function fmtDate(v){var m=v.match(/^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})/);
if(!m)return v;return m[3]+'/'+m[2]+'/'+m[1]+' à '+parseInt(m[4],10)+'h'+m[5];}
function esc(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function civ(t){D.civ.forEach(function(p){
var a=p[0].replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&');
t=t.replace(new RegExp('\\\\b'+a+'\\\\.?(?=\\\\s+[^\\\\W\\\\d_])','g'),
function(m,i){var av=t.slice(0,i).replace(/[ \\t«"'(–—-]+$/,'');
var d=p[1];return (!av||'.!?\\n'.indexOf(av.slice(-1))>=0)?
d.charAt(0).toUpperCase()+d.slice(1):d;});});
return t;}
function sub(t){Object.keys(D.infos).forEach(function(c){var v=val(c);if(!v)return;
if(D.infos[c]==='date')v=fmtDate(v);t=t.split('['+c+']').join(v);});return t;}
function colorer(t){var h=esc(civ(t));
Object.keys(D.infos).forEach(function(c){
h=h.split('['+c+']').join('<span class="var-manquante">['+esc(D.lib[c]||c)+']</span>');});
D.contact.forEach(function(c){
h=h.split('['+c+']').join('<span class="var-contact">['+esc(D.lib[c]||c)+']</span>');});
return h;}
function texteBrut(){var t='';
D.seg.forEach(function(s){if(s.si&&!val(s.si))return;if(s.sauf&&val(s.sauf))return;
if(s.si_case&&!coche(s.si_case))return;if(s.sauf_case&&coche(s.sauf_case))return;t+=s.t;});
return sub(t);}
function contexteBrut(){var l=['Ton objectif : '+D.objectif],f=[];
D.faits.forEach(function(s){
if(s.si_case&&!coche(s.si_case))return;
if(s.si_valeur&&!valBrut(s.si_valeur))return;
if(s.si&&!val(s.si))return;f.push(sub(s.t));});
if(f.length){l.push(D.tfaits);f.forEach(function(x){l.push('- '+x);});}
l.push(D.tcontraintes);
var ent=val('entreprise')||D.entreprise_defaut;
D.contraintes.forEach(function(x){
l.push('- '+x.split('[entreprise]').join(ent));});
l.push(D.liberte);return l.join('\\n');}
function rendu(){
var z=document.getElementById('zone-mission'),d=document.getElementById('mission-editee');
var edite=!!(z&&d&&d.value==='1'&&z.value.trim());
var t=edite?z.value:texteBrut();
var a=document.getElementById('apercu');if(a)a.innerHTML=colorer(t);
var c=document.getElementById('apercu-contexte');
if(c)c.innerHTML=colorer(contexteBrut());
if(z&&d&&!edite){z.value=texteBrut();}}
Array.prototype.forEach.call(document.querySelectorAll('[id^="info_"],[id^="opt_"]'),
function(e){e.addEventListener('input',rendu);e.addEventListener('change',rendu);});
var z=document.getElementById('zone-mission'),d=document.getElementById('mission-editee');
if(z&&d){z.addEventListener('input',function(){d.value='1';rendu();});}
var r=document.getElementById('btn-regenerer');
if(r){r.addEventListener('click',function(){if(d)d.value='';rendu();});}
/* rbAjouterVariable / rbRetirerVariable ont été RETIRÉS le 02/08/2026 :
   ils tenaient l'aperçu à jour quand on ajoutait une colonne SANS quitter
   l'étape ②. Les colonnes ont déménagé à l'étape ③ et passent maintenant
   par le serveur — plus personne ne les appelait. */
rendu();
})();
</script>""" % donnees

    def _script_options(self):
        """Le dévoilement en cascade des options de l'étape ②.

        ⚠ L'ajout/retrait de colonne N'EST PLUS ICI : il a suivi les colonnes
        à l'étape ③ (02/08/2026). Il s'y fait par le serveur, et pas dans le
        navigateur comme avant — parce qu'un changement de colonne oblige
        désormais à REVÉRIFIER la grille déjà remplie, et que cette
        vérification, seul le serveur peut la faire honnêtement.

        Sans JavaScript, tout reste visible : rien n'est perdu, c'est juste
        moins agréable.
        """
        return """<script>
(function(){
function bascule(){
var r=document.getElementById('opt_recontacter'),b=document.getElementById('bloc-relance');
if(b){b.hidden=!(r&&r.checked);}
var m=document.getElementById('relance_mode'),d=document.getElementById('bloc-delai'),
c=document.getElementById('bloc-creneau');
if(m&&d&&c){var k=m.value==='creneau';d.hidden=k;c.hidden=!k;}
var l=document.getElementById('opt_cascade'),x=document.getElementById('bloc-cascade');
if(x){x.hidden=!(l&&l.checked);}
var p=document.getElementById('opt_replacer'),q=document.getElementById('bloc-replacer');
if(q){q.hidden=!(p&&p.checked);}}
['opt_recontacter','relance_mode','opt_cascade','opt_replacer'].forEach(function(i){
var e=document.getElementById(i);if(e){e.addEventListener('change',bascule);}});
bascule();
/* ⏩ LA PÉRIODE REMPLIT LA DATE (15/08/2026, sa demande). On pense en durées —
   « trois mois » — pas en dates : le sélecteur écrit la date pour nous.
   ⚠ IL LA REMPLIT, IL NE LA REMPLACE PAS. Le champ date reste modifiable
   après coup, et « Date libre » ne touche à rien : une saisie faite à la main
   n'est jamais effacée par un choix qui ne dit rien.
   ⚠ ET « dernière date » VIENT DU SERVEUR, jamais d'un calcul : c'est le
   dernier rendez-vous réellement en agenda, porté par data-derniere. Sans
   agenda, l'entrée ne fait rien plutôt que d'inventer une date. */
var periode=document.getElementById('cascade_periode'),
    quand=document.getElementById('cascade_jusqu_au');
if(periode&&quand){
  periode.addEventListener('change',function(){
    var choix=periode.value;
    if(!choix){return}
    if(choix==='derniere'){
      var fin=quand.getAttribute('data-derniere')||'';
      if(fin){quand.value=fin}
      return}
    var jours=parseInt(choix,10);
    if(!jours){return}
    var d=new Date();
    d.setDate(d.getDate()+jours);
    var mois=('0'+(d.getMonth()+1)).slice(-2),jour=('0'+d.getDate()).slice(-2);
    quand.value=d.getFullYear()+'-'+mois+'-'+jour;});}
})();
</script>"""

    def _champ_info(self, info, valeur, autres=()):
        """Un champ d'information générale de l'étape ② (type respecté).

        `autres` : les valeurs SUPPLÉMENTAIRES d'une information répétable —
        les créneaux déjà ajoutés, en plus de celui du champ.
        """
        code = info["code"]
        etoile = ' <span class="obligatoire">⚠</span>' if info["obligatoire"] else ""
        libelle = f"{html.escape(info['libelle'])}{etoile}"
        if info.get("multiple"):
            return self._champ_info_multiple(info, libelle, valeur, autres)
        if info["type"] == "date":
            zone = (f'<input type="datetime-local" id="info_{code}" '
                    f'name="info_{code}" value="{html.escape(valeur)}">')
        elif info["type"] == "long":
            zone = (f'<textarea id="info_{code}" name="info_{code}" rows="2">'
                    f"{html.escape(valeur)}</textarea>")
        elif info["type"] == "oui_non":
            choix_oui = " selected" if valeur == "oui" else ""
            choix_non = " selected" if valeur != "oui" else ""
            zone = (f'<select id="info_{code}" name="info_{code}">'
                    f'<option value="non"{choix_non}>non</option>'
                    f'<option value="oui"{choix_oui}>oui</option></select>')
        else:
            zone = (f'<input id="info_{code}" name="info_{code}" '
                    f'value="{html.escape(valeur)}">')
        return f"<label>{libelle}<br>{zone}</label>"

    @staticmethod
    def _champs_par_duree(info, valeur, durees, preferences):
        """La même information, UN CHAMP PAR DURÉE de rendez-vous à replacer.

        Chaque champ porte l'intitulé de sa durée et le nombre de personnes
        concernées : c'est ce qui permet de savoir laquelle on corrige. Ils
        portent TOUS le nom « info_<code> », répété — le serveur les recolle
        dans l'ordre des durées (`assistant.recomposer_par_duree`), et rien
        d'indexé ne vient s'ajouter au formulaire.
        """
        listes = assistant.listes_par_duree(preferences, valeur, durees)
        etoile = (' <span class="obligatoire">⚠</span>'
                  if info["obligatoire"] else "")
        blocs = []
        for tranches in sorted(durees):
            combien = durees[tranches]
            intitule = assistant.etiquette_duree(preferences, tranches)
            blocs.append(
                f"<label>{html.escape(info['libelle'])} — "
                f"<strong>{html.escape(intitule)}</strong>{etoile}<br>"
                f"<small>{combien} rendez-vous de cette durée à replacer.</small>"
                f'<br><textarea name="info_{info["code"]}" rows="2">'
                f"{html.escape(listes.get(tranches, ''))}</textarea></label>")
        return "".join(blocs)

    def _champ_info_multiple(self, info, libelle, valeur, autres):
        """UNE information saisie PLUSIEURS fois : le champ, « + », la liste.

        Demandé par le propriétaire le 03/08/2026 pour les créneaux libérés :
        un bouton « + » à côté du champ, la liste dessous par ordre
        chronologique CROISSANT, et une croix par ligne pour retirer.

        ⚠ TOUTES LES LIGNES PORTENT LE MÊME NOM « info_<code> », répété. Rien
        d'indexé (creneau_1, creneau_2…) : douze essais envoient déjà un
        « info_creneau_libere » unique, et ils doivent continuer de marcher
        mot pour mot. Le serveur reçoit N valeurs et les range lui-même.

        ⚠ ÇA MARCHE SANS JAVASCRIPT : le « + » est un vrai bouton d'envoi
        (action « creneau ») qui range la valeur et revient sur l'étape ②,
        et chaque croix en est un aussi. Le script, quand il est là, fait la
        même chose sans aller-retour.
        """
        code = info["code"]
        # ⚠ LE CHAMP DE SAISIE N'EST PAS LA VALEUR : c'est un champ d'AJOUT,
        # nommé à part. Toutes les places, la première comprise, vivent dans
        # la liste. Autrement, taper une nouvelle date par-dessus le champ
        # aurait effacé la place déjà saisie — sans le dire.
        toutes = list(autres)
        if valeur and valeur not in toutes:
            toutes.insert(0, valeur)
        toutes = [f["horaire"] for f in assistant.normaliser_creneaux(toutes)]
        lignes = []
        for rang, horaire in enumerate(toutes):
            lisible = self._creneau_lisible(horaire)
            # ⚠ LE PREMIER PORTE « id="info_<code>" » : c'est par cet
            # identifiant que l'aperçu vivant lit la valeur (voir
            # _script_apercu). Le déplacer casserait l'aperçu en silence.
            marque = f' id="info_{code}"' if rang == 0 else ""
            lignes.append(
                f'<li><input type="hidden"{marque} name="info_{code}" '
                f'value="{html.escape(horaire)}">'
                f'<span>{html.escape(lisible)}</span>'
                f'<button type="submit" class="secondaire retirer-creneau" '
                f'name="action" value="creneau-retirer:{html.escape(horaire)}" '
                f'title="Retirer cette place de la liste" '
                f'aria-label="Retirer {html.escape(lisible)}">✕</button></li>')
        if lignes:
            liste = (f'<ul class="liste-creneaux" id="liste_{code}">'
                     + "".join(lignes) + "</ul>")
        else:
            # Même vide, l'identifiant doit exister : l'aperçu vivant le
            # cherche au chargement et ne le retrouverait plus jamais.
            liste = (f'<input type="hidden" id="info_{code}" name="info_{code}" '
                     f'value="">'
                     f'<p class="sourd" id="liste_{code}"><small>Aucune place '
                     "pour l'instant. Saisissez une date et appuyez sur « + » : "
                     "la campagne proposera les places l'une après l'autre, "
                     "de la plus ancienne à la plus récente.</small></p>")
        return f"""<label>{libelle}<br>
  <span class="ligne-creneau">
    <input type="datetime-local" name="{code}_ajout" value="">
    <button type="submit" class="secondaire ajouter-creneau" name="action"
            value="creneau-ajouter" title="Ajouter cette place à la liste"
            aria-label="Ajouter cette place à la liste">+</button>
  </span></label>
{liste}"""

    @staticmethod
    def _creneau_lisible(horaire):
        """« mardi 12/08 à 15h00 » — et la valeur brute si elle est illisible."""
        try:
            quand = datetime.datetime.fromisoformat(horaire)
        except (TypeError, ValueError):
            return horaire
        return (f"{horaires.JOURS[quand.weekday()]} {quand:%d/%m} "
                f"à {quand:%Hh%M}")

    def _bloc_option_cascade(self, nature, options):
        """L'option « décaler en cascade » — et seulement où elle fait quelque chose.

        ⚠ ELLE ÉTAIT OFFERTE AUX CINQ NATURES (14/08/2026, audit croisé). Or
        elle ne commande qu'un seul mécanisme : ce que devient la place qu'un
        contact QUITTE. Trois natures n'en libèrent aucune — un rappel, une
        confirmation et une prise de rendez-vous ne déplacent personne — et la
        case y était donc inerte : cochée ou non, rien ne changeait. Une case
        qui ne fait rien est un mensonge d'interface, exactement le
        raisonnement de l'option d'annulation juste en dessous.
        """
        if nature not in assistant.NATURES_QUI_LIBERENT_UNE_PLACE:
            return ""
        # ⚠ LE TEXTE A ÉTÉ CORRIGÉ LE 15/08/2026 : il annonçait « avec UNE
        # SEULE place, RingBack PRÉPARE la même campagne » — ce n'est plus
        # vrai. Une place ou plusieurs, la place quittée REJOINT la campagne
        # qui tourne (voir assistant._rendre_la_place). Laisser l'ancienne
        # phrase aurait fait chercher une campagne « prête » qui ne vient plus.
        dernier = self.application.base.dernier_rendezvous_connu()
        return f"""{_case("opt_cascade",
       "<strong>Décaler en cascade</strong> — quand quelqu'un accepte de "
       "décaler son rendez-vous, la place qu'il vient de quitter REJOINT "
       "cette campagne, qui continue dessus avec le budget d'appels qui lui "
       "reste. De proche en proche, un seul trou peut ainsi en combler "
       "plusieurs. Décochée, le trou reste simplement visible sur votre "
       "planning, et vous en faites ce que vous voulez",
       options.get("cascade", False), identifiant="opt_cascade")}
<div class="sous-options" id="bloc-cascade">
  <div class="rangee-regle">
  <label class="champ-option">Jusqu'à quand
    {_selecteur("cascade_periode", assistant.PERIODES_CASCADE, "",
                identifiant="cascade_periode")}
  </label>
  <label class="champ-option">Date limite de la chaîne
    <input class="champ-date" type="date" name="cascade_jusqu_au"
           id="cascade_jusqu_au"
           data-derniere="{html.escape(dernier, quote=True)}"
           value="{html.escape(options.get('cascade_jusqu_au', ''))}">
  </label>
  </div>
  <p><small>Le premier choix remplit la date pour vous ; « date libre » la
  laisse à votre main, et vous pouvez de toute façon la corriger après coup.
  {"« Dernière date » va jusqu'au dernier rendez-vous de votre agenda — "
   "au-delà, la chaîne ne trouverait plus personne." if dernier
   else "« Dernière date » n'a rien à viser : votre agenda est vide."}</small></p>
  <p><small>Seuls les contacts dont le rendez-vous tombe APRÈS la place
  libérée sont retenus : les autres n'y gagneraient rien. La liste se
  resserre donc à chaque maillon. La chaîne s'arrête à cette date, quand
  plus personne n'est concerné, ou quand le nombre maximal de PERSONNES
  réglé pour la campagne est atteint.</small></p>
</div>"""

    def _bloc_option_annulation(self, nature, brouillon):
        """L'option « proposer une autre date si le contact annule ».

        Elle n'apparaît que pour les natures dont le message en dépend
        (🔔 rappel, ✅ confirmation) : ailleurs, une case qui ne changerait
        rien serait un mensonge d'interface. Son DÉTAIL — la liste des
        places libres à annoncer — n'est dévoilé que si elle est cochée.
        """
        if not assistant.option_annulation_utile(nature):
            return ""
        options = brouillon["options"]
        actif = bool(options.get(assistant.CLE_REPLACER_ANNULATION))
        detail = "".join(
            self._champ_info(info, brouillon["infos"].get(info["code"], ""))
            for info in assistant.infos_de_sous_option(
                nature, assistant.CLE_REPLACER_ANNULATION))
        case = _case(
            "opt_replacer",
            "<strong>Proposer une autre date si le contact annule</strong> — "
            "l'agent annonce alors les places <em>réellement</em> libres. "
            "S'il en prend une, ce n'est plus une annulation mais un "
            "<strong>déplacement</strong> (ligne ↔ au cahier des "
            "changements). S'il n'en veut aucune — ou si cette case reste "
            "décochée — le rendez-vous est annulé et le client passe "
            "« 📞 le contact rappellera » : plus aucun appel ne part pour "
            "lui, c'est LUI qui reprend contact",
            actif, identifiant="opt_replacer")
        return f"""{case}
<div class="sous-options" id="bloc-replacer">
  {detail}
  <p><small>Cette liste est <strong>calculée</strong> (ouvert − déjà pris −
  jours fermés) et <strong>recalculée à l'instant de l'appel</strong> :
  l'agent n'annonce jamais une place déjà prise, et jamais une date obtenue
  par formule. Vide, la phrase qui l'annonce tombe d'elle-même — rien n'est
  inventé. Le texte du message change selon cette case : regardez l'aperçu
  en haut de page.</small></p>
</div>"""

    def _page_message(self, identifiant):
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        if brouillon is None:
            return None
        preferences = self.application.preferences
        # ⚠ LE STOCK DE PLACES EST REMIS AU NOMBRE RÉEL DE GENS AVANT D'AFFICHER
        # (17/08/2026). Sa question, capture à l'appui : « le champ ne propose que
        # peu de dates libres pour les 11 rendez-vous — est-ce simplement un
        # problème d'affichage ? » Oui, mais cet affichage est un CHAMP : s'il y
        # touche, ses dix-neuf dates deviennent la liste définitive. Un champ qui
        # montre faux invite à figer le faux.
        assistant.rafraichir_stock_du_brouillon(
            self.application.base, preferences, brouillon)
        # ⚠ « mode_saisie », pas « mode » : plus bas dans cette méthode,
        # « mode » désigne déjà le mode de RELANCE (délai ou créneau).
        mode_saisie = assistant.mode_formulaire(preferences)
        nature = brouillon["nature"]
        definition = assistant.NATURES[nature]
        options = brouillon["options"]
        champs = assistant.champs_campagne(brouillon)
        # C. L'aperçu vivant. Il montre les TROIS PARTIES de la consigne :
        # ① la présentation dite mot pour mot (celle qu'on modifie à la
        # main), ② l'objectif, les faits et les contraintes, ③ les trois
        # issues fermées. Les deux dernières sortent du même code que l'appel
        # réel — voir _apercu_consigne.
        #
        # Il n'y a plus de cas particulier « zone libre » : la nature
        # « Personnalisé », seule à n'avoir aucun gabarit, a été retirée le
        # 03/08/2026. Toutes les natures ont donc un texte de départ, et
        # « ✎ Modifier le texte à la main » suffit à s'en écarter.
        editee = bool(brouillon.get("mission_editee")
                      and brouillon.get("mission"))
        # Un texte récrit à la main est CELUI QUI PARTIRA : l'aperçu le
        # montre lui, et non le gabarit qu'il remplace.
        apercu = (self._colorer(brouillon["mission"], nature, champs)
                  if editee
                  else self._apercu_html(nature, brouillon["infos"],
                                         champs, preferences, options))
        if editee:
            contenu_zone = brouillon["mission"]
            marque_editee = "1"
        else:
            contenu_zone = assistant.construire_mission(
                nature, brouillon["infos"], preferences, options)
            marque_editee = ""
        # ⚠ CE QUE SON TEXTE NE DIT PLUS (défaut n° 10 du 18/08/2026). Il
        # remplissait un champ APRÈS avoir retapé le message : la valeur était
        # enregistrée, l'écran la montrait — et l'agent ne la disait jamais.
        # On ne réinjecte RIEN dans son texte (« un message récrit à la main
        # part exactement comme il l'a écrit ») : on le dit, il tranche.
        perdues = assistant.infos_perdues_par_le_texte(
            nature, brouillon["infos"], preferences, options, contenu_zone)
        bloc_perdues = self._bloc_infos_perdues(perdues)
        bloc_apercu = f"""<h2>C. Aperçu du message (il se met à jour en tapant)</h2>
{bloc_perdues}
<details open><summary><strong>① Ce que l'agent dit en ouvrant</strong>, mot
pour mot</summary>
<div id="apercu" class="apercu-mission">{apercu}</div>
<p><small><span class="var-manquante">[en rouge]</span> : information
manquante — un ⚠ bloque le passage à l'étape 3.
<span class="var-contact">[en bleu]</span> : rempli pour chaque contact à
l'étape 3, au moment de l'appel (une phrase dont le champ facultatif reste
vide est simplement omise). Les civilités sont développées ici comme elles
le seront au téléphone (« M. » se dit « monsieur ») ; vos fiches, elles, ne
changent pas.</small></p>
<details><summary>✎ Modifier le texte à la main</summary>
<label>Le texte que l'agent lira (jamais de numéro dedans)<br>
<textarea id="zone-mission" name="mission" rows="6">{html.escape(contenu_zone)}</textarea></label>
<input type="hidden" id="mission-editee" name="mission_editee" value="{marque_editee}">
<p><button type="button" id="btn-regenerer" class="secondaire">Revenir au
texte de la fiche (annule l'édition manuelle)</button></p>
<p><small>Ce texte ne vaut que pour CETTE campagne. Le texte de départ, celui
que toutes les campagnes de cette nature reprennent, se règle dans
<a href="/reglages#discours-{nature}">⚙ Réglages → Discours de l'agent</a>.</small></p>
</details>
</details>"""
        script_apercu = self._script_apercu(nature, brouillon["infos"],
                                            champs, preferences)
        bloc_apercu += self._bloc_consigne(
            nature, brouillon["infos"], champs, preferences, options,
            presentation=(brouillon.get("mission") if editee else None),
            places=assistant.places_du_brouillon(brouillon))
        # B. Informations générales. Celles qui sont le DÉTAIL d'une option
        # (info["sous_option"]) n'apparaissent pas ici : elles sont montrées
        # sous leur case à cocher, et seulement si elle est cochée.
        deja = [f["horaire"] for f in (brouillon.get("creneaux") or [])]
        # ⚠ UN CHAMP PAR DURÉE À REPLACER (18/08/2026, sa demande) : « il faut
        # un champ texte pour les rendez-vous possibles pour toutes les
        # longueurs de rendez-vous que l'on retrouve dans le déplacement,
        # 1 créneau, 2 créneaux etc. » Le stock portait bien ses deux listes,
        # mais collées dans UN champ — impossible d'en corriger une sans
        # toucher l'autre, et l'intitulé ne disait pas laquelle était laquelle.
        # Une seule durée : un seul champ, comme avant.
        durees = assistant.durees_du_brouillon(self.application.base, brouillon)
        blocs_infos = "".join(
            self._champs_par_duree(info, brouillon["infos"].get(info["code"], ""),
                                   durees, preferences)
            if len(durees) > 1 and info.get("reglage") == "creneaux_lisibles"
            else self._champ_info(
                info, brouillon["infos"].get(info["code"], ""),
                autres=(deja if info.get("multiple") else ()))
            for info in definition["infos"] if not info.get("sous_option"))
        if not (preferences.obtenir(themes.CLE_ENTREPRISE) or "").strip():
            blocs_infos += ('<p><small>Le nom de l\'entreprise n\'est pas '
                            'encore réglé : saisissez-le ici une fois, il sera '
                            'repris automatiquement par toutes les campagnes '
                            'suivantes (modifiable dans '
                            '<a href="/reglages">⚙ Paramètres</a>).</small></p>')
        # C. Options de comportement.
        if definition["politique_modifiable"]:
            bloc_politique = (
                '<label class="champ-option"><strong>Politique d\'appel</strong>'
                "<br>" + _selecteur(
                    "politique",
                    [(code, assistant.POLITIQUES[code])
                     for code in ("premier_oui", "tous")],
                    brouillon["politique"]) + "</label>")
        else:
            bloc_politique = ("<p><strong>Politique d'appel</strong> : "
                              f"{html.escape(definition['politique_libelle'])}"
                              "</p>")
        mode = options.get("relance_mode") or "delai"
        interdit = assistant.periode_interdite(preferences)
        texte_interdit = (f"période interdite {interdit[0]} → {interdit[1]}"
                          if interdit else "aucune période interdite réglée")
        bloc_annulation = self._bloc_option_annulation(nature, brouillon)
        bloc_cascade = self._bloc_option_cascade(nature, options)
        bloc_options = f"""{bloc_politique}
{_case("opt_recontacter", "<strong>Recontacter si non joignable</strong>",
       options.get("recontacter", True), identifiant="opt_recontacter")}
<div class="sous-options" id="bloc-relance">
  <label class="champ-option">Quand rappeler<br>{_selecteur(
      "relance_mode", [("delai", "après un délai"),
                       ("creneau", "dans un créneau horaire")],
      "creneau" if mode == "creneau" else "delai",
      identifiant="relance_mode")}</label>
  <div id="bloc-delai">
    <label class="champ-option">Délai, en heures ouvrées de la plage d'appel
      <input class="champ-court" type="number" name="relance_delai" min="0"
             max="168" value="{html.escape(str(options.get('relance_delai', '')))}">
    </label>
  </div>
  <div id="bloc-creneau">
    <label class="champ-option">Rappeler entre
      <input class="champ-court" type="time" name="relance_creneau_debut"
             value="{html.escape(options.get('relance_creneau_debut', ''))}"> et
      <input class="champ-court" type="time" name="relance_creneau_fin"
             value="{html.escape(options.get('relance_creneau_fin', ''))}">
    </label>
  </div>
  <label class="champ-option">Nombre maximal de rappels
    <input class="champ-court" type="number" name="relance_max" min="0" max="9"
           value="{html.escape(str(options.get('relance_max', '')))}">
  </label>
  <p><small>Chaque appel est horodaté ; la fiche du contact affiche l'heure
  du dernier appel et le compteur de tentatives. Au plafond, le contact passe
  📵 injoignable (N). La relance conserve la nature et le contexte.</small></p>
</div>
{_case("opt_liberer", "<strong>Un rendez-vous déplacé ou annulé libère son créneau</strong> — un OUI annule l'ancien rendez-vous du client (jamais deux rendez-vous pour la même personne)",
       options.get("liberer_creneau", True), identifiant="opt_liberer")}
{bloc_annulation}
{bloc_cascade}
<div class="ligne-option"><label class="option">
  <input type="checkbox" checked disabled><span>Plage horaire respectée
  ({html.escape(themes.plage_lisible(preferences))} ; {html.escape(texte_interdit)})
  — toujours appliquée, réglable dans <a href="/reglages">⚙ Réglages</a>.</span>
</label></div>
{_case("opt_repondeur", "Répondeur : message court <strong>sans le motif</strong> (discrétion)",
       options.get("repondeur_sans_motif", True))}
<label class="champ-option"><strong>Ordre d'appel</strong> — aucun ordre n'est
imposé, la décision vous revient<br>{_selecteur(
    "ordre", list(assistant.ORDRES_APPEL.items()), brouillon["ordre"],
    vide="— à choisir —")}</label>"""
        # Les colonnes attendues ont quitté cet écran le 02/08/2026 pour
        # l'étape ③, puis l'écran tout entier a été RETIRÉ le 09/08/2026
        # (demande du propriétaire) : la grille montre déjà ses colonnes en
        # entête, avec leur ⚠, et le collage écrit le format attendu.
        # ⚠ LES CHAMPS PERSONNALISÉS VOYAGENT QUAND MÊME dans ce formulaire,
        # en caché : une base existante peut en porter, et l'étape ② renvoie
        # la liste complète à chaque envoi. Sans cela, un aller-retour par
        # l'étape ② effacerait une colonne qu'une campagne utilise.
        codes_nature = {champ["code"] for champ in definition["champs"]}
        porteurs_champs = "".join(
            '<input type="hidden" name="champ_perso" '
            f'value="{html.escape(champ["libelle"] + "|" + champ["type"] + "|" + ("1" if champ["obligatoire"] else ""), quote=True)}">'
            for champ in champs
            if not (champ["verrouille"] or champ["code"] in codes_nature))
        # Le texte est déjà écrit par la nature : l'aperçu ne paraît qu'en mode
        # avancé. (Avant le 03/08/2026 il y avait une exception —
        # « Personnalisé », sans gabarit, dont la zone de mission était le
        # SEUL endroit où le message s'écrivait. Cette nature a été retirée,
        # l'exception avec elle.) Depuis le 15/08/2026 il partage le bloc
        # « avance » avec les options, sous un menu horizontal — voir
        # `_menu_etape2` : c'est le bloc entier qui disparaît en simplifié.
        # Entré ICI directement, la liste déjà remplie (§4 et §5) : on le dit,
        # avec le compte réel et la recette qui l'a bâtie. Sans cette phrase,
        # l'opérateur ne saurait pas que l'étape 3 est déjà faite.
        bloc_liste = ""
        if brouillon["contacts"]:
            bloc_liste = (
                f'<p class="pastille st-confirme">👥 Liste déjà remplie : '
                f'<strong>{len(brouillon["contacts"])}</strong> personne(s) — '
                + html.escape(assistant.libelle_recette(
                    brouillon.get("recette")))
                + ". Vous la verrez et pourrez la corriger à l'étape 3. "
                  "Aucun appel n'a été passé.</p>")
        corps = f"""{self._bandeau()}
<h1>Nouvelle campagne</h1>
{_fil_ariane(2, identifiant, brouillon.get("etape3_ouverte"))}
<p>Nature : {definition['icone']} <strong>{html.escape(definition['nom'])}</strong>
— <a href="/assistant">changer de nature</a></p>
{bloc_liste}
{_bascule_mode(mode_saisie)}
{self._blocs_messages(brouillon, "message")}
<form method="post" action="/assistant/message" class="carte" style="max-width:44rem">
  <input type="hidden" name="b" value="{html.escape(identifiant)}">
  {porteurs_champs}
  <h2>A. Informations générales <small class="sourd">(⚠ = obligatoire)</small></h2>
  {blocs_infos}
  <div class="avance">
  {_menu_etape2()}
  <div class="panneau-etape2" id="panneau-options" role="tabpanel"
       aria-labelledby="onglet-options">
  <h2>B. Options de comportement</h2>
  {bloc_options}
  <p><small>Ces options partent des valeurs réglées pour cette nature dans
  <a href="/reglages#comportement-{nature}">⚙ Réglages → Options de
  comportement</a>. En mode simplifié elles restent celles-là — elles ne
  sont pas perdues, seulement pas montrées.</small></p>
  </div>
  <div class="panneau-etape2" id="panneau-apercu" role="tabpanel"
       aria-labelledby="onglet-apercu">
  {bloc_apercu}
  </div>
  </div>
  <p><button name="action" value="continuer" style="font-size:1.05rem">
  Continuer → étape 3 (refusé si un ⚠ manque)</button></p>
</form>
{script_apercu}
{self._script_options()}
{_script_mode(mode_saisie)}
{_script_onglets_etape2()}"""
        return self._page("Nouvelle campagne — message", corps,
                          actif="campagnes", mode=mode_saisie)

    def _enregistrer_etape2(self, brouillon, donnees):
        """Reporte TOUT le formulaire de l'étape ② dans le brouillon."""
        definition = assistant.NATURES[brouillon["nature"]]
        for info in definition["infos"]:
            cle = f"info_{info['code']}"
            if info.get("multiple"):
                # ⚠ TOUTES LES VALEURS, pas seulement la première. La lecture
                # « donnees[cle][0] » perdait en silence tous les créneaux
                # sauf un — l'inverse de « une saisie n'est jamais perdue ».
                # Le champ d'AJOUT est ramassé ici aussi : une date tapée
                # sans appuyer sur « + » compte quand même.
                valeurs = list(donnees.get(cle, []))
                valeurs += list(donnees.get(f"{info['code']}_ajout", []))
                brouillon["creneaux"] = assistant.normaliser_creneaux(
                    " ".join(v.split()) for v in valeurs)
                brouillon["infos"][info["code"]] = (
                    brouillon["creneaux"][0]["horaire"]
                    if brouillon["creneaux"] else "")
            elif (info.get("reglage") == "creneaux_lisibles"
                  and len(donnees.get(cle, [])) > 1):
                # ⚠ PLUSIEURS CHAMPS POUR UNE MÊME INFORMATION : un par durée
                # à replacer. On les recolle dans l'ordre des durées — la
                # MÊME source que l'affichage, sinon la liste des 40 minutes
                # repartirait sous l'intitulé des 20.
                brouillon["infos"][info["code"]] = (
                    assistant.recomposer_par_duree(
                        self.application.preferences, donnees[cle],
                        assistant.durees_du_brouillon(
                            self.application.base, brouillon)))
            elif cle in donnees:
                brouillon["infos"][info["code"]] = " ".join(
                    donnees[cle][0].split())
        if definition["politique_modifiable"]:
            politique = donnees.get("politique", [""])[0]
            if politique in ("premier_oui", "tous"):
                brouillon["politique"] = politique
        ordre = donnees.get("ordre", [""])[0]
        if ordre in assistant.ORDRES_APPEL:
            brouillon["ordre"] = ordre
        options = brouillon["options"]
        options["recontacter"] = "opt_recontacter" in donnees
        options["liberer_creneau"] = "opt_liberer" in donnees
        options["repondeur_sans_motif"] = "opt_repondeur" in donnees
        options["cascade"] = "opt_cascade" in donnees
        # Seules les natures concernées portent la case : ailleurs, on ne
        # touche pas au réglage (une case absente ne vaut pas « décochée »).
        if assistant.option_annulation_utile(brouillon["nature"]):
            options[assistant.CLE_REPLACER_ANNULATION] = (
                "opt_replacer" in donnees)
        for cle in ("relance_mode", "relance_delai", "relance_creneau_debut",
                    "relance_creneau_fin", "relance_max", "cascade_jusqu_au"):
            if cle in donnees:
                options[cle] = donnees[cle][0].strip()
        # Les champs personnalisés voyagent AVEC le formulaire (un caché par
        # ligne) : les ajouter ou les retirer ne recharge pas la page, et la
        # liste complète revient à chaque envoi — on la reconstruit ici.
        personnalises = []
        vus = {champ["code"] for champ in definition["champs"]}
        vus.update({"identite", "telephone"})
        for brut in donnees.get("champ_perso", []):
            morceaux = brut.split("|")
            libelle = " ".join(morceaux[0].split())
            if not libelle:
                continue
            code = assistant.code_champ(libelle)
            if code in vus:
                continue
            vus.add(code)
            personnalises.append({
                "code": code, "libelle": libelle,
                "type": ("date" if len(morceaux) > 1 and morceaux[1] == "date"
                         else "texte"),
                "obligatoire": len(morceaux) > 2 and morceaux[2] == "1",
                "verrouille": False})
        brouillon["champs"] = ([dict(champ) for champ in definition["champs"]]
                               + personnalises)
        brouillon["mission_editee"] = (
            donnees.get("mission_editee", [""])[0] == "1")
        mission = donnees.get("mission", [""])[0].strip()
        if brouillon["mission_editee"] and mission:
            brouillon["mission"] = mission
        # La recette retient qu'un message a été récrit à la main : il ne
        # pourra pas être reconstruit sur un autre créneau sans inventer.
        brouillon.setdefault("recette", assistant.recette_vide())
        brouillon["recette"]["mission_editee"] = brouillon["mission_editee"]

    def _valider_creneaux(self, brouillon, info):
        """Contrôle CHAQUE place d'une information répétable ; rend les refus.

        ⚠ UNE PLACE REFUSÉE N'EN EMPORTE PAS D'AUTRES. Elle reste dans la
        liste, telle que tapée, et le message nomme LAQUELLE cloche : jeter
        les quatre places correctes parce que la cinquième est illisible
        serait la faute que le produit combat partout ailleurs.
        """
        erreurs = []
        liste = brouillon.get("creneaux") or []
        if info["obligatoire"] and not liste:
            erreurs.append(f"⛔ « {info['libelle']} » est "
                           "obligatoire pour cette nature de campagne : "
                           "ajoutez au moins une place avec le « + ».")
        propres = []
        for fiche in liste:
            brut = fiche.get("horaire", "")
            try:
                propres.append(dict(fiche,
                                    horaire=saisie.valider_horaire(brut)))
            except saisie.SaisieInvalide as erreur:
                erreurs.append(
                    f"« {info['libelle']} » — "
                    f"{self._creneau_lisible(brut)} : {erreur}")
                propres.append(fiche)
        brouillon["creneaux"] = assistant.normaliser_creneaux(propres)
        brouillon["infos"][info["code"]] = (
            brouillon["creneaux"][0]["horaire"]
            if brouillon["creneaux"] else "")
        return erreurs

    def _valider_etape2(self, brouillon):
        """Les contrôles RÉELS du passage à l'étape ③ ; rend les erreurs."""
        definition = assistant.NATURES[brouillon["nature"]]
        erreurs = []
        for info in definition["infos"]:
            if info.get("multiple"):
                erreurs += self._valider_creneaux(brouillon, info)
                continue
            valeur = (brouillon["infos"].get(info["code"]) or "").strip()
            if info["obligatoire"] and not valeur:
                erreurs.append(f"⛔ « {info['libelle']} » est obligatoire pour "
                               "cette nature de campagne.")
            elif valeur and info["type"] == "date":
                try:
                    brouillon["infos"][info["code"]] = saisie.valider_horaire(
                        valeur)
                except saisie.SaisieInvalide as erreur:
                    erreurs.append(f"« {info['libelle']} » : {erreur}")
        if not brouillon["ordre"]:
            erreurs.append("Choisissez l'ordre d'appel — aucun ordre n'est "
                           "imposé par défaut, la décision vous revient.")
        options = brouillon["options"]
        if options.get("recontacter"):
            delai = str(options.get("relance_delai", "")).strip()
            if delai and not (delai.isdigit() and int(delai) <= 168):
                erreurs.append("Relance : le délai doit être un nombre "
                               f"d'heures entre 0 et 168 (reçu « {delai} »).")
            maximum = str(options.get("relance_max", "")).strip()
            if maximum and not (maximum.isdigit() and int(maximum) <= 9):
                erreurs.append("Relance : le nombre maximal de rappels doit "
                               f"être entre 0 et 9 (reçu « {maximum} »).")
            if options.get("relance_mode") == "creneau":
                debut = options.get("relance_creneau_debut", "")
                fin = options.get("relance_creneau_fin", "")
                if not debut or not fin or debut >= fin:
                    erreurs.append("Relance : le créneau de rappel demande une "
                                   "heure de début PUIS une heure de fin "
                                   "(ex. 12:00 → 14:00).")
        if options.get("cascade"):
            limite = (options.get("cascade_jusqu_au") or "").strip()
            if not limite:
                erreurs.append("⛔ Décalage en cascade : indiquez la date "
                               "jusqu'à laquelle la chaîne peut décaler des "
                               "rendez-vous (format attendu : jj/mm/aaaa). "
                               "Sans cette limite, la chaîne n'aurait pas de "
                               "fin.")
            else:
                try:
                    jour = datetime.date.fromisoformat(limite)
                except ValueError:
                    erreurs.append("Décalage en cascade : la date limite est "
                                   f"illisible (reçu « {limite} ») — attendu "
                                   "une date du calendrier, par exemple "
                                   "31/12/2026.")
                else:
                    if jour < datetime.date.today():
                        erreurs.append(
                            "Décalage en cascade : la date limite "
                            f"({jour:%d/%m/%Y}) est déjà passée — aucune "
                            "campagne ne pourrait être préparée. Choisissez "
                            "une date à venir.")
        return erreurs

    def _traiter_message(self, corps):
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        identifiant = donnees.get("b", [""])[0]
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        if brouillon is None:
            return self._erreur(404, "Brouillon introuvable — recommencez "
                                     "depuis « Nouvelle campagne ».")
        self._enregistrer_etape2(brouillon, donnees)
        action = donnees.get("action", ["continuer"])[0]
        brouillon["message"] = ""
        # ⚠ LE « + » ET LES CROIX NE FONT PAS PASSER À L'ÉTAPE ③. Ils
        # rangent la liste des places et REVIENNENT ici : contrôler la suite
        # alors qu'on n'a rien demandé afficherait des refus sur un
        # formulaire qu'on est en train de remplir. Ce sont de vrais boutons
        # d'envoi, donc ça marche sans JavaScript.
        if action == "creneau-ajouter" or action.startswith("creneau-retirer:"):
            if action.startswith("creneau-retirer:"):
                # La croix porte L'HORAIRE, pas un rang : un rang aurait
                # désigné une autre place dès que la liste se retrie.
                vise = action.split(":", 1)[1]
                brouillon["creneaux"] = [
                    fiche for fiche in (brouillon.get("creneaux") or [])
                    if fiche.get("horaire") != vise]
                for info in assistant.NATURES[brouillon["nature"]]["infos"]:
                    if info.get("multiple"):
                        brouillon["infos"][info["code"]] = (
                            brouillon["creneaux"][0]["horaire"]
                            if brouillon["creneaux"] else "")
            brouillon["erreurs"] = []
            return self._rediriger(f"/assistant/message?b={identifiant}")
        # Ce que cet écran refuse APPARTIENT à cet écran : voir _blocs_messages.
        brouillon["erreurs_ecran"] = "message"
        # ⚠ « ajouter_champ » et « retirer_champ » NE SONT PLUS TRAITÉS ICI :
        # les colonnes ont leur écran à l'étape ③, avec la grille qu'elles
        # décrivent, et leur propre route (_traiter_champs_attendus) — c'est
        # elle qui revérifie ce qui est déjà rempli. Deux endroits pour la
        # même action finiraient par diverger : il n'en reste qu'un.
        # action « continuer » : les contrôles RÉELS, côté serveur.
        erreurs = self._valider_etape2(brouillon)
        if erreurs:
            brouillon["erreurs"] = erreurs
            journal.info("Assistant : passage à l'étape ③ REFUSÉ (%d ⛔/erreur)",
                         len(erreurs))
            return self._rediriger(f"/assistant/message?b={identifiant}")
        brouillon["erreurs"] = []
        # Le nom de l'entreprise ne se retape pas à chaque campagne : la
        # première fois qu'il est saisi, il devient le réglage par défaut.
        entreprise = (brouillon["infos"].get("entreprise") or "").strip()
        preferences = self.application.preferences
        if entreprise and not (preferences.obtenir(themes.CLE_ENTREPRISE)
                               or "").strip():
            preferences.definir(themes.CLE_ENTREPRISE, entreprise)
            journal.info("Nom de l'entreprise mémorisé dans les réglages.")
        # L'étape 3 devient atteignable par le fil d'Ariane, et le reste.
        brouillon["etape3_ouverte"] = True
        if not (brouillon["mission_editee"] and brouillon.get("mission")):
            brouillon["mission"] = assistant.construire_mission(
                brouillon["nature"], brouillon["infos"],
                self.application.preferences, brouillon["options"])
        return self._rediriger(f"/assistant/liste?b={identifiant}")

    # ------------------------------------------------------- étape ③ grille
    def _page_liste(self, identifiant):
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        if brouillon is None:
            return None
        base = self.application.base
        champs = assistant.champs_campagne(brouillon)
        colonnes = [c for c in champs
                    if c["code"] not in ("identite", "telephone")]
        contacts = brouillon["contacts"]
        exclus = sum(1 for c in contacts if base.telephone_exclu(c["telephone"]))
        sans_numero = sum(1 for c in contacts if not c["telephone"])
        numeros_essai = self._numeros_essai()
        essais = sum(1 for c in contacts
                     if db.est_numero_essai(c["telephone"], numeros_essai))
        bandeaux = ""
        if exclus:
            bandeaux += (f'<p class="erreurs">🚫 {exclus} contact(s) marqué(s) '
                         "« Ne plus appeler » : ils seront exclus d'office à "
                         'la validation, jamais composés — '
                         '<a href="/clients">gérer depuis 👥 Contacts</a>.</p>')
        if sans_numero:
            bandeaux += (f'<p class="bandeau">✎ {sans_numero} contact(s) sans '
                         "numéro (agenda importé) — à compléter dans la "
                         "colonne Téléphone avant de valider.</p>")
        if essais:
            bandeaux += (
                f'<p class="bandeau essai">🧪 {essais} ligne(s) portent le '
                "<strong>numéro d'un testeur</strong> que vous avez déclaré : "
                "c'est VOTRE téléphone qui sonnera, ou celui d'un testeur, "
                "pas celui d'un client. Elles peuvent donc porter le même "
                "numéro plusieurs fois — le refus de doublon reste entier "
                'pour tous les autres numéros. <a href="/reglages#numero-essai">'
                "Modifier ou retirer un testeur</a>.</p>")
        # LES CASES OBLIGATOIRES VIDES, CALCULÉES À CHAQUE AFFICHAGE — donc
        # dès l'importation des contacts, sans attendre un refus. C'est la
        # règle du propriétaire (02/08/2026) : une seule phrase d'erreur, et
        # la couleur montre où taper. La classe part à la première frappe
        # (voir _script_grille).
        manquantes = assistant.cellules_manquantes(brouillon)

        def marquer(rang, code):
            return ' class="manque"' if (rang, code) in manquantes else ""

        lignes = []
        for indice, contact in enumerate(contacts, start=1):
            # Le numéro masqué s'affiche DANS son champ (pas au-dessus : cela
            # décalerait chaque ligne). Un champ laissé tel quel — il contient
            # encore des « • » — vaut « inchangé » côté serveur.
            if contact["telephone"]:
                valeur_tel = html.escape(
                    db.masquer_telephone(contact["telephone"]), quote=True)
                repere = "taper un numéro pour le corriger"
            else:
                valeur_tel = ""
                repere = "⚠ numéro à compléter"
            marque = essai_reel.badge(
                {"numero_essai": db.est_numero_essai(contact["telephone"],
                                                     numeros_essai)}, "<br>")
            cellules = [f"""<td>{indice}</td>
  <td><input name="nom_{indice}"{marquer(indice, "identite")} value="{html.escape(contact['nom'])}" style="min-width:9rem">{marque}</td>
  <td><input name="tel_{indice}"{marquer(indice, "telephone")} value="{valeur_tel}" placeholder="{repere}"
      style="min-width:9rem" autocomplete="off"></td>"""]
            valeurs = contact.get("champs") or {}
            for colonne in colonnes:
                valeur = valeurs.get(colonne["code"], "")
                genre = ("datetime-local" if colonne["type"] == "date"
                         else "text")
                cellules.append(
                    f'<td><input type="{genre}" '
                    f'name="c_{colonne["code"]}_{indice}"'
                    f'{marquer(indice, colonne["code"])} '
                    f'value="{html.escape(valeur)}" style="min-width:8rem"></td>')
            cellules.append(f'<td><button class="secondaire" name="action" '
                            f'value="retirer:{indice}">Retirer</button></td>')
            lignes.append("<tr>" + "".join(cellules) + "</tr>")
        entetes = "".join(
            f"<th>{html.escape(c['libelle'])}"
            + (' <span class="obligatoire">⚠</span>' if c["obligatoire"] else "")
            + "</th>" for c in champs)
        if lignes:
            grille = (f"<table><tr><th>#</th>{entetes}<th></th></tr>"
                      + "\n".join(lignes) + "</table>")
        else:
            # ⚠ PLUS DE « CI-DESSOUS » : les voies de remplissage ne sont
            # plus sous la grille, elles s'ouvrent par « Ajouter des
            # contacts ». Laisser le mot aurait fait chercher au lecteur
            # quelque chose qui n'est pas là.
            grille = ('<p class="grille-vide">Aucune personne dans la grille. '
                      "Le bouton <strong>« Ajouter des contacts »</strong> "
                      "ouvre les façons de la remplir : coller une liste, "
                      "importer un fichier, reprendre des clients ou des "
                      "rendez-vous.</p>")
        attendu_collage = assistant.format_collage(champs)
        exemple_ligne = assistant.exemple_collage(champs)
        # La voie de remplissage choisie est conservée : après une erreur de
        # collage, on revient sur le collage, pas sur un autre écran.
        retenu = brouillon.get("remplissage") or "collage"
        # ⚠ LA VUE VOYAGE DANS LE BROUILLON. Deux moitiés dans la page, une
        # seule montrée — et c'est le serveur qui décide laquelle, pour que
        # le repli sans JavaScript soit entier.
        vue = brouillon.get("vue_liste") or "grille"
        # ⚠ DEUX BASCULES QUI NE FONT PAS LA MÊME CHOSE. « mode_liste » dit
        # CE QUI SERA ENVOYÉ (une règle ou une grille) ; « vue_liste » dit
        # seulement laquelle des deux faces du mode manuel est montrée.
        automatique = self._liste_automatique(brouillon)
        cache_manuel = " hidden" if automatique else ""
        cache_grille = (" hidden" if automatique or vue != "grille" else "")
        cache_ajout = (" hidden" if automatique or vue != "ajout" else "")
        verbe = ("RÉELS" if self.application.mode_reel else "simulés")
        # ⚠ PLUS DE BASCULE « SIMPLIFIÉ / AVANCÉ » SUR CET ÉCRAN (09/08/2026).
        # Elle ne commandait plus qu'une chose, le bloc « Les colonnes
        # attendues », retiré le même jour : les colonnes se lisent déjà dans
        # l'entête de la grille, avec leur ⚠, et le collage écrit le format
        # attendu. Une bascule qui ne bascule rien est un bouton qui ment.
        # L'étape ②, elle, garde la sienne — elle y cache l'aperçu du message.
        corps = f"""{self._bandeau()}
<h1>Nouvelle campagne</h1>
{_fil_ariane(3, identifiant, True)}
{self._blocs_messages(brouillon, "liste")}
{bandeaux}
{self._bascule_liste(identifiant, brouillon)}
{self._panneau_automatique(identifiant, brouillon)}
<div class="entete-grille"{cache_manuel}>
  <h2>Les personnes à appeler ({len(brouillon["contacts"])})</h2>
  {self._bouton_ajouter_contacts(identifiant, vue)}
</div>
<form method="post" action="/assistant/liste" id="form-grille"{cache_grille}>
  <input type="hidden" name="b" value="{html.escape(identifiant)}">
  {self._selecteur_ordre_grille(brouillon)}
  {grille}
  <p>
    <button class="secondaire" name="action" value="ligne">＋ Ajouter une ligne</button>
    <button class="secondaire" name="action" value="enregistrer">Enregistrer la grille</button>
  </p>
  <p><small>Les numéros restent masqués à l'écran ; la colonne Téléphone se
  corrige en tapant un nouveau numéro. Les appels ({verbe}) ne partiront
  qu'au ▶ Démarrer, depuis la fiche de la campagne.</small></p>
</form>
<form method="post" action="/assistant/csv"{cache_manuel}>
  <input type="hidden" name="b" value="{html.escape(identifiant)}">
  <button class="secondaire">Télécharger la liste (CSV, numéros en clair —
  généré à la volée, jamais stocké)</button>
</form>
<div class="carte vue-ajout" id="vue-ajout" style="max-width:44rem"{cache_ajout}>
<p><strong>Comment voulez-vous remplir la grille ?</strong>
<small class="sourd">— chaque voie ouvre son propre écran ; on peut les
enchaîner (les contacts s'ajoutent aux précédents).</small></p>
{_choix_panneaux_colonnes(
    "remplissage",
    ("Une liste que vous apportez", [
        ("collage", "✎ Coller une liste"),
        ("csv", "📄 Importer un fichier CSV"),
        ("ics", "📅 Importer un agenda (ICS)")]),
    ("Ce que RingBack a déjà", [
        ("clients", "👥 Charger des clients"),
        ("rendezvous", "📅 Charger selon les dates de rendez-vous"),
        ("campagne", "📣 Charger selon une campagne")]),
    retenu)}
<div class="panneau" id="panneau-collage">
  <form method="post" action="/assistant/importer">
    <input type="hidden" name="b" value="{html.escape(identifiant)}">
    <input type="hidden" name="mode" value="collage">
    <label>Une ligne par personne, colonnes dans l'ordre :
      <code>{html.escape(attendu_collage)}</code> (séparées par un
      point-virgule, une virgule ou une tabulation)<br>
      <textarea name="liste" rows="5" placeholder="{html.escape(exemple_ligne, quote=True)}"
      >{html.escape(brouillon.get("collage") or "")}</textarea></label>
    <p><small>⚠ = colonne obligatoire ; une colonne facultative peut rester
    vide. L'exemple en filigrane n'est pas envoyé — il montre seulement la
    forme attendue.</small></p>
    <button>Ajouter ces personnes à la grille</button>
  </form>
</div>
<div class="panneau" id="panneau-csv" hidden>
  <p><small>Mêmes colonnes que le collage (<code>{html.escape(attendu_collage)}</code>) ;
  une ligne d'en-tête est acceptée. Encodage UTF-8 ou Excel (cp1252) — les
  lignes fautives sont citées une par une.</small></p>
  <form method="post" action="/assistant/importer" enctype="multipart/form-data">
    <input type="hidden" name="b" value="{html.escape(identifiant)}">
    <input type="hidden" name="mode" value="csv">
    <input type="file" name="fichier" accept=".csv,text/csv">
    <button class="secondaire">Importer le CSV</button>
  </form>
</div>
<div class="panneau" id="panneau-ics" hidden>
  <p><small>Le titre « Nom — Motif » remplit la colonne motif, la date remplit
  le rendez-vous existant ; le numéro est cherché chez les clients connus,
  sinon le contact arrive « sans numéro », à compléter avant validation —
  jamais de numéro inventé.</small></p>
  <form method="post" action="/assistant/importer" enctype="multipart/form-data">
    <input type="hidden" name="b" value="{html.escape(identifiant)}">
    <input type="hidden" name="mode" value="ics">
    <input type="file" name="fichier" accept=".ics,text/calendar">
    <button class="secondaire">Importer l'agenda</button>
  </form>
</div>
<div class="panneau" id="panneau-clients" hidden>
  <form method="post" action="/assistant/importer">
    <input type="hidden" name="b" value="{html.escape(identifiant)}">
    <input type="hidden" name="mode" value="clients">
    <label class="champ-option">Quels clients<br>{_selecteur(
        "etat_client", self._choix_etats_clients(), "")}</label>
    <p><small>« Tous les clients » prend toute la base. Un état particulier
    ne prend que les clients qui sont dans cet état <strong>et qu'aucune
    campagne ne traite déjà</strong> — la liste se recalcule, elle n'est
    jamais recopiée.</small></p>
    <button>Ajouter ces personnes à la grille</button>
  </form>
</div>
<div class="panneau" id="panneau-rendezvous" hidden>
{self._bloc_periode_rendezvous(identifiant, brouillon)}
</div>
<div class="panneau" id="panneau-campagne" hidden>
{self._bloc_reprise_campagne(identifiant)}
</div>
</div>
{_script_panneaux()}
{_script_grille()}"""
        return self._page("Nouvelle campagne — personnes", corps,
                          actif="campagnes")

    def _choix_etats_clients(self):
        """« Tous les clients », puis les états qui appellent une campagne.

        La liste des états n'est pas recopiée ici : elle vient de
        etats_clients.TRAITEMENT, la même table qui décide, page 👥 Contacts,
        quel état appelle quelle nature de campagne. Un état ajouté là-bas
        apparaît ici sans qu'on y touche.
        """
        choix = [(assistant.SOURCE_TOUS_CLIENTS, "Tous les clients")]
        for etat in etats_clients.TRAITEMENT:
            choix.append((f"etat:{etat}", etats_clients.libelle_etat(etat)))
        return choix

    def _bloc_periode_rendezvous(self, identifiant, brouillon):
        """« Charger selon les dates » : la source, puis la semaine, puis le jour.

        Demandé par le propriétaire le 02/08/2026 : « ajouter une option
        semaine, puis un sélecteur de l'année en cours et un sélecteur des
        semaines avec la date du .. au .. affiché pour se retrouver
        facilement, puis une option du jour (parmi les jours ouvrés) avec une
        option tous ».

        Les trois sélecteurs sont TOUJOURS visibles : ce panneau est déjà le
        contenu d'une voie choisie ; y ajouter une case « voulez-vous
        filtrer ? » ferait l'option d'une option. « Toutes les semaines » et
        « tous les jours » sont les entrées neutres — rien n'est imposé.

        Le dernier choix se réaffiche DANS ses champs : après un refus, on
        corrige au lieu de tout re-choisir.
        """
        retenu = brouillon.get("periode") or {}
        aujourd_hui = datetime.date.today()
        annee = str(retenu.get("annee") or aujourd_hui.year)
        annees = [(str(a), str(a))
                  for a in range(aujourd_hui.year - 1, aujourd_hui.year + 2)]
        # De la semaine COURANTE à la fin de l'année : on monte une campagne
        # pour ce qui vient, pas pour janvier dernier.
        semaines = horaires.options_semaines(int(annee), aujourd_hui)
        semaine = str(retenu.get("semaine") or "")
        # Les jours proposés sont ceux de la semaine choisie, et OUVERTS
        # seulement : un jour fermé n'a aucun rendez-vous à rappeler.
        jours = []
        if semaine:
            lundi = horaires.lundi_de_semaine(int(annee), int(semaine))
            jours = [(f"{jour:%Y-%m-%d}", libelle) for jour, libelle
                     in horaires.jours_ouverts_de_semaine(
                         self.application.preferences, lundi)]
        return f"""  <form method="post" action="/assistant/importer">
    <input type="hidden" name="b" value="{html.escape(identifiant)}">
    <input type="hidden" name="mode" value="rendezvous">
    <label class="champ-option">Quels rendez-vous<br>{_selecteur(
        "source", list(assistant.SOURCES_RENDEZVOUS.items()),
        retenu.get("source") or "a_venir", identifiant="periode-source")}</label>
    <label class="champ-option">Année<br>{_selecteur(
        "annee", annees, annee, identifiant="periode-annee")}</label>
    <label class="champ-option">Semaine<br>{_selecteur(
        "semaine", semaines, semaine, identifiant="periode-semaine",
        vide="toutes les semaines")}</label>
    <label class="champ-option">Jour<br>{_selecteur(
        "jour", jours, str(retenu.get("jour") or ""),
        identifiant="periode-jour",
        vide="tous les jours de la semaine")}</label>
{self._champ_gain_manuel(identifiant)}
    <p><small>La date et le motif du rendez-vous remplissent les colonnes
    correspondantes. Les clients sans numéro et les 🚫 « Ne plus appeler »
    sont écartés et comptés. La liste est bâtie <strong>maintenant</strong>,
    sur la période choisie : ce sont ces personnes-là qui seront appelées.
    Une période ne vaut que pour les rendez-vous à venir ou manqués — les
    autres sources n'ont pas de date.</small></p>
    <button>Ajouter ces personnes à la grille</button>
  </form>
  <p><small>Choisir une année ou une semaine recharge les listes suivantes
  sans rien envoyer : aucun contact n'est ajouté avant le bouton.</small></p>
{_script_periode(identifiant)}"""

    def _debut_du_gain(self, brouillon, champs_formulaire):
        """(date de début, gain en jours) pour le chargement manuel.

        Le gain se compte à partir de la PREMIÈRE place de la campagne : une
        personne n'est retenue que si son rendez-vous tombe au moins N jours
        après elle. Même calcul que `assistant.contacts_de_la_regle` — un seul
        raisonnement, deux chemins qui s'en servent.

        Rend (None, "") quand rien n'est demandé, ou quand la campagne ne
        propose aucune place.
        """
        gain = str(champs_formulaire.get("regle_jours") or "").strip()
        if not gain.isdigit():
            return None, ""
        places = assistant.places_du_brouillon(brouillon)
        if not places:
            return None, ""
        # Le choix est RETENU dans le brouillon : il se réaffiche, et la
        # campagne créée le portera comme règle.
        regle = dict(brouillon.get("regle_liste") or {})
        regle["jours"] = gain
        regle.setdefault("source", champs_formulaire.get("source", ""))
        brouillon["regle_liste"] = regle
        debut = (datetime.datetime.fromisoformat(places[0])
                 + datetime.timedelta(days=int(gain))).isoformat(
                     timespec="minutes")
        return debut, gain

    def _champ_gain_manuel(self, identifiant):
        """Le gain minimum, DANS le formulaire de chargement manuel.

        ⚠ IL N'EXISTAIT QUE DANS L'AUTRE PANNEAU (14/08/2026). Le champ « au
        moins N jours » vivait dans le formulaire « Enregistrer la règle », en
        mode automatique. Le chargement manuel — celui que le propriétaire a
        employé — ne le portait pas, et n'appliquait donc AUCUN gain : il a
        chargé 328 personnes dont certaines gagnaient ZÉRO jour, alors qu'il
        avait choisi « au moins 30 jours » quelques centimètres plus haut, dans
        un panneau qu'il croyait commun.

        Deux panneaux, deux formulaires, un seul écran : c'est l'écran qui doit
        s'adapter, pas l'opérateur. Le champ est ici aussi, sous le même nom,
        et `_traiter_import_grille` l'applique.

        Il ne paraît que pour une campagne qui PROPOSE UNE PLACE : sans place,
        « gagner des jours » ne veut rien dire.
        """
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        if not brouillon or not assistant.places_du_brouillon(brouillon):
            return ""
        retenu = str((brouillon.get("regle_liste") or {}).get("jours") or "")
        return f"""    <label class="champ-option">Gain minimum — n'appeler que
      ceux que la place ferait avancer d'au moins<br>{_selecteur(
          "regle_jours", list(assistant.JOURS_APRES), retenu)}</label>"""

    def _bloc_reprise_campagne(self, identifiant):
        """Le filtre « repartir d'une campagne précédente » (étape ③).

        Les résultats des campagnes passées sont enregistrés en base : on
        peut donc rappeler exactement les 📵 injoignables, les ❌ refus, les
        🙋 « à rappeler par un humain »… d'une campagne donnée. C'est un
        FILTRE (deux critères combinés), donc deux listes déroulantes — les
        boutons radio restent réservés aux voies qui ouvrent un écran
        différent. Le nombre de personnes trouvées s'affiche AVANT l'ajout,
        et se recalcule tout seul quand on change un critère : seul ce
        chiffre est rafraîchi, la page ne bouge pas.
        """
        reprenables = assistant.campagnes_reprenables(self.application.base)
        if not reprenables:
            return ("<p><small>Aucune campagne précédente n'a encore de "
                    "contacts : ce filtre s'activera dès la première "
                    "campagne créée.</small></p>")
        choix_campagnes = [(str(cid), libelle) for cid, libelle, _ in reprenables]
        comptes = {str(cid): compte for cid, _, compte in reprenables}
        # Le dernier filtre utilisé reste affiché DANS ses champs : on
        # enchaîne « les injoignables, puis les refus » sans tout re-choisir.
        dernier = (self.application.obtenir_brouillon_assistant(identifiant)
                   or {}).get("reprise") or {}
        campagne_retenue = dernier.get("campagne")
        if campagne_retenue not in comptes:
            campagne_retenue = choix_campagnes[0][0]
        etat_retenu = dernier.get("etat")
        if etat_retenu not in assistant.ETATS_REPRISE:
            etat_retenu = "tous"
        total = comptes[campagne_retenue].get(etat_retenu, 0)
        # Les comptes réels, lus en base, voyagent avec la page : le chiffre
        # affiché n'est jamais une estimation.
        donnees = json.dumps(comptes, ensure_ascii=False).replace("</", "<\\/")
        return f"""  <form method="post" action="/assistant/importer">
    <input type="hidden" name="b" value="{html.escape(identifiant)}">
    <input type="hidden" name="mode" value="campagne">
    <label class="champ-option">La campagne dont on repart<br>{_selecteur(
        "campagne", choix_campagnes, campagne_retenue,
        identifiant="reprise-campagne")}</label>
    <label class="champ-option">Ne garder que<br>{_selecteur(
        "etat", list(assistant.ETATS_REPRISE.items()), etat_retenu,
        identifiant="reprise-etat")}</label>
    <p class="pastille" id="reprise-compte">{total} personne(s) trouvée(s) avec ce filtre.</p>
    <button>Ajouter ces personnes à la grille</button>
  </form>
  <p><small>Les contacts sans numéro et ceux marqués 🚫 « Ne plus appeler »
  sont écartés et comptés ; ceux déjà dans la grille ne sont pas
  redoublés.</small></p>
  <script type="application/json" id="reprise-comptes">{donnees}</script>
  <script>
(function(){{
var source=document.getElementById('reprise-comptes');
var campagne=document.getElementById('reprise-campagne');
var etat=document.getElementById('reprise-etat');
var sortie=document.getElementById('reprise-compte');
if(!source||!campagne||!etat||!sortie){{return;}}
var comptes=JSON.parse(source.textContent);
function majuscule(){{
var parEtat=comptes[campagne.value]||{{}};
var nombre=parEtat[etat.value]||0;
sortie.textContent=nombre+' personne(s) trouvée(s) avec ce filtre.';}}
campagne.addEventListener('change',majuscule);
etat.addEventListener('change',majuscule);
majuscule();
}})();
  </script>"""

    def _colonnes(self, brouillon):
        return [c for c in assistant.champs_campagne(brouillon)
                if c["code"] not in ("identite", "telephone")]

    @staticmethod
    def _liste_automatique(brouillon):
        """Vrai si cette campagne fabrique sa liste par une RÈGLE.

        Réservé aux natures qui ont une place à proposer : ailleurs, il n'y
        a pas de « place en cours » sur laquelle rejouer quoi que ce soit, et
        une bascule qui ne changerait rien serait un mensonge d'interface.
        """
        if not assistant.INFO_CRENEAU_PAR_NATURE.get(brouillon["nature"]):
            return False
        return brouillon.get("mode_liste") == "automatique"

    def _bascule_liste(self, identifiant, brouillon):
        """« Automatique / Manuel » — remplace « Simplifié / Avancé » ici.

        ⚠ CE N'EST PAS LA MÊME MÉCANIQUE, et c'est le point important : la
        bascule d'affichage ne change que ce qu'on voit et n'envoie rien ;
        celle-ci change ce qui EST ENVOYÉ au serveur. Les confondre aurait
        fait partir la grille manuelle ET la règle.
        """
        automatique = self._liste_automatique(brouillon)
        def bouton(code, libelle, actif):
            classe = "bascule-mode actif" if actif else "bascule-mode"
            return (f'<button class="{classe}" name="action" '
                    f'value="liste:{code}">{libelle}</button>')
        modes = ""
        if assistant.INFO_CRENEAU_PAR_NATURE.get(brouillon["nature"]):
            modes = f"""<form method="post" action="/assistant/liste"
      class="groupe-mode">
  <input type="hidden" name="b" value="{html.escape(identifiant)}">
  <span class="sourd"><small>Comment la liste se fabrique :</small></span>
  {bouton("automatique", "Automatique", automatique)}
  {bouton("manuel", "Manuel", not automatique)}
</form>"""
        # ⚠ LA RANGÉE EXISTE MÊME SANS BASCULE. Les natures sans place à
        # proposer n'ont pas de mode — mais elles ont un « Valider », et le
        # laisser dans la grille l'aurait mis à deux endroits selon la nature.
        # Un seul endroit, toujours le même.
        valider = self._bouton_valider(brouillon)
        if not modes and not valider:
            return ""
        return f'<div class="rangee-bascule">{modes}{valider}</div>'

    def _bouton_valider(self, brouillon):
        """« Valider — créer la campagne », dans la rangée du mode (09/08/2026).

        ⚠ IL RESTE LE BOUTON D'ENVOI DE LA GRILLE. Posé dans un autre
        formulaire, il aurait perdu les cellules éditées : on corrige un
        numéro, on clique « Valider », et la correction serait partie à la
        poubelle. L'attribut HTML « form » le rattache à la grille tout en le
        montrant ailleurs — aucun JavaScript, le repli reste entier.

        ⚠ IL N'APPARAÎT QUE QUAND IL Y A QUELQUE CHOSE À VALIDER : une règle
        en automatique, au moins une personne en manuel. Un bouton qui ne peut
        que refuser vaut moins qu'un bouton absent.
        """
        if self._liste_automatique(brouillon):
            pret = bool(assistant.regle_de_liste(brouillon))
        else:
            pret = bool(brouillon["contacts"])
        if not pret:
            return ""
        return ('<button form="form-grille" name="action" value="valider" '
                'class="valider-campagne">Valider — créer la campagne '
                "(état « prête », personne n'est appelé)</button>")

    def _panneau_automatique(self, identifiant, brouillon):
        """La RÈGLE : une source datée, et jusqu'où regarder après la place.

        ⚠ RIEN D'ABSOLU ICI — ni année, ni semaine, ni jour. Une période
        absolue rendrait la campagne non rejouable : la rejouer sur une
        autre place donnerait les mêmes personnes, pas celles que la nouvelle
        place intéresse. La fenêtre part donc TOUJOURS de la place en cours.
        """
        if not self._liste_automatique(brouillon):
            return ""
        # ⚠ PLEINE LARGEUR, comme la grille du mode manuel (09/08/2026). Une
        # carte étroite à côté d'un tableau qui prend toute la zone donnait
        # deux modes de largeurs différentes pour un même écran.
        return (f'<div class="carte panneau-automatique" id="panneau-regle">'
                + self._corps_regle(identifiant, brouillon) + "</div>"
                + _script_regle(identifiant))

    def _corps_regle(self, identifiant, brouillon):
        """L'intérieur du panneau de la règle — rendu seul quand il se recharge.

        ⚠ SÉPARÉ DU CADRE EXPRÈS : changer la source recharge CE bloc, pas la
        page (règle du propriétaire). C'est le même découpage que le panneau des
        dates, et pour la même raison — c'est le serveur qui sait quels réglages
        ont un sens pour la source choisie, pas le navigateur.
        """
        regle = brouillon.get("regle_liste") or {}
        source = regle.get("source") or assistant.REGLE_LISTE_DEFAUT["source"]
        # ⚠ SOURCES_REGLE, PAS SOURCES_DATEES (15/08/2026, sa demande) : la
        # règle dynamique en propose une de moins — « posés, prévus ET
        # confirmés » est partie d'ici. Elle reste offerte au chargement
        # MANUEL, où reprendre une journée entière du planning a du sens.
        sources = [(code, assistant.SOURCES_BASE[code])
                   for code in assistant.SOURCES_REGLE]
        # ⚠ PAS DE <form> ICI, ET C'EST LE CŒUR DU DÉFAUT LE PLUS TENACE DE CE
        # CHANTIER (15/08/2026). Le panneau était un formulaire À PART, avec son
        # bouton « Enregistrer la règle ». Le bouton « ▶ Valider », lui, soumet
        # `form-grille` — un AUTRE formulaire, qui ne portait donc ni la source
        # ni le gain minimum. Résultat : le propriétaire choisissait « au moins
        # 30 jours », cliquait « Valider », et son choix N'ATTEIGNAIT JAMAIS LE
        # SERVEUR. Sa campagne partait avec « jours: "" » et appelait des gens
        # de la semaine suivante. Il l'a signalé quatre fois ; j'ai corrigé deux
        # autres chemins avant de regarder celui-là.
        #
        # Les champs appartiennent maintenant à `form-grille` : quel que soit le
        # bouton — « Enregistrer la règle », « Enregistrer la grille » ou
        # « ▶ Valider » — la règle affichée est celle qui part. Un choix visible
        # à l'écran ne peut plus être perdu par le bouton qu'on préfère.
        return f"""
  <p><strong>La liste se refait à chaque place.</strong> Vous ne choisissez
  pas des personnes, vous choisissez une <strong>règle</strong> : elle est
  rejouée chaque fois que la campagne passe à la place suivante, si bien que
  chaque place s'adresse à ceux qu'elle intéresse vraiment.</p>
    <div class="rangee-regle">
    <label class="champ-option">Quels rendez-vous<br>{_selecteur(
        "regle_source", sources, source, forme="form-grille")}</label>
    {self._champ_fenetre(source, regle)}
    {self._selecteur_ordre_regle(brouillon, source)}
    {self._champ_plafond(brouillon)}
    </div>
    {self._phrase_interet(source)}
    <button form="form-grille" name="action" value="regle">Enregistrer la
    règle</button>"""

    @staticmethod
    def _champ_fenetre(source, regle):
        """« Jusqu'où après la place » — SEULEMENT là où elle agit.

        ⚠ LE DÉFAUT QUE CECI CORRIGE (11/08/2026), constaté par le propriétaire
        et mesuré : sur les sources sans rendez-vous à venir, la fenêtre ne fait
        RIEN. Mesuré sur le jeu d'essai, source « annulés, manqués et en
        attente » : 9 personnes retenues avec « sans limite », 9 avec « 7 jours »,
        9 avec « 30 », 9 avec « 90 ». Le réglage était donc à l'écran, réglable,
        et sans effet — ce qui se lit comme un défaut du produit.

        Ce n'est pas la règle qui avait tort : quelqu'un qui n'a PLUS de
        rendez-vous n'a aucune date à borner, n'importe quelle place l'arrange.
        C'était l'ÉCRAN qui proposait un réglage inapplicable sans le dire.
        """
        if source in assistant.SOURCES_A_VENIR:
            # ⚠ LE LIBELLÉ DIT LE GAIN, PAS LA MÉCANIQUE (11/08/2026). Il disait
            # « Jusqu'où après la place », ce qui décrivait une borne de
            # recherche — et il retenait les gens qui gagnaient le MOINS. La
            # question qu'on se pose vraiment est : à qui cette place sert-elle
            # assez pour qu'on décroche le téléphone ?
            return f"""<label class="champ-option">Combien de temps elle leur
  fait gagner, au minimum<br>{
                _selecteur("regle_jours", list(assistant.JOURS_APRES),
                           str(regle.get("jours") or ""),
                           forme="form-grille")}</label>"""
        # La valeur enregistrée voyage quand même, cachée : revenir à une source
        # datée doit retrouver la fenêtre qu'on y avait réglée, pas zéro.
        return f"""<input type="hidden" name="regle_jours" form="form-grille"
      value="{html.escape(str(regle.get('jours') or ''))}">
    <p class="champ-option sourd"><small>Ces personnes n'ont
    <strong>plus de rendez-vous</strong> : elles n'ont rien à gagner ni à
    perdre, n'importe quelle place les arrange. Le temps gagné ne se calcule
    donc pas ici.</small></p>"""

    @staticmethod
    def _phrase_interet(source):
        """La règle de l'intérêt, dite pour la source CHOISIE et pas les autres.

        Deux populations, deux phrases : les afficher toutes les deux à tout le
        monde faisait lire une explication dont la moitié ne concernait pas la
        campagne en cours.
        """
        if source in assistant.SOURCES_A_VENIR:
            return """<p><small><strong>Une place n'intéresse quelqu'un que si
    elle lui apporte quelque chose.</strong> Ces personnes ont encore un
    rendez-vous : elles ne sont appelées que pour une place <strong>plus
    tôt</strong> que le leur — proposer plus tard serait proposer un retard. Le
    temps gagné, c'est l'écart entre leur rendez-vous et cette place ; le réglage
    ci-dessus dit à partir de combien de jours gagnés cela vaut un appel.
    Personne n'est appelé avant le ▶ Démarrer.</small></p>"""
        return """<p><small><strong>Ces personnes attendent une place.</strong>
    Elles n'ont plus de rendez-vous du tout : n'importe quelle place les
    intéresse, et la colonne « Prochain rdv » de la campagne restera donc vide
    jusqu'à ce qu'un appel leur en donne un. Personne n'est appelé avant le
    ▶ Démarrer.</small></p>"""

    def _bouton_ajouter_contacts(self, identifiant, vue):
        """Le bouton qui ouvre — ou referme — les voies de remplissage.

        ⚠ C'EST UN VRAI BOUTON D'ENVOI, dans son propre petit formulaire :
        sans JavaScript il fonctionne à l'identique. Le produit tient cette
        règle partout, et c'est elle qui a permis de livrer l'installeur, le
        calendrier et la sélection de plage sans écrire deux fois chaque
        geste.
        """
        if vue == "ajout":
            libelle, geste = "↩ Revenir à la grille", "grille"
            classe = "secondaire"
        else:
            libelle, geste = "＋ Ajouter des contacts", "ajout"
            classe = ""
        return f"""<form method="post" action="/assistant/liste"
      class="bouton-ajouter">
  <input type="hidden" name="b" value="{html.escape(identifiant)}">
  <button class="{classe}" name="action" value="vue:{geste}">{libelle}</button>
</form>"""

    @staticmethod
    def _choix_ordre(brouillon):
        """L'ordre courant et les choix à montrer — les DEUX écrans le partagent.

        ⚠ IL NE PROPOSE PAS QUE DEUX CHOIX QUAND UN TROISIÈME EST EN COURS.
        Le propriétaire n'en demande que deux (le plus lointain, le plus
        proche) ; mais si l'étape ② a choisi « alphabétique », le montrer est
        le seul moyen de ne pas l'écraser au premier envoi.
        """
        courant = brouillon.get("ordre") or "liste"
        # ⚠ PAS DE TRI PAR DATE SANS DATE (14/08/2026, audit croisé). Les deux
        # ordres proposés trient sur le rendez-vous du contact
        # (`ordonner_contacts` lit champs_contact()["rdv_existant"]). Une
        # « prise de rendez-vous » ne porte pas cette colonne : les deux choix
        # y laissaient l'ordre INCHANGÉ, et la fiche annonçait ensuite un ordre
        # qui n'avait jamais été appliqué. On n'offre pas un réglage sans effet.
        disponibles = (assistant.ORDRES_PAR_DATE
                       if assistant.nature_porte_un_rendezvous(
                           brouillon.get("nature")) else ())
        choix = [(code, assistant.ORDRES_APPEL[code]) for code in disponibles]
        if courant not in disponibles:
            choix.append((courant, assistant.ORDRES_APPEL.get(
                courant, courant) + " (choisi à l'étape ②)"))
        return courant, choix

    def _selecteur_ordre_regle(self, brouillon, source=None):
        """L'ordre d'appel du mode AUTOMATIQUE (09/08/2026).

        ⚠ IL MANQUAIT, et cela se voyait à l'usage : l'ordre ne se réglait que
        dans la grille — invisible en automatique. La campagne appelait donc
        dans l'ordre hérité de l'étape ②, sans qu'on puisse le lire ni le
        changer. Il part avec le formulaire de la règle, que `_traiter_grille`
        lit comme tous les autres (le champ s'appelle « ordre », comme dans la
        grille : un seul nom, un seul endroit qui le relit).

        ⚠ LE LIBELLÉ SUIT LA SOURCE (11/08/2026). Les deux ordres trient sur la
        date du rendez-vous du contact — mais sur les sources sans rendez-vous à
        venir, cette date est celle du rendez-vous PERDU, dans le passé. « Le
        rendez-vous le plus lointain d'abord » y voulait donc dire « celle qui
        vient de perdre sa place », ce qui n'est pas du tout la même idée. Le tri
        n'a pas changé — c'est ce qu'il dit qui devient exact.
        """
        courant, choix = self._choix_ordre(brouillon)
        if source is not None and source not in assistant.SOURCES_A_VENIR:
            courant, choix = self._choix_ordre_attente(brouillon)
        else:
            courant, choix = self._choix_ordre_gain(brouillon)
        return f"""<label class="champ-option">Qui est appelé en premier<br>{
            _selecteur("ordre", choix, courant,
                       forme="form-grille")}</label>"""

    def _choix_ordre_gain(self, brouillon):
        """Les mêmes ordres, dits en TEMPS GAGNÉ (11/08/2026).

        Question du propriétaire, mot pour mot : « est-ce qu'on sélectionne en
        premier le rendez-vous le plus dans le futur, ou le premier à partir de
        la date de début ? ». Les libellés d'avant nommaient la MÉCANIQUE (« le
        rendez-vous le plus LOINTAIN d'abord ») ; ceux-ci nomment la CONSÉQUENCE,
        qui est la seule chose qu'on veuille décider.

        Le tri, lui, ne bouge pas : « le plus lointain d'abord » EST « celle qui
        gagne le plus ».
        """
        courant, choix = self._choix_ordre(brouillon)
        mots = {
            "eloignement": "Celle qui gagne le PLUS de temps (rendez-vous le "
                           "plus lointain)",
            "anciennete": "Celle qui gagne le MOINS (rendez-vous le plus "
                          "proche de la place)",
        }
        return courant, [(code, mots.get(code, libelle))
                         for code, libelle in choix]

    def _choix_ordre_attente(self, brouillon):
        """Les mêmes ordres, dits pour des gens qui ATTENDENT une place.

        Même code de tri, autres mots : on trie toujours sur la date du
        rendez-vous du contact, et pour eux c'est celui qu'ils ont perdu.
        """
        courant, choix = self._choix_ordre(brouillon)
        mots = {
            "eloignement": "Celle qui a perdu sa place le plus RÉCEMMENT",
            "anciennete": "Celle qui attend depuis le plus LONGTEMPS",
        }
        return courant, [(code, mots.get(code, libelle))
                         for code, libelle in choix]

    @staticmethod
    def _champ_plafond(brouillon):
        """« Au maximum … personnes » — le plafond de contacts à charger.

        ⚠ IL PART DANS LE MÊME FORMULAIRE QUE L'ORDRE, et c'est `_traiter_grille`
        qui le relit : un seul nom de champ (« plafond »), un seul endroit qui le
        lit. Un champ posé dans un formulaire que personne ne relit aurait été
        jeté en silence — c'est arrivé au sélecteur d'ordre, et le commentaire de
        `_selecteur_ordre_grille` en garde la trace.

        Vide = aucun plafond. Le format attendu est MONTRÉ dans le champ, et le
        libellé dit ce que le plafond fait : limiter les appels.
        """
        courant = str(brouillon.get("plafond") or "")
        return f"""<label class="champ-option">Au maximum, combien de personnes
  <br><input type="number" name="plafond" min="1" step="1"
  form="form-grille" value="{html.escape(courant)}" placeholder="toutes"
  title="Laissez vide pour n'écarter personne"></label>"""

    def _selecteur_ordre_grille(self, brouillon):
        """L'ordre d'appel, AU-DESSUS de la grille (demande du 03/08/2026).

        ⚠ IL VIT DANS LE MÊME FORMULAIRE QUE LA GRILLE, et c'est
        `_traiter_grille` qui le lit. Posé ailleurs, il n'aurait été lu par
        personne : `_enregistrer_etape2` ne tourne que sur l'étape ②, et un
        « ordre » envoyé avec la grille était jeté EN SILENCE — la grille
        montrait un ordre, la campagne appelait dans un autre.

        ⚠ IL NE PROPOSE PAS QUE DEUX CHOIX QUAND UN TROISIÈME EST EN COURS.
        Le propriétaire n'en demande que deux (le plus lointain, le plus
        proche) ; mais si l'étape ② a choisi « alphabétique », le montrer
        aurait été le seul moyen de ne pas l'écraser au premier envoi.
        """
        # ⚠ PAS DEUX SÉLECTEURS D'ORDRE DANS LA PAGE. En automatique
        # c'est le panneau de la règle qui porte l'ordre ; celui-ci reste
        # DANS le formulaire de la grille, lequel part aussi quand on clique
        # « Valider ». Les deux ensemble, la valeur de la grille — la vieille —
        # écrasait en silence celle qu'on venait de choisir dans le panneau.
        if self._liste_automatique(brouillon):
            return ""
        courant, choix = self._choix_ordre(brouillon)
        # ⚠ LA PHRASE SUIT LA NATURE (14/08/2026, audit croisé). Elle expliquait
        # l'ordre par « la place qui se libère » — ce qui n'a de sens que sur un
        # créneau libéré. Sur les quatre autres natures, l'opérateur lisait une
        # justification qui ne correspondait à rien de ce qu'il faisait.
        pourquoi = ("Le rendez-vous le plus lointain a le plus à gagner à "
                    "avancer sur la place qui se libère."
                    if brouillon.get("nature") == "creneau_libere"
                    else "Le rendez-vous le plus proche est le plus urgent à "
                         "traiter ; le plus lointain laisse le temps de "
                         "s'organiser.")
        return f"""<div class="rangee-regle">
<label class="champ-option ordre-grille">Ordre d'appel —
  qui est appelé en premier<br>{_selecteur("ordre", choix, courant)}</label>
{self._champ_plafond(brouillon)}
</div>
<p class="sourd"><small>{pourquoi} La grille se remet dans cet ordre dès que
vous l'enregistrez : c'est l'ordre réel des appels. Le maximum, lui, ne retire
jamais une ligne déjà là : il limite ce que les prochains chargements
ajoutent.</small></p>"""

    def _enregistrer_grille(self, brouillon, donnees):
        """Reporte les cellules éditées dans le brouillon ; rend les erreurs."""
        erreurs = []
        colonnes = self._colonnes(brouillon)
        for indice, contact in enumerate(brouillon["contacts"], start=1):
            cle_nom = f"nom_{indice}"
            if cle_nom in donnees:
                contact["nom"] = " ".join(donnees[cle_nom][0].split())
            telephone = donnees.get(f"tel_{indice}", [""])[0].strip()
            # Le champ affiche le numéro MASQUÉ : s'il contient encore des
            # « • », c'est qu'il n'a pas été retouché — on n'y touche pas non
            # plus (jamais de numéro reconstruit à partir d'un masque).
            if telephone and "•" not in telephone:
                try:
                    contact["telephone"] = saisie.valider_telephone(telephone)
                except saisie.SaisieInvalide as erreur:
                    erreurs.append(f"Ligne {indice} : {erreur}")
            for colonne in colonnes:
                cle = f"c_{colonne['code']}_{indice}"
                if cle not in donnees:
                    continue
                valeur = " ".join(donnees[cle][0].split())
                if valeur and colonne["type"] == "date":
                    try:
                        valeur = saisie.valider_horaire(valeur)
                    except saisie.SaisieInvalide as erreur:
                        erreurs.append(f"Ligne {indice}, colonne "
                                       f"« {colonne['libelle']} » : {erreur}")
                        continue
                champs = contact.setdefault("champs", {})
                if valeur:
                    champs[colonne["code"]] = valeur
                else:
                    champs.pop(colonne["code"], None)
        return erreurs

    def _numeros_essai(self):
        """Les numéros des testeurs déclarés dans ⚙ Réglages, ou [] (aucun)."""
        return essai_reel.numeros_declares(self.application.preferences)

    def _valider_grille(self, brouillon):
        """Les contrôles de la validation finale (⛔, doublons, vide).

        Le refus de doublon reste ENTIER : deux fois le même numéro, c'est
        deux appels chez la même personne. Une seule famille d'exceptions,
        voulue et déclarée par l'opérateur lui-même : les 🧪 numéros de ses
        TESTEURS (⚙ Réglages) — le sien, et ceux des personnes qui jouent un
        rôle avec lui (voir essai_reel). Tout autre numéro répété reste
        refusé, sans exception.
        """
        erreurs = []
        contacts = brouillon["contacts"]
        # ⚠ EN AUTOMATIQUE, LA GRILLE EST VIDE PAR CONSTRUCTION. Les personnes
        # ne sont pas choisies ici : elles sont trouvées par la règle, rejouée
        # à chaque place. Refuser le vide aurait rendu ce mode inutilisable.
        # Ce qui est exigé, c'est la RÈGLE — sans elle la campagne
        # n'appellerait personne.
        #
        # ⚠ MAIS ON NE SORT PAS D'ICI POUR AUTANT. La grille peut ne PAS être
        # vide en automatique : on tape trois personnes en manuel, on bascule,
        # et elles restent — c'est voulu, une saisie ne se perd jamais. Sortir
        # tout de suite les faisait partir SANS le refus de doublon et SANS
        # l'exclusion des « ne plus appeler ». Les contrôles du bas s'appliquent
        # donc aussi, dès qu'il y a quelqu'un à contrôler.
        if self._liste_automatique(brouillon):
            if not assistant.regle_de_liste(brouillon):
                erreurs.append("Choisissez la règle qui fabrique la liste, "
                               "puis « Enregistrer la règle ».")
            if not contacts:
                return erreurs
        elif not contacts:
            erreurs.append("La grille est vide : ajoutez au moins une personne.")
            return erreurs
        # ⚠ SANS MESSAGE, RIEN NE PART — ET SURTOUT PAS UNE PAGE BLANCHE.
        # Mesuré le 20/08/2026 en écrivant l'essai du numéro complété : depuis
        # son planning, la sélection saute DIRECTEMENT à l'étape ③, et le
        # brouillon arrive avec « mission » à None. Cliquer « Valider » sans
        # repasser par ② faisait remonter une IntegrityError de SQLite
        # (« NOT NULL constraint failed: campagnes.mission ») jusqu'au
        # gestionnaire HTTP : connexion coupée, page blanche, rien à lire.
        # Un champ obligatoire vide se REFUSE, comme tous les autres ici, en
        # disant où aller le remplir.
        if not (brouillon.get("mission") or "").strip():
            erreurs.append("Le message à dire au téléphone est vide : "
                           "revenez à l'étape ② pour l'écrire.")
        if brouillon["politique"] == "unique" and len(contacts) > 1:
            erreurs.append("Cette nature appelle UN SEUL contact : gardez une "
                           f"seule ligne ({len(contacts)} actuellement).")
        # ⚠ LES CASES VIDES NE FONT QU'UNE SEULE PHRASE. Elles produisaient
        # une ligne chacune : trente phrases identiques sur dix contacts, et
        # toujours pas de repère pour savoir où taper. La couleur, dans la
        # grille, dit maintenant OÙ ; ce message dit QUOI.
        if assistant.cellules_manquantes(brouillon):
            erreurs.append(assistant.MESSAGE_CHAMPS_OBLIGATOIRES)
        # Le doublon, lui, garde sa phrase à lui : ce n'est pas un manque,
        # c'est un conflit ENTRE deux lignes — colorer une case ne dirait pas
        # laquelle des deux est en cause.
        numeros_essai = self._numeros_essai()
        vus = {}
        for indice, contact in enumerate(contacts, start=1):
            if not contact["telephone"]:
                continue
            if (contact["telephone"] in vus
                    and not db.est_numero_essai(contact["telephone"],
                                                numeros_essai)):
                erreurs.append(f"Ligne {indice} : même numéro que la ligne "
                               f"{vus[contact['telephone']]} — retirez le "
                               "doublon.")
            else:
                vus.setdefault(contact["telephone"], indice)
        return erreurs

    def _traiter_grille(self, corps):
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        identifiant = donnees.get("b", [""])[0]
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        if brouillon is None:
            return self._erreur(404, "Brouillon introuvable — recommencez "
                                     "depuis « Nouvelle campagne ».")
        erreurs = self._enregistrer_grille(brouillon, donnees)
        action = donnees.get("action", ["enregistrer"])[0]
        brouillon["message"] = ""
        brouillon["erreurs_ecran"] = "liste"
        # ⚠ ON RÉORDONNE LA LISTE ELLE-MÊME, JAMAIS SEULEMENT L'AFFICHAGE.
        # Les cellules sont nommées par POSITION (nom_1, tel_1, c_x_1…) et
        # relues par la même position : trier au rendu aurait écrit le numéro
        # corrigé sur la personne restée en position 1. Un numéro sur le
        # mauvais nom, dans une liste qui sera composée.
        # ⚠ ET APRÈS `_enregistrer_grille` : celui-ci relit par position, il
        # doit voir la liste telle qu'elle était affichée.
        ordre = donnees.get("ordre", [""])[0]
        if ordre in assistant.ORDRES_APPEL and ordre != brouillon.get("ordre"):
            brouillon["ordre"] = ordre
        # LE PLAFOND, lu au même endroit que l'ordre. Le champ est un
        # « number » : vide ou zéro veut dire « aucun plafond », et une valeur
        # illisible n'écarte personne plutôt que d'écarter au hasard.
        if "plafond" in donnees:
            brut = donnees["plafond"][0].strip()
            brouillon["plafond"] = brut if brut.isdigit() and int(brut) else ""
        # ⚠ LA RÈGLE AUSSI, ET C'EST LE DÉFAUT LE PLUS COÛTEUX DE TOUT CE
        # CHANTIER (14/08/2026). Le gain minimum n'était enregistré QUE par le
        # bouton « Enregistrer la règle ». Choisi dans le sélecteur puis suivi
        # d'un clic sur « Valider », il était SILENCIEUSEMENT PERDU — et
        # l'écran continuait d'afficher « au moins 30 jours », puisque c'est le
        # navigateur qui tient cette valeur. Le propriétaire a donc monté
        # plusieurs campagnes en croyant avoir demandé un gain de trente jours ;
        # sa campagne n°33 porte « jours: "" », et elle a appelé des gens de la
        # même semaine. Il a cherché la cause quatre fois de suite.
        #
        # Un champ présent dans le formulaire soumis est PRIS EN COMPTE, quel
        # que soit le bouton — exactement comme l'ordre et le plafond juste
        # au-dessus. Un choix visible à l'écran ne doit jamais être ignoré.
        source = donnees.get("regle_source", [""])[0]
        if source in assistant.SOURCES_DATEES:
            brouillon["regle_liste"] = {
                "source": source,
                "jours": donnees.get("regle_jours", [""])[0].strip()}
        if brouillon.get("ordre") and not action.startswith("retirer:"):
            premier = assistant.creneau_courant(
                {"creneau": brouillon["infos"].get("creneau_libere"),
                 "configuration": ""},
                {"creneaux": brouillon.get("creneaux") or []})
            brouillon["contacts"] = assistant.ordonner_contacts(
                brouillon["contacts"], brouillon["ordre"],
                creneau=(premier or {}).get("horaire"))
        if action.startswith("liste:"):
            brouillon["mode_liste"] = action.split(":", 1)[1]
            brouillon["erreurs"] = []
            return self._rediriger(f"/assistant/liste?b={identifiant}")
        if action == "regle":
            source = donnees.get("regle_source", [""])[0]
            if source not in assistant.SOURCES_DATEES:
                erreurs.append("Choisissez les rendez-vous que la règle "
                               "reprend.")
            else:
                brouillon["regle_liste"] = {
                    "source": source,
                    "jours": donnees.get("regle_jours", [""])[0].strip()}
                brouillon["message"] = (
                    "Règle enregistrée. Elle sera rejouée à chaque place.")
            brouillon["erreurs"] = erreurs
            return self._rediriger(f"/assistant/liste?b={identifiant}")
        if action.startswith("vue:"):
            # On change de vue, on ne valide rien : afficher des refus sur un
            # formulaire qu'on vient d'ouvrir n'aurait aucun sens.
            brouillon["vue_liste"] = action.split(":", 1)[1]
            brouillon["erreurs"] = []
            return self._rediriger(f"/assistant/liste?b={identifiant}")
        if action.startswith("retirer:"):
            try:
                indice = int(action.split(":", 1)[1])
                retire = brouillon["contacts"].pop(indice - 1)
                brouillon["message"] = (f"« {retire['nom']} » retiré de la "
                                        "grille.")
            except (ValueError, IndexError):
                erreurs.append("Ligne à retirer introuvable.")
        elif action == "ligne":
            brouillon["contacts"].append({"nom": "", "telephone": "",
                                          "champs": {}})
            # Une personne écrite à la main n'a aucun critère derrière elle :
            # la liste n'est plus reproductible sur un autre créneau (§8.3).
            assistant.noter_apport_recette(brouillon, "ligne")
            brouillon["message"] = ("Ligne vide ajoutée — remplissez-la puis "
                                    "« Enregistrer la grille ».")
        elif action == "enregistrer" and not erreurs:
            brouillon["message"] = "Grille enregistrée."
        elif action == "valider":
            erreurs += self._valider_grille(brouillon)
            if not erreurs:
                campagne_id = assistant.creer_campagne_prete(
                    self.application.base, brouillon,
                    self.application.preferences)
                self.application.brouillons_assistant.pop(identifiant, None)
                return self._rediriger(f"/campagne?id={campagne_id}&fait=prete")
            journal.info("Assistant : validation de la grille REFUSÉE "
                         "(%d erreur(s))", len(erreurs))
        brouillon["erreurs"] = erreurs
        return self._rediriger(f"/assistant/liste?b={identifiant}")

    def _traiter_import_grille(self, corps):
        type_contenu = self.headers.get("Content-Type", "")
        if type_contenu.startswith("multipart/form-data"):
            from .serveur import _analyser_multipart
            champs_formulaire, fichier = _analyser_multipart(type_contenu, corps)
        else:
            donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
            champs_formulaire = {nom: valeurs[0]
                                 for nom, valeurs in donnees.items()}
            fichier = None
        identifiant = champs_formulaire.get("b", "")
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        if brouillon is None:
            return self._erreur(404, "Brouillon introuvable — recommencez "
                                     "depuis « Nouvelle campagne ».")
        base = self.application.base
        brouillon["erreurs_ecran"] = "liste"
        champs = assistant.champs_campagne(brouillon)
        connus = [c["telephone"] for c in brouillon["contacts"]
                  if c["telephone"]]
        # Les 🧪 numéros des testeurs déclarés : eux seuls peuvent revenir
        # plusieurs fois (plusieurs identités sur des téléphones connus —
        # celui de l'opérateur, et ceux des personnes qui jouent avec lui).
        numeros_essai = self._numeros_essai()
        mode = champs_formulaire.get("mode", "")
        # On revient sur la voie qui vient de servir (et pas sur une autre).
        brouillon["remplissage"] = mode or brouillon.get("remplissage")
        nouveaux, erreurs, complements = [], [], []
        try:
            if mode == "collage":
                colle = champs_formulaire.get("liste", "")
                nouveaux, erreurs, refusees = assistant.analyser_collage(
                    colle, champs, connus, numeros_essai)
                # Une saisie refusée n'est JAMAIS perdue : les lignes qui
                # n'ont rien donné reviennent telles quelles dans la zone, à
                # corriger sur place. Celles déjà entrées dans la grille en
                # disparaissent — sinon un second envoi ferait des doublons.
                brouillon["collage"] = "\n".join(refusees)
                if nouveaux:
                    assistant.noter_apport_recette(brouillon, "collage")
            elif mode == "csv":
                if not fichier:
                    erreurs.append("Aucun fichier reçu — choisissez un "
                                   "fichier CSV.")
                else:
                    nouveaux, erreurs = assistant.analyser_csv(
                        fichier, champs, connus, numeros_essai)
                    if nouveaux:
                        assistant.noter_apport_recette(brouillon, "csv")
            elif mode == "ics":
                if not fichier:
                    erreurs.append("Aucun fichier reçu — choisissez un "
                                   "fichier ICS.")
                else:
                    nouveaux, sans_numero, erreurs = assistant.contacts_depuis_ics(
                        base, fichier, champs, connus)
                    if nouveaux:
                        assistant.noter_apport_recette(brouillon, "ics")
                    if sans_numero:
                        complements.append(f"{sans_numero} contact(s) sans "
                                           "numéro — à compléter avant "
                                           "validation")
            elif mode in ("base", "rendezvous"):
                # « base » est l'ANCIEN nom de cette voie : il reste accepté
                # pour que les liens et les essais d'avant le 02/08/2026
                # continuent de marcher. « rendezvous » est le nouveau.
                source = champs_formulaire.get("source", "")
                # Le filtre de dates est retenu DANS le brouillon : après un
                # refus, il se réaffiche dans ses champs.
                periode = self._periode_choisie(champs_formulaire, brouillon)
                periode["source"] = source or periode["source"]
                brouillon["periode"] = periode
                debut, fin = self._bornes_de_periode(periode)
                # ⚠ LE GAIN MINIMUM S'APPLIQUE ICI AUSSI (14/08/2026). Il ne
                # valait que dans le panneau « automatique » : ce chargement-ci
                # prenait tout le monde, quelle que soit la case « au moins
                # N jours » cochée juste à côté. Le propriétaire a ainsi chargé
                # 328 personnes dont certaines gagnaient zéro jour, et il a vu
                # ses rendez-vous avancer de deux jours au lieu de trente.
                #
                # Les deux bornes se combinent : la période dit QUELLE semaine,
                # le gain dit à partir de QUAND. On garde la plus tardive.
                debut_gain, gain = self._debut_du_gain(brouillon,
                                                       champs_formulaire)
                if debut_gain and (not debut or debut_gain > debut):
                    debut = debut_gain
                nouveaux, complements = assistant.contacts_depuis_base(
                    base, source, champs, connus, debut, fin)
                if gain:
                    complements.append(
                        f"gain minimum : {gain} jours — seuls ceux que cette "
                        "place ferait vraiment avancer")
                if periode.get("semaine"):
                    complements.append("période : "
                                       + assistant.libelle_periode(periode))
                # La recette retient le CRITÈRE, pas les personnes. Une
                # période, elle, DÉSIGNE des dates précises : rejouer « la
                # semaine 48 » sur un autre créneau donnerait les mêmes
                # personnes, pas celles du nouveau créneau. La campagne est
                # donc marquée non rejouable — voir noter_apport_recette.
                assistant.noter_apport_recette(
                    brouillon, "ligne" if debut else "base", source=source)
            elif mode == "clients":
                # Une seule question à l'écran (« quels clients ? »), deux
                # chemins derrière : toute la base, ou un état particulier —
                # et ce second chemin est CELUI DE LA PAGE 👥 Contacts, pas
                # une seconde version qui aurait fini par en diverger.
                choix = champs_formulaire.get("etat_client", "")
                if choix.startswith("etat:"):
                    etat = choix.split(":", 1)[1]
                    # ⚠ contacts_PAR_etat, pas contacts_DEPUIS_etat : ici on
                    # charge les clients de cet état, un point c'est tout.
                    # Les deux conditions de la page 👥 Contacts (la nature
                    # doit traiter l'état, le client ne doit être dans aucune
                    # campagne) n'ont pas de sens quand c'est l'opérateur qui
                    # demande explicitement un état.
                    nouveaux, complements = etats_clients.contacts_par_etat(
                        base, etat, champs, connus,
                        preferences=self.application.preferences)
                    # La liste est un instantané de l'état d'aujourd'hui :
                    # elle ne se rejoue pas telle quelle sur un autre créneau.
                    assistant.noter_apport_recette(brouillon, "ligne")
                else:
                    nouveaux, complements = assistant.contacts_depuis_base(
                        base, assistant.SOURCE_TOUS_CLIENTS, champs, connus)
                    assistant.noter_apport_recette(
                        brouillon, "base",
                        source=assistant.SOURCE_TOUS_CLIENTS)
            elif mode == "campagne":
                # Repartir des RÉSULTATS d'une campagne précédente, filtrés
                # par état (les injoignables, les refus, les acceptés…).
                etat = champs_formulaire.get("etat", "tous")
                # Le filtre choisi est gardé : il se réaffiche DANS ses
                # champs au retour, pour enchaîner un second état.
                brouillon["reprise"] = {
                    "campagne": champs_formulaire.get("campagne", ""),
                    "etat": etat}
                try:
                    campagne_id = int(champs_formulaire.get("campagne", ""))
                except ValueError:
                    raise saisie.SaisieInvalide(
                        "Choisissez la campagne dont vous repartez.") from None
                nouveaux, complements = assistant.contacts_depuis_campagne(
                    base, campagne_id, etat, champs, connus)
                assistant.noter_apport_recette(brouillon, "campagne",
                                               campagne=campagne_id, etat=etat)
            else:
                erreurs.append("Source de remplissage inconnue.")
        except saisie.SaisieInvalide as erreur:
            erreurs.append(str(erreur))
        # ⚠ LE PLAFOND S'APPLIQUE ICI, ET SEULEMENT SUR CE QUI ENTRE. La grille
        # n'est jamais taillée : une ligne déjà là — tapée à la main, collée,
        # corrigée — n'est pas retirée par un plafond réglé après coup. Les
        # présents comptent dans le plafond, ils n'en sont pas victimes.
        plafond = assistant.plafond_de(brouillon)
        # ⚠ LE POINT D'AJOUT COMMUN À TOUTES LES VOIES (collage, CSV, agenda,
        # base, états, campagne précédente) : le filtre des déjà confirmés se
        # pose ICI, une seule fois, plutôt qu'une fois par voie (20/08/2026).
        nouveaux, deja_confirmes = assistant.ecarter_les_deja_confirmes(
            self.application.base, brouillon.get("nature"), nouveaux)
        if deja_confirmes:
            complements = list(complements) + [
                assistant.phrase_deja_confirmes(deja_confirmes)]
        deja = len(brouillon["contacts"])
        nouveaux, hors_plafond = assistant.limiter_au_plafond(
            nouveaux, plafond, ordre=brouillon.get("ordre"),
            creneau=(brouillon.get("infos") or {}).get("creneau_libere"),
            deja=deja)
        if hors_plafond:
            complements.append(assistant.raison_plafond(plafond, hors_plafond))
        elif plafond and deja + len(nouveaux) < plafond:
            # Le plafond n'est pas atteint : on dit d'où vient l'écart plutôt
            # que de laisser un chiffre inexpliqué (voir manque_au_plafond).
            complements.append(
                assistant.manque_au_plafond(plafond, deja + len(nouveaux)))
        brouillon["contacts"].extend(nouveaux)
        brouillon["erreurs"] = erreurs
        # ⚠ ON REVIENT À LA GRILLE dès que le remplissage a donné quelque
        # chose : c'est elle qu'on veut relire après avoir ajouté du monde.
        # En cas de REFUS on reste sur la voie, avec l'erreur et la saisie —
        # revenir à la grille aurait fait disparaître les deux.
        if nouveaux:
            brouillon["vue_liste"] = "grille"
        message = f"{len(nouveaux)} contact(s) ajouté(s) à la grille."
        if complements:
            message += " " + " ; ".join(complements) + "."
        brouillon["message"] = message if nouveaux or complements else ""
        if not nouveaux and not erreurs and not complements:
            brouillon["erreurs"] = [
                "Aucun contact de cette campagne n'est dans cet état — "
                "choisissez un autre état, ou une autre campagne."
                if mode == "campagne"
                else "Aucun contact trouvé depuis cette source."]
        return self._rediriger(f"/assistant/liste?b={identifiant}")

    def _traiter_csv_grille(self, corps):
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        identifiant = donnees.get("b", [""])[0]
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        if brouillon is None:
            return self._erreur(404, "Brouillon introuvable.")
        contenu = assistant.en_csv(assistant.champs_campagne(brouillon),
                                   brouillon["contacts"]).encode("utf-8-sig")
        nom_fichier = datetime.date.today().strftime("liste_campagne_%Y%m%d.csv")
        journal.info("Export CSV de la grille de l'assistant : %d personne(s) "
                     "(servi à la volée)", len(brouillon["contacts"]))
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition",
                         f'attachment; filename="{nom_fichier}"')
        self.send_header("Content-Length", str(len(contenu)))
        self.end_headers()
        self.wfile.write(contenu)

    # --------------------------- avant de démarrer : l'agenda de RingBack
    # POURQUOI CE RAPPEL EXISTE — et pourquoi seulement ICI.
    # Le travail est double (§8.1) : un rendez-vous pris ou déplacé au
    # téléphone change l'agenda LOCAL de RingBack **et** entre au cahier des
    # changements que l'opérateur reporte dans son propre logiciel. Tout le
    # produit s'appuie donc sur cet agenda : les créneaux annoncés au
    # téléphone en sont déduits, et un agenda périmé fait proposer des
    # places déjà prises dans la vraie vie.
    # Ce rappel n'apparaît QU'AU MOMENT de démarrer, et nulle part ailleurs :
    # un avertissement qu'on voit partout ne se lit plus nulle part. Pour
    # qu'il reste lu, il ne pose pas une question creuse — il porte les
    # CHIFFRES DU JOUR, tirés de la base, et le début de la liste de créneaux
    # que l'agent va réellement annoncer. Rien n'y est estimé : ce qui
    # n'existe pas (aucune trace d'import) est dit « inconnu ».
    def _fragment_verification_agenda(self, campagne):
        """Le panneau de vérification de l'agenda, calculé à l'instant du clic."""
        base = self.application.base
        preferences = self.application.preferences
        contacts = base.contacts_de_campagne(campagne["id"])
        faits = assistant.verification_agenda(base, preferences, campagne,
                                              contacts)
        reprise = campagne["statut"] == "en pause"
        verbe = "RÉELLEMENT" if self.application.mode_reel else "en simulation"
        # --- les faits, un par ligne, tous tirés de la base ---
        lignes = []
        lignes.append(
            f"<li><strong>{faits['a_appeler']}</strong> personne(s) "
            f"{'restant à appeler' if reprise else 'à appeler'} dans cette "
            "campagne.</li>")
        periode = (f"du {faits['debut']:%d/%m/%Y} au {faits['fin']:%d/%m/%Y}")
        if faits["rendezvous"]:
            lignes.append(
                f"<li><strong>{faits['rendezvous']}</strong> rendez-vous "
                f"connu(s) dans l'agenda de RingBack sur la période concernée "
                f"({periode}), dont <strong>{faits['occupants']}</strong> qui "
                "occupe(nt) réellement une place.</li>")
        else:
            lignes.append(
                "<li><strong>Aucun</strong> rendez-vous connu dans l'agenda "
                f"de RingBack sur la période concernée ({periode}).</li>")
        detail_places = ""
        if faits["places_manuelles"]:
            detail_places = (f" (dont {faits['places_manuelles']} ajoutée(s) "
                             "à la main dans les réglages)")
        puise = ("c'est là-dedans que RingBack puisera si un rendez-vous se "
                 "décide pendant l'appel" if faits["creneaux"] == "aucun"
                 else "c'est là-dedans que l'agent puisera")
        lignes.append(
            f"<li><strong>{faits['places']}</strong> place(s) libre(s) "
            f"calculée(s) à cet instant, sur les {faits['horizon']} prochains "
            f"jours{detail_places} — {puise}.</li>")
        if faits["prochaines"]:
            # La phrase dit exactement ce que ces dates sont : celles que
            # l'agent va annoncer, ou simplement les premières libres quand
            # la liste de la campagne a été écrite à la main.
            debut_liste = f"<strong>{html.escape(faits['prochaines'])}</strong>"
            if faits["creneaux"] == "calcules":
                lignes.append(
                    f"<li>Les premières places qu'il annoncera : {debut_liste}."
                    " Si ces dates ne sont plus libres dans votre vrai "
                    "planning, n'allez pas plus loin.</li>")
            elif faits["creneaux"] == "a_la_main":
                lignes.append(
                    "<li>Les premières places libres de l'agenda, dans "
                    f"l'ordre : {debut_liste} — ce n'est PAS ce que l'agent "
                    "dira, la liste de cette campagne étant écrite à la "
                    "main.</li>")
            else:
                lignes.append(
                    "<li>Les premières places libres de l'agenda, dans "
                    f"l'ordre : {debut_liste}.</li>")
        explication = {
            "calcules": "Cette campagne annonce des créneaux : ils sont "
                        "recalculés depuis l'agenda de RingBack juste avant "
                        "chaque appel.",
            "a_la_main": "Cette campagne annonce une liste de créneaux "
                         "ÉCRITE À LA MAIN : RingBack ne la recalcule pas, "
                         "elle sera dite telle quelle.",
            "aucun": "Cette campagne n'annonce aucune liste de créneaux ; "
                     "l'agenda sert quand même à écrire ce qui se décide "
                     "pendant l'appel.",
        }[faits["creneaux"]]
        lignes.append(f"<li>{explication}</li>")
        trace = faits["import"]
        if trace is None:
            lignes.append(
                "<li>Dernier import de rendez-vous par fichier : "
                "<strong>inconnu</strong> — aucun import n'a jamais été "
                "enregistré (les rendez-vous saisis à la main ne comptent "
                "pas ici).</li>")
        else:
            jours = faits["import_jours"]
            age = ("aujourd'hui" if jours == 0
                   else "hier" if jours == 1
                   else f"il y a {jours} jours")
            lignes.append(
                "<li>Dernier import de rendez-vous par fichier : "
                f"<strong>{html.escape(themes.date_lisible(trace['quand']))}</strong>"
                f" — {age} ({html.escape(trace['quoi'])}, "
                f"{trace['rendezvous']} rendez-vous).</li>")
        # --- ce que RingBack CONSTATE lui-même, dit franchement ---
        bloc_alertes = ""
        if faits["alertes"]:
            elements = "".join(f"<li>{html.escape(a)}</li>"
                               for a in faits["alertes"])
            bloc_alertes = (
                '<div class="erreurs"><strong>⚠ Ce que RingBack constate '
                f"lui-même :</strong><ul>{elements}</ul></div>")
        # --- le bouton porte ce qu'il engage : le mode et les chiffres ---
        if faits["alertes"]:
            libelle = (f"▶ {'Reprendre' if reprise else 'Démarrer'} quand "
                       f"même — appeler {verbe} : {faits['a_appeler']} "
                       f"personne(s), {faits['places']} place(s) libre(s)")
        else:
            libelle = (f"▶ Oui, l'agenda est à jour — "
                       f"{'reprendre' if reprise else 'démarrer'} et appeler "
                       f"{verbe} : {faits['a_appeler']} personne(s), "
                       f"{faits['places']} place(s) libre(s)")
        titre = ("Avant de reprendre" if reprise else "Avant de démarrer")
        # tabindex=-1 : à l'ouverture, c'est le PANNEAU qui prend le focus, pas
        # le bouton — sinon une deuxième frappe sur Entrée lancerait la
        # campagne sans que rien n'ait été lu. Le geste reste volontaire.
        return f"""<div class="verif-agenda" tabindex="-1">
<h2>🗓 {titre} : les créneaux annoncés sortent de l'agenda de RingBack</h2>
<p>Au téléphone, l'agent proposera les places libres <strong>déduites de
l'agenda de RingBack</strong>, pas de votre logiciel de planification. Si
cet agenda n'est pas à jour, il proposera des places <strong>déjà prises
dans la vraie vie</strong> — et le rendez-vous obtenu tombera sur quelqu'un
d'autre. Reportez d'abord ce qui a changé, puis lancez.</p>
<ul>{''.join(lignes)}</ul>
{bloc_alertes}
<div class="verif-boutons">
  <form method="post" action="/campagne/demarrer">
    <input type="hidden" name="campagne" value="{campagne['id']}">
    <button name="agenda_verifie" value="1">{html.escape(libelle)}</button>
  </form>
  <button type="button" class="secondaire" data-verif-fermer>
    Pas encore — je vais vérifier l'agenda</button>
</div>
<p><small>Pour corriger d'abord : <a href="/suivi">📅 le planning de la
semaine</a> · <a href="/ajouter">＋ importer un agenda (ICS) ou un fichier
CSV</a> · <a href="/reglages#horaires">⚙ les horaires d'ouverture</a>.
Aucun appel ne part tant que vous n'avez pas cliqué.</small></p>
</div>"""

    def _servir_verification_agenda(self, parametres):
        """Sert le panneau seul (fragment) : l'élément se remplit, pas la page."""
        try:
            campagne_id = int(parametres.get("id", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de campagne invalide.")
        campagne = self.application.base.obtenir_campagne(campagne_id)
        if campagne is None or not campagne.get("nature"):
            return self._erreur(404, "Campagne introuvable.")
        return self._repondre_fragment(
            self._fragment_verification_agenda(campagne))

    def _servir_periode(self, parametres):
        """Sert le panneau « dates de rendez-vous » seul, avec le choix en cours.

        Le choix est ENREGISTRÉ dans le brouillon avant d'être rendu : sans
        cela, changer d'année puis envoyer le formulaire repartirait de
        l'année du chargement — une saisie perdue en silence.
        """
        identifiant = parametres.get("b", [""])[0]
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        if brouillon is None:
            return self._erreur(404, "Brouillon introuvable — recommencez "
                                     "depuis « Nouvelle campagne ».")
        brouillon["periode"] = self._periode_choisie(
            {nom: valeurs[0] for nom, valeurs in parametres.items()},
            brouillon)
        return self._repondre_fragment(
            self._bloc_periode_rendezvous(identifiant, brouillon))

    def _servir_regle(self, parametres):
        """Sert le panneau de la règle seul, recalé sur la source choisie.

        ⚠ CE QUI EST DÉJÀ TAPÉ EST GARDÉ, comme pour le panneau des dates : la
        source, la fenêtre, l'ordre et le plafond du formulaire sont écrits dans
        le brouillon AVANT le rendu. Sans cela, changer de source aurait effacé
        en silence un plafond qu'on venait de saisir.

        Rien n'est ENREGISTRÉ comme règle pour autant : c'est le bouton
        « Enregistrer la règle » qui décide, et lui seul.
        """
        identifiant = parametres.get("b", [""])[0]
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        if brouillon is None:
            return self._erreur(404, "Brouillon introuvable — recommencez "
                                     "depuis « Nouvelle campagne ».")
        champs = {nom: valeurs[0] for nom, valeurs in parametres.items()}
        source = champs.get("regle_source", "")
        if source in assistant.SOURCES_DATEES:
            regle = dict(brouillon.get("regle_liste") or {})
            regle["source"] = source
            regle["jours"] = champs.get("regle_jours", "").strip()
            brouillon["regle_liste"] = regle
        ordre = champs.get("ordre", "")
        if ordre in assistant.ORDRES_APPEL:
            brouillon["ordre"] = ordre
        plafond = champs.get("plafond", "").strip()
        brouillon["plafond"] = (plafond if plafond.isdigit() and int(plafond)
                                else "")
        return self._repondre_fragment(
            self._corps_regle(identifiant, brouillon))

    @staticmethod
    def _periode_choisie(champs, brouillon):
        """Le filtre de dates retenu, nettoyé — jamais une valeur inventée.

        Changer d'année ou de semaine remet à zéro ce qui en dépend : une
        semaine 53 gardée sur une année qui n'en a que 52, ou un jour gardé
        d'une autre semaine, désigneraient une période que personne n'a
        choisie.
        """
        avant = brouillon.get("periode") or {}
        retenu = {"source": champs.get("source") or avant.get("source")
                  or "a_venir"}
        try:
            retenu["annee"] = int(champs.get("annee")
                                  or avant.get("annee")
                                  or datetime.date.today().year)
        except (TypeError, ValueError):
            retenu["annee"] = datetime.date.today().year
        semaine = (champs.get("semaine") or "").strip()
        retenu["semaine"] = semaine if semaine.isdigit() else ""
        if retenu["semaine"]:
            borne = horaires.nombre_de_semaines(retenu["annee"])
            if not 1 <= int(retenu["semaine"]) <= borne:
                retenu["semaine"] = ""
        jour = (champs.get("jour") or "").strip()
        retenu["jour"] = ""
        if jour and retenu["semaine"]:
            try:
                choisi = datetime.date.fromisoformat(jour)
            except ValueError:
                choisi = None
            lundi = horaires.lundi_de_semaine(retenu["annee"],
                                              retenu["semaine"])
            if choisi and lundi <= choisi < lundi + datetime.timedelta(days=7):
                retenu["jour"] = jour
        return retenu

    @staticmethod
    def _bornes_de_periode(periode):
        """(début, fin) en texte ISO pour ce filtre — (None, None) si aucun."""
        if not periode or not periode.get("semaine"):
            return None, None
        if periode.get("jour"):
            debut = datetime.date.fromisoformat(periode["jour"])
            return horaires.bornes_de_periode(
                debut, debut + datetime.timedelta(days=1))
        lundi = horaires.lundi_de_semaine(periode["annee"], periode["semaine"])
        return horaires.bornes_de_periode(lundi,
                                          lundi + datetime.timedelta(days=7))

    def _servir_zones_vivantes(self, parametres):
        """Sert les deux zones vivantes d'une campagne (fragment)."""
        try:
            campagne_id = int(parametres.get("id", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de campagne invalide.")
        campagne = self.application.base.obtenir_campagne(campagne_id)
        if campagne is None or not campagne.get("nature"):
            return self._erreur(404, "Campagne introuvable.")
        return self._repondre_fragment(
            self._page_pilotage(campagne, parametres, fragment=True))

    @staticmethod
    def _script_campagne(campagne_id):
        """Pendant une campagne : les DEUX ZONES se remettent à jour, seules.

        Trois choses valent d'être dites :

        ① On ne remplace une zone que si elle a VRAIMENT changé. Entre deux
           appels, la page ne bouge donc pas du tout — plus de clignotement
           permanent, plus de sélection de texte qui saute sous la souris.
        ② On s'arrête dès que la campagne n'est plus « en cours ». Le statut
           voyage sur la zone elle-même : c'est la réponse du serveur qui
           décide, pas une supposition du navigateur.
        ③ Sans JavaScript, il ne se passe rien : la page reste celle du
           chargement, et le bouton ↻ du navigateur fait le travail. Aucune
           fonction n'est perdue, seule la mise à jour automatique l'est.
        """
        return """<script>
(function(){
var etat=document.getElementById('campagne-etat');
var suite=document.getElementById('campagne-suite');
if(!etat||!suite||!window.fetch){return}
var url='/campagne/vivant?id=%d';
function tourner(){
  if(etat.getAttribute('data-statut')!=='en cours'){return}
  fetch(url).then(function(r){return r.ok?r.text():null}).then(function(t){
    if(t){
      var bac=document.createElement('div');bac.innerHTML=t;
      ['campagne-etat','campagne-suite'].forEach(function(id){
        var neuf=bac.querySelector('#'+id),vieux=document.getElementById(id);
        if(!neuf||!vieux){return}
        /* Ne toucher au DOM que s'il y a vraiment du neuf. */
        if(neuf.innerHTML!==vieux.innerHTML){vieux.innerHTML=neuf.innerHTML}
        var s=neuf.getAttribute('data-statut');
        if(s!==null){vieux.setAttribute('data-statut',s)}});}
    setTimeout(tourner,1500);
  }).catch(function(){setTimeout(tourner,1500)});}
setTimeout(tourner,1500);
/* Le gestionnaire du « détail abrégé » vivait ici. Il est parti le 11/08/2026
   avec la colonne « Détail » : plus aucune cellule n'émet « data-detail », et un
   écouteur qui n'attrape rien est un piège pour qui relira. */
})();
</script>""" % campagne_id

    def _script_verification_agenda(self):
        """Le clic sur ▶ Démarrer demande le panneau AU SERVEUR et remplit le
        SEUL bloc prévu — la page n'est jamais rechargée, et les chiffres
        affichés sont ceux de l'instant du clic, pas ceux du chargement.

        Sans JavaScript (ou si la demande échoue), le formulaire part
        normalement : le serveur refuse le démarrage faute de confirmation
        et renvoie la page AVEC le même panneau ouvert. Le repli est entier.
        """
        return """<script>
(function(){
var forme=document.getElementById('form-demarrer');
var zone=document.getElementById('verification-agenda');
if(!forme||!zone||!window.fetch){return}
forme.addEventListener('submit',function(e){
  e.preventDefault();
  zone.hidden=false;zone.classList.add('en-attente');
  fetch(forme.getAttribute('data-verification'))
   .then(function(r){return r.text()})
   .then(function(t){
     zone.innerHTML=t;zone.classList.remove('en-attente');
     var fermer=zone.querySelector('[data-verif-fermer]');
     if(fermer){fermer.addEventListener('click',function(){
       zone.hidden=true;zone.innerHTML='';forme.querySelector('button').focus();})}
     /* Le focus va au PANNEAU, jamais au bouton : une frappe sur Entrée ne
        doit pas enchaîner sur le lancement sans qu'on ait lu. */
     var panneau=zone.querySelector('.verif-agenda');
     if(panneau){panneau.focus()}})
   .catch(function(){
     /* Serveur injoignable : on laisse partir l'envoi ordinaire, qui
        aboutit au même panneau rendu par le serveur. */
     zone.classList.remove('en-attente');zone.hidden=true;
     forme.submit();});});
})();
</script>"""

    # ------------------------------------------- cahier de changements (§8.1)
    def _bloc_cahier(self, campagne, configuration, contacts):
        """Le cahier des changements à REPORTER — lisible, copiable, exportable.

        Le vrai livrable d'une campagne. Il est lu depuis la table des
        changements (une ligne écrite au moment du changement), jamais
        recalculé depuis les états : c'est ce qui garantit qu'aucun
        changement ne se perd. Rien n'est affiché qui n'ait été écrit.
        """
        base = self.application.base
        campagne_id = campagne["id"]
        changements = base.changements_de_campagne(campagne_id)
        # Le bandeau §8.2 : le contact qui a MODIFIÉ son rendez-vous, mis en
        # avant quand la campagne s'est arrêtée sur son oui.
        bandeau = ""
        epargnes = sum(1 for c in contacts if c["etat"] == "épargné")
        mis_en_avant = assistant.changement_mis_en_avant(changements)
        # ⚠ LE MOT AFFICHÉ, PAS LE CODE (14/08/2026, audit croisé). Cette phrase
        # écrivait « épargné(s) » en clair, à l'endroit même qui explique
        # l'état : le tableau juste en dessous disait « pas appelé », et la même
        # page portait donc deux mots pour une seule chose — dont celui que le
        # propriétaire a dit ne pas comprendre.
        mot = assistant.mot_etat("épargné")
        if mis_en_avant is not None and epargnes:
            bandeau = (
                '<p class="pastille st-confirme">✅ Objectif atteint — '
                f"<strong>{html.escape(mis_en_avant['nom'])}</strong> a "
                "déplacé son rendez-vous du "
                f"<strong>{html.escape(assistant.date_courte(mis_en_avant['ancienne_date']))}</strong>"
                " au "
                f"<strong>{html.escape(assistant.date_courte(mis_en_avant['nouvelle_date']))}</strong>."
                f" La campagne s'est arrêtée là : {epargnes} contact(s) "
                f"💤 {html.escape(mot)}(s), jamais dérangé(s).</p>")
        elif epargnes:
            # ⚠ ET IL Y A UN BANDEAU MÊME SANS DÉPLACEMENT (14/08/2026). La
            # phrase ne s'écrivait que s'il existait une ligne ↔ au cahier :
            # une campagne conclue par quelqu'un qui n'avait AUCUN ancien
            # rendez-vous (les gens qui attendent une place) laissait donc ses
            # « pas appelé » sans un mot d'explication nulle part — la colonne
            # détail ayant été retirée du tableau, il ne restait rien.
            bandeau = (
                f'<p class="pastille">💤 {epargnes} contact(s) '
                f"{html.escape(mot)}(s), jamais dérangé(s) — la campagne "
                "s'est arrêtée avant eux. La raison est écrite sur chaque "
                "ligne : ouvrez « 🔁 Relances » pour la lire.</p>")
        # Le maillon de cascade, quand cette campagne en est un.
        marque = configuration.get("cascade") or {}
        bloc_cascade = ""
        if marque:
            ecartes = marque.get("ecartes") or {}
            resserrement = ""
            if ecartes.get("anterieurs"):
                resserrement = (
                    f" Sa liste a été recalculée pour cette date : "
                    f"{marque.get('retenus', '?')} contact(s) retenu(s), "
                    f"{ecartes['anterieurs']} écarté(s) parce que leur "
                    "rendez-vous est AVANT cette place — la décaler leur "
                    "ferait perdre du temps.")
            elif marque.get("retenus"):
                resserrement = (f" Sa liste a été recalculée pour cette date : "
                                f"{marque['retenus']} contact(s) retenu(s).")
            bloc_cascade = (
                '<p class="pastille st-deplace">🔗 Campagne préparée '
                "automatiquement (décalage en cascade) : son créneau est la "
                "place du "
                f"{html.escape(assistant.date_courte(marque.get('creneau')))} "
                f"libérée par {html.escape(marque.get('demandeur') or '?')} — "
                f"maillon n°{marque.get('profondeur', '?')} sur "
                f"{marque.get('profondeur_max', assistant.CASCADE_PROFONDEUR_MAX)} "
                "au maximum, chaîne bornée au "
                f"{html.escape(assistant.date_jour_lisible(marque.get('jusqu_au')))}."
                f"{resserrement}"
                ' Aucun appel n\'est parti : c\'est ▶ Démarrer qui décide.</p>')
        if not changements:
            # ⚠ LE BANDEAU RESTE, MÊME SANS CHANGEMENT (14/08/2026). Une
            # campagne peut très bien s'arrêter sur un oui SANS rien écrire au
            # cahier — quelqu'un qui n'avait aucun rendez-vous à déplacer. Sans
            # cette ligne, ses « pas appelé » n'avaient d'explication nulle part.
            return f"""<h2>📋 Le cahier des changements à reporter</h2>
{bandeau}
{bloc_cascade}
<p>Aucun changement à reporter pour l'instant — rien n'a encore bougé dans
le planning à cause de cette campagne.</p>"""
        pastilles = " ".join(
            f'<span class="pastille">{icone} {html.escape(libelle)} : {nombre}</span>'
            for _, icone, libelle, nombre in assistant.resume_cahier(changements)
            if nombre)
        lignes = []
        for changement in changements:
            icone, libelle = assistant.GENRES_CHANGEMENT.get(
                changement["genre"], ("•", changement["genre"]))
            if changement["genre"] == "deplacement":
                quand = (f"<strong>de</strong> "
                         f"{html.escape(assistant.date_courte(changement['ancienne_date']))}"
                         "<br><strong>à</strong> "
                         f"{html.escape(assistant.date_courte(changement['nouvelle_date']))}")
            elif changement["genre"] in assistant.GENRES_QUI_RETIRENT:
                quand = html.escape(
                    themes.date_lisible(changement["ancienne_date"]))
            elif changement["nouvelle_date"]:
                quand = html.escape(
                    themes.date_lisible(changement["nouvelle_date"]))
            else:
                quand = "—"
            lignes.append(f"""<tr>
  <td>{icone} {html.escape(libelle)}</td>
  <td>{html.escape(changement['nom'])}</td>
  <td>{quand}</td>
  <td>{html.escape(changement['motif'] or '—')}</td>
  <td>{html.escape(changement['duree'] or '—')}</td>
  <td>{html.escape(changement['raison'] or '—')}</td>
</tr>""")
        texte = assistant.cahier_texte(
            changements, f"Cahier des changements — {campagne['nom']}")
        return f"""<h2>📋 Le cahier des changements à reporter</h2>
{bandeau}
{bloc_cascade}
<p>Le vrai livrable de cette campagne : ce qu'il reste à saisir dans votre
logiciel de planification. Une ligne par changement, rien à déduire.</p>
<p style="display:flex;gap:.4rem;flex-wrap:wrap">{pastilles}</p>
<table><tr><th>Changement</th><th>Qui</th><th>Quand</th><th>Motif</th>
<th>Durée</th><th>Pourquoi / demande</th></tr>
{''.join(lignes)}
</table>
<p style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
  <button type="button" class="secondaire" id="copier-cahier">📋 Copier le cahier</button>
  <a class="bouton" href="/campagne/changements.csv?id={campagne_id}">⬇ Exporter en CSV</a>
  <span class="pastille" id="cahier-copie" hidden></span>
</p>
<details><summary>Le texte exact qui sera copié</summary>
<textarea id="cahier-texte" readonly rows="{min(len(changements) + 5, 16)}"
 style="width:100%;font-family:inherit">{html.escape(texte)}</textarea></details>
<script>
(function(){{
var bouton=document.getElementById('copier-cahier');
var zone=document.getElementById('cahier-texte');
var mot=document.getElementById('cahier-copie');
if(!bouton||!zone||!mot){{return;}}
function dire(texte,bon){{mot.textContent=texte;mot.hidden=false;
mot.className='pastille '+(bon?'st-confirme':'st-annule');}}
bouton.addEventListener('click',function(){{
  // Seul CE petit message change : la page n'est jamais rechargée.
  if(navigator.clipboard&&navigator.clipboard.writeText){{
    navigator.clipboard.writeText(zone.value).then(function(){{
      dire('✅ Cahier copié — collez-le dans votre logiciel.',true);
    }},function(){{
      dire("Le navigateur a refusé la copie : dépliez « Le texte exact » "
           +"juste en dessous et copiez-le à la main.",false);
    }});
  }}else{{
    dire("Ce navigateur ne sait pas copier tout seul : dépliez « Le texte "
         +"exact » juste en dessous et copiez-le à la main.",false);
  }}
}});
}})();
</script>"""

    # ------------------------------- compenser une absence (le seuil de 12 h)
    def _campagne_sur_le_creneau(self, creneau):
        """LA campagne qui porte déjà ce créneau, ou None. Rien n'est créé."""
        for campagne in self.application.base.lister_campagnes():
            if (campagne["creneau"] or "") == creneau:
                return campagne
        return None

    @staticmethod
    def _bandeau_regle_jouee(configuration):
        """Ce que la règle de liste a retenu, et ce qu'elle a écarté.

        ⚠ POURQUOI CE BANDEAU EXISTE (11/08/2026). Le propriétaire a monté une
        campagne sur une place libre et n'a vu que cinq personnes « au lieu de
        beaucoup ». La règle avait raison — une place n'intéresse que ceux dont
        le rendez-vous est APRÈS elle — mais l'écran ne disait rien des autres.
        Un compte tout seul se lit comme un défaut ; un compte avec sa raison se
        lit comme une décision. Rien n'est recalculé ici : on affiche ce que la
        règle a écrit au moment où elle a été jouée (voir
        assistant.regenerer_la_liste).
        """
        jouee = configuration.get("regle_jouee") or {}
        notes = jouee.get("notes") or []
        if not notes:
            return ""
        return ('<p class="pastille">👥 Liste établie par la règle : '
                f"{jouee.get('retenus', 0)} personne(s) retenue(s). "
                + html.escape(" ; ".join(notes)) + ".</p>")

    def _bloc_places_liberees(self, campagne):
        """Les places qu'une annulation a libérées — et quoi en faire.

        LA RÈGLE DU PROPRIÉTAIRE (31/07/2026), tenue à l'écran : un client
        annule au téléphone ; si son rendez-vous était à plus de N heures
        (⚙ Réglages, 12 h par défaut), il a été SUPPRIMÉ, sa place est libre
        et on PROPOSE ici de monter la campagne qui la remplira. En deçà du
        seuil, il reste « annulé » et l'écran dit pourquoi on ne peut pas
        organiser le remplacement — l'opérateur garde le lien pour le faire
        à la main s'il le souhaite.

        ⚠ JAMAIS UNE PLACE D'UNE JOURNÉE QU'ON VIDE (17/08/2026). Sa règle est
        déjà écrite pour les créneaux annoncés au téléphone
        (`assistant.jours_a_vider`) : « si le praticien n'est pas là ce jour-là,
        aucune heure de ce jour-là n'est proposable ». Ce panneau ne la tenait
        pas. Mesuré sur sa journée du 18/08, seuil abaissé : RingBack proposait
        « 📞 Préparer la campagne créneau libéré » sur le 18/08 à 10h00 et à
        15h40 — deux places de la journée même que la campagne était en train de
        vider. On aurait appelé des gens pour leur offrir un rendez-vous un jour
        où personne n'est là.

        Son seuil de 72 h masquait ce défaut sans le corriger : il empêchait
        seulement la PROPOSITION, et le lien « le faire quand même à la main »
        restait là.

        AUCUN APPEL NE PART D'ICI : le bouton ouvre l'assistant, créneau
        pré-rempli, à l'étape 2. Tout est lu du cahier des changements (les
        lignes ➖ et ✖ écrites au moment du changement) et de l'état RÉEL du
        rendez-vous : rien n'est recalculé, rien n'est supposé.
        """
        base = self.application.base
        maintenant = datetime.datetime.now().replace(
            second=0, microsecond=0).isoformat(timespec="minutes")
        jours_vides = assistant.jours_a_vider(base, campagne)
        libres, tardives, vus, sur_jour_vide = [], [], set(), []
        for changement in base.changements_de_campagne(campagne["id"]):
            # ⚠ LES DEUX GENRES DE RETRAIT (17/08/2026). Le cahier écrivait
            # « suppression » même quand le rendez-vous restait « annulé » ;
            # depuis que le genre suit le statut, ce panneau perdrait toutes
            # les annulations tardives — celles qu'il sert justement à
            # expliquer — s'il ne lisait que l'un des deux.
            if changement["genre"] not in assistant.GENRES_QUI_RETIRENT:
                continue
            if not changement["rendezvous_id"]:
                continue
            rdv = base.obtenir_rendezvous(changement["rendezvous_id"])
            if rdv is None or rdv["id"] in vus:
                continue
            if rdv["horaire"] < maintenant:
                continue        # la place est passée : plus rien à remplir
            vus.add(rdv["id"])
            if rdv["horaire"][:10] in jours_vides:
                # La journée entière se vide : cette place n'est pas à remplir,
                # elle est à laisser vide. On le DIT plutôt que de la taire.
                sur_jour_vide.append(rdv)
                continue
            if rdv["statut"] == db.STATUT_SUPPRIME:
                libres.append(rdv)
            elif rdv["statut"] == "annulé":
                tardives.append(rdv)
        if not libres and not tardives:
            if sur_jour_vide:
                jours = ", ".join(
                    themes.date_lisible(j + "T00:00").split(" à ")[0]
                    for j in sorted({r["horaire"][:10]
                                     for r in sur_jour_vide}))
                return f"""<section class="carte">
  <h2>📞 Compenser une absence</h2>
  <p><strong>{len(sur_jour_vide)} place(s)</strong> se sont libérées pendant les
  appels, et il n'y a rien à y remplir : elles tombent sur {html.escape(jours)},
  que cette campagne est justement en train de vider.</p>
  <p><small>Proposer ces heures à quelqu'un d'autre reviendrait à donner un
  rendez-vous un jour où personne n'est là.</small></p>
</section>"""
            return ""
        seuil = horaires.seuil_remplacement(self.application.preferences)
        lignes = []
        for rdv in libres:
            deja = self._campagne_sur_le_creneau(rdv["horaire"])
            if deja is not None:
                action = (f'<a href="/campagne?id={deja["id"]}">Voir la '
                          f"campagne n°{deja['id']} déjà préparée sur cette "
                          "place</a>")
            else:
                action = f"""<form method="post" action="/campagne/compenser"
      style="margin:0">
  <input type="hidden" name="campagne" value="{campagne['id']}">
  <input type="hidden" name="creneau" value="{html.escape(rdv['horaire'])}">
  <button class="secondaire">📞 Préparer la campagne « créneau libéré »</button>
</form>"""
            lignes.append(f"""<tr>
  <td>{html.escape(assistant.date_courte(rdv['horaire']))}</td>
  <td>{html.escape(rdv['nom'])}</td>
  <td><span class="pastille st-ignore">➖ supprimé</span> — la place est
      libre</td>
  <td>{action}</td>
</tr>""")
        for rdv in tardives:
            action = f"""<details><summary>Le faire quand même à la main</summary>
<p class="mini">RingBack ne le propose pas parce qu'il reste moins de
{seuil} h : une campagne a peu de chances d'aboutir à temps. Si vous voulez
essayer malgré tout, c'est votre décision — le bouton ouvre l'assistant, il
n'appelle personne.</p>
<form method="post" action="/campagne/compenser" style="margin:0">
  <input type="hidden" name="campagne" value="{campagne['id']}">
  <input type="hidden" name="creneau" value="{html.escape(rdv['horaire'])}">
  <button class="secondaire">📞 Préparer quand même la campagne</button>
</form>
<p class="mini"><a href="/suivi/planning?date={html.escape(rdv['horaire'][:10])}">
Voir cette journée dans le planning</a></p></details>"""
            lignes.append(f"""<tr>
  <td>{html.escape(assistant.date_courte(rdv['horaire']))}</td>
  <td>{html.escape(rdv['nom'])}</td>
  <td><span class="pastille st-annule">✖ annulé</span> — moins de {seuil} h
      avant : <strong>trop tard pour organiser un remplacement
      automatiquement</strong></td>
  <td>{action}</td>
</tr>"""
                          )
        return f"""<h2>📞 Compenser une absence — les places qu'une annulation a libérées</h2>
<p>Un client a annulé pendant l'appel. Ce que RingBack en fait dépend du
délai qui restait avant son rendez-vous — le seuil est de
<strong>{seuil} h</strong>, réglable dans
<a href="/reglages">⚙ Réglages</a>.</p>
<table><tr><th>La place</th><th>Qui l'occupait</th><th>Ce qu'elle est
devenue</th><th>Ce que vous pouvez faire</th></tr>
{''.join(lignes)}
</table>
<p class="mini">Aucun appel ne part d'ici : le bouton ouvre l'assistant avec
le créneau déjà rempli, à l'étape 2. C'est vous qui validez, puis qui
démarrez.</p>"""

    def _traiter_compensation(self, corps):
        """Ouvre l'assistant sur une place libre — sans appeler personne.

        Le geste est un simple raccourci : une campagne 📞 « créneau libéré »
        dont le créneau est déjà rempli. Rien n'est créé en base tant que
        l'opérateur n'a pas validé les trois étapes.

        DEUX portes mènent ici, et c'est voulu — une seule mécanique :
        le récapitulatif d'une campagne (compenser une annulation) et le
        planning lui-même (§5 : « j'ai un trou, qui peut le prendre ? »).
        Le champ « depuis » ne sert qu'au journal.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        creneau = donnees.get("creneau", [""])[0].strip()
        depuis = donnees.get("depuis", ["campagne"])[0]
        try:
            creneau = saisie.valider_horaire(creneau)
        except saisie.SaisieInvalide as erreur:
            return self._erreur(400, str(erreur))
        identifiant = self.application.creer_brouillon_assistant(
            "creneau_libere", infos_initiales={"creneau_libere": creneau})
        journal.info("Campagne « créneau libéré » (origine : %s) : brouillon "
                     "d'assistant ouvert sur la place du %s (aucun appel)",
                     depuis, creneau)
        return self._rediriger(f"/assistant/message?b={identifiant}")

    def _servir_cahier_csv(self, parametres):
        """Sert le cahier de changements en CSV — généré à la volée, jamais stocké.

        Même règle que les deux autres exports du produit : le fichier est
        construit à la demande et n'est écrit NULLE PART côté serveur.
        """
        try:
            campagne_id = int(parametres.get("id", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de campagne invalide.")
        base = self.application.base
        campagne = base.obtenir_campagne(campagne_id)
        if campagne is None:
            return self._erreur(404, "Campagne introuvable.")
        changements = base.changements_de_campagne(campagne_id)
        contenu = assistant.cahier_csv(changements).encode("utf-8-sig")
        nom_fichier = datetime.date.today().strftime(
            f"changements_campagne_{campagne_id}_%Y%m%d.csv")
        journal.info("Export CSV du cahier de changements de la campagne "
                     "n°%d : %d ligne(s) (servi à la volée)", campagne_id,
                     len(changements))
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition",
                         f'attachment; filename="{nom_fichier}"')
        self.send_header("Content-Length", str(len(contenu)))
        self.end_headers()
        self.wfile.write(contenu)

    # ------------------------------- 📥 les appels partis sans leur résultat
    def _bloc_resultats_en_attente(self, campagne_id, contacts):
        """Le geste « Récupérer les résultats en attente », s'il y a de quoi.

        Rien à récupérer : rien n'est affiché — on ne propose pas un bouton
        qui ne ferait rien. Sinon, l'écran dit combien d'appels sont partis
        sans avoir rendu leur résultat, et rappelle EN CLAIR que ce geste ne
        compose aucun numéro (c'est la question qui vient à l'esprit).
        """
        en_attente = [contact for contact in contacts
                      if contact["etat"] == assistant.ETAT_RESULTAT_INCONNU]
        if not en_attente:
            return ""
        noms = ", ".join(html.escape(contact["nom"])
                         for contact in en_attente[:5])
        if len(en_attente) > 5:
            noms += f" et {len(en_attente) - 5} autre(s)"
        return f"""<div class="erreurs">
<p><strong>⏱ {len(en_attente)} appel(s) sont bien PARTIS, mais leur résultat
n'est pas encore connu</strong> — {noms}.</p>
<p>Leur téléphone a sonné et la conversation a pu avoir lieu : c'est
seulement la réponse de CALL-E qui n'est pas arrivée à temps. Personne n'est
marqué « injoignable », aucune tentative ne leur a été comptée, et aucun
rendez-vous n'a bougé. Le numéro de chaque appel chez CALL-E a été conservé.</p>
<form method="post" action="/campagne/recuperer" style="display:inline">
  <input type="hidden" name="campagne" value="{campagne_id}">
  <button>📥 Récupérer les résultats en attente</button>
</form>
<p><small><strong>Ce bouton ne compose AUCUN numéro</strong> : il ne fait que
LIRE, chez CALL-E, le résultat d'appels déjà passés, puis l'applique comme si
la réponse était arrivée à temps. Si un appel est encore en cours, il vous le
dira et n'écrira rien.</small></p>
</div>"""

    def _bloc_bilan_recuperation(self, comptes):
        """Ce que le geste de récupération a VRAIMENT fait, ligne par ligne."""
        if not comptes:
            return ('<p class="pastille">'
                    + html.escape(assistant._resume_recuperation([]))
                    + "</p>")
        lignes = "".join(
            f"<li><strong>{html.escape(compte['contact'])}</strong> — "
            f"{html.escape(compte['message'])}</li>" for compte in comptes)
        return ('<div class="pastille"><p>📥 '
                + html.escape(assistant._resume_recuperation(comptes))
                + f"</p><ul>{lignes}</ul></div>")

    # ------------------------------------------------------ le détail long
    # Un détail peut faire plusieurs centaines de caractères : le message
    # d'une réponse illisible cite la réponse de CALL-E. Étalé dans une
    # cellule, il déforme le tableau au point de le rendre illisible
    # (constaté par le propriétaire le 02/08/2026 sur une campagne de cascade).
    # La cellule montre donc le DÉBUT, et le reste s'ouvre en fenêtre.
    # RETIRÉ LE 11/08/2026 avec la colonne « Détail » du tableau des contacts :
    # l'abrègement cliquable (LONGUEUR_DETAIL, _en_lignes, _cellule_detail) n'a
    # plus rien à rendre — c'était la seule cellule qui s'en servait. Le détail
    # d'un contact se lit maintenant sur 🔁 Relances (« Voir sa demande… ») et
    # dans le tableau des 📵 non joints, qui le portent en clair.

    # ------------------------------------------------- poste de pilotage
    def _page_pilotage(self, campagne, parametres=None, fragment=False):
        """La fiche d'une campagne de l'assistant : états, compteurs, commandes.

        `fragment` : ne rendre que les deux zones vivantes, pour le
        rafraîchissement pendant une campagne. Le MÊME code produit les deux —
        ce qu'on voit après une mise à jour est mot pour mot ce qu'on aurait
        vu en rechargeant la page.
        """
        base = self.application.base
        preferences = self.application.preferences
        campagne_id = campagne["id"]
        configuration = assistant.configuration_campagne(campagne)
        # `fiche_nature` connaît AUSSI les natures retirées : une campagne
        # d'avant le 03/08/2026 garde son nom et son pictogramme.
        nature = (assistant.fiche_nature(campagne["nature"])
                  or {"icone": "📣", "nom": campagne["nature"]})
        contacts = base.contacts_de_campagne(campagne_id)
        relances = base.relances_de_campagne(campagne_id)
        planifiees = {}
        for relance in relances:
            if relance["statut"] == "planifiée":
                planifiees.setdefault(relance["contact_id"], relance)
        parametres = parametres or {}
        fait = parametres.get("fait", [""])[0]
        messages = {
            "prete": "Campagne créée en état « prête » — personne n'est "
                     "appelé tant que vous ne cliquez pas ▶ Démarrer.",
            "demarree": "Campagne démarrée : un appel à la fois, dans l'ordre "
                        "choisi.",
            "pause_demandee": "Demande de pause enregistrée — l'appel en "
                              "cours va à son terme, la pause agit entre "
                              "deux appels.",
            "arret_demande": "Demande d'arrêt enregistrée — l'appel en cours "
                             "va à son terme.",
            "arretee": "Campagne arrêtée.",
            "pas_en_cours": "Rien à faire : la campagne n'est pas en cours "
                            "d'exécution.",
            "agenda_a_verifier": "Rien n'est parti : les créneaux annoncés au "
                                 "téléphone sortent de l'agenda de RingBack — "
                                 "lisez ce qu'il en dit, puis confirmez "
                                 "ci-dessous.",
        }
        bloc_message = ""
        if fait in messages:
            bloc_message = f'<p class="pastille">{html.escape(messages[fait])}</p>'
        # 📥 Le bilan du geste de récupération : ce qui a été relu, ce qui ne
        # l'a pas été, et pourquoi. Gardé côté serveur le temps d'une
        # redirection (voir _traiter_recuperation) — jamais recalculé.
        bilan = self.application.bilans_recuperation.pop(
            parametres.get("recup", [""])[0], None)
        if bilan is not None:
            bloc_message += self._bloc_bilan_recuperation(bilan)
        # Campagne née du bouton « Préparer une campagne d'essai réel » :
        # l'écran dit ce qui a été créé, ce qui ne l'a pas été (aucun appel),
        # et où lire la marche à suivre.
        if parametres.get("essai_reel", [""])[0] == "prete":
            repli = parametres.get("repli", ["0"])[0] == "1"
            # Le repli n'a qu'une cause visible — « pas assez de places libres
            # à proposer » — et deux origines possibles : aucun horaire
            # d'ouverture réglé, ou un agenda déjà plein. On dit les deux
            # plutôt que d'en deviner une.
            precision = (" Faute d'assez de places libres (horaires "
                         "d'ouverture non réglés, ou agenda déjà plein), les "
                         "rendez-vous ont été posés DEMAIN MATIN, d'heure en "
                         "heure : réglez vos horaires dans ⚙ Réglages si vous "
                         "voulez de vraies places." if repli else
                         " Les rendez-vous ont été posés sur vos premières "
                         "places réellement libres.")
            # Combien de testeurs se partagent les rôles : l'écran le dit,
            # parce que la suite (prévenir chacun de son rôle) en dépend.
            brut_testeurs = parametres.get("testeurs", ["1"])[0]
            nb_testeurs = int(brut_testeurs) if brut_testeurs.isdigit() else 1
            if nb_testeurs > 1:
                qui = (f" Les rôles sont répartis sur <strong>{nb_testeurs} "
                       "testeurs</strong> : la colonne Identité ci-dessous dit "
                       "qui joue quoi (le prénom rappelle le rôle), et "
                       "⚙ Réglages dit quel testeur porte quel numéro. Les "
                       "appels restent <strong>séquentiels</strong> : un seul "
                       "téléphone sonne à la fois, ils doivent donc être "
                       "disponibles ensemble.")
            else:
                qui = (" Tous ces contacts portent le numéro de votre unique "
                       "testeur (marqué 🧪) — c'est ce téléphone-là qui "
                       "sonnera.")
            bloc_message += (
                '<p class="bandeau essai">🧪 Campagne d\'ESSAI EN CONDITIONS '
                "RÉELLES préparée, à l'état « prête » : <strong>aucun appel "
                "n'est parti</strong>." + precision + qui + " La marche à "
                "suivre, les phrases à dire pour chaque issue et les "
                "vérifications à faire sont dans "
                "<code>PROCEDURE-ESSAI-REEL.md</code>.</p>")
        statut = campagne["statut"]
        classe_statut = {"prête": "st-prevu", "en cours": "st-manque",
                         "en pause": "st-deplace", "terminée": "st-confirme",
                         "arrêtée": "st-ignore"}.get(statut, "")
        # POURQUOI la campagne s'est arrêtée toute seule. Écrit seulement
        # quand c'est une panne de NOTRE côté (clé refusée, service en panne,
        # crédit épuisé) : le texte dit ce qui n'a pas eu lieu et quoi faire.
        # Une pause demandée à la main n'a pas de raison — et n'affiche rien.
        if statut == "en pause" and campagne.get("raison_pause"):
            bloc_message += (
                '<p class="erreurs">⛔ Campagne mise en pause toute seule : '
                f'{html.escape(campagne["raison_pause"])}</p>')
        # L'HEURE FORCÉE SE DIT, elle ne se devine pas. Une campagne qui tourne
        # hors des heures permises est une exception assumée : elle doit se
        # lire sur sa fiche, aujourd'hui comme dans trois semaines. Et la
        # phrase se tait d'elle-même en appels réels — parce que le garde-fou,
        # lui, s'y applique de nouveau (voir assistant.heure_forcee).
        if assistant.heure_forcee(configuration, self.application.mode_reel):
            bloc_message += (
                '<p class="pastille">Heure forcée : cette campagne a le droit '
                "de tourner hors de la plage d'appel autorisée "
                f"({themes.plage_lisible(preferences)}). C'est possible parce "
                "qu'elle est <strong>simulée</strong> — aucun téléphone ne "
                "sonne. En appels réels, le garde-fou de politesse "
                "s'appliquerait de nouveau.</p>")
        # 📥 LES APPELS DÉJÀ PARTIS DONT LE RÉSULTAT MANQUE. Le bloc n'existe
        # que s'il y en a : on ne propose pas un geste qui n'aurait rien à
        # faire. Il dit noir sur blanc qu'aucun numéro ne sera composé.
        bloc_message += self._bloc_resultats_en_attente(campagne_id, contacts)
        # Les commandes selon l'état — la pause/l'arrêt agissent entre deux appels.
        verbe = "RÉELLEMENT" if self.application.mode_reel else "en simulation"
        commandes = []
        if statut == "prête":
            # ⚠ ET LE GESTE INVERSE, ABSENT JUSQU'AU 21/08/2026 : fermer une
            # campagne préparée qu'on ne lancera pas. Sans lui, la seule façon
            # de s'en débarrasser était de la DÉMARRER puis de la clore —
            # c'est-à-dire faire sonner des téléphones pour rien.
            #
            # CE QUE CELA A COÛTÉ, mesuré dans sa base : 125 contacts dormaient
            # dans sept campagnes « prête » des 15 et 17/08, dont les
            # rendez-vous avaient disparu depuis. Il n'avait aucun geste.
            commandes.append(f"""<form method="post" action="/campagne/demarrer" style="display:inline"
 id="form-demarrer" data-verification="/campagne/verification-agenda?id={campagne_id}">
  <input type="hidden" name="campagne" value="{campagne_id}">
  <button style="font-size:1.1rem">▶ Démarrer — appeler {verbe}</button>
</form>
<form method="post" action="/campagne/clore" style="display:inline">
  <input type="hidden" name="campagne" value="{campagne_id}">
  <button class="secondaire" title="Ferme une campagne préparée que vous ne
 lancerez pas : personne n'est appelé, aucun rendez-vous n'est touché, et rien
 n'est effacé">Clore — je ne la lancerai pas</button>
</form>""")
        elif statut == "en cours":
            commandes.append(f"""<form method="post" action="/campagne/pause" style="display:inline">
  <input type="hidden" name="campagne" value="{campagne_id}">
  <button class="secondaire">⏸ Mettre en pause</button>
</form>
<form method="post" action="/campagne/arreter" style="display:inline">
  <input type="hidden" name="campagne" value="{campagne_id}">
  <button class="danger">⏹ Arrêter</button>
</form>
<small class="sourd">La pause et l'arrêt agissent ENTRE deux appels : un
appel en cours va à son terme — on ne raccroche pas au nez d'un client.</small>""")
        elif statut == "en pause":
            commandes.append(f"""<form method="post" action="/campagne/demarrer" style="display:inline"
 id="form-demarrer" data-verification="/campagne/verification-agenda?id={campagne_id}">
  <input type="hidden" name="campagne" value="{campagne_id}">
  <button>▶ Reprendre — continuer où on en était</button>
</form>
<form method="post" action="/campagne/arreter" style="display:inline">
  <input type="hidden" name="campagne" value="{campagne_id}">
  <button class="danger">⏹ Arrêter</button>
</form>""")
        bloc_commandes = "<p>" + "\n".join(commandes) + "</p>" if commandes else ""
        # Le rappel « l'agenda de RingBack fait foi » : vide tant qu'on n'a
        # pas cliqué ▶ (le clic le demande au serveur), déjà rempli quand le
        # démarrage vient d'être refusé faute de confirmation — c'est le
        # repli sans JavaScript, et rien n'est perdu au passage.
        bloc_verification = ""
        if statut in ("prête", "en pause"):
            ouvert = fait == "agenda_a_verifier"
            contenu = (self._fragment_verification_agenda(campagne)
                       if ouvert else "")
            bloc_verification = (
                f'<div id="verification-agenda"{"" if ouvert else " hidden"}>'
                f"{contenu}</div>" + self._script_verification_agenda())
        # ⚠ SEULS LES ÉTATS QUI CONCERNENT QUELQU'UN (30/08/2026, sa demande :
        # « que les résumés ne s'affichent que lorsqu'il y a au moins un contact
        # concerné »). Ils étaient TOUS affichés — c'était une décision, « la
        # vue d'ensemble honnête » : montrer les dix états pour qu'on sache
        # qu'ils existent. À l'usage, une campagne terminée alignait dix
        # pastilles dont huit à zéro, et il fallait les lire toutes pour
        # trouver les deux qui disent quelque chose.
        #
        # ⚠ CE QU'ON PERD, ET C'EST ASSUMÉ : la liste des états possibles ne se
        # découvre plus ici. Elle reste entière sur 👥 Contacts et dans la fiche
        # de chaque personne — cet écran-ci dit ce qui S'EST PASSÉ, pas ce qui
        # aurait pu.
        compteurs = []
        for etat, (icone, classe) in assistant.ETATS.items():
            nombre = sum(1 for c in contacts if c["etat"] == etat)
            if etat == "en cours" and statut != "en cours":
                continue
            if not nombre:
                continue
            compteurs.append(
                f'<span class="pastille {classe}">{icone} '
                f"{html.escape(assistant.mot_etat(etat))} : {nombre}</span>")
        # ⚠ PAS DE LIGNE VIDE : une campagne sans aucun contact n'a rien à
        # résumer, et un paragraphe vide laisse un blanc que personne ne
        # s'explique.
        bloc_compteurs = ('<p style="display:flex;gap:.4rem;flex-wrap:wrap">'
                          + " ".join(compteurs) + "</p>") if compteurs else ""
        exclus = sum(1 for c in contacts if c["etat"] == "exclu")
        bandeau_exclus = ""
        if exclus:
            bandeau_exclus = (f'<p class="erreurs">🚫 {exclus} contact(s) '
                              "exclu(s) — jamais composé(s) — "
                              '<a href="/clients">gérer depuis 👥 Contacts</a>.</p>')
        # ⚠ LA COLONNE « DÉTAIL » N'EXISTE PLUS DANS CE TABLEAU (sa décision du
        # 11/08). Sans ce bandeau, une personne qui a refusé l'agent devenait
        # une pastille 🙋 de plus, indistinguable de celles que l'agent n'a pas
        # su conclure — et rien ne disait qu'il y a un appel à passer soi-même.
        refus_agent = sum(1 for c in contacts
                          if db.refus_de_l_agent(c["detail"]))
        if refus_agent:
            bandeau_exclus += (
                f'<p class="erreurs">🚫 {refus_agent} personne(s) ont refusé '
                "d'être appelées par un agent — elles ne l'ont pas été, et "
                "elles attendent qu'un <strong>humain</strong> les rappelle : "
                '<a href="/relances?vue=humains">🔁 Relances</a>.</p>')
        bandeau_exclus += self._bandeau_regle_jouee(configuration)
        # LA COLONNE « PROCHAIN RDV » (demande du propriétaire, 11/08/2026) :
        # l'agenda de chaque contact, lu EN UNE SEULE PASSE plutôt qu'une
        # requête par ligne — cette page se rafraîchit toutes les 1,5 s pendant
        # une campagne, et cinquante requêtes par rafraîchissement pour afficher
        # cinquante dates n'auraient rien apporté.
        #
        # ⚠ « PROCHAIN » EST LU DANS L'AGENDA, PAS DANS LA COLONNE FIGÉE DU
        # CONTACT. Le rendez-vous que la campagne a recopié à sa création
        # (« rdv_existant ») date du jour où la liste a été bâtie : après un
        # appel qui déplace ou annule, il ne dit plus la vérité. Ici on montre
        # ce que l'agenda dit MAINTENANT — c'est tout l'intérêt de la colonne,
        # et c'est aussi pourquoi elle se vide quand un rendez-vous est annulé.
        agendas = base.etat_rendezvous_par_client()
        # ⚠ CE QUE LA CAMPAGNE A FAIT AU RENDEZ-VOUS, lu en une seule passe
        # (21/08/2026, son signalement : « les états ne sont pas alignés sur la
        # situation réelle »). Sur sa campagne n° 119, trois personnes
        # portaient « 📞 le client rappellera » et un TIRET dans la colonne des
        # rendez-vous — alors que leur rendez-vous venait d'être ANNULÉ. Un
        # tiret se lit « on ne sait pas » ; ici on savait, et on le taisait.
        sorts = {}
        for changement in base.changements_de_campagne(campagne_id):
            if changement["genre"] not in assistant.GENRES_QUI_RETIRENT:
                continue
            if changement["contact_id"]:
                sorts[changement["contact_id"]] = changement["ancienne_date"]
        # L'ordre d'affichage = l'ordre d'appel choisi ; position des « à appeler ».
        ordonnes = assistant.ordonner_contacts(
            contacts, configuration["ordre"], campagne.get("creneau"))
        lignes = []
        for contact in ordonnes:
            etat = contact["etat"]
            icone, classe = assistant.ETATS.get(etat, ("", ""))
            appels = base.appels_du_contact_campagne(contact["id"])
            libelle_etat = assistant.mot_etat(etat)
            if etat == "injoignable":
                libelle_etat = f"injoignable ({len(appels)})"
            classe_ligne = ' class="ligne-acceptee"' if etat == "accepté" else ""
            transcriptions = []
            for appel in appels:
                if not appel["transcription"]:
                    continue
                titre = ("appel initial" if appel["tentative"] == 0
                         else f"relance n°{appel['tentative']}")
                etiquette = campagnes.ETIQUETTES_ISSUE.get(appel["issue"],
                                                           appel["issue"] or "")
                transcriptions.append(
                    f"<details><summary>{titre} — "
                    f"{html.escape(etiquette)} — "
                    + themes.date_lisible(db.heure_locale(appel["cree_le"]))
                    + "</summary>"
                    f"<pre>{html.escape(appel['transcription'])}</pre></details>")
            heure_dernier = (themes.date_lisible(
                db.heure_locale(appels[-1]["cree_le"])) if appels else "—")
            # Le prochain rendez-vous de CE contact, au format jj/mm/aaaa hh:mm.
            # Un contact sans fiche client — une campagne d'avant la colonne
            # `client_id` — n'a pas d'agenda à lire : la case reste vide plutôt
            # que de montrer la date figée de la campagne, qui a pu changer.
            prochain = (agendas.get(contact.get("client_id")) or {}).get(
                "prochain") or {}
            prochain_rdv = assistant.date_chiffree(prochain.get("horaire"))
            if not prochain_rdv and contact["id"] in sorts:
                # ⚠ ON DIT CE QU'ON A FAIT. La campagne a retiré ce
                # rendez-vous : le taire derrière un tiret laissait croire à un
                # écart entre les tableaux — le cahier annonçait trois
                # annulations, la liste n'en montrait aucune.
                quand = assistant.date_chiffree(sorts[contact["id"]])
                prochain_rdv = (
                    '<span class="pastille st-annule">✖ annulé</span>'
                    + (f"<br><small>{quand}</small>" if quand else ""))
            lignes.append(f"""<tr{classe_ligne}>
  <td>{contact['rang']}</td>
  <td>{html.escape(contact['nom'])}{essai_reel.badge(contact, '<br>')}</td>
  <td>{html.escape(contact['telephone_masque'])}</td>
  <td><span class="pastille {classe}">{icone} {html.escape(libelle_etat)}</span></td>
  <td>{prochain_rdv or '—'}</td>
  <td>{len(appels)}<br><small>{heure_dernier}</small></td>
  <td>{''.join(transcriptions) or '—'}</td>
</tr>""")
        # ⚠ UNE LISTE VIDE DOIT DIRE POURQUOI. Une campagne AUTOMATIQUE
        # fabrique sa liste par une règle : quand celle-ci n'a trouvé
        # personne, « Aucun contact » laissait croire à un oubli de saisie, et
        # le ▶ Démarrer se serait terminé sans un seul appel sans qu'on
        # comprenne. On nomme la règle, et on dit qu'elle sera rejouée.
        regle = assistant.regle_de_liste(configuration)
        regle_vide = ""
        if regle and not lignes:
            regle_vide = (
                " La liste de cette campagne est faite par une "
                "<strong>règle</strong> — « "
                + html.escape(assistant.SOURCES_BASE.get(regle["source"],
                                                         regle["source"]))
                + " » — et elle n'a trouvé personne pour la place en cours. "
                "Elle sera <strong>rejouée à chaque place</strong> : la "
                "suivante peut très bien intéresser quelqu'un. Pour choisir "
                "les personnes vous-même, créez une campagne en mode "
                "<strong>Manuel</strong>.")
        # ⚠ LA COLONNE « DÉTAIL » EST RETIRÉE DE CE TABLEAU (11/08/2026), et
        # avec elle la position dans l'ordre d'appel. Décision du propriétaire,
        # redite : « je t'ai demandé de supprimer la position, pas de la mettre
        # dans une autre colonne ». La première tentative la glissait sous la
        # pastille d'état — c'était la déplacer, pas la retirer.
        #
        # OÙ LE DÉTAIL SE LIT ENCORE, car il n'est pas perdu : sur 🔁 Relances,
        # « Voir sa demande… » l'ouvre en fenêtre pour les contacts qui
        # attendent un humain (voir serveur._lien_demande), et le tableau des
        # 📵 non joints le porte en clair. Ce sont les deux écrans faits pour ça.
        tableau = ("<table><tr><th>Ordre</th><th>Contact</th><th>Téléphone</th>"
                   "<th>État</th><th>Son rendez-vous</th><th>Tentatives<br>"
                   "<small>dernier appel</small></th><th>Transcription</th></tr>"
                   + "\n".join(lignes) + "</table>") if lignes else \
            f"<p>Aucun contact dans cette campagne.{regle_vide}</p>"
        # En-tête : mission et paramètres dépliables.
        options = configuration["options"]
        infos = configuration["infos"]
        lignes_infos = "".join(
            f"<li>{html.escape(info['libelle'])} : "
            + html.escape((assistant.date_courte(infos[info['code']])
                           if info["type"] == "date"
                           else infos[info["code"]]) or "—")
            + "</li>"
            for info in nature.get("infos", ())
            if infos.get(info["code"]))
        mode_relance = options.get("relance_mode") or "delai"
        if mode_relance == "creneau":
            texte_relance = (f"dans le créneau {options.get('relance_creneau_debut', '?')}"
                             f" → {options.get('relance_creneau_fin', '?')}")
        else:
            delai = options.get("relance_delai") or campagnes.parametres_relance(
                preferences)[0]
            texte_relance = f"après un délai de {delai} h ouvrée(s)"
        maximum = assistant.maximum_rappels(preferences, options)
        interdit = assistant.periode_interdite(preferences)
        texte_interdit = (f"{interdit[0]} → {interdit[1]}" if interdit
                          else "aucune")
        # Le créneau de la campagne : celui de la nature « créneau libéré »,
        # ou celui qu'un maillon de cascade a repris d'une place libérée. Il
        # n'apparaît que s'il existe — jamais de ligne vide.
        ligne_creneau = ""
        if campagne["creneau"]:
            ligne_creneau = ("<li>Créneau de la campagne : <strong>"
                             + html.escape(assistant.date_courte(
                                 campagne["creneau"])) + "</strong></li>")
        bloc_parametres = f"""<details><summary>Paramètres de la campagne</summary>
<ul>
{ligne_creneau}
<li>Politique d'appel : {html.escape(assistant.POLITIQUES.get(configuration['politique'], configuration['politique']))}</li>
<li>Ordre d'appel : {html.escape(assistant.ORDRES_APPEL.get(configuration['ordre'], configuration['ordre'] or '—'))}</li>
<li>Recontacter si non joignable : {"oui — " + texte_relance + f", {maximum} rappel(s) maximum" if options.get('recontacter', True) else "non"}</li>
<li>Un rendez-vous déplacé/annulé libère son créneau : {"oui" if options.get('liberer_creneau', True) else "non"}</li>
<li>Décaler en cascade : {html.escape(assistant.libelle_cascade(dict(configuration, nature=campagne["nature"])))}</li>
<li>Liste des personnes : {html.escape(assistant.libelle_recette(configuration.get("recette")))}{" — rejouable sur un autre créneau" if assistant.recette_reproductible(configuration.get("recette")) else " — non rejouable sur un autre créneau"}</li>
<li>Plage d'appel : {html.escape(themes.plage_lisible(preferences))} · période interdite : {html.escape(texte_interdit)}</li>
<li>Répondeur sans le motif : {"oui" if options.get('repondeur_sans_motif', True) else "non"}</li>
{lignes_infos}
</ul></details>"""
        bloc_cahier = self._bloc_cahier(campagne, configuration, contacts)
        bloc_places = self._bloc_places_liberees(campagne)
        note_relances = ""
        if any(r["statut"] == "planifiée" for r in relances):
            dues = len(base.relances_dues())
            # ⚠ « ÉCHÉANCES DANS LE TABLEAU » DEVENAIT FAUX (11/08/2026) : la
            # colonne « Détail » les portait, et elle est retirée. La phrase dit
            # donc où elles se lisent vraiment — un écran qui renvoie à une
            # colonne disparue est pire qu'un écran muet.
            note_relances = (
                '<p><small>🔁 Des relances sont programmées. Leurs échéances se '
                "lisent sur la page des relances. L'exécution automatique est "
                '<span class="badge-a-venir">à venir</span> : le geste reste '
                f'le bouton de la page <a href="/relances">🔁 Relances</a>'
                f"{' — ' + str(dues) + ' due(s) maintenant' if dues else ''}.</small></p>")
        # LES DEUX ZONES QUI VIVENT PENDANT UNE CAMPAGNE. Tout ce qui change
        # d'un appel à l'autre est dedans ; tout ce qui ne change pas (la
        # mission, les paramètres) est DEHORS. C'est ce qui permet de remettre
        # à jour ces zones-là seulement, au lieu de recharger la page entière
        # toutes les 1,5 s — ce que faisait RingBack jusqu'au 02/08/2026, avec
        # un écran qui clignotait sans arrêt, les blocs dépliés qui se
        # refermaient et la position de lecture perdue à chaque fois.
        etat = f"""{bloc_message}
<h1>{html.escape(campagne['nom'])}</h1>
<p>{nature['icone']} <strong>{html.escape(nature['nom'])}</strong>
<span class="pastille {classe_statut}">{html.escape(statut)}</span></p>"""
        # ⚠ CE QU'IL VIENT VOIR EN PREMIER, C'EST SA LISTE (30/08/2026, sa
        # demande). Trois tableaux se succédaient, et celui qu'il regarde
        # pendant qu'une campagne tourne — les personnes, une par une —
        # arrivait en TROISIÈME. Les deux autres ne parlent pas des appels en
        # cours : ils disent ce qu'il faudra REPORTER ailleurs, et les places
        # qu'une annulation a libérées. On les lit après, pas pendant.
        #
        # ⚠ RIEN N'EST RETIRÉ, tout est REPLIÉ. Ces deux tableaux portent des
        # gestes (copier le cahier, monter une campagne sur une place libérée)
        # et des faits qu'on ne doit pas perdre : les cacher pour de bon
        # rejouerait le défaut du 21/08, quand un onglet retiré a emporté son
        # seul bouton avec lui. Un `details` les garde à un clic — et il marche
        # sans JavaScript, comme les autres replis de cette page.
        # ⚠ L'ALLURE D'UN LIEN, et c'est la classe que le produit a déjà
        # (`repli-geste`, la même que « Saisie manuelle des créneaux ») : il a
        # demandé « un lien "voir les détails" », pas un bouton de plus. Le
        # balisage recopie `serveur._replie` — `assistant_web` ne peut pas
        # l'importer, c'est `serveur` qui importe `assistant_web` et non
        # l'inverse. La CLASSE, elle, reste la seule vérité sur l'apparence.
        #
        # ⚠ TOUJOURS LÀ, MÊME SUR UNE CAMPAGNE NEUVE. Le cahier ne rend jamais
        # une chaîne vide : sans changement, il écrit « rien n'a encore bougé
        # dans le planning à cause de cette campagne » — et c'est justement ce
        # qu'on veut pouvoir vérifier. Un repli qui apparaît et disparaît selon
        # l'avancement serait un écran qui change de forme sous les yeux.
        details = f"""<details class="repli-geste">
<summary>Voir les détails</summary>
<div class="repli-contenu">
{bloc_cahier}
{bloc_places}
</div></details>"""
        suite = f"""{bloc_commandes}
{bloc_verification}
{bloc_compteurs}
{bandeau_exclus}
<h2>Les personnes, une par une</h2>
{tableau}
{note_relances}
{details}"""
        # La mission et les paramètres s'affichent ENTRE les deux zones, à
        # leur place habituelle — mais DEHORS : ce sont des blocs dépliables,
        # et un bloc qu'on vient d'ouvrir ne doit pas se refermer parce qu'un
        # appel s'est terminé ailleurs.
        # ⚠ ET CE QUE LA MISSION NE DIT PAS (défaut n° 10 du 18/08/2026).
        # L'avertissement existe aussi à l'étape 2 — mais il quitte cet
        # écran-là sans y revenir : c'est ICI, devant ▶ Démarrer, qu'il faut
        # qu'il le voie. Même règle, même calcul, deux endroits où il regarde.
        perdues = assistant.infos_perdues_par_le_texte(
            campagne["nature"], configuration["infos"],
            self.application.preferences, configuration["options"],
            campagne["mission"] or "")
        alerte_mission = self._bloc_infos_perdues(
            perdues, ou="Le message de cette campagne")
        entre = f"""{alerte_mission}<details><summary>Mission lue par l'agent (dépliable)</summary>
<pre>{html.escape(campagne['mission'])}</pre></details>
{bloc_parametres}"""
        if fragment:
            return self._zones_vivantes(statut, etat, suite)
        corps = f"""{self._bandeau()}
<p><a href="/">← Retour aux campagnes</a></p>
{self._zones_vivantes(statut, etat, suite, entre)}
{self._script_campagne(campagne_id)}"""
        return self._page(campagne["nom"], corps, actif="campagnes")

    @staticmethod
    def _bloc_infos_perdues(perdues, ou="Votre texte"):
        """L'avertissement « ce que le message ne dit pas » — "" s'il dit tout.

        ⚠ UNE SEULE FORMULATION, DEUX ÉCRANS : l'étape 2 et la fiche de la
        campagne. Il quitte l'étape 2 sans y revenir — c'est devant ▶ Démarrer
        qu'il faut qu'il le voie —, mais deux textes écrits séparément auraient
        fini par ne plus dire la même chose.

        ⚠ LA PHRASE TIENT SUR UNE LIGNE dans le source. Ma première version la
        coupait pour la lisibilité du code : le retour à la ligne partait dans
        la page, et la phrase n'existait plus comme telle — ni pour un essai,
        ni pour qui cherche ces mots dans l'écran.
        """
        if not perdues:
            return ""
        pluriel = len(perdues) > 1
        quoi = "ces informations" if pluriel else "cette information"
        seront = "elles ne seront" if pluriel else "elle ne sera"
        dites = "dites" if pluriel else "dite"
        enregistrees = ("bien qu'elles soient enregistrées" if pluriel
                        else "bien qu'elle soit enregistrée")
        elements = "".join(
            f"<li><strong>{html.escape(libelle)}</strong> : "
            f"« {html.escape(valeur)} »</li>" for libelle, valeur in perdues)
        return (f'<p class="bandeau">⚠ <strong>{ou} ne dit pas {quoi}</strong> : '
                f"{seront} PAS {dites} au téléphone, {enregistrees}.</p>"
                f'<ul class="bandeau">{elements}</ul>'
                "<p><small>Votre texte part mot pour mot — RingBack n'y ajoute "
                "rien. Ajoutez ce qui manque vous-même, ou revenez au texte de "
                "la fiche.</small></p>")

    @staticmethod
    def _zones_vivantes(statut, etat, suite, entre=""):
        """Les deux zones qui se remettent à jour — et ce qui les sépare.

        Le fragment servi au rafraîchissement ne porte QUE les deux zones :
        ce qui les sépare à l'écran n'a pas bougé, et n'a donc pas à voyager.
        """
        return (f'<div id="campagne-etat" data-statut="{html.escape(statut)}">'
                f"{etat}</div>"
                + entre
                + f'<div id="campagne-suite">{suite}</div>')

    # ----------------------------------------------------- les commandes
    def _traiter_demarrage(self, corps):
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            campagne_id = int(donnees.get("campagne", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de campagne invalide.")
        base = self.application.base
        campagne = base.obtenir_campagne(campagne_id)
        if campagne is None or not campagne.get("nature"):
            return self._erreur(404, "Campagne introuvable.")
        if campagne["statut"] not in ("prête", "en pause"):
            return self._rediriger(f"/campagne?id={campagne_id}&fait=pas_en_cours")
        # Plage d'appel autorisée ET période interdite : la même
        # vérification que sur les quatre autres portes, jamais dupliquée.
        #
        # ⚠ SEULE CETTE PORTE-CI PROPOSE DE FORCER, ET SEULEMENT EN SIMULATION
        # (13/08/2026). Le geste est rejoué à l'identique — mêmes champs, plus
        # « forcer_horaire » — et c'est `_refus_hors_plage` qui décide, pas ce
        # formulaire : en appels réels, le champ est ignoré.
        #
        # ⚠ ET LE GESTE NE SE REDEMANDE PAS À CHAQUE REPRISE : une campagne
        # déjà marquée « heure forcée » repart sans repasser par le bouton.
        # Sans cela, mettre en pause puis reprendre à 22 h aurait redemandé la
        # même autorisation, sur la même campagne, pour la même raison.
        forcer = (donnees.get("forcer_horaire", [""])[0] == "1"
                  or assistant.heure_forcee(
                      assistant.configuration_campagne(campagne),
                      self.application.mode_reel))
        rejeu = {"action": "/campagne/demarrer", "campagne": campagne_id,
                 "agenda_verifie": donnees.get("agenda_verifie", [""])[0]}
        if self._refus_hors_plage(forcer=forcer, rejeu=rejeu):
            return
        if forcer and not self.application.mode_reel:
            # Écrit sur la campagne : le fil revérifie la plage ENTRE CHAQUE
            # appel, et sans cette trace il s'arrêterait au contact suivant.
            assistant.noter_heure_forcee(base, campagne_id)
        try:
            # Le même « forcer » qu'au-dessus : le planificateur revérifie le
            # moment, et c'est LUI qui refuse de lever quoi que ce soit pour un
            # client d'appels réel — la garantie ne tient pas à ce formulaire.
            self.application.planif.verifier_garde_fous(
                hors_plage_permis=forcer)
        except planificateur.GardeFou as erreur:
            return self._erreur(403, str(erreur))
        # Le geste conscient : les créneaux annoncés au téléphone sortent de
        # l'agenda de RingBack, et un agenda périmé fait proposer des places
        # déjà prises ailleurs. Sans cette confirmation-là, RIEN ne part —
        # la page revient avec les chiffres du jour, pas avec une question
        # creuse. (Placé APRÈS les verrous existants : un refus de plage ou
        # de garde-fou reste prioritaire et inchangé.)
        if donnees.get("agenda_verifie", [""])[0] != "1":
            journal.info("Démarrage de la campagne n°%d suspendu : l'état de "
                         "l'agenda n'a pas encore été confirmé", campagne_id)
            return self._rediriger(
                f"/campagne?id={campagne_id}&fait=agenda_a_verifier")
        demarree = self.application.demarrer_execution(campagne_id)
        if not demarree:
            return self._rediriger(f"/campagne?id={campagne_id}&fait=pas_en_cours")
        return self._rediriger(f"/campagne?id={campagne_id}&fait=demarree")

    def _traiter_commande(self, corps, commande):
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            campagne_id = int(donnees.get("campagne", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de campagne invalide.")
        base = self.application.base
        campagne = base.obtenir_campagne(campagne_id)
        if campagne is None or not campagne.get("nature"):
            return self._erreur(404, "Campagne introuvable.")
        transmise = self.application.demander_commande(campagne_id, commande)
        if transmise:
            fait = "pause_demandee" if commande == "pause" else "arret_demande"
        elif commande == "arret" and campagne["statut"] in ("prête", "en pause"):
            base.changer_statut_campagne(campagne_id, "arrêtée")
            journal.info("Campagne n°%d arrêtée (aucune exécution en cours)",
                         campagne_id)
            fait = "arretee"
        else:
            fait = "pas_en_cours"
        return self._rediriger(f"/campagne?id={campagne_id}&fait={fait}")

    def _traiter_recuperation(self, corps):
        """📥 Va LIRE chez CALL-E le résultat des appels déjà passés.

        AUCUN APPEL NE PART D'ICI : le seul appel possible dans ce chemin est
        assistant.recuperer_resultats_en_attente, qui ne sait faire qu'une
        LECTURE (GET /v1/calls/{id}) — pas une création.
        """
        donnees = urllib.parse.parse_qs(corps.decode("utf-8"))
        try:
            campagne_id = int(donnees.get("campagne", [""])[0])
        except ValueError:
            return self._erreur(400, "Identifiant de campagne invalide.")
        campagne = self.application.base.obtenir_campagne(campagne_id)
        if campagne is None or not campagne.get("nature"):
            return self._erreur(404, "Campagne introuvable.")
        comptes = assistant.recuperer_resultats_en_attente(self.application,
                                                           campagne_id)
        jeton = self.application.retenir_bilan_recuperation(comptes)
        journal.info("Campagne n°%d : récupération des résultats en attente — "
                     "%d appel(s) relu(s), AUCUN appel passé",
                     campagne_id, len(comptes))
        return self._rediriger(f"/campagne?id={campagne_id}&recup={jeton}")
