import ShellHarness from "../shell/ShellHarness";
import BillingPortal from "@/app/settings/billing/_components/BillingPortal";

export default function DevBillingPage() {
  return (
    <ShellHarness>
      <BillingPortal
        plan="STARTER"
        brandId="cmf2k9x7a0001qw3v8n4d5e6f"
        brandName="Shan Foods"
        stripeCustomerId={null}
        aiCreditsUsed={4}
        aiCreditsLimit={5}
        planExpiresAt={null}
        activeCampaigns={2}
      />
    </ShellHarness>
  );
}
