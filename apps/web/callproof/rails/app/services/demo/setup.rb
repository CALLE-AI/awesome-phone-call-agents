# frozen_string_literal: true

module Demo
  class Setup
    PROVIDER_NAME = "Northstar Supplies (fictional)"
    PROVIDER_PHONE = "+12025550147"

    def self.call
      provider = ProviderProfile.find_or_create_by!(name: PROVIDER_NAME) do |record|
        record.phone_number_e164 = PROVIDER_PHONE
        record.metadata = { "fictional" => true }
      end

      policy = provider.call_policies.find_or_create_by!(task_category: "delivery_change", version: 1) do |record|
        record.maximum_surcharge_cents = 25_000
        record.success_conditions = %w[delivery_date_confirmed delivery_time_confirmed]
        record.allowed_commitments = {
          "maximum_surcharge_cents" => 25_000,
          "delivery_date_change" => true
        }
        record.forbidden_commitments = [ "product_substitution" ]
        record.required_disclosures = [ "confirm_order_number" ]
        record.escalation_conditions = %w[surcharge_above_limit product_substitution]
      end

      [ provider, policy ]
    end
  end
end
