import {
  FOUNDATION_HEALTH_JOB_NAME,
  FOUNDATION_HEALTH_JOB_VERSION,
  type FoundationHealthJobPayload,
  type FoundationHealthJobResult,
} from "@muster/contracts";
import { OrganizationId } from "@muster/domain";

import { ApplicationError, classifyApplicationError } from "../errors/application-error.js";
import type { LoggerPort } from "../ports/logger.port.js";
import type { GetSystemHealth } from "./get-system-health.js";
import type { RecordFoundationAuditEvent } from "./record-foundation-audit-event.js";

export interface RunFoundationHealthCheckDependencies {
  readonly getSystemHealth: GetSystemHealth;
  readonly recordAuditEvent: RecordFoundationAuditEvent;
  readonly logger: LoggerPort;
}

function createOrganizationId(value: string): OrganizationId {
  try {
    return OrganizationId.create(value);
  } catch {
    throw ApplicationError.validation("invalid_organization_id");
  }
}

export class RunFoundationHealthCheck {
  public constructor(private readonly dependencies: RunFoundationHealthCheckDependencies) {}

  public async execute(payload: FoundationHealthJobPayload): Promise<FoundationHealthJobResult> {
    this.dependencies.logger.info({
      event: "job.started",
      correlationId: payload.correlationId,
      jobType: FOUNDATION_HEALTH_JOB_NAME,
    });

    try {
      const health = await this.dependencies.getSystemHealth.execute();
      const auditEvent = await this.dependencies.recordAuditEvent.execute({
        organizationId: createOrganizationId(payload.organizationId),
        correlationId: payload.correlationId,
        idempotencyKey: payload.idempotencyKey,
        outcome: health.status,
      });

      this.dependencies.logger.info({
        event: "job.completed",
        correlationId: payload.correlationId,
        jobType: FOUNDATION_HEALTH_JOB_NAME,
        outcome: "succeeded",
      });

      return {
        version: FOUNDATION_HEALTH_JOB_VERSION,
        correlationId: payload.correlationId,
        status: auditEvent.outcome,
        auditEventId: auditEvent.id,
        completedAt: auditEvent.occurredAt,
      };
    } catch (error: unknown) {
      const safeError = classifyApplicationError(error);
      this.dependencies.logger.error({
        event: "job.failed",
        correlationId: payload.correlationId,
        jobType: FOUNDATION_HEALTH_JOB_NAME,
        outcome: "failed",
        error: safeError,
      });
      throw error instanceof ApplicationError ? error : ApplicationError.unexpected();
    }
  }
}
