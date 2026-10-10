import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads } from "@/lib/db/schema";

/**
 * Cancels a lead before it's been called. Only "pending" leads can be cancelled — once a real
 * call is in flight (status "in_progress"), CALL-E's own run_call contract has no abort/interrupt
 * operation, so there's nothing safe to cancel until it reaches a terminal state on its own.
 * The conditional WHERE makes this the same atomic claim-or-noop pattern as dispatchLead's own
 * claim, so a cancel can't race a poller tick that's claiming the same lead at the same instant.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [lead] = await db
    .update(leads)
    .set({ status: "failed", summary: "Cancelled by operator before dispatch.", updatedAt: new Date() })
    .where(and(eq(leads.id, id), eq(leads.status, "pending")))
    .returning();

  if (!lead) {
    return NextResponse.json(
      { error: "Lead not found, or it's no longer pending (already dispatched or cancelled)." },
      { status: 409 },
    );
  }

  return NextResponse.json({ id: lead.id, status: lead.status });
}
