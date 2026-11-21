import * as THREE from 'three';
import { inject, withAtmo } from '../core/atmosphere';
import { addCollider } from '../world/collide';

type Side = 1 | -1;
const step = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
const bell = (x: number, w: number) => Math.exp(-(x * x) / (w * w));
const clock = { value: 0 };
const rows = [-4, 0, 2, 4, 6, 9, 13, 18, 24, 31, 39, 48, 57, 66, 76, 87, 99, 113, 129, 148, 169, 194, 224, 264, 310, 370, 460, 590, 800, 1200];
const dz = 4;
const z0 = -1800;
const z1 = 876;

function lattice(x: number, y: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number) {
  const i = Math.floor(x), j = Math.floor(y);
  const u = step(0, 1, x - i), v = step(0, 1, y - j);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(lattice(i,j), lattice(i+1,j), u),
    THREE.MathUtils.lerp(lattice(i,j+1), lattice(i+1,j+1), u), v);
}
function randomSource() {
  let state = 61478;
  return () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 4294967296);
}
function meadow(s: Side, z: number) {
  return s === 1 ? bell(z + 65, 140) : bell(z + 645, 108);
}
function shore(s: Side, z: number) {
  return 95 + 26 * Math.sin(z * .0063 + s * 1.9) + 21 * Math.cos(z * .0158 - s)
    + 4 * (noise(z * .08, s) - .5) + 2.5 * Math.sin(z * .057 + s);
}

// Glacial spurs separated by steep drainage channels. The apron at the
// waterline widens at the farm terraces and narrows under the hanging valley.
function elevation(s: Side, d: number, z: number) {
  const meadowWeight = meadow(s, z);
  const falls = s === -1 ? bell(z + 238, 68) : 0;
  const shelf = 7 + 22 * noise(z * .014, 6 + s) + 43 * meadowWeight - 10 * falls;
  const t = d - shelf;
  const n = noise(z * .008 + s * 15, d * .008 + 12);
  const ravine = Math.abs(Math.sin(z * .013 + d * .008 + 2.3 * noise(z * .012, s + d * .004)));
  const spur = 25 + 140 * n + 50 * ravine ** .65 + 36 * falls;
  const cliffWidth = 40 + 72 * (1 - n);
  const mainCliff = step(-5, cliffWidth, t) * spur * (1 - .69 * meadowWeight);
  const escarpment = step(45, 350, d) * (110 + 180 * noise(z * .0035 + s, d * .003) + 74 * ravine);
  const slope = step(1, 20, t);
  const fracture = 20 * (noise(z * .053 + d * .012, d * .029 + s) - .5)
    + 48 * (noise(z * .025, d * .021 - s) - .5)
    + 9 * (noise(z * .084, d * .076) - .5);
  return -1.7 + .41 * Math.min(d, shelf + 4) + mainCliff + escarpment + slope * fracture
    + step(2, 16, d) * (2 * noise(z * .087, d * .12) - 1);
}

function geometry(positions: number[], colors: number[], indices: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

const striation = `
 float fjHash(vec2 p) {
   vec3 q=fract(vec3(p.xyx)*.1031);
   q+=dot(q,q.yzx+33.33);
   return fract((q.x+q.y)*q.z);
 }
 float fjNoise(vec2 p) {
   vec2 i=floor(p),f=fract(p);
   f=f*f*(3.-2.*f);
   return mix(mix(fjHash(i),fjHash(i+vec2(1,0)),f.x),mix(fjHash(i+vec2(0,1)),fjHash(i+1.),f.x),f.y);
 }
`;
function rockMaterial() {
  return withAtmo(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 }), 'fjord-schist', shader => {
    shader.vertexShader = 'varying vec3 vRock;\n' + inject(shader.vertexShader, '#include <begin_vertex>', 'vRock = position;');
    shader.fragmentShader = 'varying vec3 vRock;\n' + striation + inject(shader.fragmentShader, '#include <color_fragment>', `
      vec2 p = vec2(vRock.z + .35*vRock.x, vRock.y + .23*vRock.x);
      float relief = fjNoise(p*.048);
      float bedding = p.y*.74 + .33*p.x + 12.*relief + 6.*sin(p.x*.064);
      float veins = fjNoise(vec2(p.x*.073, bedding));
      float crack = fjNoise(vec2(p.x*.50 + p.y*.21, p.y*.054));
      float slab = smoothstep(.27,.72,relief*.48 + veins*.33 + crack*.19);
      diffuseColor.rgb *= mix(vec3(.42,.53,.64),vec3(1.30,1.27,1.17),slab);
      diffuseColor.rgb += vec3(.045,.050,.050)*smoothstep(.69,.91,veins)*smoothstep(.38,.68,crack);
    `);
  });
}

