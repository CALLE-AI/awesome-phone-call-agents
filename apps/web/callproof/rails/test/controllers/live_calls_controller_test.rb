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
    assert_equal "2.0", request.call_contract.schema_version
    assert_equal "2026-08-07", request.call_contract.verification_claims.first.fetch("expected")

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

  # Reported case: a 401 on the reconciliation attempt was reported to the operator as
  # "no call was placed". It proves only that the credential is bad now.
  test "a non-definitive error during reconciliation leaves the request unresolved" do
    error = CallProviders::Calle::AmbiguousError.new("CALL-E create returned 401")

    request = reconcile_with_provider_raising(error)

    assert_equal "unresolved", request.reload.status
    assert_no_match(/no call was placed/, flash[:alert].to_s)
    assert_match(/says nothing about the original request/, flash[:alert].to_s)
  end

  test "a later payload rejection still cannot resolve the original ambiguous create" do
    error = CallProviders::Calle::DefinitiveRejectionError.new("HTTP 422: bad phone")

    request = reconcile_with_provider_raising(error)

    assert_equal "unresolved", request.reload.status
    assert_no_match(/no call was placed/, flash[:alert].to_s)
    assert_match(/outcome remains unknown/, flash[:alert].to_s)
  end

  private

  # Drives the reconcile action for an already-unresolved live request, with the provider
  # failing in the given way. Returns the request so the caller can assert on it.
  def reconcile_with_provider_raising(error)
    previous_live = ENV["CALLPROOF_LIVE_CALLS"]
    previous_provider = ENV["CALLPROOF_CALL_PROVIDER"]
    previous_key = ENV["CALLE_API_KEY"]
    ENV["CALLPROOF_LIVE_CALLS"] = "true"
    # Without these the action's own live-environment guard raises first, the provider is
    # never reached, and the test would pass without exercising anything.
    ENV["CALLPROOF_CALL_PROVIDER"] = "calle"
    ENV["CALLE_API_KEY"] = "test-key-not-a-credential"

    request = create_preview
    request.update!(status: "unresolved", live_mode: true, confirmed_at: Time.current)

    reached = false
    provider = Object.new
    provider.define_singleton_method(:call) { |**| reached = true; raise error }
    CallProviders.singleton_class.alias_method(:current_without_stub, :current)
    CallProviders.define_singleton_method(:current) { provider }

    post reconcile_live_call_path(request), headers: operator_auth_headers

    # A guard on the test itself: every precondition in the action raises the same error
    # class the provider does, so without this an unmet precondition would look like a
    # passing test that never reached the code under test.
    assert reached, "the provider was never called: #{flash[:alert]}"
    request
  ensure
    if CallProviders.singleton_class.method_defined?(:current_without_stub)
      CallProviders.singleton_class.alias_method(:current, :current_without_stub)
      CallProviders.singleton_class.remove_method(:current_without_stub)
    end
    ENV["CALLPROOF_LIVE_CALLS"] = previous_live
    ENV["CALLPROOF_CALL_PROVIDER"] = previous_provider
    ENV["CALLE_API_KEY"] = previous_key
  end

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
        maximum_surcharge_dollars: "250.00",
        delivery_date: "2026-08-07",
        delivery_time: "09:00"
      }
    }
  end
end
