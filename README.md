# Tetherline

Third-person momentum parkour with a grappling hook. See [the design spec](Tetherline%20—%20Game%20Design%20Spec.md).

This is milestones 0–2 of the spec: engine foundations, the movement prototype and the grapple prototype. The test room is dressed as a medieval castle courtyard at sunset. TypeScript in the browser; Three.js is used only to render. The game loop, collision, physics, input and audio are our own code.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # headless physics and collision suite
npm run build    # typecheck + production build
node tools/build-testroom.mjs   # regenerate the test room map
```

## Controls

| Action | Keyboard + mouse | Gamepad |
| --- | --- | --- |
| Move | WASD | Left stick |
| Aim | Mouse | Right stick |
| Jump / wall jump / mantle | Space | A |
| Grapple (hold) | Left mouse | Right trigger |
| Zip | Release, then click again within 0.2 s | Same, on the trigger |
| Reel in / out | E / Q | RB / LB |
| Slide / roll | C or Left Ctrl | B |
| Sprint | Left Shift | Left stick click (toggle) |
| Restart from checkpoint | R | Back |
| Tuning panel / pause / step | `` ` `` / P / . | |

## Layout

```
src/
  math/vec3.ts         own vector math (the sim never imports Three.js)
  collision/           box + vertical cylinder primitives, capsule contacts, grid spatial hash, raycasts
  sim/                 deterministic 120 Hz simulation
    player.ts          movement state machine: ground, slide, stumble, air, wallrun, climb, ledge, mantle, vault
    grapple.ts         targeting, rope constraint (projection), reel, zip, assists
    camera.ts          spring-arm camera; lives in the sim because its aim drives targeting
    level.ts           JSON level format, moving anchors
  render/              Three.js renderer: sunset sky and fog (sky.ts), procedural textures,
                       merged static geometry and scenery (decor.ts), props, Verlet rope, HUD
  input/               keyboard/mouse (Pointer Lock) + gamepad → one InputFrame per step
  audio/               synthesized placeholder sounds + speed-pitched wind
  debug/panel.ts       live tuning for every spec number (persists in localStorage)
  levels/testroom.json the test room; edits hot-reload in place
tools/build-testroom.mjs  generates testroom.json from helpers (houses, towers, gallows, scaffolds)
tests/                 collision, movement and swing suites (vitest)
```

Every number in the spec is in `src/config.ts` and can be changed live from the tuning panel. The panel's graphics group toggles shadows, bloom and torch lights.

Levels can carry `decor` (scenery the simulation ignores: roofs, banners, torches, trees, windmill sails), a `mat` per primitive (stone, plaster, roof, wood, flagstone…), `hidden` colliders, and an `environment` block that sets the sun. All textures are painted on canvases at startup, so the game ships no image files.

## Choices the spec left open

- **Zip input.** With hold-to-grapple you can't "tap fire again while attached" without first letting go. Zip triggers when you release and press fire again within 0.2 s; the release still happens at once, so nothing feels delayed.
- **Reel-in speed gain.** The spec says reeling keeps tangential speed but also uses reeling "for speed". `swing.reelMomentum` sets the blend: 0 keeps tangential speed (the spec's literal reading), 1 conserves angular momentum. The default is 0.5.
- **Step-ups.** Obstacles up to 0.45 m are stepped over automatically, and taller ones up to 1.2 m are vaulted. The spec's 0.6 m vault minimum would otherwise leave a 0.45–0.6 m band that just blocks you.
- **Crouch key.** C as well as Left Ctrl, because Ctrl+W closes the tab on Windows and Linux. While the mouse is captured, leaving the page asks for confirmation.

## Not built yet

Ledge-grab and wall-climb animations, flow score, ghosts and time trial, the level editor, rope wrapping, air dash and dual hook (later unlocks), and real art and audio.
