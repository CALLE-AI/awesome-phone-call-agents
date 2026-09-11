import {
  createTwilioLiveSmokeControlTransport,
  type TwilioLiveSmokeControlTransport,
} from "@muster/infrastructure-twilio-simulator";

import { startPersistentDemoReceiver } from "./persistent-demo-receiver.js";

type ReceiverInput = Parameters<typeof startPersistentDemoReceiver>[0];
type Receiver = Awaited<ReturnType<typeof startPersistentDemoReceiver>>;
type ConfigurationTransport = Pick<
  TwilioLiveSmokeControlTransport,
  "readConfiguration" | "updateConfiguration"
>;

/** Owns an inbound receiver, never a CALL-E client or outbound-call permission. */
export async function startPersistentDemoSession(
  input: ReceiverInput & {
    readonly numberSid: string;
    readonly startReceiver?: (input: ReceiverInput) => Promise<Receiver>;
    readonly createTransport?: (input: {
      accountSid: string;
      numberSid: string;
      authToken: string;
    }) => ConfigurationTransport;
    readonly request?: typeof fetch;
  },
) {
  const receiver = await (input.startReceiver ?? startPersistentDemoReceiver)(input);
  const request = input.request ?? fetch;
  const live = Object.freeze({
    voiceUrl: `${input.publicBaseUrl}/twilio/voice`,
    statusCallbackUrl: `${input.publicBaseUrl}/twilio/status`,
  });
  let activation: Promise<"ready" | "blocked"> | undefined;
  const activate = async (): Promise<"ready" | "blocked"> => {
    try {
      const health = async (baseUrl: string) => {
        const response = await request(`${baseUrl}/healthz`, {
          method: "GET",
          redirect: "error",
          headers: { "ngrok-skip-browser-warning": "1" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("Receiver health unavailable");
        const value = (await response.json()) as Record<string, unknown>;
        if (
          value["ready"] !== true ||
          value["mode"] !== "persistent-demo" ||
          value["publicOrigin"] !== input.publicBaseUrl ||
          typeof value["instanceId"] !== "string" ||
          value["instanceId"].length === 0
        ) {
          throw new Error("Receiver health mismatch");
        }
        return value["instanceId"];
      };
      const localInstance = await health(receiver.baseUrl);
      if ((await health(input.publicBaseUrl)) !== localInstance) return "blocked";
      const transport = (input.createTransport ?? createTwilioLiveSmokeControlTransport)({
        accountSid: input.accountSid,
        numberSid: input.numberSid,
        authToken: input.twilioAuthToken,
      });
      try {
        await transport.updateConfiguration(live);
      } catch {
        // A lost update response is reconciled by a read, never another update.
      }
      const current = await transport.readConfiguration();
      return current.voiceUrl === live.voiceUrl &&
        current.statusCallbackUrl === live.statusCallbackUrl &&
        current.voiceMethod === "POST" &&
        current.statusCallbackMethod === "POST"
        ? "ready"
        : "blocked";
    } catch {
      // Keep the receiver alive if Twilio may already point at it. No automatic Reject.
      return "blocked";
    }
  };
  return Object.freeze({
    baseUrl: receiver.baseUrl,
    activate: () => (activation ??= activate()),
    close: async () => {
      // Let any in-flight update/readback settle before releasing the receiving server.
      await activation;
      await receiver.close();
    },
  });
}
