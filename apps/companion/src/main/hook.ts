/**
 * The command IBM Bob runs for each hook event.
 *
 * Contract, from Bob's own hook documentation:
 * - one JSON object arrives on stdin, carrying `hook_event_name` and event fields
 * - stdout on SessionStart and UserPromptSubmit is injected into the model's context
 * - exit code 2 on PreToolUse blocks the tool call
 *
 * This process never prints to stdout and always exits 0. It only reports what Bob is
 * doing; it never blocks or delays the agent, and a pet that is closed, slow or broken
 * must make no difference to Bob at all.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { stateForHook, describeHook, type PetState } from '@bob-pet/shared';

const DEADLINE_MS = 700;

/** Bob ignores stderr on exit 0, so a debug channel is safe. Off unless the env var is set. */
const debug = (...parts: unknown[]): void => {
  if (process.env.BOB_PET_HOOK_DEBUG) process.stderr.write(`[bob-pet-hook +${Math.round(performance.now())}ms] ${parts.join(' ')}\n`);
};

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    const done = (): void => resolve(raw);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      raw += chunk;
      if (raw.length > 262144) done();
    });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

/** Delivers one state update. Failures are silent: the pet is never worth a delay. */
async function send(message: Record<string, unknown>): Promise<void> {
  const userData = join(process.env.APPDATA ?? '', 'Bob Pet');
  const raw = await readFile(join(userData, 'session.json'), 'utf8');
  const { port, secret } = JSON.parse(raw) as { port: number; secret: string };
  if (!Number.isInteger(port) || typeof secret !== 'string') return;
  debug('sending', String(message.type), 'to 127.0.0.1:' + String(port));

  await new Promise<void>((resolve) => {
    const socket = new Socket();
    // A plain timer, not socket.setTimeout: an idle timeout does not cover a connect
    // that is silently dropped, which is exactly the case that must not hang.
    const deadline = setTimeout(() => {
      debug('no answer within', String(DEADLINE_MS), 'ms');
      finish();
    }, DEADLINE_MS);
    let settled = false;
    function finish(): void {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      resolve();
    }
    // The pet hangs up without a word on a bad handshake (a stale session file, say).
    socket.once('close', () => {
      if (!settled) debug('closed by the pet without an answer');
      finish();
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      debug('socket error', String(error.code ?? error.message));
      finish();
    });
    socket.connect(port, '127.0.0.1', () => {
      debug('connected');
      socket.write(`${JSON.stringify({ version: 1, type: 'hello', secret })}\n`);
      socket.write(`${JSON.stringify(message)}\n`);
      // The handshake acknowledgement is enough to know it was delivered.
      socket.once('data', () => {
        debug('acknowledged');
        finish();
      });
    });
  });
}

async function main(): Promise<void> {
  debug('started');
  const raw = await readStdin();
  debug('read', String(raw.length), 'bytes of stdin');
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const state: PetState | undefined = stateForHook(payload);
  if (!state) {
    debug('no state for payload');
    return;
  }

  const label = describeHook(payload);
  // Marked as Bob's own report: a celebration it raises ends by itself, one a person
  // picks from the menu stays until they change it.
  await send({ version: 1, type: 'set-state', state, ...(label ? { label } : {}), source: 'bob' });
  debug('done', state);
}

// Exit 0 on every path, and the backstop wins any race: the pet must never stall Bob.
const backstop = setTimeout(() => {
  debug('backstop fired');
  process.exit(0);
}, DEADLINE_MS + 1500);
main()
  .catch((error: unknown) => debug('failed:', error instanceof Error ? error.message : String(error)))
  .finally(() => {
    clearTimeout(backstop);
    process.exit(0);
  });
