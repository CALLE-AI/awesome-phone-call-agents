/**
 * Action-intent adapters — STAB only (out of MVP).
 * Slack-shaped webhook (POST {text}) and GitHub issue comment (POST {body})
 * exist to show the handoff is possible. Do not fire a real channel.
 * Placeholder / missing env resolves to HOLD — never a silent no-op.
 */
import type { ActionIntent } from "./types.js";

const PLACEHOLDER = /replace|placeholder|your[_-]/i;

/** Live Slack/GitHub HTTP send is a stab, out of MVP. CLI HOLDs unless --dry-run. */
export function mustHoldLiveAdapterSend(
  adapter: string | undefined,
  dryRun: boolean,
): boolean {
  return Boolean(adapter) && !dryRun;
}

export function formatAdapterText(intent: ActionIntent): string {
  return [
    `Stage Manager — decision for ${intent.account_name} (${intent.account_id})`,
    `Cue: ${intent.trigger_id}${intent.ticket_id ? ` · Ticket ${intent.ticket_id}` : ""}`,
    `Line reading ${intent.option_id}: ${intent.decision_label}`,
    `Action: ${intent.action} · Intent: ${intent.intent_id}`,
  ].join("\n");
}

export type SlackTarget = { url: string } | { hold: string };

export function resolveSlackTarget(rawUrl: string): SlackTarget {
  const url = rawUrl.trim();
  if (!url) return { hold: "slack_webhook_url_unset" };
  if (PLACEHOLDER.test(url)) return { hold: "slack_webhook_url_placeholder" };
  return { url };
}

export async function sendToSlack(
  intent: ActionIntent,
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: formatAdapterText(intent) }),
  });
  return { ok: res.ok, status: res.status };
}

export type GithubTarget =
  | { token: string; repo: string; issue: number }
  | { hold: string };

export function resolveGithubTarget(raw: {
  token: string;
  repo: string;
  issue: string;
}): GithubTarget {
  const token = raw.token.trim();
  const repo = raw.repo.trim();
  const issue = raw.issue.trim();
  if (!token || !repo || !issue) return { hold: "github_env_missing" };
  if (PLACEHOLDER.test(token) || PLACEHOLDER.test(repo) || PLACEHOLDER.test(issue)) {
    return { hold: "github_env_placeholder" };
  }
  return { token, repo, issue: Number(issue) };
}

export async function sendToGithubIssue(
  intent: ActionIntent,
  target: { token: string; repo: string; issue: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${target.repo}/issues/${target.issue}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${target.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: formatAdapterText(intent) }),
    },
  );
  return { ok: res.ok, status: res.status };
}
