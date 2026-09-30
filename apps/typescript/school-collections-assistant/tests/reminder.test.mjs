import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.CALLE_LIVE_ENABLED = "false";
process.env.SCHOOL_COLLECTIONS_API_TOKEN = "test-operator-token";
delete process.env.CALLE_API_KEY;
delete process.env.CALLE_AUTHORIZED_DESTINATION;

const { app } = await import("../server.mjs");
const {
  EXAMPLE_E164,
  EXAMPLE_E164_OTHER,
  isE164,
  maskPhone,
  reminderIntentKey,
  isAmbiguousProviderError,
  sanitizeError,
  sanitizeSensitiveData,
  sanitizeEvidence,
} = await import("../safety.mjs");

const auth = { Authorization: "Bearer test-operator-token" };

const validBody = {
  parentName: "John Banda",
  studentName: "Mary Banda",
  phoneNumber: EXAMPLE_E164,
  amount: "K2,500",
  dueDate: "2026-09-30",
  schoolName: "ABC Private School",
  intentId: "fee-mary-banda-2026-09",
};

describe("safety helpers", () => {
  it("accepts strict ASCII E.164 only", () => {
    expect(isE164(EXAMPLE_E164)).toBe(true);
    expect(isE164(EXAMPLE_E164_OTHER)).toBe(true);
    expect(isE164("12025550100")).toBe(false);
    expect(isE164("+01")).toBe(false);
    expect(isE164("+١٢٠٢٥٥٥٠١٠٠")).toBe(false);
  });

  it("masks E.164 numbers", () => {
    expect(maskPhone(EXAMPLE_E164)).toMatch(/^\+120.+0100$/);
    expect(maskPhone(EXAMPLE_E164)).not.toContain("55501");
  });

  it("builds a stable intent key for the same authorized fields", () => {
    const a = reminderIntentKey(validBody);
    const b = reminderIntentKey({ ...validBody });
    const c = reminderIntentKey({ ...validBody, amount: "K3,000" });
    expect(a).toBe(b);
    expect(a).toMatch(/^school-collections:[a-f0-9]{24}$/);
    expect(c).not.toBe(a);
  });

  it("treats timeouts and 5xx as ambiguous", () => {
    expect(isAmbiguousProviderError({ status: null })).toBe(true);
    expect(isAmbiguousProviderError({ status: 408 })).toBe(true);
    expect(isAmbiguousProviderError({ status: 503 })).toBe(true);
    expect(isAmbiguousProviderError({ status: 400 })).toBe(false);
    expect(isAmbiguousProviderError({ status: 401 })).toBe(false);
  });

  it("deeply masks phones inside provider errors, results, and evidence", () => {
    expect(sanitizeError(`failed for ${EXAMPLE_E164}`)).not.toContain(EXAMPLE_E164);
    expect(sanitizeError(`failed for ${EXAMPLE_E164}`)).toContain("[phone masked]");

    const maskedResult = sanitizeSensitiveData({
      payment_awareness: "yes",
      parent_response: `Call me back at ${EXAMPLE_E164} please`,
      nested: { phone: EXAMPLE_E164 },
    });
    expect(JSON.stringify(maskedResult)).not.toContain(EXAMPLE_E164);
    expect(maskedResult.nested.phone).toMatch(/•/);

    const evidence = sanitizeEvidence([
      { quote: `Reached ${EXAMPLE_E164}`, phoneNumber: EXAMPLE_E164 },
    ]);
    expect(JSON.stringify(evidence)).not.toContain(EXAMPLE_E164);
  });
});

describe("POST /api/reminder", () => {
  beforeAll(() => {
    expect(process.env.CALLE_LIVE_ENABLED).toBe("false");
  });

  it("rejects unauthenticated requests", async () => {
    const response = await request(app).post("/api/reminder").send(validBody);
    expect(response.status).toBe(401);
  });

  it("rejects requests with missing required fields", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .set(auth)
      .send({ parentName: "John Banda" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Please provide all required fields.");
  });

  it("rejects non-E.164 phone numbers", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .set(auth)
      .send({ ...validBody, phoneNumber: "5550100" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/E\.164/);
  });

  it("rejects requests without a student name", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .set(auth)
      .send({
        parentName: "John Banda",
        phoneNumber: EXAMPLE_E164,
        amount: "K2,500",
        dueDate: "2026-09-30",
      });

    expect(response.status).toBe(400);
  });

  it("rejects requests without a phone number", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .set(auth)
      .send({
        parentName: "John Banda",
        studentName: "Mary Banda",
        amount: "K2,500",
        dueDate: "2026-09-30",
      });

    expect(response.status).toBe(400);
  });

  it("rejects requests without an amount", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .set(auth)
      .send({
        parentName: "John Banda",
        studentName: "Mary Banda",
        phoneNumber: EXAMPLE_E164,
        dueDate: "2026-09-30",
      });

    expect(response.status).toBe(400);
  });

  it("rejects requests without a due date", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .set(auth)
      .send({
        parentName: "John Banda",
        studentName: "Mary Banda",
        phoneNumber: EXAMPLE_E164,
        amount: "K2,500",
      });

    expect(response.status).toBe(400);
  });

  it("returns a fake no-call result by default without needing CALLE_API_KEY", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .set(auth)
      .send(validBody);

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("fake");
    expect(response.body.realCallPlaced).toBe(false);
    expect(response.body.success).toBe(true);
    expect(response.body.intentKey).toMatch(/^school-collections:/);
    expect(response.body.phoneMasked).toMatch(/•/);
    expect(response.body.phoneMasked).not.toBe(validBody.phoneNumber);
    expect(response.body.structuredResult.payment_awareness).toBe("yes");
  });

  it("refuses live destinations that do not exactly match CALLE_AUTHORIZED_DESTINATION", async () => {
    process.env.CALLE_LIVE_ENABLED = "true";
    process.env.CALLE_API_KEY = "test-calle-key";
    process.env.CALLE_AUTHORIZED_DESTINATION = EXAMPLE_E164_OTHER;

    try {
      const response = await request(app)
        .post("/api/reminder")
        .set(auth)
        .send({ ...validBody, confirmLiveCall: true });

      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/not authorized/);
      expect(response.body.phoneMasked).toMatch(/•/);
      expect(response.body.intentKey).toMatch(/^school-collections:/);
    } finally {
      process.env.CALLE_LIVE_ENABLED = "false";
      delete process.env.CALLE_API_KEY;
      delete process.env.CALLE_AUTHORIZED_DESTINATION;
    }
  });

  it("requires confirmLiveCall before an authorized live run", async () => {
    process.env.CALLE_LIVE_ENABLED = "true";
    process.env.CALLE_API_KEY = "test-calle-key";
    process.env.CALLE_AUTHORIZED_DESTINATION = validBody.phoneNumber;

    try {
      const response = await request(app)
        .post("/api/reminder")
        .set(auth)
        .send({ ...validBody, confirmLiveCall: false });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/confirmLiveCall/);
    } finally {
      process.env.CALLE_LIVE_ENABLED = "false";
      delete process.env.CALLE_API_KEY;
      delete process.env.CALLE_AUTHORIZED_DESTINATION;
    }
  });
});

describe("GET /api/health", () => {
  it("reports fake mode without authentication", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("fake");
    expect(response.body.liveEnabled).toBe(false);
  });
});
