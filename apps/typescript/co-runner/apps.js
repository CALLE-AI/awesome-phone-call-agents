const LANGUAGE_TO_RECIPIENT = {
    English:  { region: "IN", locale: "en-IN", code: "+91" },
    Hindi:    { region: "IN", locale: "hi-IN", code: "+91" },
    German:   { region: "DE", locale: "de-DE", code: "+49" },
    Spanish:  { region: "ES", locale: "es-ES", code: "+34" },
    French:   { region: "FR", locale: "fr-FR", code: "+33" },
    Japanese: { region: "JP", locale: "ja-JP", code: "+81" }
    // stuck at "queued" and never executed — treating it as unsupported in
    // practice until that's resolved on their end.
};

// Only this exact origin is ever sent the API key. If CALLE_CONFIG.BASE_URL
// in config.js is ever misconfigured, corrupted, or pointed somewhere else
// (accidentally or maliciously), requests are refused rather than silently
// leaking the Authorization header to an unapproved host.
const APPROVED_CALLE_BASE_URL = "https://api.heycall-e.com";

// --- Known limitations of this app (documented, not silently assumed) ---
// 1. Storage: call history lives in this browser's localStorage. That is
//    NOT encrypted and NOT a secure secret store — anyone with access to
//    this browser profile (or an XSS bug) can read it. Don't rely on it
//    for anything sensitive.
// 2. Language: selecting a locale tells CALL-E which language to *attempt*
//    on the call. It is not a guarantee the agent will speak flawlessly,
//    nor that the recipient will respond in kind — always check
//    `task_completed` rather than assuming success from language selection.
// 3. Cancellation: CALL-E's public API reference does not document an
//    endpoint to cancel/stop an in-progress call. There is no "hang up"
//    button in this app because there is nothing reliable to wire it to.
//    If a call needs to be stopped, that has to happen from CALL-E's own
//    dashboard, not from here.
// 4. Ambiguous outcomes: if a call is still queued/in_progress after 90s
//    of polling, this app STOPS polling and reports it as unresolved
//    rather than guessing or waiting indefinitely. That's a deliberate
//    stop, not a bug — check the CALL-E dashboard for the real outcome.
// 5. Not for high-stakes or urgent use: outcomes aren't guaranteed, calls
//    can fail or hang, and there is no cancellation path. Do not use this
//    for emergencies, time-critical, or high-stakes calls.

// Escapes text before it's ever inserted via innerHTML, so stored task
// text, phone numbers, IDs, or API-returned evidence can never be
// interpreted as HTML/script — even though today it's all same-origin data.
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Masks a phone number for display so a shared screenshot/recording of the
// history screen doesn't expose the full destination number.
function maskPhone(phone) {
    if (!phone || phone.length < 6) return phone || '';
    return phone.slice(0, 3) + '•'.repeat(Math.max(phone.length - 6, 3)) + phone.slice(-3);
}

// Same masking, but for free-form text (a typed task, or evidence text
// returned by CALL-E) where a phone number could appear anywhere in the
// string rather than in a dedicated field. HTML-escaping alone does NOT
// hide this — it only stops the text from being parsed as markup, it does
// nothing to the digits themselves.
function maskPhoneNumbersInText(text) {
    if (!text) return text;
    return String(text).replace(/\+\d{6,15}/g, (match) => maskPhone(match));
}

