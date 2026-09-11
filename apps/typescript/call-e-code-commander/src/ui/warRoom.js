/**
 * 4-Agent War Room UI Controller
 * Manages the multi-agent council status cards, inter-agent debate feed, and pipeline steps.
 */

export class WarRoomController {
  constructor() {
    this.agentCards = {
      operator: document.getElementById('agentCard1'),
      tracer: document.getElementById('agentCard2'),
      architect: document.getElementById('agentCard3'),
      guardian: document.getElementById('agentCard4')
    };

    this.thoughtEls = {
      operator: document.getElementById('agentThought1'),
      tracer: document.getElementById('agentThought2'),
      architect: document.getElementById('agentThought3'),
      guardian: document.getElementById('agentThought4')
    };

    this.stepPills = document.querySelectorAll('.step-pill');
    this.chatListEl = document.getElementById('agentChatList');
    this.messageCountEl = document.getElementById('messageCount');
    this.messageCount = 0;
  }

  setStep(stepNumber) {
    this.stepPills.forEach(pill => {
      const step = parseInt(pill.dataset.step, 10);
      pill.classList.remove('active', 'completed');
      if (step < stepNumber) {
        pill.classList.add('completed');
      } else if (step === stepNumber) {
        pill.classList.add('active');
      }
    });

    // Update active highlight on corresponding agent card
    // Step 5 is the human authorisation gate, which the CALL-E Operator runs
    // because it is the agent holding the phone line.
    const agentMap = {
      1: 'operator',
      2: 'tracer',
      3: 'architect',
      4: 'guardian',
      5: 'operator'
    };

    Object.keys(this.agentCards).forEach(key => {
      const card = this.agentCards[key];
      if (!card) return;
      const badge = card.querySelector('.agent-badge');
      
      if (key === agentMap[stepNumber]) {
        card.classList.add('active');
        if (badge) {
          badge.textContent = 'PROCESSING';
          badge.className = 'agent-badge status-active';
        }
      } else {
        card.classList.remove('active');
        if (badge && badge.textContent === 'PROCESSING') {
          badge.textContent = 'DONE';
          badge.className = 'agent-badge status-idle';
        }
      }
    });
  }

  updateThought(agentKey, thought) {
    const el = this.thoughtEls[agentKey];
    if (el) {
      el.textContent = thought;
    }
  }

  updateConfidence(agentKey, percent) {
    const card = this.agentCards[agentKey];
    if (!card) return;
    const bar = card.querySelector('.progress-bar');
    const num = card.querySelector('.conf-num');
    if (bar) bar.style.width = `${percent}%`;
    if (num) num.textContent = `${percent}%`;
  }

  appendMessage(sender, text, agentKey, time) {
    if (!this.chatListEl) return;

    this.messageCount++;
    if (this.messageCountEl) {
      this.messageCountEl.textContent = `${this.messageCount} msgs`;
    }

    const msgEl = document.createElement('div');
    msgEl.className = `agent-msg ${agentKey ? `${agentKey}-msg` : ''}`;

    msgEl.innerHTML = `
      <div class="msg-header-row">
        <span class="msg-sender">${sender}</span>
        <span class="msg-time">${time || new Date().toLocaleTimeString()}</span>
      </div>
      <div class="msg-body">${text}</div>
    `;

    this.chatListEl.appendChild(msgEl);
    this.chatListEl.scrollTop = this.chatListEl.scrollHeight;
  }

  reset() {
    this.messageCount = 0;
    if (this.messageCountEl) this.messageCountEl.textContent = '0 msgs';
    if (this.chatListEl) {
      this.chatListEl.innerHTML = `
        <div class="agent-msg system-msg">
          <span class="msg-time">00:00:01</span>
          <span class="msg-body">CALL-E mesh network established. 4 agents synchronized.</span>
        </div>
      `;
    }

    this.stepPills.forEach(p => p.classList.remove('active', 'completed'));
    
    // Reset agent cards to default standby
    const defaults = {
      operator: { text: 'Connected to lead engineer. Monitoring incident telemetry stream...', conf: 98, badge: 'LISTENING', badgeClass: 'status-active' },
      tracer: { text: 'Awaiting telemetry dispatch from CALL-E Operator...', conf: 0, badge: 'STANDBY', badgeClass: 'status-idle' },
      architect: { text: 'Ready to synthesize zero-downtime hotfix patch once RCA is locked...', conf: 0, badge: 'STANDBY', badgeClass: 'status-idle' },
      guardian: { text: 'Sandbox environment initialized. Test harness waiting for hotfix...', conf: 0, badge: 'STANDBY', badgeClass: 'status-idle' }
    };

    Object.keys(defaults).forEach(key => {
      this.updateThought(key, defaults[key].text);
      this.updateConfidence(key, defaults[key].conf);
      const card = this.agentCards[key];
      if (card) {
        card.classList.toggle('active', key === 'operator');
        const badge = card.querySelector('.agent-badge');
        if (badge) {
          badge.textContent = defaults[key].badge;
          badge.className = `agent-badge ${defaults[key].badgeClass}`;
        }
      }
    });
  }
}
