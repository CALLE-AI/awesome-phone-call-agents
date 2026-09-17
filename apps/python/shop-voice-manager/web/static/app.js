const ICON_TICK = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">'
  + '<path d="M6.2 10.6 3.8 8.2l-.9.9 3.3 3.3 7-7-.9-.9z" fill="currentColor"/></svg>';
const ICON_PHONE = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.6 2.2 3.1 3.4c-.5.3-.8.8-.7 1.4.4 3 3.8 6.4 6.8 6.8.6.1 1.1-.2 1.4-.7l1.2-2.5-2.6-1.3-1 1.2C7 7.7 6.3 7 5.7 5.8l1.2-1z" fill="currentColor"/></svg>';
"use strict";

const $ = id => document.getElementById(id);
const view = () => $("view");
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const digits = s => String(s).replace(/[^\d]/g, "");
const mask = v => {
  if (v == null || v === "") return "";
  const s = String(v);
  if (s.includes("*")) return s;  // already masked by the API
  const d = digits(s);
  return d.length < 7 ? s : "+" + "*".repeat(Math.max(0, d.length - 4)) + d.slice(-4);
};
const phoneOf = obj => obj.phone_masked || mask(obj.phone_e164 || obj.phone);
const mmss = s => Math.floor(s/60) + ":" + String(Math.floor(s%60)).padStart(2,"0");
/* The styled error box used wherever a call could not be placed — CALL-E's
   own rejection text (e.g. an unsupported region/language pair) can run to
   a full sentence, so it gets a callout instead of a bare colored span. */
const errorCallout = message =>
  '<div class="warnline" style="display:block">' + esc(message) + "</div>";
const CHEV = '<svg class="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* A <select> with no options opens and shuts instantly, which reads as a
   broken control rather than as missing data. These keep every dropdown
   populated even when the server is older than the page and sends nothing. */
function countryList(){
  if((CONFIG.countries || []).length) return CONFIG.countries;
  return (CONFIG.regions || []).map(code => ({
    code: code, name: code, dial: "", currency: "", voice: "",
    blocked: (CONFIG.blocked || []).includes(code),
  }));
}
function currencyList(){
  return (CONFIG.currencies || []).length ? CONFIG.currencies : ["NGN"];
}
function voiceList(){
  if((CONFIG.voices || []).length) return CONFIG.voices;
  return [{id:"english", name:"English", locale:"en", style:"english"}];
}

function countryOf(code){
  return countryList().find(c => c.code === code)
    || {code:code, name:code, dial:"", currency:"", voice:""};
}
function voiceOf(id){ return voiceList().find(v => v.id === id) || null; }
/* A shop stores locale + style. Map the pair back to the single word the form
   offered, so the detail page and the form agree. */
function voiceName(locale, style){
  const hit = voiceList().find(v => v.style === style && v.locale === locale)
           || voiceList().find(v => v.style === style);
  return hit ? hit.name : (style || "English");
}
function niceDate(iso){
  if(!iso) return "–";
  const [y,m,d] = String(iso).slice(0,10).split("-").map(Number);
  return d + " " + MONTHS[m-1] + " " + y;
}
function money(n, cur){
  if(n == null) return "–";
  if(!cur) return Number(n).toLocaleString();
  try{
    return new Intl.NumberFormat(undefined, {style:"currency", currency:cur,
      maximumFractionDigits:0}).format(n);
  }catch(e){
    return cur + " " + Number(n).toLocaleString();
  }
}

async function api(path, options){
  let res;
  try{
    res = await fetch("/api" + path, Object.assign({
      headers:{"Content-Type":"application/json"}
    }, options || {}));
  }catch(e){
    // fetch only rejects when the request never reached a server, so this is
    // always "nothing is listening", never an application error. Say that,
    // rather than passing the browser's "Failed to fetch" through.
    throw new Error("Cannot reach the console server. Is it still running?");
  }
  const body = await res.json().catch(() => ({error:"The server sent a reply this page could not read."}));
  if(!res.ok) throw new Error(body.error || ("The server refused that request (" + res.status + ")."));
  return body;
}

let CONFIG_RAW = null;
let STALE_SERVER = false;
let CONFIG = {live:false, demo:false, regions:[], blocked:[], currencies:[], units:[], countries:[], voices:[]};
let poll = null;

function banner(text, isError){
  return '<div class="banner' + (isError ? " err" : "") + '">' + esc(text) + "</div>";
}
function staleBanner(){
  return STALE_SERVER
    ? banner("This page is newer than the running server, so some lists are "
             + "incomplete. Restart the server to pick them up.", true)
    : "";
}
function modeBanner(){
  if(CONFIG.demo) return banner("Demo mode. Starting a check-in replays a stored call and places no calls.");
  if(!CONFIG.live) return banner("Read only. CALLE_API_KEY is not set on the server, so calls cannot be placed.");
  return "";
}

/* ------------------------------ customers ------------------------------ */
async function pageCustomers(){
  const {customers} = await api("/customers");
  if(!customers.length){
    return modeBanner()
      + '<div class="page-head"><div><h1>Customers</h1><p>No shops yet.</p></div></div>'
      + '<section class="panel"><div class="empty"><p>Add your first shop</p>'
      + "<span>A shop needs a number and recorded consent before it can be called.</span>"
      + '<div><a class="btn" href="#/add">Add a shop</a></div></div></section>';
  }
  const rows = customers.map(c =>
    '<div class="row" data-go="#/customer/' + encodeURIComponent(c.id) + '">'
    + '<div class="row-main"><span class="row-title">' + esc(c.display_name || c.id) + "</span>"
    + '<span class="row-sub">' + phoneOf(c) + " &middot; " + esc(c.region)
    + " &middot; " + esc(c.currency) + "</span></div>"
    + '<div class="row-end">'
    + '<span class="chip ' + (c.calls ? "ok" : c.failed ? "low" : "idle") + '">'
      + (c.calls ? "Active" : c.failed ? "None placed" : "No calls yet") + "</span>"
    + '<div class="row-stat"><span class="v num">' + c.calls + '</span><span class="k">Calls</span></div>'
    + (c.failed ? '<div class="row-stat"><span class="v num" style="color:var(--attn)">'
        + c.failed + '</span><span class="k">Not placed</span></div>' : "")
    + '<div class="row-stat"><span class="v">' + niceDate(c.last_call)
      + '</span><span class="k">' + (c.calls ? "Last call" : "Last tried") + "</span></div>"
    + CHEV + "</div></div>").join("");

  return modeBanner()
    + '<div class="page-head"><div><h1>Customers</h1><p>' + customers.length
    + (customers.length === 1 ? " shop" : " shops") + " registered.</p></div>"
    + '<a class="btn ghost" href="#/add">Add a shop</a></div>'
    + '<section class="panel"><div class="rows">' + rows + "</div></section>";
}

