// TileArmy — Client (Phaser)
(async function(){
  const cfg = await fetch('/cfg.json').then(r=>r.json()).catch(()=>({VIEW_W:1000,VIEW_H:700,BASE_ICON_SIZE:32,VEHICLE_ICON_SIZE:32,RESOURCE_ICON_SIZE:32,MAP_W:2000,MAP_H:2000,ENERGY_MAX:100}));

  let myName = localStorage.getItem('tilearmyName');
  while(!myName){ myName = prompt('Choose a player name'); }
  localStorage.setItem('tilearmyName', myName);

  let resolveScene;
  const sceneReady = new Promise(res => resolveScene = res);

  class MainScene extends Phaser.Scene{
    constructor(){ super('main'); }
    preload(){
      const vs = cfg.VEHICLE_ICON_SIZE;
      const bs = cfg.BASE_ICON_SIZE;
      const rs = cfg.RESOURCE_ICON_SIZE;
      this.load.svg('base','/assets/icon-home-base.svg',{width:bs,height:bs});
      this.load.svg('vehicle-scout','/assets/icon-vehicle-scout.svg',{width:vs,height:vs});
      this.load.svg('vehicle-hauler','/assets/icon-vehicle-hauler.svg',{width:vs,height:vs});
      this.load.svg('vehicle-basic','/assets/icon-vehicle-hummer.svg',{width:vs,height:vs});
      this.load.svg('vehicle-lightTank','/assets/icon-vehicle-light-tank.svg',{width:vs,height:vs});
      this.load.svg('vehicle-heavyTank','/assets/icon-vehicle-heavy-tank.svg',{width:vs,height:vs});
      this.load.svg('res-ore','/assets/icon-iron-mine.svg',{width:rs,height:rs});
      this.load.svg('res-lumber','/assets/icon-lumber-mill.svg',{width:rs,height:rs});
      this.load.svg('res-stone','/assets/icon-stone-quarry.svg',{width:rs,height:rs});
    }
    create(){
      this.cameras.main.setBounds(0,0,cfg.MAP_W,cfg.MAP_H);
      this.add.rectangle(cfg.MAP_W/2,cfg.MAP_H/2,cfg.MAP_W,cfg.MAP_H,0x3a5e2f).setOrigin(0.5);
      this.input.on('pointerdown',p=>handlePointer(p));
      resolveScene(this);
    }
  }

  const game = new Phaser.Game({
    // Explicitly use the Canvas renderer so the game works in environments
    // without WebGL. Phaser.AUTO fails in headless/limited contexts which
    // triggers "Must set explicit renderType" errors.
    type: Phaser.CANVAS,
    width: cfg.VIEW_W,
    height: cfg.VIEW_H,
    canvas: document.getElementById('game'),
    backgroundColor: '#0e1433',
    scene: MainScene
  });

  const scene = await sceneReady;

  const baseSprites = new Map();
  const baseData = new Map();
  const vehicleSprites = new Map();
  const resourceSprites = new Map();
  const players = {};
  let selectedVehicle = null;
  let myId = null;

  const ws = new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'?name='+encodeURIComponent(myName));
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'init'){
      myId = msg.id;
      Object.assign(cfg, msg.state.cfg);
      Object.assign(players, msg.state.players);
      msg.state.bases.forEach(b=>addBase(b));
      msg.state.resources.forEach(r=>addResource(r));
      for (const pid in msg.state.players){
        const pl = msg.state.players[pid];
        (pl.vehicles||[]).forEach(v=>addVehicle(pid,v));
      }
      updatePlayerRes(players[myId]);
      buildVehicleOptions();
    } else if (msg.type === 'update'){
      msg.entities.forEach(ent=>{
        if (ent.kind==='resource' && ent.type){
          if (ent.removed) removeResource(ent.id); else updateResource(ent);
        } else if (ent.kind==='base'){
          if (ent.removed) removeBase(ent.id); else updateBase(ent);
        } else if (ent.kind==='vehicle'){
          if (ent.removed) removeVehicle(ent.id); else updateVehicle(ent.owner, ent);
        } else if (ent.kind==='resource' && ent.id===myId){
          Object.assign(players[myId], ent);
          updatePlayerRes(players[myId]);
        } else if (ent.kind==='player'){
          if (ent.removed) delete players[ent.id];
          else players[ent.id] = { ...(players[ent.id]||{}), ...ent };
        }
      });
    } else if (msg.type === 'notice'){
      showToast(msg.msg);
    }
  };

  function handlePointer(pointer){
    const world = pointer.positionToCamera(scene.cameras.main);
    const objects = scene.children.list.filter(o=>o.entityType && o.getBounds && o.getBounds().contains(world.x,world.y));
    if (objects.length){
      const obj = objects[objects.length-1];
      if (obj.entityType==='vehicle') selectedVehicle = obj.entityId;
      else if (obj.entityType==='resource' && selectedVehicle){
        ws.send(JSON.stringify({type:'harvestResource',vehicleId:selectedVehicle,resourceId:obj.entityId}));
      } else if (obj.entityType==='base'){
        selectedVehicle = null;
      }
    } else if (selectedVehicle){
      ws.send(JSON.stringify({type:'moveVehicle',vehicleId:selectedVehicle,x:world.x,y:world.y}));
    }
  }

  function addBase(b){
    const spr = scene.add.image(b.x,b.y,'base').setOrigin(0.5);
    spr.entityType='base'; spr.entityId=b.id;
    baseSprites.set(b.id,spr);
    baseData.set(b.id,b);
  }
  function updateBase(b){
    baseData.set(b.id,{...(baseData.get(b.id)||{}),...b});
    const spr = baseSprites.get(b.id);
    if (spr){ if (b.x!==undefined) spr.x=b.x; if (b.y!==undefined) spr.y=b.y; }
    else addBase(baseData.get(b.id));
  }
  function removeBase(id){
    const spr = baseSprites.get(id); if (spr) spr.destroy();
    baseSprites.delete(id); baseData.delete(id);
  }

  function addVehicle(owner,v){
    const key='vehicle-'+(v.type||'basic');
    const spr = scene.add.image(v.x,v.y,key).setOrigin(0.5);
    spr.entityType='vehicle'; spr.entityId=v.id; spr.owner=owner;
    vehicleSprites.set(v.id,spr);
  }
  function updateVehicle(owner,v){
    let spr = vehicleSprites.get(v.id);
    if (!spr){ addVehicle(owner,v); spr = vehicleSprites.get(v.id); }
    if (v.x!==undefined) spr.x=v.x;
    if (v.y!==undefined) spr.y=v.y;
  }
  function removeVehicle(id){
    const spr = vehicleSprites.get(id); if (spr) spr.destroy();
    vehicleSprites.delete(id);
    if (selectedVehicle===id) selectedVehicle=null;
  }

  function addResource(r){
    const key='res-'+r.type;
    const spr = scene.add.image(r.x,r.y,key).setOrigin(0.5);
    spr.entityType='resource'; spr.entityId=r.id;
    resourceSprites.set(r.id,spr);
  }
  function updateResource(r){
    let spr = resourceSprites.get(r.id);
    if (!spr){ addResource(r); spr = resourceSprites.get(r.id); }
    if (r.x!==undefined) spr.x=r.x;
    if (r.y!==undefined) spr.y=r.y;
    if (r.amount!==undefined && r.amount<=0) removeResource(r.id);
  }
  function removeResource(id){
    const spr = resourceSprites.get(id); if (spr) spr.destroy();
    resourceSprites.delete(id);
  }

  function updatePlayerRes(p){
    if (!p) return;
    document.getElementById('oreCount').textContent = Math.floor(p.ore||0);
    document.getElementById('lumberCount').textContent = Math.floor(p.lumber||0);
    document.getElementById('stoneCount').textContent = Math.floor(p.stone||0);
    const perc = (p.energy||0)/cfg.ENERGY_MAX*100;
    document.getElementById('energyFill').style.width = perc+'%';
  }

  function showToast(text){
    const t=document.getElementById('toast');
    t.textContent=text; t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),1500);
  }

  function buildVehicleOptions(){
    const dropdown=document.getElementById('vehicleDropdown');
    const btn=document.getElementById('vehicleDropBtn');
    const opts=document.getElementById('vehicleOptions');
    dropdown.style.display='block';
    btn.onclick=()=>opts.classList.toggle('show');
    opts.innerHTML='';
    const types=Object.keys(cfg.VEHICLE_TYPES||{scout:{}});
    types.forEach(t=>{
      const div=document.createElement('div');
      div.className='option';
      div.textContent=t;
      div.onclick=()=>{ spawnVehicle(t); opts.classList.remove('show'); };
      opts.appendChild(div);
    });
  }

  function spawnVehicle(vType){
    const base = Array.from(baseData.values()).find(b=>b.owner===myId);
    if (!base) return;
    ws.send(JSON.stringify({type:'spawnVehicle', baseId: base.id, vType}));
  }
})();
