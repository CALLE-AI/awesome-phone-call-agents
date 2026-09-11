"use client";

import { useState, useRef } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { PLANS, PlanKey } from "@/lib/config/pricing";
import { BANK_DETAILS, JAZZCASH_MERCHANT_NUMBER, EASYPAISA_MERCHANT_NUMBER } from "@/lib/config/pricing";
import { ArcLogo } from "@/components/ui/arc-logo";

type PlanData = typeof PLANS[PlanKey];
type Cycle = "monthly" | "annual";
type PayTab = "card" | "jazzcash" | "easypaisa" | "bank";

interface Props {
  plan:      PlanData;
  planKey:   PlanKey;
  cycle:     Cycle;
  amount:    number;
  brandId:   string;
  brandName: string;
}

/* ─── Simulated card form (replace with Stripe Elements in production) ─── */
function CardForm({ amount, onSuccess }: { amount: number; onSuccess: () => void }) {
  const [cardNum, setCardNum]     = useState("");
  const [expiry, setExpiry]       = useState("");
  const [cvc, setCvc]             = useState("");
  const [name, setName]           = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError]         = useState("");

  function formatCard(val: string) {
    return val.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  }
  function formatExpiry(val: string) {
    const digits = val.replace(/\D/g, "").slice(0, 4);
    if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  }

  function handlePay() {
    if (!name || cardNum.replace(/\s/g, "").length < 16 || expiry.length < 5 || cvc.length < 3) {
      setError("Please fill in all card details.");
      return;
    }
    setError("");
    setProcessing(true);
    // In production: call Stripe.createPaymentMethod() + your API
    setTimeout(() => { setProcessing(false); onSuccess(); }, 2000);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "var(--bg)", border: "1.5px solid var(--border)",
    borderRadius: 8, color: "var(--text)", padding: "12px 14px",
    fontSize: 14, outline: "none", fontFamily: "inherit",
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 6 }}>Name on card</div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Muhammad Ali" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 6 }}>Card number</div>
        <input
          value={cardNum}
          onChange={e => setCardNum(formatCard(e.target.value))}
          placeholder="1234 5678 9012 3456"
          style={{ ...inputStyle, letterSpacing: cardNum ? 2 : 0 }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 6 }}>Expiry</div>
          <input
            value={expiry}
            onChange={e => setExpiry(formatExpiry(e.target.value))}
            placeholder="MM/YY"
            style={inputStyle}
          />
        </div>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 6 }}>CVC</div>
          <input
            value={cvc}
            onChange={e => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="•••"
            style={inputStyle}
          />
        </div>
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
        <span style={{ fontSize: 14 }}>🔒</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>256-bit SSL encryption · Powered by Stripe</span>
      </div>
      <button
        onClick={handlePay}
        disabled={processing}
        style={{
          width: "100%", padding: "14px", borderRadius: 10, border: "none", fontSize: 15, fontWeight: 700,
          background: processing ? "var(--border)" : "linear-gradient(135deg, var(--lilac-deep), var(--lilac-deep))",
          color: processing ? "var(--text-muted)" : "var(--text)", cursor: processing ? "default" : "pointer",
          boxShadow: processing ? "none" : "0 4px 16px rgba(79,70,229,0.35)", transition: "all 0.2s",
        }}
      >
        {processing ? "Processing…" : `Pay PKR ${amount.toLocaleString()}`}
      </button>
    </div>
  );
}

