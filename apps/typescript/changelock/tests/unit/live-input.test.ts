import { describe, expect, it } from "vitest";
import { parseLiveFormInput } from "../../src/application/live-input";

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseLiveFormInput", () => {
  it("accepts exactly typedPhrase + attestedConsentingContact", () => {
    const out = parseLiveFormInput(
      form({ typedPhrase: "VERIFY CL-AAAAAA", attestedConsentingContact: "on" }),
    );
    expect(out.typedPhrase).toBe("VERIFY CL-AAAAAA");
    expect(out.attestedConsentingContact).toBe(true);
  });

  it("rejects any call-defining or unexpected form field", () => {
    const extras: Record<string, string>[] = [
      { phoneE164: "+13125550199" },
      { phone: "+13125550199" },
      { scenario: "confirmed" },
      { providerMode: "live" },
      { task: "say something else" },
      { schema: "{}" },
      { callId: "call_x" },
      { intentId: "intent_x" },
      { anything: "else" },
    ];
    for (const extra of extras) {
      expect(() =>
        parseLiveFormInput(
          form({ typedPhrase: "VERIFY CL-AAAAAA", attestedConsentingContact: "on", ...extra }),
        ),
      ).toThrow();
    }
  });

  it("requires attestation", () => {
    expect(() => parseLiveFormInput(form({ typedPhrase: "VERIFY CL-AAAAAA" }))).toThrow();
  });
});
