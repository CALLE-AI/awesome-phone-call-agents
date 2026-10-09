import { useEffect, useState } from 'react';
import { MoreVertical, Droplets } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { mockCrops as fallbackCrops } from '@/lib/mockData';

export default function CropInventory() {
  const [crops, setCrops] = useState(fallbackCrops);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'crops'), (snapshot) => {
      if (!snapshot.empty) {
        const cropsData = snapshot.docs.map(doc => doc.data() as typeof fallbackCrops[0]);
        // Optional: sort by id or planted date to maintain order
        cropsData.sort((a, b) => a.id - b.id);
        setCrops(cropsData);
      }
    });
    return () => unsubscribe();
  }, []);

  return (
    <div className="bg-[#1E2320]/80 backdrop-blur-xl rounded-[16px] p-6 shadow-2xl border border-white/10 mb-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-[22px] font-bold text-white mb-1">Crop Inventory</h2>
          <p className="text-sm font-medium text-gray-400">Manage your farm's crop portfolio • 4 active • 12.5ha</p>
        </div>
        <button className="bg-[#EAB308] text-[#1E2320] px-4 py-2 rounded-full font-bold text-sm hover:bg-[#FACC15] transition-colors flex items-center gap-1.5 shadow-sm">
          <span className="text-lg leading-none font-normal">+</span> New task
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {crops.map((crop) => (
          <div
            key={crop.id}
            className="border border-white/10 rounded-[12px] p-5 hover:border-white/20 hover:bg-white/10 transition-all cursor-pointer relative overflow-hidden bg-white/5 backdrop-blur-sm"
          >
            <div className="flex justify-between items-start mb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center bg-white/5 text-2xl shadow-inner">
                  {crop.emoji}
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg leading-tight">{crop.name}</h3>
                  <div className="text-sm font-medium text-gray-400">{crop.details}</div>
                </div>
              </div>
              <button className="text-gray-400 hover:text-white transition-colors p-1">
                <MoreVertical size={20} />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="border border-white/5 rounded-lg p-3 bg-white/5">
                <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Water / Day</div>
                <div className="text-[15px] font-bold text-gray-200 flex items-center gap-1">
                  <Droplets size={14} className="text-[#3B82F6]" />
                  {crop.waterPerDay}L
                </div>
              </div>
              <div className="border border-white/5 rounded-lg p-3 bg-white/5">
                <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Remaining</div>
                <div className="text-[15px] font-bold text-gray-200">{crop.remainingWater}L</div>
              </div>
            </div>

            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full">
                <span className={`w-2 h-2 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.5)] ${
                  crop.status === 'Healthy' ? 'bg-[#10B981]' :
                  crop.status === 'Needs water' ? 'bg-[#EAB308]' :
                  'bg-[#F97316]'
                }`}></span>
                <span className="text-xs font-bold text-gray-300">{crop.status}</span>
              </div>
              <span className="text-xs font-medium text-gray-400">Planted {crop.planted}</span>
            </div>
            
            <div className="absolute bottom-0 left-0 w-full h-1 bg-white/10">
              <div 
                className={`h-full ${crop.status === 'Healthy' ? 'bg-[#10B981]' : crop.status === 'Needs water' ? 'bg-[#EAB308]' : 'bg-[#F97316]'}`} 
                style={{ width: crop.status === 'Healthy' ? '80%' : crop.status === 'Needs water' ? '40%' : '20%' }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
