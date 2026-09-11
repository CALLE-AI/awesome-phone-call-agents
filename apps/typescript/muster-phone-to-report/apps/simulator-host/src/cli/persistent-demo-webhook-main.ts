import { readFileSync } from "node:fs";

import { startPersistentDemoSession } from "../composition/persistent-demo-session.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Persistent webhook configuration is missing");
  return value;
}

function secret(name: string): string {
  const value = readFileSync(required(name), "utf8").trim();
  if (value.length === 0 || value.includes("\n") || value.includes("\r")) {
    throw new Error("Persistent webhook secret reference is invalid");
  }
  return value;
}

try {
  if (
    required("SIMULATOR_PERSISTENT_WEBHOOK") !== "true" ||
    required("RUNTIME_PROFILE") !== "development"
  ) {
    throw new Error("Persistent webhook requires explicit local development opt-in");
  }
  const session = await startPersistentDemoSession({
    publicBaseUrl: required("SIMULATOR_PUBLIC_BASE_URL"),
    twilioAuthToken: secret("TWILIO_AUTH_TOKEN_FILE"),
    accountSid: secret("TWILIO_ACCOUNT_SID_FILE"),
    numberSid: secret("TWILIO_NUMBER_SID_FILE"),
    targetNumber: secret("TWILIO_TARGET_NUMBER_FILE"),
  });
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void session
      .close()
      .then(() => {
        process.stdout.write(
          "Receiver stopped; Twilio webhook remains configured. Restart the receiver before calling.\n",
        );
      })
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const outcome = await session.activate();
  process.stdout.write(
    JSON.stringify({
      event: "persistent_demo_webhook",
      outcome: stopping ? "stopping" : outcome,
      receiverRunning: !stopping,
      automaticRejectRestoration: false,
      outboundCallPlaced: false,
    }) + "\n",
  );
} catch {
  process.stderr.write("Persistent demo webhook startup failed; no call was placed.\n");
  process.exitCode = 1;
}
