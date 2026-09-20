import { X, Phone, Building2, Calendar, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

export function TranscriptViewer({ result, onClose }: { result: any, onClose: () => void }) {
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false);
  const transcript = result?.transcript;
  
  // Normalize transcript to array of turns
  let turns: { speaker: string, text: string }[] = [];
  
  if (Array.isArray(transcript)) {
    turns = transcript.map((t: any) => {
      if (typeof t === 'string') {
        const isAssistant = t.startsWith('[ASSISTANT]:');
        const isUser = t.startsWith('[USER]:');
        return {
          speaker: isAssistant ? 'bot' : isUser ? 'user' : 'system',
          text: t.replace(/^\[(?:ASSISTANT|USER)\]:\s*/, '').trim()
        };
      }
      return {
        speaker: String(t.speaker || t.role || 'unknown').toLowerCase(),
        text: String(t.text || t.message || String(t))
      };
    });
  } else if (typeof transcript === 'string') {
    const rawTurns = transcript.split(/(?=\[ASSISTANT\]:|\[USER\]:)/).filter(Boolean);
    turns = rawTurns.map(t => {
      const isAssistant = t.startsWith('[ASSISTANT]:');
      const isUser = t.startsWith('[USER]:');
      return {
        speaker: isAssistant ? 'bot' : isUser ? 'user' : 'system',
        text: t.replace(/^\[(?:ASSISTANT|USER)\]:\s*/, '').trim()
      };
    });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-[#1E2320]/80 backdrop-blur-xl rounded-[16px] shadow-2xl w-full max-w-[600px] overflow-hidden flex flex-col max-h-[90vh] border border-white/10">
        
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-transparent flex-shrink-0">
          <div>
            <h2 className="text-[18px] font-bold text-white flex items-center gap-2">
              <FileText size={18} className="text-[#3B82F6]" /> Call Transcript
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">ID: {result?.id || 'Unknown'}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:bg-white/10 hover:text-white rounded-full transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 p-6 flex flex-col gap-6">
          
          {/* Metadata Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/5 p-4 rounded-xl border border-white/10 shadow-sm">
              <div className="flex items-center gap-2 text-gray-400 mb-1">
                <Building2 size={14} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Supplier</span>
              </div>
              <div className="text-sm font-bold text-white">{result?.contact || result?.supplier_name || 'Unknown Supplier'}</div>
              {result?.phone && (
                <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-[#10B981]">
                  <Phone size={12} /> {result.phone}
                </div>
              )}
            </div>
            <div className="bg-white/5 p-4 rounded-xl border border-white/10 shadow-sm">
              <div className="flex items-center gap-2 text-gray-400 mb-1">
                <Calendar size={14} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Date & Time</span>
              </div>
              <div className="text-sm font-bold text-white">{result?.date || 'Unknown Date'}</div>
              <div className="text-xs font-medium text-gray-400 mt-2">Duration: {result?.time || 'N/A'}</div>
            </div>
          </div>

          {/* Summary Card */}
          <div className="bg-[#3B82F6]/10 border border-[#3B82F6]/20 text-white p-4 rounded-xl shadow-sm relative overflow-hidden">
            <div className="absolute -right-4 -top-4 text-[#3B82F6]/10">
              <FileText size={80} />
            </div>
            <div className="relative">
              <h3 className="text-[10px] font-bold text-[#3B82F6] uppercase tracking-widest mb-2">AI Summary</h3>
              <p className="text-sm font-medium leading-relaxed">{result?.summary || result?.result || "No summary generated for this call."}</p>
            </div>
          </div>

          {/* Transcript Dialogue Toggle */}
          <div>
            <button 
              onClick={() => setIsTranscriptExpanded(!isTranscriptExpanded)}
              className="flex items-center justify-between w-full border-b border-white/10 pb-3 group"
            >
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest group-hover:text-white transition-colors">Full Dialogue</h3>
              {isTranscriptExpanded ? (
                <ChevronUp size={16} className="text-gray-400 group-hover:text-white" />
              ) : (
                <ChevronDown size={16} className="text-gray-400 group-hover:text-white" />
              )}
            </button>
            
            {isTranscriptExpanded && (
              <div className="flex flex-col gap-4 mt-4">
                {turns.length === 0 ? (
                  <div className="text-sm text-gray-300 whitespace-pre-wrap bg-white/5 p-4 rounded-xl border border-white/10">
                    {typeof transcript === 'string' ? transcript : JSON.stringify(transcript)}
                  </div>
                ) : (
                  turns.map((turn, idx) => {
                    const isAssistant = turn.speaker === 'bot' || turn.speaker === 'assistant';
                    const isUser = turn.speaker === 'user';
                    
                    if (!isAssistant && !isUser) {
                      return <div key={idx} className="text-xs font-medium text-gray-500 italic text-center my-2 px-8">{turn.text}</div>;
                    }

                    return (
                      <div key={idx} className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}>
                        <span className="text-[10px] font-bold text-gray-400 mb-1 px-1 uppercase tracking-wider">
                          {isAssistant ? 'CALL-E Agent' : 'Supplier'}
                        </span>
                        <div className={`px-4 py-3 rounded-2xl max-w-[85%] text-sm shadow-sm ${
                          isAssistant 
                            ? 'bg-white/10 border border-white/10 text-white rounded-tl-sm' 
                            : 'bg-[#3B82F6] text-white rounded-tr-sm border border-[#3B82F6]/50'
                        }`}>
                          {turn.text}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
