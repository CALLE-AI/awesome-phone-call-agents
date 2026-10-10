import React, { useState, useEffect } from 'react';
import {
  X,
  Phone,
  Plus,
  Trash2,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Package,
} from 'lucide-react';
import {
  ClaimedStatus,
  PhoneTarget,
  QuestionExpectedType,
  VerificationQuestion,
  DigitalClaim,
  SupplyChainType,
} from '../types/index.js';
import { Button } from './ui/Button.js';
import { FormField } from './ui/FormField.js';

interface CreateVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (taskData: {
    target: PhoneTarget;
    item: string;
    verificationType: string;
    subject: string;
    verificationGoal: string;
    questions: VerificationQuestion[];
    digitalClaim?: DigitalClaim;
  }) => Promise<void>;
  isLiveMode: boolean;
}

const SUPPLY_CHAIN_TYPES: SupplyChainType[] = [
  'Inventory / Availability',
  'Supplier Verification',
  'Order Status',
  'Shipment / Delivery Status',
  'Lead Time Verification',
  'Vendor Information / Confirmation',
  'Pricing / Quote Verification',
  'Custom Supply-Chain Check',
];

export const CreateVerificationModal: React.FC<CreateVerificationModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isLiveMode,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Target & Supply Chain Scope
  const [organizationName, setOrganizationName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [item, setItem] = useState('');
  const [verificationType, setVerificationType] = useState<SupplyChainType>('Inventory / Availability');
  const [contactPerson, setContactPerson] = useState('');
  const [address, setAddress] = useState('');

  // Step 2: Subject, Goal & Questions
  const [subject, setSubject] = useState('');
  const [verificationGoal, setVerificationGoal] = useState('');
  const [questions, setQuestions] = useState<VerificationQuestion[]>([
    {
      id: 'q_1',
      order: 1,
      question: 'How many units are physically in stock and ready for same-day dispatch?',
      expectedType: 'number',
      required: true,
    },
  ]);

  // Step 3: Digital Claim
  const [hasDigitalClaim, setHasDigitalClaim] = useState(true);
  const [claimedStatus, setClaimedStatus] = useState<ClaimedStatus>('AVAILABLE');
  const [claimText, setClaimText] = useState('');
  const [expectedQuantity, setExpectedQuantity] = useState<string>('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>('');
  const [expectedLeadTime, setExpectedLeadTime] = useState<string>('');
  const [expectedPrice, setExpectedPrice] = useState<string>('');
  const [sourceUrl, setSourceUrl] = useState('');

  // Step 4: Confirmation
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);

  const resetForm = () => {
    setStep(1);
    setLoading(false);
    setError(null);
    setOrganizationName('');
    setPhoneNumber('');
    setItem('');
    setVerificationType('Inventory / Availability');
    setContactPerson('');
    setAddress('');
    setSubject('');
    setVerificationGoal('');
    setQuestions([
      {
        id: 'q_1',
        order: 1,
        question: 'How many units are physically in stock and ready for same-day dispatch?',
        expectedType: 'number',
        required: true,
      },
    ]);
    setHasDigitalClaim(true);
    setClaimedStatus('AVAILABLE');
    setClaimText('');
    setExpectedQuantity('');
    setExpectedDeliveryDate('');
    setExpectedLeadTime('');
    setExpectedPrice('');
    setSourceUrl('');
    setPhoneConfirmed(false);
  };

  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen]);

  // Auto-generate subject & goal when Item or Verification Type changes if user hasn't heavily customized them
  useEffect(() => {
    if (item.trim()) {
      if (!subject || subject.startsWith('Verification of ') || subject.includes('(')) {
        setSubject(`${item.trim()} — ${verificationType}`);
      }
      if (!verificationGoal || verificationGoal.startsWith('Confirm')) {
        setVerificationGoal(
          `Verify real-world physical availability, lead time, and operational status for ${item.trim()} directly with ${organizationName || 'supplier'}.`
        );
      }
    }
  }, [item, verificationType, organizationName]);

  // Auto-generate questions when verification type changes
  const handleAutoGenerateQuestions = () => {
    const itm = item.trim() || 'the specified item';
    let newQuestions: VerificationQuestion[] = [];

    switch (verificationType) {
      case 'Inventory / Availability':
        newQuestions = [
          {
            id: 'q_1',
            order: 1,
            question: `How many units of ${itm} are physically in stock on the warehouse shelf ready to ship?`,
            expectedType: 'number',
            required: true,
          },
          {
            id: 'q_2',
            order: 2,
            question: 'What is the restock lead time for any backordered quantities?',
            expectedType: 'text',
            required: false,
          },
          {
            id: 'q_3',
            order: 3,
            question: 'Who is the warehouse manager or inventory lead confirming this count?',
            expectedType: 'text',
            required: false,
          },
        ];
        break;
      case 'Shipment / Delivery Status':
        newQuestions = [
          {
            id: 'q_1',
            order: 1,
            question: `Is the order for ${itm} packaged and confirmed for carrier dispatch?`,
            expectedType: 'boolean',
            required: true,
          },
          {
            id: 'q_2',
            order: 2,
            question: 'What is the assigned freight carrier and tracking reference number?',
            expectedType: 'text',
            required: false,
          },
          {
            id: 'q_3',
            order: 3,
            question: 'What is the exact estimated dock arrival date?',
            expectedType: 'text',
            required: false,
          },
        ];
        break;
      case 'Pricing / Quote Verification':
        newQuestions = [
          {
            id: 'q_1',
            order: 1,
            question: `What is the locked-in unit price for ${itm} for the requested order volume?`,
            expectedType: 'text',
            required: true,
          },
          {
            id: 'q_2',
            order: 2,
            question: 'Are there any conditional surcharges, batch QA fees, or expediting fees?',
            expectedType: 'text',
            required: false,
          },
        ];
        break;
      case 'Supplier Verification':
      default:
        newQuestions = [
          {
            id: 'q_1',
            order: 1,
            question: `Has the lot/batch for ${itm} passed internal QA inspection and metallurgical certification?`,
            expectedType: 'boolean',
            required: true,
          },
          {
            id: 'q_2',
            order: 2,
            question: 'Who is the quality assurance contact authorizing release?',
            expectedType: 'text',
            required: false,
          },
        ];
        break;
    }
    setQuestions(newQuestions);
  };

  if (!isOpen) return null;

  const handleAddQuestion = () => {
    const nextOrder = questions.length + 1;
    setQuestions([
      ...questions,
      {
        id: `q_${Date.now()}_${nextOrder}`,
        order: nextOrder,
        question: '',
        expectedType: 'text',
        required: false,
      },
    ]);
  };

  const handleRemoveQuestion = (index: number) => {
    if (questions.length <= 1) return;
    const updated = questions.filter((_, i) => i !== index).map((q, i) => ({ ...q, order: i + 1 }));
    setQuestions(updated);
  };

  const handleQuestionChange = (
    index: number,
    field: keyof VerificationQuestion,
    val: any
  ) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], [field]: val };
    setQuestions(updated);
  };

  // Validation per step
  const validateStep1 = () => {
    if (!organizationName.trim()) {
      setError('Supplier / Entity name is required.');
      return false;
    }
    if (!phoneNumber.trim()) {
      setError('Target supplier phone number is required.');
      return false;
    }
    const cleaned = phoneNumber.trim().replace(/[\s\-\(\)\.]/g, '');
    if (!/^\+?[1-9]\d{6,14}$/.test(cleaned)) {
      setError('Please provide a valid E.164 phone number (e.g. +14155550181).');
      return false;
    }
    if (!item.trim()) {
      setError('Item / Material / Resource name is required.');
      return false;
    }
    setError(null);
    return true;
  };

  const validateStep2 = () => {
    if (!subject.trim()) {
      setError('Verification subject is required.');
      return false;
    }
    if (!verificationGoal.trim()) {
      setError('Verification goal is required.');
      return false;
    }
    for (let i = 0; i < questions.length; i++) {
      if (!questions[i].question.trim()) {
        setError(`Question ${i + 1} cannot be blank.`);
        return false;
      }
    }
    setError(null);
    return true;
  };

  const handleNext = () => {
    setError(null);
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    if (step < 4) {
      setStep((prev) => (prev + 1) as any);
    }
  };

  const handleBack = () => {
    setError(null);
    if (step > 1) {
      setStep((prev) => (prev - 1) as any);
    }
  };

  const handleFinalSubmit = async () => {
    if (!phoneConfirmed) {
      setError('Please check the confirmation box verifying the exact phone number to be called.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onSubmit({
        target: {
          organizationName: organizationName.trim(),
          phoneNumber: phoneNumber.trim(),
          contactPerson: contactPerson.trim() || undefined,
          category: verificationType,
          address: address.trim() || undefined,
        },
        item: item.trim(),
        verificationType,
        subject: subject.trim(),
        verificationGoal: verificationGoal.trim(),
        questions: questions.map((q, idx) => ({
          ...q,
          order: idx + 1,
          question: q.question.trim(),
        })),
        digitalClaim: hasDigitalClaim
          ? {
              claimedStatus,
              claimText: claimText.trim() || `ERP record claimed ${item.trim()} available.`,
              expectedQuantity: expectedQuantity ? Number(expectedQuantity) || expectedQuantity : undefined,
              expectedDeliveryDate: expectedDeliveryDate || undefined,
              expectedLeadTime: expectedLeadTime || undefined,
              expectedPrice: expectedPrice || undefined,
              sourceUrl: sourceUrl.trim() || undefined,
            }
          : undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to initiate verification task.');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyPreset = (presetKey: string) => {
    if (presetKey === 'micro') {
      setOrganizationName('Apex Microelectronics Distribution');
      setPhoneNumber('+14155550181');
      setItem('STM32H743ZI Microcontrollers');
      setVerificationType('Inventory / Availability');
      setContactPerson('Warehouse Inventory Desk');
      setAddress('4200 Technology Parkway, San Jose, CA');
      setSubject('STM32H743ZI Microcontrollers (500 units physical on-shelf count)');
      setVerificationGoal('Verify physical on-shelf inventory count of STM32H743ZI against ERP record of 500 units.');
      setQuestions([
        {
          id: 'q1',
          order: 1,
          question: 'How many units of STM32H743ZI microcontrollers are physically on the shelf ready to ship today?',
          expectedType: 'number',
          required: true,
        },
        {
          id: 'q2',
          order: 2,
          question: 'When can any backordered units be fulfilled?',
          expectedType: 'text',
          required: false,
        },
        {
          id: 'q3',
          order: 3,
          question: 'Who is the warehouse representative confirming this inventory count?',
          expectedType: 'text',
          required: false,
        },
      ]);
      setHasDigitalClaim(true);
      setClaimedStatus('AVAILABLE');
      setClaimText('ERP portal shows 500 units in stock at San Jose warehouse with same-day dispatch.');
      setExpectedQuantity('500');
      setExpectedLeadTime('Same-day dispatch');
      setSourceUrl('https://erp.apexmicro.example.com/inv/STM32H743ZI');
    } else if (presetKey === 'valves') {
      setOrganizationName('Vanguard Industrial Valves');
      setPhoneNumber('+14155550182');
      setItem('2-inch Stainless Ball Valves (ANSI 150)');
      setVerificationType('Shipment / Delivery Status');
      setContactPerson('Dispatch Logistics');
      setAddress('880 Industrial Way, Houston, TX');
      setSubject('PO-8821 Rush Shipment Dispatch Confirmation (40 units)');
      setVerificationGoal('Confirm whether 40 stainless ball valves for PO-8821 are packed and scheduled for carrier pickup on Oct 14.');
      setQuestions([
        {
          id: 'q1',
          order: 1,
          question: 'Is PO-8821 (40 stainless ball valves) packed and confirmed for dispatch on Oct 14?',
          expectedType: 'boolean',
          required: true,
        },
        {
          id: 'q2',
          order: 2,
          question: 'What is the assigned freight carrier and tracking reference?',
          expectedType: 'text',
          required: false,
        },
      ]);
      setHasDigitalClaim(true);
      setClaimedStatus('AVAILABLE');
      setClaimText('Vendor dispatch notice states 40 units packaged, shipping Oct 14 via FreightDirect.');
      setExpectedQuantity('40');
      setExpectedDeliveryDate('2026-10-14');
      setExpectedLeadTime('Expedited freight (1 day)');
      setSourceUrl('https://vanguardvalves.example.com/orders/PO-8821');
    } else if (presetKey === 'resin') {
      setOrganizationName('Solventix Polymers Corp');
      setPhoneNumber('+14155550184');
      setItem('Medical-Grade PEEK Polymer Resin (Lot 44)');
      setVerificationType('Pricing / Quote Verification');
      setContactPerson('Commercial Pricing & Sales');
      setAddress('1200 Chemical Way, Baton Rouge, LA');
      setSubject('PEEK Resin Volume Quote ($142/kg) & Immediate Release');
      setVerificationGoal('Verify volume quote of $142/kg for 500kg order and confirm immediate batch QA release.');
      setQuestions([
        {
          id: 'q1',
          order: 1,
          question: 'Is the unit price of $142/kg locked in for a 500kg order?',
          expectedType: 'boolean',
          required: true,
        },
        {
          id: 'q2',
          order: 2,
          question: 'Is Lot 44 cleared for immediate dispatch without pending audit holds?',
          expectedType: 'boolean',
          required: true,
        },
      ]);
      setHasDigitalClaim(true);
      setClaimedStatus('AVAILABLE');
      setClaimText('Digital quotation portal lists $142/kg with instant batch release.');
      setExpectedPrice('$142/kg');
      setExpectedQuantity('500');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-slate-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center p-1.5 bg-blue-50 border border-blue-100 text-blue-600 rounded-lg">
                <Package className="w-5 h-5" />
              </span>
              <h2 className="text-base font-bold text-slate-900">
                New Supply-Chain Verification
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Step {step} of 4 —{' '}
              {step === 1 && 'Supplier & Scope'}
              {step === 2 && 'Goal & Dynamic Questions'}
              {step === 3 && 'Digital Claim & Reconciliation Baseline'}
              {step === 4 && 'Review & Exact Phone Dispatch'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-100 h-1">
          <div
            className="bg-blue-600 h-1 transition-all duration-300"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>

        {/* Error Callout */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-xs text-rose-800">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4 text-sm bg-white">
          {/* STEP 1: SUPPLIER & SCOPE */}
          {step === 1 && (
            <div className="space-y-4">
              {/* Quick Template Presets */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
                <div className="text-xs">
                  <span className="font-semibold text-slate-800 block">Supply-Chain Presets:</span>
                  <span className="text-slate-500 text-[11px]">Auto-fill benchmark test cases</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('micro')}
                    className="px-2.5 py-1 text-[11px] font-medium bg-white hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 text-slate-700 border border-slate-200 rounded-lg shadow-xs transition-colors"
                  >
                    Microcontrollers
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('valves')}
                    className="px-2.5 py-1 text-[11px] font-medium bg-white hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 text-slate-700 border border-slate-200 rounded-lg shadow-xs transition-colors"
                  >
                    Valves Dispatch
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('resin')}
                    className="px-2.5 py-1 text-[11px] font-medium bg-white hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 text-slate-700 border border-slate-200 rounded-lg shadow-xs transition-colors"
                  >
                    Polymer Quote
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  label="Supplier / Entity Name"
                  required
                  placeholder="e.g. Apex Microelectronics Distribution"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                />
                <FormField
                  label="Target Phone Number (E.164)"
                  required
                  placeholder="e.g. +14155550181"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  hint="Strict guarantee: TRACE will call this exact recipient number."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  label="Item / Material / Resource"
                  required
                  placeholder="e.g. STM32H743ZI Microcontrollers"
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
                  hint="The physical component, raw material, or assembly to audit."
                />
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Verification Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={verificationType}
                    onChange={(e) => setVerificationType(e.target.value as SupplyChainType)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {SUPPLY_CHAIN_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  label="Contact Person / Department (Optional)"
                  placeholder="e.g. Warehouse Inventory Desk, Sales Lead"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                />
                <FormField
                  label="Facility / Warehouse Location (Optional)"
                  placeholder="e.g. 4200 Technology Parkway, San Jose, CA"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* STEP 2: GOAL & QUESTIONS */}
          {step === 2 && (
            <div className="space-y-4">
              <FormField
                label="Verification Subject"
                required
                placeholder="e.g. STM32H743ZI Microcontrollers (500 units on-shelf count)"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />

              <FormField
                label="Verification Goal for CALL-E"
                required
                placeholder="e.g. Verify physical on-shelf inventory count of STM32H743ZI microcontrollers against the ERP claim of 500 units."
                value={verificationGoal}
                onChange={(e) => setVerificationGoal(e.target.value)}
                hint="High-level operational objective given to the autonomous voice agent."
              />

              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Dynamic Questions ({questions.length})
                    </label>
                    <button
                      type="button"
                      onClick={handleAutoGenerateQuestions}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-700 hover:text-purple-800 px-2 py-0.5 rounded-lg bg-purple-50 border border-purple-200 transition-colors"
                    >
                      <Sparkles className="w-3 h-3 text-purple-600" /> Auto-Derive for {verificationType}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddQuestion}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Question
                  </button>
                </div>

                <div className="space-y-3">
                  {questions.map((q, idx) => (
                    <div
                      key={q.id}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          Question #{idx + 1}
                        </span>
                        {questions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveQuestion(idx)}
                            className="text-slate-400 hover:text-rose-600 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="sm:col-span-2">
                          <input
                            type="text"
                            placeholder="e.g. How many units are physically ready to ship?"
                            value={q.question}
                            onChange={(e) => handleQuestionChange(idx, 'question', e.target.value)}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <select
                            value={q.expectedType}
                            onChange={(e) =>
                              handleQuestionChange(idx, 'expectedType', e.target.value as QuestionExpectedType)
                            }
                            className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="number">Numeric Count</option>
                            <option value="text">Text / Details</option>
                            <option value="boolean">Yes / No (Boolean)</option>
                            <option value="choice">Predefined Choice</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: DIGITAL CLAIM */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Reconcile Against Digital / ERP Claim?</h4>
                    <p className="text-xs text-slate-500">
                      Enable to compare phone reality against recorded catalog quantity, lead time, or quote.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={hasDigitalClaim}
                    onChange={(e) => setHasDigitalClaim(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 bg-white focus:ring-blue-500"
                  />
                </div>

                {hasDigitalClaim && (
                  <div className="pt-3 border-t border-slate-200 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Claimed Digital Status
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['AVAILABLE', 'UNAVAILABLE', 'RESTRICTED'] as ClaimedStatus[]).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setClaimedStatus(st)}
                            className={`py-2 px-3 text-xs font-semibold rounded-lg border text-center transition-all ${
                              claimedStatus === st
                                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>

                    <FormField
                      label="Claim Description / System Record"
                      required
                      placeholder="e.g. ERP shows 500 units in stock with same-day dispatch."
                      value={claimText}
                      onChange={(e) => setClaimText(e.target.value)}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <FormField
                        label="Expected Quantity"
                        placeholder="e.g. 500"
                        value={expectedQuantity}
                        onChange={(e) => setExpectedQuantity(e.target.value)}
                      />
                      <FormField
                        label="Expected Delivery Date"
                        placeholder="e.g. 2026-10-14"
                        value={expectedDeliveryDate}
                        onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <FormField
                        label="Expected Lead Time"
                        placeholder="e.g. Same-day or 2 business days"
                        value={expectedLeadTime}
                        onChange={(e) => setExpectedLeadTime(e.target.value)}
                      />
                      <FormField
                        label="Expected Unit Price / Quote"
                        placeholder="e.g. $142/kg or $4.50/unit"
                        value={expectedPrice}
                        onChange={(e) => setExpectedPrice(e.target.value)}
                      />
                    </div>

                    <FormField
                      label="Source URL (Optional)"
                      placeholder="e.g. https://erp.supplier.example.com/inv/item-123"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                    />
                  </div>
                )}

                {!hasDigitalClaim && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                    <span className="font-semibold">Direct Phone Inquiry Mode:</span> TRACE will audit the supplier and extract structured facts directly without comparing to a digital baseline.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: REVIEW & CONFIRM */}
          {step === 4 && (
            <div className="space-y-4">
              {/* Exact Phone Confirmation Box */}
              <div className="p-4 bg-blue-50/70 border-2 border-blue-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                    <Phone className="w-4 h-4 text-blue-600" />
                    Exact Recipient Dialing Target
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-blue-100 text-blue-800 border border-blue-200">
                    E.164 Verified
                  </span>
                </div>
                <div className="text-xl font-bold text-slate-900 font-mono tracking-wide">
                  {phoneNumber}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  CALL-E will dial this exact number directly to reach <span className="font-semibold text-slate-900">{organizationName}</span> for <span className="font-semibold text-slate-900">{item}</span>.
                </p>

                {/* Mandatory Confirmation Checkbox */}
                <label className="flex items-center gap-2.5 pt-2 border-t border-blue-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={phoneConfirmed}
                    onChange={(e) => setPhoneConfirmed(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 bg-white focus:ring-blue-500"
                  />
                  <span className="text-xs font-semibold text-slate-800">
                    I confirm this is the exact supplier phone number to be dialed by CALL-E.
                  </span>
                </label>
              </div>

              {/* Task Summary Details */}
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs bg-slate-50">
                <div className="p-3 flex justify-between">
                  <span className="text-slate-500 font-medium">Item / Material</span>
                  <span className="text-slate-900 font-semibold">{item}</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-slate-500 font-medium">Verification Type</span>
                  <span className="text-slate-900 font-semibold">{verificationType}</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-slate-500 font-medium">Goal</span>
                  <span className="text-slate-700 text-right max-w-xs">{verificationGoal}</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-slate-500 font-medium">Questions</span>
                  <span className="text-slate-800 font-medium">{questions.length} questions configured</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-slate-500 font-medium">Digital Claim</span>
                  <span className="text-slate-800 font-medium">
                    {hasDigitalClaim ? `${claimedStatus} (${claimText})` : 'None (Direct Inquiry)'}
                  </span>
                </div>
                <div className="p-3 flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Active Telephony Engine</span>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-semibold text-[11px] ${
                      isLiveMode
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {isLiveMode ? '● LIVE CALL-E' : '● MOCK DEMO'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            {step > 1 ? (
              <Button variant="outline" size="sm" onClick={handleBack} disabled={loading}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
            )}
          </div>

          <div>
            {step < 4 ? (
              <Button size="sm" onClick={handleNext}>
                Next <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleFinalSubmit}
                disabled={loading || !phoneConfirmed}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold shadow-xs"
              >
                {loading ? 'Dispatching CALL-E...' : 'Start Verification'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
