import { describe, expect, it } from "vitest";

import { prepareLocalDemoEnvironment } from "@/config/local-demo-setup";

describe("local demo environment setup", () => {
  it("fills missing local-only secrets without exposing or replacing configured values", () => {
    const generated = ["auth-secret", "data-key", "lookup-key"];
    const result = prepareLocalDemoEnvironment(
      [
        "BETTER_AUTH_SECRET=",
        "FIELDCLOSE_DATA_KEY=existing-data-key",
        "FIELDCLOSE_LOOKUP_KEY=",
        "FIELDCLOSE_PHONE_KEY_VERSION=",
      ].join("\n"),
      () => generated.shift() ?? "unexpected-secret",
    );

    expect(result.content).toContain("BETTER_AUTH_SECRET=auth-secret");
    expect(result.content).toContain(
      "FIELDCLOSE_DATA_KEY=existing-data-key",
    );
    expect(result.content).toContain("FIELDCLOSE_LOOKUP_KEY=data-key");
    expect(result.content).toContain(
      "FIELDCLOSE_PHONE_KEY_VERSION=local-v1",
    );
    expect(result.updatedKeys).toEqual([
      "BETTER_AUTH_SECRET",
      "FIELDCLOSE_LOOKUP_KEY",
      "FIELDCLOSE_PHONE_KEY_VERSION",
    ]);
  });

  it("appends absent settings and preserves unrelated content", () => {
    const generated = ["auth-secret", "data-key", "lookup-key"];
    const result = prepareLocalDemoEnvironment(
      "# local notes\nFIELDCLOSE_DEMO_MODE=true\n",
      () => generated.shift() ?? "unexpected-secret",
    );

    expect(result.content).toContain("# local notes");
    expect(result.content).toContain("FIELDCLOSE_DEMO_MODE=true");
    expect(result.content).toContain("BETTER_AUTH_SECRET=auth-secret");
    expect(result.content).toContain("FIELDCLOSE_DATA_KEY=data-key");
    expect(result.content).toContain("FIELDCLOSE_LOOKUP_KEY=lookup-key");
  });
});
