require "test_helper"

class CalleResultNormalizerTest < ActiveSupport::TestCase
  # Verbatim capture of a real CALL-E MCP get_call_run (28s completed test call). The
  # transcript inside is Spanish because the call itself was placed in Spanish — it is
  # evidence, so it is stored as returned rather than translated. The app's own UI and
  # copy are English throughout; the only other Spanish in this codebase is the
  # transcript-matching vocabulary in the analyzer's TERM_SYNONYMS, which exists so a
  # Spanish-language call can still be audited.
  def mcp_payload
    JSON.parse(file_fixture("calle_mcp_get_call_run.json").read)
  end

  test "leaves a REST-shape payload untouched" do
    rest = { "status" => "completed", "recipients" => [ { "status" => "completed" } ] }
    assert_same rest, CallProviders::CalleResultNormalizer.canonicalize(rest)
  end

  test "canonicalizes the MCP shape into the REST envelope" do
    canonical = CallProviders::CalleResultNormalizer.canonicalize(mcp_payload)

    assert_equal "completed", canonical["status"]
    assert_equal true, canonical["task_completed"]
    recipient = canonical.fetch("recipients").first
    assert_equal "completed", recipient["status"]
    assert_equal [ "+522214324074" ], recipient["phones"]
    assert_in_delta 0.93, recipient["result_confidence"], 0.001

    turns = recipient.dig("attempts", 0, "transcript_turns")
    assert turns.first["speaker"] == "bot"
    user_confirmation = turns.find { |t| t["speaker"] == "user" && t["text"].include?("prueba fue exitosa") }
    assert user_confirmation, "expected a user turn confirming the test"
    # Offset parsed from the [hh:mm:ss] marker.
    assert_equal 18, user_confirmation["offset_seconds"]
  end

  test "persists a completed MCP call through the same validation path" do
    phone_call = calle_phone_call(recipient: "+522214324074")

    CallProviders::PersistCalleResult.call(phone_call, mcp_payload)

    phone_call.reload
    assert_equal "completed", phone_call.status
    assert_equal "agent", phone_call.transcript.dig("turns", 0, "speaker")
    assert(phone_call.transcript["turns"].any? { |t| t["speaker"] == "recipient" })
    assert_equal true, phone_call.structured_result["task_completed"]
  end

  test "fails closed when the MCP recipient phone does not match the request" do
    phone_call = calle_phone_call(recipient: "+525599999999")

    assert_raises(CallProviders::PersistCalleResult::ResultIntegrityError) do
      CallProviders::PersistCalleResult.call(phone_call, mcp_payload)
    end
  end

  test "a declined MCP call is rejected as untrusted" do
    declined = mcp_payload
    declined["status"] = "DECLINED"
    declined["result"]["outcome"]["task_completed"] = false
    phone_call = calle_phone_call(recipient: "+522214324074")

    assert_raises(CallProviders::PersistCalleResult::ResultIntegrityError) do
      CallProviders::PersistCalleResult.call(phone_call, declined)
    end
  end

  # --- strict result integrity (REST shape) --------------------------------------
  # A complete, trustworthy REST payload for the requested number.
  def rest_result(phone:, overrides: {})
    {
      "status" => "completed",
      "task_completed" => true,
      "completion_confidence" => { "score" => 0.9 },
      "recipients" => [ {
        "status" => "completed",
        "phones" => [ phone ],
        "result_confidence" => 0.9,
        "structured_result" => { "completed_count" => 1 },
        "attempts" => [ { "transcript_turns" => [ { "offset_seconds" => 0, "speaker" => "bot", "text" => "hi" } ] } ]
      }.merge(overrides) ]
    }
  end

  test "accepts a complete REST result" do
    phone_call = calle_phone_call(recipient: "+525512345678")
    CallProviders::PersistCalleResult.call(phone_call, rest_result(phone: "+525512345678"))
    assert_equal "completed", phone_call.reload.status
  end

  test "fails closed when recipient status is missing" do
    phone_call = calle_phone_call(recipient: "+525512345678")
    payload = rest_result(phone: "+525512345678", overrides: { "status" => "" })
    error = assert_raises(CallProviders::PersistCalleResult::ResultIntegrityError) do
      CallProviders::PersistCalleResult.call(phone_call, payload)
    end
    assert_match(/status is missing/, error.message)
  end

  test "fails closed when the recipient phone is not bound" do
    phone_call = calle_phone_call(recipient: "+525512345678")
    payload = rest_result(phone: "+525512345678", overrides: { "phones" => [] })
    error = assert_raises(CallProviders::PersistCalleResult::ResultIntegrityError) do
      CallProviders::PersistCalleResult.call(phone_call, payload)
    end
    assert_match(/does not bind a recipient phone/, error.message)
  end

  test "fails closed when confidence is missing" do
    phone_call = calle_phone_call(recipient: "+525512345678")
    payload = rest_result(phone: "+525512345678", overrides: { "result_confidence" => nil })
    payload.delete("completion_confidence")
    error = assert_raises(CallProviders::PersistCalleResult::ResultIntegrityError) do
      CallProviders::PersistCalleResult.call(phone_call, payload)
    end
    assert_match(/confidence is missing/, error.message)
  end

  test "does not infer completion from counts or terminal status" do
    phone_call = calle_phone_call(recipient: "+525512345678")
    # completed_count=1 and status=completed present, but task_completed is NOT explicitly true.
    payload = rest_result(phone: "+525512345678")
    payload["task_completed"] = nil
    error = assert_raises(CallProviders::PersistCalleResult::ResultIntegrityError) do
      CallProviders::PersistCalleResult.call(phone_call, payload)
    end
    assert_match(/did not explicitly set task_completed=true/, error.message)
  end

  private

  def calle_phone_call(recipient:)
    provider, policy = Demo::Setup.call
    request = CallRequest.create!(
      provider_profile: provider,
      call_policy: policy,
      recipient_phone_e164: recipient,
      objective: "Controlled CallProof test call.",
      simulation_scenario: "compliant"
    )
    CallContracts::Build.call(request)
    request.create_phone_call!(
      provider: "calle",
      provider_call_id: "call_mcp_test",
      status: "queued",
      transcript: { "language" => "es", "turns" => [] },
      structured_result: {},
      started_at: Time.current
    )
  end
end
