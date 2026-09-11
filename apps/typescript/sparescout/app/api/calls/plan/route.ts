import { signApproval } from "../../../../lib/calle/approval";
import { createSourcingCallPlan, maskPhone, parseSourcingRequest } from "../../../../lib/calle/contracts";
import { savePlannedRequest } from "../../../../db/sourcing";
import { createHistoryAccessCredential } from "../../../../lib/history-access";
import { assertAuthorizedLiveRecipients, isAuthorizedLiveOperator } from "../../../../lib/live-security";
import { getApprovalSecret, getCalleCapabilities, getCalleRuntimeConfig, getLiveSecurityBindings } from "../runtime";
import { getOptionalD1 } from "../../../../db";

export async function POST(request: Request) {
  try {
    const input = parseSourcingRequest(await request.json());
    if (input.executionMode === "live" && !getCalleCapabilities().liveAvailable) {
      return Response.json(
        { error: "Live planning is unavailable until every trusted CALL-E runtime binding is configured." },
        { status: 503 },
      );
    }
    const liveSecurity = getLiveSecurityBindings();
    if (input.executionMode === "live") {
      if (!await isAuthorizedLiveOperator(request.headers.get("authorization"), liveSecurity)) {
        return Response.json(
          { error: "Valid operator authentication is required for live planning." },
          { status: 401, headers: { "www-authenticate": "Bearer" } },
        );
      }
      assertAuthorizedLiveRecipients(input.suppliers, liveSecurity);
    }
    const plan = createSourcingCallPlan(input);
    const config = getCalleRuntimeConfig();
    const historyAccess = await createHistoryAccessCredential();
    const database = getOptionalD1();
    if (input.executionMode === "live" && !database) {
      return Response.json({ error: "Live planning requires private persistent storage." }, { status: 503 });
    }
    if (database) await savePlannedRequest(plan, historyAccess.hash, database);
    const approvalToken = await signApproval(plan, getApprovalSecret(config.mode));

    return Response.json({
      mode: plan.request.executionMode === "fixture" ? "fixture" : config.mode,
      plan: {
        id: plan.id,
        createdAt: plan.createdAt,
        expiresAt: plan.expiresAt,
        task: plan.task,
        request: {
          ...plan.request,
          suppliers: plan.request.suppliers.map((supplier) => ({
            id: supplier.id,
            name: supplier.name,
            area: supplier.area,
            phone: maskPhone(supplier.phone),
          })),
        },
      },
      approvalToken,
      historyAccess: database ? { requestId: plan.id, token: historyAccess.token } : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the call plan.";
    return Response.json({ error: message }, { status: 400 });
  }
}