window.addEventListener('DOMContentLoaded', () => {
    const mainMenuScreen = document.getElementById('mainMenuScreen');
    const newCallScreen = document.getElementById('newCallScreen');
    const historyScreen = document.getElementById('historyScreen');

    const newCallBtn = document.getElementById('newCallBtn');
    const reviewCallBtn = document.getElementById('reviewCallBtn');
    const backBtn = document.getElementById('backBtn');
    const backFromHistoryBtn = document.getElementById('backFromHistoryBtn');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    const submitCallBtn = document.getElementById('submitCallBtn');
    
    const statusLog = document.getElementById('statusLog');
    const targetLanguageDropdown = document.getElementById('targetLanguage');
    const targetPhoneInput = document.getElementById('targetPhone');
    const englishPrompt = document.getElementById('englishPrompt');
    const historyList = document.getElementById('historyList');
    const phoneInfoBtn = document.getElementById('phoneInfoBtn');

    // Interactive popup alert explaining supported international country codes when clicking '!'
    if (phoneInfoBtn) {
        phoneInfoBtn.addEventListener('click', () => {
            window.alert("ℹ️ International Support Info:\n\nThis field supports global E.164 numbers including codes such as:\n• +91 (India)\n• +49 (Germany)\n• +34 (Spain)\n• +33 (France)\n• +81 (Japanese)\n\nType any valid destination number manually.");
        });
    }

    // Credential-free preview: if config.js is missing or still has
    // placeholder values, the UI still loads and is fully browsable —
    // only actually dialing requires real credentials.
    function isConfigReady() {
        return typeof CALLE_CONFIG !== 'undefined'
            && CALLE_CONFIG.API_KEY && !CALLE_CONFIG.API_KEY.startsWith('PASTE_')
            && CALLE_CONFIG.BASE_URL === APPROVED_CALLE_BASE_URL;
    }

    const previewBanner = document.getElementById('previewBanner');
    if (previewBanner && !isConfigReady()) {
        previewBanner.style.display = 'block';
    }

    if (newCallBtn) {
        newCallBtn.addEventListener('click', () => {
            mainMenuScreen.style.display = 'none';
            newCallScreen.style.display = 'block';
            statusLog.innerText = "";
            targetPhoneInput.value = ""; // Keep phone field clean for manual entry
        });
    }

    if (backBtn) {
        backBtn.addEventListener('click', () => {
            newCallScreen.style.display = 'none';
            mainMenuScreen.style.display = 'block';
        });
    }

    if (backFromHistoryBtn) {
        backFromHistoryBtn.addEventListener('click', () => {
            historyScreen.style.display = 'none';
            mainMenuScreen.style.display = 'block';
        });
    }

    document.querySelectorAll('.prompt-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            englishPrompt.value = chip.getAttribute('data-template');
        });
    });

    const replyLogBox = document.getElementById('replyLogBox');
    const replyLogContent = document.getElementById('replyLogContent');

    function renderHistory() {
        const history = JSON.parse(localStorage.getItem('co_runner_calls') || '[]');

        if (history.length === 0) {
            historyList.innerHTML = `<p style="color: gray; font-size: 13px; font-family: sans-serif;">No past calls recorded yet.</p>`;
            return;
        }

        historyList.innerHTML = history.map((call, index) => `
            <div class="history-item">
                <div style="display: flex; align-items: flex-start; gap: 8px;">
                    <input type="checkbox" class="history-checkbox" data-index="${index}" style="margin-top: 4px;">
                    <div class="history-content" data-index="${index}" style="cursor: pointer; flex: 1;">
                        <b>ID:</b> ${escapeHtml(call.id)} | <b>Status:</b> ${escapeHtml(call.status || 'unknown')}<br>
                        <b>Lang:</b> ${escapeHtml(call.language)} | <b>Phone:</b> ${escapeHtml(maskPhone(call.phone))}<br>
                        <b>Task:</b> ${escapeHtml(maskPhoneNumbersInText(call.task))}<br>
                        <span style="color: #888; font-size: 11px;">${escapeHtml(call.time)}</span>
                    </div>
                </div>
            </div>
        `).join('');

        historyList.querySelectorAll('.history-content').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.getAttribute('data-index'), 10);
                const currentHistory = JSON.parse(localStorage.getItem('co_runner_calls') || '[]');
                const call = currentHistory[idx];
                replyLogContent.textContent = maskPhoneNumbersInText(call.reply) || 'No reply captured for this call yet.';
                replyLogBox.style.display = 'block';
            });
        });
    }

    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', () => {
            const checked = Array.from(historyList.querySelectorAll('.history-checkbox:checked'));
            if (checked.length === 0) return;

            const confirmed = window.confirm(`Delete ${checked.length} selected call log(s)? This cannot be undone.`);
            if (!confirmed) return;

            const indicesToDelete = new Set(checked.map(cb => parseInt(cb.getAttribute('data-index'), 10)));
            const history = JSON.parse(localStorage.getItem('co_runner_calls') || '[]');
            const remaining = history.filter((_, idx) => !indicesToDelete.has(idx));
            localStorage.setItem('co_runner_calls', JSON.stringify(remaining));

            replyLogBox.style.display = 'none';
            renderHistory();
        });
    }

    if (reviewCallBtn) {
        reviewCallBtn.addEventListener('click', () => {
            mainMenuScreen.style.display = 'none';
            historyScreen.style.display = 'block';
            replyLogBox.style.display = 'none'; 
            renderHistory();
        });
    }

    if (submitCallBtn) {
        async function pollCallStatus(callId, onUpdate, { timeoutMs = 90000, intervalMs = 3000 } = {}) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, intervalMs));
                try {
                    if (CALLE_CONFIG.BASE_URL !== APPROVED_CALLE_BASE_URL) {
                        onUpdate('blocked: BASE_URL is not the approved CALL-E host');
                        return null;
                    }
                    const res = await fetch(`${APPROVED_CALLE_BASE_URL}/v1/calls/${encodeURIComponent(callId)}`, {
                        headers: { 'Authorization': `Bearer ${CALLE_CONFIG.API_KEY}` },
                        redirect: 'error'
                    });
                    if (!res.ok) continue; 
                    const call = await res.json();
                    if (call.status === 'completed' || call.status === 'failed' || call.status === 'canceled') {
                        return call;
                    }
                    onUpdate(call.status);
                } catch (netErr) {
                    // Network hiccup mid-poll — retry
                }
            }
            return null; 
        }

        function extractErrorMessage(rawText) {
            try {
                const parsed = JSON.parse(rawText);
                return parsed.error?.message || parsed.message || rawText;
            } catch (_) {
                return rawText;
            }
        }

        submitCallBtn.addEventListener('click', async () => {
            const selectedLanguage = targetLanguageDropdown.value;
            const phoneValue = targetPhoneInput.value.trim();
            const promptValue = englishPrompt.value.trim();

            if (!phoneValue || !promptValue) {
                statusLog.style.color = "red";
                statusLog.innerText = "! Error: Complete all fields.";
                return;
            }

            // Basic E.164 check (+ country code, 7-15 digits total)
            if (!/^\+[1-9]\d{6,14}$/.test(phoneValue)) {
                statusLog.style.color = "red";
                statusLog.innerText = "! Error: Enter a valid number in E.164 format, e.g. +15551234567.";
                return;
            }

            const recipient = LANGUAGE_TO_RECIPIENT[selectedLanguage];
            if (!recipient) {
                statusLog.style.color = "red";
                statusLog.innerText = `! Error: ${selectedLanguage} isn't a CALL-E supported call language yet.`;
                return;
            }

            if (!isConfigReady()) {
                statusLog.style.color = "red";
                statusLog.innerText = typeof CALLE_CONFIG === 'undefined'
                    ? "! Error: config.js is missing. Copy config.example.js to config.js and add your real API key."
                    : "! Error: config.js still has a placeholder key/URL — add your real CALLE_CONFIG.API_KEY.";
                return;
            }

            const authorized = window.confirm(
                `You're about to call ${maskPhone(phoneValue)} in ${selectedLanguage}. This will use one CALL-E credit. Continue?`
            );
            if (!authorized) return;

            submitCallBtn.disabled = true;
            statusLog.style.color = "#555";
            statusLog.innerText = `Dialing AI agent in ${selectedLanguage}...`;

            let callRecord = null;

            try {
                const taskWithReportingInstruction =
                    `${promptValue} After the call, report your findings and evidence in English, regardless of the language the conversation was conducted in.`;

                const response = await fetch(`${APPROVED_CALLE_BASE_URL}/v1/calls`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${CALLE_CONFIG.API_KEY}`,
                        'Content-Type': 'application/json',
                        'Idempotency-Key': `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                    },
                    redirect: 'error',
                    body: JSON.stringify({
                        task: taskWithReportingInstruction,
                        recipients: [
                            {
                                phones: [phoneValue],
                                region: recipient.region,
                                locale: recipient.locale
                            }
                        ],
                        metadata: { source: "co-runner-web" }
                    })
                });

                if (!response.ok) throw new Error(extractErrorMessage(await response.text()));
                const call = await response.json();

                callRecord = {
                    id: call.id,
                    phone: phoneValue,
                    language: selectedLanguage,
                    task: promptValue,
                    time: new Date().toLocaleString(),
                    status: call.status 
                };

                statusLog.style.color = "#555";
                statusLog.innerText = `📞 Call created (id: ${call.id}) — status: ${call.status}. Waiting to see if it connects...`;

                const finalCall = await pollCallStatus(call.id, (status) => {
                    statusLog.innerText = `📞 Call ${call.id} — status: ${status}...`;
                });

                if (!finalCall) {
                    callRecord.status = "still queued (check dashboard)";
                    callRecord.reply = "Call did not finish in time — no reply captured yet. Check the CALL-E dashboard for this call ID.";
                    statusLog.style.color = "orange";
                    statusLog.innerText = `⏳ Still not resolved after 90s — check the CALL-E dashboard for ${call.id}.`;
                } else if (finalCall.status === 'completed') {
                    const taskDone = finalCall.task_completed === true;
                    const rawEvidence = Array.isArray(finalCall.evidence) && finalCall.evidence.length
                        ? finalCall.evidence.join(' ')
                        : 'Call finished — no evidence details returned.';
                    const evidenceText = maskPhoneNumbersInText(rawEvidence);
                    callRecord.status = taskDone ? "completed (task done)" : "completed (task unconfirmed)";
                    callRecord.reply = evidenceText;
                    statusLog.style.color = taskDone ? "green" : "orange";
                    statusLog.innerText = `${taskDone ? '✅' : '⚠️'} Call completed. ${evidenceText}`;
                } else {
                    callRecord.status = finalCall.status;
                    callRecord.reply = `Call ended with status: ${finalCall.status}. No business reply was captured.`;
                    statusLog.style.color = "red";
                    statusLog.innerText = `! Call ended with status: ${finalCall.status}.`;
                }
            } catch (err) {
                statusLog.style.color = "red";
                statusLog.innerText = !err.message ? "! Error occurred." : `! Error: ${maskPhoneNumbersInText(err.message)}`;
            } finally {
                if (callRecord) {
                    const history = JSON.parse(localStorage.getItem('co_runner_calls') || '[]');
                    history.unshift(callRecord);
                    localStorage.setItem('co_runner_calls', JSON.stringify(history));
                }
                submitCallBtn.disabled = false;
            }
        });
    }
});
