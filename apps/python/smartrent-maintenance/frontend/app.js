/**
 * SmartRent Telephony OS — Mission Control Frontend Engine
 * Real-time queue, interactive audio waveform visualizer, multi-tab console,
 * dynamic portfolio filter, and Web Speech API audio telephony deck.
 */

const API = '';
let selectedId = null;
let pollTimer = null;
let activeTab = 'telephony';
let activeQueueFilter = 'all';
let searchQuery = '';
let selectedProperty = 'all';
let currentDetailData = null;
let currentCallStepIndex = 0;

// ═══════════════════════════════════════════════════════════════════════════
// 1. LIVE AUDIO WAVEFORM VISUALIZER (HTML5 Canvas Spectrum Bars)
// ═══════════════════════════════════════════════════════════════════════════

class TelephonyWaveformVisualizer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.bars = 36;
        this.active = false;
        this.heights = new Array(this.bars).fill(4);
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.loop();
    }

    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0) return;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.bars = Math.max(16, Math.min(36, Math.floor(rect.width / 10)));
        if (this.heights.length !== this.bars) {
            this.heights = new Array(this.bars).fill(4);
        }
    }

    setActive(isActive) {
        this.active = isActive;
    }

    loop() {
        if (!this.canvas || !this.ctx) return;
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        this.ctx.clearRect(0, 0, w, h);

        const barWidth = Math.max(2, (w / this.bars) - 3);

        for (let i = 0; i < this.bars; i++) {
            let targetH = 3;
            if (this.active) {
                // Harmonic voice frequencies
                const wave1 = Math.sin(Date.now() * 0.008 + i * 0.4);
                const wave2 = Math.cos(Date.now() * 0.012 + i * 0.2);
                const amp = Math.abs(wave1 * 0.6 + wave2 * 0.4);
                targetH = 4 + amp * (h * 0.75);
            } else {
                // Idle pulse
                targetH = 3 + Math.sin(Date.now() * 0.002 + i * 0.3) * 2;
            }

            // Smooth interpolation
            this.heights[i] += (targetH - this.heights[i]) * 0.2;
            const barH = this.heights[i];
            const x = i * (barWidth + 3);
            const y = (h - barH) / 2;

            const grad = this.ctx.createLinearGradient(0, y, 0, y + barH);
            if (this.active) {
                grad.addColorStop(0, '#3157D5');
                grad.addColorStop(1, '#2A4BC0');
            } else {
                grad.addColorStop(0, 'rgba(0, 0, 0, 0.08)');
                grad.addColorStop(1, 'rgba(0, 0, 0, 0.04)');
            }

            this.ctx.fillStyle = grad;
            this.ctx.beginPath();
            this.ctx.roundRect(x, y, barWidth, barH, 2);
            this.ctx.fill();
        }

        requestAnimationFrame(() => this.loop());
    }
}

let waveformVisualizer = null;

// ═══════════════════════════════════════════════════════════════════════════
// 2. WEB SPEECH API AUDIO TELEPHONY ENGINE
// ═══════════════════════════════════════════════════════════════════════════

let isPlayingAudio = false;
let currentSpeechIndex = 0;
let playbackRate = 1.0;
let currentNativeAudio = null;

function stopCallAudio() {
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    if (currentNativeAudio) {
        try {
            currentNativeAudio.pause();
            currentNativeAudio.currentTime = 0;
        } catch (e) {}
        currentNativeAudio = null;
    }
    isPlayingAudio = false;
    if (waveformVisualizer) waveformVisualizer.setActive(false);

    document.querySelectorAll('.turn-box').forEach(b => b.classList.remove('speaking'));
    const btn = document.getElementById('btnPlayCall');
    if (btn) {
        btn.classList.remove('playing');
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> <span>Play Call Audio</span>`;
    }
}

function togglePlayCurrentCall() {
    if (isPlayingAudio) {
        stopCallAudio();
        return;
    }

    if (!currentDetailData || !currentDetailData.calls || currentDetailData.calls.length === 0) {
        showToast('No call audio recording loaded');
        return;
    }

    const activeCall = currentDetailData.calls[currentCallStepIndex] || currentDetailData.calls[0];

    // Stream native telephony audio if recording/audio URL is provided
    const nativeAudioUrl = activeCall.recording_url || activeCall.audio_url;
    if (nativeAudioUrl) {
        isPlayingAudio = true;
        if (waveformVisualizer) waveformVisualizer.setActive(true);
        const btn = document.getElementById('btnPlayCall');
        if (btn) {
            btn.classList.add('playing');
            btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> <span>Stop Audio</span>`;
        }
        currentNativeAudio = new Audio(nativeAudioUrl);
        currentNativeAudio.playbackRate = playbackRate;
        currentNativeAudio.onended = () => {
            stopCallAudio();
        };
        currentNativeAudio.onerror = () => {
            console.warn('Native audio stream unreachable, falling back to speech synthesis preview');
            stopCallAudio();
            playTranscriptSynthesis(activeCall);
        };
        currentNativeAudio.play().catch(e => {
            console.warn('Native audio play error:', e);
            stopCallAudio();
            playTranscriptSynthesis(activeCall);
        });
        return;
    }

    playTranscriptSynthesis(activeCall);
}

