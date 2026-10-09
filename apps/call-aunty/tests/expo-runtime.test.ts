import { describe, expect, it } from "vitest";
import { hostnameFromExpoHostUri, resolveApiBaseUrl } from "../lib/api-base-url";

describe("Expo API origin", () => {
  it("prefers an explicit EXPO_PUBLIC_API_BASE_URL", () => {
    expect(
      resolveApiBaseUrl({
        explicitUrl: "https://api.example.com/",
        platformOS: "ios",
        expoHostUri: "192.168.1.20:8081",
      }),
    ).toBe("https://api.example.com");
  });

  it("points native Expo Go at the LAN host on port 3000", () => {
    expect(
      resolveApiBaseUrl({
        platformOS: "ios",
        expoHostUri: "192.168.1.20:8081",
      }),
    ).toBe("http://192.168.1.20:3000");
  });

  it("rewrites Android emulator loopback to 10.0.2.2", () => {
    expect(
      resolveApiBaseUrl({
        platformOS: "android",
        expoHostUri: "127.0.0.1:8081",
      }),
    ).toBe("http://10.0.2.2:3000");
  });

  it("maps local Expo web from Metro 8081 to the API on 3000", () => {
    expect(
      resolveApiBaseUrl({
        platformOS: "web",
        webProtocol: "http:",
        webHostname: "localhost",
      }),
    ).toBe("http://localhost:3000");
  });

  it("keeps the Manus preview 8081- to 3000- hostname rewrite", () => {
    expect(
      resolveApiBaseUrl({
        platformOS: "web",
        webProtocol: "https:",
        webHostname: "8081-abc.region.manus.computer",
      }),
    ).toBe("https://3000-abc.region.manus.computer");
  });

  it("parses Expo hostUri values", () => {
    expect(hostnameFromExpoHostUri("192.168.0.12:8081")).toBe("192.168.0.12");
    expect(hostnameFromExpoHostUri("http://10.0.2.2:8081")).toBe("10.0.2.2");
  });
});
