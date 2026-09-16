"use client";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2, Droplet, Hospital, Loader2, MapPin, Minus, Pill, Plus, Search, ShieldAlert, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Need } from "@/hooks/useMission";
import type { DrugIntel, DrugProduct } from "@/lib/drugs";
import { BLOOD_COMPONENTS, BLOOD_GROUPS, type BloodComponent, type BloodGroup, type NeedKind, type Urgency } from "@/lib/types";
import { cx } from "@/lib/ui";
import { Button, Card, Chip, inputClass, Label, Segmented, Toggle } from "./ui";

export interface LocationQuery {
  query: string;
  radiusKm: number;
  synthetic: boolean;
}

const QUICK_PICKS = [
  { label: "Lisdexamfetamine 30 mg", q: "lisdexamfetamine 30 mg capsule" },
  { label: "Methylphenidate ER 36 mg", q: "methylphenidate 36 mg extended release tablet" },
  { label: "Amoxicillin 400 mg/5 mL", q: "amoxicillin 400 mg/5 ml oral suspension" },
  { label: "Albuterol inhaler", q: "albuterol inhalation aerosol" },
];

const DEFAULT_PLACE: Record<NeedKind, string> = { pharmacy: "Brooklyn, NY", blood_bank: "Chennai, India" };

function defaultQuantity(doseForm: string | null): string {
  const form = (doseForm ?? "").toLowerCase();
  if (/suspension|solution|syrup/.test(form)) return "one 100 mL bottle";
  if (form.includes("inhal")) return "1 inhaler";
  if (/injector|pen|injection/.test(form)) return "1 box";
  if (form.includes("capsule")) return "30 capsules";
  if (form.includes("tablet")) return "30 tablets";
  return "a 30-day supply";
}

interface AiIntake {
  kind: NeedKind;
  drugQuery: string;
  quantity: string;
  bloodGroup: BloodGroup | "";
  component: BloodComponent | "";
  units: number;
  hospital: string;
  location: string;
  urgency: Urgency;
}

