import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Radio, Users, CheckCircle2, FastForward, Heart } from 'lucide-react';
import { Responder } from '../types';
import { ResponderMarker } from './ResponderMarker';

interface RadarScannerProps {
  allResponders: Responder[];
  onScanComplete: (discoveredResponders: Responder[]) => void;
  locationName: string;
  isWiderSearch?: boolean;
}

export const RadarScanner: React.FC<RadarScannerProps> = ({
  allResponders,
  onScanComplete,
  locationName,
  isWiderSearch = false,
}) => {
  const [discoveredResponders, setDiscoveredResponders] = useState<Responder[]>([]);
  const [statusText, setStatusText] = useState('Scanning for nearby rescue units...');
  const [progressPercent, setProgressPercent] = useState(10);

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    // Step 1
    timers.push(
      setTimeout(() => {
        setStatusText(isWiderSearch ? 'Expanding search radius to 15km...' : 'Locating registered rescue shelters & clinics...');
        setProgressPercent(35);
        if (allResponders[0]) {
          setDiscoveredResponders((prev) => [...prev, allResponders[0]]);
        }
      }, 1200)
    );

    // Step 2
    timers.push(
      setTimeout(() => {
        setStatusText('Checking real-time responder availability...');
        setProgressPercent(65);
        if (allResponders[1]) {
          setDiscoveredResponders((prev) => [...prev, allResponders[1]]);
        }
      }, 2300)
    );

    // Step 3
    timers.push(
      setTimeout(() => {
        if (allResponders.length > 2) {
          setDiscoveredResponders(allResponders);
        }
        const count = allResponders.length;
        setStatusText(`${count} rescue responders found in range`);
        setProgressPercent(100);
      }, 3400)
    );

    // Step 4: Auto transition
    timers.push(
      setTimeout(() => {
        onScanComplete(allResponders);
      }, 4500)
    );

    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [allResponders, isWiderSearch, onScanComplete]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center max-w-xl mx-auto px-4 py-4 sm:py-6 w-full select-none text-[#28221E]">
      {/* Header Info */}
      <div className="text-center mb-3 space-y-1">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EAE0D3] text-[#4A3E34] text-xs font-semibold border border-[#D8C7B4]">
          <Radio className="w-3.5 h-3.5 text-[#B84227]" />
          <span>{isWiderSearch ? 'EXPANDED 15KM RADIUS' : 'LOCAL SOS DISPATCH RADAR'}</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-[#1A1412] tracking-tight">
          Locating Responders
        </h2>
        <p className="text-xs sm:text-sm text-[#4A3F37] font-semibold max-w-sm mx-auto truncate">
          {locationName}
        </p>
      </div>

      {/* Stylized Topographic Rescue Radar Component */}
      <div className="relative w-72 h-72 sm:w-92 sm:h-92 my-2 flex items-center justify-center">
        {/* Radar Base Container */}
        <div className="absolute inset-0 rounded-full bg-[#1E1915] shadow-2xl border-4 border-[#352D26] flex items-center justify-center overflow-hidden">
          {/* Subtle Grid Lines */}
          <div className="absolute inset-0 bg-[radial-gradient(#4E4238_1px,transparent_1px)] [background-size:18px_18px] opacity-40" />

          {/* Concentric Radar Distance Rings */}
          <div className="absolute w-[82%] h-[82%] rounded-full border border-[#4E4238]/60" />
          <div className="absolute w-[60%] h-[60%] rounded-full border border-[#4E4238]/70" />
          <div className="absolute w-[38%] h-[38%] rounded-full border border-[#4E4238]/80" />
          <div className="absolute w-[18%] h-[18%] rounded-full border border-[#4E4238]/90" />

          {/* Clean Axis Lines */}
          <div className="absolute inset-x-0 top-1/2 h-px bg-[#4E4238]/40" />
          <div className="absolute inset-y-0 left-1/2 w-px bg-[#4E4238]/40" />

          {/* Rotating Radar Sweep Cone */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 3.2, ease: 'linear' }}
            className="absolute inset-0 origin-center pointer-events-none"
            style={{
              background:
                'conic-gradient(from 0deg, rgba(184, 66, 39, 0) 0deg, rgba(184, 66, 39, 0.02) 280deg, rgba(184, 66, 39, 0.3) 360deg)',
            }}
          />

          {/* Discovered Responder Markers */}
          {discoveredResponders.map((resp, idx) => (
            <ResponderMarker key={resp.id} responder={resp} index={idx} />
          ))}

          {/* Center User SOS Beacon */}
          <div className="relative z-30 flex flex-col items-center justify-center">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[#B84227] border-2 border-[#FAF6F0] text-white flex items-center justify-center shadow-md">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
                <path d="M12 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-5.5 1c1.38 0 2.5-1.12 2.5-2.5S7.88 7 6.5 7 4 8.12 4 9.5 5.12 12 6.5 12zm11 0c1.38 0 2.5-1.12 2.5-2.5S18.88 7 17.5 7 15 8.12 15 9.5s1.12 2.5 2.5 2.5zM12 13.5c-2.76 0-5.5 1.54-5.5 3.85 0 1.95 2.46 3.65 5.5 3.65s5.5-1.7 5.5-3.65c0-2.31-2.74-3.85-5.5-3.85z" />
              </svg>
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#FCEEEA] bg-[#1E1915] px-1.5 py-0.5 rounded mt-1 border border-[#4E4238]">
              YOUR LOCATION
            </span>
          </div>
        </div>
      </div>

      {/* Status Progress Area */}
      <div className="w-full max-w-sm mt-3 space-y-2 text-center">
        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-[#EAE0D3] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-[#B84227] rounded-full"
            initial={{ width: '10%' }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Dynamic Status Text */}
        <div className="flex items-center justify-center gap-2 text-xs sm:text-sm font-bold text-[#1A1412] min-h-[22px]">
          {progressPercent === 100 ? (
            <CheckCircle2 className="w-4 h-4 text-[#1E4334]" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-[#B83A20]" />
          )}
          <span>{statusText}</span>
        </div>

        {/* Responder Count Indicator */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-[#4A3F37] font-semibold">
          <Users className="w-3.5 h-3.5 text-[#1A1412]" />
          <span>{discoveredResponders.length} animal rescue units identified</span>
        </div>
      </div>

      {/* Skip button for rapid testing */}
      <div className="mt-3">
        <button
          id="skip-scan-button"
          onClick={() => onScanComplete(allResponders)}
          className="text-xs text-[#52443A] hover:text-[#1A1412] font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-[#EAE0D3] transition-colors cursor-pointer"
        >
          <span>Skip radar animation</span>
          <FastForward className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
