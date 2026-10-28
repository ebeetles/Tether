import * as THREE from 'three';

// Procedural, seamlessly tiling textures drawn on canvases at startup, so the game ships
// no image assets. Each painter draws a colour map and a matching height map (for bump).

const SIZE = 512;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

function makeCanvas(size = SIZE): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

/** Draw `fn` at offsets so shapes crossing an edge wrap to the opposite side. */
function wrapped(x: number, y: number, w: number, h: number, size: number, fn: (x: number, y: number) => void) {
  for (const ox of [0, -size, size]) {
    for (const oy of [0, -size, size]) {
      if (x + ox > size || x + ox + w < 0 || y + oy > size || y + oy + h < 0) continue;
      fn(x + ox, y + oy);
    }
  }
}

function grain(ctx: Ctx, amount: number, rnd: () => number, size = SIZE) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** Large soft blotches for colour variation across a surface. */
function blotches(ctx: Ctx, rnd: () => number, count: number, color: () => string, rMin: number, rMax: number) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * SIZE, y = rnd() * SIZE, r = rMin + rnd() * (rMax - rMin);
    wrapped(x - r, y - r, r * 2, r * 2, SIZE, (px, py) => {
      const g = ctx.createRadialGradient(px + r, py + r, 0, px + r, py + r, r);
      g.addColorStop(0, color());
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px, py, r * 2, r * 2);
    });
  }
}

export interface Painted {
  color: HTMLCanvasElement;
  height?: HTMLCanvasElement;
}

/** Ashlar stone blocks in staggered courses. */
function stone(seed: number, hue: number, sat: number, light: number): Painted {
  const rnd = mulberry32(seed);
  const [c, ctx] = makeCanvas();
  const [hc, hctx] = makeCanvas();
  ctx.fillStyle = hsl(hue, sat * 0.6, light * 0.55);
  ctx.fillRect(0, 0, SIZE, SIZE);
  hctx.fillStyle = '#000';
  hctx.fillRect(0, 0, SIZE, SIZE);
  const rows = 8, rh = SIZE / rows, mortar = 5;
  for (let r = 0; r < rows; r++) {
    let x = rnd() * 120;
    const y = r * rh;
    while (x < SIZE + 120) {
      const w = 70 + rnd() * 110;
      const l = light + (rnd() - 0.5) * 12, hh = hue + (rnd() - 0.5) * 10;
      wrapped(x, y, w, rh, SIZE, (px, py) => {
        ctx.fillStyle = hsl(hh, sat, l);
        ctx.fillRect(px + mortar / 2, py + mortar / 2, w - mortar, rh - mortar);
        // Worn edges: darker rim, lighter top lip.
        ctx.strokeStyle = hsl(hh, sat, l - 12, 0.6);
        ctx.lineWidth = 3;
        ctx.strokeRect(px + mortar / 2 + 1.5, py + mortar / 2 + 1.5, w - mortar - 3, rh - mortar - 3);
        ctx.fillStyle = hsl(hh, sat, l + 8, 0.35);
        ctx.fillRect(px + mortar / 2, py + mortar / 2, w - mortar, 3);
        const g = hctx.createLinearGradient(px, py, px, py + rh);
        g.addColorStop(0, '#d0d0d0');
        g.addColorStop(0.5, '#f0f0f0');
        g.addColorStop(1, '#a8a8a8');
        hctx.fillStyle = g;
        hctx.fillRect(px + mortar / 2 + 1, py + mortar / 2 + 1, w - mortar - 2, rh - mortar - 2);
      });
      x += w;
    }
  }
  blotches(ctx, rnd, 40, () => hsl(hue + 10, sat, light - 15, 0.12), 20, 70);
  blotches(ctx, rnd, 20, () => hsl(95, 25, 30, 0.08), 15, 50); // moss
  grain(ctx, 18, rnd);
  grain(hctx, 30, rnd);
  return { color: c, height: hc };
}

