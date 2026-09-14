import { randomUUID } from "node:crypto";

import type { CallCreditReservation } from "./types";

type LedgerEntry = {
  entryId: string;
  userId: number;
  delta: number;
  reason: "grant" | "reservation" | "consumption" | "release" | "refund" | "expiration";
  workflowId?: string;
  reservationId?: string;
  idempotencyKey: string;
  at: string;
};

const balanceByUser = new Map<number, number>();
const reservations = new Map<string, CallCreditReservation>();
const ledger: LedgerEntry[] = [];

export function resetCallCreditLedger() {
  balanceByUser.clear();
  reservations.clear();
  ledger.length = 0;
}

export function grantCallCredits(input: {
  userId: number;
  amount: number;
  idempotencyKey: string;
  reason?: string;
}): { balance: number; duplicated: boolean } {
  const dup = ledger.some((e) => e.idempotencyKey === input.idempotencyKey);
  if (dup) return { balance: getCallCreditBalance(input.userId), duplicated: true };
  const balance = (balanceByUser.get(input.userId) ?? 0) + input.amount;
  balanceByUser.set(input.userId, balance);
  ledger.push({
    entryId: randomUUID().replace(/-/g, "").slice(0, 20),
    userId: input.userId,
    delta: input.amount,
    reason: "grant",
    idempotencyKey: input.idempotencyKey,
    at: new Date().toISOString(),
  });
  return { balance, duplicated: false };
}

export function getCallCreditBalance(userId: number): number {
  return balanceByUser.get(userId) ?? 0;
}

export function reserveCallCredits(input: {
  userId: number;
  workflowId: string;
  amount?: number;
  idempotencyKey: string;
}): { ok: true; reservation: CallCreditReservation } | { ok: false; code: "insufficient_credits" } {
  const amount = input.amount ?? 1;
  const existing = [...reservations.values()].find(
    (r) => r.idempotencyKey === input.idempotencyKey && r.userId === input.userId,
  );
  if (existing) return { ok: true, reservation: existing };

  const balance = getCallCreditBalance(input.userId);
  const reservedPending = [...reservations.values()]
    .filter((r) => r.userId === input.userId && r.status === "reserved")
    .reduce((sum, r) => sum + r.amount, 0);
  if (balance - reservedPending < amount) {
    return { ok: false, code: "insufficient_credits" };
  }

  const now = new Date().toISOString();
  const reservation: CallCreditReservation = {
    reservationId: randomUUID().replace(/-/g, "").slice(0, 24),
    userId: input.userId,
    workflowId: input.workflowId,
    amount,
    status: "reserved",
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
  reservations.set(reservation.reservationId, reservation);
  ledger.push({
    entryId: randomUUID().replace(/-/g, "").slice(0, 20),
    userId: input.userId,
    delta: -amount,
    reason: "reservation",
    workflowId: input.workflowId,
    reservationId: reservation.reservationId,
    idempotencyKey: input.idempotencyKey,
    at: now,
  });
  return { ok: true, reservation };
}

export function consumeCallCreditReservation(input: {
  reservationId: string;
  idempotencyKey: string;
  billableSuccess: boolean;
}): { ok: boolean; code?: string } {
  const reservation = reservations.get(input.reservationId);
  if (!reservation) return { ok: false, code: "reservation_not_found" };
  if (reservation.status !== "reserved") {
    return { ok: true, code: "already_finalized" };
  }
  const dup = ledger.some((e) => e.idempotencyKey === input.idempotencyKey);
  if (dup) return { ok: true, code: "duplicate" };

  const now = new Date().toISOString();
  if (input.billableSuccess) {
    const balance = getCallCreditBalance(reservation.userId);
    balanceByUser.set(reservation.userId, Math.max(0, balance - reservation.amount));
    reservation.status = "consumed";
    ledger.push({
      entryId: randomUUID().replace(/-/g, "").slice(0, 20),
      userId: reservation.userId,
      delta: -reservation.amount,
      reason: "consumption",
      workflowId: reservation.workflowId,
      reservationId: reservation.reservationId,
      idempotencyKey: input.idempotencyKey,
      at: now,
    });
  } else {
    reservation.status = "released";
    ledger.push({
      entryId: randomUUID().replace(/-/g, "").slice(0, 20),
      userId: reservation.userId,
      delta: reservation.amount,
      reason: "release",
      workflowId: reservation.workflowId,
      reservationId: reservation.reservationId,
      idempotencyKey: input.idempotencyKey,
      at: now,
    });
  }
  reservation.updatedAt = now;
  return { ok: true };
}

export function getReservationForWorkflow(workflowId: string): CallCreditReservation | undefined {
  return [...reservations.values()].find((r) => r.workflowId === workflowId);
}

export function getLedgerEntries(userId: number): LedgerEntry[] {
  return ledger.filter((e) => e.userId === userId);
}

/** Billable success: reached beneficiary on a live (non-dry-run) call. */
export function isBillableCallSuccess(status: string, dryRun: boolean): boolean {
  if (dryRun) return false;
  return status === "completed" || status === "no_answer";
}
