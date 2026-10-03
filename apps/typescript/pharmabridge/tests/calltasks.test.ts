import { describe, expect, it } from "vitest";
import {
  BLOOD_INQUIRY_RESULT_SCHEMA,
  BLOOD_RESERVE_RESULT_SCHEMA,
  bloodInquiryBrief,
  bloodReserveBrief,
  buildHoldTask,
  buildInquiryTask,
  buildPrescriberTask,
  HOLD_RESULT_SCHEMA,
  holdBrief,
  INQUIRY_RESULT_SCHEMA,
  inquiryBrief,
  PRESCRIBER_RESULT_SCHEMA,
  prescriberBrief,
  renderTask,
  TRANSFER_RESULT_SCHEMA,
  transferBrief,
} from "@/lib/calltasks";
import type { BloodRequest, Facility, Medication } from "@/lib/types";

// Features the CALL-E docs list as unsupported in result schemas.
const UNSUPPORTED = ["$ref", "oneOf", "anyOf", "allOf", "format", "pattern", "nullable"];
const RESERVED = ["summary", "status", "transcript", "call_id"];

function assertSupported(schema: Record<string, unknown>, path = "$"): void {
  for (const key of UNSUPPORTED) expect(schema, `${path} uses ${key}`).not.toHaveProperty(key);
  expect(Array.isArray(schema.type), `${path} uses a union type`).toBe(false);
  if (schema.type === "object") {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(schema.additionalProperties, `${path} must be closed`).toBe(false);
    expect([...(schema.required as string[])].sort()).toEqual(Object.keys(properties).sort());
    for (const [name, child] of Object.entries(properties)) {
      expect(RESERVED).not.toContain(name);
      assertSupported(child, `${path}.${name}`);
    }
  }
}

const medication: Medication = {
  rxcui: "308189",
  name: "Amoxicillin 400 mg/5 mL Oral Suspension",
  ingredient: "amoxicillin",
  brandNames: [],
  quantity: "one 100 mL bottle",
  alternatives: ["Amoxicillin 250 mg/5 mL Oral Suspension"],
  controlled: false,
  deaSchedule: null,
  urgency: "today",
};

const pharmacy: Facility = {
  id: "synthetic:pharmacy:0",
  kind: "pharmacy",
  name: "Riverside Community Pharmacy",
  brand: null,
  address: "100 Example Ave (fictional)",
  lat: 0,
  lon: 0,
  distanceKm: 0.6,
  bearingDeg: 0,
  phone: "+12125550110",
  phoneMasked: "+1 ••• ••• ••10",
  openingHours: null,
  source: "synthetic",
  mapsUrl: null,
  rating: null,
  openNow: null,
  signature: null,
};

const bank: Facility = { ...pharmacy, id: "synthetic:blood_bank:0", kind: "blood_bank", name: "City Central Blood Centre", phone: "+12125550150" };
const blood: BloodRequest = { group: "O-", component: "platelets", units: 2, hospital: "General Hospital", urgency: "today" };
const contact = { firstName: "Maya", lastInitial: "R", holdUntil: "8 PM" };
const prescriber = {
  practice: "Park Slope Pediatrics",
  prescriberName: "Dr. Alvarez",
  phone: "",
  patientFullName: "Maya Rivera",
  patientDob: "2021-04-12",
  consent: true,
};

describe("result schemas", () => {
  it.each([
    ["inquiry", INQUIRY_RESULT_SCHEMA],
    ["hold", HOLD_RESULT_SCHEMA],
    ["prescriber", PRESCRIBER_RESULT_SCHEMA],
    ["transfer", TRANSFER_RESULT_SCHEMA],
    ["blood inquiry", BLOOD_INQUIRY_RESULT_SCHEMA],
    ["blood reservation", BLOOD_RESERVE_RESULT_SCHEMA],
  ])("%s schema uses only CALL-E-supported features", (_name, schema) => {
    assertSupported(schema);
  });

  it("offers explicit unknown/refusal outcomes instead of forcing a yes or no", () => {
    for (const schema of [INQUIRY_RESULT_SCHEMA, BLOOD_INQUIRY_RESULT_SCHEMA]) {
      const stock = schema.properties.stock_status as { enum: string[] };
      expect(stock.enum).toEqual(expect.arrayContaining(["unknown", "refused_to_disclose"]));
    }
  });
});

