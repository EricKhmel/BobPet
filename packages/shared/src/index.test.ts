import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_STATES, PET_SCALES, clampPosition, migrateSettings, parseMessage, defaultSettings, dragOutcome, stateForHook, describeHook, dropDuration, dropIn, startTally, countStep, wrapUp, formatElapsed } from './index.js';

test('protocol validation: accepts exact protocol messages and valid states', () => {
  for (const state of PET_STATES) {
    const parsed = parseMessage({ version: 1, type: 'set-state', state });
    assert.equal(parsed?.type, 'set-state');
    if (parsed?.type === 'set-state') {
      assert.equal(parsed.state, state);
    }
  }
  assert.equal(parseMessage({ version: 1, type: 'hello', secret: 'a'.repeat(32) })?.type, 'hello');
  assert.equal(parseMessage({ version: 1, type: 'focus-request' })?.type, 'focus-request');
  assert.equal(parseMessage({ version: 1, type: 'request-focus-ide' })?.type, 'request-focus-ide');
  assert.equal(parseMessage({ version: 1, type: 'ping' })?.type, 'ping');
});

test('protocol validation: rejects invalid version, unknown types, extra fields, or short secrets', () => {
  assert.equal(parseMessage(null), undefined);
  assert.equal(parseMessage(undefined), undefined);
  assert.equal(parseMessage({ version: 2, type: 'ping' }), undefined);
  assert.equal(parseMessage({ version: 1, type: 'ping', extra: true }), undefined);
  assert.equal(parseMessage({ version: 1, type: 'hello', secret: 'short' }), undefined);
  assert.equal(parseMessage({ version: 1, type: 'set-state', state: 'INVALID' }), undefined);
  assert.equal(parseMessage({ version: 1, type: 'unknown' }), undefined);
});

test('scale calculations: all specified scales match exact multipliers and pixel sizes', () => {
  assert.equal(PET_SCALES.mini.multiplier, 0.75);
  assert.equal(PET_SCALES.mini.pixels, 48);

  assert.equal(PET_SCALES.standard.multiplier, 1.0);
  assert.equal(PET_SCALES.standard.pixels, 64);

  assert.equal(PET_SCALES.medium.multiplier, 1.5);
  assert.equal(PET_SCALES.medium.pixels, 96);

  assert.equal(PET_SCALES.large.multiplier, 2.0);
  assert.equal(PET_SCALES.large.pixels, 128);

  assert.equal(PET_SCALES.xl.multiplier, 3.0);
  assert.equal(PET_SCALES.xl.pixels, 192);

  assert.deepEqual(Object.values(PET_SCALES).map((s) => s.pixels), [48, 64, 96, 128, 192]);
});

test('settings migration: handles defaults, migrations, and bounds checking', () => {
  const defaults = defaultSettings();
  assert.equal(defaults.scale, 'medium', 'a pet nobody has sized yet should be comfortably visible');
  assert.equal(defaults.muted, true); // Muted by default per requirements
  assert.equal(defaults.paused, false);
  assert.equal(defaults.animationEnabled, true);

  // Invalid scale falls back to standard
  assert.equal(migrateSettings({ scale: 'huge' }).scale, 'medium');
  // Valid scale is preserved
  assert.equal(migrateSettings({ scale: 'large', muted: false }).scale, 'large');
  assert.equal(migrateSettings({ scale: 'large', muted: false }).muted, false);

  // Invalid idleMinutes falls back
  assert.equal(migrateSettings({ idleMinutes: -1 }).idleMinutes, 15);
  assert.equal(migrateSettings({ idleMinutes: 30 }).idleMinutes, 30);
});

test('clampPosition: clamps coordinates to valid visible work areas', () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  // Out of bounds to the right
  assert.deepEqual(clampPosition({ x: 2500, y: 500 }, displays, 64), { x: 1856, y: 500 });
  // Out of bounds to the top-left
  assert.deepEqual(clampPosition({ x: -100, y: -50 }, displays, 64), { x: 0, y: 0 });
  // Inside bounds
  assert.deepEqual(clampPosition({ x: 500, y: 500 }, displays, 64), { x: 500, y: 500 });
});

test('dragOutcome: a press only becomes a drag past the threshold, and stays one', () => {
  const origin = { x: 100, y: 100 };
  const windowStart = { x: 300, y: 200 };

  // Below the threshold the window must not move at all, or a click would nudge the pet.
  assert.deepEqual(dragOutcome(origin, { x: 100, y: 100 }, windowStart, false), { moved: false });
  assert.deepEqual(dragOutcome(origin, { x: 103, y: 100 }, windowStart, false), { moved: false });
  assert.deepEqual(dragOutcome(origin, { x: 102, y: 102 }, windowStart, false), { moved: false });

  // At or past the threshold it becomes a drag and tracks the cursor 1:1.
  assert.deepEqual(dragOutcome(origin, { x: 104, y: 100 }, windowStart, false), {
    moved: true,
    position: { x: 304, y: 200 }
  });
  assert.deepEqual(dragOutcome(origin, { x: 40, y: 260 }, windowStart, false), {
    moved: true,
    position: { x: 240, y: 360 }
  });

  // Already dragging: returning to the origin keeps it a drag rather than reverting to a click.
  assert.deepEqual(dragOutcome(origin, { x: 100, y: 100 }, windowStart, true), {
    moved: true,
    position: { x: 300, y: 200 }
  });
});

