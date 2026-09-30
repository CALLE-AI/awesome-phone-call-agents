import { notFound } from "next/navigation";

import Sidebar from "@/app/dashboard/_components/Sidebar";
import TopBar from "@/app/dashboard/_components/TopBar";
import { STATIONS } from "@/app/radio/_data";
import { CREATORS } from "@/app/influencers/_data";

/**
 * /dev harness for shell-wrapped pages.
 *
 * AppShell calls auth() and getOrCreateBrand(), so a signed-out review pass
 * cannot render it. This composes the same Sidebar and TopBar with literal
 * props instead. It is a review scaffold only - never linked, dev-only
 * guarded, and it renders the real page components rather than copies of
 * them, so what it shows is what the route shows.
 */
export default function ShellHarness({
  crumb,
  children,
}: {
  crumb?: string;
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="flex min-h-screen bg-bg font-sans text-body text-text">
      <Sidebar
        brandName="Shan Foods"
        plan="STARTER"
        counts={{ "/radio": STATIONS.length, "/influencers": CREATORS.length }}
      />
      <div className="ml-60 flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar crumb={crumb} />
        <main className="flex-1 px-6 pt-[88px] pb-8">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
