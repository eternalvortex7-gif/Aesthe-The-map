// aesthe app code. Settings live in config.js. Pure helpers are wrapped in "lib" markers so unit tests can load them.
// ======================= Configuration =======================
const CFG=Object.assign({apiBase:'',contact:'',style:'https://tiles.openfreemap.org/styles/liberty',mapillaryToken:'',drivingSide:'left'},self.AESTHE_CONFIG||{});
const API=String(CFG.apiBase||'').replace(/\/+$/,'');
// With an API server (recommended for a public site) every search, route and Overpass request goes through it.
const EP={
 photon:qs=>(API?API+'/photon?':'https://photon.komoot.io/api/?')+qs,
 nom:(kind,qs)=>(API?API+'/nominatim/'+kind+'?':'https://nominatim.openstreetmap.org/'+kind+'?')+qs+(CFG.contact&&!API?'&email='+encodeURIComponent(CFG.contact):''),
 // Weather (Open-Meteo). The position is rounded to 2 decimals (about 1 km) before it leaves the device.
 weather:(la,lo)=>API?API+'/weather?latitude='+la+'&longitude='+lo:'https://api.open-meteo.com/v1/forecast?latitude='+la+'&longitude='+lo+'&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&hourly=temperature_2m,weather_code,precipitation_probability&forecast_hours=9&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=5&timezone=auto',
 route:(profile,coords,qs)=>API?API+'/route/'+profile+'/'+coords+'?'+qs:'https://routing.openstreetmap.de/'+profile+'/route/v1/driving/'+coords+'?'+qs,
 overpass:API?[API+'/overpass']:['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.private.coffee/api/interpreter']
};
// Nominatim's usage policy: at most 1 request per second, no autocomplete. Applies to direct use only (the API server enforces it otherwise).
let nomT=0;
const nomGate=()=>{if(API)return Promise.resolve();const n=Date.now(),at=Math.max(n,nomT);nomT=at+1100;return new Promise(r=>setTimeout(r,at-n))};
const $=id=>document.getElementById(id);
// ---- small on-screen message (optionally with one action button) ----
let toastT;
function toast(m,ms=4000,act){const t=$('toast');if(!t)return;t.textContent=m;t.classList.toggle('act',!!act);
 if(act){const b=document.createElement('button');b.textContent=act.label;b.onclick=()=>{t.classList.remove('on');act.fn()};t.append(b)}
 t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('on'),ms)}
// Never show raw errors to people; keep the page usable and say something calm
let errT=0;
function softFail(){if(Date.now()-errT>15000){errT=Date.now();toast('Something went wrong. Please try again.')}}
addEventListener('unhandledrejection',e=>{e.preventDefault();softFail()});
addEventListener('error',e=>{if(e&&e.message&&!/ResizeObserver|Script error|no webgl/.test(e.message))softFail()});
// The map needs WebGL and the map library
(function(){let ok=false;try{const c=document.createElement('canvas');ok=!!(window.WebGLRenderingContext&&(c.getContext('webgl2')||c.getContext('webgl')))}catch(e){}
 if(!ok||!window.maplibregl){const n=$('nogl');if(n)n.hidden=false;throw new Error('no webgl')}})();

// ---- network: one retry for a failed GET (5xx or dropped connection); never retry a 429 ----
const _f=window.fetch.bind(window);
let COOL=0,busyT=0;
function busy(){COOL=Date.now()+30000;if(Date.now()-busyT>20000){busyT=Date.now();toast('The free map services are busy right now. Please wait a minute and try again.',6000)}}
const _g=(u,o)=>_f(u,o).then(r=>{if(r.status===429)busy();return r});
window.fetch=async(u,o)=>{
 const m=String((o&&o.method)||(u&&u.method)||'GET').toUpperCase();
 for(let i=0;;i++){
  try{const r=await _g(u,o);if(r.status<500||m!=='GET'||i>0||!navigator.onLine)return r}
  catch(e){if(m!=='GET'||i>0||!navigator.onLine||(e&&e.name==='AbortError'))throw e}
  await new Promise(r=>setTimeout(r,500+Math.random()*400));
 }
};
// ---- safe storage ----
let wiping=false;
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{if(wiping)return false;try{localStorage.setItem(k,v);return true}catch(e){return false}};
const lsJSON=(k,d)=>{try{const v=JSON.parse(lsGet(k));return v==null?d:v}catch(e){return d}};
// <lib:begin>
// Anything read back from storage is checked before use (old versions, hand edits and corrupt data must not break the app)
const okNum=(x,a,b)=>typeof x==='number'&&Number.isFinite(x)&&x>=a&&x<=b;
const str=(x,n)=>typeof x==='string'?x.slice(0,n):'';
function cleanPlaces(a,max=200){
 if(!Array.isArray(a))return[];const out=[];
 for(const p of a){
  if(!p||typeof p!=='object'||!okNum(p.lat,-90,90)||!okNum(p.lon,-180,180)||typeof p.name!=='string'||!p.name)continue;
  out.push({name:str(p.name,200),addr:str(p.addr,400),extra:str(p.extra,400),lat:p.lat,lon:p.lon,ty:str(p.ty,120),ic:str(p.ic,8),oid:/^[NWR]\d{1,12}$/.test(p.oid)?p.oid:'',
   bb:Array.isArray(p.bb)&&p.bb.length===4&&p.bb.every(Number.isFinite)?p.bb.slice():null,geo:null});
  if(out.length>=max)break;
 }
 return out;
}
function cleanView(v){
 if(!v||typeof v!=='object'||!Array.isArray(v.center)||v.center.length!==2)return null;
 const[lo,la]=v.center;if(!okNum(lo,-180,180)||!okNum(la,-85,85)||!okNum(v.zoom,0,22))return null;
 return{center:[lo,la],zoom:v.zoom};
}
const TAGS=['name','name:en','brand','operator','addr:housenumber','addr:street','addr:city','opening_hours','phone','website'];
function slimEl(e){
 const t={};if(e&&e.tags)TAGS.forEach(k=>{if(typeof e.tags[k]==='string')t[k]=e.tags[k].slice(0,200)});
 const o={tags:t};if(typeof e.lat==='number')o.lat=e.lat;if(typeof e.lon==='number')o.lon=e.lon;
 if(e.center&&typeof e.center.lat==='number')o.center={lat:e.center.lat,lon:e.center.lon};return o;
}
// <lib:end>
// <lib:begin>
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// <lib:end>
const CATS=[
 ['Cafés','["amenity"="cafe"]'],['Food','["amenity"~"restaurant|fast_food|food_court"]'],['Hotels','["tourism"~"hotel|guest_house|hostel|motel"]'],
 ['Hospitals','["amenity"~"hospital|clinic|doctors"]'],['Shops','["shop"]'],['Fuel','["amenity"="fuel"]'],
 ['Pharmacy','["amenity"="pharmacy"]'],['ATM','["amenity"~"atm|bank"]'],['Schools','["amenity"="school"]'],['Parks','["leisure"="park"]']
];
let saved=cleanPlaces(lsJSON('aesthe',[]));
const store=()=>{lsSet('aesthe',JSON.stringify(saved))};
try{localStorage.removeItem('aesthe_gkey')}catch(e){}   // an old Google key from an earlier version
try{Object.keys(localStorage).filter(k=>/^aesthe_c\d+_/.test(k)).forEach(k=>localStorage.removeItem(k))}catch(e){}
let tab='explore',items=[],place=null,me=null,routeInfo='',msg='Search a place, tap any name on the map, or pick a category to see what is nearby.';
// <lib:begin>
const key=p=>p.lat.toFixed(5)+','+p.lon.toFixed(5);
// <lib:end>
const isSaved=p=>saved.some(s=>key(s)===key(p));

