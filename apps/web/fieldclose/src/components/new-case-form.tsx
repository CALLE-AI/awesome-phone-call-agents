"use client";

import { useRef, useState, type FormEvent } from "react";

import type { DemoCloseoutCaseInput } from "@/application/closeout-workflow";
import type { ProtectedCloseoutCaseInput } from "@/application/live-closeout-workflow";
import { e164PhoneSchema, usE164PhoneSchema } from "@/domain/phone-number";

export type NewCaseInput =
  | DemoCloseoutCaseInput
  | ProtectedCloseoutCaseInput;

export type NewCaseFieldErrors = Partial<
  Record<"contact.phoneE164", string>
>;

type NewCaseFormProps = {
  busy: boolean;
  defaultWorkOrder: string;
  error: string | null;
  fieldErrors: NewCaseFieldErrors;
  mode: "fake" | "live";
  onCancel: () => void;
  onFieldErrorsChange: (errors: NewCaseFieldErrors) => void;
  onSubmit: (input: NewCaseInput) => Promise<void>;
};

const questionOptions = [
  {
    value: "observed_operating_status",
    label: "Observed operating status",
    detail: "Ask how the serviced area or equipment appears to be operating.",
  },
  {
    value: "unresolved_issue",
    label: "Unresolved issue",
    detail: "Capture a factual issue report without diagnosis.",
  },
  {
    value: "return_visit_request",
    label: "Return-visit request",
    detail: "Ask whether the contractor should review a possible return visit.",
  },
] as const;

