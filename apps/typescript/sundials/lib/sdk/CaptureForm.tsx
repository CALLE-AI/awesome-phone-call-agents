"use client";

import { useState, type FormEvent } from "react";
import type { ConciergeCta } from "@/lib/types";

const COUNTRY_CODES = [
  { code: "+1", label: "+1 US/CA" },
  { code: "+65", label: "+65 SG" },
  { code: "+44", label: "+44 UK" },
  { code: "+61", label: "+61 AU" },
  { code: "+49", label: "+49 DE" },
  { code: "+81", label: "+81 JP" }
];

export interface CapturePayload {
  email: string;
  phone: string;
  name?: string;
  company?: string;
  companySize?: string;
  useCase?: string;
}

export function CaptureForm({
  brandName,
  formCta,
  variant = "full",
  sending,
  error,
  submitted,
  onSubmit
}: {
  brandName: string;
  formCta: ConciergeCta;
  variant?: "full" | "compact";
  sending: boolean;
  error: string | null;
  submitted: boolean;
  onSubmit: (payload: CapturePayload) => Promise<void> | void;
}) {
  const [selectedCountry, setSelectedCountry] = useState("+1");
  const [localNumber, setLocalNumber] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [useCase, setUseCase] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      email: email.trim(),
      phone: `${selectedCountry}${localNumber.replace(/[^0-9]/g, "")}`,
      name: name.trim() || undefined,
      company: company.trim() || undefined,
      companySize: companySize.trim() || undefined,
      useCase: useCase.trim() || undefined
    });
  };

  if (submitted) {
    return (
      <div className="sdw-thanks">
        <p>
          <strong>Thank you.</strong>
        </p>
        <p>{brandName} has your details.</p>
      </div>
    );
  }

  return (
    <form className="sdw-form" onSubmit={handleSubmit} aria-busy={sending}>
      <fieldset disabled={sending} className="sdw-form" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="sdw-field">
          <label htmlFor={`sdw-email-${formCta}`}>Work email</label>
          <input
            id={`sdw-email-${formCta}`}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="sdw-field">
          <label htmlFor={`sdw-phone-${formCta}`}>Phone</label>
          <div className="sdw-phone">
            <select value={selectedCountry} onChange={(e) => setSelectedCountry(e.target.value)} aria-label="Country code">
              {COUNTRY_CODES.map((code) => (
                <option key={code.code} value={code.code}>
                  {code.label}
                </option>
              ))}
            </select>
            <input
              id={`sdw-phone-${formCta}`}
              type="tel"
              required
              autoComplete="tel-national"
              value={localNumber}
              onChange={(e) => setLocalNumber(e.target.value)}
            />
          </div>
        </div>
        {variant === "full" ? (
          <div className="sdw-field">
            <label htmlFor={`sdw-company-${formCta}`}>Company</label>
            <input
              id={`sdw-company-${formCta}`}
              type="text"
              required
              autoComplete="organization"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
        ) : null}
        <div className="sdw-field">
          <label htmlFor={`sdw-name-${formCta}`}>
            Name <span>(optional)</span>
          </label>
          <input
            id={`sdw-name-${formCta}`}
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {variant === "full" ? (
          <>
            <div className="sdw-field">
              <label htmlFor={`sdw-size-${formCta}`}>
                Company size <span>(optional)</span>
              </label>
              <input
                id={`sdw-size-${formCta}`}
                type="text"
                placeholder="e.g. 50–200"
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
              />
            </div>
            <div className="sdw-field">
              <label htmlFor={`sdw-use-${formCta}`}>
                Use case <span>(optional)</span>
              </label>
              <input
                id={`sdw-use-${formCta}`}
                type="text"
                placeholder="e.g. inbound routing"
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
              />
            </div>
          </>
        ) : null}
        {error ? <p className="sdw-error">{error}</p> : null}
        <button className="sdw-btn sdw-btn-primary sdw-btn-full" type="submit" disabled={sending}>
          {sending ? <span className="sdw-spin" aria-hidden /> : null}
          {sending ? "Sending details…" : "Send details"}
        </button>
        <p className="sdw-fineprint">
          By sending, you agree {brandName} may contact you at this email and phone number.
        </p>
      </fieldset>
    </form>
  );
}
