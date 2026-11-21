import * as THREE from 'three';
import type { Part } from '../world/build';

interface Cell {
  bounds: THREE.Box3;
  sphere: THREE.Sphere;
  indices: number[];
  extent: number;
}

// Large Paris meshes combine buildings along kilometres of bank into a single draw.
// Keep the original vertices and material, but submit only tiles in the camera or its reflection.
export function visibleBatches(world: THREE.Scene): Part {
  const frustum = new THREE.Frustum(), clip = new THREE.Matrix4(), wide = new THREE.PerspectiveCamera();
  const last = new THREE.Vector3(Infinity,0,0), facing = new THREE.Vector3(), dir = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const point = new THREE.Vector3(), reflected = new THREE.Sphere();
  const batches: {cells: Cell[]; geometry: THREE.BufferGeometry; index: THREE.BufferAttribute; ranges: {main:number;reflection:number}}[] = [];
  world.updateMatrixWorld(true);
  for (const mesh of world.children) {
    if (!(mesh instanceof THREE.Mesh) || mesh instanceof THREE.InstancedMesh || !mesh.name.startsWith('shared-')) continue;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute('position'), original = geometry.index;
    const length = original?.count ?? positions.count;
    const tiles = new Map<string, Cell>();
    const get = (n:number) => original ? original.getX(n) : n;
    for (let i=0; i<length; i+=3) {
      const a=get(i), b=get(i+1), c=get(i+2);
      const x = (positions.getX(a)+positions.getX(b)+positions.getX(c))/3;
      const z = (positions.getZ(a)+positions.getZ(b)+positions.getZ(c))/3;
      point.fromBufferAttribute(positions,a);
      ab.fromBufferAttribute(positions,b).sub(point);
      ac.fromBufferAttribute(positions,c).sub(point);
      // Long, slender posts still read against the sky even when their faces cover little area.
      const height = Math.max(positions.getY(a),positions.getY(b),positions.getY(c))
        - Math.min(positions.getY(a),positions.getY(b),positions.getY(c));
      const extent = Math.max(Math.sqrt(ab.cross(ac).length() * .5), Math.min(3,height*.65));
      const sizeBin = Math.ceil(Math.log2(Math.max(.015,extent)));
      const key = Math.floor(x/48) + ',' + Math.floor(z/48) + ',' + sizeBin;
      let tile = tiles.get(key);
      if (!tile) {
        tile = {bounds:new THREE.Box3(), sphere:new THREE.Sphere(), indices:[],extent:2**sizeBin};
        tiles.set(key,tile);
      }
      for (const j of [a,b,c]) {
        tile.indices.push(j);
        point.fromBufferAttribute(positions,j).applyMatrix4(mesh.matrixWorld);
        tile.bounds.expandByPoint(point);
      }
    }
    const cells = Array.from(tiles.values());
    for (const cell of cells) cell.bounds.getBoundingSphere(cell.sphere);
    const index = new THREE.BufferAttribute(positions.count>65535 ? new Uint32Array(2*length) : new Uint16Array(2*length), 1);
    const ranges = {main:0, reflection:0};
    const callback = mesh.onBeforeRender;
    mesh.onBeforeRender = function(renderer,scene,camera,...args) {
      const main = camera.layers.isEnabled(2);
      geometry.setDrawRange(main?0:index.count/2,main?ranges.main:ranges.reflection);
      callback.call(this,renderer,scene,camera,...args);
    };
    index.setUsage(THREE.DynamicDrawUsage);
    geometry.setIndex(index);
    batches.push({cells,geometry,index,ranges});
  }
  let aspect = 0, fov = 0;
  return {update(_dt,_time,view) {
    const cam = view as THREE.PerspectiveCamera;
    cam.getWorldDirection(dir);
    if (last.distanceToSquared(cam.position)<4 && dir.dot(facing)>.999 && cam.aspect===aspect && cam.fov===fov) return;
    last.copy(cam.position); facing.copy(dir); aspect=cam.aspect; fov=cam.fov;
    wide.copy(cam); wide.fov=Math.min(150,cam.fov+6); wide.aspect*=1.06; wide.updateProjectionMatrix();
    clip.multiplyMatrices(wide.projectionMatrix,cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(clip);
    for (const {cells,index,ranges} of batches) {
      let main=0, reflection=0;
      const half=index.count/2;
      for (const cell of cells) {
        const sphere=cell.sphere;
        reflected.copy(sphere); reflected.center.y *= -1;
        if (!frustum.intersectsSphere(sphere) && !frustum.intersectsSphere(reflected)) continue;
        const d = Math.max(8, sphere.center.distanceTo(cam.position) - sphere.radius);
        // Roof ornaments, railings and mouldings below a few pixels merge into the façade.
        if (cell.extent < d * .0055) continue;
        index.array.set(cell.indices,main);
        main+=cell.indices.length;
        if (cell.extent < d * .022) continue;
        index.array.set(cell.indices,half+reflection);
        reflection+=cell.indices.length;
      }
      ranges.main=main;
      ranges.reflection=reflection;
      index.clearUpdateRanges();
      if (main) index.addUpdateRange(0,main);
      if (reflection) index.addUpdateRange(half,reflection);
      index.needsUpdate=true;
    }
  }};
}
