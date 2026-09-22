import { HardenedCalleGateway } from "./client-hardened";
import type { CalleExecutionContext } from "./live-gate";
import type { CallEventPage, CallTask, CalleTransport, CreateCallRequest } from "./runtime-types";

/**
 * Compatibility facade for existing server callers. Legacy transport hints cannot opt a
 * request into live calling. Only the protected workflow factory supplies live context.
 */
export class CalleGateway {
  private readonly hardened: HardenedCalleGateway;

  constructor(transport: CalleTransport = "mock", context?: CalleExecutionContext) {
    const safeContext: CalleExecutionContext =
      context ??
      (transport === "mock"
        ? {
            intent: "mock",
            operatorAuthorized: false,
            requestIsLoopback: false,
            recipientAuthorized: false,
            source: "test",
          }
        : {
            intent: "mock",
            operatorAuthorized: false,
            requestIsLoopback: false,
            recipientAuthorized: false,
            source: "internal",
          });
    this.hardened = new HardenedCalleGateway(safeContext);
  }

  /** Used only after a protected tRPC workflow has confirmed consent and recipient scope. */
  static forProtectedWorkflow(): CalleGateway {
    return new CalleGateway("rest", {
      intent: "live",
      operatorAuthorized: true,
      requestIsLoopback: false,
      recipientAuthorized: true,
      source: "workflow",
    });
  }

  createCall(request: CreateCallRequest): Promise<CallTask> {
    return this.hardened.createCall(request);
  }

  getCall(id: string): Promise<CallTask> {
    return this.hardened.getCall(id);
  }

  listEvents(id: string, cursor?: string): Promise<CallEventPage> {
    return this.hardened.listEvents(id, cursor);
  }

  createAndWait(request: CreateCallRequest): Promise<CallTask> {
    return this.hardened.createAndWait(request);
  }
}

export { HardenedCalleGateway } from "./client-hardened";
