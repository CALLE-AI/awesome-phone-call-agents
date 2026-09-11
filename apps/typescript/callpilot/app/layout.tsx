import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "CallPilot — AI that doesn't stop at conversation", description: "CallPilot turns business intent into real-world phone workflows powered by CALL-E." };

function Nav() {
  return (
    <header className="border-b border-line sticky top-0 z-20 bg-ink/90 backdrop-blur">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <span className="w-8 h-8 rounded-xl bg-accent grid place-items-center font-mono">C</span>
          CallPilot <span className="text-[11px] font-mono text-white/40 border border-line rounded-full px-2 py-0.5 ml-1">powered by CALL-E</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/missions/new" className="btn-primary !py-2 !px-4">Create a Mission</Link>
          <Link href="/history" className="btn-ghost !py-2 !px-4">History</Link>
          <Link href="/analytics" className="btn-ghost !py-2 !px-4 hidden sm:inline-block">Analytics</Link>
        </nav>
      </div>
    </header>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="max-w-6xl mx-auto px-6 pb-24">{children}</main>
        <footer className="border-t border-line py-8 text-center text-xs text-white/40">
          CallPilot — AI operations layer turning phone conversations into completed business workflows. Live calls via CALL-E SDK/API. Demo data is always labeled.
        </footer>
      </body>
    </html>
  );
}
