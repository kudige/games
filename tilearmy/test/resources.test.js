process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const { resources, snapshotState } = require('../server');

test('snapshotState only includes changed resources when not full', () => {
  resources.length = 0;
  resources.push({ id: 'r1', type: 'ore', x: 0, y: 0, amount: 100, changed: false });
  resources.push({ id: 'r2', type: 'lumber', x: 10, y: 10, amount: 200, changed: false });

  let snap = snapshotState(false);
  assert.strictEqual(snap.resources.length, 0);

  resources[0].amount = 90;
  resources[0].changed = true;

  snap = snapshotState(false);
  assert.strictEqual(snap.resources.length, 1);
  assert.strictEqual(snap.resources[0].id, 'r1');

  // simulate send clearing the changed flag
  snap.resources.forEach(r => { r.changed = false; });
  snap = snapshotState(false);
  assert.strictEqual(snap.resources.length, 0);
});
