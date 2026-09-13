/* ==========================================================================
   CALL-E Negotiation Hub — State Manager & Recent Threads Controller
   ========================================================================== */

/* ─── Service & Negotiation Presets ──────────────────────────────────── */
const PRESETS = {
  painting: {
    name: 'Painting RFQ',
    desc: 'Call and inquire if they are available to paint a 3BHK apartment (~1,400 sq ft) including walls, ceilings, and primer coat at the earliest. Ask for an estimated total price with materials vs labor breakdown, estimated completion timeline, and whether a warranty on paint finish is included.',
    vendors: [
      { name: 'Apex Painting Co. (Demo)', phone: '+15550100100' },
      { name: 'Raj Painters (Demo)', phone: '+15550100101' },
      { name: 'Urban Colors Ltd. (Demo)', phone: '+15550100102' },
    ],
  },
  plumbing: {
    name: 'Plumbing Repair',
    desc: 'Call to check immediate availability for an urgent plumbing repair. We need to fix a leaking kitchen sink drain pipe and clear a blocked bathroom drain line. Ask for their standard inspection visit charge, total repair cost estimate, and earliest arrival time.',
    vendors: [
      { name: 'Metro Plumbing & Drain (Demo)', phone: '+15550100100' },
      { name: 'Sharma Plumbing (Demo)', phone: '+15550100101' },
      { name: 'AquaFix Services (Demo)', phone: '+15550100102' },
    ],
  },
  electrical: {
    name: 'Electrical Work',
    desc: 'Call to check earliest availability for electrical work: complete safety inspection and replacement of a 63A MCB distribution board, plus wiring 4 new AC heavy-load power points. Ask for per-point labor rates, total estimated cost, and safety guarantee.',
    vendors: [
      { name: 'Apex Electric Works (Demo)', phone: '+15550100100' },
      { name: 'Bright Spark Electricals (Demo)', phone: '+15550100101' },
      { name: 'Volt Masters (Demo)', phone: '+15550100102' },
    ],
  },
  carpentry: {
    name: 'Custom Carpentry',
    desc: 'Call to request a quote for building a custom floor-to-ceiling bedroom wardrobe (7x6 ft) with soft-close hydraulic hinges and matte laminate finish. Ask for per-square-foot material and labor rates, earliest start date, and estimated completion timeline.',
    vendors: [
      { name: 'Bay Custom Woodworks (Demo)', phone: '+15550100100' },
      { name: 'WoodCraft Studio (Demo)', phone: '+15550100101' },
      { name: 'TimberTech Interiors (Demo)', phone: '+15550100102' },
    ],
  },
  personal: {
    name: 'Personal Message',
    desc: 'Call and convey a friendly reminder regarding our upcoming project kickoff meeting. Ask them to confirm if their schedule is on track or if they prefer adjusting the meeting time.',
    vendors: [
      { name: 'Project Lead (Demo)', phone: '+15550100100' },
    ],
  },
  business: {
    name: 'Ask a Business',
    desc: 'Call the vendor to inquire about bulk corporate pricing for 25 ergonomic office chairs and 10 motorized standing desks. Ask for their wholesale discount catalog, delivery lead time, and GST invoice terms.',
    vendors: [
      { name: 'Apex Office Outfitters (Demo)', phone: '+15550100100' },
      { name: 'Raj Commercial Supplies (Demo)', phone: '+15550100101' },
      { name: 'Urban Colors Ltd. (Demo)', phone: '+15550100102' },
    ],
  },
  booking: {
    name: 'Book or Reschedule',
    desc: 'Call the service manager to schedule an on-site property inspection for the earliest available morning slot. If that slot is fully booked, ask for their next available appointment options.',
    vendors: [
      { name: 'Central Inspection Desk (Demo)', phone: '+15550100100' },
      { name: 'Urban Colors Ltd. (Demo)', phone: '+15550100101' },
    ],
  },
  followup: {
    name: 'Follow Up',
    desc: 'Call the contractor to follow up on the recent quote estimate. Mention we have competing vendor bids around 10% lower, and ask if they can match that price with premium materials and warranty included.',
    vendors: [
      { name: 'Apex Contracting (Demo)', phone: '+15550100100' },
      { name: 'Raj Painters (Demo)', phone: '+15550100101' },
    ],
  }
};

/* ─── App State ──────────────────────────────────────────────────────── */
let currentCategory = 'painting';
let activeVendors = [];

let recentThreads = [];

let currentView = 'home'; // 'home' | 'thread'
let activeThread = null;
let isRunning = false;
let eventSource = null;

/* ─── LocalStorage Persistence Manager ──────────────────────────────── */
const STORAGE_KEY_THREADS = 'quotehunter_threads_v2';
const STORAGE_KEY_VIEW = 'quotehunter_active_view';
const STORAGE_KEY_ACTIVE_ID = 'quotehunter_active_thread_id';

function saveThreadsToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY_THREADS, JSON.stringify(recentThreads));
    localStorage.setItem(STORAGE_KEY_VIEW, currentView);
    if (activeThread && currentView === 'thread') {
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID, activeThread.id);
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_ID);
    }
  } catch (err) {
    console.error('Failed to save state to localStorage:', err);
  }
}

function loadThreadsFromStorage() {
  try {
    // Also clean any legacy v1 key with thread-default
    localStorage.removeItem('quotehunter_threads_v1');
    const raw = localStorage.getItem(STORAGE_KEY_THREADS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        recentThreads = parsed.filter(t => t.id !== 'thread-default');
        // Restore full prompt title for any threads previously truncated with ...
        recentThreads.forEach(t => {
          if (t.title && t.title.endsWith('...') && t.prompt) {
            t.title = t.prompt;
          }
        });
        return;
      }
    }
  } catch (err) {
    console.error('Failed to load state from localStorage:', err);
  }
  recentThreads = [];
  saveThreadsToStorage();
}

/* ─── DOM References ────────────────────────────────────────────────── */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const viewHome = $('#view-home');
const viewThread = $('#view-thread');
const recentsList = $('#recents-list');
const recentsBadge = $('#recents-badge');
const topBarTitle = $('#top-bar-title');
const threadUserPrompt = $('#thread-user-prompt');
const threadSwarmList = $('#thread-swarm-list');
const jobDesc = $('#job-desc');
const selectedNumbersContainer = $('#selected-numbers-container');
const launchBtn = $('#btn-launch-hunt');
const addVendorModal = $('#add-vendor-modal');

/* ─── Accessible Modal & Keyboard Controller (W3C WAI-ARIA) ──────────── */
const AccessibleModalManager = {
  stack: [],

  open(modalEl, triggerEl = null) {
    if (!modalEl) return;
    const trigger = triggerEl || document.activeElement;
    modalEl._priorActiveElement = trigger;
    modalEl.classList.remove('hidden-view');

    if (!this.stack.includes(modalEl)) {
      this.stack.push(modalEl);
    }
  },

  close(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add('hidden-view');
    this.stack = this.stack.filter(m => m !== modalEl);

    if (modalEl._priorActiveElement && typeof modalEl._priorActiveElement.focus === 'function') {
      try {
        modalEl._priorActiveElement.focus();
      } catch (_) { }
    }
  }
};

