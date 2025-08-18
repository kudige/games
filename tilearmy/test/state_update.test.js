process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

test('state updates are throttled and only send changed entities', () => {
  const realNow = Date.now;
  let now = 0;
  Date.now = () => now;

  // Load fresh server state with stubbed time
  delete require.cache[require.resolve('../server')];
  const { players, bases, resources, gameLoop, wss, CFG } = require('../server');

  // Prevent passive energy changes interfering with diff tests
  CFG.ENERGY_RECHARGE = 0;

  // Ensure clean state
  bases.length = 0;
  resources.length = 0;
  for (const k of Object.keys(players)) delete players[k];
  wss.clients.clear();

  const messages = [];
  const fake = { readyState: WebSocket.OPEN, send: m => messages.push(JSON.parse(m)) };
  wss.clients.add(fake);

  try {
    // No state change yet -> no broadcast
    now = 1000;
    gameLoop();
    assert.strictEqual(messages.length, 0);

    // Introduce a player to change state -> broadcast once
    players.p1 = { bases: [], vehicles: [], ore: 0, lumber: 0, stone: 0, energy: 0 };
    now = 1100;
    gameLoop();
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].type, 'update');
    assert.ok(Array.isArray(messages[0].entities));
    const pMsg = messages[0].entities.find(e => e.kind === 'player' && e.id === 'p1');
    assert.ok(pMsg);
    assert.strictEqual(messages[0].cfg, undefined);

    // State changes again but within a second -> still only one broadcast
    now = 1500;
    gameLoop();
    assert.strictEqual(messages.length, 1);

    // Modify a single attribute
    players.p1.ore = 5;

    // After a second passes and state changed -> second broadcast
    now = 2200;
    gameLoop();
    assert.strictEqual(messages.length, 2);
    const update = messages[1].entities.find(e => e.kind === 'player' && e.id === 'p1');
    assert.deepStrictEqual(Object.keys(update).sort(), ['id', 'kind', 'ore']);
    assert.strictEqual(update.ore, 5);
  } finally {
    Date.now = realNow;
  }
});
