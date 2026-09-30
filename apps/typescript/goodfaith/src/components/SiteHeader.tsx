// File: src/components/SiteHeader.tsx
import { ModeBadge } from "@/components/ModeBadge";

export function SiteHeader({ mode }: { mode?: "mock" | "live" }) {
  return (
    <header className="border-b border-ink-800/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <a href="/" className="group inline-flex items-baseline gap-2" aria-label="GoodFaith home">
          <span className="font-serif text-xl tracking-tight text-accent transition-colors group-hover:text-accent-soft">
            GoodFaith
          </span>
          <span className="hidden text-xs text-paper-500 sm:inline">on CALL-E</span>
        </a>
        <div className="flex items-center gap-4">
          <a href="/proof" className="hidden text-sm text-paper-400 transition-colors hover:text-paper-100 sm:inline">
            How it works
          </a>
          {mode && <ModeBadge mode={mode} />}
        </div>
      </div>
    </header>
  );
}
