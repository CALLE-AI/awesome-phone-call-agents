import { useCalleStatus } from '../hooks/useCalleStatus'

function providerShort(p: string | undefined): string {
  if (!p) return ''
  if (p === 'calle_sdk') return 'sdk'
  if (p === 'calle_mcp') return 'mcp'
  return p
}

export function ConnectionStrip() {
  const { status, error } = useCalleStatus()
  const ready = !!status?.ready
  const dot = status ? (ready ? '#2f8a5b' : '#9a6a12') : error ? '#9a6a12' : '#d9d9d4'
  const title = status
    ? [
        `sdk importable ${status.sdk?.importable} · api key ${status.sdk?.api_key_present}`,
        `cli found ${status.cli?.found} · authenticated ${status.cli?.authenticated}`,
        `mcp reachable ${status.mcp?.reachable}`,
        `reconciler ${status.reconciler}`,
      ].join('\n')
    : error ?? undefined

  return (
    <div className="flex h-7 items-center gap-2 rounded border border-border bg-strip px-2.5 font-mono text-12" title={title}>
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} />
      <span className="text-text">CALL-E</span>
      {status ? (
        <>
          {status.live && <span className="h-[7px] w-[7px] rounded-full bg-verified" />}
          <span className="text-muted">{providerShort(status.provider)}</span>
          {status.live && <span className="text-muted">allowlist {status.allowlist_count}</span>}
          <span className="h-3 w-px bg-border" />
          <span className="text-muted">
            live calls {status.budget?.used ?? 0} / {status.budget?.max ?? 0}
          </span>
        </>
      ) : error ? (
        <span className="text-partial">unreachable</span>
      ) : null}
    </div>
  )
}
