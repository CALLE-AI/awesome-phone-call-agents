'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { proxied, ApiError } from '@/lib/api';
import { BrandMark } from './icons';

export function AuthForm() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'sign-up') {
        await proxied.signUp({ email, password, name: name || email.split('@')[0] || 'You' });
      } else {
        await proxied.signIn({ email, password });
      }
      router.push('/');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div
          className="brand"
          style={{ justifyContent: 'center', padding: 0, marginBottom: 'var(--space-xl)' }}
        >
          <BrandMark size={32} />
          <span>DIAL</span>
        </div>

        <h1
          style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 600,
            textAlign: 'center',
            margin: '0 0 4px',
          }}
        >
          {mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p
          style={{
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
            margin: '0 0 var(--space-xl)',
          }}
        >
          Tell Dial what you need. It makes the calls.
        </p>

        <form onSubmit={submit}>
          {mode === 'sign-up' ? (
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
              />
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              minLength={mode === 'sign-up' ? 12 : undefined}
              required
            />
            {mode === 'sign-up' ? (
              <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                At least 12 characters.
              </span>
            ) : null}
          </div>

          {error ? (
            <div
              className="notice"
              data-tone="danger"
              role="alert"
              style={{ marginBottom: 'var(--space-lg)' }}
            >
              {error}
            </div>
          ) : null}

          <button
            className="button"
            data-variant="primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={busy}
          >
            {busy ? 'One moment…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 'var(--space-lg)', marginBottom: 0 }}>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setError(null);
            }}
          >
            {mode === 'sign-in' ? 'Create an account instead' : 'I already have an account'}
          </button>
        </p>
      </div>
    </div>
  );
}
