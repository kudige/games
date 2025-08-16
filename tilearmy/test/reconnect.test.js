process.env.NODE_ENV = 'test';
process.env.OFFLINE_TIMEOUT_MS = 100;
const test = require('node:test');
const assert = require('node:assert');
const { CFG, players, bases, resources, connections, handleDisconnect, gameLoop } = require('../server');

function resetState(){
  bases.length = 0;
  resources.length = 0;
  for (const k of Object.keys(players)) delete players[k];
  for (const k of Object.keys(connections)) delete connections[k];
}

test('vehicles persist after reconnect', () => {
  resetState();
  players.p1 = { bases: ['b1'], vehicles: [], ore: 0, lumber: 0, stone: 0, energy: CFG.ENERGY_MAX, disconnectedAt: Date.now() - CFG.OFFLINE_TIMEOUT - 10, offline: false };
  const base = { id: 'b1', x: 0, y: 0, owner: 'p1', hp: CFG.BASE_HP, damage: CFG.BASE_DAMAGE, rof: CFG.BASE_ROF, queue: [] };
  bases.push(base);
  const vehicle = {
    id: 'v1', type: 'basic', speed: 1000, capacity: 100, energyCost: 0, hp: 100, damage: 0, rof: 0,
    x: 100, y: 0, tx: 100, ty: 0,
    carrying: 50, carryType: 'ore',
    state: 'idle', targetRes: null, targetBase: null, unloadTimer: 0
  };
  players.p1.vehicles.push(vehicle);

  const ws1 = {};
  connections.p1 = ws1;
  handleDisconnect('p1', ws1);

  for (let i = 0; i < 100; i++) gameLoop();

  const ws2 = {};
  connections.p1 = ws2;
  players.p1.disconnectedAt = null;
  players.p1.offline = false;

  handleDisconnect('p1', ws1);
  assert.strictEqual(players.p1.disconnectedAt, null);

  const before = players.p1.vehicles.length;
  for (let i = 0; i < 20; i++) gameLoop();
  assert.strictEqual(players.p1.vehicles.length, before);
});
