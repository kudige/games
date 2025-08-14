// TileArmy — Client (Canvas)
(async function(){
  const res = await fetch('/cfg.json').then(r=>r.json()).catch(()=>({VIEW_W:1000,VIEW_H:700}));
  const cfg = { VIEW_W: res.VIEW_W, VIEW_H: res.VIEW_H };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const vehiclesDiv = document.getElementById('vehicles');
  const pidEl = document.getElementById('pid');
  const resEl = document.getElementById('resCount');
  const energyFill = document.getElementById('energyFill');
  const toast = document.getElementById('toast');
  const vTypeSel = document.getElementById('vehicleType');

  function showToast(text){ toast.textContent = text; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'), 1500); }

  const ws = new WebSocket((location.protocol === 'https:'? 'wss://' : 'ws://') + location.host);

  let myId = null;
  let state = { players:{}, resources:[], cfg:{ MAP_W:2000, MAP_H:2000, RESOURCE_AMOUNT:1000, ENERGY_MAX:100, VEHICLE_TYPES:{} } };
  let selected = null; // vehicle id

  // Camera
  const camera = { x: 0, y: 0, lerp: 0.15, follow: true };
  const keys = {};
  document.getElementById('toggleFollow').onclick = () => {
    camera.follow = !camera.follow;
    document.getElementById('toggleFollow').textContent = 'Follow: ' + (camera.follow ? 'On' : 'Off');
  };

  function focusOn(x,y){
    const targetX = x - canvas.width/2;
    const targetY = y - canvas.height/2;
    camera.x += (targetX - camera.x) * camera.lerp;
    camera.y += (targetY - camera.y) * camera.lerp;
    camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width));
    camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height));
  }

  // Dashboard
  function rebuildDashboard() {
    vehiclesDiv.innerHTML = '';
    const me = state.players[myId];
    if (!me) return;
    resEl.textContent = Math.floor(me.resources||0);
    const energy = me.energy||0; const pct = (state.cfg.ENERGY_MAX? (energy/state.cfg.ENERGY_MAX):0)*100; energyFill.style.width = pct + '%';
    me.vehicles.forEach(v => {
      const b = document.createElement('button');
      b.textContent = v.id + ' ' + (v.type||'') + (v.state==='returning'?' ↩':'') + (v.state==='harvesting'?' ⛏':'');
      if (selected === null) selected = v.id; // auto-select first
      if (selected === v.id) b.classList.add('selected');
      b.onclick = () => { selected = v.id; rebuildDashboard(); };
      vehiclesDiv.appendChild(b);
    });
  }

  function refreshVehicleTypes(){
    if (!vTypeSel) return;
    vTypeSel.innerHTML = '';
    const types = state.cfg.VEHICLE_TYPES || {};
    Object.keys(types).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t + ` (-${types[t].cost})`;
      vTypeSel.appendChild(opt);
    });
  }

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'init') {
      myId = msg.id; state = msg.state || state; pidEl.textContent = 'Player ' + myId; refreshVehicleTypes(); rebuildDashboard();
    } else if (msg.type === 'state') {
      state = msg.state || state;
      const cur = (state.players[myId]?.vehicles || []).map(v=>v.id+v.state+Math.floor(v.carrying||0)).join(',') + '|' + Math.floor(state.players[myId]?.resources||0) + '|' + Math.floor(state.players[myId]?.energy||0);
      if (rebuildDashboard._last !== cur) { rebuildDashboard._last = cur; rebuildDashboard(); }
    } else if (msg.type === 'notice') {
      showToast(msg.msg || (msg.ok?'OK':'Error'));
    }
  };

  document.getElementById('spawn').onclick = () => {
    const vType = vTypeSel ? vTypeSel.value : undefined;
    ws.send(JSON.stringify({ type: 'spawnVehicle', vType }));
  };
  function toWorld(px,py){ return { x: px + camera.x, y: py + camera.y }; }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['w','a','s','d'].includes(k)) {
      keys[k] = true;
      camera.follow = false;
      e.preventDefault();
    } else if (k === 'h') {
      const me = state.players[myId];
      if (me) {
        camera.follow = false;
        camera.x = me.base.x - canvas.width/2;
        camera.y = me.base.y - canvas.height/2;
        camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width));
        camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height));
      }
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keys[k]) delete keys[k];
  });

  canvas.addEventListener('click', (e) => {
    if (!selected) return;
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (canvas.width / r.width);
    const sy = (e.clientY - r.top) * (canvas.height / r.height);
    const w = toWorld(sx, sy);
    ws.send(JSON.stringify({ type: 'moveVehicle', vehicleId: selected, x: w.x, y: w.y }));
  });

  function drawGrid(){
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    ctx.globalAlpha = 0.18; ctx.strokeStyle = '#4b528b';
    const step = 100;
    const x0 = Math.floor(camera.x/step)*step;
    const x1 = Math.min(state.cfg.MAP_W, camera.x + canvas.width + step);
    const y0 = Math.floor(camera.y/step)*step;
    const y1 = Math.min(state.cfg.MAP_H, camera.y + canvas.height + step);
    for (let x=x0; x<=x1; x+=step){ ctx.beginPath(); ctx.moveTo(x, camera.y); ctx.lineTo(x, camera.y + canvas.height); ctx.stroke(); }
    for (let y=y0; y<=y1; y+=step){ ctx.beginPath(); ctx.moveTo(camera.x, y); ctx.lineTo(camera.x + canvas.width, y); ctx.stroke(); }
    ctx.restore();
  }

  function drawResources(){
    ctx.save(); ctx.translate(-camera.x, -camera.y);
    for (const r of state.resources){
      if (r.amount <= 0) continue;
      const frac = r.amount / (state.cfg.RESOURCE_AMOUNT || 1);
      const hue = 20 + (140-20)*frac; // 140 (green) -> 20 (red)
      ctx.fillStyle = `hsl(${hue} 75% 60%)`;
      ctx.beginPath(); ctx.arc(r.x, r.y, 10, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayers(){
    ctx.save(); ctx.translate(-camera.x, -camera.y);
    for (const pid in state.players){
      const p = state.players[pid]; if (!p) continue;
      ctx.fillStyle = pid === myId ? '#ffc857' : p.color || '#ff6b6b';
      ctx.fillRect(p.base.x-18, p.base.y-18, 36, 36);
      for (const v of p.vehicles){
        ctx.beginPath();
        ctx.fillStyle = pid === myId ? '#9be9ff' : '#ffb3d1';
        ctx.arc(v.x, v.y, 10, 0, Math.PI*2); ctx.fill();
        // carrying bar
        const frac = (v.carrying || 0) / (v.capacity || 200);
        if (frac > 0){
          const W = 26, H = 5;
          ctx.fillStyle = '#111'; ctx.fillRect(v.x - W/2, v.y - 18, W, H);
          ctx.fillStyle = '#4ade80'; ctx.fillRect(v.x - W/2, v.y - 18, W*frac, H);
        }
        if (pid === myId && v.id === selected){
          ctx.beginPath(); ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 2; ctx.arc(v.x, v.y, 14, 0, Math.PI*2); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function updateCamera(){
    if (camera.follow){
      const me = state.players[myId]; if (!me) return;
      const v = me.vehicles.find(v=>v.id===selected) || me.vehicles[0];
      if (v) focusOn(v.x, v.y);
    } else {
      const step = 20;
      if (keys['w']) camera.y -= step;
      if (keys['s']) camera.y += step;
      if (keys['a']) camera.x -= step;
      if (keys['d']) camera.x += step;
      camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width));
      camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height));
    }
  }

  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    updateCamera();
    drawGrid();
    drawResources();
    drawPlayers();
    requestAnimationFrame(draw);
  }
  draw();
})();
