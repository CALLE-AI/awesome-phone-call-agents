// Shared helpers. No side effects, no network, no dialling.

import { readFileSync } from 'node:fs';

export const E164 = /^\+[1-9]\d{7,14}$/;

/** A number is usable only if it is E.164 AND carries a published source. */
export function validateOffice(office) {
  const problems = [];
  if (!office) return ['office not found in the seed file'];
  if (!office.phone_e164) problems.push('no phone_e164');
  else if (!E164.test(office.phone_e164)) problems.push(`not E.164: ${office.phone_e164}`);
  if (!office.source_url) problems.push('no source_url — a number needs a published source');
  if (!office.source_checked) problems.push('no source_checked date');
  if (String(office.phone_e164 ?? '').includes('X')) problems.push('placeholder number');
  return problems;
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

/** Flags that take no value. Anything else consumes the token after it. */
export const BOOLEAN_FLAGS = new Set(['live', 'plan', 'report']);

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
