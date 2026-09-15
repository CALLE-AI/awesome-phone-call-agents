"use client";
import { motion } from "framer-motion";
import { Activity, ArrowRight, CheckCircle2, Headphones, Octagon, PhoneOutgoing, Radio, Timer, Zap } from "lucide-react";
import type { Mission } from "@/hooks/useMission";
import { PHASE_META, missionMetrics } from "@/lib/mission";
import { TIER_META, formatClock, formatKm, onMap } from "@/lib/ui";
import { CallCard } from "./CallCard";
import { LiveMap } from "./Map";
import { Spotlight } from "./Spotlight";
import { Button, Card, IconBubble, Stat } from "./ui";

const LEGEND = [
  { label: "Dialing", color: PHASE_META.dialing.color },
  { label: "Menu / hold", color: PHASE_META.ivr.color },
  { label: "Talking", color: PHASE_META.talking.color },
  { label: "Available", color: TIER_META.confirmed.color },
  { label: "Partial", color: TIER_META.partial.color },
  { label: "Not available", color: TIER_META.out.color },
  { label: "Not reached", color: TIER_META.unreached.color },
];

export function DispatchBoard({
  mission,
  center,
  radiusKm,
  onStop,
  onRetry,
  onOpen,
  onResults,
}: {
  mission: Mission;
  center: { lat: number; lon: number };
  radiusKm: number;
  onStop: () => void;
  onRetry: (key: string) => void;
  onOpen: (key: string) => void;
  onResults: () => void;
}) {
  const metrics = missionMetrics(mission.slots, mission.startedAt, mission.finishedAt);
  const settled = metrics.placed + metrics.skipped;
  const progress = mission.slots.length ? Math.min(1, settled / mission.slots.length) : 0;
  const events = mission.slots
    .flatMap((s) => s.events.map((e) => ({ ...e, who: s.facility.name, slotKey: s.key })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);

  return (
    <section className="mx-auto max-w-7xl space-y-5 px-5">
      <Card className="overflow-hidden">
        <div className="h-1.5 bg-slate-100">
          <div className="brand-bg h-full transition-all duration-700" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-6 p-5">
          <div className="grid flex-1 grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat icon={<IconBubble tone="violet"><Timer className="h-4 w-4" /></IconBubble>} value={formatClock(metrics.wallMs)} label="mission clock" accent />
            <Stat icon={<IconBubble tone="sky"><PhoneOutgoing className="h-4 w-4" /></IconBubble>} value={`${metrics.placed}/${mission.slots.length}`} label="calls placed" />
            <Stat
              icon={<IconBubble tone="emerald"><CheckCircle2 className="h-4 w-4" /></IconBubble>}
              value={`${metrics.confirmed}/${mission.settings.stopAfter}`}
              label="confirmed · target"
            />
            <Stat icon={<IconBubble tone="fuchsia"><Headphones className="h-4 w-4" /></IconBubble>} value={metrics.active} label="agents on the line" />
            <Stat icon={<IconBubble tone="amber"><Activity className="h-4 w-4" /></IconBubble>} value={formatClock(metrics.talkSeconds * 1000)} label="agent talk time" />
            <Stat
              icon={<IconBubble tone="indigo"><Zap className="h-4 w-4" /></IconBubble>}
              value={metrics.parallelSpeedup ? `${metrics.parallelSpeedup.toFixed(1)}×` : "—"}
              label="faster than one-by-one"
            />
          </div>
          <div className="flex gap-3">
            {mission.status === "running" && (
              <Button variant="danger" onClick={onStop} icon={<Octagon className="h-4 w-4" />}>
                Stop dispatch
              </Button>
            )}
            {(mission.status === "complete" || metrics.confirmed > 0) && (
              <Button onClick={onResults} icon={<ArrowRight className="h-4 w-4" />}>
                View results
              </Button>
            )}
          </div>
        </div>
      </Card>

      {mission.stopReason && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2.5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> {mission.stopReason}
        </motion.div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <Card className="overflow-hidden">
          <div className="h-[430px]">
            <LiveMap
              center={center}
              radiusKm={radiusKm}
              routes
              fitKey={mission.id}
              onSelect={onOpen}
              markers={mission.slots.filter((s) => onMap(s.facility.source)).map((s) => {
                const phase = PHASE_META[s.phase];
                return {
                  id: s.key,
                  lat: s.facility.lat,
                  lon: s.facility.lon,
                  color: s.assessment ? TIER_META[s.assessment.tier].color : phase.color,
                  label: String(s.order + 1),
                  pulse: phase.pulse,
                  dim: s.phase === "skipped",
                  title: s.facility.name,
                  subtitle: `${s.assessment ? TIER_META[s.assessment.tier].label : phase.label} · ${formatKm(s.facility.distanceKm)}`,
                };
              })}
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-slate-100 px-5 py-2.5">
            {LEGEND.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        </Card>
        <Spotlight slots={mission.slots} onOpen={onOpen} />
      </div>

      <div className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {mission.slots.map((slot) => (
          <CallCard key={slot.key} slot={slot} onOpen={() => onOpen(slot.key)} onRetry={() => onRetry(slot.key)} />
        ))}
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
          <Radio className="h-3.5 w-3.5 text-violet-500" /> Event stream
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-slate-400">Waiting for the first events…</p>
        ) : (
          <ul className="grid gap-x-8 gap-y-2 md:grid-cols-2">
            {events.map((e) => (
              <li key={`${e.slotKey}-${e.id}`} className="flex gap-3 text-[12px]">
                <span className="shrink-0 font-mono text-slate-400">
                  {new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className="truncate text-slate-500">
                  <span className="font-semibold text-slate-700">{e.who}</span> · {e.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
