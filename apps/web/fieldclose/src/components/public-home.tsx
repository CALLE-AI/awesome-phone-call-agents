import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { AuthDrawer } from "@/components/auth-drawer";
import { BrandMark } from "@/components/brand-mark";
import { PublicReveal } from "@/components/public-reveal";
import {
  PublicSectionNavigation,
  type PublicSectionNavigationItem,
} from "@/components/public-section-navigation";
import { projectConfig } from "@/config/project";

type PublicHomeProps = {
  signedIn: boolean;
};

const navigationItems = [
  { href: "#product", label: "Product" },
  { href: "#workflow", label: "Workflow" },
  { href: "#guardrails", label: "Quality" },
  { href: "#outcomes", label: "Outcomes" },
] as const satisfies readonly PublicSectionNavigationItem[];

const workflowStages = [
  {
    index: "01",
    title: "Technician completes the visit",
    detail:
      "Field evidence arrives from the site. The office still needs the customer's confirmation to close the job.",
  },
  {
    index: "02",
    title: "Review the exact closeout brief",
    detail:
      "The dispatcher reviews the contact, purpose, and permitted questions before anything is approved.",
  },
  {
    index: "03",
    title: "One human-approved call",
    detail:
      "A single CALL-E phone call is placed to the exact recipient, bound to the approved brief and digest.",
  },
  {
    index: "04",
    title: "A person decides the outcome",
    detail:
      "Structured results land back in the workspace. Every uncertain outcome routes to a human next step.",
  },
] as const;

const guardrailColumns = [
  {
    label: "Human checkpoint",
    tone: "guardrail-allowed" as const,
    heading: "Approval binds the call",
    items: [
      "Exact recipient and brief are approved first",
      "One attempt per approved digest",
      "Every decision is recorded in the audit trail",
    ],
  },
  {
    label: "Agent boundary",
    tone: "guardrail-blocked" as const,
    heading: "The agent never closes work",
    items: [
      "No diagnosis, pricing, or scheduling promises",
      "No invoice approval or payment handling",
      "No automatic work-order closure",
    ],
  },
  {
    label: "Uncertainty preserved",
    tone: "guardrail-allowed" as const,
    heading: "Ambiguity stays visible",
    items: [
      "Wrong-person contacts are surfaced, not hidden",
      "Confidence and source are preserved with results",
      "Recommendations never become decisions",
    ],
  },
] as const;

const outcomeRecords = [
  {
    label: "Exact brief",
    value: "One approved call",
    detail: "Recipient, purpose, and questions reviewed before placing the call.",
  },
  {
    label: "Structured result",
    value: "No unresolved issue",
    detail: "Provider state and confidence are kept with the source.",
  },
  {
    label: "Human closeout",
    value: "You decide",
    detail: "A person owns the final operational decision.",
  },
] as const;

const exceptionRows = [
  {
    index: "01",
    title: "Wrong-person contact",
    detail: "The recipient role did not match the authorized contact.",
  },
  {
    index: "02",
    title: "Unresolved issue reported",
    detail: "The site reported a condition that needs operator review.",
  },
  {
    index: "03",
    title: "Creation ambiguity",
    detail: "The attempt outcome was unknown; retry froze until a human reconciles.",
  },
] as const;

