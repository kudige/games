process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const { CFG, players, bases, processManufacturing, resolveCaptures } = require('../server');

function resetState(){
  bases.length = 0;
  for (const k of Object.keys(players)) delete players[k];
}

test('base captured after HP reaches zero', () => {
  resetState();
  players.attacker = { bases: [], vehicles: [] };
  players.defender = { bases: ['b1'], vehicles: [] };
  const base = { id: 'b1', x: 0, y: 0, owner: 'defender', hp: 0, damage: CFG.NEUTRAL_BASE_DAMAGE, rof: CFG.NEUTRAL_BASE_ROF, queue: [], lastAttacker: 'attacker' };
  bases.push(base);

  resolveCaptures();

  assert.strictEqual(base.owner, 'attacker');
  assert.strictEqual(base.hp, CFG.BASE_HP);
  assert.deepStrictEqual(players.defender.bases, []);
  assert.ok(players.attacker.bases.includes('b1'));
});

test('manufacturing queue spawns vehicle when ready', () => {
  resetState();
  players.p1 = { bases: ['b1'], vehicles: [] };
  const now = Date.now();
  const base = { id: 'b1', x: 0, y: 0, owner: 'p1', hp: CFG.BASE_HP, damage: CFG.BASE_DAMAGE, rof: CFG.BASE_ROF, queue: [{ vType: 'basic', readyAt: now - 1000 }] };
  bases.push(base);

  processManufacturing(now);

  assert.strictEqual(base.queue.length, 0);
  assert.strictEqual(players.p1.vehicles.length, 1);
  assert.strictEqual(players.p1.vehicles[0].type, 'basic');
});
