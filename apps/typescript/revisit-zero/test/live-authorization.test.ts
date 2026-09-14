import { describe, expect, it } from "vitest";
import {
  authorizeLiveDispatch,
  LiveDispatchAuthorizationError,
  requireLiveDispatchConfiguration,
} from "../src/live-authorization.js";

const environment = {
  REVISIT_ZERO_LIVE_OPERATOR_ID: "controlled-test-operator",
  REVISIT_ZERO_LIVE_DISPATCH_TOKEN: "offline-test-token-with-at-least-32-chars",
} satisfies NodeJS.ProcessEnv;

describe("live dispatch authorization", () => {
  it("derives the operator identity from server configuration after Bearer authentication", () => {
    const authorization = requireLiveDispatchConfiguration(environment);
    expect(authorizeLiveDispatch(`Bearer ${environment.REVISIT_ZERO_LIVE_DISPATCH_TOKEN}`, authorization))
      .toBe("controlled-test-operator");
  });

  it.each([
    undefined,
    "",
    "Basic offline-test-token-with-at-least-32-chars",
    "Bearer wrong-token-with-at-least-32-characters",
  ])("rejects a missing or invalid credential without trusting client approval claims", (header) => {
    const authorization = requireLiveDispatchConfiguration(environment);
    expect(() => authorizeLiveDispatch(header, authorization)).toThrow(LiveDispatchAuthorizationError);
  });

  it("fails live startup when the server-side operator authorization is incomplete", () => {
    expect(() => requireLiveDispatchConfiguration({
      REVISIT_ZERO_LIVE_OPERATOR_ID: "",
      REVISIT_ZERO_LIVE_DISPATCH_TOKEN: environment.REVISIT_ZERO_LIVE_DISPATCH_TOKEN,
    })).toThrow(/OPERATOR_ID/);
    expect(() => requireLiveDispatchConfiguration({
      REVISIT_ZERO_LIVE_OPERATOR_ID: environment.REVISIT_ZERO_LIVE_OPERATOR_ID,
      REVISIT_ZERO_LIVE_DISPATCH_TOKEN: "too-short",
    })).toThrow(/DISPATCH_TOKEN/);
  });
});
