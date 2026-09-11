/** Prints "done" or the call's current status. Used by call-and-archive.sh. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const { prisma } = await jiti.import(path.join(root, "lib/db.ts"));
const row = await prisma.call.findFirst({ where: { calleCallId: process.argv[2] }, select: { done: true, status: true } });
console.log(row?.done ? "done" : (row?.status ?? "unknown"));
await prisma.$disconnect();
