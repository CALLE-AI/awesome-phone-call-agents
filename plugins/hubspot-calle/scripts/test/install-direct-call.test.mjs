import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertRequiredSecrets,
  buildPostInstallInstructions,
  assertMinimumVersion,
  assertRequestedAccount,
  collectSecretValues,
  executeCommand,
  normalizeCallEBaseUrl,
  normalizeEndpointUrl,
  parseAccountInfo,
  parseArgs,
  parseInstallStatus,
  parseSecretList,
  runInstaller,
} from "../install-direct-call.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(scriptDir, "..", "..");

test("fails closed when required HubSpot secrets are missing", () => {
  assert.throws(
    () => assertRequiredSecrets(new Set(["CALL_E_API_KEY"])),
    /CALL_E_BASE_URL, CALLE_WORKFLOW_ENDPOINT_TOKEN/
  );
});

test("installed app metadata keeps only the direct-call read scopes used by App Cards", async () => {
  const metadata = JSON.parse(
    await readFile(join(pluginDir, "hubspot-project/src/app/app-hsmeta.json"), "utf8")
  );
  const scopes = metadata.config.auth.requiredScopes;

  assert.deepEqual(scopes, [
    "oauth",
    "crm.objects.contacts.read",
    "crm.objects.deals.read",
  ]);
  assert.ok(scopes.includes("crm.objects.contacts.read"));
  assert.ok(scopes.includes("crm.objects.deals.read"));
  assert.equal(scopes.includes("crm.objects.companies.read"), false);
  assert.equal(scopes.includes("crm.objects.owners.read"), false);
});

test("treats an uninstalled static app as a required manual step", () => {
  assert.deepEqual(
    parseInstallStatus(
      '{"isInstalled":false,"isInstalledWithCurrentScopes":false}',
      2
    ),
    { state: "manual_install_required", isInstalled: false, currentScopes: false }
  );
});

test("reports an installed static app with current scopes", () => {
  assert.deepEqual(
    parseInstallStatus(
      '{"isInstalled":true,"isInstalledWithCurrentScopes":true}',
      0
    ),
    { state: "installed", isInstalled: true, currentScopes: true }
  );
});

test("requires reinstall when static app scopes are outdated", () => {
  assert.deepEqual(
    parseInstallStatus(
      '{"isInstalled":true,"isInstalledWithCurrentScopes":false}',
      0
    ),
    { state: "reinstall_required", isInstalled: true, currentScopes: false }
  );
});

test("rejects malformed static app install status JSON", () => {
  assert.throws(() => parseInstallStatus("not JSON", 0), /Could not parse/);
});

const endpointUrl = "https://example.hs-sites.com/hs/serverless/calle/create-call";
const resolvedAccount = "Account name: expected-account\nAccount ID: 123456789\n";

function installerOptions(overrides = {}) {
  return {
    account: "123456789",
    endpointUrl,
    endpointHost: "",
    setSecretsFromEnv: false,
    skipSecrets: false,
    skipValidate: true,
    skipUpload: true,
    build: false,
    dryRun: false,
    message: "Test upload",
    ...overrides,
  };
}

function successfulCommand(calls, responses = {}) {
  return (command, args) => {
    calls.push([command, ...args]);
    const key = [command, ...args].join(" ");
    return responses[key] || { status: 0, stdout: "", stderr: "" };
  };
}

