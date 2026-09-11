-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('STATION', 'CREATOR');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('SELECTED', 'CALLING', 'CONFIRMED', 'DECLINED', 'BOOKED');

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_brandId_fkey";

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "brief" JSONB,
ADD COLUMN     "budgetTotal" INTEGER,
ADD COLUMN     "currency" TEXT DEFAULT 'PKR',
ADD COLUMN     "durationDays" INTEGER,
ADD COLUMN     "estInfluencerCost" INTEGER,
ADD COLUMN     "estPlatformFee" INTEGER,
ADD COLUMN     "estStationCost" INTEGER,
ADD COLUMN     "estTotalCost" INTEGER,
ADD COLUMN     "estTotalReach" INTEGER,
ADD COLUMN     "flightEnd" TIMESTAMP(3),
ADD COLUMN     "flightStart" TIMESTAMP(3);

-- DropTable
DROP TABLE "Booking";

-- CreateTable
CREATE TABLE "MediaPlanItem" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" "ItemKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT,
    "city" TEXT,
    "estCostPkr" INTEGER,
    "estReach" INTEGER,
    "matchScore" DOUBLE PRECISION,
    "rationale" TEXT,
    "recommendedSlots" TEXT[],
    "confirmedRatePkr" INTEGER,
    "confirmedReach" INTEGER,
    "availability" "Availability",
    "confirmedDetail" TEXT,
    "confirmedNotes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "status" "ItemStatus" NOT NULL DEFAULT 'SELECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "campaignId" TEXT,
    "mediaPlanItemId" TEXT,
    "calleCallId" TEXT,
    "idempotencyKey" TEXT,
    "targetName" TEXT NOT NULL,
    "targetType" "ItemKind" NOT NULL,
    "targetPhone" TEXT,
    "contactName" TEXT,
    "audienceSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "done" BOOLEAN NOT NULL DEFAULT false,
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "verdict" "Availability",
    "pricePkr" INTEGER,
    "reach" INTEGER,
    "detail" TEXT,
    "notes" TEXT,
    "score" DOUBLE PRECISION,
    "summary" TEXT,
    "structuredResult" JSONB,
    "mock" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignScript" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "externalId" TEXT,
    "language" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "callToAction" TEXT NOT NULL,
    "voiceDirection" TEXT,
    "bestTimeSlots" TEXT[],
    "targetSegment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignScript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaPlanItem_campaignId_idx" ON "MediaPlanItem"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Call_calleCallId_key" ON "Call"("calleCallId");

-- CreateIndex
CREATE INDEX "Call_brandId_idx" ON "Call"("brandId");

-- CreateIndex
CREATE INDEX "Call_campaignId_idx" ON "Call"("campaignId");

-- CreateIndex
CREATE INDEX "Call_mediaPlanItemId_idx" ON "Call"("mediaPlanItemId");

-- CreateIndex
CREATE INDEX "CampaignScript_campaignId_idx" ON "CampaignScript"("campaignId");

-- CreateIndex
CREATE INDEX "Campaign_brandId_idx" ON "Campaign"("brandId");

-- AddForeignKey
ALTER TABLE "MediaPlanItem" ADD CONSTRAINT "MediaPlanItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_mediaPlanItemId_fkey" FOREIGN KEY ("mediaPlanItemId") REFERENCES "MediaPlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScript" ADD CONSTRAINT "CampaignScript_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