/** Rounded cobbles with dark earth between them. */
function cobble(seed: number): Painted {
  const rnd = mulberry32(seed);
  const [c, ctx] = makeCanvas();
  const [hc, hctx] = makeCanvas();
  ctx.fillStyle = hsl(28, 16, 30);
  ctx.fillRect(0, 0, SIZE, SIZE);
  hctx.fillStyle = '#000';
  hctx.fillRect(0, 0, SIZE, SIZE);
  const n = 10, cell = SIZE / n;
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const cx = (gx + 0.5 + (rnd() - 0.5) * 0.35) * cell + (gy % 2) * cell * 0.5;
      const cy = (gy + 0.5 + (rnd() - 0.5) * 0.35) * cell;
      const rx = cell * (0.38 + rnd() * 0.12), ry = cell * (0.36 + rnd() * 0.12);
      const rot = rnd() * Math.PI;
      const l = 46 + (rnd() - 0.5) * 12, h = 30 + (rnd() - 0.5) * 20, s = 8 + rnd() * 8;
      wrapped(cx - rx, cy - ry, rx * 2, ry * 2, SIZE, (px, py) => {
        const x = px + rx, y = py + ry;
        const g = ctx.createRadialGradient(x - rx * 0.3, y - ry * 0.3, 1, x, y, Math.max(rx, ry));
        g.addColorStop(0, hsl(h, s, l + 6));
        g.addColorStop(1, hsl(h, s, l - 8));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
        ctx.fill();
        const hg = hctx.createRadialGradient(x, y, 1, x, y, Math.max(rx, ry));
        hg.addColorStop(0, '#fff');
        hg.addColorStop(1, '#555');
        hctx.fillStyle = hg;
        hctx.beginPath();
        hctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
        hctx.fill();
      });
    }
  }
  grain(ctx, 16, rnd);
  return { color: c, height: hc };
}

