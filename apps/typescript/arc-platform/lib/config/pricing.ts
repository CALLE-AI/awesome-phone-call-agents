export const PLANS = {
  STARTER: {
    id: "starter",
    name: "Starter",
    description: "For brands exploring radio advertising",
    monthly_pkr: 8000,
    monthly_usd: 29,
    annual_pkr: 76800,  // 20% discount
    annual_usd: 278,
    stripe_price_monthly: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
    stripe_price_annual:  process.env.STRIPE_STARTER_ANNUAL_PRICE_ID,
    color: "#8B87B8",
    limits: {
      ai_scripts_per_month:        5,
      active_campaigns:            3,
      users:                       1,
      radio_stations_per_booking:  2,
    },
    features: [
      "5 AI-generated scripts per month",
      "Radio station marketplace access",
      "Self-serve slot booking",
      "Basic campaign dashboard",
      "JazzCash + card payment",
      "1 user seat",
    ],
  },

  GROWTH: {
    id: "growth",
    name: "Growth",
    description: "For brands scaling their campaigns",
    monthly_pkr: 40000,
    monthly_usd: 149,
    annual_pkr: 384000,
    annual_usd: 1430,
    stripe_price_monthly: process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID,
    stripe_price_annual:  process.env.STRIPE_GROWTH_ANNUAL_PRICE_ID,
    color: "#4F46E5",
    limits: {
      ai_scripts_per_month:        Infinity,
      active_campaigns:            Infinity,
      users:                       5,
      radio_stations_per_booking:  Infinity,
    },
    features: [
      "Unlimited AI script generation",
      "Full influencer marketplace",
      "AI influencer matching engine",
      "Unified analytics dashboard",
      "Cross-channel attribution",
      "5 user seats",
      "Priority support (24h response)",
    ],
  },

  ENTERPRISE: {
    id: "enterprise",
    name: "Enterprise",
    description: "For agencies and large brands",
    monthly_pkr: 275000,
    monthly_usd: 999,
    annual_pkr: 2640000,
    annual_usd: 9590,
    stripe_price_monthly: process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID,
    stripe_price_annual:  process.env.STRIPE_ENTERPRISE_ANNUAL_PRICE_ID,
    color: "#0D9488",
    limits: {
      ai_scripts_per_month:        Infinity,
      active_campaigns:            Infinity,
      users:                       Infinity,
      radio_stations_per_booking:  Infinity,
    },
    features: [
      "Everything in Growth",
      "Agency multi-brand dashboard",
      "Unlimited user seats",
      "Open API access",
      "Custom integrations",
      "Dedicated account manager (Karachi/Dubai)",
      "SLA + 99.9% uptime guarantee",
      "Custom contract",
    ],
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export const PLAN_ORDER: PlanKey[] = ["STARTER", "GROWTH", "ENTERPRISE"];

export const MARKETPLACE_COMMISSION = {
  radio:      0.10,  // 10% on radio bookings
  influencer: 0.15,  // 15% on influencer fees (escrow released on delivery)
} as const;

export const ESCROW_RELEASE_DAYS = 7; // days after campaign delivery to auto-release

export const BANK_DETAILS = {
  bankName:      "Meezan Bank (Islamic)",
  accountName:   "Arc Platform (Pvt.) Ltd.",
  accountNumber: "0123-0123456789",
  iban:          "PK36MEZN0001230123456789",
  swiftCode:     "MEZNPKKA",
} as const;

export const JAZZCASH_MERCHANT_NUMBER = "03001234567";
export const EASYPAISA_MERCHANT_NUMBER = "03331234567";
