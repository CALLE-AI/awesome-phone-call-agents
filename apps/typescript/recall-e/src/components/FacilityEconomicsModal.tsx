import React, { useState } from 'react';
import {
  DollarSign,
  Clock,
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  FileCheck
} from 'lucide-react';
import { FacilityStats } from '../types';
import { ModalShell } from './ui/ModalShell';

interface FacilityEconomicsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: FacilityStats;
}

export const FacilityEconomicsModal: React.FC<FacilityEconomicsModalProps> = ({
  isOpen,
  onClose,
  stats,
}) => {
  const [residentCount, setResidentCount] = useState<number>(stats.enrolledResidents || 38);
  const [subscriptionRate, setSubscriptionRate] = useState<number>(stats.subscriptionPricePerResident || 59);
  const [hourlyWage, setHourlyWage] = useState<number>(stats.caregiverHourlyRate || 26);
  const sessionsPerMonth = 16; // ~4 calls/week

  if (!isOpen) return null;

  // Time spent by staff doing manual 1-on-1 reminiscence therapy (scheduling, prompting, sitting, and writing EHR logs)
  const staffHoursPerResidentPerMonth = (sessionsPerMonth * 45) / 60; // 45 mins total per session with documentation = 12 hrs/resident/mo
  const totalHoursSavedMonth = Math.round(residentCount * staffHoursPerResidentPerMonth);
  const totalMonthlyCost = Math.round(residentCount * subscriptionRate);
  const staffPayrollValueReplaced = Math.round(totalHoursSavedMonth * hourlyWage);
  const netMonthlySavings = Math.max(0, staffPayrollValueReplaced - totalMonthlyCost);
  const roiPercentage = Math.round((netMonthlySavings / Math.max(1, totalMonthlyCost)) * 100);

  return (
    <ModalShell
      onClose={onClose}
      maxWidthClassName="max-w-4xl"
      icon={<DollarSign className="w-5 h-5" />}
      iconClassName="bg-amber-500/20 border-amber-500/30 text-amber-400"
      title="RECALL-E Facility Economics & ROI Calculator"
      titleBadge={
        <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-400 text-slate-950 px-2 py-0.5 rounded">
          B2B Subscription
        </span>
      }
      subtitle="Sold as a per-resident monthly subscription to facilities (replacing staff labor), not families"
      footer={
        <>
          <span>Enterprise Memory Care Contract • Single Facility License</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold hover:bg-teal-800 transition cursor-pointer"
          >
            Done
          </button>
        </>
      }
    >
          {/* Business Model Thesis Card */}
          <div className="bg-gradient-to-r from-teal-900 to-slate-900 text-white rounded-xl p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <Sparkles className="w-6 h-6 text-amber-300 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  The Core B2B Value Proposition
                </h3>
                <p className="text-xs sm:text-sm text-slate-200 mt-1.5 leading-relaxed">
                  Memory care facilities already mandate 1-on-1 reminiscence therapy for cognitive health and state licensing compliance, but lack CNA staff hours to execute it consistently. 
                  <strong> RECALL-E is not a consumer app billed to families</strong>; it is an enterprise operational tool paid directly from the facility's existing activities & nursing staffing budget.
                </p>

                <div className="mt-3 pt-3 border-t border-slate-700/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="flex items-center gap-2 text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>No cost to resident families</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Replaces CNA/Activities hours</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Automates state audit logs</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive ROI Calculator */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-teal-700" />
              <span>Interactive Facility Labor & Savings Calculator</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              
              {/* Resident Count Slider */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex justify-between items-center text-xs text-slate-600 font-semibold mb-1">
                  <span>Enrolled Residents</span>
                  <span className="text-teal-700 text-sm font-bold">{residentCount} beds</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="120"
                  value={residentCount}
                  onChange={(e) => setResidentCount(Number(e.target.value))}
                  className="w-full accent-teal-600 cursor-pointer"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">Facility memory care census</span>
              </div>

              {/* Subscription Cost Slider */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex justify-between items-center text-xs text-slate-600 font-semibold mb-1">
                  <span>Subscription / Resident / Mo</span>
                  <span className="text-teal-700 text-sm font-bold">${subscriptionRate} / mo</span>
                </div>
                <input
                  type="range"
                  min="39"
                  max="89"
                  step="5"
                  value={subscriptionRate}
                  onChange={(e) => setSubscriptionRate(Number(e.target.value))}
                  className="w-full accent-teal-600 cursor-pointer"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">Flat monthly B2B rate</span>
              </div>

              {/* CNA Hourly Wage */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex justify-between items-center text-xs text-slate-600 font-semibold mb-1">
                  <span>Staff Hourly Rate (Loaded)</span>
                  <span className="text-teal-700 text-sm font-bold">${hourlyWage} / hr</span>
                </div>
                <input
                  type="range"
                  min="18"
                  max="45"
                  value={hourlyWage}
                  onChange={(e) => setHourlyWage(Number(e.target.value))}
                  className="w-full accent-teal-600 cursor-pointer"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">Includes benefits & payroll taxes</span>
              </div>

            </div>

            {/* Financial Results Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-teal-200">
              
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Facility Monthly Cost</div>
                <div className="text-xl font-bold text-slate-900 mt-1">${totalMonthlyCost.toLocaleString()}</div>
                <div className="text-[11px] text-slate-400">At ${subscriptionRate}/res/mo</div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Staff Hours Replaced</div>
                <div className="text-xl font-bold text-teal-700 mt-1">{totalHoursSavedMonth} hrs</div>
                <div className="text-[11px] text-slate-400">Per month saved</div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Staff Payroll Value</div>
                <div className="text-xl font-bold text-slate-900 mt-1">${staffPayrollValueReplaced.toLocaleString()}</div>
                <div className="text-[11px] text-slate-400">Equivalent wage value</div>
              </div>

              <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                <div className="text-[11px] font-semibold text-emerald-800 uppercase">Net Monthly Savings</div>
                <div className="text-xl font-bold text-emerald-700 mt-1">${netMonthlySavings.toLocaleString()}</div>
                <div className="text-[11px] text-emerald-600 font-semibold">{roiPercentage}% Net ROI</div>
              </div>

            </div>
          </div>

          {/* Three Key Pillars for Facility Administrators */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
              <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </div>
              <h5 className="font-bold text-xs text-slate-900 uppercase tracking-wider">
                1. Alleviating Caregiver Burnout
              </h5>
              <p className="text-xs text-slate-600 leading-relaxed">
                CNAs spend 85% of their shift on physical ADLs (toileting, bathing, transfers). CALL-E handles the emotional and cognitive stimulation without taking staff away from direct hands-on nursing.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <h5 className="font-bold text-xs text-slate-900 uppercase tracking-wider">
                2. Sundowning Crisis Reduction
              </h5>
              <p className="text-xs text-slate-600 leading-relaxed">
                Calls scheduled at 4:30 PM–6:00 PM intercept evening agitation early. Validating memories of past family and careers soothes residents, slashing evening wander alarms and PRN sedative medication usage.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center">
                <FileCheck className="w-4 h-4" />
              </div>
              <h5 className="font-bold text-xs text-slate-900 uppercase tracking-wider">
                3. Turnkey State Audit Compliance
              </h5>
              <p className="text-xs text-slate-600 leading-relaxed">
                State Departments of Health inspect memory care facilities for personalized dementia activity documentation. RECALL-E logs date, duration, topic, mood, and clinical summaries ready for state surveyor inspections.
              </p>
            </div>

          </div>

    </ModalShell>
  );
};
