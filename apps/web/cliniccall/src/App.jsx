import { useEffect, useState } from "react";
import "./App.css";
import doctorPhoto from "./assets/doctor-photo.png";

const API_URL = "https://cliniccall-api.onrender.com";

function App() {
  const [started, setStarted] = useState(false);
  const [activePage, setActivePage] = useState("Dashboard");

  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [callHistory, setCallHistory] = useState([]);

  const [showPatientForm, setShowPatientForm] = useState(false);
  const [showAppointmentForm, setShowAppointmentForm] = useState(false);
  const [showCallForm, setShowCallForm] = useState(false);

  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");

  const [selectedPatient, setSelectedPatient] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");

  const [selectedAppointment, setSelectedAppointment] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadPatients();
    loadAppointments();
    loadCallHistory();
  }, []);

  async function loadPatients() {
    try {
      const response = await fetch(`${API_URL}/patients`);
      const data = await response.json();

      if (response.ok && Array.isArray(data)) {
        setPatients(data);
      }
    } catch (error) {
      console.error("Unable to load patients:", error);
    }
  }

  async function loadAppointments() {
    try {
      const response = await fetch(`${API_URL}/appointments`);
      const data = await response.json();

      if (response.ok && Array.isArray(data)) {
        setAppointments(data);
      }
    } catch (error) {
      console.error("Unable to load appointments:", error);
    }
  }

  async function loadCallHistory() {
    try {
      const response = await fetch(`${API_URL}/call-history`);
      const data = await response.json();

      if (response.ok && Array.isArray(data)) {
        setCallHistory(data);
      }
    } catch (error) {
      console.error("Unable to load call history:", error);
    }
  }

  function getPatientName(patientId) {
    const patient = patients.find(
      (item) => Number(item.id) === Number(patientId)
    );

    return patient?.name || `Patient #${patientId}`;
  }

  function maskPhoneNumber(phone) {
    if (!phone) return "No phone number";

    const value = String(phone);

    if (value.length <= 4) {
      return "••••";
    }

    return `${value.slice(0, 4)}••••${value.slice(-2)}`;
  }

  async function createPatient(event) {
    event.preventDefault();

    if (!patientName.trim() || !patientPhone.trim()) {
      setMessage("Please enter the patient's name and phone number.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/patients`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: patientName.trim(),
          phone_number: patientPhone.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(
          data.detail
            ? typeof data.detail === "string"
              ? data.detail
              : JSON.stringify(data.detail)
            : "Unable to create patient."
        );
        return;
      }

      setMessage("Patient created successfully.");

      setPatientName("");
      setPatientPhone("");

      await loadPatients();

      setTimeout(() => {
        setShowPatientForm(false);
        setMessage("");
      }, 1000);
    } catch (error) {
      console.error(error);
      setMessage("Unable to connect to ClinicCall API.");
    } finally {
      setLoading(false);
    }
  }

  async function createAppointment(event) {
    event.preventDefault();

    if (!selectedPatient || !appointmentDate || !appointmentTime) {
      setMessage("Please complete all appointment fields.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/appointments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patient_id: Number(selectedPatient),
          appointment_date: appointmentDate,
          appointment_time: appointmentTime,
          clinic_name: "ClinicCall Demo Clinic",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(
          data.detail
            ? typeof data.detail === "string"
              ? data.detail
              : JSON.stringify(data.detail)
            : "Unable to create appointment."
        );
        return;
      }

      setMessage("Appointment created successfully.");

      setSelectedPatient("");
      setAppointmentDate("");
      setAppointmentTime("");

      await loadAppointments();

      setTimeout(() => {
        setShowAppointmentForm(false);
        setMessage("");
      }, 1000);
    } catch (error) {
      console.error(error);
      setMessage("Unable to connect to ClinicCall API.");
    } finally {
      setLoading(false);
    }
  }

  async function callPatient(event) {
    event.preventDefault();

    if (!selectedAppointment) {
      setMessage("Please select an appointment.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/call-patient`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          appointment_id: Number(selectedAppointment),
        }),
      });

      const text = await response.text();

      let data = {};

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = {
            message: text,
          };
        }
      }

      if (!response.ok) {
        let errorMessage = "Unable to start patient call.";

        if (data.detail) {
          errorMessage =
            typeof data.detail === "string"
              ? data.detail
              : JSON.stringify(data.detail);
        } else if (data.message) {
          errorMessage = data.message;
        } else if (text) {
          errorMessage = text;
        }

        setMessage(`❌ ${errorMessage}`);
        return;
      }

      setMessage("Patient call started successfully!");

      setSelectedAppointment("");

      await loadCallHistory();

      setTimeout(() => {
        setShowCallForm(false);
        setMessage("");
      }, 3000);
    } catch (error) {
      console.error("Frontend call error:", error);

      setMessage(
        "The call request could not be confirmed. Please check the Call Center."
      );
    } finally {
      setLoading(false);
    }
  }

  /* ============================================================
     LANDING PAGE
  ============================================================ */

  if (!started) {
    return (
      <div className="landing">
        <nav className="landing-nav">
          <div className="brand">
            <div className="brand-mark">+</div>
            <span>ClinicCall</span>
          </div>

          <div className="landing-links">
            <a href="#features">Features</a>

            <button onClick={() => setStarted(true)}>
              Open dashboard →
            </button>
          </div>
        </nav>

        <section className="landing-hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="pulse"></span>
              AI-POWERED PATIENT COMMUNICATION
            </div>

            <h1>
              Your clinic's
              <span>smartest caller.</span>
            </h1>

            <p>
              ClinicCall helps clinics reduce missed appointments with
              intelligent automated patient calls and reminders.
            </p>

            <div className="hero-actions">
              <button
                className="main-cta"
                onClick={() => setStarted(true)}
              >
                Explore ClinicCall →
              </button>

              <button
                className="watch-btn"
                onClick={() => setStarted(true)}
              >
                ▶ See how it works
              </button>
            </div>

            <div className="trust">
              <strong>Built for modern clinics</strong>
              <small>
                Smarter communication. Better attendance.
              </small>
            </div>
          </div>

          <div className="hero-doctor">
            <div className="doctor-glow"></div>

            <div className="doctor-frame">
              <img
                src={doctorPhoto}
                alt="Doctor using ClinicCall"
                className="doctor-image"
              />

              <div className="doctor-badge">
                <span className="status-dot"></span>

                <div>
                  <strong>ClinicCall AI</strong>
                  <small>System operational</small>
                </div>
              </div>
            </div>

            <div className="floating-card call-card">
              <div className="mini-icon">☎</div>

              <div>
                <strong>Patient call</strong>
                <span>Connected</span>
              </div>

              <div className="online-dot"></div>
            </div>

            <div className="floating-card success-card">
              <div className="success-check">✓</div>

              <div>
                <strong>Call completed</strong>
                <span>Patient communication</span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-stats">
          <div>
            <strong>24/7</strong>
            <span>Patient communication</span>
          </div>

          <div>
            <strong>92%</strong>
            <span>Call success rate</span>
          </div>

          <div>
            <strong>40%</strong>
            <span>Fewer missed appointments</span>
          </div>

          <div>
            <strong>1</strong>
            <span>Simple clinic platform</span>
          </div>
        </section>

        <section className="feature-section" id="features">
          <div className="section-heading">
            <div className="eyebrow">WHY CLINICCALL</div>

            <h2>Everything your clinic needs.</h2>

            <p>
              Manage patients, appointments and AI-powered calls
              from one place.
            </p>
          </div>

          <div className="feature-grid">
            <div className="feature">
              <div className="feature-icon blue-icon">☎</div>

              <h3>Smart patient calls</h3>

              <p>
                Contact patients about their appointments.
              </p>
            </div>

            <div className="feature">
              <div className="feature-icon purple-icon">▣</div>

              <h3>Appointment management</h3>

              <p>
                Create and manage clinic appointments.
              </p>
            </div>

            <div className="feature">
              <div className="feature-icon green-icon">✓</div>

              <h3>Patient management</h3>

              <p>
                Keep patient information organized.
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  /* ============================================================
     DASHBOARD
  ============================================================ */

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">+</div>

          <div>
            <h2>ClinicCall</h2>
            <span>Smart Healthcare</span>
          </div>
        </div>

        <div className="menu-title">WORKSPACE</div>

        <nav>
          {[
            "Dashboard",
            "Appointments",
            "Patients",
            "Call Center",
          ].map((item, index) => (
            <button
              key={item}
              className={`menu-item ${
                activePage === item ? "active" : ""
              }`}
              onClick={() => {
                setActivePage(item);
                setMessage("");
              }}
            >
              <span>
                {["⌂", "▣", "♙", "☎"][index]}
              </span>

              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="ai-status">
            <div className="ai-orb">✦</div>

            <div>
              <strong>ClinicCall AI</strong>

              <span>
                <i></i> System operational
              </span>
            </div>
          </div>

          <div className="user">
            <div className="avatar">DR</div>

            <div>
              <strong>Dr. Admin</strong>
              <span>Clinic Manager</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="welcome">CLINICCALL WORKSPACE</p>
            <h1>{activePage}</h1>
          </div>

          <div className="top-actions">
            <button
              className="primary-btn"
              onClick={() => {
                setMessage("");
                setShowAppointmentForm(true);
              }}
            >
              + New appointment
            </button>
          </div>
        </header>

        {activePage === "Dashboard" && (
          <>
            <section className="dashboard-welcome">
              <div className="dashboard-copy">
                <div className="small-label">
                  <span></span>
                  AI CALL CENTER ONLINE
                </div>

                <h2>
                  Keep your patients
                  <br />
                  <em>connected.</em>
                </h2>

                <p>
                  ClinicCall helps your clinic manage patients,
                  appointments and communication from one simple
                  workspace.
                </p>

                <button
                  className="dashboard-cta"
                  onClick={() =>
                    setActivePage("Call Center")
                  }
                >
                  Open call center →
                </button>
              </div>

              <div className="dashboard-doctor">
                <div className="dashboard-photo-glow"></div>

                <div className="dashboard-photo-wrapper">
                  <img
                    src={doctorPhoto}
                    alt="ClinicCall doctor"
                    className="dashboard-doctor-image"
                  />

                  <div className="doctor-info-card">
                    <div className="doctor-small-avatar">
                      DR
                    </div>

                    <div>
                      <strong>ClinicCall AI</strong>
                      <span>
                        <i></i> Ready to assist
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="stats">
              <div className="stat-card">
                <div className="stat-icon blue">♙</div>

                <div>
                  <span>Patients</span>
                  <strong>{patients.length}</strong>
                  <small>Live database</small>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon purple">▣</div>

                <div>
                  <span>Appointments</span>
                  <strong>{appointments.length}</strong>
                  <small>Scheduled</small>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon green">☎</div>

                <div>
                  <span>Calls</span>
                  <strong>{callHistory.length}</strong>
                  <small>Call history</small>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon orange">✓</div>

                <div>
                  <span>System</span>
                  <strong>Online</strong>
                  <small>API connected</small>
                </div>
              </div>
            </section>

            <section className="content-grid">
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <h3>Upcoming appointments</h3>
                    <p>Live appointments from your clinic</p>
                  </div>

                  <button
                    className="view-btn"
                    onClick={() =>
                      setActivePage("Appointments")
                    }
                  >
                    View all →
                  </button>
                </div>

                {appointments.length === 0 ? (
                  <div className="empty-message">
                    <div>▣</div>

                    <h3>No appointments yet</h3>

                    <p>
                      Create an appointment to start managing
                      your clinic schedule.
                    </p>

                    <button
                      className="primary-btn"
                      onClick={() =>
                        setShowAppointmentForm(true)
                      }
                    >
                      + New appointment
                    </button>
                  </div>
                ) : (
                  <div className="appointment-list">
                    {appointments.slice(0, 5).map(
                      (appointment) => (
                        <div
                          className="appointment"
                          key={appointment.id}
                        >
                          <div className="patient-avatar">
                            {getPatientName(
                              appointment.patient_id
                            )
                              .slice(0, 2)
                              .toUpperCase()}
                          </div>

                          <div className="patient-info">
                            <strong>
                              {getPatientName(
                                appointment.patient_id
                              )}
                            </strong>

                            <span>
                              {appointment.clinic_name ||
                                "ClinicCall Demo Clinic"}
                            </span>
                          </div>

                          <div className="appointment-time">
                            <strong>
                              {appointment.appointment_date}
                            </strong>

                            <span className="status confirmed">
                              {appointment.appointment_time}
                            </span>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>

              <div className="panel call-panel">
                <div className="panel-header">
                  <div>
                    <h3>AI Call Center</h3>
                    <p>Patient communication</p>
                  </div>

                  <div className="live">
                    <span></span> Live
                  </div>
                </div>

                <div className="call-visual">
                  <div className="call-orb">☎</div>
                </div>

                <div className="call-number">
                  <strong>{callHistory.length}</strong>
                  <span>calls recorded</span>
                </div>

                <button
                  className="call-button"
                  onClick={() =>
                    setActivePage("Call Center")
                  }
                >
                  Open call center →
                </button>
              </div>
            </section>
          </>
        )}

        {activePage === "Appointments" && (
          <section className="page-card">
            <div className="page-heading">
              <div>
                <div className="eyebrow">SCHEDULE</div>

                <h2>Appointments</h2>

                <p>
                  Manage your clinic's appointment schedule.
                </p>
              </div>

              <button
                className="primary-btn"
                onClick={() => {
                  setMessage("");
                  setShowAppointmentForm(true);
                }}
              >
                + New appointment
              </button>
            </div>

            {appointments.length === 0 ? (
              <div className="empty-message large-empty">
                <div>▣</div>

                <h3>Your schedule is clear</h3>

                <p>
                  Create an appointment to see it here.
                </p>

                <button
                  className="primary-btn"
                  onClick={() =>
                    setShowAppointmentForm(true)
                  }
                >
                  + New appointment
                </button>
              </div>
            ) : (
              <div className="appointment-list">
                {appointments.map((appointment) => (
                  <div
                    className="appointment"
                    key={appointment.id}
                  >
                    <div className="patient-avatar">
                      {getPatientName(
                        appointment.patient_id
                      )
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>

                    <div className="patient-info">
                      <strong>
                        {getPatientName(
                          appointment.patient_id
                        )}
                      </strong>

                      <span>
                        {appointment.clinic_name ||
                          "ClinicCall Demo Clinic"}
                      </span>
                    </div>

                    <div className="appointment-time">
                      <strong>
                        {appointment.appointment_date}
                      </strong>

                      <span className="status confirmed">
                        {appointment.appointment_time}
                      </span>
                    </div>

                    <button
                      className="call-button"
                      onClick={() => {
                        setSelectedAppointment(
                          String(appointment.id)
                        );
                        setMessage("");
                        setShowCallForm(true);
                      }}
                    >
                      ☎ Call patient
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activePage === "Patients" && (
          <section className="page-card">
            <div className="page-heading">
              <div>
                <div className="eyebrow">PATIENTS</div>

                <h2>Your patients</h2>

                <p>
                  Patients currently stored in your database.
                </p>
              </div>

              <button
                className="primary-btn"
                onClick={() => {
                  setMessage("");
                  setShowPatientForm(true);
                }}
              >
                + Add patient
              </button>
            </div>

            {patients.length === 0 ? (
              <div className="empty-message large-empty">
                <div>♙</div>

                <h3>No patients found</h3>

                <p>
                  Add your first patient to ClinicCall.
                </p>

                <button
                  className="primary-btn"
                  onClick={() =>
                    setShowPatientForm(true)
                  }
                >
                  + Add patient
                </button>
              </div>
            ) : (
              <div className="patient-grid">
                {patients.map((patient) => (
                  <div
                    className="patient-card"
                    key={patient.id}
                  >
                    <div className="patient-avatar big">
                      {patient.name
                        ? patient.name
                            .slice(0, 2)
                            .toUpperCase()
                        : "PT"}
                    </div>

                    <div>
                      <h3>
                        {patient.name ||
                          `Patient #${patient.id}`}
                      </h3>

                      <p>
                        {maskPhoneNumber(
                          patient.phone_number
                        )}
                      </p>
                    </div>

                    <span>ID #{patient.id}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activePage === "Call Center" && (
          <section className="page-card call-center-page">
            <div className="call-center-hero">
              <div>
                <div className="eyebrow">CLINICCALL AI</div>

                <h2>
                  Your intelligent
                  <br />
                  <em>calling assistant.</em>
                </h2>

                <p>
                  Select an appointment and ClinicCall will
                  use the appointment ID to start the patient
                  call.
                </p>

                <button
                  className="primary-btn"
                  onClick={() => {
                    if (appointments.length === 0) {
                      setMessage(
                        "Create an appointment first."
                      );
                      return;
                    }

                    setMessage("");
                    setShowCallForm(true);
                  }}
                >
                  ☎ Call a patient
                </button>
              </div>

              <div className="call-center-doctor">
                <img
                  src={doctorPhoto}
                  alt="ClinicCall doctor"
                />
              </div>
            </div>

            {message && (
              <div className="page-notice">
                {message}
              </div>
            )}

            <div className="call-history">
              <div className="panel-header">
                <div>
                  <h3>Recent calls</h3>

                  <p>
                    Your latest patient communication
                  </p>
                </div>
              </div>

              {callHistory.length === 0 ? (
                <div className="empty-message">
                  <div>☎</div>

                  <h3>No calls yet</h3>

                  <p>
                    Calls made through ClinicCall will
                    appear here.
                  </p>
                </div>
              ) : (
                callHistory.map((call, index) => (
                  <div
                    className="appointment"
                    key={call.id || index}
                  >
                    <div className="patient-avatar">
                      ☎
                    </div>

                    <div className="patient-info">
                      <strong>
                        {call.patient_id
                          ? getPatientName(
                              call.patient_id
                            )
                          : "Patient call"}
                      </strong>

                      <span>
                        {call.status ||
                          "Call recorded"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </main>

      {/* ============================================================
         ADD PATIENT MODAL
      ============================================================ */}

      {showPatientForm && (
        <div className="modal-overlay">
          <div className="modal">
            <button
              className="close"
              onClick={() => {
                setShowPatientForm(false);
                setMessage("");
              }}
            >
              ×
            </button>

            <div className="modal-icon">+</div>

            <div className="eyebrow">NEW PATIENT</div>

            <h2>Add patient</h2>

            <p>
              Enter the patient's information.
            </p>

            <form onSubmit={createPatient}>
              <label>Patient name</label>

              <input
                type="text"
                placeholder="e.g. Angela Mwangi"
                value={patientName}
                onChange={(e) =>
                  setPatientName(e.target.value)
                }
                required
              />

              <label>Phone number</label>

              <input
                type="tel"
                placeholder="e.g. +254712345678"
                value={patientPhone}
                onChange={(e) =>
                  setPatientPhone(e.target.value)
                }
                required
              />

              {message && (
                <div
                  className={
                    message.includes("successfully")
                      ? "success-message"
                      : "error-message"
                  }
                >
                  {message}
                </div>
              )}

              <button
                className="submit-btn"
                type="submit"
                disabled={loading}
              >
                {loading
                  ? "Creating..."
                  : "Save patient →"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
         APPOINTMENT MODAL
      ============================================================ */}

      {showAppointmentForm && (
        <div className="modal-overlay">
          <div className="modal">
            <button
              className="close"
              onClick={() => {
                setShowAppointmentForm(false);
                setMessage("");
              }}
            >
              ×
            </button>

            <div className="modal-icon">+</div>

            <div className="eyebrow">
              NEW APPOINTMENT
            </div>

            <h2>Schedule a visit</h2>

            <p>
              Select a patient and choose their
              appointment time.
            </p>

            {patients.length === 0 ? (
              <div className="error-message">
                You need to add a patient first.

                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => {
                    setShowAppointmentForm(false);
                    setShowPatientForm(true);
                  }}
                  style={{ marginTop: "12px" }}
                >
                  + Add patient
                </button>
              </div>
            ) : (
              <form onSubmit={createAppointment}>
                <label>Patient</label>

                <select
                  value={selectedPatient}
                  onChange={(e) =>
                    setSelectedPatient(e.target.value)
                  }
                  required
                >
                  <option value="">
                    Select a patient
                  </option>

                  {patients.map((patient) => (
                    <option
                      key={patient.id}
                      value={patient.id}
                    >
                      {patient.name ||
                        `Patient #${patient.id}`}
                      {patient.phone_number
                        ? ` — ${maskPhoneNumber(
                            patient.phone_number
                          )}`
                        : ""}
                    </option>
                  ))}
                </select>

                <label>Appointment date</label>

                <input
                  type="date"
                  value={appointmentDate}
                  onChange={(e) =>
                    setAppointmentDate(e.target.value)
                  }
                  required
                />

                <label>Appointment time</label>

                <input
                  type="time"
                  value={appointmentTime}
                  onChange={(e) =>
                    setAppointmentTime(e.target.value)
                  }
                  required
                />

                {message && (
                  <div
                    className={
                      message.includes("successfully")
                        ? "success-message"
                        : "error-message"
                    }
                  >
                    {message}
                  </div>
                )}

                <button
                  className="submit-btn"
                  type="submit"
                  disabled={loading}
                >
                  {loading
                    ? "Creating..."
                    : "Confirm appointment →"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ============================================================
         CALL PATIENT MODAL
      ============================================================ */}

      {showCallForm && (
        <div className="modal-overlay">
          <div className="modal">
            <button
              className="close"
              onClick={() => {
                setShowCallForm(false);
                setMessage("");
              }}
            >
              ×
            </button>

            <div className="modal-icon">☎</div>

            <div className="eyebrow">
              CLINICCALL AI
            </div>

            <h2>Call patient</h2>

            <p>
              Select an appointment and ClinicCall AI will
              start the patient call.
            </p>

            <form onSubmit={callPatient}>
              <label>Appointment</label>

              <select
                value={selectedAppointment}
                onChange={(e) =>
                  setSelectedAppointment(e.target.value)
                }
                required
              >
                <option value="">
                  Select an appointment
                </option>

                {appointments.map((appointment) => (
                  <option
                    key={appointment.id}
                    value={appointment.id}
                  >
                    #{appointment.id} —{" "}
                    {getPatientName(
                      appointment.patient_id
                    )}{" "}
                    — {appointment.appointment_date}{" "}
                    {appointment.appointment_time}
                  </option>
                ))}
              </select>

              {message && (
                <div
                  className={
                    message.includes("successfully")
                      ? "success-message"
                      : "error-message"
                  }
                >
                  {message}
                </div>
              )}

              <button
                className="submit-btn"
                type="submit"
                disabled={loading}
              >
                {loading
                  ? "Calling..."
                  : "☎ Start patient call"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;