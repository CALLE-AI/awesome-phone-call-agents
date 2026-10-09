/**
 * Minimal fetch + ReadableStream SSE client.
 *
 * We do not use EventSource because the server sets `event:` to arbitrary names
 * (`provider.call.status.<status>`, CALL-E developer event types, ...) and EventSource
 * only delivers named events you registered up front. Parsing the stream ourselves
 * lets every event type, known or unknown, reach the reducer.
 */
export interface SseMessage {
  id: string | null
  event: string
  data: string
}

export interface SseOptions {
  signal: AbortSignal
  onMessage: (msg: SseMessage) => void
  onOpen?: () => void
  /** Called when the stream ends or errors (not on abort). */
  onClose?: (err?: unknown) => void
}

export async function consumeSse(url: string, opts: SseOptions): Promise<void> {
  const { signal } = opts
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' }, signal })
  } catch (err) {
    if (signal.aborted) return
    opts.onClose?.(err)
    return
  }
  if (!res.ok || !res.body) {
    opts.onClose?.(new Error(`SSE HTTP ${res.status}`))
    return
  }
  opts.onOpen?.()

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let id: string | null = null
  let event = 'message'
  let data: string[] = []

  const dispatch = () => {
    if (data.length > 0) {
      opts.onMessage({ id, event, data: data.join('\n') })
    }
    id = null
    event = 'message'
    data = []
  }

  const handleLine = (raw: string) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line === '') {
      dispatch()
      return
    }
    if (line.startsWith(':')) return // comment / keepalive
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    switch (field) {
      case 'id':
        id = value
        break
      case 'event':
        event = value
        break
      case 'data':
        data.push(value)
        break
      default:
        break // retry / unknown fields ignored
    }
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        handleLine(line)
      }
    }
    if (buffer.length) handleLine(buffer)
    dispatch()
    if (!signal.aborted) opts.onClose?.()
  } catch (err) {
    if (!signal.aborted) opts.onClose?.(err)
  }
}