const schist = new THREE.Color(0x737d82), lichen = new THREE.Color(0xa4a092);
const woods = new THREE.Color(0x405746), field = new THREE.Color(0x869062);
const wet = new THREE.Color(0x46545a), snow = new THREE.Color(0xd4d9d8);

function bank(scene: THREE.Scene, side: Side, material: THREE.Material) {
  const p: number[] = [], color: number[] = [], index: number[] = [];
  const tint = new THREE.Color();
  for (let z = z0; z <= z1; z += dz) {
    const coast = shore(side, z);
    for (const [j, d] of rows.entries()) {
      const y = elevation(side, d, z), slope = Math.abs(elevation(side, d + 1, z) - y);
      const facets = noise(z * .022, d * .026);
      const vegetation = 1 - step(.35, 1.48, slope + (noise(z * .077, d * .047) - .5) * .7);
      tint.copy(schist).lerp(lichen, step(.27, .76, facets));
      const turf = field.clone().lerp(woods, step(.2,.78, noise(z*.024+side, d*.017)));
      tint.lerp(turf, vegetation * (1 - step(185,282,y)));
      tint.multiplyScalar(.66 + .42 * facets + .28 * step(.03,.68, noise(z*.076,d*.061)));
      tint.lerp(wet, .75 * (1 - step(0,2.2,y)));
      tint.lerp(snow, step(307,322,y + 27 * facets + 12 * Math.sin(z*.034)) * (1 - step(.65,1.6,slope)));
      const a = p.length / 3, b = a - 1, c = a - rows.length, e = c - 1;
      p.push(side*(coast+d),y,z);
      color.push(tint.r,tint.g,tint.b);
      if (j && z > z0) {
        if (side===1) index.push(e,b,c,b,a,c);
        else index.push(e,c,b,b,c,a);
      }
    }
  }
  scene.add(new THREE.Mesh(geometry(p,color,index),material));
}

// Sample the same triangles as the visible bank so short trees, footings and
// boulders meet the mesh even on the broken ledges between height samples.
function ground(s: Side, x: number, z: number) {
  const za=z0+Math.floor((z-z0)/dz)*dz, fz=(z-za)/dz;
  const d=s*x-THREE.MathUtils.lerp(shore(s,za),shore(s,za+dz),fz);
  let i=1;
  while(i < rows.length-1 && rows[i] < d) i++;
  const da=rows[i-1], db=rows[i], fd=THREE.MathUtils.clamp((d-da)/(db-da),0,1);
  const a=elevation(s,da,za), b=elevation(s,da,za+dz), c=elevation(s,db,za);
  if (fd+fz<=1) return a+(b-a)*fz+(c-a)*fd;
  const e=elevation(s,db,za+dz);
  return e+(b-e)*(1-fd)+(c-e)*(1-fz);
}
function waterline(s: Side, z: number) {
  let lo=0,hi=10;
  const x=s*shore(s,z);
  for(let i=0;i<10;i++) {
    const m=(lo+hi)/2;
    if(ground(s,x+s*m,z)>0) hi=m;
    else lo=m;
  }
  return x+s*lo;
}
function solidShore(s: Side) {
  const radius=1.8, spacing=4, start=-1000;
  // Reserve 25 cm at irregular inter-sample corners for the rocking hull.
  const offset=radius-.25;
  let x=waterline(s,start)+s*offset;
  for(let z=start+spacing;z<=336;z+=spacing) {
    const next=waterline(s,z)+s*offset;
    addCollider({x:(x+next)/2,z:z-spacing/2,yaw:Math.atan2(next-x,spacing),
      hw:radius,hl:.5*Math.hypot(next-x,spacing)+radius,r:radius});
    x=next;
  }
}

