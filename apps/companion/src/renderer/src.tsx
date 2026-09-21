import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PetState, StoredSettings } from '@bob-pet/shared';
import { PET_GRID_ROWS, PET_HEADROOM_ROWS, PET_SCALES, STILL_RUNNING_MS, defaultSettings, formatElapsed, petHeightFor } from '@bob-pet/shared';
import './style.css';

type Pixel = [number, number, number, number, string];
const fill = (x: number, y: number, w: number, h: number, color: string): Pixel => [x, y, w, h, color];

const INK = '#161616';
const WHITE = '#ffffff';
const SHADE = '#f4f4f4';
const GREY = '#e0e0e0';
const CODE_BLUE = '#0f62fe';

/**
 * The hard hat, traced from the reference: its head (163px wide) scaled onto the pet's
 * 33 columns, the brim ending three rows above the eyes as it does there, and mirrored
 * about the centre column. `#` is outline, `o` is shell, `.` is left clear.
 *
 * What the reference draws is a raised centre crest - its two edges are the pair of
 * vertical lines, and its flat top is the crown - with the shell's shoulders meeting it a
 * few rows down, a line across the front that dips at both ends, and a flared brim below.
 */
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const HAT_LEFT = 12;
const HAT_TOP = 1;
const HAT: readonly string[] = [
  '................#########................',
  '...............##ooooooo##...............',
  '.............####ooooooo####.............',
  '...........###oo#ooooooo#oo###...........',
  '..........##oooo#ooooooo#oooo##..........',
  '.........##ooooo#ooooooo#ooooo##.........',
  '........##oooooo#ooooooo#oooooo##........',
  '.......##ooooooo#ooooooo#ooooooo##.......',
  '......##oooooooo#ooooooo#oooooooo##......',
  '......#ooooooooo#ooooooo#ooooooooo#......',
  '.....##ooooooooo#ooooooo#ooooooooo##.....',
  '.....#oooooooooo#ooooooo#oooooooooo#.....',
  '....##ooooooooooooooooooooooooooooo##....',
  '....#ooooooooooooooooooooooooooooooo#....',
  '....#ooooooooooooooooooooooooooooooo#....',
  '....#oooo#######################oooo#....',
  '...##ooo###ooooooooooooooooooo###ooo##...',
  '..##ooooooooooooooooooooooooooooooooo##..',
  '.#ooooooooooooooooooooooooooooooooooooo#.',
  '.#ooooooooooooooooooooooooooooooooooooo#.',
  '..#####################################..',
];

/**
 * The reference's shell is a diagonal gradient, #0f62fe at the top left to #a56eff at the
 * brim's bottom right. The plane is a least-squares fit to 440 cells sampled from it.
 */
const HAT_FROM = [15, 98, 254];
const HAT_TO = [165, 110, 255];
const hatColor = (x: number, row: number): string => {
  const t = clamp(0.0309 * x + 0.0269 * row - 0.9777, 0, 1);
  const [r, g, b] = HAT_FROM.map((from, i) => Math.round(from + (HAT_TO[i] - from) * t));
  return `rgb(${r},${g},${b})`;
};

/**
 * Hammer head, as (offset along the long axis from the eye where the handle enters,
 * half-width of the ink outline). A short clawed end behind the eye and a flared face
 * in front of it are what read as a hammer rather than an axe or a mallet.
 */
const HAMMER_HEAD: [number, number][] = [[-3, 1], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2], [3, 3], [4, 3], [5, 2]];
const HAMMER_CLAW = -3;
const HAMMER_FACE = 4;
const HAMMER_STEEL = '#dde1e6';
const HAMMER_LIT = '#78a9ff';
const HAMMER_HAFT = '#6929c4';
const HAMMER_HAFT_LIT = '#a56eff';

export type Motion = { dragging: boolean; vx: number; vy: number; sinceRelease: number };
const STILL: Motion = { dragging: false, vx: 0, vy: 0, sinceRelease: -1 };

const CENTRE = 32;
const CROWN = HAT_TOP;
const BASELINE = 62;

