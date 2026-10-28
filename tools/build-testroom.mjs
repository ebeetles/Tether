// Generates src/levels/testroom.json: the test room dressed as a castle courtyard at sunset.
// Run: node tools/build-testroom.mjs
//
// Every mechanic the test room exercised is still here, just in costume: market stalls and
// carts to vault, wooden ramps, a stair of ruined wall blocks to climb, an alley between
// row houses for wallruns, a plank palisade for tunnelling checks, a lookout to drop from,
// and plenty of anchors on gallows, lantern posts, cranes, a bell tower and windmill sails.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const P = [], A = [], D = [];
const r = (n) => Math.round(n * 1000) / 1000;
const r3 = (v) => v.map(r);
const DEG = Math.PI / 180;

const box = (pos, size, o = {}) => P.push({ type: 'box', pos: r3(pos), size: r3(size), ...o });
const cyl = (pos, radius, height, o = {}) => P.push({ type: 'cylinder', pos: r3(pos), radius: r(radius), height: r(height), ...o });
const decor = (d) => D.push(d.pos ? { ...d, pos: r3(d.pos) } : d);
const anchor = (pos, o = {}) => A.push({ pos: r3(pos), ...o });

/** Merlons along a line (collision, so you can stand behind them on the wall-walk). */
function merlons(x0, z0, x1, z1, y, o = {}) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  const n = Math.floor(len / 2.8);
  const yaw = Math.atan2(-dz, dx) / DEG;
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0.5 : i / n;
    box([x0 + dx * t, y + 0.8, z0 + dz * t], [1.5, 1.6, 0.8], { rot: [0, r(yaw), 0], mat: 'stone', ...o });
  }
}

/** Ring of merlons on a round tower top. */
function merlonRing(cx, cz, radius, y, count) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    box([cx + Math.cos(a) * radius, y + 0.8, cz + Math.sin(a) * radius], [1.4, 1.6, 0.7], { rot: [0, r(-a / DEG + 90), 0], mat: 'stone' });
  }
}

/** Half-timbered house with a walkable gable roof. `ridge` is the ridge axis. */
function house(cx, cz, w, d, h, ridge = 'z', o = {}) {
  const pitch = 35 * DEG, over = 0.6, thick = 0.3;
  box([cx, h / 2, cz], [w, h, d], { mat: o.mat ?? 'plaster' });
  const span = (ridge === 'z' ? w : d) / 2;
  const half = span + over;
  const ridgeY = h + span * Math.tan(pitch);
  const s = half / Math.cos(pitch);
  const y = ridgeY - (half / 2) * Math.tan(pitch) + thick / 2 / Math.cos(pitch);
  const roof = o.roof ?? 'roof';
  if (ridge === 'z') {
    box([cx - half / 2, y, cz], [s, thick, d + over * 2], { rot: [0, 0, r(35)], mat: roof });
    box([cx + half / 2, y, cz], [s, thick, d + over * 2], { rot: [0, 0, r(-35)], mat: roof });
    decor({ type: 'gable', pos: [cx, h, cz], width: w, height: r(span * Math.tan(pitch)), depth: d, mat: o.mat ?? 'plaster' });
  } else {
    box([cx, y, cz + half / 2], [w + over * 2, thick, s], { rot: [r(35), 0, 0], mat: roof });
    box([cx, y, cz - half / 2], [w + over * 2, thick, s], { rot: [r(-35), 0, 0], mat: roof });
    decor({ type: 'gable', pos: [cx, h, cz], width: d, height: r(span * Math.tan(pitch)), depth: w, yaw: 90, mat: o.mat ?? 'plaster' });
  }
  // A chimney and a plinth of stone along the base.
  if (o.chimney !== false) decor({ type: 'box', pos: [cx + w * 0.25, ridgeY + 0.6, cz + d * 0.2], size: [1, 3, 1], mat: 'stone' });
  decor({ type: 'box', pos: [cx, 0.5, cz], size: [w + 0.2, 1, d + 0.2], mat: 'stone' });
  return ridgeY;
}

