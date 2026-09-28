import type { FocusAdapter, FocusResult, FocusTarget } from './focus.js';

/**
 * The stand-in for platforms the pet cannot raise a window on yet.
 *
 * It says so rather than pretending: a click still reaches the pet, and the pet tells the
 * user to select IBM Bob themselves. Linux lands here until a desktop-specific adapter
 * exists, because there is no way to do this that works across X11 and Wayland alike.
 */
export class UnsupportedFocusAdapter implements FocusAdapter {
  warmUp(): void {}

  async focusConfiguredApp(_target: FocusTarget = {}): Promise<FocusResult> {
    return { ok: false, message: 'Select IBM Bob to continue.' };
  }

  dispose(): void {}
}