describe("pharmacy briefs", () => {
  it("inquiry brief discloses the AI, bounds medical content, and skips voicemail", () => {
    const task = buildInquiryTask(medication, pharmacy);
    expect(task).toContain("automated AI assistant");
    expect(task).toMatch(/voicemail.*without leaving a message/i);
    expect(task).toMatch(/Do not give or ask for medical advice/);
    expect(task).toContain("Amoxicillin 250 mg/5 mL Oral Suspension");
    expect(task).not.toContain(pharmacy.phone!);
  });

  it("controlled-substance brief tells the agent to accept a refusal", () => {
    const task = buildInquiryTask({ ...medication, controlled: true, deaSchedule: "CII" }, pharmacy);
    expect(task).toContain("controlled medication (DEA schedule CII)");
    expect(task).toContain("do not push");
  });

  it("hold brief shares only a first name and last initial", () => {
    const task = buildHoldTask(medication, pharmacy, null, contact);
    expect(task).toContain('"Maya R."');
    expect(task).toMatch(/Never share a date of birth/);
  });

  it("prescriber brief uses the consented date of birth only for identity checks", () => {
    const task = buildPrescriberTask(medication, pharmacy, null, prescriber);
    expect(task.match(/2021-04-12/g)).toHaveLength(1);
    expect(task).toMatch(/consented.*only when staff ask to verify identity/);
    expect(task).toContain("(212) 555-0110");
  });
});

describe("transfer briefs", () => {
  const transfer = { fromPharmacy: "Corner Drug on 5th", phone: "", patientFullName: "Maya Rivera", patientDob: "2021-04-12", consent: true };

  it("asks the current pharmacy to move the prescription, sharing the consented date of birth only to find it", () => {
    const task = renderTask(transferBrief(medication, pharmacy, null, transfer));
    expect(task).toContain("Corner Drug on 5th");
    expect(task).toContain("Riverside Community Pharmacy");
    expect(task).toContain("(212) 555-0110");
    expect(task.match(/2021-04-12/g)).toHaveLength(1);
    expect(task).toMatch(/Share them only when staff ask to locate the prescription/);
    expect(task).toMatch(/Do not request any change to the medication, strength, or quantity/);
  });

  it("cites the one-time electronic transfer rule for controlled medications and accepts a no", () => {
    const task = renderTask(transferBrief({ ...medication, controlled: true, deaSchedule: "CII" }, pharmacy, null, transfer));
    expect(task).toContain("transferred once between pharmacies");
    expect(task).toContain("do not push");
  });
});

describe("blood bank briefs", () => {
  it("availability brief asks only about the requested group and never names the patient", () => {
    const task = renderTask(bloodInquiryBrief(blood, bank));
    expect(task).toContain("O negative (O-)");
    expect(task).toContain("platelets");
    expect(task).toMatch(/never suggest a different blood group or component/);
    expect(task).toMatch(/Do not share the patient's name/);
    expect(task).not.toContain("Maya");
  });

  it("reservation brief shares only a first name, initial, and hospital", () => {
    const task = renderTask(bloodReserveBrief(blood, bank, null, contact));
    expect(task).toContain('"Maya R."');
    expect(task).toContain("General Hospital");
    expect(task).toMatch(/Never share a date of birth, address, or diagnosis/);
  });
});

describe("every brief", () => {
  const briefs = [
    inquiryBrief(medication, pharmacy),
    holdBrief(medication, pharmacy, null, contact),
    prescriberBrief(medication, pharmacy, null, prescriber),
    transferBrief(medication, pharmacy, null, { fromPharmacy: "Corner Drug on 5th", phone: "", patientFullName: "Maya Rivera", patientDob: "2021-04-12", consent: true }),
    bloodInquiryBrief(blood, bank),
    bloodReserveBrief(blood, bank, null, contact),
  ];

  it.each(briefs.map((b) => [b.kind, b]))("%s opens with an AI disclosure and carries the core guardrails", (_kind, brief) => {
    expect(brief.opening).toMatch(/AI assistant/);
    expect(brief.guardrails.map((g) => g.id)).toEqual(expect.arrayContaining(["ai", "privacy", "medical", "voicemail", "payment", "time"]));
  });

  it("renders the exact structured brief into the task text", () => {
    for (const brief of briefs) {
      const task = renderTask(brief);
      expect(task).toContain(brief.opening);
      for (const guardrail of brief.guardrails) expect(task).toContain(guardrail.text);
    }
  });
});
