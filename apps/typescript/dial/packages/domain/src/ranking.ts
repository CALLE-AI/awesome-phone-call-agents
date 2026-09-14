import type { BusinessCandidate, RankedCandidate, DialTask } from '@dial/schemas';
import { businessNameKey } from './phone.js';

/**
 * Section 14: rank *before* calling. Every call costs money and rings a real
 * business, so the ordering here is what keeps Dial from dialling twenty shops
 * when four good ones answer the question.
 */

export interface RankingOptions {
  task: Pick<DialTask, 'constraints' | 'location'>;
  now?: Date;
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function withDistances(
  candidates: BusinessCandidate[],
  origin: { latitude: number; longitude: number } | null,
): BusinessCandidate[] {
  if (!origin) return candidates;
  return candidates.map((c) =>
    c.latitude !== null && c.longitude !== null
      ? {
          ...c,
          distanceMeters: Math.round(
            haversineMeters(origin.latitude, origin.longitude, c.latitude, c.longitude),
          ),
        }
      : c,
  );
}

/**
 * Collapses entries that describe the same business. Two sources agreeing is
 * useful evidence, so we merge rather than discard: the survivor keeps the
 * richest field set and accumulates both provenance records.
 */
export function dedupeCandidates(candidates: BusinessCandidate[]): BusinessCandidate[] {
  const byPhone = new Map<string, BusinessCandidate>();
  const byName = new Map<string, BusinessCandidate>();
  const out: BusinessCandidate[] = [];

  for (const candidate of candidates) {
    const phoneKey = candidate.phoneE164;
    const nameKey = `${businessNameKey(candidate.name)}|${Math.round((candidate.latitude ?? 0) * 200)}|${Math.round((candidate.longitude ?? 0) * 200)}`;

    const existing =
      (phoneKey ? byPhone.get(phoneKey) : undefined) ?? byName.get(nameKey) ?? undefined;

    if (!existing) {
      const copy = { ...candidate };
      if (phoneKey) byPhone.set(phoneKey, copy);
      byName.set(nameKey, copy);
      out.push(copy);
      continue;
    }

    // Merge: prefer non-null values, and record that a second source agreed.
    existing.phoneE164 ??= candidate.phoneE164;
    existing.phoneRaw ??= candidate.phoneRaw;
    existing.address ??= candidate.address;
    existing.website ??= candidate.website;
    existing.rating ??= candidate.rating;
    existing.reviewCount ??= candidate.reviewCount;
    existing.category ??= candidate.category;
    existing.openingHours ??= candidate.openingHours;
    existing.verificationSources = [
      ...existing.verificationSources,
      ...candidate.verificationSources,
    ];
    // Two independent sources carrying the same number is what "verified" means.
    if (
      candidate.phoneE164 &&
      existing.phoneE164 === candidate.phoneE164 &&
      candidate.source !== existing.source
    ) {
      existing.phoneVerified = true;
    }
    if (existing.phoneE164 && !byPhone.has(existing.phoneE164)) {
      byPhone.set(existing.phoneE164, existing);
    }
  }
  return out;
}

export function rankCandidates(
  candidates: BusinessCandidate[],
  options: RankingOptions,
): RankedCandidate[] {
  const { task } = options;
  const excluded = new Set(task.constraints.excludedBusinesses.map((n) => businessNameKey(n)));
  const preferred = task.constraints.preferredBrands.map((n) => businessNameKey(n));
  const maxDistanceKm = task.constraints.distanceKm ?? task.location?.radiusKm ?? null;

  const ranked: RankedCandidate[] = candidates.map((candidate) => {
    const reasons: string[] = [];
    let score = 0;
    let excludedReason: string | null = null;

    // Hard filters first. These remove a candidate from calling entirely.
    if (!candidate.phoneE164) {
      excludedReason = 'No verified phone number listed';
    } else if (excluded.has(businessNameKey(candidate.name))) {
      excludedReason = 'You asked Dial to skip this business';
    } else if (
      maxDistanceKm !== null &&
      candidate.distanceMeters !== null &&
      candidate.distanceMeters > maxDistanceKm * 1000
    ) {
      excludedReason = `Further than ${maxDistanceKm} km away`;
    } else if (candidate.openingHours?.openNow === false) {
      excludedReason = 'Closed right now';
    }

    // Distance: nearer is better, tapering off rather than dominating.
    if (candidate.distanceMeters !== null) {
      const km = candidate.distanceMeters / 1000;
      score += Math.max(0, 30 - km * 3);
      if (km <= 3) reasons.push(`${km.toFixed(1)} km away`);
    }

    // Rating, weighted by how many people actually rated it.
    if (candidate.rating !== null) {
      const confidence = Math.min(1, (candidate.reviewCount ?? 0) / 50);
      score += (candidate.rating - 3) * 8 * (0.4 + 0.6 * confidence);
      if (candidate.rating >= 4.3) {
        reasons.push(`Rated ${candidate.rating.toFixed(1)}${candidate.reviewCount ? ` (${candidate.reviewCount})` : ''}`);
      }
    }

    if (candidate.phoneVerified) {
      score += 12;
      reasons.push('Phone number confirmed by two sources');
    }
    if (candidate.openingHours?.openNow === true) {
      score += 15;
      reasons.push('Open now');
    }
    if (candidate.website) score += 3;

    const nameKey = businessNameKey(candidate.name);
    if (preferred.some((p) => p && nameKey.includes(p))) {
      score += 40;
      reasons.push('Matches a brand you asked for');
    }

    return { candidate, score: Math.round(score * 10) / 10, reasons, excludedReason };
  });

  return ranked.sort((a, b) => {
    if (a.excludedReason && !b.excludedReason) return 1;
    if (!a.excludedReason && b.excludedReason) return -1;
    return b.score - a.score;
  });
}

/** The callable subset, capped by task constraints and the server's cost ceiling. */
export function selectCallTargets(
  ranked: RankedCandidate[],
  limits: { maxCallsPerTask: number; requested?: number | null },
): RankedCandidate[] {
  const cap = Math.min(limits.maxCallsPerTask, limits.requested ?? limits.maxCallsPerTask);
  return ranked.filter((r) => !r.excludedReason && r.candidate.phoneE164).slice(0, Math.max(1, cap));
}
