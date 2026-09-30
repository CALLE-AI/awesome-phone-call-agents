#!/usr/bin/env node
/**
 * Pins T5.4: E.164 matches the SQL CHECK, skip writes no outbound_calls
 * row, and agree stores the wording shown on screen.
 */
import {
  CONSENT_KIND_OUTBOUND,
  CONSENT_VERSION,
  PHONE_E164_RE,
  buildConsentRows,
  consentTextVersion,
  isE164,
  normalizePhone,
  partOfDayFromHour,
  prepareOnboarding,
  shownConsentWording,
} from "./model.ts"
import { lookupProfileExists, postAuthPath } from "./profile-gate.ts"
import { submitOnboarding } from "./submit.ts"

// T6.1: a finished profile lands on Today, after login and after onboarding.
if (postAuthPath(true) !== "/app") fail("a finished profile did not land on /app")
if (postAuthPath(false) !== "/app/onboarding") fail("a missing profile did not go to onboarding")
// svelte-check carries no Node types, so the fs module is typed by hand here.
const fsModule = "node:" + "fs"
const { readFileSync } = (await import(fsModule)) as {
  readFileSync: (path: URL, encoding: "utf8") => string
}
const onboardingPage = readFileSync(new URL("./+page.svelte", import.meta.url), "utf8")
if (!onboardingPage.includes("goto('/app')")) fail("onboarding submit does not go to /app")
if (onboardingPage.includes("goto('/app/settings')")) fail("onboarding submit still goes to Settings")

const USER_ID = "00000000-0000-4000-8000-000000000099"
const ANON = "anon-publishable-key-fixture"
const USER_JWT = "user-jwt-fixture"
const API = "https://orma-api.nryn.dev"

type Captured = {
  url: string
  method: string
  apikey: string | null
  authorization: string | null
  body: string | null
}

const captured: Captured[] = []

function fail(message: string): never {
  throw new Error(message)
}

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
    body: typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : null,
  })
  if (url.includes("supabase.co")) fail("fetch double saw the project host")
  return jsonResponse()
}

const accept = [
  "+12345678",
  "+123456789012345",
  "+919876543210",
  "+12025550123",
  "+44 7911 123456",
]
const reject = [
  "",
  "919876543210",
  "+012345678",
  "+1234567",
  "+1234567890123456",
  "++919876543210",
  "+91-9876543210",
]

for (const sample of accept) {
  if (!PHONE_E164_RE.test(normalizePhone(sample))) {
    fail(`E.164 regex rejected ${sample}`)
  }
  if (!isE164(sample)) fail(`isE164 rejected ${sample}`)
}
for (const sample of reject) {
  if (PHONE_E164_RE.test(normalizePhone(sample))) {
    fail(`E.164 regex accepted ${sample}`)
  }
  if (isE164(sample)) fail(`isE164 accepted ${sample}`)
}
if (normalizePhone("+91 98765 43210") !== "+919876543210") {
  fail("normalizePhone did not strip spaces")
}

const phone = "+919876543210"
const wording = shownConsentWording(phone)
if (!wording.includes(phone)) fail("shown wording omitted the number")
if (wording.includes("{phone}")) fail("shown wording left the placeholder")

const skipRows = buildConsentRows({ agreed: false, userId: USER_ID, phoneE164: phone })
if (skipRows.length !== 0) fail("consent skip built a row")
if (skipRows.some((row) => row.kind === CONSENT_KIND_OUTBOUND)) {
  fail("consent skip built an outbound_calls row")
}

const agreeRows = buildConsentRows({ agreed: true, userId: USER_ID, phoneE164: phone })
if (agreeRows.length !== 1) fail("consent agree did not build one row")
if (agreeRows[0].kind !== CONSENT_KIND_OUTBOUND) fail("consent agree kind was not outbound_calls")
if (agreeRows[0].text_version !== consentTextVersion(phone)) {
  fail("consent agree text_version did not match the helper")
}
if (!agreeRows[0].text_version.includes(wording)) {
  fail("consent agree text_version omitted the shown wording")
}
if (!agreeRows[0].text_version.startsWith(`${CONSENT_VERSION}\n`)) {
  fail("consent agree text_version dropped the version tag")
}
if (agreeRows[0].source !== "web") fail("consent agree source was not web")

if (partOfDayFromHour(11) !== "morning") fail("11 is not morning")
if (partOfDayFromHour(12) !== "midday") fail("12 is not midday")
if (partOfDayFromHour(15) !== "midday") fail("15 is not midday")
if (partOfDayFromHour(16) !== "evening") fail("16 is not evening")

const preparedSkip = prepareOnboarding(
  {
    displayName: "Ada",
    phone: "+91 98765 43210",
    agreed: false,
    localTime: "08:00",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    timeZone: "Asia/Kolkata",
  },
  USER_ID,
)
if (preparedSkip.phoneE164 !== phone) fail("prepare did not store E.164 without spaces")
if (preparedSkip.consentRows.length !== 0) fail("prepare skip built consent rows")
if (preparedSkip.partOfDay !== "morning") fail("08:00 is not morning")

try {
  prepareOnboarding(
    {
      displayName: "Ada",
      phone: "9876543210",
      agreed: true,
      localTime: "08:00",
      weekdays: [1],
      timeZone: "Asia/Kolkata",
    },
    USER_ID,
  )
  fail("prepare accepted a malformed number")
} catch (err) {
  if (!(err instanceof Error) || !err.message.includes("international format")) {
    fail(`prepare malformed throw was ${err instanceof Error ? err.message : String(err)}`)
  }
}

