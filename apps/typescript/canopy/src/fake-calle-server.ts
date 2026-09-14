// A local stand-in for the CALL-E Developer API so Canopy can be exercised end to end
// without placing a call. It speaks the same contract the real API does (POST /v1/calls,
// GET /v1/calls/{id}, GET /v1/calls/{id}/events, terminal webhooks with CALL-E-Event-Id),
// and plays a scripted conversation per recipient chosen from `metadata.canopy_dry_run`.
//
// It also reproduces two real-platform behaviours worth designing around: the delay before
// the first bot word (issue #295) and a completed call whose structured result is null.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { E164_RE } from "./mask.js";

type Json = Record<string, unknown>;

interface ApiAttempt {
  id: string;
  phone: string;
  status: "queued" | "dialing" | "in_progress" | "completed" | "failed" | "canceled";
  started_at: string | null;
  completed_at: string | null;
  summary: string | null;
  transcript_turns: { offset_seconds: number | null; speaker: "bot" | "user" | "unknown"; text: string }[];
  provider_call_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
}

interface ApiRecipient {
  id: string;
  phones: string[];
  locale: string | null;
  region: string | null;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  structured_result: Json | null;
  summary: string | null;
  attempts: ApiAttempt[];
}

interface ApiCall {
  id: string;
  object: "call_task";
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  task: string;
  recipients: ApiRecipient[];
  structured_result: Json | null;
  summary: string | null;
  task_completed: boolean | null;
  completion_confidence: { score: number; label: string } | null;
  evidence: string[];
  metadata: Json;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  completed_at: string | null;
}

interface ApiEvent {
  id: string;
  type: string;
  call_id: string;
  created_at: string;
  level: "debug" | "info" | "warning" | "error";
  status: ApiCall["status"];
  message: string;
  details: Json;
}

export interface FakeServerOptions {
  port?: number;
  /** Milliseconds before a queued call starts dialing. */
  queueDelayMs?: number;
  /** Milliseconds each recipient conversation lasts. */
  perRecipientMs?: number;
  /** When true, log requests to stderr. */
  verbose?: boolean;
  /** Reject the first `count` POST /v1/calls with this error, to exercise retry and not-attempted paths. */
  createFailures?: { count: number; status: number; code: string };
}

export interface FakeServerHandle {
  url: string;
  port: number;
  server: Server;
  close(): Promise<void>;
  /** Number of call tasks created so far. */
  callCount(): number;
}

export const SCENARIOS = [
  "green",
  "yellow",
  "red",
  "red-confusion",
  "caregiver",
  "voicemail",
  "unreachable",
  "unverified",
  "slow-green",
  "declined",
  "contact-commit",
  "contact-decline",
  "contact-no-answer",
  "contact-ems",
] as const;

export type Scenario = (typeof SCENARIOS)[number];

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function now(): string {
  return new Date().toISOString();
}

function hashScenario(phone: string): Scenario {
  let h = 0;
  for (const ch of phone) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  const pool: Scenario[] = ["green", "green", "green", "yellow", "green", "unreachable", "green", "red"];
  return pool[h % pool.length] ?? "green";
}