/** Land, overshoot into a slight stretch, then settle. Zero outside the window. */
function releaseSquash(ms: number): number {
  if (ms < 0 || ms > 260) return 0;
  if (ms < 90) return (ms / 90) * 0.12;
  if (ms < 180) return 0.12 - ((ms - 90) / 90) * 0.18;
  return -0.06 + ((ms - 180) / 80) * 0.06;
}

/**
 * Whole-body lean and squash, applied to the finished pixel list.
 *
 * The lean shears rows further from the feet by more, so the pet tips like something
 * held rather than sliding sideways - which also buys the hard hat the headroom it
 * needs, since the crown swings aside as it rises.
 */
function posePixels(list: Pixel[], lean: number, squash: number): Pixel[] {
  if (lean === 0 && squash === 0) return list;
  const scaleY = 1 - squash;
  const scaleX = 1 + squash * 0.6;
  return list.map(([x, y, w, h, color]): Pixel => {
    const shear = lean * clamp((BASELINE - (y + h / 2)) / (BASELINE - CROWN), 0, 1);
    const top = Math.round(BASELINE - (BASELINE - y) * scaleY);
    const bottom = Math.round(BASELINE - (BASELINE - (y + h)) * scaleY);
    const left = Math.round(CENTRE + (x - CENTRE) * scaleX + shear);
    const right = Math.round(CENTRE + (x + w - CENTRE) * scaleX + shear);
    return [left, top, Math.max(1, right - left), Math.max(1, bottom - top), color];
  });
}

/**
 * Original pixel rendering of the reference character on a fixed 64x64 design grid
 * (drawn below PET_HEADROOM_ROWS of clear canvas).
 *
 * Layout, all symmetric about x = 32:
 *   rows  1-21  hard hat, traced from the reference: centre crest, shoulders, flared brim
 *   rows 27-34  ear nubs, drawn behind the head so only the outer half shows
 *   rows 19-41  head: rounded chassis, 7px eyes, small curved smile
 *   rows 42-61  body: grey shoulder blobs behind a white `</>` plaque
 */
