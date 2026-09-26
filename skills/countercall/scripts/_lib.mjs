// Shared helpers. No side effects, no network, no dialling.

import { readFileSync } from 'node:fs';

export const E164 = /^\+[1-9]\d{7,14}$/;

/** A number is usable only if it is E.164 AND carries a published source. */
export function validateOffice(office) {
  const problems = [];
  if (!office) return ['office not found in the seed file'];
  if (!office.phone_e164) problems.push('no phone_e164');
  else if (!E164.test(office.phone_e164)) problems.push(`not E.164: ${maskPhone(office.phone_e164)}`);
  if (!office.source_url) problems.push('no source_url — a number needs a published source');
  if (!office.source_checked) problems.push('no source_checked date');
  if (String(office.phone_e164 ?? '').includes('X')) problems.push('placeholder number');
  return problems;
}

/**
 * Mask a phone number for display: the first three characters and the last three digits
 * survive, every digit between them becomes `*`. `+442079460123` prints as `+44*******123`,
 * enough to tell two offices apart and not enough to dial.
 *
 * Numbers are masked at the point of printing, never in the request itself: the dialler
 * still needs the whole number, and the terminal, the scrollback and a pasted log do not.
 */
export function maskPhone(phone) {
  const s = String(phone ?? '');
  if (s.replace(/\D/g, '').length < 8) return s.replace(/\d/g, '*');
  return s.slice(0, 3) + s.slice(3, -3).replace(/\d/g, '*') + s.slice(-3);
}

// Phone-like runs. With a leading `+`, 8 or more digits, wherever they appear: a vendor code
// such as `sip_486_to_+442079460123` still carries a dialable number. Without one, 9 or more
// digits standing alone: nine keeps dates (2026-09-26, eight digits) and the idempotency key
// readable, and the lookarounds keep digits inside run ids and hashes out of it.
const PHONE_PLUS = /\+\d[\d\s().-]{6,}\d/g;
const PHONE_BARE = /(?<![\w.+*])\d[\d\s().-]{7,}\d(?![\w.])/g;
// Matching control characters is the point of these three, so no-control-regex is off for them.
/* eslint-disable no-control-regex */
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const CONTROL_KEEP_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;
/* eslint-enable no-control-regex */
const CREDENTIALS = [
  /\b(Bearer|Basic)\s+[\w.~+/=-]+/gi,
  /\b((?:api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
];
const MAX_LENGTH = 500;

/**
 * Make provider and error text safe to print.
 *
 * Anything that did not come from this repo — an SDK error message, a vendor failure code, a
 * value quoted back from a result — can carry a phone number, a credential echoed back by a
 * proxy, or terminal escape sequences. This removes all three, flattens it to one line and
 * caps its length. `secrets` are exact values to redact wherever they appear, such as the
 * API key in use.
 */
export function sanitizeText(text, { secrets = [] } = {}) {
  let s = String(text ?? '');
  for (const secret of secrets) {
    if (secret && String(secret).length >= 4) s = s.split(String(secret)).join('[redacted]');
  }
  s = s.replace(ANSI, '').replace(/[\r\n\t]+/g, ' ').replace(CONTROL, '');
  s = s.replace(CREDENTIALS[0], '$1 [redacted]').replace(CREDENTIALS[1], '$1[redacted]');
  const digits = (match) => match.replace(/\D/g, '').length;
  s = s.replace(PHONE_PLUS, (m) => (digits(m) >= 8 ? maskPhone(m) : m));
  s = s.replace(PHONE_BARE, (m) => (digits(m) >= 9 ? maskPhone(m) : m));
  return s.length > MAX_LENGTH ? `${s.slice(0, MAX_LENGTH)}... [truncated]` : s;
}

/**
 * Replace the dialled number with its mask in every string of a value, at any depth. For
 * output this repo composed itself, such as the dry-run request, where nothing but the
 * destination needs hiding and the rest must print exactly as it will be sent.
 */
export function maskDestination(value, destination) {
  if (!destination) return value;
  if (typeof value === 'string') return value.split(destination).join(maskPhone(destination));
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => maskDestination(v, destination));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, maskDestination(v, destination)]),
  );
}

