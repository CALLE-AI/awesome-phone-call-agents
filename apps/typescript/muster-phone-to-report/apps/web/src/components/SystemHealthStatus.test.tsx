import { describe, expect, it } from "vitest";

interface HealthStatusModule {
  readonly renderSystemHealthStatusMarkup: (status: "ready" | "degraded") => Promise<string>;
}

describe("SystemHealthStatus", () => {
  it("renders text-plus-visual ready and degraded states with an accessible live status", async () => {
    const moduleUrl = new URL("./SystemHealthStatus.tsx", import.meta.url).href;
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<HealthStatusModule>;
    if (loaded.renderSystemHealthStatusMarkup === undefined) {
      throw new Error("renderSystemHealthStatusMarkup is not implemented");
    }

    const [ready, degraded] = await Promise.all([
      loaded.renderSystemHealthStatusMarkup("ready"),
      loaded.renderSystemHealthStatusMarkup("degraded"),
    ]);

    expect(ready).toContain('role="status"');
    expect(ready).toContain('aria-live="polite"');
    expect(ready).toMatch(/System ready/iu);
    expect(ready).toMatch(/aria-hidden="true"/u);
    expect(degraded).toMatch(/System degraded/iu);
    expect(degraded).toMatch(/aria-hidden="true"/u);
    expect(`${ready}${degraded}`).not.toMatch(/Fleet Health|postgres|pgboss|schema/iu);
  });
});
