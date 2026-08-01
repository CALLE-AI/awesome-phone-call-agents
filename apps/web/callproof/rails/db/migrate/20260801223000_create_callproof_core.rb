# frozen_string_literal: true

class CreateCallproofCore < ActiveRecord::Migration[8.1]
  def change
    create_table :provider_profiles do |t|
      t.string :name, null: false
      t.string :phone_number_e164, null: false
      t.boolean :active, null: false, default: true
      t.jsonb :metadata, null: false, default: {}
      t.timestamps
    end

    create_table :call_policies do |t|
      t.references :provider_profile, null: false, foreign_key: true
      t.string :task_category, null: false, default: "delivery_change"
      t.integer :version, null: false, default: 1
      t.integer :maximum_surcharge_cents, null: false, default: 25_000
      t.jsonb :success_conditions, null: false, default: []
      t.jsonb :allowed_commitments, null: false, default: {}
      t.jsonb :forbidden_commitments, null: false, default: []
      t.jsonb :required_disclosures, null: false, default: []
      t.jsonb :escalation_conditions, null: false, default: []
      t.boolean :active, null: false, default: true
      t.timestamps
    end
    add_index :call_policies, %i[provider_profile_id task_category version], unique: true

    create_table :call_requests do |t|
      t.references :provider_profile, null: false, foreign_key: true
      t.references :call_policy, null: false, foreign_key: true
      t.text :objective, null: false
      t.string :recipient_phone_e164, null: false
      t.string :status, null: false, default: "pending"
      t.string :simulation_scenario, null: false, default: "policy_violation"
      t.string :idempotency_key, null: false
      t.string :agentkit_run_id
      t.boolean :live_mode, null: false, default: false
      t.timestamps
    end
    add_index :call_requests, :idempotency_key, unique: true
    add_index :call_requests, :agentkit_run_id, unique: true, where: "agentkit_run_id IS NOT NULL"
    add_check_constraint :call_requests, "live_mode = FALSE", name: "callproof_live_calls_disabled"

    create_table :call_contracts do |t|
      t.references :call_request, null: false, foreign_key: true, index: { unique: true }
      t.string :schema_version, null: false, default: "1.0"
      t.text :objective, null: false
      t.jsonb :success_conditions, null: false, default: []
      t.jsonb :allowed_commitments, null: false, default: {}
      t.jsonb :forbidden_commitments, null: false, default: []
      t.jsonb :required_disclosures, null: false, default: []
      t.jsonb :escalation_conditions, null: false, default: []
      t.string :snapshot_hash, null: false
      t.timestamps
    end
    add_index :call_contracts, :snapshot_hash

    create_table :phone_calls do |t|
      t.references :call_request, null: false, foreign_key: true, index: { unique: true }
      t.string :provider, null: false, default: "fake"
      t.string :provider_call_id, null: false
      t.string :status, null: false, default: "pending"
      t.jsonb :transcript, null: false, default: { "language" => "en", "turns" => [] }
      t.jsonb :structured_result, null: false, default: {}
      t.datetime :started_at
      t.datetime :completed_at
      t.timestamps
    end
    add_index :phone_calls, %i[provider provider_call_id], unique: true

    create_table :call_analyses do |t|
      t.references :phone_call, null: false, foreign_key: true, index: { unique: true }
      t.uuid :external_analysis_id, null: false
      t.string :status, null: false, default: "completed"
      t.jsonb :verdict, null: false, default: {}
      t.decimal :result_confidence, precision: 4, scale: 3, null: false, default: 0
      t.boolean :needs_human_review, null: false, default: false
      t.datetime :analyzed_at, null: false
      t.timestamps
    end
    add_index :call_analyses, :external_analysis_id, unique: true

    create_table :analysis_evidences do |t|
      t.references :call_analysis, null: false, foreign_key: true
      t.string :finding, null: false
      t.jsonb :transcript_turn_ids, null: false, default: []
      t.text :explanation, null: false
      t.timestamps
    end
  end
end
