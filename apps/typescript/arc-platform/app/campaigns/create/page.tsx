"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WizardProvider, useWizard } from "./_components/WizardContext";
import { UserButton } from "@clerk/nextjs";

import { arcUserButtonAppearance } from "@/components/auth/appearance";
import { OverallProgress, WIZARD_STEPS, type WizardStepKey } from "./_components/WizardChrome";
import { WizardExit } from "./_components/WizardExit";
import StepBrief from "./_components/StepBrief";
import StepGenerating from "./_components/StepGenerating";
import StepScripts from "./_components/StepScripts";
import StepSelect from "./_components/StepSelect";
import StepReview from "./_components/StepReview";

const STEPS = WIZARD_STEPS.map(s => s.key) as readonly WizardStepKey[];
type Step = WizardStepKey;

function WizardShell() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, dispatch } = useWizard();
  const urlStep = (params.get("step") as Step) || "brief";
  const add = params.get("add");

  /* Carried in from a directory. Validated server-side when the plan is
     generated - an id that is not in the catalogue is dropped there, in
     silence. Nothing here needs to know whether it is real. */
  useEffect(() => {
    if (add && add !== state.pinnedExternalId) dispatch({ type: "SET_PINNED", externalId: add });
  }, [add]); // eslint-disable-line

  useEffect(() => {
    if (STEPS.includes(urlStep) && urlStep !== state.step && urlStep !== "generating") {
      dispatch({ type: "SET_STEP", step: urlStep });
    }
  }, [urlStep]); // eslint-disable-line

  useEffect(() => {
    if (state.step !== params.get("step")) {
      /* Keep ?add= across the step rewrite. Rebuilding the query from the step
         alone dropped it on the first navigation, which is why the parameter
         looked ignored even before anything read it. */
      const q = new URLSearchParams(params.toString());
      q.set("step", state.step);
      router.replace(`/campaigns/create?${q.toString()}`, { scroll: false });
    }
  }, [state.step]); // eslint-disable-line

  return (
    <div className="min-h-screen bg-bg font-sans text-body text-text">
      {/* Header carries the campaign name and overall progress only. The
          5-step indicator moved into the page body (StepHeader), where it has
          room for a description per step. */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6 md:px-8">
          {/* Back sits flush left, vertically centred with the title and on the
              same row as the UserButton. Ghost and small, so it does not
              compete with "New Campaign". */}
          <div className="flex min-w-0 items-center gap-4">
            <WizardExit firstRun={params.get("first") === "1"} />
            <span className="font-display text-h3 text-text">New Campaign</span>
          </div>
          <div className="flex items-center gap-3">
            <OverallProgress current={state.step} />
            <UserButton appearance={arcUserButtonAppearance} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 md:px-8 md:py-12">
        {state.step === "brief"      && <StepBrief />}
        {state.step === "generating" && <StepGenerating />}
        {state.step === "scripts"    && <StepScripts />}
        {state.step === "select"     && <StepSelect />}
        {state.step === "review"     && <StepReview />}
      </main>
    </div>
  );
}

export default function CreateCampaignPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <WizardProvider>
        <WizardShell />
      </WizardProvider>
    </Suspense>
  );
}
