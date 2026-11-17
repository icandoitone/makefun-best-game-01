// Neon Streets — the story. One job: run the six missions in order — their
// objectives, timers, markers, and what completes or fails each one.
import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG } from './config.js';

const REACH = 9; // how close counts as "arrived" at a marker

export class Missions {
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;
    this.index = 0;
    this.active = false;
    this.timer = null;
    this.tail = null;      // tail-mission state
    this.carjack = null;   // carjack-mission state
    this.checkpoint = 0;   // gauntlet progress
    this.startedAt = 0;
    this.elapsed = 0;
    // The objective beacon: a light column, a ground ring and a bobbing gem.
    this.beacon = new THREE.Group();
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 42, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x29e6ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    col.position.y = 21;
    this.beacon.add(col);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.4, 6.6, 32),
      new THREE.MeshBasicMaterial({ color: 0x29e6ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    this.beacon.add(ring);
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.5),
      new THREE.MeshBasicMaterial({ color: 0x29e6ff }),
    );
    gem.position.y = 9;
    this.beacon.add(gem);
    this.beacon.userData = { col, ring, gem };
    this.beacon.visible = false;
    scene.add(this.beacon);
    this.followCar = null;
  }

  setBeacon(x, z, color) {
    this.beacon.visible = true;
    this.beacon.position.set(x, 0, z);
    const c = color || 0x29e6ff;
    this.beacon.userData.col.material.color.setHex(c);
    this.beacon.userData.ring.material.color.setHex(c);
    this.beacon.userData.gem.material.color.setHex(c);
  }

  hideBeacon() { this.beacon.visible = false; this.followCar = null; }

  mission() { return CONFIG.missions[this.index]; }

  start(i, world) {
    this.index = i;
    const m = this.mission();
    this.active = true;
    this.elapsed = 0;
    this.timer = m.time || null;
    this.checkpoint = 0;
    this.tail = null;
    this.carjack = null;
    this.followCar = null;
    this.hooks.tailMeter(false, 0);
    this.hooks.timer(this.timer);
    this.hooks.objective(m.briefing);
    this.hooks.banner(m.name);
    if (m.type === 'goto' || m.type === 'timed' || m.type === 'escape') {
      this.setBeacon(m.point[0], m.point[1]);
    } else if (m.type === 'tail') {
      const target = world.traffic.spawnTarget(m.tailFrom, m.tailTo);
      this.tail = { car: target, meter: 0.5, farT: 0, closeT: 0 };
      this.followCar = target;
      this.setBeacon(target.x, target.z, 0xffc233);
    } else if (m.type === 'carjack') {
      const car = world.traffic.spawnParked(m.carPoint[0], m.carPoint[1], Math.PI / 2);
      this.carjack = { car, phase: 'walk', stolen: false };
      this.setBeacon(m.carPoint[0], m.carPoint[1], 0xffc233);
      this.hooks.objective('Get out of your car (E) and walk to the gold coupe.');
    } else if (m.type === 'gauntlet') {
      this.setBeacon(m.points[0][0], m.points[0][1]);
    }
    if (m.wanted) world.police.setWanted(m.wanted);
    this.startedAt = world.time || 0;
  }

  // Called by the game when the player steals a car.
  onPlayerStoleCar(car, world) {
    if (!this.active || !this.carjack || this.carjack.phase !== 'walk') return;
    if (car !== this.carjack.car) return;
    this.carjack.phase = 'drive';
    this.carjack.stolen = true;
    const m = this.mission();
    this.setBeacon(m.point[0], m.point[1]);
    this.hooks.objective('Now drop the coupe at the beacon. The cops saw that.');
    this.hooks.toast('Car stolen — the law is coming', 'bad');
  }

  complete(world) {
    if (!this.active) return;
    this.active = false;
    this.hideBeacon();
    this.hooks.tailMeter(false, 0);
    const m = this.mission();
    this.hooks.complete(m, { time: this.elapsed });
  }

  fail(reason) {
    if (!this.active) return;
    this.active = false;
    this.hideBeacon();
    this.hooks.tailMeter(false, 0);
    this.hooks.fail(reason);
  }

  at(x, z, point, radius) {
    return Math.hypot(x - point[0], z - point[1]) < (radius || REACH);
  }

  update(dt, world) {
    if (!this.active) return;
    const m = this.mission();
    const p = world.player;
    this.elapsed += dt;
    if (this.timer !== null) {
      this.timer -= dt;
      this.hooks.timer(Math.max(0, this.timer));
      if (this.timer <= 0) { this.fail('Out of time.'); return; }
    }
    // Beacon follows a moving target and pulses.
    if (this.followCar) {
      this.beacon.position.set(this.followCar.x, 0, this.followCar.z);
    }
    if (this.beacon.visible) {
      const s = 1 + Math.sin(world.time * 3) * 0.08;
      this.beacon.userData.gem.position.y = 9 + Math.sin(world.time * 2) * 1.2;
      this.beacon.userData.gem.rotation.y = world.time * 1.5;
      this.beacon.userData.ring.scale.set(s, s, 1);
    }

    if (m.type === 'goto' || m.type === 'escape') {
      if (this.at(p.x, p.z, m.point)) this.complete(world);
    } else if (m.type === 'timed') {
      if (this.at(p.x, p.z, m.point)) this.complete(world);
    } else if (m.type === 'tail') {
      const t = this.tail;
      if (!t) return;
      const d = Math.hypot(p.x - t.car.x, p.z - t.car.z);
      const arrived = this.at(t.car.x, t.car.z, m.tailTo, 12);
      if (d < 8) {
        t.meter -= 0.15 * dt;
        t.closeT += dt;
        this.hooks.objective('TOO CLOSE — back off!');
        if (t.closeT > 6) { this.fail('You were made. The target called it in.'); return; }
      } else if (d > 50) {
        t.meter -= 0.12 * dt;
        t.farT += dt;
        this.hooks.objective('LOSING HIM — close the gap!');
        if (t.farT > 8) { this.fail('You lost the target in traffic.'); return; }
      } else {
        t.meter += 0.18 * dt;
        t.closeT = 0; t.farT = 0;
        this.hooks.objective('Stay in the goldilocks zone. Follow the gold beacon.');
      }
      t.meter = Math.max(0, Math.min(1, t.meter));
      this.hooks.tailMeter(true, t.meter);
      if (t.meter <= 0) { this.fail('Your tail went cold.'); return; }
      if (arrived && t.meter > 0.25) this.complete(world);
      else if (arrived) { this.fail('You arrived, but the target knew.'); return; }
    } else if (m.type === 'carjack') {
      const cj = this.carjack;
      if (!cj) return;
      if (cj.phase === 'walk' && !p.onFoot) {
        this.hooks.objective('Get out of your car (E) and walk to the gold coupe.');
      }
      if (cj.phase === 'drive' && this.at(p.x, p.z, m.point)) this.complete(world);
    } else if (m.type === 'gauntlet') {
      const pts = m.points;
      if (this.checkpoint < pts.length) {
        if (this.at(p.x, p.z, pts[this.checkpoint])) {
          this.checkpoint++;
          if (this.checkpoint < pts.length) {
            this.setBeacon(pts[this.checkpoint][0], pts[this.checkpoint][1]);
            this.hooks.banner('Checkpoint ' + this.checkpoint + ' / ' + pts.length);
            this.hooks.objective('Checkpoint ' + (this.checkpoint + 1) + ' of ' + pts.length + ' — follow the beacon.');
          } else {
            this.setBeacon(m.point[0], m.point[1]);
            this.hooks.banner('Final stretch — reach the safehouse!');
            this.hooks.objective('All checkpoints clear. Reach the safehouse beacon.');
          }
        }
      } else if (this.at(p.x, p.z, m.point)) {
        this.complete(world);
      }
    }
  }
}
