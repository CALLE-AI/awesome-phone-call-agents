-- CreateEnum
CREATE TYPE "observation_provenance" AS ENUM ('SIMULATED', 'PROVIDER_OBSERVED');

-- CreateEnum
CREATE TYPE "endpoint_compatibility" AS ENUM ('simulator-tested', 'provider-observed');

-- CreateEnum
CREATE TYPE "dtmf_policy_kind" AS ENUM ('forbidden', 'allowlisted_fixed_plan');

-- CreateEnum
CREATE TYPE "expected_zone_applicability" AS ENUM ('required', 'reviewed_not_applicable');

-- CreateEnum
CREATE TYPE "call_attempt_stage" AS ENUM ('scheduled', 'calling', 'extracting', 'terminal');

-- CreateEnum
CREATE TYPE "call_attempt_terminal_outcome" AS ENUM ('observation_recorded', 'blocked', 'no_answer', 'busy', 'provider_failed', 'evidence_unavailable');

-- CreateEnum
CREATE TYPE "observation_trigger" AS ENUM ('manual', 'scheduled');

-- CreateEnum
CREATE TYPE "evidence_source_completeness" AS ENUM ('complete', 'truncated', 'unknown');

-- CreateEnum
CREATE TYPE "observation_quality" AS ENUM ('complete', 'partial', 'unknown', 'invalid');

-- CreateEnum
CREATE TYPE "reading_disposition" AS ENUM ('grounded', 'missing', 'ambiguous', 'contradictory', 'reviewed_not_applicable', 'invalid');

-- CreateTable
CREATE TABLE "endpoints" (
    "organization_id" VARCHAR(128) NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "active_adapter_version_id" VARCHAR(128),
    "authorization_reference_id" VARCHAR(256) NOT NULL,

    CONSTRAINT "endpoints_pkey" PRIMARY KEY ("organization_id","id")
);

-- CreateTable
CREATE TABLE "adapter_versions" (
    "organization_id" VARCHAR(128) NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "endpoint_id" VARCHAR(128) NOT NULL,
    "dtmf_policy_kind" "dtmf_policy_kind" NOT NULL,
    "dtmf_plan_reference_id" VARCHAR(256),
    "dtmf_instruction_fingerprint" VARCHAR(256),
    "compatibility" "endpoint_compatibility" NOT NULL,
    "provenance" "observation_provenance" NOT NULL,

    CONSTRAINT "adapter_versions_pkey" PRIMARY KEY ("organization_id","id")
);

-- CreateTable
CREATE TABLE "adapter_expected_zones" (
    "organization_id" VARCHAR(128) NOT NULL,
    "endpoint_id" VARCHAR(128) NOT NULL,
    "adapter_version_id" VARCHAR(128) NOT NULL,
    "zone_id" VARCHAR(128) NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "applicability" "expected_zone_applicability" NOT NULL,
    "required_facet" VARCHAR(64) NOT NULL,
    "admissible_minimum" VARCHAR(128),
    "admissible_maximum" VARCHAR(128),

    CONSTRAINT "adapter_expected_zones_pkey" PRIMARY KEY ("organization_id","adapter_version_id","zone_id")
);

-- CreateTable
CREATE TABLE "adapter_zone_unit_mappings" (
    "organization_id" VARCHAR(128) NOT NULL,
    "endpoint_id" VARCHAR(128) NOT NULL,
    "adapter_version_id" VARCHAR(128) NOT NULL,
    "zone_id" VARCHAR(128) NOT NULL,
    "rule_id" VARCHAR(128) NOT NULL,
    "spoken_unit" VARCHAR(128) NOT NULL,
    "normalized_unit" VARCHAR(128) NOT NULL,

    CONSTRAINT "adapter_zone_unit_mappings_pkey" PRIMARY KEY ("organization_id","adapter_version_id","zone_id","rule_id")
);

-- CreateTable
CREATE TABLE "call_attempts" (
    "organization_id" VARCHAR(128) NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "endpoint_id" VARCHAR(128) NOT NULL,
    "adapter_version_id" VARCHAR(128) NOT NULL,
    "idempotency_key" VARCHAR(256) NOT NULL,
    "trigger" "observation_trigger" NOT NULL,
    "provenance" "observation_provenance" NOT NULL,
    "semantic_fingerprint" VARCHAR(256) NOT NULL,
    "provider_dispatch_identity" VARCHAR(256) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "stage" "call_attempt_stage" NOT NULL,
    "last_transition_at" TIMESTAMPTZ(3) NOT NULL,
    "terminal_outcome" "call_attempt_terminal_outcome",
    "retryable" BOOLEAN,
    "latest_evidence_id" VARCHAR(128),
    "latest_observation_id" VARCHAR(128),
    "resource_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "call_attempts_pkey" PRIMARY KEY ("organization_id","id")
);

