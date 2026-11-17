// Neon Streets — all tuning, city layout, mission data and radio stations.
// One clear job: constants. Nothing here touches the renderer or the DOM.

export const CONFIG = {
  title: 'Neon Streets',
  saveKey: 'neon-streets-save-v1',

  // ---- city: a grid of streets, blocks between them ----
  city: {
    streets: 7,          // streets per axis (indices 0..6)
    step: 48,            // distance between neighbouring streets
    roadWidth: 11,
    half: 144,           // city spans -144 .. +144 on x and z
    sidewalk: 3,
  },

  // ---- player car feel ----
  car: {
    maxSpeed: 38,        // world units per second (~137 km/h at the display scale)
    maxReverse: 12,
    accel: 26,
    brake: 42,
    drag: 0.55,          // per-second speed loss factor while coasting
    grip: 2.6,           // steering authority
    handbrakeGrip: 4.6,  // sharper turn while drifting
    handbrakeDrag: 1.6,
    radius: 1.7,         // collision circle
    health: 100,
    crashDamage: 9,      // per hard impact
    regen: 2.0,          // health per second after 3 s without a crash
  },

  // ---- traffic ----
  traffic: {
    cars: 14,
    speed: 11,
    minGap: 7,
    pedestrians: 10,
    pedSpeed: 1.6,
  },

  // ---- police ----
  police: {
    maxCars: 5,
    chaseSpeed: 40,
    ramSpeed: 30,
    sight: 46,           // a cop inside this range keeps you "seen"
    bustedDist: 4.2,     // cop this close while you crawl
    bustedTime: 2.6,     // seconds of it before you are busted
    heliAtWanted: 3,
    decaySeen: 8,        // seconds unseen before one star fades
  },

  // ---- wanted: what each crime is worth ----
  crime: {
    carjack: 2,
    hitTraffic: 1,
    hitPedestrian: 2,
    hitPolice: 1,
    speeding: 0,         // speeding alone only holds heat, it does not add stars
    speedLimit: 26,      // above this you are "speeding" (holds the decay timer)
  },

  display: { kmh: 3.6 }, // world units/s -> km/h shown on the HUD

  // ---- missions, in story order ----
  missions: [
    {
      id: 'first-drive', name: 'First Drive', type: 'goto', reward: 100,
      briefing: 'Meet Ray at the beacon. Learn the streets — follow the light column.',
      point: [-96, -96],
    },
    {
      id: 'hot-package', name: 'Hot Package', type: 'timed', reward: 250, time: 75,
      briefing: 'A package, a deadline. Get it to the beacon in 75 seconds.',
      point: [96, 96],
    },
    {
      id: 'tail-job', name: 'Tail Job', type: 'tail', reward: 350,
      briefing: 'Follow the grey sedan. Not too close, not too far — stay in the goldilocks zone.',
      tailFrom: [-96, 96], tailTo: [96, -48],
    },
    {
      id: 'heat', name: 'Heat', type: 'escape', reward: 500,
      briefing: 'You are at 3 stars. Lose the heat and reach the safehouse beacon.',
      point: [-96, 96], wanted: 3,
    },
    {
      id: 'new-wheels', name: 'New Wheels', type: 'carjack', reward: 600, time: 120,
      briefing: 'On foot. Walk to the marked coupe, take it, and drop it at the beacon. The law will notice.',
      carPoint: [48, -96], point: [-96, 48],
    },
    {
      id: 'midnight-run', name: 'Midnight Run', type: 'gauntlet', reward: 1000, time: 150,
      briefing: 'The final run: three checkpoints, then the safehouse — with the whole NCPD on your tail.',
      points: [[-96, -48], [96, 48], [-48, 96]],
      point: [96, -96], wanted: 4,
    },
  ],

  // ---- radio: four procedurally sequenced stations (WebAudio, no files) ----
  // patterns are 16 steps; 0 = rest, otherwise a scale degree (1..7).
  radio: [
    { name: 'NEON FM', bpm: 100, wave: 'sawtooth', root: 55,
      bass: [1, 0, 0, 1, 0, 0, 3, 0, 1, 0, 0, 1, 0, 5, 0, 0],
      lead: [1, 0, 3, 0, 5, 0, 3, 0, 6, 0, 5, 0, 3, 0, 2, 0] },
    { name: 'BASSLINE 88', bpm: 112, wave: 'square', root: 49,
      bass: [1, 0, 1, 0, 0, 3, 0, 1, 0, 0, 1, 0, 5, 0, 4, 0],
      lead: [0, 0, 5, 0, 0, 6, 0, 5, 0, 0, 3, 0, 2, 0, 0, 0] },
    { name: 'MIDNIGHT JAZZ', bpm: 88, wave: 'triangle', root: 65.4,
      bass: [1, 0, 0, 0, 4, 0, 0, 0, 5, 0, 0, 0, 4, 0, 3, 0],
      lead: [5, 0, 0, 6, 0, 0, 5, 0, 3, 0, 0, 2, 0, 0, 1, 0] },
    { name: 'TURBO ROCK', bpm: 142, wave: 'square', root: 61.7,
      bass: [1, 1, 0, 1, 0, 1, 3, 0, 1, 1, 0, 1, 5, 0, 6, 0],
      lead: [1, 0, 1, 3, 0, 5, 0, 6, 5, 0, 3, 0, 5, 6, 0, 0] },
  ],

  // minor scale degrees (semitone offsets from the root)
  scale: [0, 2, 3, 5, 7, 8, 10],
};

// Deterministic RNG (mulberry32) so the city layout is stable per seed.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Street coordinates for one axis: -144, -96, -48, 0, 48, 96, 144.
export function streetCoords() {
  const { streets, step, half } = CONFIG.city;
  const out = [];
  for (let i = 0; i < streets; i++) out.push(-half + i * step);
  return out;
}

// Nearest street coordinate to a value (used to snap cars to roads).
export function nearestStreet(v) {
  const cs = streetCoords();
  let best = cs[0];
  for (const c of cs) if (Math.abs(c - v) < Math.abs(best - v)) best = c;
  return best;
}
