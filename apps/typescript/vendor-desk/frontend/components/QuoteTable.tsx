"use client";

import { Fragment, useState } from "react";
import { CheckCircle2, XCircle, Clock, PhoneCall, ChevronDown, ChevronUp } from "lucide-react";
import { CallJob } from "../app/types";

function StatusBadge({ status }: { status: CallJob["status"] }) {
  const styles: Record<CallJob["status"], string> = {
    pending: "bg-slate-100 text-slate-600",
    "in-progress": "bg-brand-100 text-brand-700",
    completed: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
  };
  const icons: Record<CallJob["status"], React.ReactNode> = {
    pending: <Clock size={14} />,
    "in-progress": <PhoneCall size={14} className="animate-pulse" />,
    completed: <CheckCircle2 size={14} />,
    failed: <XCircle size={14} />,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}
    >
      {icons[status]}
      {status.replace("-", " ")}
    </span>
  );
}

export default function QuoteTable({ jobs }: { jobs: CallJob[] }) {
  const [openTranscript, setOpenTranscript] = useState<string | null>(null);

  const lowestPrice = jobs
    .filter((j) => j.status === "completed" && j.quote?.inStock && j.quote?.unitPrice != null)
    .reduce<number | null>((min, j) => {
      const price = j.quote!.unitPrice as number;
      return min === null || price < min ? price : min;
    }, null);

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-500">
        No sourcing runs yet. Start one to see live quotes here.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Vendor</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">In Stock</th>
            <th className="px-4 py-3">Unit Price</th>
            <th className="px-4 py-3">Delivery</th>
            <th className="px-4 py-3">Rep</th>
            <th className="px-4 py-3">Transcript</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {jobs.map((job) => {
            const isLowest =
              job.status === "completed" &&
              job.quote?.inStock &&
              job.quote?.unitPrice != null &&
              lowestPrice != null &&
              job.quote.unitPrice === lowestPrice;

            return (
              <Fragment key={job.id}>
                <tr className={isLowest ? "bg-emerald-50" : ""}>
                  <td className="px-4 py-3 font-medium">{job.task.vendorName}</td>
                  <td className="px-4 py-3 text-slate-500">{job.task.phoneNumber}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3">
                    {job.quote ? (
                      job.quote.inStock ? (
                        <CheckCircle2 size={16} className="text-emerald-600" />
                      ) : (
                        <XCircle size={16} className="text-slate-400" />
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`px-4 py-3 font-semibold ${isLowest ? "text-emerald-700" : ""}`}>
                    {job.quote?.unitPrice != null ? `$${job.quote.unitPrice.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {job.quote?.deliveryAvailable === true
                      ? "Yes"
                      : job.quote?.deliveryAvailable === false
                        ? "No"
                        : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{job.quote?.representativeName ?? "—"}</td>
                  <td className="px-4 py-3">
                    {job.transcript ? (
                      <button
                        onClick={() => setOpenTranscript(openTranscript === job.id ? null : job.id)}
                        className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                      >
                        View
                        {openTranscript === job.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                {openTranscript === job.id && job.transcript && (
                  <tr>
                    <td colSpan={8} className="bg-slate-50 px-4 py-3 text-xs text-slate-600 whitespace-pre-wrap">
                      {job.transcript}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
