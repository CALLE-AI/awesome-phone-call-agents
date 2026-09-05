import { describe, expect, it } from "vitest";
import { getConfig, isLiveReady, publicRuntimeConfig } from "../server/config.mjs";
import { OFFICIAL_CALLE_ORIGIN } from "../server/calle-origin.mjs";

const env = (overrides = {}) => ({
  CALLE_API_KEY: "server-only-test-key",
  CALLE_LIVE_ENABLED: "true",
  CALLE_TEST_PHONE: "+14155552671",
  CALLE_TEST_REGION: "US",
  CALLE_TEST_LOCALE: "en-US",
  ...overrides,
});

describe("server-side CALL-E runtime configuration", () => {
  it("only reports live readiness when the explicit flag, key, and test phone exist", () => {
    const config = getConfig(env());
    expect(isLiveReady(config)).toBe(true);
    expect(publicRuntimeConfig(config)).toMatchObject({
      provider: "live",
      liveEnabled: true,
      liveRequested: true,
      liveReady: true,
      apiKeyConfigured: true,
      testPhoneConfigured: true,
      testRegionConfigured: true,
      testLocaleConfigured: true,
      baseUrlTrusted: true,
      region: "US",
      language: "en-US",
    });
  });

  it("falls back to fake mode when live mode is requested without a key or test phone", () => {
    const config = getConfig(env({ CALLE_API_KEY: "", CALLE_TEST_PHONE: "" }));
    expect(isLiveReady(config)).toBe(false);
    expect(publicRuntimeConfig(config)).toMatchObject({
      provider: "fake",
      liveEnabled: false,
      liveRequested: true,
      liveReady: false,
      apiKeyConfigured: false,
      testPhoneConfigured: false,
    });
  });

  it("keeps live mode disabled until the manager explicitly enables it", () => {
    const config = getConfig(env({ CALLE_LIVE_ENABLED: "false" }));
    expect(isLiveReady(config)).toBe(false);
    expect(publicRuntimeConfig(config)).toMatchObject({ provider: "fake", liveRequested: false, apiKeyConfigured: true, testPhoneConfigured: true });
  });

  it("requires an explicit destination region and locale for live mode", () => {
    const config = getConfig(env({ CALLE_TEST_REGION: "", CALLE_TEST_LOCALE: "" }));
    expect(isLiveReady(config)).toBe(false);
    expect(publicRuntimeConfig(config)).toMatchObject({ provider: "fake", testRegionConfigured: false, testLocaleConfigured: false });
  });

  it("fails closed when CALLE_BASE_URL is not the official HTTPS origin", () => {
    const config = getConfig(env({ CALLE_BASE_URL: "https://attacker.example" }));
    expect(isLiveReady(config)).toBe(false);
    expect(publicRuntimeConfig(config)).toMatchObject({ provider: "fake", liveReady: false, baseUrlTrusted: false, baseUrl: OFFICIAL_CALLE_ORIGIN });
  });

  it("requires an app bearer token whenever live mode is requested", () => {
    const config = getConfig(env());
    expect(config.apiAuthRequired).toBe(true);
    expect(config.apiAuthToken).toBe("");
  });
});
