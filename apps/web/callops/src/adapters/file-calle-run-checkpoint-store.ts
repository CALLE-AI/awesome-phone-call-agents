import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { CalleLiveAdapterError } from '../integrations/calle-live-errors';
import {
  cloneCalleRunCheckpoint,
  parseCalleRunCheckpoint,
} from '../integrations/calle-run-checkpoint';
import type {
  CalleRunCheckpointRecord,
  CalleRunCheckpointStore,
} from '../integrations/calle-live-types';

const MAX_CHECKPOINT_BYTES = 4_096;
const SESSION_ID = /^[a-z0-9][a-z0-9-]{2,63}$/u;

function fail(message: string, code: string): never {
  throw new CalleLiveAdapterError(message, code);
}

function pathIsInside(candidate: string, parent: string): boolean {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent));
}

export function calleRunCheckpointFileName(sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) {
    fail('The durable checkpoint session identifier is invalid.', 'INVALID_SESSION_ID');
  }
  const digest = createHash('sha256').update(sessionId, 'utf8').digest('hex');
  return `run-${digest}.json`;
}

export class FileCalleRunCheckpointStore implements CalleRunCheckpointStore {
  private readonly rootDirectory: string;
  private readonly repositoryRoot: string;
  private readonly writes = new Map<string, Promise<void>>();

  public constructor(rootDirectory: string, repositoryRoot: string) {
    if (!isAbsolute(rootDirectory) || !isAbsolute(repositoryRoot)) {
      fail('Durable checkpoint paths must be absolute.', 'RUN_CHECKPOINT_PATH_INVALID');
    }
    this.rootDirectory = resolve(rootDirectory);
    this.repositoryRoot = resolve(repositoryRoot);
    if (pathIsInside(this.rootDirectory, this.repositoryRoot)) {
      fail('Durable run checkpoints must remain outside the repository.', 'RUN_CHECKPOINT_IN_REPOSITORY');
    }
  }

  public async save(sessionId: string, checkpoint: CalleRunCheckpointRecord): Promise<void> {
    const validated = cloneCalleRunCheckpoint(checkpoint);
    const previous = this.writes.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.writeAtomic(sessionId, validated));
    this.writes.set(sessionId, next);
    try {
      await next;
    } finally {
      if (this.writes.get(sessionId) === next) this.writes.delete(sessionId);
    }
  }

  public async load(sessionId: string): Promise<CalleRunCheckpointRecord | null> {
    await (this.writes.get(sessionId) ?? Promise.resolve());
    return this.readPersisted(sessionId);
  }

  private async readPersisted(sessionId: string): Promise<CalleRunCheckpointRecord | null> {
    const filePath = this.filePath(sessionId);
    try {
      const metadata = await stat(filePath);
      if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_CHECKPOINT_BYTES) {
        fail('The durable checkpoint file size is invalid.', 'RUN_CHECKPOINT_FILE_INVALID');
      }
      const text = await readFile(filePath, 'utf8');
      let decoded: unknown;
      try {
        decoded = JSON.parse(text) as unknown;
      } catch {
        fail('The durable checkpoint JSON is corrupt.', 'RUN_CHECKPOINT_JSON_INVALID');
      }
      return parseCalleRunCheckpoint(decoded);
    } catch (error) {
      if (error instanceof CalleLiveAdapterError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new CalleLiveAdapterError(
        'The durable checkpoint could not be read safely.',
        'RUN_CHECKPOINT_READ_FAILED',
      );
    }
  }

  public async has(sessionId: string): Promise<boolean> {
    return (await this.load(sessionId)) !== null;
  }

  public async clear(sessionId: string): Promise<void> {
    await (this.writes.get(sessionId) ?? Promise.resolve());
    try {
      await unlink(this.filePath(sessionId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new CalleLiveAdapterError(
          'The durable checkpoint could not be cleared safely.',
          'RUN_CHECKPOINT_CLEAR_FAILED',
        );
      }
    }
  }

  private filePath(sessionId: string): string {
    return resolve(this.rootDirectory, calleRunCheckpointFileName(sessionId));
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.rootDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail('The durable checkpoint root must be a real directory.', 'RUN_CHECKPOINT_ROOT_INVALID');
    }
    const [actualRoot, actualRepository] = await Promise.all([
      realpath(this.rootDirectory),
      realpath(this.repositoryRoot),
    ]);
    if (pathIsInside(actualRoot, actualRepository)) {
      fail('The resolved checkpoint root is inside the repository.', 'RUN_CHECKPOINT_IN_REPOSITORY');
    }
  }

  private async writeAtomic(
    sessionId: string,
    checkpoint: CalleRunCheckpointRecord,
  ): Promise<void> {
    await this.ensureRoot();
    const existing = await this.readPersisted(sessionId);
    if (existing !== null && checkpoint.revision <= existing.revision) {
      fail('The durable checkpoint revision is stale.', 'RUN_CHECKPOINT_REVISION_STALE');
    }
    const targetPath = this.filePath(sessionId);
    const temporaryPath = resolve(
      this.rootDirectory,
      `.${calleRunCheckpointFileName(sessionId)}.${randomUUID()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(checkpoint)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporaryPath, targetPath);
      await chmod(targetPath, 0o600);
    } catch {
      if (handle !== null) await handle.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw new CalleLiveAdapterError(
        'The durable checkpoint could not be replaced atomically.',
        'RUN_CHECKPOINT_ATOMIC_WRITE_FAILED',
      );
    }
  }
}
