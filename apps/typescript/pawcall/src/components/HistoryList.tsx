import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  MapPin,
  FileText,
  ChevronRight,
  ShieldCheck,
  Phone,
  AlertCircle,
  Plus,
  Heart
} from 'lucide-react';
import { EmergencyReport } from '../types';
import {
  RescuedDogIllustration,
  RescuedCatIllustration,
  RescuedBirdIllustration,
  RescuedCalfIllustration,
} from './AnimalIllustrations';

interface HistoryListProps {
  history: EmergencyReport[];
  onNewSOS: () => void;
}

export const HistoryList: React.FC<HistoryListProps> = ({ history, onNewSOS }) => {
  const [selectedIncident, setSelectedIncident] = useState<EmergencyReport | null>(null);

  const formatIncidentTime = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffHours = (now.getTime() - d.getTime()) / (1000 * 60 * 60);

    const timeString = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (diffHours < 24 && d.getDate() === now.getDate()) {
      return `Today, ${timeString}`;
    } else if (diffHours < 48) {
      return `Yesterday, ${timeString}`;
    } else {
      return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeString}`;
    }
  };

  const getAnimalIllustration = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('cat')) return <RescuedCatIllustration className="w-8 h-8" />;
    if (t.includes('cow') || t.includes('calf')) return <RescuedCalfIllustration className="w-8 h-8" />;
    if (t.includes('bird') || t.includes('hawk')) return <RescuedBirdIllustration className="w-8 h-8" />;
    return <RescuedDogIllustration className="w-8 h-8" />;
  };

  return (
    <div className="flex-1 max-w-xl mx-auto px-4 py-6 w-full text-left">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#D5C6B5]">
        <div>
          <h2 className="text-2xl font-black text-[#1A1412] tracking-tight">Rescue History</h2>
          <p className="text-xs font-semibold text-[#4A3F37] mt-0.5">Locally recorded animal emergency incidents</p>
        </div>
        <button
          id="history-new-sos-button"
          onClick={onNewSOS}
          className="px-3.5 py-2 rounded-xl bg-[#B83A20] hover:bg-[#A13018] text-white font-black text-xs shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 stroke-[3]" />
          <span>New SOS</span>
        </button>
      </div>

      {/* Incidents List */}
      {history.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-2xl bg-[#FAF6F0] border border-[#D5C6B5]">
          <div className="w-12 h-12 rounded-full bg-[#EDE3D6] text-[#807266] flex items-center justify-center mx-auto mb-3">
            <FileText className="w-6 h-6" />
          </div>
          <h3 className="font-black text-[#1A1412] text-sm">No rescue records yet</h3>
          <p className="text-xs font-semibold text-[#4A3F37] mt-1 max-w-xs mx-auto">
            When you trigger an emergency SOS, details and confirmed responder info will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((item) => {
            const isConfirmed = item.status === 'confirmed';
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => setSelectedIncident(item)}
                className="p-3.5 rounded-2xl bg-[#FAF6F0] border border-[#D5C6B5] hover:border-[#BFAF9F] shadow-2xs hover:shadow-xs transition-all cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  {/* Rescued Animal Image or Illustration Avatar */}
                  <div className="w-13 h-13 rounded-xl overflow-hidden bg-[#EDE3D6] border border-[#D5C6B5] shrink-0 flex items-center justify-center">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.animalType}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      getAnimalIllustration(item.animalType)
                    )}
                  </div>

                  {/* Summary Text */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-black text-[#1A1412] text-sm truncate">
                        {item.animalType} — {item.description.slice(0, 30)}...
                      </h4>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-semibold text-[#4A3F37] mt-1">
                      <span className="flex items-center gap-1 shrink-0">
                        <Clock className="w-3 h-3 text-[#807266]" />
                        {formatIncidentTime(item.timestamp)}
                      </span>
                      <span>•</span>
                      <span className="truncate flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-[#807266] shrink-0" />
                        {item.locationName}
                      </span>
                    </div>

                    <div className="mt-2">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-0.5 rounded-md border ${
                          isConfirmed
                            ? 'bg-[#E5F3EB] text-[#1E4334] border-[#BBDCCB]'
                            : 'bg-[#FAF1E4] text-[#733F0C] border-[#E8D4BE]'
                        }`}
                      >
                        {isConfirmed ? 'Help Confirmed' : 'No responder available'}
                        {item.assignedResponder && ` (${item.assignedResponder.name})`}
                      </span>
                    </div>
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 text-[#807266] group-hover:text-[#1A1412] transition-colors shrink-0 ml-2" />
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Incident Detail Drawer/Modal */}
      <AnimatePresence>
        {selectedIncident && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#1A1412]/60 backdrop-blur-xs">
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full max-w-md bg-[#FAF6F0] rounded-t-3xl sm:rounded-2xl shadow-2xl border border-[#D5C6B5] p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#D5C6B5]">
                <div>
                  <span className="text-[11px] font-black uppercase tracking-wider text-[#807266]">
                    Incident Report Details
                  </span>
                  <h3 className="text-lg font-black text-[#1A1412]">
                    {selectedIncident.animalType} Rescue
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedIncident(null)}
                  className="text-xs font-black px-2.5 py-1 rounded-lg bg-[#EDE3D6] hover:bg-[#D5C6B5] text-[#1A1412] transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>

              {/* Photo if available */}
              {selectedIncident.imageUrl && (
                <div className="w-full h-36 rounded-xl overflow-hidden bg-[#EDE3D6] border border-[#D5C6B5]">
                  <img
                    src={selectedIncident.imageUrl}
                    alt={selectedIncident.animalType}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div className="space-y-3 text-xs">
                <div>
                  <span className="font-black text-[#1A1412] block mb-0.5">Description:</span>
                  <p className="text-[#1A1412] font-semibold bg-[#EDE3D6] p-3 rounded-xl border border-[#D5C6B5]">
                    {selectedIncident.description}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-xl bg-[#EDE3D6] border border-[#D5C6B5]">
                    <span className="font-black text-[#807266] block text-[10px]">REPORTED TIME</span>
                    <span className="font-bold text-[#1A1412]">
                      {formatIncidentTime(selectedIncident.timestamp)}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#EDE3D6] border border-[#D5C6B5]">
                    <span className="font-black text-[#807266] block text-[10px]">STATUS</span>
                    <span
                      className={`font-black ${
                        selectedIncident.status === 'confirmed'
                          ? 'text-[#1E4334]'
                          : 'text-[#8C4F12]'
                      }`}
                    >
                      {selectedIncident.status === 'confirmed' ? 'Help Confirmed' : 'Unresolved'}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="font-black text-[#1A1412] block mb-0.5">Location:</span>
                  <p className="text-[#4A3F37] font-semibold">{selectedIncident.locationName}</p>
                </div>

                {selectedIncident.assignedResponder && (
                  <div className="p-3 rounded-xl bg-[#E5F3EB] border border-[#BBDCCB] space-y-1">
                    <span className="font-black text-[#1E4334] block text-[11px]">
                      Dispatched Responder
                    </span>
                    <p className="font-black text-[#1E4334] text-sm">
                      {selectedIncident.assignedResponder.name}
                    </p>
                    <p className="text-[#244737] font-semibold text-[11px]">
                      {selectedIncident.assignedResponder.typeLabel} • {selectedIncident.assignedResponder.distanceKm} km away
                    </p>
                  </div>
                )}
              </div>

              <button
                onClick={() => setSelectedIncident(null)}
                className="w-full py-2.5 rounded-xl bg-[#1A1412] text-white font-black text-xs cursor-pointer"
              >
                Back to History
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
