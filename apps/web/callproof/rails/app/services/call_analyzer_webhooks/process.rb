# frozen_string_literal: true

module CallAnalyzerWebhooks
  class Process
    class ReplayConflict < StandardError; end

    def self.call(payload:, event_id:, payload_sha256:)
      existing = CallAnalyzerWebhookEvent.find_by(event_id: event_id)
      return verify_replay!(existing, payload_sha256) if existing

      event = nil
      analysis = nil
      CallAnalyzerWebhookEvent.transaction do
        event = CallAnalyzerWebhookEvent.create!(
          event_id: event_id,
          payload_sha256: payload_sha256,
          payload: payload
        )
        analysis = CallAnalysis.lock.find_by!(request_id: payload.fetch("request_id"))
        raise ActiveRecord::RecordInvalid, analysis if analysis.external_analysis_id.present? &&
          analysis.external_analysis_id != payload.fetch("analysis_id")

        verdict = payload.fetch("verdict")
        analysis.update!(
          external_analysis_id: payload.fetch("analysis_id"),
          status: "completed",
          verdict: verdict,
          result_confidence: verdict.fetch("result_confidence"),
          needs_human_review: verdict.fetch("needs_human_review"),
          analyzed_at: payload.fetch("completed_at")
        )
        analysis.analysis_evidences.delete_all
        verdict.fetch("evidence").each do |item|
          analysis.analysis_evidences.create!(
            finding: item.fetch("finding"),
            transcript_turn_ids: item.fetch("turn_ids"),
            explanation: item.fetch("explanation")
          )
        end

        event.update!(processing_status: "processed", processed_at: Time.current)
      end
      ReviewCallAnalysisFlow.call(call_analysis: analysis)
      event
    rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
      existing = CallAnalyzerWebhookEvent.find_by(event_id: event_id)
      existing ? verify_replay!(existing, payload_sha256) : raise
    end

    def self.verify_replay!(event, payload_sha256)
      raise ReplayConflict, "event_id was already used with a different payload" unless
        ActiveSupport::SecurityUtils.secure_compare(event.payload_sha256, payload_sha256)

      event
    end
    private_class_method :verify_replay!
  end
end
