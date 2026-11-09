/* Single-page booking flow in plain JS (no framework or build step). State
   lives in memory; the profile and family are persisted server-side (db.py).
   There is no login: the browser is identified by a UUID kept in localStorage. */

// ---------------------------------------------------------------- state --

// Values must match signcall's AppointmentType enum (workflow/types.py).
const CLINIC_TYPES = [
  { value: "physical_therapy", label: "Physical Therapy" },
  { value: "eyes", label: "Eyes" },
  { value: "mental", label: "Mental Health" },
  { value: "general", label: "General" },
  { value: "ent", label: "ENT" },
  { value: "dental", label: "Dentist" },
];

const SETUP_STEPS = ["profileMethod", "profileData", "profileVerify", "familyList", "familyVerify"];

const state = {
  userId: null,
  // Family is stored with the profile; whether a visit needs an interpreter is
  // asked per booking (state.booking.has_interpreter).
  profile: { name: "", phone: "", age: "", dob: "", address: "", zipcode: "", insurance_name: "", insurance_id: "" },
  family: [],
  cardFiles: { id: null, insurance: null },
  transcript: "",
  parsed: { availability: [], clinic_type_hint: null },
  booking: { clinic_type: "", availability: [], has_interpreter: null },
};

function getUserId() {
  let id = localStorage.getItem("aslapp_user_id");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `u-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    localStorage.setItem("aslapp_user_id", id);
  }
  return id;
}

// ------------------------------------------------------------- helpers --

async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
async function apiPostJson(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `${path} -> ${res.status}`);
  }
  return res.json();
}
async function apiPostForm(path, formData) {
  const res = await fetch(path, { method: "POST", body: formData });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `${path} -> ${res.status}`);
  }
  return res.json();
}

function showLoading(message) {
  document.getElementById("loadingMsg").textContent = message;
  document.getElementById("loadingOverlay").classList.add("active");
}
function hideLoading() {
  document.getElementById("loadingOverlay").classList.remove("active");
}
function showBanner(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.add("show");
}
function hideBanner(id) {
  document.getElementById(id).classList.remove("show");
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
  else console.warn(`setVal: no element #${id} on this page -- is index.html up to date?`);
}

function isValidUSPhone(value) {
  const digits = (value || "").replace(/\D/g, "");
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}

function computeAge(dobStr) {
  if (!dobStr) return "";
  const dob = new Date(dobStr);
  if (isNaN(dob)) return "";
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : "";
}

// ------------------------------------------------------------ screens --

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");

  const stepBar = document.getElementById("stepBar");
  const idx = SETUP_STEPS.indexOf(id);
  if (idx === -1) {
    stepBar.style.display = "none";
  } else {
    stepBar.style.display = "flex";
    stepBar.innerHTML = "";
    SETUP_STEPS.forEach((_, i) => {
      const dot = document.createElement("div");
      dot.className = "dot" + (i < idx ? " done" : i === idx ? " current" : "");
      stepBar.appendChild(dot);
    });
  }
  window.scrollTo(0, 0);
}

// -------------------------------------------------------- app startup --

async function init() {
  state.userId = getUserId();
  wireUpAll();
  try {
    const res = await apiGet(`/profile/${state.userId}`);
    if (res.exists && res.profile && res.profile.name) {
      state.profile = { ...state.profile, ...res.profile };
      state.family = res.profile.family || [];
      // A saved profile missing a required field goes back to verify.
      const complete = state.profile.name && state.profile.phone && state.profile.dob
        && state.profile.insurance_name && state.profile.insurance_id && state.profile.zipcode;
      if (complete) {
        if (await resumeActiveRun()) return;
        showScreen("inputMethod");
        return;
      }
      fillProfileVerifyForm();
      showScreen("profileVerify");
      return;
    }
  } catch (e) {
    // no saved profile (or the server is unreachable): fall through to setup
  }
  showScreen("profileMethod");
}

// -------------------------------------------------- profile: method --

function wireProfileMethod() {
  document.getElementById("btnUpload").addEventListener("click", () => showScreen("profileUpload"));
  document.getElementById("btnManual").addEventListener("click", () => {
    fillProfileVerifyForm();
    showScreen("profileVerify");
  });
}

// -------------------------------------------------- profile: upload --

function wireProfileUpload() {
  const idInput = document.getElementById("idCardInput");
  const insInput = document.getElementById("insuranceCardInput");

  idInput.addEventListener("change", () => handleCardFile("id", idInput.files[0]));
  insInput.addEventListener("change", () => handleCardFile("insurance", insInput.files[0]));

  document.getElementById("btnUploadBack").addEventListener("click", () => showScreen("profileMethod"));
  document.getElementById("btnUploadContinue").addEventListener("click", onUploadContinue);
  updateUploadContinueState();
}

