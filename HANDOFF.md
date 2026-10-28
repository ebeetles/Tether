# Tetherline: handoff

Where the project stands, what's left to build, and how to polish it. Read this with the [design spec](Tetherline%20—%20Game%20Design%20Spec.md) and the [README](README.md).

## Where it stands

The movement and grapple prototype (spec milestones 0–2) runs in a test room dressed as a medieval castle courtyard at sunset. Milestone 3 has started on the art side but not on tools or modes.

| Milestone | Status |
| --- | --- |
| 0. Engine foundations | **Done.** 120 Hz fixed loop with interpolated rendering, input, capsule collision against boxes, ramps and cylinders, tuning panel. |
| 1. Movement prototype | **Built, not playtested.** Every move in the spec's movement table is in. Nobody has done the "fun for 10 minutes" gate yet. |
| 2. Grapple prototype | **Built, not playtested.** Hook, swing, reel, zip, release and all five assists work. Swing → wallrun → swing chains work in scripted runs; the "works every time in playtests" gate is still open. |
| 3. Level editor + vertical slice | **Not started**, apart from art. The level is authored with a generator script instead of an editor. No Time Trial, no ghosts, no Rooftop District. |
| 4–6 | Not started. |

**Verified:** 32 headless tests pass (`npm test`). They cover collision (seams, corners, ramps, no tunnelling at 35 and 60 m/s), movement (jump heights, coyote time, buffer, vault, slide, wallrun, climb, mantle, hard landing and roll) and the rope (√(2gh) at the bottom, no energy gain, never pushes, reel, moving anchors, assists, zip, cut). In the browser it holds 120 fps on an Apple-silicon Mac (about 300 draw calls, 100k triangles). It has not been measured on integrated graphics.

**Not verified:** nobody has played it with a real mouse or gamepad for any length of time. All the feel numbers are still the spec's starting values. **Do this before building more.**

## How the code fits together

