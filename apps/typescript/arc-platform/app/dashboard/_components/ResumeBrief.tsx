"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WIZARD_STEPS } from "@/app/campaigns/create/_components/WizardChrome";

/**
 * Surfaces an unfinished brief so it can be resumed from the app shell rather
 * than only from the campaigns page.
 *
 * Reads WizardProvider's storage; it does not write to it and does not change
 * its state shape. The key and expiry below MIRROR the constants inside
 * WizardContext (`arc_campaign_wizard`, 24h) - that file is out of scope, so
 * they cannot be imported. If they change there, change them here.
 *
 * Discard removes the same key, which is the only way to clear a brief today.
 */
const STORAGE_KEY = "arc_campaign_wizard";
const EXPIRY_MS = 24 * 60 * 60 * 1000;

const TITLE = "You have an unfinished brief";
const RESUME = "Pick up where you left off";
const DISCARD = "Discard";

export default function ResumeBrief() {
  const [step, setStep] = useState<string | null>(null);
  const [productName, setProductName] = useState<string>("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const { state, savedAt } = JSON.parse(raw);
      if (Date.now() - savedAt >= EXPIRY_MS) return;
      if (!state?.step || state.step === "generating") return;
      // Only surface a brief that has actually been started.
      if (!state?.brief?.productName?.trim()) return;
      setStep(state.step);
      setProductName(state.brief.productName);
    } catch { /* ignore */ }
  }, []);

  if (!step || dismissed) return null;

  const label = WIZARD_STEPS.find(s => s.key === step)?.label ?? step;

  function discard() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setDismissed(true);
  }

  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card bg-lilac p-4 sm:px-6">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-small font-medium text-ink">{TITLE}</span>
        <span className="text-small text-ink/70">
          {productName} — you stopped at {label}. Arc keeps it for 24 hours.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild size="sm">
          <Link href="/campaigns/create">{RESUME}</Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={discard}>
          <X aria-hidden strokeWidth={1.75} />
          {DISCARD}
        </Button>
      </div>
    </section>
  );
}
