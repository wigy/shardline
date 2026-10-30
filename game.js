'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const W = 480;
const H = 640;
const TOP = 48;               // playfield top (HUD band above)
const COLS = 12;
const BW = 36, BH = 16, GAP = 2;
const OX = (W - (COLS * (BW + GAP) - GAP)) / 2;
const OY = TOP + 40;

const PADDLE_Y = H - 48;
const PADDLE_H = 14;
const PADDLE_W = 84;
const PADDLE_W_WIDE = 132;
const PADDLE_KEY_SPEED = 560;

const BALL_R = 6;
const BALL_SPEED = 340;
const BALL_SPEED_MAX = 620;
const MAX_BOUNCE_ANGLE = 1.05;   // ~60 degrees from vertical

const DROP_CHANCE = 0.16;
const START_LIVES = 3;

const FONT = '"Orbitron", ui-monospace, monospace';

// Breakable bricks are colored by row; hit points are shown as armor plating.
const ROW_COLORS = ['#ff3d6e', '#ff8c2a', '#ffd43b', '#3ee07f', '#22d3ee', '#4f7cff', '#a35bff', '#ff4fd8'];
const STEEL_COLOR = '#9aa6bf';
const BOMB_COLOR = '#c050ff';
const BALL_COLOR = '#7dd3fc';
const PIERCE_COLOR = '#ff6b3d';

// Power-ups: letter, display name, color, duration (s) for timed effects.
const POWERUPS = {
  wide:   { label: 'W', name: 'WIDE',       color: '#38bdf8', duration: 15 },
  multi:  { label: 'M', name: 'MULTIBALL',  color: '#facc15' },
  slow:   { label: 'S', name: 'SLOW',       color: '#4ade80', duration: 10 },
  glue:   { label: 'G', name: 'GLUE',       color: '#f472b6', duration: 15 },
  pierce: { label: 'P', name: 'PIERCE',     color: PIERCE_COLOR, duration: 7 },
  life:   { label: '+', name: 'EXTRA LIFE', color: '#e2e8f0' },
};
const POWERUP_WEIGHTS = [
  ['wide', 5], ['multi', 4], ['slow', 4], ['glue', 3], ['pierce', 2], ['life', 1],
];

// Level legend: '.' empty, '1'-'3' hit points, '#' steel (unbreakable),
// 'x' charge brick (destroys its neighbours when broken).
const LEVELS = [
  { name: 'First Light', rows: [
    '............',
    '111111111111',
    '222222222222',
    '111111111111',
    '333333333333',
    '111111111111',
  ]},
  { name: 'Lantern', rows: [
    '.....22.....',
    '....2112....',
    '...211112...',
    '..21133112..',
    '...211112...',
    '....2112....',
    '.....22.....',
  ]},
  { name: 'Colonnade', rows: [
    '3.3.3..3.3.3',
    '2#2#2..2#2#2',
    '1.1.1..1.1.1',
    '2.2.2..2.2.2',
    '1x1x1xx1x1x1',
  ]},
  { name: 'Undertow', rows: [
    '1..........1',
    '21........12',
    '321......123',
    '.321....123.',
    '..32x..x23..',
    '...321123...',
    '....#..#....',
  ]},
  { name: 'Keep', rows: [
    '##..####..##',
    '#3333333333#',
    '#2x222222x2#',
    '#1111111111#',
    '#....##....#',
    '............',
    '333......333',
  ]},
  { name: 'Static', rows: [
    'x1x1x1x1x1x1',
    '1x1x1x1x1x1x',
    '............',
    '323232323232',
    '232323232323',
    '............',
    '##.######.##',
  ]},
];

// ---------------------------------------------------------------------------
// Canvas setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const spriteCache = new Map();

function dpr() {
  return Math.min(window.devicePixelRatio || 1, 3);
}

function setupCanvas() {
  canvas.width = W * dpr();
  canvas.height = H * dpr();
  spriteCache.clear();
}
setupCanvas();
window.addEventListener('resize', setupCanvas);

// ---------------------------------------------------------------------------
// Audio (tiny synthesized blips)
// ---------------------------------------------------------------------------
let audio = null;
let muted = false;

function beep(freq, dur = 0.06, type = 'square', vol = 0.06) {
  if (muted) return;
  if (!audio) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  }
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur);
}

const sfx = {
  paddle: () => beep(220, 0.07),
  wall:   () => beep(330, 0.03, 'square', 0.03),
  brick:  () => beep(520 + Math.random() * 120, 0.05),
  steel:  () => beep(900, 0.04, 'triangle'),
  boom:   () => beep(90, 0.25, 'sawtooth', 0.08),
  power:  () => { beep(660, 0.08, 'triangle'); setTimeout(() => beep(990, 0.1, 'triangle'), 70); },
  lose:   () => { beep(200, 0.2, 'sawtooth'); setTimeout(() => beep(120, 0.3, 'sawtooth'), 150); },
  clear:  () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.12, 'triangle'), i * 90)),
};

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const game = {
  state: 'title',      // title | play | paused | between | over
  score: 0,
  hiScore: Number(localStorage.getItem('shardline.hi')) || 0,
  lives: START_LIVES,
  levelIndex: 0,
  loop: 0,             // increments each time all levels are cleared
  bricks: [],
  balls: [],
  powerups: [],
  particles: [],
  effects: { wide: 0, slow: 0, glue: 0, pierce: 0 },
  betweenTimer: 0,
  time: 0,             // total elapsed time, drives ambient animation
  levelTime: 0,        // time since level load, drives brick intro
  shake: 0,
};

const paddle = { x: W / 2, w: PADDLE_W, targetX: W / 2, flash: 0 };

const input = { left: false, right: false, mouseActive: false };

