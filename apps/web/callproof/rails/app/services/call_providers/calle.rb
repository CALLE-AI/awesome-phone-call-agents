# frozen_string_literal: true

require "json"
require "net/http"

module CallProviders
  class Calle
    class Error < StandardError; end
    class SafetyError < Error; end
    # Raised when a create attempt fails in a way that leaves the outcome unknown
    # (timeout, connection reset, or a 5xx from CALL-E). The call may or may not
    # have been placed, so callers must NOT issue a replacement create. Because the
    # stable Idempotency-Key is reused, a deliberate retry is deduplicated provider
    # side rather than dialing twice.
    class AmbiguousError < Error; end

    # Raised when the ORIGINAL create request is rejected on its own merits. A later
    # reconciliation error never proves what happened to the original request; the
    # controller therefore keeps an already-unresolved request unresolved.
    class DefinitiveRejectionError < Error; end

    AMBIGUOUS_NETWORK_ERRORS = [
      Timeout::Error, Errno::ECONNRESET, Errno::ECONNREFUSED, Errno::EHOSTUNREACH,
      Errno::ETIMEDOUT, EOFError, SocketError, IOError
    ].freeze

    # 4xx codes that do NOT prove the call was rejected, so they must never be reported
    # as "no call was placed":
    #   409 — idempotency conflict. The SAME Idempotency-Key is already in flight or
    #         already created a call, i.e. the original call most likely EXISTS.
    #   408 — the server timed out reading the request; it may still have processed it.
    AMBIGUOUS_HTTP_CODES = %w[408 409].freeze

    # On the original create, these codes definitively reject that request. During a later
    # reconciliation the same codes say nothing reliable about the original timed-out
    # attempt, so LiveCallsController deliberately keeps the prior unresolved state.
    DEFINITIVE_REJECTION_HTTP_CODES = %w[400 422].freeze

    # Canonical CALL-E API host the Bearer credential may be sent to. A custom
    # base URL must be explicitly allow-listed via CALLE_ALLOWED_HOSTS.
    DEFAULT_ALLOWED_HOSTS = %w[api.heycall-e.com].freeze

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

      begin
        response = create_call(payload(call_request, contract), idempotency_key: call_request.idempotency_key)
      rescue AmbiguousError
        # Outcome unknown — the call may have been accepted. Do NOT collapse to "failed".
        # Mark the request unresolved so it is reconciled (re-attempt reuses the stable
        # Idempotency-Key, so CALL-E deduplicates rather than dialing twice).
        call_request.update!(status: "unresolved")
        raise
      end
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
      ensure_trusted_endpoint!
      uri = URI.join(@base_url.end_with?("/") ? @base_url : "#{@base_url}/", "v1/calls/#{provider_call_id}")
      request = Net::HTTP::Get.new(uri)
      request["Authorization"] = "Bearer #{@api_key}"

      begin
        response = @transport.call(uri, request)
      rescue *AMBIGUOUS_NETWORK_ERRORS => error
        raise AmbiguousError, "CALL-E status fetch failed transiently (#{error.class}: #{error.message})"
      end

      code = response.code.to_s
      return JSON.parse(response.body) if code == "200"
      if code.start_with?("5") || AMBIGUOUS_HTTP_CODES.include?(code)
        raise AmbiguousError, "CALL-E status fetch returned #{code}"
      end

      raise Error, "CALL-E HTTP #{code}: #{response.body}"
    end

    private

    def validate_safety!(call_request)
      raise SafetyError, "CALLPROOF_LIVE_CALLS must be exactly true" unless ENV["CALLPROOF_LIVE_CALLS"] == "true"
      raise SafetyError, "call request is not marked for live execution" unless call_request.live_mode?
      raise SafetyError, "live call has not been explicitly confirmed" if call_request.confirmed_at.blank?
      raise SafetyError, "CALLE_API_KEY is missing" if @api_key.blank?
      raise SafetyError, "CALL-E webhook URL must use HTTPS" unless URI(@webhook_url).scheme == "https"
      ensure_trusted_endpoint!
    end

    # The Bearer credential must only ever leave the process over TLS to an
    # allow-listed host. This blocks an arbitrary or plain-HTTP base URL from
    # capturing the server CALL-E key.
    def ensure_trusted_endpoint!
      uri = URI(@base_url)
      raise SafetyError, "CALLE_BASE_URL must use HTTPS" unless uri.scheme == "https"
      raise SafetyError, "CALLE_BASE_URL is missing a host" if uri.host.blank?

      unless allowed_hosts.include?(uri.host.downcase)
        raise SafetyError, "CALLE_BASE_URL host '#{uri.host}' is not in the allowed host list"
      end
    end

    def allowed_hosts
      configured = ENV["CALLE_ALLOWED_HOSTS"].to_s.split(",").map { |host| host.strip.downcase }.reject(&:empty?)
      return configured if configured.any?

      DEFAULT_ALLOWED_HOSTS
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
        recipient_result_schema: recipient_result_schema(contract),
        metadata: {
          call_request_id: call_request.id.to_s,
          agentkit_run_id: call_request.agentkit_run_id,
          contract_hash: contract.snapshot_hash
        }.compact,
        webhook_url: @webhook_url
      }
    end

    def task(contract)
      protocol_lines = VerificationClaims::DeliveryChange.protocol_lines(
        claims: contract.verification_claims,
        language: contract.protocol_language
      )
      <<~TASK.squish
        #{contract.objective}
        Success conditions: #{contract.success_conditions.join(", ")}.
        Allowed commitments: #{JSON.generate(contract.allowed_commitments)}.
        Forbidden commitments: #{contract.forbidden_commitments.join(", ")}.
        Required disclosures: #{contract.required_disclosures.join(", ")}.
        Escalate instead of committing when: #{contract.escalation_conditions.join(", ")}.
        Exact verification statements: #{JSON.generate(protocol_lines)}.
        Say each statement exactly. Render {amount} as a USD amount with two decimals and
        obtain a bare #{contract.protocol_language == "es" ? "SÍ" : "YES"} in the immediately
        following recipient turn. Do not paraphrase these verification statements.
      TASK
    end

    def recipient_result_schema(contract)
      properties = {}
      required = []
      contract.verification_claims.each do |claim|
        field = claim["result_field"]
        next if field.blank?

        required << field
        properties[field] = result_field_schema(claim)
      end

      {
        type: "object",
        required: required.uniq,
        additionalProperties: false,
        properties: properties
      }
    end

    def result_field_schema(claim)
      return { type: "integer", minimum: 0 } if claim.fetch("kind") == "commitment_limit"
      return { type: "string", format: "date" } if claim.fetch("id") == "delivery_date_confirmed"
      return { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" } if claim.fetch("id") == "delivery_time_confirmed"

      case claim["expected"]
      when true, false then { type: "boolean" }
      when Integer then { type: "integer" }
      else { type: "string" }
      end
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

      begin
        response = @transport.call(uri, request)
      rescue *AMBIGUOUS_NETWORK_ERRORS => error
        raise AmbiguousError,
              "CALL-E create outcome unknown (#{error.class}: #{error.message}); no replacement will be placed. " \
              "Reconcile with Idempotency-Key #{idempotency_key} before retrying."
      end

      code = response.code.to_s
      return JSON.parse(response.body) if %w[200 201 202].include?(code)

      if DEFINITIVE_REJECTION_HTTP_CODES.include?(code)
        raise DefinitiveRejectionError, "CALL-E rejected the request itself — HTTP #{code}: #{response.body}"
      end

      # Everything else — 5xx, 408, 409, and every 4xx we cannot interpret (401, 403,
      # 404, 429, …) — leaves the outcome unknown. On a first attempt that means "we do
      # not know whether it dialed"; on a reconciliation it means "this tells us nothing
      # about the original request", which is the same answer.
      raise AmbiguousError,
            "CALL-E create returned #{code}; outcome unknown, no replacement will be placed. " \
            "Reconcile with Idempotency-Key #{idempotency_key} before retrying. Body: #{response.body}"
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
