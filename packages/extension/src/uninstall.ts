/**
 * Takes the pet's hooks back out of Bob's settings when the extension is uninstalled.
 *
 * VS Code-compatible hosts run this with plain node, outside the editor, the next time
 * the host starts after the extension is removed. It touches only entries carrying the
 * pet's own marker and leaves every other setting exactly as it found it. Anything that
 * goes wrong here is silent on purpose: a failed cleanup must not look like a crash, and
 * a leftover hook is harmless because the hook is gone and Bob ignores what it cannot run.
 */
import { HOOK_TARGETS, applyHooks, installedPetHooks } from './hooks.js';

async function main(): Promise<void> {
  for (const target of HOOK_TARGETS) {
    const ours = await installedPetHooks(target);
    if (ours.length > 0) await applyHooks(target, undefined);
  }
}

main().catch(() => undefined);