function pixels(state: PetState, tick: number, motion: Motion = STILL): Pixel[] {
  const p: Pixel[] = [];
  const add = (x: number, y: number, w: number, h: number, c: string): void => {
    p.push(fill(x, y, w, h, c));
  };

  /** Rows shrink near the ends by a circular arc, which keeps corners round instead of stepped. */
  const inset = (row: number, h: number, r: number): number => {
    const edge = Math.min(row, h - 1 - row);
    return edge < r ? r - Math.round(Math.sqrt(Math.max(0, r * r - (r - edge) * (r - edge)))) : 0;
  };
  const rrect = (x: number, y: number, w: number, h: number, r: number, color: string): void => {
    for (let row = 0; row < h; row += 1) {
      const i = inset(row, h, r);
      add(x + i, y + row, w - i * 2, 1, color);
    }
  };
  /**
   * Hammer head along its long axis, centred on (cx, cy): down the screen with the face
   * at the bottom when `vertical`, otherwise rightward with the face on the right. The
   * handle enters at the eye, which is the centre, so it is drawn first and covered here.
   */
  const hammerHead = (cx: number, cy: number, vertical: boolean): void => {
    /** One rung across the head, `half` either side of the long axis. */
    const rung = (along: number, half: number, color: string): void => {
      if (vertical) add(cx - half, cy + along, half * 2 + 1, 1, color);
      else add(cx + along, cy - half, 1, half * 2 + 1, color);
    };
    /** A single cell, `side` out from the long axis. */
    const cell = (along: number, side: number, color: string): void => {
      if (vertical) add(cx + side, cy + along, 1, 1, color);
      else add(cx + along, cy + side, 1, 1, color);
    };
    for (const [along, half] of HAMMER_HEAD) {
      // The claw is drawn as two prongs, since nothing here can erase a filled rung.
      if (along === HAMMER_CLAW) { cell(along, -half, INK); cell(along, half, INK); }
      else rung(along, half, INK);
    }
    for (const [along, half] of HAMMER_HEAD) if (along > HAMMER_CLAW) rung(along, half - 1, CODE_BLUE);
    // Lit from the upper left, so the leading edge catches and the far side stays dark.
    for (const [along, half] of HAMMER_HEAD) if (along > HAMMER_CLAW) cell(along, -(half - 1), HAMMER_LIT);
    // Hardened steel on the face, the end that meets the anvil.
    rung(HAMMER_FACE, 2, HAMMER_STEEL);
  };
  const disc = (cx: number, cy: number, r: number, color: string): void => {
    for (let dy = -r; dy <= r; dy += 1) {
      const span = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
      add(cx - span, cy + dy, span * 2 + 1, 1, color);
    }
  };
  const line = (x0: number, y0: number, x1: number, y1: number, color: string, size = 2): void => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i += 1) {
      const t = steps === 0 ? 0 : i / steps;
      add(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), size, size, color);
    }
  };
  /** A pixel 'Z': top bar, diagonal, bottom bar. */
  const zed = (x: number, top: number, size: number, color: string): void => {
    add(x, top, size, 1, color);
    for (let i = 1; i < size - 1; i += 1) add(x + size - 1 - i, top + i, 1, 1, color);
    add(x, top + size - 1, size, 1, color);
  };
  /** sign +1 draws '<' (arms opening right), -1 draws '>'. */
  const chevron = (tipX: number, tipY: number, sign: number, size: number, color: string): void => {
    for (let i = 0; i < size; i += 1) {
      add(tipX + sign * i, tipY - i, 2, 1, color);
      add(tipX + sign * i, tipY + i, 2, 1, color);
    }
  };

  // State-specific movement / offsets
  const idleHover = state === 'IDLE' ? Math.round(Math.sin((tick / 1700) * Math.PI * 2) * 1.5) : 0;
  const jump = state === 'CELEBRATING' ? -Math.round(Math.abs(Math.sin(tick / 180)) * 4) : 0;
  const thinkOffset = state === 'THINKING' ? Math.round(Math.sin(tick / 300) * 1) : 0;
  const breathe = state === 'SLEEPING' ? Math.round(Math.sin(tick / 1500)) : 0;
  const sleepSlump = state === 'SLEEPING' ? 2 + breathe : 0;
  const focusLean = state === 'FOCUS' ? 1 : 0;

  // Prop timing, shared between the pose and the props themselves.
  const workFrame = state === 'WORKING' ? Math.floor(tick / 180) % 3 : -1;
  const typing = state === 'FOCUS' && Math.floor(tick / 150) % 2 === 0;
  // The pet dips on the hammer strike, so the blow reads as its own.
  const workRecoil = workFrame === 2 ? 1 : 0;
  const shoulderL = state === 'CELEBRATING' ? -2 : state === 'FOCUS' && !typing ? -1 : 0;
  const shoulderR = state === 'CELEBRATING' ? -2 : workFrame === 0 ? -2 : state === 'FOCUS' && typing ? -1 : 0;

  // Being carried. One velocity vector drives every part, so they read as one character
  // rather than as separate effects. Dropping the body also clears room for the hat.
  const hauling = motion.dragging;
  const speed = Math.hypot(motion.vx, motion.vy);
  const hatLift = hauling ? Math.round(clamp(speed * 0.5, 0, 5)) : 0;
  const hatTilt = hauling ? clamp(motion.vx * 0.14, -2, 2) : 0;
  const eyeShift = hauling ? Math.round(clamp(motion.vx * 0.3, -2, 2)) : 0;
  const lean = hauling ? clamp(motion.vx * 0.3, -4, 4) : 0;
  const bodyDrop = hauling ? 2 : 0;
  // Trailing edge rises furthest, as though the wind were getting under the brim.
  const hatRise = (x: number): number => Math.round((hatTilt * (x - CENTRE)) / 18) - hatLift;

  const y = idleHover + jump + thinkOffset + sleepSlump + focusLean + bodyDrop + workRecoil;

  // A blink that dips, closes, then reopens reads as a lid rather than a flicker.
  const blinkAt = state === 'IDLE' ? tick % 4000 : -1;
  const blink = blinkAt < 0 || blinkAt > 220 ? 0 : blinkAt < 70 ? 1 : blinkAt < 150 ? 2 : 1;
  const isEyesClosed = state === 'SLEEPING' || blink === 2;
  const isEyesHalf = blink === 1;

  // Where the eyes point: the drag direction, plus an occasional idle glance and a
  // per-state bias, so he looks up while thinking and down at the laptop while focused.
  const glanceAt = state === 'IDLE' ? tick % 5200 : -1;
  const idleGlance = glanceAt < 0 ? 0 : glanceAt < 380 ? -1 : glanceAt < 760 ? 1 : 0;
  const eyeDX = eyeShift + idleGlance + (state === 'THINKING' ? Math.round(Math.sin(tick / 900)) : 0);
  const eyeDY = state === 'THINKING' ? -1 : state === 'FOCUS' ? 1 : 0;

  // --- 1. EAR NUBS (behind the head; only the outer half stays visible) ---
  rrect(12, 27 + y, 6, 8, 2, INK);
  rrect(13, 28 + y, 4, 6, 1, GREY);
  rrect(14, 29 + y, 2, 4, 1, SHADE);
  rrect(47, 27 + y, 6, 8, 2, INK);
  rrect(48, 28 + y, 4, 6, 1, GREY);
  rrect(49, 29 + y, 2, 4, 1, SHADE);

  // --- 2. HEAD CHASSIS ---
  rrect(16, 19 + y, 33, 23, 6, INK);
  rrect(18, 21 + y, 29, 19, 5, WHITE);
  rrect(20, 38 + y, 25, 2, 1, SHADE);

  // --- 3. HARD HAT ---
  HAT.forEach((line, i) => {
    const row = HAT_TOP + i;
    for (let col = 0; col < line.length; col += 1) {
      const cell = line[col];
      if (cell === '.') continue;
      const x = HAT_LEFT + col;
      add(x, row + y + hatRise(x), 1, 1, cell === '#' ? INK : hatColor(x, row));
    }
  });

  // THINKING sweeps a highlight along the brim
  if (state === 'THINKING') {
    const sweepX = 14 + (Math.floor(tick / 110) % 18) * 2;
    add(sweepX, 19 + y + hatRise(sweepX), 3, 2, '#bcd4ff');
  }

  // --- 4. EYES ---
  const eyeTop = 25 + y + eyeDY;
  if (isEyesClosed) {
    // Lids curve rather than sitting flat, which reads as shut instead of blanked out.
    for (const left of [22 + eyeDX, 36 + eyeDX]) {
      add(left + 1, eyeTop + 3, 5, 1, INK);
      add(left, eyeTop + 4, 7, 1, INK);
    }
  } else if (isEyesHalf) {
    for (const left of [22 + eyeDX, 36 + eyeDX]) {
      add(left, eyeTop + 2, 7, 4, INK);
      add(left, eyeTop + 2, 7, 1, SHADE);
    }
  } else if (state === 'CELEBRATING') {
    // Four-point sparkle, tapered so it reads as a star and not a plus sign.
    for (const cx of [25 + eyeDX, 39 + eyeDX]) {
      add(cx - 1, eyeTop, 3, 7, INK);
      add(cx - 3, eyeTop + 2, 7, 3, INK);
      add(cx, eyeTop - 1, 1, 9, INK);
      add(cx - 4, eyeTop + 3, 9, 1, INK);
      add(cx, eyeTop + 2, 1, 3, WHITE);
      add(cx - 1, eyeTop + 3, 3, 1, WHITE);
    }
  } else {
    rrect(22 + eyeDX, eyeTop, 7, 7, 1, INK);
    rrect(36 + eyeDX, eyeTop, 7, 7, 1, INK);
    add(26 + eyeDX, eyeTop + 2, 2, 2, WHITE);
    add(40 + eyeDX, eyeTop + 2, 2, 2, WHITE);
  }

  // --- 5. SMALL CURVED SMILE ---
  if (state === 'SLEEPING') {
    add(30, 34 + y, 4, 2, INK);
    add(31, 35 + y, 2, 1, SHADE);
  } else if (state === 'CELEBRATING') {
    // A round open mouth: corners clipped rather than a hard rectangle.
    rrect(29, 32 + y, 7, 6, 1, INK);
  } else {
    add(29, 34 + y, 1, 1, INK);
    add(35, 34 + y, 1, 1, INK);
    add(30, 35 + y, 1, 1, INK);
    add(34, 35 + y, 1, 1, INK);
    add(31, 36 + y, 3, 1, INK);
  }

  // --- 6. SHOULDER BLOBS (behind the plaque, peeking out either side) ---
  rrect(12, 42 + y + shoulderL, 16, 18, 6, INK);
  rrect(14, 44 + y + shoulderL, 12, 14, 5, GREY);
  rrect(15, 46 + y + shoulderL, 6, 8, 3, SHADE);
  rrect(37, 42 + y + shoulderR, 16, 18, 6, INK);
  rrect(39, 44 + y + shoulderR, 12, 14, 5, GREY);
  rrect(44, 46 + y + shoulderR, 6, 8, 3, SHADE);

  // --- 7. CHEST PLAQUE WITH `</>` ---
  rrect(19, 41 + y, 27, 20, 4, INK);
  rrect(21, 43 + y, 23, 16, 3, WHITE);

  chevron(23, 50 + y, 1, 5, CODE_BLUE);
  chevron(40, 50 + y, -1, 5, CODE_BLUE);
  for (let i = 0; i < 9; i += 1) {
    add(30 + Math.round(i * 0.375), 54 + y - i, 2, 1, CODE_BLUE);
  }

  // --- STATE-SPECIFIC PARTICLES & PROPS ---
  // Props are drawn at absolute coordinates, not offset by `y`, so they stay planted
  // while the pet bobs, recoils or breathes against them.

  // WORKING: a three-frame swing whose handle runs back to the pet's own hand.
  if (state === 'WORKING') {
    // Anvil, stood in front of the pet rather than squeezed into the corner, and kept
    // clear of the `</>` so the swing never cuts through the glyph.
    add(42, 52, 21, 3, INK);
    add(43, 53, 19, 1, '#8d8d8d');
    add(49, 55, 7, 3, INK);
    add(50, 56, 5, 1, '#525252');
    add(44, 58, 17, 4, INK);
    add(45, 59, 15, 2, '#6f6f6f');

    // The head sits across the end of the handle, so it turns with the swing: laid flat
    // at the top of the wind-up, stood on end through the drop and the strike.
    const [hx, hy, upright] = [[55, 25, 0], [58, 36, 1], [57, 45, 1]][workFrame];
    // The handle runs back to the pet's hand, so the swing belongs to the character.
    line(46, 46 + shoulderR, hx, hy, HAMMER_HAFT);
    line(46, 46 + shoulderR, hx, hy, HAMMER_HAFT_LIT, 1);
    hammerHead(hx, hy, upright === 1);

    if (workFrame === 2) {
      add(43, 51, 19, 1, '#f1c21b');
      for (let i = 0; i < 7; i += 1) {
        const sparkY = 50 - ((tick / 35 + i * 2) % 8);
        const sparkX = 43 + i * 3 + Math.sin(tick / 50 + i) * 2;
        add(Math.round(sparkX), Math.round(sparkY), 1, 1, i % 2 === 0 ? '#f1c21b' : '#ff832b');
      }
    }
  }

  // THINKING: a highlight sweeping the brim, and thought dots swelling in sequence.
  if (state === 'THINKING') {
    const cycle = tick % 2100;
    const dots: [number, number, number, number][] = [[53, 28, 3, 0], [56, 22, 4, 450], [58, 15, 5, 900]];
    for (const [dx, dy, size, at] of dots) {
      if (cycle < at || cycle > 1800) continue;
      const alpha = cycle > 1500 ? (1800 - cycle) / 300 : 1;
      add(dx, dy, size, size, `rgba(120,169,255,${alpha.toFixed(2)})`);
      add(dx, dy, size, 1, `rgba(255,255,255,${(alpha * 0.55).toFixed(2)})`);
    }
  }

  // CELEBRATING: confetti of mixed shapes, falling and swaying rather than drifting.
  if (state === 'CELEBRATING') {
    const colors = ['#da1e28', '#24a148', CODE_BLUE, '#f1c21b', '#8a3ffc', '#ff832b'];
    for (let i = 0; i < 10; i += 1) {
      const cy = Math.round(((tick / 26 + i * 13) % 74) - 8);
      if (cy < -1 || cy > 62) continue;
      const cx = Math.round(3 + i * 6 + Math.sin(tick / 220 + i * 1.7) * 3);
      const spin = Math.floor(tick / 90 + i) % 3;
      add(cx, cy, spin === 0 ? 3 : 2, spin === 2 ? 3 : 2, colors[i % colors.length]);
    }
  }

  // SLEEPING: three Zs, each rising, swelling and fading on its own stagger.
  if (state === 'SLEEPING') {
    const cycle = tick % 3600;
    const zs: [number, number, number, number, string][] = [
      [50, 27, 4, 0, '15,98,254'],
      [54, 21, 5, 1200, '69,137,255'],
      [57, 14, 6, 2400, '138,63,252']
    ];
    for (const [zx, zTop, size, at, rgb] of zs) {
      const age = (cycle - at + 3600) % 3600;
      if (age > 1600) continue;
      const alpha = age < 200 ? age / 200 : age > 1200 ? (1600 - age) / 400 : 1;
      zed(zx, zTop - Math.round((age / 1600) * 8), size, `rgba(${rgb},${alpha.toFixed(2)})`);
    }
  }

  // FOCUS: a laptop with code scrolling up the screen, and its glow on the pet's chin.
  if (state === 'FOCUS') {
    add(23, 38 + y, 19, 2, 'rgba(120,169,255,0.16)');

    add(19, 46, 26, 13, INK);
    add(21, 48, 22, 9, '#262626');
    const widths = [13, 7, 16, 9];
    const tints = ['#24a148', '#78a9ff', '#8d8d8d', '#f1c21b'];
    for (let i = 0; i < 4; i += 1) {
      add(22, 49 + ((i + Math.floor(tick / 320)) % 4) * 2, widths[i], 1, tints[i]);
    }

    add(15, 59, 34, 4, INK);
    add(17, 60, 30, 2, '#393939');
    for (let k = 0; k < 7; k += 1) {
      add(19 + k * 4, 61, 2, 1, (Math.floor(tick / 120) + k) % 4 === 0 ? '#24a148' : '#8d8d8d');
    }
  }

  return posePixels(p, lean, releaseSquash(motion.sinceRelease));
}

