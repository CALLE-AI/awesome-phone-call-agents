/**
 * Code Diff Studio & Syntax Viewer
 * Renders unified side-by-side diffs, original code, patched code, and test harnesses.
 */

export class CodeDiffViewer {
  constructor() {
    this.viewportEl = document.getElementById('codeViewport');
    this.tabs = document.querySelectorAll('.code-tab');
    this.fileNameEl = document.getElementById('currentFileName');
    this.copyBtn = document.getElementById('copyCodeBtn');
    this.applyBtn = document.getElementById('applyHotfixBtn');

    this.currentView = 'diff'; // 'diff' | 'original' | 'patched' | 'tests'
    this.currentScenario = null;

    this.initEvents();
  }

  initEvents() {
    this.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentView = tab.dataset.view;
        this.render();
      });
    });

    if (this.copyBtn) {
      this.copyBtn.addEventListener('click', () => {
        this.copyActiveCode();
      });
    }

    if (this.applyBtn) {
      this.applyBtn.addEventListener('click', () => {
        this.applyBtn.textContent = '✅ Hotfix Applied!';
        this.applyBtn.classList.remove('btn-accent');
        this.applyBtn.classList.add('btn-primary');
        setTimeout(() => {
          this.applyBtn.textContent = '🚀 Apply Hotfix';
          this.applyBtn.classList.add('btn-accent');
          this.applyBtn.classList.remove('btn-primary');
        }, 2500);
      });
    }
  }

  setScenario(scenario) {
    this.currentScenario = scenario;
    if (this.fileNameEl) {
      this.fileNameEl.textContent = scenario.fileName;
    }
    this.syncTabsToScenario(scenario);
    this.render();
  }

  /**
   * Relabels the panes for scanned code.
   *
   * A scanned incident has findings, not a patch, so offering to apply a hotfix
   * would promise something that was never generated.
   */
  syncTabsToScenario(scenario) {
    const scanned = Boolean(scenario.scan);

    if (this.applyBtn) {
      this.applyBtn.disabled = scanned;
      this.applyBtn.title = scanned
        ? 'No patch was generated for scanned code. The scanner reports findings only.'
        : 'Apply hotfix immediately';
      this.applyBtn.innerHTML = scanned ? '🔍 Findings only' : '🚀 Apply Hotfix';
    }

    const relabel = (view, scannedLabel, defaultLabel) => {
      const tab = document.querySelector(`.code-tab[data-view="${view}"]`);
      if (tab) tab.innerHTML = scanned ? scannedLabel : defaultLabel;
    };

    relabel('diff', '<span class="tab-icon">🔍</span> Annotated Findings', '<span class="tab-icon">⚡</span> Side-by-Side Diff');
    relabel('original', '<span class="tab-icon">📄</span> Submitted Code', '<span class="tab-icon">❌</span> Original Buggy Code');
    relabel('patched', '<span class="tab-icon">📋</span> Scan Report', '<span class="tab-icon">✅</span> Patched Code');
    relabel('tests', '<span class="tab-icon">📋</span> Scan Report', '<span class="tab-icon">🧪</span> Generated Tests');
  }

  render() {
    if (!this.viewportEl || !this.currentScenario) return;

    if (this.currentView === 'diff') {
      this.renderDiff();
    } else if (this.currentView === 'original') {
      this.renderCodeBlock(this.currentScenario.originalCode, 'red');
    } else if (this.currentView === 'patched') {
      this.renderCodeBlock(this.currentScenario.patchedCode, 'green');
    } else if (this.currentView === 'tests') {
      this.renderCodeBlock(this.currentScenario.testSuite, 'cyan');
    }
  }

  renderDiff() {
    const diffLines = this.currentScenario.diff || [];
    let html = '<div class="diff-viewer">';

    diffLines.forEach((item, idx) => {
      const lineNum = idx + 1;
      let rowClass = '';
      let sign = ' ';

      if (item.type === 'add') {
        rowClass = 'diff-add';
        sign = '+';
      } else if (item.type === 'del') {
        rowClass = 'diff-del';
        sign = '-';
      }

      // Escape HTML
      const escapedText = item.text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      html += `
        <div class="diff-row ${rowClass}">
          <span class="diff-num">${lineNum}</span>
          <span class="diff-gutter-sign">${sign}</span>
          <span class="diff-content">${escapedText}</span>
        </div>
      `;
    });

    html += '</div>';
    this.viewportEl.innerHTML = html;
  }

  renderCodeBlock(codeText, colorTag) {
    const lines = (codeText || '').split('\n');
    let html = `<div class="diff-viewer">`;

    lines.forEach((line, idx) => {
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      html += `
        <div class="diff-row">
          <span class="diff-num">${idx + 1}</span>
          <span class="diff-content">${escaped}</span>
        </div>
      `;
    });

    html += '</div>';
    this.viewportEl.innerHTML = html;
  }

  copyActiveCode() {
    if (!this.currentScenario) return;
    let textToCopy = '';

    if (this.currentView === 'original') textToCopy = this.currentScenario.originalCode;
    else if (this.currentView === 'patched') textToCopy = this.currentScenario.patchedCode;
    else if (this.currentView === 'tests') textToCopy = this.currentScenario.testSuite;
    else {
      textToCopy = (this.currentScenario.diff || []).map(d => d.text).join('\n');
    }

    navigator.clipboard.writeText(textToCopy).then(() => {
      const originalText = this.copyBtn.textContent;
      this.copyBtn.textContent = '✓ Copied!';
      setTimeout(() => {
        this.copyBtn.textContent = originalText;
      }, 1800);
    });
  }
}
