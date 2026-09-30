import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getOrCreateBrand } from "@/lib/brand";
import CheckoutFlow from "./_components/CheckoutFlow";
import { PLANS, type PlanKey } from "@/lib/config/pricing";

export const metadata = { title: "Checkout — Arc Platform" };

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; cycle?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const brand = await getOrCreateBrand(userId);

  const { plan = "growth", cycle = "monthly" } = await searchParams;

  // Resolve plan key (URL uses lowercase id, DB enum is uppercase)
  const planKey = (Object.keys(PLANS) as PlanKey[]).find(
    k => PLANS[k].id === plan,
  ) ?? "GROWTH";

  const selectedPlan = PLANS[planKey];
  const billingCycle = cycle === "annual" ? "annual" : "monthly";
  const amount = billingCycle === "annual" ? selectedPlan.annual_pkr : selectedPlan.monthly_pkr;

  return (
    <CheckoutFlow
      plan={selectedPlan}
      planKey={planKey}
      cycle={billingCycle}
      amount={amount}
      brandId={brand.id}
      brandName={brand.name}
    />
  );
}
