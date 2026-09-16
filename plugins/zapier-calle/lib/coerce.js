// Safe coercion of raw Zapier input.
//
// Every input arrives as whatever the user mapped into it, which is not
// always a scalar - a mapped line-item field arrives as an array. The obvious
// `Number(value)` is fail-open for exactly that case: `Number([])` is 0, so
// an accidentally-mapped empty list silently becomes the most permissive
// possible setting for any threshold. That bug was live in three separate
// hand-rolled coercers before this module existed; keep numeric parsing here
// so there is one place to get it right.
export function toFiniteNumber(value, fallback) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed === '') return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}
