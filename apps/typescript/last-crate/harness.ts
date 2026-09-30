import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { time, mask } from "./workflow.ts";
const args = process.argv.slice(2),
  command = args[0] || "demo";
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const live = args.includes("--live"),
  newSession = args.includes("--new-session");
const base = `http://127.0.0.1:${process.env.PORT || 3210}`;
const headers = {
  "Content-Type": "application/json",
  ...(process.env.APP_ACCESS_TOKEN
    ? { Authorization: "Bearer " + process.env.APP_ACCESS_TOKEN }
    : {}),
};
const dataDir = resolve("data/harness");
mkdirSync(dataDir, { recursive: true });
async function api(path: string, method = "GET", data?: any) {
  const response = await fetch(base + "/api/" + path, {
    method,
    headers,
    signal: AbortSignal.timeout(5000),
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || `HTTP ${response.status}`);
  return body;
}
async function ensureServer() {
  try {
    const config = await api("config");
    if (config.app !== "last-crate")
      throw Error(
        "Another or outdated server occupies the configured port. Restart Last Crate.",
      );
    return config;
  } catch (error: any) {
    if (
      !["fetch failed", "The operation was aborted due to timeout"].includes(
        error.message,
      )
    )
      throw error;
  }
  const log = openSync(resolve(dataDir, "server.log"), "a");
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./server.ts", import.meta.url))],
    {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
    },
  );
  child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      return await api("config");
    } catch {}
  }
  throw Error("Server did not start. See data/harness/server.log.");
}
function demoInput() {
  const offset = process.env.DEMO_UTC_OFFSET || "+05:30";
  if (!/^[+-]\d{2}:\d{2}$/.test(offset))
    throw Error("DEMO_UTC_OFFSET must look like +05:30.");
  const delta =
    (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4))) *
    (offset[0] === "-" ? -1 : 1);
  const local = new Date(Date.now() + delta * 60000),
    minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (live && minute > 1320)
    throw Error(
      "The automated same-day demo needs two hours before midnight. Choose a later session or configure the form directly.",
    );
  const phones = (process.env.CALLE_ALLOWED_PHONES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const phone = live
    ? process.env.DEMO_PHONE || (phones.length === 1 ? phones[0] : "")
    : "+12025550101";
  if (live && !phone)
    throw Error(
      "Set DEMO_PHONE, or allowlist exactly one authorized test number.",
    );
  const region =
    process.env.DEMO_REGION ||
    [
      ["+94", "LK"],
      ["+65", "SG"],
      ["+91", "IN"],
      ["+44", "GB"],
      ["+61", "AU"],
      ["+1", "US"],
    ].find(([prefix]) => phone.startsWith(prefix))?.[1];
  if (live && !region)
    throw Error("Set DEMO_REGION to the actual number’s country code.");
  return {
    donor: "Flour & Field",
    address:
      "18 Mill Road, rear collection door (fictional role-play location)",
    quantity: 48,
    date: local.toISOString().slice(0, 10),
    ready: live ? time(minute + 20) : "17:30",
    cutoff: live ? time(minute + 100) : "18:30",
    offset,
    phone,
    region: region || "US",
    locale: process.env.DEMO_LOCALE || "en-US",
    mode: live ? "live" : "fixture",
    scenario: option("--scenario") || "happy",
    partners: [
      {
        name: "Neighbour Table",
        capacity: 60,
        travelMinutes: 12,
        approved: true,
        phone: live ? phone : "+12025550102",
      },
      {
        name: "Westside Community Kitchen",
        capacity: 30,
        travelMinutes: 8,
        approved: true,
        phone: live ? phone : "+12025550103",
      },
    ],
  };
}
async function monitor(id: string) {
  const seen = new Set<string>();
  let resumes = 0;
  const until = Date.now() + 12 * 60000;
  while (Date.now() < until) {
    const run = await api("runs/" + id);
    for (const event of run.events) {
      const key = event.at + event.title;
      if (!seen.has(key)) {
        console.log(`${event.title}: ${event.detail}`);
        seen.add(key);
      }
    }
    if (run.state === "paused" && resumes < 2) {
      resumes++;
      console.log(
        "Reconnecting to the SAME saved operation; no new call authorization.",
      );
      await new Promise((r) => setTimeout(r, 5000));
      await api(`runs/${id}/resume`, "POST", {});
    } else if (
      !["calling_donor", "matching", "calling_partner", "paused"].includes(
        run.state,
      ) ||
      run.state === "paused"
    ) {
      writeFileSync(
        resolve(dataDir, id + ".json"),
        JSON.stringify(run, null, 2),
      );
      console.log(
        `\nOutcome: ${run.state}${run.reason ? " — " + run.reason : ""}`,
      );
      if (run.ticket) {
        const ticket = await api(`runs/${id}/ticket`);
        writeFileSync(
          resolve(dataDir, id + "-ticket.json"),
          JSON.stringify(ticket, null, 2),
        );
        console.log(
          `Pickup ticket: ${ticket.reference}. Collection is not automatically marked complete.`,
        );
      }
      console.log(
        `Private report saved in data/harness/${id}.json\nOpen ${base}/?run=${id} to review the handoff.`,
      );
      if (run.input.mode === "live")
        console.log(
          `Captured provider results are available for offline replay: npm run harness -- replay ${id}`,
        );
      return run;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw Error(
    "Harness observation timed out. Re-run resume with the saved run ID; do not start a replacement live session.",
  );
}
async function main() {
  if (!["demo", "doctor", "replay", "resume", "recordings"].includes(command))
    throw Error("Use demo, doctor, replay <id>, resume <id>, or recordings.");
  if (live && !args.includes("--yes-live"))
    throw Error(
      "Live demo can place two real phone calls. Run demo --live --yes-live only when the allowlisted recipient is ready.",
    );
  const config = await ensureServer();
  if (command === "doctor") {
    console.log(
      JSON.stringify(
        {
          server: base,
          keyConfigured: config.hasKey,
          liveEnabled: config.liveEnabled,
          roleplay: config.roleplay,
          callReservations: `${config.used}/${config.cap}`,
          recordings: config.recordings,
          routeSupport:
            "Local check only. An API key and valid number do not guarantee destination/language support.",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "recordings") {
    console.log(JSON.stringify(config.recordings, null, 2));
    return;
  }
  if (command === "resume") {
    const id = args[1];
    if (!id) throw Error("Supply the saved run ID.");
    await api(`runs/${id}/resume`, "POST", {});
    await monitor(id);
    return;
  }
  if (command === "replay") {
    const id = args[1];
    if (!id) throw Error("Supply a captured recording ID.");
    const run = await api("runs", "POST", {
      input: { mode: "fixture", replayId: id },
      key: "replay-" + randomUUID(),
    });
    console.log(
      "Offline replay: zero calls. Original response values and matching clock are preserved.",
    );
    await monitor(run.id);
    return;
  }
  const sessionFile = resolve(dataDir, "live-session.json");
  let input: any, key: string;
  if (live && existsSync(sessionFile) && !newSession) {
    const session = JSON.parse(readFileSync(sessionFile, "utf8"));
    input = session.input;
    key = session.key;
    console.log(
      "Reusing the saved live session. --new-session explicitly authorizes a different two-call demo.",
    );
  } else {
    input = demoInput();
    key = "harness-" + randomUUID();
    if (live)
      writeFileSync(sessionFile, JSON.stringify({ input, key }, null, 2));
  }
  if (live && !config.roleplay)
    throw Error(
      "The demo harness requires LIVE_ROLEPLAY=true. Use the application for real collection operations.",
    );
  console.log(
    `${live ? "LIVE ROLE-PLAY" : "SYNTHETIC FIXTURE"} · ${input.quantity} loaves · ${input.ready}–${input.cutoff} UTC${input.offset}`,
  );
  if (live) {
    console.log(
      `At most two calls to ${mask(input.phone)} (${input.region}, ${input.locale}).`,
    );
    console.log(
      `BAKERY REPLY: We have 48 plain loaves in our packaging, no fillings, ready at ${input.ready}, collect by ${input.cutoff}. We will set them aside for your approved partner.`,
    );
    console.log(
      `COLLECTOR REPLY: We accept all 48, have our own transport, and can arrive at ${time(Number(input.ready.slice(0, 2)) * 60 + Number(input.ready.slice(3)) + 15)}. Yes, please confirm.`,
    );
  }
  const run = await api("runs", "POST", { input, key });
  if (run.state === "paused") await api(`runs/${run.id}/resume`, "POST", {});
  const outcome = await monitor(run.id);
  if (live && !outcome.ticket) process.exitCode = 2;
}
main().catch((error) => {
  console.error(
    "Last Crate: " +
      String(error.message)
        .replace(/\+[1-9]\d{7,14}/g, mask)
        .replace(/iams_live_[\w-]+/g, "[REDACTED]"),
  );
  process.exitCode = 1;
});
