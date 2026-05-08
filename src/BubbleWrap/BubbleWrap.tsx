import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Sparkles } from 'lucide-react';
import './BubbleWrap.less';

// ════════════════════════════════════════════════════════════════
//                          TYPES & CONFIG
// ════════════════════════════════════════════════════════════════

type Theme = 'honey' | 'cosmic' | 'soap';

interface Star {
  x: number;
  y: number;
  r: number;
  brightness: number;
  twinklePhase: number;
}

interface Bubble {
  i: number;
  j: number;
  hx: number;
  hy: number;
  popped: boolean;
  popT: number;
  growT: number;
  pressT: number;
  poppedAt: number;
  galaxy: Star[];
  hue: number;
  jitter: number;
  // spring physics — bubble has displacement (dx, dy) from home, spring back with damping
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  breathPhase: number;
  breathPeriod: number;
}

interface Shockwave {
  x: number;
  y: number;
  bornAt: number;
  energy: number;
  hue: number;
  theme: Theme;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  hue: number;
  theme: Theme;
}

interface Ripple {
  x: number;
  y: number;
  bornAt: number;
  intensity: number;
}

interface Flash {
  x: number;
  y: number;
  bornAt: number;
}

// ─── tunables ──────────────────────────────────────────────────
// Slightly larger bubbles + spacing on small screens to keep total count down
const IS_TOUCH = typeof window !== 'undefined' && 'ontouchstart' in window;
const BUBBLE_R = IS_TOUCH ? 32 : 27;
const BUBBLE_PITCH = IS_TOUCH ? 72 : 60;
const POP_DURATION_MS = 320;
const REGROW_DURATION_MS = 1300;
const REGROW_THRESHOLD = 0.25;     // start regrowing earlier so the wrap never empties
const REGROW_INTERVAL_MS = 550;
const TAP_THROTTLE_MS = 38;        // min ms between taps (anti-double-tap)
const HIT_RADIUS = BUBBLE_R + 4;   // generous hit area for tap-only mode

// pop animation phase splits — anticipation → overshoot → collapse
const POP_ANTIC_END = 0.18;     // 0..0.18 = compress flat
const POP_OVER_END = 0.30;      // 0.18..0.30 = snap to overshoot peak
const POP_PEAK = 1.42;          // overshoot peak scale
const POP_ANTIC_SX = 1.18;      // anticipation horizontal stretch
const POP_ANTIC_SY = 0.74;      // anticipation vertical squish

// sheet flex (spring physics)
const SHEET_FLEX_RADIUS_R = 2.8;       // radius in bubble-pitch units
const SHEET_FLEX_FORCE = 720;          // initial outward velocity scale (px/s)
const SPRING_OMEGA_SQ = 480;           // spring stiffness (1/s²)
const SPRING_DAMP = 9.5;               // damping coefficient

const RIPPLE_SPEED = 0.45;
const RIPPLE_LIFE_MS = 700;

const PARTICLE_LIFE_MS = 580;
const FLASH_LIFE_MS = 140;
const SHOCKWAVE_LIFE_MS = 380;

const CONSEC_RESET_MS = 280;

// sprite size — leaves room for halo + overshoot
const SPRITE_R = BUBBLE_R * 1.4;
const SPRITE_SIZE = SPRITE_R * 2;

// hue bucketing for variant sprites
const SOAP_HUE_BUCKETS = 12;
const COSMIC_HUE_BUCKETS = 8;

const THEME_ORDER: Theme[] = ['honey', 'cosmic', 'soap'];

// ════════════════════════════════════════════════════════════════
//                        FACTORIES
// ════════════════════════════════════════════════════════════════

function makeGalaxy(): Star[] {
  const out: Star[] = [];
  const n = 6 + Math.floor(Math.random() * 6);
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.pow(Math.random(), 1.4) * (BUBBLE_R - 6);
    out.push({
      x: Math.cos(a) * d,
      y: Math.sin(a) * d,
      r: Math.random() * 0.8 + 0.4,
      brightness: Math.random() * 0.6 + 0.4,
      twinklePhase: Math.random() * Math.PI * 2,
    });
  }
  return out;
}

function makeBubble(i: number, j: number, x: number, y: number): Bubble {
  return {
    i, j,
    hx: x, hy: y,
    popped: false,
    popT: 0,
    growT: 1,
    pressT: 0,
    poppedAt: 0,
    galaxy: makeGalaxy(),
    hue: Math.random() * 360,
    jitter: (Math.random() - 0.5) * 1.2,
    dx: 0, dy: 0, vx: 0, vy: 0,
    breathPhase: Math.random() * Math.PI * 2,
    breathPeriod: 3000 + Math.random() * 2200,
  };
}

// Pop animation: anticipation (flatten) → overshoot (snap up) → collapse (crash to 0)
// Returns { sx, sy } scale factors; bubble physically deforms.
function popTransform(t: number): { sx: number; sy: number } {
  if (t <= 0) return { sx: 1, sy: 1 };
  if (t >= 1) return { sx: 0, sy: 0 };
  if (t < POP_ANTIC_END) {
    // anticipation — pre-pop flatten
    const u = t / POP_ANTIC_END;
    const eased = 1 - Math.pow(1 - u, 2.4);
    return {
      sx: 1 + (POP_ANTIC_SX - 1) * eased,
      sy: 1 + (POP_ANTIC_SY - 1) * eased,
    };
  } else if (t < POP_OVER_END) {
    // overshoot — snap to peak (circular motion: ellipse → bigger sphere)
    const u = (t - POP_ANTIC_END) / (POP_OVER_END - POP_ANTIC_END);
    const eased = 1 - Math.pow(1 - u, 1.8);
    const sx = POP_ANTIC_SX + (POP_PEAK - POP_ANTIC_SX) * eased;
    const sy = POP_ANTIC_SY + (POP_PEAK - POP_ANTIC_SY) * eased;
    return { sx, sy };
  } else {
    // collapse — crash to 0
    const u = (t - POP_OVER_END) / (1 - POP_OVER_END);
    const eased = u * u * u;
    return { sx: POP_PEAK * (1 - eased), sy: POP_PEAK * (1 - eased) };
  }
}

// ════════════════════════════════════════════════════════════════
//                  STATIC BUBBLE PAINTING (offscreen)
// ════════════════════════════════════════════════════════════════
//   Each theme paints its 6-layer glass into a sprite ONCE.
//   Render loop only blits the sprite (drawImage).

