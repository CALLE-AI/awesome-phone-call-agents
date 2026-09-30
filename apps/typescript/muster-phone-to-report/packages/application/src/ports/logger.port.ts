import type { SafeApplicationError } from "../errors/application-error.js";

export type SafeError = SafeApplicationError;

export type SafeLogEvent =
  | Readonly<{
      event:
        | "simulator.host.started"
        | "simulator.host.stopped"
        | "simulator.host.startup_failed"
        | "simulator.host.shutdown_failed"
        | "simulator.job.started"
        | "simulator.job.completed"
        | "simulator.job.failed"
        | "simulator.callback.started"
        | "simulator.callback.completed"
        | "simulator.callback.failed";
      outcome: "started" | "succeeded" | "failed" | "stopped";
      traceId?: string;
      spanId?: string;
    }>
  | Readonly<{
      event: "simulator.live_smoke" | "simulator.twilio.request";
      outcome:
        | "blocked"
        | "gate_passed"
        | "authorization_reserved"
        | "dispatch_attempted"
        | "evidence_persisted"
        | "completed"
        | "failed"
        | "provider_signature_rejected"
        | "authorization_rejected"
        | "authorization_bound"
        | "authorization_replayed"
        | "voice_rendered"
        | "canary_clear"
        | "canary_failed";
      traceId?: string;
      spanId?: string;
      reason?:
        | "evidence_timestamp_invalid"
        | "application_persistence_failed"
        | "provider_timeout"
        | "provider_failed"
        | "provider_authentication"
        | "provider_rate_limited"
        | "provider_insufficient_balance"
        | "provider_recipient_blocked"
        | "provider_invalid_recipient"
        | "provider_unsupported_region"
        | "provider_policy_violation"
        | "provider_create_response_invalid"
        | "provider_unavailable"
        | "provider_no_answer"
        | "provider_busy"
        | "provider_evidence_invalid"
        | "provider_evidence_invalid_terminal_shape"
        | "provider_evidence_invalid_reading_shape"
        | "provider_evidence_invalid_zone_identity"
        | "provider_evidence_invalid_anchor_value"
        | "provider_evidence_invalid_anchor_unit"
        | "provider_evidence_invalid_anchor_status"
        | "provider_evidence_invalid_auxiliary_status"
        | "provider_evidence_unavailable";
      providerResponseStatusCode?: number;
      providerResponseContentType?: "missing" | "json" | "text" | "other";
      providerResponseBody?: "absent" | "present" | "unavailable";
      providerResponseLocation?:
        "missing" | "invalid" | "cross_origin" | "invalid_call_resource" | "exact_call_resource";
      providerRequestIdPresent?: boolean;
    }>
  | Readonly<{
      event: "http.request.completed";
      correlationId: string;
      method: "GET";
      route: "/api/v1/fleet";
      statusClass: "2xx" | "4xx" | "5xx";
      outcome: "found" | "concealed" | "dependency_unavailable" | "unexpected_error";
      duration: number;
    }>
  | Readonly<{
      event: "http.request.completed";
      correlationId: string;
      method: "GET";
      route: "/api/v1/system/health";
      statusCode: 200 | 503;
      outcome: "ready" | "degraded";
      duration: number;
    }>
  | Readonly<{
      event: "http.request.completed";
      correlationId: string;
      method: "POST" | "GET";
      route: "/api/v1/endpoints/{endpointId}/observations" | "/api/v1/observations/{operationId}";
      statusCode: 200 | 202 | 400 | 404 | 409 | 500 | 503;
      outcome:
        | "accepted"
        | "replayed"
        | "validation_failed"
        | "concealed"
        | "conflict"
        | "blocked"
        | "found"
        | "unexpected_error"
        | "dependency_unavailable";
      duration: number;
    }>
  | Readonly<{
      event: "job.started";
      correlationId: string;
      jobType: "foundation-health.v1";
    }>
  | Readonly<{
      event: "job.completed";
      correlationId: string;
      jobType: "foundation-health.v1";
      outcome: "succeeded";
    }>
  | Readonly<{
      event: "job.failed";
      correlationId: string;
      jobType: "foundation-health.v1";
      outcome: "failed";
      error: SafeError;
    }>
  | Readonly<{
      event: "dependency.readiness.changed";
      dependency: "database" | "jobs";
      outcome: "ready" | "degraded";
    }>;

export interface SafeLogBindings {
  readonly service?: string;
  readonly environment?: string;
  readonly version?: string;
  readonly runtime?: "api" | "worker" | "simulator-host";
  readonly correlationId?: string;
}

export interface LoggerPort {
  debug(event: SafeLogEvent): void;
  info(event: SafeLogEvent): void;
  warn(event: SafeLogEvent): void;
  error(event: SafeLogEvent): void;
  child(bindings: SafeLogBindings): LoggerPort;
}
