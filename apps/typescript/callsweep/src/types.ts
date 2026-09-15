// Core domain types for Callsweep.

export type Vendor = {
  name: string;
  phoneE164: string;   // E.164, e.g. +14155550100
  region?: string;     // ISO country, defaults to US
  address?: string;    // street address from the directory, if known
  // metadata from the directory step (optional)
  rating?: number;
  distanceKm?: number;
};

// What we ask each vendor for in round 1.
// The GOAL defines the request (today / Friday 8pm / in stock); `available`
// just answers yes/no to whatever was asked, so this type stays generic.
export type Quote = {
  vendor: string;
  phoneE164: string;
  region?: string;                        // ISO country carried from the vendor, for the booking call
  answered: boolean;
  price: number | null;                   // final (negotiated) price; null if not given / not applicable
  openingPrice?: number;                  // first price quoted, before haggling (if higher than final)
  available: "yes" | "no" | "unknown";    // can they meet the request?
  availableDetail: string;                // "today, 15 min wait", "Fri 8pm", "3 in stock"
  etaMinutes: number | null;              // minutes until served, if same-day (for "soonest")
  includes: string[];                     // free extras thrown in, e.g. ["wash"]; [] = base only
  address?: string;                       // carried from the vendor, if known
  notes: string;
  refused?: boolean;                      // wouldn't quote over the phone
};
