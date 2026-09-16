import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  EvidenceCustodyError,
  type EvidenceCustodyPort,
  type TranscriptCustodyMetadata,
} from "@muster/application";

const referencePattern = /^local-transcript:\/\/([A-Za-z0-9_-]{32})$/u;
const operationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function objectName(identifier: string): string {
  return `${identifier}.transcript`;
}

function providerTaskObjectName(operationId: string): string {
  return `${sha256(Buffer.from(operationId, "utf8"))}.provider-task`;
}

class LocalTranscriptCustody implements EvidenceCustodyPort {
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly rootDirectory: string,
    private readonly maxTranscriptBytes: number,
    private readonly maxEntries: number,
  ) {}

  public async writeProviderTaskReference(input: {
    readonly operationId: string;
    readonly providerTaskId: string;
  }): Promise<void> {
    const operation = async (): Promise<void> => {
      if (
        !operationIdPattern.test(input.operationId) ||
        !operationIdPattern.test(input.providerTaskId)
      ) {
        throw new EvidenceCustodyError("invalid_input");
      }
      const body = Buffer.from(input.providerTaskId, "utf8");
      try {
        await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
        const finalPath = join(this.rootDirectory, providerTaskObjectName(input.operationId));
        try {
          const existing = await readFile(finalPath);
          if (existing.equals(body)) return;
          throw new EvidenceCustodyError("integrity_mismatch");
        } catch (error: unknown) {
          if (error instanceof EvidenceCustodyError) throw error;
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const entries = (await readdir(this.rootDirectory)).filter((name) =>
          name.endsWith(".provider-task"),
        );
        if (entries.length >= this.maxEntries) {
          throw new EvidenceCustodyError("capacity_unavailable");
        }
        const temporaryPath = `${finalPath}.${randomBytes(8).toString("hex")}.tmp`;
        let renamed = false;
        try {
          const handle = await open(temporaryPath, "wx", 0o600);
          try {
            await handle.writeFile(body);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(temporaryPath, finalPath);
          renamed = true;
        } finally {
          if (!renamed) await rm(temporaryPath, { force: true });
        }
      } catch (error: unknown) {
        if (error instanceof EvidenceCustodyError) throw error;
        throw new EvidenceCustodyError("evidence_unavailable");
      }
    };
    const pending = this.writeQueue.then(operation, operation);
    this.writeQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    await pending;
  }

  public async readProviderTaskReference(input: { readonly operationId: string }): Promise<string> {
    if (!operationIdPattern.test(input.operationId)) {
      throw new EvidenceCustodyError("invalid_input");
    }
    try {
      const body = await readFile(
        join(this.rootDirectory, providerTaskObjectName(input.operationId)),
      );
      const providerTaskId = body.toString("utf8");
      if (!operationIdPattern.test(providerTaskId)) {
        throw new EvidenceCustodyError("integrity_mismatch");
      }
      return providerTaskId;
    } catch (error: unknown) {
      if (error instanceof EvidenceCustodyError) throw error;
      throw new EvidenceCustodyError("evidence_unavailable");
    }
  }

  public async write(input: {
    readonly operationId: string;
    readonly transcript: string;
  }): Promise<TranscriptCustodyMetadata> {
    // Serialize the bounded capacity check with publication so concurrent writes cannot
    // over-admit the local store within this custody instance.
    const operation = async (): Promise<TranscriptCustodyMetadata> => {
      if (!operationIdPattern.test(input.operationId) || input.transcript.length === 0) {
        throw new EvidenceCustodyError("invalid_input");
      }
      const body = Buffer.from(input.transcript, "utf8");
      if (body.byteLength > this.maxTranscriptBytes) {
        throw new EvidenceCustodyError("invalid_input");
      }
      try {
        await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
        const entries = (await readdir(this.rootDirectory)).filter((name) =>
          name.endsWith(".transcript"),
        );
        if (entries.length >= this.maxEntries) {
          throw new EvidenceCustodyError("capacity_unavailable");
        }
        const identifier = randomBytes(24).toString("base64url");
        const finalPath = join(this.rootDirectory, objectName(identifier));
        const temporaryPath = `${finalPath}.${randomBytes(8).toString("hex")}.tmp`;
        let renamed = false;
        try {
          const handle = await open(temporaryPath, "wx", 0o600);
          try {
            await handle.writeFile(body);
            await handle.sync();
          } finally {
            await handle.close();
          }
          // Publish only a fully written and flushed object; failed writes leave no readable reference.
          await rename(temporaryPath, finalPath);
          renamed = true;
        } finally {
          if (!renamed) await rm(temporaryPath, { force: true });
        }
        return Object.freeze({
          opaqueReference: `local-transcript://${identifier}`,
          integritySha256: sha256(body),
          byteLength: body.byteLength,
        });
      } catch (error) {
        if (error instanceof EvidenceCustodyError) throw error;
        throw new EvidenceCustodyError("evidence_unavailable");
      }
    };

    const pending = this.writeQueue.then(operation, operation);
    this.writeQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return await pending;
  }

  public async read(metadata: TranscriptCustodyMetadata): Promise<string> {
    const match = referencePattern.exec(metadata.opaqueReference);
    if (
      match === null ||
      !/^[0-9a-f]{64}$/u.test(metadata.integritySha256) ||
      !Number.isSafeInteger(metadata.byteLength) ||
      metadata.byteLength < 1 ||
      metadata.byteLength > this.maxTranscriptBytes
    ) {
      throw new EvidenceCustodyError("invalid_input");
    }
    const identifier = match[1];
    if (identifier === undefined) throw new EvidenceCustodyError("invalid_input");
    let body: Buffer;
    try {
      body = await readFile(join(this.rootDirectory, objectName(identifier)));
    } catch {
      throw new EvidenceCustodyError("evidence_unavailable");
    }
    if (body.byteLength !== metadata.byteLength || sha256(body) !== metadata.integritySha256) {
      throw new EvidenceCustodyError("integrity_mismatch");
    }
    return body.toString("utf8");
  }
}

export function createLocalTranscriptCustody(input: {
  readonly rootDirectory: string;
  readonly maxTranscriptBytes: number;
  readonly maxEntries: number;
}): EvidenceCustodyPort {
  if (
    !isAbsolute(input.rootDirectory) ||
    !Number.isSafeInteger(input.maxTranscriptBytes) ||
    input.maxTranscriptBytes < 1 ||
    input.maxTranscriptBytes > 1_048_576 ||
    !Number.isSafeInteger(input.maxEntries) ||
    input.maxEntries < 1 ||
    input.maxEntries > 10_000
  ) {
    throw new EvidenceCustodyError("invalid_input");
  }
  return new LocalTranscriptCustody(
    input.rootDirectory,
    input.maxTranscriptBytes,
    input.maxEntries,
  );
}