const client = {
  apiUrl: API,
  accessToken: USER_JWT,
  userId: USER_ID,
  anonKey: ANON,
  fetch: fetchDouble,
}

captured.length = 0
await submitOnboarding(client, {
  displayName: "Ada",
  phone: "+91 98765 43210",
  agreed: false,
  localTime: "08:00",
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  timeZone: "Asia/Kolkata",
})

for (const req of captured) {
  if (req.apikey !== ANON) fail("skip: apikey was not the anon key")
  if (req.authorization !== `Bearer ${USER_JWT}`) fail("skip: Authorization was not the user Bearer")
  if (!req.url.startsWith(`${API}/rest/v1/`)) fail("skip: request left ORMA_API_URL")
  if (req.url.includes("supabase.co")) fail("skip: request used the project host")
}

const skipConsentPosts = captured.filter(
  (req) => req.method === "POST" && req.url.includes("/consents"),
)
if (skipConsentPosts.length !== 0) fail("consent skip POSTed consents")
if (
  skipConsentPosts.some((req) => (req.body ?? "").includes(CONSENT_KIND_OUTBOUND))
) {
  fail("consent skip inserted outbound_calls")
}
if (!captured.some((req) => req.method === "POST" && req.url.includes("/profiles"))) {
  fail("skip: missing POST to profiles")
}
const profileBody = captured.find((req) => req.method === "POST" && req.url.includes("/profiles"))
  ?.body
if (!profileBody || profileBody.includes('"phone_confirmed_at"')) {
  fail("skip: profile POST included phone_confirmed_at")
}
if (!captured.some((req) => req.method === "POST" && req.url.includes("/slots"))) {
  fail("skip: missing POST to slots")
}

captured.length = 0
await submitOnboarding(client, {
  displayName: "Ada",
  phone,
  agreed: true,
  localTime: "17:30",
  weekdays: [1, 2, 3, 4, 5],
  timeZone: "Asia/Kolkata",
})

const agreeConsentPosts = captured.filter(
  (req) => req.method === "POST" && req.url.includes("/consents"),
)
if (agreeConsentPosts.length !== 1) fail("consent agree did not POST consents once")
const posted = JSON.parse(agreeConsentPosts[0].body ?? "null") as Array<{
  kind: string
  text_version: string
  source: string
  user_id: string
}>
if (!Array.isArray(posted) || posted.length !== 1) fail("consent agree body was not one row")
if (posted[0].kind !== CONSENT_KIND_OUTBOUND) fail("consent agree POST kind was not outbound_calls")
if (posted[0].text_version !== consentTextVersion(phone)) {
  fail("consent agree POST did not store the exact wording string")
}
if (posted[0].text_version !== `${CONSENT_VERSION}\n${wording}`) {
  fail("consent agree POST wording drifted from the screen")
}
if (posted[0].user_id !== USER_ID) fail("consent agree POST user_id mismatch")
if (posted[0].source !== "web") fail("consent agree POST source was not web")

const eveningSlot = captured.find((req) => req.method === "POST" && req.url.includes("/slots"))
if (!eveningSlot?.body || !eveningSlot.body.includes('"part_of_day":"evening"')) {
  fail("17:30 did not store evening")
}

captured.length = 0
try {
  await submitOnboarding(client, {
    displayName: "Ada",
    phone: "not-a-number",
    agreed: true,
    localTime: "08:00",
    weekdays: [1],
    timeZone: "Asia/Kolkata",
  })
  fail("submit accepted a malformed number")
} catch (err) {
  if (!(err instanceof Error) || !err.message.includes("international format")) {
    fail(`submit malformed throw was ${err instanceof Error ? err.message : String(err)}`)
  }
}
if (captured.length !== 0) fail("malformed phone still hit the network")

try {
  await submitOnboarding({ ...client, anonKey: "" }, {
    displayName: "Ada",
    phone,
    agreed: false,
    localTime: "08:00",
    weekdays: [1],
    timeZone: "Asia/Kolkata",
  })
  fail("submit accepted an empty anon key")
} catch (err) {
  if (!(err instanceof Error) || err.message !== "missing publishable anon key") {
    fail(`empty anon throw was ${err instanceof Error ? err.message : String(err)}`)
  }
}

try {
  await submitOnboarding(
    { ...client, apiUrl: "https://pyuubklpkhjngiqqwypf.supabase.co" },
    {
      displayName: "Ada",
      phone,
      agreed: false,
      localTime: "08:00",
      weekdays: [1],
      timeZone: "Asia/Kolkata",
    },
  )
  fail("submit accepted the project host")
} catch (err) {
  if (!(err instanceof Error) || err.message !== "must not use the project host") {
    fail(`project-host throw was ${err instanceof Error ? err.message : String(err)}`)
  }
}

captured.length = 0
const found = await lookupProfileExists({
  apiUrl: API,
  anonKey: ANON,
  accessToken: USER_JWT,
  userId: USER_ID,
  fetch: fetchDouble,
})
if (found) fail("empty profiles response was treated as a profile")
if (captured.length !== 1) fail("lookup did not fetch once")
if (captured[0].apikey !== ANON) fail("lookup apikey was not the anon key")
if (captured[0].authorization !== `Bearer ${USER_JWT}`) {
  fail("lookup Authorization was not the user Bearer")
}
if (!captured[0].url.startsWith(`${API}/rest/v1/profiles?`)) fail("lookup missed profiles")

console.log("onboarding check passed")
