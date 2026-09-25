import { describe, expect, it } from "vitest";

import { hostnameFromExpoHostUri, resolveApiBaseUrl } from "../lib/api-base-url";

describe("resolveApiBaseUrl", () => {
  it("prefers an explicit origin and strips a trailing slash", () => {
    expect(
      resolveApiBaseUrl({
        explicitUrl: "https://api.example.test/",
        platformOS: "web",
        webHostname: "localhost",
      }),
    ).toBe("https://api.example.test");
  });

  it("maps Manus-style 8081 web hosts onto the API port", () => {
    expect(
      resolveApiBaseUrl({
        platformOS: "web",
        webProtocol: "https:",
        webHostname: "8081-sandbox.example.test",
      }),
    ).toBe("https://3000-sandbox.example.test");
  });

  it("uses localhost:3000 during local Expo web development", () => {
    expect(
      resolveApiBaseUrl({
        platformOS: "web",
        webProtocol: "http:",
        webHostname: "localhost",
      }),
    ).toBe("http://localhost:3000");
  });

  it("uses the Expo debugger host on iOS and the Android emulator loopback", () => {
    expect(
      resolveApiBaseUrl({
        platformOS: "ios",
        expoHostUri: "192.168.1.20:8081",
      }),
    ).toBe("http://192.168.1.20:3000");
    expect(
      resolveApiBaseUrl({
        platformOS: "android",
        expoHostUri: "localhost:8081",
      }),
    ).toBe("http://10.0.2.2:3000");
  });

  it("parses Expo host URIs with or without a protocol", () => {
    expect(hostnameFromExpoHostUri("192.168.1.20:8081")).toBe("192.168.1.20");
    expect(hostnameFromExpoHostUri("http://127.0.0.1:8081")).toBe("127.0.0.1");
    expect(hostnameFromExpoHostUri("")).toBeNull();
  });
});
