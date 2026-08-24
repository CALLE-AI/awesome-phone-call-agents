"use client";

import { useActionState, useEffect, useState } from "react";
import { startWatch, type StartWatchState } from "@/app/actions";
import { SPECIALTIES } from "@/core/specialties";

const initialState: StartWatchState = { ok: false, error: "" };

export function StartWatchForm() {
  const [state, action, pending] = useActionState(startWatch, initialState);
  const [need, setNeed] = useState("");
  const [showCrisis, setShowCrisis] = useState(false);

  useEffect(() => {
    if (state.ok) {
      window.location.href = `/watch/${encodeURIComponent(state.watch.id)}`;
    }
  }, [state]);

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
      <div>
        <label htmlFor="need" className="mb-1.5 block text-sm font-medium text-zinc-300">
          What care are you looking for?
        </label>
        <input
          id="need"
          name="need"
          required
          minLength={3}
          maxLength={140}
          value={need}
          onChange={(e) => setNeed(e.target.value)}
          placeholder="e.g. adult ADHD evaluation"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
          autoComplete="off"
        />
        <p className="mt-1.5 text-xs text-zinc-500">
          Keep it general. We never collect your diagnosis, condition, or medications — only the
          type of care, so no protected health information touches the phone call.
        </p>
      </div>

      <div>
        <label htmlFor="specialty" className="mb-1.5 block text-sm font-medium text-zinc-300">
          Specialty
        </label>
        <select
          id="specialty"
          name="specialty"
          defaultValue="psychiatry"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 focus:border-zinc-500 focus:outline-none"
        >
          {SPECIALTIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-zinc-500">
          We only call listings registered under this specialty in NPPES, so we never dial the
          wrong kind of practice.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="plan" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Insurance plan
          </label>
          <input
            id="plan"
            name="plan"
            required
            minLength={2}
            placeholder="e.g. Aetna PPO"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="location" className="mb-1.5 block text-sm font-medium text-zinc-300">
            City, state
          </label>
          <input
            id="location"
            name="location"
            required
            minLength={2}
            placeholder="e.g. Philadelphia, PA"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            autoComplete="off"
          />
          <p className="mt-1.5 text-xs text-zinc-500">
            A state is required — we never guess which region to call.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="modality" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Modality
          </label>
          <select
            id="modality"
            name="modality"
            defaultValue="either"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 focus:border-zinc-500 focus:outline-none"
          >
            <option value="either">Either</option>
            <option value="in_person">In person</option>
            <option value="telehealth">Telehealth</option>
          </select>
        </div>
        <div>
          <label htmlFor="targetOpen" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Stop after finding
          </label>
          <select
            id="targetOpen"
            name="targetOpen"
            defaultValue="3"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 focus:border-zinc-500 focus:outline-none"
          >
            <option value="1">1 opening</option>
            <option value="3">3 openings</option>
            <option value="5">5 openings</option>
          </select>
        </div>
        <div>
          <label htmlFor="maxCallsPerRun" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Max calls per run
          </label>
          <select
            id="maxCallsPerRun"
            name="maxCallsPerRun"
            defaultValue="10"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 focus:border-zinc-500 focus:outline-none"
          >
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
          <p className="mt-1.5 text-xs text-zinc-500">
            Each run places at most this many calls.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3">
        <label className="flex items-start gap-2 text-sm text-zinc-300">
          <input
            id="authorizeRecipients"
            name="authorizeRecipients"
            type="checkbox"
            value="on"
            required
            className="mt-0.5 h-4 w-4 rounded border-zinc-600"
          />
          <span>
            I authorize Openings to place calls to the providers matching my search (specialty,
            city, and state) as framed from NPPES, up to the per-run call limit. I understand
            these are real phone calls to the numbers shown and that a public directory listing
            alone is not authorization — my check here is the authorization for this watch.
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? "Starting…" : "Start watching"}
        </button>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-zinc-600"
            onChange={(e) => setShowCrisis(e.target.checked)}
          />
          I&apos;m in crisis and need urgent help
        </label>
      </div>

      {showCrisis && (
        <div role="alert" className="rounded-lg border border-amber-700 bg-amber-950/40 p-4 text-sm text-amber-200">
          If you&apos;re in crisis, please don&apos;t wait for an appointment search. In the US,
          call or text <strong>988</strong> (Suicide &amp; Crisis Lifeline) or dial{" "}
          <strong>911</strong>. There are people who can help right now.
        </div>
      )}

      {state.ok === true && (
        <p role="status" className="text-sm text-emerald-400">
          Watch started. {state.simulated ? "Runs in simulated mode — no real calls placed." : ""}
        </p>
      )}
      {state.ok === false && state.error && (
        <p role="alert" className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
          {state.error}
        </p>
      )}
    </form>
  );
}
