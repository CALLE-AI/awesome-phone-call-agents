import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import { prepareLocalDemoEnvironment } from "../src/config/local-demo-setup.ts";

const isPosix = process.platform !== "win32";

if (import.meta.main) {
  const localEnvironmentPath = resolve(process.cwd(), ".env.local");
  const exampleEnvironmentPath = resolve(process.cwd(), ".env.example");
  const sourcePath = existsSync(localEnvironmentPath)
    ? localEnvironmentPath
    : exampleEnvironmentPath;
  const source = readFileSync(sourcePath, "utf8");
  const result = prepareLocalDemoEnvironment(source, () =>
    randomBytes(32).toString("base64"),
  );

  writeLocalDemoEnvironment(localEnvironmentPath, result.content);

  if (result.updatedKeys.length === 0) {
    console.log("Local fake-only demo configuration is already ready.");
  } else {
    console.log(
      `Local fake-only demo configuration updated: ${result.updatedKeys.join(", ")}.`,
    );
  }

  console.log("Secret values were written only to the ignored .env.local file.");
}

/**
 * Writes the local demo environment file with owner-only permissions and
 * refuses unsafe targets. A mode passed to writeFileSync applies only when a
 * new file is created; overwriting an existing file preserves its current
 * mode, so an existing regular file is explicitly narrowed to 0600 first.
 * The path is never a symlink, directory, or other non-regular target.
 */
export function writeLocalDemoEnvironment(path, content) {
  let stat;

  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
      verifyOwnerOnlyFile(path);
      return;
    }

    throw error;
  }

  if (!stat.isFile()) {
    throw new Error(
      `Refusing to write secrets through ${path}: the target is not a regular file.`,
    );
  }

  chmodSync(path, 0o600);
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  verifyOwnerOnlyFile(path);
}

function verifyOwnerOnlyFile(path) {
  const written = lstatSync(path);

  if (!written.isFile()) {
    throw new Error(
      `Refusing to continue after writing ${path}: the file is not a regular file.`,
    );
  }

  // Windows does not expose POSIX mode bits through lstat, so the owner-only
  // check is meaningful only on POSIX. The regular-file check above still
  // applies everywhere.
  if (isPosix && (written.mode & 0o777) !== 0o600) {
    throw new Error(
      `Refusing to continue after writing ${path}: the file is not owner-only.`,
    );
  }
}
