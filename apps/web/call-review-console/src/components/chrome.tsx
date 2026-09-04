"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { list } from "@/lib/queue";

const LINKS = [
  { href: "/", label: "paste one" },
  { href: "/key", label: "use a key" },
  { href: "/hook", label: "webhook" },
  { href: "/queue", label: "queue" },
  { href: "/matrix", label: "what it can say" },
];

/**
 * The strip across the top of every page.
 *
 * The queue count is the only live thing in it, and it is deliberately the
 * count of calls that need a person rather than the count of calls read.
 * A number that only goes up is furniture. A number that means somebody has
 * work to do is a number.
 */
export function Chrome() {
  const pathname = usePathname();
  const [waiting, setWaiting] = useState<number | null>(null);

  useEffect(() => {
    setWaiting(list().filter((entry) => entry.disposition.needsHuman).length);
  }, [pathname]);

  return (
    <nav
      className="flex items-baseline gap-8 border-b px-6 py-4 md:px-12 lg:px-16"
      style={{ borderColor: "var(--rule)" }}
    >
      <span
        className="font-mono text-xs tracking-[0.2em] uppercase"
        style={{ color: "var(--paper-faint)" }}
      >
        call review
      </span>
      <div className="flex items-baseline gap-6">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="font-mono text-xs tracking-[0.16em] uppercase"
              style={{
                color: active ? "var(--paper)" : "var(--paper-faint)",
                textDecoration: active ? "underline" : "none",
                textUnderlineOffset: "6px",
              }}
            >
              {link.label}
              {link.href === "/queue" && waiting ? (
                <span style={{ color: "var(--alarm)" }}> {waiting}</span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
