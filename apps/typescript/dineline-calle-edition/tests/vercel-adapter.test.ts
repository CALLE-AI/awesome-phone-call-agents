import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import vercelHandler from "../api/index.js";

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
});

describe("public Vercel adapter", () => {
  it("hard-forces fixture mode and keeps both real-call gates closed", async () => {
    const server = createServer((request, response) => {
      void vercelHandler(request, response);
    });
    openServers.push(server);

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/index?route=config`,
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      mode: "fixture",
      realCallReady: false,
      bookingCallReady: false,
      intakeCallReady: false,
    });
  });

  it("forwards a streamed JSON body to the fixture-only intake route", async () => {
    const server = createServer((request, response) => {
      void vercelHandler(request, response);
    });
    openServers.push(server);

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/index?route=intake/preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: "+12025550109",
          sessionId: "session-vercel-post",
          explicitConsent: true,
        }),
      },
    );
    const body = (await response.json()) as {
      mode: string;
      preview: { phone: string; requestId: string };
    };

    expect(response.status).toBe(200);
    expect(body.mode).toBe("fixture");
    expect(body.preview.phone).toBe("+1******0109");
    expect(body.preview.requestId).toMatch(/^[a-f0-9]{64}$/);
  });
});

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
