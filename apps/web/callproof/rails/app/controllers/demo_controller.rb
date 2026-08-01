# frozen_string_literal: true

class DemoController < ApplicationController
  def index
    @recent_call_requests = CallRequest.order(created_at: :desc).limit(8)
  end

  def create
    provider, policy = Demo::Setup.call
    call_request = CallRequest.create!(
      provider_profile: provider,
      call_policy: policy,
      recipient_phone_e164: provider.phone_number_e164,
      objective: demo_params.fetch(:objective),
      simulation_scenario: demo_params.fetch(:simulation_scenario),
      live_mode: false
    )

    result = ExecutePhoneCallFlow.call(call_request: call_request)
    call_request.update!(agentkit_run_id: result.run.run_id)
    redirect_to call_request_path(call_request)
  rescue ActiveRecord::RecordInvalid, KeyError => error
    redirect_to root_path, alert: error.message
  end

  private

  def demo_params
    params.expect(call_request: %i[objective simulation_scenario])
  end
end
