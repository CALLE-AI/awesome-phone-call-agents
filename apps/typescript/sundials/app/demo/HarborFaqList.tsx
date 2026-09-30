"use client";

import { sundials } from "@/lib/sdk";

export type HarborFaqItem = {
  topic: string;
  q: string;
  a: string;
};

export function HarborFaqList({
  items,
  compact = false
}: {
  items: HarborFaqItem[];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "grid gap-4 md:grid-cols-2" : "space-y-3"}>
      {items.map((item) => (
        <details
          key={item.topic}
          className="rounded-xl border border-border bg-card px-5 py-4"
          onToggle={(event) => {
            const el = event.currentTarget;
            if (!el.open) return;
            sundials.track("faq_opened", {
              topic: item.topic,
              question: item.q
            });
          }}
        >
          <summary
            className={`cursor-pointer list-none font-heading text-foreground marker:content-none [&::-webkit-details-marker]:hidden ${
              compact ? "text-base" : "text-xl"
            }`}
          >
            <span className="flex items-start justify-between gap-3">
              <span>{item.q}</span>
              <span className="mt-0.5 text-muted-foreground" aria-hidden>
                +
              </span>
            </span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