function playTranscriptSynthesis(activeCall) {
    if (!activeCall.transcript || activeCall.transcript.length === 0) {
        showToast('Transcript not populated for this call');
        return;
    }

    if (!('speechSynthesis' in window)) {
        showToast('Speech synthesis not supported in this browser');
        return;
    }

    isPlayingAudio = true;
    if (waveformVisualizer) waveformVisualizer.setActive(true);

    const btn = document.getElementById('btnPlayCall');
    if (btn) {
        btn.classList.add('playing');
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> <span>Stop Audio</span>`;
    }

    const turns = activeCall.transcript;
    currentSpeechIndex = 0;

    function speakTurn() {
        if (!isPlayingAudio || currentSpeechIndex >= turns.length) {
            stopCallAudio();
            return;
        }

        const turn = turns[currentSpeechIndex];
        const bubble = document.getElementById(`turn-${currentSpeechIndex}`);

        document.querySelectorAll('.turn-box').forEach(b => b.classList.remove('speaking'));
        if (bubble) {
            bubble.classList.add('speaking');
            bubble.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        const utterance = new SpeechSynthesisUtterance(turn.text);
        utterance.rate = playbackRate;

        if (turn.speaker === 'bot') {
            utterance.pitch = 1.15; // Crisp assistant tone
        } else {
            utterance.pitch = 0.92; // Natural human callee tone
        }

        utterance.onend = () => {
            currentSpeechIndex++;
            speakTurn();
        };

        utterance.onerror = () => {
            currentSpeechIndex++;
            speakTurn();
        };

        window.speechSynthesis.speak(utterance);
    }

    speakTurn();
}

function setPlaybackSpeed(rate, el) {
    playbackRate = parseFloat(rate);
    if (currentNativeAudio) {
        try { currentNativeAudio.playbackRate = playbackRate; } catch (e) {}
    }
    document.querySelectorAll('.speed-chip').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    showToast(`Speed set to ${rate}x`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. INITIALIZATION & DATA REFRESH
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    await refreshData();
    startPolling();
});

async function loadConfig() {
    try {
        const res = await fetch(`${API}/api/config`);
        const cfg = await res.json();
        const badge = document.getElementById('modeBadge');
        if (!cfg.dry_run) {
            badge.className = 'mode-pill live';
            badge.querySelector('.mode-text').textContent = 'LIVE TELEPHONY';
            document.getElementById('engineStatusText').textContent = 'CALL-E v1.4 (LIVE)';
        }
    } catch {}
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshData, 1600);
}

async function refreshData() {
    try {
        const res = await fetch(`${API}/api/dashboard`);
        const data = await res.json();

        // Update counts
        document.getElementById('statCalls').textContent = data.total_calls;
        document.getElementById('statActive').textContent = data.active_requests;
        document.getElementById('statCompleted').textContent = data.completed_requests;
        document.getElementById('queueCount').textContent = `${data.requests.length} TICKETS`;

        renderQueue(data.requests);

        // Auto-select latest request if none selected
        if (!selectedId && data.requests.length > 0) {
            selectRequest(data.requests[0].id);
        } else if (selectedId) {
            await refreshDetail(selectedId);
        }
    } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. QUEUE RENDERING & FILTERING
// ═══════════════════════════════════════════════════════════════════════════

function setQueueFilter(filter, el) {
    activeQueueFilter = filter;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    refreshData();
}

function handleQueueSearch(val) {
    searchQuery = (val || '').toLowerCase().trim();
    refreshData();
}

function handlePropertyChange(val) {
    selectedProperty = val;
    showToast(`Filtering portfolio: ${val.toUpperCase()}`);
    refreshData();
}

function renderQueue(requests) {
    const list = document.getElementById('requestsList');
    if (!requests || requests.length === 0) {
        list.innerHTML = `
            <div class="queue-empty">
                <div class="empty-icon-shield">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
                <h4>No Active Maintenance Requests</h4>
                <p>Click <strong>"Standard Demo"</strong> or <strong>"Cascade Fallback"</strong> above to launch an autonomous phone call sequence.</p>
            </div>`;
        return;
    }

    // Filter by trade / urgency / search
    const filtered = requests.filter(r => {
        if (activeQueueFilter === 'urgent' && r.urgency !== 'emergency') return false;
        if (activeQueueFilter === 'plumbing' && r.issue_type !== 'plumbing') return false;
        if (activeQueueFilter === 'electrical' && r.issue_type !== 'electrical') return false;
        if (activeQueueFilter === 'hvac' && r.issue_type !== 'hvac') return false;

        if (searchQuery) {
            const match = (r.tenant_name || '').toLowerCase().includes(searchQuery) ||
                          (r.unit_number || '').toLowerCase().includes(searchQuery) ||
                          (r.id || '').toLowerCase().includes(searchQuery) ||
                          (r.initial_description || '').toLowerCase().includes(searchQuery);
            if (!match) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        list.innerHTML = `<div style="padding:20px;text-align:center;font-size:11px;color:var(--text-tertiary)">No tickets match current filters</div>`;
        return;
    }

    const mobileBadge = document.getElementById('mobileTabQueueCount');
    if (mobileBadge) mobileBadge.textContent = requests.length;

    list.innerHTML = filtered.map(req => {
        const isSel = req.id === selectedId;
        const urgencyClass = req.urgency === 'emergency' ? 'tag-emergency' : req.urgency === 'urgent' ? 'tag-urgent' : 'tag-routine';
        const isCascaded = req.timeline && req.timeline.some(e => e.event.includes('cascade'));

        return `
        <div class="ticket-card ${isSel ? 'selected' : ''}" onclick="selectRequest('${req.id}')">
            <div class="ticket-head">
                <span class="ticket-unit-chip">UNIT ${req.unit_number}</span>
                <span class="ticket-id">${req.id}</span>
            </div>
            <div class="ticket-tenant-row">
                <span class="ticket-tenant-name">${req.tenant_name}</span>
                <span class="ticket-time">${fmtRelativeTime(req.created_at)}</span>
            </div>
            <div class="ticket-brief">${req.initial_description || 'Maintenance investigation requested'}</div>
            <div class="ticket-badges-row">
                ${req.urgency ? `<span class="tag-badge ${urgencyClass}">${req.urgency}</span>` : ''}
                ${req.issue_type ? `<span class="tag-badge tag-trade">${req.issue_type}</span>` : ''}
                ${isCascaded ? `<span class="tag-badge tag-cascade">⚡ CASCADED</span>` : ''}
                <span class="tag-state">${fmtState(req.state)}</span>
            </div>
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. DETAIL CONSOLE & TABS
// ═══════════════════════════════════════════════════════════════════════════

let currentMobileView = 'queue';

function setMobileView(view) {
    currentMobileView = view;
    const body = document.querySelector('.console-body');
    const tabQ = document.getElementById('btnTabQueue');
    const tabI = document.getElementById('btnTabIncident');
    if (!body) return;
    if (view === 'incident') {
        body.classList.add('show-incident');
        body.classList.remove('show-queue');
        if (tabQ) tabQ.classList.remove('active');
        if (tabI) tabI.classList.add('active');
    } else {
        body.classList.add('show-queue');
        body.classList.remove('show-incident');
        if (tabQ) tabQ.classList.add('active');
        if (tabI) tabI.classList.remove('active');
    }
}

async function selectRequest(id) {
    if (selectedId === id && currentDetailData) {
        if (window.innerWidth <= 900) setMobileView('incident');
        return;
    }
    selectedId = id;
    currentCallStepIndex = 0;
    stopCallAudio();
    if (window.innerWidth <= 900) setMobileView('incident');
    await refreshDetail(id);
    await refreshData();
}

async function refreshDetail(id) {
    try {
        const res = await fetch(`${API}/api/requests/${id}`);
        if (!res.ok) return;
        const req = await res.json();
        currentDetailData = req;
        updateSequenceRail(req.state);
        renderDetailConsole(req);
    } catch {}
}

function updateSequenceRail(state) {
    const s1 = document.getElementById('pipeStep1');
    const s2 = document.getElementById('pipeStep2');
    const s3 = document.getElementById('pipeStep3');
    const c1 = document.getElementById('pipeConn1');
    const c2 = document.getElementById('pipeConn2');
    const strip = document.getElementById('pipelineStatus');

    [s1, s2, s3].forEach(s => s.classList.remove('active', 'done'));
    [c1, c2].forEach(c => c.classList.remove('active'));

    const stateMap = {
        created:           { active: 1, done: [], conns: [] },
        tenant_calling:    { active: 1, done: [], conns: [] },
        tenant_called:     { active: 2, done: [1], conns: [1] },
        vendor_searching:  { active: 2, done: [1], conns: [1] },
        vendor_found:      { active: 3, done: [1, 2], conns: [1, 2] },
        tenant_confirming: { active: 3, done: [1, 2], conns: [1, 2] },
        tenant_confirmed:  { active: 0, done: [1, 2, 3], conns: [1, 2] },
        completed:         { active: 0, done: [1, 2, 3], conns: [1, 2] },
        failed:            { active: 0, done: [], conns: [] },
    };

    const config = stateMap[state] || stateMap.created;

    if (config.done.includes(1)) s1.classList.add('done');
    if (config.done.includes(2)) s2.classList.add('done');
    if (config.done.includes(3)) s3.classList.add('done');

    if (config.active === 1) s1.classList.add('active');
    if (config.active === 2) s2.classList.add('active');
    if (config.active === 3) s3.classList.add('active');

    if (config.conns.includes(1)) c1.classList.add('active');
    if (config.conns.includes(2)) c2.classList.add('active');

    if (state === 'completed' || state === 'tenant_confirmed') {
        strip.className = 'sequence-status-strip done';
        strip.innerHTML = `<span class="status-indicator-dot"></span><span class="status-indicator-text">Closed-Loop Complete &middot; Vendor Dispatched &middot; Tenant Confirmed</span>`;
    } else if (config.active > 0) {
        strip.className = 'sequence-status-strip running';
        strip.innerHTML = `<span class="status-indicator-dot"></span><span class="status-indicator-text">CALL-E Active &middot; Outbound Phone Call in Progress...</span>`;
    } else {
        strip.className = 'sequence-status-strip';
        strip.innerHTML = `<span class="status-indicator-dot"></span><span class="status-indicator-text">Dispatcher Idle &middot; Click Demo to run</span>`;
    }
}

function switchDetailTab(tabName) {
    activeTab = tabName;
    if (currentDetailData) {
        renderDetailConsole(currentDetailData);
    }
}

function renderDetailConsole(req) {
    const panel = document.getElementById('detailPanel');
    const calls = req.calls || [];
    const activeCall = calls[currentCallStepIndex] || calls[0] || null;

    panel.innerHTML = `
    <div class="incident-workspace">
        <!-- Mobile Back to Queue Navigation -->
        <div class="mobile-back-row">
            <button class="btn-mobile-back" onclick="setMobileView('queue')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                <span>&larr; Back to Dispatch Queue</span>
            </button>
        </div>

        <!-- Command Header -->
        <div class="incident-command-bar">
            <div>
                <div class="incident-id-unit">
                    <span class="incident-unit-pill">UNIT ${req.unit_number}</span>
                    <span class="incident-id-text">${req.id}</span>
                </div>
                <div class="incident-meta-line">
                    ${req.tenant_name} &middot; ${req.tenant_phone} &middot; ${req.property_name || 'Sunset Heights'}
                </div>
            </div>
            <div class="incident-actions-toolbar">
                <button class="btn-tool" onclick="simulateTenantSMS()" title="Simulate calendar confirmation SMS sent to tenant">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <span>Tenant SMS</span>
                </button>
                <button class="btn-tool" onclick="escalateToHuman()" title="Trigger manual property manager escalation">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span>Escalate</span>
                </button>
                <button class="btn-tool" onclick="showWorkOrderJSON()" title="View raw work order payload">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                    <span>JSON</span>
                </button>
            </div>
        </div>

        <!-- Tactical Tabs Navigation -->
        <div class="tab-navigation-bar">
            <button class="console-tab ${activeTab === 'telephony' ? 'active' : ''}" onclick="switchDetailTab('telephony')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3"/></svg>
                <span>Voice Telephony & Transcripts</span>
                <span class="tab-badge-num">${calls.length}</span>
            </button>
            <button class="console-tab ${activeTab === 'platform' ? 'active' : ''}" onclick="switchDetailTab('platform')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                <span>CALL-E Platform Inspector</span>
            </button>
            <button class="console-tab ${activeTab === 'roster' ? 'active' : ''}" onclick="switchDetailTab('roster')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <span>Contractor Roster</span>
                <span class="tab-badge-num">6</span>
            </button>
            <button class="console-tab ${activeTab === 'audit' ? 'active' : ''}" onclick="switchDetailTab('audit')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>Audit Trail</span>
                <span class="tab-badge-num">${(req.timeline || []).length}</span>
            </button>
        </div>

        <!-- Tab Body Content -->
        <div class="tab-body-render">
            ${renderActiveTabContent(req, calls, activeCall)}
        </div>
    </div>`;

    // Initialize waveform visualizer if canvas is present
    if (activeTab === 'telephony') {
        setTimeout(() => {
            waveformVisualizer = new TelephonyWaveformVisualizer('telephonyWaveformCanvas');
        }, 50);
    }
}

function renderActiveTabContent(req, calls, activeCall) {
    if (activeTab === 'telephony') {
        return renderTelephonyTab(req, calls, activeCall);
    } else if (activeTab === 'platform') {
        return renderPlatformInspectorTab(req, activeCall);
    } else if (activeTab === 'roster') {
        return renderRosterTab(req);
    } else if (activeTab === 'audit') {
        return renderAuditTab(req);
    }
    return '';
}

// ─── TAB 1: TELEPHONY AUDIO & TRANSCRIPT ──────────────────────────────
function renderTelephonyTab(req, calls, activeCall) {
    if (!calls || calls.length === 0) {
        return `<div class="telephony-deck-card" style="text-align:center;padding:30px;color:var(--text-tertiary)">Initiating CALL-E phone session...</div>`;
    }

    const currentCall = calls[currentCallStepIndex] || calls[0];
    const callTypeLabels = {
        tenant_intake: 'CALL 1: TENANT DIAGNOSTIC INTAKE',
        vendor_dispatch: 'CALL 2: CONTRACTOR DISPATCH',
        tenant_confirm: 'CALL 3: TENANT APPROVAL CONFIRMATION'
    };

    return `
    <div style="display:flex;flex-direction:column;gap:14px">
        <!-- Interactive Telephony Deck Card -->
        <div class="telephony-deck-card">
            <div class="telephony-deck-header">
                <div class="deck-title-group">
                    <div class="telephony-icon-box">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3"/></svg>
                    </div>
                    <div>
                        <div class="deck-title">${callTypeLabels[currentCall.call_type] || currentCall.call_type.toUpperCase()}</div>
                        <div style="font-size:10px;color:var(--text-tertiary);font-family:var(--font-mono)">
                            SIP DESTINATION: ${currentCall.phone} &middot; CALL-E OUTBOUND ID: ${currentCall.call_id}
                        </div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                    ${(currentCall.recording_url || currentCall.audio_url)
                        ? '<span class="telephony-preview-tag live-rec" title="Direct audio stream from CALL-E telephony server"><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg> LIVE AUDIO</span>'
                        : '<span class="telephony-preview-tag" title="Synthesized turn-by-turn speech preview for audit inspection"><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg> SPEECH SYNTHESIS PREVIEW</span>'
                    }
                    <span class="deck-call-status-pill">${currentCall.status === 'completed' ? '200 OK &middot; COMPLETED' : 'CALLING...'}</span>
                </div>
            </div>

            <!-- Live Canvas Audio Waveform -->
            <div class="waveform-canvas-container">
                <canvas id="telephonyWaveformCanvas"></canvas>
            </div>

            <!-- Audio Controls Bar -->
            <div class="telephony-audio-controls">
                <button class="audio-btn-play ${isPlayingAudio ? 'playing' : ''}" id="btnPlayCall" onclick="togglePlayCurrentCall()">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                    <span>${isPlayingAudio ? 'Stop Audio' : 'Play Call Audio'}</span>
                </button>

                <div class="audio-track-info">
                    <span>CONFIDENCE: <strong>${Math.round((currentCall.confidence_score || 0.94) * 100)}%</strong></span>
                    <span>&middot;</span>
                    <span>TURNS: <strong>${(currentCall.transcript || []).length}</strong></span>
                </div>

                <div class="audio-speed-chips">
                    <button class="speed-chip ${playbackRate === 1.0 ? 'active' : ''}" onclick="setPlaybackSpeed(1.0, this)">1.0x</button>
                    <button class="speed-chip ${playbackRate === 1.25 ? 'active' : ''}" onclick="setPlaybackSpeed(1.25, this)">1.25x</button>
                    <button class="speed-chip ${playbackRate === 1.5 ? 'active' : ''}" onclick="setPlaybackSpeed(1.5, this)">1.5x</button>
                </div>
            </div>

            <!-- Call Switcher Pills -->
            <div class="call-step-picker-row">
                ${calls.map((c, i) => `
                    <button class="call-picker-pill ${i === currentCallStepIndex ? 'active' : ''}" onclick="selectCallStep(${i})">
                        ${i + 1}. ${callTypeLabels[c.call_type] || c.call_type} (${c.phone.slice(-4)})
                    </button>
                `).join('')}
            </div>
        </div>

        <!-- Structured Diagnostic Matrix -->
        <div class="evidence-section">
            <div class="data-matrix-grid">
                <div class="data-cell">
                    <div class="data-cell-label">TRADE SPECIALTY</div>
                    <div class="data-cell-val" style="color:var(--cyan)">${req.issue_type || 'Plumbing'}</div>
                </div>
                <div class="data-cell">
                    <div class="data-cell-label">TRIAGE URGENCY</div>
                    <div class="data-cell-val" style="color:${req.urgency === 'emergency' ? 'var(--crimson)' : 'var(--amber)'}">
                        ${(req.urgency || 'Urgent').toUpperCase()}
                    </div>
                </div>
                <div class="data-cell">
                    <div class="data-cell-label">UNIT LOCATION</div>
                    <div class="data-cell-val">${req.location_in_unit || 'Kitchen Sink'}</div>
                </div>
                <div class="data-cell">
                    <div class="data-cell-label">DISPATCHED CONTRACTOR</div>
                    <div class="data-cell-val" style="color:var(--emerald)">${typeof req.assigned_vendor === 'object' ? (req.assigned_vendor.name || 'Assigned') : (req.assigned_vendor || 'Apex Emergency Rooter')}</div>
                </div>
                <div class="data-cell">
                    <div class="data-cell-label">CONFIRMED ETA</div>
                    <div class="data-cell-val">${req.vendor_eta || 'Within 2 hours'}</div>
                </div>
                <div class="data-cell">
                    <div class="data-cell-label">ESTIMATED COST</div>
                    <div class="data-cell-val">${req.vendor_cost_estimate || '$150-250'}</div>
                </div>
            </div>

            ${currentCall.evidence && currentCall.evidence.length > 0 ? `
                <div style="font-size:10px;font-family:var(--font-mono);color:var(--text-tertiary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">
                    VERIFIED TRANSCRIPT EVIDENCE QUOTES
                </div>
                ${currentCall.evidence.map(e => `
                    <div class="quote-box">
                        <span class="quote-icon">“</span>
                        <span>${e}</span>
                    </div>
                `).join('')}
            ` : ''}
        </div>

        <!-- Live Transcript Turns -->
        <div class="transcript-card">
            <div class="transcript-header">
                <span class="transcript-title">CONVERSATIONAL TRANSCRIPT AUDIT</span>
                <span style="font-size:10px;font-family:var(--font-mono);color:var(--text-tertiary)">SPEECH SYNCHRONIZED</span>
            </div>
            <div class="transcript-stream">
                ${(currentCall.transcript || []).map((t, idx) => `
                    <div class="turn-box ${t.speaker === 'bot' ? 'agent' : 'callee'}" id="turn-${idx}">
                        <div class="turn-meta">
                            <span class="turn-speaker-label">${t.speaker === 'bot' ? 'SmartRent Telephony Agent' : 'Resident / Vendor'}</span>
                            <span class="turn-offset">+${t.offset_seconds || idx * 4}s</span>
                        </div>
                        <div class="turn-text">${t.text}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    </div>`;
}

function selectCallStep(idx) {
    stopCallAudio();
    currentCallStepIndex = idx;
    if (currentDetailData) {
        renderDetailConsole(currentDetailData);
    }
}

// ─── TAB 2: CALL-E PLATFORM INSPECTOR ────────────────────────────────
function renderPlatformInspectorTab(req, activeCall) {
    const call = activeCall || (req.calls && req.calls[0]) || {};

    const schemaIntake = {
        issue_type: "plumbing | electrical | hvac | appliance | structural | other",
        urgency: "emergency | urgent | routine",
        location_in_unit: "string",
        access_instructions: "string",
        additional_details: "string"
    };

    const schemaDispatch = {
        available: "yes | no | maybe",
        eta: "string",
        cost_estimate: "string",
        notes: "string"
    };

    return `
    <div class="platform-inspector-wrap">
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;padding:12px 14px;background:var(--bg-surface-1);border-radius:var(--radius-md);border:1px solid var(--hairline)">
            <strong>CALL-E Developer Platform Telemetry:</strong> This panel exposes the typed JSON schemas, cryptographic idempotency keys, and confidence validation models fed into the CALL-E engine.
        </div>

        <div class="code-deck">
            <div class="code-deck-header">
                <span class="code-deck-title">ACTIVE RESULT SCHEMA (CONTRACTOR DISPATCH)</span>
                <button class="code-deck-copy-btn" onclick="navigator.clipboard.writeText(JSON.stringify(call.structured_result,null,2));showToast('Schema copied')">Copy JSON</button>
            </div>
            <pre>${JSON.stringify(schemaDispatch, null, 2)}</pre>
        </div>

        <div class="code-deck">
            <div class="code-deck-header">
                <span class="code-deck-title">CALL-E EXTRACTED STRUCTURED RESULT</span>
            </div>
            <pre>${JSON.stringify(call.structured_result || {}, null, 2)}</pre>
        </div>

        <div class="code-deck">
            <div class="code-deck-header">
                <span class="code-deck-title">COMPLETION CONFIDENCE & EVIDENCE MODEL</span>
            </div>
            <pre>${JSON.stringify({
                task_completed: call.task_completed,
                confidence_score: call.confidence_score || 0.94,
                confidence_label: call.confidence_label || "high",
                evidence: call.evidence || []
            }, null, 2)}</pre>
        </div>
    </div>`;
}

// ─── TAB 3: CONTRACTOR ROSTER MATRIX ──────────────────────────────────
function renderRosterTab(req) {
    const contractors = [
        { name: "Mike's Plumbing", trade: "Plumbing", phone: "+1 (555) 010-0001", tier: "primary", rate: "$95/hr", rating: "4.9", status: "Busy (Emergency Main Replacement)" },
        { name: "Apex Emergency Rooter", trade: "Plumbing", phone: "+1 (555) 010-0011", tier: "secondary", rate: "$110/hr", rating: "4.8", status: "Active Dispatched (Within 2h)" },
        { name: "VoltPro Masters", trade: "Electrical", phone: "+1 (555) 010-0002", tier: "primary", rate: "$120/hr", rating: "5.0", status: "On-Call" },
        { name: "QuickWire Electric", trade: "Electrical", phone: "+1 (555) 010-0022", tier: "secondary", rate: "$105/hr", rating: "4.7", status: "Standby" },
        { name: "BreezeAir Climate", trade: "HVAC", phone: "+1 (555) 010-0003", tier: "primary", rate: "$115/hr", rating: "4.9", status: "On-Call" },
        { name: "TempMaster Heating & Air", trade: "HVAC", phone: "+1 (555) 010-0033", tier: "secondary", rate: "$125/hr", rating: "4.8", status: "Standby" },
    ];

    return `
    <div style="display:flex;flex-direction:column;gap:12px">
        <div style="font-size:11px;color:var(--text-secondary)">
            Pre-approved licensed trade contractor roster with automated waterfall cascade ranking:
        </div>
        <div class="roster-grid">
            ${contractors.map(c => `
                <div class="contractor-card">
                    <div class="contractor-top">
                        <span class="contractor-name">${c.name}</span>
                        <span class="contractor-tier-badge ${c.tier}">${c.tier.toUpperCase()}</span>
                    </div>
                    <div class="contractor-meta-row">
                        <span>TRADE: <strong>${c.trade}</strong></span>
                        <span>RATE: <strong>${c.rate}</strong></span>
                        <span>RATING: <strong>⭐ ${c.rating}</strong></span>
                    </div>
                    <div style="font-size:10px;font-family:var(--font-mono);color:var(--text-tertiary)">${c.phone}</div>
                    <div class="contractor-tags-row">
                        <span class="tag-badge ${c.status.includes('Active') ? 'tag-routine' : c.status.includes('Busy') ? 'tag-emergency' : 'tag-trade'}">${c.status}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>`;
}

// ─── TAB 4: AUDIT TRAIL ──────────────────────────────────────────────
function renderAuditTab(req) {
    const timeline = req.timeline || [];
    if (timeline.length === 0) {
        return `<div style="padding:20px;text-align:center;color:var(--text-tertiary)">No audit logs recorded</div>`;
    }

    return `
    <div class="audit-stream">
        ${timeline.map(evt => {
            const isCascade = evt.event.includes('cascade');
            const isDone = evt.event.includes('confirmed') || evt.event.includes('completed');
            return `
            <div class="audit-row">
                <div class="audit-time">${fmtTime(evt.timestamp)}</div>
                <div class="audit-dot ${isCascade ? 'cascade' : isDone ? 'done' : ''}"></div>
                <div class="audit-content">
                    <div class="audit-event-code">${evt.event.toUpperCase()}</div>
                    <div class="audit-detail-text">${evt.details || ''}</div>
                </div>
            </div>`;
        }).join('')}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. ACTION DEMOS & MODALS
// ═══════════════════════════════════════════════════════════════════════════

async function runAutoDemo(cascade = false) {
    const btn = cascade ? document.getElementById('btnCascadeDemo') : document.getElementById('btnDemo');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="pill-dot" style="background:var(--amber)"></span> <span>Dialing...</span>`;
    }

    showToast(cascade 
        ? '⚡ Launching Cascade Fallback: Contractor #1 busy ➔ Auto-cascades to Contractor #2' 
        : '🚀 Dialing CALL-E 3-step closed-loop sequence...'
    );

    try {
        const payload = {
            tenant_name: cascade ? 'Marcus Vance' : 'Sarah Chen',
            tenant_phone: '+15550100012',
            unit_number: cascade ? '12C' : '4B',
            property_name: 'Sunset Heights (Building A)',
            initial_description: cascade
                ? 'Circuit breaker keeps tripping with burning smell near kitchen panel'
                : 'Kitchen sink is leaking under the cabinet, water pooling on floor',
            simulate_cascade: cascade,
        };

        const res = await fetch(`${API}/api/requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const req = await res.json();
        selectedId = req.id;
        await refreshData();
        showToast(cascade
            ? `⚡ Cascade workflow active (${req.id}) — Watch Contractor fallback in real-time!`
            : `✅ Ticket ${req.id} created — Calls in progress!`
        );
    } catch (e) {
        showToast(`❌ Error: ${e.message}`);
    } finally {
        setTimeout(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = cascade
                    ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> <span>Cascade Fallback</span>`
                    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> <span>Standard Demo</span>`;
            }
        }, 4000);
    }
}

function showNewRequestModal() {
    document.getElementById('modalOverlay').classList.add('visible');
    setTimeout(() => document.getElementById('tenantName').focus(), 100);
}

function hideNewRequestModal() {
    document.getElementById('modalOverlay').classList.remove('visible');
    document.getElementById('newRequestForm').reset();
}

async function submitNewRequest(event) {
    event.preventDefault();
    const btn = document.getElementById('btnSubmit');
    btn.disabled = true;

    const cascadeEl = document.getElementById('simulateCascade');
    const simulateCascade = cascadeEl ? cascadeEl.checked : false;

    const payload = {
        tenant_name: document.getElementById('tenantName').value,
        tenant_phone: document.getElementById('tenantPhone').value,
        unit_number: document.getElementById('unitNumber').value,
        property_name: document.getElementById('propertyName').value || 'Sunset Heights',
        initial_description: document.getElementById('initialDescription').value,
        simulate_cascade: simulateCascade,
    };

    try {
        const res = await fetch(`${API}/api/requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed');
        const req = await res.json();
        hideNewRequestModal();
        showToast(`✅ Ticket ${req.id} dispatched to CALL-E engine!`);
        selectedId = req.id;
        await refreshData();
    } catch (e) {
        showToast(`❌ Error: ${e.message}`);
    } finally {
        btn.disabled = false;
    }
}

// ─── Extra Modals (Work Order JSON & SMS Preview) ─────────────────────
function showWorkOrderJSON() {
    if (!currentDetailData) return;
    document.getElementById('extraModalTag').textContent = 'STRUCTURED WORK ORDER';
    document.getElementById('extraModalTitle').textContent = `Incident ${currentDetailData.id} Telemetry`;
    document.getElementById('extraModalBody').innerHTML = `
        <div class="code-deck">
            <div class="code-deck-header">
                <span class="code-deck-title">REST API PAYLOAD</span>
                <button class="code-deck-copy-btn" onclick="navigator.clipboard.writeText(JSON.stringify(currentDetailData, null, 2));showToast('Work order JSON copied!')">Copy</button>
            </div>
            <pre>${JSON.stringify(currentDetailData, null, 2)}</pre>
        </div>`;
    document.getElementById('workOrderModal').classList.add('visible');
}

function simulateTenantSMS() {
    if (!currentDetailData) return;
    const vendor = (typeof currentDetailData.assigned_vendor === 'object' && currentDetailData.assigned_vendor?.name) 
        ? currentDetailData.assigned_vendor.name 
        : (currentDetailData.assigned_vendor || 'Apex Emergency Rooter');
    const eta = currentDetailData.vendor_eta || 'within 2 hours';

    document.getElementById('extraModalTag').textContent = 'RESIDENT SMS DISPATCH';
    document.getElementById('extraModalTitle').textContent = `Simulated Tenant Notification`;
    document.getElementById('extraModalBody').innerHTML = `
        <div style="background:var(--bg-surface-1);border:1px solid var(--hairline);border-radius:16px;padding:20px;max-width:380px;margin:0 auto">
            <div style="font-size:10px;font-family:var(--font-mono);color:var(--text-tertiary);margin-bottom:8px;text-align:center">
                MESSAGES &middot; TODAY ${new Date().toLocaleTimeString()}
            </div>
            <div style="background:var(--bg-surface-0);padding:12px 14px;border-radius:14px;color:var(--text-primary);font-size:12px;line-height:1.5;box-shadow:var(--shadow-card)">
                <strong>SmartRent Notification:</strong> Hi ${currentDetailData.tenant_name}, as confirmed on our phone call, <strong>${vendor}</strong> has been scheduled for Unit ${currentDetailData.unit_number}.
                <br><br>
                Arrival window: <strong>${eta}</strong>.
                <br>
                Access code 4521 has been authorized for entry.
            </div>
        </div>`;
    document.getElementById('workOrderModal').classList.add('visible');
}

function hideWorkOrderModal() {
    document.getElementById('workOrderModal').classList.remove('visible');
}

function escalateToHuman() {
    if (!currentDetailData) return;
    showToast('⚠️ Ticket escalated: Property Manager on-call paged via urgent SMS');
    if (!currentDetailData.timeline) currentDetailData.timeline = [];
    currentDetailData.timeline.push({
        timestamp: new Date().toISOString(),
        event: 'human_escalation_triggered',
        details: 'Manual property manager override initiated from Command Console.'
    });
    renderDetailConsole(currentDetailData);
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. FORMATTERS & UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function fmtState(s) {
    const map = {
        created: 'Created',
        tenant_calling: 'Calling Tenant',
        tenant_called: 'Intake Done',
        vendor_searching: 'Cascade Finding Vendor',
        vendor_found: 'Vendor Dispatched',
        tenant_confirming: 'Confirming Tenant',
        tenant_confirmed: 'Confirmed & Closed',
        completed: 'Resolved',
        failed: 'Failed'
    };
    return map[s] || s;
}

function fmtTime(ts) {
    try {
        return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return ts; }
}

function fmtRelativeTime(ts) {
    try {
        const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    } catch { return 'Just now'; }
}

function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('visible');
    setTimeout(() => t.classList.remove('visible'), 3600);
}
