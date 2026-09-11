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
    assert_equal %w[delivery_date delivery_time surcharge_cents].sort,
                 document.dig("recipient_result_schema", "required").sort
    assert_includes document.fetch("task"), "maximum_surcharge_cents"
    assert_includes document.fetch("task"), "Exact verification statements"
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

  test "never sends the bearer credential to a plain-HTTP or arbitrary base URL" do
    previous_live = ENV["CALLPROOF_LIVE_CALLS"]
    ENV["CALLPROOF_LIVE_CALLS"] = "true"
    request, contract = live_confirmed_request
    called = false
    transport = ->(_uri, _req) { called = true }

    http_error = assert_raises(CallProviders::Calle::SafetyError) do
      CallProviders::Calle.new(
        api_key: "test-key", base_url: "http://api.heycall-e.com",
        webhook_url: "https://rails.test/calle/webhook", transport: transport
      ).call(call_request: request, contract: contract)
    end
    assert_match(/HTTPS/, http_error.message)

    host_error = assert_raises(CallProviders::Calle::SafetyError) do
      CallProviders::Calle.new(
        api_key: "test-key", base_url: "https://evil.example.com",
        webhook_url: "https://rails.test/calle/webhook", transport: transport
      ).call(call_request: request, contract: contract)
    end
    assert_match(/not in the allowed host list/, host_error.message)
    assert_not called, "no HTTP request should be attempted for an untrusted endpoint"
  ensure
    ENV["CALLPROOF_LIVE_CALLS"] = previous_live
  end

  test "treats a 5xx create as ambiguous and places no replacement call" do
    previous_live = ENV["CALLPROOF_LIVE_CALLS"]
    ENV["CALLPROOF_LIVE_CALLS"] = "true"
    request, contract = live_confirmed_request
    attempts = 0
    transport = lambda do |_uri, _req|
      attempts += 1
      Struct.new(:code, :body).new("503", "upstream unavailable")
    end

    error = assert_raises(CallProviders::Calle::AmbiguousError) do
      CallProviders::Calle.new(
        api_key: "test-key", webhook_url: "https://rails.test/calle/webhook", transport: transport
      ).call(call_request: request, contract: contract)
    end

    assert_match(/Idempotency-Key #{request.idempotency_key}/, error.message)
    assert_equal 1, attempts, "must not auto-retry / place a replacement call"
    assert_nil request.reload.phone_call
    # Ambiguous outcome is not "failed" — it is unresolved, awaiting reconciliation.
    assert_equal "unresolved", request.status
  ensure
    ENV["CALLPROOF_LIVE_CALLS"] = previous_live
  end

  test "a 409 idempotency conflict is ambiguous, not a definitive no-call" do
    previous_live = ENV["CALLPROOF_LIVE_CALLS"]
    ENV["CALLPROOF_LIVE_CALLS"] = "true"
    request, contract = live_confirmed_request
    attempts = 0
    transport = lambda do |_uri, _req|
      attempts += 1
      Struct.new(:code, :body).new("409", '{"error":"idempotency key already used"}')
    end

    assert_raises(CallProviders::Calle::AmbiguousError) do
      CallProviders::Calle.new(
        api_key: "test-key", webhook_url: "https://rails.test/calle/webhook", transport: transport
      ).call(call_request: request, contract: contract)
    end

    # The original call may exist; never report "no call was placed".
    assert_equal "unresolved", request.reload.status
    assert_equal 1, attempts, "must not auto-retry"
  ensure
    ENV["CALLPROOF_LIVE_CALLS"] = previous_live
  end

  # A reconciliation replays the same Idempotency-Key. Only a rejection of the payload
  # itself carries information about the ORIGINAL request; an auth or quota failure is
  # about this attempt, and must not be read as "no call was placed".
  %w[401 403 404 429].each do |code|
    test "a #{code} does not prove the original request was rejected" do
      previous_live = ENV["CALLPROOF_LIVE_CALLS"]
      ENV["CALLPROOF_LIVE_CALLS"] = "true"
      request, contract = live_confirmed_request
      transport = ->(_uri, _req) { Struct.new(:code, :body).new(code, '{"error":"nope"}') }

      error = assert_raises(CallProviders::Calle::AmbiguousError) do
        CallProviders::Calle.new(
          api_key: "test-key", webhook_url: "https://rails.test/calle/webhook", transport: transport
        ).call(call_request: request, contract: contract)
      end

      assert_not_kind_of CallProviders::Calle::DefinitiveRejectionError, error
      assert_equal "unresolved", request.reload.status
    ensure
      ENV["CALLPROOF_LIVE_CALLS"] = previous_live
    end
  end

  test "a rejection of the payload itself is definitive" do
    previous_live = ENV["CALLPROOF_LIVE_CALLS"]
    ENV["CALLPROOF_LIVE_CALLS"] = "true"
    request, contract = live_confirmed_request
    transport = ->(_uri, _req) { Struct.new(:code, :body).new("422", '{"error":"bad phone"}') }

    assert_raises(CallProviders::Calle::DefinitiveRejectionError) do
      CallProviders::Calle.new(
        api_key: "test-key", webhook_url: "https://rails.test/calle/webhook", transport: transport
      ).call(call_request: request, contract: contract)
    end
  ensure
    ENV["CALLPROOF_LIVE_CALLS"] = previous_live
  end

  test "a definitive 4xx rejection is still a hard error" do
    previous_live = ENV["CALLPROOF_LIVE_CALLS"]
    ENV["CALLPROOF_LIVE_CALLS"] = "true"
    request, contract = live_confirmed_request
    transport = ->(_uri, _req) { Struct.new(:code, :body).new("400", '{"error":"bad phone"}') }

    error = assert_raises(CallProviders::Calle::Error) do
      CallProviders::Calle.new(
        api_key: "test-key", webhook_url: "https://rails.test/calle/webhook", transport: transport
      ).call(call_request: request, contract: contract)
    end
    assert_not_kind_of CallProviders::Calle::AmbiguousError, error
    assert_not_equal "unresolved", request.reload.status
  ensure
    ENV["CALLPROOF_LIVE_CALLS"] = previous_live
  end

  private

  def live_confirmed_request
    provider, policy = Demo::Setup.call
    request = CallRequest.create!(
      provider_profile: provider,
      call_policy: policy,
      recipient_phone_e164: provider.phone_number_e164,
      objective: "Move order C1023 to Friday without exceeding $250.",
      simulation_scenario: "compliant",
      live_mode: true,
      confirmed_at: Time.current
    )
    [ request, CallContracts::Build.call(request) ]
  end
end