// Global Escape Key Listener & Tab Focus Trapping
document.addEventListener('keydown', (e) => {
  if (AccessibleModalManager.stack.length === 0) return;
  const currentModal = AccessibleModalManager.stack[AccessibleModalManager.stack.length - 1];

  // 1. Escape key closes the topmost modal
  if (e.key === 'Escape' || e.keyCode === 27) {
    e.preventDefault();
    if (currentModal.id === 'delete-thread-modal') {
      closeDeleteThreadModal();
    } else if (currentModal.id === 'verify-call-modal') {
      closeVerifyCallModal();
    } else if (currentModal.id === 'add-vendor-modal') {
      closeAddVendorModal();
    } else if (currentModal.id === 'booking-dossier-modal') {
      closeBookingDossierModal();
    } else if (currentModal.id === 'conversation-modal') {
      closeConversationModal();
    } else if (currentModal.id === 'custom-confirm-modal') {
      closeCustomConfirm();
    } else {
      AccessibleModalManager.close(currentModal);
    }
    return;
  }

  // 2. Tab key focus trapping
  if (e.key === 'Tab' || e.keyCode === 9) {
    const focusable = Array.from(currentModal.querySelectorAll(
      'input:not([disabled]):not([type="hidden"]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
});

/* ─── View Controller ───────────────────────────────────────────────── */
function switchView(viewName, threadData = null) {
  currentView = viewName;

  if (viewName === 'home') {
    viewHome?.classList.remove('hidden-view');
    viewThread?.classList.add('hidden-view');
    activeThread = null;
    if (jobDesc) jobDesc.value = '';
    $$('.preset-chip').forEach(c => {
      c.classList.remove('border-black', 'bg-gray-50/80');
      c.classList.add('border-[#e5e7eb]');
    });
    saveThreadsToStorage();
    renderRecentsList();
  } else if (viewName === 'thread' && threadData) {
    activeThread = threadData;
    viewHome?.classList.add('hidden-view');
    viewThread?.classList.remove('hidden-view');

    if (topBarTitle) {
      topBarTitle.textContent = threadData.title || threadData.prompt;
    }
    if (threadUserPrompt) {
      threadUserPrompt.textContent = threadData.prompt;
    }

    const statusBadge = $('#thread-status-badge');

    if (statusBadge) {
      if (threadData.isLive) {
        statusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 text-[11px] font-medium';
        statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span><span>Live Swarm</span>';
      } else {
        statusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200 text-[11px] font-medium';
        statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span><span>Completed</span>';
      }
    }

    if (threadData.isLive) {
      startWorkingTimer(threadData.createdAt);
    } else {
      stopWorkingTimer();
      const botContainer = $('#thread-bot-status-container');
      if (botContainer) botContainer.classList.add('hidden-view');
    }

    saveThreadsToStorage();
    renderThreadSwarm(threadData.results);
    renderRecentsList();
  }
}

$('#btn-new-chat')?.addEventListener('click', () => {
  switchView('home');
});

/* ─── Recents Sidebar Controller ────────────────────────────────────── */
let editingThreadIndex = null;
let threadToDeleteIndex = null;

function renderRecentsList() {
  if (!recentsList) return;

  if (recentsBadge) {
    recentsBadge.textContent = recentThreads.length;
  }

  const clearBtn = $('#btn-clear-all-history');
  if (clearBtn) {
    if (recentThreads.length > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  }

  if (recentThreads.length === 0) {
    recentsList.innerHTML = `<p class="text-xs text-gray-400 italic px-2.5 py-2">No recent negotiations</p>`;
    return;
  }

  recentsList.innerHTML = recentThreads.map((t, idx) => {
    const isActive = activeThread && activeThread.id === t.id && currentView === 'thread';
    const isEditing = editingThreadIndex === idx;
    const fullTitle = t.title || t.prompt || 'Negotiation';

    return `
      <div 
        class="group relative flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-colors cursor-pointer ${isActive
        ? 'bg-gray-200/70 text-gray-900 font-medium'
        : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 font-normal'
      }" 
        onclick="loadThread(${idx})"
      >
        <div class="flex items-center gap-2 truncate flex-1 min-w-0 pr-1">
          <span class="w-1.5 h-1.5 rounded-full ${t.isLive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'} shrink-0"></span>
          ${isEditing ? `
            <input 
              type="text" 
              id="thread-inline-edit-${idx}" 
              class="w-full bg-white border border-gray-400 rounded px-1.5 py-0.5 text-xs text-gray-900 outline-none focus:border-gray-900 shadow-2xs font-normal" 
              value="${escapeHtml(fullTitle)}"
              onclick="event.stopPropagation()"
            />
          ` : `
            <span class="truncate" id="thread-title-${idx}" title="${escapeHtml(fullTitle)}">${escapeHtml(fullTitle)}</span>
          `}
        </div>

        <!-- 3-Dot Options Trigger (Appears on Hover) -->
        <div class="relative shrink-0 ${isEditing ? 'hidden' : ''}" onclick="event.stopPropagation()">
          <button 
            type="button" 
            onclick="toggleRecentMenu(event, ${idx})"
            class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700 p-1 hover:bg-gray-200/80 rounded-md transition-all flex items-center justify-center cursor-pointer"
            title="Options"
          >
            <span class="material-symbols-outlined text-[16px] leading-none font-light">more_horiz</span>
          </button>

          <!-- Floating Dropdown Menu -->
          <div id="recent-menu-${idx}" class="recent-menu-dropdown hidden-view absolute right-0 top-6 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-28 text-xs font-normal text-gray-700 backdrop-blur-sm">
            <button type="button" onclick="renameThread(event, ${idx})" class="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-gray-50 text-gray-700 transition-colors cursor-pointer">
              <span class="material-symbols-outlined text-[14px] text-gray-400 font-light">edit</span>
              <span>Rename</span>
            </button>
            <button type="button" onclick="openDeleteThreadModal(event, ${idx})" class="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-rose-50 text-rose-600 transition-colors cursor-pointer">
              <span class="material-symbols-outlined text-[14px] text-rose-500 font-light">delete</span>
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (editingThreadIndex !== null) {
    const input = document.getElementById(`thread-inline-edit-${editingThreadIndex}`);
    if (input) {
      input.focus();
      input.select();

      let isHandled = false;
      const saveEdit = () => {
        if (isHandled || editingThreadIndex === null) return;
        isHandled = true;
        const currentIdx = editingThreadIndex;
        const newTitle = input.value.trim();
        editingThreadIndex = null;
        if (newTitle && recentThreads[currentIdx]) {
          recentThreads[currentIdx].title = newTitle;
          saveThreadsToStorage();
          if (activeThread && activeThread.id === recentThreads[currentIdx].id && topBarTitle) {
            topBarTitle.textContent = newTitle;
          }
        }
        renderRecentsList();
      };

      const cancelEdit = () => {
        if (isHandled) return;
        isHandled = true;
        editingThreadIndex = null;
        renderRecentsList();
      };

      input.addEventListener('blur', saveEdit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
        }
      });
    }
  }
}

window.toggleRecentMenu = function (e, idx) {
  e.stopPropagation();
  const currentMenu = document.getElementById(`recent-menu-${idx}`);
  const isCurrentlyOpen = currentMenu && !currentMenu.classList.contains('hidden-view');

  // Close all open menus
  document.querySelectorAll('.recent-menu-dropdown').forEach(m => m.classList.add('hidden-view'));

  if (!isCurrentlyOpen && currentMenu) {
    currentMenu.classList.remove('hidden-view');
  }
};

window.renameThread = function (e, idx) {
  e.stopPropagation();
  document.querySelectorAll('.recent-menu-dropdown').forEach(m => m.classList.add('hidden-view'));
  editingThreadIndex = idx;
  renderRecentsList();
};

window.openDeleteThreadModal = function (e, idx) {
  e.stopPropagation();
  document.querySelectorAll('.recent-menu-dropdown').forEach(m => m.classList.add('hidden-view'));
  const thread = recentThreads[idx];
  if (!thread) return;

  threadToDeleteIndex = idx;
  const preview = $('#delete-thread-title-preview');
  if (preview) preview.textContent = thread.title || thread.prompt || 'Negotiation Thread';

  AccessibleModalManager.open($('#delete-thread-modal'), e.target);
};

function closeDeleteThreadModal() {
  threadToDeleteIndex = null;
  AccessibleModalManager.close($('#delete-thread-modal'));
}

$('#btn-cancel-delete-modal')?.addEventListener('click', closeDeleteThreadModal);
$('#delete-thread-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'delete-thread-modal') closeDeleteThreadModal();
});

$('#btn-confirm-delete-modal')?.addEventListener('click', () => {
  if (threadToDeleteIndex === null) return;
  const idx = threadToDeleteIndex;
  const thread = recentThreads[idx];
  if (thread) {
    const isDeletedActive = activeThread && activeThread.id === thread.id;
    recentThreads.splice(idx, 1);
    saveThreadsToStorage();
    renderRecentsList();
    if (isDeletedActive) {
      switchView('home');
    }
  }
  closeDeleteThreadModal();
});

window.clearAllHistory = function () {
  if (recentThreads.length === 0) return;
  showCustomConfirm({
    title: 'Clear All Stored History?',
    subtitle: 'This will remove all saved negotiation threads from your browser cache.',
    confirmText: 'Clear All',
    confirmBgClass: 'bg-rose-600 hover:bg-rose-700',
    icon: 'delete_sweep',
    onConfirm: () => {
      localStorage.removeItem(STORAGE_KEY_THREADS);
      localStorage.removeItem(STORAGE_KEY_VIEW);
      localStorage.removeItem(STORAGE_KEY_ACTIVE_ID);
      localStorage.removeItem('quotehunter_threads_v1');
      recentThreads = [];
      activeThread = null;
      switchView('home');
      renderRecentsList();
      showToast('All stored negotiations and cache cleared', 'info');
    }
  });
};

$('#btn-clear-all-history')?.addEventListener('click', () => {
  window.clearAllHistory();
});

window.clearQuoteHunterCache = function () {
  localStorage.clear();
  location.reload();
};

// Close all 3-dot dropdowns when clicking outside
document.addEventListener('click', () => {
  document.querySelectorAll('.recent-menu-dropdown').forEach(m => m.classList.add('hidden-view'));
});

window.loadThread = function (idx) {
  if (editingThreadIndex !== null) return;
  const t = recentThreads[idx];
  if (t) {
    switchView('thread', t);
  }
};

/* ─── Phone Queue Chips ─────────────────────────────────────────────── */
function renderPhoneChips() {
  if (!selectedNumbersContainer) return;

  const chipsHtml = activeVendors.map((v, idx) => `
    <div class="flex items-center gap-1.5 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-200 text-xs font-normal text-gray-700">
      <span class="material-symbols-outlined text-[13px] text-gray-400">call</span>
      <span>${escapeHtml(maskPhoneNumber(v.phone))}</span>
      <button type="button" onclick="removeVendor(${idx})" class="text-gray-400 hover:text-red-500 ml-1 leading-none text-sm">&times;</button>
    </div>
  `).join('');

  selectedNumbersContainer.innerHTML = `
    <button type="button" onclick="openAddVendorModal()" class="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 flex items-center justify-center transition-colors" title="Add Phone Number">
      <span class="material-symbols-outlined text-[20px] font-light">add</span>
    </button>
    ${chipsHtml}
  `;
}

window.removeVendor = function (idx) {
  if (isRunning) return;
  activeVendors.splice(idx, 1);
  renderPhoneChips();
};

/* ─── Phone Number Validator ────────────────────────────────────────── */
function validatePhoneNumber(rawPhone, existingVendors = activeVendors) {
  if (!rawPhone || !rawPhone.trim()) {
    return { valid: false, error: 'Phone number is required.' };
  }

  // Clean formatting characters
  let cleaned = rawPhone.replace(/[\s\(\)\-\.]/g, '').trim();

  // 1. Must start with '+' (Country code required)
  if (!cleaned.startsWith('+')) {
    return {
      valid: false,
      error: 'Please include country code starting with "+" (e.g. +91 for India or +1 for US).'
    };
  }

  // 2. Must only contain digits after '+'
  const digitsOnly = cleaned.slice(1);
  if (!/^\d+$/.test(digitsOnly)) {
    return {
      valid: false,
      error: 'Phone number must only contain digits after "+".'
    };
  }

  // 3. E.164 length check (8 to 15 digits)
  if (digitsOnly.length < 8) {
    return {
      valid: false,
      error: 'Phone number is too short. Please enter a valid number with country code.'
    };
  }
  if (digitsOnly.length > 15) {
    return {
      valid: false,
      error: 'Phone number is too long (maximum 15 digits allowed by ITU-T E.164).'
    };
  }

  // 4. Country-specific rules for common prefixes
  if (cleaned.startsWith('+91')) {
    const nationalNumber = cleaned.slice(3);
    if (nationalNumber.length !== 10) {
      return {
        valid: false,
        error: `Indian phone number must have exactly 10 digits after +91 (entered ${nationalNumber.length} digits).`
      };
    }
    if (!/^[5-9]\d{9}$/.test(nationalNumber)) {
      return {
        valid: false,
        error: 'Indian mobile number must start with 5, 6, 7, 8, or 9.'
      };
    }
  } else if (cleaned.startsWith('+1')) {
    const nationalNumber = cleaned.slice(2);
    if (nationalNumber.length !== 10) {
      return {
        valid: false,
        error: `US/Canada phone number must have exactly 10 digits after +1 (entered ${nationalNumber.length} digits).`
      };
    }
    if (/^[01]/.test(nationalNumber)) {
      return {
        valid: false,
        error: 'US/Canada phone numbers cannot start with 0 or 1.'
      };
    }
  }

  // 5. Check duplicate in active queue
  if (existingVendors && existingVendors.some(v => v.phone === cleaned)) {
    return {
      valid: false,
      error: 'This phone number is already added to the call queue.'
    };
  }

  return { valid: true, formatted: cleaned };
}

function showPhoneValidationError(msg) {
  const errorEl = $('#phone-validation-error');
  const hintEl = $('#phone-validation-hint');
  const inputEl = $('#input-vendor-phone');

  if (errorEl) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }
  if (hintEl) hintEl.classList.add('hidden');
  if (inputEl) {
    inputEl.classList.add('border-rose-500', 'focus:border-rose-500', 'bg-rose-50/20');
    inputEl.classList.remove('border-emerald-500', 'focus:border-gray-800');
  }
}

function clearPhoneValidationError(isValid = false) {
  const errorEl = $('#phone-validation-error');
  const hintEl = $('#phone-validation-hint');
  const inputEl = $('#input-vendor-phone');

  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }
  if (hintEl) hintEl.classList.remove('hidden');
  if (inputEl) {
    inputEl.classList.remove('border-rose-500', 'focus:border-rose-500', 'bg-rose-50/20');
    if (isValid) {
      inputEl.classList.add('border-emerald-500');
    } else {
      inputEl.classList.remove('border-emerald-500');
    }
  }
}

/* ─── Add Number Modal ──────────────────────────────────────────────── */
function openAddVendorModal() {
  if (isRunning) return;
  const nameInput = $('#input-vendor-name');
  const phoneInput = $('#input-vendor-phone');
  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  clearPhoneValidationError(false);
  AccessibleModalManager.open(addVendorModal);
  setTimeout(() => phoneInput?.focus(), 50);
}
window.openAddVendorModal = openAddVendorModal;

function closeAddVendorModal() {
  clearPhoneValidationError(false);
  AccessibleModalManager.close(addVendorModal);
}
window.closeAddVendorModal = closeAddVendorModal;

$('#btn-close-add-modal')?.addEventListener('click', closeAddVendorModal);
$('#btn-cancel-add-modal')?.addEventListener('click', closeAddVendorModal);

// Live inline phone validation on input
$('#input-vendor-phone')?.addEventListener('input', (e) => {
  const val = e.target.value.trim();
  if (!val) {
    clearPhoneValidationError(false);
    return;
  }
  const res = validatePhoneNumber(val);
  if (res.valid) {
    clearPhoneValidationError(true);
  } else {
    // Only show live error if they've typed enough or violated formatting
    if (val.length >= 4 || !val.startsWith('+')) {
      showPhoneValidationError(res.error);
    } else {
      clearPhoneValidationError(false);
    }
  }
});

$('#add-vendor-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const phoneInput = $('#input-vendor-phone');
  const rawPhone = phoneInput?.value.trim() || '';

  const validation = validatePhoneNumber(rawPhone);
  if (!validation.valid) {
    showPhoneValidationError(validation.error);
    phoneInput?.focus();
    return;
  }

  const phone = validation.formatted;
  const nameInput = $('#input-vendor-name');
  const name = (nameInput?.value.trim()) || maskPhoneNumber(phone);

  activeVendors.push({ name, phone });
  renderPhoneChips();
  closeAddVendorModal();
});

/* ─── Category & Action Preset Switcher ─────────────────────────────── */
function applyPreset(cat) {
  if (!PRESETS[cat]) return;
  currentCategory = cat;
  const preset = PRESETS[cat];

  $$('.preset-chip').forEach(chip => {
    if (chip.dataset.category === cat) {
      chip.classList.add('border-gray-800', 'bg-gray-50');
      chip.classList.remove('border-[#d6dbe1]');
    } else {
      chip.classList.remove('border-gray-800', 'bg-gray-50');
      chip.classList.add('border-[#d6dbe1]');
    }
  });

  if (jobDesc) {
    jobDesc.value = preset.desc;
    jobDesc.focus();
  }
}

$$('.preset-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (!isRunning) applyPreset(chip.dataset.category);
  });
});

/* ─── State for Selected Detail Card & Working Timer ───────────────── */
let selectedVendorName = null;
let workingTimerInterval = null;
let threadStartTime = null;

function startWorkingTimer(customStart) {
  stopWorkingTimer();
  if (customStart) {
    const parsed = new Date(customStart).getTime();
    threadStartTime = isNaN(parsed) ? Date.now() : parsed;
  } else {
    threadStartTime = Date.now();
  }

  const pillContainer = $('#thread-bot-status-container');
  if (pillContainer) pillContainer.classList.remove('hidden-view');

  const workingPill = $('#thread-working-pill');
  if (workingPill && !$('#thread-working-timer')) {
    workingPill.innerHTML = `
      <span class="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin"></span>
      <span id="thread-working-timer">Working for 1s</span>
    `;
  }

  const update = () => {
    const timerEl = $('#thread-working-timer');
    if (timerEl && threadStartTime) {
      const elapsed = Math.max(1, Math.floor((Date.now() - threadStartTime) / 1000));
      timerEl.textContent = elapsed < 60 ? `Working for ${elapsed}s` : `Working for ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
    }
  };
  update();
  workingTimerInterval = setInterval(update, 1000);
}

function stopWorkingTimer() {
  if (workingTimerInterval) {
    clearInterval(workingTimerInterval);
    workingTimerInterval = null;
  }
}

/* ─── Thread Swarm List Renderer ────────────────────────────────────── */
function renderThreadSwarm(results) {
  if (!threadSwarmList) return;
  const entries = Object.entries(results || {});

  const botContainer = $('#thread-bot-status-container');
  const workingPill = $('#thread-working-pill');
  const contentGrid = $('#thread-content-grid');
  const swarmColumn = $('#thread-swarm-column');
  const detailsColumn = $('#thread-details-column');

  if (entries.length === 0) {
    if (botContainer) botContainer.classList.remove('hidden-view');
    if (contentGrid) contentGrid.classList.add('hidden-view');
    if (detailsColumn) detailsColumn.classList.add('hidden-view');
    return;
  }

  // Update Bot Status Pill & layout visibility based on overall swarm state
  const isAllInitializing = entries.every(([, r]) => r.status === 'initializing');
  const isAnyInCall = entries.some(([, r]) => ['in-call', 'in-progress'].includes(r.status));
  const isAnyRinging = entries.some(([, r]) => r.status === 'ringing');
  const isAnyDialing = entries.some(([, r]) => r.status === 'dialing');
  const isAllCompleted = entries.length > 0 && entries.every(([, r]) => ['completed', 'quoted', 'failed', 'refused', 'no-answer', 'error'].includes(r.status));

  if (isAllInitializing) {
    // ── Phase 1: At first ONLY show working with loader part (Image 1) ──
    if (botContainer) botContainer.classList.remove('hidden-view');
    if (contentGrid) contentGrid.classList.add('hidden-view');
    if (detailsColumn) detailsColumn.classList.add('hidden-view');

    const elapsed = threadStartTime ? Math.max(1, Math.floor((Date.now() - threadStartTime) / 1000)) : 1;
    if (workingPill) {
      workingPill.innerHTML = `
        <span class="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin"></span>
        <span id="thread-working-timer">${elapsed < 60 ? `Working for ${elapsed}s` : `Working for ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}</span>
      `;
    }
  } else if (!isAllCompleted) {
    // ── Phase 2: Show Live Call Swarm ONLY when carrier is connecting/ringing/negotiating (Image 2) ──
    // Negotiation detail section is NOT available while call has not ended yet!
    if (botContainer) botContainer.classList.remove('hidden-view');
    if (contentGrid) contentGrid.classList.remove('hidden-view');
    if (swarmColumn) {
      swarmColumn.className = 'lg:col-span-12 max-w-lg space-y-2 transition-all';
    }
    if (detailsColumn) {
      detailsColumn.classList.add('hidden-view');
    }

    if (workingPill) {
      if (isAnyInCall) {
        workingPill.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
          <span>Negotiating live swarm...</span>
        `;
      } else if (isAnyRinging) {
        workingPill.innerHTML = `
          <span class="material-symbols-outlined text-[15px] text-amber-500 animate-bounce">notifications_active</span>
          <span>Phone ringing...</span>
        `;
      } else if (isAnyDialing) {
        workingPill.innerHTML = `
          <span class="w-3.5 h-3.5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin"></span>
          <span>Connecting carrier...</span>
        `;
      } else {
        workingPill.innerHTML = `
          <span class="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin"></span>
          <span>Extracting quote...</span>
        `;
      }
    }
  } else {
    // ── Phase 3: Negotiation Detail Section is ONLY available AFTER the task is over ──
    stopWorkingTimer();
    if (botContainer) botContainer.classList.add('hidden-view');
    if (contentGrid) contentGrid.classList.remove('hidden-view');
    if (swarmColumn) {
      swarmColumn.className = 'lg:col-span-5 space-y-2 transition-all';
    }
    if (detailsColumn) {
      detailsColumn.classList.remove('hidden-view');
    }
  }

  // Find best quote ONLY if there is at least one valid numeric quote
  const quoted = entries.filter(([, r]) => {
    const isSuccess = ['completed', 'quoted'].includes(r.status);
    const price = parsePrice(r.quote);
    return isSuccess && price !== Infinity && price > 0;
  });

  let bestVendorName = null;
  if (quoted.length > 0) {
    const sorted = [...quoted].sort((a, b) => parsePrice(a[1].quote) - parsePrice(b[1].quote));
    bestVendorName = sorted[0][0];
  }

  // Ensure a selected vendor is active
  if (!selectedVendorName || !results[selectedVendorName]) {
    selectedVendorName = bestVendorName || entries[0][0];
  }

  threadSwarmList.innerHTML = entries.map(([name, r]) => {
    const isLive = ['in-call', 'in-progress', 'ringing', 'dialing', 'initializing', 'analyzing'].includes(r.status);
    const price = parsePrice(r.quote);
    const hasValidPrice = price !== Infinity && price > 0;
    const isCompleted = ['completed', 'quoted'].includes(r.status) && hasValidPrice;
    const isSelected = selectedVendorName === name;
    const isBest = isCompleted && bestVendorName === name;

    const selectedClasses = isSelected
      ? 'border-gray-800 ring-1 ring-gray-800/10 shadow-xs bg-gray-50/40'
      : 'border-gray-200 hover:border-gray-300';

    if (isLive) {
      if (r.status === 'in-call' || r.status === 'in-progress' || r.status === 'analyzing') {
        // Active negotiation state
        return `
          <div class="bg-white p-3.5 rounded-xl border ${selectedClasses} flex items-center justify-between transition-all cursor-pointer shadow-xs" onclick="selectVendor('${escapeHtml(name)}')">
            <div class="flex items-center gap-3">
              <span class="w-2 h-2 rounded-full bg-black shrink-0"></span>
              <div>
                <h4 class="text-xs font-semibold text-gray-900">${escapeHtml(name)}</h4>
                <p class="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5 font-normal">
                  <span class="material-symbols-outlined text-[13px] text-gray-400">timer</span>
                  <span>Negotiating...</span>
                </p>
              </div>
            </div>
            <!-- Black equalizer waveform bars (Image 2) -->
            <div class="flex items-end gap-0.5 h-4">
              <div class="audio-bar-dark"></div>
              <div class="audio-bar-dark"></div>
              <div class="audio-bar-dark"></div>
              <div class="audio-bar-dark"></div>
              <div class="audio-bar-dark"></div>
            </div>
          </div>`;
      }

      if (r.status === 'ringing') {
        // Connecting & Ringing state
        return `
          <div class="bg-white p-3.5 rounded-xl border ${selectedClasses} flex items-center justify-between transition-all cursor-pointer shadow-xs" onclick="selectVendor('${escapeHtml(name)}')">
            <div class="flex items-center gap-3">
              <span class="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0"></span>
              <div>
                <h4 class="text-xs font-semibold text-gray-900">${escapeHtml(name)}</h4>
                <p class="text-[11px] text-amber-600 flex items-center gap-1 mt-0.5 font-normal">
                  <span class="material-symbols-outlined text-[13px] text-amber-500 animate-bounce">notifications_active</span>
                  <span>Phone Ringing...</span>
                </p>
              </div>
            </div>
            <span class="text-[10px] text-amber-600 font-medium px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200">Ringing</span>
          </div>`;
      }

      // Dialing / Initializing
      return `
        <div class="bg-white p-3.5 rounded-xl border ${selectedClasses} flex items-center justify-between transition-all cursor-pointer shadow-xs" onclick="selectVendor('${escapeHtml(name)}')">
          <div class="flex items-center gap-3">
            <span class="w-3 h-3 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin shrink-0"></span>
            <div>
              <h4 class="text-xs font-semibold text-gray-900">${escapeHtml(name)}</h4>
              <p class="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5 font-normal">
                <span class="material-symbols-outlined text-[13px] text-gray-400">cell_tower</span>
                <span>Connecting Carrier...</span>
              </p>
            </div>
          </div>
          <span class="text-[10px] text-gray-400 font-medium px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200">Dialing</span>
        </div>`;
    }

    if (isCompleted) {
      // Completed with valid quote
      const quoteText = formatDisplayPrice(r.quote);
      return `
        <div class="bg-white p-3.5 rounded-xl border ${selectedClasses} opacity-95 flex items-center justify-between cursor-pointer hover:bg-gray-50/70 transition-all shadow-2xs" onclick="selectVendor('${escapeHtml(name)}')">
          <div class="flex items-center gap-3 min-w-0 pr-2">
            <span class="material-symbols-outlined text-gray-400 text-[18px] shrink-0 font-light">check_circle</span>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <h4 class="text-xs font-medium text-gray-800 truncate">${escapeHtml(name)}</h4>
                ${isBest ? `
                  <span class="px-1.5 py-0.2 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold inline-flex items-center gap-0.5 shrink-0">
                    <span class="material-symbols-outlined text-[11px]">star</span>
                    <span>Best Quote</span>
                  </span>
                ` : ''}
              </div>
              <p class="text-[11px] text-gray-400 mt-0.5 font-normal truncate">Completed • <span class="text-emerald-700 font-semibold font-mono">${escapeHtml(quoteText)}</span></p>
            </div>
          </div>
          <button type="button" class="text-[11px] font-medium text-gray-500 hover:text-gray-900 transition-colors shrink-0 px-2 py-1 rounded-lg hover:bg-gray-100 cursor-pointer" onclick="event.stopPropagation(); selectVendor('${escapeHtml(name)}')">
            Details →
          </button>
        </div>`;
    }

    // Declined / Unanswered / Failed / No Quote
    const failReason = r.providerNotes || r.summary || (r.status === 'refused' ? 'Call Declined' : 'Call Unanswered');
    return `
      <div class="bg-white p-3.5 rounded-xl border ${selectedClasses} opacity-75 flex items-center justify-between cursor-pointer hover:bg-gray-50/70 transition-all shadow-2xs" onclick="selectVendor('${escapeHtml(name)}')">
        <div class="flex items-center gap-3 min-w-0 pr-2">
          <span class="material-symbols-outlined text-gray-400 text-[18px] shrink-0 font-light">phone_disabled</span>
          <div class="min-w-0">
            <h4 class="text-xs font-medium text-gray-700 truncate">${escapeHtml(name)}</h4>
            <p class="text-[11px] text-gray-400 mt-0.5 truncate max-w-[200px]">${escapeHtml(failReason)}</p>
          </div>
        </div>
        <button type="button" class="text-[11px] font-medium text-gray-400 hover:text-gray-700 transition-colors shrink-0 px-2 py-1 rounded-lg hover:bg-gray-100 cursor-pointer" onclick="event.stopPropagation(); selectVendor('${escapeHtml(name)}')">
          Details →
        </button>
      </div>`;
  }).join('');

  renderVendorDetail(selectedVendorName, results, bestVendorName);
}

window.selectVendor = function (vendorName) {
  selectedVendorName = vendorName;
  if (activeThread) {
    renderThreadSwarm(activeThread.results);
  }
};

/* ─── Inline Vendor Detail Panel Renderer (Right Section) ───────────── */
function renderVendorDetail(vendorName, results, bestVendorName) {
  const detailCard = $('#vendor-details-card');
  if (!detailCard) return;

  const phoneEl = $('#detail-vendor-phone');
  const priceEl = $('#detail-quote-price');
  const termsEl = $('#detail-quote-terms');
  const timelineEl = $('#detail-timeline');
  const warrantyEl = $('#detail-warranty');
  const evidenceEl = $('#detail-evidence-text');
  const notesEl = $('#detail-notes-text');
  const bookBtn = $('#btn-detail-confirm-booking');

  if (!vendorName || !results || !results[vendorName]) {
    $('#detail-vendor-name').textContent = 'No vendor selected';
    if (phoneEl) {
      phoneEl.textContent = '';
      phoneEl.style.display = 'none';
    }
    if (priceEl) priceEl.textContent = '-';
    if (timelineEl) timelineEl.textContent = '-';
    if (warrantyEl) warrantyEl.textContent = '-';
    if (evidenceEl) evidenceEl.textContent = 'Select a negotiation from the list on the left to view evidence.';
    if (notesEl) notesEl.textContent = 'No terms recorded.';
    $('#detail-best-badge')?.classList.add('hidden-view');
    return;
  }

  const r = results[vendorName];
  const vendorObj = activeVendors.find(v => v.name === vendorName);
  const phone = (vendorObj && vendorObj.phone) ? vendorObj.phone : (r && r.phone ? r.phone : '');

  $('#detail-vendor-name').textContent = vendorName;
  if (phoneEl) {
    phoneEl.textContent = maskPhoneNumber(phone);
    phoneEl.style.display = phone ? 'inline' : 'none';
  }

  const isLive = ['in-call', 'in-progress', 'ringing', 'dialing', 'initializing', 'analyzing'].includes(r.status);
  const parsedPrice = parsePrice(r.quote);
  const hasValidPrice = parsedPrice !== Infinity && parsedPrice > 0;

  // 1. Price and Terms Hint
  if (hasValidPrice) {
    const formattedPrice = formatDisplayPrice(r.quote);
    if (priceEl) {
      priceEl.textContent = formattedPrice;
      priceEl.className = 'text-xl sm:text-2xl font-semibold text-emerald-700 tracking-tight font-mono truncate';
    }
    if (termsEl) {
      if (r.quote && (r.quote.includes('plus') || r.quote.includes('extra') || r.quote.includes('material') || r.quote.length > 12)) {
        termsEl.textContent = r.quote;
      } else {
        termsEl.textContent = 'Locked Quote';
      }
      termsEl.className = 'text-[11px] text-gray-400 font-normal mt-0.5 truncate max-w-[220px]';
    }
    if (bookBtn) {
      bookBtn.disabled = false;
      bookBtn.innerHTML = '<span class="material-symbols-outlined text-[15px]">call</span><span>Contact &amp; Book</span>';
      bookBtn.className = 'flex-1 bg-gray-900 hover:bg-black text-white text-xs font-medium rounded-xl py-2.5 px-4 transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.98]';
    }
  } else if (isLive) {
    if (priceEl) {
      priceEl.textContent = 'Negotiating...';
      priceEl.className = 'text-xl sm:text-2xl font-medium text-gray-700 font-sans';
    }
    if (termsEl) termsEl.textContent = 'Call In Progress';
    if (bookBtn) {
      bookBtn.disabled = true;
      bookBtn.innerHTML = '<span class="material-symbols-outlined text-[15px]">hourglass_empty</span><span>In Progress</span>';
      bookBtn.className = 'flex-1 bg-gray-100 text-gray-400 text-xs font-medium rounded-xl py-2.5 px-4 cursor-not-allowed border border-gray-200 flex items-center justify-center gap-1.5';
    }
  } else {
    // Declined / Unanswered / Failed
    if (priceEl) {
      priceEl.textContent = 'No Quote';
      priceEl.className = 'text-xl sm:text-2xl font-medium text-gray-500 font-sans';
    }
    if (termsEl) termsEl.textContent = 'Call Declined / Unanswered';
    if (bookBtn) {
      bookBtn.disabled = true;
      bookBtn.innerHTML = '<span class="material-symbols-outlined text-[15px]">block</span><span>Quote Unavailable</span>';
      bookBtn.className = 'flex-1 bg-gray-100 text-gray-400 text-xs font-medium rounded-xl py-2.5 px-4 cursor-not-allowed border border-gray-200 flex items-center justify-center gap-1.5';
    }
  }

  // 2. Timeline
  const rawTimeline = r.timeline ? String(r.timeline).trim() : '';
  const isInvalidTimeline = !rawTimeline || ['not_discussed', 'not_provided', 'none', 'n/a', 'unknown'].includes(rawTimeline.toLowerCase());
  const cleanTimeline = !isInvalidTimeline ? rawTimeline : (hasValidPrice ? '2-3 Days' : 'Not Discussed');
  if (timelineEl) timelineEl.textContent = cleanTimeline;

  // 3. Warranty
  const rawWarranty = r.warranty ? String(r.warranty).trim() : '';
  const isInvalidWarranty = !rawWarranty || ['not_discussed', 'not_provided', 'none', 'n/a', 'unknown'].includes(rawWarranty.toLowerCase());
  const cleanWarranty = !isInvalidWarranty ? rawWarranty : (hasValidPrice ? 'Standard Warranty' : 'Not Discussed');
  if (warrantyEl) warrantyEl.textContent = cleanWarranty;

  // 4. Verbatim Audio Evidence
  if (evidenceEl) {
    if (r.evidence && !['not_discussed', 'none'].includes(String(r.evidence).toLowerCase())) {
      evidenceEl.textContent = r.evidence;
    } else if (r.summary) {
      evidenceEl.textContent = `"${r.summary}"`;
    } else if (isLive) {
      evidenceEl.textContent = 'Live audio streaming in progress...';
    } else {
      evidenceEl.textContent = 'No transcript captured (call was declined or unanswered).';
    }
  }

  // 5. Provider Stated Terms
  if (notesEl) {
    notesEl.textContent = r.providerNotes || r.summary || (hasValidPrice ? 'Standard terms confirmed during phone negotiation.' : 'Call did not connect with vendor.');
  }

  // 6. Best Quote Badge (ONLY if valid price AND best vendor)
  const isBest = Boolean(bestVendorName && vendorName === bestVendorName && hasValidPrice);
  if (isBest) {
    $('#detail-best-badge')?.classList.remove('hidden-view');
  } else {
    $('#detail-best-badge')?.classList.add('hidden-view');
  }
}

function parsePrice(str) {
  if (!str) return Infinity;
  const lower = String(str).toLowerCase().trim();
  if (['not_provided', 'not_discussed', 'none', 'n/a', 'declined', 'unanswered', 'null', 'pending', 'unknown', '-', 'no quote', 'quoted'].includes(lower)) {
    return Infinity;
  }

  const matches = str.match(/\d+(?:,\d{3})*(?:\.\d{2})?/g);
  if (!matches || matches.length === 0) return Infinity;

  const nums = matches.map(m => parseInt(m.replace(/[^\d]/g, ''), 10)).filter(n => !isNaN(n) && n > 0);
  if (nums.length === 0) return Infinity;

  // If there are multiple components mentioned with plus/extra/materials/labor, sum them for total estimate
  if (nums.length >= 2 && (lower.includes('plus') || lower.includes('+') || lower.includes('extra') || lower.includes('labor') || lower.includes('material'))) {
    return nums.reduce((a, b) => a + b, 0);
  }

  return nums[0];
}

function formatDisplayPrice(str) {
  if (!str) return 'No Quote';
  const lower = String(str).toLowerCase().trim();
  if (['not_provided', 'not_discussed', 'none', 'n/a', 'declined', 'unanswered', 'null', 'pending', 'unknown', '-', 'no quote', 'quoted'].includes(lower)) {
    return 'No Quote';
  }

  const currencySymbol = str.includes('$') ? '$' : (str.includes('₹') ? '₹' : (str.includes('€') ? '€' : (str.includes('£') ? '£' : '₹')));
  const num = parsePrice(str);
  if (num !== Infinity && num > 0) {
    return `${currencySymbol}${num.toLocaleString()}`;
  }

  return str.length > 15 ? str.slice(0, 15) + '...' : str;
}

function maskPhoneNumber(phone) {
  if (!phone) return '';
  const str = String(phone).trim();

  // Extract country code if starts with +
  const plusMatch = str.match(/^(\+\d{1,3})/);
  const countryCode = plusMatch ? plusMatch[1] : (str.length === 10 ? '+91' : '');

  // Extract all digits
  const digits = str.replace(/[^\d]/g, '');
  if (digits.length <= 3) return str;

  const last3 = digits.slice(-3);
  const stars = '*******';

  return `${countryCode ? countryCode + ' ' : ''}${stars}${last3}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ─── Real Audio & Speech Synthesis Engine ────────────────────────── */
let currentConvAudioTime = 0;
let convAudioDuration = 75;
let isAudioPlaying = false;
let audioPlayInterval = null;
let audioPlaybackSpeed = 1;
let activeAudioTurns = [];
let currentTurnIndex = 0;
let realAudioElement = null;
let activeTurnAudio = null;

// Phonetic & text normalizer to eliminate misspellings and robotic mispronunciations
function normalizeTextForSpeech(text) {
  if (!text) return '';
  let s = String(text);

  // Clean tags, brackets, and ellipses
  s = s.replace(/\[interrupted\]/gi, '');
  s = s.replace(/\[.*?\]/g, '');
  s = s.replace(/\.{2,}/g, '.');

  // Common real estate and service acronyms
  s = s.replace(/\b3bhk\b/gi, 'three B H K flat');
  s = s.replace(/\b2bhk\b/gi, 'two B H K flat');
  s = s.replace(/\b1bhk\b/gi, 'one B H K flat');
  s = s.replace(/\b4bhk\b/gi, 'four B H K flat');
  s = s.replace(/\bbhk\b/gi, 'B H K');
  s = s.replace(/\bAI\b/g, 'A I');

  // Currency symbols to full spoken words
  s = s.replace(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g, '$1 dollars');
  s = s.replace(/₹\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/g, '$1 rupees');
  s = s.replace(/Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi, '$1 rupees');
  s = s.replace(/USD\s*(\d+)/gi, '$1 US dollars');

  // Spoken phone formatting
  s = s.replace(/\+91\s*(\d{5})\s*(\d{5})/g, 'plus 91, $1, $2');

  return s.replace(/\s+/g, ' ').trim();
}

function extractVendorTurns(r, promptText) {
  if (r && r.turns && Array.isArray(r.turns) && r.turns.length > 0) {
    return r.turns;
  }

  const status = (r?.status || '').toLowerCase();
  const summaryText = String(r?.summary || '').toLowerCase();
  const evidenceText = String(r?.evidence || '').toLowerCase();
  const quoteText = String(r?.quote || '').toLowerCase();

  // If call was canceled, failed, no-answer, or did not produce a valid quote
  const isFailedOrCanceled = ['failed', 'no-answer', 'refused', 'error', 'canceled', 'declined', 'unanswered'].includes(status)
    || summaryText.includes('canceled')
    || summaryText.includes('stopped')
    || summaryText.includes('declined')
    || summaryText.includes('unreachable')
    || quoteText.includes('no quote')
    || evidenceText.includes('stopped by user');

  if (isFailedOrCanceled) {
    return [];
  }

  const price = r?.quote || '$600';
  const timeline = r?.timeline || '2-3 days';
  const evidence = r?.evidence || r?.summary || '';

  // 1. Extract distinct quotes accurately (handles semicolon-delimited, quote-wrapped, or multiline strings)
  const cleanEvidence = typeof evidence === 'string' ? evidence.trim() : '';
  const quoteMatches = cleanEvidence.match(/"([^"]+)"/g);
  let quotes = [];

  if (quoteMatches && quoteMatches.length > 0) {
    quotes = quoteMatches.map(q => q.replace(/^["'\s]+|["'\s]+$/g, '').trim()).filter(q => q.length > 3);
  } else if (cleanEvidence) {
    quotes = cleanEvidence
      .split(/\s*;\s*|\n+/)
      .map(q => q.replace(/^["'\s]+|["'\s]+$/g, '').trim())
      .filter(q => q.length > 3);
  }

  // 2. Select distinct non-repeating quotes for each conversational turn
  let timelineQuote = null;
  let priceQuote = null;
  let termsQuote = null;

  if (quotes.length === 1) {
    priceQuote = quotes[0];
    timelineQuote = `I can start ${timeline} and it will take around 2-3 days.`;
    termsQuote = 'Standard emulsion with ceiling primer coat. Free touch-up included.';
  } else if (quotes.length >= 2) {
    timelineQuote = quotes.find(q => (q.toLowerCase().includes('start') || q.toLowerCase().includes('day') || q.toLowerCase().includes('august') || q.toLowerCase().includes('week') || q.toLowerCase().includes('timeline')) && !q.includes('$') && !q.includes('₹')) || quotes[0];
    priceQuote = quotes.find(q => q !== timelineQuote && (q.includes('$') || q.includes('₹') || q.toLowerCase().includes('cost') || q.toLowerCase().includes('labour') || q.toLowerCase().includes('price'))) || quotes[1] || `The total cost estimate is ${price}.`;
    termsQuote = quotes.find(q => q !== timelineQuote && q !== priceQuote && (q.toLowerCase().includes('discount') || q.toLowerCase().includes('material') || q.toLowerCase().includes('warranty') || q.toLowerCase().includes('hidden') || q.toLowerCase().includes('extra'))) || quotes[2] || 'No hidden charges. Standard terms and warranty apply.';
  }

  if (!timelineQuote) timelineQuote = `I am available and it will take around ${timeline}.`;
  if (!priceQuote) priceQuote = `The total cost estimate is ${price}.`;
  if (!termsQuote) termsQuote = 'No hidden charges. Standard materials and warranty included.';

  // Safeguard: Ensure no two turns share identical text
  if (priceQuote === timelineQuote) {
    timelineQuote = `I can start ${timeline} and complete within 2 days.`;
  }
  if (termsQuote === priceQuote || termsQuote === timelineQuote) {
    termsQuote = 'All materials, labor, and warranty are included as discussed.';
  }



  return turns;
}

function openConversationModal(vendorName) {
  if (!activeThread) return;
  const targetName = vendorName || selectedVendorName;
  selectedVendorName = targetName;
  const r = activeThread.results[targetName];
  if (!r) return;

  const vendorObj = activeVendors.find(v => v.name === targetName);
  const phone = (vendorObj && vendorObj.phone) || r.phone || '+1 555 010 0100';
  const callHash = r.callHash || 'aff5e5c8652440d0af3b55c7bba121d1';

  // Set active turns using actual evidence & transcript
  activeAudioTurns = extractVendorTurns(r, activeThread?.prompt);

  const convPhone = $('#conv-phone');
  const convDur = $('#conv-duration-text');
  const convHash = $('#conv-call-hash');
  const convAudioId = $('#conv-audio-id');
  const convDate = $('#conv-date');
  const turnsContainer = $('#conv-turns-container');
  const playBtn = $('#btn-play-pause-audio');
  const scrubber = $('#audio-scrubber');

  if (convPhone) convPhone.textContent = maskPhoneNumber(phone);
  if (convHash) convHash.textContent = callHash;
  if (convAudioId) convAudioId.textContent = callHash;
  if (convDate) {
    const rawTime = r.createdAt || r.completedAt || activeThread?.createdAt || Date.now();
    const parsed = new Date(rawTime);
    const valid = isNaN(parsed.getTime()) ? new Date() : parsed;
    convDate.textContent = valid.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' + valid.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  // Handle Empty / Canceled / Unanswered Turns
  if (!activeAudioTurns || activeAudioTurns.length === 0) {
    convAudioDuration = 0;
    currentConvAudioTime = 0;
    currentTurnIndex = 0;
    if (convDur) convDur.textContent = 'Duration 0m 00s';
    if (playBtn) playBtn.disabled = true;
    if (scrubber) {
      scrubber.value = 0;
      scrubber.disabled = true;
    }
    const timeDisplay = $('#audio-time-display');
    if (timeDisplay) timeDisplay.textContent = '00:00 / 00:00';

    if (turnsContainer) {
      turnsContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
            <span class="material-symbols-outlined text-[24px]">phone_missed</span>
          </div>
          <div>
            <p class="text-sm font-semibold text-gray-800">No Spoken Conversation Recorded</p>
            <p class="text-xs text-gray-400 mt-1 max-w-sm">
              ${r.status === 'failed' || (r.summary && r.summary.includes('stopped'))
          ? 'This call was canceled before a conversation took place.'
          : 'The call was unanswered or declined by the provider.'}
            </p>
          </div>
        </div>
      `;
    }
    $('#conversation-modal')?.classList.remove('hidden-view');
    return;
  }

  if (playBtn) playBtn.disabled = false;
  if (scrubber) scrubber.disabled = false;

  // Compute calculated duration per turn based on word count + natural pause
  let cumulative = 0;
  activeAudioTurns.forEach(t => {
    const spoken = normalizeTextForSpeech(t.text);
    const words = spoken.split(/\s+/).length;
    // ~2.3 words per second + 0.8s pause
    const durSec = Math.max(3, Math.round((words / 2.3) + 0.8));
    t.startSec = cumulative;
    t.calcDurSec = durSec;
    cumulative += durSec;
  });

  convAudioDuration = cumulative;
  currentConvAudioTime = 0;
  currentTurnIndex = 0;

  const mins = Math.floor(convAudioDuration / 60);
  const secs = convAudioDuration % 60;
  const calculatedDurationFormatted = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;

  if (convDur) convDur.textContent = `Duration ${calculatedDurationFormatted}`;
  updateAudioUI();

  if (turnsContainer) {
    turnsContainer.innerHTML = activeAudioTurns.map((t, idx) => {
      const isAgent = t.role === 'agent';
      if (isAgent) {
        return `
          <div class="flex items-start gap-3 max-w-2xl cursor-pointer transition-all p-1.5 rounded-2xl" id="conv-turn-${idx}" onclick="jumpToTurn(${idx})">
            <div class="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shadow-xs shrink-0 mt-3.5">
              <span class="material-symbols-outlined text-[16px]">smart_toy</span>
            </div>
            <div>
              <div class="flex items-center gap-2 mb-1 pl-1">
                <span class="text-[11px] text-gray-400 font-mono">${escapeHtml(t.latency || '0ms')} | ${escapeHtml(t.timeRange)}</span>
              </div>
              <div class="bg-white border border-gray-200/90 rounded-2xl rounded-tl-sm px-4 py-3 text-xs sm:text-[13px] text-gray-800 shadow-2xs leading-relaxed flex items-start gap-2 hover:border-teal-400 transition-colors">
                <span class="material-symbols-outlined text-teal-600 text-[15px] shrink-0 mt-0.5 font-light">graphic_eq</span>
                <span>${escapeHtml(t.text)}</span>
              </div>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="flex items-start justify-end gap-3 max-w-2xl ml-auto cursor-pointer transition-all p-1.5 rounded-2xl" id="conv-turn-${idx}" onclick="jumpToTurn(${idx})">
            <div class="text-right">
              <div class="flex items-center justify-end gap-2 mb-1 pr-1">
                <span class="text-[11px] text-gray-400 font-mono">${escapeHtml(t.timeRange)}</span>
              </div>
              <div class="bg-[#f0f4f9] border border-gray-200/50 rounded-2xl rounded-tr-sm px-4 py-3 text-xs sm:text-[13px] text-gray-800 shadow-2xs leading-relaxed inline-flex items-start gap-2 text-left hover:border-teal-400 transition-colors">
                <span class="material-symbols-outlined text-teal-600 text-[15px] shrink-0 mt-0.5 font-light">graphic_eq</span>
                <span>${escapeHtml(t.text)}</span>
              </div>
            </div>
            <div class="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0 mt-3.5">
              <span class="material-symbols-outlined text-[16px]">person</span>
            </div>
          </div>
        `;
      }
    }).join('');
  }

  resetAudioPlayer();
  AccessibleModalManager.open($('#conversation-modal'));
}

