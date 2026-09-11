"use client";

import { useEffect, useState } from "react";
import { PhoneCall, PackageCheck, TrendingDown, Award } from "lucide-react";
import QuoteTable from "../components/QuoteTable";
import NewJobModal from "../components/NewJobModal";
import { CallJob } from "./types";

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="rounded-lg bg-brand-50 p-2 text-brand-600">{icon}</div>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<CallJob[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  async function refreshJobs() {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    setJobs(data.jobs ?? []);
  }

  useEffect(() => {
    refreshJobs();

    const source = new EventSource("/api/jobs/stream");
    source.onmessage = (event) => {
      const updatedJob: CallJob = JSON.parse(event.data);
      setJobs((prev) => {
        const exists = prev.some((j) => j.id === updatedJob.id);
        return exists
          ? prev.map((j) => (j.id === updatedJob.id ? updatedJob : j))
          : [updatedJob, ...prev];
      });
    };
    return () => source.close();
  }, []);

  const totalCalls = jobs.length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const inStockQuotes = jobs.filter((j) => j.status === "completed" && j.quote?.inStock && j.quote?.unitPrice != null);
  const lowest = inStockQuotes.reduce<CallJob | null>((min, j) => {
    if (!min || (j.quote!.unitPrice as number) < (min.quote!.unitPrice as number)) return j;
    return min;
  }, null);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">VendorDesk</h1>
          <p className="text-sm text-slate-500">Autonomous Procurement Agent — powered by CALL-E</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
        >
          Start Sourcing Run
        </button>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={<PhoneCall size={18} />} label="Total Calls Made" value={String(totalCalls)} />
        <StatCard icon={<PackageCheck size={18} />} label="Completed" value={String(completed)} />
        <StatCard
          icon={<TrendingDown size={18} />}
          label="Lowest Quote Found"
          value={lowest?.quote?.unitPrice != null ? `$${lowest.quote.unitPrice.toFixed(2)}` : "—"}
        />
        <StatCard
          icon={<Award size={18} />}
          label="Top Recommended Vendor"
          value={lowest?.task.vendorName ?? "—"}
        />
      </div>

      <QuoteTable jobs={jobs} />

      {modalOpen && (
        <NewJobModal onClose={() => setModalOpen(false)} onDispatched={refreshJobs} />
      )}
    </main>
  );
}
