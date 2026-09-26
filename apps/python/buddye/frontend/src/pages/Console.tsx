import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useHazard } from '../state/hazard'
import { HazardHeader } from '../components/HazardHeader'
import { LiveCallStrip } from '../components/LiveCallStrip'
import { AttentionCard, RosterRow, SafeRow } from '../components/NeighbourCards'
import { UnaccountedBlock } from '../components/UnaccountedBlock'
import { SweepTally } from '../components/SweepTally'
import { NeighbourPanel } from '../components/NeighbourPanel'
import { HandoffPacketView } from '../components/HandoffPacketView'
import { EventLog } from '../components/EventLog'
import { Sheet } from '../components/Sheet'
import { CheckCircleIcon, LockIcon } from '../components/Icons'
import { buildBoard, needsYouNow, pendingPackets, rosterOrder, settled, unaccountedFor } from '../lib/board'
import { phaseIsLive } from '../lib/status'
import type { HandoffPacket } from '../types'

/**
 * The call-by-call view: the sweep as it happens.
 *
 * The page is ordered by what a stressed volunteer needs first, not by what the data model finds
 * tidy: whoever needs a human tonight is at the top, everyone nobody has accounted for is next
 * because they are the people a check-in programme loses, the full triaged roster is below that,
 * and the neighbours who are fine are a small green block at the bottom — present, because knowing
 * that eleven people are alright is most of the reassurance this thing exists to provide, and quiet,
 * because they do not need her.
 *
 * It reads the hazard's data from the layout route rather than fetching its own, so that switching
 * to the map does not tear down the SSE connection and replay the whole evening to rebuild it.
 */