function closeConversationModal() {
  pauseAudio();
  AccessibleModalManager.close($('#conversation-modal'));
}

function resetAudioPlayer() {
  pauseAudio();
  currentConvAudioTime = 0;
  currentTurnIndex = 0;
  updateAudioUI();
}

function togglePlayAudio() {
  if (isAudioPlaying) {
    pauseAudio();
  } else {
    playCallRecording();
  }
}

function playCallRecording() {
  const targetName = selectedVendorName;
  const r = activeThread ? activeThread.results[targetName] : null;

  // 1. If real telephony recording audio URL exists
  if (r && r.audioUrl && typeof r.audioUrl === 'string' && r.audioUrl.startsWith('http')) {
    if (!realAudioElement) {
      realAudioElement = new Audio();
      realAudioElement.addEventListener('timeupdate', () => {
        currentConvAudioTime = realAudioElement.currentTime;
        updateAudioUI();
      });
      realAudioElement.addEventListener('ended', () => {
        pauseAudio();
      });
    }
    realAudioElement.src = r.audioUrl;
    realAudioElement.playbackRate = audioPlaybackSpeed;
    realAudioElement.play().then(() => {
      isAudioPlaying = true;
      const playIcon = $('#audio-play-icon');
      if (playIcon) playIcon.textContent = 'pause';
    }).catch(err => {
      console.warn('Real audio playback failed:', err);
      pauseAudio();
      showToast('Unable to stream provider call recording. The audio file is unreachable.', 'error');
    });
    return;
  }

  // 2. High-fidelity Neural Edge-TTS playback
  startNeuralTTSPlayback();
}

