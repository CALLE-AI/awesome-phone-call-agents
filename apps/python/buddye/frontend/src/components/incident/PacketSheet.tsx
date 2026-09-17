import { useEffect, useState } from 'react'
import { api } from '../../api'
import { Sheet } from '../Sheet'
import { HandoffPacketView } from '../HandoffPacketView'
import type { HandoffPacket } from '../../types'

/**
 * The responder packet, in full, one click from the decision.
 *
 * It opens as a sheet rather than inline in the case, and that is a safety choice rather than a
 * layout one. `HandoffPacketView` carries its own release control, and releasing a packet — a named
 * person accepting responsibility for what an agency is about to be told — is a *different*
 * decision from authorising a dispatch. Stacking two name-typing gestures inside one expanded card
 * is how a screen starts reading as though the software were contacting the responder itself.
 *
 * Always fetched by id: the list payload from `/api/handoffs` omits the snapshots, and the address,
 * the access notes and the medical facts are exactly what a crew would be read. This is the one
 * surface in the console where showing them in full is the point.
 */
export function PacketSheet({
  packetId,
  captainName,
  onClose,
  onChanged,
}: {
  packetId: string
  captainName: string
  onClose: () => void
  onChanged?: () => void
}) {
  const [packet, setPacket] = useState<HandoffPacket | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const full = await api.handoff(packetId)
        if (live) setPacket(full)
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      live = false
    }
  }, [packetId])

  return (
    <Sheet
      title="Responder handoff packet"
      subtitle={
        packet
          ? packet.released
            ? `released by ${packet.released_by}`
            : 'prepared — nobody has been told'
          : 'loading the packet…'
      }
      onClose={onClose}
    >
      {error ? <p className="text-13 text-rejected">{error}</p> : null}
      {packet ? (
        <HandoffPacketView
          packet={packet}
          captainName={captainName}
          onReleased={(p) => {
            setPacket(p)
            onChanged?.()
          }}
        />
      ) : null}
    </Sheet>
  )
}
