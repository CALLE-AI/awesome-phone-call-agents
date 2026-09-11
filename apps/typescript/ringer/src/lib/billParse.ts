/**
 * Heuristic bill parsing: extract provider, monthly amount, account reference,
 * and a plan line from raw bill text (PDF-extracted or pasted).
 */

export interface ParsedBill {
  provider: string | null
  amount: number | null
  accountRef: string | null
  planLine: string | null
}

const PROVIDERS = [
  'Comcast', 'Xfinity', 'AT&T', 'Verizon', 'Spectrum', 'T-Mobile', 'Cox',
  'CenturyLink', 'Frontier', 'Optimum', 'DirecTV', 'Dish', 'Sprint',
  'Google Fiber', 'Planet Fitness', 'Anytime Fitness', 'State Farm', 'GEICO',
  'Progressive', 'Allstate', 'ADT', 'SiriusXM',
]

export function parseBillText(text: string): ParsedBill {
  const clean = text.replace(/\r/g, '')
  const lower = clean.toLowerCase()

  // Provider: first known brand mentioned.
  let provider: string | null = null
  for (const p of PROVIDERS) {
    if (lower.includes(p.toLowerCase())) {
      provider = p
      break
    }
  }

  // Amount: prefer figures near "total / amount due / monthly".
  let amount: number | null = null
  const dueMatch = clean.match(
    /(?:total(?:\s+amount)?\s+due|amount\s+due|monthly\s+(?:charge|total|rate)|new\s+charges)[^$\n]{0,40}\$\s*([0-9]{1,4}(?:\.[0-9]{2})?)/i,
  )
  if (dueMatch) {
    amount = Number(dueMatch[1])
  } else {
    const all = [...clean.matchAll(/\$\s*([0-9]{1,4}(?:\.[0-9]{2})?)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 5 && n < 2000)
    if (all.length) amount = Math.max(...all)
  }

  // Account reference.
  const accMatch = clean.match(
    /account\s*(?:number|no\.?|#)?\s*[:\-]?\s*([0-9][0-9 \-]{5,18}[0-9])/i,
  )
  const accountRef = accMatch ? accMatch[1].replace(/\s+/g, ' ').trim() : null

  // Plan line: a shortish line that names a plan/package.
  let planLine: string | null = null
  for (const line of clean.split('\n')) {
    const t = line.trim()
    if (t.length >= 8 && t.length <= 70 && /\b(plan|package|internet|bundle|tier|unlimited)\b/i.test(t) && !/due|account|page/i.test(t)) {
      planLine = t
      break
    }
  }

  return { provider, amount, accountRef, planLine }
}

/** Bundled sample bill so the flow can be demoed without uploading anything. */
export const SAMPLE_BILL_TEXT = `
Xfinity by Comcast
Monthly statement

Account Number: 8155 20 021 4433719
Statement date: July 2, 2026

Your plan: Superfast Internet 800 Mbps plan
Promotional pricing ended 06/28/2026

Previous balance            $79.99
Payment received            -$79.99
New charges                 $95.00

Total amount due: $95.00
Due date: July 28, 2026
`.trim()