function paintHoneyBubble(ctx: CanvasRenderingContext2D, r: number) {
  // ─ Drop shadow (warm umber) ─
  const sh = ctx.createRadialGradient(0, 4, 0, 0, 4, r * 1.05);
  sh.addColorStop(0, 'rgba(120, 70, 30, 0.36)');
  sh.addColorStop(0.7, 'rgba(120, 70, 30, 0.14)');
  sh.addColorStop(1, 'rgba(120, 70, 30, 0)');
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(0, 4, r * 1.04, r * 0.96, 0, 0, Math.PI * 2);
  ctx.fill();

  // ─ Body — amber gradient ─
  const body = ctx.createRadialGradient(-r * 0.28, -r * 0.32, r * 0.05, 0, 0, r);
  body.addColorStop(0, 'rgba(255, 248, 200, 0.96)');
  body.addColorStop(0.22, 'rgba(255, 218, 130, 0.94)');
  body.addColorStop(0.55, 'rgba(228, 165, 55, 0.93)');
  body.addColorStop(0.85, 'rgba(170, 100, 25, 0.92)');
  body.addColorStop(1, 'rgba(115, 55, 10, 0.7)');
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

  // ─ Rim (dark amber far side) ─
  const rim = ctx.createRadialGradient(r * 0.22, r * 0.3, r * 0.55, r * 0.15, r * 0.2, r);
  rim.addColorStop(0, 'rgba(80, 40, 5, 0)');
  rim.addColorStop(0.85, 'rgba(80, 40, 5, 0.18)');
  rim.addColorStop(1, 'rgba(60, 25, 0, 0.45)');
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

  // ─ Caustic (warm gold crescent) ─
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
  const ca = ctx.createRadialGradient(0, r * 0.7, r * 0.05, 0, r * 0.7, r * 0.6);
  ca.addColorStop(0, 'rgba(255, 235, 170, 0.65)');
  ca.addColorStop(0.6, 'rgba(255, 220, 130, 0.22)');
  ca.addColorStop(1, 'rgba(255, 220, 130, 0)');
  ctx.fillStyle = ca;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.55, r * 0.55, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ─ Halo (soft warm halo around hot spot) ─
  const ha = ctx.createRadialGradient(-r * 0.3, -r * 0.4, 0, -r * 0.3, -r * 0.4, r * 0.55);
  ha.addColorStop(0, 'rgba(255, 250, 220, 0.55)');
  ha.addColorStop(0.4, 'rgba(255, 240, 180, 0.22)');
  ha.addColorStop(1, 'rgba(255, 240, 180, 0)');
  ctx.fillStyle = ha;
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.4, r * 0.5, r * 0.36, -0.45, 0, Math.PI * 2);
  ctx.fill();

  // ─ Specular (sharp warm white hot spot) ─
  ctx.fillStyle = 'rgba(255, 252, 220, 0.95)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.42, r * 0.11, r * 0.07, -0.45, 0, Math.PI * 2);
  ctx.fill();
}

function paintCosmicBubble(ctx: CanvasRenderingContext2D, r: number, hueShift: number) {
  // ─ Drop shadow ─
  const sh = ctx.createRadialGradient(0, 5, 0, 0, 5, r * 1.05);
  sh.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  sh.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(0, 5, r * 0.95, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  // ─ Body — nebula colored by hueShift ─
  const body = ctx.createRadialGradient(-r * 0.15, -r * 0.2, r * 0.05, 0, 0, r);
  body.addColorStop(0, `hsla(${hueShift + 280}, 60%, 45%, 0.92)`);
  body.addColorStop(0.45, `hsla(${hueShift + 250}, 55%, 22%, 0.92)`);
  body.addColorStop(0.85, 'rgba(20, 12, 45, 0.92)');
  body.addColorStop(1, 'rgba(8, 4, 22, 0.7)');
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

  // ─ Stars BAKED into sprite (deterministic per hue bucket) ─
  // Use hueShift as seed so each bucket has its own galaxy pattern
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
  let seed = Math.floor(hueShift * 13 + 7);
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return ((seed >>> 0) % 10000) / 10000;
  };
  const starCount = 8;
  for (let k = 0; k < starCount; k++) {
    const angle = rng() * Math.PI * 2;
    const dist = Math.pow(rng(), 1.4) * (r - 5);
    const sx = Math.cos(angle) * dist;
    const sy = Math.sin(angle) * dist;
    const sr = rng() * 0.7 + 0.4;
    const brightness = rng() * 0.5 + 0.5;
    // halo
    ctx.fillStyle = `rgba(255, 230, 200, ${brightness * 0.22})`;
    ctx.beginPath(); ctx.arc(sx, sy, sr * 4, 0, Math.PI * 2); ctx.fill();
    // core
    ctx.fillStyle = `rgba(255, 250, 220, ${brightness})`;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // ─ Rim ─
  const rim = ctx.createRadialGradient(r * 0.25, r * 0.3, r * 0.55, r * 0.2, r * 0.25, r);
  rim.addColorStop(0, 'rgba(0, 0, 0, 0)');
  rim.addColorStop(0.85, 'rgba(0, 0, 10, 0.25)');
  rim.addColorStop(1, 'rgba(0, 0, 10, 0.55)');
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

  // ─ Caustic (violet) ─
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
  const ca = ctx.createRadialGradient(0, r * 0.7, r * 0.05, 0, r * 0.7, r * 0.55);
  ca.addColorStop(0, 'rgba(180, 150, 240, 0.32)');
  ca.addColorStop(1, 'rgba(180, 150, 240, 0)');
  ctx.fillStyle = ca;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.55, r * 0.5, r * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ─ Halo ─
  const ha = ctx.createRadialGradient(-r * 0.3, -r * 0.4, 0, -r * 0.3, -r * 0.4, r * 0.5);
  ha.addColorStop(0, 'rgba(220, 200, 255, 0.4)');
  ha.addColorStop(0.5, 'rgba(180, 160, 220, 0.12)');
  ha.addColorStop(1, 'rgba(180, 160, 220, 0)');
  ctx.fillStyle = ha;
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.4, r * 0.45, r * 0.3, -0.45, 0, Math.PI * 2);
  ctx.fill();

  // ─ Specular ─
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.4, r * 0.09, r * 0.05, -0.45, 0, Math.PI * 2);
  ctx.fill();
}