export default function Console() {
  const { hazard, hazards, hazardId, roster, escalations, packets, stream, dashboard, refetch, startSweep, starting, setError } =
    useHazard()
  const navigate = useNavigate()
  const [openNeighbourId, setOpenNeighbourId] = useState<string | null>(null)
  const [openPacket, setOpenPacket] = useState<HandoffPacket | null>(null)

  const board = useMemo(() => buildBoard(roster, stream, escalations, packets), [roster, stream, escalations, packets])
  const attention = useMemo(() => needsYouNow(board), [board])
  const calm = useMemo(() => settled(board), [board])
  const everyone = useMemo(() => rosterOrder(board), [board])
  const missing = useMemo(() => unaccountedFor(board, stream), [board, stream])
  const pending = useMemo(() => pendingPackets(packets), [packets])
  const callsDone = useMemo(() => Object.keys(stream.decisions).length, [stream.decisions])

  const liveCall = useMemo(() => {
    for (let i = stream.callOrder.length - 1; i >= 0; i--) {
      const c = stream.calls[stream.callOrder[i]]
      if (c && phaseIsLive(c.phase)) return c
    }
    return null
  }, [stream.callOrder, stream.calls])

  const openPerson = useMemo(() => board.find((p) => p.n.id === openNeighbourId) ?? null, [board, openNeighbourId])
  const cutsPower = !!hazard?.profile?.cuts_power

  /** Always open the FULL packet. The list payload deliberately omits the snapshots, and a packet
   *  rendered from it would show an empty address to somebody deciding whether to send help. */
  const openFullPacket = async (id: string) => {
    try {
      setOpenPacket(await api.handoff(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onPacketReleased = (p: HandoffPacket) => {
    setOpenPacket(p)
    void refetch()
  }

  return (
    <>
      {hazard ? (
        <HazardHeader
          hazard={hazard}
          hazards={hazards}
          stream={stream}
          onSelect={(id) => navigate(`/hazards/${id}/live`)}
          onStart={() => void startSweep()}
          starting={starting}
          callsDone={callsDone}
        />
      ) : (
        <p className="card mb-4 px-4 py-6 text-center text-13 text-muted">Loading the block…</p>
      )}

      {stream.sweepState && <SweepTally board={board} unaccounted={missing} />}

      {liveCall && <LiveCallStrip call={liveCall} onOpen={() => setOpenNeighbourId(liveCall.neighbour_id)} />}

      {/* Packets waiting on a person. Stated as a decision she has not made yet, never as
          something in flight — nothing has been sent and the banner must not suggest otherwise. */}
      {pending.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-partial/40 bg-partial-tint px-4 py-3">
          <span className="text-partial">
            <LockIcon size={16} />
          </span>
          <span className="text-13 leading-snug text-text">
            <strong className="font-semibold">
              {pending.length} responder packet{pending.length === 1 ? '' : 's'} prepared and waiting on you.
            </strong>{' '}
            Nobody has been contacted. Only you can release one.
          </span>
          <button type="button" className="btn-secondary ml-auto h-8 min-h-0 py-0 text-12" onClick={() => void openFullPacket(pending[0].id)}>
            Read it
          </button>
        </div>
      )}

      {attention.length > 0 && (
        <section className="mb-5">
          <h2 className="label mb-2">Needs you now · {attention.length}</h2>
          <div className="space-y-2.5">
            {attention.map((p) => (
              <AttentionCard
                key={p.n.id}
                p={p}
                showPower={cutsPower}
                onOpen={() => setOpenNeighbourId(p.n.id)}
                onOpenPacket={p.packet ? () => void openFullPacket(p.packet!.id) : undefined}
              />
            ))}
          </div>
        </section>
      )}

      {attention.length === 0 && stream.sweepState === 'COMPLETE' && (
        <div className="card-calm mb-5 flex items-center gap-2.5 px-4 py-3.5">
          <CheckCircleIcon size={18} />
          <span className="text-13 text-text">Nobody on this block needs you right now.</span>
        </div>
      )}

      <UnaccountedBlock rows={missing} />

      <section className="card mb-4 overflow-hidden">
        <div className="flex items-baseline gap-2 border-b border-divider px-4 py-2.5">
          <span className="label">The block, worst first</span>
          <span className="ml-auto font-mono text-11 text-faint">{everyone.length} neighbours</span>
        </div>
        {everyone.map((p) => (
          <RosterRow key={p.n.id} p={p} onOpen={() => setOpenNeighbourId(p.n.id)} />
        ))}
        {everyone.length === 0 && <p className="px-4 py-6 text-center text-13 text-muted">No roster loaded.</p>}
      </section>

      {calm.length > 0 && (
        <section className="card-calm mb-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <CheckCircleIcon size={16} />
            <span className="text-13 font-medium text-text">
              {calm.length} neighbour{calm.length === 1 ? '' : 's'} confirmed alright
            </span>
          </div>
          <div className="mt-1.5 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
            {calm.map((p) => (
              <SafeRow key={p.n.id} p={p} onOpen={() => setOpenNeighbourId(p.n.id)} />
            ))}
          </div>
        </section>
      )}

      <EventLog events={stream.events} />

      <p className="px-1 pb-6 text-11 leading-snug text-faint">
        BuddyE calls neighbours and the people they nominate. It never calls 911 or any agency: for a responder it
        prepares a packet, and a named person decides whether to release it.
      </p>

      {openPerson && (
        <NeighbourPanel
          person={openPerson}
          hazardId={hazardId}
          captainName={dashboard?.block_captain ?? ''}
          escalation={openPerson.escalation}
          onClose={() => setOpenNeighbourId(null)}
          onChanged={() => void refetch()}
        />
      )}

      {openPacket && (
        <Sheet
          title="Responder handoff packet"
          subtitle={openPacket.released ? `released by ${openPacket.released_by}` : 'prepared — nobody has been told'}
          onClose={() => setOpenPacket(null)}
        >
          <HandoffPacketView packet={openPacket} captainName={dashboard?.block_captain ?? ''} onReleased={onPacketReleased} />
        </Sheet>
      )}
    </>
  )
}
