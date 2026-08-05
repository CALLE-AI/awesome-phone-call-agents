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
      problems << "no recipient in CALL-E result" if recipient.nil?
      problems.concat(recipient_problems) if recipient
      problems << "call did not report task completion" unless task_completed?

      raise ResultIntegrityError, problems.join("; ") if problems.any?
    end

    def recipient_problems
      problems = []

      status = recipient["status"].to_s.downcase
      unless status.empty? || COMPLETED_RECIPIENT_STATUSES.include?(status)
        problems << "recipient status '#{recipient['status']}' is not a completed state"
      end

      if expected_phone.present? && reported_phones.present? && !reported_phones.include?(expected_phone)
        # Never leak the full number into logs/messages.
        problems << "recipient phone does not match the requested number"
      end

      confidence = recipient_confidence
      if confidence && confidence < MINIMUM_RESULT_CONFIDENCE
        problems << "recipient result confidence #{confidence} is below #{MINIMUM_RESULT_CONFIDENCE}"
      end

      problems
    end

    def task_completed?
      return true if result["task_completed"] == true

      completed_count = result.dig("structured_result", "completed_count") ||
                        recipient&.dig("structured_result", "completed_count")
      return true if completed_count.to_i >= 1

      COMPLETED_RECIPIENT_STATUSES.include?(recipient&.fetch("status", "").to_s.downcase)
    end

    def expected_phone
      phone_call.call_request.recipient_phone_e164
    end

    def reported_phones
      phones = recipient["phones"] || Array(recipient["phone"])
      Array(phones).map(&:to_s)
    end

    def recipient_confidence
      raw = recipient["result_confidence"] || recipient.dig("structured_result", "result_confidence")
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