// Synthesized Web Audio API sound (no external audio assets)
let audioCtx: AudioContext | null = null;
function playClink(muted: boolean): void {
  if (muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
  } catch {
    // Gracefully ignore audio errors
  }
}

/**
 * Pixel rendering designed from refpic:
 * - Hard hat / helmet: blue (#0f62fe) to purple (#8a3ffc) gradient, central ridge, brim with dark outline.
 * - Ear bolts / side nodes: cylindrical grey/white on left and right of head.
 * - Head: smooth white rounded robot chassis with Carbon dark outline (#161616) and inner shade (#f4f4f4).
 * - Big cute round dark eyes with bright white specular highlights.
 * - Cute smile mouth.
 * - Chest / Plaque: white rounded rectangular display showing blue Carbon `</>` glyph.
 * - Robot arms & rounded body frame holding the plaque.
 */
/** How long one animation dissolves into the next. */
const BUBBLE_FADE_MS = 180;
const CROSSFADE_MS = 280;

/** Draws one frame's pixels, below the headroom, onto a 64-column canvas. */
function paint(context: CanvasRenderingContext2D, list: Pixel[]): void {
  context.clearRect(0, 0, 64, PET_GRID_ROWS);
  for (const [x, y, w, h, color] of list) {
    context.fillStyle = color;
    // The design is drawn on 64 rows; the headroom sits above it, clear for the hat.
    context.fillRect(Math.round(x), Math.round(y) + PET_HEADROOM_ROWS, Math.round(w), Math.round(h));
  }
}