function handleCardFile(kind, file) {
  if (!file) return;
  state.cardFiles[kind] = file;
  const tile = document.getElementById(kind === "id" ? "idTile" : "insuranceTile");
  tile.classList.add("filled");
  const img = tile.querySelector("img");
  img.src = URL.createObjectURL(file);
  img.style.display = "block";
  updateUploadContinueState();
}

function updateUploadContinueState() {
  document.getElementById("btnUploadContinue").disabled = !(state.cardFiles.id || state.cardFiles.insurance);
}

async function onUploadContinue() {
  hideBanner("uploadError");
  showLoading("Reading your cards…");
  const merged = {};
  try {
    for (const file of [state.cardFiles.id, state.cardFiles.insurance]) {
      if (!file) continue;
      const fd = new FormData();
      fd.append("image", file);
      const fields = await apiPostForm("/extract-card", fd);
      for (const [k, v] of Object.entries(fields)) {
        if (v !== null && v !== "" && (merged[k] === undefined || merged[k] === "" || merged[k] === null)) {
          merged[k] = v;
        }
      }
    }
    state.profile = { ...state.profile, ...merged };
  } catch (e) {
    showBanner("uploadError", "Couldn't read a card. Fill in the details next.");
  } finally {
    hideLoading();
  }
  fillProfileVerifyForm();
  showScreen("profileVerify");
}

// -------------------------------------------------- profile: verify --

function fillProfileVerifyForm() {
  const p = state.profile;
  setVal("pf_name", p.name || "");
  setVal("pf_phone", p.phone || "");
  setVal("pf_dob", p.dob || "");
  setVal("pf_age", p.age || computeAge(p.dob) || "");
  setVal("pf_address", p.address || "");
  setVal("pf_zipcode", p.zipcode || "");
  setVal("pf_insurance_name", p.insurance_name || "");
  setVal("pf_insurance_id", p.insurance_id || "");
}

function wireProfileVerify() {
  document.getElementById("pf_dob").addEventListener("change", (e) => {
    const ageField = document.getElementById("pf_age");
    if (!ageField.value) ageField.value = computeAge(e.target.value);
  });
  document.getElementById("btnProfileBack").addEventListener("click", () => showScreen("profileMethod"));
  document.getElementById("btnProfileConfirm").addEventListener("click", () => {
    state.profile = {
      name: document.getElementById("pf_name").value.trim(),
      phone: document.getElementById("pf_phone").value.trim(),
      dob: document.getElementById("pf_dob").value,
      age: document.getElementById("pf_age").value ? Number(document.getElementById("pf_age").value) : "",
      address: document.getElementById("pf_address").value.trim(),
      zipcode: document.getElementById("pf_zipcode").value.trim(),
      insurance_name: document.getElementById("pf_insurance_name").value.trim(),
      insurance_id: document.getElementById("pf_insurance_id").value.trim(),
    };
    if (!state.profile.name || !state.profile.zipcode || !state.profile.dob
        || !state.profile.insurance_name || !state.profile.insurance_id) {
      showBanner("profileError", "Fill in name, birth date, zip, insurance.");
      return;
    }
    if (!isValidUSPhone(state.profile.phone)) {
      showBanner("profileError", "Enter a 10-digit phone number.");
      return;
    }
    hideBanner("profileError");
    renderFamilyList();
    showScreen("familyList");
  });
}

// -------------------------------------------------------- family list --

function addFamilyRow() {
  state.family.push({ name: "", relation: "", phone: "" });
}

function renderFamilyList() {
  const container = document.getElementById("familyCards");
  const empty = document.getElementById("familyEmptyHint");
  container.innerHTML = "";
  empty.style.display = state.family.length === 0 ? "block" : "none";
  state.family.forEach((member, i) => {
    const card = document.createElement("div");
    card.className = "family-card";
    card.innerHTML = `
      <div class="family-card-head">
        <span>Family member ${i + 1}</span>
        <button class="remove-link" data-i="${i}">Remove</button>
      </div>
      <div class="field"><label>Name</label><input type="text" data-field="name" data-i="${i}" value="${member.name}"></div>
      <div class="field"><label>Relation</label><input type="text" data-field="relation" data-i="${i}" placeholder="e.g. sister" value="${member.relation}"></div>
      <div class="field"><label>Phone number</label><input type="tel" data-field="phone" data-i="${i}" value="${member.phone}"></div>
    `;
    container.appendChild(card);
  });
  container.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      state.family[Number(e.target.dataset.i)][e.target.dataset.field] = e.target.value;
    });
  });
  container.querySelectorAll(".remove-link").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      state.family.splice(Number(e.target.dataset.i), 1);
      renderFamilyList();
    });
  });
}

