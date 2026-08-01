require "test_helper"

class CallProvidersCalleTest < ActiveJob::TestCase
  test "creates an official CALL-E API request only after explicit live confirmation" do
    previous_live = ENV["CALLPROOF_LIVE_CALLS"]
    ENV["CALLPROOF_LIVE_CALLS"] = "true"
    provider, policy = Demo::Setup.call
    call_request = CallRequest.create!(
      provider_profile: provider,
      call_policy: policy,
      recipient_phone_e164: provider.phone_number_e164,
      objective: "Move order C1023 to Friday without exceeding $250.",
      simulation_scenario: "compliant",
      live_mode: true,
      confirmed_at: Time.current
    )
    contract = CallContracts::Build.call(call_request)
    captured = nil
    transport = lambda do |_uri, request|
      captured = request
      Struct.new(:code, :body).new("202", JSON.generate(call_id: "call_official_123", status: "queued"))
    end

    phone_call = nil
    assert_enqueued_with(job: PollCalleCallJob) do
      phone_call = CallProviders::Calle.new(
        api_key: "test-key",
        webhook_url: "https://rails.test/calle/webhook",
        transport: transport
      ).call(call_request: call_request, contract: contract)
    end

    document = JSON.parse(captured.body)
    assert_equal "Bearer test-key", captured["Authorization"]
    assert_equal call_request.idempotency_key, captured["Idempotency-Key"]
    assert_equal [ provider.phone_number_e164 ], document.dig("recipients", 0, "phones")
    assert_equal 0, document.dig("recipient_result_schema", "properties", "surcharge_cents", "minimum")
    assert_includes document.fetch("task"), "maximum_surcharge_cents"
    assert_equal "call_official_123", phone_call.provider_call_id
    assert_equal "running", call_request.reload.status
  ensure
    ENV["CALLPROOF_LIVE_CALLS"] = previous_live
  end

  test "refuses to dial when the global live switch is off" do
    request = CallRequest.new(live_mode: true, confirmed_at: Time.current)

    error = assert_raises(CallProviders::Calle::SafetyError) do
      CallProviders::Calle.new(api_key: "test-key").call(call_request: request, contract: nil)
    end

    assert_equal "CALLPROOF_LIVE_CALLS must be exactly true", error.message
  end
end
