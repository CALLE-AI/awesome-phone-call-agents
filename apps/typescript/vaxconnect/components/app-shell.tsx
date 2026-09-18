"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  {
    href: "/dashboard",
    label: "Home",
    icon: "🏠",
  },
  {
    href: "/child-vaccine/info",
    label: "Child Vaccination",
    icon: "👶",
  },
  {
    href: "/travel-vaccine/country",
    label: "Travel Vaccination",
    icon: "✈️",
  },
  {
    href: "/vaccine-assistant",
    label: "Vaccine Hub",
    icon: "💉",
  },
  {
    href: "/history",
    label: "Booking History",
    icon: "📖",
  },
];

export default function AppShell({
                                   children,
                                 }: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
      <div className="min-h-screen flex">
        <aside className="w-64 shrink-0 border-r border-line bg-paper-dim px-5 py-6 flex flex-col">
          <div className="flex items-center gap-2 mb-10 px-1">
            <span className="text-xl">💉</span>

            <span className="font-display text-lg text-ink">
                        VaxConnect
                    </span>
          </div>

          <nav className="flex flex-col gap-1 flex-1">
            {links.map((link) => {
              const active = pathname.startsWith(
                  link.href
                      .split("/")
                      .slice(0, 2)
                      .join("/")
              );

              return (
                  <Link
                      key={link.href}
                      href={link.href}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                          active
                              ? "bg-teal text-paper"
                              : "text-ink/75 hover:bg-paper hover:text-ink"
                      }`}
                  >
                    <span>{link.icon}</span>

                    {link.label}
                  </Link>
              );
            })}
          </nav>

          <div className="border-t border-line pt-4 flex flex-col gap-1">
            <Link
                href="/profile"
                className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-ink/75 hover:bg-paper"
            >
              👤 Profile
            </Link>

            <Link
                href="/"
                className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-ink/75 hover:bg-paper"
            >
              🚪 Logout
            </Link>
          </div>
        </aside>

        <main className="flex-1 px-10 py-10 max-w-4xl">
          {children}
        </main>
      </div>
  );
}