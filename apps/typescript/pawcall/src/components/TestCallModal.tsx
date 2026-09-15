import React, { useState } from 'react';
import { motion } from 'motion/react';
import { PhoneCall, ShieldAlert, Check, ArrowRight } from 'lucide-react';
import { Responder } from '../types';

interface TestCallModalProps {
  initialPhone?: string;
  nextResponder: Responder;
  onStartTestCall: (testPhone: string) => void;
  onCancel: () => void;
}

export const TestCallModal: React.FC<TestCallModalProps> = ({
  initialPhone = '',
  nextResponder,
  onStartTestCall,
  onCancel,
}) => {
  const [phoneNumber, setPhoneNumber] = useState(initialPhone || '+1 (555) 729-3829');
  const [agreeConsent, setAgreeConsent] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreeConsent) return;
    onStartTestCall(phoneNumber);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1A1412]/60 backdrop-blur-xs animate-in fade-in duration-200">
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 280 }}
        className="w-full max-w-md bg-[#FAF6F0] rounded-2xl shadow-2xl border border-[#D5C6B5] overflow-hidden text-left"
      >
        {/* Banner / Header */}
        <div className="p-5 bg-[#F2EAE0] border-b border-[#D5C6B5]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#733F0C] text-white">
              DEMO / TEST MODE
            </span>
            <span className="text-xs text-[#1A1412] font-black">Simulated Dispatch Flow</span>
          </div>
          <h3 className="text-xl font-black text-[#1A1412] mt-1">
            Test the PawCall responder
          </h3>
          <p className="text-xs text-[#4A3F37] font-semibold mt-1 leading-relaxed">
            For this interactive preview, calls are simulated in real-time to test the voice response pipeline.
          </p>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Target Simulated Responder Info */}
          <div className="p-3 rounded-xl bg-[#EDE3D6] border border-[#D5C6B5] flex items-center justify-between text-xs">
            <div>
              <span className="text-[#807266] font-bold block text-[11px]">Next Queue Candidate:</span>
              <span className="font-black text-[#1A1412]">{nextResponder.name}</span>
            </div>
            <span className="px-2 py-0.5 rounded bg-[#F7EAE6] text-[#B83A20] font-black border border-[#EACEC5]">
              {nextResponder.distanceKm} km away
            </span>
          </div>

          {/* Test Phone Input */}
          <div className="space-y-1.5">
            <label htmlFor="test-phone-input" className="text-xs font-black uppercase tracking-wider text-[#1A1412] block">
              Enter your phone number
            </label>
            <div className="relative">
              <input
                id="test-phone-input"
                type="tel"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1 (555) 123-4567"
                className="w-full px-3.5 py-2.5 text-sm font-semibold text-[#1A1412] bg-[#FAF6F0] border border-[#D5C6B5] rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#B83A20] focus:border-[#B83A20] transition-all"
              />
            </div>
            <p className="text-[11px] text-[#4A3F37] font-semibold">
              The AI dispatch engine will simulate outbound call handling to this responder line.
            </p>
          </div>

          {/* Consent Checkbox */}
          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#EDE3D6] border border-[#D5C6B5] cursor-pointer hover:bg-[#E5DACE] transition-colors">
            <div className="relative flex items-center justify-center mt-0.5">
              <input
                id="test-call-agree-checkbox"
                type="checkbox"
                checked={agreeConsent}
                onChange={(e) => setAgreeConsent(e.target.checked)}
                className="w-4 h-4 text-[#B83A20] rounded border-[#D5C6B5] focus:ring-[#B83A20] cursor-pointer accent-[#B83A20]"
              />
            </div>
            <span className="text-xs text-[#1A1412] font-semibold leading-tight">
              I agree to receive a test call simulation and understand this is for evaluation purposes.
            </span>
          </label>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
            <button
              id="start-test-call-button"
              type="submit"
              disabled={!agreeConsent}
              className={`w-full py-3 px-4 rounded-xl font-black text-sm shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer ${
                agreeConsent
                  ? 'bg-[#B83A20] hover:bg-[#A13018] text-white active:scale-[0.98]'
                  : 'bg-[#D5C6B5] text-[#807266] cursor-not-allowed'
              }`}
            >
              <PhoneCall className="w-4 h-4" />
              <span>START TEST CALL</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>

            <button
              id="cancel-test-call-button"
              type="button"
              onClick={onCancel}
              className="w-full sm:w-auto py-2.5 px-4 text-xs font-black text-[#52443A] hover:text-[#1A1412] hover:bg-[#EDE3D6] rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
