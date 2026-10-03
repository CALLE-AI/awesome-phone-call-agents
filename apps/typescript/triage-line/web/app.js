/**
 * Switchboard UI.
 *
 * No build step: React is loaded via CDN in index.html and we use
 * React.createElement (aliased to `h`) directly. The app:
 *   - lets you pick a scenario and start a run (POST /api/runs)
 *   - subscribes to the run's SSE stream and re-renders from each snapshot
 *   - narrates the orchestrator's actions in a live activity feed
 *   - shows a live node/graph view and, for fan-out, a triage table
 *   - lets a reviewer approve flagged nodes with an optional note
 *
 * Accessibility notes are inline where they matter (live regions, table
 * semantics, status conveyed by text + icon, keyboard-operable controls).
 */

const h = React.createElement;
const { useState, useEffect, useRef, useCallback } = React;

const STATUS_LABEL = {
  pending: "Pending",
  blocked: "Blocked",
  awaiting_approval: "Awaiting approval",
  running: "Calling…",
  done: "Done",
  needs_review: "Needs review",
  needs_user: "Needs you",
  failed: "Failed",
};

const URGENCY_RANK = { high: 0, medium: 1, low: 2, none: 3 };

const SCENARIOS = {
  reachback: {
    label: "Reachback (fan-out welfare check)",
    oneLiner:
      "Fan-out: call many residents at once after an outage, triage who's safe, and auto-escalate anyone who needs help to a GP.",
  },
  runaround: {
    label: "Referral Runaround (chain)",
    oneLiner:
      "Chain: each call reveals the next step and number to dial — clinic to GP to insurer to booked — discovered autonomously.",
  },
};

/** Friendly display name for a node id. */
function niceName(id) {
  if (id.startsWith("gp-")) return `GP follow-up (${id.slice(3)})`;
  return id;
}

/**
 * Turn a raw SSE event + snapshot into a human-readable narration line, or null
 * to skip. This is the "agent thinking out loud" story.
 */
function narrate(event) {
  const snap = event.snapshot;
  const node = snap?.nodes?.find((n) => n.id === event.nodeId);
  switch (event.type) {
    case "snapshot": {
      const count = snap?.nodes?.length ?? 0;
      if (count === 0) return null;
      return {
        tone: "start",
        text:
          snap.mode === "fan_out"
            ? `Starting welfare check — dialing ${count} resident${count === 1 ? "" : "s"} in parallel.`
            : `Starting referral chain — placing the first call.`,
      };
    }
    case "node_start":
      return {
        tone: "dial",
        text: `Dialing ${niceName(event.nodeId)}${node ? ` (${node.locale})` : ""}…`,
      };
    case "node_retry_language":
      return {
        tone: "retry",
        text: `${niceName(event.nodeId)} answered in another language — re-dialing ${event.from} → ${event.to}.`,
      };
    case "node_done": {
      if (!node) return { tone: "done", text: `${niceName(event.nodeId)} finished.` };
      const urgency = node.result?.urgency;
      const needs = Array.isArray(node.result?.needs)
        ? node.result.needs.join(", ")
        : "";
      if (node.status === "done" && (urgency === "high" || node.result?.safe === false)) {
        return {
          tone: "alert",
          text: `${niceName(event.nodeId)} needs help${needs ? ` (${needs})` : ""} — flagging as urgent.`,
        };
      }
      if (node.status === "needs_review") {
        const why = node.verification?.notes?.slice(-1)[0] ?? "could not verify";
        return { tone: "review", text: `${niceName(event.nodeId)} needs review — ${why}` };
      }
      if (node.status === "needs_user") {
        return {
          tone: "alert",
          text: `${niceName(event.nodeId)} needs a human — ${node.verification?.policyFlags?.[0] ?? "policy check"}.`,
        };
      }
      if (node.status === "failed") {
        return { tone: "review", text: `${niceName(event.nodeId)} call failed.` };
      }
      return {
        tone: "done",
        text: `${niceName(event.nodeId)} — safe and well${
          node.confidence !== undefined ? ` (confidence ${node.confidence.toFixed(2)})` : ""
        }.`,
      };
    }
    case "node_spawned": {
      const spawned = snap?.nodes?.find((n) => n.id === event.nodeId);
      if (spawned?.requiresApproval) {
        return {
          tone: "escalate",
          text: `Proposed ${niceName(event.nodeId)} (from ${event.parentId}) — awaiting your authorization before it dials.`,
        };
      }
      return {
        tone: "escalate",
        text: `Next step: ${niceName(event.nodeId)} (from ${event.parentId}).`,
      };
    }
    case "node_approved":
      return {
        tone: "approve",
        text: `Authorized ${niceName(event.nodeId)} — placing the call.`,
      };
    case "run_paused": {
      const awaiting = (snap?.nodes ?? []).filter(
        (n) => n.status === "awaiting_approval"
      ).length;
      return {
        tone: "alert",
        text: `Paused: ${awaiting} call${awaiting === 1 ? "" : "s"} awaiting your authorization. Approve to continue.`,
      };
    }
    case "graph_done": {
      const nodes = snap?.nodes ?? [];
      const attention = nodes.filter(
        (n) => n.result?.urgency === "high" || n.status === "needs_user"
      ).length;
      const review = nodes.filter((n) => n.status === "needs_review").length;
      return {
        tone: "start",
        text: `Run complete. ${nodes.length} calls, ${attention} need attention now, ${review} need review.`,
      };
    }
    default:
      return null;
  }
}

