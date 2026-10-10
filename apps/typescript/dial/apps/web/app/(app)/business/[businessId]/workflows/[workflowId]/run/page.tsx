'use client';

import { useParams } from 'next/navigation';
import { RunWorkflow } from '@/components/business/run-workflow';

export default function RunWorkflowPage() {
  const { businessId, workflowId } = useParams<{ businessId: string; workflowId: string }>();
  return <RunWorkflow businessId={businessId} workflowId={workflowId} />;
}
