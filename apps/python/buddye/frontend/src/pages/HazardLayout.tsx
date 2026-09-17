import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useEventStream } from '../hooks/useEventStream'
import { useNotifications } from '../hooks/useNotifications'
import { AppShell } from '../components/shell/AppShell'
import { Button, buttonClass } from '../components/ui/Button'
import { HazardContext } from '../state/hazard'
import type { HazardWorld } from '../state/hazard'
import type { NavCounts } from '../lib/nav'
import { awaitingApproval, incidentIsOpen, isRolling } from '../lib/operator'
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

/**
 * The single owner of one hazard's data, and the frame around every page.
 *
 * One SSE connection, one set of REST rows, every screen a reader. That has not changed and must
 * not: nesting the pages under this layout route is what makes a navigation a re-render rather than
 * a reconnect, and moving between a case and the incident it raised has to keep the stream that is
 * feeding both.
 *
 * What is new is that the same stream now also carries the console's notifications. The backend
 * taps its event bus and republishes each derived ping as a `notification` event, so
 * `useNotifications` reads them straight out of `stream.events` — no second connection, no poll,
 * and no chance of a ping arriving on a different clock from the event that caused it.
 */
export default function HazardLayout() {
  const { hazardId } = useParams<{ hazardId: string }>()
  const navigate = useNavigate()

  const [hazards, setHazards] = useState<Hazard[]>([])
  const [hazard, setHazard] = useState<Hazard | null>(null)
  const [roster, setRoster] = useState<Neighbour[]>([])
  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [packets, setPackets] = useState<HandoffPacket[]>([])
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [pending, setPending] = useState<PendingDispatch[]>([])
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [busyDemo, setBusyDemo] = useState(false)

  const hazardIdRef = useRef<string | undefined>(hazardId)
  hazardIdRef.current = hazardId

  const refetch = useCallback(async () => {
    const id = hazardIdRef.current
    if (!id) return
    try {
      const [h, n, e, p, d, inc, as, pend] = await Promise.all([
        api.hazard(id),
        api.neighbours(id),
        api.escalations(id),
        api.handoffs(id),
        api.dashboard(),
        api.incidents(id),
        api.assets(),
        api.pendingDispatches(id),
      ])
      // The coordinator switched hazards while these were in flight. Dropping the whole batch is
      // the only safe move: half of it describes a block that is no longer on screen.
      if (hazardIdRef.current !== id) return
      setHazard(h)
      setRoster(n)
      setEscalations(e)
      setPackets(p)
      setDashboard(d)
      setIncidents(inc)
      setAssets(as)
      setPending(pend)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const stream = useEventStream(hazardId, refetch)
  const feed = useNotifications(hazardId, stream.events, dashboard?.block_captain ?? '')

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.hazards()
        setHazards(list)
        if (!hazardId && list.length) navigate(`/hazards/${list[0].id}`, { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [hazardId, navigate])

  // Switching hazards changes the param without remounting, so the previous block's rows would
  // render under the new headline until the refetch lands. Empty for a beat is honest; the heat
  // sweep's incidents under a power-cut headline is not.
  useEffect(() => {
    if (!hazardId) return
    setHazard(null)
    setRoster([])
    setEscalations([])
    setPackets([])
    setIncidents([])
    setPending([])
    void refetch()
  }, [hazardId, refetch])

  const startSweep = useCallback(async () => {
    const id = hazardIdRef.current
    if (!id) return
    setStarting(true)
    try {
      await api.startSweep(id)
      await refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }, [refetch])

  const demo = async (fn: () => Promise<unknown>, goToNewest: boolean) => {
    setBusyDemo(true)
    try {
      await fn()
      const list = await api.hazards()
      setHazards(list)
      if (goToNewest && list.length) navigate(`/hazards/${list[0].id}`)
      else await refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyDemo(false)
    }
  }

  const world = useMemo<HazardWorld | null>(
    () =>
      hazardId
        ? {
            hazardId,
            hazards,
            hazard,
            roster,
            escalations,
            packets,
            dashboard,
            incidents,
            assets,
            pending,
            stream,
            error,
            setError,
            refetch,
            startSweep,
            starting,
            operatorName: dashboard?.block_captain ?? '',
          }
        : null,
    [hazardId, hazards, hazard, roster, escalations, packets, dashboard, incidents, assets, pending, stream, error, refetch, startSweep, starting],
  )

  /**
   * The numbers on the rail.
   *
   * Incidents carries the one badge in the console that is allowed to be red, and the number it
   * shows is how many deployment cases are open — not how many are waiting on a human. The colour
   * carries that instead: red means at least one of these has an agency unit prepared and unsent,
   * which is the only situation where the evening has genuinely stopped moving until somebody
   * decides. Two facts, one glyph, and neither of them dressed up as the other.
   *
   * Approvals never wears a count. It is the record of what was decided; a number on it would
   * invite people to work from it, and the deciding happens on Incidents.
   */
  const counts = useMemo<NavCounts>(() => {
    const open = incidents.filter(incidentIsOpen)
    const waiting = pending.length || open.filter((i) => i.dispatches.some(awaitingApproval)).length
    const out = assets.filter((a) => a.status === 'EN_ROUTE' || a.status === 'ON_SCENE').length
    const rolling = incidents.reduce((n, i) => n + i.dispatches.filter(isRolling).length, 0)
    // `open.length || waiting` rather than `open.length`: a prepared agency request whose incident
    // has already been closed out still has nobody's decision on it, and a badge that disappears
    // while something is unsent is the one failure mode this number is here to prevent.
    const shown = open.length || waiting
    return {
      incidents: shown
        ? {
            value: shown,
            tone: waiting > 0 ? 'urgent' : 'muted',
            title:
              waiting > 0
                ? `${open.length} open deployment case${open.length === 1 ? '' : 's'} — ${waiting} prepared and waiting on your approval`
                : `${open.length} open deployment case${open.length === 1 ? '' : 's'}`,
          }
        : undefined,
      operations: rolling ? { value: rolling, tone: 'muted', title: `${rolling} on the road` } : undefined,
      fleet: out ? { value: out, tone: 'muted', title: `${out} unit${out === 1 ? '' : 's'} out` } : undefined,
    }
  }, [incidents, pending, assets])

  return (
    <AppShell
      hazardId={hazardId}
      hazard={hazard}
      dashboard={dashboard}
      connection={stream.connection}
      counts={counts}
      feed={feed}
      error={error}
      onDismissError={() => setError(null)}
      actions={
        <>
          <Button size="sm" variant="secondary" disabled={busyDemo} onClick={() => void demo(api.declareOutage, true)}>
            Declare a power cut
          </Button>
          <Button size="sm" variant="ghost" disabled={busyDemo} onClick={() => void demo(api.reset, true)}>
            Reset
          </Button>
          {hazard?.active_sweep_id && (
            <a
              className={buttonClass({ variant: 'ghost', size: 'sm' })}
              href={api.traceUrl(hazard.active_sweep_id)}
              target="_blank"
              rel="noreferrer"
            >
              Audit trace
            </a>
          )}
        </>
      }
    >
      {world ? (
        <HazardContext.Provider value={world}>
          <Outlet />
        </HazardContext.Provider>
      ) : (
        <p className="card px-4 py-6 text-center text-13 text-muted">Loading the block…</p>
      )}
    </AppShell>
  )
}
