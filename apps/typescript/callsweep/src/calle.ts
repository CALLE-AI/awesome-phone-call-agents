import { CalleClient } from "@call-e/calle";
import type { Vendor, Quote } from "./types";
import { isE164 } from "./phone";
import { isAuthorized } from "./authz";
import quotesFixture from "../fixtures/quotes.json";

// Mock by default so building/testing spends no credits.
// Set MOCK=false in the environment to place real calls.
const MOCK = process.env.MOCK !== "false";

const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY!,
  baseUrl: "https://api.heycall-e.com",
});

// Place one real call with a structured-result schema. Shared by round 1,
// negotiation, and booking. Returns the recipient's structured result (or null).
export async function callVendor(
  phoneE164: string,
  region: string,
  task: string,
  schema: object
): Promise<Record<string, unknown> | null> {
  if (!isE164(phoneE164)) {
    throw new Error("Refusing to place a call: destination is not a valid E.164 number.");
  }
  if (!isAuthorized(phoneE164)) {
    throw new Error("Refusing to place a call: recipient is not on the authorized allowlist (ALLOWED_PHONES).");
  }
  try {
    const call = await client.calls.createAndWait({
      task,
      recipients: [{ phones: [phoneE164], region }],
      recipientResultSchema: schema as any,
    });
    return (call.recipients[0]?.structuredResult as Record<string, unknown>) ?? null;
  } catch (err) {
    // A transient network blip (DNS/timeout/reset) while placing or polling the
    // call should not crash the run. Return null so the caller treats it as an
    // unclear result and halts gracefully for reconciliation. Real API errors
    // (bad task, auth, rate limit) still throw so they are not silently hidden.
    if (isTransientNetworkError(err)) {
      console.warn(`  Network hiccup reaching CALL-E; treating this call as unresolved.`);
      return null;
    }
    throw err;
  }
}

// True for connectivity errors we should recover from rather than crash on.
function isTransientNetworkError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  const cause = (err as { cause?: { code?: string } })?.cause?.code ?? "";
  const transient = ["ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"];
  return transient.includes(code) || transient.includes(cause);
}

