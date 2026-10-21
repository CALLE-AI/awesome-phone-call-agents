'use client';

import { useState } from 'react';
import { proxied, ApiError } from '@/lib/api';
import { listCountries, type BusinessDto } from '@dial/schemas';

/** Business settings: the same fields as onboarding, plus pause/delete. */

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

export function BusinessSettings({
  business,
  onSaved,
}: {
  business: BusinessDto;
  onSaved?: () => void;
}) {
  const [name, setName] = useState(business.name);
  const [industry, setIndustry] = useState<string>(business.industry);
  const [customIndustry, setCustomIndustry] = useState(business.customIndustry ?? '');
  const [timezone, setTimezone] = useState(business.timezone);
  // Country was only settable at creation, so a wrong pick could never be
  // corrected -- and it decides how local numbers are read.
  const [country, setCountry] = useState(business.country ?? '');
  const [locale, setLocale] = useState(business.locale);
  const [phone, setPhone] = useState(business.businessPhone ?? '');
  const [status, setStatus] = useState(business.status);
  // Cleared by the next edit, so the button never claims a pending change
  // has already been saved.
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaved(false);
    try {
      await proxied.updateBusiness(business.id, {
        name,
        industry: industry as never,
        customIndustry: industry === 'other' ? customIndustry.trim() || null : null,
        timezone,
        country: country || null,
        locale,
        businessPhone: phone.trim() || null,
        status,
      });
      setSaved(true);
      onSaved?.();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save settings.');
    }
  }

  async function pause() {
    try {
      await proxied.updateBusiness(business.id, { status: status === 'active' ? 'paused' : 'active' });
      setStatus(status === 'active' ? 'paused' : 'active');
      onSaved?.();
    } catch {
      setError('Could not change the business status.');
    }
  }

  return (
    <div>
      {error ? (
        <div className="notice" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}

      <section className="card">
        <div className="card-label">Details</div>
        <div className="field">
          <label htmlFor="s-name">Business name</label>
          <input id="s-name" value={name} onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }} maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="s-industry">Industry</label>
          <select id="s-industry" value={industry} onChange={(e) => {
              setIndustry(e.target.value);
              setSaved(false);
            }}>
            {INDUSTRIES.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-tz">Timezone</label>
          <select id="s-tz" value={timezone} onChange={(e) => {
              setTimezone(e.target.value);
              setSaved(false);
            }}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        {industry === 'other' ? (
          <div className="field">
            <label htmlFor="s-industry-other">What kind of business is it?</label>
            <input
              id="s-industry-other"
              value={customIndustry}
              onChange={(e) => {
              setCustomIndustry(e.target.value);
              setSaved(false);
            }}
              maxLength={80}
              placeholder="e.g. Bakery, Driving school, Veterinary clinic"
            />
            <p className="field-hint">
              Shown wherever Dial names your industry. It does not change how calls are made.
            </p>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="s-country">Country</label>
          <select id="s-country" value={country} onChange={(e) => {
              setCountry(e.target.value);
              setSaved(false);
            }}>
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
          <label htmlFor="s-locale">Primary language</label>
          <input id="s-locale" value={locale} onChange={(e) => {
              setLocale(e.target.value);
              setSaved(false);
            }} maxLength={20} />
        </div>
        <div className="field">
          <label htmlFor="s-phone">Business phone</label>
          <input id="s-phone" value={phone} onChange={(e) => {
              setPhone(e.target.value);
              setSaved(false);
            }} placeholder="+353…" />
        </div>
        {industry === 'healthcare' ? (
          <p className="field-hint">
            Reminder calls are designed to minimize sensitive data: Dial collects only what the reminder needs
            and never discusses diagnoses or treatment.
          </p>
        ) : null}
        <div className="button-row">
          <button className="button" data-variant="primary" onClick={() => void save()}>
            {saved ? 'Saved' : 'Save settings'}
          </button>
          <button className="button" onClick={() => void pause()}>
            {status === 'active' ? 'Pause all workflows' : 'Resume workflows'}
          </button>
        </div>
      </section>
    </div>
  );
}
