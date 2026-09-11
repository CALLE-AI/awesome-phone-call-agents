import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Observation public contract", () => {
  // Test strategy: mutation-style source inspection protects type-only lineage that cannot be
  // observed at runtime. OpenAPI/client generation remains Phase 4 work.
  it("keeps confidence semantics version separate on each client-safe reading", async () => {
    const source = await readFile(
      new URL("../../../contracts/src/observation-api.ts", import.meta.url),
      "utf8",
    );
    const readingContract =
      /export interface ObservationReadingResponse \{(?<body>[\s\S]*?)\n\}/u.exec(source)?.groups?.[
        "body"
      ];

    expect(readingContract).toContain("readonly confidenceSemanticsVersion: string | null;");
    expect(readingContract).not.toContain("rawPayload");
    expect(readingContract).not.toContain("transcript");
  });
});
