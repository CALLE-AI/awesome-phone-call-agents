import React, { useState, useEffect } from 'react';
import { Plus, Sparkles, Trash2, Phone, Package, ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { api, HealthResponse } from '../services/api.js';
import { VerificationStats, VerificationTask } from '../types/index.js';
import { SummaryBar } from '../components/SummaryBar.js';
import { TruthMatrix } from '../components/TruthMatrix.js';
import { CallTranscript } from '../components/CallTranscript.js';
import { LiveCallInspector } from '../components/LiveCallInspector.js';
import { CreateVerificationModal } from '../components/CreateVerificationModal.js';
import { ExportButton } from '../components/ExportButton.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { useCallStatus } from '../hooks/useCallStatus.js';
import { Button } from '../components/ui/Button.js';

export const Dashboard: React.FC = () => {
  const [tasks, setTasks] = useState<VerificationTask[]>([]);
  const [stats, setStats] = useState<VerificationStats>({
    total: 0,
    inProgress: 0,
    verified: 0,
    contradicted: 0,
    unreachable: 0,
    unknown: 0,
    needsReview: 0,
  });
  const [selectedTask, setSelectedTask] = useState<VerificationTask | null>(null);
  const [activeCallTaskId, setActiveCallTaskId] = useState<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showQueueTable, setShowQueueTable] = useState(false);

  const fetchTasks = async () => {
    try {
      const data = await api.getTasks();
      setTasks(data.tasks);
      setStats(data.stats);

      if (data.tasks.length > 0 && !selectedTask) {
        setSelectedTask(data.tasks[0]);
      } else if (selectedTask) {
        const updated = data.tasks.find((t) => t.id === selectedTask.id);
        if (updated) setSelectedTask(updated);
      }
    } catch (err: any) {
      console.error('Failed to fetch tasks:', err);
    }
  };

  const fetchHealth = async () => {
    try {
      const h = await api.getHealth();
      setHealth(h);
    } catch (err) {
      console.error('Failed to fetch health:', err);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchHealth();
  }, []);

  // Polling hook for active verification
  useCallStatus(activeCallTaskId, activeCallId, (updatedTask) => {
    setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)));
    if (selectedTask?.id === updatedTask.id) {
      setSelectedTask(updatedTask);
    }
    // Refresh stats upon completion
    if (
      updatedTask.callState === 'COMPLETED' ||
      updatedTask.callState === 'FAILED' ||
      updatedTask.callState === 'CANCELED'
    ) {
      setActiveCallTaskId(null);
      setActiveCallId(null);
      fetchTasks();
    }
  });

  const handleOpenNewModal = () => {
    // Clean workspace reset when starting new verification
    setSelectedTask(null);
    setIsModalOpen(true);
  };

  const handleCreateTask = async (taskData: any) => {
    setActionError(null);
    const newTask = await api.createTask(taskData);
    await fetchTasks();
    setSelectedTask(newTask);
    // Auto-trigger verification call for the newly created task
    await handleVerifyTask(newTask.id);
  };

  const handleVerifyTask = async (taskId: string) => {
    setActionError(null);
    try {
      const task = await api.verifyTask(taskId);
      setActiveCallTaskId(taskId);
      setActiveCallId(task.callRecord?.providerCallId || `call_${taskId}`);
      setSelectedTask(task);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? task : t)));
    } catch (err: any) {
      setActionError(err.message || `Failed to verify task ${taskId}.`);
      await fetchTasks();
    }
  };

  const handleLoadDemo = async () => {
    setActionError(null);
    try {
      const res = await api.loadDemoCampaign();
      setTasks(res.tasks);
      setStats(res.stats);
      if (res.tasks.length > 0) setSelectedTask(res.tasks[0]);
    } catch (err: any) {
      setActionError(err.message || 'Failed to load demo campaign.');
    }
  };

  const handleClear = async () => {
    setActionError(null);
    try {
      const res = await api.clearTasks();
      setTasks(res.tasks);
      setStats(res.stats);
      setSelectedTask(null);
    } catch (err: any) {
      setActionError(err.message || 'Failed to clear tasks.');
    }
  };

  const isLiveMode = health?.mode === 'LIVE';
  const isCallActive =
    activeCallTaskId === selectedTask?.id ||
    selectedTask?.callState === 'IN_PROGRESS' ||
    selectedTask?.callState === 'QUEUED' ||
    selectedTask?.callState === 'CALLING';

  return (
    <div className="space-y-4 flex-1 flex flex-col min-h-0">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Operational Verification Workspace
            </h1>
            <span
              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                isLiveMode
                  ? 'bg-[#F0FDF4] text-[#166534] border-[#86EFAC]'
                  : 'bg-[#FFFBEB] text-[#92400E] border-[#FCD34D]'
              }`}
            >
              {isLiveMode ? '● LIVE CALL-E' : '● MOCK DEMO'}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            Autonomous phone auditing & deterministic evidence reconciliation for supply-chain operations.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={handleOpenNewModal}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs h-8"
          >
            <Plus className="w-4 h-4 mr-1.5" /> + New Verification
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadDemo}
            className="text-xs bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-slate-900 h-8"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5 text-blue-600" /> Demo Suite
          </Button>

          <ExportButton />

          {tasks.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="text-xs text-slate-400 hover:text-rose-600 hover:bg-rose-50 h-8 px-2"
              title="Clear all records"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Action Error Callout */}
      {actionError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between shrink-0">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-600 font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {/* 2. Summary Metrics (1 Row) */}
      <div className="shrink-0">
        <SummaryBar stats={stats} />
      </div>

      {/* 3. Primary Active Verification Workspace */}
      {selectedTask ? (
        <div className="space-y-3 flex-1 flex flex-col min-h-0">
          {/* Verification Context Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-bold text-slate-900">
                    {selectedTask.target.organizationName}
                  </span>
                  <span className="text-xs text-purple-700 font-medium px-2 py-0.5 rounded bg-purple-50 border border-purple-200 flex items-center gap-1">
                    <Package className="w-3 h-3 text-purple-600" />
                    {selectedTask.item}
                  </span>
                  <span className="text-xs text-slate-500">
                    • {selectedTask.verificationType}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-600">
                  <span className="font-mono text-slate-800 flex items-center gap-1 font-medium">
                    <Phone className="w-3 h-3 text-blue-600" />
                    {selectedTask.target.phoneNumber}
                  </span>
                  <span className="text-slate-300">|</span>
                  <span className="text-slate-600 line-clamp-1 max-w-xl">
                    Goal: {selectedTask.verificationGoal}
                  </span>
                </div>
              </div>

              {/* Status Pill */}
              <div className="flex items-center gap-2 shrink-0">
                {isCallActive ? (
                  <StatusBadge type="call" value={selectedTask.callState} size="md" />
                ) : (
                  <StatusBadge type="verification" value={selectedTask.status} size="md" />
                )}
                {selectedTask.callRecord?.durationSeconds !== undefined && selectedTask.callRecord.durationSeconds > 0 && (
                  <span className="text-xs font-mono text-slate-500">
                    {selectedTask.callRecord.durationSeconds}s
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Main 65% Conversation / 35% Inspector Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[440px]">
            {/* Left (~67% / 8 cols): Large, Readable Conversation Transcript */}
            <div className="lg:col-span-8 h-full min-h-0">
              <CallTranscript
                turns={selectedTask.callRecord?.transcriptTurns || []}
                isActive={isCallActive}
              />
            </div>

            {/* Right (~33% / 4 cols): Focused Result & Facts Side Panel */}
            <div className="lg:col-span-4 h-full overflow-y-auto min-h-0 pr-0.5">
              <LiveCallInspector
                task={selectedTask}
                onVerify={handleVerifyTask}
                isVerifying={isCallActive}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center flex flex-col items-center justify-center my-auto max-w-lg mx-auto shadow-xs">
          <Layers className="w-10 h-10 text-slate-400 mb-3" />
          <h3 className="font-bold text-slate-900 text-base">No Active Verification Selected</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm">
            Click "+ New Verification" to begin a phone audit, or select a scenario from the demo suite below.
          </p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={handleOpenNewModal} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs">
              <Plus className="w-4 h-4 mr-1" /> New Verification
            </Button>
            <Button size="sm" variant="outline" onClick={handleLoadDemo} className="text-xs bg-white text-slate-700 border-slate-300 hover:bg-slate-50">
              <Sparkles className="w-3.5 h-3.5 mr-1 text-blue-600" /> Load Demos
            </Button>
          </div>
        </div>
      )}

      {/* 4. Collapsible Verification Catalog / Queue Table */}
      {tasks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs shrink-0 mt-3">
          <button
            type="button"
            onClick={() => setShowQueueTable(!showQueueTable)}
            className="w-full px-5 py-3.5 bg-slate-50/80 flex items-center justify-between text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer border-b border-slate-200"
          >
            <span className="flex items-center gap-2 uppercase tracking-wider text-[11px] text-slate-800">
              <Layers className="w-4 h-4 text-blue-600" />
              All Verification Tasks ({tasks.length})
            </span>
            <span className="flex items-center gap-1 text-slate-500 font-normal">
              {showQueueTable ? (
                <>
                  <ChevronUp className="w-4 h-4" /> Hide Catalog
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" /> View Catalog
                </>
              )}
            </span>
          </button>

          {showQueueTable && (
            <div className="p-4 max-h-72 overflow-y-auto">
              <TruthMatrix
                tasks={tasks}
                selectedTaskId={selectedTask?.id || null}
                onSelectTask={(task) => {
                  setSelectedTask(task);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onVerifyTask={handleVerifyTask}
                isVerifyingId={activeCallTaskId}
              />
            </div>
          )}
        </div>
      )}

      {/* 4-Step Verification Creation Modal */}
      <CreateVerificationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateTask}
        isLiveMode={isLiveMode}
      />
    </div>
  );
};
