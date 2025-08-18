process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

test('state updates are throttled and only sent on change', () => {
  const realNow = Date.now;
  let now = 0;
  Date.now = () => now;

  // Load fresh server state with stubbed time
  delete require.cache[require.resolve('../server')];
  const { players, bases, resources, gameLoop, wss } = require('../server');

  // Ensure clean state
  bases.length = 0;
  resources.length = 0;
  for (const k of Object.keys(players)) delete players[k];
  wss.clients.clear();

  const messages = [];
  const fake = { readyState: WebSocket.OPEN, send: m => messages.push(m) };
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

    // State changes again but within a second -> still only one broadcast
    now = 1500;
    gameLoop();
    assert.strictEqual(messages.length, 1);

    // After a second passes and state changed -> second broadcast
    now = 2200;
    gameLoop();
    assert.strictEqual(messages.length, 2);
  } finally {
    Date.now = realNow;
  }
});
