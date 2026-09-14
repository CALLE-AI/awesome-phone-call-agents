-- The conversation, stored with the call.
--
-- The plan's "heard here" link opens the moment a figure was spoken. Fetching
-- that from CALL-E at render time would make the last beat of the demo depend
-- on an API that has been returning 503 for hours at a time.
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "transcript" JSONB;