const stars = Array.from({ length: 140 }, () => ({
  x: Math.random() * W,
  y: Math.random() * H,
  z: 0.2 + Math.random() * 0.8,
  phase: Math.random() * Math.PI * 2,
  hue: Math.random() < 0.2 ? 300 : Math.random() < 0.5 ? 190 : 220,
}));

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------
function loadLevel(index) {
  const level = LEVELS[index];
  game.bricks = [];
  level.rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      const brick = {
        x: OX + c * (BW + GAP),
        y: OY + r * (BH + GAP),
        w: BW, h: BH,
        type: 'normal', hp: 1, maxHp: 1,
        color: ROW_COLORS[r % ROW_COLORS.length],
        delay: r * 0.07 + Math.abs(c - (COLS - 1) / 2) * 0.03,
        flash: 0, dead: false,
      };
      if (ch === '#') { brick.type = 'steel'; brick.color = STEEL_COLOR; }
      else if (ch === 'x') { brick.type = 'bomb'; brick.color = BOMB_COLOR; }
      else brick.hp = brick.maxHp = Number(ch);
      game.bricks.push(brick);
    });
  });
  game.levelTime = 0;
  game.powerups = [];
  resetEffects();
  game.balls = [newServeBall()];
}

function newServeBall() {
  return {
    x: paddle.x, y: PADDLE_Y - BALL_R,
    vx: 0, vy: -1,
    speed: BALL_SPEED + game.loop * 40,
    stuck: true, offset: 0, stuckTime: 0, serve: true,
    dead: false, trail: [],
  };
}

function resetEffects() {
  for (const k in game.effects) game.effects[k] = 0;
}

function newGame() {
  game.score = 0;
  game.lives = START_LIVES;
  game.levelIndex = 0;
  game.loop = 0;
  game.particles = [];
  paddle.x = paddle.targetX = W / 2;
  paddle.w = PADDLE_W;
  loadLevel(0);
  game.state = 'play';
}

function addScore(n) {
  const gained = n * (1 + game.loop);
  game.score += gained;
  if (game.score > game.hiScore) {
    game.hiScore = game.score;
    localStorage.setItem('shardline.hi', String(game.hiScore));
  }
  return gained;
}

// ---------------------------------------------------------------------------
// Visual effects (particles live in game.particles, keyed by `kind`)
// ---------------------------------------------------------------------------
function addParticle(p) {
  if (game.particles.length < 700) game.particles.push(p);
}

function shards(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 80 + Math.random() * 220;
    const life = 0.5 + Math.random() * 0.5;
    addParticle({
      kind: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60,
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20,
      size: 2 + Math.random() * 4, color, life, max: life,
    });
  }
}

function sparks(x, y, color, count = 6, speed = 260) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.6);
    const life = 0.2 + Math.random() * 0.3;
    addParticle({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life, max: life });
  }
}

function ring(x, y, color, maxR = 60, life = 0.5) {
  addParticle({ kind: 'ring', x, y, maxR, color, life, max: life });
}

function flare(x, y, color, maxR = 50, life = 0.35) {
  addParticle({ kind: 'flare', x, y, maxR, color, life, max: life });
}

function popup(x, y, text, color, size = 12) {
  addParticle({ kind: 'popup', x, y, vy: -50, text, color, size, life: 0.9, max: 0.9 });
}

function shake(amount) {
  game.shake = Math.max(game.shake, amount);
}

// ---------------------------------------------------------------------------
// Bricks, power-ups
// ---------------------------------------------------------------------------
function destroyBrick(b) {
  if (b.dead || b.type === 'steel') return;
  b.dead = true;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const gained = addScore(b.type === 'bomb' ? 120 : 50 * b.maxHp);
  shards(cx, cy, b.color);
  flare(cx, cy, b.color, 34, 0.25);
  popup(cx, cy, `+${gained}`, b.color);

  if (b.type === 'bomb') {
    sfx.boom();
    shake(9);
    ring(cx, cy, BOMB_COLOR, 90, 0.55);
    ring(cx, cy, '#ffffff', 55, 0.35);
    flare(cx, cy, '#ff9cf5', 110, 0.5);
    sparks(cx, cy, '#ffd6ff', 24, 420);
    for (const o of game.bricks) {
      if (o.dead) continue;
      const near = Math.abs(o.x - b.x) <= BW + GAP + 1 && Math.abs(o.y - b.y) <= BH + GAP + 1;
      if (near) destroyBrick(o);
    }
  } else {
    sfx.brick();
  }

  if (Math.random() < DROP_CHANCE) spawnPowerup(cx, cy);
}

function hitBrick(b, bx, by) {
  if (b.type === 'steel') {
    b.flash = 0.15;
    sparks(bx, by, '#e2e8f0', 6);
    sfx.steel();
    return;
  }
  if (game.effects.pierce > 0) { destroyBrick(b); return; }
  b.hp--;
  b.flash = 0.12;
  if (b.hp <= 0) destroyBrick(b);
  else {
    addScore(10);
    sparks(bx, by, '#ffffff', 8);
    shards(bx, by, '#cbd5e1', 4);
    sfx.steel();
  }
}

function spawnPowerup(x, y) {
  const total = POWERUP_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  let type = POWERUP_WEIGHTS[0][0];
  for (const [t, w] of POWERUP_WEIGHTS) {
    if ((r -= w) < 0) { type = t; break; }
  }
  game.powerups.push({ x, y, type, vy: 140, age: 0 });
}

