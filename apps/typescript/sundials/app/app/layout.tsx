import { Suspense } from "react";
import { DashboardChrome } from "@/lib/console/DashboardChrome";

export const dynamic = "force-dynamic";

export default function AppSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading dashboard…</div>}>
      <DashboardChrome>{children}</DashboardChrome>
    </Suspense>
  );
}
