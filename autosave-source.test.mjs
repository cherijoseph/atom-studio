import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { createBrowserAutosave } from './autosave-source.js';

const makeStorage = () => {
  const entries = new Map();
  return {
    entries,
    writes: 0,
    getItem: key => entries.get(key) ?? null,
    setItem(key, value) { entries.set(key, value); this.writes++; },
  };
};

const workspace = (name = 'Red finish') => ({
  work: { atoms: [{ id: 'atom-1', x: 0, y: 1, z: -1, material: name }], camera: [0, 1, 12] },
  exampleBackup: { atoms: [{ id: 'original-1', material: 'Base' }] },
  exampleMode: true,
});

function setup(storage = makeStorage(), initial = workspace()) {
  let state = structuredClone(initial);
  const statuses = [];
  const autosave = createBrowserAutosave({
    key: 'workspace', getStorage: () => storage,
    readState: () => structuredClone(state),
    applyState: restored => { state = structuredClone(restored); },
    validateState: value => Array.isArray(value.work?.atoms),
    onStatus: (status, savedAt) => statuses.push({ status, savedAt }),
    delay: 20,
  });
  return { autosave, storage, statuses, get: () => state, set: value => { state = value; } };
}

test('round trip restores objects, camera, example backup, and IDs without a write', () => {
  const first = setup();
  assert.equal(first.autosave.restore(), false);
  assert.equal(first.autosave.hasSaved(), false);
  assert.equal(first.autosave.flush(), false);
  first.autosave.schedule();
  assert.equal(first.autosave.flush(), true);
  const envelope = JSON.parse(first.storage.getItem('workspace'));
  assert.equal(envelope.format, 'atom-studio-browser-autosave');
  assert.equal(envelope.version, 1);
  assert.equal(envelope.revision, 1);
  assert.equal(typeof envelope.writerId, 'string');
  assert.ok(Number.isFinite(Date.parse(envelope.savedAt)));
  assert.deepEqual(envelope.workspace, workspace());
  const second = setup(first.storage, workspace('Teal finish'));
  assert.equal(second.autosave.restore(), true);
  assert.deepEqual(second.get(), workspace());
  assert.equal(second.autosave.hasSaved(), true);
  assert.equal(second.autosave.isCurrentSaved(), true);
  assert.equal(first.storage.writes, 1);
  assert.equal(second.statuses.at(-1).status, 'restored');
});

test('corrupt and invalid records survive startup flush until the workspace changes', async () => {
  for (const raw of ['{broken', JSON.stringify({ format: 'other', version: 1 }), JSON.stringify({
    format: 'atom-studio-browser-autosave', version: 1, savedAt: new Date().toISOString(), workspace: { work: { atoms: 'invalid' } },
  })]) {
    const scenario = setup();
    scenario.storage.entries.set('workspace', raw);
    assert.equal(scenario.autosave.restore(), false);
    assert.deepEqual(scenario.get(), workspace());
    assert.equal(scenario.autosave.hasSaved(), false);
    assert.equal(scenario.statuses.at(-1).status, 'invalid');
    scenario.autosave.schedule();
    assert.equal(scenario.autosave.flush(), false);
    await wait(25);
    assert.equal(scenario.storage.getItem('workspace'), raw);
    assert.equal(scenario.storage.writes, 0);
    scenario.set(workspace('Teal finish'));
    assert.equal(scenario.autosave.flush(), true);
    assert.equal(scenario.storage.writes, 1);
  }
});

test('blocked storage is safe and reports unavailable', () => {
  const statuses = [];
  const autosave = createBrowserAutosave({ key: 'workspace',
    getStorage: () => { throw new Error('SecurityError'); },
    readState: () => workspace(), applyState: () => assert.fail('must not apply'),
    onStatus: status => statuses.push(status),
  });
  assert.equal(autosave.restore(), false);
  assert.equal(autosave.flush(), false);
  assert.equal(autosave.hasSaved(), false);
  assert.ok(statuses.includes('unavailable'));
});

test('quota failure preserves the last saved workspace and retries after storage recovers', () => {
  const scenario = setup();
  assert.equal(scenario.autosave.flush(), true);
  const previous = scenario.storage.getItem('workspace');
  const originalSet = scenario.storage.setItem;
  scenario.storage.setItem = () => { throw new Error('QuotaExceededError'); };
  scenario.set(workspace('Teal finish'));
  assert.equal(scenario.autosave.flush(), false);
  assert.equal(scenario.storage.getItem('workspace'), previous);
  assert.equal(scenario.autosave.hasSaved(), true);
  assert.equal(scenario.autosave.isCurrentSaved(), false);
  assert.equal(scenario.statuses.at(-1).status, 'unavailable');
  scenario.storage.setItem = originalSet;
  assert.equal(scenario.autosave.flush(), true);
  assert.equal(scenario.autosave.isCurrentSaved(), true);
});

