# frozen_string_literal: true

module LiveCalls
  class Setup
    LOCALES = {
      "US" => "en-US",
      "MX" => "es-MX"
    }.freeze

    def self.call(region:, maximum_surcharge_cents:)
      locale = LOCALES.fetch(region)
      provider = ProviderProfile.find_or_create_by!(name: "CALL-E direct · #{region}") do |record|
        record.phone_number_e164 = "+12025550100"
        record.metadata = { "region" => region, "locale" => locale, "fictional_endpoint" => true }
      end

      policy = nil
      provider.with_lock do
        version = provider.call_policies.maximum(:version).to_i + 1
        policy = provider.call_policies.create!(
          task_category: "delivery_change",
          version: version,
          maximum_surcharge_cents: maximum_surcharge_cents,
          success_conditions: %w[delivery_date_confirmed delivery_time_confirmed],
          allowed_commitments: {
            "maximum_surcharge_cents" => maximum_surcharge_cents,
            "delivery_date_change" => true
          },
          forbidden_commitments: [ "product_substitution" ],
          required_disclosures: [ "confirm_order_number" ],
          escalation_conditions: %w[surcharge_above_limit product_substitution]
        )
      end
      [ provider, policy ]
    end
  end
end
