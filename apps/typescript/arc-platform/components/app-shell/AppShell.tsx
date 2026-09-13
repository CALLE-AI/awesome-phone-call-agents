import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { getOrCreateBrand } from "@/lib/brand";
import { directoryCounts } from "@/lib/contacts";
import Sidebar from "@/app/dashboard/_components/Sidebar";
import TopBar from "@/app/dashboard/_components/TopBar";
import ResumeBrief from "@/app/dashboard/_components/ResumeBrief";

/**
 * The application shell: sidebar, top bar, resume banner.
 *
 * It used to live in app/dashboard/layout.tsx and therefore wrapped /dashboard
 * only - every other route rendered its own header and shared nothing. Now
 * each route mounts this, so navigation, breadcrumb and the account menu are
 * the same everywhere, and the unfinished-brief banner is reachable app-wide
 * rather than on the dashboard alone (BRANDING.md section 9, deferred item -
 * now closed).
 *
 * Not mounted by the campaign wizard, which is deliberately full-screen.
 */
export default async function AppShell({
  children,
  crumb,
}: {
  children: React.ReactNode;
  /** Final breadcrumb label for a detail page - the one label the shell
   *  cannot derive from the route, because the route only carries an id. */
  crumb?: string;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const brand = await getOrCreateBrand(userId);

  /* Nobody has said what this company is called yet, and the name is spoken
     aloud on every call Arc places. Ask before letting the app be used - see
     app/welcome. */
  if (!brand.onboardingDone) redirect("/welcome");

  /* Who is signed in is the top bar's business - Clerk's UserButton carries
     the avatar, the name and Sign out. The sidebar used to carry a second
     copy of all three; it no longer does, so nothing here reads the Clerk
     profile any more.

     The nav counted the eight stations and eight creators in _data.ts while
     the directories they link to list the whole Contact table. A sidebar that
     says 8 next to a page showing 36 is the contradiction, not the count. */
  const counts = await directoryCounts();

  return (
    <div className="flex min-h-screen bg-bg font-sans text-body text-text">
      <Sidebar
        brandName={brand.name}
        plan={brand.plan}
        counts={counts ? { "/radio": counts.stations, "/influencers": counts.creators } : undefined}
      />

      <div className="ml-60 flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar crumb={crumb} />
        <main className="flex-1 px-6 pt-[88px] pb-8">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
            <ResumeBrief />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
