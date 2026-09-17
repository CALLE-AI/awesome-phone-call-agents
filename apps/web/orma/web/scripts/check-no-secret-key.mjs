#!/usr/bin/env node
/**
 * Fail if a secret key appears under web source.
 * Skips node_modules and .svelte-kit.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(new URL("..", import.meta.url)))
const skipDirs = new Set(["node_modules", ".svelte-kit", ".wrangler", "dist"])
const textExt = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".svelte",
  ".json",
  ".html",
  ".css",
  ".md",
  ".txt",
  ".toml",
  ".jsonc",
  ".svg",
  ".yml",
  ".yaml",
  ".env",
  ".d.ts",
])

const secretKeyName = ["SUPABASE", "SECRET", "KEY"].join("_")
const serviceRoleKeyName = ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_")
const secretPrefix = ["sb", "secret_"].join("_")
const roleNeedle = ["service", "role"].join("_")

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) walk(path, files)
    else files.push(path)
  }
  return files
}

function decodeJwtPayload(token) {
  const parts = token.split(".")
  if (parts.length < 2) return ""
  try {
    return Buffer.from(parts[1], "base64url").toString("utf8")
  } catch {
    return ""
  }
}

function findingsIn(text) {
  const hits = []
  if (text.includes(secretKeyName)) hits.push(secretKeyName)
  if (text.includes(serviceRoleKeyName)) hits.push(serviceRoleKeyName)
  if (text.includes(secretPrefix)) hits.push(secretPrefix)
  const jwt = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
  for (const match of text.matchAll(jwt)) {
    const payload = decodeJwtPayload(match[0])
    if (
      payload.includes(`"role":"${roleNeedle}"`) ||
      payload.includes(`"role": "${roleNeedle}"`)
    ) {
      hits.push(`${roleNeedle} jwt`)
      break
    }
  }
  return hits
}

const files = walk(root).filter((path) => {
  const ext = extname(path)
  if (path.endsWith(".d.ts")) return true
  return textExt.has(ext)
})

const failures = []
for (const path of files) {
  const text = readFileSync(path, "utf8")
  const hits = findingsIn(text)
  if (hits.length > 0) {
    failures.push(`${relative(root, path)}: ${hits.join(", ")}`)
  }
}

if (failures.length > 0) {
  console.error("secret key found under web/:")
  for (const line of failures) console.error(`  ${line}`)
  process.exit(1)
}

console.log("secret-key check passed")