const V=cleanView(lsJSON('aesthe_view',null));
const map=new maplibregl.Map({container:'map',style:CFG.style,attributionControl:false,...(V||{center:[78,20],zoom:3}),maxZoom:20,maxPitch:70,bearingSnap:0,fadeDuration:0,refreshExpiredTiles:false});
// (the compass is drawn by compass.js)
// Credits stay visible (not folded behind an (i) button), as the map data licences ask
map.addControl(new maplibregl.AttributionControl({compact:false}),'bottom-right');
let mapErrT=0;map.on('error',e=>{if(Date.now()-mapErrT>20000&&!(e&&e.error&&e.error.name==='AbortError')){mapErrT=Date.now();toast(navigator.onLine?'Some map data is slow to load.':'You are offline. Showing saved map areas.')}});
map.addControl(new maplibregl.ScaleControl({unit:'metric'}),'top-right');
let ttl='',A=null,B=null,mm=[],namesOn=true,lang='en',bordOn=false,nt,nav=null,navOn=false,mode='car',voiceOn=true;
const tr={on:false,id:null,follow:true,k:null,last:null,dist:0,path:[],wl:null,centered:0};
let markers=[],curMarker=null,meMarker=null;
function mk(p,c,fn){
 const el=document.createElement('div');el.style.cssText='width:26px;height:26px';
 el.innerHTML='<div class="pin '+c+'"></div>';
 if(fn)el.addEventListener('click',ev=>{ev.stopPropagation();fn()});
 return new maplibregl.Marker({element:el,anchor:'center',offset:[0,-18.4]}).setLngLat([p.lon,p.lat]).addTo(map);
}
function rm(...ids){ids.forEach(i=>{if(map.getLayer(i))map.removeLayer(i)});ids.forEach(i=>{if(map.getSource(i))map.removeSource(i)})}
function clearRoute(){rm('route')}
function geo(id,g,paint){rm(id);map.addSource(id,{type:'geojson',data:{type:'Feature',geometry:g}});map.addLayer({id,type:'line',source:id,layout:{'line-cap':'round','line-join':'round'},paint});if(styleReady&&ti===2)paintDark(true)}
function poly(g){geo('poly',g,{'line-color':'#e11d2e','line-width':3});map.addLayer({id:'poly-f',type:'fill',source:'poly',paint:{'fill-color':'#e11d2e','fill-opacity':.08}},'poly')}
const flat=a=>typeof a[0]==='number'?[a]:a.flatMap(flat);
function fit(g,pad){const b=new maplibregl.LngLatBounds();flat(g.coordinates).forEach(c=>b.extend(c));map.fitBounds(b,{padding:pad||80,maxZoom:17})}
// <lib:begin>
const hav=(a,b)=>{const r=Math.PI/180,x=(b.lat-a.lat)*r,y=(b.lon-a.lon)*r,h=Math.sin(x/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(y/2)**2;return 12742000*Math.asin(Math.sqrt(h))};
const fmt=m=>m<1000?Math.round(m)+' m':(m/1000).toFixed(2)+' km';
// <lib:end>
function pick(p){if(tab==='measure'&&!place)setAB(!A?'A':!B?'B':'R',p);else select(p)}
function setAB(w,p){
 if(w==='A')A=p;else if(w==='B')B=p;else{A=p;B=null}
 place=null;if(curMarker){curMarker.remove();curMarker=null}rm('poly-f','poly');
 tab='measure';setTabs();markers.forEach(m=>m.remove());markers=[];drawM();render();
}
function clearM(){mm.forEach(m=>m.remove());mm=[];rm('mline');if(!navOn)rm('route')}
async function drawM(){
 clearM();
 [A,B].forEach((p,i)=>{if(p)mm.push(mk(p,i?'s':''))});
 if(!(A&&B)){if(A||B)map.flyTo({center:[(A||B).lon,(A||B).lat],zoom:Math.max(map.getZoom(),15)});return}
 const a=A,b=B;let d='not available';
 geo('mline',{type:'LineString',coordinates:[[a.lon,a.lat],[b.lon,b.lat]]},{'line-color':'#000','line-width':3,'line-dasharray':[2,2]});
 fit({coordinates:[[a.lon,a.lat],[b.lon,b.lat]]},110);
 try{
  const r=await fetch(EP.route('routed-car',`${a.lon},${a.lat};${b.lon},${b.lat}`,'overview=full&geometries=geojson')).then(r=>r.json());
  const rt=r.routes[0];
  if(A!==a||B!==b||tab!=='measure')return;
  geo('route',rt.geometry,{'line-color':'#e11d2e','line-width':5});
  d=(rt.distance/1000).toFixed(2)+' km · about '+Math.round(rt.duration/60)+' min by car';
 }catch(e){}
 const el=$('drv');if(el)el.textContent='By road: '+d;
}
function measureView(b){
 const row=(l,p)=>`<div class="item"><div class="dot">${l}</div><div class="t"><b>${p?esc(p.name):'Not set'}</b><small>${p?esc(p.addr||''):'Tap a place or spot on the map, or open a place and press Set as '+l}</small></div></div>`;
 let h=row('A',A)+row('B',B);
 if(A&&B)h+=`<div class="info"><div class="big">${fmt(hav(A,B))}</div>in a straight line<br><span id="drv">Checking road distance…</span></div>`;
 h+=`<div class="row">${A&&B?'<button class="btn o" id="sw">Swap</button>':''}<button class="btn o" id="cl">Clear</button></div>`;
 b.innerHTML=h;
 if($('sw'))$('sw').onclick=()=>{[A,B]=[B,A];drawM();render()};
 $('cl').onclick=()=>{A=B=null;clearM();render()};
}
const REV=new Map();let revT=0,revTok=0;
function rev(ll){clearTimeout(revT);const my=++revTok;revT=setTimeout(()=>doRev(ll,my),220)}   // quick taps become one lookup
async function doRev(ll,my){
 const p={name:'Dropped point',addr:'',lat:ll.lat,lon:ll.lng},k=ll.lat.toFixed(5)+','+ll.lng.toFixed(5);
 try{
  let x=REV.get(k);
  if(!x&&Date.now()>=COOL){
   await nomGate();if(my!==revTok)return;
   x=await fetch(EP.nom('reverse',`format=jsonv2&zoom=18&lat=${ll.lat}&lon=${ll.lng}`)).then(r=>{if(!r.ok)throw 0;return r.json()});
   REV.set(k,x);if(REV.size>60)REV.delete(REV.keys().next().value);
  }
  if(x&&x.display_name){p.name=x.name||x.display_name.split(',')[0];p.addr=x.display_name}
 }catch(e){}
 if(my!==revTok)return;
 pick(p);
}
function show(list,fit){
 markers.forEach(m=>m.remove());
 markers=list.slice(0,40).map(p=>mk(p,isSaved(p)?'s':'',()=>pick(p)));
 if(fit&&list.length){const b=new maplibregl.LngLatBounds();list.forEach(p=>b.extend([p.lon,p.lat]));map.fitBounds(b,{padding:PAD(),maxZoom:16})}
}
function locate(center){
 return new Promise((res,rej)=>{
  if(!navigator.geolocation)return rej();
  navigator.geolocation.getCurrentPosition(pos=>{
   me={lat:pos.coords.latitude,lng:pos.coords.longitude};
   if(meMarker)meMarker.setLngLat([me.lng,me.lat]);
   else{const el=document.createElement('div');el.className='me';meMarker=new maplibregl.Marker({element:el}).setLngLat([me.lng,me.lat]).addTo(map)}
   if(center)map.flyTo({center:[me.lng,me.lat],zoom:15});
   res(me);
  },err=>{msg=err&&err.code===1?'Location is blocked for this site. Allow it in your browser\'s site settings to see nearby places and routes.':'Could not get your location. Check that location is on and try again.';render();rej(err)},{enableHighAccuracy:true,timeout:10000});
 });
}
// Exact outline of the chosen place: one Nominatim lookup of that very OSM object (not a name search), only after the user picks it.
// Detail is matched to the size of the place so a building is sharp and a state stays light.
const OUT=new Map();
function outlineTol(bb){const sp=bb?Math.max(bb[2]-bb[0],bb[3]-bb[1]):0;return sp>0?Math.min(.001,Math.max(.000005,sp/2000)):.00002}
async function exactOutline(p){
 if(!p.oid||p.oid[0]==='N')return;
 let g=OUT.get(p.oid);
 if(g===undefined){
  try{
   await nomGate();if(place!==p)return;
   const r=await jget(EP.nom('lookup','format=jsonv2&polygon_geojson=1&polygon_threshold='+outlineTol(p.bb)+'&osm_ids='+p.oid+(lang==='en'?'&accept-language=en':'')),null,9000);
   const o=Array.isArray(r)?r[0]:null;g=o&&o.geojson&&/^(Multi)?Polygon$/.test(o.geojson.type)?o.geojson:null;
  }catch(e){return}      // keep whatever outline we already have
  if(OUT.size>=40)OUT.delete(OUT.keys().next().value);OUT.set(p.oid,g);
 }
 if(g&&place===p){p.geo=g;rm('poly-f','poly');poly(g)}
}
function select(p){
 place=p;routeInfo='';clearRoute();rm('poly-f','poly');
 if(curMarker)curMarker.remove();
 curMarker=mk(p,'');curMarker.getElement().style.zIndex=4;hangPhotos(p,curMarker);
 if(p.geo)poly(p.geo);
 goTo(p);
 render();
 exactOutline(p);
}
function render(){
 const b=$('body');
 if(place){
  const p=place;
  b.innerHTML=`<div class="det"><button class="back" id="bk">← Back</button><h2>${esc(p.name)}</h2>${p.addr?`<p>${esc(p.addr)}</p>`:''}${p.extra?`<p>${esc(p.extra)}</p>`:''}
  <div class="row" id="md">${[['car','Drive'],['foot','Walk'],['bike','Cycle']].map(([k,l])=>`<button class="chip ${mode===k?'on':''}" data-m="${k}">${l}</button>`).join('')}</div><div class="row"><button class="btn" id="sv" style="padding:10px 16px">${isSaved(p)?'★ Saved':'☆ Save'}</button><button class="btn o" id="dr">Directions</button><button class="btn o" id="sa">Set as A</button><button class="btn o" id="sb2">Set as B</button><button class="btn o" id="cp">Copy link</button><button class="btn o" id="ap">📷 Add photo</button></div>
  ${routeInfo?`<div class="info">${routeInfo}</div>`:''}${nav&&nav.p===p&&routeInfo.startsWith('<b>')?stepsHtml():''}</div>`;
  $('bk').onclick=()=>{place=null;if(curMarker){curMarker.remove();curMarker=null}if(!navOn)clearRoute();rm('poly-f','poly');render()};
  $('sv').onclick=()=>{if(isSaved(p))saved=saved.filter(s=>key(s)!==key(p));else saved.push({...p,geo:null});store();render()};
  $('dr').onclick=()=>route(p);
  $('sa').onclick=()=>setAB('A',p);
  document.querySelectorAll('#md .chip').forEach(c=>c.onclick=()=>{mode=c.dataset.m;if(nav&&nav.p===p)route(p);else render()});
  if($('st'))$('st').onclick=()=>navOn?stopNav():startNav();
  $('sb2').onclick=()=>setAB('B',p);
  $('cp').onclick=()=>{const u='https://www.openstreetmap.org/?mlat='+p.lat+'&mlon='+p.lon+'#map=18/'+p.lat+'/'+p.lon;(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(()=>{$('cp').textContent='Copied ✓'}).catch(()=>toast('Could not copy. Link: '+u,9000))};
  return;
 }
 if(tab==='measure')return measureView(b);
 const list=tab==='saved'?saved:items;
 if(!list.length){b.innerHTML=`<div class="empty">${tab==='saved'?'No saved places yet. Open any place and tap Save.':esc(msg)}</div>`;return}
 b.innerHTML=(tab==='explore'&&ttl?'<div class="empty" style="padding:6px 10px 2px;text-align:left;font-weight:700;color:var(--ink)">'+esc(ttl)+'</div>':'')+list.map((p,i)=>`<div class="item" tabindex="0" role="button" data-i="${i}"><div class="dot">${p.ic||esc((p.name||'?')[0].toUpperCase())}</div><div class="t"><b>${esc(p.name)}</b><small>${esc([p.dl,p.addr||p.extra].filter(Boolean).join(' · '))}</small></div>${isSaved(p)?'<span style="color:var(--red)">★</span>':''}</div>`).join('');
 b.querySelectorAll('.item').forEach(el=>el.onclick=()=>{const p=list[+el.dataset.i];if(list.fromSearch)addRecent(p);select(p)});
}
async function route(p,quiet){
 if(!quiet){routeInfo='Finding route…';render()}
 try{
  if(!me)await locate(false);
  const base={car:'routed-car',foot:'routed-foot',bike:'routed-bike'}[mode];
  const r=await fetch(EP.route(base,`${me.lng},${me.lat};${p.lon},${p.lat}`,'overview=full&geometries=geojson&steps=true')).then(r=>r.json());
  const rt=r.routes&&r.routes[0];if(!rt)throw 0;
  geo('route',rt.geometry,{'line-color':'#e11d2e','line-width':6});
  if(!quiet)fit(rt.geometry);
  nav={p,steps:rt.legs[0].steps,coords:rt.geometry.coordinates,i:0,said:-1,rt:Date.now()};
  routeInfo=`<b>${fmt(rt.distance)}</b> · about <b>${Math.max(1,Math.round(rt.duration/60))} min</b> ${{car:'by car',foot:'on foot',bike:'by bike'}[mode]}`;
 }catch(e){routeInfo=navigator.onLine?'Could not get a route. Check location access and try again.':'You are offline. New routes need internet; a route you already have keeps working.'}
 render();
}
// ======================= Search engine (Google-Maps style) =======================
// Sources: map tiles already on screen (instant) + saved/recent + Photon (typo-tolerant, location-biased)
// + Nominatim (precise, boundaries) + Overpass (real nearby places & local name matches).
// <lib:begin>
const norm=x=>String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const cap=x=>String(x||'').replace(/(^|\s)\S/g,c=>c.toUpperCase());
function lev(a,b){if(a===b)return 0;if(Math.abs(a.length-b.length)>1)return 9;const d=[];for(let i=0;i<=a.length;i++)d[i]=[i];for(let j=1;j<=b.length;j++)d[0][j]=j;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length]}
// 0..1: how well a name matches the query (exact > prefix > word-prefix > contains > typo)
function mscore(nq,toks,nn){
 if(!nn||!toks.length)return 0;if(nn===nq)return 1;if(nn.startsWith(nq))return .92;
 const w=nn.split(' ');
 if(toks.every(k=>w.some(x=>x.startsWith(k))))return .8;
 if(toks.every(k=>nn.includes(k)))return .6;
 if(toks.every(k=>k.length<4?w.some(x=>x.startsWith(k)):w.some(x=>lev(x.slice(0,k.length),k)<=1||lev(x.slice(0,k.length+1),k)<=1||lev(x,k)<=1)))return .45;
 return 0;
}
// <lib:end>
const ICONS=[[/cafe|coffee/,'☕'],[/restaurant|fast_food|food|pizza|bakery|ice_cream/,'🍽️'],[/hotel|hostel|motel|guest_house|lodging|resort|apartment/,'🏨'],[/hospital|clinic|doctor|dentist/,'🏥'],[/pharmacy|chemist/,'💊'],[/\batm\b|bank/,'🏧'],[/fuel|gas/,'⛽'],[/charging/,'🔌'],[/school|college|university|kindergarten/,'🎓'],[/worship|temple|church|mosque/,'🛕'],[/bus/,'🚌'],[/railway|station|subway|train/,'🚆'],[/aerodrome|aeroway|airport/,'✈️'],[/park|garden|playground|nature_reserve/,'🌳'],[/beach/,'🏖️'],[/mall|supermarket|shop|store|market/,'🛍️'],[/police/,'🚓'],[/cinema|theatre/,'🎬'],[/gym|fitness|sports/,'🏋️'],[/bar|pub/,'🍺'],[/toilet/,'🚻'],[/parking/,'🅿️'],[/attraction|museum|viewpoint|zoo|tourism/,'🎡'],[/city|town|village|suburb|neighbourhood|hamlet|locality|state|country|district|county|administrative|boundary|place/,'🏙️'],[/highway|road|street|residential|primary|secondary|tertiary|trunk|service/,'🛣️'],[/water|river|lake|bay|sea/,'💧']];
const iconFor=s=>{s=String(s||'').toLowerCase();const m=ICONS.find(i=>i[0].test(s));return m?m[1]:'📍'};
// ---- category intents ("cafes near me", "pizza in kochi", "atm") ----
// <lib:begin>
const PRE='(?:the |a |best |top |good |nearest |closest |cheap |veg |non veg |open |24 hours |24x7 |24 hr |popular )*';
const CU='pizza|burgers?|biryani|chinese|italian|seafood|kebabs?|sushi|thai|south indian|north indian|dosa|shawarma|momos|steak|sandwich(?:es)?|ice creams?|desserts?|juice|sweets?';
const INT=[
 {l:'Cafés',ic:'☕',kw:['cafe','coffee','tea shop'],rx:'cafes?|coffee(?: shops?| houses?)?|tea (?:shops?|stalls?)|chai',f:'["amenity"="cafe"]'},
 {l:'Restaurants',ic:'🍽️',kw:['restaurant','food','fast food','dinner','lunch','breakfast'],rx:'restaurants?|food|foods|eateries|eat|dinner|lunch|breakfast|fast foods?|dining|food courts?|mess',f:'["amenity"~"restaurant|fast_food|food_court"]'},
 {l:m=>cap(m.replace(/s$/,''))+' places',ic:'🍕',kw:['pizza','burger','biryani','shawarma','chinese'],rx:'('+CU+')(?: places?| shops?| restaurants?)?',cu:1,f:m=>'["amenity"~"restaurant|fast_food|cafe"]["cuisine"~"'+m.replace(/s$/,'').replace(/ /g,'_')+'",i]'},
 {l:'Bakeries',ic:'🥐',kw:['bakery'],rx:'bakery|bakeries|cake shops?',f:'["shop"="bakery"]'},
 {l:'Bars & pubs',ic:'🍺',kw:['bar','pub'],rx:'bars?|pubs?|breweries|brewery|liquor shops?|wine shops?',f:'["amenity"~"bar|pub|biergarten"]'},
 {l:'Hotels',ic:'🏨',kw:['hotel','hostel','resort','stay','lodge'],rx:'hotels?|lodges?|lodging|hostels?|stay|stays|accommodations?|resorts?|homestays?|guest houses?|rooms?',f:'["tourism"~"hotel|guest_house|hostel|motel|resort|apartment"]'},
 {l:'Hospitals',ic:'🏥',kw:['hospital','clinic','doctor','dentist','emergency'],rx:'hospitals?|clinics?|doctors?|dentists?|emergency|medical centers?|medical centres?',f:'["amenity"~"hospital|clinic|doctors|dentist"]'},
 {l:'Pharmacies',ic:'💊',kw:['pharmacy','medical shop','chemist'],rx:'pharmac(?:y|ies)|chemists?|medical (?:shops?|stores?)|drug ?stores?|medicals?',f:'["amenity"="pharmacy"]'},
 {l:'ATMs & banks',ic:'🏧',kw:['atm','bank'],rx:'atms?|banks?|cash machines?',f:'["amenity"~"atm|bank"]'},
 {l:'Fuel stations',ic:'⛽',kw:['petrol pump','fuel','gas station','petrol'],rx:'petrol(?: pumps?| bunks?| stations?)?|gas(?: stations?)?|fuel(?: stations?)?|diesel|pumps?|filling stations?',f:'["amenity"="fuel"]'},
 {l:'EV charging',ic:'🔌',kw:['ev charging','charging station'],rx:'ev(?: charging)?(?: stations?)?|charging(?: stations?| points?)',f:'["amenity"="charging_station"]'},
 {l:'Malls',ic:'🛍️',kw:['mall','shopping'],rx:'malls?|shopping(?: malls?| centers?| centres?)?|department stores?',f:'["shop"~"mall|department_store"]'},
 {l:'Supermarkets',ic:'🛒',kw:['supermarket','grocery'],rx:'supermarkets?|grocer(?:y|ies)|groceries|provision stores?|convenience stores?|stores?|shops?',f:'["shop"~"supermarket|convenience|greengrocer|grocery"]'},
 {l:'Schools & colleges',ic:'🎓',kw:['school','college','university'],rx:'schools?|colleges?|universit(?:y|ies)|institutes?|kindergartens?|tuition|coaching centers?',f:'["amenity"~"school|college|university|kindergarten"]'},
 {l:'Parks',ic:'🌳',kw:['park','garden'],rx:'parks?|gardens?|playgrounds?',f:'["leisure"~"park|garden|playground"]'},
 {l:'Places of worship',ic:'🛕',kw:['temple','church','mosque'],rx:'temples?|churches|church|mosques?|places? of worship|gurdwaras?',f:'["amenity"="place_of_worship"]'},
 {l:'Police stations',ic:'🚓',kw:['police'],rx:'police(?: stations?)?',f:'["amenity"="police"]'},
 {l:'Bus stops',ic:'🚌',kw:['bus stop','bus station','bus stand'],rx:'bus(?: stops?| stands?| stations?)',f:'["amenity"="bus_station"]'},
 {l:'Railway stations',ic:'🚆',kw:['railway station','train station'],rx:'(?:railway|train|metro) stations?|metro',f:'["railway"~"station|halt"]["station"!="subway_entrance"]'},
 {l:'Gyms',ic:'🏋️',kw:['gym','fitness'],rx:'gyms?|fitness(?: centers?| centres?)?',f:'["leisure"~"fitness_centre|sports_centre"]'},
 {l:'Cinemas',ic:'🎬',kw:['cinema','movie','theatre'],rx:'cinemas?|movies?|movie theat(?:er|re)s?|theat(?:er|re)s?|multiplex',f:'["amenity"="cinema"]'},
 {l:'Beaches',ic:'🏖️',kw:['beach'],rx:'beach(?:es)?',f:'["natural"="beach"]'},
 {l:'Toilets',ic:'🚻',kw:['toilet','restroom'],rx:'toilets?|restrooms?|washrooms?',f:'["amenity"="toilets"]'},
 {l:'Parking',ic:'🅿️',kw:['parking'],rx:'parking(?: lots?| spaces?)?|car park',f:'["amenity"="parking"]'},
 {l:'Salons',ic:'💇',kw:['salon','barber'],rx:'salons?|barbers?(?: shops?)?|beauty parlou?rs?|hair ?(?:cut|dressers?)',f:'["shop"~"hairdresser|beauty|barber"]'},
 {l:'Tourist attractions',ic:'🎡',kw:['tourist','things to do','places to visit'],rx:'tourist(?: attractions?| places?| spots?)?|attractions?|things to do|places to visit|sightseeing|museums?',f:'["tourism"~"attraction|museum|viewpoint|zoo|theme_park|gallery"]'}
];
INT.forEach(i=>i.re=new RegExp('^'+PRE+'(?:'+i.rx+')$'));
function parseIntent(v){
 let nm=false,q=norm(v).replace(/\b(near me|nearby|near by|around me|close to me|closest to me|around here|near here|open now)\b/g,()=>{nm=true;return ''}).replace(/\s+/g,' ').trim(),pl=null;
 const m=q.match(/^(.+?) (?:in|near|at|around|close to) (.+)$/);if(m){q=m[1];pl=m[2]}
 if(!q)return null;
 for(const it of INT){const r=it.re.exec(q);if(r)return{it,m:r[1]||r[0],place:pl,nm,from:q}}
 return null;
}
function intentHint(v){
 const full=parseIntent(v);if(full)return full;
 const q=norm(v);if(q.length<3||q.includes(' in ')||q.includes(' near '))return null;
 const it=INT.find(i=>i.kw.some(k=>k.startsWith(q)&&!i.cu));
 return it?{it,m:it.kw.find(k=>k.startsWith(q)),place:null,nm:false,from:q}:null;
}
const intLabel=p=>typeof p.it.l==='function'?p.it.l(p.m):p.it.l;
// <lib:end>
// ---- recent searches ----
let RC=cleanPlaces(lsJSON('aesthe_recent',[]),8);
function addRecent(p){
 if(!p||p.lat==null)return;
 RC=[{name:p.name,addr:p.addr||'',lat:p.lat,lon:p.lon,bb:p.bb||null,ty:p.ty||'',ic:p.ic||iconFor(p.ty)},...RC.filter(r=>key(r)!==key(p))].slice(0,8);
 lsSet('aesthe_recent',JSON.stringify(RC))
}
// ---- data sources ----
const SC=new Map();let sAbort=null,sTok=0,sList=[],sIdx=-1,t,lastInt=null;
function jget(u,sig,ms=6000){
 if(sig&&sig.aborted)return Promise.reject(new Error('abort'));
 const c=new AbortController(),tm=setTimeout(()=>c.abort(),ms);
 if(sig)sig.addEventListener('abort',()=>c.abort());
 return _g(u,{signal:c.signal}).then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).finally(()=>clearTimeout(tm));
}
const biased=()=>map.getZoom()>=5;
const sKey=v=>{const c=map.getCenter();return norm(v)+'|'+(biased()?c.lat.toFixed(1)+','+c.lng.toFixed(1):'')};
function fromPhoton(f){
 const q=f.properties||{},c=f.geometry&&f.geometry.coordinates;if(!c)return null;
 const street=[q.street,q.housenumber].filter(Boolean).join(' ');
 const name=q.name||street||q.city||q.county||q.state||q.country||'';if(!name)return null;
 const parts=[q.name?street:'',q.district||q.locality,q.city,q.county,q.state,q.country].filter(Boolean);
 const seen=new Set([norm(name)]),rest=parts.filter(x=>{const k=norm(x);if(seen.has(k))return false;seen.add(k);return true});
 const ty=(q.osm_key||'')+' '+(q.osm_value||'');
 const ex=q.extent,bb=ex&&ex.length===4?[+ex[0],+ex[3],+ex[2],+ex[1]]:null;
 const oid=/^[NWR]$/.test(q.osm_type)&&Number.isInteger(q.osm_id)?q.osm_type+q.osm_id:'';
 return{name,addr:rest.join(', '),lat:+c[1],lon:+c[0],geo:null,oid,bb,src:'p',ty,ic:iconFor(ty)};
}
function fromNom(x){
 const ty=(x.category||'')+' '+(x.type||'')+' '+(x.addresstype||'');
 const parts=x.display_name.split(',').map(s=>s.trim()),nm=x.name||parts[0];
 const oid=({node:'N',way:'W',relation:'R'})[x.osm_type]&&Number.isInteger(+x.osm_id)?({node:'N',way:'W',relation:'R'})[x.osm_type]+x.osm_id:'';
 return{name:nm,addr:parts.slice(1).join(', '),lat:+x.lat,lon:+x.lon,imp:+x.importance||0,oid,
  geo:/Polygon/.test(x.geojson&&x.geojson.type)?x.geojson:null,bb:x.boundingbox?[+x.boundingbox[2],+x.boundingbox[0],+x.boundingbox[3],+x.boundingbox[1]]:null,src:'n',ty,ic:iconFor(ty)};
}
const qPhoton=(v,n,sig)=>{
 const c=map.getCenter(),z=map.getZoom();
 let u=EP.photon('limit='+n+'&q='+encodeURIComponent(v)+(lang==='en'?'&lang=en':''));
 if(biased())u+='&lat='+c.lat.toFixed(2)+'&lon='+c.lng.toFixed(2)+'&zoom='+Math.round(z)+'&location_bias_scale='+(z>=10?.6:.35);
 return jget(u,sig).then(j=>(j.features||[]).map(fromPhoton).filter(Boolean));
};
const qNom=(v,n,sig)=>{
 let u=EP.nom('search','format=jsonv2&dedupe=1&limit='+n+'&polygon_geojson=1&polygon_threshold=0.0005&q='+encodeURIComponent(v)+(lang==='en'?'&accept-language=en':''));
 if(biased()){const b=map.getBounds();u+='&viewbox='+[Math.max(-180,b.getWest()),Math.min(85,b.getNorth()),Math.min(180,b.getEast()),Math.max(-85,b.getSouth())].map(x=>x.toFixed(4)).join(',')}
 return nomGate().then(()=>jget(u,sig,9000)).then(r=>r.map(fromNom));
};
// Real places in the area whose name contains the query (Overpass), e.g. "lulu" -> every Lulu nearby
function qOvName(v){
 if(map.getZoom()<11||v.length<3)return Promise.resolve([]);
 const b=map.getBounds(),c=map.getCenter(),h=.25;
 const s=Math.max(b.getSouth(),c.lat-h),n=Math.min(b.getNorth(),c.lat+h),w=Math.max(b.getWest(),c.lng-h),e=Math.min(b.getEast(),c.lng+h);
 const rx=v.replace(/[.*+?^${}()|[\]\\]/g,'\\\\$&').replace(/"/g,'\\"');
 return ovq(`[out:json][timeout:8];nwr["name"~"${rx}",i](${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)});out center 20;`).then(j=>j.elements.map(e=>{
  const p=conv([e],['Place'],null)[0];if(!p)return null;
  const ty=Object.entries(e.tags||{}).filter(([k])=>/^(amenity|shop|tourism|leisure|railway|aeroway|place|natural)$/.test(k)).map(([k,x])=>k+' '+x).join(' ');
  return{...p,src:'o',ty,ic:iconFor(ty)};
 }).filter(Boolean));
}
// ---- results already drawn in the map tiles: instant, works offline ----
const centerOf=g=>{
 if(!g)return null;const t=g.type,c=g.coordinates;
 if(t==='Point')return c;
 if(t==='LineString')return c[c.length>>1];
 if(t==='MultiLineString')return c[0][c[0].length>>1];
 const ring=t==='Polygon'?c[0]:t==='MultiPolygon'?c[0][0]:null;
 if(!ring||!ring.length)return null;
 let x=0,y=0;ring.forEach(p=>{x+=p[0];y+=p[1]});return[x/ring.length,y/ring.length];
};
const LAY=['poi','place','transportation_name','aerodrome_label','park','mountain_peak','water_name'];
let STY=null;
function sty(){
 if(STY)return STY;const st=map.getStyle();if(!st)return null;
 const poi=[],sl=new Set();let src=null;
 st.layers.forEach(l=>{const q=l['source-layer'];if(q){sl.add(q);if(q==='poi'&&!src)src=l.source;if(q==='poi'&&l.type==='symbol')poi.push(l.id)}});
 return STY={poi,sl,src};
}
map.on('styledata',()=>{STY=null});
// Local search index: built once per map move (not once per keystroke) from the tiles already on screen
let mv=0,LIX={k:'',a:[]};
map.on('moveend',()=>{mv++});map.on('idle',()=>{mv++});
function localIndex(){
 const S=sty();if(!S||!S.src)return[];
 const k=mv+'|'+lang;if(LIX.k===k)return LIX.a;
 const a=[],seen=new Set();
 LAY.filter(q=>S.sl.has(q)).forEach(q=>{
  let fs;try{fs=map.querySourceFeatures(S.src,{sourceLayer:q})}catch(e){return}
  fs.forEach(f=>{
   const g=f.properties||{},nm=(lang==='en'&&g['name:en'])||g.name;if(!nm||!f.geometry||f.geometry.type!=='Point')return;
   const pt=f.geometry.coordinates,id=q+nm+pt[1].toFixed(4)+pt[0].toFixed(4);if(seen.has(id))return;seen.add(id);
   a.push({nm,nn:norm(nm),lat:pt[1],lon:pt[0],kind:g.subclass||g.class||q.replace(/_(name|label)$/,''),sl:q});
  });
 });
 LIX={k,a};return a;
}
function localHits(v){
 const nq=norm(v),toks=nq.split(' ').filter(Boolean);if(nq.length<2)return[];
 const c=map.getCenter(),ctr={lat:c.lat,lon:c.lng},seen=new Map();
 localIndex().forEach(e=>{
  if(mscore(nq,toks,e.nn)<.6)return;
  const p={name:e.nm,addr:cap(String(e.kind).replace(/_/g,' ')),lat:e.lat,lon:e.lon,src:'l',ty:e.kind+' '+e.sl,ic:iconFor(e.kind+' '+e.sl)};
  const k=e.nn+e.lat.toFixed(3)+e.lon.toFixed(3),o=seen.get(k);
  if(!o||hav(ctr,p)<hav(ctr,o))seen.set(k,p);
 });
 return[...seen.values()];
}
// ---- ranking: text match + closeness to the map view + source importance, duplicates merged ----
function rank(v,lists,max){
 const nq=norm(v),toks=nq.split(' ').filter(Boolean),c=map.getCenter(),ctr={lat:c.lat,lon:c.lng},z=map.getZoom(),scale=3e7/2**z,out=[];
 lists.forEach(l=>l.forEach((x,i)=>{
  if(!Number.isFinite(x.lat)||!Number.isFinite(x.lon))return;
  const nn=norm(x.name);
  let ms=mscore(nq,toks,nn);if(!ms&&toks.every(k=>norm(x.addr).includes(k)))ms=.25;
  if(!ms&&x.src!=='l'&&x.src!=='o')ms=.15;      // network engines already did fuzzy matching
  let sc=ms+.5*Math.exp(-hav(ctr,x)/(scale*2))+.15*Math.max(x.imp||0,x.src==='p'?1-i/12:0)+(x.src==='l'?.1:0);
  const d=out.find(o=>{const dd=hav(o,x),on=norm(o.name);return dd<40||(on===nn&&dd<3000)||(nn.length>3&&on.length>3&&(on.includes(nn)||nn.includes(on))&&dd<600)});
  if(d){if(!d.geo&&x.geo)d.geo=x.geo;if(!d.oid&&x.oid)d.oid=x.oid;if(!d.bb&&x.bb)d.bb=x.bb;if(x.src!=='l'&&x.ty&&(d.src==='l'||!d.ty))d.ty=x.ty;if(x.src==='n'||x.src==='p'){d.lat=x.lat;d.lon=x.lon}d.ms=Math.max(d.ms||0,ms);if((x.addr||'').length>(d.addr||'').length&&x.src!=='l')d.addr=x.addr;if(!d.ic||d.ic==='📍')d.ic=x.ic;d.sc=Math.max(d.sc,sc)+.12;return}
  out.push({...x,sc,ms});
 }));
 out.sort((a,b)=>b.sc-a.sc);
 const cnt={},uniq=out.filter(x=>{const k=norm(x.name);cnt[k]=(cnt[k]||0)+1;return cnt[k]<=2});   // at most 2 branches per name
 const o=me?{lat:me.lat,lon:me.lng}:ctr;
 return uniq.slice(0,max).map(x=>({...x,dl:fmt(hav(o,x))}));
}
// <lib:begin>
function asCoord(v){
 const m=v.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
 if(!m)return null;const la=+m[1],lo=+m[2];
 return Math.abs(la)<=90&&Math.abs(lo)<=180?{name:'Coordinates',addr:la+', '+lo,lat:la,lon:lo,geo:null,ic:'📌'}:null;
}
// <lib:end>
// ---- suggestions dropdown ----
const hl=(name,v)=>{
 const toks=norm(v).split(' ').filter(x=>x.length>0).map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 if(!toks.length)return esc(name);
 try{return name.split(new RegExp('('+toks.join('|')+')','i')).map((s,i)=>i%2?'<b>'+esc(s)+'</b>':esc(s)).join('')}catch(e){return esc(name)}
};
function intentRow(p){
 const lab=intLabel(p);
 return{k:'i',pi:p,name:p.it.ic+' '+lab+(p.place?' in '+cap(p.place):p.nm?' near me':' near here'),addr:'',ic:''};
}
function drawSug(rows,v,fin){
 sList=rows;sIdx=-1;const s=$('sug');
 s.innerHTML=rows.length?rows.map((x,i)=>`<div role="option" id="so${i}" data-i="${i}">${x.ic?`<span class="si">${x.ic}</span>`:''}<span class="st">${x.k==='i'?'<b>'+esc(x.name)+'</b>':hl(x.name,v)}<small>${esc([x.dl,x.addr].filter(Boolean).join(' · '))}</small></span></div>`).join(''):`<div class="none">${fin?'No matches. Press Enter to search more widely.':'Searching…'}</div>`;
 s.hidden=false;
 s.querySelectorAll('div[data-i]').forEach(d=>{d.onmousedown=e=>e.preventDefault();d.onclick=()=>chooseSug(+d.dataset.i)});
}
function chooseSug(i){
 const x=sList[i];if(!x)return;
 $('sug').hidden=true;sTok++;if(sAbort)sAbort.abort();
 if(x.k==='i'){$('q').value=x.pi.place?x.pi.it.kw[0]+' in '+x.pi.place:intLabel(x.pi);$('qx').hidden=false;runIntent(x.pi);return}
 $('q').value=x.name;$('qx').hidden=false;
 addRecent(x);
 pick({name:x.name,addr:x.addr,lat:x.lat,lon:x.lon,geo:x.geo,oid:x.oid,bb:x.bb,ty:x.ty,ic:x.ic});
}
function markSug(){$('q').setAttribute('aria-activedescendant',sIdx>=0?'so'+sIdx:'');$('sug').querySelectorAll('div[data-i]').forEach((d,i)=>{d.style.background=i===sIdx?'var(--soft)':'';if(i===sIdx)d.scrollIntoView({block:'nearest'})})}
// Shown when the box is focused and empty: recents, saved places and quick categories
function showHome(){
 const rows=[...RC.slice(0,4).map(r=>({...r,k:'r',ic:'🕘'})),...saved.filter(s=>!RC.some(r=>key(r)===key(s))).slice(0,3).map(s=>({...s,k:'s',ic:'★'}))];
 ['Restaurants','Cafés','Fuel stations','ATMs & banks','Hospitals','Pharmacies'].forEach(n=>{const it=INT.find(i=>i.l===n);rows.push(intentRow({it,m:it.kw[0],place:null,nm:false}))});
 drawSug(rows.slice(0,10),'');
}
function typeahead(v){
 const nq=norm(v),toks=nq.split(' ').filter(Boolean),k=sKey(v);
 const c=asCoord(v);if(c){drawSug([c],v);return}
 const mine=[...RC.map(r=>({...r,k:'r',ic:'🕘'})),...saved.map(s=>({...s,k:'s',ic:'★'}))].filter(r=>mscore(nq,toks,norm(r.name))>=.6);
 const dedup=[];mine.forEach(r=>{if(!dedup.some(d=>key(d)===key(r)))dedup.push(r)});
 const ih=intentHint(v),head=ih?[intentRow(ih)]:[];
 const loc=localHits(v);
 const compose=net=>{
  const places=rank(v,[loc,...net],7).filter(p=>!dedup.some(d=>hav(d,p)<40));
  return[...head,...dedup.slice(0,2),...places].slice(0,8);
 };
 // stage 1: instant (map + history), stage 2: internet results
 const cached=SC.get(k);
 drawSug(compose(cached?[cached]:[]),v,!!cached);
 if(cached)return;
 if(Date.now()<COOL){drawSug(compose([]),v,true);return}
 if(sAbort)sAbort.abort();sAbort=new AbortController();const my=++sTok,sig=sAbort.signal;
 qPhoton(v,7,sig).then(r=>{
  if(my!==sTok)return;SC.set(k,r);if(SC.size>80)SC.delete(SC.keys().next().value);
  drawSug(compose([r]),v,true);
 }).catch(()=>{
  if(my!==sTok||sig.aborted)return;
  drawSug(compose([]),v,true);   // Nominatim forbids autocomplete: Enter runs the full search instead
 });
}
// ---- category search: "restaurants near me", "pizza in kochi" ----
async function runIntent(p){
 clearTimeout(t);if(sAbort)sAbort.abort();const my=++sTok;
 $('sug').hidden=true;$('sta').hidden=true;lastInt=null;
 const lab=intLabel(p),f=typeof p.it.f==='function'?p.it.f(p.m):p.it.f;
 tab='explore';place=null;setTabs();items=[];ttl=lab;msg='Looking for '+lab.toLowerCase()+'…';render();
 let o,R,move=false;
 const c=map.getCenter(),z=map.getZoom();
 try{
  if(p.place){
   const g=await qPhoton(p.place,1,null);if(my!==sTok)return;
   if(!g.length){msg='Could not find "'+p.place+'". Check the spelling.';render();return}
   o={lat:g[0].lat,lon:g[0].lon};R=4000;move=true;ttl=lab+' in '+g[0].name;
  }else if(p.at){o=p.at;R=z>=15?1500:z>=13?3000:z>=11?6000:10000}
  else if(p.nm||z<11){
   if(!me)await locate(false).catch(()=>{});if(my!==sTok)return;
   if(me){o={lat:me.lat,lon:me.lng};ttl=lab+' near you'}else{o={lat:c.lat,lon:c.lng};ttl=lab+' near here'}
   R=3000;move=true;
  }else{o={lat:c.lat,lon:c.lng};R=z>=15?1500:z>=13?3000:6000;ttl=lab+' near here'}
  if(move)map.flyTo({center:[o.lon,o.lat],zoom:14,duration:700});
  let els=(await ovq(`[out:json][timeout:12];nwr${f}(around:${R},${o.lat},${o.lon});out center 80;`)).elements;
  if(els.length<4){els=(await ovq(`[out:json][timeout:12];nwr${f}(around:${R*3},${o.lat},${o.lon});out center 80;`)).elements}
  if(my!==sTok)return;
  const ic=p.it.ic;
  items=merge([],conv(els,[lab],null),o).map(x=>({...x,ic,dl:fmt(hav(o,x))}));
  items.fromSearch=true;
  msg='No '+lab.toLowerCase()+' found here. Zoom out or move the map and tap "Search this area".';
  show(items,false);render();
  if(items.length)fitList(items.slice(0,15),o);
  setTimeout(()=>{if(my===sTok){const cc=map.getCenter();lastInt={p:{...p,place:null,nm:false,at:null},o:{lat:cc.lat,lon:cc.lng}}}},1300);
 }catch(e){if(my!==sTok)return;msg=navigator.onLine?'Could not load places right now. Please try again.':'You are offline. Searching nearby places needs internet.';render()}
}
function fitList(list,o){
 if(!list.length)return;
 if(list.length===1){goTo(list[0]);return}
 const b=new maplibregl.LngLatBounds();list.forEach(x=>b.extend([x.lon,x.lat]));if(o)b.extend([o.lon,o.lat]);
 map.fitBounds(b,{padding:PAD(),maxZoom:16,duration:700});
}
map.on('moveend',()=>{
 if(!lastInt){$('sta').hidden=true;return}
 const c=map.getCenter(),b=map.getBounds(),w=hav({lat:c.lat,lon:b.getWest()},{lat:c.lat,lon:b.getEast()});
 $('sta').hidden=hav({lat:c.lat,lon:c.lng},lastInt.o)<w*.3;
});
$('sta').onclick=()=>{if(!lastInt)return;const c=map.getCenter();runIntent({...lastInt.p,at:{lat:c.lat,lon:c.lng}})};
// ---- full search (Enter / Go): results appear progressively as each source answers ----
async function search(){
 const v=$('q').value.trim();if(!v)return;
 clearTimeout(t);if(sAbort)sAbort.abort();const my=++sTok;sAbort=new AbortController();const sig=sAbort.signal;
 lastInt=null;$('sta').hidden=true;$('sug').hidden=true;
 const c=asCoord(v);
 if(c){tab='explore';place=null;setTabs();ttl='';items=[c];items.fromSearch=true;show(items,false);render();fitList(items);return}
 const pi=parseIntent(v);if(pi){runIntent(pi);return}
 tab='explore';place=null;setTabs();ttl='';
 const loc=localHits(v),lists=[];
 items=rank(v,[loc],12);items.fromSearch=true;msg='Searching…';show(items,false);render();
 let fails=0,fin=false;
 const upd=(i,l)=>{
  lists[i]=l;if(my!==sTok)return;
  const keep=place;
  items=rank(v,[loc,...lists.filter(Boolean)],12);items.fromSearch=true;
  show(items,false);if(!keep)render();
 };
 const finish=()=>{
  if(fin||my!==sTok||!items.length)return;fin=true;
  const a=items[0],b2=items[1];
  if(a.ms>=.9&&(!b2||a.sc-b2.sc>.2)){addRecent(a);select(a)}   // clear winner: open it
  else fitList(items.filter(x=>hav(a,x)<30000).slice(0,8));
 };
 const run=(i,pr)=>pr.then(l=>upd(i,l)).catch(()=>{fails++});
 const early=setTimeout(finish,2500);
 await Promise.all([run(0,qPhoton(v,10,sig)),run(1,qNom(v,10,sig)),run(2,qOvName(v))]);
 clearTimeout(early);
 if(my!==sTok)return;
 if(!items.length){msg=fails>=3?(navigator.onLine?'Search is slow or unavailable right now. Please try again.':'You are offline. Search needs internet.'):'No results for "'+v+'". Check the spelling or add a city, e.g. "'+v+', Kochi".';render()}
 else finish();
}
$('q').addEventListener('input',()=>{
 clearTimeout(t);const v=$('q').value.trim();$('qx').hidden=!v;
 if(!v){sTok++;if(sAbort)sAbort.abort();showHome();return}
 if(v.length<2){sTok++;if(sAbort)sAbort.abort();$('sug').hidden=true;return}
 const hit=SC.has(sKey(v));
 t=setTimeout(()=>typeahead(v),hit?0:140);
});
$('q').addEventListener('focus',()=>{const v=$('q').value.trim();if(!v)showHome();else if(sList.length)$('sug').hidden=false});
$('q').addEventListener('keydown',e=>{
 const open=!$('sug').hidden&&sList.length;
 if(e.key==='ArrowDown'&&open){e.preventDefault();sIdx=(sIdx+1)%sList.length;markSug()}
 else if(e.key==='ArrowUp'&&open){e.preventDefault();sIdx=(sIdx-1+sList.length)%sList.length;markSug()}
 else if(e.key==='Escape'){$('sug').hidden=true}
 else if(e.key==='Enter'&&!e.isComposing){if(open&&sIdx>=0)chooseSug(sIdx);else search()}
});
$('qx').onclick=()=>{$('q').value='';$('qx').hidden=true;sTok++;if(sAbort)sAbort.abort();$('q').focus();showHome()};
$('go').onclick=search;
document.addEventListener('click',e=>{if(!e.target.closest('.sb'))$('sug').hidden=true});

const PAD=()=>{
 const c=document.body.classList;
 if(c.contains('fs'))return{left:70,top:70,right:70,bottom:70};
 if(innerWidth>700)return{left:c.contains('pmin')?260:410,top:70,right:70,bottom:70};
 return{top:70,left:40,right:40,bottom:c.contains('pmin')?110:Math.round(innerHeight*.56)};
};
const ofs=()=>{const p=PAD();return[(p.left-p.right)/2,(p.top-p.bottom)/2]};
// <lib:begin>
// How far to zoom for a result of a given kind (a city must not zoom to street level)
function zoomFor(p){
 const t=String(p.ty||'');
 const T=[[/\bcountry\b/,4.8],[/\b(state|region|province)\b/,6.2],[/\b(county|state_district|district)\b/,8.8],[/\b(city|municipality)\b/,10.8],[/\btown\b/,12],[/\b(suburb|neighbourhood|quarter|village|hamlet|locality|borough|city_block)\b/,13.5]];
 for(const[r,z]of T)if(r.test(t))return z;
 return 17;
}
// <lib:end>
// Centre a result in the visible part of the map (not behind the panel) at a sensible zoom
function goTo(p){
 if(p.geo){const b=new maplibregl.LngLatBounds();flat(p.geo.coordinates).forEach(c=>b.extend(c));map.fitBounds(b,{padding:PAD(),maxZoom:17,duration:900});return}
 if(p.bb&&p.bb.every(Number.isFinite)&&(p.bb[2]-p.bb[0]>.004||p.bb[3]-p.bb[1]>.004)){
  map.fitBounds([[p.bb[0],p.bb[1]],[p.bb[2],p.bb[3]]],{padding:PAD(),maxZoom:17,duration:900});return}
 const z=zoomFor(p);
 const o=ofs();map.flyTo({center:[p.lon,p.lat],zoom:z<17?z:Math.max(map.getZoom(),17),offset:[o[0],o[1]+(PH.on&&place===p?105:0)],duration:900});
}
const OPS=EP.overpass;
// Race all servers at once and take the first good answer (much faster than trying one by one)
// Overpass: ask the first server; only if it is slow (1.5 s) or fails, ask the next. Repeats are cached for 5 min.
const OVC=new Map();
function ovq(q,ms=12000){
 const hit=OVC.get(q);if(hit&&Date.now()-hit.t<3e5)return hit.p;
 const p=new Promise((resolve,reject)=>{
  const cs=[],tm=[];let done=false,failed=0,launched=0;
  const stop=()=>{done=true;cs.forEach(c=>c.abort());tm.forEach(clearTimeout)};
  const launch=()=>{
   if(done||launched>=OPS.length)return;
   const u=OPS[launched++],c=new AbortController();cs.push(c);
   tm.push(setTimeout(()=>c.abort(),ms));const nx=setTimeout(launch,1500);tm.push(nx);
   _g(u,{method:'POST',body:'data='+encodeURIComponent(q),signal:c.signal}).then(r=>{if(!r.ok)throw 0;return r.json()}).then(j=>{if(!j.elements)throw 0;if(!done){stop();resolve(j)}})
    .catch(()=>{if(done)return;clearTimeout(nx);if(++failed>=OPS.length)reject(new Error('overpass'));else launch()});
  };
  launch();
 });
 OVC.set(q,{t:Date.now(),p});p.catch(()=>OVC.delete(q));
 if(OVC.size>40)OVC.delete(OVC.keys().next().value);
 return p;
}
const RX=[/cafe|coffee/,/restaurant|fast_food|food_court|bakery|ice_cream/,/lodging|hotel|hostel|motel|guest_house/,/hospital|clinic|doctor/,/shop|supermarket|convenience|mall|department|grocery|clothes/,/fuel|gas_station/,/pharmacy|chemist/,/\batm\b|bank/,/school|college|university|kindergarten/,/\bpark\b|garden|playground/];
// Instant results straight from the map data already on screen (no extra internet needed)
function localPOI(i,o,R){
 const S=sty();if(!S||!S.src||!S.sl.has('poi'))return[];
 let fs;try{fs=map.querySourceFeatures(S.src,{sourceLayer:'poi'})}catch(e){return[]}
 const seen=new Set(),out=[];
 fs.forEach(f=>{
  const g=f.properties||{},n=(lang==='en'&&g['name:en'])||g.name;
  if(!n||f.geometry.type!=='Point')return;
  const k=RX.findIndex(r=>r.test((g.class||'')+' '+(g.subclass||'')));
  if(k<0||(i!=null&&k!==i))return;
  const [lon,lat]=f.geometry.coordinates,id=n+lat.toFixed(4)+lon.toFixed(4);
  if(seen.has(id))return;seen.add(id);
  out.push({name:n,lat,lon,cat:k,addr:'',extra:CATS[k][0].replace(/s$/,'')});
 });
 // querySourceFeatures returns every loaded tile, which can reach far beyond the search point: keep only what is really near
 return out.filter(p=>!R||hav(o,p)<=R).sort((a,b)=>hav(o,a)-hav(o,b));
}
// Small on-device cache of category results: newest 12 areas, kept for a week
const CC_MAX=12;
function ccGet(k){const j=lsJSON('aesthe_cc',{}),e=j&&j[k];return e&&Array.isArray(e.d)&&Date.now()-e.t<6048e5?e.d:[]}
function ccSet(k,d){const j=lsJSON('aesthe_cc',{});if(!j||typeof j!=='object'||Array.isArray(j))return;
 j[k]={t:Date.now(),d:d.slice(0,60).map(slimEl)};
 Object.keys(j).sort((a,b)=>(j[b].t||0)-(j[a].t||0)).slice(CC_MAX).forEach(x=>delete j[x]);
 lsSet('aesthe_cc',JSON.stringify(j))}
const conv=(els,c,k)=>els.map(e=>{const g=e.tags||{};return{name:(lang==='en'&&g['name:en'])||g.name||g.brand||g.operator||c[0].replace(/s$/,''),cat:k,lat:e.lat??(e.center&&e.center.lat),lon:e.lon??(e.center&&e.center.lon),
 addr:[g['addr:housenumber'],g['addr:street'],g['addr:city']].filter(Boolean).join(' '),
 extra:[g.opening_hours&&'Hours: '+g.opening_hours,g.phone&&'Phone: '+g.phone,g.website].filter(Boolean).join(' · ')}}).filter(p=>p.lat!=null);
function merge(a,b,o){
 const out=[...a];
 b.forEach(p=>{const j=out.findIndex(q=>q.name===p.name&&hav(q,p)<80);if(j<0)out.push(p);else if(p.extra&&p.extra.length>(out[j].extra||'').length)out[j]=p});
 return out.sort((x,y)=>hav(o,x)-hav(o,y)).slice(0,50);
}
// Explore tab: a few useful places near you, as soon as the map has loaded
function suggest(){
 const ct=map.getCenter(),o=me?{lat:me.lat,lon:me.lng}:{lat:ct.lat,lon:ct.lng};
 const cnt={},out=[];
 localPOI(null,o,4000).forEach(p=>{cnt[p.cat]=(cnt[p.cat]||0)+1;if(cnt[p.cat]<=3&&out.length<12)out.push(p)});
 if(!out.length)return false;
 items=out;ttl='Near you';place=null;show(items,false);render();return true;
}
let sugDone=false,nTok=0;
map.on('idle',()=>{if(!sugDone&&map.getZoom()>=14&&!items.length&&tab==='explore'&&!place&&suggest())sugDone=true});
async function nearby(i){
 const c=CATS[i],ct=map.getCenter(),o={lat:ct.lat,lon:ct.lng},R=map.getZoom()>=15?1200:map.getZoom()>=14?1800:3000,tok=++nTok;
 tab='explore';place=null;setTabs();ttl=c[0]+' near here';
 const ck='aesthe_c'+i+'_'+ct.lat.toFixed(2)+'_'+ct.lng.toFixed(2);
 let cached=[];try{cached=conv(ccGet(ck),c,i)}catch(e){}
 items=merge(localPOI(i,o,R),cached,o);
 msg='Looking for '+c[0].toLowerCase()+'…';
 if(map.getZoom()<14)map.easeTo({center:ct,zoom:15,duration:500});
 show(items,false);if(items.length&&map.getZoom()>=14)fitNear(items,o);render();
 try{
  const els=(await ovq(`[out:json][timeout:10];nwr${c[1]}(around:${R},${ct.lat},${ct.lng});out center 60;`)).elements;
  ccSet(ck,els);
  if(tok!==nTok)return;
  items=merge(localPOI(i,o,R),conv(els,c,i).filter(p=>hav(o,p)<=R*1.5),o);
 }catch(e){
  if(tok!==nTok)return;
  if(!items.length){msg=navigator.onLine?'Could not reach the places servers. Tap the category to try again.':'You are offline. Categories need internet the first time you look at an area.';render();return}
 }
 msg='No '+c[0].toLowerCase()+' found within '+(R/1000)+' km of the map centre. Move the map and try again.';
 show(items,false);if(items.length)fitNear(items,o);render();
}
// Frame the nearest results together with the point they were searched around, never anything farther (so the map stays where you are)
function fitNear(list,o){
 const b=new maplibregl.LngLatBounds([o.lon,o.lat],[o.lon,o.lat]);list.slice(0,15).forEach(p=>b.extend([p.lon,p.lat]));
 map.fitBounds(b,{padding:PAD(),maxZoom:16,duration:700});
}
$('chips').innerHTML=CATS.map((c,i)=>`<button class="chip" data-i="${i}">${c[0]}</button>`).join('');
$('chips').querySelectorAll('.chip').forEach(el=>el.onclick=()=>{$('chips').querySelectorAll('.chip').forEach(x=>x.classList.remove('on'));el.classList.add('on');nearby(+el.dataset.i)});

function setTabs(){if(tab!=='measure')clearM();document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x.dataset.t===tab))}
document.querySelectorAll('.tab').forEach(el=>el.onclick=()=>{
 tab=el.dataset.t;place=null;if(curMarker){curMarker.remove();curMarker=null}rm('poly-f','poly');setTabs();
 if(tab==='saved')show(saved,true);else if(tab==='measure'){show([],false);drawM()}else{if(!items.length)suggest();show(items,false)}
 render();
});

