# Tetherline — Game Design Spec

Oct 28, 2026 · @ebeetles

## Overview

Tetherline is a third-person 3D parkour game where speed comes from momentum: you run, wallrun and vault to build it, and a grappling hook turns it into long, smooth swings across hand-built maps. The whole game lives or dies on one feeling — a swing that releases into a wallrun into another swing without ever touching the ground.

**Pillars**

- **Momentum is the currency.** Speed earned from a swing or a drop is kept, never silently clamped. Good lines are faster lines.
- **Readable, then expressive.** A new player can follow the obvious route; an expert finds shortcuts, skips and chains the level designer barely intended.
- **Physics you can trust.** The rope behaves the same way every time. Assists exist, but they nudge the player toward the arc they were already going for — they never take control away.
- **Every map has a verb.** Each level is built around one movement idea (vertical climbing, moving anchors, long-gap swings) so it teaches something new.

**Scope (v1)**

| Item | Target |
| --- | --- |
| Platform | Desktop web browser (keyboard/mouse + gamepad); a packaged desktop app later if wanted |
| Engine | None. TypeScript in the browser, Three.js for rendering only; game loop, physics, collision, input, audio and level editor written from scratch (see Tech stack) |
| Maps | 6 handcrafted maps, each 3–6 minutes for a first clear, under 90 seconds for an expert run |
| Modes | Campaign route, Time Trial with ghosts, Free Roam |
| Team | Solo or 2–3 people; one programmer owns the engine layer and movement |
| Players | Single-player; async multiplayer through leaderboards and ghost replays |

## Core movement

The character is a capsule with its own position and velocity, moved by our own code every fixed step. There is no physics library, so momentum is fully under our control. Every move below is a state in one movement state machine; transitions keep horizontal velocity unless a row says otherwise.

| Move | Trigger | Behaviour | Starting values (tune in playtests) |
| --- | --- | --- | --- |
| Run | Stick / WASD | Accelerates to run speed; above it, speed decays slowly instead of snapping down | Run 9 m/s, accel 60 m/s², over-speed decay 4 m/s² |
| Sprint | Hold sprint or full stick for 0.5 s | Higher cap; no stamina in v1 | 12 m/s |
| Jump | Jump | Fixed-height jump; holding extends to full height, early release cuts it | 1.6 m full, 0.8 m tap; coyote time 0.12 s; jump buffer 0.12 s |
| Air control | Stick while airborne | Steers without adding speed past the current horizontal speed | 35% of ground accel |
| Wallrun | Jump into a wall at a shallow angle (< 50°) while moving > 6 m/s | Runs along the wall with reduced gravity; camera tilts away from the wall | Max 1.6 s, gravity × 0.25 rising to × 1 at the end |
| Wall jump | Jump during wallrun or wall contact | Launches up and away from the wall; may chain to the opposite wall | 7 m/s off-wall + 5 m/s up |
| Wall climb | Jump into a wall head-on | Short vertical run, then a ledge grab or a kick-off | Up to 3 m |
| Vault | Run into an obstacle 0.6–1.2 m tall | Hand-plant animation clears it with no speed loss | Keeps 100% of speed |
| Ledge grab / mantle | Reach a ledge edge while falling or climbing | Snaps hands to the edge; jump to mantle, back to drop | Grab window 0.4 m below the edge |
| Slide | Crouch while running | Low profile; gains speed downhill, loses it on flat ground | +2 m/s on entry, friction 3 m/s² |
| Roll | Land holding crouch, or land with a well-timed press | Cancels landing stun and keeps speed | Window 0.2 s before landing |
| Hard landing | Fall > 8 m without a roll | Brief stumble, speed cut to run speed | 0.35 s stumble |

**Momentum rules**

- Speed gained from swings, drops and slides is kept. Ground movement only bleeds the excess slowly, so a good swing pays off over the next several moves.
- Every move that changes direction (wall jump, vault, mantle) preserves speed magnitude and redirects it.
- No hard global speed cap in v1. A soft cap of 35 m/s adds drag above that speed to protect collision and streaming.

