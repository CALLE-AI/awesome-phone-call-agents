import { Composer } from '@/components/composer';
import { getSettings } from '@/lib/session';

export default async function HomePage() {
  const settings = await getSettings();
  return <Composer defaultLocationLabel={settings?.defaultLocation?.label ?? null} />;
}
