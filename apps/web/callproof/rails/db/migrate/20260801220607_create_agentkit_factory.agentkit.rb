# frozen_string_literal: true

# This migration comes from agentkit (originally 5)
class CreateAgentkitFactory < ActiveRecord::Migration[7.1]
  def change
    create_table :agentkit_findings do |t|
      t.string :detector, null: false
      t.string :severity, null: false, default: "medium"
      t.string :subject
      t.text   :summary
      t.jsonb  :evidence, null: false, default: {}
      t.string :suggested_level, null: false, default: "n1"
      t.string :status, null: false, default: "open"
      t.timestamps
    end
    add_index :agentkit_findings, %i[status severity]
    add_index :agentkit_findings, %i[detector subject]

    create_table :agentkit_experiments do |t|
      t.string :name,   null: false
      t.string :level,  null: false
      t.string :target, null: false
      t.jsonb  :control, null: false, default: {}
      t.jsonb  :variant, null: false, default: {}
      t.float  :traffic_pct, null: false, default: 10.0
      t.string :bucket_by, null: false, default: "account"
      t.jsonb  :guardrails, null: false, default: {}
      t.string :status, null: false, default: "draft"
      t.jsonb  :results, null: false, default: {}
      t.references :finding, foreign_key: { to_table: :agentkit_findings }, null: true
      t.datetime :started_at, :finished_at
      t.timestamps
    end
    add_index :agentkit_experiments, %i[target status]

    create_table :agentkit_golden_cases do |t|
      t.string :agent_name, null: false
      t.bigint :suggestion_id
      t.jsonb  :input,    null: false, default: {}
      t.jsonb  :expected, null: false, default: {}
      t.string :label
      t.string :rejection_code
      t.boolean :frozen, null: false, default: false
      t.timestamps
    end
    add_index :agentkit_golden_cases, %i[agent_name frozen]

    create_table :agentkit_usage_events do |t|
      t.string  :kind, null: false          # llm | embedding
      t.string  :model
      t.string  :agent
      t.string  :tenant_key
      t.uuid    :run_id
      t.integer :input_tokens,  default: 0
      t.integer :output_tokens, default: 0
      t.decimal :cost_usd, precision: 12, scale: 6, default: 0.0
      t.datetime :occurred_at, null: false
      t.timestamps
    end
    add_index :agentkit_usage_events, %i[tenant_key occurred_at]
    add_index :agentkit_usage_events, %i[kind occurred_at]
  end
end
