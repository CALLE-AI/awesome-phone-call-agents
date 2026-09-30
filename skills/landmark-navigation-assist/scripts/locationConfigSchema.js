import { z } from "zod";

// Mirrors references/location-config.schema.json (source of truth for the
// shape, and useful if you want the schema in a non-JS context too). Kept
// in sync by hand — small and stable, not worth generating this from it.
export const locationConfigSchema = z.object({
  config_id: z.string(),
  version: z.literal("1.0"),

  address: z.object({
    label: z.string(),
    formal_address: z.string(),
    city: z.string(),
    region_code: z.string(),
  }),

  landmark: z.object({
    name: z.string(),
    type: z.string().optional(),
    disambiguation_note: z.string().optional(),
  }),

  building_description: z.object({
    distinguishing_features: z.array(z.string()),
    height_or_type: z.string().optional(),
  }),

  approach_from: z
    .array(
      z.object({
        direction_label: z.string(),
        instructions: z.string(),
        landmark_sequence: z.array(z.string()).optional(),
      }),
    )
    .min(1),

  entrance_details: z.object({
    location: z.string(),
    identifying_marks: z.string(),
    access_notes: z.string().optional(),
  }),

  units: z
    .array(
      z.object({
        unit_identifier: z.string(),
        floor: z.string().optional(),
        in_building_directions: z.string(),
        consignee_name: z.string().optional(),
      }),
    )
    .optional(),

  // Resolves entirely within the call — no method field, no downstream
  // action. contact is data the call-task instruction reads aloud.
  escalation: z.object({
    trigger_conditions: z.array(z.string()),
    contact: z.object({
      contact_name: z.string(),
      recipient_phone: z.string(),
    }),
  }),

  language: z.object({
    locale: z.string(),
    allow_code_switch: z.boolean().default(true),
  }),

  metadata: z
    .object({
      created_at: z.string().optional(),
      last_verified_at: z.string().optional(),
    })
    .optional(),
});
