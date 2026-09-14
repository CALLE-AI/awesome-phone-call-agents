import { getSettings, getCurrentUser } from '@/lib/session';
import { AccountSettings } from '@/components/settings/account-settings';

export const metadata = { title: 'Account · Dial' };

export default async function AccountSettingsPage() {
  const [settings, user] = await Promise.all([getSettings(), getCurrentUser()]);
  if (!settings || !user) {
    return <div className="empty-state">Your account could not be loaded.</div>;
  }
  return <AccountSettings initial={settings} user={user} />;
}