// Interleaving headlands wrap the horizon round the bend. The farther ridge
// has a broken snow line and continues into the visible walls on each side.
function mountains(scene: THREE.Scene, material: THREE.Material) {
  const p:number[]=[], col:number[]=[], index:number[]=[];
  for(const end of [-1,1]) for(let tier=0;tier<4;tier++) {
    const count=237, base=p.length/3;
    for(let j=0;j<=12;j++) for(let i=0;i<count;i++) {
      const x=(i-(count-1)/2)*17, f=j/12;
      const peaks=200*noise(x*.0027+tier*5,end)+134*noise(x*.0065,tier+22)
        +60*noise(x*.018,tier)+16*noise(x*.044,tier-end);
      const saddle=1-.74*bell(x-(tier%2?-220:180),210);
      const y=-9+(28+tier*34+peaks*saddle)*f**.80+f*(1-f)*70*(noise(x*.024,j*.22)-.5);
      const z=end*((end<0?1165:790)+tier*260+j*17+108*Math.sin(x*.0031+tier*2)+38*noise(x*.016,j*.15));
      const tint=schist.clone().lerp(woods,(1-f)*.77).lerp(snow,step(250+tier*15,275+tier*15,y+29*noise(x*.025,j*.3)));
      tint.multiplyScalar(.67+.56*noise(x*.02,j*.22));
      p.push(x,y,z);col.push(tint.r,tint.g,tint.b);
      if(i&&j){
        const a=base+j*count+i,b=a-1,c=a-count,e=c-1;
        if(end<0) index.push(e,c,b,b,c,a); else index.push(e,b,c,b,a,c);
      }
    }
  }
  scene.add(new THREE.Mesh(geometry(p,col,index),material));
}