function paintSoapBubble(ctx: CanvasRenderingContext2D, r: number, hueShift: number) {
  // ─ Drop shadow ─
  const sh = ctx.createRadialGradient(0, 4, 0, 0, 4, r * 1.05);
  sh.addColorStop(0, 'rgba(160, 120, 180, 0.28)');
  sh.addColorStop(1, 'rgba(160, 120, 180, 0)');
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(0, 4, r * 1.02, r * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();

  // ─ Body iridescent ─
  const body = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.04, 0, 0, r);
  body.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  body.addColorStop(0.18, `hsla(${hueShift}, 78%, 84%, 0.78)`);
  body.addColorStop(0.42, `hsla(${hueShift + 70}, 70%, 78%, 0.72)`);
  body.addColorStop(0.65, `hsla(${hueShift + 160}, 65%, 72%, 0.7)`);
  body.addColorStop(0.85, `hsla(${hueShift + 240}, 70%, 68%, 0.68)`);
  body.addColorStop(1, `hsla(${hueShift + 320}, 75%, 60%, 0.45)`);
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

  // ─ Thin film interference rings ─
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = `hsla(${hueShift + 100}, 80%, 75%, 0.5)`;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = `hsla(${hueShift + 220}, 80%, 70%, 0.4)`;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // ─ Rim ─
  const rim = ctx.createRadialGradient(r * 0.2, r * 0.3, r * 0.6, 0, 0, r);
  rim.addColorStop(0, 'rgba(120, 80, 140, 0)');
  rim.addColorStop(0.85, `hsla(${hueShift + 280}, 50%, 50%, 0.18)`);
  rim.addColorStop(1, `hsla(${hueShift + 280}, 50%, 40%, 0.32)`);
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

  // ─ Caustic ─
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
  const ca = ctx.createRadialGradient(0, r * 0.7, r * 0.05, 0, r * 0.7, r * 0.55);
  ca.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
  ca.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = ca;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.55, r * 0.5, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ─ Halo ─
  const ha = ctx.createRadialGradient(-r * 0.3, -r * 0.42, 0, -r * 0.3, -r * 0.42, r * 0.5);
  ha.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
  ha.addColorStop(0.5, 'rgba(255, 255, 255, 0.18)');
  ha.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = ha;
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.42, r * 0.45, r * 0.32, -0.45, 0, Math.PI * 2);
  ctx.fill();

  // ─ Specular ─
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.42, r * 0.1, r * 0.06, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.beginPath();
  ctx.ellipse(r * 0.42, r * 0.42, r * 0.07, r * 0.04, 0.5, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Sprite cache ───
const SPRITE_CACHE: Record<string, HTMLCanvasElement> = {};

function makeSprite(theme: Theme, hueOffset: number): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = Math.floor(SPRITE_SIZE * dpr);
  c.height = Math.floor(SPRITE_SIZE * dpr);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(SPRITE_R, SPRITE_R);
  if (theme === 'honey') paintHoneyBubble(ctx, BUBBLE_R);
  else if (theme === 'cosmic') paintCosmicBubble(ctx, BUBBLE_R, hueOffset);
  else paintSoapBubble(ctx, BUBBLE_R, hueOffset);
  return c;
}

function getSprite(theme: Theme, hue: number = 0): HTMLCanvasElement {
  let key: string;
  let hueOffset = 0;
  if (theme === 'soap') {
    const bucket = Math.floor(((hue % 360 + 360) % 360) / (360 / SOAP_HUE_BUCKETS));
    hueOffset = bucket * (360 / SOAP_HUE_BUCKETS);
    key = `soap-${bucket}`;
  } else if (theme === 'cosmic') {
    const bucket = Math.floor(((hue % 360 + 360) % 360) / (360 / COSMIC_HUE_BUCKETS));
    hueOffset = bucket * (360 / COSMIC_HUE_BUCKETS);
    key = `cosmic-${bucket}`;
  } else {
    key = theme;
  }
  if (!SPRITE_CACHE[key]) SPRITE_CACHE[key] = makeSprite(theme, hueOffset);
  return SPRITE_CACHE[key];
}

// ─── Background cache ───
let BG_CACHE: { theme: Theme; w: number; h: number; canvas: HTMLCanvasElement } | null = null;

function getBackground(theme: Theme, w: number, h: number): HTMLCanvasElement {
  if (BG_CACHE && BG_CACHE.theme === theme && BG_CACHE.w === w && BG_CACHE.h === h) {
    return BG_CACHE.canvas;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = Math.floor(w * dpr);
  c.height = Math.floor(h * dpr);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (theme === 'honey') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#f6e7c2');
    grad.addColorStop(0.5, '#ecd49b');
    grad.addColorStop(1, '#d8b770');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // diagonal wood grain stripes (deterministic)
    ctx.save();
    ctx.globalAlpha = 0.06;
    for (let k = 0; k < 35; k++) {
      const phase = (k * 277) % 1009 / 1009;
      const y = phase * h * 1.4 - h * 0.2;
      ctx.strokeStyle = k % 2 ? '#7a4f1c' : '#3e2406';
      ctx.lineWidth = 0.6 + (k % 3) * 0.4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + (k % 7 - 3) * 6, w * 0.7, y + (k % 5 - 2) * 8, w, y + (k % 9 - 4) * 4);
      ctx.stroke();
    }
    // amber dust speckles
    ctx.globalAlpha = 0.16;
    for (let k = 0; k < 60; k++) {
      const sx = ((k * 277) % 1009) / 1009 * w;
      const sy = ((k * 463) % 953) / 953 * h;
      ctx.fillStyle = k % 3 === 0 ? '#8b5a16' : '#c08840';
      ctx.fillRect(sx, sy, 1, 1 + (k % 2));
    }
    ctx.restore();
  } else if (theme === 'cosmic') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1a0d3a');
    grad.addColorStop(0.45, '#0d0526');
    grad.addColorStop(1, '#03010f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // soft dust nebula band
    ctx.save();
    ctx.globalAlpha = 0.4;
    const dust = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, w * 0.7);
    dust.addColorStop(0, 'rgba(140, 100, 200, 0.18)');
    dust.addColorStop(0.5, 'rgba(80, 60, 160, 0.08)');
    dust.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = dust;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    // static starfield
    for (let k = 0; k < 90; k++) {
      const sx = ((k * 277) % 1009) / 1009 * w;
      const sy = ((k * 463) % 953) / 953 * h;
      const sz = 0.5 + (k % 4) * 0.3;
      ctx.fillStyle = `rgba(220, 210, 255, 0.65)`;
      ctx.beginPath();
      ctx.arc(sx, sy, sz, 0, Math.PI * 2);
      ctx.fill();
      if (k % 18 === 0) {
        ctx.fillStyle = 'rgba(180, 160, 255, 0.18)';
        ctx.beginPath();
        ctx.arc(sx, sy, sz * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    // soap
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#fde2ee');
    grad.addColorStop(0.5, '#f0e8f5');
    grad.addColorStop(1, '#dcf2ea');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
  BG_CACHE = { theme, w, h, canvas: c };
  return c;
}

// ════════════════════════════════════════════════════════════════
//                          AUDIO MODULE
// ════════════════════════════════════════════════════════════════

interface AudioState {
  ctx: AudioContext;
  master: GainNode;
  reverbIn: GainNode;
  ambientGain: GainNode;
  ambient: { stop: () => void } | null;
  ambientTheme: Theme | null;
  consec: { count: number; last: number };
  inFlightPops: number;       // currently sustaining pop voices
  lastPopAt: number;          // ctx.currentTime of last pop
  resumed: boolean;           // resume() only called once
  // pre-allocated noise buffers (reused for every pop, no per-pop allocation)
  transientBuf: AudioBuffer;
  thockBufs: { honey: AudioBuffer; cosmic: AudioBuffer; soap: AudioBuffer };
  noiseBufs: { honey: AudioBuffer; cosmic: AudioBuffer; soap: AudioBuffer };
}

interface ThemeAudio {
  bodyFreq: number;
  bodyDecay: number;
  partials: number[];
  partialGains: number[];
  reverbMix: number;
  bodyGain: number;
  noiseGain: number;
  noiseHpf: number;
  noiseLpf: number;
  noiseLen: number;
  subBass: boolean;
}

const THEME_AUDIO: Record<Theme, ThemeAudio> = {
  honey: {
    bodyFreq: 165, bodyDecay: 0.36,
    partials: [1, 2.05, 3.18], partialGains: [1, 0.5, 0.22],
    reverbMix: 0.18, bodyGain: 0.26, noiseGain: 0.13, noiseHpf: 200, noiseLpf: 1300, noiseLen: 0.075,
    subBass: true,
  },
  cosmic: {
    bodyFreq: 110, bodyDecay: 0.65,
    partials: [1, 2.78, 5.43, 8.2], partialGains: [1, 0.45, 0.22, 0.10],
    reverbMix: 0.55, bodyGain: 0.20, noiseGain: 0.10, noiseHpf: 600, noiseLpf: 2000, noiseLen: 0.06,
    subBass: true,
  },
  soap: {
    bodyFreq: 520, bodyDecay: 0.28,
    partials: [1, 2.21, 4.13], partialGains: [1, 0.42, 0.18],
    reverbMix: 0.30, bodyGain: 0.20, noiseGain: 0.16, noiseHpf: 1800, noiseLpf: 6500, noiseLen: 0.055,
    subBass: false,
  },
};

function buildReverb(ctx: AudioContext, dst: AudioNode) {
  const input = ctx.createGain();
  const wet = ctx.createGain(); wet.gain.value = 1;
  const delays = [0.0297, 0.0467, 0.0813, 0.1097].map(time => {
    const d = ctx.createDelay(0.5); d.delayTime.value = time;
    return d;
  });
  const fb = delays.map(() => {
    const g = ctx.createGain(); g.gain.value = 0.62;
    return g;
  });
  const damp = delays.map(() => {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3500;
    return f;
  });
  for (let i = 0; i < delays.length; i++) {
    input.connect(delays[i]);
    delays[i].connect(damp[i]);
    damp[i].connect(fb[i]);
    fb[i].connect(delays[i]);
    damp[i].connect(wet);
  }
  wet.connect(dst);
  return input;
}

function noiseBuffer(ctx: AudioContext, lenSec: number) {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * lenSec)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  return buf;
}

function ensureAudio(ref: { current: AudioState | null }): AudioState | null {
  if (ref.current) return ref.current;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  const ctx: AudioContext = new Ctor();
  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);

  const reverbIn = ctx.createGain(); reverbIn.gain.value = 1;
  const reverbInput = buildReverb(ctx, master);
  reverbIn.connect(reverbInput);

  const ambientGain = ctx.createGain();
  ambientGain.gain.value = 0;
  ambientGain.connect(master);

  // pre-allocate noise buffers for every theme — never allocated again per pop
  const transientBuf = noiseBuffer(ctx, 0.005);
  const thockBufs = {
    honey: noiseBuffer(ctx, 0.025),
    cosmic: noiseBuffer(ctx, 0.040),
    soap: noiseBuffer(ctx, 0.020),
  };
  const noiseBufs = {
    honey: noiseBuffer(ctx, THEME_AUDIO.honey.noiseLen),
    cosmic: noiseBuffer(ctx, THEME_AUDIO.cosmic.noiseLen),
    soap: noiseBuffer(ctx, THEME_AUDIO.soap.noiseLen),
  };

  const state: AudioState = {
    ctx, master, reverbIn, ambientGain,
    ambient: null, ambientTheme: null,
    consec: { count: 0, last: 0 },
    inFlightPops: 0,
    lastPopAt: 0,
    resumed: false,
    transientBuf, thockBufs, noiseBufs,
  };
  ref.current = state;
  return state;
}

