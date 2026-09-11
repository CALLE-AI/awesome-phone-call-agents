import Image from 'next/image';

import MobileLandingPage from '@/components/MobileLandingPage';
import PromptComposer from '@/components/PromptComposer';
import StepHeader from '@/components/StepHeader';

const KICKER = 'text-[10.5px] uppercase tracking-[.14em] text-bone/45';
const RULE = 'border-t-2 border-bone/[.26]';

function Section({
  kicker,
  children,
}: {
  kicker: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`py-[72px] ${RULE}`}>
      <div className="grid items-start gap-9 md:grid-cols-[200px_1fr]">
        <div className={KICKER}>{kicker}</div>
        <div>{children}</div>
      </div>
    </section>
  );
}

const AUDIENCE = [
  ['Sales teams', 'Lead qualification', 'High'],
  ['Call centers / BPOs', 'Automated outbound campaigns', 'High'],
  ['Financial services', 'Advisor / insurance lead qualification', 'High'],
  ['Education', 'Student qualification', 'Medium-high'],
  ['Agencies', 'Run campaigns for clients', 'Medium-high'],
  ['Automotive', 'Leads, service, test drives', 'Medium'],
];

const PIPELINE = [
  ['01', 'Prompt', 'Describe the process in plain English.'],
  [
    '02',
    'Generate & edit',
    'Nodes, branches, qualification rules and capture schema, editable as a graph.',
  ],
  [
    '03',
    'Compile to call',
    'Becomes a call instruction CALL-E executes per contact, over SDK, API or MCP.',
  ],
  [
    '04',
    'Run & read',
    'One call per contact; status, transcript and captured fields to CRM or webhook — including null results.',
  ],
];

const BUSINESS_MODEL = [
  [
    'Usage-based',
    "Per generated workflow and per campaign minute, layered above CALL-E's own usage cost.",
  ],
  [
    'Seats',
    'Per-seat for workflow editing, campaign management and analytics.',
  ],
  [
    'Agency / BPO tier',
    'Multiple client workflows from one dashboard, priced on client count or campaign volume.',
  ],
  [
    'Template marketplace',
    'Vertical workflow templates sold, shared, or contributed back to the CALL-E ecosystem.',
  ],
];

function DesktopLandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <StepHeader current="prompt" />

      <main className="flex flex-1 flex-col">
        {/* — hero — */}
        <div className="flex min-h-[calc(100vh-56px)] flex-col justify-center bg-[linear-gradient(rgba(243,242,242,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(243,242,242,.035)_1px,transparent_1px)] bg-[length:64px_64px] p-12">
          <div className="mx-auto w-full max-w-[820px] animate-vfade">
            <div className="mb-4 flex items-end border-b-2 border-bone/[.26] pb-4">
              <div className="flex items-center gap-[18px]">
                <Image
                  src="/icon.png"
                  alt=""
                  width={56}
                  height={56}
                  priority
                  className="size-14 flex-none rounded-xl"
                />
                <span className="text-[52px] font-extrabold leading-[.9] tracking-[.16em]">
                  VEYRA
                </span>
              </div>
              <span className="flex-1" />
              <span className="text-right text-[11px] uppercase leading-[1.5] tracking-[.14em] text-bone/45">
                Voice workflow
                <br />
                compiler
              </span>
            </div>

            <div className="mb-[34px] flex items-center justify-between gap-4">
              <span className="text-[11.5px] uppercase tracking-[.14em] text-bone/50">
                Prompt <span className="text-flame">·</span> Workflow{' '}
                <span className="text-flame">·</span> Campaign{' '}
                <span className="text-flame">·</span> Results
              </span>
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-ember"
              >
                Start from a saved workflow →
              </button>
            </div>

            <h1 className="mb-3 text-[44px] font-extrabold leading-[1.06] tracking-[-.02em]">
              Describe the calling process.
            </h1>
            <p className="mb-7 max-w-[560px] text-[15px] text-bone/55">
              Plain English in. An editable voice-agent workflow out, compiled
              to CALL-E and dialled from your contact list.
            </p>

            <PromptComposer />
          </div>

          <div className="mx-auto mt-[34px] flex w-full max-w-[820px] items-center gap-3 text-[10.5px] uppercase tracking-[.14em] text-bone/45">
            <span className="h-px w-[26px] bg-bone/30" />
            Scroll for what Veyra is
          </div>
        </div>

        <div className="px-12">
          <div className="mx-auto max-w-[1120px]">
            {/* — what veyra is — */}
            <section
              className={`flex min-h-screen flex-col justify-center py-[72px] ${RULE}`}
            >
              <div className="grid items-start gap-9 md:grid-cols-[200px_1fr]">
                <div className={KICKER}>What Veyra is</div>
                <div>
                  <p className="mb-[34px] max-w-[780px] text-[26px] font-extrabold leading-[1.4] tracking-[-.01em] text-pretty">
                    You describe the outbound calling process you want and Veyra
                    turns it into an executable phone workflow, complete with
                    conversation logic, qualification rules, and structured
                    outcomes, then CALL-E&apos;s voice agents run it at scale on
                    real calls.
                  </p>

                  <div
                    className={`grid gap-0 pt-[22px] md:grid-cols-2 ${RULE}`}
                  >
                    <div className="border-bone/[.16] pr-[26px] md:border-r">
                      <div className={`${KICKER} mb-2.5`}>Positioning</div>
                      <p className="m-0 text-[15px] leading-[1.6] text-bone/85">
                        &ldquo;We help businesses turn any outbound calling
                        process into an executable AI workflow. Describe what
                        the agent needs to accomplish, our platform generates
                        the conversation flow, qualification logic and
                        structured outputs, and CALL-E handles the actual
                        calls.&rdquo;
                      </p>
                    </div>
                    <div className="pl-[26px]">
                      <div className={`${KICKER} mb-2.5`}>
                        For a developer audience
                      </div>
                      <p className="m-0 text-[15px] leading-[1.6] text-bone/85">
                        &ldquo;A development and orchestration layer for
                        building production phone-call workflows with
                        CALL-E.&rdquo;
                      </p>
                    </div>
                  </div>

                  <div
                    className={`mt-[22px] grid gap-0 pt-[22px] md:grid-cols-3 ${RULE}`}
                  >
                    {[
                      ['6.4s', 'Prompt to compiled workflow'],
                      ['1,691', 'Calls placed through CALL-E'],
                      ['38%', 'Median qualified rate'],
                    ].map(([figure, label], i) => (
                      <div
                        key={label}
                        className={`border-bone/[.16] ${
                          i === 0 ? 'pr-5 md:border-r' : ''
                        } ${i === 1 ? 'px-5 md:border-r' : ''} ${
                          i === 2 ? 'pl-5' : ''
                        }`}
                      >
                        <div className="text-[32px] font-extrabold leading-none tracking-[-.03em]">
                          {figure}
                        </div>
                        <div className={`${KICKER} mt-2`}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* — the problem — */}
            <Section kicker="The problem">
              <div className="grid gap-0 md:grid-cols-2">
                <div className="border-bone/[.16] pr-7 md:border-r">
                  <p className="mb-[18px] text-base leading-[1.6] text-bone/85">
                    Businesses running high-volume outbound calling — sales
                    qualification, appointment confirmation, renewal reminders,
                    student counseling signups — either hire large calling teams
                    to read scripts, or ask engineers to hand-build voice agent
                    logic for every campaign.
                  </p>
                  <div className="flex flex-col gap-3">
                    {[
                      'Manual call teams are expensive, inconsistent, and hard to scale up or down quickly.',
                      'Hand-built agents need an AI engineer to translate a business process into prompts, conversation states and branching logic — then rebuild it every time the process changes.',
                    ].map((line) => (
                      <div key={line} className="flex gap-3">
                        <span className="mt-[7px] size-[7px] flex-none bg-flame" />
                        <span className="text-[13.5px] leading-[1.6] text-bone/60">
                          {line}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pl-7">
                  <div className={`${KICKER} mb-2.5`}>The solution</div>
                  <p className="mb-4 text-base leading-[1.6] text-bone/85">
                    Veyra is a workflow generation and orchestration layer on
                    top of CALL-E.
                  </p>
                  <p className="m-0 text-[13.5px] leading-[1.6] text-bone/60">
                    A business user describes the call process in natural
                    language. Veyra generates a structured, editable workflow —
                    nodes, branching logic, qualification scoring, data capture
                    — and compiles it into a CALL-E call instruction. A
                    developer refines it, connects a contact list or CRM, and
                    launches a live campaign that returns structured results.
                  </p>
                  <div
                    className={`mt-5 pt-4 text-[13px] leading-[1.6] text-bone/75 ${RULE}`}
                  >
                    The product moment: say{' '}
                    <span className="text-blush">
                      &ldquo;add a question about approximate investable assets
                      after risk tolerance&rdquo;
                    </span>{' '}
                    and the workflow updates — no hand-editing prompts or state
                    machines.
                  </div>
                </div>
              </div>
            </Section>

            {/* — the pipeline — */}
            <Section kicker="The pipeline">
              <div className="mb-[34px] grid gap-0 md:grid-cols-4">
                {PIPELINE.map(([n, title, body], i) => (
                  <div
                    key={n}
                    className={`border-bone/[.16] ${
                      i === 0 ? 'pr-[18px] md:border-r' : ''
                    } ${i > 0 && i < 3 ? 'px-[18px] md:border-r' : ''} ${
                      i === 3 ? 'pl-[18px]' : ''
                    }`}
                  >
                    <div className="mb-[9px] text-[10.5px] tracking-[.1em] text-flame">
                      {n}
                    </div>
                    <div className="mb-1.5 text-[15px] font-extrabold">
                      {title}
                    </div>
                    <div className="text-[13.5px] leading-[1.6] text-bone/60">
                      {body}
                    </div>
                  </div>
                ))}
              </div>
              <div className={`grid gap-0 pt-[22px] md:grid-cols-2 ${RULE}`}>
                <div className="border-bone/[.16] pr-[26px] md:border-r">
                  <div className={`${KICKER} mb-2.5`}>Business user</div>
                  <p className="m-0 text-[13.5px] leading-[1.6] text-bone/60">
                    Describes intent in plain language, reviews and approves the
                    generated workflow, launches campaigns, reads results.
                  </p>
                </div>
                <div className="pl-[26px]">
                  <div className={`${KICKER} mb-2.5`}>
                    Developer / ops engineer
                  </div>
                  <p className="m-0 text-[13.5px] leading-[1.6] text-bone/60">
                    Refines the workflow, wires integrations and contact lists,
                    manages CALL-E credentials, owns reliability of live
                    campaigns.
                  </p>
                </div>
              </div>
            </Section>

            {/* — who it is for — */}
            <Section kicker="Who it is for">
              <p className="mb-6 max-w-[700px] text-base leading-[1.6] text-bone/85">
                Sales and operations teams that run repetitive outbound
                campaigns and need structured outcomes from every conversation.
                We lead with wealth management qualification, then show the same
                engine generating education, insurance or appointment-booking
                workflows from a different prompt.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13.5px]">
                  <thead>
                    <tr>
                      <th
                        className={`${KICKER} w-[34%] border-b-2 border-bone/[.26] py-2.5 text-left`}
                      >
                        Customer
                      </th>
                      <th
                        className={`${KICKER} border-b-2 border-bone/[.26] py-2.5 text-left`}
                      >
                        Use case
                      </th>
                      <th
                        className={`${KICKER} w-[18%] border-b-2 border-bone/[.26] py-2.5 text-right`}
                      >
                        Priority
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {AUDIENCE.map(([customer, useCase, priority]) => (
                      <tr key={customer}>
                        <td className="border-b border-bone/[.13] py-[11px] font-extrabold">
                          {customer}
                        </td>
                        <td className="border-b border-bone/[.13] py-[11px] text-bone/65">
                          {useCase}
                        </td>
                        <td
                          className={`border-b border-bone/[.13] py-[11px] text-right ${
                            priority === 'High' ? 'text-blush' : 'text-bone/60'
                          }`}
                        >
                          {priority}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-[12.5px] text-bone/45">
                Boundary: qualification, information collection, FAQs and
                appointment booking. Veyra does not give financial advice.
              </div>
            </Section>

            {/* — business model — */}
            <Section kicker="Business model">
              <div className="grid gap-0 md:grid-cols-2">
                {BUSINESS_MODEL.map(([title, body], i) => (
                  <div
                    key={title}
                    className={`border-bone/[.16] ${
                      i % 2 === 0 ? 'pr-[26px] md:border-r' : 'pl-[26px]'
                    } ${i < 2 ? 'border-b pb-6' : 'pt-6'}`}
                  >
                    <div className="mb-[7px] text-[15px] font-extrabold">
                      {title}
                    </div>
                    <div className="text-[13.5px] leading-[1.6] text-bone/60">
                      {body}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* — trust strip — */}
            <section
              className={`flex flex-wrap items-center gap-x-[26px] gap-y-3.5 border-b-2 border-bone/[.26] py-[18px] ${RULE}`}
            >
              {[
                'CALL-E native',
                'SOC 2 Type II',
                'TCPA consent gate on every call',
                'US · UK · EU numbers',
              ].map((item) => (
                <span key={item} className={KICKER}>
                  {item}
                </span>
              ))}
              <span className="ml-auto text-[10.5px] uppercase tracking-[.14em] text-bone/30">
                v0.9 · sandbox
              </span>
            </section>

            {/* — cta — */}
            <section className="mt-11 flex flex-wrap items-end justify-between gap-6 bg-flame px-10 py-[38px] text-ink">
              <div>
                <div className="mb-3 text-[11px] uppercase tracking-[.16em] opacity-65">
                  Start now
                </div>
                <div className="max-w-[520px] text-[38px] font-extrabold leading-[1.02] tracking-[-.02em]">
                  Stop writing call scripts.
                  <br />
                  Describe the process.
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  className="cursor-pointer whitespace-nowrap border-0 bg-ink px-5 py-[13px] text-sm font-extrabold text-bone"
                >
                  Generate Workflow
                </button>
                <button
                  type="button"
                  className="cursor-pointer whitespace-nowrap border-2 border-ink bg-transparent px-[18px] py-[11px] text-sm font-extrabold text-ink"
                >
                  Saved workflows
                </button>
              </div>
            </section>

            <footer className="flex flex-wrap items-center justify-between gap-4 pb-14 pt-[22px] text-[11px] uppercase tracking-[.1em] text-bone/35">
              <span>Veyra · Workflow engine for CALL-E voice agent swarms</span>
              <span>Docs · API · Status · Contact sales</span>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopLandingPage />
      </div>
      <div className="md:hidden">
        <MobileLandingPage />
      </div>
    </>
  );
}
