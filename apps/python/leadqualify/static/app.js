// --- Application State Management ---
let leads = [];
let filteredLeads = [];
let selectedLeadId = null;
let pollInterval = null;
let selectedLeadFastPollInterval = null;
let currentFilter = 'all';
let searchQuery = '';

// --- DOM Elements ---
const leadsTableBody = document.getElementById('leadsTableBody');
const panelPlaceholder = document.getElementById('panelPlaceholder');
const panelContent = document.getElementById('panelContent');
const simulateModal = document.getElementById('simulateModal');
const callNotification = document.getElementById('callNotification');
const modeBadge = document.getElementById('modeBadge');
const searchInput = document.getElementById('searchInput');
const audioVisualizerWidget = document.getElementById('audioVisualizerWidget');
const visualizerStatusText = document.getElementById('visualizerStatusText');
const toastNotification = document.getElementById('toastNotification');
const toastMessage = document.getElementById('toastMessage');

// Metrics Elements
const totalLeadsCount = document.getElementById('totalLeadsCount');
const qualifiedLeadsCount = document.getElementById('qualifiedLeadsCount');
const activeCallsCount = document.getElementById('activeCallsCount');
const conversionRate = document.getElementById('conversionRate');
const leadsQueueCount = document.getElementById('leadsQueueCount');

// Lead Detail Elements
const detailLeadName = document.getElementById('detailLeadName');
const detailLeadCompany = document.getElementById('detailLeadCompany');
const detailHandoffBadge = document.getElementById('detailHandoffBadge');
const detailBudget = document.getElementById('detailBudget');
const detailTimeline = document.getElementById('detailTimeline');
const detailInterest = document.getElementById('detailInterest');
const detailStatus = document.getElementById('detailStatus');
const detailNotes = document.getElementById('detailNotes');
const detailPainPoint = document.getElementById('detailPainPoint');
const detailTranscript = document.getElementById('detailTranscript');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    fetchLeads();
    // Poll queue every 4 seconds
    pollInterval = setInterval(fetchLeads, 4000);
});

// --- API Interactions ---

function startFastPollingForSelectedLead() {
    if (selectedLeadFastPollInterval) clearInterval(selectedLeadFastPollInterval);
    selectedLeadFastPollInterval = setInterval(async () => {
        if (!selectedLeadId) return;
        const currentLead = leads.find(l => l.id === selectedLeadId);
        if (currentLead && ['pending', 'calling', 'connected'].includes(currentLead.status)) {
            try {
                const res = await fetch(`/api/leads/${selectedLeadId}`);
                if (res.ok) {
                    const updated = await res.json();
                    const idx = leads.findIndex(l => l.id === selectedLeadId);
                    if (idx !== -1) {
                        leads[idx] = updated;
                    }
                    applyFiltersAndRender();
                    renderLeadDetails(updated);
                    updateMetrics();
                }
            } catch (err) {
                console.error('Fast polling error:', err);
            }
        } else {
            clearInterval(selectedLeadFastPollInterval);
            selectedLeadFastPollInterval = null;
        }
    }, 1000);
}

async function fetchLeads() {
    try {
        const response = await fetch('/api/leads');
        if (!response.ok) throw new Error('Failed to fetch leads');
        leads = await response.json();
        
        updateMetrics();
        applyFiltersAndRender();
        detectExecutionMode();
        
        // If a lead is currently selected, update its view
        if (selectedLeadId) {
            const currentLead = leads.find(l => l.id === selectedLeadId);
            if (currentLead) {
                renderLeadDetails(currentLead);
                if (['pending', 'calling', 'connected'].includes(currentLead.status)) {
                    startFastPollingForSelectedLead();
                }
            }
        }
        
        // Update active dialing notification overlay
        const dialingLead = leads.find(l => l.status === 'calling');
        if (dialingLead) {
            document.getElementById('notificationDetails').innerText = `Calling ${dialingLead.name} (${dialingLead.phone})`;
            callNotification.classList.remove('hidden');
        } else {
            callNotification.classList.add('hidden');
        }
        
    } catch (err) {
        console.error('Error fetching leads:', err);
    }
}

