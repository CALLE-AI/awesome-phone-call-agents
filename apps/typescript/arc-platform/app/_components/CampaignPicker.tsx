"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Plus } from "lucide-react";

export interface BrandCampaign {
  id: string;
  name: string;
}

/**
 * "Add to campaign", wired to the brand's actual campaigns.
 *
 * Both directories used to render two `<option>` literals - "Herbion Shampoo -
 * Q1 2025" and "Shan Masalas - Ramadan" - which belonged to nobody and did
 * nothing. A brand looking for its own campaign found two it had never heard
 * of, which is worse than an empty list: an empty list is a state you can act
 * on, and a fake list is a bug you have to work out.
 *
 * With no campaigns it says so and offers the one action that helps. It does
 * not invent a placeholder to look populated.
 */
export function CampaignSelect({
  campaigns,
  value,
  onChange,
  newHref,
}: {
  campaigns: BrandCampaign[];
  value: string;
  onChange: (id: string) => void;
  /** Where "+ New Campaign" goes, carrying whatever the caller wants to keep. */
  newHref: string;
}) {
  const box: React.CSSProperties = {
    background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 8,
    padding: "10px 14px", fontSize: 13, minWidth: 240, outline: "none",
  };

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <div style={{ ...box, color: "var(--text-muted)" }}>No campaigns yet</div>
        <Link
          href={newHref}
          className="flex items-center gap-1.5 text-small text-lilac-deep underline underline-offset-2"
        >
          <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
          Create one
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === "__new") return;
          onChange(e.target.value);
        }}
        style={{ ...box, color: value ? "var(--text)" : "var(--text-muted)", cursor: "pointer" }}
      >
        <option value="">Select campaign ▾</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <Link
        href={newHref}
        className="flex items-center gap-1.5 text-small text-text-muted underline underline-offset-2"
      >
        <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
        New campaign
      </Link>
    </div>
  );
}

/** What happened to one add, so the card can say it rather than a toast that
 *  disappears before anyone reads it. */
export type AddState =
  | { kind: "idle" }
  | { kind: "adding" }
  | { kind: "added"; campaignName: string; already: boolean }
  | { kind: "error"; message: string };

export function useAddToCampaign() {
  const [state, setState] = useState<Record<string, AddState>>({});

  async function add(externalId: string, kind: "STATION" | "CREATOR", campaignId: string) {
    setState((s) => ({ ...s, [externalId]: { kind: "adding" } }));
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalId, kind }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; campaignName?: string; alreadyPresent?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setState((s) => ({
          ...s,
          [externalId]: { kind: "error", message: data?.error ?? "Could not add it. Try again." },
        }));
        return;
      }
      setState((s) => ({
        ...s,
        [externalId]: {
          kind: "added",
          campaignName: data.campaignName ?? "the campaign",
          already: Boolean(data.alreadyPresent),
        },
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        [externalId]: { kind: "error", message: e instanceof Error ? e.message : String(e) },
      }));
    }
  }

  return { state, add };
}

/** The confirmation line under a card. Says which campaign, by name. */
export function AddResult({ state }: { state: AddState | undefined }) {
  if (!state || state.kind === "idle") return null;
  if (state.kind === "adding") return <p className="text-small text-text-muted">Adding…</p>;
  if (state.kind === "error") return <p className="text-small text-danger">{state.message}</p>;
  return (
    <p className="flex items-center gap-1.5 text-small text-success">
      <Check aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
      {state.already ? "Already in" : "Added to"} {state.campaignName}
    </p>
  );
}
