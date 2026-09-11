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
  fieldErrors: NewCaseFieldErrors;
  formError: string | null;
  mode: "fake" | "live";
  onCancel: () => void;
  onFieldErrorsChange: (errors: NewCaseFieldErrors) => void;
  onFormErrorChange: (error: string | null) => void;
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

export const PRESET_DEMO_WORK_ORDER = {
  workOrderRef: "WO-DEMO-1042",
  contractorDisplayName: "Example HVAC",
  siteLabel: "Fictional North Store",
  timezone: "America/Chicago",
  contactRole: "site_manager",
  phoneE164: "+12025550142",
  serviceDate: "2026-07-27",
  equipmentLabel: "Rooftop unit RTU-2",
  technicianCompletionNote: "Filter replaced and unit restarted",
  allowedReferenceText:
    "A fictional technician visited to service rooftop unit RTU-2.",
  requestedFields: [
    "observed_operating_status",
    "unresolved_issue",
    "return_visit_request",
  ],
} as const satisfies {
  workOrderRef: string;
  contractorDisplayName: string;
  siteLabel: string;
  timezone: string;
  contactRole: string;
  phoneE164: string;
  serviceDate: string;
  equipmentLabel: string;
  technicianCompletionNote: string;
  allowedReferenceText: string;
  requestedFields: readonly DemoCloseoutCaseInput["requestedFields"][number][];
};

export function createNewCaseWorkOrderReference(mode: "fake" | "live") {
  if (mode === "fake") {
    return PRESET_DEMO_WORK_ORDER.workOrderRef;
  }

  return `WO-LIVE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function formatDateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export function NewCaseForm({
  busy,
  defaultWorkOrder,
  fieldErrors,
  formError,
  mode,
  onCancel,
  onFieldErrorsChange,
  onFormErrorChange,
  onSubmit,
}: NewCaseFormProps) {
  const live = mode === "live";
  const formRef = useRef<HTMLFormElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const serviceDateInputRef = useRef<HTMLInputElement>(null);
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(
    new Set(
      live
        ? questionOptions.map((question) => question.value)
        : PRESET_DEMO_WORK_ORDER.requestedFields,
    ),
  );

  function restoreDemoPreset() {
    if (live) {
      return;
    }

    formRef.current?.reset();
    setSelectedQuestions(new Set(PRESET_DEMO_WORK_ORDER.requestedFields));
    onFieldErrorsChange({});
    onFormErrorChange(null);
  }

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
    <form
      className="workspace-panel"
      onChange={() => {
        if (formError) {
          onFormErrorChange(null);
        }
      }}
      onSubmit={handleSubmit}
      ref={formRef}
    >
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
          {live ? (
            <svg fill="none" viewBox="0 0 24 24">
              <path d="M12 4.25 20.25 19H3.75L12 4.25Z" />
              <path d="M12 9.75v4.5M12 17.25h.01" />
            </svg>
          ) : (
            <svg fill="none" viewBox="0 0 24 24">
              <path d="M9 3.5h6M10 3.5V6l-4.5 6.5A1.5 1.5 0 0 0 6.7 15h10.6a1.5 1.5 0 0 0 1.2-2.5L14 6V3.5" />
              <path d="M6.7 15a5 5 0 0 0 10.6 0" />
            </svg>
          )}
        </span>
        <span className="notice-strip-copy">
          {live
            ? "Live mode can place one real CALL-E phone call after a separate exact approval. Enter only a contact and purpose your organization is authorized to use."
            : "Demo data only. Use the fixed fictional inputs below; this workflow never places a real call."}
        </span>
        {live ? null : (
          <button
            className="text-button notice-strip-action"
            onClick={restoreDemoPreset}
            type="button"
          >
            Restore fictional preset
          </button>
        )}
      </div>

      <ol className="form-progress" aria-label="Case preparation sections">
        {[
          ["01", "Work order"],
          ["02", "Authorized contact"],
          ["03", "Visit evidence"],
          ["04", "Approved questions"],
        ].map(([number, label], index) => (
          <li aria-current={index === 0 ? "step" : undefined} key={number}>
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
              defaultValue={
                live
                  ? defaultWorkOrder
                  : PRESET_DEMO_WORK_ORDER.workOrderRef
              }
              name="workOrderRef"
              required
            />
          </label>
          <label>
            Contractor display name
            <input
              className="field-control"
              defaultValue={
                live ? "" : PRESET_DEMO_WORK_ORDER.contractorDisplayName
              }
              name="contractorDisplayName"
              placeholder={live ? "Authorized contractor name" : undefined}
              required
            />
          </label>
          <label>
            {live ? "Site label" : "Fictional site label"}
            <input
              className="field-control"
              defaultValue={live ? "" : PRESET_DEMO_WORK_ORDER.siteLabel}
              name="siteLabel"
              placeholder={live ? "Customer-safe site label" : undefined}
              required
            />
          </label>
          <label>
            IANA timezone
            <select
              className="field-control"
              defaultValue={
                live ? "America/Chicago" : PRESET_DEMO_WORK_ORDER.timezone
              }
              name="timezone"
              onChange={(event) => {
                if (live && serviceDateInputRef.current) {
                  serviceDateInputRef.current.value = formatDateInTimezone(
                    new Date(),
                    event.target.value,
                  );
                }
              }}
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
              defaultValue={
                live ? "site_manager" : PRESET_DEMO_WORK_ORDER.contactRole
              }
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
              defaultValue={live ? "" : PRESET_DEMO_WORK_ORDER.phoneE164}
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
              defaultValue={
                live
                  ? formatDateInTimezone(new Date(), "America/Chicago")
                  : PRESET_DEMO_WORK_ORDER.serviceDate
              }
              name="serviceDate"
              ref={serviceDateInputRef}
              required
              type="date"
            />
          </label>
          <label>
            Equipment label
            <input
              className="field-control"
              defaultValue={
                live ? "" : PRESET_DEMO_WORK_ORDER.equipmentLabel
              }
              name="equipmentLabel"
              placeholder={live ? "Equipment or serviced area" : undefined}
              required
            />
          </label>
          <label className="form-span-two">
            Internal technician completion note
            <textarea
              className="field-control"
              defaultValue={
                live
                  ? ""
                  : PRESET_DEMO_WORK_ORDER.technicianCompletionNote
              }
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
                  : PRESET_DEMO_WORK_ORDER.allowedReferenceText
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

      {formError ? (
        <p className="form-error" role="alert">
          {formError}
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
