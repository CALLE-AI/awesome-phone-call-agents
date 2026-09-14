import type { NotifyMessage, NotifyResult, Notifier } from "./notifier.js";

/**
 * Default notifier when no Slack/Teams webhook is configured. It "delivers" the
 * message by logging a one-line marker (no external call), so the autopilot flow
 * works end-to-end without any integration set up.
 */
export class SimulatedNotifier implements Notifier {
  readonly channel = "simulated";

  async send(msg: NotifyMessage): Promise<NotifyResult> {
    // eslint-disable-next-line no-console
    console.log(`[notify:simulated] ${msg.title}`);
    return {
      delivered: true,
      channel: this.channel,
      message: "no webhook configured — report recorded locally",
    };
  }
}