const TONE_ICON = {
  start: "▶",
  dial: "📞",
  retry: "🌐",
  done: "✓",
  review: "⚠",
  alert: "🚨",
  escalate: "⤴",
  approve: "👤",
};

function StatusBadge({ status }) {
  const label = STATUS_LABEL[status] ?? status;
  // Icon + text so meaning never depends on color alone.
  return h(
    "span",
    { className: `badge s-${status}` },
    h("span", { className: "dot", "aria-hidden": "true" }),
    h("span", null, label)
  );
}

function isReviewable(node) {
  return (
    node.status === "needs_review" ||
    node.status === "needs_user" ||
    node.status === "awaiting_approval"
  );
}

/**
 * Approve control with an optional reviewer note. Clicking "Approve" reveals a
 * small note field; submitting sends the note to the backend.
 */
function ApproveControl({ node, onApprove, pending }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!isReviewable(node)) return null;

  // A consequential call proposed by escalation is authorized (it will then be
  // placed); a completed-but-flagged result is accepted.
  const isAuthorize = node.status === "awaiting_approval";
  const openLabel = isAuthorize ? "Authorize call…" : "Approve…";
  const confirmLabel = isAuthorize ? "Authorize · place call" : "Confirm · mark done";

  if (!open) {
    return h(
      "button",
      {
        className: "approve",
        onClick: () => setOpen(true),
        disabled: pending,
        "aria-label": `${openLabel} for ${node.id}`,
      },
      openLabel
    );
  }

  const submit = () => {
    onApprove(node.id, note.trim());
    setOpen(false);
    setNote("");
  };

  const inputId = `note-${node.id}`;
  return h(
    "div",
    { className: "approve-form" },
    node.proposedReason
      ? h("p", { className: "approve-reason" }, node.proposedReason)
      : null,
    h(
      "label",
      { htmlFor: inputId, className: "approve-label" },
      "Reviewer note (optional)"
    ),
    h("input", {
      id: inputId,
      type: "text",
      className: "approve-note",
      value: note,
      placeholder: "e.g. called back, resident is fine",
      disabled: pending,
      autoFocus: true,
      onChange: (e) => setNote(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") {
          setOpen(false);
          setNote("");
        }
      },
    }),
    h(
      "div",
      { className: "approve-actions" },
      h(
        "button",
        { className: "approve", onClick: submit, disabled: pending },
        pending ? "Working…" : confirmLabel
      ),
      h(
        "button",
        {
          className: "ghost",
          onClick: () => {
            setOpen(false);
            setNote("");
          },
          disabled: pending,
        },
        "Cancel"
      )
    )
  );
}

function NodeCard({ node, onApprove, pending }) {
  const deps = node.dependsOn?.length
    ? `depends on ${node.dependsOn.join(", ")}`
    : node.spawnedBy
    ? `from ${node.spawnedBy}`
    : "start";
  return h(
    "li",
    { className: "node" },
    h(
      "div",
      { className: "top" },
      h("span", { className: "id" }, node.id),
      h(StatusBadge, { status: node.status })
    ),
    h("p", { className: "goal" }, node.goal),
    h(
      "p",
      { className: "meta" },
      `${node.locale}`,
      node.confidence !== undefined
        ? ` · confidence ${node.confidence.toFixed(2)}`
        : "",
      node.attemptedLocales && node.attemptedLocales.length > 1
        ? ` · retried: ${node.attemptedLocales.join(" → ")}`
        : ""
    ),
    h("p", { className: "dep" }, deps),
    node.verification?.policyFlags?.length
      ? node.verification.policyFlags.map((f, i) =>
          h("p", { className: "flag", key: i }, `⛔ ${f}`)
        )
      : null,
    node.transcript?.length
      ? h(
          "details",
          { className: "transcript" },
          h("summary", null, `Transcript (${node.transcript.length} turns)`),
          node.transcript.map((t, i) =>
            h(
              "p",
              { className: "turn", key: i },
              h("span", { className: "who" }, `${t.speaker}:`),
              t.text
            )
          )
        )
      : null,
    h(ApproveControl, { node, onApprove, pending })
  );
}

