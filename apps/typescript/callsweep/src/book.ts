import type { Quote } from "./types";
import { callVendor } from "./calle";

const MOCK = process.env.MOCK !== "false";

export type Booking = {
  vendor: string;
  phoneE164: string;
  address?: string;
  service: string;
  price: number;
  when: string; // agreed time / availability
  includes: string[];
  reference: string;
  confirmed: boolean;
  note?: string; // set when halted or not confirmed
};

// Last mile: book the shop the customer picked, at the price it quoted.
export async function book(
  winner: Quote,
  finalPrice: number,
  service: string
): Promise<Booking> {
  const base = {
    vendor: winner.vendor,
    phoneE164: winner.phoneE164,
    address: winner.address,
    service,
    price: finalPrice,
    when: winner.availableDetail || "to be confirmed",
    includes: winner.includes,
    reference: `CS-${Date.now().toString().slice(-6)}`,
  };

  if (MOCK) {
    return { ...base, confirmed: true };
  }

  // Real: place a booking call confirming the agreed price and time. CALL-E
  // needs a concrete date and a name for the booking, so both are supplied.
  const name = process.env.CUSTOMER_NAME ?? "Alex Kim";
  const res = await callVendor(
    winner.phoneE164,
    winner.region ?? "US",
    `You are calling ${winner.vendor} to book a ${service} appointment for today under the ` +
      `name ${name}, at the agreed price of $${finalPrice}. Ask for the earliest time today ` +
      `and confirm the booking is made.`,
    {
      type: "object",
      required: ["confirmed"],
      properties: { confirmed: { type: "string", enum: ["yes", "no"] } },
    }
  );

  // Ambiguous booking outcome (no answer, timeout, unclear): halt, do not claim success.
  if (!res || (res.confirmed !== "yes" && res.confirmed !== "no")) {
    return {
      ...base,
      confirmed: false,
      note: "Booking call returned no clear confirmation. Halted for human reconciliation.",
    };
  }

  return {
    ...base,
    confirmed: res.confirmed === "yes",
    note: res.confirmed === "yes" ? undefined : "The shop did not confirm the booking.",
  };
}
