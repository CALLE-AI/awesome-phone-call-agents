// File: src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GoodFaith: real cash prices for medical procedures",
  description:
    "An AI phone agent that calls clinics for a self-pay Good Faith Estimate, apples-to-apples, with the receipts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 font-sans text-paper-100 antialiased">
        <a
          href="#main"
          className="sr-only rounded bg-accent px-3 py-2 text-ink-950 focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
