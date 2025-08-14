const test = require('node:test');
const assert = require('node:assert');
const { rand, newId, clamp } = require('../utils');

test('clamp limits numbers within range', () => {
  assert.strictEqual(clamp(5, 0, 10), 5);
  assert.strictEqual(clamp(-5, 0, 10), 0);
  assert.strictEqual(clamp(15, 0, 10), 10);
});

test('newId creates string of requested length', () => {
  assert.strictEqual(newId().length, 9);
  assert.strictEqual(newId(5).length, 5);
});

test('rand generates number within range', () => {
  for (let i = 0; i < 100; i++) {
    const n = rand(5, 10);
    assert.ok(n >= 5 && n < 10);
  }
});
