'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const W = 480;
const H = 640;
const TOP = 44;               // playfield top (HUD band above)
const COLS = 12;
const BW = 36, BH = 16, GAP = 2;
const OX = (W - (COLS * (BW + GAP) - GAP)) / 2;
const OY = TOP + 40;

const PADDLE_Y = H - 44;
const PADDLE_H = 12;
const PADDLE_W = 80;
const PADDLE_W_WIDE = 128;
const PADDLE_KEY_SPEED = 560;

const BALL_R = 6;
const BALL_SPEED = 340;
const BALL_SPEED_MAX = 620;
const MAX_BOUNCE_ANGLE = 1.05;   // ~60 degrees from vertical

const DROP_CHANCE = 0.16;
const START_LIVES = 3;

const COLORS = {
  1: '#4fd1c5',
  2: '#f6ad55',
  3: '#f56565',
  steel: '#8a94ad',
  bomb: '#b794f4',
};

// Power-ups: letter, color, duration (s) for timed effects.
const POWERUPS = {
  wide:   { label: 'W', color: '#63b3ed', duration: 15 },
  multi:  { label: 'M', color: '#f6e05e' },
  slow:   { label: 'S', color: '#68d391', duration: 10 },
  glue:   { label: 'G', color: '#f687b3', duration: 15 },
  pierce: { label: 'P', color: '#fc8181', duration: 7 },
  life:   { label: '+', color: '#ffffff' },
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

function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  message: '',
};

const paddle = { x: W / 2, w: PADDLE_W, targetX: W / 2 };

const input = { left: false, right: false, mouseActive: false };

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
        flash: 0, dead: false,
      };
      if (ch === '#') brick.type = 'steel';
      else if (ch === 'x') brick.type = 'bomb';
      else brick.hp = brick.maxHp = Number(ch);
      game.bricks.push(brick);
    });
  });
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
  game.score += n * (1 + game.loop);
  if (game.score > game.hiScore) {
    game.hiScore = game.score;
    localStorage.setItem('shardline.hi', String(game.hiScore));
  }
}

// ---------------------------------------------------------------------------
// Bricks, power-ups, particles
// ---------------------------------------------------------------------------
function brickColor(b) {
  if (b.type === 'steel') return COLORS.steel;
  if (b.type === 'bomb') return COLORS.bomb;
  return COLORS[b.hp];
}

function spawnParticles(x, y, color, count = 10) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 180;
    game.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.4 + Math.random() * 0.4, maxLife: 0.8, color,
    });
  }
}

function destroyBrick(b) {
  if (b.dead || b.type === 'steel') return;
  b.dead = true;
  addScore(b.type === 'bomb' ? 120 : 50 * b.maxHp);
  spawnParticles(b.x + b.w / 2, b.y + b.h / 2, brickColor(b));

  if (b.type === 'bomb') {
    sfx.boom();
    spawnParticles(b.x + b.w / 2, b.y + b.h / 2, '#fff', 20);
    for (const o of game.bricks) {
      if (o.dead) continue;
      const near = Math.abs(o.x - b.x) <= BW + GAP + 1 && Math.abs(o.y - b.y) <= BH + GAP + 1;
      if (near) destroyBrick(o);
    }
  } else {
    sfx.brick();
  }

  if (Math.random() < DROP_CHANCE) spawnPowerup(b.x + b.w / 2, b.y + b.h / 2);
}

function hitBrick(b) {
  if (b.type === 'steel') {
    b.flash = 0.15;
    sfx.steel();
    return;
  }
  if (game.effects.pierce > 0) { destroyBrick(b); return; }
  b.hp--;
  b.flash = 0.1;
  if (b.hp <= 0) destroyBrick(b);
  else { addScore(10); sfx.steel(); }
}

function spawnPowerup(x, y) {
  const total = POWERUP_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  let type = POWERUP_WEIGHTS[0][0];
  for (const [t, w] of POWERUP_WEIGHTS) {
    if ((r -= w) < 0) { type = t; break; }
  }
  game.powerups.push({ x, y, type, vy: 140 });
}

