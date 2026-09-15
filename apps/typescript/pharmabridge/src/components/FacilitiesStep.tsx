"use client";
import { Activity, ArrowLeft, Eye, PhoneOutgoing, ShieldCheck, Star, TriangleAlert } from "lucide-react";
import type { MissionSettings, Need } from "@/hooks/useMission";
import { ageLabel, SIGHTING_META, SKIP_STATUSES, type PulseResponse, type Sighting } from "@/lib/pulse-item";
import type { AppConfig, Facility, NeedKind, Routing } from "@/lib/types";
import { cx, formatKm, onMap } from "@/lib/ui";
import { LiveMap } from "./Map";
import { Button, Card, Chip, inputClass, Label, ModeDot, Segmented, Toggle } from "./ui";

export interface AreaResult {
  kind: NeedKind;
  center: { lat: number; lon: number; label: string };
  facilities: Facility[];
  withoutPhone: number;
  sources: Facility["source"][];
  warning?: string;
}

const SOURCE_LABEL: Record<Facility["source"], string> = { openstreetmap: "OpenStreetMap", google: "Google Places", synthetic: "Built-in directory" };

const ROUTING_HELP: Record<Routing, string> = {
  simulation: "Runs the whole mission in seconds and uses no CALL-E minutes.",
  test_line: "Real CALL-E calls to allowlisted stand-in phones, for example a teammate playing the pharmacist.",
  direct: "Real CALL-E calls to each facility's listed number, verified as coming from this map lookup.",
};

function PulseBanner({
  pulse,
  noun,
  skipped,
  onRecheck,
}: {
  pulse: PulseResponse;
  noun: string;
  skipped: number;
  onRecheck: () => void;
}) {
  const s = pulse.summary;
  return (
    <div className="mb-3 rounded-2xl bg-emerald-50/70 p-3 ring-1 ring-emerald-100">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">
        <Activity className="h-3.5 w-3.5" /> Shortage Pulse
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-emerald-950/80">
        {s.answers} recent {s.answers === 1 ? "answer" : "answers"} from other PharmaBridge calls near here: {s.available + s.partial} had it, {s.out} out
        {s.refused ? `, ${s.refused} won't say by phone` : ""}.
        {s.withheld ? ` ${s.withheld} in-stock ${s.withheld === 1 ? "answer is" : "answers are"} shown by area only because this is a controlled medication.` : ""}
        {skipped ? ` Left out ${skipped} recently checked ${noun} to save calls.` : ""}
      </p>
      <div className="mt-2 flex gap-3 text-[11.5px] font-semibold">
        {skipped > 0 && (
          <button className="text-emerald-700 hover:underline" onClick={onRecheck}>
            Call them anyway
          </button>
        )}
        <a href="/pulse" target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">
          Open the Pulse →
        </a>
      </div>
    </div>
  );
}