/* ------------------------------ add shop ------------------------------ */
function slugify(v){
  return String(v).toLowerCase().trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function pageAdd(){
  const regions = countryList().map(c =>
    '<option value="' + esc(c.code) + '">' + esc(c.name)
    + (c.dial ? "  +" + esc(c.dial) : "") + "</option>").join("");
  const currencies = currencyList().map(c =>
    '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("");
  const voices = voiceList().map(v =>
    '<option value="' + esc(v.id) + '">' + esc(v.name) + "</option>").join("");
  const units = (CONFIG.units || []).map(u => '<option value="' + esc(u) + '">').join("");

  return staleBanner()
  + '<div class="crumb"><a href="#/customers">Customers</a><span class="sep">/</span><span>Add a shop</span></div>'
  + '<div class="page-head center"><div><h1>Add a shop</h1>'
  + "<p>Consent is recorded here, once.</p></div></div>"
  + '<section class="panel raised">'

  + '<div class="formsec"><h3>The shop</h3>'
    + '<div class="field"><label for="aName">Shop name</label>'
      + '<input class="input" id="aName" placeholder="Alpha Mall" autocomplete="off"></div>'
    + '<div class="field"><label for="aId">Shop ID</label>'
      + '<input class="input" id="aId" placeholder="alpha-mall" autocomplete="off" spellcheck="false">'
      + '<span class="slug" id="aSlug">Filled in from the name. Edit it if you want a different one.</span>'
      + "</div></div>"

  + '<div class="formsec"><h3>Where to call</h3>'
    + '<div class="field"><label for="aPhone">Phone number</label>'
      + '<div class="split"><input class="input num" id="aPhone" placeholder="+234 800 000 0000" inputmode="tel" autocomplete="off">'
      + '<select class="select" id="aRegion" aria-label="Country">' + regions + "</select></div>"
      + '<span class="help" id="aRegionHelp"></span></div>'
    + '<div class="split even">'
      + '<div class="field"><label for="aCur">Currency</label>'
        + '<select class="select" id="aCur">' + currencies + "</select></div>"
      + '<div class="field"><label for="aVoice">What the owner hears</label>'
        + '<select class="select" id="aVoice">' + voices + "</select></div></div>"
    + "</div>"

  + '<div class="formsec"><h3>What to ask about</h3>'
    + '<div class="ptable"><div class="phead"><span>Product</span><span>Unit</span><span></span></div>'
    + '<div id="aProducts"></div></div>'
        + '<button class="addbtn" id="aAdd" type="button">Add another product</button></div>'

  + '<div class="formsec">'
    + '<label class="consent" id="aConsentBox" for="aConsent"><input type="checkbox" id="aConsent">'
    + "<span><b>The owner agreed to these calls</b>"
    + "Tick only if you asked them. This is the record that permits every future call.</span></label></div>"

  + '<div class="formfoot"><button class="btn lg" id="aSave" type="button" disabled>Save shop</button>'
  + '<p class="gate" id="aGate"></p></div></section>';
}

/* Product rows: a two column table so name and unit read as separate things. */
function productRows(hostId, list, onChange){
  const host = $(hostId);
  host.innerHTML = "";
  list.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "prow";

    const n = document.createElement("input");
    n.value = p.name || ""; n.placeholder = "Rice";
    n.setAttribute("aria-label", "Product name");
    n.addEventListener("input", e => { p.name = e.target.value; if(onChange) onChange(); });

    const cell = document.createElement("div");
    cell.className = "unitcell";
    const u = document.createElement("input");
    u.value = p.unit || ""; u.placeholder = "bags";
    u.setAttribute("list", "unitList");
    u.setAttribute("aria-label", "Unit");
    u.addEventListener("input", e => { p.unit = e.target.value; if(onChange) onChange(); });
    cell.appendChild(u);

    const x = document.createElement("button");
    x.type = "button"; x.className = "xbtn";
    x.setAttribute("aria-label", "Remove " + (p.name || "product"));
    x.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
    x.addEventListener("click", () => {
      list.splice(i, 1);
      if(!list.length) list.push({name:"", unit:""});
      productRows(hostId, list, onChange);
      if(onChange) onChange();
    });

    row.append(n, cell, x);
    host.appendChild(row);
  });
}

let addProducts = [];
let slugState = {value:"", ok:false};

