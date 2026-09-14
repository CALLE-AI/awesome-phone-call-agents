import "server-only";

import { randomUUID } from "crypto";

import { calleWebhookUrl, campaignNameFromGoal, createSafeDraftFromCompiled } from "@/lib/campaigns/compile";
import { compileWorkflow } from "@/lib/engine-client";
import { SAMPLE_CONTACTS } from "@/lib/sample-campaign";
import type { SafeCallDraft } from "@/lib/calle/safety";
import type { CalleCallRequest, Contact } from "@/types/campaign";
import type { Workflow } from "@/types/workflow";

export interface CompiledCampaignDraft {
  compiled: CalleCallRequest;
  name: string;
  contact: Contact;
  draft: SafeCallDraft;
}

/**
 * Compiles a workflow into the exact Calls API request for a single seed contact and
 * builds the validated safe call draft. Shared by all campaign-creation entry points
 * (the workflow editor's "Compile to Call", the campaigns list's "New Campaign" flow,
 * and re-running a past campaign) so the CALL-E-adjacent compile/validation logic
 * exists in exactly one place. Each caller still owns its own database transaction for
 * the campaign/contact insert, since entry points differ in what else that transaction
 * needs to do — re-running, for instance, inserts every original contact, not just this
 * one seed.
 */
export async function compileWorkflowForCampaign(params: {
  workflow: Workflow;
  campaignId: string;
  name?: string;
  /** Defaults to a standards-reserved fictional contact — see lib/sample-campaign.ts. */
  seedContact?: Omit<Contact, "id">;
}): Promise<CompiledCampaignDraft> {
  const sample = params.seedContact ?? SAMPLE_CONTACTS[0];
  const contact: Contact = {
    id: randomUUID(),
    name: sample.name,
    phoneNumber: sample.phoneNumber,
    ...(sample.metadata ? { metadata: sample.metadata } : {}),
  };

  const compiled = await compileWorkflow({
    workflow: params.workflow,
    campaignId: params.campaignId,
    contact,
    webhookUrl: calleWebhookUrl(),
  });
  const name =
    params.name?.trim() ||
    campaignNameFromGoal(params.workflow.name ?? params.workflow.goal);
  const draft = createSafeDraftFromCompiled(compiled, name, contact, "en-IN");
  return { compiled, name, contact, draft };
}
