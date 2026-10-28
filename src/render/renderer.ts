import * as THREE from 'three';
import { Box, Cylinder } from '../collision/shapes';
import type { SimEvent } from '../sim/events';
import type { Level } from '../sim/level';
import type { Sim } from '../sim/sim';
import { ANCHOR_GLOW, SKY, glowTexture, levelMaterial } from './materials';
import { RopeView } from './rope';

const UPV = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();

interface AnchorView {
  group: THREE.Group;
  core: THREE.Mesh;
  halo: THREE.Sprite;
  support: THREE.Mesh | null;
}

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
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 2000);
  private levelGroup = new THREE.Group();
  private collisionGroup = new THREE.Group();
  private anchorViews: AnchorView[] = [];
  private readonly player = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly rope = new RopeView();
  private readonly ropeDebug: THREE.Line;
  private readonly glow = glowTexture();
  private readonly lean = new THREE.Quaternion();
  private ropeOverlay = false;

  private hookPhase: HookPhase = 'idle';
  private readonly hookHead = new THREE.Vector3();
  private readonly whiffTarget = new THREE.Vector3();

  /** Interpolated values from the last draw, for the HUD. */
  readonly view = { speed: 0, reticle: null as null | { x: number; y: number; kind: 'anchor' | 'surface' } };

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = SKY;

    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 6, 14), levelMaterial('#f4f1ea', { grid: false }));
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.12), levelMaterial('#1f2933', { grid: false }));
    visor.position.set(0, 0.55, -0.36);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.18), levelMaterial('#ff6a3d', { grid: false }));
    pack.position.set(0, 0.2, 0.38);
    this.body.add(visor, pack);
    this.player.add(this.body);

    this.ropeDebug = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#00ff66', depthTest: false }));
    this.ropeDebug.visible = false;
    this.ropeDebug.renderOrder = 10;
    this.collisionGroup.visible = false;

    this.scene.add(this.levelGroup, this.collisionGroup, this.player, this.rope.group, this.ropeDebug);
  }

  resize(w: number, h: number): void {
    this.gl.setSize(w, h, false);
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
    const wire = new THREE.LineBasicMaterial({ color: '#ff2d55', depthTest: false, transparent: true, opacity: 0.6 });

    level.data.primitives.forEach((p, i) => {
      const shape = level.world.shapes[i];
      const tags = new Set(p.tags ?? []);
      const color = p.color ?? (tags.has('glass') ? '#8fd3ff' : tags.has('grappleable') ? '#d8955a' : tags.has('thin') ? '#5f6b7a' : '#a3aab4');
      const mat = levelMaterial(color, { opacity: tags.has('glass') ? 0.35 : 1, grid: !tags.has('thin') });
      let geo: THREE.BufferGeometry;
      const mesh = new THREE.Mesh();
      if (shape instanceof Box) {
        geo = new THREE.BoxGeometry(shape.h.x * 2, shape.h.y * 2, shape.h.z * 2);
        mesh.position.set(shape.c.x, shape.c.y, shape.c.z);
        const [rx, ry, rz] = shape.rot;
        mesh.rotation.set((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180, 'YXZ');
      } else if (shape instanceof Cylinder) {
        geo = new THREE.CylinderGeometry(shape.r, shape.r, shape.hh * 2, 20);
        mesh.position.set(shape.c.x, shape.c.y, shape.c.z);
      } else {
        return;
      }
      mesh.geometry = geo;
      mesh.material = mat;
      this.levelGroup.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), wire);
      edges.position.copy(mesh.position);
      edges.rotation.copy(mesh.rotation);
      edges.renderOrder = 9;
      this.collisionGroup.add(edges);
    });

    // Checkpoints show as a pad on the floor of their volume.
    for (const c of level.checkpoints) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(c.max.x - c.min.x, 0.03, c.max.z - c.min.z), new THREE.MeshBasicMaterial({ color: '#3ddc84', transparent: true, opacity: 0.35, depthWrite: false }));
      pad.position.set((c.min.x + c.max.x) / 2, c.min.y + 0.02, (c.min.z + c.max.z) / 2);
      this.levelGroup.add(pad);
    }

    this.anchorViews = level.anchors.map((a) => {
      const group = new THREE.Group();
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: ANCHOR_GLOW }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: ANCHOR_GLOW, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      halo.scale.setScalar(2.2);
      group.add(core, halo);
      let support: THREE.Mesh | null = null;
      if (a.data.motion?.type === 'pendulum' || a.data.cable) {
        support = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#39424e' }));
        this.levelGroup.add(support);
      }
      this.levelGroup.add(group);
      return { group, core, halo, support };
    });

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

    // Player: blend the last two sim states.
    const height = prev.height + (pl.height - prev.height) * alpha;
    this.player.position.set(prev.p.x, prev.p.y, prev.p.z).lerp(v1.set(pl.p.x, pl.p.y, pl.p.z), alpha);
    this.body.scale.set(1, height / 1.8, 1);

    // Procedural lean so the body matches the physics.
    const leanUp = v2.copy(UPV);
    if (hook.attached && hook.taut) {
      const a = hook.anchorPos();
      leanUp.set(a.x, a.y, a.z).sub(this.player.position).normalize().lerp(UPV, 0.3).normalize();
    } else if (pl.state === 'wallrun') {
      leanUp.set(pl.wallNormal.x * 0.4, 1, pl.wallNormal.z * 0.4).normalize();
    } else if (pl.state === 'slide') {
      leanUp.set(Math.sin(pl.facing) * 0.6, 1, Math.cos(pl.facing) * 0.6).normalize();
    }
    q1.setFromUnitVectors(UPV, leanUp);
    q2.setFromAxisAngle(UPV, pl.facing);
    q1.multiply(q2);
    this.lean.slerp(q1, 1 - Math.exp(-dt * 14));
    this.player.quaternion.copy(this.lean);

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
      const view = this.anchorViews[i];
      if (!view) return;
      view.group.position.set(a.prevPos.x, a.prevPos.y, a.prevPos.z).lerp(v1.set(a.pos.x, a.pos.y, a.pos.z), alpha);
      const inRange = view.group.position.distanceTo(hand) <= range;
      const targeted = hook.target === a && !hook.attached;
      const attached = hook.attached && hook.anchor === a;
      view.halo.material.opacity = targeted || attached ? 1 : inRange ? 0.7 : 0.25;
      view.halo.scale.setScalar(targeted ? 3.4 : inRange ? 2.4 : 1.6);
      (view.core.material as THREE.MeshBasicMaterial).color.set(targeted ? '#ffffff' : ANCHOR_GLOW);
      if (view.support) {
        const top = a.data.motion?.type === 'pendulum'
          ? v2.fromArray(a.data.motion.pivot)
          : v2.copy(view.group.position).add(v1.set(0, a.data.cable ?? 0, 0));
        const d = v1.subVectors(top, view.group.position);
        view.support.position.copy(view.group.position);
        view.support.quaternion.setFromUnitVectors(UPV, d.clone().normalize());
        view.support.scale.set(1, d.length(), 1);
      }
    });

    this.drawHook(sim, dt, hand);

    // HUD values.
    this.view.speed = pl.v.len();
    this.view.reticle = null;
    if (!hook.attached) {
      if (hook.target) {
        const t = this.anchorViews[hook.target.id]?.group.position;
        if (t) this.view.reticle = this.project(t, 'anchor');
      } else if (hook.hasSurface) {
        this.view.reticle = this.project(v1.set(hook.surfacePoint.x, hook.surfacePoint.y, hook.surfacePoint.z), 'surface');
      }
    }

    this.gl.render(this.scene, this.camera);
  }

  private drawHook(sim: Sim, dt: number, hand: THREE.Vector3): void {
    const hook = sim.hook;
    const step = sim.T.hook.travelSpeed * dt;
    const dest = v2;
    if (hook.attached) {
      const a = hook.anchor;
      if (a) {
        const view = this.anchorViews[a.id];
        dest.copy(view ? view.group.position : v1.set(a.pos.x, a.pos.y, a.pos.z));
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
      pos.setXYZ(0, this.player.position.x, this.player.position.y, this.player.position.z);
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
