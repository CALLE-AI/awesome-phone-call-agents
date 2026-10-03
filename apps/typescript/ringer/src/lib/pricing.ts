export interface CostEstimate {
  calls: number
  total: number | null
  formattedTotal: string
  breakdown: string
}

export function estimateCost(calls: number): CostEstimate {
  const n = Math.max(0, Math.floor(calls))
  return {
    calls: n,
    total: n === 0 ? 0 : null,
    formattedTotal: n === 0 ? '$0.00' : 'See Dashboard billing',
    breakdown: `${n} call${n === 1 ? '' : 's'} · usage-based charges`,
  }
}
