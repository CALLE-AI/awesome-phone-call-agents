/**
 * The app navigation, shared by every signed-in page.
 * Pure, so the Today check can pin which link is current.
 */

export type NavLink = { href: string; label: string }

export const APP_NAV: readonly NavLink[] = [
  { href: "/app", label: "Today" },
  { href: "/app/items", label: "Items" },
  { href: "/app/history", label: "History" },
  { href: "/app/patterns", label: "Patterns" },
  { href: "/app/timeline", label: "Timeline" },
  { href: "/app/settings", label: "Settings" },
]

/** Today matches only /app itself. Every other link also matches its own subpaths. */
export function isCurrentNav(path: string, href: string): boolean {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path
  if (href === "/app") return clean === "/app"
  return clean === href || clean.startsWith(`${href}/`)
}
