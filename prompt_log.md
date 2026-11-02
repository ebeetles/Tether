# Prompt log

The prompts given to Claude Code while building Tetherline, verbatim and in order, typos included. Each has a one-line note on what came of it and the commit it landed in.

## 1

```text
commit and push to this repo https://github.com/ebeetles/Tether.git
```

Result: initialised git and pushed the design spec (`e2ce08b`).

## 2

```text
Read the spec doc carefully, then begin implementing the core mechanics of the game
```

Result: the movement and grapple prototype (spec milestones 0–2) with a test room and 32 headless tests (`e1d5c1f`, together with prompts 3 and 4).

## 3

```text
I cant close the instructions
```

Result: the instructions overlay closes on click even where the browser refuses mouse capture, with plain mouse aiming as a fallback.

## 4

```text
Commit and push
```

Result: `e1d5c1f`.

## 5

```text
Lets really try to improve the UI now. I want it to have a medieval feel. Make the test room map look polished, make the sky beautiful, maybe mid sunset. Add lots of structures where you can grapple onto.
```

Result: a sunset sky, procedural medieval textures, the test room rebuilt as a castle courtyard with 45 anchors, and a parchment-and-bronze UI (`428c6a9`).

## 6

```text
Commit and push
```

Result: `428c6a9`.

## 7

```text
can you write a handoff doc to what needs to be done? Including core mechanics, how to polish, etc. Then commit and push the doc
```

Result: `HANDOFF.md` (`e7cc6b6`).

## 8

```text
I think it would be cool if the game turned into like a fighting/parkour game with sword and enemy mechanics, that would be a cool thing to add. Please add something like this to the doc as well
```

Result: a sword combat and enemies section in `HANDOFF.md`.

## 9

```text
also update the README and the spec along those lines
```

Result: combat added to the design spec (new section, controls, maps, modes, milestones, risks, open questions) and to the README.

## 10

```text
Commit and push
```

Result: `218423d`.

## 11

```text
can we add this if it isnt already in the README

* Acceptance criteria. A numbered list of specific, checkable statements that define "done", like "the player moves with the arrow keys and jumps with the space bar." Your partner reports back against this list item by item, so write criteria someone can verify.
```

Result: 45 numbered acceptance criteria in the README, 31 for the built prototype and 14 for the combat milestone.

## 12

```text
Commit and push
```

Result: `001b643`.

## 13

```text
can you also create a prompt_log.md with verbatim prompts and then commit/push
```

Result: this file.
