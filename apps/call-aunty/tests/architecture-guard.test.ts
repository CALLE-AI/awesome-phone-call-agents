import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, acc);
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("Architecture guard — client secret boundary", () => {
  it("app/ never imports server-only credential modules", () => {
    const appRoot = join(process.cwd(), "app");
    const offenders = walk(appRoot).filter((file) => {
      const content = readFileSync(file, "utf8");
      return (
        /CALLE_API_KEY|process\.env\.CALLE|server\/calle\/config|server\/_core\/env/.test(content)
      );
    });
    expect(offenders).toEqual([]);
  });

  it("Expo client bundles never import Node builtins or server runtimes", () => {
    const roots = ["app", "components", "hooks", "contexts", "constants", "lib"].map((dir) =>
      join(process.cwd(), dir),
    );
    const nodeImport =
      /from\s+['"](?:node:|fs|path|http|https|crypto|os|net|child_process|express|mysql2|drizzle-orm)/;
    const valueServerImport = /(?:^|\n)import\s+(?!type\b)[^;]*from\s+['"]@\/server\//;
    const offenders = roots.flatMap((root) =>
      walk(root).filter((file) => {
        const content = readFileSync(file, "utf8");
        return nodeImport.test(content) || valueServerImport.test(content);
      }),
    );
    expect(offenders).toEqual([]);
  });

  it("Metro starts Expo for all platforms instead of web-only workspace root", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      main?: string;
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["dev:metro"]).toContain("expo start");
    expect(pkg.scripts["dev:metro"]).not.toContain("EXPO_USE_METRO_WORKSPACE_ROOT");
    expect(pkg.scripts["dev:metro"]).not.toContain("--web");
    expect(pkg.main).toBe("expo-router/entry");
  });

  it("architecture modules exist for V5 snapshot", () => {
    const required = [
      "server/calle/v5-flags.ts",
      "server/calle/call-events.ts",
      "server/calle/correlation.ts",
      "server/calle/command-center.ts",
      "server/calle-v4/client.ts",
      "server/calle-v4/webhook.ts",
      "docs/calle-v5/architecture.md",
      "docs/calle-api-v4/README.md",
      "server/calle/provider-failover.ts",
      "server/ai-agent/orchestrator.ts",
      "server/ai-agent/replay.ts",
      "server/ai-agent/evaluation.ts",
      "server/ai-agent/approval.ts",
      "server/calle/phone-api-adapters.ts",
      "lib/operator-dashboard/fixtures.ts",
      "lib/mock-calls/replay.ts",
      "server/calle/client.ts",
      "server/calle/router.ts",
      "server/calle/http.ts",
      "server/calle/webhook.ts",
      "server/_core/calle-registration.ts",
    ];
    for (const path of required) {
      expect(() => readFileSync(join(process.cwd(), path), "utf8")).not.toThrow();
    }
  });
});
