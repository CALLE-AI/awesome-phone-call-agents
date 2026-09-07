"""Campaign assistant — web pages and control desk (a server mixin).

Three steps (specification v1.1): ① `/assistant` : the eight kind cards, with
the default calling policy shown on each card; ② `/assistant/message` : a LIVE
preview of the prompt (the page's JavaScript: it updates as you type, with no
server call), the kind's general information (⛔ = mandatory), behaviour
options, contact fields (Identity and Phone cannot be removed, custom fields
can be added). Moving on to step ③ is REFUSED server-side as long as a ⛔ is
missing — the preview is only a convenience; ③ `/assistant/liste` : the grid
whose columns are the fields of step ② — filled by direct typing, pasting, CSV,
an ICS calendar or from the database (the saisie.py / ics.py / generation.py
building blocks are REUSED); `Valider` creates the campaign in the `prête`
state WITHOUT calling anybody.

The control desk (`/campagne?id=N` for an assistant campaign): the
specification's states (accepted, highlighted with the key information;
refused; to contact again with a due date; unreachable (N); to be called back
by a human with the request in clear; excluded; spared), counters, and the ▶
Start → ⏸ Pause / ⏹ Stop commands which act BETWEEN two calls (a call in
progress runs to its end), with resumption possible.

What is postponed is shown as `à venir`, greyed out — never simulated: the
automatic running of follow-ups (they are recorded and displayed; the gesture
stays the button on the 🔁 Relances page).

▶ Start goes through a CONSCIOUS GESTURE (§8.1): the work is twofold — an
appointment booked or moved on the phone changes RingBack's LOCAL calendar
**and** enters the change log to be carried over elsewhere. Since the slots
announced are deduced from that calendar, a stale calendar leads to offering
slots already taken in real life. Clicking ▶ therefore opens a panel — at the
moment of starting, and nowhere else — carrying THE DAY'S FIGURES (appointments
known over the period, free slots computed, the first slots that will be
announced, the date of the last import) and stating frankly the objective signs
of a doubtful calendar. Without the confirmation click, no call goes out.

The control desk also carries the CHANGE LOG (§8.1): the list of what remains
to be carried over into the establishment's scheduling software — readable on
screen, copyable in one gesture, exportable as a CSV generated on the fly
(never stored).

The privacy rule is unchanged: the numbers stay server-side (in the draft) and
come out only MASKED in the pages.
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
    """A drop-down list — preferred to a stack of radio buttons.

    `vide` adds a `to be chosen` entry at the top: it is used when no default
    must be imposed (the calling order, for instance).

    `forme` attaches the field to a form by its id, even when it is written
    ELSEWHERE in the page (HTML's `form` attribute). That is what lets the rule
    panel live beside the grid while going out with it, whichever button is
    clicked — see `_corps_regle`.
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
    """The breadcrumb trail: three circles, a progress line, clickable names.

    `courante` is 1, 2 or 3. A step is only clickable when it is genuinely
    reachable: step ② needs a draft, step ③ needs in addition that step ②'s ⛔
    checks have passed once (etape3_ouverte) — never a link that leads to a
    refusal.
    """
    elements = []
    for rang, (nom, chemin) in enumerate(ETAPES, start=1):
        if rang == courante:
            lien = None  # we are already there
        elif rang == 1:
            lien = chemin                    # changer de nature : toujours
        elif identifiant and (rang == 2 or etape3_ouverte):
            lien = f"{chemin}?b={urllib.parse.quote(identifiant)}"
        else:
            lien = None  # step not reachable yet
        classe = "fa-etape"
        if rang < courante:
            classe += " fa-faite"
        elif rang == courante:
            classe += " fa-courante"
        if lien is None and rang != courante:
            classe += " fa-bloquee"
        interieur = ('<span class="fa-rond"></span>'
                     f'<span class="fa-nom">{rang}. {html.escape(nom)}</span>')
        # A stable id per step (fa-etape-1/2/3): it is by that id the screen is
        # designated, without depending on its position in the page.
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
    """The two input modes, side by side, at the top of the form.

    Two buttons rather than a selector: each choice opens a different interface
    (that is the established exception of 28/07/2026), and the user sees at a
    glance which one they are in.

    ⚠ The toggle reloads NOTHING: the advanced mode is already in the page,
    merely hidden. Toggling is therefore instantaneous and can lose nothing —
    including input in progress in an advanced-mode field.
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
    """The toggle: it changes what you SEE, and remembers the choice.

    The mode is written on <main>; the stylesheet does the rest. The choice
    goes to the server in the background so it can be found again on the next
    campaign — but the display has already switched: we do not wait for the
    network to show what is already there.

    Without JavaScript, the mode stays the one from the Settings and EVERYTHING
    is visible in advanced: no function is lost, only the instant toggle is.
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
    """The advanced mode's horizontal menu: B and C, one at a time.

    ⚠ HIS REQUEST OF 15/08/2026: `advanced mode brings up a horizontal menu
    with option B. Behaviour options and option C. Message preview. Clicking
    shows one or the other of the forms.`

    The two blocks stacked up: the page became long and you had to scroll to
    reach the preview.

    ⚠ THEY ARE <button type="button">, never links nor submit buttons: this
    form is step 2's, and a button with no type would have submitted it on the
    first click on a tab.

    ⚠ AND BOTH PANELS STAY IN THE PAGE, merely hidden. They carry fields that
    must go out with the form even when they were never opened — the same rule
    as the simplified/advanced toggle: `toggling loses nothing`.
    """
    entrees = "".join(
        f'<button type="button" class="onglet-etape2" id="onglet-{code}" '
        f'role="tab" data-panneau="panneau-{code}" '
        f'aria-controls="panneau-{code}" '
        f'aria-selected="{"true" if rang == 0 else "false"}">{libelle}</button>'
        for rang, (code, libelle) in enumerate(ONGLETS_ETAPE2))
    return f'<div class="menu-etape2" role="tablist">{entrees}</div>'


def _script_onglets_etape2():
    """The click that changes panel. Without JavaScript, everything stays visible.

    ⚠ THE FALLBACK IS `SHOW EVERYTHING`, not `hide everything`: the panels are
    hidden by this script, never by the HTML served. A browser without
    JavaScript therefore shows both one after the other — that is exactly the
    earlier screen, and no setting is out of reach.
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
    """Radio buttons when each choice OPENS A DIFFERENT INTERFACE.

    This is the exception to the rule `a selector rather than a stack of
    radios`: here the possible routes are visible at a glance before one is
    opened. For a simple filter, the selector is kept.
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
    """Changing year or week reloads ONLY the dates panel.

    The weeks depend on the year (52 or 53), the days depend on the week AND
    the opening hours: it is the server that knows, not the browser. So we ask
    it — but we reload only this panel, never the page (the owner's rule).

    Without JavaScript, the lists stay as they were on loading: you still
    choose your week within the year displayed, and the button works.
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
    """Changing the source reloads ONLY the rule panel.

    Why the server and not the browser: it is the server that knows which
    settings make sense for the chosen source — the `how far after the slot`
    window only acts on upcoming appointments, and the order labels change
    meaning with the source. The browser cannot guess that without copying the
    rule, and two copies of a rule always end up diverging.

    Without JavaScript, nothing is lost: the panel realigns on a click on
    `Enregistrer la règle`, which goes through the server anyway.
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
    """A mandatory box's colour goes out as soon as it is filled.

    Two events, not one: `input` covers typing on the keyboard, and `change`
    covers the date picker of a datetime-local field, which fills with the
    mouse without a key being pressed. Listening only to `input` would leave a
    mouse-picked date in red.

    A field emptied again lights up once more: the colour says the field's REAL
    state, not `it was touched once`.

    Without JavaScript, the colour stays until the next round trip to the
    server, which recomputes it. Nothing is lost, it is just less lively.
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
    """The filling routes arranged in TWO COLUMNS, with a subheading.

    Owner's request (02/08/2026): six routes in a single stack can no longer be
    read. The two columns answer two different questions — `what am I
    bringing?` on the left, `what does RingBack already have?` on the right.
    They are still radio buttons (each route opens a different screen: the
    established exception to the selector rule).
    """
    colonnes = []
    for titre, choix in (gauche, droite):
        colonnes.append(f"<div><h3>{html.escape(titre)}</h3>"
                        + _choix_panneaux(nom, choix, retenu) + "</div>")
    return f'<div class="deux-colonnes">{"".join(colonnes)}</div>'


def _script_panneaux():
    """Shows only the panel of the chosen route (without JavaScript: all of them).
    """
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
    """A checkbox: the control BEFORE the text, the width of its content."""
    ident = f' id="{identifiant}"' if identifiant else ""
    return (f'<div class="ligne-option"><label class="option">'
            f'<input type="checkbox" name="{nom}" value="1"{ident}'
            f'{" checked" if cochee else ""}>'
            f"<span>{libelle} {complement}</span></label></div>")


class RoutesAssistant:
    """A Gestionnaire mixin: the assistant's and the control desk's routes."""

    # ------------------------------------------------------------- routage
    def _get_assistant(self, url):
        """Handles the GET request when it targets the assistant; returns True
        then.
        """
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
            # The `RingBack's calendar is the reference` panel, requested by
            # the click on ▶ Start: a PIECE of page, computed on the spot.
            self._servir_verification_agenda(parametres)
            return True
        if url.path == "/assistant/periode":
            # Fragment: the appointment-dates panel ALONE, recomputed after a
            # change of year or week.
            self._servir_periode(parametres)
            return True
        if url.path == "/assistant/regle":
            # Fragment: the rule panel ALONE, recomputed after a change of
            # SOURCE — it is the source that decides which settings make sense
            # (see _champ_fenetre).
            self._servir_regle(parametres)
            return True
        if url.path == "/campagne/vivant":
            # The two zones that move during a campaign, and nothing else: that
            # is what the page fetches every 1.5 s instead of reloading itself
            # entirely.
            self._servir_zones_vivantes(parametres)
            return True
        return False

    def _post_assistant(self, url, corps):
        """Handles the POST request when it targets the assistant; returns True
        then.
        """
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
            # 📥 READ the result of calls already placed. This path cannot
            # create any call: it only calls lire_resultat(), which does
            # nothing but a GET. The 3 real-mode locks guard the CREATION of
            # calls, so they are not concerned.
            self._traiter_recuperation(corps)
            return True
        if url.path == "/campagne/compenser":
            self._traiter_compensation(corps)
            return True
        if url.path == "/suivi/creneau/campagne":
            # The SAME gesture, from the schedule: a gap → the campaign that
            # fills it. One mechanism, two entrance doors (§5).
            self._traiter_compensation(corps)
            return True
        return False

    # ------------------------------------------------------ step ① kinds
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
        """Adds or removes a COLUMN, then rechecks the already-filled grid.

        That is the owner's rule (02/08/2026): changing the columns while rows
        exist forces a recheck of what is filled in. A value is NEVER thrown
        away: whatever no longer matches any column sleeps in the contact's
        record and comes back if the column comes back. Only what is missing is
        flagged.
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
            # ⚠ WHAT PROTECTS A COLUMN IS ITS ORIGIN, not the fact that it is
            # mandatory. The old code refused to remove ANY mandatory column —
            # including one added by hand and ticked ⛔: the `Retirer` button
            # was displayed and did nothing. Observed on screen on 02/08/2026.
            # The kind's own columns have no button, and this check confirms it
            # server-side (a forged submission would not get through either).
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
        # THE RECHECK, in both cases — including when the change failed: it
        # states the grid's REAL state.
        manques = assistant.verifier_grille(brouillon)
        if manques:
            brouillon["erreurs"] = brouillon["erreurs"] + manques
        return self._rediriger(f"/assistant/liste?b={identifiant}")

    # ------------------------------------------------------ step ② message
    def _blocs_messages(self, brouillon, ecran=None):
        """The draft's message and errors — THIS SCREEN'S.

        `ecran` is `message` (step ②) or `liste` (step ③). The errors carry the
        screen that produced them: a complaint about step ②'s information has
        no business above step ③'s grid, and the other way round.

        Observed by the owner on 02/08/2026: step ②'s refusal followed him as
        he navigated by the breadcrumb, long after he had fixed it. An error
        with no screen (an old one, or one written by code that did not say
        where it came from) stays displayed everywhere: we prefer one message
        too many to a silent refusal.
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
        """The initial preview rendered server-side (the JavaScript then takes
        over).

        Step-② variables not filled in: in red (⛔ blocking when mandatory);
        PER-CONTACT variables: in blue, filled at call time. The behaviour
        options enter the computation: a segment conditioned by a checkbox only
        appears when it is ticked.
        """
        texte = assistant.construire_mission(nature, infos, preferences,
                                             options)
        return self._colorer(texte, nature, champs)

    def _colorer(self, texte, nature, champs):
        """The text, escaped, with its still-empty variables coloured.

        The honorifics are EXPANDED here, as they will be in the briefing sent:
        the preview shows what will be said, not what is written in the records
        (those never change).
        """
        # ⚠ THE PREVIEW MUST LIE LESS THAN THE PRODUCT, NOT MORE (02/09/2026).
        # It expanded `M.` into `monsieur` whatever the language, while the
        # call does so ONLY IN FRENCH — the expansion comes from listening to
        # French calls, and `monsieur Smith` would be a mistake in English. So
        # the preview announced one thing and the call did another. It now
        # follows the same rule as what goes out.
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
        """THE TWO OTHER PARTS of the briefing, as they will go out.

        Step 2's preview was designed to KNOW WHAT WILL BE SAID. Since the
        briefing has three parts (an opening spoken word for word, an objective
        and context discussed freely, closed outcomes), showing only one would
        amount to hiding the other two. Part ① has its own block (#apercu, the
        one edited by hand); these are built by the SAME code as the real call
        (assistant.construire_consigne) — what is shown is what goes out.

        Returns (context, outcomes) as HTML.
        """
        cadre = assistant.construire_consigne(nature, infos, preferences,
                                              options, champs,
                                              presentation=presentation,
                                              places=places)
        return (self._colorer(cadre.texte_contexte(), nature, champs),
                self._colorer(cadre.texte_issues(), nature, champs))

    def _bloc_consigne(self, nature, infos, champs, preferences, options=None,
                       presentation=None, places=()):
        """Parts ② and ③ displayed under the opening."""
        contexte, issues = self._apercu_consigne(nature, infos, champs,
                                                 preferences, options,
                                                 presentation, places)
        # COLLAPSED BY DEFAULT (owner's request, 02/08/2026): those two parts
        # are written by the campaign's kind and are only touched
        # exceptionally. Expanded by default, they drowned the two fields that
        # really must be filled in. The title stays clickable.
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
        """The live preview's JavaScript — the same rule as the server."""
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
                # A segment conditioned by an OPTION: the preview reads the
                # checkbox itself, to tell the truth without reloading.
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
        # PART ② IS ALIVE TOO. Its fact lines are the same conditional segments
        # as the message (assistant.faits_segments): filling in `Lieu` makes
        # them appear, unticking an option makes them disappear — without
        # reloading, and without a second piece of code being able to diverge
        # from the server's.
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
        """The cascading disclosure of step ②'s options.

        ⚠ Adding/removing a column IS NO LONGER HERE: it followed the columns
        to step ③ (02/08/2026). It happens there through the server, and not in
        the browser as before — because a column change now forces a RECHECK of
        the already-filled grid, and only the server can do that check
        honestly.

        Without JavaScript, everything stays visible: nothing is lost, it is
        just less pleasant.
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
        """A general-information field of step ② (the type is respected).

        `autres`: the ADDITIONAL values of a repeatable piece of information —
        the slots already added, on top of the field's.
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
        """The same information, ONE FIELD PER LENGTH of appointment to rebook.

        Each field carries the label of its length and the number of people
        concerned: that is what lets you know which one you are correcting.
        They ALL carry the name `info_<code>`, repeated — the server glues them
        back in order of length (`assistant.recomposer_par_duree`), and nothing
        indexed is added to the form.
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
        """ONE piece of information typed SEVERAL times: the field, `+`, the list.

        Requested by the owner on 03/08/2026 for freed slots: a `+` button
        beside the field, the list below in ASCENDING chronological order, and
        a cross per row to remove.

        ⚠ ALL THE ROWS CARRY THE SAME NAME `info_<code>`, repeated. Nothing
        indexed (creneau_1, creneau_2…): twelve tests already send a single
        `info_creneau_libere`, and they must go on working word for word. The
        server receives N values and orders them itself.

        ⚠ IT WORKS WITHOUT JAVASCRIPT: the `+` is a real submit button (action
        `creneau`) that stores the value and comes back to step ②, and each
        cross is one too. The script, when present, does the same thing without
        a round trip.
        """
        code = info["code"]
        # ⚠ THE INPUT FIELD IS NOT THE VALUE: it is an ADD field, named
        # separately. All the slots, including the first, live in the list.
        # Otherwise typing a new date over the field would have erased the slot
        # already entered — without saying so.
        toutes = list(autres)
        if valeur and valeur not in toutes:
            toutes.insert(0, valeur)
        toutes = [f["horaire"] for f in assistant.normaliser_creneaux(toutes)]
        lignes = []
        for rang, horaire in enumerate(toutes):
            lisible = self._creneau_lisible(horaire)
            # ⚠ THE FIRST ONE CARRIES `id="info_<code>"`: it is by that id the
            # live preview reads the value (see _script_apercu). Moving it
            # would break the preview in silence.
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
            # Even empty, the id must exist: the live preview looks for it on
            # loading and would never find it again.
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
        """`mardi 12/08 à 15h00` — and the raw value when it is unreadable."""
        try:
            quand = datetime.datetime.fromisoformat(horaire)
        except (TypeError, ValueError):
            return horaire
        return (f"{horaires.JOURS[quand.weekday()]} {quand:%d/%m} "
                f"à {quand:%Hh%M}")

    def _bloc_option_cascade(self, nature, options):
        """The `shift in cascade` option — and only where it does something.

        ⚠ IT WAS OFFERED TO ALL FIVE KINDS (14/08/2026, cross audit). Yet it
        commands only one mechanism: what becomes of the slot a contact LEAVES.
        Three kinds free none — a reminder, a confirmation and a booking move
        nobody — so the box was inert there: ticked or not, nothing changed. A
        box that does nothing is an interface lie, exactly the reasoning of the
        cancellation option just below.
        """
        if nature not in assistant.NATURES_QUI_LIBERENT_UNE_PLACE:
            return ""
        # ⚠ THE TEXT WAS CORRECTED ON 15/08/2026: it announced `with ONE SINGLE
        # slot, RingBack PREPARES the same campaign` — that is no longer true.
        # One slot or several, the slot left behind JOINS the running campaign
        # (see assistant._rendre_la_place). Leaving the old sentence would have
        # had people looking for a `prête` campaign that no longer comes.
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
        """The `offer another date if the contact cancels` option.

        It only appears for the kinds whose message depends on it (🔔 reminder,
        ✅ confirmation): elsewhere, a box that would change nothing would be an
        interface lie. Its DETAIL — the list of free slots to announce — is
        only revealed when it is ticked.
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
        # ⚠ THE STOCK OF SLOTS IS RESET TO THE REAL NUMBER OF PEOPLE BEFORE
        # DISPLAY (17/08/2026). His question, with a screenshot: `the field
        # only offers a few free dates for the 11 appointments — is it simply a
        # display problem?` Yes, but that display is a FIELD: if he touches it,
        # his nineteen dates become the definitive list. A field that shows
        # something false invites the false to be frozen.
        assistant.rafraichir_stock_du_brouillon(
            self.application.base, preferences, brouillon)
        # ⚠ `mode_saisie`, not `mode`: further down in this method, `mode`
        # already means the FOLLOW-UP mode (delay or slot).
        mode_saisie = assistant.mode_formulaire(preferences)
        nature = brouillon["nature"]
        definition = assistant.NATURES[nature]
        options = brouillon["options"]
        champs = assistant.champs_campagne(brouillon)
        # C. The live preview. It shows the THREE PARTS of the briefing: ① the
        # opening spoken word for word (the one edited by hand), ② the
        # objective, the facts and the constraints, ③ the three closed
        # outcomes. The last two come out of the same code as the real call —
        # see _apercu_consigne.  There is no longer a `free text` special case:
        # the `Personnalisé` kind, the only one with no template, was removed
        # on 03/08/2026. Every kind therefore has a starting text, and `✎
        # Modifier le texte à la main` is enough to depart from it.
        editee = bool(brouillon.get("mission_editee")
                      and brouillon.get("mission"))
        # A text rewritten by hand is THE ONE THAT WILL GO OUT: the preview
        # shows that one, not the template it replaces.
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
        # ⚠ WHAT HIS TEXT NO LONGER SAYS (defect no. 10 of 18/08/2026). He
        # filled in a field AFTER retyping the message: the value was saved,
        # the screen showed it — and the agent never said it. We reinject
        # NOTHING into his text (`a message rewritten by hand goes out exactly
        # as he wrote it`): we say so, he decides.
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
        # B. General information. Those that are the DETAIL of an option
        # (info["sous_option"]) do not appear here: they are shown under their
        # checkbox, and only when it is ticked.
        deja = [f["horaire"] for f in (brouillon.get("creneaux") or [])]
        # ⚠ ONE FIELD PER LENGTH TO REBOOK (18/08/2026, his request): `we need
        # a text field for the possible appointments for all the appointment
        # lengths found in the move, 1 slot, 2 slots and so on.` The stock did
        # carry its two lists, but glued into ONE field — impossible to correct
        # one without touching the other, and the label did not say which was
        # which. A single length: a single field, as before.
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
        # The expected columns left this screen on 02/08/2026 for step ③, then
        # the whole screen was REMOVED on 09/08/2026 (owner's request): the
        # grid already shows its columns in the header, with their ⚠, and
        # pasting states the expected format. ⚠ THE CUSTOM FIELDS TRAVEL ANYWAY
        # in this form, hidden: an existing database may carry some, and step ②
        # returns the complete list on every submission. Without that, a round
        # trip through step ② would erase a column a campaign uses.
        codes_nature = {champ["code"] for champ in definition["champs"]}
        porteurs_champs = "".join(
            '<input type="hidden" name="champ_perso" '
            f'value="{html.escape(champ["libelle"] + "|" + champ["type"] + "|" + ("1" if champ["obligatoire"] else ""), quote=True)}">'
            for champ in champs
            if not (champ["verrouille"] or champ["code"] in codes_nature))
        # The text is already written by the kind: the preview only appears in
        # advanced mode. (Before 03/08/2026 there was an exception —
        # `Personnalisé`, with no template, whose mission box was the ONLY
        # place the message was written. That kind was removed, and the
        # exception with it.) Since 15/08/2026 it shares the `avance` block
        # with the options, under a horizontal menu — see `_menu_etape2`: it is
        # the whole block that disappears in simplified mode. Entered HERE
        # directly, the list already filled (§4 and §5): we say so, with the
        # real count and the recipe that built it. Without that sentence, the
        # operator would not know that step 3 is already done.
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
        """Carries the WHOLE step-② form into the draft."""
        definition = assistant.NATURES[brouillon["nature"]]
        for info in definition["infos"]:
            cle = f"info_{info['code']}"
            if info.get("multiple"):
                # ⚠ ALL THE VALUES, not only the first. Reading
                # `donnees[cle][0]` silently lost every slot but one — the
                # opposite of `input is never lost`. The ADD field is gathered
                # here too: a date typed without pressing `+` still counts.
                valeurs = list(donnees.get(cle, []))
                valeurs += list(donnees.get(f"{info['code']}_ajout", []))
                brouillon["creneaux"] = assistant.normaliser_creneaux(
                    " ".join(v.split()) for v in valeurs)
                brouillon["infos"][info["code"]] = (
                    brouillon["creneaux"][0]["horaire"]
                    if brouillon["creneaux"] else "")
            elif (info.get("reglage") == "creneaux_lisibles"
                  and len(donnees.get(cle, [])) > 1):
                # ⚠ SEVERAL FIELDS FOR ONE PIECE OF INFORMATION: one per length
                # to rebook. We glue them back in order of length — the SAME
                # source as the display, otherwise the 40-minute list would
                # come back under the 20-minute label.
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
        # Only the kinds concerned carry the box: elsewhere, the setting is not
        # touched (an absent box does not mean `unticked`).
        if assistant.option_annulation_utile(brouillon["nature"]):
            options[assistant.CLE_REPLACER_ANNULATION] = (
                "opt_replacer" in donnees)
        for cle in ("relance_mode", "relance_delai", "relance_creneau_debut",
                    "relance_creneau_fin", "relance_max", "cascade_jusqu_au"):
            if cle in donnees:
                options[cle] = donnees[cle][0].strip()
        # The custom fields travel WITH the form (one hidden per row): adding
        # or removing them does not reload the page, and the complete list
        # comes back on every submission — we rebuild it here.
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
        # The recipe remembers that a message was rewritten by hand: it cannot
        # be rebuilt on another slot without inventing.
        brouillon.setdefault("recette", assistant.recette_vide())
        brouillon["recette"]["mission_editee"] = brouillon["mission_editee"]

    def _valider_creneaux(self, brouillon, info):
        """Checks EACH slot of a repeatable piece of information; returns the
        refusals.

        ⚠ ONE REFUSED SLOT DOES NOT CARRY OTHERS OFF. It stays in the list,
        exactly as typed, and the message names WHICH one is wrong: throwing
        away the four correct slots because the fifth is unreadable would be
        the very fault the product fights everywhere else.
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
        """The REAL checks for moving on to step ③; returns the errors."""
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
        # ⚠ THE `+` AND THE CROSSES DO NOT MOVE ON TO STEP ③. They store the
        # list of slots and COME BACK here: checking what follows when nothing
        # was asked would display refusals on a form being filled in. They are
        # real submit buttons, so it works without JavaScript.
        if action == "creneau-ajouter" or action.startswith("creneau-retirer:"):
            if action.startswith("creneau-retirer:"):
                # The cross carries THE TIME, not a rank: a rank would have
                # designated another slot as soon as the list was re-sorted.
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
        # What this screen refuses BELONGS to this screen: see _blocs_messages.
        brouillon["erreurs_ecran"] = "message"
        # ⚠ `ajouter_champ` AND `retirer_champ` ARE NO LONGER HANDLED HERE: the
        # columns have their own screen at step ③, with the grid they describe,
        # and their own route (_traiter_champs_attendus) — it is that route
        # which rechecks what is already filled in. Two places for the same
        # action would end up diverging: only one remains. action `continuer`:
        # the REAL checks, server-side.
        erreurs = self._valider_etape2(brouillon)
        if erreurs:
            brouillon["erreurs"] = erreurs
            journal.info("Assistant : passage à l'étape ③ REFUSÉ (%d ⛔/erreur)",
                         len(erreurs))
            return self._rediriger(f"/assistant/message?b={identifiant}")
        brouillon["erreurs"] = []
        # The business name is not retyped for every campaign: the first time
        # it is entered, it becomes the default setting.
        entreprise = (brouillon["infos"].get("entreprise") or "").strip()
        preferences = self.application.preferences
        if entreprise and not (preferences.obtenir(themes.CLE_ENTREPRISE)
                               or "").strip():
            preferences.definir(themes.CLE_ENTREPRISE, entreprise)
            journal.info("Nom de l'entreprise mémorisé dans les réglages.")
        # Step 3 becomes reachable through the breadcrumb, and stays so.
        brouillon["etape3_ouverte"] = True
        if not (brouillon["mission_editee"] and brouillon.get("mission")):
            brouillon["mission"] = assistant.construire_mission(
                brouillon["nature"], brouillon["infos"],
                self.application.preferences, brouillon["options"])
        return self._rediriger(f"/assistant/liste?b={identifiant}")

    # ------------------------------------------------------- step ③ grid
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
        # THE EMPTY MANDATORY BOXES, COMPUTED ON EVERY DISPLAY — hence from the
        # moment contacts are imported, without waiting for a refusal. That is
        # the owner's rule (02/08/2026): a single error sentence, and the
        # colour shows where to type. The class goes at the first keystroke
        # (see _script_grille).
        manquantes = assistant.cellules_manquantes(brouillon)

        def marquer(rang, code):
            return ' class="manque"' if (rang, code) in manquantes else ""

        lignes = []
        for indice, contact in enumerate(contacts, start=1):
            # The masked number is displayed IN its field (not above: that
            # would offset every row). A field left as it stands — it still
            # contains `•` — counts as `unchanged` server-side.
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
            # ⚠ NO MORE `BELOW`: the filling routes are no longer under the
            # grid, they open through `Ajouter des contacts`. Leaving the word
            # would have had the reader look for something that is not there.
            grille = ('<p class="grille-vide">Aucune personne dans la grille. '
                      "Le bouton <strong>« Ajouter des contacts »</strong> "
                      "ouvre les façons de la remplir : coller une liste, "
                      "importer un fichier, reprendre des clients ou des "
                      "rendez-vous.</p>")
        attendu_collage = assistant.format_collage(champs)
        exemple_ligne = assistant.exemple_collage(champs)
        # The chosen filling route is kept: after a pasting error, you come
        # back to the pasting, not to another screen.
        retenu = brouillon.get("remplissage") or "collage"
        # ⚠ THE VIEW TRAVELS IN THE DRAFT. Two halves in the page, only one
        # shown — and it is the server that decides which, so the no-JavaScript
        # fallback is complete.
        vue = brouillon.get("vue_liste") or "grille"
        # ⚠ TWO TOGGLES THAT DO NOT DO THE SAME THING. `mode_liste` says WHAT
        # WILL BE SENT (a rule or a grid); `vue_liste` says only which of the
        # manual mode's two faces is shown.
        automatique = self._liste_automatique(brouillon)
        cache_manuel = " hidden" if automatique else ""
        cache_grille = (" hidden" if automatique or vue != "grille" else "")
        cache_ajout = (" hidden" if automatique or vue != "ajout" else "")
        verbe = ("RÉELS" if self.application.mode_reel else "simulés")
        # ⚠ NO MORE `SIMPLIFIED / ADVANCED` TOGGLE ON THIS SCREEN (09/08/2026).
        # It commanded only one thing, the `The expected columns` block,
        # removed the same day: the columns are already readable in the grid's
        # header, with their ⚠, and pasting states the expected format. A
        # toggle that toggles nothing is a button that lies. Step ② keeps its
        # own — it hides the message preview there.
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
        """`All clients`, then the states that call for a campaign.

        The list of states is not copied here: it comes from
        etats_clients.TRAITEMENT, the same table that decides, on the 👥
        Contacts page, which state calls for which campaign kind. A state added
        over there appears here without anyone touching it.
        """
        choix = [(assistant.SOURCE_TOUS_CLIENTS, "Tous les clients")]
        for etat in etats_clients.TRAITEMENT:
            choix.append((f"etat:{etat}", etats_clients.libelle_etat(etat)))
        return choix

    def _bloc_periode_rendezvous(self, identifiant, brouillon):
        """`Load by dates`: the source, then the week, then the day.

        Requested by the owner on 02/08/2026: `add a week option, then a
        selector for the current year and a selector for the weeks with the
        date from .. to .. displayed so you can find your way easily, then an
        option for the day (among the working days) with an option for all`.

        The three selectors are ALWAYS visible: this panel is already the
        content of a chosen route; adding a `do you want to filter?` box to it
        would make an option of an option. `All weeks` and `all days` are the
        neutral entries — nothing is imposed.

        The last choice is redisplayed IN its fields: after a refusal, you
        correct instead of re-choosing everything.
        """
        retenu = brouillon.get("periode") or {}
        aujourd_hui = datetime.date.today()
        annee = str(retenu.get("annee") or aujourd_hui.year)
        annees = [(str(a), str(a))
                  for a in range(aujourd_hui.year - 1, aujourd_hui.year + 2)]
        # From the CURRENT week to the end of the year: you set up a campaign
        # for what is coming, not for last January.
        semaines = horaires.options_semaines(int(annee), aujourd_hui)
        semaine = str(retenu.get("semaine") or "")
        # The days offered are those of the chosen week, and OPEN ones only: a
        # closed day has no appointment to call back about.
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
        """(start date, gain in days) for manual loading.

        The gain is counted from the campaign's FIRST slot: a person is only
        kept when their appointment falls at least N days after it. The same
        computation as `assistant.contacts_de_la_regle` — one reasoning, two
        paths that use it.

        Returns (None, "") when nothing is asked, or when the campaign offers
        no slot.
        """
        gain = str(champs_formulaire.get("regle_jours") or "").strip()
        if not gain.isdigit():
            return None, ""
        places = assistant.places_du_brouillon(brouillon)
        if not places:
            return None, ""
        # The choice is REMEMBERED in the draft: it is redisplayed, and the
        # campaign created will carry it as its rule.
        regle = dict(brouillon.get("regle_liste") or {})
        regle["jours"] = gain
        regle.setdefault("source", champs_formulaire.get("source", ""))
        brouillon["regle_liste"] = regle
        debut = (datetime.datetime.fromisoformat(places[0])
                 + datetime.timedelta(days=int(gain))).isoformat(
                     timespec="minutes")
        return debut, gain

    def _champ_gain_manuel(self, identifiant):
        """The minimum gain, INSIDE the manual loading form.

        ⚠ IT EXISTED ONLY IN THE OTHER PANEL (14/08/2026). The `at least N
        days` field lived in the `Enregistrer la règle` form, in automatic
        mode. Manual loading — the one the owner used — did not carry it, and
        therefore applied NO gain: he loaded 328 people, some of whom gained
        ZERO days, while he had chosen `at least 30 days` a few centimetres
        higher, in a panel he believed was shared.

        Two panels, two forms, one screen: it is the screen that must adapt,
        not the operator. The field is here too, under the same name, and
        `_traiter_import_grille` applies it.

        It only appears for a campaign that OFFERS A SLOT: with no slot,
        `gaining days` means nothing.
        """
        brouillon = self.application.obtenir_brouillon_assistant(identifiant)
        if not brouillon or not assistant.places_du_brouillon(brouillon):
            return ""
        retenu = str((brouillon.get("regle_liste") or {}).get("jours") or "")
        return f"""    <label class="champ-option">Gain minimum — n'appeler que
      ceux que la place ferait avancer d'au moins<br>{_selecteur(
          "regle_jours", list(assistant.JOURS_APRES), retenu)}</label>"""

    def _bloc_reprise_campagne(self, identifiant):
        """The `start again from a previous campaign` filter (step ③).

        Past campaigns' results are recorded in the database: you can therefore
        call back exactly the 📵 unreachable ones, the ❌ refusals, the 🙋 `to be
        called back by a human`… of a given campaign. It is a FILTER (two
        criteria combined), hence two drop-down lists — radio buttons stay
        reserved for routes that open a different screen. The number of people
        found is displayed BEFORE adding them, and recomputes itself when a
        criterion changes: only that figure is refreshed, the page does not
        move.
        """
        reprenables = assistant.campagnes_reprenables(self.application.base)
        if not reprenables:
            return ("<p><small>Aucune campagne précédente n'a encore de "
                    "contacts : ce filtre s'activera dès la première "
                    "campagne créée.</small></p>")
        choix_campagnes = [(str(cid), libelle) for cid, libelle, _ in reprenables]
        comptes = {str(cid): compte for cid, _, compte in reprenables}
        # The last filter used stays displayed IN its fields: you chain `the
        # unreachable ones, then the refusals` without re-choosing everything.
        dernier = (self.application.obtenir_brouillon_assistant(identifiant)
                   or {}).get("reprise") or {}
        campagne_retenue = dernier.get("campagne")
        if campagne_retenue not in comptes:
            campagne_retenue = choix_campagnes[0][0]
        etat_retenu = dernier.get("etat")
        if etat_retenu not in assistant.ETATS_REPRISE:
            etat_retenu = "tous"
        total = comptes[campagne_retenue].get(etat_retenu, 0)
        # The real counts, read from the database, travel with the page: the
        # figure displayed is never an estimate.
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
        """True when this campaign builds its list from a RULE.

        Reserved for the kinds that have a slot to offer: elsewhere there is no
        `current slot` on which to replay anything, and a toggle that would
        change nothing would be an interface lie.
        """
        if not assistant.INFO_CRENEAU_PAR_NATURE.get(brouillon["nature"]):
            return False
        return brouillon.get("mode_liste") == "automatique"

    def _bascule_liste(self, identifiant, brouillon):
        """`Automatic / Manual` — replaces `Simplified / Advanced` here.

        ⚠ IT IS NOT THE SAME MECHANISM, and that is the important point: the
        display toggle only changes what you see and sends nothing; this one
        changes what IS SENT to the server. Confusing the two would have sent
        both the manual grid AND the rule.
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
        # ⚠ THE ROW EXISTS EVEN WITH NO TOGGLE. The kinds with no slot to offer
        # have no mode — but they do have a `Valider`, and leaving it in the
        # grid would have put it in two places depending on the kind. One
        # place, always the same.
        valider = self._bouton_valider(brouillon)
        if not modes and not valider:
            return ""
        return f'<div class="rangee-bascule">{modes}{valider}</div>'

    def _bouton_valider(self, brouillon):
        """`Valider — create the campaign`, in the mode row (09/08/2026).

        ⚠ IT REMAINS THE GRID'S SUBMIT BUTTON. Placed in another form, it would
        have lost the edited cells: you correct a number, click `Valider`, and
        the correction would have gone in the bin. HTML's `form` attribute
        attaches it to the grid while showing it elsewhere — no JavaScript, the
        fallback stays complete.

        ⚠ IT ONLY APPEARS WHEN THERE IS SOMETHING TO VALIDATE: a rule in
        automatic mode, at least one person in manual. A button that can only
        refuse is worth less than an absent button.
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
        """THE RULE: a dated source, and how far to look after the slot.

        ⚠ NOTHING ABSOLUTE HERE — no year, no week, no day. An absolute period
        would make the campaign non-replayable: replaying it on another slot
        would give the same people, not the ones the new slot interests. So the
        window ALWAYS starts from the current slot.
        """
        if not self._liste_automatique(brouillon):
            return ""
        # ⚠ FULL WIDTH, like the manual mode's grid (09/08/2026). A narrow card
        # beside a table taking up the whole area gave two modes of different
        # widths for one screen.
        return (f'<div class="carte panneau-automatique" id="panneau-regle">'
                + self._corps_regle(identifiant, brouillon) + "</div>"
                + _script_regle(identifiant))

    def _corps_regle(self, identifiant, brouillon):
        """The inside of the rule panel — rendered alone when it reloads.

        ⚠ SEPARATED FROM THE FRAME ON PURPOSE: changing the source reloads THIS
        block, not the page (the owner's rule). It is the same split as the
        dates panel, and for the same reason — it is the server that knows
        which settings make sense for the chosen source, not the browser.
        """
        regle = brouillon.get("regle_liste") or {}
        source = regle.get("source") or assistant.REGLE_LISTE_DEFAUT["source"]
        # ⚠ SOURCES_REGLE, NOT SOURCES_DATEES (15/08/2026, his request): the
        # dynamic rule offers one fewer — `booked, scheduled AND confirmed` has
        # left here. It stays available for MANUAL loading, where taking a
        # whole day of the schedule makes sense.
        sources = [(code, assistant.SOURCES_BASE[code])
                   for code in assistant.SOURCES_REGLE]
        # ⚠ NO <form> HERE, AND IT IS THE HEART OF THIS PROJECT'S MOST STUBBORN
        # DEFECT (15/08/2026). The panel was a SEPARATE form, with its own
        # `Enregistrer la règle` button. The `▶ Valider` button, for its part,
        # submits `form-grille` — ANOTHER form, which therefore carried neither
        # the source nor the minimum gain. Result: the owner chose `at least 30
        # days`, clicked `Valider`, and his choice NEVER REACHED THE SERVER.
        # His campaign went out with `jours: ""` and called people from the
        # following week. He reported it four times; I fixed two other paths
        # before looking at that one.  The fields now belong to `form-grille`:
        # whichever button is used — `Enregistrer la règle`, `Enregistrer la
        # grille` or `▶ Valider` — the rule displayed is the rule that goes
        # out. A choice visible on screen can no longer be lost by the button
        # you happen to prefer.
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
        """`How far after the slot` — ONLY where it acts.

        ⚠ THE DEFECT THIS FIXES (11/08/2026), observed by the owner and
        measured: on the sources with no upcoming appointment, the window does
        NOTHING. Measured on the sample data set, source `cancelled, missed and
        waiting`: 9 people kept with `no limit`, 9 with `7 days`, 9 with `30`,
        9 with `90`. The setting was therefore on screen, adjustable, and
        without effect — which reads as a product defect.

        It was not the rule that was wrong: somebody who NO LONGER has an
        appointment has no date to bound, any slot suits them. It was the
        SCREEN offering an inapplicable setting without saying so.
        """
        if source in assistant.SOURCES_A_VENIR:
            # ⚠ THE LABEL STATES THE GAIN, NOT THE MECHANISM (11/08/2026). It
            # said `How far after the slot`, which described a search bound —
            # and it kept the people who gained the LEAST. The question you
            # really ask is: who does this slot serve enough to be worth
            # picking up the phone for?
            return f"""<label class="champ-option">Combien de temps elle leur
  fait gagner, au minimum<br>{
                _selecteur("regle_jours", list(assistant.JOURS_APRES),
                           str(regle.get("jours") or ""),
                           forme="form-grille")}</label>"""
        # The saved value travels anyway, hidden: coming back to a dated source
        # must find the window you had set there, not zero.
        return f"""<input type="hidden" name="regle_jours" form="form-grille"
      value="{html.escape(str(regle.get('jours') or ''))}">
    <p class="champ-option sourd"><small>Ces personnes n'ont
    <strong>plus de rendez-vous</strong> : elles n'ont rien à gagner ni à
    perdre, n'importe quelle place les arrange. Le temps gagné ne se calcule
    donc pas ici.</small></p>"""

    @staticmethod
    def _phrase_interet(source):
        """The rule of interest, stated for the CHOSEN source and not the others.

        Two populations, two sentences: showing both to everybody made people
        read an explanation half of which did not concern the current campaign.
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
        """The button that opens — or closes again — the filling routes.

        ⚠ IT IS A REAL SUBMIT BUTTON, in its own little form: without
        JavaScript it works identically. The product holds this rule
        everywhere, and it is what made it possible to deliver the installer,
        the calendar and the range selection without writing every gesture
        twice.
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
        """The current order and the choices to show — BOTH screens share it.

        ⚠ IT DOES NOT OFFER ONLY TWO CHOICES WHEN A THIRD IS IN FORCE. The
        owner asks for only two (the furthest, the nearest); but if step ②
        chose `alphabetical`, showing it is the only way not to overwrite it on
        the first submission.
        """
        courant = brouillon.get("ordre") or "liste"
        # ⚠ NO SORTING BY DATE WITH NO DATE (14/08/2026, cross audit). The two
        # orders offered sort on the contact's appointment (`ordonner_contacts`
        # reads champs_contact()["rdv_existant"]). A `booking` campaign does
        # not carry that column: both choices left the order UNCHANGED there,
        # and the record then announced an order that had never been applied.
        # We do not offer a setting with no effect.
        disponibles = (assistant.ORDRES_PAR_DATE
                       if assistant.nature_porte_un_rendezvous(
                           brouillon.get("nature")) else ())
        choix = [(code, assistant.ORDRES_APPEL[code]) for code in disponibles]
        if courant not in disponibles:
            choix.append((courant, assistant.ORDRES_APPEL.get(
                courant, courant) + " (choisi à l'étape ②)"))
        return courant, choix

    def _selecteur_ordre_regle(self, brouillon, source=None):
        """The calling order of AUTOMATIC mode (09/08/2026).

        ⚠ IT WAS MISSING, and it showed in use: the order could only be set in
        the grid — invisible in automatic mode. So the campaign called in the
        order inherited from step ②, with no way to read or change it. It goes
        out with the rule's form, which `_traiter_grille` reads like all the
        others (the field is called `ordre`, as in the grid: one name, one
        place that reads it back).

        ⚠ THE LABEL FOLLOWS THE SOURCE (11/08/2026). Both orders sort on the
        date of the contact's appointment — but on the sources with no upcoming
        appointment, that date is the date of the LOST appointment, in the
        past. `The furthest appointment first` therefore meant `the one who has
        just lost their slot` there, which is not at all the same idea. The
        sorting has not changed — what it says has become accurate.
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
        """The same orders, stated in TIME GAINED (11/08/2026).

        The owner's question, word for word: `do we pick first the appointment
        furthest in the future, or the first one from the start date?` The
        earlier labels named the MECHANISM (`the FURTHEST appointment first`);
        these name the CONSEQUENCE, which is the only thing anybody wants to
        decide.

        The sorting itself does not move: `the furthest first` IS `the one who
        gains the most`.
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
        """The same orders, stated for people WAITING for a slot.

        The same sorting code, other words: we still sort on the date of the
        contact's appointment, and for them that is the one they lost.
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
        """`At most … people` — the ceiling of contacts to load.

        ⚠ IT GOES OUT IN THE SAME FORM AS THE ORDER, and `_traiter_grille`
        reads it back: one field name (`plafond`), one place that reads it. A
        field placed in a form nobody reads back would have been thrown away in
        silence — that happened to the order selector, and
        `_selecteur_ordre_grille`'s comment keeps the record of it.

        Empty = no ceiling. The expected format is SHOWN in the field, and the
        label says what the ceiling does: limit the calls.
        """
        courant = str(brouillon.get("plafond") or "")
        return f"""<label class="champ-option">Au maximum, combien de personnes
  <br><input type="number" name="plafond" min="1" step="1"
  form="form-grille" value="{html.escape(courant)}" placeholder="toutes"
  title="Laissez vide pour n'écarter personne"></label>"""

    def _selecteur_ordre_grille(self, brouillon):
        """The calling order, ABOVE the grid (request of 03/08/2026).

        ⚠ IT LIVES IN THE SAME FORM AS THE GRID, and `_traiter_grille` reads
        it. Placed elsewhere, nobody would have read it: `_enregistrer_etape2`
        only runs on step ②, and an `ordre` sent with the grid was thrown away
        IN SILENCE — the grid showed one order, the campaign called in another.

        ⚠ IT DOES NOT OFFER ONLY TWO CHOICES WHEN A THIRD IS IN FORCE. The
        owner asks for only two (the furthest, the nearest); but if step ②
        chose `alphabetical`, showing it would have been the only way not to
        overwrite it on the first submission.
        """
        # ⚠ NOT TWO ORDER SELECTORS IN THE PAGE. In automatic mode it is the
        # rule panel that carries the order; this one stays INSIDE the grid's
        # form, which also goes out when `Valider` is clicked. With both
        # together, the grid's value — the old one — silently overwrote the one
        # just chosen in the panel.
        if self._liste_automatique(brouillon):
            return ""
        courant, choix = self._choix_ordre(brouillon)
        # ⚠ THE SENTENCE FOLLOWS THE KIND (14/08/2026, cross audit). It
        # explained the order by `the slot that comes free` — which only makes
        # sense on a freed slot. On the other four kinds, the operator read a
        # justification matching nothing they were doing.
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
        """Carries the edited cells into the draft; returns the errors."""
        erreurs = []
        colonnes = self._colonnes(brouillon)
        for indice, contact in enumerate(brouillon["contacts"], start=1):
            cle_nom = f"nom_{indice}"
            if cle_nom in donnees:
                contact["nom"] = " ".join(donnees[cle_nom][0].split())
            telephone = donnees.get(f"tel_{indice}", [""])[0].strip()
            # The field shows the MASKED number: if it still contains `•`, it
            # has not been edited — so we do not touch it either (never a
            # number rebuilt from a mask).
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
        """The numbers of the testers declared in ⚙ Réglages, or [] (none)."""
        return essai_reel.numeros_declares(self.application.preferences)

    def _valider_grille(self, brouillon):
        """The final validation's checks (⛔, duplicates, emptiness).

        The duplicate refusal stays COMPLETE: the same number twice means two
        calls to the same person. One single family of exceptions, wanted and
        declared by the operator themselves: the 🧪 numbers of their TESTERS (⚙
        Réglages) — their own, and those of the people playing a role with them
        (see essai_reel). Any other repeated number stays refused, without
        exception.
        """
        erreurs = []
        contacts = brouillon["contacts"]
        # ⚠ IN AUTOMATIC MODE, THE GRID IS EMPTY BY CONSTRUCTION. The people
        # are not chosen here: they are found by the rule, replayed at every
        # slot. Refusing emptiness would have made this mode unusable. What is
        # required is the RULE — without it the campaign would call nobody.  ⚠
        # BUT WE DO NOT LEAVE HERE FOR ALL THAT. The grid may NOT be empty in
        # automatic mode: you type three people in manual, you switch, and they
        # stay — that is intended, input is never lost. Leaving straight away
        # sent them out WITHOUT the duplicate refusal and WITHOUT the exclusion
        # of the `do not call again`. The checks below therefore apply too, as
        # soon as there is somebody to check.
        if self._liste_automatique(brouillon):
            if not assistant.regle_de_liste(brouillon):
                erreurs.append("Choisissez la règle qui fabrique la liste, "
                               "puis « Enregistrer la règle ».")
            if not contacts:
                return erreurs
        elif not contacts:
            erreurs.append("La grille est vide : ajoutez au moins une personne.")
            return erreurs
        # ⚠ WITH NO MESSAGE, NOTHING GOES OUT — AND ABOVE ALL NOT A BLANK PAGE.
        # Measured on 20/08/2026 while writing the completed-number test: from
        # his schedule, the selection jumps DIRECTLY to step ③, and the draft
        # arrives with `mission` at None. Clicking `Valider` without going back
        # through ② sent an SQLite IntegrityError (`NOT NULL constraint failed:
        # campagnes.mission`) up to the HTTP handler: connection cut, blank
        # page, nothing to read. An empty mandatory field is REFUSED, like all
        # the others here, saying where to go and fill it in.
        if not (brouillon.get("mission") or "").strip():
            erreurs.append("Le message à dire au téléphone est vide : "
                           "revenez à l'étape ② pour l'écrire.")
        if brouillon["politique"] == "unique" and len(contacts) > 1:
            erreurs.append("Cette nature appelle UN SEUL contact : gardez une "
                           f"seule ligne ({len(contacts)} actuellement).")
        # ⚠ THE EMPTY BOXES MAKE ONLY ONE SENTENCE. They produced one line
        # each: thirty identical sentences over ten contacts, and still no
        # landmark for where to type. The colour, in the grid, now says WHERE;
        # this message says WHAT.
        if assistant.cellules_manquantes(brouillon):
            erreurs.append(assistant.MESSAGE_CHAMPS_OBLIGATOIRES)
        # The duplicate keeps its own sentence: it is not a lack, it is a
        # conflict BETWEEN two rows — colouring one box would not say which of
        # the two is at fault.
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
        # ⚠ WE REORDER THE LIST ITSELF, NEVER JUST THE DISPLAY. The cells are
        # named by POSITION (nom_1, tel_1, c_x_1…) and read back by the same
        # position: sorting at render time would have written the corrected
        # number onto the person still at position 1. A number on the wrong
        # name, in a list that will be dialled. ⚠ AND AFTER
        # `_enregistrer_grille`: that one reads back by position, it must see
        # the list as it was displayed.
        ordre = donnees.get("ordre", [""])[0]
        if ordre in assistant.ORDRES_APPEL and ordre != brouillon.get("ordre"):
            brouillon["ordre"] = ordre
        # THE CEILING, read in the same place as the order. The field is a
        # `number`: empty or zero means `no ceiling`, and an unreadable value
        # sets nobody aside rather than setting people aside at random.
        if "plafond" in donnees:
            brut = donnees["plafond"][0].strip()
            brouillon["plafond"] = brut if brut.isdigit() and int(brut) else ""
        # ⚠ THE RULE TOO, AND IT IS THE COSTLIEST DEFECT OF THIS WHOLE PROJECT
        # (14/08/2026). The minimum gain was only saved by the `Enregistrer la
        # règle` button. Chosen in the selector then followed by a click on
        # `Valider`, it was SILENTLY LOST — and the screen went on showing `at
        # least 30 days`, since it is the browser that holds that value. The
        # owner therefore set up several campaigns believing he had asked for a
        # thirty-day gain; his campaign no. 33 carries `jours: ""`, and it
        # called people from the same week. He hunted for the cause four times
        # in a row.  A field present in the submitted form is TAKEN INTO
        # ACCOUNT, whichever button is used — exactly like the order and the
        # ceiling just above. A choice visible on screen must never be ignored.
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
            # We are changing view, we are validating nothing: showing refusals
            # on a form you have just opened would make no sense.
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
            # A person written by hand has no criterion behind them: the list
            # is no longer reproducible on another slot (§8.3).
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
        # The 🧪 numbers of the declared testers: they alone may come back
        # several times (several identities on known phones — the operator's,
        # and those of the people playing along with them).
        numeros_essai = self._numeros_essai()
        mode = champs_formulaire.get("mode", "")
        # We come back to the route that has just been used (and not to
        # another).
        brouillon["remplissage"] = mode or brouillon.get("remplissage")
        nouveaux, erreurs, complements = [], [], []
        try:
            if mode == "collage":
                colle = champs_formulaire.get("liste", "")
                nouveaux, erreurs, refusees = assistant.analyser_collage(
                    colle, champs, connus, numeros_essai)
                # Refused input is NEVER lost: the rows that produced nothing
                # come back exactly as they were into the box, to be fixed in
                # place. Those already entered into the grid disappear from it
                # — otherwise a second submission would make duplicates.
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
                # `base` is this route's OLD name: it is still accepted so that
                # links and tests from before 02/08/2026 go on working.
                # `rendezvous` is the new one.
                source = champs_formulaire.get("source", "")
                # The date filter is remembered IN the draft: after a refusal,
                # it is redisplayed in its fields.
                periode = self._periode_choisie(champs_formulaire, brouillon)
                periode["source"] = source or periode["source"]
                brouillon["periode"] = periode
                debut, fin = self._bornes_de_periode(periode)
                # ⚠ THE MINIMUM GAIN APPLIES HERE TOO (14/08/2026). It only
                # counted in the `automatic` panel: this loading took
                # everybody, whatever the `at least N days` setting ticked
                # right beside it. The owner thus loaded 328 people, some of
                # whom gained zero days, and saw his appointments brought
                # forward by two days instead of thirty.  The two bounds
                # combine: the period says WHICH week, the gain says from WHEN.
                # We keep the later one.
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
                # The recipe remembers the CRITERION, not the people. A period,
                # though, DESIGNATES precise dates: replaying `week 48` on
                # another slot would give the same people, not those of the new
                # slot. The campaign is therefore marked non-replayable — see
                # noter_apport_recette.
                assistant.noter_apport_recette(
                    brouillon, "ligne" if debut else "base", source=source)
            elif mode == "clients":
                # One single question on screen (`which clients?`), two paths
                # behind it: the whole database, or a particular state — and
                # that second path is THE 👥 CONTACTS PAGE'S, not a second
                # version that would have ended up diverging from it.
                choix = champs_formulaire.get("etat_client", "")
                if choix.startswith("etat:"):
                    etat = choix.split(":", 1)[1]
                    # ⚠ contacts_PAR_etat, not contacts_DEPUIS_etat: here we
                    # load the clients in that state, and that is all. The two
                    # conditions of the 👥 Contacts page (the kind must handle
                    # the state, the client must be in no campaign) make no
                    # sense when it is the operator explicitly asking for a
                    # state.
                    nouveaux, complements = etats_clients.contacts_par_etat(
                        base, etat, champs, connus,
                        preferences=self.application.preferences)
                    # The list is a snapshot of today's state: it does not
                    # replay as it stands on another slot.
                    assistant.noter_apport_recette(brouillon, "ligne")
                else:
                    nouveaux, complements = assistant.contacts_depuis_base(
                        base, assistant.SOURCE_TOUS_CLIENTS, champs, connus)
                    assistant.noter_apport_recette(
                        brouillon, "base",
                        source=assistant.SOURCE_TOUS_CLIENTS)
            elif mode == "campagne":
                # Starting again from a previous campaign's RESULTS, filtered
                # by state (the unreachable ones, the refusals, the accepted
                # ones…).
                etat = champs_formulaire.get("etat", "tous")
                # The chosen filter is kept: it is redisplayed IN its fields on
                # return, to chain a second state.
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
        # ⚠ THE CEILING APPLIES HERE, AND ONLY TO WHAT COMES IN. The grid is
        # never trimmed: a row already there — typed by hand, pasted, corrected
        # — is not removed by a ceiling set afterwards. Those present count
        # towards the ceiling, they are not its victims.
        plafond = assistant.plafond_de(brouillon)
        # ⚠ THE ADD POINT COMMON TO EVERY ROUTE (pasting, CSV, calendar,
        # database, states, previous campaign): the filter for those already
        # confirmed is applied HERE, once, rather than once per route
        # (20/08/2026).
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
            # The ceiling is not reached: we say where the shortfall comes from
            # rather than leave an unexplained figure (see manque_au_plafond).
            complements.append(
                assistant.manque_au_plafond(plafond, deja + len(nouveaux)))
        brouillon["contacts"].extend(nouveaux)
        brouillon["erreurs"] = erreurs
        # ⚠ WE COME BACK TO THE GRID as soon as the filling has produced
        # something: it is the grid you want to reread after adding people. On
        # a REFUSAL we stay on the route, with the error and the input — coming
        # back to the grid would have made both disappear.
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

    # --------------------------- before starting: RingBack's calendar WHY THIS
    # REMINDER EXISTS — and why only HERE. The work is twofold (§8.1): an
    # appointment booked or moved on the phone changes RingBack's LOCAL
    # calendar **and** enters the change log the operator carries over into
    # their own software. The whole product therefore rests on that calendar:
    # the slots announced on the phone are deduced from it, and a stale
    # calendar leads to offering slots already taken in real life. This
    # reminder appears ONLY AT THE MOMENT of starting, and nowhere else: a
    # warning you see everywhere is no longer read anywhere. To stay read, it
    # does not ask a hollow question — it carries THE DAY'S FIGURES, drawn from
    # the database, and the start of the list of slots the agent will actually
    # announce. Nothing in it is estimated: what does not exist (no trace of an
    # import) is stated as `unknown`.
    def _fragment_verification_agenda(self, campagne):
        """The calendar-check panel, computed at the instant of the click."""
        base = self.application.base
        preferences = self.application.preferences
        contacts = base.contacts_de_campagne(campagne["id"])
        faits = assistant.verification_agenda(base, preferences, campagne,
                                              contacts)
        reprise = campagne["statut"] == "en pause"
        verbe = "RÉELLEMENT" if self.application.mode_reel else "en simulation"
        # --- the facts, one per line, all drawn from the database ---
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
            # The sentence says exactly what these dates are: the ones the
            # agent is going to announce, or simply the first free ones when
            # the campaign's list was written by hand.
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
        # --- what RingBack OBSERVES itself, stated frankly ---
        bloc_alertes = ""
        if faits["alertes"]:
            elements = "".join(f"<li>{html.escape(a)}</li>"
                               for a in faits["alertes"])
            bloc_alertes = (
                '<div class="erreurs"><strong>⚠ Ce que RingBack constate '
                f"lui-même :</strong><ul>{elements}</ul></div>")
        # --- the button carries what it commits to: the mode and the figures
        # ---
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
        # tabindex=-1: on opening, it is the PANEL that takes focus, not the
        # button — otherwise a second press on Enter would launch the campaign
        # without anything having been read. The gesture stays deliberate.
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
        """Serves the panel alone (a fragment): the element fills, not the page.
        """
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
        """Serves the `appointment dates` panel alone, with the current choice.

        The choice is SAVED into the draft before being rendered: without that,
        changing year then submitting the form would start again from the year
        of the loading — input silently lost.
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
        """Serves the rule panel alone, realigned on the chosen source.

        ⚠ WHAT IS ALREADY TYPED IS KEPT, as for the dates panel: the form's
        source, window, order and ceiling are written into the draft BEFORE
        rendering. Without that, changing source would have silently erased a
        ceiling you had just typed in.

        Nothing is SAVED as a rule for all that: it is the `Enregistrer la
        règle` button that decides, and it alone.
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
        """The date filter kept, cleaned — never an invented value.

        Changing year or week resets what depends on it: a week 53 kept in a
        year that has only 52, or a day kept from another week, would designate
        a period nobody chose.
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
        """(start, end) as ISO text for this filter — (None, None) when there is
        none.
        """
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
        """Serves a campaign's two live zones (a fragment)."""
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
        """During a campaign: the TWO ZONES refresh themselves, alone.

        Three things are worth saying:

        ① A zone is only replaced when it has REALLY changed. Between two
        calls, the page therefore does not move at all — no more permanent
        flickering, no more text selection jumping under the mouse. ② We stop
        as soon as the campaign is no longer `en cours`. The status travels on
        the zone itself: it is the server's answer that decides, not a browser
        assumption. ③ Without JavaScript, nothing happens: the page stays as it
        was on loading, and the browser's ↻ button does the work. No function
        is lost, only the automatic refresh is.
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
        """The click on ▶ Start asks the SERVER for the panel and fills ONLY the
        block provided — the page is never reloaded, and the figures shown are
        those of the instant of the click, not those of the loading.

        Without JavaScript (or if the request fails), the form goes out
        normally: the server refuses the start for want of confirmation and
        returns the page WITH the same panel open. The fallback is complete.
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
        """The change log to CARRY OVER — readable, copyable, exportable.

        A campaign's real deliverable. It is read from the changes table (a row
        written at the moment of the change), never recomputed from the states:
        that is what guarantees no change is lost. Nothing is displayed that
        was not written.
        """
        base = self.application.base
        campagne_id = campagne["id"]
        changements = base.changements_de_campagne(campagne_id)
        # The §8.2 banner: the contact who MODIFIED their appointment,
        # highlighted when the campaign stopped on their yes.
        bandeau = ""
        epargnes = sum(1 for c in contacts if c["etat"] == "épargné")
        mis_en_avant = assistant.changement_mis_en_avant(changements)
        # ⚠ THE DISPLAYED WORD, NOT THE CODE (14/08/2026, cross audit). This
        # sentence wrote `épargné(s)` in plain text, in the very place that
        # explains the state: the table just below said `pas appelé`, so the
        # same page carried two words for one thing — including the one the
        # owner said he did not understand.
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
            # ⚠ AND THERE IS A BANNER EVEN WITH NO MOVE (14/08/2026). The
            # sentence was only written when a ↔ row existed in the log: a
            # campaign concluded by somebody who had NO old appointment (the
            # people waiting for a slot) therefore left its `pas appelé` with
            # not a word of explanation anywhere — the detail column having
            # been removed from the table, nothing was left.
            bandeau = (
                f'<p class="pastille">💤 {epargnes} contact(s) '
                f"{html.escape(mot)}(s), jamais dérangé(s) — la campagne "
                "s'est arrêtée avant eux. La raison est écrite sur chaque "
                "ligne : ouvrez « 🔁 Relances » pour la lire.</p>")
        # The cascade link, when this campaign is one.
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
            # ⚠ THE BANNER STAYS, EVEN WITH NO CHANGE (14/08/2026). A campaign
            # may perfectly well stop on a yes WITHOUT writing anything to the
            # log — somebody who had no appointment to move. Without this line,
            # its `pas appelé` had no explanation anywhere.
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

    # ------------------------------- making up for an absence (the 12-hour
    # threshold)
    def _campagne_sur_le_creneau(self, creneau):
        """THE campaign that already carries this slot, or None. Nothing is
        created.
        """
        for campagne in self.application.base.lister_campagnes():
            if (campagne["creneau"] or "") == creneau:
                return campagne
        return None

    @staticmethod
    def _bandeau_regle_jouee(configuration):
        """What the list rule kept, and what it set aside.

        ⚠ WHY THIS BANNER EXISTS (11/08/2026). The owner set up a campaign on a
        free slot and saw only five people `instead of a lot`. The rule was
        right — a slot only interests those whose appointment is AFTER it — but
        the screen said nothing about the others. A count on its own reads as a
        defect; a count with its reason reads as a decision. Nothing is
        recomputed here: we display what the rule wrote at the moment it was
        played (see assistant.regenerer_la_liste).
        """
        jouee = configuration.get("regle_jouee") or {}
        notes = jouee.get("notes") or []
        if not notes:
            return ""
        return ('<p class="pastille">👥 Liste établie par la règle : '
                f"{jouee.get('retenus', 0)} personne(s) retenue(s). "
                + html.escape(" ; ".join(notes)) + ".</p>")

    def _bloc_places_liberees(self, campagne):
        """The slots a cancellation has freed — and what to do with them.

        THE OWNER'S RULE (31/07/2026), held on screen: a client cancels on the
        phone; if their appointment was more than N hours away (⚙ Réglages, 12
        h by default), it was DELETED, its slot is free and we OFFER here to
        set up the campaign that will fill it. Below the threshold, it stays
        `annulé` and the screen says why a replacement cannot be arranged — the
        operator keeps the link to do it by hand should they wish.

        ⚠ NEVER A SLOT FROM A DAY BEING EMPTIED (17/08/2026). His rule is
        already written for the slots announced on the phone
        (`assistant.jours_a_vider`): `if the practitioner is not there that
        day, no hour of that day is offerable`. This panel did not hold it.
        Measured on his 18/08 day, with the threshold lowered: RingBack offered
        `📞 Préparer la campagne créneau libéré` on 18/08 at 10:00 and at 15:40
        — two slots from the very day the campaign was emptying. We would have
        called people to offer them an appointment on a day when nobody is
        there.

        His 72-hour threshold masked this defect without fixing it: it only
        prevented the OFFER, and the link `do it by hand anyway` was still
        there.

        NO CALL GOES OUT FROM HERE: the button opens the assistant, slot
        pre-filled, at step 2. Everything is read from the change log (the ➖
        and ✖ rows written at the moment of the change) and from the
        appointment's REAL state: nothing is recomputed, nothing is assumed.
        """
        base = self.application.base
        maintenant = datetime.datetime.now().replace(
            second=0, microsecond=0).isoformat(timespec="minutes")
        jours_vides = assistant.jours_a_vider(base, campagne)
        libres, tardives, vus, sur_jour_vide = [], [], set(), []
        for changement in base.changements_de_campagne(campagne["id"]):
            # ⚠ THE TWO KINDS OF REMOVAL (17/08/2026). The log wrote
            # `suppression` even when the appointment stayed `annulé`; now that
            # the kind follows the status, this panel would lose every late
            # cancellation — the very ones it exists to explain — if it read
            # only one of the two.
            if changement["genre"] not in assistant.GENRES_QUI_RETIRENT:
                continue
            if not changement["rendezvous_id"]:
                continue
            rdv = base.obtenir_rendezvous(changement["rendezvous_id"])
            if rdv is None or rdv["id"] in vus:
                continue
            if rdv["horaire"] < maintenant:
                continue  # the slot is past: nothing left to fill
            vus.add(rdv["id"])
            if rdv["horaire"][:10] in jours_vides:
                # The whole day is being emptied: this slot is not to be
                # filled, it is to be left empty. We SAY so rather than keep
                # quiet about it.
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
        """Opens the assistant on a free slot — without calling anybody.

        The gesture is a plain shortcut: a 📞 `créneau libéré` campaign whose
        slot is already filled in. Nothing is created in the database until the
        operator has validated the three steps.

        TWO doors lead here, and that is intended — one mechanism: a campaign's
        summary (making up for a cancellation) and the schedule itself (§5: `I
        have a gap, who can take it?`). The `depuis` field serves only the log.
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
        """Serves the change log as CSV — generated on the fly, never stored.

        The same rule as the product's two other exports: the file is built on
        demand and is written NOWHERE server-side.
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

    # ------------------------------- 📥 the calls that went out with no result
    def _bloc_resultats_en_attente(self, campagne_id, contacts):
        """The `Retrieve pending results` gesture, when there is anything to
        retrieve.

        Nothing to retrieve: nothing is displayed — we do not offer a button
        that would do nothing. Otherwise, the screen says how many calls went
        out without returning their result, and states IN CLEAR that this
        gesture dials no number (that is the question that comes to mind).
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
        """What the retrieval gesture ACTUALLY did, row by row."""
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

    # ------------------------------------------------------ the long detail A
    # detail can run to several hundred characters: the message of an
    # unreadable answer quotes CALL-E's reply. Spread out in a cell, it
    # distorts the table to the point of making it unreadable (observed by the
    # owner on 02/08/2026 on a cascade campaign). The cell therefore shows the
    # BEGINNING, and the rest opens in a window. REMOVED ON 11/08/2026 along
    # with the contacts table's `Détail` column: the clickable abbreviation
    # (LONGUEUR_DETAIL, _en_lignes, _cellule_detail) has nothing left to render
    # — it was the only cell that used it. A contact's detail is now read on 🔁
    # Relances (`Voir sa demande…`) and in the table of 📵 not-reached contacts,
    # which carry it in clear.

    # ------------------------------------------------- poste de pilotage
    def _page_pilotage(self, campagne, parametres=None, fragment=False):
        """An assistant campaign's record: states, counters, commands.

        `fragment`: render only the two live zones, for refreshing during a
        campaign. The SAME code produces both — what you see after an update is
        word for word what you would have seen by reloading the page.
        """
        base = self.application.base
        preferences = self.application.preferences
        campagne_id = campagne["id"]
        configuration = assistant.configuration_campagne(campagne)
        # `fiche_nature` ALSO knows the removed kinds: a campaign from before
        # 03/08/2026 keeps its name and its pictogram.
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
        # 📥 The summary of the retrieval gesture: what was reread, what was
        # not, and why. Kept server-side for the duration of a redirect (see
        # _traiter_recuperation) — never recomputed.
        bilan = self.application.bilans_recuperation.pop(
            parametres.get("recup", [""])[0], None)
        if bilan is not None:
            bloc_message += self._bloc_bilan_recuperation(bilan)
        # A campaign born of the `Préparer une campagne d'essai réel` button:
        # the screen says what was created, what was not (no calls), and where
        # to read what to do next.
        if parametres.get("essai_reel", [""])[0] == "prete":
            repli = parametres.get("repli", ["0"])[0] == "1"
            # The fallback has only one visible cause — `not enough free slots
            # to offer` — and two possible origins: no opening hours
            # configured, or an already full calendar. We state both rather
            # than guess one.
            precision = (" Faute d'assez de places libres (horaires "
                         "d'ouverture non réglés, ou agenda déjà plein), les "
                         "rendez-vous ont été posés DEMAIN MATIN, d'heure en "
                         "heure : réglez vos horaires dans ⚙ Réglages si vous "
                         "voulez de vraies places." if repli else
                         " Les rendez-vous ont été posés sur vos premières "
                         "places réellement libres.")
            # How many testers share the roles: the screen says so, because
            # what comes next (telling each of them their role) depends on it.
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
        # WHY the campaign stopped by itself. Written only when it is a failure
        # on OUR side (key refused, service down, credit exhausted): the text
        # says what did not happen and what to do. A pause requested by hand
        # has no reason — and displays nothing.
        if statut == "en pause" and campagne.get("raison_pause"):
            bloc_message += (
                '<p class="erreurs">⛔ Campagne mise en pause toute seule : '
                f'{html.escape(campagne["raison_pause"])}</p>')
        # A FORCED HOUR IS STATED, it is not guessed. A campaign running
        # outside the permitted hours is an acknowledged exception: it must be
        # readable on its record, today as in three weeks' time. And the
        # sentence falls silent by itself in real calls — because the guard
        # applies again there (see assistant.heure_forcee).
        if assistant.heure_forcee(configuration, self.application.mode_reel):
            bloc_message += (
                '<p class="pastille">Heure forcée : cette campagne a le droit '
                "de tourner hors de la plage d'appel autorisée "
                f"({themes.plage_lisible(preferences)}). C'est possible parce "
                "qu'elle est <strong>simulée</strong> — aucun téléphone ne "
                "sonne. En appels réels, le garde-fou de politesse "
                "s'appliquerait de nouveau.</p>")
        # 📥 THE CALLS ALREADY GONE OUT WHOSE RESULT IS MISSING. The block only
        # exists when there are any: we do not offer a gesture that would have
        # nothing to do. It states in black and white that no number will be
        # dialled.
        bloc_message += self._bloc_resultats_en_attente(campagne_id, contacts)
        # The commands according to the state — pause/stop act between two
        # calls.
        verbe = "RÉELLEMENT" if self.application.mode_reel else "en simulation"
        commandes = []
        if statut == "prête":
            # ⚠ AND THE OPPOSITE GESTURE, ABSENT UNTIL 21/08/2026: closing a
            # prepared campaign you will not launch. Without it, the only way
            # to get rid of one was to START it then close it — that is, to
            # make phones ring for nothing.  WHAT THAT COST, measured in his
            # database: 125 contacts were sleeping in seven `prête` campaigns
            # from 15 and 17/08, whose appointments had since disappeared. He
            # had no gesture at all.
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
        # The `RingBack's calendar is the reference` reminder: empty until ▶
        # has been clicked (the click asks the server for it), already filled
        # when the start has just been refused for want of confirmation — that
        # is the no-JavaScript fallback, and nothing is lost along the way.
        bloc_verification = ""
        if statut in ("prête", "en pause"):
            ouvert = fait == "agenda_a_verifier"
            contenu = (self._fragment_verification_agenda(campagne)
                       if ouvert else "")
            bloc_verification = (
                f'<div id="verification-agenda"{"" if ouvert else " hidden"}>'
                f"{contenu}</div>" + self._script_verification_agenda())
        # ⚠ ONLY THE STATES THAT CONCERN SOMEBODY (30/08/2026, his request:
        # `let the summaries be displayed only when at least one contact is
        # concerned`). They were ALL displayed — it was a decision, `the honest
        # overview`: show the ten states so people know they exist. In use, a
        # finished campaign lined up ten badges, eight of them at zero, and you
        # had to read them all to find the two that say something.  ⚠ WHAT IS
        # LOST, AND IT IS ACCEPTED: the list of possible states is no longer
        # discovered here. It stays complete on 👥 Contacts and in each person's
        # record — this screen says what HAPPENED, not what might have.
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
        # ⚠ NO EMPTY LINE: a campaign with no contact at all has nothing to
        # summarise, and an empty paragraph leaves a blank nobody can explain.
        bloc_compteurs = ('<p style="display:flex;gap:.4rem;flex-wrap:wrap">'
                          + " ".join(compteurs) + "</p>") if compteurs else ""
        exclus = sum(1 for c in contacts if c["etat"] == "exclu")
        bandeau_exclus = ""
        if exclus:
            bandeau_exclus = (f'<p class="erreurs">🚫 {exclus} contact(s) '
                              "exclu(s) — jamais composé(s) — "
                              '<a href="/clients">gérer depuis 👥 Contacts</a>.</p>')
        # ⚠ THE `DÉTAIL` COLUMN NO LONGER EXISTS IN THIS TABLE (his decision of
        # 11/08). Without this banner, a person who refused the agent became
        # one more 🙋 badge, indistinguishable from those the agent could not
        # conclude with — and nothing said there was a call to make yourself.
        refus_agent = sum(1 for c in contacts
                          if db.refus_de_l_agent(c["detail"]))
        if refus_agent:
            bandeau_exclus += (
                f'<p class="erreurs">🚫 {refus_agent} personne(s) ont refusé '
                "d'être appelées par un agent — elles ne l'ont pas été, et "
                "elles attendent qu'un <strong>humain</strong> les rappelle : "
                '<a href="/relances?vue=humains">🔁 Relances</a>.</p>')
        bandeau_exclus += self._bandeau_regle_jouee(configuration)
        # THE `PROCHAIN RDV` COLUMN (owner's request, 11/08/2026): each
        # contact's calendar, read IN A SINGLE PASS rather than one query per
        # row — this page refreshes every 1.5 s during a campaign, and fifty
        # queries per refresh to display fifty dates would have brought
        # nothing.  ⚠ `NEXT` IS READ FROM THE CALENDAR, NOT FROM THE CONTACT'S
        # FROZEN COLUMN. The appointment the campaign copied at its creation
        # (`rdv_existant`) dates from the day the list was built: after a call
        # that moves or cancels, it no longer tells the truth. Here we show
        # what the calendar says NOW — that is the whole point of the column,
        # and it is also why it empties when an appointment is cancelled.
        agendas = base.etat_rendezvous_par_client()
        # ⚠ WHAT THE CAMPAIGN DID TO THE APPOINTMENT, read in a single pass
        # (21/08/2026, his report: `the states are not aligned with the real
        # situation`). On his campaign no. 119, three people carried `📞 le
        # client rappellera` and a DASH in the appointments column — while
        # their appointment had just been CANCELLED. A dash reads as `we do not
        # know`; here we knew, and we kept quiet about it.
        sorts = {}
        for changement in base.changements_de_campagne(campagne_id):
            if changement["genre"] not in assistant.GENRES_QUI_RETIRENT:
                continue
            if changement["contact_id"]:
                sorts[changement["contact_id"]] = changement["ancienne_date"]
        # The display order = the chosen calling order; the position of the `à
        # appeler` ones.
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
            # THIS contact's next appointment, in dd/mm/yyyy hh:mm format. A
            # contact with no client record — a campaign from before the
            # `client_id` column — has no calendar to read: the box stays empty
            # rather than showing the campaign's frozen date, which may have
            # changed.
            prochain = (agendas.get(contact.get("client_id")) or {}).get(
                "prochain") or {}
            prochain_rdv = assistant.date_chiffree(prochain.get("horaire"))
            if not prochain_rdv and contact["id"] in sorts:
                # ⚠ WE SAY WHAT WE DID. The campaign removed this appointment:
                # hiding it behind a dash suggested a discrepancy between the
                # tables — the log announced three cancellations, the list
                # showed none.
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
        # ⚠ AN EMPTY LIST MUST SAY WHY. An AUTOMATIC campaign builds its list
        # from a rule: when the rule found nobody, `Aucun contact` suggested
        # somebody had forgotten to type them in, and ▶ Start would have ended
        # with not a single call and no explanation. We name the rule, and we
        # say it will be replayed.
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
        # ⚠ THE `DÉTAIL` COLUMN IS REMOVED FROM THIS TABLE (11/08/2026), and
        # with it the position in the calling order. The owner's decision,
        # restated: `I asked you to remove the position, not to put it in
        # another column`. The first attempt slipped it under the state badge —
        # that was moving it, not removing it.  WHERE THE DETAIL IS STILL READ,
        # since it is not lost: on 🔁 Relances, `Voir sa demande…` opens it in a
        # window for the contacts waiting for a human (see
        # serveur._lien_demande), and the table of 📵 not-reached contacts
        # carries it in clear. Those are the two screens made for it.
        tableau = ("<table><tr><th>Ordre</th><th>Contact</th><th>Téléphone</th>"
                   "<th>État</th><th>Son rendez-vous</th><th>Tentatives<br>"
                   "<small>dernier appel</small></th><th>Transcription</th></tr>"
                   + "\n".join(lignes) + "</table>") if lignes else \
            f"<p>Aucun contact dans cette campagne.{regle_vide}</p>"
        # Header: the mission and the parameters, expandable.
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
        # The campaign's slot: that of the `créneau libéré` kind, or the one a
        # cascade link took over from a freed slot. It only appears when it
        # exists — never an empty line.
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
            # ⚠ `DUE DATES IN THE TABLE` HAD BECOME FALSE (11/08/2026): the
            # `Détail` column carried them, and it has been removed. So the
            # sentence says where they are really read — a screen pointing to a
            # column that has disappeared is worse than a silent screen.
            note_relances = (
                '<p><small>🔁 Des relances sont programmées. Leurs échéances se '
                "lisent sur la page des relances. L'exécution automatique est "
                '<span class="badge-a-venir">à venir</span> : le geste reste '
                f'le bouton de la page <a href="/relances">🔁 Relances</a>'
                f"{' — ' + str(dues) + ' due(s) maintenant' if dues else ''}.</small></p>")
        # THE TWO ZONES THAT LIVE DURING A CAMPAIGN. Everything that changes
        # from one call to the next is inside; everything that does not change
        # (the mission, the parameters) is OUTSIDE. That is what makes it
        # possible to refresh just those zones, instead of reloading the whole
        # page every 1.5 s — which is what RingBack did until 02/08/2026, with
        # a screen flickering endlessly, the expanded blocks closing again and
        # the reading position lost every time.
        etat = f"""{bloc_message}
<h1>{html.escape(campagne['nom'])}</h1>
<p>{nature['icone']} <strong>{html.escape(nature['nom'])}</strong>
<span class="pastille {classe_statut}">{html.escape(statut)}</span></p>"""
        # ⚠ WHAT HE COMES TO SEE FIRST IS HIS LIST (30/08/2026, his request).
        # Three tables followed one another, and the one he looks at while a
        # campaign is running — the people, one by one — came THIRD. The other
        # two do not talk about the calls in progress: they say what will have
        # to be CARRIED OVER elsewhere, and which slots a cancellation has
        # freed. You read them afterwards, not during.  ⚠ NOTHING IS REMOVED,
        # everything is COLLAPSED. Those two tables carry gestures (copy the
        # log, set up a campaign on a freed slot) and facts that must not be
        # lost: hiding them for good would replay the defect of 21/08, when a
        # removed tab carried off its only button with it. A `details` keeps
        # them one click away — and it works without JavaScript, like the
        # page's other collapsibles. ⚠ THE LOOK OF A LINK, and it is the class
        # the product already has (`repli-geste`, the same as `Saisie manuelle
        # des créneaux`): he asked for `a "see the details" link`, not one more
        # button. The markup copies `serveur._replie` — `assistant_web` cannot
        # import it, since it is `serveur` that imports `assistant_web` and not
        # the reverse. The CLASS, though, stays the only truth about
        # appearance.  ⚠ ALWAYS THERE, EVEN ON A BRAND-NEW CAMPAIGN. The log
        # never returns an empty string: with no change, it writes `nothing has
        # yet moved in the schedule because of this campaign` — and that is
        # precisely what you want to be able to check. A collapsible appearing
        # and disappearing depending on progress would be a screen changing
        # shape before your eyes.
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
        # The mission and the parameters are displayed BETWEEN the two zones,
        # in their usual place — but OUTSIDE: they are expandable blocks, and a
        # block you have just opened must not close because a call finished
        # elsewhere. ⚠ AND WHAT THE MISSION DOES NOT SAY (defect no. 10 of
        # 18/08/2026). The warning also exists at step 2 — but he leaves that
        # screen without coming back to it: it is HERE, in front of ▶ Start,
        # that he must see it. The same rule, the same computation, two places
        # where he looks.
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
        """The `what the message does not say` warning — "" when it says
        everything.

        ⚠ ONE WORDING, TWO SCREENS: step 2 and the campaign's record. He leaves
        step 2 without coming back to it — it is in front of ▶ Start that he
        must see it —, but two texts written separately would have ended up no
        longer saying the same thing.

        ⚠ THE SENTENCE FITS ON ONE LINE in the source. My first version broke
        it for the code's readability: the line break went out into the page,
        and the sentence no longer existed as such — neither for a test, nor
        for anyone searching for those words on screen.
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
        """The two zones that refresh — and what separates them.

        The fragment served for the refresh carries ONLY the two zones: what
        separates them on screen has not moved, and therefore does not have to
        travel.
        """
        return (f'<div id="campagne-etat" data-statut="{html.escape(statut)}">'
                f"{etat}</div>"
                + entre
                + f'<div id="campagne-suite">{suite}</div>')

    # ----------------------------------------------------- the commands
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
        # The permitted calling window AND the forbidden period: the same check
        # as on the four other doors, never duplicated.  ⚠ ONLY THIS DOOR
        # OFFERS TO FORCE, AND ONLY IN SIMULATION (13/08/2026). The gesture is
        # replayed identically — the same fields, plus `forcer_horaire` — and
        # it is `_refus_hors_plage` that decides, not this form: in real calls,
        # the field is ignored.  ⚠ AND THE GESTURE IS NOT ASKED FOR AGAIN AT
        # EVERY RESUMPTION: a campaign already marked `heure forcée` starts
        # again without going back through the button. Without that, pausing
        # then resuming at 10 pm would have asked for the same authorisation
        # again, on the same campaign, for the same reason.
        forcer = (donnees.get("forcer_horaire", [""])[0] == "1"
                  or assistant.heure_forcee(
                      assistant.configuration_campagne(campagne),
                      self.application.mode_reel))
        rejeu = {"action": "/campagne/demarrer", "campagne": campagne_id,
                 "agenda_verifie": donnees.get("agenda_verifie", [""])[0]}
        if self._refus_hors_plage(forcer=forcer, rejeu=rejeu):
            return
        if forcer and not self.application.mode_reel:
            # Written on the campaign: the thread rechecks the window BETWEEN
            # EACH call, and without this trace it would stop at the next
            # contact.
            assistant.noter_heure_forcee(base, campagne_id)
        try:
            # The same `force` as above: the planner rechecks the moment, and
            # it is IT that refuses to lift anything for a real call client —
            # the guarantee does not rest on this form.
            self.application.planif.verifier_garde_fous(
                hors_plage_permis=forcer)
        except planificateur.GardeFou as erreur:
            return self._erreur(403, str(erreur))
        # The conscious gesture: the slots announced on the phone come out of
        # RingBack's calendar, and a stale calendar leads to offering slots
        # already taken elsewhere. Without that confirmation, NOTHING goes out
        # — the page comes back with the day's figures, not with a hollow
        # question. (Placed AFTER the existing locks: a window or guard refusal
        # stays higher priority and unchanged.)
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
        """📥 Goes and READS at CALL-E the result of calls already placed.

        NO CALL GOES OUT FROM HERE: the only call possible on this path is
        assistant.recuperer_resultats_en_attente, which can only do a READ (GET
        /v1/calls/{id}) — not a creation.
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
