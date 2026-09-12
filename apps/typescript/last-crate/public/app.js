const app = document.querySelector("#app");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  phone:
    '<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5Z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  box: '<path d="m3 7 9-4 9 4v11l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v11M7 5l10 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  down: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.box}</svg>`;
let config = {},
  runs = [],
  current = null,
  view = "new",
  tab = "activity",
  mode = "fixture",
  submitting = false,
  lastSignature = "",
  polling = false;
let token = sessionStorage.getItem("lastcrate-token") || "";
async function api(path, method = "GET", data) {
  const res = await fetch("/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const out = await res.json();
  if (!res.ok) throw Error(out.error || "Request failed.");
  return out;
}
function toast(msg) {
  const t = document.querySelector("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 5500);
}
const labels = {
  calling_donor: "Verifying offer",
  matching: "Finding a collector",
  calling_partner: "Confirming collection",
  agreed: "Pickup agreed",
  review: "Needs attention",
  declined: "Partner declined",
  paused: "Connection paused",
  expired: "Window expired",
  stopped: "Stopped",
  collected: "Collection recorded",
};
const active = (r) =>
  ["calling_donor", "matching", "calling_partner"].includes(r?.state);
function header() {
  return `<aside class="sidebar"><a class="brand" href="/" aria-label="Last Crate home"><span class="brandmark">L<span>c</span></span><span>last crate<span class="branddot">.</span></span></a><div class="workspace-label">THE COLLECTION DESK</div><button class="nav ${view === "new" ? "selected" : ""}" data-action="new">${icon("plus")} New handoff</button><div class="recent-label">RECENT HANDOFFS <span>${runs.length}</span></div><div class="recent">${
    runs.length
      ? runs
          .slice(0, 6)
          .map(
            (r) =>
              `<button class="recent-item ${current?.id === r.id && view === "run" ? "selected" : ""}" data-run="${r.id}"><span class="mini-crate">${icon("box")}</span><span><strong>${esc(r.input.donor)}</strong><small>${esc(labels[r.state])}</small></span>${icon("chevron")}</button>`,
          )
          .join("")
      : '<p class="empty-history">Your next handoff starts here.</p>'
  }</div><div class="sidebar-bottom"><div class="powered">${icon("phone")} PHONE WORK BY <strong>CALL-E</strong></div><p>One offer. One collector.<br>A clear commitment.</p><a href="https://github.com/CALLE-AI/awesome-phone-call-agents" target="_blank" rel="noreferrer">Built for Your Code Is Calling ↗</a></div></aside><main><header class="topbar"><span>WORKSPACE <span class="slash">/</span> Closing-time collections</span><span class="quota">${config.hasKey ? "CALL-E key configured" : "Fixtures ready"} <span class="quota-sep">|</span> ${config.used || 0} / ${config.cap || 4} live calls reserved</span></header>`;
}
const end = () => "</main>";
function field(label, name, value, type = "text", extra = "") {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function newView() {
  const date = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Colombo",
  });
  return `<section class="page"><div class="page-heading"><div><div class="eyebrow">SURPLUS → PICKUP</div><h1>Good bread.<br><span>Somewhere to go.</span></h1><p class="intro">Turn a closing-time surplus into a confirmed collection.<br>Last Crate makes the calls and closes the loop.</p></div><div class="mode-switch" aria-label="Calling mode"><button data-mode="fixture" class="${mode === "fixture" ? "on" : ""}">Rehearsal</button><button data-mode="live" class="${mode === "live" ? "on" : ""}">${icon("phone")} Real calls</button></div></div><div class="mode-banner ${mode === "live" ? "live" : ""}">${icon(mode === "live" ? "phone" : "box")}<span><strong>${mode === "live" ? (config.roleplay ? "Real phone calls · supervised role-play" : "Real pickup coordination") : "Rehearsal mode · no calls, no credits"}</strong>${mode === "live" ? (config.roleplay ? "Two calls to your authorized contacts. No actual food collection is arranged." : "Confirm surplus and arrange collection with your approved partner.") : "A fictional bakery and collection roster. Try the complete handoff in seconds."}</span><span class="badge">${mode === "live" ? (config.roleplay ? "LIVE TEST" : "LIVE") : "FIXTURE"}</span></div><form id="handoff-form"><div class="new-grid"><div class="form-stack"><section class="panel"><div class="panel-heading"><span class="step-number">01</span><h2>The surplus</h2><span class="muted">Reported, not yet verified</span></div><div class="panel-body"><div class="row two">${field("Bakery", "donor", "Flour & Field")}${field("Estimated loaves", "quantity", 48, "number", 'min="1" max="500" required')}</div>${field("Collection address", "address", "18 Mill Road, rear collection door", "text", "required")}<div class="row three">${field("Collection date", "date", date, "date", "required")}${field("Ready from", "ready", "17:30", "time", "required")}${field("Collect by", "cutoff", "18:30", "time", "required")}</div><div class="bread-note">${icon("box")} Plain bread only · donor packaging · no perishable fillings</div>${mode === "live" ? `<div class="row two">${field("Bakery phone · E.164", "phone", "", "tel", 'placeholder="+94…" required')}${field("Country code", "region", "LK", "text", 'maxlength="2" required')}</div><label class="field"><span>Call language</span><select name="locale"><option value="en-US">English</option><option value="si-LK">Sinhala · TTS role-play option</option><option value="ta-LK">Tamil</option></select></label>` : ""}${field("UTC offset for collection times", "offset", "+05:30", "text", 'pattern="[+-][0-9]{2}:[0-9]{2}" required')}<div class="timezone">For example: Sri Lanka +05:30, Singapore +08:00. Use the offset for the collection date.</div></div></section><section class="panel"><div class="panel-heading"><span class="step-number">02</span><h2>The collection roster</h2><span class="muted">Known, approved partners</span></div><div class="panel-body roster-body"><p class="section-help">The closest partner with enough capacity gets the call. Travel times are coordinator estimates.</p>${[
    { name: "Neighbour Table", capacity: 60, travel: 12 },
    { name: "Westside Community Kitchen", capacity: 30, travel: 8 },
  ]
    .map(
      (p, i) =>
        `<div class="partner-form"><div class="partner-index">${String(i + 1).padStart(2, "0")}</div><div class="partner-fields">${field("Partner name", `partner${i}`, p.name, "text", "required")}<div class="row two">${field("Capacity · loaves", `capacity${i}`, p.capacity, "number", 'min="1" max="500" required')}${field("Travel · minutes", `travel${i}`, p.travel, "number", 'min="1" max="120" required')}</div>${mode === "live" ? field("Partner phone · E.164", `phone${i}`, "", "tel", 'placeholder="+94…" required') : ""}</div></div>`,
    )
    .join(
      "",
    )}</div></section></div><aside class="plan-card"><div class="eyebrow">THE HANDOFF PLAN</div><h2>Two calls.<br>One less loose end.</h2><ol class="plan-steps"><li><span>${icon("phone")}</span><div><strong>Verify the offer</strong><p>Confirm the actual quantity, collection window, and permission to set it aside.</p></div></li><li><span>${icon("check")}</span><div><strong>Find a feasible match</strong><p>Check capacity and travel time before dialing anyone else.</p></div></li><li><span>${icon("phone")}</span><div><strong>Get a commitment</strong><p>Agree the full quantity, arrival time, and collection transport.</p></div></li><li><span>${icon("box")}</span><div><strong>Issue the pickup ticket</strong><p>One assigned collector, with both sides’ call evidence attached.</p></div></li></ol><div class="plan-footer">A completed call isn’t a completed pickup.<br>We only issue a ticket when the details fit.</div></aside></div><div class="launch-bar"><div>${mode === "fixture" ? `<label class="scenario-label">Rehearsal scenario <select name="scenario"><option value="happy">Successful handoff</option><option value="declined">Collector declines</option><option value="unclear">Unclear bakery offer</option><option value="window">Collector misses the cutoff</option><option value="no-answer">Bakery does not answer</option></select></label>` : '<label class="consent"><input type="checkbox" name="authorized" required> I authorize these calls and the displayed pickup scope with contacts who agreed to receive them.</label><input type="hidden" name="scenario" value="happy">'}</div><button class="button primary" type="submit" ${mode === "live" && !config.liveEnabled ? "disabled" : ""}>${mode === "fixture" ? "Run the rehearsal" : "Start two real calls"} ${icon("arrow")}</button></div>${mode === "live" && !config.liveEnabled ? '<p class="inline-note">Enable live calls and authorized numbers in the server’s .env file.</p>' : ""}</form></section>`;
}
function stepStatus(r, i) {
  if (i === 0)
    return r.offer
      ? "done"
      : r.state === "calling_donor"
        ? "current"
        : "waiting";
  if (i === 1)
    return r.selected ? "done" : r.state === "matching" ? "current" : "waiting";
  if (i === 2)
    return r.ticket
      ? "done"
      : r.state === "calling_partner"
        ? "current"
        : "waiting";
  return r.ticket ? "done" : "waiting";
}
function runView(r) {
  const success = !!r.ticket;
  const isActive = active(r);
  return `<section class="page run-page"><div class="run-heading"><div><div class="eyebrow">HANDOFF ${esc(r.id.slice(0, 6).toUpperCase())} <span>· ${r.input.mode === "fixture" ? (r.provenance === "live-recording-replay" ? "RECORDED REPLAY · NO CALLS" : "SYNTHETIC REHEARSAL") : r.roleplay ? "REAL CALL ROLE-PLAY" : "LIVE PICKUP"}</span></div><h1>${success ? "A collector. A time." : isActive ? "Closing the loop." : "A handoff needs you."}<br><span>${success ? "A plan that holds." : esc(r.input.donor) + "."}</span></h1></div><span class="status-pill ${success ? "success" : isActive ? "progress" : "attention"}">${icon(success ? "check" : isActive ? "phone" : "clock")}${esc(labels[r.state])}</span></div><div class="journey">${["Verify offer", "Match collector", "Confirm pickup", "Issue ticket"].map((s, i) => `<div class="journey-step ${stepStatus(r, i)}"><span>${stepStatus(r, i) === "done" ? icon("check") : String(i + 1).padStart(2, "0")}</span><strong>${s}</strong></div>`).join("")}</div><div class="run-grid"><div class="run-main"><section class="offer-strip"><div class="offer-icon">${icon("box")}</div><div class="offer-quantity">${r.offer?.quantity ?? r.input.quantity}<span>loaves ${r.offer ? "confirmed" : "reported"}</span></div><div class="offer-meta"><strong>${esc(r.input.donor)}</strong><span>${icon("pin")}${esc(r.input.address)}</span></div><div class="offer-window"><span>COLLECTION WINDOW</span><strong>${esc(r.offer?.ready ?? r.input.ready)} — ${esc(r.offer?.cutoff ?? r.input.cutoff)}</strong><small>${esc(r.input.date)} · UTC${esc(r.input.offset)}</small></div></section>${r.reason ? `<div class="reason-card">${icon("clock")}<div><strong>${esc(labels[r.state])}</strong><p>${esc(r.reason)}</p>${r.state === "paused" ? '<button class="button small" data-action="resume">Resume saved call</button>' : ""}</div></div>` : ""}<section class="panel feed-panel"><div class="tabs"><button class="${tab === "activity" ? "on" : ""}" data-tab="activity">Activity</button><button class="${tab === "evidence" ? "on" : ""}" data-tab="evidence">Call evidence <span>${r.calls.filter((c) => c.result).length}</span></button><button class="${tab === "matching" ? "on" : ""}" data-tab="matching">Match reasoning</button><span class="feed-live">${isActive ? "Working…" : "Saved locally"}</span></div><div class="tab-content">${tab === "activity" ? activity(r) : tab === "evidence" ? evidence(r) : matching(r)}</div></section>${isActive ? '<div class="stop-line"><span>CALL-E calls are being reconciled as they finish.</span><button data-action="stop">Stop future calls</button></div>' : ""}</div><aside>${success ? ticket(r) : pendingTicket(r)}${r.input.mode === "live" && config.recordings?.some((b) => b.id === r.id) ? '<button class="button replay-button" data-action="replay">Replay captured result · no calls</button>' : ""}<div class="evidence-note">${icon("check")}<p>Phone reports are checked against human transcript excerpts and the collection constraints. Collection itself is recorded separately.</p></div></aside></div></section>`;
}
function activity(r) {
  return `<ol class="timeline">${r.events.map((e, i) => `<li><span class="timeline-mark ${i === r.events.length - 1 && active(r) ? "pulse" : ""}">${i === r.events.length - 1 && active(r) ? icon("phone") : icon("check")}</span><div><div class="event-title"><strong>${esc(e.title)}</strong><time>${new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><p>${esc(e.detail)}</p></div></li>`).join("")}</ol>`;
}
function evidence(r) {
  return r.calls.length
    ? r.calls
        .map(
          (c) =>
            `<article class="call-evidence"><div class="call-title">${icon("phone")}<strong>${c.role === "donor" ? "Bakery confirmation" : "Collector commitment"}</strong><span class="badge">${r.input.mode === "fixture" ? (c.provenance === "live-recording-replay" ? "RECORDED REPLAY" : "SYNTHETIC") : esc(c.status)}</span></div>${
              c.result
                ? `<blockquote>“${esc(c.result.structuredResult?.evidence || "No human confirmation was captured.")}”</blockquote><div class="result-fields">${Object.entries(
                    c.result.structuredResult || {},
                  )
                    .filter(([k]) => k !== "evidence")
                    .map(
                      ([k, v]) =>
                        `<div><span>${esc(k.replace(/([A-Z])/g, " $1"))}</span><strong>${esc(v)}</strong></div>`,
                    )
                    .join(
                      "",
                    )}</div><details><summary>Transcript & provider result</summary><pre>${esc(JSON.stringify(c.result, null, 2))}</pre></details>`
                : '<p class="muted">Waiting for the completed call and structured result…</p>'
            }<div class="call-id">${esc(c.id || "Request saved before dialing")}</div></article>`,
        )
        .join("")
    : '<p class="muted">Evidence will appear after the first call.</p>';
}
function matching(r) {
  return r.ranking.length
    ? `<div class="matching-intro">Full quantity: <strong>${r.offer.quantity} loaves</strong> · deadline: <strong>${esc(r.offer.cutoff)}</strong><p>Arrival = current time + coordinator travel estimate + 3 minutes to coordinate. Select the closest eligible partner.</p></div>${r.ranking.map((p) => `<div class="match-row"><span class="match-icon ${p.eligible ? "eligible" : ""}">${icon(p.eligible ? "check" : "clock")}</span><div><strong>${esc(p.name)}</strong><p>${esc(p.reason)}</p></div><span class="badge">${p.index === r.selected?.index ? "SELECTED" : p.eligible ? "ELIGIBLE" : "EXCLUDED"}</span></div>`).join("")}`
    : '<div class="waiting-match">Matching starts after the bakery confirms the actual quantity and collection window.</div>';
}
function ticket(r) {
  const t = r.ticket;
  const expired =
    r.input.mode === "live" &&
    r.state !== "collected" &&
    Date.now() > Date.parse(`${t.date}T${t.cutoff}:00${t.offset}`);
  return `<section class="ticket"><div class="ticket-top"><span>${icon("box")} PICKUP TICKET</span><span>${esc(t.reference)}</span></div><div class="ticket-body"><div class="ticket-check">${icon("check")}</div><h2>${r.state === "collected" ? "Collection recorded." : expired ? "Window expired." : "It’s a pickup."}</h2><p class="ticket-sub">${r.input.mode === "fixture" ? (r.provenance === "live-recording-replay" ? "Recorded replay · no new calls or collection" : "Fictional rehearsal · no real collection") : r.roleplay ? "Real call role-play · no actual collection" : "Confirmed by phone · collection pending"}</p><div class="ticket-count">${t.quantity}<span>loaves</span></div><div class="ticket-route"><div><small>COLLECT FROM</small><strong>${esc(t.donor)}</strong><p>${esc(t.address)}</p></div><div><small>COLLECTED BY</small><strong>${esc(t.partner)}</strong><p>Partner provides transport</p></div></div><div class="ticket-time"><div><small>ARRIVE AT</small><strong>${esc(t.arrival)}</strong></div><div><small>BEFORE</small><strong>${esc(t.cutoff)}</strong></div></div><div class="ticket-date">${esc(t.date)} · UTC${esc(t.offset)}</div></div><div class="ticket-bottom"><button class="button ticket-download" data-action="download">${icon("down")} Download pickup ticket</button>${r.state === "agreed" && !expired ? '<button class="collected-button" data-action="collected">Mark collected · coordinator report</button>' : ""}<div class="ticket-fine">${r.state === "collected" ? "Collection manually reported by the coordinator." : "Pickup agreed. Collection not yet confirmed."}</div></div></section>`;
}
function pendingTicket(r) {
  return `<section class="pending-ticket"><div class="eyebrow">THE FINAL HANDOFF</div><div class="pending-symbol">${icon("box")}</div><h2>A ticket,<br>when both sides agree.</h2><p>${active(r) ? "Confirming the details. The pickup ticket will appear here once the full quantity and arrival time fit." : "No pickup ticket issued. The coordinator can use the call evidence to resolve what remains."}</p><div class="ticket-checklist"><span class="${r.offer ? "checked" : ""}">${icon("check")} Confirmed bread & release</span><span class="${r.selected ? "checked" : ""}">${icon("check")} Capacity & travel fit</span><span>${icon("check")} Collector’s commitment</span></div></section>`;
}
function render() {
  history.replaceState(
    null,
    "",
    view === "run" && current ? "/?run=" + encodeURIComponent(current.id) : "/",
  );
  app.innerHTML =
    header() + (view === "new" ? newView() : runView(current)) + end();
  bind();
}
function bind() {
  document
    .querySelectorAll("[data-action]")
    .forEach((el) => (el.onclick = () => action(el.dataset.action)));
  document.querySelectorAll("[data-run]").forEach(
    (el) =>
      (el.onclick = () => {
        current = runs.find((r) => r.id === el.dataset.run);
        view = "run";
        tab = "activity";
        render();
      }),
  );
  document.querySelectorAll("[data-mode]").forEach(
    (el) =>
      (el.onclick = () => {
        mode = el.dataset.mode;
        render();
      }),
  );
  document.querySelectorAll("[data-tab]").forEach(
    (el) =>
      (el.onclick = () => {
        tab = el.dataset.tab;
        render();
      }),
  );
  document.querySelector("#handoff-form")?.addEventListener("submit", submit);
}
async function submit(event) {
  event.preventDefault();
  if (submitting) return;
  const f = new FormData(event.target);
  const input = {
    donor: f.get("donor"),
    address: f.get("address"),
    quantity: Number(f.get("quantity")),
    date: f.get("date"),
    ready: f.get("ready"),
    cutoff: f.get("cutoff"),
    offset: f.get("offset"),
    phone: mode === "fixture" ? "+12025550101" : f.get("phone"),
    region: mode === "fixture" ? "US" : String(f.get("region")).toUpperCase(),
    locale: mode === "fixture" ? "en-US" : f.get("locale"),
    mode,
    scenario: f.get("scenario"),
    partners: [0, 1].map((i) => ({
      name: f.get(`partner${i}`),
      capacity: Number(f.get(`capacity${i}`)),
      travelMinutes: Number(f.get(`travel${i}`)),
      approved: true,
      phone: mode === "fixture" ? `+1202555010${i + 2}` : f.get(`phone${i}`),
    })),
  };
  submitting = true;
  const button = event.target.querySelector("[type=submit]");
  button.disabled = true;
  button.textContent = "Saving handoff…";
  try {
    current = await api("runs", "POST", { input, key: crypto.randomUUID() });
    runs.unshift(current);
    view = "run";
    tab = "activity";
    render();
    window.scrollTo({ top: 0 });
  } catch (e) {
    toast(e.message);
    button.disabled = false;
    button.innerHTML =
      (mode === "fixture" ? "Run the rehearsal" : "Start two real calls") +
      icon("arrow");
  } finally {
    submitting = false;
  }
}
async function action(a) {
  if (a === "replay") {
    try {
      current = await api("runs", "POST", {
        input: { mode: "fixture", replayId: current.id },
        key: "replay-" + crypto.randomUUID(),
      });
      view = "run";
      tab = "activity";
      render();
      window.scrollTo({ top: 0 });
    } catch (e) {
      toast(e.message);
    }
    return;
  }
  try {
    if (a === "new") {
      view = "new";
      render();
      return;
    }
    if (a === "resume") {
      await api(`runs/${current.id}/resume`, "POST", {});
      toast("Resuming the saved call.");
    }
    if (a === "stop") {
      await api(`runs/${current.id}/stop`, "POST", {});
      toast("Future calls stopped. An active call may still finish.");
    }
    if (a === "collected") {
      await api(`runs/${current.id}/collected`, "POST", {});
    }
    if (a === "download") {
      const t = await api(`runs/${current.id}/ticket`);
      const blob = new Blob([JSON.stringify(t, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = t.reference + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Pickup ticket downloaded.");
    }
    await refresh();
  } catch (e) {
    toast(e.message);
  }
}
async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const next = await api("runs");
    const sig = JSON.stringify(next);
    runs = next;
    if (current) current = runs.find((r) => r.id === current.id) || current;
    if (sig !== lastSignature && view === "run") {
      lastSignature = sig;
      config = await api("config");
      render();
    }
  } catch (e) {
    if (view === "run")
      toast("Connection interrupted. Your handoff is saved; reconnecting.");
  } finally {
    polling = false;
  }
}
async function init() {
  try {
    config = await api("config");
    runs = await api("runs");
    const requested = new URLSearchParams(location.search).get("run");
    if (requested) {
      current = runs.find((r) => r.id === requested);
      if (current) view = "run";
    }
    render();
    setInterval(refresh, 2000);
  } catch (e) {
    app.innerHTML = `<main class="access-screen"><div class="brand">last crate.</div><h1>Open your collection desk.</h1><form id="access-form"><label class="field"><span>Workspace access token</span><input type="password" name="token" required autocomplete="current-password"></label><button class="button primary">Open workspace ${icon("arrow")}</button></form><p id="access-error"></p></main>`;
    document.querySelector("#access-form").onsubmit = (ev) => {
      ev.preventDefault();
      token = new FormData(ev.target).get("token");
      sessionStorage.setItem("lastcrate-token", token);
      init();
    };
  }
}
init();
