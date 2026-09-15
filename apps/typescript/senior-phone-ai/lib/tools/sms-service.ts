import type {
  ActionAuthorizationStore,
  ActionRequest,
} from "../safety/authorization";
import { assertStrictE164 } from "../safety/phone";
import type {
  SmsAdapter,
  SmsDeliveryVerifier,
  SmsResult,
} from "./contracts";
import {
  type SmsReservation,
  type SmsStore,
  toSmsOperationalSummary,
} from "./sms-store";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export interface AuthorizedSmsRequest extends SmsReservation {
  readonly authorizationId: string;
  readonly principalId: string;
}

export function createSmsActionRequest(request: AuthorizedSmsRequest): ActionRequest {
  return {
    principalId: request.principalId,
    seniorId: request.seniorId,
    action: "send_sms",
    destinationE164: request.destinationE164,
    purpose: request.purpose,
    details: {
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      message: request.message,
    },
  };
}

function validateSmsRequest(request: AuthorizedSmsRequest): void {
  assertStrictE164(request.destinationE164);
  if (!UUID_V4.test(request.correlationId)) throw new Error("correlationId must be a UUID v4");
  if (!IDEMPOTENCY_KEY.test(request.idempotencyKey)) throw new Error("invalid idempotency key");
  if (request.message.length < 1 || request.message.length > 480 || request.message.trim() !== request.message) {
    throw new Error("SMS message must be non-empty, bounded, and trimmed");
  }
}

export class SmsService {
  constructor(
    private readonly adapter: SmsAdapter,
    private readonly authorizations: ActionAuthorizationStore,
    private readonly store: SmsStore,
  ) {}

  async dispatch(request: AuthorizedSmsRequest) {
    validateSmsRequest(request);
    const reservation = await this.store.reserve({
      authorizationId: request.authorizationId,
      correlationId: request.correlationId,
      destinationE164: request.destinationE164,
      idempotencyKey: request.idempotencyKey,
      message: request.message,
      purpose: request.purpose,
      seniorId: request.seniorId,
    });
    if (!reservation.created) return toSmsOperationalSummary(reservation.record);

    const decision = await this.authorizations.consume(
      request.authorizationId,
      createSmsActionRequest(request),
    );
    if (!decision.allowed) {
      await this.store.updateDispatch(request.idempotencyKey, "failed");
      throw new Error(`SMS authorization ${decision.reason}`);
    }

    let result: SmsResult;
    try {
      result = await this.adapter.send({
        destinationE164: request.destinationE164,
        idempotencyKey: request.idempotencyKey,
        message: request.message,
      });
    } catch {
      const unknown = await this.store.updateDispatch(request.idempotencyKey, "unknown");
      return toSmsOperationalSummary(unknown);
    }
    const updated = await this.store.updateDispatch(
      request.idempotencyKey,
      result.status,
      result.providerMessageId,
    );
    return toSmsOperationalSummary(updated);
  }

  async processCallback(
    rawBody: string,
    headers: Readonly<Record<string, string>>,
    verifier: SmsDeliveryVerifier,
  ) {
    const event = verifier.verify(rawBody, headers);
    const updated = await this.store.applyDelivery(event);
    return updated ? toSmsOperationalSummary(updated) : undefined;
  }
}
