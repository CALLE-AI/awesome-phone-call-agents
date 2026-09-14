"use client";
import { Activity, Droplet, EyeOff, Lock, PhoneOff, Pill, Radio, ShieldCheck, Timer } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Background, Footer, TopBar } from "@/components/Chrome";
import { LiveMap } from "@/components/Map";
import { Button, Card, Chip, ModeDot, Segmented, Stat } from "@/components/ui";
import { ageLabel, freshHours, SIGHTING_META, type PulseResponse, type PulseSummary, type Sighting, type SightingStatus } from "@/lib/pulse-item";
import type { AppConfig, NeedKind } from "@/lib/types";
import { cx } from "@/lib/ui";

type KindFilter = "all" | NeedKind;

/** Equirectangular distance; plenty for sizing a city-scale map. */
function roughKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = ((b.lon - a.lon) * Math.PI) / 180 * Math.cos(((a.lat + b.lat) * Math.PI) / 360);
  const y = ((b.lat - a.lat) * Math.PI) / 180;
  return Math.hypot(x, y) * 6371;
}

const BAR_ORDER: SightingStatus[] = ["available", "partial", "alternative", "refused", "out"];
const FALLBACK_CENTER = { lat: 40.6782, lon: -73.9442 };

function StatusBar({ summary }: { summary: PulseSummary }) {
  const total = summary.answers || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${summary.available} of ${summary.answers} had it`}>
      {BAR_ORDER.map((status) =>
        summary[status] ? <span key={status} style={{ width: `${(summary[status] / total) * 100}%`, background: SIGHTING_META[status].color }} /> : null,
      )}
    </div>
  );
}

function isStale(s: Sighting, now: number): boolean {
  return now - Date.parse(s.observedAt) > (freshHours(s.kind, s.status) * 3_600_000) / 2;
}

export default function PulsePage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [pulse, setPulse] = useState<PulseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [itemKey, setItemKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig(null));
    const load = () =>
      fetch("/api/pulse", { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error("Could not load the Pulse.");
          setPulse(await r.json());
          setNow(Date.now());
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  const items = (pulse?.items ?? []).filter((row) => kind === "all" || row.kind === kind);
  const sightings = useMemo(
    () => (pulse?.sightings ?? []).filter((s) => (kind === "all" || s.kind === kind) && (!itemKey || s.item.key === itemKey)),
    [pulse, kind, itemKey],
  );
  const center = useMemo(() => {
    if (!sightings.length) return FALLBACK_CENTER;
    return { lat: sightings.reduce((n, s) => n + s.lat, 0) / sightings.length, lon: sightings.reduce((n, s) => n + s.lon, 0) / sightings.length };
  }, [sightings]);
  const radiusKm = Math.max(1, ...sightings.map((s) => roughKm(center, s)));
  const places = new Set(sightings.map((s) => s.facilityId ?? s.id)).size;
  const withheld = sightings.filter((s) => s.facilityId === null).length;

  return (
    <main className="relative min-h-screen">
      <Background />
      <TopBar config={config} />
      <div className="mx-auto max-w-7xl px-5 pb-6 pt-10">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600">
          <Activity className="h-4 w-4" /> Shortage Pulse
        </div>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Call once. Answer everyone.</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
          Every answer a PharmaBridge call hears lands here with a timestamp and no names or patient details. The next family sees it before anyone dials,
          so pharmacists and blood banks stop answering the same question twice, and a PharmaBridge agent only calls where nobody knows yet.
        </p>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-5">
        <Card className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
          <Stat value={pulse?.summary.answers ?? "—"} label="fresh answers shared" accent icon={<Radio className="h-4 w-4" />} />
          <Stat value={pulse ? places : "—"} label="places covered" />
          <Stat value={pulse?.items.length ?? "—"} label="items tracked" />
          <Stat value={pulse?.avoided ?? "—"} label="calls avoided so far" icon={<PhoneOff className="h-4 w-4" />} />
        </Card>

        <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
          <Card className="flex flex-col p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Segmented<KindFilter>
                value={kind}
                onChange={(next) => {
                  setKind(next);
                  setItemKey(null);
                }}
                options={[
                  { value: "all", label: "All" },
                  { value: "pharmacy", label: <><Pill className="h-3.5 w-3.5" /> Medicine</> },
                  { value: "blood_bank", label: <><Droplet className="h-3.5 w-3.5" /> Blood</> },
                ]}
              />
              {itemKey && (
                <button onClick={() => setItemKey(null)} className="text-[11.5px] font-semibold text-violet-600 hover:underline">
                  Show all
                </button>
              )}
            </div>
            {error && <p className="p-3 text-sm text-rose-600">{error}</p>}
            {pulse && items.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-slate-400">
                <Activity className="h-6 w-6" />
                No fresh answers yet. Answers from PharmaBridge calls appear here within seconds.
                <Link href="/">
                  <Button variant="secondary" className="mt-2">Start a search</Button>
                </Link>
              </div>
            )}
            <div className="scroll-thin max-h-[560px] space-y-2 overflow-auto pr-1">
              {items.map((row) => {
                const active = itemKey === row.item.key;
                const s = row.summary;
                return (
                  <button
                    key={row.item.key}
                    onClick={() => setItemKey(active ? null : row.item.key)}
                    className={cx("w-full rounded-2xl p-3 text-left transition", active ? "bg-violet-50 ring-1 ring-violet-200" : "ring-1 ring-slate-200/70 hover:bg-slate-50")}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className={cx("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", row.kind === "blood_bank" ? "bg-rose-50 text-rose-500" : "bg-indigo-50 text-indigo-500")}>
                        {row.kind === "blood_bank" ? <Droplet className="h-3.5 w-3.5" /> : <Pill className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold leading-snug text-slate-800">{row.item.label}</span>
                        <span className="mt-0.5 block text-[11.5px] text-slate-500">
                          {s.available + s.partial} of {s.answers} had it · {s.out} out{s.refused ? ` · ${s.refused} won't say` : ""}
                          {s.newestAt ? ` · ${ageLabel(s.newestAt, now)}` : ""}
                        </span>
                      </span>
                      {row.item.controlled && (
                        <Chip tone="violet" title="Controlled medication: in-stock pharmacies are never named">
                          <Lock className="h-3 w-3" /> Controlled
                        </Chip>
                      )}
                    </div>
                    <div className="mt-2.5">
                      <StatusBar summary={s} />
                    </div>
                    {s.restock.length > 0 && (
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Timer className="h-3 w-3 text-amber-500" /> Restock heard: {s.restock.join(" · ")}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="h-[420px]">
              <LiveMap
                center={center}
                radiusKm={radiusKm}
                accent="#10b981"
                fitKey={`${kind}|${itemKey ?? ""}|${sightings.length}`}
                markers={sightings.map((s) => ({
                  id: s.id,
                  lat: s.lat,
                  lon: s.lon,
                  color: SIGHTING_META[s.status].color,
                  label: s.facilityId ? (s.status === "available" ? "✓" : s.status === "out" ? "×" : "•") : "≈",
                  dim: isStale(s, now),
                  title: s.facilityName ?? "Area answer · name withheld",
                  subtitle: `${s.item.label} · ${SIGHTING_META[s.status].label} · ${ageLabel(s.observedAt, now)}`,
                }))}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 px-5 py-3 text-[11.5px] text-slate-500">
              {BAR_ORDER.map((status) => (
                <span key={status} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: SIGHTING_META[status].color }} /> {SIGHTING_META[status].label}
                </span>
              ))}
              <span className="ml-auto">Faded pins are past half their freshness window.</span>
            </div>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between p-5 pb-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Latest answers</div>
            {withheld > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-violet-700">
                <EyeOff className="h-3.5 w-3.5" /> {withheld} controlled-medication {withheld === 1 ? "answer is" : "answers are"} shown by area only
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-y border-slate-100 bg-slate-50/70 text-[10.5px] uppercase tracking-[0.12em] text-slate-400">
                <tr>
                  <th className="px-5 py-2.5 font-bold">Heard</th>
                  <th className="px-3 py-2.5 font-bold">Item</th>
                  <th className="px-3 py-2.5 font-bold">Place</th>
                  <th className="px-3 py-2.5 font-bold">Answer</th>
                  <th className="px-3 py-2.5 font-bold">Detail</th>
                  <th className="px-3 py-2.5 font-bold">Source</th>
                </tr>
              </thead>
              <tbody>
                {sightings.slice(0, 40).map((s) => (
                  <tr key={s.id} className="border-b border-slate-100">
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-[11.5px] text-slate-500">{ageLabel(s.observedAt, now)}</td>
                    <td className="px-3 py-3 font-medium text-slate-800">{s.item.label}</td>
                    <td className="px-3 py-3 text-slate-600">{s.facilityName ?? <span className="italic text-violet-600">Name withheld · area only</span>}</td>
                    <td className="px-3 py-3">
                      <Chip className={SIGHTING_META[s.status].chip}>{SIGHTING_META[s.status].label}</Chip>
                    </td>
                    <td className="max-w-[260px] px-3 py-3 text-slate-500">
                      <span className="line-clamp-2">{[s.quantity, s.restock ? `restock: ${s.restock}` : ""].filter(Boolean).join(" · ") || "—"}</span>
                    </td>
                    <td className="px-3 py-3">
                      <ModeDot live={s.live} className="ml-3" />
                    </td>
                  </tr>
                ))}
                {sightings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-sm text-slate-400">
                      Nothing fresh for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="grid gap-5 p-6 md:grid-cols-3">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            <p className="text-[12.5px] leading-relaxed text-slate-600">
              <strong className="text-slate-800">Only the facility&apos;s own words.</strong> Every answer is a call result that passed PharmaBridge&apos;s schema, heard on
              the facility&apos;s own listed number or from the built-in directory. Answers about a real business from any other line never appear, and nobody
              can type a claim onto the Pulse.
            </p>
          </div>
          <div className="flex gap-3">
            <Timer className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <p className="text-[12.5px] leading-relaxed text-slate-600">
              <strong className="text-slate-800">Answers expire.</strong> Stock answers last 12 hours, blood 6 hours, and &ldquo;not here&rdquo; answers 24 hours. No
              patient data, staff names, or quotes are shared.
            </p>
          </div>
          <div className="flex gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-violet-500" />
            <p className="text-[12.5px] leading-relaxed text-slate-600">
              <strong className="text-slate-800">Where it isn&apos;t, never where it is.</strong> For controlled medications the Pulse names pharmacies that are out, but
              shows in-stock answers only as an area count, so it never becomes a map for theft or diversion.
            </p>
          </div>
        </Card>
      </div>
      <Footer />
    </main>
  );
}
