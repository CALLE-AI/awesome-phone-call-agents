export const CUSTOMERS = [
  "Northwind Logistics",
  "Brightline Cloud",
  "Cedar Health",
  "Helix Capital",
  "Atlas Freight",
  "Vesper Labs"
];

export const HUBS = [
  {
    title: "Marketing hub",
    body: "Campaigns, landing pages, and attribution land on the same record sales already uses. No more exporting lists into a second tool."
  },
  {
    title: "Sales hub",
    body: "Pipelines, sequences, and forecasting built for teams that run six- and seven-figure cycles. Managers see the same truth AEs see."
  },
  {
    title: "Service hub",
    body: "Tickets sit on the customer timeline. Renewals, expansions, and incidents are visible before the QBR, not after."
  }
];

export function planSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_");
}

export function planContactHref(plan: string): string {
  return `/demo/contact?plan=${encodeURIComponent(plan)}`;
}

export const PLANS = [
  {
    name: "Starter",
    plan: "starter",
    price: "$49",
    cadence: "per seat / month",
    billed: "Billed annually, or $59 month-to-month",
    blurb: "For a focused team replacing spreadsheets and a shared inbox.",
    cta: "get_demo" as const,
    ctaLabel: "Get Demo",
    featured: false,
    features: [
      "Up to 5,000 contacts",
      "One pipeline and deal board",
      "Email tracking and templates",
      "Meeting scheduler",
      "Standard reports",
      "Marketing + sales hubs"
    ]
  },
  {
    name: "Professional",
    plan: "professional",
    price: "$149",
    cadence: "per seat / month",
    billed: "Billed annually, or $179 month-to-month",
    blurb: "For revenue teams that need sequences, forecast, and a shared operating cadence.",
    cta: "get_demo" as const,
    ctaLabel: "Get Demo",
    featured: true,
    features: [
      "Everything in Starter",
      "Unlimited contacts and pipelines",
      "Sequences and task queues",
      "Custom objects and properties",
      "Forecasting and attribution",
      "Workflows and approvals",
      "Google and Microsoft SSO"
    ]
  },
  {
    name: "Enterprise",
    plan: "enterprise",
    price: "Custom",
    cadence: "annual contract",
    billed: "Security review and sandbox included",
    blurb: "For global teams that need residency, SCIM, and a named success lead.",
    cta: "talk_to_sales" as const,
    ctaLabel: "Talk to sales",
    featured: false,
    features: [
      "Everything in Professional",
      "SAML / SCIM provisioning",
      "Advanced roles and audit log",
      "Unlimited sandboxes",
      "EU / US data residency options",
      "99.99% uptime SLA",
      "Named CSM and solution architect"
    ]
  }
];

export const COMPARISON = [
  { feature: "Contacts", starter: "5,000", professional: "Unlimited", enterprise: "Unlimited" },
  { feature: "Pipelines", starter: "1", professional: "Unlimited", enterprise: "Unlimited" },
  { feature: "Sequences", starter: "—", professional: "Included", enterprise: "Included" },
  { feature: "Forecasting", starter: "—", professional: "Included", enterprise: "Included" },
  { feature: "SSO", starter: "—", professional: "Google / Microsoft", enterprise: "SAML / SCIM" },
  { feature: "Sandbox", starter: "—", professional: "1", enterprise: "Unlimited" },
  { feature: "Data residency", starter: "—", professional: "—", enterprise: "EU or US" },
  { feature: "Dedicated CSM", starter: "—", professional: "—", enterprise: "Included" },
  { feature: "Uptime SLA", starter: "—", professional: "99.9%", enterprise: "99.99%" }
];

export const REVIEWS = [
  {
    name: "Maya Example",
    title: "VP of Sales",
    company: "Northwind Logistics",
    quote:
      "We replaced three spreadsheets and a graveyard of HubSpot fields. Harbor is the first CRM our AEs actually live in during a deal cycle.",
    rating: 5,
    date: "12 Mar 2026",
    photo: "/harbor/harbor-reviewer-maya.png"
  },
  {
    name: "James Example",
    title: "Chief Revenue Officer",
    company: "Brightline Cloud",
    quote:
      "Enterprise SSO and a sandbox landed in weeks, not a quarter. Forecast finally matches what finance sees, which is the only review that matters here.",
    rating: 5,
    date: "28 Feb 2026",
    photo: "/harbor/harbor-reviewer-james.png"
  },
  {
    name: "Elena Example",
    title: "Head of Revenue Operations",
    company: "Cedar Health",
    quote:
      "Security questionnaire was straightforward. Reporting is good enough that we stopped the weekly CSV ritual. RevOps finally owns the object model.",
    rating: 5,
    date: "4 Jan 2026",
    photo: "/harbor/harbor-reviewer-elena.png"
  },
  {
    name: "Diego Example",
    title: "Director of Sales",
    company: "Helix Capital",
    quote:
      "Our average contract is north of $180k. Harbor does not treat that like a ticket. Sequences, buying-committee views, and a clean activity timeline — that is the product.",
    rating: 4,
    date: "19 Dec 2025",
    photo: "/harbor/harbor-reviewer-diego.png"
  }
];

export const FAQS = [
  {
    topic: "enterprise_upgrade",
    q: "Can we start on Professional and upgrade to Enterprise later?",
    a: "Yes. Seats and hubs are additive. Move to Enterprise when you need SAML/SCIM, residency, or a named CSM. Existing records and automations carry forward."
  },
  {
    topic: "sandbox",
    q: "Do you offer a sandbox?",
    a: "Professional includes one sandbox. Enterprise includes unlimited sandboxes for UAT, training, and seasonal campaigns."
  },
  {
    topic: "inbound_forms",
    q: "How does Harbor handle inbound forms?",
    a: "Native forms write straight to the CRM record, with UTMs and campaign source first-class. High-intent visitors can also talk to sales without leaving the page."
  },
  {
    topic: "data_residency",
    q: "Where is data hosted?",
    a: "Professional runs in US-East. Enterprise can pin a workspace to US or EU. Subprocessors are listed in the security pack we send with every enterprise trial."
  },
  {
    topic: "attribution",
    q: "Can marketing ops map UTMs and multi-touch attribution?",
    a: "Campaign, source, and medium are native contact fields. Professional adds multi-touch attribution across ads, forms, and sales activity."
  },
  {
    topic: "free_tier",
    q: "Is there a free tier?",
    a: "Starter is the paid entry plan. Get a demo if you want a guided workspace with your own pipeline before you buy seats."
  },
  {
    topic: "onboarding",
    q: "What does onboarding look like for a 40-person revenue team?",
    a: "Professional includes a shared implementation guide. Enterprise includes a solution architect, a 30-day cutover plan, and office hours with your CSM."
  },
  {
    topic: "crm_import",
    q: "Do you support Salesforce or HubSpot imports?",
    a: "Yes. We import accounts, contacts, deals, and notes. Field mapping is reviewed with you before the cutover weekend."
  }
];
