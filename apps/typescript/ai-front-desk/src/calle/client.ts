// The ONLY module that touches @call-e/calle. Every call in the app funnels
// through runCall(), which is where the dry-run safety gate lives: with
// CALLE_DRY_RUN=true (the default) no SDK is loaded, no network request is
// made, and a deterministic mock result is recorded instead.

import { readCalleRuntimeConfig, assertLiveCallAllowed, type CalleRuntimeConfig } from "../config/env.js";
import { prisma } from "../db/client.js";
import type { NormalizedCallResult, RunCallInput, TranscriptTurn } from "./types.js";

const TERMINAL_WAIT = { timeoutMs: 5 * 60 * 1000, intervalMs: 7000 };

/** The one host this app has business talking to. */
const CALLE_HOSTS = ["api.heycall-e.com"];
/** Loopback only, so a local fake server can be used in tests. Plain http allowed here only. */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * Refuses to send the API key anywhere untrusted. Exact hostname match only
 * — no suffix matching, since e.g. `api.heycall-e.com.attacker.example`
 * ends in nothing this app trusts and a suffix check would say it does.
 */
export function assertTrustedBaseUrl(baseUrl: string): void {
  const advice = "Set CALLE_BASE_URL to https://api.heycall-e.com. Plain http is allowed only on localhost/127.0.0.1/::1 for local fake-server testing.";
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`CALL-E base URL "${baseUrl}" is not a valid URL, so the API key was not sent. ${advice}`);
  }
  const host = hostOf(url);
  const trusted = new Set([...CALLE_HOSTS, ...LOOPBACK_HOSTS]);
  if (!trusted.has(host)) {
    throw new Error(`CALL-E base URL "${baseUrl}" is not a host this app trusts, so the API key was not sent. ${advice}`);
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.includes(host)) return;
  throw new Error(`CALL-E base URL "${baseUrl}" does not use https, so the API key was not sent. ${advice}`);
}

export async function runCall(input: RunCallInput): Promise<NormalizedCallResult> {
  const config = readCalleRuntimeConfig();
  if (config.CALLE_DRY_RUN) {
    return runDry(input);
  }
  return runLive(input, config);
}

async function runDry(input: RunCallInput): Promise<NormalizedCallResult> {
  const transcript: TranscriptTurn[] = [
    { offset_seconds: 0, speaker: "bot", text: `[dry run] ${input.task.slice(0, 140)}` },
    { offset_seconds: 6, speaker: "user", text: "[dry run] Simulated response." },
  ];
  const log = await prisma.callLog.create({
    data: {
      businessId: input.businessId,
      flow: input.flow,
      appointmentId: input.appointmentId ?? null,
      waitlistEntryId: input.waitlistEntryId ?? null,
      leadId: input.leadId ?? null,
      calleCallId: null,
      task: input.task,
      resultSchema: JSON.stringify(input.resultSchema),
      status: "dry_run",
      taskCompleted: true,
      completionConfidence: JSON.stringify({ score: 1, label: "dry_run" }),
      structuredResult: JSON.stringify(input.dryRunResult),
      transcript: JSON.stringify(transcript),
      summary: "Dry run: no call was placed.",
      evidence: JSON.stringify(["CALLE_DRY_RUN=true, deterministic mock result"]),
      dryRun: true,
    },
  });
  console.log(`[calle:dry-run] flow=${input.flow} phone=${mask(input.phone)} task="${input.task.slice(0, 100)}..."`);
  return {
    callLogId: log.id,
    calleCallId: null,
    status: "dry_run",
    taskCompleted: true,
    structuredResult: input.dryRunResult,
    summary: log.summary,
    transcript,
    dryRun: true,
  };
}

async function runLive(input: RunCallInput, config: CalleRuntimeConfig): Promise<NormalizedCallResult> {
  assertLiveCallAllowed(config);
  assertTrustedBaseUrl(config.CALLE_BASE_URL);
  // Live calls are ALWAYS routed to the operator's own verified number,
  // never to contact numbers (which are fictional in seed data anyway).
  const phone = config.LIVE_CALL_OVERRIDE_PHONE;
  const { CalleClient } = await import("@call-e/calle");
  const client = new CalleClient({ apiKey: config.CALLE_API_KEY, baseUrl: config.CALLE_BASE_URL });

  const created = (await client.calls.create(
    {
      task: input.task,
      recipients: [{ phones: [phone], region: "US", locale: "en-US" }],
      resultSchema: input.resultSchema as unknown as Record<string, unknown>,
      metadata: { flow: input.flow, app: "ai-front-desk" },
    },
    { idempotencyKey: input.idempotencyKey },
  )) as { id: string };

  const snapshot = (await client.calls.waitForResult(created.id, TERMINAL_WAIT)) as {
    id: string;
    status: string;
    taskCompleted: boolean | null;
    completionConfidence: { score: number; label: string } | null;
    structuredResult: Record<string, unknown> | null;
    summary: string | null;
    evidence: string[];
    recipients: { attempts: { transcriptTurns: TranscriptTurn[] }[] }[];
  };

  const transcript = snapshot.recipients?.[0]?.attempts?.[0]?.transcriptTurns ?? [];
  const log = await prisma.callLog.create({
    data: {
      businessId: input.businessId,
      flow: input.flow,
      appointmentId: input.appointmentId ?? null,
      waitlistEntryId: input.waitlistEntryId ?? null,
      leadId: input.leadId ?? null,
      calleCallId: snapshot.id,
      task: input.task,
      resultSchema: JSON.stringify(input.resultSchema),
      status: snapshot.status,
      taskCompleted: snapshot.taskCompleted,
      completionConfidence: snapshot.completionConfidence ? JSON.stringify(snapshot.completionConfidence) : null,
      structuredResult: snapshot.structuredResult ? JSON.stringify(snapshot.structuredResult) : null,
      transcript: JSON.stringify(transcript),
      summary: snapshot.summary,
      evidence: JSON.stringify(snapshot.evidence ?? []),
      dryRun: false,
    },
  });
  console.log(`[calle:LIVE] flow=${input.flow} call=${snapshot.id} status=${snapshot.status} phone=${mask(phone)}`);
  return {
    callLogId: log.id,
    calleCallId: snapshot.id,
    status: snapshot.status,
    taskCompleted: snapshot.taskCompleted,
    structuredResult: snapshot.structuredResult,
    summary: snapshot.summary,
    transcript,
    dryRun: false,
  };
}

export function mask(phone: string): string {
  return phone.length > 4 ? `${phone.slice(0, 3)}•••${phone.slice(-2)}` : "•••";
}
