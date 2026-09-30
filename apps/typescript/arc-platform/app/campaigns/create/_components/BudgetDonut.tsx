"use client";

import { PieChart, Pie, Cell, Tooltip } from "recharts";

import { token } from "@/lib/tokens";

/**
 * Wedge fills come from lib/tokens - recharts writes them into SVG fill
 * attributes in JavaScript, which is exactly the case that module exists for.
 * The order is Radio, Influencer, Platform fee, matching the three slices
 * StepReview builds, and it mirrors the pastel deeps the analytics charts use
 * so a channel is the same colour wherever it is drawn.
 *
 * StepReview's legend paints the same three tones with Tailwind classes rather
 * than importing from here, because this module is dynamically imported and a
 * static import of it would defeat that.
 */
const DONUT_FILLS = [token.lilacDeep, token.blushDeep, token.butterDeep];

interface Props {
  data: { name: string; value: number }[];
}

export default function BudgetDonut({ data }: Props) {
  return (
    <PieChart width={180} height={180}>
      <Pie
        data={data}
        cx={90}
        cy={90}
        innerRadius={55}
        outerRadius={80}
        dataKey="value"
        strokeWidth={0}
      >
        {data.map((_, i) => (
          <Cell key={i} fill={DONUT_FILLS[i % DONUT_FILLS.length]} />
        ))}
      </Pie>
      <Tooltip
        contentStyle={{
          background: token.paper,
          border: `1px solid ${token.hairline}`,
          borderRadius: token.radiusControl,
          color: token.ink,
          fontSize: 12,
          boxShadow: token.shadowCard,
        }}
        formatter={(v) => {
          const value = typeof v === "number" ? v : Number(v ?? 0);
          return [`PKR ${value.toLocaleString()}`, ""];
        }}
      />
    </PieChart>
  );
}
