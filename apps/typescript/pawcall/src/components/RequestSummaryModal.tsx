import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Clock, MapPin, Phone, ShieldCheck, X, FileText } from 'lucide-react';
import { EmergencyReport, Responder } from '../types';

interface RequestSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: Partial<EmergencyReport>;
  responder?: Responder;
}

export const RequestSummaryModal: React.FC<RequestSummaryModalProps> = ({
  isOpen,
  onClose,
  report,
  responder,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1A1412]/60 backdrop-blur-xs animate-in fade-in duration-200">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', damping: 22, stiffness: 280 }}
        className="w-full max-w-md bg-[#FAF6F0] rounded-2xl shadow-2xl border border-[#D5C6B5] overflow-hidden text-left"
      >
        <div className="flex items-center justify-between p-5 border-b border-[#D5C6B5] bg-[#F2EAE0]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#E5F3EB] text-[#1E4334] flex items-center justify-center border border-[#BBDCCB]">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-black text-[#1A1412]">Emergency Dispatch Summary</h3>
              <p className="text-[11px] font-bold text-[#807266]">Incident Ticket #{report.id || 'SOS-ACTIVE'}</p>
            </div>
          </div>
          <button
            id="close-summary-modal-btn"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-[#D5C6B5] flex items-center justify-center text-[#807266] hover:text-[#1A1412] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* Status Banner */}
          <div className="p-3 rounded-xl bg-[#E5F3EB] border border-[#BBDCCB] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#1E4334]" />
              <span className="font-black text-[#1E4334]">Status: Dispatched & Confirmed</span>
            </div>
            <span className="text-[10px] uppercase font-black bg-[#1E4334] text-white px-2 py-0.5 rounded">
              Active
            </span>
          </div>

          {/* Incident Details */}
          <div className="space-y-1.5">
            <span className="font-black text-[#807266] uppercase tracking-wider block text-[10px]">
              Reported Situation
            </span>
            <div className="p-3 rounded-xl bg-[#EDE3D6] border border-[#D5C6B5] space-y-1">
              <div className="font-black text-[#1A1412] text-sm">{report.animalType || 'Animal'} in Distress</div>
              <p className="text-[#4A3F37] font-semibold leading-relaxed">{report.description}</p>
            </div>
          </div>

          {/* Location Details */}
          <div className="space-y-1">
            <span className="font-black text-[#807266] uppercase tracking-wider block text-[10px]">
              GPS Coordinates & Spot
            </span>
            <div className="flex items-start gap-2 text-[#1A1412] font-bold">
              <MapPin className="w-4 h-4 text-[#B83A20] shrink-0 mt-0.5" />
              <span>{report.locationName || 'GPS Location detected'}</span>
            </div>
          </div>

          {/* Responder Details */}
          {responder && (
            <div className="space-y-1 pt-1">
              <span className="font-black text-[#807266] uppercase tracking-wider block text-[10px]">
                Assigned Rescue Unit
              </span>
              <div className="p-3 rounded-xl bg-[#EDE3D6] border border-[#D5C6B5] flex items-center justify-between">
                <div>
                  <h4 className="font-black text-[#1A1412]">{responder.name}</h4>
                  <p className="text-[#4A3F37] font-semibold text-[11px]">{responder.typeLabel} • {responder.phone}</p>
                </div>
                <div className="text-right">
                  <span className="text-[#B83A20] font-black">{responder.distanceKm} km</span>
                  <span className="block text-[10px] text-[#807266] font-bold">ETA ~15 min</span>
                </div>
              </div>
            </div>
          )}

          {report.callerPhone && (
            <div className="text-[#4A3F37] font-semibold flex items-center gap-1.5 pt-1">
              <Phone className="w-3.5 h-3.5 text-[#807266]" />
              <span>Callback Phone: <strong className="text-[#1A1412]">{report.callerPhone}</strong></span>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#D5C6B5] bg-[#F2EAE0]">
          <button
            id="dismiss-summary-modal-btn"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-[#1A1412] hover:bg-[#2C2420] text-white font-black text-xs transition-colors cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </motion.div>
    </div>
  );
};
