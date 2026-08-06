# frozen_string_literal: true

class AddOperatorInitiatedToCallRequests < ActiveRecord::Migration[8.1]
  def change
    # Distinguishes operator/live-workflow requests (which carry real objectives and
    # recipient data and must be authenticated) from public fictional demo requests.
    add_column :call_requests, :operator_initiated, :boolean, default: false, null: false
    add_index :call_requests, :operator_initiated
  end
end
