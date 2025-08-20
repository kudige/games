/**
 * Jeep MMO Server (Express + ws)
 * --------------------------------
 * - Serves the client HTML and static assets (sprite sheets)
 * - WebSocket endpoint on the same port for realtime state
 * - Multiple players, per-client vehicle selection & ownership
 * - Broadcasts world state (all players) at 20 Hz
 * - Provides /vehicles.json describing available vehicles
 */

const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// --- World / physics config ---
const MAP_SIZE = 24;          // world is [0..MAP_SIZE]
const BASE_MAX_SPEED = 3.0;   // wu/s (fallback)
const ACCEL = 6.0;            // wu/s^2
const DECEL_RADIUS = 1.2;     // wu (start slowing down when this close)
const ARRIVE_EPS = 0.02;      // wu

// --- Vehicle registry ---
// Extend this list with more vehicles; sprites should exist under ./public
const VEHICLES = [
  { id: 0, name: 'Scout Jeep',     sprite: 'vehicle_sprite[0].png', speed: 3.6 },
  { id: 1, name: 'Hauler',         sprite: 'vehicle_sprite[1].png', speed: 2.8 },
  { id: 2, name: 'Hummer',         sprite: 'vehicle_sprite[2].png', speed: 3.2 },
  { id: 3, name: 'Recon Buggy',    sprite: 'vehicle_sprite[3].png', speed: 3.9 },
  { id: 4, name: 'APC',            sprite: 'vehicle_sprite[4].png', speed: 2.6 },
  { id: 5, name: 'Engineer Rig',   sprite: 'vehicle_sprite[5].png', speed: 2.4 },
];
function getVehicle(id){ return VEHICLES.find(v => v.id === id) || null; }

// --- Server setup (Express + ws) ---
const app = express();
app.set('trust proxy', true);
app.use(express.static(path.join(__dirname, 'public'), { fallthrough: true, index: ['index.html'] }));

// Health & config
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));
app.get('/config', (_req, res) => res.json({ mapSize: MAP_SIZE }));
app.get('/vehicles.json', (_req, res) => res.json({ vehicles: VEHICLES }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- Player state ---
let nextId = 1;
const players = new Map(); // ws -> player

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function rand(min, max){ return Math.random() * (max - min) + min; }

function spawnPosition(){
  // spawn somewhere within map with a margin
  const m = 1.25;
  return { x: rand(m, MAP_SIZE - m), y: rand(m, MAP_SIZE - m) };
}

function stepPlayer(p, dt){
  const dx = p.destX - p.x;
  const dy = p.destY - p.y;
  const dist = Math.hypot(dx, dy);

  const maxSpeed = p.maxSpeed || BASE_MAX_SPEED;
  let targetSpeed = maxSpeed;
  if (dist < DECEL_RADIUS) targetSpeed = maxSpeed * (dist / DECEL_RADIUS);
  if (dist < ARRIVE_EPS) { p.x = p.destX; p.y = p.destY; p.speed = 0; return; }

  // Accelerate/decelerate toward target speed
  if (p.speed < targetSpeed) p.speed = Math.min(targetSpeed, p.speed + ACCEL * dt);
  else if (p.speed > targetSpeed) p.speed = Math.max(targetSpeed, p.speed - ACCEL * dt);

  // Integrate
  const ux = dx / dist, uy = dy / dist;
  p.x += ux * p.speed * dt;
  p.y += uy * p.speed * dt;
  p.heading = Math.atan2(uy, ux);

  // Clamp to bounds
  p.x = clamp(p.x, 0, MAP_SIZE);
  p.y = clamp(p.y, 0, MAP_SIZE);
}

function playerSnapshot(p){
  return {
    id: p.id,
    vehicleId: p.vehicleId,
    x: p.x, y: p.y,
    heading: p.heading,
    speed: p.speed,
    destX: p.destX, destY: p.destY
  };
}

function worldSnapshot(){
  return {
    type: 'world',
    t: Date.now(),
    mapSize: MAP_SIZE,
    players: Array.from(players.values()).map(playerSnapshot)
  };
}

function send(ws, obj){ try { ws.send(JSON.stringify(obj)); } catch {/* noop */} }
function broadcast(obj){
  const str = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) { try { ws.send(str); } catch {/* noop */} }
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const id = String(nextId++);
  const p = {
    id,
    vehicleId: null,
    maxSpeed: BASE_MAX_SPEED,
    ...spawnPosition(),
    heading: Math.PI * 0.25,
    speed: 0,
    destX: 0, destY: 0
  };
  p.destX = p.x; p.destY = p.y; // stationary at spawn initially

  players.set(ws, p);

  // initial messages
  send(ws, { type: 'welcome', selfId: id, mapSize: MAP_SIZE });
  send(ws, worldSnapshot());

  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'choose') {
      const vid = Number(msg.vehicleId);
      const vehicle = getVehicle(vid);
      p.vehicleId = vehicle ? vehicle.id : 0;
      p.maxSpeed = vehicle ? (vehicle.speed || BASE_MAX_SPEED) : BASE_MAX_SPEED;
      const s = spawnPosition();
      p.x = s.x; p.y = s.y; p.destX = s.x; p.destY = s.y; p.speed = 0;
      broadcast(worldSnapshot());
      return;
    }

    if (msg.type === 'click') {
      if (p.vehicleId == null) return; // must choose first
      if (typeof msg.x === 'number' && typeof msg.y === 'number') {
        p.destX = clamp(msg.x, 0, MAP_SIZE);
        p.destY = clamp(msg.y, 0, MAP_SIZE);
        broadcast(worldSnapshot());
      }
      return;
    }
  });

  ws.on('close', () => {
    players.delete(ws);
    broadcast(worldSnapshot());
  });
});

// Simulation & broadcast loop
let last = Date.now();
let sinceBroadcast = 0;
const BROADCAST_DT = 1/20; // 20 Hz
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const p of players.values()) stepPlayer(p, dt);
  sinceBroadcast += dt;
  if (sinceBroadcast >= BROADCAST_DT) { sinceBroadcast = 0; broadcast(worldSnapshot()); }
}, 1000/60);

// Heartbeat to kill dead sockets
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 30000);

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
