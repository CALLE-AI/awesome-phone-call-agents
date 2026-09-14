# frozen_string_literal: true

# This migration comes from agentkit (originally 2)
class CreateAgentkitFlows < ActiveRecord::Migration[7.1]
  def change
    create_table :agentkit_runs do |t|
      t.string  :flow_name,    null: false
      t.integer :flow_version, null: false, default: 1
      t.uuid    :run_id,       null: false
      t.string  :status,       null: false, default: "pending"
      t.jsonb   :input,   null: false, default: {}
      t.jsonb   :output,  null: false, default: {}
      t.jsonb   :context, null: false, default: {}
      t.string  :idempotency_key
      t.bigint  :account_id
      t.bigint  :user_id
      t.string  :tenant_key
      t.references :subject, polymorphic: true, index: true, null: true
      t.datetime :started_at, :finished_at, :deadline_at
      t.jsonb    :error
      t.integer  :steps_total, default: 0
      t.integer  :steps_completed, default: 0
      t.decimal  :cost_usd, precision: 12, scale: 6, default: 0.0
      t.timestamps
    end

    add_index :agentkit_runs, :run_id, unique: true
    add_index :agentkit_runs, %i[flow_name status]
    add_index :agentkit_runs, :idempotency_key, unique: true,
              where: "idempotency_key IS NOT NULL"

    create_table :agentkit_run_steps do |t|
      t.references :run, null: false, foreign_key: { to_table: :agentkit_runs }
      t.string  :step_key,  null: false
      t.string  :step_name, null: false
      t.string  :kind,      null: false
      t.string  :status,    null: false, default: "pending"
      t.integer :position
      t.bigint  :parent_step_id
      t.integer :pending_count       # the join barrier counter
      t.jsonb   :input,    null: false, default: {}
      t.jsonb   :output,   null: false, default: {}
      t.jsonb   :attempts, null: false, default: []
      t.integer :attempt_count, default: 0
      t.jsonb   :usage,    null: false, default: {}
      t.text    :error
      t.datetime :started_at, :finished_at, :timeout_at
      t.timestamps
    end

    # THE idempotency guarantee: a redelivered job cannot create a second step
    # nor execute the same node twice.
    add_index :agentkit_run_steps, %i[run_id step_key], unique: true
    add_index :agentkit_run_steps, %i[run_id status]
    add_index :agentkit_run_steps, :parent_step_id

    create_table :agentkit_artifacts do |t|
      t.references :run, foreign_key: { to_table: :agentkit_runs }, null: true
      t.string  :kind
      t.string  :content_type
      t.text    :body
      t.jsonb   :metadata, null: false, default: {}
      t.string  :content_hash
      t.string  :tenant_key
      t.timestamps
    end
    add_index :agentkit_artifacts, :content_hash
  end
end
