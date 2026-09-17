// The only module that talks to CALL-E. Every request carries an idempotency key built from the
// campaign, the person and the attempt, so a crash and restart can never dial anybody twice for
// the same attempt.

import { CalleClient, type Call, type JsonObject } from "@call-e/calle";
import type { Config } from "./config.js";
import type { Rules, StateConfig } from "./rules.js";
import { SCREENING_RESULT_SCHEMA } from "./schemas.js";
import { renderScreeningTask } from "./tasks.js";
import type { Campaign, Enrollee, Wave } from "./types.js";

export function createCalleClient(config: Config): CalleClient {
  if (config.mode === "live") {
    if (config.apiKey === null) {
      throw new Error("CALLE_API_KEY is required in live mode.");
    }
    return new CalleClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  }
  return new CalleClient({ apiKey: "dry-run-no-real-key", baseUrl: config.baseUrl });
}

export function screeningIdempotencyKey(campaignId: string, personId: string, attempt: number): string {
  return `sc:${campaignId}:${personId}:attempt${attempt}`;
}

function dryRunHints(config: Config, person: Enrollee, probeSimulation: ProbeSimulation | undefined): JsonObject {
  if (config.mode !== "dry-run") {
    return {};
  }
  return {
    sc_dry_run: person.scenario !== null ? { [person.phone]: person.scenario } : {},
    sc_names: { [person.phone]: person.firstName },
    // Probe calls replay their own scripted simulation instead of a registry scenario, so a
    // dry-run probe actually applies the pressure the probe describes.
    ...(probeSimulation !== undefined ? { sc_probe: { [person.phone]: { id: probeSimulation.probeId, mode: probeSimulation.mode } } } : {}),
  };
}

export interface ScreeningCallInput {
  config: Config;
  client: CalleClient;
  campaign: Campaign;
  rules: Rules;
  state: StateConfig;
  person: Enrollee;
  wave: Wave;
  webhookUrl: string | null;
  /** Dry-run only: replay a scripted probe simulation rather than a registry scenario. */
  probeSimulation?: ProbeSimulation;
}

export interface ProbeSimulation {
  probeId: string;
  mode: "compliant" | "violating";
}

export async function createScreeningCall(input: ScreeningCallInput): Promise<{ call: Call; task: string; idempotencyKey: string }> {
  const { config, client, campaign, rules, state, person, wave, webhookUrl, probeSimulation } = input;
  const task = renderScreeningTask(rules, state, person, campaign.asOf);
  const idempotencyKey = screeningIdempotencyKey(campaign.id, person.id, wave.attempt);
  const create = {
    task,
    recipients: [{ phones: [person.phone], locale: person.locale, region: person.region }],
    recipientResultSchema: SCREENING_RESULT_SCHEMA,
    metadata: {
      app: "still-covered",
      kind: "screen",
      campaign_id: campaign.id,
      state_id: state.id,
      person_id: person.id,
      wave: wave.index,
      attempt: wave.attempt,
      ...dryRunHints(config, person, probeSimulation),
    },
    ...(webhookUrl !== null ? { webhookUrl } : {}),
  };
  const call = await client.calls.create(create, { idempotencyKey });
  return { call, task, idempotencyKey };
}
