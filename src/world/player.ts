import * as THREE from 'three';
import { resolveHull, probe, type HullCircle } from './collide';
import { clamp, damp, DEG, wrapPi } from '../core/util';

export interface Input {
  fwd: number; // W / S
  turn: number; // A(+1 左) / D(-1 右)
}
export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

export interface Navigation {
  spawnX: number;
  spawnZ: number;
  halfWidth: number;
  minZ: number;
  maxZ: number;
}
// 覆盖 boat.ts 的 -3.9..2.4 m 船体；相邻圆重叠，船头/船尾转向也受保护。
export const PLAYER_HULL: HullCircle[] = [
  { z: -3.65, r: 0.38 }, { z: -3.1, r: 0.65 }, { z: -2.4, r: 0.88 },
  { z: -1.6, r: 1.0 }, { z: -0.8, r: 1.05 }, { z: 0, r: 1.05 },
  { z: 0.8, r: 1.02 }, { z: 1.6, r: 0.96 }, { z: 2.15, r: 0.87 },
];
const MAX_SPEED = 3.3;
const CURRENT = 0.2; // 水流，往下游（-Z）
const SEAT = new THREE.Vector3(0, 1.24, 0.92); // 坐着时眼睛的位置（船的本地坐标）

/**
 * 玩家：坐在小船里的人。
 * 船的运动是很简单的运动学（油门 → 速度，舵 → 转向），重点放在「坐在水上」的手感：
 * 船身的起伏、转弯时的侧倾、别的船经过后那几下晃，以及头会自己稳住视线。
 */
export class Player {
  x: number;
  z: number;
  heading = 0; // 0 = 朝 -Z（下游）；增大 = 左转
  speed = 0;
  throttle = 0.5;
  rudder = 0;
  auto = true;
  dir = 1; // 自动巡航方向：1 下游，-1 上游
  lookYaw = 0;
  lookPitch = 2 * DEG;
  fov = 43;
  fovTarget = 43;
  fovMin = 16;
  fovMax = 58;
  heave = 0;
  pitch = 0;
  roll = 0;
  kick = 0; // 被别的船的尾波晃到的程度
  wheel = 0; // 方向盘转角（给模型用）
  underBridge = 0;
  atEnd = 0; // 到了河段尽头的提示用
  group = new THREE.Group();
  private eye = new THREE.Vector3();
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private e = new THREE.Euler();
  private lookVelYaw = 0;

  constructor(private navigation: Navigation) {
    this.x = navigation.spawnX;
    this.z = navigation.spawnZ;
    this.group.rotation.order = 'YXZ';
    this.group.name = 'player-boat';
  }

  get forward() {
    return new THREE.Vector2(-Math.sin(this.heading), -Math.cos(this.heading));
  }
  get forward3() {
    return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }

