import { useRef, useState, type FormEvent } from "react";
import type { TransportRequestForm } from "../../types/transport";
import "./NewReadinessCheckPage.css";

const E164_PATTERN = /^\+1\d{10}$/;

function getNationalUsDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  const hasDisplayedCountryCode = value.trim().startsWith("+1");
  const national = hasDisplayedCountryCode
    ? digits.slice(1)
    : digits.length > 10 && digits.startsWith("1")
      ? digits.slice(1)
      : digits;
  return national.slice(0, 10);
}

function normalizeUsPhone(value: string) {
  const national = getNationalUsDigits(value);
  return national.length ? `+1${national}` : "";
}

function formatUsPhone(value: string) {
  const national = value.startsWith("+1")
    ? value.slice(2).replace(/\D/g, "").slice(0, 10)
    : getNationalUsDigits(value);
  if (!national.length) return "";
  if (national.length <= 3) return `+1 (${national}`;
  if (national.length <= 6) return `+1 (${national.slice(0, 3)}) ${national.slice(3)}`;
  return `+1 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6, 10)}`;
}

export function NewReadinessCheckPage({ initial, onSubmitRequest, onCancel }: { initial: TransportRequestForm; onSubmitRequest: (data: TransportRequestForm) => void; onCancel: () => void }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const consentRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const update = <K extends keyof TransportRequestForm>(key: K, value: TransportRequestForm[K]) => setData((current) => ({ ...current, [key]: value }));
  const customer = (key: "fullName" | "phone" | "email", value: string) => update("customer", { ...data.customer, [key]: value });
  const vehicle = (key: "year" | "make" | "model", value: string) => update("vehicle", { ...data.vehicle, [key]: value });
  const place = (kind: "pickup" | "delivery", key: string, value: unknown) => update(kind, { ...data[kind], [key]: value } as TransportRequestForm[typeof kind]);
  const alternate = (kind: "pickup" | "delivery", key: string, value: string | boolean) => {
    const existing = data[kind].alternateContact ?? { fullName: "", phone: "", relationship: "", authorized: false };
    place(kind, "alternateContact", { ...existing, [key]: value });
  };
  const required = [data.customer.fullName, data.customer.phone, data.customer.email, data.vehicle.year, data.vehicle.make, data.vehicle.model, data.pickup.address, data.pickup.preferredWindow, data.delivery.address, data.delivery.preferredWindow];
  function submit(event: FormEvent) {
    event.preventDefault();
    if (required.some((value) => !value) || !data.consentToContact) {
      setError("Complete all required transport details and confirm contact consent.");
      if (!data.consentToContact) consentRef.current?.focus();
      return;
    }
    if (!E164_PATTERN.test(data.customer.phone.trim())) {
      setError("Enter a valid 10-digit US phone number.");
      phoneRef.current?.focus();
      return;
    }
    setError("");
    onSubmitRequest(data);
  }
  const ContactFields = ({ kind }: { kind: "pickup" | "delivery" }) => data[kind].presence === "alternate" ? <div className="form-grid alternate-fields"><label>Authorized {kind} contact name<input value={data[kind].alternateContact?.fullName ?? ""} onChange={(e) => alternate(kind, "fullName", e.target.value)} required /></label><label>Mobile phone<input type="tel" value={data[kind].alternateContact?.phone ?? ""} onChange={(e) => alternate(kind, "phone", e.target.value)} required /></label><label>Relationship / role (optional)<input value={data[kind].alternateContact?.relationship ?? ""} onChange={(e) => alternate(kind, "relationship", e.target.value)} /></label><label className="consent"><input type="checkbox" checked={data[kind].alternateContact?.authorized ?? false} onChange={(e) => alternate(kind, "authorized", e.target.checked)} /> I confirm this person is authorized to {kind === "pickup" ? "release" : "receive"} the vehicle.</label>{!data[kind].alternateContact?.authorized && <p className="alternate-warning">Alternate contact provided — authorization pending. This person will not be treated as authorized.</p>}</div> : null;
  return <main className="page form-page"><p className="eyebrow">Vehicle transport request</p><h1>Tell us about your transport.</h1><p className="page-intro">Submit your vehicle, route, preferred transport windows, and contact details. A coordinator will review your request and contact you before driver dispatch.</p>{error && <div className="form-error" role="alert">{error}</div>}<form onSubmit={submit} noValidate>
    <section><p className="section-label">Your contact information</p><div className="form-grid"><label>Full name<input value={data.customer.fullName} onChange={(e) => customer("fullName", e.target.value)} required /></label><label>Phone<input ref={phoneRef} type="tel" inputMode="tel" autoComplete="tel" placeholder="+1 (123) 456-7890" value={formatUsPhone(data.customer.phone)} onChange={(e) => customer("phone", normalizeUsPhone(e.target.value))} required /><small>Enter a 10-digit US number.</small></label><label>Email<input type="email" value={data.customer.email} onChange={(e) => customer("email", e.target.value)} required /></label></div></section>
    <section><p className="section-label">Vehicle</p><div className="form-grid"><label>Year<input inputMode="numeric" value={data.vehicle.year} onChange={(e) => vehicle("year", e.target.value)} required /></label><label>Make<input value={data.vehicle.make} onChange={(e) => vehicle("make", e.target.value)} required /></label><label>Model<input value={data.vehicle.model} onChange={(e) => vehicle("model", e.target.value)} required /></label></div></section>
    {(["pickup", "delivery"] as const).map((kind) => <section key={kind}><p className="section-label">{kind}</p><div className="form-grid"><label>{kind} address<input value={data[kind].address} onChange={(e) => place(kind, "address", e.target.value)} required /></label><label>Preferred {kind} window<input value={data[kind].preferredWindow} onChange={(e) => place(kind, "preferredWindow", e.target.value)} required /></label></div><fieldset><legend>Who will be present?</legend><label><input type="radio" checked={data[kind].presence === "customer"} onChange={() => place(kind, "presence", "customer")} /> I will be present</label><label><input type="radio" checked={data[kind].presence === "alternate"} onChange={() => place(kind, "presence", "alternate")} /> Someone else will be present</label></fieldset>{kind === "delivery" && data.pickup.alternateContact && <label className="consent"><input type="checkbox" checked={data.delivery.usePickupAlternate} onChange={(e) => place("delivery", "usePickupAlternate", e.target.checked)} /> Use the pickup alternate contact for delivery</label>}<ContactFields kind={kind} /></section>)}
    <section><p className="section-label">Additional details</p><label>Special instructions<textarea rows={4} value={data.specialInstructions} onChange={(e) => update("specialInstructions", e.target.value)} /></label><div className="prototype-notice">Do not enter payment-card information here. Payment details are handled separately through a secure channel.</div></section>
    <label className="consent"><input ref={consentRef} type="checkbox" checked={data.consentToContact} onChange={(e) => update("consentToContact", e.target.checked)} /> I consent to service-related calls, texts, and email about this transport request.</label><div className="form-actions"><button className="button button--primary" type="submit">Send transport request</button><button className="button button--quiet" type="button" onClick={onCancel}>Back</button></div></form></main>;
}
