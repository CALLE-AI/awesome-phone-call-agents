ALTER TABLE "live_simulator_authorizations"
  DROP CONSTRAINT "live_simulator_authorizations_phase6_safety_check";

-- CALL-E may rotate its outbound caller identity. Version 2 authorizations therefore
-- begin without a caller digest; the first validly signed callback atomically stores it
-- together with the provider CallSid. All remaining safety claims stay mandatory.
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
