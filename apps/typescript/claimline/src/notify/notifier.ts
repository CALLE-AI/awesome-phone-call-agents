export interface NotifyMessage {
  title: string;
  /** Plain-text / lightly-formatted body. */
  text: string;
}

export interface NotifyResult {
  delivered: boolean;
  /** "slack" | "teams" | "simulated" | "composite" */
  channel: string;
  message?: string;
}

/**
 * Outbound notifier for autopilot reports. A real webhook implementation (Slack
 * or Microsoft Teams) is used only when a webhook URL is configured; otherwise a
 * simulated notifier records the message so the app runs with no integrations.
 */
export interface Notifier {
  readonly channel: string;
  send(msg: NotifyMessage): Promise<NotifyResult>;
}
