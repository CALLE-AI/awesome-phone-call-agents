// The comparison matrix. Runs with zero CALL-E credentials and zero calls.

import { describe, expect, it } from 'vitest';
import { compareSpecs, eligibleForQuote, humanReviewReason } from '../src/identity/compare.js';
import { normalizeName } from '../src/identity/fields.js';
import type { QuotedSpec, RequestedSpec } from '../src/types.js';

const requested: RequestedSpec = {
  rfqId: 'RFQ-TEST-1',
  family: 'Predator Helios 16 AI',
  gpu: 'RTX 5080',
  ramGb: 32,
  storageGb: 2048,
  quantity: 12,
  rawEmail: 'test',
};

function quote(overrides: Partial<QuotedSpec>): QuotedSpec {
  // A fully confirmed, fully matching quote; tests override fields downward.
  return {
    distributorId: 'D-TEST',
    family: 'Acer Predator Helios 16 AI',
    family_confidence: 'confirmed',
    gpu: 'NVIDIA GeForce RTX 5080 Laptop GPU',
    gpu_confidence: 'confirmed',
    ram_gb: 32,
    ram_confidence: 'confirmed',
    storage_gb: 2048,
    storage_confidence: 'confirmed',
    unit_price: 245000,
    price_confidence: 'confirmed',
    eta_days: 7,
    eta_confidence: 'confirmed',
    answered_by: 'human',
    ...overrides,
  };
}

describe('normalizeName', () => {
  it('strips vendor noise so marketing names compare equal', () => {
    expect(normalizeName('NVIDIA GeForce RTX 5080 Laptop GPU')).toBe(normalizeName('RTX 5080'));
    expect(normalizeName('rtx-5080')).toBe(normalizeName('RTX 5080'));
  });
  it('keeps genuinely different models apart', () => {
    expect(normalizeName('RTX 5080')).not.toBe(normalizeName('RTX 5070'));
    expect(normalizeName('RTX 5080')).not.toBe(normalizeName('GTX 5080'));
  });
});

describe('compareSpecs — verdict matrix', () => {
  it('verified_match when every requested critical field is confirmed equal', () => {
    const r = compareSpecs(requested, quote({}));
    expect(r.verdict).toBe('verified_match');
    expect(r.mismatchedFields).toEqual([]);
  });

  it('wrong_configuration when the GPU is confirmed different (the demo case)', () => {
    const r = compareSpecs(requested, quote({ gpu: 'RTX 5070', gpu_quote: 'that one has the 5070' }));
    expect(r.verdict).toBe('wrong_configuration');
    expect(r.mismatchedFields).toEqual(['gpu']);
  });

  it('wrong_configuration when RAM is confirmed different', () => {
    const r = compareSpecs(requested, quote({ ram_gb: 16 }));
    expect(r.verdict).toBe('wrong_configuration');
    expect(r.mismatchedFields).toEqual(['ramGb']);
  });

  it('unverified when a critical field is unstated — unstated is never a match', () => {
    const r = compareSpecs(requested, quote({ gpu: undefined, gpu_confidence: undefined }));
    expect(r.verdict).toBe('unverified');
    expect(r.unverifiedFields).toEqual(['gpu']);
  });

  it('unverified when a critical field has confidence unstated even if a value is present', () => {
    const r = compareSpecs(requested, quote({ gpu_confidence: 'unstated' }));
    expect(r.verdict).toBe('unverified');
  });

  it('unverified when a critical field was only heard_once, even if it matches', () => {
    const r = compareSpecs(requested, quote({ gpu_confidence: 'heard_once' }));
    expect(r.verdict).toBe('unverified');
    expect(r.unverifiedFields).toEqual(['gpu']);
  });

  it('a confirmed mismatch outranks other unverified fields', () => {
    const r = compareSpecs(
      requested,
      quote({ gpu: 'RTX 5070', ram_gb: undefined, ram_confidence: undefined }),
    );
    expect(r.verdict).toBe('wrong_configuration');
  });

  it('fields the customer did not specify are not compared', () => {
    const noCpuRequested = { ...requested }; // cpu undefined
    const r = compareSpecs(noCpuRequested, quote({ cpu: undefined, cpu_confidence: undefined }));
    expect(r.verdict).toBe('verified_match');
  });

  it('soft field mismatch flags but does not change the verdict', () => {
    const withPanel = { ...requested, panel: 'OLED 240Hz' };
    const r = compareSpecs(withPanel, quote({ panel: 'IPS 165Hz', panel_confidence: 'confirmed' }));
    expect(r.verdict).toBe('verified_match');
    expect(r.softMismatchedFields).toEqual(['panel']);
  });

  it('an empty quote (voicemail / no extraction) is unverified, not an error', () => {
    const r = compareSpecs(requested, { distributorId: 'D-TEST', answered_by: 'voicemail' });
    expect(r.verdict).toBe('unverified');
    expect(r.unverifiedFields).toEqual(['family', 'gpu', 'ramGb', 'storageGb']);
  });
});

describe('eligibleForQuote — the misheard-number guard', () => {
  it('eligible only when verified_match and price+eta are confirmed', () => {
    const q = quote({});
    expect(eligibleForQuote(compareSpecs(requested, q), q)).toBe(true);
  });

  it('heard_once price is NOT eligible: forty-two five vs forty-two fifty', () => {
    const q = quote({ price_confidence: 'heard_once' });
    expect(eligibleForQuote(compareSpecs(requested, q), q)).toBe(false);
    expect(humanReviewReason(compareSpecs(requested, q), q)).toMatch(/read back/);
  });

  it('heard_once eta is NOT eligible', () => {
    const q = quote({ eta_confidence: 'heard_once' });
    expect(eligibleForQuote(compareSpecs(requested, q), q)).toBe(false);
  });

  it('wrong_configuration is never eligible regardless of price confidence', () => {
    const q = quote({ gpu: 'RTX 5070' });
    expect(eligibleForQuote(compareSpecs(requested, q), q)).toBe(false);
    expect(humanReviewReason(compareSpecs(requested, q), q)).toMatch(/different configuration/);
  });

  it('missing price is not eligible even when confirmed flag is present', () => {
    const q = quote({ unit_price: undefined });
    expect(eligibleForQuote(compareSpecs(requested, q), q)).toBe(false);
  });
});
