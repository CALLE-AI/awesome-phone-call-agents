# frozen_string_literal: true

class AddOperatorInitiatedToCallRequests < ActiveRecord::Migration[8.1]
  def up
    # Distinguishes operator/live-workflow requests (which carry real objectives and
    # recipient data and must be authenticated) from public fictional demo requests.
    add_column :call_requests, :operator_initiated, :boolean, default: false, null: false
    add_index :call_requests, :operator_initiated

    # Backfill. A plain `false` default would silently DOWNGRADE every pre-existing
    # live/operator request to "public demo" and make it anonymously readable. Any row
    # that ever entered the live workflow is marked operator-initiated.
    execute <<~SQL.squish
      UPDATE call_requests
         SET operator_initiated = TRUE
       WHERE live_mode = TRUE
          OR confirmed_at IS NOT NULL
          OR status = 'awaiting_confirmation'
    SQL
  end

  def down
    remove_column :call_requests, :operator_initiated
  end
end