/** Round stone tower; flat crenellated top, or a conical roof with stepped collision. */
function tower(cx, cz, radius, h, o = {}) {
  cyl([cx, h / 2, cz], radius, h, { mat: o.mat ?? 'stone', tags: o.tags });
  if (o.roof) {
    const rr = radius + 0.8, rh = radius * 1.7;
    decor({ type: 'cone', pos: [cx, h, cz], radius: r(rr), height: r(rh), mat: o.roof });
    for (let i = 0; i < 3; i++) {
      const top = (i + 1) / 4;
      cyl([cx, h + rh * (i / 4) + (rh / 4) / 2, cz], rr * (1 - top), rh / 4, { hidden: true });
    }
  } else {
    merlonRing(cx, cz, radius - 0.4, h, Math.round(radius * 2.4));
  }
}

/** A timber gallows: post plus an arm with a ring anchor hanging from it. */
function gallows(px, pz, ax, az, armY, o = {}) {
  cyl([px, armY / 2, pz], 0.3, armY + 0.4, { mat: 'darkwood', tags: ['thin'] });
  const dx = ax - px, dz = az - pz, len = Math.hypot(dx, dz);
  decor({ type: 'box', pos: [(px + ax) / 2, armY, (pz + az) / 2], size: [r(len + 0.6), 0.4, 0.4], rot: [0, r(Math.atan2(-dz, dx) / DEG), 0], mat: 'darkwood' });
  anchor([ax, armY - 1.6, az], { cable: 1.4, look: o.look ?? 'ring' });
}

// ---------------------------------------------------------------- ground and walls

box([0, -0.5, 0], [900, 1, 900], { mat: 'grass', tags: ['noshadow'] });
box([0, -0.04, 0], [156, 0.1, 156], { mat: 'flagstone', tags: ['noshadow'] });

const WALL_H = 12, WALL_T = 3, IN = 78;
const wallOpts = { mat: 'stone', tags: ['noshadow'] };
box([0, WALL_H / 2, -(IN + WALL_T / 2)], [IN * 2 + WALL_T * 2, WALL_H, WALL_T], wallOpts);
box([-(IN + WALL_T / 2), WALL_H / 2, 0], [WALL_T, WALL_H, IN * 2], wallOpts);
box([IN + WALL_T / 2, WALL_H / 2, 0], [WALL_T, WALL_H, IN * 2], wallOpts);
// South wall splits around the gatehouse.
const segW = IN + WALL_T - 7;
box([-(7 + segW / 2), WALL_H / 2, IN + WALL_T / 2], [segW, WALL_H, WALL_T], wallOpts);
box([7 + segW / 2, WALL_H / 2, IN + WALL_T / 2], [segW, WALL_H, WALL_T], wallOpts);
const mOpts = { tags: ['noshadow'] };
merlons(-IN, -IN - 2.6, IN, -IN - 2.6, WALL_H, mOpts);
merlons(-IN - 2.6, -IN, -IN - 2.6, IN, WALL_H, mOpts);
merlons(IN + 2.6, -IN, IN + 2.6, IN, WALL_H, mOpts);
merlons(-IN, IN + 2.6, -15, IN + 2.6, WALL_H, mOpts);
merlons(15, IN + 2.6, IN, IN + 2.6, WALL_H, mOpts);

for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
  tower(x * 80, z * 80, 7, 18, { tags: ['noshadow'] });
  decor({ type: 'flag', pos: [x * 80, 18, z * 80], height: 7, color: x * z > 0 ? '#7a1c1c' : '#1f3f8a', yaw: 200 });
}

// Gatehouse with a raised portcullis.
box([-11, 9, 80], [8, 18, 10], { mat: 'stone' });
box([11, 9, 80], [8, 18, 10], { mat: 'stone' });
box([0, 13.5, 80], [14, 5, 7], { mat: 'stone' });
merlons(-15, 75.4, -7.6, 75.4, 18);
merlons(7.6, 75.4, 15, 75.4, 18);
merlons(-6, 76.9, 6, 76.9, 16);
for (let x = -6; x <= 6; x += 1) decor({ type: 'box', pos: [x, 10.4, 80], size: [0.12, 1.6, 0.12], mat: 'iron' });
decor({ type: 'box', pos: [0, 10, 80], size: [13, 0.18, 0.18], mat: 'iron' });
decor({ type: 'banner', pos: [-11, 16, 74.9], size: [3, 7], color: '#1f3f8a', emblem: '⚜' });
decor({ type: 'banner', pos: [11, 16, 74.9], size: [3, 7], color: '#1f3f8a', emblem: '⚜' });
decor({ type: 'torch', pos: [-6.6, 4, 74.6], light: true });
decor({ type: 'torch', pos: [6.6, 4, 74.6], light: true });