function applyPowerup(type) {
  sfx.power();
  addScore(100);
  const def = POWERUPS[type];
  if (def.duration) game.effects[type] = def.duration;

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
  } else if (type === 'glue') {
    // nothing extra: handled on paddle contact
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
  return { hit: dx * dx + dy * dy < BALL_R * BALL_R, dx, dy };
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
    if (b.x - BALL_R < 0) { b.x = BALL_R; b.vx = Math.abs(b.vx); sfx.wall(); }
    if (b.x + BALL_R > W) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); sfx.wall(); }
    if (b.y - BALL_R < TOP) { b.y = TOP + BALL_R; b.vy = Math.abs(b.vy); sfx.wall(); }

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
      hitBrick(br);
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

  if (input.left || input.right) {
    input.mouseActive = false;
    paddle.x += (input.right - input.left) * PADDLE_KEY_SPEED * dt;
  } else if (input.mouseActive) {
    paddle.x += (paddle.targetX - paddle.x) * Math.min(1, dt * 25);
  }
  paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, paddle.x));
}

function update(dt) {
  // Particles animate in every state
  for (const p of game.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 400 * dt;
    p.life -= dt;
  }
  game.particles = game.particles.filter(p => p.life > 0);

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
    if (b.trail.length > 8) b.trail.shift();
  }
  game.balls = game.balls.filter(b => !b.dead);

  // Bricks
  for (const br of game.bricks) br.flash = Math.max(0, br.flash - dt);
  game.bricks = game.bricks.filter(br => !br.dead);

  // Power-ups
  for (const p of game.powerups) {
    p.y += p.vy * dt;
    const caught = p.y + 7 > PADDLE_Y && p.y - 7 < PADDLE_Y + PADDLE_H &&
      Math.abs(p.x - paddle.x) < paddle.w / 2 + 14;
    if (caught) { p.dead = true; applyPowerup(p.type); }
    if (p.y > H + 20) p.dead = true;
  }
  game.powerups = game.powerups.filter(p => !p.dead);

  // Lost all balls
  if (game.balls.length === 0) {
    game.lives--;
    sfx.lose();
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
    game.betweenTimer = 2.2;
    game.powerups = [];
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawBackground() {
  ctx.fillStyle = '#0b0d1c';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(90, 110, 200, 0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 32) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, TOP); ctx.lineTo(x + 0.5, H); ctx.stroke();
  }
  for (let y = TOP; y <= H; y += 32) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
  }
}

