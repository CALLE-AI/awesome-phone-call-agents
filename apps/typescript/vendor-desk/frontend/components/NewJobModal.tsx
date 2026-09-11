"use client";

import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";

interface VendorRow {
  vendorName: string;
  phoneNumber: string;
  region: string;
  locale: string;
}

const emptyVendor: VendorRow = { vendorName: "", phoneNumber: "", region: "US", locale: "en-US" };

export default function NewJobModal({
  onClose,
  onDispatched,
}: {
  onClose: () => void;
  onDispatched: () => void;
}) {
  const [item, setItem] = useState("");
  const [targetQuantity, setTargetQuantity] = useState(50);
  const [vendors, setVendors] = useState<VendorRow[]>([{ ...emptyVendor }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateVendor(index: number, patch: Partial<VendorRow>) {
    setVendors((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }

  function addVendor() {
    setVendors((prev) => [...prev, { ...emptyVendor }]);
  }

  function removeVendor(index: number) {
    setVendors((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setError(null);

    const cleanVendors = vendors.filter((v) => v.vendorName.trim() && v.phoneNumber.trim());
    if (!item.trim() || cleanVendors.length === 0) {
      setError("Add an item and at least one vendor with a name and phone number.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/calls/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item, targetQuantity, vendors: cleanVendors }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      onDispatched();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sourcing run.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Start Sourcing Run</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500">Item description</label>
            <input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="12x12 corrugated roofing sheets"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Target quantity</label>
            <input
              type="number"
              min={1}
              value={targetQuantity}
              onChange={(e) => setTargetQuantity(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <label className="text-xs font-medium text-slate-500">Vendors to call</label>
          <button
            onClick={addVendor}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
          >
            <Plus size={14} /> Add vendor
          </button>
        </div>

        <div className="mb-4 max-h-64 space-y-2 overflow-y-auto pr-1">
          {vendors.map((vendor, index) => (
            <div key={index} className="grid grid-cols-12 items-center gap-2">
              <input
                value={vendor.vendorName}
                onChange={(e) => updateVendor(index, { vendorName: e.target.value })}
                placeholder="Vendor name"
                className="col-span-5 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <input
                value={vendor.phoneNumber}
                onChange={(e) => updateVendor(index, { phoneNumber: e.target.value })}
                placeholder="+15551234567"
                className="col-span-4 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <input
                value={vendor.region}
                onChange={(e) => updateVendor(index, { region: e.target.value })}
                placeholder="US"
                className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => removeVendor(index)}
                className="col-span-1 text-slate-400 hover:text-red-500"
                aria-label="Remove vendor"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? "Dispatching calls…" : "Start calls"}
          </button>
        </div>
      </div>
    </div>
  );
}
