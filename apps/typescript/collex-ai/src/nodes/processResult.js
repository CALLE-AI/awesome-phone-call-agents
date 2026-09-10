const chrono = require("chrono-node");
const { leadStore, activityLog } = require("../fixtures/demoStore");

const parsePreferredDay = (text) => {
  if (!text) return null;

  const parsedDate = chrono.parseDate(text, new Date(), { forwardDate: true });
  // forwardDate: true —  date ko hamesha future mein resolve karega, past mein nahi

  return parsedDate || null;
};

const processResult = async (state) => {
  console.log("processResult node comes");
  const lead = leadStore.get(state.leadId);

  lead.last_call_at = new Date();
  lead.last_call_status = state.callStatus;
  lead.last_call_result = state.callResult;
  lead.call_attempts = (lead.call_attempts || 0) + 1;

  activityLog.push({
    lead: state.leadId,
    business: lead.business,
    activity_type: "ai_call_completed",
    description:
      state.callStatus === "completed"
        ? "AI agent completed a call with this lead"
        : `AI agent's call attempt ${state.callStatus === "failed" ? "failed" : "went unanswered"}`,
    metadata: {
      callStatus: state.callStatus,
      interested: state.callResult?.interested,
      leadScore: state.callResult?.lead_score,
      requirement: state.callResult?.requirement_summary,
      budget: state.callResult?.budget_mentioned,
      timeline: state.callResult?.timeline,
      preferredFollowup: state.callResult?.preferred_followup,
      attemptNumber: state.attemptNumber,
    },
  });

  return {};
};

const incrementAttempt = async (state) => ({
  attemptNumber: state.attemptNumber + 1,
});

const markNotInterested = async (state) => {
  console.log("markNotInterested node comes");
  const lead = leadStore.get(state.leadId);
  const previousStatus = lead.status;

  lead.status = "lost";

  activityLog.push({
    lead: state.leadId,
    business: lead.business,
    activity_type: "status_changed",
    description: `Status changed to "lost" — AI call indicated no interest`,
    metadata: { from: previousStatus, to: "lost" },
  });

  return {};
};

const scheduleFollowup = async (state) => {
  console.log("scheduleFollowup node comes");
  const lead = leadStore.get(state.leadId);
  const previousStatus = lead.status;
  const previousFollowUp = lead.follow_up_date;
  const { callResult } = state;

  let followUpDate = parsePreferredDay(callResult?.preferred_followup);
  let source = "lead_stated";

  if (!followUpDate) {
    followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + 3);
    source = "default_fallback";
  }

  lead.status = "contacted"; // warm — AI follow-up later
  lead.follow_up_date = followUpDate;

  if (
    callResult.budget_mentioned &&
    callResult.budget_mentioned !== "not discussed"
  ) {
    lead.notes =
      `${lead.notes || ""}\n[AI Call] Budget: ${callResult.budget_mentioned}. Requirement: ${callResult.requirement_summary || "N/A"}. Timeline: ${callResult.timeline || "N/A"}.`.trim();
  }

  activityLog.push({
    lead: state.leadId,
    business: lead.business,
    activity_type: "followup_added",
    description:
      source === "lead_stated"
        ? `Follow-up scheduled (warm lead) based on lead's stated preference`
        : `Follow-up scheduled (warm lead, default timing)`,
    metadata: {
      from: previousFollowUp,
      to: followUpDate,
      source,
      leadScore: "warm",
      budget: callResult.budget_mentioned,
      timeline: callResult.timeline,
    },
  });

  return {};
};

const markHot = async (state) => {
  console.log("markHot node comes");
  const lead = leadStore.get(state.leadId);
  const previousStatus = lead.status;
  const { callResult } = state;

  lead.status = "qualified";

  if (
    callResult.budget_mentioned &&
    callResult.budget_mentioned !== "not discussed"
  ) {
    lead.notes =
      `${lead.notes || ""}\n[AI Call] Budget: ${callResult.budget_mentioned}. Requirement: ${callResult.requirement_summary || "N/A"}.`.trim();
  }

  activityLog.push({
    lead: state.leadId,
    business: lead.business,
    activity_type: "status_changed",
    description: `Marked as HOT lead by AI — ready for human follow-up`,
    metadata: {
      from: previousStatus,
      to: "qualified",
      leadScore: "hot",
      budget: callResult.budget_mentioned,
      timeline: callResult.timeline,
      requirement: callResult.requirement_summary,
    },
  });

  // TODO: Actual notification (email/push/Slack) to assigned salesperson
  console.log(
    `HOT lead alert: ${lead.name} (${lead._id}) needs human follow-up`,
  );
  return {};
};

module.exports = {
  processResult,
  markHot,
  markNotInterested,
  scheduleFollowup,
  incrementAttempt,
};
