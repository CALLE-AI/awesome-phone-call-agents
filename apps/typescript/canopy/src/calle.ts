// The only module that talks to CALL-E. Everything it sends is built from validated facts,
// and every request carries an idempotency key so a crash and restart can never dial the
// same person twice for the same event and attempt.

import { CalleClient, type Call, type CreateCallInput, type JsonObject } from "@call-e/calle";

type CallRecipientInput = NonNullable<CreateCallInput["recipients"]>[number];
import type { Config } from "./config.js";
import { renderEscalationTask, renderWaveTask, type Playbook } from "./playbooks.js";
import { ESCALATION_RESULT_SCHEMA, RECIPIENT_RESULT_SCHEMA, TASK_RESULT_SCHEMA } from "./schemas.js";
import type { HazardEvent, Outcome, Person, Wave } from "./types.js";

export function createCalleClient(config: Config): CalleClient {
  if (config.mode === "live") {
    if (config.apiKey === null) {
      throw new Error("CALLE_API_KEY is required in live mode.");
    }
    return new CalleClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  }
  return new CalleClient({ apiKey: "dry-run-no-real-key", baseUrl: config.baseUrl });
}

export function waveIdempotencyKey(eventId: string, wave: Wave, personId?: string): string {
  const base = `canopy:${eventId}:wave${wave.index}:attempt${wave.attempt}`;
  return personId === undefined ? base : `${base}:${personId}`;
}

export function escalationIdempotencyKey(eventId: string, personId: string): string {
  return `canopy:${eventId}:escalation:${personId}`;
}

function recipientFor(person: Person): CallRecipientInput {
  return { phones: [person.phone], locale: person.locale, region: person.region };
}

function dryRunHints(config: Config, people: { phone: string; name: string; scenario: string | null }[]): JsonObject {
  if (config.mode !== "dry-run") {
    return {};
  }
  const scenarios: Record<string, string> = {};
  const names: Record<string, string> = {};
  for (const p of people) {
    if (p.scenario !== null) {
      scenarios[p.phone] = p.scenario;
    }
    names[p.phone] = p.name;
  }
  return { canopy_dry_run: scenarios, canopy_names: names };
}

export interface WaveCallInput {
  config: Config;
  client: CalleClient;
  event: HazardEvent;
  playbook: Playbook;
  wave: Wave;
  people: Person[];
  webhookUrl: string | null;
  /** per-person mode: the single person this task is for, so the key is unique per person. */
  personKey?: string;
}

export async function createWaveCall(input: WaveCallInput): Promise<{ call: Call; task: string; idempotencyKey: string }> {
  const { config, client, event, playbook, wave, people, webhookUrl } = input;
  const task = renderWaveTask(playbook, event, people);
  const idempotencyKey = waveIdempotencyKey(event.id, wave, input.personKey);
  const create = {
    task,
    recipients: people.map(recipientFor),
    resultSchema: TASK_RESULT_SCHEMA,
    recipientResultSchema: RECIPIENT_RESULT_SCHEMA,
    metadata: {
      app: "canopy",
      kind: "wave",
      event_id: event.id,
      hazard: event.hazard,
      wave: wave.index,
      attempt: wave.attempt,
      person_ids: people.map((p) => p.id),
      ...dryRunHints(config, people),
    },
    ...(webhookUrl !== null ? { webhookUrl } : {}),
  };
  const call = await client.calls.create(create, { idempotencyKey });
  return { call, task, idempotencyKey };
}

export interface EscalationCallInput {
  config: Config;
  client: CalleClient;
  event: HazardEvent;
  playbook: Playbook;
  person: Person;
  outcome: Outcome;
  reasons: string[];
  attempts: number;
  webhookUrl: string | null;
}

export async function createEscalationCall(input: EscalationCallInput): Promise<{ call: Call; task: string; idempotencyKey: string }> {
  const { config, client, event, playbook, person, outcome, reasons, attempts, webhookUrl } = input;
  if (person.contactPhone === null) {
    throw new Error(`Person ${person.id} has no emergency contact phone.`);
  }
  const task = renderEscalationTask(playbook, event, person, outcome, reasons, attempts);
  const idempotencyKey = escalationIdempotencyKey(event.id, person.id);
  const contactScenario = person.scenario !== null && person.scenario.startsWith("contact-") ? person.scenario : contactScenarioFor(person.scenario);
  const create = {
    task,
    recipients: [{ phones: [person.contactPhone], locale: person.contactLocale ?? person.locale, region: person.region }],
    recipientResultSchema: ESCALATION_RESULT_SCHEMA,
    metadata: {
      app: "canopy",
      kind: "escalation",
      event_id: event.id,
      hazard: event.hazard,
      person_id: person.id,
      person_outcome: outcome,
      ...dryRunHints(config, [{ phone: person.contactPhone, name: person.contactName ?? "the emergency contact", scenario: contactScenario }]),
    },
    ...(webhookUrl !== null ? { webhookUrl } : {}),
  };
  const call = await client.calls.create(create, { idempotencyKey });
  return { call, task, idempotencyKey };
}

/** Dry-run only: derive a contact scenario from the person's scenario so demos are deterministic. */
function contactScenarioFor(personScenario: string | null): string | null {
  switch (personScenario) {
    case "red":
      return "contact-ems";
    case "red-confusion":
      return "contact-commit";
    case "unreachable":
      return "contact-commit";
    case "unverified":
      return "contact-decline";
    default:
      return null;
  }
}
