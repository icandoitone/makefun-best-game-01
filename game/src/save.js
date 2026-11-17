// Neon Streets — saving. One job: persist progress in localStorage.
import { CONFIG } from './config.js';

export function loadSave() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.missionsCompleted !== 'number') return null;
    return {
      missionsCompleted: s.missionsCompleted,
      money: s.money || 0,
      bestTime: s.bestTime || null,
      totalEarned: s.totalEarned || 0,
    };
  } catch (e) {
    return null;
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(CONFIG.saveKey, JSON.stringify(save));
  } catch (e) {
    // Storage full or blocked: the game still plays, it just does not persist.
  }
}

export function clearSave() {
  try { localStorage.removeItem(CONFIG.saveKey); } catch (e) { /* ignore */ }
}

export function freshSave() {
  return { missionsCompleted: 0, money: 0, bestTime: null, totalEarned: 0 };
}
