"use client";

import { useMemo, useState } from "react";
import { verticals, batchPresets } from "@/src/goals";

export type CallRequest =
  | { mode: "single"; verticalId: string; presetId: string; goal: string }
  | { mode: "batch"; batchPresetId: string };

type Mode = "single" | "batch";

// One errand picker. The accessibility relay is the product; civic-office errands
// ride along as an optgroup to show the same engine is one config away, not a
// second product with its own tab.
const GROUP_LABEL: Record<string, string> = {
  accessibility: "Everyday errands",
  civic: "Government and utility offices (same engine, different config)",
};

const firstVertical = verticals[0]!;
const firstPreset = firstVertical.presets[0]!;
const keyOf = (verticalId: string, presetId: string) => `${verticalId}:${presetId}`;

export function GoalComposer({
  onSubmit,
  disabled,
}: {
  onSubmit: (req: CallRequest) => void;
  disabled: boolean;
}) {
  const [mode, setMode] = useState<Mode>("single");

  // Single-call state
  const [selection, setSelection] = useState(keyOf(firstVertical.id, firstPreset.id));
  const { vertical, preset } = useMemo(() => {
    const [vId, pId] = selection.split(":");
    const v = verticals.find((x) => x.id === vId) ?? firstVertical;
    const p = v.presets.find((x) => x.id === pId) ?? v.presets[0]!;
    return { vertical: v, preset: p };
  }, [selection]);
  const [goal, setGoal] = useState(firstPreset.goalText);

  // Batch state
  const [batchPresetId, setBatchPresetId] = useState(batchPresets[0]!.id);
  const batchPreset = useMemo(
    () => batchPresets.find((p) => p.id === batchPresetId) ?? batchPresets[0]!,
    [batchPresetId],
  );

  function switchPreset(key: string) {
    setSelection(key);
    const [vId, pId] = key.split(":");
    const p = verticals.find((x) => x.id === vId)?.presets.find((x) => x.id === pId);
    if (p) setGoal(p.goalText);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "batch") onSubmit({ mode: "batch", batchPresetId });
    else onSubmit({ mode: "single", verticalId: vertical.id, presetId: preset.id, goal });
  }

  return (
    <form className="rounded-xl border border-border bg-surface p-5" onSubmit={submit}>
      <div className="mb-5 inline-flex rounded-lg border border-border p-1" role="group" aria-label="Call one place or compare several">
        {(["single", "batch"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
              mode === m ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
            }`}
          >
            {m === "single" ? "One call" : "Compare places"}
          </button>
        ))}
      </div>

      {mode === "single" ? (
        <>
          <div className="mb-4">
            <label htmlFor="preset" className="mb-1 block font-semibold">Pick an errand</label>
            <select
              id="preset"
              value={selection}
              onChange={(e) => switchPreset(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-foreground"
            >
              {verticals.map((v) => (
                <optgroup key={v.id} label={GROUP_LABEL[v.id] ?? v.title}>
                  {v.presets.map((p) => (
                    <option key={p.id} value={keyOf(v.id, p.id)}>{p.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {vertical.id !== "accessibility" && (
              <p className="mt-2 text-sm text-muted-foreground">{vertical.tagline}</p>
            )}
          </div>

          <div className="mb-5">
            <label htmlFor="goal" className="mb-1 block font-semibold">
              What should we ask? <span className="font-normal text-muted-foreground">(you can edit this)</span>
            </label>
            <textarea
              id="goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-foreground"
            />
          </div>
        </>
      ) : (
        <div className="mb-5">
          <label htmlFor="batch-preset" className="mb-1 block font-semibold">Compare across places</label>
          <select
            id="batch-preset"
            value={batchPresetId}
            onChange={(e) => setBatchPresetId(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-foreground"
          >
            {batchPresets.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <p className="mt-2 text-sm text-muted-foreground">
            We&apos;ll call all {batchPreset.recipients.length} and rank them, but only recommend a place whose answer we can actually verify:
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
            {batchPreset.recipients.map((r) => (
              <li key={r.id}>{r.label}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="submit"
        disabled={disabled}
        className="w-full rounded-lg bg-primary px-4 py-3 text-lg font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {disabled ? "Calling…" : mode === "batch" ? `Call all ${batchPreset.recipients.length} & compare` : "Make the call for me"}
      </button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        The agent discloses it is calling on your behalf. Demo runs on a mocked call; no real number is dialed.
        On the live path, once a call is accepted it runs to completion on CALL-E&apos;s side even if you close this
        page — there is no cancel from here.
      </p>
    </form>
  );
}
