require "test_helper"

class CallproofVerticalSliceTest < ActiveSupport::TestCase
  setup do
    @provider, @policy = Demo::Setup.call
  end

  test "a compliant fake call completes without human review" do
    request = build_request("compliant")

    result = ExecutePhoneCallFlow.call(call_request: request)

    assert result.ok?
    assert_equal "verified", request.reload.status
    assert request.call_analysis.verdict.fetch("policy_adherence")
    assert_not request.call_analysis.needs_human_review?
    assert_equal "policy_compliance", request.call_analysis.analysis_evidences.first.finding
    assert_empty Agentkit::HITL.pending
  end

  test "a policy violation suspends the flow with transcript evidence" do
    request = build_request("policy_violation")

    result = ExecutePhoneCallFlow.call(call_request: request)
    suggestion = Agentkit::HITL.pending.last

    assert result.err?
    assert_instance_of Agentkit::PendingHumanApproval, result.error
    assert_equal "waiting_human", request.reload.status
    assert_equal "waiting_human", result.run.status
    assert_equal "unauthorized_surcharge", request.call_analysis.analysis_evidences.first.finding
    assert_equal "call_policy_exception", suggestion.suggestion_type
    assert_equal [ 3, 4 ], suggestion.payload.fetch("evidence_turn_ids")
  end

  test "a human approval resumes the same run" do
    request = build_request("policy_violation")
    initial = ExecutePhoneCallFlow.call(call_request: request)
    suggestion = Agentkit::HITL.pending.last

    Agentkit::HITL.approve(suggestion.id, actor: "human:test")
    resumed = ExecutePhoneCallFlow.resume(initial.run.run_id, mode: :sync)
    persisted_run = Agentkit::Flow.shared_store.find_run_by_uuid(initial.run.run_id)

    assert resumed.ok?
    assert_equal "completed", persisted_run.status
    assert_equal "approved", request.reload.status
    assert_equal "accepted", Agentkit::HITL.find(suggestion.id).status
    assert_equal "accepted", Agentkit::HITL.ledger.entries.last.decision
  end

  test "live mode requires the global switch and persisted confirmation" do
    request = build_request("compliant")
    request.live_mode = true

    assert_not request.valid?
    assert_includes request.errors[:live_mode], "requires CALLPROOF_LIVE_CALLS=true"
    assert_includes request.errors[:confirmed_at], "is required for a live call"
  end

  private

  def build_request(scenario)
    CallRequest.create!(
      provider_profile: @provider,
      call_policy: @policy,
      recipient_phone_e164: @provider.phone_number_e164,
      objective: "Move fictional order C1023 to Friday at 9 AM without exceeding $250.",
      simulation_scenario: scenario,
      live_mode: false
    )
  end
end
