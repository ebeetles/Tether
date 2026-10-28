import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DecorData } from '../sim/level';
import { flameTexture, worldUVs, type MaterialLib } from './materials';
import { patchFog } from './sky';
import { bannerCanvas, textureFrom } from './textures';

const DEG = Math.PI / 180;

/**
 * Collects static geometry by material and merges each bucket into one mesh, so the
 * whole map draws in a few dozen calls (spec risk: "merge static level geometry").
 */
export class StaticBatcher {
  private readonly buckets = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();

  constructor(readonly mats: MaterialLib) {}

  add(geo: THREE.BufferGeometry, matName: string, tint: string | undefined, matrix: THREE.Matrix4, cast = true): void {
    const key = `${matName}|${tint ?? ''}|${cast}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { mat: this.mats.get(matName, tint), cast, geos: [] }));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    b.geos.push(g);
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast && !(b.mat as THREE.MeshStandardMaterial).transparent;
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const g of b.geos) g.dispose();
    }
    return group;
  }
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const one = new THREE.Vector3(1, 1, 1);

export function placement(pos: number[], rotDeg: number[] = [0, 0, 0]): THREE.Matrix4 {
  e.set(rotDeg[0] * DEG, rotDeg[1] * DEG, rotDeg[2] * DEG, 'YXZ');
  return m4.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q.setFromEuler(e), one);
}

export function boxGeo(size: number[], tile: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  worldUVs(g, tile);
  return g;
}

export function cylGeo(radius: number, height: number, tile: number, radiusTop = radius, segments = 24): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radiusTop, radius, height, segments);
  worldUVs(g, tile, { radius, height });
  return g;
}

function prismGeo(width: number, height: number, depth: number, tile: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  worldUVs(g, tile);
  return g;
}

/** Things in the scene that animate each frame. */
export interface Animated {
  update(time: number, dt: number): void;
}

export interface Torch {
  pos: THREE.Vector3;
  flame: THREE.Sprite;
  light: THREE.PointLight | null;
  seed: number;
}

export interface DecorBuild {
  dynamic: THREE.Group;
  animated: Animated[];
  torches: Torch[];
}

/** Build every decor item: static parts go into the batcher, moving parts into `dynamic`. */
export function buildDecor(items: DecorData[], batch: StaticBatcher): DecorBuild {
  const mats = batch.mats;
  const dynamic = new THREE.Group();
  const animated: Animated[] = [];
  const torches: Torch[] = [];
  const bannerCache = new Map<string, THREE.Material>();
  const bannerMat = (color: string, emblem: string, tail: boolean) => {
    const key = `${color}|${emblem}|${tail}`;
    let m = bannerCache.get(key);
    if (!m) {
      const tex = textureFrom(bannerCanvas(color, emblem, tail));
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      m = patchFog(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 }));
      bannerCache.set(key, m);
    }
    return m;
  };

  items.forEach((d, index) => {
    switch (d.type) {
      case 'box': {
        const mat = d.mat ?? 'plain';
        batch.add(boxGeo(d.size, mats.tile(mat)), mat, d.color, placement(d.pos, d.rot));
        break;
      }
      case 'cylinder': {
        const mat = d.mat ?? 'plain';
        batch.add(cylGeo(d.radius, d.height, mats.tile(mat), d.radiusTop ?? d.radius), mat, d.color, placement(d.pos));
        break;
      }
      case 'cone': {
        const mat = d.mat ?? 'roof';
        const g = new THREE.ConeGeometry(d.radius, d.height, d.segments ?? 24);
        worldUVs(g, mats.tile(mat), { radius: d.radius, height: d.height });
        g.translate(0, d.height / 2, 0);
        // Distant hills don't need to cast shadows into the castle.
        batch.add(g, mat, d.color, placement(d.pos), mat !== 'hill');
        break;
      }
      case 'gable': {
        const mat = d.mat ?? 'plaster';
        batch.add(prismGeo(d.width, d.height, d.depth, mats.tile(mat)), mat, undefined, placement(d.pos, [0, d.yaw ?? 0, 0]));
        break;
      }
      case 'tree': {
        const h = d.height, r = d.radius ?? h * 0.35;
        const trunkH = d.kind === 'pine' ? h * 0.35 : h * 0.45;
        batch.add(cylGeo(h * 0.045, trunkH, 1.5, h * 0.03, 8), 'bark', undefined, placement([d.pos[0], d.pos[1] + trunkH / 2, d.pos[2]]));
        const rnd = seeded(index + 7);
        if (d.kind === 'pine') {
          for (let i = 0; i < 4; i++) {
            const cr = r * (1 - i * 0.2), ch = h * 0.32;
            const g = new THREE.ConeGeometry(cr, ch, 9);
            g.translate(0, ch / 2, 0);
            batch.add(g, 'pine', undefined, placement([d.pos[0], d.pos[1] + h * 0.25 + i * h * 0.17, d.pos[2]], [0, rnd() * 90, 0]));
          }
        } else {
          for (let i = 0; i < 5; i++) {
            const br = r * (0.55 + rnd() * 0.35);
            const g = new THREE.IcosahedronGeometry(br, 1);
            const a = rnd() * Math.PI * 2, off = i === 0 ? 0 : r * 0.55;
            batch.add(g, 'foliage', ['#7a9a45', '#8aa64c', '#6f8f3c'][i % 3], placement([
              d.pos[0] + Math.cos(a) * off, d.pos[1] + h * 0.62 + (i === 0 ? h * 0.12 : rnd() * h * 0.15), d.pos[2] + Math.sin(a) * off,
            ]));
          }
        }
        break;
      }
      case 'banner': {
        const [w, h] = d.size;
        const g = new THREE.PlaneGeometry(w, h);
        g.translate(0, -h / 2, 0);
        const mesh = new THREE.Mesh(g, bannerMat(d.color ?? '#7a1c1c', d.emblem ?? '⚜', true));
        mesh.position.set(d.pos[0], d.pos[1], d.pos[2]);
        mesh.rotation.y = (d.yaw ?? 0) * DEG;
        mesh.castShadow = true;
        dynamic.add(mesh);
        const phase = index * 1.7;
        animated.push({ update: (t) => { mesh.rotation.x = Math.sin(t * 1.3 + phase) * 0.04 + Math.sin(t * 2.9 + phase) * 0.015; } });
        break;
      }
      case 'flag': {
        batch.add(cylGeo(0.07, d.height, 1, 0.05, 6), 'darkwood', undefined, placement([d.pos[0], d.pos[1] + d.height / 2, d.pos[2]]));
        const g = new THREE.PlaneGeometry(3.2, 1.8, 12, 1);
        g.translate(1.6, 0, 0);
        const mesh = new THREE.Mesh(g, bannerMat(d.color ?? '#1f3f8a', '⚜', false));
        mesh.position.set(d.pos[0], d.pos[1] + d.height - 1, d.pos[2]);
        mesh.rotation.y = (d.yaw ?? 0) * DEG;
        dynamic.add(mesh);
        const base = g.attributes.position.array.slice();
        const pos = g.attributes.position as THREE.BufferAttribute;
        const phase = index * 0.9;
        animated.push({
          update: (t) => {
            for (let i = 0; i < pos.count; i++) {
              const x = base[i * 3];
              pos.setZ(i, Math.sin(x * 1.6 - t * 5 + phase) * 0.18 * (x / 3.2));
            }
            pos.needsUpdate = true;
          },
        });
        break;
      }
      case 'torch': {
        batch.add(boxGeo([0.12, 0.5, 0.12], 1), 'iron', undefined, placement([d.pos[0], d.pos[1] - 0.25, d.pos[2]]));
        batch.add(cylGeo(0.14, 0.18, 1, 0.2, 8), 'iron', undefined, placement([d.pos[0], d.pos[1] + 0.05, d.pos[2]]));
        const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTexture(), color: new THREE.Color('#ffb46b').multiplyScalar(3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
        flame.position.set(d.pos[0], d.pos[1] + 0.45, d.pos[2]);
        flame.scale.set(0.7, 1.1, 1);
        dynamic.add(flame);
        let light: THREE.PointLight | null = null;
        if (d.light) {
          light = new THREE.PointLight('#ff9a4a', 30, 16, 2);
          light.position.copy(flame.position);
          dynamic.add(light);
        }
        torches.push({ pos: flame.position.clone(), flame, light, seed: index * 3.1 });
        break;
      }
      case 'sails': {
        const hub = new THREE.Group();
        hub.position.set(d.pos[0], d.pos[1], d.pos[2]);
        hub.rotation.y = (d.yaw ?? 0) * DEG;
        const rotor = new THREE.Group();
        const wood = mats.get('darkwood');
        const cloth = mats.get('plain', '#e8dcc0').clone();
        cloth.side = THREE.DoubleSide;
        for (let i = 0; i < 4; i++) {
          const blade = new THREE.Group();
          const spar = new THREE.Mesh(new THREE.BoxGeometry(d.radius, 0.3, 0.3), wood);
          spar.position.x = d.radius / 2;
          const sail = new THREE.Mesh(new THREE.PlaneGeometry(d.radius * 0.8, 2.2), cloth);
          sail.position.set(d.radius * 0.55, 1.2, 0.1);
          for (const m of [spar, sail]) m.castShadow = true;
          blade.add(spar, sail);
          blade.rotation.z = (i * Math.PI) / 2;
          rotor.add(blade);
        }
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1, 12).rotateX(Math.PI / 2), wood);
        rotor.add(cap);
        hub.add(rotor);
        dynamic.add(hub);
        animated.push({ update: (t) => { rotor.rotation.z = (t / d.period) * Math.PI * 2; } });
        break;
      }
      case 'water': {
        const mat = mats.get('water');
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(d.radius, 40).rotateX(-Math.PI / 2), mat);
        mesh.position.set(d.pos[0], d.pos[1], d.pos[2]);
        mesh.receiveShadow = true;
        dynamic.add(mesh);
        break;
      }
    }
  });
  return { dynamic, animated, torches };
}

function seeded(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
