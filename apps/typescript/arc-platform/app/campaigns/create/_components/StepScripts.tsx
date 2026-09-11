"use client";

import { useState } from "react";
import { Check, Mic, Lightbulb, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useWizard, useResolvedScript } from "./WizardContext";
import type { RadioScript } from "./WizardContext";
import { StepHeader, StepActions } from "./WizardChrome";

/**
 * Language colour was `LANG_COLOR` holding raw hex, concatenated with alpha
 * suffixes (`+ "33"`). BRANDING.md section 9: a colour inside a data structure
 * becomes a token NAME resolved in one place. This is that one place.
 */
const LANG_VARIANT: Record<string, "lilac" | "blush" | "butter"> = {
  urdu: "lilac",
  english: "butter",
  bilingual: "blush",
};
const LANG_LABEL: Record<string, string> = {
  urdu: "اردو / Urdu",
  english: "English",
  bilingual: "Bilingual",
};

/** Section markers. Pastel on the rule only - the label stays --text-muted,
 *  because pastels are fills, never text. */
const SECTION_RULE = {
  hook: "bg-lilac-deep",
  body: "bg-blush-deep",
  cta: "bg-butter-deep",
} as const;

function ScriptCard({ script }: { script: RadioScript }) {
  const { state, dispatch } = useWizard();
  const [editing, setEditing] = useState(false);
  const resolved = useResolvedScript(script, state.editedScripts);
  const isSelected = state.selections.selectedScriptIds.includes(script.id);
  const maxReached = state.selections.selectedScriptIds.length >= 2 && !isSelected;

  function edit(field: keyof RadioScript, value: string) {
    dispatch({ type: "EDIT_SCRIPT", scriptId: script.id, field, value });
  }

  return (
    <article
      className={cn(
        "overflow-hidden rounded-card bg-surface shadow-card transition-colors motion-reduce:transition-none",
        isSelected && "ring-2 ring-lilac-deep"
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4",
          isSelected && "bg-lilac"
        )}
      >
        <div className="flex items-center gap-3">
          <Badge variant={LANG_VARIANT[script.language]}>{LANG_LABEL[script.language]}</Badge>
          <span className="type-data text-text-muted">{script.duration}s spot</span>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(e => !e)}>
            <Pencil aria-hidden strokeWidth={1.75} />
            {editing ? "Done" : "Edit"}
          </Button>
          <Button
            size="sm"
            variant={isSelected ? "default" : "secondary"}
            disabled={maxReached}
            onClick={() => !maxReached && dispatch({ type: "TOGGLE_SCRIPT", id: script.id })}
          >
            {isSelected ? <Check aria-hidden strokeWidth={2} /> : null}
            {isSelected ? "Selected" : "Select"}
          </Button>
        </div>
      </header>

      <div className="p-6">
        {editing ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`t-${script.id}`}>TITLE</Label>
              <Input id={`t-${script.id}`} value={resolved.title} onChange={e => edit("title", e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`h-${script.id}`} className="gap-1.5">
                <Mic aria-hidden strokeWidth={1.75} className="size-3.5" />
                HOOK (0–5s)
              </Label>
              <Textarea id={`h-${script.id}`} className="min-h-16" value={resolved.hook} onChange={e => edit("hook", e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`b-${script.id}`}>BODY (5–25s)</Label>
              <Textarea id={`b-${script.id}`} className="min-h-20" value={resolved.body} onChange={e => edit("body", e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`c-${script.id}`}>CALL TO ACTION (25–30s)</Label>
              <Textarea id={`c-${script.id}`} className="min-h-16" value={resolved.callToAction} onChange={e => edit("callToAction", e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`v-${script.id}`}>VOICE DIRECTION</Label>
              <Input id={`v-${script.id}`} value={resolved.voiceDirection} onChange={e => edit("voiceDirection", e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <h3 className="font-display text-h3 text-text">{resolved.title}</h3>

            <div className="flex flex-col gap-4">
              <ScriptLine rule={SECTION_RULE.hook} label="HOOK" text={resolved.hook} icon />
              <ScriptLine rule={SECTION_RULE.body} label="BODY" text={resolved.body} />
              <ScriptLine rule={SECTION_RULE.cta} label="CTA" text={resolved.callToAction} />
            </div>

            <div className="flex flex-wrap gap-6 rounded-control bg-bone p-4">
              <Meta label="Voice" value={resolved.voiceDirection} />
              <Meta label="Target" value={resolved.targetSegment} />
              <div className="flex min-w-36 flex-1 flex-col gap-2">
                <span className="type-label text-text-muted">Best Slots</span>
                <div className="flex flex-wrap gap-1.5">
                  {resolved.bestTimeSlots.map(slot => (
                    <Badge key={slot} variant="outline">{slot}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function ScriptLine({ rule, label, text, icon }: { rule: string; label: string; text: string; icon?: boolean }) {
  return (
    <div className="flex gap-4">
      <span aria-hidden className={cn("w-1 shrink-0 rounded-pill", rule)} />
      <div className="flex flex-col gap-1.5">
        <span className="type-label flex items-center gap-1.5 text-text-muted">
          {icon ? <Mic aria-hidden strokeWidth={1.75} className="size-3.5" /> : null}
          {label}
        </span>
        <p className="text-body text-text">{text}</p>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-36 flex-1 flex-col gap-2">
      <span className="type-label text-text-muted">{label}</span>
      <span className="text-small text-text">{value}</span>
    </div>
  );
}

export default function StepScripts() {
  const { state, dispatch } = useWizard();
  const scripts = state.generated?.scripts ?? [];
  const selected = state.selections.selectedScriptIds;

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        title="Radio Scripts"
        subtitle="Arc AI generated 3 scripts. Select up to 2 for your campaign. Click Edit to refine any script."
        current="scripts"
      />

      {/* Selection counter */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-6 py-4 shadow-card">
        <span className="text-small text-text-muted">
          <span
            className={cn(
              "type-data text-h3",
              selected.length === 0 ? "text-danger" : "text-success"
            )}
          >
            {selected.length}
          </span>{" "}
          / 2 scripts selected
        </span>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selected.map(id => {
              const s = scripts.find(sc => sc.id === id);
              return s ? (
                <Badge key={id} variant={LANG_VARIANT[s.language]}>{LANG_LABEL[s.language]}</Badge>
              ) : null;
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {scripts.map(script => (
          <ScriptCard key={script.id} script={script} />
        ))}
      </div>

      {/* Insight card */}
      {state.generated?.campaignInsights && (
        <aside className="flex items-start gap-4 rounded-card bg-lilac p-6">
          <Lightbulb aria-hidden strokeWidth={1.75} className="size-5 shrink-0 text-ink" />
          <div className="flex flex-col gap-1.5">
            <span className="type-label text-ink/70">AI Insight</span>
            <p className="text-body text-ink">{state.generated.campaignInsights}</p>
          </div>
        </aside>
      )}

      <StepActions
        backLabel="Back"
        onBack={() => dispatch({ type: "SET_STEP", step: "brief" })}
        primaryLabel={selected.length === 0 ? "Select at least 1 script to continue" : "Continue to Stations & Influencers"}
        onPrimary={() => dispatch({ type: "SET_STEP", step: "select" })}
        primaryDisabled={selected.length === 0}
      />
    </div>
  );
}
