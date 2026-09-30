/**
 * Place ONE real call, with the task prompt shown first.
 *
 *   node scripts/place-call.mjs <externalId>              # print only
 *   node scripts/place-call.mjs <externalId> --place      # print, then dial
 *   node scripts/place-call.mjs --item <planItemId> --place
 *   node scripts/place-call.mjs <externalId> --locale ur-PK --language Urdu --region PK
 *
 * Prefer --item. A call placed from a plan line carries its campaign and its
 * line, which is what makes the whole chain exist: campaign -> plan line ->
 * call -> confirmed rate -> "heard here". A call placed by externalId alone
 * has no line to appear on, so its confirmed rate has nowhere to land and the
 * link is never rendered. That is not a bug; it is what a standalone call is.
 *
 * It refuses to dial when the prompt carries no negotiation mandate, because
 * the only reason to place this call by hand is to watch the mandate work.
 * It also refuses when another call to the same number is still outstanding -
 * the same guard the app applies, since a second call to a busy line comes
 * back 486 instantly.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const { prisma } = await jiti.import(path.join(root, "lib/db.ts"));
const { buildTask, schemaFor } = await jiti.import(path.join(root, "lib/calle-media.ts"));
const { buildMandate } = await jiti.import(path.join(root, "lib/negotiation.ts"));
const { calleCreateCall } = await jiti.import(path.join(root, "lib/calle.ts"));
const {
  reserveCall, confirmReservation, markReservationAmbiguous,
  failReservation, isAmbiguousCreateError, inFlightCallTo, AMBIGUOUS,
} = await jiti.import(path.join(root, "lib/calls.ts"));
/* Terminal scrollback is written down the same as a platform log is. */
const { maskPhone, deepMaskPhones } = await jiti.import(path.join(root, "lib/mask.ts"));

const place = process.argv.includes("--place");

/* CALL-E began refusing English calls to Pakistan - "This number is recognized
   as Pakistan, and English calls to Pakistan are not currently supported" -
   which is a create rejection, not a failed call: nothing dials.

   The script had no way to send anything else. Locale defaulted to en-US in
   lib/calle.ts (deliberately: en-PK mangled spoken numbers) and region was
   left for CALL-E to infer from the +92 prefix, so the one combination it now
   refuses was the only one reachable from here.

   Neither flag has a default. Omitted, the behaviour is exactly what it was.

     --locale ur-PK     ask for Urdu instead of English
     --region PK        state the region rather than letting it be inferred

   What CALL-E actually supports is server-side and is not in the SDK, so
   these are for trying what they TELL you, not for guessing at it. A rejected
   create costs nothing and rings nobody. */
const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const localeArg = flag("locale");
const regionArg = flag("region");

/* --language goes into the PROMPT; --locale goes to the speech model. They
   are different knobs and they have to agree.

   This script sent no language at all, so buildTask omitted its "Conduct the
   call in X" line and the prompt was English. Passing --locale ur-PK on its
   own would leave an English prompt driving an Urdu-tuned voice, which tests
   two things at once and could put an incoherent call in front of a real
   station. Set both, or neither. */
const languageArg = flag("language");
const itemArg = process.argv.indexOf("--item");
const planItemId = itemArg > -1 ? process.argv[itemArg + 1] : null;

/* A plan line names its own station and carries the campaign. */
let item = null;
let externalId = process.argv[2];
if (planItemId) {
  item = await prisma.mediaPlanItem.findUnique({
    where: { id: planItemId },
    include: { campaign: { select: { id: true, name: true, brandId: true, budgetTotal: true, currency: true, durationDays: true } } },
  });
  if (!item) { console.error(`No plan line "${planItemId}".`); process.exit(1); }
  externalId = item.externalId;
}
if (!externalId) {
  console.error("Give a catalogue id, or --item <planItemId>.");
  process.exit(1);
}

const c = await prisma.contact.findUnique({ where: { externalId } });
if (!c) { console.error(`No contact "${externalId}".`); process.exit(1); }

const otherLines = item
  ? await prisma.mediaPlanItem.count({ where: { campaignId: item.campaignId, NOT: { id: item.id } } })
  : 0;

const context = item
  ? {
      advertiser: item.campaign.name.split("—")[0].trim(),
      campaignName: item.campaign.name,
      market: c.city ?? "Karachi",
      durationDays: item.campaign.durationDays ?? 21,
      budgetTotal: item.campaign.budgetTotal ?? undefined,
      currency: item.campaign.currency ?? "PKR",
      audience: "working women 25-40",
      otherLines,
      ...(languageArg ? { language: languageArg } : {}),
    }
  : {
      advertiser: "Zeb Modest Wear",
      campaignName: "Eid 2026",
      market: c.city ?? "Karachi",
      durationDays: 21,
      budgetTotal: 500000,
      currency: "PKR",
      audience: "working women 25-40",
      otherLines: 0,
      ...(languageArg ? { language: languageArg } : {}),
    };
const target = {
  name: c.name,
  type: c.type === "STATION" ? "station" : "creator",
  channel: c.channel ?? "radio",
  externalId: c.externalId,
  contactName: c.type === "STATION" ? "the ad sales desk" : `${c.name} or their manager`,
  audienceSize: c.audience ?? undefined,
  /* The line's own estimate when there is a line - what this campaign was
     planned against, not what the catalogue says today. */
  estimatePkr: item?.estCostPkr ?? c.rateEstimatePkr,
};

const mandate = buildMandate({
  estimatePkr: target.estimatePkr, durationDays: context.durationDays,
  otherLines: context.otherLines, kind: target.type,
});

