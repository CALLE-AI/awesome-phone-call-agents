import React from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, Zap } from 'lucide-react';

interface SOSButtonProps {
  onTriggerSOS: () => void;
  disabled?: boolean;
}

export const SOSButton: React.FC<SOSButtonProps> = ({ onTriggerSOS, disabled = false }) => {
  return (
    <div className="relative flex items-center justify-center py-4 sm:py-6 select-none w-full">
      {/* Background Soft Distance Rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-64 h-64 sm:w-84 sm:h-84 rounded-full border border-[#DECFC0] bg-[#EFE7DE]/50" />
        <div className="w-52 h-52 sm:w-68 sm:h-68 rounded-full border border-[#EFCAC1] bg-[#F7EBE7]/50" />
      </div>

      {/* Main Single Giant Emergency CTA Button */}
      <motion.button
        id="main-get-help-button"
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.96 }}
        disabled={disabled}
        onClick={onTriggerSOS}
        className="relative z-10 w-52 h-52 sm:w-64 sm:h-64 rounded-full bg-[#B83A20] hover:bg-[#A13018] text-white shadow-2xl shadow-[#612113]/30 flex flex-col items-center justify-center p-5 group cursor-pointer focus:outline-none focus:ring-4 focus:ring-[#B83A20]/40 transition-all border-4 border-[#FAF6F0] active:ring-8"
      >
        {/* Rescue Icon Emblem */}
        <div className="mb-2 p-2.5 rounded-full bg-white/20 group-hover:bg-white/25 transition-colors shadow-xs">
          <ShieldAlert className="w-8 h-8 sm:w-9 sm:h-9 text-white" />
        </div>

        {/* SOS Button Primary Text */}
        <span className="text-2xl sm:text-3xl font-black tracking-tight uppercase text-white leading-none">
          GET HELP NOW
        </span>

        {/* Action Description */}
        <span className="text-xs sm:text-sm font-bold text-[#FEECE8] tracking-wide mt-2 flex items-center gap-1.5 bg-black/15 px-3 py-1 rounded-full">
          <Zap className="w-3.5 h-3.5 text-[#FED7AA] fill-[#FED7AA]" />
          Instant AI Dispatch
        </span>
      </motion.button>
    </div>
  );
};

