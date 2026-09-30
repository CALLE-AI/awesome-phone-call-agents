"use client";

import { Badge } from "@/components/ui/badge";
import type { Show } from "../../_data";

/** Show type as a token NAME - section 9. Was three rgba() literals plus a
 *  #3D3A6B left over from the dark theme. */
const TYPE_META: Record<Show["type"], { variant: "butter" | "lilac" | "muted"; fill: string; label: string }> = {
  prime:    { variant: "butter", fill: "bg-butter", label: "Prime Time" },
  standard: { variant: "lilac",  fill: "bg-lilac",  label: "Standard" },
  offpeak:  { variant: "muted",  fill: "bg-hairline", label: "Off-Peak" },
};

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6am to midnight

function fmtHour(h: number) {
  if (h === 0 || h === 24) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

export default function ScheduleGrid({ shows, bestFor }: { shows: Show[]; bestFor: string[] }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-3">
        {(Object.keys(TYPE_META) as Show["type"][]).map(key => (
          <span key={key} className="flex items-center gap-2">
            <span aria-hidden className={`size-3 rounded-[4px] ${TYPE_META[key].fill}`} />
            <span className="text-small text-text-muted">{TYPE_META[key].label}</span>
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        {HOURS.map(hour => {
          const show = shows.find(s => s.startHour === hour);
          const isInShow = shows.find(s => hour > s.startHour && hour < s.endHour);
          if (isInShow) return null; // covered by a spanning show

          const meta = show ? TYPE_META[show.type] : null;

          return (
            <div key={hour} className="flex items-stretch gap-3">
              <span className="w-14 shrink-0 pt-2 text-right type-data text-text-muted">{fmtHour(hour)}</span>

              <div className="min-w-0 flex-1">
                {show && meta ? (
                  <div
                    className={`flex flex-wrap items-start justify-between gap-3 rounded-control p-4 ${meta.fill}`}
                    /* Was a hardcoded "Best for: FMCG, Consumer Brands" on
                       every show of every station. bestFor is real and
                       per-station. */
                    title={`Best for: ${bestFor.join(", ")}`}
                    style={{ minHeight: (show.endHour - show.startHour) * 48 }}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      {/* The daypart is the title now. It used to be a show
                          name over a presenter's name, both invented and both
                          attributed to a real station. Three lines become two;
                          the block, its height and its colour are unchanged. */}
                      <span className="text-small font-medium text-ink">{show.genre}</span>
                      <span className="text-small text-ink/70">{show.time}</span>
                    </span>
                    <Badge variant="outline">{meta.label}</Badge>
                  </div>
                ) : (
                  /* Was "Off-air / Station ID". The data has no show for this
                     hour; it does not say the station is off air. */
                  <div className="flex h-12 items-center rounded-control border border-dashed border-hairline px-4">
                    <span className="text-small text-text-muted">Not listed</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
