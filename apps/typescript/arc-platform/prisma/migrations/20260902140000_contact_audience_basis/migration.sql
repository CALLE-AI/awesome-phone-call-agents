-- A station's daily listeners and a creator's followers are different
-- quantities. One column called "audienceSize" holding both is how a screen
-- ends up labelling one as the other, so the number now travels with a word
-- saying what it counts. Existing rows are backfilled from the type, which is
-- the only place that fact currently lives.
ALTER TABLE "Contact" RENAME COLUMN "audienceSize" TO "audience";
ALTER TABLE "Contact" ADD COLUMN "audienceBasis" TEXT;
ALTER TABLE "Contact" ADD COLUMN "handle" TEXT;
ALTER TABLE "Contact" ADD COLUMN "category" TEXT;

UPDATE "Contact"
   SET "audienceBasis" = CASE WHEN "type" = 'STATION' THEN 'daily listeners' ELSE 'followers' END
 WHERE "audience" IS NOT NULL;
