import { useEffect, useState } from 'react';
import { Search, ChevronDown, CheckCircle2, Clock, PhoneCall, ArrowRight, TrendingUp, X, FileText } from 'lucide-react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { mockCallHistory as fallbackHistory } from '@/lib/mockData';
import { TranscriptViewer } from './TranscriptViewer';

export default function CallHistory() {
  const [history, setHistory] = useState<any[]>(fallbackHistory);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedResult, setSelectedResult] = useState<any>(null);
  const [mobileSelectedResult, setMobileSelectedResult] = useState<any>(null);

  useEffect(() => {
    const q = query(collection(db, 'callHistory'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setHistory(snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            status: data.status || ((data.result || data.summary) ? 'completed' : 'Pending')
          };
        }));
      } else {
        setHistory(fallbackHistory);
      }
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const filteredHistory = history.filter((call) => {
    const matchesSearch = 
      (call.contactName || call.contact || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (call.taskType || call.agentType || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const isCompleted = call.status === 'completed' || call.status === 'Success';
    const matchesFilter = 
      filterStatus === 'All' ? true :
      filterStatus === 'Completed' ? isCompleted :
      !isCompleted;
      
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="bg-[#1E2320]/80 backdrop-blur-xl rounded-[16px] shadow-2xl border border-white/10 mt-2 flex flex-col flex-1 min-h-0">
        <div className="p-6 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-bold text-white mb-1">Call History & Transcripts</h2>
            <p className="text-sm font-medium text-gray-400">
              Structured results from your AI farm agents • All calls recorded & summarized
            </p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search contacts & tasks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 text-sm bg-white/5 border border-white/10 rounded-[10px] focus:outline-none focus:border-white/30 text-white placeholder:text-gray-500 w-full md:w-[240px] transition-all shadow-inner"
              />
            </div>
            <div className="relative">
              <button
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className="flex items-center gap-2 pl-4 pr-3 py-2 bg-white/5 border border-white/10 rounded-[10px] text-sm font-bold text-white hover:bg-white/10 transition-colors shadow-sm focus:outline-none focus:border-white/30"
              >
                {filterStatus === 'All' ? 'All Status' : filterStatus}
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {isFilterOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsFilterOpen(false)}></div>
                  <div className="absolute right-0 top-[calc(100%+8px)] w-40 bg-[#1E2320]/95 backdrop-blur-xl border border-white/10 rounded-[12px] p-1.5 shadow-2xl z-50">
                    {['All', 'Completed', 'Pending'].map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          setFilterStatus(status);
                          setIsFilterOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-[8px] text-sm font-medium transition-colors ${
                          filterStatus === status 
                            ? 'bg-white/10 text-white font-bold' 
                            : 'text-gray-300 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {status === 'All' ? 'All Status' : status}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="hidden md:block overflow-x-auto overflow-y-auto max-h-[450px]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#111412]/95 backdrop-blur-md border-b border-white/10 sticky top-0 z-10 shadow-md">
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest w-1/4 even:bg-black/20">Agent / Task</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest w-1/4 even:bg-black/20">Contact</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest w-[15%] even:bg-black/20">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest w-1/4 even:bg-black/20">Result Summary</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right even:bg-black/20">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && history === fallbackHistory ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">Loading history...</td>
                </tr>
              ) : filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    {history.length === 0 ? "No calls recorded yet." : "No calls found matching criteria."}
                  </td>
                </tr>
              ) : filteredHistory.map((call) => (
                <tr key={call.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-all cursor-pointer group hover:shadow-[inset_3px_0_0_0_#3B82F6]">
                  <td className="px-6 py-4 even:bg-black/20">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0 border border-white/10 shadow-inner group-hover:bg-white/10 transition-colors">
                        {call.taskType === 'stock_check' ? <Search size={16} className="text-[#3B82F6]" /> :
                         call.taskType === 'negotiation' || call.agentType === 'Sales Agent' ? <TrendingUp size={16} className="text-[#10B981]" /> :
                         <PhoneCall size={16} className="text-[#FACC15]" />}
                      </div>
                      <div className="flex flex-col justify-center">
                        <div className="text-[13px] font-bold text-white mb-0.5">{call.taskType === 'stock_check' ? 'Stock Check' : call.taskType === 'negotiation' ? 'Price Negotiation' : call.taskType || call.agentType || 'Agent Call'}</div>
                        <div className="text-[11px] font-medium text-gray-400">{call.date || call.createdAt}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 even:bg-black/20">
                    <div className="text-[13px] font-bold text-white mb-0.5">{call.contactName || call.contact}</div>
                    <div className="text-[11px] font-medium text-gray-400">{call.phoneNumber || call.phone}</div>
                    {(call.userIntent || call.query) && (
                      <div className="text-[11px] font-medium text-[#10B981] italic line-clamp-1 mt-1">
                        "{call.userIntent || call.query}"
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 even:bg-black/20">
                    {call.status === 'completed' || call.status === 'Success' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#10B981] text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
                        <CheckCircle2 size={12} /> Completed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FACC15] text-[#1E2320] text-[10px] font-bold uppercase tracking-wider shadow-sm">
                        <Clock size={12} /> {call.status || 'Pending'}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 even:bg-black/20">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-200 text-[13px] line-clamp-2 leading-snug">{call.summary || call.result}</span>
                      </div>
                      <span className="text-[11px] font-medium text-gray-400">{call.time || call.cost}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right even:bg-black/20">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setSelectedResult(call); }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-[11px] font-bold text-white bg-[#3B82F6] hover:bg-[#2563EB] transition-all shadow-sm shadow-[#3B82F6]/20 hover:shadow-md hover:shadow-[#3B82F6]/40 hover:-translate-y-[1px]"
                    >
                      View <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile List View */}
        <div className="md:hidden overflow-y-auto flex-1 p-4 flex flex-col gap-3">
          {isLoading && history === fallbackHistory ? (
            <div className="text-center text-gray-500 py-8">Loading history...</div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {history.length === 0 ? "No calls recorded yet." : "No calls found matching criteria."}
            </div>
          ) : filteredHistory.map((call) => (
            <div 
              key={call.id} 
              onClick={() => setMobileSelectedResult(call)} 
              className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between cursor-pointer active:bg-white/10 hover:bg-white/10 transition-colors shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0 border border-white/10 shadow-inner">
                  {call.taskType === 'stock_check' ? <Search size={16} className="text-[#3B82F6]" /> :
                   call.taskType === 'negotiation' || call.agentType === 'Sales Agent' ? <TrendingUp size={16} className="text-[#10B981]" /> :
                   <PhoneCall size={16} className="text-[#FACC15]" />}
                </div>
                <div className="flex flex-col justify-center">
                  <div className="text-[14px] font-bold text-white mb-0.5">{call.taskType === 'stock_check' ? 'Stock Check' : call.taskType === 'negotiation' ? 'Price Negotiation' : call.taskType || call.agentType || 'Agent Call'}</div>
                  <div className="text-[12px] font-medium text-gray-400">{call.date || call.createdAt}</div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {call.status === 'completed' || call.status === 'Success' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#10B981] text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
                    <CheckCircle2 size={12} /> Completed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FACC15] text-[#1E2320] text-[10px] font-bold uppercase tracking-wider shadow-sm">
                    <Clock size={12} /> {call.status || 'Pending'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mt-auto pt-6 pb-2 text-[11px] font-medium text-gray-500">
        <div>© MoboFarmer • Bothaville, Free State • Put the farm in your pocket </div>
      </div>

      {selectedResult && (
        <TranscriptViewer
          result={selectedResult}
          onClose={() => setSelectedResult(null)}
        />
      )}

      {/* Mobile Details Modal */}
      {mobileSelectedResult && (
        <div className="fixed inset-0 z-[110] md:hidden bg-[#1E2320] flex flex-col animate-in slide-in-from-bottom-full duration-200">
          <div className="flex items-center justify-between p-5 border-b border-white/10 flex-shrink-0 mt-2">
            <h2 className="text-[18px] font-bold text-white">Call Details</h2>
            <button onClick={() => setMobileSelectedResult(null)} className="p-2 text-gray-400 hover:bg-white/10 hover:text-white rounded-full transition-colors">
              <X size={18} />
            </button>
          </div>
          
          <div className="p-5 flex flex-col gap-6 overflow-y-auto flex-1 min-h-0">
              {/* Contact */}
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Contact</div>
                <div className="bg-white/5 rounded-[12px] p-4 border border-white/10">
                  <div className="text-[14px] font-bold text-white">{mobileSelectedResult.contactName || mobileSelectedResult.contact}</div>
                  {mobileSelectedResult.phoneNumber && (
                    <div className="text-[13px] font-medium text-gray-400 mt-1">{mobileSelectedResult.phoneNumber}</div>
                  )}
                </div>
              </div>
              
              {/* Status */}
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Status</div>
                <div className="bg-white/5 rounded-[12px] p-4 border border-white/10 flex items-center justify-between">
                  <span className="text-[14px] font-medium text-white">Call Status</span>
                  {mobileSelectedResult.status === 'completed' || mobileSelectedResult.status === 'Success' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#10B981] text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
                      <CheckCircle2 size={12} /> Completed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FACC15] text-[#1E2320] text-[10px] font-bold uppercase tracking-wider shadow-sm">
                      <Clock size={12} /> {mobileSelectedResult.status || 'Pending'}
                    </span>
                  )}
                </div>
              </div>

              {/* Result Summary */}
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Result Summary</div>
                <div className="bg-white/5 p-4 rounded-[12px] border border-white/10">
                   <div className="font-medium text-white text-[14px] leading-snug">{mobileSelectedResult.summary || mobileSelectedResult.result}</div>
                   <div className="text-[12px] font-medium text-gray-400 mt-2">{mobileSelectedResult.time || mobileSelectedResult.cost}</div>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-white/10 bg-[#1A1F1C] flex-shrink-0 pb-8">
              <button 
                onClick={() => {
                  const result = mobileSelectedResult;
                  setMobileSelectedResult(null);
                  setSelectedResult(result);
                }}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[12px] text-[14px] font-bold text-white bg-[#3B82F6] hover:bg-[#2563EB] transition-all shadow-[0_0_15px_rgba(59,130,246,0.3)]"
              >
                <FileText size={18} /> View Transcript
              </button>
            </div>
          </div>
      )}
    </div>
  );
}
