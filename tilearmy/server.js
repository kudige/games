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
const MAPSIZE = parseInt(process.env.MAPSIZE, 10) || 10;
const PLENTIFUL = parseInt(process.env.PLENTIFUL, 10) || 4;
const CROWD = parseInt(process.env.CROWD, 10) || 3;
const CFG = {
  TILE_SIZE: parseInt(process.env.TILE_SIZE, 10) || 32,
  MAP_W: 4000 * MAPSIZE,
  MAP_H: 3000 * MAPSIZE,
  MAPSIZE,
  TICK_MS: 50,
  RESOURCE_TYPES: ['ore', 'lumber', 'stone'],
  PLENTIFUL,
  RESOURCE_COUNT: PLENTIFUL * 15 * MAPSIZE * MAPSIZE,
  CROWD,
  RESOURCE_AMOUNT: 1000,     // per field
  RESOURCE_RADIUS: 22,
  HARVEST_SEARCH_RADIUS: 300, // search radius for auto-harvest chaining
  HARVEST_RATE: 40,          // units/sec
  ENERGY_MAX: 100,           // player energy cap
  ENERGY_RECHARGE: 15,       // energy/sec auto recharge
  OFFLINE_TIMEOUT: parseInt(process.env.OFFLINE_TIMEOUT_MS, 10) || 2 * 60 * 1000, // ms before offline players dock
  UNLOAD_TIME: 1000,         // ms to unload at base
  BASE_ATTACK_RANGE: 150,
  BASE_HP: 200,
  BASE_DAMAGE: 15,
  BASE_ROF: 1,
  NEUTRAL_BASE_HP: 150,
  NEUTRAL_BASE_DAMAGE: 5,
  NEUTRAL_BASE_ROF: 0.5,
  // Vehicles unlocked at each base level. Higher levels can spawn all
  // vehicles from previous tiers.
  BASE_LEVEL_VEHICLES: {
    1: ['scout'],
    2: ['hauler', 'lightTank'],
    3: ['basic', 'heavyTank'],
    4: ['transport'],
  },
  VEHICLE_TYPES: {
    scout:   { speed: 260, capacity: 120, energy: 0.015, hp: 60,  damage: 6,  rof: 1,   build: 1, cost: 800 },
    hauler:  { speed: 180, capacity: 400, energy: 0.03,  hp: 140, damage: 12, rof: 0.8, build: 3, cost: 1500 },
    basic:   { speed: 220, capacity: 200, energy: 0.02,  hp: 100, damage: 8,  rof: 1,   build: 2, cost: 1000 },
    lightTank: { speed: 200, capacity: 0,   energy: 0.04, hp: 180, damage: 20, rof: 1.2, build: 4, cost: 2000 },
    heavyTank: { speed: 150, capacity: 0,   energy: 0.06, hp: 300, damage: 35, rof: 0.8, build: 6, cost: 3500 },
    transport: { speed: 150, capacity: 1000, energy: 0.05, hp: 200, damage: 0, rof: 0, build: 8, cost: 5000, harvestRate: 200, unloadTime: 0 },
  },
};

// ------------------ SERVER STATE ------------------
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const players = Object.create(null); // { id: { bases, vehicles, color, ore, lumber, stone, energy } }
const resources = []; // [{id,type,x,y,amount}]
const bases = []; // [{id,x,y,owner,hp,damage,rof,level,queue}]
const connections = Object.create(null); // playerId -> ws
let seeded = false;

function vehiclesForBaseLevel(level){
  const allowed = [];
  for (let l = 1; l <= level; l++){
    for (const v of CFG.BASE_LEVEL_VEHICLES[l] || []){
      if (!allowed.includes(v)) allowed.push(v);
    }
  }
  return allowed;
}

function baseUpgradeCost(level){
  return { lumber: 200 * level, stone: 150 * level };
}

