import { timingSafeEqual } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { assertLiveOperatorUser } from "@/lib/auth/live-access";
import { LiveAccessError } from "@/lib/auth/live-policy";
import {
  assertApprovedCallReady,
  getCallMode,
  CallConfigurationError,
} from "@/lib/calle/client";
import { CallHttpError, readCallJson } from "@/lib/calle/http";
import { SafeCallInputError } from "@/lib/calle/safety";
import {
  CampaignLifecycleError,
  parseCampaignLaunchApproval,
} from "@/lib/campaigns/lifecycle";
import { compileAndPrepareCampaign } from "@/lib/campaigns/server";
import { dispatchPreparedCampaign } from "@/lib/campaigns/dispatch";
import { scheduleCampaign } from "@/lib/db/call-lifecycle";
import { campaigns, contacts, workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { EngineError } from "@/lib/engine-client";
import { requireUser } from "@/lib/supabase/auth";
import { toCampaignLocale, type Contact } from "@/types/campaign";
import type { Workflow } from "@/types/workflow";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request, context: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  try {
    const approval = parseCampaignLaunchApproval(await readCallJson(request));
    const loaded = await withRLS(auth.user.id, async (tx) => {
      const [campaign] = await tx
        .select({
          workflowId: campaigns.workflowId,
          name: campaigns.name,
          status: campaigns.status,
          locale: campaigns.locale,
          scheduledAt: campaigns.scheduledAt,
        })
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .limit(1);
      if (!campaign?.workflowId) return null;
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
        .where(eq(contacts.campaignId, id))
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
    if (!loaded) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (loaded.status !== "compiled") {
      return NextResponse.json(
        { error: "Campaign was already launched; Veyra will not submit it again" },
        { status: 409 },
      );
    }

    const mode = getCallMode();
    await assertLiveOperatorUser(auth.user.id, mode);
    const { prepared } = await compileAndPrepareCampaign({
      userId: auth.user.id,
      campaignId: id,
      campaignName: loaded.name,
      workflow: loaded.workflow,
      contacts: loaded.contacts,
      mode,
      locale: toCampaignLocale(loaded.locale),
      scheduledAt: loaded.scheduledAt?.toISOString() ?? null,
    });
    if (!sameDigest(approval.approvalDigest, prepared.preview.approvalDigest)) {
      return NextResponse.json(
        { error: "The campaign changed after approval; generate and approve a new preview" },
        { status: 409 },
      );
    }
    if (approval.callCount !== prepared.preview.callCount) {
      return NextResponse.json({ error: "The approved call count changed" }, { status: 409 });
    }
    if (
      prepared.preview.recipientAuthorizationRequired &&
      !approval.recipientAuthorizationConfirmed
    ) {
      return NextResponse.json(
        { error: "Live mode requires explicit authorization for this exact recipient" },
        { status: 400 },
      );
    }

    if (loaded.scheduledAt && loaded.scheduledAt.getTime() > Date.now()) {
      for (const call of prepared.calls) {
        assertApprovedCallReady(call.draft, call.preview);
      }
      const scheduled = await scheduleCampaign({
        userId: auth.user.id,
        campaignId: id,
        scheduledAt: loaded.scheduledAt,
        approvalDigest: prepared.preview.approvalDigest,
      });
      if (scheduled === "already_launched") {
        return NextResponse.json(
          { error: "Campaign was already scheduled or launched" },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          campaignId: id,
          mode,
          status: "scheduled",
          scheduledAt: loaded.scheduledAt.toISOString(),
          runs: [],
        },
        { status: 202 },
      );
    }

    const dispatch = await dispatchPreparedCampaign({
      userId: auth.user.id,
      campaignId: id,
      prepared,
    });
    if (dispatch.status === "already_launched") {
      return NextResponse.json(
        { error: "Campaign was already launched; no calls were submitted again" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { campaignId: id, mode, status: "launching" },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof CallHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof CampaignLifecycleError || error instanceof SafeCallInputError) {
      return NextResponse.json(
        { error: "Campaign launch is invalid", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof CallConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof LiveAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof EngineError) {
      return NextResponse.json(
        { error: "Campaign compilation failed", detail: error.message },
        { status: error.status === 422 ? 422 : error.status === 503 ? 503 : 502 },
      );
    }
    return NextResponse.json({ error: "Campaign could not be launched" }, { status: 500 });
  }
}
