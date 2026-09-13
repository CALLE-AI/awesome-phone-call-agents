# frozen_string_literal: true

require "digest"

class CallAnalyzerWebhooksController < ApplicationController
  skip_forgery_protection

  def create
    body = request.raw_post
    unless valid_signature?(body)
      return render json: { error: "invalid signature" }, status: :unauthorized
    end

    payload = JSON.parse(body)
    event = CallAnalyzerWebhooks::Process.call(
      payload: payload,
      event_id: request.headers.fetch("X-CallProof-Event-Id"),
      payload_sha256: Digest::SHA256.hexdigest(body)
    )
    render json: { received: true, event_id: event.event_id }
  rescue KeyError, JSON::ParserError => error
    render json: { error: error.message }, status: :unprocessable_content
  rescue ActiveRecord::RecordNotFound => error
    render json: { error: error.message }, status: :not_found
  rescue CallAnalyzerWebhooks::Process::ReplayConflict => error
    render json: { error: error.message }, status: :conflict
  end

  private

  def valid_signature?(body)
    CallAnalyzerWebhooks::Verify.call(
      body: body,
      timestamp: request.headers["X-CallProof-Timestamp"],
      signature: request.headers["X-CallProof-Signature"],
      secret: ENV["CALLPROOF_ANALYZER_WEBHOOK_SECRET"]
    )
  end
end