function wireAdd(){
  addProducts = [{name:"", unit:""}];
  productRows("aProducts", addProducts, gateAdd);

  // The country implies a currency and a language. Apply them until the
  // operator overrides one, then leave their choice alone.
  let curTouched = false, voiceTouched = false;
  const applyCountry = () => {
    const c = countryOf($("aRegion").value);
    if(!curTouched && c.currency) $("aCur").value = c.currency;
    if(!voiceTouched && c.voice) $("aVoice").value = c.voice;
    if(c.dial) $("aPhone").placeholder = "+" + c.dial + " 800 000 0000";
    $("aRegionHelp").textContent = c.blocked
      ? c.name + " is switched off for this account, so calls to it are refused. "
        + "You can still save the shop."
      : "";
  };

  let slugTimer = null, idTouched = false, checkSeq = 0;

  async function checkSlug(){
    const id = slugify($("aId").value);
    const el = $("aSlug");
    slugState = {value:id, ok:false};
    if(!id){
      el.className = "slug";
      el.textContent = $("aId").value.trim()
        ? "An ID needs at least one letter or number." : "";
      gateAdd(); return;
    }
    const seq = ++checkSeq;
    el.className = "slug";
    el.textContent = "Checking " + id;
    let taken;
    try{ await api("/customers/" + encodeURIComponent(id)); taken = true; }
    catch(e){ taken = false; }
    if(seq !== checkSeq) return;              // a newer keystroke won
    slugState.ok = !taken;
    el.className = "slug " + (taken ? "taken" : "free");
    el.innerHTML = taken
      ? "<code>" + esc(id) + "</code> is already taken, pick another"
      : "<code>" + esc(id) + "</code> is available";
    gateAdd();
  }

  function queueCheck(){ clearTimeout(slugTimer); slugTimer = setTimeout(checkSlug, 250); }

  window.gateAdd = gateAdd;
  function gateAdd(){
    const consent = $("aConsent").checked;
    $("aConsentBox").classList.toggle("on", consent);
    const named = addProducts.filter(p => p.name.trim()).length;
    let reason = "";
    if(!$("aName").value.trim()) reason = "Give the shop a name";
    else if(!slugState.value) reason = "The shop ID cannot be empty";
    else if(!slugState.ok) reason = "That shop ID is taken, pick another";
    else if(digits($("aPhone").value).length < 7) reason = "Add a phone number with its country code";
    else if(!named) reason = "Add at least one product to ask about";
    else if(!consent) reason = "Confirm the owner agreed";
    $("aSave").disabled = !!reason;
    const g = $("aGate");
    g.textContent = reason;
    g.className = "gate" + (reason.indexOf("taken") > -1 ? " bad" : "");
  }

  $("aName").addEventListener("input", () => {
    if(!idTouched) $("aId").value = slugify($("aName").value);
    queueCheck();
    gateAdd();
  });
  $("aId").addEventListener("input", () => {
    idTouched = $("aId").value.trim().length > 0;
    queueCheck();
    gateAdd();
  });
  // normalise on the way out, so what was typed is what gets saved
  $("aId").addEventListener("blur", () => {
    const clean = slugify($("aId").value);
    if(clean !== $("aId").value){ $("aId").value = clean; queueCheck(); }
  });
  $("aPhone").addEventListener("input", gateAdd);
  $("aRegion").addEventListener("change", () => { applyCountry(); gateAdd(); });
  $("aCur").addEventListener("change", () => { curTouched = true; });
  $("aVoice").addEventListener("change", () => { voiceTouched = true; });
  $("aConsent").addEventListener("change", gateAdd);
  $("aAdd").addEventListener("click", () => {
    addProducts.push({name:"", unit:""});
    productRows("aProducts", addProducts, gateAdd);
    const rows = document.querySelectorAll("#aProducts .prow input");
    if(rows.length) rows[rows.length - 2].focus();
    gateAdd();
  });

  $("aSave").addEventListener("click", async () => {
    $("aSave").disabled = true;
    $("aSave").textContent = "Saving";
    try{
      const saved = await api("/customers", {method:"POST", body: JSON.stringify({
        create: true,
        shop_id: slugState.value,
        display_name: $("aName").value.trim(),
        phone: $("aPhone").value.trim(),
        region: $("aRegion").value,
        locale: (voiceOf($("aVoice").value) || {}).locale || "en",
        currency: $("aCur").value,
        voice: $("aVoice").value,
        products: addProducts.filter(p => p.name.trim()),
      })});
      location.hash = "#/customer/" + encodeURIComponent(saved.id);
    }catch(e){
      const g = $("aGate");
      g.textContent = e.message;
      g.className = "gate bad";
      $("aSave").disabled = false;
      $("aSave").textContent = "Save shop";
    }
  });

  applyCountry();
  gateAdd();
}

