import { useEffect, useState } from "react";
import { api, type Appointment } from "../api";
import { StatusBadge, formatDate, maskPhone } from "../components";

interface Props {
  refreshKey: number;
  onRefresh: () => void;
  setCalling: (message: string | null) => void;
}

export function AppointmentsPage({ refreshKey, onRefresh, setCalling }: Props) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.appointments().then(setAppointments).catch((e: Error) => setError(e.message));
  }, [refreshKey]);

  async function runAction(message: string, action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setCalling(message);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCalling(null);
      setBusy(false);
      onRefresh();
    }
  }

  const confirmable = (appointment: Appointment) =>
    appointment.status === "SCHEDULED" && appointment.confirmationCallStatus === "NOT_CALLED" && appointment.slot !== null;
  const cancellable = (appointment: Appointment) =>
    (appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED") && appointment.slot !== null;

  return (
    <>
      <h2>Appointments</h2>
      <p className="subtitle">
        Upcoming appointments. The daily sweep auto-calls unconfirmed ones inside the 24h window; buttons trigger the
        same flow on demand.
      </p>
      {error !== null && <div className="error-banner">{error}</div>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Contact</th>
              <th>Phone</th>
              <th>When</th>
              <th>Service</th>
              <th>Status</th>
              <th>Confirmation call</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {appointments.map((appointment) => (
              <tr key={appointment.id}>
                <td>{appointment.contact.name}</td>
                <td className="mono">{maskPhone(appointment.contact.phone)}</td>
                <td>{appointment.slot === null ? <span className="muted">—</span> : formatDate(appointment.slot.startsAt)}</td>
                <td>{appointment.slot?.serviceType ?? "—"}</td>
                <td>
                  <StatusBadge status={appointment.status} />
                </td>
                <td>
                  <StatusBadge status={appointment.confirmationCallStatus} />
                </td>
                <td>
                  {confirmable(appointment) && (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() =>
                        runAction(
                          `Calling ${appointment.contact.name} to confirm their appointment…`,
                          () => api.simulateConfirm(appointment.id, "attend"),
                        )
                      }
                    >
                      ☎ Confirm now
                    </button>
                  )}{" "}
                  {cancellable(appointment) && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        runAction(
                          `Slot freed — calling down the waitlist to backfill…`,
                          () => api.simulateCancellation(appointment.id),
                        )
                      }
                    >
                      ✕ Cancel &amp; backfill
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
