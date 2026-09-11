import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeEvent } from "../ingest/normalize.js";
import { buildCallIntent } from "../calle/intent.js";
import { pickOptions } from "../policy/options.js";
import { toDecision } from "../map/toDecision.js";
import { buildActionIntent, shouldEmitActionIntent } from "./mapDecisionToIntent.js";
import { applyActionIntent, loadLastPendingIntent, writeActionIntent } from "./store.js";
import { writeback } from "../writeback/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = JSON.parse(
  readFileSync(path.join(root, "fixtures/stuck_support_acme.json"), "utf8"),
);
const webhook = JSON.parse(
  readFileSync(path.join(root, "events/webhook_stuck_support.json"), "utf8"),
);

describe("action intent seam", () => {
  let tmp: string;
  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("maps take_over_chat to zendesk-shaped intent", () => {
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, event.cs_owner.e164, options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "dress_rehearsal",
    });
    expect(shouldEmitActionIntent(result)).toBe(true);
    const action = buildActionIntent({ event, result, mode: "dress_rehearsal" });
    expect(action?.action).toBe("assign_owner_to_ticket_and_post_note");
    expect(action?.adapter).toBe("zendesk_ticket_note");
    expect(action?.adapters_planned).toContain("salesforce_task");
    expect(action?.payload.account_id).toBe("acct_acme");
  });

  it("does not emit on HOLD", () => {
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, event.cs_owner.e164, options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      holdReason: "house_dark",
    });
    expect(shouldEmitActionIntent(result)).toBe(false);
    expect(buildActionIntent({ event, result, mode: "curtain_up" })).toBeNull();
  });

  it("writeback emits pending intent; dry-run apply writes receipt", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "csvs-act-"));
    const event = normalizeEvent(webhook);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, event.cs_owner.e164, options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "dress_rehearsal",
    });
    const paths = await writeback({
      dataDir: tmp,
      mode: "dress_rehearsal",
      event,
      intent,
      result,
    });
    expect(paths.actionIntent).toBeTruthy();
    const raw = JSON.parse(await readFile(paths.actionIntent!, "utf8"));
    expect(raw.status).toBe("pending");
    expect(raw.metadata ?? raw.payload.source_event_id).toBeTruthy();

    const loaded = await loadLastPendingIntent(tmp);
    expect(loaded).toBeTruthy();
    const applied = await applyActionIntent({
      dataDir: tmp,
      intent: loaded!.intent,
      file: loaded!.file,
      dryRun: true,
    });
    expect(applied.receipt.dry_run).toBe(true);
    expect(applied.receipt.effect).toBe("local_receipt");
    expect(applied.receipt.summary).toMatch(/DRY-RUN/);
  });

  it("local execute moves intent out of pending", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "csvs-act2-"));
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const callIntent = buildCallIntent(event, event.cs_owner.e164, options);
    const result = toDecision({
      event,
      intent: callIntent,
      options,
      mode: "dress_rehearsal",
      simulatedOptionId: "3",
    });
    const action = buildActionIntent({ event, result, mode: "dress_rehearsal" })!;
    expect(action.action).toBe("schedule_follow_up");
    expect(action.follow_up_at).toBeTruthy();
    const file = await writeActionIntent(tmp, action);
    await applyActionIntent({
      dataDir: tmp,
      intent: action,
      file,
      dryRun: false,
    });
    expect(await loadLastPendingIntent(tmp)).toBeNull();
  });
});
