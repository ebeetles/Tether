import { GameAudio } from './audio/audio';
import { makeTuning } from './config';
import { DebugPanel } from './debug/panel';
import { InputSource } from './input/input';
import testRoom from './levels/testroom.json';
import { Hud } from './render/hud';
import { Renderer } from './render/renderer';
import { Level, type LevelData } from './sim/level';
import { STEP, Sim } from './sim/sim';

const T = makeTuning();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;

const debug = new DebugPanel(T, applyOverlays);
const sim = new Sim(new Level(testRoom as LevelData), T);
const renderer = new Renderer(canvas);
renderer.buildLevel(sim.level);
const hud = new Hud();
const input = new InputSource(canvas, T);
const audio = new GameAudio();

function applyOverlays(): void {
  renderer.setOverlays(debug.state.showCollision, debug.state.showRope);
  hud.showDebug = debug.state.showStats;
}
applyOverlays();

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.resize(w, h);
  hud.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

const hint = document.getElementById('hint')!;

function showMenu(show: boolean): void {
  overlay.classList.toggle('hidden', !show);
  hint.classList.toggle('hidden', show || input.locked);
}

// Clicking always starts play. If the browser grants pointer lock the mouse is captured;
// if it refuses (some embedded browsers do), aiming falls back to plain mouse movement.
overlay.addEventListener('click', () => {
  audio.start();
  input.unlockedPlay = true;
  showMenu(false);
  try {
    Promise.resolve(canvas.requestPointerLock()).catch(() => {});
  } catch {
    // Pointer lock unsupported: stay in unlocked play.
  }
});
document.addEventListener('pointerlockchange', () => {
  if (input.locked) {
    showMenu(false);
  } else {
    // Esc released the capture: back to the menu.
    input.unlockedPlay = false;
    showMenu(true);
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && input.unlockedPlay && !input.locked) {
    input.unlockedPlay = false;
    showMenu(true);
  }
});
// Guard against Ctrl+W (crouch + forward) closing the tab mid-run.
window.addEventListener('beforeunload', (e) => {
  if (input.locked) e.preventDefault();
});

// Fixed 120 Hz simulation; rendering at display rate, interpolated between steps.
let acc = 0;
let last = performance.now();
let fps = 60;

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1); // clamp after tab switches
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  if (!debug.state.paused) acc += dt * debug.state.timeScale;
  else if (debug.state.stepRequested) {
    acc += STEP;
    debug.state.stepRequested = false;
  }
  while (acc >= STEP) {
    sim.step(STEP, input.sample(STEP));
    acc -= STEP;
  }
  for (const e of sim.events) {
    renderer.onEvent(e, sim);
    audio.play(e);
  }
  sim.events.length = 0;

  renderer.draw(sim, acc / STEP, dt);
  hud.update(sim, renderer, fps);
  audio.update(renderer.view.speed);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Dev-only handle for poking the sim from the console.
if (import.meta.env.DEV) Object.assign(window, { tetherline: { sim, renderer, input, debug } });

// Live reload: edit the level JSON and the map rebuilds in place.
if (import.meta.hot) {
  import.meta.hot.accept('./levels/testroom.json', (mod) => {
    if (!mod) return;
    const level = new Level(mod.default as LevelData);
    sim.setLevel(level);
    renderer.buildLevel(level);
  });
}
