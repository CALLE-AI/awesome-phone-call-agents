# frozen_string_literal: true

class AnalysisEvidence < ApplicationRecord
  belongs_to :call_analysis

  validates :finding, :explanation, presence: true
  validates :transcript_turn_ids, presence: true
end
