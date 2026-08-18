/**
 * Verticals — a dispute type is DATA, not code.
 *
 * Everything that distinguishes a security-deposit case from an unpaid-invoice
 * or freight-detention case lives in a JSON file under `config/`: the party
 * role labels the voice agent speaks, the default call policy (rounds, cooling
 * off, quiet hours, retry ladder, TTL), suggested non-monetary conditions, and
 * optional per-purpose guidance prose. The engine (state machine, renderer,
 * runner, ledger, attestation) never branches on the vertical id; opening a
 * case in a brand-new vertical is `loadVertical` + `caseInputForVertical` +
 * `createCase`, with zero code changes. `test/verticals.test.ts` proves it by
 * running full mock cases to "settled" in verticals the source tree has never
 * special-cased — including one invented inside the test itself.
 *
 * Validation is strict and loud: `validateVertical` uses zod strict objects
 * (unknown keys rejected), checks IANA timezones against the runtime's Intl
 * database, and reports every problem with its config path.
 *
 * HONEST LIMIT: `guidance` is declared, validated, and carried on the config,
 * but the prompt renderer (`src/renderer.ts`, whose fixed SCRIPT table is the
 * taint-audited prose surface) does not yet interpolate it into call tasks.
 * Wiring guidance into the renderer requires extending its template/vocabulary
 * tables and is tracked as a follow-up; nothing here pretends otherwise.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CasePolicy, Party, PartyId, PartyPrivate } from "./types.js";
import type { CreateCaseInput } from "./state.js";
import { formatUsd } from "./renderer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerticalRole {
  /** Spoken role label, prose-ready with article ("the landlord", "the carrier"). */
  label: string;
  /** One sentence describing which side of the money this party sits on. */
  description: string;
}

/**
 * Optional per-purpose guidance prose a renderer may include in call tasks.
 * Currently declarative only — see the module header's HONEST LIMIT note.
 */
export interface VerticalGuidance {
  consent?: string;
  shuttle?: string;
  attestation?: string;
}

export interface VerticalConfig {
  /** Kebab-case id; must equal the config filename stem and becomes `dispute.vertical`. */
  id: string;
  displayName: string;
  /** Noun phrase for the disputed money ("security deposit", "unpaid invoice"). */
  disputeNoun: string;
  partyRoles: { A: VerticalRole; B: VerticalRole };
  defaultPolicy: CasePolicy;
  /** Intake hints for common non-monetary conditions in this vertical. */
  suggestedConditions: string[];
  guidance?: VerticalGuidance;
}

/** Where the shipped configs live: `<repo>/config`, resolved relative to this module. */
export const DEFAULT_CONFIG_DIR = fileURLToPath(new URL("../config/", import.meta.url));

