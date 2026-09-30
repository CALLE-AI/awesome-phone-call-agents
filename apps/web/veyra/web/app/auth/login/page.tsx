import Link from 'next/link';

import { login } from '../actions';
import AuthForm from '../AuthForm';

const LINK =
  'cursor-pointer text-ember underline underline-offset-[3px]';

export default async function LoginPage({ searchParams }: PageProps<'/auth/login'>) {
  // Stamped by the middleware when it bounces an unauthenticated request, so the user
  // lands back on the page they were actually trying to reach.
  const { next } = await searchParams;

  return (
    <AuthForm
      title="Log in"
      submitLabel="Log in"
      action={login}
      next={typeof next === 'string' ? next : '/'}
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup" className={LINK}>
            Sign up
          </Link>
        </>
      }
    />
  );
}
