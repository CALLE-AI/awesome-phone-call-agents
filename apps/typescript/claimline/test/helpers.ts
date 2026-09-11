import { ClaimLineApp } from "../src/app.js";
import { FixtureCalleGateway } from "../src/calle/fixture.js";
import type { ClaimLineConfig } from "../src/config.js";
import { Store } from "../src/store/store.js";

export function makeConfig(
  overrides: Partial<ClaimLineConfig> = {},
): ClaimLineConfig {
  return {
    mode: "fixture",
    calleApiKey: null,
    calleBaseUrl: null,
    port: 0,
    dbPath: ":memory:",
    webhookSecret: null,
    confidenceThreshold: 0.6,
    insurerName: "Test Insurer",
    publicBaseUrl: null,
    ownerUser: "garglakshay",
    ownerPass: "test-owner-pass",
    sessionSecret: "test-secret-0000000000000000000000000000",
    stripeSecretKey: null,
    slackWebhookUrl: null,
    teamsWebhookUrl: null,
    ...overrides,
  };
}

export function makeApp(
  overrides: Partial<ClaimLineConfig> = {},
): ClaimLineApp {
  const config = makeConfig(overrides);
  const store = Store.open(":memory:");
  const gateway = new FixtureCalleGateway();
  return new ClaimLineApp({ config, store, gateway });
}