- `src/sim/` is the whole game state, has no Three.js or DOM dependency, and is deterministic given its `InputFrame`s. Tests drive it headless through `tests/helpers.ts`.
- `src/render/` only reads the sim. The camera rig lives in the sim because its aim drives targeting and the movement basis.
- Every spec number is in `src/config.ts` and is editable live from the tuning panel (`` ` ``). Tweaks persist in localStorage, so after changing a default in code use **Reset all**.
- `tools/build-testroom.mjs` generates `src/levels/testroom.json`. Edit the script, not the JSON; running it hot-reloads the map.
- In dev builds `window.tetherline` exposes `{ sim, renderer, input, debug, hud }` for scripted checks from the console.

## 1. Core mechanics still to build

In rough priority order. The first three unblock the milestone 3 gate.

1. **Time Trial and ghosts** (spec: Modes, Fixed-step loop). Start/finish volumes, a run timer and medal times. Record positions at 30 Hz and replay them with interpolation; the sim is already deterministic, so you can also record inputs for debugging. Store best runs in localStorage.
2. **Level editor** (spec: Tech stack › Levels, Risks). Start small: in-game placement and nudging of boxes, cylinders, anchors and checkpoints, saved as JSON. The generator script is a stopgap. Its helpers (`house`, `tower`, `gallows`, `scaffold`, `merlons`) should become prefabs the editor can place.
3. **Rooftop District blockout** (spec: Level maps § 1), the first real map: a loop around a plaza, a crane-boom signature swing and a billboard wallrun shortcut.
4. **Flow score** (spec: Flow score). Chain multiplier for distinct moves, grace when touching ground above run speed, and a break on standing still or a hard landing. The sim already emits an event for every move (`src/sim/events.ts`), so this can be a pure consumer of those events.
5. **Moving collision geometry.** Only anchors move today. Foundry 9 needs cranes, conveyors and closing doors as moving colliders, and the player has to inherit their velocity when standing on them. This means kinematic shapes in `CollisionWorld` that are re-bucketed in the grid, plus contact velocity in `Player.resolve`.
6. **Hazard and kill volumes.** Only a global `killY` plane exists. Mist (Canopy), the molten channel (Foundry) and clouds (Skyharbor) need volumes that reset you to the last checkpoint.
7. **Environment forces.** Updraft columns (Skyharbor) and wind gusts that push the swing arc sideways (Storm Rig). Both are just accelerations added in `Player.updateAir` / `Hook.steer`.
8. **Progression unlocks** (spec: Progression). Zip is currently always on (`hook.zipEnabled`). Long rope and fast reel are tuning changes. **Air dash** is a new move in `updateAir`. **Dual hook** means generalising `Hook` to two instances, each a separate constraint (projected in sequence, or iterated a couple of times).
9. **Rope wrapping around corners** (spec stretch goal). Today the rope cuts after 0.2 s of blocked line of sight (`Hook.post`).
10. **Settings menu.** Assist toggles, hook toggle mode, mouse sensitivity, field of view and graphics exist only in the dev tuning panel. Players need a real settings screen, plus key remapping (bindings are already data in `src/input/input.ts`).
11. **Leaderboards and ghost downloads** (milestone 5): a small server, later.

## 2. Feel: playtest and tune first

Specific things to watch when playtesting the current build:

- **Slack-to-taut yank.** When a slack rope goes taut while you move outward, the rope removes all the outward speed. One scripted run lost 19.5 → 13.9 m/s. That is the spec's one-way rope working as written, but it may feel punishing. Option: run the attach-smoothing blend (`assists.attachSmoothing`) on every slack→taut transition, not only at attach.
- **Reel momentum.** `swing.reelMomentum` defaults to 0.5. The spec contradicts itself (keep tangential speed vs. "reel for speed"), so pick a value in playtests.
- **Gravity 9.81** makes jumps floaty for a platformer. The spec ties swing speed to real g (a 15 m drop gives 17 m/s). If jumps feel slow, add a separate fall-gravity multiplier for non-rope airborne states rather than changing g.
- **Over-speed decay with no input** is 4 m/s², so letting go of the keys at 25 m/s slides for seconds. Consider a stronger decay when there's no input.
- **Wallrun entry** needs an actual wall contact at under 50°. Check that swing-to-wallrun triggers whenever a player expects it to. Brushing a wall at the end of a swing is the core chain.
- **Targeting.** The 25° cone is measured from the camera. Check that the anchor you're looking at is the one the hook picks at speed, and tune `assists.anchorAheadWeight`.
- **Camera** with the pitch bias while swinging and auto-recentre: check it never fights the player's aim.

## 3. Polish

### Visual
- **Character.** The player is a capsule with a hood and a cape. Needs a rigged, animated model. Authored clips plus the procedural lean that already exists (spec: Art and audio). Biggest visual gap.
- **Effects.** Dust on landings, slides and wallrun feet; sparks or a puff when the hook bites; wind trails at speed; a faint radial blur above 20 m/s (the spec asks for it; only speed lines exist).
- **Rope.** Add a twisted-hemp texture, and a short snap wave along the Verlet line when it goes taut.
- **Anchor readability.** Glows are larger now, but check them at 30 m/s against the sunset, and consider a faint outline through walls for the targeted anchor.
- **The map.** The courtyard is dense in the south and north, sparser in the east. Outside the walls the trees and hills have no collision, and the far meadow is empty. Either add an invisible boundary or make outside a real space.
- **Known visual cheats.** Perimeter walls don't cast shadows (the low sun would shade the whole yard). The fountain's collider sits 5 cm above the water, so you walk on it. Conical roofs use hidden stepped cylinders, so the player clips into the slope a little.

### Audio
Every sound is a synthesized placeholder (`src/audio/audio.ts`). Needed:
- Real recordings for hook fire, hook hit, rope taut and release. The **taut** sound matters most (spec).
- Footsteps per surface material, and a wind loop.
- Music that layers in with the flow chain.
- Spatial audio for torches, the bell and the windmill.

### UI
- **Missing screens:** pause menu, settings, results (time, medal, flow) and a map-select scroll.
- **HUD:** a time-trial timer, split deltas and a flow meter, styled like the speed medallion.
- **Fonts** load from Google Fonts. Self-host them before shipping a packaged or offline build.

### Accessibility (milestone 6)
- Field-of-view and camera-tilt sliders, a reduced-motion option (no speed lines, roll or dip), and remapping.
- An alternative to the anchor glow colour for colour-blind players.

## 4. Tech debt and risks

- **Performance on integrated graphics** is unmeasured. Before content work, measure on a mid-range laptop and add quality presets: shadow map size (currently 4096), bloom on or off, pixel ratio, fewer torch lights (currently up to 8).
- **Bundle size.** Three.js is about 600 kB in one chunk. Code-split if load time matters.
- **Collision** handles boxes and vertical cylinders only. There are no slanted cylinders, no capsule-vs-capsule and no swept tests: speed is handled with substeps of at most 0.2 m. Keep levels primitive-only, as the spec intends.
- **No clipping bot yet.** The spec's mitigation is a bot that replays recorded runs to catch clipping. Build it once ghosts exist.
- **Test gaps:** camera rig, targeting edge cases (cone boundary, line of sight to moving anchors), wheel-motion anchors and level loading.
- **Embedded browsers** refuse pointer lock. The game falls back to plain mouse aiming, which stops at the window edge. Fine for previews, not for play.
- **Saved tuning** in localStorage can mask new defaults. Version the storage key (`tetherline.tuning.v1`) when defaults change meaningfully.

## 5. Open questions from the spec

These are still unanswered and affect scope:
- Should grapple surfaces be widely available or limited to anchors?
- Is the dual hook in v1?
- Is there a story or character, or is it a pure movement game? The medieval dressing suggests a setting; decide if it is the game's identity or just the test room's.
- Does Free Roam need a hub world?

The browser-vs-native and Three.js questions are settled in practice by this build.

## Suggested next two weeks

1. Playtest with mouse and gamepad, and tune the feel items in section 2. Commit the agreed numbers as new defaults.
2. Build Time Trial with local ghosts in the test room.
3. Start the level editor (place, move and save primitives and anchors).
4. Block out Rooftop District in grey boxes and run the milestone 3 gate with outside playtesters.
