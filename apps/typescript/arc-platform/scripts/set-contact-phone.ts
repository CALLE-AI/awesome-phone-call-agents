/**
 * Change the number Arc dials for one contact. No redeploy.
 *
 *   node_modules/.bin/jiti scripts/set-contact-phone.ts fm-100-khi +923001234567
 *   node_modules/.bin/jiti scripts/set-contact-phone.ts fm-100-khi none
 *   node_modules/.bin/jiti scripts/set-contact-phone.ts --list
 *
 * `none` clears it, which is not the same as deleting the contact: the target
 * stays on the plan and its card says NO PHONE. That is the state that made a
 * silent fan-out failure visible, so it is reachable on purpose.
 *
 * Numbers set here are marked isDemoContact - they are ours, standing in for a
 * real desk. Pass --real to say otherwise, and only do that for a line whose
 * owner has agreed to be called by an AI.
 */
import { prisma } from "../lib/db";

const isE164 = (p: string) => /^\+[1-9]\d{7,14}$/.test(p);

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list") || args.length === 0) {
    const rows = await prisma.contact.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { externalId: true, name: true, type: true, phone: true, isDemoContact: true },
    });
    if (!rows.length) {
      console.log("No contacts yet. Seed them:  node_modules/.bin/jiti scripts/seed-contacts.ts");
    }
    for (const r of rows) {
      console.log(
        `${r.externalId.padEnd(24)} ${r.name.padEnd(22)} ${String(r.type).padEnd(8)} ` +
        `${r.phone ?? "— NO PHONE"}${r.phone && r.isDemoContact ? "  (demo contact)" : ""}`
      );
    }
    await prisma.$disconnect();
    return;
  }

  const [externalId, value] = args.filter((a) => !a.startsWith("--"));
  if (!externalId || !value) {
    console.error("Usage: set-contact-phone.ts <externalId> <+E164|none> [--real]");
    process.exit(1);
  }

  const clearing = /^(none|null|clear|-)$/i.test(value);
  if (!clearing && !isE164(value)) {
    console.error(`"${value}" is not E.164 (+ country code, 8-15 digits). Nothing changed.`);
    process.exit(1);
  }

  const existing = await prisma.contact.findUnique({ where: { externalId } });
  if (!existing) {
    console.error(
      `No contact "${externalId}". Seed the catalogue first, or check the id ` +
      `against app/radio/_data.ts / app/influencers/_data.ts.`
    );
    process.exit(1);
  }

  const updated = await prisma.contact.update({
    where: { externalId },
    data: {
      phone: clearing ? null : value,
      isDemoContact: clearing ? false : !args.includes("--real"),
    },
  });
  console.log(
    `${updated.name}: ${clearing ? "number cleared — the card will say NO PHONE" : `now dials ${updated.phone}`}` +
    (!clearing && updated.isDemoContact ? " (marked as our number, not the desk's own)" : "")
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
