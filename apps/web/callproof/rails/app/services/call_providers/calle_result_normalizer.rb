# frozen_string_literal: true

module CallProviders
  # Canonicalizes a CALL-E result into the REST Developer-API envelope that
  # PersistCalleResult consumes. Two CALL-E surfaces return different shapes:
  #
  #   * REST Developer API (what the durable Rails poller uses): a top-level
  #     `status` plus `recipients[].attempts[].transcript_turns` and
  #     `recipients[].structured_result`.
  #   * MCP `get_call_run` (desktop/CLI agents): a `status` plus a nested
  #     `result` object with `outcome`, `summary`, a newline-joined `transcript`
  #     string, and `extracted.{calling,to_phones}`.
  #
  # canonicalize/1 detects the shape and always returns the REST envelope, so a
  # single validation + persistence path serves both surfaces.
  module CalleResultNormalizer
    module_function

    COMPLETED_STATUSES = %w[completed].freeze
    TRANSCRIPT_LINE = /\A\[(\d{2}):(\d{2}):(\d{2})\]\s*([A-Za-z]+):\s*(.*)\z/

    def canonicalize(raw)
      return raw if raw.nil?
      return raw if raw.key?("recipients") # already REST shape
      return raw unless raw["result"].is_a?(Hash) # unknown shape; leave untouched

      from_mcp(raw)
    end

    def from_mcp(raw)
      status = raw["status"].to_s.downcase
      inner = raw["result"] || {}
      outcome = inner["outcome"] || {}
      task_completed = outcome["task_completed"] == true
      confidence = outcome.dig("completion_confidence", "score")
      phones = Array(inner.dig("extracted", "to_phones")).map(&:to_s)
      duration = inner.dig("extracted", "calling", "duration_seconds")

      recipient_structured = {
        "task_completed" => task_completed,
        "completion_confidence" => outcome["completion_confidence"],
        "evidence" => outcome["evidence"],
        "summary" => inner["summary"],
        "call_id" => inner["call_id"],
        "duration_seconds" => duration
      }.compact

      {
        "status" => status,
        "task_completed" => task_completed,
        "structured_result" => { "completed_count" => task_completed ? 1 : 0 },
        "recipients" => [ {
          "status" => recipient_status(status),
          "phones" => phones,
          "result_confidence" => confidence,
          "structured_result" => recipient_structured,
          "attempts" => [ { "transcript_turns" => parse_transcript(inner["transcript"]) } ]
        } ]
      }
    end

    def recipient_status(status)
      COMPLETED_STATUSES.include?(status) ? "completed" : status
    end

    # Accepts the MCP transcript as a newline-joined string or an array of lines
    # and returns REST-style turns. Speaker tokens (BOT/USER) are lower-cased so
    # PersistCalleResult maps them to agent/recipient.
    def parse_transcript(transcript)
      lines =
        case transcript
        when String then transcript.split("\n")
        when Array then transcript
        else []
        end

      lines.filter_map do |line|
        match = TRANSCRIPT_LINE.match(line.to_s.strip)
        next if match.nil?

        hours, minutes, seconds = match[1].to_i, match[2].to_i, match[3].to_i
        {
          "offset_seconds" => (hours * 3600) + (minutes * 60) + seconds,
          "speaker" => match[4].downcase,
          "text" => match[5]
        }
      end
    end
  end
end
