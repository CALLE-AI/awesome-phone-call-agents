import { readFile } from "node:fs/promises";
import path from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

// Order is the evidence frontier: stages after the first unproven boundary remain unassessed.
const FAILURE_STAGES = Object.freeze([
  "destination_routing",
  "transcription",
  "structured_output",
  "callback_lifecycle",
  "application_admission",
] as const);

type FailureStage = (typeof FAILURE_STAGES)[number];
type AssessmentState = "proven" | "unproven" | "unassessed";

interface QualificationEvidence {
  readonly destinationRouting: Readonly<{
    exactReconciledCall: boolean;
    signedInitialVoiceCallback: boolean;
  }>;
  readonly transcription: Readonly<{
    callETerminalObserved: boolean;
    boundedNonEmptyTranscript: boolean;
  }>;
  readonly structuredOutput: Readonly<{
    schemaValidRecipientResult: boolean;
  }>;
  readonly callbackLifecycle: Readonly<{
    signedVoice: boolean;
    signedZeroDtmfCanary: boolean;
    signedTerminalStatus: boolean;
    callETerminal: boolean;
    exactCallReconciled: boolean;
    correctlyOrdered: boolean;
  }>;
  readonly applicationAdmission: Readonly<{
    exactShapeValid: boolean;
    custodyBeforeDerivation: boolean;
    groundedToExpectedZones: boolean;
    atomicPersistence: boolean;
  }>;
}

interface QualificationDiagnosis {
  readonly failureStage: FailureStage | null;
  readonly provenance: "SIMULATED";
  readonly assessments: readonly Readonly<{
    stage: FailureStage;
    state: AssessmentState;
  }>[];
}

function fullyProvenEvidence(): QualificationEvidence {
  return {
    destinationRouting: {
      exactReconciledCall: true,
      signedInitialVoiceCallback: true,
    },
    transcription: {
      callETerminalObserved: true,
      boundedNonEmptyTranscript: true,
    },
    structuredOutput: {
      schemaValidRecipientResult: true,
    },
    callbackLifecycle: {
      signedVoice: true,
      signedZeroDtmfCanary: true,
      signedTerminalStatus: true,
      callETerminal: true,
      exactCallReconciled: true,
      correctlyOrdered: true,
    },
    applicationAdmission: {
      exactShapeValid: true,
      custodyBeforeDerivation: true,
      groundedToExpectedZones: true,
      atomicPersistence: true,
    },
  };
}

function boundaryIsProven(stage: FailureStage, evidence: QualificationEvidence): boolean {
  switch (stage) {
    case "destination_routing":
      return (
        evidence.destinationRouting.exactReconciledCall === true &&
        evidence.destinationRouting.signedInitialVoiceCallback === true
      );
    case "transcription":
      return (
        evidence.transcription.callETerminalObserved === true &&
        evidence.transcription.boundedNonEmptyTranscript === true
      );
    case "structured_output":
      return evidence.structuredOutput.schemaValidRecipientResult === true;
    case "callback_lifecycle":
      return (
        evidence.callbackLifecycle.signedVoice === true &&
        evidence.callbackLifecycle.signedZeroDtmfCanary === true &&
        evidence.callbackLifecycle.signedTerminalStatus === true &&
        evidence.callbackLifecycle.callETerminal === true &&
        evidence.callbackLifecycle.exactCallReconciled === true &&
        evidence.callbackLifecycle.correctlyOrdered === true
      );
    case "application_admission":
      return (
        evidence.applicationAdmission.exactShapeValid === true &&
        evidence.applicationAdmission.custodyBeforeDerivation === true &&
        evidence.applicationAdmission.groundedToExpectedZones === true &&
        evidence.applicationAdmission.atomicPersistence === true
      );
  }
}

