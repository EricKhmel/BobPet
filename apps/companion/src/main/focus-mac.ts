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

/** What the application is called on macOS, which is how the system finds it. */
const APP_NAME = 'IBM Bob';

/**
 * Where a normal install puts it, tried last.
 *
 * A name is resolved by Launch Services, which is the better thing to ask for: it finds
 * the application wherever the user keeps it. But that lookup is the one part of this
 * never confirmed on a real Mac, while activating Bob by its full path is confirmed, so
 * the usual location is worth one more attempt before telling someone to go and find it
 * themselves.
 */
const APP_PATH = `/Applications/${APP_NAME}.app`;

/**
 * Everything worth asking macOS to activate, best first: what the user chose, then the
 * name, then the usual location. Deduped, so someone who configured the usual location is
 * not asked for it twice.
 */
export const activationTargets = (configured?: string): string[] => {
  const path = configured?.trim();
  return [...new Set([...(path ? [path] : []), APP_NAME, APP_PATH])];
};

export class MacFocusAdapter implements FocusAdapter {
  warmUp(): void {
    // Nothing to warm: `open` is a system binary with no start-up cost worth paying early.
  }

  async focusConfiguredApp(target: FocusTarget = {}): Promise<FocusResult> {
    // `open -a` takes a bundle path or an application name, and macOS resolves the name
    // itself. So unlike Windows, nothing has to be configured first: what the user chose
    // wins if they chose anything, then the name, then the usual location.
    let lastSaid = '';
    for (const attempt of activationTargets(target.path)) {
      const outcome = await this.activate(attempt);
      if (outcome.ok) return outcome;
      lastSaid = outcome.message;
    }
    return { ok: false, message: lastSaid || 'Select IBM Bob to continue.' };
  }

  private activate(nameOrPath: string): Promise<FocusResult> {
    return new Promise<FocusResult>((resolve) => {
      execFile('/usr/bin/open', ['-a', nameOrPath, '--'], { timeout: ACTIVATE_TIMEOUT_MS }, (error) => {
        if (!error) return resolve({ ok: true, message: '' });
        // macOS says "Unable to find application named ..." when it cannot resolve it,
        // which is worth passing on; anything else is reported plainly.
        const said = error.message.split('\n').find((line) => line.trim()) ?? '';
        resolve({
          ok: false,
          message: said.includes('Unable to find')
            ? 'IBM Bob was not found. Set its location in Bob Pet settings.'
            : 'Select IBM Bob to continue.'
        });
      });
    });
  }

  dispose(): void {
    // No long-lived helper process to tidy up.
  }
}
