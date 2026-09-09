import Image from "next/image";
import Link from "next/link";

import PromptComposer from "@/components/PromptComposer";

const KICKER = "text-[10px] uppercase tracking-[.14em] text-bone/45";

const PIPELINE = [
  ["01", "Prompt", "Describe the process in plain English."],
  ["02", "Generate & edit", "Review nodes, branches, qualification rules, and captured fields."],
  ["03", "Compile to call", "Turn the workflow into instructions CALL-E can execute."],
  ["04", "Run & read", "Call each contact and receive status, transcripts, and structured results."],
];

const AUDIENCE = [
  ["Sales teams", "Lead qualification", "High"],
  ["Call centers / BPOs", "Outbound campaigns", "High"],
  ["Financial services", "Advisor and insurance qualification", "High"],
  ["Education", "Student qualification", "Medium-high"],
  ["Agencies", "Client campaigns", "Medium-high"],
  ["Automotive", "Leads, service, and test drives", "Medium"],
];

const BUSINESS_MODEL = [
  ["Usage-based", "Per generated workflow and campaign minute, above CALL-E usage."],
  ["Seats", "Per-seat access to workflow editing, campaign management, and analytics."],
  ["Agency / BPO", "Multiple client workflows priced by client count or campaign volume."],
  ["Templates", "Reusable vertical workflows shared through the CALL-E ecosystem."],
];

function MobileSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t-2 border-bone/[.26] py-11">
      <div className={`${KICKER} mb-5`}>{title}</div>
      {children}
    </section>
  );
}

