// TileArmy — Server (Express + ws)
// Run:
//   npm init -y && npm install express ws
//   node server.js
//   open http://localhost:3000

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { rand, newId, clamp } = require('./utils');

// ------------------ CONFIG ------------------
const ICON_SIZES = [32, 48, 64];
function nearestIconSize(val) {
  return ICON_SIZES.reduce((a, b) => (Math.abs(b - val) < Math.abs(a - val) ? b : a));
}
const BASE_ICON_SIZE = nearestIconSize(parseInt(process.env.BASE_ICON_SIZE, 10) || 32);
const VEHICLE_ICON_SIZE = nearestIconSize(parseInt(process.env.VEHICLE_ICON_SIZE, 10) || 32);
const RESOURCE_ICON_SIZE = nearestIconSize(parseInt(process.env.RESOURCE_ICON_SIZE, 10) || 32);
const CFG = {
  TILE_SIZE: parseInt(process.env.TILE_SIZE, 10) || 32,
  MAP_W: 4000,
  MAP_H: 3000,
  TICK_MS: 50,
  RESOURCE_TYPES: ['ore', 'lumber', 'stone'],
  RESOURCE_COUNT: 60,
  RESOURCE_AMOUNT: 1000,     // per field
  RESOURCE_RADIUS: 22,
  HARVEST_SEARCH_RADIUS: 300, // search radius for auto-harvest chaining
  HARVEST_RATE: 40,          // units/sec
  ENERGY_MAX: 100,           // player energy cap
  ENERGY_RECHARGE: 15,       // energy/sec auto recharge
  BASE_ATTACK_RANGE: 150,
  NEUTRAL_BASE_COUNT: 5,
  BASE_HP: 200,
  BASE_DAMAGE: 15,
  BASE_ROF: 1,
  NEUTRAL_BASE_HP: 150,
  NEUTRAL_BASE_DAMAGE: 5,
  NEUTRAL_BASE_ROF: 0.5,
  VEHICLE_TYPES: {
    scout:   { speed: 260, capacity: 120, energy: 0.015, hp: 60,  damage: 6,  rof: 1,   build: 1, cost: 800 },
    hauler:  { speed: 180, capacity: 400, energy: 0.03,  hp: 140, damage: 12, rof: 0.8, build: 3, cost: 1500 },
    basic:   { speed: 220, capacity: 200, energy: 0.02,  hp: 100, damage: 8,  rof: 1,   build: 2, cost: 1000 },
  },
};

// ------------------ SERVER STATE ------------------
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const players = Object.create(null); // { id: { bases, vehicles, color, ore, lumber, stone, energy } }
const resources = []; // [{id,type,x,y,amount}]
const bases = []; // [{id,x,y,owner,hp,damage,rof,queue}]
let seeded = false;
let basesSeeded = false;


function seedResources(){
  if (seeded) return;
  for (const type of CFG.RESOURCE_TYPES){
    for (let i=0;i<CFG.RESOURCE_COUNT;i++){
      const tx = Math.floor(rand(80, CFG.MAP_W - 80) / CFG.TILE_SIZE);
      const ty = Math.floor(rand(80, CFG.MAP_H - 80) / CFG.TILE_SIZE);
      resources.push({ id: newId(6), type, x: tx * CFG.TILE_SIZE, y: ty * CFG.TILE_SIZE, amount: CFG.RESOURCE_AMOUNT });
    }
  }
  seeded = true;
}

function seedBases(){
  if (basesSeeded) return;
  for (let i=0;i<CFG.NEUTRAL_BASE_COUNT;i++){
    const bx = Math.floor(rand(200, CFG.MAP_W - 200) / CFG.TILE_SIZE);
    const by = Math.floor(rand(200, CFG.MAP_H - 200) / CFG.TILE_SIZE);
    bases.push({
      id: newId(6),
      x: bx * CFG.TILE_SIZE,
      y: by * CFG.TILE_SIZE,
      owner: null,
      hp: CFG.NEUTRAL_BASE_HP,
      damage: CFG.NEUTRAL_BASE_DAMAGE,
      rof: CFG.NEUTRAL_BASE_ROF,
      queue: []
    });
  }
  basesSeeded = true;
}