The drawing below shows how the states connect.

&#91;embedded content: movement state machine · 6 states\]

The hook can also attach from Grounded or Wallrun; those arrows are left out to keep the picture readable. Every state shares one velocity, which is why momentum carries across all transitions.

## Grappling hook

One hook, fired at designer-placed or tagged surfaces, held as an inextensible rope. One hook keeps the swing readable and the level design controllable; a second hook is a late unlock (see Progression).

**What you can attach to**

- **Anchor points** — authored objects (lamp posts, crane hooks, branches, ring bolts) with a visible glow when in range. These are the main route.
- **Grapple surfaces** — undersides of beams, ledges and ceilings tagged `grappleable`. These let experts improvise.
- **Moving anchors** — anchors on cranes, airships or pendulums. The rope follows the anchor every physics step, so the player inherits its motion.
- Never: the ground under the player, glass, or anything tagged `no-grapple` (used to close off exploits).

**Targeting**

1. Each frame, gather anchors and surfaces inside a 40 m range and a 25° cone around the camera's aim.
2. Score each candidate: closeness to screen centre (biggest weight), whether it is ahead of the player's velocity, height above the player, and line of sight.
3. Highlight the best candidate with a reticle; it is what the hook will hit if you fire now.
4. If nothing qualifies, the hook fires straight along the aim ray and attaches to whatever grapple surface it hits within range, or whiffs.

**Firing and attaching**

| Parameter | Starting value | Notes |
| --- | --- | --- |
| Range | 40 m | Upgradeable to 55 m |
| Travel | 120 m/s visual travel | Hit is decided on the frame of firing so the game never feels laggy |
| Attach | Rope length set to current distance | Then optionally auto-shortened (see Swing physics) |
| Reel in / out | Hold reel buttons | 12 m/s in, 8 m/s out; min length 3 m |
| Zip | Tap fire again while attached | Pulls the player straight to the anchor at 25 m/s, then pops them up over it |
| Release | Release fire | Keeps all velocity; small release boost if timed well |
| Cooldown | None | The limit is one rope at a time, not a timer |

**Rope model**

The rope is a one-way distance constraint: slack when the player is closer than its length, rigid when they reach it. It is not a spring — springs feel rubbery and bounce. Visually the rope is a 12-segment Verlet line, so slack rope sags and snaps taut, but the visual rope never drives the physics. Rope wrapping around corners is a stretch goal; in v1 the rope cuts if it passes through level geometry for more than 0.2 s.

## Swing physics

Swinging is plain gravity plus a rope constraint, solved by projection every fixed step at 120 Hz. Projection is stable at any speed, never adds energy, and gives the clean pendulum arc players expect; everything that makes it feel good is layered on top as small, tunable assists.

**The core step** (anchor position a, rope length L, player position p, velocity v, gravity g)

```latex
\begin{aligned}
\mathbf{v} &\leftarrow \mathbf{v} + (\mathbf{g} + \mathbf{a}_{\text{input}})\,\Delta t \\
\mathbf{p} &\leftarrow \mathbf{p} + \mathbf{v}\,\Delta t \\
\mathbf{n} &= \frac{\mathbf{p} - \mathbf{a}}{\lVert \mathbf{p} - \mathbf{a} \rVert} \\
\text{if } \lVert \mathbf{p} - \mathbf{a} \rVert > L:\quad \mathbf{p} &\leftarrow \mathbf{a} + L\,\mathbf{n}, \qquad \mathbf{v} \leftarrow \mathbf{v} - \max(0,\ \mathbf{v}\cdot\mathbf{n})\,\mathbf{n}
\end{aligned}
```

