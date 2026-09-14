import type { NotifyMessage, NotifyResult, Notifier } from "./notifier.js";

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const detail = await res.text().catch(() => "");
    return { ok: res.ok, detail: detail.slice(0, 200) };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Posts to a Slack incoming webhook (https://hooks.slack.com/services/...). */
export class SlackNotifier implements Notifier {
  readonly channel = "slack";
  constructor(private readonly webhookUrl: string) {}

  async send(msg: NotifyMessage): Promise<NotifyResult> {
    const { ok, detail } = await postJson(this.webhookUrl, {
      text: `*${msg.title}*\n${msg.text}`,
    });
    return { delivered: ok, channel: this.channel, message: ok ? "posted to Slack" : detail };
  }
}

/** Posts a MessageCard to a Microsoft Teams incoming webhook. */
export class TeamsNotifier implements Notifier {
  readonly channel = "teams";
  constructor(private readonly webhookUrl: string) {}

  async send(msg: NotifyMessage): Promise<NotifyResult> {
    const { ok, detail } = await postJson(this.webhookUrl, {
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      summary: msg.title,
      themeColor: "0F172A",
      title: msg.title,
      text: msg.text.replace(/\n/g, "\n\n"),
    });
    return { delivered: ok, channel: this.channel, message: ok ? "posted to Teams" : detail };
  }
}

/** Fans a message out to several notifiers (e.g. Slack + Teams). */
export class CompositeNotifier implements Notifier {
  readonly channel = "composite";
  constructor(private readonly notifiers: Notifier[]) {}

  async send(msg: NotifyMessage): Promise<NotifyResult> {
    const results = await Promise.all(this.notifiers.map((n) => n.send(msg)));
    const delivered = results.some((r) => r.delivered);
    const detail = results
      .map((r) => `${r.channel}:${r.delivered ? "ok" : "fail"}`)
      .join(", ");
    return { delivered, channel: this.channel, message: detail };
  }
}
