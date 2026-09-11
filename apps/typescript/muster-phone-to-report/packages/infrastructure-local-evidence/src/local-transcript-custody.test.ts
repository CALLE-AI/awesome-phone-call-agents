import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

async function loadFactory(): Promise<
  (input: {
    readonly rootDirectory: string;
    readonly maxTranscriptBytes: number;
    readonly maxEntries: number;
  }) => {
    write(input: { readonly operationId: string; readonly transcript: string }): Promise<{
      readonly opaqueReference: string;
      readonly integritySha256: string;
      readonly byteLength: number;
    }>;
    read(input: {
      readonly opaqueReference: string;
      readonly integritySha256: string;
      readonly byteLength: number;
    }): Promise<string>;
    writeProviderTaskReference(input: {
      readonly operationId: string;
      readonly providerTaskId: string;
    }): Promise<void>;
    readProviderTaskReference(input: { readonly operationId: string }): Promise<string>;
  }
> {
  const module = (await import("./index.js")) as Record<string, unknown>;
  const factory = module["createLocalTranscriptCustody"];
  if (typeof factory !== "function") {
    throw new Error("Phase 2 local transcript custody is not implemented");
  }
  return factory as Awaited<ReturnType<typeof loadFactory>>;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local transcript custody", () => {
  it("atomically stores bounded transcript evidence behind an opaque integrity-checked reference", async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "muster-custody-"));
    roots.push(rootDirectory);
    const create = await loadFactory();
    const custody = create({ rootDirectory, maxTranscriptBytes: 256, maxEntries: 2 });
    const transcript = "SIMULATED provider transcript: four greenhouse zones observed.";

    const metadata = await custody.write({ operationId: "operation-live-001", transcript });

    expect(metadata).toMatchObject({
      opaqueReference: expect.stringMatching(/^local-transcript:\/\/[A-Za-z0-9_-]{32,}$/u),
      integritySha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      byteLength: Buffer.byteLength(transcript, "utf8"),
    });
    expect(JSON.stringify(metadata)).not.toContain("operation-live-001");
    expect(JSON.stringify(metadata)).not.toContain(transcript);
    await expect(custody.read(metadata)).resolves.toBe(transcript);
    expect((await readdir(rootDirectory)).some((name) => name.includes(".tmp"))).toBe(false);

    const gitignore = await readFile(new URL("../../../.gitignore", import.meta.url), "utf8");
    expect(gitignore).toContain(".local-evidence/");
  });

  it("fails closed on oversize, capacity, missing, and corrupted evidence without exposing bodies", async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "muster-custody-"));
    roots.push(rootDirectory);
    const create = await loadFactory();
    const custody = create({ rootDirectory, maxTranscriptBytes: 64, maxEntries: 1 });
    const protectedBody = "protected transcript body";

    await expect(
      custody.write({ operationId: "operation-oversize", transcript: "x".repeat(65) }),
    ).rejects.toThrow("Transcript custody input is invalid");
    const metadata = await custody.write({
      operationId: "operation-live-002",
      transcript: protectedBody,
    });
    await expect(
      custody.write({ operationId: "operation-capacity", transcript: "another body" }),
    ).rejects.toThrow("Transcript custody capacity is unavailable");

    const [storedFile] = await readdir(rootDirectory);
    if (storedFile === undefined) throw new Error("Expected one custody object");
    await writeFile(join(rootDirectory, storedFile), "tampered transcript", "utf8");
    const corrupted = await custody.read(metadata).catch((error: unknown) => error);
    expect(corrupted).toMatchObject({ name: "EvidenceCustodyError", code: "integrity_mismatch" });
    expect(String(corrupted)).not.toContain(protectedBody);
    await rm(join(rootDirectory, storedFile));
    const missing = await custody.read(metadata).catch((error: unknown) => error);
    expect(missing).toMatchObject({ name: "EvidenceCustodyError", code: "evidence_unavailable" });
    expect(String(missing)).not.toContain(protectedBody);
  });

  it("atomically stores an idempotent provider task reference outside transcript custody", async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "muster-custody-"));
    roots.push(rootDirectory);
    const create = await loadFactory();
    const custody = create({ rootDirectory, maxTranscriptBytes: 256, maxEntries: 2 });

    await custody.writeProviderTaskReference({
      operationId: "operation-live-task-001",
      providerTaskId: "provider-task-opaque",
    });
    await custody.writeProviderTaskReference({
      operationId: "operation-live-task-001",
      providerTaskId: "provider-task-opaque",
    });

    await expect(
      custody.readProviderTaskReference({ operationId: "operation-live-task-001" }),
    ).resolves.toBe("provider-task-opaque");
    const entries = await readdir(rootDirectory);
    expect(entries.filter((name) => name.endsWith(".provider-task"))).toHaveLength(1);
    expect(entries.join("\n")).not.toContain("operation-live-task-001");
    expect(entries.some((name) => name.includes(".tmp"))).toBe(false);
    await expect(
      custody.writeProviderTaskReference({
        operationId: "operation-live-task-001",
        providerTaskId: "provider-task-conflict",
      }),
    ).rejects.toThrow("Transcript custody integrity check failed");
  });
});