const LOCALIZED_USER_TURNS: Record<string, Partial<Record<Scenario, string[]>>> = {
  hi: {
    green: ["Haan, main hi bol rahi hoon.", "Haan, pankha chal raha hai, main baithak mein hoon.", "Haan, paani pi rahi hoon.", "Nahin, main theek hoon.", "Nahin, dhanyavaad."],
    yellow: ["Haan.", "Pankha subah se band hai, bahut garmi hai.", "Thoda paani piya hai.", "Sar mein dard hai, chakkar nahin.", "Ek pankha mil jaaye to achha hoga."],
    red: ["Haan... bol rahi hoon.", "Nahin, AC nahin hai, bahut garmi hai.", "Nahin, jee machal raha hai.", "Chakkar aa raha hai, abhi rasoi mein gir gayi thi.", "Kisi ko bhej dijiye."],
    caregiver: ["Main unki beti hoon, main saath hoon.", "Haan, AC chal raha hai, woh aaram kar rahi hain.", "Haan, paani deti rehti hoon.", "Nahin, woh theek hain."],
  },
  ta: {
    green: ["Aamaa, naan thaan pesuren.", "Aamaa, fan odudhu, naan hall-la irukken.", "Aamaa, thanni kudichen.", "Illa, nallaa irukken.", "Illa, nandri."],
    yellow: ["Aamaa.", "Kaalaila irundhu fan velai seiyala, romba soodu.", "Konjam thanni kudichen.", "Thalai vali irukku, thalai suthala.", "Oru fan kedaicha nallaa irukkum."],
    red: ["Aamaa... pesuren.", "Illa, AC illa, romba soodu.", "Illa, kuzhambara maadhiri irukku.", "Thalai suthudhu, ippo samayalarai-la vizhundhutten.", "Yaaravadhu anuppunga."],
    caregiver: ["Naan avanga ponnu, naan kooda irukken.", "Aamaa, AC odudhu, avanga rest edukkuraanga.", "Aamaa, thanni kudukkuren.", "Illa, avanga nallaa irukkaanga."],
  },
  es: {
    green: ["Si, soy yo.", "Si, estoy en la sala y el ventilador esta encendido.", "Si, bastante.", "No, me siento bien.", "No, gracias por llamar."],
    yellow: ["Si.", "El ventilador dejo de funcionar esta manana. Hace mucho calor aqui.", "Si, un poco.", "Tengo dolor de cabeza pero no estoy mareada.", "Un ventilador ayudaria. No puedo ir a la tienda."],
    red: ["Si... habla ella.", "No, no hay aire acondicionado. Es como un horno.", "No mucho, tengo nauseas.", "Estoy mareada. Casi me caigo en la cocina ahora mismo.", "Por favor, manden a alguien."],
    caregiver: ["Soy su hija, estoy con ella ahora. Puedo responder por ella.", "Si, el aire esta encendido y esta descansando.", "Si, le sigo trayendo agua.", "No, esta bien."],
  },
  zh: {
    green: ["Shi de, shi wo.", "Shi, wo zai keting, fengshan kai zhe.", "Shi, he le hen duo shui.", "Bu, wo hen hao.", "Bu yong, xiexie ni da dianhua."],
    caregiver: ["Wo shi ta nuer, wo zai ta shenbian, wo keyi dai ta huida.", "Shi, kongtiao kai zhe, ta zai xiuxi.", "Shi, wo yizhi gei ta song shui.", "Bu, ta hen hao."],
  },
};

/** Swaps the scripted user turns for a localized set when the recipient's locale has one. */
function localizeTurns(turns: ApiAttempt["transcript_turns"], scenario: Scenario, locale: string | null): ApiAttempt["transcript_turns"] {
  const base = (locale ?? "en").split(/[-_]/)[0]?.toLowerCase() ?? "en";
  const key: Scenario = scenario === "slow-green" ? "green" : scenario;
  const set = LOCALIZED_USER_TURNS[base]?.[key];
  if (!set) {
    return turns;
  }
  let i = 0;
  return turns.map((turn) => {
    if (turn.speaker !== "user") {
      return turn;
    }
    const text = set[i] ?? turn.text;
    i += 1;
    return { ...turn, text };
  });
}

function isEscalationSchema(schema: unknown): boolean {
  if (schema === null || typeof schema !== "object") {
    return false;
  }
  const properties = (schema as Json)["properties"];
  return properties !== null && typeof properties === "object" && "will_check" in (properties as Json);
}

interface Played {
  result: Json | null;
  summary: string;
  turns: ApiAttempt["transcript_turns"];
  attemptStatus: ApiAttempt["status"];
  recipientStatus: ApiRecipient["status"];
  failureCode: string | null;
}