/* ─── JazzCash tab ─── */
function JazzCashTab({ amount, brandId, onSuccess }: { amount: number; brandId: string; onSuccess: () => void }) {
  const [mobile, setMobile]       = useState("");
  const [step, setStep]           = useState<"number" | "instructions" | "uploading">("number");
  const [file, setFile]           = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fileRef                   = useRef<HTMLInputElement>(null);

  const cleanMobile = mobile.replace(/\s|-/g, "").replace(/^\+92/, "0");
  const mobileValid = /^03\d{9}$/.test(cleanMobile);

  function handleConfirm() {
    if (!file) return;
    setConfirming(true);
    setTimeout(() => { setConfirming(false); onSuccess(); }, 2000);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, padding: "10px 14px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
        <div style={{ width: 36, height: 36, background: "var(--danger)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--text)", fontWeight: 800, fontSize: 11 }}>JC</span>
        </div>
        <div>
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>JazzCash Mobile Wallet</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>40M+ Pakistanis use JazzCash</div>
        </div>
      </div>

      {step === "number" && (
        <>
          <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 8 }}>Your JazzCash mobile number</div>
          <input
            value={mobile}
            onChange={e => setMobile(e.target.value)}
            placeholder="+92 3XX-XXXXXXX"
            style={{
              width: "100%", boxSizing: "border-box",
              background: "var(--bg)", border: `1.5px solid ${mobileValid ? "var(--success)" : "var(--border)"}`,
              borderRadius: 8, color: "var(--text)", padding: "12px 14px", fontSize: 14, outline: "none", marginBottom: 14,
            }}
          />
          <button
            onClick={() => mobileValid && setStep("instructions")}
            style={{
              width: "100%", padding: "13px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 700,
              background: mobileValid ? "var(--danger)" : "var(--border)",
              color: mobileValid ? "var(--text)" : "var(--text-muted)",
              cursor: mobileValid ? "pointer" : "default",
            }}
          >Continue</button>
        </>
      )}

      {(step === "instructions" || step === "uploading") && (
        <>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Transfer instructions</div>
            {[
              "Open JazzCash app → Send Money",
              `Enter merchant number: ${JAZZCASH_MERCHANT_NUMBER}`,
              `Amount: PKR ${amount.toLocaleString()}`,
              `Reference: ARC-${brandId.substring(0, 8)}`,
              "Take a screenshot of the confirmation",
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#DC262622", border: "1px solid #DC262644", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                  <span style={{ color: "var(--danger)", fontSize: 10, fontWeight: 700 }}>{i + 1}</span>
                </div>
                <span style={{ color: "var(--text)", fontSize: 13, lineHeight: 1.4 }}>{s}</span>
              </div>
            ))}
          </div>

          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${file ? "var(--success)" : "var(--border)"}`,
              borderRadius: 10, padding: "20px", textAlign: "center", cursor: "pointer",
              background: file ? "rgba(13,148,136,0.06)" : "transparent", marginBottom: 14, transition: "all 0.2s",
            }}
          >
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => setFile(e.target.files?.[0] ?? null)} />
            {file ? (
              <div>
                <div style={{ fontSize: 24, marginBottom: 6 }}>✓</div>
                <div style={{ color: "var(--success)", fontSize: 13, fontWeight: 600 }}>{file.name}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Screenshot uploaded</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📷</div>
                <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 500 }}>Upload payment screenshot</div>
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Click to select or drag and drop</div>
              </div>
            )}
          </div>

          <button
            onClick={handleConfirm}
            disabled={!file || confirming}
            style={{
              width: "100%", padding: "13px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 700,
              background: !file || confirming ? "var(--border)" : "var(--danger)",
              color: !file || confirming ? "var(--text-muted)" : "var(--text)",
              cursor: !file || confirming ? "default" : "pointer", transition: "all 0.2s",
            }}
          >
            {confirming ? "Submitting…" : file ? "I've made the payment — Confirm" : "Upload screenshot to confirm"}
          </button>
          <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 10 }}>
            Our team will verify within 4 business hours
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Easypaisa tab ─── */
function EasypaisaTab({ amount, brandId, onSuccess }: { amount: number; brandId: string; onSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, padding: "10px 14px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
        <div style={{ width: 36, height: 36, background: "#059669", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--text)", fontWeight: 800, fontSize: 11 }}>EP</span>
        </div>
        <div>
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Easypaisa Mobile Account</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>20M+ Pakistanis use Easypaisa</div>
        </div>
      </div>

      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Transfer instructions</div>
        {[
          "Open Easypaisa app → Send Money",
          `Enter merchant number: ${EASYPAISA_MERCHANT_NUMBER}`,
          `Amount: PKR ${amount.toLocaleString()}`,
          `Reference: ARC-${brandId.substring(0, 8)}`,
          "Screenshot the confirmation screen",
        ].map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#05966922", border: "1px solid #05966944", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "#059669", fontSize: 10, fontWeight: 700 }}>{i + 1}</span>
            </div>
            <span style={{ color: "var(--text)", fontSize: 13 }}>{s}</span>
          </div>
        ))}
      </div>

      <div
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${file ? "#059669" : "var(--border)"}`,
          borderRadius: 10, padding: "20px", textAlign: "center", cursor: "pointer",
          background: file ? "rgba(5,150,105,0.06)" : "transparent", marginBottom: 14,
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => setFile(e.target.files?.[0] ?? null)} />
        {file ? (
          <div>
            <div style={{ fontSize: 24 }}>✓</div>
            <div style={{ color: "#059669", fontSize: 13, fontWeight: 600 }}>{file.name}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 28, marginBottom: 6 }}>📷</div>
            <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 500 }}>Upload payment screenshot</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Click to select or drag and drop</div>
          </div>
        )}
      </div>

      <button
        onClick={() => { if (file) { setConfirming(true); setTimeout(() => { setConfirming(false); onSuccess(); }, 2000); } }}
        disabled={!file || confirming}
        style={{
          width: "100%", padding: "13px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 700,
          background: !file || confirming ? "var(--border)" : "#059669",
          color: !file || confirming ? "var(--text-muted)" : "var(--text)",
          cursor: !file || confirming ? "default" : "pointer",
        }}
      >
        {confirming ? "Submitting…" : file ? "I've made the payment — Confirm" : "Upload screenshot to confirm"}
      </button>
      <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 10 }}>
        Verified within 4 business hours
      </div>
    </div>
  );
}

