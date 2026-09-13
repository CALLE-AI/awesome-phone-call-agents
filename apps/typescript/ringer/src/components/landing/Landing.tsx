import {
  ArrowRight,
  CheckCircle2,
  Layers,
  PhoneOutgoing,
  ShieldCheck,
  Sparkles,
  Clock3,
  FileText,
} from 'lucide-react'
import { TEMPLATES } from '@/lib/tasks/templates'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Waveform } from '@/components/ui/Waveform'
import { TemplateIcon, accentClasses } from '@/components/ui/icon'
import { SplitText, GradientText, ShinyText, CountUp } from '@/components/bits/text'
import { AnimatedContent } from '@/components/bits/AnimatedContent'
import { SpotlightCard } from '@/components/bits/SpotlightCard'
import { Magnet } from '@/components/bits/Magnet'

export function Landing({
  onStart,
  onPickTemplate,
}: {
  onStart: () => void
  onPickTemplate: (id: string) => void
}) {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 hero-grid" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-14 pt-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
          <div>
            <Badge tone="brand" icon={<Sparkles className="size-3.5" />}>
              AI phone agent · powered by CALL-E
            </Badge>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-6xl">
              <SplitText text="The phone calls" splitType="words" as="span" className="block" delay={45} />
              <SplitText text="you hate," splitType="words" as="span" className="block" delay={45} />
              <GradientText className="block" animationSpeed={6}>
                handled.
              </GradientText>
            </h1>
            <AnimatedContent distance={30} delay={0.15} threshold={0.05}>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
                Describe the call in plain English. Ringer dials, waits on hold, talks to a real human,
                and comes back with a clear outcome — the new price, the confirmation number, the answer.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Magnet strength={5}>
                  <Button size="lg" variant="accent" iconLeft={<PhoneOutgoing className="size-5" />} onClick={onStart}>
                    Handle a call for me
                  </Button>
                </Magnet>
                <Magnet strength={6}>
                  <Button size="lg" variant="outline" iconRight={<ArrowRight className="size-5" />} onClick={onStart}>
                    Explore playbooks
                  </Button>
                </Magnet>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-success" /> Try it free — no phone, no key
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-4 text-success" /> Calls only with your consent
                </span>
              </div>
            </AnimatedContent>
          </div>

          <AnimatedContent direction="horizontal" distance={80} reverse delay={0.1} threshold={0.05}>
            <HeroVisual />
          </AnimatedContent>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: <FileText className="size-5" />, title: 'Describe it', body: 'Pick a playbook and fill a short form. Ringer writes a precise call script and the exact data to collect.' },
            { icon: <PhoneOutgoing className="size-5" />, title: 'Ringer calls', body: 'It dials, navigates the phone menu, holds, and negotiates or asks — in 15+ regions and languages.' },
            { icon: <CheckCircle2 className="size-5" />, title: 'Get a clear result', body: 'A structured outcome with confidence, evidence quotes, and the full transcript. No “what did they say?”' },
          ].map((s, i) => (
            <AnimatedContent key={i} delay={i * 0.08} distance={50}>
              <div className="card h-full p-5">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary-strong dark:text-primary">
                    {s.icon}
                  </span>
                  <span className="font-mono text-xs font-bold text-faint">0{i + 1}</span>
                </div>
                <h3 className="mt-3 font-bold text-ink">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
              </div>
            </AnimatedContent>
          ))}
        </div>
      </section>

      {/* Playbooks */}
      <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <AnimatedContent distance={40}>
          <div className="mb-6">
            <h2 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Playbooks for the calls nobody wants to make</h2>
            <p className="mt-1 text-muted">Tuned prompts and structured results for each job.</p>
          </div>
        </AnimatedContent>
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.filter((t) => t.id !== 'custom').map((t, i) => (
            <AnimatedContent key={t.id} delay={(i % 3) * 0.06} distance={50}>
              <SpotlightCard
                as="button"
                onClick={() => onPickTemplate(t.id)}
                className="card lift group h-full w-full cursor-pointer p-5 text-left hover:border-primary/40"
              >
                <div className="flex items-center justify-between">
                  <span className={`grid size-11 place-items-center rounded-xl ${accentClasses(t.accent)}`}>
                    <TemplateIcon name={t.icon} className="size-5.5" />
                  </span>
                  {t.batchable && (
                    <Badge tone="brand" icon={<Layers className="size-3" />}>
                      Shootout
                    </Badge>
                  )}
                </div>
                <h3 className="mt-3.5 font-bold text-ink">{t.label}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{t.tagline}</p>
              </SpotlightCard>
            </AnimatedContent>
          ))}
        </div>
      </section>

      {/* Shootout highlight */}
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <AnimatedContent distance={50}>
          <div className="card overflow-hidden lg:grid lg:grid-cols-2">
            <div className="p-7 sm:p-9">
              <Badge tone="brand" icon={<Layers className="size-3.5" />}>
                Quote Shootout
              </Badge>
              <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
                Call five businesses at once. Get the cheapest.
              </h2>
              <p className="mt-3 leading-relaxed text-muted">
                One task, many numbers. Ringer calls every business in parallel, extracts a structured quote
                from each, and ranks them side-by-side — so you make one decision instead of ten phone calls.
              </p>
              <ul className="mt-5 flex flex-col gap-2.5 text-sm">
                {['A per-business structured result schema', 'Automatic winner + total potential savings', 'Every transcript, one tap away'].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-ink">
                    <CheckCircle2 className="size-4 text-primary" /> {f}
                  </li>
                ))}
              </ul>
              <Button className="mt-7" variant="primary" iconRight={<ArrowRight className="size-4" />} onClick={() => onPickTemplate('get-quote')}>
                Run a Shootout
              </Button>
            </div>
            <div className="bg-surface-2 p-7 sm:p-9">
              <ShootoutPreview />
            </div>
          </div>
        </AnimatedContent>
      </section>

      {/* Trust strip */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: <ShieldCheck className="size-5" />, t: 'Consent-first', d: 'Every call requires an explicit confirmation. Numbers are validated to E.164.' },
            { icon: <FileText className="size-5" />, t: 'Evidence, not vibes', d: 'Confidence score + quoted evidence + full transcript for every outcome.' },
            { icon: <Clock3 className="size-5" />, t: 'Results in ~a minute', d: 'Live status timeline while Ringer works. Walk away and come back to an answer.' },
            { icon: <Sparkles className="size-5" />, t: 'Your key, your calls', d: 'Bring your own CALL-E key — it lives in your browser, never on our servers.' },
          ].map((x, i) => (
            <AnimatedContent key={x.t} delay={(i % 4) * 0.06} distance={40}>
              <SpotlightCard className="card-2 h-full p-5">
                <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary-strong dark:text-primary">
                  {x.icon}
                </span>
                <h3 className="mt-3 text-sm font-bold text-ink">{x.t}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{x.d}</p>
              </SpotlightCard>
            </AnimatedContent>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
        <AnimatedContent distance={50} scale={0.98}>
          <div className="card relative overflow-hidden bg-gradient-to-br from-primary to-primary-strong p-10 text-center text-primary-fg">
            <div className="pointer-events-none absolute inset-0 hero-grid opacity-20" aria-hidden="true" />
            <div className="relative">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Stop dreading the phone.</h2>
              <p className="mx-auto mt-2 max-w-md opacity-90">Hand the next annoying call to Ringer and get on with your day.</p>
              <Magnet strength={5} className="mt-6">
                <Button size="lg" variant="accent" iconLeft={<PhoneOutgoing className="size-5" />} onClick={onStart}>
                  Handle a call for me
                </Button>
              </Magnet>
            </div>
          </div>
        </AnimatedContent>
        <p className="mt-8 text-center text-sm">
          <ShinyText
            text="Built on the CALL-E SDK, API & MCP · for the “CALL-E: Your Code Is Calling” hackathon"
            speed={6}
            base="var(--faint)"
          />
        </p>
      </section>
    </div>
  )
}

