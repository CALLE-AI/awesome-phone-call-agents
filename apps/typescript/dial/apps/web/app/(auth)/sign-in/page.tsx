import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { AuthForm } from '@/components/auth-form';

export default async function SignInPage() {
  const user = await getCurrentUser();
  if (user) redirect('/');
  return <AuthForm />;
}
