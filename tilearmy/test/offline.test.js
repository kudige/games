process.env.NODE_ENV = 'test';
process.env.OFFLINE_TIMEOUT_MS = 100;
const test = require('node:test');
const assert = require('node:assert');
const { CFG, players, entities, getEntitiesByType, gameLoop } = require('../server');
const bases = () => getEntitiesByType('base');
const resources = () => getEntitiesByType('resource');

function resetState(){
  entities.length = 0;
  for (const k of Object.keys(players)) delete players[k];
}

test('vehicles dock and stop harvesting after offline timeout', () => {
  resetState();
  players.p1 = { bases: ['b1'], vehicles: [], ore: 0, lumber: 0, stone: 0, energy: CFG.ENERGY_MAX, disconnectedAt: Date.now() - CFG.OFFLINE_TIMEOUT - 10, offline: false };
  const base = { id: 'b1', type: 'base', x: 0, y: 0, owner: 'p1', hp: CFG.BASE_HP, damage: CFG.BASE_DAMAGE, rof: CFG.BASE_ROF, queue: [] };
  entities.push(base);
  const vehicle = {
    id: 'v1', type: 'basic', speed: 1000, capacity: 100, energyCost: 0, hp: 100, damage: 0, rof: 0,
    x: 100, y: 0, tx: 100, ty: 0,
    carrying: 50, carryType: 'ore',
    state: 'idle', targetRes: null, targetBase: null, unloadTimer: 0
  };
  players.p1.vehicles.push(vehicle);

  // Trigger offline docking
  gameLoop();
  assert.strictEqual(vehicle.state, 'returning');
  assert.strictEqual(vehicle.targetRes, null);

  // Let vehicle reach base and unload
  for (let i = 0; i < 40; i++) gameLoop();
  assert.strictEqual(vehicle.state, 'idle');
  assert.ok(Math.hypot(vehicle.x - base.x, vehicle.y - base.y) < 1);
  assert.strictEqual(vehicle.carrying, 0);
  assert.strictEqual(players.p1.ore, 50);

  // Ensure no harvesting while offline
  entities.push({ id: 'r1', type: 'resource', resType: 'ore', x: 0, y: 0, amount: 1000 });
  const oreBefore = players.p1.ore;
  for (let i = 0; i < 20; i++) gameLoop();
  assert.strictEqual(vehicle.state, 'idle');
  assert.strictEqual(players.p1.ore, oreBefore);
  assert.strictEqual(resources()[0].amount, 1000);
});
