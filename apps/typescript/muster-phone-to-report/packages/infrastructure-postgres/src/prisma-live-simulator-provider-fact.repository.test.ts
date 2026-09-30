import { describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";

import { PrismaLiveSimulatorProviderFactRepository } from "./prisma-live-simulator-provider-fact.repository.js";

describe("Prisma live simulator provider fact semantic idempotency", () => {
  it("replays a genuine same-phase delivery when retry time and trace context differ", async () => {
    const first = {
      organizationId: "org-provider-fact",
      operationId: "operation-provider-fact",
      phase: "voice",
      providerCallDigest: "a".repeat(64),
      semanticDigest: "b".repeat(64),
      outcome: "accepted",
      occurredAt: new Date("2026-08-24T20:00:00.000Z"),
      traceId: "c".repeat(32),
      signatureValidated: true,
      actionsObserved: null,
      inboundCallCount: null,
    };
    const client = {
      liveSimulatorProviderFact: {
        create: vi.fn().mockRejectedValue(new Error("unique")),
        findUnique: vi.fn(async () => first),
        findMany: vi.fn(),
      },
    };
    const repository = new PrismaLiveSimulatorProviderFactRepository(client as never);

    await expect(
      repository.append({
        ...first,
        organizationId: OrganizationId.create(first.organizationId),
        occurredAt: "2026-08-24T20:00:05.000Z",
        traceId: "d".repeat(32),
        phase: "voice",
        outcome: "accepted",
      }),
    ).resolves.toEqual({ outcome: "replayed" });
  });

  it("reads equal-millisecond facts by durable append ordinal", async () => {
    const findMany = vi.fn(async () => [
      {
        organizationId: "org-provider-fact",
        operationId: "operation-provider-fact",
        phase: "voice",
        providerCallDigest: "a".repeat(64),
        semanticDigest: "b".repeat(64),
        outcome: "accepted",
        occurredAt: new Date("2026-08-24T20:00:00.000Z"),
        appendOrdinal: 41n,
        traceId: "c".repeat(32),
        signatureValidated: true,
        actionsObserved: null,
        inboundCallCount: null,
      },
    ]);
    const repository = new PrismaLiveSimulatorProviderFactRepository({
      liveSimulatorProviderFact: { findMany },
    } as never);

    await expect(
      repository.listForOperation(
        OrganizationId.create("org-provider-fact"),
        "operation-provider-fact",
      ),
    ).resolves.toMatchObject([{ appendOrdinal: 41 }]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ appendOrdinal: "asc" }] }),
    );
  });
});