/* ─── Bank Transfer tab ─── */
function BankTab({ amount, brandId, onSuccess }: { amount: number; brandId: string; onSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 18, marginBottom: 16 }}>
        <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 12 }}>Bank Account Details</div>
        {[
          { label: "Bank",           val: BANK_DETAILS.bankName },
          { label: "Account Name",   val: BANK_DETAILS.accountName },
          { label: "Account Number", val: BANK_DETAILS.accountNumber },
          { label: "IBAN",           val: BANK_DETAILS.iban },
          { label: "Swift Code",     val: BANK_DETAILS.swiftCode },
          { label: "Amount",         val: `PKR ${amount.toLocaleString()}` },
          { label: "Reference",      val: `ARC-${brandId.substring(0, 8).toUpperCase()}` },
        ].map(row => (
          <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--bg)" }}>
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{row.label}</span>
            <span style={{
              color: row.label === "Reference" || row.label === "IBAN" ? "var(--text-muted)" : row.label === "Amount" ? "var(--success)" : "var(--text)",
              fontSize: 13, fontWeight: row.label === "Reference" ? 700 : 500, fontFamily: row.label === "IBAN" || row.label === "Reference" ? "monospace" : "inherit",
            }}>{row.val}</span>
          </div>
        ))}
      </div>
      <div style={{ color: "var(--warning)", fontSize: 12, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
        ⚠ Bank transfers take 1–2 business days to process. Your plan activates once payment clears.
      </div>
      <div
        onClick={() => fileRef.current?.click()}
        style={{ border: `2px dashed ${file ? "var(--lilac-deep)" : "var(--border)"}`, borderRadius: 10, padding: 20, textAlign: "center", cursor: "pointer", marginBottom: 14, background: file ? "rgba(79,70,229,0.06)" : "transparent" }}
      >
        <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={e => setFile(e.target.files?.[0] ?? null)} />
        {file ? (
          <div><div style={{ fontSize: 24 }}>✓</div><div style={{ color: "var(--lilac-deep)", fontSize: 13, fontWeight: 600 }}>{file.name}</div></div>
        ) : (
          <div>
            <div style={{ fontSize: 28, marginBottom: 6 }}>🏦</div>
            <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 500 }}>Upload payment receipt / screenshot</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Image or PDF accepted</div>
          </div>
        )}
      </div>
      <button
        onClick={() => { if (file) { setConfirming(true); setTimeout(() => { setConfirming(false); onSuccess(); }, 2000); } }}
        disabled={!file || confirming}
        style={{
          width: "100%", padding: "13px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 700,
          background: !file || confirming ? "var(--border)" : "var(--lilac-deep)",
          color: !file || confirming ? "var(--text-muted)" : "var(--text)",
          cursor: !file || confirming ? "default" : "pointer",
        }}
      >
        {confirming ? "Submitting…" : file ? "Submit Payment Proof" : "Upload proof to continue"}
      </button>
    </div>
  );
}

