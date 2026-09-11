import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { createJazzCashPayment } from "@/lib/payments/jazzcash";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const brandUser = await db.brandUser.findUnique({
    where: { clerkId: userId },
    include: { brand: true },
  });
  if (!brandUser) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const body = await req.json();
  const { amount, description, mobileNumber, planId } = body as {
    amount: number;
    description: string;
    mobileNumber: string;
    planId?: string;
  };

  if (!amount || !mobileNumber) {
    return NextResponse.json({ error: "amount and mobileNumber are required" }, { status: 400 });
  }

  // Sanitise mobile number: strip spaces, dashes, +92 prefix
  const cleanMobile = mobileNumber
    .replace(/\s|-/g, "")
    .replace(/^\+92/, "0");

  if (!/^03\d{9}$/.test(cleanMobile)) {
    return NextResponse.json({ error: "Invalid JazzCash mobile number" }, { status: 400 });
  }

  const orderId = `arc-${brandUser.brand.id.substring(0, 8)}-${Date.now()}`;
  const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/checkout/jazzcash-return?orderId=${orderId}&planId=${planId ?? ""}`;

  const formData = createJazzCashPayment({
    amount,
    orderId,
    description: description || "Arc Platform subscription",
    returnUrl,
    mobileNumber: cleanMobile,
  });

  return NextResponse.json({ success: true, ...formData });
}
