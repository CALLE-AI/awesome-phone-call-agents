import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryActionAuthorizationStore } from "../lib/safety/authorization";
import type {
  SmsAdapter,
  SmsDeliveryVerifier,
  SmsRequest,
} from "../lib/tools/contracts";
import { composeInformationSms } from "../lib/tools/information-sms";
import {
  createSmsActionRequest,
  SmsService,
  type AuthorizedSmsRequest,
} from "../lib/tools/sms-service";
import { InMemorySmsStore } from "../lib/tools/sms-store";

const correlationId = "11111111-1111-4111-8111-111111111111";
const baseRequest: AuthorizedSmsRequest = {
  authorizationId: "authorization-1",
  principalId: "synthetic-senior",
  seniorId: "20000000-0000-4000-8000-000000000001",
  correlationId,
  destinationE164: "+12025550123",
  idempotencyKey: "sms:synthetic:request-1",
  message: "Community gardening workshop\nWhen: Saturday, 10:00 AM\nWhere: Example Library\nSource: https://example.com/event",
  purpose: "Send the requested event details",
};

class RecordingSmsAdapter implements SmsAdapter {
  readonly requests: SmsRequest[] = [];
  constructor(private readonly result = { status: "queued", providerMessageId: "message-1" } as const) {}
  async send(request: SmsRequest) {
    this.requests.push(request);
    return this.result;
  }
}

function authorizedService(adapter: SmsAdapter = new RecordingSmsAdapter()) {
  const authorizations = new InMemoryActionAuthorizationStore({
    createId: () => baseRequest.authorizationId,
  });
  const pending = authorizations.propose(createSmsActionRequest(baseRequest));
  if (pending instanceof Promise) throw new Error("in-memory authorization must be synchronous");
  const confirmation = authorizations.confirm(pending.authorizationId, baseRequest.principalId, true);
  if (confirmation instanceof Promise) throw new Error("in-memory confirmation must be synchronous");
  return { adapter, service: new SmsService(adapter, authorizations, new InMemorySmsStore()) };
}

test("information SMS contains supplied time, address, and safe source without invention", () => {
  assert.equal(
    composeInformationSms({
      title: "Community gardening workshop",
      when: "Saturday, 10:00 AM",
      address: "Example Library",
      sourceUrl: "https://example.com/event",
    }),
    baseRequest.message,
  );
  assert.throws(() => composeInformationSms({
    title: "Event",
    when: "Saturday",
    sourceUrl: "javascript:alert(1)",
  }));
  assert.throws(() => composeInformationSms({
    title: "x".repeat(101),
    when: "Saturday",
    sourceUrl: "https://example.com/event",
  }));
});

test("confirmed SMS dispatch is masked and deduplicated", async () => {
  const adapter = new RecordingSmsAdapter();
  const { service } = authorizedService(adapter);
  const first = await service.dispatch(baseRequest);
  const duplicate = await service.dispatch(baseRequest);

  assert.deepEqual(first, {
    correlationId,
    destination: "[phone ending 0123]",
    status: "queued",
  });
  assert.deepEqual(duplicate, first);
  assert.equal(adapter.requests.length, 1);
});

test("changed or unconfirmed SMS requests fail before provider dispatch", async () => {
  const adapter = new RecordingSmsAdapter();
  const { service } = authorizedService(adapter);
  await assert.rejects(
    service.dispatch({ ...baseRequest, message: "Changed message" }),
    /authorization mismatched/,
  );
  assert.equal(adapter.requests.length, 0);

  const noConsentAdapter = new RecordingSmsAdapter();
  const noConsent = new SmsService(
    noConsentAdapter,
    new InMemoryActionAuthorizationStore(),
    new InMemorySmsStore(),
  );
  await assert.rejects(noConsent.dispatch(baseRequest), /authorization denied/);
  assert.equal(noConsentAdapter.requests.length, 0);
});

test("provider uncertainty is retained and is not retried", async () => {
  let attempts = 0;
  const adapter: SmsAdapter = {
    async send() {
      attempts += 1;
      throw new Error("simulated uncertain provider result");
    },
  };
  const { service } = authorizedService(adapter);
  assert.equal((await service.dispatch(baseRequest)).status, "unknown");
  assert.equal((await service.dispatch(baseRequest)).status, "unknown");
  assert.equal(attempts, 1);
});

test("verified delivery callbacks update status once and unsigned callbacks fail", async () => {
  const { service } = authorizedService();
  await service.dispatch(baseRequest);
  let verified = 0;
  const verifier: SmsDeliveryVerifier = {
    verify(rawBody, headers) {
      if (headers.signature !== "valid") throw new Error("invalid callback signature");
      verified += 1;
      assert.equal(rawBody, "provider payload");
      return {
        eventId: "event-1",
        occurredAt: "2026-09-10T00:00:00.000Z",
        providerMessageId: "message-1",
        status: "sent",
      };
    },
  };

  await assert.rejects(service.processCallback("provider payload", {}, verifier));
  const sent = await service.processCallback("provider payload", { signature: "valid" }, verifier);
  const duplicate = await service.processCallback("provider payload", { signature: "valid" }, verifier);
  assert.equal(sent?.status, "sent");
  assert.equal(duplicate?.status, "sent");
  assert.equal(verified, 2);
});

test("older verified callback events do not regress delivery state", async () => {
  const { service } = authorizedService();
  await service.dispatch(baseRequest);
  const verifier: SmsDeliveryVerifier = {
    verify(rawBody) {
      return {
        eventId: rawBody,
        occurredAt: rawBody === "newer"
          ? "2026-09-10T00:01:00.000Z"
          : "2026-09-10T00:00:00.000Z",
        providerMessageId: "message-1",
        status: rawBody === "newer" ? "sent" : "failed",
      };
    },
  };
  assert.equal((await service.processCallback("newer", {}, verifier))?.status, "sent");
  assert.equal((await service.processCallback("older", {}, verifier))?.status, "sent");
});
