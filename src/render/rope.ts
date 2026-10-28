import * as THREE from 'three';

const SEGMENTS = 12;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Visual rope: a 12-segment Verlet line, so slack rope sags and snaps taut. It follows
 * the physics rope but never drives it (spec: Rope model).
 */
export class RopeView {
  readonly group = new THREE.Group();
  private readonly pts: THREE.Vector3[] = [];
  private readonly old: THREE.Vector3[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly head: THREE.Mesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private active = false;

  constructor(color = '#ff6a3d') {
    for (let i = 0; i <= SEGMENTS; i++) {
      this.pts.push(new THREE.Vector3());
      this.old.push(new THREE.Vector3());
    }
    const geo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true).translate(0, 0.5, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color }), SEGMENTS);
    this.mesh.frustumCulled = false;
    this.head = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), new THREE.MeshBasicMaterial({ color: '#222831' }));
    this.group.add(this.mesh, this.head);
    this.group.visible = false;
  }

  /**
   * @param hand where the rope leaves the body
   * @param head current hook head position
   * @param length rope length to draw; longer than the endpoint distance means slack
   */
  update(hand: THREE.Vector3, head: THREE.Vector3, length: number, dt: number): void {
    if (!this.active) {
      for (let i = 0; i <= SEGMENTS; i++) {
        this.pts[i].lerpVectors(hand, head, i / SEGMENTS);
        this.old[i].copy(this.pts[i]);
      }
      this.active = true;
    }
    this.group.visible = true;
    const span = hand.distanceTo(head);
    const rest = Math.max(length, span) / SEGMENTS;
    const g = -9.81 * dt * dt;
    for (let i = 1; i < SEGMENTS; i++) {
      const p = this.pts[i], o = this.old[i];
      const vx = (p.x - o.x) * 0.97, vy = (p.y - o.y) * 0.97, vz = (p.z - o.z) * 0.97;
      o.copy(p);
      p.set(p.x + vx, p.y + vy + g, p.z + vz);
    }
    for (let iter = 0; iter < 16; iter++) {
      this.pts[0].copy(hand);
      this.pts[SEGMENTS].copy(head);
      for (let i = 0; i < SEGMENTS; i++) {
        const a = this.pts[i], b = this.pts[i + 1];
        this.d.subVectors(b, a);
        const len = this.d.length();
        if (len < 1e-6) continue;
        const diff = (len - rest) / len;
        const wa = i === 0 ? 0 : 0.5, wb = i + 1 === SEGMENTS ? 0 : 0.5;
        const norm = wa + wb || 1;
        a.addScaledVector(this.d, (diff * wa) / norm);
        b.addScaledVector(this.d, (-diff * wb) / norm);
      }
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      this.d.subVectors(b, a);
      const len = this.d.length();
      this.q.setFromUnitVectors(UP, len > 1e-6 ? this.d.divideScalar(len) : UP);
      this.s.set(1, len, 1);
      this.m.compose(a, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.head.position.copy(head);
  }

  hide(): void {
    this.group.visible = false;
    this.active = false;
  }
}