function playPop(audio: AudioState, theme: Theme, perfTs: number) {
  const cfg = THEME_AUDIO[theme];
  const { ctx, master, reverbIn, consec } = audio;
  // resume() only once, lazily — calling on every pop blocks main thread on iOS
  if (!audio.resumed && ctx.state === 'suspended') {
    audio.resumed = true;
    void ctx.resume();
  }
  // Skip audio entirely while the context is still suspended/closed/interrupted.
  // First pop after page load is usually silent — visual feedback still fires,
  // and once the context flips to 'running' all subsequent pops play normally.
  // This prevents the iOS audio thread from queuing 30+ scheduled voices during
  // a fast first-touch swipe and locking up.
  if (ctx.state !== 'running') return;
  const now = ctx.currentTime;

  // ─ rate-limit: skip if too many sustaining voices or too recent ─
  if (audio.inFlightPops >= 8) return;
  if (now - audio.lastPopAt < 0.025) return;     // 40 pops/s max
  audio.lastPopAt = now;
  audio.inFlightPops++;
  const longestDecay = Math.max(cfg.bodyDecay, 0.4);
  setTimeout(() => { audio.inFlightPops = Math.max(0, audio.inFlightPops - 1); }, longestDecay * 1000 + 50);

  if (perfTs - consec.last < CONSEC_RESET_MS) {
    consec.count = Math.min(consec.count + 1, 8);
  } else {
    consec.count = 0;
  }
  consec.last = perfTs;
  const cascadeCents = consec.count * -55;
  const detuneJitter = (Math.random() - 0.5) * 60;
  const consecVolFactor = Math.max(0.55, 1 - consec.count * 0.08);

  const dryGain = ctx.createGain();
  dryGain.gain.value = (1 - cfg.reverbMix) * consecVolFactor;
  dryGain.connect(master);
  const wetSend = ctx.createGain();
  wetSend.gain.value = cfg.reverbMix * consecVolFactor;
  wetSend.connect(reverbIn);

  // ─ L1 transient click (sharp, ear-grabbing) ─
  const tSrc = ctx.createBufferSource(); tSrc.buffer = audio.transientBuf;
  const tHpf = ctx.createBiquadFilter(); tHpf.type = 'highpass';
  tHpf.frequency.value = theme === 'honey' ? 2200 : 4200;
  const tGain = ctx.createGain();
  tGain.gain.setValueAtTime(0.30 * consecVolFactor, now);
  tGain.gain.exponentialRampToValueAtTime(0.001, now + 0.014);
  tSrc.connect(tHpf); tHpf.connect(tGain); tGain.connect(master);
  tSrc.start(now); tSrc.stop(now + 0.02);

  // ─ L1.5 thock body (mid-low filtered noise = meaty "POP" core) ─
  const thockLen = theme === 'honey' ? 0.025 : theme === 'cosmic' ? 0.040 : 0.020;
  const thSrc = ctx.createBufferSource(); thSrc.buffer = audio.thockBufs[theme];
  const thLp = ctx.createBiquadFilter(); thLp.type = 'lowpass';
  thLp.frequency.value = theme === 'honey' ? 700 : theme === 'cosmic' ? 500 : 1100;
  thLp.Q.value = 2.5;
  const thHp = ctx.createBiquadFilter(); thHp.type = 'highpass';
  thHp.frequency.value = theme === 'honey' ? 80 : 50;
  const thGain = ctx.createGain();
  thGain.gain.setValueAtTime(0.32 * consecVolFactor, now);
  thGain.gain.exponentialRampToValueAtTime(0.001, now + thockLen);
  thSrc.connect(thHp); thHp.connect(thLp); thLp.connect(thGain);
  thGain.connect(dryGain);
  thGain.connect(wetSend);
  thSrc.start(now); thSrc.stop(now + thockLen + 0.005);

  // ─ L2 body partials ─
  for (let i = 0; i < cfg.partials.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = theme === 'honey' ? 'triangle' : 'sine';
    const f = cfg.bodyFreq * cfg.partials[i];
    osc.frequency.setValueAtTime(f * 1.6, now);
    osc.frequency.exponentialRampToValueAtTime(f, now + 0.05);
    osc.detune.setValueAtTime(cascadeCents + detuneJitter, now);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(cfg.bodyGain * cfg.partialGains[i], now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now + cfg.bodyDecay);
    osc.connect(g);
    g.connect(dryGain);
    g.connect(wetSend);
    osc.start(now); osc.stop(now + cfg.bodyDecay + 0.05);
  }

  // ─ Sub-bass thump (honey + cosmic = heavier feel) ─
  if (cfg.subBass) {
    const startF = theme === 'honey' ? 95 : 75;
    const endF = theme === 'honey' ? 38 : 32;
    const dur = theme === 'honey' ? 0.28 : 0.4;
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(startF, now);
    sub.frequency.exponentialRampToValueAtTime(endF, now + dur);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.32 * consecVolFactor, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + dur);
    sub.connect(sg); sg.connect(dryGain);
    sub.start(now); sub.stop(now + dur + 0.04);
  }

  // ─ L3 filtered noise body ─
  const nSrc = ctx.createBufferSource(); nSrc.buffer = audio.noiseBufs[theme];
  const nFilt = ctx.createBiquadFilter();
  nFilt.type = 'highpass'; nFilt.frequency.value = cfg.noiseHpf;
  const nFilt2 = ctx.createBiquadFilter();
  nFilt2.type = 'lowpass'; nFilt2.frequency.value = cfg.noiseLpf;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(cfg.noiseGain * consecVolFactor, now);
  nGain.gain.exponentialRampToValueAtTime(0.001, now + cfg.noiseLen);
  nSrc.connect(nFilt); nFilt.connect(nFilt2); nFilt2.connect(nGain);
  nGain.connect(dryGain);
  nGain.connect(wetSend);
  nSrc.start(now); nSrc.stop(now + cfg.noiseLen);
}

