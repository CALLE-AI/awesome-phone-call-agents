# frozen_string_literal: true

class PhoneCall < ApplicationRecord
  belongs_to :call_request
  has_one :call_analysis, dependent: :destroy

  validates :provider, :provider_call_id, :status, presence: true
  validates :provider_call_id, uniqueness: { scope: :provider }
end
