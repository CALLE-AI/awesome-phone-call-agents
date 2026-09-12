'use client';

import { useState } from 'react';
import type { Contact } from '@dial/schemas';
import { COUNTRY_DIAL_CODES } from '@dial/schemas';
import { proxied, ApiError } from '@/lib/api';
import { ContactsIcon } from './icons';

/**
 * Numbers the user chose to keep.
 *
 * Renaming is the whole point of the page. "+971 55 550 1234" tells you nothing
 * a month later; "Ahmed at the garage" tells you everything, and it is the name
 * Dial then uses in the timeline and the results rather than describing the
 * call as being to an anonymous number.
 *
 * Numbers are shown in full here, unlike everywhere else in the app. The masking
 * elsewhere protects numbers Dial found; these are numbers the user typed and
 * saved themselves, and hiding them would only stop them recognising their own
 * address book.
 */
export function ContactsList({ initial }: { initial: Contact[] }) {
  const [contacts, setContacts] = useState<Contact[]>(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  async function act<T>(run: () => Promise<T>, after: (result: T) => void) {
    setBusy(true);
    setError(null);
    try {
      after(await run());
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="task-body">
      <header className="page-header">
        <h1 className="page-title">Contacts</h1>
        <p className="page-subtitle">
          Numbers you have kept. Dial uses these names when it calls, so give them names that will
          still mean something later.
        </p>
      </header>

      {/*
        role="alert" rather than a styled div alone: a failure that is only
        visible is a silent failure for anyone not looking at this corner of
        the screen.
      */}
      {error ? (
        <div className="notice" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}

      {saved ? (
        <div className="notice" data-tone="success" role="status">
          {saved}
        </div>
      ) : null}

      <section className="card">
        <div className="card-label">Add a number</div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!newName.trim() || !newPhone.trim()) return;
            void act(
              () => proxied.saveContact({ name: newName.trim(), phone: newPhone.trim() }),
              (contact) => {
                setContacts((prev) =>
                  [...prev.filter((c) => c.id !== contact.id), contact].sort((a, b) =>
                    a.name.localeCompare(b.name),
                  ),
                );
                setNewName('');
                setNewPhone('');
                setSaved(`${contact.name} saved.`);
              },
            );
          }}
        >
          <div className="field-row">
            <div className="field">
              <label htmlFor="contact-name">Name</label>
              <input
                id="contact-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Ahmed at the garage"
                maxLength={80}
              />
            </div>
            <div className="field">
              <label htmlFor="contact-phone">Phone number</label>
              <input
                id="contact-phone"
                value={newPhone}
                onChange={(event) => setNewPhone(event.target.value)}
                placeholder="+971 55 550 1234"
                inputMode="tel"
                autoComplete="tel"
                maxLength={30}
              />
            </div>
          </div>
          <div className="button-row">
            <button
              className="button"
              data-variant="primary"
              disabled={busy || !newName.trim() || !newPhone.trim()}
            >
              {busy ? 'Saving…' : 'Save contact'}
            </button>
          </div>
        </form>
      </section>

      {contacts.length === 0 ? (
        <section className="card">
          <div className="empty-state">
            <ContactsIcon size={28} />
            <p style={{ margin: '12px 0 0', color: 'var(--color-text-secondary)' }}>
              No contacts yet. Save one above, or keep a number after Dial calls it.
            </p>
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="card-label">Saved ({contacts.length})</div>

          <ul className="contact-list">
            {contacts.map((contact) => (
              <li key={contact.id} className="contact-row">
                <span className="contact-avatar" aria-hidden>
                  {initialsOf(contact.name)}
                </span>

                {editing === contact.id ? (
                  <>
                    <div className="contact-rename">
                      <div className="field">
                        <label htmlFor={`rename-${contact.id}`} className="visually-hidden">
                          New name for {contact.name}
                        </label>
                        <input
                          id={`rename-${contact.id}`}
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          maxLength={80}
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="contact-actions">
                      <button
                        className="button"
                        data-variant="primary"
                        disabled={busy || !draftName.trim()}
                        onClick={() =>
                          void act(
                            () => proxied.renameContact(contact.id, draftName.trim()),
                            (updated) => {
                              setContacts((prev) =>
                                prev.map((c) => (c.id === updated.id ? updated : c)),
                              );
                              setEditing(null);
                            },
                          )
                        }
                      >
                        Save
                      </button>
                      <button className="button" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="contact-identity">
                      <div className="contact-name">{contact.name}</div>
                      <div className="contact-number">{formatNumber(contact.phoneE164)}</div>
                    </div>

                    {/*
                      Removing a contact cannot be undone, so it asks. Inline
                      rather than a browser dialog, matching how deleting an
                      account is confirmed in Settings.
                    */}
                    {confirmRemove === contact.id ? (
                      <div className="contact-actions">
                        <button
                          className="button"
                          data-variant="danger"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () => proxied.deleteContact(contact.id),
                              () => {
                                setContacts((prev) => prev.filter((c) => c.id !== contact.id));
                                setConfirmRemove(null);
                                setSaved(`${contact.name} removed.`);
                              },
                            )
                          }
                        >
                          Remove
                        </button>
                        <button className="button" onClick={() => setConfirmRemove(null)}>
                          Keep
                        </button>
                      </div>
                    ) : (
                      <div className="contact-actions">
                        <button
                          className="button"
                          aria-label={`Rename ${contact.name}`}
                          onClick={() => {
                            setEditing(contact.id);
                            setDraftName(contact.name);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="button"
                          data-variant="danger"
                          aria-label={`Remove ${contact.name}`}
                          disabled={busy}
                          onClick={() => setConfirmRemove(contact.id)}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One or two letters, so a row has something to catch the eye. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + second).slice(0, 2);
}

/**
 * Separates the dialling code from the rest: "+97126663312" reads as one long
 * run of digits, "+971 26663312" reads as a country and a number.
 *
 * Only the split is done. The subscriber part is left exactly as stored,
 * because grouping it would mean guessing at a national format, and a number
 * shown in a shape its owner does not recognise is worse than an unbroken one.
 */
function formatNumber(e164: string): string {
  if (!e164.startsWith('+')) return e164;
  const digits = e164.slice(1);
  const match = DIAL_CODES.find((code) => digits.startsWith(code));
  return match ? `+${match} ${digits.slice(match.length)}` : e164;
}

/**
 * Longest dialling code first, so '1' does not win over '1868'. Sorted once:
 * the table never changes, and doing it per contact per render is work for
 * nothing.
 */
const DIAL_CODES = Object.values(COUNTRY_DIAL_CODES).sort((a, b) => b.length - a.length);
