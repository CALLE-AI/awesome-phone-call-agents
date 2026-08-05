# frozen_string_literal: true

class CallRequestsController < ApplicationController
  include OperatorAuthenticated

  before_action :load_call_request
  # The public safe demo shows fictional (non-live) requests. Live requests carry
  # real recipient/analysis data, so they require operator authentication.
  before_action :authenticate_operator!, if: -> { @call_request.live_mode? }

  def show
    @analysis = @call_request.call_analysis
    @suggestion = Agentkit::HITL.pending.find do |item|
      item.payload["call_request_id"] == @call_request.id
    end
  end

  private

  def load_call_request
    @call_request = CallRequest.includes(
      :provider_profile,
      :call_contract,
      phone_call: { call_analysis: :analysis_evidences }
    ).find(params[:id])
  end
end
