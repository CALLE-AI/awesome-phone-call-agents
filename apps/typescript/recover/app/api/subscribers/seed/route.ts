import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { subscribersTable } from "@/lib/db";
import { validateApiAuth } from "@/lib/auth";

/**
 * Convenience route for demo purposes: POST here to add one seed subscriber
 * with reserved fictional identity (not a real person or real phone number).
 *
 * Uses the official CALL-E developer test number (+12763229632, US region)
 * which is reserved for testing purposes and will never reach a real person.
 *
 * IMPORTANT: CALL-E only supports calling recipients in specific regions.
 * See: https://github.com/CALLE-AI/call-e-integrations#supported-regions-and-languages
 */
export async function POST(req: NextRequest) {
  if (!validateApiAuth(req)) {
    return NextResponse.json({ error: "Unauthorized: Invalid or missing API key" }, { status: 401 });
  }

  const subscriber = {
    id: randomUUID(),
    // Reserved fictional identity — not a real person.
    // Phone is the official CALL-E developer test number (US, reserved for testing).
    name: "Alex Morgan (Demo)",
    phone: "+12763229632",
    region: "US",
    locale: "en-US",
    email: "alex.demo@example.com",
    plan_name: "Pro Monthly",
    amount_cents: 2900,
    stripe_customer_id: null,
    status: "active",
    followups_paused: 0,
    created_at: new Date().toISOString(),
  };

  subscribersTable.insert(subscriber);
  return NextResponse.json(subscriber, { status: 201 });
}