function applyPowerup(type) {
  sfx.power();
  addScore(100);
  const def = POWERUPS[type];
  if (def.duration) game.effects[type] = def.duration;
  ring(paddle.x, PADDLE_Y + PADDLE_H / 2, def.color, 80, 0.5);
  sparks(paddle.x, PADDLE_Y, def.color, 16, 300);
  popup(paddle.x, PADDLE_Y - 18, def.name, def.color, 14);

  if (type === 'multi') {
    const extra = [];
    for (const b of game.balls) {
      if (b.dead) continue;
      for (const da of [-0.45, 0.45]) {
        const ang = Math.atan2(b.vx, -b.vy) + da;
        extra.push({
          ...b, trail: [], stuck: false, serve: false,
          vx: Math.sin(ang), vy: -Math.abs(Math.cos(ang)),
        });
        if (b.stuck) extra[extra.length - 1].y = PADDLE_Y - BALL_R - 1;
      }
    }
    game.balls.push(...extra.slice(0, Math.max(0, 9 - game.balls.length)));
  } else if (type === 'life') {
    game.lives = Math.min(game.lives + 1, 9);
  }
}

// ---------------------------------------------------------------------------
// Ball physics
// ---------------------------------------------------------------------------
function ballSpeed(b) {
  return b.speed * (game.effects.slow > 0 ? 0.62 : 1);
}

function normalizeVelocity(b) {
  const s = ballSpeed(b);
  const m = Math.hypot(b.vx, b.vy) || 1;
  b.vx = (b.vx / m) * s;
  b.vy = (b.vy / m) * s;
}

// Keep the ball from travelling almost horizontally forever.
function enforceMinVertical(b) {
  const m = Math.hypot(b.vx, b.vy);
  const minVy = m * 0.28;
  if (Math.abs(b.vy) < minVy) {
    b.vy = (b.vy >= 0 ? 1 : -1) * minVy;
    b.vx = (b.vx >= 0 ? 1 : -1) * Math.sqrt(m * m - minVy * minVy);
  }
}

function launchBall(b) {
  const rel = b.serve ? (Math.random() - 0.5) * 0.5 : b.offset / (paddle.w / 2);
  const ang = Math.max(-1, Math.min(1, rel)) * MAX_BOUNCE_ANGLE;
  b.vx = Math.sin(ang);
  b.vy = -Math.cos(ang);
  b.stuck = false;
  b.serve = false;
  normalizeVelocity(b);
}

function circleRect(b, r) {
  const cx = Math.max(r.x, Math.min(b.x, r.x + r.w));
  const cy = Math.max(r.y, Math.min(b.y, r.y + r.h));
  const dx = b.x - cx, dy = b.y - cy;
  return { hit: dx * dx + dy * dy < BALL_R * BALL_R, dx, dy, cx, cy };
}

function wallHit(x, y) {
  sfx.wall();
  sparks(x, y, BALL_COLOR, 4, 160);
}

function stepBall(b, dt) {
  normalizeVelocity(b);
  const dist = Math.hypot(b.vx, b.vy) * dt;
  const steps = Math.max(1, Math.ceil(dist / 3));
  const sdt = dt / steps;

  for (let i = 0; i < steps; i++) {
    b.x += b.vx * sdt;
    b.y += b.vy * sdt;

    // Walls
    if (b.x - BALL_R < 0) { b.x = BALL_R; b.vx = Math.abs(b.vx); wallHit(0, b.y); }
    if (b.x + BALL_R > W) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); wallHit(W, b.y); }
    if (b.y - BALL_R < TOP) { b.y = TOP + BALL_R; b.vy = Math.abs(b.vy); wallHit(b.x, TOP); }

    // Paddle
    const pr = { x: paddle.x - paddle.w / 2, y: PADDLE_Y, w: paddle.w, h: PADDLE_H };
    if (b.vy > 0 && b.y < PADDLE_Y + PADDLE_H / 2 && circleRect(b, pr).hit) {
      const rel = Math.max(-1, Math.min(1, (b.x - paddle.x) / (paddle.w / 2)));
      const ang = rel * MAX_BOUNCE_ANGLE;
      b.speed = Math.min(BALL_SPEED_MAX + game.loop * 40, b.speed * 1.012);
      b.vx = Math.sin(ang);
      b.vy = -Math.cos(ang);
      b.y = PADDLE_Y - BALL_R;
      normalizeVelocity(b);
      paddle.flash = 0.18;
      sparks(b.x, PADDLE_Y, game.effects.glue > 0 ? POWERUPS.glue.color : '#67e8f9', 8, 220);
      sfx.paddle();
      if (game.effects.glue > 0) {
        b.stuck = true;
        b.offset = b.x - paddle.x;
        b.stuckTime = 0;
        return;
      }
    }

    // Bricks: resolve at most one per sub-step
    for (const br of game.bricks) {
      if (br.dead) continue;
      const c = circleRect(b, br);
      if (!c.hit) continue;
      const passThrough = game.effects.pierce > 0 && br.type !== 'steel';
      if (!passThrough) {
        if (c.dx === 0 && c.dy === 0) {
          b.vy = -b.vy;
        } else if (Math.abs(c.dx) > Math.abs(c.dy)) {
          b.vx = Math.sign(c.dx) * Math.abs(b.vx);
          b.x += c.dx > 0 ? 1 : -1;
        } else {
          b.vy = Math.sign(c.dy) * Math.abs(b.vy);
          b.y += c.dy > 0 ? 1 : -1;
        }
        enforceMinVertical(b);
      }
      hitBrick(br, c.cx, c.cy);
      break;
    }

    if (b.y - BALL_R > H) { b.dead = true; return; }
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function updatePaddle(dt) {
  const targetW = game.effects.wide > 0 ? PADDLE_W_WIDE : PADDLE_W;
  paddle.w += (targetW - paddle.w) * Math.min(1, dt * 10);
  paddle.flash = Math.max(0, paddle.flash - dt);

  if (input.left || input.right) {
    input.mouseActive = false;
    paddle.x += (input.right - input.left) * PADDLE_KEY_SPEED * dt;
  } else if (input.mouseActive) {
    paddle.x += (paddle.targetX - paddle.x) * Math.min(1, dt * 25);
  }
  paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, paddle.x));
}

