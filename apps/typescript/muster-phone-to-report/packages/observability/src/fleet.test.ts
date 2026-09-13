import { describe, expect, it } from "vitest";

interface FleetObservabilityModule {
  readonly createInMemoryFleetHttpMetrics?: () => {
    readonly metrics: { recordRequest(input: unknown): void };
    readonly snapshot: () => readonly {
      readonly name: string;
      readonly attributes: Readonly<Record<string, string>>;
    }[];
  };
  readonly runFleetHttpSpan?: <T>(input: {
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly method: "GET";
    readonly route: "/api/v1/fleet";
    readonly operation: () => Promise<T>;
  }) => Promise<T>;
}

async function loadFleetObservability(): Promise<FleetObservabilityModule> {
  const moduleUrl = new URL("./fleet.ts", import.meta.url).href;
  return (await import(/* @vite-ignore */ moduleUrl)) as FleetObservabilityModule;
}

describe("fleet HTTP observability", () => {
  it("bounds metrics and the single request span to closed non-sensitive dimensions", async () => {
    const loaded = await loadFleetObservability();
    if (
      loaded.createInMemoryFleetHttpMetrics === undefined ||
      loaded.runFleetHttpSpan === undefined
    ) {
      throw new Error("Fleet HTTP observability is not implemented");
    }
    const sink = loaded.createInMemoryFleetHttpMetrics();
    for (const [statusCode, outcome] of [
      [200, "found"],
      [404, "concealed"],
      [503, "dependency_unavailable"],
      [500, "unexpected_error"],
    ] as const) {
      sink.metrics.recordRequest({
        method: "GET",
        route: "/api/v1/fleet",
        statusCode,
        outcome,
        durationSeconds: 0.01,
      });
    }
    expect(sink.snapshot()).toHaveLength(8);
    expect(
      sink
        .snapshot()
        .every(
          ({ attributes }) =>
            Object.keys(attributes).sort().join(",") === "method,outcome,route,statusClass",
        ),
    ).toBe(true);
    expect(JSON.stringify(sink.snapshot())).not.toMatch(
      /organization|endpoint|site|incident|operation|observation|evidence|phone|authorization|reading|state/iu,
    );
    expect(() =>
      sink.metrics.recordRequest({
        method: "GET",
        route: "/api/v1/fleet/org_sensitive",
        statusCode: 200,
        outcome: "found",
        durationSeconds: 0.01,
      }),
    ).toThrow("Invalid bounded fleet HTTP metric");
    await expect(
      loaded.runFleetHttpSpan({
        headers: { traceparent: "malformed-protected-carrier", baggage: "protected=value" },
        method: "GET",
        route: "/api/v1/fleet",
        operation: async () => "found",
      }),
    ).resolves.toBe("found");
  });
});
