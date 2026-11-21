import * as THREE from 'three';
import { env, withAtmo } from '../core/atmosphere';
import { rng } from '../core/util';
import { LIGHT_GEOMETRY } from '../core/env';
import { mainOnly, type Ctx, type Part } from './build';

/** 雨燕：夏天傍晚巴黎天上那些尖叫着兜圈子的小黑点。天一黑就散了。 */
export function build(ctx: Ctx): Part {
  const r = rng(88);
  const N = 22;
  // 一只鸟：两片后掠的镰刀翅膀
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.1, 0.34, 0, 0.1, 0.07, 0, 0.03,
    0, 0, -0.1, -0.07, 0, 0.03, -0.34, 0, 0.1,
    0, 0, -0.11, 0.035, 0, 0.14, -0.035, 0, 0.14,
  ], 3));
  g.computeVertexNormals();
  const mat = withAtmo(new THREE.MeshBasicMaterial({ color: 0x17161a, side: THREE.DoubleSide }), 'bird');
  const im = new THREE.InstancedMesh(g, mat, N);
  im.frustumCulled = false;
  ctx.scene.add(im);
  if (LIGHT_GEOMETRY) mainOnly(im);
  const birds = Array.from({ length: N }, () => ({ R: 22 + r() * 46, h: 24 + r() * 44, w: (0.28 + r() * 0.3) * r.sign(), ph: r() * 6.28, ph2: r() * 6.28, ox: (r() - 0.5) * 70, oz: (r() - 0.5) * 160, s: 0.9 + r() * 0.5 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const centre = new THREE.Vector3(0, 0, 100);
  return {
    update(dt, t, cam) {
      const gone = Math.max(0, Math.min(1, (env.dusk - 0.62) / 0.2));
      // 鸟群的中心慢慢跟着船，停在前方的河面上空
      centre.x += (cam.position.x * 0.3 - centre.x) * Math.min(1, dt * 0.2);
      centre.z += (cam.position.z - 70 - centre.z) * Math.min(1, dt * 0.2);
      birds.forEach((b, i) => {
        const a = t * b.w + b.ph;
        const x = centre.x + b.ox + Math.cos(a) * b.R, z = centre.z + b.oz + Math.sin(a * 0.83 + b.ph2) * b.R * 1.5;
        const y = b.h + Math.sin(a * 1.7 + b.ph2) * 7 + gone * 120;
        const vx = -Math.sin(a) * b.R * b.w, vz = Math.cos(a * 0.83 + b.ph2) * b.R * 1.5 * b.w * 0.83;
        const flick = Math.sin(t * 19 + b.ph * 7) > 0.2 ? 1 : 0.72; // 扑几下，滑一段
        e.set(0, Math.atan2(-vx, -vz), Math.sin(a * 0.9) * 0.7 * Math.sign(b.w), 'YXZ');
        q.setFromEuler(e);
        const k = b.s * (1 - gone) * 1.5;
        im.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(k * flick, k, k)));
      });
      im.instanceMatrix.needsUpdate = true;
      im.visible = gone < 0.99;
    },
  };
}
