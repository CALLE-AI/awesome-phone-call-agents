import type {
  VoiceCallPort,
  VoiceCallPortFactory,
  VoiceCallRequest,
  VoiceCallResult,
} from "@muster/application";

import { OBSERVATION_SOURCE_FIXTURES } from "../fixtures/observation-source-fixtures.js";

type FakeVoiceCallConfiguration = VoiceCallResult | Readonly<{ fixtureIndexes: readonly number[] }>;

export class FakeVoiceCallPort implements VoiceCallPort {
  private readonly requests: VoiceCallRequest[] = [];
  private readonly fixtureIndexes: number[];

  public constructor(private readonly configuration: FakeVoiceCallConfiguration) {
    this.fixtureIndexes =
      "fixtureIndexes" in configuration ? [...configuration.fixtureIndexes] : [];
  }

  public get dispatches(): readonly VoiceCallRequest[] {
    return [...this.requests];
  }

  public async createOrReconcile(request: VoiceCallRequest): Promise<VoiceCallResult> {
    this.requests.push(request);
    if (!("fixtureIndexes" in this.configuration)) return this.configuration;
    const fixtureIndex = this.fixtureIndexes.shift();
    const fixture =
      fixtureIndex === undefined ? undefined : OBSERVATION_SOURCE_FIXTURES[fixtureIndex];
    if (fixture === undefined) {
      throw new Error("No deterministic voice-call fixture remains");
    }
    const providerRunId = `simulated_provider_run_${request.operationId}`;
    const providerRevisionId = fixtureIndex === 1 ? "revision-2" : "revision-1";
    return Object.freeze({
      kind: "evidence",
      providerRunId,
      providerRevisionId,
      capturedAt: fixture.evidence.capturedAt,
      opaqueCustodyRef: `${fixture.evidence.opaqueCustodyRef}_${providerRevisionId}`,
      provenance: fixture.provenance,
      sourceCompleteness: fixture.evidence.sourceCompleteness,
      admittedAnchors: Object.freeze(
        fixture.evidence.admittedAnchors.map((anchor) =>
          Object.freeze({ ...anchor, providerRunId, evidenceRevisionId: providerRevisionId }),
        ),
      ),
      candidates:
        fixture.candidates === null
          ? null
          : Object.freeze(
              fixture.candidates.map((candidate) =>
                Object.freeze({
                  ...candidate,
                  providerRunId,
                  evidenceRevisionId: providerRevisionId,
                  callAttemptId: request.operationId,
                }),
              ),
            ),
      confidencePolicy: fixture.confidencePolicy,
    });
  }
}

export class FakeVoiceCallPortFactory implements VoiceCallPortFactory {
  public readonly port: FakeVoiceCallPort;
  private created = 0;

  public constructor(result: FakeVoiceCallConfiguration) {
    this.port = new FakeVoiceCallPort(result);
  }

  public get constructionCount(): number {
    return this.created;
  }

  public create(): VoiceCallPort {
    this.created += 1;
    return this.port;
  }
}
