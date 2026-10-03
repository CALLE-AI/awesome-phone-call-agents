import type { Db } from "../infrastructure/db";
import {
  insertTrustedContactIfAbsentStmt,
  insertVendorIfAbsentStmt,
} from "../infrastructure/db";
import type { TrustedContact, Vendor } from "../domain/types";

export const BUYER_ORG_NAME = "Acme Manufacturing";

export const SEED_VENDORS: Vendor[] = [
  { id: "ven_northstar", displayName: "Northstar Components", vendorCode: "V-1001", status: "active" },
  { id: "ven_halcyon", displayName: "Halcyon Paper Works", vendorCode: "V-1002", status: "active" },
  { id: "ven_bluepine", displayName: "Bluepine Logistics", vendorCode: "V-1003", status: "active" },
];

export const SEED_CONTACTS: TrustedContact[] = [
  {
    id: "tc_northstar_ap",
    vendorId: "ven_northstar",
    name: "Maya Chen",
    role: "Accounts Payable Manager",
    phoneE164: "+12025550114",
    region: "US",
    locale: "en-US",
    source: "erp_vendor_master",
    verifiedAt: "2026-08-20T14:00:00Z",
    active: true,
  },
  {
    id: "tc_halcyon_controller",
    vendorId: "ven_halcyon",
    name: "Ravi Patel",
    role: "Controller",
    phoneE164: "+12025550127",
    region: "US",
    locale: "en-US",
    source: "erp_vendor_master",
    verifiedAt: "2026-07-15T10:30:00Z",
    active: true,
  },
  {
    id: "tc_bluepine_finops",
    vendorId: "ven_bluepine",
    name: "Sofia Marin",
    role: "Finance Operations Lead",
    phoneE164: "+12025550138",
    region: "US",
    locale: "en-US",
    source: "erp_vendor_master",
    verifiedAt: "2026-08-02T09:15:00Z",
    active: true,
  },
];

export interface SeedEvent {
  externalEventId: string;
  vendorCode: string;
  requestedAt: string;
  sourceSystem: string;
  sourceReference: string;
  requestContactName: string;
  requestContactPhone: string;
  newDestinationLabel: string;
  scenario: string;
}

export const SEED_EVENTS: SeedEvent[] = [
  {
    externalEventId: "evt-2026-0910-ns",
    vendorCode: "V-1001",
    requestedAt: "2026-09-10T09:12:00Z",
    sourceSystem: "erp_demo",
    sourceReference: "VMD-4471",
    requestContactName: "Accounts Team",
    requestContactPhone: "+13125550199",
    newDestinationLabel: "bank account ending 4410",
    scenario: "denied",
  },
  {
    externalEventId: "evt-2026-0911-hp",
    vendorCode: "V-1002",
    requestedAt: "2026-09-11T15:40:00Z",
    sourceSystem: "erp_demo",
    sourceReference: "VMD-4488",
    requestContactName: "R. Patel (claimed)",
    requestContactPhone: "+12025550199",
    newDestinationLabel: "bank account ending 9021",
    scenario: "confirmed",
  },
  {
    externalEventId: "evt-2026-0912-bl",
    vendorCode: "V-1003",
    requestedAt: "2026-09-12T11:05:00Z",
    sourceSystem: "erp_demo",
    sourceReference: "VMD-4502",
    requestContactName: "S. Marin (claimed)",
    requestContactPhone: "+13125550166",
    newDestinationLabel: "bank account ending 3355",
    scenario: "unable-to-verify",
  },
  {
    externalEventId: "evt-2026-0912-ns2",
    vendorCode: "V-1001",
    requestedAt: "2026-09-12T17:22:00Z",
    sourceSystem: "erp_demo",
    sourceReference: "VMD-4507",
    requestContactName: "Vendor Portal",
    requestContactPhone: "+13125550177",
    newDestinationLabel: "bank account ending 7712",
    scenario: "unreachable",
  },
];

// Atomic and concurrency-safe: a single write batch of INSERT OR IGNORE
// statements means two initializers racing on the same database both succeed,
// and a partially seeded database is repaired rather than skipped. No
// count-then-insert — the unique constraints own idempotency.
export async function seedFixtures(db: Db): Promise<void> {
  await db.batch(
    [
      ...SEED_VENDORS.map(insertVendorIfAbsentStmt),
      ...SEED_CONTACTS.map(insertTrustedContactIfAbsentStmt),
    ],
    "write",
  );
}
