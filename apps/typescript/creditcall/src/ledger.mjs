import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function safeId(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function reserveRun(planId) {
  const directory = path.join(process.cwd(), "output");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `run-${safeId(planId)}.json`);

  try {
    await writeFile(
      file,
      JSON.stringify({ planId, state: "reserved", createdAt: new Date().toISOString() }, null, 2),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        "This plan already has a local run reservation. Check status or recover the existing run instead of starting another call.",
      );
    }
    throw error;
  }

  return file;
}

export async function recordRun(file) {
  await writeFile(
    file,
    JSON.stringify({ state: "submitted", updatedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
}
