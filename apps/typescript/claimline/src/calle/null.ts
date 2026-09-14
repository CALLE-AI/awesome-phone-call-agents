import type { CalleGateway, CallHandle, CallRequest, CallSnapshot } from "./gateway.js";

/**
 * Placeholder gateway used in live mode when no CALL-E API key is available for
 * the current actor (e.g. an owner with no server key, or a guest who hasn't
 * entered their key yet). It lets the app start and browse, but any attempt to
 * place or read a real call fails with a clear, actionable message.
 */
export class NullCalleGateway implements CalleGateway {
  readonly mode = "live" as const;

  async startCall(_req: CallRequest): Promise<CallHandle> {
    throw new Error(
      "No CALL-E API key available for this call. Owners: set CALLE_API_KEY on the server. Guests: add your own CALL-E API key first.",
    );
  }

  async getCall(_callId: string): Promise<CallSnapshot> {
    throw new Error("No CALL-E API key available to read this call.");
  }
}
