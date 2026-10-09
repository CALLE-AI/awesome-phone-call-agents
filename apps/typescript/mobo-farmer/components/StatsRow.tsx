import { useEffect, useState } from 'react';
import { Waves, Sprout, PhoneCall, ClipboardList, TrendingDown } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { mockStats as fallbackStats } from '@/lib/mockData';

export default function StatsRow() {
  const [stats, setStats] = useState(fallbackStats);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'dashboard', 'stats'), (docSnap) => {
      if (docSnap.exists()) {
        setStats(docSnap.data() as typeof fallbackStats);
      }
    });
    return () => unsubscribe();
  }, []);

  const { waterReserve, activeCrops, callsAutomated, pendingTasks } = stats;
  const waterPercentage = Math.round((waterReserve.current / waterReserve.total) * 100);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
      {/* TOTAL WATER RESERVE */}
      <div className="bg-[#1E2320]/80 backdrop-blur-xl rounded-[16px] p-5 shadow-2xl border border-white/10 relative">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-400 uppercase tracking-wide">
            <Waves size={16} />
            <span>Total Water</span>
          </div>
          <span className="bg-[#3B82F6] text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">{waterPercentage}%</span>
        </div>
        <div className="text-[28px] font-bold text-white mb-3 leading-none">
          {waterReserve.current.toLocaleString()}L <span className="text-base text-gray-500 font-normal">/ {waterReserve.total.toLocaleString()}L</span>
        </div>
        <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden mb-3">
          <div className="bg-[#3B82F6] h-full" style={{ width: `${waterPercentage}%` }}></div>
        </div>
        <div className="flex items-center gap-1 text-sm font-medium text-gray-300">
          <TrendingDown size={14} className="text-gray-400" />
          <span>-120L today <span className="text-gray-500 font-normal">• 8 days left</span></span>
        </div>
      </div>

      {/* ACTIVE CROPS */}
      <div className="bg-[#1E2320]/80 backdrop-blur-xl rounded-[16px] p-5 shadow-2xl border border-white/10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-400 uppercase tracking-wide">
            <Sprout size={16} />
            <span>Active Crops</span>
          </div>
          <span className="bg-[#10B981] text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">Healthy</span>
        </div>
        <div className="text-[28px] font-bold text-white mb-2 leading-none">
          {activeCrops.count} <span className="text-lg font-medium text-gray-300">crops</span>
        </div>
        <div className="text-sm font-medium text-gray-300 mb-3">
          {activeCrops.area}ha planted <span className="text-gray-500 font-normal">• 20L/day</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg bg-white/5 w-8 h-8 rounded-full flex items-center justify-center border border-white/10">🍅</span>
          <span className="text-lg bg-white/5 w-8 h-8 rounded-full flex items-center justify-center border border-white/10">🌽</span>
          <span className="text-lg bg-white/5 w-8 h-8 rounded-full flex items-center justify-center border border-white/10">🌻</span>
        </div>
      </div>

      {/* CALLS AUTOMATED */}
      <div className="bg-[#1E2320]/80 backdrop-blur-xl rounded-[16px] p-5 shadow-2xl border border-white/10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-400 uppercase tracking-wide">
            <PhoneCall size={16} />
            <span>AI Calls</span>
          </div>
          <span className="bg-[#E07A5F] text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
            Active
          </span>
        </div>
        <div className="text-[28px] font-bold text-white mb-2 leading-none">
          {callsAutomated.count} <span className="text-lg font-medium text-gray-300">calls</span>
        </div>
        <div className="text-sm font-medium text-gray-300 mb-3">
          {callsAutomated.hoursSaved}hrs saved this week
        </div>
        <div className="inline-flex items-center gap-1 bg-white/5 text-gray-300 text-[11px] font-medium px-2.5 py-1 rounded-full border border-white/10">
          <span className="text-[#E07A5F]">✨</span> CALL-E Engine
        </div>
      </div>

      {/* PENDING TASKS */}
      <div className="bg-[#1E2320]/80 backdrop-blur-xl rounded-[16px] p-5 shadow-2xl border border-white/10 relative">
        <div className="absolute top-5 right-5 w-2 h-2 bg-[#F97316] rounded-full shadow-[0_0_8px_rgba(249,115,22,0.8)]"></div>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
          <ClipboardList size={16} />
          <span>Pending Tasks</span>
        </div>
        <div className="text-[28px] font-bold text-white mb-2 leading-none">
          {pendingTasks} <span className="text-lg font-medium text-gray-300">tasks</span>
        </div>
        <div className="text-sm font-medium text-gray-300 mb-3">
          needing attention
        </div>
        <button className="text-sm font-medium text-gray-300 hover:text-white transition-colors underline underline-offset-4 decoration-white/20 hover:decoration-white mt-1">
          View tasks →
        </button>
      </div>
    </div>
  );
}