/* ------------------------------ customer ------------------------------ */
async function pageCustomer(id){
  const [shop, {calls}] = await Promise.all([
    api("/customers/" + encodeURIComponent(id)),
    api("/customers/" + encodeURIComponent(id) + "/calls"),
  ]);
  const history = calls.length ? calls.map(c => {
    // An attempt that never reached the ledger has no result to open, so it
    // states what happened instead of pretending to be a record.
    if(c.outcome === "running"){
      const label = {queued:"Queued", ringing:"Ringing", in_progress:"On the call"}[c.phase] || "Running";
      const chained = c.chain_position > 1
        ? '<span class="chain-badge">Step ' + c.chain_position + " of chain</span>" : "";
      return '<div class="row" data-live="' + esc(c.key || "")
        + '" data-shop="' + esc(shop.id) + '">'
        + '<div class="row-main"><span class="row-title">' + niceDate(c.date) + "</span>"
        + '<span class="row-sub">Call in progress' + chained + "</span></div>"
        + '<div class="row-end">'
        + '<span class="chip ' + (c.call_type === "sales" ? "sal" : "inv") + '">'
        + esc(Chain.chainLabel(c.call_type)) + "</span>"
        + '<span class="chip live-chip">' + esc(label) + "</span>"
        + '<div class="row-stat"><span class="v num">' + mmss(c.elapsed || 0)
        + '</span><span class="k">Elapsed</span></div>' + CHEV + "</div></div>";
    }
    if(c.outcome === "failed"){
      FAILURES[c.call_id] = c;
      return '<div class="row" data-fail="' + esc(c.call_id) + '">'
        + '<div class="row-main"><span class="row-title">' + niceDate(c.date || c.created_at) + "</span>"
        + '<span class="row-sub" style="color:var(--attn)">'
        + esc(c.error || "Abandoned before CALL-E was asked to create the call.")
        + "</span></div>"
        + '<div class="row-end">'
        + '<span class="chip ' + (c.call_type === "sales" ? "sal" : "inv") + '">'
        + esc(Chain.chainLabel(c.call_type)) + "</span>"
        + '<span class="chip low">Not placed</span>' + CHEV + "</div></div>";
    }
    const right = c.revenue != null
      ? '<div class="row-stat"><span class="v num">' + money(c.revenue, shop.currency) + '</span><span class="k">Sales</span></div>'
      : '<div class="row-stat"><span class="v num">' + (c.products || []).length + '</span><span class="k">Items</span></div>';
    return '<div class="row" data-detail="' + esc(c.call_id) + '">'
      + '<div class="row-main"><span class="row-title">' + niceDate(c.date) + "</span>"
      + '<span class="row-sub">' + esc(c.call_id) + "</span></div>"
      + '<div class="row-end">'
      + '<span class="chip ' + (c.call_type === "sales" ? "sal" : "inv") + '">' + esc(c.call_type) + "</span>"
      + (c.low ? '<span class="chip low">' + c.low + " low</span>" : "")
      + (c.accepted ? "" : '<span class="chip low">rejected</span>')
      + right
      + '<div class="row-stat"><span class="v num">' + (c.confidence == null ? "–" : Number(c.confidence).toFixed(2))
      + '</span><span class="k">Conf</span></div>' + CHEV + "</div></div>";
  }).join("")
  : '<div class="empty"><p>No calls yet</p><span>Start a check-in to build this history.</span>'
    + '<div><button class="btn" data-call="' + esc(id) + '">Place check-in call</button></div></div>';

  return '<div class="crumb"><a href="#/customers">Customers</a><span class="sep">/</span><span>'
    + esc(shop.display_name || shop.id) + "</span></div>"
    + '<div class="page-head"><div><h1>' + esc(shop.display_name || shop.id) + "</h1>"
    + "<p>" + phoneOf(shop) + " &middot; " + esc(shop.region) + "</p></div>"
    + '<button class="btn" data-call="' + esc(id) + '">Place check-in call</button></div>'
    + '<div class="grid2"><div class="stack">'
      + '<section class="panel"><div class="panel-head"><h2>Details</h2></div><div class="panel-body">'
      + '<dl class="kv"><dt>Shop ID</dt><dd class="num">' + esc(shop.id) + "</dd>"
      + "<dt>Phone</dt><dd class=\"num\">" + phoneOf(shop) + "</dd>"
      + "<dt>Country</dt><dd>" + esc(countryOf(shop.region).name) + "</dd>"
      + "<dt>Owner hears</dt><dd>" + esc(voiceName(shop.locale, shop.language_style)) + "</dd>"
      + "<dt>Currency</dt><dd>" + esc(shop.currency) + "</dd>"
      + "<dt>Consent</dt><dd>" + (shop.created_at ? niceDate(shop.created_at) : "on file") + "</dd></dl></div></section>"
      + '<section class="panel"><div class="panel-head"><h2>Schedule</h2></div><div class="panel-body">'
      + '<div class="sched"><div class="sched-main"><b>Not scheduled</b>'
      + "<span>Recurring check-ins land after the hackathon.</span></div>"
      + '<button class="btn ghost" disabled>Create</button></div></div></section>'
      + '<section class="panel"><div class="panel-head"><h2>Usual products</h2></div><div class="panel-body">'
      + ((shop.products || []).length
          ? '<div class="pills">' + shop.products.map(p => '<span class="pill"><b>' + esc(p.name) + "</b>"
              + (p.unit ? '<span class="amt">' + esc(p.unit) + "</span>" : "") + "</span>").join("") + "</div>"
          : '<span class="note">None recorded.</span>') + "</div></section>"
    + "</div>"
    + '<section class="panel"><div class="panel-head"><h2>Call history</h2>'
      + '<span class="note">' + (function(){
          const live = calls.filter(c => c.outcome === "running").length;
          const bad  = calls.filter(c => c.outcome === "failed").length;
          const done = calls.length - live - bad;
          const bits = [];
          if(done) bits.push(done + (done === 1 ? " call" : " calls"));
          if(live) bits.push(live + " in progress");
          if(bad)  bits.push(bad + " not placed");
          return bits.length ? bits.join(", ") : "none yet";
        })() + "</span></div>"
      + '<div class="rows">' + history + "</div></section></div>";
}

