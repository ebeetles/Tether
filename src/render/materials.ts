import * as THREE from 'three';
import { patchFog } from './sky';
import { PAINTERS, radialSprite, textureFrom } from './textures';

/** Anchors use one consistent glow colour across all maps (spec: Art and audio). */
export const ANCHOR_GLOW = new THREE.Color('#4ff0ff');

interface MatSpec {
  painter?: keyof typeof PAINTERS;
  /** Metres per texture repeat. */
  tile: number;
  color?: string;
  roughness?: number;
  metalness?: number;
  bump?: number;
  emissive?: boolean;
  opacity?: number;
}

const SPECS: Record<string, MatSpec> = {
  stone: { painter: 'stone', tile: 4, roughness: 0.92, bump: 2.2 },
  darkstone: { painter: 'darkstone', tile: 4, roughness: 0.92, bump: 2.2 },
  sandstone: { painter: 'sandstone', tile: 4, roughness: 0.9, bump: 2 },
  cobble: { painter: 'cobble', tile: 4, roughness: 0.95, bump: 1.5 },
  flagstone: { painter: 'flagstone', tile: 7, roughness: 0.9, bump: 1.5 },
  wood: { painter: 'wood', tile: 2, roughness: 0.82, bump: 1.2 },
  darkwood: { painter: 'darkwood', tile: 2, roughness: 0.85, bump: 1.2 },
  plaster: { painter: 'plaster', tile: 4, roughness: 0.95, bump: 1.5 },
  roof: { painter: 'roof', tile: 3, roughness: 0.85, bump: 2.5 },
  slate: { painter: 'slate', tile: 3, roughness: 0.75, bump: 2.5 },
  grass: { painter: 'grass', tile: 6, roughness: 1 },
  hill: { painter: 'meadow', tile: 40, roughness: 1 },
  glass: { painter: 'glass', tile: 6, roughness: 0.2, emissive: true, opacity: 0.92 },
  iron: { tile: 1, color: '#2c2a2e', roughness: 0.45, metalness: 0.75 },
  bronze: { tile: 1, color: '#a26d2c', roughness: 0.35, metalness: 0.85 },
  gold: { tile: 1, color: '#d9a640', roughness: 0.3, metalness: 0.9 },
  cloth: { tile: 1, color: '#7a2a22', roughness: 0.9 },
  leather: { tile: 1, color: '#5a3a24', roughness: 0.8 },
  foliage: { tile: 1, color: '#7a9a45', roughness: 0.9 },
  pine: { tile: 1, color: '#4a6e46', roughness: 0.9 },
  bark: { painter: 'darkwood', tile: 1.5, roughness: 0.95, bump: 2 },
  water: { tile: 1, color: '#2f5f6e', roughness: 0.08, metalness: 0.1, opacity: 0.88 },
  plain: { tile: 4, color: '#a3aab4', roughness: 0.9 },
};

/** Materials are shared and cached; every one gets the sky-matched fog patch. */
export class MaterialLib {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly textures = new Map<string, { map: THREE.Texture; bump?: THREE.Texture }>();

  tile(name: string): number {
    return (SPECS[name] ?? SPECS.plain).tile;
  }

  get(name = 'plain', tint?: string): THREE.MeshStandardMaterial {
    const key = `${name}|${tint ?? ''}`;
    let m = this.cache.get(key);
    if (m) return m;
    const spec = SPECS[name] ?? SPECS.plain;
    m = new THREE.MeshStandardMaterial({
      color: tint ?? spec.color ?? '#ffffff',
      roughness: spec.roughness ?? 0.9,
      metalness: spec.metalness ?? 0,
      transparent: (spec.opacity ?? 1) < 1,
      opacity: spec.opacity ?? 1,
    });
    if (spec.painter) {
      const tex = this.paint(spec.painter);
      m.map = tex.map;
      if (tex.bump && spec.bump) {
        m.bumpMap = tex.bump;
        m.bumpScale = spec.bump;
      }
      if (spec.emissive) {
        m.emissiveMap = tex.map;
        m.emissive = new THREE.Color('#ffffff');
        m.emissiveIntensity = 0.9;
      }
    }
    patchFog(m);
    this.cache.set(key, m);
    return m;
  }

  private paint(painter: string) {
    let t = this.textures.get(painter);
    if (!t) {
      const p = PAINTERS[painter]();
      t = { map: textureFrom(p.color), bump: p.height ? textureFrom(p.height, false) : undefined };
      this.textures.set(painter, t);
    }
    return t;
  }
}

let glow: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  return (glow ??= radialSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0.45)'));
}

let flame: THREE.Texture | null = null;
export function flameTexture(): THREE.Texture {
  return (flame ??= radialSprite('rgba(255,244,200,1)', 'rgba(255,140,40,0.75)'));
}

/**
 * World-scaled UVs so textures keep a constant size in metres on any box or cylinder,
 * however big. Box faces use planar mapping in local space; cylinder sides unwrap.
 */
export function worldUVs(geo: THREE.BufferGeometry, tile: number, cylinder?: { radius: number; height: number }): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u: number, v: number;
    if (ny >= nx && ny >= nz) { u = x; v = z; }
    else if (cylinder) { u = uv.getX(i) * Math.PI * 2 * cylinder.radius; v = y; }
    else if (nx >= nz) { u = z; v = y; }
    else { u = x; v = y; }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}
