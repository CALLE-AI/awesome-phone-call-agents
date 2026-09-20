import React, { useState } from 'react';
import {
  Heart,
  ShieldCheck,
  AlertOctagon,
  Trash2,
  Save,
  CheckCircle2,
  UserCheck
} from 'lucide-react';
import { ResidentProfile } from '../types';
import { ModalShell } from './ui/ModalShell';

interface FamilyAnchorPortalModalProps {
  resident: ResidentProfile;
  isOpen: boolean;
  onClose: () => void;
  onSaveAnchorLedger: (updatedResident: ResidentProfile) => void;
}

export const FamilyAnchorPortalModal: React.FC<FamilyAnchorPortalModalProps> = ({
  resident,
  isOpen,
  onClose,
  onSaveAnchorLedger,
}) => {
  const [formData, setFormData] = useState<ResidentProfile>({ ...resident });
  const [newBannedTopic, setNewBannedTopic] = useState('');
  const [newSensoryAnchor, setNewSensoryAnchor] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleAddBannedTopic = () => {
    if (!newBannedTopic.trim()) return;
    setFormData((prev) => ({
      ...prev,
      bannedSensitiveTopics: [...(prev.bannedSensitiveTopics || []), newBannedTopic.trim()],
    }));
    setNewBannedTopic('');
  };

  const handleRemoveBannedTopic = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      bannedSensitiveTopics: (prev.bannedSensitiveTopics || []).filter((_, i) => i !== index),
    }));
  };

  const handleAddSensoryAnchor = () => {
    if (!newSensoryAnchor.trim()) return;
    setFormData((prev) => ({
      ...prev,
      favoriteSensoryAnchors: [...prev.favoriteSensoryAnchors, newSensoryAnchor.trim()],
    }));
    setNewSensoryAnchor('');
  };

  const handleRemoveSensoryAnchor = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      favoriteSensoryAnchors: prev.favoriteSensoryAnchors.filter((_, i) => i !== index),
    }));
  };

  const handleSave = () => {
    onSaveAnchorLedger(formData);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 900);
  };

  return (
    <ModalShell
      onClose={onClose}
      maxWidthClassName="max-w-2xl"
      icon={<Heart className="w-5 h-5" />}
      iconClassName="bg-teal-500/20 border-teal-400/40 text-teal-300"
      title="Family Anchor Memory Ledger"
      titleBadge={
        <span className="text-xs bg-teal-900/80 text-teal-300 border border-teal-700/60 px-2 py-0.5 rounded-full font-mono">
          Room {resident.roomNumber}
        </span>
      }
      subtitle={`Onboarding memory portal for ${resident.name} • Contributed by Family & Power of Attorney`}
      bodyClassName="p-5 space-y-5 text-xs text-slate-700"
      footer={
        <>
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
            <span>HIPAA BAA Protected • Changes update AI prompt in real time</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              onClick={handleSave}
              className="px-4 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-bold transition cursor-pointer flex items-center gap-1.5 shadow-xs"
            >
              {savedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  <span>Saved to Ledger</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Memory Anchor</span>
                </>
              )}
            </button>
          </div>
        </>
      }
    >
          {/* Family Contributor Banner */}
          <div className="bg-teal-50/70 border border-teal-200 p-3.5 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <UserCheck className="w-4 h-4 text-teal-700 shrink-0" />
              <div>
                <div className="font-bold text-slate-900 text-xs">
                  Authorized Family Contributor: {resident.familyContributors?.[0]?.name || 'Sofia Mendez (Daughter / PoA)'}
                </div>
                <div className="text-[11px] text-slate-500">
                  Last verified: {resident.familyContributors?.[0]?.lastUpdatedDate || 'Yesterday at 3:15 PM'} • HIPAA Consented
                </div>
              </div>
            </div>
            <span className="text-[11px] font-semibold text-teal-800 bg-white px-2 py-1 rounded border border-teal-200">
              Active Sync
            </span>
          </div>

          {/* 1. Childhood Hometown & Native Language */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Childhood Hometown & Region
              </label>
              <input
                type="text"
                value={formData.childhoodHometown}
                onChange={(e) => setFormData({ ...formData, childhoodHometown: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-teal-600"
                placeholder="e.g., Guadalajara, Jalisco"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                CALL-E references familiar local landmarks and weather.
              </span>
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Primary Native Language / Dialect
              </label>
              <input
                type="text"
                value={formData.firstLanguage}
                onChange={(e) => setFormData({ ...formData, firstLanguage: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-teal-600"
                placeholder="e.g., Spanish (Mexican)"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                CALL-E will speak in this authentic dialect.
              </span>
            </div>
          </div>

          {/* 2. Primary Career & Reminiscence Pride */}
          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Primary Career Anchor (Lifelong Passion & Identity)
            </label>
            <input
              type="text"
              value={formData.reminiscenceTopic}
              onChange={(e) => setFormData({ ...formData, reminiscenceTopic: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-teal-600 font-medium"
              placeholder="e.g., Master Baker at Panadería La Esperanza (1962-1995)"
            />
          </div>

          {/* 3. STRICTLY BANNED TOPICS (Critical for preventing distress) */}
          <div className="bg-rose-50/70 border border-rose-200 p-3.5 rounded-xl space-y-2">
            <div className="flex items-center gap-1.5 text-rose-900 font-bold text-xs">
              <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Strictly Banned Topics (Triggers & Distress Traps)</span>
            </div>
            <p className="text-[11px] text-rose-700">
              Topics CALL-E is strictly forbidden from bringing up (e.g. deceased loved ones, fatal accidents, traumatic wartime events).
            </p>

            <div className="space-y-1.5">
              {(formData.bannedSensitiveTopics || []).map((topic, idx) => (
                <div key={idx} className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-rose-200 text-xs">
                  <span className="text-rose-900 font-medium">{topic}</span>
                  <button
                    onClick={() => handleRemoveBannedTopic(idx)}
                    className="text-slate-400 hover:text-rose-600 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newBannedTopic}
                onChange={(e) => setNewBannedTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddBannedTopic()}
                className="flex-1 bg-white border border-rose-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-rose-500"
                placeholder="e.g., Never correct her regarding her late husband's passing"
              />
              <button
                onClick={handleAddBannedTopic}
                className="bg-rose-700 hover:bg-rose-800 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                Add
              </button>
            </div>
          </div>

          {/* 4. Safe Sensory Anchors & Aromas */}
          <div className="space-y-2">
            <label className="font-bold text-slate-700 block">
              Safe Sensory Anchors & Comfort Memories
            </label>
            <div className="space-y-1.5">
              {formData.favoriteSensoryAnchors.map((anchor, idx) => (
                <div key={idx} className="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs">
                  <span className="text-slate-800 font-medium">{anchor}</span>
                  <button
                    onClick={() => handleRemoveSensoryAnchor(idx)}
                    className="text-slate-400 hover:text-rose-600 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newSensoryAnchor}
                onChange={(e) => setNewSensoryAnchor(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSensoryAnchor()}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-teal-600"
                placeholder="e.g., Warm vanilla cinnamon scent; kneading sourdough"
              />
              <button
                onClick={handleAddSensoryAnchor}
                className="bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                Add
              </button>
            </div>
          </div>

          {/* 5. Beloved Songs & Childhood Pets */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Childhood Pets & Names
              </label>
              <input
                type="text"
                value={(formData.childhoodPets || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    childhoodPets: e.target.value.split(',').map((s) => s.trim()),
                  })
                }
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-teal-600"
                placeholder="e.g., Canelo (Golden dog)"
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Beloved Folk Songs & Melodies
              </label>
              <input
                type="text"
                value={(formData.favoriteSongs || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    favoriteSongs: e.target.value.split(',').map((s) => s.trim()),
                  })
                }
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-teal-600"
                placeholder="e.g., Cielito Lindo, Amor Eterno"
              />
            </div>
          </div>

          {/* 6. Validation Redirection Strategy */}
          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Validation & Redirection Strategy (Instructions for CALL-E)
            </label>
            <textarea
              rows={3}
              value={formData.redirectionStrategy}
              onChange={(e) => setFormData({ ...formData, redirectionStrategy: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-teal-600 leading-relaxed"
              placeholder="e.g., Validate her dedication as a baker; never correct the time. Pivot to recipe secrets."
            />
          </div>

    </ModalShell>
  );
};
