#!/usr/bin/env -S deno run --allow-env --allow-net
/**
 * T8.1: Seed data and disclosure.
 *
 * Seeds the demo history that no run of real calls produced. The seed carries
 * one item ("the dentist") with three call runs on three separate local dates,
 * each with an item_mentions row linking the item to the run. Optionally seeds
 * two more items with fewer mentions so Today does not look staged.
 *
 * Usage:
 *   deno run --allow-env --allow-net scripts/seed.ts --email <address>
 *   deno run --allow-env --allow-net scripts/seed.ts --email <address> --apply
 *   deno run --allow-env --allow-net scripts/seed.ts --email <address> --remove
 *   deno run --allow-env --allow-net scripts/seed.ts --email <address> --demo-date 2026-09-14
 *
 * Flags:
 *   --email <address>       The account to seed. Must have a profiles row.
 *   --demo-date <YYYY-MM-DD> The date the 34 days count to. Defaults to today
 *                            in the profile's timezone.
 *   --apply                 Write rows. Without this flag, only the plan prints.
 *   --remove                Delete every seeded row for the account.
 *   --i-confirmed-dry-run   Required for --apply against a non-local URL.
 *
 * Reaches Supabase only through ORMA_API_URL with SUPABASE_SERVICE_ROLE_KEY,
 * because the admin API rejects the new-format secret key.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { renderCallTask, type Briefing } from "../supabase/functions/_shared/briefing.ts";
import { buildCallRequest } from "../supabase/functions/_shared/calle.ts";
import { maskedRequestBody } from "../supabase/functions/_shared/dispatch-mode.ts";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    Deno.exit(1);
  }
  return value;
}

const ORMA_API_URL = requireEnv("ORMA_API_URL").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

function parseArgs(args: string[]) {
  let email: string | undefined;
  let demoDate: string | undefined;
  let apply = false;
  let remove = false;
  let confirmedDryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--email":
        email = args[++i];
        break;
      case "--demo-date":
        demoDate = args[++i];
        break;
      case "--apply":
        apply = true;
        break;
      case "--remove":
        remove = true;
        break;
      case "--i-confirmed-dry-run":
        confirmedDryRun = true;
        break;
      default:
        console.error(`Unknown flag: ${args[i]}`);
        Deno.exit(1);
    }
  }

  if (!email) {
    console.error("--email is required.");
    Deno.exit(1);
  }

  if (apply && remove) {
    console.error("Cannot pass both --apply and --remove.");
    Deno.exit(1);
  }

  return { email, demoDate, apply, remove, confirmedDryRun };
}

const flags = parseArgs(Deno.args);

// ---------------------------------------------------------------------------
// Safety: refuse --apply against non-local without --i-confirmed-dry-run
// ---------------------------------------------------------------------------

function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "0.0.0.0" ||
      parsed.hostname === "[::1]";
  } catch {
    return false;
  }
}

if (flags.apply && !isLocalUrl(ORMA_API_URL) && !flags.confirmedDryRun) {
  console.error(
    "Refusing --apply against a non-local URL without --i-confirmed-dry-run.",
  );
  console.error(`ORMA_API_URL is ${ORMA_API_URL}`);
  Deno.exit(1);
}

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const supabase = createClient(ORMA_API_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

// ---------------------------------------------------------------------------
// Lookup the profile by email (paginates auth.admin.listUsers)
// ---------------------------------------------------------------------------

async function lookupProfile(email: string) {
  let page = 1;
  const perPage = 50;
  let user: { id: string; email?: string } | undefined;

  while (true) {
    const { data: userData, error: userError } = await supabase.auth.admin
      .listUsers({ page, perPage });
    if (userError) {
      console.error("Failed to list users:", userError.message);
      Deno.exit(1);
    }
    user = userData.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (user) break;
    if (userData.users.length < perPage) break;
    page++;
  }

  if (!user) {
    console.error(`No auth.users row found for email: ${email}`);
    Deno.exit(1);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    console.error(
      `No profiles row found for user ${user.id}:`,
      profileError?.message,
    );
    Deno.exit(1);
  }

  return profile as {
    id: string;
    display_name: string;
    timezone: string;
    phone_e164: string | null;
  };
}

// ---------------------------------------------------------------------------
// Stable UUIDs from a seed namespace
// ---------------------------------------------------------------------------

function seedUuid(userId: string, label: string): string {
  const input = `orma:seed:${userId}:${label}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x6c62272e >>> 0;
  let h3 = 0x01000193 >>> 0;
  let h4 = 0xdeadbeef >>> 0;
  for (const b of data) {
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ b, 0x01000193) >>> 0;
    h3 = Math.imul(h3 ^ b, 0x0100019d) >>> 0;
    h4 = Math.imul(h4 ^ b, 0x010001a3) >>> 0;
  }

  const raw = [h1, h2, h3, h4]
    .map((n) => (n >>> 0).toString(16).padStart(8, "0"))
    .join("");

  const chars = raw.split("");
  chars[12] = "4";
  const variantNibble = (parseInt(chars[16], 16) & 0x3) | 0x8;
  chars[16] = variantNibble.toString(16);

  const hex = chars.join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ---------------------------------------------------------------------------
// Date helpers (host timezone independent)
// ---------------------------------------------------------------------------

function todayInTimezone(tz: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

function subtractDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day - days, 12, 0, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Converts a wall calendar date and time in a target IANA timezone to an ISO UTC string.
 * Uses only Intl.DateTimeFormat on UTC instants so host machine zone has zero effect.
 */