/* ─── Main CheckoutFlow ─── */
export default function CheckoutFlow({ plan, cycle, amount, brandId, brandName }: Props) {
  const [activeTab, setActiveTab] = useState<PayTab>("card");
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoError, setPromoError]     = useState("");
  const [success, setSuccess]           = useState(false);

  const nextBilling = "May 10, 2026";
  const discount    = promoApplied ? Math.round(amount * 0.1) : 0;
  const finalAmount = amount - discount;

  function applyPromo() {
    if (promoCode.toUpperCase() === "ARC10") {
      setPromoApplied(true); setPromoError("");
    } else if (promoCode) {
      setPromoError("Invalid promo code. Try ARC10 for 10% off.");
    }
  }

  const TABS: { key: PayTab; label: string; icon: string }[] = [
    { key: "card",      label: "Card",          icon: "💳" },
    { key: "jazzcash",  label: "JazzCash",      icon: "📱" },
    { key: "easypaisa", label: "Easypaisa",     icon: "📱" },
    { key: "bank",      label: "Bank Transfer", icon: "🏦" },
  ];

  if (success) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: 72, marginBottom: 20 }}>🎉</div>
          <h1 style={{ color: "var(--text)", fontSize: 26, fontWeight: 800, margin: "0 0 12px" }}>Payment Received!</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 15, lineHeight: 1.7, margin: "0 0 28px" }}>
            Welcome to <strong style={{ color: "var(--text-muted)" }}>{plan.name}</strong>, {brandName.split(" ")[0]}.<br/>
            Your plan is now active. A receipt has been sent to your email.
          </p>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
            {[
              { label: "Plan",         val: `${plan.name} (${cycle})` },
              { label: "Amount paid",  val: `PKR ${finalAmount.toLocaleString()}` },
              { label: "Next billing", val: nextBilling },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--bg)" }}>
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{r.label}</span>
                <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 500 }}>{r.val}</span>
              </div>
            ))}
          </div>
          <Link href="/dashboard" style={{ display: "inline-block", background: "linear-gradient(135deg, var(--lilac-deep), var(--lilac-deep))", color: "var(--text)", textDecoration: "none", borderRadius: 10, padding: "13px 32px", fontSize: 15, fontWeight: 700, boxShadow: "0 4px 16px rgba(79,70,229,0.35)" }}>
            Go to Dashboard <ArrowRight aria-hidden strokeWidth={1.75} style={{ width: 14, height: 14 }} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Header */}
      <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "18px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {/* Same mark as the sidebar and the homepage - checkout is the one
            screen where a shopper checks they are still where they think
            they are, so it should not be the screen with an approximation
            of the logo on it. */}
        <ArcLogo className="h-6 w-auto text-text" gradientId="arc-logo-checkout" />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "var(--success)", fontSize: 13 }}>🔒</span>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Secure checkout</span>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 28px", display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 32, alignItems: "start" }}>

        {/* ── Left: Order Summary ── */}
        <div>
          <h1 style={{ color: "var(--text)", fontSize: 22, fontWeight: 800, margin: "0 0 24px" }}>
            Upgrade to {plan.name} Plan
          </h1>

          {/* Item */}
          <div style={{ background: "var(--surface)", border: `1.5px solid ${plan.color}44`, borderLeft: `3px solid ${plan.color}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 700 }}>{plan.name} Plan — {cycle === "annual" ? "Annual" : "Monthly"}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 3 }}>Next billing: {nextBilling}</div>
              </div>
              <div style={{ color: plan.color, fontSize: 18, fontWeight: 800 }}>PKR {amount.toLocaleString()}<span style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 400 }}>/mo</span></div>
            </div>
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              {plan.features.map(f => (
                <div key={f} style={{ display: "flex", gap: 8, marginBottom: 7 }}>
                  <span style={{ color: plan.color, fontSize: 13, flexShrink: 0 }}>✓</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Promo code */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 20 }}>
            <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Promo Code</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={promoCode}
                onChange={e => { setPromoCode(e.target.value.toUpperCase()); setPromoError(""); setPromoApplied(false); }}
                placeholder="Enter code"
                style={{ flex: 1, background: "var(--bg)", border: `1.5px solid ${promoApplied ? "var(--success)" : promoError ? "var(--danger)" : "var(--border)"}`, borderRadius: 8, color: "var(--text)", padding: "10px 12px", fontSize: 13, outline: "none" }}
              />
              <button onClick={applyPromo} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-muted)", padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Apply
              </button>
            </div>
            {promoApplied && <div style={{ color: "var(--success)", fontSize: 12, marginTop: 6 }}>✓ 10% discount applied! Saving PKR {discount.toLocaleString()}</div>}
            {promoError && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>{promoError}</div>}
            <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 6 }}>Try: ARC10</div>
          </div>

          {/* Order total */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
            {promoApplied && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Subtotal</span>
                <span style={{ color: "var(--text)", fontSize: 13 }}>PKR {amount.toLocaleString()}</span>
              </div>
            )}
            {promoApplied && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ color: "var(--success)", fontSize: 13 }}>Promo (ARC10)</span>
                <span style={{ color: "var(--success)", fontSize: 13 }}>−PKR {discount.toLocaleString()}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: promoApplied ? 10 : 0, borderTop: promoApplied ? "1px solid var(--border)" : "none" }}>
              <span style={{ color: "var(--text)", fontSize: 15, fontWeight: 700 }}>Total today</span>
              <span style={{ color: plan.color, fontSize: 18, fontWeight: 800 }}>PKR {finalAmount.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* ── Right: Payment ── */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 24, position: "sticky", top: 24 }}>
          <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Payment method</div>

          {/* Tab selector */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 20 }}>
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  padding: "9px 8px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1.5px solid",
                  borderColor: activeTab === t.key ? "var(--lilac-deep)" : "var(--border)",
                  background: activeTab === t.key ? "rgba(79,70,229,0.12)" : "transparent",
                  color: activeTab === t.key ? "var(--text-muted)" : "var(--text-muted)",
                  fontWeight: activeTab === t.key ? 600 : 400, transition: "all 0.15s",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                }}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === "card"      && <CardForm      amount={finalAmount} onSuccess={() => setSuccess(true)} />}
          {activeTab === "jazzcash"  && <JazzCashTab   amount={finalAmount} brandId={brandId} onSuccess={() => setSuccess(true)} />}
          {activeTab === "easypaisa" && <EasypaisaTab  amount={finalAmount} brandId={brandId} onSuccess={() => setSuccess(true)} />}
          {activeTab === "bank"      && <BankTab        amount={finalAmount} brandId={brandId} onSuccess={() => setSuccess(true)} />}
        </div>
      </div>
    </div>
  );
}
