import { compile, runValidator, type ValidationOutcome } from "./validate.js";

/**
 * First Notice of Loss (FNOL) intake schema.
 *
 * Two shapes are defined:
 *  - `fnolTransmitSchema` is the compact schema handed to CALL-E as
 *    `resultSchema` (documented supported subset: types, enums, required).
 *  - `fnolStrictSchema` adds stricter local checks (formats, bounded arrays)
 *    used AFTER the call to validate what actually came back.
 */
export const FNOL_SCHEMA_VERSION = "fnol.v1";

export const INCIDENT_TYPES = [
  "auto_collision",
  "auto_theft",
  "property_water",
  "property_fire",
  "property_theft",
  "injury",
  "other",
] as const;

const YES_NO_UNKNOWN = ["yes", "no", "unknown"] as const;

export const fnolTransmitSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["incident_type", "injuries", "consent_recorded"],
  properties: {
    incident_type: { type: "string", enum: INCIDENT_TYPES },
    incident_datetime: { type: "string" },
    incident_location: { type: "string" },
    description: { type: "string" },
    injuries: { type: "string", enum: YES_NO_UNKNOWN },
    damaged_items: { type: "array", items: { type: "string" } },
    other_party_involved: { type: "string", enum: YES_NO_UNKNOWN },
    police_report_filed: { type: "string", enum: YES_NO_UNKNOWN },
    preferred_callback_window: { type: "string" },
    consent_recorded: { type: "boolean" },
  },
};

export const fnolStrictSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "incident_type",
    "description",
    "injuries",
    "consent_recorded",
  ],
  properties: {
    incident_type: { type: "string", enum: INCIDENT_TYPES },
    incident_datetime: { type: "string", maxLength: 64 },
    incident_location: { type: "string", maxLength: 240 },
    description: { type: "string", minLength: 1, maxLength: 2000 },
    injuries: { type: "string", enum: YES_NO_UNKNOWN },
    damaged_items: {
      type: "array",
      items: { type: "string", maxLength: 120 },
      maxItems: 50,
    },
    other_party_involved: { type: "string", enum: YES_NO_UNKNOWN },
    police_report_filed: { type: "string", enum: YES_NO_UNKNOWN },
    preferred_callback_window: { type: "string", maxLength: 120 },
    consent_recorded: { type: "boolean" },
  },
};

const validateStrict = compile(fnolStrictSchema);

export function validateFnolResult(data: unknown): ValidationOutcome {
  return runValidator(validateStrict, data);
}

export interface FnolResult {
  incident_type: (typeof INCIDENT_TYPES)[number];
  incident_datetime?: string;
  incident_location?: string;
  description: string;
  injuries: (typeof YES_NO_UNKNOWN)[number];
  damaged_items?: string[];
  other_party_involved?: (typeof YES_NO_UNKNOWN)[number];
  police_report_filed?: (typeof YES_NO_UNKNOWN)[number];
  preferred_callback_window?: string;
  consent_recorded: boolean;
}