/* ------------------------------ call detail ------------------------------ */
async function pageCall(id){
  const c = await api("/calls/" + encodeURIComponent(id));
  const cur = c.currency;             // the server resolves this per shop
  const stock = (c.products || []).length
    ? '<div class="cap-grid">' + c.products.map(p =>
        '<div class="cap filled' + (p.running_low ? " low" : "") + '">'
        + '<div class="cap-top"><span class="cap-name">' + esc(p.name) + "</span>"
        + '<span class="chip ' + (p.running_low ? "low" : "ok") + '">' + (p.running_low ? "Low" : "Stocked") + "</span></div>"
        + '<div class="qty"><span class="n num">' + (p.qty == null ? "–" : p.qty)
        + '</span><span class="u">' + esc(p.unit || "") + "</span></div></div>").join("") + "</div>"
    : "";
  const turns = (c.transcript || []).map(t =>
    '<div class="turn ' + esc(t.who) + '"><span class="at">' + mmss(t.at) + "</span>"
    + '<div><div class="bubble"><div class="who">' + (t.who === "bot" ? "CALL-E" : "Owner") + "</div>"
    + esc(t.text) + "</div></div></div>").join("");

  return '<div class="crumb"><a href="#/customers">Customers</a><span class="sep">/</span>'
    + '<a href="#/customer/' + encodeURIComponent(c.shop_id || "") + '">' + esc(c.shop_id || "shop") + "</a>"
    + '<span class="sep">/</span><span>' + niceDate(c.date) + "</span></div>"
    + '<div class="page-head"><div><h1>' + (c.call_type === "sales" ? "Sales call" : "Inventory check-in") + "</h1>"
    + "<p>" + niceDate(c.date) + " &middot; " + esc(c.call_id) + "</p></div>"
    + '<a class="btn ghost" href="#/customer/' + encodeURIComponent(c.shop_id || "") + '">Back to history</a></div>'
    + '<div class="stack">'
    + '<section class="panel"><dl class="metrics">'
      + '<div><dt>Status</dt><dd>' + esc(c.status || "–") + "</dd></div>"
      + '<div><dt>Confidence</dt><dd class="num">' + (c.confidence == null ? "–" : Number(c.confidence).toFixed(2)) + "</dd></div>"
      + '<div><dt>Talk time</dt><dd class="num">' + (c.duration ? mmss(c.duration) : "–") + "</dd></div>"
      + '<div><dt>Ledger</dt><dd>' + (c.accepted ? "accepted" : "rejected") + "</dd></div></dl></section>"
    + (c.notes ? '<div class="notecard"><div class="sub-label">Owner note</div>'
        + '<p class="hand" style="margin:0">' + esc(c.notes) + "</p></div>" : "")
    + (c.revenue != null ? '<section class="panel"><dl class="metrics">'
        + "<div><dt>Sales</dt><dd class=\"num\">" + money(c.revenue, cur) + "</dd></div>"
        + "<div><dt>Restocking</dt><dd class=\"num\">" + money(c.spend || 0, cur) + "</dd></div>"
        + "<div><dt>Gross</dt><dd class=\"num\">" + money((c.revenue || 0) - (c.spend || 0), cur) + "</dd></div>"
        + "</dl></section>" : "")
    + (stock ? '<section class="panel"><div class="panel-head"><h2>Stock</h2>'
        + '<span class="note">' + (c.low || 0) + " running low</span></div>"
        + '<div class="panel-body">' + stock + "</div></section>" : "")
    + ((c.evidence || []).length ? '<section class="panel"><div class="panel-head"><h2>Evidence</h2></div>'
        + '<div class="panel-body"><ul class="evidence">'
        + c.evidence.map(e => "<li>" + esc(e) + "</li>").join("") + "</ul></div></section>" : "")
    + '<section class="panel"><div class="panel-head"><h2>Transcript</h2>'
      + '<span class="note num">' + (c.transcript || []).length + " turns</span></div>"
      + (turns ? '<div class="tscroll scroller">' + turns + "</div>"
               : '<p class="tempty">No transcript stored for this call.</p>') + "</section></div>";
}

/* ------------------------------ new check-in ------------------------------ */
let newProducts = [];
/* ------------------------------ check-in modal ------------------------------
   A check-in is a small, well understood act on a shop that already exists, so
   it is a dialog on the shop, not a page of its own. Consent was recorded when
   the shop was added; this only confirms the cost. */

let modalProducts = [], modalShop = null;

/* Rows stay one line. The reason a call was refused is often a paragraph, so
   it belongs in the dialog rather than stretching the list. */
const FAILURES = {};

/* Rejoin a call that is already running. The run lives on the server, so the
   dialog can attach to it at any time, including from a fresh page load. */
async function openLiveRun(key, shopId){
  if(!key) return;
  const d = $("callModal");
  let shop;
  try{ shop = await api("/customers/" + encodeURIComponent(shopId)); }
  catch(e){ return; }
  $("mTitle").textContent = "Call in progress";
  $("mSub").textContent = shop.display_name || shop.id;
  renderCallLive();
  if(!d.open) d.showModal();
  followInBackground();
  watch(key, shop);
}

function openFailure(id){
  const c = FAILURES[id];
  if(!c) return;
  const d = $("callModal");
  $("mTitle").textContent = "Call not placed";
  $("mSub").textContent = niceDate(c.date || c.created_at) + "  ·  " + (Chain.chainLabel(c.call_type) || "");
  $("mBody").innerHTML =
      '<div class="warnline" style="display:block">'
      + esc(c.error || "Abandoned before CALL-E was asked to create the call.")
      + "</div>"
    + '<dl class="callrow" style="margin-top:16px"><dt>Reached</dt><dd>'
      + esc({create_rejected:"CALL-E refused to create the call",
             reserved:"Never sent to CALL-E",
             create_failed:"CALL-E returned no call id"}[c.phase] || c.phase || "unknown")
      + "</dd></dl>"
    + '<dl class="callrow"><dt>Cost</dt><dd>Nothing. No call was placed.</dd></dl>';
  const canRetry = c.call_type === "order_status" && c.order_id && c.shop_id;
  $("mFoot").innerHTML = (canRetry
      ? '<button class="btn ghost" id="mRetry" type="button">Retry this call</button>' : "")
    + '<span class="spacer"></span>'
    + '<button class="btn" id="mClose" type="button">Close</button>';
  $("mClose").addEventListener("click", closeCall);
  if(canRetry) $("mRetry").addEventListener("click", () => retryOrderStatus(c));
  if(!d.open) d.showModal();
}

/* The vendor call already succeeded — this only re-fires the owner callback,
   reusing the outcome already on file, never redialling the vendor. */
async function retryOrderStatus(c){
  let shop;
  try{ shop = await api("/customers/" + encodeURIComponent(c.shop_id)); }
  catch(e){ return; }
  renderCallLive();
  followInBackground();
  try{
    const {key} = await api("/orders/" + encodeURIComponent(c.order_id) + "/retry-status",
      {method: "POST"});
    watch(key, shop);
  }catch(e){
    $("beacon").className = "beacon failed";
    renderPhases("failed");
    $("statusNow").textContent = "Not placed";
    $("statusSub").textContent = "";
    $("resultBody").innerHTML = errorCallout(e.message);
  }
}

/* A finished call opens in the dialog too. Navigating to a page lost the
   operator's place in the shop, and the shop is the context that makes the
   call mean anything. #/call/<id> still works as a deep link. */