test('unchanged work does not write again or change its saved timestamp', async () => {
  const scenario = setup();
  assert.equal(scenario.autosave.flush(), true);
  const previous = scenario.storage.getItem('workspace');
  scenario.autosave.schedule();
  await wait(30);
  assert.equal(scenario.autosave.flush(), true);
  assert.equal(scenario.storage.writes, 1);
  assert.equal(scenario.storage.getItem('workspace'), previous);
});

test('debounce saves the latest state once, and flush cancels a pending write', async () => {
  const scenario = setup();
  scenario.autosave.schedule();
  await wait(5);
  scenario.set(workspace('Teal finish'));
  scenario.autosave.schedule();
  await wait(5);
  scenario.set(workspace('Carbon'));
  scenario.autosave.schedule();
  assert.equal(scenario.autosave.flush(), true);
  await wait(35);
  assert.equal(scenario.storage.writes, 1);
  assert.deepEqual(JSON.parse(scenario.storage.getItem('workspace')).workspace, workspace('Carbon'));
  scenario.set(workspace('Violet finish'));
  scenario.autosave.schedule();
  await wait(35);
  assert.equal(scenario.storage.writes, 2);
  assert.equal(scenario.autosave.isCurrentSaved(), true);
});

test('serialization and validator failures do not replace a previous valid record', () => {
  const scenario = setup();
  scenario.autosave.flush();
  const previous = scenario.storage.getItem('workspace');
  scenario.set({ work: { atoms: 'invalid' } });
  assert.equal(scenario.autosave.flush(), false);
  assert.equal(scenario.storage.getItem('workspace'), previous);
  const circular = { work: { atoms: [] } };
  circular.loop = circular;
  scenario.set(circular);
  assert.equal(scenario.autosave.flush(), false);
  assert.equal(scenario.storage.getItem('workspace'), previous);
});

test('empty startup stays unsaved until an edit, including an explicit schedule', async () => {
  const scenario = setup();
  assert.equal(scenario.autosave.restore(), false);
  assert.equal(scenario.autosave.flush(), false);
  assert.equal(scenario.storage.getItem('workspace'), null);
  assert.equal(scenario.autosave.isCurrentSaved(), false);
  scenario.set(workspace('Teal finish'));
  assert.equal(scenario.autosave.flush(), true);
  const other = setup();
  other.autosave.restore();
  other.autosave.schedule();
  await wait(30);
  assert.equal(other.storage.writes, 1);
});

test('stale tab detects a newer record, preserves it, and never silently rebases', () => {
  const first = setup();
  first.autosave.restore();
  first.autosave.schedule();
  first.autosave.flush();
  const second = setup(first.storage);
  assert.equal(second.autosave.restore(), true);
  first.set(workspace('Teal finish'));
  first.autosave.flush();
  const newer = first.storage.getItem('workspace');
  assert.equal(JSON.parse(newer).revision, 2);
  // An unchanged stale tab must leave the newest work intact too.
  assert.equal(second.autosave.flush(), false);
  assert.equal(second.statuses.at(-1).status, 'conflict');
  second.set(workspace('Carbon'));
  assert.equal(second.autosave.flush(), false);
  assert.equal(first.storage.getItem('workspace'), newer);
  assert.equal(second.autosave.isCurrentSaved(), false);
  // A deliberate restore applies the newest record and establishes a new baseline.
  assert.equal(second.autosave.restore(), true);
  assert.deepEqual(second.get(), workspace('Teal finish'));
  second.set(workspace('Violet finish'));
  assert.equal(second.autosave.flush(), true);
  const latest = JSON.parse(first.storage.getItem('workspace'));
  assert.equal(latest.revision, 3);
  assert.notEqual(latest.writerId, JSON.parse(newer).writerId);
});

test('an empty tab cannot overwrite work first created by another tab', () => {
  const storage = makeStorage();
  const first = setup(storage);
  const second = setup(storage);
  first.autosave.restore();
  second.autosave.restore();
  first.set(workspace('Teal finish'));
  first.autosave.flush();
  const saved = storage.getItem('workspace');
  second.set(workspace('Carbon'));
  assert.equal(second.autosave.flush(), false);
  assert.equal(second.statuses.at(-1).status, 'conflict');
  assert.equal(storage.getItem('workspace'), saved);
});

test('a validator can normalize saved and restored workspace values', () => {
  const storage = makeStorage();
  let state = { work: { atoms: [{ id: 'kept', material: '  Red finish  ' }] } };
  const normalized = value => ({ work: { atoms: value.work.atoms.map(atom => ({ ...atom, material: atom.material.trim() })) } });
  const first = createBrowserAutosave({ key: 'workspace', getStorage: () => storage,
    readState: () => state, applyState: value => { state = value; }, validateState: normalized,
  });
  assert.equal(first.flush(), true);
  assert.equal(JSON.parse(storage.getItem('workspace')).workspace.work.atoms[0].material, 'Red finish');
  state = { work: { atoms: [] } };
  assert.equal(first.restore(), true);
  assert.equal(state.work.atoms[0].material, 'Red finish');
  assert.equal(first.isCurrentSaved(), true);
});