interface Piece {
  x:number; y:number; z:number; w:number; h:number; l:number; color:number;
  yaw?:number; tilt?:number;
}
function batch(scene:THREE.Scene, shape:THREE.BufferGeometry, pieces:Piece[], vertexColors=false) {
  const mat=withAtmo(new THREE.MeshStandardMaterial({roughness:.96,vertexColors}));
  const inst=new THREE.InstancedMesh(shape,mat,pieces.length), dummy=new THREE.Object3D(), color=new THREE.Color();
  pieces.forEach((p,i)=>{
    dummy.position.set(p.x,p.y,p.z);dummy.scale.set(p.w,p.h,p.l);
    dummy.rotation.set(0,p.yaw||0,p.tilt||0,'YXZ');dummy.updateMatrix();
    inst.setMatrixAt(i,dummy.matrix);inst.setColorAt(i,color.setHex(p.color));
  });
  inst.computeBoundingSphere();
  scene.add(inst);
}
function conifer(){
  const v:number[]=[],c:number[]=[],ix:number[]=[];
  const rings=[[0,.043],[.12,.042],[.12,.28],[.20,.43],[.38,.19],[.34,.38],[.56,.14],[.48,.29],[.73,.10],[.66,.19],[1,.003]];
  const sides=7;
  for(const [j,[y,r]] of rings.entries()) for(let i=0;i<sides;i++) {
    const angle=i*2*Math.PI/sides+.12*Math.sin(j*1.7), rad=r*(.83+.25*noise(i*3,j));
    v.push(Math.cos(angle)*rad,y+r*.09*Math.sin(i*2+j),Math.sin(angle)*rad);
    const b=j<2?.29:j%2?.70:1;
    c.push(b,b,b);
    if(j) {
      const a=j*sides+i,k=j*sides+(i+1)%sides;
      ix.push(a-sides,a,k,a-sides,k,k-sides);
    }
  }
  return geometry(v,c,ix);
}
function vegetation(scene:THREE.Scene,rand:()=>number) {
  const trees:Piece[]=[], boulders:Piece[]=[];
  const shades=[0x395346,0x4c6552,0x576e57,0x657852,0x778565];
  const stones=[0x727a77,0x808984,0x535e60,0x92938a,0x697474];
  for(let i=0;i<22500;i++) {
    const s=rand()<.5?-1:1, z=-1400+rand()*1930, d=4+rand()**1.8*248;
    const x=s*(shore(s,z)+d), y=ground(s,x,z);
    if(y<.35 || y>206 || (meadow(s,z)>.52 && d<36)) continue;
    const slope=Math.abs(ground(s,x+s*1.5,z)-y)/1.5;
    if(slope>1.6 || noise(z*.029,d*.042)< .25+slope*.18) continue;
    const h=(3.1+rand()**1.5*8.1)*(1-.52*step(115,210,y)),w=h*(.48+rand()*.17);
    trees.push({x,y:y-.25,z,w,h,l:w,color:shades[Math.floor(rand()*shades.length)],yaw:rand()*6.28});
  }
  for(let i=0;i<3600;i++) {
    const s=rand()<.5?-1:1,z=-1050+rand()*1440,d=6.3+rand()**2*44;
    const x=s*(shore(s,z)+d),y=ground(s,x,z);
    if(y<.35||noise(z*.035,d*.073)<.35||meadow(s,z)>.70&&d>12)continue;
    const w=.45+rand()**2*2.8;
    boulders.push({x,y:y-.12,z,w,h:w*(.30+rand()*.57),l:w*(.68+rand()*.53),
      yaw:rand()*6.28,tilt:(rand()-.5)*.30,color:stones[Math.floor(rand()*stones.length)]});
  }
  batch(scene,conifer(),trees,true);
  batch(scene,new THREE.DodecahedronGeometry(.73),boulders);
}
function hamlets(scene:THREE.Scene) {
  const pieces:Piece[]=[];
  const box=(x:number,y:number,z:number,w:number,h:number,l:number,color:number,yaw=0,tilt=0)=>
    pieces.push({x,y,z,w,h,l,color,yaw,tilt});
  for(const s of [-1,1] as const) {
    const center=s===1?-83:-648;
    const palette=[0x9e433b,0xcfbc99,0xa96645,0xe2d6bf,0x883c32,0xa28b68,0xc7b194];
    for(let i=0;i<7;i++) {
      const z=center+(i-3)*10+Math.sin(i*5)*2;
      const d=9+(i%3)*7;
      const x=s*(shore(s,z)+d), y=ground(s,x,z);
      const w=4.1+noise(i,s)*2.0,l=5.2+noise(s,i+13)*2.6,h=2.4+(i%3)*.48;
      const yaw=(i%3===0?Math.PI/2:0)+.21*Math.sin(i*2.7+s);
      const local=(xx:number,yy:number,zz:number,ww:number,hh:number,ll:number,tint:number,tilt=0)=>
        box(x+xx*Math.cos(yaw)+zz*Math.sin(yaw),y+yy,z-xx*Math.sin(yaw)+zz*Math.cos(yaw),ww,hh,ll,tint,yaw,tilt);
      const walls=palette[i%palette.length];
      local(0,-.68,0,w+.14,2.4,l+.12,0x666861);
      local(0,.48+h/2,0,w,h,l,walls);
      // Gable boarding, weatherboards, white cornerboards and mullions.
      for(let j=0;j<11;j++){
        const hh=w*.31*(1-j/11);
        for(const g of [-1,1]) local(g*w*j/22,.48+h+hh/2,0,w/11,hh,l-.02,walls);
      }
      for(let j=1;j<h/.29;j++) local(0,.48+j*.29,0,w+.05,.025,l+.05,0x796e59);
      for(const wing of [-1,1]){
        local(wing*(w/4+.1),.48+h+w*.153,0,(w/2+.43)/Math.cos(.57),.16,l+.63,0x424a49,-wing*.57);
        for(const end of [-1,1])local(wing*w*.498,.48+h*.5,end*l*.498,.11,h,.11,0xe7ddc8);
        for(const zz of [-l*.27,l*.26]) {
          local(wing*w*.508,1.45,zz,.13,1.06,.88,0xe8deca);
          local(wing*(w/2+.085),1.45,zz,.07,.86,.67,0x48585b);
          local(wing*(w/2+.13),1.45,zz,.04,.84,.052,0xd9d3b9);
          local(wing*(w/2+.13),1.45,zz,.04,.062,.68,0xd9d3b9);
        }
      }
      local(0,1.27,-l/2,1.02,1.75,.16,0xe0d4b8);
      local(0,1.26,-l/2-.10,.77,1.60,.09,0x59665e);
      local(0,.43,-l/2-.40,1.4,.18,.92,0x7d796b);
      local(w*.17,.48+h+w*.30,l*.25,.47,1.13,.52,0x70695d);
    }
    const z=center+2,edge=waterline(s,z);
    box(edge-s*3,.80,z,13,.24,2.35,0x8b7964);
    for(let j=0;j<25;j++)box(edge-s*(-3+j*.51),.96,z,.47,.08,2.42,j%3===1?0x978571:0x8d7960);
    for(const a of [-1.0,3.1,8.5])for(const k of [-.97,.97]){
      box(edge-s*a,-.1,z+k,.30,2.9,.30,0x595c55);
      box(edge-s*a,1.4,z+k,.33,.12,.33,0xbbb3a0);
    }
    box(edge-s*3.4,1.4,z+1.04,11,.12,.11,0xab9880);
    addCollider({x:edge-s*3,z,hl:6.5,hw:1.21,r:.11,yaw:Math.PI/2});
  }
  batch(scene,new THREE.BoxGeometry(1,1,1),pieces);
}