// Tap any named place on the map (cafes, hotels, hospitals, shops...) to open it, like Google Maps
const poiAt=pt=>{
 const S=sty(),ids=[...(S?S.poi:[]),...['names','names-dot'].filter(i=>map.getLayer(i))];
 if(!ids.length)return undefined;
 return map.queryRenderedFeatures([[pt.x-6,pt.y-6],[pt.x+6,pt.y+6]],{layers:ids}).find(f=>f.properties&&f.properties.name&&f.geometry.type==='Point');
};
map.on('click',e=>{
 $('sug').hidden=true;
 const f=poiAt(e.point);
 if(f){const [lon,lat]=f.geometry.coordinates;
  pick({name:f.properties.name,addr:'',extra:String(f.properties.subclass||f.properties.class||f.properties.kind||'').replace(/_/g,' '),lat,lon})}else rev(e.lngLat)
});
let mmPt=null,mmRaf=0;
map.on('mousemove',e=>{mmPt=e.point;if(!mmRaf)mmRaf=requestAnimationFrame(()=>{mmRaf=0;map.getCanvas().style.cursor=poiAt(mmPt)?'pointer':''})});

// Labels: prefer English/Latin names, show every named place, and add extra names from OpenStreetMap
const EMPTY={type:'FeatureCollection',features:[]};
function applyStyle(){
 map.getStyle().layers.forEach(l=>{
  const s=l['source-layer']||'';
  if(l.type==='symbol'&&/poi|place|_name|aerodrome|mountain|park/.test(s)&&l.layout&&l.layout['text-field'])
   map.setLayoutProperty(l.id,'text-field',lang==='en'?['coalesce',['get','name:en'],['get','name:latin'],['get','name']]:['coalesce',['get','name'],['get','name:latin']]);
  if(s==='poi'&&l.type==='symbol'){map.setFilter(l.id,['has','name']);map.setLayerZoomRange(l.id,14,24);map.setLayoutProperty(l.id,'text-padding',1)}
  if(s==='water'&&l.type==='fill')map.setPaintProperty(l.id,'fill-color','#a5d8f5');
  if(s==='waterway'&&l.type==='line')map.setPaintProperty(l.id,'line-color','#8ccbef');
 });
 if(styleReady&&ti===2)paintDark(true);
}
const NM={bb:null,lang:'',tk:0};
function loadNames(){
 clearTimeout(nt);
 if(!namesOn||map.getZoom()<16)return;
 nt=setTimeout(async()=>{
  const b=map.getBounds(),S=b.getSouth(),W=b.getWest(),N=b.getNorth(),E=b.getEast();
  if(NM.bb&&NM.lang===lang&&S>=NM.bb[0]&&W>=NM.bb[1]&&N<=NM.bb[2]&&E<=NM.bb[3])return;   // this area is already loaded
  const h=(N-S)*.4,w=(E-W)*.4,bb=[S-h,W-w,N+h,E+w],tk=++NM.tk;
  const q='[out:json][timeout:25];nwr["name"][~"^(amenity|shop|tourism|healthcare|leisure|office)$"~"."]('+bb.map(x=>x.toFixed(5)).join(',')+');out center 400;';
  try{
   const r=await ovq(q);if(tk!==NM.tk)return;
   const fs=r.elements.map(e=>{const g=e.tags||{},lat=e.lat??(e.center&&e.center.lat),lon=e.lon??(e.center&&e.center.lon);
    return lat==null?null:{type:'Feature',properties:{name:(lang==='en'&&g['name:en'])||g.name,kind:g.amenity||g.shop||g.tourism||g.healthcare||g.leisure||g.office},geometry:{type:'Point',coordinates:[lon,lat]}}}).filter(Boolean);
   const src=map.getSource('names');if(src){src.setData({type:'FeatureCollection',features:fs});NM.bb=bb;NM.lang=lang}
  }catch(e){}
 },600);
}
map.on('load',()=>{
 applyStyle();
 map.addSource('names',{type:'geojson',data:EMPTY});
 map.addLayer({id:'names-dot',type:'circle',source:'names',minzoom:16,paint:{'circle-radius':3.5,'circle-color':'#e11d2e','circle-stroke-color':'#fff','circle-stroke-width':1.5}});
 map.addLayer({id:'names',type:'symbol',source:'names',minzoom:16,layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':12,'text-offset':[0,.7],'text-anchor':'top'},paint:{'text-color':'#b3121f','text-halo-color':'#fff','text-halo-width':1.6}});
 loadNames();
});
map.on('moveend',loadNames);
// Administrative borders (district / town / village) around the map centre
async function bord(){
 rm('bord-t','bord-l','bord');const bi=$('bi');
 if(!bordOn){bi.hidden=true;return}
 bi.hidden=false;bi.textContent='Finding borders…';
 const c=map.getCenter();
 const q=`[out:json][timeout:40];is_in(${c.lat},${c.lng})->.a;rel(pivot.a)["boundary"="administrative"]["admin_level"~"^([5-9]|10)$"];out geom tags;`;
 try{
  const r=await ovq(q,35000);
  if(!bordOn)return;
  const fs=[],ns=[];
  r.elements.forEach(e=>{const g=e.tags||{};ns.push({n:g.name||'(unnamed)',l:+g.admin_level});
   (e.members||[]).forEach(m=>{if(m.type==='way'&&m.geometry)fs.push({type:'Feature',properties:{name:g.name||''},geometry:{type:'LineString',coordinates:m.geometry.map(p=>[p.lon,p.lat])}})})});
  map.addSource('bord',{type:'geojson',data:{type:'FeatureCollection',features:fs}});
  map.addLayer({id:'bord-l',type:'line',source:'bord',layout:{'line-join':'round'},paint:{'line-color':'#e11d2e','line-width':2.2,'line-dasharray':[4,2]}});
  map.addLayer({id:'bord-t',type:'symbol',source:'bord',layout:{'symbol-placement':'line','text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':11},paint:{'text-color':'#b3121f','text-halo-color':'#fff','text-halo-width':1.5}});
  if(styleReady&&ti===2)paintDark(true);bi.textContent=ns.length?'Borders here (smallest first): '+ns.sort((a,b)=>b.l-a.l).map(x=>x.n+' [level '+x.l+']').join(' › ')+'. Toggle again after moving the map.':'No administrative borders found here.';
 }catch(e){bi.textContent='Could not load borders. Try again in a moment.'}
}
$('tNames').onclick=e=>{NM.bb=null;namesOn=!namesOn;e.target.classList.toggle('on',namesOn);if(!namesOn&&map.getSource('names'))map.getSource('names').setData(EMPTY);loadNames()};
$('tLang').onclick=e=>{NM.bb=null;lang=lang==='en'?'local':'en';e.target.textContent=lang==='en'?'Names: English':'Names: Local';applyStyle();loadNames()};
$('tBord').onclick=e=>{bordOn=!bordOn;e.target.classList.toggle('on',bordOn);bord()};

// ---------- Live tracking, navigation, offline ----------
const say=t=>{if(voiceOn&&window.speechSynthesis){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(t))}};
const circ=(lat,lon,r)=>{const pts=[];for(let i=0;i<=48;i++){const a=i/48*2*Math.PI;pts.push([lon+r*Math.sin(a)/(111320*Math.cos(lat*Math.PI/180)),lat+r*Math.cos(a)/110540])}return{type:'Polygon',coordinates:[pts]}};
const stepText=s=>{const m=s.maneuver,t=m.type,d=m.modifier||'',on=s.name?' onto '+s.name:'';
 if(t==='depart')return 'Start'+(s.name?' on '+s.name:'');
 if(t==='arrive')return 'You have arrived';
 if(/roundabout|rotary/.test(t))return 'At the roundabout, take exit '+(m.exit||'')+on;
 if(d==='uturn')return 'Make a U-turn'+on;
 if(t==='fork')return 'Keep '+d+on;
 if(t==='merge')return 'Merge '+d+on;
 return (!d||d==='straight'?'Continue straight':'Turn '+d)+on};
const stepsHtml=()=>'<div class="row"><button class="btn" id="st">'+(navOn?'Stop navigation':'Start navigation')+'</button></div><ol class="steps">'+nav.steps.map(s=>`<li>${esc(stepText(s))}<small> · ${fmt(s.distance)}</small></li>`).join('')+'</ol>';
map.on('load',()=>{
 map.addSource('acc',{type:'geojson',data:EMPTY});
 map.addLayer({id:'acc',type:'fill',source:'acc',paint:{'fill-color':'#e11d2e','fill-opacity':.12}});
 map.addSource('trail',{type:'geojson',data:EMPTY});
 map.addLayer({id:'trail',type:'line',source:'trail',paint:{'line-color':'#000','line-width':4,'line-opacity':.7}});
});
map.on('dragstart',()=>{tr.follow=false});
map.on('moveend',()=>{lsSet('aesthe_view',JSON.stringify({center:map.getCenter().toArray(),zoom:map.getZoom()}))});
function putMe(){
 if(meMarker)meMarker.setLngLat([me.lng,me.lat]);
 else{const el=document.createElement('div');el.className='me';meMarker=new maplibregl.Marker({element:el}).setLngLat([me.lng,me.lat]).addTo(map)}
}
function offRoute(p){let m=1e9;for(const c of nav.coords){const d=hav(p,{lat:c[1],lon:c[0]});if(d<m)m=d}return m}
function navTick(p){
 const st=nav.steps[nav.i+1];if(!st)return;
 const [lo,la]=st.maneuver.location,d=hav(p,{lat:la,lon:lo}),last=st.maneuver.type==='arrive';
 if(d<(last?30:25)){
  if(last){navOn=false;$('nb').textContent='You have arrived ✓';say('You have arrived');setTimeout(()=>{$('nb').hidden=true},6000);render();return}
  nav.i++;return navTick(p);
 }
 $('nb').textContent=fmt(d)+' · '+stepText(st);
 if(d<150&&nav.said!==nav.i){nav.said=nav.i;say('In '+Math.round(d/10)*10+' metres, '+stepText(st))}
 if(Date.now()-nav.rt>20000&&offRoute(p)>80){nav.rt=Date.now();$('nb').textContent='Rerouting…';route(nav.p,true)}
}
function onFix(pos){
 const c=pos.coords,t=pos.timestamp,acc=c.accuracy||50,raw={lat:c.latitude,lon:c.longitude};
 if(tr.k&&acc>100)return;                       // ignore very poor fixes
 if(!tr.k)tr.k={lat:raw.lat,lon:raw.lon,v:acc*acc,t};
 else{                                          // smooth with a small Kalman filter
  const k=tr.k,dt=Math.max((t-k.t)/1000,0);
  if(dt>0&&hav(k,raw)/dt>70&&acc>25)return;     // reject GPS jumps
  k.v+=dt*9;const g=k.v/(k.v+acc*acc);
  k.lat+=g*(raw.lat-k.lat);k.lon+=g*(raw.lon-k.lon);k.v*=1-g;k.t=t;
 }
 const p={lat:tr.k.lat,lon:tr.k.lon};
 me={lat:p.lat,lng:p.lon};putMe();
 const hd=c.heading!=null&&!isNaN(c.heading);
 meMarker.getElement().classList.toggle('hd',hd);if(hd)meMarker.setRotation(c.heading);
 if(!tr.last){tr.last=p;tr.path.push([p.lon,p.lat])}
 else{const d=hav(tr.last,p);if(d>Math.max(4,acc/3)){tr.dist+=d;tr.last=p;tr.path.push([p.lon,p.lat]);if(tr.path.length>4000)tr.path.splice(0,tr.path.length-4000)}}
 const a=map.getSource('acc'),tl=map.getSource('trail');
 if(a)a.setData({type:'Feature',geometry:circ(p.lat,p.lon,acc)});
 if(tl&&tr.path.length>1)tl.setData({type:'Feature',geometry:{type:'LineString',coordinates:tr.path}});
 $('ts').textContent='● Live · ±'+Math.round(acc)+' m'+(acc>50?' (improving…)':'')+' · '+(c.speed!=null?Math.round(c.speed*3.6)+' km/h · ':'')+fmt(tr.dist);
 if(tr.follow){
  const o={center:[p.lon,p.lat],duration:600};
  if(navOn){o.zoom=Math.max(map.getZoom(),16);if(hd&&(c.speed||0)>1){o.bearing=c.heading;o.pitch=50}}
  else if(!tr.centered&&acc<=100){o.zoom=Math.max(map.getZoom(),16);tr.centered=1}
  map.easeTo(o);
 }
 if(navOn&&nav)navTick(p);
}
function startTrack(){
 if(!navigator.geolocation){toast('Location is not supported on this device.');return}
 if(tr.on)return;
 Object.assign(tr,{on:true,follow:true,k:null,last:null,dist:0,path:[],centered:0});
 $('trk').classList.add('on');$('ts').hidden=false;$('ts').textContent='Getting a precise location…';
 tr.id=navigator.geolocation.watchPosition(onFix,e=>{$('ts').textContent=e&&e.code===1?'Location is blocked for this site':'Location error: '+(e&&e.message||'unknown')},{enableHighAccuracy:true,maximumAge:0,timeout:30000});
 try{navigator.wakeLock&&navigator.wakeLock.request('screen').then(w=>{tr.wl=w}).catch(()=>{})}catch(e){}
}
function stopTrack(){
 navigator.geolocation.clearWatch(tr.id);tr.on=false;$('trk').classList.remove('on');$('ts').hidden=true;
 if(tr.wl){tr.wl.release();tr.wl=null}
 if(navOn)stopNav();
}
function startNav(){
 if(!nav)return;
 try{if(!sessionStorage.getItem('aesthe_navack')){if(!confirm('Directions can be wrong or out of date. Obey road signs and local laws, and do not use your phone while driving. Continue?'))return;sessionStorage.setItem('aesthe_navack','1')}}catch(e){}
 navOn=true;nav.i=0;nav.said=-1;nav.rt=Date.now();
 $('nb').hidden=false;$('nb').textContent='Starting…';
 if(!tr.on)startTrack();
 say('Navigation started');render();
}
function stopNav(){navOn=false;$('nb').hidden=true;render()}
document.addEventListener('visibilitychange',()=>{if(tr.on&&document.visibilityState==='visible'&&navigator.wakeLock)navigator.wakeLock.request('screen').then(w=>{tr.wl=w}).catch(()=>{})});

// Save the area around the map so it still works with weak or no internet.
// A small, one-off download started by the person (about OFF_MAX map files), never a bulk crawl.
const OFF_MAX=350;let offBusy=false;
async function saveOff(){
 const bi=$('bi');bi.hidden=false;
 if(!(navigator.serviceWorker&&navigator.serviceWorker.controller)){bi.textContent='Offline saving works when aesthe is opened from https:// (or localhost). Reload the page once, then try again.';return}
 if(!navigator.onLine){bi.textContent='You are offline. Connect to the internet to save this area.';return}
 if(offBusy)return;offBusy=true;
 bi.textContent='Preparing offline area…';
 try{
  const st=await fetch(CFG.style).then(r=>r.json());
  const src=Object.values(st.sources).find(x=>x.type==='vector'),tpl=(await fetch(src.url).then(r=>r.json())).tiles[0];
  const b=map.getBounds(),w=b.getEast()-b.getWest(),h=b.getNorth()-b.getSouth();
  const W=Math.max(-180,b.getWest()-w/2),E=Math.min(180,b.getEast()+w/2),S=Math.max(-84,b.getSouth()-h/2),N=Math.min(84,b.getNorth()+h/2);
  const tx=(lo,z)=>Math.max(0,Math.min(2**z-1,Math.floor((lo+180)/360*2**z))),ty=(la,z)=>Math.max(0,Math.min(2**z-1,Math.floor((1-Math.log(Math.tan(la*Math.PI/180)+1/Math.cos(la*Math.PI/180))/Math.PI)/2*2**z)));
  let urls=[],top=0;
  // whole zoom levels from zoomed-out to street level, as many as fit under the cap
  for(let z=Math.max(5,Math.min(14,Math.round(map.getZoom()))-3);z<=14;z++){
   const L=[];for(let x=tx(W,z);x<=tx(E,z);x++)for(let y=ty(N,z);y<=ty(S,z);y++)L.push(tpl.replace('{z}',z).replace('{x}',x).replace('{y}',y));
   if(urls.length&&urls.length+L.length>OFF_MAX)break;
   urls=urls.concat(L.slice(0,OFF_MAX));top=z;
  }
  const fonts=new Set();(st.layers||[]).forEach(l=>{const f=l.layout&&l.layout['text-font'];if(Array.isArray(f)&&typeof f[0]==='string'&&f[0]!=='literal')fonts.add(f.join(','))});
  fonts.forEach(f=>['0-255','256-511'].forEach(r=>urls.push(st.glyphs.replace('{fontstack}',encodeURIComponent(f)).replace('{range}',r))));
  if(st.sprite)['.json','.png','@2x.json','@2x.png'].forEach(x=>urls.push(st.sprite+x));
  let n=0;
  for(let i=0;i<urls.length;i+=4){
   if(!navigator.onLine)throw new Error('offline');
   await Promise.all(urls.slice(i,i+4).map(u=>fetch(u).catch(()=>{})));
   n=Math.min(i+4,urls.length);bi.textContent='Saving offline area… '+n+'/'+urls.length;
  }
  bi.textContent='Saved '+urls.length+' map files (down to zoom '+top+'). This area now opens without internet.';
 }catch(e){bi.textContent='Could not save the area. Check your connection and try again.'}
 offBusy=false;
}
const netUI=()=>{const o=$('net');o.hidden=navigator.onLine;o.textContent='Offline · using saved data'};
addEventListener('online',netUI);addEventListener('offline',netUI);netUI();
const cn=navigator.connection;if(cn&&(cn.saveData||/2g|3g/.test(cn.effectiveType||''))){namesOn=false;$('tNames').classList.remove('on')}
$('tVoice').onclick=e=>{voiceOn=!voiceOn;e.target.classList.toggle('on',voiceOn)};
$('tOff').onclick=saveOff;
$('trk').onclick=()=>tr.on?stopTrack():startTrack();
if('serviceWorker'in navigator&&/^https?:/.test(location.protocol)){
 const hadCtl=!!navigator.serviceWorker.controller;let reloading=false;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloading||!hadCtl)return;reloading=true;location.reload()});
 addEventListener('load',()=>setTimeout(()=>navigator.serviceWorker.register('sw.js').then(reg=>{
  const ready=w=>{if(navigator.serviceWorker.controller)toast('A new version of aesthe is ready.',15000,{label:'Reload',fn:()=>w.postMessage('skipWaiting')})};
  if(reg.waiting)ready(reg.waiting);
  reg.addEventListener('updatefound',()=>{const w=reg.installing;if(w)w.addEventListener('statechange',()=>{if(w.state==='installed')ready(w)})});
 }).catch(()=>{}),1500));
}
// Dark map: recolour the map layers themselves so roads and buildings stay clearly visible
const DK={};let styleReady=false;
function paintDark(on){
 if(!map.getStyle())return;
 const set=(id,prop,val)=>{try{const k=id+'|'+prop;if(!(k in DK))DK[k]=map.getPaintProperty(id,prop);map.setPaintProperty(id,prop,on?val:DK[k])}catch(e){}};
 map.getStyle().layers.forEach(l=>{
  const id=l.id,s=l['source-layer']||'',t=l.type;
  if(/^(life|trains)-/.test(id)||id==='poly-f')return;   // the little vehicles keep their own colours (poly-f: the outline fill of an opened place)
  if(t==='background')set(id,'background-color','#0b0b0b');
  else if(t==='fill')set(id,'fill-color',s==='water'?'#0b2a3d':s==='building'?'#2b2b2b':/park|wood|grass|forest|landcover/.test(id+s)?'#102010':'#151515');
  else if(t==='fill-extrusion')set(id,'fill-extrusion-color','#333');
  else if(t==='line'){
   let c=null;
   if(id==='mline'||id==='trail')c='#ffffff';
   else if(s==='transportation'||/road|highway|bridge|tunnel|motorway|path|rail|ferry/.test(id))
    c=/casing/.test(id)?'#050505':/motorway/.test(id)?'#f0b45a':/trunk|primary/.test(id)?'#ececec':/secondary|tertiary/.test(id)?'#c8c8c8':/minor|service|street|residential/.test(id)?'#a0a0a0':/path|pedestrian|track|foot|cycle/.test(id)?'#707070':/rail|transit/.test(id)?'#5a5a5a':'#909090';
   else if(s==='waterway')c='#17506f';
   else if(s==='boundary'||/boundary/.test(id))c='#808080';
   if(c)set(id,'line-color',c);
  }
  else if(t==='symbol'&&l.layout&&l.layout['text-field']){set(id,'text-color',/^(names|bord-t)$/.test(id)?'#ff9aa2':'#e8e8e8');set(id,'text-halo-color','#0b0b0b')}
 });
}
map.on('load',()=>{styleReady=true;paintDark(ti===2)});
// Map colour mode: Default, Grey, Dark (black) and Warm (less blue light). Remembered between visits.
const THEMES=[['','Default'],['m-grey','Grey'],['m-dark','Dark'],['m-warm','Warm']];
let ti=+lsGet('aesthe_theme')||0;if(!(ti>=0&&ti<THEMES.length&&Number.isInteger(ti)))ti=0;
function applyTheme(){
 document.body.classList.remove('m-grey','m-dark','m-warm','dk');
 const t=THEMES[ti];if(t[0])document.body.classList.add(t[0]);if(ti===2)document.body.classList.add('dk');
 $('tTheme').textContent='Map: '+t[1];
 
 if(styleReady)paintDark(ti===2);
}
$('tTheme').onclick=()=>{ti=(ti+1)%THEMES.length;lsSet('aesthe_theme',ti);applyTheme()};
applyTheme();