The last line is the whole rope. Snapping p back onto the sphere of radius L keeps the rope taut, and removing only the outward part of v (the part along n) means the rope can pull but never push. The tangential part of v is untouched, so speed at the bottom of a drop of height h comes out as √(2gh), as a real pendulum would give. A 15 m drop gives about 17 m/s.

**Player input on the rope**

- **Steering.** Stick input is projected onto the plane tangent to the rope: a\_input = k·(u − (u·n)n), where u is the stick direction in world space. With k = 6 m/s², a player can widen, narrow or curve the arc but not hover.
- **Pumping.** Pushing along the direction of travel near the bottom of the arc adds speed (the same term above, aligned with v). Pumping is how you climb out of a short swing; it is capped so a held stick cannot gain more than 15% speed per swing.
- **Reeling.** Reeling in shortens L. Because tangential speed is kept while the radius shrinks, the swing speeds up — the same effect as a skater pulling their arms in. This is a deliberate, learnable expert tool.

**Assists (each can be turned down in settings)**

| Assist | What it does | Starting value |
| --- | --- | --- |
| Ground clearance | On attach, if the lowest point of the arc (a − L·up) is within 1.5 m of the ground, L is shortened smoothly over 0.15 s so the player swings over it | 1.5 m clearance |
| Release boost | Releasing while rising past the bottom of the arc, within 0.15 s of the ideal point, adds speed along v | +10%, max +3 m/s |
| Release lift | A small upward kick on release so swings chain into the next anchor instead of falling short | +2 m/s up |
| Anchor-ahead bias | Targeting scores anchors ahead of v higher, so a fast player gets the anchor that continues the line | Weight 0.3 |
| Attach smoothing | If attaching would yank v by more than 60°, the turn is blended over 0.1 s | 60° threshold |

**Edge cases**

- Hitting a wall while swinging: the player bounces off along the wall normal with 30% of the normal speed, or enters a wallrun if the angle allows it. Swing-to-wallrun is a core chain, so it must work reliably.
- Touching the ground with the rope taut: the player keeps running or sliding while attached; the rope auto-releases after 0.5 s on the ground.
- Moving anchors: the anchor's velocity is added to the projection, so a player on a crane rope inherits the crane's swing.
- Speed: the soft 35 m/s cap from Core movement applies; collision runs in substeps above 20 m/s so fast movement never tunnels through thin walls.

## Camera and controls

The camera sells speed and keeps the next anchor in view; controls keep fire, jump and release on separate fingers so chains never need a hand shift.

**Camera**

- Spring-arm follow camera, 4.5 m behind and 1.2 m above the shoulder, offset slightly right so the reticle is clear of the body.
- Field of view widens with speed: 75° at a standstill to 95° at 30 m/s, smoothed over 0.3 s.
- While swinging, the arm stretches to 6 m and pitches toward the anchor so the whole arc is visible.
- Wallrun tilts the camera 8° away from the wall. Landings add a small dip, not a shake.
- Auto-recentre behind the velocity direction only after 1.5 s without camera input; the player's aim always wins.
- Collision pulls the camera in rather than letting it clip; thin geometry (poles, wires) is ignored by camera collision.

**Controls**

| Action | Gamepad | Keyboard + mouse |
| --- | --- | --- |
| Move | Left stick | WASD |
| Camera / aim | Right stick | Mouse |
| Jump / wall jump | A / Cross | Space |
| Fire hook (hold to stay attached) | Right trigger | Left mouse |
| Zip to anchor | Tap right trigger while attached | Tap left mouse while attached |
| Reel in / out | Right / left bumper | E / Q |
| Slide / roll | B / Circle | Left Ctrl |
| Sprint | Left stick click (toggle) | Left Shift |
| Restart from checkpoint | Back / Select | R |

All bindings are remappable. An optional "tap to toggle" mode lets the hook stay attached until fire is pressed again, for players who find holding the trigger tiring.

## Level maps

