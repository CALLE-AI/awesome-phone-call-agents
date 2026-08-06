import { seniors, timeline } from "../carecall/fixtures";
import type { AttentionCase, NavigationId, TimelineItem } from "../carecall/types";
import { Icon } from "../components/Icon";
import { RoutineIcon, SectionHeading, SeniorAvatar, StatusPill } from "../components/CarePrimitives";

interface TodayProps {
  attentionCount: number;
  attentionCases: AttentionCase[];
  resolvedIds: Set<string>;
  onNavigate: (destination: NavigationId) => void;
  onPreview: (item: TimelineItem) => void;
}

export function Today({ attentionCount, attentionCases, resolvedIds, onNavigate, onPreview }: TodayProps) {
  const urgentCase = attentionCases.find((item) => !resolvedIds.has(item.id));
  const urgentSenior = urgentCase ? seniors.find((senior) => senior.id === urgentCase.seniorId) : undefined;
  const metrics = [
    { label: "Reminders today", value: "12", note: "Across 4 seniors", tone: "neutral" },
    { label: "Self-reported complete", value: "8", note: "Medication and meals", tone: "success" },
    { label: "Upcoming", value: "3", note: "Next at 12:30 PM", tone: "accent" },
    { label: "Needs attention", value: String(attentionCount), note: attentionCount === 1 ? "1 open care case" : `${attentionCount} open care cases`, tone: "attention" },
  ];

  return (
    <div className="page page--today">
      <header className="page-intro">
        <div>
          <p className="eyebrow">Tuesday, 4 August · Singapore</p>
          <h1>Good afternoon, Mei.</h1>
          <p className="page-summary">Here’s what your care team needs to know today.</p>
        </div>
        <div className="service-state service-state--demo" role="status">
          <span className="service-state__indicator" aria-hidden="true" />
          Demo workspace · live calls gated
        </div>
      </header>

      <section className="metric-grid" aria-label="Today's care summary">
        {metrics.map((metric) => (
          <article className="metric-card" data-tone={metric.tone} key={metric.label}>
            <p>{metric.label}</p>
            <strong>{metric.value}</strong>
            <span>{metric.note}</span>
          </article>
        ))}
      </section>

      <div className="today-grid">
        <section className="surface timeline-card" aria-labelledby="timeline-heading">
          <SectionHeading
            eyebrow="Care timeline"
            title="Today’s calls"
            headingId="timeline-heading"
            action={<button className="text-button" type="button" onClick={() => onNavigate("routines")}>View routines <Icon name="chevron" size={16} /></button>}
          />
          <div className="timeline-list">
            {timeline.map((item) => {
              const senior = seniors.find((candidate) => candidate.id === item.seniorId)!;
              return (
                <button className="timeline-row" key={item.id} type="button" onClick={() => onPreview(item)}>
                  <time>{item.time}</time>
                  <SeniorAvatar initials={senior.initials} tone={senior.avatar} size="small" />
                  <div className="timeline-row__identity">
                    <strong>{senior.preferredName}</strong>
                    <span>{item.title}</span>
                  </div>
                  <RoutineIcon kind={item.kind} />
                  <div className="timeline-row__state">
                    <StatusPill status={item.status} label={item.statusLabel} />
                    <span>{item.detail}</span>
                  </div>
                  <Icon name="chevron" size={18} />
                </button>
              );
            })}
          </div>
        </section>

        <aside className="today-aside" aria-label="Care team priorities">
          {urgentCase && urgentSenior ? (
            <section className="attention-card">
              <div className="attention-card__icon"><Icon name="attention" size={21} /></div>
              <p className="eyebrow">Needs attention</p>
              <h2>{urgentCase.title}</h2>
              <p>{urgentCase.context}</p>
              <div className="attention-card__meta">
                <SeniorAvatar initials={urgentSenior.initials} tone={urgentSenior.avatar} size="small" />
                <span>{urgentSenior.preferredName} · {urgentCase.createdAt}</span>
              </div>
              <button className="primary-button primary-button--attention" type="button" onClick={() => onNavigate("attention")}>
                Review case
                <Icon name="chevron" size={17} />
              </button>
            </section>
          ) : (
            <section className="attention-card attention-card--clear">
              <div className="attention-card__icon"><Icon name="check" size={21} /></div>
              <p className="eyebrow">All caught up</p>
              <h2>No care cases need attention.</h2>
              <p>Successful routines stay quiet so your team can focus on people who need help.</p>
            </section>
          )}

          <section className="surface next-card">
            <div className="next-card__topline">
              <span className="routine-icon" data-kind="meal"><Icon name="food" size={18} /></span>
              <span className="quiet-label">Next reminder</span>
            </div>
            <h2>Lunch check-in</h2>
            <p>Mr Rahman · 12:30 PM</p>
            <div className="next-card__time"><Icon name="clock" size={18} /> Starts in 18 minutes</div>
            <button className="secondary-button secondary-button--wide" type="button" onClick={() => onPreview(timeline[2])}>
              Preview call
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}
