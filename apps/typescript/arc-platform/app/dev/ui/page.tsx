import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { KitchenSink } from "./_components/KitchenSink"

/**
 * /dev/ui - the review gate from BRANDING.md v1.1 section 6, step 3.
 *
 * Dev-only guard: section 6 says "Delete /dev/ui before the final submission
 * build, or keep it behind a dev-only guard." This is the guard - the route
 * 404s in production, so it can stay in the repo without shipping.
 */
export const metadata: Metadata = { title: "Arc UI - kitchen sink" }

export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <KitchenSink />
}
