-- The callable identity of a station or creator, and the number Arc may dial.
--
-- Numbers used to live in ARC_CONTACTS, so changing one meant a redeploy. They
-- live here now; the env var stays as a fallback so nothing breaks while the
-- table fills up. "phone" is nullable because a contact we hold no number for
-- must stay distinguishable from one we do - the card says NO PHONE, and that
-- is how a silent fan-out failure was caught.
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ItemKind" NOT NULL,
    "channel" TEXT,
    "city" TEXT,
    "frequency" TEXT,
    "audienceSize" INTEGER,
    "rateEstimatePkr" INTEGER,
    "phone" TEXT,
    "isDemoContact" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contact_externalId_key" ON "Contact"("externalId");
CREATE INDEX "Contact_type_idx" ON "Contact"("type");
