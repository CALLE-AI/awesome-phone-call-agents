# frozen_string_literal: true

# This migration comes from agentkit (originally 4)
class CreateAgentkitTelemetry < ActiveRecord::Migration[7.1]
  def change
    create_table :agentkit_events do |t|
      t.string :name, null: false
      t.uuid   :run_id
      t.uuid   :trace_id
      t.jsonb  :dims,     null: false, default: {}
      t.jsonb  :measures, null: false, default: {}
      t.bigint :account_id
      t.bigint :user_id
      t.datetime :occurred_at, null: false
      t.timestamps
    end

    add_index :agentkit_events, %i[name occurred_at]
    add_index :agentkit_events, :dims, using: :gin
    add_index :agentkit_events, :run_id

    create_table :agentkit_metrics do |t|
      t.string :name,   null: false
      t.string :period, null: false, default: "day"
      t.date   :period_start, null: false
      t.jsonb  :dims, null: false, default: {}
      t.integer :count, null: false, default: 0
      t.float  :sum, :min, :max, :p50, :p90, :p95, :p99, :stddev
      t.jsonb  :histogram, null: false, default: {}
      t.timestamps
    end

    add_index :agentkit_metrics, %i[name period period_start dims],
              unique: true, name: "idx_agentkit_metrics_unique"
  end
end
