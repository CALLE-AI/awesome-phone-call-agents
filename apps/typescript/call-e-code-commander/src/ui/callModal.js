/**
 * Call Modal Controller
 * Signature "Your Code Is Calling" incoming emergency phone call experience.
 */

import { soundEngine } from '../audio/soundEngine.js';

export class CallModalController {
  constructor(options = {}) {
    this.modalEl = document.getElementById('incomingCallModal');
    this.serviceNameEl = document.getElementById('callerServiceName');
    this.errorSnippetEl = document.getElementById('callerErrorSnippet');
    this.impactEl = document.getElementById('callerImpact');
    this.acceptBtn = document.getElementById('acceptCallBtn');
    this.declineBtn = document.getElementById('declineCallBtn');
    
    this.onAccept = options.onAccept || null;
    this.onDecline = options.onDecline || null;

    this.initEvents();
  }

  initEvents() {
    if (this.acceptBtn) {
      this.acceptBtn.addEventListener('click', () => {
        this.hide();
        soundEngine.stopRing();
        if (this.onAccept) this.onAccept();
      });
    }

    if (this.declineBtn) {
      this.declineBtn.addEventListener('click', () => {
        this.hide();
        soundEngine.stopRing();
        soundEngine.playDisconnect();
        if (this.onDecline) this.onDecline();
      });
    }
  }

  triggerIncomingCall(scenario) {
    if (!this.modalEl || !scenario) return;

    if (this.serviceNameEl) this.serviceNameEl.textContent = scenario.service;
    if (this.errorSnippetEl) this.errorSnippetEl.textContent = `${scenario.severity}: ${scenario.errorCode}`;
    if (this.impactEl) this.impactEl.textContent = `Impact: ${scenario.impact}`;

    this.modalEl.classList.remove('hidden');
    soundEngine.startRing();
  }

  hide() {
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
    }
    soundEngine.stopRing();
  }
}
