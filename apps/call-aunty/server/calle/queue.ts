export type CallQueueItem = {
  taskId: string;
  priority: number;
  queuedAt: string;
  nextAttemptAt: string;
  lockOwner: string | null;
  lockExpiresAt: string | null;
  retryCount: number;
  deadLetterReason: string | null;
};

export type QueueClock = () => number;
export type QueueHealth = {
  queued: number;
  locked: number;
  deadLetter: number;
  ready: number;
};

export function createCallQueue(opts?: { clock?: QueueClock; leaseMs?: number }) {
  const clock = opts?.clock ?? (() => Date.now());
  const leaseMs = opts?.leaseMs ?? 30_000;
  const items = new Map<string, CallQueueItem>();

  function enqueue(input: {
    taskId: string;
    priority?: number;
    delayMs?: number;
    retryCount?: number;
  }): CallQueueItem {
    const now = clock();
    const existing = items.get(input.taskId);
    if (existing && !existing.deadLetterReason) {
      return existing;
    }
    const item: CallQueueItem = {
      taskId: input.taskId,
      priority: input.priority ?? 100,
      queuedAt: new Date(now).toISOString(),
      nextAttemptAt: new Date(now + (input.delayMs ?? 0)).toISOString(),
      lockOwner: null,
      lockExpiresAt: null,
      retryCount: input.retryCount ?? 0,
      deadLetterReason: null,
    };
    items.set(input.taskId, item);
    return item;
  }

  function claim(owner: string): CallQueueItem | null {
    const now = clock();
    const ready = [...items.values()]
      .filter((item) => {
        if (item.deadLetterReason) return false;
        const locked = item.lockExpiresAt && Date.parse(item.lockExpiresAt) > now;
        if (locked) return false;
        return Date.parse(item.nextAttemptAt) <= now;
      })
      .sort((a, b) => a.priority - b.priority || Date.parse(a.queuedAt) - Date.parse(b.queuedAt));

    const next = ready[0];
    if (!next) return null;
    next.lockOwner = owner;
    next.lockExpiresAt = new Date(now + leaseMs).toISOString();
    items.set(next.taskId, next);
    return { ...next };
  }

  function complete(taskId: string) {
    items.delete(taskId);
  }

  function deadLetter(taskId: string, reason: string) {
    const item = items.get(taskId);
    if (!item) return;
    item.deadLetterReason = reason;
    item.lockOwner = null;
    item.lockExpiresAt = null;
    items.set(taskId, item);
  }

  function release(taskId: string, delayMs = 0) {
    const item = items.get(taskId);
    if (!item) return;
    const now = clock();
    item.lockOwner = null;
    item.lockExpiresAt = null;
    item.retryCount += 1;
    item.nextAttemptAt = new Date(now + delayMs).toISOString();
    items.set(taskId, item);
  }

  function health(): QueueHealth {
    const now = clock();
    let queued = 0;
    let locked = 0;
    let deadLetterCount = 0;
    let ready = 0;
    for (const item of items.values()) {
      if (item.deadLetterReason) {
        deadLetterCount += 1;
        continue;
      }
      queued += 1;
      const isLocked = Boolean(item.lockExpiresAt && Date.parse(item.lockExpiresAt) > now);
      if (isLocked) locked += 1;
      else if (Date.parse(item.nextAttemptAt) <= now) ready += 1;
    }
    return { queued, locked, deadLetter: deadLetterCount, ready };
  }

  /** Safe admin view — task IDs only, no phones/transcripts. */
  function debugSnapshot() {
    return {
      health: health(),
      items: [...items.values()].map((item) => ({
        taskId: item.taskId,
        priority: item.priority,
        retryCount: item.retryCount,
        deadLetterReason: item.deadLetterReason,
        locked: Boolean(item.lockOwner),
        nextAttemptAt: item.nextAttemptAt,
      })),
    };
  }

  function reset() {
    items.clear();
  }

  return { enqueue, claim, complete, deadLetter, release, health, debugSnapshot, reset };
}

export type CallQueue = ReturnType<typeof createCallQueue>;
