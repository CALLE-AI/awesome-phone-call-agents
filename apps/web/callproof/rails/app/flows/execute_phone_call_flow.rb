# frozen_string_literal: true

class ExecutePhoneCallFlow < Agentkit::Flow
  input :call_request
  idempotency ->(input) { "execute-phone-call:#{input.fetch(:call_request).id}" }

  step :build_contract do |ctx|
    CallContracts::Build.call(ctx.input.fetch(:call_request))
  end

  step :execute_call do |ctx|
    CallProviders.current.call(
      call_request: ctx.input.fetch(:call_request),
      contract: ctx[:build_contract].value
    )
  end

  step :analyze_call do |ctx|
    next unless ctx[:execute_call].value.status == "completed"

    CallAnalyzers.current.call(
      phone_call: ctx[:execute_call].value,
      contract: ctx[:build_contract].value
    )
  end

  step :route_review do |ctx|
    next unless ctx[:analyze_call].value&.completed?

    suggestion = CallReviews::Route.call(
      ctx[:analyze_call].value,
      gate_key: "#{ctx.run.run_id}:review_exception",
      run_id: ctx.run.run_id
    )
    ctx.input.fetch(:call_request).update!(status: "waiting_human") if suggestion
    suggestion
  end

  human_gate :review_exception,
             type: "call_policy_exception",
             if: ->(ctx) { ctx[:analyze_call].value&.completed? && ctx[:analyze_call].value.needs_human_review? }

  step :finalize do |ctx|
    call_request = ctx.input.fetch(:call_request)
    analysis = ctx[:analyze_call].value
    unless analysis
      call_request.update!(status: "running")
      next call_request
    end

    unless analysis.completed?
      call_request.update!(status: "waiting_analysis")
      next call_request
    end

    status = if !analysis.needs_human_review?
      "verified"
    elsif ctx[:review_exception].approved?
      "approved"
    else
      "rejected"
    end

    call_request.update!(status: status)
    Agentkit.probe(:callproof_verdict,
                   dims: { status: status, policy_adherence: analysis.verdict.fetch("policy_adherence") })
    call_request
  end
end
