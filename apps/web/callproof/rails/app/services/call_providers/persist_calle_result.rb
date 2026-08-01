# frozen_string_literal: true

module CallProviders
  class PersistCalleResult
    SPEAKERS = { "bot" => "agent", "user" => "recipient" }.freeze

    def self.call(phone_call, result)
      recipient = result.fetch("recipients").first
      turns = recipient.fetch("attempts", []).flat_map { |attempt| attempt.fetch("transcript_turns", []) }
      phone_call.update!(
        status: "completed",
        transcript: {
          "language" => phone_call.transcript.fetch("language", "en"),
          "turns" => turns.each_with_index.map { |turn, index| normalize_turn(turn, index + 1) }
        },
        structured_result: recipient.fetch("structured_result", result.fetch("structured_result", {})),
        completed_at: Time.current
      )
      phone_call
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
    private_class_method :normalize_turn
  end
end
