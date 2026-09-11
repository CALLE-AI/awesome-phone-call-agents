/**
 * Built-in business directory so users can pick a target instead of hunting
 * for an E.164 number — the highest-friction step in the flow.
 *
 * Two kinds of entries:
 *  - `national`: real, publicly listed US customer-service lines for major
 *    brands (verify before calling — numbers can change).
 *  - `local-demo`: fictional local businesses with reserved-style numbers,
 *    used to demo Quote Shootout ("dentist near me" → pick several).
 */

export interface DirectoryEntry {
  name: string
  category: string
  keywords: string[]
  phone: string
  region: string
  locale: string
  kind: 'national' | 'local-demo'
}

const national = (name: string, category: string, keywords: string[], phone: string): DirectoryEntry => ({
  name,
  category,
  keywords,
  phone,
  region: 'US',
  locale: 'en-US',
  kind: 'national',
})

const demo = (name: string, category: string, keywords: string[], phone: string): DirectoryEntry => ({
  name,
  category,
  keywords,
  phone,
  region: 'US',
  locale: 'en-US',
  kind: 'local-demo',
})

export const DIRECTORY: DirectoryEntry[] = [
  // National customer-service lines (publicly listed; verify before calling).
  national('Comcast / Xfinity', 'Internet & TV', ['comcast', 'xfinity', 'internet', 'cable', 'billing'], '+18009346489'),
  national('AT&T', 'Internet & Wireless', ['att', 'at&t', 'internet', 'wireless', 'billing'], '+18002882020'),
  national('Verizon Wireless', 'Wireless', ['verizon', 'wireless', 'phone', 'billing'], '+18009220204'),
  national('T-Mobile', 'Wireless', ['tmobile', 't-mobile', 'wireless', 'phone'], '+18009378997'),
  national('Delta Air Lines', 'Airline', ['delta', 'airline', 'flight', 'refund'], '+18002211212'),
  national('United Airlines', 'Airline', ['united', 'airline', 'flight', 'refund'], '+18008648331'),
  national('American Airlines', 'Airline', ['american', 'airline', 'flight'], '+18004337300'),
  national('Amazon', 'Retail', ['amazon', 'order', 'refund', 'delivery'], '+18882804331'),
  national('Chase', 'Banking', ['chase', 'bank', 'card', 'dispute'], '+18009359935'),
  national('Bank of America', 'Banking', ['bank of america', 'bofa', 'bank', 'card'], '+18004321000'),
  national('PayPal', 'Payments', ['paypal', 'payment', 'dispute', 'refund'], '+18882211161'),
  national('Netflix', 'Subscription', ['netflix', 'subscription', 'cancel'], '+18665797172'),

  // Demo directory — fictional local businesses for Quote Shootout demos.
  demo('Bright Smile Dental', 'Dentist', ['dentist', 'dental', 'teeth', 'cleaning'], '+14155550134'),
  demo('Lakeview Dental Care', 'Dentist', ['dentist', 'dental', 'teeth'], '+14155550172'),
  demo('Pearl District Dentistry', 'Dentist', ['dentist', 'dental'], '+14155550199'),
  demo("Mike's Auto Repair", 'Auto repair', ['auto', 'car', 'mechanic', 'brake', 'repair'], '+14155550111'),
  demo('City Garage', 'Auto repair', ['auto', 'car', 'mechanic', 'repair'], '+14155550122'),
  demo('AutoWorks Collision', 'Auto repair', ['auto', 'car', 'body', 'collision'], '+14155550133'),
  demo('Precision Motors', 'Auto repair', ['auto', 'car', 'mechanic'], '+14155550144'),
  demo('RapidFlow Plumbing', 'Plumber', ['plumber', 'plumbing', 'leak', 'drain'], '+14155550155'),
  demo('Bayside Plumbing Co.', 'Plumber', ['plumber', 'plumbing', 'water heater'], '+14155550166'),
  demo("Luigi's Trattoria", 'Restaurant', ['restaurant', 'italian', 'dinner', 'reservation'], '+14155550177'),
  demo('Sakura Sushi House', 'Restaurant', ['restaurant', 'sushi', 'japanese', 'reservation'], '+14155550188'),
  demo('Shear Bliss Salon', 'Salon', ['salon', 'hair', 'haircut', 'appointment'], '+14155550115'),
]

/** Simple scored search over name / category / keywords. */
export function searchDirectory(query: string, limit = 8): DirectoryEntry[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const terms = q.split(/\s+/).filter(Boolean)

  const scored = DIRECTORY.map((e) => {
    const hay = `${e.name} ${e.category} ${e.keywords.join(' ')}`.toLowerCase()
    let score = 0
    for (const t of terms) {
      if (e.name.toLowerCase().startsWith(t)) score += 5
      else if (e.name.toLowerCase().includes(t)) score += 3
      if (e.category.toLowerCase().includes(t)) score += 2
      if (e.keywords.some((k) => k.startsWith(t))) score += 2
      else if (hay.includes(t)) score += 1
    }
    return { e, score }
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map((x) => x.e)
}
