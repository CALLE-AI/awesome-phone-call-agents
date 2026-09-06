// Hazard playbooks and task rendering.
//
// A playbook is a JSON file describing one hazard: what triggers it, the four questions,
// the red flags, the public-health advice, and the escalation wording. The `task` string
// that CALL-E receives is rendered from the playbook plus the person's own facts, so the
// conversation is goal-driven, not scripted line by line.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HazardEvent, HazardId, Outcome, Person } from "./types.js";
import { HAZARD_IDS } from "./types.js";

export interface Playbook {
  id: HazardId;
  title: string;
  /** Plain noun spoken in the disclosure and used in default headlines, e.g. "extreme heat". */
  hazard_noun: string;
  /** true when delay costs lives; only life-safety playbooks may override quiet hours. */
  life_safety: boolean;
  triggers: {
    nws_events: string[];
    open_meteo: { apparent_temperature_c_at_least: number } | null;
    /** Singapore NEA 24-hour PSI threshold (data.gov.sg). */
    nea_psi?: { psi_24h_at_least: number } | null;
  };
  purpose: string;
  questions: string[];
  confusion_probe: string;
  red_flags: string[];
  advice: string[];
  red_flag_instruction: string;
  resource_label: string;
  follow_up_hours: number;
  voicemail_message: string;
  escalation_reason_templates: { red: string; unreachable: string; unverified: string };
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PLAYBOOK_DIR = join(HERE, "..", "playbooks");

export function loadPlaybooks(dir: string = DEFAULT_PLAYBOOK_DIR): Map<HazardId, Playbook> {
  const playbooks = new Map<HazardId, Playbook>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as Playbook;
    validatePlaybook(parsed, file);
    playbooks.set(parsed.id, parsed);
  }
  return playbooks;
}

export function loadPlaybook(hazard: HazardId, dir: string = DEFAULT_PLAYBOOK_DIR): Playbook {
  const playbook = loadPlaybooks(dir).get(hazard);
  if (!playbook) {
    throw new Error(`No playbook for hazard ${hazard} in ${dir}`);
  }
  return playbook;
}

export function validatePlaybook(playbook: Playbook, file = "playbook"): void {
  if (!HAZARD_IDS.includes(playbook.id)) {
    throw new Error(`${file}: unknown hazard id ${String(playbook.id)}`);
  }
  if (!Array.isArray(playbook.questions) || playbook.questions.length < 3 || playbook.questions.length > 5) {
    throw new Error(`${file}: a playbook needs three to five questions`);
  }
  if (typeof playbook.hazard_noun !== "string" || playbook.hazard_noun.trim().length === 0) {
    throw new Error(`${file}: hazard_noun is required`);
  }
  if (typeof playbook.life_safety !== "boolean") {
    throw new Error(`${file}: life_safety must be true or false`);
  }
  if (!playbook.red_flag_instruction.includes("{{emergency_number}}")) {
    throw new Error(`${file}: red_flag_instruction must recite {{emergency_number}}`);
  }
  if (!playbook.voicemail_message.includes("{{org}}")) {
    throw new Error(`${file}: voicemail_message must name {{org}}`);
  }
  if (typeof playbook.follow_up_hours !== "number" || playbook.follow_up_hours <= 0) {
    throw new Error(`${file}: follow_up_hours must be a positive number`);
  }
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  ta: "Tamil",
  es: "Spanish",
  zh: "Mandarin Chinese",
  ms: "Malay",
  fr: "French",
  pt: "Portuguese",
  ar: "Arabic",
  bn: "Bengali",
  ur: "Urdu",
  vi: "Vietnamese",
  ja: "Japanese",
  de: "German",
  pl: "Polish",
  id: "Indonesian",
  tl: "Filipino",
  th: "Thai",
  tr: "Turkish",
  ko: "Korean",
  it: "Italian",
  nl: "Dutch",
  si: "Sinhala",
  uk: "Ukrainian",
  he: "Hebrew",
  fi: "Finnish",
  sw: "Swahili",
};

