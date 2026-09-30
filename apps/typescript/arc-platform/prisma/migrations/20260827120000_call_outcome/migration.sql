-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('RESULT', 'NO_RESULT', 'NOT_CONNECTED');

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "outcome" "CallOutcome";


-- Backfill, derived from CALL-E's own stored status - not guessed.
-- 6 rows recorded status='failed'      -> the handset was never reached.
-- 1 row  recorded status='completed'   -> a person answered, no result came back.
UPDATE "Call" SET "outcome" = 'NOT_CONNECTED' WHERE "done" = true AND "status" <> 'completed';
UPDATE "Call" SET "outcome" = 'NO_RESULT',  "failed" = false
  WHERE "done" = true AND "status" = 'completed' AND "structuredResult" IS NULL;
UPDATE "Call" SET "outcome" = 'RESULT',     "failed" = false
  WHERE "done" = true AND "status" = 'completed' AND "structuredResult" IS NOT NULL;
