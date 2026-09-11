import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Openings — standing availability watch for care access",
  description:
    "Tell us the care you need. Openings calls the listed providers, verifies who is real and available, and keeps watching until an appointment opens.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <header className="border-b border-zinc-800">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Openings
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-400">
              <Link href="/reports" className="transition hover:text-zinc-200">
                Access report
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
