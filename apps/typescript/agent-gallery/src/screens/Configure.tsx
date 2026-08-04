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
    <section>
      <h2>Configure</h2>
      <fieldset>
        <legend>Business</legend>
        <label>
          Name
          <input
            value={request.business.name}
            onChange={(e) => patch({ business: { ...request.business, name: e.target.value } })}
          />
        </label>
        <label>
          IANA timezone (for example Asia/Singapore)
          <input
            value={request.business.timezone}
            onChange={(e) => patch({ business: { ...request.business, timezone: e.target.value } })}
          />
        </label>
        <label>
          Callback number (E.164)
          <input
            value={request.business.callback_number_e164}
            onChange={(e) =>
              patch({ business: { ...request.business, callback_number_e164: e.target.value } })
            }
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Customer</legend>
        <label>
          Given name
          <input
            value={request.customer.given_name}
            onChange={(e) => patch({ customer: { ...request.customer, given_name: e.target.value } })}
          />
        </label>
        <label>
          Phone number (E.164)
          <input
            value={request.customer.phone_e164}
            onChange={(e) => patch({ customer: { ...request.customer, phone_e164: e.target.value } })}
          />
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

      <fieldset>
        <legend>Appointment</legend>
        <label>
          Service
          <input
            value={request.appointment.service}
            onChange={(e) =>
              patch({ appointment: { ...request.appointment, service: e.target.value } })
            }
          />
        </label>
        <label>
          Original time
          <input
            type="datetime-local"
            value={request.appointment.original_time}
            onChange={(e) =>
              patch({ appointment: { ...request.appointment, original_time: e.target.value } })
            }
          />
        </label>
        <label>
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

      <fieldset>
        <legend>Replacement windows the agent may offer (maximum {MAX_REPLACEMENT_WINDOWS})</legend>
        {request.replacement_windows.map((window, index) => (
          <div className="window-row" key={index}>
            <label>
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
            <label>
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
                onClick={() =>
                  patch({
                    replacement_windows: request.replacement_windows.filter((_, i) => i !== index),
                  })
                }
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {request.replacement_windows.length < MAX_REPLACEMENT_WINDOWS && (
          <button
            type="button"
            onClick={() =>
              patch({
                replacement_windows: [...request.replacement_windows, { start: "", end: "" }],
              })
            }
          >
            Add window
          </button>
        )}
      </fieldset>

      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <div className="actions">
        <button onClick={onBack}>Back</button>
        <button onClick={submit}>Preview call plan (dry run)</button>
      </div>
    </section>
  );
}
