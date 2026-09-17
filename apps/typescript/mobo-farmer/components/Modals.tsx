import { useState } from 'react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Loader2, CheckCircle2, X, FileText, ChevronDown } from 'lucide-react';
import { TranscriptViewer } from './TranscriptViewer';

export function NewAgentTaskModal({ isOpen, onClose, onCallStarted }: { isOpen: boolean, onClose: () => void, onCallStarted?: (callData: any) => void }) {
  const [taskType, setTaskType] = useState('Check Input Stock');
  const [userIntent, setUserIntent] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('+12763229632');
  const [mockMode, setMockMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [finishedResult, setFinishedResult] = useState<any>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  if (!isOpen && !isMinimized && !showTranscript) return null;

  const handleSubmit = async () => {
    if (userIntent.length < 10) {
      alert("Please provide more details in your request (at least 10 characters).");
      return;
    }
    if (!mockMode && !supplierPhone.startsWith('+')) {
      alert("Phone number must be in E164 format, starting with '+' (e.g. +27821234567)");
      return;
    }
    
    setIsLoading(true);
    setIsMinimized(true);
    onClose(); // Hide the main modal immediately
    
    // Add active call to Firestore immediately
    const tempId = Date.now().toString();
    const activeCallRef = doc(db, 'activeCalls', tempId);
    
    try {
      await setDoc(activeCallRef, {
        id: tempId,
        type: `Calling ${supplierPhone}...`,
        target: taskType,
        timeAgo: "Just now"
      });
    } catch (e) {
      console.error("Failed to set active call", e);
    }
    
    try {
      const response = await fetch('/api/agent/check-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType,
          userIntent,
          phone: supplierPhone,
          mockMode
        })
      });
      
      let result = await response.json();

      // Async polling
      if (!mockMode && result.callId) {
        while (true) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const statusRes = await fetch(`/api/agent/status?callId=${result.callId}`);
          const statusData = await statusRes.json();
          if (statusData.status === 'completed' || statusData.status === 'failed' || statusData.status === 'no_answer') {
            result = statusData;
            break;
          }
        }
      }
      
      // Delete active call since it finished
      try { await deleteDoc(activeCallRef); } catch (e) { console.error(e); }
      
      if (result.status !== 'no_answer' && result.status !== 'failed' && !result.error) {
        // Save to recentResults
        const recentResultRef = doc(db, 'recentResults', tempId);
        await setDoc(recentResultRef, {
          id: tempId,
          agentType: taskType,
          contact: "Supplier",
          query: userIntent.length > 30 ? userIntent.substring(0, 30) + '...' : userIntent,
          result: result.summary || result.results?.[0]?.summary || "Live call completed.",
          timeAgo: "Just now",
          time: "1m 30s",
          userIntent,
          transcript: result.transcript || result.results?.[0]?.transcript
        });

        // Save to callHistory
        const callHistoryRef = doc(db, 'callHistory', tempId);
        await setDoc(callHistoryRef, {
          id: tempId,
          date: new Date().toISOString().slice(0, 16).replace('T', ' '),
          agentType: taskType,
          contact: "Supplier",
          phone: supplierPhone,
          userIntent,
          result: result.summary || result.results?.[0]?.summary || "Live call completed.",
          time: "1m 30s",
          cost: "R2.10",
          transcript: result.transcript || result.results?.[0]?.transcript || "No transcript available",
          summary: result.summary || result.results?.[0]?.summary || "Live call completed.",
          structured: result.structured || result.results?.[0]?.structured || {}
        });

        // Set finished result for TranscriptViewer
        result.agentType = taskType;
        result.contact = "Supplier";
        result.phone = supplierPhone;
        result.time = "1m 30s";
        result.date = new Date().toISOString().slice(0, 16).replace('T', ' ');
        result.userIntent = userIntent;
        setFinishedResult(result);
      } else {
        alert("The live call failed: " + (result.error || result.message || "Unknown error"));
        setIsMinimized(false);
      }
    } catch (error) {
      console.error("Failed to execute agent task", error);
      alert("Failed to execute agent task. Check your network.");
      setIsMinimized(false);
    } finally {
      setIsLoading(false);
    }
  };

  if (showTranscript && finishedResult) {
    return (
      <TranscriptViewer 
        result={finishedResult} 
        onClose={() => {
          setShowTranscript(false);
          setIsMinimized(false);
          setFinishedResult(null);
        }} 
      />
    );
  }

  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-[100] bg-[#E07A5F] rounded-[16px] shadow-[0_0_25px_rgba(224,122,95,0.5)] animate-pulse hover:animate-none border border-[#D47A3D] p-4 w-80 flex flex-col gap-3 text-white">
        {isLoading ? (
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-white" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">Call in Progress...</div>
                <div className="text-xs font-medium text-white/80">Negotiating on your behalf</div>
              </div>
            </div>
          </div>
        ) : finishedResult ? (
          <>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                  <CheckCircle2 size={20} className="text-white" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">Call Completed!</div>
                  <div className="text-xs font-medium text-white/80">Result saved to dashboard</div>
                </div>
              </div>
              <button onClick={() => { setIsMinimized(false); setFinishedResult(null); }} className="text-white/70 hover:text-white p-1 transition-colors">
                <X size={16} />
              </button>
            </div>
            <button 
              onClick={() => setShowTranscript(true)}
              className="w-full mt-1 py-2.5 bg-white hover:bg-[#FDF2D5] text-[#E07A5F] rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              <FileText size={16} className="text-[#E07A5F]" /> View Transcript
            </button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-[#1E2320]/80 backdrop-blur-xl rounded-[16px] shadow-2xl w-full max-w-[560px] overflow-hidden flex flex-col max-h-[90vh] border border-white/10">
        <div className="p-6 border-b border-white/10 flex-shrink-0">
          <h2 className="text-[22px] font-bold text-white">New Agent Task</h2>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="relative">
            <label className="block text-sm font-bold text-gray-300 mb-1.5">Task Type</label>
            <div 
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full border border-white/10 rounded-[10px] p-3 text-white font-medium flex justify-between items-center cursor-pointer bg-white/5 hover:bg-white/10 hover:border-white/30 transition-all select-none"
            >
              {taskType}
              <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </div>
            {isDropdownOpen && (
              <div className="absolute top-[calc(100%+8px)] left-0 w-full bg-[#1E2320]/95 backdrop-blur-xl border border-white/10 rounded-[12px] p-2 shadow-2xl z-50 animate-pulldown">
                {['Check Input Stock', 'Find Buyer', 'Check Water Allocation'].map((option) => (
                  <div 
                    key={option}
                    onClick={() => { setTaskType(option); setIsDropdownOpen(false); }}
                    className="p-2.5 rounded-[8px] text-white font-medium hover:bg-[#FACC15] hover:text-[#1E2320] hover:shadow-sm cursor-pointer transition-colors"
                  >
                    {option}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-1.5">What should the assistant get?</label>
            <textarea 
              rows={4}
              value={userIntent}
              onChange={(e) => setUserIntent(e.target.value)}
              className="w-full border border-white/10 rounded-[10px] p-3 text-white font-medium outline-none focus:border-white/30 focus:ring-[3px] ring-white/10 transition-all resize-none bg-white/5 placeholder:text-gray-500"
              placeholder="e.g. Need 50 bags L33 for Jozi, say L thirty-three, ask price per bag, how many in stock, delivery Wednesday, if no L33 ask for alternative"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-1.5">Supplier Phone</label>
            <input 
              type="text"
              value={supplierPhone}
              onChange={(e) => setSupplierPhone(e.target.value)}
              className="w-full border border-white/10 rounded-[10px] p-3 text-white font-medium outline-none focus:border-white/30 focus:ring-[3px] ring-white/10 transition-all bg-white/5 placeholder:text-gray-500"
              placeholder="+27821234567"
            />
            <p className="text-xs text-gray-500 mt-1.5 font-medium">Demo tip: Enter YOUR number in E164 (+27...).</p>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <input 
              type="checkbox" 
              id="mockMode" 
              checked={mockMode}
              onChange={(e) => setMockMode(e.target.checked)}
              className="w-4 h-4 text-[#FACC15] rounded border-white/10 focus:ring-[#FACC15] bg-white/5"
            />
            <label htmlFor="mockMode" className="flex flex-col cursor-pointer">
              <span className="text-sm font-bold text-gray-300">Mock mode (no real call, instant result)</span>
              <span className="text-xs text-gray-500">Checked = no API key needed, no call burned</span>
            </label>
          </div>
        </div>
        <div className="p-6 border-t border-white/10 bg-transparent flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} disabled={isLoading} className="px-5 py-2.5 rounded-[10px] font-bold text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={isLoading} className="px-6 py-2.5 rounded-[10px] font-bold text-[#1E2320] bg-[#FACC15] hover:bg-[#EAB308] shadow-sm transition-all disabled:opacity-50 flex items-center gap-2">
            {isLoading ? 'Processing...' : mockMode ? 'Run Mock Call' : 'Call Supplier via CALL-E'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AddCropModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-[#1E2320]/80 backdrop-blur-xl rounded-[16px] shadow-2xl w-full max-w-[480px] overflow-hidden border border-white/10">
        <div className="p-6 border-b border-white/10">
          <h2 className="text-[22px] font-bold text-white">Add New Crop</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-1.5">Crop Name</label>
            <input type="text" className="w-full border border-white/10 rounded-[10px] p-3 text-white font-medium outline-none focus:border-white/30 focus:ring-[3px] ring-white/10 transition-all bg-white/5 placeholder:text-gray-500" placeholder="e.g. Tomatoes" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-300 mb-1.5">Water / Day (L)</label>
              <input type="number" className="w-full border border-white/10 rounded-[10px] p-3 text-white font-medium outline-none focus:border-white/30 focus:ring-[3px] ring-white/10 transition-all bg-white/5 placeholder:text-gray-500" placeholder="5" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-300 mb-1.5">Area (ha)</label>
              <input type="number" className="w-full border border-white/10 rounded-[10px] p-3 text-white font-medium outline-none focus:border-white/30 focus:ring-[3px] ring-white/10 transition-all bg-white/5 placeholder:text-gray-500" placeholder="2.5" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-1.5">AI Notes</label>
            <textarea rows={2} className="w-full border border-white/10 rounded-[10px] p-3 text-white font-medium outline-none focus:border-white/30 focus:ring-[3px] ring-white/10 transition-all resize-none bg-white/5 placeholder:text-gray-500" placeholder="e.g. Planted in block B"></textarea>
          </div>
        </div>
        <div className="p-6 border-t border-white/10 bg-transparent flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 rounded-[10px] font-bold text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
            Cancel
          </button>
          <button onClick={onClose} className="px-6 py-2.5 rounded-[10px] font-bold text-white bg-[#10B981] hover:bg-[#059669] shadow-sm transition-all">
            Save Crop
          </button>
        </div>
      </div>
    </div>
  );
}
