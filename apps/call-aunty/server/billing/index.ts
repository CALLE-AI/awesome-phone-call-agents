export { billingService, createBillingService, type BillingService } from "./service";
export { PLAN_CATALOG, getPlanById, formatDisplayPrice } from "./catalog";
export { ALWAYS_FREE_FEATURES, ETHICAL_COPY_PRINCIPLES } from "./ethical-policy";
export { isEntitled, requireEntitlement, describeFeatureForUi } from "./feature-gate";
export { getPublicV6BillingFlags } from "./v6-flags";
export { billingErrorMessage, isBillingErrorCode, isBillingUpgradeCode } from "./errors";
export type { FeatureKey, PublicEntitlements, PlanCatalogEntry } from "./types";
