import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const isReserved = (value: string): boolean => /^\+1[2-9]\d{2}55501\d{2}$/u.test(value);

describe("public contribution privacy boundary", () => {
  it("accepts only reserved fictional full-phone fixtures", () => {
    expect(isReserved("+12025550100")).toBe(true);
    expect(isReserved("+12025550199")).toBe(true);
    expect(isReserved("+1" + "2025550200")).toBe(false);
    expect(isReserved("+44" + "2071234567")).toBe(false);
  });

  it("keeps non-reserved numbers, external source links, and call-history artifacts out of the app", () => {
    const files = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      },
    )
      .split("\0")
      .filter(Boolean);
    const violations: string[] = [];
    for (const file of new Set(files)) {
      // Git can list staged deletions. The index is expected to be current at verification.
      if (/\.(?:png|jpg|jpeg|ico|webp)$/iu.test(file)) continue;
      if (file === "tools/simulator/publication-safety.test.ts") continue;
      const text = readFileSync(path.join(root, file), "utf8");
      for (const match of text.matchAll(/\+[1-9]\d{9,14}\b/gu)) {
        if (!isReserved(match[0])) violations.push(`${file}: non-reserved phone fixture`);
      }
      if (/github\.com\/alex-luy-assoc\/muster-greenhouse/iu.test(text)) {
        violations.push(`${file}: unavailable external source link`);
      }
      if (
        /qualification-history\.md|SUCCESSFUL_LIVE_PREDECESSOR_FACTS|Historical requalification|successful_integrated_predecessor/u.test(
          text,
        )
      ) {
        violations.push(`${file}: observed provider-call artifact`);
      }
    }
    expect(violations).toEqual([]);
    expect(readFileSync(path.join(root, "LICENSE"), "utf8")).toContain("MIT License");
  });
});