function snapshotState(){
  return {
    cfg: {
      MAP_W: CFG.MAP_W, MAP_H: CFG.MAP_H,
      TILE_SIZE: CFG.TILE_SIZE,
      RESOURCE_AMOUNT: CFG.RESOURCE_AMOUNT,
      RESOURCE_TYPES: CFG.RESOURCE_TYPES,
      RESOURCE_RADIUS: CFG.RESOURCE_RADIUS,
      HARVEST_SEARCH_RADIUS: CFG.HARVEST_SEARCH_RADIUS,
      ENERGY_MAX: CFG.ENERGY_MAX,
      VEHICLE_TYPES: CFG.VEHICLE_TYPES,
      BASE_ICON_SIZE,
      VEHICLE_ICON_SIZE,
      RESOURCE_ICON_SIZE
    },
    resources,
    players,
    bases
  };
}

function nearestBase(pl, x, y){
  let best=null, bd=Infinity;
  for (const id of pl.bases){
    const b = bases.find(b => b.id === id);
    if (!b) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < bd){ bd=d; best=b; }
  }
  return best;
}

wss.on('connection', (ws) => {
  seedResources();
  seedBases();
  const id = newId(8);
  const bx = Math.floor(rand(200, CFG.MAP_W - 200) / CFG.TILE_SIZE);
  const by = Math.floor(rand(200, CFG.MAP_H - 200) / CFG.TILE_SIZE);
  const base = {
    id: newId(6),
    x: bx * CFG.TILE_SIZE,
    y: by * CFG.TILE_SIZE,
    owner: id,
    hp: CFG.BASE_HP,
    damage: CFG.BASE_DAMAGE,
    rof: CFG.BASE_ROF,
    queue: []
  };
  bases.push(base);
  players[id] = {
    bases: [base.id],
    vehicles: [],
    color: `hsl(${Math.floor(rand(0,360))} 70% 55%)`,
    ore: 800, // start with some ore
    lumber: 0,
    stone: 0,
    energy: CFG.ENERGY_MAX
  };

  ws.send(JSON.stringify({ type: 'init', id, state: snapshotState() }));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const me = players[id]; if (!me) return;

    if (msg.type === 'spawnVehicle') {
      const base = bases.find(b => b.id === msg.baseId && b.owner === id);
      if (!base) return;
      const vt = CFG.VEHICLE_TYPES[msg.vType] || CFG.VEHICLE_TYPES.basic;
      if (me.ore >= vt.cost){
        me.ore -= vt.cost;
        const readyAt = Date.now() + (vt.build || 0) * 1000;
        base.queue.push({ vType: msg.vType || 'basic', readyAt });
        ws.send(JSON.stringify({ type: 'notice', ok: true, msg: `Vehicle manufacturing (${vt.build||0}s)` }));
      } else {
        ws.send(JSON.stringify({ type: 'notice', ok: false, msg: 'Not enough ore to spawn vehicle' }));
      }
    }
    else if (msg.type === 'moveVehicle') {
      const v = me.vehicles.find(v => v.id === msg.vehicleId);
      if (v) {
        v.state = 'idle'; v.targetRes = null; // manual override
        v.tx = clamp(msg.x, 0, CFG.MAP_W);
        v.ty = clamp(msg.y, 0, CFG.MAP_H);
      }
    }
    else if (msg.type === 'harvestResource') {
      const v = me.vehicles.find(v => v.id === msg.vehicleId);
      const r = resources.find(r => r.id === msg.resourceId);
      if (v && r && r.amount > 0) {
        v.preferType = r.type;
        v.carrying = 0;
        v.carryType = null;
        v.targetRes = r.id;
        v.tx = r.x;
        v.ty = r.y;
        v.state = 'idle';
      }
    }
  });

  ws.on('close', () => {
    const pl = players[id];
    if (pl){
      for (const bid of pl.bases){
        const b = bases.find(b=>b.id===bid);
        if (b){
          b.owner = null;
          b.hp = CFG.NEUTRAL_BASE_HP;
          b.damage = CFG.NEUTRAL_BASE_DAMAGE;
          b.rof = CFG.NEUTRAL_BASE_ROF;
        }
      }
    }
    delete players[id];
  });
});

