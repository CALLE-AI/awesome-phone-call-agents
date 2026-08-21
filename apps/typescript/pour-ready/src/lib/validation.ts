import {
  REGION_CONFIG,
  ROLES,
  type ContactInput,
  type ContactRole,
  type LiveRunInput,
  type PourPlan,
  type Region,
} from "./domain";

const E164 = /^\+[1-9]\d{7,14}$/;
const RUN_ID = /^[a-zA-Z0-9-]{8,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (typeof value !== "string") throw new InputError(`${name} is required.`);
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > maxLength) {
    throw new InputError(`${name} must be 1-${maxLength} characters.`);
  }
  return clean;
}

function parsePlan(value: unknown): PourPlan {
  const input = record(value, "plan");
  const region = input.region;
  if (region !== "AU" && region !== "SG") {
    throw new InputError("Region must be AU or SG.");
  }
  const scheduledDate = text(input.scheduledDate, "Scheduled date", 10);
  const scheduledTime = text(input.scheduledTime, "Scheduled time", 5);
  if (!DATE.test(scheduledDate)) {
    throw new InputError("Scheduled date must use YYYY-MM-DD.");
  }
  if (!TIME.test(scheduledTime)) {
    throw new InputError("Scheduled time must use 24-hour HH:MM.");
  }

  return {
    companyName: text(input.companyName, "Company name", 80),
    projectName: text(input.projectName, "Project name", 100),
    location: text(input.location, "Location", 120),
    scheduledDate,
    scheduledTime,
    volumeM3: text(input.volumeM3, "Volume", 20),
    mixReference: text(input.mixReference, "Mix reference", 80),
    region,
  };
}

function parseContacts(value: unknown, region: Region): ContactInput[] {
  if (!Array.isArray(value) || value.length !== ROLES.length) {
    throw new InputError("Exactly four role contacts are required.");
  }
  const seen = new Set<ContactRole>();
  const contacts = value.map((item, index) => {
    const input = record(item, `Contact ${index + 1}`);
    if (
      typeof input.role !== "string" ||
      !ROLES.includes(input.role as ContactRole)
    ) {
      throw new InputError(`Contact ${index + 1} has an invalid role.`);
    }
    const role = input.role as ContactRole;
    if (seen.has(role)) throw new InputError(`Role ${role} is duplicated.`);
    seen.add(role);

    const phone = text(input.phone, `${role} phone`, 20);
    if (!E164.test(phone)) {
      throw new InputError(`${role} phone must use E.164 format.`);
    }
    if (!phone.startsWith(REGION_CONFIG[region].phonePrefix)) {
      throw new InputError(
        `${role} phone must match the ${region} project region.`,
      );
    }
    return {
      role,
      name: text(input.name, `${role} name`, 80),
      phone,
    };
  });

  if (!ROLES.every((role) => seen.has(role))) {
    throw new InputError("Every required role must appear exactly once.");
  }
  return contacts;
}

export function validateLiveRunInput(value: unknown): LiveRunInput {
  const input = record(value, "request");
  if (input.liveConfirmed !== true) {
    throw new InputError("Explicit live-call confirmation is required.");
  }
  const runId = text(input.runId, "Run id", 64);
  if (!RUN_ID.test(runId)) {
    throw new InputError("Run id is invalid.");
  }
  const plan = parsePlan(input.plan);
  return {
    runId,
    liveConfirmed: true,
    plan,
    contacts: parseContacts(input.contacts, plan.region),
  };
}

export function idempotencyKey(
  runId: string,
  role: ContactRole,
): string {
  return `pour-ready:${runId}:${role}`;
}
