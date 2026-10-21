'use client';

import { useBusiness } from '@/components/business/business-context';
import { BusinessDashboard } from '@/components/business/business-dashboard';

export default function BusinessOverviewPage() {
  const { business } = useBusiness();
  return <BusinessDashboard business={business} />;
}
