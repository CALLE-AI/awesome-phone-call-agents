/**
 * Web Audio API Native Synthesizer
 * Provides 100% reliable, zero-dependency sound effects for phone ringing,
 * call connection, agent chatter beeps, and test runner fanfares.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ringInterval = null;
    this.currentOscillators = [];
    this.analyzer = null;
    this.isSpeakingSimulated = false;
  }

  initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
        this.analyzer = this.ctx.createAnalyser();
        this.analyzer.fftSize = 64;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleAudio(forceState) {
    if (typeof forceState === 'boolean') {
      this.enabled = forceState;
    } else {
      this.enabled = !this.enabled;
    }
    if (!this.enabled) {
      this.stopRing();
    }
    return this.enabled;
  }

  // Play phone ring: 440Hz & 480Hz standard phone ring cadence
  startRing() {
    if (!this.enabled) return;
    this.initContext();
    this.stopRing();

    const ringOnce = () => {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.value = 440; // US dial/ring tone 1
      osc2.type = 'sine';
      osc2.frequency.value = 480; // US dial/ring tone 2

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
      gain.gain.setValueAtTime(0.18, now + 1.2);
      gain.gain.linearRampToValueAtTime(0, now + 1.3);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.3);
      osc2.stop(now + 1.3);
    };

    ringOnce();
    this.ringInterval = setInterval(ringOnce, 2400);
  }

  stopRing() {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }

  // Sci-fi call pickup chime: C-major ascending triad
  playConnect() {
    if (!this.enabled) return;
    this.initContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const time = now + idx * 0.07;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.15, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.28);
    });
  }

  // Call hangup sound: descending soft tone
  playDisconnect() {
    if (!this.enabled) return;
    this.initContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [783.99, 523.25, 392.00];

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const time = now + idx * 0.09;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0.12, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.22);
    });
  }

  // Agent blip chime: tailored frequency per agent
  playAgentBeep(agentKey) {
    if (!this.enabled) return;
    this.initContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const freqMap = {
      operator: 880,   // A5 crisp
      tracer: 698.46,  // F5 analytical
      architect: 587.33, // D5 constructive
      guardian: 987.77 // B5 protective
    };

    const freq = freqMap[agentKey] || 750;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.2, now + 0.08);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.15);
  }

  // Green test passed fanfare
  playSuccessFanfare() {
    if (!this.enabled) return;
    this.initContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const time = now + idx * 0.06;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.14, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.38);
    });
  }

  // Warning buzzer
  playWarningBuzzer() {
    if (!this.enabled) return;
    this.initContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.linearRampToValueAtTime(120, now + 0.2);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.26);
  }

  // Simulated speech frequencies for the visual orb
  setSpeakingState(isSpeaking) {
    this.isSpeakingSimulated = isSpeaking;
  }
}

export const soundEngine = new SoundEngine();
