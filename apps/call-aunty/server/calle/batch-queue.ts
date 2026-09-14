export type QueueJob<T> = {
  id: string;
  payload: T;
  attempts: number;
  createdAt: string;
};

export class InMemoryCallQueue<T> {
  private q: QueueJob<T>[] = [];

  enqueue(payload: T, id: string) {
    this.q.push({ id, payload, attempts: 0, createdAt: new Date().toISOString() });
    return id;
  }

  size() {
    return this.q.length;
  }

  dequeue() {
    return this.q.shift() ?? null;
  }

  requeue(job: QueueJob<T>) {
    job.attempts += 1;
    this.q.push(job);
  }

  clear() {
    this.q = [];
  }
}

export async function drainQueue<T, R>(
  queue: InMemoryCallQueue<T>,
  worker: (job: QueueJob<T>) => Promise<R>,
) {
  const out: R[] = [];
  for (;;) {
    const job = queue.dequeue();
    if (!job) break;
    out.push(await worker(job));
  }
  return out;
}