// ───── Ambient bed per theme ─────
function startAmbient(audio: AudioState, theme: Theme) {
  if (audio.ambientTheme === theme && audio.ambient) return;
  const { ctx, ambientGain } = audio;
  const now = ctx.currentTime;
  if (audio.ambient) {
    const old = audio.ambient;
    ambientGain.gain.cancelScheduledValues(now);
    ambientGain.gain.setValueAtTime(ambientGain.gain.value, now);
    ambientGain.gain.linearRampToValueAtTime(0, now + 0.6);
    setTimeout(() => old.stop(), 700);
  }
  let stopper: () => void;
  if (theme === 'honey') stopper = ambientHoney(audio);
  else if (theme === 'cosmic') stopper = ambientCosmic(audio);
  else stopper = ambientSoap(audio);
  audio.ambient = { stop: stopper };
  audio.ambientTheme = theme;
  ambientGain.gain.cancelScheduledValues(now);
  ambientGain.gain.setValueAtTime(0, now);
  const target = theme === 'cosmic' ? 0.32 : theme === 'honey' ? 0.22 : 0.22;
  ambientGain.gain.linearRampToValueAtTime(target, now + 1.2);
}

function ambientHoney(audio: AudioState): () => void {
  // sun-soaked afternoon: warm low pad + slow LFO + occasional micro-creak
  const { ctx, ambientGain } = audio;
  const out = ctx.createGain(); out.gain.value = 1; out.connect(ambientGain);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.05;
  const lfoG = ctx.createGain(); lfoG.gain.value = 200;
  lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
  lp.connect(out);

  // dual triangle drone (perfect 5th, very low)
  const root = 65;            // C2 ish
  const fifth = root * 1.5;
  const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = root; o1.detune.value = -3;
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = fifth; o2.detune.value = 4;
  const g1 = ctx.createGain(); g1.gain.value = 0.18;
  const g2 = ctx.createGain(); g2.gain.value = 0.13;
  o1.connect(g1); o2.connect(g2);
  g1.connect(lp); g2.connect(lp);
  o1.start(); o2.start();

  // bandpass pink noise (ambient warmth)
  const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = 0.97 * last + 0.03 * w;
    d[i] = last;
  }
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.6;
  const ng = ctx.createGain(); ng.gain.value = 0.12;
  src.connect(bp); bp.connect(ng); ng.connect(out);
  src.start();

  // occasional creak / settle
  const creakTimer = setInterval(() => {
    if (Math.random() < 0.6) return;
    const t0 = ctx.currentTime;
    const f = 250 + Math.random() * 200;
    const cosc = ctx.createOscillator(); cosc.type = 'sawtooth'; cosc.frequency.value = f;
    const cflt = ctx.createBiquadFilter(); cflt.type = 'lowpass'; cflt.frequency.value = 700;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t0);
    cg.gain.linearRampToValueAtTime(0.025, t0 + 0.06);
    cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
    cosc.connect(cflt); cflt.connect(cg); cg.connect(out);
    cosc.start(t0); cosc.stop(t0 + 0.5);
  }, 7000);

  return () => {
    clearInterval(creakTimer);
    try { o1.stop(); o2.stop(); src.stop(); lfo.stop(); } catch { /* noop */ }
  };
}

function ambientCosmic(audio: AudioState): () => void {
  const { ctx, ambientGain } = audio;
  const out = ctx.createGain(); out.gain.value = 1; out.connect(ambientGain);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
  const lfoG = ctx.createGain(); lfoG.gain.value = 350;
  lfo.connect(lfoG); lfoG.connect(lp.frequency);
  lfo.start();
  lp.connect(out);
  const chords: number[][] = [
    [110, 165, 196, 261, 311],
    [104, 156, 196, 247, 311],
    [98, 147, 196, 233, 294],
    [117, 165, 196, 247, 277],
  ];
  let chordI = 0;
  const voices: { osc: OscillatorNode; g: GainNode }[] = [];
  function playChord() {
    const prev = voices.splice(0, voices.length);
    const t0 = ctx.currentTime;
    for (const v of prev) {
      v.g.gain.cancelScheduledValues(t0);
      v.g.gain.setValueAtTime(v.g.gain.value, t0);
      v.g.gain.linearRampToValueAtTime(0, t0 + 4);
      try { v.osc.stop(t0 + 4.2); } catch { /* noop */ }
    }
    const chord = chords[chordI % chords.length];
    chordI++;
    for (const f of chord) {
      const osc = ctx.createOscillator(); osc.type = 'triangle';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.16 / chord.length, t0 + 4);
      g.gain.linearRampToValueAtTime(0.13 / chord.length, t0 + 11);
      osc.connect(g); g.connect(lp);
      osc.start(t0);
      voices.push({ osc, g });
    }
  }
  playChord();
  const interval = setInterval(playChord, 14000);
  return () => {
    clearInterval(interval);
    for (const v of voices) { try { v.osc.stop(); } catch { /* noop */ } }
    try { lfo.stop(); } catch { /* noop */ }
  };
}