$('loc').onclick=()=>{if(tr.on){tr.follow=true;if(me)map.flyTo({center:[me.lng,me.lat],zoom:Math.max(map.getZoom(),16)})}else locate(true).catch(()=>{})};
$('zi').onclick=()=>map.zoomIn();
$('zo').onclick=()=>map.zoomOut();
$('d3').onclick=()=>{const on=map.getPitch()<10;map.easeTo({pitch:on?60:0,duration:600});$('d3').classList.toggle('on',on)};
// ---------- Hanging film photo (only for a spot the user has marked) ----------
// One square frame; extra photos sit to its left and are revealed by swiping / dragging right.
// Sources, most trustworthy first: photos linked to the place in OpenStreetMap
// (image / wikimedia_commons / wikidata tags) > Wikipedia > Mapillary street photos taken facing the spot (own token)
// > Wikimedia Commons photos whose title names the place > Commons photos within 40 m of the pin.
const PH={on:true,cache:new Map(),tok:0,ctl:null};
PH.on=lsGet('aesthe_photos')!=='0';
let mkey=lsGet('aesthe_mkey')||CFG.mapillaryToken||'';
const stripH=h=>String(h||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
const safeUrl=u=>/^https:\/\//.test(u||'')?u:'';
const STOP=new Set(['the','and','cafe','coffee','hotel','restaurant','shop','store','bar','hospital','school','college','park','road','street','near','new','old','for','of','in','day','house','centre','center']);
const sigWords=x=>norm(x).split(' ').filter(w=>w.length>2&&!STOP.has(w));
const isNamed=p=>!/^(dropped point|coordinates)$/i.test(p.name||'');
const brg=(a,b)=>{const r=Math.PI/180,y=Math.sin((b.lon-a.lon)*r)*Math.cos(b.lat*r),x=Math.cos(a.lat*r)*Math.sin(b.lat*r)-Math.sin(a.lat*r)*Math.cos(b.lat*r)*Math.cos((b.lon-a.lon)*r);return(Math.atan2(y,x)/r+360)%360};
const CM='https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*';
const CMI='&prop=imageinfo&iiprop='+encodeURIComponent('url|mime|extmetadata')+'&iiurlwidth=900&iiextmetadatafilter='+encodeURIComponent('Artist|LicenseShortName');
const fileUrl=(n,w)=>'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(String(n).replace(/^File:/i,'').replace(/ /g,'_'))+(w?'?width='+w:'');
function mapCommons(j,p,rank,note){
 return Object.values((j.query&&j.query.pages)||{}).sort((a,b)=>(a.index||0)-(b.index||0)).map(pg=>{
  const ii=pg.imageinfo&&pg.imageinfo[0];if(!ii||!/^image\/(jpeg|png|webp)$/.test(ii.mime))return null;
  const md=ii.extmetadata||{},c=pg.coordinates&&pg.coordinates[0],d=c&&p?hav(p,{lat:c.lat,lon:c.lon}):null,th=ii.thumburl||ii.url;
  const title=pg.title.replace(/^File:/,'').replace(/\.\w+$/,'').replace(/_/g,' ');
  const n=typeof note==='function'?note(d,title):note;if(n===null)return null;
  return{src:th.replace(/\/\d+px-/,devicePixelRatio>=2?'/600px-':'/400px-'),full:th,title,by:stripH(md.Artist&&md.Artist.value),lic:stripH(md.LicenseShortName&&md.LicenseShortName.value),page:safeUrl(ii.descriptionurl),from:'Wikimedia Commons',rank:n.rank??rank,d,note:n.text??n};
 }).filter(Boolean);
}
// Wikimedia asks clients to make requests in series: at most 2 at a time
const WM={act:0,q:[]};
function wmget(u,sig,ms){
 return new Promise((res,rej)=>{
  const next=()=>{const n=WM.q.shift();if(n)n()};
  const run=()=>{WM.act++;jget(u,sig,ms).then(res,rej).finally(()=>{WM.act--;next()})};
  if(sig&&sig.aborted)return rej(new Error('abort'));
  if(WM.act<2)run();else WM.q.push(()=>{if(sig&&sig.aborted){rej(new Error('abort'));next()}else run()});
 });
}
const commonsTitles=(t,p,rank,note,sig)=>t.length?wmget(CM+'&titles='+encodeURIComponent(t.slice(0,8).join('|'))+CMI,sig,8000).then(j=>mapCommons(j,p,rank,note)):Promise.resolve([]);
const commonsCat=(c,p,rank,note,sig)=>wmget(CM+'&generator=categorymembers&gcmtitle='+encodeURIComponent(c)+'&gcmtype=file&gcmlimit=8'+CMI,sig,8000).then(j=>mapCommons(j,p,rank,note));
// 1) Photos the OpenStreetMap community has linked to this very place
async function qOSM(p,sig){
 const q=`[out:json][timeout:8];(nwr(around:70,${p.lat},${p.lon})["wikimedia_commons"];nwr(around:70,${p.lat},${p.lon})["image"];nwr(around:70,${p.lat},${p.lon})["wikidata"];);out tags center 25;`;
 const els=(await ovq(q)).elements,nq=norm(p.name),tk=nq.split(' ').filter(Boolean),named=isNamed(p);
 const hit=els.map(e=>{const g=e.tags||{},la=e.lat??(e.center&&e.center.lat),lo=e.lon??(e.center&&e.center.lon);if(la==null)return null;
   const d=hav(p,{lat:la,lon:lo}),m=Math.max(mscore(nq,tk,norm(g['name:en']||'')),mscore(nq,tk,norm(g.name||'')));
   return(named?(m>=.6&&d<150)||(m>=.45&&d<15):d<15)?{g,d}:null}).filter(Boolean).sort((a,b)=>a.d-b.d).slice(0,3);
 const note='Linked to this place on OpenStreetMap',out=[],jobs=[];
 hit.forEach(({g})=>{
  const files=[],cats=[];
  String(g.wikimedia_commons||'').split(';').forEach(x=>{x=x.trim();if(/^file:/i.test(x))files.push(x.replace(/^file:/i,'File:'));else if(/^category:/i.test(x))cats.push(x)});
  String(g.image||'').split(';').slice(0,3).forEach(x=>{x=x.trim();if(!safeUrl(x))return;
   const m=x.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/i);
   if(m)files.push(decodeURIComponent(m[1]));
   else if(/^https:\/\/upload\.wikimedia\.org\/.+\.(jpe?g|png|webp)(\?|$)/i.test(x))out.push({src:x,full:x,title:g.name||p.name,by:'',lic:'',page:x,from:'OpenStreetMap link',rank:1,d:null,note});
  });
  if(/^Q\d+$/.test(g.wikidata||''))jobs.push(wmget('https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&origin=*&property=P18&entity='+g.wikidata,sig,8000).then(j=>commonsTitles(((j.claims&&j.claims.P18)||[]).map(c=>'File:'+(c.mainsnak&&c.mainsnak.datavalue&&c.mainsnak.datavalue.value)).filter(x=>x!=='File:undefined'),p,1,note,sig)).catch(()=>[]));
  if(files.length)jobs.push(commonsTitles(files,p,1,note,sig).catch(()=>[]));
  cats.slice(0,1).forEach(c=>jobs.push(commonsCat(c,p,1,note,sig).catch(()=>[])));
 });
 return[...out,...(await Promise.all(jobs)).flat()];
}
// 2) Wikimedia Commons: geotagged photos near the pin (labelled by how close/relevant they are)
function qCommonsGeo(p,sig){
 const u=CM+'&generator=geosearch&ggscoord='+p.lat+'%7C'+p.lon+'&ggsradius=500&ggslimit=40&ggsnamespace=6&prop=imageinfo%7Ccoordinates&colimit=40&iiprop='+encodeURIComponent('url|mime|extmetadata')+'&iiurlwidth=900&iiextmetadatafilter='+encodeURIComponent('Artist|LicenseShortName');
 const w=isNamed(p)?sigWords(p.name):[];
 return wmget(u,sig,8000).then(j=>mapCommons(j,p,3,(d,title)=>{
  if(d==null)return null;const m=Math.round(d)+' m';
  if(w.length&&d<=150&&w.some(t=>norm(title).includes(t)))return{rank:3,text:'Photo of this place from Wikimedia Commons ('+m+' from the pin)'};
  if(d<=40)return{rank:4,text:'Nearby photo, '+m+' from the pin'};
  if(d<=400)return{rank:6,text:'Photo taken nearby, '+m+' from the pin'};
  return null;
 }));
}
// 2b) Wikipedia: the article for this place (by name), and the articles around it, with their lead pictures
const WP='https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=coordinates%7Cpageimages%7Cinfo&inprop=url&piprop=thumbnail&pithumbsize=800&colimit=15&pilimit=15';
function wikiPhotos(j,p,decide){
 const nq=norm(p.name),tk=nq.split(' ').filter(Boolean);
 return Object.values((j.query&&j.query.pages)||{}).map(pg=>{
  const th=pg.thumbnail&&pg.thumbnail.source;if(!th)return null;
  const c=pg.coordinates&&pg.coordinates[0],d=c?hav(p,{lat:c.lat,lon:c.lon}):null;
  const m=isNamed(p)?mscore(nq,tk,norm(pg.title)):0,r=decide(d,m,pg.title);if(!r)return null;
  return{src:th,full:th,title:pg.title,by:'',lic:'See the Wikipedia article for the licence',page:safeUrl(pg.fullurl),from:'Wikipedia',rank:r.rank,d,note:r.text};
 }).filter(Boolean).sort((a,b)=>a.rank-b.rank||(a.d??1e9)-(b.d??1e9));
}
function qWikiGeo(p,sig){
 const u=WP+'&generator=geosearch&ggscoord='+p.lat+'%7C'+p.lon+'&ggsradius=1000&ggslimit=15';
 return wmget(u,sig,8000).then(j=>wikiPhotos(j,p,(d,m,t)=>{
  if(d==null)return null;const n=Math.round(d)+' m';
  if(m>=.6&&d<=250)return{rank:1,text:'Wikipedia article for this place'};
  return{rank:5,text:'Nearby on Wikipedia: '+t+' ('+n+' from the pin)'};
 }).slice(0,5));
}
function qWikiName(p,sig){
 if(!isNamed(p)||norm(p.name).length<3)return Promise.resolve([]);
 const u=WP+'&generator=search&gsrsearch='+encodeURIComponent(p.name)+'&gsrlimit=5&gsrnamespace=0';
 return wmget(u,sig,8000).then(j=>wikiPhotos(j,p,(d,m)=>d!=null&&d<=2500&&m>=.6?{rank:1,text:'Wikipedia article for this place'}:null));
}
// ---- the person's own photos for a spot (kept on this device, in IndexedDB) ----
const UP={db:null,mem:[]};
function upDb(){
 if(UP.db)return UP.db;
 UP.db=new Promise(res=>{try{const r=indexedDB.open('aesthe_photos',1);r.onupgradeneeded=()=>r.result.createObjectStore('p',{keyPath:'id'});r.onsuccess=()=>res(r.result);r.onerror=()=>res(null)}catch(e){res(null)}});
 return UP.db;
}
async function upAll(){
 const db=await upDb();if(!db)return UP.mem;
 return new Promise(res=>{try{const q=db.transaction('p').objectStore('p').getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>res(UP.mem)}catch(e){res(UP.mem)}});
}
async function upPut(rec){
 const db=await upDb();if(!db){UP.mem.push(rec);return}
 return new Promise(res=>{try{const t=db.transaction('p','readwrite');t.objectStore('p').put(rec);t.oncomplete=()=>res();t.onerror=()=>{UP.mem.push(rec);res()}}catch(e){UP.mem.push(rec);res()}});
}
async function upDel(id){
 UP.mem=UP.mem.filter(r=>r.id!==id);const db=await upDb();if(!db)return;
 return new Promise(res=>{try{const t=db.transaction('p','readwrite');t.objectStore('p').delete(id);t.oncomplete=()=>res();t.onerror=()=>res()}catch(e){res()}});
}
async function myPhotos(p){
 return(await upAll()).filter(r=>hav(p,r)<40).sort((a,b)=>b.t-a.t).map(r=>({id:r.id,src:r.data,full:r.data,title:p.name,by:'You',lic:'',page:'',from:'Your photo',rank:-1,d:null,note:'Added by you'}));
}
function shrink(file){
 return new Promise((res,rej)=>{
  const im=new Image(),u=URL.createObjectURL(file);
  im.onload=()=>{const k=Math.min(1,1280/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);
   c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);res(c.toDataURL('image/jpeg',.82))};
  im.onerror=()=>{URL.revokeObjectURL(u);rej()};im.src=u;
 });
}
$('pf').onchange=async e=>{
 const files=[...e.target.files].filter(f=>/^image\//.test(f.type)).slice(0,8),p=place;e.target.value='';
 if(!p||!files.length)return;
 for(const f of files){try{await upPut({id:Date.now()+'-'+Math.random().toString(36).slice(2,7),lat:p.lat,lon:p.lon,t:Date.now(),data:await shrink(f)})}catch(_){}}
 if(place===p&&curMarker){document.querySelectorAll('.hang').forEach(x=>x.remove());PH.on=true;$('tPhoto').classList.add('on');hangPhotos(p,curMarker)}
};
document.addEventListener('click',e=>{if(e.target.closest('#ap'))$('pf').click()});
// 3) Mapillary: street-level photos taken close to the spot and pointing at it (needs a free token)
function qMapillary(p,sig){
 if(!mkey)return Promise.resolve([]);
 const dl=.0005,dn=dl/Math.cos(p.lat*Math.PI/180);
 const u='https://graph.mapillary.com/images?access_token='+encodeURIComponent(mkey)+'&fields='+encodeURIComponent('id,thumb_256_url,thumb_1024_url,captured_at,compass_angle,geometry,creator')+'&bbox='+[p.lon-dn,p.lat-dl,p.lon+dn,p.lat+dl].map(x=>x.toFixed(6)).join(',')+'&limit=80';
 return jget(u,sig,9000).then(j=>{
  const c=(j.data||[]).map(m=>{
   const g=m.geometry&&m.geometry.coordinates;if(!g||m.compass_angle==null||!m.thumb_256_url)return null;
   const q={lat:g[1],lon:g[0]},d=hav(q,p);if(d<4||d>45)return null;
   const df=Math.abs(((m.compass_angle-brg(q,p))%360+540)%360-180);if(df>45)return null;
   return{m,q,d,df,sc:d+df*.4-(m.captured_at||0)/1e12};
  }).filter(Boolean).sort((a,b)=>a.sc-b.sc),out=[];
  c.forEach(x=>{if(out.length<4&&!out.some(o=>hav(o.q,x.q)<12&&Math.abs(o.m.compass_angle-x.m.compass_angle)<25))out.push(x)});
  return out.map(x=>({src:(devicePixelRatio>=2&&x.m.thumb_1024_url)||x.m.thumb_256_url,full:x.m.thumb_1024_url||x.m.thumb_256_url,title:p.name,by:(x.m.creator&&x.m.creator.username)||'',lic:'CC BY-SA 4.0',page:'https://www.mapillary.com/app/?pKey='+encodeURIComponent(x.m.id),from:'Mapillary',rank:2,d:x.d,note:'Street-level photo taken '+Math.round(x.d)+' m away, facing this spot'}));
 });
}
function mergePh(a){
 const m=new Map();
 a.forEach(x=>{const k=(x.from==='Wikimedia Commons'?'c':x.from)+norm(x.title)+(x.from==='Mapillary'?x.page:'')+(x.from==='Your photo'?x.id:'');const o=m.get(k);if(!o||x.rank<o.rank)m.set(k,x)});
 return[...m.values()].sort((x,y)=>x.rank-y.rank||(x.d??1e9)-(y.d??1e9)).slice(0,12);
}
async function loadPhotos(p,sig,onList){
 const k=key(p),mine=await myPhotos(p).catch(()=>[]);
 if(sig.aborted)return;
 if(PH.cache.has(k)){onList(mergePh([...mine,...PH.cache.get(k)]),true);return}
 let net=[];
 if(mine.length)onList(mergePh(mine),false);
 const job=pr=>pr.then(l=>{net=mergePh([...net,...l]);onList(mergePh([...mine,...net]),false)}).catch(()=>{});
 await Promise.all([job(qOSM(p,sig)),job(qWikiName(p,sig)),job(qWikiGeo(p,sig)),job(qMapillary(p,sig)),job(qCommonsGeo(p,sig))]);
 if(!sig.aborted&&PH.cache.size<60)PH.cache.set(k,net);
 onList(mergePh([...mine,...net]),true);
}
// ---- the hanging frame ----
function syncHang(h){
 const clip=h.querySelector('.clip'),fr=[...clip.querySelectorAll('.fr[data-i]')],cnt=h.querySelector('.cnt'),l=h.querySelector('.ar.l'),r=h.querySelector('.ar.r');
 if(!fr.length){cnt.hidden=l.hidden=r.hidden=true;return}
 const max=clip.scrollWidth-clip.clientWidth,fe=max-clip.scrollLeft,step=fr[0].offsetWidth+8,k=Math.min(fr.length-1,Math.max(0,Math.round(fe/step)));
 cnt.textContent=(k+1)+' / '+fr.length;
 {const cap=h.querySelector('.cap'),f=fr[fr.length-1-k],ph=f&&h.__l&&h.__l[+f.dataset.i];
  if(cap&&ph){cap.textContent=ph.from==='Your photo'?'Your photo':[ph.by&&'© '+ph.by,ph.lic&&!/^See /.test(ph.lic)?ph.lic:'',ph.from].filter(Boolean).join(' · ');cap.hidden=false}}
 cnt.hidden=fr.length<2;l.hidden=fr.length<2||clip.scrollLeft<=2;r.hidden=fr.length<2||fe<=2;
}
function buildHang(){
 const h=document.createElement('div');h.className='hang';
 h.innerHTML='<div class="wrap"><div class="sw"><div class="nail"></div><div class="cord"></div><div class="hold"><i class="pn"></i><div class="clip"><figure class="fr ld"><span>Finding photos…</span></figure></div><span class="cnt" hidden></span><button class="ar l" hidden aria-label="Show earlier photos">&#8249;</button><button class="ar r" hidden aria-label="Show next photo">&#8250;</button></div></div><div class="cap" hidden></div><div class="stem"></div></div>';
 const clip=h.querySelector('.clip');
 ['mousedown','pointerdown','touchstart','dblclick','click','contextmenu'].forEach(ev=>h.addEventListener(ev,e=>e.stopPropagation(),{passive:true}));
 clip.addEventListener('wheel',e=>{e.stopPropagation();h.__t=1;if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();clip.scrollLeft+=e.deltaY}},{passive:false});
 let x0=0,s0=0,dn=false;h.__m=false;
 clip.addEventListener('pointerdown',e=>{h.__t=1;h.classList.add('act');if(e.pointerType!=='mouse'||e.button!==0)return;dn=true;h.__m=false;x0=e.clientX;s0=clip.scrollLeft});
 clip.addEventListener('pointermove',e=>{if(!dn)return;const dx=e.clientX-x0;if(!h.__m&&Math.abs(dx)>5){h.__m=true;clip.classList.add('dg');try{clip.setPointerCapture(e.pointerId)}catch(_){}}if(h.__m)clip.scrollLeft=s0-dx});
 const end=()=>{dn=false;clip.classList.remove('dg');setTimeout(()=>{h.__m=false;h.classList.remove('act')},0)};
 clip.addEventListener('pointerup',end);clip.addEventListener('pointercancel',end);
 clip.addEventListener('scroll',()=>syncHang(h),{passive:true});
 const go=d=>{h.__t=1;const f=clip.querySelector('.fr[data-i]');clip.scrollBy({left:d*((f?f.offsetWidth:130)+8),behavior:'smooth'})};
 h.querySelector('.ar.l').onclick=()=>go(-1);h.querySelector('.ar.r').onclick=()=>go(1);
 return h;
}
function fillHang(h,list,final){
 const clip=h.querySelector('.clip');
 if(!list.length){
  if(!final)return;
  clip.innerHTML='<figure class="fr ld"><div>No photos found for this spot<br><button type="button">＋ Add your photo</button></div></figure>';
  clip.querySelector('button').onclick=ev=>{ev.stopPropagation();$('pf').click()};
  h.__l=[];h.querySelector('.cap').hidden=true;syncHang(h);return;
 }
 h.__l=list;
 const fe=clip.scrollWidth-clip.clientWidth-clip.scrollLeft;
 clip.innerHTML='';
 // best photo is the last (right-most) frame; the rest sit to its left
 for(let i=list.length-1;i>=0;i--){
  const ph=list[i],f=document.createElement('figure');f.className='fr';f.dataset.i=i;
  const im=new Image();im.alt=ph.title;im.decoding='async';im.referrerPolicy='no-referrer';im.draggable=false;
  im.onerror=()=>{ph.bad=true;f.remove();if(!clip.querySelector('.fr[data-i]'))h.remove();else syncHang(h)};
  im.src=ph.src;f.appendChild(im);
  f.addEventListener('click',ev=>{ev.stopPropagation();if(h.__m)return;const good=list.filter(x=>!x.bad);openLb(good,good.indexOf(ph))});
  clip.appendChild(f);
 }
 requestAnimationFrame(()=>{clip.scrollLeft=h.__t?Math.max(0,clip.scrollWidth-clip.clientWidth-fe):clip.scrollWidth;syncHang(h)});
}
function hangPhotos(p,marker){
 if(!PH.on||!navigator.onLine)return;
 const my=++PH.tok;if(PH.ctl)PH.ctl.abort();PH.ctl=new AbortController();
 const h=buildHang();marker.getElement().appendChild(h);
 loadPhotos(p,PH.ctl.signal,(list,final)=>{if(my!==PH.tok||place!==p||curMarker!==marker||!h.isConnected)return;fillHang(h,list,final)}).catch(()=>{});
}
// Full-size viewer with credits
let lbList=[],lbI=0;
function lbShow(){
 const ph=lbList[lbI],lb=$('lb');if(!ph)return;
 const bi=lb.querySelector('img');bi.alt=ph.title;bi.src=ph.src||ph.full;   // show the thumbnail instantly, then swap in the sharp one
 if(ph.full&&ph.full!==ph.src){const t=new Image();t.onload=()=>{if(lbList[lbI]===ph)bi.src=ph.full};t.src=ph.full}
 const nx=lbList[(lbI+1)%lbList.length];if(nx&&nx!==ph&&nx.full)new Image().src=nx.full;
 const cr=[ph.by&&('© '+esc(ph.by)),ph.lic&&esc(ph.lic),ph.from&&('Source: '+(ph.page?`<a href="${esc(ph.page)}" target="_blank" rel="noopener noreferrer">${esc(ph.from)}</a>`:esc(ph.from)))].filter(Boolean).join(' · ');
 lb.querySelector('figcaption').innerHTML=esc(ph.title)+'<small>'+(ph.note?esc(ph.note)+'<br>':'')+cr+(lbList.length>1?' · '+(lbI+1)+'/'+lbList.length:'')+'</small>';
 lb.querySelectorAll('.nv').forEach(b=>b.hidden=lbList.length<2);
 lb.querySelector('.rmb').hidden=ph.from!=='Your photo';
}
function openLb(list,i){lbList=list;lbI=i;$('lb').hidden=false;lbShow()}
const closeLb=()=>{$('lb').hidden=true;$('lb').querySelector('img').removeAttribute('src')};
$('lb').querySelector('.cx').onclick=closeLb;
$('lb').querySelector('.rmb').onclick=async()=>{
 const ph=lbList[lbI];if(!ph||ph.from!=='Your photo')return;
 await upDel(ph.id);closeLb();
 if(place&&curMarker){document.querySelectorAll('.hang').forEach(x=>x.remove());hangPhotos(place,curMarker)}
};
$('lb').querySelector('.p').onclick=()=>{lbI=(lbI-1+lbList.length)%lbList.length;lbShow()};
$('lb').querySelector('.n').onclick=()=>{lbI=(lbI+1)%lbList.length;lbShow()};
$('lb').addEventListener('click',e=>{if(e.target===$('lb'))closeLb()});
addEventListener('keydown',e=>{
 if($('lb').hidden)return;
 if(e.key==='Escape'){e.stopImmediatePropagation();closeLb()}
 else if(e.key==='ArrowLeft'&&lbList.length>1){lbI=(lbI-1+lbList.length)%lbList.length;lbShow()}
 else if(e.key==='ArrowRight'&&lbList.length>1){lbI=(lbI+1)%lbList.length;lbShow()}
},true);
function setPhotos(on){
 PH.on=on;$('tPhoto').classList.toggle('on',on);lsSet('aesthe_photos',on?'1':'0')
 document.querySelectorAll('.hang').forEach(x=>x.remove());PH.tok++;
 if(on&&place&&curMarker)hangPhotos(place,curMarker);
}
$('tPhoto').onclick=()=>setPhotos(!PH.on);
$('tPhoto').classList.toggle('on',PH.on);
const refreshHang=()=>{if(place&&curMarker){document.querySelectorAll('.hang').forEach(x=>x.remove());hangPhotos(place,curMarker)}};

