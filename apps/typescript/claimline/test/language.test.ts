import { describe, expect, it } from "vitest";
import { languageFor, languageFromLocale, LANGUAGES } from "../src/domain/language.js";
import { planForContact } from "../src/services/tasks.js";
import type { Claim, ClaimContact } from "../src/domain/types.js";

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: "c1",
    reference: "CLM-1",
    customerId: null,
    policyId: null,
    policyholderName: "Test",
    claimantPhone: "+919812345670",
    incidentType: "auto_collision",
    region: "IN",
    locale: "hi-IN",
    language: "hi",
    providerName: null,
    providerPhone: null,
    notes: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function contact(overrides: Partial<ClaimContact> = {}): ClaimContact {
  return {
    id: "ct1",
    claimId: "c1",
    role: "claimant",
    name: "Test",
    phone: "+919812345670",
    region: null,
    locale: null,
    note: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("language support", () => {
  it("maps codes to CALL-E region + locale", () => {
    expect(languageFor("hi")).toMatchObject({ region: "IN", locale: "hi-IN" });
    expect(languageFor("es")).toMatchObject({ region: "MX", locale: "es-MX" });
    expect(languageFor("en")).toMatchObject({ region: "US", locale: "en-US" });
    expect(languageFor("zz")).toBe(LANGUAGES.en);
  });

  it("derives a language from a locale", () => {
    expect(languageFromLocale("hi-IN").code).toBe("hi");
    expect(languageFromLocale("es-MX").code).toBe("es");
    expect(languageFromLocale("en-US").code).toBe("en");
  });

  it("injects a Hindi instruction into a Hindi claim's call script", () => {
    const plan = planForContact(claim(), contact(), { insurerName: "Test Ins" });
    expect(plan.recipient.locale).toBe("hi-IN");
    expect(plan.task).toContain("Conduct this entire call in Hindi");
  });

  it("does not add an instruction for English calls", () => {
    const plan = planForContact(
      claim({ language: "en", region: "US", locale: "en-US" }),
      contact(),
      { insurerName: "Test Ins" },
    );
    expect(plan.task).not.toContain("Conduct this entire call in");
  });

  it("honors a per-contact language override", () => {
    const plan = planForContact(
      claim({ language: "en", region: "US", locale: "en-US" }),
      contact({ role: "treating_doctor", region: "MX", locale: "es-MX" }),
      { insurerName: "Test Ins" },
    );
    expect(plan.recipient.locale).toBe("es-MX");
    expect(plan.task).toContain("Conduct this entire call in Spanish");
  });
});
