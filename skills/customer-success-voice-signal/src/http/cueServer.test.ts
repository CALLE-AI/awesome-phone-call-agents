import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCueServer, listenCueServer, assertCueBindAllowed } from "./cueServer.js";
import type { SkillEnv } from "../config/env.js";
import type { RunSignalArgs, RunSignalOutcome } from "../runSignal.js";
import { SKILL_ROOT } from "../config/env.js";

const temps: string[] = [];

afterEach(async () => {
  while (temps.length) {
    const d = temps.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

function baseEnv(dataDir: string): SkillEnv {
  return {
    calleApiKey: "",
    calleBaseUrl: "https://api.heycall-e.com",
    calleRegion: "US",
    calleLocale: "en-US",
    calleWebhookUrl: "",
    calleWait: true,
    csOwnerE164: "",
    csOwnerName: "",
    csOwnerId: "",
    signalConfirm: "",
    houseDarkStart: "",
    houseDarkEnd: "",
    houseDarkTimezone: "",
    dedupeMinutes: 120,
    ownerMaxRings: 2,
    dataDir,
    slackWebhookUrl: "",
    githubToken: "",
    githubRepo: "",
    githubIssue: "",
  };
}

async function loadWebhookCue(): Promise<object> {
  const text = await readFile(
    path.join(SKILL_ROOT, "events/webhook_stuck_support.json"),
    "utf8",
  );
  return JSON.parse(text) as object;
}

describe("cue HTTP listener", () => {
  it("GET /health returns ok", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "sm-cue-"));
    temps.push(dataDir);
    const { server, url } = await listenCueServer({
      env: baseEnv(dataDir),
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; service: string };
      expect(body.ok).toBe(true);
      expect(body.service).toBe("stage-manager-cue");
      expect(url).toContain("http://");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("POST /cue runs dress rehearsal and returns exit ok", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "sm-cue-"));
    temps.push(dataDir);
    const cue = await loadWebhookCue();
    const { server } = await listenCueServer({
      env: baseEnv(dataDir),
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/cue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cue),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        exit: string;
        mode: string;
        trigger_id: string;
        option_id: string | null;
      };
      expect(body.exit).toBe("ok");
      expect(body.mode).toBe("dress_rehearsal");
      expect(body.trigger_id).toBe("stuck_support");
      expect(body.option_id).toBe("1");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("rejects bad JSON with 400", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "sm-cue-"));
    temps.push(dataDir);
    const { server } = await listenCueServer({
      env: baseEnv(dataDir),
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/cue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { exit: string };
      expect(body.exit).toBe("failure");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("requires secret when configured", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "sm-cue-"));
    temps.push(dataDir);
    const cue = await loadWebhookCue();
    const { server } = await listenCueServer({
      env: baseEnv(dataDir),
      host: "127.0.0.1",
      port: 0,
      secret: "stage-secret",
    });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const denied = await fetch(`http://127.0.0.1:${port}/cue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cue),
      });
      expect(denied.status).toBe(401);

      const ok = await fetch(`http://127.0.0.1:${port}/cue`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer stage-secret",
        },
        body: JSON.stringify(cue),
      });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { exit: string };
      expect(body.exit).toBe("ok");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("refuses live query without CUE_ALLOW_LIVE (webhook cannot arm itself)", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "sm-cue-"));
    temps.push(dataDir);
    let seen: RunSignalArgs | null = null;
    const stubRun = async (args: RunSignalArgs): Promise<RunSignalOutcome> => {
      seen = args;
      return {
        exit: "ok",
        mode: "dress_rehearsal",
        event: {
          event_id: "e1",
          trigger_id: "stuck_support",
          severity: "high",
          summary: "x",
          brief: "x",
          occurred_at: "2026-08-03T00:00:00.000Z",
          account: { id: "a", name: "A", tier: "standard", health_flags: [] },
          cs_owner: {
            id: "o",
            name: "O",
            e164: "+15555550100",
            opt_in_phone: true,
          },
          metadata: {},
        },
        intent: null,
        result: null,
        message: "ok",
      };
    };

    const server = createCueServer({
      env: baseEnv(dataDir),
      run: stubRun,
      allowLive: false,
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(
        `http://127.0.0.1:${port}/cue?live=1&confirm=PLACES`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hello: "world" }),
        },
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { exit: string; message: string };
      expect(body.exit).toBe("hold");
      expect(body.message).toMatch(/CUE_ALLOW_LIVE/);
      expect(seen).toBeNull();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("passes live/places only when allowLive is armed", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "sm-cue-"));
    temps.push(dataDir);
    let seen: RunSignalArgs | null = null;
    const stubRun = async (args: RunSignalArgs): Promise<RunSignalOutcome> => {
      seen = args;
      return {
        exit: "hold",
        mode: "dress_rehearsal",
        event: {
          event_id: "e1",
          trigger_id: "stuck_support",
          severity: "high",
          summary: "x",
          brief: "x",
          occurred_at: "2026-08-03T00:00:00.000Z",
          account: { id: "a", name: "A", tier: "standard", health_flags: [] },
          cs_owner: {
            id: "o",
            name: "O",
            e164: "+15555550100",
            opt_in_phone: true,
          },
          metadata: {},
        },
        intent: null,
        result: null,
        message: "HOLD: live_gate",
      };
    };

    const server = createCueServer({
      env: baseEnv(dataDir),
      run: stubRun,
      allowLive: true,
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      await fetch(`http://127.0.0.1:${port}/cue?live=1&confirm=PLACES`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      });
      expect(seen).not.toBeNull();
      expect(seen!.liveFlag).toBe(true);
      expect(seen!.placesTyped).toBe(true);
      expect(seen!.dryRunFlag).toBe(false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("refuses non-loopback bind without a secret", async () => {
    expect(() => assertCueBindAllowed("0.0.0.0", undefined)).toThrow(
      /CUE_WEBHOOK_SECRET/,
    );
    expect(() => assertCueBindAllowed("0.0.0.0", "sekrit")).not.toThrow();
    expect(() => assertCueBindAllowed("127.0.0.1", undefined)).not.toThrow();
  });

  it("404s unknown paths", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "sm-cue-"));
    temps.push(dataDir);
    const { server } = await listenCueServer({
      env: baseEnv(dataDir),
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/nope`, { method: "POST" });
      expect(res.status).toBe(404);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
