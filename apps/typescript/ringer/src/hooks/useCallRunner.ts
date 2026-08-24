import { useCallback, useEffect, useRef, useState } from 'react'
import type { CallTask, DeveloperEvent } from '@/lib/calle/types'
import { isTerminal } from '@/lib/calle/types'
import {
  createCall,
  decideCall,
  getCall,
  getEvents,
  type CalleSettings,
  type CreatePayload,
} from '@/lib/calle/client'
import type { DemoDecision } from '@/lib/calle/demoEngine'

export type RunnerState = 'idle' | 'creating' | 'running' | 'done' | 'error'

export interface CallRunner {
  state: RunnerState
  call: CallTask | null
  events: DeveloperEvent[]
  error: string | null
  errorCode: string | null
  start: (payload: CreatePayload, settings: CalleSettings) => Promise<void>
  /** Resolve a mid-call approval checkpoint (human-in-the-loop). */
  decide: (choice: DemoDecision) => Promise<void>
  reset: () => void
}

export function useCallRunner(): CallRunner {
  const [state, setState] = useState<RunnerState>('idle')
  const [call, setCall] = useState<CallTask | null>(null)
  const [events, setEvents] = useState<DeveloperEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelled = useRef(false)
  const callIdRef = useRef<string | null>(null)

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  const reset = useCallback(() => {
    cancelled.current = true
    callIdRef.current = null
    stopPolling()
    setState('idle')
    setCall(null)
    setEvents([])
    setError(null)
    setErrorCode(null)
  }, [stopPolling])

  const start = useCallback(
    async (payload: CreatePayload, settings: CalleSettings) => {
      cancelled.current = false
      stopPolling()
      setState('creating')
      setCall(null)
      setEvents([])
      setError(null)
      setErrorCode(null)

      callIdRef.current = null
      let id: string
      try {
        const created = await createCall(payload, settings)
        id = created.id
        callIdRef.current = id
      } catch (err: any) {
        if (cancelled.current) return
        setError(err?.message ?? 'Failed to start the call.')
        setErrorCode(err?.code ?? 'error')
        setState('error')
        return
      }

      if (cancelled.current) return
      setState('running')

      const interval = settings.mode === 'demo' ? 650 : 2500

      const poll = async () => {
        try {
          const [next, evs] = await Promise.all([
            getCall(id, settings),
            getEvents(id, settings).catch(() => ({ object: 'list' as const, data: [] })),
          ])
          if (cancelled.current) return
          setCall(next)
          setEvents(evs.data)
          if (isTerminal(next.status)) {
            stopPolling()
            setState('done')
          }
        } catch (err: any) {
          if (cancelled.current) return
          // Transient errors: keep polling a few times before giving up.
          setError(err?.message ?? 'Lost connection to the call.')
          setErrorCode(err?.code ?? 'error')
        }
      }

      void poll()
      timer.current = setInterval(poll, interval)
    },
    [stopPolling],
  )

  const decide = useCallback(async (choice: DemoDecision) => {
    const id = callIdRef.current
    if (!id) return
    await decideCall(id, choice)
  }, [])

  useEffect(() => {
    return () => {
      cancelled.current = true
      stopPolling()
    }
  }, [stopPolling])

  return { state, call, events, error, errorCode, start, decide, reset }
}
