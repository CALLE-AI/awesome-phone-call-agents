import type { Candidate, Provenance } from "./types";

/**
 * Candidate framing: turn directory sources into a list of candidates with
 * attributed phone numbers. No number is ever synthesized here — every
 * candidate carries a provenance record stating where it came from.
 */

const US_E164 = /^\+1[2-9]\d{9}$/;

/**
 * Normalize a US phone number as it appears in directories into E.164.
 * Accepts "+1 215 555 0100", "(215) 555-0100", "2155550100", "215-555-0100".
 * Returns null for anything that cannot be normalized — the caller must not
 * guess.
 */
export function normalizeUsPhone(input: string): string | null {
  const cleaned = input.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+1")) {
    return US_E164.test(cleaned) ? cleaned : null;
  }
  if (/^\d{10}$/.test(cleaned)) {
    return `+1${cleaned}`;
  }
  if (/^1\d{10}$/.test(cleaned)) {
    return `+1${cleaned.slice(1)}`;
  }
  return null;
}

export interface NppesResult {
  number: string;
  basic?: {
    first_name?: string;
    last_name?: string;
    organization_name?: string;
  };
  addresses?: Array<{
    address_purpose?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    telephone_number?: string;
  }>;
  taxonomies?: Array<{
    desc?: string;
    state?: string;
    primary?: boolean;
  }>;
}

export interface FrameNppesOptions {
  limit?: number;
  fetch?: typeof fetch;
}

const DEFAULT_FETCH = globalThis.fetch;

/**
 * Frame candidates from the NPPES NPI Registry.
 * NPPES data is directory data: it is exactly as stale and wrong as the
 * problem we solve. Candidates inherit `sourceUpdatedAt` so the product can
 * show how old the claim is. Verification happens on the phone, not here.
 */
export async function frameFromNppes(
  query: {
    city: string;
    state: string;
    taxonomy: string;
    limit?: number;
    /** Restrict to individuals (NPI-1) or organizations (NPI-2). Omit for both. */
    enumerationType?: "NPI-1" | "NPI-2";
  },
  options: FrameNppesOptions = {},
): Promise<Candidate[]> {
  const fetchFn = options.fetch ?? DEFAULT_FETCH;
  const params = new URLSearchParams({
    version: "2.1",
    city: query.city,
    state: query.state,
    limit: String(options.limit ?? query.limit ?? 40),
  });
  if (query.taxonomy) params.set("taxonomy_description", query.taxonomy);
  // Omit the enumeration type unless explicitly requested: individuals and
  // organizations both answer phones, and dropping NPI-2 organizations would
  // bias the candidate set toward solo practitioners.
  if (query.enumerationType) params.set("enumeration_type", query.enumerationType);

  const url = `https://npiregistry.cms.hhs.gov/api/?${params.toString()}`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`NPPES registry error: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { results?: NppesResult[] };

  const candidates: Candidate[] = [];
  for (const record of data.results ?? []) {
    const displayName =
      record.basic && (record.basic.organization_name ||
        [record.basic.first_name, record.basic.last_name].filter(Boolean).join(" "));
    const location = (record.addresses ?? []).find((a) => a.address_purpose === "LOCATION");
    const phone = location?.telephone_number ?? "";
    const e164 = normalizeUsPhone(phone);
    if (!e164) continue; // no usable number, skip; never guess
    const requestedTaxonomy = query.taxonomy.toLowerCase();
    const taxonomies = record.taxonomies ?? [];
    // Prefer the taxonomy that matches the filter so the listing is labelled
    // with what we actually asked for, not a record's unrelated primary.
    const matched = taxonomies.find((t) => t.desc?.toLowerCase().includes(requestedTaxonomy));
    const taxonomy = (matched ?? taxonomies.find((t) => t.primary))?.desc;

    candidates.push({
      id: `nppes-${record.number}`,
      name: displayName ?? "Unnamed provider",
      phoneE164: e164,
      phoneDisplay: phone,
      city: location?.city,
      state: location?.state,
      zip: location?.postal_code,
      specialty: taxonomy,
      provenance: { kind: "nppes", npi: record.number },
    });
  }
  return candidates;
}

export interface PastedRow {
  name: string;
  phone: string;
  note?: string;
}

/** Simple TSV/CSV-friendly parser for lines of "name<TAB>phone[<TAB>note]". */
export function parsePastedRows(text: string): PastedRow[] {
  const rows: PastedRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\t|,|;/).map((p) => p.trim());
    const [name = "", phone = "", note = ""] = parts;
    if (!phone) continue;
    rows.push({ name, phone, note });
  }
  return rows;
}

/** Frame candidates from pasted directory rows. Numbers are normalized or dropped. */
export function frameFromPaste(rows: PastedRow[], source: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const e164 = normalizeUsPhone(row.phone);
    if (!e164) continue;
    candidates.push({
      id: `paste-${i}-${e164}`,
      name: row.name || "Pasted entry",
      phoneE164: e164,
      phoneDisplay: row.phone,
      specialty: row.note || undefined,
      provenance: { kind: "paste", source, note: row.note || undefined },
    });
  }
  return candidates;
}

export function provenanceLabel(p: Provenance): string {
  switch (p.kind) {
    case "nppes":
      return `NPPES #${p.npi ?? "?"}`;
    case "paste":
      return `Pasted by ${p.source ?? "user"}`;
    case "csv":
      return "Imported CSV";
  }
}

/**
 * Mask a US E.164 number for display. Keeps the last 4 digits so the user can
 * still distinguish listings, but never exposes the full number in a summary.
 * Example: +12155550100 -> +1 (***) ***-0100
 * Idempotent: already-masked values are returned as-is.
 */
export function maskE164(phoneE164: string): string {
  if (phoneE164.includes("***")) return phoneE164;
  if (!US_E164.test(phoneE164)) return "***-****";
  const last4 = phoneE164.slice(-4);
  return `+1 (***) ***-${last4}`;
}

/** Mask a raw display number (best-effort); falls back to maskE164 when possible. */
export function maskDisplay(phoneDisplay: string, phoneE164: string): string {
  const masked = maskE164(phoneE164);
  // Preserve a hint of the original formatting length, but not the digits.
  if (phoneDisplay && phoneDisplay.trim()) return masked;
  return masked;
}
