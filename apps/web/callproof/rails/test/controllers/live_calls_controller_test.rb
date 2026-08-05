require "test_helper"

class LiveCallsControllerTest < ActionDispatch::IntegrationTest
  test "requires operator authentication for the live workflow" do
    get new_live_call_path
    assert_response :unauthorized

    post live_calls_path, params: preview_params
    assert_response :unauthorized
  end

  test "creates a preview without placing a call or enabling live mode" do
    assert_difference -> { CallRequest.count }, 1 do
      assert_no_difference -> { PhoneCall.count } do
        post live_calls_path, params: preview_params, headers: operator_auth_headers
      end
    end

    request = CallRequest.order(:id).last
    assert_redirected_to live_call_path(request)
    assert_equal "awaiting_confirmation", request.status
    assert_not request.live_mode?
    assert_nil request.confirmed_at
    assert request.call_contract.present?
    assert_equal 25_000, request.call_policy.maximum_surcharge_cents

    # The confirmation phrase is derived from a random token, not the sequential id,
    # so it cannot be guessed from the request URL.
    assert request.confirmation_token.present?
    assert_not_equal "PLACE CALL #{request.id}", request.confirmation_phrase

    get live_call_path(request), headers: operator_auth_headers
    assert_response :success
    assert_not_includes response.body, "+525512345678"
    assert_includes response.body, request.confirmation_phrase
    assert_select "input[type=submit][disabled]", value: "Place real call with CALL-E"
  end

  test "confirmation fails closed when live environment is disabled" do
    request = create_preview

    post confirm_live_call_path(request),
         params: { confirmation_phrase: request.confirmation_phrase },
         headers: operator_auth_headers

    assert_redirected_to live_call_path(request)
    assert_equal "awaiting_confirmation", request.reload.status
    assert_not request.live_mode?
    assert_nil request.phone_call
  end

  test "a draft can be canceled without external effects" do
    request = create_preview

    post cancel_live_call_path(request), headers: operator_auth_headers

    assert_redirected_to live_call_path(request)
    assert_equal "canceled", request.reload.status
    assert_nil request.phone_call
  end

  private

  def create_preview
    post live_calls_path, params: preview_params, headers: operator_auth_headers
    CallRequest.order(:id).last
  end

  def preview_params
    {
      call_request: {
        recipient_phone_e164: "+525512345678",
        objective: "Move fictional order C1023 to Friday at 9 AM without exceeding $250.",
        region: "MX",
        maximum_surcharge_dollars: "250.00"
      }
    }
  end
end
