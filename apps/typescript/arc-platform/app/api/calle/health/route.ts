import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { calleDiagnostics } from "@/lib/calle";

/**
 * PUBLIC health/version check (excluded from auth in middleware.ts).
 * Open this URL in any browser to confirm which build is deployed and whether
 * the CALL-E key + demo phone are configured.
 */

/**
 * Ask the API whether this key actually works.
 *
 * `anthropicConfigured` only ever meant "the variable is not empty", and it
 * answered `true` for a whole day while every generation was falling back to
 * the offline sample: the key was set, valid, and rejected - identity-linked,
 * so it needs a workspace id the deployment was not sending. A boolean that
 * cannot tell those apart is worse than no boolean, because it is read as an
 * all-clear.
 *
 * Costs one token, so it runs only when asked for: /api/calle/health?probe=1
 */
async function probeAnthropic(): Promise<{ usable: boolean; reason?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { usable: false, reason: "ANTHROPIC_API_KEY is not set" };
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
  try {
    await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "ok" }],
    });
    return { usable: true };
  } catch (e) {
    /* The API's own words. Guessing at the cause is what cost us the day. */
    return { usable: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: NextRequest) {
  const probe = req.nextUrl.searchParams.get("probe") === "1";
  const anthropic = probe ? await probeAnthropic() : null;

  return NextResponse.json({
    ok: true,
    /* Which commit is actually serving this request. Vercel sets it at build
       time. Without it, "is the fix deployed?" is answered by reloading a page
       and hoping - and twice now that guess has been wrong. */
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    ...calleDiagnostics(),
    /* Whether the plan generator has a key, as a boolean and never a value.
       Without one the wizard serves the offline sample plan instead. This says
       only that a key is present - ?probe=1 says whether it works. */
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    anthropicWorkspaceIdSet: Boolean(process.env.ANTHROPIC_WORKSPACE_ID),
    /* Booleans, never values. The Stripe webhook answers 503 when either of
       these is missing, and the 503 cannot say which without leaking which
       secret exists - so it says neither and this says both. Added because
       "not configured" sent us looking at the wrong variable. */
    stripeSecretKeySet: Boolean(process.env.STRIPE_SECRET_KEY),
    stripeWebhookSecretSet: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    /* A verified webhook still changes nothing when the price map is empty:
       priceIdToPlan returns null for an unmatched id and the handler breaks
       without touching the brand. So "the secrets are set" is not the same
       question as "a subscription can move a plan", and this answers the
       second one. Price ids are not secrets - they are sent to the browser
       at checkout - but these stay booleans anyway, for one rule. */
    stripePriceIdsSet: {
      starterMonthly: Boolean(process.env.STRIPE_STARTER_MONTHLY_PRICE_ID),
      starterAnnual: Boolean(process.env.STRIPE_STARTER_ANNUAL_PRICE_ID),
      growthMonthly: Boolean(process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID),
      growthAnnual: Boolean(process.env.STRIPE_GROWTH_ANNUAL_PRICE_ID),
      enterpriseMonthly: Boolean(process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID),
      enterpriseAnnual: Boolean(process.env.STRIPE_ENTERPRISE_ANNUAL_PRICE_ID),
    },
    ...(anthropic
      ? { anthropicUsable: anthropic.usable, anthropicError: anthropic.reason }
      : {}),
  });
}