function playTriage(scenario: Scenario, name: string): Played {
  const bot0 = { offset_seconds: 2, speaker: "bot" as const, text: `Hello, this is an automated welfare call. Am I speaking with ${name}?` };
  switch (scenario) {
    case "green":
    case "slow-green": {
      const offset = scenario === "slow-green" ? 23 : 2;
      return {
        result: { call_outcome: "completed", answered_by: "person", is_cool: "yes", hydrated: "yes", symptoms: ["none"], confusion_suspected: false, needs: ["none"], tier: "green", notes: "Feels fine, fan is on, has been drinking water." },
        summary: `${name} answered, is in a cool room with the fan on, has been drinking water, reports no symptoms and needs nothing.`,
        turns: [
          { ...bot0, offset_seconds: offset },
          { offset_seconds: offset + 4, speaker: "user", text: "Yes, this is me." },
          { offset_seconds: offset + 6, speaker: "bot", text: "Are you somewhere cool right now, and is your fan or air conditioning working?" },
          { offset_seconds: offset + 10, speaker: "user", text: "Yes, I am in the living room and the fan is on." },
          { offset_seconds: offset + 12, speaker: "bot", text: "Have you been drinking water today?" },
          { offset_seconds: offset + 14, speaker: "user", text: "Yes, plenty." },
          { offset_seconds: offset + 16, speaker: "bot", text: "Do you feel dizzy, sick, have a headache or cramps, or feel faint or confused?" },
          { offset_seconds: offset + 19, speaker: "user", text: "No, I feel fine." },
          { offset_seconds: offset + 21, speaker: "bot", text: "Is there anything you need?" },
          { offset_seconds: offset + 23, speaker: "user", text: "No, thank you for calling." },
        ],
        attemptStatus: "completed",
        recipientStatus: "completed",
        failureCode: null,
      };
    }
    case "yellow":
      return {
        result: { call_outcome: "completed", answered_by: "person", is_cool: "no", hydrated: "yes", symptoms: ["headache"], confusion_suspected: false, needs: ["fan_or_ac"], tier: "yellow", notes: "The fan stopped working this morning and the flat is very hot; has a headache." },
        summary: `${name} answered. The fan is broken and the home is hot; reports a headache; has been drinking water; would like a fan.`,
        turns: [
          bot0,
          { offset_seconds: 5, speaker: "user", text: "Yes." },
          { offset_seconds: 7, speaker: "bot", text: "Are you somewhere cool right now, and is your fan or air conditioning working?" },
          { offset_seconds: 11, speaker: "user", text: "The fan stopped working this morning. It is very hot in here." },
          { offset_seconds: 14, speaker: "bot", text: "Have you been drinking water today?" },
          { offset_seconds: 16, speaker: "user", text: "Yes, some." },
          { offset_seconds: 18, speaker: "bot", text: "Do you feel dizzy, sick, have a headache or cramps, or feel faint or confused?" },
          { offset_seconds: 22, speaker: "user", text: "I have a headache but I am not dizzy." },
          { offset_seconds: 25, speaker: "bot", text: "Is there anything you need: water, a fan, a ride to a cooling centre, medication, or someone to come by?" },
          { offset_seconds: 29, speaker: "user", text: "A fan would help. I cannot get to the shop." },
        ],
        attemptStatus: "completed",
        recipientStatus: "completed",
        failureCode: null,
      };
    case "red":
      return {
        result: { call_outcome: "completed", answered_by: "person", is_cool: "no", hydrated: "no", symptoms: ["dizziness", "faint", "nausea"], confusion_suspected: false, needs: ["someone_to_visit"], tier: "red", notes: "Feels dizzy and nearly fainted; no air conditioning; has not been drinking." },
        summary: `${name} answered but sounds unwell: dizzy, nearly fainted, nauseous, no air conditioning, not drinking water. Advised to call emergency services; asked for someone to come.`,
        turns: [
          bot0,
          { offset_seconds: 5, speaker: "user", text: "Yes... speaking." },
          { offset_seconds: 7, speaker: "bot", text: "Are you somewhere cool right now, and is your fan or air conditioning working?" },
          { offset_seconds: 12, speaker: "user", text: "No, there is no AC. It is like an oven." },
          { offset_seconds: 15, speaker: "bot", text: "Have you been drinking water today?" },
          { offset_seconds: 18, speaker: "user", text: "Not really, I feel sick to my stomach." },
          { offset_seconds: 21, speaker: "bot", text: "Do you feel dizzy or faint?" },
          { offset_seconds: 24, speaker: "user", text: "I am dizzy. I nearly fell over in the kitchen just now." },
          { offset_seconds: 28, speaker: "bot", text: "Those can be signs of heat stroke. Please call emergency services now or have someone nearby call for you. I am also alerting your emergency contact." },
          { offset_seconds: 35, speaker: "user", text: "Please send someone." },
        ],
        attemptStatus: "completed",
        recipientStatus: "completed",
        failureCode: null,
      };
    case "red-confusion":
      return {
        result: { call_outcome: "completed", answered_by: "person", is_cool: "unknown", hydrated: "unknown", symptoms: ["confusion"], confusion_suspected: true, needs: ["someone_to_visit"], tier: "yellow", notes: "Could not say what day it is and repeated the same sentence several times." },
        summary: `${name} answered but seemed confused, repeated themselves and could not say what day it is. Could not establish whether the home is cool.`,
        turns: [
          bot0,
          { offset_seconds: 6, speaker: "user", text: "Who is this? Is it Tuesday? Who is this?" },
          { offset_seconds: 9, speaker: "bot", text: "This is an automated welfare call. Can you tell me what day it is today?" },
          { offset_seconds: 14, speaker: "user", text: "It is... I do not know. My daughter said... who is this?" },
          { offset_seconds: 18, speaker: "bot", text: "That is all right. I am alerting your emergency contact so someone can come by. Please sit down somewhere cool." },
        ],
        attemptStatus: "completed",
        recipientStatus: "completed",
        failureCode: null,
      };
    case "caregiver":
      return {
        result: { call_outcome: "completed", answered_by: "other_person", is_cool: "yes", hydrated: "yes", symptoms: ["none"], confusion_suspected: false, needs: ["none"], tier: "green", notes: "Daughter answered; says her mother is resting in an air-conditioned room and drinking water." },
        summary: `${name}'s daughter answered and spoke for her: resting in an air-conditioned room, drinking water, no symptoms.`,
        turns: [
          bot0,
          { offset_seconds: 5, speaker: "user", text: "This is her daughter, I am with her now. I can answer for her." },
          { offset_seconds: 8, speaker: "bot", text: "Thank you. Is she somewhere cool, and is the air conditioning working?" },
          { offset_seconds: 11, speaker: "user", text: "Yes, the AC is on and she is resting." },
          { offset_seconds: 13, speaker: "bot", text: "Has she been drinking water today?" },
          { offset_seconds: 15, speaker: "user", text: "Yes, I keep bringing her water." },
          { offset_seconds: 17, speaker: "bot", text: "Any dizziness, headache, nausea, cramps, fainting or confusion?" },
          { offset_seconds: 20, speaker: "user", text: "No, she is fine." },
        ],
        attemptStatus: "completed",
        recipientStatus: "completed",
        failureCode: null,
      };
    case "voicemail":
      return {
        result: { call_outcome: "voicemail", answered_by: "voicemail", is_cool: "unknown", hydrated: "unknown", symptoms: [], confusion_suspected: false, needs: [], tier: "yellow", notes: "Voicemail answered; left the heat safety message." },
        summary: "Voicemail picked up. Left the welfare message.",
        turns: [{ offset_seconds: 3, speaker: "bot", text: "This is an automated welfare call because of the extreme heat. Please stay cool and drink water. We will try again shortly." }],
        attemptStatus: "completed",
        recipientStatus: "completed",
        failureCode: null,
      };
    case "declined":
      return {
        result: { call_outcome: "declined_now", answered_by: "person", is_cool: "unknown", hydrated: "unknown", symptoms: [], confusion_suspected: false, needs: [], tier: "yellow", notes: "Answered but said it was not a good time and asked to be called later." },
        summary: `${name} answered but said it was not a good time to talk and asked to be called later.`,
        turns: [bot0, { offset_seconds: 5, speaker: "user", text: "Hello? No, not now, I am at the doctor. Call me later." }, { offset_seconds: 8, speaker: "bot", text: "I am sorry for the timing. Please call nine one one if you feel dizzy, confused or faint. We will call again later. Thank you." }],
        attemptStatus: "completed",
        recipientStatus: "completed",
        failureCode: null,
      };
    case "unreachable":
      return {
        result: null,
        summary: "No answer after ringing.",
        turns: [],
        attemptStatus: "failed",
        recipientStatus: "failed",
        failureCode: "no_answer",
      };
    case "unverified":
      return {
        result: null,
        summary: "The call connected but the conversation was cut short before the questions were answered.",
        turns: [bot0, { offset_seconds: 5, speaker: "user", text: "Hello? Hello? I cannot hear you." }],
        attemptStatus: "completed",
        recipientStatus: "completed",
        failureCode: null,
      };
    default:
      return playTriage("green", name);
  }
}

