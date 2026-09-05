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
import { loadRecentCueKeys, writeback } from "./index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = JSON.parse(
  readFileSync(path.join(root, "fixtures/stuck_support_acme.json"), "utf8"),
);

describe("writeback cue-history", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("does not append cue-history on curtain-up HOLD (dedupe not poisoned)", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "csvs-wb-"));
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, "+14155552671", options);
    const hold = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      holdReason: "house_dark",
    });

    const paths = await writeback({
      dataDir: tmp,
      mode: "curtain_up",
      event,
      intent,
      result: hold,
      note: "HOLD must not poison dedupe",
    });

    expect(paths.cueHistory).toBeNull();
    const history = await readFile(path.join(tmp, "cue-history.ndjson"), "utf8").catch(
      () => "",
    );
    expect(history).toBe("");

    const book = await readFile(path.join(tmp, "prompt-book.ndjson"), "utf8");
    expect(book).toMatch(/"decision":"hold"/);
    expect(book).toMatch(/house_dark/);

    const keys = await loadRecentCueKeys(tmp, 120);
    expect(keys.size).toBe(0);
  });

  it("appends cue-history after a live dial outcome", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "csvs-wb-"));
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, "+14155552671", options);
    const live = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      callRunId: "call_test_live",
      structured: {
        option_id: "1",
        decision: "take_over_chat",
        decision_label: "Take over in chat now",
      },
    });

    const paths = await writeback({
      dataDir: tmp,
      mode: "curtain_up",
      event,
      intent,
      result: live,
    });

    expect(paths.cueHistory).toBeTruthy();
    const keys = await loadRecentCueKeys(tmp, 120);
    expect(keys.has(`stuck_support:${event.account.id}`)).toBe(true);
  });

  it("dress rehearsal never appends cue-history", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "csvs-wb-"));
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, event.cs_owner.e164, options);
    const dress = toDecision({
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
      result: dress,
    });

    expect(paths.cueHistory).toBeNull();
    const keys = await loadRecentCueKeys(tmp, 120);
    expect(keys.size).toBe(0);
  });
});
