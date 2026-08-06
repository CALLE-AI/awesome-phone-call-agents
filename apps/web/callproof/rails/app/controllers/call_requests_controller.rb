# frozen_string_literal: true

class CallRequestsController < ApplicationController
  include OperatorAuthenticated

  before_action :load_call_request
  # The public safe demo shows fictional demo requests. Operator/live-workflow requests
  # carry real objectives and recipient data — including previews stored before
  # confirmation (live_mode=false) — so they require operator authentication. The
  # predicate checks operator_initiated OR live_mode OR confirmed_at (defense in depth):
  # gating on operator_initiated alone would expose any row predating that column.
  before_action :authenticate_operator!, if: -> { @call_request.requires_operator_auth? }

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