// Banners and gallows along the curtain walls.
for (const z of [-30, 30]) decor({ type: 'banner', pos: [-IN + 0.1, 11.2, z], size: [2.4, 6], yaw: 90, color: '#7a1c1c', emblem: '✠' });
for (const z of [15, 45]) decor({ type: 'banner', pos: [IN - 0.1, 11.2, z], size: [2.4, 6], yaw: -90, color: '#7a1c1c', emblem: '✠' });
for (const x of [-40, 40]) decor({ type: 'banner', pos: [x, 11.2, -IN + 0.1], size: [2.4, 6], color: '#1f3f8a', emblem: '⚜' });
for (const z of [-50, -30, 10, 30, 48]) {
  decor({ type: 'box', pos: [-IN + 1.6, WALL_H + 0.6, z], size: [4.4, 0.45, 0.45], mat: 'darkwood' });
  anchor([-IN + 3.4, WALL_H - 0.9, z], { cable: 1.4 });
}
for (const z of [-10, 15, 35, 55]) {
  decor({ type: 'box', pos: [IN - 1.6, WALL_H + 0.6, z], size: [4.4, 0.45, 0.45], mat: 'darkwood' });
  anchor([IN - 3.4, WALL_H - 0.9, z], { cable: 1.4 });
}

// Watchtowers on the east and west walls.
for (const x of [-1, 1]) {
  tower(x * 79, 0, 4.5, 22, { roof: 'slate' });
  anchor([x * 73.8, 18, 0], { look: 'ring' });
  decor({ type: 'box', pos: [x * 75.2, 18.8, 0], size: [3, 0.4, 0.4], mat: 'darkwood' });
}

// ---------------------------------------------------------------- south: market square

// Fountain (vault the rim) with a tiered centre.
cyl([0, 0.3, 40], 3.6, 0.6, { mat: 'sandstone' });
cyl([0, 1.6, 40], 0.5, 2.2, { mat: 'sandstone' });
cyl([0, 2.75, 40], 1.3, 0.25, { mat: 'sandstone' });
decor({ type: 'water', pos: [0, 0.58, 40], radius: 3.3 });

// Vault row: crates, a market stall, a cart, a wagon bed; then two stone steps.
box([-20, 0.35, 45], [2.6, 0.7, 0.9], { mat: 'wood' });
box([-15, 0.5, 45], [3, 1, 1.1], { mat: 'wood' });
for (const x of [-16.3, -13.7]) for (const z of [44.6, 46.6]) decor({ type: 'box', pos: [x, 1.4, z], size: [0.14, 2.8, 0.14], mat: 'darkwood' });
box([-15, 2.85, 45.6], [3.4, 0.12, 2.6], { rot: [12, 0, 0], mat: 'plain', color: '#9e2b25' });
box([-10, 0.6, 45], [2.2, 1.2, 1.2], { mat: 'wood' });
box([-4, 0.5, 45], [3, 1, 5], { mat: 'wood' });
for (const [x, z] of [[-5.6, 43], [-2.4, 43], [-5.6, 47], [-2.4, 47]]) decor({ type: 'cylinder', pos: [x, 0.45, z], radius: 0.45, height: 0.18, mat: 'darkwood' });
box([3, 0.15, 45], [3, 0.3, 3], { mat: 'stone' });
box([7, 0.225, 45], [3, 0.45, 3], { mat: 'stone' });
cyl([-22, 0.5, 52], 0.45, 1.0, { mat: 'wood' });
cyl([-21, 0.5, 53], 0.45, 1.0, { mat: 'wood' });
box([-9, 0.45, 55], [1.6, 0.9, 1.6], { mat: 'wood' });
box([-9, 1.25, 55], [1, 0.7, 1], { mat: 'wood' });

