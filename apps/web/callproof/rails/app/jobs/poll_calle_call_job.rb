# frozen_string_literal: true

class PollCalleCallJob < ApplicationJob
  queue_as :default

  TERMINAL_FAILURES = %w[failed canceled cancelled].freeze

  def perform(phone_call_id)
    phone_call = PhoneCall.find(phone_call_id)
    return if phone_call.status == "completed"

    result = client.retrieve(phone_call.provider_call_id)
    status = result.fetch("status")
    if status == "completed"
      process_completion(phone_call, result)
    elsif TERMINAL_FAILURES.include?(status)
      phone_call.update!(status: "failed", completed_at: Time.current)
      phone_call.call_request.update!(status: "failed")
    else
      self.class.set(wait: 10.seconds).perform_later(phone_call.id)
    end
  end

  private

  def client
    CallProviders::Calle.new
  end

  def process_completion(phone_call, result)
    CallProviders::PersistCalleResult.call(phone_call, result)
    analysis = CallAnalyzers.current.call(
      phone_call: phone_call,
      contract: phone_call.call_request.call_contract
    )
    ReviewCallAnalysisFlow.call(call_analysis: analysis) if analysis.completed?
  end
end
