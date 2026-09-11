import type { CpscRecall } from "../src/types.js";

export const recallFixture: CpscRecall = {
  id: 10887,
  number: "26651",
  date: "2026-07-30T00:00:00",
  title: "Example toddler tower recall",
  description: "A fictionalized test description.",
  officialUrl: "https://www.cpsc.gov/Recalls/example",
  consumerContact: "Example Firm toll-free at (833) 555-0108 weekdays.",
  products: [{ name: "Example Foldable Toddler Tower", units: "About 40,000" }],
  hazards: ["The product can tip over."],
  remedies: ["Stop using the product and request a repair kit."],
  remedyOptions: ["Repair"],
};
