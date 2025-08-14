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
const CFG = {
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
  VEHICLE_TYPES: {
    scout:   { speed: 260, capacity: 120, energy: 0.015, hp: 60,  cost: 800 },
    hauler:  { speed: 180, capacity: 400, energy: 0.03,  hp: 140, cost: 1500 },
    basic:   { speed: 220, capacity: 200, energy: 0.02,  hp: 100, cost: 1000 },
  },
};

// ------------------ SERVER STATE ------------------
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const players = Object.create(null); // { id: { base, vehicles, color, ore, lumber, stone, energy } }
const resources = []; // [{id,type,x,y,amount}]
let seeded = false;


function seedResources(){
  if (seeded) return;
  for (const type of CFG.RESOURCE_TYPES){
    for (let i=0;i<CFG.RESOURCE_COUNT;i++){
      resources.push({ id: newId(6), type, x: rand(80, CFG.MAP_W-80), y: rand(80, CFG.MAP_H-80), amount: CFG.RESOURCE_AMOUNT });
    }
  }
  seeded = true;
}

function snapshotState(){
  return {
    cfg: {
      MAP_W: CFG.MAP_W, MAP_H: CFG.MAP_H,
      RESOURCE_AMOUNT: CFG.RESOURCE_AMOUNT,
      RESOURCE_TYPES: CFG.RESOURCE_TYPES,
      RESOURCE_RADIUS: CFG.RESOURCE_RADIUS,
      HARVEST_SEARCH_RADIUS: CFG.HARVEST_SEARCH_RADIUS,
      ENERGY_MAX: CFG.ENERGY_MAX,
      VEHICLE_TYPES: CFG.VEHICLE_TYPES,
    },
    resources,
    players
  };
}

wss.on('connection', (ws) => {
  seedResources();
  const id = newId(8);
  const base = { x: rand(200, CFG.MAP_W-200), y: rand(200, CFG.MAP_H-200) };
  players[id] = {
    base,
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
      const vt = CFG.VEHICLE_TYPES[msg.vType] || CFG.VEHICLE_TYPES.basic;
      if (me.ore >= vt.cost){
        me.ore -= vt.cost;
        me.vehicles.push({
          id: newId(5),
          type: msg.vType || 'basic',
          speed: vt.speed,
          capacity: vt.capacity,
          energyCost: vt.energy,
          hp: vt.hp,
          x: me.base.x + 40,
          y: me.base.y,
          tx: me.base.x + 40,
          ty: me.base.y,
          carrying: 0,
          carryType: null,
          state: 'idle', // idle | harvesting | returning
          targetRes: null
        });
        ws.send(JSON.stringify({ type: 'notice', ok: true, msg: `Vehicle spawned (-${vt.cost})` }));
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

  ws.on('close', () => { delete players[id]; });
});

// ------------------ SIMULATION ------------------
setInterval(() => {
  const harvestStep = CFG.HARVEST_RATE * (CFG.TICK_MS/1000);
  const rechargeStep = CFG.ENERGY_RECHARGE * (CFG.TICK_MS/1000);

  // Track which resources are already claimed and avoid duplicates
  const claimed = new Set();
  for (const pid in players){
    for (const v of players[pid].vehicles){
      if (v.targetRes){
        if (claimed.has(v.targetRes)){
          v.state = 'idle';
          v.targetRes = null;
        } else {
          claimed.add(v.targetRes);
        }
      }
    }
  }

  for (const pid in players){
    const pl = players[pid];
    let energySpent = 0;

    for (const v of pl.vehicles){
      // Auto-target nearest unclaimed resource, prioritising preferred type
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
          if (v.preferType) {
            consider(v.preferType); // search entire map for preferred type
          } else {
            consider(null, CFG.HARVEST_SEARCH_RADIUS);
          }
          if (best){ v.targetRes = best.id; v.tx = best.x; v.ty = best.y; claimed.add(best.id); }
        }
      }

      // Move
      const step = v.speed * (CFG.TICK_MS/1000);
      const dx = (v.tx ?? v.x) - v.x, dy = (v.ty ?? v.y) - v.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5){
        const ux = dx/dist, uy = dy/dist;
        const mv = Math.min(step, dist);
        v.x += ux*mv; v.y += uy*mv;
        energySpent += mv * (v.energyCost || 0);
      } else {
        // Arrived at base when returning
        if (v.state === 'returning'){
          if (Math.hypot(v.x - pl.base.x, v.y - pl.base.y) < 30){
            if (v.carryType){
              pl[v.carryType] = (pl[v.carryType] || 0) + v.carrying;
            }
            v.carrying = 0; v.carryType = null; v.state = 'idle'; v.targetRes = null;
          }
        }
      }

      // Harvest
      if (v.carrying >= v.capacity){
        v.state = 'returning'; v.tx = pl.base.x; v.ty = pl.base.y; v.targetRes = null;
      } else if (v.targetRes){
        const r = resources.find(r => r.id === v.targetRes);
        if (r && r.amount > 0){
          const d = Math.hypot(r.x - v.x, r.y - v.y);
          if (d <= CFG.RESOURCE_RADIUS){
            v.state = 'harvesting';
            const take = Math.min(harvestStep, v.capacity - v.carrying, r.amount);
            if (take > 0){ v.carryType = v.carryType || r.type; v.carrying += take; r.amount -= take; }
            if (v.carrying >= v.capacity || r.amount <= 0){
              v.state = 'returning'; v.tx = pl.base.x; v.ty = pl.base.y; v.targetRes = null;
            }
          }
        } else {
          v.state = 'idle'; v.targetRes = null;
        }
      }
    }

    // Energy
    pl.energy = clamp(pl.energy - energySpent + rechargeStep, 0, CFG.ENERGY_MAX);
  }

  // Broadcast snapshot
  const snap = JSON.stringify({ type: 'state', state: snapshotState() });
  for (const client of wss.clients){ if (client.readyState === WebSocket.OPEN) client.send(snap); }
}, CFG.TICK_MS);

// ------------------ STATIC + START ------------------
// Serve SVG asset sheet for client-side icon rendering
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/cfg.json', (_req, res) => res.json({ VIEW_W: 1000, VIEW_H: 700 }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TileArmy server running: http://localhost:${PORT}`));
