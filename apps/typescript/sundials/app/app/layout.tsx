import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardChrome } from "@/lib/console/DashboardChrome";
import { requireAccount } from "@/lib/console/auth-gate";
import { readWorkspaceSettings } from "@/lib/console/workspace-settings";

export const dynamic = "force-dynamic";

export default async function AppSectionLayout({ children }: { children: React.ReactNode }) {
  const account = await requireAccount();
  if (!account) redirect("/login");
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading dashboard…</div>}>
      <DashboardChrome
        companyName={account.companyName}
        accountId={account.id}
        workspaceSettings={readWorkspaceSettings()}
      >
        {children}
      </DashboardChrome>
    </Suspense>
  );
}