function playEscalation(scenario: Scenario, name: string): Played {
  switch (scenario) {
    case "contact-decline":
      return {
        result: { reached: "yes", will_check: "no", eta_minutes: 0, wants_emergency_services: "no", notes: "Is out of town and cannot get there today." },
        summary: `${name} answered but is out of town and cannot check on the person today.`,
        turns: [
          { offset_seconds: 2, speaker: "bot", text: "Hello, this is an automated call. You are listed as the emergency contact." },
          { offset_seconds: 8, speaker: "user", text: "I am out of town this week, I cannot get there. Can someone else go?" },
        ],
        attemptStatus: "completed",
        recipientStatus: "completed",
        failureCode: null,
      };
    case "contact-no-answer":
      return { result: null, summary: "No answer.", turns: [], attemptStatus: "failed", recipientStatus: "failed", failureCode: "no_answer" };
    case "contact-ems":
      return {
        result: { reached: "yes", will_check: "yes", eta_minutes: 10, wants_emergency_services: "yes", notes: "Is going now and asked for an ambulance to be sent." },
        summary: `${name} is leaving now, about ten minutes away, and asked for emergency services to be sent as well.`,
        turns: [
          { offset_seconds: 2, speaker: "bot", text: "Hello, this is an automated call. You are listed as the emergency contact." },
          { offset_seconds: 9, speaker: "user", text: "Oh no. I am leaving right now, ten minutes. Please send an ambulance too." },
        ],
        attemptStatus: "completed",
        recipientStatus: "completed",
        failureCode: null,
      };
    case "contact-commit":
    default:
      return {
        result: { reached: "yes", will_check: "yes", eta_minutes: 15, wants_emergency_services: "no", notes: "Will drive over now, about fifteen minutes." },
        summary: `${name} answered and will drive over now, about fifteen minutes away.`,
        turns: [
          { offset_seconds: 2, speaker: "bot", text: "Hello, this is an automated call. You are listed as the emergency contact." },
          { offset_seconds: 8, speaker: "user", text: "Yes, I will go now. I am about fifteen minutes away." },
        ],
        attemptStatus: "completed",
        recipientStatus: "completed",
        failureCode: null,
      };
  }
}

