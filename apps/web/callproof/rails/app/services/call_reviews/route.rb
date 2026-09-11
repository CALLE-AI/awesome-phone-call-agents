# frozen_string_literal: true

module CallReviews
  class Route
    def self.call(call_analysis, gate_key:, run_id:, flow: "ExecutePhoneCallFlow")
      return nil unless call_analysis.needs_human_review?

      phone_call = call_analysis.phone_call
      call_request = phone_call.call_request
      terms = call_analysis.verdict.fetch("negotiated_terms")

      Agentkit::HITL.suggest!(
        type: "call_policy_exception",
        title: "Review an unauthorized phone commitment",
        description: call_analysis.verdict.fetch("summary"),
        priority: "high",
        source_agent: "CallAnalyzer",
        gate_key: gate_key,
        idempotency_key: "call-analysis:#{call_analysis.id}:review",
        payload: {
          "flow" => flow,
          "run_id" => run_id,
          "step" => "review_exception",
          "call_request_id" => call_request.id,
          "call_analysis_id" => call_analysis.id,
          "accepted_surcharge_cents" => terms.fetch("surcharge_cents"),
          "maximum_authorized_surcharge_cents" => terms.fetch("maximum_authorized_surcharge_cents"),
          "evidence_turn_ids" => call_analysis.analysis_evidences.flat_map(&:transcript_turn_ids).uniq,
          "proposed_action" => "record_exception_and_require_stricter_negotiation"
        }
      )
    end
  end
end