function dateTimeInTz(
  dateStr: string,
  hour: number,
  minute: number,
  tz: string,
): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  const getOffsetMs = (date: Date, timeZone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);
    let y = 0, m = 0, d = 0, h = 0, min = 0, s = 0;
    for (const p of parts) {
      if (p.type === "year") y = Number(p.value);
      else if (p.type === "month") m = Number(p.value);
      else if (p.type === "day") d = Number(p.value);
      else if (p.type === "hour") h = Number(p.value) % 24;
      else if (p.type === "minute") min = Number(p.value);
      else if (p.type === "second") s = Number(p.value);
    }
    const asUtc = Date.UTC(y, m - 1, d, h, min, s);
    return asUtc - date.getTime();
  };

  const offset1 = getOffsetMs(new Date(targetUtc), tz);
  const instant1 = new Date(targetUtc - offset1);
  const offset2 = getOffsetMs(instant1, tz);
  return new Date(targetUtc - offset2).toISOString();
}

// ---------------------------------------------------------------------------
// Seed data definitions
// ---------------------------------------------------------------------------

interface SeedMention {
  runIndex: number;
  offsetSeconds: number;
}

interface SeedItem {
  id: string;
  text: string;
  sinceDateDaysAgo: number;
  source: string;
  capturingRunIndex?: number;
  mentions: SeedMention[];
}

interface SeedRun {
  id: string;
  idempotencyKey: string;
  localDate: string;
  daysAgo: number;
  partOfDay: string;
  scheduledHour: number;
  mood: string;
  briefing: Briefing;
  transcript: Array<{ speaker: string; offset_seconds: number; text: string }>;
  structuredResult: {
    captured_items: Array<{ text: string; evidence_offset_seconds: number }>;
    retired_items: Array<{ item_id: string; evidence_offset_seconds: number }>;
    commitments: Array<{ item_id: string; due?: string; evidence_offset_seconds: number }>;
    mood: string;
    slot_change_requested: string;
  };
}

interface SeedPlan {
  profile: {
    id: string;
    display_name: string;
    timezone: string;
    phone_e164: string | null;
  };
  demoDate: string;
  items: SeedItem[];
  runs: SeedRun[];
}