test('stateForHook maps IBM Bob hook events onto pet states', () => {
  assert.equal(stateForHook({ hook_event_name: 'SessionStart', source: 'startup' }), 'IDLE');
  assert.equal(stateForHook({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }), 'THINKING');
  assert.equal(stateForHook({ hook_event_name: 'PostToolUse', tool_name: 'read_file' }), 'THINKING');
  assert.equal(stateForHook({ hook_event_name: 'Stop', last_assistant_message: 'done' }), 'CELEBRATING');

  // Running or changing things is hammering; looking things up is focus.
  assert.equal(stateForHook({ hook_event_name: 'PreToolUse', tool_name: 'execute_command' }), 'WORKING');
  assert.equal(stateForHook({ hook_event_name: 'PreToolUse', tool_name: 'write_to_file' }), 'WORKING');
  assert.equal(stateForHook({ hook_event_name: 'PreToolUse', tool_name: 'apply_diff' }), 'WORKING');
  assert.equal(stateForHook({ hook_event_name: 'PreToolUse', tool_name: 'read_file' }), 'FOCUS');
  assert.equal(stateForHook({ hook_event_name: 'PreToolUse', tool_name: 'search_files' }), 'FOCUS');
  assert.equal(stateForHook({ hook_event_name: 'PreToolUse', tool_name: 'codebase_search' }), 'FOCUS');
  // An unknown tool is assumed to be doing something rather than just looking.
  assert.equal(stateForHook({ hook_event_name: 'PreToolUse', tool_name: 'some_future_tool' }), 'WORKING');

  // Anything unrecognised leaves the pet alone rather than guessing.
  assert.equal(stateForHook({ hook_event_name: 'Nonsense' }), undefined);
  assert.equal(stateForHook({}), undefined);
  assert.equal(stateForHook(null), undefined);
  assert.equal(stateForHook('Stop'), undefined);
});

test('describeHook turns Bob payloads into a short spoken line', () => {
  assert.equal(describeHook({ hook_event_name: 'SessionStart' }), 'Ready when you are');
  assert.equal(describeHook({ hook_event_name: 'UserPromptSubmit', prompt: 'x' }), 'Thinking about that…');
  assert.equal(describeHook({ hook_event_name: 'Stop' }), 'All done');
  assert.equal(describeHook({ hook_event_name: 'Nope' }), undefined);

  // Verb comes from the tool, target from whichever input key it uses.
  assert.equal(describeHook({ hook_event_name: 'PreToolUse', tool_name: 'execute_command', tool_input: { command: 'npm test' } }), 'Running npm test');
  assert.equal(describeHook({ hook_event_name: 'PreToolUse', tool_name: 'read_file', tool_input: { path: 'src/index.ts' } }), 'Reading index.ts');
  assert.equal(describeHook({ hook_event_name: 'PreToolUse', tool_name: 'write_to_file', tool_input: { file_path: 'C:\\ws\\notes.md' } }), 'Writing notes.md');
  assert.equal(describeHook({ hook_event_name: 'PreToolUse', tool_name: 'apply_diff', tool_input: { path: 'a/b/main.ts' } }), 'Editing main.ts');
  assert.equal(describeHook({ hook_event_name: 'PreToolUse', tool_name: 'search_files', tool_input: { query: 'TODO' } }), 'Searching TODO');

  // Unknown tool, and a tool with nothing recognisable to name.
  assert.equal(describeHook({ hook_event_name: 'PreToolUse', tool_name: 'weird_thing', tool_input: {} }), 'Using weird thing');
  assert.equal(describeHook({ hook_event_name: 'PreToolUse', tool_name: 'read_file', tool_input: {} }), 'Reading something');

  // Long targets are truncated, and newlines never reach the bubble.
  const long = describeHook({ hook_event_name: 'PreToolUse', tool_name: 'execute_command', tool_input: { command: 'a'.repeat(200) } });
  assert.ok(long && long.length < 60, `expected truncation, got ${long?.length} chars`);
  assert.equal(describeHook({ hook_event_name: 'PreToolUse', tool_name: 'execute_command', tool_input: { command: 'one\ntwo' } }), 'Running one two');

  // The target is reproduced exactly, never re-cased: the line has to describe the command
  // Bob will actually run, and on a case-sensitive shell a re-cased name is a different one.
  assert.equal(
    describeHook({ hook_event_name: 'PreToolUse', tool_name: 'execute_command', tool_input: { command: 'Get-ChildItem -Name' } }),
    'Running Get-ChildItem -Name'
  );
});

