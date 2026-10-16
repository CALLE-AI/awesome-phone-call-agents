import { z } from 'zod';

export const CANDIDATE_SOURCES = ['osm', 'google_places', 'web_search', 'user_supplied'] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export const openingHoursSchema = z.object({
  /** Raw provider string, kept verbatim for evidence. */
  raw: z.string().max(400).nullable().default(null),
  openNow: z.boolean().nullable().default(null),
});
export type OpeningHours = z.infer<typeof openingHoursSchema>;

export const candidateSourceRefSchema = z.object({
  source: z.enum(CANDIDATE_SOURCES),
  sourceId: z.string().max(200).nullable().default(null),
  sourceUrl: z.string().max(500).nullable().default(null),
  /** What this particular source contributed, e.g. "phone", "address". */
  contributed: z.array(z.string().max(40)).default([]),
  retrievedAt: z.string(),
});
export type CandidateSourceRef = z.infer<typeof candidateSourceRefSchema>;

export const businessCandidateSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  category: z.string().max(80).nullable().default(null),
  address: z.string().max(400).nullable().default(null),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  /** E.164 only. Anything that fails normalisation is stored as null, never guessed. */
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/).nullable().default(null),
  phoneRaw: z.string().max(60).nullable().default(null),
  website: z.string().max(500).nullable().default(null),
  source: z.enum(CANDIDATE_SOURCES),
  sourceUrl: z.string().max(500).nullable().default(null),
  rating: z.number().min(0).max(5).nullable().default(null),
  reviewCount: z.number().int().nonnegative().nullable().default(null),
  distanceMeters: z.number().nonnegative().nullable().default(null),
  openingHours: openingHoursSchema.nullable().default(null),
  phoneVerified: z.boolean().default(false),
  verificationSources: z.array(candidateSourceRefSchema).default([]),
});
export type BusinessCandidate = z.infer<typeof businessCandidateSchema>;

/** A candidate plus the ranking decision made about it, so the UI can explain itself. */
export const rankedCandidateSchema = z.object({
  candidate: businessCandidateSchema,
  score: z.number(),
  reasons: z.array(z.string().max(200)).default([]),
  /** Set when the candidate was filtered out before calling. */
  excludedReason: z.string().max(200).nullable().default(null),
});
export type RankedCandidate = z.infer<typeof rankedCandidateSchema>;
