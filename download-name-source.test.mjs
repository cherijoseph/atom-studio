import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDownloadName, defaultDownloadNames, normalizeDownloadNames } from './download-name-source.js';

test('JSON and PNG suffixes are interchangeable, repeated, and case insensitive', () => {
  assert.deepEqual(normalizeDownloadName('  My diagram.JSON.PNG.json  ', 'png'), {
    baseName: 'My diagram', fileName: 'My diagram.png',
  });
  assert.deepEqual(normalizeDownloadName('My diagram.PNG', '.JSON'), {
    baseName: 'My diagram', fileName: 'My diagram.json',
  });
  assert.equal(normalizeDownloadName('phase.json-results', 'json').baseName, 'phase.json-results');
  assert.equal(normalizeDownloadName('phase.json.png... ', 'png').fileName, 'phase.png');
});

test('reserved characters, path separators, and control characters become safe separators', () => {
  assert.equal(normalizeDownloadName('C:\\samples\\phase: Fe/Pt?*.png', 'png').fileName, 'C-samples-phase- Fe-Pt-.png');
  assert.equal(normalizeDownloadName('a<>:"/\\|?*b\u0000\u001fc\u007fd', 'json').baseName, 'a-b-c-d');
  assert.equal(normalizeDownloadName(' diagram . ', 'json').baseName, 'diagram');
  assert.equal(normalizeDownloadName('../phase/Layer view.json', 'json').baseName, '..-phase-Layer view');
});

test('blank, unusable, and non-string names fall back to the default', () => {
  for (const value of ['', '   ', '... ', '.PNG.JSON', '\u0000<>?*', '----', null, undefined, 123, {}, []]) {
    assert.deepEqual(normalizeDownloadName(value, 'json'), {
      baseName: 'material-structure', fileName: 'material-structure.json',
    });
  }
});

test('Windows reserved device names remain safe even with other extensions', () => {
  for (const name of ['CON', 'con.txt.png', 'CON .txt', 'PRN', 'AUX.JSON', 'nul', 'COM1', 'com9.jpg', 'LPT1', 'lpt9.PnG']) {
    assert.equal(normalizeDownloadName(name, 'png').fileName, 'material-structure.png', name);
  }
  for (const name of ['connection', 'CON-1', 'COM0', 'COM10', 'LPT10', 'auxiliary']) {
    assert.equal(normalizeDownloadName(name, 'json').baseName, name, name);
  }
});

test('Unicode, emoji, spaces, and scientific notation are preserved', () => {
  const name = 'Surface study — 磁性 構造 🧪';
  assert.equal(normalizeDownloadName(`${name}.png`, 'json').fileName, `${name}.json`);
  assert.equal(normalizeDownloadName('  two  spaces  ', 'png').baseName, 'two  spaces');
});

test('base length is capped at 100 complete Unicode code points', () => {
  const long = '🧪'.repeat(110);
  const normalized = normalizeDownloadName(`${long}.JSON`, 'png');
  assert.equal(normalized.baseName, '🧪'.repeat(100));
  assert.equal(Array.from(normalized.baseName).length, 100);
  assert.equal(normalizeDownloadName(`${'a'.repeat(99)}.tail`, 'png').baseName, 'a'.repeat(99));
  assert.equal(normalizeDownloadName(`${'a'.repeat(99)} tail`, 'png').baseName, 'a'.repeat(99));
  assert.equal(normalizeDownloadName(`${'a'.repeat(96)}.png-extra`, 'json').fileName, `${'a'.repeat(96)}.json`);
});

test('missing and malformed optional preferences safely preserve defaults', () => {
  const expected = { scene: 'material-structure', image: 'material-structure' };
  for (const raw of [undefined, null, [], '', 42, {}, { scene: {}, image: false }, { scene: 'a'.repeat(513) }]) {
    assert.deepEqual(normalizeDownloadNames(raw), expected);
  }
  assert.deepEqual(normalizeDownloadNames({ scene: 'Sample.JSON', image: 'CON' }), {
    scene: 'Sample', image: 'material-structure',
  });
  assert.deepEqual(normalizeDownloadNames({ image: 'custom image.PNG' }), {
    scene: 'material-structure', image: 'custom image',
  });
});

test('preferences normalize independently without retaining or mutating source objects', () => {
  const raw = Object.freeze({ scene: 'Fe/Pt.json', image: '🧪 sample.png', ignored: 'unchanged' });
  assert.deepEqual(normalizeDownloadNames(raw), { scene: 'Fe-Pt', image: '🧪 sample' });
  assert.equal(raw.scene, 'Fe/Pt.json');
  const defaults = defaultDownloadNames();
  defaults.scene = 'changed';
  assert.equal(defaultDownloadNames().scene, 'material-structure');
});

test('unsupported export extensions fail explicitly', () => {
  for (const extension of ['pdf', '', null, '../png']) {
    assert.throws(() => normalizeDownloadName('diagram', extension), TypeError);
  }
});