export function PublicHome({ signedIn }: PublicHomeProps) {
  const primaryHref = signedIn ? "/workspace" : "/?auth=signup";
  const primaryLabel = signedIn ? "Open workspace" : "Create demo workspace";
  const secondaryHref = signedIn ? "/workspace" : "/?auth=signin";
  const secondaryLabel = signedIn ? "View cases" : "Sign in";

  return (
    <div className="public-home">
      <header className="public-home-header">
        <Link aria-label="FieldClose home" className="public-brand" href="/">
          <BrandMark />
          <span>
            <strong>{projectConfig.name}</strong>
            <small>Closeout operations</small>
          </span>
        </Link>

        <PublicSectionNavigation
          ariaLabel="Public navigation"
          className="public-home-nav"
          items={navigationItems}
        />

        <div className="public-home-actions">
          <Link className="public-secondary-link" href={secondaryHref}>
            {secondaryLabel}
          </Link>
          <Link className="public-primary-button" href={primaryHref}>
            {primaryLabel}
            <span aria-hidden="true">↗</span>
          </Link>
        </div>

        <details className="public-mobile-menu">
          <summary aria-label="Open navigation">Menu</summary>
          <nav aria-label="Mobile public navigation">
            <a href="#product">Product</a>
            <a href="#workflow">Workflow</a>
            <a href="#guardrails">Quality</a>
            <a href="#outcomes">Outcomes</a>
            {signedIn ? (
              <Link href="/workspace">Open workspace</Link>
            ) : (
              <>
                <Link href="/?auth=signin">Sign in</Link>
                <Link href="/?auth=signup">Create demo workspace</Link>
              </>
            )}
          </nav>
        </details>
      </header>

      <section className="public-hero" aria-label="FieldClose introduction">
        <div className="public-hero-media">
          <picture>
            <source
              media="(max-width: 36rem)"
              srcSet="/images/fieldclose-hero-mobile.webp"
            />
            <Image
              alt="A commercial HVAC technician reviewing rooftop equipment"
              draggable={false}
              fill
              priority
              sizes="100vw"
              src="/images/fieldclose-hero-desktop.webp"
            />
          </picture>
        </div>
        <div className="public-hero-shade" aria-hidden="true" />
        <div className="public-hero-content">
          <div className="public-hero-copy-column">
            <p className="public-wordmark">FieldClose</p>
            <p className="public-eyebrow">Human-approved work-order closeout</p>
            <h1>
              Close every completed job.
              <span>Keep every decision human.</span>
            </h1>
            <p className="public-hero-copy">
              Get customer confirmation through one approved workflow, with the
              brief, result, and next step kept visible.
            </p>
            <div className="public-hero-actions">
              <Link className="public-primary-button public-hero-primary" href={primaryHref}>
                {primaryLabel}
                <span aria-hidden="true">↗</span>
              </Link>
              <Link className="public-secondary-link" href="/#workflow">
                See how it works <span aria-hidden="true">→</span>
              </Link>
            </div>
            <p className="public-safety-note">
              <span aria-hidden="true" />
              Public demo · No phone call placed
            </p>
          </div>
          <div className="public-hero-showcase" aria-label="Closeout review preview">
            <div className="hero-showcase-toolbar">
              <strong>FIELDCLOSE</strong>
              <span>
                <i aria-hidden="true" /> Simulation mode
              </span>
            </div>
            <div className="hero-showcase-body">
              <div className="hero-showcase-reference">
                <span>WO-DEMO-1042</span>
                <strong>Ready for review</strong>
              </div>
              <h2>Confirm rooftop unit operation.</h2>
              <p>
                The approved brief keeps the call focused on customer
                confirmation and nothing else.
              </p>
              <dl>
                <div>
                  <dt>Recipient</dt>
                  <dd>Site manager · masked</dd>
                </div>
                <div>
                  <dt>Boundary</dt>
                  <dd>No diagnosis · no pricing</dd>
                </div>
              </dl>
            </div>
            <div className="hero-showcase-footer">
              <span>Human approval required</span>
              <strong>Review brief <span aria-hidden="true">→</span></strong>
            </div>
          </div>
        </div>
        <p className="public-hero-caption" aria-hidden="true">
          <span>AI-assisted</span>
          <span>Human controlled</span>
          <span>Audited</span>
        </p>
      </section>

      <PublicReveal>
        <section className="public-product" id="product">
          <div className="public-section-heading">
            <p className="public-eyebrow">The product</p>
            <h2>One call, controlled end to end.</h2>
          </div>
          <div className="public-product-copy">
            <p>
              FieldClose gives the office a single, approved instrument for the
              confirmation call. Review the contact, the purpose, and the exact
              brief before anything is placed.
            </p>
            <div className="public-product-preview">
              <div className="product-preview-topline">
                <span>WO-DEMO-1042</span>
                <strong>Simulation environment</strong>
              </div>
              <blockquote>
                A technician visited the north store to confirm the rooftop unit
                is operating as installed.
              </blockquote>
              <dl>
                <div>
                  <dt>Recipient</dt>
                  <dd>Site manager · masked</dd>
                </div>
                <div>
                  <dt>Purpose</dt>
                  <dd>Confirm operation, surface issues</dd>
                </div>
                <div>
                  <dt>Boundary</dt>
                  <dd>No diagnosis · no pricing</dd>
                </div>
              </dl>
              <p>
                <span>Approval status</span>
                <strong>Waiting for one human approval</strong>
              </p>
            </div>
          </div>
        </section>
      </PublicReveal>

      <PublicReveal>
        <section className="public-workflow" id="workflow">
          <div className="public-section-heading public-section-heading-light">
            <p className="public-eyebrow">The workflow</p>
            <h2>Closeout progress stays explicit.</h2>
          </div>
          <ol className="public-workflow-list">
            {workflowStages.map((stage) => (
              <li key={stage.index}>
                <span aria-hidden="true">{stage.index}</span>
                <div>
                  <h3>{stage.title}</h3>
                  <p>{stage.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </PublicReveal>

      <PublicReveal>
        <section className="public-guardrails" id="guardrails">
          <header>
            <p className="public-eyebrow">Quality controls</p>
            <h2>Every automated step is bounded.</h2>
            <p>
              The phone agent crosses the same application boundary whether it
              runs as a simulation or a live CALL-E call. People approve, decide,
              and own the outcome.
            </p>
          </header>
          {guardrailColumns.map((column) => (
            <div className={`guardrail-column ${column.tone}`} key={column.heading}>
              <span>{column.label}</span>
              <h3>{column.heading}</h3>
              <ul>
                {column.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </PublicReveal>

      <PublicReveal>
        <section className="public-outcomes" id="outcomes">
          <div className="public-section-heading">
            <p className="public-eyebrow">The outcome</p>
            <h2>Provider evidence is not a business decision.</h2>
          </div>
          <div className="public-outcomes-copy">
            <p>
              FieldClose preserves what the call actually returned, keeps the
              source and confidence, and routes every uncertain outcome back to a
              person.
            </p>
            <dl className="outcome-record">
              {outcomeRecords.map((record) => (
                <div key={record.label}>
                  <span>{record.label}</span>
                  <strong>{record.value}</strong>
                  <small>{record.detail}</small>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </PublicReveal>

      <PublicReveal>
        <section className="public-exceptions" aria-label="Exception handling">
          <div className="public-section-heading">
            <p className="public-eyebrow">Handling the unexpected</p>
            <h2>Uncertainty is surfaced, never smoothed over.</h2>
          </div>
          <ol>
            {exceptionRows.map((row) => (
              <li key={row.index}>
                <span aria-hidden="true">{row.index}</span>
                <strong>{row.title}</strong>
                <p>{row.detail}</p>
              </li>
            ))}
          </ol>
        </section>
      </PublicReveal>

      <PublicReveal>
        <section className="public-final-cta">
          <p className="public-eyebrow">Get started</p>
          <h2>Close the loop on every completed job.</h2>
          <p>
            See the approved-bound calling flow in a safe, fake-only demo. No
            phone call is placed from the public site.
          </p>
          <Link className="public-primary-button public-final-button" href={primaryHref}>
            {primaryLabel}
            <span aria-hidden="true">↗</span>
          </Link>
        </section>
      </PublicReveal>

      <footer className="public-footer">
        <Link className="public-brand" href="/">
          <BrandMark />
          <span>
            <strong>FieldClose</strong>
            <small>AI-assisted HVAC closeout operations</small>
          </span>
        </Link>
        <p>Focused by design. Every operational decision stays human.</p>
      </footer>

      <Suspense fallback={null}>
        <AuthDrawer />
      </Suspense>
    </div>
  );
}
