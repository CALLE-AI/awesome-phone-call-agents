import Link from "next/link";

import { HeroRingAnimation } from "@/components/HeroRingAnimation";
import { LogoMark } from "@/components/LogoMark";

// Simple line icons, matching the hero phone icon's stroke weight/style:
// thin stroke, no fill, rounded caps.
const ICON_PROPS = {
  viewBox: "0 0 40 40",
  fill: "none" as const,
  stroke: "#0A0A0A",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function EyeSlashIcon() {
  return (
    <svg {...ICON_PROPS} className="h-9 w-9" aria-hidden="true">
      <path d="M5 20c4.5-8 10.7-12 15-12s10.5 4 15 12c-4.5 8-10.7 12-15 12S9.5 28 5 20Z" />
      <circle cx="20" cy="20" r="3.5" />
      <line x1="7" y1="7" x2="33" y2="33" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg {...ICON_PROPS} className="h-9 w-9" aria-hidden="true">
      <circle cx="20" cy="12" r="6" />
      <path d="M8 34c0-8 5.4-13 12-13s12 5 12 13" />
    </svg>
  );
}

function ScreenOffIcon() {
  return (
    <svg {...ICON_PROPS} className="h-9 w-9" aria-hidden="true">
      <rect x="6" y="9" width="28" height="19" rx="3" />
      <line x1="15" y1="33" x2="25" y2="33" />
      <line x1="20" y1="28" x2="20" y2="33" />
      <line x1="8" y1="10" x2="32" y2="27" />
    </svg>
  );
}

const WHO_HELPS = [
  {
    icon: <EyeSlashIcon />,
    headline: "People who are blind or low vision.",
    body: "No screen to navigate, no app to learn. Just a phone call, like it's always been.",
  },
  {
    icon: <PersonIcon />,
    headline: "People who find new tech overwhelming.",
    body: "No logins, no updates, no settings. If you can answer a phone, you can use this.",
  },
  {
    icon: <ScreenOffIcon />,
    headline: "Anyone who's just tired of screens.",
    body: "Sometimes you'd rather hear it than read it.",
  },
];

const STEPS = [
  {
    number: "1",
    title: "Your emails arrive",
    description:
      "We watch your inbox for the things that matter: bills, loan reminders, notices from the government.",
  },
  {
    number: "2",
    title: "We call you",
    description:
      "At a time you pick, we call your phone. No app to open, no screen to read.",
  },
  {
    number: "3",
    title: "You just talk",
    description:
      "Tell us what to do about each one: set a reminder, ask a follow-up, or move on.",
  },
];

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A0A0A] focus-visible:rounded-sm";

const SOCIAL_LINKS = [
  { label: "van.codes", href: "https://van.codes" },
  { label: "GitHub", href: "https://github.com/Vanshika-Rana" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/vanshikarana/" },
  { label: "X", href: "https://x.com/aahiknsv" },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-white">
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <Link
          href="/"
          className={`flex items-center gap-2 text-[#0A0A0A] ${FOCUS_RING}`}
        >
          <LogoMark size={22} />
          <span className="text-base font-semibold">Gimme Updates</span>
        </Link>

        <Link
          href="/demo"
          className={`text-sm text-[#0A0A0A] underline-offset-4 hover:underline ${FOCUS_RING}`}
        >
          Try it
        </Link>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="flex flex-col items-center px-6 pt-14 pb-20 text-center sm:pt-20 sm:pb-28">
          <h1 className="font-display max-w-3xl text-4xl leading-tight text-[#0A0A0A] sm:text-6xl sm:leading-tight">
            Your inbox, read aloud, one call at a time.
          </h1>

          <p className="mt-6 max-w-xl text-base text-[#8A8A8A] sm:text-lg">
            Gimme Updates calls you every day and reads your important
            emails out loud, so you never have to look at a screen.
          </p>

          <div className="mt-14">
            <HeroRingAnimation />
          </div>

          <Link
            href="/demo"
            className={`mt-14 inline-flex items-center justify-center rounded-[6px] bg-[#0A0A0A] px-7 py-3 text-sm font-medium text-white transition-colors hover:bg-[#3A3A3A] ${FOCUS_RING}`}
          >
            Try the demo
          </Link>
        </section>

        <section className="border-t border-[#D8D8D8] bg-white px-6 py-16 sm:py-24">
          <div className="mx-auto max-w-4xl">
            <h2 className="font-display text-center text-2xl text-[#0A0A0A] sm:text-3xl">
              Who this helps
            </h2>

            <div className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
              {WHO_HELPS.map((item) => (
                <div key={item.headline} className="text-center sm:text-left">
                  <div className="mx-auto sm:mx-0">{item.icon}</div>
                  <h3 className="mt-4 text-base font-semibold text-[#0A0A0A]">
                    {item.headline}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[#8A8A8A]">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-[#D8D8D8] bg-[#F4F4F4] px-6 py-16 sm:py-24">
          <div className="mx-auto max-w-4xl">
            <h2 className="font-display text-center text-2xl text-[#0A0A0A] sm:text-3xl">
              How it works
            </h2>

            <div className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
              {STEPS.map((step) => (
                <div key={step.number} className="text-center sm:text-left">
                  <div className="font-display text-3xl text-[#0A0A0A]">
                    {step.number}
                  </div>
                  <h3 className="mt-2 text-base font-semibold text-[#0A0A0A]">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[#8A8A8A]">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#D8D8D8] px-6 py-8 text-center text-sm text-[#8A8A8A]">
        <p>
          © {new Date().getFullYear()} Gimme Updates. Built for people
          who&apos;d rather listen than read.
        </p>

        <nav
          aria-label="Social links"
          className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1"
        >
          {SOCIAL_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noreferrer noopener"
              className={`text-[#8A8A8A] underline-offset-4 hover:text-[#0A0A0A] hover:underline ${FOCUS_RING}`}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}
