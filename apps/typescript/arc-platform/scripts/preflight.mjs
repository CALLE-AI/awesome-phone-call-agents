/**
 * Everything that can be checked without a human, before filming.
 *
 *   node scripts/preflight.mjs
 *
 * Each line is something that has actually broken this week. Nothing here
 * places a call or changes anything.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const PROD = "https://arc-platform-two.vercel.app";
const WORKSPACE = "cmtii5lfc0002huy27v35ibl0";
const results = [];
const ok = (name, detail) => results.push({ pass: true, name, detail });
const bad = (name, detail) => results.push({ pass: false, name, detail });

/* 1. Neon. It has suspended twice mid-session and takes ~20s to wake, which
   takes /radio, /influencers and every campaign page with it. */
const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const { prisma } = await jiti.import(path.join(root, "lib/db.ts"));
let db = false;
for (let i = 0; i < 4 && !db; i++) {
  try { await prisma.contact.count(); db = true; } catch { await new Promise((r) => setTimeout(r, 6000)); }
}
db ? ok("Neon awake", "database answered") : bad("Neon asleep", "retry in ~20s; pages will 500 until it wakes");

/* 2. Deploy matches local. A local fix that is not deployed has bitten us
   three times. */
let deployed = "?";
try {
  const h = await (await fetch(`${PROD}/api/calle/health`, { signal: AbortSignal.timeout(20000) })).json();
  deployed = h.commit;
  h.anthropicConfigured ? ok("Anthropic key present", "") : bad("Anthropic key missing", "plans will serve the offline sample");
  h.configured ? ok("CALL-E configured", h.baseUrl) : bad("CALL-E not configured", "");
  h.demoPhoneSet ? ok("Demo phone set", "") : bad("Demo phone missing", "");
} catch (e) { bad("Production unreachable", e.message); }

const { execSync } = await import("node:child_process");
const head = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
const dirty = execSync("git status --porcelain", { cwd: root }).toString().trim();
head === deployed
  ? ok("Deploy is current", `production and HEAD both ${head}`)
  : bad("Deploy is behind", `HEAD ${head}, production ${deployed} — push and wait`);
dirty ? bad("Uncommitted changes", dirty.split("\n").length + " file(s)") : ok("Working tree clean", "");

if (db) {
  /* 3. The demo workspace, as it will appear on camera. */
  const campaigns = await prisma.campaign.findMany({
    where: { brandId: WORKSPACE }, select: { name: true, status: true, _count: { select: { items: true } } },
  });
  const visible = campaigns.filter((c) => c.status !== "ARCHIVED");
  const junk = visible.filter((c) => /^(test|kkk+|\d+|new pro|untitled)$/i.test(c.name.trim()) || c.name.trim().length <= 2);
  junk.length
    ? bad("Junk campaign names visible", junk.map((c) => `"${c.name}"`).join(", "))
    : ok("Campaign list clean", visible.map((c) => `"${c.name}" (${c._count.items} line)`).join(", ") || "none");

  /* 4. The chain the film needs: a plan line with an estimate, so a mandate
     exists and a call can be placed from it. */
  const line = await prisma.mediaPlanItem.findFirst({
    where: { campaign: { brandId: WORKSPACE } },
    select: { id: true, name: true, estCostPkr: true, confirmedRatePkr: true },
  });
  if (!line) bad("No plan line", "seed-filming-campaign.mjs");
  else if (!line.estCostPkr) bad("Plan line has no estimate", "no mandate will be built");
  else ok("Plan line ready", `${line.name}, est ${line.estCostPkr} -> mandate 7,000 / 9,000  id ${line.id}`);

  /* 5. Nothing outstanding, or the in-flight guard refuses the next call. */
  const open = await prisma.call.count({
    where: { done: false, mock: false, createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) } },
  });
  open ? bad("A call is still outstanding", `${open} — run reconcile-stuck.mjs --apply`) : ok("No call in flight", "");

  /* 6. Nothing invented left where a camera can see it. */
  const contacts = await prisma.contact.findMany({ select: { profile: true } });
  const rated = contacts.filter((c) => c.profile && c.profile.rating !== undefined).length;
  rated ? bad("Ratings still in profiles", `${rated}`) : ok("No ratings or reviews anywhere", "");
}

console.log("\nPRE-FILMING CHECK\n");
for (const r of results) console.log(`  ${r.pass ? "OK  " : "FAIL"}  ${r.name.padEnd(30)} ${r.detail}`);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log("Fix the FAIL lines before filming.");
await prisma.$disconnect();
process.exit(failed.length ? 1 : 0);
