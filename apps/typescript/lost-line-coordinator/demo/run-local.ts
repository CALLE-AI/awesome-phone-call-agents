import { parseSearchRequest } from "../src/request.js";
import { formatPreview } from "../src/plan.js";
import { runSearch } from "../src/workflow.js";
import type { CallePort } from "../src/types.js";

const request = parseSearchRequest({
  search_id: "search-0a1b2c3d4e5f",
  owner_has_authorized_search: true,
  owner_authorized_at: "2026-08-01T11:45:00Z",
  authorization_valid_until: "2026-08-01T13:00:00Z",
  claim_verification_detail_withheld: true,
  item: {
    category: "small backpack",
    color: "navy blue",
    brand: "Northstar",
    distinctive_features: ["orange zipper pull", "silver bicycle patch"],
    lost_after: "2026-08-01T08:00:00Z",
    lost_before: "2026-08-01T11:30:00Z",
  },
  locations: [
    { id: "harbor-cafe", display_name: "Harbor Cafe", phone: "+12025550142", published_source: "https://example.com/cafe", published_contact_confirmed: true, published_contact_verified_at: "2026-08-01T11:30:00Z", calling_hours_confirmed: true, region: "US", locale: "en-US" },
    { id: "ferry-desk", display_name: "Ferry Desk", phone: "+12025550171", published_source: "https://example.com/ferry", published_contact_confirmed: true, published_contact_verified_at: "2026-08-01T11:30:00Z", calling_hours_confirmed: true, region: "US", locale: "en-US" },
    { id: "bookshop", display_name: "Market Bookshop", phone: "+12025550196", published_source: "https://example.com/books", published_contact_confirmed: true, published_contact_verified_at: "2026-08-01T11:30:00Z", calling_hours_confirmed: true, region: "US", locale: "en-US" },
  ],
  policy: { max_calls: 3, do_not_leave_voicemail: true, stop_after_strong_match: true, call_window_start: "2026-08-01T12:00:00Z", call_window_end: "2026-08-01T12:30:00Z" },
});

let calls = 0;
const createdPhones = new Map<string, string>();
const fake: CallePort = {
  async create(input) {
    calls += 1;
    const phone = input.recipients[0]!.phones[0]!;
    const id = `call_demo_00${calls}`;
    createdPhones.set(id, phone);
    return {
      id,
      status: "queued",
      recipients: [{ phones: [phone], status: "pending", structuredResult: null }],
    };
  },
  async waitForResult(callId) {
    const phone = createdPhones.get(callId);
    if (!phone) throw new Error("Unknown local demo call id.");
    const sequence = Number(callId.slice(-1));
    return {
      id: callId,
      status: "completed",
      taskCompleted: true,
      recipients: [{
        phones: [phone],
        status: "completed",
        structuredResult: sequence === 1
          ? { recipient_agreed_to_continue: true, desk_status: "reached", item_logged: "no", matched_feature_ids: [], contradicted_feature_ids: [], reference_code: "", retrieval_mode: "official-channel", human_follow_up_required: false }
          : { recipient_agreed_to_continue: true, desk_status: "reached", item_logged: "yes", matched_feature_ids: ["F1", "F2"], contradicted_feature_ids: [], reference_code: "LF-204", retrieval_mode: "official-channel", human_follow_up_required: true },
      }],
    };
  },
};

console.log(formatPreview(request));
console.log("\n--- Local fake run; no network and no phone call ---\n");
const report = await runSearch(request, fake, { now: () => new Date("2026-08-01T12:05:00Z") });
console.log(JSON.stringify(report, null, 2));
console.log(`\nProvider tasks created: ${calls}`);
