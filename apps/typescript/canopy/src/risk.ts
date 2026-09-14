// Risk scoring and wave planning. Pure functions of registry facts.
//
// The score is deliberately simple and explainable: an emergency manager must be able to
// say why one person was called before another. Weights follow the risk factors that heat
// mortality studies consistently identify: advanced age, living alone, no cooling at home,
// and cardiovascular, respiratory, renal or cognitive conditions.

import type { HazardId, Person, Priority, Wave } from "./types.js";

export interface RiskBreakdown {
  score: number;
  priority: Priority;
  factors: string[];
}

const MEDICAL_WEIGHTS: Record<string, number> = {
  cardiac: 2,
  heart: 2,
  respiratory: 2,
  copd: 2,
  asthma: 1,
  dialysis: 3,
  renal: 2,
  kidney: 2,
  oxygen: 3,
  ventilator: 3,
  dementia: 3,
  cognitive: 2,
  diabetes: 1,
  insulin: 2,
  pregnancy: 2,
  mobility: 2,
  wheelchair: 2,
  psychiatric: 1,
  obesity: 1,
};

export function scorePerson(person: Person, hazard: HazardId): RiskBreakdown {
  let score = 0;
  const factors: string[] = [];
  if (person.age !== null) {
    if (person.age >= 85) {
      score += 4;
      factors.push("age 85+");
    } else if (person.age >= 75) {
      score += 3;
      factors.push("age 75-84");
    } else if (person.age >= 65) {
      score += 2;
      factors.push("age 65-74");
    }
  }
  if (person.livesAlone) {
    score += 2;
    factors.push("lives alone");
  }
  if (hazard === "heat" || hazard === "smoke") {
    if (person.hasCooling === "no") {
      score += 3;
      factors.push("no cooling at home");
    } else if (person.hasCooling === "unknown") {
      score += 1;
      factors.push("cooling unknown");
    }
  }
  for (const risk of person.medicalRisks) {
    const weight = MEDICAL_WEIGHTS[risk] ?? 1;
    let applied = weight;
    if (hazard === "outage-medical" && ["oxygen", "ventilator", "dialysis", "insulin"].includes(risk)) {
      applied = weight + 2;
    }
    score += applied;
    factors.push(`${risk} (+${applied})`);
  }
  if (person.contactPhone === null) {
    score += 1;
    factors.push("no emergency contact");
  }
  const priority: Priority = score >= 8 ? 1 : score >= 4 ? 2 : 3;
  return { score, priority, factors };
}

/**
 * Orders people by priority then score, then cuts them into waves of `waveSize`.
 * A wave never mixes priorities: the highest-risk people are always dialled first.
 */
export function planWaves(people: Person[], hazard: HazardId, waveSize: number, attempt = 1): Wave[] {
  if (waveSize < 1) {
    throw new Error("waveSize must be at least 1");
  }
  const scored = people
    .map((person) => ({ person, risk: scorePerson(person, hazard) }))
    .sort((a, b) => a.risk.priority - b.risk.priority || b.risk.score - a.risk.score || a.person.id.localeCompare(b.person.id));
  const waves: Wave[] = [];
  let current: Wave | null = null;
  for (const { person, risk } of scored) {
    if (current === null || current.priority !== risk.priority || current.personIds.length >= waveSize) {
      current = { index: waves.length + 1, priority: risk.priority, personIds: [], attempt };
      waves.push(current);
    }
    current.personIds.push(person.id);
  }
  return waves;
}