// ---------- About sheet, first-run notice, clear my data ----------
const about=$('about');
function openAbout(){$('mtok').value=mkey;about.hidden=false;$('aclose').focus()}
function closeAbout(){about.hidden=true;$('wipe').textContent='Clear my data'}
$('abt').onclick=openAbout;$('aclose').onclick=closeAbout;
about.addEventListener('click',e=>{if(e.target===about)closeAbout()});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!about.hidden){e.stopImmediatePropagation();closeAbout()}},true);
$('msave').onclick=()=>{mkey=$('mtok').value.trim();lsSet('aesthe_mkey',mkey);PH.cache.clear();toast(mkey?'Mapillary token saved on this device.':'Mapillary token removed.');closeAbout();refreshHang()};
async function wipeData(){
 wiping=true;
 try{Object.keys(localStorage).filter(k=>/^aesthe/.test(k)).forEach(k=>localStorage.removeItem(k))}catch(e){}
 try{sessionStorage.clear()}catch(e){}
 try{const db=UP.db&&await UP.db;if(db)db.close();await new Promise(r=>{const q=indexedDB.deleteDatabase('aesthe_photos');q.onsuccess=q.onerror=q.onblocked=()=>r()})}catch(e){}
 try{for(const k of await caches.keys())await caches.delete(k)}catch(e){}
 try{const rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(r=>r.unregister()))}catch(e){}
 location.reload();
}
{let armed=0;$('wipe').onclick=()=>{
 if(armed){wipeData();return}
 armed=1;$('wipe').textContent='Tap again to confirm';setTimeout(()=>{armed=0;if(!about.hidden)$('wipe').textContent='Clear my data'},4000);
}}
{
 const note=$('notice'),seen=()=>{lsSet('aesthe_notice','1');note.hidden=true};
 if(!lsGet('aesthe_notice')&&!lsGet('aesthe_consent')){note.hidden=false;$('nok').onclick=seen;$('nmore').onclick=()=>{seen();openAbout()}}
}

