import { expect, it } from "vitest";

it("requires explicit safe production exporter and sampling policy with key-only errors", async () => {
  const moduleUrl = new URL("./observability-config.ts", import.meta.url).href;
  const observability = (await import(/* @vite-ignore */ moduleUrl)) as {
    parseObservabilityConfig: (
      environment: Record<string, string | undefined>,
      runtime: "api" | "worker",
    ) => unknown;
  };
  const production = {
    RUNTIME_PROFILE: "production",
    OTEL_SERVICE_NAME: "muster-worker",
    OTEL_SERVICE_VERSION: "1.0.0",
    OTEL_TRACES_EXPORTER: "none",
    OTEL_TRACES_SAMPLER: "always_off",
    METRICS_ENABLED: "false",
    OTEL_METRICS_EXPORTER: "none",
  } satisfies Record<string, string | undefined>;

  expect(() => observability.parseObservabilityConfig(production, "worker")).not.toThrow();
  for (const key of [
    "OTEL_TRACES_EXPORTER",
    "OTEL_TRACES_SAMPLER",
    "METRICS_ENABLED",
    "OTEL_METRICS_EXPORTER",
  ] as const) {
    const incomplete: Record<string, string | undefined> = { ...production };
    delete incomplete[key];
    expect(() => observability.parseObservabilityConfig(incomplete, "worker")).toThrow(
      `Invalid observability configuration: ${key}`,
    );
  }

  const protectedEndpoint = "https://seeded-secret@example.invalid/v1/traces";
  expect(() =>
    observability.parseObservabilityConfig(
      {
        ...production,
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: protectedEndpoint,
        OTEL_TRACES_SAMPLER: "parent_based_ratio",
        OTEL_TRACES_SAMPLER_ARG: "1.5",
      },
      "worker",
    ),
  ).toThrow("Invalid observability configuration: OTEL_TRACES_SAMPLER_ARG");
  try {
    observability.parseObservabilityConfig(
      { ...production, OTEL_TRACES_EXPORTER: "otlp" },
      "worker",
    );
  } catch (error: unknown) {
    expect(String(error)).toBe(
      "Error: Invalid observability configuration: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    );
    expect(String(error)).not.toContain("seeded-secret");
  }
});
