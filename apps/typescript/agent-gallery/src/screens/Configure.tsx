import { useState } from "react";
import { MAX_REPLACEMENT_WINDOWS } from "../workflows/appointment-recovery/workflow";
import { validateRequest } from "../workflows/appointment-recovery/validate";
import type { RecoveryRequest } from "../workflows/appointment-recovery/types";

interface Props {
  request: RecoveryRequest;
  onChange: (request: RecoveryRequest) => void;
  onPreview: () => void;
  onBack: () => void;
}

export function Configure({ request, onChange, onPreview, onBack }: Props) {
  const [errors, setErrors] = useState<string[]>([]);

  function submit() {
    const found = validateRequest(request);
    setErrors(found);
    if (found.length === 0) onPreview();
  }

  function patch(update: Partial<RecoveryRequest>) {
    onChange({ ...request, ...update });
  }

  return (
    <section className="screen">
      <div className="screen-head">
        <h2>Configure</h2>
        <p className="lede">
          Nothing here reaches the network. The next screen shows the complete call plan
          before anything is authorized.
        </p>
      </div>

      <div className="card">
        <fieldset>
          <legend>Business</legend>
          <label className="field">
            Name
            <input
              value={request.business.name}
              onChange={(e) => patch({ business: { ...request.business, name: e.target.value } })}
            />
          </label>
          <label className="field">
            Timezone
            <input
              value={request.business.timezone}
              onChange={(e) =>
                patch({ business: { ...request.business, timezone: e.target.value } })
              }
            />
            <span className="field-hint">IANA name, for example Asia/Singapore</span>
          </label>
          <label className="field">
            Callback number
            <input
              value={request.business.callback_number_e164}
              onChange={(e) =>
                patch({ business: { ...request.business, callback_number_e164: e.target.value } })
              }
            />
            <span className="field-hint">E.164, for example +6560000000</span>
          </label>
        </fieldset>
      </div>

      <div className="card">
        <fieldset>
          <legend>Customer</legend>
          <label className="field">
            Given name
            <input
              value={request.customer.given_name}
              onChange={(e) =>
                patch({ customer: { ...request.customer, given_name: e.target.value } })
              }
            />
          </label>
          <label className="field">
            Phone number
            <input
              value={request.customer.phone_e164}
              onChange={(e) =>
                patch({ customer: { ...request.customer, phone_e164: e.target.value } })
              }
            />
            <span className="field-hint">E.164. Masked everywhere it is displayed.</span>
          </label>
          <label className="consent">
            <input
              type="checkbox"
              checked={request.customer.consent_confirmed}
              onChange={(e) =>
                patch({ customer: { ...request.customer, consent_confirmed: e.target.checked } })
              }
            />
            I confirm I have the authority and a lawful basis to call this customer about their
            appointment.
          </label>
        </fieldset>
      </div>

      <div className="card">
        <fieldset>
          <legend>Appointment</legend>
          <label className="field">
            Service
            <input
              value={request.appointment.service}
              onChange={(e) =>
                patch({ appointment: { ...request.appointment, service: e.target.value } })
              }
            />
          </label>
          <label className="field">
            Original time
            <input
              type="datetime-local"
              value={request.appointment.original_time}
              onChange={(e) =>
                patch({ appointment: { ...request.appointment, original_time: e.target.value } })
              }
            />
          </label>
          <label className="field">
            Status
            <select
              value={request.appointment.status}
              onChange={(e) =>
                patch({
                  appointment: {
                    ...request.appointment,
                    status: e.target.value as RecoveryRequest["appointment"]["status"],
                  },
                })
              }
            >
              <option value="missed">Missed</option>
              <option value="unconfirmed">Unconfirmed</option>
            </select>
          </label>
        </fieldset>
      </div>

      <div className="card">
        <fieldset>
          <legend>Replacement windows</legend>
          <p className="field-hint" style={{ marginBottom: "1rem" }}>
            The only times the agent may offer. Maximum {MAX_REPLACEMENT_WINDOWS}, entered in the
            business's own timezone.
          </p>
          {request.replacement_windows.map((window, index) => (
            <div className="window-row" key={index}>
              <label className="field">
                Start
                <input
                  type="datetime-local"
                  value={window.start}
                  onChange={(e) => {
                    const windows = request.replacement_windows.slice();
                    windows[index] = { ...window, start: e.target.value };
                    patch({ replacement_windows: windows });
                  }}
                />
              </label>
              <label className="field">
                End
                <input
                  type="datetime-local"
                  value={window.end}
                  onChange={(e) => {
                    const windows = request.replacement_windows.slice();
                    windows[index] = { ...window, end: e.target.value };
                    patch({ replacement_windows: windows });
                  }}
                />
              </label>
              {request.replacement_windows.length > 1 && (
                <button
                  type="button"
                  className="quiet"
                  aria-label={`Remove window ${index + 1}`}
                  onClick={() =>
                    patch({
                      replacement_windows: request.replacement_windows.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {request.replacement_windows.length < MAX_REPLACEMENT_WINDOWS && (
            <div className="actions" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  patch({
                    replacement_windows: [...request.replacement_windows, { start: "", end: "" }],
                  })
                }
              >
                Add window
              </button>
            </div>
          )}
        </fieldset>
      </div>

      {/* Grouped into one titled alert rather than a loose red list, so the
          operator reads "here is what to fix" instead of scanning for it. */}
      {errors.length > 0 && (
        <div className="alert" role="alert">
          <h3>
            {errors.length} {errors.length === 1 ? "thing needs" : "things need"} fixing before a
            preview
          </h3>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="actions">
        <button onClick={onBack}>Back</button>
        <button className="primary" onClick={submit}>
          Preview call plan
        </button>
      </div>
    </section>
  );
}
