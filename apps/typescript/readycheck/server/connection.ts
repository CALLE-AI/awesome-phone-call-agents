import { createHash } from 'node:crypto';
import type { ReadAccessCheck } from '../src/domain/model';
import type { Config } from './config';
import { ProviderReadError, type CallTransport } from './calle';
import { ServiceError } from './inquiries';
import type { Store } from './store';

const messages: Record<ReadAccessCheck['status'], string> = {
  checking: 'An existing-call access check started. No new call is created.',
  verified:
    'The server read an existing CALL-E call. This verifies read access only, not call creation or available credits.',
  rejected:
    'CALL-E rejected access. The operator should check the server API key and its permissions.',
  not_found:
    'The selected call was not accessible through this API key. It may belong to another integration or account; key validity is still unverified.',
  unavailable: 'The access check could not finish. Try again later; no new call was created.',
  invalid_response: 'CALL-E returned an unexpected response. Read access could not be verified.',
};
const callStatuses = new Set([
  'pending',
  'queued',
  'scheduled',
  'preparing',
  'processing',
  'calling',
  'in_progress',
  'running',
  'finished',
  'completed',
  'failed',
  'cancelled',
  'canceled',
  'no_answer',
  'busy',
  'voicemail',
  'declined',
  'expired',
]);

export class ConnectionVerifier {
  constructor(
    private store: Store,
    private config: Config,
    private transport: CallTransport,
  ) {}
  private fingerprint() {
    return createHash('sha256').update(this.config.apiKey).digest('hex');
  }
  current(owner: string): ReadAccessCheck | null {
    const row = this.store.db
      .prepare('SELECT status,checked_at FROM connection_checks WHERE owner_id=? AND key_hash=?')
      .get(owner, this.fingerprint());
    if (!row) return null;
    let status = row.status as ReadAccessCheck['status'];
    if (!Object.hasOwn(messages, status)) return null;
    if (status === 'checking' && Date.now() - Date.parse(String(row.checked_at)) > 30000)
      status = 'unavailable';
    return { status, checkedAt: String(row.checked_at), message: messages[status] };
  }
  async verify(owner: string): Promise<ReadAccessCheck> {
    if (!this.config.apiKey)
      throw new ServiceError(409, 'Add the server API key before checking access.');
    // A browser cannot supply arbitrary provider IDs or read someone else's call.
    const owned = this.store.db
      .prepare(
        'SELECT vendor_id FROM inquiries WHERE owner_id=? AND vendor_id IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      )
      .get(owner);
    const id = owned?.vendor_id || this.config.verificationCallId;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(id))
      throw new ServiceError(
        409,
        'No existing call is available to check. The operator can configure a known test call, or you can check after your first approved inquiry.',
      );
    const now = new Date().toISOString();
    const fingerprint = this.fingerprint();
    this.store.transaction(() => {
      const previous = this.store.db
        .prepare('SELECT checked_at FROM connection_checks WHERE owner_id=?')
        .get(owner);
      if (previous && Date.now() - Date.parse(String(previous.checked_at)) < 60000)
        throw new ServiceError(429, 'Wait one minute between access checks.');
      this.store.db
        .prepare('INSERT OR REPLACE INTO connection_checks VALUES(?,?,?,?)')
        .run(owner, fingerprint, 'checking', now);
    });
    let status: ReadAccessCheck['status'];
    try {
      const body = await this.transport.read(id);
      const value =
        body && typeof body === 'object' && !Array.isArray(body) && 'status' in body
          ? body.status
          : undefined;
      status =
        typeof value === 'string' && callStatuses.has(value.toLowerCase())
          ? 'verified'
          : 'invalid_response';
    } catch (error) {
      status =
        error instanceof ProviderReadError && [401, 403].includes(error.status)
          ? 'rejected'
          : error instanceof ProviderReadError && error.status === 404
            ? 'not_found'
            : 'unavailable';
    }
    this.store.db
      .prepare(
        'UPDATE connection_checks SET status=? WHERE owner_id=? AND key_hash=? AND checked_at=?',
      )
      .run(status, owner, fingerprint, now);
    return { status, checkedAt: now, message: messages[status] };
  }
}
