# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_08_05_200000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"
  enable_extension "pg_trgm"
  enable_extension "pgcrypto"
  enable_extension "vector"

  create_table "agentkit_artifacts", force: :cascade do |t|
    t.text "body"
    t.string "content_hash"
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "kind"
    t.jsonb "metadata", default: {}, null: false
    t.bigint "run_id"
    t.string "tenant_key"
    t.datetime "updated_at", null: false
    t.index ["content_hash"], name: "index_agentkit_artifacts_on_content_hash"
    t.index ["run_id"], name: "index_agentkit_artifacts_on_run_id"
  end

  create_table "agentkit_audit_logs", force: :cascade do |t|
    t.bigint "account_id"
    t.string "agent_name"
    t.decimal "cost_usd", precision: 12, scale: 6
    t.datetime "created_at", null: false
    t.integer "duration_ms"
    t.string "event_type", null: false
    t.integer "input_tokens"
    t.string "model"
    t.datetime "occurred_at", null: false
    t.integer "output_tokens"
    t.jsonb "payload", default: {}, null: false
    t.text "prompt_preview"
    t.uuid "run_id"
    t.string "status"
    t.string "step_key"
    t.bigint "subject_id"
    t.string "subject_type"
    t.string "tenant_key"
    t.uuid "trace_id"
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.index ["agent_name", "occurred_at"], name: "index_agentkit_audit_logs_on_agent_name_and_occurred_at"
    t.index ["event_type", "occurred_at"], name: "index_agentkit_audit_logs_on_event_type_and_occurred_at"
    t.index ["run_id"], name: "index_agentkit_audit_logs_on_run_id"
    t.index ["subject_type", "subject_id"], name: "index_agentkit_audit_logs_on_subject_type_and_subject_id"
    t.index ["tenant_key", "occurred_at"], name: "index_agentkit_audit_logs_on_tenant_key_and_occurred_at"
    t.index ["trace_id"], name: "index_agentkit_audit_logs_on_trace_id"
  end

  create_table "agentkit_decisions", force: :cascade do |t|
    t.string "actor", null: false
    t.string "agent_name"
    t.datetime "created_at", null: false
    t.string "decision", null: false
    t.float "edit_distance"
    t.jsonb "final_payload", default: {}, null: false
    t.string "mode", null: false
    t.string "model"
    t.string "outcome"
    t.datetime "outcome_at"
    t.float "outcome_value"
    t.string "prompt_id"
    t.integer "prompt_version"
    t.jsonb "proposed_payload", default: {}, null: false
    t.string "rejection_code"
    t.text "rejection_note"
    t.bigint "suggestion_id"
    t.string "suggestion_type"
    t.string "tenant_key"
    t.integer "time_to_decision_s"
    t.datetime "updated_at", null: false
    t.index ["agent_name", "created_at"], name: "index_agentkit_decisions_on_agent_name_and_created_at"
    t.index ["mode", "decision"], name: "index_agentkit_decisions_on_mode_and_decision"
    t.index ["rejection_code"], name: "index_agentkit_decisions_on_rejection_code"
    t.index ["suggestion_id"], name: "index_agentkit_decisions_on_suggestion_id"
  end

  create_table "agentkit_events", force: :cascade do |t|
    t.bigint "account_id"
    t.datetime "created_at", null: false
    t.jsonb "dims", default: {}, null: false
    t.jsonb "measures", default: {}, null: false
    t.string "name", null: false
    t.datetime "occurred_at", null: false
    t.uuid "run_id"
    t.uuid "trace_id"
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.index ["dims"], name: "index_agentkit_events_on_dims", using: :gin
    t.index ["name", "occurred_at"], name: "index_agentkit_events_on_name_and_occurred_at"
    t.index ["run_id"], name: "index_agentkit_events_on_run_id"
  end

  create_table "agentkit_experiments", force: :cascade do |t|
    t.string "bucket_by", default: "account", null: false
    t.jsonb "control", default: {}, null: false
    t.datetime "created_at", null: false
    t.bigint "finding_id"
    t.datetime "finished_at"
    t.jsonb "guardrails", default: {}, null: false
    t.string "level", null: false
    t.string "name", null: false
    t.jsonb "results", default: {}, null: false
    t.datetime "started_at"
    t.string "status", default: "draft", null: false
    t.string "target", null: false
    t.float "traffic_pct", default: 10.0, null: false
    t.datetime "updated_at", null: false
    t.jsonb "variant", default: {}, null: false
    t.index ["finding_id"], name: "index_agentkit_experiments_on_finding_id"
    t.index ["target", "status"], name: "index_agentkit_experiments_on_target_and_status"
  end

  create_table "agentkit_findings", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "detector", null: false
    t.jsonb "evidence", default: {}, null: false
    t.string "severity", default: "medium", null: false
    t.string "status", default: "open", null: false
    t.string "subject"
    t.string "suggested_level", default: "n1", null: false
    t.text "summary"
    t.datetime "updated_at", null: false
    t.index ["detector", "subject"], name: "index_agentkit_findings_on_detector_and_subject"
    t.index ["status", "severity"], name: "index_agentkit_findings_on_status_and_severity"
  end

  create_table "agentkit_golden_cases", force: :cascade do |t|
    t.string "agent_name", null: false
    t.datetime "created_at", null: false
    t.jsonb "expected", default: {}, null: false
    t.boolean "frozen", default: false, null: false
    t.jsonb "input", default: {}, null: false
    t.string "label"
    t.string "rejection_code"
    t.bigint "suggestion_id"
    t.datetime "updated_at", null: false
    t.index ["agent_name", "frozen"], name: "index_agentkit_golden_cases_on_agent_name_and_frozen"
  end

  create_table "agentkit_metrics", force: :cascade do |t|
    t.integer "count", default: 0, null: false
    t.datetime "created_at", null: false
    t.jsonb "dims", default: {}, null: false
    t.jsonb "histogram", default: {}, null: false
    t.float "max"
    t.float "min"
    t.string "name", null: false
    t.float "p50"
    t.float "p90"
    t.float "p95"
    t.float "p99"
    t.string "period", default: "day", null: false
    t.date "period_start", null: false
    t.float "stddev"
    t.float "sum"
    t.datetime "updated_at", null: false
    t.index ["name", "period", "period_start", "dims"], name: "idx_agentkit_metrics_unique", unique: true
  end

  create_table "agentkit_run_steps", force: :cascade do |t|
    t.integer "attempt_count", default: 0
    t.jsonb "attempts", default: [], null: false
    t.datetime "created_at", null: false
    t.text "error"
    t.datetime "finished_at"
    t.jsonb "input", default: {}, null: false
    t.string "kind", null: false
    t.jsonb "output", default: {}, null: false
    t.bigint "parent_step_id"
    t.integer "pending_count"
    t.integer "position"
    t.bigint "run_id", null: false
    t.datetime "started_at"
    t.string "status", default: "pending", null: false
    t.string "step_key", null: false
    t.string "step_name", null: false
    t.datetime "timeout_at"
    t.datetime "updated_at", null: false
    t.jsonb "usage", default: {}, null: false
    t.index ["parent_step_id"], name: "index_agentkit_run_steps_on_parent_step_id"
    t.index ["run_id", "status"], name: "index_agentkit_run_steps_on_run_id_and_status"
    t.index ["run_id", "step_key"], name: "index_agentkit_run_steps_on_run_id_and_step_key", unique: true
    t.index ["run_id"], name: "index_agentkit_run_steps_on_run_id"
  end

  create_table "agentkit_runs", force: :cascade do |t|
    t.bigint "account_id"
    t.jsonb "context", default: {}, null: false
    t.decimal "cost_usd", precision: 12, scale: 6, default: "0.0"
    t.datetime "created_at", null: false
    t.datetime "deadline_at"
    t.jsonb "error"
    t.datetime "finished_at"
    t.string "flow_name", null: false
    t.integer "flow_version", default: 1, null: false
    t.string "idempotency_key"
    t.jsonb "input", default: {}, null: false
    t.jsonb "output", default: {}, null: false
    t.uuid "run_id", null: false
    t.datetime "started_at"
    t.string "status", default: "pending", null: false
    t.integer "steps_completed", default: 0
    t.integer "steps_total", default: 0
    t.bigint "subject_id"
    t.string "subject_type"
    t.string "tenant_key"
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.index ["flow_name", "status"], name: "index_agentkit_runs_on_flow_name_and_status"
    t.index ["idempotency_key"], name: "index_agentkit_runs_on_idempotency_key", unique: true, where: "(idempotency_key IS NOT NULL)"
    t.index ["run_id"], name: "index_agentkit_runs_on_run_id", unique: true
    t.index ["subject_type", "subject_id"], name: "index_agentkit_runs_on_subject"
  end

  create_table "agentkit_suggestions", force: :cascade do |t|
    t.bigint "account_id"
    t.datetime "created_at", null: false
    t.text "description"
    t.datetime "expires_at"
    t.string "gate_key"
    t.string "idempotency_key"
    t.jsonb "metadata", default: {}, null: false
    t.string "model"
    t.jsonb "payload", default: {}, null: false
    t.string "priority", default: "medium", null: false
    t.string "prompt_id"
    t.integer "prompt_version"
    t.datetime "resolved_at"
    t.uuid "run_id"
    t.string "source_agent"
    t.string "status", default: "pending", null: false
    t.bigint "suggestable_id"
    t.string "suggestable_type"
    t.string "suggestion_type", null: false
    t.string "tenant_key"
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.index ["gate_key"], name: "index_agentkit_suggestions_on_gate_key"
    t.index ["idempotency_key"], name: "index_agentkit_suggestions_on_idempotency_key"
    t.index ["status", "priority"], name: "index_agentkit_suggestions_on_status_and_priority"
    t.index ["suggestable_type", "suggestable_id"], name: "index_agentkit_suggestions_on_suggestable"
    t.index ["tenant_key", "status"], name: "index_agentkit_suggestions_on_tenant_key_and_status"
  end

  create_table "agentkit_trace_phases", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.jsonb "data", default: {}, null: false
    t.string "name", null: false
    t.datetime "occurred_at", null: false
    t.integer "position", null: false
    t.bigint "trace_id", null: false
    t.datetime "updated_at", null: false
    t.index ["trace_id", "position"], name: "index_agentkit_trace_phases_on_trace_id_and_position"
    t.index ["trace_id"], name: "index_agentkit_trace_phases_on_trace_id"
  end

  create_table "agentkit_traces", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "duration_ms"
    t.datetime "finished_at"
    t.string "kind", null: false
    t.jsonb "meta", default: {}, null: false
    t.uuid "run_id"
    t.datetime "started_at"
    t.string "status", default: "running", null: false
    t.string "tenant_key"
    t.uuid "trace_id", null: false
    t.string "trigger", null: false
    t.datetime "updated_at", null: false
    t.index ["kind", "started_at"], name: "index_agentkit_traces_on_kind_and_started_at"
    t.index ["run_id"], name: "index_agentkit_traces_on_run_id"
    t.index ["trace_id"], name: "index_agentkit_traces_on_trace_id", unique: true
  end

  create_table "agentkit_usage_events", force: :cascade do |t|
    t.string "agent"
    t.decimal "cost_usd", precision: 12, scale: 6, default: "0.0"
    t.datetime "created_at", null: false
    t.integer "input_tokens", default: 0
    t.string "kind", null: false
    t.string "model"
    t.datetime "occurred_at", null: false
    t.integer "output_tokens", default: 0
    t.uuid "run_id"
    t.string "tenant_key"
    t.datetime "updated_at", null: false
    t.index ["kind", "occurred_at"], name: "index_agentkit_usage_events_on_kind_and_occurred_at"
    t.index ["tenant_key", "occurred_at"], name: "index_agentkit_usage_events_on_tenant_key_and_occurred_at"
  end

  create_table "analysis_evidences", force: :cascade do |t|
    t.bigint "call_analysis_id", null: false
    t.datetime "created_at", null: false
    t.text "explanation", null: false
    t.string "finding", null: false
    t.jsonb "transcript_turn_ids", default: [], null: false
    t.datetime "updated_at", null: false
    t.index ["call_analysis_id"], name: "index_analysis_evidences_on_call_analysis_id"
  end

  create_table "call_analyses", force: :cascade do |t|
    t.datetime "analyzed_at"
    t.datetime "created_at", null: false
    t.uuid "external_analysis_id"
    t.boolean "needs_human_review", default: false, null: false
    t.bigint "phone_call_id", null: false
    t.uuid "request_id"
    t.decimal "result_confidence", precision: 4, scale: 3, default: "0.0", null: false
    t.string "status", default: "completed", null: false
    t.datetime "updated_at", null: false
    t.jsonb "verdict", default: {}, null: false
    t.index ["external_analysis_id"], name: "index_call_analyses_on_external_analysis_id", unique: true
    t.index ["phone_call_id"], name: "index_call_analyses_on_phone_call_id", unique: true
    t.index ["request_id"], name: "index_call_analyses_on_request_id", unique: true
  end

  create_table "call_analyzer_webhook_events", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.uuid "event_id", null: false
    t.string "event_type", default: "analysis.completed", null: false
    t.jsonb "payload", default: {}, null: false
    t.string "payload_sha256", null: false
    t.datetime "processed_at"
    t.string "processing_status", default: "received", null: false
    t.datetime "updated_at", null: false
    t.index ["event_id"], name: "index_call_analyzer_webhook_events_on_event_id", unique: true
  end

  create_table "call_contracts", force: :cascade do |t|
    t.jsonb "allowed_commitments", default: {}, null: false
    t.bigint "call_request_id", null: false
    t.datetime "created_at", null: false
    t.jsonb "escalation_conditions", default: [], null: false
    t.jsonb "forbidden_commitments", default: [], null: false
    t.text "objective", null: false
    t.jsonb "required_disclosures", default: [], null: false
    t.string "schema_version", default: "1.0", null: false
    t.string "snapshot_hash", null: false
    t.jsonb "success_conditions", default: [], null: false
    t.datetime "updated_at", null: false
    t.index ["call_request_id"], name: "index_call_contracts_on_call_request_id", unique: true
    t.index ["snapshot_hash"], name: "index_call_contracts_on_snapshot_hash"
  end

  create_table "call_policies", force: :cascade do |t|
    t.boolean "active", default: true, null: false
    t.jsonb "allowed_commitments", default: {}, null: false
    t.datetime "created_at", null: false
    t.jsonb "escalation_conditions", default: [], null: false
    t.jsonb "forbidden_commitments", default: [], null: false
    t.integer "maximum_surcharge_cents", default: 25000, null: false
    t.bigint "provider_profile_id", null: false
    t.jsonb "required_disclosures", default: [], null: false
    t.jsonb "success_conditions", default: [], null: false
    t.string "task_category", default: "delivery_change", null: false
    t.datetime "updated_at", null: false
    t.integer "version", default: 1, null: false
    t.index ["provider_profile_id", "task_category", "version"], name: "idx_on_provider_profile_id_task_category_version_ee20187b22", unique: true
    t.index ["provider_profile_id"], name: "index_call_policies_on_provider_profile_id"
  end

  create_table "call_requests", force: :cascade do |t|
    t.string "agentkit_run_id"
    t.bigint "call_policy_id", null: false
    t.string "confirmation_token"
    t.datetime "confirmed_at"
    t.datetime "created_at", null: false
    t.string "idempotency_key", null: false
    t.boolean "live_mode", default: false, null: false
    t.text "objective", null: false
    t.boolean "operator_initiated", default: false, null: false
    t.bigint "provider_profile_id", null: false
    t.string "recipient_phone_e164", null: false
    t.string "simulation_scenario", default: "policy_violation", null: false
    t.string "status", default: "pending", null: false
    t.datetime "updated_at", null: false
    t.index ["agentkit_run_id"], name: "index_call_requests_on_agentkit_run_id", unique: true, where: "(agentkit_run_id IS NOT NULL)"
    t.index ["call_policy_id"], name: "index_call_requests_on_call_policy_id"
    t.index ["confirmation_token"], name: "index_call_requests_on_confirmation_token", unique: true, where: "(confirmation_token IS NOT NULL)"
    t.index ["idempotency_key"], name: "index_call_requests_on_idempotency_key", unique: true
    t.index ["operator_initiated"], name: "index_call_requests_on_operator_initiated"
    t.index ["provider_profile_id"], name: "index_call_requests_on_provider_profile_id"
    t.check_constraint "live_mode = false OR confirmed_at IS NOT NULL", name: "callproof_live_calls_require_confirmation"
  end

  create_table "phone_calls", force: :cascade do |t|
    t.bigint "call_request_id", null: false
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.string "provider", default: "fake", null: false
    t.string "provider_call_id", null: false
    t.datetime "started_at"
    t.string "status", default: "pending", null: false
    t.jsonb "structured_result", default: {}, null: false
    t.jsonb "transcript", default: {"turns" => [], "language" => "en"}, null: false
    t.datetime "updated_at", null: false
    t.index ["call_request_id"], name: "index_phone_calls_on_call_request_id", unique: true
    t.index ["provider", "provider_call_id"], name: "index_phone_calls_on_provider_and_provider_call_id", unique: true
  end

  create_table "provider_profiles", force: :cascade do |t|
    t.boolean "active", default: true, null: false
    t.datetime "created_at", null: false
    t.jsonb "metadata", default: {}, null: false
    t.string "name", null: false
    t.string "phone_number_e164", null: false
    t.datetime "updated_at", null: false
  end

  add_foreign_key "agentkit_artifacts", "agentkit_runs", column: "run_id"
  add_foreign_key "agentkit_decisions", "agentkit_suggestions", column: "suggestion_id"
  add_foreign_key "agentkit_experiments", "agentkit_findings", column: "finding_id"
  add_foreign_key "agentkit_run_steps", "agentkit_runs", column: "run_id"
  add_foreign_key "agentkit_trace_phases", "agentkit_traces", column: "trace_id"
  add_foreign_key "analysis_evidences", "call_analyses"
  add_foreign_key "call_analyses", "phone_calls"
  add_foreign_key "call_contracts", "call_requests"
  add_foreign_key "call_policies", "provider_profiles"
  add_foreign_key "call_requests", "call_policies"
  add_foreign_key "call_requests", "provider_profiles"
  add_foreign_key "phone_calls", "call_requests"
end
