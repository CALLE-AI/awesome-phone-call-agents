# frozen_string_literal: true

require "json"
require "net/http"

module CallAnalyzers
  class Http
    class Error < StandardError; end

    def initialize(
      base_url: ENV.fetch("CALLPROOF_ANALYZER_URL", "http://localhost:8001"),
      callback_url: ENV.fetch("CALLPROOF_ANALYZER_CALLBACK_URL", "https://localhost/webhooks/call_analyzer"),
      transport: nil
    )
      @base_url = base_url
      @callback_url = callback_url
      @transport = transport || method(:perform_request)
    end

    def call(phone_call:, contract:)
      return phone_call.call_analysis if phone_call.call_analysis

      request_id = SecureRandom.uuid
      analysis = phone_call.create_call_analysis!(
        request_id: request_id,
        status: "pending",
        verdict: {},
        result_confidence: 0,
        needs_human_review: false
      )

      response = post(payload(phone_call, contract, request_id))
      analysis.with_lock do
        unless analysis.completed?
          analysis.update!(
            external_analysis_id: response.fetch("analysis_id"),
            status: response.fetch("status")
          )
        end
      end
      phone_call.call_request.update!(status: "waiting_analysis") unless analysis.reload.completed?
      analysis
    rescue StandardError => error
      analysis&.update!(status: "failed")
      raise Error, "Call Analyzer submission failed: #{error.message}"
    end

    private

    def payload(phone_call, contract, request_id)
      call_request = phone_call.call_request
      {
        schema_version: "1.0",
        request_id: request_id,
        call_id: phone_call.provider_call_id,
        agentkit_run_id: call_request.agentkit_run_id,
        submitted_at: Time.current.iso8601,
        call_contract: {
          objective: contract.objective,
          success_conditions: contract.success_conditions,
          allowed_commitments: contract.allowed_commitments,
          forbidden_commitments: contract.forbidden_commitments,
          required_disclosures: contract.required_disclosures,
          escalation_conditions: contract.escalation_conditions
        },
        transcript: phone_call.transcript,
        provider_result: phone_call.structured_result,
        callback: { url: @callback_url },
        metadata: { call_request_id: call_request.id }
      }
    end

    def post(document)
      uri = URI.join(@base_url.end_with?("/") ? @base_url : "#{@base_url}/", "api/v1/analyses")
      request = Net::HTTP::Post.new(uri)
      request["Content-Type"] = "application/json"
      request["Idempotency-Key"] = document.fetch(:request_id)
      request.body = JSON.generate(document)
      response = @transport.call(uri, request)
      raise Error, "HTTP #{response.code}: #{response.body}" unless response.code == "202"

      JSON.parse(response.body)
    end

    def perform_request(uri, request)
      Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
        http.open_timeout = 3
        http.read_timeout = 10
        http.request(request)
      end
    end
  end
end
