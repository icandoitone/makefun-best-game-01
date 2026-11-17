// Neon Streets — the law. One job: the wanted level, police cars that chase,
// ram and box the player in, the busted timer, and the helicopter.
import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG, streetCoords } from './config.js';
import { createCar, collideBuildings, collideCars } from './car.js';

const COP_COLORS = [0xe8e8e8, 0x1a1d24];

export class Police {
  constructor(scene, buildings) {
    this.scene = scene;
    this.buildings = buildings;
    this.cops = [];
    this.wanted = 0;
    this.unseenTimer = 0;
    this.bustedTimer = 0;
    this.heli = null;
    this.heliSpot = null;
    this.heliCone = null;
    this.heliPool = null;
    this.flashT = 0;
    this.flashOn = false;
    this.streets = streetCoords();
    this.half = CONFIG.city.half;
  }

  setWanted(n) {
    this.wanted = Math.max(0, Math.min(5, Math.round(n)));
    if (this.wanted === 0) this.unseenTimer = 0;
    this.syncCops();
  }

  addWanted(n) { this.setWanted(this.wanted + n); }

  // Match the number of police cars to the wanted level.
  syncCops() {
    const want = this.wanted === 0 ? 0 : Math.min(CONFIG.police.maxCars, this.wanted + (this.wanted >= 3 ? 1 : 0));
    while (this.cops.length < want) this.spawnCop();
    while (this.cops.length > want) {
      const c = this.cops.pop();
      this.scene.remove(c.mesh);
    }
  }

  spawnCop() {
    const s = this.streets[Math.floor(Math.random() * this.streets.length)];
    const along = -this.half + Math.random() * this.half * 2;
    const onX = Math.random() < 0.5;
    const car = createCar(COP_COLORS[this.cops.length % COP_COLORS.length], onX ? along : s, onX ? s : along, Math.random() * Math.PI * 2, true);
    car.speed = 0;
    this.scene.add(car.mesh);
    this.cops.push(car);
  }

  // Stage the pack around a point (used by the chase screenshot): each cop
  // starts on a ring around the player, already facing it, at chase speed.
  placeNear(x, z) {
    for (let i = 0; i < this.cops.length; i++) {
      const c = this.cops[i];
      const a = Math.PI + (i - (this.cops.length - 1) / 2) * 0.9;
      const d = 20 + i * 5;
      c.x = x + Math.sin(a) * d;
      c.z = z + Math.cos(a) * d;
      c.heading = Math.atan2(x - c.x, z - c.z);
      c.speed = CONFIG.police.chaseSpeed * 0.8;
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.heading;
    }
  }

