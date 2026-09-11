import type { ClaimLineConfig } from "../config.js";
import type { CalleGateway } from "./gateway.js";
import { FixtureCalleGateway } from "./fixture.js";
import { LiveCalleGateway } from "./live.js";
import { NullCalleGateway } from "./null.js";

/** Build the default gateway for the configured run mode + server key. */
export function createGateway(config: ClaimLineConfig): CalleGateway {
  if (config.mode === "live") {
    return config.calleApiKey
      ? new LiveCalleGateway({
          apiKey: config.calleApiKey,
          baseUrl: config.calleBaseUrl,
        })
      : new NullCalleGateway();
  }
  return new FixtureCalleGateway();
}

export type {
  CalleGateway,
  CallHandle,
  CallRequest,
  CallSnapshot,
} from "./gateway.js";
export { FixtureCalleGateway } from "./fixture.js";
export { LiveCalleGateway } from "./live.js";
export { NullCalleGateway } from "./null.js";
