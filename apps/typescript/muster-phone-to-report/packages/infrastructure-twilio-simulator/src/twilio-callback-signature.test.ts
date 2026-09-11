import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { validateTwilioCallbackSignature } from "./twilio-callback-signature.js";

describe("Twilio callback signature boundary", () => {
  it("validates against the exact public URL and form using the official SDK", () => {
    const requestUrl = "https://synthetic.example/twilio/voice";
    const form = { AccountSid: "ACtest", To: "+12025550110" };
    const twilioAuthToken = "synthetic-test-token";
    const twilioSignature = createHmac("sha1", twilioAuthToken)
      .update(`${requestUrl}AccountSid${form.AccountSid}To${form.To}`)
      .digest("base64");
    const input = { requestUrl, form, twilioAuthToken, twilioSignature };
    expect(validateTwilioCallbackSignature(input)).toBe(true);
    expect(validateTwilioCallbackSignature({ ...input, requestUrl: `${requestUrl}?extra=1` })).toBe(
      false,
    );
    expect(validateTwilioCallbackSignature({ ...input, twilioSignature: "invalid" })).toBe(false);
  });
});
