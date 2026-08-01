require "test_helper"

class CallAnalyzersHttpTest < ActiveSupport::TestCase
  test "submits the shared contract and persists a pending remote analysis" do
    phone_call, contract = completed_fake_call
    captured = nil
    transport = lambda do |_uri, request|
      captured = JSON.parse(request.body)
      Struct.new(:code, :body).new(
        "202",
        JSON.generate(
          analysis_id: "8ac59394-58b7-4ea2-891f-3f77119949ea",
          request_id: captured.fetch("request_id"),
          status: "received",
          status_url: "http://analyzer.test/api/v1/analyses/8ac59394-58b7-4ea2-891f-3f77119949ea"
        )
      )
    end

    analysis = CallAnalyzers::Http.new(
      base_url: "http://analyzer.test",
      callback_url: "https://rails.test/webhooks/call_analyzer",
      transport: transport
    ).call(phone_call: phone_call, contract: contract)

    assert_equal "received", analysis.status
    assert_equal "waiting_analysis", phone_call.call_request.reload.status
    assert_equal phone_call.provider_call_id, captured.fetch("call_id")
    assert_equal 25_000,
                 captured.dig("call_contract", "allowed_commitments", "maximum_surcharge_cents")
    assert_equal phone_call.transcript, captured.fetch("transcript")
  end

  private

  def completed_fake_call
    provider, policy = Demo::Setup.call
    request = CallRequest.create!(
      provider_profile: provider,
      call_policy: policy,
      recipient_phone_e164: provider.phone_number_e164,
      objective: "Move fictional order C1023 to Friday at 9 AM without exceeding $250.",
      simulation_scenario: "policy_violation"
    )
    contract = CallContracts::Build.call(request)
    [ CallProviders::Fake.new.call(call_request: request, contract: contract), contract ]
  end
end
