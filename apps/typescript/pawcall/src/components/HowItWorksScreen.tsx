import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Radio, Bot, ShieldCheck, MapPin, Zap, ArrowLeft, Heart, Sparkles, CheckCircle2 } from 'lucide-react';
import {
  RescuedDogIllustration,
  RescuedCatIllustration,
  RescuedBirdIllustration,
  RescuedCalfIllustration,
} from './AnimalIllustrations';
import { RESCUED_ANIMAL_STORIES } from '../data/rescuedAnimals';

interface HowItWorksScreenProps {
  onBackToSOS: () => void;
}

export const HowItWorksScreen: React.FC<HowItWorksScreenProps> = ({ onBackToSOS }) => {
  const [selectedStory, setSelectedStory] = useState(RESCUED_ANIMAL_STORIES[0]);

  const steps = [
    {
      step: '01',
      title: 'Instant One-Tap SOS',
      desc: 'No login, app download, or paperwork required. PawCall locks onto your exact GPS coordinates and records critical animal triage details.',
      icon: MapPin,
      color: 'bg-[#F7EAE6] text-[#B83A20] border border-[#EACEC5]',
    },
    {
      step: '02',
      title: 'Real-time Radar Discovery',
      desc: 'Our emergency radius scanner queries verified 24/7 veterinary hospitals, NGO ambulances, and certified animal first-responders within 5-15km.',
      icon: Radio,
      color: 'bg-[#EDE3D6] text-[#1A1412] border border-[#D5C6B5]',
    },
    {
      step: '03',
      title: 'AI Autonomous Voice Dispatch',
      desc: 'PawCall AI places an instant phone call to the nearest responder, accurately communicating the species, injury severity, and GPS navigation pin.',
      icon: Bot,
      color: 'bg-[#FAF1E4] text-[#8C4F12] border border-[#E8D4BE]',
    },
    {
      step: '04',
      title: 'Smart Cascade Escalation',
      desc: 'If a responder is busy on another rescue or does not answer within 40 seconds, the AI immediately cascades and dials the next nearest responder.',
      icon: Zap,
      color: 'bg-[#EDE3D6] text-[#1A1412] border border-[#D5C6B5]',
    },
    {
      step: '05',
      title: 'Rescue Confirmed & Live Guidance',
      desc: 'Once accepted, estimated arrival time is computed and tailored first-aid safety advice is provided to keep the animal calm until help arrives.',
      icon: ShieldCheck,
      color: 'bg-[#E5F3EB] text-[#1E4334] border border-[#BBDCCB]',
    },
  ];

  return (
    <div className="flex-1 max-w-xl mx-auto px-4 py-6 w-full text-left">
      {/* Header */}
      <div className="mb-6 text-center space-y-1.5">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F7EAE6] text-[#B83A20] text-xs font-black border border-[#EACEC5]">
          <Heart className="w-3.5 h-3.5 text-[#B83A20] fill-[#B83A20]" />
          <span>Every Second Counts for Animal Lives</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-[#1A1412] tracking-tight">
          How PawCall Works
        </h2>
        <p className="text-xs sm:text-sm text-[#4A3F37] font-semibold max-w-md mx-auto">
          An emergency response coordination network connecting distressed street animals with immediate human responders.
        </p>
      </div>

      {/* Animal Emblems Showcase */}
      <div className="flex items-center justify-center gap-4 py-3 mb-6 bg-[#FAF6F0] rounded-2xl border border-[#D5C6B5]">
        <div className="flex items-center gap-3">
          <RescuedDogIllustration className="w-8 h-8" />
          <RescuedCatIllustration className="w-8 h-8" />
          <RescuedCalfIllustration className="w-8 h-8" />
          <RescuedBirdIllustration className="w-8 h-8" />
        </div>
        <span className="text-xs font-bold text-[#1A1412]">Built for Dogs, Cats, Cattle & Wildlife</span>
      </div>

      {/* 5-Step Workflow */}
      <div className="space-y-3 mb-8">
        <h3 className="text-xs font-black uppercase tracking-wider text-[#1A1412]">
          The 5-Step Rapid Response Engine
        </h3>
        {steps.map((item, idx) => {
          const Icon = item.icon;
          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05, duration: 0.25 }}
              className="p-4 rounded-2xl bg-[#FAF6F0] border border-[#D5C6B5] shadow-2xs flex items-start gap-3.5"
            >
              <div className={`w-10 h-10 rounded-xl ${item.color} flex items-center justify-center shrink-0 mt-0.5 shadow-2xs`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black tracking-wider text-[#807266]">
                    PHASE {item.step}
                  </span>
                </div>
                <h4 className="text-sm font-black text-[#1A1412] leading-tight mt-0.5">
                  {item.title}
                </h4>
                <p className="text-xs font-semibold text-[#4A3F37] mt-1 leading-relaxed">
                  {item.desc}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* RECENTLY RESCUED ANIMALS IMPACT GALLERY */}
      <div className="mb-8 p-4 rounded-2xl bg-[#FAF6F0] border border-[#D5C6B5]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-[#B83A20] fill-[#B83A20]" />
            <h3 className="text-sm font-black text-[#1A1412] tracking-tight">
              Recently Rescued Animals (Community Stories)
            </h3>
          </div>
          <span className="text-[11px] text-[#1E4334] font-black bg-[#E5F3EB] px-2 py-0.5 rounded-full border border-[#BBDCCB]">
            Safe & Recovered
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {RESCUED_ANIMAL_STORIES.slice(0, 3).map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedStory(item)}
              className={`p-3 rounded-2xl bg-[#F5EFEB] border transition-all cursor-pointer flex flex-col ${
                selectedStory.id === item.id
                  ? 'border-[#B83A20] shadow-sm ring-2 ring-[#B83A20]/30'
                  : 'border-[#D5C6B5] hover:border-[#BFAF9F]'
              }`}
            >
              <div className="relative h-28 w-full rounded-xl overflow-hidden mb-2 bg-[#E5DACE]">
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <span
                  className={`absolute top-2 right-2 px-2 py-0.5 text-[10px] font-black rounded-md border ${item.badgeColor}`}
                >
                  {item.condition}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-[#1A1412]">{item.name}</h4>
                <span className="text-[10px] font-bold text-[#807266]">{item.species}</span>
              </div>
              <p className="text-[11px] font-medium text-[#4A3F37] mt-1 line-clamp-2 leading-relaxed">
                {item.story}
              </p>
              <div className="mt-2 pt-2 border-t border-[#D5C6B5] flex items-center justify-between text-[10px] text-[#52443A] font-semibold">
                <span className="truncate">{item.rescuedBy}</span>
                <span className="font-black text-[#1A1412]">{item.rescueDate}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3 Core Pillars */}
      <div className="grid grid-cols-3 gap-2.5 mb-8 text-left">
        <div className="p-3 rounded-xl bg-[#FAF6F0] border border-[#D5C6B5]">
          <div className="w-7 h-7 rounded-lg bg-[#EDE3D6] text-[#1A1412] flex items-center justify-center font-bold mb-1.5">
            <Zap className="w-4 h-4 text-[#B83A20]" />
          </div>
          <span className="text-xs font-black text-[#1A1412] block">Instant AI Call</span>
          <span className="text-[11px] font-semibold text-[#4A3F37] leading-tight mt-0.5 block">Dials nearest vets & NGOs directly</span>
        </div>

        <div className="p-3 rounded-xl bg-[#FAF6F0] border border-[#D5C6B5]">
          <div className="w-7 h-7 rounded-lg bg-[#E5F3EB] text-[#1E4334] flex items-center justify-center font-bold mb-1.5">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <span className="text-xs font-black text-[#1E4334] block">Auto Escalation</span>
          <span className="text-[11px] font-semibold text-[#244737] leading-tight mt-0.5 block">Cascades until responder locks in</span>
        </div>

        <div className="p-3 rounded-xl bg-[#FAF6F0] border border-[#D5C6B5]">
          <div className="w-7 h-7 rounded-lg bg-[#FAF1E4] text-[#8C4F12] flex items-center justify-center font-bold mb-1.5">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <span className="text-xs font-black text-[#733F0C] block">Zero Friction</span>
          <span className="text-[11px] font-semibold text-[#8C4F12] leading-tight mt-0.5 block">Fastest response for high stress</span>
        </div>
      </div>

      {/* Bottom Action */}
      <div className="pt-2">
        <button
          id="back-to-sos-from-info"
          onClick={onBackToSOS}
          className="w-full py-3.5 px-5 rounded-xl bg-[#B83A20] hover:bg-[#A13018] text-white font-black text-sm shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
          <span>RETURN TO EMERGENCY SOS</span>
        </button>
      </div>
    </div>
  );
};

