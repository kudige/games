// TileArmy — Client (Canvas)
(async function(){
  const res = await fetch('/cfg.json').then(r=>r.json()).catch(()=>({VIEW_W:1000,VIEW_H:700,BASE_ICON_SIZE:32,VEHICLE_ICON_SIZE:32,RESOURCE_ICON_SIZE:32}));
  const sizes = [32,48,64];
  const nearest = val => sizes.reduce((a,b)=>Math.abs(b-val) < Math.abs(a-val) ? b : a);
  const cfg = { VIEW_W: res.VIEW_W, VIEW_H: res.VIEW_H };
  cfg.BASE_ICON_SIZE = nearest(Number(res.BASE_ICON_SIZE) || 32);
  cfg.VEHICLE_ICON_SIZE = nearest(Number(res.VEHICLE_ICON_SIZE) || 32);
  cfg.RESOURCE_ICON_SIZE = nearest(Number(res.RESOURCE_ICON_SIZE) || 32);

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const mapWrap = document.getElementById('mapWrap');
  const header = document.querySelector('header');
  function resizeCanvas(){
    canvas.width = mapWrap.clientWidth;
    const h = window.innerHeight - header.offsetHeight - 40;
    canvas.height = h > 0 ? h : 0;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  ctx.imageSmoothingEnabled = false;
  const vehiclesDiv = document.getElementById('vehicles');
  const pidEl = document.getElementById('pid');
  const oreEl = document.getElementById('oreCount');
  const lumberEl = document.getElementById('lumberCount');
  const stoneEl = document.getElementById('stoneCount');
  const energyFill = document.getElementById('energyFill');
  const toast = document.getElementById('toast');
  const vTypeSel = document.getElementById('vehicleType');
  const cursorInfo = document.getElementById('cursorInfo');

  // Load individual SVG icons and prepare helpers
  async function loadIconSheet(size){
    const ids = [
      'icon-iron-mine',
      'icon-lumber-mill',
      'icon-stone-quarry',
      'icon-home-base',
      'icon-vehicle-scout',
      'icon-vehicle-hauler',
      'icon-vehicle-hummer'
    ];
    const svgs = {};
    const dir = size === 64 ? '' : size + '/';
    await Promise.all(ids.map(async id => {
      svgs[id] = await fetch('/assets/' + dir + id + '.svg').then(r=>r.text());
    }));
    function makeImg(id, color){
      const txt = svgs[id];
      if (!txt) return new Image();
      const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (!svg) return new Image();
      if (color) svg.style.setProperty('--team', color);
      const ser = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(ser)));
      return img;
    }
    return { makeImg };
  }

  const baseSheet = await loadIconSheet(cfg.BASE_ICON_SIZE);
  const vehicleSheet = await loadIconSheet(cfg.VEHICLE_ICON_SIZE);
  const resourceSheet = await loadIconSheet(cfg.RESOURCE_ICON_SIZE);

  const images = {
    ore: resourceSheet.makeImg('icon-iron-mine'),
    lumber: resourceSheet.makeImg('icon-lumber-mill'),
    stone: resourceSheet.makeImg('icon-stone-quarry')
  };

  const teamIcons = {}; // cache per player
  function getTeamIcons(pid, color){
    if (!teamIcons[pid]){
      teamIcons[pid] = {
        base: baseSheet.makeImg('icon-home-base', color),
        scout: vehicleSheet.makeImg('icon-vehicle-scout', color),
        hauler: vehicleSheet.makeImg('icon-vehicle-hauler', color),
        basic: vehicleSheet.makeImg('icon-vehicle-hummer', color),
      };
    }
    return teamIcons[pid];
  }

  function showToast(text){ toast.textContent = text; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'), 1500); }

  const ws = new WebSocket((location.protocol === 'https:'? 'wss://' : 'ws://') + location.host);

  let myId = null;
  let state = { players:{}, resources:[], cfg:{ MAP_W:2000, MAP_H:2000, RESOURCE_AMOUNT:1000, ENERGY_MAX:100, VEHICLE_TYPES:{} } };
  let selected = null; // vehicle id or 'base'
  const renderVehicles = {}; // smoothed positions

  // Camera
  const camera = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: 6000,
    friction: 0.9,
    lerp: 0.15,
    follow: true,
    scale: 1
  };
  const keys = {};
  document.getElementById('toggleFollow').onclick = () => {
    camera.follow = !camera.follow;
    document.getElementById('toggleFollow').textContent = 'Follow: ' + (camera.follow ? 'On' : 'Off');
  };

  function focusOn(x,y){
    const targetX = x - (canvas.width / camera.scale) / 2;
    const targetY = y - (canvas.height / camera.scale) / 2;
    camera.x += (targetX - camera.x) * camera.lerp;
    camera.y += (targetY - camera.y) * camera.lerp;
    camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width / camera.scale));
    camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height / camera.scale));
  }

  // Dashboard
  function rebuildDashboard() {
    vehiclesDiv.innerHTML = '';
    const me = state.players[myId];
    if (!me) return;
    oreEl.textContent = Math.floor(me.ore||0);
    lumberEl.textContent = Math.floor(me.lumber||0);
    stoneEl.textContent = Math.floor(me.stone||0);
    const energy = me.energy||0; const pct = (state.cfg.ENERGY_MAX? (energy/state.cfg.ENERGY_MAX):0)*100; energyFill.style.width = pct + '%';
    me.vehicles.forEach(v => {
      const b = document.createElement('button');
      b.textContent = v.id + ' ' + (v.type||'') + (v.state==='returning'?' ↩':'') + (v.state==='harvesting'?' ⛏':'');
      if (selected === null) selected = v.id; // auto-select first
      if (selected === v.id) b.classList.add('selected');
      b.onclick = () => { selected = v.id; rebuildDashboard(); updateCursorInfo(); };
      vehiclesDiv.appendChild(b);
    });
    updateCursorInfo();
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
      myId = msg.id; state = msg.state || state; pidEl.textContent = 'Player ' + myId;
      const me = state.players[myId];
      if (me) {
        selected = 'base';
        camera.x = me.base.x - (canvas.width / camera.scale)/2;
        camera.y = me.base.y - (canvas.height / camera.scale)/2;
        camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width / camera.scale));
        camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height / camera.scale));
      }
      refreshVehicleTypes();
      rebuildDashboard();
      updateCursorInfo();
    } else if (msg.type === 'state') {
      state = msg.state || state;
      const p = state.players[myId] || {};
      const cur = (p.vehicles || []).map(v=>v.id+v.state+Math.floor(v.carrying||0)).join(',') + '|' + Math.floor(p.ore||0) + '|' + Math.floor(p.lumber||0) + '|' + Math.floor(p.stone||0) + '|' + Math.floor(p.energy||0);
      if (rebuildDashboard._last !== cur) { rebuildDashboard._last = cur; rebuildDashboard(); }
    } else if (msg.type === 'notice') {
      showToast(msg.msg || (msg.ok?'OK':'Error'));
    }
  };

  document.getElementById('spawn').onclick = () => {
    const vType = vTypeSel ? vTypeSel.value : undefined;
    ws.send(JSON.stringify({ type: 'spawnVehicle', vType }));
  };
  function toWorld(px,py){
    return { x: px / camera.scale + camera.x, y: py / camera.scale + camera.y };
  }
  let mousePx = 0, mousePy = 0;
  function updateCursorInfo(){
    if (!cursorInfo) return;
    const w = toWorld(mousePx, mousePy);
    const x = w.x.toFixed(1);
    const y = w.y.toFixed(1);
    let text = `${x}, ${y}`;
    const me = state.players[myId];
    if (me){
      let ox, oy;
      if (selected === 'base'){
        ox = me.base.x; oy = me.base.y;
      } else {
        const v = me.vehicles.find(v=>v.id===selected);
        if (v){ ox = v.x; oy = v.y; }
      }
      if (ox !== undefined){
        const d = Math.hypot(w.x - ox, w.y - oy);
        text += ` | ${d.toFixed(1)}`;
      }
    }
    cursorInfo.textContent = text;
  }
  function zoom(factor){
    const prev = camera.scale;
    camera.scale = Math.max(0.5, Math.min(3, camera.scale * factor));
    const mx = camera.x + (canvas.width / prev)/2;
    const my = camera.y + (canvas.height / prev)/2;
    camera.x = mx - (canvas.width / camera.scale)/2;
    camera.y = my - (canvas.height / camera.scale)/2;
    camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width / camera.scale));
    camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height / camera.scale));
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const map = { arrowup:'w', arrowdown:'s', arrowleft:'a', arrowright:'d' };
    if (['w','a','s','d'].includes(k) || map[k]) {
      keys[map[k] || k] = true;
      camera.follow = false;
      e.preventDefault();
    } else if (k === '+' || k === '=') {
      zoom(1.2);
      e.preventDefault();
    } else if (k === '-') {
      zoom(1/1.2);
      e.preventDefault();
    } else if (k === 'f') {
      if (!document.fullscreenElement) {
        canvas.requestFullscreen().catch(()=>{});
      } else {
        document.exitFullscreen().catch(()=>{});
      }
      e.preventDefault();
    } else if (k === 'h') {
      const me = state.players[myId];
      if (me) {
        selected = 'base';
        rebuildDashboard();
        camera.follow = false;
        camera.x = me.base.x - (canvas.width / camera.scale)/2;
        camera.y = me.base.y - (canvas.height / camera.scale)/2;
        camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width / camera.scale));
        camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height / camera.scale));
        updateCursorInfo();
      }
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    const map = { arrowup:'w', arrowdown:'s', arrowleft:'a', arrowright:'d' };
    const mk = map[k] || k;
    if (keys[mk]) delete keys[mk];
  });

  canvas.addEventListener('click', (e) => {
    if (!selected || selected === 'base') return;
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (canvas.width / r.width);
    const sy = (e.clientY - r.top) * (canvas.height / r.height);
    const w = toWorld(sx, sy);
    const rr = state.cfg.RESOURCE_RADIUS || 22;
    const res = state.resources.find(res => Math.hypot(res.x - w.x, res.y - w.y) <= rr);
    if (res) {
      ws.send(JSON.stringify({ type: 'harvestResource', vehicleId: selected, resourceId: res.id }));
    } else {
      ws.send(JSON.stringify({ type: 'moveVehicle', vehicleId: selected, x: w.x, y: w.y }));
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mousePx = (e.clientX - r.left) * (canvas.width / r.width);
    mousePy = (e.clientY - r.top) * (canvas.height / r.height);
    updateCursorInfo();
  });

  function smoothVehiclePositions(){
    const seen = new Set();
    const smooth = 0.25;
    for (const pid in state.players){
      const p = state.players[pid]; if (!p) continue;
      for (const v of p.vehicles){
        let rv = renderVehicles[v.id];
        if (!rv){ rv = { x: v.x, y: v.y }; renderVehicles[v.id] = rv; }
        rv.x += (v.x - rv.x) * smooth;
        rv.y += (v.y - rv.y) * smooth;
        seen.add(v.id);
      }
    }
    for (const id in renderVehicles){ if (!seen.has(id)) delete renderVehicles[id]; }
  }

  function drawGrid(){
    ctx.save();
    ctx.translate(-camera.x * camera.scale, -camera.y * camera.scale);
    ctx.scale(camera.scale, camera.scale);
    ctx.globalAlpha = 0.18; ctx.strokeStyle = '#4b528b';
    const step = 100;
    const x0 = Math.floor(camera.x/step)*step;
    const x1 = Math.min(state.cfg.MAP_W, camera.x + canvas.width / camera.scale + step);
    const y0 = Math.floor(camera.y/step)*step;
    const y1 = Math.min(state.cfg.MAP_H, camera.y + canvas.height / camera.scale + step);
    for (let x=x0; x<=x1; x+=step){ ctx.beginPath(); ctx.moveTo(x, camera.y); ctx.lineTo(x, camera.y + canvas.height / camera.scale); ctx.stroke(); }
    for (let y=y0; y<=y1; y+=step){ ctx.beginPath(); ctx.moveTo(camera.x, y); ctx.lineTo(camera.x + canvas.width / camera.scale, y); ctx.stroke(); }
    ctx.restore();
  }

  function drawResources(){
    ctx.save();
    for (const r of state.resources){
      if (r.amount <= 0) continue;
      const img = images[r.type] || images.ore;
      const size = cfg.RESOURCE_ICON_SIZE;
      const sx = (r.x - camera.x) * camera.scale;
      const sy = (r.y - camera.y) * camera.scale;
      ctx.globalAlpha = Math.max(0.3, r.amount / (state.cfg.RESOURCE_AMOUNT || 1));
      ctx.drawImage(img, sx - size/2, sy - size/2, size, size);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawPlayers(){
    ctx.save();
    for (const pid in state.players){
      const p = state.players[pid]; if (!p) continue;
      const tImgs = getTeamIcons(pid, p.color || '#22c55e');
      const baseSize = cfg.BASE_ICON_SIZE;
      const bx = (p.base.x - camera.x) * camera.scale;
      const by = (p.base.y - camera.y) * camera.scale;
      ctx.drawImage(tImgs.base, bx - baseSize/2, by - baseSize/2, baseSize, baseSize);
      if (pid === myId && selected === 'base'){
        ctx.beginPath(); ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 2; ctx.arc(bx, by, 22, 0, Math.PI*2); ctx.stroke();
      }
      for (const v of p.vehicles){
        const img = tImgs[v.type] || tImgs.basic;
        const size = cfg.VEHICLE_ICON_SIZE;
        const rv = renderVehicles[v.id] || v;
        const vx = (rv.x - camera.x) * camera.scale;
        const vy = (rv.y - camera.y) * camera.scale;
        ctx.drawImage(img, vx - size/2, vy - size/2, size, size);
        // carrying bar
        const frac = (v.carrying || 0) / (v.capacity || 200);
        if (frac > 0){
          const W = 26, H = 5;
          ctx.fillStyle = '#111'; ctx.fillRect(vx - W/2, vy - 18, W, H);
          ctx.fillStyle = '#4ade80'; ctx.fillRect(vx - W/2, vy - 18, W*frac, H);
        }
        if (pid === myId && v.id === selected){
          ctx.beginPath(); ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 2; ctx.arc(vx, vy, 16, 0, Math.PI*2); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function updateCamera(dt){
    if (camera.follow){
      camera.vx = 0; camera.vy = 0;
      const me = state.players[myId]; if (!me) return;
      if (selected === 'base'){
        focusOn(me.base.x, me.base.y);
      } else {
        const v = me.vehicles.find(v=>v.id===selected) || me.vehicles[0];
        if (v) focusOn(v.x, v.y);
      }
    } else {
      const accel = camera.speed * dt;
      if (keys['w']) camera.vy -= accel;
      if (keys['s']) camera.vy += accel;
      if (keys['a']) camera.vx -= accel;
      if (keys['d']) camera.vx += accel;
      camera.x += camera.vx * dt;
      camera.y += camera.vy * dt;
      camera.vx *= Math.pow(camera.friction, dt * 60);
      camera.vy *= Math.pow(camera.friction, dt * 60);
      camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width / camera.scale));
      camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height / camera.scale));
    }
  }

  let lastTime = performance.now();
  function draw(now){
    const dt = (now - lastTime) / 1000; lastTime = now;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    updateCamera(dt);
    smoothVehiclePositions();
    drawGrid();
    drawResources();
    drawPlayers();
    updateCursorInfo();
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
