# frozen_string_literal: true

class AddAsyncAnalysisDelivery < ActiveRecord::Migration[8.1]
  def change
    change_column_null :call_analyses, :external_analysis_id, true
    change_column_null :call_analyses, :analyzed_at, true
    add_column :call_analyses, :request_id, :uuid
    add_index :call_analyses, :request_id, unique: true

    create_table :call_analyzer_webhook_events do |t|
      t.uuid :event_id, null: false
      t.string :event_type, null: false, default: "analysis.completed"
      t.string :payload_sha256, null: false
      t.string :processing_status, null: false, default: "received"
      t.datetime :processed_at
      t.jsonb :payload, null: false, default: {}
      t.timestamps
    end
    add_index :call_analyzer_webhook_events, :event_id, unique: true
  end
end