function drawHUD() {
  ctx.fillStyle = '#12152b';
  ctx.fillRect(0, 0, W, TOP);
  ctx.fillStyle = '#2a3060';
  ctx.fillRect(0, TOP - 2, W, 2);

  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#cbd2f5';
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE ${game.score}`, 12, TOP / 2);
  ctx.textAlign = 'center';
  ctx.fillText(`HI ${game.hiScore}`, W / 2, TOP / 2);
  ctx.textAlign = 'right';
  ctx.fillText(`LV ${game.levelIndex + 1 + game.loop * LEVELS.length}`, W - 12, TOP / 2);

  // Lives as small paddles
  for (let i = 0; i < game.lives - 1 && i < 8; i++) {
    ctx.fillStyle = '#63b3ed';
    roundRect(12 + i * 22, H - 16, 18, 5, 2);
    ctx.fill();
  }

  // Active effects
  let ex = W - 12;
  ctx.textAlign = 'right';
  ctx.font = 'bold 11px ui-monospace, monospace';
  for (const [k, t] of Object.entries(game.effects)) {
    if (t <= 0) continue;
    const def = POWERUPS[k];
    const text = `${def.label} ${Math.ceil(t)}`;
    ctx.fillStyle = def.color;
    ctx.fillText(text, ex, H - 13);
    ex -= ctx.measureText(text).width + 12;
  }
}

function drawBricks() {
  for (const b of game.bricks) {
    const color = b.flash > 0 ? '#ffffff' : brickColor(b);
    ctx.fillStyle = color;
    roundRect(b.x, b.y, b.w, b.h, 3);
    ctx.fill();

    // Bevel highlight / shadow
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(b.x + 2, b.y + b.h - 4, b.w - 4, 2);

    if (b.type === 'steel') {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 6; i < b.w; i += 8) {
        ctx.moveTo(b.x + i, b.y + b.h - 2);
        ctx.lineTo(b.x + i + 6, b.y + 2);
      }
      ctx.stroke();
    } else if (b.type === 'bomb') {
      ctx.fillStyle = '#2d1b4e';
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.hp < b.maxHp) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.3, b.y + 2);
      ctx.lineTo(b.x + b.w * 0.45, b.y + b.h * 0.6);
      ctx.lineTo(b.x + b.w * 0.6, b.y + b.h - 2);
      ctx.stroke();
    }
  }
}

function drawPaddle() {
  const x = paddle.x - paddle.w / 2;
  const glue = game.effects.glue > 0;
  const grad = ctx.createLinearGradient(0, PADDLE_Y, 0, PADDLE_Y + PADDLE_H);
  grad.addColorStop(0, glue ? '#fbb6ce' : '#90cdf4');
  grad.addColorStop(1, glue ? '#b83280' : '#2b6cb0');
  ctx.fillStyle = grad;
  roundRect(x, PADDLE_Y, paddle.w, PADDLE_H, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(x + 6, PADDLE_Y + 2, paddle.w - 12, 2);
}

function drawBalls() {
  const pierce = game.effects.pierce > 0;
  for (const b of game.balls) {
    b.trail.forEach((t, i) => {
      ctx.fillStyle = pierce
        ? `rgba(252,129,129,${(i / b.trail.length) * 0.35})`
        : `rgba(200,220,255,${(i / b.trail.length) * 0.25})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, BALL_R * (i / b.trail.length), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = pierce ? '#fc8181' : '#ffffff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawPowerups() {
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of game.powerups) {
    const def = POWERUPS[p.type];
    ctx.fillStyle = def.color;
    roundRect(p.x - 14, p.y - 7, 28, 14, 7);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillText(def.label, p.x, p.y + 1);
  }
}

function drawParticles() {
  for (const p of game.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
}

function drawOverlay(title, lines) {
  ctx.fillStyle = 'rgba(5, 6, 14, 0.72)';
  ctx.fillRect(0, TOP, W, H - TOP);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f6e05e';
  ctx.font = 'bold 44px ui-monospace, monospace';
  ctx.fillText(title, W / 2, H / 2 - 50);
  ctx.fillStyle = '#cbd2f5';
  ctx.font = '15px ui-monospace, monospace';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + 6 + i * 24));
}

function render() {
  drawBackground();
  drawBricks();
  drawPowerups();
  drawPaddle();
  drawBalls();
  drawParticles();
  drawHUD();

  const level = LEVELS[game.levelIndex];
  if (game.state === 'title') {
    drawOverlay('SHARDLINE', [
      'Break every brick. Steel ones never break.',
      'Purple charge bricks blow up neighbours.',
      '',
      'Click or press Space to start',
    ]);
  } else if (game.state === 'paused') {
    drawOverlay('PAUSED', ['Press P or click to resume']);
  } else if (game.state === 'over') {
    drawOverlay('GAME OVER', [`Score ${game.score}`, '', 'Click or press Space to play again']);
  } else if (game.state === 'between') {
    drawOverlay('CLEAR!', ['+1000', '', game.levelIndex + 1 >= LEVELS.length ? 'Faster now...' : 'Next stage']);
  } else if (game.state === 'play' && game.balls.some(b => b.serve)) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#cbd2f5';
    ctx.font = 'bold 16px ui-monospace, monospace';
    ctx.fillText(`Stage ${game.levelIndex + 1}: ${level.name}`, W / 2, H / 2 + 40);
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText('Click or Space to launch', W / 2, H / 2 + 64);
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

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

loadLevel(0);
requestAnimationFrame(frame);