  // Helicopter: body, tail, spinning rotor, a spotlight and a visible cone.
  ensureHeli() {
    if (this.heli) return;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x223044 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 6.4), bodyMat);
    g.add(body);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 5.4), bodyMat);
    tail.position.set(0, 0.2, -5.4);
    g.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.8, 1.2), bodyMat);
    fin.position.set(0, 0.8, -7.6);
    g.add(fin);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, 0.7), new THREE.MeshLambertMaterial({ color: 0x11141c }));
    rotor.position.y = 1.1;
    g.add(rotor);
    g.userData.rotor = rotor;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    lamp.position.set(0, -0.9, 2.4);
    g.add(lamp);
    this.heliSpot = new THREE.SpotLight(0xfff2b0, 900, 90, 0.32, 0.45, 1.2);
    this.heliSpot.position.set(0, -0.8, 2.4);
    g.add(this.heliSpot);
    this.heliSpot.target = new THREE.Object3D();
    this.scene.add(this.heliSpot.target);
    // Visible light cone and the bright pool it throws on the street.
    this.heliCone = new THREE.Mesh(
      new THREE.ConeGeometry(7, 32, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.heliCone.rotation.x = Math.PI;
    this.scene.add(this.heliCone);
    this.heliPool = new THREE.Mesh(
      new THREE.CircleGeometry(6.5, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.heliPool.rotation.x = -Math.PI / 2;
    this.heliPool.position.y = 0.05;
    this.scene.add(this.heliPool);
    g.position.set(0, 34, 0);
    this.scene.add(g);
    this.heli = g;
  }

  removeHeli() {
    if (!this.heli) return;
    this.scene.remove(this.heli);
    this.scene.remove(this.heliSpot.target);
    this.scene.remove(this.heliCone);
    this.scene.remove(this.heliPool);
    this.heli = null; this.heliSpot = null; this.heliCone = null; this.heliPool = null;
  }

  reset() {
    for (const c of this.cops) this.scene.remove(c.mesh);
    this.cops = [];
    this.removeHeli();
    this.wanted = 0;
    this.unseenTimer = 0;
    this.bustedTimer = 0;
  }

  // Is any cop close enough to see the player, or is the helicopter up?
  isSeen(player) {
    if (this.heli) return true;
    for (const c of this.cops) {
      if (Math.hypot(c.x - player.x, c.z - player.z) < CONFIG.police.sight) return true;
    }
    return false;
  }

  update(dt, player, time) {
    const ev = { busted: false, rammed: false, ramImpact: 0 };
    const cfg = CONFIG.police;
    // Wanted decay: only when nobody sees you and you are not speeding.
    const speeding = Math.abs(player.speed) > CONFIG.crime.speedLimit;
    if (this.wanted > 0 && !this.isSeen(player) && !speeding) {
      this.unseenTimer += dt;
      if (this.unseenTimer >= cfg.decaySeen) {
        this.unseenTimer = 0;
        this.setWanted(this.wanted - 1);
      }
    } else {
      this.unseenTimer = 0;
    }
    // Helicopter at high wanted levels.
    if (this.wanted >= cfg.heliAtWanted) this.ensureHeli();
    else this.removeHeli();

    // Chase, ram, and box in.
    let bustedNear = false;
    for (let i = 0; i < this.cops.length; i++) {
      const c = this.cops[i];
      // Target: the leader aims at the player; others aim ahead / to the side
      // so the pack tries to box the player in.
      let tx = player.x, tz = player.z;
      if (i === 1) {
        tx = player.x + Math.sin(player.heading) * 13;
        tz = player.z + Math.cos(player.heading) * 13;
      } else if (i >= 2) {
        const side = i % 2 === 0 ? 1 : -1;
        tx = player.x + Math.cos(player.heading) * side * 10;
        tz = player.z - Math.sin(player.heading) * side * 10;
      }
      const dx = tx - c.x;
      const dz = tz - c.z;
      const want = Math.atan2(dx, dz);
      let diff = want - c.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.max(-2.9, Math.min(2.9, diff * 3));
      c.heading += turn * dt;
      const dist = Math.hypot(dx, dz);
      const targetSpeed = dist > 26 ? cfg.chaseSpeed : cfg.ramSpeed;
      c.speed += (targetSpeed - c.speed) * Math.min(1, dt * 0.9);
      c.x += Math.sin(c.heading) * c.speed * dt;
      c.z += Math.cos(c.heading) * c.speed * dt;
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.heading;
      collideBuildings(c, this.buildings);
      // Ram the player.
      if (player.car) {
        const impact = collideCars(player.car, c);
        if (impact > 5) { ev.rammed = true; ev.ramImpact = Math.max(ev.ramImpact, impact); }
      }
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d < cfg.bustedDist && Math.abs(player.speed) < 2.2) bustedNear = true;
      if (player.onFoot && d < 6) bustedNear = true;
    }
    // Busted timer: crawling (or on foot) with a cop right on you.
    if (bustedNear) {
      this.bustedTimer += dt;
      if (this.bustedTimer >= cfg.bustedTime) { ev.busted = true; this.bustedTimer = 0; }
    } else {
      this.bustedTimer = Math.max(0, this.bustedTimer - dt * 2);
    }
    // Flashing light bars.
    this.flashT += dt;
    if (this.flashT > 0.28) {
      this.flashT = 0;
      this.flashOn = !this.flashOn;
      for (const c of this.cops) {
        const r = c.mesh.userData.lightRed;
        const b = c.mesh.userData.lightBlue;
        if (r && b) {
          r.material.color.setHex(this.flashOn ? 0xff2233 : 0x550000);
          b.material.color.setHex(this.flashOn ? 0x001133 : 0x2266ff);
        }
      }
    }
    // Helicopter follows from above, spotlight locked on the player.
    if (this.heli) {
      const h = this.heli;
      const tx = player.x + Math.sin(time * 0.4) * 4;
      const tz = player.z + Math.cos(time * 0.33) * 4;
      h.position.x += (tx - h.position.x) * Math.min(1, dt * 1.4);
      h.position.z += (tz - h.position.z) * Math.min(1, dt * 1.4);
      h.position.y = 33 + Math.sin(time * 0.8) * 1.2;
      h.userData.rotor.rotation.y += dt * 22;
      h.rotation.y = Math.atan2(player.x - h.position.x, player.z - h.position.z);
      this.heliSpot.target.position.set(player.x, 0, player.z);
      this.heliCone.position.set(h.position.x, h.position.y - 16, h.position.z);
      this.heliPool.position.set(player.x, 0.05, player.z);
    }
    return ev;
  }
}