/** Planks with grain, seams and nails. */
function planks(seed: number, hue: number, light: number): Painted {
  const rnd = mulberry32(seed);
  const [c, ctx] = makeCanvas();
  const [hc, hctx] = makeCanvas();
  const rows = 8, rh = SIZE / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    const l = light + (rnd() - 0.5) * 8;
    ctx.fillStyle = hsl(hue, 38, l);
    ctx.fillRect(0, y, SIZE, rh);
    for (let i = 0; i < 26; i++) {
      const gy = y + rnd() * rh;
      ctx.strokeStyle = hsl(hue, 40, l + (rnd() < 0.5 ? -7 : 5), 0.5);
      ctx.lineWidth = 0.6 + rnd() * 1.4;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 0; x <= SIZE; x += 32) ctx.lineTo(x, gy + Math.sin(x * 0.02 + i) * 2.5);
      ctx.stroke();
    }
    hctx.fillStyle = '#ddd';
    hctx.fillRect(0, y, SIZE, rh);
    // Seams between planks and a butt joint somewhere along the row.
    ctx.fillStyle = hsl(hue, 30, l - 22);
    ctx.fillRect(0, y, SIZE, 3);
    hctx.fillStyle = '#222';
    hctx.fillRect(0, y, SIZE, 3);
    const joint = rnd() * SIZE;
    ctx.fillRect(joint, y, 3, rh);
    hctx.fillRect(joint, y, 3, rh);
    ctx.fillStyle = hsl(0, 0, 15, 0.8);
    for (const nx of [joint - 10, joint + 12]) {
      for (const ny of [y + rh * 0.3, y + rh * 0.7]) {
        ctx.beginPath();
        ctx.arc((nx + SIZE) % SIZE, ny, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  grain(ctx, 12, rnd);
  return { color: c, height: hc };
}

/** Half-timbered wall: cream plaster between dark oak beams and braces. */
function halfTimber(seed: number): Painted {
  const rnd = mulberry32(seed);
  const [c, ctx] = makeCanvas();
  const [hc, hctx] = makeCanvas();
  ctx.fillStyle = hsl(40, 45, 82);
  ctx.fillRect(0, 0, SIZE, SIZE);
  blotches(ctx, rnd, 60, () => hsl(35, 30, 65, 0.12), 15, 60);
  grain(ctx, 14, rnd);
  hctx.fillStyle = '#777';
  hctx.fillRect(0, 0, SIZE, SIZE);
  const beam = 26;
  const wood = hsl(22, 35, 18);
  const drawBeam = (x0: number, y0: number, x1: number, y1: number) => {
    for (const [cx, col] of [[ctx, wood], [hctx, '#eee']] as const) {
      cx.strokeStyle = col;
      cx.lineWidth = beam;
      cx.lineCap = 'square';
      cx.beginPath();
      cx.moveTo(x0, y0);
      cx.lineTo(x1, y1);
      cx.stroke();
    }
  };
  drawBeam(0, beam / 2, SIZE, beam / 2);
  drawBeam(0, SIZE / 2, SIZE, SIZE / 2);
  for (const x of [beam / 2, SIZE / 2]) drawBeam(x, 0, x, SIZE);
  drawBeam(beam, SIZE / 2 - beam, SIZE / 2 - beam, beam);
  drawBeam(SIZE / 2 + beam, beam, SIZE - beam, SIZE / 2 - beam);
  drawBeam(beam, SIZE / 2 + beam, SIZE / 2 - beam, SIZE - beam);
  drawBeam(SIZE / 2 + beam, SIZE - beam, SIZE - beam, SIZE / 2 + beam);
  ctx.globalAlpha = 0.25;
  grain(ctx, 30, rnd);
  ctx.globalAlpha = 1;
  return { color: c, height: hc };
}

/** Clay roof tiles / shingles in overlapping rows. */
function roofTiles(seed: number, hue: number, sat: number, light: number): Painted {
  const rnd = mulberry32(seed);
  const [c, ctx] = makeCanvas();
  const [hc, hctx] = makeCanvas();
  ctx.fillStyle = hsl(hue, sat, light - 20);
  ctx.fillRect(0, 0, SIZE, SIZE);
  const rows = 16, rh = SIZE / rows, tw = 32;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * tw * 0.5;
    for (let x = -tw; x < SIZE + tw; x += tw) {
      const l = light + (rnd() - 0.5) * 14;
      const px = x + off, py = r * rh;
      const g = ctx.createLinearGradient(0, py, 0, py + rh);
      g.addColorStop(0, hsl(hue, sat, l - 12));
      g.addColorStop(0.8, hsl(hue, sat, l + 4));
      g.addColorStop(1, hsl(hue, sat, l - 18));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(px + 1, py);
      ctx.lineTo(px + tw - 1, py);
      ctx.lineTo(px + tw - 1, py + rh - 4);
      ctx.quadraticCurveTo(px + tw / 2, py + rh + 4, px + 1, py + rh - 4);
      ctx.fill();
      const hg = hctx.createLinearGradient(0, py, 0, py + rh);
      hg.addColorStop(0, '#444');
      hg.addColorStop(1, '#eee');
      hctx.fillStyle = hg;
      hctx.fillRect(px + 1, py, tw - 2, rh);
    }
  }
  blotches(ctx, rnd, 30, () => hsl(80, 20, 30, 0.1), 15, 50);
  grain(ctx, 14, rnd);
  return { color: c, height: hc };
}

function grass(seed: number, hue: number, light: number): Painted {
  const rnd = mulberry32(seed);
  const [c, ctx] = makeCanvas();
  ctx.fillStyle = hsl(hue, 34, light);
  ctx.fillRect(0, 0, SIZE, SIZE);
  blotches(ctx, rnd, 80, () => hsl(hue + (rnd() - 0.5) * 30, 35, light + (rnd() - 0.5) * 16, 0.35), 20, 80);
  for (let i = 0; i < 4000; i++) {
    const x = rnd() * SIZE, y = rnd() * SIZE;
    ctx.strokeStyle = hsl(hue + (rnd() - 0.5) * 25, 40, light + (rnd() - 0.4) * 18, 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 3, y - 3 - rnd() * 5);
    ctx.stroke();
  }
  grain(ctx, 12, rnd);
  return { color: c };
}

function stainedGlass(seed: number): Painted {
  const rnd = mulberry32(seed);
  const [c, ctx] = makeCanvas();
  const colors = ['#1f3f9e', '#a8202a', '#d9a420', '#2f7a3a', '#5a2a8a', '#1f6f9e'];
  const n = 8, cell = SIZE / n;
  const pts: [number, number][][] = [];
  for (let y = 0; y <= n; y++) {
    pts.push([]);
    for (let x = 0; x <= n; x++) {
      const edge = x === 0 || y === 0 || x === n || y === n;
      pts[y].push([x * cell + (edge ? 0 : (rnd() - 0.5) * cell * 0.6), y * cell + (edge ? 0 : (rnd() - 0.5) * cell * 0.6)]);
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [a, b, cc, d] = [pts[y][x], pts[y][x + 1], pts[y + 1][x + 1], pts[y + 1][x]];
      for (const tri of rnd() < 0.5 ? [[a, b, cc], [a, cc, d]] : [[a, b, d], [b, cc, d]]) {
        ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
        ctx.beginPath();
        ctx.moveTo(tri[0][0], tri[0][1]);
        ctx.lineTo(tri[1][0], tri[1][1]);
        ctx.lineTo(tri[2][0], tri[2][1]);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#151210';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
    }
  }
  // A rose window motif.
  ctx.strokeStyle = '#151210';
  ctx.lineWidth = 8;
  for (const r of [70, 140, 210]) {
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  grain(ctx, 20, rnd);
  return { color: c };
}

export function textureFrom(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const PAINTERS: Record<string, () => Painted> = {
  stone: () => stone(11, 34, 14, 58),
  darkstone: () => stone(12, 250, 6, 38),
  sandstone: () => stone(13, 36, 32, 66),
  flagstone: () => stone(14, 30, 10, 50),
  cobble: () => cobble(21),
  wood: () => planks(31, 28, 38),
  darkwood: () => planks(32, 20, 20),
  plaster: () => halfTimber(41),
  roof: () => roofTiles(51, 12, 52, 40),
  slate: () => roofTiles(52, 225, 12, 32),
  grass: () => grass(61, 82, 34),
  meadow: () => grass(62, 70, 40),
  glass: () => stainedGlass(71),
};

/** Banner cloth with a swallowtail and an emblem; transparent outside the shape. */
export function bannerCanvas(color: string, emblem: string, swallowtail = true): HTMLCanvasElement {
  const w = 256, h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h);
  if (swallowtail) ctx.lineTo(w / 2, h * 0.84);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const shade = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 6; i++) shade.addColorStop(i / 6, i % 2 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.06)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#d6a73c';
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#e6b84a';
  ctx.font = `bold ${w * 0.62}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emblem, w / 2, h * 0.4);
  return c;
}

/** Soft radial sprite (glows, flames). */
export function radialSprite(inner: string, mid: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.3, mid);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Glowing rune circle for checkpoint waystones. */
export function runeCircle(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512);
  const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
  ctx.strokeStyle = 'rgba(120,255,240,0.9)';
  ctx.fillStyle = 'rgba(120,255,240,0.9)';
  ctx.lineWidth = 6;
  for (const r of [240, 200, 120]) {
    ctx.beginPath();
    ctx.arc(256, 256, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.font = '32px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.save();
    ctx.translate(256 + Math.cos(a) * 220, 256 + Math.sin(a) * 220);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(runes[i % runes.length], 0, 0);
    ctx.restore();
  }
  ctx.lineWidth = 4;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(256 + Math.cos(a) * 128, 256 + Math.sin(a) * 128);
    ctx.lineTo(256 + Math.cos(a) * (i % 2 ? 160 : 192), 256 + Math.sin(a) * (i % 2 ? 160 : 192));
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
