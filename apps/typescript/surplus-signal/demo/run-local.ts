import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { formatPreview } from "../src/plan.js";
import { parseDriveRequest } from "../src/request.js";
import { runDrive } from "../src/workflow.js";
import type { CallePort } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const request = parseDriveRequest(JSON.parse(await readFile(join(here, "../examples/drive.example.json"), "utf8")) as unknown);
const createdPhones = new Map<string, string>();
let calls = 0;
const results = [
  {
    recipient_agreed_to_continue: true,
    recipient_status: "reached",
    pledge_status: "confirmed",
    confirmed_units: 24,
    pickup_slot_id: "slot-early",
    storage_mode: "ambient",
    packaging_state: "sealed",
    human_follow_up_required: false,
  },
  {
    recipient_agreed_to_continue: true,
    recipient_status: "reached",
    pledge_status: "reduced",
    confirmed_units: 8,
    pickup_slot_id: "slot-late",
    storage_mode: "chilled",
    packaging_state: "mixed",
    human_follow_up_required: true,
  },
  {
    recipient_agreed_to_continue: true,
    recipient_status: "reached",
    pledge_status: "withdrawn",
    confirmed_units: 0,
    pickup_slot_id: "none",
    storage_mode: "unknown",
    packaging_state: "unknown",
    human_follow_up_required: false,
  },
] as const;

const fake: CallePort = {
  async create(input) {
    calls += 1;
    const id = `call_demo_00${calls}`;
    createdPhones.set(id, input.recipients[0]!.phones[0]!);
    return { id, status: "queued", recipients: [{ phones: [input.recipients[0]!.phones[0]!], status: "pending", structuredResult: null }] };
  },
  async waitForResult(callId) {
    const phone = createdPhones.get(callId);
    if (!phone) throw new Error("Unknown local demo call id.");
    return {
      id: callId,
      status: "completed",
      taskCompleted: true,
      recipients: [{ phones: [phone], status: "completed", structuredResult: { ...results[Number(callId.slice(-1)) - 1]! } }],
    };
  },
};

console.log(formatPreview(request));
console.log("\n--- Local fake run; no network and no phone call ---\n");
const report = await runDrive(request, fake, { now: () => new Date("2026-08-01T12:10:00Z") });
console.log(JSON.stringify(report, null, 2));
console.log(`\nProvider tasks created: ${calls}`);
