// ========== CONFIG ==========
const API_BASE = '/api';

// ========== DOM REFS ==========
const planForm = document.getElementById('plan-form');
const savedPlansList = document.getElementById('saved-plans');
const historyList = document.getElementById('call-history');
const clearHistoryBtn = document.getElementById('clear-history-btn');

// ========== UTILITY ==========
function showSection(sectionId) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(sectionId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const tabBtn = document.querySelector(`.tab-btn[data-section="${sectionId}"]`);
  if (tabBtn) tabBtn.classList.add('active');
}

// ========== PLANS ==========
async function loadPlans() {
  try {
    const res = await fetch(`${API_BASE}/plans`);
    if (!res.ok) throw new Error('Failed to load plans');
    const plans = await res.json();
    savedPlansList.innerHTML = '';
    if (plans.length === 0) {
      savedPlansList.innerHTML = '<li style="color:#5a6a7a;">No saved plans yet.</li>';
      return;
    }
    plans.forEach(p => {
      const li = document.createElement('li');
      li.dataset.id = p.id;
      li.dataset.phone = p.phone;
      li.dataset.task = p.task;
      li.innerHTML = `
        <div class="plan-display">
          <span class="plan-info">${p.name} <small style="color:#5a6a7a;">${p.phone}</small></span>
          <span class="plan-actions">
            <button class="edit-plan-btn" data-id="${p.id}">✏️ Edit</button>
            <button class="call-plan-btn" data-phone="${p.phone}" data-task="${p.task}">▶ Call</button>
          </span>
        </div>
        <div class="plan-edit-form" style="display:none; margin-top:12px; width:100%;">
          <input type="text" class="edit-name" value="${p.name.replace(/"/g, '&quot;')}" placeholder="Plan name" />
          <input type="tel" class="edit-phone" value="${p.phone}" placeholder="Phone number" />
          <textarea class="edit-task" rows="2" placeholder="Task">${p.task.replace(/"/g, '&quot;')}</textarea>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button class="save-edit-btn btn-primary" data-id="${p.id}" style="padding:6px 16px; font-size:13px;">💾 Save</button>
            <button class="cancel-edit-btn btn-secondary" style="padding:6px 16px; font-size:13px;">Cancel</button>
          </div>
        </div>
      `;
      savedPlansList.appendChild(li);
    });
  } catch (err) {
    console.error(err);
  }
}

async function createPlan(name, phone, task) {
  try {
    const res = await fetch(`${API_BASE}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, task }),
    });
    if (!res.ok) throw new Error('Failed to save plan');
    await loadPlans();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function updatePlan(id, name, phone, task) {
  try {
    const res = await fetch(`${API_BASE}/plans/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, task }),
    });
    if (!res.ok) throw new Error('Failed to update plan');
    await loadPlans();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ========== CALLS ==========
