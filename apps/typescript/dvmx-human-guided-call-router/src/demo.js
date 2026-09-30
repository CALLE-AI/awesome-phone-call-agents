import { classifyCallRequest, classifyFollowup, maskPhone } from "./policy.js";

const phone = "+15555550100"; // fictional reserved-style sample
const request = {
  phone,
  consent: true,
  domain: "general",
  purpose: "Confirm whether the recipient wants a product demo."
};

const callPolicy = classifyCallRequest(request);

const fixtureResult = {
  intent: "interested",
  requested_action: "schedule",
  summary: "Recipient asked to schedule a demo."
};

console.log(JSON.stringify({
  mode: "NO_CALL_FIXTURE",
  recipient: maskPhone(phone),
  sideEffect: "No network request and no phone call are made by this demo.",
  callPolicy,
  structuredFixture: fixtureResult,
  followupPolicy: classifyFollowup(fixtureResult)
}, null, 2));
