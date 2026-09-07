import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { subscribersTable } from "@/lib/db";

// Convenience route for demo purposes: POST here to add one seed subscriber
// so you have something to test "simulate failure" against.
//
// IMPORTANT: CALL-E only supports calling recipients in specific regions
// today (see https://github.com/CALLE-AI/call-e-integrations#supported-regions-and-languages).
// As of this writing: US, SG, MY, IN, AE, AU, CA, GB, VN, DE, JP, FR, MX, BR,
// ID, PH, KE. Ghana (GH) is NOT currently supported -- if your real number
// isn't in a supported region, the call will fail with `unsupported_region`.
//
// TODO(you): replace the phone/region/locale below with a real number you
// own in one of the supported regions above (e.g. a US, UK, or Kenyan number).
export async function POST() {
  const subscriber = {
    id: randomUUID(),
    name: "Alex Morgan (Demo)",
    phone: "+12763229632", // <-- replace with a real E.164 number in a supported region
    region: "GH", // <-- must match the country of the phone number above
    locale: "en-GH", // <-- language/locale for the call, e.g. "en-GB", "en-KE"
    email: "alex.demo@example.com",
    plan_name: "Pro Monthly",
    amount_cents: 2900,
    stripe_customer_id: null,
    status: "active",
    created_at: new Date().toISOString(),
  };

  subscribersTable.insert(subscriber);
  return NextResponse.json(subscriber, { status: 201 });
}