# frozen_string_literal: true

module CallContracts
  class Build
    def self.call(call_request)
      return call_request.call_contract if call_request.call_contract

      policy = call_request.call_policy
      attributes = {
        schema_version: "2.0",
        objective: call_request.objective,
        protocol_language: policy.protocol_language,
        success_conditions: policy.success_conditions,
        allowed_commitments: policy.allowed_commitments,
        forbidden_commitments: policy.forbidden_commitments,
        required_disclosures: policy.required_disclosures,
        escalation_conditions: policy.escalation_conditions,
        verification_claims: policy.verification_claims
      }
      canonical = JSON.generate(attributes.deep_stringify_keys)

      call_request.create_call_contract!(**attributes, snapshot_hash: Digest::SHA256.hexdigest(canonical))
    end
  end
end