export function FacilitiesStep({
  area,
  need,
  radiusKm,
  config,
  pulse,
  selected,
  onSelected,
  settings,
  onSettings,
  onBack,
  onPreview,
  onDispatch,
}: {
  area: AreaResult;
  need: Need;
  radiusKm: number;
  config: AppConfig | null;
  pulse: PulseResponse | null;
  selected: string[];
  onSelected: (ids: string[]) => void;
  settings: MissionSettings;
  onSettings: (next: MissionSettings) => void;
  onBack: () => void;
  onPreview: () => void;
  onDispatch: () => void;
}) {
  const blood = area.kind === "blood_bank";
  const accent = blood ? "#f43f5e" : "#8b5cf6";
  const noun = blood ? "blood banks" : "pharmacies";
  const toggle = (id: string) => onSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const chosen = area.facilities.filter((f) => selected.includes(f.id));
  const liveRouting = settings.routing !== "simulation";
  const testLinesReady = Boolean(config?.liveEnabled && config.testLines.length);
  const syntheticChosen = settings.routing === "direct" && chosen.some((f) => f.source === "synthetic");
  const remainingToday = config ? Math.max(0, config.dailyCap - config.liveCallsToday) : 0;
  const blocked =
    !selected.length ||
    (liveRouting && !settings.operatorCode) ||
    (settings.routing === "direct" && (!settings.directConsent || syntheticChosen)) ||
    (liveRouting && selected.length > remainingToday);

  const heard = new Map<string, Sighting>((pulse?.sightings ?? []).filter((s) => s.facilityId).map((s) => [s.facilityId as string, s]));
  const skipped = area.facilities.filter((f) => {
    const s = heard.get(f.id);
    return s && SKIP_STATUSES.includes(s.status) && !selected.includes(f.id);
  });
  const agents = Math.min(settings.concurrency, selected.length);

  return (
    <section className="mx-auto max-w-7xl px-5">
      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <Button variant="ghost" className="-ml-2 px-2" onClick={onBack} icon={<ArrowLeft className="h-4 w-4" />}>
              Change need
            </Button>
            <div className="flex gap-1.5">
              {area.sources.map((s) => (
                <Chip key={s} tone={s === "synthetic" ? "slate" : s === "google" ? "sky" : "indigo"}>
                  {SOURCE_LABEL[s]}
                </Chip>
              ))}
            </div>
          </div>
          <div className="h-[520px]">
            <LiveMap
              center={area.center}
              radiusKm={radiusKm}
              accent={accent}
              fitKey={area.facilities.map((f) => f.id).join("|")}
              onSelect={toggle}
              markers={area.facilities.flatMap((f, i) => {
                if (!onMap(f.source)) return [];
                const s = heard.get(f.id);
                return [
                  {
                    id: f.id,
                    lat: f.lat,
                    lon: f.lon,
                    color: accent,
                    label: String(i + 1),
                    dim: !selected.includes(f.id),
                    selected: selected.includes(f.id),
                    title: f.name,
                    subtitle: `${formatKm(f.distanceKm)} · ${f.phoneMasked ?? "no phone"}${s ? ` · Pulse: ${SIGHTING_META[s.status].label.toLowerCase()} ${ageLabel(s.observedAt)}` : ""}`,
                  },
                ];
              })}
            />
          </div>
          <p className="px-5 py-3 text-[12.5px] leading-relaxed text-slate-500">
            <span className="font-semibold text-slate-800">{area.facilities.length}</span> {noun} with a listed phone within {radiusKm} km of{" "}
            <span className="font-medium text-slate-700">{area.center.label.split(",").slice(0, 2).join(",")}</span>
            {area.withoutPhone ? ` · ${area.withoutPhone} skipped because no phone is listed` : ""}
            {area.warning ? <span className="block text-amber-600">{area.warning}</span> : null}
            {area.sources.includes("google") ? (
              <span className="block text-slate-400">
                Listings include data © Google. Per Google Maps Platform terms, Google-sourced places appear in the list, not on this map.
              </span>
            ) : null}
          </p>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="p-5">
            {pulse && pulse.summary.answers > 0 && (
              <PulseBanner pulse={pulse} noun={noun} skipped={skipped.length} onRecheck={() => onSelected([...selected, ...skipped.map((f) => f.id)])} />
            )}
            <div className="mb-3 flex items-center justify-between">
              <Label hint={`${selected.length} selected`}>{blood ? "Blood banks" : "Pharmacies"} to call</Label>
              <div className="flex gap-1 text-[11px] font-semibold">
                <button className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" onClick={() => onSelected(area.facilities.slice(0, 6).map((f) => f.id))}>
                  Nearest 6
                </button>
                <button className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" onClick={() => onSelected(area.facilities.map((f) => f.id))}>
                  All
                </button>
                <button className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" onClick={() => onSelected([])}>
                  None
                </button>
              </div>
            </div>
            <div className="scroll-thin max-h-72 space-y-1.5 overflow-auto pr-1">
              {area.facilities.map((f, i) => {
                const on = selected.includes(f.id);
                const s = heard.get(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => toggle(f.id)}
                    className={cx("flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition", on ? "bg-violet-50/70 ring-1 ring-violet-200" : "hover:bg-slate-50")}
                  >
                    <span
                      className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold", on ? "text-white" : "bg-slate-100 text-slate-500")}
                      style={on ? { background: accent } : undefined}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800">{f.name}</span>
                      <span className="flex items-center gap-2 truncate text-[11.5px] text-slate-500">
                        {f.address}
                        {f.rating ? (
                          <span className="inline-flex items-center gap-0.5 text-amber-600">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {f.rating.toFixed(1)}
                          </span>
                        ) : null}
                        {f.openNow != null ? <span className={f.openNow ? "text-emerald-600" : "text-rose-500"}>{f.openNow ? "Open now" : "Closed now"}</span> : null}
                        {f.source === "google" ? <span className="font-semibold text-sky-600">Google</span> : null}
                      </span>
                      {s && (
                        <span className="mt-1 flex items-center gap-1.5 truncate text-[10.5px] text-slate-500">
                          <span className={cx("shrink-0 rounded-full px-1.5 py-px font-bold ring-1", SIGHTING_META[s.status].chip)}>
                            {SIGHTING_META[s.status].label} · {ageLabel(s.observedAt)}
                          </span>
                          {s.restock ? <span className="truncate">restock: {s.restock}</span> : null}
                        </span>
                      )}
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-[11px] font-semibold text-slate-700">{formatKm(f.distanceKm)}</span>
                      <span className="block font-mono text-[10px] text-slate-400">{f.phoneMasked}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="space-y-5 p-5">
            {config?.liveEnabled && (
              <div>
                <Label>Call routing</Label>
                <Segmented<Routing>
                  value={settings.routing}
                  onChange={(routing) => onSettings({ ...settings, routing })}
                  options={[
                    { value: "simulation", label: <><ModeDot live={false} /> Instant</> },
                    {
                      value: "test_line",
                      label: <><ModeDot live /> Test lines</>,
                      disabled: !testLinesReady,
                      hint: testLinesReady ? undefined : "Add PHARMABRIDGE_ALLOWED_NUMBERS to .env.local",
                    },
                    {
                      value: "direct",
                      label: <><ModeDot live /> Real numbers</>,
                      disabled: !config.directEnabled,
                      hint: config.directEnabled ? undefined : "Calling real numbers is not enabled on this server",
                    },
                  ]}
                />
                <p className="mt-2 text-[12px] leading-relaxed text-slate-500">{ROUTING_HELP[settings.routing]}</p>
                {settings.routing === "test_line" && (
                  <p className="mt-1 font-mono text-[11px] text-slate-400">Test lines: {config.testLines.map((t) => t.masked).join("  ·  ")}</p>
                )}
              </div>
            )}

            {settings.routing === "direct" && (
              <div className="space-y-3">
                <div className="flex gap-2.5 rounded-2xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>
                    This dials <strong>{selected.length} real {noun}</strong>. Each agent says it is an AI, and one call is used per facility
                    ({remainingToday} of {config?.dailyCap} left today).
                    {syntheticChosen ? " Built-in directory entries use 555-01xx numbers; deselect them first." : ""}
                  </span>
                </div>
                <Toggle checked={settings.directConsent} onChange={(directConsent) => onSettings({ ...settings, directConsent })}>
                  I&apos;m the patient or their caregiver, and I authorize an AI agent to call these {noun} on my behalf.
                </Toggle>
              </div>
            )}

            {liveRouting && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Operator code</Label>
                  <input
                    id="operator-code"
                    type="password"
                    className={inputClass}
                    value={settings.operatorCode}
                    onChange={(e) => onSettings({ ...settings, operatorCode: e.target.value })}
                    placeholder="From .env.local"
                  />
                </div>
                <div>
                  <Label>Voice locale</Label>
                  <select className={inputClass} value={settings.locale} onChange={(e) => onSettings({ ...settings, locale: e.target.value })}>
                    <option value="">Auto</option>
                    <option value="en-US">English (US)</option>
                    <option value="en-IN">English (India)</option>
                    <option value="en-GB">English (UK)</option>
                    <option value="en-SG">English (Singapore)</option>
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-5">
              <div>
                <Label hint={`${settings.concurrency} at once`}>Parallel agents</Label>
                <input type="range" min={1} max={5} value={settings.concurrency} onChange={(e) => onSettings({ ...settings, concurrency: Number(e.target.value) })} className="w-full accent-violet-600" />
              </div>
              <div>
                <Label hint={`after ${settings.stopAfter}`}>Stop when confirmed</Label>
                <input type="range" min={1} max={3} value={settings.stopAfter} onChange={(e) => onSettings({ ...settings, stopAfter: Number(e.target.value) })} className="w-full accent-fuchsia-600" />
              </div>
            </div>

            <div className="flex gap-2.5 rounded-2xl bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-600 ring-1 ring-slate-200/70">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span>
                Budget <strong className="text-slate-800">{selected.length} calls max</strong>, stopping after {settings.stopAfter} confirmation
                {settings.stopAfter > 1 ? "s" : ""}. Asking about{" "}
                <strong className="text-slate-800">{need.kind === "pharmacy" ? `${need.medication.name} · ${need.medication.quantity}` : `${need.blood.units} × ${need.blood.group}`}</strong>.
                Every call is recorded to the call ledger, and its answer is shared to the Shortage Pulse without names.
              </span>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={onPreview} disabled={!selected.length} icon={<Eye className="h-4 w-4" />}>
                Preview agent brief
              </Button>
              <Button variant={blood ? "blood" : "primary"} className="flex-1 py-3" onClick={onDispatch} disabled={blocked} icon={<PhoneOutgoing className="h-4 w-4" />}>
                Dispatch {agents} {agents === 1 ? "agent" : "agents"} · {selected.length} {selected.length === 1 ? noun.replace(/ies$/, "y").replace(/s$/, "") : noun}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
