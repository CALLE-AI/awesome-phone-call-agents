// A credential-free CALL-E stub. It satisfies CalleLike, so the whole app runs and
// is fully testable with NO API key and NO real calls — which is also exactly the
// "no-call / dry-run default" the repo's merge bar requires. Replays canned results.

import type { CalleCallResult, CalleLike, CreateCallInput } from "./types";

export type FakeResolver = (input: CreateCallInput) => CalleCallResult | Promise<CalleCallResult>;

export class FakeCalle implements CalleLike {
  /** Every call the app tried to place — assert on this in tests (masking, idempotency). */
  readonly requests: CreateCallInput[] = [];
  private readonly resolver: FakeResolver | CalleCallResult;

  constructor(resolver: FakeResolver | CalleCallResult) {
    this.resolver = resolver;
  }

  calls = {
    createAndWait: async (input: CreateCallInput): Promise<CalleCallResult> => {
      this.requests.push(input);
      return typeof this.resolver === "function" ? await this.resolver(input) : this.resolver;
    },
  };
}
