/**
 * Who the agent says it is calling on behalf of.
 *
 * This is the first sentence of every call, so it is the one string a stranger
 * hears before deciding whether to keep listening.
 *
 * It used to be the campaign name split on a dash. Campaign names here are
 * conventionally "<Brand> - <Season>", so that worked for "Zeb Modest Wear -
 * Eid 2026" and produced "Zeb Modest Wear". A name with no dash was used whole,
 * and a campaign named "It's our founder Birthday Month" made the agent
 * open by introducing that campaign as the advertiser - a campaign naming
 * itself as the company paying for the spot.
 *
 * The brand was on the record the whole time and nothing read it. But the brand
 * is not simply better: that campaign's brand is "Coac Tal", which is right,
 * while "Zeb Modest Wear - Eid 2026" belongs to a brand named after the person
 * who signed up, so preferring the brand everywhere would trade one wrong
 * opening for another.
 *
 * So the dash decides. A dash means the author already told us where the brand
 * ends, and that beats guessing; without one the campaign name is a slogan and
 * the brand is the better answer.
 */
export function advertiserName(
  campaignName: string,
  brandName?: string | null
): string {
  const name = (campaignName ?? "").trim();
  const brand = (brandName ?? "").trim();

  /* An em dash, en dash or hyphen, surrounded by space - "Eid-ul-Fitr" is one
     word and must not be cut at the hyphen. */
  const parts = name.split(/\s+[—–-]\s+/);
  if (parts.length > 1 && parts[0].trim()) return parts[0].trim();

  if (brand) return brand;

  /* No dash and no brand. The whole name is still better than nothing, and
     this is the case the old code applied to everything. */
  return name;
}
