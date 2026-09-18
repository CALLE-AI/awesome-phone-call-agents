import { Card, CardContent } from "@/components/ui/card";
import type { LeadRow } from "@/lib/db/schema";

export function LeadStats({ rows }: { rows: LeadRow[] }) {
  if (rows.length === 0) return null;

  const doneRows = rows.filter((lead) => lead.status === "done");
  const qualifiedCount = doneRows.filter((lead) => lead.outcome === "qualified").length;
  const pendingCount = rows.filter((lead) => lead.status === "pending" || lead.status === "in_progress").length;
  const avgScore =
    doneRows.length > 0
      ? Math.round(doneRows.reduce((sum, lead) => sum + (lead.score ?? 0), 0) / doneRows.length)
      : null;

  const stats: { label: string; value: string | number }[] = [
    { label: "Total leads", value: rows.length },
    { label: "Awaiting dispatch", value: pendingCount },
    { label: "Qualified", value: qualifiedCount },
    { label: "Avg. score (done)", value: avgScore ?? "—" },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="py-4">
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