/**
 * Clean a validated result for the card. Mask phone-like text (including a different
 * callback number), credentials and terminal controls in provider text. Keep document
 * line breaks; the display copy is redacted, not a verbatim evidence archive.
 */
export function cleanResult(result, destination) {
  const strip = (v) => (typeof v === 'string'
    ? v.replace(ANSI, '').replace(CONTROL_KEEP_NEWLINE, '').split('\n').map((line) => sanitizeText(line)).join('\n')
    : v);
  const stripped = Object.fromEntries(Object.entries(result).map(([k, v]) => [k, strip(v)]));
  return maskDestination(stripped, destination);
}

/**
 * Read the published RunSpec off a Goal in either casing.
 *
 * The wire format is snake_case (`published_run_spec.result_schema`) and the Python SDK
 * hands back raw dicts, but the TypeScript SDK camelCases its surface
 * (`publishedRunSpec.resultSchema`). Reading only one of them is how the drift guard
 * silently reports "no spec" against a perfectly healthy Goal and refuses every dial.
 */
export function publishedRunSpec(goal) {
  const spec = goal?.publishedRunSpec ?? goal?.published_run_spec;
  if (!spec) return null;
  return {
    id: spec.id,
    version: spec.version,
    inputSchema: spec.inputSchema ?? spec.input_schema ?? null,
    resultSchema: spec.resultSchema ?? spec.result_schema ?? null,
  };
}

/** Compare a pinned contract against the live published RunSpec. Any drift refuses the dial. */
export function diffContract(pinned, published) {
  const drift = [];
  if (!published) return ['no published RunSpec on the live Goal'];

  const resultSchema = published.resultSchema ?? published.result_schema ?? null;
  if (!resultSchema) return ['published RunSpec carries no result schema'];

  if (pinned.version !== published.version)
    drift.push(`version ${pinned.version} -> ${published.version}`);

  const live = Object.keys(resultSchema.properties ?? {});
  for (const field of pinned.result_fields) {
    if (!live.includes(field)) drift.push(`removed field: ${field}`);
  }
  for (const field of live) {
    if (!pinned.result_fields.includes(field)) drift.push(`new field: ${field}`);
  }
  if (resultSchema.additionalProperties !== false)
    drift.push('additionalProperties is no longer false');
  return drift;
}

/** Business-stable key: one office, one procedure, one day. */
export function idempotencyKey(officeId, procedure, date) {
  const slug = procedure.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `countercall:${officeId}:${slug}:${date}:v1`;
}

/**
 * Load the office seed file — the shipped one, or a fixture via `--offices <path>`.
 * The flag exists so the dry-run and refuse-to-dial paths can be tested against known
 * data instead of against whatever the seed file happens to contain today.
 */
export function loadOffices(args, importMetaUrl) {
  const source = args.offices
    ? new URL(args.offices, `file://${process.cwd()}/`)
    : new URL('../data/offices.json', importMetaUrl);
  return JSON.parse(readFileSync(source, 'utf8'));
}

/**
 * Flags that take no value. Anything else consumes the token after it.
 *
 * `write` and `json` were missing here, which made `verify_live.mjs --write` a silent no-op:
 * with no token after it, `--write` parsed as `undefined`, the falsy check skipped the write,
 * and the command exited 0 having done nothing. DEMO.md documented that command as the way to
 * fill its verification block, so the block stayed a placeholder while the tool reported
 * success. A flag that quietly means its own opposite is worse than a missing flag.
 */
export const BOOLEAN_FLAGS = new Set(['live', 'plan', 'report', 'write', 'json']);

export function parseArgs(argv) {
  const args = { live: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const name = a.slice(2);
    // A boolean flag must never swallow the next token — `--plan --offices x` once
    // parsed as `plan: "--offices"`, which silently ignored the fixture path.
    if (BOOLEAN_FLAGS.has(name)) args[name] = true;
    else args[name] = argv[++i];
  }
  return args;
}