function applyBaseStats(base){
  const lvl = base.level || 1;
  base.damage = CFG.BASE_DAMAGE + (lvl - 1) * 5;
  base.rof = CFG.BASE_ROF;
  base.hp = CFG.BASE_HP + (lvl - 1) * 100;
}

function upgradeBase(playerId, baseId){
  const pl = players[playerId]; if (!pl) return false;
  const b = bases.find(b => b.id === baseId && b.owner === playerId); if (!b) return false;
  const lvl = b.level || 1;
  const cost = baseUpgradeCost(lvl);
  if ((pl.lumber || 0) < cost.lumber || (pl.stone || 0) < cost.stone) return false;
  pl.lumber -= cost.lumber;
  pl.stone -= cost.stone;
  b.level = lvl + 1;
  applyBaseStats(b);
  return true;
}

function spawnVehicle(playerId, baseId, vType){
  const pl = players[playerId]; if (!pl) return { ok: false, msg: 'Player not found' };
  const base = bases.find(b => b.id === baseId && b.owner === playerId); if (!base) return { ok: false, msg: 'Base not found' };
  const lvl = base.level || 1;
  const allowed = vehiclesForBaseLevel(lvl);
  if (!allowed.includes(vType)) return { ok: false, msg: 'Vehicle not available at this base level' };
  const vt = CFG.VEHICLE_TYPES[vType];
  if (!vt) return { ok: false, msg: 'Unknown vehicle type' };
  if (pl.ore < vt.cost) return { ok: false, msg: 'Not enough ore to spawn vehicle' };
  pl.ore -= vt.cost;
  const readyAt = Date.now() + (vt.build || 0) * 1000;
  if (!base.queue) base.queue = [];
  base.queue.push({ vType, readyAt });
  return { ok: true, msg: `Vehicle manufacturing (${vt.build || 0}s)` };
}

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

function spawnNeutralBases(count){
  for (let i=0;i<count;i++){
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
      level: 1,
      queue: []
    });
  }
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
      UNLOAD_TIME: CFG.UNLOAD_TIME,
      VEHICLE_TYPES: CFG.VEHICLE_TYPES,
      BASE_LEVEL_VEHICLES: CFG.BASE_LEVEL_VEHICLES,
      BASE_ICON_SIZE,
      VEHICLE_ICON_SIZE,
      RESOURCE_ICON_SIZE,
      BASE_HP: CFG.BASE_HP,
      NEUTRAL_BASE_HP: CFG.NEUTRAL_BASE_HP,
      BASE_ATTACK_RANGE: CFG.BASE_ATTACK_RANGE
    },
    resources,
    players,
    bases
  };
}

