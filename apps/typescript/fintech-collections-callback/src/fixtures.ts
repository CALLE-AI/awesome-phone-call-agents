// Sample overdue accounts for dry-run demos.
// Phone numbers are fictional: US/UK values use official reserved-for-fiction
// ranges (NANP 555-0100..0199; Ofcom 020 7946 0xxx). Ghana has no reserved
// range, so its number is an obvious placeholder and must never be dialed.
// Deliberately includes accounts the gate will BLOCK, to show enforcement.

import type { OverdueAccount } from "./types.js";

export const SAMPLE_ACCOUNTS: OverdueAccount[] = [
  {
    accountId: "ACC-1001",
    customerName: "Ama Boateng",
    phone: "+12025550143",
    region: "US",
    timezone: "America/New_York",
    amountDueCents: 24999,
    currency: "USD",
    dueDate: "2026-07-15",
    daysPastDue: 25,
    consentToContact: true,
    consentTimestamp: "2026-06-01T10:00:00Z",
    language: "en-US",
  },
  {
    accountId: "ACC-1002",
    customerName: "Kwame Mensah",
    phone: "+233302000000", // fictional placeholder (Ghana has no reserved range)
    region: "GH",
    timezone: "Africa/Accra",
    amountDueCents: 180000,
    currency: "GHS",
    dueDate: "2026-07-20",
    daysPastDue: 20,
    consentToContact: true,
    consentTimestamp: "2026-05-12T09:30:00Z",
    language: "en-GH",
  },
  {
    // BLOCKED: no consent on file.
    accountId: "ACC-1003",
    customerName: "Jordan Rivera",
    phone: "+12025550188",
    region: "US",
    timezone: "America/Los_Angeles",
    amountDueCents: 5000,
    currency: "USD",
    dueDate: "2026-07-28",
    daysPastDue: 12,
    consentToContact: false,
  },
  {
    // BLOCKED: consent flag set but no timestamp to prove it.
    accountId: "ACC-1004",
    customerName: "Priya Nair",
    phone: "+442079460958", // Ofcom reserved-for-drama range (020 7946 0xxx)
    region: "GB",
    timezone: "Europe/London",
    amountDueCents: 42000,
    currency: "GBP",
    dueDate: "2026-07-10",
    daysPastDue: 30,
    consentToContact: true,
    language: "en-GB",
  },
  {
    // BLOCKED: phone is not valid E.164.
    accountId: "ACC-1005",
    customerName: "Sam Osei",
    phone: "0202555017",
    region: "US",
    timezone: "America/Chicago",
    amountDueCents: 9900,
    currency: "USD",
    dueDate: "2026-07-22",
    daysPastDue: 18,
    consentToContact: true,
    consentTimestamp: "2026-06-18T14:00:00Z",
    language: "en-US",
  },
];
