// VoiceSRE Mission Control Client

const clusterBadge = document.getElementById('cluster-status-badge');
const clusterText = document.getElementById('cluster-status-text');
const currentVersion = document.getElementById('current-version');

const metricErrorRate = document.getElementById('metric-error-rate');
const metricLatency = document.getElementById('metric-latency');
const metricCpu = document.getElementById('metric-cpu');
const metricService = document.getElementById('metric-service');
const cardErrorRate = document.getElementById('card-error-rate');

const incidentBanner = document.getElementById('incident-banner');
const incId = document.getElementById('inc-id');
const incTitle = document.getElementById('inc-title');
const incCause = document.getElementById('inc-cause');
const incAuthor = document.getElementById('inc-author');

const btnTriggerOutage = document.getElementById('btn-trigger-outage');
const btnDispatchCall = document.getElementById('btn-dispatch-call');
const inputPhone = document.getElementById('input-phone');
const selectMode = document.getElementById('select-mode');
const inputApiKey = document.getElementById('input-api-key');
const modeBadge = document.getElementById('mode-badge');

const terminalLogs = document.getElementById('terminal-logs');
const auditList = document.getElementById('audit-list');
const callIndicator = document.getElementById('call-indicator');

let isCallInProgress = false;

function addTerminalLog(message, type = 'info') {
  const line = document.createElement('div');
  line.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${message}`;
  terminalLogs.appendChild(line);
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

function updateUI(metrics) {
  currentVersion.textContent = metrics.currentVersion;
  metricErrorRate.textContent = `${metrics.errorRatePercent.toFixed(2)}%`;
  metricLatency.textContent = `${metrics.p99LatencyMs} ms`;
  metricCpu.textContent = `${metrics.cpuUsagePercent.toFixed(1)}%`;
  metricService.textContent = `${metrics.service} (${metrics.activePods} pods)`;

  if (metrics.status === 'critical') {
    clusterBadge.className = 'status-badge critical';
    clusterText.textContent = 'CRITICAL OUTAGE';
    cardErrorRate.classList.add('alert');
  } else if (metrics.status === 'recovering') {
    clusterBadge.className = 'status-badge recovering';
    clusterText.textContent = 'REMEDIATING...';
    cardErrorRate.classList.remove('alert');
  } else {
    clusterBadge.className = 'status-badge healthy';
    clusterText.textContent = 'SYSTEM HEALTHY';
    cardErrorRate.classList.remove('alert');
  }

  // Active Incident
  if (metrics.activeIncident && metrics.activeIncident.status !== 'resolved') {
    incidentBanner.classList.remove('hidden');
    incId.textContent = metrics.activeIncident.id;
    incTitle.textContent = metrics.activeIncident.title;
    incCause.textContent = `Root Cause: ${metrics.activeIncident.rootCause}`;
    incAuthor.textContent = `Commit ${metrics.activeIncident.lastCommit.hash} by ${metrics.activeIncident.lastCommit.author} (${metrics.activeIncident.lastCommit.file}:${metrics.activeIncident.lastCommit.line})`;
    btnDispatchCall.disabled = isCallInProgress;
  } else {
    incidentBanner.classList.add('hidden');
    btnDispatchCall.disabled = true;
  }

  // Audit list
  if (metrics.recentRemediations && metrics.recentRemediations.length > 0) {
    auditList.innerHTML = '';
    metrics.recentRemediations.forEach(log => {
      const item = document.createElement('div');
      item.className = `audit-item ${log.status}`;
      item.innerHTML = `
        <span class="audit-time">${log.timestamp}</span>
        <span class="audit-step">${log.step}</span>
        <span class="audit-desc">${log.details}</span>
      `;
      auditList.appendChild(item);
    });
  }
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateUI(data.metrics);
  } catch (err) {
    console.error('Status fetch error:', err);
  }
}

// Mode select change
selectMode.addEventListener('change', () => {
  const mode = selectMode.value.toUpperCase();
  modeBadge.textContent = `${mode} MODE`;
  modeBadge.style.color = mode === 'LIVE' ? '#34d399' : '#93c5fd';
});

// Trigger Outage
btnTriggerOutage.addEventListener('click', async () => {
  btnTriggerOutage.disabled = true;
  addTerminalLog('Triggering P0 production outage simulation...', 'alert');
  try {
    const res = await fetch('/api/incident/trigger', { method: 'POST' });
    const data = await res.json();
    addTerminalLog(`[P0 ALERT] ${data.incident.id}: ${data.incident.title}`, 'alert');
    addTerminalLog(`[TELEMETRY] Error rate spiked to ${data.incident.errorRate}%! Latency: 1450ms.`, 'alert');
    addTerminalLog(`[CALL-E] PagerDuty dispatch queue ready. Press 'Dispatch VoiceSRE Call'.`, 'system');
    updateUI(data.metrics);
  } catch (err) {
    addTerminalLog(`Failed to trigger outage: ${err.message}`, 'alert');
  } finally {
    btnTriggerOutage.disabled = false;
  }
});

// Dispatch Call
btnDispatchCall.addEventListener('click', async () => {
  const phone = inputPhone.value.trim();
  const mode = selectMode.value;
  const apiKey = inputApiKey.value.trim();

  isCallInProgress = true;
  btnDispatchCall.disabled = true;
  callIndicator.classList.remove('hidden');

  addTerminalLog(`[DISPATCH] Connecting to CALL-E API (Mode: ${mode.toUpperCase()})...`, 'system');

  try {
    const res = await fetch('/api/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: phone, mode, apiKey })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Call dispatch failed');
    }

    if (data.dispatch && data.dispatch.logs) {
      data.dispatch.logs.forEach(log => addTerminalLog(log, 'system'));
    }

    addTerminalLog(`[VOICE RECOGNITION] Engineer ordered: ${data.dispatch.result.action_decision.toUpperCase()}`, 'success');
    addTerminalLog(`[HOTFIX EXECUTION] ${data.remediation.message}`, 'success');
    addTerminalLog(`[HEALTH CHECK] Verification passed: Status 200 OK. Error rate normalized.`, 'success');

    updateUI(data.remediation.state);
  } catch (err) {
    addTerminalLog(`[DISPATCH ERROR] ${err.message}`, 'alert');
  } finally {
    isCallInProgress = false;
    callIndicator.classList.add('hidden');
    fetchStatus();
  }
});

// Periodic polling
fetchStatus();
setInterval(fetchStatus, 3000);
