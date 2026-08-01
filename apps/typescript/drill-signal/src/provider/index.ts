/**
 * Provider factory for simulation, fake-server, and live modes.
 */

import { allowedCalleHosts, ConfigError, validateFakeServerBaseUrl } from "../config.js";
import { createSdkPort } from "../calle.js";
import type { CallePort } from "../calle.js";
import type { DrillMode } from "../types.js";
import { presetScenarios, SimulationProvider } from "./simulation.js";

export interface ProviderOptions {
  mode: DrillMode;
  simulationPreset?: string | null;
  apiKey?: string;
  baseUrl?: string;
  allowedHosts?: Iterable<string>;
  /** When set, fake-server mode uses this loopback URL instead of CALLE_BASE_URL. */
  embeddedFakeBaseUrl?: string;
}

export async function createProvider(options: ProviderOptions): Promise<CallePort> {
  const envAllowed = allowedCalleHosts();
  const mergedAllowed = new Set(envAllowed);
  if (options.allowedHosts) {
    for (const host of options.allowedHosts) {
      mergedAllowed.add(host);
    }
  }

  if (options.mode === "simulation") {
    return new SimulationProvider(presetScenarios(options.simulationPreset ?? "primary-success"));
  }

  if (options.mode === "live") {
    const apiKey = options.apiKey ?? process.env.CALLE_API_KEY;
    if (!apiKey) {
      throw new ConfigError("CALLE_API_KEY is required for live mode.");
    }
    return createSdkPort({
      apiKey,
      baseUrl: options.baseUrl ?? process.env.CALLE_BASE_URL,
      allowedHosts: mergedAllowed,
    });
  }

  const embedded = options.embeddedFakeBaseUrl;
  const configured = options.baseUrl ?? process.env.CALLE_BASE_URL;
  const baseUrl =
    configured && configured !== "http://127.0.0.1:0"
      ? configured
      : embedded;
  if (!baseUrl) {
    validateFakeServerBaseUrl(undefined);
  }
  const apiKey = options.apiKey ?? process.env.CALLE_API_KEY ?? "calle_test_key";
  return createSdkPort({
    apiKey,
    baseUrl: baseUrl!,
    allowedHosts: mergedAllowed,
  });
}

export { SimulationProvider, presetScenarios, SIMULATION_PRESETS } from "./simulation.js";
