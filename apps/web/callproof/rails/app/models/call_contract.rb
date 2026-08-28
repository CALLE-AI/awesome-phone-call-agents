# frozen_string_literal: true

class CallContract < ApplicationRecord
  belongs_to :call_request

  validates :schema_version, :objective, :snapshot_hash, presence: true
  validates :verification_claims, length: { minimum: 1 }
  validates :protocol_language, inclusion: { in: %w[en es] }
end
