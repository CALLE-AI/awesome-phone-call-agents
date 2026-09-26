function timeAgo(dateString) {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const seconds = Math.floor((new Date() - date) / 1000);
    
    let interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " min ago";
    return Math.floor(seconds) + " sec ago";
}

function maskPhone(phone) {
    if (!phone) return "";
    return phone.replace(/(\+\d{2})(\d{2})\d{5}(\d{3})/, '$1 $2.. ... $3');
}

let globalData = { contacts: [], logs: [], trend: null };

async function fetchAllData() {
    try {
        const [contactsRes, logsRes, trendRes] = await Promise.all([
            fetch('/api/contacts'),
            fetch('/api/logs'),
            fetch('/api/trend/1')
        ]);
        
        globalData.contacts = await contactsRes.json();
        globalData.logs = await logsRes.json();
        globalData.trend = await trendRes.json();
        
        renderAll();
    } catch (e) {
        console.error("Error fetching data", e);
    }
}

function renderAll() {
    renderHero();
    renderContacts();
    renderLogs();
    renderTrend();
}

function renderHero() {
    const todayLogs = globalData.logs.filter(l => {
        const d = new Date(l.timestamp);
        const today = new Date();
        return d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
    });
    
    const subtitle = document.getElementById('hero-subtitle');
    const uniquePeople = new Set(todayLogs.map(l => l.contactId)).size;
    
    const highConcerns = todayLogs.some(l => l.concern_level === 'high');
    const statusText = highConcerns ? "Attention needed for some check-ins." : "Everything looks okay so far.";
    
    subtitle.innerHTML = `<strong style="color:#111;">${uniquePeople} people checked in today</strong><br>${statusText}`;
}

function renderContacts() {
    const grid = document.getElementById('contacts-grid');
    grid.innerHTML = '';
    
    globalData.contacts.forEach(contact => {
        const contactLogs = globalData.logs.filter(l => l.contactId === contact.id);
        const lastLog = contactLogs[0];
        
        let statusStr = "No recent check-ins";
        let dotClass = "";
        let badgeClass = "badge-none";
        let badgeText = "No concerns";
        let checksRowHtml = '';
        let badgeIcon = '✅';
        
        if (lastLog) {
            statusStr = `Checked in ${timeAgo(lastLog.timestamp)}`;
            dotClass = "green";
            
            if (lastLog.concern_level === 'high') { badgeClass = "badge-high"; badgeText = "High concern"; badgeIcon = '⚠️'; }
            else if (lastLog.concern_level === 'low') { badgeClass = "badge-low"; badgeText = "Low concern"; badgeIcon = '⚠️'; }
            
            if (lastLog.checks) {
                const m = lastLog.checks.medication_taken === 'yes' ? '✅' : (lastLog.checks.medication_taken === 'no' ? '❌' : '?');
                const a = lastLog.checks.eaten_today === 'yes' ? '✅' : (lastLog.checks.eaten_today === 'no' ? '❌' : '?');
                checksRowHtml = `
                    <div class="checks-row">
                        <div class="check-item"><span>💊</span> Medication ${m}</div>
                        <div class="check-item"><span>🥣</span> Ate food ${a}</div>
                    </div>
                `;
            } else {
                checksRowHtml = `
                    <div class="checks-row" style="color:var(--text-muted); font-size:13px; font-style:italic;">
                        No data — call unreachable
                    </div>
                `;
            }
        }
        
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="contact-header">
                <a href="contact.html?id=${contact.id}" class="contact-info" style="text-decoration:none; color:inherit;">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name)}&background=f3f4f6&color=374151" class="contact-avatar">
                    <div>
                        <div class="contact-name" style="text-decoration:underline transparent; transition:0.2s;" onmouseover="this.style.textDecorationColor='var(--primary)'" onmouseout="this.style.textDecorationColor='transparent'">${contact.name}</div>
                        <div class="contact-phone">${maskPhone(contact.phone)}</div>
                        <div class="status-text"><div class="dot ${dotClass}"></div> ${statusStr}</div>
                    </div>
                </a>
                <button class="btn-primary" id="btn-${contact.id}" onclick="handleTriggerCall('${contact.id}')">
                    <span style="font-size:16px;">📞</span> Check in now
                </button>
            </div>
            
            ${checksRowHtml}
            
            <div class="badge-full ${badgeClass}"><span style="margin-right:4px;">${badgeIcon}</span>${badgeText}</div>
        `;
        grid.appendChild(card);
    });
}

function renderLogs() {
    const list = document.getElementById('logs-list');
    list.innerHTML = '';
    
    globalData.logs.slice(0, 5).forEach(log => {
        const d = new Date(log.timestamp);
        const isToday = d.toDateString() === new Date().toDateString();
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = isToday ? `Today, ${timeStr}` : `${d.toLocaleDateString('en-US', {month:'short', day:'numeric'})}, ${timeStr}`;
        
        const level = log.concern_level || 'none';
        let badgeIcon = level === 'high' || level === 'low' ? '⚠️' : '✅';
        
        const row = document.createElement('div');
        row.className = 'log-row';
        row.innerHTML = `
            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(log.contactName)}&background=f3f4f6&color=374151" style="width:40px; border-radius:50%;">
            <div class="log-time">
                <div style="font-weight:600; color:#111827; margin-bottom:4px;">${log.contactName}</div>
                ${dateStr}
            </div>
            <div class="log-badge ${level}"><span style="margin-right:4px;">${badgeIcon}</span>${level.toUpperCase()}</div>
            <div class="log-summary">
                ${log.wellbeing_summary || `Call Status: ${log.status}`}
                ${log.concern_reason ? `<br><span style="color:#ef4444; font-size:12px; margin-top:4px; display:inline-block;">${log.concern_reason}</span>` : ''}
            </div>
        `;
        list.appendChild(row);
    });
}

function renderTrend() {
    const container = document.getElementById('trend-content');
    container.innerHTML = '';
    
    if (!globalData.trend || !globalData.trend.lines) return;
    
    globalData.trend.lines.forEach((line, index) => {
        const div = document.createElement('div');
        div.className = 'trend-item';
        
        let icon = '📊';
        if (line.toLowerCase().includes('medication')) icon = '💊';
        else if (line.toLowerCase().includes('concern')) icon = index === 0 && globalData.trend.hasHighStreak ? '⚠️' : '✅';
        
        if (index === 0 && globalData.trend.hasHighStreak) {
            div.className += ' highlight';
        }
        
        div.innerHTML = `
            <div class="trend-icon">${icon}</div>
            <div>${line}</div>
        `;
        container.appendChild(div);
    });
}

window.handleTriggerCall = async function(contactId) {
    const btn = document.getElementById(`btn-${contactId}`);
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '⌛ Calling...';
    btn.disabled = true;
    
    try {
        const res = await fetch('/api/trigger-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactId })
        });
        const data = await res.json();
        
        if (data.error) {
            alert(`Error: ${data.error}`);
        } else if (data.log && data.log.status === 'failed') {
            alert(`Call failed: ${data.log.concern_reason}`);
            await fetchAllData();
        } else {
            await fetchAllData();
        }
    } catch (e) {
        alert(`Error triggering call: ${e.message}`);
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}

fetchAllData();

window.switchView = function(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + viewName).classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const nav = document.getElementById('nav-' + viewName);
    if (nav) nav.classList.add('active');
};

window.toggleSidebar = function() {
    document.querySelector('.sidebar').classList.toggle('collapsed');
};