function ambientSoap(audio: AudioState): () => void {
  const { ctx, ambientGain } = audio;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.value = 800; bp.Q.value = 0.7;
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.05;
  const lfoG = ctx.createGain(); lfoG.gain.value = 250;
  lfo.connect(lfoG); lfoG.connect(bp.frequency);
  const ng = ctx.createGain(); ng.gain.value = 0.3;
  src.connect(bp); bp.connect(ng); ng.connect(ambientGain);
  src.start(); lfo.start();
  const dropTimer = setInterval(() => {
    if (Math.random() < 0.4) return;
    const t0 = ctx.currentTime;
    const freq = 900 + Math.random() * 700;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.04, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.5);
    osc.connect(g); g.connect(ambientGain);
    osc.start(t0); osc.stop(t0 + 1.6);
  }, 4500);
  return () => {
    clearInterval(dropTimer);
    try { src.stop(); } catch { /* noop */ }
    try { lfo.stop(); } catch { /* noop */ }
  };
}

// ════════════════════════════════════════════════════════════════
//                    POPPED FLAT (per-theme)
// ════════════════════════════════════════════════════════════════

function drawHoneyFlat(ctx: CanvasRenderingContext2D, _b: Bubble, r: number, popT: number) {
  const fr = r * 0.9;
  ctx.globalAlpha = popT * 0.85;
  const grad = ctx.createRadialGradient(0, -2, 0, 0, 0, fr);
  grad.addColorStop(0, 'rgba(190, 130, 50, 0.55)');
  grad.addColorStop(1, 'rgba(120, 70, 15, 0.35)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0, 0, fr, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(80, 40, 5, 0.4)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-fr * 0.55, fr * 0.18);
  ctx.quadraticCurveTo(0, -fr * 0.2, fr * 0.55, fr * 0.18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-fr * 0.4, fr * 0.5);
  ctx.quadraticCurveTo(0, fr * 0.18, fr * 0.45, fr * 0.45);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawCosmicFlat(ctx: CanvasRenderingContext2D, _b: Bubble, r: number, popT: number) {
  const fr = r * 0.85;
  ctx.globalAlpha = popT * 0.7;
  ctx.fillStyle = 'rgba(8, 4, 20, 0.7)';
  ctx.beginPath(); ctx.arc(0, 0, fr, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(120, 100, 180, 0.3)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawSoapFlat(ctx: CanvasRenderingContext2D, b: Bubble, r: number, popT: number) {
  const ringR = r * (0.4 + popT * 1.0);
  ctx.globalAlpha = (1 - popT) * 0.85;
  ctx.strokeStyle = `hsla(${b.hue + 180}, 75%, 70%, 0.9)`;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(0, 0, ringR, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = (1 - popT) * 0.55;
  ctx.strokeStyle = `hsla(${b.hue + 30}, 75%, 75%, 0.7)`;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, ringR * 0.78, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
}

const FLAT_DRAWERS: Record<Theme, (ctx: CanvasRenderingContext2D, b: Bubble, r: number, popT: number) => void> = {
  honey: drawHoneyFlat,
  cosmic: drawCosmicFlat,
  soap: drawSoapFlat,
};

// ════════════════════════════════════════════════════════════════
//                          COMPONENT
// ════════════════════════════════════════════════════════════════

export default function BubbleWrap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState<Theme>('honey');
  const [hintHidden, setHintHidden] = useState(false);

  const themeRef = useRef<Theme>(theme);
  themeRef.current = theme;
  const bubblesRef = useRef<Bubble[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const flashesRef = useRef<Flash[]>([]);
  const shockwavesRef = useRef<Shockwave[]>([]);
  const audioRef = useRef<AudioState | null>(null);
  const ambientStartingRef = useRef(false);
  const lastPopAtRef = useRef(0);
  const hintHiddenRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx2d = canvas.getContext('2d')!;

    function cssSize() {
      const r = canvas.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { w, h } = cssSize();
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      // invalidate bg cache for new size
      BG_CACHE = null;
      buildGrid(w, h);
    }

    function buildGrid(w: number, h: number) {
      const dx = BUBBLE_PITCH;
      const dy = BUBBLE_PITCH * 0.866;
      // Reserve safe margins so every bubble is comfortably reachable. Top
      // covers the theme switcher pill + iOS notch; bottom keeps clear of the
      // hint text + iOS home indicator + Aigram bottom UI.
      const safeTop = 96;
      const safeBottom = 90;
      const safeSide = 24;
      const aw = Math.max(80, w - safeSide * 2);
      const ah = Math.max(80, h - safeTop - safeBottom);
      const cols = Math.max(2, Math.floor(aw / dx));
      const rows = Math.max(2, Math.floor(ah / dy));
      const totalW = (cols - 1) * dx + dx / 2;
      const totalH = (rows - 1) * dy;
      const offX = safeSide + (aw - totalW) / 2;
      const offY = safeTop + (ah - totalH) / 2;
      const prev = new Map<string, Bubble>();
      for (const b of bubblesRef.current) prev.set(`${b.i},${b.j}`, b);
      const next: Bubble[] = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = offX + i * dx + (j % 2 ? dx / 2 : 0);
          const y = offY + j * dy;
          const key = `${i},${j}`;
          const existing = prev.get(key);
          if (existing) {
            existing.hx = x; existing.hy = y;
            next.push(existing);
          } else {
            next.push(makeBubble(i, j, x, y));
          }
        }
      }
      bubblesRef.current = next;
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let lastTs = performance.now();
    let lastDraw = 0;
    let lastRegrow = performance.now();
    const FRAME_MS = 1000 / 60;       // throttle to ~60fps even on 120Hz devices

    function spawnBurst(b: Bubble, t: number) {
      const tk = themeRef.current;
      const isSoap = tk === 'soap';

      // particles — many, big, fast
      const n = 11;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + Math.random() * 0.6;
        const speed = 110 + Math.random() * 140;
        particlesRef.current.push({
          x: b.hx, y: b.hy,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed - 40,
          life: 1,
          size: 2.2 + Math.random() * 3.5,
          hue: isSoap ? b.hue + (Math.random() - 0.5) * 60 : 0,
          theme: tk,
        });
      }

      // shockwave ring (large, outside the bubble)
      shockwavesRef.current.push({
        x: b.hx, y: b.hy, bornAt: t, energy: 1,
        hue: b.hue, theme: tk,
      });

      // ripple
      ripplesRef.current.push({ x: b.hx, y: b.hy, bornAt: t, intensity: 1 });

      // flash on every theme now (more visceral)
      flashesRef.current.push({ x: b.hx, y: b.hy, bornAt: t });

      // sheet flex — spring impulse on all bubbles within 3-ring radius
      const reach = BUBBLE_PITCH * SHEET_FLEX_RADIUS_R;
      const reach2 = reach * reach;
      for (const o of bubblesRef.current) {
        if (o === b || o.popped) continue;
        const ddx = o.hx - b.hx;
        const ddy = o.hy - b.hy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > reach2 || d2 < 0.5) continue;
        const d = Math.sqrt(d2);
        const falloff = 1 - d / reach;
        const force = SHEET_FLEX_FORCE * falloff * falloff;
        o.vx += (ddx / d) * force;
        o.vy += (ddy / d) * force;
      }
    }

    function frame(t: number) {
      // throttle to ~60fps on 120Hz devices (iPhone Pro etc.)
      if (t - lastDraw < FRAME_MS - 1) {
        raf = requestAnimationFrame(frame);
        return;
      }
      lastDraw = t;
      const dt = Math.min(0.05, (t - lastTs) / 1000);
      lastTs = t;

      const bubbles = bubblesRef.current;
      let poppedFinal = 0;
      for (const b of bubbles) {
        if (b.popped) {
          if (b.popT < 1) b.popT = Math.min(1, b.popT + dt * 1000 / POP_DURATION_MS);
          if (b.popT >= 1) poppedFinal++;
        }
        if (b.growT < 1) b.growT = Math.min(1, b.growT + dt * 1000 / REGROW_DURATION_MS);
        b.pressT = Math.max(0, b.pressT - dt * 4);

        // spring physics: F = -k * dx - c * v
        if (b.dx !== 0 || b.dy !== 0 || b.vx !== 0 || b.vy !== 0) {
          b.vx += (-b.dx * SPRING_OMEGA_SQ - b.vx * SPRING_DAMP) * dt;
          b.vy += (-b.dy * SPRING_OMEGA_SQ - b.vy * SPRING_DAMP) * dt;
          b.dx += b.vx * dt;
          b.dy += b.vy * dt;
          // snap to rest
          if (Math.abs(b.dx) < 0.05 && Math.abs(b.dy) < 0.05 && Math.abs(b.vx) < 0.5 && Math.abs(b.vy) < 0.5) {
            b.dx = 0; b.dy = 0; b.vx = 0; b.vy = 0;
          }
        }
      }

      // ripples — apply outward kick to bubbles when wavefront sweeps past
      for (let i = ripplesRef.current.length - 1; i >= 0; i--) {
        const rp = ripplesRef.current[i];
        const age = t - rp.bornAt;
        if (age > RIPPLE_LIFE_MS) { ripplesRef.current.splice(i, 1); continue; }
        const radius = age * RIPPLE_SPEED;
        const intensity = Math.max(0, 1 - age / RIPPLE_LIFE_MS);
        for (const b of bubbles) {
          if (b.popped) continue;
          const ddx = b.hx - rp.x;
          const ddy = b.hy - rp.y;
          const d = Math.hypot(ddx, ddy);
          if (Math.abs(d - radius) < 22 && d > 0.5) {
            const f = intensity * 220 * (1 - Math.abs(d - radius) / 22);
            b.vx += (ddx / d) * f * dt * 60;
            b.vy += (ddy / d) * f * dt * 60;
          }
        }
      }

      // shockwaves age out
      for (let i = shockwavesRef.current.length - 1; i >= 0; i--) {
        if (t - shockwavesRef.current[i].bornAt > SHOCKWAVE_LIFE_MS) {
          shockwavesRef.current.splice(i, 1);
        }
      }

      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.life -= dt * 1000 / PARTICLE_LIFE_MS;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 280 * dt;
        p.vx *= 0.96; p.vy *= 0.96;
        if (p.life <= 0) particlesRef.current.splice(i, 1);
      }

      for (let i = flashesRef.current.length - 1; i >= 0; i--) {
        if (t - flashesRef.current[i].bornAt > FLASH_LIFE_MS) flashesRef.current.splice(i, 1);
      }

      if (bubbles.length > 0) {
        const popFrac = poppedFinal / bubbles.length;
        if (popFrac > REGROW_THRESHOLD && t - lastRegrow > REGROW_INTERVAL_MS) {
          // FIFO regrow — oldest popped first, regardless of position. The
          // grid now has safe margins so every cell is reachable; preferring
          // edges (the old behaviour) made the wrap drift unreachable over
          // time on certain device aspect ratios.
          let oldest: Bubble | null = null;
          for (const b of bubbles) {
            if (!b.popped || b.popT < 1) continue;
            if (!oldest || b.poppedAt < oldest.poppedAt) oldest = b;
          }
          if (oldest) {
            oldest.popped = false;
            oldest.popT = 0;
            oldest.growT = 0;
            oldest.hue = Math.random() * 360;
            oldest.dx = 0; oldest.dy = 0; oldest.vx = 0; oldest.vy = 0;
            lastRegrow = t;
          }
        }
      }

      render(t);
      raf = requestAnimationFrame(frame);
    }

    function render(t: number) {
      const { w, h } = cssSize();
      const tk = themeRef.current;

      // background — cached canvas
      const bg = getBackground(tk, w, h);
      ctx2d.drawImage(bg, 0, 0, w, h);

      // for soap, overlay drifting caustic shimmer (cheap)
      if (tk === 'soap') {
        const drift = Math.sin(t / 6000) * 30;
        const cgrad = ctx2d.createRadialGradient(w * 0.4 + drift, h * 0.3, 0, w * 0.4 + drift, h * 0.3, w * 0.5);
        cgrad.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
        cgrad.addColorStop(0.6, 'rgba(255, 255, 255, 0.05)');
        cgrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx2d.fillStyle = cgrad;
        ctx2d.fillRect(0, 0, w, h);
      }

      // bubbles — sprite blit
      const flat = FLAT_DRAWERS[tk];
      for (const b of bubblesRef.current) {
        const popping = b.popped && b.popT < 1;
        const fullyPopped = b.popped && b.popT >= 1;

        const breath = Math.sin((t / b.breathPeriod) * Math.PI * 2 + b.breathPhase) * 0.012;
        const cx = b.hx + b.jitter + b.dx;
        const cy = b.hy + b.jitter + b.dy;

        if (!fullyPopped) {
          const pop = popping ? popTransform(b.popT) : { sx: 1, sy: 1 };
          const baseScaleX = b.growT * pop.sx;
          const baseScaleY = b.growT * pop.sy;
          // press anticipation (when held but not yet popping)
          const sx = baseScaleX * (1 + breath) * (1 + b.pressT * 0.18);
          const sy = baseScaleY * (1 + breath) * (1 - b.pressT * 0.22);
          if (Math.abs(sx) > 0.02 && Math.abs(sy) > 0.02) {
            const sprite = getSprite(tk, b.hue);
            ctx2d.save();
            ctx2d.translate(cx, cy);
            ctx2d.scale(sx, sy);
            ctx2d.drawImage(sprite, -SPRITE_R, -SPRITE_R, SPRITE_SIZE, SPRITE_SIZE);
            ctx2d.restore();
          }
        }

        if (popping || fullyPopped) {
          ctx2d.save();
          ctx2d.translate(b.hx + b.jitter, b.hy + b.jitter);
          flat(ctx2d, b, BUBBLE_R, b.popT);
          ctx2d.restore();
        }
      }

      // particles
      for (const p of particlesRef.current) {
        const a = Math.max(0, p.life);
        if (p.theme === 'honey') {
          ctx2d.fillStyle = `rgba(228, 165, 55, ${a * 0.85})`;
        } else if (p.theme === 'cosmic') {
          ctx2d.fillStyle = `rgba(255, 240, 220, ${a * 0.9})`;
        } else {
          ctx2d.fillStyle = `hsla(${p.hue}, 80%, 78%, ${a * 0.85})`;
        }
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
        ctx2d.fill();
      }

      // flashes (white burst at pop point)
      for (const fl of flashesRef.current) {
        const age = t - fl.bornAt;
        const a = Math.max(0, 1 - age / FLASH_LIFE_MS);
        const radius = BUBBLE_R * (1.4 + age / FLASH_LIFE_MS * 0.8);
        const grad = ctx2d.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, radius);
        grad.addColorStop(0, `rgba(255, 255, 255, ${a * 0.85})`);
        grad.addColorStop(0.4, `rgba(255, 255, 255, ${a * 0.4})`);
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx2d.fillStyle = grad;
        ctx2d.beginPath();
        ctx2d.arc(fl.x, fl.y, radius, 0, Math.PI * 2);
        ctx2d.fill();
      }

      // shockwave — big expanding ring with theme color
      for (const sw of shockwavesRef.current) {
        const age = t - sw.bornAt;
        const u = age / SHOCKWAVE_LIFE_MS;
        if (u >= 1) continue;
        const radius = BUBBLE_R * (1 + u * 1.8);
        const a = (1 - u) * (1 - u);
        let stroke: string;
        if (sw.theme === 'honey') {
          stroke = `rgba(255, 195, 100, ${a * 0.85})`;
        } else if (sw.theme === 'cosmic') {
          stroke = `rgba(220, 200, 255, ${a * 0.9})`;
        } else {
          stroke = `hsla(${sw.hue + 180}, 80%, 75%, ${a * 0.85})`;
        }
        ctx2d.strokeStyle = stroke;
        ctx2d.lineWidth = 2.4 * (1 - u * 0.5);
        ctx2d.beginPath();
        ctx2d.arc(sw.x, sw.y, radius, 0, Math.PI * 2);
        ctx2d.stroke();
        // inner companion ring (thinner, lagging)
        if (u > 0.15) {
          ctx2d.strokeStyle = stroke.replace(/[\d.]+\)$/, `${a * 0.45})`);
          ctx2d.lineWidth = 1;
          ctx2d.beginPath();
          ctx2d.arc(sw.x, sw.y, radius * 0.78, 0, Math.PI * 2);
          ctx2d.stroke();
        }
      }

      // ripple ring (subtle wavefront)
      for (const rp of ripplesRef.current) {
        const age = t - rp.bornAt;
        const radius = age * RIPPLE_SPEED;
        const a = Math.max(0, 1 - age / RIPPLE_LIFE_MS);
        ctx2d.strokeStyle = tk === 'cosmic'
          ? `rgba(180, 160, 220, ${a * 0.16})`
          : tk === 'soap'
            ? `rgba(255, 255, 255, ${a * 0.18})`
            : `rgba(180, 130, 50, ${a * 0.16})`;
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.arc(rp.x, rp.y, radius, 0, Math.PI * 2);
        ctx2d.stroke();
      }
    }

    function popAt(clientX: number, clientY: number) {
      const now = performance.now();
      if (now - lastPopAtRef.current < TAP_THROTTLE_MS) return;

      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      let best: Bubble | null = null;
      let bestD2 = HIT_RADIUS * HIT_RADIUS;
      for (const b of bubblesRef.current) {
        if (b.popped || b.growT < 0.5) continue;
        const dx = b.hx - x;
        const dy = b.hy - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = b; }
      }
      if (best) {
        best.popped = true;
        best.popT = 0;
        best.poppedAt = now;
        const a = ensureAudio(audioRef);
        if (a) {
          playPop(a, themeRef.current, now);
          // Defer the ambient pad — building it (oscillators + reverb + chord
          // cycler) on the same tick as the first pop chokes iOS audio thread,
          // which is what surfaces as "swipe-first freezes the page".
          if (!a.ambient && !ambientStartingRef.current) {
            ambientStartingRef.current = true;
            window.setTimeout(() => {
              const cur = audioRef.current;
              if (cur) startAmbient(cur, themeRef.current);
            }, 600);
          }
        }
        spawnBurst(best, now);
        lastPopAtRef.current = now;
        if (!hintHiddenRef.current) {
          hintHiddenRef.current = true;
          setHintHidden(true);
        }
      }
    }

    function pressAt(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      let best: Bubble | null = null;
      let bestD2 = HIT_RADIUS * HIT_RADIUS;
      for (const b of bubblesRef.current) {
        if (b.popped) continue;
        const dx = b.hx - x;
        const dy = b.hy - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = b; }
      }
      if (best) best.pressT = Math.min(1, best.pressT + 0.5);
    }

    // Tap-only — drag/swipe is intentionally NOT wired up. Drag fires too many
    // pointermove events too fast for iOS Safari's audio thread to keep up
    // (~5-6 in rapid succession is enough to wedge it). And the drag-sweep
    // sensation is mild compared to the satisfaction of deliberate single pops.
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      pressAt(e.clientX, e.clientY);
      popAt(e.clientX, e.clientY);
    };

    canvas.addEventListener('pointerdown', onPointerDown);

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      const a = audioRef.current;
      if (a) {
        try { a.ambient?.stop(); } catch { /* noop */ }
        try { a.ctx.close(); } catch { /* noop */ }
      }
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (a) startAmbient(a, theme);
  }, [theme]);

  return (
    <div className={`bw bw--${theme}`}>
      <canvas ref={canvasRef} className="bw__canvas" />

      <div className="bw__switcher" role="group" aria-label="Theme">
        {THEME_ORDER.map(tk => (
          <button
            key={tk}
            type="button"
            className={`bw__switcher-btn ${tk === theme ? 'is-active' : ''}`}
            onPointerDown={(e) => { e.preventDefault(); setTheme(tk); }}
            onClick={(e) => { e.preventDefault(); setTheme(tk); }}
            aria-label={tk}
            aria-pressed={tk === theme}
          >
            {tk === 'honey' && <Sun size={16} strokeWidth={1.5} />}
            {tk === 'cosmic' && <Moon size={16} strokeWidth={1.5} />}
            {tk === 'soap' && <Sparkles size={16} strokeWidth={1.5} />}
          </button>
        ))}
      </div>

      <div className={`bw__hint ${hintHidden ? 'is-hidden' : ''}`}>Tap to pop</div>
    </div>
  );
}
