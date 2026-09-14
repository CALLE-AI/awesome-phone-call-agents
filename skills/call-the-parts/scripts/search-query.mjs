#!/usr/bin/env node
/**
 * Builds web-search queries for used automotive spare parts shops. Does not call any search API.
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    year: { type: "string" },
    make: { type: "string" },
    model: { type: "string" },
    part: { type: "string" },
    city: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(
    "Usage: node scripts/search-query.mjs --year 2016 --make Honda --model Civic --part radiator --city Austin",
  );
  process.exit(0);
}

for (const key of ["year", "make", "model", "part", "city"]) {
  if (!values[key]) {
    console.error(`missing --${key}`);
    process.exit(1);
  }
}

const fitment = `${values.year} ${values.make} ${values.model} ${values.part}`;
const city = values.city;
const queries = [
  `${fitment} used spare parts shop ${city}`,
  `${values.make} ${values.model} ${values.part} used automotive parts near ${city} phone`,
  `${fitment} used auto parts ${city}`,
];

console.log(
  JSON.stringify(
    {
      mode: "query-only",
      searched: false,
      city,
      queries,
      next: "Run these queries with the harness native web search. Do not use Firecrawl. Present candidates. Do not dial until the user confirms a number.",
    },
    null,
    2,
  ),
);