// ------------------ SIMULATION ------------------
function processManufacturing(now){
  for (const b of bases){
    if (!b.queue) b.queue = [];
    while (b.queue.length && b.queue[0].readyAt <= now){
      const item = b.queue.shift();
      const vt = CFG.VEHICLE_TYPES[item.vType] || CFG.VEHICLE_TYPES.basic;
      const owner = b.owner;
      const pl = players[owner]; if (!pl) continue;
      pl.vehicles.push({
        id: newId(5),
        type: item.vType || 'basic',
        speed: vt.speed,
        capacity: vt.capacity,
        energyCost: vt.energy,
        hp: vt.hp,
        damage: vt.damage,
        rof: vt.rof,
        x: b.x + CFG.TILE_SIZE,
        y: b.y,
        tx: b.x + CFG.TILE_SIZE,
        ty: b.y,
        carrying: 0,
        carryType: null,
        state: 'idle',
        targetRes: null,
        targetBase: null,
        unloadTimer: 0
      });
    }
  }
}

function resolveCaptures(){
  for (const b of bases){
    if (b.hp <= 0 && b.lastAttacker){
      const prev = b.owner;
      const att = b.lastAttacker;
      b.owner = att;
      b.hp = CFG.BASE_HP;
      b.damage = CFG.BASE_DAMAGE;
      b.rof = CFG.BASE_ROF;
      if (prev && players[prev]){
        players[prev].bases = players[prev].bases.filter(id=>id!==b.id);
      }
      if (players[att]){
        if (!players[att].bases.includes(b.id)) players[att].bases.push(b.id);
      }
      delete b.lastAttacker;
    }
  }
}