export function NeedStep({
  busy,
  error,
  aiLabel,
  onContinue,
}: {
  busy: boolean;
  error: string | null;
  aiLabel: string | null;
  onContinue: (need: Need, location: LocationQuery) => void;
}) {
  const [kind, setKind] = useState<NeedKind>("pharmacy");
  const [urgency, setUrgency] = useState<Urgency>("today");
  const [location, setLocation] = useState(DEFAULT_PLACE.pharmacy);
  const [radiusKm, setRadiusKm] = useState(3);
  const [synthetic, setSynthetic] = useState(false);

  // Medicine
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<DrugProduct[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [autoPick, setAutoPick] = useState(false);
  const [product, setProduct] = useState<DrugProduct | null>(null);
  const [intel, setIntel] = useState<DrugIntel | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const searchSeq = useRef(0);

  // AI intake (optional): free text in, form fields out, for the operator to review.
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const aiQuantity = useRef<string | null>(null);

  // Blood
  const [group, setGroup] = useState<BloodGroup>("B+");
  const [component, setComponent] = useState<BloodComponent>("packed_red_cells");
  const [units, setUnits] = useState(2);
  const [hospital, setHospital] = useState("");

  function switchKind(next: NeedKind) {
    setKind(next);
    if (location === DEFAULT_PLACE[kind]) setLocation(DEFAULT_PLACE[next]);
    setRadiusKm(next === "blood_bank" ? 8 : 3);
  }

  useEffect(() => {
    if (product || query.trim().length < 3) {
      setProducts([]);
      setSuggestions([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/drugs/search?q=${encodeURIComponent(query)}`);
        const json = (await res.json()) as { products: DrugProduct[]; suggestions: string[] };
        if (seq !== searchSeq.current) return;
        setProducts(json.products ?? []);
        setSuggestions(json.suggestions ?? []);
        if (autoPick && json.products?.[0]) void choose(json.products[0]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
        setAutoPick(false);
      }
    }, 320);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, product]);

  async function choose(next: DrugProduct) {
    setProduct(next);
    setQuery(next.displayName);
    setProducts([]);
    setIntel(null);
    setIntelLoading(true);
    try {
      const res = await fetch(`/api/drugs/${next.rxcui}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as DrugIntel;
      setIntel(data);
      setQuantity(aiQuantity.current || defaultQuantity(data.doseForm));
      aiQuantity.current = null;
      setAlternatives(data.alternatives.slice(0, 2));
    } catch {
      setIntel(null);
    } finally {
      setIntelLoading(false);
    }
  }

  async function fillWithAi() {
    if (aiText.trim().length < 4 || aiBusy) return;
    setAiBusy(true);
    setAiNote(null);
    try {
      const res = await fetch("/api/ai/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: aiText }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "AI intake failed.");
      const intake = json.intake as AiIntake;
      const isDefault = location === DEFAULT_PLACE.pharmacy || location === DEFAULT_PLACE.blood_bank;
      setKind(intake.kind);
      setUrgency(intake.urgency);
      setRadiusKm(intake.kind === "blood_bank" ? 8 : 3);
      setLocation(intake.location || (isDefault ? DEFAULT_PLACE[intake.kind] : location));
      if (intake.kind === "blood_bank") {
        if (intake.bloodGroup) setGroup(intake.bloodGroup);
        if (intake.component) setComponent(intake.component);
        if (intake.units) setUnits(Math.min(10, Math.max(1, intake.units)));
        if (intake.hospital) setHospital(intake.hospital);
      } else if (intake.drugQuery) {
        // RxNorm still resolves the exact product; the model only supplies the words to search.
        aiQuantity.current = intake.quantity || null;
        setProduct(null);
        setIntel(null);
        setAutoPick(true);
        setQuery(intake.drugQuery);
      }
      const missing =
        intake.kind === "blood_bank"
          ? [!intake.bloodGroup && "blood group", !intake.hospital && "hospital"].filter(Boolean)
          : [!intake.drugQuery && "medication"].filter(Boolean);
      setAiNote(`Filled by ${json.provider}. ${missing.length ? `Please add the ${missing.join(" and ")}. ` : ""}Review every field before searching.`);
    } catch (e) {
      setAiNote(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }

  const ready = kind === "pharmacy" ? Boolean(intel) : hospital.trim().length >= 2;

  function submit() {
    const loc = { query: location, radiusKm, synthetic };
    if (kind === "pharmacy") {
      if (!intel) return;
      onContinue(
        {
          kind: "pharmacy",
          medication: {
            rxcui: intel.rxcui,
            name: intel.displayName,
            ingredient: intel.ingredient,
            brandNames: intel.brands,
            quantity: quantity.trim() || "a 30-day supply",
            alternatives,
            controlled: Boolean(intel.deaSchedule),
            deaSchedule: intel.deaSchedule,
            urgency,
          },
        },
        loc,
      );
    } else {
      onContinue({ kind: "blood_bank", blood: { group, component, units, hospital: hospital.trim(), urgency } }, loc);
    }
  }

  return (
    <section className="mx-auto max-w-7xl px-5">
      {aiLabel && (
        <div className="gradient-ring card mb-3 flex flex-col gap-3 rounded-3xl p-3 md:flex-row md:items-center">
          <div className="flex shrink-0 items-center gap-2 pl-1 text-sm font-bold text-slate-800">
            <span className="brand-bg flex h-8 w-8 items-center justify-center rounded-xl text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            Describe it
          </div>
          <input
            className={cx(inputClass, "flex-1")}
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void fillWithAi();
            }}
            placeholder='e.g. "My father needs 2 units of O negative blood at City General Hospital in Chennai today"'
          />
          <Button onClick={() => void fillWithAi()} loading={aiBusy} disabled={aiText.trim().length < 4} icon={<Sparkles className="h-4 w-4" />}>
            Fill for me
          </Button>
        </div>
      )}
      {aiNote && <p className="mb-4 px-2 text-[12px] text-slate-500">{aiNote}</p>}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented<NeedKind>
          value={kind}
          onChange={switchKind}
          className="p-1.5"
          options={[
            { value: "pharmacy", label: <><Pill className="h-4 w-4 text-indigo-500" /> Shortage medicine</> },
            { value: "blood_bank", label: <><Droplet className="h-4 w-4 text-rose-500" /> Blood units</> },
          ]}
        />
        <p className="text-[12px] text-slate-500">Nothing is dialed until you review the plan and press Dispatch.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {kind === "pharmacy" ? (
          <Card className="p-6">
            <Label hint="RxNorm · U.S. National Library of Medicine">What medication do you need?</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className={cx(inputClass, "py-3.5 pl-10 pr-10 text-base")}
                placeholder="Drug name, strength, and form, e.g. lisdexamfetamine 30 mg capsule"
                value={query}
                onChange={(e) => {
                  setProduct(null);
                  setIntel(null);
                  setQuery(e.target.value);
                }}
              />
              {searching && <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-violet-500" />}
              {product && !searching && (
                <button
                  onClick={() => {
                    setProduct(null);
                    setIntel(null);
                    setQuery("");
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {products.length > 0 && !product && (
                <div className="scroll-thin absolute z-20 mt-2 max-h-80 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
                  {products.slice(0, 10).map((p) => (
                    <button
                      key={p.rxcui}
                      onClick={() => void choose(p)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50"
                    >
                      <span>{p.displayName}</span>
                      <Chip tone={p.tty === "SCD" ? "indigo" : "fuchsia"}>{p.tty === "SCD" ? "Generic" : (p.brand ?? "Brand")}</Chip>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {suggestions.length > 0 && !product && (
              <p className="mt-3 text-sm text-slate-500">
                Did you mean{" "}
                {suggestions.map((s, i) => (
                  <button key={s} className="font-semibold text-violet-600 hover:underline" onClick={() => setQuery(s)}>
                    {s}
                    {i < suggestions.length - 1 ? ", " : ""}
                  </button>
                ))}
                ?
              </p>
            )}

            {!product && (
              <div className="mt-4 flex flex-wrap gap-2">
                {QUICK_PICKS.map((pick) => (
                  <button
                    key={pick.label}
                    onClick={() => {
                      setAutoPick(true);
                      setQuery(pick.q);
                    }}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:text-violet-700 hover:ring-violet-300"
                  >
                    {pick.label}
                  </button>
                ))}
              </div>
            )}

            {intelLoading && (
              <div className="mt-6 flex items-center gap-3 rounded-2xl bg-slate-50 p-5 text-sm text-slate-500 ring-1 ring-slate-200/70">
                <Loader2 className="h-4 w-4 animate-spin text-violet-500" /> Checking RxNorm, FDA shortage listings, and DEA schedule…
              </div>
            )}

            {intel && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
                <div className="soft-brand rounded-2xl p-5 ring-1 ring-violet-100">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-display text-xl font-semibold text-slate-900">{intel.displayName}</div>
                      <div className="mt-1 font-mono text-[11px] text-slate-500">
                        RxCUI {intel.rxcui}
                        {intel.ingredient ? ` · ${intel.ingredient}` : ""}
                        {intel.brands.length ? ` · brands: ${intel.brands.slice(0, 3).join(", ")}` : ""}
                      </div>
                    </div>
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {intel.shortage === null ? (
                      <Chip>FDA shortage data unavailable</Chip>
                    ) : intel.shortage.active ? (
                      <Chip tone="rose">
                        <AlertTriangle className="h-3.5 w-3.5" /> Active FDA shortage · {intel.shortage.records} listings
                        {intel.shortage.unavailable ? ` · ${intel.shortage.unavailable} unavailable` : ""}
                      </Chip>
                    ) : (
                      <Chip tone="emerald">No current FDA shortage listing</Chip>
                    )}
                    {intel.deaSchedule && (
                      <Chip tone="violet">
                        <ShieldAlert className="h-3.5 w-3.5" /> DEA schedule {intel.deaSchedule.replace(/^C/, "")}
                      </Chip>
                    )}
                  </div>
                  {intel.deaSchedule && (
                    <p className="mt-3 text-[12.5px] leading-relaxed text-violet-800/80">
                      Controlled substance: many pharmacies won&apos;t disclose inventory by phone. The agent accepts that politely and records it
                      as a refusal, never as a &ldquo;no&rdquo;.
                    </p>
                  )}
                </div>
                {intel.alternatives.length > 0 && (
                  <div>
                    <Label hint="availability questions only; the prescriber decides">If unavailable, also ask about</Label>
                    <div className="flex flex-wrap gap-2">
                      {intel.alternatives.map((alt) => {
                        const on = alternatives.includes(alt);
                        return (
                          <button
                            key={alt}
                            onClick={() => setAlternatives((cur) => (on ? cur.filter((a) => a !== alt) : [...cur, alt].slice(0, 3)))}
                            className={cx(
                              "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
                              on ? "bg-violet-600 text-white ring-violet-600" : "bg-white text-slate-600 ring-slate-200 hover:ring-violet-300",
                            )}
                          >
                            {alt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </Card>
        ) : (
          <Card className="p-6">
            <Label hint="asked exactly as entered">Blood group</Label>
            <div className="grid grid-cols-4 gap-2">
              {BLOOD_GROUPS.map((g) => (
                <button
                  key={g}
                  onClick={() => setGroup(g)}
                  className={cx(
                    "rounded-2xl py-4 font-display text-xl font-bold transition",
                    group === g ? "blood-bg text-white shadow-[0_12px_24px_-12px_rgba(244,63,94,0.7)]" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-rose-300",
                  )}
                >
                  {g}
                </button>
              ))}
            </div>

            <div className="mt-6">
              <Label>Component</Label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(BLOOD_COMPONENTS) as BloodComponent[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setComponent(c)}
                    className={cx(
                      "rounded-full px-3.5 py-2 text-xs font-semibold capitalize ring-1 transition",
                      component === c ? "bg-rose-600 text-white ring-rose-600" : "bg-white text-slate-600 ring-slate-200 hover:ring-rose-300",
                    )}
                  >
                    {BLOOD_COMPONENTS[c]}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-[auto_1fr]">
              <div>
                <Label>Units needed</Label>
                <div className="inline-flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
                  <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={() => setUnits((u) => Math.max(1, u - 1))} aria-label="Fewer units">
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-10 text-center font-display text-lg font-bold text-slate-900">{units}</span>
                  <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={() => setUnits((u) => Math.min(10, u + 1))} aria-label="More units">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div>
                <Label hint="shared with blood banks">Patient admitted at</Label>
                <div className="relative">
                  <Hospital className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input className={cx(inputClass, "pl-10")} value={hospital} onChange={(e) => setHospital(e.target.value)} placeholder="Hospital name" />
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-start gap-3 rounded-2xl bg-rose-50/70 p-4 text-[12.5px] leading-relaxed text-rose-900/80 ring-1 ring-rose-100">
              <Droplet className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              Agents ask only about this group and component, plus reservation, requisition, cross-match, and replacement-donor requirements.
              Compatibility decisions stay with the treating doctor, and the patient&apos;s name is never shared on the first call. PharmaBridge is not an
              emergency service: if a life is at immediate risk, contact the treating hospital or local emergency services first.
            </div>
          </Card>
        )}

        <Card className="flex flex-col gap-5 p-6">
          {kind === "pharmacy" && (
            <div>
              <Label>Quantity needed</Label>
              <input className={inputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 30 capsules" />
            </div>
          )}
          <div>
            <Label>Needed by</Label>
            <Segmented<Urgency>
              value={urgency}
              onChange={setUrgency}
              options={[
                { value: "today", label: "Today" },
                { value: "48h", label: "Within 48h" },
                { value: "week", label: "This week" },
              ]}
            />
          </div>
          <div>
            <Label>Search near</Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className={cx(inputClass, "pl-10")} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, address, or postal code" />
            </div>
          </div>
          <div>
            <Label hint={`${radiusKm} km`}>Search radius</Label>
            <input type="range" min={1} max={20} step={1} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} className="w-full accent-violet-600" />
          </div>
          <Toggle checked={synthetic} onChange={setSynthetic}>
            Use the built-in directory (555-01xx numbers) instead of map listings.
          </Toggle>
          <div className="mt-auto space-y-3">
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
            <Button
              variant={kind === "pharmacy" ? "primary" : "blood"}
              className="w-full py-3.5 text-base"
              disabled={!ready || location.trim().length < 2}
              loading={busy}
              onClick={submit}
              icon={<ArrowRight className="h-4 w-4" />}
            >
              Find nearby {kind === "pharmacy" ? "pharmacies" : "blood banks"}
            </Button>
            <p className="text-center text-[11px] text-slate-400">Searching the map never places a call.</p>
          </div>
        </Card>
      </div>
    </section>
  );
}
