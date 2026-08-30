import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CalleClient, Call } from '@call-e/calle';
import { CALLE_CLIENT } from './calle-client.provider';
import { OrderStatus } from '../orders/order-status.enum';
import { CreateOrderDto } from '../orders/dto/create-order.dto';

export interface CallVerificationResult {
  status: OrderStatus;
  rawCallStatus: string;
  summary: string;
  correctedAddress?: string;
  declineReason?: string;
}

/**
 * Shape of the request we actually send, matching the LIVE API contract
 * documented at docs.heycall-e.com/calls - not the installed
 * @call-e/calle@0.1.0 package's CreateCallInput type, which incorrectly
 * requires a `recipient` field. The live API rejects that field outright
 * ("Extra inputs are not permitted"), confirmed against a real 422 response.
 * If a future SDK version fixes its types, this local type (and the `as any`
 * cast below) can be dropped in favor of the real CreateCallInput import.
 */
interface DispatchCallRequest {
  task: string;
  resultSchema: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * JSON Schema passed to CALL-E as `resultSchema`. CALL-E's agent extracts
 * this from the call evidence and returns it on `call.structuredResult`, so
 * we never have to regex-parse a transcript to know what happened.
 *
 * Per docs.heycall-e.com/calls: object schemas are strict by default, and
 * `additionalProperties: false` is best practice to prevent stray fields.
 */
const ORDER_CONFIRMATION_RESULT_SCHEMA = {
  type: 'object',
  required: ['outcome'],
  properties: {
    outcome: {
      type: 'string',
      enum: ['confirmed', 'declined', 'address_mismatch', 'unknown'],
      description:
        'confirmed = customer wants the order and confirmed the address is correct. ' +
        'declined = customer said they no longer want the order. ' +
        'address_mismatch = customer wants the order but said the delivery address is wrong. ' +
        'unknown = the call did not produce a clear answer (e.g. no meaningful conversation happened).',
    },
    correctedAddress: {
      type: 'string',
      description:
        'The correct delivery address as stated by the customer. Empty string if outcome is not address_mismatch.',
    },
    declineReason: {
      type: 'string',
      description:
        'A one-sentence reason the customer gave for declining. Empty string if outcome is not declined.',
    },
  },
  additionalProperties: false,
};

@Injectable()
export class CallVerificationService {
  private readonly logger = new Logger(CallVerificationService.name);

  constructor(@Inject(CALLE_CLIENT) private readonly calle: CalleClient) {}

  /**
   * Places an outbound call to the customer to confirm the order before a
   * rider is dispatched. Returns a structured OrderStatus so the rest of the
   * app never has to deal with raw call transcripts.
   */
  async confirmOrder(order: CreateOrderDto, orderId: string): Promise<CallVerificationResult> {
    // CALL-E's current API has no separate `recipient` field - the phone
    // number is inferred directly from the task text (see
    // docs.heycall-e.com/calls: "recipients is optional. When it is
    // omitted, include the phone target in task and CALL-E will infer it.")
    const input: DispatchCallRequest = {
      task: this.buildTaskPrompt(order),
      resultSchema: ORDER_CONFIRMATION_RESULT_SCHEMA,
      metadata: {
        source: 'dispatchcheck',
        orderId,
        itemDescription: order.itemDescription,
      },
    };

    this.logger.log(
      `Placing confirmation call to ${order.phoneNumber} for order: ${order.itemDescription}`,
    );

    // `as any`: see DispatchCallRequest comment above - the installed
    // package's createAndWait(input: CreateCallInput) type is stale and
    // would force us to send a field the live API rejects.
    //
    // We deliberately do NOT use the SDK's createAndWait() convenience
    // method here. It bundles call creation and result-polling into one
    // call, so a transient network error partway through polling (e.g. a
    // dropped "fetch failed") throws away the call.id along with it - even
    // though the call itself may have completed fine on CALL-E's side. By
    // creating first and polling separately, a polling hiccup can retry
    // against the SAME call instead of silently losing track of a real,
    // possibly-successful phone call.
    const created: Call = await this.calle.calls.create(input as any, {
      idempotencyKey: `dispatchcheck_order_${orderId}`,
    });

    this.logger.log(`Call ${created.id} created, waiting for result...`);

    const call = await this.waitForResultWithRetry(created.id);

    this.logger.log(
      `Call ${call.id} finished with status=${call.status} structuredResult=${JSON.stringify(
        call.structuredResult,
      )}`,
    );

    return this.interpretResult(call);
  }

