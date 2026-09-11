"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { readJson } from "@/lib/read-json";
import { Button } from "@/components/ui/button";

/**
 * "Has it landed yet?"
 *
 * CALL-E's queue has run well past an hour - longer than anyone will keep
 * a page open, and far longer than a demo. The browser stops watching a call
 * after 20 minutes, and until now the only thing that collected what arrived
 * afterwards was a scheduled sweep the viewer could neither see nor trigger.
 *
 * This is that sweep, asked for by a person. It is not a substitute for the
 * schedule and does not replace it: it is the difference between "the rate
 * will appear at some point" and being able to press a button and have it
 * appear now.
 *
 * It reports what happened in all three cases, including the boring one -
 * "nothing new" is an answer, and a button that goes quiet when it finds
 * nothing is a button nobody trusts twice.
 */
interface SweepResult {
  checked?: number;
  resolved?: number;
  stillRunning?: number;
  note?: string;
}

export function CheckForUpdates({
  onSettled,
  className,
}: {
  /** Called only when something actually settled, so the caller can refresh. */
  onSettled?: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setMessage(null);
    const res = await readJson<SweepResult>(
      await fetch("/api/calle/reconcile", { method: "POST" })
    );
    setBusy(false);

    if (!res.ok || !res.data) {
      setMessage(res.error ?? "Could not check just now.");
      return;
    }

    const { checked = 0, resolved = 0, stillRunning = 0, note } = res.data;
    if (note) {
      setMessage(note);
      return;
    }
    if (resolved > 0) {
      setMessage(
        `${resolved} call${resolved === 1 ? "" : "s"} settled` +
        (stillRunning > 0 ? `, ${stillRunning} still with CALL-E.` : ".")
      );
      onSettled?.();
      return;
    }
    if (stillRunning > 0) {
      /* The common case while the queue is bad, and the one worth wording
         carefully: nothing has gone wrong, the call simply has not been
         dialled yet. */
      setMessage(
        `Nothing new yet — ${stillRunning} call${stillRunning === 1 ? " is" : "s are"} still queued at CALL-E.`
      );
      return;
    }
    setMessage(checked === 0 ? "No calls are waiting on a result." : "Nothing new yet.");
  }

  return (
    <div className={`flex flex-wrap items-center justify-end gap-3 ${className ?? ""}`}>
      {message && <span className="text-small text-text-muted">{message}</span>}
      <Button variant="outline" size="sm" onClick={check} disabled={busy}>
        <RotateCcw aria-hidden strokeWidth={1.75} className={busy ? "animate-spin" : undefined} />
        {busy ? "Checking…" : "Check for updates"}
      </Button>
    </div>
  );
}