async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > 0 ? (JSON.parse(text) as Json) : {};
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function error(res: ServerResponse, status: number, code: string, message: string): void {
  send(res, status, { error: { code, message, details: {} } });
}

export function startFakeCalleServer(options: FakeServerOptions = {}): Promise<FakeServerHandle> {
  const port = options.port ?? 4747;
  const queueDelayMs = options.queueDelayMs ?? 1200;
  const perRecipientMs = options.perRecipientMs ?? 900;
  const calls = new Map<string, ApiCall>();
  const events = new Map<string, ApiEvent[]>();
  const idempotency = new Map<string, string>();
  const timers = new Set<NodeJS.Timeout>();
  let failuresLeft = options.createFailures?.count ?? 0;

  const log = (message: string): void => {
    if (options.verbose) {
      process.stderr.write(`[fake-calle] ${message}\n`);
    }
  };

  const pushEvent = (call: ApiCall, level: ApiEvent["level"], type: string, message: string, details: Json = {}): void => {
    const list = events.get(call.id) ?? [];
    list.push({ id: id("evt"), type, call_id: call.id, created_at: now(), level, status: call.status, message, details });
    events.set(call.id, list);
  };

  const deliverWebhook = async (call: ApiCall, type: string): Promise<void> => {
    const url = typeof call.metadata["__webhook_url"] === "string" ? (call.metadata["__webhook_url"] as string) : null;
    if (url === null) {
      return;
    }
    const eventId = id("evt");
    const { __webhook_url: _omit, ...metadata } = call.metadata;
    const payload = { id: eventId, type, created_at: now(), data: { ...call, metadata } };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "CALL-E-Event-Id": eventId },
          body: JSON.stringify(payload),
        });
        if (response.ok) {
          log(`webhook ${type} delivered for ${call.id}`);
          return;
        }
        log(`webhook attempt ${attempt} for ${call.id} got ${response.status}`);
      } catch (err) {
        log(`webhook attempt ${attempt} for ${call.id} failed: ${(err as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  };

  const schedule = (fn: () => void, ms: number): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  const progress = (call: ApiCall): void => {
    const scenarios = (call.metadata["canopy_dry_run"] ?? {}) as Record<string, string>;
    const names = (call.metadata["canopy_names"] ?? {}) as Record<string, string>;
    const escalation = isEscalationSchema(call.metadata["__recipient_schema"]);
    schedule(() => {
      call.status = "in_progress";
      for (const recipient of call.recipients) {
        recipient.status = "in_progress";
        recipient.attempts.push({
          id: id("att"),
          phone: recipient.phones[0] ?? "",
          status: "dialing",
          started_at: now(),
          completed_at: null,
          summary: null,
          transcript_turns: [],
          provider_call_id: id("prov"),
          failure_code: null,
          failure_message: null,
        });
        pushEvent(call, "info", "call.dialing", `Dialing recipient ${recipient.id}`, { region: recipient.region, locale: recipient.locale });
      }
    }, queueDelayMs);

    schedule(() => {
      let green = 0;
      let yellow = 0;
      let red = 0;
      let notReached = 0;
      let firstOffset: number | null = null;
      for (const recipient of call.recipients) {
        const phone = recipient.phones[0] ?? "";
        const raw = scenarios[phone];
        const scenario: Scenario = (SCENARIOS as readonly string[]).includes(raw ?? "") ? (raw as Scenario) : escalation ? "contact-commit" : hashScenario(phone);
        const name = names[phone] ?? "the registered person";
        const played = escalation ? playEscalation(scenario, name) : playTriage(scenario, name);
        if (!escalation) {
          played.turns = localizeTurns(played.turns, scenario, recipient.locale);
        }
        const attempt = recipient.attempts[0];
        if (attempt) {
          attempt.status = played.attemptStatus;
          attempt.completed_at = now();
          attempt.summary = played.summary;
          attempt.transcript_turns = played.turns;
          attempt.failure_code = played.failureCode;
          attempt.failure_message = played.failureCode ? "The recipient did not answer." : null;
          const firstBot = played.turns.find((t) => t.speaker === "bot");
          if (firstBot && firstBot.offset_seconds !== null) {
            firstOffset = firstOffset === null ? firstBot.offset_seconds : Math.max(firstOffset, firstBot.offset_seconds);
          }
        }
        recipient.status = played.recipientStatus;
        recipient.structured_result = played.result;
        recipient.summary = played.summary;
        const tier = played.result?.["tier"];
        const answeredBy = played.result?.["answered_by"];
        if (played.recipientStatus !== "completed" || answeredBy === "voicemail" || answeredBy === "ivr") {
          notReached += 1;
        } else if (tier === "green") {
          green += 1;
        } else if (tier === "yellow") {
          yellow += 1;
        } else if (tier === "red") {
          red += 1;
        }
        pushEvent(call, played.recipientStatus === "completed" ? "info" : "warning", "recipient.completed", `Recipient ${recipient.id} ${played.recipientStatus}`, {});
      }
      const anyCompleted = call.recipients.some((r) => r.status === "completed");
      call.status = anyCompleted ? "completed" : "failed";
      call.completed_at = now();
      call.structured_result = escalation ? null : { green_count: green, yellow_count: yellow, red_count: red, not_reached_count: notReached };
      call.summary = `${call.recipients.length} recipient(s): ${green} green, ${yellow} yellow, ${red} red, ${notReached} not reached.`;
      call.task_completed = anyCompleted;
      const unverified = call.recipients.some((r) => r.status === "completed" && r.structured_result === null);
      call.completion_confidence = anyCompleted ? { score: unverified ? 0.42 : 0.91, label: unverified ? "low" : "high" } : { score: 0.1, label: "low" };
      call.evidence = call.recipients.flatMap((r) => r.attempts.flatMap((a) => a.transcript_turns.filter((t) => t.speaker === "user").slice(0, 1).map((t) => t.text)));
      if (!anyCompleted) {
        call.failure_code = "no_answer";
        call.failure_message = "No recipient answered.";
      }
      if (firstOffset !== null && firstOffset >= 20) {
        pushEvent(call, "warning", "call.silence", `First bot turn started at ${firstOffset}s`, { first_bot_turn_offset_seconds: firstOffset });
      }
      pushEvent(call, call.status === "completed" ? "info" : "error", call.status === "completed" ? "call.completed" : "call.failed", `Call ${call.status}`);
      void deliverWebhook(call, call.status === "completed" ? "call.completed" : "call.failed");
    }, queueDelayMs + perRecipientMs * Math.max(1, call.recipients.length));
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const auth = req.headers["authorization"] ?? "";
      if (!auth.startsWith("Bearer ")) {
        error(res, 401, "unauthorized", "Missing bearer token.");
        return;
      }
      log(`${req.method} ${url.pathname}`);
      if (req.method === "POST" && url.pathname === "/v1/calls") {
        const body = await readJson(req);
        if (failuresLeft > 0 && options.createFailures) {
          failuresLeft -= 1;
          res.setHeader("Retry-After", "1");
          error(res, options.createFailures.status, options.createFailures.code, "Injected failure for testing.");
          return;
        }
        const key = req.headers["idempotency-key"];
        if (typeof key === "string" && idempotency.has(key)) {
          const existing = calls.get(idempotency.get(key) ?? "");
          if (existing) {
            send(res, 200, existing);
            return;
          }
        }
        if (typeof body["task"] !== "string" || (body["task"] as string).trim().length === 0) {
          error(res, 400, "invalid_request", "task is required.");
          return;
        }
        const recipientsInput = Array.isArray(body["recipients"]) ? (body["recipients"] as Json[]) : [];
        if (recipientsInput.length === 0) {
          error(res, 400, "no_recipients", "recipients is required by the fake server.");
          return;
        }
        for (const r of recipientsInput) {
          const phones = Array.isArray(r["phones"]) ? (r["phones"] as unknown[]) : [];
          if (phones.length === 0 || !phones.every((p) => typeof p === "string" && E164_RE.test(p))) {
            error(res, 422, "invalid_phone", "Every recipient needs at least one E.164 phone.");
            return;
          }
        }
        const metadata = { ...((body["metadata"] as Json | undefined) ?? {}) };
        if (typeof body["webhook_url"] === "string") {
          metadata["__webhook_url"] = body["webhook_url"];
        }
        if (body["recipient_result_schema"] !== undefined) {
          metadata["__recipient_schema"] = body["recipient_result_schema"];
        }
        const call: ApiCall = {
          id: id("call"),
          object: "call_task",
          status: "queued",
          task: body["task"] as string,
          recipients: recipientsInput.map((r) => ({
            id: id("rcp"),
            phones: r["phones"] as string[],
            locale: typeof r["locale"] === "string" ? (r["locale"] as string) : null,
            region: typeof r["region"] === "string" ? (r["region"] as string) : null,
            status: "pending",
            structured_result: null,
            summary: null,
            attempts: [],
          })),
          structured_result: null,
          summary: null,
          task_completed: null,
          completion_confidence: null,
          evidence: [],
          metadata,
          failure_code: null,
          failure_message: null,
          created_at: now(),
          completed_at: null,
        };
        calls.set(call.id, call);
        if (typeof key === "string") {
          idempotency.set(key, call.id);
        }
        pushEvent(call, "info", "call.queued", "Call task accepted");
        progress(call);
        send(res, 201, publicView(call));
        return;
      }
      const match = url.pathname.match(/^\/v1\/calls\/(call_[A-Za-z0-9_-]+)(\/events)?$/);
      if (req.method === "GET" && match) {
        const call = calls.get(match[1] ?? "");
        if (!call) {
          error(res, 404, "not_found", "Unknown call id.");
          return;
        }
        if (match[2]) {
          send(res, 200, { object: "list", data: events.get(call.id) ?? [], next_cursor: null });
        } else {
          send(res, 200, publicView(call));
        }
        return;
      }
      error(res, 404, "not_found", `No route for ${req.method} ${url.pathname}`);
    } catch (err) {
      error(res, 500, "internal_error", (err as Error).message);
    }
  });

  function publicView(call: ApiCall): ApiCall {
    const { __webhook_url: _w, __recipient_schema: _s, ...metadata } = call.metadata;
    return { ...call, metadata };
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${boundPort}`,
        port: boundPort,
        server,
        callCount: () => calls.size,
        close: () =>
          new Promise<void>((done) => {
            for (const timer of timers) {
              clearTimeout(timer);
            }
            timers.clear();
            server.close(() => done());
          }),
      });
    });
  });
}
