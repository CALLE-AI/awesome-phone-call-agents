/**
 * Speech Engine: Web Speech API Integration
 * Handles SpeechSynthesis (CALL-E voice generation) & SpeechRecognition (User voice input)
 */

import { soundEngine } from './soundEngine.js';

class SpeechEngine {
  constructor() {
    this.synth = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
    this.recognition = null;
    this.isListening = false;
    this.currentVoice = null;
    this.onSpeechStart = null;
    this.onSpeechEnd = null;
    this.onUserTranscript = null;

    this.initVoices();
    this.initRecognition();
  }

  initVoices() {
    if (!this.synth) return;
    const loadVoices = () => {
      const voices = this.synth.getVoices();
      // Look for a sleek modern English voice (Google US English, Samantha, Daniel, or default)
      this.currentVoice = voices.find(v => 
        (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Daniel') || v.name.includes('Samantha')) && v.lang.startsWith('en')
      ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
    };

    loadVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = loadVoices;
    }
  }

  initRecognition() {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';

      this.recognition.onstart = () => {
        this.isListening = true;
      };

      this.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (this.onUserTranscript) {
          this.onUserTranscript(transcript);
        }
      };

      this.recognition.onerror = () => {
        this.isListening = false;
      };

      this.recognition.onend = () => {
        this.isListening = false;
      };
    }
  }

  toggleListening() {
    if (!this.recognition) {
      return { supported: false, isListening: false };
    }

    if (this.isListening) {
      this.recognition.stop();
      this.isListening = false;
    } else {
      try {
        this.recognition.start();
        this.isListening = true;
      } catch (err) {
        console.warn('SpeechRecognition error:', err);
        this.isListening = false;
      }
    }
    return { supported: true, isListening: this.isListening };
  }

  /**
   * Speaks a line and logs it to the transcript.
   *
   * The transcript is a record of what CALL-E said, so it is emitted up front
   * rather than from the utterance's onstart event. Browsers suppress speech
   * synthesis until the page has seen a user gesture, and when they do, onstart
   * never fires. Tying the transcript to that event meant the whole conversation
   * log silently disappeared in exactly the cases where audio was unavailable.
   */
  speak(text, options = {}) {
    return new Promise((resolve) => {
      if (this.onSpeechStart) this.onSpeechStart(text);
      soundEngine.setSpeakingState(true);

      let settled = false;
      let guard = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (guard) clearTimeout(guard);
        soundEngine.setSpeakingState(false);
        if (this.onSpeechEnd) this.onSpeechEnd();
        resolve();
      };

      const words = text.split(' ').length;
      const estimatedMs = typeof window === 'undefined' ? 10 : Math.min(Math.max(words * 220, 1200), 5000);

      if (!this.synth || !soundEngine.enabled) {
        guard = setTimeout(finish, estimatedMs);
        return;
      }

      // If the utterance never reports back, fall through anyway so the incident
      // pipeline cannot be wedged by a silent speech engine.
      guard = setTimeout(finish, estimatedMs + 4000);

      this.synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      if (this.currentVoice) utterance.voice = this.currentVoice;
      utterance.pitch = options.pitch || 1.05;
      utterance.rate = options.rate || 1.02;
      utterance.onend = finish;
      utterance.onerror = finish;

      this.synth.speak(utterance);
    });
  }

  stop() {
    if (this.synth) {
      this.synth.cancel();
    }
    soundEngine.setSpeakingState(false);
    if (this.onSpeechEnd) this.onSpeechEnd();
  }
}

export const speechEngine = new SpeechEngine();
