"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Target, Banknote, Rocket, RefreshCw, Radio, Star, Laptop } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { flightEndLabel, todayISO } from "@/lib/flight";
import { useWizard } from "./WizardContext";
import type { BriefData } from "./WizardContext";
import { StepHeader, StepActions, StepSection, FieldError, SelectChip, SubStepProgress } from "./WizardChrome";

const CITIES = ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Multan", "Peshawar", "Quetta", "Hyderabad", "Sialkot"];
const INDUSTRIES = ["FMCG", "Food & Beverage", "Fashion", "Beauty & Personal Care", "Telecom", "Banking & Finance", "Real Estate", "Healthcare", "Education", "Retail", "Automotive", "Technology"];
const TONES = [
  { value: "warm", label: "Warm", desc: "Friendly & relatable" },
  { value: "professional", label: "Professional", desc: "Authoritative & credible" },
  { value: "urgent", label: "Urgent", desc: "Time-sensitive & direct" },
  { value: "playful", label: "Playful", desc: "Fun & youthful energy" },
  { value: "emotional", label: "Emotional", desc: "Heartfelt & evocative" },
] as const;
/* Line icons, not system emoji: emoji render differently on every OS, clash
   with Gabarito, and were the least considered thing on the screen. One size
   and stroke weight throughout - --text-muted, --ink when selected. */
const GOALS = [
  { value: "awareness", label: "Brand Awareness", Icon: Megaphone, desc: "Build recognition" },
  { value: "leads", label: "Lead Generation", Icon: Target, desc: "Capture interest" },
  { value: "sales", label: "Drive Sales", Icon: Banknote, desc: "Direct conversions" },
  { value: "launch", label: "Product Launch", Icon: Rocket, desc: "New release hype" },
  { value: "retention", label: "Retention", Icon: RefreshCw, desc: "Loyalty & repeat" },
] as const;
const CHANNELS = [
  { value: "radio", label: "Radio", Icon: Radio, desc: "FM Stations" },
  { value: "influencer", label: "Influencers", Icon: Star, desc: "Social creators" },
  { value: "digital", label: "Digital", Icon: Laptop, desc: "Coming soon", soon: true },
] as const;
const DURATIONS = [7, 14, 30, 60] as const;


/**
 * Brief splits into three sub-steps. Nine sections and twenty-odd controls on
 * one screen was too much to take in, and it produced eight validation errors
 * at once.
 *
 * The sub-step device is deliberately NOT numbered - the top stepper already
 * owns 1-5, and a second number sequence on the same screen is the problem the
 * per-section badges had. A thin segmented bar plus a text label instead.
 */
const SUB_STEPS = [
  "What you're advertising",
  "Who you want to reach",
  "How you want to run it",
] as const;

/** Required fields per sub-step, so a user sees 2-3 errors rather than 8. */
function errorsFor(sub: number, brief: BriefData): Record<string, string> {
  const e: Record<string, string> = {};
  if (sub === 0) {
    if (!brief.productName.trim()) e.productName = "Required";
    if (!brief.productDescription.trim()) e.productDescription = "Required";
    if (!brief.industry) e.industry = "Select an industry";
  }
  if (sub === 1) {
    if (!brief.targetAudience.trim()) e.targetAudience = "Required";
    if (brief.targetCities.length === 0) e.cities = "Select at least one city";
  }
  if (sub === 2) {
    if (!brief.campaignGoal) e.goal = "Select a goal";
    if (!brief.totalBudget || brief.totalBudget < 1000) e.budget = "Minimum budget PKR 1,000";
    if (!brief.startDate) e.startDate = "Pick a start date";
    else if (brief.startDate < todayISO()) e.startDate = "Start date can't be in the past";
    if (brief.channels.length === 0) e.channels = "Select at least one channel";
  }
  return e;
}

/** Optional sections collapse behind their existing "optional" label so they
 *  add no visual weight until wanted. */
function OptionalToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-fit rounded-control text-small text-text-muted underline underline-offset-4 outline-none transition-colors hover:text-text focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
    >
      {open ? "Hide" : "Add"}
    </button>
  );
}

