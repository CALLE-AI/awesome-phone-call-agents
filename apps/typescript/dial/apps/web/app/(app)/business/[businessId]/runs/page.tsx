'use client';

import { useParams } from 'next/navigation';
import { RunsView } from '@/components/business/runs-view';

export default function BusinessRunsPage() {
  const { businessId } = useParams<{ businessId: string }>();
  return <RunsView businessId={businessId} />;
}
