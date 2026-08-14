/*
 * Caucus operator dashboard — vanilla JS, zero dependencies, zero network
 * beyond the relative JSON deployed next to this file.
 *
 * Dual-purpose contract (see src/dashboard.ts): the page fetches the RELATIVE
 * path "cases.json" and then each listed case's `href`. Served by the live
 * dashboard server those resolve to routes reading the sqlite ledger
 * ("api/cases/:id"); deployed as a static folder they resolve to files that
 * exportStatic() wrote ("case.json"). Same bytes run in both worlds — hrefs
 * beginning with "api/" additionally get a small poll loop so a live case
 * updates on screen as the runner advances it.
 *
 * Rendering rule: every data value reaches the DOM via textContent — evidence
 * quotes and transcript-derived strings are treated as untrusted text, never
 * as markup.
 */
"use strict";

(() => {
  // ------------------------------------------------------------------ DOM --

  const $ = (id) => document.getElementById(id);

  /** Create an element; children may be strings, nodes, arrays, or null. */
  function el(tag, opts = {}, ...children) {
    const node = document.createElement(tag);
    if (opts.class) node.className = opts.class;
    if (opts.title) node.title = opts.title;
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svg(tag, attrs = {}, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    for (const child of children) node.append(child);
    return node;
  }

  // ----------------------------------------------------------- formatting --

  /** Cents -> "$1,234.56". Manual grouping so output never varies by locale. */
  function fmtUsd(cents) {
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
  }

  /** Whole-dollar amounts drop the ".00" (axis labels stay compact). */
  function fmtUsdShort(cents) {
    return cents % 100 === 0 ? fmtUsd(cents).slice(0, -3) : fmtUsd(cents);
  }

  /** Ledger timestamps are ISO-8601 UTC; render them without locale surprises. */
  function fmtTime(iso) {
    if (typeof iso !== "string" || iso.length < 16) return iso ?? "";
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  }

  function truncated(value, keep) {
    return value.length <= keep ? value : `${value.slice(0, keep)}…`;
  }

  const STATE_META = {
    created: ["active", "created"],
    consent_pending_a: ["active", "consent pending — A"],
    consent_pending_b: ["active", "consent pending — B"],
    rounds_active: ["active", "rounds active"],
    attestation_pending_a: ["active", "attestation pending — A"],
    attestation_pending_b: ["active", "attestation pending — B"],
    settled: ["good", "settled"],
    impasse: ["bad", "impasse"],
    declined_consent: ["bad", "consent declined"],
    expired: ["muted", "expired"],
    cancelled: ["muted", "cancelled"],
  };

  const KIND_LABEL = {
    open: "opening offer",
    counter: "counter-offer",
    accept: "accepted",
    reject: "rejected",
    no_response: "no response",
  };

  function stateMeta(state) {
    return STATE_META[state] ?? ["muted", state];
  }

  function partyLabel(view, id) {
    const p = view.parties.find((x) => x.id === id);
    return p ? p.label : id;
  }

  function sideOf(id) {
    return id === "A" ? "a" : "b";
  }

  // -------------------------------------------------------------- sections --

  function partyPlate(p) {
    return el(
      "div",
      { class: `party-plate party-${sideOf(p.id)}` },
      el("span", { class: "party-badge" }, p.id),
      el("span", { class: "party-name" }, p.label),
      el("code", { class: "party-phone" }, p.phoneMasked),
    );
  }

  function shuttleGlyph() {
    const g = svg("svg", { class: "shuttle-glyph", viewBox: "0 0 24 24", "aria-hidden": "true" });
    g.append(svg("path", { d: "M20 8H6m0 0 3.2-3.2M6 8l3.2 3.2", class: "mark-a" }));
    g.append(svg("path", { d: "M4 16h14m0 0-3.2-3.2M18 16l-3.2 3.2", class: "mark-b" }));
    return g;
  }

  function renderHeader(view) {
    const [tone, stateLabel] = stateMeta(view.state);
    const head = el("section", { class: "panel case-header" });

    const idBlock = el("div", { class: "header-id" });
    idBlock.append(el("h2", {}, view.caseId));
    idBlock.append(
      el(
        "div",
        { class: "header-chips" },
        el("span", { class: `chip state-${tone}` }, stateLabel),
        el("span", { class: "chip chip-plain" }, view.dispute.vertical.replace(/_/g, " ")),
        el("span", { class: "chip chip-plain" }, `epoch ${view.epoch}`),
        el("span", { class: "chip chip-plain" }, `${view.rounds.length}/${view.policy.maxRounds} rounds`),
      ),
    );

    const amount = el(
      "div",
      { class: "header-amount" },
      el("span", { class: "label" }, "amount in dispute"),
      el("span", { class: "amount-big" }, fmtUsd(view.dispute.amountCents)),
    );

    head.append(el("div", { class: "header-top" }, idBlock, amount));
    head.append(el("p", { class: "case-summary" }, view.dispute.summary));

    const partiesRow = el("div", { class: "parties-row" });
    const a = view.parties.find((p) => p.id === "A");
    const b = view.parties.find((p) => p.id === "B");
    if (a) partiesRow.append(partyPlate(a));
    partiesRow.append(shuttleGlyph());
    if (b) partiesRow.append(partyPlate(b));
    head.append(partiesRow);

    head.append(
      el(
        "div",
        { class: "header-meta" },
        el("span", {}, `opened ${fmtTime(view.createdAt)}`),
        el("span", {}, `last activity ${fmtTime(view.updatedAt)}`),
      ),
    );
    return head;
  }

  // Concession curve as inline SVG — no chart library, themable via CSS vars.
  function renderChart(view) {
    const panel = el("section", { class: "panel chart-panel" });
    panel.append(el("h3", {}, "Concession curve"));

    const curve = view.curve;
    if (curve.length === 0) {
      panel.append(el("p", { class: "empty-note" }, "No monetary offers recorded yet."));
      return panel;
    }

    const W = 760;
    const H = 320;
    const M = { top: 22, right: 34, bottom: 44, left: 78 };
    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom;

    const roundNumbers = curve.map((p) => p.round);
    const minR = Math.min(...roundNumbers);
    const maxR = Math.max(...roundNumbers);
    const spanR = Math.max(1, maxR - minR);
    const yMax = Math.max(view.dispute.amountCents, ...curve.map((p) => p.amountCents), 1);

    const x = (round) => M.left + ((round - minR) / spanR) * innerW;
    const y = (cents) => M.top + innerH - (cents / yMax) * innerH;

    const root = svg("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "curve-svg",
      role: "img",
      "aria-label": "Concession curve: each party's monetary offers by round",
    });

    // Horizontal gridlines with dollar labels.
    for (let i = 0; i <= 4; i += 1) {
      const v = Math.round((yMax * i) / 4);
      const gy = y(v);
      root.append(svg("line", { x1: M.left, y1: gy, x2: W - M.right, y2: gy, class: "grid-line" }));
      root.append(
        svg("text", { x: M.left - 10, y: gy + 4, class: "tick-label", "text-anchor": "end" }, fmtUsdShort(v)),
      );
    }

    // One x tick per distinct round.
    const seen = new Set();
    for (const r of roundNumbers) {
      if (seen.has(r)) continue;
      seen.add(r);
      root.append(
        svg("line", { x1: x(r), y1: M.top + innerH, x2: x(r), y2: M.top + innerH + 5, class: "grid-line" }),
      );
      root.append(
        svg("text", { x: x(r), y: H - M.bottom + 22, class: "tick-label", "text-anchor": "middle" }, `R${r}`),
      );
    }
    root.append(
      svg("text", { x: M.left + innerW / 2, y: H - 6, class: "axis-label", "text-anchor": "middle" }, "shuttle round"),
    );

    for (const id of ["A", "B"]) {
      const pts = curve.filter((p) => p.party === id);
      if (pts.length === 0) continue;
      const cls = sideOf(id);
      if (pts.length > 1) {
        root.append(
          svg("polyline", {
            points: pts.map((p) => `${x(p.round)},${y(p.amountCents)}`).join(" "),
            class: `series-line series-${cls}`,
          }),
        );
      }
      for (const p of pts) {
        root.append(
          svg(
            "circle",
            { cx: x(p.round), cy: y(p.amountCents), r: 5, class: `series-dot dot-${cls}` },
            svg("title", {}, `Round ${p.round} — ${partyLabel(view, id)}: ${fmtUsd(p.amountCents)}`),
          ),
        );
      }
    }

    // Settlement marker: ring + label at the point that carries the settled amount.
    if (view.settlement !== null) {
      let point = curve[curve.length - 1];
      for (let i = curve.length - 1; i >= 0; i -= 1) {
        if (curve[i].amountCents === view.settlement.amountCents) {
          point = curve[i];
          break;
        }
      }
      const cx = x(point.round);
      const cy = y(point.amountCents);
      root.append(svg("circle", { cx, cy, r: 9, class: "settle-ring" }));
      const anchor = cx > M.left + innerW * 0.62 ? "end" : "start";
      root.append(
        svg(
          "text",
          { x: anchor === "end" ? cx - 15 : cx + 15, y: cy - 12, class: "settle-label", "text-anchor": anchor },
          `settled at ${fmtUsd(view.settlement.amountCents)}`,
        ),
      );
    }

    panel.append(root);

    const legendItem = (cls, text) =>
      el("span", { class: "legend-item" }, el("span", { class: `legend-swatch legend-${cls}` }), text);
    panel.append(
      el(
        "div",
        { class: "chart-legend" },
        legendItem("a", `A — ${partyLabel(view, "A")}`),
        legendItem("b", `B — ${partyLabel(view, "B")}`),
        view.settlement !== null ? legendItem("settle", "settlement") : null,
      ),
    );
    return panel;
  }

  function renderRound(r) {
    const side = sideOf(r.party);
    const li = el("li", { class: `t-row t-${side}` });
    const card = el("article", { class: `round-card party-${side}` });

    card.append(
      el(
        "div",
        { class: "round-head" },
        el("span", { class: "round-title" }, `Round ${r.round} — ${r.partyLabel}`),
        r.kind !== null
          ? el("span", { class: `chip kind-${r.kind}` }, KIND_LABEL[r.kind] ?? r.kind)
          : el("span", { class: "chip kind-none" }, r.outcome.replace(/_/g, " ")),
      ),
    );

    if (r.amountCents !== null) card.append(el("p", { class: "round-amount" }, fmtUsd(r.amountCents)));
    if (r.publicRationale) card.append(el("p", { class: "round-rationale" }, r.publicRationale));

    if (r.conditions.length > 0) {
      const conditions = el("div", { class: "round-conditions" }, el("span", { class: "cond-label" }, "Conditions"));
      conditions.append(el("ul", {}, r.conditions.map((c) => el("li", {}, c))));
      card.append(conditions);
    }

    for (const quote of r.evidence) {
      card.append(el("blockquote", { class: "evidence" }, `“${quote}”`));
    }

    card.append(
      el(
        "div",
        { class: "round-foot" },
        r.callId !== null ? el("code", { class: "call-id", title: r.callId }, r.callId) : null,
        el("span", { class: "round-time" }, fmtTime(r.at)),
      ),
    );

    li.append(card, el("span", { class: "t-node" }, String(r.round)));
    return li;
  }

  function timelineOutcome(view) {
    switch (view.state) {
      case "settled":
        return ["good", "Settled — both parties read back the same terms code on separate calls."];
      case "attestation_pending_a":
      case "attestation_pending_b":
        return ["neutral", "Settlement proposed — attestation calls in progress."];
      case "impasse":
        return ["bad", `Impasse — ${view.assessment.impasseReason ?? "ended without agreement"}.`];
      case "declined_consent":
        return ["bad", "A party declined consent — no offers were ever relayed."];
      case "expired":
        return ["bad", "Case expired before resolution."];
      case "cancelled":
        return ["bad", "Case cancelled by the operator."];
      default:
        return null;
    }
  }

  function renderTimeline(view) {
    const panel = el("section", { class: "panel timeline-panel" });
    panel.append(el("h3", {}, "Shuttle rounds"));

    const consentRow = el("div", { class: "consent-row" });
    for (const p of view.parties) {
      const callId = view.consent[p.id];
      consentRow.append(
        el(
          "span",
          { class: `consent-chip party-${sideOf(p.id)}${callId === null ? " missing" : ""}` },
          callId === null ? `Consent ${p.id} — not recorded` : `Consent ${p.id} recorded`,
          callId === null ? null : el("code", { class: "call-id", title: callId }, callId),
        ),
      );
    }
    panel.append(consentRow);

    if (view.rounds.length === 0) {
      panel.append(el("p", { class: "empty-note" }, "No shuttle rounds yet."));
    } else {
      panel.append(el("ol", { class: "timeline" }, view.rounds.map(renderRound)));
    }

    const outcome = timelineOutcome(view);
    if (outcome !== null) {
      panel.append(el("div", { class: `t-terminal tone-${outcome[0]}` }, outcome[1]));
    }
    return panel;
  }

  function attestationRow(view, id) {
    const att = view.settlement.attestations.find((a) => a.party === id) ?? null;
    const row = el("li", { class: `attest-row party-${sideOf(id)}` });
    const head = el(
      "div",
      { class: "attest-head" },
      el("span", { class: "party-badge" }, id),
      el("span", { class: "attest-label" }, partyLabel(view, id)),
      att === null
        ? el("span", { class: "chip chip-plain" }, "pending")
        : el("span", { class: `chip ${att.verified ? "state-good" : "state-bad"}` }, att.verified ? "verified" : "not verified"),
    );
    row.append(head);
    if (att !== null) {
      row.append(el("p", { class: "attest-spoken" }, `spoke: “${att.spokenPhrase}”`));
      row.append(
        el(
          "div",
          { class: "attest-meta" },
          el("code", { class: "call-id", title: att.callId }, att.callId),
          el("span", { class: "round-time" }, fmtTime(att.at)),
        ),
      );
    }
    return row;
  }

  function renderSettlement(view) {
    const panel = el("section", { class: "panel settlement-panel" });
    panel.append(el("h3", {}, "Settlement"));

    const s = view.settlement;
    if (s === null) {
      const note =
        view.state === "impasse"
          ? "No settlement — the case ended at impasse."
          : view.state === "declined_consent"
            ? "No settlement — consent was declined."
            : "No settlement yet.";
      panel.append(el("p", { class: "empty-note" }, note));
      return panel;
    }

    panel.append(el("p", { class: "settle-amount" }, fmtUsd(s.amountCents)));

    const conditions = el("div", { class: "kv" }, el("span", { class: "kv-label" }, "Conditions"));
    if (s.conditions.length === 0) {
      conditions.append(el("span", { class: "empty-note" }, "none"));
    } else {
      conditions.append(el("ul", { class: "settle-conditions" }, s.conditions.map((c) => el("li", {}, c))));
    }
    panel.append(conditions);

    panel.append(
      el(
        "div",
        { class: "kv" },
        el("span", { class: "kv-label" }, "Terms digest — SHA-256"),
        el("code", { class: "digest", title: s.termsDigest }, truncated(s.termsDigest, 18)),
      ),
    );

    panel.append(
      el(
        "div",
        { class: "kv" },
        el("span", { class: "kv-label" }, "Attestation code — derived from the digest"),
        el("span", { class: "attest-code" }, s.attestationPhrase),
      ),
    );

    panel.append(
      el(
        "div",
        { class: "kv" },
        el("span", { class: "kv-label" }, "Attestations — separate calls, same code"),
        el("ul", { class: "attest-list" }, attestationRow(view, "A"), attestationRow(view, "B")),
      ),
    );
    return panel;
  }

  function renderAssessment(view) {
    const panel = el("section", { class: "panel assessment-panel" });
    panel.append(el("h3", {}, "Engine assessment"));

    const a = view.assessment;
    if (a.impasse) {
      panel.append(
        el("div", { class: "status-row status-bad" }, el("span", { class: "status-dot" }), "Impasse detected"),
      );
      if (a.impasseReason !== null) panel.append(el("p", { class: "empty-note" }, a.impasseReason));
    } else {
      panel.append(
        el(
          "div",
          { class: "status-row status-ok" },
          el("span", { class: "status-dot" }),
          "No stall or oscillation detected",
        ),
      );
    }

    panel.append(
      el(
        "div",
        { class: "kv" },
        el("span", { class: "kv-label" }, "Neutral midpoint suggestion"),
        a.nextSuggestionCents !== null ? el("span", {}, fmtUsd(a.nextSuggestionCents)) : el("span", { class: "empty-note" }, "—"),
      ),
    );

    panel.append(
      el(
        "p",
        { class: "panel-note" },
        "Computed from offers the parties disclosed on calls. Private reservation bounds never appear in this view.",
      ),
    );
    return panel;
  }

  function renderLedger(view) {
    const panel = el("section", { class: "panel ledger-panel" });
    panel.append(el("h3", {}, "Ledger integrity"));

    const L = view.ledger;
    panel.append(
      L.chainOk
        ? el(
            "div",
            { class: "status-row status-ok" },
            el("span", { class: "status-dot" }),
            `Hash chain verified — ${L.entries} entries`,
          )
        : el(
            "div",
            { class: "status-row status-bad" },
            el("span", { class: "status-dot" }),
            `Hash chain BROKEN at seq ${L.brokenAtSeq ?? "?"}`,
          ),
    );

    if (L.headHash !== null) {
      panel.append(
        el(
          "div",
          { class: "kv" },
          el("span", { class: "kv-label" }, "Chain head"),
          el("code", { class: "digest", title: L.headHash }, truncated(L.headHash, 18)),
        ),
      );
    }

    panel.append(
      el(
        "p",
        { class: "panel-note" },
        "This page is rebuilt from the append-only ledger alone; each entry hashes its predecessor, so editing any recorded step is detectable.",
      ),
    );
    return panel;
  }

  function renderView(view) {
    const root = $("case-root");
    const main = el("div", {}, renderChart(view), renderTimeline(view));
    const side = el("div", {}, renderSettlement(view), renderAssessment(view), renderLedger(view));
    root.replaceChildren(renderHeader(view), el("div", { class: "layout" }, main, side));
    root.hidden = false;
    $("loading").hidden = true;
  }

  // ------------------------------------------------------------ data flow --

  const POLL_MS = 2500;
  let caseItems = [];
  let currentItem = null;
  let lastRendered = "";
  let pollTimer = 0;

  async function fetchJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`GET ${path} responded ${res.status}`);
    return res.json();
  }

  function isLive(item) {
    return item.href.startsWith("api/");
  }

  function setSource(mode) {
    const badge = $("source-badge");
    badge.hidden = false;
    if (mode === "live") {
      badge.textContent = "live ledger";
      badge.className = "source-badge source-live";
    } else if (mode === "stale") {
      badge.textContent = "live — connection lost";
      badge.className = "source-badge source-stale";
    } else {
      badge.textContent = "recorded replay";
      badge.className = "source-badge";
    }
  }

  function showError(title, detail) {
    const panel = $("error");
    panel.replaceChildren(
      el("h2", {}, title),
      detail ? el("p", {}, detail) : null,
      el(
        "p",
        {},
        "Live mode: start the dashboard server against a ledger database. ",
        "Static mode: this folder must contain cases.json and case.json (written by exportStatic).",
      ),
    );
    panel.hidden = false;
    $("loading").hidden = true;
  }

  async function refresh() {
    const view = await fetchJson(currentItem.href);
    const key = JSON.stringify(view);
    if (key === lastRendered) return;
    lastRendered = key;
    renderView(view);
  }

  async function poll() {
    try {
      await refresh();
      setSource("live");
    } catch {
      setSource("stale"); // keep the last good render on screen
    }
  }

  async function selectCase(item) {
    currentItem = item;
    lastRendered = "";
    if (pollTimer !== 0) clearInterval(pollTimer);
    pollTimer = 0;
    setSource(isLive(item) ? "live" : "static");
    try {
      await refresh();
      $("error").hidden = true;
    } catch (err) {
      showError(`Could not load case ${item.caseId}`, String(err && err.message ? err.message : err));
      return;
    }
    if (isLive(item)) pollTimer = setInterval(poll, POLL_MS);
  }

  async function boot() {
    let list;
    try {
      list = await fetchJson("cases.json");
    } catch (err) {
      showError("Could not load cases.json", String(err && err.message ? err.message : err));
      return;
    }
    caseItems = Array.isArray(list.cases) ? list.cases : [];
    if (caseItems.length === 0) {
      showError("The ledger contains no cases yet");
      return;
    }

    const select = $("case-select");
    for (const item of caseItems) {
      const option = el("option", {}, `${item.caseId} — ${item.state}`);
      option.value = item.caseId;
      select.append(option);
    }
    if (caseItems.length > 1) $("case-picker").hidden = false;
    select.addEventListener("change", () => {
      const item = caseItems.find((c) => c.caseId === select.value);
      if (item) void selectCase(item);
    });

    await selectCase(caseItems[0]);
  }

  void boot();
})();
