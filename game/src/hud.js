// Neon Streets — the HUD and the screens. One job: show the game state in the
// DOM (speed, stars, money, objective, radio, minimap) and flip screens.
import { CONFIG, streetCoords } from './config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(cb) {
    this.cb = cb;
    this.bannerTimer = null;
    this.toastTimer = null;
    this.minimap = $('minimap').getContext('2d');
    const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', () => { fn(); }); };
    bind('btn-continue', () => cb.onContinue());
    bind('btn-new', () => cb.onNew());
    bind('btn-how', () => { $('howto').classList.toggle('hidden'); });
    bind('btn-resume', () => cb.onResume());
    bind('btn-restart-mission', () => cb.onRestartMission());
    bind('btn-mute', () => cb.onMute());
    bind('btn-quit-title', () => cb.onQuitTitle());
    bind('btn-next-mission', () => cb.onNextMission());
    bind('btn-retry-mission', () => cb.onRetryMission());
    bind('btn-failed-title', () => cb.onFailedTitle());
    bind('btn-busted-retry', () => cb.onBustedRetry());
    bind('btn-busted-title', () => cb.onBustedTitle());
    bind('btn-wrecked-retry', () => cb.onWreckedRetry());
    bind('btn-wrecked-title', () => cb.onWreckedTitle());
    bind('btn-play-again', () => cb.onPlayAgain());
    bind('btn-win-title', () => cb.onWinTitle());
  }

  showScreen(name) {
    for (const id of ['screen-title', 'screen-pause', 'screen-complete', 'screen-failed', 'screen-busted', 'screen-wrecked', 'screen-win']) {
      $(id).classList.add('hidden');
    }
    if (name) $(name).classList.remove('hidden');
    $('hud').classList.toggle('hidden', name === 'screen-title' || name === 'screen-win');
  }

  setSpeed(kmh, gear) {
    $('speed').textContent = Math.round(kmh);
    $('gear').textContent = gear;
  }

  setWanted(n) {
    let html = '';
    for (let i = 0; i < 5; i++) html += i < n ? '★' : '<span class="off">★</span>';
    $('wanted').innerHTML = html;
  }

  setMoney(n) { $('money').textContent = '$' + n.toLocaleString('en-US'); }

  setHealth(frac) {
    const bar = $('health-bar');
    bar.style.width = Math.max(0, Math.round(frac * 100)) + '%';
    bar.style.background = frac > 0.5 ? 'linear-gradient(90deg,#37e08b,#a8ff60)'
      : frac > 0.25 ? 'linear-gradient(90deg,#ffc233,#ff9d2e)' : 'linear-gradient(90deg,#ff5b5b,#ff2e88)';
  }

  setObjective(text) { $('objective').textContent = text; }

  setTimer(seconds) {
    const el = $('mission-timer');
    if (seconds === null || seconds === undefined) { el.textContent = ''; return; }
    const s = Math.ceil(seconds);
    el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    el.classList.toggle('low', s <= 10);
  }

  setRadio(name) { $('radio').textContent = 'RADIO · ' + name; }

  setMuteLabel(muted) { $('btn-mute').textContent = muted ? 'Sound: Off' : 'Sound: On'; }

  showBanner(text, dur) {
    const b = $('banner');
    b.textContent = text;
    b.classList.remove('hidden');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.add('hidden'), dur || 2200);
  }

  toast(msg, kind) {
    const t = $('toast');
    t.textContent = msg;
    t.className = kind || '';
    t.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  tailMeter(show, frac) {
    $('tail-meter-wrap').classList.toggle('hidden', !show);
    if (show) $('tail-fill').style.width = Math.round(frac * 100) + '%';
  }

  setTitleStats(html) { $('title-stats').innerHTML = html; }
  setContinueVisible(v) { $('btn-continue').classList.toggle('hidden', !v); }
  setComplete(name, reward, stats) {
    $('complete-name').textContent = name;
    $('complete-reward').textContent = '+$' + reward.toLocaleString('en-US');
    $('complete-stats').textContent = stats;
  }
  setFailed(reason) { $('failed-reason').textContent = reason; }
  setWin(stats) { $('win-stats').textContent = stats; }

  // Top-down map: streets, objective, player arrow, cops, helicopter, traffic.
  drawMinimap(data) {
    const g = this.minimap;
    const S = 180;
    const half = CONFIG.city.half + 12;
    const toMap = (x, z) => [(x + half) / (half * 2) * S, (z + half) / (half * 2) * S];
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#070d18';
    g.fillRect(0, 0, S, S);
    // Streets.
    g.strokeStyle = 'rgba(120,140,170,0.55)';
    g.lineWidth = 3;
    for (const c of streetCoords()) {
      const [ax] = toMap(c, 0);
      const [, bz] = toMap(0, c);
      g.beginPath(); g.moveTo(ax, 0); g.lineTo(ax, S); g.stroke();
      g.beginPath(); g.moveTo(0, bz); g.lineTo(S, bz); g.stroke();
    }
    // Objective beacon.
    if (data.objective) {
      const [ox, oy] = toMap(data.objective.x, data.objective.z);
      const pulse = 4 + Math.sin(data.time * 5) * 1.5;
      g.fillStyle = '#29e6ff';
      g.beginPath(); g.arc(ox, oy, pulse + 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(ox, oy, 2, 0, Math.PI * 2); g.fill();
    }
    // Traffic (grey dots) and cops (red dots).
    g.fillStyle = 'rgba(160,170,190,0.8)';
    for (const t of data.traffic || []) {
      const [x, y] = toMap(t.x, t.z);
      g.fillRect(x - 1, y - 1, 2, 2);
    }
    g.fillStyle = '#ff4455';
    for (const c of data.cops || []) {
      const [x, y] = toMap(c.x, c.z);
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
    }
    // Helicopter (yellow ring).
    if (data.heli) {
      const [x, y] = toMap(data.heli.x, data.heli.z);
      g.strokeStyle = '#ffe9a8'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke();
    }
    // Player arrow, rotated to the heading.
    const [px, py] = toMap(data.player.x, data.player.z);
    g.save();
    g.translate(px, py);
    g.rotate(data.player.heading);
    g.fillStyle = '#ff2e88';
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(-5, 6); g.closePath();
    g.fill();
    g.restore();
  }
}