async function makeCall(phone, task, planId = null, btnElement = null) {
  let originalText = '';
  if (btnElement) {
    btnElement.disabled = true;
    originalText = btnElement.innerHTML;
    btnElement.innerHTML = '⏳ Processing...';
  }

  try {
    const res = await fetch(`${API_BASE}/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, task, planId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Call failed');
    alert(`✅ Call started successfully! ID: ${data.call.id}`);
    await loadHistory();
    await loadPlans();
  } catch (err) {
    alert('❌ ' + err.message);
  } finally {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.innerHTML = originalText || '▶ Call';
    }
  }
}

// ========== HISTORY (com resumo, transcrição e debug) ==========
async function loadHistory() {
  try {
    const res = await fetch(`${API_BASE}/calls/history`);
    if (!res.ok) throw new Error('Failed to load history');
    const calls = await res.json();
    historyList.innerHTML = '';
    if (calls.length === 0) {
      historyList.innerHTML = '<li style="color:#5a6a7a;">No calls yet.</li>';
      return;
    }
    calls.forEach(c => {
      const li = document.createElement('li');
      const statusClass = c.status === 'completed' ? 'completed' : c.status === 'failed' ? 'failed' : '';
      const time = new Date(c.created_at).toLocaleString('en-US');

      // ===== EXTRAÇÃO ROBUSTA =====
      let summary = 'No summary available.';
      let transcript = '';
      let fullRaw = '';

      if (c.result && typeof c.result === 'object') {
        fullRaw = JSON.stringify(c.result, null, 2);

        // Tentar summary em vários locais
        if (c.result.summary) summary = c.result.summary;
        else if (c.result.recipients && c.result.recipients[0]?.summary) {
          summary = c.result.recipients[0].summary;
        }
        else if (c.result.attempts && c.result.attempts[0]?.summary) {
          summary = c.result.attempts[0].summary;
        }

        // Tentar transcript em vários locais
        if (c.result.transcriptTurns && Array.isArray(c.result.transcriptTurns)) {
          transcript = c.result.transcriptTurns
            .map(t => `${t.speaker === 'bot' ? '🤖' : '👤'} ${t.text}`)
            .join(' ');
        }
        else if (c.result.recipients && c.result.recipients[0]?.transcriptTurns) {
          transcript = c.result.recipients[0].transcriptTurns
            .map(t => `${t.speaker === 'bot' ? '🤖' : '👤'} ${t.text}`)
            .join(' ');
        }
        else if (c.result.attempts && c.result.attempts[0]?.transcriptTurns) {
          transcript = c.result.attempts[0].transcriptTurns
            .map(t => `${t.speaker === 'bot' ? '🤖' : '👤'} ${t.text}`)
            .join(' ');
        }
        else if (c.result.transcript) {
          transcript = c.result.transcript;
        }
      }

      li.innerHTML = `
        <div class="history-item">
          <div>
            <span class="h-phone">${c.phone}</span>
            <span class="h-status ${statusClass}">${c.status || '—'}</span>
          </div>
          <div style="font-size:13px;color:#8899b0;margin-top:4px;">
            <strong>Task:</strong> ${c.task}
          </div>
          <div style="font-size:13px;color:#b0c0d0;margin-top:6px;background:#0f1620;padding:10px;border-radius:8px;border-left:3px solid #00b4ff;">
            <strong>📝 Summary:</strong> ${summary}
          </div>
          ${transcript ? `
            <div style="font-size:12px;color:#6a7a8a;margin-top:4px;background:#0a1018;padding:8px;border-radius:6px;max-height:120px;overflow-y:auto;border:1px solid #1f2e3e;">
              <strong>💬 Transcript:</strong><br />
              ${transcript}
            </div>
          ` : `
            <div style="font-size:12px;color:#5a6a7a;margin-top:4px;font-style:italic;">
              No transcript available for this call.
            </div>
          `}
          <details style="margin-top:8px;font-size:11px;color:#4a5a6a;">
            <summary>🔍 Raw data (debug)</summary>
            <pre style="background:#0a1018;padding:8px;border-radius:6px;overflow-x:auto;white-space:pre-wrap;max-height:150px;">${fullRaw}</pre>
          </details>
          <div class="h-time">${time}</div>
        </div>
      `;
      historyList.appendChild(li);
    });
  } catch (err) {
    console.error(err);
  }
}

// ========== CLEAR HISTORY ==========
async function clearHistory() {
  if (!confirm('Delete all call history?')) return;
  try {
    const res = await fetch(`${API_BASE}/calls/history`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to clear history');
    await loadHistory();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ========== BLOQUEAR CLIQUE DIREITO EM IMAGENS ==========
document.addEventListener('contextmenu', function(e) {
  if (e.target.tagName === 'IMG') {
    e.preventDefault();
    return false;
  }
});

// ========== EVENT LISTENERS ==========
// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    showSection(btn.dataset.section);
  });
});

// Create plan
planForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('plan-name').value.trim();
  const phone = document.getElementById('plan-phone').value.trim();
  const task = document.getElementById('plan-task').value.trim();
  if (!name || !phone || !task) return alert('Please fill all fields.');
  await createPlan(name, phone, task);
  planForm.reset();
});

// ========== DELEGAÇÃO DE EVENTOS PARA PLANOS ==========
savedPlansList.addEventListener('click', async (e) => {
  // Botão "Call"
  const callBtn = e.target.closest('.call-plan-btn');
  if (callBtn) {
    const phone = callBtn.dataset.phone;
    const task = callBtn.dataset.task;
    const planId = callBtn.closest('li')?.dataset.id;
    await makeCall(phone, task, planId, callBtn);
    return;
  }

  // Botão "Edit" – mostrar formulário
  const editBtn = e.target.closest('.edit-plan-btn');
  if (editBtn) {
    const li = editBtn.closest('li');
    const display = li.querySelector('.plan-display');
    const form = li.querySelector('.plan-edit-form');
    display.style.display = 'none';
    form.style.display = 'block';
    return;
  }

  // Botão "Save" – guardar edição
  const saveBtn = e.target.closest('.save-edit-btn');
  if (saveBtn) {
    const li = saveBtn.closest('li');
    const id = saveBtn.dataset.id;
    const name = li.querySelector('.edit-name').value.trim();
    const phone = li.querySelector('.edit-phone').value.trim();
    const task = li.querySelector('.edit-task').value.trim();
    if (!name || !phone || !task) {
      alert('Please fill all fields.');
      return;
    }
    await updatePlan(id, name, phone, task);
    return;
  }

  // Botão "Cancel" – esconder formulário
  const cancelBtn = e.target.closest('.cancel-edit-btn');
  if (cancelBtn) {
    const li = cancelBtn.closest('li');
    const display = li.querySelector('.plan-display');
    const form = li.querySelector('.plan-edit-form');
    display.style.display = 'flex';
    form.style.display = 'none';
  }
});

// Clear history
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener('click', clearHistory);
}

// ========== INIT ==========
loadPlans();
loadHistory();
console.log('🧠 call-e-brain loaded (no auth)');