console.log("=".repeat(72));
console.log(`TARGET: ${c.name} (${c.city})  ${maskPhone(c.phone)}  ${c.isDemoContact ? "[demo contact - our own line]" : "[REAL LINE]"}`);
if (item) {
  console.log(`CAMPAIGN: "${item.campaign.name}"  ${item.campaign.id}`);
  console.log(`PLAN LINE: ${item.name}  ${item.id}  est ${item.estCostPkr ?? "none"}`);
} else {
  console.log(`CAMPAIGN: none - standalone call, its rate will have no plan line to appear on`);
}
console.log(`rate estimate on file: ${c.rateEstimatePkr ?? "none"}`);
console.log("=".repeat(72));

if (!mandate) {
  console.log("\nNO MANDATE. buildMandate returned null, which happens only when the");
  console.log("line carries no rate estimate. Not dialling.");
  await prisma.$disconnect();
  process.exit(2);
}

console.log(`\nMANDATE`);
console.log(`  target      PKR ${mandate.targetPkr.toLocaleString()}`);
console.log(`  walk-away   PKR ${mandate.walkAwayPkr.toLocaleString()}  (ceiling - never commit above)`);
mandate.levers.forEach((l, i) => console.log(`  lever ${i + 1}     ${l.key}: ${l.offer}`));

const task = buildTask(context, target);
const marker = "You have room to negotiate on price";
const at = task.indexOf(marker);
console.log(`\n--- FULL TASK PROMPT AS IT WILL BE SENT (${task.length} chars) ---\n`);
console.log(task.slice(0, at));
console.log(`\n>>>>>>>>>>>>>>>> MANDATE SECTION <<<<<<<<<<<<<<<<`);
console.log(task.slice(at));
console.log(`>>>>>>>>>>>>>>>> END MANDATE SECTION <<<<<<<<<<<<<<<<\n`);

const schema = schemaFor(target, context);
console.log(`schema fields: ${Object.keys(schema.properties).join(", ")}`);

if (at === -1) {
  console.log("\nThe mandate text is NOT in the prompt. Not dialling.");
  await prisma.$disconnect();
  process.exit(2);
}

if (!place) {
  console.log(
    `\nlocale: ${localeArg ?? "en-US (default)"}  region: ${regionArg ?? "inferred from the number"}`
  );
  console.log("Print only. Re-run with --place to dial.");
  await prisma.$disconnect();
  process.exit(0);
}

/* The campaign's own brand when we have one; a standalone call falls back to
   the newest, which is only ever right by accident. */
const brand = item
  ? await prisma.brand.findUnique({ where: { id: item.campaign.brandId } })
  : await prisma.brand.findFirst({ orderBy: { createdAt: "desc" } });
const open = await inFlightCallTo(c.phone, brand.id);

/* An ambiguous reservation is the one thing a re-run should pick up rather
   than refuse. Its key is on disk, so re-sending the create with THAT key
   cannot dial twice - CALL-E returns the original if the first request landed
   and places it if it did not. Anything else outstanding is a live call and
   still gets refused. */
const reconciling =
  open && open.status === AMBIGUOUS && open.id && open.idempotencyKey ? open : null;

if (open && !reconciling) {
  console.log(`\nREFUSING: a call to ${maskPhone(c.phone)} is still outstanding (${open.calleCallId ?? "another brand"}).`);
  await prisma.$disconnect();
  process.exit(3);
}

if (reconciling) {
  console.log(`\nRESOLVING an earlier attempt whose outcome was unknown. Re-sending the same request.`);
}

/* Reserved before the create, carrying the idempotency key.
   The key used to be `${c.externalId}:${Date.now()}` - a new value every run,
   so re-running this script after a timeout placed a SECOND real call to a
   real station. Now the row and its key are written first: a re-run is
   refused by the in-flight guard above, and the key needed to resolve it
   safely is on disk.

   The links matter here too. Without them the call is an orphan and its
   confirmed rate never reaches a plan line. */
const reservation = reconciling ?? (await reserveCall({
  brandId: brand.id,
  target,
  dialedPhone: c.phone,
  campaignId: item?.campaignId ?? null,
  mediaPlanItemId: item?.id ?? null,
}));

let callId;
try {
  ({ callId } = await calleCreateCall({
    task, phone: c.phone, resultSchema: schema,
    ...(localeArg ? { locale: localeArg } : {}),
    ...(regionArg ? { region: regionArg } : {}),
    metadata: { targetName: c.name, targetType: target.type, externalId: c.externalId },
    idempotencyKey: reservation.idempotencyKey,
  }));
} catch (e) {
  const why = e instanceof Error ? e.message : String(e);
  if (isAmbiguousCreateError(e)) {
    await markReservationAmbiguous(reservation.id, why);
    console.log(
      `\nUNKNOWN: CALL-E did not answer, so whether this call was placed is not known.` +
      `\n  reason: ${why}` +
      `\n  NOTHING has been dialled twice. The reservation is open and holds ${c.phone}.` +
      `\n  Re-run this command to resolve it: the same idempotency key is re-sent, which` +
      `\n  returns the original call if it exists and places one only if it does not.`
    );
    await prisma.$disconnect();
    process.exit(4);
  }
  await failReservation(reservation.id, why);
  console.log(`\nREFUSED by CALL-E, nothing dialled: ${deepMaskPhones(why)}`);
  await prisma.$disconnect();
  process.exit(5);
}

await confirmReservation(reservation.id, callId, item?.id ?? null);
console.log(`\nCALL PLACED\n  call id: ${callId}\n  dialling: ${maskPhone(c.phone)}`);
await prisma.$disconnect();