Six maps, each built around one movement verb and ordered so each teaches what the next one assumes. Every map has a main route marked by anchor glow and colour, two or more expert shortcuts, and one signature set piece.

| # | Map | Verb it teaches | Size (approx.) | Anchor density |
| --- | --- | --- | --- | --- |
| 1 | Rooftop District | Run, vault, first swings | 400 × 400 m | High |
| 2 | The Canopy | Vertical swinging and climbing | 300 × 300 m, 120 m tall | High |
| 3 | Foundry 9 | Moving anchors and timing | 250 × 500 m interior | Medium |
| 4 | Glass Spire | Wallrun chains and ascent | 80 × 80 m, 400 m tall | Low |
| 5 | Skyharbor | Long-gap swings and reel tricks | 1.2 km across | Sparse |
| 6 | Storm Rig | Everything, under pressure | 500 × 500 m | Mixed, some hidden |

### 1. Rooftop District

A dense block of low rooftops at golden hour: water towers, AC units, laundry lines, fire escapes and construction cranes. Gaps start at jumpable and widen until a swing is the only way across.

- **Layout:** a loop around a central plaza, so the player sees the finish early and spends the level getting to it.
- **Teaches:** vault, wallrun between close buildings, first grapples on lamp posts and crane hooks, release timing.
- **Signature moment:** a crane boom stretched over the plaza. One swing from its hook carries the player across the whole square if they release on time.
- **Expert line:** a billboard row that allows a wallrun-to-swing chain skipping a third of the loop.

### 2. The Canopy

A forest of giant redwoods with mist hiding the floor. Branches are anchors, trunks are wallrun surfaces, and the route climbs upward in a spiral.

- **Layout:** three tiers (understory, mid-canopy, crown), connected by rope bridges and hollow trunks.
- **Teaches:** swinging upward, reeling in to gain height, wall climb into ledge grab.
- **Signature moment:** a dead tree falls during the run; the player swings from branches on it while it tips, then leaps off its crown onto the next tier.
- **Hazard:** falling into the mist resets to the last checkpoint, so it is a soft fail.

### 3. Foundry 9

A huge working factory interior: overhead gantry cranes on rails, swinging hook loads, conveyor belts and a molten channel down the middle.

- **Layout:** a long hall in three sections, each with its own machinery rhythm.
- **Teaches:** moving anchors (the player inherits crane motion), timing a release to the machine's cycle, sliding under closing doors.
- **Signature moment:** riding a gantry crane's hook the length of the hall, then using its momentum to fling over the molten channel.
- **Expert line:** grapple surfaces on the roof trusses let fast players skip crane cycles entirely.

### 4. Glass Spire

A climb up the outside and inside of a 400 m skyscraper under construction. The tower faces are glass (no grapple), so the player must wallrun and use scaffolding and window-washer rigs.

- **Layout:** spiral ascent alternating exterior faces and hollow interior floors; checkpoint every 50 m.
- **Teaches:** long wallrun chains, wall jumps between facing walls, short-rope swings on scaffold poles.
- **Signature moment:** the top floors open into an atrium where the player swings from a hanging sculpture to reach the roof helipad.
- **Constraint:** low anchor density is deliberate, so each anchor is a reward.

### 5. Skyharbor

Floating islands and moored airships above a cloud sea. Distances are long; the hook's 40 m range means the player must build height and speed to reach the next anchor.

- **Layout:** a hub island with three branching routes that meet at a lighthouse. Players pick routes by skill.
- **Teaches:** long arcs, reeling in at the bottom for speed, release lift, using wind updrafts to recover height.
- **Signature moment:** a chain of drifting airships, each a moving anchor, crossing a gap with no ground below.
- **Hazard:** falling into the clouds is a fail; updraft columns are the safety net.

### 6. Storm Rig

An offshore oil platform at night in a storm. Rain, wind gusts that push the swing arc sideways, and lightning that briefly lights up anchors hidden in the dark.

