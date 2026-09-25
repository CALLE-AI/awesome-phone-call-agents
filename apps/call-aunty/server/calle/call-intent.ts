import { z } from "zod";
import { callPurposeSchema, triageStateSchema } from "./types";

export const callIntentSchema = z.object({
  purpose: callPurposeSchema,
  womanRef: z.string().min(1).max(128),
  recipientRef: z.string().regex(/^\+[1-9]\d{7,14}$/),
  recipientRegion: z.string().min(2).max(8),
  callLanguage: z.string().min(2).max(16),
  callerRole: z.enum(["chw", "admin"]).default("chw"),
  triageState: triageStateSchema.default("contact_chw_today"),
  consentGranted: z.boolean(),
  consentSource: z.enum(["woman_record", "chw_attestation", "unknown"]).optional(),
  consentRecordedAt: z.string().datetime().optional(),
  objective: z.string().max(256).optional(),
});
export type CallIntent = z.infer<typeof callIntentSchema>;

export function intentFromPrepare(input: {
  womanId: string;
  purpose: z.infer<typeof callPurposeSchema>;
  recipientE164: string;
  recipientRegion: string;
  callLanguage: string;
  triageState: z.infer<typeof triageStateSchema>;
  callConsentGranted: boolean;
  consentSource?: CallIntent["consentSource"];
  consentRecordedAt?: string;
}): CallIntent {
  return callIntentSchema.parse({
    purpose: input.purpose,
    womanRef: input.womanId,
    recipientRef: input.recipientE164,
    recipientRegion: input.recipientRegion,
    callLanguage: input.callLanguage,
    callerRole: "chw",
    triageState: input.triageState,
    consentGranted: input.callConsentGranted,
    consentSource: input.consentSource ?? (input.callConsentGranted ? "chw_attestation" : "unknown"),
    consentRecordedAt: input.consentRecordedAt,
    objective: input.purpose,
  });
}
