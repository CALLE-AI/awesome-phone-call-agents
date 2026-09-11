import Link from 'next/link';

import { signup } from '../actions';
import AuthForm from '../AuthForm';

const LINK =
  'cursor-pointer text-ember underline underline-offset-[3px]';

export default async function SignupPage({ searchParams }: PageProps<'/auth/signup'>) {
  const { next } = await searchParams;

  return (
    <AuthForm
      title="Create account"
      subtitle="Turn business intent into phone-call workflows."
      submitLabel="Create account"
      action={signup}
      next={typeof next === 'string' ? next : '/'}
      withProfileFields
      passwordPlaceholder="At least 8 characters"
      passwordMinLength={8}
      footer={
        <>
          Already have an account?{' '}
          <Link href="/auth/login" className={LINK}>
            Log in
          </Link>
        </>
      }
    />
  );
}