// More stalls around the square.
for (const [x, z, c] of [[-24, 30, '#2b5a8a'], [14, 58, '#c08a2a'], [20, 58, '#9e2b25']]) {
  box([x, 0.5, z], [3, 1, 1.1], { mat: 'wood' });
  for (const dx of [-1.3, 1.3]) for (const dz of [-0.4, 1.6]) decor({ type: 'box', pos: [x + dx, 1.4, z + dz], size: [0.14, 2.8, 0.14], mat: 'darkwood' });
  box([x, 2.85, z + 0.6], [3.4, 0.12, 2.6], { rot: [12, 0, 0], mat: 'plain', color: c });
}

// Timber arches with the first practice anchors.
for (const z of [25, 5]) {
  for (const x of [-7, 7]) cyl([x, 9.2, z], 0.35, 18.4, { mat: 'darkwood', tags: ['thin'] });
  box([0, 18.6, z], [15, 0.8, 0.8], { mat: 'darkwood', tags: ['grappleable'] });
  anchor([0, 16, z], { cable: 2.2 });
}

// Wooden ramps rising north, low ends flush with the floor; a stone platform tops the 30°.
const RL = 14;
for (const [x, deg] of [[20, 15], [28, 30], [36, 45], [44, 60]]) {
  const s = Math.sin(deg * DEG), c = Math.cos(deg * DEG);
  box([x, (RL / 2) * s - 0.25 * c + 0.02, 50 - (RL / 2) * c], [6, 0.5, RL], { rot: [deg, 0, 0], mat: 'wood' });
}
{
  const top = 50 - RL * Math.cos(30 * DEG), h = RL * Math.sin(30 * DEG);
  box([28, h / 2, top - 3], [6, h, 6], { mat: 'stone' });
  merlons(25, top - 5.7, 31, top - 5.7, h);
}

// Tavern by the gate, oak trees.
house(-55, 64, 14, 10, 8, 'x');
decor({ type: 'box', pos: [-55, 1.3, 58.95], size: [1.6, 2.6, 0.15], mat: 'darkwood' });
decor({ type: 'torch', pos: [-57.8, 3.4, 58.7], light: true });
decor({ type: 'torch', pos: [-52.2, 3.4, 58.7], light: true });
decor({ type: 'banner', pos: [-55, 7.4, 58.9], size: [2, 3], color: '#5a2a8a', emblem: '♛' });
house(64, 44, 10, 8, 9, 'z');
for (const [x, z, h] of [[45, 62, 13], [-26, 66, 11], [30, 12, 12]]) {
  cyl([x, h * 0.2, z], 0.45, h * 0.4, { mat: 'bark' });
  decor({ type: 'tree', pos: [x, 0, z], height: h });
}

// ---------------------------------------------------------------- west: climbing and the alley

// Stair of ruined wall blocks for climb, grab and mantle.
for (const [x, h] of [[-30, 2.0], [-38, 3.5], [-46, 5.0], [-54, 6.0]]) box([x, h / 2, 32], [6, h, 6], { mat: 'darkstone' });

// Siege tower with an overhanging top deck.
box([-66, 8, 40], [6, 16, 6], { mat: 'wood' });
box([-66, 16.25, 40], [8, 0.5, 8], { mat: 'darkwood', tags: ['grappleable'] });
for (const [x, z] of [[-69.8, 36.2], [-62.2, 36.2], [-69.8, 43.8], [-62.2, 43.8]]) decor({ type: 'box', pos: [x, 17.2, z], size: [0.3, 1.4, 0.3], mat: 'darkwood' });

// Tanner's Alley: two row houses 6 m apart for wallruns; lanterns strung across.
house(-44, 5, 8, 40, 9, 'z');
house(-30, 5, 8, 40, 9, 'z', { chimney: false });
for (const z of [15, -5]) {
  decor({ type: 'box', pos: [-37, 12.2, z], size: [6.2, 0.08, 0.08], mat: 'darkwood' });
  anchor([-37, 11, z], { look: 'lantern', cable: 1.2 });
}
for (const [x, z] of [[-40.25, 0], [-33.75, 12], [-40.25, 20]]) decor({ type: 'torch', pos: [x, 4, z], light: z === 12 });
decor({ type: 'banner', pos: [-40.05, 8.4, 8], size: [1.6, 3.4], yaw: 90, color: '#2f6a3a', emblem: '✠' });

