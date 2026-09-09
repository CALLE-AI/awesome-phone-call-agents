import { HarborShell } from "./HarborShell";
import { getSundialsDb } from "@/lib/db";
import { HARBOR_ACCOUNT_ID } from "@/lib/sdk/public-key";

export const metadata = {
  title: "Harbor CRM",
  description: "The CRM for high-ticket revenue teams. Pipeline, marketing, and service in one operating system."
};

export const dynamic = "force-dynamic";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  // Demo-only: inject Harbor's generated SDK key from SQLite so judges can walk /demo
  // without pasting credentials. Production sites pass apiKey themselves — see /app/keys.
  const account = getSundialsDb().getAccount(HARBOR_ACCOUNT_ID);
  return (
    <HarborShell apiKey={account?.sdkKey || ""} accountId={HARBOR_ACCOUNT_ID}>
      {children}
    </HarborShell>
  );
}
