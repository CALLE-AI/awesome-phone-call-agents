# frozen_string_literal: true

module CallProviders
  class Fake
    def call(call_request:, contract:)
      raise ArgumentError, "live calls are disabled" if call_request.live_mode?

      surcharge_cents = call_request.simulation_scenario == "policy_violation" ? 32_000 : 20_000
      phone_call = call_request.phone_call || call_request.build_phone_call
      phone_call.assign_attributes(
        provider: "fake",
        provider_call_id: "fake-#{call_request.idempotency_key}",
        status: "completed",
        transcript: transcript(surcharge_cents),
        structured_result: {
          "delivery_changed" => true,
          "delivery_date" => "2026-08-07",
          "delivery_time" => "09:00",
          "surcharge_cents" => surcharge_cents,
          "currency" => "USD",
          "order_number_confirmed" => true,
          "contract_hash" => contract.snapshot_hash
        },
        started_at: Time.current,
        completed_at: Time.current
      )
      phone_call.save!
      call_request.update!(status: "running")
      phone_call
    end

    private

    def transcript(surcharge_cents)
      dollars = format("%.2f", surcharge_cents / 100.0)
      {
        "language" => "en",
        "turns" => [
          { "id" => 1, "speaker" => "agent", "text" => "I am calling about order C1023 and need to move delivery to Friday at 9 AM." },
          { "id" => 2, "speaker" => "recipient", "text" => "I found order C1023 and can make that change." },
          { "id" => 3, "speaker" => "recipient", "text" => "The delivery change has a surcharge of $#{dollars}." },
          { "id" => 4, "speaker" => "agent", "text" => "I confirm Friday at 9 AM with that surcharge." }
        ]
      }
    end
  end
end
