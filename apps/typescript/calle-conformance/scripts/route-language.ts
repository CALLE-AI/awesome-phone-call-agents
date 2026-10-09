/**
 * Does the planner take the spoken language from the `locale` field, or from the
 * task text?
 *
 * Every route candidate tried so far was refused with the same sentence: the
 * destination is Peru and the language is Spanish. That was said even for
 * `en-US`, while the task text itself was written in Spanish. This probe holds
 * the number constant and varies only the task language, so the two possible
 * sources can be told apart.
 *
 * Both variants are expected to be refused, which costs nothing. The finding is
 * in how the refusal is worded.
 */

import { CalleClient } from "@call-e/calle";

const apiKey = process.env.CALLE_API_KEY ?? "";
const phone = process.env.CALLE_OWN_PHONE ?? "";
if (apiKey === "" || phone === "") {
  throw new Error("CALLE_API_KEY and CALLE_OWN_PHONE must be set.");
}

const client = new CalleClient({ apiKey });

const SCHEMA = {
  type: "object",
  required: ["heard_clearly"],
  properties: { heard_clearly: { type: "string", enum: ["yes", "no", "unknown"] } },
  additionalProperties: false,
};

const variants = [
  {
    label: "english-task",
    region: "US",
    locale: "en-US",
    task: "Say that you are an AI assistant, ask whether the person can hear you clearly, thank them and end the call.",
  },
  {
    label: "spanish-task",
    region: "US",
    locale: "en-US",
    task: "Habla en español. Di que eres un asistente de inteligencia artificial, pregunta si se te escucha con claridad, agradece y termina la llamada.",
  },
];

for (const variant of variants) {
  process.stdout.write(`\n[${variant.label}] region=${variant.region} locale=${variant.locale}\n`);
  try {
    const call = await client.calls.create(
      {
        task: variant.task,
        recipients: [{ phones: [phone], region: variant.region, locale: variant.locale }],
        recipientResultSchema: SCHEMA,
        metadata: { probe: "route-language", variant: variant.label },
      },
      { idempotencyKey: `route-language-${variant.label}-${Date.now()}` },
    );
    process.stdout.write(`  ACCEPTED. A call was created: ${call.id} (${call.status})\n`);
  } catch (error) {
    const e = error as Error & { code?: string; status?: number };
    process.stdout.write(`  ${e.code ?? e.name} ${e.status ?? ""}\n  ${e.message}\n`);
  }
}
