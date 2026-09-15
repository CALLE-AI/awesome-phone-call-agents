import { execFile } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { inspectProviderFreeSourceIsolation } from "../../../../tools/architecture/provider-free-isolation-policy.js";

// Test strategy: verify the new path at its manifest, source import-graph, and compiled executable
// boundaries. What is NOT tested: credentials, databases, providers, networks, Twilio, tunnels,
// authorization, calls, retries, redials, or hardware; their absence is the contract under test.

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const minimalProcessEnvironment: NodeJS.ProcessEnv = {
  PATH: process.env["PATH"],
  SystemRoot: process.env["SystemRoot"],
  TEMP: process.env["TEMP"],
  TMP: process.env["TMP"],
};
const verifierSourcePath = path.join(
  repositoryRoot,
  "apps",
  "simulator-host",
  "src",
  "cli",
  "live-smoke-prepare-verification-main.ts",
);
const verifierRuntimeSourcePath = path.join(
  repositoryRoot,
  "apps",
  "simulator-host",
  "src",
  "cli",
  "live-smoke-prepare-verification-runtime.ts",
);
const verifierOrchestrationSourcePath = path.join(
  repositoryRoot,
  "apps",
  "simulator-host",
  "src",
  "cli",
  "live-smoke-prepare-verification-orchestration.ts",
);
const preflightOrchestrationSourcePath = path.join(
  repositoryRoot,
  "apps",
  "simulator-host",
  "src",
  "cli",
  "live-smoke-preflight-orchestration.ts",
);
const verifierExecutablePath = path.join(
  repositoryRoot,
  "apps",
  "simulator-host",
  "dist",
  "cli",
  "live-smoke-prepare-verification-main.js",
);

const expectedProbeEvidence = Object.freeze(
  Array.from({ length: 10 }, (_unused, index) => ({
    contractId: `injected-preflight-probe-${String(index + 1).padStart(2, "0")}`,
    executionOutcome: "PASS",
  })),
);
const verifierRuntimeIsolationAllowlist = {
  allowedStaticImports: [],
  allowedDynamicImports: ["./live-smoke-prepare-verification-orchestration.js"],
  allowedWholeEnvironmentAccesses: [
    "capture:ambientEnvironment",
    "install-proxy:ambientEnvironment",
    "restore:ambientEnvironment",
  ],
  allowedEnvironmentObjectAliasOccurrences: { ambientEnvironment: 3 },
  allowedEnvironmentGuardSourceSha256:
    "dc200911cefaa4b4d89963f2986f4c35583fa02c50d1eb420c7ae842130b7c9a",
} as const;

