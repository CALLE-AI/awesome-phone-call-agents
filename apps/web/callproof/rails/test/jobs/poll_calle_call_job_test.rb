require "test_helper"

class PollCalleCallJobTest < ActiveJob::TestCase
  test "normalizes a terminal CALL-E result and sends it to the analyzer" do
    phone_call = pending_calle_call
    client = Object.new
    result = completed_result
    client.define_singleton_method(:retrieve) { |_id| result }

    job = PollCalleCallJob.new
    job.define_singleton_method(:client) { client }
    job.perform(phone_call.id)

    assert_equal "completed", phone_call.reload.status
    assert_equal "agent", phone_call.transcript.dig("turns", 0, "speaker")
    assert_equal "recipient", phone_call.transcript.dig("turns", 1, "speaker")
    assert_equal 32_000, phone_call.structured_result.fetch("surcharge_cents")
    assert_equal "waiting_human", phone_call.call_request.reload.status
    assert_equal "ReviewCallAnalysisFlow", Agentkit::HITL.pending.last.payload.fetch("flow")
  end

  private

  def pending_calle_call
    provider, policy = Demo::Setup.call
    request = CallRequest.create!(
      provider_profile: provider,
      call_policy: policy,
      recipient_phone_e164: provider.phone_number_e164,
      objective: "Move order C1023 to Friday without exceeding $250.",
      simulation_scenario: "policy_violation"
    )
    CallContracts::Build.call(request)
    request.create_phone_call!(
      provider: "calle",
      provider_call_id: "call_123",
      status: "queued",
      transcript: { "language" => "en", "turns" => [] },
      structured_result: {},
      started_at: Time.current
    )
  end

  def completed_result
    {
      "status" => "completed",
      "task_completed" => true,
      "structured_result" => { "completed_count" => 1 },
      "recipients" => [ {
        "structured_result" => {
          "delivery_changed" => true,
          "delivery_date" => "2026-08-07",
          "delivery_time" => "09:00",
          "surcharge_cents" => 32_000,
          "order_number_confirmed" => true
        },
        "attempts" => [ {
          "transcript_turns" => [
            { "offset_seconds" => 0, "speaker" => "bot", "text" => "I need to move order C1023." },
            { "offset_seconds" => 4, "speaker" => "user", "text" => "The surcharge is $320.00." },
            { "offset_seconds" => 6, "speaker" => "user", "text" => "Friday at 9 AM is available." },
            { "offset_seconds" => 8, "speaker" => "bot", "text" => "I accept the $320.00 surcharge." }
          ]
        } ]
      } ]
    }
  end
end
