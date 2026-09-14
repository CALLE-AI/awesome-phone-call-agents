import { describe, expect, it } from "vitest";
import {
  languageFor,
  languageFromLocale,
  LANGUAGES,
  regionLocaleForPhone,
} from "../src/domain/language.js";
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
      contact({
        role: "treating_doctor",
        phone: "+525512345678",
        region: "MX",
        locale: "es-MX",
      }),
      { insurerName: "Test Ins" },
    );
    expect(plan.recipient.locale).toBe("es-MX");
    expect(plan.task).toContain("Conduct this entire call in Spanish");
  });

  it("derives region/locale from the recipient's phone country code", () => {
    // A +91 doctor on a US (en) claim must be called as India, not the US —
    // otherwise CALL-E rejects the number as not a valid US phone number.
    const plan = planForContact(
      claim({ language: "en", region: "US", locale: "en-US" }),
      contact({ role: "treating_doctor", name: "Dr. Rao", phone: "+919914087195" }),
      { insurerName: "Test Ins" },
    );
    expect(plan.recipient.region).toBe("IN");
    expect(plan.recipient.locale).toBe("en-IN");
  });

  it("regionLocaleForPhone maps country codes to region + locale", () => {
    expect(regionLocaleForPhone("+12025550164")).toMatchObject({ region: "US", locale: "en-US" });
    expect(regionLocaleForPhone("+919914087195")).toMatchObject({ region: "IN", locale: "en-IN" });
    expect(regionLocaleForPhone("+919914087195", "hi-IN")).toMatchObject({ region: "IN", locale: "hi-IN" });
    expect(regionLocaleForPhone("+525512345678")).toMatchObject({ region: "MX", locale: "es-MX" });
    expect(regionLocaleForPhone("+441632960000")).toMatchObject({ region: "GB", locale: "en-GB" });
    expect(regionLocaleForPhone("+9990000000")).toBeNull(); // unknown country code
    expect(regionLocaleForPhone("not-a-number")).toBeNull();
  });
});