function offscreen(): CanvasRenderingContext2D | null {
  const surface = document.createElement('canvas');
  surface.width = 64;
  surface.height = PET_GRID_ROWS;
  return surface.getContext('2d');
}

function Robot({ state, paused, muted, motion }: { state: PetState; paused: boolean; muted: boolean; motion: Motion }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  const lastWorkingFrame = useRef<number>(-1);
  // The state being left and when, so a change dissolves over a few frames instead of
  // snapping - props, poses and eyes all swapping in one frame read as a blink.
  const leaving = useRef<{ state: PetState; at: number } | null>(null);
  const current = useRef(state);
  if (current.current !== state) {
    leaving.current = { state: current.current, at: performance.now() };
    current.current = state;
  }
  const layers = useRef<{ from: CanvasRenderingContext2D | null; to: CanvasRenderingContext2D | null } | null>(null);

  const settling = motion.sinceRelease >= 0 && performance.now() - motion.sinceRelease < 300;
  useEffect(() => {
    if (paused || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const loop = (now: number) => {
      setTick(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused, motion.dragging, settling]);

  useEffect(() => {
    // Clink sound on frame 2 of working
    if (state === 'WORKING' && !paused) {
      const frame = Math.floor(tick / 180) % 3;
      if (frame === 2 && lastWorkingFrame.current !== 2) {
        playClink(muted);
      }
      lastWorkingFrame.current = frame;
    }
  }, [state, tick, paused, muted]);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    // Reduced motion and a paused pet both get the resting pose: the lean is direct
    // feedback, but the landing squash is a spring, and neither should surprise anyone.
    const calm = paused || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pose: Motion = calm
      ? STILL
      : { ...motion, sinceRelease: motion.sinceRelease < 0 ? -1 : performance.now() - motion.sinceRelease };

    // Without the animation loop nothing would advance the dissolve, so it is skipped.
    const age = leaving.current ? performance.now() - leaving.current.at : Infinity;
    if (calm || age >= CROSSFADE_MS) {
      leaving.current = null;
      paint(context, pixels(state, tick, pose));
      return;
    }
    layers.current ??= { from: offscreen(), to: offscreen() };
    const { from, to } = layers.current;
    if (!from || !to || !leaving.current) {
      paint(context, pixels(state, tick, pose));
      return;
    }
    // Both frames keep animating, and they are summed rather than stacked: where both are
    // opaque the pet stays solid and only what differs dissolves.
    const t = age / CROSSFADE_MS;
    const mix = t * t * (3 - 2 * t);
    paint(from, pixels(leaving.current.state, tick, pose));
    paint(to, pixels(state, tick, pose));
    context.clearRect(0, 0, 64, PET_GRID_ROWS);
    context.globalAlpha = 1 - mix;
    context.drawImage(from.canvas, 0, 0);
    context.globalCompositeOperation = 'lighter';
    context.globalAlpha = mix;
    context.drawImage(to.canvas, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    // motion is a dependency so the pose still updates when the loop is paused.
  }, [state, tick, motion, paused]);

  return <canvas ref={canvas} width="64" height={PET_GRID_ROWS} aria-label={`Bob Pet is ${state.toLowerCase()}`} />;
}

/**
 * How long the current step has been running, once it is long enough to be worth saying.
 * It ticks here rather than in the main process so the line itself never re-renders.
 */
function Elapsed({ since }: { since: number }): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const ms = now - since;
  if (ms < STILL_RUNNING_MS) return null;
  return <span className="elapsed">{formatElapsed(ms)}</span>;
}

function App(): React.JSX.Element {
  const [settings, setSettings] = useState<StoredSettings>(defaultSettings());
  const [state, setState] = useState<PetState>('IDLE');
  const [notice, setNotice] = useState('');
  const [motion, setMotion] = useState<Motion>(STILL);
  const [bubble, setBubble] = useState<{ text: string; since?: number } | null>(null);
  // The last line stays mounted while it fades out, so it leaves rather than vanishes.
  const [shownBubble, setShownBubble] = useState<{ text: string; since?: number } | null>(null);
  const [petBox, setPetBox] = useState({ left: 0, size: 64 });

  useEffect(() => {
    if (bubble) {
      setShownBubble(bubble);
      return;
    }
    const timer = window.setTimeout(() => setShownBubble(null), BUBBLE_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [bubble]);

  useEffect(() => {
    // The window keeps room for the bubble at all times, and that room must not block
    // what is behind it: the mouse passes through unless it is over the pet, its chip or
    // its words. Only changes are reported, since this runs on every mouse move.
    let over: boolean | undefined;
    const report = (next: boolean): void => {
      if (next === over) return;
      over = next;
      window.bobPet.hit(next);
    };
    const move = (event: MouseEvent): void => {
      // A held button is a drag in progress: it keeps the mouse until it is released.
      if (event.buttons !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      report(Boolean(target?.closest('.click-target, .scale, .bubble')));
    };
    const leave = (): void => report(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseleave', leave);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseleave', leave);
    };
  }, []);

  useEffect(() => {
    // The window opens at the saved scale, but nothing lays the pet out until the first
    // bubble, so without this he drew at 64px in the corner of a bigger window. Size from
    // settings instead; a bubble update still sets where he sits across the window.
    const adopt = (loaded: StoredSettings): void => {
      setSettings(loaded);
      const size = PET_SCALES[loaded.scale].pixels;
      // The pet is centred along the top of the window, which is sized in the main process.
      setPetBox({ left: Math.round((window.innerWidth - size) / 2), size });
    };
    void window.bobPet.settings().then(adopt);
    window.bobPet.onState(setState);
    window.bobPet.onSettings(adopt);
    window.bobPet.onNotice((message) => {
      setNotice(message);
      window.setTimeout(() => setNotice(''), 3500);
    });
    window.bobPet.onBubble(({ bubble: next, petLeft, petSize }) => {
      setBubble(next);
      setPetBox({ left: petLeft, size: petSize });
    });
    window.bobPet.onDrag(({ dragging, vx, vy }) => {
      // sinceRelease holds the drop timestamp; the renderer turns it into an age.
      setMotion((previous) => ({
        dragging,
        vx,
        vy,
        sinceRelease: dragging ? -1 : previous.dragging ? performance.now() : previous.sinceRelease
      }));
    });
  }, []);

  const cycleScale = (): void => {
    const keys = Object.keys(PET_SCALES) as (keyof typeof PET_SCALES)[];
    const target = keys[(keys.indexOf(settings.scale) + 1) % keys.length];
    void window.bobPet.setScale(target);
  };

  return (
    <main
      onContextMenu={(event) => {
        event.preventDefault();
        void window.bobPet.menu();
      }}
    >
      <div className="stage" style={{ left: petBox.left, width: petBox.size, height: petHeightFor(petBox.size) }}>
        {/* One surface handles both gestures. A draggable region would swallow mouse
            events entirely, so the window is moved from the main process instead and
            the press only counts as a click if it never became a drag. */}
        <button
          type="button"
          className="click-target"
          aria-label="Focus IBM Bob"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            void window.bobPet.dragStart();
          }}
          onPointerUp={(event) => {
            if (event.button !== 0) return;
            const target = event.currentTarget;
            if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
            void window.bobPet.dragEnd().then((dragged) => {
              if (!dragged) void window.bobPet.focus();
            });
          }}
          onPointerCancel={() => {
            void window.bobPet.dragEnd();
          }}
          onClick={(event) => {
            // detail 0 means keyboard activation; pointer presses resolve in onPointerUp.
            if (event.detail === 0) void window.bobPet.focus();
          }}
        />
        <div className="pet" aria-label="Bob Pet">
          <Robot state={state} paused={settings.paused} muted={settings.muted} motion={motion} />
        </div>
        <button
          className="scale"
          onClick={(e) => {
            e.stopPropagation();
            cycleScale();
          }}
          aria-label="Cycle pet size"
        >
          {PET_SCALES[settings.scale].label}
        </button>
        {notice && <output role="status">{notice}</output>}
      </div>
      {shownBubble && (
        <aside className={bubble ? 'bubble' : 'bubble leaving'} style={{ top: petHeightFor(petBox.size) - 4 }}>
          {/* The tail sits under the pet's mouth, so the line reads as his. */}
          <span className="tail" style={{ left: petBox.left + petBox.size / 2 - 6 }} />
          {/* Keyed on the text, so each new line fades in over the last instead of snapping. */}
          <p role="status" key={shownBubble.text}>
            {shownBubble.text}
            {shownBubble.since !== undefined && <Elapsed since={shownBubble.since} />}
          </p>
        </aside>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
