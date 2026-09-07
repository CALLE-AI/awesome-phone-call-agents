"use client";

import { useEffect, useState, useCallback } from "react";

interface Subscriber {
  id: string;
  name: string;
  phone: string;
  email: string;
  plan_name: string;
  amount_cents: number;
  status: string;
}

interface CallPreview {
  task: string;
  recipient: { phone: string; region: string; locale: string };
}

interface CallLogRow {
  id: string;
  subscriber_id: string;
  subscriber_name: string;
  subscriber_phone: string;
  plan_name: string;
  calle_call_id: string | null;
  trigger_reason: string;
  status: string;
  decision: string | null;
  evidence: string | null;
  created_at: string;
  completed_at: string | null;
  preview: CallPreview | null;
}

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  active: { bg: "var(--success-soft)", fg: "var(--success)", label: "Active" },
  past_due: { bg: "var(--alert-soft)", fg: "var(--alert)", label: "Past due" },
  paused: { bg: "var(--neutral-status-soft)", fg: "var(--neutral-status)", label: "Paused" },
};

const CALL_STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  pending_confirmation: { bg: "var(--alert-soft)", fg: "var(--alert)", label: "Awaiting confirmation" },
  in_progress: { bg: "var(--neutral-status-soft)", fg: "var(--neutral-status)", label: "Calling…" },
  completed: { bg: "var(--success-soft)", fg: "var(--success)", label: "Completed" },
  failed: { bg: "var(--alert-soft)", fg: "var(--alert)", label: "Failed" },
  canceled: { bg: "var(--neutral-status-soft)", fg: "var(--neutral-status)", label: "Canceled" },
};

const DECISION_LABEL: Record<string, string> = {
  retry_now: "Chose to retry now",
  update_card: "Asked to update card",
  pause_subscription: "Asked to pause",
  no_answer: "Didn't answer",
  unknown: "Unclear outcome",
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.paused;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm"
      style={{ background: s.bg, color: s.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.fg }} />
      {s.label}
    </span>
  );
}

export default function Dashboard() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [subsRes, callsRes] = await Promise.all([fetch("/api/subscribers"), fetch("/api/calls")]);
    setSubscribers(await subsRes.json());
    setCalls(await callsRes.json());
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function seed() {
    await fetch("/api/subscribers/seed", { method: "POST" });
    refresh();
  }

  // Step 1 of 2: this only runs a Stripe test decline and records a PENDING
  // call -- it does not place any CALL-E call. See app/api/stripe/simulate-failure/route.ts.
  async function simulateFailure(subscriberId: string) {
    setBusyId(subscriberId);
    setError(null);
    try {
      const res = await fetch("/api/stripe/simulate-failure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriberId }),
      });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        // response had no JSON body -- fall through to the generic message below
      }
      if (!res.ok) {
        setError(data.error ?? `Something went wrong (HTTP ${res.status})`);
      }
    } finally {
      setBusyId(null);
      refresh();
    }
  }

  // Step 2 of 2: the ONLY action that actually places a real CALL-E call,
  // and only reachable after reviewing the exact preview text below.
  async function confirmCall(callLogId: string) {
    setBusyId(callLogId);
    setError(null);
    try {
      const res = await fetch("/api/calle/place-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callLogId }),
      });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {}
      if (!res.ok) {
        setError(data.error ?? `Something went wrong (HTTP ${res.status})`);
      }
    } finally {
      setBusyId(null);
      refresh();
    }
  }

  async function cancelCall(callLogId: string) {
    setBusyId(callLogId);
    try {
      await fetch("/api/calle/cancel-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callLogId }),
      });
    } finally {
      setBusyId(null);
      refresh();
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <header className="mb-10 border-b pb-6" style={{ borderColor: "var(--line)" }}>
        <h1 className="font-display text-3xl" style={{ color: "var(--ink)" }}>
          Recover
        </h1>
        <p className="mt-1 max-w-lg text-sm" style={{ color: "var(--ink-soft)" }}>
          When a payment fails, most tools send an email that gets ignored. Recover calls the
          customer instead, and gets a real decision on the spot. Every call is previewed and
          requires explicit confirmation before it's placed.
        </p>
      </header>

      {error && (
        <div
          className="mb-6 rounded-md px-4 py-3 text-sm"
          style={{ background: "var(--alert-soft)", color: "var(--alert)" }}
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl">Subscribers</h2>
            <button
              onClick={seed}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-black/[.03]"
              style={{ borderColor: "var(--line)" }}
            >
              Add test subscriber
            </button>
          </div>

          {subscribers.length === 0 && (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              No subscribers yet. Add a test subscriber to get started, then edit its phone
              number in the seed route to your own number so calls actually ring.
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {subscribers.map((sub) => (
              <li
                key={sub.id}
                className="rounded-lg border p-4"
                style={{ borderColor: "var(--line)", background: "var(--card)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{sub.name}</p>
                    <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                      {sub.plan_name} · ${(sub.amount_cents / 100).toFixed(2)}/mo · {sub.phone}
                    </p>
                  </div>
                  <StatusPill status={sub.status} />
                </div>
                <button
                  onClick={() => simulateFailure(sub.id)}
                  disabled={busyId === sub.id || sub.status === "past_due"}
                  className="mt-3 rounded-md px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  style={{ background: "var(--alert)" }}
                >
                  {busyId === sub.id
                    ? "Working…"
                    : sub.status === "past_due"
                    ? "Failure already pending"
                    : "Simulate payment failure"}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-4 font-display text-xl">Call activity</h2>

          {calls.length === 0 && (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              No calls yet. Trigger a simulated failure to see a call preview here.
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {calls.map((call) => {
              const s = CALL_STATUS_STYLES[call.status] ?? CALL_STATUS_STYLES.canceled;
              return (
                <li
                  key={call.id}
                  className="rounded-lg border p-4"
                  style={{ borderColor: "var(--line)", background: "var(--card)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{call.subscriber_name}</p>
                      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                        {call.plan_name} · {call.trigger_reason}
                      </p>
                    </div>
                    <span
                      className="rounded-full px-2.5 py-1 text-sm"
                      style={{ background: s.bg, color: s.fg }}
                    >
                      {s.label}
                    </span>
                  </div>

                  {call.status === "pending_confirmation" && call.preview && (
                    <div className="mt-3 rounded-md border p-3" style={{ borderColor: "var(--line)" }}>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>
                        This is exactly what will be sent to CALL-E
                      </p>
                      <p className="mb-1 text-sm">
                        <strong>To:</strong> {call.preview.recipient.phone} ({call.preview.recipient.region},{" "}
                        {call.preview.recipient.locale})
                      </p>
                      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                        {call.preview.task}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => confirmCall(call.id)}
                          disabled={busyId === call.id}
                          className="rounded-md px-3 py-1.5 text-sm text-white disabled:opacity-50"
                          style={{ background: "var(--success)" }}
                        >
                          {busyId === call.id ? "Placing call…" : "Confirm & place call"}
                        </button>
                        <button
                          onClick={() => cancelCall(call.id)}
                          disabled={busyId === call.id}
                          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                          style={{ borderColor: "var(--line)" }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {call.decision && (
                    <p className="mt-2 text-sm">
                      <strong>{DECISION_LABEL[call.decision] ?? call.decision}</strong>
                      {call.evidence && <span style={{ color: "var(--ink-soft)" }}> — "{call.evidence}"</span>}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}