  /**
   * Polls for the terminal call result, retrying on transient network
   * errors (e.g. "fetch failed") rather than giving up on the first one.
   * The call itself keeps running on CALL-E's side regardless of whether
   * our polling connection drops, so retrying against the same call.id is
   * always safe and never re-dials the customer.
   */
  private async waitForResultWithRetry(callId: string, maxAttempts = 3): Promise<Call> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.calle.calls.waitForResult(callId, {
          timeoutMs: 120_000,
          intervalMs: 2_000,
        });
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `waitForResult attempt ${attempt}/${maxAttempts} failed for call ${callId}: ${
            (err as Error).message
          }`,
        );
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        }
      }
    }

    // Polling never succeeded - fall back to a single direct read of
    // whatever state the call is actually in right now. This still beats
    // assuming UNREACHABLE outright, since the call may already be done.
    this.logger.warn(
      `Polling failed ${maxAttempts}x for call ${callId}, falling back to a direct GET.`,
    );
    try {
      return await this.calle.calls.get(callId);
    } catch (err) {
      this.logger.error(
        `Direct GET also failed for call ${callId}: ${(err as Error).message}. ` +
          `Original polling error: ${(lastError as Error)?.message}`,
      );
      throw lastError;
    }
  }

  private buildTaskPrompt(order: CreateOrderDto): string {
    return [
      `Call ${order.phoneNumber} to confirm an order before it is dispatched for delivery.`,
      `Ask for ${order.customerName}.`,
      `Order: ${order.itemDescription}, price ${order.price} ${order.currency ?? 'NGN'}.`,
      `Delivery address on file: ${order.deliveryAddress}.`,
      `Politely confirm: `,
      `(1) they still want this order, `,
      `(2) the delivery address above is correct, `,
      `(3) they will be available to receive it today.`,
      `If they no longer want the order, ask for a one-sentence reason and end the call politely.`,
      `If the address is wrong, ask them to state the correct address in full.`,
      `Keep the call short and friendly.`,
    ].join(' ');
  }

  /**
   * Prefers the structured result CALL-E's agent explicitly filled in.
   * Falls back to the call-level status for calls that never connected
   * (no answer, switched off, provider failure) - those never get a
   * structuredResult at all, and per the docs it comes back as null.
   */
  private interpretResult(call: Call): CallVerificationResult {
    const structured = call.structuredResult as
      | { outcome?: string; correctedAddress?: string; declineReason?: string }
      | null;

    if (structured?.outcome === 'confirmed') {
      return {
        status: OrderStatus.CONFIRMED,
        rawCallStatus: call.status,
        summary: call.summary ?? '',
      };
    }
    if (structured?.outcome === 'declined') {
      return {
        status: OrderStatus.DECLINED,
        rawCallStatus: call.status,
        summary: call.summary ?? '',
        declineReason: structured.declineReason,
      };
    }
    if (structured?.outcome === 'address_mismatch') {
      return {
        status: OrderStatus.ADDRESS_MISMATCH,
        rawCallStatus: call.status,
        summary: call.summary ?? '',
        correctedAddress: structured.correctedAddress,
      };
    }

    // outcome is 'unknown', structuredResult is null, or the call never
    // connected. Fail safe: never let an unconfirmed order look dispatchable.
    this.logger.warn(
      `Call ${call.id} produced no confirmed outcome (status=${call.status}, ` +
        `structuredResult=${JSON.stringify(call.structuredResult)}). Treating as UNREACHABLE.`,
    );
    return {
      status: OrderStatus.UNREACHABLE,
      rawCallStatus: call.status,
      summary: call.summary ?? 'No answer or call could not be completed.',
    };
  }
}