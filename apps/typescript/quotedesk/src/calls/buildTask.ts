// RequestedSpec -> CALL-E task text + result schemas.
//
// The recipient_result_schema is STRICT: additionalProperties false,
// no $ref/oneOf/anyOf/allOf, flat explicitly named fields, simple
// array.items only. Reserved names (summary, status, transcript, call_id,
// timing fields) are never used — the summary field is quote_summary.

import type { RequestedSpec } from '../types.js';

export function buildTaskText(spec: RequestedSpec, companyName: string): string {
  const parts: string[] = [];
  if (spec.gpu) parts.push(`the ${spec.gpu} graphics card`);
  if (spec.ramGb) parts.push(`${spec.ramGb} GB RAM`);
  if (spec.storageGb) parts.push(`${storageLabel(spec.storageGb)} storage`);
  const configLine = parts.length ? ` with ${parts.join(', ')}` : '';

  return [
    `This is an automated call from ${companyName} purchasing. I am an AI assistant calling to check stock and price on one item. This call may be summarised for our records.`,
    `We need the ${spec.family}${configLine}, quantity ${spec.quantity}.`,
    `Please tell me your exact part number for that configuration, and explicitly confirm the graphics card model, the RAM size, and the storage size on that part number. I need each of those three read back to me, because a nearby configuration is not acceptable.`,
    `Then please tell me your unit price, how many units you have available, and the delivery time in days.`,
    `Please read the part number and the unit price back to me digit by digit before we finish.`,
    `If the exact configuration is not available, say so plainly; do not substitute a different configuration. Thank you.`,
  ].join(' ');
}

function storageLabel(gb: number): string {
  return gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`;
}

const CONFIDENCE = {
  type: 'string',
  enum: ['confirmed', 'heard_once', 'unstated'],
  description:
    "confirmed = the callee read the value back or explicitly confirmed it; heard_once = said once, never read back; unstated = never said. If you cannot point at a transcript span for a field, it is unstated.",
} as const;

function field(desc: string, type: 'string' | 'number' = 'string') {
  return { type, description: desc } as const;
}

/** Per-recipient extraction schema. Every substantive field travels with the
 * transcript span that supports it and a confidence level. */
export function buildRecipientResultSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      part_number: field('Exact part number quoted, exactly as spoken.'),
      part_number_quote: field('Verbatim transcript span supporting part_number.'),
      family: field('Product family/model name the callee stated they are quoting.'),
      family_quote: field('Verbatim transcript span supporting family.'),
      family_confidence: CONFIDENCE,
      cpu: field('CPU model on the quoted part, if stated.'),
      cpu_quote: field('Verbatim transcript span supporting cpu.'),
      cpu_confidence: CONFIDENCE,
      gpu: field('Graphics card model on the quoted part, e.g. "RTX 5080".'),
      gpu_quote: field('Verbatim transcript span supporting gpu.'),
      gpu_confidence: CONFIDENCE,
      ram_gb: field('RAM in GB on the quoted part.', 'number'),
      ram_quote: field('Verbatim transcript span supporting ram_gb.'),
      ram_confidence: CONFIDENCE,
      storage_gb: field('Storage in GB on the quoted part (1 TB = 1024).', 'number'),
      storage_quote: field('Verbatim transcript span supporting storage_gb.'),
      storage_confidence: CONFIDENCE,
      panel: field('Display panel description, if stated.'),
      panel_quote: field('Verbatim transcript span supporting panel.'),
      panel_confidence: CONFIDENCE,
      unit_price: field('Unit price as a number, no currency symbol.', 'number'),
      price_quote: field('Verbatim transcript span supporting unit_price.'),
      price_confidence: CONFIDENCE,
      quantity_available: field('Units available, if stated.', 'number'),
      eta_days: field('Delivery time in days, if stated.', 'number'),
      eta_quote: field('Verbatim transcript span supporting eta_days.'),
      eta_confidence: CONFIDENCE,
      answered_by: {
        type: 'string',
        enum: ['human', 'ivr', 'voicemail', 'unknown'],
        description: 'Who or what answered the call.',
      },
      quote_summary: field('One-sentence summary of what this distributor offered.'),
    },
  };
}

/** Cross-distributor rollup schema for the whole call task. */
export function buildResultSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      distributors_reached: field('How many distributors a human answered for.', 'number'),
      distributors_quoted: field('How many distributors gave a usable price.', 'number'),
      lowest_quoted_price: field('Lowest unit price heard on any call, as a number.', 'number'),
      any_configuration_doubt: {
        type: 'string',
        description:
          'One sentence if any distributor seemed to be quoting a different configuration than asked; empty string otherwise.',
      },
    },
  };
}
