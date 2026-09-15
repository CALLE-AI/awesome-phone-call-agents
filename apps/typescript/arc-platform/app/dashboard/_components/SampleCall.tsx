"use client";

import { Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export interface CallMoment {
  station: string;
  frequency: string;
  duration: string;
  quote: string;
  /** True only when this came from a real completed call. */
  real: boolean;
}

/**
 * What a finished CALL-E call looks like. Arc's actual differentiator - it
 * phones stations - was invisible everywhere inside the app.
 *
 * Purely presentational, and deliberately separate from LiveCallCard and
 * BatchCallPanel: it touches no call, polling or booking logic.
 *
 * `real: false` renders a "Sample" pill. There is no calls table in the schema,
 * so today it is always a sample - never dressed up as a result.
 */
export default function SampleCall({ moment }: { moment: CallMoment }) {
  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface p-6 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <Phone aria-hidden strokeWidth={1.75} className="size-4 text-text-muted" />
          <span className="type-label text-text-muted">What a call comes back with</span>
        </span>
        {moment.real ? null : <Badge variant="muted">Sample</Badge>}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-h3 text-text">{moment.station}</span>
        <span className="type-data text-text-muted">{moment.frequency}</span>
        <span className="type-data ml-auto text-text-muted">{moment.duration}</span>
      </div>

      <blockquote className="border-l-2 border-lilac-deep pl-4 text-body text-text">
        “{moment.quote}”
      </blockquote>
    </section>
  );
}
