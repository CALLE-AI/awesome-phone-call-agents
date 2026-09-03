import { useEffect, useState } from "react";
import { api, type Appointment } from "../api";
import { StatusBadge, AvatarName, formatDate, maskPhone } from "../components";
import type { LiveCall } from "../App";

interface Props {
  refreshKey: number;
  onRefresh: () => void;
  setLiveCall: (call: LiveCall | null) => void;
}

const COLUMNS = "minmax(170px,1.7fr) minmax(90px,0.8fr) minmax(170px,1.3fr) minmax(90px,0.8fr) minmax(110px,1fr) minmax(150px,1.1fr) minmax(220px,1.6fr)";

export function AppointmentsPage({ refreshKey, onRefresh, setLiveCall }: Props) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.appointments().then(setAppointments).catch((e: Error) => setError(e.message));
  }, [refreshKey]);

  async function runAction(appointmentId: string, call: LiveCall, action: () => Promise<unknown>) {
    setBusyId(appointmentId);
    setError(null);
    setLiveCall(call);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLiveCall(null);
      setBusyId(null);
      onRefresh();
    }
  }

  const confirmable = (appointment: Appointment) =>
    appointment.status === "SCHEDULED" && appointment.confirmationCallStatus === "NOT_CALLED" && appointment.slot !== null;
  const cancellable = (appointment: Appointment) =>
    (appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED") && appointment.slot !== null;

  return (
    <div className="page">
      <h1>Appointments</h1>
      <p className="page-subtitle">
        Upcoming appointments. The daily sweep auto-calls unconfirmed ones inside the 24h window; buttons trigger the
        same flow on demand.
      </p>
      {error !== null && <div className="error-banner">{error}</div>}

      <div className="data-grid">
        <div className="grid-head" style={{ gridTemplateColumns: COLUMNS, minWidth: 1080 }}>
          <div>Contact</div>
          <div>Phone</div>
          <div>When</div>
          <div>Service</div>
          <div>Status</div>
          <div>Confirmation call</div>
          <div>Actions</div>
        </div>
        {appointments.map((appointment) => {
          const isCalling = busyId === appointment.id;
          return (
            <div
              className="grid-row"
              key={appointment.id}
              style={{ gridTemplateColumns: COLUMNS, minWidth: 1080, whiteSpace: "nowrap", borderBottom: "1px solid var(--color-divider)" }}
            >
              <AvatarName name={appointment.contact.name} />
              <div className="mono text-muted" style={{ fontSize: 13.5 }}>
                {maskPhone(appointment.contact.phone)}
              </div>
              <div style={{ fontSize: 13.5 }}>{appointment.slot === null ? <span className="text-muted">—</span> : formatDate(appointment.slot.startsAt)}</div>
              <div style={{ fontSize: 13.5 }}>{appointment.slot?.serviceType ?? "—"}</div>
              <div>
                <StatusBadge status={appointment.status} />
              </div>
              <div>
                {isCalling ? (
                  <span className="calling-pill">
                    <span className="wave">
                      <span />
                      <span />
                      <span />
                    </span>
                    CALLING…
                  </span>
                ) : (
                  <StatusBadge status={appointment.confirmationCallStatus} />
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {confirmable(appointment) && (
                  <button
                    className="btn btn-primary"
                    disabled={busyId !== null}
                    onClick={() =>
                      runAction(
                        appointment.id,
                        { contactName: appointment.contact.name, snippet: `Confirming your ${appointment.slot?.serviceType ?? ""} appointment…` },
                        () => api.simulateConfirm(appointment.id, "attend"),
                      )
                    }
                  >
                    Confirm now
                  </button>
                )}
                {cancellable(appointment) && (
                  <button
                    className="btn btn-secondary"
                    disabled={busyId !== null}
                    onClick={() =>
                      runAction(
                        appointment.id,
                        { contactName: appointment.contact.name, snippet: "Freeing this slot and calling the waitlist…" },
                        () => api.simulateCancellation(appointment.id),
                      )
                    }
                  >
                    Cancel &amp; backfill
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
