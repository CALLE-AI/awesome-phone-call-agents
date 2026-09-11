import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { getOrCreateBrand } from "@/lib/brand";
import WelcomeForm from "./_components/WelcomeForm";

/**
 * The one question signing up does not ask.
 *
 * Clerk collects a person. Arc needs a company, and needs it more than most
 * apps would: the brand name is what the voice agent says out loud in the
 * first sentence of every call it places. Inferring it from a Clerk profile
 * produced "calling on behalf of Sejafah Abroo", and where a first/last split
 * had happened, "calling on behalf of Coac Tal".
 *
 * Deliberately outside AppShell - the shell is what sends people here, and
 * wrapping this in it would be a redirect loop.
 */
export default async function WelcomePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const brand = await getOrCreateBrand(userId);
  /* Already answered. Nobody is made to confirm twice. */
  if (brand.onboardingDone) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-12 font-sans text-body text-text">
      <div className="flex w-full max-w-lg flex-col gap-8">
        <header className="flex flex-col gap-3">
          <span className="type-label text-text-muted">Welcome to Arc</span>
          <h1 className="font-display text-h1 text-text">Who are we calling for?</h1>
          <p className="text-body text-text-muted">
            Arc phones radio stations and creators on your behalf, and says who it is calling for
            in its first sentence. That is this name, so it should be the company&apos;s — not yours.
          </p>
        </header>

        <WelcomeForm suggested={brand.name} />
      </div>
    </div>
  );
}
