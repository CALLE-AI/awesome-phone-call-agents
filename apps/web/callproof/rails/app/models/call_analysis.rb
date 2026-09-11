# frozen_string_literal: true

class CallAnalysis < ApplicationRecord
  belongs_to :phone_call
  has_many :analysis_evidences, dependent: :destroy

  validates :status, presence: true
  validates :external_analysis_id, uniqueness: true, allow_nil: true
  validates :request_id, uniqueness: true, allow_nil: true
  validates :analyzed_at, presence: true, if: :completed?
  validates :result_confidence, numericality: { in: 0..1 }

  def completed?
    status == "completed"
  end
end
