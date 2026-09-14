import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "https://cliniccall-api.onrender.com";

function maskPhoneNumber(phone) {
  if (!phone) return "";

  const value = String(phone);

  if (value.length <= 4) {
    return "••••";
  }

  return `${value.slice(0, 4)}•••••${value.slice(-4)}`;
}

function App() {
  const [operatorUsername, setOperatorUsername] = useState(
    sessionStorage.getItem("cliniccall_operator_username") || ""
  );
  const [operatorPassword, setOperatorPassword] = useState("");

  const [authenticated, setAuthenticated] = useState(
    Boolean(sessionStorage.getItem("cliniccall_operator_username"))
  );

  const [authError, setAuthError] = useState("");
  const [page, setPage] = useState("Dashboard");

  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [calls, setCalls] = useState([]);

  const [showPatientForm, setShowPatientForm] = useState(false);
  const [showAppointmentForm, setShowAppointmentForm] = useState(false);

  const [newPatientName, setNewPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");

  const [selectedPatient, setSelectedPatient] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");

  const [message, setMessage] = useState("");
  const [callStatus, setCallStatus] = useState("");
  const [callingPatient, setCallingPatient] = useState(null);
  const [calling, setCalling] = useState(false);
  const [loading, setLoading] = useState(false);

  function getAuthHeader() {
    if (!operatorUsername || !operatorPassword) {
      return {};
    }

    return {
      Authorization: `Basic ${btoa(
        `${operatorUsername}:${operatorPassword}`
      )}`,
    };
  }

  async function apiFetch(url, options = {}) {
    const headers = {
      Accept: "application/json",
      ...getAuthHeader(),
      ...(options.headers || {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      sessionStorage.removeItem("cliniccall_operator_username");
      setAuthenticated(false);
      setOperatorPassword("");
      setAuthError("Session expired. Please sign in again.");
    }

    return response;
  }

  async function handleLogin(event) {
    event.preventDefault();

    setAuthError("");
    setMessage("");

    if (!operatorUsername.trim() || !operatorPassword) {
      setAuthError("Enter your operator username and password.");
      return;
    }

    try {
      const username = operatorUsername.trim();

      const response = await fetch(`${API_URL}/patients`, {
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${btoa(
            `${username}:${operatorPassword}`
          )}`,
        },
      });

      if (response.status === 401) {
        setAuthenticated(false);
        setAuthError("Invalid operator username or password.");
        return;
      }

      if (!response.ok) {
        setAuthError(
          `Could not sign in (${response.status}). Please try again.`
        );
        return;
      }

      sessionStorage.setItem(
        "cliniccall_operator_username",
        username
      );

      setOperatorUsername(username);
      setAuthenticated(true);
      setAuthError("");
    } catch (error) {
      console.error("Login error:", error);
      setAuthError("Could not connect to the ClinicCall API.");
    }
  }

  function logout() {
    sessionStorage.removeItem("cliniccall_operator_username");

    setAuthenticated(false);
    setOperatorPassword("");
    setPatients([]);
    setAppointments([]);
    setCalls([]);
    setMessage("");
    setCallStatus("");
  }

  useEffect(() => {
    if (!authenticated) return;

    loadPatients();
    loadAppointments();
    loadCalls();
  }, [authenticated]);

  async function loadPatients() {
    try {
      const response = await apiFetch(`${API_URL}/patients`);

      if (!response.ok) {
        console.error("Could not load patients:", response.status);
        return;
      }

      const data = await response.json();

      setPatients(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Patients error:", error);
    }
  }

  async function loadAppointments() {
    try {
      const response = await apiFetch(`${API_URL}/appointments`);

      if (!response.ok) {
        console.error(
          "Could not load appointments:",
          response.status
        );
        return;
      }

      const data = await response.json();

      setAppointments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Appointments error:", error);
    }
  }

  async function loadCalls() {
    try {
      const response = await apiFetch(`${API_URL}/call-history`);

      if (!response.ok) {
        console.error("Could not load calls:", response.status);
        return;
      }

      const data = await response.json();

      setCalls(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Calls error:", error);
    }
  }

  function normalizeKenyanPhone(phone) {
    let value = String(phone || "").trim();

    value = value
      .replace(/\s+/g, "")
      .replace(/-/g, "")
      .replace(/\(/g, "")
      .replace(/\)/g, "");

    if (value.startsWith("0")) {
      value = "+254" + value.substring(1);
    } else if (value.startsWith("254")) {
      value = "+" + value;
    }

    return value;
  }

  function isValidKenyanPhone(phone) {
    return /^\+254\d{9}$/.test(phone);
  }

  async function addPatient(event) {
    event.preventDefault();

    const name = newPatientName.trim();
    const phone = normalizeKenyanPhone(patientPhone);

    setMessage("");

    if (!name) {
      setMessage("Please enter the patient's name.");
      return;
    }

    if (!phone) {
      setMessage("Please enter the patient's phone number.");
      return;
    }

    if (!isValidKenyanPhone(phone)) {
      setMessage(
        "Invalid Kenyan phone number. Use 0712345678 or +254712345678."
      );
      return;
    }

    setLoading(true);

    try {
      const response = await apiFetch(`${API_URL}/patients`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name,
          phone_number: phone,
        }),
      });

      const text = await response.text();

      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        let errorMessage = "Could not create patient.";

        if (typeof data.detail === "string") {
          errorMessage = data.detail;
        } else if (Array.isArray(data.detail)) {
          errorMessage = data.detail
            .map((item) =>
              typeof item === "string"
                ? item
                : item.msg ||
                  item.message ||
                  JSON.stringify(item)
            )
            .join(", ");
        }

        setMessage(
          `Patient creation failed (${response.status}): ${errorMessage}`
        );

        return;
      }

      setMessage("Patient added successfully.");

      setNewPatientName("");
      setPatientPhone("");

      await loadPatients();

      setTimeout(() => {
        setShowPatientForm(false);
        setMessage("");
      }, 1200);
    } catch (error) {
      console.error("Create patient error:", error);

      setMessage(
        "Could not connect to the ClinicCall API. Make sure the backend is running."
      );
    } finally {
      setLoading(false);
    }
  }

  async function addAppointment(event) {
    event.preventDefault();

    if (!selectedPatient || !appointmentDate || !appointmentTime) {
      setMessage("Please complete all appointment fields.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await apiFetch(`${API_URL}/appointments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          patient_id: Number(selectedPatient),
          appointment_date: appointmentDate,
          appointment_time: appointmentTime,
          clinic_name: "ClinicCall Demo Clinic",
        }),
      });

      const text = await response.text();

      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        let errorMessage = `Could not create appointment (${response.status}).`;

        if (typeof data.detail === "string") {
          errorMessage = data.detail;
        } else if (Array.isArray(data.detail)) {
          errorMessage = data.detail
            .map((item) =>
              typeof item === "string"
                ? item
                : item.msg ||
                  item.message ||
                  JSON.stringify(item)
            )
            .join(", ");
        }

        setMessage(errorMessage);
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
      }, 1200);
    } catch (error) {
      console.error("Appointment error:", error);
      setMessage("Could not connect to the ClinicCall API.");
    } finally {
      setLoading(false);
    }
  }

  /*
   * ClinicCall call request.
   *
   * Direct patient call:
   * {
   *   patient_id,
   *   destination_authorized
   * }
   *
   * Appointment call:
   * {
   *   patient_id,
   *   appointment_id,
   *   destination_authorized
   * }
   *
   * patient_id is ALWAYS included.
   */
  async function callPatient(patientId, appointmentId = null) {
    if (!patientId) {
      setMessage("This patient does not have a valid ID.");
      return;
    }

    if (calling) {
      setMessage("A patient call is already in progress.");
      return;
    }

    const patient = patients.find(
      (item) => Number(item.id) === Number(patientId)
    );

    if (!patient) {
      setMessage("Patient could not be found.");
      return;
    }

    const authorized = window.confirm(
      `You are about to start an AI call to ${patient.name}.\n\n` +
        "Confirm that this patient has authorized ClinicCall to contact this destination."
    );

    if (!authorized) {
      setMessage(
        "Call cancelled. Destination authorization was not confirmed."
      );
      return;
    }

    setCalling(true);
    setLoading(true);
    setCallingPatient(patientId);
    setCallStatus("Starting AI call...");
    setMessage("");

    try {
      const requestBody = {
        patient_id: Number(patientId),
        destination_authorized: true,
      };

      if (
        appointmentId !== null &&
        appointmentId !== undefined
      ) {
        requestBody.appointment_id = Number(appointmentId);
      }

      console.log(
        "ClinicCall request body:",
        requestBody
      );

      const response = await apiFetch(`${API_URL}/call-patient`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const text = await response.text();

      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      console.log(
        "ClinicCall response:",
        response.status,
        data
      );

      if (!response.ok) {
        setCallStatus("Call failed");

        let errorMessage = "Could not start the patient call.";

        if (typeof data.detail === "string") {
          errorMessage = data.detail;
        } else if (Array.isArray(data.detail)) {
          errorMessage = data.detail
            .map((item) =>
              typeof item === "string"
                ? item
                : item.msg ||
                  item.message ||
                  JSON.stringify(item)
            )
            .join(", ");
        }

        setMessage(
          `Call failed (${response.status}): ${errorMessage}`
        );

        return;
      }

      setCallStatus("AI call completed");

      setMessage(
        `ClinicCall successfully contacted ${patient.name}.`
      );

      await loadCalls();

      setTimeout(loadCalls, 1500);
    } catch (error) {
      console.error("Call error:", error);

      setCallStatus("Connection error");

      setMessage(
        "Could not connect to the ClinicCall API. Please check that the backend is running."
      );
    } finally {
      setCalling(false);
      setLoading(false);
    }
  }

  function getPatientName(patientId) {
    const patient = patients.find(
      (item) => Number(item.id) === Number(patientId)
    );

    return patient
      ? patient.name
      : `Patient #${patientId}`;
  }

  function getPatientPhone(patientId) {
    const patient = patients.find(
      (item) => Number(item.id) === Number(patientId)
    );

    return patient ? patient.phone_number : "";
  }

  function getInitials(name) {
    if (!name) return "PT";

    return name
      .split(" ")
      .filter(Boolean)
      .map((word) => word[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  function getCallStatus(call) {
    return call?.call_status || call?.status || "completed";
  }

  function getCallStatusClass(status) {
    const value = String(status || "").toLowerCase();

    if (
      value.includes("fail") ||
      value.includes("error")
    ) {
      return "completed failed-status";
    }

    if (
      value.includes("calling") ||
      value.includes("progress")
    ) {
      return "completed calling-status";
    }

    return "completed";
  }

  if (!authenticated) {
    return (
      <div className="clinic-app">
        <main
          className="main-content"
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <section
            className="card full-card"
            style={{
              maxWidth: "460px",
              width: "100%",
            }}
          >
            <div className="card-header">
              <div>
                <h2>ClinicCall Operator Sign In</h2>

                <p>
                  Sign in to access patient records,
                  appointments and AI calling.
                </p>
              </div>
            </div>

            {authError && (
              <div className="message">
                {authError}
              </div>
            )}

            <form onSubmit={handleLogin}>
              <label>Operator username</label>

              <input
                value={operatorUsername}
                onChange={(event) =>
                  setOperatorUsername(event.target.value)
                }
                placeholder="Enter username"
                autoComplete="username"
                required
              />

              <label>Password</label>

              <input
                type="password"
                value={operatorPassword}
                onChange={(event) =>
                  setOperatorPassword(event.target.value)
                }
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />

              <button
                className="primary-button full"
                type="submit"
              >
                Sign in
              </button>
            </form>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="clinic-app">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">+</div>

          <div>
            <h2>ClinicCall</h2>
            <span>Smart Healthcare</span>
          </div>
        </div>

        <div className="menu-title">
          WORKSPACE
        </div>

        <button
          className={
            page === "Dashboard"
              ? "menu active"
              : "menu"
          }
          onClick={() => setPage("Dashboard")}
        >
          <span>Home</span>
          Dashboard
        </button>

        <button
          className={
            page === "Appointments"
              ? "menu active"
              : "menu"
          }
          onClick={() => setPage("Appointments")}
        >
          <span>Calendar</span>
          Appointments
        </button>

        <button
          className={
            page === "Patients"
              ? "menu active"
              : "menu"
          }
          onClick={() => setPage("Patients")}
        >
          <span>Users</span>
          Patients
        </button>

        <button
          className={
            page === "Call Center"
              ? "menu active"
              : "menu"
          }
          onClick={() => setPage("Call Center")}
        >
          <span>Phone</span>
          Call Center
        </button>

        <div className="sidebar-bottom">
          <div className="ai-box">
            <div className="ai-icon">
              Phone
            </div>

            <div>
              <strong>AI Call Center</strong>

              <span>
                <i></i>
                Online & Ready
              </span>
            </div>
          </div>

          <div className="admin-box">
            <div className="admin-avatar">
              C
            </div>

            <div>
              <strong>Clinic Admin</strong>
              <span>Demo Clinic</span>
            </div>

            <button
              type="button"
              onClick={logout}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: "18px",
              }}
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <small>
              CLINICCALL WORKSPACE
            </small>

            <h1>
              {page}
              {page === "Dashboard" && " 👋"}
            </h1>
          </div>

          <div className="top-buttons">
            <button
              className="secondary-button"
              onClick={() =>
                setShowPatientForm(true)
              }
            >
              Add patient
            </button>

            <button
              className="primary-button"
              onClick={() =>
                setShowAppointmentForm(true)
              }
            >
              + New appointment
            </button>
          </div>
        </header>

        {message && (
          <div className="message">
            {message}
          </div>
        )}

        {callStatus && (
          <div
            className={
              callStatus === "Call failed" ||
              callStatus === "Connection error"
                ? "call-status failed"
                : "call-status"
            }
          >
            <div className="call-status-icon">
              {calling ? "Phone" : "✓"}
            </div>

            <div>
              <strong>{callStatus}</strong>

              {callingPatient && (
                <span>
                  Patient:{" "}
                  {getPatientName(callingPatient)}

                  {getPatientPhone(
                    callingPatient
                  ) && (
                    <>
                      {" • "}
                      {maskPhoneNumber(
                        getPatientPhone(
                          callingPatient
                        )
                      )}
                    </>
                  )}
                </span>
              )}
            </div>

            {calling && (
              <div className="calling-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            )}
          </div>
        )}

        {page === "Dashboard" && (
          <>
            <section className="hero">
              <div className="hero-content">
                <div className="online-badge">
                  <i></i>
                  AI CALL CENTER ONLINE
                </div>

                <h2>
                  Keep your patients
                  <br />
                  <span>connected.</span>
                </h2>

                <p>
                  Manage patients, appointments and
                  automated patient communication
                  from one simple dashboard.
                </p>

                <button
                  className="hero-button"
                  onClick={() =>
                    setPage("Call Center")
                  }
                >
                  Open Call Center
                  <span>→</span>
                </button>

                <div className="hero-features">
                  <span>Secure</span>
                  <span>Fast</span>
                  <span>Reliable</span>
                </div>
              </div>

              <div className="doctor-area">
                <div className="doctor-glow"></div>

                <div className="heartbeat">
                  ~ ~ ~ ~ ~
                </div>

                <img
                  src="https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=900&q=85"
                  alt="Doctor"
                  className="doctor-image"
                />

                <div className="phone-floating">
                  Phone
                </div>
              </div>
            </section>

            <section className="stats">
              <div className="stat-card">
                <div className="stat-icon green">
                  Users
                </div>

                <span>Patients</span>
                <strong>
                  {patients.length}
                </strong>
                <small>
                  Total patients
                </small>
              </div>

              <div className="stat-card">
                <div className="stat-icon purple">
                  Calendar
                </div>

                <span>Appointments</span>
                <strong>
                  {appointments.length}
                </strong>
                <small>
                  Scheduled
                </small>
              </div>

              <div className="stat-card">
                <div className="stat-icon blue">
                  Phone
                </div>

                <span>AI Calls</span>
                <strong>
                  {calls.length}
                </strong>
                <small>
                  Patient calls
                </small>
              </div>

              <div className="stat-card">
                <div className="stat-icon orange">
                  OK
                </div>

                <span>System Status</span>

                <strong className="online-text">
                  Online
                </strong>

                <small>
                  AI calling system operational
                </small>
              </div>
            </section>

            <section className="dashboard-grid">
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2>
                      Upcoming Appointments
                    </h2>

                    <p>
                      Your latest appointments
                    </p>
                  </div>

                  <button
                    onClick={() =>
                      setPage("Appointments")
                    }
                  >
                    View all
                  </button>
                </div>

                {appointments.length === 0 ? (
                  <div className="empty">
                    <h3>
                      No appointments yet
                    </h3>

                    <p>
                      Create an appointment to
                      see it here.
                    </p>
                  </div>
                ) : (
                  appointments
                    .slice(0, 5)
                    .map((appointment) => {
                      const name =
                        getPatientName(
                          appointment.patient_id
                        );

                      return (
                        <div
                          className="appointment-row"
                          key={appointment.id}
                        >
                          <div className="patient-avatar">
                            {getInitials(name)}
                          </div>

                          <div className="patient-info">
                            <strong>
                              {name}
                            </strong>

                            <span>
                              {maskPhoneNumber(
                                getPatientPhone(
                                  appointment.patient_id
                                )
                              )}
                            </span>
                          </div>

                          <div className="appointment-time">
                            <strong>
                              {
                                appointment.appointment_date
                              }
                            </strong>

                            <span>
                              {
                                appointment.appointment_time
                              }
                            </span>
                          </div>

                          <button
                            className="call-small"
                            onClick={() =>
                              callPatient(
                                appointment.patient_id,
                                appointment.id
                              )
                            }
                            disabled={calling}
                          >
                            {calling &&
                            Number(callingPatient) ===
                              Number(
                                appointment.patient_id
                              )
                              ? "Calling..."
                              : "Call"}
                          </button>
                        </div>
                      );
                    })
                )}

                {appointments.length > 0 && (
                  <button
                    className="view-bottom"
                    onClick={() =>
                      setPage("Appointments")
                    }
                  >
                    View all appointments →
                  </button>
                )}
              </div>

              <div className="card">
                <div className="card-header">
                  <div>
                    <h2>
                      Recent Calls
                    </h2>

                    <p>
                      Latest patient communication
                    </p>
                  </div>

                  <button
                    onClick={() =>
                      setPage("Call Center")
                    }
                  >
                    View all
                  </button>
                </div>

                {calls.length === 0 ? (
                  <div className="empty">
                    <h3>
                      No calls yet
                    </h3>

                    <p>
                      Patient calls will appear
                      here.
                    </p>
                  </div>
                ) : (
                  calls
                    .slice(0, 5)
                    .map((call, index) => {
                      const name = call.patient_id
                        ? getPatientName(
                            call.patient_id
                          )
                        : "Patient call";

                      const status =
                        getCallStatus(call);

                      return (
                        <div
                          className="appointment-row"
                          key={call.id || index}
                        >
                          <div className="patient-avatar blue-avatar">
                            {getInitials(name)}
                          </div>

                          <div className="patient-info">
                            <strong>
                              {name}
                            </strong>

                            <span>
                              {maskPhoneNumber(
                                call.phone_number
                              ) ||
                                "AI Patient Call"}
                            </span>
                          </div>

                          <div
                            className={getCallStatusClass(
                              status
                            )}
                          >
                            {String(
                              status
                            ).toLowerCase() ===
                            "completed"
                              ? "Completed"
                              : status}
                          </div>
                        </div>
                      );
                    })
                )}

                {calls.length > 0 && (
                  <button
                    className="view-bottom"
                    onClick={() =>
                      setPage("Call Center")
                    }
                  >
                    View all calls →
                  </button>
                )}
              </div>
            </section>

            <section className="ai-banner">
              <div className="ai-banner-icon">
                Phone
              </div>

              <div>
                <h3>
                  ClinicCall AI Call Center
                </h3>

                <p>
                  Your AI voice assistant is ready
                  to help your patients.
                </p>
              </div>

              <button
                onClick={() =>
                  setPage("Call Center")
                }
              >
                Open Call Center →
              </button>
            </section>
          </>
        )}

        {page === "Patients" && (
          <section className="card full-card">
            <div className="card-header">
              <div>
                <h2>Patients</h2>

                <p>
                  Patients stored in your
                  ClinicCall database.
                </p>
              </div>

              <button
                className="primary-button"
                onClick={() =>
                  setShowPatientForm(true)
                }
              >
                + Add patient
              </button>
            </div>

            {patients.length === 0 ? (
              <div className="empty">
                <h3>
                  No patients found
                </h3>

                <p>
                  Add your first patient.
                </p>
              </div>
            ) : (
              <div className="patients-grid">
                {patients.map((patient) => (
                  <div
                    className="patient-big-card"
                    key={patient.id}
                  >
                    <div className="big-avatar">
                      {getInitials(
                        patient.name
                      )}
                    </div>

                    <h3>
                      {patient.name}
                    </h3>

                    <p>
                      {maskPhoneNumber(
                        patient.phone_number
                      )}
                    </p>

                    <small>
                      Patient ID: {patient.id}
                    </small>

                    <button
                      className="patient-call-button"
                      onClick={() =>
                        callPatient(
                          patient.id
                        )
                      }
                      disabled={calling}
                    >
                      {calling &&
                      Number(callingPatient) ===
                        Number(patient.id)
                        ? "Calling..."
                        : "Call patient"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {page === "Appointments" && (
          <section className="card full-card">
            <div className="card-header">
              <div>
                <h2>Appointments</h2>

                <p>
                  Manage your clinic
                  appointments.
                </p>
              </div>

              <button
                className="primary-button"
                onClick={() =>
                  setShowAppointmentForm(true)
                }
              >
                + New appointment
              </button>
            </div>

            {appointments.length === 0 ? (
              <div className="empty">
                <h3>
                  No appointments yet
                </h3>

                <p>
                  Create an appointment to
                  get started.
                </p>
              </div>
            ) : (
              appointments.map(
                (appointment) => {
                  const name =
                    getPatientName(
                      appointment.patient_id
                    );

                  return (
                    <div
                      className="appointment-full-row"
                      key={appointment.id}
                    >
                      <div className="patient-avatar">
                        {getInitials(name)}
                      </div>

                      <div className="patient-info">
                        <strong>
                          {name}
                        </strong>

                        <span>
                          {maskPhoneNumber(
                            getPatientPhone(
                              appointment.patient_id
                            )
                          )}
                        </span>
                      </div>

                      <div className="appointment-date">
                        <strong>
                          {
                            appointment.appointment_date
                          }
                        </strong>

                        <span>
                          {
                            appointment.appointment_time
                          }
                        </span>
                      </div>

                      <button
                        className="call-small"
                        onClick={() =>
                          callPatient(
                            appointment.patient_id,
                            appointment.id
                          )
                        }
                        disabled={calling}
                      >
                        {calling &&
                        Number(callingPatient) ===
                          Number(
                            appointment.patient_id
                          )
                          ? "Calling..."
                          : "Call patient"}
                      </button>
                    </div>
                  );
                }
              )
            )}
          </section>
        )}

        {page === "Call Center" && (
          <section className="call-page">
            <div className="call-hero">
              <div className="big-call-icon">
                Phone
              </div>

              <div>
                <div className="online-badge">
                  <i></i>
                  AI CALL CENTER ONLINE
                </div>

                <h2>
                  ClinicCall AI
                </h2>

                <p>
                  Make real AI patient calls
                  directly from your clinic
                  dashboard.
                </p>
              </div>
            </div>

            <div className="card full-card">
              <div className="card-header">
                <div>
                  <h2>
                    Patient Calling
                  </h2>

                  <p>
                    Select a patient to start
                    an automated AI voice call.
                  </p>
                </div>
              </div>

              {patients.length === 0 ? (
                <div className="empty">
                  <h3>
                    No patients available
                  </h3>

                  <p>
                    Add a patient first to make
                    an AI call.
                  </p>

                  <button
                    className="primary-button"
                    onClick={() =>
                      setShowPatientForm(true)
                    }
                  >
                    + Add patient
                  </button>
                </div>
              ) : (
                <div className="call-patient-grid">
                  {patients.map((patient) => (
                    <div
                      className="call-patient-card"
                      key={patient.id}
                    >
                      <div className="patient-avatar">
                        {getInitials(
                          patient.name
                        )}
                      </div>

                      <div className="patient-info">
                        <strong>
                          {patient.name}
                        </strong>

                        <span>
                          {maskPhoneNumber(
                            patient.phone_number
                          )}
                        </span>
                      </div>

                      <button
                        className="primary-button"
                        onClick={() =>
                          callPatient(
                            patient.id
                          )
                        }
                        disabled={calling}
                      >
                        {calling &&
                        Number(callingPatient) ===
                          Number(patient.id)
                          ? "Calling..."
                          : "Call"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card full-card">
              <div className="card-header">
                <div>
                  <h2>
                    Recent Calls
                  </h2>

                  <p>
                    Patient communication
                    history
                  </p>
                </div>

                <button
                  onClick={loadCalls}
                >
                  Refresh
                </button>
              </div>

              {calls.length === 0 ? (
                <div className="empty">
                  <h3>
                    No calls yet
                  </h3>

                  <p>
                    Start a patient call
                    above.
                  </p>
                </div>
              ) : (
                calls.map((call, index) => {
                  const name =
                    call.patient_id
                      ? getPatientName(
                          call.patient_id
                        )
                      : "Patient call";

                  const status =
                    getCallStatus(call);

                  return (
                    <div
                      className="appointment-full-row"
                      key={
                        call.id || index
                      }
                    >
                      <div className="patient-avatar blue-avatar">
                        {getInitials(name)}
                      </div>

                      <div className="patient-info">
                        <strong>
                          {name}
                        </strong>

                        <span>
                          {maskPhoneNumber(
                            call.phone_number
                          ) ||
                            "AI Patient Call"}
                        </span>
                      </div>

                      <div
                        className={getCallStatusClass(
                          status
                        )}
                      >
                        {status}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        )}
      </main>

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

            <div className="modal-icon">
              +
            </div>

            <h2>
              Add new patient
            </h2>

            <p>
              Add a patient to your clinic.
            </p>

            <form onSubmit={addPatient}>
              <label>
                Patient name
              </label>

              <input
                value={newPatientName}
                onChange={(event) =>
                  setNewPatientName(
                    event.target.value
                  )
                }
                placeholder="e.g. Jane Doe"
                required
              />

              <label>
                Phone number
              </label>

              <input
                value={patientPhone}
                onChange={(event) =>
                  setPatientPhone(
                    event.target.value
                  )
                }
                placeholder="+254712345678"
                type="tel"
                required
              />

              <small>
                Example: +254712345678
              </small>

              <button
                className="primary-button full"
                disabled={loading}
              >
                {loading
                  ? "Adding..."
                  : "Add patient"}
              </button>
            </form>
          </div>
        </div>
      )}

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

            <div className="modal-icon">
              +
            </div>

            <h2>
              New appointment
            </h2>

            <p>
              Schedule a patient appointment.
            </p>

            <form
              onSubmit={addAppointment}
            >
              <label>
                Patient
              </label>

              <select
                value={selectedPatient}
                onChange={(event) =>
                  setSelectedPatient(
                    event.target.value
                  )
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
                    {patient.name} —{" "}
                    {maskPhoneNumber(
                      patient.phone_number
                    )}
                  </option>
                ))}
              </select>

              <label>
                Date
              </label>

              <input
                type="date"
                value={appointmentDate}
                onChange={(event) =>
                  setAppointmentDate(
                    event.target.value
                  )
                }
                required
              />

              <label>
                Time
              </label>

              <input
                type="time"
                value={appointmentTime}
                onChange={(event) =>
                  setAppointmentTime(
                    event.target.value
                  )
                }
                required
              />

              <button
                className="primary-button full"
                disabled={loading}
              >
                {loading
                  ? "Creating..."
                  : "Create appointment"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;