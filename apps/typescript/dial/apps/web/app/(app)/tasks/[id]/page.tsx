import { notFound } from 'next/navigation';
import { getTask } from '@/lib/session';
import { TaskView } from '@/components/task-view';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) notFound();
  return <TaskView initial={task} />;
}
