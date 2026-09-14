/**
 * Reusable CALL-E gateway sketch for awesome-phone-call-agents.
 * Keep CALLE_API_KEY on the server. Mobile clients call /api/calle only.
 */
export const awesomePhoneCallAgentContract = {
  provider: "CALL-E",
  transport: "REST",
  endpoints: {
    create: "POST /v1/calls",
    get: "GET /v1/calls/{call_id}",
    events: "GET /v1/calls/{call_id}/events",
  },
  appGateway: {
    create: "POST /api/calle/calls",
    get: "GET /api/calle/calls/:callId",
    events: "GET /api/calle/calls/:callId/events",
    webhook: "POST /api/calle/webhook",
  },
  requiredHeaders: ["Authorization: Bearer CALLE_API_KEY", "Idempotency-Key"],
  resultEnums: ["yes", "no", "unknown"],
} as const;
