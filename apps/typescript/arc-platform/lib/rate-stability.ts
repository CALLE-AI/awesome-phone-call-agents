/**
 * Did the caller settle on this number, or did it wander?
 *
 * The read-back gate protects against mishearing ONCE: the agent says the
 * figure back digit by digit and waits for a yes. It once did
 * exactly that, said "You said 1 2 5 3.", got a yes, and wrote PKR 1,253 into
 * a field called confirmedRatePkr.
 *
 * The gate had not failed. The call had. Speech recognition was collapsing
 * through the whole conversation - "chocho 500", "video chut 500", "Kyon 250"
 * - and the caller's rate arrived as 22500, then 500, then 250, then 500, then
 * 1253. The agent read back the last thing it heard, which is all a read-back
 * can ever do.
 *
 * The call that worked reads completely differently: 8000 at turn 20, 8000 at
 * 26, 8000 at 36. Same number, three times, then confirmed.
 *
 * That is the discriminator, and it needs no estimate to apply - which matters,
 * because plausibility() has no opinion without one and both of these calls had
 * none. A figure the caller said once, while saying other figures too, is not
 * the same evidence as a figure they repeated and then confirmed.
 */

/** Numbers that could be a rate. Deliberately loose - the point is to see how
 *  much the caller's answer MOVED, not to parse currency. */
const CANDIDATE = /\b\d[\d,]{2,}\b/g;

export interface RateStability {
  /** How many times the confirmed figure itself was said. */
  repeats: number;
  /** Other rate-shaped numbers the caller offered. */
  competing: number[];
  /** Said once, with other candidates in play. */
  unstable: boolean;
}

export function rateStability(
  turns: { speaker?: string; role?: string; text?: string; content?: string }[] | null | undefined,
  rate: number | null | undefined
): RateStability {
  const empty = { repeats: 0, competing: [], unstable: false };
  if (!rate || rate <= 0 || !Array.isArray(turns) || turns.length === 0) return empty;

  const said: number[] = [];
  for (const t of turns) {
    /* Only what the PERSON said. The agent repeats the figure back by design,
       so counting its turns would score every read-back as agreement. */
    const who = (t.speaker ?? t.role ?? "").toLowerCase();
    if (who !== "user") continue;
    const text = t.text ?? t.content ?? "";
    for (const m of text.matchAll(CANDIDATE)) {
      const n = Number(m[0].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) said.push(n);
    }
  }

  const repeats = said.filter((n) => n === rate).length;
  const competing = [...new Set(said.filter((n) => n !== rate))];

  /* Said once while other figures were also on the table. Said once with
     nothing competing is normal - most callers quote a rate a single time and
     confirm it, and that is fine. */
  return { repeats, competing, unstable: repeats <= 1 && competing.length >= 2 };
}