async function submitLead(event) {
    event.preventDefault();
    
    const name = document.getElementById('leadName').value;
    const phone = document.getElementById('leadPhone').value;
    const company = document.getElementById('leadCompany').value;
    const product_interest = document.getElementById('leadProduct').value;
    
    const submitBtn = event.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Initiating...';

    try {
        const response = await fetch('/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, company, product_interest })
        });
        
        if (!response.ok) throw new Error('Submission failed');
        
        const newLead = await response.json();
        closeSimulateModal();
        document.getElementById('leadForm').reset();
        showToast(`Dispatched voice agent call to ${name}`);
        
        // Instantly switch panel details to the new lead
        selectedLeadId = newLead.id;
        
        await fetchLeads();
        startFastPollingForSelectedLead();
        
    } catch (err) {
        showToast('Failed to submit lead. Check phone format (+E.164).');
        console.error(err);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-headset me-1"></i> Initiate Agent Call';
    }
}

async function deleteLead(id) {
    if (!confirm('Are you sure you want to delete this lead?')) {
        return;
    }
    try {
        const response = await fetch(`/api/leads/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete lead');
        
        showToast('Lead deleted successfully');
        if (selectedLeadId === id) {
            selectedLeadId = null;
            panelPlaceholder.classList.remove('hidden');
            panelContent.classList.add('hidden');
        }
        
        await fetchLeads();
    } catch (err) {
        showToast('Failed to delete lead.');
        console.error(err);
    }
}

async function redialLead(id) {
    if (!id) return;
    try {
        showToast('Redialing outbound voice agent...');
        const response = await fetch(`/api/leads/${id}/redial`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Redial failed');
        
        const updatedLead = await response.json();
        selectedLeadId = updatedLead.id;
        
        showToast(`Redial dispatched to ${updatedLead.name}!`);
        await fetchLeads();
        startFastPollingForSelectedLead();
    } catch (err) {
        showToast('Failed to redial lead.');
        console.error(err);
    }
}

function redialCurrentLead() {
    if (!selectedLeadId) {
        showToast('Select a lead first to redial!');
        return;
    }
    redialLead(selectedLeadId);
}

async function clearAllLeads() {
    if (leads.length === 0) {
        showToast('Lead queue is already empty!');
        return;
    }
    if (!confirm('Are you sure you want to clear ALL leads from the queue?')) {
        return;
    }
    try {
        const response = await fetch('/api/leads', {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to clear queue');
        
        const result = await response.json();
        showToast(`Cleared ${result.count || 0} leads from queue`);
        
        selectedLeadId = null;
        panelPlaceholder.classList.remove('hidden');
        panelContent.classList.add('hidden');
        
        await fetchLeads();
    } catch (err) {
        showToast('Failed to clear lead queue.');
        console.error(err);
    }
}

// --- Search & Filter Logic ---

function setFilter(filterName) {
    currentFilter = filterName;
    document.querySelectorAll('.filter-tab').forEach(btn => {
        if (btn.getAttribute('data-filter') === filterName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    applyFiltersAndRender();
}

function filterLeads() {
    searchQuery = (searchInput.value || '').toLowerCase().trim();
    applyFiltersAndRender();
}

function applyFiltersAndRender() {
    filteredLeads = leads.filter(lead => {
        // Status filter
        if (currentFilter === 'qualified' && !lead.handoff_recommended) return false;
        if (currentFilter === 'active' && !['calling', 'connected'].includes(lead.status)) return false;
        if (currentFilter === 'completed' && lead.status !== 'completed') return false;
        
        // Search query filter
        if (searchQuery) {
            const nameMatch = (lead.name || '').toLowerCase().includes(searchQuery);
            const companyMatch = (lead.company || '').toLowerCase().includes(searchQuery);
            const phoneMatch = (lead.phone || '').toLowerCase().includes(searchQuery);
            const productMatch = (lead.product_interest || '').toLowerCase().includes(searchQuery);
            return nameMatch || companyMatch || phoneMatch || productMatch;
        }
        
        return true;
    });

    renderLeadsTable();
}

// --- UI Rendering ---

function updateMetrics() {
    const total = leads.length;
    const qualified = leads.filter(l => l.handoff_recommended).length;
    const calling = leads.filter(l => ['calling', 'connected'].includes(l.status)).length;
    const rate = total > 0 ? Math.round((qualified / total) * 100) : 0;
    
    totalLeadsCount.innerText = total;
    qualifiedLeadsCount.innerText = qualified;
    activeCallsCount.innerText = calling;
    conversionRate.innerText = `${rate}%`;
    leadsQueueCount.innerText = `${filteredLeads.length} / ${total} Leads`;
}

function renderLeadsTable() {
    if (filteredLeads.length === 0) {
        leadsTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-5 text-muted" style="text-align: center; padding: 3rem;">
                    <i class="fa-solid fa-folder-open mb-2" style="font-size: 2.2rem; display: block; opacity: 0.4;"></i>
                    No leads matching criteria. Try clearing search or dispatch a new call!
                </td>
            </tr>
        `;
        return;
    }
    
    leadsTableBody.innerHTML = filteredLeads.map(lead => {
        const statusClass = `status-${lead.status}`;
        const bantClass = lead.handoff_recommended ? 'bant-handoff' : 'bant-nothandoff';
        const bantText = lead.handoff_recommended ? 'Qualified' : 'Standard';
        const activeRowClass = lead.id === selectedLeadId ? 'active-row' : '';
        
        return `
            <tr class="${activeRowClass}" onclick="selectLead(${lead.id})">
                <td>
                    <div class="lead-name-cell">
                        <span class="name">${escapeHtml(lead.name)}</span>
                        <span class="company">${escapeHtml(lead.company || 'Individual Prospect')}</span>
                    </div>
                </td>
                <td class="phone-cell">${escapeHtml(lead.phone)}</td>
                <td><span class="badge" style="font-size: 0.72rem;">${escapeHtml(lead.product_interest || 'General')}</span></td>
                <td><span class="status-pill ${statusClass}">${lead.status.replace('_', ' ')}</span></td>
                <td><span class="bant-badge ${bantClass}">${bantText}</span></td>
                <td onclick="event.stopPropagation()">
                    <div style="display: flex; gap: 0.4rem;">
                        <button class="btn btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;" onclick="selectLead(${lead.id})" title="View Details">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        <button class="btn btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; border-color: rgba(6, 182, 212, 0.4); color: var(--cyan); background: rgba(6, 182, 212, 0.08);" onclick="redialLead(${lead.id})" title="Redial Call">
                            <i class="fa-solid fa-phone-flip"></i>
                        </button>
                        <button class="btn btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; border-color: rgba(239, 68, 68, 0.4); color: var(--danger); background: rgba(239, 68, 68, 0.08);" onclick="deleteLead(${lead.id})" title="Delete Lead">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderLeadDetails(lead) {
    panelPlaceholder.classList.add('hidden');
    panelContent.classList.remove('hidden');
    
    detailLeadName.innerText = lead.name;
    detailLeadCompany.innerText = lead.company || 'Individual Prospect';
    
    // Status text & colors
    detailStatus.innerText = lead.status.replace('_', ' ');
    detailStatus.className = 'score-value';
    if (lead.status === 'completed') detailStatus.style.color = 'var(--success)';
    else if (lead.status === 'calling') detailStatus.style.color = 'var(--warning)';
    else if (lead.status === 'connected') detailStatus.style.color = 'var(--cyan)';
    else if (['failed', 'declined', 'no_answer'].includes(lead.status)) detailStatus.style.color = 'var(--danger)';
    else detailStatus.style.color = 'var(--text-muted)';
    
    // Audio Visualizer Widget Visibility
    if (['calling', 'connected'].includes(lead.status)) {
        audioVisualizerWidget.classList.remove('hidden');
        visualizerStatusText.innerText = lead.status === 'connected' 
            ? 'Live Audio Stream Active (Conversation in progress...)' 
            : 'Outbound Agent Dialing Prospect...';
    } else {
        audioVisualizerWidget.classList.add('hidden');
    }
    
    // Scorecard Parameters
    detailBudget.innerText = lead.budget_status ? lead.budget_status.replace('_', ' ') : 'Pending';
    detailTimeline.innerText = lead.timeline_window ? lead.timeline_window.replace(/_/g, ' ') : 'Pending';
    detailInterest.innerText = lead.interest_level || 'Pending';
    
    detailNotes.innerText = lead.notes || 'Waiting for call completion to extract structured AI qualification summary...';
    detailPainPoint.innerText = lead.pain_point || 'Extracting core business challenges from transcript...';
    
    // Handoff Badge
    if (lead.handoff_recommended) {
        detailHandoffBadge.classList.remove('hidden');
        detailHandoffBadge.innerText = '🔥 Qualified Lead';
        detailHandoffBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        detailHandoffBadge.style.color = 'var(--success)';
        detailHandoffBadge.style.borderColor = 'var(--success)';
    } else if (['completed', 'failed', 'declined', 'no_answer'].includes(lead.status)) {
        detailHandoffBadge.classList.remove('hidden');
        detailHandoffBadge.innerText = 'Standard Lead';
        detailHandoffBadge.style.background = 'rgba(255, 255, 255, 0.05)';
        detailHandoffBadge.style.color = 'var(--text-muted)';
        detailHandoffBadge.style.borderColor = 'var(--card-border)';
    } else {
        detailHandoffBadge.classList.add('hidden');
    }
    
    renderTranscript(lead.transcript, lead.status);
}

function renderTranscript(transcriptStr, status) {
    let turns = [];
    if (transcriptStr) {
        try {
            turns = JSON.parse(transcriptStr);
        } catch (e) {
            console.error('Failed to parse transcript JSON', e);
        }
    }

    if (turns.length === 0) {
        if (['calling', 'connected'].includes(status)) {
            detailTranscript.innerHTML = `
                <div class="text-center py-5 text-muted" style="text-align: center; padding: 3rem;">
                    <i class="fa-solid fa-phone-flip fa-bounce me-2" style="color: var(--cyan); font-size: 1.5rem; display: block; margin-bottom: 0.75rem;"></i>
                    Outbound connection established! Agent is asking introductory qualification questions...
                </div>
            `;
        } else {
            detailTranscript.innerHTML = `
                <div class="text-center py-5 text-muted" style="text-align: center; padding: 3rem;">
                    <i class="fa-solid fa-comment-slash mb-2" style="font-size: 1.8rem; display: block; opacity: 0.4;"></i>
                    No transcript available for this call attempt.
                </div>
            `;
        }
        return;
    }
    
    let html = turns.map(turn => {
        const isBot = turn.speaker === 'bot';
        const speakerName = isBot ? 'Sarah (CALL-E AI)' : 'Prospect';
        const turnClass = isBot ? 'speaker-bot' : 'speaker-user';
        const icon = isBot ? 'fa-solid fa-robot' : 'fa-solid fa-user-tie';
        
        return `
            <div class="chat-turn ${turnClass}">
                <div class="turn-header">
                    <i class="${icon}"></i> ${speakerName}
                    <span class="turn-time">${turn.offset_seconds || 0}s</span>
                </div>
                <div class="turn-bubble">
                    ${escapeHtml(turn.text)}
                </div>
            </div>
        `;
    }).join('');

    // Indicator when live call is active
    if (['calling', 'connected'].includes(status)) {
        html += `
            <div class="chat-turn speaker-bot" style="opacity: 0.9; margin-top: 0.5rem;">
                <div class="turn-header" style="color: var(--cyan);">
                    <i class="fa-solid fa-microphone fa-pulse"></i> Agent Conversing Live
                </div>
                <div class="turn-bubble" style="background: rgba(6, 182, 212, 0.08); border: 1px stroke var(--cyan); font-style: italic;">
                    Listening to prospect responses...
                </div>
            </div>
        `;
    }

    detailTranscript.innerHTML = html;
    detailTranscript.scrollTop = detailTranscript.scrollHeight;
}

// --- Interaction Handlers ---

function selectLead(id) {
    selectedLeadId = id;
    applyFiltersAndRender();

    const lead = leads.find(l => l.id === id);
    if (lead) {
        renderLeadDetails(lead);
        if (['pending', 'calling', 'connected'].includes(lead.status)) {
            startFastPollingForSelectedLead();
        }
    }
}

// Quick Demo Preset Auto-Fillers
function fillPresetLead(type) {
    const nameInput = document.getElementById('leadName');
    const phoneInput = document.getElementById('leadPhone');
    const companyInput = document.getElementById('leadCompany');
    const productInput = document.getElementById('leadProduct');

    // Generate random digits to keep phone number testable
    const randDigits = Math.floor(1000 + Math.random() * 9000);

    if (type === 'hot') {
        nameInput.value = 'Samantha Vance';
        phoneInput.value = `+155501${randDigits.toString().substring(0,2)}`;
        companyInput.value = 'Apex AI Innovations';
        productInput.value = 'Enterprise CRM Integration';
    } else if (type === 'urgent') {
        nameInput.value = 'David Miller';
        phoneInput.value = `+155502${randDigits.toString().substring(0,2)}`;
        companyInput.value = 'Miller Global Logistics';
        productInput.value = 'AI Voice Agent Automation';
    } else if (type === 'casual') {
        nameInput.value = 'Rachel Green';
        phoneInput.value = `+155503${randDigits.toString().substring(0,2)}`;
        companyInput.value = 'Central Perk Labs';
        productInput.value = 'Cloud Infrastructure Optimization';
    }
    showToast('Loaded preset prospect data!');
}

// Copy CRM Report Summary to Clipboard
function copyCrmSummary() {
    if (!selectedLeadId) return;
    const lead = leads.find(l => l.id === selectedLeadId);
    if (!lead) return;

    const text = `
=== LEADQUALIFY BANT SCORECARD SUMMARY ===
Name: ${lead.name}
Company: ${lead.company || 'N/A'}
Phone: ${lead.phone}
Product Interest: ${lead.product_interest || 'N/A'}
Qualified Handoff: ${lead.handoff_recommended ? 'YES (HIGH PRIORITY)' : 'NO'}

BANT SCORECARD:
- Budget: ${lead.budget_status || 'Pending'}
- Timeline: ${lead.timeline_window || 'Pending'}
- Interest Level: ${lead.interest_level || 'Pending'}

CORE PAIN POINT:
${lead.pain_point || 'N/A'}

AI SUMMARY & NEXT STEPS:
${lead.notes || 'N/A'}
==========================================
    `.trim();

    navigator.clipboard.writeText(text).then(() => {
        showToast('📋 BANT Report copied to clipboard for CRM!');
    }).catch(err => {
        console.error('Clipboard copy failed', err);
    });
}

function openSimulateModal() {
    simulateModal.classList.add('open');
}

function closeSimulateModal() {
    simulateModal.classList.remove('open');
}

// Toast Helper
function showToast(message) {
    toastMessage.innerText = message;
    toastNotification.classList.add('show');
    setTimeout(() => {
        toastNotification.classList.remove('show');
    }, 3500);
}

// Mode Detector via /api/system/status Endpoint
async function detectExecutionMode() {
    try {
        const res = await fetch('/api/system/status');
        if (res.ok) {
            const data = await res.json();
            if (data.mock_mode) {
                modeBadge.className = 'mode-badge';
                modeBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Mock Mode Active';
            } else {
                modeBadge.className = 'mode-badge live';
                modeBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Live CALL-E Active';
            }
            return;
        }
    } catch (e) {
        console.error('System status check failed:', e);
    }

    // Fallback detection
    const hasMock = leads.some(l => l.call_id && l.call_id.includes('_mock_')) || leads.length === 0;
    if (hasMock) {
        modeBadge.className = 'mode-badge';
        modeBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Mock Mode Active';
    } else {
        modeBadge.className = 'mode-badge live';
        modeBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Live CALL-E Active';
    }
}

// HTML Escape Helper
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
