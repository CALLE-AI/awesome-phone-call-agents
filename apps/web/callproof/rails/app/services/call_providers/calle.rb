# frozen_string_literal: true

require "json"
require "net/http"

module CallProviders
  class Calle
    class Error < StandardError; end
    class SafetyError < Error; end

    def initialize(
      api_key: ENV["CALLE_API_KEY"],
      base_url: ENV.fetch("CALLE_BASE_URL", "https://api.heycall-e.com"),
      webhook_url: ENV.fetch("CALLE_WEBHOOK_URL", "https://localhost/calle/webhook"),
      transport: nil
    )
      @api_key = api_key
      @base_url = base_url
      @webhook_url = webhook_url
      @transport = transport || method(:perform_request)
    end

    def call(call_request:, contract:)
      validate_safety!(call_request)
      return call_request.phone_call if call_request.phone_call

      response = create_call(payload(call_request, contract), idempotency_key: call_request.idempotency_key)
      provider_call_id = response["call_id"] || response.fetch("id")
      call_request.create_phone_call!(
        provider: "calle",
        provider_call_id: provider_call_id,
        status: response.fetch("status", "pending"),
        transcript: { "language" => locale(call_request).split("-").first, "turns" => [] },
        structured_result: {},
        started_at: Time.current
      ).tap do |phone_call|
        call_request.update!(status: "running")
        PollCalleCallJob.set(wait: 60.seconds).perform_later(phone_call.id)
      end
    end

    def retrieve(provider_call_id)
      uri = URI.join(@base_url.end_with?("/") ? @base_url : "#{@base_url}/", "v1/calls/#{provider_call_id}")
      request = Net::HTTP::Get.new(uri)
      request["Authorization"] = "Bearer #{@api_key}"
      response = @transport.call(uri, request)
      raise Error, "CALL-E HTTP #{response.code}: #{response.body}" unless response.code == "200"

      JSON.parse(response.body)
    end

    private

    def validate_safety!(call_request)
      raise SafetyError, "CALLPROOF_LIVE_CALLS must be exactly true" unless ENV["CALLPROOF_LIVE_CALLS"] == "true"
      raise SafetyError, "call request is not marked for live execution" unless call_request.live_mode?
      raise SafetyError, "live call has not been explicitly confirmed" if call_request.confirmed_at.blank?
      raise SafetyError, "CALLE_API_KEY is missing" if @api_key.blank?
      raise SafetyError, "CALL-E webhook URL must use HTTPS" unless URI(@webhook_url).scheme == "https"
    end

    def payload(call_request, contract)
      {
        task: task(contract),
        recipients: [ {
          phones: [ call_request.recipient_phone_e164 ],
          region: region(call_request),
          locale: locale(call_request)
        } ],
        result_schema: {
          type: "object",
          required: [ "completed_count" ],
          properties: { completed_count: { type: "integer" } }
        },
        recipient_result_schema: recipient_result_schema,
        metadata: {
          call_request_id: call_request.id.to_s,
          agentkit_run_id: call_request.agentkit_run_id,
          contract_hash: contract.snapshot_hash
        }.compact,
        webhook_url: @webhook_url
      }
    end

    def task(contract)
      <<~TASK.squish
        #{contract.objective}
        Success conditions: #{contract.success_conditions.join(", ")}.
        Allowed commitments: #{JSON.generate(contract.allowed_commitments)}.
        Forbidden commitments: #{contract.forbidden_commitments.join(", ")}.
        Required disclosures: #{contract.required_disclosures.join(", ")}.
        Escalate instead of committing when: #{contract.escalation_conditions.join(", ")}.
      TASK
    end

    def recipient_result_schema
      {
        type: "object",
        required: %w[delivery_changed surcharge_cents],
        additionalProperties: false,
        properties: {
          delivery_changed: { type: "boolean" },
          delivery_date: { type: [ "string", "null" ] },
          delivery_time: { type: [ "string", "null" ] },
          surcharge_cents: { type: "integer", minimum: 0 },
          order_number_confirmed: { type: "boolean" }
        }
      }
    end

    def region(call_request)
      call_request.provider_profile.metadata.fetch("region", "US")
    end

    def locale(call_request)
      call_request.provider_profile.metadata.fetch("locale", "en-US")
    end

    def create_call(document, idempotency_key:)
      uri = URI.join(@base_url.end_with?("/") ? @base_url : "#{@base_url}/", "v1/calls")
      request = Net::HTTP::Post.new(uri)
      request["Authorization"] = "Bearer #{@api_key}"
      request["Content-Type"] = "application/json"
      request["Idempotency-Key"] = idempotency_key
      request.body = JSON.generate(document)
      response = @transport.call(uri, request)
      raise Error, "CALL-E HTTP #{response.code}: #{response.body}" unless %w[200 201 202].include?(response.code)

      JSON.parse(response.body)
    end

    def perform_request(uri, request)
      Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
        http.open_timeout = 5
        http.read_timeout = 20
        http.request(request)
      end
    end
  end
end
