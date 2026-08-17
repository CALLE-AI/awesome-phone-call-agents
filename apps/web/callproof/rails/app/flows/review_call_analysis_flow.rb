# frozen_string_literal: true

class ReviewCallAnalysisFlow < Agentkit::Flow
  input :call_analysis
  idempotency ->(input) { "review-call-analysis:#{input.fetch(:call_analysis).id}" }

  step :route_review do |ctx|
    analysis = ctx.input.fetch(:call_analysis)
    suggestion = CallReviews::Route.call(
      analysis,
      gate_key: "#{ctx.run.run_id}:review_exception",
      run_id: ctx.run.run_id,
      flow: "ReviewCallAnalysisFlow"
    )
    analysis.phone_call.call_request.update!(status: "waiting_human") if suggestion
    suggestion
  end

  human_gate :review_exception,
             type: "call_policy_exception",
             if: ->(ctx) { ctx.input.fetch(:call_analysis).needs_human_review? }

  step :finalize do |ctx|
    analysis = ctx.input.fetch(:call_analysis)
    status = if !analysis.needs_human_review?
      "verified"
    elsif ctx[:review_exception].approved?
      "approved"
    else
      "rejected"
    end
    analysis.phone_call.call_request.update!(status: status)
    Agentkit.probe(:callproof_remote_verdict,
                   dims: { status: status, policy_adherence: analysis.verdict.fetch("policy_adherence") })
    analysis
  end
end