function wireFamilyList() {
  document.getElementById("btnAddFamily").addEventListener("click", () => { addFamilyRow(); renderFamilyList(); });
  document.getElementById("btnFamilyBack").addEventListener("click", () => showScreen("profileVerify"));
  document.getElementById("btnFamilyContinue").addEventListener("click", () => {
    const incomplete = state.family.some((m) => !m.name || !m.phone);
    if (incomplete) {
      showBanner("familyError", "Each person needs a name and phone.");
      return;
    }
    const badPhone = state.family.some((m) => !isValidUSPhone(m.phone));
    if (badPhone) {
      showBanner("familyError", "Each phone needs 10 digits.");
      return;
    }
    hideBanner("familyError");
    renderFamilyVerify();
    showScreen("familyVerify");
  });
}

function renderFamilyVerify() {
  const container = document.getElementById("familyReview");
  container.innerHTML = state.family.length
    ? state.family.map((m) => `
        <div class="review-row"><span class="k">${m.relation || "Family"}</span><span class="v">${m.name} &middot; ${m.phone}</span></div>
      `).join("")
    : `<p class="hint">None added.</p>`;
}

function wireFamilyVerify() {
  document.getElementById("btnFamilyVerifyBack").addEventListener("click", () => showScreen("familyList"));
  document.getElementById("btnFamilyVerifyConfirm").addEventListener("click", async () => {
    await persistProfile();
    showScreen("inputMethod");
  });
}

async function persistProfile() {
  showLoading("Saving…");
  try {
    await apiPostJson(`/profile/${state.userId}`, { ...state.profile, family: state.family });
  } catch (e) {
    // Non-fatal: booking still works this session; setup repeats next visit.
  } finally {
    hideLoading();
  }
}

// ------------------------------------------------------- input method --

function wireInputMethod() {
  const typeBtn = document.getElementById("methodType");
  const signBtn = document.getElementById("methodSign");
  const typedBox = document.getElementById("typedInputWrap");
  const signBox = document.getElementById("signInputWrap");

  typeBtn.addEventListener("click", () => {
    typeBtn.classList.add("active"); signBtn.classList.remove("active");
    typedBox.style.display = "block"; signBox.style.display = "none";
    updateUseButtonState();
  });
  signBtn.addEventListener("click", () => {
    signBtn.classList.add("active"); typeBtn.classList.remove("active");
    typedBox.style.display = "none"; signBox.style.display = "block";
    updateUseButtonState();
  });

  document.getElementById("typedInput").addEventListener("input", updateUseButtonState);
  document.getElementById("btnEditProfile").addEventListener("click", () => showScreen("profileVerify"));
  document.getElementById("btnUseTranscript").addEventListener("click", onUseTranscript);
  document.getElementById("btnViewUpcoming").addEventListener("click", openUpcoming);

  wireSignCamera();
}

function currentTranscriptText() {
  const signBox = document.getElementById("signInputWrap");
  if (signBox.style.display !== "none") return words.join(" ");
  return document.getElementById("typedInput").value.trim();
}

function updateUseButtonState() {
  document.getElementById("btnUseTranscript").disabled = currentTranscriptText().length === 0;
}

async function onUseTranscript() {
  const text = currentTranscriptText();
  if (!text) return;
  state.transcript = text;
  if (running) stopSession();
  showLoading("Reading your request…");
  try {
    state.parsed = await apiPostJson("/parse-booking", { transcript: text });
  } catch (e) {
    console.warn("parse-booking failed:", e.message);  // the banner stays short; the real reason is here
    state.parsed = { availability: [], clinic_type_hint: null };
    showBanner("bookingError", "Couldn't read that. Fill in below.");
  } finally {
    hideLoading();
  }
  fillBookingConfirm();
  showScreen("bookingConfirm");
}

// ------------------------------------------------- sign camera (reused) --

const CAPTURE_INTERVAL_MS = 150;
const JPEG_QUALITY = 0.7;
let stream = null, socket = null, captureTimer = null, words = [], running = false;
let preview, videoWrap, statusBadge, mainBtn, undoBtn, clearBtn, transcriptBox, lastWordEl, canvas, ctx;

function wireSignCamera() {
  preview = document.getElementById("preview");
  videoWrap = document.getElementById("videoWrap");
  statusBadge = document.getElementById("statusBadge");
  mainBtn = document.getElementById("mainBtn");
  undoBtn = document.getElementById("undoBtn");
  clearBtn = document.getElementById("clearBtn");
  transcriptBox = document.getElementById("transcriptBox");
  lastWordEl = document.getElementById("lastWord");
  canvas = document.getElementById("captureCanvas");
  ctx = canvas.getContext("2d", { willReadFrequently: true });

  mainBtn.addEventListener("click", () => { if (!running) startSession(); else stopSession(); });
  undoBtn.addEventListener("click", () => { words.pop(); renderTranscript(); updateUseButtonState(); });
  clearBtn.addEventListener("click", () => { words = []; renderTranscript(); lastWordEl.textContent = ""; updateUseButtonState(); });
  renderTranscript();
}

