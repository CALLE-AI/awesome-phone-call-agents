'use client';

import { useParams } from 'next/navigation';
import { WorkflowsManager } from '@/components/business/workflows-manager';

export default function BusinessWorkflowsPage() {
  const { businessId } = useParams<{ businessId: string }>();
  return <WorkflowsManager businessId={businessId} />;
}
