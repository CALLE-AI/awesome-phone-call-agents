CREATE TYPE "live_demo_review_cleanup_state" AS ENUM (
  'ready',
  'cleanup_pending',
  'cleanup_blocked',
  'deleted'
);

ALTER TABLE "live_simulator_authorizations"
  ADD COLUMN "review_session_id" VARCHAR(128),
  ADD COLUMN "review_ready_at" TIMESTAMPTZ(3),
  ADD COLUMN "review_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "review_cleanup_state" "live_demo_review_cleanup_state",
  ADD COLUMN "review_cleanup_state_changed_at" TIMESTAMPTZ(3),
  ADD COLUMN "review_custody_ownership_digest" CHAR(64),
  ADD COLUMN "review_database_ownership_digest" CHAR(64);

CREATE UNIQUE INDEX "live_simulator_authorizations_review_session_key"
  ON "live_simulator_authorizations"("review_session_id");

ALTER TABLE "live_simulator_authorizations"
  ADD CONSTRAINT "live_simulator_authorizations_review_lifecycle_check"
  CHECK (
    (
      "review_session_id" IS NULL
      AND "review_ready_at" IS NULL
      AND "review_expires_at" IS NULL
      AND "review_cleanup_state" IS NULL
      AND "review_cleanup_state_changed_at" IS NULL
      AND "review_custody_ownership_digest" IS NULL
      AND "review_database_ownership_digest" IS NULL
    )
    OR (
      "review_session_id" IS NOT NULL
      AND "review_ready_at" IS NOT NULL
      AND "review_expires_at" = "review_ready_at" + INTERVAL '30 minutes'
      AND "review_cleanup_state" IS NOT NULL
      AND "review_cleanup_state_changed_at" >= "review_ready_at"
      AND "review_custody_ownership_digest" ~ '^[0-9a-f]{64}$'
      AND "review_database_ownership_digest" ~ '^[0-9a-f]{64}$'
      AND "cleanup_state" = 'complete'
    )
  );

CREATE TABLE "live_demo_review_database_ownership" (
  "singleton" BOOLEAN NOT NULL DEFAULT TRUE,
  "session_id" VARCHAR(128) NOT NULL,
  "operation_id" VARCHAR(128) NOT NULL,
  "ownership_digest" CHAR(64) NOT NULL,
  "provisioning_ownership_digest" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "live_demo_review_database_ownership_pkey" PRIMARY KEY ("singleton"),
  CONSTRAINT "live_demo_review_database_ownership_singleton_check" CHECK ("singleton" = TRUE),
  CONSTRAINT "live_demo_review_database_ownership_session_key" UNIQUE ("session_id"),
  CONSTRAINT "live_demo_review_database_ownership_shape_check" CHECK (
    "session_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    AND "operation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    AND "ownership_digest" ~ '^[0-9a-f]{64}$'
    AND "provisioning_ownership_digest" ~ '^[0-9a-f]{64}$'
  )
);

CREATE FUNCTION "prevent_live_demo_review_lease_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."review_ready_at" IS NOT NULL AND (
    NEW."review_session_id" IS DISTINCT FROM OLD."review_session_id"
    OR NEW."review_ready_at" IS DISTINCT FROM OLD."review_ready_at"
    OR NEW."review_expires_at" IS DISTINCT FROM OLD."review_expires_at"
    OR NEW."review_custody_ownership_digest" IS DISTINCT FROM OLD."review_custody_ownership_digest"
    OR NEW."review_database_ownership_digest" IS DISTINCT FROM OLD."review_database_ownership_digest"
  ) THEN
    RAISE EXCEPTION 'live demo review lease is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "live_demo_review_lease_immutable"
BEFORE UPDATE ON "live_simulator_authorizations"
FOR EACH ROW EXECUTE FUNCTION "prevent_live_demo_review_lease_mutation"();

CREATE FUNCTION "prevent_live_demo_review_cleanup_regression"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."review_cleanup_state" = 'deleted' AND (
    NEW."review_cleanup_state" IS DISTINCT FROM OLD."review_cleanup_state"
    OR NEW."review_cleanup_state_changed_at" IS DISTINCT FROM OLD."review_cleanup_state_changed_at"
  ) THEN
    RAISE EXCEPTION 'live demo review cleanup is terminal';
  END IF;

  IF OLD."review_cleanup_state_changed_at" IS NOT NULL
    AND NEW."review_cleanup_state_changed_at" < OLD."review_cleanup_state_changed_at"
  THEN
    RAISE EXCEPTION 'live demo review cleanup timestamp cannot regress';
  END IF;

  IF NEW."review_cleanup_state" IS DISTINCT FROM OLD."review_cleanup_state" AND NOT (
    (OLD."review_cleanup_state" IS NULL
      AND NEW."review_cleanup_state" = 'ready')
    OR (OLD."review_cleanup_state" = 'ready'
      AND NEW."review_cleanup_state" IN ('cleanup_pending'))
    OR (OLD."review_cleanup_state" = 'cleanup_pending'
      AND NEW."review_cleanup_state" IN ('cleanup_blocked', 'deleted'))
    OR (OLD."review_cleanup_state" = 'cleanup_blocked'
      AND NEW."review_cleanup_state" IN ('cleanup_pending'))
  ) THEN
    RAISE EXCEPTION 'live demo review cleanup transition is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "live_demo_review_cleanup_monotonic"
BEFORE UPDATE ON "live_simulator_authorizations"
FOR EACH ROW EXECUTE FUNCTION "prevent_live_demo_review_cleanup_regression"();
