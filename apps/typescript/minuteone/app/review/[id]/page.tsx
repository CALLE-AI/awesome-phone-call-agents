import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads } from "@/lib/db/schema";
import { loadBusinessConfig } from "@/lib/config/load";
import { LeadDetail } from "@/components/leads/lead-detail";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) notFound();

  const config = await loadBusinessConfig();
  const questionPrompt = (questionId: string) =>
    config.questions.find((q) => q.id === questionId)?.prompt ?? questionId;

  return (
    <LeadDetail lead={lead} backHref="/review" backLabel="Back to review console" questionPrompt={questionPrompt} />
  );
}