- **Layout:** a ring of rigs connected by cables and walkways, ending on the flare stack at the top.
- **Teaches:** nothing new; it combines every earlier verb at higher speed.
- **Signature moment:** a wave smashes a walkway mid-run, forcing an improvised swing from the derrick.
- **Readability:** anchors keep a faint glow so the storm adds pressure without making the route invisible.

**Level-building rules (all maps)**

- The main route is always readable from the spot the player is standing on: the next anchor is visible before you need it.
- Checkpoints every 20–40 seconds of play. Respawn is under 1 second.
- Hidden collectibles sit on expert lines, rewarding exploration with routes rather than with items behind walls.
- Blockouts are built and tested with grey boxes before any art; the movement numbers above must feel good on the blockout first.

## Modes, progression and scoring

Three modes share the same six maps; progression unlocks new ways to move, never raw stat boosts, so level design stays fair.

**Modes**

- **Campaign route** — play the maps in order with checkpoints. Clearing a map unlocks the next and its Time Trial.
- **Time Trial** — a fixed start and finish, no checkpoints, a ghost of your best run, and online leaderboards with downloadable ghosts of top runs. Medal times: Bronze (first-clear pace), Silver, Gold, and a hidden Dev time.
- **Free Roam** — open map, no timer, collectibles and "line challenges" (e.g. cross the plaza without touching the ground).

**Flow score**

A combo meter rewards chaining moves without touching the ground or stopping.

- Each distinct move in a chain (swing, wallrun, wall jump, vault, zip) adds to a multiplier; repeating the same move twice in a row adds less.
- Touching the ground at more than run speed keeps the chain for 0.5 s; standing still or a hard landing ends it.
- Flow score is shown separately from time, so a stylish run and a fast run are both worth chasing.

**Progression (unlocks)**

| Unlock | Earned by | Effect |
| --- | --- | --- |
| Zip | Clear Rooftop District | Tap fire to pull straight to the anchor |
| Long rope | Clear The Canopy | Range 40 m → 55 m |
| Fast reel | Clear Foundry 9 | Reel in 12 → 18 m/s |
| Air dash | Clear Glass Spire | One mid-air dash per airborne period, 8 m/s |
| Dual hook | Clear Skyharbor | Second hook on the other trigger; two ropes act as two constraints at once |
| Cosmetics (rope colours, suits, trails) | Medals and collectibles | Visual only |

Earlier maps are designed so that every Gold time is reachable without later unlocks; unlocks open new routes on replays.

## Feel, tech and plan

**Art and audio for feel**

- Stylised, high-contrast look (cel-shaded or flat-lit low poly) so anchors and routes read at 30 m/s. Anchors use one consistent glow colour across all maps.
- Speed lines and a faint radial blur above 20 m/s; wind audio that rises in pitch and volume with speed.
- Distinct sounds for hook fire, hook hit, rope going taut and release. The "taut" sound is the most important one: it tells the player the swing has started.
- Music layers in as the flow chain grows and drops back when it breaks.
- Animation: procedural lean into swings and wallruns on top of authored clips, so the body always matches the physics.

**Tech stack (no engine)**

Everything a game engine normally provides is written in this codebase. The only outside code is Three.js, used purely as a renderer (scene graph, WebGL, model loading); the game loop, physics and collision are ours. It is built with Vite and runs in any modern desktop browser.

| Layer | What we write | Built on |
| --- | --- | --- |
| Game loop | Fixed 120 Hz simulation; rendering at display rate, interpolated between steps | requestAnimationFrame |
| Rendering | Flat or toon shaders, speed-line effect, rope mesh, anchor glow | Three.js + GLSL |
| Collision | Capsule against level primitives (boxes, ramps, cylinders), swept in substeps; raycasts for grapple, walls and ledges; grid spatial hash for lookups | Own code |
| Physics | Movement state machine, rope constraint, moving anchors | Own code |
| Input | Gamepad and keyboard/mouse mapping, remapping, jump buffering | Gamepad API, Pointer Lock API |
| Audio | Sound triggers, wind loop pitched by speed, layered music | Web Audio API |
| Levels | Maps stored as JSON lists of primitives, anchors and checkpoints; an in-game editor to place them | Own code |
| Debug | Live tuning panel for every number in this spec, collision and rope overlays, frame stepping | Own code (HTML overlay) |
| Saves and ghosts | Best times, unlocks, recorded runs | localStorage; a small server for leaderboards later |

