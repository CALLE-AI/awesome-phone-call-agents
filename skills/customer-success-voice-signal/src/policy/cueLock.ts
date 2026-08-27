import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { cueDedupeKey } from "../policy/shouldRing.js";
import type { AccountEvent } from "../schemas.js";

const DEFAULT_TTL_MS = 10 * 60_000;

export interface CueReservation {
  key: string;
  path: string;
  release: () => Promise<void>;
}

function lockPath(dataDir: string, key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9:_-]/g, "_");
  return path.join(dataDir, "locks", `${safe}.lock`);
}

async function isStale(file: string, ttlMs: number, now: number): Promise<boolean> {
  try {
    const raw = await readFile(file, "utf8");
    const row = JSON.parse(raw) as { at?: string };
    if (!row.at) return true;
    return now - new Date(row.at).getTime() > ttlMs;
  } catch {
    try {
      const s = await stat(file);
      return now - s.mtimeMs > ttlMs;
    } catch {
      return true;
    }
  }
}

/**
 * Exclusive per-cue reservation before a live dial (open wx).
 * Stale locks past TTL are cleared once, then retry.
 */
export async function reserveCue(args: {
  dataDir: string;
  event: AccountEvent;
  ttlMs?: number;
  now?: Date;
}): Promise<
  | { ok: true; reservation: CueReservation }
  | { ok: false; reason: string }
> {
  const key = cueDedupeKey(args.event);
  const dir = path.join(args.dataDir, "locks");
  await mkdir(dir, { recursive: true });
  const file = lockPath(args.dataDir, key);
  const ttlMs = args.ttlMs ?? DEFAULT_TTL_MS;
  const now = args.now ?? new Date();
  const payload = JSON.stringify({
    at: now.toISOString(),
    key,
    pid: process.pid,
    trigger_id: args.event.trigger_id,
    account_id: args.event.account.id,
  });

  const tryCreate = async (): Promise<boolean> => {
    try {
      const fh = await open(file, "wx");
      await fh.writeFile(payload, "utf8");
      await fh.close();
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return false;
      throw err;
    }
  };

  if (await tryCreate()) {
    return {
      ok: true,
      reservation: {
        key,
        path: file,
        release: async () => {
          await rm(file, { force: true });
        },
      },
    };
  }

  if (await isStale(file, ttlMs, now.getTime())) {
    await rm(file, { force: true });
    if (await tryCreate()) {
      return {
        ok: true,
        reservation: {
          key,
          path: file,
          release: async () => {
            await rm(file, { force: true });
          },
        },
      };
    }
  }

  return {
    ok: false,
    reason: `Cue already reserved (${key}). Another live attempt is in progress.`,
  };
}

/** After a confirmed dial, drop the lock — cue-history owns dedupe. */
export async function releaseCueReservation(
  reservation: CueReservation | null | undefined,
): Promise<void> {
  if (!reservation) return;
  await reservation.release();
}

/** Test helper: mark a lock file as older than TTL via rewrite. */
export async function rewriteLockTimestamp(
  file: string,
  at: string,
): Promise<void> {
  const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify({ ...raw, at }), "utf8");
  await rename(tmp, file);
}
