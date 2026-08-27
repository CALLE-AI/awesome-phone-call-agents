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

  test "an operator-initiated request requires authentication even when live_mode is false" do
    request = operator_request

    get call_request_path(request)
    assert_response :unauthorized

    get call_request_path(request), headers: operator_auth_headers
    assert_response :success
  end

  test "a live request predating the operator_initiated flag still requires auth" do
    # Defense in depth: simulates a row created before the backfill/column existed.
    # Gating on operator_initiated alone would make this anonymously readable.
    request = operator_request
    request.update_columns(operator_initiated: false, live_mode: true, confirmed_at: Time.current)

    get call_request_path(request)
    assert_response :unauthorized

    get call_request_path(request), headers: operator_auth_headers
    assert_response :success
  end

  test "a confirmed request without either flag still requires auth" do
    request = operator_request
    request.update_columns(operator_initiated: false, live_mode: false, confirmed_at: Time.current)

    get call_request_path(request)
    assert_response :unauthorized
  end

  test "a public demo request is viewable without authentication" do
    provider, policy = Demo::Setup.call
    request = CallRequest.create!(
      provider_profile: provider, call_policy: policy,
      recipient_phone_e164: provider.phone_number_e164,
      objective: "Fictional delivery.", simulation_scenario: "compliant"
    )
    CallContracts::Build.call(request)

    get call_request_path(request)
    assert_response :success
    # Honest mode label — not the hardcoded "Fake / no call" for every request.
    assert_select "dd", text: "Fake / no call"
  end

  private

  def operator_request
    provider, policy = Demo::Setup.call
    request = CallRequest.create!(
      provider_profile: provider, call_policy: policy,
      recipient_phone_e164: "+525512345678",
      objective: "Real operator objective.", simulation_scenario: "compliant",
      status: "awaiting_confirmation", live_mode: false, operator_initiated: true
    )
    CallContracts::Build.call(request)
    request
  end
end
