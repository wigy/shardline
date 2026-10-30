# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Intent

**Shardline**, a browser game in the paddle-and-ball brick-breaker genre. It is an original game in that genre, not a recreation of any specific existing title: level layouts, power-ups, names, and art must stay original.

## Running

No build step, dependencies, or tests. Open `index.html` directly in a browser (or serve the directory with any static server, e.g. `python3 -m http.server`). `node --check game.js` is a quick syntax check.

## Architecture

All game logic lives in `game.js` (plain script, no modules); `index.html` and `style.css` only host and scale the canvas.

- **Fixed logical resolution** 480×640 (`W`, `H`). The canvas backing store is scaled by `devicePixelRatio`; CSS scales it to the viewport. Pointer input is mapped back to game coordinates via `pointerToGameX`.
- **Single mutable `game` object** holds everything: `state` (`title | play | paused | between | over`), bricks, balls, powerups, particles, and `effects` (seconds remaining per timed power-up). `paddle` and `input` are separate globals.
- **Loop**: `requestAnimationFrame` → `update(dt)` (dt capped at 33 ms) → `render()`. Rendering is stateless redraw from `game`.
- **Levels** are ASCII grids in `LEVELS` (12 columns): `.` empty, `1`–`3` hit points, `#` steel (unbreakable, ignored for level-clear), `x` charge brick that recursively destroys adjacent bricks. After the last level the game loops with `game.loop` incremented, which raises ball speed and score multiplier.
- **Ball physics** (`stepBall`): movement is split into ≤3 px sub-steps to prevent tunneling; each sub-step resolves walls, paddle, then at most one brick (circle-vs-AABB, reflect on the axis of larger penetration). Ball speed is stored as a scalar `b.speed`; velocity is renormalized every step so the slow effect is just a multiplier in `ballSpeed`. `enforceMinVertical` stops near-horizontal loops. Paddle bounce angle depends only on hit offset from paddle center.
- **Stuck balls**: a ball with `stuck: true` rides the paddle at `offset`. `serve` balls wait for player input; glue-caught balls auto-launch after 2.5 s.
- **Power-ups** are defined in `POWERUPS` (label, color, optional `duration`) with drop odds in `POWERUP_WEIGHTS`; timed ones just set `game.effects[type]`, and their behavior is checked where relevant (paddle width, `ballSpeed`, glue in paddle collision, pierce in brick collision). All effects reset on life loss and level load.
- **Audio** is synthesized on the fly with WebAudio in `sfx` (no asset files); the `AudioContext` is created lazily on first sound.
- High score persists in `localStorage` under `shardline.hi`.
