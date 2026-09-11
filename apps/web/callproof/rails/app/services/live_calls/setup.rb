# frozen_string_literal: true

module LiveCalls
  class Setup
    LOCALES = {
      "US" => "en-US",
      "MX" => "es-MX"
    }.freeze

    def self.call(region:, maximum_surcharge_cents:, delivery_date:, delivery_time:)
      locale = LOCALES.fetch(region)
      delivery_date = Date.iso8601(delivery_date).iso8601
      raise ArgumentError, "delivery time must use HH:MM" unless delivery_time.match?(/\A(?:[01]\d|2[0-3]):[0-5]\d\z/)

      verification_claims = VerificationClaims::DeliveryChange.build(
        delivery_date: delivery_date,
        delivery_time: delivery_time,
        maximum_surcharge_cents: maximum_surcharge_cents
      )
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
            "maximum_surcharge_cents" => maximum_surcharge_cents
          },
          forbidden_commitments: [ "product_substitution" ],
          required_disclosures: [ "recording_notice" ],
          protocol_language: locale.split("-").first,
          verification_claims: verification_claims,
          escalation_conditions: []
        )
      end
      [ provider, policy ]
    end
  end
end
