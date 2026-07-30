/**
 * Attempt reservations.
 *
 * Two runs of one request must not invent two secrets for one provider
 * idempotency key. A retried step or two jobs racing would otherwise expect a
 * code the approver was never shown, read the call back as a code mismatch and
 * walk down the ladder while the first call is still live. So the first run to
 * create the reservation owns the attempt and every later run reads that run's
 * secret back out of it. The file is created with O_CREAT and O_EXCL, so the
 * filesystem decides the winner instead of a read-then-write race.
 *
 * A reservation belongs to one request content. The digest in its name covers
 * the change, the policy and the approver, so an edited request reserves afresh
 * rather than adopting a secret that belongs to a different call.
 *
 * The secret is stored in clear, with mode 0600, beside the audit file. It is
 * single use, it expires with the window and it is already printed on the
 * request channel the approver reads, so the file is no weaker than the channel
 * itself. It is state for one request, not a keystore: delete the directory when
 * the request is done.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { digestOf } from "./audit.js";
import type { CallSecret } from "./script.js";

export const STATE_DIR_NAME = ".phone-approval-gate";

export interface Reservation {
  request_id: string;
  approver_id: string;
  attempt: number;
  content_digest: string;
  code: string;
  phrase: string[];
  reserved_at: string;
}

export interface ReserveResult {
  secret: CallSecret;
  reservedAt: string;
  /** True when this run created the reservation, false when it adopted one. */
  owned: boolean;
  path: string | null;
}

/**
 * Where reservations live when the caller did not name a directory. Next to the
 * audit file, because that is the path an operator already keeps per run.
 */
export function defaultStateDir(auditPath: string | null): string {
  return auditPath === null
    ? join(tmpdir(), "phone-approval-gate")
    : join(dirname(auditPath), STATE_DIR_NAME);
}

function reservationPath(options: {
  dir: string;
  requestId: string;
  approverId: string;
  attempt: number;
  contentDigest: string;
}): string {
  const short = options.contentDigest.slice("sha256:".length, "sha256:".length + 12);
  return join(
    options.dir,
    options.requestId,
    `${options.approverId}-${options.attempt}-${short}.json`,
  );
}

function readReservation(path: string): Reservation {
  // Every reservation this app writes is created 0600, so a wider mode means
  // something else made this file. It holds a live code in clear, so it is
  // refused rather than adopted and rather than quietly chmodded.
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `Reservation ${path} is mode 0${mode.toString(8)}, which other accounts can read. It holds the approval code in clear, so it was not adopted. Delete it once the call under its idempotency key is settled, then run again.`,
    );
  }
  const record = JSON.parse(readFileSync(path, "utf8")) as Reservation;
  if (typeof record.code !== "string" || !Array.isArray(record.phrase)) {
    throw new Error(
      `Reservation ${path} does not hold a secret. Delete it once the call under its idempotency key is settled, then run again.`,
    );
  }
  return record;
}

/**
 * Reserve the secret for one attempt or adopt the one already reserved.
 *
 * A null directory turns reservations off, which is what a unit test wants and
 * what a single run on a throwaway filesystem gets.
 */
export function reserveSecret(options: {
  dir: string | null;
  requestId: string;
  approverId: string;
  attempt: number;
  /** Everything that decides what this call says. A change to it reserves afresh. */
  content: unknown;
  secret: CallSecret;
  reservedAt: string;
}): ReserveResult {
  if (options.dir === null) {
    return { secret: options.secret, reservedAt: options.reservedAt, owned: true, path: null };
  }
  const contentDigest = digestOf(options.content);
  const path = reservationPath({
    dir: options.dir,
    requestId: options.requestId,
    approverId: options.approverId,
    attempt: options.attempt,
    contentDigest,
  });
  const reservation: Reservation = {
    request_id: options.requestId,
    approver_id: options.approverId,
    attempt: options.attempt,
    content_digest: contentDigest,
    code: options.secret.code,
    phrase: options.secret.phrase,
    reserved_at: options.reservedAt,
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, `${JSON.stringify(reservation, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return { secret: options.secret, reservedAt: options.reservedAt, owned: true, path };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  const held = readReservation(path);
  return {
    secret: { code: held.code, phrase: held.phrase },
    reservedAt: held.reserved_at,
    owned: false,
    path,
  };
}
