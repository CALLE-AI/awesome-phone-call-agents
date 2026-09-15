import {
  createCallePort,
  type CallPort,
} from "../../../lib/calle/client";
import { executeDispatch } from "../../../lib/dispatch/execute";
import { screenForEmergency } from "../../../lib/dispatch/safety";
import {
  isDispatchRequest,
  validateDispatchRequest,
} from "../../../lib/dispatch/validation";

interface DispatchDependencies {
  apiKey?: string;
  createPort?: (apiKey: string) => CallPort;
}

export async function handleDispatch(
  input: unknown,
  dependencies: DispatchDependencies = {},
): Promise<Response> {
  if (!isDispatchRequest(input)) {
    return Response.json(
      { code: "invalid_request", message: "The dispatch request shape is invalid." },
      { status: 400 },
    );
  }

  const validation = validateDispatchRequest(input);
  if (!validation.valid) {
    return Response.json(
      {
        code: "validation_failed",
        message: "Review the dispatch details before placing real calls.",
        errors: validation.errors,
      },
      { status: 400 },
    );
  }

  const safety = screenForEmergency(input.workOrder.issue);
  if (!safety.safe) {
    return Response.json(
      {
        code: "emergency_refused",
        message: safety.message,
        matches: safety.matches,
      },
      { status: 422 },
    );
  }

  const apiKey = dependencies.apiKey ?? process.env.CALLE_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        code: "configuration_required",
        message:
          "CALL-E is not configured on this server. Add CALLE_API_KEY before placing live calls.",
      },
      { status: 503 },
    );
  }

  const port = (dependencies.createPort ?? createCallePort)(apiKey);
  const results = await executeDispatch(input, port);
  const verified = results.filter((result) => result.status === "verified").length;
  const unresolved = results.some(
    (result) => result.status === "unknown" || result.status === "incomplete",
  );

  if (verified === results.length) {
    return Response.json(
      {
        status: "completed",
        message:
          "All vendor results passed verification. Review the evidence before assigning work.",
        results,
      },
    );
  }

  if (verified > 0) {
    return Response.json({
      status: "partial",
      message:
        "Verified evidence is preserved; other outcomes remain visible and are not inferred.",
      results,
    });
  }

  if (unresolved) {
    return Response.json(
      {
        code: "call_unresolved",
        status: "unresolved",
        message:
          "No vendor result is verified, and at least one call may exist or returned incomplete evidence. Do not start a new dispatch until it is reviewed.",
        results,
      },
      { status: 202 },
    );
  }

  return Response.json(
    {
      code: "call_failed",
      status: "failed",
      message: "All vendor calls definitively failed. No assignment was made.",
      results,
    },
    { status: 502 },
  );
}
