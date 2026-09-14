document.addEventListener('DOMContentLoaded', () => {

  // ─────────────────────────────────────────────────────────────────────
  // SESSION + BUSINESS CONTEXT
  // ─────────────────────────────────────────────────────────────────────

  const SESSION_KEY   = 'helo_token';
  const BIZ_ID_KEY    = 'helo_bizId';
  const BIZ_NAME_KEY  = 'helo_bizName';

  let sessionToken     = localStorage.getItem(SESSION_KEY);
  let currentBusinessId = localStorage.getItem(BIZ_ID_KEY);
  let currentBusiness   = null; // full business object, fetched on init

  const isAdminMode = new URLSearchParams(window.location.search).get('admin') === '1';

  // If no session token at all, bounce to landing page immediately
  if (!sessionToken) {
    window.location.href = '/';
    return;
  }

  // ─────────────────────────────────────────────────────────────────────
  // DOM REFS
  // ─────────────────────────────────────────────────────────────────────

  const form           = document.getElementById('new-booking-form');
  const listContainer  = document.getElementById('bookings-list');
  const countBadge     = document.getElementById('booking-count');
  const userBizName    = document.getElementById('user-biz-name');
  const userBizType    = document.getElementById('user-biz-type');
  const logoutBtn      = document.getElementById('logout-btn');
  const dashSubtitle   = document.getElementById('dashboard-subtitle');
  const formTitle      = document.getElementById('form-title');
  const formDesc       = document.getElementById('form-desc');
  const nameLabel      = document.getElementById('name-label');
  const createBtnLabel = document.getElementById('create-btn-label');
  const adminSwitcher  = document.getElementById('admin-switcher');
  const adminBizSelect = document.getElementById('admin-biz-select');
  const mockToggle     = document.getElementById('mock-mode-toggle');

  // Budget counter DOM
  const budgetCounter  = document.getElementById('budget-counter');
  const budgetUsedEl   = document.getElementById('budget-used');
  const budgetCapEl    = document.getElementById('budget-cap');

  // Modal DOM
  const modal          = document.getElementById('log-modal');
  const closeModalBtn  = document.getElementById('close-modal');
  const modalName      = document.getElementById('modal-booking-name');
  const modalPhone     = document.getElementById('modal-booking-phone');
  const modalStatus    = document.getElementById('modal-booking-status');
  const terminalLogs   = document.getElementById('terminal-logs');
  const rawJsonContent = document.getElementById('raw-json-content');

  let currentOpenBookingId = null;
  let pollIntervalId = null;

  // ─────────────────────────────────────────────────────────────────────
  // AUTHED FETCH HELPER
  // ─────────────────────────────────────────────────────────────────────

  function authedFetch(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'x-session-token': sessionToken,
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // INIT — validate session, load business, set up UI
  // ─────────────────────────────────────────────────────────────────────

  async function init() {
    try {
      const res = await authedFetch('/api/auth/me');
      if (!res.ok) {
        // Token is invalid/expired — clear and redirect
        clearSession();
        window.location.href = '/';
        return;
      }
      const data = await res.json();
      currentBusiness   = data.business;
      currentBusinessId = data.business.id;

      // Sync localStorage in case admin switched via URL
      localStorage.setItem(BIZ_ID_KEY,   currentBusinessId);
      localStorage.setItem(BIZ_NAME_KEY, currentBusiness.name);

      updateUIForBusiness(currentBusiness);

      // Admin mode: show switcher and populate it
      if (isAdminMode) {
        adminSwitcher.style.display = 'flex';
        await loadAdminSwitcher();
      }

      fetchBookings();
      fetchBudget(); // show real call budget counter
    } catch (err) {
      console.error('Init failed:', err);
      listContainer.innerHTML = `<div class="loading-spinner" style="color:var(--danger)">Failed to connect to server. Is it running?</div>`;
    }
  }

  function updateUIForBusiness(biz) {
    userBizName.textContent  = biz.name;
    userBizType.textContent  = biz.type;
    dashSubtitle.textContent = `${biz.name} · Voice AI Booking Verification`;
    document.title           = `${biz.name} — HELO Voice Bridge`;

    // Adapt form labels to business type
    const isClinic = biz.type === 'clinic';
    formTitle.textContent    = isClinic ? 'Schedule Patient Verification' : 'Schedule Verification';
    formDesc.textContent     = isClinic
      ? 'Create a new appointment slot to verify using the CALL-E agent.'
      : 'Create a new booking record to verify using the CALL-E agent.';
    nameLabel.textContent    = isClinic ? 'Patient Name' : 'Customer Name';
    document.getElementById('customer-name').placeholder = isClinic ? 'e.g. Luke Skywalker' : 'e.g. Jean-Luc Picard';
    createBtnLabel.textContent = isClinic ? 'Create Appointment' : 'Create Booking';
  }

  // ─────────────────────────────────────────────────────────────────────
  // ADMIN SWITCHER
  // ─────────────────────────────────────────────────────────────────────

  async function loadAdminSwitcher() {
    try {
      const res  = await fetch('/api/businesses');
      const bizList = await res.json();
      adminBizSelect.innerHTML = bizList.map(b =>
        `<option value="${escapeHTML(b.id)}" ${b.id === currentBusinessId ? 'selected' : ''}>${escapeHTML(b.name)} (${escapeHTML(b.type)})</option>`
      ).join('');
    } catch (err) {
      console.error('Failed to load businesses for admin switcher:', err);
    }
  }

  adminBizSelect.addEventListener('change', async () => {
    const selectedId = adminBizSelect.value;
    if (!selectedId || selectedId === currentBusinessId) return;

    // Find business in list and switch context (no session swap — admin uses same token)
    const res  = await fetch('/api/businesses');
    const bizList = await res.json();
    const biz = bizList.find(b => b.id === selectedId);
    if (!biz) return;

    currentBusinessId = selectedId;
    currentBusiness   = biz;
    updateUIForBusiness(biz);
    fetchBookings();
  });

  // ─────────────────────────────────────────────────────────────────────
  // LOGOUT
  // ─────────────────────────────────────────────────────────────────────

  logoutBtn.addEventListener('click', async () => {
    try {
      await authedFetch('/api/auth/logout', { method: 'POST' });
    } catch (_) { /* best-effort */ }
    clearSession();
    window.location.href = '/';
  });

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(BIZ_ID_KEY);
    localStorage.removeItem(BIZ_NAME_KEY);
  }

  // ─────────────────────────────────────────────────────────────────────
  // REAL CALL BUDGET COUNTER
  // ─────────────────────────────────────────────────────────────────────

  async function fetchBudget() {
    try {
      const res  = await fetch('/api/calls/budget');
      if (!res.ok) return;
      const data = await res.json();

      budgetUsedEl.textContent = data.used;
      budgetCapEl.textContent  = data.cap;

      // Update visual state
      budgetCounter.classList.remove('budget-warning', 'budget-exhausted');
      if (data.exhausted) {
        budgetCounter.classList.add('budget-exhausted');
        budgetCounter.title = `⛔ Real call budget exhausted (${data.used}/${data.cap}). Use Mock Mode.`;
      } else if (data.used >= Math.floor(data.cap * 0.6)) {
        // Warn at 60% consumption (3+ of 5)
        budgetCounter.classList.add('budget-warning');
        budgetCounter.title = `⚠️ ${data.remaining} real call(s) remaining this session.`;
      } else {
        budgetCounter.title = `${data.remaining} real call(s) remaining this session.`;
      }
    } catch (_) { /* non-fatal — counter just stays at ? */ }
  }

  // ─────────────────────────────────────────────────────────────────────
  // FETCH + RENDER BOOKINGS
  // ─────────────────────────────────────────────────────────────────────

  async function fetchBookings() {
    if (!currentBusinessId) return;
    try {
      const adminParam = isAdminMode ? '&admin=1' : '';
      const response   = await authedFetch(`/api/businesses/${currentBusinessId}/bookings?t=${Date.now()}${adminParam}`);

      if (response.status === 401) {
        clearSession();
        window.location.href = '/';
        return;
      }

      if (!response.ok) throw new Error('Failed to retrieve records');
      const records = await response.json();

      renderBookings(records);

      // Update count
      countBadge.textContent = `${records.length} ${records.length === 1 ? 'record' : 'records'}`;

      // Drive polling
      const hasActiveCallOrRetry = records.some(b => b.isCalling || b.status === 'retry_scheduled');
      if (hasActiveCallOrRetry) {
        startPolling();
      } else if (!currentOpenBookingId) {
        stopPolling();
      }

      // Refresh open modal
      if (currentOpenBookingId) {
        const openBooking = records.find(b => b.id === currentOpenBookingId);
        if (openBooking) updateModalData(openBooking);
      }
    } catch (err) {
      console.error('Error fetching records:', err);
      listContainer.innerHTML = `<div class="loading-spinner" style="color:var(--danger)">Error: ${escapeHTML(err.message)}</div>`;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // RENDER BOOKINGS (unchanged card/badge/retry UI)
  // ─────────────────────────────────────────────────────────────────────

  function renderBookings(bookings) {
    if (bookings.length === 0) {
      listContainer.innerHTML = '<div class="loading-spinner">No records yet. Create one using the form.</div>';
      return;
    }

    listContainer.innerHTML = '';
    bookings.forEach(booking => {
      const card = document.createElement('div');
      card.className = `booking-card glassmorphism ${booking.isCalling ? 'calling-active' : ''} ${booking.status === 'retry_scheduled' ? 'retry-active' : ''}`;

      // Badge class
      let badgeClass = 'badge-pending';
      if (booking.isCalling)                        badgeClass = 'badge-calling';
      else if (booking.status === 'booked')         badgeClass = 'badge-booked';
      else if (booking.status === 'unavailable')    badgeClass = 'badge-unavailable';
      else if (booking.status === 'uncertain')      badgeClass = 'badge-uncertain';
      else if (booking.status === 'failed')         badgeClass = 'badge-unavailable';
      else if (booking.status === 'retry_scheduled') badgeClass = 'badge-scheduled';
      else if (booking.status === 'needs_human_review') badgeClass = 'badge-review';

      let displayStatus = booking.isCalling ? 'calling' : booking.status;
      if (booking.status === 'retry_scheduled')       displayStatus = `retry scheduled (${booking.retryCount}/2)`;
      else if (booking.status === 'needs_human_review') displayStatus = 'needs review';

      // Retry countdown
      let retryInfoHtml = '';
      if (booking.status === 'retry_scheduled' && booking.retryScheduledTime) {
        const remainingSec = Math.max(0, Math.round((new Date(booking.retryScheduledTime) - new Date()) / 1000));
        retryInfoHtml = `
          <div class="retry-banner">
            <span class="retry-icon">🔄</span>
            <div class="retry-details">
              <div class="retry-reason">CALL-E suggested retrying — ${escapeHTML(booking.retryReason)}</div>
              <div class="retry-countdown">Retrying in ~<strong>${remainingSec}s</strong> (demo-compressed from ${booking.realDelayMinutes} min)</div>
            </div>
          </div>
        `;
      }

      const mockBadge = booking.mockMode
        ? `<span class="badge" style="background:rgba(99,102,241,0.15);color:#818cf8;font-size:0.65rem;margin-left:0.25rem;">MOCK</span>`
        : '';

      card.innerHTML = `
        <div class="booking-info">
          <div style="display:flex; justify-content:space-between; align-items:start; gap:0.5rem; margin-bottom:0.5rem;">
            <h3>${escapeHTML(booking.name)} ${mockBadge}</h3>
            <span class="badge ${badgeClass}">${displayStatus}</span>
          </div>
          <div class="booking-meta">
            <div><strong>Phone:</strong> ${escapeHTML(booking.phone)}</div>
            <div><strong>Time:</strong> ${escapeHTML(booking.dateTime)}</div>
            ${booking.error ? `<div style="color:var(--danger);margin-top:0.25rem;"><strong>Error:</strong> ${escapeHTML(booking.error)}</div>` : ''}
          </div>
          ${retryInfoHtml}
        </div>
        <div class="booking-actions">
          <button class="btn btn-primary start-call-btn" data-id="${escapeHTML(booking.id)}" ${booking.isCalling ? 'disabled' : ''}>
            <span>${booking.isCalling ? 'Calling…' : 'Call CALL-E'}</span>
          </button>
          <button class="btn btn-secondary view-logs-btn" data-id="${escapeHTML(booking.id)}">
            <span>Inspect Logs</span>
          </button>
        </div>
      `;

      card.querySelector('.start-call-btn').addEventListener('click', e => {
        e.stopPropagation();
        initiateCall(booking.id);
      });
      card.querySelector('.view-logs-btn').addEventListener('click', e => {
        e.stopPropagation();
        openLogModal(booking);
      });

      listContainer.appendChild(card);
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // INITIATE CALL
  // ─────────────────────────────────────────────────────────────────────

  async function initiateCall(id) {
    try {
      const response = await authedFetch(`/api/bookings/${id}/call`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        alert(data.error || 'Failed to start call');
        return;
      }
      fetchBookings();
      fetchBudget(); // refresh counter after every call trigger
      startPolling();
    } catch (err) {
      console.error('Error starting call:', err);
      alert('System failed to connect with the calling endpoint.');
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // POLLING
  // ─────────────────────────────────────────────────────────────────────

  function startPolling() {
    if (pollIntervalId) return;
    pollIntervalId = setInterval(fetchBookings, 2000);
    console.log('Started polling…');
  }

  function stopPolling() {
    if (!pollIntervalId) return;
    clearInterval(pollIntervalId);
    pollIntervalId = null;
    console.log('Stopped polling.');
  }

  // ─────────────────────────────────────────────────────────────────────
  // LOG MODAL (unchanged)
  // ─────────────────────────────────────────────────────────────────────

  function openLogModal(booking) {
    currentOpenBookingId = booking.id;
    updateModalData(booking);
    modal.style.display = 'flex';
    startPolling();
  }

  function updateModalData(booking) {
    modalName.textContent  = booking.name;
    modalPhone.textContent = booking.phone;

    let displayStatus = booking.isCalling ? 'calling' : booking.status;
    if (booking.status === 'retry_scheduled')         displayStatus = `retry scheduled (${booking.retryCount}/2)`;
    else if (booking.status === 'needs_human_review') displayStatus = 'needs review';

    modalStatus.textContent = displayStatus;
    modalStatus.className   = 'badge';
    if (booking.isCalling)                             modalStatus.classList.add('badge-calling');
    else if (booking.status === 'booked')              modalStatus.classList.add('badge-booked');
    else if (booking.status === 'unavailable')         modalStatus.classList.add('badge-unavailable');
    else if (booking.status === 'uncertain')           modalStatus.classList.add('badge-uncertain');
    else if (booking.status === 'failed')              modalStatus.classList.add('badge-unavailable');
    else if (booking.status === 'retry_scheduled')     modalStatus.classList.add('badge-scheduled');
    else if (booking.status === 'needs_human_review')  modalStatus.classList.add('badge-review');
    else                                               modalStatus.classList.add('badge-pending');

    if (booking.logs && booking.logs.length > 0) {
      terminalLogs.innerHTML = booking.logs.map(log => `<div>${escapeHTML(log)}</div>`).join('');
    } else {
      terminalLogs.innerHTML = '<div style="color:var(--text-muted)">No logs recorded yet.</div>';
    }
    terminalLogs.scrollTop = terminalLogs.scrollHeight;

    rawJsonContent.textContent = JSON.stringify(
      booking.rawResult || { message: 'No final result JSON cached. Place/complete a call first.' },
      null, 2
    );
  }

  // Tab switching inside modal
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  closeModalBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    currentOpenBookingId = null;
  });

  window.addEventListener('click', e => {
    if (e.target === modal) {
      modal.style.display = 'none';
      currentOpenBookingId = null;
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // FORM SUBMISSION — create new booking for current business
  // ─────────────────────────────────────────────────────────────────────

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentBusinessId) { alert('No business loaded. Please log in again.'); return; }

    const name     = document.getElementById('customer-name').value.trim();
    const phone    = document.getElementById('customer-phone').value.trim();
    const dateTime = document.getElementById('booking-datetime').value;
    const mockMode = mockToggle.checked;

    try {
      const adminParam = isAdminMode ? '?admin=1' : '';
      const response = await authedFetch(`/api/businesses/${currentBusinessId}/bookings${adminParam}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, phone, dateTime, mockMode })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create record');
      }

      form.reset();
      fetchBookings();
    } catch (err) {
      alert(`Error scheduling: ${err.message}`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────

  function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g,
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // BOOT
  // ─────────────────────────────────────────────────────────────────────

  init();
});
