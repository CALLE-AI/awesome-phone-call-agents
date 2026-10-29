import { redirect } from 'next/navigation';
import { getCurrentUser, getTasks } from '@/lib/session';
import { AppShell } from '@/components/app-shell';

/**
 * Every page under this layout requires a session. The check happens on the
 * server, so an unauthenticated visitor never receives the app markup at all.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const tasks = await getTasks();

  return (
    <AppShell user={user} recents={(tasks?.tasks ?? []).slice(0, 12)}>
      {children}
    </AppShell>
  );
}