export function NewCaseForm({
  busy,
  defaultWorkOrder,
  error,
  fieldErrors,
  mode,
  onCancel,
  onFieldErrorsChange,
  onSubmit,
}: NewCaseFormProps) {
  const live = mode === "live";
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(
    new Set(questionOptions.map((question) => question.value)),
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const phoneResult = (live ? usE164PhoneSchema : e164PhoneSchema).safeParse(
      String(form.get("phoneE164") ?? ""),
    );

    if (!phoneResult.success) {
      onFieldErrorsChange({
        "contact.phoneE164": phoneResult.error.issues[0]?.message,
      });
      phoneInputRef.current?.focus();
      return;
    }

    onFieldErrorsChange({});

    const sharedInput = {
      workOrderRef: String(form.get("workOrderRef") ?? ""),
      contractorDisplayName: String(
        form.get("contractorDisplayName") ?? "",
      ),
      siteLabel: String(form.get("siteLabel") ?? ""),
      timezone: String(form.get("timezone") ?? ""),
      contact: {
        displayName: live
          ? String(form.get("contactDisplayName") ?? "")
          : null,
        role: String(form.get("contactRole") ?? ""),
        phoneE164: phoneResult.data,
      },
      requestedFields: [...selectedQuestions] as DemoCloseoutCaseInput["requestedFields"],
      visitContext: {
        serviceDate: String(form.get("serviceDate") ?? ""),
        equipmentLabel: String(form.get("equipmentLabel") ?? ""),
        technicianCompletionNote: String(
          form.get("technicianCompletionNote") ?? "",
        ),
        allowedReferenceText: String(
          form.get("allowedReferenceText") ?? "",
        ),
      },
    };

    await onSubmit(
      live
        ? {
            ...sharedInput,
            contact: {
              ...sharedInput.contact,
              authorizationBasis: String(
                form.get("authorizationBasis") ?? "",
              ) as ProtectedCloseoutCaseInput["contact"]["authorizationBasis"],
              authorizationNote: String(
                form.get("authorizationNote") ?? "",
              ),
            },
          }
        : sharedInput,
    );
  }

  return (
    <form className="workspace-panel" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            {live ? "New protected case" : "New fictional case"}
          </p>
          <h2>Prepare the closeout brief</h2>
          <p className="panel-heading-copy">
            Confirm the completed work order, authorized contact, and only the
            facts the approved call may reference.
          </p>
        </div>
        <button className="text-button" onClick={onCancel} type="button">
          Cancel
        </button>
      </div>

      <div
        className={`notice-strip ${live ? "notice-strip-live" : ""}`}
        role="note"
      >
        <span aria-hidden="true" className="notice-mark">
          {live ? "L" : "D"}
        </span>
        {live
          ? "Live mode can place one real CALL-E phone call after a separate exact approval. Enter only a contact and purpose your organization is authorized to use."
          : "Demo data only. Use the fictional 555 number below; this workflow never places a real call."}
      </div>

      <ol className="form-progress" aria-label="Case preparation sections">
        {[
          ["01", "Work order"],
          ["02", "Authorized contact"],
          ["03", "Visit evidence"],
          ["04", "Approved questions"],
        ].map(([number, label]) => (
          <li key={number}>
            <span>{number}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>

      <fieldset className="form-section">
        <legend>
          <span>01</span> Work order
        </legend>
        <div className="form-grid form-grid-two">
          <label>
            Work-order reference
            <input
              className="field-control"
              defaultValue={defaultWorkOrder}
              name="workOrderRef"
              required
            />
          </label>
          <label>
            Contractor display name
            <input
              className="field-control"
              defaultValue={live ? "" : "Example HVAC"}
              name="contractorDisplayName"
              placeholder={live ? "Authorized contractor name" : undefined}
              required
            />
          </label>
          <label>
            {live ? "Site label" : "Fictional site label"}
            <input
              className="field-control"
              defaultValue={live ? "" : "Fictional North Store"}
              name="siteLabel"
              placeholder={live ? "Customer-safe site label" : undefined}
              required
            />
          </label>
          <label>
            IANA timezone
            <select
              className="field-control"
              defaultValue="America/Chicago"
              name="timezone"
            >
              <option value="America/Chicago">America/Chicago</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Denver">America/Denver</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
              <option value="Asia/Shanghai">Asia/Shanghai</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>
          <span>02</span>{" "}
          {live ? "Authorized live contact" : "Authorized demo contact"}
        </legend>
        <div className="form-grid form-grid-two">
          {live ? (
            <label>
              Contact display name
              <input
                autoComplete="name"
                className="field-control"
                name="contactDisplayName"
                placeholder="Name or authorized site role"
                required
              />
            </label>
          ) : null}
          <label>
            Contact role
            <select
              className="field-control"
              defaultValue="site_manager"
              name="contactRole"
            >
              <option value="site_manager">Site manager</option>
              <option value="facilities_contact">Facilities contact</option>
              <option value="property_manager">Property manager</option>
            </select>
          </label>
          <label>
            {live ? "Authorized E.164 number" : "Fictional E.164 number"}
            <input
              aria-describedby={
                fieldErrors["contact.phoneE164"]
                  ? "phone-e164-help phone-e164-error"
                  : "phone-e164-help"
              }
              aria-invalid={
                fieldErrors["contact.phoneE164"] ? "true" : undefined
              }
              autoComplete="off"
              className="field-control font-mono"
              defaultValue={live ? "" : "+12025550142"}
              id="phone-e164"
              inputMode="tel"
              name="phoneE164"
              onChange={() => {
                if (fieldErrors["contact.phoneE164"]) {
                  onFieldErrorsChange({});
                }
              }}
              placeholder={live ? "+1…" : undefined}
              ref={phoneInputRef}
              required
            />
            <span className="field-help" id="phone-e164-help">
              {live
                ? "Encrypted at rest; only the masked form returns to this page."
                : "Reserved 555-01xx example range"}
            </span>
            {fieldErrors["contact.phoneE164"] ? (
              <span
                className="field-error"
                id="phone-e164-error"
                role="alert"
              >
                {fieldErrors["contact.phoneE164"]}
              </span>
            ) : null}
          </label>
          {live ? (
            <>
              <label>
                Authorization basis
                <select
                  className="field-control"
                  defaultValue="contractor_provided_authorized_contact"
                  name="authorizationBasis"
                >
                  <option value="contractor_provided_authorized_contact">
                    Contractor-provided authorized contact
                  </option>
                  <option value="existing_service_contact">
                    Existing service contact
                  </option>
                  <option value="contact_requested_follow_up">
                    Contact requested follow-up
                  </option>
                </select>
              </label>
              <label>
                Authorization record
                <textarea
                  className="field-control"
                  name="authorizationNote"
                  placeholder="Record who confirmed this contact and purpose."
                  required
                  rows={2}
                />
              </label>
            </>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>
          <span>03</span> Completed visit context
        </legend>
        <div className="form-grid form-grid-two">
          <label>
            Service date
            <input
              className="field-control"
              defaultValue={new Date().toISOString().slice(0, 10)}
              name="serviceDate"
              required
              type="date"
            />
          </label>
          <label>
            Equipment label
            <input
              className="field-control"
              defaultValue={live ? "" : "Rooftop unit RTU-2"}
              name="equipmentLabel"
              placeholder={live ? "Equipment or serviced area" : undefined}
              required
            />
          </label>
          <label className="form-span-two">
            Internal technician completion note
            <textarea
              className="field-control"
              defaultValue={live ? "" : "Filter replaced and unit restarted"}
              name="technicianCompletionNote"
              required
              rows={2}
            />
            <span className="field-help">
              Stored for the operator; not automatically spoken.
            </span>
          </label>
          <label className="form-span-two">
            Exact reference text the agent may say
            <textarea
              className="field-control"
              defaultValue={
                live
                  ? ""
                  : "A fictional technician visited to service rooftop unit RTU-2."
              }
              name="allowedReferenceText"
              placeholder={
                live
                  ? "Exact minimal sentence the agent may say after contact verification."
                  : undefined
              }
              required
              rows={2}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>
          <span>04</span> Approved questions
        </legend>
        <div className="question-list">
          {questionOptions.map((question) => (
            <label className="question-option" key={question.value}>
              <input
                checked={selectedQuestions.has(question.value)}
                onChange={(event) => {
                  setSelectedQuestions((current) => {
                    const next = new Set(current);

                    if (event.target.checked) {
                      next.add(question.value);
                    } else {
                      next.delete(question.value);
                    }

                    return next;
                  });
                }}
                type="checkbox"
              />
              <span>
                <strong>{question.label}</strong>
                <small>{question.detail}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="form-actions">
        <button className="secondary-button" onClick={onCancel} type="button">
          Keep current case
        </button>
        <button
          className="primary-button"
          disabled={busy || selectedQuestions.size === 0}
          type="submit"
        >
          {busy
            ? "Creating…"
            : live
              ? "Create protected case"
              : "Create demo case"}
        </button>
      </div>
    </form>
  );
}
