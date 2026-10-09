const MAX_ATTEMPTS = 2;
const RETRYABLE_STATUSES = new Set(["no_answer", "busy"]);

const decideNextStep = (state) => {
  const { callStatus, callResult, attemptNumber } = state;

  if (callStatus === "ambiguous") {
    return "needs_review"; // halt no automatic retry on uncertain outcomes
  }

  if (callStatus === "rejected" || callStatus === "failed") {
    return "end";
  }

  if (RETRYABLE_STATUSES.has(callStatus)) {
    return attemptNumber < MAX_ATTEMPTS ? "retry" : "end";
  }

  if (callStatus === "completed" && callResult) {
    if (callResult.interested === "no") return "mark_not_interested";
    if (callResult.lead_score === "hot") return "mark_hot";
    return "schedule_followup";
  }

  return "end";
};

module.exports = { decideNextStep, MAX_ATTEMPTS };