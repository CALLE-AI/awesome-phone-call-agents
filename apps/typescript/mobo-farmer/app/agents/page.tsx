"use client";

import { useState } from "react";
import AgentTaskCenter from "@/components/AgentTaskCenter";
import CallHistory from "@/components/CallHistory";
import { NewAgentTaskModal } from "@/components/Modals";

export default function AgentsPage() {
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);

  return (
    <main className="max-w-[1440px] mx-auto p-4 md:p-6">
      <div className="flex flex-col gap-6">
        <AgentTaskCenter onNewTask={() => setIsAgentModalOpen(true)} />
        
        {/* Avg Call Cost */}
        <div className="bg-[#FFFBF8] border border-[#E8DDD0] rounded-[12px] p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#FDF2D5] flex items-center justify-center flex-shrink-0 border border-[#C99A2B]/20">
              <svg className="w-5 h-5 text-[#C99A2B]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div>
              <div className="text-[13px] font-bold text-[#2B1D12]">Avg. call cost</div>
              <div className="text-[11px] font-medium text-[#9A8A7A]">R2.12 • 2m 18s avg</div>
            </div>
          </div>
          <span className="bg-[#1B4332] text-white text-[11px] font-bold px-3 py-1.5 rounded-full shadow-sm">
            -34% vs manual
          </span>
        </div>

        <CallHistory />
      </div>

      <NewAgentTaskModal 
        isOpen={isAgentModalOpen} 
        onClose={() => setIsAgentModalOpen(false)} 
      />
    </main>
  );
}
