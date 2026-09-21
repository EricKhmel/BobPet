/**
 * Window geometry for the pet and its speech bubble.
 *
 * The window is one fixed size: wide enough for the bubble and tall enough for the pet,
 * its headroom and the longest bubble. It never resizes while the pet talks, because
 * Windows shows a transparent window's old frame stretched or shifted until the renderer
 * catches up, which made the pet blink whenever a line appeared, changed or went away.
 * The bubble is shown and hidden in the page instead, and the clear parts of the window
 * let the mouse through (see main.ts), so the extra room costs nothing.
 *
 * The pet sits centred along the top. Saved positions are the pet's own top-left, not the
 * window's, so the pet stays put when its size changes.
 */
import { petHeightFor } from '@bob-pet/shared';

export const BUBBLE_WIDTH = 208;
export const BUBBLE_GAP = 6;
export const BUBBLE_BASE_HEIGHT = 46;
export const BUBBLE_LINE_HEIGHT = 13;
/** Longer lines are clipped with an ellipsis rather than growing the window. */
export const BUBBLE_MAX_LINES = 4;

/** `since` is when the step being described began, for the bubble's timer. */
export type Bubble = { text: string; since?: number };
export type Layout = { width: number; height: number; petLeft: number; petHeight: number };

export function layoutFor(petSize: number): Layout {
  const petHeight = petHeightFor(petSize);
  const width = Math.max(petSize, BUBBLE_WIDTH);
  const bubbleHeight = BUBBLE_BASE_HEIGHT + (BUBBLE_MAX_LINES - 1) * BUBBLE_LINE_HEIGHT;
  return { width, height: petHeight + BUBBLE_GAP + bubbleHeight, petLeft: Math.round((width - petSize) / 2), petHeight };
}

/** Where the window goes so the pet's own box lands at `pet`. */
export const windowOrigin = (pet: { x: number; y: number }, layout: Layout): { x: number; y: number } =>
  ({ x: pet.x - layout.petLeft, y: pet.y });

/** Where the pet's own box is, given the window's origin. */
export const petOrigin = (window: { x: number; y: number }, layout: Layout): { x: number; y: number } =>
  ({ x: window.x + layout.petLeft, y: window.y });
