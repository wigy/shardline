# Shardline

A neon brick-breaker for the browser, built with plain HTML5 Canvas and JavaScript. No build step, no dependencies, and no image assets: everything is drawn in code.

**Play it here:** https://wigy.github.io/shardline/

<p align="center">
  <img src="docs/screenshot.jpg" alt="Shardline stage 1" width="400">
  <img src="docs/action.jpg" alt="Charge brick explosion with multiball and power-ups" width="400">
</p>

## Controls

| Action | Keys |
| --- | --- |
| Move paddle | Mouse, touch, ← → or A / D |
| Launch ball / start | Click, tap, Space or Enter |
| Pause | P or Esc |
| Mute | M |

## Features

- Six handcrafted stages. After the last one the game loops faster, with a higher score multiplier.
- Bricks that take 1–3 hits, unbreakable steel, and purple charge bricks that blow up their neighbours (chain reactions included).
- Power-ups: **W**ide paddle, **M**ultiball, **S**low ball, **G**lue paddle, **P**ierce, and **+** extra life.
- Particle effects, screen shake, synthesized sound effects, and a high score saved in the browser.

## Running locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server
```