function updateAmbient(dt) {
  game.time += dt;
  game.levelTime += dt;
  game.shake = Math.max(0, game.shake - dt * 30);

  for (const s of stars) {
    s.y += s.z * 14 * dt;
    if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
  }

  for (const p of game.particles) {
    p.life -= dt;
    if (p.kind === 'shard') {
      p.vy += 520 * dt;
      p.rot += p.vr * dt;
    } else if (p.kind === 'spark') {
      p.vx *= 1 - 3 * dt;
      p.vy = p.vy * (1 - 3 * dt) + 200 * dt;
    }
    if (p.vx !== undefined) p.x += p.vx * dt;
    if (p.vy !== undefined) p.y += p.vy * dt;
  }
  game.particles = game.particles.filter(p => p.life > 0);
}

function update(dt) {
  updateAmbient(dt);

  if (game.state === 'between') {
    game.betweenTimer -= dt;
    if (game.betweenTimer <= 0) {
      game.levelIndex++;
      if (game.levelIndex >= LEVELS.length) { game.levelIndex = 0; game.loop++; }
      loadLevel(game.levelIndex);
      game.state = 'play';
    }
    return;
  }
  if (game.state !== 'play') return;

  for (const k in game.effects) game.effects[k] = Math.max(0, game.effects[k] - dt);
  updatePaddle(dt);

  // Balls
  for (const b of game.balls) {
    if (b.stuck) {
      b.offset = Math.max(-paddle.w / 2, Math.min(paddle.w / 2, b.offset));
      b.x = paddle.x + b.offset;
      b.y = PADDLE_Y - BALL_R;
      b.stuckTime += dt;
      if (!b.serve && b.stuckTime > 2.5) launchBall(b);
    } else {
      stepBall(b, dt);
    }
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 12) b.trail.shift();
  }
  game.balls = game.balls.filter(b => !b.dead);

  // Bricks
  for (const br of game.bricks) br.flash = Math.max(0, br.flash - dt);
  game.bricks = game.bricks.filter(br => !br.dead);

  // Power-ups
  for (const p of game.powerups) {
    p.y += p.vy * dt;
    p.age += dt;
    const caught = p.y + 7 > PADDLE_Y && p.y - 7 < PADDLE_Y + PADDLE_H &&
      Math.abs(p.x - paddle.x) < paddle.w / 2 + 15;
    if (caught) { p.dead = true; applyPowerup(p.type); }
    if (p.y > H + 20) p.dead = true;
  }
  game.powerups = game.powerups.filter(p => !p.dead);

  // Lost all balls
  if (game.balls.length === 0) {
    game.lives--;
    sfx.lose();
    shake(12);
    flare(paddle.x, H, '#ff3d6e', 160, 0.6);
    sparks(paddle.x, H - 10, '#ff3d6e', 30, 500);
    if (game.lives <= 0) {
      game.state = 'over';
      return;
    }
    game.powerups = [];
    resetEffects();
    game.balls = [newServeBall()];
  }

  // Level cleared
  if (!game.bricks.some(b => b.type !== 'steel')) {
    sfx.clear();
    addScore(1000);
    game.state = 'between';
    game.betweenTimer = 2.4;
    game.powerups = [];
    for (let i = 0; i < 6; i++) {
      const color = ROW_COLORS[i % ROW_COLORS.length];
      ring(W / 2, H / 2, color, 120 + i * 50, 0.6 + i * 0.12);
    }
  }
}

// ---------------------------------------------------------------------------
// Color & sprite helpers
// ---------------------------------------------------------------------------
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function shade(hex, t) {       // t > 0 lightens toward white, t < 0 darkens toward black
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const [r, g, b] = hexToRgb(hex).map(v => Math.round(v + (target - v) * k));
  return `rgb(${r},${g},${b})`;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

// Pre-rendered offscreen canvases, drawn with a transparent padding for glow.
function sprite(key, w, h, pad, draw) {
  let s = spriteCache.get(key);
  if (!s) {
    const d = dpr();
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + pad * 2) * d);
    c.height = Math.ceil((h + pad * 2) * d);
    const g = c.getContext('2d');
    g.scale(d, d);
    g.translate(pad, pad);
    draw(g);
    s = { c, w, h, pad };
    spriteCache.set(key, s);
  }
  return s;
}

function drawSprite(s, x, y, scale = 1) {
  const pw = (s.w + s.pad * 2) * scale, ph = (s.h + s.pad * 2) * scale;
  ctx.drawImage(s.c, x - s.pad * scale, y - s.pad * scale, pw, ph);
}

