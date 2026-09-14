# frozen_string_literal: true

class AddLiveCallConfirmation < ActiveRecord::Migration[8.1]
  def change
    remove_check_constraint :call_requests, name: "callproof_live_calls_disabled"
    add_column :call_requests, :confirmed_at, :datetime
    add_check_constraint :call_requests,
                         "live_mode = FALSE OR confirmed_at IS NOT NULL",
                         name: "callproof_live_calls_require_confirmation"
  end
end
