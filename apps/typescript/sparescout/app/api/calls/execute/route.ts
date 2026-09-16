import { verifyApproval } from "../../../../lib/calle/approval";
import { executeSourcingPlan } from "../../../../lib/calle/server";
import { getStoredSourcingCallPlan, saveCallApproval, saveCallExecution } from "../../../../db/sourcing";
import { assertAuthorizedLiveRecipients, isAuthorizedLiveOperator } from "../../../../lib/live-security";
import { getApprovalSecret, getCalleRuntimeConfig, getLiveSecurityBindings } from "../runtime";
import { getOptionalD1 } from "../../../../db";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { approvalToken?: unknown; approved?: unknown };
    if (body.approved !== true) {
      return Response.json({ error: "Explicit call approval is required." }, { status: 409 });
    }
    if (typeof body.approvalToken !== "string") {
      return Response.json({ error: "A valid approval token is required." }, { status: 400 });
    }

    const config = getCalleRuntimeConfig();
    const browserSafePlan = await verifyApproval(body.approvalToken, getApprovalSecret(config.mode));
    const database = getOptionalD1();
    let plan = browserSafePlan;
    if (browserSafePlan.request.executionMode === "live") {
      const liveSecurity = getLiveSecurityBindings();
      if (!await isAuthorizedLiveOperator(request.headers.get("authorization"), liveSecurity)) {
        return Response.json(
          { error: "Valid operator authentication is required for live execution." },
          { status: 401, headers: { "www-authenticate": "Bearer" } },
        );
      }
      if (!database) {
        return Response.json({ error: "Live calling requires private persistent storage." }, { status: 503 });
      }
      const storedPlan = await getStoredSourcingCallPlan(browserSafePlan.id, database);
      if (!storedPlan || storedPlan.request.executionMode !== "live") {
        return Response.json({ error: "The approved live plan is unavailable." }, { status: 409 });
      }
      assertAuthorizedLiveRecipients(storedPlan.request.suppliers, liveSecurity);
      plan = storedPlan;
    }
    if (!database && plan.request.executionMode === "live") {
      return Response.json({ error: "Live calling requires private persistent storage." }, { status: 503 });
    }
    if (database) await saveCallApproval(plan, body.approvalToken, database);
    const execution = await executeSourcingPlan(plan, body.approvalToken, config);
    if (database) await saveCallExecution(plan, body.approvalToken, execution, database);
    return Response.json(
      {
        execution,
        requestId: plan.id,
        historyUrl: database ? `/api/sourcing/requests/${plan.id}` : undefined,
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start the supplier calls.";
    return Response.json({ error: message }, { status: 400 });
  }
}
