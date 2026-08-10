export interface DonorResult {
  pledge: "pledge confirmed" | "pledge reduced" | "pledge withdrawn";
  quantity: string;
  slot: "slot-early" | "slot-late" | "none";
  storage: "ambient" | "chilled" | "unknown";
  packaging: "sealed" | "mixed" | "unknown";
}

export interface DemoDonor {
  id: string;
  name: string;
  phone: string;
  expected: string;
  optedIn: true;
  result: DonorResult;
}

export const donors: readonly DemoDonor[] = [
  {
    id: "harbor-bakery",
    name: "Harbor Bakery",
    phone: "+12*******42",
    expected: "24 trays",
    optedIn: true,
    result: { pledge: "pledge confirmed", quantity: "24 trays", slot: "slot-early", storage: "ambient", packaging: "sealed" },
  },
  {
    id: "market-kitchen",
    name: "Market Kitchen",
    phone: "+12*******71",
    expected: "8 crates",
    optedIn: true,
    result: { pledge: "pledge reduced", quantity: "8 crates", slot: "slot-late", storage: "chilled", packaging: "mixed" },
  },
  {
    id: "garden-grocer",
    name: "Garden Grocer",
    phone: "+12*******96",
    expected: "18 boxes",
    optedIn: true,
    result: { pledge: "pledge withdrawn", quantity: "0 boxes", slot: "none", storage: "unknown", packaging: "unknown" },
  },
] as const;

export const evidence = ["11/11 tests", "SDK contract verified", "No transcript stored", "Masked phone numbers"] as const;
