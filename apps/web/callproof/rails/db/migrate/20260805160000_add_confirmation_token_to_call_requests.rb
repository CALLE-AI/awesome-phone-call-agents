# frozen_string_literal: true

class AddConfirmationTokenToCallRequests < ActiveRecord::Migration[8.1]
  def change
    add_column :call_requests, :confirmation_token, :string
    add_index :call_requests, :confirmation_token, unique: true, where: "confirmation_token IS NOT NULL"
  end
end
