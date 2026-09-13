# frozen_string_literal: true

class AddVerificationClaimsToCallContracts < ActiveRecord::Migration[8.1]
  def change
    add_column :call_policies, :verification_claims, :jsonb, default: [], null: false
    add_column :call_contracts, :verification_claims, :jsonb, default: [], null: false
    change_column_default :call_contracts, :schema_version, from: "1.0", to: "2.0"
  end
end
