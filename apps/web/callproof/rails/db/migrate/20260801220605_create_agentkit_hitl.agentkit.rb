# frozen_string_literal: true

# This migration comes from agentkit (originally 3)
class CreateAgentkitHitl < ActiveRecord::Migration[7.1]
  def change
    create_table :agentkit_suggestions do |t|
      t.string :suggestion_type, null: false
      t.string :title, null: false
      t.text   :description
      t.string :priority, null: false, default: "medium"
      t.string :status,   null: false, default: "pending"
      t.string :source_agent
      t.jsonb  :payload, null: false, default: {}
      t.references :suggestable, polymorphic: true, null: true, index: true
      t.bigint :user_id
      t.bigint :account_id
      t.string :tenant_key
      t.string :idempotency_key
      t.string :prompt_id
      t.integer :prompt_version
      t.string :model
      t.uuid   :run_id
      t.string :gate_key          # links a suggestion to a suspended flow gate
      t.jsonb  :metadata, null: false, default: {}
      t.datetime :resolved_at, :expires_at
      t.timestamps
    end

    add_index :agentkit_suggestions, %i[status priority]
    add_index :agentkit_suggestions, %i[tenant_key status]
    add_index :agentkit_suggestions, :gate_key
    add_index :agentkit_suggestions, :idempotency_key

    create_table :agentkit_decisions do |t|
      t.references :suggestion, foreign_key: { to_table: :agentkit_suggestions }, null: true
      t.string :agent_name
      t.string :suggestion_type
      t.string :prompt_id
      t.integer :prompt_version
      t.string :model
      t.string :decision, null: false        # accepted|rejected|edited|ignored|expired
      t.string :actor,    null: false
      t.string :mode,     null: false        # human|auto|policy  ← never conflate
      t.string :rejection_code               # closed taxonomy, not prose
      t.text   :rejection_note
      t.jsonb  :proposed_payload, null: false, default: {}
      t.jsonb  :final_payload,    null: false, default: {}
      t.float  :edit_distance
      t.integer :time_to_decision_s
      t.string  :outcome
      t.float   :outcome_value
      t.datetime :outcome_at
      t.string :tenant_key
      t.timestamps
    end

    add_index :agentkit_decisions, %i[agent_name created_at]
    add_index :agentkit_decisions, %i[mode decision]
    add_index :agentkit_decisions, :rejection_code
  end
end
