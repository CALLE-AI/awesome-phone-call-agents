import { timingSafeEqual } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import { assertLiveOperatorUser } from "@/lib/auth/live-access";
import { getCallMode } from "@/lib/calle/client";
import { dispatchPreparedCampaign } from "@/lib/campaigns/dispatch";
import { compileAndPrepareCampaign } from "@/lib/campaigns/server";
import {
  dueScheduledCampaigns,
  failScheduledCampaign,
} from "@/lib/db/call-lifecycle";
import { campaigns, contacts, workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { toCampaignLocale, type Contact } from "@/types/campaign";
import type { Workflow } from "@/types/workflow";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.CAMPAIGN_SCHEDULING_ENABLED !== "true") {
    return Response.json({ enabled: false, processed: 0 });
  }

  const due = await dueScheduledCampaigns();
  let submitted = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of due) {
    try {
      const loaded = await withRLS(item.userId, async (tx) => {
        const [campaign] = await tx
          .select({
            name: campaigns.name,
            status: campaigns.status,
            workflowId: campaigns.workflowId,
            locale: campaigns.locale,
            scheduledAt: campaigns.scheduledAt,
          })
          .from(campaigns)
          .where(eq(campaigns.id, item.id))
          .limit(1);
        if (!campaign?.workflowId || campaign.status !== "scheduled") return null;
        const [workflow] = await tx
          .select({ schema: workflows.schema })
          .from(workflows)
          .where(eq(workflows.id, campaign.workflowId))
          .limit(1);
        const rows = await tx
          .select({
            id: contacts.id,
            name: contacts.name,
            phoneNumber: contacts.phoneNumber,
            metadata: contacts.metadata,
          })
          .from(contacts)
          .where(eq(contacts.campaignId, item.id))
          .orderBy(asc(contacts.position), asc(contacts.id));
        if (!workflow || !rows.length) return null;
        return {
          ...campaign,
          workflow: workflow.schema as Workflow,
          contacts: rows.map(
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
      if (!loaded) {
        skipped += 1;
        continue;
      }

      const mode = getCallMode();
      await assertLiveOperatorUser(item.userId, mode);
      const { prepared } = await compileAndPrepareCampaign({
        userId: item.userId,
        campaignId: item.id,
        campaignName: loaded.name,
        workflow: loaded.workflow,
        contacts: loaded.contacts,
        mode,
        locale: toCampaignLocale(loaded.locale),
        scheduledAt: loaded.scheduledAt?.toISOString() ?? null,
      });
      if (!sameDigest(item.approvalDigest, prepared.preview.approvalDigest)) {
        throw new Error("The approved campaign changed before its scheduled dispatch");
      }

      const dispatch = await dispatchPreparedCampaign({
        userId: item.userId,
        campaignId: item.id,
        prepared,
        fromStatus: "scheduled",
      });
      if (dispatch.status === "submitted") submitted += 1;
      else skipped += 1;
    } catch {
      failed += 1;
      await failScheduledCampaign({
        campaignId: item.id,
        message: "Scheduled dispatch stopped safely before calling.",
      });
    }
  }

  return Response.json({ enabled: true, processed: due.length, submitted, skipped, failed });
}