function easeOutBack(t) {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------
function brickSprite(b) {
  return sprite(`brick:${b.type}:${b.color}:${b.hp}:${b.maxHp}`, BW, BH, 10, g => {
    if (b.type === 'steel') return paintSteel(g);
    if (b.type === 'bomb') return paintBomb(g);
    paintGem(g, b.color);

    // Armor plating for extra hit points
    if (b.hp >= 2) {
      g.strokeStyle = 'rgba(15,23,42,0.45)';
      g.lineWidth = 2.5;
      rr(g, 3.5, 3.5, BW - 7, BH - 7, 2);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 1.2;
      rr(g, 3.5, 3.5, BW - 7, BH - 7, 2);
      g.stroke();
    }
    if (b.hp >= 3) {
      for (const [x, y] of [[7, BH / 2], [BW - 7, BH / 2], [BW / 2, BH / 2]]) {
        const rg = g.createRadialGradient(x - 0.6, y - 0.6, 0, x, y, 2.2);
        rg.addColorStop(0, '#ffffff');
        rg.addColorStop(1, '#94a3b8');
        g.fillStyle = rg;
        g.beginPath();
        g.arc(x, y, 2, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Cracks once damaged
    if (b.hp < b.maxHp) {
      const crack = (pts) => {
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      };
      const paths = [
        [[BW * 0.28, 0], [BW * 0.38, BH * 0.45], [BW * 0.32, BH * 0.7], [BW * 0.44, BH]],
        [[BW * 0.38, BH * 0.45], [BW * 0.6, BH * 0.5], [BW * 0.72, BH * 0.2]],
        [[BW * 0.6, BH * 0.5], [BW * 0.68, BH]],
      ].slice(0, (b.maxHp - b.hp) + 1);
      g.lineWidth = 1.4;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      paths.forEach(crack);
      g.translate(0.7, 0.7);
      g.lineWidth = 0.7;
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      paths.forEach(crack);
    }
  });
}

function paintGem(g, color) {
  g.shadowColor = color;
  g.shadowBlur = 12;
  g.fillStyle = color;
  rr(g, 0, 0, BW, BH, 4);
  g.fill();
  g.shadowBlur = 0;

  const body = g.createLinearGradient(0, 0, 0, BH);
  body.addColorStop(0, shade(color, 0.45));
  body.addColorStop(0.5, color);
  body.addColorStop(1, shade(color, -0.4));
  g.fillStyle = body;
  rr(g, 0, 0, BW, BH, 4);
  g.fill();

  const gloss = g.createLinearGradient(0, 0, 0, BH * 0.55);
  gloss.addColorStop(0, 'rgba(255,255,255,0.7)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gloss;
  rr(g, 2, 1.2, BW - 4, BH * 0.5, 3);
  g.fill();

  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 1;
  rr(g, 0.5, 0.5, BW - 1, BH - 1, 4);
  g.stroke();
}

function paintSteel(g) {
  g.shadowColor = 'rgba(148,163,184,0.7)';
  g.shadowBlur = 8;
  const body = g.createLinearGradient(0, 0, 0, BH);
  body.addColorStop(0, '#f1f5ff');
  body.addColorStop(0.45, '#aab4c8');
  body.addColorStop(0.55, '#6b7690');
  body.addColorStop(1, '#3a4256');
  g.fillStyle = body;
  rr(g, 0, 0, BW, BH, 3);
  g.fill();
  g.shadowBlur = 0;

  g.save();
  rr(g, 0, 0, BW, BH, 3);
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.28)';
  for (const sx of [6, 16]) {
    g.beginPath();
    g.moveTo(sx, BH); g.lineTo(sx + 8, 0); g.lineTo(sx + 12, 0); g.lineTo(sx + 4, BH);
    g.fill();
  }
  g.restore();

  for (const [x, y] of [[4, 4], [BW - 4, 4], [4, BH - 4], [BW - 4, BH - 4]]) {
    const rg = g.createRadialGradient(x - 0.5, y - 0.5, 0, x, y, 2);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(1, '#475569');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, 1.6, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  rr(g, 0.5, 0.5, BW - 1, BH - 1, 3);
  g.stroke();
}

function paintBomb(g) {
  g.shadowColor = BOMB_COLOR;
  g.shadowBlur = 14;
  const body = g.createLinearGradient(0, 0, 0, BH);
  body.addColorStop(0, '#7e2fc0');
  body.addColorStop(1, '#2a0a45');
  g.fillStyle = body;
  rr(g, 0, 0, BW, BH, 4);
  g.fill();
  g.shadowBlur = 0;

  // hazard chevrons on both sides
  g.save();
  rr(g, 0, 0, BW, BH, 4);
  g.clip();
  g.fillStyle = 'rgba(255,214,255,0.25)';
  for (const sx of [-2, 4, BW - 10, BW - 4]) {
    g.beginPath();
    g.moveTo(sx, BH); g.lineTo(sx + 6, 0); g.lineTo(sx + 9, 0); g.lineTo(sx + 3, BH);
    g.fill();
  }
  g.restore();

  g.strokeStyle = 'rgba(255,190,255,0.7)';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(BW / 2, BH / 2, 5.5, 0, Math.PI * 2);
  g.stroke();
  rr(g, 0.5, 0.5, BW - 1, BH - 1, 4);
  g.stroke();
}

function ballSprite(color) {
  const R = BALL_R;
  return sprite(`ball:${color}`, R * 2, R * 2, 16, g => {
    const glow = g.createRadialGradient(R, R, R * 0.5, R, R, R + 16);
    glow.addColorStop(0, rgba(color, 0.8));
    glow.addColorStop(0.4, rgba(color, 0.25));
    glow.addColorStop(1, rgba(color, 0));
    g.fillStyle = glow;
    g.fillRect(-16, -16, R * 2 + 32, R * 2 + 32);

    const core = g.createRadialGradient(R - 2, R - 2, 0, R, R, R);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.55, shade(color, 0.6));
    core.addColorStop(1, color);
    g.fillStyle = core;
    g.beginPath();
    g.arc(R, R, R, 0, Math.PI * 2);
    g.fill();
  });
}

function powerupSprite(type) {
  const def = POWERUPS[type];
  return sprite(`pu:${type}`, 30, 14, 10, g => {
    g.shadowColor = def.color;
    g.shadowBlur = 12;
    const body = g.createLinearGradient(0, 0, 0, 14);
    body.addColorStop(0, shade(def.color, 0.5));
    body.addColorStop(0.5, def.color);
    body.addColorStop(1, shade(def.color, -0.45));
    g.fillStyle = body;
    rr(g, 0, 0, 30, 14, 7);
    g.fill();
    g.shadowBlur = 0;

    g.fillStyle = 'rgba(255,255,255,0.6)';
    rr(g, 4, 1.5, 22, 4, 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 1;
    rr(g, 0.5, 0.5, 29, 13, 6.5);
    g.stroke();

    g.font = `900 10px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.strokeText(def.label, 15, 7.5);
    g.fillStyle = '#0b1020';
    g.fillText(def.label, 15, 7.5);
  });
}

function backgroundSprite() {
  return sprite('bg', W, H, 0, g => {
    const base = g.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, '#0d0628');
    base.addColorStop(0.6, '#070a1f');
    base.addColorStop(1, '#030512');
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

    g.globalCompositeOperation = 'lighter';
    const nebulae = [
      [90, 170, 220, '#7c3aed', 0.28],
      [400, 260, 200, '#0891b2', 0.22],
      [260, 470, 260, '#db2777', 0.14],
      [40, 560, 160, '#2563eb', 0.18],
      [430, 90, 140, '#c026d3', 0.16],
    ];
    for (const [x, y, r, c, a] of nebulae) {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, rgba(c, a));
      rg.addColorStop(1, rgba(c, 0));
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';

    // Perspective floor grid near the bottom
    const horizon = H - 170;
    g.strokeStyle = 'rgba(56,189,248,0.10)';
    g.lineWidth = 1;
    for (let i = -12; i <= 12; i++) {
      g.beginPath();
      g.moveTo(W / 2 + i * 12, horizon);
      g.lineTo(W / 2 + i * 70, H);
      g.stroke();
    }
    for (let k = 0; k < 9; k++) {
      const y = horizon + Math.pow(k / 8, 2) * (H - horizon);
      g.globalAlpha = 0.25 + (k / 8) * 0.75;
      g.beginPath();
      g.moveTo(0, y); g.lineTo(W, y);
      g.stroke();
    }
    g.globalAlpha = 1;
    const fade = g.createLinearGradient(0, horizon - 10, 0, horizon + 60);
    fade.addColorStop(0, 'rgba(7,10,31,1)');
    fade.addColorStop(1, 'rgba(7,10,31,0)');
    g.fillStyle = fade;
    g.fillRect(0, horizon - 10, W, 70);
  });
}

function vignetteSprite() {
  return sprite('vignette', W, H, 0, g => {
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function rainbowGradient(x0, x1, offset, sat = 100, light = 62) {
  const grad = ctx.createLinearGradient(x0, 0, x1, 0);
  for (let i = 0; i <= 6; i++) {
    grad.addColorStop(i / 6, `hsl(${(offset + i * 60) % 360},${sat}%,${light}%)`);
  }
  return grad;
}

function drawBackground() {
  ctx.drawImage(backgroundSprite().c, 0, 0, W, H);
  const t = game.time;
  for (const s of stars) {
    const a = (0.3 + 0.7 * s.z) * (0.6 + 0.4 * Math.sin(t * 2.5 + s.phase));
    ctx.fillStyle = `hsla(${s.hue},90%,85%,${a})`;
    const size = s.z > 0.8 ? 2 : 1.2;
    ctx.fillRect(s.x, s.y, size, size);
  }
}

function drawBricks() {
  const t = game.time;
  for (const b of game.bricks) {
    const p = Math.max(0, Math.min(1, (game.levelTime - b.delay) / 0.5));
    if (p <= 0) continue;
    const dy = (1 - easeOutBack(p)) * -50;
    ctx.globalAlpha = p;
    drawSprite(brickSprite(b), b.x, b.y + dy);
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Shimmer wave sweeping diagonally across the wall
    const wave = Math.pow(Math.max(0, Math.sin(t * 1.4 - (b.x + b.y * 1.5) * 0.012)), 16);
    if (wave > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${wave * 0.35})`;
      rr(ctx, b.x, b.y + dy, b.w, b.h, 4);
      ctx.fill();
    }
    if (b.type === 'bomb') {
      const pulse = 0.55 + 0.45 * Math.sin(t * 6 + b.x * 0.1);
      const cx = b.x + b.w / 2, cy = b.y + dy + b.h / 2;
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 10);
      rg.addColorStop(0, `rgba(255,220,255,${pulse})`);
      rg.addColorStop(0.4, `rgba(232,121,249,${pulse * 0.7})`);
      rg.addColorStop(1, 'rgba(192,80,255,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(cx - 10, cy - 10, 20, 20);
    }
    if (b.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, b.flash * 7)})`;
      rr(ctx, b.x - 1, b.y + dy - 1, b.w + 2, b.h + 2, 5);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawPaddle() {
  const x = paddle.x - paddle.w / 2, y = PADDLE_Y, w = paddle.w, h = PADDLE_H;
  const glue = game.effects.glue > 0;
  const accent = glue ? POWERUPS.glue.color : '#22d3ee';
  const t = game.time;

  // Under-glow
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const ug = ctx.createRadialGradient(paddle.x, y + h / 2, 0, paddle.x, y + h / 2, w * 0.75);
  ug.addColorStop(0, rgba(accent, 0.35 + paddle.flash * 2));
  ug.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = ug;
  ctx.fillRect(paddle.x - w * 0.75, y - 40, w * 1.5, 80);
  ctx.restore();

  // Chrome hull
  const hull = ctx.createLinearGradient(0, y, 0, y + h);
  hull.addColorStop(0, '#f8fafc');
  hull.addColorStop(0.45, '#94a3b8');
  hull.addColorStop(0.55, '#475569');
  hull.addColorStop(1, '#cbd5e1');
  ctx.fillStyle = hull;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();

  // Energy core
  const coreX = x + h * 0.9, coreW = w - h * 1.8;
  ctx.fillStyle = glue
    ? rainbowGradient(coreX, coreX + coreW, 300 + Math.sin(t * 3) * 30, 90, 70)
    : rainbowGradient(coreX, coreX + coreW, t * 120);
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10;
  rr(ctx, coreX, y + 4, coreW, h - 8, 3);
  ctx.fill();
  ctx.restore();

  // End caps
  for (const cx of [x + h / 2, x + w - h / 2]) {
    const cap = ctx.createRadialGradient(cx - 1.5, y + h / 2 - 2, 0, cx, y + h / 2, h / 2);
    cap.addColorStop(0, '#ffffff');
    cap.addColorStop(0.5, accent);
    cap.addColorStop(1, shade(accent, -0.5));
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(cx, y + h / 2, h / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gloss & hit flash
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  rr(ctx, x + h * 0.7, y + 1.5, w - h * 1.4, 2, 1);
  ctx.fill();
  if (paddle.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${paddle.flash * 3})`;
    rr(ctx, x, y, w, h, h / 2);
    ctx.fill();
  }
}

function drawBalls() {
  const color = game.effects.pierce > 0 ? PIERCE_COLOR : BALL_COLOR;
  const spr = ballSprite(color);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of game.balls) {
    const n = b.trail.length;
    b.trail.forEach((p, i) => {
      const k = (i + 1) / n;
      ctx.fillStyle = rgba(color, k * 0.35);
      ctx.beginPath();
      ctx.arc(p.x, p.y, BALL_R * (0.3 + 0.7 * k), 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();
  for (const b of game.balls) drawSprite(spr, b.x - BALL_R, b.y - BALL_R);
}

function drawPowerups() {
  for (const p of game.powerups) {
    const def = POWERUPS[p.type];
    const pulse = 1 + Math.sin(p.age * 8) * 0.06;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26);
    rg.addColorStop(0, rgba(def.color, 0.35));
    rg.addColorStop(1, rgba(def.color, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(p.x - 26, p.y - 26, 52, 52);
    ctx.restore();
    drawSprite(powerupSprite(p.type), p.x - 15 * pulse, p.y - 7 * pulse, pulse);
  }
}

function drawParticles() {
  ctx.save();
  for (const p of game.particles) {
    const k = Math.max(0, p.life / p.max);
    if (p.kind === 'shard') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 6);
      ctx.restore();
    } else if (p.kind === 'spark') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      ctx.stroke();
    } else if (p.kind === 'ring') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1 + 4 * k;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.maxR * (1 - k * k), 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.kind === 'flare') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k;
      const r = p.maxR * (0.4 + 0.6 * (1 - k));
      const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      rg.addColorStop(0, rgba('#ffffff', 0.9));
      rg.addColorStop(0.3, rgba(p.color, 0.6));
      rg.addColorStop(1, rgba(p.color, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    } else if (p.kind === 'popup') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = `900 ${p.size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(5,6,20,0.85)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
  }
  ctx.restore();
}

function glowText(text, x, y, font, fill, glow, blur = 10) {
  ctx.font = font;
  ctx.shadowColor = glow;
  ctx.shadowBlur = blur;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

function drawHUD() {
  const t = game.time;
  const bar = ctx.createLinearGradient(0, 0, 0, TOP);
  bar.addColorStop(0, 'rgba(30,16,70,0.95)');
  bar.addColorStop(1, 'rgba(10,8,32,0.95)');
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, W, TOP);
  ctx.fillStyle = rainbowGradient(0, W, t * 60);
  ctx.fillRect(0, TOP - 2, W, 2);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35;
  ctx.fillRect(0, TOP - 4, W, 6);
  ctx.restore();

  ctx.textBaseline = 'middle';
  const label = `700 9px ${FONT}`;
  const value = `900 16px ${FONT}`;

  ctx.textAlign = 'left';
  glowText('SCORE', 14, 14, label, '#a5b4fc', '#6366f1', 4);
  glowText(String(game.score), 14, 31, value, '#ffffff', '#22d3ee');

  ctx.textAlign = 'center';
  glowText('HIGH', W / 2, 14, label, '#f9a8d4', '#ec4899', 4);
  glowText(String(game.hiScore), W / 2, 31, value, '#fde68a', '#f59e0b');

  ctx.textAlign = 'right';
  glowText('STAGE', W - 14, 14, label, '#86efac', '#22c55e', 4);
  glowText(String(game.levelIndex + 1 + game.loop * LEVELS.length), W - 14, 31, value, '#ffffff', '#4ade80');

  // Lives as mini paddles
  for (let i = 0; i < game.lives - 1 && i < 8; i++) {
    const lx = 12 + i * 26, ly = H - 18;
    const g = ctx.createLinearGradient(lx, 0, lx + 20, 0);
    g.addColorStop(0, '#22d3ee');
    g.addColorStop(0.5, '#e0f2fe');
    g.addColorStop(1, '#22d3ee');
    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 8;
    ctx.fillStyle = g;
    rr(ctx, lx, ly, 20, 6, 3);
    ctx.fill();
    ctx.restore();
  }

  // Active effects as pills with countdown bars
  let ex = W - 12;
  ctx.font = `800 9px ${FONT}`;
  ctx.textAlign = 'center';
  for (const [k, remaining] of Object.entries(game.effects)) {
    if (remaining <= 0) continue;
    const def = POWERUPS[k];
    const pw = 52, ph = 14, px = ex - pw, py = H - 22;
    ctx.fillStyle = rgba(def.color, 0.22);
    rr(ctx, px, py, pw, ph, 7);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = rgba(def.color, 0.85);
    rr(ctx, px, py, Math.max(ph, pw * (remaining / def.duration)), ph, 7);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#0b1020';
    ctx.fillText(def.name.slice(0, 6), px + pw / 2, py + ph / 2 + 0.5);
    ex -= pw + 6;
  }
}

function drawTitleText(text, y, size, hueOffset) {
  const t = game.time;
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const letters = [...text];
  const widths = letters.map(l => ctx.measureText(l).width);
  const spacing = size * 0.06;
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (letters.length - 1);
  let x = W / 2 - total / 2;
  letters.forEach((l, i) => {
    const bob = Math.sin(t * 3 + i * 0.5) * size * 0.06;
    const hue = (hueOffset + t * 80 + i * 28) % 360;
    ctx.lineWidth = size * 0.12;
    ctx.strokeStyle = 'rgba(5,4,20,0.9)';
    ctx.strokeText(l, x, y + bob);
    ctx.shadowColor = `hsl(${hue},100%,60%)`;
    ctx.shadowBlur = 18;
    const grad = ctx.createLinearGradient(0, y - size / 2 + bob, 0, y + size / 2 + bob);
    grad.addColorStop(0, `hsl(${hue},100%,88%)`);
    grad.addColorStop(0.5, `hsl(${hue},100%,62%)`);
    grad.addColorStop(1, `hsl(${(hue + 40) % 360},100%,45%)`);
    ctx.fillStyle = grad;
    ctx.fillText(l, x, y + bob);
    ctx.shadowBlur = 0;
    x += widths[i] + spacing;
  });
}

function drawOverlay(title, lines, { hue = 280, prompt = '', size = 46 } = {}) {
  const veil = ctx.createLinearGradient(0, TOP, 0, H);
  veil.addColorStop(0, 'rgba(8,4,28,0.55)');
  veil.addColorStop(0.5, 'rgba(8,4,28,0.8)');
  veil.addColorStop(1, 'rgba(8,4,28,0.55)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, TOP, W, H - TOP);

  drawTitleText(title, H / 2 - 70, size, hue);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 12px ${FONT}`;
  ctx.fillStyle = '#c7d2fe';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 - 10 + i * 22));

  if (prompt) {
    const a = 0.55 + 0.45 * Math.sin(game.time * 4);
    ctx.globalAlpha = a;
    glowText(prompt, W / 2, H / 2 + 30 + lines.length * 22, `800 13px ${FONT}`, '#ffffff', '#22d3ee', 14);
    ctx.globalAlpha = 1;
  }
}

function drawLegend() {
  const items = Object.entries(POWERUPS);
  const colW = 150, startX = W / 2 - colW * 1.5 + 4, startY = H - 150;
  ctx.font = `600 10px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  items.forEach(([type, def], i) => {
    const x = startX + (i % 3) * colW, y = startY + Math.floor(i / 3) * 28;
    drawSprite(powerupSprite(type), x, y - 7);
    ctx.fillStyle = def.color;
    ctx.fillText(def.name, x + 38, y);
  });
}

function render() {
  ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
  if (game.shake > 0) {
    ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
  }

  drawBackground();
  drawBricks();
  drawPowerups();
  drawPaddle();
  drawBalls();
  drawParticles();
  ctx.drawImage(vignetteSprite().c, 0, 0, W, H);
  drawHUD();

  const level = LEVELS[game.levelIndex];
  if (game.state === 'title') {
    drawOverlay('SHARDLINE', [
      'Break every brick. Steel never breaks.',
      'Purple charge bricks blow up their neighbours.',
    ], { prompt: 'CLICK OR PRESS SPACE', size: 50 });
    drawLegend();
  } else if (game.state === 'paused') {
    drawOverlay('PAUSED', [], { hue: 190, prompt: 'PRESS P OR CLICK TO RESUME' });
  } else if (game.state === 'over') {
    drawOverlay('GAME OVER', [`FINAL SCORE  ${game.score}`],
      { hue: 340, prompt: 'CLICK OR PRESS SPACE', size: 42 });
  } else if (game.state === 'between') {
    const looping = game.levelIndex + 1 >= LEVELS.length;
    drawOverlay('CLEAR!', ['+1000 BONUS', looping ? 'FASTER NOW...' : 'NEXT STAGE INCOMING'], { hue: 100, size: 54 });
  } else if (game.state === 'play' && game.balls.some(b => b.serve)) {
    const a = Math.min(1, game.levelTime * 2);
    ctx.globalAlpha = a;
    drawTitleText(`STAGE ${game.levelIndex + 1}`, H / 2 + 30, 28, game.levelIndex * 50);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    glowText(level.name.toUpperCase(), W / 2, H / 2 + 62, `700 13px ${FONT}`, '#e0e7ff', '#a78bfa', 10);
    ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(game.time * 4));
    glowText('CLICK OR SPACE TO LAUNCH', W / 2, H / 2 + 90, `600 10px ${FONT}`, '#c7d2fe', '#22d3ee', 8);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function primaryAction() {
  if (game.state === 'title' || game.state === 'over') newGame();
  else if (game.state === 'paused') game.state = 'play';
  else if (game.state === 'play') game.balls.filter(b => b.stuck).forEach(launchBall);
}

function togglePause() {
  if (game.state === 'play') game.state = 'paused';
  else if (game.state === 'paused') game.state = 'play';
}

function pointerToGameX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return ((clientX - rect.left) / rect.width) * W;
}

window.addEventListener('keydown', e => {
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': input.left = true; break;
    case 'ArrowRight': case 'KeyD': input.right = true; break;
    case 'Space': case 'Enter': primaryAction(); break;
    case 'KeyP': case 'Escape': togglePause(); break;
    case 'KeyM': muted = !muted; break;
    default: return;
  }
  e.preventDefault();
});

window.addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
});

window.addEventListener('mousemove', e => {
  paddle.targetX = pointerToGameX(e.clientX);
  input.mouseActive = true;
});

canvas.addEventListener('mousedown', primaryAction);

canvas.addEventListener('touchstart', e => {
  paddle.targetX = pointerToGameX(e.touches[0].clientX);
  input.mouseActive = true;
  primaryAction();
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  paddle.targetX = pointerToGameX(e.touches[0].clientX);
  input.mouseActive = true;
  e.preventDefault();
}, { passive: false });

window.addEventListener('blur', () => {
  input.left = input.right = false;
  if (game.state === 'play') game.state = 'paused';
});

// Sprites that bake in text must be redrawn once the web font arrives.
document.fonts?.ready.then(() => spriteCache.clear());

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min(0.033, (now - last) / 1000));
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

loadLevel(0);
requestAnimationFrame(frame);
