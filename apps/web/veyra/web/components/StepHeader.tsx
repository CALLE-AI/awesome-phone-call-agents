import Link from "next/link";
import AccountIndicator from "@/components/AccountIndicator";

const STEPS = [
  { id: "prompt", n: "01", label: "Prompt", href: "/" },
  { id: "workflow", n: "02", label: "Workflow", href: "/workflow" },
  { id: "campaign", n: "03", label: "Campaign", href: "/campaigns" },
  { id: "results", n: "04", label: "Results", href: "/results" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

/**
 * The account screen sits outside the four-step pipeline, so it lights up the account
 * button in the corner instead of a step, and leaves every step unhighlighted.
 */
export type HeaderScreen = StepId | "profile";

/** Sticky pipeline nav. */
export default function StepHeader({ current }: { current: HeaderScreen }) {
  const idx = STEPS.findIndex((s) => s.id === current);

  return (
    <header className="sticky top-0 z-40 flex flex-none items-stretch border-b-2 border-bone/[.26] bg-ink">
      <Link
        href="/"
        className="flex items-center border-r-2 border-bone/[.26] px-5 text-bone no-underline"
      >
        <span className="text-[17px] font-extrabold tracking-[.14em]">VEYRA</span>
      </Link>

      <nav className="flex flex-1">
        {STEPS.map((s, i) => {
          const active = i === idx;
          const done = i < idx;
          const chrome = `-mb-0.5 flex h-14 items-center gap-2.5 border-r border-bone/[.16] border-b-2 px-[22px] no-underline ${
            active
              ? "border-b-flame bg-panel-2 text-bone"
              : `border-b-transparent bg-transparent ${
                  done ? "text-bone/[.62]" : "text-bone/[.34]"
                }`
          }`;
          const inner = (
            <>
              <span
                className={`text-[10.5px] tracking-[.1em] ${
                  active ? "text-flame" : "opacity-70"
                }`}
              >
                {s.n}
              </span>
              <span className="text-[13px] font-extrabold uppercase tracking-[.04em]">
                {s.label}
              </span>
            </>
          );

          return s.href && !active ? (
            <Link key={s.id} href={s.href} className={chrome}>
              {inner}
            </Link>
          ) : (
            <button
              key={s.id}
              type="button"
              disabled
              className={`${chrome} ${active ? "" : "cursor-not-allowed"}`}
            >
              {inner}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-3.5 border-l-2 border-bone/[.26] px-[18px]">
        <span className="text-[11px] uppercase tracking-[.1em] text-bone/45">
          CALL-E · Sandbox
        </span>
        <AccountIndicator active={current === "profile"} />
      </div>
    </header>
  );
}
