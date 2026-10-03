import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  FolderOpen,
  Home as HomeIcon,
  LogOut,
  Menu,
  Plus,
  Radio,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { api, setSession, type CaseDetail, type CaseSummary } from './api';
import type { Plan, SessionInfo, Task } from './domain/model';
import { defaultTask } from './domain/templates';
import { Home } from './components/Home';
import { Connection } from './components/Connection';
import { Learning } from './components/Learning';
import { NewCheck, type NewCheckStart } from './components/NewCheck';
import { Workspace, type WorkspaceActions } from './components/Workspace';
import { InlineError, Logo, Modal } from './components/Shared';

export default function App() {
  const [session, setSessionState] = useState<SessionInfo | null>(null),
    [cases, setCases] = useState<CaseSummary[]>([]),
    [active, setActive] = useState<CaseDetail | null>(null),
    [view, setView] = useState('home'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [modal, setModal] = useState<'auth' | 'connection' | 'learning' | 'help' | null>(null),
    [preview, setPreview] = useState<Plan | null>(null),
    [mobileNav, setMobileNav] = useState(false);
  const [newCheck, setNewCheck] = useState<NewCheckStart | null>(null);
  function startCheck(
    template: Task['template'] = 'repair',
    text?: string,
    mode?: 'sample' | 'live',
  ) {
    setError('');
    setMobileNav(false);
    setNewCheck({ template, text, mode });
  }
  const activeId = useRef<string | null>(null);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mobileNav) navigation.current?.querySelector('button')?.focus();
  }, [mobileNav]);
  activeId.current = active?.id || null;
  const updateSession = (s: SessionInfo) => {
    setSession(s);
    setSessionState(s);
  };
  const list = useCallback(async () => {
    setCases(await api<CaseSummary[]>('/cases'));
  }, []);
  const open = useCallback(async (id: string, push = true) => {
    setError('');
    try {
      const record = await api<CaseDetail>(`/cases/${id}`);
      setActive(record);
      setView('check');
      setMobileNav(false);
      if (push) history.pushState({}, '', `?case=${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        const s = await api<SessionInfo>('/session');
        if (canceled) return;
        updateSession(s);
        await list();
        const id = new URLSearchParams(location.search).get('case');
        if (id) await open(id, false);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    const pop = () => {
      const id = new URLSearchParams(location.search).get('case');
      if (id) void open(id, false);
      else {
        setView('home');
        setActive(null);
      }
    };
    window.addEventListener('popstate', pop);
    return () => {
      canceled = true;
      window.removeEventListener('popstate', pop);
    };
  }, [list, open]);
  useEffect(() => {
    if (
      !active?.plans.some((p) =>
        p.inquiries.some((i) => ['submitted', 'observing', 'claimed'].includes(i.state)),
      )
    )
      return;
    const id = active.id;
    const timer = setInterval(() => {
      void api<CaseDetail>(`/cases/${id}`)
        .then((record) => {
          if (activeId.current === id) setActive(record);
        })
        .catch((e) => setError((e as Error).message));
    }, 5000);
    return () => clearInterval(timer);
  }, [active?.id, active?.plans]);
  function go(next: string) {
    setView(next);
    setActive(null);
    setError('');
    setMobileNav(false);
    history.pushState({}, '', '/');
    void list().catch((e) => setError(e.message));
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const create = (
    template: Task['template'],
    text?: string,
    mode: 'sample' | 'live' = 'sample',
  ) => {
    void run(async () => {
      let task = defaultTask(template);
      if (text) {
        const draft = await api<{ task: Task; notes: string[] }>('/draft', 'POST', {
          template,
          text,
        });
        task = draft.task;
        setNotice(draft.notes.join(' '));
      } else setNotice('');
      const record = await api<CaseDetail>('/cases', 'POST', { task, mode });
      setActive(record);
      setView('check');
      history.pushState({}, '', `?case=${record.id}`);
      setMobileNav(false);
      await list();
    });
  };
  async function mutate(path: string, body: unknown = {}, method = 'POST') {
    if (!active) return;
    const id = active.id;
    const record = await api<CaseDetail>(`/cases/${id}${path}`, method, body);
    if (activeId.current === id) setActive(record);
    await list();
  }
  const actions: WorkspaceActions = {
    save: (task) =>
      void run(async () => {
        const key = `readycheck-draft-v1:${session!.user.id}:${active!.id}:${active!.currentVersion}`;
        await mutate('', { task, expectedVersion: active!.currentVersion }, 'PATCH');
        localStorage.removeItem(key);
      }),
    sample: (ids) =>
      void run(() =>
        mutate('/sample', { expectedVersion: active!.currentVersion, candidateIds: ids }),
      ),
    followup: (id, field) =>
      void run(() =>
        mutate('/sample-followup', {
          expectedVersion: active!.currentVersion,
          candidateId: id,
          focusField: field,
        }),
      ),
    prepare: (ids, followup, focusField) =>
      void run(async () =>
        setPreview(
          await api<Plan>(`/cases/${active!.id}/plans`, 'POST', {
            recipientIds: ids,
            expectedVersion: active!.currentVersion,
            followupFor: followup,
            focusField,
          }),
        ),
      ),
    approve: (plan) =>
      void run(async () => {
        await api(`/plans/${plan.id}/approve`, 'POST', { hash: plan.hash, consent: true });
        setPreview(null);
        await open(active!.id, false);
      }),
    continue: (id) =>
      void run(async () => {
        await api(`/plans/${id}/continue`, 'POST');
        await open(active!.id, false);
      }),
    stop: () => void run(() => mutate('/stop')),
    remove: () =>
      void run(async () => {
        const prefix = `readycheck-draft-v1:${session!.user.id}:${active!.id}:`;
        await api(`/cases/${active!.id}`, 'DELETE');
        for (const key of Object.keys(localStorage))
          if (key.startsWith(prefix)) localStorage.removeItem(key);
        setActive(null);
        setView('home');
        history.pushState({}, '', '/');
        await list();
      }),
    outcome: (candidateId, state, note) =>
      void run(() => mutate('/outcomes', { candidateId, state, note })),
    review: (candidateId, version, review) =>
      void run(() => mutate('/review', { candidateId, version, reviews: [review] })),
    acknowledge: (inquiryId) => void run(() => mutate('/acknowledge', { inquiryId })),
    refresh: () =>
      void run(async () => {
        await open(active!.id, false);
      }),
    recover: (inquiryId) =>
      void run(async () => {
        try {
          await api(`/inquiries/${inquiryId}/recover`, 'POST', { confirm: true });
        } finally {
          await open(active!.id, false);
        }
      }),
    reconcile: (inquiryId, vendorId) =>
      void run(async () => {
        await api(`/inquiries/${inquiryId}/reconcile`, 'POST', { vendorId });
        await open(active!.id, false);
      }),
  };
  return (
    <div className="app-shell">
      <button
        ref={navigationToggle}
        className="mobile-menu icon-button"
        aria-label="Open navigation"
        aria-expanded={mobileNav}
        aria-controls="workspace-navigation"
        onClick={() => setMobileNav(!mobileNav)}
      >
        <Menu size={22} />
      </button>
      {mobileNav ? (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      ) : null}
      <aside
        id="workspace-navigation"
        ref={navigation}
        className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && mobileNav) {
            setMobileNav(false);
            navigationToggle.current?.focus();
          }
        }}
      >
        <button className="brand-button" onClick={() => go('home')} aria-label="ReadyCheck home">
          <Logo />
        </button>
        <button
          className="button primary new-check"
          disabled={busy || !session}
          onClick={() => startCheck()}
        >
          <Plus size={17} />
          New check
        </button>
        <div className="nav-group-label">WORKSPACE</div>
        <nav>
          <button className={view === 'home' ? 'active' : ''} onClick={() => go('home')}>
            <HomeIcon size={18} />
            Overview
          </button>
          <button
            className={view === 'saved' || view === 'check' ? 'active' : ''}
            onClick={() => go('saved')}
          >
            <FolderOpen size={18} />
            Saved checks<span className="nav-count">{cases.length}</span>
          </button>
          <button onClick={() => setModal('connection')}>
            <Radio size={18} />
            Connection
            <span
              className={`connection-dot ${session?.connection.configured ? 'connected' : ''}`}
            />
          </button>
          <button onClick={() => setModal('learning')}>
            <Sparkles size={18} /> Learning
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-icon">
            <ShieldCheck size={21} />
          </span>
          <h3>You’re in the driver’s seat.</h3>
          <p>
            Review every inquiry.
            <br />
            Make the final decision.
          </p>
          <button onClick={() => setModal('help')}>
            How it works
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button className="help-button" onClick={() => setModal('help')}>
            <CircleHelp size={17} />A little guidance
          </button>
          <div className="account-area">
            <button
              className="account-button"
              onClick={() => setModal(session?.user.guest ? 'auth' : 'connection')}
            >
              <span className="user-avatar">
                {session?.user.guest ? 'Y' : session?.user.name.slice(0, 1).toUpperCase() || 'Y'}
              </span>
              <span>
                <strong>
                  {session?.user.guest
                    ? 'Your workspace'
                    : session?.user.name || 'Opening workspace'}
                </strong>
                <small>{session?.user.guest ? 'Guest · Create an account' : 'Signed in'}</small>
              </span>
              <ChevronDown size={14} />
            </button>
            {session && !session.user.guest ? (
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={() =>
                  void run(async () => {
                    updateSession(await api<SessionInfo>('/auth/signout', 'POST'));
                    setActive(null);
                    setView('home');
                    history.pushState({}, '', '/');
                    await list();
                  })
                }
              >
                <LogOut size={15} />
              </button>
            ) : null}
          </div>
        </div>
      </aside>
      <main className="main-shell" aria-label="Your checks">
        <header className="topbar">
          <span>
            Your workspace<span className="breadcrumb-divider">/</span>
            <strong>
              {view === 'check'
                ? active?.title || 'Your check'
                : view === 'saved'
                  ? 'Saved checks'
                  : 'Overview'}
            </strong>
          </span>
          <button className="topbar-help" onClick={() => setModal('help')}>
            <span className="small-dot" />
            Know before you go
            <ArrowUpRightSmall />
          </button>
        </header>
        {error ? (
          <div className="global-message">
            <InlineError message={error} />
            <button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="global-message notice" role="status">
            <Sparkles size={17} />
            <span>{notice}</span>
            <button
              className="icon-button"
              onClick={() => setNotice('')}
              aria-label="Dismiss starter guidance"
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
        {!session ? (
          <div className="loading-screen">
            <Logo />
            <p>{error ? 'The workspace could not be opened.' : 'Opening your workspace…'}</p>
            {error ? (
              <button className="button primary" onClick={() => location.reload()}>
                Try again
              </button>
            ) : null}
          </div>
        ) : view === 'check' && active ? (
          <Workspace
            key={active.id}
            record={active}
            session={session}
            busy={busy}
            actions={actions}
            preview={preview}
            onClosePreview={() => setPreview(null)}
            onBack={() => go('saved')}
          />
        ) : (
          <Home
            cases={cases}
            onCreate={create}
            onStart={startCheck}
            onOpen={(id) => void run(() => open(id))}
            busy={busy}
            savedOnly={view === 'saved'}
          />
        )}
      </main>
      {newCheck && session ? (
        <NewCheck
          initial={newCheck}
          session={session}
          busy={busy}
          error={error}
          onClose={() => setNewCheck(null)}
          onConnection={() => {
            setNewCheck(null);
            setModal('connection');
          }}
          onCreate={(task, mode) =>
            void run(async () => {
              const record = await api<CaseDetail>('/cases', 'POST', { task, mode });
              setActive(record);
              setView('check');
              setNewCheck(null);
              setNotice('');
              history.pushState({}, '', `?case=${record.id}`);
              await list();
            })
          }
        />
      ) : null}
      {modal === 'auth' ? (
        <AuthDialog
          onClose={() => setModal(null)}
          onSubmit={(kind, input) =>
            void run(async () => {
              const next = await api<SessionInfo>(`/auth/${kind}`, 'POST', input);
              updateSession(next);
              setModal(null);
              setActive(null);
              setView('home');
              history.pushState({}, '', '/');
              await list();
            })
          }
          busy={busy}
          error={error}
        />
      ) : null}
      {modal === 'connection' && session ? (
        <Connection
          session={session}
          busy={busy}
          onClose={() => setModal(null)}
          onCreateAccount={() => setModal('auth')}
          onRefresh={async () => updateSession(await api<SessionInfo>('/session'))}
          onLearning={() => setModal('learning')}
          onStart={() => {
            setModal(null);
            startCheck('repair', undefined, 'live');
          }}
        />
      ) : null}
      {modal === 'help' ? (
        <Modal title="A little clarity goes a long way." onClose={() => setModal(null)}>
          <p className="modal-intro">
            ReadyCheck helps you check whether a local option fits your complete request.
          </p>
          <ol className="help-steps">
            <li>
              <strong>Make your requirements explicit.</strong>
              <p>
                Review the exact service or item, budget, dates, and must-haves. Preferences never
                rescue a failed requirement.
              </p>
            </li>
            <li>
              <strong>Preview the questions.</strong>
              <p>
                Samples make no calls. Live inquiries go only to configured consenting test
                recipients after your approval.
              </p>
            </li>
            <li>
              <strong>Look at the evidence.</strong>
              <p>
                A starting estimate, unanswered question, or expired fact stays unresolved. You can
                inspect and correct extracted answers.
              </p>
            </li>
            <li>
              <strong>Choose the next step.</strong>
              <p>
                Save an option, clarify a blocker, or record an arrangement you made yourself.
                ReadyCheck does not transact or book.
              </p>
            </li>
          </ol>
          <p className="privacy-note">
            Live raw transcripts are retained for the server’s configured retention period (30 days
            by default). Case summaries remain until deletion. Provider retention is separate. Use
            ordinary, non-sensitive tasks; the controlled demo is for synthetic scenarios.
          </p>
          <button className="button primary" onClick={() => setModal(null)}>
            Got it
            <Check size={15} />
          </button>
        </Modal>
      ) : null}
      {modal === 'learning' ? (
        <Modal title="Your learning history" onClose={() => setModal(null)}>
          <Learning />
        </Modal>
      ) : null}
      <div className="sr-only" role="status" aria-live="polite">
        {busy ? 'Saving your change.' : 'Workspace ready.'}
      </div>
    </div>
  );
}
function ArrowUpRightSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 12 12 4M4 4h8v8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function AuthDialog({
  onClose,
  onSubmit,
  busy,
  error,
}: {
  onClose: () => void;
  onSubmit: (
    kind: 'signup' | 'signin',
    input: { email: string; password: string; name?: string },
  ) => void;
  busy: boolean;
  error: string;
}) {
  const [kind, setKind] = useState<'signup' | 'signin'>('signup'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState('');
  return (
    <Modal
      title={kind === 'signup' ? 'Make this workspace yours.' : 'Welcome back.'}
      onClose={onClose}
    >
      <p className="modal-intro">
        {kind === 'signup'
          ? 'Keep your current checks and sign back in to this server whenever you need them.'
          : 'Sign in to reopen your saved checks. Guest checks are retained only in the guest workspace.'}
      </p>
      {error ? <InlineError message={error} /> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(kind, { email, password, ...(kind === 'signup' ? { name } : {}) });
        }}
      >
        {kind === 'signup' ? (
          <label>
            Your name
            <input
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
            />
          </label>
        ) : null}
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            aria-label="Password"
            aria-describedby="password-help"
            type="password"
            minLength={12}
            maxLength={200}
            autoComplete={kind === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <small id="password-help">At least 12 characters.</small>
        </label>
        <button className="button primary full" disabled={busy} type="submit">
          {kind === 'signup' ? 'Create account' : 'Sign in'}
          <ArrowRight size={15} />
        </button>
      </form>
      <button
        className="auth-switch text-button"
        onClick={() => setKind(kind === 'signup' ? 'signin' : 'signup')}
      >
        {kind === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
    </Modal>
  );
}