async function openCallDetail(callId){
  const d = $("callModal");
  $("mTitle").textContent = "Call detail";
  $("mSub").textContent = callId;
  $("mBody").innerHTML = '<p class="loading">Loading</p>';
  $("mFoot").innerHTML = '<span class="spacer"></span>'
    + '<button class="btn ghost" id="mClose" type="button">Close</button>';
  $("mClose").addEventListener("click", closeCall);
  if(!d.open) d.showModal();

  let c;
  try{ c = await api("/calls/" + encodeURIComponent(callId)); }
  catch(e){
    $("mBody").innerHTML = '<p class="note" style="color:var(--attn)">'
      + esc(e.message) + "</p>";
    return;
  }

  $("mTitle").textContent = c.call_type === "sales" ? "Sales call" : "Inventory check-in";
  $("mSub").textContent = niceDate(c.date) + "  ·  " + (c.call_id || "");

  const stock = (c.products || []).length
    ? '<div class="sub-label" style="margin-top:18px">Stock</div><div class="cap-grid">'
      + c.products.map(pr =>
          '<div class="cap filled' + (pr.running_low ? " low" : "") + '">'
          + '<div class="cap-top"><span class="cap-name">' + esc(pr.name) + "</span>"
          + '<span class="chip ' + (pr.running_low ? "low" : "ok") + '">'
          + (pr.running_low ? "Low" : "Stocked") + "</span></div>"
          + '<div class="qty"><span class="n num">' + (pr.qty == null ? "–" : pr.qty)
          + '</span><span class="u">' + esc(pr.unit || "") + "</span></div></div>").join("")
      + "</div>"
    : "";

  const turns = (c.transcript || []).map(t =>
    '<div class="turn ' + esc(t.who) + '"><span class="at">' + mmss(t.at) + "</span>"
    + '<div><div class="bubble"><div class="who">'
    + (t.who === "bot" ? "CALL-E" : "Owner") + "</div>" + esc(t.text)
    + "</div></div></div>").join("");

  $("mBody").innerHTML =
      '<dl class="callrow"><dt>Status</dt><dd>' + esc(c.status || "unknown") + "</dd></dl>"
    + '<dl class="callrow"><dt>Confidence</dt><dd class="num">'
      + (c.confidence == null ? "–" : Number(c.confidence).toFixed(2)) + "</dd></dl>"
    + '<dl class="callrow"><dt>Talk time</dt><dd class="num">'
      + (c.duration ? mmss(c.duration) : "–") + "</dd></dl>"
    + '<dl class="callrow"><dt>Ledger</dt><dd>'
      + (c.accepted ? "accepted" : "rejected") + "</dd></dl>"
    + (c.notes ? '<div class="notecard" style="margin-top:18px">'
        + '<div class="sub-label">Owner note</div>'
        + '<p class="hand" style="margin:0">' + esc(c.notes) + "</p></div>" : "")
    + stock
    + ((c.evidence || []).length
        ? '<div class="sub-label" style="margin-top:18px">Evidence</div>'
          + '<ul class="evidence">' + c.evidence.map(e => "<li>" + esc(e) + "</li>").join("")
          + "</ul>" : "")
    + (turns
        ? '<div class="sub-label" style="margin-top:18px">Transcript</div>' + turns
        : '<p class="tempty">No transcript stored for this call.</p>');

  $("mFoot").innerHTML =
      '<a class="fineprint" href="#/call/' + encodeURIComponent(c.call_id)
      + '" style="color:var(--accent-ink);font-weight:600">Open as a page</a>'
    + '<span class="spacer"></span>'
    + '<button class="btn" id="mClose" type="button">Close</button>';
  $("mClose").addEventListener("click", closeCall);
}

function closeCall(){
  clearInterval(poll); poll = null;
  const d = $("callModal");
  if(d && d.open) d.close();
}

let modalToday = {calls:[], dialled:{}};

async function openCall(shopId){
  const d = $("callModal");
  modalShop = await api("/customers/" + encodeURIComponent(shopId));
  try{ modalToday = await api("/customers/" + encodeURIComponent(shopId) + "/today"); }
  catch(e){ modalToday = {calls:[], dialled:{}}; }
  modalProducts = (modalShop.products || []).map(p => ({name:p.name, unit:p.unit || ""}));
  if(!modalProducts.length) modalProducts = [{name:"", unit:""}];
  renderCallForm();
  if(!d.open) d.showModal();
}

function renderCallForm(){
  const s = modalShop;
  const offline = CONFIG.blocked.includes(s.region);
  $("mTitle").textContent = "Place check-in call";
  $("mSub").textContent = s.display_name || s.id;

  $("mBody").innerHTML =
      '<dl class="callrow"><dt>Number</dt><dd class="num">' + phoneOf(s) + "</dd></dl>"
    + '<dl class="callrow"><dt>Country</dt><dd>' + esc(s.region) + "</dd></dl>"
    + '<dl class="callrow"><dt>Owner hears</dt><dd>'
      + esc(voiceName(s.locale, s.language_style)) + "</dd></dl>"
    + '<dl class="callrow"><dt>Call type</dt><dd style="font-weight:400;width:230px">'
      + '<select class="select" id="mType">'
      + '<option value="inventory">Morning inventory check-in</option>'
      + '<option value="sales">Evening sales recap</option></select></dd></dl>'
    + '<div style="margin-top:18px"><div class="sub-label">Ask about</div>'
      + '<div class="ptable"><div class="phead"><span>Product</span><span>Unit</span><span></span></div>'
      + '<div id="mProducts"></div></div>'
      + '<p class="help" style="margin:8px 0 0">Unit is descriptive. Type whatever the owner '
      + "says: kegs, half bags, paint rubbers.</p>"
      + '<button class="addbtn" id="mAdd" type="button">Add another product</button></div>'
    + (offline ? '<div class="warnline" style="margin-top:16px">' + esc(s.region)
        + " is switched off for this account, so CALL-E will refuse the call.</div>" : "")
    + '<div class="consent-note">' + ICON_TICK + "<span>Consent recorded "
      + (s.created_at ? niceDate(s.created_at) : "when the shop was added") + "</span></div>";

  $("mFoot").innerHTML =
      '<span class="fineprint" id="mFine">Rings a real person and spends one call.</span>'
    + '<span class="spacer"></span>'
    + '<button class="btn ghost" id="mCancel" type="button">Cancel</button>'
    + '<button class="btn" id="mGo" type="button">' + ICON_PHONE + "Call now</button>";

  $("mType").addEventListener("change", gateCall);
  productRows("mProducts", modalProducts, gateCall);
  $("mAdd").addEventListener("click", () => {
    modalProducts.push({name:"", unit:""});
    productRows("mProducts", modalProducts, gateCall);
    gateCall();
  });
  $("mCancel").addEventListener("click", closeCall);
  $("mGo").addEventListener("click", startCall);
  gateCall();
}

