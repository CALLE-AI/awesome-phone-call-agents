"use client";

// Cinematic brand hero. Full-bleed dark studio field, monumental editorial headline,
// a crafted "voice → signal → proof" relay motion graphic, and an editorial step strip
// that bridges into the work area. The SVG scene is the poster and reduced-motion
// fallback; when a studio render exists, set HERO_RENDER to its public path and it
// fades in over the scene.
const HERO_RENDER = ""; // e.g. "/brand/relay-hero.png" once the render is dropped into public/

const STEPS = [
  { n: "01", t: "Type the goal", d: "Say what you need in plain language." },
  { n: "02", t: "We make the call", d: "The agent talks, discloses, and captions it live." },
  { n: "03", t: "You get proof", d: "Every answer bound to the words that were spoken." },
];

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div
        className="hero-render"
        aria-hidden="true"
        style={
          HERO_RENDER
            ? ({ ["--hero-render"]: `url(${HERO_RENDER})`, ["--hero-render-opacity"]: 1 } as React.CSSProperties)
            : undefined
        }
      />
      <div className="relative mx-auto grid min-h-[28rem] max-w-6xl items-center gap-8 px-5 pt-10 pb-2 sm:px-8 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:gap-6">
        <div className="lg:pr-6">
          <div className="mb-8 flex items-center gap-2.5">
            <span className="brand-mark flex h-9 w-9 flex-none items-center justify-center rounded-lg shadow-sm" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
                <path d="M5.2 4.4a1.4 1.4 0 0 1 1.9-.2l1.7 1.3c.5.4.6 1 .4 1.6l-.5 1.3c-.1.4 0 .8.3 1.1l2.6 2.6c.3.3.7.4 1.1.3l1.3-.5c.6-.2 1.2-.1 1.6.4l1.3 1.7c.5.6.4 1.5-.2 2l-1 .9c-.9.8-2.1 1-3.2.5-2.2-1-4.2-2.5-5.9-4.2S3.3 9.6 2.4 7.4c-.5-1.1-.3-2.4.6-3.1z" fill="currentColor" />
                <path d="M15.5 6.2l1.8 1.8 3.4-3.6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
              Relay<span style={{ color: "var(--signal)" }}>Goal</span>
            </span>
          </div>

          <p className="hero-eyebrow mb-4">Accessible phone relay · built on CALL-E</p>
          <h1 id="hero-title" className="hero-title text-[clamp(2.6rem,7vw,4.75rem)]">
            Type the goal.<br />We make the <em>call</em>.
          </h1>
          <p className="hero-sub mt-6 max-w-xl text-lg leading-relaxed">
            For people who can&apos;t use the phone. You never hear the call — so every answer comes back
            pinned to the exact words the other person said, or honestly marked not confirmed. Proof of what
            was said, not a summary to take on trust.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs uppercase tracking-wider" style={{ color: "var(--hero-dim)" }}>
            <span>You&apos;re never on the line</span>
            <span aria-hidden="true" style={{ color: "var(--signal)" }}>·</span>
            <span>AI disclosed every call</span>
            <span aria-hidden="true" style={{ color: "var(--signal)" }}>·</span>
            <span>Runs dry by default</span>
          </div>
        </div>

        <RelayScene />
      </div>

      {/* Editorial step strip: fills the lower band and bridges into the work area. */}
      <div className="relative mx-auto max-w-6xl px-5 pb-12 sm:px-8">
        <ol className="grid gap-x-6 gap-y-5 border-t pt-6 sm:grid-cols-3" style={{ borderColor: "oklch(1 0 0 / 0.12)" }}>
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-3">
              <span className="font-mono text-sm font-semibold" style={{ color: "var(--signal)" }}>{s.n}</span>
              <span>
                <span className="block font-semibold" style={{ color: "var(--hero-fg)" }}>{s.t}</span>
                <span className="text-sm" style={{ color: "var(--hero-dim)" }}>{s.d}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// Voice (concentric emitter) → signal ribbon (a travelling comet) → proof tablet.
function RelayScene() {
  return (
    <div className="relay-scene w-full">
      <svg viewBox="46 96 552 322" width="100%" role="img" aria-label="A spoken voice is relayed across a gap and resolves into a verified proof card.">
        <defs>
          <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="oklch(0.88 0.01 230)" />
            <stop offset="1" stopColor="oklch(0.55 0.015 235)" />
          </linearGradient>
          <linearGradient id="tablet-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="oklch(0.98 0.012 82)" />
            <stop offset="1" stopColor="oklch(0.92 0.014 82)" />
          </linearGradient>
          <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="oklch(0.7 0.14 46 / 0.55)" />
            <stop offset="1" stopColor="oklch(0.7 0.14 46 / 0)" />
          </radialGradient>
        </defs>

        {/* grounding shadow + studio glow */}
        <ellipse cx="330" cy="400" rx="290" ry="40" fill="oklch(0.09 0.02 258)" />
        <ellipse cx="470" cy="230" rx="180" ry="180" fill="url(#glow)" />

        {/* plinth */}
        <rect className="relay-plinth" x="60" y="316" width="250" height="52" rx="12" />
        <rect x="60" y="316" width="250" height="12" rx="12" fill="oklch(0.98 0.01 90)" />

        {/* voice emitter — concentric rings on an ivory disc */}
        <circle cx="165" cy="238" r="66" fill="url(#metal)" />
        <circle cx="165" cy="238" r="40" fill="oklch(0.96 0.012 82)" />
        <g fill="none" stroke="var(--signal)" strokeWidth="4" strokeLinecap="round">
          <path d="M165 205 a33 33 0 0 1 0 66" opacity="0.3" />
          <path d="M165 217 a21 21 0 0 1 0 42" opacity="0.55" />
          <path d="M165 227 a11 11 0 0 1 0 22" opacity="0.9" />
        </g>

        {/* signal ribbon: base path + travelling comet */}
        <path id="ribbon" className="signal-path" d="M228 214 C 320 110, 400 110, 486 200" opacity="0.5" />
        <path className="signal-comet" d="M228 214 C 320 110, 400 110, 486 200" />

        {/* proof tablet */}
        <g transform="rotate(6 500 250)">
          <rect x="410" y="150" width="176" height="200" rx="16" fill="oklch(0.1 0.02 258)" opacity="0.35" />
          <rect x="406" y="146" width="176" height="200" rx="16" fill="url(#tablet-face)" />
          <rect x="406" y="146" width="176" height="40" rx="16" fill="var(--hero-bg)" />
          <rect x="406" y="168" width="176" height="18" fill="var(--hero-bg)" />
          <circle cx="428" cy="166" r="4" fill="var(--signal)" />
          <line className="relay-rule" x1="430" y1="222" x2="560" y2="222" />
          <line className="relay-rule" x1="430" y1="252" x2="560" y2="252" />
          <line className="relay-rule" x1="430" y1="282" x2="516" y2="282" />
          <circle cx="540" cy="314" r="20" fill="var(--signal)" />
          <path d="M531 314 l6 7 12 -14" fill="none" stroke="oklch(0.13 0.02 258)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  );
}