function diffState(prev, curr) {
  const changed = [];

  const diffObj = (prevObj, currObj) => {
    const diff = {};
    if (!currObj) return diff;
    for (const k in currObj) {
      if (!prevObj || JSON.stringify(currObj[k]) !== JSON.stringify(prevObj[k])) {
        diff[k] = currObj[k];
      }
    }
    return diff;
  };

  // World resources
  const prevRes = Object.create(null);
  for (const r of prev.resources || []) prevRes[r.id] = r;
  const currRes = Object.create(null);
  for (const r of curr.resources || []) currRes[r.id] = r;
  for (const id in currRes) {
    const r = currRes[id];
    const pr = prevRes[id];
    const diff = diffObj(pr, r);
    delete diff.id;
    if (Object.keys(diff).length) changed.push({ kind: 'resource', id: r.id, ...diff });
    delete prevRes[id];
  }
  for (const id in prevRes) changed.push({ kind: 'resource', id, removed: true });

  // Bases
  const prevBases = Object.create(null);
  for (const b of prev.bases || []) prevBases[b.id] = b;
  const currBases = Object.create(null);
  for (const b of curr.bases || []) currBases[b.id] = b;
  for (const id in currBases) {
    const b = currBases[id];
    const pb = prevBases[id];
    const diff = diffObj(pb, b);
    delete diff.id;
    if (Object.keys(diff).length) changed.push({ kind: 'base', id: b.id, ...diff });
    delete prevBases[id];
  }
  for (const id in prevBases) changed.push({ kind: 'base', id, removed: true });

  // Players -> split into metadata, resources, and vehicles
  const prevPlayers = { ...(prev.players || {}) };
  const currPlayers = curr.players || {};

  const pickMeta = (p) => {
    if (!p) return undefined;
    const { ore, lumber, stone, energy, vehicles, ...meta } = p;
    return meta;
  };
  const pickRes = (p) => {
    if (!p) return undefined;
    const { ore, lumber, stone, energy } = p;
    return { ore, lumber, stone, energy };
  };

  for (const id in currPlayers) {
    const p = currPlayers[id];
    const pp = prevPlayers[id];

    // Player metadata
    const metaDiff = diffObj(pickMeta(pp), pickMeta(p));
    if (Object.keys(metaDiff).length) changed.push({ kind: 'player', id, ...metaDiff });

    // Player resources
    const resDiff = diffObj(pickRes(pp), pickRes(p));
    if (Object.keys(resDiff).length) changed.push({ kind: 'resource', id, ...resDiff });

    // Vehicles
    const prevVeh = Object.create(null);
    if (pp && pp.vehicles) for (const v of pp.vehicles) prevVeh[v.id] = v;
    const currVeh = Object.create(null);
    for (const v of p.vehicles || []) currVeh[v.id] = v;
    for (const vid in currVeh) {
      const cv = currVeh[vid];
      const pv = prevVeh[vid];
      const vDiff = diffObj(pv, cv);
      delete vDiff.id;
      if (Object.keys(vDiff).length) changed.push({ kind: 'vehicle', owner: id, id: vid, ...vDiff });
      delete prevVeh[vid];
    }
    for (const vid in prevVeh) changed.push({ kind: 'vehicle', owner: id, id: vid, removed: true });

    delete prevPlayers[id];
  }

  // Removed players
  for (const id in prevPlayers) {
    const pp = prevPlayers[id];
    changed.push({ kind: 'player', id, removed: true });
    changed.push({ kind: 'resource', id, removed: true });
    if (pp.vehicles) {
      for (const v of pp.vehicles) changed.push({ kind: 'vehicle', owner: id, id: v.id, removed: true });
    }
  }

  return changed;
}

let lastSnapshot = JSON.parse(JSON.stringify(snapshotState()));
let lastSnapshotTime = Date.now();

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

// Handle new WebSocket connections. The client supplies a player name via query
// string (?name=foo). The name acts as a persistent ID so returning players can
// continue where they left off, and two players cannot share the same name.
wss.on('connection', (ws, req) => {
  seedResources();
  
  const params = new URL(req.url, 'http://localhost');
  const id = params.searchParams.get('name');
  if (!id) {
    ws.send(JSON.stringify({ type: 'error', msg: 'Name required' }));
    ws.close();
    return;
  }

  // If the name already has an active connection, reject the newcomer
  if (connections[id] && connections[id].readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', msg: 'Name taken' }));
    ws.close();
    return;
  }

  // New player
  if (!players[id]) {
    const bx = Math.floor(rand(200, CFG.MAP_W - 200) / CFG.TILE_SIZE);
    const by = Math.floor(rand(200, CFG.MAP_H - 200) / CFG.TILE_SIZE);
    const base = {
      id: newId(6),
      x: bx * CFG.TILE_SIZE,
      y: by * CFG.TILE_SIZE,
      owner: id,
      level: 1,
      queue: [],
      name: `${id} Home`
    };
    applyBaseStats(base);
    bases.push(base);
    spawnNeutralBases(CFG.CROWD);
    players[id] = {
      bases: [base.id],
      vehicles: [],
      color: `hsl(${Math.floor(rand(0,360))} 70% 55%)`,
      ore: 2000, // start with some ore
      lumber: 0,
      stone: 0,
      energy: CFG.ENERGY_MAX,
      disconnectedAt: null,
      offline: false
    };
  }

  players[id].disconnectedAt = null;
  players[id].offline = false;
  connections[id] = ws;

  ws.send(JSON.stringify({ type: 'init', id, state: snapshotState() }));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const me = players[id]; if (!me) return;

    if (msg.type === 'spawnVehicle') {
      const res = spawnVehicle(id, msg.baseId, msg.vType || 'basic');
      ws.send(JSON.stringify({ type: 'notice', ok: res.ok, msg: res.msg }));
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
    else if (msg.type === 'upgradeBase') {
      const ok = upgradeBase(id, msg.baseId);
      if (ok) ws.send(JSON.stringify({ type: 'notice', ok: true, msg: 'Base upgraded' }));
      else ws.send(JSON.stringify({ type: 'notice', ok: false, msg: 'Not enough resources to upgrade base' }));
    }
  });

  ws.on('close', () => handleDisconnect(id, ws));
});

