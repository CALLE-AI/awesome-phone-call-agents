import React, { useState, useEffect } from 'react';
import {
  User,
  Briefcase,
  Clock,
  ShieldCheck,
  Save,
  Plus,
  Trash2
} from 'lucide-react';
import { ResidentProfile, DementiaStage } from '../types';
import { ModalShell } from './ui/ModalShell';
import { getLanguageFlag } from '../lib/language';

interface ResidentProfileModalProps {
  resident: ResidentProfile | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (resident: ResidentProfile) => void;
}

export const ResidentProfileModal: React.FC<ResidentProfileModalProps> = ({
  resident,
  isOpen,
  onClose,
  onSave,
}) => {
  const [formData, setFormData] = useState<Partial<ResidentProfile>>({
    name: '',
    preferredName: '',
    roomNumber: '',
    wing: 'Garden Terrace',
    firstLanguage: 'English',
    languageFlag: '🇺🇸',
    dementiaStage: 'Moderate Memory Care',
    reminiscenceTopic: '',
    careerBackground: '',
    childhoodHometown: '',
    favoriteSensoryAnchors: [''],
    knownTriggers: [''],
    redirectionStrategy: '',
    preferredCallTime: '10:00 AM',
    scheduledFrequency: 'Daily',
    status: 'Active Enrolled',
    totalCallsCompleted: 0,
    lastCallDate: 'Not yet called',
    lastMood: 'Uplifted & Joyful',
    needsAttention: false,
  });

  useEffect(() => {
    if (resident) {
      setFormData({ ...resident });
    } else {
      setFormData({
        id: `res-${Date.now()}`,
        name: '',
        preferredName: '',
        roomNumber: '',
        wing: 'Garden Terrace',
        firstLanguage: 'Spanish',
        languageFlag: '🇪🇸',
        dementiaStage: 'Moderate Memory Care',
        reminiscenceTopic: '',
        careerBackground: '',
        childhoodHometown: '',
        familyMembers: [
          { name: '', relation: '', notes: '' }
        ],
        favoriteSensoryAnchors: ['Cinnamon & fresh bread', 'Traditional folk boleros'],
        knownTriggers: ['Sundowning anxiety around evening shift', 'Searching for work keys'],
        redirectionStrategy: 'Never argue or contradict. Praise past career dedication, then smoothly redirect to beloved family recipes.',
        preferredCallTime: '09:30 AM',
        scheduledFrequency: 'Monday, Wednesday, Friday',
        status: 'Active Enrolled',
        avatarSeed: 'New',
        totalCallsCompleted: 0,
        lastCallDate: 'Scheduled for tomorrow',
        lastMood: 'Peaceful & Reminiscent',
        needsAttention: false,
      });
    }
  }, [resident, isOpen]);

  if (!isOpen) return null;

  const handleLanguageChange = (lang: string) => {
    setFormData((prev) => ({
      ...prev,
      firstLanguage: lang,
      languageFlag: getLanguageFlag(lang),
    }));
  };

  const handleAddAnchor = () => {
    setFormData((prev) => ({
      ...prev,
      favoriteSensoryAnchors: [...(prev.favoriteSensoryAnchors || []), ''],
    }));
  };

  const handleUpdateAnchor = (index: number, val: string) => {
    const updated = [...(formData.favoriteSensoryAnchors || [])];
    updated[index] = val;
    setFormData((prev) => ({ ...prev, favoriteSensoryAnchors: updated }));
  };

  const handleRemoveAnchor = (index: number) => {
    const updated = (formData.favoriteSensoryAnchors || []).filter((_, i) => i !== index);
    setFormData((prev) => ({ ...prev, favoriteSensoryAnchors: updated }));
  };

  const handleAddTrigger = () => {
    setFormData((prev) => ({
      ...prev,
      knownTriggers: [...(prev.knownTriggers || []), ''],
    }));
  };

  const handleUpdateTrigger = (index: number, val: string) => {
    const updated = [...(formData.knownTriggers || [])];
    updated[index] = val;
    setFormData((prev) => ({ ...prev, knownTriggers: updated }));
  };

  const handleRemoveTrigger = (index: number) => {
    const updated = (formData.knownTriggers || []).filter((_, i) => i !== index);
    setFormData((prev) => ({ ...prev, knownTriggers: updated }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) return;

    const fullResident: ResidentProfile = {
      id: formData.id || `res-${Date.now()}`,
      name: formData.name.trim(),
      preferredName: formData.preferredName?.trim() || formData.name.trim(),
      roomNumber: formData.roomNumber?.trim() || '101',
      wing: formData.wing || 'Garden Terrace',
      firstLanguage: formData.firstLanguage || 'English',
      languageFlag: formData.languageFlag || '🇺🇸',
      dementiaStage: (formData.dementiaStage as DementiaStage) || 'Moderate Memory Care',
      reminiscenceTopic: formData.reminiscenceTopic?.trim() || 'Past career and happy family memories',
      careerBackground: formData.careerBackground?.trim() || 'Dedicated community professional',
      childhoodHometown: formData.childhoodHometown?.trim() || 'Hometown',
      familyMembers: formData.familyMembers || [],
      favoriteSensoryAnchors: (formData.favoriteSensoryAnchors || []).filter(Boolean),
      knownTriggers: (formData.knownTriggers || []).filter(Boolean),
      redirectionStrategy: formData.redirectionStrategy?.trim() || 'Validate feelings warmly and pivot to happy memories.',
      preferredCallTime: formData.preferredCallTime || '10:00 AM',
      scheduledFrequency: formData.scheduledFrequency || 'Daily',
      status: formData.status || 'Active Enrolled',
      avatarSeed: formData.avatarSeed || formData.name[0],
      totalCallsCompleted: formData.totalCallsCompleted || 0,
      lastCallDate: formData.lastCallDate || 'Scheduled',
      lastMood: formData.lastMood || 'Peaceful & Reminiscent',
      needsAttention: formData.needsAttention || false,
      roomExtension: formData.roomExtension || `x${formData.roomNumber || '101'}`,
      ehrPatientId: formData.ehrPatientId || `PCC-${Math.floor(10000 + Math.random() * 90000)}`,
      ehrProvider: formData.ehrProvider || 'PointClickCare',
      familyContributors: formData.familyContributors || [],
      bannedSensitiveTopics: formData.bannedSensitiveTopics || [],
    };

    onSave(fullResident);
  };

  return (
    <ModalShell
      onClose={onClose}
      maxWidthClassName="max-w-3xl"
      icon={<User className="w-5 h-5" />}
      title={resident ? `Edit Reminiscence Profile: ${resident.name}` : 'Onboard New Memory Care Resident'}
      subtitle="Grounds CALL-E's scheduled phone calls in authentic life history and validation cues"
      bodyClassName="p-6 space-y-5 text-slate-800 text-xs"
      footer={
        <>
          <span />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              form="resident-profile-form"
              id="btn-save-resident-profile"
              className="px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-bold transition cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              <Save className="w-4 h-4" />
              <span>Save Reminiscence Profile</span>
            </button>
          </div>
        </>
      }
    >
        <form id="resident-profile-form" onSubmit={handleSubmit} className="space-y-5">

          {/* Section 1: Demographics & Native Language */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-teal-700" />
              <span>Resident Identification & Native Language</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-slate-600 font-semibold mb-1">Full Legal Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Rosa Maria Mendez"
                  className="w-full text-xs sm:text-sm p-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Preferred / Honorific</label>
                <input
                  type="text"
                  value={formData.preferredName || ''}
                  onChange={(e) => setFormData({ ...formData, preferredName: e.target.value })}
                  placeholder='e.g., "Doña Rosa"'
                  className="w-full text-xs sm:text-sm p-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Room #</label>
                <input
                  type="text"
                  required
                  value={formData.roomNumber || ''}
                  onChange={(e) => setFormData({ ...formData, roomNumber: e.target.value })}
                  placeholder="e.g., 104"
                  className="w-full text-xs sm:text-sm p-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Wing</label>
                <select
                  value={formData.wing || 'Garden Terrace'}
                  onChange={(e) => setFormData({ ...formData, wing: e.target.value })}
                  className="w-full text-xs sm:text-sm p-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white"
                >
                  <option value="Garden Terrace">Garden Terrace</option>
                  <option value="Heritage Hall">Heritage Hall</option>
                  <option value="Magnolia Wing">Magnolia Wing</option>
                  <option value="Meadow Haven">Meadow Haven</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  First Language (Mother Tongue) *
                </label>
                <select
                  value={formData.firstLanguage || 'English'}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className="w-full text-xs sm:text-sm p-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white font-medium"
                >
                  <option value="English">🇺🇸 English</option>
                  <option value="Spanish">🇪🇸 Spanish (Español)</option>
                  <option value="Italian">🇮🇹 Italian (Italiano)</option>
                  <option value="French">🇫🇷 French (Français)</option>
                  <option value="German">🇩🇪 German (Deutsch)</option>
                  <option value="Mandarin">🇨🇳 Mandarin Chinese</option>
                  <option value="Tagalog">🇵🇭 Tagalog</option>
                </select>
                <span className="text-[10px] text-teal-700 mt-0.5 block">
                  Older memories are often most accessible in native tongue.
                </span>
              </div>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Dementia Cognitive Stage</label>
              <select
                value={formData.dementiaStage || 'Moderate Memory Care'}
                onChange={(e) => setFormData({ ...formData, dementiaStage: e.target.value as DementiaStage })}
                className="w-full text-xs sm:text-sm p-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white"
              >
                <option value="Mild Cognitive Impairment">Mild Cognitive Impairment (High verbal fluency)</option>
                <option value="Early-Stage Dementia">Early-Stage Dementia (Occasional disorientation)</option>
                <option value="Moderate Memory Care">Moderate Memory Care (Needs validation & redirection)</option>
                <option value="Advanced Validation Stage">Advanced Validation Stage (Short sensory grounding)</option>
              </select>
            </div>
          </div>

          {/* Section 2: Reminiscence Grounding */}
          <div className="space-y-3 pt-3 border-t border-slate-200">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-teal-700" />
              <span>Reminiscence Therapy Topic & Life Anchors</span>
            </h3>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Primary Reminiscence Topic *
              </label>
              <input
                type="text"
                required
                value={formData.reminiscenceTopic || ''}
                onChange={(e) => setFormData({ ...formData, reminiscenceTopic: e.target.value })}
                placeholder="e.g., Master Baker at Panadería La Esperanza (1962-1995)"
                className="w-full text-xs sm:text-sm p-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                CALL-E uses this topic as the primary warm conversation anchor.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Career & Life Passion</label>
                <input
                  type="text"
                  value={formData.careerBackground || ''}
                  onChange={(e) => setFormData({ ...formData, careerBackground: e.target.value })}
                  placeholder="e.g., Locomotive Engineer for Pennsylvania Railroad"
                  className="w-full text-xs sm:text-sm p-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Childhood Hometown</label>
                <input
                  type="text"
                  value={formData.childhoodHometown || ''}
                  onChange={(e) => setFormData({ ...formData, childhoodHometown: e.target.value })}
                  placeholder="e.g., Guadalajara, Jalisco"
                  className="w-full text-xs sm:text-sm p-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white"
                />
              </div>
            </div>

            {/* Sensory Anchors */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-600 font-semibold">
                  Favorite Sensory Anchors (Aromas, Music, Sounds)
                </label>
                <button
                  type="button"
                  onClick={handleAddAnchor}
                  className="text-teal-700 font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Anchor</span>
                </button>
              </div>

              <div className="space-y-1.5">
                {(formData.favoriteSensoryAnchors || []).map((anchor, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={anchor}
                      onChange={(e) => handleUpdateAnchor(idx, e.target.value)}
                      placeholder="e.g., Warm cinnamon aroma, swing big band jazz, roses"
                      className="flex-1 text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveAnchor(idx)}
                      className="p-2 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Section 3: Validation Therapy & Gentle Redirection Guide */}
          <div className="space-y-3 pt-3 border-t border-slate-200">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>Validation Therapy & Distress Redirection Guide</span>
            </h3>

            {/* Known Anxiety Triggers */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-600 font-semibold">
                  Known Anxiety Triggers & Disorientation Tendencies
                </label>
                <button
                  type="button"
                  onClick={handleAddTrigger}
                  className="text-rose-700 font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Trigger</span>
                </button>
              </div>

              <div className="space-y-1.5">
                {(formData.knownTriggers || []).map((trigger, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={trigger}
                      onChange={(e) => handleUpdateTrigger(idx, e.target.value)}
                      placeholder="e.g., Believes must wake early to open shop, looks for deceased spouse"
                      className="flex-1 text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveTrigger(idx)}
                      className="p-2 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Redirection Strategy Mandate */}
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Gentle Redirection Strategy (Mandate: Never Argue or Correct!)
              </label>
              <textarea
                rows={3}
                value={formData.redirectionStrategy || ''}
                onChange={(e) => setFormData({ ...formData, redirectionStrategy: e.target.value })}
                placeholder="e.g., 'Never argue about the hour or date. Validate her dedication to feeding her community, then ask about her famous holiday conchas recipe.'"
                className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white leading-relaxed"
              />
            </div>
          </div>

          {/* Section 4: Schedule Settings */}
          <div className="space-y-3 pt-3 border-t border-slate-200">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-teal-700" />
              <span>Call Schedule & Timing</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Preferred Call Time Window</label>
                <select
                  value={formData.preferredCallTime || '09:30 AM'}
                  onChange={(e) => setFormData({ ...formData, preferredCallTime: e.target.value })}
                  className="w-full text-xs sm:text-sm p-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white"
                >
                  <option value="09:15 AM">09:15 AM (Morning Awakening)</option>
                  <option value="10:00 AM">10:00 AM (Post-Breakfast)</option>
                  <option value="11:00 AM">11:00 AM (Pre-Lunch)</option>
                  <option value="02:15 PM">02:15 PM (Afternoon Quiet Hour)</option>
                  <option value="04:30 PM">04:30 PM (Sundowning Intercept)</option>
                  <option value="05:30 PM">05:30 PM (Evening Relaxation)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Frequency</label>
                <select
                  value={formData.scheduledFrequency || 'Monday, Wednesday, Friday'}
                  onChange={(e) => setFormData({ ...formData, scheduledFrequency: e.target.value })}
                  className="w-full text-xs sm:text-sm p-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white"
                >
                  <option value="Daily">Daily (7 days/week)</option>
                  <option value="Daily (Sundowning Buffer)">Daily (Sundowning Buffer)</option>
                  <option value="Monday, Wednesday, Friday">Monday, Wednesday, Friday (3x/week)</option>
                  <option value="Tuesday, Thursday, Saturday">Tuesday, Thursday, Saturday (3x/week)</option>
                  <option value="Weekdays">Weekdays Only</option>
                </select>
              </div>
            </div>
          </div>

        </form>

    </ModalShell>
  );
};
