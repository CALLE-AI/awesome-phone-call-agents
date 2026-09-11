CREATE TYPE "live_simulator_authorization_state" AS ENUM ('issued', 'reserved', 'bound');

CREATE TABLE "live_simulator_authorizations" (
  "organization_id" VARCHAR(128) NOT NULL,
  "operation_id" VARCHAR(128) NOT NULL,
  "nonce_digest" CHAR(64) NOT NULL,
  "semantic_digest" CHAR(64) NOT NULL,
  "scenario_id" VARCHAR(128) NOT NULL,
  "scenario_revision" INTEGER NOT NULL,
  "audience" VARCHAR(128) NOT NULL,
  "endpoint_alias" VARCHAR(128) NOT NULL,
  "predecessor_operation_id" VARCHAR(128),
  "issued_at" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "state" "live_simulator_authorization_state" NOT NULL DEFAULT 'issued',
  "reserved_at" TIMESTAMPTZ(3),
  "provider_dispatch_identity" VARCHAR(256),
  "bound_at" TIMESTAMPTZ(3),

  CONSTRAINT "live_simulator_authorizations_pkey"
    PRIMARY KEY ("organization_id", "operation_id"),
  CONSTRAINT "live_simulator_authorizations_time_check"
    CHECK ("expires_at" > "issued_at"),
  CONSTRAINT "live_simulator_authorizations_revision_check"
    CHECK ("scenario_revision" > 0),
  CONSTRAINT "live_simulator_authorizations_nonce_digest_check"
    CHECK ("nonce_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "live_simulator_authorizations_semantic_digest_check"
    CHECK ("semantic_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "live_simulator_authorizations_state_fields_check"
    CHECK (
      ("state" = 'issued' AND "reserved_at" IS NULL AND "provider_dispatch_identity" IS NULL AND "bound_at" IS NULL) OR
      ("state" = 'reserved' AND "reserved_at" IS NOT NULL AND "provider_dispatch_identity" IS NULL AND "bound_at" IS NULL) OR
      ("state" = 'bound' AND "reserved_at" IS NOT NULL AND "provider_dispatch_identity" IS NOT NULL AND "bound_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "live_simulator_authorizations_nonce_digest_key"
ON "live_simulator_authorizations" ("nonce_digest");

CREATE UNIQUE INDEX "live_simulator_authorizations_provider_dispatch_key"
ON "live_simulator_authorizations" ("provider_dispatch_identity");

CREATE INDEX "live_simulator_authorizations_predecessor_idx"
ON "live_simulator_authorizations" ("organization_id", "predecessor_operation_id");