function urgencyOf(node) {
  return String(node.result?.urgency ?? "none");
}

function TriageTable({ nodes, onApprove, pendingId }) {
  const rows = [...nodes].sort(
    (a, b) =>
      (URGENCY_RANK[urgencyOf(a)] ?? 3) - (URGENCY_RANK[urgencyOf(b)] ?? 3)
  );
  return h(
    "table",
    { className: "triage" },
    h(
      "caption",
      null,
      "Residents sorted by urgency. High-urgency rows are marked with a red left border and a High label."
    ),
    h(
      "thead",
      null,
      h(
        "tr",
        null,
        h("th", { scope: "col" }, "Status"),
        h("th", { scope: "col" }, "Urgency"),
        h("th", { scope: "col" }, "Node"),
        h("th", { scope: "col" }, "Needs"),
        h("th", { scope: "col" }, "Note"),
        h("th", { scope: "col" }, "Action")
      )
    ),
    h(
      "tbody",
      null,
      rows.map((n) => {
        const urgency = urgencyOf(n);
        const needs = Array.isArray(n.result?.needs)
          ? n.result.needs.join(", ") || "—"
          : "—";
        const note = n.verification?.notes?.slice(-1)[0] ?? "";
        return h(
          "tr",
          { key: n.id, className: `urgency-${urgency}` },
          h("td", null, h(StatusBadge, { status: n.status })),
          h(
            "td",
            null,
            h("span", { className: `pill pill-${urgency}` }, urgency)
          ),
          h("th", { scope: "row" }, n.id),
          h("td", null, needs),
          h("td", { className: "note" }, note),
          h(
            "td",
            null,
            h(ApproveControl, {
              node: n,
              onApprove,
              pending: pendingId === n.id,
            })
          )
        );
      })
    )
  );
}

function ChainView({ nodes, onApprove, pendingId }) {
  return h(
    "ol",
    { className: "nodes" },
    nodes.map((n) =>
      h(NodeCard, {
        node: n,
        key: n.id,
        onApprove,
        pending: pendingId === n.id,
      })
    )
  );
}

function SummaryCards({ nodes }) {
  const called = nodes.length;
  const attention = nodes.filter(
    (n) => urgencyOf(n) === "high" || n.status === "needs_user"
  ).length;
  const review = nodes.filter((n) => n.status === "needs_review").length;
  const done = nodes.filter((n) => n.status === "done").length;
  const cards = [
    { n: called, l: "Nodes" },
    { n: done, l: "Done" },
    { n: attention, l: "Need attention" },
    { n: review, l: "Need review" },
  ];
  return h(
    "div",
    { className: "summary-cards" },
    cards.map((c, i) =>
      h(
        "div",
        { className: "card", key: i },
        h("div", { className: "n" }, c.n),
        h("div", { className: "l" }, c.l)
      )
    )
  );
}

