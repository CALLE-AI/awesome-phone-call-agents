import React from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Compass, ArrowLeft, PhoneCall, ShieldAlert, Heart } from 'lucide-react';
import { EmergencyReport } from '../types';
import { CaringHandsIllustration } from './AnimalIllustrations';

interface FailureStateProps {
  report: Partial<EmergencyReport>;
  onTryWiderSearch: () => void;
  onBackToHome: () => void;
}

export const FailureState: React.FC<FailureStateProps> = ({
  report,
  onTryWiderSearch,
  onBackToHome,
}) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center max-w-lg mx-auto px-4 py-8 w-full text-center">
      {/* Fallback Icon / Caring Hands Illustration */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 15, stiffness: 200 }}
        className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[#FAF1E4] text-[#8C4F12] flex items-center justify-center mb-3 border-2 border-[#E8D4BE] shadow-md"
      >
        <CaringHandsIllustration className="w-12 h-12" />
      </motion.div>

      {/* Headline & Explanation */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="space-y-1.5 mb-5"
      >
        <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#FAF1E4] text-[#733F0C] text-xs font-black border border-[#E8D4BE]">
          <span>LOCAL SEARCH UNRESOLVED</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-[#1A1412] tracking-tight">
          No immediate responder nearby
        </h2>
        <p className="text-sm text-[#4A3F37] font-semibold max-w-md mx-auto leading-relaxed">
          Local volunteers and clinics in your direct 5km radius may currently be engaged in other active rescues.
        </p>
      </motion.div>

      {/* Recommendation Card & Direct Hotline Backup */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="w-full bg-[#FAF6F0] rounded-2xl shadow-md border border-[#D5C6B5] p-5 text-left space-y-4 mb-5"
      >
        <h4 className="text-xs font-black uppercase tracking-wider text-[#1A1412]">
          Recommended Next Steps
        </h4>

        <div className="space-y-2.5">
          <div className="p-3.5 rounded-xl bg-[#EDE3D6] border border-[#D5C6B5] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#FAF6F0] text-[#1A1412] flex items-center justify-center border border-[#D5C6B5] shadow-2xs">
                <Compass className="w-4 h-4 text-[#B83A20]" />
              </div>
              <div>
                <span className="text-xs font-black text-[#1A1412] block">Expand Radius to 15km</span>
                <span className="text-[11px] font-semibold text-[#4A3F37]">Query regional wildlife sanctuaries & mobile ambulances</span>
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#EDE3D6] border border-[#D5C6B5] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#E5F3EB] text-[#1E4334] flex items-center justify-center border border-[#BBDCCB] shadow-2xs">
                <PhoneCall className="w-4 h-4 text-[#1E4334]" />
              </div>
              <div>
                <span className="text-xs font-black text-[#1A1412] block">National Animal Rescue Helpline</span>
                <span className="text-[11px] font-semibold text-[#4A3F37]">24/7 Toll-Free Emergency Line: 1-800-482-7297</span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Buttons */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="w-full space-y-2.5"
      >
        <button
          id="try-wider-search-button"
          onClick={onTryWiderSearch}
          className="w-full py-3.5 px-5 rounded-xl bg-[#B83A20] hover:bg-[#A13018] text-white font-black text-sm shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
        >
          <Compass className="w-4 h-4" />
          <span>TRY WIDER SEARCH (15KM)</span>
        </button>

        <button
          id="failure-back-to-home-button"
          onClick={onBackToHome}
          className="w-full py-3 px-5 rounded-xl text-[#1A1412] hover:bg-[#EDE3D6] font-black text-sm transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
          <span>BACK TO HOME</span>
        </button>
      </motion.div>
    </div>
  );
};