function renderTranscript() {
  transcriptBox.textContent = words.join(" ");
  undoBtn.disabled = words.length === 0;
  clearBtn.disabled = words.length === 0;
}
function setStatus(text, cls) { statusBadge.textContent = text; statusBadge.className = cls || ""; }
function wsUrl() { const proto = location.protocol === "https:" ? "wss:" : "ws:"; return `${proto}//${location.host}/ws/stream`; }

async function startSession() {
  mainBtn.disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360 }, audio: false });
    preview.srcObject = stream;
    await new Promise((res) => { preview.onloadedmetadata = res; });
    canvas.width = preview.videoWidth || 480;
    canvas.height = preview.videoHeight || 360;

    socket = new WebSocket(wsUrl());
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      running = true;
      setStatus("Watching…");
      mainBtn.textContent = "Stop camera";
      mainBtn.disabled = false;
      captureTimer = setInterval(captureAndSendFrame, CAPTURE_INTERVAL_MS);
    };
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "status") {
        videoWrap.classList.toggle("signing", msg.signing);
        setStatus(msg.signing ? "Signing detected…" : "Watching…", msg.signing ? "signing" : "");
      } else if (msg.type === "word") {
        words.push(msg.word);
        renderTranscript();
        updateUseButtonState();
        lastWordEl.textContent = `Last sign: "${msg.word}" (${Math.round(msg.confidence * 100)}% confident)`;
      } else if (msg.type === "error") {
        lastWordEl.textContent = "Server error: " + msg.message;
      }
    };
    socket.onerror = () => { lastWordEl.textContent = "Connection error -- check the server is running."; };
    socket.onclose = () => { if (running) stopSession(); };
  } catch (err) {
    setStatus("Camera blocked");
    lastWordEl.textContent = "Couldn't access the camera: " + err.message;
    mainBtn.disabled = false;
  }
}

function captureAndSendFrame() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(async (blob) => {
    if (!blob || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(await blob.arrayBuffer());
  }, "image/jpeg", JPEG_QUALITY);
}

function stopSession() {
  running = false;
  if (captureTimer) clearInterval(captureTimer);
  captureTimer = null;
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  preview.srcObject = null;
  videoWrap.classList.remove("signing");
  setStatus("Camera off");
  mainBtn.textContent = "Start camera";
  mainBtn.disabled = false;
}

// -------------------------------------------------------- booking confirm --

function fillBookingConfirm() {
  const p = state.profile;
  document.getElementById("bc_profileSummary").innerHTML = `
    <div class="review-row"><span class="k">Name</span><span class="v">${p.name || "--"}</span></div>
    <div class="review-row"><span class="k">DOB</span><span class="v">${p.dob || "--"}</span></div>
    <div class="review-row"><span class="k">Insurance</span><span class="v">${p.insurance_name || "--"}</span></div>
  `;

  const clinicSelect = document.getElementById("bc_clinicType");
  clinicSelect.innerHTML = CLINIC_TYPES.map((c) => `<option value="${c.value}">${c.label}</option>`).join("");
  if (state.parsed.clinic_type_hint) clinicSelect.value = state.parsed.clinic_type_hint;

  document.getElementById("bc_zipcode").value = p.zipcode || "";

  state.booking.availability = (state.parsed.availability && state.parsed.availability.length)
    ? state.parsed.availability.map((a) => ({ ...a }))
    : [{ day: "", date: "", time: "" }];
  renderAvailabilityRows();

  state.booking.has_interpreter = null;
  document.getElementById("bc_interpreterHave").classList.remove("selected");
  document.getElementById("bc_interpreterNeed").classList.remove("selected");
  document.getElementById("bc_familyReview").style.display = "none";
}

function selectBookingInterpreter(hasOwn) {
  state.booking.has_interpreter = hasOwn;
  document.getElementById("bc_interpreterHave").classList.toggle("selected", hasOwn === true);
  document.getElementById("bc_interpreterNeed").classList.toggle("selected", hasOwn === false);

  const familyReview = document.getElementById("bc_familyReview");
  if (hasOwn === false) {
    familyReview.style.display = "block";
    familyReview.innerHTML = state.family.length
      ? state.family.map((m) => `<div class="review-row"><span class="k">${m.relation || "Family"}</span><span class="v">${m.name} &middot; ${m.phone}</span></div>`).join("")
      : "";
  } else {
    familyReview.style.display = "none";
  }
}

