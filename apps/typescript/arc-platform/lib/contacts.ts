/**
 * Where a target's phone number comes from.
 *
 * The catalogue in app/radio/_data.ts and app/influencers/_data.ts carries the
 * FIELD; this module carries the VALUES. That split is deliberate and is the
 * reason the batch route could never dial more than one line:
 *
 *  - A station's sales line is not ours to publish. The catalogue is public
 *    demo data that ships in the client bundle, and a real desk number in it
 *    is a number anyone reading the repo can ring.
 *  - Inventing plausible ones instead is precisely the fabrication BRANDING.md
 *    section 9 forbids, and an invented +92 number does not fail loudly - it
 *    rings a stranger.
 *
 * So numbers live in ARC_CONTACTS, a server-side JSON map keyed by catalogue
 * id, and nothing here is ever sent to the browser.
 *
 *   ARC_CONTACTS='{"city-fm-89-khi":"+923001234567","sanalifestyle_pk":"+923217654321"}'
 *
 * A target with no entry is not dialled and is reported as unreachable, which
 * is the honest outcome: we do not have a number for it.
 */

import { isE164 } from "@/lib/calle";
import { db } from "@/lib/db";

/* Parsed once. A malformed ARC_CONTACTS is a deployment mistake, not a
   per-request one, so it is reported at boot and then treated as empty rather
   than throwing on every call. */
const BOOK: Record<string, string> = (() => {
  const raw = process.env.ARC_CONTACTS;
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error("ARC_CONTACTS is not a JSON object - ignoring it.");
      return {};
    }
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const phone = String(value ?? "").trim();
      /* A number that is not E.164 would be rejected downstream anyway; caught
         here it names the entry that is wrong. */
      if (!isE164(phone)) {
        console.error(`ARC_CONTACTS["${id}"] is not a valid E.164 number - ignoring it.`);
        continue;
      }
      out[id] = phone;
    }
    return out;
  } catch {
    console.error("ARC_CONTACTS is not valid JSON - ignoring it.");
    return {};
  }
})();

/** The number we hold for a catalogue id, or undefined if we hold none. */
export function contactFor(externalId?: string | null): string | undefined {
  if (!externalId) return undefined;
  return BOOK[externalId];
}

/** How many targets we can actually reach - shown in the batch panel so the
 *  operator knows before dialling, not after. */
export function contactCount(): number {
  return Object.keys(BOOK).length;
}

/**
 * How many contacts each directory lists, for the sidebar badges.
 *
 * Counts every contact, not only the callable ones: the directories list a row
 * without a number too, marked NO PHONE. A badge that disagrees with the page
 * it links to is worse than no badge.
 *
 * Returns null rather than throwing. This runs in AppShell, which wraps every
 * signed-in page, so a failure here would take down the dashboard over a number
 * in a nav badge - and it did: lib/db caches the Prisma client on globalThis,
 * so a dev server started before `prisma generate` keeps a client with no
 * `contact` model for its whole life, through every hot reload.
 *
 * Null hides the badge. It does NOT fall back to a hardcoded number, because a
 * nav that confidently says 8 next to a page listing 36 is the bug this whole
 * change exists to fix.
 */
export async function directoryCounts(): Promise<{ stations: number; creators: number } | null> {
  try {
    const rows = await db.contact.groupBy({ by: ["type"], _count: true });
    const of = (t: string) => rows.find((r) => r.type === t)?._count ?? 0;
    return { stations: of("STATION"), creators: of("CREATOR") };
  } catch (e) {
    console.error(
      "directoryCounts failed, nav badges hidden:",
      e instanceof Error ? e.message : e,
      "\n  If this says `contact` is undefined, the running server holds a stale " +
      "Prisma client: npx prisma generate, then restart it."
    );
    return null;
  }
}

/** Where a target's number came from. `none` means it was not dialled. */
export type NumberSource = "typed" | "contacts" | "demo-fallback" | "none";

export interface ResolvedNumber {
  /** "" when nothing usable resolved. */
  phone: string;
  source: NumberSource;
  /** Set only when the row is not what it appears to be. */
  note?: string;
}

/**
 * Which number to dial for one target, and - the part that matters - which of
 * the three sources produced it.
 *
 * Order: a number typed for THIS call, then the contact book, then the
 * caller's fallback. `fallback` is passed in rather than read from the
 * environment so that production's "there is no fallback" is expressible as
 * an empty string, and so this can be tested without pretending to be
 * deployed. Callers pass resolvePhone("").
 *
 * The source is not decoration. A batch that dialled eight sales desks and a
 * batch that dialled one dev handset eight times are identical in every other
 * field of the response, and the difference between them is the entire
 * product. Returning the source is what lets the caller say so out loud
 * instead of reporting eight successes.
 */
export function resolveTargetNumber(
  target: { name: string; phone?: string; externalId?: string },
  fallback: string,
  lookup: (externalId?: string | null) => string | undefined = contactFor
): ResolvedNumber {
  const typed = (target.phone ?? "").trim();
  /* A typed number is not second-guessed against the book: if the caller
     supplied one for this call, an invalid one is their error to see, not
     something to quietly paper over with a fallback. */
  const fromBook = typed ? undefined : lookup(target.externalId);
  const chosen = typed || fromBook || fallback || "";

  if (!isE164(chosen)) return { phone: "", source: "none" };
  if (typed) return { phone: chosen, source: "typed" };
  if (fromBook) return { phone: chosen, source: "contacts" };

  const id = target.externalId ? `"${target.externalId}"` : "this target";
  return {
    phone: chosen,
    source: "demo-fallback",
    note:
      `No ARC_CONTACTS entry for ${id} — dialled CALLE_DEMO_PHONE instead. ` +
      `That is the shared dev number, NOT ${target.name}. Any rate this call ` +
      `returns belongs to whoever answered it.`,
  };
}

/* ---------------------------------------------------------------- database

   Numbers moved into the Contact table so one can be added or changed without
   a redeploy. ARC_CONTACTS stays as a fallback rather than being ripped out:
   an env var that still works is what keeps a half-finished migration from
   becoming an outage, and the table starts empty.

   Order: the table, then the env book, then the caller's fallback. The table
   wins because it is the thing an operator can edit; the env book is what we
   shipped with; the fallback is dev-only and single-handset.
*/

/** The number the Contact table holds for a catalogue id, if any. */
export async function contactPhoneFromDb(externalId?: string | null): Promise<string | undefined> {
  if (!externalId) return undefined;
  try {
    const row = await db.contact.findUnique({
      where: { externalId },
      select: { phone: true },
    });
    const phone = row?.phone?.trim();
    return phone && isE164(phone) ? phone : undefined;
  } catch (e) {
    /* A contacts table that cannot be read must not stop a call that the env
       book could still place. Reported, then treated as empty. */
    console.error("Contact lookup failed, falling back to ARC_CONTACTS:", e instanceof Error ? e.message : e);
    return undefined;
  }
}

/**
 * resolveTargetNumber, with the database consulted first.
 *
 * Same shape and same rules as the synchronous version - which stays, because
 * it is the pure part and the one the tests pin. This only adds a source in
 * front of the env book.
 */
export async function resolveTargetNumberWithDb(
  target: { name: string; phone?: string; externalId?: string },
  fallback: string
): Promise<ResolvedNumber> {
  const typed = (target.phone ?? "").trim();
  if (!typed) {
    const fromDb = await contactPhoneFromDb(target.externalId);
    if (fromDb) return { phone: fromDb, source: "contacts" };
  }
  return resolveTargetNumber(target, fallback);
}
