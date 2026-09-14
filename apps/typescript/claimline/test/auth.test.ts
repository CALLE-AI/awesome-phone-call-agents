import { afterEach, describe, expect, it } from "vitest";
import type { ClaimLineApp } from "../src/app.js";
import { buildServer } from "../src/server/app.js";
import {
  SessionStore,
  type Session,
  checkOwner,
  effectiveKey,
  placedBy,
} from "../src/server/auth.js";
import { makeApp } from "./helpers.js";

let app: ClaimLineApp;

afterEach(() => {
  try {
    app?.close();
  } catch {
    // already closed
  }
  app = undefined as unknown as ClaimLineApp;
});

const owner = (): Session => ({ role: "owner", apiKey: null });
const guest = (apiKey: string | null): Session => ({ role: "guest", apiKey });

/** Pull the session cookie value out of a login response's set-cookie header. */
function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find((x) => x.name === "claimline_sid");
  if (!c) throw new Error("no session cookie set");
  return `claimline_sid=${c.value}`;
}

describe("auth helpers", () => {
  it("checkOwner accepts the configured owner and rejects others", () => {
    app = makeApp({ ownerUser: "garglakshay", ownerPass: "test-owner-pass" });
    expect(checkOwner(app, "garglakshay", "test-owner-pass")).toBe(true);
    expect(checkOwner(app, "garglakshay", "wrong")).toBe(false);
    expect(checkOwner(app, "someone", "test-owner-pass")).toBe(false);
  });

  it("checkOwner is disabled when no owner password is configured", () => {
    app = makeApp({ ownerUser: "garglakshay", ownerPass: null });
    expect(checkOwner(app, "garglakshay", "")).toBe(false);
    expect(checkOwner(app, "garglakshay", "anything")).toBe(false);
  });

  it("effectiveKey resolves owner→server key and guest→own key", () => {
    app = makeApp({ mode: "live", calleApiKey: "srv-key" });
    expect(effectiveKey(app, owner())).toBe("srv-key");
    expect(effectiveKey(app, guest("guest-key"))).toBe("guest-key");
    expect(effectiveKey(app, guest(null))).toBe(null);
    expect(effectiveKey(app, null)).toBe(null);
  });

  it("placedBy tags calls by actor (fixture mode collapses to fixture)", () => {
    app = makeApp({ mode: "live", calleApiKey: "srv-key" });
    expect(placedBy(app, owner())).toBe("owner");
    expect(placedBy(app, guest("k"))).toBe("guest");
    expect(placedBy(app, null)).toBe("guest");
    app.close();

    app = makeApp({ mode: "fixture" });
    expect(placedBy(app, owner())).toBe("fixture");
    expect(placedBy(app, guest("k"))).toBe("fixture");
  });

  it("SessionStore creates, reads, and destroys guest key entries", () => {
    const store = new SessionStore();
    const id = store.createGuest("abc");
    expect(store.getGuest(id)?.apiKey).toBe("abc");
    store.destroyGuest(id);
    expect(store.getGuest(id)).toBe(null);
    expect(store.getGuest(undefined)).toBe(null);
  });
});

describe("auth routes", () => {
  it("serves the login page", async () => {
    app = makeApp();
    const server = buildServer(app);
    const res = await server.inject({ method: "GET", url: "/login" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Owner login");
    expect(res.body).toContain("Continue as guest");
    await server.close();
  });

  it("logs in the owner with valid credentials and sets a session cookie", async () => {
    app = makeApp({ ownerUser: "garglakshay", ownerPass: "test-owner-pass" });
    const server = buildServer(app);
    const res = await server.inject({
      method: "POST",
      url: "/login",
      payload: { username: "garglakshay", password: "test-owner-pass" },
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/");
    const cookie = sessionCookie(res);

    // The owner's name shows in the nav on a subsequent request.
    const home = await server.inject({ method: "GET", url: "/", headers: { cookie } });
    expect(home.body).toContain("garglakshay");
    expect(home.body).toContain("Log out");
    await server.close();
  });

  it("rejects invalid owner credentials", async () => {
    app = makeApp({ ownerUser: "garglakshay", ownerPass: "test-owner-pass" });
    const server = buildServer(app);
    const res = await server.inject({
      method: "POST",
      url: "/login",
      payload: { username: "garglakshay", password: "nope" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain("Invalid username or password");
    await server.close();
  });

  it("keeps the owner logged in across a server restart (stateless cookie)", async () => {
    // A fresh app + server reuses the same session secret (via makeConfig), so an
    // owner cookie minted before a restart still authenticates afterwards.
    const cfg = { ownerUser: "garglakshay", ownerPass: "test-owner-pass" as string | null };
    app = makeApp(cfg);
    const serverA = buildServer(app);
    const login = await serverA.inject({
      method: "POST",
      url: "/login",
      payload: { username: "garglakshay", password: "test-owner-pass" },
    });
    const cookie = sessionCookie(login);
    await serverA.close();
    app.close();

    // Simulate a restart: brand-new app + server (new in-memory state).
    app = makeApp(cfg);
    const serverB = buildServer(app);
    const home = await serverB.inject({ method: "GET", url: "/", headers: { cookie } });
    expect(home.body).toContain("garglakshay");
    expect(home.body).toContain("Log out");
    await serverB.close();
  });

  it("continues as guest and stores the guest key in-session only", async () => {
    app = makeApp({ mode: "live", calleApiKey: "srv-key" });
    const server = buildServer(app);
    const res = await server.inject({
      method: "POST",
      url: "/login",
      payload: { guest: "1", apiKey: "guest-abc" },
    });
    expect(res.statusCode).toBe(303);
    const cookie = sessionCookie(res);
    // Guest key must never be echoed back into any page HTML.
    const home = await server.inject({ method: "GET", url: "/", headers: { cookie } });
    expect(home.body).not.toContain("guest-abc");
    expect(home.body).toContain("Guest (key set)");
    await server.close();
  });

  it("logs out and clears the session", async () => {
    app = makeApp({ ownerUser: "garglakshay", ownerPass: "test-owner-pass" });
    const server = buildServer(app);
    const login = await server.inject({
      method: "POST",
      url: "/login",
      payload: { username: "garglakshay", password: "test-owner-pass" },
    });
    const cookie = sessionCookie(login);
    const out = await server.inject({ method: "POST", url: "/logout", headers: { cookie } });
    expect(out.statusCode).toBe(303);
    expect(out.headers.location).toBe("/login");
    await server.close();
  });

  it("keeps browsing public (guest nav) without logging in", async () => {
    app = makeApp();
    const server = buildServer(app);
    const res = await server.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Log in");
    await server.close();
  });

  it("redirects a call attempt without a key to login in live mode", async () => {
    app = makeApp({ mode: "live", calleApiKey: null });
    app.seedDemo();
    const server = buildServer(app);
    const claim = app.listCaseViews()[0]!;
    const res = await server.inject({
      method: "POST",
      url: `/ui/claims/${claim.claim.id}/call`,
      payload: { callType: "fnol_intake", confirm: "yes" },
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/login");
    await server.close();
  });
});
