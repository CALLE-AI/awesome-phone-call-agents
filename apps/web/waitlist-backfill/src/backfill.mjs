/**
 * The backfill run loop.
 *
 * One appointment slot opens up. We ring the waitlist ONE AT A TIME and stop at the first person
 * who says yes.
 *
 * Why sequential, when the CALL-E API supports multi-recipient fan-out in a single call task:
 * fan-out is the wrong behaviour for a single slot. Ringing twelve people about one appointment
 * means eleven of them are told about something that is already gone, or worse, several are told
 * yes. There is exactly one slot, so there is exactly one call in flight, and every person behind
 * the acceptance is never called at all. That suppression is the feature.
 */

import { evaluateContact, maskPhone, requireLiveIntent } from "./guardrails.mjs";
import { buildTask } from "./calle.mjs";

/**
 * Deterministic idempotency key. Re-running the same slot against the same contact will not
 * produce a second call, which matters because the obvious operator reaction to a hung run is to
 * press the button again.
 */
export function idempotencyKey(slot, contact, attempt = 1) {
  return `backfill:${slot.id}:${contact.id}:${attempt}`;
}

/**
 * @param {object}   args
 * @param {object}   args.slot        the appointment that opened up
 * @param {object[]} args.waitlist    contacts in priority order
 * @param {object}   args.policy      quiet hours, consent scope, frequency caps
 * @param {object[]} args.history     prior completed calls, for the frequency cap
 * @param {object}   args.client      FakeCalleClient or LiveCalleClient
 * @param {object}   args.request     { mode: "preview"|"live", confirmSlotId }
 * @param {string}   args.message     operator-supplied wording
 * @param {Function} [args.isCancelled] polled before each call; P6 cancellation
 * @param {Function} [args.onEvent]   streamed to the UI
 * @param {Date}     [args.now]
 */
export async function runBackfill({
  slot,
  waitlist,
  policy,
  history = [],
  client,
  request,
  message,
  isCancelled = () => false,
  onEvent = () => {},
  now = new Date(),
}) {
  const events = [];
  const emit = (e) => {
    const withTime = { at: new Date().toISOString(), ...e };
    events.push(withTime);
    onEvent(withTime);
    return withTime;
  };

  const intent = requireLiveIntent(request, slot);
  const live = intent.allowed;

  emit({
    type: "run_started",
    slotId: slot.id,
    mode: live ? "live" : "preview",
    transport: client.mode,
    waitlistSize: waitlist.length,
    // Never claim a phone will ring when the transport is fake, and never claim it will not when
    // the transport is real. The transport is the authority here, not the requested mode.
    detail: !live
      ? intent.detail
      : client.mode === "live"
        ? "Live mode confirmed. Real calls will be placed."
        : "Simulated run: the full loop against a fake transport. No real calls are placed.",
  });

  let filledBy = null;
  let callsPlaced = 0;
  const runHistory = [...history];

  for (const [index, contact] of waitlist.entries()) {
    if (filledBy) {
      emit({
        type: "contact_suppressed",
        contactId: contact.id,
        name: contact.name,
        phone: maskPhone(contact.phone),
        position: index + 1,
        code: "slot_already_filled",
        detail: `Slot filled by ${filledBy.name}. This person was never called.`,
      });
      continue;
    }

    if (isCancelled()) {
      emit({
        type: "run_cancelled",
        code: "operator_cancelled",
        detail: `Cancelled before calling position ${index + 1}. No further calls.`,
      });
      return summarise({ events, filledBy, callsPlaced, cancelled: true, slot, waitlist });
    }

    const verdict = evaluateContact({ contact, slot, policy, history: runHistory, at: now, message });
    if (!verdict.callable) {
      emit({
        type: "contact_skipped",
        contactId: contact.id,
        name: contact.name,
        phone: maskPhone(contact.phone),
        position: index + 1,
        code: verdict.reason.code,
        detail: verdict.reason.detail,
        checks: verdict.checks,
      });
      continue;
    }

    if (!live) {
      emit({
        type: "contact_would_call",
        contactId: contact.id,
        name: contact.name,
        phone: maskPhone(contact.phone),
        position: index + 1,
        code: "preview_only",
        detail: "Passed every guardrail. In live mode this person would be called now.",
        checks: verdict.checks,
      });
      // In preview we cannot know the answer, so we do not guess one. Previewing the whole
      // waitlist is more useful than pretending the first person accepts.
      continue;
    }

    const key = idempotencyKey(slot, contact);
    emit({
      type: "call_started",
      contactId: contact.id,
      name: contact.name,
      phone: maskPhone(contact.phone),
      position: index + 1,
      idempotencyKey: key,
    });

    let result;
    try {
      result = await client.placeCall({
        task: buildTask({ slot, contact, message }),
        contact,
        metadata: { slotId: slot.id, contactId: contact.id, app: "waitlist-backfill" },
        idempotencyKey: key,
      });
    } catch (err) {
      emit({
        type: "call_failed",
        contactId: contact.id,
        name: contact.name,
        phone: maskPhone(contact.phone),
        position: index + 1,
        code: "transport_error",
        detail: String(err.message ?? err),
      });
      continue;
    }

    callsPlaced += 1;
    runHistory.push({ contactId: contact.id, at: new Date().toISOString() });

    const answer = result.structuredResult?.can_take_slot ?? null;
    emit({
      type: "call_completed",
      contactId: contact.id,
      name: contact.name,
      phone: maskPhone(contact.phone),
      position: index + 1,
      callId: result.id,
      status: result.status,
      answer,
      summary: result.summary,
      failureCode: result.failureCode ?? null,
    });

    if (answer === "yes") {
      filledBy = contact;
      emit({
        type: "slot_filled",
        contactId: contact.id,
        name: contact.name,
        phone: maskPhone(contact.phone),
        position: index + 1,
        detail: `${contact.name} accepted. Every remaining person will NOT be called.`,
      });
    }
  }

  return summarise({ events, filledBy, callsPlaced, cancelled: false, slot, waitlist });
}

function summarise({ events, filledBy, callsPlaced, cancelled, slot, waitlist }) {
  const suppressed = events.filter((e) => e.type === "contact_suppressed").length;
  const skipped = events.filter((e) => e.type === "contact_skipped").length;
  return {
    slotId: slot.id,
    filled: Boolean(filledBy),
    filledBy: filledBy ? { id: filledBy.id, name: filledBy.name, phone: maskPhone(filledBy.phone) } : null,
    cancelled,
    callsPlaced,
    callsAvoided: waitlist.length - callsPlaced,
    suppressed,
    skipped,
    events,
  };
}
