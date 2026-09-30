import { currentUser } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import type { Brand } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Returns the caller's brand, creating a minimal one on first sight.
 *
 * This replaces the four-step onboarding flow. Onboarding collected thirteen
 * fields; twelve of them were read nowhere in the app, so its only durable
 * outputs were the Brand row, the BrandUser link, the brand name and the
 * onboardingDone flag. All four are produced here.
 *
 * Idempotent and safe under concurrent renders. Two parallel server components
 * hitting this on first load must not create two brands and must not throw:
 * the writes are upserts inside a transaction, and a unique-constraint race
 * (P2002) is caught and resolved by re-reading, since by then the other render
 * has committed.
 *
 * The name here is a GUESS and is marked as one. resolveBrandName reads the
 * Clerk profile, so a brand starts life named after the person who signed up -
 * "Sejafah Abroo", or "Coac Tal" where a first/last split produced it. That
 * name is not cosmetic: it is the advertiser the voice agent says out loud on
 * every call, so a real one has to be asked for rather than inferred.
 *
 * onboardingDone is therefore false at creation and means exactly one thing -
 * nobody has confirmed the brand's name yet. AppShell sends such a brand to
 * /welcome. The column already existed, so this costs no migration.
 */
export async function getOrCreateBrand(userId: string): Promise<Brand> {
  const existing = await db.brandUser.findUnique({
    where: { clerkId: userId },
    include: { brand: true },
  });
  if (existing?.brand) return existing.brand;

  const clerkOrgId = `user_${userId}`;
  const name = await resolveBrandName();

  try {
    return await db.$transaction(async tx => {
      const brand = await tx.brand.upsert({
        where: { clerkOrgId },
        update: {},
        create: {
          clerkOrgId,
          name,
          // Nothing in the app reads brand.industry, so OTHER avoids adding a
          // schema default and therefore avoids a migration.
          industry: "OTHER",
          /* False until a person confirms the name. See the note above. */
          onboardingDone: false,
          onboardingStep: 0,
        },
      });

      await tx.brandUser.upsert({
        where: { clerkId: userId },
        update: {},
        create: { clerkId: userId, brandId: brand.id, role: "OWNER" },
      });

      return brand;
    });
  } catch (err) {
    // A concurrent render won the race. Re-read rather than fail.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await db.brandUser.findUnique({
        where: { clerkId: userId },
        include: { brand: true },
      });
      if (again?.brand) return again.brand;
    }
    throw err;
  }
}

/**
 * Brand name seeded from the Clerk profile. This is a person's name standing in
 * for a company's, which is wrong but recoverable - it needs an editable
 * "Brand name" field in Settings. See the handover note.
 */
/**
 * A placeholder, never an answer.
 *
 * Clerk gives a person's name, and a person is not a brand. Whatever this
 * returns is shown until someone corrects it at /welcome.
 */
async function resolveBrandName(): Promise<string> {
  try {
    const user = await currentUser();
    const full = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
    if (full) return full;
    if (user?.username) return user.username;
    const email = user?.emailAddresses?.[0]?.emailAddress;
    if (email) return email.split("@")[0];
  } catch { /* fall through */ }
  return "My brand";
}