export default function MobileLandingPage() {
  return (
    <div className="min-h-screen bg-ink text-bone">
      <header className="sticky top-0 z-40 border-b-2 border-bone/[.26] bg-ink">
        <div className="flex h-13 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5 text-bone no-underline">
            <Image
              src="/icon.png"
              alt=""
              width={32}
              height={32}
              priority
              className="size-8 rounded-lg"
            />
            <span className="text-[17px] font-extrabold tracking-[.14em]">VEYRA</span>
          </Link>
          <Link
            href="/profile"
            className="border border-bone/[.22] px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[.08em] text-bone no-underline"
          >
            Account
          </Link>
        </div>
        <nav aria-label="Workflow steps" className="grid grid-cols-4 border-t border-bone/[.16]">
          {[
            ["Prompt", "/"],
            ["Workflow", "/workflow"],
            ["Campaign", "/campaigns"],
            ["Results", "/results"],
          ].map(([label, href], index) => (
            <Link
              key={label}
              href={href}
              className={`border-r border-bone/[.16] px-1 py-2.5 text-center text-[9px] font-extrabold uppercase tracking-[.05em] no-underline last:border-r-0 ${
                index === 0 ? "bg-panel-2 text-bone" : "text-bone/45"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main>
        <section
          id="mobile-prompt"
          className="scroll-mt-24 bg-[linear-gradient(rgba(243,242,242,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(243,242,242,.035)_1px,transparent_1px)] bg-[length:48px_48px] px-4 py-10"
        >
          <div className="mb-7 border-b-2 border-bone/[.26] pb-4">
            <div className="flex items-center gap-3">
              <Image
                src="/icon.png"
                alt=""
                width={44}
                height={44}
                priority
                className="size-11 rounded-[10px]"
              />
              <span className="text-[34px] font-extrabold leading-none tracking-[.12em]">
                VEYRA
              </span>
            </div>
            <div className={`${KICKER} mt-4`}>Voice workflow compiler</div>
          </div>

          <h1 className="mb-3 text-[34px] font-extrabold leading-[1.04] tracking-[-.025em]">
            Describe the calling process.
          </h1>
          <p className="mb-7 text-[14px] leading-[1.6] text-bone/60">
            Plain English in. An editable voice-agent workflow out, compiled to CALL-E and
            dialled from your contact list.
          </p>

          <PromptComposer compact />

          <Link
            href="/workflow"
            className="mt-5 inline-block text-[12px] text-ember no-underline"
          >
            Start from a saved workflow →
          </Link>
        </section>

        <div className="px-4">
          <MobileSection title="What Veyra is">
            <p className="mb-7 text-[21px] font-extrabold leading-[1.4] tracking-[-.01em]">
              Describe an outbound calling process and Veyra turns it into an executable
              phone workflow with conversation logic, qualification rules, and structured
              outcomes.
            </p>
            <div className="border-t border-bone/[.16] py-5">
              <div className={`${KICKER} mb-2.5`}>Positioning</div>
              <p className="text-[14px] leading-[1.65] text-bone/80">
                A workflow generation and orchestration layer that translates business
                intent into real CALL-E conversations.
              </p>
            </div>
            <div className="grid grid-cols-3 border-t border-bone/[.16] pt-5">
              {[
                ["6.4s", "To workflow"],
                ["1,691", "Calls placed"],
                ["38%", "Qualified"],
              ].map(([figure, label]) => (
                <div key={label} className="border-r border-bone/[.16] px-2 first:pl-0 last:border-r-0 last:pr-0">
                  <div className="text-[22px] font-extrabold leading-none">{figure}</div>
                  <div className="mt-2 text-[8.5px] uppercase leading-[1.4] tracking-[.08em] text-bone/40">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </MobileSection>

          <MobileSection title="The problem">
            <p className="mb-5 text-[15px] leading-[1.65] text-bone/85">
              Outbound teams either pay people to repeat scripts or ask engineers to
              rebuild voice-agent logic for every campaign.
            </p>
            <div className="space-y-3">
              {[
                "Manual teams are expensive, inconsistent, and difficult to scale.",
                "Hand-built agents require prompts, state machines, and repeated engineering work.",
              ].map((line) => (
                <div key={line} className="flex gap-3">
                  <span className="mt-2 size-1.5 flex-none bg-flame" />
                  <span className="text-[13px] leading-[1.6] text-bone/60">{line}</span>
                </div>
              ))}
            </div>
            <div className="mt-7 border-t border-bone/[.16] pt-6">
              <div className={`${KICKER} mb-2.5`}>The solution</div>
              <p className="text-[14px] leading-[1.65] text-bone/75">
                Generate and edit the workflow visually, connect contacts, launch calls,
                and receive structured results—without rebuilding the agent each time.
              </p>
            </div>
          </MobileSection>

          <MobileSection title="The pipeline">
            <div>
              {PIPELINE.map(([number, title, body]) => (
                <div key={number} className="border-b border-bone/[.16] py-5 first:pt-0 last:border-b-0 last:pb-0">
                  <div className="mb-2 text-[10px] tracking-[.1em] text-flame">{number}</div>
                  <div className="mb-1.5 text-[15px] font-extrabold">{title}</div>
                  <p className="text-[13px] leading-[1.6] text-bone/60">{body}</p>
                </div>
              ))}
            </div>
          </MobileSection>

          <MobileSection title="Who it is for">
            <p className="mb-5 text-[14px] leading-[1.65] text-bone/75">
              Sales and operations teams running repetitive outbound campaigns that need
              structured outcomes from every conversation.
            </p>
            <div className="border-t border-bone/[.16]">
              {AUDIENCE.map(([customer, useCase, priority]) => (
                <div key={customer} className="border-b border-bone/[.16] py-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[13px] font-extrabold">{customer}</span>
                    <span className={`text-[10px] ${priority === "High" ? "text-blush" : "text-bone/45"}`}>
                      {priority}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-bone/55">{useCase}</div>
                </div>
              ))}
            </div>
          </MobileSection>

          <MobileSection title="Business model">
            <div>
              {BUSINESS_MODEL.map(([title, body]) => (
                <div key={title} className="border-b border-bone/[.16] py-5 first:pt-0 last:border-b-0 last:pb-0">
                  <div className="mb-1.5 text-[14px] font-extrabold">{title}</div>
                  <p className="text-[13px] leading-[1.6] text-bone/60">{body}</p>
                </div>
              ))}
            </div>
          </MobileSection>

          <section className="border-y-2 border-bone/[.26] py-5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {["CALL-E native", "SOC 2 Type II", "Consent gated", "US · UK · EU"].map(
                (item) => (
                  <span key={item} className={KICKER}>
                    {item}
                  </span>
                ),
              )}
            </div>
          </section>

          <section className="mt-8 bg-flame px-5 py-8 text-ink">
            <div className="mb-3 text-[10px] uppercase tracking-[.16em] opacity-65">
              Start now
            </div>
            <div className="text-[30px] font-extrabold leading-[1.04] tracking-[-.02em]">
              Stop writing call scripts. Describe the process.
            </div>
            <div className="mt-6 flex flex-col gap-2.5">
              <a
                href="#mobile-prompt"
                className="bg-ink px-5 py-3.5 text-center text-sm font-extrabold text-bone no-underline"
              >
                Generate Workflow
              </a>
              <Link
                href="/workflow"
                className="border-2 border-ink px-5 py-3 text-center text-sm font-extrabold text-ink no-underline"
              >
                Saved workflows
              </Link>
            </div>
          </section>

          <footer className="flex flex-col gap-2 pb-8 pt-5 text-[9.5px] uppercase leading-relaxed tracking-[.1em] text-bone/35">
            <span>Veyra · Workflow engine for CALL-E</span>
            <span>Docs · API · Status · Contact sales</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
