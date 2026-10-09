import { useEffect, useState } from 'react';
import { PhoneCall, CheckCircle2, Search, TrendingUp, Clock, Droplets, ArrowRight, Loader2, AudioLines } from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { mockActiveCalls as fallbackCalls, mockRecentResults as fallbackResults } from '@/lib/mockData';
import { TranscriptViewer } from './TranscriptViewer';

interface AgentTaskCenterProps {
  onNewTask: () => void;
}

export default function AgentTaskCenter({ onNewTask }: AgentTaskCenterProps) {
  const [activeCalls, setActiveCalls] = useState<any[]>(fallbackCalls);
  const [recentResults, setRecentResults] = useState<any[]>(fallbackResults);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedResult, setSelectedResult] = useState<any>(null);

  useEffect(() => {
    // Active calls
    const callsQ = query(collection(db, 'activeCalls'), limit(3));
    
    const unsubscribeCalls = onSnapshot(callsQ, (snapshot) => {
      if (!snapshot.empty) setActiveCalls(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      else setActiveCalls(fallbackCalls);
    }, (error) => {
      console.warn("Firestore index missing for calls:", error.message);
      setActiveCalls(fallbackCalls);
    });

    // Recent results
    const resultsQ = query(collection(db, 'recentResults'), limit(2));
    const unsubscribeResults = onSnapshot(resultsQ, (snapshot) => {
      if (!snapshot.empty) setRecentResults(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      else setRecentResults(fallbackResults);
      setIsLoading(false);
    }, (error) => {
      console.warn("Firestore error for recent results:", error.message);
      setRecentResults(fallbackResults);
      setIsLoading(false);
    });

    return () => {
      unsubscribeCalls();
      unsubscribeResults();
    };
  }, []);

  return (
    <div className="bg-[#1E2320]/80 backdrop-blur-xl rounded-[16px] shadow-2xl border border-white/10 overflow-hidden flex flex-col h-full">
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between mb-5">
          <span className="bg-[#E07A5F] text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest flex items-center gap-1.5 shadow-[0_0_8px_rgba(224,122,95,0.5)]">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
            Agent Engine Active
          </span>
          <button 
            onClick={onNewTask}
            className="bg-[#EAB308] text-[#1E2320] px-4 py-2 rounded-full font-bold text-sm hover:bg-[#FACC15] transition-colors flex items-center gap-1.5 shadow-sm"
          >
            New Task <ArrowRight size={14} />
          </button>
        </div>
        
        <h2 className="text-[22px] font-bold text-white mb-2 leading-tight">AI Task Center</h2>
        <p className="text-sm font-medium text-gray-400">
          Your AI agents are currently handling {activeCalls.length} active calls. They will summarize the results here once finished.
        </p>
      </div>

      <div className="p-6 flex-1 flex flex-col gap-8">
        <div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={onNewTask} className="text-left p-3.5 rounded-[12px] border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all flex flex-col gap-2 shadow-inner">
              <Search size={16} className="text-[#3B82F6]" />
              <div>
                <div className="text-sm font-bold text-white">Check Input Stock</div>
                <div className="text-[11px] font-medium text-gray-400 mt-0.5">Call local suppliers</div>
              </div>
            </button>
            <button onClick={onNewTask} className="text-left p-3.5 rounded-[12px] border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all flex flex-col gap-2 shadow-inner">
              <TrendingUp size={16} className="text-[#10B981]" />
              <div>
                <div className="text-sm font-bold text-white">Find Buyer</div>
                <div className="text-[11px] font-medium text-gray-400 mt-0.5">Negotiate prices</div>
              </div>
            </button>
            <button onClick={onNewTask} className="text-left p-3.5 rounded-[12px] border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all flex flex-col gap-2 shadow-inner">
              <Clock size={16} className="text-[#FACC15]" />
              <div>
                <div className="text-sm font-bold text-white">Schedule Service</div>
                <div className="text-[11px] font-medium text-gray-400 mt-0.5">Tractor maintenance</div>
              </div>
            </button>
            <button onClick={onNewTask} className="text-left p-3.5 rounded-[12px] border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all flex flex-col gap-2 shadow-inner">
              <Droplets size={16} className="text-[#06B6D4]" />
              <div>
                <div className="text-sm font-bold text-white">Water Allocation</div>
                <div className="text-[11px] font-medium text-gray-400 mt-0.5">Call water board</div>
              </div>
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            Active Calls <span className="bg-white/10 text-gray-300 px-1.5 py-0.5 rounded text-[9px]">{activeCalls.length}</span>
          </h3>
          <div className="space-y-3">
            {activeCalls.map((call) => (
              <div key={call.id} className="flex items-center justify-between p-4 rounded-[12px] bg-white/5 border border-white/10">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <PhoneCall size={14} className="text-[#3B82F6] animate-pulse" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white leading-none mb-1">{call.task || call.type}</div>
                    <div className="text-xs font-medium text-gray-400">{call.contactName || call.target} • {call.phoneNumber || call.timeAgo}</div>
                  </div>
                </div>
                <div className="bg-[#3B82F6] text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-sm">
                  {call.status || 'Active'}
                </div>
              </div>
            ))}
            {activeCalls.length === 0 && (
              <div className="text-sm font-medium text-gray-400 py-2">No active calls right now.</div>
            )}
          </div>
        </div>

        <div className="mt-auto pt-4 border-t border-white/10">
          <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Recent Results</h3>
          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2">
            {isLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="animate-spin text-[#3B82F6]" /></div>
            ) : recentResults.length === 0 ? (
              <div className="text-sm text-gray-400">No recent results.</div>
            ) : recentResults.map((result: any) => (
              <div key={result.id} className="p-4 rounded-[12px] border border-white/10 bg-white/5 flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle2 size={16} className="text-[#10B981]" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-white mb-1">{result.agentType || result.taskType} - {result.contact || 'Completed'}</div>
                  {result.userIntent || result.query ? (
                    <div className="text-[13px] font-medium text-[#10B981] mb-1.5 italic line-clamp-1">"{result.userIntent || result.query}"</div>
                  ) : null}
                  <div className="text-sm font-medium text-gray-300 mb-2">{result.summary || result.result}</div>
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-bold text-gray-500">{result.time || 'Recently'}</div>
                    <button
                      onClick={() => setSelectedResult(result)}
                      className="bg-[#3B82F6] text-white px-3 py-1.5 rounded-[8px] text-[10px] font-bold hover:bg-[#2563EB] transition-colors shadow-sm"
                    >
                      Transcript →
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedResult && (
        <TranscriptViewer
          result={selectedResult}
          onClose={() => setSelectedResult(null)}
        />
      )}
    </div>
  );
}
