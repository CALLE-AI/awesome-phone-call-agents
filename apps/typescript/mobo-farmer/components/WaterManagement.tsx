import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Waves, Sprout, BarChart3, Wind, Sparkles } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { mockWaterManagement as fallbackWater } from '@/lib/mockData';

export default function WaterManagement() {
  const [waterManagement, setWaterManagement] = useState(fallbackWater);
  const [activeModal, setActiveModal] = useState<'reservoir' | 'soil' | 'rainfall' | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const unsubscribe = onSnapshot(doc(db, 'dashboard', 'waterManagement'), (docSnap) => {
      if (docSnap.exists()) {
        setWaterManagement(docSnap.data() as typeof fallbackWater);
      }
    });
    return () => unsubscribe();
  }, []);

  const { reservoirLevel, soilMoisture, rainfall, recommendation } = waterManagement;

  return (
    <div className="bg-[#1E2320]/80 backdrop-blur-xl rounded-[16px] p-6 shadow-2xl border border-white/10 mb-6">
      <h2 className="text-[22px] font-bold text-white mb-5">Water Management</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {/* RESERVOIR LEVEL */}
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setActiveModal('reservoir')}
          className="text-left bg-white/5 border border-white/10 rounded-[12px] p-4 flex flex-col justify-between hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer shadow-sm hover:shadow-md"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-3">
            <Waves size={14} />
            <span>Reservoir Level</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative w-14 h-14 flex-shrink-0">
              <svg viewBox="0 0 36 36" className="w-14 h-14 stroke-current text-white/10">
                <path className="stroke-current" fill="none" strokeWidth="4"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path className="stroke-current text-[#3B82F6]" fill="none" strokeWidth="4" strokeDasharray={`${reservoirLevel}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold text-white">{reservoirLevel}%</span>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] font-bold text-white">2,450L left</span>
              <span className="text-xs font-medium text-gray-400">Capacity 3,000L</span>
              <span className="text-xs font-medium text-[#10B981] mt-0.5">• Borehole pump 05:30</span>
            </div>
          </div>
        </div>

        {/* SOIL MOISTURE */}
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setActiveModal('soil')}
          className="text-left bg-white/5 border border-white/10 rounded-[12px] p-4 flex flex-col justify-between relative overflow-hidden hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer shadow-sm hover:shadow-md"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2 relative z-10">
            <Sprout size={14} />
            <span>Soil Moisture</span>
          </div>
          <div className="relative z-10">
            <div className="text-[32px] font-bold text-white leading-none mb-1">{soilMoisture}%</div>
            <div className="text-xs font-medium text-gray-400">Optimal 60-75% • <span className="text-[#10B981]">Ideal</span></div>
          </div>
          <Wind size={64} className="absolute -bottom-4 -right-2 text-white/5 stroke-1" />
        </div>

        {/* RAINFALL */}
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setActiveModal('rainfall')}
          className="text-left bg-white/5 border border-white/10 rounded-[12px] p-4 flex flex-col justify-between hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer shadow-sm hover:shadow-md"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-3">
            <BarChart3 size={14} />
            <span>Rainfall • Last 7 Days</span>
          </div>
          <div className="flex items-end justify-between h-8 gap-1 mb-2">
            {rainfall.map((r, i) => (
              <div key={i} className="flex flex-col items-center flex-1 h-full justify-end">
                <div
                  className={`w-full rounded-sm ${r.amount > 5 ? 'bg-[#3B82F6]' : 'bg-white/20'}`}
                  style={{ height: `${Math.max(10, (r.amount / 20) * 100)}%` }}
                ></div>
                <span className="text-[9px] text-gray-500 mt-1 font-bold">{r.day}</span>
              </div>
            ))}
          </div>
          <div className="text-xs font-medium text-gray-400">Total 28mm • <span className="text-[#10B981]">+15% vs avg</span></div>
        </div>
      </div>

      <div 
        className="relative border border-[#E07A5F]/30 rounded-[12px] p-5 overflow-hidden bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/mobo_banner.png')" }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-black/60 to-[#1E2320]/95 backdrop-blur-[1px]"></div>
        <div className="relative z-10 flex justify-end">
          <div className="flex gap-4 w-full sm:w-[85%] md:w-[75%] lg:w-[65%]">
            <div className="w-10 h-10 rounded-xl bg-[#E07A5F] flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_rgba(224,122,95,0.6)]">
              <Sparkles size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-white text-sm mb-1">Irrigation Recommendation</h4>
              <p className="text-sm font-medium text-gray-200 leading-relaxed mb-4">
                {recommendation}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="bg-[#E07A5F] text-white px-3 py-1.5 rounded-[8px] text-[11px] font-bold shadow-sm">AI confidence 92%</span>
                <button className="bg-white text-[#1E2320] px-4 py-1.5 rounded-[8px] text-[11px] font-bold hover:bg-gray-100 transition-colors shadow-sm">
                  Auto-apply?
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Full Screen Modal */}
      {mounted && activeModal && createPortal(
        <div className="fixed inset-0 z-[100] bg-[#111412]/95 backdrop-blur-xl overflow-y-auto p-6 md:p-12 animate-in fade-in zoom-in-95 duration-200">
          <div className="max-w-[1200px] w-full mx-auto flex flex-col min-h-full">
            {/* Header */}
            <div className="flex justify-between items-start md:items-center mb-10 shrink-0">
              <h2 className="text-3xl md:text-4xl font-bold text-white capitalize tracking-tight mt-1 md:mt-0">
                {activeModal === 'reservoir' && 'Reservoir Analytics'}
                {activeModal === 'soil' && 'Soil Moisture Mapping'}
                {activeModal === 'rainfall' && 'Precipitation History'}
              </h2>
              <button 
                onClick={() => setActiveModal(null)}
                className="text-white hover:text-gray-300 bg-white/10 hover:bg-white/20 p-3 rounded-full transition-colors backdrop-blur-md shadow-sm flex-shrink-0 ml-4"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 pb-10">
              {activeModal === 'reservoir' && (
                 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                   <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-[24px] p-8 min-h-[400px] flex flex-col justify-end gap-2 relative">
                     <div className="absolute top-8 left-8">
                       <div className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Water Level Trend (30 Days)</div>
                       <div className="text-3xl font-bold text-white">Consistently High</div>
                     </div>
                     <div className="flex items-end h-64 gap-2 mt-20">
                       {[40, 50, 45, 60, 80, 75, 82, 80, 85, 82].map((v, i) => (
                         <div key={i} className="flex-1 bg-[#3B82F6]/20 rounded-t-xl relative group h-full flex flex-col justify-end">
                           <div className="w-full bg-[#3B82F6] rounded-t-xl transition-all" style={{ height: `${v}%` }}></div>
                         </div>
                       ))}
                     </div>
                   </div>
                   <div className="flex flex-col gap-6">
                     <div className="bg-white/5 border border-white/10 rounded-[24px] p-8">
                       <h3 className="text-gray-400 font-bold uppercase tracking-widest text-xs mb-3">Current Capacity</h3>
                       <div className="text-5xl font-bold text-white mb-2">{reservoirLevel}%</div>
                       <div className="text-sm text-[#10B981] font-medium">2,450L / 3,000L Available</div>
                     </div>
                     <div className="bg-white/5 border border-white/10 rounded-[24px] p-8 flex-1 flex flex-col justify-between">
                       <div>
                         <h3 className="text-gray-400 font-bold uppercase tracking-widest text-xs mb-3">Pump Status</h3>
                         <div className="text-xl font-bold text-white mb-1">Active • Borehole 1</div>
                         <div className="text-sm text-gray-400">Last run: 05:30 AM</div>
                       </div>
                       <button className="w-full mt-6 bg-[#3B82F6] text-white py-3 rounded-xl font-bold hover:bg-[#2563EB] shadow-sm transition-colors">Manage Pumps</button>
                     </div>
                   </div>
                 </div>
              )}
              {activeModal === 'soil' && (
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                   <div className="bg-white/5 border border-white/10 rounded-[24px] p-8 flex flex-col justify-center items-center min-h-[400px]">
                     <div className="w-full mb-6">
                       <div className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Live Sensor Map</div>
                       <div className="text-3xl font-bold text-white">Farm Zones Overview</div>
                     </div>
                     <div className="grid grid-cols-2 md:grid-cols-3 gap-4 w-full flex-1">
                       <div className="bg-[#10B981] rounded-2xl flex flex-col items-center justify-center p-4 shadow-inner text-white">
                         <span className="text-3xl font-bold mb-1">68%</span>
                         <span className="text-xs font-bold uppercase tracking-wider opacity-80">Zone A (Maize)</span>
                       </div>
                       <div className="bg-[#10B981]/80 rounded-2xl flex flex-col items-center justify-center p-4 shadow-inner text-white border border-[#10B981]/50">
                         <span className="text-3xl font-bold mb-1">62%</span>
                         <span className="text-xs font-bold uppercase tracking-wider opacity-80">Zone B (Wheat)</span>
                       </div>
                       <div className="bg-[#EAB308] rounded-2xl flex flex-col items-center justify-center p-4 shadow-inner text-[#1E2320]">
                         <span className="text-3xl font-bold mb-1">45%</span>
                         <span className="text-xs font-bold uppercase tracking-wider opacity-80">Zone C (Fallow)</span>
                       </div>
                       <div className="bg-[#3B82F6] rounded-2xl flex flex-col items-center justify-center p-4 shadow-inner text-white">
                         <span className="text-3xl font-bold mb-1">85%</span>
                         <span className="text-xs font-bold uppercase tracking-wider opacity-80">Zone D (Tomato)</span>
                       </div>
                       <div className="bg-[#10B981] rounded-2xl flex flex-col items-center justify-center p-4 shadow-inner text-white">
                         <span className="text-3xl font-bold mb-1">71%</span>
                         <span className="text-xs font-bold uppercase tracking-wider opacity-80">Zone E (Cabbage)</span>
                       </div>
                       <div className="bg-[#10B981]/90 rounded-2xl flex flex-col items-center justify-center p-4 shadow-inner text-white border border-[#10B981]/50">
                         <span className="text-3xl font-bold mb-1">65%</span>
                         <span className="text-xs font-bold uppercase tracking-wider opacity-80">Zone F (Sunflower)</span>
                       </div>
                     </div>
                   </div>
                   <div className="flex flex-col gap-6">
                     <div className="bg-white/5 border border-white/10 rounded-[24px] p-8">
                       <h3 className="text-gray-400 font-bold uppercase tracking-widest text-xs mb-3">Overall Average</h3>
                       <div className="text-5xl font-bold text-white mb-2">{soilMoisture}%</div>
                       <div className="text-sm text-[#10B981] font-medium">Optimal for current crops</div>
                     </div>
                     <div className="bg-white/5 border border-white/10 rounded-[24px] p-8 flex-1">
                       <h3 className="text-gray-400 font-bold uppercase tracking-widest text-xs mb-5">Urgent Actions</h3>
                       <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-[#EAB308]/10 border border-[#EAB308]/30 rounded-[16px] gap-4">
                         <div>
                           <div className="font-bold text-white text-base mb-1">Zone C is drying</div>
                           <div className="text-sm font-medium text-gray-400">Below 50% threshold • Action recommended</div>
                         </div>
                         <button className="bg-[#EAB308] text-[#1E2320] px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm hover:bg-[#FACC15] transition-colors whitespace-nowrap">Irrigate Now</button>
                       </div>
                     </div>
                   </div>
                 </div>
              )}
              {activeModal === 'rainfall' && (
                 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                   <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-[24px] p-8 min-h-[400px] flex flex-col justify-end relative">
                     <div className="absolute top-8 left-8">
                       <div className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Annual Rainfall Distribution</div>
                       <div className="text-3xl font-bold text-white">452mm Total</div>
                     </div>
                     <div className="flex items-end h-64 justify-between w-full gap-3 mt-20">
                       {[10, 20, 5, 0, 0, 40, 25, 15, 0, 5, 10, 30].map((v, i) => (
                         <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                           <div className="w-full max-w-[40px] bg-[#3B82F6] rounded-t-lg opacity-80 hover:opacity-100 transition-opacity" style={{ height: `${Math.max(5, v)}%` }}></div>
                           <div className="text-[11px] text-gray-400 mt-3 font-bold uppercase tracking-wider">{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i]}</div>
                         </div>
                       ))}
                     </div>
                   </div>
                   <div className="flex flex-col gap-6">
                     <div className="bg-white/5 border border-white/10 rounded-[24px] p-8">
                       <h3 className="text-gray-400 font-bold uppercase tracking-widest text-xs mb-3">Recent Accumulation</h3>
                       <div className="text-5xl font-bold text-white mb-2">28mm</div>
                       <div className="text-sm text-[#10B981] font-medium">+15% vs historical average for this week</div>
                     </div>
                     <div className="bg-white/5 border border-white/10 rounded-[24px] p-8 flex-1">
                       <h3 className="text-gray-400 font-bold uppercase tracking-widest text-xs mb-4">7-Day Forecast</h3>
                       <div className="space-y-4">
                         {['Monday', 'Tuesday', 'Wednesday (Expected)'].map((d, i) => (
                           <div key={d} className="flex justify-between items-center text-sm p-3 bg-white/5 rounded-xl border border-white/5">
                             <span className="font-bold text-gray-300">{d}</span>
                             <span className={`font-bold ${i === 2 ? 'text-[#3B82F6]' : 'text-gray-500'}`}>{i === 2 ? '15mm' : '0mm'}</span>
                           </div>
                         ))}
                       </div>
                     </div>
                   </div>
                 </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