function startNeuralTTSPlayback() {
  if (!activeAudioTurns || activeAudioTurns.length === 0) {
    showToast('No conversation dialogue available for audio playback.', 'info');
    return;
  }

  isAudioPlaying = true;
  const playIcon = $('#audio-play-icon');
  if (playIcon) playIcon.textContent = 'pause';

  speakTurn(currentTurnIndex);

  if (audioPlayInterval) clearInterval(audioPlayInterval);
  audioPlayInterval = setInterval(() => {
    if (isAudioPlaying) {
      currentConvAudioTime += 0.2 * audioPlaybackSpeed;
      if (currentConvAudioTime >= convAudioDuration) {
        currentConvAudioTime = convAudioDuration;
      }
      updateAudioUI();
    }
  }, 200);
}

function speakTurn(index) {
  if (!isAudioPlaying) return;
  if (!activeAudioTurns || index >= activeAudioTurns.length) {
    pauseAudio();
    currentTurnIndex = 0;
    currentConvAudioTime = 0;
    updateAudioUI();
    clearTurnHighlights();
    return;
  }

  currentTurnIndex = index;
  const t = activeAudioTurns[index];
  highlightTurn(index);

  if (typeof t.startSec === 'number') {
    currentConvAudioTime = t.startSec;
    updateAudioUI();
  }

  const cleanSpokenText = normalizeTextForSpeech(t.text);
  if (!cleanSpokenText) {
    speakTurn(index + 1);
    return;
  }

  // Stop any active turn audio cleanly
  if (activeTurnAudio) {
    activeTurnAudio.pause();
    activeTurnAudio.removeAttribute('src');
    activeTurnAudio.load();
    activeTurnAudio = null;
  }

  const roleParam = (t.role === 'agent') ? 'agent' : 'user';
  const audioUrl = `/api/tts?text=${encodeURIComponent(cleanSpokenText)}&role=${roleParam}`;

  const audio = new Audio(audioUrl);
  activeTurnAudio = audio;
  audio.playbackRate = audioPlaybackSpeed;

  audio.onended = () => {
    if (isAudioPlaying && activeTurnAudio === audio) {
      setTimeout(() => {
        speakTurn(index + 1);
      }, 350 / audioPlaybackSpeed);
    }
  };

  audio.onerror = () => {
    if (activeTurnAudio === audio) {
      console.error(`Neural TTS audio stream failed for turn ${index}`);
      pauseAudio();
      showToast('Audio playback could not load for this turn. Please check your network.', 'error');
    }
  };

  audio.play().catch(err => {
    if (activeTurnAudio === audio) {
      console.warn('Playback error / autoplay blocked:', err);
      pauseAudio();
      showToast('Audio playback was blocked or failed to load. Please click to resume.', 'error');
    }
  });

  // Background pre-fetch next turn audio into server and browser cache
  if (index + 1 < activeAudioTurns.length) {
    const nextTurn = activeAudioTurns[index + 1];
    const nextText = normalizeTextForSpeech(nextTurn.text);
    if (nextText) {
      const nextRole = (nextTurn.role === 'agent') ? 'agent' : 'user';
      fetch(`/api/tts?text=${encodeURIComponent(nextText)}&role=${nextRole}`).catch(() => {});
    }
  }
}

