import Link from "next/link";
import { Suspense } from "react";

import { AuthDrawer } from "@/components/auth-drawer";
import { BrandMark } from "@/components/brand-mark";
import {
  PublicSectionNavigation,
  type PublicSectionNavigationItem,
} from "@/components/public-section-navigation";
import { projectConfig } from "@/config/project";

type PublicHomeProps = {
  signedIn: boolean;
};

const queueRows = [
  {
    workOrder: "WO-DEMO-1042",
    site: "North Store",
    customer: "Retail West",
    stage: "Call verification",
    status: "Ready to approve",
    tone: "attention",
    owner: "M. Chen",
    age: "12m",
  },
  {
    workOrder: "WO-DEMO-1038",
    site: "Lakeview Medical Office",
    customer: "Harbor Facilities",
    stage: "Closeout preparation",
    status: "Contact review",
    tone: "neutral",
    owner: "A. Rivera",
    age: "34m",
  },
  {
    workOrder: "WO-DEMO-1029",
    site: "Distribution Center 4",
    customer: "Axis Logistics",
    stage: "Invoice review",
    status: "Human owned",
    tone: "safe",
    owner: "J. Patel",
    age: "1h",
  },
  {
    workOrder: "WO-DEMO-1024",
    site: "Harbor Office",
    customer: "Crest Property",
    stage: "Completion",
    status: "Review ready",
    tone: "safe",
    owner: "S. Morgan",
    age: "2h",
  },
] as const;

const workflowStages = [
  {
    label: "Technician visit",
    state: "Complete",
    detail: "Completed field work and technician evidence received.",
    tone: "complete",
  },
  {
    label: "Closeout preparation",
    state: "Complete",
    detail: "Contact, equipment, and permitted context verified.",
    tone: "complete",
  },
  {
    label: "Call verification",
    state: "In progress",
    detail: "Exact brief is waiting for one human approval.",
    tone: "current",
  },
  {
    label: "Invoice review",
    state: "Human owned",
    detail: "Commercial review stays outside the phone agent.",
    tone: "pending",
  },
  {
    label: "Completion status",
    state: "Pending",
    detail: "A person makes the final operational decision.",
    tone: "pending",
  },
] as const;

const qualityControls = [
  ["Identity verified", "Recipient role and masked contact are reviewed."],
  ["Brief bounded", "Only approved closeout facts can be collected."],
  ["Decision retained", "Recommendations never close work automatically."],
] as const;

const publicNavigationItems = [
  { href: "#overview", label: "Overview" },
  { href: "#queue", label: "Case queue" },
  { href: "#workflow", label: "Workflow" },
  { href: "#guardrails", label: "Quality controls" },
] as const satisfies readonly PublicSectionNavigationItem[];

const publicPreviewNavigationItems = [
  { count: "12", href: "#overview", label: "Overview" },
  { count: "8", href: "#queue", label: "Closeout cases" },
  { count: "3", href: "#workflow", label: "Quality review" },
  { count: "1", href: "#guardrails", label: "Exceptions" },
  { href: "#outcomes", label: "Audit trail" },
] as const satisfies readonly PublicSectionNavigationItem[];

