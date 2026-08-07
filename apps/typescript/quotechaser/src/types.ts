export interface QuoteRequest {
  request_id: string;
  buyer: {
    business_name: string;
    contact_name: string;
  };
  item: {
    name: string;
    quantity: number;
    must_haves: string[];
  };
  vendors: Vendor[];
  max_disclosure: string[];
  policy: {
    locale: string;
    allow_voicemail: boolean;
  };
}

export interface Vendor {
  name: string;
  phone: string;
  source: string;
}

export type QuoteOutcome =
  | "quote_received"
  | "not_available"
  | "callback_needed"
  | "unreachable"
  | "outcome_unknown";

export interface VendorQuote {
  vendor_name: string;
  outcome: QuoteOutcome;
  unit_price: number | null;
  total_price: number | null;
  currency: string | null;
  availability: string;
  lead_time: string;
  minimum_order: string;
  callback_required: boolean;
  evidence: string[];
}

export interface QuoteReport {
  request_id: string;
  generated_at: string;
  calls_placed: number;
  quotes: VendorQuote[];
}

export interface CalleCallResult {
  status?: string;
  taskCompleted?: boolean;
  task_completed?: boolean;
  structuredResult?: unknown;
  structured_result?: unknown;
  evidence?: unknown;
}
