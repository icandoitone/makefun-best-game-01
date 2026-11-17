// Neon Streets — all sound is generated with WebAudio, no audio files.
// One job: the radio (four sequenced stations), the engine hum, sirens and effects.
import { CONFIG } from './config.js';

const SCALE = CONFIG.scale;

function noteFreq(root, degree, octaves) {
  if (!degree) return 0;
  const semi = SCALE[(degree - 1) % SCALE.length] + 12 * Math.floor((degree - 1) / SCALE.length);
  return root * Math.pow(2, semi / 12) * Math.pow(2, octaves);
}

export class AudioSys {
  constructor(onStation) {
    this.onStation = onStation || (() => {});
    this.ctx = null;
    this.master = null;
    this.radioBus = null;
    this.sfxBus = null;
    this.station = 0;
    this.muted = false;
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.noiseBuf = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = null;
    this.sirenHigh = false;
  }

  // Must be called from a user gesture (click / key) the first time.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this.radioBus = this.ctx.createGain();
    this.radioBus.gain.value = 0.5;
    this.radioBus.connect(this.master);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    // Shared noise buffer for hats and crashes.
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Engine hum: a sawtooth through a lowpass, pitch follows speed.
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 40;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxBus);
    this.engineOsc.start();
    // Police siren: one oscillator, frequency flipped by a timer.
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 720;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.sfxBus);
    this.sirenOsc.start();
    return true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  // ---- radio ----
  startRadio() {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stopRadio() {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  currentStation() { return CONFIG.radio[this.station]; }

  nextStation() {
    this.station = (this.station + 1) % CONFIG.radio.length;
    this.step = 0;
    this.onStation(this.currentStation().name);
    this.click();
  }

  schedule() {
    if (!this.playing || !this.ctx) return;
    const st = this.currentStation();
    const stepDur = 60 / st.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.playStep(st, this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 16;
    }
  }

  playStep(st, step, t, stepDur) {
    const bassDeg = st.bass[step];
    const leadDeg = st.lead[step];
    if (bassDeg) this.tone(noteFreq(st.root, bassDeg, 0), t, stepDur * 1.8, st.wave, 0.20, 500);
    if (leadDeg) this.tone(noteFreq(st.root, leadDeg, 2), t, stepDur * 0.9, st.wave, 0.07, 2400);
    if (step % 4 === 0) this.kick(t);
    if (step % 4 === 2) this.hat(t);
  }

  tone(freq, t, dur, wave, vol, cutoff) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    o.type = wave; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.radioBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(g); g.connect(this.radioBus);
    o.start(t); o.stop(t + 0.15);
  }

  hat(t) {
    const s = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    s.buffer = this.noiseBuf;
    f.type = 'highpass'; f.frequency.value = 6000;
    g.gain.setValueAtTime(0.10, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(f); f.connect(g); g.connect(this.radioBus);
    s.start(t); s.stop(t + 0.06);
  }

  // ---- engine + siren ----
  setEngine(speedNorm, onFoot) {
    if (!this.ctx) return;
    const target = onFoot ? 0 : 0.05 + 0.10 * Math.min(1, speedNorm);
    this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    this.engineOsc.frequency.setTargetAtTime(42 + 96 * speedNorm, this.ctx.currentTime, 0.08);
    this.engineFilter.frequency.setTargetAtTime(280 + 900 * speedNorm, this.ctx.currentTime, 0.1);
  }

  setSiren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenTimer) {
      this.sirenGain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.2);
      this.sirenTimer = setInterval(() => {
        this.sirenHigh = !this.sirenHigh;
        this.sirenOsc.frequency.setTargetAtTime(this.sirenHigh ? 950 : 700, this.ctx.currentTime, 0.05);
      }, 380);
    } else if (!on && this.sirenTimer) {
      clearInterval(this.sirenTimer);
      this.sirenTimer = null;
      this.sirenGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
  }

  // ---- one-shot effects ----
  blip(freq, dur, vol, wave) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = wave || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  click() { this.blip(880, 0.06, 0.12, 'square'); }

  crash(strength) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    s.buffer = this.noiseBuf;
    f.type = 'lowpass'; f.frequency.value = 900;
    g.gain.setValueAtTime(Math.min(0.6, 0.2 + 0.4 * strength), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    s.start(t); s.stop(t + 0.3);
    this.blip(70, 0.2, 0.4, 'sine');
  }

  jingle() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      const t = t0 + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.4);
    });
  }

  failSting() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    [392, 311, 233].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      const t = t0 + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.45);
    });
  }
}
