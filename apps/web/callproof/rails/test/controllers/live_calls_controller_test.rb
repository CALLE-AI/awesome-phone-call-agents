require "test_helper"

class LiveCallsControllerTest < ActionDispatch::IntegrationTest
  test "creates a preview without placing a call or enabling live mode" do
    assert_difference -> { CallRequest.count }, 1 do
      assert_no_difference -> { PhoneCall.count } do
        post live_calls_path, params: preview_params
      end
    end

    request = CallRequest.order(:id).last
    assert_redirected_to live_call_path(request)
    assert_equal "awaiting_confirmation", request.status
    assert_not request.live_mode?
    assert_nil request.confirmed_at
    assert request.call_contract.present?
    assert_equal 25_000, request.call_policy.maximum_surcharge_cents

    get live_call_path(request)
    assert_response :success
    assert_not_includes response.body, "+525512345678"
    assert_includes response.body, "PLACE CALL #{request.id}"
    assert_select "input[type=submit][disabled]", value: "Place real call with CALL-E"
  end

  test "confirmation fails closed when live environment is disabled" do
    request = create_preview

    post confirm_live_call_path(request), params: { confirmation_phrase: "PLACE CALL #{request.id}" }

    assert_redirected_to live_call_path(request)
    assert_equal "awaiting_confirmation", request.reload.status
    assert_not request.live_mode?
    assert_nil request.phone_call
  end

  test "a draft can be canceled without external effects" do
    request = create_preview

    post cancel_live_call_path(request)

    assert_redirected_to live_call_path(request)
    assert_equal "canceled", request.reload.status
    assert_nil request.phone_call
  end

  private

  def create_preview
    post live_calls_path, params: preview_params
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
