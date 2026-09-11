# frozen_string_literal: true

# This migration comes from agentkit (originally 6)
class CreateAgentkitAudit < ActiveRecord::Migration[7.1]
  def change
    # Successor of v0.1's agentkit_agent_logs. Append-only: no update path, no
    # delete path except the explicit retention prune. Separate from
    # agentkit_events because audit is never sampled and does not expire on its
    # own — a compliance-sensitive domain has to prove what an agent did.
    create_table :agentkit_audit_logs do |t|
      t.string   :event_type, null: false      # llm.call | started | completed | failed | ...
      t.string   :agent_name
      t.string   :status
      t.text     :prompt_preview               # redacted, length configurable
      t.string   :model
      t.integer  :input_tokens
      t.integer  :output_tokens
      t.decimal  :cost_usd, precision: 12, scale: 6
      t.integer  :duration_ms
      t.jsonb    :payload, null: false, default: {}   # FULL payload, not just numbers

      t.uuid     :trace_id
      t.uuid     :run_id
      t.string   :step_key

      t.bigint   :user_id
      t.bigint   :account_id
      t.string   :tenant_key
      t.string   :subject_type
      t.bigint   :subject_id

      t.datetime :occurred_at, null: false
      t.timestamps
    end

    add_index :agentkit_audit_logs, %i[agent_name occurred_at]
    add_index :agentkit_audit_logs, %i[event_type occurred_at]
    add_index :agentkit_audit_logs, :trace_id
    add_index :agentkit_audit_logs, :run_id
    add_index :agentkit_audit_logs, %i[subject_type subject_id]
    add_index :agentkit_audit_logs, %i[tenant_key occurred_at]

    # XAI traces — one format for dreaming, summarizing, imagination and
    # councils. Designed in PLAN_V2 §4.1; without it a trace_id written into a
    # memory's metadata pointed at nothing.
    create_table :agentkit_traces do |t|
      t.uuid     :trace_id, null: false
      t.string   :kind,    null: false          # dreaming | summarizer | imagination | council
      t.string   :trigger, null: false          # cron | on_demand | cascade | event
      t.string   :status,  null: false, default: "running"
      t.uuid     :run_id
      t.string   :tenant_key
      t.jsonb    :meta, null: false, default: {}
      t.datetime :started_at, :finished_at
      t.integer  :duration_ms
      t.timestamps
    end

    add_index :agentkit_traces, :trace_id, unique: true
    add_index :agentkit_traces, %i[kind started_at]
    add_index :agentkit_traces, :run_id

    create_table :agentkit_trace_phases do |t|
      t.references :trace, null: false, foreign_key: { to_table: :agentkit_traces }
      t.integer  :position, null: false
      t.string   :name,     null: false        # divergent_extraction | incubation | ...
      t.jsonb    :data, null: false, default: {}   # inputs, scores, ids per phase
      t.datetime :occurred_at, null: false
      t.timestamps
    end

    add_index :agentkit_trace_phases, %i[trace_id position]
  end
end