// Structured answer we want from each vendor. Note: single types only,
// no ["number","null"] unions (CALL-E rejects those).
const quoteSchema = {
  type: "object",
  required: ["available"],
  properties: {
    price: { type: "number" },
    opening_price: { type: "number" },
    available: { type: "string", enum: ["yes", "no", "unknown"] },
    available_detail: { type: "string" },
    eta_minutes: { type: "integer" },
    includes: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
} as const;

// Free extras that make sense for the kind of business being called.
function extrasPool(category: string): string[] {
  const c = category.toLowerCase();
  if (/hair|barber|salon/.test(c)) return ["wash", "beard trim", "hot towel", "head massage"];
  if (/car|auto|repair|mechanic|tyre|tire/.test(c)) return ["free wash", "warranty", "pickup & drop", "inspection"];
  if (/restaurant|cafe|food/.test(c)) return ["free drink", "dessert", "priority seating"];
  return ["loyalty discount", "free add-on"];
}

// Deterministic mock quote for a vendor (stable across runs, varied per shop
// name). Models the haggle: a shop opens at a sticker price, and if that is
// above the customer's budget the call drives it down toward the budget (down
// to the shop's own floor). Lets us demo real negotiation with no calls.
function mockQuote(v: Vendor, category: string, budget: number | null): Quote {
  let h = 0;
  for (const ch of v.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;

  // Mock simulates the happy path: every shop answers with a clear result, so
  // the demo reaches a booking. Ambiguous outcomes (no answer / no clear price)
  // only arise on real calls, where the run halts for reconciliation.
  const available: Quote["available"] = (h >> 2) % 4 === 0 ? "no" : "yes";

  // Opening (sticker) price, $22-51: some shops open above a typical budget.
  const opening = 22 + (h % 30);
  // If the opening is over budget, haggle it down. Each shop has its own floor
  // (80-94% of its sticker), so some land at the budget and some just above it.
  let price = opening;
  if (budget && opening > budget) {
    const floor = Math.round(opening * (0.8 + ((h >> 5) % 15) / 100));
    price = Math.min(opening, Math.max(budget, floor));
  }
  const eta = 10 + ((h >> 4) % 9) * 5; // 10-50 min

  // Deterministic extras from a category-appropriate pool, so a mid-price shop
  // with an extra can be a better deal than a cheaper one with nothing.
  const pool = extrasPool(category);
  const extrasCount = (h >> 8) % 3; // 0, 1, or 2
  const includes = [...new Set(Array.from({ length: extrasCount }, (_, i) => pool[(h >> (i * 3)) % pool.length]!))];

  // Value concession: a shop that could not drop to budget throws in an extra
  // instead ("can't go lower, but I'll include a wash"), so it can still win on value.
  if (budget && price > budget && includes.length === 0) {
    includes.push(pool[(h >> 3) % pool.length]!);
  }

  return {
    vendor: v.name,
    phoneE164: v.phoneE164,
    region: v.region ?? "US",
    answered: true,
    price,
    openingPrice: price < opening ? opening : undefined,
    available,
    availableDetail: available === "yes" ? `today, ${eta} min wait` : "fully booked today",
    etaMinutes: available === "yes" ? eta : null,
    includes,
    address: v.address,
    notes: "",
  };
}

// One round: get each vendor's best price in a single call. If the customer
// gave a budget, the same call asks the shop to meet or beat it, so the price
// that comes back is already negotiated. No separate round 2.
// MOCK -> generate quotes for the given vendors (or fixtures if none).
// Real -> one call per vendor, fired concurrently (serial on free tier).
export async function gatherQuotes(
  vendors: Vendor[],
  goal: string,
  category = "",
  budget: number | null = null
): Promise<Quote[]> {
  if (MOCK) {
    if (vendors.length === 0) return quotesFixture as Quote[];
    const quotes = vendors.map((v) => mockQuote(v, category, budget));
    // Demo clarity: keep the single cheapest shop bare, so the best deal is not
    // simply the lowest number. That is the whole point of value ranking.
    const cheapest = quotes
      .filter((q) => q.answered && q.price !== null && q.available === "yes")
      .sort((a, b) => (a.price as number) - (b.price as number))[0];
    if (cheapest) cheapest.includes = [];
    return quotes;
  }

  return Promise.all(
    vendors.map(async (v) => {
      if (!isE164(v.phoneE164) || !isAuthorized(v.phoneE164)) {
        return {
          vendor: v.name, phoneE164: v.phoneE164, region: v.region ?? "US", answered: false, price: null,
          available: "unknown" as const, availableDetail: "", etaMinutes: null,
          includes: [], address: v.address,
          notes: isE164(v.phoneE164) ? "not on allowlist" : "invalid number",
        };
      }
      const close =
        ` Once you have their final price, tell them "let me confirm with the customer and ` +
        `get back to you", then thank them and end the call politely. Do not book anything on this call.`;
      const task =
        (budget
          ? `${goal} Then negotiate, politely and briefly, in this order:\n` +
            `1. Ask their usual price first and note it as opening_price. Do not mention any budget yet.\n` +
            `2. Say the customer is comparing a few places, is on a budget of about $${budget}, and is ` +
            `ready to book today if the price works. Ask if they can do it for $${budget} or a little lower.\n` +
            `3. If they will NOT lower the price, ask what they can include to make it a better deal, ` +
            `such as a wash, an add-on, or a faster slot, and put anything they offer in includes.\n` +
            `4. If they still cannot move, ask once more if there is any flexibility at all, then accept ` +
            `their best offer graciously.\n` +
            `Report opening_price (their first price), price (best final price), and includes (any extras offered).`
          : goal) + close;
      const call = await client.calls.createAndWait({
        task,
        recipients: [{ phones: [v.phoneE164], region: v.region ?? "US" }],
        recipientResultSchema: quoteSchema,
      });
      const r = call.recipients[0];
      const data = (r?.structuredResult ?? {}) as Record<string, unknown>;

      return {
        vendor: v.name,
        phoneE164: v.phoneE164,
        region: v.region ?? "US",
        answered: r?.status === "completed",
        price: typeof data.price === "number" ? data.price : null,
        openingPrice:
          typeof data.opening_price === "number" &&
          typeof data.price === "number" &&
          data.opening_price > data.price
            ? data.opening_price
            : undefined,
        available: (data.available as Quote["available"]) ?? "unknown",
        availableDetail: typeof data.available_detail === "string" ? data.available_detail : "",
        etaMinutes: typeof data.eta_minutes === "number" ? data.eta_minutes : null,
        includes: Array.isArray(data.includes) ? data.includes.filter((x: unknown) => typeof x === "string") : [],
        address: v.address,
        notes: typeof data.notes === "string" ? data.notes : "",
        refused: data.price === undefined,
      };
    })
  );
}
