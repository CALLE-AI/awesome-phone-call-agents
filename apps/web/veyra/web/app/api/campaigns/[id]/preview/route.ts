import { randomUUID } from "node:crypto";

import { and, asc, eq, notInArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { assertLiveOperatorUser } from "@/lib/auth/live-access";
import { LiveAccessError } from "@/lib/auth/live-policy";
import { getCallMode, CallConfigurationError } from "@/lib/calle/client";
import { CallHttpError, readCallJson } from "@/lib/calle/http";
import { SafeCallInputError } from "@/lib/calle/safety";
import {
  CampaignLifecycleError,
  isPersistedContactId,
  parseCampaignPreviewInput,
} from "@/lib/campaigns/lifecycle";
import { compileAndPrepareCampaign } from "@/lib/campaigns/server";
import { campaigns, callResults, contacts, workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { EngineError } from "@/lib/engine-client";
import { requireUser } from "@/lib/supabase/auth";
import type { Contact } from "@/types/campaign";
import type { Workflow } from "@/types/workflow";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

class CampaignPreviewConflictError extends Error {}

export async function POST(request: Request, context: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  try {
    const input = parseCampaignPreviewInput(await readCallJson(request));
    if (input.scheduledAt && process.env.CAMPAIGN_SCHEDULING_ENABLED !== "true") {
      return NextResponse.json(
        { error: "Campaign scheduling is not enabled on this deployment" },
        { status: 503 },
      );
    }
    const loaded = await withRLS(auth.user.id, async (tx) => {
      const [campaign] = await tx
        .select({ workflowId: campaigns.workflowId, status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .limit(1);
      if (!campaign?.workflowId) return null;
      if (campaign.status !== "compiled") {
        return { ok: false, state: campaign.status } as const;
      }
      const [workflow] = await tx
        .select({ schema: workflows.schema })
        .from(workflows)
        .where(eq(workflows.id, campaign.workflowId))
        .limit(1);
      const existingContacts = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.campaignId, id))
        .orderBy(asc(contacts.position), asc(contacts.id));
      const [existingResult] = await tx
        .select({ id: callResults.id })
        .from(callResults)
        .where(eq(callResults.campaignId, id))
        .limit(1);
      if (!workflow || existingResult) return { ok: false, state: "locked" } as const;
      return { ok: true, workflow: workflow.schema as Workflow, existingContacts } as const;
    });
    if (!loaded) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (!loaded.ok) {
      return NextResponse.json(
        { error: `Campaign contacts are locked after launch (${loaded.state})` },
        { status: 409 },
      );
    }

    const existingIds = new Set(loaded.existingContacts.map((contact) => contact.id));
    const nextContacts: Contact[] = input.contacts.map((contact) => ({
      id:
        isPersistedContactId(contact.id) && existingIds.has(contact.id)
          ? contact.id
          : randomUUID(),
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      ...(contact.metadata ? { metadata: contact.metadata } : {}),
    }));
    const mode = getCallMode();
    await assertLiveOperatorUser(auth.user.id, mode);
    const { compiled, prepared } = await compileAndPrepareCampaign({
      userId: auth.user.id,
      campaignId: id,
      campaignName: input.name,
      workflow: loaded.workflow,
      contacts: nextContacts,
      mode,
      locale: input.locale,
      scheduledAt: input.scheduledAt,
    });

    await withRLS(auth.user.id, async (tx) => {
      const [updated] = await tx
        .update(campaigns)
        .set({
          name: input.name,
          status: "compiled",
          locale: input.locale,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          approvedAt: null,
          approvalDigest: null,
          compiledRequest: {
            version: 4,
            locale: input.locale,
            scheduledAt: input.scheduledAt,
            calls: compiled,
          },
        })
        .where(and(eq(campaigns.id, id), eq(campaigns.status, "compiled")))
        .returning({ id: campaigns.id });
      if (!updated) {
        throw new CampaignPreviewConflictError(
          "Campaign started launching while this preview was compiling",
        );
      }

      const ids = nextContacts.map((contact) => contact.id);
      if (ids.length) {
        await tx
          .delete(contacts)
          .where(and(eq(contacts.campaignId, id), notInArray(contacts.id, ids)));
      }
      for (const [position, contact] of nextContacts.entries()) {
        if (existingIds.has(contact.id)) {
          await tx
            .update(contacts)
            .set({
              name: contact.name,
              phoneNumber: contact.phoneNumber,
              metadata: contact.metadata ?? null,
              position,
            })
            .where(and(eq(contacts.id, contact.id), eq(contacts.campaignId, id)));
        } else {
          await tx.insert(contacts).values({
            id: contact.id,
            campaignId: id,
            name: contact.name,
            phoneNumber: contact.phoneNumber,
            metadata: contact.metadata,
            position,
          });
        }
      }
    });

    return NextResponse.json({ contacts: nextContacts, preview: prepared.preview });
  } catch (error) {
    if (error instanceof CallHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof CampaignLifecycleError || error instanceof SafeCallInputError) {
      return NextResponse.json(
        { error: "Campaign preview is invalid", issues: error.issues },
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
    if (error instanceof CampaignPreviewConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Campaign preview could not be saved" }, { status: 500 });
  }
}
