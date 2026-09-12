const LANGUAGE_TO_RECIPIENT = {
    English:  { region: "IN", locale: "en-IN", code: "+91" },
    Hindi:    { region: "IN", locale: "hi-IN", code: "+91" },
    Tamil:    { region: "IN", locale: "ta-IN", code: "+91" },
    German:   { region: "DE", locale: "de-DE", code: "+49" },
    Spanish:  { region: "ES", locale: "es-ES", code: "+34" },
    French:   { region: "FR", locale: "fr-FR", code: "+33" },
    Japanese: { region: "JP", locale: "ja-JP", code: "+81" }
};

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

    function updatePhonePrefix() {
        const selectedLang = targetLanguageDropdown.value;
        const config = LANGUAGE_TO_RECIPIENT[selectedLang];
        if (config) {
            const currentVal = targetPhoneInput.value.trim();
            const hasExistingCode = Object.values(LANGUAGE_TO_RECIPIENT).some(l => currentVal.startsWith(l.code));
            
            if (currentVal === "" || !hasExistingCode) {
                targetPhoneInput.value = config.code;
            } else {
                for (let lang in LANGUAGE_TO_RECIPIENT) {
                    if (currentVal.startsWith(LANGUAGE_TO_RECIPIENT[lang].code)) {
                        targetPhoneInput.value = currentVal.replace(LANGUAGE_TO_RECIPIENT[lang].code, config.code);
                        break;
                    }
                }
            }
        }
    }

    targetLanguageDropdown.addEventListener('change', updatePhonePrefix);

    if (newCallBtn) {
        newCallBtn.addEventListener('click', () => {
            mainMenuScreen.style.display = 'none';
            newCallScreen.style.display = 'block';
            statusLog.innerText = "";
            updatePhonePrefix();
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
                        <b>ID:</b> ${call.id} | <b>Status:</b> ${call.status || 'unknown'}<br>
                        <b>Lang:</b> ${call.language} | <b>Phone:</b> ${call.phone}<br>
                        <b>Task:</b> ${call.task}<br>
                        <span style="color: #888; font-size: 11px;">${call.time}</span>
                    </div>
                </div>
            </div>
        `).join('');

        historyList.querySelectorAll('.history-content').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.getAttribute('data-index'), 10);
                const currentHistory = JSON.parse(localStorage.getItem('co_runner_calls') || '[]');
                const call = currentHistory[idx];
                replyLogContent.innerText = call.reply || 'No reply captured for this call yet.';
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
            replyLogBox.style.display = 'none'; // reset on every open
            renderHistory();
        });
    }

    if (submitCallBtn) {
        // Polls GET /v1/calls/{id} until the call reaches a terminal state
        // (completed/failed/canceled) so we report what actually happened,
        // not just that the request was accepted.
        async function pollCallStatus(callId, onUpdate, { timeoutMs = 90000, intervalMs = 3000 } = {}) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, intervalMs));
                try {
                    const res = await fetch(`${CALLE_CONFIG.BASE_URL}/v1/calls/${callId}`, {
                        headers: { 'Authorization': `Bearer ${CALLE_CONFIG.API_KEY}` }
                    });
                    if (!res.ok) continue; // transient error, keep polling
                    const call = await res.json();
                    if (call.status === 'completed' || call.status === 'failed' || call.status === 'canceled') {
                        return call;
                    }
                    onUpdate(call.status);
                } catch (netErr) {
                    // Network hiccup mid-poll — don't kill the whole flow, just retry.
                }
            }
            return null; // timed out while still queued/in_progress
        }

        // Pulls a short, readable message out of whatever CALL-E's API returned.
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

            // Basic E.164 check (+ country code, 7-15 digits total) — catches
            // typos before they burn a call credit on a request that would
            // just get rejected server-side anyway.
            if (!/^\+[1-9]\d{6,14}$/.test(phoneValue)) {
                statusLog.style.color = "red";
                statusLog.innerText = "! Error: Enter a valid number";
                return;
            }

            const recipient = LANGUAGE_TO_RECIPIENT[selectedLanguage];
            if (!recipient) {
                statusLog.style.color = "red";
                statusLog.innerText = `! Error: ${selectedLanguage} isn't a CALL-E supported call language yet.`;
                return;
            }

            if (typeof CALLE_CONFIG === 'undefined' || !CALLE_CONFIG.API_KEY || !CALLE_CONFIG.BASE_URL) {
                statusLog.style.color = "red";
                statusLog.innerText = "! Error: config.js is missing your CALLE_CONFIG.API_KEY / BASE_URL.";
                return;
            }

            submitCallBtn.disabled = true;
            statusLog.style.color = "#555";
            statusLog.innerText = `Dialing AI agent in ${selectedLanguage}...`;

            let callRecord = null;

            try {
                // The call itself is conducted in the recipient's language
                // (that's the whole point). But we always want the evidence
                // reported back to *us* in English, so we say so explicitly
                // rather than relying on an undocumented default.
                const taskWithReportingInstruction =
                    `${promptValue} After the call, report your findings and evidence in English, regardless of the language the conversation was conducted in.`;

                const response = await fetch(`${CALLE_CONFIG.BASE_URL}/v1/calls`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${CALLE_CONFIG.API_KEY}`,
                        'Content-Type': 'application/json',
                        'Idempotency-Key': `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                    },
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
                    status: call.status // updated below once we know the real outcome
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
                    statusLog.innerText = `⏳ Still not resolved after 90s — check the CALL-E dashboard for ${call.id} (India may currently have regional restrictions in effect).`;
                } else if (finalCall.status === 'completed') {
                    // Real fields from CALL-E's API: task_completed (bool) and
                    // evidence (array of short strings) — there is no "summary" field.
                    const taskDone = finalCall.task_completed === true;
                    const evidenceText = Array.isArray(finalCall.evidence) && finalCall.evidence.length
                        ? finalCall.evidence.join(' ')
                        : 'Call finished — no evidence details returned.';
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
                statusLog.innerText = !err.message ? "! Error occurred." : `! Error: ${err.message}`;
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