function dayNameFor(dateStr) {
  if (!dateStr) return "Pick a date";
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d) ? "Pick a date" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

// "14:00" -> "2 PM–3 PM": the workflow books within the hour starting at the chosen time.
function hourRange(time) {
  const start = new Date(`2000-01-01T${time}`);
  if (isNaN(start)) return "";
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined });
  return `${fmt(start)}–${fmt(end)}`;
}

function availabilityLabel(row) {
  return [row.day || dayNameFor(row.date), row.time && hourRange(row.time)].filter(Boolean).join(" · ");
}

function renderAvailabilityRows() {
  const container = document.getElementById("availabilityRows");
  container.innerHTML = "";
  state.booking.availability.forEach((row, i) => {
    const wrap = document.createElement("div");
    wrap.style.marginBottom = "10px";
    wrap.innerHTML = `
      <div class="hint" style="margin:0 0 4px;font-weight:700;color:var(--text);" data-day-label="${i}">${availabilityLabel(row)}</div>
      <div class="avail-row" style="margin-bottom:0;">
        <div class="field"><input type="date" data-field="date" data-i="${i}" value="${row.date || ""}"></div>
        <div class="field"><input type="time" data-field="time" data-i="${i}" value="${row.time || ""}"></div>
        ${state.booking.availability.length > 1 ? `<button class="remove-link" data-i="${i}">Remove</button>` : ""}
      </div>
    `;
    container.appendChild(wrap);
  });
  container.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.i);
      const row = state.booking.availability[i];
      row[e.target.dataset.field] = e.target.value;
      if (e.target.dataset.field === "date") row.day = dayNameFor(e.target.value);
      const label = container.querySelector(`[data-day-label="${i}"]`);
      if (label) label.textContent = availabilityLabel(row);
    });
  });
  container.querySelectorAll(".remove-link").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      state.booking.availability.splice(Number(e.target.dataset.i), 1);
      renderAvailabilityRows();
    });
  });
}

function wireBookingConfirm() {
  document.getElementById("btnAddAvailability").addEventListener("click", () => {
    state.booking.availability.push({ day: "", date: "", time: "" });
    renderAvailabilityRows();
  });
  document.getElementById("bc_interpreterHave").addEventListener("click", () => selectBookingInterpreter(true));
  document.getElementById("bc_interpreterNeed").addEventListener("click", () => selectBookingInterpreter(false));
  document.getElementById("btnBookingBack").addEventListener("click", () => showScreen("inputMethod"));
  document.getElementById("btnSubmitBooking").addEventListener("click", onSubmitBooking);
}

async function onSubmitBooking() {
  const clinic_type = document.getElementById("bc_clinicType").value;
  const zipcode = document.getElementById("bc_zipcode").value.trim();
  const availability = state.booking.availability.filter((a) => a.date && a.time);

  if (!zipcode || availability.length === 0) {
    showBanner("bookingError", "Add a zip and a date & time.");
    return;
  }
  if (state.booking.has_interpreter === null) {
    showBanner("bookingError", "Choose an interpreter option.");
    return;
  }
  hideBanner("bookingError");

  const payload = {
    user_id: state.userId,
    name: state.profile.name,
    phone: state.profile.phone || null,
    age: state.profile.age || null,
    dob: state.profile.dob || null,
    insurance_name: state.profile.insurance_name || null,
    insurance_id: state.profile.insurance_id || null,
    clinic_type,
    zipcode,
    availability,
    has_interpreter: state.booking.has_interpreter,
    family: state.booking.has_interpreter ? [] : state.family,
  };

  showLoading("Sending…");
  try {
    const result = await apiPostJson("/submit-booking", payload);
    hideLoading();
    if (result && result.run_id) {
      startTracking(result.run_id);
    } else {
      showOutcome({ status: "sent" });
    }
  } catch (e) {
    hideLoading();
    // show the server's actual reason (e.g. which field was bad)
    showBanner("bookingError", e.message || "Couldn't send. Try again.");
  }
}

// ------------------------------------------- workflow progress / approval --
//
// Follows one run, which takes minutes and reports through app.py's
// /notifications: a progress screen while it works, a confirm screen for the
// user's go/no-go, an outcome screen at the end. Statuses: running,
// awaiting_confirmation, succeeded, declined, failed.

const POLL_INTERVAL_MS = 2000;
const ACTIVE_RUN_KEY = "aslapp_active_run";
const APP_TITLE = document.title;

const tracking = { id: null, timer: null, failures: 0, screen: null, answered: false, declinedByUser: false };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Workflow text (clinic names, call notes) is untrusted: only set as textContent.
function fillRows(container, rows) {
  container.replaceChildren(...rows.map(([label, value]) => {
    const row = el("div", "review-row");
    row.append(el("span", "k", label), el("span", "v", value));
    return row;
  }));
}

