'use client';

import { useCallback, useState } from 'react';
import type { UserSettings } from '@dial/schemas';
import { proxied, ApiError } from '@/lib/api';

/**
 * Shared machinery for the four settings sections.
 *
 * Each section keeps its own draft and PATCHes only the fields it owns.
 * `updateSettingsRequestSchema` is partial and the server merges a partial
 * policy over the stored one, so saving Calling cannot quietly rewrite
 * Permissions with whatever that page happened to be holding.
 */
export function useSettingsDraft(initial: UserSettings) {
  const [settings, setSettings] = useState<UserSettings>(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const set = useCallback(<K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setStatus('idle');
  }, []);

  const setPolicy = useCallback(
    <K extends keyof UserSettings['policy']>(key: K, value: UserSettings['policy'][K]) => {
      setSettings((prev) => ({ ...prev, policy: { ...prev.policy, [key]: value } }));
      setStatus('idle');
    },
    [],
  );

  const save = useCallback(
    async (patch: Partial<UserSettings>) => {
      setStatus('saving');
      setError(null);
      try {
        const updated = await proxied.updateSettings(patch);
        setSettings(updated);
        setStatus('saved');
      } catch (caught) {
        setStatus('error');
        setError(caught instanceof ApiError ? caught.message : 'Could not save your settings.');
      }
    },
    [],
  );

  return { settings, set, setPolicy, save, status, error };
}

export function SaveBar({
  status,
  error,
  onSave,
  children,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
  onSave: () => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      {error ? (
        <div className="notice" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}
      <div className="button-row">
        <button
          className="button"
          data-variant="primary"
          onClick={onSave}
          disabled={status === 'saving'}
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save changes'}
        </button>
        {children}
      </div>
    </>
  );
}

export function Choice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? <p className="field-hint">{hint}</p> : null}
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A checkbox with its label, sized for a pointer that is not a mouse. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="settings-toggle-label">{label}</span>
        {hint ? <span className="field-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

export const AUTOMATION = [
  { value: 'automatic', label: 'Do it automatically' },
  { value: 'ask', label: 'Ask me first' },
  { value: 'never', label: 'Never' },
];

export const DISCLOSURE = [
  { value: 'allow', label: 'Share it' },
  { value: 'ask', label: 'Ask me first' },
  { value: 'never', label: 'Never share it' },
];
