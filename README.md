# Tetherline

Third-person momentum parkour-fighting with a grappling hook and a sword. See [the design spec](Tetherline%20—%20Game%20Design%20Spec.md) for the design and [HANDOFF.md](HANDOFF.md) for what's left to build.

This is milestones 0–2 of the spec: engine foundations, the movement prototype and the grapple prototype. Sword combat and enemies are designed in the spec (milestone 3) but not built yet. The test room is dressed as a medieval castle courtyard at sunset. TypeScript in the browser; Three.js is used only to render. The game loop, collision, physics, input and audio are our own code.

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

## Acceptance criteria

"Done" means every statement below is true. When you report back, go through the list item by item: **pass**, **fail** or **not checked**, plus how you checked (test name, console snippet, or what you did in the game). The numbers come from `src/config.ts` and the spec; if a number has been retuned, check against the new value and say so.

### Prototype: milestones 0–2 (built)

**Setup**

1. `npm install` then `npm run dev` serves the game at http://localhost:5173, with no errors in the browser console.
2. `npm test` passes every test.
3. `npm run build` finishes with no type errors.
4. With the dev server running, `node tools/build-testroom.mjs` rewrites `src/levels/testroom.json`, and the open game rebuilds the map without a page reload.

**Menu, HUD and tools**

5. On load, the title scroll lists the controls. Clicking anywhere closes it, and Esc brings it back.
6. In a browser that allows mouse capture, clicking captures the mouse. Where capture is refused (such as an embedded preview), a note appears at the top and moving the mouse still turns the camera.
7. The medallion at the bottom left shows speed in whole m/s. The ribbon under it names the state: "Afoot" when standing, "Swinging" on a taut rope, "Wallrunning" on a wall.
8. The backquote key opens the tuning panel. Changing `run.speed` from 9 to 15 takes effect at once without a reload. P pauses, and the period key advances exactly one 1/120 s step while paused.

**Movement**

9. WASD moves relative to the camera. Holding W on flat ground reaches 9 m/s (±0.1) within 0.5 s, and holding Shift as well raises it to 12 m/s.
10. Holding Space jumps 1.6 m (±0.1). A tap jumps between 0.7 and 0.9 m.
11. Pressing Space up to 0.12 s after running off a ledge still jumps. Pressing it up to 0.12 s before landing jumps on touchdown.
12. Running into a 1.0 m obstacle vaults it, keeping at least 98% of horizontal speed.
13. Obstacles up to 0.45 m tall are stepped onto without jumping.
14. Jumping into a wall at under 50° from its surface, while moving faster than 6 m/s, starts a wallrun that lasts at most 1.6 s, with the camera tilted 8° away from the wall. Space during the wallrun launches at least 6 m/s away from the wall and at least 4 m/s upward.
15. Jumping head-on into the 5 m ruined-wall block (x = −46, z = 32, west of the market) climbs it and grabs the ledge ("Hanging"). Space then mantles onto the top. S or C drops instead. The 3.5 m and 6 m blocks work the same way.
16. Pressing C while running at 5 m/s or more starts a slide that adds 2 m/s on entry and loses 3 m/s per second on flat ground.
17. Landing from a fall of more than 8 m without crouching causes a stumble: speed is cut to 9 m/s and there is no control for 0.35 s. Holding C on landing rolls instead and keeps speed.
18. The player never passes through a 0.1 m thick wall at 35 m/s or 60 m/s (covered by `tests/collision.test.ts`).

**Grapple**

19. An anchor within 40 m of the player and 25° of screen centre, with clear line of sight, shows the rotating rune reticle. Anchors outside those limits show no reticle.
20. Holding left mouse with the reticle showing attaches the rope. The rope never gets longer than it was at attach unless Q reels it out.
21. Releasing left mouse keeps the player's velocity (within 0.2 m/s; the release boost and lift may add speed on purpose).
22. Releasing and clicking again within 0.2 s zips the player to the anchor at 25 m/s and pops them up over it.
23. E reels in at 12 m/s down to 3 m. Q reels out at 8 m/s up to 40 m.
24. Swinging from a horizontal 15 m rope reaches 17.15 m/s (±2%) at the bottom, and the swing never rises above its starting height (covered by `tests/swing.test.ts`).
25. With no anchor inside the 25° cone, firing at the chapel's stained-glass window whiffs instead of attaching, and aiming at the underside of a grappleable beam (such as the aqueduct deck) shows gold corner brackets and attaches there.
26. When level geometry blocks the rope for more than 0.2 s, the rope cuts.
27. The crane trolley, swinging bell, windmill sails and circling lantern each carry an attached player along with their motion.

**Test room**

28. The test room has at least 40 anchors.
29. Touching the waystone north of the aqueduct shows "Waystone Attuned". R then respawns the player there instantly, and so does falling below y = −30.
30. The sky shows a low sunset sun (azimuth 318°, elevation 11°). The tuning panel's graphics group switches shadows, bloom and torch lights on and off.
31. With shadows and bloom on, the stats overlay reads at least 60 fps on an Apple-silicon Mac.

### Combat prototype: milestone 3 (next)

Not built yet. These define "done" for it, using the spec's Combat section.

32. Right mouse (X on a gamepad) on the ground slashes. A training dummy within 2.2 m, inside a 100° arc in front of the player, shows a floating damage number. A standing slash shows 10.
33. The same slash at 24 m/s shows 30 (damage = base × (1 + speed ÷ 12)).
34. No attack except the heavy strike (hold attack on the ground) lowers horizontal speed. Check speed just before and just after each attack.
35. An aerial slash that hits adds 3 m/s of upward speed.
36. A plunge (C + attack in the air) from 10 m onto a dummy shows 50 damage, and the landing is not a hard landing.
37. Attacking within 0.15 s of the bottom of a swing multiplies damage by 1.5.
38. Parry (F, or Y on a gamepad) within 0.15 s of an arrow arriving deflects it with no damage. A missed parry leaves the player unable to parry for 0.6 s.
39. The player dies on the third hit and respawns at the last waystone in under 1 second.
40. An archer on a wall shoots at the player whenever it has line of sight. A spearman takes no damage from attacks on foot from the front, but does take damage from aerial slashes and plunges.
41. Hooking an archer pulls it toward the player at 20 m/s.
42. Hits freeze the simulation for 40 ms. Heavy hits and kills freeze it for 70 ms.
43. Replaying the same inputs twice gives identical enemy positions and health at every step (automated test).
44. An encounter with one archer and one spearman in the test room can be cleared without the player's horizontal speed dropping below 6 m/s.
45. All existing tests still pass. New headless tests cover the damage formula, plunge damage, the parry window, and determinism.

## Where it's headed

Next comes combat built on the movement rather than beside it:
- Hits scale with speed, and every movement state has an attack form: aerial slashes that hop you to the next enemy, a plunge that turns fall height into damage, and a strike at the bottom of a swing.
- The hook pulls light enemies, pulls you to heavy ones, and rips shields away.
- Enemies (archers, spearmen, shield-bearers, hounds, knights, ballista crews and a boss) sit along routes instead of in closed arenas.

The spec's Combat section has the numbers. HANDOFF.md section 5 has the implementation plan and the open questions.

## Not built yet

Sword combat and enemies, ledge-grab and wall-climb animations, flow score, ghosts and time trial, the level editor, rope wrapping, air dash and dual hook (later unlocks), and real character art and audio.
