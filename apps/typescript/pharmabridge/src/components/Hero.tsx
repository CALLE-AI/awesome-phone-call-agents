"use client";
import { motion } from "framer-motion";
import { Droplet, MapPinned, PhoneOutgoing, Pill, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { IconBubble, Stat } from "./ui";

const FLOW = [
  { icon: Pill, tone: "indigo" as const, title: "Normalize", body: "Exact drug via RxNorm with live FDA shortage and DEA status, or blood group, component, and units." },
  { icon: MapPinned, tone: "sky" as const, title: "Discover", body: "Real pharmacies and blood banks with listed phones on a live map. Discovery never dials." },
  { icon: PhoneOutgoing, tone: "violet" as const, title: "Dispatch", body: "Parallel CALL-E agents work phone menus, wait on hold, and ask the counter directly." },
  { icon: ShieldCheck, tone: "emerald" as const, title: "Secure", body: "Hold the stock or reserve the units, then hand off with a checklist and directions." },
];

export function Hero() {
  const [fdaRecords, setFdaRecords] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/shortages")
      .then((r) => r.json())
      .then((j) => setFdaRecords(typeof j.currentRecords === "number" ? j.currentRecords : null))
      .catch(() => setFdaRecords(null));
  }, []);

  return (
    <section className="mx-auto max-w-7xl px-5 pb-10 pt-12 md:pt-16">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="max-w-4xl">
        <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11.5px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
          <span className="brand-bg h-2 w-2 rounded-full" /> Autonomous phone agents, powered by CALL-E
        </div>
        <h1 className="mt-6 font-display text-[44px] font-bold leading-[1.02] tracking-tight text-slate-900 md:text-7xl">
          Out of stock? Out of blood?
          <br />
          <span className="brand-text">We&apos;ll make the calls.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
          Shelf stock and blood inventory aren&apos;t published anywhere, so families phone place after place. PharmaBridge sends voice
          agents to every nearby pharmacy or blood bank at once, returns verified answers with evidence, and secures a hold.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
            <Pill className="h-3.5 w-3.5" /> Shortage medicine
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
            <Droplet className="h-3.5 w-3.5" /> Blood units
          </span>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.12 }}
        className="mt-10 grid gap-4 lg:grid-cols-[1fr_1.7fr]"
      >
        <div className="card grid grid-cols-3 gap-4 rounded-3xl p-5">
          <Stat value="227" label="active US drug shortages, Q2 2026 (ASHP)" accent />
          <Stat value="48%" label="of new 2026 shortages are sole-source (ASHP)" />
          <Stat value={fdaRecords ? fdaRecords.toLocaleString() : "…"} label="current openFDA shortage listings, live" />
        </div>
        <div className="card grid grid-cols-2 gap-5 rounded-3xl p-5 md:grid-cols-4">
          {FLOW.map(({ icon: Icon, tone, title, body }, i) => (
            <div key={title}>
              <div className="flex items-center gap-2.5">
                <IconBubble tone={tone}>
                  <Icon className="h-4 w-4" />
                </IconBubble>
                <div>
                  <div className="text-[10px] font-bold text-slate-400">0{i + 1}</div>
                  <div className="text-sm font-bold text-slate-900">{title}</div>
                </div>
              </div>
              <p className="mt-2 text-[12px] leading-snug text-slate-500">{body}</p>
            </div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
