# frozen_string_literal: true

class CallRequestsController < ApplicationController
  def show
    @call_request = CallRequest.includes(
      :provider_profile,
      :call_contract,
      phone_call: { call_analysis: :analysis_evidences }
    ).find(params[:id])
    @analysis = @call_request.call_analysis
    @suggestion = Agentkit::HITL.pending.find do |item|
      item.payload["call_request_id"] == @call_request.id
    end
  end
end