const ID_RE = /^[a-z][a-z0-9-]*$/;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class VerticalConfigError extends Error {
  readonly source: string;
  readonly issues: readonly string[];

  constructor(source: string, issues: readonly string[]) {
    super(`invalid vertical config (${source}): ${issues.join("; ")}`);
    this.name = "VerticalConfigError";
    this.source = source;
    this.issues = issues;
  }
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const roleSchema = z.strictObject({
  label: z.string().min(1),
  description: z.string().min(1),
});

const callWindowSchema = z
  .strictObject({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(24),
    timezone: z
      .string()
      .min(1)
      .refine(isValidTimeZone, {
        message: 'must be a valid IANA timezone (e.g. "America/New_York")',
      }),
  })
  .refine((w) => w.startHour !== w.endHour, {
    message: "startHour and endHour must differ (an equal pair is an empty, undialable window)",
  });

const policySchema = z.strictObject({
  maxRounds: z.number().int().min(1).max(100),
  coolingOffMinutes: z.number().int().min(0).max(24 * 60),
  callWindow: callWindowSchema,
  retryDelaysMinutes: z.array(z.number().int().min(0).max(7 * 24 * 60)).max(8),
  ttlHours: z.number().positive().max(24 * 365),
});

const guidanceSchema = z.strictObject({
  consent: z.string().min(1).optional(),
  shuttle: z.string().min(1).optional(),
  attestation: z.string().min(1).optional(),
});

const verticalSchema = z.strictObject({
  id: z.string().regex(ID_RE, 'must be kebab-case: lowercase letters, digits, hyphens ("unpaid-invoice")'),
  displayName: z.string().min(1),
  disputeNoun: z.string().min(1),
  partyRoles: z.strictObject({ A: roleSchema, B: roleSchema }),
  defaultPolicy: policySchema,
  suggestedConditions: z.array(z.string().min(1)),
  guidance: guidanceSchema.optional(),
});

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

/**
 * Validates an arbitrary value as a VerticalConfig. Throws
 * {@link VerticalConfigError} listing every problem with its config path
 * (e.g. `defaultPolicy.callWindow.startHour: Too big...`).
 */
export function validateVertical(value: unknown, source = "inline value"): VerticalConfig {
  const parsed = verticalSchema.safeParse(value);
  if (!parsed.success) {
    throw new VerticalConfigError(source, formatIssues(parsed.error));
  }
  const d = parsed.data;
  const g = d.guidance;
  const guidance: VerticalGuidance | undefined =
    g === undefined
      ? undefined
      : {
          ...(g.consent === undefined ? {} : { consent: g.consent }),
          ...(g.shuttle === undefined ? {} : { shuttle: g.shuttle }),
          ...(g.attestation === undefined ? {} : { attestation: g.attestation }),
        };
  return {
    id: d.id,
    displayName: d.displayName,
    disputeNoun: d.disputeNoun,
    partyRoles: {
      A: { label: d.partyRoles.A.label, description: d.partyRoles.A.description },
      B: { label: d.partyRoles.B.label, description: d.partyRoles.B.description },
    },
    defaultPolicy: {
      maxRounds: d.defaultPolicy.maxRounds,
      coolingOffMinutes: d.defaultPolicy.coolingOffMinutes,
      callWindow: {
        startHour: d.defaultPolicy.callWindow.startHour,
        endHour: d.defaultPolicy.callWindow.endHour,
        timezone: d.defaultPolicy.callWindow.timezone,
      },
      retryDelaysMinutes: [...d.defaultPolicy.retryDelaysMinutes],
      ttlHours: d.defaultPolicy.ttlHours,
    },
    suggestedConditions: [...d.suggestedConditions],
    ...(guidance === undefined ? {} : { guidance }),
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Ids of every `.json` config in `dir` whose filename is a well-formed vertical id. */
export function listVerticalIds(dir: string = DEFAULT_CONFIG_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter((stem) => ID_RE.test(stem))
    .sort();
}

/**
 * Loads and validates `<dir>/<id>.json`. The id is validated BEFORE touching
 * the filesystem (no path traversal), and the config's own `id` field must
 * match the filename stem — a mismatch is a copy-paste bug, reported loudly.
 */
export function loadVertical(id: string, dir: string = DEFAULT_CONFIG_DIR): VerticalConfig {
  if (!ID_RE.test(id)) {
    throw new VerticalConfigError(id, [
      `vertical id must be kebab-case (lowercase letters, digits, hyphens), got ${JSON.stringify(id)}`,
    ]);
  }
  const file = join(dir, `${id}.json`);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const available = listVerticalIds(dir);
      throw new VerticalConfigError(file, [
        `no such vertical "${id}"; available: ${available.length > 0 ? available.join(", ") : "(none)"}`,
      ]);
    }
    throw err;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    throw new VerticalConfigError(file, [`not valid JSON: ${(err as Error).message}`]);
  }
  const config = validateVertical(value, file);
  if (config.id !== id) {
    throw new VerticalConfigError(file, [
      `config id "${config.id}" does not match filename id "${id}"`,
    ]);
  }
  return config;
}

/** Loads and validates every vertical config in `dir`, sorted by id. */
export function listVerticals(dir: string = DEFAULT_CONFIG_DIR): VerticalConfig[] {
  return listVerticalIds(dir).map((id) => loadVertical(id, dir));
}

// ---------------------------------------------------------------------------
// One-call case opening
// ---------------------------------------------------------------------------

export interface VerticalPartyInput {
  /** Person or business name spoken on calls ("Dana Whitfield", "Sunrise Logistics"). */
  name: string;
  /** E.164 phone. Every fixture/test/screenshot number must be fictional (+1555... style). */
  phone: string;
  /** Party-private intake data (reservation bound, notes). Never crosses parties. */
  private?: PartyPrivate;
}

export interface VerticalCaseParams {
  caseId: string;
  /** Total amount in dispute, integer cents. */
  amountCents: number;
  partyA: VerticalPartyInput;
  partyB: VerticalPartyInput;
  /** Neutral one-sentence dispute summary; defaults to {@link defaultSummary}. */
  summary?: string;
  /** Field-level overrides of the vertical's default policy (callWindow replaced wholesale). */
  policy?: Partial<CasePolicy>;
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

/** The generated dispute summary when the caller does not supply one. */
export function defaultSummary(config: VerticalConfig, amountCents: number): string {
  return (
    `Disputed ${config.disputeNoun} of ${formatUsd(amountCents)} between ` +
    `${config.partyRoles.A.label} and ${config.partyRoles.B.label}.`
  );
}

/**
 * Builds a ready-to-use `CreateCaseInput` from a vertical config plus the
 * case-specific facts (amount, names, phones), so opening a case in any
 * vertical is one call: `createCase(caseInputForVertical(config, params))`.
 *
 * Party labels combine the given name with the vertical's role label —
 * "Dana Whitfield (the landlord)" — which is what the voice agent speaks.
 */
export function caseInputForVertical(
  config: VerticalConfig,
  params: VerticalCaseParams,
): CreateCaseInput {
  const problems: string[] = [];
  if (params.caseId.trim().length === 0) problems.push("caseId must be non-empty");
  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
    problems.push(`amountCents must be a positive integer of cents, got ${params.amountCents}`);
  }
  for (const [id, p] of [
    ["A", params.partyA],
    ["B", params.partyB],
  ] as const) {
    if (p.name.trim().length === 0) problems.push(`party ${id}: name must be non-empty`);
    if (!E164_RE.test(p.phone)) {
      problems.push(`party ${id}: phone must be E.164 ("+15550000001" style), got ${JSON.stringify(p.phone)}`);
    }
  }
  if (params.partyA.phone === params.partyB.phone) {
    problems.push("parties must have distinct phone numbers");
  }
  if (problems.length > 0) {
    throw new VerticalConfigError(`case "${params.caseId}" in vertical "${config.id}"`, problems);
  }

  const party = (id: PartyId, input: VerticalPartyInput, role: VerticalRole): Party => ({
    id,
    label: `${input.name.trim()} (${role.label})`,
    phone: input.phone,
    private: input.private ?? {},
  });

  return {
    caseId: params.caseId,
    dispute: {
      vertical: config.id,
      summary: params.summary ?? defaultSummary(config, params.amountCents),
      amountCents: params.amountCents,
      currency: "USD",
    },
    parties: [
      party("A", params.partyA, config.partyRoles.A),
      party("B", params.partyB, config.partyRoles.B),
    ],
    policy: { ...config.defaultPolicy, ...params.policy },
  };
}