function classifyQualificationEvidence(evidence: QualificationEvidence): QualificationDiagnosis {
  const failureIndex = FAILURE_STAGES.findIndex((stage) => !boundaryIsProven(stage, evidence));
  const failureStage = failureIndex === -1 ? null : FAILURE_STAGES[failureIndex];

  return Object.freeze({
    failureStage: failureStage ?? null,
    provenance: "SIMULATED",
    assessments: Object.freeze(
      FAILURE_STAGES.map((stage, index) =>
        Object.freeze({
          stage,
          state:
            failureIndex === -1 || index < failureIndex
              ? ("proven" as const)
              : index === failureIndex
                ? ("unproven" as const)
                : ("unassessed" as const),
        }),
      ),
    ),
  });
}

async function readRepositoryFile(relativePath: string): Promise<string> {
  return await readFile(path.join(repositoryRoot, relativePath), "utf8");
}

function canonicalSource(source: string): string {
  return source.replace(/\r\n?/gu, "\n");
}

function interfaceDeclarationBlock(source: string, interfaceName: string): string {
  const marker = `export interface ${interfaceName} {`;
  const declarationStart = source.indexOf(marker);
  if (declarationStart === -1 || source.indexOf(marker, declarationStart + marker.length) !== -1) {
    throw new Error(`Expected one ${interfaceName} interface declaration`);
  }
  const openingBrace = source.indexOf("{", declarationStart);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return canonicalSource(source.slice(declarationStart, index + 1));
  }
  throw new Error(`Unterminated ${interfaceName} interface declaration`);
}

// Keep contract inspection static so this non-calling test never imports provider-facing modules.
type StaticValue =
  | string
  | number
  | boolean
  | null
  | readonly StaticValue[]
  | Readonly<{ [key: string]: StaticValue }>;

function propertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  throw new Error(`Unsupported static property name: ${name.getText(sourceFile)}`);
}

function staticValue(expression: ts.Expression, sourceFile: ts.SourceFile): StaticValue {
  if (ts.isParenthesizedExpression(expression))
    return staticValue(expression.expression, sourceFile);
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.map((element) => staticValue(element, sourceFile));
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const result: Record<string, StaticValue> = {};
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error(`Unsupported static property: ${property.getText(sourceFile)}`);
      }
      result[propertyNameText(property.name, sourceFile)] = staticValue(
        property.initializer,
        sourceFile,
      );
    }
    return result;
  }
  if (
    ts.isCallExpression(expression) &&
    expression.expression.getText(sourceFile) === "Object.freeze" &&
    expression.arguments.length === 1
  ) {
    return staticValue(expression.arguments[0]!, sourceFile);
  }
  throw new Error(`Unsupported static expression: ${expression.getText(sourceFile)}`);
}

function staticVariableValue(source: string, variableName: string): StaticValue {
  const sourceFile = ts.createSourceFile(
    "contract.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const matches: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const declaration = matches[0];
  if (matches.length !== 1 || declaration?.initializer === undefined) {
    throw new Error(`Expected one initialized ${variableName} declaration`);
  }
  return staticValue(declaration.initializer, sourceFile);
}

function stringLiteralUnionValues(source: string, typeAliasName: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    "contract.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const matches: ts.TypeAliasDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeAliasName) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const declaration = matches[0];
  if (matches.length !== 1 || declaration === undefined) {
    throw new Error(`Expected one ${typeAliasName} type alias`);
  }
  const members = ts.isUnionTypeNode(declaration.type)
    ? declaration.type.types
    : [declaration.type];
  return members.map((member) => {
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) {
      throw new Error(`${typeAliasName} must contain only string literals`);
    }
    return member.literal.text;
  });
}

function uniqueCallExpression(source: string, callee: string): string {
  const sourceFile = ts.createSourceFile(
    "contract.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === callee) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (matches.length !== 1) throw new Error(`Expected one ${callee} call`);
  return canonicalSource(matches[0]!.getText(sourceFile));
}

function boundedSource(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start === -1 || source.indexOf(startMarker, start + startMarker.length) !== -1) {
    throw new Error(`Expected one source start marker: ${startMarker}`);
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`Missing source end marker: ${endMarker}`);
  return canonicalSource(source.slice(start, end).trimEnd());
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => stringsIn(item));
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap((item) => stringsIn(item));
  }
  return [];
}

function keysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => keysIn(item));
  if (value !== null && typeof value === "object") {
    return [...Object.keys(value), ...Object.values(value).flatMap((item) => keysIn(item))];
  }
  return [];
}

describe("privacy-safe CALL-E to Twilio qualification diagnosis", () => {
  it("pins the executing Node and workspace package manager to Node 24.18.0 and pnpm 11.20.0", async () => {
    const packageJson = JSON.parse(await readRepositoryFile("package.json")) as {
      readonly engines: Readonly<{ node: string; pnpm: string }>;
      readonly packageManager: string;
    };
    const nodeVersionFile = (await readRepositoryFile(".node-version")).trim();

    expect(process.versions.node).toBe("24.18.0");
    expect(nodeVersionFile).toBe("24.18.0");
    expect(packageJson.engines).toEqual({ node: "24.18.0", pnpm: "11.20.0" });
    expect(packageJson.packageManager).toBe("pnpm@11.20.0");
  });

  it("records the pinned public CALL-E request/result contract and local Twilio callback seams", async () => {
    const callePackageJson = JSON.parse(
      await readRepositoryFile(
        "packages/infrastructure-calle/node_modules/@call-e/calle/package.json",
      ),
    ) as { readonly name: string; readonly version: string };
    const calleManifest = JSON.parse(
      await readRepositoryFile("packages/infrastructure-calle/package.json"),
    ) as { readonly dependencies: Readonly<Record<string, string>> };
    const calleDeclarations = await readRepositoryFile(
      "packages/infrastructure-calle/node_modules/@call-e/calle/dist/calls.d.ts",
    );
    const calleGeneratedSchema = await readRepositoryFile(
      "packages/infrastructure-calle/node_modules/@call-e/calle/dist/generated/schema.d.ts",
    );
    const calleAdapter = await readRepositoryFile(
      "packages/infrastructure-calle/src/calle-live-observation.adapter.ts",
    );
    const twilioSyntheticEndpoint = await readRepositoryFile(
      "packages/infrastructure-twilio-simulator/src/twiml-synthetic-endpoint.ts",
    );
    const twilioPublicFacade = await readRepositoryFile(
      "packages/infrastructure-twilio-simulator/src/twilio-public.d.ts",
    );
    const twilioCallbackRuntime = await readRepositoryFile(
      "apps/simulator-host/src/twilio/twilio-callback-http-runtime.ts",
    );
    const liveSmokeEvidenceCoordinator = await readRepositoryFile(
      "packages/infrastructure-twilio-simulator/src/live-smoke-evidence-coordinator.ts",
    );

    expect(callePackageJson).toEqual({
      ...callePackageJson,
      name: "@call-e/calle",
      version: "0.6.0",
    });
    expect(calleManifest.dependencies["@call-e/calle"]).toBe("0.6.0");
    expect(stringLiteralUnionValues(calleAdapter, "StructuredAdmissionClass")).toEqual([
      "terminal_shape",
      "reading_shape",
      "zone_identity",
      "anchor_value",
      "anchor_unit",
      "anchor_status",
      "auxiliary_status",
    ]);
    expect(interfaceDeclarationBlock(calleDeclarations, "CreateCallInput")).toBe(
      [
        "export interface CreateCallInput {",
        "    task: string;",
        "    recipient?: CallRecipientInput;",
        "    recipients?: CallRecipientInput[];",
        "    resultSchema?: JsonObject | null;",
        "    recipientResultSchema?: JsonObject | null;",
        "    metadata?: JsonObject;",
        "    webhookUrl?: string;",
        "}",
      ].join("\n"),
    );
    expect(interfaceDeclarationBlock(calleDeclarations, "CallAttempt")).toBe(
      [
        "export interface CallAttempt {",
        "    id: string;",
        "    phone: string;",
        '    status: components["schemas"]["AttemptStatus"];',
        "    startedAt: string | null;",
        "    completedAt: string | null;",
        "    summary: string | null;",
        "    transcriptTurns: CallTranscriptTurn[];",
        "    providerCallId: string | null;",
        "    failureCode: string | null;",
        "    failureMessage: string | null;",
        "}",
      ].join("\n"),
    );
    expect(interfaceDeclarationBlock(calleDeclarations, "CallRecipient")).toBe(
      [
        "export interface CallRecipient {",
        "    id: string;",
        "    phones: string[];",
        "    locale: string | null;",
        "    region: string | null;",
        '    status: components["schemas"]["RecipientStatus"];',
        "    structuredResult: JsonObject | null;",
        "    summary: string | null;",
        "    attempts: CallAttempt[];",
        "}",
      ].join("\n"),
    );
    expect(
      boundedSource(
        calleGeneratedSchema,
        "        CallTranscriptTurn: {",
        "        CallTaskAttempt: {",
      ),
    ).toBe(
      [
        "        CallTranscriptTurn: {",
        "            /** @description Seconds from the start of the attempt. `null` when the source line did not include a parseable timestamp. */",
        "            offset_seconds: number | null;",
        "            /** @description Speaker for this transcript turn. */",
        '            speaker: components["schemas"]["TranscriptSpeaker"];',
        "            /** @description Spoken text for this transcript turn. */",
        "            text: string;",
        "        };",
      ].join("\n"),
    );
    expect(calleGeneratedSchema).toContain("Empty when no transcript is available.");
    expect(calleAdapter).not.toContain("const taskResultSchema");
    const providerResultSchema = staticVariableValue(calleAdapter, "resultSchema");
    expect(providerResultSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["readings", "auxiliary_status"],
      properties: {
        readings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["zone_id", "value_token", "spoken_unit_token", "reading_status"],
          },
        },
      },
    });
    expect(JSON.stringify(providerResultSchema)).not.toMatch(
      /maxLength|minItems|maxItems|minimum|maximum/iu,
    );
    expect(JSON.stringify(providerResultSchema)).not.toMatch(
      /provider_?revision|confidence_?token|normalized_?unit|source_?completeness|turn_?index/iu,
    );
    expect(JSON.stringify(providerResultSchema).match(/description/gu)?.length).toBeGreaterThan(10);
    expect(uniqueCallExpression(calleAdapter, "client.calls.create")).toBe(
      [
        "client.calls.create(",
        "          {",
        "            task:",
        '              "Make exactly one outbound dial attempt to the configured synthetic endpoint and " +',
        '              "listen to the complete greenhouse report. Do not redial or retry for any reason. " +',
        `              'When connected, say "Hello" once, then listen silently. ' +`,
        '              "This endpoint is an automated greenhouse report, not a person. " +',
        '              "Do not speak again while the report is playing. " +',
        '              "The report continues after Zone 4 with sound, power, battery, and output statuses. " +',
        '              "Do not say thank you or goodbye, interrupt, or end the call after the zone readings. " +',
        '              "Wait through pauses until all four auxiliary statuses have been spoken and the " +',
        '              "remote endpoint ends the call. If the report ends early, leave missing evidence unknown; " +',
        '              "never infer missing statuses from the other readings. " +',
        '              "Do not press any keys or send DTMF. Return only provider-observed evidence under the supplied strict schema. " +',
        '              "Use exactly four readings with zone_id values zone-01, zone-02, zone-03, and zone-04, " +',
        '              "each exactly once. Copy each complete numeric token without normalizing its decimal spelling, " +',
        '              "and select only the unit and status spoken for that same zone. Muster grounds every returned " +',
        '              "token to its zone segment in the device transcript. Do not invent provider " +',
        '              "revision identifiers, confidence tokens, normalized units, source completeness, or turn indices.",',
        '            recipients: [{ phones: [targetAddress], region: "US", locale: "en-US" }],',
        "            resultSchema,",
        "            metadata: Object.freeze({",
        "              operation_id: request.operationId,",
        "              scenario_id: request.scenarioId,",
        "              scenario_revision: request.scenarioRevision,",
        "              endpoint_alias: request.endpointAlias,",
        "            }),",
        "          },",
        "          { idempotencyKey: request.providerDispatchIdentity },",
        "        )",
      ].join("\n"),
    );
    expect(
      boundedSource(
        twilioSyntheticEndpoint,
        "const action = `${input.publicBaseUrl}/twilio/canary/${encodeURIComponent(authenticated.callbackHandle)}`;",
        '      record("voice_rendered"',
      ),
    ).toBe(
      [
        "const action = `${input.publicBaseUrl}/twilio/canary/${encodeURIComponent(authenticated.callbackHandle)}`;",
        "      // Keep a bounded readiness interval so report audio does not race the answered-call transition.",
        "      const gather = response.gather({",
        "        action,",
        "        actionOnEmptyResult: true,",
        '        finishOnKey: "",',
        '        input: ["dtmf"],',
        '        method: "POST",',
        "        numDigits: 1,",
        "        timeout: 1,",
        "      });",
        "      gather.pause({ length: 1 });",
        "      gather.say(renderTwilioScenarioReport(authenticated.scenario));",
        "      response.hangup();",
      ].join("\n"),
    );
    expect(canonicalSource(twilioPublicFacade)).toContain(
      "pause(attributes: { readonly length: number }): void;",
    );
    expect(
      boundedSource(twilioCallbackRuntime, "metricRoute =", '      if (request.method !== "POST")'),
    ).toBe(
      [
        "metricRoute =",
        '        requestPath === "/twilio/voice"',
        '          ? "/twilio/voice"',
        '          : requestPath === "/twilio/status"',
        '            ? "/twilio/status"',
        "            : /^\\/twilio\\/canary\\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(requestPath)",
        '              ? "/twilio/canary/{callbackHandle}"',
        "              : undefined;",
      ].join("\n"),
    );
    expect(
      boundedSource(
        twilioCallbackRuntime,
        'const signature = request.headers["x-twilio-signature"];',
        "      const form = parseForm",
      ),
    ).toBe(
      [
        'const signature = request.headers["x-twilio-signature"];',
        '      if (typeof signature !== "string" || signature.length === 0 || signature.length > 512) {',
        "        throw new SafeHttpError(403);",
        "      }",
      ].join("\n"),
    );
    expect(
      boundedSource(
        twilioCallbackRuntime,
        "const requestUrl = `${input.publicBaseUrl}${path}`;",
        "      const operation = async () =>",
      ),
    ).toBe("const requestUrl = `${input.publicBaseUrl}${path}`;");
    expect(uniqueCallExpression(twilioCallbackRuntime, "input.controller.status")).toBe(
      [
        "input.controller.status({",
        "              requestUrl,",
        "              twilioSignature: signature,",
        "              form,",
        "              traceContext,",
        "            })",
      ].join("\n"),
    );
    expect(uniqueCallExpression(twilioCallbackRuntime, "input.controller.voice")).toBe(
      [
        "input.controller.voice({",
        "                requestUrl,",
        "                twilioSignature: signature,",
        "                form,",
        "                traceContext,",
        "              })",
      ].join("\n"),
    );
    expect(uniqueCallExpression(twilioCallbackRuntime, "input.controller.canary")).toBe(
      [
        "input.controller.canary({",
        "                requestUrl,",
        "                callbackHandle: callbackMatch[1]!,",
        "                twilioSignature: signature,",
        "                form,",
        "                traceContext,",
        "              })",
      ].join("\n"),
    );
    expect(
      boundedSource(
        liveSmokeEvidenceCoordinator,
        "const terminalDeadlineMs = run.terminalDeadlineMs ?? run.deadlineMs;",
        "      const key = operationKey",
      ),
    ).toBe(
      [
        "const terminalDeadlineMs = run.terminalDeadlineMs ?? run.deadlineMs;",
        "      if (!Number.isSafeInteger(run.deadlineMs) || run.deadlineMs < 1 || run.deadlineMs > 120_000) {",
        '        throw new Error("Live-smoke callback deadline must be between 1 and 120000ms");',
        "      }",
        "      if (",
        "        !Number.isSafeInteger(terminalDeadlineMs) ||",
        "        terminalDeadlineMs < run.deadlineMs ||",
        "        terminalDeadlineMs > 305_000",
        "      ) {",
        "        throw new Error(",
        '          "Live-smoke terminal deadline must be between callback deadline and 305000ms",',
        "        );",
        "      }",
      ].join("\n"),
    );

    const misleadingDeclarations = [
      "export interface CallRecipient {",
      "    id: string;",
      "}",
      "export interface Call {",
      "    structuredResult: JsonObject | null;",
      "}",
    ].join("\n");
    expect(interfaceDeclarationBlock(misleadingDeclarations, "CallRecipient")).toBe(
      ["export interface CallRecipient {", "    id: string;", "}"].join("\n"),
    );
  });

  it("orders all five stages and marks only the earliest unproven boundary", () => {
    const cases: readonly Readonly<{
      stage: FailureStage;
      evidence: QualificationEvidence;
    }>[] = [
      {
        stage: "destination_routing",
        evidence: {
          ...fullyProvenEvidence(),
          destinationRouting: {
            exactReconciledCall: false,
            signedInitialVoiceCallback: false,
          },
        },
      },
      {
        stage: "transcription",
        evidence: {
          ...fullyProvenEvidence(),
          transcription: {
            callETerminalObserved: true,
            boundedNonEmptyTranscript: false,
          },
        },
      },
      {
        stage: "structured_output",
        evidence: {
          ...fullyProvenEvidence(),
          structuredOutput: { schemaValidRecipientResult: false },
        },
      },
      {
        stage: "callback_lifecycle",
        evidence: {
          ...fullyProvenEvidence(),
          callbackLifecycle: {
            ...fullyProvenEvidence().callbackLifecycle,
            correctlyOrdered: false,
          },
        },
      },
      {
        stage: "application_admission",
        evidence: {
          ...fullyProvenEvidence(),
          applicationAdmission: {
            ...fullyProvenEvidence().applicationAdmission,
            atomicPersistence: false,
          },
        },
      },
    ];

    for (const { stage, evidence } of cases) {
      const result = classifyQualificationEvidence(evidence);
      const failureIndex = FAILURE_STAGES.indexOf(stage);

      expect(result.failureStage).toBe(stage);
      expect(result.assessments.map((assessment) => assessment.stage)).toEqual(FAILURE_STAGES);
      expect(result.assessments.map((assessment) => assessment.state)).toEqual(
        FAILURE_STAGES.map((_candidate, index) =>
          index < failureIndex ? "proven" : index === failureIndex ? "unproven" : "unassessed",
        ),
      );
    }
  });

  it("keeps omitted or unknown required facts unproven at the earliest affected boundary", () => {
    const callbackFactOmitted = {
      ...fullyProvenEvidence(),
      callbackLifecycle: {
        signedVoice: true,
        signedZeroDtmfCanary: true,
        callETerminal: true,
        exactCallReconciled: true,
        correctlyOrdered: true,
      },
    } as unknown as QualificationEvidence;
    const applicationFactsOmitted = {
      ...fullyProvenEvidence(),
      applicationAdmission: {},
    } as unknown as QualificationEvidence;
    const structuredResultUnknown = {
      ...fullyProvenEvidence(),
      structuredOutput: { schemaValidRecipientResult: undefined },
    } as unknown as QualificationEvidence;

    expect(classifyQualificationEvidence(callbackFactOmitted).assessments).toEqual([
      { stage: "destination_routing", state: "proven" },
      { stage: "transcription", state: "proven" },
      { stage: "structured_output", state: "proven" },
      { stage: "callback_lifecycle", state: "unproven" },
      { stage: "application_admission", state: "unassessed" },
    ]);
    expect(classifyQualificationEvidence(applicationFactsOmitted).failureStage).toBe(
      "application_admission",
    );
    expect(classifyQualificationEvidence(structuredResultUnknown).failureStage).toBe(
      "structured_output",
    );
  });

  it("emits only allowlisted stage metadata and no protected provider content", () => {
    const evidence = fullyProvenEvidence();
    const result = classifyQualificationEvidence({
      ...evidence,
      transcription: {
        callETerminalObserved: true,
        boundedNonEmptyTranscript: false,
      },
      structuredOutput: { schemaValidRecipientResult: false },
    });
    const allowedStrings = new Set<string>([
      ...FAILURE_STAGES,
      "SIMULATED",
      "proven",
      "unproven",
      "unassessed",
    ]);

    expect(Object.keys(result).sort()).toEqual(["assessments", "failureStage", "provenance"]);
    expect(stringsIn(result).every((value) => allowedStrings.has(value))).toBe(true);
    for (const protectedField of [
      "apiToken",
      "targetAddress",
      "permit",
      "providerCallId",
      "rawPayload",
      "transcript",
    ]) {
      expect(keysIn(result)).not.toContain(protectedField);
    }
  });

  it("reproduces transcription RED by requiring bounded TwiML timing before report audio", async () => {
    const [calleGeneratedSchema, twilioVoiceDeclarations, twilioSyntheticEndpoint] =
      await Promise.all([
        readRepositoryFile(
          "packages/infrastructure-calle/node_modules/@call-e/calle/dist/generated/schema.d.ts",
        ),
        readRepositoryFile(
          "packages/infrastructure-twilio-simulator/node_modules/twilio/lib/twiml/VoiceResponse.d.ts",
        ),
        readRepositoryFile(
          "packages/infrastructure-twilio-simulator/src/twiml-synthetic-endpoint.ts",
        ),
      ]);
    const voiceResponse = boundedSource(
      twilioSyntheticEndpoint,
      "const action = `${input.publicBaseUrl}/twilio/canary/${encodeURIComponent(authenticated.callbackHandle)}`;",
      '      record("voice_rendered"',
    );
    const gatherDeclarations = boundedSource(
      twilioVoiceDeclarations,
      "export class Gather extends TwiML {",
      "export class Hangup extends TwiML {",
    );
    const boundedTranscriptionTiming = "gather.pause({ length: 1 });";

    expect(calleGeneratedSchema).toContain("Empty when no transcript is available.");
    expect(gatherDeclarations).toContain(
      "pause(attributes?: VoiceResponse.PauseAttributes): VoiceResponse.Pause;",
    );
    expect(voiceResponse).toContain('input: ["dtmf"]');
    expect(voiceResponse).toContain("actionOnEmptyResult: true");
    expect(voiceResponse).toContain(boundedTranscriptionTiming);
    expect(voiceResponse.indexOf(boundedTranscriptionTiming)).toBeLessThan(
      voiceResponse.indexOf("gather.say("),
    );
  });

  it("diagnoses synthetic missing-transcript evidence and leaves later stages unassessed", () => {
    const predecessorEvidence: QualificationEvidence = {
      ...fullyProvenEvidence(),
      destinationRouting: {
        exactReconciledCall: true,
        signedInitialVoiceCallback: true,
      },
      transcription: {
        callETerminalObserved: true,
        boundedNonEmptyTranscript: false,
      },
      structuredOutput: { schemaValidRecipientResult: false },
      applicationAdmission: {
        exactShapeValid: false,
        custodyBeforeDerivation: false,
        groundedToExpectedZones: false,
        atomicPersistence: false,
      },
    };

    const diagnosis = classifyQualificationEvidence(predecessorEvidence);

    expect(diagnosis.failureStage).toBe("transcription");
    expect(diagnosis.assessments).toEqual([
      { stage: "destination_routing", state: "proven" },
      { stage: "transcription", state: "unproven" },
      { stage: "structured_output", state: "unassessed" },
      { stage: "callback_lifecycle", state: "unassessed" },
      { stage: "application_admission", state: "unassessed" },
    ]);
  });
});
