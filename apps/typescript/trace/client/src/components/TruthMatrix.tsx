import React, { useState } from 'react';
import {
  Search,
  PhoneCall,
  ChevronRight,
  Layers,
  Phone,
  Package,
} from 'lucide-react';
import { VerificationTask, VerificationOutcome } from '../types/index.js';
import { StatusBadge } from './StatusBadge.js';
import { Button } from './ui/Button.js';

interface TruthMatrixProps {
  tasks: VerificationTask[];
  selectedTaskId: string | null;
  onSelectTask: (task: VerificationTask) => void;
  onVerifyTask: (taskId: string) => void;
  isVerifyingId?: string | null;
}

export const TruthMatrix: React.FC<TruthMatrixProps> = ({
  tasks,
  selectedTaskId,
  onSelectTask,
  onVerifyTask,
  isVerifyingId,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterState, setFilterState] = useState<'ALL' | VerificationOutcome | 'NEEDS_REVIEW'>('ALL');

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.target.organizationName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (task.item && task.item.toLowerCase().includes(searchTerm.toLowerCase())) ||
      task.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      task.target.phoneNumber.includes(searchTerm);

    if (!matchesSearch) return false;

    if (filterState === 'ALL') return true;
    if (filterState === 'NEEDS_REVIEW') return task.reviewStatus === 'NEEDS_REVIEW';
    return task.status === filterState;
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col h-full">
      {/* Search & Filter Header */}
      <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-50/70">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by supplier, item, subject..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 text-xs">
          {(
            [
              { id: 'ALL', label: 'All' },
              { id: 'VERIFIED', label: 'Verified' },
              { id: 'CONTRADICTED', label: 'Contradicted' },
              { id: 'UNKNOWN / INCONCLUSIVE', label: 'Unknown' },
              { id: 'UNREACHABLE', label: 'Unreachable' },
              { id: 'NEEDS_REVIEW', label: 'Needs Review' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterState(tab.id as any)}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-all ${
                filterState === tab.id
                  ? 'bg-blue-600 text-white shadow-xs font-semibold'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto flex-1">
        {filteredTasks.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            <Layers className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="font-semibold text-slate-800">No verification records found.</p>
            <p className="mt-1 text-slate-500">Create a new verification or switch filter tabs.</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Supplier & Scope</th>
                <th className="py-3 px-4">Item & Verification Type</th>
                <th className="py-3 px-4">Digital Claim</th>
                <th className="py-3 px-4">Phone Result</th>
                <th className="py-3 px-4">Outcome</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTasks.map((task) => {
                const isSelected = selectedTaskId === task.id;
                const isRunning =
                  isVerifyingId === task.id ||
                  task.callState === 'IN_PROGRESS' ||
                  task.callState === 'QUEUED' ||
                  task.callState === 'CALLING';

                return (
                  <tr
                    key={task.id}
                    onClick={() => onSelectTask(task)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50/70 hover:bg-blue-50 border-l-4 border-l-blue-600'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    {/* Supplier & Scope */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{task.target.organizationName}</div>
                      <div className="text-slate-600 font-mono text-[11px] flex items-center gap-1 mt-0.5 font-medium">
                        <Phone className="w-3 h-3 text-blue-600" />
                        {task.target.phoneNumber}
                      </div>
                    </td>

                    {/* Item & Verification Type */}
                    <td className="py-3 px-4 max-w-xs">
                      <div className="font-medium text-purple-700 flex items-center gap-1">
                        <Package className="w-3 h-3 text-purple-600 shrink-0" />
                        <span className="truncate">{task.item || task.subject}</span>
                      </div>
                      <div className="text-slate-500 text-[11px] truncate mt-0.5">
                        {task.verificationType || 'General'}
                      </div>
                    </td>

                    {/* Digital Claim */}
                    <td className="py-3 px-4">
                      {task.digitalClaim ? (
                        <div>
                          <StatusBadge type="claim" value={task.digitalClaim.claimedStatus} size="sm" />
                          <div className="text-[11px] text-slate-600 line-clamp-1 mt-1 max-w-[150px]">
                            {task.digitalClaim.claimText}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Direct inquiry</span>
                      )}
                    </td>

                    {/* Phone Result */}
                    <td className="py-3 px-4">
                      {task.structuredResult ? (
                        <div>
                          <StatusBadge
                            type="reality"
                            value={task.structuredResult.availability_status}
                            size="sm"
                          />
                          {task.structuredResult.quantity_or_capacity && (
                            <div className="text-[11px] text-slate-800 font-mono mt-0.5 font-semibold">
                              {task.structuredResult.quantity_or_capacity}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Pending Call</span>
                      )}
                    </td>

                    {/* Outcome & Review */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1 items-start">
                        <StatusBadge type="verification" value={task.status} size="sm" />
                        {task.reviewStatus === 'NEEDS_REVIEW' && (
                          <StatusBadge type="review" value="NEEDS_REVIEW" size="sm" />
                        )}
                      </div>
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4 text-right">
                      {task.callState === 'IDLE' ? (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onVerifyTask(task.id);
                          }}
                          disabled={isRunning}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-7 px-2.5 shadow-xs"
                        >
                          <PhoneCall className="w-3 h-3 mr-1" />
                          {isRunning ? 'Calling...' : 'Verify'}
                        </Button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTask(task);
                          }}
                          className="inline-flex items-center text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                        >
                          Inspect <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
