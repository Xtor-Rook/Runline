const SUPABASE_URL='https://ubljegtzykqyajetfdas.supabase.co';
const SUPABASE_KEY='sb_publishable_FVMaFsO4Am_UjPUB3PrvxQ_F7A0g41v';
const KEY='runline-v5';
const PREV_KEY='runline-v4';
const OLD_KEY='runline-v3';
const OLDER_KEY='runline-v2';
const LEGACY_KEY='runline_v1';
const VIDEO_DB='runline-video-v1';
const VIDEO_STORE='videos';
const MAP_DB='runline-map-v1';
const MAP_STORE='maps';
const defaultState={dogs:[],trials:[],runs:[]};
const OBSTACLE_TYPES=[
  {id:'jump',code:'J',name:'Jump'},
  {id:'tunnel',code:'TUN',name:'Tunnel'},
  {id:'weaves',code:'WV',name:'Weaves'},
  {id:'dogwalk',code:'DW',name:'Dogwalk'},
  {id:'aframe',code:'A',name:'A-frame'},
  {id:'teeter',code:'TT',name:'Teeter'},
  {id:'tire',code:'TR',name:'Tire'},
  {id:'spread',code:'SP',name:'Spread / wall'},
  {id:'other',code:'?',name:'Other'}
];
const MARKER_TYPES=[
  {id:'front',code:'FC',name:'Front cross'},
  {id:'rear',code:'RC',name:'Rear cross'},
  {id:'blind',code:'BC',name:'Blind cross'},
  {id:'send',code:'GO',name:'Send'},
  {id:'collect',code:'COL',name:'Collection'},
  {id:'decel',code:'DEC',name:'Deceleration'},
  {id:'wrap',code:'WR',name:'Wrap'},
  {id:'threadle',code:'TH',name:'Threadle'},
  {id:'discrim',code:'DIS',name:'Discrimination'},
  {id:'note',code:'!',name:'Watch / note'},
  {id:'issue',code:'×',name:'Issue'}
];
let state=load();
let currentRunId=null;
let bgImage=null;
let mapDataOriginal=null;
let strokes=[];
let markers=[];
let obstacles=[];
let actionHistory=[];
let activeTool='planned';
let activeMarkerKind=null;
let activeObstacleType=null;
let linkTargetObstacleId=null;
let currentPhase='plan';
let drawing=false;
let currentStroke=null;
let selectedMarkerId=null;
let selectedObstacleId=null;
let draggingMarker=false;
let draggingObstacle=false;
let dragOffset={x:0,y:0};
let videoNotes=[];
let videoMeta=null;
let pendingVideoFile=null;
let currentVideoObjectUrl=null;
let cloudClient=null;
let cloudUser=null;
let cloudSyncTimer=null;
let cloudSyncing=false;
let suppressCloudSync=false;
let plannerDirty=false;
let plannerLocalSaved=false;
let plannerCloudState='off';
let ringsideMode=false;
let mapNavMode=false;
let mapZoom=1;
let mapPanX=0;
let mapPanY=0;
let mapGesturePointers=new Map();
let mapGestureStart=null;
const CLOUD_DELETE_KEY='runline-cloud-deletes-v1';
const $=id=>document.getElementById(id);

