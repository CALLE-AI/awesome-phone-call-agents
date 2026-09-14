import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads } from "@/lib/db/schema";
import { AutoRefresh } from "@/components/leads/auto-refresh";
import { LeadStats } from "@/components/leads/lead-stats";
import { LeadTable } from "@/components/leads/lead-table";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const rows = await db.select().from(leads).orderBy(desc(leads.createdAt));

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <AutoRefresh />
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review console</h1>
          <p className="text-sm text-muted-foreground">
            Leads move pending → in_progress → done as the worker dispatches calls.
          </p>
        </div>
        <Link href="/" className="text-sm text-primary underline underline-offset-2">
          ← Back to lead form
        </Link>
      </div>

      <LeadStats rows={rows} />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No leads yet — submit one from the home page.</p>
      ) : (
        <LeadTable rows={rows} detailBasePath="/review" />
      )}
    </div>
  );
}
