import * as THREE from 'three';
import type { Kit } from '../world/materials';

// On a voyage change preserve the boat and kit. After context loss
// release every cached GPU handle while retaining scene objects and their CPU data for upload.
export function releaseGraphics(world: THREE.Scene, player?: THREE.Group, kit?: Kit) {
  const retained = new Set<unknown>();
  const preserve = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object' || retained.has(obj)) return;
    retained.add(obj);
    if (obj instanceof THREE.Material || Object.getPrototypeOf(obj) === Object.prototype) {
      Object.values(obj).forEach(preserve);
    }
  };
  preserve(kit);
  player?.traverse(o => {
    if (o instanceof THREE.Mesh) {
      retained.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(preserve);
    }
  });
  const released = new Set<unknown>();
  const dispose = (obj: { dispose(): void }) => {
    if (retained.has(obj) || released.has(obj)) return;
    released.add(obj);
    obj.dispose();
  };
  world.traverse(o => {
    const draw = o as THREE.Mesh;
    if (draw.geometry) dispose(draw.geometry);
    if (draw.material) {
      for (const mat of Array.isArray(draw.material) ? draw.material : [draw.material]) {
        if (retained.has(mat)) continue;
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) dispose(v);
        if (mat instanceof THREE.ShaderMaterial) {
          for (const u of Object.values(mat.uniforms)) if (u.value instanceof THREE.Texture) dispose(u.value);
        }
        dispose(mat);
      }
    }
    if (o instanceof THREE.InstancedMesh) dispose(o);
  });
}
