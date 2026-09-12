const metadataFor = (request) => request.metadata || request.body?.metadata || {};

const outcomeResult = (outcome, request) => {
  const metadata = metadataFor(request);
  const date = metadata.requested_date || "";
  const time = metadata.requested_time || "";
  const alternateDate = metadata.alternate_date || "2026-09-08";
  const alternateTime = metadata.alternate_time || "10:00";
  const workflowType = metadata.workflow_type || "shift_coordination";
  const messages = {
    appointment_management: {
      confirmed: "The customer confirmed the appointment.",
      reschedule_requested: "The customer requested an alternate appointment time.",
      declined: "The customer declined the appointment.",
      unknown: "The call did not establish a reliable appointment answer.",
    },
    lead_follow_up: {
      confirmed: "The prospect agreed to the proposed follow-up time.",
      reschedule_requested: "The prospect requested an alternate follow-up time.",
      declined: "The prospect declined a follow-up.",
      unknown: "The call did not establish a reliable follow-up answer.",
    },
    shift_coordination: {
      confirmed: "The team member confirmed the proposed shift.",
      reschedule_requested: "The team member requested an alternate shift time.",
      declined: "The team member declined the proposed shift.",
      unknown: "The call did not establish a reliable shift answer.",
    },
  }[workflowType] || {};
  const results = {
    confirmed: {
      outcome: "confirmed",
      requested_date: "",
      requested_time: "",
      contact_message: messages.confirmed || "The contact confirmed the proposed item.",
      confidence: 0.96,
      needs_manager_review: false,
    },
    reschedule_requested: {
      outcome: "reschedule_requested",
      requested_date: alternateDate,
      requested_time: alternateTime,
      contact_message: messages.reschedule_requested || "The contact requested an alternate date and time.",
      confidence: 0.91,
      needs_manager_review: true,
    },
    declined: {
      outcome: "declined",
      requested_date: "",
      requested_time: "",
      contact_message: messages.declined || "The contact declined the proposed item.",
      confidence: 0.94,
      needs_manager_review: true,
    },
    unknown: {
      outcome: "unknown",
      requested_date: "",
      requested_time: "",
      contact_message: messages.unknown || "The call did not establish a reliable answer.",
      confidence: 0.31,
      needs_manager_review: true,
    },
  };
  return { ...results[outcome] || results.unknown, proposed_date: date, proposed_time: time };
};

export class FakeCallProvider {
  constructor({ clock = () => Date.now(), queuedMs = 250, inProgressMs = 700 } = {}) {
    this.name = "fake";
    this.clock = clock;
    this.queuedMs = queuedMs;
    this.inProgressMs = inProgressMs;
    this.calls = new Map();
    this.idempotency = new Map();
  }

  createCall(request) {
    const existingId = this.idempotency.get(request.idempotencyKey);
    if (existingId) return this.getCall(existingId);
    const id = `call_fake_${Date.now()}_${this.calls.size + 1}`;
    this.idempotency.set(request.idempotencyKey, id);
    this.calls.set(id, { id, request, createdAt: this.clock(), canceled: false });
    return this.getCall(id);
  }

  getCall(id) {
    const call = this.calls.get(id);
    if (!call) throw new Error("Fake call not found");
    if (call.canceled) return this.response(call, "canceled");
    const elapsed = this.clock() - call.createdAt;
    const outcome = metadataFor(call.request).fake_outcome || "confirmed";
    if (outcome === "failed" && elapsed >= this.inProgressMs) return this.response(call, "failed");
    if (elapsed < this.queuedMs) return this.response(call, "queued");
    if (elapsed < this.inProgressMs) return this.response(call, "in_progress");
    return this.response(call, "completed");
  }

  cancel(id) {
    const call = this.calls.get(id);
    if (!call) throw new Error("Fake call not found");
    call.canceled = true;
    return this.getCall(id);
  }

  response(call, status) {
    const outcome = metadataFor(call.request).fake_outcome || "confirmed";
    const result = status === "completed" ? outcomeResult(outcome, call.request) : null;
    const transcript = status === "completed" ? [
      { speaker: "bot", text: `Hello. I am calling about your ${metadataFor(call.request).record_label?.toLowerCase() || "scheduled item"} on ${metadataFor(call.request).requested_date} at ${metadataFor(call.request).requested_time}.` },
      { speaker: "user", text: result?.contact_message || "The call did not complete." },
    ] : [];
    return {
      id: call.id,
      status,
      structured_result: result,
      summary: result?.contact_message || (status === "failed" ? "The simulated provider failed." : null),
      evidence: result ? [result.contact_message] : [],
      transcript_turns: transcript,
      failure_code: status === "failed" ? "fake_provider_failure" : null,
      failure_message: status === "failed" ? "The selected fake scenario simulates a provider failure." : null,
      metadata: call.request.metadata,
    };
  }
}
