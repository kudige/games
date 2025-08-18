process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const { CFG, players, entities, getEntitiesByType, upgradeBase, baseUpgradeCost } = require('../server');
const bases = () => getEntitiesByType('base');

function resetState(){
  entities.length = 0;
  for (const k of Object.keys(players)) delete players[k];
}

test('upgrading a base consumes resources and boosts stats', () => {
  resetState();
  players.p1 = { bases: ['b1'], vehicles: [], lumber: 500, stone: 500 };
  const base = { id: 'b1', type: 'base', x: 0, y: 0, owner: 'p1', level: 1, queue: [] };
  entities.push(base);
  // base stats before upgrade
  base.hp = CFG.BASE_HP;
  base.damage = CFG.BASE_DAMAGE;

  const ok = upgradeBase('p1', 'b1');
  assert.strictEqual(ok, true);
  assert.strictEqual(base.level, 2);
  assert.strictEqual(base.hp, CFG.BASE_HP + 100);
  assert.strictEqual(base.damage, CFG.BASE_DAMAGE + 5);
  const cost = baseUpgradeCost(1);
  assert.strictEqual(players.p1.lumber, 500 - cost.lumber);
  assert.strictEqual(players.p1.stone, 500 - cost.stone);
});

