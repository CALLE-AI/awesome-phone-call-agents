-- Negotiation outcome on a call.
--
-- Both columns are nullable with no default and no backfill, on purpose:
-- every call placed before this migration was an enquiry that never asked for
-- an opening rate, so NULL is the true value for them. Defaulting
-- "openingPricePkr" to "pricePkr" would have invented a negotiation that did
-- not happen on 18 real calls.
ALTER TABLE "Call" ADD COLUMN "openingPricePkr" INTEGER;
ALTER TABLE "Call" ADD COLUMN "concession" TEXT;
