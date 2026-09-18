function timeAgo(dateString) {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return Math.floor(seconds) + " sec ago";
    if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + " hours ago";
    return Math.floor(seconds / 86400) + " days ago";
}

function maskPhone(phone) {
    if (!phone) return "";
    return phone.replace(/(\+\d{2})(\d{2})\d{5}(\d{3})/, "$1 $2•• ••• $3");
}

function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

const contactId = getQueryParam("id");

let contact = null;
let logs = [];
let trend = null;

async function fetchData() {
    if (!contactId) return document.getElementById("contact-header").innerHTML = "<h1>Contact not found</h1>";

    try {
        const [contactsRes, logsRes, trendRes] = await Promise.all([
            fetch("/api/contacts"),
            fetch("/api/logs"),
            fetch(`/api/trend/${contactId}`)
        ]);
        
        const allContacts = await contactsRes.json();
        contact = allContacts.find(c => c.id === contactId);
        const allLogs = await logsRes.json();
        logs = allLogs.filter(l => l.contactId === contactId);
        trend = await trendRes.json();
        
        render();
    } catch (e) {
        console.error("Error fetching data", e);
    }
}

function render() {
    if (!contact) return;
    
    // Header
    document.getElementById("contact-header").innerHTML = `
        <h1>${contact.name}</h1>
        <p>${maskPhone(contact.phone)} <span style="margin:0 8px; opacity:0.5;">|</span> ${contact.timezone}</p>
    `;
    
    const lastLog = logs[0];
    
    // Overview - Latest Check-in
    let latestHtml = "<p>Still waiting for first check-in.</p>";
    if (lastLog) {
        const level = lastLog.concern_level || "none";
        let checksHtml = "";
        if (lastLog.checks) {
            const medStr = lastLog.checks.medication_taken === "yes" ? "✅" : (lastLog.checks.medication_taken === "no" ? "❌" : "—");
            const ateStr = lastLog.checks.eaten_today === "yes" ? "✅" : (lastLog.checks.eaten_today === "no" ? "❌" : "—");
            checksHtml = `
            <div class="checks-row" style="margin-bottom:0;">
                <div class="check-item"><span>💊</span> Meds ${medStr}</div>
                <div class="check-item"><span>🥣</span> Ate ${ateStr}</div>
            </div>`;
        } else if (lastLog.status === "failed") {
            checksHtml = `<div class="checks-row" style="margin-bottom:0; font-style:italic; opacity:0.7;">No data — call unreachable</div>`;
        }
        
        latestHtml = `
            <div class="log-card-header">
                <div style="color:var(--text-muted); font-size:14px;">${new Date(lastLog.timestamp).toLocaleString()} <span style="margin-left:8px; font-size:12px;">(${timeAgo(lastLog.timestamp)})</span></div>
                <div class="log-badge ${level}">${level === 'none' ? '✅' : '⚠️'} ${level.toUpperCase()}</div>
            </div>
            <div style="margin-bottom:16px;">
                ${lastLog.concern_reason ? `<div style="color:var(--danger); font-weight:600; margin-bottom:8px;">⚠️ ${lastLog.concern_reason}</div>` : ""}
                ${lastLog.wellbeing_summary || `Status: ${lastLog.status}`}
            </div>
            ${checksHtml}
        `;
    }
    document.getElementById("latest-log-content").innerHTML = latestHtml;

    // Overview - Quick Stats
    const totalCalls = logs.length;
    const highConcerns = logs.filter(l => l.concern_level === "high").length;
    document.getElementById("quick-stats-content").innerHTML = `
        <div style="margin-bottom:12px;"><strong style="font-size:24px;">${totalCalls}</strong><br><span style="color:var(--text-muted); font-size:14px;">Total Check-ins</span></div>
        <div><strong style="font-size:24px; color:${highConcerns>0?"var(--danger)":"#111"};">${highConcerns}</strong><br><span style="color:var(--text-muted); font-size:14px;">High Concern Alerts</span></div>
    `;

    // History Tab
    let historyHtml = "";
    logs.forEach(log => {
        const level = log.concern_level || "none";
        let checksStr = "";
        if (log.checks) {
            const m = log.checks.medication_taken === "yes" ? "✅" : (log.checks.medication_taken === "no" ? "❌" : "—");
            const a = log.checks.eaten_today === "yes" ? "✅" : (log.checks.eaten_today === "no" ? "❌" : "—");
            checksStr = `<div style="font-size:13px; color:var(--text-muted); margin-top:8px;">💊 ${m} &nbsp;&nbsp; 🥣 ${a}</div>`;
        } else if (log.status === "failed") {
            checksStr = `<div style="font-size:13px; color:var(--text-muted); margin-top:8px; font-style:italic;">No data — call unreachable</div>`;
        }
        
        historyHtml += `
            <div class="log-card">
                <div class="log-card-header">
                    <div style="font-weight:600;">${new Date(log.timestamp).toLocaleString()}</div>
                    <div class="log-badge ${level}">${level === 'none' ? '✅' : '⚠️'} ${level.toUpperCase()}</div>
                </div>
                <div>${log.wellbeing_summary || log.status}</div>
                ${log.concern_reason ? `<div style="color:var(--danger); font-size:13px; margin-top:4px;">⚠️ ${log.concern_reason}</div>` : ""}
                ${checksStr}
            </div>
        `;
    });
    document.getElementById("full-history-list").innerHTML = historyHtml || "<p>No check-ins yet.</p>";

    // Trends Tab
    let trendsHtml = "";
    if (trend && trend.lines) {
        trend.lines.forEach((line, index) => {
            let icon = "📌";
            if (line.toLowerCase().includes("medication")) icon = "💊";
            else if (line.toLowerCase().includes("concern")) icon = index === 0 && trend.hasHighStreak ? "⚠️" : "✅";
            
            trendsHtml += `
                <div class="trend-item ${index === 0 && trend.hasHighStreak ? "highlight" : ""}">
                    <div class="trend-icon">${icon}</div>
                    <div>${line}</div>
                </div>
            `;
        });
    }
    document.getElementById("trends-content").innerHTML = trendsHtml || "<p>Not enough data for trends.</p>";
}

window.switchTab = function(tabName) {
    document.querySelectorAll(".tab").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
    
    document.getElementById(`tab-btn-${tabName}`).classList.add("active");
    document.getElementById(`tab-${tabName}`).classList.add("active");
}

fetchData();

window.toggleSidebar = function() {
    document.querySelector('.sidebar').classList.toggle('collapsed');
};

