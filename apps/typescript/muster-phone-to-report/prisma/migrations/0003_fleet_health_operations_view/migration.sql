ALTER TABLE "endpoints"
ADD COLUMN "site_display_name" VARCHAR(160),
ADD COLUMN "endpoint_display_name" VARCHAR(160),
ADD COLUMN "freshness_window_seconds" INTEGER;

ALTER TABLE "endpoints"
ADD CONSTRAINT "endpoints_site_display_name_check"
CHECK (
  "site_display_name" IS NULL OR
  (char_length("site_display_name") BETWEEN 1 AND 160 AND btrim("site_display_name") = "site_display_name")
),
ADD CONSTRAINT "endpoints_endpoint_display_name_check"
CHECK (
  "endpoint_display_name" IS NULL OR
  (char_length("endpoint_display_name") BETWEEN 1 AND 160 AND btrim("endpoint_display_name") = "endpoint_display_name")
),
ADD CONSTRAINT "endpoints_freshness_window_seconds_check"
CHECK (
  "freshness_window_seconds" IS NULL OR
  "freshness_window_seconds" BETWEEN 60 AND 2592000
);

CREATE INDEX "call_attempts_org_endpoint_accepted_id_idx"
ON "call_attempts" ("organization_id", "endpoint_id", "accepted_at", "id");

CREATE INDEX "evidence_records_org_endpoint_captured_id_idx"
ON "evidence_records" ("organization_id", "endpoint_id", "captured_at", "id");

CREATE INDEX "observations_org_endpoint_quality_tie_idx"
ON "observations" ("organization_id", "endpoint_id", "quality", "operation_id", "version", "id");