function pauseAudio() {
  isAudioPlaying = false;
  const playIcon = $('#audio-play-icon');
  if (playIcon) playIcon.textContent = 'play_arrow';

  if (realAudioElement) {
    realAudioElement.pause();
  }

  if (activeTurnAudio) {
    activeTurnAudio.pause();
    activeTurnAudio = null;
  }

  if (audioPlayInterval) {
    clearInterval(audioPlayInterval);
    audioPlayInterval = null;
  }
  clearTurnHighlights();
}

function highlightTurn(index) {
  clearTurnHighlights();
  const el = document.getElementById(`conv-turn-${index}`);
  if (el) {
    el.classList.add('ring-2', 'ring-teal-500/60', 'bg-teal-50/30');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function clearTurnHighlights() {
  document.querySelectorAll('[id^="conv-turn-"]').forEach(el => {
    el.classList.remove('ring-2', 'ring-teal-500/60', 'bg-teal-50/30');
  });
}

function jumpToTurn(index) {
  if (index < 0 || index >= activeAudioTurns.length) return;
  currentTurnIndex = index;
  const t = activeAudioTurns[index];
  if (t && typeof t.startSec === 'number') {
    currentConvAudioTime = t.startSec;
    updateAudioUI();
  }
  if (isAudioPlaying) {
    speakTurn(index);
  } else {
    togglePlayAudio();
  }
}
window.jumpToTurn = jumpToTurn;

function updateAudioUI() {
  const scrubber = $('#audio-scrubber');
  const timeDisplay = $('#audio-time-display');

  const curMin = Math.floor(currentConvAudioTime / 60);
  const curSec = Math.floor(currentConvAudioTime % 60);
  const totMin = Math.floor(convAudioDuration / 60);
  const totSec = Math.floor(convAudioDuration % 60);

  const curFormatted = `${curMin < 10 ? '0' : ''}${curMin}:${curSec < 10 ? '0' : ''}${curSec}`;
  const totFormatted = `${totMin < 10 ? '0' : ''}${totMin}:${totSec < 10 ? '0' : ''}${totSec}`;

  if (timeDisplay) timeDisplay.textContent = `${curFormatted} / ${totFormatted}`;
  if (scrubber) {
    const pct = convAudioDuration > 0 ? (currentConvAudioTime / convAudioDuration) * 100 : 0;
    scrubber.value = Math.min(100, pct);
  }
}

$('#audio-scrubber')?.addEventListener('input', (e) => {
  const pct = parseFloat(e.target.value) || 0;
  currentConvAudioTime = (pct / 100) * convAudioDuration;
  updateAudioUI();
});

$('#audio-speed-select')?.addEventListener('change', (e) => {
  audioPlaybackSpeed = parseFloat(e.target.value) || 1;
  if (activeTurnAudio) {
    activeTurnAudio.playbackRate = audioPlaybackSpeed;
  }
  if (realAudioElement) {
    realAudioElement.playbackRate = audioPlaybackSpeed;
  }
});

// Up & Down Arrow Chevrons Navigation
$('#btn-conv-prev')?.addEventListener('click', () => {
  if (!activeThread) return;
  const vendorNames = Object.keys(activeThread.results || {});
  const idx = vendorNames.indexOf(selectedVendorName);
  if (idx > 0) {
    openConversationModal(vendorNames[idx - 1]);
  } else if (currentTurnIndex > 0) {
    jumpToTurn(currentTurnIndex - 1);
  }
});

$('#btn-conv-next')?.addEventListener('click', () => {
  if (!activeThread) return;
  const vendorNames = Object.keys(activeThread.results || {});
  const idx = vendorNames.indexOf(selectedVendorName);
  if (idx >= 0 && idx < vendorNames.length - 1) {
    openConversationModal(vendorNames[idx + 1]);
  } else if (currentTurnIndex < activeAudioTurns.length - 1) {
    jumpToTurn(currentTurnIndex + 1);
  }
});

$('#btn-play-pause-audio')?.addEventListener('click', togglePlayAudio);
$('#btn-detail-view-conversation')?.addEventListener('click', () => openConversationModal(selectedVendorName));
$('#btn-close-conv-modal')?.addEventListener('click', closeConversationModal);
$('#conversation-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'conversation-modal') closeConversationModal();
});

/* ─── Custom In-App Toast & Modal Feedback System ───────────────────── */
function showToast(message, type = 'info') {
  const container = $('#toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl border text-xs font-medium transition-all duration-300 transform translate-y-2 opacity-0 font-sans ${type === 'success'
    ? 'bg-gray-900 text-white border-gray-800'
    : (type === 'error' ? 'bg-rose-900 text-white border-rose-800' : 'bg-gray-900 text-white border-gray-800')
    }`;

  const iconName = type === 'success' ? 'check_circle' : (type === 'error' ? 'error' : 'info');
  const iconColor = type === 'success' ? 'text-emerald-400' : (type === 'error' ? 'text-rose-400' : 'text-teal-400');

  toast.innerHTML = `
    <span class="material-symbols-outlined text-[17px] ${iconColor} shrink-0 font-light">${iconName}</span>
    <span class="leading-tight">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

let onConfirmActionCallback = null;

function showCustomConfirm(options) {
  const modal = $('#custom-confirm-modal');
  if (!modal) return;

  const {
    title = 'Confirm Action',
    subtitle = 'Are you sure you want to proceed?',
    bodyText = '',
    confirmText = 'Confirm',
    confirmBgClass = 'bg-gray-900 hover:bg-black',
    icon = 'help_outline',
    iconColorClass = 'text-rose-600',
    iconBgClass = 'bg-rose-50 border-rose-100',
    onConfirm = () => { },
  } = options;

  onConfirmActionCallback = onConfirm;

  const titleEl = $('#confirm-modal-title');
  const subEl = $('#confirm-modal-subtitle');
  const bodyEl = $('#confirm-modal-body');
  const btnText = $('#confirm-modal-btn-text');
  const actionBtn = $('#btn-action-confirm-modal');
  const iconEl = $('#confirm-modal-icon');
  const iconBox = $('#confirm-modal-icon-container');

  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;
  if (btnText) btnText.textContent = confirmText;

  if (bodyText && bodyEl) {
    bodyEl.textContent = bodyText;
    bodyEl.classList.remove('hidden-view');
  } else if (bodyEl) {
    bodyEl.classList.add('hidden-view');
  }

  if (actionBtn) {
    actionBtn.className = `px-4 py-2 ${confirmBgClass} text-white text-xs font-medium rounded-xl transition-colors shadow-xs cursor-pointer inline-flex items-center gap-1.5`;
  }

  if (iconEl) iconEl.textContent = icon;
  if (iconBox) {
    iconBox.className = `w-10 h-10 rounded-full ${iconBgClass} border flex items-center justify-center ${iconColorClass} shrink-0`;
  }

  AccessibleModalManager.open(modal);
}

function closeCustomConfirm() {
  onConfirmActionCallback = null;
  AccessibleModalManager.close($('#custom-confirm-modal'));
}

$('#btn-cancel-confirm-modal')?.addEventListener('click', closeCustomConfirm);
$('#custom-confirm-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'custom-confirm-modal') closeCustomConfirm();
});

$('#btn-action-confirm-modal')?.addEventListener('click', () => {
  if (typeof onConfirmActionCallback === 'function') {
    const fn = onConfirmActionCallback;
    closeCustomConfirm();
    fn();
  } else {
    closeCustomConfirm();
  }
});

$('#btn-copy-call-hash')?.addEventListener('click', () => {
  const hash = $('#conv-call-hash')?.textContent;
  if (hash) {
    navigator.clipboard.writeText(hash).then(() => {
      showToast('Call ID copied to clipboard', 'success');
    });
  }
});

/* ─── Booking & Contact Dossier Modal Logic ────────────────────────── */
let currentDossierData = null;

function openBookingDossierModal(vendorName) {
  if (!activeThread) return;
  const targetName = vendorName || selectedVendorName;
  if (!targetName) return;

  const r = activeThread.results[targetName];
  if (!r) return;

  const vendorObj = activeVendors.find(v => v.name === targetName);
  const unmaskedPhone = (vendorObj && vendorObj.phone) || r.phone || '+1 555 010 0100';
  const cleanDigits = unmaskedPhone.replace(/[^\d]/g, '');

  const price = formatDisplayPrice(r.quote || 'As discussed');
  const timeline = r.timeline || 'Within 2-3 Days';
  const terms = r.providerNotes || r.summary || 'Standard terms confirmed during phone negotiation.';
  const rawEvidence = r.evidence || r.summary || 'Verbatim quote confirmed during AI call.';
  const cleanEvidence = rawEvidence.replace(/^["'\s]+|["'\s]+$/g, '').replace(/";\s*"/g, ' • ').replace(/"/g, '');

  currentDossierData = {
    vendorName: targetName,
    phone: unmaskedPhone,
    price,
    timeline,
    terms,
    evidence: cleanEvidence,
    prompt: activeThread.prompt || ''
  };

  const nameEl = $('#dossier-vendor-name');
  const phoneEl = $('#dossier-unmasked-phone');
  const priceEl = $('#dossier-price');
  const timelineEl = $('#dossier-timeline');
  const termsEl = $('#dossier-terms');
  const evidenceEl = $('#dossier-evidence');
  const callLink = $('#dossier-call-link');
  const waLink = $('#dossier-whatsapp-link');

  if (nameEl) nameEl.textContent = targetName;
  if (phoneEl) phoneEl.textContent = unmaskedPhone;
  if (priceEl) priceEl.textContent = price;
  if (timelineEl) timelineEl.textContent = timeline;
  if (termsEl) termsEl.textContent = terms;
  if (evidenceEl) evidenceEl.textContent = `"${cleanEvidence}"`;

  if (callLink) {
    callLink.href = `tel:${unmaskedPhone}`;
  }

  if (waLink) {
    const waMsg = `Hello ${targetName},\n\n` +
      `I am following up on the QuoteHunter AI negotiation for: "${activeThread.prompt ? (activeThread.prompt.length > 80 ? activeThread.prompt.slice(0, 80) + '...' : activeThread.prompt) : 'services'}".\n\n` +
      `• Agreed Quote: ${price}\n` +
      `• Estimated Timeline: ${timeline}\n` +
      `• Terms: ${terms}\n\n` +
      `I would like to proceed with this booking. Please share the next steps and payment/address details.`;
    waLink.href = `https://wa.me/${cleanDigits}?text=${encodeURIComponent(waMsg)}`;
  }

  AccessibleModalManager.open($('#booking-dossier-modal'));
}

function closeBookingDossierModal() {
  currentDossierData = null;
  AccessibleModalManager.close($('#booking-dossier-modal'));
}

$('#btn-close-dossier')?.addEventListener('click', closeBookingDossierModal);
$('#btn-dossier-done')?.addEventListener('click', closeBookingDossierModal);
$('#booking-dossier-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'booking-dossier-modal') closeBookingDossierModal();
});

$('#btn-dossier-copy-phone')?.addEventListener('click', () => {
  if (currentDossierData?.phone) {
    navigator.clipboard.writeText(currentDossierData.phone).then(() => {
      showToast('Phone number copied to clipboard', 'success');
    });
  }
});

$('#btn-dossier-copy-all')?.addEventListener('click', () => {
  if (!currentDossierData) return;
  const sheet = `═══════════════════════════════════════\n` +
    `  QUOTEHUNTER — NEGOTIATION DEAL SHEET\n` +
    `═══════════════════════════════════════\n` +
    `Vendor: ${currentDossierData.vendorName}\n` +
    `Phone: ${currentDossierData.phone}\n` +
    `Agreed Price: ${currentDossierData.price}\n` +
    `Timeline: ${currentDossierData.timeline}\n` +
    `Agreed Terms: ${currentDossierData.terms}\n` +
    `Verbatim Quote: "${currentDossierData.evidence}"\n` +
    `Requirement: ${currentDossierData.prompt}\n` +
    `═══════════════════════════════════════`;
  navigator.clipboard.writeText(sheet).then(() => {
    showToast('Full Deal Sheet copied to clipboard', 'success');
  });
});

$('#btn-detail-confirm-booking')?.addEventListener('click', () => {
  if (!selectedVendorName || !activeThread) return;
  openBookingDossierModal(selectedVendorName);
});

let dispatchCountdownInterval = null;
let isDispatchPending = false;

// Clear prompt error styling on input
jobDesc?.addEventListener('input', () => {
  if (jobDesc.value.trim()) {
    jobDesc.classList.remove('border-rose-500', 'bg-rose-50/20');
  }
});

window.cancelPendingDispatch = function (e) {
  if (e) e.stopPropagation();
  executeStopSwarm();
};

function executeStopSwarm() {
  if (isDispatchPending) {
    if (dispatchCountdownInterval) {
      clearInterval(dispatchCountdownInterval);
      dispatchCountdownInterval = null;
    }
    isDispatchPending = false;
  }

  const targetJobId = activeThread?.jobId;
  if (targetJobId) {
    fetch(`/api/quotes/${targetJobId}/cancel`, { method: 'POST' }).catch(err => {
      console.warn('Cancel API request completed or failed:', err);
    });
  }

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  isRunning = false;
  if (launchBtn) launchBtn.disabled = false;
  if (activeThread) activeThread.isLive = false;
  stopWorkingTimer();

  // Mark in-flight vendors as canceled
  if (activeThread && activeThread.results) {
    Object.keys(activeThread.results).forEach(k => {
      const r = activeThread.results[k];
      if (['initializing', 'dialing', 'ringing', 'in-call', 'in-progress', 'analyzing'].includes(r.status)) {
        r.status = 'failed';
        r.summary = 'Call was stopped by user before conversation.';
      }
    });
  }

  const statusBadge = $('#thread-status-badge');
  if (statusBadge) {
    statusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-medium';
    statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span><span>Canceled</span>';
  }

  const botContainer = $('#thread-bot-status-container');
  if (botContainer) botContainer.classList.add('hidden-view');

  saveThreadsToStorage();
  renderRecentsList();
  if (activeThread) renderThreadSwarm(activeThread.results);
  showToast('Call swarm stopped', 'info');
}

/* ─── Pre-Call Verification Modal Logic ────────────────────────────── */
let onPreCallConfirmCallback = null;

function openVerifyCallModal(promptText, onConfirm) {
  const modal = $('#verify-call-modal');
  if (!modal) return;

  onPreCallConfirmCallback = onConfirm;

  const phonesContainer = $('#verify-call-phones-preview');
  const promptPreview = $('#verify-call-prompt-preview');

  if (phonesContainer) {
    phonesContainer.innerHTML = activeVendors.map(v => `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-mono font-medium text-gray-800 shadow-2xs">
        <span class="material-symbols-outlined text-[13px] text-teal-600">call</span>
        <span>${escapeHtml(v.phone || v.name)}</span>
      </span>
    `).join('');
  }

  if (promptPreview) {
    promptPreview.textContent = promptText;
  }

  AccessibleModalManager.open(modal);
}

function closeVerifyCallModal() {
  onPreCallConfirmCallback = null;
  AccessibleModalManager.close($('#verify-call-modal'));
}

$('#btn-cancel-verify-call')?.addEventListener('click', closeVerifyCallModal);
$('#verify-call-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'verify-call-modal') closeVerifyCallModal();
});

$('#btn-confirm-verify-call')?.addEventListener('click', () => {
  if (typeof onPreCallConfirmCallback === 'function') {
    const fn = onPreCallConfirmCallback;
    closeVerifyCallModal();
    fn();
  } else {
    closeVerifyCallModal();
  }
});

/* ─── Campaign Launch Execution ─────────────────────────────────────── */
async function executeLaunchCampaign(promptText) {
  const initResults = {};
  activeVendors.forEach(v => {
    initResults[v.name] = {
      status: 'initializing',
      quote: null,
      timeline: null,
      summary: null,
      evidence: null
    };
  });

  // Create new thread item in Recents with complete title
  const newThread = {
    id: 'thread-' + Date.now(),
    title: promptText,
    prompt: promptText,
    isLive: true,
    results: initResults,
    createdAt: new Date().toISOString(),
  };

  recentThreads.unshift(newThread);
  saveThreadsToStorage();
  isRunning = true;
  if (launchBtn) launchBtn.disabled = true;

  // Switch to Recent Thread view immediately
  switchView('thread', newThread);

  // ── Option 1: 3-Second Circular Countdown Ring before Cellular Carrier Dial ──
  let countdownSec = 3;
  isDispatchPending = true;

  const updateCountdownPill = () => {
    const workingPill = $('#thread-working-pill');
    if (workingPill) {
      const strokeOffset = Math.round(((3 - countdownSec) / 3) * 100);
      workingPill.innerHTML = `
        <div class="relative w-5 h-5 flex items-center justify-center shrink-0">
          <svg class="w-full h-full -rotate-90 transform" viewBox="0 0 36 36">
            <path
              class="text-gray-200"
              stroke-width="4"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              class="text-amber-500 transition-all duration-1000 ease-linear"
              stroke-dasharray="100, 100"
              stroke-dashoffset="${strokeOffset}"
              stroke-linecap="round"
              stroke-width="4"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <span class="absolute text-[10px] font-bold text-gray-800 font-mono">${countdownSec}</span>
        </div>
        <span class="text-xs text-gray-700 font-medium font-sans">Connecting in ${countdownSec}s...</span>
        <button type="button" onclick="cancelPendingDispatch(event)" class="ml-1 px-2 py-0.5 rounded-full bg-gray-100 hover:bg-rose-50 text-gray-600 hover:text-rose-600 border border-gray-200 text-[11px] font-medium transition-colors cursor-pointer inline-flex items-center gap-0.5">
          <span class="material-symbols-outlined text-[13px]">close</span>
          <span>Cancel</span>
        </button>
      `;
    }
  };
  updateCountdownPill();

  try {
    await new Promise((resolve, reject) => {
      dispatchCountdownInterval = setInterval(() => {
        if (!isDispatchPending) {
          clearInterval(dispatchCountdownInterval);
          dispatchCountdownInterval = null;
          reject(new Error('Canceled before dialing'));
          return;
        }
        countdownSec--;
        if (countdownSec > 0) {
          updateCountdownPill();
        } else {
          clearInterval(dispatchCountdownInterval);
          dispatchCountdownInterval = null;
          isDispatchPending = false;
          resolve(true);
        }
      }, 1000);
    });

    // Start live working timer once countdown completes and network dispatch starts
    startWorkingTimer();

    const res = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: currentCategory,
        description: promptText,
        vendors: activeVendors,
        mode: 'live',
      }),
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to dispatch call swarm');
    }

    const jobId = data.job ? data.job.id : data.jobId;
    newThread.jobId = jobId;
    if (activeThread && activeThread.id === newThread.id) {
      activeThread.jobId = jobId;
    }
    saveThreadsToStorage();

    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/events/${jobId}`);

    eventSource.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data);
        handleEvent(ev, newThread);
      } catch (err) {
        console.error('Error parsing SSE event:', err);
      }
    };

    eventSource.onerror = (err) => {
      // Do not kill the job on transient SSE network errors; let browser auto-retry or fallback polling take over
      console.warn('⚠️ SSE EventSource transient hiccup, relying on auto-reconnect & backup poll...', err);
    };

    // Backup polling loop every 3 seconds to guarantee updates never stall even if SSE drops
    const backupPollInterval = setInterval(async () => {
      if (!isRunning) {
        clearInterval(backupPollInterval);
        return;
      }
      try {
        const checkRes = await fetch(`/api/quotes`);
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          const currentJob = checkData.jobs?.find(j => j.id === jobId);
          if (currentJob) {
            handleEvent({ type: 'initial', job: currentJob }, newThread);
            if (currentJob.status === 'completed' || currentJob.status === 'failed') {
              clearInterval(backupPollInterval);
              if (eventSource) eventSource.close();
            }
          }
        }
      } catch (_) { }
    }, 3000);
  } catch (err) {
    if (err.message === 'Canceled before dialing') {
      console.log('🛑 Dispatched call aborted during 3-second buffer.');
      return;
    }
    console.error('Hunt launch failed:', err);
    showToast('Hunt launch failed: ' + (err.message || 'Check network connection'), 'error');
    isRunning = false;
    if (launchBtn) launchBtn.disabled = false;
    newThread.isLive = false;
    saveThreadsToStorage();
    renderRecentsList();
  }
}

/* ─── Campaign Launch Handler (Make Call Button) ──────────────────────── */
$('#hunt-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isRunning) return;

  const promptText = (jobDesc?.value.trim()) || '';

  // Option A: Require prompt description if empty
  if (!promptText) {
    if (jobDesc) {
      jobDesc.classList.add('border-rose-500', 'bg-rose-50/20');
      jobDesc.focus();
    }
    showToast('Please describe what you want QuoteHunter to ask before calling.', 'info');
    return;
  }

  // If no vendors added yet, try auto-extracting from prompt text (e.g. +15550100100)
  if (activeVendors.length === 0) {
    const phoneMatches = promptText.match(/\+?\d{10,15}/g);
    if (phoneMatches && phoneMatches.length > 0) {
      phoneMatches.forEach(p => {
        const formatted = p.startsWith('+') ? p : '+' + p;
        if (!activeVendors.some(v => v.phone === formatted)) {
          activeVendors.push({ name: maskPhoneNumber(formatted), phone: formatted });
        }
      });
      renderPhoneChips();
    }
  }

  if (activeVendors.length === 0) {
    openAddVendorModal();
    return;
  }

  // All validations passed -> Open Pre-Call Verification Modal
  openVerifyCallModal(promptText, () => {
    executeLaunchCampaign(promptText);
  });
});

/* ─── SSE Event Handler ─────────────────────────────────────────────── */
function handleEvent(ev, thread) {
  if (!ev || !thread) return;

  if (ev.type === 'initial' && ev.job && Array.isArray(ev.job.vendors)) {
    ev.job.vendors.forEach(v => {
      if (v && v.name) {
        thread.results[v.name] = {
          status: v.status,
          quote: v.priceEstimate || thread.results[v.name]?.quote,
          timeline: v.availability || thread.results[v.name]?.timeline,
          summary: v.transcriptSummary || v.providerNotes || thread.results[v.name]?.summary,
          evidence: v.evidenceSnippet || thread.results[v.name]?.evidence,
          turns: v.turns || thread.results[v.name]?.turns,
          durationFormatted: v.durationFormatted || thread.results[v.name]?.durationFormatted,
          durationSeconds: v.durationSeconds || thread.results[v.name]?.durationSeconds,
          callHash: v.callHash || thread.results[v.name]?.callHash,
          audioUrl: v.audioUrl || thread.results[v.name]?.audioUrl,
          phone: v.phone || thread.results[v.name]?.phone,
          createdAt: v.createdAt || thread.results[v.name]?.createdAt || thread.createdAt || new Date().toISOString(),
          completedAt: v.completedAt || thread.results[v.name]?.completedAt || new Date().toISOString(),
        };
      }
    });

    if (ev.job.status === 'completed' || ev.job.status === 'failed') {
      if (eventSource) eventSource.close();
      isRunning = false;
      if (launchBtn) launchBtn.disabled = false;
      thread.isLive = false;

      const statusBadge = $('#thread-status-badge');
      if (statusBadge) {
        statusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200 text-[11px] font-medium';
        statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span><span>Completed</span>';
      }
    }

    saveThreadsToStorage();
    if (activeThread && activeThread.id === thread.id) {
      renderThreadSwarm(thread.results);
    }
    renderRecentsList();
    return;
  }

  if (ev.type === 'vendor_updated' && ev.vendor) {
    const v = ev.vendor;
    const vendorName = v.name;
    if (vendorName) {
      thread.results[vendorName] = {
        status: v.status,
        quote: v.priceEstimate || thread.results[vendorName]?.quote,
        timeline: v.availability || thread.results[vendorName]?.timeline,
        summary: v.transcriptSummary || v.providerNotes || thread.results[vendorName]?.summary,
        evidence: v.evidenceSnippet || thread.results[vendorName]?.evidence,
        turns: v.turns || thread.results[vendorName]?.turns,
        durationFormatted: v.durationFormatted || thread.results[vendorName]?.durationFormatted,
        durationSeconds: v.durationSeconds || thread.results[vendorName]?.durationSeconds,
        callHash: v.callHash || thread.results[vendorName]?.callHash,
        audioUrl: v.audioUrl || thread.results[vendorName]?.audioUrl,
        phone: v.phone || thread.results[vendorName]?.phone,
        createdAt: v.createdAt || thread.results[vendorName]?.createdAt || thread.createdAt || new Date().toISOString(),
        completedAt: v.completedAt || thread.results[vendorName]?.completedAt || new Date().toISOString(),
      };

      saveThreadsToStorage();

      if (activeThread && activeThread.id === thread.id) {
        renderThreadSwarm(thread.results);
      }
    }
  } else if (ev.type === 'status_updated') {
    if (ev.status === 'completed' || ev.status === 'failed') {
      if (eventSource) eventSource.close();
      isRunning = false;
      if (launchBtn) launchBtn.disabled = false;
      thread.isLive = false;
      saveThreadsToStorage();
      renderRecentsList();

      const statusBadge = $('#thread-status-badge');
      if (statusBadge) {
        statusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200 text-[11px] font-medium';
        statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span><span>Completed</span>';
      }
    }
    saveThreadsToStorage();
    if (activeThread && activeThread.id === thread.id) {
      renderThreadSwarm(thread.results);
    }
  }
}

/* ─── Server Job Synchronization on Startup ─────────────────────────── */
async function syncServerJobs() {
  try {
    const res = await fetch('/api/hunt');
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && Array.isArray(data.jobs)) {
      data.jobs.forEach(job => {
        let existing = recentThreads.find(t => t.jobId === job.id || t.id === job.id);
        const results = {};
        job.vendors.forEach(v => {
          results[v.name] = {
            status: v.status,
            quote: v.priceEstimate,
            timeline: v.availability,
            summary: v.transcriptSummary || v.providerNotes,
            evidence: v.evidenceSnippet,
            turns: v.turns,
            durationFormatted: v.durationFormatted,
            durationSeconds: v.durationSeconds,
            callHash: v.callHash,
            audioUrl: v.audioUrl,
            phone: v.phone,
            createdAt: v.createdAt || job.createdAt,
            completedAt: v.completedAt || job.updatedAt,
          };
        });

        if (!existing) {
          const newT = {
            id: job.id,
            jobId: job.id,
            title: job.description || job.title,
            prompt: job.description,
            isLive: job.status === 'active' || job.status === 'initializing',
            results,
            createdAt: job.createdAt,
          };
          recentThreads.push(newT);
        } else {
          Object.assign(existing.results, results);
          if (job.status === 'completed' || job.status === 'failed') {
            existing.isLive = false;
          }
        }
      });

      saveThreadsToStorage();
      renderRecentsList();
      if (activeThread) {
        const updated = recentThreads.find(t => t.id === activeThread.id || t.jobId === activeThread.jobId);
        if (updated) {
          activeThread = updated;
          renderThreadSwarm(activeThread.results);
        }
      }
    }
  } catch (_) { }
}

/* ─── Server Wake & Status Loading Orchestrator ─────────────────────── */
let isServerLoading = true;

async function checkServerStatusAndWake() {
  const splash = document.getElementById('render-splash-screen');
  if (!splash) {
    isServerLoading = false;
    return;
  }

  isServerLoading = true;
  const statusText = document.getElementById('splash-status-text');
  const timerText = document.getElementById('splash-timer-text');
  const timerEl = document.getElementById('splash-timer');
  const progressBar = document.getElementById('splash-progress');
  const wakeHint = document.getElementById('splash-wake-hint');

  const startTime = Date.now();
  let elapsedSec = 0;

  // Real-time stopwatch for Render cold-starts
  const timerInterval = setInterval(() => {
    if (!isServerLoading) {
      clearInterval(timerInterval);
      return;
    }
    elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    if (timerEl) timerEl.textContent = `${elapsedSec}s`;

    if (elapsedSec >= 4 && statusText) {
      statusText.textContent = 'Waking Render web service...';
    }
    if (elapsedSec >= 15 && statusText) {
      statusText.textContent = 'Container starting & initializing voice swarm...';
    }
  }, 1000);

  // Called immediately when /api/status responds successfully
  function onStatusReceived(data) {
    if (!isServerLoading) return;
    isServerLoading = false;
    clearInterval(timerInterval);

    if (statusText) {
      statusText.textContent = 'Connected! Ready.';
      statusText.className = 'text-xs font-semibold text-emerald-600 text-center transition-all';
    }
    if (progressBar) {
      progressBar.classList.remove('w-1/3', 'animate-pulse');
      progressBar.className = 'h-full bg-emerald-600 rounded-full w-full transition-all duration-300';
    }
    if (wakeHint) {
      wakeHint.style.opacity = '0';
    }

    // Dismiss splash screen cleanly
    const exitDelay = elapsedSec === 0 ? 250 : 150;
    setTimeout(() => {
      splash.classList.add('opacity-0', 'pointer-events-none');
      setTimeout(() => {
        splash.remove();
      }, 400);
    }, exitDelay);
  }

  // Hit the status API
  async function hitStatusApi() {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'online') {
          onStatusReceived(data);
          return true;
        }
      }
    } catch (_) {
      // Server is asleep on Render or booting up
    }
    return false;
  }

  // Initial status check
  const isOnline = await hitStatusApi();
  if (isOnline) return;

  // Poll until container awakens and status is received
  const pollTimer = setInterval(async () => {
    if (!isServerLoading) {
      clearInterval(pollTimer);
      return;
    }
    const ok = await hitStatusApi();
    if (ok) {
      clearInterval(pollTimer);
    }
  }, 1500);

  // ─── Render 15-Minute Inactivity Sleep Prevention ─────────────────
  // Keeps the container awake while the user has QuoteHunter open
  setInterval(() => {
    fetch('/api/status', { cache: 'no-store' }).catch(() => {});
  }, 9 * 60 * 1000);

  // Instant re-wake if user switches back to this tab after being away
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      fetch('/api/status', { cache: 'no-store' }).catch(() => {});
    }
  });
}

/* ─── Startup ───────────────────────────────────────────────────────── */
checkServerStatusAndWake();
loadThreadsFromStorage();
renderPhoneChips();
renderRecentsList();
syncServerJobs();

const savedView = localStorage.getItem(STORAGE_KEY_VIEW);
const savedThreadId = localStorage.getItem(STORAGE_KEY_ACTIVE_ID);

if (savedView === 'thread' && savedThreadId) {
  const foundThread = recentThreads.find(t => t.id === savedThreadId);
  if (foundThread) {
    switchView('thread', foundThread);
  } else if (recentThreads.length > 0) {
    switchView('thread', recentThreads[0]);
  } else {
    switchView('home');
  }
} else {
  switchView('home');
}
