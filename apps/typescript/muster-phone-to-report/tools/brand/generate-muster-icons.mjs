import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { deflateSync } from "node:zlib";

const outputDirectory = fileURLToPath(new URL("../../apps/web/public/", import.meta.url));
const canonicalMarkPath = fileURLToPath(
  new URL("../../apps/web/src/assets/brand/muster-mark.svg", import.meta.url),
);
const iconSizes = [16, 32, 180, 192, 512];
const supersampling = 4;
const canonicalMark = await readFile(canonicalMarkPath, "utf8");

function rgba(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff, 0xff];
}

function requiredMatch(pattern, label) {
  const match = canonicalMark.match(pattern);
  if (match?.[1] === undefined) throw new Error(`Canonical Muster SVG is missing ${label}`);
  return match[1];
}

const brandColors = Object.freeze({
  deep: rgba(requiredMatch(/stroke="(#[0-9A-Fa-f]{6})"/u, "route color")),
  teal: rgba(requiredMatch(/<g fill="(#[0-9A-Fa-f]{6})">/u, "source-node color")),
});

function pathPoints(pathData) {
  const tokens = [...pathData.matchAll(/([Mhlv])|(-?\d+(?:\.\d+)?)/gu)].map(
    (match) => match[1] ?? Number(match[2]),
  );
  if (tokens[0] !== "M" || typeof tokens[1] !== "number" || typeof tokens[2] !== "number") {
    throw new Error("Canonical Muster SVG contains an unsupported path");
  }
  let x = tokens[1];
  let y = tokens[2];
  const points = [[x, y]];
  for (let index = 3; index < tokens.length; ) {
    const command = tokens[index++];
    const first = tokens[index++];
    if (typeof command !== "string" || typeof first !== "number") {
      throw new Error("Canonical Muster SVG contains an unsupported path command");
    }
    if (command === "h") x += first;
    else if (command === "v") y += first;
    else if (command === "l") {
      const second = tokens[index++];
      if (typeof second !== "number") throw new Error("Canonical Muster SVG path is incomplete");
      x += first;
      y += second;
    } else {
      throw new Error("Canonical Muster SVG path command is unsupported");
    }
    points.push([x, y]);
  }
  return points;
}

function attributes(element) {
  return Object.fromEntries(
    [...element.matchAll(/([\w-]+)="([^"]+)"/gu)].map((match) => [match[1], match[2]]),
  );
}

const channelGeometry = [...canonicalMark.matchAll(/<path d="([^"]+)"\s*\/>/gu)].map((match) =>
  pathPoints(match[1]),
);
const nodeGeometry = [...canonicalMark.matchAll(/<rect\b[^>]*\/>/gu)].map((match) => {
  const value = attributes(match[0]);
  return {
    color: value["fill"] === undefined ? brandColors.teal : rgba(value["fill"]),
    left: Number(value["x"]),
    radius: Number(value["rx"]),
    size: Number(value["width"]),
    top: Number(value["y"]),
  };
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const result = Buffer.allocUnsafe(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(body), data.length + 8);
  return result;
}

function distanceToSegment(x, y, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared));
  return Math.hypot(x - (start[0] + projection * dx), y - (start[1] + projection * dy));
}

function insideRoundedRect(x, y, left, top, size, radius) {
  const closestX = Math.max(left + radius, Math.min(x, left + size - radius));
  const closestY = Math.max(top + radius, Math.min(y, top + size - radius));
  return Math.hypot(x - closestX, y - closestY) <= radius;
}

function renderIcon(size) {
  const sampleSize = size * supersampling;
  const samples = new Uint8Array(sampleSize * sampleSize * 4);
  const scale = sampleSize / 24;
  for (let sampleY = 0; sampleY < sampleSize; sampleY += 1) {
    for (let sampleX = 0; sampleX < sampleSize; sampleX += 1) {
      const x = (sampleX + 0.5) / scale;
      const y = (sampleY + 0.5) / scale;
      let color;
      for (const route of channelGeometry) {
        for (let index = 1; index < route.length; index += 1) {
          if (distanceToSegment(x, y, route[index - 1], route[index]) <= 1.125)
            color = brandColors.deep;
        }
      }
      for (const node of nodeGeometry) {
        if (insideRoundedRect(x, y, node.left, node.top, node.size, node.radius)) {
          color = node.color;
        }
      }
      if (color === undefined) continue;
      const offset = (sampleY * sampleSize + sampleX) * 4;
      samples.set(color, offset);
    }
  }

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let dy = 0; dy < supersampling; dy += 1) {
        for (let dx = 0; dx < supersampling; dx += 1) {
          const sampleOffset =
            ((y * supersampling + dy) * sampleSize + (x * supersampling + dx)) * 4;
          for (let channel = 0; channel < 4; channel += 1)
            totals[channel] += samples[sampleOffset + channel];
        }
      }
      const pixelOffset = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        pixels[pixelOffset + channel] = Math.round(totals[channel] / supersampling ** 2);
      }
    }
  }

  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1);
    scanlines[rowOffset] = 0;
    pixels.copy(scanlines, rowOffset + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  iconSizes.map((size) =>
    writeFile(`${outputDirectory}/muster-mark-${size}.png`, renderIcon(size)),
  ),
);
