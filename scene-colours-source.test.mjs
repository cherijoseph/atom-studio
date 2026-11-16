import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneColours } from './scene-colours-source.js';

test('keeps exact custom colours, groups case variants, and includes cubes and hidden objects', () => {
  assert.deepEqual(sceneColours([
    { color: '#FFD43B', material: 'Gold finish', kind: 'atom' },
    { color: '#BD45D4', material: 'Violet finish', kind: 'atom' },
    { color: '#bd45d4', material: ' Violet finish ', kind: 'atom' },
    { color: '#101010', material: 'Carbon', kind: 'carbon' },
    { color: '#ffd43b', material: 'Gold finish', visible: false },
  ]), [
    { color: '#101010', labels: ['Carbon'], count: 1 },
    { color: '#bd45d4', labels: ['Violet finish'], count: 2 },
    { color: '#ffd43b', labels: ['Gold finish'], count: 2 },
  ]);
});

test('shows all distinct trimmed material names in English alphabetical order', () => {
  assert.deepEqual(sceneColours([
    { color: '#123456', material: ' Zinc ' },
    { color: '#123456', material: 'Red finish' },
    { color: '#123456', material: 'aluminum' },
    { color: '#123456', material: 'Red finish  ' },
  ]), [{ color: '#123456', labels: ['aluminum', 'Red finish', 'Zinc'], count: 4 }]);
});

test('unnamed objects have a label without discarding named objects of the same colour', () => {
  assert.deepEqual(sceneColours([
    { color: '#abcdef', material: '' },
    { color: '#abcdef', material: '  ' },
    { color: '#ABCDEF' },
    { color: '#abcdef', material: null },
    { color: '#abcdef', material: 'Red finish' },
  ]), [{ color: '#abcdef', labels: ['Red finish', 'Unnamed material'], count: 5 }]);
});

test('empty or invalid data cannot create invalid colour controls', () => {
  assert.deepEqual(sceneColours(), []);
  assert.deepEqual(sceneColours(null), []);
  assert.deepEqual(sceneColours({ color: '#123456' }), []);
  assert.deepEqual(sceneColours([
    null, undefined, {}, { color: '#f00' }, { color: '#GG0000' },
    { color: '#1234567' }, { color: 'red' }, { color: 123456 },
    { color: '#123456\n' }, { color: ' #123456' },
  ]), []);
});

test('recomputing after deletion and recolouring removes unused colours and updates counts', () => {
  const items = [
    { color: '#ff0000', material: 'Red finish' },
    { color: '#00ff00', material: 'Teal finish' },
    { color: '#ff0000', material: 'Red finish' },
  ];
  assert.deepEqual(sceneColours(items).map(({ color, count }) => ({ color, count })), [
    { color: '#00ff00', count: 1 }, { color: '#ff0000', count: 2 },
  ]);
  items[0].color = '#00ff00';
  items.pop();
  assert.deepEqual(sceneColours(items), [
    { color: '#00ff00', labels: ['Red finish', 'Teal finish'], count: 2 },
  ]);
});

test('does not mutate input or leak mutable references between calls', () => {
  const items = Object.freeze([
    Object.freeze({ color: '#BD45D4', material: ' Violet finish ' }),
    Object.freeze({ color: '#101010', material: 'Carbon' }),
  ]);
  const result = sceneColours(items);
  result[1].labels.push('Changed externally');
  result[0].count = 99;
  assert.deepEqual(sceneColours(items), [
    { color: '#101010', labels: ['Carbon'], count: 1 },
    { color: '#bd45d4', labels: ['Violet finish'], count: 1 },
  ]);
  assert.deepEqual(items[0], { color: '#BD45D4', material: ' Violet finish ' });
});

test('output ordering is independent of input object ordering', () => {
  const items = [
    { color: '#ffffff', material: 'Base' },
    { color: '#111111', material: 'Zinc' },
    { color: '#111111', material: 'red finish' },
    { color: '#111111', material: 'Red finish' },
    { color: '#111111', material: 'Carbon' },
  ];
  assert.deepEqual(sceneColours(items), sceneColours([...items].reverse()));
});