function load(){
  try{
    const saved=localStorage.getItem(KEY) || localStorage.getItem(PREV_KEY) || localStorage.getItem(OLD_KEY) || localStorage.getItem(OLDER_KEY) || localStorage.getItem(LEGACY_KEY);
    const parsed=saved?JSON.parse(saved):structuredClone(defaultState);
    if(!parsed.dogs||!parsed.trials||!parsed.runs) return structuredClone(defaultState);
    return parsed;
  }catch{return structuredClone(defaultState)}
}
function persist(){
  try{
    localStorage.setItem(KEY,JSON.stringify(state));
    renderAll();
    if(!suppressCloudSync) queueCloudSync();
    return true;
  }catch(e){
    console.error('Runline persistence failed',e);
    toast('Could not save — device storage may be full.');
    return false;
  }
}
function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1600)}
function updatePlannerStatus(){
  const local=$('localSaveBadge'),cloud=$('plannerCloudBadge');
  if(local){
    local.classList.toggle('dirty',plannerDirty);
    local.classList.toggle('saved',!plannerDirty&&plannerLocalSaved);
    local.textContent=plannerDirty?'Unsaved':(plannerLocalSaved?'Saved locally ✓':'Not saved');
  }
  if(cloud){
    cloud.classList.toggle('synced',plannerCloudState==='synced');
    cloud.classList.toggle('pending',plannerCloudState==='pending'||plannerCloudState==='syncing');
    cloud.textContent=plannerCloudState==='synced'?'Cloud synced ✓':plannerCloudState==='syncing'?'Syncing…':plannerCloudState==='pending'?'Cloud pending':'Cloud off';
  }
}
function markPlannerDirty(){
  plannerDirty=true;plannerLocalSaved=false;
  if(cloudUser)plannerCloudState='pending';
  updatePlannerStatus();
}
function markPlannerSaved(){
  plannerDirty=false;plannerLocalSaved=true;
  plannerCloudState=cloudUser?(navigator.onLine?'pending':'pending'):'off';
  updatePlannerStatus();
}
function updateRingsideSummary(){
  const el=$('ringsideSummary');if(!el)return;
  const dog=dogName($('courseDog')?.value),trial=trialName($('courseTrial')?.value),cls=$('courseClass')?.value.trim();
  el.textContent=[dog!=='Unknown dog'?dog:'',trial!=='Unassigned trial'?trial:'',cls].filter(Boolean).join(' · ')||'Current run';
}
function updateQuickResultButtons(){
  const v=$('runResult')?.value||'';
  document.querySelectorAll('[data-quick-result]').forEach(b=>b.classList.toggle('active',b.dataset.quickResult===v));
}
function setRingsideMode(on){
  ringsideMode=!!on;
  document.body.classList.toggle('ringside',ringsideMode);
  const b=$('ringsideBtn');if(b)b.textContent=ringsideMode?'Exit ringside':'Ringside mode';
  updateRingsideSummary();
  setTimeout(()=>{drawCanvas();$('mapCard')?.scrollIntoView({block:'start'})},30);
}
function showPlannerBottomNav(show){$('plannerBottomNav')?.classList.toggle('hidden',!show)}
function applyMapTransform(){
  const c=$('courseCanvas');if(!c)return;
  c.style.transform=`translate(${mapPanX}px,${mapPanY}px) scale(${mapZoom})`;
  const z=$('mapZoomLabel');if(z)z.textContent=Math.round(mapZoom*100)+'%';
  $('mapResetBtn')?.classList.toggle('hidden',mapZoom===1&&Math.abs(mapPanX)<1&&Math.abs(mapPanY)<1);
}
function resetMapView(){mapZoom=1;mapPanX=0;mapPanY=0;mapGesturePointers.clear();mapGestureStart=null;applyMapTransform()}
function setMapNavMode(on){
  mapNavMode=!!on;
  $('plannerWrap')?.classList.toggle('navMode',mapNavMode);
  const b=$('mapNavBtn');if(b)b.textContent=mapNavMode?'✓ Done zooming':'✋ Pan / zoom';
  if(mapNavMode){drawing=false;currentStroke=null;draggingMarker=false;draggingObstacle=false}
}
function fmtDate(d){if(!d)return'';return new Date(d+'T12:00:00').toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}
function dogName(id){return state.dogs.find(x=>x.id===id)?.name||'Unknown dog'}
function trialName(id){return state.trials.find(x=>x.id===id)?.name||'Unassigned trial'}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function markerType(id){return MARKER_TYPES.find(x=>x.id===id)||MARKER_TYPES[9]}
function obstacleType(id){return OBSTACLE_TYPES.find(x=>x.id===id)||OBSTACLE_TYPES[OBSTACLE_TYPES.length-1]}
function obstacleById(id){return obstacles.find(o=>o.id===id)||null}
function obstacleLabel(id){const o=obstacleById(id);return o?`#${o.number} ${obstacleType(o.type).name}`:'Unlinked'}
function formatVideoTime(sec){sec=Math.max(0,Number(sec)||0);const m=Math.floor(sec/60),s=sec-m*60;return `${m}:${s.toFixed(1).padStart(4,'0')}`}
function openVideoDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(VIDEO_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(VIDEO_STORE))db.createObjectStore(VIDEO_STORE,{keyPath:'runId'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function saveVideoBlob(runId,file){const db=await openVideoDB();return new Promise((resolve,reject)=>{const tx=db.transaction(VIDEO_STORE,'readwrite');tx.objectStore(VIDEO_STORE).put({runId,blob:file,name:file.name,type:file.type,size:file.size,updatedAt:new Date().toISOString()});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
async function getVideoBlob(runId){const db=await openVideoDB();return new Promise((resolve,reject)=>{const tx=db.transaction(VIDEO_STORE,'readonly');const req=tx.objectStore(VIDEO_STORE).get(runId);req.onsuccess=()=>{db.close();resolve(req.result||null)};req.onerror=()=>{db.close();reject(req.error)}})}
async function deleteVideoBlob(runId){if(!runId)return;const db=await openVideoDB();return new Promise((resolve,reject)=>{const tx=db.transaction(VIDEO_STORE,'readwrite');tx.objectStore(VIDEO_STORE).delete(runId);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
function openMapDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(MAP_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(MAP_STORE))db.createObjectStore(MAP_STORE,{keyPath:'runId'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function saveMapData(runId,data){if(!runId||!data)return;const db=await openMapDB();return new Promise((resolve,reject)=>{const tx=db.transaction(MAP_STORE,'readwrite');tx.objectStore(MAP_STORE).put({runId,data,updatedAt:new Date().toISOString()});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
async function getMapData(runId){if(!runId)return null;const db=await openMapDB();return new Promise((resolve,reject)=>{const tx=db.transaction(MAP_STORE,'readonly');const req=tx.objectStore(MAP_STORE).get(runId);req.onsuccess=()=>{db.close();resolve(req.result?.data||null)};req.onerror=()=>{db.close();reject(req.error)}})}
async function deleteMapData(runId){if(!runId)return;const db=await openMapDB();return new Promise((resolve,reject)=>{const tx=db.transaction(MAP_STORE,'readwrite');tx.objectStore(MAP_STORE).delete(runId);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
async function mapDataForRun(run){if(!run)return null;try{return (await getMapData(run.id))||run.mapData||null}catch(e){console.warn('Could not read saved course map',e);return run.mapData||null}}
async function migrateInlineMaps(){
  let changed=false;
  for(const run of state.runs){
    if(run.mapData){
      try{
        await saveMapData(run.id,run.mapData);
        run.hasMap=true;
        run.mapData=null;
        changed=true;
      }catch(e){console.warn('Course map migration deferred',e)}
    }
  }
  if(changed)persist();
}
function clearVideoObjectUrl(){if(currentVideoObjectUrl){URL.revokeObjectURL(currentVideoObjectUrl);currentVideoObjectUrl=null}}
function showVideoBlob(blob,meta={}){clearVideoObjectUrl();const v=$('runVideo');if(!blob){v.pause();v.removeAttribute('src');v.load();v.classList.add('hidden');$('videoPlaceholder').classList.remove('hidden');$('removeVideoBtn').classList.add('hidden');renderVideoMeta();return}currentVideoObjectUrl=URL.createObjectURL(blob);v.src=currentVideoObjectUrl;v.classList.remove('hidden');$('videoPlaceholder').classList.add('hidden');$('removeVideoBtn').classList.remove('hidden');renderVideoMeta(meta)}
function renderVideoMeta(meta=videoMeta){const box=$('videoMeta');if(!box)return;if(!meta){box.innerHTML='';$('videoSavedBadge').classList.add('hidden');return}const size=meta.size?` · ${(meta.size/1024/1024).toFixed(meta.size>20*1024*1024?0:1)} MB`:'';box.innerHTML=`<span class="badge">${esc(meta.name||'Run video')}${size}</span>${pendingVideoFile?'<span class="small muted">Will attach when you save the run.</span>':'<span class="small muted">Stored on this device.</span>'}`;$('videoSavedBadge').classList.toggle('hidden',!meta)}
async function loadRunVideo(runId,meta){pendingVideoFile=null;videoMeta=meta||null;clearVideoObjectUrl();if(!meta){showVideoBlob(null);return}try{const rec=await getVideoBlob(runId);if(rec?.blob){showVideoBlob(rec.blob,meta)}else{showVideoBlob(null);videoMeta=meta;renderVideoMeta(meta);$('videoPlaceholder').textContent='Video metadata exists, but the video file is not available in this browser.'}}catch{showVideoBlob(null);$('videoPlaceholder').textContent='This browser could not open the stored video.'}}
function resetVideoUI(){pendingVideoFile=null;videoMeta=null;videoNotes=[];clearVideoObjectUrl();const v=$('runVideo');if(v){v.pause();v.removeAttribute('src');v.load();v.classList.add('hidden')}$('videoPlaceholder').textContent='Add a run video to create timestamped obstacle notes.';$('videoPlaceholder').classList.remove('hidden');$('removeVideoBtn').classList.add('hidden');$('videoUpload').value='';renderVideoMeta();renderVideoNotes();refreshVideoObstacleSelect()}
function refreshVideoObstacleSelect(){const sel=$('videoNoteObstacle');if(!sel)return;const cur=sel.value;sel.innerHTML='<option value="">General run</option>'+[...obstacles].sort((a,b)=>a.number-b.number).map(o=>`<option value="${o.id}">#${o.number} · ${esc(obstacleType(o.type).name)}</option>`).join('');if(obstacles.some(o=>o.id===cur))sel.value=cur;else sel.value=''}
function renderVideoNotes(){const list=$('videoNoteList');if(!list)return;const notes=[...videoNotes].sort((a,b)=>a.time-b.time);if(!notes.length){list.innerHTML='<div class="empty">No timestamp notes yet.</div>';drawCanvas();renderRunTimeline();return}list.innerHTML=notes.map(n=>{const o=obstacleById(n.obstacleId);return `<div class="timeNote"><button class="timeButton" data-seek-note="${n.id}">▶ ${formatVideoTime(n.time)}</button><div class="timeNoteText"><div class="strong small">${o?`#${o.number} · ${esc(obstacleType(o.type).name)}`:'General run'}</div><div class="muted small">${esc(n.note||'No note')}</div></div><button class="btn danger mini" data-delete-video-note="${n.id}">×</button></div>`}).join('');drawCanvas();renderRunTimeline()}
function seekVideo(time){const v=$('runVideo');if(!v.src)return toast('This run has no available video on this device.');v.currentTime=Math.max(0,Number(time)||0);v.scrollIntoView({behavior:'smooth',block:'center'});v.play().catch(()=>{})}
function seekObstacleVideo(obstacleId){const note=[...videoNotes].filter(n=>n.obstacleId===obstacleId).sort((a,b)=>a.time-b.time)[0];if(!note)return toast('No video timestamp for that obstacle yet.');seekVideo(note.time)}

function firstVideoNoteForObstacle(obstacleId){return [...videoNotes].filter(n=>n.obstacleId===obstacleId).sort((a,b)=>a.time-b.time)[0]||null}
function activeTimelineObstacleId(time){const timed=[...videoNotes].filter(n=>n.obstacleId&&obstacles.some(o=>o.id===n.obstacleId)).sort((a,b)=>a.time-b.time);if(!timed.length)return null;let active=null;for(const n of timed){if(n.time<=time+.12)active=n;else break}return active?.obstacleId||null}
function renderRunTimeline(){
  const el=$('runTimeline'),general=$('timelineGeneral');if(!el||!general)return;
  const sorted=[...obstacles].sort((a,b)=>a.number-b.number);
  if(!sorted.length){el.innerHTML='<div class="empty" style="min-width:min(620px,85vw)">Number the course obstacles and the analysis strip will build itself here.</div>';general.innerHTML='';return}
  const currentTime=Number($('runVideo')?.currentTime)||0,activeId=activeTimelineObstacleId(currentTime);
  el.innerHTML=sorted.map(o=>{
    const t=obstacleType(o.type),plan=markers.filter(m=>m.layer==='plan'&&m.obstacleId===o.id),issues=markers.filter(m=>m.layer==='review'&&m.obstacleId===o.id),vn=firstVideoNoteForObstacle(o.id);
    const chips=[...plan.map(m=>`<span class="timelineCue" title="${esc(markerType(m.kind).name)}${m.label?' — '+esc(m.label):''}">${esc(markerType(m.kind).code)}</span>`),...issues.map(m=>`<span class="timelineIssue" title="${esc(m.label||'Review issue')}">×${m.label?' '+esc(m.label):''}</span>`)].join('');
    const note=[vn?.note,o.note].filter(Boolean)[0]||'';
    return `<button class="timelineStop ${vn?'hasTime':''} ${issues.length?'hasIssue':''} ${activeId===o.id?'active':''}" data-timeline-obstacle="${o.id}" title="${vn?'Jump to '+formatVideoTime(vn.time):'Obstacle '+o.number}"><div class="timelineTop"><div><span class="timelineNum">#${o.number}</span> <span class="timelineType">${esc(t.code)}</span></div>${vn?`<span class="timelineTime">▶ ${formatVideoTime(vn.time)}</span>`:''}</div><div class="timelineCues">${chips||'<span class="timelineEmpty">No linked cues/issues</span>'}</div>${note?`<div class="timelineNote">${esc(note)}</div>`:''}</button>`
  }).join('');
  const generalNotes=[...videoNotes].filter(n=>!n.obstacleId).sort((a,b)=>a.time-b.time);
  general.innerHTML=generalNotes.length?'<span class="small muted" style="align-self:center">General:</span>'+generalNotes.map(n=>`<button class="badge" data-timeline-general="${n.id}">▶ ${formatVideoTime(n.time)}${n.note?' · '+esc(n.note):''}</button>`).join(''):'';
}
function updateTimelinePlayhead(){
  const activeId=activeTimelineObstacleId(Number($('runVideo')?.currentTime)||0);let activeEl=null;
  document.querySelectorAll('[data-timeline-obstacle]').forEach(b=>{const yes=b.dataset.timelineObstacle===activeId;b.classList.toggle('active',yes);if(yes)activeEl=b});
  if(activeEl&&$('runVideo')&&!$('runVideo').paused){const vp=$('timelineViewport'),left=activeEl.offsetLeft-activeEl.parentElement.offsetLeft,right=left+activeEl.offsetWidth;if(left<vp.scrollLeft+12||right>vp.scrollLeft+vp.clientWidth-12)activeEl.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'})}
}


let mapExpanded=false;
function setMapExpanded(on){
  mapExpanded=!!on;
  const card=$('mapCard'), btn=$('mapExpandBtn');
  if(!card||!btn)return;
  card.classList.toggle('mapExpanded',mapExpanded);
  document.body.classList.toggle('mapExpandedOpen',mapExpanded);
  btn.textContent=mapExpanded?'↙ Back to run':'⛶ Full screen';
  btn.setAttribute('aria-pressed',String(mapExpanded));
  setTimeout(drawCanvas,30);
}
$('mapExpandBtn').addEventListener('click',()=>setMapExpanded(!mapExpanded));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mapExpanded)setMapExpanded(false)});
window.addEventListener('resize',()=>{if(mapExpanded)setTimeout(drawCanvas,20)});

function switchView(id){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view===id));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===id));showPlannerBottomNav(id==='planner');if(id==='planner'){updateRingsideSummary();setTimeout(drawCanvas,40)}else if(ringsideMode)setRingsideMode(false)}
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));

function renderAll(){renderDogs();renderTrials();renderSelectors();renderStats();renderHistory();renderMarkerList();renderObstacleList();renderPatternControls();renderPatternInsights();refreshVideoObstacleSelect();renderVideoNotes();renderRunTimeline()}
function renderDogs(){const el=$('dogList');if(!state.dogs.length){el.innerHTML='<div class="empty">Add your first agility dog.</div>';return}el.innerHTML=state.dogs.map(d=>`<div class="item row between"><div><div class="strong">${esc(d.name)}</div><div class="small muted">${esc([d.height,d.notes].filter(Boolean).join(' · '))}</div></div><button class="btn danger mini" data-delete-dog="${d.id}">Delete</button></div>`).join('')}
function deleteDog(id){if(!confirm('Delete this dog profile? Existing runs will remain.'))return;state.dogs=state.dogs.filter(x=>x.id!==id);queueCloudDelete('dog',id);persist()}
window.deleteDog=deleteDog;
function renderTrials(){const recent=[...state.trials].sort((a,b)=>(b.date||'').localeCompare(a.date||''));const html=recent.length?recent.map(t=>{const count=state.runs.filter(r=>r.trialId===t.id).length;return`<div class="item row between"><div><div class="strong">${esc(t.name)}</div><div class="small muted">${esc(t.org)} · ${fmtDate(t.date)}${t.venue?' · '+esc(t.venue):''}</div></div><div class="row"><span class="badge">${count} run${count===1?'':'s'}</span><button class="btn secondary mini" data-plan-trial="${t.id}">Open</button><button class="btn danger mini" data-delete-trial="${t.id}">Delete</button></div></div>`}).join(''):'<div class="empty">No trials yet. Create one and add a course.</div>';$('trialList').innerHTML=html;$('setupTrialList').innerHTML=html}
function planTrial(id){
  const saved=[...state.runs].filter(r=>r.trialId===id).sort((a,b)=>(b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||''));
  if(saved.length===1){editRun(saved[0].id);return}
  if(saved.length>1){
    $('historySearch').value=trialName(id);
    renderHistory();
    switchView('history');
    toast(`${saved.length} saved runs for this trial.`);
    return;
  }
  clearForm(false);
  $('courseTrial').value=id;
  switchView('planner');
}
window.planTrial=planTrial;
function deleteTrial(id){
  const trial=state.trials.find(t=>t.id===id);
  if(!trial)return;
  const count=state.runs.filter(r=>r.trialId===id).length;
  const msg=count
    ? `Delete "${trial.name}"?\n\n${count} saved run${count===1?'':'s'} will be kept in History and shown as Unassigned trial.`
    : `Delete "${trial.name}"?\n\nThis cannot be undone.`;
  if(!confirm(msg))return;
  state.trials=state.trials.filter(t=>t.id!==id);
  queueCloudDelete('trial',id);
  if($('courseTrial')?.value===id)$('courseTrial').value='';
  persist();
  toast('Trial deleted. Saved runs were kept.');
}
window.deleteTrial=deleteTrial;
function renderSelectors(){const dogVal=$('courseDog').value,trialVal=$('courseTrial').value;const dogOpts='<option value="">Choose dog…</option>'+state.dogs.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');const trialOpts='<option value="">Choose trial…</option>'+[...state.trials].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');$('courseDog').innerHTML=dogOpts;$('courseTrial').innerHTML=trialOpts;if(state.dogs.some(d=>d.id===dogVal))$('courseDog').value=dogVal;if(state.trials.some(t=>t.id===trialVal))$('courseTrial').value=trialVal}
function renderStats(){const n=state.runs.length,q=state.runs.filter(r=>r.result==='Q').length,clean=state.runs.filter(r=>Number(r.faults)===0&&r.result==='Q').length;$('statRuns').textContent=n;$('statQ').textContent=n?Math.round(q/n*100)+'%':'0%';$('statClean').textContent=clean}
function renderHistory(){
  const q=($('historySearch')?.value||'').toLowerCase();
  const rows=[...state.runs].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).filter(r=>{
    const obs=(r.obstacles||[]).map(o=>`#${o.number} ${obstacleType(o.type).name} ${o.note||''}`).join(' ');
    const cues=(r.markers||[]).map(m=>`${markerType(m.kind).name} ${m.label||''} ${m.obstacleId||''}`).join(' ');
    return [dogName(r.dogId),trialName(r.trialId),r.className,r.judge,r.worked,r.happened,r.trainNext,obs,cues].join(' ').toLowerCase().includes(q)
  });
  const el=$('historyList');if(!rows.length){el.innerHTML='<div class="empty">No matching runs yet.</div>';return}
  el.innerHTML=rows.map(r=>`<div class="item row between"><div class="row grow"><img class="courseThumb" data-run-thumb="${r.id}" src="${r.mapData||''}" alt="course map" onerror="this.style.visibility='hidden'"/><div><div class="row"><span class="strong">${esc(dogName(r.dogId))} — ${esc(r.className||'Course')}</span>${r.result?`<span class="badge ${r.result==='Q'?'q':'nq'}">${esc(r.result)}</span>`:''}</div><div class="small muted">${esc(trialName(r.trialId))}${r.time?' · '+r.time+'s':''}${r.faults!==''?' · '+r.faults+' faults':''}${(r.obstacles||[]).length?' · '+(r.obstacles||[]).length+' obstacles':''}${(r.markers||[]).length?' · '+(r.markers||[]).length+' markers':''}${r.video?' · video':''}${(r.videoNotes||[]).length?' · '+(r.videoNotes||[]).length+' timestamps':''}</div><div class="small" style="margin-top:5px">${esc(r.trainNext||r.happened||'')}</div></div></div><button class="btn secondary mini" data-edit-run="${r.id}">Open</button></div>`).join('');hydrateHistoryThumbnails()
}
async function hydrateHistoryThumbnails(){
  const imgs=[...document.querySelectorAll('[data-run-thumb]')];
  for(const img of imgs){
    const run=state.runs.find(r=>r.id===img.dataset.runThumb);
    if(!run)continue;
    const data=await mapDataForRun(run);
    if(data){img.src=data;img.style.visibility='visible'}else img.style.visibility='hidden';
  }
}
async function editRun(id){const r=state.runs.find(x=>x.id===id);if(!r)return;const savedMap=await mapDataForRun(r);currentRunId=id;$('courseDog').value=r.dogId||'';$('courseTrial').value=r.trialId||'';$('courseClass').value=r.className||'';$('courseRound').value=r.round||'';$('courseJudge').value=r.judge||'';$('runTime').value=r.time??'';$('runFaults').value=r.faults??'';$('runResult').value=r.result||'';$('runPlacement').value=r.placement||'';$('runSpeed').value=r.speed??'';$('runPoints').value=r.points??'';$('worked').value=r.worked||'';$('happened').value=r.happened||'';$('trainNext').value=r.trainNext||'';strokes=structuredClone(r.strokes||[]);markers=structuredClone(r.markers||[]);obstacles=structuredClone(r.obstacles||[]);videoNotes=structuredClone(r.videoNotes||[]);videoMeta=r.video?structuredClone(r.video):null;pendingVideoFile=null;normalizeAnnotations();actionHistory=[];selectedMarkerId=null;selectedObstacleId=null;linkTargetObstacleId=null;loadBackground(savedMap);setPhase('plan');renderMarkerList();renderObstacleList();refreshVideoObstacleSelect();renderVideoNotes();loadRunVideo(r.id,r.video||null);plannerDirty=false;plannerLocalSaved=true;plannerCloudState=cloudUser?'synced':'off';updatePlannerStatus();updateQuickResultButtons();resetMapView();switchView('planner')}
window.editRun=editRun;
document.addEventListener('click',e=>{
  const delDog=e.target.closest('[data-delete-dog]'); if(delDog){deleteDog(delDog.dataset.deleteDog);return}
  const plan=e.target.closest('[data-plan-trial]'); if(plan){planTrial(plan.dataset.planTrial);return}
  const delTrial=e.target.closest('[data-delete-trial]'); if(delTrial){deleteTrial(delTrial.dataset.deleteTrial);return}
  const edit=e.target.closest('[data-edit-run]'); if(edit){editRun(edit.dataset.editRun);return}
});

$('addDogBtn').addEventListener('click',()=>{const name=$('dogName').value.trim();if(!name)return toast('Add a dog name first.');state.dogs.push({id:uid(),name,height:$('dogHeight').value.trim(),notes:$('dogNotes').value.trim(),updatedAt:new Date().toISOString()});$('dogName').value=$('dogHeight').value=$('dogNotes').value='';persist();toast('Dog added.')});
$('addTrialBtn').addEventListener('click',()=>{const name=$('trialName').value.trim();if(!name)return toast('Give the trial a name.');state.trials.push({id:uid(),name,date:$('trialDate').value,org:$('trialOrg').value,venue:$('trialVenue').value.trim(),updatedAt:new Date().toISOString()});$('trialName').value=$('trialVenue').value='';$('trialDate').value='';persist();toast('Trial created.')});
$('newTrialBtn').addEventListener('click',()=>switchView('setup'));
$('historySearch').addEventListener('input',renderHistory);

// Course planning tools
const palette=$('markerPalette');
palette.innerHTML=MARKER_TYPES.filter(x=>x.id!=='issue').map(m=>`<button class="markerBtn" data-marker-kind="${m.id}"><span class="markerCode">${m.code}</span><span>${m.name}</span></button>`).join('');
$('editMarkerKind').innerHTML=MARKER_TYPES.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
const obstaclePalette=$('obstaclePalette');
obstaclePalette.innerHTML=OBSTACLE_TYPES.map(o=>`<button class="obstacleBtn" data-obstacle-type="${o.id}"><span class="obstacleCode">${o.code}</span><span>${o.name}</span></button>`).join('');
$('editObstacleType').innerHTML=OBSTACLE_TYPES.map(o=>`<option value="${o.id}">${o.name}</option>`).join('');

function setPhase(phase){
  currentPhase=phase;
  document.querySelectorAll('.phase').forEach(b=>b.classList.toggle('active',b.dataset.phase===phase));
  $('planTools').classList.toggle('hidden',phase!=='plan');
  $('reviewTools').classList.toggle('hidden',phase!=='review');
  setActiveTool(phase==='plan'?'planned':'actual');
}
document.querySelectorAll('.phase').forEach(b=>b.addEventListener('click',()=>setPhase(b.dataset.phase)));

function setActiveTool(tool, markerKind=null){
  if(tool==='marker' && selectedObstacleId) linkTargetObstacleId=selectedObstacleId;
  if(tool!=='marker' && tool!=='select') linkTargetObstacleId=null;
  activeTool=tool;activeMarkerKind=markerKind;activeObstacleType=null;selectedMarkerId=null;if(tool!=='marker')selectedObstacleId=null;hideMarkerEditor();hideObstacleEditor();
  document.querySelectorAll('.tool').forEach(x=>x.classList.toggle('active',x.dataset.tool===tool));
  document.querySelectorAll('.markerBtn').forEach(x=>x.classList.toggle('active',tool==='marker'&&x.dataset.markerKind===markerKind));
  document.querySelectorAll('.obstacleBtn').forEach(x=>x.classList.remove('active'));
  const labels={planned:'Drawing planned line',actual:'Drawing actual line',select:'Tap a marker to edit or drag it',erase:'Tap an annotation to erase it',issue:'Tap to place an issue marker',videojump:'Tap a numbered obstacle to jump to its video moment',marker:`Place ${markerType(markerKind).name}`,obstacle:'Place obstacle'};
  $('activeToolLabel').textContent=(tool==='marker'&&linkTargetObstacleId&&obstacleById(linkTargetObstacleId))?`${labels[tool]} → #${obstacleById(linkTargetObstacleId).number}`:(labels[tool]||'Ready');
  $('plannerWrap').classList.toggle('selecting',tool==='select');
  drawCanvas();
}
document.addEventListener('click',e=>{const tool=e.target.closest('.tool');if(tool)setActiveTool(tool.dataset.tool);const marker=e.target.closest('.markerBtn');if(marker)setActiveTool('marker',marker.dataset.markerKind);const ob=e.target.closest('.obstacleBtn');if(ob){setActiveTool('obstacle');activeObstacleType=ob.dataset.obstacleType;document.querySelectorAll('.obstacleBtn').forEach(x=>x.classList.toggle('active',x===ob));$('activeToolLabel').textContent=`Place ${obstacleType(activeObstacleType).name}`}});

const canvas=$('courseCanvas'),ctx=canvas.getContext('2d');
function normalizeAnnotations(){strokes=strokes.map(s=>({...s,id:s.id||uid()}));markers=markers.map(m=>({...m,id:m.id||uid(),kind:m.kind||'note',label:m.label||'',layer:m.layer||(m.kind==='issue'?'review':'plan'),obstacleId:m.obstacleId||null}));obstacles=obstacles.map((o,i)=>({...o,id:o.id||uid(),number:Number(o.number)||i+1,type:o.type||'other',note:o.note||''}))}
function loadBackground(data){bgImage=null;mapDataOriginal=data||null;$('canvasHint').classList.toggle('hidden',!!data);resetMapView();if(!data){canvas.width=1200;canvas.height=850;drawCanvas();return}const img=new Image();img.onload=()=>{bgImage=img;const ratio=img.width/img.height;canvas.width=1200;canvas.height=Math.round(1200/ratio);drawCanvas()};img.src=data}
function isPlanStroke(s){return s.tool==='planned'}
function isReviewStroke(s){return s.tool==='actual'}
function shouldShowLayer(layer){return layer==='plan'?$('showPlanLayer').checked:$('showReviewLayer').checked}
function drawCanvas(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#0b0d10';ctx.fillRect(0,0,canvas.width,canvas.height);if(bgImage)ctx.drawImage(bgImage,0,0,canvas.width,canvas.height);if($('showObstaclesLayer').checked){for(const o of obstacles)drawObstacle(o,o.id===selectedObstacleId)}for(const s of strokes){if((isPlanStroke(s)&&$('showPlanLayer').checked)||(isReviewStroke(s)&&$('showReviewLayer').checked))drawStroke(s)}for(const m of markers){if(shouldShowLayer(m.layer||'plan'))drawMarker(m,m.id===selectedMarkerId)}}
function drawStroke(s){ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=s.tool==='planned'?'#29b6f6':'#ffa726';ctx.lineWidth=7;ctx.globalAlpha=.92;ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.restore()}
function roundedRect(c,x,y,w,h,r){const rr=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+rr,y);c.arcTo(x+w,y,x+w,y+h,rr);c.arcTo(x+w,y+h,x,y+h,rr);c.arcTo(x,y+h,x,y,rr);c.arcTo(x,y,x+w,y,rr);c.closePath()}
function drawMarker(m,selected=false){const type=markerType(m.kind);const review=(m.layer==='review');const fill=review?'#ef6c6c':'#173a31';const stroke=selected?'#ffffff':(review?'#ffd1d1':'#9fd6c2');ctx.save();ctx.font='800 20px Inter, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=selected?5:3;ctx.fillStyle=fill;ctx.strokeStyle=stroke;ctx.beginPath();ctx.arc(m.x,m.y,25,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';const linked=obstacleById(m.obstacleId);ctx.fillText(linked?`${type.code}·${linked.number}`:type.code,m.x,m.y+1);if(m.label){ctx.font='700 17px Inter, sans-serif';const text=m.label.length>28?m.label.slice(0,27)+'…':m.label;const tw=Math.min(ctx.measureText(text).width+18,290);ctx.fillStyle='rgba(12,15,17,.9)';roundedRect(ctx,m.x-tw/2,m.y+32,tw,31,10);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.18)';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#f4f6f7';ctx.fillText(text,m.x,m.y+48)}ctx.restore()}
function drawObstacle(o,selected=false){
  const t=obstacleType(o.type);ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=selected?5:3;ctx.fillStyle='rgba(42,37,21,.9)';ctx.strokeStyle=selected?'#ffffff':'#e5cf78';ctx.beginPath();ctx.arc(o.x,o.y,23,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.font='850 20px Inter, sans-serif';ctx.fillText(String(o.number),o.x,o.y-2);ctx.font='800 10px Inter, sans-serif';ctx.fillStyle='#f1e3a3';ctx.fillText(t.code,o.x,o.y+17);const vn=videoNotes.find(n=>n.obstacleId===o.id);if(vn){ctx.fillStyle='#143340';ctx.strokeStyle='#9bd9ef';ctx.lineWidth=2;ctx.beginPath();ctx.arc(o.x+25,o.y-23,12,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.font='800 11px Inter, sans-serif';ctx.fillText('▶',o.x+26,o.y-22)}ctx.restore()
}
function obstacleNear(p,limit=38){for(let i=obstacles.length-1;i>=0;i--){const o=obstacles[i];if(Math.hypot(p.x-o.x,p.y-o.y)<=limit)return o}return null}
function nearestObstacle(p,limit=115){let best=null,bestD=Infinity;for(const o of obstacles){const d=Math.hypot(p.x-o.x,p.y-o.y);if(d<bestD&&d<=limit){best=o;bestD=d}}return best}
function nextObstacleNumber(){return obstacles.length?Math.max(...obstacles.map(o=>Number(o.number)||0))+1:1}
function addObstacle(type,p){markPlannerDirty();const o={id:uid(),number:nextObstacleNumber(),type:type||'other',note:'',x:p.x,y:p.y};obstacles.push(o);actionHistory.push({type:'obstacle',id:o.id});selectedObstacleId=o.id;renderObstacleList();refreshObstacleSelect();showObstacleEditor(o);drawCanvas();return o}
function pointFromEvent(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}}
function markerNear(p,limit=42){for(let i=markers.length-1;i>=0;i--){const m=markers[i];if(!shouldShowLayer(m.layer||'plan'))continue;if(Math.hypot(p.x-m.x,p.y-m.y)<=limit)return m}return null}
function strokeNear(p,limit=32){for(let i=strokes.length-1;i>=0;i--){const s=strokes[i];if(isPlanStroke(s)&&!$('showPlanLayer').checked)continue;if(isReviewStroke(s)&&!$('showReviewLayer').checked)continue;for(const q of s.points){if(Math.hypot(p.x-q.x,p.y-q.y)<limit)return s}}return null}
function addMarker(kind,p,layer){markPlannerDirty();const near=nearestObstacle(p);const target=obstacleById(linkTargetObstacleId);const m={id:uid(),kind,label:'',x:p.x,y:p.y,layer,obstacleId:target?.id||near?.id||null};markers.push(m);actionHistory.push({type:'marker',id:m.id});selectedMarkerId=m.id;renderMarkerList();showMarkerEditor(m);drawCanvas();return m}

canvas.addEventListener('pointerdown',e=>{
  if(!bgImage)return;
  if(mapNavMode){
    canvas.setPointerCapture(e.pointerId);
    mapGesturePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(mapGesturePointers.size===1){
      mapGestureStart={panX:mapPanX,panY:mapPanY,start:[...mapGesturePointers.values()][0]};
    }else if(mapGesturePointers.size===2){
      const pts=[...mapGesturePointers.values()];
      mapGestureStart={panX:mapPanX,panY:mapPanY,zoom:mapZoom,dist:Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y),mid:{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2}};
    }
    return;
  }
  const p=pointFromEvent(e);
  if(activeTool==='obstacle'){addObstacle(activeObstacleType,p);return}
  if(activeTool==='marker'){addMarker(activeMarkerKind,p,'plan');return}
  if(activeTool==='issue'){const m=addMarker('issue',p,'review');m.label='';showMarkerEditor(m);return}
  if(activeTool==='videojump'){const o=obstacleNear(p,46);if(!o)return toast('Tap a numbered obstacle.');seekObstacleVideo(o.id);return}
  if(activeTool==='select'){
    const m=markerNear(p);const o=obstacleNear(p);
    if(m){selectedObstacleId=null;hideObstacleEditor();selectedMarkerId=m.id;draggingMarker=true;dragOffset={x:p.x-m.x,y:p.y-m.y};canvas.setPointerCapture(e.pointerId);showMarkerEditor(m);renderMarkerList();renderObstacleList();drawCanvas()}
    else if(o){selectedMarkerId=null;hideMarkerEditor();selectedObstacleId=o.id;linkTargetObstacleId=o.id;draggingObstacle=true;dragOffset={x:p.x-o.x,y:p.y-o.y};canvas.setPointerCapture(e.pointerId);showObstacleEditor(o);renderMarkerList();renderObstacleList();drawCanvas()}
    else{selectedMarkerId=null;selectedObstacleId=null;hideMarkerEditor();hideObstacleEditor();renderMarkerList();renderObstacleList();drawCanvas()}
    return;
  }
  if(activeTool==='erase'){
    const m=markerNear(p);if(m){markers=markers.filter(x=>x.id!==m.id);selectedMarkerId=null;renderMarkerList();hideMarkerEditor();drawCanvas();return}
    const o=obstacleNear(p);if(o){deleteObstacleById(o.id);drawCanvas();return}
    const s=strokeNear(p);if(s){strokes=strokes.filter(x=>x.id!==s.id);drawCanvas()}return;
  }
  if(activeTool!=='planned'&&activeTool!=='actual')return;
  canvas.setPointerCapture(e.pointerId);drawing=true;currentStroke={id:uid(),tool:activeTool,points:[p]};
});
canvas.addEventListener('pointermove',e=>{
  if(mapNavMode&&mapGesturePointers.has(e.pointerId)){
    mapGesturePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const pts=[...mapGesturePointers.values()];
    if(pts.length===1&&mapGestureStart?.start){
      mapPanX=mapGestureStart.panX+(pts[0].x-mapGestureStart.start.x);
      mapPanY=mapGestureStart.panY+(pts[0].y-mapGestureStart.start.y);
    }else if(pts.length===2&&mapGestureStart?.dist){
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      const next=Math.max(1,Math.min(4,mapGestureStart.zoom*(dist/mapGestureStart.dist)));
      const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
      mapPanX=mapGestureStart.panX+(mid.x-mapGestureStart.mid.x);
      mapPanY=mapGestureStart.panY+(mid.y-mapGestureStart.mid.y);
      mapZoom=next;
    }
    applyMapTransform();return;
  }
  const p=pointFromEvent(e);
  if(draggingMarker&&selectedMarkerId){const m=markers.find(x=>x.id===selectedMarkerId);if(m){m.x=Math.max(25,Math.min(canvas.width-25,p.x-dragOffset.x));m.y=Math.max(25,Math.min(canvas.height-25,p.y-dragOffset.y));drawCanvas()}return}
  if(draggingObstacle&&selectedObstacleId){const o=obstacles.find(x=>x.id===selectedObstacleId);if(o){o.x=Math.max(25,Math.min(canvas.width-25,p.x-dragOffset.x));o.y=Math.max(25,Math.min(canvas.height-25,p.y-dragOffset.y));drawCanvas()}return}
  if(!drawing||!currentStroke)return;currentStroke.points.push(p);drawCanvas();drawStroke(currentStroke)
});
function finishPointer(e){if(mapNavMode){if(e?.pointerId!=null)mapGesturePointers.delete(e.pointerId);if(mapGesturePointers.size===1){const p=[...mapGesturePointers.values()][0];mapGestureStart={panX:mapPanX,panY:mapPanY,start:p}}else if(mapGesturePointers.size===0)mapGestureStart=null;return}if(draggingMarker){draggingMarker=false;markPlannerDirty();return}if(draggingObstacle){draggingObstacle=false;markPlannerDirty();return}if(drawing&&currentStroke&&currentStroke.points.length){strokes.push(currentStroke);actionHistory.push({type:'stroke',id:currentStroke.id});markPlannerDirty()}drawing=false;currentStroke=null;drawCanvas()}
canvas.addEventListener('pointerup',finishPointer);canvas.addEventListener('pointercancel',finishPointer);

$('showObstaclesLayer').addEventListener('change',drawCanvas);$('showPlanLayer').addEventListener('change',drawCanvas);$('showReviewLayer').addEventListener('change',drawCanvas);
$('undoBtn').addEventListener('click',()=>{const a=actionHistory.pop();if(!a){if(markers.length){markers.pop();renderMarkerList();drawCanvas();return}if(strokes.length){strokes.pop();drawCanvas();return}return}if(a.type==='marker')markers=markers.filter(m=>m.id!==a.id);else if(a.type==='obstacle')deleteObstacleById(a.id);else strokes=strokes.filter(s=>s.id!==a.id);if(selectedMarkerId===a.id){selectedMarkerId=null;hideMarkerEditor()}renderMarkerList();renderObstacleList();drawCanvas()});
$('clearAnnotationsBtn').addEventListener('click',()=>{if(confirm('Clear all obstacles, planned lines, review lines, and markers?')){strokes=[];markers=[];obstacles=[];actionHistory=[];selectedMarkerId=null;selectedObstacleId=null;linkTargetObstacleId=null;hideMarkerEditor();hideObstacleEditor();renderMarkerList();renderObstacleList();refreshObstacleSelect();drawCanvas()}});
$('mapUpload').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{loadBackground(rd.result);markPlannerDirty()};rd.readAsDataURL(f)});
$('mapNavBtn')?.addEventListener('click',()=>setMapNavMode(!mapNavMode));
$('mapResetBtn')?.addEventListener('click',resetMapView);

function renderMarkerList(){const list=$('markerList'),wrap=$('markerListWrap');if(!markers.length){wrap.classList.add('hidden');list.innerHTML='';renderRunTimeline();return}wrap.classList.remove('hidden');list.innerHTML=markers.map(m=>{const t=markerType(m.kind);const o=obstacleById(m.obstacleId);return`<div class="markerItem ${m.id===selectedMarkerId?'selected':''}" data-marker-id="${m.id}"><span class="markerCode">${t.code}</span><div class="markerItemText"><div class="strong small">${esc(t.name)}${o?`<span class="linkedBadge">#${o.number} ${esc(obstacleType(o.type).code)}</span>`:''}</div><div class="muted small">${esc(m.label||'No note')}</div></div><button data-edit-marker="${m.id}">Edit</button></div>`}).join('');renderRunTimeline()}
document.addEventListener('click',e=>{const b=e.target.closest('[data-edit-marker]');if(!b)return;const m=markers.find(x=>x.id===b.dataset.editMarker);if(!m)return;selectedObstacleId=null;hideObstacleEditor();selectedMarkerId=m.id;showMarkerEditor(m);setActiveToolKeepSelection('select');renderMarkerList();renderObstacleList();drawCanvas()});
function setActiveToolKeepSelection(tool){activeTool=tool;activeMarkerKind=null;document.querySelectorAll('.tool').forEach(x=>x.classList.toggle('active',x.dataset.tool===tool));document.querySelectorAll('.markerBtn').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.obstacleBtn').forEach(x=>x.classList.remove('active'));$('activeToolLabel').textContent='Tap a marker or obstacle to edit or drag it';$('plannerWrap').classList.toggle('selecting',tool==='select')}
function refreshObstacleSelect(){const sel=$('editMarkerObstacle');if(!sel)return;const cur=sel.value;sel.innerHTML='<option value="">— Unlinked —</option>'+[...obstacles].sort((a,b)=>a.number-b.number).map(o=>`<option value="${o.id}">#${o.number} · ${esc(obstacleType(o.type).name)}</option>`).join('');if(obstacles.some(o=>o.id===cur))sel.value=cur;refreshVideoObstacleSelect()}
function showMarkerEditor(m){selectedMarkerId=m.id;refreshObstacleSelect();$('markerEditor').classList.remove('hidden');$('editMarkerKind').value=m.kind;$('editMarkerObstacle').value=m.obstacleId||'';$('editMarkerLabel').value=m.label||''}
function hideMarkerEditor(){$('markerEditor').classList.add('hidden')}
$('closeMarkerEditor').addEventListener('click',()=>{selectedMarkerId=null;hideMarkerEditor();renderMarkerList();drawCanvas()});
$('saveMarkerBtn').addEventListener('click',()=>{const m=markers.find(x=>x.id===selectedMarkerId);if(!m)return;m.kind=$('editMarkerKind').value;m.obstacleId=$('editMarkerObstacle').value||null;m.label=$('editMarkerLabel').value.trim();m.layer=m.kind==='issue'?'review':m.layer;renderMarkerList();drawCanvas();toast('Marker updated.')});
$('deleteMarkerBtn').addEventListener('click',()=>{if(!selectedMarkerId)return;markers=markers.filter(x=>x.id!==selectedMarkerId);selectedMarkerId=null;hideMarkerEditor();renderMarkerList();drawCanvas();toast('Marker deleted.')});

function renderObstacleList(){const list=$('obstacleList'),wrap=$('obstacleListWrap');if(!obstacles.length){wrap.classList.add('hidden');list.innerHTML='';refreshObstacleSelect();refreshVideoObstacleSelect();renderRunTimeline();return}wrap.classList.remove('hidden');list.innerHTML=[...obstacles].sort((a,b)=>a.number-b.number).map(o=>{const t=obstacleType(o.type);const cueCount=markers.filter(m=>m.obstacleId===o.id).length;const vn=[...videoNotes].filter(n=>n.obstacleId===o.id).sort((a,b)=>a.time-b.time)[0];return`<div class="markerItem ${o.id===selectedObstacleId?'selected':''}"><span class="obstacleCode">${o.number}</span><div class="markerItemText"><div class="strong small">${esc(t.name)}${cueCount?`<span class="linkedBadge">${cueCount} cue${cueCount===1?'':'s'}</span>`:''}${vn?`<span class="videoLinked">▶ ${formatVideoTime(vn.time)}</span>`:''}</div><div class="muted small">${esc(o.note||t.code)}</div></div>${vn?`<button data-seek-obstacle="${o.id}">Video</button>`:''}<button data-edit-obstacle="${o.id}">Edit</button></div>`}).join('');refreshObstacleSelect();refreshVideoObstacleSelect();renderRunTimeline()}
function showObstacleEditor(o){selectedObstacleId=o.id;$('obstacleEditor').classList.remove('hidden');$('editObstacleNumber').value=o.number;$('editObstacleType').value=o.type;$('editObstacleNote').value=o.note||''}
function hideObstacleEditor(){$('obstacleEditor').classList.add('hidden')}
function deleteObstacleById(id){obstacles=obstacles.filter(o=>o.id!==id);markers.forEach(m=>{if(m.obstacleId===id)m.obstacleId=null});videoNotes.forEach(n=>{if(n.obstacleId===id)n.obstacleId=null});if(selectedObstacleId===id){selectedObstacleId=null;hideObstacleEditor()}if(linkTargetObstacleId===id)linkTargetObstacleId=null;refreshObstacleSelect();renderMarkerList();renderObstacleList()}
document.addEventListener('click',e=>{const b=e.target.closest('[data-edit-obstacle]');if(!b)return;const o=obstacles.find(x=>x.id===b.dataset.editObstacle);if(!o)return;selectedMarkerId=null;hideMarkerEditor();selectedObstacleId=o.id;linkTargetObstacleId=o.id;showObstacleEditor(o);setActiveToolKeepSelection('select');renderMarkerList();renderObstacleList();drawCanvas()});
$('closeObstacleEditor').addEventListener('click',()=>{selectedObstacleId=null;hideObstacleEditor();renderObstacleList();drawCanvas()});
$('saveObstacleBtn').addEventListener('click',()=>{const o=obstacles.find(x=>x.id===selectedObstacleId);if(!o)return;const n=Math.max(1,Number($('editObstacleNumber').value)||1);o.number=n;o.type=$('editObstacleType').value;o.note=$('editObstacleNote').value.trim();renderObstacleList();renderMarkerList();refreshObstacleSelect();drawCanvas();toast('Obstacle updated.')});
$('deleteObstacleBtn').addEventListener('click',()=>{if(!selectedObstacleId)return;deleteObstacleById(selectedObstacleId);drawCanvas();toast('Obstacle deleted.')});

function clearForm(keepTrial=false){currentRunId=null;plannerDirty=false;plannerLocalSaved=false;plannerCloudState=cloudUser?'pending':'off';updatePlannerStatus();resetMapView();const keep=$('courseTrial').value;['courseClass','courseRound','courseJudge','runTime','runFaults','runPlacement','runSpeed','runPoints','worked','happened','trainNext'].forEach(id=>$(id).value='');$('runResult').value='';$('mapUpload').value='';strokes=[];markers=[];obstacles=[];actionHistory=[];selectedMarkerId=null;selectedObstacleId=null;linkTargetObstacleId=null;hideMarkerEditor();hideObstacleEditor();resetVideoUI();renderMarkerList();renderObstacleList();refreshObstacleSelect();loadBackground(null);if(!keepTrial)$('courseTrial').value='';else $('courseTrial').value=keep;setPhase('plan')}
$('clearCourseBtn').addEventListener('click',()=>clearForm(false));
function currentMapData(){return mapDataOriginal||null}
$('saveCourseBtn').addEventListener('click',async()=>{if(!$('courseDog').value)return toast('Choose a dog.');if(!$('courseTrial').value)return toast('Choose a trial.');if(!$('courseClass').value.trim())return toast('Add the class name.');const existing=currentRunId?state.runs.find(x=>x.id===currentRunId):null;const runId=currentRunId||uid();const mapData=currentMapData();if(mapData){try{await saveMapData(runId,mapData)}catch(e){console.error(e);return toast('Could not store the course map on this device.')}}if(pendingVideoFile){try{await saveVideoBlob(runId,pendingVideoFile);videoMeta={name:pendingVideoFile.name,type:pendingVideoFile.type,size:pendingVideoFile.size};pendingVideoFile=null;renderVideoMeta()}catch(e){console.error(e);return toast('Could not store the video on this device.')}}const r={id:runId,createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),dogId:$('courseDog').value,trialId:$('courseTrial').value,className:$('courseClass').value.trim(),round:$('courseRound').value.trim(),judge:$('courseJudge').value.trim(),mapData:null,hasMap:!!mapData||!!existing?.hasMap||!!existing?.mapData,strokes:structuredClone(strokes),markers:structuredClone(markers),obstacles:structuredClone(obstacles),video:videoMeta?structuredClone(videoMeta):null,videoNotes:structuredClone(videoNotes),time:$('runTime').value,faults:$('runFaults').value,result:$('runResult').value,placement:$('runPlacement').value.trim(),speed:$('runSpeed').value,points:$('runPoints').value,worked:$('worked').value.trim(),happened:$('happened').value.trim(),trainNext:$('trainNext').value.trim()};const idx=state.runs.findIndex(x=>x.id===r.id);if(idx>=0)state.runs[idx]=r;else state.runs.push(r);currentRunId=r.id;if(!persist())return;markPlannerSaved();updateQuickResultButtons();toast('Run + course map saved.')} );
$('duplicateBtn').addEventListener('click',()=>{currentRunId=null;markPlannerDirty();$('courseRound').value='';$('runTime').value=$('runFaults').value=$('runPlacement').value=$('runSpeed').value=$('runPoints').value='';$('runResult').value='';$('worked').value=$('happened').value=$('trainNext').value='';strokes=strokes.filter(s=>s.tool==='planned');markers=markers.filter(m=>m.layer==='plan');videoNotes=[];videoMeta=null;pendingVideoFile=null;clearVideoObjectUrl();$('videoUpload').value='';showVideoBlob(null);$('videoPlaceholder').textContent='Add a run video to create timestamped obstacle notes.';actionHistory=[];selectedMarkerId=null;selectedObstacleId=null;linkTargetObstacleId=null;hideMarkerEditor();hideObstacleEditor();renderVideoNotes();renderMarkerList();renderObstacleList();refreshObstacleSelect();setPhase('plan');drawCanvas();toast('Duplicated — plan kept, review and video cleared.')});


$('videoUpload').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;markPlannerDirty();pendingVideoFile=f;videoMeta={name:f.name,type:f.type,size:f.size};showVideoBlob(f,videoMeta);$('videoPlaceholder').textContent='Add a run video to create timestamped obstacle notes.';toast('Video ready — save the run to attach it.')});
$('runVideo').addEventListener('loadedmetadata',()=>renderVideoMeta());
$('markVideoTimeBtn').addEventListener('click',()=>{const v=$('runVideo');if(!v.src)return toast('Add a run video first.');const obstacleId=$('videoNoteObstacle').value||null;const note=$('videoNoteText').value.trim();if(!obstacleId&&!note)return toast('Choose an obstacle or add a note.');videoNotes.push({id:uid(),time:Number(v.currentTime)||0,obstacleId,note});markPlannerDirty();$('videoNoteText').value='';renderVideoNotes();renderObstacleList();toast(`Marked ${formatVideoTime(v.currentTime)}.`)});
document.addEventListener('click',e=>{const seek=e.target.closest('[data-seek-note]');if(seek){const n=videoNotes.find(x=>x.id===seek.dataset.seekNote);if(n)seekVideo(n.time);return}const del=e.target.closest('[data-delete-video-note]');if(del){videoNotes=videoNotes.filter(x=>x.id!==del.dataset.deleteVideoNote);renderVideoNotes();renderObstacleList();return}const ob=e.target.closest('[data-seek-obstacle]');if(ob){seekObstacleVideo(ob.dataset.seekObstacle);return}});
document.addEventListener('click',e=>{const stop=e.target.closest('[data-timeline-obstacle]');if(stop){const id=stop.dataset.timelineObstacle;const note=firstVideoNoteForObstacle(id);$('videoNoteObstacle').value=id;if(note)seekVideo(note.time);else toast('No video timestamp for this obstacle yet.');return}const gen=e.target.closest('[data-timeline-general]');if(gen){const n=videoNotes.find(x=>x.id===gen.dataset.timelineGeneral);if(n)seekVideo(n.time)}});
$('runVideo').addEventListener('timeupdate',updateTimelinePlayhead);
$('runVideo').addEventListener('seeked',updateTimelinePlayhead);
$('removeVideoBtn').addEventListener('click',async()=>{if(!confirm('Remove this run video from Runline on this device? Timestamp notes will stay unless you delete them.'))return;if(currentRunId){try{await deleteVideoBlob(currentRunId)}catch(e){console.error(e)}}pendingVideoFile=null;videoMeta=null;clearVideoObjectUrl();showVideoBlob(null);$('videoUpload').value='';const r=currentRunId?state.runs.find(x=>x.id===currentRunId):null;if(r){r.video=null;persist()}toast('Video removed. Timestamp notes kept.')});

function renderPatternControls(){
  const os=$('patternObstacle'),hs=$('patternHandling');if(!os||!hs)return;const ov=os.value,hv=hs.value;
  os.innerHTML='<option value="">Any obstacle</option>'+OBSTACLE_TYPES.map(o=>`<option value="${o.id}">${o.name}</option>`).join('');
  hs.innerHTML='<option value="">Any handling cue</option>'+MARKER_TYPES.filter(m=>!['issue','note'].includes(m.id)).map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  os.value=ov;hs.value=hv;
}
function matchingPatternRuns(){const ot=$('patternObstacle')?.value||'',hk=$('patternHandling')?.value||'';return state.runs.filter(r=>{const obs=r.obstacles||[],marks=r.markers||[];if(!ot&&!hk)return false;return marks.some(m=>{if(m.layer!=='plan')return false;if(hk&&m.kind!==hk)return false;const o=obs.find(x=>x.id===m.obstacleId);if(ot&&(!o||o.type!==ot))return false;return true})})}
function renderPatternInsights(){const box=$('patternInsights'),list=$('patternRuns');if(!box||!list)return;const runs=matchingPatternRuns();const ot=$('patternObstacle')?.value||'',hk=$('patternHandling')?.value||'';const active=ot||hk;if(!active){box.innerHTML='<div class="empty" style="grid-column:1/-1">Choose an obstacle type, a handling cue, or both to inspect your history.</div>';list.innerHTML='';return}const q=runs.filter(r=>r.result==='Q').length;const issueRuns=runs.filter(r=>{const obs=r.obstacles||[],marks=r.markers||[];const matchedIds=new Set(marks.filter(m=>m.layer==='plan'&&(!hk||m.kind===hk)).map(m=>m.obstacleId).filter(id=>{if(!id)return !ot;const o=obs.find(x=>x.id===id);return !ot||(o&&o.type===ot)}));return marks.some(m=>m.layer==='review'&&m.kind==='issue'&&(matchedIds.size===0||matchedIds.has(m.obstacleId))) }).length;box.innerHTML=`<div class="insight"><div class="value">${runs.length}</div><div class="label">matching runs</div></div><div class="insight"><div class="value">${runs.length?Math.round(q/runs.length*100):0}%</div><div class="label">Q rate</div></div><div class="insight"><div class="value">${issueRuns}</div><div class="label">issues at matched obstacle</div></div>`;list.innerHTML=runs.length?runs.slice(0,8).map(r=>`<div class="item row between"><div><div class="strong">${esc(dogName(r.dogId))} — ${esc(r.className||'Course')}</div><div class="small muted">${esc(trialName(r.trialId))}${r.result?' · '+esc(r.result):''}${r.time?' · '+r.time+'s':''}</div></div><button class="btn secondary mini" data-edit-run="${r.id}">Open</button></div>`).join(''):'<div class="empty">No runs match this combination yet.</div>'}
$('patternObstacle').addEventListener('change',renderPatternInsights);$('patternHandling').addEventListener('change',renderPatternInsights);

async function buildBackupFile(){
  const backup=structuredClone(state);
  for(const run of backup.runs){
    const live=state.runs.find(r=>r.id===run.id);
    run.mapData=await mapDataForRun(live);
  }
  const stamp=new Date().toISOString().slice(0,10);
  return new File([JSON.stringify(backup,null,2)],`runline-backup-${stamp}.json`,{type:'application/json'});
}
async function exportBackup(){
  try{
    const file=await buildBackupFile();
    const a=document.createElement('a');
    a.href=URL.createObjectURL(file);
    a.download=file.name;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup exported with course maps.');
  }catch(e){console.error(e);toast('Could not create backup.')}
}
async function shareBackup(){
  try{
    const file=await buildBackupFile();
    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
      await navigator.share({title:'Runline backup',text:'Runline agility data backup',files:[file]});
      return;
    }
    const a=document.createElement('a');
    a.href=URL.createObjectURL(file);
    a.download=file.name;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Share is not available here — backup downloaded instead.');
  }catch(e){
    if(e?.name!=='AbortError'){console.error(e);toast('Could not share backup.')}
  }
}
$('exportBtn').addEventListener('click',exportBackup);
$('shareBackupBtn').addEventListener('click',shareBackup);
$('shareBackupSetupBtn').addEventListener('click',shareBackup);
$('importBtn').addEventListener('click',()=>{const f=$('importFile').files?.[0];if(!f)return toast('Choose a backup file.');const rd=new FileReader();rd.onload=async()=>{try{const data=JSON.parse(rd.result);if(!data.dogs||!data.trials||!data.runs)throw Error();for(const run of data.runs){if(run.mapData){await saveMapData(run.id,run.mapData);run.hasMap=true;run.mapData=null}}state=data;if(!persist())return;toast('Backup restored.')}catch(e){console.error(e);toast('That backup file could not be restored.')}};rd.readAsText(f)});


// Runline Cloud — Supabase-backed, offline-first sync.
function cloudTable(type){return type==='dog'?'runline_dogs':type==='trial'?'runline_trials':'runline_runs'}
function isoTime(v){const t=Date.parse(v||'');return Number.isFinite(t)?t:0}
function setCloudUI(mode,msg=''){
  plannerCloudState=mode==='syncing'?'syncing':mode==='on'?(plannerDirty?'pending':'synced'):'off';updatePlannerStatus();
  const dot=$('cloudDot'),badge=$('cloudBadge'),out=$('cloudSignedOut'),inn=$('cloudSignedIn'),status=$('cloudStatusText');
  if(!dot||!badge)return;
  dot.classList.toggle('on',mode==='on');dot.classList.toggle('syncing',mode==='syncing');
  badge.textContent=mode==='syncing'?'Syncing…':mode==='on'?'Cloud on':'Local only';
  out?.classList.toggle('hidden',!!cloudUser);inn?.classList.toggle('hidden',!cloudUser);
  if(status&&msg)status.textContent=msg;
}
function queueCloudSync(){
  if(suppressCloudSync||!cloudUser||!navigator.onLine)return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer=setTimeout(()=>syncCloud(false),900);
}
function getCloudDeletes(){try{return JSON.parse(localStorage.getItem(CLOUD_DELETE_KEY)||'[]')}catch{return[]}}
function queueCloudDelete(type,id){
  const q=getCloudDeletes();
  if(!q.some(x=>x.type===type&&x.id===id))q.push({type,id});
  localStorage.setItem(CLOUD_DELETE_KEY,JSON.stringify(q));
}
async function flushCloudDeletes(){
  if(!cloudClient||!cloudUser)return;
  const q=getCloudDeletes(),keep=[];
  for(const item of q){
    try{
      const table=cloudTable(item.type);
      const {error}=await cloudClient.from(table).delete().eq('id',item.id);
      if(error)throw error;
      if(item.type==='run'){
        const path=`${cloudUser.id}/${item.id}/course-map`;
        await cloudClient.storage.from('course-maps').remove([path]);
      }
    }catch(e){console.warn('Cloud delete deferred',e);keep.push(item)}
  }
  localStorage.setItem(CLOUD_DELETE_KEY,JSON.stringify(keep));
}
function mergeCloudRows(localArr,rows){
  const byId=new Map(localArr.map(x=>[x.id,x]));
  let changed=false;
  for(const row of rows||[]){
    const remote={...(row.data||{}),id:row.id,updatedAt:row.updated_at};
    const local=byId.get(row.id);
    if(!local||isoTime(row.updated_at)>isoTime(local.updatedAt||local.createdAt)){
      if(local){Object.assign(local,remote)}else localArr.push(remote);
      changed=true;
    }
  }
  return changed;
}
async function upsertLocalRows(type,localArr,remoteRows){
  const table=cloudTable(type),remote=new Map((remoteRows||[]).map(r=>[r.id,r]));
  const payload=[];
  for(const item of localArr){
    const rr=remote.get(item.id);
    const localStamp=item.updatedAt||item.createdAt||'';
    if(!rr||isoTime(localStamp)>isoTime(rr.updated_at)){
      const stamp=localStamp||new Date().toISOString();
      item.updatedAt=stamp;
      const data=structuredClone(item);
      delete data.mapData;
      payload.push({id:item.id,user_id:cloudUser.id,data,updated_at:stamp});
    }
  }
  if(payload.length){
    const {error}=await cloudClient.from(table).upsert(payload,{onConflict:'id'});
    if(error)throw error;
  }
}
function dataUrlToBlob(dataUrl){return fetch(dataUrl).then(r=>r.blob())}
function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const rd=new FileReader();rd.onload=()=>resolve(rd.result);rd.onerror=()=>reject(rd.error);rd.readAsDataURL(blob)})}
async function syncRunMaps(remoteRows){
  const remote=new Map((remoteRows||[]).map(r=>[r.id,r]));
  for(const run of state.runs){
    const rr=remote.get(run.id);
    const localMap=await getMapData(run.id).catch(()=>null);
    const remotePath=rr?.map_path||null;
    const localNewer=!rr||isoTime(run.updatedAt||run.createdAt)>=isoTime(rr.updated_at);
    if(localMap&&(!remotePath||localNewer)){
      try{
        const blob=await dataUrlToBlob(localMap);
        const path=`${cloudUser.id}/${run.id}/course-map`;
        const {error:uploadError}=await cloudClient.storage.from('course-maps').upload(path,blob,{upsert:true,contentType:blob.type||'image/jpeg'});
        if(uploadError)throw uploadError;
        const {error:updateError}=await cloudClient.from('runline_runs').update({map_path:path}).eq('id',run.id);
        if(updateError)throw updateError;
      }catch(e){console.warn('Map upload deferred',e)}
    }else if(!localMap&&remotePath){
      try{
        const {data,error}=await cloudClient.storage.from('course-maps').download(remotePath);
        if(error)throw error;
        const dataUrl=await blobToDataUrl(data);
        await saveMapData(run.id,dataUrl);
        run.hasMap=true;
      }catch(e){console.warn('Map download deferred',e)}
    }
  }
}
async function syncCloud(showToast=true){
  if(!cloudClient||!cloudUser||cloudSyncing||!navigator.onLine)return;
  cloudSyncing=true;setCloudUI('syncing','Syncing your Runline library…');
  try{
    await flushCloudDeletes();
    const [dogs,trials,runs]=await Promise.all([
      cloudClient.from('runline_dogs').select('*'),
      cloudClient.from('runline_trials').select('*'),
      cloudClient.from('runline_runs').select('*')
    ]);
    if(dogs.error)throw dogs.error;if(trials.error)throw trials.error;if(runs.error)throw runs.error;

    suppressCloudSync=true;
    mergeCloudRows(state.dogs,dogs.data);
    mergeCloudRows(state.trials,trials.data);
    mergeCloudRows(state.runs,runs.data);
    suppressCloudSync=false;

    await upsertLocalRows('dog',state.dogs,dogs.data);
    await upsertLocalRows('trial',state.trials,trials.data);
    await upsertLocalRows('run',state.runs,runs.data);
    await syncRunMaps(runs.data);

    suppressCloudSync=true;persist();suppressCloudSync=false;
    const stamp=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    plannerCloudState='synced';updatePlannerStatus();setCloudUI('on',`Synced at ${stamp}. Videos stay on this device.`);
    if(showToast)toast('Runline cloud synced.');
  }catch(e){
    console.error('Cloud sync failed',e);
    setCloudUI('on','Cloud connected; sync will retry when available.');
    if(showToast)toast('Cloud sync could not finish.');
  }finally{cloudSyncing=false}
}
async function handleCloudSession(session){
  cloudUser=session?.user||null;
  if(cloudUser){
    setCloudUI('on',`Signed in as ${cloudUser.email||'Runline user'}.`);
    const signedInAt=Date.parse(cloudUser.last_sign_in_at||'');
    const recent=Number.isFinite(signedInAt)&&(Date.now()-signedInAt)<15*60*1000;
    $('cloudFirstPasswordWrap')?.classList.toggle('hidden',!recent);
    await syncCloud(false);
  }else setCloudUI('off','Sign in to sync between devices.');
}
function initCloud(){
  if(!window.supabase?.createClient){setCloudUI('off','Cloud library unavailable offline; local Runline still works.');return}
  cloudClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  cloudClient.auth.getSession().then(({data})=>handleCloudSession(data.session));
  cloudClient.auth.onAuthStateChange((_event,session)=>setTimeout(()=>handleCloudSession(session),0));
}
$('cloudPasswordSignInBtn')?.addEventListener('click',async()=>{
  const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;
  if(!email||!password)return toast('Enter your email and password.');
  if(!cloudClient)return toast('Cloud library is not available right now.');
  const {error}=await cloudClient.auth.signInWithPassword({email,password});
  if(error){console.error(error);toast(error.message||'Could not sign in.');return}
  $('cloudPassword').value='';
  toast('Signed in to Runline Cloud.');
});
$('cloudSetPasswordBtn')?.addEventListener('click',async()=>{
  if(!cloudUser)return toast('Sign in first.');
  const current=$('cloudCurrentPassword').value,newPassword=$('cloudNewPassword').value;
  if(!current)return toast('Enter your current password.');
  if(!newPassword||newPassword.length<12)return toast('Use at least 12 characters for the new password.');
  const email=cloudUser.email;
  if(!email)return toast('No email is attached to this account.');
  const {error:verifyError}=await cloudClient.auth.signInWithPassword({email,password:current});
  if(verifyError){console.error(verifyError);toast('Current password is incorrect.');return}
  const {error}=await cloudClient.auth.updateUser({password:newPassword});
  if(error){console.error(error);toast(error.message||'Could not change password.');return}
  $('cloudCurrentPassword').value='';$('cloudNewPassword').value='';
  toast('Cloud password changed.');
});
$('cloudFirstPasswordBtn')?.addEventListener('click',async()=>{
  if(!cloudUser)return toast('Sign in first.');
  const newPassword=$('cloudNewPassword').value;
  const signedInAt=Date.parse(cloudUser.last_sign_in_at||'');
  const recent=Number.isFinite(signedInAt)&&(Date.now()-signedInAt)<15*60*1000;
  if(!recent)return toast('First-password setup is only available right after sign-in.');
  if(!newPassword||newPassword.length<12)return toast('Use at least 12 characters.');
  const {error}=await cloudClient.auth.updateUser({password:newPassword});
  if(error){console.error(error);toast(error.message||'Could not set first password.');return}
  $('cloudNewPassword').value='';
  $('cloudFirstPasswordWrap')?.classList.add('hidden');
  toast('First cloud password set.');
});
$('cloudSignInBtn')?.addEventListener('click',async()=>{
  const email=$('cloudEmail').value.trim();
  if(!email)return toast('Enter your email address.');
  if(!cloudClient)return toast('Cloud library is not available right now.');
  const btn=$('cloudSignInBtn');
  btn.disabled=true;
  const redirectTo=location.origin+location.pathname;
  const {error}=await cloudClient.auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo,shouldCreateUser:false}});
  if(error){
    console.error(error);
    btn.disabled=false;
    if((error.message||'').toLowerCase().includes('rate')) return toast('Email limit reached — use password sign-in or try later.');
    toast(error.message||'Could not send sign-in link.');
    return;
  }
  toast('Sign-in link sent. Check your email.');
  let left=60;
  btn.textContent='Link sent · 60s';
  const timer=setInterval(()=>{left--;if(left<=0){clearInterval(timer);btn.disabled=false;btn.textContent='Send magic link'}else btn.textContent=`Link sent · ${left}s`;},1000);
});
$('cloudSignOutBtn')?.addEventListener('click',async()=>{if(cloudClient)await cloudClient.auth.signOut();cloudUser=null;setCloudUI('off','Signed out. Local data remains on this device.');});
$('cloudSyncBtn')?.addEventListener('click',()=>syncCloud(true));
window.addEventListener('online',()=>{toast('Back online.');queueCloudSync()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')queueCloudSync()});

// Collapsible planner panels: remember state per device/browser.
function initCollapsiblePanels(){
  const panels=[...document.querySelectorAll('#planner details[data-collapse-key]')];
  panels.forEach(panel=>{
    const key='runline-panel-'+panel.dataset.collapseKey;
    const saved=localStorage.getItem(key);
    if(saved!==null) panel.open=saved==='1';
    panel.addEventListener('toggle',()=>{
      localStorage.setItem(key,panel.open?'1':'0');
      updatePanelToggleLabel();
    });
  });
  updatePanelToggleLabel();
}
function updatePanelToggleLabel(){
  const btn=$('togglePanelsBtn');
  if(!btn)return;
  const panels=[...document.querySelectorAll('#planner details[data-collapse-key]')];
  btn.textContent=panels.some(p=>p.open)?'Collapse panels':'Expand panels';
}
$('togglePanelsBtn')?.addEventListener('click',()=>{
  const panels=[...document.querySelectorAll('#planner details[data-collapse-key]')];
  const open=!panels.some(p=>p.open);
  panels.forEach(p=>{p.open=open});
  updatePanelToggleLabel();
});

// PWA install + offline shell
let deferredInstallPrompt=null;
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
function renderInstallState(){
  const btn=$('installBtn'),status=$('installStatus'),badge=$('installBadge'),help=$('installHelp');
  if(!btn||!status)return;
  if(isStandalone()){
    status.textContent='Installed on this device.';badge.textContent='Installed';btn.textContent='Runline is installed';btn.disabled=true;help.textContent='Runline is opening in standalone app mode. Course plans and saved runs remain on this device.';return;
  }
  const isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(deferredInstallPrompt){status.textContent='Runline is ready to install.';btn.textContent='Install Runline';btn.disabled=false;help.textContent='Tap Install Runline and approve the browser prompt.';return;}
  if(isiOS){status.textContent='Ready for Home Screen installation in Safari.';btn.textContent='Show iPhone install steps';btn.disabled=false;help.textContent='Safari → Share → Add to Home Screen → Add. Runline will then open full-screen like an app.';return;}
  status.textContent='Open this hosted app in a supported browser to install it.';btn.textContent='Install instructions';btn.disabled=false;help.textContent='Use the browser menu and choose Install app / Add to Home Screen.';
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;renderInstallState()});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;renderInstallState();toast('Runline installed.')});
$('installBtn')?.addEventListener('click',async()=>{
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;renderInstallState();return;}
  const isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(isiOS)toast('Safari: Share → Add to Home Screen → Add');
  else toast('Browser menu → Install app / Add to Home Screen');
});
if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')){
  let swReloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(swReloading)return;
    swReloading=true;
    location.reload();
  });
  window.addEventListener('load',async()=>{
    try{
      const reg=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
      await reg.update();
    }catch(err){console.warn('Service worker registration failed',err)}
  });
}
$('ringsideBtn')?.addEventListener('click',()=>setRingsideMode(!ringsideMode));
$('runResult')?.addEventListener('change',()=>{updateQuickResultButtons();markPlannerDirty()});
document.querySelectorAll('[data-quick-result]').forEach(b=>b.addEventListener('click',()=>{$('runResult').value=b.dataset.quickResult;updateQuickResultButtons();markPlannerDirty();toast(b.dataset.quickResult+' selected.')}));
['courseDog','courseTrial','courseClass','courseRound','courseJudge','runTime','runFaults','runPlacement','runSpeed','runPoints','worked','happened','trainNext'].forEach(id=>$(id)?.addEventListener('input',()=>{markPlannerDirty();updateRingsideSummary()}));
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-planner-nav]');if(!b)return;
  const target=b.dataset.plannerNav;
  if(target==='map'){$('mapCard')?.scrollIntoView({behavior:'smooth',block:'start'});return}
  if(target==='plan'){$('courseToolsCard')?.scrollIntoView({behavior:'smooth',block:'start'});return}
  if(target==='video'){const d=$('videoReviewCard');if(d){d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'})}return}
  if(target==='result'){const d=$('runResultCard');if(d){d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'})}return}
  if(target==='save'){$('saveCourseBtn')?.click()}
});
window.addEventListener('offline',()=>{plannerCloudState=cloudUser?'pending':'off';updatePlannerStatus();toast('Offline mode — Runline still works.')});
renderInstallState();
initCloud();

initCollapsiblePanels();normalizeAnnotations();renderAll();refreshObstacleSelect();resetVideoUI();loadBackground(null);setPhase('plan');updatePlannerStatus();updateQuickResultButtons();migrateInlineMaps().catch(e=>console.warn('Map migration failed',e));
