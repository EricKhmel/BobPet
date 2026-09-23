/**
 * The pet's arrival: it drops in from the top of the screen and bounces to a stop.
 *
 * One timeline drives both halves of it, so they stay in step: the main process moves the
 * window down by `rise` (the window is only as tall as the pet, so the fall cannot be
 * drawn inside it), and the renderer squashes the character on each landing.
 *
 * Gravity is constant, so how long the fall takes follows how far it is - a pet halfway
 * down the screen arrives sooner than one near the bottom - and each bounce keeps a
 * fraction of the speed it landed with. Distances are screen pixels above the resting
 * place, which is where the pet was before it dropped in.
 */

/** Screen pixels per millisecond squared: a fall from the top of a 1080p screen takes ~0.7s. */
const GRAVITY = 0.0037;
/** Fraction of the landing speed a bounce gives back. */
const BOUNCE = 0.42;
const BOUNCES = 3;
/** How long a landing's squash takes to spring back. */
const SQUASH_MS = 130;
const MAX_SQUASH = 0.22;
/** The fall that squashes him as far as he goes; shorter ones squash proportionally less. */
const FULL_SQUASH_FALL = 420;

const fallMs = (height: number): number => Math.sqrt((2 * Math.max(0, height)) / GRAVITY);

/** The whole arrival, from released to standing still, for a fall of `height` pixels. */
export const dropDuration = (height: number): number =>
  fallMs(height) * (1 + 2 * (BOUNCE + BOUNCE ** 2 + BOUNCE ** 3));

export type Drop = { rise: number; squash: number };

/** Where the pet is, and how squashed, `ms` into a drop-in from `height` pixels up. */
export function dropIn(ms: number, height: number): Drop {
  const fall = fallMs(height);
  if (ms < 0) return { rise: height, squash: 0 };
  if (fall === 0 || ms >= dropDuration(height)) return { rise: 0, squash: 0 };

  // How hard the first landing is, against the fall that earns a full squash.
  const impact = Math.min(1, fall / fallMs(FULL_SQUASH_FALL));
  let rise = 0;
  let landedAt = -Infinity;
  let landingBounce = 1;
  if (ms < fall) {
    rise = height - 0.5 * GRAVITY * ms * ms;
  } else {
    let remaining = ms - fall;
    landedAt = fall;
    let speed = GRAVITY * fall * BOUNCE;
    for (let i = 0; i < BOUNCES; i += 1) {
      const airborne = (2 * speed) / GRAVITY;
      if (remaining < airborne) {
        rise = speed * remaining - 0.5 * GRAVITY * remaining * remaining;
        break;
      }
      remaining -= airborne;
      landedAt += airborne;
      landingBounce = BOUNCE ** (i + 1);
      speed *= BOUNCE;
    }
  }

  // A landing squashes him by how hard he hit, and he springs back out of it.
  const since = ms - landedAt;
  const squash = since >= 0 && since < SQUASH_MS
    ? MAX_SQUASH * impact * landingBounce * (1 - since / SQUASH_MS)
    : 0;
  return { rise: Math.max(0, rise), squash };
}
