/** Local Harbor demo copy used when ingesting `/demo` — no network required. */

export const HARBOR_DEMO_URL = "/demo";

export const HARBOR_COMPANY_ABOUT =
  "Harbor is a CRM for high-ticket revenue teams. Marketing, sales, and success share one account record so a six- or seven-figure cycle does not live in five tools and a spreadsheet named final_v7. Typical first-year contracts run $80k–$400k. Harbor is SOC 2 Type II and can pin a workspace to the US or EU.";

export const HARBOR_QUALIFICATION_REPORT = `Qualify inbound callers who asked for a callback from Harbor. Learn why they are looking now, what they run today, how many people would live in Harbor, and whether this is a fit — without turning the call into a screening.

Good fit: high-ticket teams replacing HubSpot fields, spreadsheets, or a fragmented stack; professional or enterprise seats; residency, SSO, or a named success lead when the cycle warrants it.

Do not book a calendar slot. Do not recite clickstream or page-hit counts. Pass a human follow-up only if they ask.`;

export function harborCompanyCorpus(): string {
  return [
    "Harbor CRM — The CRM built for high-ticket teams.",
    HARBOR_COMPANY_ABOUT,
    "Platform: one customer record with marketing, sales, and service hubs that stay in sync. Campaigns, landing pages, and attribution land on the same record sales already uses.",
    "Plans: Starter $49 per seat / month for a focused team replacing spreadsheets. Professional $149 per seat / month for sequences, forecast, and a shared operating cadence. Enterprise is a custom annual contract with SAML/SCIM, unlimited sandboxes, EU or US residency, and a named CSM.",
    "Customers include Northwind Logistics, Brightline Cloud, Cedar Health, Helix Capital, Atlas Freight, and Vesper Labs.",
    "Inbound forms write straight to the CRM record, with UTMs and campaign source first-class. High-intent visitors can talk to sales without leaving the page.",
    "Imports: Salesforce or HubSpot accounts, contacts, deals, and notes. Field mapping is reviewed before the cutover weekend.",
    "Onboarding for a 40-person revenue team: Professional includes a shared implementation guide. Enterprise includes a solution architect and a 30-day cutover plan."
  ].join("\n\n");
}
