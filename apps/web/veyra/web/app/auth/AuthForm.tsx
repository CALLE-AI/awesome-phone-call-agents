'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useActionState } from 'react';

import type { AuthFormState } from './actions';

const LABEL =
  'mb-2 block text-[10.5px] uppercase tracking-[.12em] text-bone/55';
/**
 * Focus styling is the design's flame border plus a soft flame ring. Tailwind's default
 * `outline-none` would drop the ring for keyboard users, so the ring replaces it rather
 * than removing it.
 */
const INPUT =
  'w-full border border-bone/[.26] bg-[#232120] px-[13px] py-[11px] text-sm text-bone transition-[border-color,box-shadow] duration-150 placeholder:text-bone/25 focus:border-flame focus:shadow-[0_0_0_2px_rgba(236,48,19,.22)] focus:outline-none';

export interface AuthFormProps {
  title: string;
  /** Optional line under the heading. The signup screen uses it, login has none. */
  subtitle?: string;
  submitLabel: string;
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  /** Where to land after a successful submit. Comes from the middleware's `next` param. */
  next: string;
  /** Signup collects a name and company on top of the shared credential fields. */
  withProfileFields?: boolean;
  passwordPlaceholder?: string;
  /**
   * Only meaningful on signup, where it must match whatever the placeholder promises.
   * Login leaves it off — an existing password is already whatever length it is, and a
   * minimum there would just block someone from typing the password they actually have.
   */
  passwordMinLength?: number;
  footer: React.ReactNode;
}

export default function AuthForm({
  title,
  subtitle,
  submitLabel,
  action,
  next,
  withProfileFields = false,
  passwordPlaceholder = '••••••••',
  passwordMinLength,
  footer,
}: AuthFormProps) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    action,
    null,
  );

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center bg-ink px-6 py-14"
      style={{
        // The faint 64px graph paper behind the card, from the design.
        backgroundImage:
          'linear-gradient(rgba(243,242,242,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(243,242,242,.03) 1px, transparent 1px)',
        backgroundSize: '64px 64px',
      }}
    >
      {/* animate-vfade is the theme's existing entry animation, matching the design. */}
      <div className="flex w-full max-w-[384px] animate-vfade flex-col">
        <Link
          href="/"
          className="mb-[34px] flex items-center gap-[13px] text-bone no-underline"
        >
          <Image
            src="/icon.png"
            alt=""
            width={36}
            height={36}
            priority
            className="size-9 flex-none rounded-lg"
          />
          <span className="text-[26px] font-extrabold leading-none tracking-[.16em]">
            VEYRA
          </span>
        </Link>

        <div className="border-2 border-bone/[.26] bg-panel px-[30px] py-8">
          <h1 className="text-[21px] font-extrabold tracking-[-.01em] text-bone">
            {title}
          </h1>

          {subtitle && (
            <p className="mt-[7px] text-[13px] leading-[1.5] text-bone/50">{subtitle}</p>
          )}

          <form action={formAction} className="mt-[26px]">
            <input type="hidden" name="next" value={next} />

            <div className="flex flex-col gap-5">
              {withProfileFields && (
                <>
                  <label className="block">
                    <span className={LABEL}>Full name</span>
                    <input
                      name="full_name"
                      type="text"
                      autoComplete="name"
                      required
                      className={INPUT}
                      placeholder="Maya Reyner"
                    />
                  </label>

                  <label className="block">
                    <span className={`${LABEL} flex items-baseline gap-2`}>
                      Company
                      <span className="tracking-[.1em] text-bone/[.32]">optional</span>
                    </span>
                    <input
                      name="company_name"
                      type="text"
                      autoComplete="organization"
                      className={INPUT}
                      placeholder="Northbridge Wealth"
                    />
                  </label>
                </>
              )}

              <label className="block">
                <span className={LABEL}>Email</span>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className={INPUT}
                  placeholder="you@company.com"
                />
              </label>

              <label className="block">
                <span className={LABEL}>Password</span>
                <input
                  name="password"
                  type="password"
                  // Caught in the browser rather than as a round trip to Supabase.
                  minLength={passwordMinLength}
                  autoComplete={withProfileFields ? 'new-password' : 'current-password'}
                  required
                  className={INPUT}
                  placeholder={passwordPlaceholder}
                />
              </label>
            </div>

            {state?.error && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-[9px] border-l-2 border-flame bg-flame/10 px-[11px] py-[9px]"
              >
                <span className="mt-1.5 size-1.5 flex-none bg-flame" />
                <span className="text-[12.5px] leading-[1.5] text-blush">
                  {state.error}
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              className="mt-6 w-full cursor-pointer bg-flame px-4 py-[13px] text-left text-sm font-extrabold tracking-[.02em] text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? 'Working…' : submitLabel}
            </button>
          </form>

          <div className="mt-5 text-[12.5px] text-bone/50">{footer}</div>
        </div>
      </div>
    </main>
  );
}
