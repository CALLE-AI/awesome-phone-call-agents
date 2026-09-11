-- AlterTable
ALTER TABLE "MediaPlanItem" ADD COLUMN     "bookedAt" TIMESTAMP(3),
ADD COLUMN     "bookedDates" TIMESTAMP(3)[],
ADD COLUMN     "bookedSlots" TEXT[],
ADD COLUMN     "bookedTotalPkr" INTEGER,
ADD COLUMN     "spots" INTEGER;

