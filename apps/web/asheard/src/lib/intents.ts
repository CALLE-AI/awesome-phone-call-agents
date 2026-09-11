/**
 * The demo's own intent ledger, which is the thing the library has always said
 * you need and this app was not using.
 *
 * The old route built its idempotency key out of the destination, the question
 * and `Date.now()`. A key with the clock in it is derived from the attempt, not
 * from the authorization, so every retry of one press looks like a new call and
 * the phone can ring twice. `docs/DECISIONS.md` says exactly that about the
 * probe runner, in this repo, in our own words. The demo was the one place
 * still doing it.
 *
 * So: write the intent down before dialling, key it on what was authorized,
 * and refuse to dial anything that is not in `reserved`. `isDialBlocked` from
 * the package is the whole gate. A record that reached `submission_unknown`
 * has no edge back, because once a request may have been accepted there is no
 * honest way to pretend it was not.
 *
 * The store is Redis because the app already has one and an intent has to
 * outlive a serverless invocation. Reservation is a single `SET NX`, so two
 * requests racing the same key cannot both win.
 */

import {
  assertTransition,
  deriveIdempotencyKey,
  type Authorization,
  type Channel,
  type Intent,
  type IntentState,
} from "asheard/ledger";

/** How the store talks to Redis. Injected so tests need no network. */
export type Exec = (commands: unknown[][]) => Promise<unknown[]>;

/**
 * Intents outlive the day's budget on purpose.
 *
 * A visitor who reloads an hour later should meet their own record rather than
 * a clean slate that would dial again.
 */
const TTL_SECONDS = 172800;

const KEY_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

/** Reject anything that is not a plausible client-minted intent key. */
export function validIntentKey(value: unknown): value is string {
  return typeof value === "string" && KEY_SHAPE.test(value);
}

function intentKeyOf(idempotencyKey: string): string {
  return `demo:intent:${idempotencyKey}`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function parse(raw: unknown): Intent | null {
  const text = asString(raw);
  if (text === null) return null;
  try {
    return JSON.parse(text) as Intent;
  } catch {
    return null;
  }
}

export interface Reservation {
  intent: Intent;
  /** False when this key already had a record, whatever state it is in. */
  fresh: boolean;
}

/**
 * The subset of `IntentStore` this app needs, on Redis.
 *
 * Not the recovery-secret half: the demo goes out over the Calls API, which
 * hands back a call id synchronously and has no plan/confirm pair to stash.
 * Implementing those two methods with something that is not a secret store
 * would be worse than not having them.
 */
export class RedisIntents {
  private readonly exec: Exec;

  constructor(exec: Exec) {
    this.exec = exec;
  }

  /**
   * Write the intent down, or hand back the one that is already there.
   *
   * `SET NX` decides the winner, and the loser reads rather than writes, so a
   * double submit resolves to one record instead of two.
   */
  async reserve(auth: Authorization, channel: Channel): Promise<Reservation> {
    const idempotencyKey = deriveIdempotencyKey(auth, channel);
    const key = intentKeyOf(idempotencyKey);
    const now = new Date().toISOString();

    const intent: Intent = {
      id: `int_${idempotencyKey.slice(-20)}`,
      idempotencyKey,
      channel,
      authorization: { ...auth },
      state: "reserved",
      boundId: null,
      reasons: [],
      createdAt: now,
      updatedAt: now,
    };

    const [written] = await this.exec([
      ["SET", key, JSON.stringify(intent), "NX", "EX", String(TTL_SECONDS)],
    ]);

    if (asString(written) === "OK") return { intent, fresh: true };

    const [raw] = await this.exec([["GET", key]]);
    const existing = parse(raw);
    if (existing === null) {
      // The key exists but does not parse, which should not happen. Treat it as
      // occupied rather than overwriting it: an unreadable record is still a
      // record that something was authorized.
      throw new Error("An intent is recorded under this key but could not be read.");
    }
    return { intent: existing, fresh: false };
  }

  async find(auth: Authorization, channel: Channel): Promise<Intent | null> {
    const [raw] = await this.exec([["GET", intentKeyOf(deriveIdempotencyKey(auth, channel))]]);
    return parse(raw);
  }

  /**
   * Move the record on.
   *
   * The transition is checked by the package, so an illegal move throws here
   * rather than being written and discovered later. Rebinding a bound intent to
   * a different call id throws for the same reason: that is two calls wearing
   * one authorization.
   */
  async advance(
    intent: Intent,
    to: IntentState,
    patch: { boundId?: string; reasons?: string[] } = {},
  ): Promise<Intent> {
    assertTransition(intent.state, to);

    if (patch.boundId && intent.boundId && patch.boundId !== intent.boundId) {
      throw new Error(
        `Intent ${intent.id} is already bound to ${intent.boundId} and cannot be rebound.`,
      );
    }

    const next: Intent = {
      ...intent,
      state: to,
      boundId: patch.boundId ?? intent.boundId,
      reasons: patch.reasons ?? intent.reasons,
      updatedAt: new Date().toISOString(),
    };

    await this.exec([
      ["SET", intentKeyOf(intent.idempotencyKey), JSON.stringify(next), "EX", String(TTL_SECONDS)],
    ]);
    return next;
  }
}

/**
 * What the browser is told about an intent it cannot dial.
 *
 * Deliberately says what is known and what is not. "It may have gone out" is
 * the honest answer to a submission whose outcome was never returned, and a
 * demo about not overstating a call's ending should not overstate this either.
 */
export function haltReason(intent: Intent): string {
  switch (intent.state) {
    case "submission_unknown":
      return "That request was already sent once and CALL-E never said whether it landed, so this will not send it again. The call may or may not have gone out.";
    case "needs_human":
      return intent.reasons[0] ?? "This request stopped for a person to look at, so it will not be sent again.";
    default:
      return "That request has already been placed.";
  }
}
