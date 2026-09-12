import type { Metadata } from "next";
import { Inter, Gabarito, JetBrains_Mono, Instrument_Serif } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { cn } from "@/lib/utils";

// BRANDING.md v1.1 section 3 - three type roles, three variables.
// All three are variable fonts, so no `weight` is needed: the full axis loads
// and the brief's per-role weights (display 600-800, body 400/500, data 500)
// are applied at the call site via the tokens in globals.css.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Display - headings only. Never body text.
const gabarito = Gabarito({
  subsets: ["latin"],
  variable: "--font-gabarito",
  display: "swap",
});

// Accent - the emphasised half of a landing headline, italic, and nothing
// else. A fourth role the brief did not have; it is confined to the marketing
// page and never appears inside the app.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

// Data - frequencies, call signs, timestamps, rates, durations.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  /* Was "From brief to campaign in 60 seconds" - a claim taken off the page
     because scripts take about thirty seconds and a call takes
     minutes. It survived here, where nobody looks, and was still being served
     to search engines and link previews. */
  title: "Arc — AI campaign OS for radio & digital in Pakistan",
  description:
    "Arc phones radio stations for their rate, reads the number back digit by digit, and writes nothing down until someone confirms it out loud. Built on CALL-E.",
  keywords: "arc platform, pakistan radio advertising, media buying, voice agent, CALL-E",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignOutUrl="/"
    >
      <html
        lang="en"
        className={cn(inter.variable, gabarito.variable, jetbrainsMono.variable, instrumentSerif.variable, "font-sans")}
        suppressHydrationWarning
      >
        <body suppressHydrationWarning>{children}</body>
      </html>
    </ClerkProvider>
  );
}