function alreadyCalledToday(){
  const type = $("mType") ? $("mType").value : "inventory";
  // `dialled` comes from the checkpoints, so it stays true even if the ledger
  // was cleared. That is the honest answer: the phone still rang.
  return !!(modalToday.dialled || {})[type]
    || (modalToday.calls || []).some(c => c.call_type === type);
}

function gateCall(){
  const go = $("mGo");
  if(!go) return;
  const named = modalProducts.filter(p => p.name.trim()).length;
  const offline = CONFIG.blocked.includes(modalShop.region);
  const stopped = !CONFIG.live && !CONFIG.demo;
  const repeat = alreadyCalledToday();
  let reason = "";
  if(offline) reason = modalShop.region + " is switched off for this account";
  else if(!named) reason = "Add at least one product";
  else if(stopped) reason = "The server has no API key, so it cannot dial";
  go.disabled = !!reason;
  go.innerHTML = ICON_PHONE + (repeat ? "Call again" : "Call now");
  $("mFine").textContent = reason
    || (repeat ? "This shop was already dialled today. This places another call."
               : "Rings a real person and spends one call.");
  $("mFine").style.color = reason ? "var(--attn)" : "";
}

function renderCallLive(){
  $("mBody").innerHTML =
      '<div class="status" style="padding:4px 0 14px">'
      + '<span class="beacon live" id="beacon"></span>'
      + '<span class="state-label"><span class="now" id="statusNow">Queued</span>'
      + '<span class="sub" id="statusSub">Sending the task to CALL-E</span></span>'
      + '<span class="clock num" id="clock">0:00</span></div>'
    + '<div class="phases" id="phases" style="padding:0 0 6px"></div>'
    + '<div id="chainTrail"></div>'
    + '<div class="note" id="resultBody" style="margin:10px 0 0"></div>';
  $("mFoot").innerHTML =
      '<span class="fineprint">Leaving this open is not required, the call runs on the server.</span>'
    + '<span class="spacer"></span>'
    + '<button class="btn ghost" id="mClose" type="button">Close</button>';
  $("mClose").addEventListener("click", closeCall);
  renderPhases("queued");
}

async function startCall(){
  const shop = modalShop;
  const type = $("mType").value;
  const products = modalProducts.filter(p => p.name.trim());
  const repeat = alreadyCalledToday();
  renderCallLive();
  followInBackground();
  try{
    const {key} = await api("/checkins", {method:"POST", body: JSON.stringify({
      shop_id: shop.id, call_type: type, products: products, consent: true,
      again: repeat,
    })});
    watch(key, shop);
  }catch(e){
    $("beacon").className = "beacon failed";
    renderPhases("failed");
    $("statusNow").textContent = "Not placed";
    $("statusSub").textContent = "";
    $("resultBody").innerHTML = errorCallout(e.message);
    // renderCallLive() already wired mFoot's Close button; nothing else to do.
  }
}

/* Tracks every leg the auto-chain fires from `key`, not just `key` itself.
   Each tick re-fetches every leg discovered so far (Chain.discoverChain
   follows next_keys as the server reports them), lets Chain pick which one
   is "active", and renders that leg's phase strip plus a trail of the whole
   chain underneath it — see chain.js. */
let chainRuns = {};

function watch(key, shop){
  clearInterval(poll);
  chainRuns = {};
  poll = setInterval(async () => {
    if(!$("clock")){ clearInterval(poll); return; }

    const order = Chain.discoverChain(chainRuns, key);
    try{
      const fetched = await Promise.all(order.map(k =>
        (chainRuns[k] && chainRuns[k].done) ? chainRuns[k] : api("/checkins/" + k)));
      order.forEach((k, i) => { chainRuns[k] = fetched[i]; });
    }catch(e){ clearInterval(poll); return; }

    const full = Chain.discoverChain(chainRuns, key);   // a fetch may have found new next_keys
    const activeKey = Chain.activeLeg(full, chainRuns);
    const run = chainRuns[activeKey];

    $("mTitle").textContent = Chain.chainLabel(run.call_type);
    $("clock").textContent = mmss(run.elapsed || 0);
    renderPhases(run.phase);
    $("beacon").className = "beacon" + (
        run.phase === "completed" ? " done"
      : run.phase === "failed"    ? " failed"
      : run.phase === "ringing"   ? " waiting"
      : run.phase === "queued"    ? " waiting"
      :                             " live");
    $("statusNow").textContent = Chain.chainStatusText(run);
    $("statusSub").textContent =
        run.phase === "ringing"   ? "Dialing " + run.masked_phone
      : run.phase === "failed"    ? ""
      : run.phase === "completed" ? "Call ended"
      : (shop.display_name || shop.id) + " on the line";
    const trail = $("chainTrail");
    if(trail) trail.innerHTML = Chain.renderTrail(full, chainRuns, activeKey, esc);

    if(Chain.allDone(full, chainRuns)){
      clearInterval(poll);
      clearInterval(bgTimer); bgTimer = null;
      render();                       // land the final row behind the dialog
      const cid = (run.result && run.result.call_id) || run.call_id;
      if(run.error){
        $("resultBody").innerHTML = errorCallout(run.error);
      }else{
        $("resultBody").innerHTML = esc((run.result && run.result.verdict) || "Done")
          + (cid ? ' <a href="#/call/' + encodeURIComponent(cid)
              + '" style="color:var(--accent-ink);font-weight:600">View details</a>' : "");
      }
      if(full.some(k => chainRuns[k] && chainRuns[k].chain_capped)){
        $("resultBody").innerHTML += '<div class="warnline" style="display:block;margin-top:10px">'
          + "Chain stopped at " + full.length + " calls (this session's cap).</div>";
      }
      $("mFoot").innerHTML = '<span class="spacer"></span>'
        + '<button class="btn" id="mClose" type="button">Done</button>';
      $("mClose").addEventListener("click", () => { closeCall(); route(); });
    }
  }, 1000);
}

