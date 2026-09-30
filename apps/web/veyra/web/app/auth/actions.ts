'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

/** Shape returned to the form via useActionState. `null` means "nothing submitted yet". */
export type AuthFormState = { error: string } | null;

/**
 * Only ever redirect to a path inside this app. A `next` value off the query string is
 * attacker-controlled, and `//evil.com` is a protocol-relative URL that browsers happily
 * follow off-site — which would turn the login page into an open redirect.
 */
function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export async function login(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/', 'layout');
  redirect(safeNext(formData.get('next')));
}

export async function signup(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const supabase = await createClient();

  const fullName = String(formData.get('full_name') ?? '').trim();
  const companyName = String(formData.get('company_name') ?? '').trim();

  if (!fullName) {
    return { error: 'Full name is required.' };
  }

  const { data, error } = await supabase.auth.signUp({
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
    options: {
      // Read by the on_auth_user_created trigger, which copies these into public.profiles.
      // There is deliberately no `role` here: user metadata is client-editable, so a role
      // sent from the browser would be self-assigned. Every new user gets the profiles
      // column default, 'business_user'.
      data: {
        full_name: fullName,
        company_name: companyName || null,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  // With "Confirm email" enabled in the Supabase dashboard, signUp returns a user but no
  // session, and the app would silently bounce straight back to the login page. It must be
  // OFF for this project — see supabase/schema.sql and TECHNICAL_ARCH.md -> Authentication.
  if (!data.session) {
    return {
      error:
        'Account created, but no session was returned — email confirmation is still enabled. Turn it off under Authentication > Providers > Email in the Supabase dashboard, then log in.',
    };
  }

  revalidatePath('/', 'layout');
  redirect(safeNext(formData.get('next')));
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath('/', 'layout');
  redirect('/auth/login');
}
