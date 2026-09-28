/**
 * Bringing IBM Bob to the front on macOS.
 *
 * `open -a` is macOS's own way of activating an application, and it is the whole job
 * here: no window enumeration, no synthetic input, no AppleScript text to be injected
 * into. The configured path is passed as an argument, never through a shell, so a path
 * containing quotes or semicolons is a path and nothing else.
 *
 * The pet's own overlay cannot be raised by mistake: `open -a` activates the application
 * the user configured, and the pet is a different application.
 */
import { execFile } from 'node:child_process';
import type { FocusAdapter, FocusResult, FocusTarget } from './focus.js';

/** macOS refuses quickly; a request that hangs longer than this is not going to succeed. */
const ACTIVATE_TIMEOUT_MS = 4_000;

export class MacFocusAdapter implements FocusAdapter {
  warmUp(): void {
    // Nothing to warm: `open` is a system binary with no start-up cost worth paying early.
  }

  async focusConfiguredApp(target: FocusTarget = {}): Promise<FocusResult> {
    const path = target.path?.trim();
    if (!path) {
      return { ok: false, message: 'Set the IBM Bob application in Bob Pet settings to use click-to-focus.' };
    }
    return new Promise<FocusResult>((resolve) => {
      execFile('/usr/bin/open', ['-a', path], { timeout: ACTIVATE_TIMEOUT_MS }, (error) => {
        if (!error) return resolve({ ok: true, message: '' });
        // macOS says "Unable to find application named ..." when the path is wrong, which
        // is worth passing on; anything else is reported plainly rather than guessed at.
        const said = error.message.split('\n').find((line) => line.trim()) ?? '';
        resolve({ ok: false, message: said.includes('Unable to find') ? 'IBM Bob was not found at the configured path.' : 'Select IBM Bob to continue.' });
      });
    });
  }

  dispose(): void {
    // No long-lived helper process to tidy up.
  }
}
