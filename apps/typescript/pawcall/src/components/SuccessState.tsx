import React from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  ShieldCheck,
  HeartHandshake,
  AlertCircle,
  ArrowLeft,
  FileText,
  Heart
} from 'lucide-react';
import { EmergencyReport, Responder } from '../types';
import { RescuedDogIllustration, RescuedCatIllustration, RescuedBirdIllustration, RescuedCalfIllustration, CaringHandsIllustration } from './AnimalIllustrations';

interface SuccessStateProps {
  report: Partial<EmergencyReport>;
  assignedResponder: Responder;
  onViewRequest: () => void;
  onBackToHome: () => void;
}

export const SuccessState: React.FC<SuccessStateProps> = ({
  report,
  assignedResponder,
  onViewRequest,
  onBackToHome,
}) => {
  const eta = Math.max(12, Math.round(assignedResponder.distanceKm * 5 + 4));

  const renderAnimalBadge = () => {
    const type = (report.animalType || '').toLowerCase();
    if (type.includes('cat')) return <RescuedCatIllustration className="w-12 h-12" />;
    if (type.includes('cow') || type.includes('calf')) return <RescuedCalfIllustration className="w-12 h-12" />;
    if (type.includes('bird') || type.includes('hawk')) return <RescuedBirdIllustration className="w-12 h-12" />;
    return <RescuedDogIllustration className="w-12 h-12" />;
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center max-w-lg mx-auto px-4 py-6 w-full text-center">
      {/* Animated Success Icon Badge with Animal Illustration */}
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', damping: 14, stiffness: 220 }}
        className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[#1E4334] text-white flex items-center justify-center shadow-lg mb-3"
      >
        <div className="p-2">
          {renderAnimalBadge()}
        </div>
        <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-white rounded-full flex items-center justify-center border-2 border-[#1E4334] text-[#1E4334] shadow">
          <CheckCircle2 className="w-4 h-4 stroke-[3]" />
        </div>
      </motion.div>

      {/* Main Title & Confirmation text */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="space-y-1.5 mb-5"
      >
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E5F3EB] text-[#1E4334] text-xs font-black border border-[#BBDCCB]">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#1E4334]" />
          <span>RESCUE DISPATCH CONFIRMED</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-[#1A1412] tracking-tight">
          Help is on the way
        </h2>
        <p className="text-sm text-[#4A3F37] font-semibold max-w-md mx-auto">
          A verified responder has accepted the rescue request and is dispatched.
        </p>
      </motion.div>

      {/* Responder & Incident Card */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="w-full bg-[#FAF6F0] rounded-2xl shadow-md border border-[#D5C6B5] p-5 text-left space-y-4 mb-5"
      >
        {/* Responder Highlight */}
        <div className="flex items-start justify-between pb-4 border-b border-[#D5C6B5]">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#E5F3EB] border border-[#BBDCCB] text-[#1E4334] flex items-center justify-center font-bold">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[11px] font-black text-[#807266] uppercase tracking-wider block">
                Assigned Responder
              </span>
              <h4 className="font-black text-[#1A1412] text-base leading-tight">
                {assignedResponder.name}
              </h4>
              <p className="text-xs font-semibold text-[#4A3F37]">{assignedResponder.typeLabel}</p>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-1 text-xs font-black text-[#1E4334] bg-[#E5F3EB] px-2.5 py-1 rounded-full border border-[#BBDCCB]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1E4334]" />
              Confirmed
            </span>
          </div>
        </div>

        {/* ETA and Distance Grid */}
        <div className="grid grid-cols-2 gap-3 py-1">
          <div className="p-3 rounded-xl bg-[#EDE3D6] border border-[#D5C6B5] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#E5F3EB] text-[#1E4334] flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[11px] text-[#4A3F37] font-bold block">Estimated Arrival</span>
              <span className="text-sm font-black text-[#1A1412]">{eta}–{eta + 6} min</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#EDE3D6] border border-[#D5C6B5] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#F7EAE6] text-[#B83A20] flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[11px] text-[#4A3F37] font-bold block">Distance</span>
              <span className="text-sm font-black text-[#1A1412]">{assignedResponder.distanceKm} km away</span>
            </div>
          </div>
        </div>

        {/* Safety Note Advisory */}
        <div className="p-3.5 rounded-xl bg-[#FAF1E4] border border-[#E8D4BE] flex items-start gap-2.5 text-xs text-[#733F0C]">
          <AlertCircle className="w-4 h-4 text-[#8C4F12] shrink-0 mt-0.5" />
          <div className="leading-relaxed font-semibold">
            <span className="font-black text-[#733F0C] block mb-0.5">Please stay nearby if it is safe to do so.</span>
            Keep other pets and bystander crowds at a calm distance so the animal remains comfortable until the rescue team arrives.
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
          id="view-request-details-button"
          onClick={onViewRequest}
          className="w-full py-3.5 px-5 rounded-xl bg-[#1A1412] hover:bg-[#2C2420] text-white font-black text-sm shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <FileText className="w-4 h-4" />
          <span>VIEW REQUEST SUMMARY</span>
        </button>

        <button
          id="success-back-to-home-button"
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
