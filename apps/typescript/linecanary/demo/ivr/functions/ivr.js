/**
 * "Sample Dental" — the demo IVR that LineCanary monitors.
 *
 * One Twilio Function serves the whole tree. The greeting announces the
 * LineCanary ownership-verification code (dogfooding greeting_code), then a
 * three-option menu. Branch 3 (billing) can be broken on purpose for the
 * regression demo by setting the BREAK_BILLING environment variable in the
 * Twilio Function config — the silent-breakage story in the demo video.
 *
 * Deploy: Twilio Console → Functions & Assets → Services → create service
 * "sample-dental" → add Function /ivr with this code → attach a phone
 * number's "A call comes in" webhook to the function URL.
 */

exports.handler = (context, event, callback) => {
  const response = new Twilio.twiml.VoiceResponse();
  const digit = event.Digits;

  if (digit === undefined) {
    // Entry point: greeting + verification code + menu.
    const gather = response.gather({ numDigits: 1, timeout: 8, action: context.PATH });
    gather.say(
      { voice: "Polly.Joanna" },
      "Thank you for calling Sample Dental. " +
        "This line is monitored. Canary I D: L C 7 3 9 1. " +
        "For appointments, press 1. " +
        "For opening hours, press 2. " +
        "For billing questions, press 3.",
    );
    // No input: repeat the menu once, then end politely.
    response.say({ voice: "Polly.Joanna" }, "We did not receive a selection. Goodbye.");
    response.hangup();
    return callback(null, response);
  }

  if (digit === "1") {
    response.say(
      { voice: "Polly.Joanna" },
      "For appointments, please visit sample dental dot example, or call back during business hours. Goodbye.",
    );
    response.hangup();
    return callback(null, response);
  }

  if (digit === "2") {
    response.say(
      { voice: "Polly.Joanna" },
      "We are open Monday to Friday, 8 AM to 5 PM, and Saturday, 9 AM to noon. Goodbye.",
    );
    response.hangup();
    return callback(null, response);
  }

  if (digit === "3") {
    if (context.BREAK_BILLING === "true") {
      // The silent regression: billing goes to dead air and hangs up.
      response.pause({ length: 6 });
      response.hangup();
      return callback(null, response);
    }
    response.say(
      { voice: "Polly.Joanna" },
      "Our billing team is available Monday to Friday, 9 AM to 4 PM. Please call back then, or email billing at sample dental dot example. Goodbye.",
    );
    response.hangup();
    return callback(null, response);
  }

  response.say({ voice: "Polly.Joanna" }, "That is not a valid option. Goodbye.");
  response.hangup();
  return callback(null, response);
};