function buildPlan(
  profile: {
    id: string;
    display_name: string;
    timezone: string;
    phone_e164: string | null;
  },
  demoDate: string,
): SeedPlan {
  const userId = profile.id;

  const dentistId = seedUuid(userId, "item:the-dentist");
  const passportId = seedUuid(userId, "item:renew-passport");
  const groceriesId = seedUuid(userId, "item:weekend-groceries");

  const run1Id = seedUuid(userId, "run:1");
  const run2Id = seedUuid(userId, "run:2");
  const run3Id = seedUuid(userId, "run:3");

  // All 3 runs fall in the 7-day window ending yesterday [demoDate - 7, demoDate - 1].
  // compute_pattern_facts observes 3 distinct days and reports sufficient_history: true.
  const run1Date = subtractDays(demoDate, 6);
  const run2Date = subtractDays(demoDate, 4);
  const run3Date = subtractDays(demoDate, 3);

  return {
    profile,
    demoDate,
    items: [
      {
        id: dentistId,
        text: "the dentist",
        sinceDateDaysAgo: 34,
        source: "call",
        mentions: [
          { runIndex: 0, offsetSeconds: 0 },
          { runIndex: 1, offsetSeconds: 0 },
          { runIndex: 2, offsetSeconds: 0 },
        ],
      },
      {
        id: passportId,
        text: "renew the passport",
        sinceDateDaysAgo: 21,
        source: "telegram",
        mentions: [
          { runIndex: 1, offsetSeconds: 10 },
        ],
      },
      {
        id: groceriesId,
        text: "weekend groceries",
        sinceDateDaysAgo: 3,
        source: "call",
        capturingRunIndex: 2,
        mentions: [
          { runIndex: 2, offsetSeconds: 14 },
        ],
      },
    ],
    runs: [
      {
        id: run1Id,
        idempotencyKey: `orma:seed:${userId}:${run1Date}:morning:v1`,
        localDate: run1Date,
        daysAgo: 6,
        partOfDay: "morning",
        scheduledHour: 8,
        mood: "ok",
        briefing: {
          user_name: profile.display_name,
          open_count: 2,
          lead_line: "Everything open is still current.",
          open_items: `- the dentist (id: ${dentistId})\n- renew the passport (id: ${passportId})`,
          last_call_summary: "",
          slot_local_time: "08:00",
        },
        transcript: [
          { speaker: "bot", offset_seconds: 0, text: `Good morning, ${profile.display_name}. You\u2019ve had the dentist on your list for a while now.` },
          { speaker: "user", offset_seconds: 8, text: "Yeah, I know. I will sort it out this week." },
          { speaker: "bot", offset_seconds: 12, text: "Anything new today?" },
          { speaker: "user", offset_seconds: 16, text: "No, nothing new." },
          { speaker: "bot", offset_seconds: 18, text: "Talk tomorrow at 8. Bye." },
        ],
        structuredResult: {
          captured_items: [],
          retired_items: [],
          commitments: [
            { item_id: dentistId, evidence_offset_seconds: 0 },
          ],
          mood: "ok",
          slot_change_requested: "no",
        },
      },
      {
        id: run2Id,
        idempotencyKey: `orma:seed:${userId}:${run2Date}:morning:v1`,
        localDate: run2Date,
        daysAgo: 4,
        partOfDay: "morning",
        scheduledHour: 8,
        mood: "ok",
        briefing: {
          user_name: profile.display_name,
          open_count: 2,
          lead_line: "It's been 30 days.",
          open_items: `- the dentist (id: ${dentistId})\n- renew the passport (id: ${passportId})`,
          last_call_summary: "You promised 1 thing.",
          slot_local_time: "08:00",
        },
        transcript: [
          { speaker: "bot", offset_seconds: 0, text: `Hi ${profile.display_name}. The dentist has been on your list for 30 days.` },
          { speaker: "user", offset_seconds: 6, text: "I will call them tomorrow." },
          { speaker: "bot", offset_seconds: 10, text: "You also have renew the passport open." },
          { speaker: "user", offset_seconds: 14, text: "That can wait a bit." },
          { speaker: "bot", offset_seconds: 18, text: "Noted. See you tomorrow." },
        ],
        structuredResult: {
          captured_items: [],
          retired_items: [],
          commitments: [
            { item_id: dentistId, evidence_offset_seconds: 0 },
            { item_id: passportId, evidence_offset_seconds: 10 },
          ],
          mood: "ok",
          slot_change_requested: "no",
        },
      },
      {
        id: run3Id,
        idempotencyKey: `orma:seed:${userId}:${run3Date}:morning:v1`,
        localDate: run3Date,
        daysAgo: 3,
        partOfDay: "morning",
        scheduledHour: 8,
        mood: "unknown",
        briefing: {
          user_name: profile.display_name,
          open_count: 2,
          lead_line: "It's been 31 days.",
          open_items: `- the dentist (id: ${dentistId})\n- renew the passport (id: ${passportId})`,
          last_call_summary: "You promised 2 things.",
          slot_local_time: "08:00",
        },
        transcript: [
          { speaker: "bot", offset_seconds: 0, text: `The dentist, it\u2019s been 31 days.` },
          { speaker: "user", offset_seconds: 7, text: "Fine, I will book it." },
          { speaker: "bot", offset_seconds: 10, text: "Need to pick up anything this weekend?" },
          { speaker: "user", offset_seconds: 14, text: "Yes, weekend groceries." },
          { speaker: "bot", offset_seconds: 17, text: "Got it. Talk tomorrow." },
        ],
        structuredResult: {
          captured_items: [
            { text: "weekend groceries", evidence_offset_seconds: 14 },
          ],
          retired_items: [],
          commitments: [
            { item_id: dentistId, evidence_offset_seconds: 0 },
          ],
          mood: "unknown",
          slot_change_requested: "no",
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Masking for plan display
// ---------------------------------------------------------------------------

function maskUuid(uuid: string): string {
  return uuid.slice(0, 8) + "-****-****-****-" + uuid.slice(-4);
}

// ---------------------------------------------------------------------------
// Print the plan
// ---------------------------------------------------------------------------

function printPlan(plan: SeedPlan): void {
  console.log("\n=== Seed Plan ===");
  console.log(`Account:   ${plan.profile.display_name} (${maskUuid(plan.profile.id)})`);
  console.log(`Timezone:  ${plan.profile.timezone}`);
  console.log(`Demo date: ${plan.demoDate}`);
  console.log();

  console.log("Items to seed:");
  for (const item of plan.items) {
    const sinceDate = subtractDays(plan.demoDate, item.sinceDateDaysAgo);
    console.log(
      `  - "${item.text}" (${item.source}, since ${sinceDate}, ${item.mentions.length} mention(s), seeded=true)`,
    );
  }
  console.log();

  console.log("Runs to seed:");
  for (const run of plan.runs) {
    console.log(
      `  - ${run.localDate} ${run.partOfDay} (key: ${run.idempotencyKey.replace(plan.profile.id, maskUuid(plan.profile.id))})`,
    );
    console.log(
      `    state=completed, disposition=answered_extracted, dry_run=true, billable=false`,
    );
    console.log(`    mood=${run.mood}, turns=${run.transcript.length}`);
    console.log(`    briefing lead: "${run.briefing.lead_line}"`);
  }
  console.log();

  console.log("Item mentions to seed:");
  for (const item of plan.items) {
    for (const mention of item.mentions) {
      const run = plan.runs[mention.runIndex];
      console.log(
        `  - "${item.text}" in run ${run.localDate} at offset ${mention.offsetSeconds}s`,
      );
    }
  }
  console.log();

  console.log("Call events per run: dispatched (with masked CALL-E body), ingested, finalised (3 each)");
  console.log("Briefing stored on call_runs.briefing: 1 each");
  console.log("Transcripts per run: 1 each");
  console.log("Results per run: 1 each (valid=true)");
  console.log();

  const totalMentions = plan.items.reduce((sum, it) => sum + it.mentions.length, 0);
  const totalRows = plan.items.length +
    plan.runs.length +
    totalMentions +
    plan.runs.length * 3 +
    plan.runs.length +
    plan.runs.length;
  console.log(`Total rows to write: ${totalRows}`);
  console.log();

  if (!flags.apply && !flags.remove) {
    console.log("Dry run. Pass --apply to write rows, or --remove to delete.");
  }
}

// ---------------------------------------------------------------------------
// Apply: write rows
// ---------------------------------------------------------------------------

async function applyPlan(plan: SeedPlan): Promise<void> {
  const userId = plan.profile.id;
  const tz = plan.profile.timezone;

  console.log("\n=== Applying seed ===");

  // Check if profile has an active slot to associate with runs
  const { data: slot } = await supabase
    .from("slots")
    .select("id")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  // 1. Insert/update items, preserving status/retired_at/retired_reason if already present
  console.log("Inserting items...");
  const { data: existingItems } = await supabase
    .from("items")
    .select("id, status, retired_at, retired_reason")
    .in("id", plan.items.map((i) => i.id));
  const existingMap = new Map((existingItems ?? []).map((i) => [i.id, i]));

  for (const item of plan.items) {
    const sinceDate = subtractDays(plan.demoDate, item.sinceDateDaysAgo);
    let createdAt: string;
    if (item.capturingRunIndex !== undefined) {
      const run = plan.runs[item.capturingRunIndex];
      createdAt = dateTimeInTz(run.localDate, run.scheduledHour, 2, tz);
    } else {
      createdAt = dateTimeInTz(sinceDate, 8, 0, tz);
    }
    const existing = existingMap.get(item.id);

    const { error } = await supabase
      .from("items")
      .upsert(
        {
          id: item.id,
          user_id: userId,
          text: item.text,
          status: existing?.status ?? "open",
          since_date: sinceDate,
          source: item.source,
          seeded: true,
          created_at: createdAt,
          retired_at: existing?.retired_at ?? null,
          retired_reason: existing?.retired_reason ?? null,
        },
        { onConflict: "id" },
      );
    if (error) {
      console.error(`Failed to insert item "${item.text}":`, error.message);
      Deno.exit(1);
    }
    console.log(`  ✓ "${item.text}" (since ${sinceDate}, created_at=${createdAt}, status=${existing?.status ?? "open"})`);
  }

  // 2. Insert call_runs with briefing populated
  console.log("Inserting call runs...");
  for (const run of plan.runs) {
    const scheduledFor = dateTimeInTz(
      run.localDate,
      run.scheduledHour,
      0,
      tz,
    );
    const completedAt = dateTimeInTz(
      run.localDate,
      run.scheduledHour,
      2,
      tz,
    );

    const { error } = await supabase
      .from("call_runs")
      .upsert(
        {
          id: run.id,
          user_id: userId,
          slot_id: slot?.id ?? null,
          local_date: run.localDate,
          part_of_day: run.partOfDay,
          scheduled_for: scheduledFor,
          state: "completed",
          disposition: "answered_extracted",
          mood: run.mood,
          idempotency_key: run.idempotencyKey,
          calle_call_id: `fixture:seed:${run.id.slice(0, 8)}`,
          calle_confidence: { score: 0.9, label: "high" },
          calle_failure: null,
          briefing: run.briefing,
          dry_run: true,
          billable: false,
          claimed_at: scheduledFor,
          dispatched_at: scheduledFor,
          completed_at: completedAt,
          terminal_writer: "dry_run",
        },
        { onConflict: "id" },
      );
    if (error) {
      console.error(`Failed to insert run ${run.localDate}:`, error.message);
      Deno.exit(1);
    }
    console.log(`  ✓ ${run.localDate} ${run.partOfDay} (key: ...${run.idempotencyKey.slice(-12)})`);
  }

  // 3. Insert transcripts
  console.log("Inserting transcripts...");
  for (const run of plan.runs) {
    const completedAt = dateTimeInTz(
      run.localDate,
      run.scheduledHour,
      2,
      tz,
    );

    const { error } = await supabase
      .from("transcripts")
      .upsert(
        {
          call_run_id: run.id,
          turns: run.transcript,
          raw: { source: "seed" },
          fetched_at: completedAt,
        },
        { onConflict: "call_run_id" },
      );
    if (error) {
      console.error(
        `Failed to insert transcript for ${run.localDate}:`,
        error.message,
      );
      Deno.exit(1);
    }
    console.log(`  ✓ transcript for ${run.localDate}`);
  }

  // 4. Insert results
  console.log("Inserting results...");
  for (const run of plan.runs) {
    const completedAt = dateTimeInTz(
      run.localDate,
      run.scheduledHour,
      2,
      tz,
    );

    const { error } = await supabase
      .from("results")
      .upsert(
        {
          call_run_id: run.id,
          structured: run.structuredResult,
          valid: true,
          error: null,
          fetched_at: completedAt,
        },
        { onConflict: "call_run_id" },
      );
    if (error) {
      console.error(
        `Failed to insert result for ${run.localDate}:`,
        error.message,
      );
      Deno.exit(1);
    }
    console.log(`  ✓ result for ${run.localDate}`);
  }

  // 5. Insert commitments matching structured results
  console.log("Inserting commitments...");
  const seedRunIds = plan.runs.map((r) => r.id);
  await supabase
    .from("commitments")
    .delete()
    .in("call_run_id", seedRunIds);

  for (const run of plan.runs) {
    const completedAt = dateTimeInTz(
      run.localDate,
      run.scheduledHour,
      2,
      tz,
    );
    for (const com of run.structuredResult.commitments) {
      const { error } = await supabase
        .from("commitments")
        .insert({
          item_id: com.item_id,
          user_id: userId,
          call_run_id: run.id,
          due: null,
          evidence_offset_seconds: com.evidence_offset_seconds,
          created_at: completedAt,
        });
      if (error) {
        console.error(`Failed to insert commitment for run ${run.localDate}:`, error.message);
        Deno.exit(1);
      }
    }
  }

  // 6. Insert call_events with masked request body matching dry-run dispatcher
  console.log("Inserting call events...");
  for (const run of plan.runs) {
    const scheduledFor = dateTimeInTz(
      run.localDate,
      run.scheduledHour,
      0,
      tz,
    );
    const completedAt = dateTimeInTz(
      run.localDate,
      run.scheduledHour,
      2,
      tz,
    );

    const structured = run.structuredResult;
    const itemCount = structured.captured_items.length;
    const retirementCount = structured.retired_items.length;
    const commitmentCount = structured.commitments.length;
    const mentionCount = itemCount + retirementCount + commitmentCount;

    const webhookUrl = `${ORMA_API_URL}/functions/v1/calle-webhook/dummy-seed-secret`;
    const callTask = renderCallTask(run.briefing);
    const callReq = buildCallRequest(
      run.id,
      plan.profile.phone_e164 || "+15555550100",
      callTask,
      webhookUrl,
    );
    const maskedReq = maskedRequestBody(JSON.stringify(callReq));

    const events = [
      {
        call_run_id: run.id,
        at: scheduledFor,
        kind: "dispatched",
        detail: {
          dispatch_mode: "dry_run",
          fixture: "completed",
          outbound_request_made: false,
          request_body: maskedReq,
          request_body_masked: true,
        },
      },
      {
        call_run_id: run.id,
        at: completedAt,
        kind: "ingested",
        detail: {
          call_run_id: run.id,
          calle_call_id: `fixture:seed:${run.id.slice(0, 8)}`,
          state: "completed",
          disposition: "answered_extracted",
          item_count: itemCount,
          mention_count: mentionCount,
          retirement_count: retirementCount,
          commitment_count: commitmentCount,
          skipped: [],
        },
      },
      {
        call_run_id: run.id,
        at: completedAt,
        kind: "finalised",
        detail: {
          dispatch_mode: "dry_run",
          fixture: "completed",
          outbound_request_made: false,
          state: "completed",
          disposition: "answered_extracted",
          item_count: itemCount,
          mention_count: mentionCount,
          failure_reason: "",
        },
      },
    ];

    await supabase
      .from("call_events")
      .delete()
      .eq("call_run_id", run.id);

    const { error } = await supabase
      .from("call_events")
      .insert(events);
    if (error) {
      console.error(
        `Failed to insert events for ${run.localDate}:`,
        error.message,
      );
      Deno.exit(1);
    }
    console.log(
      `  ✓ 3 events for ${run.localDate} (dispatched, ingested, finalised)`,
    );
  }

  // 7. Insert item_mentions: ONLY delete mentions for seeded runs!
  console.log("Inserting item mentions...");
  await supabase
    .from("item_mentions")
    .delete()
    .in("call_run_id", seedRunIds);

  for (const item of plan.items) {
    for (const mention of item.mentions) {
      const run = plan.runs[mention.runIndex];
      const completedAt = dateTimeInTz(
        run.localDate,
        run.scheduledHour,
        2,
        tz,
      );

      const { error } = await supabase
        .from("item_mentions")
        .insert({
          item_id: item.id,
          call_run_id: run.id,
          offset_seconds: mention.offsetSeconds,
          created_at: completedAt,
        });
      if (error) {
        console.error(
          `Failed to insert mention for "${item.text}" in ${run.localDate}:`,
          error.message,
        );
        Deno.exit(1);
      }
      console.log(
        `  ✓ "${item.text}" mentioned in ${run.localDate} at ${mention.offsetSeconds}s`,
      );
    }
  }

  console.log("\n=== Seed applied successfully ===");
  await verifyCounts(plan);
}

// ---------------------------------------------------------------------------
// Verify: count rows and check briefing
// ---------------------------------------------------------------------------

async function verifyCounts(plan: SeedPlan): Promise<void> {
  console.log("\n=== Verification ===");

  // Count seeded items.
  const { count: itemCount } = await supabase
    .from("items")
    .select("*", { count: "exact", head: true })
    .eq("user_id", plan.profile.id)
    .eq("seeded", true);
  console.log(`Seeded items: ${itemCount}`);

  // Count seeded runs.
  const { data: seedRuns } = await supabase
    .from("call_runs")
    .select("id, briefing, scheduled_for")
    .eq("user_id", plan.profile.id)
    .like("idempotency_key", "orma:seed:%");
  console.log(`Seeded runs: ${seedRuns?.length ?? 0}`);

  const hasBriefing = seedRuns?.every((r) => r.briefing !== null) ?? false;
  if (hasBriefing) {
    console.log("✓ All seeded runs carry briefing on call_runs.briefing");
  } else {
    console.log("✗ Some seeded runs missing briefing");
  }

  // Count mentions for the dentist item.
  const dentistId = plan.items[0].id;
  const { count: mentionCount } = await supabase
    .from("item_mentions")
    .select("*", { count: "exact", head: true })
    .eq("item_id", dentistId);
  console.log(`Dentist mentions: ${mentionCount}`);

  // Check dispatched event request_body
  const runIds = plan.runs.map((r) => r.id);
  const { data: dispatchedEvents } = await supabase
    .from("call_events")
    .select("call_run_id, detail")
    .in("call_run_id", runIds)
    .eq("kind", "dispatched");
  const hasValidRequestBody = dispatchedEvents?.every((e) => {
    const detail = e.detail as Record<string, unknown> | null;
    const bodyStr = typeof detail?.request_body === "string" ? detail.request_body : "";
    return bodyStr.includes("Hello. This is Orma.") && bodyStr.includes("<redacted>");
  }) ?? false;
  if (hasValidRequestBody) {
    console.log("✓ Dispatched events carry full reviewed CALL-E request_body with masked webhook");
  } else {
    console.log("✗ Dispatched events missing valid reviewed request_body");
  }

  // Check captured item created_at <= call_runs.completed_at
  const groceriesId = plan.items[2].id;
  const run3Id = plan.runs[2].id;
  const { data: itemGroceries } = await supabase
    .from("items")
    .select("created_at")
    .eq("id", groceriesId)
    .single();
  const { data: run3Data } = await supabase
    .from("call_runs")
    .select("completed_at")
    .eq("id", run3Id)
    .single();
  if (itemGroceries && run3Data) {
    const itemCreated = new Date(itemGroceries.created_at).getTime();
    const runCompleted = new Date(run3Data.completed_at).getTime();
    if (itemCreated <= runCompleted) {
      console.log("✓ Weekend groceries created_at <= run 3 completed_at");
    } else {
      console.log(`✗ Weekend groceries created_at (${itemGroceries.created_at}) > run 3 completed_at (${run3Data.completed_at})`);
    }
  }

  // Check briefing via RPC evaluated at demo date.
  const nowAtDemo = dateTimeInTz(plan.demoDate, 8, 0, plan.profile.timezone);
  const { data: briefing, error: briefingError } = await supabase
    .rpc("assemble_briefing", {
      p_user_id: plan.profile.id,
      p_slot_local_time: "08:00",
      p_now: nowAtDemo,
    });
  if (briefingError) {
    console.error("Failed to call assemble_briefing:", briefingError.message);
  } else {
    console.log("\nBriefing output:");
    console.log(JSON.stringify(briefing, null, 2));
    const leadLine = (briefing as { lead_line?: string })?.lead_line ?? "";
    if (leadLine.includes("mentioned the dentist 3 times")) {
      console.log("✓ Lead line includes '3 times'");
    } else {
      console.log(`✗ Lead line does not include mention count: "${leadLine}"`);
    }
    if (leadLine.includes("34 days")) {
      console.log("✓ Lead line includes '34 days'");
    } else {
      console.log(`✗ Lead line does not include age: "${leadLine}"`);
    }
  }

  // Check pattern facts via RPC
  const periodEnd = subtractDays(plan.demoDate, 1);
  const periodStart = subtractDays(periodEnd, 6);
  const { data: facts, error: factsError } = await supabase
    .rpc("compute_pattern_facts", {
      p_user_id: plan.profile.id,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    });
  if (factsError) {
    console.error("Failed to call compute_pattern_facts:", factsError.message);
  } else {
    const f = facts as Record<string, unknown>;
    console.log(`\nPattern facts (${periodStart} to ${periodEnd}):`);
    console.log(`  observed_days: ${f?.observed_days}`);
    console.log(`  sufficient_history: ${f?.sufficient_history}`);
    if (f?.sufficient_history === true) {
      console.log("✓ Patterns sufficient_history is true (at least 3 observed days)");
    } else {
      console.log(`✗ Patterns sufficient_history is false (${f?.observed_days} days)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Remove: delete all seeded rows for the account
// ---------------------------------------------------------------------------

async function removeSeed(
  profile: { id: string; display_name: string; timezone: string; phone_e164: string | null },
  demoDate: string,
): Promise<void> {
  console.log(`\n=== Removing seeded rows for ${profile.display_name} ===`);

  const plan = buildPlan(profile, demoDate);

  const runIds = plan.runs.map((r) => r.id);
  const itemIds = plan.items.map((i) => i.id);

  console.log(`Targeting ${runIds.length} run(s) and ${itemIds.length} item(s).`);

  if (runIds.length > 0) {
    const { error: evErr } = await supabase
      .from("call_events")
      .delete()
      .in("call_run_id", runIds);
    if (evErr) console.error("call_events delete error:", evErr.message);
    else console.log("  ✓ Deleted call_events for seeded runs.");

    const { error: comRunErr } = await supabase
      .from("commitments")
      .delete()
      .in("call_run_id", runIds);
    if (comRunErr) console.error("commitments delete error:", comRunErr.message);
    else console.log("  ✓ Deleted commitments for seeded runs.");

    const { error: trErr } = await supabase
      .from("transcripts")
      .delete()
      .in("call_run_id", runIds);
    if (trErr) console.error("transcripts delete error:", trErr.message);
    else console.log("  ✓ Deleted transcripts for seeded runs.");

    const { error: resErr } = await supabase
      .from("results")
      .delete()
      .in("call_run_id", runIds);
    if (resErr) console.error("results delete error:", resErr.message);
    else console.log("  ✓ Deleted results for seeded runs.");
  }

  if (itemIds.length > 0) {
    const { error: mentErr } = await supabase
      .from("item_mentions")
      .delete()
      .in("item_id", itemIds);
    if (mentErr) console.error("item_mentions delete error:", mentErr.message);
    else console.log("  ✓ Deleted item_mentions for seeded items.");

    const { error: comErr } = await supabase
      .from("commitments")
      .delete()
      .in("item_id", itemIds);
    if (comErr) console.error("commitments delete error:", comErr.message);
    else console.log("  ✓ Deleted commitments for seeded items.");

    const { error: itemErr } = await supabase
      .from("items")
      .delete()
      .in("id", itemIds);
    if (itemErr) console.error("items delete error:", itemErr.message);
    else console.log("  ✓ Deleted seeded items.");
  }

  if (runIds.length > 0) {
    const { error: runErr } = await supabase
      .from("call_runs")
      .delete()
      .in("id", runIds);
    if (runErr) console.error("call_runs delete error:", runErr.message);
    else console.log("  ✓ Deleted seeded call_runs.");
  }

  const { data: remainingItems } = await supabase
    .from("items")
    .select("id")
    .in("id", itemIds);

  const { data: remainingRuns } = await supabase
    .from("call_runs")
    .select("id")
    .in("id", runIds);

  console.log(`\nRemaining seeded items: ${remainingItems?.length ?? 0}`);
  console.log(`Remaining seeded runs: ${remainingRuns?.length ?? 0}`);

  if ((remainingItems?.length ?? 0) === 0 && (remainingRuns?.length ?? 0) === 0) {
    console.log("✓ All seeded rows removed.");
  } else {
    console.error("✗ Some seeded rows remain.");
    Deno.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Disclosure paragraph (active voice)
// ---------------------------------------------------------------------------

function printDisclosure(plan: SeedPlan): void {
  const runDates = plan.runs.map((r) => r.localDate);
  console.log("\n=== Disclosure paragraph ===");
  console.log(`
This repository shows seeded demo history. No real phone call produced these
rows. The seed creates "the dentist" with \`seeded = true\`, \`source = 'call'\`,
and a \`since_date\` of ${subtractDays(plan.demoDate, 34)} (34 days before the demo date of ${plan.demoDate}).
The seed also writes three earlier call runs dated ${runDates[0]}, ${runDates[1]},
and ${runDates[2]} in the \`completed\` state with \`dry_run = true\` and \`billable = false\`.
Each run carries a stable idempotency key under the \`orma:seed:\` prefix, a
synthetic transcript, a valid structured result, and the three \`call_events\` a
dry-run dispatcher writes (dispatched, ingested, and finalised). One
\`item_mentions\` row per run links "the dentist" to that run's transcript offset.
The seed adds two more items ("renew the passport" and "weekend groceries") with
fewer mentions so the Today screen looks natural. A single query on \`seeded = true\`
or the \`orma:seed:\` prefix matches every seeded row.
`.trim());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`ORMA_API_URL: ${ORMA_API_URL}`);
  console.log(`Local: ${isLocalUrl(ORMA_API_URL)}`);

  const profile = await lookupProfile(flags.email!);
  console.log(
    `Profile: ${profile.display_name} (${maskUuid(profile.id)}, tz=${profile.timezone})`,
  );

  const demoDate = flags.demoDate ?? todayInTimezone(profile.timezone);
  console.log(`Demo date: ${demoDate}`);

  if (flags.remove) {
    await removeSeed(profile, demoDate);
    return;
  }

  const plan = buildPlan(profile, demoDate);
  printPlan(plan);
  printDisclosure(plan);

  if (flags.apply) {
    await applyPlan(plan);
  }
}

await main();
