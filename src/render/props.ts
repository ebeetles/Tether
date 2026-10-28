import * as THREE from 'three';
import type { AnchorData } from '../sim/level';
import { ANCHOR_GLOW, glowTexture, type MaterialLib } from './materials';

/** A glowing, bloom-catching core in the anchor colour. */
function glowCore(radius: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 12),
    new THREE.MeshBasicMaterial({ color: ANCHOR_GLOW.clone().multiplyScalar(2.2), toneMapped: false }),
  );
}

export interface AnchorProp {
  group: THREE.Group;
  /** Spins slowly so rings catch the light. */
  spinner: THREE.Object3D | null;
  core: THREE.Mesh;
  halo: THREE.Sprite;
}

export function makeAnchorProp(data: AnchorData, mats: MaterialLib): AnchorProp {
  const group = new THREE.Group();
  const iron = mats.get('iron');
  let spinner: THREE.Object3D | null = null;
  let core: THREE.Mesh;
  switch (data.look ?? 'ring') {
    case 'lantern': {
      const frame = new THREE.Group();
      const wood = mats.get('darkwood');
      const plate = new THREE.BoxGeometry(0.5, 0.06, 0.5);
      const top = new THREE.Mesh(plate, iron);
      top.position.y = 0.3;
      const bottom = new THREE.Mesh(plate, iron);
      bottom.position.y = -0.3;
      frame.add(top, bottom);
      for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), wood);
        post.position.set(x, 0, z);
        frame.add(post);
      }
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.22, 4), iron);
      cap.position.y = 0.44;
      cap.rotation.y = Math.PI / 4;
      frame.add(cap);
      core = glowCore(0.17);
      group.add(frame, core);
      break;
    }
    case 'bell': {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(new THREE.Vector2(0.35 + 0.75 * Math.pow(t, 1.8) + (t > 0.9 ? (t - 0.9) * 2 : 0), -t * 2.1));
      }
      const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), mats.get('bronze'));
      (bell.material as THREE.Material).side = THREE.DoubleSide;
      bell.position.y = -0.2;
      bell.castShadow = true;
      core = glowCore(0.2);
      group.add(bell, core);
      break;
    }
    case 'hook': {
      const hook = new THREE.Group();
      const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), iron);
      shank.position.y = 0.1;
      const curve = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 18, Math.PI * 1.3), iron);
      curve.position.y = -0.5;
      curve.rotation.z = Math.PI * 0.85;
      hook.add(shank, curve);
      core = glowCore(0.15);
      group.add(hook, core);
      spinner = hook;
      break;
    }
    default: {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.075, 10, 28), iron);
      ring.castShadow = true;
      core = glowCore(0.16);
      group.add(ring, core);
      spinner = ring;
    }
  }
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: ANCHOR_GLOW, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
  );
  halo.scale.setScalar(2.2);
  group.add(halo);
  return { group, spinner, core, halo };
}

export interface PlayerProp {
  root: THREE.Group;
  body: THREE.Group;
  cape: THREE.Mesh;
}

/** Hooded adventurer in a tunic and cape, built around the 1.8 m capsule. */
export function makePlayerProp(mats: MaterialLib): PlayerProp {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const shadowed = (m: THREE.Mesh) => { m.castShadow = true; return m; };

  const tunic = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.95, 6, 16), mats.get('plain', '#3f5a3a')));
  tunic.position.y = -0.05;
  const belt = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.05, 6, 20), mats.get('leather')));
  belt.rotation.x = Math.PI / 2;
  belt.position.y = -0.1;
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.04), mats.get('gold'));
  buckle.position.set(0, -0.1, -0.38);
  const hood = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), mats.get('cloth', '#5b3b28')));
  hood.scale.set(1, 1.08, 1.12);
  hood.position.set(0, 0.6, 0.03);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 10), mats.get('plain', '#1d1714'));
  face.position.set(0, 0.56, -0.17);
  const satchel = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.34), mats.get('leather')));
  satchel.position.set(0.4, -0.3, 0.05);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 4, 24), mats.get('leather'));
  strap.rotation.set(0, Math.PI / 2, 0.6);
  strap.position.y = 0.1;

  // Cape: an open half-cylinder hanging from the shoulders, pivoting at the top.
  const capeGeo = new THREE.CylinderGeometry(0.42, 0.55, 1.25, 16, 1, true, Math.PI * 0.5, Math.PI);
  capeGeo.translate(0, -0.62, 0);
  const capeMat = mats.get('cloth', '#7c2420').clone();
  capeMat.side = THREE.DoubleSide;
  const cape = shadowed(new THREE.Mesh(capeGeo, capeMat));
  cape.position.set(0, 0.42, 0.04);

  body.add(tunic, belt, buckle, hood, face, satchel, strap, cape);
  root.add(body);
  return { root, body, cape };
}

/** Iron grappling hook head. */
export function makeGrapnel(mats: MaterialLib): THREE.Group {
  const g = new THREE.Group();
  const iron = mats.get('iron');
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 6), iron);
  shank.position.y = 0.2;
  g.add(shank);
  for (let i = 0; i < 3; i++) {
    const prong = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 5, 10, Math.PI * 0.9), iron);
    prong.rotation.set(0, (i / 3) * Math.PI * 2, Math.PI);
    prong.position.y = 0.4;
    g.add(prong);
  }
  return g;
}
