/**
 * Injects operator annotations into an exported static replay's case.json.
 *
 * The ledger records only accepted transitions, so two things a cold reader
 * needs are absent from the raw export: the REFUSED attestation attempt (a
 * real dial whose evidence lives in the call logs, not the chain) and the
 * ASR keys→kids capture note. Both belong on the public replay page — the
 * page is the submission's proof surface, and a claim shown in the video must
 * be inspectable here. Usage: npx tsx scripts/annotate-replay.ts <dir>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "static-demo";
const path = join(dir, "case.json");
const view = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

view["annotations"] = [
  {
    title: "The refused read-back (a real dial that is deliberately NOT on this ledger)",
    body:
      'The first attestation call to Sunrise Property Mgmt returned a garbled nine-digit ' +
      'read-back — "454574624" — and the verifier found no contiguous correct code and ' +
      "refused to settle on it. The case stayed pending, the call was re-dialed with a " +
      'fresh idempotency key, and the clean "457624" recorded above came from the retry. ' +
      "Rejected attempts never enter the hash chain — their evidence lives in the call " +
      "platform's logs (the attempt is shown in the demo video). Ledgering refused " +
      "attempts is listed as future work in Evidence & Limits.",
  },
  {
    title: '"with the kids returned" — an ASR capture, kept as heard',
    body:
      'The speaker said "keys"; speech recognition transcribed "kids", and Caucus records ' +
      "terms AS HEARD. Both parties then attested to the 6-digit code derived from the " +
      "as-captured terms: dual attestation proves both parties heard the SAME recorded " +
      "terms — it does not, and cannot, prove ASR heard the speaker perfectly. This is " +
      "stated in the README's Evidence & Limits, and this annotation exists so a cold " +
      "reader of this page is not left guessing.",
  },
];

writeFileSync(path, JSON.stringify(view, null, 1));
console.log(`annotated ${path} (${(view["annotations"] as unknown[]).length} notes)`);
