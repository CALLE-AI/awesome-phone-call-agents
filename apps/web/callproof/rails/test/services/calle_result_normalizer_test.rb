require "test_helper"

class CalleResultNormalizerTest < ActiveSupport::TestCase
  # Captured from a real CALL-E MCP get_call_run (28s completed test call).
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
