import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "@/lib/ledger";
import { byItem, sightingFromEntry, summarize } from "@/lib/pulse";
import { bloodItem, freshHours, medicationItem } from "@/lib/pulse-item";
import type { CallKind, Medication } from "@/lib/types";

const NOW = Date.parse("2026-09-14T12:00:00Z");

const medication: Medication = {
  rxcui: "308189",
  name: "Amoxicillin 400 mg/5 mL Oral Suspension",
  ingredient: "amoxicillin",
  brandNames: [],
  quantity: "one 100 mL bottle",
  alternatives: [],
  controlled: false,
  deaSchedule: null,
  urgency: "today",
};

const inquiry = {
  reached: "pharmacy_staff",
  stock_status: "in_stock",
  can_fill_today: "yes",
  quantity_on_hand: "two bottles",
  alternative_available: "not_discussed",
  alternative_details: "",
  hold_offered: "yes",
  hold_duration_hours: 24,
  ready_time: "",
  cash_price: "",
  restock_eta: "",
  transfer_accepted: "yes",
  staff_name: "Dana",
  evidence_quote: "Yes, we have two bottles right here.",
  notes: "",
};

function entry({
  result,
  kind = "inquiry",
  minutesAgo = 30,
  controlled = false,
  lat = 40.6782,
}: {
  result: Record<string, unknown>;
  kind?: CallKind;
  minutesAgo?: number;
  controlled?: boolean;
  lat?: number;
}): LedgerEntry {
  const at = new Date(NOW - minutesAgo * 60_000).toISOString();
  return {
    key: `k${minutesAgo}${kind}${controlled ? "c" : ""}`,
    callId: "call_x",
    missionId: "m-test-01",
    kind,
    needKind: kind === "blood_inquiry" ? "blood_bank" : "pharmacy",
    needSummary: "",
    facility: { id: "synthetic:pharmacy:1", name: "Northgate Drug", address: "117 Example Ave", phoneMasked: null, lat, lon: -73.9442 },
    item: kind === "blood_inquiry" ? bloodItem({ group: "O-", component: "platelets", units: 2, hospital: "General", urgency: "today" }) : medicationItem({ ...medication, controlled }),
    routing: "simulation",
    mode: "simulation",
    dialTarget: "no call placed",
    brief: {} as LedgerEntry["brief"],
    task: "",
    createdAt: at,
    updatedAt: at,
    status: "completed",
    summary: null,
    turns: 0,
    providerCallIds: [],
    call: {
      id: "call_x",
      status: "completed",
      structuredResult: result,
      summary: null,
      taskCompleted: true,
      completionConfidence: null,
      evidence: [],
      metadata: {},
      failureCode: null,
      failureMessage: null,
      createdAt: at,
      completedAt: at,
      attempts: [],
      simulated: true,
    },
    events: [],
  };
}

describe("Shortage Pulse sightings", () => {
  it("publishes a validated in-stock answer without staff names or quotes", () => {
    const sighting = sightingFromEntry(entry({ result: inquiry }), NOW);
    expect(sighting).toMatchObject({ status: "available", facilityName: "Northgate Drug", quantity: "two bottles", kind: "pharmacy" });
    const text = JSON.stringify(sighting);
    expect(text).not.toContain("Dana");
    expect(text).not.toContain("two bottles right here");
  });

  it("expires answers after their freshness window, keeping 'not here' longer", () => {
    const out = { ...inquiry, stock_status: "out_of_stock", restock_eta: "Thursday" };
    expect(sightingFromEntry(entry({ result: inquiry, minutesAgo: 13 * 60 }), NOW)).toBeNull();
    expect(sightingFromEntry(entry({ result: out, minutesAgo: 13 * 60 }), NOW)).toMatchObject({ status: "out", restock: "Thursday" });
    expect(sightingFromEntry(entry({ result: out, minutesAgo: 25 * 60 }), NOW)).toBeNull();
  });

  it("never names where a controlled medication is in stock, but still shares where it is not", () => {
    const inStock = sightingFromEntry(entry({ result: inquiry, controlled: true }), NOW);
    expect(inStock).toMatchObject({ status: "available", facilityId: null, facilityName: null, quantity: "" });
    expect(inStock!.lat).toBe(40.68);
    const refused = sightingFromEntry(entry({ result: { ...inquiry, stock_status: "refused_to_disclose" }, controlled: true }), NOW);
    expect(refused).toMatchObject({ status: "refused", facilityName: "Northgate Drug" });
  });

  it("ignores unreached calls, follow-up calls, and records without coordinates", () => {
    expect(sightingFromEntry(entry({ result: { ...inquiry, reached: "voicemail", stock_status: "unknown" } }), NOW)).toBeNull();
    expect(sightingFromEntry(entry({ result: inquiry, kind: "hold" }), NOW)).toBeNull();
    const noCoords = entry({ result: inquiry });
    delete noCoords.facility.lat;
    expect(sightingFromEntry(noCoords, NOW)).toBeNull();
    expect(sightingFromEntry(entry({ result: { garbage: true } }), NOW)).toBeNull();
  });

  it("maps blood answers and summarizes them by item", () => {
    const blood = sightingFromEntry(
      entry({
        kind: "blood_inquiry",
        result: {
          reached: "facility_staff",
          stock_status: "partial",
          units_available: "one unit",
          can_issue_today: "yes",
          reserve_offered: "yes",
          reserve_duration_hours: 4,
          requisition_required: "unknown",
          crossmatch_sample_required: "unknown",
          replacement_donor_required: "unknown",
          processing_charge: "",
          open_24x7: "unknown",
          referral_or_restock: "Camp tomorrow",
          staff_name: "Meena",
          evidence_quote: "",
          notes: "",
        },
      }),
      NOW,
    );
    expect(blood).toMatchObject({ kind: "blood_bank", status: "partial", quantity: "one unit" });
    expect(freshHours("blood_bank", "partial")).toBe(6);

    const pharmacy = sightingFromEntry(entry({ result: inquiry }), NOW)!;
    const summary = summarize([blood!, pharmacy]);
    expect(summary).toMatchObject({ answers: 2, available: 1, partial: 1, withheld: 0 });
    expect(summary.restock).toEqual(["Camp tomorrow"]);
    expect(byItem([blood!, pharmacy]).map((row) => row.item.key).sort()).toEqual(["blood:O-:platelets", "rx:308189"]);
  });
});

describe("Shortage Pulse publishing", () => {
  it("publishes only what the facility itself said", () => {
    const real = entry({ result: inquiry });
    real.facility = { ...real.facility, id: "osm:node/1", source: "openstreetmap" };
    // A simulated answer about a real pharmacy is fiction, and a test-line answer came from a stand-in.
    expect(sightingFromEntry(real, NOW)).toBeNull();
    expect(sightingFromEntry({ ...real, mode: "live", routing: "test_line" }, NOW)).toBeNull();
    expect(sightingFromEntry({ ...real, mode: "live", routing: "direct" }, NOW)).toMatchObject({ status: "available", live: true, facilityId: "osm:node/1" });
  });
});
