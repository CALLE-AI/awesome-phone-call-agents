// Data contracts for QuoteDesk. Locked first per the build plan; everything
// else is downstream of these shapes.

export type Confidence = 'confirmed' | 'heard_once' | 'unstated';

export interface RequestedSpec {
  rfqId: string;
  family: string;          // "Predator Helios 16 AI" — a family, not a SKU
  cpu?: string;
  gpu?: string;            // "RTX 5080"
  ramGb?: number;
  storageGb?: number;
  panel?: string;
  quantity: number;
  neededBy?: string;       // ISO date
  sourceUrl?: string;
  rawEmail: string;
}

// Mirrors the CALL-E recipient_result_schema, which is STRICT:
// additionalProperties false, no $ref/oneOf/anyOf/allOf, flat explicitly
// named fields only. Reserved names (summary, status, transcript, call_id,
// timing fields) are avoided — hence quote_summary, not summary.
export interface QuotedSpec {
  distributorId: string;
  part_number?: string;
  part_number_quote?: string;
  family?: string;
  family_quote?: string;
  family_confidence?: Confidence;
  cpu?: string;
  cpu_quote?: string;
  cpu_confidence?: Confidence;
  gpu?: string;
  gpu_quote?: string;           // transcript span supporting gpu
  gpu_confidence?: Confidence;
  ram_gb?: number;
  ram_quote?: string;
  ram_confidence?: Confidence;
  storage_gb?: number;
  storage_quote?: string;
  storage_confidence?: Confidence;
  panel?: string;
  panel_quote?: string;
  panel_confidence?: Confidence;
  unit_price?: number;
  price_quote?: string;
  price_confidence?: Confidence;
  quantity_available?: number;
  eta_days?: number;
  eta_quote?: string;
  eta_confidence?: Confidence;
  answered_by?: 'human' | 'ivr' | 'voicemail' | 'unknown';  // no built-in AMD
  quote_summary?: string;
}

export type IdentityVerdict =
  | 'verified_match'        // every critical field confirmed equal
  | 'wrong_configuration'   // at least one critical field confirmed different
  | 'unverified';           // any critical field unstated or heard_once

export interface QuoteRow {
  distributorId: string;
  verdict: IdentityVerdict;
  mismatchedFields: string[];
  softMismatchedFields: string[];
  quoted: QuotedSpec;
  landedCost?: number;
  customerPrice?: number;
  eligibleForQuote: boolean;   // verdict === 'verified_match'
                               // AND price confirmed AND eta confirmed
  humanReviewReason?: string;
}

export interface Distributor {
  id: string;
  name: string;
  city: string;
  // E.164 number is NEVER stored in fixtures. Live mode reads it from the
  // environment variable named here; all output shows maskedPhone only.
  phoneEnv: string;
  maskedPhone: string;
}

export interface MarketConfig {
  market: 'IN' | 'US';
  currency: string;
  currencySymbol: string;
  distributorCurrency: string;
  fxRate: number;              // distributorCurrency -> currency, hardcoded by design
  customsDutyPct: number;
  igstPct: number;
  freightPerUnit: number;      // in target currency
  forexBufferPct: number;
  marginPct: number;
  whyPhone: string;
}

export interface LedgerEntry {
  ts: string;
  type: string;
  payload: unknown;
  prev_hash: string;
  hash: string;
}
