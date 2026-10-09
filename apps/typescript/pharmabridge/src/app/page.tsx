"use client";
import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { BriefModal } from "@/components/BriefModal";
import { CallDrawer, type DrawerData } from "@/components/CallDrawer";
import { Background, Footer, TopBar } from "@/components/Chrome";
import { DispatchBoard } from "@/components/DispatchBoard";
import { FacilitiesStep, type AreaResult } from "@/components/FacilitiesStep";
import { Hero } from "@/components/Hero";
import { NeedStep, type LocationQuery } from "@/components/NeedStep";
import { ResultsStep } from "@/components/ResultsStep";
import { DEFAULT_SETTINGS, useMission, type MissionSettings, type Need } from "@/hooks/useMission";
import type { CallPlan } from "@/lib/mission";
import { bloodItem, medicationItem, SKIP_STATUSES, type PulseResponse } from "@/lib/pulse-item";
import { BLOOD_COMPONENTS, type AppConfig } from "@/lib/types";
import { formatKm } from "@/lib/ui";

function StepHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="mx-auto max-w-7xl px-5 pb-6 pt-10">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-600">{eyebrow}</div>
      <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}

const needTitle = (need: Need | null) =>
  !need ? "" : need.kind === "pharmacy" ? need.medication.name : `${need.blood.units} × ${need.blood.group} ${BLOOD_COMPONENTS[need.blood.component]}`;

const itemFor = (need: Need) => (need.kind === "pharmacy" ? medicationItem(need.medication) : bloodItem(need.blood));

/** Facilities whose fresh Pulse answer makes a repeat call pointless for now. */
function skipIds(pulse: PulseResponse | null): Set<string> {
  return new Set((pulse?.sightings ?? []).filter((s) => s.facilityId && SKIP_STATUSES.includes(s.status)).map((s) => s.facilityId as string));
}

