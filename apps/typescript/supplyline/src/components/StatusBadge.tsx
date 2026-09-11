import { Load } from '@/lib/types';

const statusStyles: Record<Load['status'], string> = {
  uncovered: 'bg-gray-100 text-gray-800',
  sourcing: 'bg-yellow-100 text-yellow-800',
  quoted: 'bg-blue-100 text-blue-800',
  negotiating: 'bg-orange-100 text-orange-800',
  recommended: 'bg-green-100 text-green-800',
  booked: 'bg-purple-100 text-purple-800',
};

export default function StatusBadge({ status }: { status: Load['status'] }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusStyles[status]}`}
    >
      {status}
    </span>
  );
}
