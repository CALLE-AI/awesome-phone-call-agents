-- Where a figure came from.
--
-- Defaulting every existing row to ESTIMATE is the accurate backfill, not a
-- lazy one: no contact in the catalogue had a recorded source, so ESTIMATE is
-- the true value for all of them.
CREATE TYPE "Provenance" AS ENUM ('ESTIMATE', 'SOURCED');
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "audienceProvenance" "Provenance" NOT NULL DEFAULT 'ESTIMATE';
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "rateProvenance" "Provenance" NOT NULL DEFAULT 'ESTIMATE';
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "sourceNote" TEXT;