-- CreateTable
CREATE TABLE "evidence_records" (
    "organization_id" VARCHAR(128) NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "call_attempt_id" VARCHAR(128) NOT NULL,
    "endpoint_id" VARCHAR(128) NOT NULL,
    "adapter_version_id" VARCHAR(128) NOT NULL,
    "revision" INTEGER NOT NULL,
    "predecessor_evidence_id" VARCHAR(128),
    "provider_run_id" VARCHAR(256) NOT NULL,
    "provider_revision_id" VARCHAR(256) NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "retained_at" TIMESTAMPTZ(3) NOT NULL,
    "opaque_custody_ref" VARCHAR(512) NOT NULL,
    "provenance" "observation_provenance" NOT NULL,
    "source_completeness" "evidence_source_completeness" NOT NULL,

    CONSTRAINT "evidence_records_pkey" PRIMARY KEY ("organization_id","id")
);

-- CreateTable
CREATE TABLE "observations" (
    "organization_id" VARCHAR(128) NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "operation_id" VARCHAR(128) NOT NULL,
    "endpoint_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "predecessor_observation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "evidence_id" VARCHAR(128) NOT NULL,
    "evidence_revision_id" VARCHAR(256) NOT NULL,
    "adapter_version_id" VARCHAR(128) NOT NULL,
    "extractor_version_id" VARCHAR(128) NOT NULL,
    "reconciliation_policy_version" VARCHAR(128) NOT NULL,
    "provenance" "observation_provenance" NOT NULL,
    "quality" "observation_quality" NOT NULL,
    "input_fingerprint" VARCHAR(256) NOT NULL,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("organization_id","id")
);