function gameLoop(){
  const dt = CFG.TICK_MS/1000;
  const harvestStep = CFG.HARVEST_RATE * dt;
  const rechargeStep = CFG.ENERGY_RECHARGE * dt;
  const now = Date.now();

  // Manufacturing queues
  processManufacturing(now);

  // Track claimed resources
  const claimed = new Set();
  for (const pid in players){
    for (const v of players[pid].vehicles){
      if (v.targetRes){
        if (claimed.has(v.targetRes)){ v.state='idle'; v.targetRes=null; }
        else claimed.add(v.targetRes);
      }
    }
  }

  for (const pid in players){
    const pl = players[pid];
    let energySpent = 0;

    for (const v of pl.vehicles){
      // Auto-target resources
      if (v.state === 'idle' && v.carrying < v.capacity){
        if (!v.targetRes || !resources.find(r => r.id===v.targetRes && r.amount>0)){
          let best=null, bd=Infinity;
          const consider = (type, radius) => {
            for (const r of resources){
              if (r.amount<=0 || claimed.has(r.id)) continue;
              if (type && r.type !== type) continue;
              const d=Math.hypot(r.x-v.x, r.y-v.y);
              if (radius !== undefined && d>radius) continue;
              if (d<bd){bd=d; best=r;}
            }
          };
          if (v.preferType) consider(v.preferType); else consider(null, CFG.HARVEST_SEARCH_RADIUS);
          if (best){ v.targetRes = best.id; v.tx = best.x; v.ty = best.y; claimed.add(best.id); }
        }
      }

      // Move
      const step = v.speed * dt;
      const dx = (v.tx ?? v.x) - v.x, dy = (v.ty ?? v.y) - v.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5){
        const ux = dx/dist, uy = dy/dist;
        const mv = Math.min(step, dist);
        v.x += ux*mv; v.y += uy*mv;
        energySpent += mv * (v.energyCost || 0);
      } else {
        if (v.state === 'returning' || v.state === 'unloading'){
          const base = bases.find(b=>b.id===v.targetBase);
          if (base && Math.hypot(v.x-base.x, v.y-base.y) < 30){
            if (v.state !== 'unloading'){
              v.state = 'unloading';
              v.unloadTimer = 2000;
            } else {
              v.unloadTimer -= CFG.TICK_MS;
              if (v.unloadTimer <= 0){
                if (v.carryType){ pl[v.carryType] = (pl[v.carryType]||0) + v.carrying; }
                v.carrying = 0; v.carryType=null; v.state='idle'; v.targetRes=null; v.targetBase=null;
              }
            }
          }
        }
      }

      // Harvest
      if (v.carrying >= v.capacity){
        if (v.state !== 'returning' && v.state !== 'unloading'){
          const b = nearestBase(pl, v.x, v.y);
          if (b){ v.state='returning'; v.tx=b.x; v.ty=b.y; v.targetRes=null; v.targetBase=b.id; }
        }
      } else if (v.targetRes){
        const r = resources.find(r => r.id === v.targetRes);
        if (r && r.amount > 0){
          const d = Math.hypot(r.x - v.x, r.y - v.y);
          if (d <= CFG.RESOURCE_RADIUS){
            v.state = 'harvesting';
            const take = Math.min(harvestStep, v.capacity - v.carrying, r.amount);
            if (take > 0){ v.carryType = v.carryType || r.type; v.carrying += take; r.amount -= take; }
            if (v.carrying >= v.capacity || r.amount <= 0){
              const b = nearestBase(pl, v.x, v.y);
              if (b){ v.state='returning'; v.tx=b.x; v.ty=b.y; v.targetRes=null; v.targetBase=b.id; }
            }
          }
        } else {
          v.state = 'idle'; v.targetRes = null;
        }
      }

      // Attack bases
      for (const b of bases){
        if (b.owner === pid) continue;
        const d = Math.hypot(b.x - v.x, b.y - v.y);
        if (d < CFG.BASE_ATTACK_RANGE){
          b.hp -= (v.damage||0) * (v.rof||0) * dt;
          b.lastAttacker = pid;
        }
      }
    }

    // Remove dead vehicles from attacks
    pl.vehicles = pl.vehicles.filter(v => v.hp > 0);

    // Energy
    pl.energy = clamp(pl.energy - energySpent + rechargeStep, 0, CFG.ENERGY_MAX);
  }

  // Bases attack vehicles
  for (const b of bases){
    const dps = (b.damage||0) * (b.rof||0);
    for (const pid in players){
      if (b.owner && pid === b.owner) continue;
      for (const v of players[pid].vehicles){
        const d = Math.hypot(v.x - b.x, v.y - b.y);
        if (d < CFG.BASE_ATTACK_RANGE){
          v.hp -= dps * dt;
        }
      }
    }
  }

  // Remove dead vehicles after base attacks
  for (const pid in players){
    players[pid].vehicles = players[pid].vehicles.filter(v => v.hp > 0);
  }

  // Capture bases
  resolveCaptures();

  // Broadcast snapshot
  const snap = JSON.stringify({ type: 'state', state: snapshotState() });
  for (const client of wss.clients){ if (client.readyState === WebSocket.OPEN) client.send(snap); }
}

if (process.env.NODE_ENV !== 'test'){
  setInterval(gameLoop, CFG.TICK_MS);
}

// ------------------ STATIC + START ------------------
// Serve SVG asset sheet for client-side icon rendering
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/cfg.json', (_req, res) =>
  res.json({
    VIEW_W: 1000,
    VIEW_H: 700,
    BASE_ICON_SIZE,
    VEHICLE_ICON_SIZE,
    RESOURCE_ICON_SIZE,
    TILE_SIZE: CFG.TILE_SIZE,
  })
);

if (process.env.NODE_ENV !== 'test'){
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`TileArmy server running: http://localhost:${PORT}`));
}

module.exports = { CFG, players, bases, processManufacturing, resolveCaptures, gameLoop };
