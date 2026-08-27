import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionIntent } from "./types.js";
import { applyActionIntent, writeActionIntent } from "./store.js";
import {
  formatAdapterText,
  mustHoldLiveAdapterSend,
  resolveSlackTarget,
  resolveGithubTarget,
  sendToSlack,
  sendToGithubIssue,
} from "./adapters.js";

const intent: ActionIntent = {
  intent_id: "int_test_1",
  at: "2026-08-03T12:00:00.000Z",
  status: "pending",
  mode: "dress_rehearsal",
  trigger_id: "stuck_support",
  account_id: "acct_acme",
  account_name: "Acme",
  cs_owner_id: "owner_maya",
  ticket_id: "4821",
  call_run_id: null,
  option_id: "1",
  decision: "take_over_chat",
  decision_label: "Take over in chat now",
  action: "assign_owner_to_ticket_and_post_note",
  adapter: "slack_webhook",
  adapters_planned: ["slack_webhook", "internal_queue"],
  follow_up_at: null,
  payload: { account_id: "acct_acme" },
  notes: null,
};

describe("adapter message", () => {
  it("formats account, decision, and cue into one line block", () => {
    const text = formatAdapterText(intent);
    expect(text).toContain("Acme");
    expect(text).toContain("Take over in chat now");
    expect(text).toContain("stuck_support");
    expect(text).toContain("1");
  });
});

describe("live adapter send is out of MVP", () => {
  it("HOLDs --adapter without --dry-run so Slack/GitHub never fire", () => {
    expect(mustHoldLiveAdapterSend("slack", false)).toBe(true);
    expect(mustHoldLiveAdapterSend("github", false)).toBe(true);
    expect(mustHoldLiveAdapterSend("slack", true)).toBe(false);
    expect(mustHoldLiveAdapterSend(undefined, false)).toBe(false);
  });
});

describe("slack target", () => {
  it("holds when SLACK_WEBHOOK_URL is unset", () => {
    expect(resolveSlackTarget("")).toEqual({ hold: "slack_webhook_url_unset" });
  });

  it("holds on placeholder URL", () => {
    expect(
      resolveSlackTarget("https://hooks.slack.com/services/REPLACE/ME"),
    ).toEqual({ hold: "slack_webhook_url_placeholder" });
  });

  it("accepts a real https URL", () => {
    expect(resolveSlackTarget("https://hooks.slack.com/services/T1/B1/x")).toEqual({
      url: "https://hooks.slack.com/services/T1/B1/x",
    });
  });
});

describe("sendToSlack", () => {
  it("POSTs {text} to the webhook URL", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchStub = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    const res = await sendToSlack(intent, "https://hooks.slack.com/services/T1/B1/x", fetchStub);
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://hooks.slack.com/services/T1/B1/x");
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.text).toContain("Acme");
  });
});

describe("github target", () => {
  it("holds when token, repo, or issue is missing", () => {
    expect(resolveGithubTarget({ token: "", repo: "o/r", issue: "1" })).toEqual({
      hold: "github_env_missing",
    });
    expect(resolveGithubTarget({ token: "t", repo: "", issue: "1" })).toEqual({
      hold: "github_env_missing",
    });
    expect(resolveGithubTarget({ token: "t", repo: "o/r", issue: "" })).toEqual({
      hold: "github_env_missing",
    });
  });

  it("holds on placeholder values", () => {
    expect(
      resolveGithubTarget({ token: "REPLACE_ME", repo: "o/r", issue: "1" }),
    ).toEqual({ hold: "github_env_placeholder" });
  });

  it("accepts a complete target", () => {
    expect(resolveGithubTarget({ token: "t", repo: "o/r", issue: "42" })).toEqual({
      token: "t",
      repo: "o/r",
      issue: 42,
    });
  });
});

describe("receipt records real adapter send", () => {
  let tmp: string;
  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("effect is slack_webhook_posted when the intent was actually sent", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "csvs-adp-"));
    const file = await writeActionIntent(tmp, intent);
    const applied = await applyActionIntent({
      dataDir: tmp,
      intent,
      file,
      dryRun: false,
      sent: { effect: "slack_webhook_posted", detail: "HTTP 200" },
    });
    expect(applied.receipt.effect).toBe("slack_webhook_posted");
    expect(applied.receipt.summary).toContain("HTTP 200");
  });
});

describe("sendToGithubIssue", () => {
  it("POSTs {body} to the issue comments API with auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchStub = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 201 } as Response;
    }) as unknown as typeof fetch;

    const res = await sendToGithubIssue(
      intent,
      { token: "tok", repo: "assafbar2/demo", issue: 42 },
      fetchStub,
    );
    expect(res.ok).toBe(true);
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/assafbar2/demo/issues/42/comments",
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.body).toContain("Take over in chat now");
  });
});