document.querySelectorAll('.fab button').forEach(b=>b.setAttribute('aria-label',b.title||(b.id==='zi'?'Zoom in':b.id==='zo'?'Zoom out':b.id)));
new MutationObserver(()=>$('q').setAttribute('aria-expanded',String(!$('sug').hidden))).observe($('sug'),{attributes:true,attributeFilter:['hidden']});
$('body').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('item')&&e.target.dataset.i!=null){e.preventDefault();e.target.click()}});

// Fullscreen map and minimisable panel
const side=document.querySelector('.side');
function setMin(on){
 side.classList.toggle('min',on);document.body.classList.toggle('pmin',on);
 const b=$('pmin');b.innerHTML=on?'+':'&minus;';b.title=b.ariaLabel=on?'Expand panel':'Minimise panel';
}
function setFs(on){
 document.body.classList.toggle('fs',on);$('fs').classList.toggle('on',on);
 try{
  if(on&&!document.fullscreenElement&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});
  if(!on&&document.fullscreenElement)document.exitFullscreen().catch(()=>{});
 }catch(e){}
 setTimeout(()=>map.resize(),150);
}
$('pmin').onclick=()=>setMin(!side.classList.contains('min'));
$('pfs').onclick=$('fs').onclick=()=>setFs(!document.body.classList.contains('fs'));
$('xfs').onclick=()=>setFs(false);
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&document.body.classList.contains('fs'))setFs(false)});
addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('fs'))setFs(false)});
render();
// Location is never requested automatically: only the location button, "near me" searches and directions ask for it.
