process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const { CFG, players, entities, getEntitiesByType, spawnVehicle, gameLoop } = require('../server');
const bases = () => getEntitiesByType('base');

function resetState(){
  entities.length = 0;
  for (const k of Object.keys(players)) delete players[k];
}

test('base level restricts spawnable vehicles', () => {
  resetState();
  players.p1 = { bases: ['b1'], vehicles: [], ore: 1e6, lumber: 0, stone: 0, energy: CFG.ENERGY_MAX };
  const base = { id: 'b1', type: 'base', x: 0, y: 0, owner: 'p1', level: 1, queue: [] };
  entities.push(base);

  assert.strictEqual(spawnVehicle('p1', 'b1', 'hauler').ok, false);
  assert.strictEqual(spawnVehicle('p1', 'b1', 'scout').ok, true);

  base.level = 2;
  assert.strictEqual(spawnVehicle('p1', 'b1', 'hauler').ok, true);
  assert.strictEqual(spawnVehicle('p1', 'b1', 'basic').ok, false);

  base.level = 3;
  assert.strictEqual(spawnVehicle('p1', 'b1', 'basic').ok, true);
  assert.strictEqual(spawnVehicle('p1', 'b1', 'hauler').ok, true);
  assert.strictEqual(spawnVehicle('p1', 'b1', 'transport').ok, false);

  base.level = 4;
  assert.strictEqual(spawnVehicle('p1', 'b1', 'transport').ok, true);
  assert.strictEqual(spawnVehicle('p1', 'b1', 'heavyTank').ok, true);
});

test('transport unloads cargo instantly', () => {
  resetState();
  players.p1 = { bases: ['b1'], vehicles: [], ore: 0, lumber: 0, stone: 0, energy: CFG.ENERGY_MAX };
  const base = { id: 'b1', type: 'base', x: 0, y: 0, owner: 'p1', hp: CFG.BASE_HP, damage: CFG.BASE_DAMAGE, rof: CFG.BASE_ROF, queue: [] };
  entities.push(base);
  const transport = {
    id: 'v1', type: 'transport', speed: 0, capacity: 1000, energyCost: 0, hp: 100, damage: 0, rof: 0,
    harvestRate: CFG.VEHICLE_TYPES.transport.harvestRate,
    unloadTime: CFG.VEHICLE_TYPES.transport.unloadTime,
    x: 0, y: 0, tx: 0, ty: 0,
    carrying: 500, carryType: 'ore',
    state: 'returning', targetRes: null, targetBase: 'b1', unloadTimer: 0,
  };
  players.p1.vehicles.push(transport);

  gameLoop();
  gameLoop();

  assert.strictEqual(transport.carrying, 0);
  assert.strictEqual(players.p1.ore, 500);
  assert.strictEqual(transport.state, 'idle');
});

