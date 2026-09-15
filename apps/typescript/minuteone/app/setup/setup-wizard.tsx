"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IdentityFields } from "@/components/business-config/identity-fields";
import { QuestionsBuilder } from "@/components/business-config/questions-builder";
import { LeadForm } from "@/app/lead-form";
import type { BusinessConfig } from "@/lib/config/schema";

type Step = "business" | "questions" | "live";

const STEP_LABELS: Record<Step, string> = {
  business: "Step 1 of 3 — About your business",
  questions: "Step 2 of 3 — Qualifying questions",
  live: "Step 3 of 3 — Your live form",
};

export function SetupWizard({ initialConfig }: { initialConfig: BusinessConfig }) {
  const [step, setStep] = useState<Step>("business");
  const [config, setConfig] = useState<BusinessConfig>(initialConfig);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    setSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ? JSON.stringify(body.error) : "Something went wrong. Please try again.");
      return;
    }

    setStep("live");
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-sm font-medium text-muted-foreground">{STEP_LABELS[step]}</p>

      {step === "business" && (
        <Card>
          <CardHeader>
            <CardTitle>Tell us about your business</CardTitle>
            <CardDescription>
              This becomes the opening line MinuteOne uses when it calls your prospects back.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <IdentityFields
              value={config.business}
              onChange={(business) => setConfig((prev) => ({ ...prev, business }))}
            />
            <Button
              onClick={() => setStep("questions")}
              disabled={!config.business.name.trim() || !config.business.openingLine.trim()}
            >
              Continue
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "questions" && (
        <Card>
          <CardHeader>
            <CardTitle>Set your qualifying questions</CardTitle>
            <CardDescription>
              3–5 questions MinuteOne asks every prospect, scored into a qualified / not-qualified
              decision.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <QuestionsBuilder
              questions={config.questions}
              onChange={(questions) => setConfig((prev) => ({ ...prev, questions }))}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={handleGenerate} disabled={submitting}>
              {submitting ? "Generating…" : "Generate my live form"}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "live" && (
        <Card>
          <CardHeader>
            <CardTitle>Your form is live — try it</CardTitle>
            <CardDescription>
              Submit a test lead below. MinuteOne will call it back using the business info and
              questions you just set (dry-run by default — no real call is placed).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <LeadForm />
            <Link href="/review" className="text-center text-sm text-primary underline underline-offset-2">
              Watch it dispatch in the review console
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