// Magical lantern circling the yard north of the alley.
anchor([-42, 20, -25], { motion: { type: 'circle', center: [-50, 20, -25], period: 12 }, look: 'lantern' });

// ---------------------------------------------------------------- centre: aqueduct

const AQ_Z = -8;
box([13, 15, AQ_Z], [72, 2, 4], { mat: 'sandstone', tags: ['grappleable'] });
for (const x of [-18, -6, 6, 18, 30, 42]) box([x, 7, AQ_Z], [2.4, 14, 3.4], { mat: 'sandstone' });
for (const z of [AQ_Z - 1.8, AQ_Z + 1.8]) box([13, 16.4, z], [72, 0.8, 0.4], { mat: 'sandstone' });
for (let x = -20; x <= 46; x += 4) decor({ type: 'box', pos: [x, 13.8, AQ_Z], size: [0.5, 0.4, 4.2], mat: 'darkwood' });
// Rings hung beneath each arch: an east-west swing chain under the aqueduct.
for (const x of [-12, 0, 12, 24, 36]) anchor([x, 11.2, AQ_Z], { cable: 2.4 });

/** Timber scaffold: corner posts, decks with grappleable undersides, rings at the top corners. */
function scaffold(cx, cz, w, levels) {
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) cyl([cx + dx * (w / 2 - 0.2), levels.at(-1) / 2 + 0.6, cz + dz * (w / 2 - 0.2)], 0.2, levels.at(-1) + 1.2, { mat: 'darkwood', tags: ['thin'] });
  for (const y of levels) box([cx, y, cz], [w, 0.3, w], { mat: 'wood', tags: ['grappleable'] });
  for (let i = 0; i < levels.length; i++) {
    const y0 = i === 0 ? 0 : levels[i - 1], y1 = levels[i];
    decor({ type: 'box', pos: [cx, (y0 + y1) / 2, cz - w / 2 + 0.2], size: [0.18, Math.hypot(w, y1 - y0) - 0.4, 0.18], rot: [0, 0, r(Math.atan2(w, y1 - y0) / DEG)], mat: 'darkwood' });
  }
  const top = levels.at(-1);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    decor({ type: 'box', pos: [cx + dx * (w / 2 + 0.6), top + 1.2, cz + dz * (w / 2 - 0.2)], size: [1.6, 0.25, 0.25], mat: 'darkwood' });
    anchor([cx + dx * (w / 2 + 1.2), top + 0.1, cz + dz * (w / 2 - 0.2)], { cable: 1.1 });
  }
}
scaffold(46, 20, 6, [6, 12, 18]);
scaffold(-16, -22, 6, [5, 10, 15, 20]);

// East: plank palisade (thin), lookout with a mast, gallows chain into the granary wall.
box([60, 2.5, 20], [8, 5, 0.1], { mat: 'wood' });
box([60, 6, 0], [6, 12, 6], { mat: 'stone' });
merlons(57.3, -2.7, 62.7, -2.7, 12);
merlons(57.3, 2.7, 62.7, 2.7, 12);
cyl([60, 17, 1.8], 0.25, 10, { mat: 'darkwood', tags: ['thin'] });
decor({ type: 'box', pos: [60, 21.6, 0.3], size: [0.3, 0.3, 3.4], mat: 'darkwood' });
anchor([60, 20, -1.2], { cable: 1.4 });
decor({ type: 'torch', pos: [56.8, 4, 0], light: false });

gallows(52, -20, 56, -20, 19.6);
gallows(52, -70, 56, -70, 19.6);
house(71, -45, 10, 36, 14, 'z', { mat: 'stone', roof: 'slate', chimney: false });
decor({ type: 'torch', pos: [65.8, 4, -45], light: true });

// ---------------------------------------------------------------- north

