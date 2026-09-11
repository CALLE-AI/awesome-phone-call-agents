# frozen_string_literal: true

class PollCalleCallJob < ApplicationJob
  queue_as :default

  TERMINAL_FAILURES = %w[failed canceled cancelled].freeze

  def perform(phone_call_id)
    phone_call = PhoneCall.find(phone_call_id)
    return if phone_call.status == "completed"

    begin
      result = client.retrieve(phone_call.provider_call_id)
    rescue CallProviders::Calle::AmbiguousError
      # Transient (timeout/5xx) — outcome still unknown, so re-poll instead of
      # declaring a terminal failure.
      self.class.set(wait: 10.seconds).perform_later(phone_call.id)
      return
    end

    status = result.fetch("status")
    if status == "completed"
      process_completion(phone_call, result)
    elsif TERMINAL_FAILURES.include?(status)
      fail_call(phone_call)
    else
      self.class.set(wait: 10.seconds).perform_later(phone_call.id)
    end
  end

  private

  def client
    CallProviders::Calle.new
  end

  def process_completion(phone_call, result)
    begin
      CallProviders::PersistCalleResult.call(phone_call, result)
    rescue CallProviders::PersistCalleResult::ResultIntegrityError => error
      # CALL-E reported "completed" but the payload does not prove a real,
      # matching, finished call. Fail closed rather than auto-verify it.
      Rails.logger.warn("[PollCalleCallJob] rejecting untrusted completion: #{error.message}")
      fail_call(phone_call)
      return
    end

    analysis = CallAnalyzers.current.call(
      phone_call: phone_call,
      contract: phone_call.call_request.call_contract
    )
    ReviewCallAnalysisFlow.call(call_analysis: analysis) if analysis.completed?
  end

  def fail_call(phone_call)
    phone_call.update!(status: "failed", completed_at: Time.current)
    phone_call.call_request.update!(status: "failed")
  end
end
