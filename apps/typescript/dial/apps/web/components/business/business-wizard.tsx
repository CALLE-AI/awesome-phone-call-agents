'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { proxied, ApiError } from '@/lib/api';
import { listCountries } from '@dial/schemas';

/**
 * Business onboarding: details first, then pick what CALL-E should do. The
 * chosen template becomes the business's first workflow immediately -- no
 * JSON, no schema internals.
 */

const INDUSTRIES = [
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'restaurant', label: 'Restaurant / Hospitality' },
  { value: 'home_services', label: 'Home Services' },
  { value: 'professional_services', label: 'Professional Services' },
  { value: 'beauty_wellness', label: 'Beauty / Wellness' },
  { value: 'automotive', label: 'Automotive' },
  { value: 'retail', label: 'Retail' },
  { value: 'other', label: 'Other' },
];

/**
 * Built from ICU names plus a generated dialling-code table, so the label
 * carries the +971-style code the owner recognises while the STORED value
 * stays the ISO region code phone parsing needs.
 */
const COUNTRIES = listCountries();

const TIMEZONES = [
  'UTC',
  'Europe/Dublin',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Riyadh',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
];

const TEMPLATE_CHOICES = [
  {
    id: 'appointment_reminder',
    label: 'Appointment reminders',
    description: 'Call customers before an appointment and confirm, cancel, or offer a reschedule.',
  },
  {
    id: 'lead_callback',
    label: 'Customer callbacks',
    description: 'Call a lead, gauge interest, and agree a time for you to call back or visit.',
  },
  {
    id: 'general_followup',
    label: 'Custom phone job',
    description: 'Describe the goal in your own words. Dial returns a structured outcome for every call.',
  },
];

export function BusinessWizard() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('other');
  const [customIndustry, setCustomIndustry] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [country, setCountry] = useState('');
  const [locale, setLocale] = useState('en');
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');

  const [template, setTemplate] = useState('appointment_reminder');
  const [workflowName, setWorkflowName] = useState('');
  const [goal, setGoal] = useState('');
  const [businessId, setBusinessId] = useState<string | null>(null);

  async function createBusiness() {
    setBusy(true);
    setError(null);
    try {
      const business = await proxied.createBusiness({
        name,
        industry: industry as never,
        customIndustry: industry === 'other' ? customIndustry.trim() || null : null,
        timezone,
        country: country || null,
        locale,
        address: address.trim() || null,
        website: website.trim() || null,
        businessPhone: phone.trim() || null,
        hours: null,
      });
      setBusinessId(business.id);
      setStep(2);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the business.');
    } finally {
      setBusy(false);
    }
  }

  async function createWorkflow() {
    if (!businessId) return;
    setBusy(true);
    setError(null);
    try {
      const workflow = await proxied.createWorkflow(businessId, {
        name: workflowName.trim() || TEMPLATE_CHOICES.find((t) => t.id === template)!.label,
        template,
        goal: template === 'general_followup' ? goal.trim() : null,
      });
      router.push(`/business/${businessId}/workflows/${workflow.id}/run`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the workflow.');
      setBusy(false);
    }
  }

  return (
    <div className="task-body">
      <header className="page-header">
        <h1 className="page-title">{step === 1 ? 'Create a business' : 'What should CALL-E do?'}</h1>
        <p className="page-subtitle">
          {step === 1
            ? 'Dial uses this to introduce itself, respect your calling hours, and recommend templates.'
            : 'Pick a starting point. You can rename it and add more workflows any time.'}
        </p>
      </header>

      {error ? (
        <div className="notice" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <section className="card">
          <div className="field">
            <label htmlFor="biz-name">Business name</label>
            <input id="biz-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Acme Dental" />
          </div>
          <div className="field">
            <label htmlFor="biz-industry">Industry</label>
            <select id="biz-industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
              {INDUSTRIES.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>

          {/*
            "Other" on its own is a dead end -- it records that the list did
            not fit and nothing about what the business actually is. Asking
            here costs one field and gives every screen a real label to show.
          */}
          {industry === 'other' ? (
            <div className="field">
              <label htmlFor="biz-industry-other">What kind of business is it?</label>
              <input
                id="biz-industry-other"
                value={customIndustry}
                onChange={(e) => setCustomIndustry(e.target.value)}
                maxLength={80}
                placeholder="e.g. Bakery, Driving school, Veterinary clinic"
              />
              <p className="field-hint">
                Shown wherever Dial names your industry. It does not change how calls are made.
              </p>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="biz-tz">Timezone</label>
            <select id="biz-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="biz-country">Country</label>
              <select id="biz-country" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">Select a country…</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} (+{c.dialCode})
                  </option>
                ))}
              </select>
              <p className="field-hint">
                Lets Dial read local numbers like 055 123 4567 as full international numbers.
              </p>
            </div>
            <div className="field">
              <label htmlFor="biz-locale">Primary language</label>
              <input id="biz-locale" value={locale} onChange={(e) => setLocale(e.target.value)} maxLength={20} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="biz-phone">Business phone (optional)</label>
            <input id="biz-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+353…" />
          </div>
          <div className="field">
            <label htmlFor="biz-address">Address (optional)</label>
            <input id="biz-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="biz-website">Website (optional)</label>
            <input id="biz-website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div className="button-row">
            <button className="button" data-variant="primary" disabled={!name.trim() || busy} onClick={() => void createBusiness()}>
              {busy ? 'Creating…' : 'Continue'}
            </button>
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="business-template-grid">
            {TEMPLATE_CHOICES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className="business-template-card card"
                data-selected={template === choice.id || undefined}
                aria-pressed={template === choice.id}
                onClick={() => setTemplate(choice.id)}
                style={{ textAlign: 'left', cursor: 'pointer' }}
              >
                <div className="card-label">{choice.label}</div>
                <p className="business-card-meta">{choice.description}</p>
              </button>
            ))}
          </div>

          <div className="field">
            <label htmlFor="wf-name">Workflow name</label>
            <input
              id="wf-name"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder={TEMPLATE_CHOICES.find((t) => t.id === template)!.label}
            />
          </div>

          {template === 'general_followup' ? (
            <div className="field">
              <label htmlFor="wf-goal">What should the call achieve?</label>
              <textarea
                id="wf-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="e.g. Check whether the customer is happy with the repair and ask if anything else is needed."
              />
            </div>
          ) : null}

          <div className="button-row">
            <button className="button" disabled={busy} onClick={() => setStep(1)}>
              Back
            </button>
            <button
              className="button"
              data-variant="primary"
              disabled={busy || (template === 'general_followup' && goal.trim().length < 3)}
              onClick={() => void createWorkflow()}
            >
              {busy ? 'Creating…' : 'Create workflow'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