export default function Home() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [need, setNeed] = useState<Need | null>(null);
  const [location, setLocation] = useState<LocationQuery | null>(null);
  const [area, setArea] = useState<AreaResult | null>(null);
  const [pulse, setPulse] = useState<PulseResponse | null>(null);
  const [pulseAvoided, setPulseAvoided] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState<MissionSettings>(DEFAULT_SETTINGS);
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const [brief, setBrief] = useState<{ open: boolean; loading: boolean; plan: CallPlan | null; error: string | null }>({ open: false, loading: false, plan: null, error: null });
  const { mission, start, stop, retry, reset } = useMission();

  const loadConfig = useCallback(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  useEffect(loadConfig, [loadConfig]);

  const go = useCallback((n: number) => {
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (step !== 3 || mission.status !== "complete") return;
    loadConfig();
    const timer = setTimeout(() => go(4), 1800);
    return () => clearTimeout(timer);
  }, [step, mission.status, go, loadConfig]);

  async function scan(nextNeed: Need, loc: LocationQuery) {
    setScanning(true);
    setScanError(null);
    try {
      const params = new URLSearchParams({ kind: nextNeed.kind, q: loc.query, radiusKm: String(loc.radiusKm), synthetic: loc.synthetic ? "1" : "0" });
      const res = await fetch(`/api/facilities?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load facilities.");
      if (!json.facilities?.length) throw new Error(`No ${nextNeed.kind === "pharmacy" ? "pharmacies" : "blood banks"} with a listed phone in that radius. Try a larger radius.`);
      const nextArea = json as AreaResult;
      const pulseParams = new URLSearchParams({
        kind: nextNeed.kind,
        item: itemFor(nextNeed).key,
        lat: String(nextArea.center.lat),
        lon: String(nextArea.center.lon),
        radiusKm: String(loc.radiusKm),
      });
      const nextPulse: PulseResponse | null = await fetch(`/api/pulse?${pulseParams}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const skip = skipIds(nextPulse);
      setNeed(nextNeed);
      setLocation(loc);
      setArea(nextArea);
      setPulse(nextPulse);
      setSelected(nextArea.facilities.filter((f) => !skip.has(f.id)).slice(0, 6).map((f) => f.id));
      loadConfig();
      go(2);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
    } finally {
      setScanning(false);
    }
  }

  async function previewBrief() {
    const facility = area?.facilities.find((f) => selected.includes(f.id));
    if (!facility || !need) return;
    setBrief({ open: true, loading: true, plan: null, error: null });
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: need.kind === "pharmacy" ? "inquiry" : "blood_inquiry",
          missionId: "preview-000",
          routing: "simulation",
          dryRun: true,
          facility,
          ...(need.kind === "pharmacy" ? { medication: need.medication } : { blood: need.blood }),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Could not build the plan.");
      setBrief({ open: true, loading: false, plan: json.plan, error: null });
    } catch (error) {
      setBrief({ open: true, loading: false, plan: null, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function dispatch() {
    if (!area || !need) return;
    // Places the Pulse recently heard had it go first; the rest keep distance order.
    const heard = new Map((pulse?.sightings ?? []).filter((s) => s.facilityId).map((s) => [s.facilityId as string, s.status]));
    const rank = (id: string) => (heard.get(id) === "available" ? 0 : heard.get(id) === "partial" ? 1 : 2);
    const chosen = area.facilities.filter((f) => selected.includes(f.id)).sort((a, b) => rank(a.id) - rank(b.id) || a.distanceKm - b.distanceKm);
    const missionId = start(need, chosen, settings);
    const skip = skipIds(pulse);
    const avoided = area.facilities.filter((f) => skip.has(f.id) && !selected.includes(f.id)).length;
    setPulseAvoided(avoided);
    if (avoided) {
      void fetch("/api/pulse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ missionId, avoided }) }).catch(() => undefined);
    }
    go(3);
  }

  function newSearch() {
    reset();
    setArea(null);
    setPulse(null);
    setPulseAvoided(0);
    setMaxStep(1);
    go(1);
  }

  function expandRadius() {
    if (!need || !location) return;
    reset();
    void scan(need, { ...location, radiusKm: Math.min(20, location.radiusKm * 2) });
  }

  const drawerSlot = drawerKey ? mission.slots.find((s) => s.key === drawerKey) : null;
  const drawerData: DrawerData | null = drawerSlot
    ? {
        title: drawerSlot.facility.name,
        subtitle: `${formatKm(drawerSlot.facility.distanceKm)} · ${drawerSlot.facility.address}`,
        staffLabel: drawerSlot.facility.kind === "blood_bank" ? "Blood bank" : "Pharmacy",
        call: drawerSlot.call,
        events: drawerSlot.events,
        plan: drawerSlot.plan,
        mode: drawerSlot.mode,
        dialTarget: drawerSlot.dialTarget,
        recordKey: drawerSlot.recordKey,
      }
    : null;

  const blood = need?.kind === "blood_bank";

  return (
    <main className="relative min-h-screen">
      <Background />
      <TopBar config={config} step={step} maxStep={maxStep} onStep={go} />

      {step === 1 && <Hero />}
      {step === 2 && (
        <StepHeader
          eyebrow="Step 2 · Discover"
          title={`Choose which ${blood ? "blood banks" : "pharmacies"} to call`}
          body="Real listings with phone numbers on a live map, marked with anything the Shortage Pulse heard recently. Places that just said no are left out to save calls. Nothing has been dialed yet."
        />
      )}
      {step === 3 && (
        <StepHeader
          eyebrow="Step 3 · Mission control"
          title={`Agents on the line for ${needTitle(need)}`}
          body="Each card is one agent call working through phone menus and hold music to a schema-validated result. The spotlight streams the busiest conversation, and queued calls are cancelled the moment the target is reached."
        />
      )}
      {step === 4 && (
        <StepHeader
          eyebrow="Step 4 · Secure"
          title="Verified by phone. Now lock it in."
          body="Ranked strictly by what staff said, with verbatim evidence. Refusals and unanswered calls stay visible instead of disappearing."
        />
      )}

      <motion.div key={step} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        {step === 1 && <NeedStep busy={scanning} error={scanError} aiLabel={config?.ai ?? null} onContinue={(n, loc) => void scan(n, loc)} />}
        {step === 2 && area && need && (
          <FacilitiesStep
            area={area}
            need={need}
            radiusKm={location?.radiusKm ?? 3}
            config={config}
            pulse={pulse}
            selected={selected}
            onSelected={setSelected}
            settings={settings}
            onSettings={setSettings}
            onBack={() => go(1)}
            onPreview={() => void previewBrief()}
            onDispatch={dispatch}
          />
        )}
        {step === 3 && area && (
          <DispatchBoard mission={mission} center={area.center} radiusKm={location?.radiusKm ?? 3} onStop={stop} onRetry={retry} onOpen={setDrawerKey} onResults={() => go(4)} />
        )}
        {step === 4 && mission.need && area && (
          <ResultsStep
            mission={mission}
            center={area.center}
            config={config}
            pulseAvoided={pulseAvoided}
            onOpenSlot={setDrawerKey}
            onBoard={() => go(3)}
            onExpand={expandRadius}
            onNewSearch={newSearch}
          />
        )}
      </motion.div>

      <Footer />
      <CallDrawer data={drawerData} onClose={() => setDrawerKey(null)} />
      <BriefModal open={brief.open} loading={brief.loading} plan={brief.plan} error={brief.error} onClose={() => setBrief((b) => ({ ...b, open: false }))} />
    </main>
  );
}
