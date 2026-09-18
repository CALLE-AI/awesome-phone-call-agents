import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { MapPin, X, ArrowRight, Phone, AlertCircle, CheckCircle2, ShieldAlert, Check } from 'lucide-react';
import { PRESET_EMERGENCIES } from '../data/mockResponders';
import { ANIMAL_CATEGORY_PRESETS } from '../data/rescuedAnimals';

interface EmergencyFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    description: string;
    animalType: string;
    callerPhone: string;
    locationName: string;
  }) => void;
}

export const EmergencyForm: React.FC<EmergencyFormProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [description, setDescription] = useState('');
  const [animalType, setAnimalType] = useState('Dog / Canine');
  const [callerPhone, setCallerPhone] = useState('');
  const [locationName, setLocationName] = useState('Sector 62, Noida (GPS High-Accuracy)');
  const [isLocating, setIsLocating] = useState(true);

  // Attempt real browser geolocation or fallback gracefully
  useEffect(() => {
    if (isOpen) {
      setIsLocating(true);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude.toFixed(4);
            const lng = pos.coords.longitude.toFixed(4);
            setLocationName(`GPS: ${lat}° N, ${lng}° E • Sector 62, Noida`);
            setIsLocating(false);
          },
          () => {
            setLocationName('GPS Locked: Sector 62, Noida (Near Tech Zone)');
            setIsLocating(false);
          },
          { timeout: 3000 }
        );
      } else {
        setLocationName('GPS Locked: Sector 62, Noida');
        setIsLocating(false);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalDescription = description.trim() || 'Injured animal requiring immediate rescue attention.';
    onSubmit({
      description: finalDescription,
      animalType,
      callerPhone: callerPhone.trim(),
      locationName,
    });
  };

  const handleSelectCategory = (cat: typeof ANIMAL_CATEGORY_PRESETS[0]) => {
    setAnimalType(cat.name);
    if (!description || description === '') {
      setDescription(cat.presetText);
    }
  };

  const handleSelectPreset = (preset: { label: string; text: string }) => {
    setDescription(preset.text);
    if (preset.label.includes('Dog')) setAnimalType('Dog / Canine');
    else if (preset.label.includes('Cow') || preset.label.includes('Cattle')) setAnimalType('Cattle / Farm Animal');
    else if (preset.label.includes('Cat')) setAnimalType('Cat / Kitten');
    else if (preset.label.includes('Bird')) setAnimalType('Bird / Wildlife');
    else setAnimalType('Wildlife / Other');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#110D0B]/75 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      <motion.div
        initial={{ y: '100%', opacity: 0.5 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="w-full max-w-lg bg-[#FAF6F0] rounded-t-3xl sm:rounded-2xl shadow-2xl border border-[#D5C6B5] max-h-[92vh] flex flex-col overflow-hidden text-[#1A1412]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D5C6B5] bg-[#FAF6F0]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#B83A20] text-white flex items-center justify-center font-black shadow-xs">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black tracking-wider uppercase px-2 py-0.5 bg-[#F7EAE6] text-[#B83A20] rounded border border-[#EACEC5]">
                  STEP 2 OF 2
                </span>
                <h2 className="text-base sm:text-lg font-black text-[#1A1412]">Emergency Report Details</h2>
              </div>
              <p className="text-xs text-[#4A3F37] font-semibold">Immediate AI dispatch to closest veterinary responders</p>
            </div>
          </div>
          <button
            id="close-emergency-form-button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-[#EAE0D3] flex items-center justify-center text-[#4A3F37] hover:text-[#1A1412] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4 overflow-y-auto">
          {/* SECTION 1: ANIMAL TYPE SELECTION WITH HIGH CONTRAST ACTIVE STATES */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase tracking-wider text-[#1A1412] block">
                1. Which animal needs help?
              </label>
              <span className="text-[11px] font-bold text-[#B83A20]">Required</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {ANIMAL_CATEGORY_PRESETS.map((cat) => {
                const isSelected = animalType.toLowerCase().includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleSelectCategory(cat)}
                    className={`relative p-2 rounded-xl border-2 flex flex-col items-center text-center transition-all cursor-pointer select-none ${
                      isSelected
                        ? 'border-[#B83A20] bg-[#B83A20] text-white shadow-md ring-2 ring-[#B83A20]/30 scale-[1.02]'
                        : 'border-[#D5C6B5] bg-[#F2EAE0] text-[#1A1412] hover:bg-[#EAE0D3] hover:border-[#BFAF9F]'
                    }`}
                  >
                    {/* Active check indicator badge */}
                    {isSelected && (
                      <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-white text-[#B83A20] flex items-center justify-center shadow-xs">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                    <div className={`w-11 h-11 rounded-lg overflow-hidden mb-1.5 p-0.5 ${isSelected ? 'bg-white/20' : 'bg-[#E5DACE]'}`}>
                      <img
                        src={cat.imageUrl}
                        alt={cat.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover rounded-md"
                      />
                    </div>
                    <span className={`text-[11px] font-black leading-tight ${isSelected ? 'text-white' : 'text-[#1A1412]'}`}>
                      {cat.name.split('/')[0].trim()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SECTION 2: LOCATION */}
          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase tracking-wider text-[#1A1412] flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#B83A20]" />
              2. Confirmed Incident Location
            </label>
            <div className="p-3 rounded-xl bg-[#E5F3EB] border border-[#BBDCCB] flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-[#1E4334] text-white flex items-center justify-center shrink-0 mt-0.5">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-[#1E4334]">GPS Location Locked</span>
                  {isLocating && (
                    <span className="text-[10px] text-[#1E4334] bg-[#D3E8DC] px-1.5 py-0.2 rounded font-bold">
                      Pinpointing...
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#1E4334] font-bold truncate mt-0.5">
                  {locationName}
                </p>
                <span className="text-[11px] text-[#244737] font-semibold mt-0.5 block">
                  Responders will be routed to this exact pin.
                </span>
              </div>
            </div>
          </div>

          {/* SECTION 3: PROBLEM / DETAILS */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="emergency-problem-input" className="text-xs font-black uppercase tracking-wider text-[#1A1412]">
                3. What is the emergency?
              </label>
              <span className="text-[11px] text-[#4A3F37] font-bold">Tap a quick situation below:</span>
            </div>

            {/* Quick Tap Presets for Speed */}
            <div className="flex flex-wrap gap-1.5 pb-0.5">
              {PRESET_EMERGENCIES.slice(0, 3).map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className="text-xs px-2.5 py-1 rounded-lg bg-[#EDE3D6] hover:bg-[#DFCDBB] text-[#1A1412] font-bold transition-colors border border-[#D5C6B5] cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <textarea
                id="emergency-problem-input"
                rows={3}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Dog hit by a car on the roadside, bleeding from front paw, conscious..."
                className="w-full px-3.5 py-2.5 text-sm font-semibold text-[#1A1412] bg-[#FAF6F0] border-2 border-[#D5C6B5] rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#B83A20] focus:border-[#B83A20] transition-all placeholder:text-[#807266] resize-none"
              />
            </div>
          </div>

          {/* SECTION 4: PHONE NUMBER */}
          <div className="space-y-1.5">
            <label htmlFor="emergency-phone-input" className="text-xs font-black uppercase tracking-wider text-[#1A1412] flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-[#B83A20]" />
              4. Contact Phone <span className="text-[10px] font-normal text-[#52443A]">(Optional callback)</span>
            </label>
            <input
              id="emergency-phone-input"
              type="tel"
              value={callerPhone}
              onChange={(e) => setCallerPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full px-3.5 py-2.5 text-sm font-semibold text-[#1A1412] bg-[#FAF6F0] border-2 border-[#D5C6B5] rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#B83A20] focus:border-[#B83A20] transition-all placeholder:text-[#807266]"
            />
            <p className="text-[11px] text-[#4A3F37] font-semibold">
              Dispatched rescue team can call you for gate code or exact spot directions.
            </p>
          </div>

          {/* Prompt submit notice */}
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF1E4] border border-[#E8D4BE] text-xs font-bold text-[#733F0C]">
            <AlertCircle className="w-4 h-4 text-[#B83A20] shrink-0" />
            <span>PawCall AI will immediately scan radar & call the 5 closest vets & NGO rescuers.</span>
          </div>

          {/* Bottom Primary Button */}
          <button
            id="submit-find-help-button"
            type="submit"
            className="w-full py-3.5 px-6 rounded-xl bg-[#B83A20] hover:bg-[#A13018] text-white font-black text-base shadow-lg shadow-[#612113]/25 flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] cursor-pointer"
          >
            <ShieldAlert className="w-5 h-5 text-white" />
            <span>START AI RESCUE DISPATCH</span>
            <ArrowRight className="w-5 h-5 stroke-[2.5]" />
          </button>
        </form>
      </motion.div>
    </div>
  );
};

