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

      policy = provider.call_policies.find_or_initialize_by(task_category: "delivery_change", version: 2)
      policy.assign_attributes(
        maximum_surcharge_cents: 25_000,
        success_conditions: %w[delivery_date_confirmed delivery_time_confirmed],
        allowed_commitments: {
          "maximum_surcharge_cents" => 25_000
        },
        forbidden_commitments: [ "product_substitution" ],
        required_disclosures: [ "recording_notice" ],
        protocol_language: "en",
        verification_claims: VerificationClaims::DeliveryChange.build(
          delivery_date: "2026-08-07",
          delivery_time: "09:00",
          maximum_surcharge_cents: 25_000
        ),
        escalation_conditions: []
      )
      policy.save!

      [ provider, policy ]
    end
  end
end
