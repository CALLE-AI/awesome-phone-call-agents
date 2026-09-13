import { formatMoney } from './format'

/**
 * CALL-E early-stage pricing: $0.05 per billable (completed) call. New accounts
 * include a free allowance (200 on signup; the hackathon grants 20). We surface
 * an estimate before a run so the cost of a batch (Quote Shootout = N calls) is
 * never a surprise.
 */
export const PRICE_PER_CALL = 0.05

export interface CostEstimate {
  calls: number
  total: number
  formattedTotal: string
  formattedPerCall: string
  /** e.g. "3 calls × $0.05 = $0.15" */
  breakdown: string
}

export function estimateCost(calls: number): CostEstimate {
  const n = Math.max(0, Math.floor(calls))
  const total = n * PRICE_PER_CALL
  const formattedTotal = formatMoney(total) ?? '$0.00'
  const formattedPerCall = formatMoney(PRICE_PER_CALL) ?? '$0.05'
  return {
    calls: n,
    total,
    formattedTotal,
    formattedPerCall,
    breakdown: `${n} call${n === 1 ? '' : 's'} × ${formattedPerCall} = ${formattedTotal}`,
  }
}
