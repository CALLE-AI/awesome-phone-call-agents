CREATE TYPE "live_simulator_cleanup_state" AS ENUM (
  'barrier_pending',
  'awaiting_identity',
  'awaiting_arrival',
  'awaiting_terminal',
  'awaiting_grace',
  'restoration_ready',
  'restoration_started',
  'restored',
  'secrets_revoked',
  'host_stopped',
  'tunnel_stopped',
  'complete',
  'blocked'
);

ALTER TABLE "live_simulator_authorizations"
  ADD COLUMN "dispatch_closed_at" TIMESTAMPTZ(3),
  ADD COLUMN "cleanup_state" "live_simulator_cleanup_state",
  ADD COLUMN "cleanup_deadline_at" TIMESTAMPTZ(3),
  ADD COLUMN "cleanup_owner_digest" CHAR(64),
  ADD COLUMN "cleanup_blocked_reason" VARCHAR(64),
  ADD COLUMN "cleanup_state_changed_at" TIMESTAMPTZ(3),
  ADD COLUMN "cleanup_grace_until_at" TIMESTAMPTZ(3),
  ADD COLUMN "cleanup_terminal_status" VARCHAR(32);

ALTER TABLE "live_simulator_authorizations"
  ADD CONSTRAINT "live_simulator_authorizations_cleanup_shape_check"
  CHECK (
    (
      "cleanup_state" IS NULL
      AND "dispatch_closed_at" IS NULL
      AND "cleanup_deadline_at" IS NULL
      AND "cleanup_owner_digest" IS NULL
      AND "cleanup_blocked_reason" IS NULL
      AND "cleanup_state_changed_at" IS NULL
      AND "cleanup_grace_until_at" IS NULL
      AND "cleanup_terminal_status" IS NULL
    )
    OR (
      "cleanup_state" IS NOT NULL
      AND "dispatch_closed_at" IS NOT NULL
      AND "cleanup_deadline_at" IS NOT NULL
      AND "cleanup_owner_digest" IS NOT NULL
      AND "cleanup_state_changed_at" IS NOT NULL
      AND "cleanup_deadline_at" > "dispatch_closed_at"
      AND "cleanup_state_changed_at" >= "dispatch_closed_at"
      AND (("cleanup_state" = 'blocked') = ("cleanup_blocked_reason" IS NOT NULL))
      AND (("cleanup_grace_until_at" IS NULL) = ("cleanup_terminal_status" IS NULL))
      AND (
        "cleanup_state" <> 'awaiting_grace'
        OR (
          "cleanup_grace_until_at" IS NOT NULL
          AND "cleanup_grace_until_at" <= "cleanup_deadline_at"
        )
      )
    )
  );

ALTER TABLE "live_simulator_authorizations"
  ADD CONSTRAINT "live_simulator_authorizations_dispatch_cleanup_fence_check"
  CHECK (
    "dispatch_claimed_at" IS NULL
    OR "dispatch_closed_at" IS NULL
    OR "dispatch_claimed_at" <= "dispatch_closed_at"
  );
