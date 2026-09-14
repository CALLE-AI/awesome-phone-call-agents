import type {
  CenterCallRecord,
  CenterCandidate,
  CenterResult,
  ConstraintCheck,
  MatchEvaluation,
  SearchBrief,
} from "./types.ts";

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function minutes(value: string) {
  if (!TIME_PATTERN.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function check(
  key: ConstraintCheck["key"],
  label: string,
  status: ConstraintCheck["status"],
  detail: string,
): ConstraintCheck {
  return { key, label, status, detail };
}

export function evaluateCenter(candidate: CenterCandidate, result: CenterResult | null, brief: SearchBrief): MatchEvaluation {
  if (!result) {
    return {
      candidateId: candidate.id,
      tier: "review",
      score: 0,
      headline: "No schema-valid result",
      checks: [check("evidence", "Call evidence", "unknown", "The call did not return a usable structured result.")],
    };
  }

  const checks: ConstraintCheck[] = [];
  checks.push(check(
    "identity",
    "Right center",
    result.lineOutcome === "reached_staff" && result.businessConfirmed === "yes" ? "pass" : result.businessConfirmed === "no" || result.lineOutcome === "wrong_entity" ? "fail" : "unknown",
    result.lineOutcome === "reached_staff" ? "Staff answered the call." : `Call outcome: ${result.lineOutcome.replaceAll("_", " ")}.`,
  ));
  checks.push(check(
    "age",
    `${brief.ageBand} care`,
    result.ageBandAccepted === "yes" ? "pass" : result.ageBandAccepted === "no" ? "fail" : "unknown",
    result.ageBandAccepted === "yes" ? `The center accepts the ${brief.ageBand} age band.` : "Age-band acceptance was not confirmed.",
  ));

  let vacancyStatus: ConstraintCheck["status"] = "unknown";
  let vacancyDetail = "No usable start date was confirmed.";
  if (result.vacancyStatus === "waitlist" || result.vacancyStatus === "full") {
    vacancyStatus = "fail";
    vacancyDetail = result.vacancyStatus === "waitlist" ? "Waitlist only; no opening was claimed." : "The center reported no opening.";
  } else if (result.vacancyStatus === "available" && DATE_PATTERN.test(result.earliestStartDate)) {
    vacancyStatus = result.earliestStartDate <= brief.desiredStartDate ? "pass" : "fail";
    vacancyDetail = `Earliest stated start is ${result.earliestStartDate}.`;
  } else if (result.vacancyStatus === "available_later") {
    vacancyStatus = "fail";
    vacancyDetail = `The opening starts after ${brief.desiredStartDate}.`;
  }
  checks.push(check("vacancy", "Start date", vacancyStatus, vacancyDetail));

  const missingDays = brief.requiredWeekdays.filter((day) => !result.availableWeekdays.includes(day));
  checks.push(check(
    "days",
    "Required days",
    result.availableWeekdays.length === 0 ? "unknown" : missingDays.length === 0 ? "pass" : "fail",
    result.availableWeekdays.length === 0 ? "Available weekdays were not confirmed." : missingDays.length === 0 ? "Every required weekday is available." : `Missing ${missingDays.join(", ")}.`,
  ));

  const opening = minutes(result.openingTime);
  const closing = minutes(result.closingTime);
  const dropoff = minutes(brief.dropoffTime);
  const pickup = minutes(brief.pickupTime);
  const hoursKnown = opening !== null && closing !== null && dropoff !== null && pickup !== null;
  const coversHours = hoursKnown && opening <= dropoff && closing >= pickup;
  checks.push(check(
    "hours",
    "Care window",
    !hoursKnown ? "unknown" : coversHours ? "pass" : "fail",
    hoursKnown ? `${result.openingTime}-${result.closingTime} compared with ${brief.dropoffTime}-${brief.pickupTime}.` : "Operating hours were not confirmed.",
  ));

  checks.push(check(
    "budget",
    "Monthly budget",
    result.monthlyTuitionMinor < 0 ? "unknown" : result.monthlyTuitionMinor <= brief.budgetMonthlyMinor ? "pass" : "fail",
    result.monthlyTuitionMinor < 0 ? "Tuition was not confirmed." : `${result.monthlyTuitionMinor} minor units per month, before any registration fee.`,
  ));

  checks.push(check(
    "subsidy",
    "Subsidy",
    !brief.subsidyRequired ? "pass" : result.subsidyStatus === "accepted" ? "pass" : result.subsidyStatus === "not_accepted" ? "fail" : "unknown",
    !brief.subsidyRequired ? "Not required for this search." : `Center reported: ${result.subsidyStatus.replaceAll("_", " ")}.`,
  ));

  const hasEvidence = result.availabilityEvidence.trim().length > 0 && result.scheduleEvidence.trim().length > 0;
  checks.push(check(
    "evidence",
    "Evidence",
    hasEvidence ? "pass" : "unknown",
    hasEvidence ? "Vacancy and schedule each have a staff-reported quote." : "A required evidence quote is missing.",
  ));

  const hardKeys = new Set<ConstraintCheck["key"]>(["identity", "age", "vacancy", "days", "hours", "subsidy", "evidence"]);
  const hardChecks = checks.filter((item) => hardKeys.has(item.key));
  const hasHardFailure = hardChecks.some((item) => item.status === "fail");
  const hasUnknown = hardChecks.some((item) => item.status === "unknown");
  const budget = checks.find((item) => item.key === "budget");

  let tier: MatchEvaluation["tier"];
  let headline: string;
  if (result.vacancyStatus === "waitlist") {
    tier = "waitlist";
    headline = "Waitlist, not an opening";
  } else if (result.vacancyStatus === "full" || result.ageBandAccepted === "no") {
    tier = "unavailable";
    headline = "Does not meet the care need";
  } else if (hasUnknown) {
    tier = "review";
    headline = "Needs a human check";
  } else if (hasHardFailure) {
    tier = "partial";
    headline = "Opening does not fit every constraint";
  } else if (budget?.status === "fail") {
    tier = "partial";
    headline = "Fits care needs, above budget";
  } else {
    tier = "qualified";
    headline = "Verified fit for this search";
  }

  const passed = checks.filter((item) => item.status === "pass").length;
  const failed = checks.filter((item) => item.status === "fail").length;
  const distanceBonus = Math.max(0, 10 - Math.round(candidate.distanceMiles));
  const score = tier === "qualified" ? Math.min(100, 60 + passed * 4 - failed * 8 + distanceBonus) : Math.max(0, passed * 5 - failed * 8);
  return { candidateId: candidate.id, tier, score, checks, headline };
}

export function campaignSummary(candidates: CenterCandidate[], records: CenterCallRecord[], brief: SearchBrief) {
  const completed = records.filter((record) => record.status === "completed");
  const evaluations = completed.map((record) => {
    const candidate = candidates.find((item) => item.id === record.candidateId);
    return candidate ? evaluateCenter(candidate, record.result, brief) : null;
  }).filter((item): item is MatchEvaluation => item !== null);
  const qualified = evaluations.filter((item) => item.tier === "qualified").length;
  const untouched = records.filter((record) => record.status === "held" || record.status === "planned").length;
  return {
    evaluations,
    qualified,
    completed: completed.length,
    callsAvoided: qualified >= brief.targetMatches ? untouched : 0,
    targetMet: qualified >= brief.targetMatches,
  };
}

export function nextWave(records: CenterCallRecord[], waveSize: number, targetMet: boolean) {
  if (targetMet) return [];
  return records
    .filter((record) => record.status === "planned" || record.status === "held")
    .slice(0, Math.max(1, Math.min(3, waveSize)))
    .map((record) => record.candidateId);
}
