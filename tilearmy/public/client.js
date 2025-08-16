// TileArmy — Client (Canvas)
(async function(){
  const res = await fetch('/cfg.json').then(r=>r.json()).catch(()=>({VIEW_W:1000,VIEW_H:700,BASE_ICON_SIZE:64,VEHICLE_ICON_SIZE:48,RESOURCE_ICON_SIZE:48,TILE_SIZE:32}));
  const sizes = [32,48,64];
  const nearest = val => sizes.reduce((a,b)=>Math.abs(b-val) < Math.abs(a-val) ? b : a);
  const cfg = { VIEW_W: res.VIEW_W, VIEW_H: res.VIEW_H };
  cfg.BASE_ICON_SIZE = nearest(Number(res.BASE_ICON_SIZE) || 32);
  cfg.VEHICLE_ICON_SIZE = nearest(Number(res.VEHICLE_ICON_SIZE) || 32);
  cfg.RESOURCE_ICON_SIZE = nearest(Number(res.RESOURCE_ICON_SIZE) || 32);
  cfg.TILE_SIZE = Number(res.TILE_SIZE) || 32;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';
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
  const basesDiv = document.getElementById('bases');
  const vehiclesDiv = document.getElementById('vehicles');
  const bookmarksDiv = document.getElementById('bookmarks');
  const pidEl = document.getElementById('pid');
  const oreEl = document.getElementById('oreCount');
  const lumberEl = document.getElementById('lumberCount');
  const stoneEl = document.getElementById('stoneCount');
  const energyFill = document.getElementById('energyFill');
  const toast = document.getElementById('toast');
  const vTypeSel = document.getElementById('vehicleType');
  const cursorInfo = document.getElementById('cursorInfo');
  const addBookmarkBtn = document.getElementById('addBookmark');

  // Load individual SVG icons and prepare helpers
  async function loadIconSheet(size){
    const ids = [
      'icon-iron-mine',
      'icon-lumber-mill',
      'icon-stone-quarry',
      'icon-home-base',
      'icon-vehicle-scout',
      'icon-vehicle-hauler',
      'icon-vehicle-hummer',
      'icon-vehicle-light-tank',
      'icon-vehicle-heavy-tank'
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
        lightTank: vehicleSheet.makeImg('icon-vehicle-light-tank', color),
        heavyTank: vehicleSheet.makeImg('icon-vehicle-heavy-tank', color),
      };
    }
    return teamIcons[pid];
  }

  function showToast(text){ toast.textContent = text; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'), 1500); }

  const ws = new WebSocket((location.protocol === 'https:'? 'wss://' : 'ws://') + location.host);

  let myId = null;
  let state = { players:{}, resources:[], bases:[], cfg:{ MAP_W:2000, MAP_H:2000, TILE_SIZE:32, RESOURCE_AMOUNT:1000, ENERGY_MAX:100, UNLOAD_TIME:1000, VEHICLE_TYPES:{}, BASE_HP:200, NEUTRAL_BASE_HP:150, BASE_ATTACK_RANGE:150 } };
  let selected = null; // {type:'base'|'vehicle', id}
  const renderVehicles = {}; // smoothed positions and angles
  const bullets = [];
  const fireTimers = Object.create(null);
  const bookmarks = [];
  let bookmarkMode = false;
  const VEHICLE_OFFSETS = { scout: Math.PI/2 };
  const getBase = id => state.bases.find(b=>b.id===id);
  const findBaseAt = (x, y) => state.bases.find(b => Math.hypot(b.x - x, b.y - y) <= (cfg.BASE_ICON_SIZE/2));
  function findVehicleAt(x, y){
    for (const pid in state.players){
      const p = state.players[pid]; if (!p) continue;
      const vh = p.vehicles.find(v => Math.hypot(v.x - x, v.y - y) <= (cfg.VEHICLE_ICON_SIZE/2));
      if (vh) return { vehicle: vh, pid };
    }
    return null;
  }

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
  addBookmarkBtn.onclick = () => {
    bookmarkMode = true;
    showToast('Tap map to add bookmark');
  };

  function focusOn(x,y,instant){
    const targetX = x - (canvas.width / camera.scale) / 2;
    const targetY = y - (canvas.height / camera.scale) / 2;
    if (instant){
      camera.x = targetX;
      camera.y = targetY;
    } else {
      camera.x += (targetX - camera.x) * camera.lerp;
      camera.y += (targetY - camera.y) * camera.lerp;
    }
    camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width / camera.scale));
    camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height / camera.scale));
  }

  // Dashboard
  function rebuildDashboard() {
    basesDiv.innerHTML = '';
    vehiclesDiv.innerHTML = '';
    bookmarksDiv.innerHTML = '';
    const me = state.players[myId];
    if (!me) return;
    oreEl.textContent = Math.floor(me.ore||0);
    lumberEl.textContent = Math.floor(me.lumber||0);
    stoneEl.textContent = Math.floor(me.stone||0);
    const energy = me.energy||0; const pct = (state.cfg.ENERGY_MAX? (energy/state.cfg.ENERGY_MAX):0)*100; energyFill.style.width = pct + '%';

    const myBases = state.bases.filter(b=>b.owner===myId);
    myBases.forEach(b => {
      const btn = document.createElement('button');
      btn.textContent = b.id;
      if (selected && selected.type==='base' && selected.id === b.id) btn.classList.add('selected');
      btn.onclick = () => { selected = {type:'base', id:b.id}; rebuildDashboard(); updateCursorInfo(); updateSpawnControls(); };
      basesDiv.appendChild(btn);
    });

    me.vehicles.forEach(v => {
      const btn = document.createElement('button');
      btn.textContent = v.id + ' ' + (v.type||'') + (v.state==='returning'?' ↩':'') + (v.state==='harvesting'?' ⛏':'');
      if (selected && selected.type==='vehicle' && selected.id === v.id) btn.classList.add('selected');
      btn.onclick = () => { selected = {type:'vehicle', id:v.id}; rebuildDashboard(); updateCursorInfo(); updateSpawnControls(); };
      vehiclesDiv.appendChild(btn);
    });

    const tile = state.cfg.TILE_SIZE || 32;
    bookmarks.forEach(bm => {
      const btn = document.createElement('button');
      const x = Math.floor(bm.x / tile);
      const y = Math.floor(bm.y / tile);
      const span = document.createElement('span');
      span.textContent = x + ',' + y;
      btn.appendChild(span);

      if (bm.entity){
        let img;
        if (bm.entity.type === 'base'){
          const base = getBase(bm.entity.id);
          const owner = base && base.owner ? state.players[base.owner] : null;
          const tImgs = getTeamIcons(base ? base.owner || 'neutral' : 'neutral', owner ? owner.color : '#999');
          img = tImgs.base;
        } else if (bm.entity.type === 'vehicle'){
          const p = state.players[bm.entity.pid];
          const v = p ? p.vehicles.find(v=>v.id===bm.entity.id) : null;
          const tImgs = getTeamIcons(bm.entity.pid, p ? p.color : '#22c55e');
          img = v ? (tImgs[v.type] || tImgs.basic) : tImgs.basic;
        } else if (bm.entity.type === 'resource'){
          const res = state.resources.find(r=>r.id===bm.entity.id);
          img = res ? images[res.type] : images[bm.entity.resType || 'ore'];
        }
        if (img){
          const icon = img.cloneNode();
          icon.className = 'bookmark-icon';
          btn.prepend(icon);
        }
      }

      btn.onclick = () => {
        camera.follow = false;
        camera.vx = 0; camera.vy = 0;
        focusOn(bm.x, bm.y, true);
      };
      bookmarksDiv.appendChild(btn);
    });

    updateCursorInfo();
    updateSpawnControls();
  }

  function updateSpawnControls(){
    if (!vTypeSel || !document.getElementById('spawn')) return;
    const base = selected && selected.type==='base' ? getBase(selected.id) : null;
    const show = base && base.owner === myId;
    vTypeSel.style.display = show ? '' : 'none';
    document.getElementById('spawn').style.display = show ? '' : 'none';
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
      const myBases = state.bases.filter(b=>b.owner===myId);
      if (myBases.length){
        selected = {type:'base', id: myBases[0].id};
        camera.x = myBases[0].x - (canvas.width / camera.scale)/2;
        camera.y = myBases[0].y - (canvas.height / camera.scale)/2;
        camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width / camera.scale));
        camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height / camera.scale));
      }
      refreshVehicleTypes();
      rebuildDashboard();
      updateCursorInfo();
      updateSpawnControls();
    } else if (msg.type === 'state') {
      state = msg.state || state;
      const p = state.players[myId] || {};
      const cur = (p.bases || []).join(',') + '|' +
        (p.vehicles || []).map(v=>v.id+v.state+Math.floor(v.carrying||0)).join(',') + '|' +
        Math.floor(p.ore||0) + '|' + Math.floor(p.lumber||0) + '|' + Math.floor(p.stone||0) + '|' + Math.floor(p.energy||0);
      if (rebuildDashboard._last !== cur) { rebuildDashboard._last = cur; rebuildDashboard(); }
      updateSpawnControls();
    } else if (msg.type === 'notice') {
      showToast(msg.msg || (msg.ok?'OK':'Error'));
    }
  };

  document.getElementById('spawn').onclick = () => {
    if (!selected || selected.type !== 'base') return;
    const vType = vTypeSel ? vTypeSel.value : undefined;
    ws.send(JSON.stringify({ type: 'spawnVehicle', vType, baseId: selected.id }));
  };
  function toWorld(px,py){
    return { x: px / camera.scale + camera.x, y: py / camera.scale + camera.y };
  }
  let mousePx = 0, mousePy = 0;
  let dragging = false, dragPx = 0, dragPy = 0;
  let tapStartX = 0, tapStartY = 0, tapMoved = false;
  let lastTap = { time: 0, x: 0, y: 0 };
  function updateCursorInfo(){
    if (!cursorInfo) return;
    const tile = state.cfg.TILE_SIZE || 32;
    const w = toWorld(mousePx, mousePy);
    const x = Math.floor(w.x / tile);
    const y = Math.floor(w.y / tile);
    let text = `${x}, ${y}`;
    const me = state.players[myId];
    if (me){
      let ox, oy;
      if (selected && selected.type === 'base'){
        const b = getBase(selected.id);
        if (b){ ox = b.x; oy = b.y; }
      } else if (selected && selected.type === 'vehicle') {
        const v = me.vehicles.find(v=>v.id===selected.id);
        if (v){ ox = v.x; oy = v.y; }
      }
      if (ox !== undefined){
        const d = Math.hypot(w.x - ox, w.y - oy) / tile;
        text += ` | ${Math.floor(d)}`;
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
      const myBases = state.bases.filter(b=>b.owner===myId);
      if (myBases.length){
        selected = {type:'base', id: myBases[0].id};
        rebuildDashboard();
        camera.follow = false;
        camera.x = myBases[0].x - (canvas.width / camera.scale)/2;
        camera.y = myBases[0].y - (canvas.height / camera.scale)/2;
        camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width / camera.scale));
        camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height / camera.scale));
        updateCursorInfo();
        updateSpawnControls();
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

  function handleMapClick(sx, sy, shift){
    const w = toWorld(sx, sy);
    if (shift || bookmarkMode){
      const bm = { x: w.x, y: w.y };
      const baseHit = findBaseAt(w.x, w.y);
      if (baseHit){
        bm.x = baseHit.x; bm.y = baseHit.y;
        bm.entity = { type: 'base', id: baseHit.id };
      } else {
        const vInfo = findVehicleAt(w.x, w.y);
        if (vInfo){
          bm.x = vInfo.vehicle.x; bm.y = vInfo.vehicle.y;
          bm.entity = { type: 'vehicle', id: vInfo.vehicle.id, pid: vInfo.pid };
        } else {
          const rr = state.cfg.RESOURCE_RADIUS || 22;
          const resHit = state.resources.find(r => Math.hypot(r.x - w.x, r.y - w.y) <= rr);
          if (resHit){
            bm.x = resHit.x; bm.y = resHit.y;
            bm.entity = { type: 'resource', id: resHit.id, resType: resHit.type };
          }
        }
      }
      bookmarks.push(bm);
      rebuildDashboard();
      bookmarkMode = false;
      return true; // consumed; prevent default
    }
    const baseHit = findBaseAt(w.x, w.y);
    if (baseHit){
      if (selected && selected.type==='base' && selected.id===baseHit.id){
        selected = null;
      } else {
        selected = {type:'base', id: baseHit.id};
      }
      rebuildDashboard();
      updateSpawnControls();
      updateCursorInfo();
      return false;
    }
    const vInfo = findVehicleAt(w.x, w.y);
    if (vInfo && vInfo.pid === myId){
      const vId = vInfo.vehicle.id;
      if (selected && selected.type==='vehicle' && selected.id===vId){
        selected = null;
      } else {
        selected = {type:'vehicle', id: vId};
      }
      rebuildDashboard();
      updateSpawnControls();
      updateCursorInfo();
      return false;
    }
    if (!selected || selected.type !== 'vehicle') return false;
    const rr = state.cfg.RESOURCE_RADIUS || 22;
    const res = state.resources.find(res => Math.hypot(res.x - w.x, res.y - w.y) <= rr);
    if (res) {
      ws.send(JSON.stringify({ type: 'harvestResource', vehicleId: selected.id, resourceId: res.id }));
    } else {
      ws.send(JSON.stringify({ type: 'moveVehicle', vehicleId: selected.id, x: w.x, y: w.y }));
    }
    return false;
  }

  function handleMapDoubleClick(sx, sy){
    const w = toWorld(sx, sy);
    const baseHit = findBaseAt(w.x, w.y);
    if (baseHit){
      selected = {type:'base', id: baseHit.id};
      focusOn(baseHit.x, baseHit.y, true);
      rebuildDashboard();
      updateSpawnControls();
      updateCursorInfo();
      return true;
    }
    const vInfo = findVehicleAt(w.x, w.y);
    if (vInfo){
      selected = {type:'vehicle', id: vInfo.vehicle.id};
      focusOn(vInfo.vehicle.x, vInfo.vehicle.y, true);
      rebuildDashboard();
      updateSpawnControls();
      updateCursorInfo();
      return true;
    }
    return false;
  }

  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    mousePx = (e.clientX - r.left) * (canvas.width / r.width);
    mousePy = (e.clientY - r.top) * (canvas.height / r.height);
    dragging = true;
    dragPx = e.clientX;
    dragPy = e.clientY;
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    tapMoved = false;
    camera.follow = false;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mousePx = (e.clientX - r.left) * (canvas.width / r.width);
    mousePy = (e.clientY - r.top) * (canvas.height / r.height);
    if (dragging){
      const dx = e.clientX - dragPx;
      const dy = e.clientY - dragPy;
      if (Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY) > 5) tapMoved = true;
      camera.x -= dx / camera.scale;
      camera.y -= dy / camera.scale;
      camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width / camera.scale));
      camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height / camera.scale));
      dragPx = e.clientX;
      dragPy = e.clientY;
    }
    updateCursorInfo();
  });

  function endDrag(e){
    dragging = false;
    if (canvas.releasePointerCapture && e.pointerId !== undefined) canvas.releasePointerCapture(e.pointerId);
  }
  canvas.addEventListener('pointerup', (e) => {
    if (!tapMoved){
      const r = canvas.getBoundingClientRect();
      const sx = (e.clientX - r.left) * (canvas.width / r.width);
      const sy = (e.clientY - r.top) * (canvas.height / r.height);
      const now = performance.now();
      const dt = now - lastTap.time;
      const dist = Math.hypot(sx - lastTap.x, sy - lastTap.y);
      if (dt < 300 && dist < 20){
        if (handleMapDoubleClick(sx, sy, e.shiftKey)) e.preventDefault();
        lastTap.time = 0;
      } else {
        if (handleMapClick(sx, sy, e.shiftKey)) e.preventDefault();
        lastTap = { time: now, x: sx, y: sy };
      }
    }
    endDrag(e);
  });
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { dragging = false; });

  function spawnBullet(ax, ay, tx, ty){
    const speed = 800;
    const ang = Math.atan2(ty - ay, tx - ax);
    const dist = Math.hypot(tx - ax, ty - ay);
    bullets.push({ x: ax, y: ay, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: dist / speed });
  }

  function handleCombat(){
    const range = state.cfg.BASE_ATTACK_RANGE || 0;
    const now = performance.now() / 1000;
    for (const b of state.bases){
      for (const pid in state.players){
        if (b.owner && pid === b.owner) continue;
        const p = state.players[pid]; if (!p) continue;
        for (const v of p.vehicles){
          const d = Math.hypot(b.x - v.x, b.y - v.y);
          if (d < range){
            const key = `b${b.id}-v${v.id}`;
            const rate = b.rof || 0;
            if (rate > 0 && now - (fireTimers[key]||0) >= 1/rate){
              fireTimers[key] = now;
              spawnBullet(b.x, b.y, v.x, v.y);
            }
          }
        }
      }
    }
    for (const pid in state.players){
      const p = state.players[pid]; if (!p) continue;
      for (const v of p.vehicles){
        if (!v.damage || !v.rof) continue;
        for (const b of state.bases){
          if (b.owner === pid) continue;
          const d = Math.hypot(b.x - v.x, b.y - v.y);
          if (d < range){
            const key = `v${v.id}-b${b.id}`;
            const rate = v.rof || 0;
            if (rate > 0 && now - (fireTimers[key]||0) >= 1/rate){
              fireTimers[key] = now;
              spawnBullet(v.x, v.y, b.x, b.y);
            }
          }
        }
      }
    }
  }

  function updateBullets(dt){
    for (let i = bullets.length - 1; i >= 0; i--){
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) bullets.splice(i,1);
    }
  }

  function drawBullets(){
    ctx.save();
    ctx.fillStyle = '#fde047';
    for (const b of bullets){
      const sx = (b.x - camera.x) * camera.scale;
      const sy = (b.y - camera.y) * camera.scale;
      ctx.beginPath();
      ctx.arc(sx, sy, 3 * camera.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function smoothVehiclePositions(){
    const seen = new Set();
    const smooth = 0.25;
    for (const pid in state.players){
      const p = state.players[pid]; if (!p) continue;
      for (const v of p.vehicles){
        let rv = renderVehicles[v.id];
        if (!rv){ rv = { x: v.x, y: v.y, lastX: v.x, lastY: v.y, angle: 0 }; renderVehicles[v.id] = rv; }
        rv.lastX = rv.x;
        rv.lastY = rv.y;
        rv.x += (v.x - rv.x) * smooth;
        rv.y += (v.y - rv.y) * smooth;
        const dx = rv.x - rv.lastX;
        const dy = rv.y - rv.lastY;
        if (Math.hypot(dx, dy) > 0.001) rv.angle = Math.atan2(dy, dx);
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

  function drawBases(){
    ctx.save();
    for (const b of state.bases){
      const owner = b.owner ? state.players[b.owner] : null;
      const tImgs = getTeamIcons(b.owner || 'neutral', owner ? owner.color : '#999');
      const baseSize = cfg.BASE_ICON_SIZE;
      const bx = (b.x - camera.x) * camera.scale;
      const by = (b.y - camera.y) * camera.scale;
      ctx.drawImage(tImgs.base, bx - baseSize/2, by - baseSize/2, baseSize, baseSize);
      const maxHp = b.owner ? (state.cfg.BASE_HP || 1) : (state.cfg.NEUTRAL_BASE_HP || 1);
      const hpFrac = (b.hp || 0) / maxHp;
      if (hpFrac < 1){
        const W = baseSize;
        const H = 6;
        ctx.fillStyle = '#111';
        ctx.fillRect(bx - W/2, by - baseSize/2 - 10, W, H);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(bx - W/2, by - baseSize/2 - 10, W * hpFrac, H);
      }
      if (selected && selected.type==='base' && selected.id === b.id){
        ctx.beginPath(); ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 2; ctx.arc(bx, by, 22, 0, Math.PI*2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawVehicles(){
    ctx.save();
    for (const pid in state.players){
      const p = state.players[pid]; if (!p) continue;
      const tImgs = getTeamIcons(pid, p.color || '#22c55e');
      for (const v of p.vehicles){
        const img = tImgs[v.type] || tImgs.basic;
        const size = cfg.VEHICLE_ICON_SIZE;
        const rv = renderVehicles[v.id] || v;
        const vx = (rv.x - camera.x) * camera.scale;
        const vy = (rv.y - camera.y) * camera.scale;
        let ang = rv.angle || 0;
        let flip = false;
        if (ang > Math.PI/2 || ang < -Math.PI/2){ ang += Math.PI; flip = true; }
        const offset = VEHICLE_OFFSETS[v.type] || 0;
        ctx.save();
        ctx.translate(vx, vy);
        ctx.rotate(ang + offset);
        if (flip) ctx.scale(-1,1);
        ctx.drawImage(img, -size/2, -size/2, size, size);
        ctx.restore();
        const maxHp = (state.cfg.VEHICLE_TYPES[v.type]||{}).hp || 1;
        const hpFrac = (v.hp || 0) / maxHp;
        if (hpFrac < 1){
          const W = 26, H = 4;
          ctx.fillStyle = '#111'; ctx.fillRect(vx - W/2, vy - 24, W, H);
          ctx.fillStyle = '#ef4444'; ctx.fillRect(vx - W/2, vy - 24, W*hpFrac, H);
        }
        let frac = (v.carrying || 0) / (v.capacity || 200);
        if (v.state === 'unloading'){
          const total = state.cfg.UNLOAD_TIME || 1000;
          frac *= (v.unloadTimer || 0) / total;
        }
        if (frac > 0){
          const W = 26, H = 5;
          ctx.fillStyle = '#111'; ctx.fillRect(vx - W/2, vy - 18, W, H);
          ctx.fillStyle = '#4ade80'; ctx.fillRect(vx - W/2, vy - 18, W*frac, H);
        }
        if (pid === myId && selected && selected.type==='vehicle' && v.id === selected.id){
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
      if (selected && selected.type === 'base'){
        const b = getBase(selected.id);
        if (b) focusOn(b.x, b.y);
      } else {
        const vid = selected && selected.type==='vehicle' ? selected.id : null;
        const v = me.vehicles.find(v=>v.id===vid) || me.vehicles[0];
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
    handleCombat();
    updateBullets(dt);
    drawGrid();
    drawResources();
    drawBases();
    drawVehicles();
    drawBullets();
    updateCursorInfo();
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
