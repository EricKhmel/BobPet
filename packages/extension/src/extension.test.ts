import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, PET_STATES } from '@bob-pet/shared';

test('extension protocol payload does not permit arbitrary commands', () => {
  assert.equal(parseMessage({ version: 1, type: 'run', command: 'whoami' }), undefined);
  assert.equal(parseMessage({ version: 1, type: 'exec', script: 'calc.exe' }), undefined);
  assert.equal(parseMessage({ version: 1, type: 'eval', code: 'process.exit()' }), undefined);
});

test('extension protocol payload only validates safe known types and states', () => {
  for (const state of PET_STATES) {
    assert.deepEqual(parseMessage({ version: 1, type: 'set-state', state }), {
      version: 1,
      type: 'set-state',
      state
    });
  }
  assert.deepEqual(parseMessage({ version: 1, type: 'focus-request' }), {
    version: 1,
    type: 'focus-request'
  });
  assert.deepEqual(parseMessage({ version: 1, type: 'request-focus-ide' }), {
    version: 1,
    type: 'request-focus-ide'
  });
  assert.deepEqual(parseMessage({ version: 1, type: 'ping' }), {
    version: 1,
    type: 'ping'
  });
});
