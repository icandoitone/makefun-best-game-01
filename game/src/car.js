// Neon Streets — cars. One job: build a car mesh, drive it with arcade
// physics, and resolve its collisions with buildings and other cars.
import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG } from './config.js';

const WHEEL_R = 0.42;

export function buildCarMesh(color, isPolice) {
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x11141c });
  const glass = new THREE.MeshLambertMaterial({ color: 0x0e2a3a, emissive: 0x0a2028 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.2), paint);
  body.position.y = 0.62;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.1), glass);
  cabin.position.set(0, 1.18, -0.25);
  g.add(cabin);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.22, 4.24), dark);
  skirt.position.y = 0.32;
  g.add(skirt);
  // Headlights (front is +z) and taillights.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a3c });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), headMat);
    h.position.set(s * 0.62, 0.66, 2.12);
    g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), tailMat);
    t.position.set(s * 0.62, 0.66, -2.12);
    g.add(t);
  }
  if (isPolice) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.4), dark);
    bar.position.set(0, 1.52, -0.25);
    g.add(bar);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42), new THREE.MeshBasicMaterial({ color: 0xff2233 }));
    red.position.set(-0.28, 1.53, -0.25);
    g.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    blue.position.set(0.28, 1.53, -0.25);
    g.add(blue);
    g.userData.lightRed = red;
    g.userData.lightBlue = blue;
  }
  // Wheels: cylinders with the axle along x.
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.34, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0a0a0c });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0x8a929e });
  g.userData.wheels = [];
  g.userData.frontWheels = [];
  for (const [x, z, front] of [[-0.98, 1.35, true], [0.98, 1.35, true], [-0.98, -1.35, false], [0.98, -1.35, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_R, z);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    pivot.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 8), hubMat);
    hub.rotation.z = Math.PI / 2;
    pivot.add(hub);
    g.add(pivot);
    g.userData.wheels.push(pivot);
    if (front) g.userData.frontWheels.push(pivot);
  }
  return g;
}

export function createCar(color, x, z, heading, isPolice) {
  const mesh = buildCarMesh(color, isPolice);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  return {
    mesh, heading, speed: 0, steerVis: 0,
    x, z, health: CONFIG.car.health, lastCrashAt: -10, radius: CONFIG.car.radius,
    isPolice: !!isPolice,
  };
}

// Arcade driving step. controls: {throttle, brake, steer, handbrake} (0..1, steer -1..1).
export function stepCar(car, dt, c) {
  const cfg = CONFIG.car;
  const prevSpeed = car.speed;
  if (c.throttle) car.speed += cfg.accel * dt;
  if (c.brake) {
    if (car.speed > 0.5) car.speed -= cfg.brake * dt;
    else car.speed -= cfg.accel * 0.55 * dt; // reverse
  }
  // Drag and rolling resistance.
  car.speed -= car.speed * cfg.drag * dt;
  if (c.handbrake) car.speed -= car.speed * cfg.handbrakeDrag * dt;
  if (!c.throttle && !c.brake) car.speed -= car.speed * 0.4 * dt;
  car.speed = Math.max(-cfg.maxReverse, Math.min(cfg.maxSpeed, car.speed));
  if (Math.abs(car.speed) < 0.05 && !c.throttle && !c.brake) car.speed = 0;
  // Steering: sharper with the handbrake, reversed when reversing.
  const speedN = car.speed / cfg.maxSpeed;
  const grip = c.handbrake ? cfg.handbrakeGrip : cfg.grip;
  car.heading += c.steer * grip * speedN * dt * 1.35;
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  // Mesh follows the physics state.
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.steerVis += (c.steer * 0.42 - car.steerVis) * Math.min(1, dt * 10);
  for (const w of car.mesh.userData.frontWheels) w.rotation.y = car.steerVis;
  const spin = (car.speed * dt) / WHEEL_R;
  for (const w of car.mesh.userData.wheels) {
    const wheel = w.children[0];
    wheel.rotation.x += spin;
    w.children[1].rotation.x += spin;
  }
  return Math.abs(car.speed - prevSpeed);
}

// Push a car out of any building it overlaps. Returns impact speed (0 = none).
export function collideBuildings(car, buildings) {
  let impact = 0;
  const r = car.radius;
  for (const b of buildings) {
    const cx = Math.max(b.minX, Math.min(car.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(car.z, b.maxZ));
    const dx = car.x - cx;
    const dz = car.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    const d = Math.sqrt(d2) || 0.001;
    const push = r - d;
    const nx = dx / d;
    const nz = dz / d;
    car.x += nx * push;
    car.z += nz * push;
    // Kill the velocity component driving into the wall.
    const into = Math.sin(car.heading) * nx + Math.cos(car.heading) * nz;
    const along = car.speed * into;
    if (along > 0) {
      impact = Math.max(impact, along);
      car.speed *= 0.45;
    }
    car.mesh.position.set(car.x, 0, car.z);
  }
  return impact;
}

// Circle-vs-circle between two cars. Pushes both apart, returns impact.
export function collideCars(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const min = a.radius + b.radius - 0.4;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min || d2 === 0) return 0;
  const d = Math.sqrt(d2);
  const push = (min - d) / 2;
  const nx = dx / d;
  const nz = dz / d;
  a.x -= nx * push; a.z -= nz * push;
  b.x += nx * push; b.z += nz * push;
  const rel = Math.abs(a.speed - b.speed);
  a.speed *= 0.6; b.speed *= 0.6;
  a.mesh.position.set(a.x, 0, a.z);
  b.mesh.position.set(b.x, 0, b.z);
  return rel;
}
