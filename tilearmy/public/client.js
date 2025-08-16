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

  // create a simple grass texture pattern for the map background
  const grassPattern = (() => {
    const p = document.createElement('canvas');
    const size = 64;
    p.width = p.height = size;
    const g = p.getContext('2d');
    g.fillStyle = '#3a5e2f';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#4d7c2a';
    for (let i = 0; i < 200; i++) {
      g.fillRect(Math.random() * size, Math.random() * size, 1, 1);
    }
    return ctx.createPattern(p, 'repeat');
  })();
  const basesDiv = document.getElementById('bases');
  const vehiclesDiv = document.getElementById('vehicles');
  const bookmarksDiv = document.getElementById('bookmarks');
  const pidEl = document.getElementById('pid');
  const oreEl = document.getElementById('oreCount');
  const lumberEl = document.getElementById('lumberCount');
  const stoneEl = document.getElementById('stoneCount');
  const energyFill = document.getElementById('energyFill');
  const toast = document.getElementById('toast');
  const vehicleDropdown = document.getElementById('vehicleDropdown');
  const vehicleDropBtn = document.getElementById('vehicleDropBtn');
  const vehicleOptions = document.getElementById('vehicleOptions');
  const cursorInfo = document.getElementById('cursorInfo');
  const dirDot = document.getElementById('dirDot');
  const addBookmarkBtn = document.getElementById('addBookmark');
  const upgradeBtn = document.getElementById('upgradeBase');
  const tutorialEl = document.getElementById('tutorial');
  const tutorialArrow = document.getElementById('tutorialArrow');
  let tutorialActive = false;
  function showTutorial(text){ if (tutorialEl){ tutorialEl.textContent = text; tutorialEl.style.display = 'flex'; tutorialEl.style.background = 'rgba(0,0,0,.6)'; tutorialEl.style.pointerEvents = 'auto'; } }
  function hideTutorial(){ if (tutorialEl){ tutorialEl.style.display = 'none'; } }
  function moveArrow(sx, sy, ex, ey, duration){
    if (!tutorialArrow) return;
    const angle = Math.atan2(ey - sy, ex - sx) * 180 / Math.PI + 90;
    tutorialArrow.style.transform = `rotate(${angle}deg)`;
    tutorialArrow.style.left = sx + 'px';
    tutorialArrow.style.top = sy + 'px';
    tutorialArrow.style.display = 'block';
    const start = performance.now();
    function step(now){
      const t = Math.min((now - start) / duration, 1);
      const x = sx + (ex - sx) * t;
      const y = sy + (ey - sy) * t;
      tutorialArrow.style.left = x + 'px';
      tutorialArrow.style.top = y + 'px';
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (vehicleDropBtn){
    vehicleDropBtn.onclick = () => { if (tutorialActive) return; vehicleDropBtn.classList.remove('selected'); vehicleOptions.classList.toggle('show'); };
    window.addEventListener('click', e => {
      if (!vehicleDropdown.contains(e.target)) vehicleOptions.classList.remove('show');
    });
  }

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

  // Determine player name. Use cached name if available; otherwise prompt
  let myName = localStorage.getItem('taName');
  while (!myName) {
    myName = prompt('Enter player name');
  }

  const ws = new WebSocket(
    (location.protocol === 'https:' ? 'wss://' : 'ws://') +
    location.host +
    '?name=' + encodeURIComponent(myName)
  );

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

  let myId = null;
  let state = { players:{}, resources:[], bases:[], cfg:{ MAP_W:2000, MAP_H:2000, TILE_SIZE:32, RESOURCE_AMOUNT:1000, ENERGY_MAX:100, UNLOAD_TIME:1000, VEHICLE_TYPES:{}, BASE_HP:200, NEUTRAL_BASE_HP:150, BASE_ATTACK_RANGE:150 } };
  let selected = null; // {type:'base'|'vehicle', id}
  const renderVehicles = {}; // smoothed positions and angles
  const bullets = [];
  const fireTimers = Object.create(null);
  const bookmarks = [];
  let bookmarkMode = false;
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
      btn.textContent = (b.name || b.id) + ` (Lv${b.level || 1})`;
      if (selected && selected.type==='base' && selected.id === b.id) btn.classList.add('selected');
      btn.onclick = () => { selected = {type:'base', id:b.id}; rebuildDashboard(); updateCursorInfo(); updateSpawnControls(); };
      basesDiv.appendChild(btn);
    });

    me.vehicles.forEach(v => {
      const btn = document.createElement('button');
      const moving = Math.hypot((v.tx ?? v.x) - v.x, (v.ty ?? v.y) - v.y) > 1;
      btn.textContent = v.id + ' ' + (v.type||'') + (moving?' →':'') + (v.state==='returning'?' ↩':'') + (v.state==='harvesting'?' ⛏':'');
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
      let label = x + ',' + y;
      if (bm.entity && bm.entity.type === 'base'){
        const base = getBase(bm.entity.id);
        if (base && base.name) label = base.name;
      }
      span.textContent = label;
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
    if (!vehicleDropdown) return;
    const base = selected && selected.type==='base' ? getBase(selected.id) : null;
    const show = base && base.owner === myId;
    vehicleDropdown.style.display = show ? '' : 'none';
    if (!show) vehicleOptions.classList.remove('show');
    if (show) refreshVehicleTypes(base); else refreshVehicleTypes(null);
    if (upgradeBtn){
      if (show){
        const lvl = base.level || 1;
        const cost = { lumber: 200 * lvl, stone: 150 * lvl };
        upgradeBtn.textContent = `Upgrade Base (-${cost.lumber} lumber, -${cost.stone} stone)`;
      }
      upgradeBtn.style.display = show ? '' : 'none';
    }
  }

  function refreshVehicleTypes(base){
    if (!vehicleDropdown) return;
    const types = state.cfg.VEHICLE_TYPES || {};
    const allowed = base ? allowedVehicles(base.level || 1) : Object.keys(types);
    const key = allowed.join(',');
    if (refreshVehicleTypes._lastKey === key) return;
    refreshVehicleTypes._lastKey = key;
    vehicleOptions.innerHTML = '';
    allowed.forEach(t => {
      const vt = types[t];
      if (vt){
        const opt = document.createElement('div');
        opt.className = 'option';
        opt.dataset.type = t;
        const name = document.createElement('span');
        name.textContent = t;
        const cost = document.createElement('span');
        cost.className = 'cost';
        const oreIcon = document.createElement('img');
        oreIcon.src = images.ore.src;
        oreIcon.className = 'resource-icon';
        cost.appendChild(oreIcon);
        cost.append(`-${vt.cost}`);
        opt.appendChild(name);
        opt.appendChild(cost);
        opt.onclick = () => {
          vehicleOptions.classList.remove('show');
          if (!selected || selected.type !== 'base') return;
          ws.send(JSON.stringify({ type: 'spawnVehicle', vType: t, baseId: selected.id }));
        };
        vehicleOptions.appendChild(opt);
      }
    });
    vehicleDropBtn.textContent = 'Spawn Vehicle';
  }

  function allowedVehicles(level){
    const map = state.cfg.BASE_LEVEL_VEHICLES || {};
    const allowed = [];
    for (let l = 1; l <= level; l++){
      (map[l] || []).forEach(v => { if (!allowed.includes(v)) allowed.push(v); });
    }
    return allowed;
  }

  function animateCamera(tx, ty, tz, duration, cb){
    const sx = camera.x, sy = camera.y, sz = camera.scale;
    const start = performance.now();
    function step(now){
      const t = Math.min(1, (now - start) / duration);
      camera.x = sx + (tx - sx) * t;
      camera.y = sy + (ty - sy) * t;
      camera.scale = sz + (tz - sz) * t;
      camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width / camera.scale));
      camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height / camera.scale));
      if (t < 1) requestAnimationFrame(step); else if (cb) cb();
    }
    requestAnimationFrame(step);
  }

  function runTutorial(base){
    if (!base) return;
    tutorialActive = true;
    camera.follow = false;
    camera.x = 0; camera.y = 0; camera.scale = 1;
    const zoomScale = 2;
    const zoomX = base.x - (canvas.width / zoomScale)/2;
    const zoomY = base.y - (canvas.height / zoomScale)/2;
    const normScale = 1;
    const normX = base.x - (canvas.width / normScale)/2;
    const normY = base.y - (canvas.height / normScale)/2;
    showTutorial('Welcome to the Tile Army');
    setTimeout(() => {
      showTutorial('This is your home base.');
      animateCamera(zoomX, zoomY, zoomScale, 3000, () => {
        showTutorial('Here you will build your army and conquer the world');
        setTimeout(() => {
          animateCamera(normX, normY, normScale, 1500, () => {
            showTutorial('But first lets create a vehicle to harvest resources');
            setTimeout(() => {
              if (vehicleDropBtn) vehicleDropBtn.classList.add('selected');
              tutorialEl.textContent = 'Click here to create a scout vehicle';
              tutorialEl.style.background = 'none';
              tutorialEl.style.pointerEvents = 'none';
              const mapRect = mapWrap.getBoundingClientRect();
              const fromX = (base.x - camera.x) * camera.scale + mapRect.left;
              const fromY = (base.y - camera.y) * camera.scale + mapRect.top;
              const dropRect = vehicleDropBtn.getBoundingClientRect();
              const toX = dropRect.left + dropRect.width/2;
              const toY = dropRect.top + dropRect.height/2;
              tutorialActive = false;
              camera.follow = true;
              moveArrow(fromX, fromY, toX, toY, 2000);
              if (vehicleDropBtn){
                vehicleDropBtn.addEventListener('click', () => {
                  hideTutorial();
                  if (tutorialArrow) tutorialArrow.style.display = 'none';
                }, { once:true });
              }
            }, 2000);
          });
        }, 1000);
      });
    }, 1000);
    localStorage.setItem('taTutorial', '1');
  }

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'init') {
      myId = msg.id; state = msg.state || state; pidEl.textContent = 'Player ' + myId;
      localStorage.setItem('taName', myId);
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
      if (!localStorage.getItem('taTutorial') && myBases.length){
        runTutorial(myBases[0]);
      }
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
    } else if (msg.type === 'error') {
      alert(msg.msg || 'Error');
      localStorage.removeItem('taName');
      location.reload();
    }
  };

  if (upgradeBtn){
    upgradeBtn.onclick = () => {
      if (!selected || selected.type !== 'base') return;
      ws.send(JSON.stringify({ type: 'upgradeBase', baseId: selected.id }));
    };
  }
  function toWorld(px,py){
    return { x: px / camera.scale + camera.x, y: py / camera.scale + camera.y };
  }
  let mousePx = 0, mousePy = 0;
  let dragging = false, dragPx = 0, dragPy = 0;
  let tapStartX = 0, tapStartY = 0, tapMoved = false;
  let swipeVx = 0, swipeVy = 0, lastMoveTime = 0;
  let lastTap = { time: 0, x: 0, y: 0 };
  function updateCursorInfo(){
    if (!cursorInfo) return;
    const tile = state.cfg.TILE_SIZE || 32;
    const w = toWorld(mousePx, mousePy);
    const x = Math.floor(w.x / tile);
    const y = Math.floor(w.y / tile);
    let text = `${x}, ${y}`;
    const baseHover = findBaseAt(w.x, w.y);
    if (baseHover){
      text += ` | ${baseHover.owner || 'neutral'}`;
    } else {
      const vInfo = findVehicleAt(w.x, w.y);
      if (vInfo){ text += ` | ${vInfo.pid}`; }
    }
    const me = state.players[myId];
    let showDot = false;
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
        if (dirDot){
          const ang = Math.atan2(oy - w.y, ox - w.x);
          const infoRect = cursorInfo.getBoundingClientRect();
          const wrapRect = mapWrap.getBoundingClientRect();
          const cx = infoRect.left - wrapRect.left + infoRect.width/2;
          const cy = infoRect.top - wrapRect.top + infoRect.height/2;
          const dx = Math.cos(ang);
          const dy = Math.sin(ang);
          const halfW = infoRect.width / 2;
          const halfH = infoRect.height / 2;
          const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
          const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
          const t = Math.min(tx, ty);
          const margin = 4;
          const xPos = cx + dx * (t + margin);
          const yPos = cy + dy * (t + margin);
          const aw = dirDot.offsetWidth || 10;
          const ah = dirDot.offsetHeight || 10;
          dirDot.style.left = (xPos - aw/2) + 'px';
          dirDot.style.top = (yPos - ah/2) + 'px';
          dirDot.style.display = 'block';
          showDot = true;
        }
      }
    }
    if (dirDot && !showDot) dirDot.style.display = 'none';
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
    if (tutorialActive){ e.preventDefault(); return; }
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
    if (tutorialActive) return;
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
    if (tutorialActive){ e.preventDefault(); return; }
    const r = canvas.getBoundingClientRect();
    mousePx = (e.clientX - r.left) * (canvas.width / r.width);
    mousePy = (e.clientY - r.top) * (canvas.height / r.height);
    dragging = true;
    dragPx = e.clientX;
    dragPy = e.clientY;
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    tapMoved = false;
    swipeVx = 0; swipeVy = 0; lastMoveTime = performance.now();
    camera.follow = false;
    camera.vx = 0; camera.vy = 0;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (tutorialActive){ return; }
    const r = canvas.getBoundingClientRect();
    mousePx = (e.clientX - r.left) * (canvas.width / r.width);
    mousePy = (e.clientY - r.top) * (canvas.height / r.height);
    if (dragging){
      const now = performance.now();
      const dx = e.clientX - dragPx;
      const dy = e.clientY - dragPy;
      const dt = (now - lastMoveTime) / 1000;
      if (dt > 0){
        swipeVx = -dx / camera.scale / dt;
        swipeVy = -dy / camera.scale / dt;
      }
      if (Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY) > 5) tapMoved = true;
      camera.x -= dx / camera.scale;
      camera.y -= dy / camera.scale;
      camera.x = Math.max(0, Math.min(camera.x, state.cfg.MAP_W - canvas.width / camera.scale));
      camera.y = Math.max(0, Math.min(camera.y, state.cfg.MAP_H - canvas.height / camera.scale));
      dragPx = e.clientX;
      dragPy = e.clientY;
      lastMoveTime = now;
    }
    updateCursorInfo();
  });

  function endDrag(e){
    dragging = false;
    if (canvas.releasePointerCapture && e.pointerId !== undefined) canvas.releasePointerCapture(e.pointerId);
  }
  canvas.addEventListener('pointerup', (e) => {
    if (tutorialActive){ endDrag(e); return; }
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
    } else {
      camera.vx = swipeVx;
      camera.vy = swipeVy;
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

  function drawBackground(){
    ctx.save();
    ctx.translate(-camera.x * camera.scale, -camera.y * camera.scale);
    ctx.scale(camera.scale, camera.scale);
    if (grassPattern){
      const size = 64;
      ctx.fillStyle = grassPattern;
      const x0 = Math.floor(camera.x / size) * size;
      const y0 = Math.floor(camera.y / size) * size;
      const w = canvas.width / camera.scale + size;
      const h = canvas.height / camera.scale + size;
      ctx.fillRect(x0, y0, w, h);
    } else {
      ctx.fillStyle = '#3a5e2f';
      ctx.fillRect(camera.x, camera.y, canvas.width / camera.scale, canvas.height / camera.scale);
    }
    ctx.restore();
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

      if (b.level){
        const txt = String(b.level);
        ctx.font = `${10 * camera.scale}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3 * camera.scale;
        ctx.strokeStyle = '#000';
        ctx.fillStyle = '#fff';
        const tx = bx + baseSize/2 - 2 * camera.scale;
        const ty = by + baseSize/2 - 2 * camera.scale;
        ctx.strokeText(txt, tx, ty);
        ctx.fillText(txt, tx, ty);
      }

      if (b.queue && b.queue.length){
        const item = b.queue[0];
        const vt = state.cfg.VEHICLE_TYPES[item.vType] || state.cfg.VEHICLE_TYPES.basic || {};
        const buildMs = (vt.build || 0) * 1000;
        if (buildMs > 0){
          const start = item.readyAt - buildMs;
          const prog = Math.min(1, Math.max(0, (Date.now() - start) / buildMs));
          const r = baseSize/2 + 6;
          ctx.beginPath();
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 4;
          ctx.arc(bx, by, r, 0, Math.PI*2);
          ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 4;
          ctx.arc(bx, by, r, -Math.PI/2, -Math.PI/2 + prog*Math.PI*2);
          ctx.stroke();
        }
      }

      const baseHp = b.owner ? (state.cfg.BASE_HP || 1) : (state.cfg.NEUTRAL_BASE_HP || 1);
      const maxHp = baseHp + ((b.level||1) - 1) * 100;
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
        if (ang > Math.PI/2 || ang < -Math.PI/2){ flip = true; }
        ctx.save();
        ctx.translate(vx, vy);
        ctx.rotate(ang);
        if (flip) ctx.scale(1,-1);
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

  const FPS = 30; // limit rendering to reduce CPU usage
  const FRAME_MS = 1000 / FPS;
  let lastTime = performance.now();
  let lastFrame = performance.now();
  function draw(now){
    if (document.hidden){
      lastTime = now;
      lastFrame = now;
      requestAnimationFrame(draw);
      return;
    }
    const dt = (now - lastTime) / 1000;
    if (now - lastFrame < FRAME_MS){
      requestAnimationFrame(draw);
      return;
    }
    lastTime = now;
    lastFrame = now;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    updateCamera(dt);
    smoothVehiclePositions();
    handleCombat();
    updateBullets(dt);
    drawBackground();
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
