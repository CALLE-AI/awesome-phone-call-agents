import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { READINESS_SCHEMA } from "../src/calle/task.js";

const SKILL_SCHEMA = new URL("../../../../skills/route-readiness-call/references/result-schema.json", import.meta.url);

describe("READINESS_SCHEMA", () => {
  it("matches the copy published with the route-readiness-call skill", () => {
    expect(JSON.parse(readFileSync(SKILL_SCHEMA, "utf8"))).toEqual(READINESS_SCHEMA);
  });
});
