import { Station } from "./types";

// Fictional demo dataset. Numbers use the NANP-reserved fictional block
// (area-code-555-01XX, 0100-0199), so they are recognizably non-dialable.
// This set is never eligible for a live call: it carries no
// `liveCallAuthorized` flag, so validateLiveStations() refuses it even if a
// client requests it with demo mode disabled.
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
// LIVE STATION SET — the only entries eligible for a real CALL-E call.
//
// These are not private numbers. All are 24/7 published customer support
// lines operated by the charging networks themselves, intended to field
// exactly this question ("is this specific charger working right now?")
// from any driver. That is what makes them an appropriate destination for
// a disclosed AI call — unlike a station's own front desk or an
// individual's number, which should not be called without prior
// agreement.
//
// INVARIANT: `address` must always be a real, specific street address,
// never instructional or placeholder text. buildTask() inserts this field
// verbatim into the sentence spoken on the call ("Call X (ADDRESS) to
// check..."), so placeholder text here is read out literally rather than
// prompting the caller to improvise, producing a nonsensical call and no
// usable result. A "generic support line" entry still needs a real paired
// address.
//
// Verify these numbers and addresses before use; support lines and station
// listings change.
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
    liveCallAuthorized: true,
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
    liveCallAuthorized: true,
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
    liveCallAuthorized: true,
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
    liveCallAuthorized: true,
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
    liveCallAuthorized: true,
  },
];
