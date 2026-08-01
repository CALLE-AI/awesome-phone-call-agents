# frozen_string_literal: true

module CallAnalyzers
  class Fake
    def call(phone_call:, contract:)
      return phone_call.call_analysis if phone_call.call_analysis

      surcharge = phone_call.structured_result.fetch("surcharge_cents")
      maximum = contract.allowed_commitments.fetch("maximum_surcharge_cents")
      violation = surcharge > maximum
      evidence = build_evidence(violation, surcharge, maximum)
      verdict = {
        "goal_completion" => "complete",
        "policy_adherence" => !violation,
        "unauthorized_commitment" => violation,
        "result_confidence" => 0.98,
        "risk_score" => violation ? 0.91 : 0.08,
        "needs_human_review" => violation,
        "summary" => violation ?
          "The delivery was changed, but the agent accepted a surcharge above the authorized limit." :
          "The delivery was changed and all commitments remained inside the authorized policy.",
        "negotiated_terms" => {
          "surcharge_cents" => surcharge,
          "maximum_authorized_surcharge_cents" => maximum,
          "delivery_date" => phone_call.structured_result["delivery_date"],
          "delivery_time" => phone_call.structured_result["delivery_time"]
        },
        "missing_disclosures" => [],
        "contradictions" => [],
        "recommended_memories" => [],
        "evidence" => evidence
      }

      CallAnalysis.transaction do
        analysis = phone_call.create_call_analysis!(
          external_analysis_id: SecureRandom.uuid,
          status: "completed",
          verdict: verdict,
          result_confidence: verdict.fetch("result_confidence"),
          needs_human_review: violation,
          analyzed_at: Time.current
        )
        evidence.each do |item|
          analysis.analysis_evidences.create!(
            finding: item.fetch("finding"),
            transcript_turn_ids: item.fetch("turn_ids"),
            explanation: item.fetch("explanation")
          )
        end
        analysis
      end
    end

    private

    def build_evidence(violation, surcharge, maximum)
      return [ {
        "finding" => "policy_compliance",
        "turn_ids" => [ 3, 4 ],
        "explanation" => "The accepted surcharge of #{money(surcharge)} is within the #{money(maximum)} limit."
      } ] unless violation

      [ {
        "finding" => "unauthorized_surcharge",
        "turn_ids" => [ 3, 4 ],
        "explanation" => "The agent accepted #{money(surcharge)}, exceeding the authorized limit of #{money(maximum)}."
      } ]
    end

    def money(cents)
      format("$%.2f", cents / 100.0)
    end
  end
end
