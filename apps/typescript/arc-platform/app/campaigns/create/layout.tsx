import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { getOrCreateBrand } from "@/lib/brand";

/**
 * The same gate AppShell applies, applied here too.
 *
 * The wizard is deliberately full-screen and therefore does NOT mount
 * AppShell - which is where the "has anyone said what this company is called?"
 * check lives. So every route in the app asked the question except the one
 * route that ends in a phone call announcing the answer.
 *
 * Every link into the wizard today comes from a page that is already gated, so
 * the ordinary path was never wrong. A bookmark, a shared URL or a typed
 * address was: it reached the brief, the plan and the call button with the
 * brand still named after whoever signed up.
 *
 * A layout rather than the page, because the page is a client component and
 * this has to run on the server.
 */
export default async function CreateCampaignLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const brand = await getOrCreateBrand(userId);
  if (!brand.onboardingDone) redirect("/welcome");

  return <>{children}</>;
}
