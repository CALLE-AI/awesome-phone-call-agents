/** "Maya Reyner" -> "MR", "maya@example.com" -> "MA". Always two characters. */
export function initialsFor(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.split('@')[0] || '?';
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const raw = words.length > 1 ? words[0][0] + words[1][0] : source.slice(0, 2);

  return raw.toUpperCase();
}