function handleDisconnect(id, ws){
  // Keep player state so they can reconnect later; just remove the socket
  if (connections[id] === ws) {
    delete connections[id];
    if (players[id]) players[id].disconnectedAt = Date.now();
  }
}

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
        harvestRate: vt.harvestRate,
        unloadTime: vt.unloadTime,
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
      b.level = 1;
      applyBaseStats(b);
      if (prev && players[prev]){
        players[prev].bases = players[prev].bases.filter(id=>id!==b.id);
      }
      if (players[att]){
        if (!players[att].bases.includes(b.id)) players[att].bases.push(b.id);
        const idx = players[att].bases.indexOf(b.id);
        b.name = idx === 0 ? `${att} Home` : `${att} Base ${idx}`;
        const ws = connections[att];
        if (ws && ws.readyState === WebSocket.OPEN){
          ws.send(JSON.stringify({ type: 'notice', ok: true, msg: `Congratulations, you have conquered base ${b.name}!` }));
        }
      }
      delete b.lastAttacker;
    }
  }
}

function gameLoop(){
  const dt = CFG.TICK_MS/1000;
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
    if (pl.disconnectedAt && now - pl.disconnectedAt >= CFG.OFFLINE_TIMEOUT) {
      pl.offline = true;
    }

    let energySpent = 0;

    for (const v of pl.vehicles){
      if (pl.offline){
        const b = nearestBase(pl, v.x, v.y);
        if (b){
          const dist = Math.hypot(b.x - v.x, b.y - v.y);
          if (dist > 30 && v.state !== 'returning' && v.state !== 'unloading'){
            v.state = 'returning';
            v.targetRes = null;
            v.tx = b.x;
            v.ty = b.y;
            v.targetBase = b.id;
          }
        }
      }

      // Auto-target resources
      if (!pl.offline && v.capacity > 0 && v.state === 'idle' && v.carrying < v.capacity){
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
              v.unloadTimer = v.unloadTime ?? CFG.UNLOAD_TIME;
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
      if (v.capacity > 0){
        const harvestStep = (v.harvestRate || CFG.HARVEST_RATE) * dt;
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

  // Broadcast only changed entities at most once per second
  const state = snapshotState();
  const changed = diffState(lastSnapshot, state);
  if (changed.length && now - lastSnapshotTime >= 1000) {
    const snap = JSON.stringify({ type: 'update', entities: changed });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(snap);
    }
    lastSnapshot = JSON.parse(JSON.stringify(state));
    lastSnapshotTime = now;
  }
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

module.exports = {
  CFG,
  players,
  bases,
  resources,
  connections,
  processManufacturing,
  resolveCaptures,
  gameLoop,
  handleDisconnect,
  upgradeBase,
  baseUpgradeCost,
  spawnVehicle,
  wss,
};
