import "server-only";

import { createSafeDraftFromCompiled, calleWebhookUrl } from "@/lib/campaigns/compile";
import { prepareCampaignLaunch } from "@/lib/campaigns/lifecycle";
import { compileWorkflow } from "@/lib/engine-client";
import type { CallMode } from "@/lib/calle/safety";
import type { CampaignLocale, Contact } from "@/types/campaign";
import type { Workflow } from "@/types/workflow";

export async function compileAndPrepareCampaign(params: {
  userId: string;
  campaignId: string;
  campaignName: string;
  workflow: Workflow;
  contacts: Contact[];
  mode: CallMode;
  locale: CampaignLocale;
  scheduledAt: string | null;
}) {
  const compiled = await Promise.all(
    params.contacts.map((contact) =>
      compileWorkflow({
        workflow: params.workflow,
        campaignId: params.campaignId,
        contact,
        webhookUrl: calleWebhookUrl(),
        locale: params.locale,
      }),
    ),
  );
  const calls = compiled.map((request, index) => ({
    contact: params.contacts[index],
    draft: createSafeDraftFromCompiled(
      request,
      params.campaignName,
      params.contacts[index],
      params.locale,
    ),
  }));
  return {
    compiled,
    prepared: await prepareCampaignLaunch({
      userId: params.userId,
      campaignId: params.campaignId,
      mode: params.mode,
      locale: params.locale,
      scheduledAt: params.scheduledAt,
      calls,
    }),
  };
}
