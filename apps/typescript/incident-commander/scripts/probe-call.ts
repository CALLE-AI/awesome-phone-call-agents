import { loadConfig } from "../src/config.js";
import { getCall } from "../src/calle/client.js";

const callId = process.argv[2] ?? "call_yeQw0DUuBJWxQYVsjoYG5w";
try {
  const call = await getCall(loadConfig(), callId);
  console.log(
    JSON.stringify(
      {
        status: call.status,
        taskCompleted: call.taskCompleted,
        structuredResult: call.structuredResult,
        recipientResult: call.recipients?.[0]?.structuredResult,
        attemptCount: call.recipients?.[0]?.attempts?.length ?? 0,
        transcriptTurns: call.recipients?.[0]?.attempts?.[0]?.transcriptTurns?.length ?? 0
      },
      null,
      2
    )
  );
} catch (error) {
  const err = error as Error & { cause?: unknown };
  console.error("message", err.message);
  console.error("cause", err.cause);
}
