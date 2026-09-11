/**
 * Terminal Sandbox Runner
 * Animated execution console simulating isolated test runner and deployment checks.
 */

import { soundEngine } from '../audio/soundEngine.js';

export class TerminalSandbox {
  constructor(options = {}) {
    this.terminalBodyEl = document.getElementById('terminalOutput');
    this.runTestsBtn = document.getElementById('runTestsBtn');
    this.onManualRun = options.onManualRun || null;

    this.initEvents();
  }

  initEvents() {
    if (this.runTestsBtn) {
      this.runTestsBtn.addEventListener('click', () => {
        this.runSimulatedTests();
        if (this.onManualRun) this.onManualRun();
      });
    }
  }

  log(text, type = 'normal') {
    if (!this.terminalBodyEl) return;

    const line = document.createElement('div');
    line.className = `term-line ${type ? `term-${type}` : ''}`;
    line.textContent = text;

    this.terminalBodyEl.appendChild(line);
    this.terminalBodyEl.scrollTop = this.terminalBodyEl.scrollHeight;
  }

  clear() {
    if (this.terminalBodyEl) {
      this.terminalBodyEl.innerHTML = `
        <div class="term-line term-dim">$ sandbox-ci --env=isolated-v8</div>
        <div class="term-line term-dim">Container ready. Awaiting agent execution commands...</div>
      `;
    }
  }

  async runSimulatedTests() {
    this.log('$ npm test -- --coverage', 'dim');
    await new Promise(r => setTimeout(r, 400));
    this.log('> Running isolated V8 test suite across 4 worker threads...', 'cyan');
    await new Promise(r => setTimeout(r, 600));
    soundEngine.playSuccessFanfare();
    this.log('PASS src/services/payment.test.ts (1.42s)', 'green');
    this.log('  ✓ should prevent concurrent duplicate transactions (28ms)', 'green');
    this.log('  ✓ should acquire and release distributed lock atomically (14ms)', 'green');
    this.log('  ✓ should maintain strict idempotency key state (19ms)', 'green');
    this.log('Test Suites: 1 passed, 1 total', 'green');
    this.log('Snapshots:   0 total', 'dim');
    this.log('Time:        1.89s', 'dim');
  }
}
