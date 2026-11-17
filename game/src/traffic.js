// Neon Streets — traffic and pedestrians. One job: cars that drive the street
// grid (and turn at intersections), people who walk the sidewalks, and the
// hooks missions use (a tail target, a parked car to steal).
import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG, makeRng, streetCoords, nearestStreet } from './config.js';
import { buildCarMesh, collideCars } from './car.js';

const PALETTE = [0x8a93a6, 0x5a6b7d, 0x7a5a4a, 0x4a6b4a, 0x6b4a5a, 0x9a8a5a, 0x3a4a6b, 0xb0b6c0];
const PED_COLORS = [0xffd76a, 0x7de3ff, 0xff9db0, 0x9dff8a, 0xffb36b];

function headingFor(axis, dir) {
  if (axis === 'x') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

export class Traffic {
  constructor(scene) {
    this.scene = scene;
    this.rng = makeRng(20240);
    this.cars = [];
    this.peds = [];
    this.streets = streetCoords();
    this.half = CONFIG.city.half;
  }

  // ---- cars ----
  spawnCar(x, z, axis, dir, opts) {
    const o = opts || {};
    const color = o.color !== undefined ? o.color : PALETTE[Math.floor(this.rng() * PALETTE.length)];
    const mesh = buildCarMesh(color, false);
    const heading = headingFor(axis, dir);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    this.scene.add(mesh);
    const car = {
      mesh, x, z, heading, axis, dir,
      speed: o.speed !== undefined ? o.speed : CONFIG.traffic.speed * (0.8 + this.rng() * 0.5),
      cruise: o.speed !== undefined ? o.speed : CONFIG.traffic.speed,
      radius: 1.7, dest: o.dest || null, parked: !!o.parked,
      lastJunction: null, target: !!o.target, marked: !!o.marked,
    };
    this.cars.push(car);
    return car;
  }

  spawnInitial(n) {
    for (let i = 0; i < n; i++) this.spawnRandom();
  }

  spawnRandom() {
    const axis = this.rng() < 0.5 ? 'x' : 'z';
    const fixed = this.streets[Math.floor(this.rng() * this.streets.length)];
    const pos = -this.half + this.rng() * this.half * 2;
    const dir = this.rng() < 0.5 ? 1 : -1;
    const lane = (this.rng() < 0.5 ? -1 : 1) * 2.2; // drive on the right side
    if (axis === 'x') return this.spawnCar(pos, fixed + lane, 'x', dir);
    return this.spawnCar(fixed + lane, pos, 'z', dir);
  }

  // A car with a destination: at each junction it picks the turn that gets
  // closest to the destination (greedy). Used by the tail mission.
  spawnTarget(from, to) {
    const axis = 'x';
    const car = this.spawnCar(from[0], nearestStreet(from[1]) + 2.2, axis, from[0] < to[0] ? 1 : -1, {
      dest: to, speed: 13, target: true, marked: true, color: 0x9aa2b0,
    });
    return car;
  }

  // A parked car that does not move. Used by the carjack mission.
  spawnParked(x, z, heading) {
    const car = this.spawnCar(x, z, 'x', 1, { parked: true, speed: 0, marked: true, color: 0xffc233 });
    car.heading = heading;
    car.mesh.rotation.y = heading;
    return car;
  }

  nearestCar(x, z, maxDist) {
    let best = null, bd = maxDist;
    for (const c of this.cars) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  removeCar(car) {
    this.scene.remove(car.mesh);
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
  }

  replenish() {
    if (this.cars.length < CONFIG.traffic.cars) this.spawnRandom();
  }

  // ---- pedestrians ----
  spawnPeds(n) {
    for (let i = 0; i < n; i++) {
      const axis = this.rng() < 0.5 ? 'x' : 'z';
      const street = this.streets[Math.floor(this.rng() * this.streets.length)];
      const off = (this.rng() < 0.5 ? -1 : 1) * (CONFIG.city.roadWidth / 2 + 1.6);
      const pos = -this.half + this.rng() * this.half * 2;
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.4, 1.5, 8),
        new THREE.MeshLambertMaterial({ color: PED_COLORS[Math.floor(this.rng() * PED_COLORS.length)] }),
      );
      body.position.y = 0.95;
      g.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 6),
        new THREE.MeshLambertMaterial({ color: 0xe8b88a }),
      );
      head.position.y = 1.9;
      g.add(head);
      const x = axis === 'x' ? pos : street + off;
      const z = axis === 'x' ? street + off : pos;
      g.position.set(x, 0, z);
      this.scene.add(g);
      this.peds.push({ mesh: g, x, z, axis, dir: this.rng() < 0.5 ? 1 : -1, off, speed: CONFIG.traffic.pedSpeed, down: 0 });
    }
  }

  // ---- per-frame ----
  update(dt, playerCar) {
    const events = { hitTraffic: [], hitPed: false };
    // Move traffic cars.
    for (const c of this.cars) {
      if (c.parked) continue;
      // Slow down for a car ahead on the same street.
      let want = c.cruise;
      for (const o of this.cars) {
        if (o === c || o.parked) continue;
        if (o.axis !== c.axis || o.dir !== c.dir) continue;
        const fixedC = c.axis === 'x' ? c.z : c.x;
        const fixedO = o.axis === 'x' ? o.z : o.x;
        if (Math.abs(fixedC - fixedO) > 3) continue;
        const ahead = (c.axis === 'x' ? o.x - c.x : o.z - c.z) * c.dir;
        if (ahead > 0 && ahead < CONFIG.traffic.minGap) { want = Math.min(want, Math.max(0, o.speed * 0.9)); }
      }
      c.speed += (want - c.speed) * Math.min(1, dt * 2);
      const pos = c.axis === 'x' ? c.x : c.z;
      const nextPos = pos + c.dir * c.speed * dt;
      // Next junction coordinate ahead.
      let jx = null;
      for (const s of this.streets) {
        if (c.dir > 0 && s > pos + 0.5 && (jx === null || s < jx)) jx = s;
        if (c.dir < 0 && s < pos - 0.5 && (jx === null || s > jx)) jx = s;
      }
      if (jx !== null && ((c.dir > 0 && nextPos >= jx) || (c.dir < 0 && nextPos <= jx))) {
        const key = c.axis + ':' + jx;
        if (c.lastJunction !== key) {
          c.lastJunction = key;
          this.decideTurn(c, jx);
        }
      }
      if (c.axis === 'x') c.x = nextPos; else c.z = nextPos;
      // Keep inside the city; turn around at the edge.
      const p = c.axis === 'x' ? c.x : c.z;
      if (Math.abs(p) > this.half - 2) c.dir *= -1;
      // Smooth the mesh heading toward the driving heading.
      const target = headingFor(c.axis, c.dir);
      let diff = target - c.mesh.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      c.mesh.rotation.y += diff * Math.min(1, dt * 5);
      c.mesh.position.set(c.x, 0, c.z);
      // Player collision.
      if (playerCar) {
        const hit = collideCars(playerCar, c);
        if (hit > 4) events.hitTraffic.push(c);
      }
    }
    // Move pedestrians.
    for (const p of this.peds) {
      if (p.down > 0) {
        p.down -= dt;
        if (p.down <= 0) {
          p.mesh.rotation.x = 0;
          const street = this.streets[Math.floor(this.rng() * this.streets.length)];
          const axis = this.rng() < 0.5 ? 'x' : 'z';
          p.axis = axis;
          p.off = (this.rng() < 0.5 ? -1 : 1) * (CONFIG.city.roadWidth / 2 + 1.6);
          p.x = axis === 'x' ? -this.half + this.rng() * this.half * 2 : street + p.off;
          p.z = axis === 'x' ? street + p.off : -this.half + this.rng() * this.half * 2;
          p.dir = this.rng() < 0.5 ? 1 : -1;
        }
        continue;
      }
      const v = p.axis === 'x' ? p.x : p.z;
      const nv = v + p.dir * p.speed * dt;
      if (p.axis === 'x') p.x = nv; else p.z = nv;
      if (Math.abs(nv) > this.half - 2) p.dir *= -1;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = headingFor(p.axis, p.dir);
      if (playerCar) {
        const d = Math.hypot(p.x - playerCar.x, p.z - playerCar.z);
        if (d < 1.9 && Math.abs(playerCar.speed) > 3) {
          p.down = 4;
          p.mesh.rotation.x = Math.PI / 2;
          events.hitPed = true;
        }
      }
    }
    return events;
  }

  // At a junction, pick straight / left / right. With a destination, greedy.
  decideTurn(c, jx) {
    const ix = c.axis === 'x' ? jx : (c.axis === 'x' ? c.z : c.x);
    const iz = c.axis === 'x' ? c.z : jx;
    const curX = c.axis === 'x' ? jx : c.x;
    const curZ = c.axis === 'x' ? c.z : jx;
    const options = [];
    // Straight: same axis and direction.
    options.push({ axis: c.axis, dir: c.dir });
    // Left and right turns.
    if (c.axis === 'x') {
      options.push({ axis: 'z', dir: c.dir > 0 ? 1 : -1 });
      options.push({ axis: 'z', dir: c.dir > 0 ? -1 : 1 });
    } else {
      options.push({ axis: 'x', dir: c.dir > 0 ? -1 : 1 });
      options.push({ axis: 'x', dir: c.dir > 0 ? 1 : -1 });
    }
    let pick = options[0];
    if (c.dest) {
      let best = Infinity;
      for (const o of options) {
        const nx = o.axis === 'x' ? curX + o.dir * CONFIG.city.step : curX;
        const nz = o.axis === 'z' ? curZ + o.dir * CONFIG.city.step : curZ;
        const d = Math.abs(nx - c.dest[0]) + Math.abs(nz - c.dest[1]);
        if (d < best) { best = d; pick = o; }
      }
    } else {
      const r = this.rng();
      pick = r < 0.55 ? options[0] : options[1 + Math.floor(this.rng() * 2)];
    }
    // Snap onto the new street: fixed coordinate becomes the junction line.
    if (pick.axis === 'x') { c.axis = 'x'; c.z = iz; c.x = ix; }
    else { c.axis = 'z'; c.x = ix; c.z = iz; }
    c.dir = pick.dir;
    c.heading = headingFor(c.axis, c.dir);
  }
}
