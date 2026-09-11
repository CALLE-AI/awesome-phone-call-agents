-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "audit_event_kind" AS ENUM ('foundation.health.checked');

-- CreateEnum
CREATE TYPE "audit_event_outcome" AS ENUM ('ready', 'degraded');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" VARCHAR(128) NOT NULL,
    "organization_id" VARCHAR(128) NOT NULL,
    "kind" "audit_event_kind" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "outcome" "audit_event_outcome" NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_org_occurred_at_idx" ON "audit_events"("organization_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_org_kind_idempotency_key" ON "audit_events"("organization_id", "kind", "idempotency_key");
