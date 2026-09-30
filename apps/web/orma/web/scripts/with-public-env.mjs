#!/usr/bin/env node
/**
 * Map existing Orma names onto SvelteKit PUBLIC_ names, then run a command.
 * Reads the repo .env for the publishable key only. Never prints values.
 */
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

function parseEnvFile(path) {
  const out = {}
  if (!existsSync(path)) return out
  const text = readFileSync(path, "utf8")
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function firstValue(keys, records) {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === "string" && value.length > 0) return value
    }
  }
  return ""
}

const rootEnv = parseEnvFile(resolve(here, "../../.env"))
const webEnv = parseEnvFile(resolve(here, "../.env"))
const processEnv = process.env

const apiUrl = firstValue(
  ["PUBLIC_ORMA_API_URL", "ORMA_API_URL"],
  [processEnv, webEnv, rootEnv],
) || "https://orma-api.nryn.dev"

const anonKey = firstValue(
  [
    "PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ],
  [processEnv, webEnv, rootEnv],
)

if (!anonKey) {
  console.error("missing SUPABASE_ANON_KEY (or PUBLIC_SUPABASE_ANON_KEY)")
  process.exit(1)
}

if (apiUrl.includes("supabase.co")) {
  console.error("ORMA_API_URL must not be a project host")
  process.exit(1)
}

if (anonKey.startsWith(["sb", "secret_"].join("_"))) {
  console.error("publishable key only")
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error("with-public-env: missing command")
  process.exit(2)
}

const childEnv = {
  ...process.env,
  PUBLIC_ORMA_API_URL: apiUrl,
  PUBLIC_SUPABASE_ANON_KEY: anonKey,
}

const child = spawn(args[0], args.slice(1), {
  stdio: "inherit",
  env: childEnv,
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
