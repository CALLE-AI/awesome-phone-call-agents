// Who is called first. The deadline dominates: people whose coverage is checked soonest go first.
// Within the same deadline band, the people most likely to lose coverage over paperwork go first:
// a language other than English, no online account, returned mail, and a past procedural loss.
// Every factor is explainable, because a program manager has to be able to say why.

import { ageOn, daysBetween } from "./rules.js";
import type { Enrollee, Priority, Wave } from "./types.js";

export interface PriorityBreakdown {
  score: number;
  priority: Priority;
  daysToCheck: number | null;
  factors: string[];
}

export function scoreEnrollee(person: Enrollee, asOf: string): PriorityBreakdown {
  const daysToCheck = person.checkDate !== null ? daysBetween(asOf, person.checkDate) : null;
  let score = 0;
  const factors: string[] = [daysToCheck !== null ? `${daysToCheck} days until the coverage check` : "coverage check date unknown"];
  if (!person.locale.toLowerCase().startsWith("en")) {
    score += 2;
    factors.push("prefers a language other than English");
  }
  if (!person.hasOnlineAccount) {
    score += 2;
    factors.push("no online account");
  }
  if (person.mailReturned) {
    score += 3;
    factors.push("mail to them was returned");
  }
  if (person.priorProceduralLoss) {
    score += 3;
    factors.push("lost coverage over paperwork before");
  }
  const age = ageOn(person.birthYear, asOf);
  if (age !== null && age < 27) {
    score += 1;
    factors.push("aged 19 to 26");
  }
  const priority: Priority = daysToCheck === null ? 2 : daysToCheck <= 150 ? 1 : daysToCheck <= 200 ? 2 : 3;
  return { score, priority, daysToCheck, factors };
}

/** Orders people by deadline band, then days to check, then paperwork-risk score, then id; cuts them into waves. */
export function planWaves(people: Enrollee[], asOf: string, waveSize: number, attempt = 1): Wave[] {
  if (waveSize < 1) {
    throw new Error("waveSize must be at least 1");
  }
  const scored = people
    .map((person) => ({ person, p: scoreEnrollee(person, asOf) }))
    .sort(
      (a, b) =>
        a.p.priority - b.p.priority ||
        (a.p.daysToCheck ?? 9999) - (b.p.daysToCheck ?? 9999) ||
        b.p.score - a.p.score ||
        a.person.id.localeCompare(b.person.id),
    );
  const waves: Wave[] = [];
  let current: Wave | null = null;
  for (const { person, p } of scored) {
    if (current === null || current.priority !== p.priority || current.personIds.length >= waveSize) {
      current = { index: waves.length + 1, priority: p.priority, personIds: [], attempt };
      waves.push(current);
    }
    current.personIds.push(person.id);
  }
  return waves;
}
