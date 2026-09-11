/**
 * 60fps Canvas Audio-Reactive Glowing CALL-E Orb
 * Draws a futuristic neural AI sphere with floating particles, orbital rings,
 * and audio-frequency reactive waves.
 */

import { soundEngine } from '../audio/soundEngine.js';

export class OrbVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    
    this.particles = [];
    this.numParticles = 42;
    this.angle = 0;
    this.pulsePhase = 0;
    this.state = 'standby'; // 'standby' | 'calling' | 'connected' | 'speaking'
    this.animId = null;

    this.initParticles();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.start();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width || 360;
    this.canvas.height = rect.height || 240;
  }

  initParticles() {
    this.particles = [];
    for (let i = 0; i < this.numParticles; i++) {
      this.particles.push({
        baseRadius: 40 + Math.random() * 45,
        angle: (i / this.numParticles) * Math.PI * 2,
        speed: 0.008 + Math.random() * 0.015,
        size: 1.5 + Math.random() * 2.5,
        pulseSpeed: 0.03 + Math.random() * 0.04,
        pulsePhase: Math.random() * Math.PI * 2,
        colorHue: Math.random() > 0.5 ? 185 : 265 // Cyan or Violet
      });
    }
  }

  setState(newState) {
    this.state = newState;
  }

  start() {
    if (this.animId) cancelAnimationFrame(this.animId);
    const render = () => {
      this.draw();
      this.animId = requestAnimationFrame(render);
    };
    render();
  }

  draw() {
    if (!this.ctx || !this.canvas) return;
    const { width, height } = this.canvas;
    const centerX = width / 2;
    const centerY = height / 2;

    this.ctx.clearRect(0, 0, width, height);

    this.pulsePhase += 0.035;
    this.angle += 0.01;

    // Determine reactivity intensity based on state and soundEngine.isSpeakingSimulated
    let activityFactor = 1.0;
    if (soundEngine.isSpeakingSimulated || this.state === 'speaking') {
      activityFactor = 1.8 + Math.sin(this.pulsePhase * 3) * 0.4;
    } else if (this.state === 'calling') {
      activityFactor = 1.4 + Math.sin(this.pulsePhase * 2) * 0.3;
    } else if (this.state === 'connected') {
      activityFactor = 1.2;
    }

    // 1. Draw outer glowing ambient halo
    const haloRadius = (65 + Math.sin(this.pulsePhase) * 6) * (activityFactor * 0.85);
    const haloGrad = this.ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, haloRadius * 1.6);
    
    if (this.state === 'calling') {
      haloGrad.addColorStop(0, 'rgba(239, 68, 68, 0.45)');
      haloGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.2)');
      haloGrad.addColorStop(1, 'transparent');
    } else {
      haloGrad.addColorStop(0, 'rgba(0, 243, 255, 0.45)');
      haloGrad.addColorStop(0.4, 'rgba(139, 92, 246, 0.2)');
      haloGrad.addColorStop(1, 'transparent');
    }

    this.ctx.fillStyle = haloGrad;
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, haloRadius * 1.6, 0, Math.PI * 2);
    this.ctx.fill();

    // 2. Soundwave / frequency orbital ripple rings
    const numRings = 3;
    for (let r = 0; r < numRings; r++) {
      const ringRadius = (50 + r * 20 + Math.sin(this.pulsePhase + r * 1.2) * 8) * (activityFactor * 0.8);
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      this.ctx.strokeStyle = this.state === 'calling' 
        ? `rgba(239, 68, 68, ${0.4 - r * 0.1})` 
        : `rgba(0, 243, 255, ${0.4 - r * 0.1})`;
      this.ctx.lineWidth = 1.2;
      this.ctx.setLineDash([4, 6]);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    // 3. Floating neural orbital particles
    this.particles.forEach(p => {
      p.angle += p.speed;
      const wobble = Math.sin(this.pulsePhase + p.pulsePhase) * 8 * activityFactor;
      const r = p.baseRadius * (activityFactor * 0.8) + wobble;
      const x = centerX + Math.cos(p.angle) * r;
      const y = centerY + Math.sin(p.angle) * r;

      this.ctx.beginPath();
      this.ctx.arc(x, y, p.size * (0.8 + activityFactor * 0.2), 0, Math.PI * 2);
      
      const pColor = this.state === 'calling'
        ? `rgba(245, 158, 11, ${0.7 + Math.sin(p.pulsePhase) * 0.3})`
        : `hsla(${p.colorHue}, 100%, 70%, ${0.7 + Math.sin(p.pulsePhase) * 0.3})`;

      this.ctx.fillStyle = pColor;
      this.ctx.shadowBlur = 8;
      this.ctx.shadowColor = this.state === 'calling' ? '#ef4444' : '#00f3ff';
      this.ctx.fill();
      this.ctx.shadowBlur = 0; // reset
    });

    // 4. Central Solid Core Sphere (EVE / CALL-E eye aesthetic)
    const coreRadius = (28 + Math.sin(this.pulsePhase * 1.5) * 3) * (activityFactor * 0.8);
    const coreGrad = this.ctx.createRadialGradient(
      centerX - coreRadius * 0.3, 
      centerY - coreRadius * 0.3, 
      2, 
      centerX, 
      centerY, 
      coreRadius
    );

    if (this.state === 'calling') {
      coreGrad.addColorStop(0, '#ffffff');
      coreGrad.addColorStop(0.4, '#ef4444');
      coreGrad.addColorStop(1, '#7f1d1d');
    } else {
      coreGrad.addColorStop(0, '#ffffff');
      coreGrad.addColorStop(0.3, '#00f3ff');
      coreGrad.addColorStop(0.7, '#8b5cf6');
      coreGrad.addColorStop(1, '#061329');
    }

    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = coreGrad;
    this.ctx.shadowBlur = 18;
    this.ctx.shadowColor = this.state === 'calling' ? '#ef4444' : '#00f3ff';
    this.ctx.fill();
    this.ctx.shadowBlur = 0;

    // 5. Digital horizontal iris slit / scanner eye
    this.ctx.save();
    this.ctx.beginPath();
    const eyeWidth = coreRadius * 1.3;
    const eyeHeight = 3 + (activityFactor - 1) * 6;
    this.ctx.ellipse(centerX, centerY, eyeWidth / 2, eyeHeight / 2, 0, 0, Math.PI * 2);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.shadowBlur = 10;
    this.ctx.shadowColor = '#ffffff';
    this.ctx.fill();
    this.ctx.restore();
  }
}