export function PublicHome({ signedIn }: PublicHomeProps) {
  const primaryHref = signedIn ? "/workspace" : "/?auth=signup";
  const primaryLabel = signedIn ? "Open workspace" : "Explore demo workspace";

  return (
    <div className="public-home ops-public-shell">
      <header className="public-home-header ops-topbar">
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
          items={publicNavigationItems}
        />

        <div className="public-home-actions">
          {signedIn ? null : (
            <Link className="public-signin-link" href="/?auth=signin">
              Sign in
            </Link>
          )}
          <Link className="public-primary-button" href={primaryHref}>
            {primaryLabel}
            <span aria-hidden="true">↗</span>
          </Link>
        </div>

        <details className="public-mobile-menu">
          <summary aria-label="Open navigation">Menu</summary>
          <nav aria-label="Mobile public navigation">
            <a href="#overview">Overview</a>
            <a href="#queue">Case queue</a>
            <a href="#workflow">Workflow</a>
            <a href="#guardrails">Quality controls</a>
            {signedIn ? (
              <Link href="/workspace">Open workspace</Link>
            ) : (
              <>
                <Link href="/?auth=signin">Sign in</Link>
                <Link href="/?auth=signup">Explore demo workspace</Link>
              </>
            )}
          </nav>
        </details>
      </header>

      <div className="ops-app-frame">
        <aside className="ops-sidebar public-ops-sidebar">
          <div className="ops-workspace-switcher">
            <span className="ops-workspace-avatar">DW</span>
            <span>
              <small>Workspace</small>
              <strong>Demo Operations</strong>
            </span>
            <span aria-hidden="true">⌄</span>
          </div>

          <PublicSectionNavigation
            ariaLabel="Operations preview"
            items={publicPreviewNavigationItems}
          />

          <div className="ops-sidebar-safety">
            <span className="ops-live-dot" aria-hidden="true" />
            <div>
              <strong>Simulation environment</strong>
              <span>Public demo · No phone call</span>
            </div>
          </div>
        </aside>

        <main className="public-ops-main" id="main-content">
          <section className="ops-page-heading" id="overview">
            <div>
              <p className="ops-breadcrumb">
                Operations <span>/</span> Closeout control
              </p>
              <h1>HVAC closeout command center</h1>
              <p>
                Review field evidence, control one approved call, and route every
                uncertain outcome back to a person.
              </p>
            </div>
            <div className="ops-heading-actions">
              <span className="ops-ai-label">
                <i aria-hidden="true" />
                AI-assisted · Human controlled
              </span>
              <Link className="public-primary-button" href={primaryHref}>
                {primaryLabel}
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </section>

          <section aria-label="Closeout overview" className="ops-metric-grid">
            <article>
              <span>Active closeouts</span>
              <strong>12</strong>
              <small>Across four service sites</small>
            </article>
            <article>
              <span>Awaiting verification</span>
              <strong>03</strong>
              <small>Two briefs ready to approve</small>
            </article>
            <article>
              <span>Human review</span>
              <strong>04</strong>
              <small>Commercial or quality decision</small>
            </article>
            <article className="ops-metric-attention">
              <span>Needs attention</span>
              <strong>01</strong>
              <small>Wrong-person contact result</small>
            </article>
          </section>

          <div className="ops-dashboard-grid">
            <section className="ops-module ops-queue-module" id="queue">
              <header className="ops-module-header">
                <div>
                  <p>Closeout queue</p>
                  <h2>Work requiring operator attention</h2>
                </div>
                <span>Fictional preview data</span>
              </header>

              <div className="ops-table-wrap">
                <table className="ops-data-table">
                  <thead>
                    <tr>
                      <th scope="col">Work order / site</th>
                      <th scope="col">Workflow stage</th>
                      <th scope="col">Status</th>
                      <th scope="col">Owner</th>
                      <th scope="col">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueRows.map((row) => (
                      <tr key={row.workOrder}>
                        <td>
                          <strong>{row.workOrder}</strong>
                          <span>
                            {row.customer} · {row.site}
                          </span>
                        </td>
                        <td data-label="Stage">{row.stage}</td>
                        <td data-label="Status">
                          <span className={`ops-status ops-status-${row.tone}`}>
                            {row.status}
                          </span>
                        </td>
                        <td data-label="Owner">{row.owner}</td>
                        <td data-label="Updated">{row.age}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="ops-action-panel">
              <header>
                <span className="ops-priority">Priority review</span>
                <span>01 of 03</span>
              </header>
              <p className="ops-action-work-order">WO-DEMO-1042</p>
              <h2>Approve the exact closeout brief</h2>
              <p>
                The site manager and permitted questions are ready for one
                human-approved simulation.
              </p>
              <dl>
                <div>
                  <dt>Site</dt>
                  <dd>North Store</dd>
                </div>
                <div>
                  <dt>Equipment</dt>
                  <dd>Rooftop unit RTU-2</dd>
                </div>
                <div>
                  <dt>Contact</dt>
                  <dd>Site manager · masked</dd>
                </div>
              </dl>
              <Link className="ops-panel-action" href={primaryHref}>
                Review approval checkpoint
                <span aria-hidden="true">→</span>
              </Link>
              <small>No action is taken from this public preview.</small>
            </aside>
          </div>

          <section className="ops-module ops-workflow-module" id="workflow">
            <header className="ops-module-header">
              <div>
                <p>Workflow control</p>
                <h2>Closeout progress stays explicit</h2>
              </div>
              <span>WO-DEMO-1042</span>
            </header>

            <ol className="ops-workflow-timeline">
              {workflowStages.map((stage, index) => (
                <li className={`is-${stage.tone}`} key={stage.label}>
                  <span className="ops-stage-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{stage.label}</strong>
                    <span>{stage.state}</span>
                    <p>{stage.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="ops-lower-grid">
            <section className="ops-module ops-quality-module" id="guardrails">
              <header className="ops-module-header">
                <div>
                  <p>Service quality controls</p>
                  <h2>Every automated step is bounded</h2>
                </div>
              </header>
              <ul>
                {qualityControls.map(([title, detail]) => (
                  <li key={title}>
                    <span aria-hidden="true">✓</span>
                    <div>
                      <strong>{title}</strong>
                      <p>{detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="ops-boundary-note">
                <strong>Agent boundary</strong>
                <p>
                  No diagnosis, pricing, scheduling promise, invoice approval,
                  payment handling, or automatic work-order closure.
                </p>
              </div>
            </section>

            <section className="ops-module ops-review-module" id="outcomes">
              <header className="ops-module-header">
                <div>
                  <p>Human-in-the-loop review</p>
                  <h2>Provider evidence is not a business decision</h2>
                </div>
              </header>
              <dl>
                <div>
                  <dt>Provider state</dt>
                  <dd>
                    <strong>Completed</strong>
                    <span>Technical processing evidence</span>
                  </dd>
                </div>
                <div>
                  <dt>Reported outcome</dt>
                  <dd>
                    <strong>No unresolved issue reported</strong>
                    <span>Source and confidence preserved</span>
                  </dd>
                </div>
                <div>
                  <dt>Required action</dt>
                  <dd>
                    <strong>Human closeout review</strong>
                    <span>Final decision remains with the operator</span>
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </main>
      </div>

      <footer className="public-footer ops-public-footer">
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