// Lantern posts.
for (const [x, z] of [[-6, -25], [6, -38], [-6, -51], [6, -64]]) {
  cyl([x, 8, z], 0.25, 16, { mat: 'darkwood', tags: ['thin'] });
  const ax = x - Math.sign(x) * 1.4;
  decor({ type: 'box', pos: [(x + ax) / 2, 15.9, z], size: [1.8, 0.2, 0.2], mat: 'darkwood' });
  anchor([ax, 14.9, z], { look: 'lantern', cable: 0.9 });
}

// Treadwheel crane: timber tower, grappleable boom, fixed hook and a trolley that travels.
box([40, 16, -45], [2.5, 32, 2.5], { mat: 'darkwood' });
box([18, 32.6, -45], [44, 1.2, 1.2], { mat: 'darkwood', tags: ['grappleable'] });
decor({ type: 'box', pos: [35.5, 29, -45], size: [0.35, 10, 0.35], rot: [0, 0, 40], mat: 'darkwood' });
decor({ type: 'box', pos: [44, 31.5, -45], size: [6, 3, 3], mat: 'stone' });
anchor([5, 26, -45], { cable: 6, look: 'hook' });
anchor([34, 25, -45], { motion: { type: 'linear', to: [8, 25, -45], period: 10 }, cable: 7, look: 'hook' });

// Bell tower: four pillars under a crenellated cap; the bell is a pendulum anchor.
for (const x of [-38, -22]) for (const z of [-46, -54]) box([x, 17, z], [2, 34, 2], { mat: 'stone' });
box([-30, 35, -50], [18, 2, 10], { mat: 'stone', tags: ['grappleable'] });
merlons(-38.6, -45.4, -21.4, -45.4, 36);
merlons(-38.6, -54.6, -21.4, -54.6, 36);
anchor([-30, 22, -50], { motion: { type: 'pendulum', pivot: [-30, 34, -50], amplitude: 35, period: 7, yaw: 90 }, look: 'bell' });
decor({ type: 'torch', pos: [-22, 4, -44.9], light: true });

// Chapel facade: stained glass (no grapple) set into a stone gable wall.
box([-15, 7, -36.2], [16, 14, 1.2], { mat: 'stone' });
decor({ type: 'gable', pos: [-15, 14, -36.2], width: 16, height: 6, depth: 1.2, mat: 'stone' });
box([-15, 8, -35.45], [6, 9, 0.3], { tags: ['glass', 'no-grapple'], mat: 'glass' });
decor({ type: 'torch', pos: [-20.5, 4, -35.4], light: true });
decor({ type: 'torch', pos: [-9.5, 4, -35.4], light: true });

// The keep: tall stone block, timber hoarding to swing from, corner turrets.
box([22, 13, -70], [18, 26, 12], { mat: 'stone' });
merlons(13.4, -64.4, 30.6, -64.4, 26);
merlons(13.4, -75.6, 30.6, -75.6, 26);
merlons(13.4, -64.4, 13.4, -75.6, 26);
merlons(30.6, -64.4, 30.6, -75.6, 26);
for (const x of [13, 31]) {
  tower(x, -64, 1.8, 30, { roof: 'slate' });
  decor({ type: 'flag', pos: [x, 33, -64], height: 4, color: '#7a1c1c', yaw: 200 });
}
box([22, 20.5, -62.5], [14, 1, 3], { mat: 'darkwood', tags: ['grappleable'] });
for (const x of [16, 22, 28]) decor({ type: 'box', pos: [x, 19, -62.8], size: [0.3, 3, 0.3], rot: [-35, 0, 0], mat: 'darkwood' });
anchor([12, 24, -61], {});
anchor([32, 24, -61], {});
decor({ type: 'box', pos: [22, 2, -63.9], size: [3, 4, 0.2], mat: 'darkwood' });
decor({ type: 'banner', pos: [17, 18.8, -63.85], size: [3, 8], color: '#7a1c1c', emblem: '⚜' });
decor({ type: 'banner', pos: [27, 18.8, -63.85], size: [3, 8], color: '#7a1c1c', emblem: '⚜' });
decor({ type: 'torch', pos: [19.6, 3.6, -63.6], light: true });
decor({ type: 'torch', pos: [24.4, 3.6, -63.6], light: true });

