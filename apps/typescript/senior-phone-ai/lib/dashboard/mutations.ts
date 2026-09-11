import { z } from "zod";

const uuid = z.string().uuid();
const profileSchema = z.object({ action: z.literal("update_profile"), seniorId: uuid, displayName: z.string().trim().min(1).max(100), timezone: z.string().trim().min(1).max(100), approximateLocation: z.string().trim().max(160).optional().default("") }).strict();
const preferencesSchema = z.object({ action: z.literal("update_preferences"), seniorId: uuid, storeTranscripts: z.boolean(), storeSummaries: z.boolean(), retentionDays: z.number().int().min(1).max(365) }).strict();
const cancelSchema = z.object({ action: z.literal("cancel_reminder"), seniorId: uuid, reminderId: uuid }).strict();
export const familyMutationSchema = z.discriminatedUnion("action", [profileSchema, preferencesSchema, cancelSchema]);
export type FamilyMutation = z.infer<typeof familyMutationSchema>;

export function parseFamilyMutation(value: unknown): FamilyMutation {
  const parsed = familyMutationSchema.parse(value);
  if (parsed.action === "update_profile") {
    try { new Intl.DateTimeFormat("en", { timeZone: parsed.timezone }).format(); }
    catch { throw new Error("timezone must be a valid IANA timezone"); }
  }
  return parsed;
}