function fillList(box, list, items) {
  list.replaceChildren(...items.map((item) => el("li", "", item)));
  box.hidden = items.length === 0;
}

function formatDate(date) {
  const when = new Date(`${date}T00:00`);
  return isNaN(when) ? date : when.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function formatTime(time) {
  const when = new Date(`2000-01-01T${time}`);
  return isNaN(when) ? time : when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Rate, minimum hours and estimate, for "More details".
function describeInterpreter(interpreter) {
  if (!interpreter || interpreter.tier === "user_arranged") return "Your own interpreter";
  if (interpreter.tier === "family") return `${interpreter.name} (${interpreter.relation})`;
  const minimum = interpreter.minimum_hours != null ? `, ${interpreter.minimum_hours} hr minimum` : "";
  const total = interpreter.total_estimate != null ? ` (about $${interpreter.total_estimate})` : "";
  return `${interpreter.name}: $${interpreter.rate_per_hour}/hr${minimum}${total}`;
}

// One short line: who interprets, plus "(confirmed)" once locked in (only a
// succeeded result carries `confirmed`).
function describeInterpreterStatus(interpreter) {
  if (!interpreter || interpreter.tier === "user_arranged") return "Your own";
  const who = interpreter.tier === "family" ? `${interpreter.name} (${interpreter.relation})` : interpreter.name;
  return interpreter.confirmed ? `${who} (confirmed)` : who;
}

function describeClinic(name, zipcode, address) {
  return address ? `${name} -- ${address}` : `${name} (ZIP ${zipcode})`;
}

// Shows "More details" only when it has content. `idPrefix` is "confirm" or
// "done"; the elements are named <prefix>Requirements(/List) and <prefix>Notes(/List).
function setMoreDetails(idPrefix, rows, requirements, notes) {
  const detailsEl = document.getElementById(`${idPrefix}More`);
  fillRows(document.getElementById(`${idPrefix}MoreDetails`), rows);
  fillList(
    document.getElementById(`${idPrefix}Requirements`),
    document.getElementById(`${idPrefix}RequirementsList`),
    requirements || [],
  );
  fillList(
    document.getElementById(`${idPrefix}Notes`),
    document.getElementById(`${idPrefix}NotesList`),
    notes || [],
  );
  detailsEl.hidden = rows.length === 0 && !(requirements || []).length && !(notes || []).length;
}

function startTracking(runId, progressTitle, progressText) {
  stopTracking();
  Object.assign(tracking, { id: runId, failures: 0, screen: null, answered: false, declinedByUser: false });
  try { localStorage.setItem(ACTIVE_RUN_KEY, runId); } catch (e) { /* private mode: tracking won't survive a refresh */ }
  showProgress(
    progressTitle || "Finding appointment",
    progressText || "This can take a few minutes. Keep this page open.",
  );
  pollBooking();
  tracking.timer = setInterval(pollBooking, POLL_INTERVAL_MS);
}

function stopTracking() {
  if (tracking.timer) clearInterval(tracking.timer);
  tracking.timer = null;
}

function forgetRun() {
  stopTracking();
  tracking.id = null;
  try { localStorage.removeItem(ACTIVE_RUN_KEY); } catch (e) { /* nothing to clear */ }
}

async function fetchBooking(runId) {
  return apiGet(`/bookings/${encodeURIComponent(runId)}?user_id=${encodeURIComponent(state.userId)}`);
}

async function pollBooking() {
  const runId = tracking.id;
  if (!runId) return;
  let booking;
  try {
    booking = await fetchBooking(runId);
  } catch (e) {
    tracking.failures += 1;
    if (tracking.failures >= 3 && tracking.screen === "progress") {
      document.getElementById("progressText").textContent = "Reconnecting…";
    }
    return;
  }
  if (tracking.id !== runId) return;  // a newer run took over while this was in flight
  tracking.failures = 0;

  if (booking.status === "awaiting_confirmation") {
    // after answering, ignore a stale poll that still says "awaiting"
    if (!tracking.answered && tracking.screen !== "confirm") showConfirm(booking.proposal);
  } else if (booking.status === "running" || booking.status === "cancelling") {
    // still in progress: keep polling
  } else {
    forgetRun();
    showOutcome(booking);
  }
}

function showProgress(title, text) {
  document.title = APP_TITLE;
  document.getElementById("progressTitle").textContent = title;
  document.getElementById("progressText").textContent = text;
  tracking.screen = "progress";
  showScreen("progress");
}

function setConfirmButtons(enabled) {
  document.getElementById("btnApprove").disabled = !enabled;
  document.getElementById("btnDecline").disabled = !enabled;
}

function showConfirm(proposal) {
  const rows = [
    ["Date", formatDate(proposal.date)],
    ["Time", formatTime(proposal.time)],
    ["Clinic", describeClinic(proposal.clinic_name, proposal.clinic_zipcode, proposal.clinic_address)],
    ["Interpreter", describeInterpreterStatus(proposal.interpreter)],
  ];

  const moreRows = [];
  if (proposal.interpreter && proposal.interpreter.tier === "freelance") {
    moreRows.push(["Interpreter rate", describeInterpreter(proposal.interpreter)]);
  }
  if (proposal.clinic_distance_miles != null) moreRows.push(["Distance", `${proposal.clinic_distance_miles} mi away`]);
  if (proposal.alternates && proposal.alternates.length) {
    moreRows.push(["Backups", proposal.alternates.map(describeInterpreter).join("; ")]);
  }

  fillRows(document.getElementById("confirmDetails"), rows);
  setMoreDetails("confirm", moreRows, proposal.requirements, proposal.notes);
  hideBanner("confirmError");
  setConfirmButtons(true);
  document.title = `Action needed - ${APP_TITLE}`;
  tracking.screen = "confirm";
  showScreen("confirm");
}

async function answerProposal(approved) {
  if (!tracking.id) return;
  setConfirmButtons(false);
  hideBanner("confirmError");
  tracking.answered = true;
  tracking.declinedByUser = !approved;
  try {
    await apiPostJson(`/bookings/${encodeURIComponent(tracking.id)}/confirm`, { user_id: state.userId, approved });
  } catch (e) {
    tracking.answered = false;
    tracking.declinedByUser = false;
    showBanner("confirmError", e.message || "Couldn't send. Try again.");
    setConfirmButtons(true);
    return;
  }
  if (approved) {
    showProgress("Booking…", "This can take a minute.");
  } else {
    pollBooking();
  }
}

let doneBookingId = null;

function showOutcome(booking) {
  document.title = APP_TITLE;
  doneBookingId = booking.run_id;
  const result = booking.result;
  let title = "Request sent";
  let sub = "";
  let kind = "ok";
  let rows = [];
  let moreRows = [];

  if (booking.status === "succeeded") {
    const contact = (result && result.clinic_contact) || {};
    const slot = (result && result.appointment_slot) || {};
    title = "Booked";
    rows = [
      ["Date", formatDate(slot.date)],
      ["Time", formatTime(slot.time)],
      ["Clinic", describeClinic(contact.name, contact.zipcode, contact.address)],
      ["Interpreter", describeInterpreterStatus(result && result.interpreter)],
    ];
    const appointment = (result && result.appointment) || {};
    if (appointment.booking_reference) moreRows.push(["Booking reference", appointment.booking_reference]);
    if (appointment.confirmed_by) moreRows.push(["Confirmed by", appointment.confirmed_by]);
    if (result && result.interpreter && result.interpreter.tier === "freelance") {
      moreRows.push(["Interpreter rate", describeInterpreter(result.interpreter)]);
    }
  } else if (booking.status === "declined") {
    title = "Nothing booked";
    sub = tracking.declinedByUser ? "" : (booking.reason || "Not approved.");
    kind = "stop";
  } else if (booking.status === "failed") {
    title = "Couldn't finish";
    sub = booking.error || "Something went wrong.";
    kind = "stop";
  } else if (booking.status === "cancelled") {
    title = "Cancelled";
    const cancellation = booking.cancellation || {};
    rows.push(["Clinic", cancellation.clinic_cancelled ? "Cancelled" : "Not confirmed. Call them."]);
    if (cancellation.interpreter_released === true) rows.push(["Interpreter", "Told"]);
  } else if (booking.status === "cancel_failed") {
    title = "Couldn't cancel";
    sub = booking.error || "Still booked.";
    kind = "stop";
  }

  document.getElementById("doneTitle").textContent = title;
  const subEl = document.getElementById("doneSub");
  subEl.textContent = sub;
  subEl.hidden = !sub;
  document.getElementById("doneIcon").dataset.kind = kind;
  fillRows(document.getElementById("doneDetails"), rows);
  setMoreDetails("done", moreRows, (result && result.requirements) || [], (result && result.notes) || []);
  hideBanner("cancelError");
  const btnCancel = document.getElementById("btnCancelAppointment");
  const canCancel = booking.status === "succeeded" || booking.status === "cancel_failed";
  btnCancel.hidden = !canCancel;
  btnCancel.disabled = false;
  btnCancel.textContent = booking.status === "cancel_failed" ? "Try again" : "Cancel appointment";
  tracking.screen = "done";
  showScreen("done");
}

const CANCELLING_TITLE = "Cancelling…";
const CANCELLING_TEXT = "This can take a minute.";

// Resumes a run after a refresh, or shows how it ended. Returns whether it took over the screen.
async function resumeActiveRun() {
  let runId = null;
  try { runId = localStorage.getItem(ACTIVE_RUN_KEY); } catch (e) { /* storage unavailable */ }
  if (!runId) return false;
  try {
    const booking = await fetchBooking(runId);
    if (booking.status === "cancelling") {
      startTracking(runId, CANCELLING_TITLE, CANCELLING_TEXT);
    } else if (booking.status === "running" || booking.status === "awaiting_confirmation") {
      startTracking(runId);
    } else {
      forgetRun();
      showOutcome(booking);
    }
    return true;
  } catch (e) {
    forgetRun();  // unknown to this server, or it can't be reached
    return false;
  }
}

function wireConfirm() {
  document.getElementById("btnApprove").addEventListener("click", () => answerProposal(true));
  document.getElementById("btnDecline").addEventListener("click", () => answerProposal(false));
}

// --------------------------------------------------------------- done --

async function onCancelAppointment() {
  if (!doneBookingId) return;
  if (!window.confirm("Cancel this appointment?")) return;

  hideBanner("cancelError");
  const btn = document.getElementById("btnCancelAppointment");
  btn.disabled = true;
  const runId = doneBookingId;
  try {
    await apiPostJson(`/bookings/${encodeURIComponent(runId)}/cancel`, { user_id: state.userId });
  } catch (e) {
    btn.disabled = false;
    showBanner("cancelError", e.message || "Couldn't cancel. Try again.");
    return;
  }
  startTracking(runId, CANCELLING_TITLE, CANCELLING_TEXT);
}

function wireDone() {
  document.getElementById("btnBookAnother").addEventListener("click", () => {
    forgetRun();
    state.transcript = ""; words = [];
    document.getElementById("typedInput").value = "";
    renderTranscript();
    updateUseButtonState();
    showScreen("inputMethod");
  });
  document.getElementById("btnCancelAppointment").addEventListener("click", onCancelAppointment);
}

// ---------------------------------------------------------- upcoming --
//
// Booked future appointments, soonest first, read once when the screen opens.
// This is how an older booking is found and cancelled.

async function openUpcoming() {
  hideBanner("upcomingError");
  document.getElementById("upcomingList").innerHTML = "";
  document.getElementById("upcomingEmpty").hidden = true;
  showScreen("upcoming");
  try {
    const { appointments } = await apiGet(`/appointments/upcoming?user_id=${encodeURIComponent(state.userId)}`);
    renderUpcoming(appointments);
  } catch (e) {
    showBanner("upcomingError", e.message || "Couldn't load. Try again.");
  }
}

function renderUpcoming(appointments) {
  document.getElementById("upcomingEmpty").hidden = appointments.length > 0;
  document.getElementById("upcomingList").replaceChildren(
    ...appointments.map((appt) => {
      const card = el("div", "family-card");
      card.append(el("div", "family-card-head", `${formatDate(appt.date)} · ${formatTime(appt.time)}`));
      card.append(el("div", "", appt.clinic || ""));
      card.append(el("div", "hint", appt.address || (appt.zipcode ? `ZIP ${appt.zipcode}` : "")));
      card.append(el("div", "hint", `Interpreter: ${describeInterpreterStatus(appt.interpreter)}`));

      const btn = el("button", "btn btn-danger", "Cancel");
      btn.style.marginTop = "8px";
      btn.addEventListener("click", () => onCancelFromUpcoming(appt.run_id, btn));
      card.append(btn);
      return card;
    }),
  );
}

async function onCancelFromUpcoming(runId, button) {
  if (!window.confirm("Cancel this appointment?")) return;

  hideBanner("upcomingError");
  button.disabled = true;
  try {
    await apiPostJson(`/bookings/${encodeURIComponent(runId)}/cancel`, { user_id: state.userId });
  } catch (e) {
    button.disabled = false;
    showBanner("upcomingError", e.message || "Couldn't cancel. Try again.");
    return;
  }
  // same flow as the "done" screen's cancel
  startTracking(runId, CANCELLING_TITLE, CANCELLING_TEXT);
}

function wireUpcoming() {
  document.getElementById("btnUpcomingBack").addEventListener("click", () => showScreen("inputMethod"));
}

// --------------------------------------------------------------- wire-up --

function wireUpAll() {
  wireProfileMethod();
  wireProfileUpload();
  wireProfileVerify();
  wireFamilyList();
  wireFamilyVerify();
  wireInputMethod();
  wireBookingConfirm();
  wireConfirm();
  wireDone();
  wireUpcoming();
}

init();