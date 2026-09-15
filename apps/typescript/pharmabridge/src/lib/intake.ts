// Guards for AI-assisted intake: a model may only echo facts the caregiver actually typed.
import type { BloodGroup } from "./types";

const SIGN: Record<string, "+" | "-"> = {
  "+": "+",
  "+VE": "+",
  POS: "+",
  POSITIVE: "+",
  "-": "-",
  "-VE": "-",
  NEG: "-",
  NEGATIVE: "-",
};

/** Blood groups written in free text, such as "O negative", "B+ve", or "AB pos". */
export function statedBloodGroups(text: string): BloodGroup[] {
  const found = new Set<BloodGroup>();
  for (const match of text.toUpperCase().matchAll(/\b(AB|A|B|O)\s*(\+VE|-VE|\+|-|POSITIVE|NEGATIVE|POS\b|NEG\b)/g)) {
    found.add(`${match[1]}${SIGN[match[2]]}` as BloodGroup);
  }
  return [...found];
}
