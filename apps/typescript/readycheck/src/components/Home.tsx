import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  SlidersHorizontal,
  PhoneOutgoing,
  ListChecks,
  Sparkles,
  Search,
  Clock3,
} from 'lucide-react';
import type { Task } from '../domain/model';
import { templateMeta } from '../domain/templates';
import type { CaseSummary } from '../api';
import { ModeBadge, templateIcons } from './Shared';

export function Home({
  cases,
  onCreate,
  onStart,
  onOpen,
  busy,
  savedOnly = false,
}: {
  cases: CaseSummary[];
  onCreate: (template: Task['template'], text?: string) => void;
  onStart: (template: Task['template'], text?: string) => void;
  onOpen: (id: string) => void;
  busy: boolean;
  savedOnly?: boolean;
}) {
  const [text, setText] = useState(''),
    [template, setTemplate] = useState<Task['template']>('repair'),
    [query, setQuery] = useState('');
  const visible = cases.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));
  const attention = cases.filter((c) => ['review', 'attention'].includes(c.progress?.phase || ''));
  const resume =
    attention[0] || cases.find((c) => !['completed', 'stopped'].includes(c.progress?.phase || ''));
  return (
    <div className="home-page">
      {!savedOnly ? (
        <>
          <div className="home-topline">
            <span className="eyebrow">
              <span className="small-dot" />
              LESS GUESSWORK. MORE GETTING THINGS DONE.
            </span>
            <ModeBadge mode="sample" />
          </div>
          <section className="hero">
            <div>
              <h1>
                A little certainty.
                <br />
                <span>A lot less calling.</span>
              </h1>
              <p>
                Tell us what needs to be true. Check local options,
                <br className="desktop-break" /> see the evidence, and know your next move.
              </p>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="art-orbit orbit-one" />
              <div className="art-orbit orbit-two" />
              <div className="art-slip back">
                <span />
                <span />
                <span />
              </div>
              <div className="art-slip front">
                <span className="art-check">✓</span>
                <div>
                  <b>All the details.</b>
                  <span>One clear next step.</span>
                </div>
                <div className="art-lines">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <div className="art-spark">✳</div>
            </div>
          </section>
          <section className="intake-card" aria-label="Describe your task">
            <label htmlFor="task-description">
              <Sparkles size={17} />
              What are you trying to get done?
            </label>
            <textarea
              id="task-description"
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              placeholder="I need a backpack zipper repaired by Friday, under $40, with drop-off after 5 p.m."
              rows={2}
            />
            <div className="intake-bottom">
              <label className="select-pill">
                <span className="sr-only">Task type</span>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value as Task['template'])}
                >
                  {Object.entries(templateMeta).map(([id, m]) => (
                    <option key={id} value={id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => onStart(template, text || undefined)}
              >
                Start a check
                <ArrowRight size={16} />
              </button>
            </div>
          </section>
          {resume ? (
            <section className="resume-check" aria-label="Continue your check">
              <div>
                <span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span>
                <h2>{resume.title}</h2>
                <p>
                  {resume.progress?.headline ||
                    'Your request and saved answers are ready when you are.'}
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => onOpen(resume.id)}
                disabled={busy}
              >
                Resume check <ArrowRight size={15} />
              </button>
            </section>
          ) : null}
          <div className="section-title">
            <h2>Start with something familiar</h2>
            <span>Three tasks. One thoughtful workflow.</span>
          </div>
          <div className="template-grid">
            {Object.entries(templateMeta).map(([key, meta]) => {
              const id = key as Task['template'],
                Icon = templateIcons[id];
              return (
                <button
                  key={id}
                  className={`template-card template-${id}`}
                  onClick={() => onCreate(id)}
                  disabled={busy}
                >
                  <div className="template-top">
                    <span className="template-icon">
                      <Icon size={23} strokeWidth={1.5} />
                    </span>
                    <ArrowUpRight size={18} />
                  </div>
                  <h3>{meta.title}</h3>
                  <p>{meta.description}</p>
                  <span className="template-example">
                    {meta.example}
                    <ArrowRight size={13} />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <section className="saved-heading">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>Every check, in one place.</h1>
          <p>Pick up where you left off. Your requirements and evidence stay together.</p>
        </section>
      )}
      <section className="recent-section">
        {cases.length ? (
          <div className="workspace-stats" aria-label="Workspace summary">
            <div>
              <strong>
                {
                  cases.filter((c) => !['completed', 'stopped'].includes(c.progress?.phase || ''))
                    .length
                }
              </strong>
              <span>Open checks</span>
            </div>
            <div>
              <strong>{attention.length}</strong>
              <span>Need your review</span>
            </div>
            <div>
              <strong>{cases.filter((c) => c.progress?.phase === 'completed').length}</strong>
              <span>Completed by you</span>
            </div>
          </div>
        ) : null}
        <div className="section-title">
          <h2>
            {savedOnly ? 'Saved checks' : 'Your recent checks'}
            <span className="count">{cases.length}</span>
          </h2>
          <label className="search-box">
            <Search size={15} />
            <input
              placeholder="Find a check"
              aria-label="Search saved checks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {visible.length ? (
          <div className="case-list">
            <div className="case-list-head">
              <span>CHECK</span>
              <span>STATUS</span>
              <span>LAST UPDATED</span>
            </div>
            {visible.map((c) => {
              const Icon = templateIcons[c.template];
              return (
                <button className="case-row" key={c.id} onClick={() => onOpen(c.id)}>
                  <div className="case-name">
                    <span className={`case-type ${c.template}`}>
                      <Icon size={18} />
                    </span>
                    <div>
                      <strong>{c.title}</strong>
                      <span>
                        {templateMeta[c.template].short} · Revision {c.currentVersion} ·{' '}
                        {c.mode === 'sample' ? 'Fictional sample' : 'Controlled live'}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`case-state ${c.resultCount ? 'has-results' : ''} phase-${c.progress?.phase || 'ready'}`}
                  >
                    {c.progress?.label ||
                      (c.outcome
                        ? c.outcome.replaceAll('_', ' ')
                        : c.resultCount
                          ? `${c.resultCount} options checked`
                          : 'Draft')}
                  </span>
                  <span className="case-date">
                    {new Date(c.updatedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                    <ArrowUpRight size={15} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="recent-empty">
            <span className="empty-circle">
              <Clock3 size={20} />
            </span>
            <div>
              <strong>
                {query ? 'No checks match your search.' : 'Your next good decision starts here.'}
              </strong>
              <p>
                {query
                  ? 'Try another name.'
                  : 'Start a sample above. We’ll keep the requirements, evidence, and next steps together.'}
              </p>
            </div>
            {!query ? (
              <button className="text-button" disabled={busy} onClick={() => onCreate('repair')}>
                Try a sample
                <ArrowRight size={15} />
              </button>
            ) : null}
          </div>
        )}
      </section>
      {!savedOnly ? (
        <section className="how-section">
          <div className="section-title">
            <h2>A clear path from question to next step</h2>
            <span>Always in your control</span>
          </div>
          <div className="how-grid">
            {[
              {
                icon: SlidersHorizontal,
                title: 'Define what matters',
                text: 'Make your must-haves and preferences explicit.',
              },
              {
                icon: PhoneOutgoing,
                title: 'Check the whole request',
                text: 'Preview each inquiry. See exactly what gets asked.',
              },
              {
                icon: ListChecks,
                title: 'Decide with evidence',
                text: 'Understand the blockers. Choose what happens next.',
              },
            ].map((step, i) => (
              <div className="how-step" key={step.title}>
                <span className="how-number">0{i + 1}</span>
                <div>
                  <h3>
                    <step.icon size={15} />
                    {step.title}
                  </h3>
                  <p>{step.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <footer className="page-footer">
        <span>Know before you go.</span>
        <span>Built with care. Powered by CALL-E in live mode.</span>
      </footer>
    </div>
  );
}
