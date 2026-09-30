// File: scripts/seed-demo.ts
// Run: pnpm tsx scripts/seed-demo.ts
import { readFileSync } from "node:fs";
import type { CallTask } from "../src/lib/calle-types";

const fx = JSON.parse(readFileSync("data/fixtures/mri-72148.json", "utf8")) as CallTask;
const quoted = fx.recipients.filter((r) => r.structured_result?.outcome === "quoted").length;
console.log(`Fixture ${fx.id}: ${fx.recipients.length} recipients, ${quoted} quoted.`);
console.log("Mock demo is self-contained. Start with: pnpm dev");
console.log("Open http://localhost:3000 -> Load sample MRI clinics -> Get a cash price.");
