/**
 * One hazard's world, shared by every screen.
 *
 * The console is five views of the same evening, and they must not be five copies of it. Each page
 * mounting its own `useEventStream` would abort and re-open the SSE connection on every tab switch
 * and replay the hazard's entire history to do it — so the layout route owns exactly one stream and
 * one set of REST rows, and the pages are readers.
 *
 * The context lives in its own module rather than beside the layout component so that a page can
 * import `useHazard` without importing the layout, and so the file stays free of JSX (Fast Refresh
 * dislikes a module that exports both a component and a hook).
 */
import { createContext, useContext } from 'react'
import type { EventStream } from '../hooks/useEventStream'
import type {
  Asset,
  Dashboard,
  Escalation,
  HandoffPacket,
  Hazard,
  IncidentRow,
  Neighbour,
  PendingDispatch,
} from '../types'

export interface HazardWorld {
  hazardId: string
  hazards: Hazard[]
  hazard: Hazard | null
  roster: Neighbour[]
  escalations: Escalation[]
  packets: HandoffPacket[]
  dashboard: Dashboard | null

  /** The operator layer. Incidents are worst-first as the API returns them. */
  incidents: IncidentRow[]
  assets: Asset[]
  /** Agency units an agent has prepared and NOT requested. The Approvals queue. */
  pending: PendingDispatch[]

  stream: EventStream
  error: string | null
  setError: (message: string | null) => void
  /** Re-read every REST row for this hazard. Debounced by the stream; safe to call directly. */
  refetch: () => Promise<void>

  startSweep: () => Promise<void>
  starting: boolean
  /** Who is on shift. Pre-fills every field that has to carry a human's name. */
  operatorName: string
}

export const HazardContext = createContext<HazardWorld | null>(null)

export function useHazard(): HazardWorld {
  const value = useContext(HazardContext)
  if (!value) throw new Error('useHazard() outside a hazard route')
  return value
}
