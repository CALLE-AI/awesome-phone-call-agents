import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:8000";

function App() {
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

  // ============================================================
  // LOAD DATA
  // ============================================================

  useEffect(() => {
    loadPatients();
    loadAppointments();
    loadCalls();
  }, []);

  async function loadPatients() {
    try {
      const response = await fetch(`${API_URL}/patients`);

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
      const response = await fetch(`${API_URL}/appointments`);

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
      const response = await fetch(`${API_URL}/call-history`);

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

  // ============================================================
  // PHONE NUMBER NORMALIZATION
  // ============================================================

  function normalizeKenyanPhone(phone) {
    let value = String(phone || "").trim();

    // Remove spaces, hyphens and brackets
    value = value
      .replace(/\s+/g, "")
      .replace(/-/g, "")
      .replace(/\(/g, "")
      .replace(/\)/g, "");

    // 0712345678 -> +254712345678
    if (value.startsWith("0")) {
      value = "+254" + value.substring(1);
    }

    // 254712345678 -> +254712345678
    else if (value.startsWith("254")) {
      value = "+" + value;
    }

    return value;
  }

  function isValidKenyanPhone(phone) {
    return /^\+254\d{9}$/.test(phone);
  }

  // ============================================================
  // ADD PATIENT
  // ============================================================

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
      console.log("Creating patient:", {
        name,
        phone_number: phone,
      });

      const response = await fetch(`${API_URL}/patients`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: name,
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

      console.log("Create patient response:", response.status, data);

      if (!response.ok) {
        let errorMessage = "Could not create patient.";

        if (typeof data.detail === "string") {
          errorMessage = data.detail;
        } else if (Array.isArray(data.detail)) {
          errorMessage = data.detail
            .map((item) => {
              if (typeof item === "string") return item;

              return (
                item.msg ||
                item.message ||
                JSON.stringify(item)
              );
            })
            .join(", ");
        }

        setMessage(
          `Patient creation failed (${response.status}): ${errorMessage}`
        );

        return;
      }

      setMessage("Patient added successfully ✓");

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

  // ============================================================
  // ADD APPOINTMENT
  // ============================================================

  async function addAppointment(event) {
    event.preventDefault();

    if (
      !selectedPatient ||
      !appointmentDate ||
      !appointmentTime
    ) {
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
        setMessage(
          typeof data.detail === "string"
            ? data.detail
            : `Could not create appointment (${response.status}).`
        );
        return;
      }

      setMessage("Appointment created successfully ✓");

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

      setMessage(
        "Could not connect to the ClinicCall API."
      );
    } finally {
      setLoading(false);
    }
  }

  // ============================================================
  // CALL PATIENT
  // ============================================================

  async function callPatient(patientId) {
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

    const phone = normalizeKenyanPhone(
      patient.phone_number
    );

    if (!isValidKenyanPhone(phone)) {
      setMessage(
        `Invalid phone number for ${patient.name}: ${patient.phone_number}`
      );
      return;
    }

    setCalling(true);
    setLoading(true);
    setCallingPatient(patientId);
    setCallStatus("Starting AI call...");
    setMessage("");

    try {
      console.log("----------------------------------------");
      console.log("STARTING PATIENT CALL");
      console.log("Patient:", patient.name);
      console.log("Phone:", phone);
      console.log("----------------------------------------");

      const response = await fetch(`${API_URL}/call-patient`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          patient_id: Number(patientId),
        }),
      });

      const text = await response.text();

      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      console.log(
        "Call response:",
        response.status,
        data
      );

      if (!response.ok) {
        setCallStatus("Call failed");

        let errorMessage =
          "Could not start the patient call.";

        if (typeof data.detail === "string") {
          errorMessage = data.detail;
        } else if (Array.isArray(data.detail)) {
          errorMessage = data.detail
            .map((item) => {
              if (typeof item === "string") return item;

              return (
                item.msg ||
                item.message ||
                JSON.stringify(item)
              );
            })
            .join(", ");
        }

        setMessage(
          `Call failed (${response.status}): ${errorMessage}`
        );

        return;
      }

      setCallStatus("AI call completed ✓");

      setMessage(
        `ClinicCall successfully contacted ${patient.name}.`
      );

      await loadCalls();

      setTimeout(() => {
        loadCalls();
      }, 1500);
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

  // ============================================================
  // HELPERS
  // ============================================================

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

    return patient
      ? patient.phone_number
      : "";
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
    return (
      call?.call_status ||
      call?.status ||
      "completed"
    );
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

  // ============================================================
  // UI
  // ============================================================

  return (
    <div className="clinic-app">

      {/* SIDEBAR */}

      <aside className="sidebar">

        <div className="logo">
          <div className="logo-icon">✚</div>

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
          <span>⌂</span>
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
          <span>▣</span>
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
          <span>♙</span>
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
          <span>☎</span>
          Call Center
        </button>

        <div className="sidebar-bottom">

          <div className="ai-box">

            <div className="ai-icon">
              ☎
            </div>

            <div>
              <strong>
                AI Call Center
              </strong>

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
              <strong>
                Clinic Admin
              </strong>

              <span>
                Demo Clinic
              </span>
            </div>

            <b>⌄</b>

          </div>

        </div>

      </aside>

      {/* MAIN */}

      <main className="main-content">

        {/* TOPBAR */}

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
              ♙ &nbsp; Add patient
            </button>

            <button
              className="primary-button"
              onClick={() =>
                setShowAppointmentForm(true)
              }
            >
              + &nbsp; New appointment
            </button>

          </div>

        </header>

        {/* MESSAGE */}

        {message && (
          <div className="message">
            {message}
          </div>
        )}

        {/* CALL STATUS */}

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

              {calling ? (
                <span className="phone-pulse">
                  ☎
                </span>
              ) : (
                "✓"
              )}

            </div>

            <div>

              <strong>
                {callStatus}
              </strong>

              {callingPatient && (

                <span>

                  Patient:{" "}
                  {getPatientName(
                    callingPatient
                  )}

                  {getPatientPhone(
                    callingPatient
                  ) && (
                    <>
                      {" • "}
                      {getPatientPhone(
                        callingPatient
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

        {/* ====================================================
            DASHBOARD
        ==================================================== */}

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
                  <span>
                    connected.
                  </span>
                </h2>

                <p>
                  Manage patients,
                  appointments and
                  automated patient
                  communication from
                  one simple dashboard.
                </p>

                <button
                  className="hero-button"
                  onClick={() =>
                    setPage("Call Center")
                  }
                >
                  ☎ &nbsp; Open Call Center
                  <span>→</span>
                </button>

                <div className="hero-features">
                  <span>◉ Secure</span>
                  <span>⚡ Fast</span>
                  <span>✓ Reliable</span>
                </div>

              </div>

              <div className="doctor-area">

                <div className="doctor-glow"></div>

                <div className="heartbeat">
                  〰〰〰〰〰
                </div>

                <img
                  src="https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=900&q=85"
                  alt="Doctor"
                  className="doctor-image"
                />

                <div className="phone-floating">
                  ☎
                </div>

              </div>

            </section>

            <section className="stats">

              <div className="stat-card">

                <div className="stat-icon green">
                  ♙
                </div>

                <span>
                  Patients
                </span>

                <strong>
                  {patients.length}
                </strong>

                <small>
                  Total patients
                </small>

              </div>

              <div className="stat-card">

                <div className="stat-icon purple">
                  ▣
                </div>

                <span>
                  Appointments
                </span>

                <strong>
                  {appointments.length}
                </strong>

                <small>
                  Scheduled
                </small>

              </div>

              <div className="stat-card">

                <div className="stat-icon blue">
                  ☎
                </div>

                <span>
                  AI Calls
                </span>

                <strong>
                  {calls.length}
                </strong>

                <small>
                  Patient calls
                </small>

              </div>

              <div className="stat-card">

                <div className="stat-icon orange">
                  ✓
                </div>

                <span>
                  System Status
                </span>

                <strong className="online-text">
                  Online
                </strong>

                <small>
                  AI calling system operational
                </small>

              </div>

            </section>

            <section className="dashboard-grid">

              {/* UPCOMING APPOINTMENTS */}

              <div className="card">

                <div className="card-header">

                  <div>

                    <h2>
                      📅 Upcoming Appointments
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
                      Create an appointment
                      to see it here.
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
                              {getPatientPhone(
                                appointment.patient_id
                              )}
                            </span>

                          </div>

                          <div className="appointment-time">

                            <strong>
                              {appointment.appointment_date}
                            </strong>

                            <span>
                              {appointment.appointment_time}
                            </span>

                          </div>

                          <button
                            className="call-small"
                            onClick={() =>
                              callPatient(
                                appointment.patient_id
                              )
                            }
                            disabled={calling}
                          >
                            {calling &&
                            Number(callingPatient) ===
                              Number(
                                appointment.patient_id
                              )
                              ? "☎ Calling..."
                              : "☎ Call"}
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

              {/* RECENT CALLS */}

              <div className="card">

                <div className="card-header">

                  <div>

                    <h2>
                      ☎ Recent Calls
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
                          className="appointment-row"
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
                              {call.phone_number ||
                                "AI Patient Call"}
                            </span>

                          </div>

                          <div
                            className={getCallStatusClass(
                              status
                            )}
                          >
                            {String(status)
                              .toLowerCase() ===
                            "completed"
                              ? "✓ Completed"
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
                ☎
              </div>

              <div>

                <h3>
                  ClinicCall AI Call Center
                </h3>

                <p>
                  Your AI voice assistant is
                  ready to help your patients.
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

        {/* ====================================================
            PATIENTS
        ==================================================== */}

        {page === "Patients" && (

          <section className="card full-card">

            <div className="card-header">

              <div>

                <h2>
                  👥 Patients
                </h2>

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
                      {patient.phone_number}
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
                        ? "☎ Calling..."
                        : "☎ Call patient"}
                    </button>

                  </div>

                ))}

              </div>

            )}

          </section>

        )}

        {/* ====================================================
            APPOINTMENTS
        ==================================================== */}

        {page === "Appointments" && (

          <section className="card full-card">

            <div className="card-header">

              <div>

                <h2>
                  📅 Appointments
                </h2>

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
                  Create an appointment
                  to get started.
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
                          {getPatientPhone(
                            appointment.patient_id
                          )}
                        </span>

                      </div>

                      <div className="appointment-date">

                        <strong>
                          {appointment.appointment_date}
                        </strong>

                        <span>
                          {appointment.appointment_time}
                        </span>

                      </div>

                      <button
                        className="call-small"
                        onClick={() =>
                          callPatient(
                            appointment.patient_id
                          )
                        }
                        disabled={calling}
                      >
                        {calling &&
                        Number(callingPatient) ===
                          Number(
                            appointment.patient_id
                          )
                          ? "☎ Calling..."
                          : "☎ Call patient"}
                      </button>

                    </div>

                  );
                }
              )

            )}

          </section>

        )}

        {/* ====================================================
            CALL CENTER
        ==================================================== */}

        {page === "Call Center" && (

          <section className="call-page">

            <div className="call-hero">

              <div className="big-call-icon">
                ☎
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
                    📞 Patient Calling
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
                          {patient.phone_number}
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
                          ? "☎ Calling..."
                          : "☎ Call"}
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
                  ↻ Refresh
                </button>

              </div>

              {calls.length === 0 ? (

                <div className="empty">

                  <h3>
                    No calls yet
                  </h3>

                  <p>
                    Start a patient call above.
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
                          {call.phone_number ||
                            "AI patient call"}
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

      {/* ======================================================
          ADD PATIENT MODAL
      ====================================================== */}

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
              ♙
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

      {/* ======================================================
          APPOINTMENT MODAL
      ====================================================== */}

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
              ▣
            </div>

            <h2>
              New appointment
            </h2>

            <p>
              Schedule a patient appointment.
            </p>

            <form onSubmit={addAppointment}>

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
                    {patient.phone_number}
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