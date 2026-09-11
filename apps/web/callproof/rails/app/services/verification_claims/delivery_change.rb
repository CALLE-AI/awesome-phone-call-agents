# frozen_string_literal: true

module VerificationClaims
  class DeliveryChange
    PROTOCOL = {
      "en" => {
        "delivery_date_confirmed" => "Please confirm exactly: the delivery date is %{expected}. Answer YES or NO.",
        "delivery_time_confirmed" => "Please confirm exactly: the delivery time is %{expected}. Answer YES or NO.",
        "surcharge_within_limit" => "Please confirm exactly: the surcharge is {amount}. Answer YES or NO.",
        "recording_notice" => "This call is being recorded."
      },
      "es" => {
        "delivery_date_confirmed" => "Confirme exactamente: la fecha de entrega es %{expected}. Responda SÍ o NO.",
        "delivery_time_confirmed" => "Confirme exactamente: la hora de entrega es %{expected}. Responda SÍ o NO.",
        "surcharge_within_limit" => "Confirme exactamente: el recargo es {amount}. Responda SÍ o NO.",
        "recording_notice" => "Esta llamada está siendo grabada."
      }
    }.freeze

    def self.build(delivery_date:, delivery_time:, maximum_surcharge_cents:)
      [
        {
          "kind" => "success",
          "id" => "delivery_date_confirmed",
          "result_field" => "delivery_date",
          "operator" => "equals",
          "expected" => delivery_date
        },
        {
          "kind" => "success",
          "id" => "delivery_time_confirmed",
          "result_field" => "delivery_time",
          "operator" => "equals",
          "expected" => delivery_time
        },
        {
          "kind" => "commitment_limit",
          "id" => "surcharge_within_limit",
          "result_field" => "surcharge_cents",
          "operator" => "less_than_or_equal",
          "maximum" => maximum_surcharge_cents
        },
        {
          "kind" => "required_disclosure",
          "id" => "recording_notice"
        },
        {
          "kind" => "forbidden_commitment",
          "id" => "product_substitution",
          "evaluation_mode" => "semantic_only"
        }
      ]
    end

    def self.protocol_lines(claims:, language:)
      text = PROTOCOL.fetch(language)
      claims.filter_map do |claim|
        template = text[claim.fetch("id")]
        next if template.nil?

        claim.fetch("kind") == "success" ? format(template, expected: claim.fetch("expected")) : template
      end
    end
  end
end
