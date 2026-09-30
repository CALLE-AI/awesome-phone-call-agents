import type { SystemHealthResponse } from "@muster/contracts";

import type { DatabaseHealthPort, DependencyReadiness } from "../ports/database-health.port.js";
import type { JobBackendHealthPort } from "../ports/job-backend-health.port.js";

export interface GetSystemHealthDependencies {
  readonly databaseHealth: DatabaseHealthPort;
  readonly jobBackendHealth: JobBackendHealthPort;
}

async function getSafeReadiness(
  port: DatabaseHealthPort | JobBackendHealthPort,
): Promise<DependencyReadiness> {
  try {
    return await port.getReadiness();
  } catch {
    return "unknown";
  }
}

export class GetSystemHealth {
  private readonly databaseHealth: DatabaseHealthPort;
  private readonly jobBackendHealth: JobBackendHealthPort;

  public constructor(dependencies: GetSystemHealthDependencies) {
    this.databaseHealth = dependencies.databaseHealth;
    this.jobBackendHealth = dependencies.jobBackendHealth;
  }

  public async execute(): Promise<SystemHealthResponse> {
    const [database, jobs] = await Promise.all([
      getSafeReadiness(this.databaseHealth),
      getSafeReadiness(this.jobBackendHealth),
    ]);

    return database === "ready" && jobs === "ready" ? { status: "ready" } : { status: "degraded" };
  }
}
