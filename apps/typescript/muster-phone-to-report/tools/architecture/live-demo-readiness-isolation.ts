import { readFile } from "node:fs/promises";
import path from "node:path";

export async function inspectLiveDemoReadinessIsolation(input: {
  readonly repositoryRoot: string;
  readonly sourceMutation?: string;
  readonly recorderMutation?: string;
}): Promise<{ readonly violations: readonly string[] }> {
  const verifierPath = path.join(
    input.repositoryRoot,
    "tools/simulator/verify-live-demo-readiness.ts",
  );
  const recorderPath = path.join(
    input.repositoryRoot,
    "tools/simulator/record-live-demo-readiness.ts",
  );
  const viteConfigPath = path.join(input.repositoryRoot, "apps/web/vite.config.ts");
  const [verifier, recorder, viteConfig] = await Promise.all([
    readFile(verifierPath, "utf8"),
    readFile(recorderPath, "utf8").catch(() => ""),
    readFile(viteConfigPath, "utf8"),
  ]);
  const inspected = `${verifier}\n${input.sourceMutation ?? ""}`;
  const inspectedRecorder = `${recorder}\n${input.recorderMutation ?? ""}`;
  const violations: string[] = [];
  if (/process\.env|loadEnv\s*\(|dotenv/iu.test(inspected)) {
    violations.push("ambient environment access");
  }
  if (/@muster\/(?:infrastructure-calle|simulator-host)|@call-e\/calle/iu.test(inspected)) {
    violations.push("provider capability import");
  }
  if (/(?:node:|from\s+["'])(?:https?|net|tls)["']|\bfetch\s*\(|\bWebSocket\b/iu.test(inspected)) {
    violations.push("external networking capability");
  }
  if (
    /Object\.(?:entries|keys|values)\s*\(\s*process\.env\s*\)|Reflect\.ownKeys\s*\(\s*process\.env\s*\)|for\s*\([^)]*\bin\s+process\.env\b/iu.test(
      inspectedRecorder,
    ) ||
    /process\.env(?!\s*(?:\.|\[))/u.test(inspectedRecorder)
  ) {
    violations.push("ambient environment enumeration");
  }
  if (/env\s*:\s*process\.env|\.\.\.process\.env/iu.test(inspectedRecorder)) {
    violations.push("ambient environment propagation");
  }
  const allowedRecorderEnvironmentNames = new Set([
    "CI",
    "COMSPEC",
    "PATH",
    "PATHEXT",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "WINDIR",
  ]);
  const environmentReads = [
    ...inspectedRecorder.matchAll(
      /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*["']([^"']+)["']\s*\])/gu,
    ),
  ];
  if (
    environmentReads.some((match) => {
      const name = match[1] ?? match[2];
      return name === undefined || !allowedRecorderEnvironmentNames.has(name);
    })
  ) {
    violations.push("non-allowlisted ambient environment access");
  }
  if (
    /process\.env(?:\.DOCKER_(?:HOST|CONTEXT)|\[\s*["']DOCKER_(?:HOST|CONTEXT)["']\s*\])/u.test(
      inspectedRecorder,
    )
  ) {
    violations.push("unsafe Docker environment propagation");
  }
  if (!recorder.includes("loopback-only-network-preload.mjs")) {
    violations.push("loopback-only child isolation is missing");
  }
  if (
    !/const proxyOrigin = demoComposition\s*\?\s*simulatorHostProxyOrigin\(mode\)\s*:\s*undefined;/u.test(
      viteConfig,
    )
  ) {
    violations.push("production environment-file loading is not disabled");
  }
  return Object.freeze({ violations: Object.freeze(violations) });
}
