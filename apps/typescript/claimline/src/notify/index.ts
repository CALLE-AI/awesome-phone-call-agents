import type { ClaimLineConfig } from "../config.js";
import type { Notifier } from "./notifier.js";
import { SimulatedNotifier } from "./simulated.js";
import { CompositeNotifier, SlackNotifier, TeamsNotifier } from "./webhook.js";

export type { NotifyMessage, NotifyResult, Notifier } from "./notifier.js";
export { SlackNotifier, TeamsNotifier, CompositeNotifier } from "./webhook.js";
export { SimulatedNotifier } from "./simulated.js";

/**
 * Build the notifier from config: Slack and/or Teams when their webhook URLs are
 * set (both → fan-out), otherwise a simulated notifier so nothing is required.
 */
export function createNotifier(config: ClaimLineConfig): Notifier {
  const notifiers: Notifier[] = [];
  if (config.slackWebhookUrl) notifiers.push(new SlackNotifier(config.slackWebhookUrl));
  if (config.teamsWebhookUrl) notifiers.push(new TeamsNotifier(config.teamsWebhookUrl));
  if (notifiers.length === 0) return new SimulatedNotifier();
  if (notifiers.length === 1) return notifiers[0]!;
  return new CompositeNotifier(notifiers);
}
