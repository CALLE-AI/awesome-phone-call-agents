import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";
import BillingPortal from "./_components/BillingPortal";
import { isDemoWorkspace } from "@/lib/demo-workspace";

export const metadata = { title: "Billing — Arc Platform" };

export default async function BillingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const brand = await getOrCreateBrand(userId);

  /* planExpiresAt is a real Brand column that was never passed down - the
     next billing date was the literal "May 10, 2026". Active campaigns are
     countable, so the usage meter stops guessing at 2. */
  const activeCampaigns = await db.campaign.count({
    where: { brandId: brand.id, status: "ACTIVE" },
  });

  /* Sample invoices are shown only where they are labelled as samples. A
     real workspace gets the empty state, which is accurate: there is no
     Invoice table, so nobody has any. */
  const showSampleInvoices = isDemoWorkspace(brand.clerkOrgId);

  return (
    <BillingPortal
      showSampleInvoices={showSampleInvoices}
      plan={brand.plan}
      brandId={brand.id}
      brandName={brand.name}
      stripeCustomerId={brand.stripeCustomerId ?? null}
      aiCreditsUsed={brand.aiCreditsUsed}
      aiCreditsLimit={brand.aiCreditsLimit}
      planExpiresAt={brand.planExpiresAt ? brand.planExpiresAt.toISOString() : null}
      activeCampaigns={activeCampaigns}
    />
  );
}
