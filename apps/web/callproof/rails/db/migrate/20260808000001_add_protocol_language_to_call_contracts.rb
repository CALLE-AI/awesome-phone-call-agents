# frozen_string_literal: true

class AddProtocolLanguageToCallContracts < ActiveRecord::Migration[8.1]
  def change
    add_column :call_policies, :protocol_language, :string, default: "en", null: false
    add_column :call_contracts, :protocol_language, :string, default: "en", null: false
  end
end
