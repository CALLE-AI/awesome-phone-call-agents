/**
 * Measure how long rendered audio actually runs.
 *
 * Two paths and no third. A WAV container is parsed from its own header, which
 * needs nothing installed and is exact. Anything else is handed to ffprobe when
 * ffprobe is on the path. When neither applies the duration is reported as
 * unknown rather than estimated from the character count, because a number
 * nobody measured is worse than an honest gap: the length check is skipped and
 * the output says so.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Duration in seconds. Null when it could not be measured. */
export function probeSeconds(path: string): number | null {
  const fromHeader = wavSeconds(path);
  if (fromHeader !== null) return fromHeader;
  return ffprobeSeconds(path);
}

/**
 * Parse a RIFF/WAVE header.
 *
 * Walks the chunk list rather than assuming fmt sits at offset 12, because a
 * WAV carrying LIST or fact chunks is still a valid WAV.
 */
export function wavSeconds(path: string): number | null {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return null;

  let byteRate = 0;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= buf.length) {
      byteRate = buf.readUInt32LE(body + 8);
    } else if (id === "data") {
      // A streamed WAV can carry a zero or overlong size, so trust the file.
      dataSize = Math.min(size, buf.length - body);
    }
    offset = body + size + (size % 2);
  }
  if (byteRate <= 0 || dataSize <= 0) return null;
  return dataSize / byteRate;
}

function ffprobeSeconds(path: string): number | null {
  const run = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { encoding: "utf8" },
  );
  if (run.error !== undefined || run.status !== 0) return null;
  const seconds = Number.parseFloat((run.stdout ?? "").trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