test('the wrap-up counts steps, distinct files changed and commands run', () => {
  const tally = startTally(1_000);
  for (const label of ['Reading index.ts', 'Editing index.ts', 'Editing index.ts', 'Writing notes.md', 'Running npm test', 'Editing something']) {
    countStep(tally, label);
  }
  assert.equal(wrapUp(tally, 1_000 + 252_000), 'All done in 4m 12s: 6 steps, 2 files changed, 1 command run');
  // A task that used no tools just says how long it took.
  assert.equal(wrapUp(startTally(0), 9_400), 'All done in 9s');
  assert.equal(formatElapsed(59_999), '59s');
  assert.equal(formatElapsed(65_000), '1m 05s');
  assert.equal(formatElapsed(3_900_000), '1h 05m');
});

test('the drop-in falls from where it was dropped, bounces smaller, and ends still', () => {
  const HIGH = 900;
  const total = dropDuration(HIGH);
  assert.ok(total > 1_000 && total < 3_000, `a screen-height fall should take a second or two, not ${total}ms`);
  // A longer fall takes longer, as gravity says it should.
  assert.ok(dropDuration(200) < dropDuration(HIGH));
  assert.equal(dropDuration(0), 0, 'a pet already at the top has nowhere to fall from');

  assert.deepEqual(dropIn(-5, HIGH), { rise: HIGH, squash: 0 }, 'he waits up there until released');
  assert.equal(dropIn(0, HIGH).rise, HIGH);

  // Falling: always downward, never past the floor, and squashed only on landing.
  let previous = HIGH;
  let landing = -1;
  for (let ms = 10; ms < total; ms += 5) {
    const { rise, squash } = dropIn(ms, HIGH);
    assert.ok(rise >= 0, 'never below its resting place');
    if (landing < 0 && rise >= previous) landing = ms;
    // Well clear of the floor on the way down for the first time: no landing has happened
    // yet, so nothing is squashed. Later descents can still be springing back from one.
    if (landing < 0 && rise > 5) assert.equal(squash, 0, `squash belongs to the landing, not the fall (${ms}ms)`);
    previous = rise;
  }
  assert.ok(landing > 0 && landing < total / 2, 'the first landing comes well before the end');

  // Each bounce is lower than the one before it.
  const peak = (from: number, to: number): number => {
    let best = 0;
    for (let ms = from; ms < to; ms += 2) best = Math.max(best, dropIn(ms, HIGH).rise);
    return best;
  };
  const first = peak(landing, landing + (total - landing) / 2);
  const second = peak(landing + (total - landing) / 2, total);
  assert.ok(first > second && second > 0, 'bounces get smaller');
  assert.ok(first < HIGH / 2, 'and never near the height he was dropped from');

  // The landing squash is hardest first, springs back, and a short fall lands softer.
  const hit = dropIn(landing, HIGH).squash;
  assert.ok(hit > 0.2, `the first landing should squash him (${hit})`);
  assert.equal(dropIn(landing + 140, HIGH).squash, 0, 'the squash springs back, not lingers');
  assert.ok(dropIn(dropDuration(60), 60).squash <= hit, 'a short drop lands softer');

  assert.deepEqual(dropIn(total, HIGH), { rise: 0, squash: 0 }, 'ends exactly where he belongs');
  assert.deepEqual(dropIn(total + 5_000, HIGH), { rise: 0, squash: 0 }, 'and stays there');
});

test("a report can say it came from Bob's own hooks, and nothing else gets in", () => {
  const fromBob = parseMessage({ version: 1, type: 'set-state', state: 'CELEBRATING', label: 'All done', source: 'bob' });
  assert.deepEqual(fromBob, { version: 1, type: 'set-state', state: 'CELEBRATING', label: 'All done', source: 'bob' });

  // Picked by a person: no source, so the pet keeps the state until they change it.
  const byHand = parseMessage({ version: 1, type: 'set-state', state: 'CELEBRATING' });
  assert.deepEqual(byHand, { version: 1, type: 'set-state', state: 'CELEBRATING' });
  assert.equal((byHand as { source?: string }).source, undefined);

  // Only that one value means anything, and unknown fields are still refused.
  assert.equal(parseMessage({ version: 1, type: 'set-state', state: 'IDLE', source: 'extension' }), undefined);
  assert.equal(parseMessage({ version: 1, type: 'set-state', state: 'IDLE', source: true }), undefined);
  assert.equal(parseMessage({ version: 1, type: 'set-state', state: 'IDLE', sneaky: 1 }), undefined);
});

test('a spoken line cannot carry invisible characters', () => {
  // U+202E reverses what follows it: a file name could make the pet claim something else.
  const spoofed = parseMessage({ version: 1, type: 'set-state', state: 'WORKING', label: 'Editing \u202Egnj.exe' });
  assert.equal((spoofed as { label?: string }).label, 'Editing gnj.exe');

  const controls = parseMessage({ version: 1, type: 'set-state', state: 'WORKING', label: 'Running \u0000rm\u001b[2K -rf' });
  assert.equal((controls as { label?: string }).label, 'Running rm[2K -rf');

  // Ordinary text is untouched apart from having its whitespace collapsed.
  const plain = parseMessage({ version: 1, type: 'set-state', state: 'WORKING', label: '  Running   npm test\n' });
  assert.equal((plain as { label?: string }).label, 'Running npm test');
});
