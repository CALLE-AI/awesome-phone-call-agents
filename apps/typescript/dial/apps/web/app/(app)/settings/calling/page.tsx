import { getSettings } from '@/lib/session';
import { CallingSettings } from '@/components/settings/calling-settings';

export const metadata = { title: 'Calling · Dial' };

export default async function CallingSettingsPage() {
  const settings = await getSettings();
  if (!settings) {
    return <div className="empty-state">Settings could not be loaded.</div>;
  }
  return <CallingSettings initial={settings} />;
}
