ALTER TABLE "live_simulator_authorizations"
  ADD COLUMN "authorization_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "expected_caller_digest" CHAR(64),
  ADD COLUMN "authorized_target_digest" CHAR(64),
  ADD COLUMN "public_origin" VARCHAR(512),
  ADD COLUMN "purpose" VARCHAR(64),
  ADD COLUMN "call_budget" INTEGER,
  ADD COLUMN "concurrency" INTEGER,
  ADD COLUMN "retry_budget" INTEGER,
  ADD COLUMN "dtmf_policy" VARCHAR(32),
  ADD COLUMN "terminal_deadline_seconds" INTEGER,
  ADD COLUMN "dispatch_claimed_at" TIMESTAMPTZ(3),
  ADD COLUMN "dispatch_disposition" VARCHAR(32);

-- Rows issued by pre-Phase6 code are intentionally expired and remain version 1. Their
-- missing Phase6 claims make them non-dispatchable; no caller/target/origin is fabricated.
UPDATE "live_simulator_authorizations"
   SET "expires_at" = LEAST("expires_at", CURRENT_TIMESTAMP)
 WHERE "authorization_version" = 1;

ALTER TABLE "live_simulator_authorizations"
  ADD CONSTRAINT "live_simulator_authorizations_phase6_safety_check"
  CHECK (
    (
      "authorization_version" = 1
      AND "expected_caller_digest" IS NULL
      AND "authorized_target_digest" IS NULL
      AND "public_origin" IS NULL
      AND "purpose" IS NULL
      AND "call_budget" IS NULL
      AND "concurrency" IS NULL
      AND "retry_budget" IS NULL
      AND "dtmf_policy" IS NULL
      AND "terminal_deadline_seconds" IS NULL
    )
    OR (
      "authorization_version" = 2
      AND "expected_caller_digest" IS NOT NULL
      AND "authorized_target_digest" IS NOT NULL
      AND "public_origin" IS NOT NULL
      AND "purpose" = 'non-production-synthetic-live-smoke'
      AND "call_budget" = 1
      AND "concurrency" = 1
      AND "retry_budget" = 0
      AND "dtmf_policy" = 'forbidden'
      AND "terminal_deadline_seconds" BETWEEN 1 AND 60
    )
  );

ALTER TABLE "live_simulator_authorizations"
  ADD CONSTRAINT "live_simulator_authorizations_dispatch_check"
  CHECK (
    ("dispatch_claimed_at" IS NULL AND "dispatch_disposition" IS NULL)
    OR ("dispatch_claimed_at" IS NOT NULL AND "dispatch_disposition" IS NULL)
    OR ("dispatch_claimed_at" IS NOT NULL AND "dispatch_disposition" IN ('provider_returned', 'provider_failed'))
  );

CREATE TABLE "live_simulator_provider_facts" (
  "append_ordinal" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
  "organization_id" VARCHAR(128) NOT NULL,
  "operation_id" VARCHAR(128) NOT NULL,
  "phase" VARCHAR(32) NOT NULL,
  "provider_call_digest" CHAR(64) NOT NULL,
  "semantic_digest" CHAR(64) NOT NULL,
  "outcome" VARCHAR(32) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "trace_id" CHAR(32) NOT NULL,
  "signature_validated" BOOLEAN NOT NULL,
  "actions_observed" INTEGER,
  "inbound_call_count" INTEGER,
  CONSTRAINT "live_simulator_provider_facts_pkey"
    PRIMARY KEY ("organization_id", "operation_id", "phase"),
  CONSTRAINT "live_simulator_provider_facts_actions_check"
    CHECK ("actions_observed" IS NULL OR "actions_observed" IN (0, 1)),
  CONSTRAINT "live_simulator_provider_facts_inbound_count_check"
    CHECK ("inbound_call_count" IS NULL OR "inbound_call_count" >= 0)
);

CREATE INDEX "live_simulator_provider_facts_operation_append_idx"
  ON "live_simulator_provider_facts" ("organization_id", "operation_id", "append_ordinal");
