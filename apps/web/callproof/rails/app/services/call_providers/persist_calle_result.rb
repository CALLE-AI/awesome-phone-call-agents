# frozen_string_literal: true

module CallProviders
  class PersistCalleResult
    SPEAKERS = { "bot" => "agent", "user" => "recipient" }.freeze
    COMPLETED_RECIPIENT_STATUSES = %w[completed success answered done].freeze
    MINIMUM_RESULT_CONFIDENCE = 0.5

    # Raised when a CALL-E "completed" payload cannot be trusted as a real,
    # matching, finished call. The caller marks the call failed instead of
    # silently persisting it as completed.
    class ResultIntegrityError < CallProviders::Calle::Error; end

    def self.call(phone_call, result)
      new(phone_call, result).call
    end

    def initialize(phone_call, result)
      @phone_call = phone_call
      # Accept either the REST Developer-API shape or the MCP get_call_run shape.
      @result = CallProviders::CalleResultNormalizer.canonicalize(result)
    end

    def call
      validate!
      persist!
      @phone_call
    end

    private

    attr_reader :phone_call, :result

    def recipient
      @recipient ||= Array(result["recipients"]).first
    end

    def validate!
      problems = []
      if recipient.nil?
        problems << "no recipient in CALL-E result"
      else
        problems.concat(recipient_problems)
      end
      # Require EXPLICIT completion evidence — never infer from terminal status or counts.
      problems << "result did not explicitly set task_completed=true" unless result["task_completed"] == true

      raise ResultIntegrityError, problems.join("; ") if problems.any?
    end

    def recipient_problems
      problems = []

      # Recipient status: required and must be a completed state.
      status = recipient["status"].to_s.downcase
      if status.empty?
        problems << "recipient status is missing"
      elsif !COMPLETED_RECIPIENT_STATUSES.include?(status)
        problems << "recipient status '#{recipient['status']}' is not a completed state"
      end

      # Phone binding: required and must match the requested number.
      if expected_phone.blank?
        problems << "call request has no recipient phone to bind against"
      elsif reported_phones.blank?
        problems << "result does not bind a recipient phone"
      elsif !reported_phones.include?(expected_phone)
        # Never leak the full number into logs/messages.
        problems << "recipient phone does not match the requested number"
      end

      # Confidence: required and must clear the minimum.
      confidence = result_confidence
      if confidence.nil?
        problems << "result confidence is missing"
      elsif confidence < MINIMUM_RESULT_CONFIDENCE
        problems << "result confidence #{confidence} is below #{MINIMUM_RESULT_CONFIDENCE}"
      end

      problems
    end

    def expected_phone
      phone_call.call_request.recipient_phone_e164
    end

    def reported_phones
      phones = recipient["phones"] || Array(recipient["phone"])
      Array(phones).map(&:to_s)
    end

    # Confidence lives at the recipient level (MCP-normalized) or at the top level
    # (REST `completion_confidence.score`); accept either, require one.
    def result_confidence
      raw = recipient&.dig("result_confidence") ||
            recipient&.dig("structured_result", "result_confidence") ||
            result.dig("completion_confidence", "score")
      raw.nil? ? nil : Float(raw)
    rescue ArgumentError, TypeError
      nil
    end

    def persist!
      turns = Array(recipient&.fetch("attempts", []))
        .flat_map { |attempt| attempt.fetch("transcript_turns", []) }
      phone_call.update!(
        status: "completed",
        transcript: {
          "language" => phone_call.transcript.fetch("language", "en"),
          "turns" => turns.each_with_index.map { |turn, index| self.class.normalize_turn(turn, index + 1) }
        },
        structured_result: recipient&.fetch("structured_result", nil) || result.fetch("structured_result", {}),
        completed_at: Time.current
      )
    end

    def self.normalize_turn(turn, id)
      offset_ms = (turn.fetch("offset_seconds", 0).to_f * 1_000).round
      {
        "id" => id,
        "speaker" => SPEAKERS.fetch(turn.fetch("speaker", "unknown"), "unknown"),
        "text" => turn.fetch("text"),
        "started_at_ms" => offset_ms,
        "ended_at_ms" => nil
      }
    end
  end
end
