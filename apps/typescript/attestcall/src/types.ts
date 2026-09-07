/**
 * AttestCall domain types and the strict CALL-E result schema.
 *
 * The result schema is what we hand to CALL-E as `resultSchema`. CALL-E
 * validates the recipient's spoken answers against it and returns a
 * `structuredResult` matching this shape (or leaves fields absent when the
 * call could not establish them). We deliberately model "unknown" as a
 * first-class answer so the agent never has to guess.
 */

export type Framework = "PCI-DSS" | "SOC2-TYPE2" | "ISO-27001" | "HIPAA" | "GDPR";

/** A yes/no/unknown answer. "unknown" is a real, expected outcome. */
export type Ternary = "yes" | "no" | "unknown";

/** How AttestCall classifies the overall call outcome. Fail-closed by design. */
export type Disposition =
  | "attested" // recipient affirmatively attested with evidence
  | "not_attested" // recipient said they are NOT compliant / declined to attest
  | "needs_human" // ambiguous, low confidence, refused, unreachable, or schema gap
  | "call_failed"; // CALL-E could not complete the call

/** The attestation subject: who we are calling and what we are asking about. */
export interface AttestationRequest {
  /** Vendor / partner organization name (for disclosure + record). */
  vendorName: string;
  /** E.164 phone number of the vendor's compliance / security contact. */
  vendorPhone: string;
  /** The compliance framework being attested. */
  framework: Framework;
  /** Optional reference the caller already has on file (contract/PO id). */
  referenceId?: string;
  /** Region hint for CALL-E dialing (ISO country code, e.g. "US"). */
  region?: string;
  /** Locale hint for CALL-E (e.g. "en-US"). */
  locale?: string;
  /** Who is requesting the attestation (disclosed on the call). */
  requestedBy: string;
}

/**
 * The structured result CALL-E returns for one attestation call.
 * Mirrors the JSON Schema below.
 */
export interface AttestationAnswers {
  /** Did the recipient confirm they are currently compliant with the framework? */
  is_compliant: Ternary;
  /** Certificate / attestation expiry date if stated (ISO 8601 date or null). */
  cert_expiry_date: string | null;
  /** Name of the auditor / assessor firm if stated (or null). */
  auditor_name: string | null;
  /** Name/role of the person who answered and made the statement (or null). */
  attesting_contact: string | null;
  /** Did the recipient consent to this attestation being recorded? */
  consent_to_record: Ternary;
  /** Any scope caveats the recipient stated (free text, or null). */
  scope_caveats: string | null;
}

/**
 * JSON Schema handed to CALL-E as `resultSchema`. Strict: every property is
 * declared, "unknown"/null are valid, and the four load-bearing fields are
 * required so CALL-E is pushed to explicitly resolve them.
 */
export const ATTESTATION_RESULT_SCHEMA = {
  type: "object",
  required: ["is_compliant", "consent_to_record", "cert_expiry_date", "auditor_name"],
  additionalProperties: false,
  properties: {
    is_compliant: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Did the recipient explicitly confirm the organization is currently compliant with the named framework? Use 'unknown' if not clearly established.",
    },
    cert_expiry_date: {
      type: ["string", "null"],
      description:
        "The certificate or attestation expiry date the recipient stated, as an ISO 8601 date (YYYY-MM-DD). Null if not stated.",
    },
    auditor_name: {
      type: ["string", "null"],
      description: "The auditor or assessor firm the recipient named. Null if not stated.",
    },
    attesting_contact: {
      type: ["string", "null"],
      description: "Name and/or role of the person who answered and made the statement. Null if not stated.",
    },
    consent_to_record: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Did the recipient consent to this attestation being recorded for compliance purposes? 'unknown' if not clearly answered.",
    },
    scope_caveats: {
      type: ["string", "null"],
      description: "Any scope limitations the recipient stated (e.g. 'only for the EU region'). Null if none.",
    },
  },
} as const;

/** One immutable, hash-chained audit record entry. */
export interface AuditRecord {
  /** Monotonic index in the chain (0-based). */
  index: number;
  /** ISO timestamp when this record was sealed. */
  sealedAt: string;
  /** The attestation request (phone masked). */
  request: Omit<AttestationRequest, "vendorPhone"> & { vendorPhoneMasked: string };
  /** Final disposition after applying fail-closed rules. */
  disposition: Disposition;
  /** The structured answers (may be partial). */
  answers: Partial<AttestationAnswers>;
  /** CALL-E's completion confidence, if any. */
  completionConfidence: { score: number; label: string } | null;
  /** Evidence quotes CALL-E grounded its answers in. */
  evidence: string[];
  /** CALL-E call id (or a demo id in fixture mode). */
  callId: string;
  /** CALL-E call status. */
  callStatus: string;
  /** Whether this was a real call or a fixture/demo call. */
  mode: "live" | "demo";
  /** Hash of the previous record ("GENESIS" for index 0). */
  prevHash: string;
  /** SHA-256 hash of this record's canonical content + prevHash. */
  hash: string;
}
