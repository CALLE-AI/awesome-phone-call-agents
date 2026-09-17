#!/usr/bin/env node
/**
 * Pin F1. mint, unlink and load send the publishable key as apikey.
 * Authorization is the user Bearer. Missing anonKey throws.
 * A revert that puts the user JWT in apikey fails this script.
 */
import {
  loadTelegramLinkState,
  mintLinkToken,
  ORMA_API_URL,
  unlinkTelegram,
  type TelegramLinkClient,
} from "../src/lib/telegram-link.ts"

const ANON = "anon-publishable-key-fixture"
const USER_JWT = "user-jwt-fixture"
const USER_ID = "00000000-0000-4000-8000-000000000001"

type Captured = {
  url: string
  method: string
  apikey: string | null
  authorization: string | null
}

const captured: Captured[] = []

function jsonResponse(body = "[]", status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  })
}

const fetchDouble: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const headers = new Headers(init?.headers)
  captured.push({
    url,
    method: (init?.method ?? "GET").toUpperCase(),
    apikey: headers.get("apikey"),
    authorization: headers.get("authorization"),
  })
  if (url.includes("supabase.co")) {
    throw new Error("fetch double saw the project host")
  }
  return jsonResponse()
}

function fail(message: string): never {
  throw new Error(message)
}

function assertHeaders(label: string) {
  if (captured.length === 0) fail(`${label}: no requests`)
  for (const req of captured) {
    if (req.apikey !== ANON) fail(`${label}: apikey was not the anon key`)
    if (req.authorization !== `Bearer ${USER_JWT}`) {
      fail(`${label}: Authorization was not the user Bearer`)
    }
    if (req.apikey === USER_JWT) fail(`${label}: apikey was the user JWT`)
    if (!req.url.startsWith(`${ORMA_API_URL}/rest/v1/`)) {
      fail(`${label}: request left ORMA_API_URL`)
    }
    if (req.url.includes("supabase.co")) fail(`${label}: request used the project host`)
  }
}

async function expectMissingAnonKey(label: string, run: () => Promise<unknown>) {
  try {
    await run()
  } catch (err) {
    if (err instanceof Error && err.message === "missing publishable anon key") return
    fail(`${label}: threw ${err instanceof Error ? err.message : String(err)}`)
  }
  fail(`${label}: expected missing publishable anon key`)
}

const base = {
  apiUrl: ORMA_API_URL,
  accessToken: USER_JWT,
  userId: USER_ID,
  fetch: fetchDouble,
}

await expectMissingAnonKey("mint empty anonKey", () =>
  mintLinkToken({ ...base, anonKey: "" }),
)
await expectMissingAnonKey("unlink empty anonKey", () =>
  unlinkTelegram({ ...base, anonKey: "" }),
)
await expectMissingAnonKey("load empty anonKey", () =>
  loadTelegramLinkState({ ...base, anonKey: "" }),
)

const omitted = { ...base } as TelegramLinkClient
await expectMissingAnonKey("mint omitted anonKey", () => mintLinkToken(omitted))
await expectMissingAnonKey("unlink omitted anonKey", () => unlinkTelegram(omitted))
await expectMissingAnonKey("load omitted anonKey", () => loadTelegramLinkState(omitted))

captured.length = 0
await mintLinkToken({ ...base, anonKey: ANON })
assertHeaders("mint")
if (!captured.some((req) => req.method === "POST" && req.url.endsWith("/telegram_link_tokens"))) {
  fail("mint: missing POST to telegram_link_tokens")
}

captured.length = 0
await unlinkTelegram({ ...base, anonKey: ANON })
assertHeaders("unlink")

captured.length = 0
await loadTelegramLinkState({ ...base, anonKey: ANON })
assertHeaders("load")

try {
  await mintLinkToken({
    ...base,
    anonKey: ANON,
    apiUrl: "https://pyuubklpkhjngiqqwypf.supabase.co",
  })
  fail("mint: expected project-host throw")
} catch (err) {
  if (!(err instanceof Error) || err.message !== "must not use the project host") {
    fail(`mint: project-host throw was ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log("telegram-link header check passed")
