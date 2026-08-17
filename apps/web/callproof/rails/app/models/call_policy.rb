# frozen_string_literal: true

class CallPolicy < ApplicationRecord
  belongs_to :provider_profile
  has_many :call_requests, dependent: :restrict_with_exception

  validates :task_category, presence: true
  validates :version, numericality: { only_integer: true, greater_than: 0 }
  validates :maximum_surcharge_cents, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :version, uniqueness: { scope: %i[provider_profile_id task_category] }
  validates :verification_claims, length: { minimum: 1 }
  validates :protocol_language, inclusion: { in: %w[en es] }
end