function falls(scene:THREE.Scene) {
  const p:number[]=[],uv:number[]=[],ix:number[]=[];
  for(let stream=0;stream<7;stream++) {
    const base=p.length/3, top=76+((stream*19)%26), width=[3.9,1.2,2.2,5.8,1.8,3.5,1.6][stream];
    const z0=-221-stream*7.8;
    for(let j=0;j<=100;j++) {
      const t=j/100, d=top*(1-t);
      const z=z0+4.5*Math.sin(2.7*t+stream*.53)+3.7*t*t;
      const w=width*(.62+t*.84)*(1+.19*Math.sin(t*15+stream));
      for(let k=0;k<=4;k++){
        const u=k/4,zz=z+(u-.5)*2*w;
        // Offset each ribbon in the riverward direction. White water hangs
        // free of the rough wall on upper drops and fans over the lower ledge.
        const x=-(shore(-1,zz)+d);
        const y=Math.max(.18,ground(-1,x,zz)+1.7+.30*Math.sin(u*Math.PI));
        p.push(x+2.3+2.5*Math.sin(t*Math.PI),y,zz);
        uv.push(u,t+stream*1.76);
        if(j&&k){
          const a=base+j*5+k;
          ix.push(a-6,a-5,a,a-6,a,a-1);
        }
      }
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);
  const mat=withAtmo(new THREE.MeshBasicMaterial({color:0xe1efea,transparent:true,side:THREE.DoubleSide,depthWrite:false}),
    'fjord-cascade',s=>{
      s.uniforms.uFlow=clock;
      s.vertexShader='varying vec2 vFalls;\n'+inject(s.vertexShader,'#include <begin_vertex>','vFalls=uv;');
      s.fragmentShader='varying vec2 vFalls;uniform float uFlow;\n'+striation+inject(s.fragmentShader,'#include <color_fragment>',`
        float spray=fjNoise(vec2(vFalls.x*7.,vFalls.y*49.-uFlow*4.));
        float channels=fjNoise(vec2(14.*vFalls.x+1.5*spray,vFalls.y*4.-uFlow*.18));
        float edge=smoothstep(0.,.20,vFalls.x)*smoothstep(0.,.20,1.-vFalls.x);
        diffuseColor.a=edge*mix(.45,.95,channels)*(.70+.30*spray);
        diffuseColor.rgb*=.82+.40*spray;
      `);
    });
  scene.add(new THREE.Mesh(g,mat));
}

export function buildFjord(scene:THREE.Scene):void {
  clock.value=0;
  const stone=rockMaterial();
  for(const side of [-1,1] as const){bank(scene,side,stone);solidShore(side);}
  mountains(scene,stone);
  vegetation(scene,randomSource());
  hamlets(scene);
  falls(scene);
}
export function updateFjord(dt:number):void { clock.value+=dt; }
