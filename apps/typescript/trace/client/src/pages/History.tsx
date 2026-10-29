import React, { useState, useEffect } from 'react';
import {
  Search,
  FileSpreadsheet,
  Trash2,
  Phone,
  Layers,
  Eye,
  X,
  Package,
} from 'lucide-react';
import { api } from '../services/api.js';
import { VerificationTask, VerificationOutcome } from '../types/index.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { ExportButton } from '../components/ExportButton.js';
import { EvidenceChainView } from '../components/EvidenceChainView.js';
import { CallTranscript } from '../components/CallTranscript.js';
import { ExtractedFact } from '../components/ExtractedFact.js';

export const History: React.FC = () => {
  const [tasks, setTasks] = useState<VerificationTask[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterState, setFilterState] = useState<'ALL' | VerificationOutcome | 'NEEDS_REVIEW'>('ALL');
  const [inspectTask, setInspectTask] = useState<VerificationTask | null>(null);

  const fetchTasks = async () => {
    try {
      const data = await api.getTasks();
      setTasks(data.tasks);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this verification record?')) return;
    try {
      await api.deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (inspectTask?.id === id) setInspectTask(null);
    } catch (err: any) {
      alert(err.message || 'Failed to delete task.');
    }
  };

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
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Audit & Verification History</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Historical ledger of all completed supply-chain verifications, transcripts, and evidence chains.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ExportButton />
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
        {/* Filter / Search Bar */}
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-50">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter by supplier, item, subject, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto text-xs">
            {(
              [
                { id: 'ALL', label: 'All Records' },
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
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Audit Table */}
        <div className="overflow-x-auto">
          {filteredTasks.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-xs">
              <Layers className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="font-medium text-slate-700">No verification records found.</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Date / Time</th>
                  <th className="py-3 px-4">Supplier & Phone</th>
                  <th className="py-3 px-4">Item & Scope</th>
                  <th className="py-3 px-4">Digital Claim</th>
                  <th className="py-3 px-4">Phone Result</th>
                  <th className="py-3 px-4">Audit Outcome</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTasks.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap font-mono text-[11px]">
                      {new Date(task.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{task.target.organizationName}</div>
                      <div className="text-slate-500 font-mono text-[11px] flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3 text-blue-600" />
                        {task.target.phoneNumber}
                      </div>
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      <div className="font-medium text-slate-900 flex items-center gap-1">
                        <Package className="w-3 h-3 text-blue-600 shrink-0" />
                        <span className="truncate">{task.item || task.subject}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 line-clamp-1">{task.verificationType}</div>
                    </td>
                    <td className="py-3 px-4">
                      {task.digitalClaim ? (
                        <StatusBadge type="claim" value={task.digitalClaim.claimedStatus} size="sm" />
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Inquiry Only</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {task.structuredResult ? (
                        <StatusBadge
                          type="reality"
                          value={task.structuredResult.availability_status}
                          size="sm"
                        />
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">No call data</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1 items-start">
                        <StatusBadge type="verification" value={task.status} size="sm" />
                        {task.reviewStatus === 'NEEDS_REVIEW' && (
                          <StatusBadge type="review" value="NEEDS_REVIEW" size="sm" />
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setInspectTask(task)}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-slate-100 transition-colors"
                          title="Inspect Evidence Chain & Transcript"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {task.callRecord && (
                          <a
                            href={api.exportTaskExcelUrl(task.id)}
                            download
                            className="p-1.5 rounded-lg text-slate-600 hover:text-emerald-600 hover:bg-slate-100 transition-colors"
                            title="Download Excel XLSX"
                          >
                            <FileSpreadsheet className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title="Delete Record"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Inspection Modal */}
      {inspectTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-slate-900">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-white">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">{inspectTask.target.organizationName} — Audit Record</h3>
                <p className="text-xs text-slate-500 mt-0.5">{inspectTask.subject} ({inspectTask.target.phoneNumber})</p>
              </div>
              <button
                onClick={() => setInspectTask(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 bg-white">
              {/* Evidence Chain */}
              {inspectTask.evidenceChain && (
                <EvidenceChainView
                  evidenceChain={inspectTask.evidenceChain}
                  reviewStatus={inspectTask.reviewStatus}
                />
              )}

              {/* Transcript */}
              <div className="h-64">
                <CallTranscript
                  turns={inspectTask.callRecord?.transcriptTurns || []}
                  isActive={false}
                />
              </div>

              {/* Extracted Facts */}
              <ExtractedFact
                structuredResult={inspectTask.structuredResult || inspectTask.callRecord?.structuredResult || null}
                questions={inspectTask.questions}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
