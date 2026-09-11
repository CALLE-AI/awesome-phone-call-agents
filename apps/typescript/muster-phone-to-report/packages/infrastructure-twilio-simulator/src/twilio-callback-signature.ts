import twilio from "twilio";

/** Validate only; this boundary cannot create calls or change Twilio configuration. */
export function validateTwilioCallbackSignature(input: {
  readonly twilioAuthToken: string;
  readonly twilioSignature: string;
  readonly requestUrl: string;
  readonly form: Readonly<Record<string, string>>;
}): boolean {
  try {
    return (
      input.twilioAuthToken.length > 0 &&
      twilio.validateRequest(input.twilioAuthToken, input.twilioSignature, input.requestUrl, {
        ...input.form,
      })
    );
  } catch {
    return false;
  }
}
