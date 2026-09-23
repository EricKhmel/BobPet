/**
 * Keeps one noisy warning out of the companion's output.
 *
 * Reading Bob's record of pending approvals uses node:sqlite, which is still marked
 * experimental and announces itself on first use. That line lands in the extension's log
 * where it reads like a fault, so it is dropped; every other warning is passed through
 * untouched. Imported before anything that loads node:sqlite.
 */
const inherited = process.emitWarning.bind(process);
type Emit = typeof process.emitWarning;

const quieted: Emit = (warning: string | Error, ...rest: unknown[]): void => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (text.includes('SQLite is an experimental feature')) return;
  (inherited as (...args: unknown[]) => void)(warning, ...rest);
};

process.emitWarning = quieted;
