import type { Metadata } from "next"

import { Nav } from "@/components/landing-v2/Nav"
import { Hero } from "@/components/landing-v2/Hero"
import { Dial } from "@/components/landing-v2/Dial"
import { Problem } from "@/components/landing-v2/Problem"
import { Steps } from "@/components/landing-v2/Steps"
import { Demo } from "@/components/landing-v2/Demo"
import { Faq } from "@/components/landing-v2/Faq"
import { Closing, Foot } from "@/components/landing-v2/Closing"

/**
 * Homepage, built to the supplied reference file.
 *
 * The `arc-v2` class scopes this page's tokens, type and keyframes; the app
 * behind /sign-in keeps its own and is untouched.
 *
 * A note on the copy: several claims here are ahead of the product - the rate
 * desk figures, "239 stations on a rolling basis", the 60- and 42-second
 * timings, weekly re-confirmation, promo codes and call tracking, the
 * commission model, and digital/Meta. Each one is listed against what the
 * database and codebase actually hold at the top of
 * components/landing-v2/content.ts, so the gap is written down in one place
 * rather than discovered later.
 */
export const metadata: Metadata = {
  title: "Arc — AI campaign OS for radio & digital in Pakistan",
  description:
    "Arc keeps live rates from 239 FM stations, writes your scripts, and hands back a ranked media plan in 60 seconds.",
}

export default function HomePage() {
  return (
    <div className="arc-v2 min-h-screen">
      <Nav />
      <main>
        <Hero />
        <Dial />
        <Problem />
        <Steps />
        <Demo />
        <Faq />
        <Closing />
      </main>
      <Foot />
    </div>
  )
}
