// TileArmy — Server (Express + ws)
// Run:
//   npm init -y && npm install express ws
//   node server.js
//   open http://localhost:3000

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// ------------------ CONFIG ------------------
const CFG = {
  MAP_W: 4000,
  MAP_H: 3000,
  TICK_MS: 50,
  SPEED: 220,                // px/sec
  RESOURCE_COUNT: 60,
  RESOURCE_AMOUNT: 1000,     // per field
  RESOURCE_RADIUS: 22,
  HARVEST_RATE: 40,          // units/sec
  VEHICLE_CAPACITY: 200,
  VEHICLE_COST: 1000,        // cost to spawn a vehicle
  ENERGY_MAX: 100,           // player energy cap
  ENERGY_RECHARGE: 15,       // energy/sec auto recharge
  ENERGY_MOVE_COST: 0.02     // energy per pixel moved (sum of all vehicles)
};

// ------------------ SERVER STATE ------------------
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const players = Object.create(null); // { id: { base, vehicles, color, resources, energy } }
const resources = []; // [{id,x,y,amount}]
let seeded = false;

function rand(min, max){ return Math.random() * (max - min) + min; }
function newId(len=9){ return Math.random().toString(36).slice(2, 2+len); }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

function seedResources(){
  if (seeded) return;
  for (let i=0;i<CFG.RESOURCE_COUNT;i++){
    resources.push({ id: newId(6), x: rand(80, CFG.MAP_W-80), y: rand(80, CFG.MAP_H-80), amount: CFG.RESOURCE_AMOUNT });
  }
  seeded = true;
}

function snapshotState(){
  return {
    cfg: {
      MAP_W: CFG.MAP_W, MAP_H: CFG.MAP_H,
      VEHICLE_CAPACITY: CFG.VEHICLE_CAPACITY,
      RESOURCE_AMOUNT: CFG.RESOURCE_AMOUNT,
      ENERGY_MAX: CFG.ENERGY_MAX
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
    resources: 1500, // start with some
    energy: CFG.ENERGY_MAX
  };

  ws.send(JSON.stringify({ type: 'init', id, state: snapshotState() }));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const me = players[id]; if (!me) return;

    if (msg.type === 'spawnVehicle') {
      if (me.resources >= CFG.VEHICLE_COST){
        me.resources -= CFG.VEHICLE_COST;
        me.vehicles.push({
          id: newId(5),
          x: me.base.x + 40,
          y: me.base.y,
          tx: me.base.x + 40,
          ty: me.base.y,
          carrying: 0,
          state: 'idle', // idle | harvesting | returning
          targetRes: null
        });
        ws.send(JSON.stringify({ type: 'notice', ok: true, msg: `Vehicle spawned (-${CFG.VEHICLE_COST})` }));
      } else {
        ws.send(JSON.stringify({ type: 'notice', ok: false, msg: 'Not enough resources to spawn vehicle' }));
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
  });

  ws.on('close', () => { delete players[id]; });
});

// ------------------ SIMULATION ------------------
setInterval(() => {
  const step = CFG.SPEED * (CFG.TICK_MS/1000);
  const harvestStep = CFG.HARVEST_RATE * (CFG.TICK_MS/1000);
  const rechargeStep = CFG.ENERGY_RECHARGE * (CFG.TICK_MS/1000);

  for (const pid in players){
    const pl = players[pid];
    let movedPixelsThisTick = 0;

    for (const v of pl.vehicles){
      // Auto-target nearest resource if idle and has capacity
      if (v.state === 'idle' && v.carrying < CFG.VEHICLE_CAPACITY){
        if (!v.targetRes || !resources.find(r => r.id===v.targetRes && r.amount>0)){
          let best=null, bd=Infinity;
          for (const r of resources){ if (r.amount<=0) continue; const d=Math.hypot(r.x-v.x, r.y-v.y); if (d<bd){bd=d; best=r;} }
          if (best){ v.targetRes = best.id; v.tx = best.x; v.ty = best.y; }
        }
      }

      // Move
      const dx = (v.tx ?? v.x) - v.x, dy = (v.ty ?? v.y) - v.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5){
        const ux = dx/dist, uy = dy/dist;
        const mv = Math.min(step, dist);
        v.x += ux*mv; v.y += uy*mv;
        movedPixelsThisTick += mv;
      } else {
        // Arrived at base when returning
        if (v.state === 'returning'){
          if (Math.hypot(v.x - pl.base.x, v.y - pl.base.y) < 30){
            pl.resources += v.carrying; v.carrying = 0; v.state = 'idle'; v.targetRes = null;
          }
        }
      }

      // Harvest
      if (v.carrying >= CFG.VEHICLE_CAPACITY){
        v.state = 'returning'; v.tx = pl.base.x; v.ty = pl.base.y; v.targetRes = null;
      } else if (v.targetRes){
        const r = resources.find(r => r.id === v.targetRes);
        if (r && r.amount > 0){
          const d = Math.hypot(r.x - v.x, r.y - v.y);
          if (d <= CFG.RESOURCE_RADIUS){
            v.state = 'harvesting';
            const take = Math.min(harvestStep, CFG.VEHICLE_CAPACITY - v.carrying, r.amount);
            if (take > 0){ v.carrying += take; r.amount -= take; }
            if (v.carrying >= CFG.VEHICLE_CAPACITY || r.amount <= 0){
              v.state = 'returning'; v.tx = pl.base.x; v.ty = pl.base.y; v.targetRes = null;
            }
          }
        } else {
          v.state = 'idle'; v.targetRes = null;
        }
      }
    }

    // Energy
    const spent = movedPixelsThisTick * CFG.ENERGY_MOVE_COST;
    pl.energy = clamp(pl.energy - spent + rechargeStep, 0, CFG.ENERGY_MAX);
  }

  // Broadcast snapshot
  const snap = JSON.stringify({ type: 'state', state: snapshotState() });
  for (const client of wss.clients){ if (client.readyState === WebSocket.OPEN) client.send(snap); }
}, CFG.TICK_MS);

// ------------------ STATIC + START ------------------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/cfg.json', (_req, res) => res.json({ VIEW_W: 1000, VIEW_H: 700 }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TileArmy server running: http://localhost:${PORT}`));