export default function StepBrief() {
  const router = useRouter();
  const { state, dispatch } = useWizard();
  const brief = state.brief;
  const [sub, setSub] = useState(0);
  const [showOffer, setShowOffer] = useState(!!brief.specialOffer);
  const [showCompetitors, setShowCompetitors] = useState(!!brief.competitors);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  function update(patch: Partial<BriefData>) {
    dispatch({ type: "UPDATE_BRIEF", brief: patch });
  }
  function touch(k: string) {
    setTouched(t => ({ ...t, [k]: true }));
  }

  function toggleCity(city: string) {
    touch("cities");
    const cur = brief.targetCities;
    const next = cur.includes(city) ? cur.filter(c => c !== city) : [...cur, city];
    update({ targetCities: next, primaryCity: next[0] || brief.primaryCity });
  }

  function toggleChannel(ch: "radio" | "influencer" | "digital") {
    touch("channels");
    const cur = brief.channels;
    const next = cur.includes(ch) ? cur.filter(c => c !== ch) : [...cur, ch];
    update({ channels: next });
  }

  const errors = errorsFor(sub, brief);
  const valid = Object.keys(errors).length === 0;
  /** Only surface an error once the user has been near the field. */
  const err = (k: string) => (touched[k] ? errors[k] : undefined);

  function handleNext() {
    if (!valid) return;
    if (sub < SUB_STEPS.length - 1) {
      setSub(s => s + 1);
      setTouched({});
      return;
    }
    dispatch({ type: "SET_STEP", step: "generating" });
  }

  function handleBack() {
    if (sub === 0) { router.push("/campaigns"); return; }
    setSub(s => s - 1);
    setTouched({});
  }

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        title="Campaign Brief"
        subtitle="Tell Arc AI about your product and campaign goals"
        current="brief"
      />

      <SubStepProgress labelPrefix="Brief" steps={SUB_STEPS} current={sub} />

      {/* ── 1 · What you're advertising ───────────────────────────── */}
      {sub === 0 && (
        <div className="flex flex-col gap-6">
          <StepSection title="Product Info">
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-name">Brand / Product Name *</Label>
              <Input
                id="b-name"
                placeholder="e.g. Shan Masalas"
                value={brief.productName}
                aria-invalid={!!err("productName")}
                onBlur={() => touch("productName")}
                onChange={e => update({ productName: e.target.value })}
              />
              <FieldError>{err("productName")}</FieldError>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="b-desc">Product Description *</Label>
              <Textarea
                id="b-desc"
                placeholder="What does your product do? What makes it special?"
                value={brief.productDescription}
                aria-invalid={!!err("productDescription")}
                onBlur={() => touch("productDescription")}
                onChange={e => update({ productDescription: e.target.value })}
              />
              <FieldError>{err("productDescription")}</FieldError>
            </div>

            <div className="flex flex-col gap-3">
              <Label asChild><span>Industry *</span></Label>
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.map(ind => (
                  <SelectChip
                    key={ind}
                    pill
                    selected={brief.industry === ind}
                    onClick={() => { touch("industry"); update({ industry: ind }); }}
                  >
                    {ind}
                  </SelectChip>
                ))}
              </div>
              <FieldError>{err("industry")}</FieldError>
            </div>
          </StepSection>

          <StepSection title="Competitors" aside="optional">
            <OptionalToggle open={showCompetitors} onToggle={() => setShowCompetitors(v => !v)} />
            {showCompetitors ? (
              <Input
                placeholder="e.g. National Foods, Mehran — helps AI differentiate your message"
                value={brief.competitors}
                onChange={e => update({ competitors: e.target.value })}
              />
            ) : null}
          </StepSection>
        </div>
      )}

      {/* ── 2 · Who you want to reach ─────────────────────────────── */}
      {sub === 1 && (
        <div className="flex flex-col gap-6">
          <StepSection title="Target Audience *">
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-aud">Audience Description</Label>
              <Textarea
                id="b-aud"
                placeholder="e.g. Working women aged 25-40 in urban areas who cook at home and value quality ingredients"
                value={brief.targetAudience}
                aria-invalid={!!err("targetAudience")}
                onBlur={() => touch("targetAudience")}
                onChange={e => update({ targetAudience: e.target.value })}
              />
              <FieldError>{err("targetAudience")}</FieldError>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-agemin">Age Min</Label>
                <Input id="b-agemin" type="number" min={13} max={65}
                  value={brief.ageMin}
                  onChange={e => update({ ageMin: Number(e.target.value) })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-agemax">Age Max</Label>
                <Input id="b-agemax" type="number" min={13} max={75}
                  value={brief.ageMax}
                  onChange={e => update({ ageMax: Number(e.target.value) })} />
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Label asChild><span>Gender</span></Label>
              <div className="flex gap-2">
                {(["all", "female", "male"] as const).map(g => (
                  <SelectChip key={g} selected={brief.gender === g} onClick={() => update({ gender: g })} className="flex-1 capitalize">
                    {g === "all" ? "All" : g === "female" ? "Female" : "Male"}
                  </SelectChip>
                ))}
              </div>
            </div>
          </StepSection>

          <StepSection title="Target Cities *">
            <div className="flex flex-wrap gap-2">
              {CITIES.map(city => (
                <SelectChip key={city} pill selected={brief.targetCities.includes(city)} onClick={() => toggleCity(city)}>
                  {city}
                </SelectChip>
              ))}
            </div>
            <FieldError>{err("cities")}</FieldError>
          </StepSection>
        </div>
      )}

      {/* ── 3 · How you want to run it ────────────────────────────── */}
      {sub === 2 && (
        <div className="flex flex-col gap-6">
          <StepSection title="Campaign Goal *">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {GOALS.map(g => (
                <SelectChip
                  key={g.value}
                  selected={brief.campaignGoal === g.value}
                  onClick={() => { touch("goal"); update({ campaignGoal: g.value }); }}
                  className="h-auto flex-col items-start gap-1 p-4 text-left whitespace-normal"
                >
                  <g.Icon
                    aria-hidden
                    strokeWidth={1.75}
                    className={cn("size-5", brief.campaignGoal === g.value ? "text-ink" : "text-text-muted")}
                  />
                  <span className="text-small font-medium text-text">{g.label}</span>
                  <span className="text-small text-text-muted">{g.desc}</span>
                </SelectChip>
              ))}
            </div>
            <FieldError>{err("goal")}</FieldError>
          </StepSection>

          <StepSection title="Campaign Tone *">
            <div className="flex flex-wrap gap-2">
              {TONES.map(t => (
                <SelectChip
                  key={t.value}
                  pill
                  selected={brief.tone === t.value}
                  onClick={() => update({ tone: t.value })}
                  className="h-auto flex-col items-start gap-0.5 px-4 py-2 text-left"
                >
                  <span className="text-small font-medium text-text">{t.label}</span>
                  <span className="text-small text-text-muted">{t.desc}</span>
                </SelectChip>
              ))}
            </div>
          </StepSection>

          <StepSection title="Budget & Duration *">
            <div className="grid grid-cols-[2fr_1fr] gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-budget">Total Budget</Label>
                <div className="relative">
                  <span className="type-data pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-text-muted">
                    PKR
                  </span>
                  <Input
                    id="b-budget" type="number" className="pl-14"
                    placeholder="150,000"
                    value={brief.totalBudget || ""}
                    aria-invalid={!!err("budget")}
                    onBlur={() => touch("budget")}
                    onChange={e => update({ totalBudget: Number(e.target.value) })}
                  />
                </div>
                <FieldError>{err("budget")}</FieldError>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-ccy">Currency</Label>
                <Select
                  value={brief.budgetCurrency}
                  onValueChange={v => update({ budgetCurrency: v as "PKR" | "AED" | "SAR" })}
                >
                  <SelectTrigger id="b-ccy" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PKR">PKR</SelectItem>
                    <SelectItem value="AED">AED</SelectItem>
                    <SelectItem value="SAR">SAR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-start">Start Date *</Label>
                <Input
                  id="b-start"
                  type="date"
                  value={brief.startDate}
                  min={todayISO()}
                  aria-invalid={Boolean(errors.startDate)}
                  onChange={e => update({ startDate: e.target.value })}
                />
                {errors.startDate ? (
                  <span className="text-small text-danger">{errors.startDate}</span>
                ) : (
                  /* The end is derived, never entered - two date fields could
                     contradict the duration chip beside them. Stations quote
                     against specific dates, so this is also what CALL-E reads
                     out on the call. */
                  <span className="text-small text-text-muted">
                    {brief.startDate
                      ? `Runs to ${flightEndLabel(brief.startDate, brief.duration)}`
                      : "Ends automatically after the duration you pick"}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <Label asChild><span>Campaign Duration</span></Label>
                <div className="flex gap-2">
                  {DURATIONS.map(d => (
                    <SelectChip key={d} selected={brief.duration === d} onClick={() => update({ duration: d })} className="type-data flex-1">
                      {d}d
                    </SelectChip>
                  ))}
                </div>
              </div>
            </div>
          </StepSection>

          <StepSection title="Channels *">
            <div className="grid gap-3 sm:grid-cols-3">
              {CHANNELS.map(ch => {
                const soon = "soon" in ch && ch.soon;
                const sel = brief.channels.includes(ch.value as "radio" | "influencer" | "digital");
                return (
                  <SelectChip
                    key={ch.value}
                    selected={sel}
                    disabled={!!soon}
                    onClick={() => !soon && toggleChannel(ch.value as "radio" | "influencer" | "digital")}
                    className="relative h-auto flex-col items-start gap-1 p-4 text-left"
                  >
                    {soon ? (
                      <Badge variant="muted" className="absolute top-3 right-3">SOON</Badge>
                    ) : null}
                    <ch.Icon
                      aria-hidden
                      strokeWidth={1.75}
                      className={cn("size-5", sel ? "text-ink" : "text-text-muted")}
                    />
                    <span className="text-small font-medium text-text">{ch.label}</span>
                    <span className="text-small text-text-muted">{ch.desc}</span>
                  </SelectChip>
                );
              })}
            </div>
            <FieldError>{err("channels")}</FieldError>
          </StepSection>

          <StepSection title="Special Offer / Promotion" aside="(optional)">
            <OptionalToggle open={showOffer} onToggle={() => setShowOffer(v => !v)} />
            {showOffer ? (
              <Input
                placeholder="e.g. 20% off during Ramadan, Buy 2 Get 1 Free — AI will weave this into scripts"
                value={brief.specialOffer}
                onChange={e => update({ specialOffer: e.target.value })}
              />
            ) : null}
          </StepSection>
        </div>
      )}

      <StepActions
        backLabel={sub === 0 ? "Campaigns" : "Back"}
        onBack={handleBack}
        primaryLabel={sub === SUB_STEPS.length - 1 ? "Generate Campaign with AI" : "Continue"}
        onPrimary={handleNext}
        primaryDisabled={!valid}
        note={
          sub === SUB_STEPS.length - 1
            ? "Arc AI will create 3 radio scripts, station recommendations, and influencer matches tailored to your brief"
            : undefined
        }
      />
    </div>
  );
}
