/* ISC Campus Explorer — dependency-free front end; room content in data/rooms.js */
(() => {
  'use strict';
  const config = window.ISC_CONFIG || {};
  const rooms = Array.isArray(window.ISC_ROOMS) ? window.ISC_ROOMS : [];
  const $ = id => document.getElementById(id);
  const cats = [...new Set(rooms.map(r => r.category))].sort();
  let chosenId = null, chosenTab = 'overview', mapView = 'schematic';
  let zoom = 1, panX = 0, panY = 0, pointerStart = null, lastMove = false;
  let cachedPanoPromise = null, viewer = null;
  const search = $('searchInput'), zone = $('zoneSelect'), category = $('categorySelect');
  const stage = $('mapCanvas'), mapTransform = $('mapTransform'), svg = $('roomOverlay');
  const droneSvg = $('droneOverlay');
  if(config.schematicImage) document.querySelector('#schematicView .base-map').src = config.schematicImage;

  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isSafeLink = value => {
    try { const url = new URL(value, window.location.href); return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:'; } catch {return false;}
  };
  const safeLink = value => isSafeLink(value) ? h(value) : '#';
  const byId = id => rooms.find(r => r.id === id);
  const labelForZone = v => v === 'North campus' ? 'North of Koninginnelaan' : 'South of Koninginnelaan';
  function matching() {
    const q = search.value.trim().toLocaleLowerCase();
    return rooms.filter(r => (zone.value === 'all' || r.zone === zone.value)
      && (category.value === 'all' || r.category === category.value)
      && (!q || [r.name, r.category, r.zone, r.teacher, r.subject, r.description, Object.values(r.staffCourses||{}).join(' ')].join(' ').toLocaleLowerCase().includes(q)));
  }

  const hotspotReviewMode = new URLSearchParams(location.search).has('hotspots');
  function makeRegion(rect, id, aerial=false, polygon=null) {
    const isPolygon = Array.isArray(polygon) && polygon.length >= 3;
    const el = document.createElementNS('http://www.w3.org/2000/svg',isPolygon?'polygon':'rect');
    if(isPolygon) el.setAttribute('points', polygon.map(([x,y])=>x+','+y).join(' '));
    else {
      el.setAttribute('x',rect[0]); el.setAttribute('y',rect[1]);
      el.setAttribute('width',rect[2]);el.setAttribute('height',rect[3]);
      el.setAttribute('rx',aerial?'6':'0');
    }
    el.setAttribute('class','room-region');
    el.setAttribute('role','button'); el.setAttribute('tabindex','0');
    el.setAttribute('data-id',id);
    const r = byId(id);
    el.setAttribute('aria-label','Explore '+r.name+', '+r.category);
    const title = document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=r.name;el.appendChild(title);
    el.addEventListener('click', () => { if(!lastMove) selectRoom(id); });
    el.addEventListener('keydown', e => {
      if(e.key === 'Enter' || e.key === ' ') {e.preventDefault();selectRoom(id);}
    });
    return el;
  }
  for(const r of rooms){
    if(Array.isArray(r.rect) && r.rect.length===4) svg.appendChild(makeRegion(r.rect,r.id,false,r.polygon));
    if(Array.isArray(r.droneRect) && r.droneRect.length===4) droneSvg.appendChild(makeRegion(r.droneRect,r.id,true,r.dronePolygon));
  }
  // Add visible bounds only in the optional QA view (?hotspots=1). Not shown to visitors.
  if(hotspotReviewMode) {
    document.documentElement.classList.add('hotspots-review');
    rooms.filter(r=>r.rect).forEach((r,i)=>{
      const [x,y,w,h] = r.rect;
      const t=document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x',x+w/2); t.setAttribute('y',y+Math.min(17,h/2));
      t.setAttribute('text-anchor','middle'); t.setAttribute('class','hotspot-index');
      t.setAttribute('pointer-events','none'); t.textContent=String(rooms.indexOf(r)+1);
      svg.appendChild(t);
    });
  }
  $('uncalibrated').hidden = rooms.some(r=>Array.isArray(r.droneRect));

  for(const cat of cats){const o=document.createElement('option');o.value=cat;o.textContent=cat;category.appendChild(o);}
  $('heroYear').textContent = config.schoolYear || '2026–2027';
  const mappedCount=rooms.filter(r=>Array.isArray(r.rect)&&r.rect.length===4).length;
  $('heroCount').textContent = mappedCount + ' mapped spaces';
  $('totalSpaces').textContent = mappedCount;
  if(config.published || config.showAdminPreviewNotice === false) $('previewBanner').hidden = true;
  if(config.droneImage){ $('dronePhoto').src=config.droneImage; $('droneWaiting').hidden=true; $('droneLoaded').hidden=false; }

  function refresh() {
    const filtered = matching(), set = new Set(filtered.map(r => r.id));
    document.querySelectorAll('.room-region').forEach(el => {
      const id = el.dataset.id;
      el.classList.toggle('selected',id===chosenId);
      el.classList.toggle('filtered',set.has(id) && filtered.length!==rooms.length);
      el.classList.toggle('not-match',!set.has(id));
      el.setAttribute('aria-disabled',set.has(id)?'false':'true');
    });
    $('mapResultCount').textContent = filtered.length===rooms.length ? 'All '+rooms.length+' spaces' : filtered.length+' matching spaces';
    $('directoryCount').textContent=filtered.length+' '+(filtered.length===1?'space':'spaces')+' found';
    $('clearSearch').hidden=!search.value;
    const directory=$('directoryList');directory.replaceChildren();
    if(!filtered.length){directory.innerHTML='<p class="directory-empty">No matching spaces. Try a different search term or reset the filters.</p>';}
    else {
      const frag=document.createDocumentFragment();
      for(const r of filtered){
        const btn=document.createElement('button');btn.type='button';
        btn.className='directory-item'+(chosenId===r.id?' active':'');
        btn.innerHTML='<span class="dir-text"><b>'+h(r.name)+'</b><small>'+h(r.category)+' · '+h(r.zone)+'</small></span><span class="arrow" aria-hidden="true">→</span>';
        btn.setAttribute('aria-label','View '+r.name);
        btn.addEventListener('click',()=>selectRoom(r.id));
        frag.appendChild(btn);
      }
      directory.appendChild(frag);
    }
    document.querySelectorAll('.feature-item').forEach(el=>el.classList.toggle('selected',el.dataset.id===chosenId));
  }

  function iconFor(cat){
    const icon={'Science labs':'⌬','Arts & performance':'♫','Sports & recreation':'◎','Student support':'▤','Learning spaces':'◇','Shared spaces':'⌑','Middle & high classrooms':'▦','Elementary classroom':'▥','Offices':'▣'};
    return icon[cat] || '□';
  }
  function renderFeatured(){
    const slot = $('featuredItems');
    // Prioritize a representative mix of spaces
    const ids=['einstein-lab','legacy-theater','media-center','pe-court'];
    const items=ids.map(byId).filter(Boolean);
    slot.replaceChildren();
    items.forEach(r=>{
      const b=document.createElement('button'); b.className='feature-item';b.type='button';b.dataset.id=r.id;
      b.innerHTML='<span class="feature-ico" aria-hidden="true">'+iconFor(r.category)+'</span><span class="feature-name">'+h(r.name)+'</span>';
      b.addEventListener('click',()=>selectRoom(r.id));slot.appendChild(b);
    });
  }
  renderFeatured();

  function emptyState(ico,title,message){return '<div class="empty-content"><span class="empty-ico" aria-hidden="true">'+ico+'</span><h4>'+h(title)+'</h4><p>'+h(message)+'</p></div>';}
  function renderDetails() {
    const box=$('detailCard'), r=byId(chosenId);
    if(!r){box.innerHTML='<div class="empty-detail"><div class="empty-art"><svg viewBox="0 0 128 128" aria-hidden="true"><rect x="12" y="23" width="104" height="83" rx="5" fill="#eff5fb" stroke="#477ab9" stroke-width="2"/><path d="M12 50h104M48 23v83M81 50v56" fill="none" stroke="#477ab9" stroke-width="2"/><path d="M48 23h33v27H48z" fill="#d6e8f5"/><path d="M69 62l11 12 20-24" fill="none" stroke="#e84d64" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><span class="eyebrow dark">YOUR VIRTUAL VISIT STARTS HERE</span><h3>Select a space to explore</h3><p>Choose a classroom on the map or use the directory below to see photos, staff details and future 360° tours.</p></div>';return;}
    let content='';
    if(chosenTab==='overview'){
      content='<p>'+(r.description?h(r.description):'Explore the '+h(r.name)+' space at the International School of Curaçao. Additional details will be published as they are approved.')+'</p>'+
      '<div class="detail-meta"><div><label>Location</label><strong>'+h(labelForZone(r.zone))+'</strong></div><div><label>Type of space</label><strong>'+h(r.category)+'</strong></div>'+
      (r.staffCourses && Object.keys(r.staffCourses).length?'<div><label>Teacher subjects by grade</label>'+Object.entries(r.staffCourses).map(([grade,subjects])=>'<div class=\"course-pair\"><span>'+h(grade)+'</span><strong>'+h(subjects)+'</strong></div>').join('')+'</div>':'')+'</div>'+
      '<div class="action-links">'+(r.rect?'<button class="small-action" type="button" id="focusRoom">◎ Locate on map</button>':'<span class="location-pending">Exact location pending verification</span>')+
      (r.webUrl&&isSafeLink(r.webUrl)?'<a class="small-action" target="_blank" rel="noopener noreferrer" href="'+safeLink(r.webUrl)+'">Learn more ↗</a>':'')+'</div>';
    } else if(chosenTab==='teacher') {
      if(r.staffName && config.showStaffNames !== false){
        const ini=r.staffName.split(/\s+/).slice(0,2).map(x=>x[0]).join('');
        const photo=r.staffPhoto ? '<img class="staff-portrait" src="'+h(r.staffPhoto)+'" alt="Portrait of '+h(r.staffName)+'" loading="lazy">' : '<div class="staff-avatar">'+h(ini)+'</div>';
        const mail=r.staffEmail?'<a href="mailto:'+h(r.staffEmail)+'" class="staff-email">'+h(r.staffEmail)+'</a>':'';
        content='<div class="staff-row">'+photo+'<div><h4>'+h(r.staffName)+'</h4>'+mail+'<div class="email-note">'+(r.staffEmailVerified?'Address provided by staff member':'Email format generated from surname + first initial; verify before publishing')+'</div></div></div>';
        if(r.staffCourses && Object.keys(r.staffCourses).length){
          content+='<div class="staff-bio"><h4>Classes taught</h4>'+Object.entries(r.staffCourses).map(([level,subjects])=>'<div class="course-pair"><span>'+h(level)+'</span><strong>'+h(subjects)+'</strong></div>').join('')+'</div>';
        } else content+='<p class="staff-bio">No teaching subjects specified on the supplied roster for this role.</p>';
        if(r.teacherBio)content+='<div class="staff-bio"><h4>Biography</h4><p>'+h(r.teacherBio)+'</p></div>';
      } else content=emptyState('♙','Staff profile not assigned','This space does not yet have a confirmed staff assignment.');
    } else if(chosenTab==='photos'){
      if(r.photos && r.photos.length){
        content='<div class="photo-grid">'+r.photos.map((p,i)=>'<button data-photo="'+i+'" type="button" aria-label="Open '+h(r.name)+' image '+(i+1)+'"><img src="'+h(typeof p==='string'?p:p.src)+'" alt="'+h(typeof p==='string'?r.name:(p.alt||r.name))+'" loading="lazy"></button>').join('')+'</div>';
      } else content=emptyState('▧','Photos coming soon','Approved photos of this space will appear here.');
    } else if(chosenTab==='panorama'){
      if(r.panorama){content='<div class="pano-box" id="panoBox" aria-label="Interactive 360 degree panorama for '+h(r.name)+'"></div><p>Drag inside the panorama to look around. Full-screen mode is available.</p>';}
      else if(r.streetViewUrl && isSafeLink(r.streetViewUrl)) content='<div class="empty-content"><span class="empty-ico">360°</span><h4>Street View available</h4><p>Explore this location in Google Street View.</p><div class="action-links"><a target="_blank" rel="noopener noreferrer" class="small-action" href="'+safeLink(r.streetViewUrl)+'">Open Street View ↗</a></div></div>';
      else content=emptyState('360°','Virtual tour coming soon','A 360° panorama can be added for this classroom or facility when ISC supplies the imagery.');
    }
    box.innerHTML='<div class="detail-header"><div class="detail-header-top"><span class="detail-label">EXPLORE THIS SPACE</span><button class="close-detail" type="button" id="closeDetail" aria-label="Close room details">×</button></div><h3>'+h(r.name)+'</h3><div class="detail-location">'+h(r.category)+' &nbsp; · &nbsp; '+h(r.zone)+'</div></div>'+ 
      '<div class="detail-tabs" role="tablist" aria-label="Room information">'+[['overview','Overview'],['teacher','Staff'],['photos','Photos'],['panorama','360°']].map(([key,label])=>'<button type="button" role="tab" aria-selected="'+(key===chosenTab)+'" data-tab="'+key+'" class="'+(key===chosenTab?'active':'')+'">'+label+'</button>').join('')+'</div><div class="detail-content" role="tabpanel">'+content+'</div>';
    $('closeDetail').addEventListener('click',()=>selectRoom(null));
    box.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{chosenTab=b.dataset.tab;renderDetails();}));
    const focus=$('focusRoom');if(focus) focus.addEventListener('click',()=>focusOnRoom(r));
    if(chosenTab==='photos')box.querySelectorAll('[data-photo]').forEach(b=>b.addEventListener('click',()=>openPhoto(r,+b.dataset.photo)));
    if(chosenTab==='panorama' && r.panorama) mountPanorama(r.panorama);
  }
  function selectRoom(id,opts={}){
    if(id && !byId(id))return;
    if(viewer){try{viewer.destroy();}catch{} viewer=null;}
    chosenId=id;chosenTab='overview';renderDetails();refresh();
    const hash=id?'#room='+encodeURIComponent(id):'';
    history.replaceState(null,'',location.pathname+location.search+hash);
    if(id && matchMedia('(max-width:630px)').matches && !opts.noScroll) $('detailCard').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function loadPanoramaLib(){
    if(window.pannellum)return window.pannellum;
    if(!cachedPanoPromise){cachedPanoPromise=new Promise((resolve,reject)=>{
      if(!document.querySelector('#pannellumCss')){const link=document.createElement('link');link.id='pannellumCss';link.rel='stylesheet';link.href='https://cdnjs.cloudflare.com/ajax/libs/pannellum/2.5.6/pannellum.css';document.head.appendChild(link);}
      const script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/pannellum/2.5.6/pannellum.js';script.onload=()=>window.pannellum?resolve(window.pannellum):reject(new Error('Panorama API missing'));
      script.onerror=()=>reject(new Error('The 360° viewer could not be loaded. Check your connection.'));document.body.appendChild(script);
    }).catch(err=>{cachedPanoPromise=null;throw err;});}
    return cachedPanoPromise;
  }
  async function mountPanorama(path){
    const box=$('panoBox');if(!box)return;box.textContent='Loading panorama…';
    try{const pannellum=await loadPanoramaLib();if(!box.isConnected)return;box.replaceChildren();viewer=pannellum.viewer(box,{type:'equirectangular',panorama:path,autoLoad:true,showControls:true,compass:false});}
    catch(e){if(box.isConnected)box.textContent=e.message;}
  }
  function openPhoto(r,i){const p=r.photos[i];const src=typeof p==='string'?p:p.src;const alt=typeof p==='string'?r.name:(p.alt||r.name);$('lightboxImage').src=src;$('lightboxImage').alt=alt;$('lightboxCaption').textContent=alt;$('lightbox').hidden=false;$('lightboxClose').focus();}
  function closePhoto(){$('lightbox').hidden=true;$('lightboxImage').removeAttribute('src');}
  $('lightboxClose').addEventListener('click',closePhoto);$('lightbox').addEventListener('click',e=>{if(e.target===$('lightbox'))closePhoto();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('lightbox').hidden)closePhoto();});

  function constrainPan(){const maxX=Math.max(0,(zoom-1)*stage.clientWidth/2);const maxY=Math.max(0,(zoom-1)*stage.clientHeight/2);panX=Math.max(-maxX,Math.min(maxX,panX));panY=Math.max(-maxY,Math.min(maxY,panY));}
  function drawTransform(){constrainPan();mapTransform.style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;}
  function setZoom(s){zoom=Math.max(1,Math.min(4,s));if(zoom===1){panX=0;panY=0;}drawTransform();}
  function resetZoom(){setZoom(1);}
  function focusOnRoom(r){
    if(mapView!=='schematic') switchView('schematic');
    if(!Array.isArray(r.rect))return;
    const [x,y,w,ht]=r.rect;
    const centerX=(x+w/2)/1672,centerY=(y+ht/2)/941;
    zoom=2.1;
    panX=(.5-centerX)*stage.clientWidth*zoom;
    panY=(.5-centerY)*stage.clientHeight*zoom;
    mapTransform.style.transition='transform .25s ease';drawTransform();
    setTimeout(()=>{mapTransform.style.transition='';},270);
    stage.scrollIntoView({behavior:'smooth',block:'center'});
  }
  $('zoomIn').addEventListener('click',()=>setZoom(+(zoom+.35).toFixed(2)));
  $('zoomOut').addEventListener('click',()=>setZoom(+(zoom-.35).toFixed(2)));
  $('zoomReset').addEventListener('click',resetZoom);
  stage.addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();setZoom(zoom+(e.deltaY<0?.22:-.22));}},{passive:false});
  stage.addEventListener('pointerdown',e=>{
    if(e.button!==0 || e.target.closest('.map-controls'))return;
    pointerStart={x:e.clientX,y:e.clientY,px:panX,py:panY};lastMove=false;
    // Do not steal the pointer from clickable SVG regions: capture retargets the click to the map canvas.
    if(!e.target.closest('.room-region')) stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove',e=>{
    if(!pointerStart)return;
    const dx=e.clientX-pointerStart.x,dy=e.clientY-pointerStart.y;
    if(Math.hypot(dx,dy)>6){
      if(!lastMove && !stage.hasPointerCapture(e.pointerId)) { try{stage.setPointerCapture(e.pointerId);}catch{} }
      lastMove=true;panX=pointerStart.px+dx;panY=pointerStart.py+dy;drawTransform();stage.classList.add('is-dragging');
    }
  });
  function stopDrag(){pointerStart=null;stage.classList.remove('is-dragging');if(lastMove)setTimeout(()=>{lastMove=false;},70);}
  stage.addEventListener('pointerup',stopDrag);stage.addEventListener('pointercancel',stopDrag);
  window.addEventListener('resize',drawTransform);

  function switchView(which){
    mapView=which;resetZoom();
    $('schematicView').hidden=which!=='schematic';$('droneView').hidden=which!=='drone';
    $('schematicTab').classList.toggle('active',which==='schematic');$('droneTab').classList.toggle('active',which==='drone');
    $('schematicTab').setAttribute('aria-pressed',String(which==='schematic'));$('droneTab').setAttribute('aria-pressed',String(which==='drone'));
    $('mapHint').textContent=which==='drone'?'Switch back to the interactive map to select a room':'Click a space · Drag to pan · Use + / − to zoom';
  }
  $('schematicTab').addEventListener('click',()=>switchView('schematic'));
  $('droneTab').addEventListener('click',()=>switchView('drone'));
  $('droneUpload').addEventListener('change',e=>{
    const file=e.target.files?.[0];if(!file||!file.type.startsWith('image/'))return;
    const img=$('dronePhoto');if(img.dataset.objectUrl)URL.revokeObjectURL(img.dataset.objectUrl);
    img.dataset.objectUrl=URL.createObjectURL(file);img.src=img.dataset.objectUrl;
    $('droneWaiting').hidden=true;$('droneLoaded').hidden=false;
  });
  [search,zone,category].forEach(input=>input.addEventListener(input===search?'input':'change',refresh));
  $('clearSearch').addEventListener('click',()=>{search.value='';refresh();search.focus();});
  $('resetFilters').addEventListener('click',()=>{search.value='';zone.value='all';category.value='all';refresh();});
  // Direct links: share URLs such as #room=einstein-lab.
  const startHash=location.hash.match(/^#room=([^&]+)/);
  if(startHash){const id=decodeURIComponent(startHash[1]);if(byId(id))selectRoom(id,{noScroll:true});}
  refresh();
})();
