# frozen_string_literal: true

class CallContract < ApplicationRecord
  belongs_to :call_request

  validates :schema_version, :objective, :snapshot_hash, presence: true
end
