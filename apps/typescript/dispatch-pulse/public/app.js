document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const dispatchForm = document.getElementById('dispatchForm');
    const deliveriesBody = document.getElementById('deliveriesBody');
    const dispatchedCallsStat = document.getElementById('dispatchedCallsStat');
    const confirmedStat = document.getElementById('confirmedStat');
    const rescheduledStat = document.getElementById('rescheduledStat');
    const activeRidersStat = document.getElementById('activeRidersStat');
    const sidebarRiderCount = document.getElementById('sidebarRiderCount');
    const transcriptModal = document.getElementById('transcriptModal');
    const modalBody = document.getElementById('modalBody');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const searchInput = document.getElementById('searchInput');
    const viewTitle = document.getElementById('viewTitle');
    const viewSubtitle = document.getElementById('viewSubtitle');
    const fleetGrid = document.getElementById('fleetGrid');
    const analyticsOutcomesGrid = document.getElementById('analyticsOutcomesGrid');
    const settingsForm = document.getElementById('settingsForm');
    const testConnBtn = document.getElementById('testConnBtn');

    const activeOrders = new Map();
    let currentFilter = 'all';
    let currentSearchTerm = '';
    let openModalOrderId = null;

    // ==========================================
    // SECURITY: XSS SANITIZATION & AUTH HELPERS
    // ==========================================
    function escapeHtml(unsafe) {
        if (unsafe === null || unsafe === undefined) return '';
        return String(unsafe)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getAuthKey() {
        return localStorage.getItem('dispatchpulse_api_key') || '';
    }

    function authHeaders() {
        const key = getAuthKey();
        const headers = { 'Content-Type': 'application/json' };
        if (key) {
            headers['x-api-key'] = key;
        }
        return headers;
    }

    // View Titles & Subtitles mapping
    const viewMeta = {
        dispatchView: { title: "Dispatch Control Center", subtitle: "AI Pre-Delivery Automated Voice Verification Engine" },
        fleetView: { title: "Active Rider Fleet Operations", subtitle: "Real-time rider assignments & delivery performance telemetry" },
        analyticsView: { title: "Delivery Intelligence Analytics", subtitle: "Aggregated call verification outcomes & confirmation metrics" },
        settingsView: { title: "Engine Configuration & Server Sync", subtitle: "Configure CALL-E AI voice prompt persona, timeouts & endpoints" }
    };

    // Navigation View Switcher
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const targetViewId = item.dataset.view;
            if (!targetViewId) return;

            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.view-panel').forEach(panel => {
                panel.classList.remove('active');
                panel.classList.add('hidden');
            });

            const targetPanel = document.getElementById(targetViewId);
            if (targetPanel) {
                targetPanel.classList.remove('hidden');
                targetPanel.classList.add('active');
            }

            if (viewMeta[targetViewId]) {
                viewTitle.textContent = viewMeta[targetViewId].title;
                viewSubtitle.textContent = viewMeta[targetViewId].subtitle;
            }

            // Load view data
            if (targetViewId === 'fleetView') fetchRidersData();
            if (targetViewId === 'analyticsView') fetchAnalyticsData();
            if (targetViewId === 'settingsView') fetchSettingsData();
        });
    });

    // Fetch existing order history on load
    fetch('/api/history', { headers: authHeaders() })
        .then(res => res.json())
        .then(history => {
            if (Array.isArray(history)) {
                history.forEach(data => updateOrderData(data));
                renderTable();
            }
        })
        .catch(err => console.error('Failed to load history:', err));

    // Handle Quick Scenario Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id || `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
            const orderInput = document.getElementById('orderId');
            const phoneInput = document.getElementById('customerPhone');
            const addrInput = document.getElementById('address');
            if (orderInput) orderInput.value = id;
            if (phoneInput) phoneInput.value = btn.dataset.phone || '';
            if (addrInput) addrInput.value = btn.dataset.address || '';
        });
    });

    // Filter Tabs Handler
    document.querySelectorAll('.tab-btn').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderTable();
        });
    });

    // Search Input Handler
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchTerm = e.target.value.toLowerCase().trim();
            renderTable();
        });
    }

    // Close Modal Events
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    window.addEventListener('click', (e) => {
        if (e.target === transcriptModal) closeModal();
    });

    function closeModal() {
        transcriptModal.classList.add('hidden');
        openModalOrderId = null;
    }

    // Listen for Server-Sent Events (SSE) via authenticated session cookie (no query string token)
    let eventSource = null;

    async function startSSE() {
        if (eventSource) {
            eventSource.close();
        }

        const key = getAuthKey();
        if (key) {
            try {
                await fetch('/api/auth/session', {
                    method: 'POST',
                    headers: authHeaders()
                });
            } catch (err) {
                console.error('Failed to establish SSE session cookie:', err);
            }
        }

        eventSource = new EventSource('/api/events');

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                updateOrderData(data);
                renderTable();

                // Refresh views if open
                if (document.getElementById('fleetView')?.classList.contains('active')) fetchRidersData();
                if (document.getElementById('analyticsView')?.classList.contains('active')) fetchAnalyticsData();

                // If modal is currently open for this order, re-render modal
                if (openModalOrderId === data.orderId) {
                    const updatedData = activeOrders.get(data.orderId);
                    if (updatedData) openTranscriptModal(updatedData);
                }
            } catch (e) {
                console.error('Failed to parse SSE payload:', e);
            }
        };
    }

    startSSE();

    dispatchForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const orderId = document.getElementById('orderId').value.trim();
        const customerPhone = document.getElementById('customerPhone').value.trim();
        const address = document.getElementById('address').value.trim();
        const liveConfirmed = Boolean(document.getElementById('liveConfirmed')?.checked);
        const submitBtn = dispatchForm.querySelector('button');

        updateOrderData({
            orderId,
            status: liveConfirmed ? '🟡 Dialing Recipient (Live)...' : '🟡 Dialing Recipient (Dry Run)...',
            details: liveConfirmed ? 'Initiating real CALL-E voice agent...' : 'Initiating simulated verification...',
            address,
            phone: customerPhone,
            transcript: []
        });
        renderTable();

        try {
            submitBtn.disabled = true;
            submitBtn.textContent = '📞 Dispatching...';

            const response = await fetch('/api/dispatch', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ orderId, customerPhone, address, liveConfirmed })
            });

            const resData = await response.json();

            if (!response.ok) {
                throw new Error(resData.message || resData.error || 'Failed to trigger call');
            }

            dispatchForm.reset();
            setTimeout(() => {
                submitBtn.disabled = false;
                submitBtn.textContent = '📞 Dispatch CALL-E Agent';
            }, 1000);

        } catch (error) {
            console.error(error);
            updateOrderData({
                orderId,
                status: '🔴 Dispatch Error',
                details: error.message
            });
            renderTable();
            submitBtn.disabled = false;
            submitBtn.textContent = '📞 Dispatch CALL-E Agent';
            alert(`Dispatch Notice: ${error.message}`);
        }
    });

    function updateOrderData(data) {
        if (!data || !data.orderId) return;
        const existing = activeOrders.get(data.orderId) || {};
        activeOrders.set(data.orderId, { ...existing, ...data });
        updateStats();
    }

    function updateStats() {
        let total = activeOrders.size;
        let confirmed = 0;
        let rescheduled = 0;

        activeOrders.forEach(ord => {
            const st = (ord.status || '').toLowerCase();
            if (st.includes('confirmed') || st.includes('dispatched')) confirmed++;
            else if (st.includes('reschedule') || st.includes('failed')) rescheduled++;
        });

        if (dispatchedCallsStat) dispatchedCallsStat.textContent = total;
        if (confirmedStat) confirmedStat.textContent = confirmed;
        if (rescheduledStat) rescheduledStat.textContent = rescheduled;
    }

    function renderTable() {
        deliveriesBody.innerHTML = '';
        let ordersArray = Array.from(activeOrders.values());

        // Apply Status Filter
        if (currentFilter === 'confirmed') {
            ordersArray = ordersArray.filter(o => (o.status || '').toLowerCase().includes('confirmed'));
        } else if (currentFilter === 'active') {
            ordersArray = ordersArray.filter(o => (o.status || '').toLowerCase().includes('live') || (o.status || '').toLowerCase().includes('dialing'));
        } else if (currentFilter === 'rescheduled') {
            ordersArray = ordersArray.filter(o => (o.status || '').toLowerCase().includes('reschedule') || (o.status || '').toLowerCase().includes('failed'));
        }

        // Apply Search Filter
        if (currentSearchTerm) {
            ordersArray = ordersArray.filter(o =>
                (o.orderId || '').toLowerCase().includes(currentSearchTerm) ||
                (o.phone || '').toLowerCase().includes(currentSearchTerm) ||
                (o.address || '').toLowerCase().includes(currentSearchTerm) ||
                (o.details || '').toLowerCase().includes(currentSearchTerm)
            );
        }

        if (ordersArray.length === 0) {
            deliveriesBody.innerHTML = `
                <tr class="empty-state">
                    <td colspan="5">No orders match the selected filter criteria. Trigger a call above to get started.</td>
                </tr>
            `;
            return;
        }

        ordersArray.reverse().forEach(currentData => {
            const row = document.createElement('tr');
            row.id = `row-${escapeHtml(currentData.orderId)}`;

            let riderHtml = '<span style="color:#8EA495; font-style:italic;">Unassigned</span>';
            if (currentData.rider) {
                riderHtml = `
                    <div class="rider-pill">
                        <div class="rider-name">${escapeHtml(currentData.rider.name)}</div>
                        <div class="rider-bike">🏍 ${escapeHtml(currentData.rider.bike)}</div>
                    </div>
                `;
            }

            let detailsHtml = `<div><strong>${escapeHtml(currentData.details || 'Processing call...')}</strong></div>`;
            if (currentData.summary) {
                detailsHtml += `<div class="summary-text"><em>${escapeHtml(currentData.summary)}</em></div>`;
            }

            row.innerHTML = `
                <td><strong>${escapeHtml(currentData.orderId)}</strong></td>
                <td><span class="status-badge">${escapeHtml(currentData.status)}</span></td>
                <td class="details-cell">${detailsHtml}</td>
                <td>${riderHtml}</td>
                <td>
                    <button type="button" class="view-transcript-btn" data-id="${escapeHtml(currentData.orderId)}">View Call Log</button>
                </td>
            `;

            const btn = row.querySelector('.view-transcript-btn');
            btn.addEventListener('click', () => {
                openModalOrderId = currentData.orderId;
                openTranscriptModal(currentData);
            });

            deliveriesBody.appendChild(row);
        });
    }

    function openTranscriptModal(data) {
        // Customer Turns
        const customerTurns = Array.isArray(data.customerTranscript) && data.customerTranscript.length > 0
            ? data.customerTranscript
            : (Array.isArray(data.transcript) ? data.transcript.filter(t => t.speaker === 'Customer' || (t.speaker === 'AI Assistant' && !data.riderTranscript)) : []);

        let customerTranscriptHtml = '';
        if (customerTurns.length > 0) {
            customerTranscriptHtml = customerTurns.map(turn => `
                <div class="chat-bubble ${turn.speaker === 'AI Assistant' ? 'ai-bubble' : 'user-bubble'}">
                    <div class="bubble-speaker">${escapeHtml(turn.speaker)}</div>
                    <div class="bubble-text">${escapeHtml(turn.text)}</div>
                </div>
            `).join('');
        } else {
            customerTranscriptHtml = `<div style="color:#8EA495; font-style:italic; padding:0.8rem; text-align:center;">Dialing customer... Dialogue turns will stream live as call progresses.</div>`;
        }

        // Rider Turns
        const riderTurns = Array.isArray(data.riderTranscript) ? data.riderTranscript : [];

        let riderTranscriptHtml = '';
        if (riderTurns.length > 0) {
            riderTranscriptHtml = riderTurns.map(turn => `
                <div class="chat-bubble ${turn.speaker === 'AI Assistant' ? 'ai-bubble' : 'rider-bubble'}">
                    <div class="bubble-speaker">${escapeHtml(turn.speaker)}</div>
                    <div class="bubble-text">${escapeHtml(turn.text)}</div>
                </div>
            `).join('');
        } else {
            if (data.stage === 'customer_call' || (data.status || '').includes('Stage 1')) {
                riderTranscriptHtml = `<div style="color:#8EA495; font-style:italic; padding:0.8rem; text-align:center;">Waiting for Customer call completion. Rider call will be placed automatically next.</div>`;
            } else if ((data.status || '').includes('Calling Rider') || (data.status || '').includes('Stage 2')) {
                riderTranscriptHtml = `<div style="color:#8EA495; font-style:italic; padding:0.8rem; text-align:center;">Calling rider... Briefing turns will stream live as soon as rider picks up.</div>`;
            } else {
                riderTranscriptHtml = `<div style="color:#8EA495; font-style:italic; padding:0.8rem; text-align:center;">Rider briefing call pending.</div>`;
            }
        }

        modalBody.innerHTML = `
            <div class="modal-info-grid">
                <div><strong>Order ID:</strong> ${escapeHtml(data.orderId)}</div>
                <div><strong>Customer Phone:</strong> ${escapeHtml(data.phone || 'N/A')}</div>
                <div><strong>Delivery Address:</strong> ${escapeHtml(data.address || 'N/A')}</div>
                <div><strong>Assigned Rider:</strong> ${data.rider ? `${escapeHtml(data.rider.name)} (${escapeHtml(data.rider.phone)})` : 'Unassigned'}</div>
                <div style="grid-column: span 2;"><strong>Current Status:</strong> <span class="status-badge">${escapeHtml(data.status)}</span></div>
            </div>

            <!-- Stage 1 Banner -->
            <div class="stage-banner">
                <div class="stage-header-title">
                    <span>📞 Stage 1: Customer Voice Verification Call</span>
                    <span style="font-size:0.78rem; font-weight:600; color:#38bdf8;">Target: ${escapeHtml(data.phone || 'Customer')}</span>
                </div>
                ${data.customerSummary || data.summary ? `<div class="modal-summary-box" style="margin-bottom:0.8rem;"><strong>🤖 Customer Call Summary:</strong> ${escapeHtml(data.customerSummary || data.summary)}</div>` : ''}
                <div class="transcript-chat-container">
                    ${customerTranscriptHtml}
                </div>
            </div>

            <!-- Stage 2 Banner -->
            <div class="stage-banner">
                <div class="stage-header-title">
                    <span style="color:#00C087;">🏍️ Stage 2: Rider Briefing & Instructions Call</span>
                    <span style="font-size:0.78rem; font-weight:600; color:#00C087;">Rider: ${escapeHtml(data.rider?.name || 'Assigned Rider')}</span>
                </div>
                ${data.riderSummary ? `<div class="modal-summary-box" style="margin-bottom:0.8rem; background:rgba(0,192,135,0.15); border-left-color:#00C087;"><strong>🏍️ Rider Briefing Summary:</strong> ${escapeHtml(data.riderSummary)}</div>` : ''}
                <div class="transcript-chat-container">
                    ${riderTranscriptHtml}
                </div>
            </div>

            ${data.rawResult ? `
                <div style="margin-top: 1rem;">
                    <details>
                        <summary style="cursor:pointer; color:#8EA495; font-size:0.85rem; font-weight:600; outline:none;">View Structured Extraction Payload (JSON)</summary>
                        <pre style="background:rgba(0,0,0,0.5); padding:0.8rem; border-radius:8px; font-size:0.8rem; margin-top:0.5rem; overflow-x:auto; color:#38bdf8;">${escapeHtml(JSON.stringify(data.rawResult, null, 2))}</pre>
                    </details>
                </div>
            ` : ''}
        `;

        transcriptModal.classList.remove('hidden');
    }

    // Active Fleet View Data Fetching
    function fetchRidersData() {
        fetch('/api/riders', { headers: authHeaders() })
            .then(res => res.json())
            .then(riders => {
                if (!Array.isArray(riders) || !fleetGrid) return;

                if (activeRidersStat) activeRidersStat.textContent = riders.length;
                if (sidebarRiderCount) sidebarRiderCount.textContent = riders.length;

                fleetGrid.innerHTML = riders.map(r => `
                    <div class="rider-card">
                        <div class="rider-card-header">
                            <div>
                                <div class="rider-card-name">${escapeHtml(r.name)}</div>
                                <div class="rider-card-bike">🏍 ${escapeHtml(r.bike)}</div>
                            </div>
                            <span class="rider-badge online">${escapeHtml(r.status)}</span>
                        </div>
                        <div class="rider-metrics-row">
                            <div class="rider-metric-item">
                                <span class="rider-metric-val">${escapeHtml(r.totalDispatched)}</span>
                                <span class="rider-metric-lbl">Dispatches</span>
                            </div>
                            <div class="rider-metric-item">
                                <span class="rider-metric-val" style="color:#00C087;">${escapeHtml(r.confirmedCount)}</span>
                                <span class="rider-metric-lbl">Delivered</span>
                            </div>
                            <div class="rider-metric-item">
                                <span class="rider-metric-val" style="color:#38bdf8;">${escapeHtml(r.successRate)}%</span>
                                <span class="rider-metric-lbl">Success Rate</span>
                            </div>
                        </div>
                        <div style="font-size:0.8rem; color:#8EA495; display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(0,192,135,0.1); padding-top:0.6rem;">
                            <span>Phone: ${escapeHtml(r.phone)}</span>
                            <span style="color:#00C087;">● Active on Route</span>
                        </div>
                    </div>
                `).join('');
            })
            .catch(err => console.error('Failed to load riders:', err));
    }

    // Analytics View Data Fetching
    function fetchAnalyticsData() {
        fetch('/api/analytics', { headers: authHeaders() })
            .then(res => res.json())
            .then(data => {
                if (!data) return;

                const successRateEl = document.getElementById('analyticSuccessRate');
                const totalCallsEl = document.getElementById('analyticTotalCalls');
                const rescheduledEl = document.getElementById('analyticRescheduled');
                const avgDurationEl = document.getElementById('analyticAvgDuration');

                if (successRateEl) successRateEl.textContent = `${escapeHtml(data.confirmationRate)}%`;
                if (totalCallsEl) totalCallsEl.textContent = escapeHtml(data.totalCalls);
                if (rescheduledEl) rescheduledEl.textContent = escapeHtml(data.rescheduledCalls);
                if (avgDurationEl) avgDurationEl.textContent = `28s`;

                const total = data.totalCalls || 1;
                const outcomes = data.outcomes || {};

                const outcomeItems = [
                    { title: "Gate Pass Code Obtained", count: outcomes.gateCode || 0, color: "#00C087" },
                    { title: "Security Dropoff Confirmed", count: outcomes.securityDropoff || 0, color: "#38bdf8" },
                    { title: "Reschedule Requested", count: outcomes.rescheduled || 0, color: "#f87171" },
                    { title: "Recipient Away / Unavailable", count: outcomes.unavailable || 0, color: "#fbbf24" }
                ];

                if (analyticsOutcomesGrid) {
                    analyticsOutcomesGrid.innerHTML = outcomeItems.map(item => {
                        const pct = Math.round((item.count / total) * 100);
                        return `
                            <div class="outcome-card">
                                <div class="outcome-title">${escapeHtml(item.title)}</div>
                                <div class="outcome-count" style="color: ${escapeHtml(item.color)}">${escapeHtml(item.count)}</div>
                                <div class="progress-bar-bg">
                                    <div class="progress-bar-fill" style="width: ${pct}%; background: ${escapeHtml(item.color)};"></div>
                                </div>
                                <div style="font-size:0.78rem; color:#8EA495; margin-top:0.6rem; text-align:right;">${pct}% of total calls</div>
                            </div>
                        `;
                    }).join('');
                }
            })
            .catch(err => console.error('Failed to load analytics:', err));
    }

    // Engine Settings View Data Fetching & Save
    function fetchSettingsData() {
        fetch('/api/settings', { headers: authHeaders() })
            .then(res => res.json())
            .then(s => {
                if (!s) return;
                const toneEl = document.getElementById('settingTone');
                const mcpUrlEl = document.getElementById('settingMcpUrl');
                const maxPollsEl = document.getElementById('settingMaxPolls');
                const autoDispatchEl = document.getElementById('settingAutoDispatch');
                const telemetryEl = document.getElementById('settingTelemetry');

                const apiKeyEl = document.getElementById('settingApiKey');

                if (toneEl) toneEl.value = s.aiTone || 'Polite Nigerian Accent';
                if (mcpUrlEl) mcpUrlEl.value = s.mcpServerUrl || 'https://api.heycall-e.com';
                if (maxPollsEl) maxPollsEl.value = s.maxPolls || 35;
                if (autoDispatchEl) autoDispatchEl.checked = s.autoDispatch !== false;
                if (telemetryEl) telemetryEl.checked = s.telemetry !== false;
                if (apiKeyEl) apiKeyEl.value = getAuthKey();
            })
            .catch(err => console.error('Failed to load settings:', err));
    }

    if (settingsForm) {
        settingsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const apiKeyInput = document.getElementById('settingApiKey')?.value?.trim();
            if (apiKeyInput !== undefined) {
                localStorage.setItem('dispatchpulse_api_key', apiKeyInput);
            }

            const updated = {
                aiTone: document.getElementById('settingTone').value,
                mcpServerUrl: document.getElementById('settingMcpUrl').value,
                maxPolls: parseInt(document.getElementById('settingMaxPolls').value, 10),
                autoDispatch: document.getElementById('settingAutoDispatch').checked,
                telemetry: document.getElementById('settingTelemetry').checked
            };

            fetch('/api/settings', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(updated)
            })
            .then(res => {
                if (!res.ok) {
                    return res.json().then(d => { throw new Error(d.message || d.error); });
                }
                return res.json();
            })
            .then(data => {
                startSSE();
                alert('⚡ CALL-E Engine Settings Saved Successfully!');
            })
            .catch(err => {
                console.error('Failed to save settings:', err);
                alert(`Error saving settings: ${err.message}`);
            });
        });
    }

    if (testConnBtn) {
        testConnBtn.addEventListener('click', () => {
            testConnBtn.disabled = true;
            testConnBtn.textContent = '⚡ Testing...';
            fetch('/api/settings', { headers: authHeaders() })
                .then(res => {
                    if (res.ok) {
                        testConnBtn.textContent = '🟢 CALL-E Auth & Sync Verified!';
                    } else {
                        testConnBtn.textContent = '🔴 Auth Failed';
                    }
                    setTimeout(() => {
                        testConnBtn.disabled = false;
                        testConnBtn.textContent = '⚡ Test CALL-E Server Auth';
                    }, 2500);
                })
                .catch(() => {
                    testConnBtn.disabled = false;
                    testConnBtn.textContent = '🔴 Connection Error';
                    setTimeout(() => testConnBtn.textContent = '⚡ Test CALL-E Server Auth', 2500);
                });
        });
    }
});
