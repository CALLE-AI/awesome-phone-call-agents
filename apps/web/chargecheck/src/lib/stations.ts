import { Station } from "./types";

// Demo dataset for the hackathon MVP. Numbers use the NANP-reserved
// fictional block (area-code-555-01XX, 0100-0199) — the same convention
// awesome-phone-call-agents reviewers check for — so they are recognizably
// non-dialable even though the narrative is a Lahore-Islamabad route. This
// set only ever runs through MockCallProvider (demo mode); it is never
// passed to a real CALL-E call.
export const DEMO_STATIONS: Station[] = [
  {
    id: "stn-a",
    name: "GreenVolt Charging - Lahore Motorway Toll Plaza",
    phone: "+12125550101",
    location: "Lahore, near M2 Toll Plaza",
    address: "M2 Motorway Service Area, Lahore",
    connectors: ["CCS2", "CHAdeMO"],
    advertisedHours: "24/7",
  },
  {
    id: "stn-b",
    name: "EVPoint - Kala Shah Kaku Service Station",
    phone: "+12125550102",
    location: "Kala Shah Kaku, M2",
    address: "M2 Motorway, Kala Shah Kaku Interchange",
    connectors: ["CCS2"],
    advertisedHours: "6:00 AM - 11:00 PM",
  },
  {
    id: "stn-c",
    name: "ChargeHub - Sukheki Rest Area",
    phone: "+12125550103",
    location: "Sukheki, M2",
    address: "M2 Motorway, Sukheki Interchange",
    connectors: ["CCS2", "Type2"],
    advertisedHours: "24/7",
  },
  {
    id: "stn-d",
    name: "PowerLane - Islamabad Toll Plaza",
    phone: "+12125550104",
    location: "Islamabad, M2 Toll Plaza",
    address: "M2 Motorway, Islamabad end",
    connectors: ["CCS2", "CCS1"],
    advertisedHours: "24/7",
    advertisedNotes: "App required for some sessions (advertised, unverified).",
  },
];

export function getStationById(id: string): Station | undefined {
  return DEMO_STATIONS.find((s) => s.id === id) ?? LIVE_US_STATIONS.find((s) => s.id === id);
}

// ---------------------------------------------------------------------
// LIVE US DEMO SET — for the recorded, real-CALL-E segment of the demo.
//
// These are NOT random private numbers. All are 24/7 published customer
// support lines run by the charging networks themselves, meant to be called
// by any driver asking exactly this question ("is this specific charger
// working right now?"). That makes them an appropriate, consent-compatible
// target for a disclosed AI call — unlike a station's own front desk or an
// individual's cell number, which you should not cold-call without their
// prior agreement.
//
// INVARIANT: `address` must always be a real, specific street address —
// never instructional/placeholder text like "ask about a station during
// the call". buildTask() inserts this field verbatim into the actual
// sentence spoken to CALL-E ("Call X (ADDRESS) to check..."), so a
// placeholder here doesn't prompt the caller to improvise — it gets read
// out as the literal address, produces a nonsense call, and CALL-E
// correctly reports no verifiable result. If you add a "just call the
// generic support line" entry, it needs a real paired address, not a note
// to the human reading this file.
//
// Verify these numbers and addresses are still current before recording
// (support lines and specific stations do change) and keep the live
// segment to one or two calls given the free-call allowance on a new
// account.
export const LIVE_US_STATIONS: Station[] = [
  {
    id: "us-ea-la-broadway",
    name: "Electrify America - 850 N Broadway, Los Angeles, CA",
    phone: "+18336322778", // Electrify America 24/7 Customer Assistance
    location: "Los Angeles, CA (Chinatown)",
    address: "850 N Broadway, Los Angeles, CA 90012",
    connectors: ["CCS2", "CHAdeMO"],
    advertisedHours: "24/7",
    advertisedNotes: "Central support line, not an on-site phone — the call task states the exact address.",
  },
  {
    id: "us-ea-bakersfield",
    name: "Electrify America - 4310 California Ave, Bakersfield, CA",
    phone: "+18336322778", // Electrify America 24/7 Customer Assistance
    location: "Bakersfield, CA",
    address: "4310 California Ave, Bakersfield, CA 93309",
    connectors: ["CCS2", "CHAdeMO"],
    advertisedHours: "24/7",
    advertisedNotes: "Central support line, not an on-site phone — the call task states the exact address.",
  },
  {
    id: "us-evgo-la-3rd",
    name: "EVgo - 3461 W 3rd St, Los Angeles, CA",
    phone: "+18774943833", // EVgo Charging Crew 24/7 support
    location: "Los Angeles, CA (Koreatown)",
    address: "3461 W 3rd St, Los Angeles, CA 90004",
    connectors: ["CCS2", "CHAdeMO"],
    advertisedHours: "24/7",
    advertisedNotes: "Central support line, not an on-site phone — the call task states the exact address.",
  },
  {
    id: "us-chargepoint-la-beverly",
    name: "ChargePoint - 7660 Beverly Blvd, Los Angeles, CA",
    phone: "+18887584389", // ChargePoint 24/7 Driver Support
    location: "Los Angeles, CA (Beverly Blvd)",
    address: "7660 Beverly Blvd, Los Angeles, CA 90036",
    connectors: ["Type2"],
    advertisedHours: "24/7",
    advertisedNotes: "Central support line, not an on-site phone — the call task states the exact address.",
  },
  {
    id: "us-blink-la-flower",
    name: "Blink Charging - 833 S Flower St, Los Angeles, CA",
    phone: "+18889982546", // Blink Charging 24/7 Customer Support
    location: "Los Angeles, CA (South Flower St)",
    address: "833 S Flower St, Los Angeles, CA 90017",
    connectors: ["CCS1", "Type2"],
    advertisedHours: "24/7",
    advertisedNotes: "Central support line, not an on-site phone — the call task states the exact address.",
  },
];
