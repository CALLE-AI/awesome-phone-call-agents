import Link from "next/link";
import { toggleKill } from "@/app/actions";
import { getConsoleState } from "@/lib/queries";

type ConsoleShellProps = {
  eventId?: string;
  eventName?: string;
  active?: "coverage" | "roster" | "wave" | "instrument" | "call";
  tight?: boolean;
  children: React.ReactNode;
};

function navClass(on: boolean) {
  return on
    ? "rounded-full bg-ink px-3.5 py-1.5 text-sm font-medium text-white"
    : "rounded-full px-3.5 py-1.5 text-sm text-mute hover:bg-white";
}

export async function ConsoleShell({ eventId, eventName, active, tight, children }: ConsoleShellProps) {
  const home = eventId ? `/events/${eventId}` : "/";
  const budget = await getConsoleState();
  const meter = budget.cap === 0 ? 0 : (budget.remaining / budget.cap) * 100;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1200px] items-center gap-6 px-8 py-4">
          <Link href={home} className="text-lg font-semibold">
            headcount
          </Link>
          {eventName ? <span className="min-w-0 truncate text-sm text-mute">{eventName}</span> : null}
          {eventId ? (
            <nav className="flex items-center gap-1">
              <Link href={`/events/${eventId}`} className={navClass(active === "coverage")}>
                Coverage
              </Link>
              <Link href={`/events/${eventId}/roster`} className={navClass(active === "roster")}>
                Roster
              </Link>
              <Link href={`/events/${eventId}/waves/new`} className={navClass(active === "wave")}>
                New wave
              </Link>
              <Link href="/instruments/ins_casper_v1" className={navClass(active === "instrument")}>
                Instrument
              </Link>
            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <p className="tabular text-sm font-semibold">{budget.remaining} left</p>
              <p className="text-xs text-mute">
                of {budget.cap} · {budget.mode === "live" ? "live" : "fixture"}
                {budget.killed ? " · killed" : ""}
              </p>
            </div>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-ink" style={{ width: `${meter}%` }} />
            </div>
            <form action={toggleKill}>
              <button
                type="submit"
                className={
                  budget.killed
                    ? "rounded-full bg-critical px-4 py-1.5 text-sm font-medium text-white"
                    : "rounded-full border border-critical px-4 py-1.5 text-sm font-medium text-critical"
                }
              >
                {budget.killed ? "Killed" : "Kill switch"}
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className={`mx-auto w-full max-w-[1200px] px-8 ${tight ? "space-y-4 py-5" : "space-y-6 py-8"}`}>
        {children}
      </div>
    </div>
  );
}
