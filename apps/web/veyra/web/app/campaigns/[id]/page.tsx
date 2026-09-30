import { asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import CampaignBuilder from "@/components/CampaignBuilder";
import StepHeader from "@/components/StepHeader";
import { campaigns, contacts, workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { getSessionUser } from "@/lib/supabase/auth";
import { toCampaignLocale, type CampaignStatus, type Contact } from "@/types/campaign";
import type { Workflow } from "@/types/workflow";

/**
 * A single campaign's setup/contacts/preview/launch view. Results (durable call outcomes
 * and transcripts) live on /results/[id] instead — see components/ResultsList.tsx.
 */
export default async function CampaignByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/auth/login?next=/campaigns/${id}`);

  const loaded = await withRLS(user.id, async (tx) => {
    const [campaign] = await tx
      .select({
        id: campaigns.id,
        workflowId: campaigns.workflowId,
        name: campaigns.name,
        status: campaigns.status,
        locale: campaigns.locale,
        scheduledAt: campaigns.scheduledAt,
        failureMessage: campaigns.failureMessage,
        compiledRequest: campaigns.compiledRequest,
      })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!campaign?.workflowId || !campaign.compiledRequest) return null;
    const workflowId = campaign.workflowId;

    const [workflowRow] = await tx
      .select({ schema: workflows.schema })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .limit(1);
    const contactRows = await tx
      .select({
        id: contacts.id,
        name: contacts.name,
        phoneNumber: contacts.phoneNumber,
        metadata: contacts.metadata,
      })
      .from(contacts)
      .where(eq(contacts.campaignId, campaign.id))
      .orderBy(asc(contacts.position), asc(contacts.id));
    if (!workflowRow || !contactRows.length) return null;

    return {
      ...campaign,
      workflowId,
      workflow: workflowRow.schema as Workflow,
      contacts: contactRows.map(
        (contact): Contact => ({
          id: contact.id,
          name: contact.name,
          phoneNumber: contact.phoneNumber,
          ...(contact.metadata && typeof contact.metadata === "object"
            ? { metadata: contact.metadata as Record<string, string> }
            : {}),
        }),
      ),
    };
  });

  if (!loaded) notFound();

  const initialCsv = loaded.contacts
    .map((item) => `${item.name}, ${item.phoneNumber}`)
    .join("\n");

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <StepHeader current="campaign" />
      <CampaignBuilder
        campaignId={loaded.id}
        workflowId={loaded.workflowId}
        initialName={loaded.name}
        initialLocale={toCampaignLocale(loaded.locale)}
        initialScheduledAt={loaded.scheduledAt?.toISOString() ?? null}
        initialContacts={loaded.contacts}
        initialCsv={initialCsv}
        stepCount={loaded.workflow.nodes.length}
        initialStatus={loaded.status as CampaignStatus}
        schedulingEnabled={process.env.CAMPAIGN_SCHEDULING_ENABLED === "true"}
        initialFailureMessage={loaded.failureMessage}
      />
    </div>
  );
}
