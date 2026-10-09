import type { OrganizationRecord, SubscriptionRecord } from "./types";

const subscriptionsByUser = new Map<number, SubscriptionRecord>();
const orgsByUser = new Map<number, OrganizationRecord>();
const promotionalGrants = new Map<number, Set<string>>();

export function resetBillingStore() {
  subscriptionsByUser.clear();
  orgsByUser.clear();
  promotionalGrants.clear();
}

export function getSubscription(userId: number): SubscriptionRecord | null {
  return subscriptionsByUser.get(userId) ?? null;
}

export function setSubscription(record: SubscriptionRecord): void {
  subscriptionsByUser.set(record.userId, record);
}

export function getOrganizationForUser(userId: number): OrganizationRecord | null {
  return orgsByUser.get(userId) ?? null;
}

export function setOrganizationForUser(userId: number, org: OrganizationRecord): void {
  orgsByUser.set(userId, org);
}

export function addPromotionalGrant(userId: number, feature: string): void {
  const set = promotionalGrants.get(userId) ?? new Set();
  set.add(feature);
  promotionalGrants.set(userId, set);
}

export function getPromotionalGrants(userId: number): string[] {
  return [...(promotionalGrants.get(userId) ?? [])];
}

export function listAllSubscriptions(): SubscriptionRecord[] {
  return [...subscriptionsByUser.values()];
}
