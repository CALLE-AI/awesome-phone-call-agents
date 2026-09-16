import cooperative from "../fixtures/cooperative.json" with { type: "json" };
import emergency from "../fixtures/emergency.json" with { type: "json" };
import gatekeeper from "../fixtures/gatekeeper.json" with { type: "json" };
import hostile from "../fixtures/hostile.json" with { type: "json" };
import ivrMaze from "../fixtures/ivr_maze.json" with { type: "json" };
import partial from "../fixtures/partial.json" with { type: "json" };
import unsupportedClaim from "../fixtures/unsupported_claim.json" with { type: "json" };
import voicemail from "../fixtures/voicemail.json" with { type: "json" };
import wrongPerson from "../fixtures/wrong_person.json" with { type: "json" };
import type { PersonaFixture, PersonaId } from "./types";

const FIXTURES: Record<PersonaId, PersonaFixture> = {
  cooperative: cooperative as PersonaFixture,
  voicemail: voicemail as PersonaFixture,
  partial: partial as PersonaFixture,
  emergency: emergency as PersonaFixture,
  wrong_person: wrongPerson as PersonaFixture,
  gatekeeper: gatekeeper as PersonaFixture,
  ivr_maze: ivrMaze as PersonaFixture,
  hostile: hostile as PersonaFixture,
  unsupported_claim: unsupportedClaim as PersonaFixture,
};

export function loadFixture(id: PersonaId): PersonaFixture {
  return FIXTURES[id];
}

export function listPersonaIds(): PersonaId[] {
  return Object.keys(FIXTURES) as PersonaId[];
}

export function pickPersona(request: Record<string, unknown>): PersonaId {
  const metadata = (request.metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata.persona === "string" && metadata.persona in FIXTURES) {
    return metadata.persona as PersonaId;
  }
  const recipients = (request.recipients ?? []) as Array<{ phones?: string[] }>;
  const phone = recipients[0]?.phones?.[0] ?? "";
  if (phone.endsWith("01")) return "cooperative";
  if (phone.endsWith("02")) return "voicemail";
  if (phone.endsWith("03")) return "partial";
  if (phone.endsWith("04")) return "emergency";
  if (phone.endsWith("05")) return "wrong_person";
  if (phone.endsWith("06")) return "gatekeeper";
  if (phone.endsWith("07")) return "ivr_maze";
  if (phone.endsWith("08")) return "hostile";
  if (phone.endsWith("09")) return "unsupported_claim";
  return "cooperative";
}
