-- The catalogue estimate at the moment of the call.
--
-- A confirmed rate has to be judged against what we expected THEN. Reading
-- today's catalogue would make an old call's plausibility drift every time the
-- estimate is edited, and would silently re-judge calls nobody re-made.
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "estimateAtCallPkr" INTEGER;
