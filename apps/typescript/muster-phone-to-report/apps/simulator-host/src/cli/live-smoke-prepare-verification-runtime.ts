interface RuntimeAudit {
  forbiddenEnvironmentReads: number;
  fetchCapabilityAcquisitions: number;
  webSocketCapabilityAcquisitions: number;
  builtinModuleAcquisitions: number;
}

const forbiddenEnvironmentNames = new Set([
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

function restoreProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, property);
    return;
  }
  Object.defineProperty(target, property, descriptor);
}

function runtimeAuditPasses(audit: Readonly<RuntimeAudit>): boolean {
  return (
    audit.forbiddenEnvironmentReads === 0 &&
    audit.fetchCapabilityAcquisitions === 0 &&
    audit.webSocketCapabilityAcquisitions === 0 &&
    audit.builtinModuleAcquisitions === 0
  );
}

export async function runProviderFreePrepareVerification() {
  const audit: RuntimeAudit = {
    forbiddenEnvironmentReads: 0,
    fetchCapabilityAcquisitions: 0,
    webSocketCapabilityAcquisitions: 0,
    builtinModuleAcquisitions: 0,
  };
  const ambientEnvironment = process.env;
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const webSocketDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const getBuiltinModuleDescriptor = Object.getOwnPropertyDescriptor(process, "getBuiltinModule");

  process.env = new Proxy(ambientEnvironment, {
    get(target, property, receiver) {
      if (typeof property === "string" && forbiddenEnvironmentNames.has(property)) {
        audit.forbiddenEnvironmentReads += 1;
        throw new Error("Forbidden ambient environment capability");
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (typeof property === "string" && forbiddenEnvironmentNames.has(property)) {
        audit.forbiddenEnvironmentReads += 1;
        throw new Error("Forbidden ambient environment capability");
      }
      return Reflect.has(target, property);
    },
    getOwnPropertyDescriptor(target, property) {
      if (typeof property === "string" && forbiddenEnvironmentNames.has(property)) {
        audit.forbiddenEnvironmentReads += 1;
        throw new Error("Forbidden ambient environment capability");
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    ownKeys() {
      audit.forbiddenEnvironmentReads += 1;
      throw new Error("Ambient environment enumeration forbidden");
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    get() {
      audit.fetchCapabilityAcquisitions += 1;
      throw new Error("Fetch capability forbidden");
    },
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    get() {
      audit.webSocketCapabilityAcquisitions += 1;
      throw new Error("WebSocket capability forbidden");
    },
  });
  Object.defineProperty(process, "getBuiltinModule", {
    configurable: true,
    value() {
      audit.builtinModuleAcquisitions += 1;
      throw new Error("Builtin module capability forbidden");
    },
  });

  try {
    const { runLocalProviderFreePreflightOrchestration } =
      await import("./live-smoke-prepare-verification-orchestration.js");
    const orchestrationEvidence = await runLocalProviderFreePreflightOrchestration();
    const runtimeAudit = Object.freeze({ ...audit });
    const isolationPassed = runtimeAuditPasses(runtimeAudit);
    if (orchestrationEvidence.outcome !== "PASS" || !isolationPassed) {
      throw new Error("Provider-free prepare verification blocked");
    }

    return Object.freeze({
      title: "Provider-free live-smoke prepare verification" as const,
      outcome: "PASS" as const,
      evidenceClass: "LOCAL_PROVIDER_FREE" as const,
      liveReadiness: "NOT_ASSESSED" as const,
      authorizesCall: false as const,
      callAuthorization: "NONE" as const,
      runGate: "CLOSED" as const,
      orchestrationEvidence,
      isolationEvidence: Object.freeze({
        outcome: "PASS" as const,
        policy: "DENY_FORBIDDEN_CAPABILITIES" as const,
        runtimeAudit,
      }),
      capabilityBudget: Object.freeze({
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
      }),
    });
  } finally {
    process.env = ambientEnvironment;
    restoreProperty(globalThis, "fetch", fetchDescriptor);
    restoreProperty(globalThis, "WebSocket", webSocketDescriptor);
    restoreProperty(process, "getBuiltinModule", getBuiltinModuleDescriptor);
  }
}
