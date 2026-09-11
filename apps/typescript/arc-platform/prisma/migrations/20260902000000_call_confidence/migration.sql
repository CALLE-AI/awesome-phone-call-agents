-- What the call itself said about how well it went.
--
-- All four are nullable or empty with no backfill, on purpose: every call
-- placed before this migration was made by code that discarded CALL-E's
-- confidence and evidence entirely, and did not ask the agent to confirm a
-- rate. NULL is the true value for them. Defaulting "rateConfirmed" to false
-- would claim those calls were asked and refused, which did not happen.
ALTER TABLE "Call" ADD COLUMN "rateConfirmed" BOOLEAN;
ALTER TABLE "Call" ADD COLUMN "confidenceScore" DOUBLE PRECISION;
ALTER TABLE "Call" ADD COLUMN "confidenceLabel" TEXT;
ALTER TABLE "Call" ADD COLUMN "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[];