Building levels from primitives instead of arbitrary meshes is the key simplification. Capsule-against-box and capsule-against-cylinder tests are exact and cheap, grapple raycasts stay simple, and art meshes are decoration placed over the collision shapes.

**Fixed-step loop**

```ts
const STEP = 1 / 120;
let acc = 0, last = performance.now();

function frame(now: number) {
  acc += Math.min((now - last) / 1000, 0.1); // clamp after tab switches
  last = now;
  while (acc >= STEP) { sim.step(STEP); acc -= STEP; }
  renderer.draw(sim, acc / STEP);            // blend the last two sim states
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

A fixed step makes the physics identical on 60 Hz and 144 Hz screens. Ghosts record positions at 30 Hz and replay with interpolation, so old ghosts still play back after physics tuning changes.

**Milestones**

0. **Engine foundations** — game loop, Three.js renderer setup, input, capsule collision against boxes and ramps, debug panel. Gate: a capsule runs and jumps around a box test room at 120 Hz with no tunnelling at 35 m/s.
1. **Movement prototype** — run, jump, wallrun, vault and slide in that room. Gate: moving around an empty room feels fun for 10 minutes.
2. **Grapple prototype** — hook, swing, reel and release in the same room. Gate: swing-to-wallrun-to-swing chains work every time in playtests.
3. **Level editor and vertical slice** — in-game editor for placing primitives and anchors, then Rooftop District blocked out with camera, placeholder audio and Time Trial with a local ghost. Gate: 5 outside playtesters each want to retry for a better time.
4. **Content** — remaining five maps blocked out and tuned, then art passes in order.
5. **Systems** — progression, flow score, online leaderboards and ghost downloads.
6. **Polish and release** — 60 fps on a mid-range laptop with integrated graphics, accessibility settings, remapping, bug fixing.

**Risks**

- **Swing feel takes longer than planned.** Mitigation: milestone 2 has no content work; it doesn't end until the gate is met.
- **Writing our own collision eats the schedule.** Mitigation: primitives only in v1 (no collision against arbitrary meshes), and an automated test suite of collision cases (corners, seams between boxes, steep ramps) run on every change.
- **Fast movement breaks collision.** Mitigation: swept substeps above 20 m/s, the soft speed cap, and a bot that replays recorded runs to catch clipping.
- **Browser performance.** Mitigation: merge static level geometry into a few meshes, instance repeated props, and keep shaders simple; profile from milestone 0.
- **Tools take time too.** Without an engine editor, the level editor is real work. Mitigation: start with JSON edited by hand plus live reload, and grow the editor only as maps need it.
- **Players get lost at speed.** Mitigation: the readability rules in Level maps and playtests that track where people stall.
- **Scope.** Six maps is a lot for a small team. Fallback: ship four (Rooftop, Canopy, Foundry, Skyharbor) and add the rest as updates.

**Open questions**

- [ ] Browser (TypeScript + Three.js) or native (C++ with raylib or raw OpenGL)? This spec assumes the browser.
- [ ] Is Three.js acceptable as a renderer, or should rendering be raw WebGL too?
- [ ] Should grapple surfaces be widely available (more freedom) or limited to anchors (tighter level design)?
- [ ] Is the dual hook in scope for v1, or a post-launch update?
- [ ] Is there a story or character, or is it a pure movement game?
- [ ] Does Free Roam need a hub world connecting the maps?
