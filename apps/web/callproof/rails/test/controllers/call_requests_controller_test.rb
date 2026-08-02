require "test_helper"

class CallRequestsControllerTest < ActionDispatch::IntegrationTest
  test "renders a remote analysis while its verdict is pending" do
    provider, policy = Demo::Setup.call
    call_request = CallRequest.create!(
      provider_profile: provider,
      call_policy: policy,
      recipient_phone_e164: provider.phone_number_e164,
      objective: "Move a fictional delivery without exceeding $250.",
      simulation_scenario: "policy_violation"
    )
    contract = CallContracts::Build.call(call_request)
    phone_call = CallProviders::Fake.new.call(call_request: call_request, contract: contract)
    phone_call.create_call_analysis!(
      request_id: SecureRandom.uuid,
      external_analysis_id: SecureRandom.uuid,
      status: "received",
      verdict: {},
      result_confidence: 0
    )
    call_request.update!(status: "waiting_analysis")

    get call_request_path(call_request)

    assert_response :success
    assert_select "h1", text: "Waiting analysis"
    assert_select "h2", text: "Analysis pending"
    assert_select ".metrics", count: 0
  end
end
