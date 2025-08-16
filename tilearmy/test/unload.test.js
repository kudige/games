process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const { CFG, players, bases, resources, gameLoop } = require('../server');

function resetState(){
  bases.length = 0;
  resources.length = 0;
  for (const k of Object.keys(players)) delete players[k];
}

test('vehicle unloads cargo after delay', () => {
  resetState();
  players.p1 = { bases: ['b1'], vehicles: [], ore: 0, lumber: 0, stone: 0, energy: CFG.ENERGY_MAX };
  const base = { id: 'b1', x: 0, y: 0, owner: 'p1', hp: CFG.BASE_HP, damage: CFG.BASE_DAMAGE, rof: CFG.BASE_ROF, queue: [] };
  bases.push(base);
  const vehicle = {
    id: 'v1', type: 'basic', speed: 0, capacity: 100, energyCost: 0, hp: 100, damage: 0, rof: 0,
    x: 0, y: 0, tx: 0, ty: 0,
    carrying: 100, carryType: 'ore',
    state: 'returning', targetRes: null, targetBase: 'b1', unloadTimer: 0
  };
  players.p1.vehicles.push(vehicle);

  const ticks = Math.ceil(CFG.UNLOAD_TIME / CFG.TICK_MS) + 1;
  for (let i = 0; i < ticks; i++) gameLoop();

  assert.strictEqual(vehicle.carrying, 0);
  assert.strictEqual(vehicle.state, 'idle');
  assert.strictEqual(players.p1.ore, 100);
});
