import { z } from "zod";

export const missionSchema = z.object({
  title: z.string().min(3).max(120),
  targetName: z.string().min(2).max(120),
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/, "Use E.164 format, e.g. +15551234567"),
  category: z.enum(["appointment", "quote", "lead", "availability", "service", "followup"]),
  goal: z.string().min(8).max(1000),
  questions: z.array(z.string()).max(8).default([]),
  constraints: z.array(z.string()).max(8).default([]),
  desiredOutcome: z.string().max(500).default(""),
  safetyMode: z.enum(["info_only", "approval_required", "autonomous"]).default("approval_required"),
  demoMode: z.boolean().default(false),
});
export type MissionPayload = z.infer<typeof missionSchema>;

export function isE164(v: string) { return /^\+[1-9]\d{6,14}$/.test(v); }