describe("provider-free live-smoke prepare verification", () => {
  it("publishes a separate exact root and workspace command without changing operational live-smoke commands", async () => {
    const [rootManifestSource, applicationManifestSource] = await Promise.all([
      readFile(path.join(repositoryRoot, "package.json"), "utf8"),
      readFile(path.join(repositoryRoot, "apps", "simulator-host", "package.json"), "utf8"),
    ]);
    const rootScripts = (JSON.parse(rootManifestSource) as { scripts: Record<string, string> })
      .scripts;
    const applicationScripts = (
      JSON.parse(applicationManifestSource) as { scripts: Record<string, string> }
    ).scripts;

    expect(rootScripts["simulator:live-smoke:prepare:verify"]).toBe(
      "corepack pnpm --filter @muster/simulator-host live-smoke:prepare:verify",
    );
    expect(applicationScripts["live-smoke:prepare:verify"]).toBe(
      "node dist/cli/live-smoke-prepare-verification-main.js",
    );
    expect(rootScripts["simulator:live-smoke:prepare"]).toBe(
      "corepack pnpm --filter @muster/simulator-host live-smoke:prepare --",
    );
    expect(rootScripts["simulator:live-smoke:run"]).toBe(
      "corepack pnpm --filter @muster/simulator-host live-smoke:run",
    );
    expect(rootScripts["simulator:live-smoke:cleanup"]).toBe(
      "corepack pnpm --filter @muster/simulator-host live-smoke:cleanup",
    );
    expect(applicationScripts["live-smoke:prepare"]).toBe(
      "node --import @muster/observability/register-simulator-host dist/cli/guarded-live-smoke-main.js prepare",
    );
    expect(applicationScripts["live-smoke:run"]).toBe(
      "node --import @muster/observability/register-simulator-host dist/cli/guarded-live-smoke-main.js run",
    );
    expect(applicationScripts["live-smoke:cleanup"]).toBe(
      "node --import @muster/observability/register-simulator-host dist/cli/guarded-live-smoke-main.js cleanup",
    );
  });

  it("structurally isolates the verifier entrypoint to the pure preflight contract", async () => {
    const [main, runtime, orchestration, preflight] = await Promise.all([
      readFile(verifierSourcePath, "utf8"),
      readFile(verifierRuntimeSourcePath, "utf8"),
      readFile(verifierOrchestrationSourcePath, "utf8"),
      readFile(preflightOrchestrationSourcePath, "utf8"),
    ]);
    const result = inspectProviderFreeSourceIsolation({
      modules: [
        {
          id: "main",
          source: main,
          allowedStaticImports: ["./live-smoke-prepare-verification-runtime.js"],
          allowedDynamicImports: [],
        },
        {
          id: "runtime",
          source: runtime,
          ...verifierRuntimeIsolationAllowlist,
        },
        {
          id: "orchestration",
          source: orchestration,
          allowedStaticImports: ["./live-smoke-preflight-orchestration.js"],
          allowedDynamicImports: [],
        },
        {
          id: "preflight",
          source: preflight,
          allowedStaticImports: [],
          allowedDynamicImports: [],
        },
      ],
    });

    expect(result).toEqual({ outcome: "PASS", violations: [] });
    expect(main).not.toMatch(/process\.env|RUNTIME_PROFILE|\.env\b/iu);
    expect(main).not.toMatch(/guarded-live-smoke|live-smoke-preflight-runtime/iu);
    expect(orchestration).toContain("createLiveSmokePreflight");
  });

  it("blocks representative forbidden-capability mutations at the transitive source boundary", async () => {
    const mutations = Object.freeze([
      'import "node:fs";',
      'import { request } from "node:http";',
      'void import("node:net");',
      'process.getBuiltinModule("child_process");',
      'requireFromRepositoryRoot("twilio");',
      'const provider = `${require("twilio")}`;',
      'readFile("forbidden");',
      "socket.connect();",
      'request("https://forbidden.invalid");',
      'fetch("https://forbidden.invalid");',
      'spawn("forbidden");',
      "new CalleClient();",
      "new Pool();",
      "server.listen();",
      "control.authorize();",
      "provider.createTask();",
      "provider.createCall();",
      "provider.dial();",
      "operation.retry();",
      "operation.redial();",
    ]);

    for (const mutation of mutations) {
      const result = inspectProviderFreeSourceIsolation({
        modules: [
          {
            id: "mutated-entrypoint",
            source: `export const localOnly = true;\n${mutation}\n`,
            allowedStaticImports: [],
            allowedDynamicImports: [],
          },
        ],
      });
      expect(result.outcome, mutation).toBe("BLOCKED");
      expect(result.violations.length, mutation).toBeGreaterThan(0);
    }
  });

  it.each([
    [
      "Object.getOwnPropertyDescriptor",
      'Object.getOwnPropertyDescriptor(process.env, "RUNTIME_PROFILE");',
    ],
    [
      "Reflect.getOwnPropertyDescriptor",
      'Reflect.getOwnPropertyDescriptor(process.env, "DATABASE_URL");',
    ],
    ["Object.hasOwn", 'Object.hasOwn(process.env, "CALLE_API_KEY_FILE");'],
  ] as const)(
    "blocks %s ambient-environment reflection in the protected orchestration module",
    async (_operation, mutation) => {
      const orchestration = await readFile(verifierOrchestrationSourcePath, "utf8");
      const result = inspectProviderFreeSourceIsolation({
        modules: [
          {
            id: "orchestration",
            source: `${orchestration}\n${mutation}\n`,
            allowedStaticImports: ["./live-smoke-preflight-orchestration.js"],
            allowedDynamicImports: [],
          },
        ],
      });

      expect(result.outcome).toBe("BLOCKED");
      expect(result.violations).toContainEqual({
        moduleId: "orchestration",
        code: "environment_capability",
      });
    },
  );

  it("enforces exact named environment reads and the real verifier guard", async () => {
    const inspect = (source: string, allowedEnvironmentVariableReads: readonly string[]) => {
      const module = {
        id: "environment-bounded-module",
        source,
        allowedStaticImports: [],
        allowedDynamicImports: [],
        allowedEnvironmentVariableReads,
      };
      return inspectProviderFreeSourceIsolation({ modules: [module] });
    };

    expect(inspect('const executablePath = process.env["PATH"];', ["PATH"])).toEqual({
      outcome: "PASS",
      violations: [],
    });
    const allowedBaseline = 'const executablePath = process.env["PATH"];';
    for (const source of [
      'const credential = process.env["CALLE_API_KEY"];',
      'const credentialFile = process.env["TWILIO_AUTH_TOKEN_FILE"];',
      "const ambient = process.env[name];",
      'const interpolated = `${process.env["CALLE_API_KEY"]}`;',
      'const aliasedCredential = runtimeProcess.env["CALLE_API_KEY"];',
      'const computedCredential = process["env"]["CALLE_API_KEY"];',
      'const concatenatedCredential = process["e" + "nv"]["CALLE_API_KEY"];',
      "const { env } = process; void env.CALLE_API_KEY;",
      "let captured; ({ env: captured } = process); void captured.CALLE_API_KEY;",
      'const reflectedCredential = Reflect.get(process, "env")["CALLE_API_KEY"];',
      'const reflectedComputedCredential = Reflect["get"](process, "env")["CALLE_API_KEY"];',
      'const reflectedGet = Reflect.get; const reflectedAliasedCredential = reflectedGet(process, "env"); void reflectedGet(reflectedAliasedCredential, "CALLE_API_KEY");',
      'const reflectedTemplateCredential = Reflect.get(process, `env`)["CALLE_API_KEY"];',
      'const reflectedParenthesizedCredential = Reflect.get((process), "env")["CALLE_API_KEY"];',
      'const describedCredential = Object.getOwnPropertyDescriptor(process, "env")?.value["CALLE_API_KEY"];',
      'const reflectedDescriptor = Object.getOwnPropertyDescriptor; const describedAliasedCredential = reflectedDescriptor(process, "env")?.value["CALLE_API_KEY"];',
      'const describedTemplateCredential = Object.getOwnPropertyDescriptor(process, `env`)?.value["CALLE_API_KEY"];',
      "function readCredential({ env }: typeof process) { return env.CALLE_API_KEY; } void readCredential(process);",
      "function pluckEnvironment(value: typeof process) { const { env } = value; return env; } const stolen = pluckEnvironment(process); void stolen.CALLE_API_KEY;",
      'const parenthesizedCredential = (process).env["CALLE_API_KEY"];',
      'const nestedParenthesizedCredential = ((process)).env["CALLE_API_KEY"];',
      'const assertedCredential = (process as NodeJS.Process).env["CALLE_API_KEY"];',
      'const nonNullCredential = process!.env["CALLE_API_KEY"];',
    ]) {
      expect(inspect(`${allowedBaseline}\n${source}`, ["PATH"]).violations, source).toContainEqual({
        moduleId: "environment-bounded-module",
        code: "environment_capability",
      });
    }

    for (const source of [
      'const executablePath = process.env["PA" + "TH"];',
      "const executablePath = process.env[`PATH`];",
      'const executablePath = Reflect.get(process, "env")["PATH"];',
      'const p = process; const executablePath = p.env["PATH"];',
      "const executablePath = process?.env?.PATH;",
      'const executablePath = process.env["PATH";',
    ]) {
      expect(inspect(source, ["PATH"]).violations, source).toContainEqual({
        moduleId: "environment-bounded-module",
        code: "environment_capability",
      });
    }

    const defaultClosed = {
      id: "default-closed-environment-module",
      source: 'const credential = process.env["CALLE_API_KEY"];',
      allowedStaticImports: [],
      allowedDynamicImports: [],
    };
    expect(
      inspectProviderFreeSourceIsolation({ modules: [defaultClosed] }).violations,
    ).toContainEqual({
      moduleId: "default-closed-environment-module",
      code: "environment_capability",
    });

    const trustedGuardSource = await readFile(verifierRuntimeSourcePath, "utf8");
    const trustedGuard = {
      id: "trusted-environment-guard",
      source: trustedGuardSource,
      ...verifierRuntimeIsolationAllowlist,
    };
    for (const source of [
      trustedGuardSource.replace(/\r\n/gu, "\n"),
      trustedGuardSource.replace(/\r?\n/gu, "\r\n"),
    ]) {
      expect(
        inspectProviderFreeSourceIsolation({ modules: [{ ...trustedGuard, source }] }),
      ).toEqual({
        outcome: "PASS",
        violations: [],
      });
    }
    expect(
      inspectProviderFreeSourceIsolation({
        modules: [
          {
            ...trustedGuard,
            source: `${trustedGuardSource}\nambientEnvironment["CALLE_API_KEY"];`,
          },
        ],
      }).violations,
    ).toContainEqual({
      moduleId: "trusted-environment-guard",
      code: "environment_capability",
    });
    for (const source of [
      trustedGuardSource.replace(/\s*"CALLE_API_KEY_FILE",\r?\n/u, ""),
      trustedGuardSource.replace(
        "  process.env = new Proxy(ambientEnvironment, {",
        "  forbiddenEnvironmentNames.clear();\r\n  process.env = new Proxy(ambientEnvironment, {",
      ),
      trustedGuardSource.replace(
        "  process.env = new Proxy(ambientEnvironment, {",
        "  if (false) process.env = new Proxy(ambientEnvironment, {",
      ),
      trustedGuardSource.replace(
        "    process.env = ambientEnvironment;",
        "    if (false) process.env = ambientEnvironment;",
      ),
      trustedGuardSource.replace(
        "export async function runProviderFreePrepareVerification() {",
        "export async function runProviderFreePrepareVerification(process = { env: {} } as never) {",
      ),
      trustedGuardSource.replace(
        "export async function runProviderFreePrepareVerification() {",
        "export async function runProviderFreePrepareVerification() {\r\n  function Proxy(target: object) { return target; }",
      ),
    ]) {
      expect(
        inspectProviderFreeSourceIsolation({ modules: [{ ...trustedGuard, source }] }).violations,
      ).toContainEqual({
        moduleId: "trusted-environment-guard",
        code: "environment_capability",
      });
    }
    expect(
      inspectProviderFreeSourceIsolation({
        modules: [
          {
            ...trustedGuard,
            source: trustedGuardSource.replace(
              "return Reflect.get(target, property, receiver);",
              'return target["CALLE_API_KEY"];',
            ),
          },
        ],
      }).violations,
    ).toContainEqual({
      moduleId: "trusted-environment-guard",
      code: "environment_capability",
    });
    const stolenAliasSource = [
      "const stolenEnvironment = process.env;",
      "const ambientEnvironment = stolenEnvironment;",
    ].join("\n");
    expect(
      inspectProviderFreeSourceIsolation({
        modules: [
          {
            ...trustedGuard,
            source: trustedGuardSource.replace(
              "const ambientEnvironment = process.env;",
              stolenAliasSource,
            ),
          },
        ],
      }).violations,
    ).toContainEqual({
      moduleId: "trusted-environment-guard",
      code: "environment_capability",
    });
  });

  it("executes all ten injected probes once with hostile ambient values unread and prints the exact closed summary", async () => {
    await executeFile(
      process.execPath,
      [
        path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc"),
        "-b",
        path.join(repositoryRoot, "apps", "simulator-host"),
      ],
      {
        cwd: repositoryRoot,
        env: minimalProcessEnvironment,
        encoding: "utf8",
      },
    );

    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "muster-prepare-verify-"));
    const preloadPath = path.join(temporaryDirectory, "capability-audit.mjs");
    const auditPath = path.join(temporaryDirectory, "capability-audit.json");
    const hostileNames = Object.freeze([
      "RUNTIME_PROFILE",
      "DOTENV_CONFIG_PATH",
      "DATABASE_URL",
      "CALLE_API_ORIGIN",
      "CALLE_API_KEY_FILE",
      "TWILIO_ACCOUNT_SID_FILE",
      "TWILIO_AUTH_TOKEN_FILE",
      "TWILIO_NUMBER_SID_FILE",
      "SIMULATOR_AUTHORIZATION_SIGNING_KEY_FILE",
      "SIMULATOR_CALLBACK_IDENTITY_HMAC_KEY_FILE",
      "SIMULATOR_CUSTODY_ROOT",
      "SIMULATOR_RUN_GATE_FILE",
      "SIMULATOR_KILL_SWITCH_FILE",
      "SIMULATOR_PUBLIC_BASE_URL",
      "SIMULATOR_TARGET_ALLOWLIST_JSON",
      "SIMULATOR_ENDPOINT_ALIAS",
      "TWILIO_RESTING_REJECT_URL",
      "NGROK_CAPTURE_ATTESTATION_FILE",
    ]);
    const preloadSource = [
      'import { writeFileSync } from "node:fs";',
      `const auditPath = ${JSON.stringify(auditPath)};`,
      `const hostileNames = new Set(${JSON.stringify(hostileNames)});`,
      "const audit = { environmentReads: 0, externalCalls: 0, builtinModuleAcquisitions: 0 };",
      "const ambientEnvironment = process.env;",
      "const originalGetBuiltinModule = process.getBuiltinModule;",
      "process.env = new Proxy(ambientEnvironment, {",
      "  get(target, property, receiver) {",
      '    if (typeof property === "string" && hostileNames.has(property)) {',
      "      audit.environmentReads += 1;",
      '      throw new Error("ambient environment access forbidden");',
      "    }",
      "    return Reflect.get(target, property, receiver);",
      "  },",
      "  getOwnPropertyDescriptor(target, property) {",
      '    if (typeof property === "string" && hostileNames.has(property)) {',
      "      audit.environmentReads += 1;",
      '      throw new Error("ambient environment access forbidden");',
      "    }",
      "    return Reflect.getOwnPropertyDescriptor(target, property);",
      "  },",
      "});",
      'Object.defineProperty(process, "getBuiltinModule", {',
      "  configurable: true,",
      "  value() {",
      "    audit.builtinModuleAcquisitions += 1;",
      '    throw new Error("builtin module capability forbidden");',
      "  },",
      "});",
      'Object.defineProperty(globalThis, "fetch", {',
      "  configurable: true,",
      "  get() {",
      "    audit.externalCalls += 1;",
      '    throw new Error("external call capability forbidden");',
      "  },",
      "});",
      'process.on("exit", () => {',
      '  Object.defineProperty(process, "getBuiltinModule", {',
      "    configurable: true,",
      "    value: originalGetBuiltinModule,",
      "  });",
      "  writeFileSync(auditPath, JSON.stringify(audit));",
      "});",
      "",
    ].join("\n");
    await writeFile(preloadPath, preloadSource, "utf8");

    const sentinel = "HOSTILE_SENTINEL_MUST_REMAIN_UNREAD";
    const hostileEnvironment = { ...minimalProcessEnvironment };
    for (const name of hostileNames) hostileEnvironment[name] = `${sentinel}_${name}`;

    try {
      const execution = await executeFile(
        process.execPath,
        ["--import", pathToFileURL(preloadPath).href, verifierExecutablePath],
        {
          cwd: repositoryRoot,
          env: hostileEnvironment,
          encoding: "utf8",
        },
      );

      expect(execution.stderr).toBe("");
      expect(execution.stdout).not.toContain(sentinel);
      expect(JSON.parse(execution.stdout) as unknown).toEqual({
        title: "Provider-free live-smoke prepare verification",
        outcome: "PASS",
        evidenceClass: "LOCAL_PROVIDER_FREE",
        liveReadiness: "NOT_ASSESSED",
        authorizesCall: false,
        callAuthorization: "NONE",
        runGate: "CLOSED",
        orchestrationEvidence: {
          contract: "createLiveSmokePreflight",
          outcome: "PASS",
          passed: 10,
          total: 10,
          probeExecutions: 10,
          exactlyOnce: true,
          probes: expectedProbeEvidence,
        },
        isolationEvidence: {
          outcome: "PASS",
          policy: "DENY_FORBIDDEN_CAPABILITIES",
          runtimeAudit: {
            forbiddenEnvironmentReads: 0,
            fetchCapabilityAcquisitions: 0,
            webSocketCapabilityAcquisitions: 0,
            builtinModuleAcquisitions: 0,
          },
        },
        capabilityBudget: {
          environmentReads: 0,
          environmentFileReads: 0,
          credentialReferenceReads: 0,
          credentialReads: 0,
          databaseConnections: 0,
          externalCalls: 0,
          providerConstructions: 0,
          externalMutations: 0,
          listeners: 0,
          authorizations: 0,
          providerTasks: 0,
          calls: 0,
          retries: 0,
          redials: 0,
        },
      });
      const summary = JSON.parse(execution.stdout) as {
        orchestrationEvidence: unknown;
        liveReadiness: unknown;
        authorizesCall: unknown;
        callAuthorization: unknown;
      };
      const orchestrationEvidence = JSON.stringify(summary.orchestrationEvidence);
      expect(orchestrationEvidence).not.toMatch(
        /credential|database|provider|account|target|twilio|readiness|authorization/iu,
      );
      expect(summary.liveReadiness).toBe("NOT_ASSESSED");
      expect(summary.authorizesCall).toBe(false);
      expect(summary.callAuthorization).toBe("NONE");
      await expect(readFile(auditPath, "utf8")).resolves.toBe(
        JSON.stringify({
          environmentReads: 0,
          externalCalls: 0,
          builtinModuleAcquisitions: 0,
        }),
      );
    } finally {
      await unlink(preloadPath).catch(() => undefined);
      await unlink(auditPath).catch(() => undefined);
      await rmdir(temporaryDirectory).catch(() => undefined);
    }
  });
});
