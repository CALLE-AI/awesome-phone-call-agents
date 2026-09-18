import { describe, expect, it } from "vitest";

import { healthResponse } from "./controller";

const now = () => new Date("2026-08-04T22:15:00.000Z");

describe("healthResponse", () => {
  it("reports setup required without a credential and exposes no secret field", async () => {
    const response = healthResponse({
      apiKey: null,
      baseUrl: undefined,
      environment: "production",
      now,
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      app: "bellwrench",
      version: "0.1.0",
      status: "configuration_required",
      baseUrlValid: true,
      timestamp: "2026-08-04T22:15:00.000Z",
    });
    expect(JSON.stringify(body)).not.toMatch(/api.?key|secret|bearer/i);
  });

  it("reports ready for a present key and the official production origin", async () => {
    const response = healthResponse({
      apiKey: "configured-but-never-returned",
      baseUrl: "https://api.heycall-e.com",
      environment: "production",
      now,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ready", baseUrlValid: true });
    expect(JSON.stringify(body)).not.toContain("configured-but-never-returned");
  });

  it("reports invalid configuration before a credential-bearing client exists", async () => {
    const response = healthResponse({
      apiKey: "configured-but-never-returned",
      baseUrl: "https://api.heycall-e.com.attacker.test",
      environment: "production",
      now,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "configuration_required",
      baseUrlValid: false,
    });
  });
});
