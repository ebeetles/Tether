import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Box, Cylinder } from '../collision/shapes';
import type { SimEvent } from '../sim/events';
import type { Level } from '../sim/level';
import type { Sim } from '../sim/sim';
import { StaticBatcher, boxGeo, buildDecor, cylGeo, placement, type Animated, type Torch } from './decor';
import { ANCHOR_GLOW, MaterialLib } from './materials';
import { makeAnchorProp, makeGrapnel, makePlayerProp, type AnchorProp, type PlayerProp } from './props';
import { RopeView } from './rope';
import { Environment, patchFog } from './sky';
import { runeCircle } from './textures';

const UPV = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const MAX_TORCH_LIGHTS = 8;

type HookPhase = 'idle' | 'out' | 'attached' | 'whiff' | 'retract';

const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/** Three.js is used purely as a renderer: everything here reads sim state, nothing writes it. */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 2500);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly env: Environment;
  private readonly mats = new MaterialLib();
  private levelGroup = new THREE.Group();
  private collisionGroup = new THREE.Group();
  private anchorProps: AnchorProp[] = [];
  private supports: (THREE.Mesh | null)[] = [];
  private animated: Animated[] = [];
  private torches: Torch[] = [];
  private waystones: THREE.Mesh[] = [];
  private readonly player: PlayerProp;
  private readonly rope: RopeView;
  private readonly ropeDebug: THREE.Line;
  private readonly lean = new THREE.Quaternion();
  private ropeOverlay = false;
  private time = 0;

  private hookPhase: HookPhase = 'idle';
  private readonly hookHead = new THREE.Vector3();
  private readonly whiffTarget = new THREE.Vector3();

  /** Interpolated values from the last draw, for the HUD. */
  readonly view = { speed: 0, reticle: null as null | { x: number; y: number; kind: 'anchor' | 'surface' } };

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;

    this.env = new Environment(this.scene);
    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.player = makePlayerProp(this.mats);
    const hemp = patchFog(new THREE.MeshStandardMaterial({ color: '#b48a52', roughness: 0.9 }));
    this.rope = new RopeView(makeGrapnel(this.mats), hemp);

    this.ropeDebug = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: '#00ff66', depthTest: false }),
    );
    this.ropeDebug.visible = false;
    this.ropeDebug.renderOrder = 10;
    this.collisionGroup.visible = false;

    this.scene.add(this.levelGroup, this.collisionGroup, this.player.root, this.rope.group, this.ropeDebug);
  }

  resize(w: number, h: number): void {
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.gl.getPixelRatio());
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setOverlays(collision: boolean, rope: boolean): void {
    this.collisionGroup.visible = collision;
    this.ropeOverlay = rope;
  }

  buildLevel(level: Level): void {
    for (const g of [this.levelGroup, this.collisionGroup]) {
      this.scene.remove(g);
      g.traverse((o) => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose(); });
    }
    this.levelGroup = new THREE.Group();
    const wasVisible = this.collisionGroup.visible;
    this.collisionGroup = new THREE.Group();
    this.collisionGroup.visible = wasVisible;
    this.env.configure(level.data.environment);

    const batch = new StaticBatcher(this.mats);
    const wire = new THREE.LineBasicMaterial({ color: '#ff2d55', depthTest: false, transparent: true, opacity: 0.6 });
    level.data.primitives.forEach((p, i) => {
      const shape = level.world.shapes[i];
      const tags = new Set(p.tags ?? []);
      const mat = p.mat ?? (tags.has('glass') ? 'glass' : tags.has('grappleable') ? 'darkwood' : 'stone');
      let geo: THREE.BufferGeometry;
      let matrix: THREE.Matrix4;
      if (shape instanceof Box) {
        geo = boxGeo([shape.h.x * 2, shape.h.y * 2, shape.h.z * 2], this.mats.tile(mat));
        matrix = placement([shape.c.x, shape.c.y, shape.c.z], shape.rot).clone();
      } else if (shape instanceof Cylinder) {
        geo = cylGeo(shape.r, shape.hh * 2, this.mats.tile(mat));
        matrix = placement([shape.c.x, shape.c.y, shape.c.z]).clone();
      } else {
        return;
      }
      if (!p.hidden) batch.add(geo, mat, p.color, matrix, !tags.has('noshadow'));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), wire);
      edges.applyMatrix4(matrix);
      edges.renderOrder = 9;
      this.collisionGroup.add(edges);
    });

    const decor = buildDecor(level.data.decor ?? [], batch);
    this.levelGroup.add(batch.build(), decor.dynamic);
    this.animated = decor.animated;
    this.torches = decor.torches;

    // Checkpoints are waystones: a slowly turning rune circle on the ground.
    const runes = runeCircle();
    this.waystones = level.checkpoints.map((c) => {
      const r = Math.min(c.max.x - c.min.x, c.max.z - c.min.z) * 0.4;
      const circle = new THREE.Mesh(
        new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: runes, color: ANCHOR_GLOW, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      circle.position.set((c.min.x + c.max.x) / 2, c.min.y + 0.05, (c.min.z + c.max.z) / 2);
      this.levelGroup.add(circle);
      return circle;
    });

    this.anchorProps = [];
    this.supports = [];
    for (const a of level.anchors) {
      const prop = makeAnchorProp(a.data, this.mats);
      this.levelGroup.add(prop.group);
      this.anchorProps.push(prop);
      let support: THREE.Mesh | null = null;
      if (a.data.motion?.type === 'pendulum' || a.data.cable) {
        support = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6).translate(0, 0.5, 0), this.mats.get('iron'));
        support.castShadow = true;
        this.levelGroup.add(support);
      }
      this.supports.push(support);
    }

    this.scene.add(this.levelGroup, this.collisionGroup);
  }

  onEvent(e: SimEvent, sim: Sim): void {
    switch (e.type) {
      case 'attach':
        if (this.hookPhase === 'idle' || this.hookPhase === 'retract') this.hand(sim, 1, this.hookHead);
        this.hookPhase = 'out';
        break;
      case 'whiff':
        this.hand(sim, 1, this.hookHead);
        if (e.pos) this.whiffTarget.set(e.pos.x, e.pos.y, e.pos.z);
        this.hookPhase = 'whiff';
        break;
      case 'release':
      case 'cut':
      case 'zipPop':
        if (!sim.hook.attached && this.hookPhase !== 'idle') this.hookPhase = 'retract';
        break;
      case 'respawn':
        this.hookPhase = 'idle';
        this.rope.hide();
        break;
    }
  }

  private hand(sim: Sim, alpha: number, out: THREE.Vector3): THREE.Vector3 {
    const pl = sim.player;
    const h = sim.prev.height + (pl.height - sim.prev.height) * alpha;
    out.set(sim.prev.p.x, sim.prev.p.y, sim.prev.p.z).lerp(v3.set(pl.p.x, pl.p.y, pl.p.z), alpha);
    out.y += h / 2 - 0.25;
    return out;
  }

  draw(sim: Sim, alpha: number, dt: number): void {
    const pl = sim.player, prev = sim.prev, cam = sim.cam, hook = sim.hook;
    const G = sim.T.graphics;
    this.time += dt;

    // Player: blend the last two sim states.
    const height = prev.height + (pl.height - prev.height) * alpha;
    const root = this.player.root;
    root.position.set(prev.p.x, prev.p.y, prev.p.z).lerp(v1.set(pl.p.x, pl.p.y, pl.p.z), alpha);
    this.player.body.scale.set(1, height / 1.8, 1);

    // Procedural lean so the body matches the physics.
    const leanUp = v2.copy(UPV);
    if (hook.attached && hook.taut) {
      const a = hook.anchorPos();
      leanUp.set(a.x, a.y, a.z).sub(root.position).normalize().lerp(UPV, 0.3).normalize();
    } else if (pl.state === 'wallrun') {
      leanUp.set(pl.wallNormal.x * 0.4, 1, pl.wallNormal.z * 0.4).normalize();
    } else if (pl.state === 'slide') {
      leanUp.set(Math.sin(pl.facing) * 0.6, 1, Math.cos(pl.facing) * 0.6).normalize();
    }
    q1.setFromUnitVectors(UPV, leanUp);
    q2.setFromAxisAngle(UPV, pl.facing);
    q1.multiply(q2);
    this.lean.slerp(q1, 1 - Math.exp(-dt * 14));
    root.quaternion.copy(this.lean);
    // The cape streams out behind with speed.
    const flow = Math.min(pl.v.len() / 25, 1);
    this.player.cape.rotation.x = THREE.MathUtils.lerp(this.player.cape.rotation.x, 0.15 + flow * 0.9 + Math.sin(this.time * 9) * 0.05 * flow, 1 - Math.exp(-dt * 8));

    // Camera.
    this.camera.position.set(prev.camPos.x, prev.camPos.y, prev.camPos.z).lerp(v1.set(cam.pos.x, cam.pos.y, cam.pos.z), alpha);
    this.camera.rotation.set(
      prev.pitch + (cam.viewPitch - prev.pitch) * alpha,
      lerpAngle(prev.yaw, cam.yaw, alpha),
      prev.roll + (cam.roll - prev.roll) * alpha,
      'YXZ',
    );
    const fov = prev.fov + (cam.fov - prev.fov) * alpha;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Anchors: glow brighter in range, brightest when targeted.
    const hand = this.hand(sim, alpha, v3);
    const range = sim.T.hook.range;
    sim.level.anchors.forEach((a, i) => {
      const prop = this.anchorProps[i];
      if (!prop) return;
      prop.group.position.set(a.prevPos.x, a.prevPos.y, a.prevPos.z).lerp(v1.set(a.pos.x, a.pos.y, a.pos.z), alpha);
      if (prop.spinner) prop.spinner.rotation.y = this.time * 0.6 + i;
      const inRange = prop.group.position.distanceTo(hand) <= range;
      const targeted = hook.target === a && !hook.attached;
      const attached = hook.attached && hook.anchor === a;
      prop.halo.material.opacity = targeted || attached ? 1 : inRange ? 0.85 : 0.45;
      prop.halo.scale.setScalar(targeted ? 4.2 : inRange ? 3.2 : 2.4);
      prop.core.scale.setScalar(targeted ? 1.5 : 1);
      const support = this.supports[i];
      if (support) {
        const top = a.data.motion?.type === 'pendulum'
          ? v2.fromArray(a.data.motion.pivot)
          : v2.copy(prop.group.position).add(v1.set(0, a.data.cable ?? 0, 0));
        const d = v1.subVectors(top, prop.group.position);
        support.position.copy(prop.group.position);
        support.quaternion.setFromUnitVectors(UPV, d.clone().normalize());
        support.scale.set(1, d.length(), 1);
        // Pendulum props hang along their rope.
        if (a.data.motion?.type === 'pendulum') prop.group.quaternion.copy(support.quaternion);
      }
    });

    this.drawHook(sim, dt, hand);

    for (const a of this.animated) a.update(sim.time, dt);
    for (const w of this.waystones) w.rotation.y = this.time * 0.15;
    this.updateTorches(root.position, G.torchLights);

    this.env.update(this.camera, root.position, this.time, G.shadows);
    this.gl.toneMappingExposure = G.exposure;
    this.bloom.enabled = G.bloom;
    this.bloom.strength = G.bloomStrength;

    // HUD values.
    this.view.speed = pl.v.len();
    this.view.reticle = null;
    if (!hook.attached) {
      if (hook.target) {
        const t = this.anchorProps[hook.target.id]?.group.position;
        if (t) this.view.reticle = this.project(t, 'anchor');
      } else if (hook.hasSurface) {
        this.view.reticle = this.project(v1.set(hook.surfacePoint.x, hook.surfacePoint.y, hook.surfacePoint.z), 'surface');
      }
    }

    this.composer.render(dt);
  }

  /** Flicker every flame; give real lights only to the torches nearest the player. */
  private updateTorches(focus: THREE.Vector3, lights: boolean): void {
    const t = this.time;
    const lit = lights
      ? [...this.torches].filter((x) => x.light).sort((a, b) => a.pos.distanceToSquared(focus) - b.pos.distanceToSquared(focus)).slice(0, MAX_TORCH_LIGHTS)
      : [];
    for (const torch of this.torches) {
      const f = 0.85 + 0.15 * Math.sin(t * 13 + torch.seed) * Math.sin(t * 7.3 + torch.seed * 2);
      torch.flame.scale.set(0.65 * f, 1.1 * f, 1);
      if (torch.light) {
        torch.light.visible = lit.includes(torch);
        torch.light.intensity = 30 * f;
      }
    }
  }

  private drawHook(sim: Sim, dt: number, hand: THREE.Vector3): void {
    const hook = sim.hook;
    const step = sim.T.hook.travelSpeed * dt;
    const dest = v2;
    if (hook.attached) {
      const a = hook.anchor;
      if (a) {
        const prop = this.anchorProps[a.id];
        dest.copy(prop ? prop.group.position : v1.set(a.pos.x, a.pos.y, a.pos.z));
      } else {
        dest.set(hook.point.x, hook.point.y, hook.point.z);
      }
      if (this.hookPhase !== 'out' && this.hookPhase !== 'attached') this.hookPhase = 'out';
    } else if (this.hookPhase === 'whiff') {
      dest.copy(this.whiffTarget);
    } else {
      dest.copy(hand);
    }

    this.ropeDebug.visible = this.ropeOverlay && hook.attached;
    if (this.ropeDebug.visible) {
      const pos = this.ropeDebug.geometry.attributes.position as THREE.BufferAttribute;
      const p = this.player.root.position;
      pos.setXYZ(0, p.x, p.y, p.z);
      pos.setXYZ(1, dest.x, dest.y, dest.z);
      pos.needsUpdate = true;
      (this.ropeDebug.material as THREE.LineBasicMaterial).color.set(hook.taut ? '#ff2d55' : '#00ff66');
    }
    if (this.hookPhase === 'idle') {
      this.rope.hide();
      return;
    }
    const toDest = v1.subVectors(dest, this.hookHead);
    const dist = toDest.length();
    const travel = this.hookPhase === 'retract' ? step * 1.5 : step;
    if (dist <= travel || this.hookPhase === 'attached') {
      this.hookHead.copy(dest);
      if (this.hookPhase === 'out') this.hookPhase = 'attached';
      else if (this.hookPhase === 'whiff') this.hookPhase = 'retract';
      else if (this.hookPhase === 'retract') { this.hookPhase = 'idle'; this.rope.hide(); return; }
    } else {
      this.hookHead.addScaledVector(toDest, travel / dist);
    }

    const span = hand.distanceTo(this.hookHead);
    // hook.L is measured from the body centre; the drawn rope starts at the hand.
    const length = this.hookPhase === 'attached' && !hook.taut ? Math.max(hook.L - 0.5, span) : span;
    this.rope.update(hand, this.hookHead, length, dt);
  }

  private project(p: THREE.Vector3, kind: 'anchor' | 'surface') {
    const v = v1.copy(p).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const el = this.gl.domElement;
    return { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight, kind };
  }
}
