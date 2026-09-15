import { randomBytes, randomUUID } from "node:crypto";

import type { LiveSimulatorAuthorizationIssuerPort } from "@muster/application";
import { OrganizationId } from "@muster/domain";
import { issueRunAuthorization } from "@muster/infrastructure-twilio-simulator";
import { SIMULATOR_SCENARIO_CATALOG } from "@muster/testing";

const opaqueIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function encodeAuthorizationNonce(entropy: Uint8Array): string {
  return Buffer.from(entropy).toString("hex");
}

interface AuthorizationScenario {
  readonly scenarioId: string;
  readonly revision: number;
  readonly supportedModes: readonly string[];
}

interface AuthorizationConfiguration {
  readonly organizationId: string;
  readonly endpointAlias: string;
  readonly authorizationAudience: string;
  readonly authorizationSigningKey: string;
  readonly authorizedTargetDigest: string;
  readonly publicBaseUrl: string;
}

interface RecoveryPredecessorFact {
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly terminal: boolean;
  readonly hasEvidence: boolean;
  readonly provenance: string;
}

function parseArguments(argv: readonly string[]): Readonly<{
  scenarioId: string;
  predecessorOperationId: string | null;
}> {
  let scenarioId: string | undefined;
  let predecessorOperationId: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if ((argument !== "--scenario" && argument !== "--predecessor") || value === undefined) {
      throw new Error("Simulator authorization arguments are invalid");
    }
    if (argument === "--scenario") {
      if (scenarioId !== undefined)
        throw new Error("Simulator authorization arguments are invalid");
      scenarioId = value;
    } else {
      if (predecessorOperationId !== null) {
        throw new Error("Simulator authorization arguments are invalid");
      }
      predecessorOperationId = value;
    }
    index += 1;
  }
  if (scenarioId === undefined || !opaqueIdentifier.test(scenarioId)) {
    throw new Error("Simulator scenario is invalid");
  }
  return Object.freeze({ scenarioId, predecessorOperationId });
}

export async function authorizeLiveSimulatorRun(input: {
  readonly argv: readonly string[];
  readonly configuration: AuthorizationConfiguration;
  readonly authorizationIssuer: LiveSimulatorAuthorizationIssuerPort;
  readonly predecessorLookup?: Readonly<{
    find(operationId: string): Promise<RecoveryPredecessorFact | undefined>;
  }>;
  readonly scenarios?: readonly AuthorizationScenario[];
  readonly nowEpochSeconds?: () => number;
  readonly generateOperationId?: () => string;
  readonly generateNonce?: () => string;
  readonly writeOutput?: (value: string) => void;
}): Promise<
  Readonly<{
    operationId: string;
    scenarioId: string;
    scenarioRevision: number;
    expiresAtEpochSeconds: number;
  }>
> {
  const parsed = parseArguments(input.argv);
  const scenarios = input.scenarios ?? SIMULATOR_SCENARIO_CATALOG;
  const candidates = scenarios.filter(
    (scenario) =>
      scenario.scenarioId === parsed.scenarioId && scenario.supportedModes.includes("LIVE_SMOKE"),
  );
  const scenario = candidates.toSorted((left, right) => right.revision - left.revision)[0];
  if (scenario === undefined) throw new Error("Scenario is unavailable for live observation");
  if (scenario.scenarioId === "synthetic-recovery") {
    if (parsed.predecessorOperationId === null) {
      throw new Error("Recovery predecessor operation ID is required");
    }
    if (!opaqueIdentifier.test(parsed.predecessorOperationId)) {
      throw new Error("Recovery predecessor operation ID is invalid");
    }
    const predecessor = await input.predecessorLookup?.find(parsed.predecessorOperationId);
    if (
      predecessor === undefined ||
      predecessor.scenarioId !== "synthetic-abnormal" ||
      predecessor.scenarioRevision !== 2 ||
      !predecessor.terminal ||
      !predecessor.hasEvidence ||
      predecessor.provenance !== "SIMULATED"
    ) {
      throw new Error("Recovery predecessor is not an eligible live abnormal observation");
    }
  } else if (parsed.predecessorOperationId !== null) {
    throw new Error("Recovery predecessor is not valid for this scenario");
  }
  const operationId = (input.generateOperationId ?? randomUUID)();
  const nonce = (input.generateNonce ?? (() => encodeAuthorizationNonce(randomBytes(24))))();
  if (!opaqueIdentifier.test(operationId) || !opaqueIdentifier.test(nonce)) {
    throw new Error("Simulator authorization identity generation failed");
  }
  const authorization = await issueRunAuthorization({
    organizationId: OrganizationId.create(input.configuration.organizationId),
    runId: operationId,
    scenarioId: scenario.scenarioId,
    scenarioRevision: scenario.revision,
    endpointAlias: input.configuration.endpointAlias,
    audience: input.configuration.authorizationAudience,
    signingKey: input.configuration.authorizationSigningKey,
    nonce,
    predecessorOperationId: parsed.predecessorOperationId,
    nowEpochSeconds: (input.nowEpochSeconds ?? (() => Math.floor(Date.now() / 1_000)))(),
    ttlSeconds: 300,
    authorizationIssuer: input.authorizationIssuer,
    authorizedTargetDigest: input.configuration.authorizedTargetDigest,
    publicOrigin: input.configuration.publicBaseUrl,
    purpose: "non-production-synthetic-live-smoke",
    callBudget: 1,
    concurrency: 1,
    retryBudget: 0,
    dtmfPolicy: "forbidden",
    terminalDeadlineSeconds: 120,
  });
  (input.writeOutput ?? ((value) => process.stdout.write(`${value}\n`)))(
    JSON.stringify({
      operationId,
      scenarioId: scenario.scenarioId,
      scenarioRevision: scenario.revision,
      expiresAtEpochSeconds: authorization.expiresAtEpochSeconds,
      permit: authorization.token,
    }),
  );
  return Object.freeze({
    operationId,
    scenarioId: scenario.scenarioId,
    scenarioRevision: scenario.revision,
    expiresAtEpochSeconds: authorization.expiresAtEpochSeconds,
  });
}

export async function runAuthorizeLiveSimulatorCli(
  _argv: readonly string[],
  _environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  void _argv;
  void _environment;
  throw new Error(
    "Standalone live-smoke authorization is disabled; use the guarded operator action",
  );
}
