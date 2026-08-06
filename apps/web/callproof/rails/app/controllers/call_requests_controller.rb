# frozen_string_literal: true

class CallRequestsController < ApplicationController
  include OperatorAuthenticated

  before_action :load_call_request
  # The public safe demo shows fictional demo requests. Operator/live-workflow requests
  # carry real objectives and recipient data — including previews stored before
  # confirmation (live_mode=false) — so they require operator authentication. Gate on
  # origin (operator_initiated), NOT on live_mode, or previews would leak.
  before_action :authenticate_operator!, if: -> { @call_request.operator_initiated? }

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
