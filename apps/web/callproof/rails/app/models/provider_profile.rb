# frozen_string_literal: true

class ProviderProfile < ApplicationRecord
  has_many :call_policies, dependent: :restrict_with_exception
  has_many :call_requests, dependent: :restrict_with_exception

  validates :name, presence: true
  validates :phone_number_e164, format: { with: /\A\+[1-9]\d{7,14}\z/ }
end