/* Each step gets a colour for what it means, so the strip reads at a glance
   without waiting to see which dot is pulsing. */
const PHASE_TONE = {queued:"queued", ringing:"ringing", in_progress:"active",
                    completed:"finished", failed:"failed"};

function renderPhases(active){
  const host = $("phases");
  if(!host) return;
  const P = [["queued","Queued"], ["ringing","Ringing"],
             ["in_progress","On the call"], ["completed","Done"]];
  const failed = active === "failed";
  // a failed call stops wherever it got to; nothing after it is "done"
  const idx = failed ? -1 : P.findIndex(x => x[0] === active);
  const tone = PHASE_TONE[active] || "queued";

  host.innerHTML = P.map((x, i) => {
    const state = i === idx ? " on " + tone : i < idx ? " past" : "";
    const gapDone = i < idx ? " done" : "";
    return '<span class="phase' + state + '"><span class="pip"></span>' + x[1] + "</span>"
      + (i < P.length - 1 ? '<span class="phase-gap' + gapDone + '"></span>' : "");
  }).join("");

  if(failed){
    // mark the strip as stopped rather than pretending it is still queued
    host.insertAdjacentHTML("beforeend",
      '<span class="phase on failed" style="margin-left:12px">'
      + '<span class="pip"></span>Stopped</span>');
  }
}

/* ------------------------------ schedule ------------------------------ */
async function pageSchedule(){
  const {customers} = await api("/customers");
  const rows = customers.length ? customers.map(c =>
    '<div class="row" style="cursor:default"><div class="row-main">'
    + '<span class="row-title">' + esc(c.display_name || c.id) + "</span>"
    + '<span class="row-sub">' + phoneOf(c) + "</span></div>"
    + '<div class="row-end"><span class="chip idle">Not scheduled</span>'
    + '<button class="btn ghost" disabled>Create</button></div></div>').join("")
    : '<div class="empty"><p>No shops yet</p><span>Add a shop to schedule it.</span></div>';
  return '<div class="page-head"><div><h1>Schedule</h1>'
    + "<p>Recurring check-ins are stubbed for the hackathon. These buttons are inert.</p></div></div>"
    + '<section class="panel"><div class="panel-head"><h2>Shops</h2>'
    + '<span class="note">Placeholder</span></div><div class="rows">' + rows + "</div></section>";
}

/* ------------------------------ router ------------------------------ */
async function render(){
  const raw = (location.hash || "#/customers").replace(/^#\//, "");
  const [pathPart, queryPart] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean);
  const query = new URLSearchParams(queryPart || "");
  let nav = parts[0] || "customers";
  view().className = "wrap";
  view().innerHTML = '<p class="loading">Loading</p>';
  try{
    if(parts[0] === "customer" && parts[1]){ view().innerHTML = await pageCustomer(decodeURIComponent(parts[1])); nav = "customers"; }
    else if(parts[0] === "call" && parts[1]){ view().innerHTML = await pageCall(decodeURIComponent(parts[1])); nav = "customers"; }
    else if(parts[0] === "add"){ view().className = "wrap narrow"; view().innerHTML = pageAdd(); wireAdd(); nav = "customers"; }
    else if(parts[0] === "schedule"){ view().innerHTML = await pageSchedule(); }
    else { view().innerHTML = await pageCustomers(); nav = "customers"; }
  }catch(e){
    view().innerHTML = banner(e.message, true)
      + '<section class="panel"><div class="empty"><p>Could not load this page</p>'
      + '<div><a class="btn ghost" href="#/customers">Back to customers</a></div></div></section>';
  }
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.nav === nav));
}

async function route(){
  closeCall();
  await render();
  window.scrollTo(0, 0);
}

/* Re-render the page underneath while a call runs. The dialog lives outside
   #view, so replacing the view does not disturb it. */
let bgTimer = null;
function followInBackground(){
  clearInterval(bgTimer);
  bgTimer = setInterval(() => {
    if(!$("callModal").open){ clearInterval(bgTimer); bgTimer = null; return; }
    render();
  }, 2000);
}

document.addEventListener("click", e => {
  const call = e.target.closest("[data-call]");
  if(call){ e.stopPropagation(); openCall(call.dataset.call); return; }
  const live = e.target.closest("[data-live]");
  if(live && live.dataset.live){
    e.stopPropagation(); openLiveRun(live.dataset.live, live.dataset.shop); return;
  }
  const fail = e.target.closest("[data-fail]");
  if(fail){ e.stopPropagation(); openFailure(fail.dataset.fail); return; }
  const detail = e.target.closest("[data-detail]");
  if(detail && !e.target.closest("a")){
    e.stopPropagation(); openCallDetail(detail.dataset.detail); return;
  }
  const row = e.target.closest("[data-go]");
  if(row && !e.target.closest("button") && !e.target.closest("a")) location.hash = row.dataset.go;
});
window.addEventListener("hashchange", route);

(async () => {
  try{ CONFIG_RAW = await api("/config"); CONFIG = Object.assign({}, CONFIG, CONFIG_RAW); }
  catch(e){ CONFIG_RAW = null; }
  STALE_SERVER = !CONFIG_RAW
    || !(CONFIG_RAW.countries || []).length
    || !(CONFIG_RAW.voices || []).length;
  $("mX").addEventListener("click", closeCall);
  $("callModal").addEventListener("close", () => { clearInterval(poll); poll = null; });
  $("unitList").innerHTML = (CONFIG.units || [])
    .map(u => '<option value="' + esc(u) + '">').join("");
  route();
})();
