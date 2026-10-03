import { useState } from 'react';
import { ArrowRight, Check, Circle, Copy, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ReadAccessCheck, SessionInfo } from '../domain/model';
import { api } from '../api';
import { ExternalLink, InlineError, Modal } from './Shared';

export function Connection({
  session,
  onClose,
  onCreateAccount,
  onStart,
  onRefresh,
  busy,
  onLearning,
}: {
  session: SessionInfo;
  onClose: () => void;
  onCreateAccount: () => void;
  onStart: () => void;
  onRefresh: () => Promise<void>;
  busy: boolean;
  onLearning: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [report, setReport] = useState<ReadAccessCheck | null>(null);
  const connection = session.connection;
  const readAccess = report || connection.readAccess;
  const ready = connection.configured && connection.authorized;
  const completed = connection.checks.filter((check) => check.ready).length;
  const canVerify =
    connection.authorized &&
    connection.checks.some((check) => check.id === 'credential' && check.ready);
  async function run(action: () => Promise<void>) {
    setError('');
    setWorking(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The check could not finish. Try again.');
    } finally {
      setWorking(false);
    }
  }
  return (
    <Modal title="Your connection" onClose={onClose}>
      <div className="connection-hero">
        <span className="connection-symbol">
          <ShieldCheck size={27} />
        </span>
        <div>
          <h3>
            {ready ? 'Ready for an approved inquiry.' : 'A few steps before your first call.'}
          </h3>
          <p>Samples are available now. Every real inquiry needs your approval.</p>
        </div>
      </div>
      <div className="setup-progress">
        <strong>
          {completed} of {connection.checks.length} setup steps complete
        </strong>
        <button
          className="text-button"
          disabled={working || busy}
          onClick={() =>
            void run(async () => {
              await onRefresh();
              setReport(null);
            })
          }
        >
          <RefreshCw size={14} /> Refresh setup
        </button>
      </div>
      <ol className="setup-checklist" aria-label="Calling setup checklist">
        {connection.checks.map((check) => (
          <li key={check.id}>
            <span className={`setup-step-icon ${check.ready ? 'ready' : ''}`}>
              {check.ready ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Circle size={16} aria-hidden="true" />
              )}
              <span className="sr-only">{check.ready ? 'Complete' : 'To do'}</span>
            </span>
            <div>
              <strong>{check.label}</strong>
              <p>{check.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <section
        className="read-access-panel"
        aria-labelledby="read-access-heading"
        aria-busy={working}
      >
        <h3 id="read-access-heading">Existing-call access</h3>
        <p>
          This optional check reads a known call through the app’s server. It never places a call or
          imports a conversation into your checks.
        </p>
        <div
          role="status"
          className={`read-access-result ${readAccess?.status === 'verified' ? 'verified' : ''}`}
        >
          {readAccess ? (
            <>
              <strong>
                {readAccess.status === 'verified'
                  ? 'Last read succeeded'
                  : 'Read access is not verified'}
              </strong>
              <p>{readAccess.message}</p>
              <small>Checked {new Date(readAccess.checkedAt).toLocaleString()}</small>
            </>
          ) : (
            <p>
              Not checked. Agent CLI sign-in and a saved API key do not verify this app’s read
              access.
            </p>
          )}
        </div>
        <button
          className="button secondary"
          disabled={!canVerify || working || busy}
          onClick={() =>
            void run(async () => {
              setReport(await api<ReadAccessCheck>('/connection/verify', 'POST', {}));
              await onRefresh();
            })
          }
        >
          <RefreshCw size={15} /> {working ? 'Checking…' : 'Check existing-call access'}
        </button>
        {!canVerify ? (
          <p className="small muted">An authorized account and a server API key are required.</p>
        ) : null}
      </section>
      {error ? <InlineError message={error} /> : null}
      <button className="text-button" onClick={onLearning}>
        Review your correction memory <ArrowRight size={14} />
      </button>
      <div className="account-id">
        <label>
          Account ID for server authorization
          <input
            readOnly
            value={session.user.id}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <button
          className="text-button"
          onClick={() => {
            setCopied(false);
            void run(async () => {
              if (!navigator.clipboard)
                throw new Error(
                  'Copy is unavailable. Select the account ID above and copy it manually.',
                );
              await navigator.clipboard.writeText(session.user.id);
              setCopied(true);
            });
          }}
          disabled={working || busy}
        >
          <Copy size={14} /> Copy account ID
        </button>
        <span className="small" role="status">
          {copied ? 'Account ID copied.' : ''}
        </span>
      </div>
      <p className="muted small">
        Limit: {connection.maxPerUserDay} application dispatches per user / day;{' '}
        {connection.maxPerDay} globally. Provider attempts and charges may differ.
      </p>
      {session.user.guest ? (
        <button className="button primary" onClick={onCreateAccount}>
          Create an account <ArrowRight size={15} />
        </button>
      ) : (
        <button className="button primary" disabled={!ready || busy || working} onClick={onStart}>
          Start a controlled live check <ArrowRight size={15} />
        </button>
      )}
      <details className="connection-operator">
        <summary>Server setup instructions</summary>
        <p>
          Keys stay on the server. Never paste a key into a task, browser form or shared document.
        </p>
        <ol>
          <li>
            Save the dashboard API key as <code>CALLE_API_KEY</code> in the server environment.
          </li>
          <li>
            Add the signed-in account ID to <code>LIVE_USER_IDS</code>.
          </li>
          <li>
            Configure consenting recipients in <code>TEST_RECIPIENTS_JSON</code>, including country
            code and timezone.
          </li>
          <li>
            Enable <code>LIVE_CALLS_ENABLED</code> when ready for approved inquiries, then restart
            the server and refresh setup.
          </li>
        </ol>
        <p>
          To check read access before an app inquiry exists, the operator can set{' '}
          <code>CALLE_VERIFICATION_CALL_ID</code> to an existing API call-task ID. Dashboard
          call-record IDs identify individual attempts and cannot be used for this check.
        </p>
        <div className="connection-links">
          <ExternalLink href="https://dashboard.heycall-e.com/account/api-keys">
            Get a CALL-E API key
          </ExternalLink>
          <ExternalLink href="https://github.com/CALLE-AI/call-e-integrations#api">
            CALL-E setup documentation
          </ExternalLink>
        </div>
      </details>
    </Modal>
  );
}