export function languageName(locale: string): string {
  const base = locale.split(/[-_]/)[0]?.toLowerCase() ?? "en";
  return LANGUAGE_NAMES[base] ?? "English";
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

function ageBand(age: number | null): string {
  if (age === null) {
    return "an adult";
  }
  if (age >= 85) {
    return "in their late eighties or older";
  }
  if (age >= 75) {
    return "in their late seventies or early eighties";
  }
  if (age >= 65) {
    return "in their sixties or early seventies";
  }
  return "an adult";
}

/** The disclosure line every call opens with. Kept in one place so it cannot drift between playbooks. */
export function disclosureLine(org: string, hazardNoun: string): string {
  return `Hello, this is an automated welfare call from ${org}. You signed up for check-in calls during emergencies like this ${hazardNoun.toLowerCase()}. This will take about one minute. Is now okay?`;
}

/** Renders the CALL-E task for one wave. The same task serves every recipient in the wave; the locale hint per recipient sets the language. */
export function renderWaveTask(playbook: Playbook, event: HazardEvent, people: Person[]): string {
  const vars = { org: event.org, emergency_number: event.emergencyNumber, area: event.area };
  const roster = people
    .map((p) => `- ${p.name} (${languageName(p.locale)}, ${ageBand(p.age)}${p.livesAlone ? ", lives alone" : ""})`)
    .join("\n");
  const lines: string[] = [
    `You are placing welfare calls on behalf of ${event.org} during an emergency: ${event.headline} in ${event.area}.`,
    `Goal: ${playbook.purpose}. Speak slowly, warmly and patiently; many recipients are elderly. Keep each call under three minutes.`,
    "",
    "Each recipient is a different registered person. Match the recipient to the roster below by the phone number you dialled and use their name. Speak in the language given for that recipient, and switch if they answer in another language.",
    roster,
    "",
    `Open with exactly this disclosure, translated into the recipient's language: "${disclosureLine(event.org, playbook.hazard_noun)}"`,
    "If someone other than the registered person answers, ask whether they can speak for that person right now; if yes, continue with them and record answered_by as other_person. If voicemail answers, leave this message and end the call:",
    `"${fill(playbook.voicemail_message, vars)}"`,
    "",
    "Ask these questions in order, one at a time, and wait for the answer:",
    ...playbook.questions.map((q, i) => `${i + 1}. ${q}`),
    playbook.confusion_probe,
    "",
    `Warning signs (red flags): ${playbook.red_flags.join("; ")}.`,
    fill(playbook.red_flag_instruction, vars),
    "",
    "If the person is uncomfortable but has no red flags, offer this practical advice briefly:",
    ...playbook.advice.map((a) => `- ${fill(a, vars)}`),
    event.resource !== null ? `If they need a ${playbook.resource_label}, tell them: ${event.resource}.` : "",
    "",
    `Boundaries: you are not a medical professional. Do not diagnose, do not discuss medication doses, and do not argue. If asked who you are, say you are an automated assistant calling for ${event.org}. Never promise a visit; say that a person from ${event.org} will follow up if needed. Do not ask for or record any payment, account or identity details.`,
    "",
    "Close by thanking them, reminding them of the most relevant advice line, and saying goodbye. Then fill in the structured result for that recipient exactly as the schema describes.",
  ];
  return lines.filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n");
}

/** Renders the CALL-E task for an escalation call to an emergency contact or volunteer. */
export function renderEscalationTask(
  playbook: Playbook,
  event: HazardEvent,
  person: Person,
  outcome: Outcome,
  reasons: string[],
  attempts: number,
): string {
  const contactName = person.contactName ?? "the emergency contact";
  const templateKey: "red" | "unreachable" | "unverified" = outcome === "red" ? "red" : outcome === "unreachable" ? "unreachable" : "unverified";
  const reason = fill(playbook.escalation_reason_templates[templateKey], {
    reasons: reasons.join(", "),
    attempts: String(attempts),
  });
  const lines: string[] = [
    `You are calling ${contactName} on behalf of ${event.org} during an emergency: ${event.headline} in ${event.area}.`,
    `Speak in ${languageName(person.contactLocale ?? person.locale)}; switch if they answer in another language. Keep the call under two minutes.`,
    `Open with: "Hello, this is an automated call from ${event.org}. You are listed as the emergency contact for ${person.name}, who is registered for welfare checks during emergencies. Is now okay?"`,
    `Explain: ${person.name} ${reason}.`,
    "Ask: Can you go and check on them, or phone them, right now? If yes, ask roughly how many minutes until you can reach them.",
    outcome === "red"
      ? `Because warning signs were reported, say that if they believe an ambulance is needed they should call ${event.emergencyNumber} themselves, and ask whether they want ${event.org} to alert emergency services as well.`
      : `If they cannot reach the person within an hour, say that ${event.org} will send someone to knock on the door.`,
    "Share only the facts above. Do not share any other health, address or identity details. Do not diagnose or give medical advice. If voicemail answers, leave a short message asking them to check on the person and end the call.",
    "Close by thanking them, then fill in the structured result exactly as the schema describes.",
  ];
  return lines.join("\n");
}
