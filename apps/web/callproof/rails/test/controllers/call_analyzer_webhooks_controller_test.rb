require "test_helper"

class CallAnalyzerWebhooksControllerTest < ActionDispatch::IntegrationTest
  setup do
    provider, policy = Demo::Setup.call
    call_request = CallRequest.create!(
      provider_profile: provider,
      call_policy: policy,
      recipient_phone_e164: provider.phone_number_e164,
      objective: "Move fictional order C1023 to Friday at 9 AM without exceeding $250.",
      simulation_scenario: "policy_violation"
    )
    contract = CallContracts::Build.call(call_request)
    phone_call = CallProviders::Fake.new.call(call_request: call_request, contract: contract)
    @request_id = SecureRandom.uuid
    @analysis_id = SecureRandom.uuid
    @analysis = phone_call.create_call_analysis!(
      request_id: @request_id,
      external_analysis_id: @analysis_id,
      status: "received",
      verdict: {},
      result_confidence: 0
    )
  end

  test "accepts a signed result once and persists evidence" do
    secret = "controller-test-secret"
    body = JSON.generate(completed_payload)
    timestamp = Time.current.to_i.to_s
    signature = OpenSSL::HMAC.hexdigest("SHA256", secret, "#{timestamp}.#{body}")
    event_id = SecureRandom.uuid
    previous_secret = ENV["CALLPROOF_ANALYZER_WEBHOOK_SECRET"]
    ENV["CALLPROOF_ANALYZER_WEBHOOK_SECRET"] = secret

    2.times do
      post "/webhooks/call_analyzer",
           params: body,
           headers: {
             "CONTENT_TYPE" => "application/json",
             "X-CallProof-Event-Id" => event_id,
             "X-CallProof-Timestamp" => timestamp,
             "X-CallProof-Signature" => "v1=#{signature}"
           }
      assert_response :success
    end

    assert_equal "completed", @analysis.reload.status
    assert @analysis.needs_human_review?
    assert_equal "waiting_human", @analysis.phone_call.call_request.reload.status
    assert_equal [ 3, 4 ], @analysis.analysis_evidences.first.transcript_turn_ids
    assert_equal 1, CallAnalyzerWebhookEvent.where(event_id: event_id).count
    suggestion = Agentkit::HITL.pending.last
    assert_equal "ReviewCallAnalysisFlow", suggestion.payload.fetch("flow")

    Agentkit::HITL.approve(suggestion.id, actor: "human:test")
    ReviewCallAnalysisFlow.resume(suggestion.payload.fetch("run_id"), mode: :sync)
    assert_equal "approved", @analysis.phone_call.call_request.reload.status
  ensure
    ENV["CALLPROOF_ANALYZER_WEBHOOK_SECRET"] = previous_secret
  end

  test "rejects an invalid signature without persisting the event" do
    post "/webhooks/call_analyzer",
         params: JSON.generate(completed_payload),
         headers: {
           "CONTENT_TYPE" => "application/json",
           "X-CallProof-Event-Id" => SecureRandom.uuid,
           "X-CallProof-Timestamp" => Time.current.to_i.to_s,
           "X-CallProof-Signature" => "v1=invalid"
         }

    assert_response :unauthorized
    assert_equal "received", @analysis.reload.status
  end

  private

  def completed_payload
    {
      "schema_version" => "2.0",
      "analysis_id" => @analysis_id,
      "request_id" => @request_id,
      "call_id" => @analysis.phone_call.provider_call_id,
      "agentkit_run_id" => nil,
      "status" => "completed",
      "completed_at" => Time.current.iso8601,
      "verdict" => {
        "goal_completion" => "complete",
        "policy_adherence" => false,
        "policy_evaluation" => "violated",
        "unauthorized_commitment" => true,
        "result_confidence" => 0.98,
        "risk_score" => 0.91,
        "needs_human_review" => true,
        "summary" => "The surcharge exceeded the authorized limit.",
        "negotiated_terms" => {
          "surcharge_cents" => 32_000,
          "maximum_authorized_surcharge_cents" => 25_000
        },
        "missing_disclosures" => [],
        "contradictions" => [],
        "recommended_memories" => [],
        "claim_results" => [ {
          "claim_id" => "surcharge_within_limit",
          "kind" => "commitment_limit",
          "status" => "violated",
          "expected" => 25_000,
          "actual" => 32_000,
          "turn_ids" => [ 3, 4 ],
          "explanation" => "The surcharge exceeded the authorized limit."
        } ],
        "evidence" => [ {
          "finding" => "unauthorized_surcharge",
          "turn_ids" => [ 3, 4 ],
          "explanation" => "The agent accepted $320.00 above the $250.00 limit."
        } ]
      },
      "metrics" => { "evaluator" => "exact-protocol-v2" }
    }
  end
end