// Windmill: its sails carry four moving anchors that turn with them.
tower(-62, -64, 4, 16, { mat: 'plaster', roof: 'roof' });
{
  const hub = [-62, 13, -59.2], R = 10, period = 24;
  decor({ type: 'sails', pos: hub, radius: R, period });
  for (const [u, v] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    anchor([hub[0] + u * R, hub[1] + v * R, hub[2] + 0.4], { motion: { type: 'wheel', center: [hub[0], hub[1], hub[2] + 0.4], period } });
  }
}
decor({ type: 'torch', pos: [-62, 3, -59.8], light: false });

// Trees inside the north wall.
for (const [x, z, h] of [[-50, -73, 14], [0, -73, 12], [48, -73, 15], [-70, 20, 13], [70, 30, 12]]) {
  cyl([x, 2, z], 0.4, 4, { mat: 'bark' });
  decor({ type: 'tree', pos: [x, 0, z], height: h, kind: 'pine' });
}

// ---------------------------------------------------------------- the land outside

// Rolling hills fading into the haze, a forest belt, and a distant castle against the sun.
const hills = [[-260, -60, 120, 40], [-210, -260, 140, 55], [20, -320, 160, 48], [250, -240, 140, 60], [320, 40, 150, 45],
  [240, 280, 160, 50], [-40, 330, 170, 42], [-300, 220, 130, 38], [-360, -160, 110, 46], [120, -380, 120, 70]];
for (const [x, z, rad, h] of hills) decor({ type: 'cone', pos: [x, -2, z], radius: rad, height: h, mat: 'hill', segments: 14 });
let seed = 3;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 70; i++) {
  const a = rand() * Math.PI * 2, d = 105 + rand() * 120;
  const x = Math.cos(a) * d, z = Math.sin(a) * d;
  decor({ type: 'tree', pos: [r(x), 0, r(z)], height: r(10 + rand() * 8), kind: rand() < 0.6 ? 'pine' : 'oak' });
}
{
  const [cx, cz] = [-330, -150];
  decor({ type: 'box', pos: [cx, 18, cz], size: [40, 36, 30], mat: 'darkstone' });
  for (const [dx, dz] of [[-22, -16], [22, -16], [-22, 16], [22, 16]]) {
    decor({ type: 'cylinder', pos: [cx + dx, 25, cz + dz], radius: 6, height: 50, mat: 'darkstone' });
    decor({ type: 'cone', pos: [cx + dx, 50, cz + dz], radius: 7.5, height: 14, mat: 'slate' });
  }
  decor({ type: 'cylinder', pos: [cx, 45, cz], radius: 7, height: 90, mat: 'darkstone' });
  decor({ type: 'cone', pos: [cx, 90, cz], radius: 9, height: 22, mat: 'slate' });
}

// ---------------------------------------------------------------- write

const level = {
  name: 'Proving Grounds',
  spawn: { pos: [0, 0, 64], yaw: 0 },
  killY: -30,
  environment: { sunAzimuth: 318, sunElevation: 11 },
  checkpoints: [
    { pos: [0, 1.5, 64], size: [8, 3, 8], yaw: 0 },
    { pos: [0, 1.5, -18], size: [8, 3, 8], yaw: 0 },
  ],
  primitives: P,
  anchors: A,
  decor: D,
};

const list = (items) => '[\n' + items.map((i) => '    ' + JSON.stringify(i)).join(',\n') + '\n  ]';
const out = `{
  "name": ${JSON.stringify(level.name)},
  "spawn": ${JSON.stringify(level.spawn)},
  "killY": ${level.killY},
  "environment": ${JSON.stringify(level.environment)},
  "checkpoints": ${list(level.checkpoints)},
  "primitives": ${list(P)},
  "anchors": ${list(A)},
  "decor": ${list(D)}
}
`;
const target = fileURLToPath(new URL('../src/levels/testroom.json', import.meta.url));
writeFileSync(target, out);
console.log(`${P.length} primitives, ${A.length} anchors, ${D.length} decor → ${target}`);
