-- The negotiation mandate (C-03), second attempt.
--
-- "openingPricePkr" and "concession" already exist: the first mandate's
-- migration was kept when its code was reverted on 2 September, so this adds
-- only what is new and replaces the single free-text "concession" with a
-- structured list. Every offer made is one entry, in order - a final number
-- alone cannot show that the price moved because we offered volume.
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "openingPricePkr" INTEGER;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "mandateTargetPkr" INTEGER;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "mandateWalkAwayPkr" INTEGER;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "concessions" JSONB;
ALTER TABLE "Call" DROP COLUMN IF EXISTS "concession";
