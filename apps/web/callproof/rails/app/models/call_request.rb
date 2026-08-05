# frozen_string_literal: true

class CallRequest < ApplicationRecord
  STATUSES = %w[awaiting_confirmation pending running waiting_analysis waiting_human verified approved rejected failed canceled].freeze
  SCENARIOS = %w[compliant policy_violation].freeze

  belongs_to :provider_profile
  belongs_to :call_policy
  has_one :call_contract, dependent: :destroy
  has_one :phone_call, dependent: :destroy
  has_one :call_analysis, through: :phone_call

  validates :objective, presence: true, length: { maximum: 4_000 }
  validates :recipient_phone_e164, format: { with: /\A\+[1-9]\d{7,14}\z/ }
  validates :status, inclusion: { in: STATUSES }
  validates :simulation_scenario, inclusion: { in: SCENARIOS }
  validates :idempotency_key, presence: true, uniqueness: true
  validate :live_calls_are_disabled

  before_validation :set_idempotency_key, on: :create
  before_validation :set_confirmation_token, on: :create

  # Unpredictable phrase the operator must type to confirm a real call. It is
  # derived from a random token (not the sequential id), so it cannot be guessed
  # from the request URL.
  def confirmation_phrase
    "PLACE CALL #{confirmation_token}"
  end

  def masked_phone_number
    return "" if recipient_phone_e164.blank?

    "#{recipient_phone_e164.first(3)}••••#{recipient_phone_e164.last(2)}"
  end

  private

  def set_idempotency_key
    self.idempotency_key ||= SecureRandom.uuid
  end

  def set_confirmation_token
    self.confirmation_token ||= SecureRandom.urlsafe_base64(24)
  end

  def live_calls_are_disabled
    return unless live_mode?

    errors.add(:live_mode, "requires CALLPROOF_LIVE_CALLS=true") unless ENV["CALLPROOF_LIVE_CALLS"] == "true"
    errors.add(:confirmed_at, "is required for a live call") if confirmed_at.blank?
  end
end