test("orchestration resolves account identity before metadata and secret writes", async () => {
  const events = [];
  const command = (name, args) => {
    events.push(["command", name, ...args]);
    if (name === "hs" && args[0] === "--version") {
      return { status: 0, stdout: "8.4.0\n", stderr: "" };
    }
    if (name === "hs" && args[0] === "account") {
      return { status: 0, stdout: resolvedAccount, stderr: "" };
    }
    if (name === "hs" && args[0] === "secret" && args[1] === "list") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  await runInstaller(
    installerOptions({ setSecretsFromEnv: true }),
    {
      command,
      configureWorkflowAction: async () => events.push(["metadata"]),
      env: { CALL_E_API_KEY: "test-key", CALLE_WORKFLOW_ENDPOINT_TOKEN: "known-token" },
      log: () => {},
    }
  );

  assert.equal(events[0][2], "--version");
  assert.equal(events[1][2], "account");
  assert.ok(events.findIndex((event) => event[0] === "metadata") > 0);
  assert.ok(events.findIndex((event) => event.includes("secret") && event.includes("add")) > 0);
});

test("orchestration rejects an unknown account before any mutation", async () => {
  const calls = [];
  await assert.rejects(
    () => runInstaller(installerOptions(), {
      command: successfulCommand(calls, {
        "hs --version": { status: 0, stdout: "8.4.0\n", stderr: "" },
        "hs account info 123456789": {
          status: 0,
          stdout: "Account name: another-account\nAccount ID: 999999999\n",
          stderr: "",
        },
      }),
      configureWorkflowAction: async () => assert.fail("metadata must not be written"),
      log: () => {},
    }),
    /resolved to another-account \(999999999\)/
  );
  assert.deepEqual(calls, [
    ["hs", "--version"],
    ["hs", "account", "info", "123456789"],
  ]);
});

test("orchestration stops for missing secrets before upload", async () => {
  const calls = [];
  await assert.rejects(
    () => runInstaller(installerOptions({ skipUpload: false }), {
      command: successfulCommand(calls, {
        "hs --version": { status: 0, stdout: "8.4.0\n", stderr: "" },
        "hs account info 123456789": { status: 0, stdout: resolvedAccount, stderr: "" },
        "hs secret list -a 123456789": { status: 0, stdout: "CALL_E_API_KEY\n", stderr: "" },
      }),
      configureWorkflowAction: async () => assert.fail("metadata must not be written"),
      log: () => {},
    }),
    /CALL_E_BASE_URL, CALLE_WORKFLOW_ENDPOINT_TOKEN/
  );
  assert.equal(calls.some((call) => call.includes("upload")), false);
});

test("logs a generated token before a later build failure", async () => {
  const events = [];
  const command = (name, args) => {
    events.push(["command", name, ...args]);
    if (name === "hs" && args[0] === "--version") {
      return { status: 0, stdout: "8.4.0\n", stderr: "" };
    }
    if (name === "hs" && args[0] === "account") {
      return { status: 0, stdout: resolvedAccount, stderr: "" };
    }
    if (name === "hs" && args[0] === "secret" && args[1] === "list") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (name === "npm") {
      return { status: 1, stdout: "", stderr: "build failed" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  await assert.rejects(
    () => runInstaller(installerOptions({ setSecretsFromEnv: true, build: true }), {
      command,
      configureWorkflowAction: async () => events.push(["metadata"]),
      env: { CALL_E_API_KEY: "test-key" },
      tokenFactory: () => "recoverable-token",
      log: (message) => events.push(["log", message]),
    }),
    /npm run build failed/
  );

  const tokenNotice = events.findIndex((event) => event[0] === "log" && event[1].includes("recoverable-token"));
  assert.ok(tokenNotice >= 0);
  assert.ok(tokenNotice < events.findIndex((event) => event[0] === "metadata"));
});

test("dry run logs a placeholder without generating a usable token", async () => {
  const calls = [];
  const logs = [];
  await runInstaller(installerOptions({ setSecretsFromEnv: true, dryRun: true }), {
    command: successfulCommand(calls, {
      "hs --version": { status: 0, stdout: "8.4.0\n", stderr: "" },
      "hs account info 123456789": { status: 0, stdout: resolvedAccount, stderr: "" },
      "hs secret list -a 123456789": { status: 0, stdout: "", stderr: "" },
    }),
    configureWorkflowAction: async () => {},
    env: { CALL_E_API_KEY: "test-key" },
    tokenFactory: () => assert.fail("dry run must not generate a token"),
    log: (message) => logs.push(message),
  });

  assert.match(logs.join("\n"), /would generate a workflow endpoint token/i);
  assert.doesNotMatch(logs.join("\n"), /recoverable-token|[a-f0-9]{48}/i);
  assert.equal(calls.some((call) => call.includes("add") || call.includes("update")), false);
});

test("orchestration reports manual installation guidance after a first upload", async () => {
  const calls = [];
  const logs = [];
  const result = await runInstaller(installerOptions({ skipSecrets: true, skipUpload: false }), {
    command: successfulCommand(calls, {
      "hs --version": { status: 0, stdout: "8.4.0\n", stderr: "" },
      "hs account info 123456789": { status: 0, stdout: resolvedAccount, stderr: "" },
      "hs project upload -a 123456789 --force-create --message Test upload": { status: 0, stdout: "", stderr: "" },
      "hs project app-install-status -a 123456789 --json": {
        status: 2,
        stdout: '{"isInstalled":false,"isInstalledWithCurrentScopes":false}',
        stderr: "",
      },
    }),
    configureWorkflowAction: async () => {},
    log: (message) => logs.push(message),
  });

  assert.equal(result.state, "manual_install_required");
  assert.match(logs.join("\n"), /Standard install/);
  assert.match(logs.join("\n"), /Test installs/);
});

test("skip upload does not claim remote setup is finished", async () => {
  const logs = [];
  const result = await runInstaller(installerOptions({ skipSecrets: true }), {
    command: (name, args) => {
      if (name === "hs" && args[0] === "--version") {
        return { status: 0, stdout: "8.4.0\n", stderr: "" };
      }
      return { status: 0, stdout: resolvedAccount, stderr: "" };
    },
    configureWorkflowAction: async () => {},
    log: (message) => logs.push(message),
  });

  assert.equal(result.state, "upload_skipped");
  assert.match(logs.join("\n"), /remote setup is not complete/i);
  assert.doesNotMatch(logs.join("\n"), /setup finished/i);
});

test("production command failures include safe stderr diagnostics", async () => {
  const apiKey = "not-safe-to-print";
  await assert.rejects(
    () => runInstaller(installerOptions({ setSecretsFromEnv: true }), {
      spawn: (command, args) => {
        if (command === "hs" && args[0] === "--version") {
          return { status: 0, stdout: "8.4.0\n", stderr: "" };
        }
        if (command === "hs" && args[0] === "account") {
          return { status: 0, stdout: resolvedAccount, stderr: "" };
        }
        if (command === "hs" && args[1] === "list") {
          return { status: 0, stdout: "", stderr: "" };
        }
        return {
          status: 1,
          stdout: "",
          stderr: `HubSpot authentication failed: CALL_E_API_KEY=${apiKey}`,
        };
      },
      configureWorkflowAction: async () => {},
      env: { CALL_E_API_KEY: apiKey, CALLE_WORKFLOW_ENDPOINT_TOKEN: "known-token" },
      log: () => {},
    }),
    (error) => {
      assert.match(error.message, /HubSpot authentication failed/);
      assert.doesNotMatch(error.message, /CALL_E_API_KEY|not-safe-to-print/);
      return true;
    }
  );
});

test("production command failures redact known secrets from stdout and stderr", async () => {
  const apiKey = "known-api-key-value";
  const endpointToken = `${apiKey}-with-token-suffix`;
  await assert.rejects(
    () => runInstaller(installerOptions({ setSecretsFromEnv: true, build: true }), {
      spawn: (command, args) => {
        if (command === "hs" && args[0] === "--version") {
          return { status: 0, stdout: "8.4.0\n", stderr: "" };
        }
        if (command === "hs" && args[0] === "account") {
          return { status: 0, stdout: resolvedAccount, stderr: "" };
        }
        if (command === "hs" && args[0] === "secret") {
          return { status: 0, stdout: "", stderr: "" };
        }
        return {
          status: 1,
          stdout: `build stdout exposed ${apiKey}`,
          stderr: `build stderr exposed ${endpointToken}`,
        };
      },
      configureWorkflowAction: async () => {},
      env: {
        PATH: "/test/bin",
        CALL_E_API_KEY: apiKey,
        CALLE_WORKFLOW_ENDPOINT_TOKEN: endpointToken,
      },
      log: () => {},
    }),
    (error) => {
      assert.match(error.message, /stdout: build stdout exposed \[redacted\]/);
      assert.match(error.message, /stderr: build stderr exposed \[redacted\]/);
      assert.doesNotMatch(error.message, new RegExp(`${apiKey}|${endpointToken}`));
      assert.doesNotMatch(error.message, /with-token-suffix/);
      return true;
    }
  );
});

test("production runner scrubs call secrets from child environments", () => {
  let childOptions;
  const result = executeCommand("hs", ["account", "list"], {
    env: {
      PATH: "/test/bin",
      SAFE_VALUE: "safe",
      CALL_E_API_KEY: "known-api-key-value",
      CALLE_WORKFLOW_ENDPOINT_TOKEN: "known-endpoint-token-value",
    },
    spawn: (_command, _args, options) => {
      childOptions = options;
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(result.status, 0);
  assert.deepEqual(childOptions.env, {
    PATH: "/test/bin",
    SAFE_VALUE: "safe",
  });
});

test("production command failures include spawn errors when no status is available", async () => {
  const apiKey = "known-api-key-value";
  const endpointToken = "known-endpoint-token-value";
  await assert.rejects(
    () => runInstaller(installerOptions(), {
      spawn: (command, args) => {
        if (command === "hs" && args[0] === "--version") {
          return { status: 0, stdout: "8.4.0\n", stderr: "" };
        }
        return {
          status: null,
          stdout: "",
          stderr: "",
          error: new Error(`spawn hs ${apiKey} ${endpointToken} ENOENT`),
        };
      },
      env: {
        CALL_E_API_KEY: apiKey,
        CALLE_WORKFLOW_ENDPOINT_TOKEN: endpointToken,
      },
      log: () => {},
    }),
    (error) => {
      assert.match(error.message, /failed to start: spawn hs \[redacted\] \[redacted\] ENOENT/);
      assert.doesNotMatch(error.message, /exit code null/);
      assert.doesNotMatch(error.message, new RegExp(`${apiKey}|${endpointToken}`));
      return true;
    }
  );
});

test("installer rejects an unsupported Node.js version before any command or mutation", async () => {
  const calls = [];

  await assert.rejects(
    () => runInstaller(installerOptions(), {
      command: successfulCommand(calls),
      configureWorkflowAction: async () => assert.fail("metadata must not be written"),
      log: () => {},
      nodeVersion: "19.9.9",
    }),
    /Node\.js.*20\.0\.0.*19\.9\.9/
  );

  assert.deepEqual(calls, []);
});

test("installer rejects an unsupported HubSpot CLI version before account lookup or mutation", async () => {
  const calls = [];

  await assert.rejects(
    () => runInstaller(installerOptions(), {
      command: successfulCommand(calls, {
        "hs --version": { status: 0, stdout: "8.3.9\n", stderr: "" },
      }),
      configureWorkflowAction: async () => assert.fail("metadata must not be written"),
      log: () => {},
    }),
    /HubSpot CLI.*8\.4\.0.*8\.3\.9/
  );

  assert.deepEqual(calls, [["hs", "--version"]]);
});

test("parses HubSpot account identity output", () => {
  assert.deepEqual(
    parseAccountInfo(`
Account name: calle-dev-test-1
Account ID: 246704939
`),
    { name: "calle-dev-test-1", id: "246704939" }
  );
});

test("rejects malformed account output with a blank same-line account name", () => {
  assert.throws(
    () => parseAccountInfo(`
Account name:
Account ID: 246704939
`),
    /Could not parse HubSpot account identity/
  );
});

test("accepts an exact requested HubSpot account name or ID", () => {
  const resolved = { name: "calle-dev-test-1", id: "246704939" };

  assert.doesNotThrow(() => assertRequestedAccount("calle-dev-test-1", resolved));
  assert.doesNotThrow(() => assertRequestedAccount("246704939", resolved));
});

test("rejects HubSpot CLI fallback to a different default account", () => {
  const resolved = parseAccountInfo(`
Account name: calle-dev-test-1
Account ID: 246704939
`);

  assert.throws(
    () => assertRequestedAccount("246692728", resolved),
    /resolved to calle-dev-test-1 \(246704939\)/
  );
});

test("rejects insecure or decorated endpoint URLs", () => {
  for (const endpointUrl of [
    "http://example.hs-sites.com/hs/serverless/calle/create-call",
    "https://user:pass@example.hs-sites.com/hs/serverless/calle/create-call",
    "https://example.hs-sites.com/hs/serverless/calle/create-call?token=value",
    "https://example.hs-sites.com/hs/serverless/calle/create-call#fragment",
  ]) {
    assert.throws(
      () => normalizeEndpointUrl({ endpointUrl }),
      /HTTPS|credentials|query|fragment/
    );
  }
});

test("rejects raw endpoint and base URLs with empty delimiters", () => {
  for (const delimiter of ["?", "#"]) {
    assert.throws(
      () => normalizeEndpointUrl({ endpointUrl: `${endpointUrl}${delimiter}` }),
      /query string|fragment/
    );
    assert.throws(
      () => normalizeCallEBaseUrl(`https://api.heycall-e.com${delimiter}`),
      /query string|fragment/
    );
  }
});

test("requires the exact workflow endpoint path", () => {
  assert.throws(
    () => normalizeEndpointUrl({ endpointUrl: "https://example.hs-sites.com/prefix/hs/serverless/calle/create-call" }),
    /Endpoint URL must end with/
  );
});

test("rejects a trailing slash on the workflow endpoint path", () => {
  assert.throws(
    () => normalizeEndpointUrl({ endpointUrl: "https://example.hs-sites.com/hs/serverless/calle/create-call/" }),
    /Endpoint URL must end with/
  );
});

test("normalizes a secure CALL-E base URL", () => {
  assert.equal(normalizeCallEBaseUrl("https://api.heycall-e.com/"), "https://api.heycall-e.com");
});

test("rejects an unsafe CALL-E base URL", () => {
  for (const baseUrl of [
    "http://api.heycall-e.com",
    "https://api.heycall-e.test",
    "https://api.heycall-e.com/v1",
    "https://api.heycall-e.com:444",
    "https://user:pass@api.heycall-e.com",
  ]) {
    assert.throws(
      () => normalizeCallEBaseUrl(baseUrl),
      /HTTPS|exactly|credentials/
    );
  }
});

test("compares dotted versions numerically against a minimum", () => {
  assert.doesNotThrow(() => assertMinimumVersion("20.10.1", "20.0.0", "Node.js"));
  assert.doesNotThrow(() => assertMinimumVersion("8.4.0", "8.4.0", "HubSpot CLI"));
  assert.throws(
    () => assertMinimumVersion("19.9.9", "20.0.0", "Node.js"),
    /Node\.js.*20\.0\.0/
  );
  assert.throws(
    () => assertMinimumVersion("8.3.9", "8.4.0", "HubSpot CLI"),
    /HubSpot CLI.*8\.4\.0/
  );
});

test("parses direct-call installer arguments", () => {
  const options = parseArgs([
    "--account",
    "123456789",
    "--endpoint-url",
    "https://example.hs-sites.com/hs/serverless/calle/create-call",
    "--set-secrets-from-env",
    "--skip-upload",
    "--message",
    "Pilot upload",
  ]);

  assert.equal(options.account, "123456789");
  assert.equal(options.endpointUrl, "https://example.hs-sites.com/hs/serverless/calle/create-call");
  assert.equal(options.setSecretsFromEnv, true);
  assert.equal(options.skipUpload, true);
  assert.equal(options.message, "Pilot upload");
});

test("rejects conflicting secret modes", () => {
  assert.throws(
    () => parseArgs(["--set-secrets-from-env", "--skip-secrets"]),
    /Use either --set-secrets-from-env or --skip-secrets/
  );
});

test("normalizes full endpoint URLs and host shortcuts", () => {
  assert.equal(
    normalizeEndpointUrl({
      endpointUrl: "https://example.hs-sites.com/hs/serverless/calle/create-call",
    }),
    "https://example.hs-sites.com/hs/serverless/calle/create-call"
  );

  assert.equal(
    normalizeEndpointUrl({
      endpointHost: "https://example.hs-sites.com/",
    }),
    "https://example.hs-sites.com/hs/serverless/calle/create-call"
  );
});

test("rejects endpoint URLs with the wrong path", () => {
  assert.throws(
    () => normalizeEndpointUrl({ endpointUrl: "https://example.hs-sites.com/wrong" }),
    /Endpoint URL must end with/
  );
});

test("collects secret values without requiring optional values", () => {
  const values = collectSecretValues({
    CALL_E_API_KEY: "test-key",
  });

  assert.equal(values.CALL_E_API_KEY, "test-key");
  assert.equal(values.CALL_E_BASE_URL, "https://api.heycall-e.com");
  assert.equal(values.CALLE_WORKFLOW_ENDPOINT_TOKEN.length, 48);
});

test("parses HubSpot secret list output", () => {
  const found = parseSecretList(`
Secrets for account example-test-account [test account] (123456789):
  CALL_E_BASE_URL
  CALL_E_API_KEY
  CALLE_WORKFLOW_ENDPOINT_TOKEN
`);

  assert.deepEqual([...found].sort(), [
    "CALLE_WORKFLOW_ENDPOINT_TOKEN",
    "CALL_E_API_KEY",
    "CALL_E_BASE_URL",
  ]);
});

test("prints accurate standard and developer-test App Card installation guidance", () => {
  const message = buildPostInstallInstructions("123456789");

  assert.match(message, /Standard account:.*install or reinstall the app in that standard account/i);
  assert.match(message, /No developer test install is required for App Card visibility/i);
  assert.match(message, /project-owner administrator.*Distribution -> Test installs -> Add test install\(s\)/i);
  assert.match(message, /Card library -> Card types -> App/);
  assert.doesNotMatch(message, /until a test install exists/i);
  assert.match(message, /123456789/);
});
