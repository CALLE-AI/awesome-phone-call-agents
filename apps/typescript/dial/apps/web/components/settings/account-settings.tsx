'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionUser, UserSettings } from '@dial/schemas';
import { proxied } from '@/lib/api';
import { useSettingsDraft, SaveBar, Toggle } from './settings-kit';

/** You, your data, and the two ways out of the product. */
export function AccountSettings({
  initial,
  user,
}: {
  initial: UserSettings;
  user: SessionUser;
}) {
  const { settings, set, save, status, error } = useSettingsDraft(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const router = useRouter();

  return (
    <>
      <section className="card">
        <div className="card-label">You</div>
        <dl className="settings-facts">
          <div>
            <dt>Name</dt>
            <dd>{user.name}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <div className="card-label">Your data</div>
        <div className="field">
          <label htmlFor="retention">Keep call transcripts for</label>
          <p className="field-hint">
            In days. Set this to 0 and Dial stores no transcript at all — you will still get the
            summary and the result, but not what was said.
          </p>
          <input
            id="retention"
            type="number"
            min={0}
            max={3650}
            value={settings.transcriptRetentionDays}
            onChange={(event) => set('transcriptRetentionDays', Number(event.target.value))}
          />
        </div>
        <Toggle
          label="Tell me when a task finishes"
          checked={settings.notificationsEnabled}
          onChange={(next) => set('notificationsEnabled', next)}
        />
      </section>

      <SaveBar
        status={status}
        error={error}
        onSave={() =>
          void save({
            transcriptRetentionDays: settings.transcriptRetentionDays,
            notificationsEnabled: settings.notificationsEnabled,
          })
        }
      >
        <button
          className="button"
          onClick={() =>
            void proxied.signOut().then(() => {
              router.push('/sign-in');
              router.refresh();
            })
          }
        >
          Sign out
        </button>
      </SaveBar>

      <section className="card">
        <div className="card-label">Delete your account</div>
        <p style={{ marginTop: 0, color: 'var(--color-text-secondary)' }}>
          This removes your account, every task, every call record and every transcript. It cannot
          be undone.
        </p>
        {confirmDelete ? (
          <div className="button-row">
            <button
              className="button"
              data-variant="danger"
              onClick={() =>
                void proxied.deleteAccount().then(() => {
                  router.push('/sign-in');
                  router.refresh();
                })
              }
            >
              Yes, delete everything
            </button>
            <button className="button" onClick={() => setConfirmDelete(false)}>
              Keep my account
            </button>
          </div>
        ) : (
          <button className="button" data-variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete my account
          </button>
        )}
      </section>
    </>
  );
}
