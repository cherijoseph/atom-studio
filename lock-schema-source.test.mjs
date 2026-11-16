import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocked, validateLock } from './lock-schema-source.js';

const group = 'e8049caf-6619-4ff5-949a-4a3184bb193c';

test('legacy objects retain omitted lock fields, and explicit booleans stay explicit', () => {
  assert.deepEqual(validateLock({ x: 1 }), {});
  assert.deepEqual(validateLock({ locked: undefined }), {});
  assert.deepEqual(validateLock({ locked: false }), { locked: false });
  assert.deepEqual(validateLock({ locked: true }), { locked: true });
  assert.equal(isLocked(null), false);
  assert.equal(isLocked({ locked: 'true' }), false);
  assert.equal(isLocked({ locked: true }), true);
});

test('named locked sets normalize only their allowed metadata', () => {
  const raw = { locked: true, lockGroup: group.toUpperCase(), lockLabel: '  Substrate  ', extra: 'discard' };
  assert.deepEqual(validateLock(raw), { locked: true, lockGroup: group, lockLabel: 'Substrate' });
  assert.equal(raw.lockLabel, '  Substrate  ');
  assert.deepEqual(validateLock({ locked: true, lockLabel: '' }), { locked: true, lockLabel: '' });
  assert.equal(validateLock({ locked: true, lockLabel: 'x'.repeat(80) }).lockLabel.length, 80);
});

test('invalid lock values and stale metadata on unlocked objects are rejected', () => {
  const cases = [
    null, [], 'locked', { locked: null }, { locked: 1 }, { locked: 'false' },
    { locked: true, lockGroup: 1 }, { locked: true, lockGroup: '' }, { locked: true, lockGroup: 'not-a-uuid' },
    { locked: true, lockLabel: null }, { locked: true, lockLabel: 'x'.repeat(81) },
    { locked: true, lockLabel: 'A\nB' }, { locked: true, lockLabel: '\u007f' },
    { lockGroup: group }, { lockLabel: 'Forgot flag' }, { locked: false, lockGroup: group }, { locked: false, lockLabel: 'Stale' },
  ];
  for (const value of cases) assert.throws(() => validateLock(value), TypeError, JSON.stringify(value));
});
