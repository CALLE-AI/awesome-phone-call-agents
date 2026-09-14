import { getSettings } from '@/lib/session';
import { PermissionsSettings } from '@/components/settings/permissions-settings';

export const metadata = { title: 'Permissions · Dial' };

export default async function PermissionsSettingsPage() {
  const settings = await getSettings();
  if (!settings) {
    return <div className="empty-state">Settings could not be loaded.</div>;
  }
  return <PermissionsSettings initial={settings} />;
}
