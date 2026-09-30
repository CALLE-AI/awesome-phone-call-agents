/**
 * Monograms for the marketplace cards: two letters on a colour, no images.
 *
 * We hold no logos and no photographs for 68 contacts, and an AI-generated
 * face on a real person's card would be a picture of someone who does not
 * exist. Initials on a stable colour identify a row without claiming anything
 * about how it looks.
 *
 * The colour is derived from the catalogue id, so a station is the same colour
 * on the directory, on its profile page and in a plan - which is the only
 * reason a colour is worth anything here. Palette is the design system's own
 * tones; all six are light enough for `text-ink`.
 */

const TONES = [
  "bg-lilac", "bg-blush", "bg-butter",
  "bg-lilac-deep", "bg-blush-deep", "bg-butter-deep",
] as const;

export type MonogramTone = (typeof TONES)[number];

/** FNV-1a. Stable across machines and runs, which `Math.random` and object
 *  identity are not. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function monogramTone(id: string): MonogramTone {
  return TONES[hash(id) % TONES.length];
}

/**
 * Two letters, chosen the way a person would read the name aloud.
 *
 * Words that start with a digit are skipped, because a frequency is not part
 * of the name: "City FM 89" is CF, not C8. A single-word name gives up its
 * first two letters instead - "FM 100" is FM.
 */
export function monogramInitials(name: string): string {
  const words = name
    .split(/[\s\-/]+/)
    .filter((w) => /^[A-Za-z]/.test(w));

  if (words.length === 0) return name.slice(0, 2).toUpperCase() || "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
