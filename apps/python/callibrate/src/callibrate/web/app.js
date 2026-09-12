/* Callibrate console and public directory.
   No framework. Every panel is rendered from a fetch of the same API a script
   would call, so what a curator sees and what an integration sees cannot drift. */

(() => {
  "use strict";

  const state = {
    user: null,
    csrf: "",
    system: null,
    dashboard: null,
    tasks: [],
    decisions: [],
    view: "queue",
    selectedTaskId: null,
    contract: null,
    job: null,
    poller: null,
    lastRun: null,
    results: [],
    verifications: {},
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const AUTHORITY_COPY = {
    APPLY: ["apply", "AUTO APPLIED", "The provider stated it, it was read back in full, and they confirmed it."],
    REFRESH: ["refresh", "CONFIRMED", "The provider confirmed the record. Nothing changed but the date."],
    REVIEW: ["review", "HUMAN REVIEW", "Automatic change blocked. A person decides this one."],
    STOP: ["stop", "STOPPED", "The call was ended and this number is suppressed."],
  };

  const TRIGGER_COPY = {
    failed_referral: "Reported wrong by a visitor",
    user_report: "Reported by a visitor",
    manual_request: "Verification requested",
    stale_record: "Not confirmed for a long time",
    scheduled_reverify: "Scheduled re-check",
    external_event: "External signal",
  };

  const FIELD_COPY = {
    name: "Name",
    description: "Description",
    status: "Still running",
    schedule: "Opening hours",
    phone: "Phone number",
    eligibility: "Who is eligible",
    fees: "Cost",
    application_process: "How to apply",
    alert: "Notice",
    address: "Address",
  };

  const field = (key) => FIELD_COPY[key] || key;

  function toast(message, kind = "") {
    const node = el("div", `toast ${kind}`, message);
    $("#toast-region").append(node);
    setTimeout(() => node.remove(), 5200);
  }

  async function api(path, options = {}) {
    const init = { headers: { Accept: "application/json" }, ...options };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
      init.method = options.method || "POST";
    }
    if (state.csrf && init.method && init.method !== "GET") {
      init.headers["X-CSRF-Token"] = state.csrf;
    }
    const response = await fetch(path, init);
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (payload.error && payload.error.message) || `request failed (${response.status})`;
      const error = new Error(typeof message === "string" ? message : "request failed");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  /* ------------------------------------------------------------- helpers */

  function ageLabel(days) {
    if (days === null || days === undefined) return "never verified";
    if (days <= 0) return "verified today";
    if (days === 1) return "verified yesterday";
    return `verified ${days} days ago`;
  }

  function scheduleText(service) {
    if (!service.byday) return "—";
    return `${service.byday} ${service.opens_at}–${service.closes_at}`;
  }

  function clearPoller() {
    if (state.poller) {
      clearInterval(state.poller);
      state.poller = null;
    }
  }

  /* --------------------------------------------------------------- console */

  async function loadConsole() {
    const [system, dashboard, tasks, decisions] = await Promise.all([
      api("/api/system"),
      api("/api/dashboard"),
      api("/api/tasks"),
      api("/api/decisions"),
    ]);
    state.system = system;
    state.dashboard = dashboard;
    state.tasks = tasks.tasks;
    state.decisions = decisions.decisions;
    if (!state.selectedTaskId) {
      const first = state.tasks.find((task) => task.status === "queued");
      if (first) {
        state.selectedTaskId = first.id;
        api(`/api/tasks/${encodeURIComponent(first.id)}/contract`)
          .then((contract) => {
            state.contract = contract;
            render();
          })
          .catch(() => {});
      }
    }
    paintChrome();
    render();
  }

  function paintChrome() {
    const queued = state.tasks.filter((task) => task.status === "queued").length;
    const queueCount = $("#tab-queue-count");
    queueCount.textContent = String(queued);
    queueCount.hidden = queued === 0;
    const decisionCount = $("#tab-decisions-count");
    decisionCount.textContent = String(state.decisions.length);
    decisionCount.hidden = state.decisions.length === 0;

    const caller = $("#caller-chip");
    if (state.system.live_calling) {
      caller.className = "chip live";
      caller.innerHTML = `<span class="dot pulse"></span> CALL-E · ${state.system.allowlisted_numbers} allowlisted`;
    } else {
      caller.className = "chip";
      caller.textContent = "pilot line · no telephone";
    }
    const ledger = $("#ledger-chip");
    ledger.className = state.system.ledger_intact ? "chip good" : "chip bad";
    ledger.innerHTML = `<span class="dot"></span> ${state.system.ledger_intact ? "ledger intact" : "LEDGER BROKEN"}`;
    if (state.user) {
      $("#avatar").textContent = (state.user.display_name || state.user.username)
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
    }
  }

  function render() {
    const content = $("#content");
    content.innerHTML = "";
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.view === state.view);
    });
    if (state.view === "queue") renderQueue(content);
    else if (state.view === "decisions") renderDecisions(content);
    else if (state.view === "directory") renderDirectory(content);
    else renderLedger(content);
  }

  /* ------------------------------------------------------------ queue view */

  function renderQueue(root) {
    const rig = el("div", "rig");

    // Column 1: the four numbers, then what is waiting.
    const left = el("div");
    const counters = el("div", "counters");
    const data = state.dashboard;
    [
      ["Needs verification", data.needs_verification, ""],
      ["Calling now", data.calling, data.calling ? "live" : ""],
      ["Verified today", data.verified_today, "good"],
      ["Needs a person", data.needs_decision, data.needs_decision ? "attention" : ""],
    ].forEach(([label, value, kind]) => {
      const counter = el("div", `counter ${kind}`);
      counter.append(el("span", null, label), el("b", null, String(value ?? 0)));
      counters.append(counter);
    });
    left.append(counters);

    const queuePanel = el("div", "panel");
    const head = el("div", "panel-head");
    head.append(el("h3", null, "Queue"));
    const refresh = el("button", "mini", "recompute");
    refresh.addEventListener("click", async () => {
      try {
        const result = await api("/api/queue/refresh", { body: {} });
        toast(`queue recomputed: ${result.created} created, ${result.updated} updated`, "good");
        await loadConsole();
      } catch (error) {
        toast(error.message, "error");
      }
    });
    head.append(refresh);
    queuePanel.append(head);

    const list = el("div", "queue-list");
    // The queue is what still needs calling. Anything waiting on a person is in
    // Decisions, and showing it in both places makes the queue count a lie.
    const open = state.tasks.filter((task) => ["queued", "in_progress"].includes(task.status));
    if (!open.length) {
      list.append(emptyState("everything in this directory has been confirmed"));
    }
    open.forEach((task) => {
      const item = el("button", "queue-item");
      item.type = "button";
      item.dataset.taskId = task.id;
      if (task.id === state.selectedTaskId) item.classList.add("selected");
      item.append(el("strong", null, task.service_name));
      const meta = el("div", "meta");
      const tag = el("span", `trigger-tag ${task.trigger === "failed_referral" || task.trigger === "manual_request" ? "urgent" : ""}`, TRIGGER_COPY[task.trigger] || task.trigger);
      meta.append(tag, el("span", "priority", `p${Math.round(task.priority)}`));
      item.append(meta);
      item.append(el("small", null, `${task.organization_name} · ${task.fields.map(field).join(", ")}`));
      item.addEventListener("click", () => selectTask(task.id));
      list.append(item);
    });
    queuePanel.append(list);
    left.append(queuePanel);

    // Column 2: the verification itself.
    const centre = el("div", "panel");
    centre.id = "verification-panel";
    renderVerificationPanel(centre);

    // Column 3: what the machine will be told.
    const right = el("div", "panel");
    right.id = "goal-panel";
    renderGoalPanel(right);

    rig.append(left, centre, right);
    root.append(rig);
  }

  function emptyState(message) {
    const node = el("div", "empty");
    node.append(el("span", "glyph", "···"), el("p", null, message));
    return node;
  }

  async function selectTask(taskId) {
    state.selectedTaskId = taskId;
    state.contract = null;
    state.lastRun = null;
    state.job = null;
    clearPoller();
    render();
    try {
      state.contract = await api(`/api/tasks/${encodeURIComponent(taskId)}/contract`);
    } catch (error) {
      toast(error.message, "error");
    }
    // A record that has already been verified opens on the call that verified
    // it, rather than on an empty panel offering to call again. A record that
    // has never been called is not asked for; a 404 is not a way to find out.
    const task = state.tasks.find((item) => item.id === taskId);
    if (task && task.attempts > 0) {
      try {
        state.lastRun = await api(`/api/tasks/${encodeURIComponent(taskId)}/run`);
      } catch {
        state.lastRun = null;
      }
    }
    render();
  }

  function renderVerificationPanel(panel) {
    panel.innerHTML = "";
    const task = state.tasks.find((item) => item.id === state.selectedTaskId);
    if (!task) {
      const head = el("div", "panel-head");
      head.append(el("h3", null, "Verification"));
      panel.append(head, emptyState("pick a record from the queue to see what a call would establish"));
      return;
    }

    const head = el("div", "panel-head");
    head.append(el("h3", null, "Verification"));
    head.append(el("span", "chip", task.status.replace("_", " ")));
    panel.append(head);

    const body = el("div", "panel-body");
    const subject = el("div", "subject");
    subject.append(el("p", "label", "Subject"));
    subject.append(el("h2", null, task.service_name));
    subject.append(el("p", "org", `${task.organization_name} · record ${task.service_id}`));
    body.append(subject);

    if (state.contract && state.contract.contract.trigger.message) {
      body.append(el("div", "trigger-note", state.contract.contract.trigger.message));
    }

    const record = el("div", "record-grid");
    const current = state.contract ? state.contract.contract.current_record : {};
    const applied = {};
    if (settled()) {
      (state.lastRun.applied || []).forEach((change) => {
        applied[change.field] = change;
      });
    }
    task.fields.forEach((key) => {
      const row = el("div", "record-row checking");
      row.append(el("div", "k", field(key)));
      const value = el("div", "v");
      if (applied[key]) {
        row.classList.add("changed");
        value.append(el("span", "was", applied[key].old || "—"));
        value.append(document.createTextNode(applied[key].new));
      } else {
        value.textContent = current[key] || "—";
      }
      row.append(value);
      record.append(row);
    });
    body.append(record);

    const transcript =
      state.lastRun && state.lastRun.evidence ? state.lastRun.evidence.transcript : [];
    // The conversation stays on screen after the call ends. A curator reading a
    // verdict needs the turns it was read from in the same view, not a button
    // offering to do it again.
    if (state.job || transcript.length) {
      body.append(renderStage(task));
    }
    if (!state.job && task.status === "queued") {
      const action = el("button", "button primary wide");
      action.id = "call-button";
      action.textContent = state.system.live_calling
        ? "Call the provider with CALL-E"
        : "Run the call on the pilot line";
      action.addEventListener("click", () => startVerification(task));
      body.append(action);
      if (state.contract && !state.contract.destination_allowlisted) {
        body.append(
          el(
            "p",
            "muted",
            "This number is not on the deployment's call allowlist, so the call will be refused before anything is dialled.",
          ),
        );
      }
    }

    panel.append(body);
  }

  const TERMINAL = ["verified", "review", "failed", "refused"];

  // While a call is in progress the console must not show what it is going to
  // conclude. A verdict on screen before the provider has spoken is a lie, and
  // on a recording it is an obvious one.
  const settled = () => state.lastRun && !(state.job && !TERMINAL.includes(state.job.state));

  function stepper(job, names) {
    // A finished call has no active step. Leaving the last one pulsing is how a
    // progress display quietly lies about whether anything is still happening.
    const terminal = TERMINAL.includes(job.state);
    const index = { requested: 0, calling: 1 }[job.state] ?? names.length - 1;
    const stopped = job.state === "failed" || job.state === "refused";
    const node = el("div", "stepper");
    names.forEach((name, position) => {
      const step = el("div", "step", name);
      if (terminal) step.classList.add(stopped && position === names.length - 1 ? "stopped" : "done");
      else if (position < index) step.classList.add("done");
      else if (position === index) step.classList.add("active");
      node.append(step);
    });
    return node;
  }

  function renderStage(task) {
    const stage = el("div", "stage");
    const job = state.job || {
      state: "verified",
      detail: "call complete",
      caller: state.lastRun.caller,
      call_id: state.lastRun.call_id,
    };
    stage.append(stepper(job, ["requested", "calling", "evidence", "verdict"]));

    const bar = el("div", "callbar");
    bar.append(el("span", "dot pulse"));
    const who = el("div");
    who.append(el("strong", null, task.organization_name));
    who.append(el("small", null, `${job.caller}${job.call_id ? ` · ${job.call_id}` : ""} — ${job.detail}`));
    bar.append(who);
    stage.append(bar);

    const transcript = el("div", "transcript");
    const all = state.lastRun && state.lastRun.evidence ? state.lastRun.evidence.transcript : [];
    // The guided walkthrough reveals the conversation at the pace it was spoken.
    // Everywhere else the transcript arrives whole, because the call is over.
    const turns = typeof window.__CBR_REVEAL === "number" ? all.slice(0, window.__CBR_REVEAL) : all;
    const cited = new Set();
    if (state.lastRun && state.lastRun.evidence) {
      state.lastRun.evidence.claims.forEach((claim) => {
        claim.readback_turn_ids.forEach((id) => cited.add(id));
        claim.confirmation_turn_ids.forEach((id) => cited.add(id));
      });
    }
    turns.forEach((turn) => {
      const node = el("div", `turn ${turn.role}${cited.has(turn.id) ? " cited" : ""}`);
      node.append(el("div", "who", turn.role === "assistant" ? "CALL-E" : turn.role));
      node.append(el("p", null, turn.text));
      transcript.append(node);
    });
    if (turns.length) {
      stage.append(transcript);
      requestAnimationFrame(() => {
        transcript.scrollTop = transcript.scrollHeight;
      });
    }
    return stage;
  }

  function renderOutcome(run) {
    const wrap = el("div");
    const [kind, name, fallback] = AUTHORITY_COPY[run.authority] || ["review", run.authority, ""];

    const evidence = el("div", "evidence");
    const claims = (run.evidence && run.evidence.claims) || [];
    if (claims.length) {
      const claim = claims[0];
      [
        ["Provider stated it", claim.explicit_statement, claim.evidence_note],
        ["Read back in full", claim.readback_turn_ids.length > 0, claim.evidence_note],
        ["Provider confirmed", claim.confirmation_turn_ids.length > 0, ""],
        ["No ambiguity", !claim.ambiguous, claim.evidence_note],
      ].forEach(([label, ok, why]) => {
        const row = el("div", `check ${ok ? "pass" : "fail"}`);
        row.append(el("span", "state", ok ? "✓" : "✕"));
        row.append(el("span", null, label));
        if (!ok && why) row.append(el("span", "why", why));
        evidence.append(row);
      });
      wrap.append(el("p", "label", "Evidence"), evidence);
    } else if (run.evidence && run.evidence.confirmations.length) {
      const row = el("div", "check pass");
      row.append(el("span", "state", "✓"));
      row.append(el("span", null, "Provider confirmed the published value is unchanged"));
      evidence.append(row);
      wrap.append(el("p", "label", "Evidence"), evidence);
    }

    const verdict = el("div", `verdict ${kind}`);
    verdict.append(el("div", "name", name));
    verdict.append(el("small", null, (run.decisions && run.decisions[0] && run.decisions[0].reason) || fallback));
    wrap.append(el("p", "label", "Decision"), verdict);

    if (run.unresolved && run.unresolved.length) {
      const list = el("ul", "muted unresolved");
      run.unresolved.forEach((item) => list.append(el("li", null, item)));
      wrap.append(el("p", "label", "Left unresolved"), list);
    }
    return wrap;
  }

  function renderGoalPanel(panel) {
    // Before the call this column is the instruction; after it, the verdict.
    // Both are the same question asked at different times: what is this call
    // allowed to do to the record.
    panel.innerHTML = "";
    const head = el("div", "panel-head");
    const body = el("div", "panel-body");
    if (settled()) {
      head.append(el("h3", null, "What the call established"));
      head.append(el("span", "chip", state.lastRun.call_id || "call"));
      body.append(renderOutcome(state.lastRun));
      const again = el("button", "button ghost wide", "Show the call goal again");
      again.type = "button";
      again.addEventListener("click", () => {
        state.lastRun = null;
        state.job = null;
        render();
      });
      body.append(again);
    } else {
      head.append(el("h3", null, "What CALL-E is told"));
      if (!state.contract) {
        body.append(
          el(
            "p",
            "muted",
            "The call goal is built from the Verification Contract, not from a prompt constant. Select a record to read the exact instruction that would be sent.",
          ),
        );
      } else {
        body.append(el("pre", "goal", state.contract.goal));
      }
    }
    panel.append(head, body);
  }

  async function startVerification(task) {
    const button = $("#call-button");
    if (button) button.disabled = true;
    try {
      const body = state.system.live_calling ? {} : { scenario: currentScenario() };
      state.job = await api(`/api/tasks/${encodeURIComponent(task.id)}/verify`, { body });
      render();
      pollJob(task.id);
    } catch (error) {
      toast(error.message, "error");
      if (button) button.disabled = false;
    }
  }

  function currentScenario() {
    return window.__callibrateScenario || "hours_changed";
  }

  function pollJob(taskId) {
    clearPoller();
    state.poller = setInterval(async () => {
      try {
        const job = await api(`/api/verifications/${encodeURIComponent(taskId)}`);
        state.job = job;
        if (job.result) state.lastRun = job.result;
        if (["verified", "review", "failed", "refused"].includes(job.state)) {
          clearPoller();
          if (job.error) toast(job.error, job.state === "refused" ? "" : "error");
          const [system, dashboard, tasks, decisions] = await Promise.all([
            api("/api/system"),
            api("/api/dashboard"),
            api("/api/tasks"),
            api("/api/decisions"),
          ]);
          state.system = system;
          state.dashboard = dashboard;
          state.tasks = tasks.tasks;
          state.decisions = decisions.decisions;
          paintChrome();
        }
        render();
      } catch (error) {
        clearPoller();
        toast(error.message, "error");
      }
    }, 900);
  }

  /* -------------------------------------------------------- decisions view */

  function renderDecisions(root) {
    const list = el("div", "decision-list");
    if (!state.decisions.length) {
      const panel = el("div", "panel");
      panel.append(emptyState("nothing is waiting on a person"));
      root.append(panel);
      return;
    }
    state.decisions.forEach((item) => {
      const card = el("div", `decision ${item.tier >= 3 ? "stop" : ""}`);
      const top = el("div", "decision-top");
      const left = el("div");
      left.append(el("p", "label", item.kind === "change" ? `${field(item.field_name)} · proposed change` : "safety review"));
      left.append(el("h3", null, item.service_name));
      left.append(el("p", "muted", `${item.organization_name} · ${item.caller || "call"} ${item.call_id || ""}`));
      top.append(left);
      top.append(el("span", `chip ${item.tier >= 3 ? "bad" : "warn"}`, item.tier >= 3 ? "STOP" : "HUMAN REVIEW"));
      card.append(top);

      if (item.kind === "change") {
        const diff = el("div", "diff");
        const before = el("div", "diff-block");
        before.append(el("span", "label", "Published now"));
        before.append(el("div", "v", item.old_value || "—"));
        const arrow = el("div", "diff-arrow", "→");
        const after = el("div", "diff-block after");
        after.append(el("span", "label", "Provider says"));
        after.append(el("div", "v", item.new_value || "—"));
        diff.append(before, arrow, after);
        card.append(diff);
      }

      card.append(el("div", "quote", `“${item.quote}”`));
      const why = el("p", "muted why-line", `Blocked because: ${item.reason}`);
      card.append(why);

      const actions = el("div", "decision-actions");
      if (item.kind === "change") {
        actions.append(actionButton("Approve", "button approve", () => resolve(item.id, "approve")));
        actions.append(
          actionButton("Edit and apply", "button secondary", () =>
            promptEdit(item)),
        );
        actions.append(actionButton("Reject", "button danger", () => resolve(item.id, "reject")));
      } else {
        actions.append(actionButton("Acknowledge", "button secondary", () => resolve(item.id, "acknowledge")));
      }
      card.append(actions);
      list.append(card);
    });
    root.append(list);
  }

  function actionButton(label, className, handler) {
    const button = el("button", className, label);
    button.type = "button";
    button.addEventListener("click", handler);
    return button;
  }

  async function resolve(proposalId, action, editedValue) {
    try {
      await api(`/api/decisions/${encodeURIComponent(proposalId)}`, {
        body: { action, edited_value: editedValue || null, note: "" },
      });
      toast(`decision recorded: ${action}`, "good");
      await loadConsole();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function promptEdit(item) {
    openDialog({
      kicker: "Curator edit",
      title: `Edit ${field(item.field_name)}`,
      copy: "A curator edit passes the same validators as an automatic change. A malformed value is refused here too.",
      fields: [{ name: "value", label: "Value to publish", value: item.new_value || "" }],
      submit: "Apply",
      onSubmit: (values) => resolve(item.id, "edit", values.value),
    });
  }

  /* -------------------------------------------------------- directory view */

  function renderDirectory(root) {
    const toolbar = el("div", "toolbar");
    const search = el("input");
    search.placeholder = "Search the directory";
    toolbar.append(search);
    root.append(toolbar);

    const wrap = el("div", "table-wrap");
    const table = el("table");
    const thead = el("thead");
    const headRow = el("tr");
    ["Service", "Published hours", "Phone", "Last verified", ""].forEach((label) => headRow.append(el("th", null, label)));
    thead.append(headRow);
    const tbody = el("tbody");
    table.append(thead, tbody);
    wrap.append(table);
    root.append(wrap);

    const paint = async (query) => {
      const payload = await api(`/api/services${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      tbody.innerHTML = "";
      payload.services.forEach((service) => {
        const row = el("tr");
        const name = el("td");
        name.append(el("strong", null, service.name));
        name.append(el("small", "muted", service.organization_name));
        row.append(name);
        row.append(el("td", "mono", scheduleText(service)));
        row.append(el("td", "mono", service.phone || "—"));
        const age = el("td");
        const days = service.age_days;
        const span = el("span", `age ${days === null ? "stale" : days > 60 ? "stale" : days <= 30 ? "fresh" : ""}`, ageLabel(days));
        age.append(span);
        row.append(age);
        const actions = el("td");
        actions.append(
          actionButton("verify", "mini", async () => {
            try {
              const job = await api("/api/verify-now", {
                body: { service_id: service.id, fields: ["schedule"], note: "curator asked from the directory" },
              });
              state.view = "queue";
              state.selectedTaskId = job.task_id;
              state.job = job;
              await loadConsole();
              state.contract = await api(`/api/tasks/${encodeURIComponent(job.task_id)}/contract`);
              render();
              pollJob(job.task_id);
            } catch (error) {
              toast(error.message, "error");
            }
          }),
        );
        row.append(actions);
        tbody.append(row);
      });
    };

    let timer = null;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => paint(search.value.trim()), 200);
    });
    paint("");
  }

  /* ----------------------------------------------------------- ledger view */

  async function renderLedger(root) {
    const strip = el("div", "metric-strip");
    root.append(strip);
    const panel = el("div", "panel");
    const head = el("div", "panel-head");
    head.append(el("h3", null, "Evidence ledger"));
    const state_ = el("span", "chip good", "verifying…");
    head.append(state_);
    panel.append(head);
    const list = el("div", "ledger");
    panel.append(list);
    root.append(panel);

    try {
      const [ledger, metrics] = await Promise.all([api("/api/ledger"), api("/api/metrics")]);
      state_.className = ledger.chain_valid ? "chip good" : "chip bad";
      state_.innerHTML = `<span class="dot"></span> ${ledger.chain_valid ? "every link verifies" : `broken at #${ledger.first_break}`}`;
      [
        ["calls placed", metrics.calls_placed, ""],
        ["calls refused by policy", metrics.calls_refused, ""],
        ["claims read from transcripts", metrics.claims, ""],
        ["unsupported claims", metrics.unsupported_claims, "zero"],
        ["applied automatically", metrics.auto_applied, ""],
        ["false automatic changes", metrics.false_automatic_mutations, "zero"],
      ].forEach(([label, value, kind]) => {
        const metric = el("div", `metric ${value === 0 ? kind : ""}`);
        metric.append(el("b", null, String(value)));
        metric.append(el("span", null, label));
        strip.append(metric);
      });
      ledger.events.forEach((event) => {
        const row = el("div", "event");
        row.append(el("div", "glyph", glyphFor(event.event_type)));
        const middle = el("div");
        middle.append(el("strong", null, event.event_type));
        middle.append(el("small", null, `${event.actor} · ${event.entity_id} · ${event.created_at}`));
        row.append(middle);
        row.append(el("div", "hash", event.event_hash.slice(0, 12)));
        list.append(row);
      });
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function glyphFor(type) {
    if (type.startsWith("call.")) return "☎";
    if (type.startsWith("change.")) return "±";
    if (type.startsWith("decision.")) return "§";
    if (type.startsWith("safety.")) return "!";
    if (type.startsWith("verification.")) return "✓";
    if (type.startsWith("consent.")) return "⊘";
    return "·";
  }

  /* ---------------------------------------------------------------- dialog */

  function openDialog({ kicker, title, copy, fields, submit, onSubmit }) {
    const dialog = $("#form-dialog");
    $("#form-dialog-kicker").textContent = kicker;
    $("#form-dialog-title").textContent = title;
    $("#form-dialog-copy").textContent = copy || "";
    $("#form-dialog-error").textContent = "";
    $("#form-dialog-submit").textContent = submit || "Continue";
    const container = $("#form-dialog-fields");
    container.innerHTML = "";
    fields.forEach((spec) => {
      const label = el("label", "dialog-field");
      label.append(el("span", "label", spec.label));
      const input = spec.multiline ? el("textarea") : el("input");
      input.name = spec.name;
      input.value = spec.value || "";
      label.append(input);
      container.append(label);
    });
    dialog.returnValue = "";
    dialog.showModal();
    const form = $("#form-dialog-form");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = {};
      new FormData(form).forEach((value, key) => {
        values[key] = value;
      });
      dialog.close();
      await onSubmit(values);
    };
  }

  /* ---------------------------------------------------------------- public */

  async function renderPublic() {
    document.body.classList.add("public");
    $("#login-view").hidden = true;
    $("#app-view").hidden = true;
    $("#public-view").hidden = false;
    $("#search-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      await search();
    });
    await search();
  }

  async function search() {
    try {
      const payload = await api("/api/directory/search", {
        body: {
          need: $("#search-need").value.trim() || "food",
          postal_code: $("#search-postal").value.trim(),
          limit: 5,
        },
      });
      state.results = payload.results;
      paintResults();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function paintResults() {
    const root = $("#results");
    root.innerHTML = "";
    if (!state.results.length) {
      root.append(el("p", "muted", "No services matched that search."));
      return;
    }
    state.results.forEach((service) => {
      const card = el("div", "result");
      card.dataset.serviceId = service.id;
      card.append(el("h3", null, service.name));
      card.append(el("div", "org", `${service.organization_name} · ${service.address_1 || ""} ${service.city || ""}`));

      const facts = el("div", "facts");
      const verification = state.verifications[service.id];
      const applied = verification && verification.result ? (verification.result.applied || []) : [];
      const change = applied.find((item) => item.field === "schedule");
      const hours = el("div", "fact");
      hours.append(el("span", "k", "Opening hours"));
      const value = el("span", `v${change ? " updated" : ""}`);
      if (change) {
        value.append(el("span", "was", change.old));
        value.append(document.createTextNode(change.new));
      } else {
        value.textContent = scheduleText(service);
      }
      hours.append(value);
      facts.append(hours);

      const phone = el("div", "fact");
      phone.append(el("span", "k", "Phone"), el("span", "v", service.phone || "—"));
      facts.append(phone);
      card.append(facts);

      const fresh = el("div", "freshness");
      const days = change ? 0 : service.age_days;
      fresh.append(el("span", `pill ${days === null || days > 60 ? "stale" : days <= 1 ? "fresh" : ""}`, ageLabel(days)));
      if (days !== null && days > 60) {
        fresh.append(el("span", null, "this listing is old enough that it may have moved"));
      }
      card.append(fresh);

      const actions = el("div", "result-actions");
      const verifyButton = actionButton("Verify before I go", "button primary", () => verifyNow(service.id));
      verifyButton.dataset.verify = service.id;
      actions.append(verifyButton);
      actions.append(actionButton("It was wrong when I went", "button ghost", () => reportFailure(service)));
      card.append(actions);

      if (verification) card.append(renderVerifyStrip(verification));
      root.append(card);
    });
  }

  function renderVerifyStrip(job) {
    const strip = el("div", "verify-strip");
    const head = el("div", "head");
    const running = !TERMINAL.includes(job.state);
    head.append(el("span", running ? "dot pulse" : "dot"));
    head.append(
      el(
        "span",
        null,
        running
          ? job.caller === "call-e"
            ? "CALL-E is on the phone to the provider"
            : "Verification running"
          : "Call finished",
      ),
    );
    strip.append(head);
    const steps = stepper(job, ["requested", "calling", "checking evidence", "answer"]);
    steps.classList.add("steps");
    strip.append(steps);
    const body = el("div", "body");
    if (job.state === "verified" && job.result) {
      body.classList.add("good");
      const applied = job.result.applied || [];
      body.textContent = applied.length
        ? `The provider confirmed new hours on the phone just now. The listing above has been corrected.`
        : "The provider confirmed the listing is still right. Verified by phone just now.";
    } else if (job.state === "review") {
      body.classList.add("warn");
      body.textContent =
        "The provider said something a person has to look at, so nothing here has been changed. Call ahead before you travel.";
    } else if (job.state === "refused" || job.state === "failed") {
      body.classList.add("stopped");
      body.textContent = job.error || "The call could not be made. Nothing has been changed.";
    } else {
      body.textContent = job.detail;
    }
    strip.append(body);
    return strip;
  }

  async function verifyNow(serviceId) {
    try {
      const job = await api("/api/verify-now", {
        body: { service_id: serviceId, fields: ["schedule"], note: "" },
      });
      state.verifications[serviceId] = job;
      paintResults();
      const timer = setInterval(async () => {
        try {
          const update = await api(`/api/verifications/${encodeURIComponent(job.task_id)}`);
          state.verifications[serviceId] = update;
          if (["verified", "review", "failed", "refused"].includes(update.state)) {
            clearInterval(timer);
            await search();
            state.verifications[serviceId] = update;
          }
          paintResults();
        } catch (error) {
          clearInterval(timer);
          toast(error.message, "error");
        }
      }, 900);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function reportFailure(service) {
    openDialog({
      kicker: "Report",
      title: "What happened when you went?",
      copy: "A report becomes a phone call to the provider in the same transaction. Nothing waits for a batch.",
      fields: [{ name: "details", label: "What did you find?", value: "The door was closed at the published time.", multiline: true }],
      submit: "Send and call them",
      onSubmit: async (values) => {
        try {
          const result = await api("/api/directory/reports", {
            body: { service_id: service.id, reason: "closed", details: values.details },
          });
          toast("reported — this record is now first in the verification queue", "good");
          state.verifications[service.id] = {
            task_id: result.verification_task_id,
            service_id: service.id,
            state: "requested",
            detail: "Your report created a verification call",
            caller: "",
            call_id: "",
            result: null,
            error: "",
          };
          paintResults();
        } catch (error) {
          toast(error.message, "error");
        }
      },
    });
  }

  /* ------------------------------------------------------------ bootstrap */

  async function boot() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.view = tab.dataset.view;
        window.location.hash = tab.dataset.view;
        render();
      });
    });
    $("#logout").addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
      window.location.href = "/";
    });
    $("#form-dialog-close").addEventListener("click", () => $("#form-dialog").close());
    $("#form-dialog-cancel").addEventListener("click", () => $("#form-dialog").close());

    if (window.location.pathname.startsWith("/find")) {
      await renderPublic();
      document.dispatchEvent(new CustomEvent("callibrate:ready", { detail: { view: "public" } }));
      return;
    }

    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      const payload = { username: form.username.value, password: form.password.value };
      try {
        const result = await api("/api/auth/login", { body: payload });
        state.user = result.user;
        state.csrf = result.csrf_token;
        await showConsole();
      } catch (error) {
        $("#login-error").textContent = error.message;
      }
    });

    try {
      const me = await api("/api/auth/me");
      state.user = me.user;
      state.csrf = me.csrf_token;
      await showConsole();
    } catch {
      $("#login-view").hidden = false;
      document.dispatchEvent(new CustomEvent("callibrate:ready", { detail: { view: "login" } }));
    }
  }

  async function showConsole() {
    $("#login-view").hidden = true;
    $("#app-view").hidden = false;
    const hash = window.location.hash.replace("#", "");
    if (["queue", "decisions", "directory", "ledger"].includes(hash)) state.view = hash;
    await loadConsole();
    document.dispatchEvent(new CustomEvent("callibrate:ready", { detail: { view: "console" } }));
  }

  async function showPublicView() {
    // Used by the guided walkthrough so the film can move between the two
    // audiences without a page load taking the narration with it.
    document.body.classList.add("public");
    $("#login-view").hidden = true;
    $("#app-view").hidden = true;
    $("#public-view").hidden = false;
    if (!$("#search-form").dataset.bound) {
      $("#search-form").dataset.bound = "1";
      $("#search-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await search();
      });
    }
    window.history.replaceState({}, "", "/find");
    await search();
  }

  function showConsoleView() {
    document.body.classList.remove("public");
    $("#public-view").hidden = true;
    $("#login-view").hidden = true;
    $("#app-view").hidden = false;
    window.history.replaceState({}, "", "/");
    render();
  }

  window.callibrate = {
    state,
    api,
    search,
    selectTask,
    loadConsole,
    render,
    showPublicView,
    showConsoleView,
    signIn: async (username, password) => {
      const result = await api("/api/auth/login", { body: { username, password } });
      state.user = result.user;
      state.csrf = result.csrf_token;
      await showConsole();
    },
    setView: (view) => {
      state.view = view;
      render();
    },
    reveal: (count) => {
      window.__CBR_REVEAL = count;
      render();
    },
  };

  boot();
})();