  update(dt: number, t: number, input: Input, _obstacles: Obstacle[]) {
    // 油门
    if (input.fwd !== 0) this.throttle = clamp(this.throttle + input.fwd * dt * 0.45, -0.25, 1);
    const ahead = this.auto ? probe(this.x, this.z, -Math.sin(this.heading), -Math.cos(this.heading), 24, 1.4) : Infinity;
    const targetSpeed = this.throttle * MAX_SPEED * (this.auto ? clamp((ahead - 5) / 14, 0, 1) : 1);
    this.speed = damp(this.speed, targetSpeed, 0.55, dt);

    // 舵
    let rudderTarget = input.turn;
    if (input.turn !== 0) this.auto = false;
    if (this.auto) rudderTarget = this.autopilot();
    this.rudder = damp(this.rudder, rudderTarget, 2.2, dt);
    const turnRate = 0.4 * clamp(Math.abs(this.speed) / 1.3, 0.22, 1.25) * Math.sign(this.speed || 1);
    this.heading = wrapPi(this.heading + this.rudder * turnRate * dt);
    this.wheel = damp(this.wheel, -this.rudder * 2.4, 6, dt);

    // 位移
    const f = this.forward;
    this.x += f.x * this.speed * dt;
    this.z += f.y * this.speed * dt - CURRENT * dt;

    // 完整船身沿障碍物滑开，不允许船头先穿进去再拉回中心。
    const contact = resolveHull(this.x, this.z, this.heading, PLAYER_HULL, this.navigation.halfWidth);
    this.x = contact.x;
    this.z = contact.z;
    if (contact.hit > 0) {
      const into = (f.x * contact.nx + f.y * contact.nz) * Math.sign(this.speed);
      if (into < 0) this.speed *= Math.max(0, 1 - into * into);
    }
    // 河段两端
    this.atEnd = 0;
    if (this.z < this.navigation.minZ + 40) this.atEnd = clamp((this.navigation.minZ + 40 - this.z) / 40, 0, 1);
    if (this.z > this.navigation.maxZ - 40) this.atEnd = clamp((this.z - (this.navigation.maxZ - 40)) / 40, 0, 1);
    this.z = clamp(this.z, this.navigation.minZ, this.navigation.maxZ);
    // 船身的摇晃
    this.kick = damp(this.kick, 0, 0.35, dt);
    const k = this.kick, sp = this.speed / MAX_SPEED;
    this.roll = 0.014 * Math.sin(0.9 * t + 1) + 0.008 * Math.sin(1.7 * t) + k * 0.034 * Math.sin(2.3 * t) - this.rudder * sp * 0.05;
    this.pitch = 0.007 * Math.sin(0.7 * t) + 0.004 * Math.sin(1.3 * t + 2) + k * 0.014 * Math.sin(1.9 * t + 1) + 0.012 * sp;
    this.heave = 0.016 * Math.sin(0.8 * t) + 0.009 * Math.sin(1.5 * t + 0.5) + k * 0.03 * Math.sin(2.1 * t);
    this.group.position.set(this.x, this.heave, this.z);
    this.group.rotation.set(this.pitch, this.heading, this.roll);
    this.group.updateMatrixWorld(true);

    this.fov = damp(this.fov, this.fovTarget, 5, dt);
  }

  /** 自动巡航：靠右行，到了河段尽头从容地掉头 */
  private autopilot() {
    if (this.dir === 1 && this.z < this.navigation.minZ + 70) this.dir = -1;
    if (this.dir === -1 && this.z > this.navigation.maxZ - 80) this.dir = 1;
    const lane = this.dir === 1 ? 9 : -11;
    const tx = lane, tz = this.z - this.dir * 34;
    const desired = Math.atan2(-(tx - this.x), -(tz - this.z));
    return clamp(wrapPi(desired - this.heading) * 1.6, -1, 1);
  }

  look(dx: number, dy: number) {
    this.lookYaw = clamp(this.lookYaw - dx, -175 * DEG, 175 * DEG);
    this.lookPitch = clamp(this.lookPitch - dy, -55 * DEG, 62 * DEG);
  }

  zoom(delta: number) {
    this.fovTarget = clamp(this.fovTarget + delta, this.fovMin, this.fovMax);
  }

  applyCamera(camera: THREE.PerspectiveCamera, t: number) {
    // 眼睛跟着船走；看向哪边，身体会往哪边稍微探一点
    this.eye.copy(SEAT);
    this.eye.x += Math.sin(this.lookYaw) * 0.1;
    this.eye.z -= Math.cos(this.lookYaw) * 0.04 - 0.04;
    this.eye.y += Math.sin(t * 0.33) * 0.004;
    camera.position.copy(this.eye).applyMatrix4(this.group.matrixWorld);
    // 头会自己稳住：只吃一半的船身倾斜
    this.e.set(this.pitch * 0.45, this.heading, this.roll * 0.5, 'YXZ');
    this.qa.setFromEuler(this.e);
    const sw = 0.0022;
    this.e.set(this.lookPitch + Math.sin(t * 0.41 + 1.3) * sw + Math.sin(t * 1.13) * sw * 0.4, this.lookYaw + Math.sin(t * 0.29) * sw * 1.2, Math.sin(t * 0.23 + 0.7) * sw * 0.8, 'YXZ');
    this.qb.setFromEuler(this.e);
    camera.quaternion.copy(this.qa).multiply(this.qb);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);
  }
}
