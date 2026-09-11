import type { DatabaseHealthPort, DependencyReadiness } from "@muster/application";

import type { PrismaClient } from "./generated/prisma/client.js";

export class PostgresHealthAdapter implements DatabaseHealthPort {
  public constructor(
    private readonly client: PrismaClient,
    private readonly probeTimeoutMs: number,
  ) {}

  public async getReadiness(): Promise<DependencyReadiness> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<DependencyReadiness>((resolve) => {
      timeoutHandle = setTimeout(() => resolve("unknown"), this.probeTimeoutMs);
    });
    const probe = this.client.auditEvent
      .findFirst({ select: { id: true } })
      .then<DependencyReadiness>(() => "ready")
      .catch(() => "degraded" as const);

    try {
      return await Promise.race([probe, timeout]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
