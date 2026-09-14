# frozen_string_literal: true

class CallAnalyzerWebhookEvent < ApplicationRecord
  validates :event_id, :event_type, :payload_sha256, :processing_status, presence: true
  validates :event_id, uniqueness: true
end
