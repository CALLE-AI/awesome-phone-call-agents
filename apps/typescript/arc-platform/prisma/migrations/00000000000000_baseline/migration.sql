-- CreateEnum
CREATE TYPE "Industry" AS ENUM ('FMCG', 'TELECOM', 'FASHION_APPAREL', 'REAL_ESTATE', 'EDTECH', 'FOOD_BEVERAGE', 'BANKING_FINANCE', 'AUTOMOTIVE', 'HEALTHCARE_PHARMA', 'ECOMMERCE', 'MEDIA_ENTERTAINMENT', 'NGO_NONPROFIT', 'GOVERNMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "City" AS ENUM ('KARACHI', 'LAHORE', 'ISLAMABAD', 'RAWALPINDI', 'FAISALABAD', 'PESHAWAR', 'QUETTA', 'MULTAN', 'HYDERABAD', 'SIALKOT', 'DUBAI', 'ABU_DHABI', 'RIYADH', 'JEDDAH', 'CAIRO', 'OTHER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('ALL', 'PRIMARILY_MALE', 'PRIMARILY_FEMALE');

-- CreateEnum
CREATE TYPE "BudgetRange" AS ENUM ('UNDER_50K', 'RANGE_50_150K', 'RANGE_150_500K', 'RANGE_500K_1M', 'RANGE_1M_5M', 'ABOVE_5M');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STARTER', 'GROWTH', 'ENTERPRISE', 'FREE_TRIAL');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "clerkOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "industry" "Industry" NOT NULL,
    "subIndustry" TEXT,
    "website" TEXT,
    "ntn" TEXT,
    "primaryCity" "City" NOT NULL DEFAULT 'KARACHI',
    "targetCities" "City"[],
    "targetAudience" TEXT NOT NULL DEFAULT '',
    "audienceAgeMin" INTEGER NOT NULL DEFAULT 18,
    "audienceAgeMax" INTEGER NOT NULL DEFAULT 45,
    "audienceGender" "Gender" NOT NULL DEFAULT 'ALL',
    "monthlyBudget" "BudgetRange" NOT NULL DEFAULT 'UNDER_50K',
    "plan" "Plan" NOT NULL DEFAULT 'STARTER',
    "planExpiresAt" TIMESTAMP(3),
    "onboardingDone" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" INTEGER NOT NULL DEFAULT 1,
    "aiCreditsUsed" INTEGER NOT NULL DEFAULT 0,
    "aiCreditsLimit" INTEGER NOT NULL DEFAULT 5,
    "stripeCustomerId" TEXT,
    "channels" TEXT[],
    "campaignGoal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandUser" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_clerkOrgId_key" ON "Brand"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandUser_clerkId_key" ON "BrandUser"("clerkId");

-- AddForeignKey
ALTER TABLE "BrandUser" ADD CONSTRAINT "BrandUser_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

