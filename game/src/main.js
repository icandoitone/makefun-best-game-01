// Neon Streets — bootstrap, game loop, camera, and the state machine.
// One job: own the pieces (city, cars, traffic, police, missions, HUD, audio)
// and run the game: title, driving, on-foot carjacking, pause, and the ends.
import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG, nearestStreet } from './config.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { buildCity, clampToCity } from './city.js';
import { createCar, stepCar, collideBuildings, collideCars, buildCarMesh } from './car.js';
import { Traffic } from './traffic.js';
import { Police } from './police.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { loadSave, writeSave, clearSave, freshSave } from './save.js';
import { shotName, setupShot } from './shots.js';

const PLAYER_COLOR = 0xff2e88;
const WALK_SPEED = 6.5;

class Game {
  constructor() {
    this.state = 'title';
    this.time = 0;
    this.money = 0;
    this.save = loadSave() || freshSave();
    this.missionIndex = 0;
    this.crimeCooldown = 0;
    this.shake = 0;
    this.shotMode = shotName();
    this.shotFrames = 0;
    this.cinematic = null;
    this.ownedCars = [];
    this.onFoot = false;
    this.walkHeading = 0;
    this.nearCarHint = false;

    // Renderer and scene.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById('game').appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070a14);
    this.scene.fog = new THREE.Fog(0x0a0f1e, 90, 320);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera.position.set(0, 30, 90);
    this.camPos = new THREE.Vector3(0, 30, 90);
    this.camLook = new THREE.Vector3(0, 0, 0);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Night lighting: a dim moon, a soft ambient, and the city's own glow.
    this.scene.add(new THREE.AmbientLight(0x33415e, 1.4));
    const moon = new THREE.DirectionalLight(0x8fb4ff, 0.9);
    moon.position.set(-60, 120, -40);
    this.scene.add(moon);
    const hemi = new THREE.HemisphereLight(0x2a3a5e, 0x0a0c12, 0.9);
    this.scene.add(hemi);

    // World.
    const city = buildCity(this.scene);
    this.buildings = city.buildings;
    this.traffic = new Traffic(this.scene);
    this.traffic.spawnInitial(CONFIG.traffic.cars);
    this.traffic.spawnPeds(CONFIG.traffic.pedestrians);
    this.police = new Police(this.scene, this.buildings);

    // The player car and the on-foot pedestrian.
    this.playerCar = createCar(PLAYER_COLOR, -96, 20, Math.PI, false);
    this.scene.add(this.playerCar.mesh);
    this.playerCar.x = -96; this.playerCar.z = 20;
    this.ped = this.makePedMesh();
    this.ped.visible = false;
    this.scene.add(this.ped);
    this.pedX = -96; this.pedZ = 20;

    this.input = new Input();
    this.audio = new AudioSys((name) => this.hud.setRadio(name));
    this.missions = new Missions(this.scene, {
      objective: (t) => this.hud.setObjective(t),
      timer: (s) => this.hud.setTimer(s),
      banner: (t) => this.hud.showBanner(t),
      toast: (m, k) => this.hud.toast(m, k),
      tailMeter: (show, f) => this.hud.tailMeter(show, f),
      complete: (m, stats) => this.onMissionComplete(m, stats),
      fail: (reason) => this.onMissionFailed(reason),
    });
    this.hud = new HUD({
      onContinue: () => this.continueGame(),
      onNew: () => this.newGame(),
      onResume: () => this.resume(),
      onRestartMission: () => this.restartMission(),
      onMute: () => this.toggleMute(),
      onQuitTitle: () => this.toTitle(),
      onNextMission: () => this.nextMission(),
      onRetryMission: () => this.restartMission(),
      onFailedTitle: () => this.toTitle(),
      onBustedRetry: () => this.restartMission(),
      onBustedTitle: () => this.toTitle(),
      onWreckedRetry: () => this.restartMission(),
      onWreckedTitle: () => this.toTitle(),
      onPlayAgain: () => this.newGame(),
      onWinTitle: () => this.toTitle(),
    });

    // First user gesture unlocks audio.
    const unlock = () => { this.audio.ensure(); };
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });

    this.refreshTitle();
    this.hud.showScreen('screen-title');
    this.hud.setRadio(this.audio.currentStation().name);

    // Screenshot scenes (?shot=...) configure a deterministic setup.
    if (this.shotMode) {
      const G = this.shotContext();
      if (setupShot(this.shotMode, G)) {
        this.state = this.shotMode === 'title' ? 'title' : (this.shotMode === 'complete' ? 'complete' : 'playing');
        if (this.shotMode === 'complete') this.state = 'complete';
      }
    }

    // Debug handle for local verification (state only, no cheats).
    window.__game = this.debugState.bind(this);
    this.lastT = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  makePedMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.42, 1.5, 8),
      new THREE.MeshLambertMaterial({ color: 0xff2e88 }),
    );
    body.position.y = 0.95;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xe8b88a }),
    );
    head.position.y = 1.9;
    g.add(head);
    return g;
  }

  // ---- context the screenshot scenes use ----
  shotContext() {
    const self = this;
    return {
      traffic: this.traffic,
      police: this.police,
      missions: this.missions,
      hud: this.hud,
      get cinematic() { return self.cinematic; },
      set cinematic(v) { self.cinematic = v; },
      hideTitle: () => { this.hud.showScreen(null); },
      showTitleScreen: () => { this.refreshTitle(); this.hud.showScreen('screen-title'); },
      showCompleteScreen: (name, reward, stats) => {
        this.hud.setComplete(name, reward, stats);
        this.hud.showScreen('screen-complete');
      },
      startMission: (i) => this.startMission(i),
      setPlayerAt: (x, z, heading, speed) => {
        this.playerCar.x = x; this.playerCar.z = z;
        this.playerCar.heading = heading; this.playerCar.speed = speed;
        this.playerCar.mesh.position.set(x, 0, z);
        this.playerCar.mesh.rotation.y = heading;
        this.onFoot = false;
        this.ped.visible = false;
      },
      setMoney: (n) => { this.money = n; this.hud.setMoney(n); },
    };
  }

  debugState() {
    const p = this.playerPos();
    let nearTraffic = null;
    for (const c of this.traffic.cars) {
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (nearTraffic === null || d < nearTraffic) nearTraffic = d;
    }
    const b = this.missions.beacon;
    const bp = (b && b.visible) ? b.position : null;
    const mdef = this.missionIndex >= 0 ? CONFIG.missions[this.missionIndex] : null;
    return {
      state: this.state,
      missionIndex: this.missionIndex,
      missionType: mdef ? mdef.type : null,
      missionActive: this.missions.active,
      timeLeft: this.missions.timeLeft === null ? null : Math.round(this.missions.timeLeft * 10) / 10,
      tail: this.missions.tail ? Math.round(this.missions.tail.meter * 100) / 100 : null,
      beacon: bp ? { x: Math.round(bp.x), z: Math.round(bp.z) } : null,
      wanted: this.police.wanted,
      speed: this.playerCar ? this.playerCar.speed : 0,
      kmh: Math.abs(this.playerCar ? this.playerCar.speed : 0) * CONFIG.display.kmh,
      money: this.money,
      onFoot: this.onFoot,
      heading: this.playerCar ? this.playerCar.heading : (this.ped ? this.ped.heading : 0),
      x: p.x, z: p.z,
      health: this.playerCar ? this.playerCar.health : 0,
      cops: this.police.cops.length,
      heli: !!this.police.heli,
      nearTraffic: nearTraffic === null ? null : Math.round(nearTraffic * 10) / 10,
      trafficCount: this.traffic.cars.length,
      objective: document.getElementById('objective').textContent,
    };
  }

  playerPos() {
    if (this.onFoot) return { x: this.pedX, z: this.pedZ, heading: this.walkHeading, speed: 0 };
    return { x: this.playerCar.x, z: this.playerCar.z, heading: this.playerCar.heading, speed: this.playerCar.speed };
  }

  // ---- flow ----
  refreshTitle() {
    const s = this.save;
    this.hud.setContinueVisible(!!loadSave() && s.missionsCompleted > 0);
    const best = s.bestTime ? 'Best delivery: ' + s.bestTime.toFixed(1) + ' s · ' : '';
    this.hud.setTitleStats(
      s.missionsCompleted > 0
        ? best + 'Missions complete: ' + s.missionsCompleted + ' / 6 · Total earned: $' + s.totalEarned.toLocaleString('en-US')
        : 'Six missions. One city. Press New Game to hit the streets.',
    );
  }

  newGame() {
    clearSave();
    this.save = freshSave();
    this.money = 0;
    this.missionIndex = 0;
    this.audio.ensure();
    this.audio.startRadio();
    this.startMission(0);
  }

  continueGame() {
    const s = loadSave();
    if (!s) { this.newGame(); return; }
    this.save = s;
    this.money = s.money;
    this.missionIndex = Math.min(s.missionsCompleted, CONFIG.missions.length - 1);
    this.audio.ensure();
    this.audio.startRadio();
    this.startMission(this.missionIndex);
  }

  toTitle() {
    this.state = 'title';
    this.missions.active = false;
    this.missions.hideBeacon();
    this.police.reset();
    this.refreshTitle();
    this.hud.showScreen('screen-title');
    this.audio.setSiren(false);
  }

  startMission(i) {
    this.missionIndex = i;
    const m = CONFIG.missions[i];
    // Fresh car, fresh heat, a clean street to start from.
    this.police.reset();
    this.playerCar.health = CONFIG.car.health;
    this.playerCar.speed = 0;
    this.onFoot = false;
    this.ped.visible = false;
    // Spawn on a street near the first objective, facing it.
    const target = m.point || (m.points ? m.points[0] : null) || m.tailFrom || m.carPoint;
    const sx = target ? target[0] : 0;
    const sz = target ? target[1] : 0;
    let px = nearestStreet(sx);
    let pz = nearestStreet(sz + 44);
    const cl = clampToCity(px, pz, 6);
    px = cl[0]; pz = cl[1];
    this.playerCar.x = px; this.playerCar.z = pz;
    this.playerCar.heading = Math.atan2(sx - px, sz - pz);
    this.playerCar.mesh.position.set(px, 0, pz);
    this.playerCar.mesh.rotation.y = this.playerCar.heading;
    this.ownedCars = [this.playerCar];
    this.state = 'playing';
    this.hud.showScreen(null);
    this.hud.setMoney(this.money);
    this.hud.setHealth(1);
    this.missions.start(i, this.world());
    this.audio.setSiren(false);
  }

  restartMission() { this.startMission(this.missionIndex); }

  nextMission() {
    if (this.missionIndex + 1 >= CONFIG.missions.length) {
      this.showWin();
      return;
    }
    this.startMission(this.missionIndex + 1);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hud.showScreen(null);
  }

  toggleMute() {
    this.audio.ensure();
    this.audio.setMuted(!this.audio.muted);
    this.hud.setMuteLabel(this.audio.muted);
  }

  onMissionComplete(m, stats) {
    this.money += m.reward;
    this.save.missionsCompleted = Math.max(this.save.missionsCompleted, this.indexOf(m) + 1);
    this.save.money = this.money;
    this.save.totalEarned += m.reward;
    if (m.id === 'hot-package' && (!this.save.bestTime || stats.time < this.save.bestTime)) {
      this.save.bestTime = stats.time;
    }
    writeSave(this.save);
    this.audio.jingle();
    this.audio.setSiren(false);
    const timeTxt = stats.time ? 'Finished in ' + stats.time.toFixed(1) + ' s' : '';
    this.hud.setComplete(m.name, m.reward, timeTxt);
    this.state = 'complete';
    this.hud.showScreen('screen-complete');
    if (this.indexOf(m) === CONFIG.missions.length - 1) {
      // Final mission: the win screen follows the complete screen.
      this.hud.setComplete(m.name, m.reward, timeTxt + ' — that was the last job.');
    }
  }

  onMissionFailed(reason) {
    this.audio.failSting();
    this.audio.setSiren(false);
    this.hud.setFailed(reason);
    this.state = 'failed';
    this.hud.showScreen('screen-failed');
  }

  onBusted() {
    this.audio.failSting();
    this.audio.setSiren(false);
    this.missions.active = false;
    this.state = 'busted';
    this.hud.showScreen('screen-busted');
  }

  onWrecked() {
    this.audio.failSting();
    this.audio.setSiren(false);
    this.missions.active = false;
    this.state = 'wrecked';
    this.hud.showScreen('screen-wrecked');
  }

  showWin() {
    this.state = 'win';
    this.hud.setWin('Total earned: $' + this.save.totalEarned.toLocaleString('en-US') + ' · Missions: 6 / 6');
    this.hud.showScreen('screen-win');
    this.audio.jingle();
  }

  indexOf(m) { return CONFIG.missions.indexOf(m); }

  world() {
    const p = this.playerPos();
    return {
      time: this.time, player: { x: p.x, z: p.z, speed: p.speed, heading: p.heading, onFoot: this.onFoot, car: this.onFoot ? null : this.playerCar },
      traffic: this.traffic, police: this.police,
    };
  }

  // ---- carjacking ----
  exitCar() {
    if (this.onFoot || !this.playerCar) return;
    const c = this.playerCar;
    c.speed = 0;
    // Step out to the driver's side.
    this.pedX = c.x - Math.cos(c.heading) * 2.2;
    this.pedZ = c.z + Math.sin(c.heading) * 2.2;
    this.walkHeading = c.heading;
    this.onFoot = true;
    this.ped.visible = true;
    this.ped.position.set(this.pedX, 0, this.pedZ);
    this.ped.rotation.y = this.walkHeading;
    this.hud.toast('On foot — walk up to a car and press E', '');
    this.audio.click();
  }

  enterCar() {
    if (!this.onFoot) return;
    // Nearest owned parked car or traffic car.
    let best = null, bd = 4.5;
    for (const c of this.ownedCars) {
      const d = Math.hypot(c.x - this.pedX, c.z - this.pedZ);
      if (d < bd) { bd = d; best = { car: c, owned: true }; }
    }
    const near = this.traffic.nearestCar(this.pedX, this.pedZ, 4.5);
    if (near && (!best || Math.hypot(near.x - this.pedX, near.z - this.pedZ) < bd)) {
      best = { car: near, owned: false };
    }
    if (!best) { this.hud.toast('No car in reach', 'bad'); return; }
    if (!best.owned) {
      // Carjacking: take the traffic car.
      this.traffic.removeCar(best.car);
      this.traffic.replenish();
      this.police.addWanted(CONFIG.crime.carjack);
      this.audio.crash(0.4);
      this.hud.toast('Car stolen — wanted level up!', 'bad');
      this.missions.onPlayerStoleCar(best.car, this.world());
      best.car.health = CONFIG.car.health;
      best.car.lastCrashAt = -10;
    } else {
      this.audio.click();
      best.car.health = Math.max(best.car.health ?? 0, 40);
      if (best.car.lastCrashAt === undefined) best.car.lastCrashAt = -10;
    }
    const car = best.car;
    this.playerCar = car;
    if (!this.ownedCars.includes(car)) this.ownedCars.push(car);
    this.onFoot = false;
    this.ped.visible = false;
    this.playerCar.speed = 0;
  }

  // ---- per-frame ----
  frame() {
    const now = performance.now();
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.crimeCooldown = Math.max(0, this.crimeCooldown - dt);

    if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'title') {
      this.traffic.update(dt, null);
      this.updateCamera(dt, true);
    } else if (this.state === 'complete' || this.state === 'failed' || this.state === 'busted' || this.state === 'wrecked' || this.state === 'win') {
      this.traffic.update(dt, null);
      this.updateCamera(dt, false);
    }

    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();

    // Screenshot readiness: a few settled frames after the scene is set up.
    // The chase needs longer so the pack converges into the frame.
    if (this.shotMode) {
      this.shotFrames++;
      const need = this.shotMode === 'chase' ? 45 : 15;
      if (this.shotFrames === need) window.__shotReady = true;
    }
  }

  updatePlaying(dt) {
    const input = this.input;
    // Pause.
    if (input.pressed('KeyP') || input.pressed('Escape')) {
      this.state = 'paused';
      this.hud.showScreen('screen-pause');
      this.audio.setSiren(false);
      return;
    }
    // Radio and mute.
    if (input.pressed('KeyR')) this.audio.nextStation();
    if (input.pressed('KeyM')) this.toggleMute();
    // Enter / exit the car.
    if (input.pressed('KeyE')) {
      if (this.onFoot) this.enterCar();
      else this.exitCar();
    }

    const p = this.playerPos();
    if (this.onFoot) {
      // Walk relative to the camera.
      const w = input.walk();
      const camFwd = new THREE.Vector3();
      this.camera.getWorldDirection(camFwd);
      camFwd.y = 0; camFwd.normalize();
      const camRight = new THREE.Vector3().crossVectors(camFwd, new THREE.Vector3(0, 1, 0)).negate();
      const mx = camFwd.x * w.fwd + camRight.x * w.strafe;
      const mz = camFwd.z * w.fwd + camRight.z * w.strafe;
      const ml = Math.hypot(mx, mz);
      if (ml > 0.01) {
        this.pedX += (mx / ml) * WALK_SPEED * dt;
        this.pedZ += (mz / ml) * WALK_SPEED * dt;
        this.walkHeading = Math.atan2(mx / ml, mz / ml);
        const cl = clampToCity(this.pedX, this.pedZ, 4);
        this.pedX = cl[0]; this.pedZ = cl[1];
      }
      this.ped.position.set(this.pedX, 0, this.pedZ);
      this.ped.rotation.y = this.walkHeading;
      // Keep the pedestrian out of buildings.
      const fake = { x: this.pedX, z: this.pedZ, radius: 0.6, speed: 0, heading: 0, mesh: this.ped };
      collideBuildings(fake, this.buildings);
      this.pedX = fake.x; this.pedZ = fake.z;
    } else {
      // Drive.
      const d = input.drive();
      stepCar(this.playerCar, dt, d);
      const impact = collideBuildings(this.playerCar, this.buildings);
      if (impact > 6) this.damageCar(impact, 'building');
      const cl = clampToCity(this.playerCar.x, this.playerCar.z, 2);
      this.playerCar.x = cl[0]; this.playerCar.z = cl[1];
    }

    // Traffic and pedestrians (and their collisions with the player car).
    const ev = this.traffic.update(dt, this.onFoot ? null : this.playerCar);
    if (ev.hitTraffic.length && this.crimeCooldown <= 0) {
      this.crimeCooldown = 2;
      this.police.addWanted(CONFIG.crime.hitTraffic);
      this.damageCar(8, 'traffic');
      this.hud.toast('You hit traffic — wanted level up!', 'bad');
    }
    if (ev.hitPed && this.crimeCooldown <= 0) {
      this.crimeCooldown = 2;
      this.police.addWanted(CONFIG.crime.hitPedestrian);
      this.hud.toast('You hit a pedestrian!', 'bad');
    }

    // Police, helicopter, busted.
    const pev = this.police.update(dt, { x: p.x, z: p.z, speed: this.onFoot ? 0 : this.playerCar.speed, heading: p.heading, onFoot: this.onFoot, car: this.onFoot ? null : this.playerCar }, this.time);
    if (pev.rammed) this.damageCar(pev.ramImpact * 0.5, 'police');
    if (pev.busted) { this.onBusted(); return; }

    // Health regen after a quiet spell.
    if (this.playerCar && this.time - this.playerCar.lastCrashAt > 3) {
      this.playerCar.health = Math.min(CONFIG.car.health, this.playerCar.health + CONFIG.car.regen * dt);
    }
    if (this.playerCar && this.playerCar.health <= 0) { this.onWrecked(); return; }

    // Missions.
    this.missions.update(dt, this.world());

    // Audio: engine follows speed, siren when the law is close.
    this.audio.setEngine(Math.abs(this.playerCar ? this.playerCar.speed : 0) / CONFIG.car.maxSpeed, this.onFoot);
    this.audio.setSiren(this.police.wanted > 0 && this.police.cops.length > 0);

    // Camera and HUD.
    this.updateCamera(dt, false);
    this.updateHUD();
  }

  damageCar(amount, kind) {
    if (!this.playerCar) return;
    this.playerCar.health -= amount;
    this.playerCar.lastCrashAt = this.time;
    this.shake = Math.min(1, this.shake + 0.5);
    this.audio.crash(Math.min(1, amount / 14));
    if (kind === 'building') this.hud.toast('Crash!', 'bad');
  }

  updateCamera(dt, cinematic) {
    const p = this.playerPos();
    let wantPos, wantLook;
    if (cinematic && this.cinematic) {
      wantPos = new THREE.Vector3(this.cinematic.pos[0], this.cinematic.pos[1], this.cinematic.pos[2]);
      wantLook = new THREE.Vector3(this.cinematic.look[0], this.cinematic.look[1], this.cinematic.look[2]);
    } else if (this.onFoot) {
      const back = 6.5, up = 3.2;
      wantPos = new THREE.Vector3(
        p.x - Math.sin(p.heading) * back,
        up,
        p.z - Math.cos(p.heading) * back,
      );
      wantLook = new THREE.Vector3(p.x, 1.4, p.z);
    } else {
      const back = 11.5, up = 4.6;
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      wantPos = new THREE.Vector3(p.x - fx * back, up, p.z - fz * back);
      wantLook = new THREE.Vector3(p.x + fx * 9, 1.3, p.z + fz * 9);
    }
    const k = cinematic ? 1 - Math.exp(-dt * 1.2) : 1 - Math.exp(-dt * 5.5);
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    // A touch of shake on hard impacts.
    if (this.shake > 0.01) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      this.camPos.x += (Math.random() - 0.5) * this.shake * 0.5;
      this.camPos.y += (Math.random() - 0.5) * this.shake * 0.4;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  updateHUD() {
    const p = this.playerPos();
    const kmh = Math.abs(this.playerCar && !this.onFoot ? this.playerCar.speed : 0) * CONFIG.display.kmh;
    const gear = this.onFoot ? 'FOOT' : (this.playerCar.speed < -0.5 ? 'R' : (Math.abs(this.playerCar.speed) < 0.5 ? 'N' : 'D'));
    this.hud.setSpeed(kmh, gear);
    this.hud.setWanted(this.police.wanted);
    this.hud.setMoney(this.money);
    this.hud.setHealth(this.playerCar ? this.playerCar.health / CONFIG.car.health : 1);
    const beacon = this.missions.beacon.visible
      ? { x: this.missions.beacon.position.x, z: this.missions.beacon.position.z }
      : null;
    this.hud.drawMinimap({
      player: { x: p.x, z: p.z, heading: p.heading },
      objective: beacon,
      cops: this.police.cops.map((c) => ({ x: c.x, z: c.z })),
      heli: this.police.heli ? { x: this.police.heli.position.x, z: this.police.heli.position.z } : null,
      traffic: this.traffic.cars.slice(0, 14).map((c) => ({ x: c.x, z: c.z })),
      time: this.time,
    });
  }
}

new Game();
