import { describe, it, expect } from "vitest";
import { isAllowedLogoUrl } from "@/lib/logo-url";

/**
 * A brand's name is not decoration. It is the advertiser the voice agent says
 * out loud in the first sentence of every call, and it was being inferred from
 * the Clerk profile of whoever signed up - so a real call opened "calling on
 * behalf of Coac Tal", a first/last split of a person's name.
 */
describe("a logo URL arriving from a client", () => {
  it("accepts what our own uploader returns", () => {
    expect(isAllowedLogoUrl("https://utfs.io/f/abc123")).toBe(true);
    expect(isAllowedLogoUrl("https://abc.ufs.sh/f/xyz")).toBe(true);
    expect(isAllowedLogoUrl("https://uploadthing.com/f/xyz")).toBe(true);
  });

  it("refuses any other host, however plausible", () => {
    expect(isAllowedLogoUrl("https://evil.example/logo.png")).toBe(false);
    expect(isAllowedLogoUrl("https://cdn.jsdelivr.net/logo.png")).toBe(false);
  });

  /* The check is on the HOST, not on the string containing the host - the
     classic way past a suffix test. */
  it("is not fooled by a lookalike domain", () => {
    expect(isAllowedLogoUrl("https://utfs.io.evil.example/f/x")).toBe(false);
    expect(isAllowedLogoUrl("https://notutfs.io/f/x")).toBe(false);
    expect(isAllowedLogoUrl("https://evil.example/?u=https://utfs.io/f/x")).toBe(false);
    expect(isAllowedLogoUrl("https://evil.example/#utfs.io")).toBe(false);
  });

  it("refuses anything that is not https", () => {
    expect(isAllowedLogoUrl("http://utfs.io/f/abc")).toBe(false);
    expect(isAllowedLogoUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedLogoUrl("data:image/svg+xml,<svg onload=alert(1)>")).toBe(false);
  });

  it("refuses what is not a URL at all", () => {
    expect(isAllowedLogoUrl("")).toBe(false);
    expect(isAllowedLogoUrl("utfs.io/f/abc")).toBe(false);
    expect(isAllowedLogoUrl("   ")).toBe(false);
  });
});