-- CreateTable
CREATE TABLE "readings" (
    "organization_id" VARCHAR(128) NOT NULL,
    "operation_id" VARCHAR(128) NOT NULL,
    "observation_id" VARCHAR(128) NOT NULL,
    "endpoint_id" VARCHAR(128) NOT NULL,
    "adapter_version_id" VARCHAR(128) NOT NULL,
    "evidence_id" VARCHAR(128) NOT NULL,
    "evidence_revision_id" VARCHAR(256) NOT NULL,
    "zone_id" VARCHAR(128) NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "disposition" "reading_disposition" NOT NULL,
    "value" VARCHAR(128),
    "spoken_unit" VARCHAR(128),
    "normalized_unit" VARCHAR(128),
    "confidence_token" VARCHAR(128),
    "confidence_semantics_version" VARCHAR(128),
    "candidate_ids" TEXT[],
    "evidence_anchor_ids" TEXT[],
    "reason_codes" TEXT[],
    "provider_run_id" VARCHAR(256) NOT NULL,
    "extractor_version_id" VARCHAR(128) NOT NULL,
    "source_captured_at" TIMESTAMPTZ(3) NOT NULL,
    "derived_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "readings_pkey" PRIMARY KEY ("organization_id","observation_id","zone_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "adapter_versions_org_endpoint_id_key" ON "adapter_versions"("organization_id", "endpoint_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "adapter_expected_zones_org_endpoint_adapter_zone_key" ON "adapter_expected_zones"("organization_id", "endpoint_id", "adapter_version_id", "zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "adapter_expected_zones_org_adapter_ordinal_key" ON "adapter_expected_zones"("organization_id", "adapter_version_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "adapter_zone_unit_mappings_exact_key" ON "adapter_zone_unit_mappings"("organization_id", "adapter_version_id", "zone_id", "spoken_unit", "normalized_unit");

-- CreateIndex
CREATE INDEX "call_attempts_org_stage_accepted_at_idx" ON "call_attempts"("organization_id", "stage", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "call_attempts_org_idempotency_key" ON "call_attempts"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "call_attempts_org_provider_dispatch_identity_key" ON "call_attempts"("organization_id", "provider_dispatch_identity");

-- CreateIndex
CREATE UNIQUE INDEX "call_attempts_org_id_endpoint_adapter_key" ON "call_attempts"("organization_id", "id", "endpoint_id", "adapter_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_records_org_attempt_id_key" ON "evidence_records"("organization_id", "call_attempt_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_records_org_attempt_revision_key" ON "evidence_records"("organization_id", "call_attempt_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_records_provider_revision_key" ON "evidence_records"("organization_id", "provider_run_id", "provider_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_records_exact_lineage_key" ON "evidence_records"("organization_id", "call_attempt_id", "adapter_version_id", "id", "provider_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_records_reading_correlation_key" ON "evidence_records"("organization_id", "call_attempt_id", "adapter_version_id", "id", "provider_revision_id", "provider_run_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "observations_org_operation_id_key" ON "observations"("organization_id", "operation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "observations_org_operation_version_key" ON "observations"("organization_id", "operation_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "observations_derivation_identity_key" ON "observations"("organization_id", "operation_id", "evidence_id", "adapter_version_id", "extractor_version_id", "reconciliation_policy_version");

-- CreateIndex
CREATE UNIQUE INDEX "readings_org_observation_ordinal_key" ON "readings"("organization_id", "observation_id", "ordinal");

-- AddForeignKey
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_organization_id_id_active_adapter_version_id_fkey" FOREIGN KEY ("organization_id", "id", "active_adapter_version_id") REFERENCES "adapter_versions"("organization_id", "endpoint_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adapter_versions" ADD CONSTRAINT "adapter_versions_organization_id_endpoint_id_fkey" FOREIGN KEY ("organization_id", "endpoint_id") REFERENCES "endpoints"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adapter_expected_zones" ADD CONSTRAINT "adapter_expected_zones_organization_id_endpoint_id_adapter_fkey" FOREIGN KEY ("organization_id", "endpoint_id", "adapter_version_id") REFERENCES "adapter_versions"("organization_id", "endpoint_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adapter_zone_unit_mappings" ADD CONSTRAINT "adapter_zone_unit_mappings_organization_id_endpoint_id_ada_fkey" FOREIGN KEY ("organization_id", "endpoint_id", "adapter_version_id", "zone_id") REFERENCES "adapter_expected_zones"("organization_id", "endpoint_id", "adapter_version_id", "zone_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_organization_id_endpoint_id_adapter_version__fkey" FOREIGN KEY ("organization_id", "endpoint_id", "adapter_version_id") REFERENCES "adapter_versions"("organization_id", "endpoint_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_organization_id_id_latest_evidence_id_fkey" FOREIGN KEY ("organization_id", "id", "latest_evidence_id") REFERENCES "evidence_records"("organization_id", "call_attempt_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_organization_id_id_latest_observation_id_fkey" FOREIGN KEY ("organization_id", "id", "latest_observation_id") REFERENCES "observations"("organization_id", "operation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_organization_id_call_attempt_id_endpoint__fkey" FOREIGN KEY ("organization_id", "call_attempt_id", "endpoint_id", "adapter_version_id") REFERENCES "call_attempts"("organization_id", "id", "endpoint_id", "adapter_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_organization_id_endpoint_id_adapter_versi_fkey" FOREIGN KEY ("organization_id", "endpoint_id", "adapter_version_id") REFERENCES "adapter_versions"("organization_id", "endpoint_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_organization_id_call_attempt_id_predecess_fkey" FOREIGN KEY ("organization_id", "call_attempt_id", "predecessor_evidence_id") REFERENCES "evidence_records"("organization_id", "call_attempt_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_organization_id_operation_id_endpoint_id_adap_fkey" FOREIGN KEY ("organization_id", "operation_id", "endpoint_id", "adapter_version_id") REFERENCES "call_attempts"("organization_id", "id", "endpoint_id", "adapter_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_organization_id_operation_id_adapter_version__fkey" FOREIGN KEY ("organization_id", "operation_id", "adapter_version_id", "evidence_id", "evidence_revision_id") REFERENCES "evidence_records"("organization_id", "call_attempt_id", "adapter_version_id", "id", "provider_revision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_organization_id_endpoint_id_adapter_version_i_fkey" FOREIGN KEY ("organization_id", "endpoint_id", "adapter_version_id") REFERENCES "adapter_versions"("organization_id", "endpoint_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_organization_id_operation_id_predecessor_obse_fkey" FOREIGN KEY ("organization_id", "operation_id", "predecessor_observation_id") REFERENCES "observations"("organization_id", "operation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "readings" ADD CONSTRAINT "readings_organization_id_operation_id_observation_id_fkey" FOREIGN KEY ("organization_id", "operation_id", "observation_id") REFERENCES "observations"("organization_id", "operation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "readings" ADD CONSTRAINT "readings_organization_id_operation_id_adapter_version_id_e_fkey" FOREIGN KEY ("organization_id", "operation_id", "adapter_version_id", "evidence_id", "evidence_revision_id", "provider_run_id", "source_captured_at") REFERENCES "evidence_records"("organization_id", "call_attempt_id", "adapter_version_id", "id", "provider_revision_id", "provider_run_id", "captured_at") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "readings" ADD CONSTRAINT "readings_organization_id_endpoint_id_adapter_version_id_fkey" FOREIGN KEY ("organization_id", "endpoint_id", "adapter_version_id") REFERENCES "adapter_versions"("organization_id", "endpoint_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "readings" ADD CONSTRAINT "readings_organization_id_endpoint_id_adapter_version_id_zo_fkey" FOREIGN KEY ("organization_id", "endpoint_id", "adapter_version_id", "zone_id") REFERENCES "adapter_expected_zones"("organization_id", "endpoint_id", "adapter_version_id", "zone_id") ON DELETE RESTRICT ON UPDATE CASCADE;