/** Live scrolling narration of the orchestrator's actions. */
function ActivityFeed({ items }) {
  const endRef = useRef(null);
  useEffect(() => {
    // Auto-scroll to the newest line.
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [items.length]);

  if (items.length === 0) {
    return h(
      "p",
      { className: "feed-empty" },
      "The orchestrator's actions will narrate here as the run progresses."
    );
  }
  return h(
    "ol",
    { className: "feed" },
    items.map((it) =>
      h(
        "li",
        { className: `feed-item tone-${it.tone}`, key: it.id },
        h("span", { className: "feed-time" }, it.time),
        h("span", { className: "feed-icon", "aria-hidden": "true" }, TONE_ICON[it.tone] ?? "•"),
        h("span", { className: "feed-text" }, it.text)
      )
    ),
    h("li", { ref: endRef, "aria-hidden": "true" })
  );
}

function App() {
  const [scenario, setScenario] = useState("reachback");
  const [snapshot, setSnapshot] = useState(null);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState("");
  const [runId, setRunId] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [activity, setActivity] = useState([]);
  const esRef = useRef(null);
  const feedSeq = useRef(0);

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => closeStream, [closeStream]);

  const announce = useCallback((msg) => setLive(msg), []);

  const pushActivity = useCallback((line) => {
    if (!line) return;
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setActivity((prev) => [
      ...prev,
      { id: feedSeq.current++, time, tone: line.tone, text: line.text },
    ]);
  }, []);

  const start = useCallback(async () => {
    closeStream();
    setSnapshot(null);
    setActivity([]);
    setRunning(true);
    announce(`Starting ${scenario} run…`);

    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      announce(`Failed to start: ${err.error ?? res.statusText}`);
      setRunning(false);
      return;
    }
    const { id } = await res.json();
    setRunId(id);

    const es = new EventSource(`/api/runs/${id}/events`);
    esRef.current = es;
    es.onmessage = (ev) => {
      const event = JSON.parse(ev.data);
      setSnapshot(event.snapshot);

      // Narrate the event into the activity feed.
      const line = narrate(event);
      pushActivity(line);
      if (line) announce(line.text);

      if (event.type === "run_paused") {
        // Paused for human authorization. Keep the stream OPEN so approving a
        // node resumes and we receive the follow-on events.
        setRunning(false);
      } else if (event.type === "graph_done") {
        setRunning(false);
        closeStream();
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; only report if the run wasn't finishing.
      if (esRef.current) announce("Stream interrupted, reconnecting…");
    };
  }, [scenario, announce, closeStream, pushActivity]);

  const approve = useCallback(
    async (nodeId, note) => {
      if (!runId) return;
      setPendingId(nodeId);
      announce(`Approving ${nodeId}…`);
      try {
        const res = await fetch(`/api/runs/${runId}/nodes/${nodeId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(note ? { note } : {}),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          announce(`Could not approve ${nodeId}: ${err.error ?? res.statusText}`);
          return;
        }
        const { snapshot: updated } = await res.json();
        if (updated) setSnapshot(updated);
      } catch (e) {
        announce(`Could not approve ${nodeId}: ${String(e)}`);
      } finally {
        setPendingId(null);
      }
    },
    [runId, announce]
  );

  const nodes = snapshot?.nodes ?? [];
  const isFanOut = snapshot?.mode === "fan_out" || scenario === "reachback";
  const active = SCENARIOS[scenario];

  return h(
    React.Fragment,
    null,
    h(
      "header",
      { className: "app" },
      h("h1", null, "Switchboard"),
      h(
        "p",
        { className: "tagline" },
        "CALL-E makes the phone calls. Switchboard is the brain that decides what to do between them — verifying results, enforcing consent, and self-healing across language barriers."
      ),
      h(
        "div",
        { className: "scenario-cards" },
        Object.entries(SCENARIOS).map(([key, s]) =>
          h(
            "div",
            {
              className: `scenario-card${scenario === key ? " selected" : ""}`,
              key,
            },
            h("div", { className: "scenario-name" }, s.label),
            h("div", { className: "scenario-desc" }, s.oneLiner)
          )
        )
      )
    ),
    h(
      "main",
      { id: "main" },
      h(
        "section",
        { className: "panel", "aria-labelledby": "controls-h" },
        h("h2", { id: "controls-h" }, "Start a run"),
        h(
          "div",
          { className: "controls" },
          h(
            "div",
            { className: "field" },
            h("label", { htmlFor: "scenario" }, "Scenario"),
            h(
              "select",
              {
                id: "scenario",
                value: scenario,
                disabled: running,
                onChange: (e) => setScenario(e.target.value),
              },
              Object.entries(SCENARIOS).map(([key, s]) =>
                h("option", { value: key, key }, s.label)
              )
            )
          ),
          h(
            "button",
            {
              className: "primary",
              onClick: start,
              disabled: running,
              "aria-busy": running ? "true" : "false",
            },
            running ? "Running…" : "Start run"
          )
        ),
        h("p", { className: "active-desc" }, active.oneLiner),
        h(
          "p",
          { className: "status-line" },
          snapshot
            ? `State: ${snapshot.state} · scenario: ${snapshot.scenario} · mode: ${snapshot.mode}`
            : "No run yet. Pick a scenario and press Start."
        )
      ),

      // Live region: screen readers hear progress without moving focus.
      h(
        "div",
        {
          className: "visually-hidden",
          role: "status",
          "aria-live": "polite",
          "aria-atomic": "true",
        },
        live
      ),

      // Activity feed — the "agent thinking out loud" narration.
      h(
        "section",
        { className: "panel", "aria-labelledby": "feed-h" },
        h("h2", { id: "feed-h" }, "Agent activity"),
        h(ActivityFeed, { items: activity })
      ),

      snapshot
        ? h(
            "section",
            { className: "panel", "aria-labelledby": "summary-h" },
            h("h2", { id: "summary-h" }, "Summary"),
            h(SummaryCards, { nodes })
          )
        : null,

      snapshot && isFanOut
        ? h(
            "section",
            { className: "panel", "aria-labelledby": "triage-h" },
            h("h2", { id: "triage-h" }, "Triage"),
            h(TriageTable, { nodes, onApprove: approve, pendingId })
          )
        : null,

      snapshot
        ? h(
            "section",
            { className: "panel", "aria-labelledby": "nodes-h" },
            h("h2", { id: "nodes-h" }, isFanOut ? "Calls" : "Call chain"),
            h(ChainView, { nodes, onApprove: approve, pendingId })
          )
        : null
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App));
