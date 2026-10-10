'use client';

import { useBusiness } from '@/components/business/business-context';
import { BusinessSettings } from '@/components/business/business-settings';

export default function BusinessSettingsPage() {
  const { business, refresh } = useBusiness();
  return <BusinessSettings business={business} onSaved={refresh} />;
}
