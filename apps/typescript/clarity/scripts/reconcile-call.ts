/** Reconcile a known provider call with a halted local session. Never calls create. */
import { operatorId } from "../lib/auth";
import { callError, reconcileCall } from "../lib/live-call";

const [sessionId, callId] = process.argv.slice(2);
if (!sessionId || !callId || !/^[A-Za-z0-9_-]{1,128}$/.test(callId)) {
  console.error("Usage: npm run call:reconcile -- <session-uuid> <existing-call-id>");
  process.exit(1);
}
try {
  console.log(JSON.stringify(await reconcileCall(sessionId, operatorId(), callId)));
} catch (error) {
  console.error(callError(error).error);
  process.exit(1);
}