function HeroVisual() {
  return (
    <div className="relative">
      <div className="card soft-shadow overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-2 px-4 py-3">
          <span className="size-2.5 rounded-full bg-live live-dot" />
          <span className="text-sm font-bold text-ink">Calling Xfinity — Billing</span>
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-xs text-muted">
            <Waveform bars={4} className="text-primary" barClassName="h-3" /> 01:12
          </span>
        </div>
        <div className="flex flex-col gap-2.5 p-4">
          <Bubble side="left">Thanks for calling billing, this is Marcus.</Bubble>
          <Bubble side="right">
            Hi Marcus — the bill jumped to $95. I’m a loyal customer and a competitor’s offering less. Can we lower it?
          </Bubble>
          <Bubble side="left">I can apply a loyalty credit — $60 a month for 12 months.</Bubble>
        </div>
        <div className="border-t border-border p-4">
          <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Outcome</p>
              <p className="text-lg font-extrabold text-ink">$95/mo → $60/mo</p>
            </div>
            <CheckCircle2 className="size-8 text-success" />
          </div>
        </div>
      </div>
      <div className="absolute -right-3 -top-3 hidden rotate-3 sm:block">
        <Badge tone="success" icon={<CheckCircle2 className="size-3.5" />}>
          Saved $<CountUp to={420} duration={1.4} />/yr
        </Badge>
      </div>
    </div>
  )
}

function Bubble({ side, children }: { side: 'left' | 'right'; children: React.ReactNode }) {
  const right = side === 'right'
  return (
    <div className={right ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          right
            ? 'max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-fg'
            : 'max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-surface-2 px-3.5 py-2 text-sm text-ink'
        }
      >
        {children}
      </div>
    </div>
  )
}

function ShootoutPreview() {
  const rows = [
    { name: 'Mike’s Auto', price: 289, best: true },
    { name: 'City Garage', price: 342, best: false },
    { name: 'AutoWorks', price: 415, best: false },
  ]
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div
          key={r.name}
          className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
            r.best ? 'border-primary bg-surface ring-2 ring-primary/30' : 'border-border bg-surface'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-bold text-ink">{r.name}</span>
            {r.best && <Badge tone="brand">Best</Badge>}
          </div>
          <span className={`font-extrabold ${r.best ? 'text-primary' : 'text-ink'}`}>
            $<CountUp to={r.price} duration={1.4} />
          </span>
        </div>
      ))}
      <p className="mt-1 text-center text-xs font-semibold text-success">You save $126 vs. the priciest quote</p>
    </div>
  )
}
