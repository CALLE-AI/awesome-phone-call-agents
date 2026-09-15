import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { link, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import { isAbsolute, join, parse, resolve } from "node:path";

import type {
  LiveDemoReviewCleanupCheckpoint,
  LiveDemoReviewCleanupCheckpointUpdate,
  LiveDemoReviewCleanupCheckpointUpdateResult,
} from "./live-demo-review-session.js";

const checkpointName = /^checkpoint-([1-9][0-9]*)\.json$/u;

export interface LiveDemoReviewCheckpointStore {
  load(): Promise<LiveDemoReviewCleanupCheckpoint | undefined>;
  compareAndSet(
    update: LiveDemoReviewCleanupCheckpointUpdate,
  ): Promise<LiveDemoReviewCleanupCheckpointUpdateResult>;
  removeExactRecoveryIdentity(): Promise<void>;
}

export function createLiveDemoReviewCheckpointStore(input: {
  readonly rootDirectory: string;
  readonly sessionId: string;
  readonly operationId: string;
}): LiveDemoReviewCheckpointStore {
  const rootDirectory = resolve(input.rootDirectory);
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
  if (
    !isAbsolute(input.rootDirectory) ||
    rootDirectory === parse(rootDirectory).root ||
    !identifier.test(input.sessionId) ||
    !identifier.test(input.operationId)
  ) {
    throw new Error("Live demo review checkpoint configuration is invalid");
  }
  const directory = join(rootDirectory, input.sessionId, input.operationId);
  const load = async (): Promise<LiveDemoReviewCleanupCheckpoint | undefined> => {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const latest = names
      .map((name) => ({ name, match: checkpointName.exec(name) }))
      .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
      .toSorted((left, right) => Number(right.match[1]) - Number(left.match[1]))[0];
    if (latest === undefined) return undefined;
    return JSON.parse(
      await readFile(join(directory, latest.name), "utf8"),
    ) as LiveDemoReviewCleanupCheckpoint;
  };
  return Object.freeze({
    load,
    async compareAndSet(
      update: LiveDemoReviewCleanupCheckpointUpdate,
    ): Promise<LiveDemoReviewCleanupCheckpointUpdateResult> {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const current = await load();
      if ((current?.version ?? null) !== update.expectedVersion) {
        return Object.freeze({ outcome: "conflict" as const, checkpoint: current });
      }
      const checkpoint: LiveDemoReviewCleanupCheckpoint = Object.freeze({
        ...update.checkpoint,
        version: (update.expectedVersion ?? 0) + 1,
        cleanupOwnerDigest: update.cleanupOwnerDigest,
      });
      const finalPath = join(directory, `checkpoint-${String(checkpoint.version)}.json`);
      const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporaryPath, "wx", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(checkpoint)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        try {
          await link(temporaryPath, finalPath);
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          return Object.freeze({ outcome: "conflict" as const, checkpoint: await load() });
        }
        return Object.freeze({ outcome: "updated" as const, checkpoint });
      } finally {
        await rm(temporaryPath, { force: true });
      }
    },
    async removeExactRecoveryIdentity(): Promise<void> {
      await rm(directory, { recursive: true, force: true });
    },
  });
}

export async function discoverLiveDemoReviewCheckpoints(input: {
  readonly rootDirectory: string;
}): Promise<readonly LiveDemoReviewCleanupCheckpoint[]> {
  const rootDirectory = resolve(input.rootDirectory);
  if (!isAbsolute(input.rootDirectory) || rootDirectory === parse(rootDirectory).root) {
    throw new Error("Live demo review checkpoint configuration is invalid");
  }
  let sessionDirectories: Dirent[];
  try {
    sessionDirectories = await readdir(rootDirectory, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]);
    throw error;
  }
  const checkpoints: LiveDemoReviewCleanupCheckpoint[] = [];
  for (const sessionDirectory of sessionDirectories) {
    if (!sessionDirectory.isDirectory()) continue;
    const operations = await readdir(join(rootDirectory, sessionDirectory.name), {
      withFileTypes: true,
    });
    for (const operation of operations) {
      if (!operation.isDirectory()) continue;
      const store = createLiveDemoReviewCheckpointStore({
        rootDirectory,
        sessionId: sessionDirectory.name,
        operationId: operation.name,
      });
      const checkpoint = await store.load();
      if (checkpoint?.state === "review_deleted") {
        await store.removeExactRecoveryIdentity();
      } else if (checkpoint !== undefined) {
        checkpoints.push(checkpoint);
      }
    }
  }
  return Object.freeze(checkpoints);
}
